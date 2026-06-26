/**
 * Supabase Materialized View → Firebase 랭킹 API 동일 JSON.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const {
  buildByCategoryFromEntries,
  genderDbToClient,
} = require("./rankingResponseAdapter");
const rankingDayRollup = require("./rankingDayRollup");

const HEPTAGON_CATEGORIES = [
  "Supremo",
  "Assoluto",
  "Bianco",
  "Rosa",
  "Infinito",
  "Leggenda",
];
const GC_RANKING_MAX_ROWS_PER_CATEGORY = 10000;
const SUPABASE_IN_QUERY_CHUNK = 200;

function effectiveDayKmFromSummaryRow(row) {
  const ks = Number(row.km_strava_sum) || 0;
  const kk = Number(row.km_stelvio_sum) || 0;
  return ks > 0 ? ks : kk;
}

async function supabaseSelectInChunks(supabase, table, select, column, ids, applyExtra) {
  const out = [];
  const list = (ids || []).filter(Boolean);
  for (let i = 0; i < list.length; i += SUPABASE_IN_QUERY_CHUNK) {
    const slice = list.slice(i, i + SUPABASE_IN_QUERY_CHUNK);
    let q = supabase.from(table).select(select).in(column, slice);
    if (typeof applyExtra === "function") q = applyExtra(q);
    const { data, error } = await q;
    if (error) throw error;
    if (data && data.length) out.push(...data);
  }
  return out;
}

const PEAK_WKG_COLUMN = {
  "1min": "peak_1min_wkg",
  "5min": "peak_5min_wkg",
  "10min": "peak_10min_wkg",
  "20min": "peak_20min_wkg",
  "40min": "peak_40min_wkg",
  "60min": "peak_60min_wkg",
  max: "peak_max_wkg",
};

/** @type {Map<string, string>|null} uuid → firebaseUid */
let uuidToFirebaseCache = null;
let uuidMapLoadedAt = 0;
const UUID_MAP_TTL_MS = 5 * 60 * 1000;

function getUidConfig() {
  return {
    uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
    uidMode:
      supabaseDualWriteServer.uidModeParam.value() === "literal"
        ? "literal"
        : "v5",
  };
}

function resolveUuid(firebaseUid) {
  const cfg = getUidConfig();
  return supabaseDualWriteServer.resolveUserUuid
    ? supabaseDualWriteServer.resolveUserUuid(
        firebaseUid,
        cfg.uidNamespace,
        cfg.uidMode
      )
    : null;
}

/**
 * v5 UUID → Firebase UID 역매핑 (users 전체 1회 스캔, 5분 캐시).
 * @param {import('firebase-admin')} admin
 */
async function getFirebaseUidByUuidMap(admin) {
  const now = Date.now();
  if (uuidToFirebaseCache && now - uuidMapLoadedAt < UUID_MAP_TTL_MS) {
    return uuidToFirebaseCache;
  }
  const { v5: uuidv5 } = require("uuid");
  const cfg = getUidConfig();
  const map = new Map();
  const snap = await admin.firestore().collection("users").select().get();
  snap.docs.forEach((doc) => {
    const fbUid = doc.id;
    let uuid;
    if (cfg.uidMode === "literal" || /^[0-9a-f-]{36}$/i.test(fbUid)) {
      uuid = fbUid.toLowerCase();
    } else {
      uuid = uuidv5(fbUid, cfg.uidNamespace);
    }
    map.set(uuid, fbUid);
  });
  uuidToFirebaseCache = map;
  uuidMapLoadedAt = now;
  return map;
}

/**
 * MV/RPC 조회 — gender_code(male/female) 기준 SQL 슬라이스.
 * 프로필 병합 후 profileGenderMatches로 2차 검증.
 */
function genderFilterToDbEnum(gender) {
  if (gender === "M") return "male";
  if (gender === "F") return "female";
  return null;
}

function applyGenderFilter(query, gender) {
  const dbGender = genderFilterToDbEnum(gender);
  if (dbGender) return query.eq("gender", dbGender);
  return query;
}

function logSupabaseRankingRequest(tableOrRpc, gender, extra) {
  const parts = [
    "[Stelvio Supabase Request] Table:",
    tableOrRpc,
    "Gender Filter:",
    gender || "all",
  ];
  if (extra) parts.push(String(extra));
  console.log(parts.join(" "));
}

function countRankingPayloadEntries(payload) {
  if (!payload || !payload.byCategory) return 0;
  let n = 0;
  for (const cat of HEPTAGON_CATEGORIES) {
    const rows = payload.byCategory[cat];
    if (Array.isArray(rows)) n += rows.length;
  }
  return n;
}

function normalizeRankingGenderParam(g) {
  return g === "M" || g === "F" ? g : "all";
}

/**
 * gender=all 통합 payload — 클라이언트 M/F 슬라이스용 메타만 부착.
 */
function finalizeUnifiedAllSupabasePayload(payload) {
  if (!payload) return payload;
  payload.gender = "all";
  delete payload.filterGenderPrecomputed;
  delete payload.supabaseQueryGenderRequested;
  delete payload.supabaseServedUnifiedAllView;
  return payload;
}

/**
 * gender=M|F — 서버에서 profileGenderMatches·MV 슬라이스로 이미 분리된 payload.
 */
function finalizeGenderFilteredSupabasePayload(payload, want) {
  if (!payload) return payload;
  if (want === "all") return finalizeUnifiedAllSupabasePayload(payload);
  payload.gender = want;
  payload.filterGenderPrecomputed = true;
  payload.precomputed = payload.precomputed !== false;
  delete payload.supabaseQueryGenderRequested;
  delete payload.supabaseServedUnifiedAllView;
  return payload;
}

async function fetchNonGcSupabaseBoard(
  fetchCore,
  admin,
  coreArgs,
  requestedGender,
  durationType,
  label
) {
  const want = normalizeRankingGenderParam(requestedGender);
  logSupabaseRankingRequest(
    label,
    want,
    `duration=${durationType} serverGenderFilter=${want}`
  );
  const payload = await fetchCore(admin, ...coreArgs, want);
  if (!payload) return null;
  const n = countRankingPayloadEntries(payload);
  console.log(
    "[Stelvio Supabase Request] Result:",
    label,
    "requested=",
    want,
    "payload.gender=",
    want,
    "rows=",
    n
  );
  return finalizeGenderFilteredSupabasePayload(payload, want);
}

function mapRowToFirebaseUser(row, firebaseUid) {
  return {
    userId: firebaseUid,
    name: resolveRankingEntryName(row, row.display_name || row.name),
    ageCategory: row.league_category || "unknown",
    gender: genderDbToClient(row.gender),
    is_private: row.is_private === true,
    profileImageUrl: row.profile_image_url || null,
  };
}

