/**
 * Canary Read Router — 랭킹 HTTP 응답을 Supabase MV 또는 Firebase 로 분기.
 */
const rankingReadConfig = require("./rankingReadConfig");
const supabaseRankingReader = require("./supabaseRankingReader");
const { attachCurrentUserToPayload } = require("./rankingResponseAdapter");

const SUPPORTED_PEAK_DURATIONS = new Set([
  "tss",
  "1min",
  "5min",
  "10min",
  "20min",
  "40min",
  "60min",
  "max",
  "personal_dist",
  "personal_speed",
]);

/**
 * getPeakPowerRanking HTTP — Supabase 경로 가능 시 payload 반환, 아니면 null.
 * @param {import('firebase-admin')} admin
 * @param {object} query req.query
 * @param {object} deps getWeekRangeSeoul, getRolling28DaysRangeSeoul, getRolling30DaysRangeSeoul, buildMotivationMessage
 */
async function tryBuildPeakPowerRankingFromSupabase(admin, query, deps) {
  const durationType = query.duration || "5min";
  const gender = query.gender || "all";
  const uid = query.uid || null;

  if (!SUPPORTED_PEAK_DURATIONS.has(durationType)) {
    return null;
  }

  const route = await rankingReadConfig.shouldReadRankingFromSupabase(admin, uid);
  if (route.route !== "supabase") {
    return null;
  }

  try {
    let payload = null;
    const {
      getWeekRangeSeoul,
      getRolling28DaysRangeSeoul,
      getRolling30DaysRangeSeoul,
    } = deps;

    if (durationType === "tss") {
      const { startStr, endStr } = getWeekRangeSeoul();
      payload = await supabaseRankingReader.fetchWeeklyTssRanking(
        admin,
        startStr,
        endStr,
        gender
      );
    } else if (durationType === "personal_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      payload = await supabaseRankingReader.fetchPersonalDist(
        admin,
        startStr,
        endStr,
        gender
      );
    } else if (durationType === "personal_speed") {
      const { startStr, endStr } = getRolling28DaysRangeSeoul();
      payload = await supabaseRankingReader.fetchPersonalSpeed(
        admin,
        startStr,
        endStr,
        gender
      );
    } else {
      const { startStr, endStr } = getRolling28DaysRangeSeoul();
      payload = await supabaseRankingReader.fetchPeakPowerMonthly(
        admin,
        startStr,
        endStr,
        durationType,
        gender
      );
    }

    if (!payload) return null;

    attachCurrentUserToPayload(payload, uid, deps.buildMotivationMessage);
    console.log("[rankingReadRouter] Supabase read", {
      durationType,
      gender,
      uid: uid || "(anonymous)",
      reason: route.reason,
      entries: (payload.entries || []).length,
    });
    return payload;
  } catch (err) {
    console.error(
      "[rankingReadRouter] Supabase read failed — Firebase fallback:",
      err && err.message ? err.message : err
    );
    return null;
  }
}

/**
 * getWeeklyRanking HTTP — Supabase TOP10 응답 또는 null.
 */
async function tryBuildWeeklyRankingFromSupabase(admin, query, deps) {
  const userIdParam = (query && query.userId) || "";
  const route = await rankingReadConfig.shouldReadRankingFromSupabase(
    admin,
    userIdParam
  );
  if (route.route !== "supabase") {
    return null;
  }

  try {
    const { getWeekRangeSeoul } = deps;
    const usePrevWeek = query.week === "prev";
    const { startStr, endStr } = usePrevWeek
      ? getWeekRangeSeoul(-1)
      : getWeekRangeSeoul();

    const tssPayload = await supabaseRankingReader.fetchWeeklyTssRanking(
      admin,
      startStr,
      endStr,
      "all"
    );
    const entries = tssPayload.entries || [];

    const top10 = entries.slice(0, 10).map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      name: e.name,
      totalTss: e.totalTss,
      is_private: e.is_private === true,
      profileImageUrl: e.profileImageUrl || null,
    }));

    let myRank;
    if (userIdParam) {
      const userIdx = entries.findIndex((e) => e.userId === userIdParam);
      const e = entries[userIdx];
      if (e && userIdx >= 10) {
        myRank = {
          rank: userIdx + 1,
          userId: e.userId,
          name: e.name,
          totalTss: e.totalTss,
          is_private: e.is_private === true,
          profileImageUrl: e.profileImageUrl || null,
        };
      }
    }

    console.log("[rankingReadRouter] getWeeklyRanking Supabase", {
      reason: route.reason,
      entries: entries.length,
    });

    return {
      success: true,
      ranking: top10,
      startStr,
      endStr,
      myRank: myRank || undefined,
      precomputed: true,
      readSource: "supabase",
      allEntries: entries,
    };
  } catch (err) {
    console.error(
      "[rankingReadRouter] weekly Supabase failed:",
      err && err.message ? err.message : err
    );
    return null;
  }
}

module.exports = {
  tryBuildPeakPowerRankingFromSupabase,
  tryBuildWeeklyRankingFromSupabase,
  SUPPORTED_PEAK_DURATIONS,
};
