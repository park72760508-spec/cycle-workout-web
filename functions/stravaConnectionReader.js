/**
 * Strava 연동 사용자 목록 — Supabase strava_connections + users.firebase_uid.
 * Firestore `users WHERE strava_refresh_token != ''` 대량 조회 대체.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const CACHE_MS = 5 * 60 * 1000;
const SUPABASE_PAGE_SIZE = 1000;
const FIRESTORE_GETALL_CHUNK = 300;

/** @type {{ ids: string[]|null, loadedAt: number, source: string|null }} */
let cache = { ids: null, loadedAt: 0, source: null };

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function hasNonEmptyRefreshToken(value) {
  return Boolean(String(value || "").trim());
}

/**
 * @returns {Promise<Array<{ user_id: string, refresh_token: string, strava_athlete_id: number|null }>>}
 */
async function loadStravaConnectionRowsFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const rows = [];
  let from = 0;
  for (let page = 0; page < 100; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("strava_connections")
      .select("user_id, refresh_token, strava_athlete_id")
      .order("user_id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;

    for (const row of data || []) {
      if (!row || !row.user_id) continue;
      if (!hasNonEmptyRefreshToken(row.refresh_token)) continue;
      rows.push(row);
    }

    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return rows;
}

/**
 * @param {string[]} userUuids
 * @returns {Promise<Map<string, string>>} supabase user uuid → firebase uid
 */
async function loadFirebaseUidMapForUserUuids(userUuids) {
  const map = new Map();
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase || !userUuids.length) return map;

  const unique = Array.from(new Set(userUuids.map((id) => String(id).trim()).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("users")
      .select("id, firebase_uid")
      .in("id", chunk);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;
    for (const row of data || []) {
      const uuid = String(row.id || "").trim();
      const fbUid = String(row.firebase_uid || "").trim();
      if (uuid && fbUid) map.set(uuid, fbUid);
    }
  }
  return map;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<string[]>}
 */
async function loadStravaConnectedFirebaseUidsFromFirestore(db) {
  if (!db) return [];
  const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
  return usersSnap.docs.map((d) => d.id);
}

/**
 * Strava refresh_token 보유 Firebase UID 목록 (Supabase 우선, 5분 캐시).
 * @param {import('firebase-admin').firestore.Firestore} [db] Firestore 폴백용
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
async function listStravaConnectedFirebaseUids(db, options = {}) {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cache.ids && now - cache.loadedAt < CACHE_MS) {
    return cache.ids.slice();
  }

  const forceFirestore = parseBool(process.env.STRAVA_CONNECTED_USERS_FORCE_FIRESTORE);
  const allowFirestoreFallback = parseBool(process.env.STRAVA_CONNECTED_USERS_FIRESTORE_FALLBACK);

  if (!forceFirestore) {
    try {
      const connectionRows = await loadStravaConnectionRowsFromSupabase();
      if (connectionRows.length > 0) {
        const uidMap = await loadFirebaseUidMapForUserUuids(
          connectionRows.map((row) => String(row.user_id))
        );
        const ids = [];
        const seen = new Set();
        for (const row of connectionRows) {
          const fbUid = uidMap.get(String(row.user_id));
          if (!fbUid || seen.has(fbUid)) continue;
          seen.add(fbUid);
          ids.push(fbUid);
        }
        if (ids.length > 0) {
          cache = { ids, loadedAt: now, source: "supabase" };
          return ids.slice();
        }
      }
      console.warn("[stravaConnectionReader] Supabase strava_connections empty");
    } catch (err) {
      console.warn(
        "[stravaConnectionReader] Supabase list failed:",
        err && err.message ? err.message : err
      );
    }
  }

  if ((allowFirestoreFallback || forceFirestore) && db) {
    const ids = await loadStravaConnectedFirebaseUidsFromFirestore(db);
    cache = { ids, loadedAt: now, source: "firestore" };
    return ids.slice();
  }

  return cache.ids ? cache.ids.slice() : [];
}

/** @deprecated listStravaConnectedFirebaseUids 와 동일 */
async function listStravaConnectedUserIds(db, options = {}) {
  return listStravaConnectedFirebaseUids(db, options);
}

/**
 * Strava 연동 사용자 Firestore 문서 스냅샷 (동기화 job용).
 * UID 목록은 Supabase, 사용자 필드는 getAll 배치 조회.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot[]>}
 */
async function fetchStravaConnectedUserDocSnaps(db) {
  if (!db) return [];
  const ids = await listStravaConnectedFirebaseUids(db);
  if (!ids.length) return [];

  const out = [];
  for (let i = 0; i < ids.length; i += FIRESTORE_GETALL_CHUNK) {
    const chunk = ids.slice(i, i + FIRESTORE_GETALL_CHUNK);
    const refs = chunk.map((id) => db.collection("users").doc(id));
    /* eslint-disable no-await-in-loop */
    const snaps = refs.length ? await db.getAll(...refs) : [];
    /* eslint-enable no-await-in-loop */
    snaps.forEach((snap) => {
      if (!snap || !snap.exists) return;
      const data = snap.data() || {};
      if (!hasNonEmptyRefreshToken(data.strava_refresh_token)) return;
      out.push(snap);
    });
  }
  return out;
}

/**
 * strava_athlete_id 누락 후보 Firebase UID (Supabase strava_connections 기준).
 * @param {number} [maxUsers]
 * @returns {Promise<string[]>}
 */
async function listStravaAthleteIdBackfillFirebaseUids(maxUsers = 2000) {
  const cap = Math.max(1, Math.min(5000, Number(maxUsers) || 2000));
  try {
    const connectionRows = await loadStravaConnectionRowsFromSupabase();
    const missingRows = connectionRows.filter((row) => {
      const aid = Number(row.strava_athlete_id);
      return !Number.isFinite(aid) || aid <= 0;
    });
    if (!missingRows.length) return [];
    const uidMap = await loadFirebaseUidMapForUserUuids(
      missingRows.map((row) => String(row.user_id))
    );
    const out = [];
    for (const row of missingRows) {
      const fbUid = uidMap.get(String(row.user_id));
      if (fbUid) out.push(fbUid);
      if (out.length >= cap) break;
    }
    return out;
  } catch (err) {
    console.warn(
      "[stravaConnectionReader] athlete id backfill list from Supabase failed:",
      err && err.message ? err.message : err
    );
    return [];
  }
}

function resetStravaConnectedUsersCache() {
  cache = { ids: null, loadedAt: 0, source: null };
}

function getStravaConnectedUsersCacheMeta() {
  return {
    count: cache.ids ? cache.ids.length : 0,
    loadedAt: cache.loadedAt,
    source: cache.source,
  };
}

/** @type {{ ids: string[]|null, loadedAt: number }} */
let deadLetterCache = { ids: null, loadedAt: 0 };

/**
 * strava_auth_invalid_confirmed(재연결 필요 확정)로 dead-letter된 사용자를 제외한 연동 목록.
 * 회전/전체 스캔처럼 "언젠가 전원을 훑어야 하는" 경로에서, 재연결 전까지는 절대 성공할 수 없다고
 * 이미 확정된 사용자에게 스캔 슬롯·Strava API 예산을 낭비하지 않도록 한다.
 * (실패 큐 드레인 경로는 listUsersNeedingStravaSyncRetry 등에서 이미 개별적으로 필터링됨 — 중복 아님)
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
async function listStravaConnectedFirebaseUidsExcludingDeadLetter(db, options = {}) {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && deadLetterCache.ids && now - deadLetterCache.loadedAt < CACHE_MS) {
    return deadLetterCache.ids.slice();
  }
  const allIds = await listStravaConnectedFirebaseUids(db, options);
  if (!allIds.length || !db) {
    deadLetterCache = { ids: allIds, loadedAt: now };
    return allIds.slice();
  }
  const alive = [];
  for (let i = 0; i < allIds.length; i += FIRESTORE_GETALL_CHUNK) {
    const chunk = allIds.slice(i, i + FIRESTORE_GETALL_CHUNK);
    const refs = chunk.map((id) => db.collection("users").doc(id));
    /* eslint-disable no-await-in-loop */
    const snaps = await db.getAll(...refs);
    /* eslint-enable no-await-in-loop */
    snaps.forEach((snap, idx) => {
      const data = snap.exists ? snap.data() || {} : {};
      if (data.strava_auth_invalid_confirmed === true) return;
      alive.push(chunk[idx]);
    });
  }
  deadLetterCache = { ids: alive, loadedAt: now };
  return alive.slice();
}