/** GC·피크 공통: API 응답에는 실명 + is_private (UI에서 마스킹) */
function resolveRankingEntryName(profileOrRow, rowFallbackName) {
  const actual =
    profileOrRow && profileOrRow.actual_name && String(profileOrRow.actual_name).trim()
      ? String(profileOrRow.actual_name).trim()
      : "";
  if (actual) return actual;
  const rowName =
    rowFallbackName != null && String(rowFallbackName).trim() !== "비공개"
      ? String(rowFallbackName).trim()
      : "";
  if (rowName) return rowName;
  const profDisplay =
    profileOrRow &&
    profileOrRow.display_name &&
    String(profileOrRow.display_name).trim() !== "비공개"
      ? String(profileOrRow.display_name).trim()
      : "";
  if (profDisplay) return profDisplay;
  const plainName =
    profileOrRow && profileOrRow.name && String(profileOrRow.name).trim() !== "비공개"
      ? String(profileOrRow.name).trim()
      : "";
  return plainName || "(이름 없음)";
}

function profileGenderToken(profile) {
  return String(profile && profile.gender != null ? profile.gender : "")
    .trim()
    .toLowerCase();
}

/** Supabase users / v_user_public_profile — 탈퇴·정지 계정 랭킹 제외 */
function isSupabaseRankingEligibleProfile(profile) {
  if (!profile) return false;
  if (profile.is_active === false) return false;
  const st = String(profile.account_status || "active").trim().toLowerCase();
  if (st === "withdrawn" || st === "suspended" || st === "inactive" || st === "deleted") {
    return false;
  }
  return true;
}

/** 피크·TSS 등: 프로필 gender 필수 일치 */
function profileGenderMatches(profile, gender) {
  if (!gender || gender === "all") return true;
  const g = profileGenderToken(profile);
  if (!g) return false;
  if (g === "m" || g === "male" || g === "남" || g === "남성") {
    return gender === "M";
  }
  if (g === "f" || g === "female" || g === "여" || g === "여성") {
    return gender === "F";
  }
  return false;
}

/**
 * GC 헵타곤 filter_gender 슬라이스: cohort 멤버십 우선.
 * 프로필에 **명시적 반대 성별**만 제외, gender 미상은 슬라이스에 포함.
 */
function profileGenderConflictsWithFilter(profile, gender) {
  if (!gender || gender === "all") return false;
  const g = profileGenderToken(profile);
  if (!g) return false;
  if (gender === "M") {
    return g === "f" || g === "female" || g === "여" || g === "여성";
  }
  if (gender === "F") {
    return g === "m" || g === "male" || g === "남" || g === "남성";
  }
  return false;
}

function deriveLeagueCategoryFromSupabaseUser(row) {
  if (!row) return "unknown";
  const challenge = String(row.challenge || "").trim();
  if (challenge === "Elite" || challenge === "PRO") return "Assoluto";
  const birthYear = Number(row.birth_year);
  if (!Number.isFinite(birthYear) || birthYear <= 0) return "unknown";
  const seoulYear = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric",
    }).format(new Date())
  );
  const age = seoulYear - birthYear;
  if (age <= 39) return "Bianco";
  if (age <= 49) return "Rosa";
  if (age <= 59) return "Infinito";
  return "Leggenda";
}

async function getPublicProfileMapForSupabaseUsers(supabase, userIds) {
  let rows = [];
  try {
    rows = await supabaseSelectInChunks(
      supabase,
      "v_user_public_profile",
      "id, firebase_uid, display_name, profile_image_url, gender, league_category, is_private",
      "id",
      userIds
    );
  } catch (err) {
    if (!String(err && err.message ? err.message : err).includes("firebase_uid")) throw err;
    rows = await supabaseSelectInChunks(
      supabase,
      "v_user_public_profile",
      "id, display_name, profile_image_url, gender, league_category, is_private",
      "id",
      userIds
    );
  }
  const map = new Map();
  for (const row of rows || []) {
    if (row && row.id) map.set(String(row.id), row);
  }
  try {
    const userRows = await supabaseSelectInChunks(
      supabase,
      "users",
      "id, firebase_uid, name, display_name, profile_image_url, gender, challenge, birth_year, weight_kg, is_private, account_status",
      "id",
      userIds
    );
    for (const userRow of userRows || []) {
      if (!userRow || !userRow.id) continue;
      const accountStatus = String(userRow.account_status || "active").trim().toLowerCase();
      const key = String(userRow.id);
      if (accountStatus !== "active") {
        map.delete(key);
        continue;
      }
      const prev = map.get(key) || {};
      map.set(key, {
        ...prev,
        id: userRow.id,
        firebase_uid: userRow.firebase_uid || prev.firebase_uid,
        actual_name: userRow.name || userRow.display_name || prev.display_name,
        profile_image_url: userRow.profile_image_url || prev.profile_image_url,
        gender: userRow.gender || prev.gender,
        league_category: prev.league_category || deriveLeagueCategoryFromSupabaseUser(userRow),
        weight_kg: Number(userRow.weight_kg) > 0 ? Number(userRow.weight_kg) : prev.weight_kg,
        is_private: userRow.is_private === true || prev.is_private === true,
        account_status: userRow.account_status || "active",
      });
    }
  } catch (err) {
    console.warn("[supabaseRankingReader] actual profile name map failed:", err && err.message ? err.message : err);
  }
  return map;
}

