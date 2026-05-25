/**
 * Supabase Materialized View → Firebase 랭킹 API 동일 JSON.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const {
  buildByCategoryFromEntries,
  genderDbToClient,
} = require("./rankingResponseAdapter");

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

function applyGenderFilter(query, gender) {
  if (!gender || gender === "all") return query;
  if (gender === "M") return query.eq("gender", "male");
  if (gender === "F") return query.eq("gender", "female");
  return query;
}

function mapRowToFirebaseUser(row, firebaseUid) {
  return {
    userId: firebaseUid,
    name: row.actual_name || row.name || row.display_name || "(이름 없음)",
    ageCategory: row.league_category || "unknown",
    gender: genderDbToClient(row.gender),
    is_private: row.is_private === true,
    profileImageUrl: row.profile_image_url || null,
  };
}

function profileGenderMatches(profile, gender) {
  if (!gender || gender === "all") return true;
  const g = String(profile && profile.gender ? profile.gender : "").toLowerCase();
  if (gender === "M") return g === "male" || g === "m" || g === "남";
  if (gender === "F") return g === "female" || g === "f" || g === "여";
  return true;
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
      "id, firebase_uid, name, display_name, profile_image_url, gender, challenge, birth_year, is_private",
      "id",
      userIds
    );
    for (const userRow of userRows || []) {
      if (!userRow || !userRow.id) continue;
      const key = String(userRow.id);
      const prev = map.get(key) || {};
      map.set(key, {
        ...prev,
        id: userRow.id,
        firebase_uid: userRow.firebase_uid || prev.firebase_uid,
        actual_name: userRow.name || userRow.display_name || prev.display_name,
        profile_image_url: userRow.profile_image_url || prev.profile_image_url,
        gender: userRow.gender || prev.gender,
        league_category: prev.league_category || deriveLeagueCategoryFromSupabaseUser(userRow),
        is_private: userRow.is_private === true || prev.is_private === true,
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
  if (missing.length) {
    const legacyMap = await getFirebaseUidByUuidMap(admin);
    missing.forEach((id) => {
      const fbUid = legacyMap.get(id);
      if (fbUid) map.set(id, fbUid);
    });
  }
  return map;
}

function weeklyTssRowsToEntries(rows, uidMap, gender) {
  const entries = [];
  for (const row of rows || []) {
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
    .eq("week_end", endStr)
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
async function fetchWeeklyTssRanking(admin, startStr, endStr, gender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();

  let rows = [];
  let source = "supabase_daily_summaries";
  try {
    rows = await fetchWeeklyTssRowsFromDailySummariesLive(supabase, startStr, endStr);
  } catch (liveErr) {
    console.warn(
      "[supabaseRankingReader] weekly TSS live RPC failed, fallback metrics:",
      liveErr && liveErr.message ? liveErr.message : liveErr
    );
    source = "supabase_user_ranking_metrics";
    rows = await fetchWeeklyTssRowsFromUserRankingMetrics(supabase, startStr, endStr, gender);
  }

  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (rows || []).map((row) => row.user_id)
  );
  const profileMap = await getPublicProfileMapForSupabaseUsers(
    supabase,
    (rows || []).map((row) => row.user_id)
  );
  rows = (rows || []).map((row) => {
    const profile = profileMap.get(String(row.user_id));
    return profile ? { ...row, ...profile, user_id: row.user_id } : row;
  });
  const entries = weeklyTssRowsToEntries(rows, uidMap, gender);
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
    liveComputed: source === "supabase_daily_summaries",
    readSource: "supabase",
    supabaseWeeklyTssSource: source,
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

  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (data || []).map((row) => row.user_id)
  );
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

  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (data || []).map((row) => row.user_id)
  );
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

  let data = [];
  let source = "supabase_mv_leaderboard_speed_28d";
  try {
    let query = supabase
      .from("mv_leaderboard_speed_28d")
      .select(
        "user_id, display_name, profile_image_url, gender, league_category, speed_28d_kmh, speed_window_start, speed_window_end"
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
    supabasePersonalSpeedSource: source,
  };
}

async function fetchPeakRewardRanking(admin, startStr, endStr, durationType, gender) {
  if (!PEAK_WKG_COLUMN[durationType]) return null;
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("fn_peak_reward_leaderboard", {
    p_start: startStr,
    p_end: endStr,
    p_duration: durationType,
    p_gender: gender || "all",
  });
  if (error) throw error;

  const uidMap = await getFirebaseUidMapForSupabaseUsers(
    admin,
    supabase,
    (data || []).map((row) => row.user_id)
  );
  const entries = [];
  for (const row of data || []) {
    const fbUid = row.firebase_uid ? String(row.firebase_uid).trim() : uidMap.get(String(row.user_id));
    if (!fbUid) continue;
    const wkg = Math.round(Number(row.peak_wkg) * 100) / 100;
    if (!(wkg > 0)) continue;
    entries.push({
      userId: fbUid,
      name: row.display_name || "(이름 없음)",
      ageCategory: row.league_category || "unknown",
      gender: genderDbToClient(row.gender),
      is_private: false,
      profileImageUrl: row.profile_image_url || null,
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

/**
 * 그룹 탭: 최근 30일 오픈 라이딩 — 방장별 참가자 당일 라이딩 거리(km) 합.
 * Firestore getRolling30dGroupDistanceByHostEntries 와 동일 규칙(daily_summaries km).
 * @param {import('firebase-admin')} admin
 */
