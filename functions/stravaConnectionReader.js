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

module.exports = {
  listStravaConnectedFirebaseUids,
  listStravaConnectedUserIds,
  fetchStravaConnectedUserDocSnaps,
  listStravaAthleteIdBackfillFirebaseUids,
  resetStravaConnectedUsersCache,
  getStravaConnectedUsersCacheMeta,
  CACHE_MS,
};
