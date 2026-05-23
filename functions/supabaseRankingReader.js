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

/**
 * 그룹 탭: 최근 30일 오픈 라이딩 — 방장별 참가자 당일 라이딩 거리(km) 합.
 * Firestore getRolling30dGroupDistanceByHostEntries 와 동일 규칙(daily_summaries km).
 * @param {import('firebase-admin')} admin
 */
async function fetchGroupDistRanking(admin, startStr, endStr) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidMap = await getFirebaseUidByUuidMap(admin);

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
    const hostFb = uidMap.get(hostUuid);
    if (!hostFb) continue;
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

    if (!byHost.has(hostFb)) {
      byHost.set(hostFb, {
        hostUserId: hostFb,
        hostUuid,
        name:
          (ride.host_name && String(ride.host_name).trim().slice(0, 80)) ||
          "(이름 없음)",
        totalKm: 0,
      });
    }
    const agg = byHost.get(hostFb);
    agg.totalKm += rideScore;
  }

  if (!byHost.size) return null;

  const hostUuids = Array.from(
    new Set(Array.from(byHost.values()).map((v) => v.hostUuid).filter(Boolean))
  );
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
    const prof = profileByUuid.get(v.hostUuid);
    entries.push({
      userId: v.hostUserId,
      hostUserId: v.hostUserId,
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
  const uidMap = await getFirebaseUidByUuidMap(admin);
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
    for (const row of supAll || []) {
      const fbUid = uidMap.get(String(row.user_id));
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
    const metaSnap = await admin
      .firestore()
      .collection("ranking_meta")
      .doc(RANKING_HEPTAGON_REBUILD_META_DOC || "heptagon_daily_rebuild")
      .get();
    if (metaSnap.exists) heptagonMeta = metaSnap.data() || null;
  } catch (_eHm) {
    /* meta optional */
  }

  const heptMetaDateKst =
    heptagonMeta && heptagonMeta.dateKst
      ? String(heptagonMeta.dateKst).trim().slice(0, 10)
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
  fetchGcRanking,
  fetchGroupDistRanking,
  attachGcHeptagonMeta,
  getFirebaseUidByUuidMap,
  resetUuidMapCacheForTests,
  resolveUuid,
  getMonthKeyKstNow,
  HEPTAGON_CATEGORIES,
};
