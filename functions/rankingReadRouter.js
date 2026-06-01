/**
 * Canary Read Router — 랭킹 HTTP 응답을 Supabase MV 또는 Firebase 로 분기.
 */
const rankingReadConfig = require("./rankingReadConfig");
const supabaseRankingReader = require("./supabaseRankingReader");
const rankingParity = require("./rankingParity");
const peakMovement = require("./rankingPeakMovement");
const peakMovementSupabase = require("./rankingPeakMovementSupabase");
const { attachCurrentUserToPayload } = require("./rankingResponseAdapter");

const SUPPORTED_PEAK_DURATIONS = new Set([
  "gc",
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
  "group_dist",
]);

const RANKING_BOARD_CATEGORIES = [
  "Supremo",
  "Assoluto",
  "Bianco",
  "Rosa",
  "Infinito",
  "Leggenda",
];

function emptyPeakRankingByCategory() {
  return {
    Supremo: [],
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };
}

/**
 * Supabase Read 모드에서 Firebase 폴백 대신 반환 — heptagon_cohort_ranks·ranking_aggregates 대량 Read 방지.
 */
function buildSupabaseRankingPendingPayload(durationType, gender, reason, deps) {
  const out = {
    success: true,
    byCategory: emptyPeakRankingByCategory(),
    entries: [],
    durationType,
    gender: gender || "all",
    pendingAggregate: true,
    readBackend: "supabase",
    readSource: "supabase",
    supabaseReadBlockedFirebaseFallback: true,
    message:
      reason === "empty"
        ? "Supabase 랭킹 집계가 비어 있습니다. pg_cron·헵타곤 재빌드를 확인해 주세요."
        : "Supabase 랭킹 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    supabasePendingReason: reason || "unknown",
  };
  if (durationType === "gc") {
    out.period = "monthly";
    out.gcMonthKey = supabaseRankingReader.getMonthKeyKstNow();
    if (deps && typeof deps.getRolling28DaysRangeSeoul === "function") {
      const r = deps.getRolling28DaysRangeSeoul();
      out.startStr = r.startStr;
      out.endStr = r.endStr;
    }
  } else if (durationType === "tss") {
    out.period = "weekly";
    if (deps && typeof deps.getWeekRangeSeoul === "function") {
      const w = deps.getWeekRangeSeoul();
      out.startStr = w.startStr;
      out.endStr = w.endStr;
    }
  }
  return out;
}

