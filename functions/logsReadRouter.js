/**
 * Server-side 훈련 로그 Read 라우터 — Supabase rides 우선, Firestore reads 최소화.
 *
 * appConfig/supabase_read_routing.useSupabaseLogsRead 가 true 이면 Supabase rides 를 먼저 조회하고,
 * parityFallbackToFirebase 가 false 이면 Firestore 대량 폴백을 생략한다.
 */
const rankingReadConfig = require("./rankingReadConfig");

const EXCLUDED_RANKING_ACTIVITY_TYPES = new Set([
  "run",
  "swim",
  "walk",
  "trailrun",
  "weighttraining",
]);

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function isCyclingLogData(logDoc) {
  const source = String((logDoc && logDoc.source) || "").toLowerCase();
  if (source !== "strava") return true;
  const type = String((logDoc && logDoc.activity_type) || "")
    .trim()
    .toLowerCase();
  if (!type) return true;
  return !EXCLUDED_RANKING_ACTIVITY_TYPES.has(type);
}

function isStelvioGapMirrorCandidate(logDoc) {
  const source = String((logDoc && logDoc.source) || "").toLowerCase();
  return source !== "strava";
}

function mapSupabaseLogToEntry(logData) {
  if (!logData || typeof logData !== "object") return null;
  const id = String(logData.activity_id || logData.id || "").trim();
  if (!id) return null;
  return { id, data: logData };
}

/**
 * @param {import('firebase-admin')} adminApp
 * @returns {Promise<{ useSupabaseLogsRead: boolean, parityFallbackToFirebase: boolean }>}
 */
async function loadLogsReadRouteConfig(adminApp) {
  if (adminApp) {
    try {
      await rankingReadConfig.refreshRankingReadConfig(adminApp, false);
    } catch (_) {
      /* 캐시된 값 사용 */
    }
  }
  const cfg = rankingReadConfig.getRankingReadConfig();
  return {
    useSupabaseLogsRead: cfg.useSupabaseLogsRead === true,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase === true,
  };
}

/**
 * @returns {Promise<Array<{ id: string, data: object }>|null>} null = Supabase Read 미사용
 */