async function getFirebaseUidMapForSupabaseUsers(admin, supabase, userIds) {
  const ids = Array.from(new Set((userIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  const map = new Map();
  if (!ids.length) return map;

  try {
    const profiles = await getPublicProfileMapForSupabaseUsers(supabase, ids);
    profiles.forEach((profile, id) => {
      const fbUid = profile && profile.firebase_uid ? String(profile.firebase_uid).trim() : "";
      if (fbUid) map.set(id, fbUid);
    });
  } catch (err) {
    console.warn("[supabaseRankingReader] firebase_uid profile map failed:", err && err.message ? err.message : err);
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length && supabase) {
    try {
      const uidRows = await supabaseSelectInChunks(
        supabase,
        "users",
        "id, firebase_uid, account_status",
        "id",
        missing
      );
      for (const row of uidRows || []) {
        if (!row || !row.id) continue;
        const accountStatus = String(row.account_status || "active").trim().toLowerCase();
        if (accountStatus !== "active") continue;
        const fbUid = row.firebase_uid ? String(row.firebase_uid).trim() : "";
        if (fbUid) map.set(String(row.id), fbUid);
      }
    } catch (eUidCol) {
      console.warn(
        "[supabaseRankingReader] users.firebase_uid chunk lookup failed:",
        eUidCol && eUidCol.message ? eUidCol.message : eUidCol
      );
    }
  }

  const stillMissing = ids.filter((id) => !map.has(id));
  if (stillMissing.length && admin && admin.firestore) {
    const FieldPath = admin.firestore.FieldPath;
    const CHUNK = 30;
    for (let i = 0; i < stillMissing.length; i += CHUNK) {
      const chunk = stillMissing.slice(i, i + CHUNK);
      try {
        const qSnap = await admin
          .firestore()
          .collection("users")
          .where(FieldPath.documentId(), "in", chunk)
          .select()
          .get();
        qSnap.forEach((doc) => map.set(String(doc.id), doc.id));
      } catch (eFsChunk) {
        console.warn(
          "[supabaseRankingReader] users docId chunk lookup failed:",
          eFsChunk && eFsChunk.message ? eFsChunk.message : eFsChunk
        );
      }
    }
  }

  const legacyMissing = ids.filter((id) => !map.has(id));
  if (legacyMissing.length) {
    console.warn(
      "[supabaseRankingReader] firebase_uid unresolved after Supabase+chunk FS",
      { count: legacyMissing.length, sample: legacyMissing.slice(0, 5) }
    );
    if (parseBool(process.env.SUPABASE_RANKING_ALLOW_LEGACY_USERS_SCAN) === true) {
      const legacyMap = await getFirebaseUidByUuidMap(admin);
      legacyMissing.forEach((id) => {
        const fbUid = legacyMap.get(id);
        if (fbUid) map.set(id, fbUid);
      });
    }
  }
  return map;
}

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function weeklyTssRowsToEntries(rows, uidMap, gender) {
  const entries = [];
  for (const row of rows || []) {
    if (!isSupabaseRankingEligibleProfile(row)) continue;
    const fbUid = row.firebase_uid ? String(row.firebase_uid).trim() : uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    if (!profileGenderMatches(row, gender)) continue;
    const totalTss = Math.round(Number(row.weekly_tss) * 100) / 100;
    if (totalTss <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      totalTss,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      metricsUpdatedAt: row.metrics_updated_at || null,
    });
  }
  return entries;
}

function personalDistRowsToEntries(rows, uidMap, gender) {
  const entries = [];
  for (const row of rows || []) {
    if (!isSupabaseRankingEligibleProfile(row)) continue;
    const fbUid = row.firebase_uid ? String(row.firebase_uid).trim() : uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    if (!profileGenderMatches(row, gender)) continue;
    const totalKm = Math.round(Number(row.distance_30d_km) * 100) / 100;
    if (totalKm <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      totalKm,
    });
  }
  return entries;
}

async function fetchPersonalDistRowsFromDailySummariesLive(supabase, startStr, endStr) {
  const { data, error } = await supabase.rpc("fn_personal_dist_leaderboard_live", {
    p_start: startStr,
    p_end: endStr,
  });
  if (error) throw error;
  return data || [];
}

async function enrichSupabaseRankingRowsWithProfiles(supabase, rows) {
  const userIds = (rows || []).map((r) => r.user_id).filter(Boolean);
  if (!userIds.length) return rows || [];
  const profileMap = await getPublicProfileMapForSupabaseUsers(supabase, userIds);
  return (rows || []).map((row) => {
    const profile = profileMap.get(String(row.user_id));
    if (!profile) return row;
    return { ...row, ...profile, user_id: row.user_id };
  });
}

/** Supabase public profile만 '비공개'인 행 — Firestore users.name 보강(이름 누락 TOP10 방지) */
async function hydrateSupabaseRankingRowsMissingNames(admin, rows, uidMap) {
  if (!admin || !Array.isArray(rows) || !rows.length) return rows || [];
  const needFb = [];
  for (const row of rows) {
    const display = String(row.display_name || "").trim();
    const actual = String(row.actual_name || row.name || "").trim();
    if (actual.length >= 2) continue;
    if (display.length >= 2 && display !== "비공개") continue;
    const fbUid = uidMap.get(String(row.user_id));
    if (fbUid) needFb.push(fbUid);
  }
  if (!needFb.length) return rows;
  const unique = [...new Set(needFb)];
  const nameByFb = new Map();
  const db = admin.firestore();
  const CHUNK = 10;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const snaps = await db.getAll(...slice.map((id) => db.collection("users").doc(id)));
    for (let j = 0; j < slice.length; j++) {
      const snap = snaps[j];
      if (!snap || !snap.exists) continue;
      const d = snap.data() || {};
      const n = String(d.name || d.display_name || "").trim();
      if (n.length >= 2) nameByFb.set(slice[j], n);
    }
  }
  if (!nameByFb.size) return rows;
  return rows.map((row) => {
    const fbUid = uidMap.get(String(row.user_id));
    const fsName = fbUid ? nameByFb.get(fbUid) : null;
    if (!fsName) return row;
    return { ...row, actual_name: fsName };
  });
}

async function fetchWeeklyTssRowsFromDailySummariesLive(supabase, startStr, endStr) {
  const { data, error } = await supabase.rpc("fn_weekly_tss_leaderboard_live", {
    p_start: startStr,
    p_end: endStr,
  });
  if (error) throw error;
  return data || [];
}

async function fetchWeeklyTssRowsFromUserRankingMetrics(supabase, startStr, endStr, gender) {
  const { data, error } = await supabase
    .from("user_ranking_metrics")
    .select(
      "user_id, weekly_tss, week_start, week_end, weekly_has_cheat_day, metrics_updated_at"
    )
    .eq("week_start", startStr)
    .eq("weekly_has_cheat_day", false)
    .gt("weekly_tss", 0)
    .order("weekly_tss", { ascending: false })
    .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
  if (error) throw error;

  const profileMap = await getPublicProfileMapForSupabaseUsers(
    supabase,
    (data || []).map((row) => row.user_id)
  );
  const rows = [];
  for (const row of data || []) {
    const profile = profileMap.get(String(row.user_id));
    if (!profile) continue;
    if (!profileGenderMatches(profile, gender)) continue;
    rows.push({
      ...profile,
      user_id: row.user_id,
      weekly_tss: row.weekly_tss,
      week_start: row.week_start,
      week_end: row.week_end,
      weekly_has_cheat_day: row.weekly_has_cheat_day,
      metrics_updated_at: row.metrics_updated_at,
    });
  }
  return rows;
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchWeeklyTssRankingCore(admin, startStr, endStr, gender) {
  logSupabaseRankingRequest(
    "fn_weekly_tss_leaderboard_live",
    gender,
    `tss ${startStr}~${endStr}`
  );
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  let rows = await fetchWeeklyTssRowsFromDailySummariesLive(supabase, startStr, endStr);
  rows = await enrichSupabaseRankingRowsWithProfiles(supabase, rows);

  const missingFbUid = (rows || [])
    .filter((r) => !(r.firebase_uid && String(r.firebase_uid).trim()))
    .map((r) => r.user_id);
  const uidMap = missingFbUid.length
    ? await getFirebaseUidMapForSupabaseUsers(admin, supabase, missingFbUid)
    : new Map();
  for (const row of rows || []) {
    const sid = String(row.user_id || "");
    const fb = row.firebase_uid ? String(row.firebase_uid).trim() : "";
    if (sid && fb && !uidMap.has(sid)) uidMap.set(sid, fb);
  }
  rows = await hydrateSupabaseRankingRowsMissingNames(admin, rows, uidMap);

  const entries = weeklyTssRowsToEntries(rows, uidMap, gender);
  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);

  console.log(
    "[Stelvio Supabase Request] Result:",
    "weekly_tss",
    "requested=",
    gender,
    "rows=",
    ranked.length
  );

  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr,
    endStr,
    period: "weekly",
    durationType: "tss",
    gender,
    precomputed: true,
    liveComputed: false,
    readSource: "supabase",
    supabaseWeeklyTssSource: "daily_summaries_live_rpc",
  };
}