const ACTIVITY_RECENCY_CACHE_MS = 30 * 60 * 1000; // 활동성 분류는 자주 안 바뀌므로 30분 캐시
/** @type {{ supabaseUuids: Set<string>|null, loadedAt: number }} */
let activityRecencyCache = { supabaseUuids: null, loadedAt: 0 };

/**
 * 최근 활동(주행거리 30일 실적 > 0)이 있는 Supabase user_id(uuid) 집합.
 * 회전 갭 스캔의 활동성 기반 우선순위 분류용.
 * workout_logs 테이블은 실제로 비어있어(2026-08 확인) 사용 불가 — 랭킹 파이프라인이 매일 전원에
 * 대해 갱신하는 user_ranking_metrics.distance_30d_km(롤링 30일 윈도우, dist_window_end=오늘)를
 * 대신 사용한다. 이 테이블이 유지하는 윈도우가 30일 고정이라 함수 자체에 기간 파라미터는 없다.
 * @returns {Promise<Set<string>>}
 */
async function listRecentlyActiveSupabaseUserUuids() {
  const now = Date.now();
  if (activityRecencyCache.supabaseUuids && now - activityRecencyCache.loadedAt < ACTIVITY_RECENCY_CACHE_MS) {
    return activityRecencyCache.supabaseUuids;
  }
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return new Set();
  const uuids = new Set();
  let from = 0;
  for (let page = 0; page < 50; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("user_ranking_metrics")
      .select("user_id")
      .gt("distance_30d_km", 0)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) {
      console.warn("[stravaConnectionReader] listRecentlyActiveSupabaseUserUuids failed:", error.message);
      break;
    }
    for (const row of data || []) {
      if (row && row.user_id) uuids.add(String(row.user_id));
    }
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  activityRecencyCache = { supabaseUuids: uuids, loadedAt: now };
  return uuids;
}