async function tryFetchLogEntriesFromSupabase(userId, startStr, endStr) {
  try {
    const reader = require("./supabaseGroupReader");
    if (!reader || typeof reader.fetchUserRideLogsInDateRange !== "function") {
      return null;
    }
    const logs = await reader.fetchUserRideLogsInDateRange(userId, startStr, endStr);
    if (!Array.isArray(logs)) return null;
    const rankingDayRollup = require("./rankingDayRollup");
    const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
    const dateSet = new Set(dates);
    const out = [];
    const seen = new Set();
    for (const logData of logs) {
      if (!isCyclingLogData(logData)) continue;
      const ymd = rankingDayRollup.normalizeLogDateToSeoulYmd(logData.date);
      if (!ymd || !dateSet.has(ymd)) continue;
      const entry = mapSupabaseLogToEntry(logData);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  } catch (e) {
    console.warn(
      "[logsReadRouter] Supabase rides 기간 조회 실패:",
      userId,
      (e && e.message) || e
    );
    return null;
  }
}

/**
 * Firestore users/{uid}/logs — 단일 문자열 date range 쿼리 (필요 시에만 보조 쿼리).
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ gapMirrorStelvioOnly?: boolean, allowTimestampFallback?: boolean, allowRecentScan?: boolean }} options
 * @returns {Promise<Array<{ id: string, data: object }>>}
 */
async function collectFirestoreLogDocEntriesInDateRange(
  db,
  adminApp,
  userId,
  startStr,
  endStr,
  options = {}
) {
  if (!db || !userId || !startStr || !endStr) return [];

  const rankingDayRollup = require("./rankingDayRollup");
  const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
  const dateSet = new Set(dates);
  const seen = new Set();
  const out = [];

  const gapMirrorStelvioOnly = options.gapMirrorStelvioOnly === true;
  const allowTimestampFallback =
    options.allowTimestampFallback === true ||
    parseBool(process.env.FIRESTORE_LOG_RANGE_TIMESTAMP_FALLBACK);
  const allowRecentScan =
    options.allowRecentScan === true ||
    parseBool(process.env.FIRESTORE_LOG_RANGE_INCLUDE_RECENT_SCAN);

  const collectSnap = (snap) => {
    for (const doc of snap.docs) {
      if (!doc || seen.has(doc.id)) continue;
      const data = doc.data() || {};
      if (!isCyclingLogData(data)) continue;
      if (gapMirrorStelvioOnly && !isStelvioGapMirrorCandidate(data)) continue;
      const ymd = rankingDayRollup.normalizeLogDateToSeoulYmd(data.date);
      if (!ymd || !dateSet.has(ymd)) continue;
      seen.add(doc.id);
      out.push({ id: doc.id, data });
    }
  };

  try {
    const rangedStr = await db
      .collection("users")
      .doc(userId)
      .collection("logs")
      .where("date", ">=", startStr)
      .where("date", "<=", endStr)
      .get();
    collectSnap(rangedStr);
  } catch (rangeErr) {
    console.warn(
      "[logsReadRouter] Firestore string date range query failed:",
      userId,
      rangeErr && rangeErr.message ? rangeErr.message : rangeErr
    );
  }

  if (allowTimestampFallback && out.length === 0 && adminApp) {
    try {
      const tsStart = adminApp.firestore.Timestamp.fromDate(
        new Date(`${startStr}T00:00:00+09:00`)
      );
      const tsEnd = adminApp.firestore.Timestamp.fromDate(
        new Date(`${endStr}T23:59:59.999+09:00`)
      );
      const rangedTs = await db
        .collection("users")
        .doc(userId)
        .collection("logs")
        .where("date", ">=", tsStart)
        .where("date", "<=", tsEnd)
        .get();
      collectSnap(rangedTs);
    } catch (tsRangeErr) {
      console.warn(
        "[logsReadRouter] Firestore timestamp date range query failed:",
        userId,
        tsRangeErr && tsRangeErr.message ? tsRangeErr.message : tsRangeErr
      );
    }
  }

  if (allowRecentScan && out.length === 0) {
    try {
      const recent = await db
        .collection("users")
        .doc(userId)
        .collection("logs")
        .orderBy("date", "desc")
        .limit(400)
        .get();
      collectSnap(recent);
    } catch (recentErr) {
      console.warn(
        "[logsReadRouter] Firestore recent log scan failed:",
        userId,
        recentErr && recentErr.message ? recentErr.message : recentErr
      );
    }
  }

  return out;
}

/**
 * Supabase 우선 · Firestore 최소 폴백으로 기간 내 사이클 로그 수집.
 *
 * purpose:
 * - read: Supabase rides 우선 (일반 Read)
 * - gap_mirror | firestore_to_supabase_sync: cutover 시 Firestore Stelvio-only 좁은 스캔
 *
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {import('firebase-admin')} adminApp
 * @param {string} userId
 * @param {string} startStr
 * @param {string} endStr
 * @param {{ purpose?: 'read'|'gap_mirror'|'firestore_to_supabase_sync' }} [options]
 * @returns {Promise<Array<{ id: string, data: object }>>}
 */
async function collectCyclingLogDocEntriesInDateRange(
  db,
  adminApp,
  userId,
  startStr,
  endStr,
  options = {}
) {
  const purpose = options.purpose || "read";
  const routeCfg = await loadLogsReadRouteConfig(adminApp);
  const needsFirestoreSource =
    purpose === "gap_mirror" || purpose === "firestore_to_supabase_sync";

  if (needsFirestoreSource && routeCfg.useSupabaseLogsRead && !routeCfg.parityFallbackToFirebase) {
    return collectFirestoreLogDocEntriesInDateRange(db, adminApp, userId, startStr, endStr, {
      gapMirrorStelvioOnly: true,
    });
  }

  if (!needsFirestoreSource && routeCfg.useSupabaseLogsRead) {
    const supabaseEntries = await tryFetchLogEntriesFromSupabase(userId, startStr, endStr);
    if (supabaseEntries !== null) {
      return supabaseEntries;
    }
    if (!routeCfg.parityFallbackToFirebase) {
      return [];
    }
  }

  return collectFirestoreLogDocEntriesInDateRange(db, adminApp, userId, startStr, endStr, {
    allowTimestampFallback: routeCfg.parityFallbackToFirebase,
    allowRecentScan: routeCfg.parityFallbackToFirebase,
  });
}

/**
 * fetchCyclingLogsInDateRangeRouted 호환 — data 객체 배열만 반환.
 * @returns {Promise<object[]>}
 */
async function fetchCyclingLogDataInDateRange(db, adminApp, userId, startStr, endStr) {
  const entries = await collectCyclingLogDocEntriesInDateRange(
    db,
    adminApp,
    userId,
    startStr,
    endStr,
    { purpose: "read" }
  );
  return entries.map((entry) => entry.data);
}

module.exports = {
  loadLogsReadRouteConfig,
  collectCyclingLogDocEntriesInDateRange,
  collectFirestoreLogDocEntriesInDateRange,
  fetchCyclingLogDataInDateRange,
  tryFetchLogEntriesFromSupabase,
  isCyclingLogData,
};