async function fetchWeeklyTssRanking(admin, startStr, endStr, gender) {
  return fetchNonGcSupabaseBoard(
    fetchWeeklyTssRankingCore,
    admin,
    [startStr, endStr],
    gender,
    "tss",
    "weekly_tss"
  );
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPeakPowerMonthlyCore(
  admin,
  startStr,
  endStr,
  durationType,
  gender
) {
  const col = PEAK_WKG_COLUMN[durationType];
  if (!col) return null;

  logSupabaseRankingRequest("mv_leaderboard_peak_28d", gender, durationType);
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();

  let query = supabase
    .from("mv_leaderboard_peak_28d")
    .select(
      `user_id, display_name, profile_image_url, gender, league_category, peak_window_start, peak_window_end, ${col}`
    )
    .gt(col, 0)
    .order(col, { ascending: false });

  query = applyGenderFilter(query, gender);

  const { data, error } = await query.limit(2000);
  if (error) throw error;

  const profileMap = await getPublicProfileMapForSupabaseUsers(
    supabase,
    (data || []).map((row) => row.user_id)
  );
  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (data || []).map((row) => row.user_id)
  );
  const entries = [];
  for (const row of data || []) {
    const profile = profileMap.get(String(row.user_id));
    const merged = profile ? { ...row, ...profile, user_id: row.user_id } : row;
    if (!isSupabaseRankingEligibleProfile(merged)) continue;
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    if (!profileGenderMatches(merged, gender)) continue;
    const wkg = Math.round(Number(row[col]) * 100) / 100;
    if (wkg <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(merged, fbUid),
      wkg,
      watts: 0,
      weightKg: null,
    });
  }

  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);
  const winStart =
    (data && data[0] && data[0].peak_window_start) || startStr;
  const winEnd = (data && data[0] && data[0].peak_window_end) || endStr;

  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr: winStart || startStr,
    endStr: winEnd || endStr,
    period: "monthly",
    durationType,
    gender,
    precomputed: true,
    readSource: "supabase",
  };
}

async function fetchPeakPowerMonthly(admin, startStr, endStr, durationType, gender) {
  return fetchNonGcSupabaseBoard(
    (a, s, e, g) => fetchPeakPowerMonthlyCore(a, s, e, durationType, g),
    admin,
    [startStr, endStr],
    gender,
    durationType,
    `mv_leaderboard_peak_28d:${durationType}`
  );
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPersonalDistCore(admin, startStr, endStr, gender) {
  logSupabaseRankingRequest(
    "fn_personal_dist_leaderboard_live",
    gender,
    `personal_dist ${startStr}~${endStr}`
  );
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  let rows = await fetchPersonalDistRowsFromDailySummariesLive(supabase, startStr, endStr);
  rows = await enrichSupabaseRankingRowsWithProfiles(supabase, rows);

  const missingFbUid = (rows || [])
    .filter((r) => !(r.firebase_uid && String(r.firebase_uid).trim()))
    .map((r) => r.user_id);
  const uidMap = missingFbUid.length
    ? await getFirebaseUidMapForSupabaseUsers(admin, supabase, missingFbUid)
    : new Map();
  for (const row of rows || []) {
    const sid = String(row.user_id || "");
    const fb = row.firebase_uid ? String(row.firebase_uid).trim() : "";
    if (sid && fb && !uidMap.has(sid)) uidMap.set(sid, fb);
  }
  rows = await hydrateSupabaseRankingRowsMissingNames(admin, rows, uidMap);

  const entries = personalDistRowsToEntries(rows, uidMap, gender);
  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);

  console.log(
    "[Stelvio Supabase Request] Result:",
    "personal_dist",
    "requested=",
    gender,
    "rows=",
    ranked.length
  );

  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr,
    endStr,
    period: "rolling30",
    durationType: "personal_dist",
    gender,
    precomputed: true,
    liveComputed: false,
    readSource: "supabase",
    supabasePersonalDistSource: "daily_summaries_live_rpc",
  };
}

