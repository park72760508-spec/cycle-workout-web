/**
 * Firebase ranking_aggregates vs Supabase MV 정합성 — 화면 전환 전 검증·자동 Firebase 폴백.
 */
const supabaseRankingReader = require("./supabaseRankingReader");

function nearlyEqual(a, b, eps) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function topByKey(rows, key, n) {
  return (rows || [])
    .slice()
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, n);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function loadFirebaseAggregateSupremo(db, cacheKey) {
  const snap = await db.collection("ranking_aggregates").doc(cacheKey).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const rows = data.byCategory?.Supremo || data.entries || [];
  return { cacheKey, rows, startStr: data.startStr, endStr: data.endStr };
}

/**
 * @param {object} supabasePayload getPeakPowerRanking 형식
 * @param {object} fbAgg { rows, cacheKey }
 * @param {string} valueKey wkg | totalTss | totalKm | speedKmh
 * @param {number} sample
 */
function compareSupremoTop(supabasePayload, fbAgg, valueKey, sample, eps) {
  if (!supabasePayload) {
    return {
      ok: false,
      reason: "missing_supabase_payload",
      cacheKey: fbAgg && fbAgg.cacheKey,
      compared: 0,
      mismatches: [],
    };
  }
  if (!fbAgg || !fbAgg.rows || !fbAgg.rows.length) {
    return {
      ok: true,
      reason: "firebase_baseline_retired",
      cacheKey: fbAgg && fbAgg.cacheKey,
      compared: 0,
      mismatches: [],
    };
  }
  const sbRows = supabasePayload.entries || supabasePayload.byCategory?.Supremo || [];
  const fbTop = topByKey(fbAgg.rows, valueKey, sample);
  const sbMap = new Map(sbRows.map((e) => [e.userId, e]));
  const mismatches = [];

  for (let i = 0; i < fbTop.length; i++) {
    const fb = fbTop[i];
    const sb = sbMap.get(fb.userId);
    if (!sb) {
      mismatches.push({
        rank: i + 1,
        userId: fb.userId,
        issue: "missing_in_supabase",
        fb: fb[valueKey],
      });
      continue;
    }
    if (!nearlyEqual(fb[valueKey], sb[valueKey], eps)) {
      mismatches.push({
        rank: i + 1,
        userId: fb.userId,
        fb: fb[valueKey],
        sb: sb[valueKey],
        delta: Number(fb[valueKey]) - Number(sb[valueKey]),
      });
    }
    if (sb.rank != null && fb.rank != null && sb.rank !== fb.rank) {
      mismatches.push({
        rank: i + 1,
        userId: fb.userId,
        issue: "board_rank_delta",
        fbRank: fb.rank,
        sbRank: sb.rank,
      });
    }
  }

  const compared = fbTop.length;
  const driftRate = compared > 0 ? mismatches.length / compared : 1;
  const ok = driftRate <= 0.15;

  return {
    ok,
    reason: ok ? "within_tolerance" : "drift_exceeds_15pct",
    cacheKey: fbAgg.cacheKey,
    compared,
    mismatchCount: mismatches.length,
    driftRate: Math.round(driftRate * 1000) / 1000,
    mismatches: mismatches.slice(0, 15),
  };
}

/**
 * Supabase 응답이 Firebase 집계와 충분히 일치하는지 검사.
 * 불일치 시 null 반환 → index.js 가 Firebase 경로로 폴백(화면 동일성).
 */
async function verifyPeakRankingParity(admin, db, supabasePayload, ctx) {
  const { durationType, gender, startStr, endStr } = ctx;
  let cacheKey;
  let valueKey;
  let eps;

  if (durationType === "tss") {
    cacheKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${endStr}`;
    valueKey = "totalTss";
    eps = 0.05;
  } else if (durationType === "personal_dist") {
    cacheKey = `peakRanking_personal_dist_30d_${gender}_${startStr}_${endStr}`;
    valueKey = "totalKm";
    eps = 0.05;
  } else if (durationType === "personal_speed") {
    cacheKey = `peakRanking_personal_speed_28d_${gender}_${startStr}_${endStr}`;
    valueKey = "speedKmh";
    eps = 0.05;
  } else if (durationType === "group_dist") {
    cacheKey = `peakRanking_group_dist_30d_${startStr}_${endStr}`;
    valueKey = "totalKm";
    eps = 0.05;
  } else if (
    ["1min", "5min", "10min", "20min", "40min", "60min", "max"].includes(durationType)
  ) {
    cacheKey = `peakRanking_v2_monthly_${durationType}_${gender}_${startStr}_${endStr}`;
    valueKey = "wkg";
    eps = 0.02;
  } else {
    return { ok: true, reason: "parity_skip_unsupported_duration" };
  }

  const fbAgg = await loadFirebaseAggregateSupremo(db, cacheKey);
  return compareSupremoTop(supabasePayload, fbAgg, valueKey, 30, eps);
}

/**
 * 야간 정합성 리포트 (scheduledRankingParityAudit).
 */
async function runNightlyParityAudit(admin, db, deps) {
  const { getWeekRangeSeoul, getRolling28DaysRangeSeoul, getRolling90DaysRangeSeoul } = deps;
  const getPeakWindow =
    typeof getRolling90DaysRangeSeoul === "function"
      ? getRolling90DaysRangeSeoul
      : getRolling28DaysRangeSeoul;
  const reports = [];

  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  try {
    const sbTss = await supabaseRankingReader.fetchWeeklyTssRanking(
      admin,
      wStart,
      wEnd,
      "all"
    );
    reports.push({
      board: "weekly_tss",
      ...(await verifyPeakRankingParity(admin, db, sbTss, {
        durationType: "tss",
        gender: "all",
        startStr: wStart,
        endStr: wEnd,
      })),
    });
  } catch (e) {
    reports.push({ board: "weekly_tss", ok: false, error: e.message });
  }

  const { startStr: rPeakS, endStr: rPeakE } = getPeakWindow();
  try {
    const sb60 = await supabaseRankingReader.fetchPeakPowerMonthly(
      admin,
      rPeakS,
      rPeakE,
      "60min",
      "all"
    );
    reports.push({
      board: "peak_60min",
      ...(await verifyPeakRankingParity(admin, db, sb60, {
        durationType: "60min",
        gender: "all",
        startStr: rPeakS,
        endStr: rPeakE,
      })),
    });
  } catch (e) {
    reports.push({ board: "peak_60min", ok: false, error: e.message });
  }

  const allOk = reports.every((r) => r.ok !== false);
  const summary = {
    dateKst: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    allOk,
    reports,
    checkedAt: new Date().toISOString(),
  };

  await db.collection("ranking_meta").doc("supabase_parity_audit").set(summary, {
    merge: true,
  });

  console.log("[rankingParity] nightly audit", JSON.stringify(summary));
  return summary;
}

module.exports = {
  verifyPeakRankingParity,
  runNightlyParityAudit,
  compareSupremoTop,
};