async function fetchGroupDistRanking(admin, startStr, endStr) {
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
        "users",
        "id, display_name, profile_image_url",
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
    entries.push({
      userId: hostUserId,
      hostUserId,
      name:
        (prof && prof.display_name && String(prof.display_name).trim()) ||
        v.name,
      totalKm: Math.round(v.totalKm * 100) / 100,
      ageCategory: "Supremo",
      gender: "",
      is_private: false,
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

  return {
    success: true,
    byCategory,
    entries: withRank,
    startStr,
    endStr,
    period: "rolling30",
    durationType: "group_dist",
    gender: "all",
    precomputed: true,
    readSource: "supabase",
  };
}

function getMonthKeyKstNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
}

function mapGcRowToEntry(row, fbUid, filterGender, gcScore) {
  const g =
    filterGender === "F" ? "female" : filterGender === "M" ? "male" : "male";
  return {
    userId: fbUid,
    name: (row.display_name && String(row.display_name).trim()) || "(이름 없음)",
    ageCategory: row.age_category != null ? String(row.age_category) : "",
    gender: g,
    is_private: row.is_private === true,
    gcScore,
    rankChange:
      row.rank_change != null && isFinite(Number(row.rank_change))
        ? Math.round(Number(row.rank_change))
        : null,
    previousBoardRank:
      row.previous_board_rank != null && isFinite(Number(row.previous_board_rank))
        ? Math.floor(Number(row.previous_board_rank))
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
 * GC(헵타곤): Supabase `heptagon_cohort_ranks` — Firestore buildStelvioGcRankingPayload와 동일 정렬·성별 점수 통일.
 * @param {import('firebase-admin')} admin
 * @param {string} [monthKey] YYYY-MM (KST)
 * @param {string} [filterGender] all | M | F
 */
async function fetchGcRanking(admin, monthKey, filterGender) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const mk = monthKey || getMonthKeyKstNow();
  const fg = filterGender === "M" || filterGender === "F" ? filterGender : "all";
  const applyGenderScoreUnify = fg === "M" || fg === "F";

  let supreAllScores = null;
  if (applyGenderScoreUnify) {
    supreAllScores = new Map();
    const { data: supAll, error: supAllErr } = await supabase
      .from("heptagon_cohort_ranks")
      .select("user_id, sum_position_scores, range_start, range_end, as_of_seoul")
      .eq("month_key", mk)
      .eq("filter_category", "Supremo")
      .eq("filter_gender", "all")
      .order("sum_position_scores", { ascending: false })
      .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
    if (supAllErr) throw supAllErr;
    const supAllUidMap = await getFirebaseUidMapForSupabaseUsers(
      admin,
      supabase,
      (supAll || []).map((row) => row.user_id)
    );
    for (const row of supAll || []) {
      const fbUid = supAllUidMap.get(String(row.user_id));
      if (
        fbUid &&
        row.sum_position_scores != null &&
        isFinite(Number(row.sum_position_scores))
      ) {
        supreAllScores.set(fbUid, Number(row.sum_position_scores));
      }
    }
  }

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

  await Promise.all(
    HEPTAGON_CATEGORIES.map(async (cat) => {
      const { data, error } = await supabase
        .from("heptagon_cohort_ranks")
        .select(
          "user_id, display_name, age_category, sum_position_scores, previous_board_rank, rank_change, range_start, range_end, as_of_seoul, is_private"
        )
        .eq("month_key", mk)
        .eq("filter_category", cat)
        .eq("filter_gender", fg)
        .order("sum_position_scores", { ascending: false })
        .limit(GC_RANKING_MAX_ROWS_PER_CATEGORY);
      if (error) throw error;

      const uidMap = await getFirebaseUidMapForSupabaseUsers(
        admin,
        supabase,
        (data || []).map((row) => row.user_id)
      );
      const rows = [];
      for (let i = 0; i < (data || []).length; i++) {
        const row = data[i];
        captureGcSnapshotMeta(row, metaState);
        const fbUid = uidMap.get(String(row.user_id));
        if (!fbUid) continue;
        let gcScore =
          row.sum_position_scores != null && isFinite(Number(row.sum_position_scores))
            ? Number(row.sum_position_scores)
            : 0;
        if (applyGenderScoreUnify && supreAllScores.has(fbUid)) {
          gcScore = supreAllScores.get(fbUid);
        }
        const entry = mapGcRowToEntry(row, fbUid, fg, gcScore);
        entry.rank = rows.length + 1;
        rows.push(entry);
      }

      if (applyGenderScoreUnify) {
        rows.sort((a, b) => {
          if (b.gcScore !== a.gcScore) return b.gcScore - a.gcScore;
          return String(a.userId).localeCompare(String(b.userId));
        });
        for (let ri = 0; ri < rows.length; ri++) {
          rows[ri].rank = ri + 1;
        }
      }

      byCategory[cat] = rows;
    })
  );

  const entries = (byCategory.Supremo || []).slice();
  if (!entries.length) {
    return null;
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
    precomputed: true,
    readSource: "supabase",
  };
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
    try {
      const metaSnap = await admin
        .firestore()
        .collection("ranking_meta")
        .doc(RANKING_HEPTAGON_REBUILD_META_DOC || "heptagon_daily_rebuild")
        .get();
      if (metaSnap.exists) heptagonMeta = metaSnap.data() || null;
    } catch (_eHm) {}
    if (!heptagonMeta) {
      console.warn("[supabaseRankingReader] heptagon meta fallback failed:", eSbMeta && eSbMeta.message ? eSbMeta.message : eSbMeta);
    }
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
  getFirebaseUidByUuidMap,
  resetUuidMapCacheForTests,
  resolveUuid,
  getMonthKeyKstNow,
  HEPTAGON_CATEGORIES,
};