async function fetchPersonalDist(admin, startStr, endStr, gender) {
  return fetchNonGcSupabaseBoard(
    fetchPersonalDistCore,
    admin,
    [startStr, endStr],
    gender,
    "personal_dist",
    "personal_dist"
  );
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPersonalSpeedCore(admin, startStr, endStr, gender) {
  logSupabaseRankingRequest("mv_leaderboard_speed_28d", gender, "personal_speed");
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();

  async function loadMetricRows() {
    const { data: metricRows, error: metricError } = await supabase
      .from("user_ranking_metrics")
      .select(
        "user_id, speed_28d_kmh, speed_peak60_watts, speed_peak60_date, speed_window_start, speed_window_end, metrics_updated_at"
      )
      .gt("speed_28d_kmh", 0)
      .order("speed_28d_kmh", { ascending: false })
      .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
    if (metricError) throw metricError;
    return metricRows || [];
  }

  let data = [];
  let source = "supabase_mv_leaderboard_speed_28d";
  try {
    let query = supabase
      .from("mv_leaderboard_speed_28d")
      .select(
        "user_id, display_name, profile_image_url, gender, league_category, speed_28d_kmh, speed_peak60_watts, speed_peak60_date, speed_window_start, speed_window_end"
      )
      .gt("speed_28d_kmh", 0)
      .order("speed_28d_kmh", { ascending: false });

    query = applyGenderFilter(query, gender);

    const result = await query.limit(2000);
    if (result.error) throw result.error;
    data = result.data || [];
  } catch (err) {
    console.warn(
      "[supabaseRankingReader] personal speed MV failed, fallback metrics:",
      err && err.message ? err.message : err
    );
    data = [];
  }

  if (!data.length) {
    source = "supabase_user_ranking_metrics";
    const { data: metricRows, error: metricError } = await supabase
      .from("user_ranking_metrics")
      .select(
        "user_id, speed_28d_kmh, speed_peak60_watts, speed_peak60_date, speed_window_start, speed_window_end, metrics_updated_at"
      )
      .gt("speed_28d_kmh", 0)
      .order("speed_28d_kmh", { ascending: false })
      .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
    if (metricError) throw metricError;

    const profileMap = await getPublicProfileMapForSupabaseUsers(
      supabase,
      (metricRows || []).map((row) => row.user_id)
    );
    data = [];
    for (const row of metricRows || []) {
      const profile = profileMap.get(String(row.user_id));
      if (!profile) continue;
      if (!profileGenderMatches(profile, gender)) continue;
      data.push({
        ...profile,
        user_id: row.user_id,
        speed_28d_kmh: row.speed_28d_kmh,
        speed_peak60_watts: row.speed_peak60_watts,
        speed_peak60_date: row.speed_peak60_date,
        speed_window_start: row.speed_window_start,
        speed_window_end: row.speed_window_end,
        metrics_updated_at: row.metrics_updated_at,
      });
    }
  }

  if (
    data.length &&
    data[0] &&
    data[0].speed_window_end &&
    String(data[0].speed_window_end) !== String(endStr)
  ) {
    source = "supabase_user_ranking_metrics_window_refresh";
    data = await loadMetricRows();
  }

  const profileMap = await getPublicProfileMapForSupabaseUsers(
    supabase,
    (data || []).map((row) => row.user_id)
  );
  data = (data || [])
    .map((row) => {
      const profile = profileMap.get(String(row.user_id));
      return profile ? { ...row, ...profile, user_id: row.user_id } : row;
    })
    .filter((row) => profileGenderMatches(row, gender));

  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (data || []).map((row) => row.user_id)
  );
  const entries = [];
  for (const row of data || []) {
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const speedKmh = Math.round(Number(row.speed_28d_kmh) * 100) / 100;
    if (speedKmh <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      speedKmh,
      peak60minWatts: Number(row.speed_peak60_watts) || null,
      speedPeak60Date: row.speed_peak60_date || null,
      weightKg: Number(row.weight_kg) || null,
    });
  }

  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);
  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr:
      (data && data[0] && data[0].speed_window_start) || startStr,
    endStr: (data && data[0] && data[0].speed_window_end) || endStr,
    period: "rolling28",
    durationType: "personal_speed",
    gender,
    precomputed: true,
    personalSpeedLogicVersion: rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
    readSource: "supabase",
    supabasePersonalSpeedSource: source,
  };
}

async function fetchPersonalSpeed(admin, startStr, endStr, gender) {
  return fetchNonGcSupabaseBoard(
    fetchPersonalSpeedCore,
    admin,
    [startStr, endStr],
    gender,
    "personal_speed",
    "personal_speed"
  );
}

async function fetchPeakRewardRankingCore(admin, startStr, endStr, durationType, gender) {
  if (!PEAK_WKG_COLUMN[durationType]) return null;
  logSupabaseRankingRequest("fn_peak_reward_leaderboard", gender, durationType);
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("fn_peak_reward_leaderboard", {
    p_start: startStr,
    p_end: endStr,
    p_duration: durationType,
    p_gender: gender || "all",
  });
  if (error) throw error;

  const userIds = (data || []).map((row) => row.user_id);
  const uidMap = await getFirebaseUidMapForSupabaseUsers(admin, supabase, userIds);
  const profileMap = await getPublicProfileMapForSupabaseUsers(supabase, userIds);
  const entries = [];
  for (const row of data || []) {
    const fbUid = row.firebase_uid ? String(row.firebase_uid).trim() : uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const profile = profileMap.get(String(row.user_id));
    const merged = profile ? { ...row, ...profile } : row;
    if (!profileGenderMatches(merged, gender)) continue;
    const wkg = Math.round(Number(row.peak_wkg) * 100) / 100;
    if (!(wkg > 0)) continue;
    entries.push({
      userId: fbUid,
      name: resolveRankingEntryName(profile, row.display_name),
      ageCategory:
        (profile && profile.league_category) || row.league_category || "unknown",
      gender: genderDbToClient(merged.gender),
      is_private: profile ? profile.is_private === true : false,
      profileImageUrl:
        (profile && profile.profile_image_url) || row.profile_image_url || null,
      wkg,
      watts: Number(row.peak_watts) || 0,
    });
  }

  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);
  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr,
    endStr,
    period: "reward",
    durationType,
    gender,
    precomputed: true,
    readSource: "supabase",
  };
}

async function fetchPeakRewardRanking(admin, startStr, endStr, durationType, gender) {
  return fetchNonGcSupabaseBoard(
    (a, s, e, g) => fetchPeakRewardRankingCore(a, s, e, durationType, g),
    admin,
    [startStr, endStr],
    gender,
    durationType,
    `fn_peak_reward_leaderboard:${durationType}`
  );
}

/**
 * 그룹 탭: 최근 30일 오픈 라이딩 — 방장별 참가자 당일 라이딩 거리(km) 합.
 * Firestore getRolling30dGroupDistanceByHostEntries 와 동일 규칙(daily_summaries km).
 * @param {import('firebase-admin')} admin
 */
