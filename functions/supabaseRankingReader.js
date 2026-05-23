/**
 * Supabase Materialized View → Firebase 랭킹 API 동일 JSON.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const {
  buildByCategoryFromEntries,
  genderDbToClient,
} = require("./rankingResponseAdapter");

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

function applyGenderFilter(query, gender) {
  if (!gender || gender === "all") return query;
  if (gender === "M") return query.eq("gender", "male");
  if (gender === "F") return query.eq("gender", "female");
  return query;
}

function mapRowToFirebaseUser(row, firebaseUid) {
  return {
    userId: firebaseUid,
    name: row.display_name || "(이름 없음)",
    ageCategory: row.league_category || "unknown",
    gender: genderDbToClient(row.gender),
    is_private: false,
    profileImageUrl: row.profile_image_url || null,
  };
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchWeeklyTssRanking(admin, startStr, endStr, gender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidMap = await getFirebaseUidByUuidMap(admin);

  let query = supabase
    .from("mv_leaderboard_weekly_tss")
    .select(
      "user_id, display_name, profile_image_url, gender, league_category, weekly_tss, week_start, week_end"
    )
    .order("weekly_tss", { ascending: false });

  query = applyGenderFilter(query, gender);

  const { data, error } = await query.limit(2000);
  if (error) throw error;

  const entries = [];
  for (const row of data || []) {
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const totalTss = Math.round(Number(row.weekly_tss) * 100) / 100;
    if (totalTss <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      totalTss,
    });
  }

  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);
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
    readSource: "supabase",
  };
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPeakPowerMonthly(
  admin,
  startStr,
  endStr,
  durationType,
  gender
) {
  const col = PEAK_WKG_COLUMN[durationType];
  if (!col) return null;

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidMap = await getFirebaseUidByUuidMap(admin);

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

  const entries = [];
  for (const row of data || []) {
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const wkg = Math.round(Number(row[col]) * 100) / 100;
    if (wkg <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
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

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPersonalDist(admin, startStr, endStr, gender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidMap = await getFirebaseUidByUuidMap(admin);

  let query = supabase
    .from("mv_leaderboard_distance_30d")
    .select(
      "user_id, display_name, profile_image_url, gender, league_category, distance_30d_km, dist_window_start, dist_window_end"
    )
    .gt("distance_30d_km", 0)
    .order("distance_30d_km", { ascending: false });

  query = applyGenderFilter(query, gender);

  const { data, error } = await query.limit(2000);
  if (error) throw error;

  const entries = [];
  for (const row of data || []) {
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const totalKm = Math.round(Number(row.distance_30d_km) * 100) / 100;
    if (totalKm <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      totalKm,
    });
  }

  const { entries: ranked, byCategory } = buildByCategoryFromEntries(entries);
  return {
    success: true,
    byCategory,
    entries: ranked,
    startStr:
      (data && data[0] && data[0].dist_window_start) || startStr,
    endStr: (data && data[0] && data[0].dist_window_end) || endStr,
    period: "rolling30",
    durationType: "personal_dist",
    gender,
    precomputed: true,
    readSource: "supabase",
  };
}

/**
 * @param {import('firebase-admin')} admin
 */
async function fetchPersonalSpeed(admin, startStr, endStr, gender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidMap = await getFirebaseUidByUuidMap(admin);

  let query = supabase
    .from("mv_leaderboard_speed_28d")
    .select(
      "user_id, display_name, profile_image_url, gender, league_category, speed_28d_kmh, speed_window_start, speed_window_end"
    )
    .gt("speed_28d_kmh", 0)
    .order("speed_28d_kmh", { ascending: false });

  query = applyGenderFilter(query, gender);

  const { data, error } = await query.limit(2000);
  if (error) throw error;

  const entries = [];
  for (const row of data || []) {
    const fbUid = uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const speedKmh = Math.round(Number(row.speed_28d_kmh) * 100) / 100;
    if (speedKmh <= 0) continue;
    entries.push({
      ...mapRowToFirebaseUser(row, fbUid),
      speedKmh,
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
    readSource: "supabase",
  };
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
  getFirebaseUidByUuidMap,
  resetUuidMapCacheForTests,
  resolveUuid,
};