function payloadHasVisibleRankingRows(payload) {
  if (!payload || !payload.byCategory) return false;
  for (let i = 0; i < RANKING_BOARD_CATEGORIES.length; i++) {
    const rows = payload.byCategory[RANKING_BOARD_CATEGORIES[i]];
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

/** Supabase 주간 TSS — 이번 주 비어 있으면 TOP10·TSS 탭 공통으로 전주 fallback */
async function fetchSupabaseWeeklyTssWithPrevFallback(admin, startStr, endStr, gender, getWeekRangeSeoul) {
  let payload = await supabaseRankingReader.fetchWeeklyTssRanking(admin, startStr, endStr, gender);
  if (!payload || !Array.isArray(payload.entries)) return payload;
  if (payload.entries.length > 0) return payload;
  const prevRange = getWeekRangeSeoul(-1);
  if (!prevRange || !prevRange.startStr || !prevRange.endStr) return payload;
  const prevPayload = await supabaseRankingReader.fetchWeeklyTssRanking(
    admin,
    prevRange.startStr,
    prevRange.endStr,
    gender
  );
  if (!prevPayload || !Array.isArray(prevPayload.entries) || prevPayload.entries.length === 0) {
    return payload;
  }
  prevPayload.prevWeekFallback = true;
  prevPayload.displayStartStr = prevRange.startStr;
  prevPayload.displayEndStr = prevRange.endStr;
  return prevPayload;
}

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
    if (!rankingReadConfig.safeIsFirebaseRankingReadAllowed()) {
      return buildSupabaseRankingPendingPayload(
        durationType,
        gender,
        "firebase_read_disabled",
        deps
      );
    }
    return null;
  }

  try {
    let payload = null;
    const {
      getWeekRangeSeoul,
      getRolling28DaysRangeSeoul,
      getRolling30DaysRangeSeoul,
    } = deps;

    if (durationType === "gc") {
      const monthKey = supabaseRankingReader.getMonthKeyKstNow();
      payload = await supabaseRankingReader.fetchGcRanking(admin, monthKey, gender, uid);
      if (payload) {
        await supabaseRankingReader.attachGcHeptagonMeta(admin, payload, {
          getMinHeptagonSnapshotAsOfSeoulYmd: deps.getMinHeptagonSnapshotAsOfSeoulYmd,
          getRolling28DaysRangeSeoul,
          RANKING_HEPTAGON_REBUILD_META_DOC: deps.RANKING_HEPTAGON_REBUILD_META_DOC,
        });
      }
    } else if (durationType === "tss") {
      const { startStr, endStr } = getWeekRangeSeoul();
      payload = await fetchSupabaseWeeklyTssWithPrevFallback(
        admin,
        startStr,
        endStr,
        gender,
        getWeekRangeSeoul
      );
      if (payload && payload.prevWeekFallback) {
        payload.startStr = payload.displayStartStr || payload.startStr;
        payload.endStr = payload.displayEndStr || payload.endStr;
      }
    } else if (durationType === "group_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      payload = await supabaseRankingReader.fetchGroupDistRanking(
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

    if (
      durationType === "group_dist" &&
      payload &&
      typeof deps.applyGroupRankingParticipationForViewer === "function"
    ) {
      await deps.applyGroupRankingParticipationForViewer(
        deps.db,
        payload.byCategory,
        payload.entries,
        payload.startStr,
        payload.endStr,
        uid
      );
      if (!payload.entries?.length && Array.isArray(payload.byCategory?.Supremo)) {
        payload.entries = payload.byCategory.Supremo.slice();
      }
    }

    /* GC: heptagon_cohort_ranks.rank_change — 그 외: Supabase peak_rank_board_snapshots (Firestore peak_rank_history 후순위) */
    if (durationType !== "gc" && payload && payload.byCategory) {
      const historyGender =
        payload.supabaseServedUnifiedAllView &&
        (gender === "M" || gender === "F")
          ? "all"
          : gender;
      const historyKey = peakMovement.resolvePeakRankHistoryKey(
        durationType,
        payload.period || query.period,
        historyGender
      );
      if (historyKey) {
        await peakMovementSupabase.hydratePeakRankMovementOnPayload(payload, historyKey, {
          admin,
        });
      }
    }

    if (!payloadHasVisibleRankingRows(payload)) {
      console.warn("[rankingReadRouter] Supabase empty rows — Firebase fallback blocked (read=supabase)", {
        durationType,
        gender,
      });
      return buildSupabaseRankingPendingPayload(durationType, gender, "empty", deps);
    }

    const cfg = rankingReadConfig.getRankingReadConfig();
    let parityReport = { ok: true, reason: "parity_skip_gc" };
    if (durationType !== "gc") {
      /* 비-GC M/F: Supabase는 all 통합 뷰만 제공 → parity·history도 all 집계와 비교 */
      const parityGender =
        payload.supabaseServedUnifiedAllView &&
        (gender === "M" || gender === "F")
          ? "all"
          : gender;
      const parityCtx = {
        durationType,
        gender: parityGender,
        startStr: payload.startStr,
        endStr: payload.endStr,
      };
      parityReport = await rankingParity.verifyPeakRankingParity(
        admin,
        deps.db,
        payload,
        parityCtx
      );
      payload.rankingParity = parityReport;

      if (cfg.parityFallbackToFirebase && parityReport && parityReport.ok === false) {
        if (!rankingReadConfig.safeIsFirebaseRankingReadAllowed()) {
          console.warn(
            "[rankingReadRouter] parity drift — Firebase fallback blocked, pending payload",
            { durationType, gender, mismatchCount: parityReport.mismatchCount }
          );
          return buildSupabaseRankingPendingPayload(
            durationType,
            gender,
            "parity_drift",
            deps
          );
        }
        console.warn("[rankingReadRouter] parity drift → Firebase fallback (parityFallbackToFirebase=true)", {
          durationType,
          gender,
          parityReport,
        });
        return null;
      }
      if (!cfg.parityFallbackToFirebase && parityReport && parityReport.ok === false) {
        console.warn("[rankingReadRouter] parity drift — serving Supabase anyway (no Firebase fallback)", {
          durationType,
          gender,
          mismatchCount: parityReport.mismatchCount,
        });
      }
    }

    attachCurrentUserToPayload(payload, uid, deps.buildMotivationMessage);
    payload.readBackend = "supabase";
    payload.readSource = "supabase";
    console.log("[rankingReadRouter] Supabase read", {
      durationType,
      gender,
      uid: uid || "(anonymous)",
      reason: route.reason,
      entries: (payload.entries || []).length,
      parityOk: parityReport && parityReport.ok,
    });
    return payload;
  } catch (err) {
    console.error(
      "[rankingReadRouter] Supabase read failed — Firebase fallback blocked:",
      err && err.message ? err.message : err
    );
    return buildSupabaseRankingPendingPayload(
      durationType,
      gender,
      "error",
      deps
    );
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
    if (!rankingReadConfig.safeIsFirebaseRankingReadAllowed()) {
      return {
        success: true,
        ranking: [],
        readBackend: "supabase",
        readSource: "supabase",
        pendingAggregate: true,
        supabaseReadBlockedFirebaseFallback: true,
        message: "Firebase 주간 랭킹 Read 비활성(Supabase 전용).",
      };
    }
    return null;
  }

  try {
    const { getWeekRangeSeoul } = deps;
    const usePrevWeek = query.week === "prev";
    const { startStr, endStr } = usePrevWeek
      ? getWeekRangeSeoul(-1)
      : getWeekRangeSeoul();

    const tssPayload = await fetchSupabaseWeeklyTssWithPrevFallback(
      admin,
      startStr,
      endStr,
      "all",
      getWeekRangeSeoul
    );
    if (!tssPayload || !Array.isArray(tssPayload.entries)) {
      return null;
    }
    const respStartStr =
      !usePrevWeek && tssPayload.prevWeekFallback && tssPayload.displayStartStr
        ? tssPayload.displayStartStr
        : startStr;
    const respEndStr =
      !usePrevWeek && tssPayload.prevWeekFallback && tssPayload.displayEndStr
        ? tssPayload.displayEndStr
        : endStr;
    if (tssPayload.entries.length > 0) {
      await peakMovementSupabase.hydratePeakRankMovementOnPayload(
        tssPayload,
        "peak_tss_weekly_all",
        { admin }
      );
    }
    const entries = tssPayload.entries || [];

    const top10 = entries.slice(0, 10).map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      name: e.name,
      totalTss: e.totalTss,
      rankChange: e.rankChange,
      previousBoardRank: e.previousBoardRank,
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
          rankChange: e.rankChange,
          previousBoardRank: e.previousBoardRank,
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
      startStr: respStartStr,
      endStr: respEndStr,
      myRank: myRank || undefined,
      precomputed: true,
      readSource: "supabase",
      readBackend: "supabase",
      rankMovementSource: tssPayload.rankMovementSource,
      rankMovementHistoryKey: tssPayload.rankMovementHistoryKey,
      currentWeekEmpty: !usePrevWeek && entries.length === 0,
      prevWeekFallback: !usePrevWeek && tssPayload.prevWeekFallback === true,
      displayStartStr: tssPayload.displayStartStr,
      displayEndStr: tssPayload.displayEndStr,
      supabaseWeeklyTssSource: tssPayload.supabaseWeeklyTssSource,
      allEntries: entries,
    };
  } catch (err) {
    console.error(
      "[rankingReadRouter] weekly Supabase failed:",
      err && err.message ? err.message : err
    );
    const { getWeekRangeSeoul } = deps || {};
    let startStr = "";
    let endStr = "";
    if (typeof getWeekRangeSeoul === "function") {
      try {
        const w = getWeekRangeSeoul();
        startStr = w.startStr;
        endStr = w.endStr;
      } catch (_) {
        /* ignore */
      }
    }
    return {
      success: true,
      ranking: [],
      startStr,
      endStr,
      readBackend: "supabase",
      readSource: "supabase",
      pendingAggregate: true,
      supabaseReadBlockedFirebaseFallback: true,
      supabasePendingReason: "error",
      message: "Supabase 주간 TSS 랭킹 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

module.exports = {
  tryBuildPeakPowerRankingFromSupabase,
  tryBuildWeeklyRankingFromSupabase,
  buildSupabaseRankingPendingPayload,
  emptyPeakRankingByCategory,
  SUPPORTED_PEAK_DURATIONS,
};