async function fetchGroupDistRanking(admin, startStr, endStr, requestedGender) {
  const want = normalizeRankingGenderParam(requestedGender);
  logSupabaseRankingRequest(
    "group_dist",
    want,
    `serverGenderFilter=${want}`
  );
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();

  const { data: openRides, error: ridesErr } = await supabase
    .from("open_rides")
    .select("id, host_user_id, host_name, ride_date, status")
    .gte("ride_date", startStr)
    .lte("ride_date", endStr)
    .neq("status", "cancelled");
  if (ridesErr) throw ridesErr;
  if (!openRides || !openRides.length) return null;

  const rideIds = openRides.map((r) => r.id);
  const partRows = await supabaseSelectInChunks(
    supabase,
    "open_ride_participants",
    "ride_id, user_id",
    "ride_id",
    rideIds,
    (q) => q.eq("is_waitlist", false)
  );

  const partsByRide = new Map();
  const participantUuidSet = new Set();
  for (const pr of partRows) {
    if (!pr || !pr.ride_id || !pr.user_id) continue;
    const rid = String(pr.ride_id);
    const uid = String(pr.user_id);
    if (!partsByRide.has(rid)) partsByRide.set(rid, new Set());
    partsByRide.get(rid).add(uid);
    participantUuidSet.add(uid);
  }

  const participantUuids = Array.from(participantUuidSet);
  const kmByUserDate = new Map();
  if (participantUuids.length) {
    const summaryRows = await supabaseSelectInChunks(
      supabase,
      "daily_summaries",
      "user_id, summary_date, km_strava_sum, km_stelvio_sum",
      "user_id",
      participantUuids,
      (q) => q.gte("summary_date", startStr).lte("summary_date", endStr)
    );
    for (const row of summaryRows) {
      const key = `${String(row.user_id)}|${String(row.summary_date)}`;
      const km = effectiveDayKmFromSummaryRow(row);
      if (km > 0) kmByUserDate.set(key, Math.round(km * 100) / 100);
    }
  }

  const byHost = new Map();
  for (const ride of openRides) {
    const hostUuid = String(ride.host_user_id || "");
    const ymd = String(ride.ride_date || "").slice(0, 10);
    if (!ymd || ymd < startStr || ymd > endStr) continue;
    const partSet = partsByRide.get(String(ride.id));
    if (!partSet || !partSet.size) continue;

    let rideScore = 0;
    partSet.forEach((pUuid) => {
      const km = kmByUserDate.get(`${pUuid}|${ymd}`) || 0;
      rideScore += km;
    });
    if (rideScore <= 0) continue;

    if (!byHost.has(hostUuid)) {
      byHost.set(hostUuid, {
        hostUuid,
        name:
          (ride.host_name && String(ride.host_name).trim().slice(0, 80)) ||
          "(이름 없음)",
        totalKm: 0,
      });
    }
    const agg = byHost.get(hostUuid);
    agg.totalKm += rideScore;
  }

  if (!byHost.size) return null;

  const hostUuids = Array.from(
    new Set(Array.from(byHost.values()).map((v) => v.hostUuid).filter(Boolean))
  );
  const uidMap = await getFirebaseUidMapForSupabaseUsers(admin, supabase, hostUuids);
  const hostProfileRows = hostUuids.length
    ? await supabaseSelectInChunks(
        supabase,
        "v_user_public_profile",
        "id, display_name, profile_image_url, gender, league_category, is_private",
        "id",
        hostUuids
      )
    : [];
  const profileByUuid = new Map();
  for (const u of hostProfileRows) {
    if (u && u.id) profileByUuid.set(String(u.id), u);
  }

  const entries = [];
  for (const [, v] of byHost) {
    const hostUserId = uidMap.get(v.hostUuid);
    if (!hostUserId) continue;
    const prof = profileByUuid.get(v.hostUuid);
    if (!profileGenderMatches(prof, want)) continue;
    entries.push({
      userId: hostUserId,
      hostUserId,
      name:
        (prof && prof.display_name && String(prof.display_name).trim()) ||
        v.name,
      totalKm: Math.round(v.totalKm * 100) / 100,
      ageCategory:
        (prof && prof.league_category) || "Supremo",
      gender: genderDbToClient(prof && prof.gender),
      is_private: prof ? prof.is_private === true : false,
      rankingKind: "group",
      currentUserParticipated: false,
      profileImageUrl: (prof && prof.profile_image_url) || null,
    });
  }

  entries.sort((a, b) => b.totalKm - a.totalKm);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = {
    Supremo: withRank,
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
    Assoluto: [],
  };

  const payload = {
    success: true,
    byCategory,
    entries: withRank,
    startStr,
    endStr,
    period: "rolling30",
    durationType: "group_dist",
    gender: want,
    precomputed: true,
    readSource: "supabase",
  };
  console.log(
    "[Stelvio Supabase Request] Result:",
    "group_dist",
    "requested=",
    want,
    "payload.gender=",
    want,
    "rows=",
    countRankingPayloadEntries(payload)
  );
  return finalizeGenderFilteredSupabasePayload(payload, want);
}

function getMonthKeyKstNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
}

async function fetchGcCohortRankDocs(supabase, monthKey, category, filterGender) {
  const { data, error } = await supabase
    .from("heptagon_cohort_ranks")
    .select(
      "user_id, display_name, age_category, board_rank, comprehensive_rank, sum_position_scores, previous_board_rank, rank_change, yesterday_official_board_rank, range_start, range_end, as_of_seoul, is_private"
    )
    .eq("month_key", monthKey)
    .eq("filter_category", category)
    .eq("filter_gender", filterGender)
    .order("board_rank", { ascending: true })
    .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
  if (error) throw error;
  return data || [];
}

function resolveGcEntryGender(filterGender, profile, row) {
  const fromProf =
    profile && profile.gender != null ? genderDbToClient(profile.gender) : "";
  if (fromProf) return fromProf;
  if (row && row.gender != null) return genderDbToClient(row.gender);
  if (filterGender === "F") return "female";
  if (filterGender === "M") return "male";
  return "";
}

function mapGcRowToEntry(row, fbUid, filterGender, gcScore, profile) {
  const g = resolveGcEntryGender(filterGender, profile, row);
  const name = resolveRankingEntryName(profile || row, row.display_name);
  const statusFields =
    profile && typeof profile === "object"
      ? {
          account_status: String(profile.account_status || "active").trim() || "active",
          isWithdrawn:
            String(profile.account_status || "active").trim().toLowerCase() !== "active",
        }
      : { account_status: "active", isWithdrawn: false };
  return {
    userId: fbUid,
    name,
    ageCategory:
      (profile && profile.league_category) ||
      (row.age_category != null ? String(row.age_category) : ""),
    gender: g,
    is_private: row.is_private === true || (profile && profile.is_private === true),
    profileImageUrl: (profile && profile.profile_image_url) || null,
    account_status: statusFields.account_status,
    isWithdrawn: statusFields.isWithdrawn === true,
    gcScore,
    rankChange:
      row.rank_change != null && isFinite(Number(row.rank_change))
        ? Math.round(Number(row.rank_change))
        : null,
    previousBoardRank:
      row.previous_board_rank != null && isFinite(Number(row.previous_board_rank))
        ? Math.floor(Number(row.previous_board_rank))
        : row.yesterday_official_board_rank != null &&
            isFinite(Number(row.yesterday_official_board_rank))
          ? Math.floor(Number(row.yesterday_official_board_rank))
          : null,
  };
}

function captureGcSnapshotMeta(d, state) {
  if (!d || d.range_start == null) return;
  const rs = String(d.range_start).trim();
  const re = d.range_end != null ? String(d.range_end).trim() : "";
  const asOf =
    d.as_of_seoul != null ? String(d.as_of_seoul).trim().slice(0, 10) : "";
  if (!state.snapshotRangeStart) {
    state.snapshotRangeStart = rs;
    state.snapshotRangeEnd = re;
  }
  if (asOf && (!state.snapshotAsOfSeoul || asOf > state.snapshotAsOfSeoul)) {
    state.snapshotAsOfSeoul = asOf;
  }
}