/**
 * 연동 사용자(dead-letter 제외)를 최근 활동 여부로 active/inactive 두 그룹으로 나눠 반환.
 * 활동 이력이 아예 없는 경우(막 연동한 신규 사용자, user_ranking_metrics 행 없음 등)는 놓치지 않도록
 * 안전하게 active로 분류한다.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<{ active: string[], inactive: string[] }>}
 */
async function listStravaConnectedFirebaseUidsByRecency(db) {
  const aliveIds = await listStravaConnectedFirebaseUidsExcludingDeadLetter(db);
  if (!aliveIds.length) return { active: [], inactive: [] };

  const connectionRows = await loadStravaConnectionRowsFromSupabase();
  const uidMap = await loadFirebaseUidMapForUserUuids(connectionRows.map((row) => String(row.user_id)));
  const fbUidToUuid = new Map();
  for (const [uuid, fbUid] of uidMap.entries()) {
    if (!fbUidToUuid.has(fbUid)) fbUidToUuid.set(fbUid, uuid);
  }

  const activeUuids = await listRecentlyActiveSupabaseUserUuids();

  const active = [];
  const inactive = [];
  for (const fbUid of aliveIds) {
    const uuid = fbUidToUuid.get(fbUid);
    if (!uuid || activeUuids.has(uuid)) {
      active.push(fbUid);
    } else {
      inactive.push(fbUid);
    }
  }
  return { active, inactive };
}

module.exports = {
  listStravaConnectedFirebaseUids,
  listStravaConnectedUserIds,
  listStravaConnectedFirebaseUidsExcludingDeadLetter,
  listStravaConnectedFirebaseUidsByRecency,
  fetchStravaConnectedUserDocSnaps,
  listStravaAthleteIdBackfillFirebaseUids,
  resetStravaConnectedUsersCache,
  getStravaConnectedUsersCacheMeta,
  CACHE_MS,
};