/**
 * GC(헵타곤) 코어: Supabase `heptagon_cohort_ranks` filter_gender 슬라이스 조회.
 * @param {import('firebase-admin')} admin
 * @param {string} [monthKey] YYYY-MM (KST)
 * @param {string} [queryGender] all | M | F — 래퍼는 M/F 요청 시 항상 all
 */
async function fetchGcRankingCore(admin, monthKey, queryGender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const mk = monthKey || getMonthKeyKstNow();
  const fg = queryGender === "M" || queryGender === "F" ? queryGender : "all";

  const metaState = {
    snapshotRangeStart: "",
    snapshotRangeEnd: "",
    snapshotAsOfSeoul: "",
  };
  const byCategory = {
    Supremo: [],
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };

  const heptagonCohortRanks = require("./heptagonCohortRanks");

  await Promise.all(
    HEPTAGON_CATEGORIES.map(async (cat) => {
      let cohortDocs = await fetchGcCohortRankDocs(supabase, mk, cat, fg);
      let latestRows = heptagonCohortRanks.filterLatestGcDocsWithRankMovement(cohortDocs);
      const latestHasMovement = latestRows.some(
        (r) => r.rank_change != null && isFinite(Number(r.rank_change))
      );
      if (latestRows.length && !latestHasMovement) {
        const prevMk = heptagonCohortRanks.getPreviousMonthKeyKst(mk);
        if (prevMk) {
          const prevDocs = await fetchGcCohortRankDocs(supabase, prevMk, cat, fg);
          if (prevDocs.length) {
            cohortDocs = cohortDocs.concat(prevDocs);
            latestRows = heptagonCohortRanks.filterLatestGcDocsWithRankMovement(cohortDocs);
          }
        }
      }

      const uidMap = await getFirebaseUidMapForSupabaseUsers(
        admin,
        supabase,
        latestRows.map((row) => row.user_id)
      );
      const profileMap = await getPublicProfileMapForSupabaseUsers(
        supabase,
        latestRows.map((row) => row.user_id)
      );
      const rows = [];
      for (let i = 0; i < latestRows.length; i++) {
        const row = latestRows[i];
        captureGcSnapshotMeta(row, metaState);
        const fbUid = uidMap.get(String(row.user_id));
        if (!fbUid) continue;
        const profile = profileMap.get(String(row.user_id));
        if (!isSupabaseRankingEligibleProfile(profile)) continue;
        if (!profileGenderMatches(profile, fg)) continue;
        const gcScore =
          row.sum_position_scores != null && isFinite(Number(row.sum_position_scores))
            ? Number(row.sum_position_scores)
            : 0;
        const entry = mapGcRowToEntry(row, fbUid, fg, gcScore, profile);
        entry.rank =
          row.board_rank != null && isFinite(Number(row.board_rank))
            ? Math.floor(Number(row.board_rank))
            : rows.length + 1;
        entry.comprehensiveRank =
          row.comprehensive_rank != null && isFinite(Number(row.comprehensive_rank))
            ? Math.floor(Number(row.comprehensive_rank))
            : entry.rank;
        rows.push(entry);
      }

      byCategory[cat] = heptagonCohortRanks.rerankGcBoardRows(rows);
    })
  );

  try {
    const rankingEligibility = require("./rankingEligibility");
    if (typeof rankingEligibility.filterEligibleByCategory === "function") {
      const filtered = rankingEligibility.filterEligibleByCategory(byCategory);
      for (const cat of Object.keys(filtered)) {
        byCategory[cat] = filtered[cat];
      }
    }
  } catch (_eGcSb) {}

  const entries = (byCategory.Supremo || []).slice();
  if (!entries.length) {
    return null;
  }

  let gcRankMovementPresent = false;
  for (let gci = 0; gci < HEPTAGON_CATEGORIES.length; gci++) {
    const catRows = byCategory[HEPTAGON_CATEGORIES[gci]] || [];
    for (let gri = 0; gri < catRows.length; gri++) {
      const er = catRows[gri];
      if (
        er &&
        er.rankChange != null &&
        er.previousBoardRank != null &&
        isFinite(Number(er.rankChange)) &&
        isFinite(Number(er.previousBoardRank))
      ) {
        gcRankMovementPresent = true;
        break;
      }
    }
    if (gcRankMovementPresent) break;
  }

  return {
    success: true,
    byCategory,
    entries,
    startStr: metaState.snapshotRangeStart,
    endStr: metaState.snapshotRangeEnd,
    period: "monthly",
    durationType: "gc",
    gender: fg,
    gcMonthKey: mk,
    gcSnapshotAsOf: metaState.snapshotAsOfSeoul || null,
    gcRankMovementPresent,
    rankMovementSource: gcRankMovementPresent ? "supabase_gc_cohort" : null,
    precomputed: true,
    readSource: "supabase",
  };
}

/**
 * GC(헵타곤): M/F 요청도 Supabase는 filter_gender=all만 조회, 응답 gender=all.
 * @param {import('firebase-admin')} admin
 * @param {string} [monthKey] YYYY-MM (KST)
 * @param {string} [requestedGender] all | M | F
 */
/**
 * GC 탭 헵타곤(7축) 레이더 — Supremo 행의 ranks·cohort_n_per_axis (피크 7회 조회 폴백용).
 * @param {import('firebase-admin')} admin
 * @param {object} payload GC ranking payload
 * @param {string|null} viewerFirebaseUid
 * @param {string} gender all|M|F
 */
async function attachGcViewerHeptagonAxes(admin, payload, viewerFirebaseUid, gender) {
  if (!payload || !viewerFirebaseUid) return payload;
  const fbUid = String(viewerFirebaseUid).trim();
  if (!fbUid) return payload;

  const monthKey = payload.gcMonthKey || getMonthKeyKstNow();
  const fg = gender === "M" || gender === "F" ? gender : "all";
  let supabase;
  try {
    supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  } catch (eSb) {
    return payload;
  }

  const uuid = resolveUuid(fbUid);
  if (!uuid) return payload;

  try {
    const { data, error } = await supabase
      .from("heptagon_cohort_ranks")
      .select(
        "user_id, filter_category, ranks, cohort_n_per_axis, position_scores100, sum_position_scores, board_rank"
      )
      .eq("month_key", monthKey)
      .eq("filter_gender", fg)
      .eq("filter_category", "Supremo")
      .eq("user_id", uuid)
      .order("as_of_seoul", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return payload;

    const ranks = Array.isArray(data.ranks) ? data.ranks.map((r) => Math.floor(Number(r))) : null;
    const cohortN = Array.isArray(data.cohort_n_per_axis)
      ? data.cohort_n_per_axis.map((n) => Math.max(0, Math.floor(Number(n))))
      : null;
    const pos100 = Array.isArray(data.position_scores100)
      ? data.position_scores100.map((v) => Number(v))
      : null;
    if (!ranks || ranks.length !== 7) return payload;

    payload.viewerHeptagonAxis = {
      ranks,
      cohortSizePerAxis: cohortN && cohortN.length === 7 ? cohortN : ranks.map(() => 100),
      positionScores100: pos100 && pos100.length === 7 ? pos100 : null,
      sumPositionScores:
        data.sum_position_scores != null && isFinite(Number(data.sum_position_scores))
          ? Number(data.sum_position_scores)
          : null,
      boardRank:
        data.board_rank != null && isFinite(Number(data.board_rank))
          ? Math.floor(Number(data.board_rank))
          : null,
    };

    const supRows = payload.byCategory && payload.byCategory.Supremo;
    if (Array.isArray(supRows)) {
      for (let i = 0; i < supRows.length; i++) {
        const row = supRows[i];
        if (row && String(row.userId) === fbUid) {
          row.heptagonRanks = ranks;
          row.heptagonCohortNPerAxis = payload.viewerHeptagonAxis.cohortSizePerAxis;
          row.positionScores100 = payload.viewerHeptagonAxis.positionScores100;
          break;
        }
      }
    }
    if (payload.currentUser && String(payload.currentUser.userId) === fbUid) {
      payload.currentUser.heptagonRanks = ranks;
      payload.currentUser.heptagonCohortNPerAxis = payload.viewerHeptagonAxis.cohortSizePerAxis;
      payload.currentUser.positionScores100 = payload.viewerHeptagonAxis.positionScores100;
    }
  } catch (eAxis) {
    console.warn(
      "[supabaseRankingReader] attachGcViewerHeptagonAxes failed:",
      eAxis && eAxis.message ? eAxis.message : eAxis
    );
  }
  return payload;
}

async function fetchGcRanking(admin, monthKey, requestedGender, viewerFirebaseUid) {
  const want = normalizeRankingGenderParam(requestedGender);
  const mk = monthKey || getMonthKeyKstNow();
  logSupabaseRankingRequest(
    "heptagon_cohort_ranks",
    want,
    `filter_gender=${want} month=${mk}`
  );
  const payload = await fetchGcRankingCore(admin, mk, want);
  if (!payload) return null;
  if (viewerFirebaseUid) {
    await attachGcViewerHeptagonAxes(admin, payload, viewerFirebaseUid, want);
  }
  const n = countRankingPayloadEntries(payload);
  console.log(
    "[Stelvio Supabase Request] Result:",
    "heptagon_cohort_ranks",
    "requested=",
    want,
    "payload.gender=",
    want,
    "rows=",
    n
  );
  return finalizeGenderFilteredSupabasePayload(payload, want);
}

/**
 * GC 응답 — ranking_meta·stale 플래그 (Firestore heptagon_daily_rebuild 메타).
 */
async function attachGcHeptagonMeta(admin, payload, deps) {
  if (!payload || !deps) return payload;
  const {
    getMinHeptagonSnapshotAsOfSeoulYmd,
    getRolling28DaysRangeSeoul,
    RANKING_HEPTAGON_REBUILD_META_DOC,
  } = deps;
  const rollingFallback =
    typeof getRolling28DaysRangeSeoul === "function"
      ? getRolling28DaysRangeSeoul()
      : { startStr: "", endStr: "" };
  const minGcAsOf =
    typeof getMinHeptagonSnapshotAsOfSeoulYmd === "function"
      ? getMinHeptagonSnapshotAsOfSeoulYmd()
      : "";
  const gcAsOf = payload.gcSnapshotAsOf
    ? String(payload.gcSnapshotAsOf).trim().slice(0, 10)
    : "";

  let heptagonMeta = null;
  try {
    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ranking_build_meta")
      .select("meta_key, date_kst, status, completed_at, updated_at")
      .eq("meta_key", RANKING_HEPTAGON_REBUILD_META_DOC || "heptagon_daily_rebuild")
      .maybeSingle();
    if (error) throw error;
    heptagonMeta = data || null;
  } catch (eSbMeta) {
    console.warn(
      "[supabaseRankingReader] heptagon meta read failed (no Firestore fallback):",
      eSbMeta && eSbMeta.message ? eSbMeta.message : eSbMeta
    );
  }
  if (!heptagonMeta) {
    /* meta optional */
  }

  const heptMetaDateKst =
    heptagonMeta && (heptagonMeta.dateKst || heptagonMeta.date_kst)
      ? String(heptagonMeta.dateKst || heptagonMeta.date_kst).trim().slice(0, 10)
      : "";
  const heptMetaComplete =
    heptagonMeta && String(heptagonMeta.status || "") === "complete";
  const gcStaleVsMin = !!(gcAsOf && minGcAsOf && gcAsOf < minGcAsOf);
  const gcStaleVsMeta = !!(
    heptMetaComplete &&
    heptMetaDateKst &&
    gcAsOf &&
    heptMetaDateKst > gcAsOf
  );

  payload.startStr = payload.startStr || rollingFallback.startStr;
  payload.endStr = payload.endStr || rollingFallback.endStr;
  payload.gcSnapshotDaily = true;
  payload.gcMinSnapshotAsOf = minGcAsOf;
  payload.gcSnapshotStale = gcStaleVsMin || gcStaleVsMeta;
  payload.gcHeptagonRebuildDateKst = heptMetaDateKst || null;
  payload.gcHeptagonRebuildStatus =
    heptagonMeta && heptagonMeta.status ? String(heptagonMeta.status) : null;
  payload.gcHeptagonPeakSource =
    heptagonMeta &&
    heptagonMeta.summary &&
    heptagonMeta.summary.peakSource
      ? String(heptagonMeta.summary.peakSource)
      : null;
  return payload;
}

function resetUuidMapCacheForTests() {
  uuidToFirebaseCache = null;
  uuidMapLoadedAt = 0;
}

module.exports = {
  fetchWeeklyTssRanking,
  fetchPeakPowerMonthly,
  fetchPersonalDist,
  fetchPersonalSpeed,
  fetchPeakRewardRanking,
  fetchGcRanking,
  fetchGroupDistRanking,
  attachGcHeptagonMeta,
  attachGcViewerHeptagonAxes,
  getFirebaseUidByUuidMap,
  resetUuidMapCacheForTests,
  resolveUuid,
  getMonthKeyKstNow,
  HEPTAGON_CATEGORIES,
};
