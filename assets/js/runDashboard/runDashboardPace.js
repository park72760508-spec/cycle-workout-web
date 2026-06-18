/**
 * RUN 대시보드 — 90일 peak 페이스 기반 역치 페이스(10k) 유추 · RUN 로그 판별
 */
(function () {
  'use strict';

  var RUN_ACTIVITY_TYPES = { run: 1, trailrun: 1, virtualrun: 1 };
  var HEXAGON_AXES = ['1k', '3k', '5k', '7k', '10k', '20k'];

  function isMissingPaceValue(paceStr) {
    if (paceStr == null) return true;
    var s = String(paceStr).trim();
    return !s || s === '—' || s === '-' || s === 'null';
  }

  /**
   * 90일 랭킹 row → 6축 헥사곤 페이스 컨텍스트 (AI·규칙 엔진용)
   * @returns {{ hexagon: object, missingAxes: string[] }}
   */
  function extractHexagonPaceContext(leaderboardRow) {
    var peaks = leaderboardRow && leaderboardRow.peak_performances;
    var penalties = leaderboardRow && leaderboardRow.segment_penalties;
    var hexagon = {};
    var missingAxes = [];
    HEXAGON_AXES.forEach(function (key) {
      var seg = peaks && peaks[key];
      var pace = seg && (seg.pace || seg.calculated_pace);
      var penalized = !!(penalties && penalties[key]) || !!(seg && seg.is_penalty_applied);
      var missing = isMissingPaceValue(pace);
      hexagon[key] = {
        pace: isMissingPaceValue(pace) ? null : String(pace),
        calculated_pace: isMissingPaceValue(pace) ? null : String(pace),
        is_penalty_applied: penalized,
        missing: missing
      };
      if (missing) missingAxes.push(key);
    });
    return { hexagon: hexagon, missingAxes: missingAxes };
  }

  /**
   * 역치 페이스(초/km) 기반 VO2max 추정 — runVo2maxCalculator 위임
   */
  function computeRunVo2maxFromThresholdPace(secPerKm) {
    if (typeof window.vo2maxFromRunThresholdPaceSec === 'function') {
      var v = window.vo2maxFromRunThresholdPaceSec(secPerKm);
      return v != null ? Math.max(20, Math.min(85, Math.round(v))) : 40;
    }
    var sec = Number(secPerKm);
    if (!isFinite(sec) || sec <= 0) return 40;
    var vMmin = 60000 / sec;
    var vo2AtThreshold = -4.6 + 0.182258 * vMmin + 0.000104 * vMmin * vMmin;
    return Math.max(20, Math.min(85, Math.round(vo2AtThreshold / 0.86)));
  }

  function hexagonMissingCount(hexCtx) {
    return hexCtx && hexCtx.missingAxes ? hexCtx.missingAxes.length : HEXAGON_AXES.length;
  }

  function buildHexagonFromPeakMap(peakMap, penalties) {
    return extractHexagonPaceContext({
      peak_performances: peakMap || null,
      segment_penalties: penalties || null,
    });
  }

  function pickBetterHexagonContext(ctxA, ctxB) {
    if (!ctxA || !ctxA.hexagon) return ctxB || ctxA;
    if (!ctxB || !ctxB.hexagon) return ctxA;
    return hexagonMissingCount(ctxA) <= hexagonMissingCount(ctxB) ? ctxA : ctxB;
  }

  async function fetchSupabaseHexagonCoachContext(userId) {
    if (!userId || typeof window.getUserRunEfforts !== 'function') return null;
    if (typeof window.buildPeakPerformancesFromRunEfforts !== 'function') return null;
    try {
      var efforts = await window.getUserRunEfforts(userId, { limit: 600 });
      if (!efforts || !efforts.length) return null;
      var peaks = window.buildPeakPerformancesFromRunEfforts(efforts);
      return {
        peakMap: peaks,
        hexagonContext: buildHexagonFromPeakMap(peaks, null),
        source: 'supabase_efforts',
      };
    } catch (eSup) {
      console.warn('[runDashboardPace] Supabase efforts hexagon fallback failed:', eSup);
      return null;
    }
  }

  async function fetchRunLeaderboardCoachContext(userId) {
    var bestPeaks = null;
    var bestHex = extractHexagonPaceContext(null);
    var leaderboardRow = null;

    if (userId && window.runningRankingApi && typeof window.runningRankingApi.fetchLeaderboard === 'function') {
      try {
        var lb = await window.runningRankingApi.fetchLeaderboard();
        if (lb && lb.success && Array.isArray(lb.rows)) {
          leaderboardRow = findLeaderboardRowForUser(lb.rows, userId);
          if (leaderboardRow) {
            var peakCtx = buildHexagonFromPeakMap(
              leaderboardRow.peak_performances,
              leaderboardRow.segment_penalties
            );
            var profileCtx = leaderboardRow.profile_peak_performances
              ? buildHexagonFromPeakMap(leaderboardRow.profile_peak_performances, null)
              : null;
            bestHex = profileCtx ? pickBetterHexagonContext(peakCtx, profileCtx) : peakCtx;
            bestPeaks =
              profileCtx && hexagonMissingCount(profileCtx) < hexagonMissingCount(peakCtx)
                ? leaderboardRow.profile_peak_performances
                : leaderboardRow.peak_performances;
          }
        }
      } catch (eLb) {
        console.warn('[runDashboardPace] fetchRunLeaderboardCoachContext leaderboard failed:', eLb);
      }
    }

    if (userId) {
      var supa = await fetchSupabaseHexagonCoachContext(userId);
      if (supa && supa.peakMap) {
        var mergedPeaks = Object.assign({}, supa.peakMap, bestPeaks || {});
        HEXAGON_AXES.forEach(function (axis) {
          var fromLb = bestPeaks && bestPeaks[axis];
          var lbPace = fromLb && (fromLb.pace || fromLb.calculated_pace);
          if (!isMissingPaceValue(lbPace)) {
            mergedPeaks[axis] = fromLb;
          } else if (supa.peakMap[axis]) {
            mergedPeaks[axis] = supa.peakMap[axis];
          }
        });
        bestPeaks = mergedPeaks;
        bestHex = buildHexagonFromPeakMap(mergedPeaks, null);
      }
    }

    return {
      thresholdPace: computeThresholdPaceFromPeaks(bestPeaks),
      hexagonContext: bestHex,
      leaderboardRow: leaderboardRow,
    };
  }

  function parsePaceToSecPerKm(paceStr) {
    if (window.runningRankingFormat && typeof window.runningRankingFormat.parsePaceToSecPerKm === 'function') {
      return window.runningRankingFormat.parsePaceToSecPerKm(paceStr);
    }
    if (paceStr == null || paceStr === '' || paceStr === '—' || paceStr === '-') return null;
    var s = String(paceStr).trim();
    var m = s.match(/^(\d+)[':](\d{1,2})"?$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    var m2 = s.match(/^(\d+):(\d{2})$/);
    if (m2) return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);
    return null;
  }

  function formatPaceMinPerKm(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return null;
    var min = Math.floor(secPerKm / 60);
    var sec = Math.round(secPerKm % 60);
    if (sec === 60) { min += 1; sec = 0; }
    return min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function formatPaceDisplayParts(secPerKm) {
    var value = formatPaceMinPerKm(secPerKm);
    if (!value) return { value: null, unit: 'min/km', display: null };
    return { value: value, unit: 'min/km', display: value };
  }

  var RIEGEL_FATIGUE = 1.06;
  var INFER_WEIGHTS = { '7k': 0.5, '5k': 0.35, '3k': 0.15 };
  var INFER_DIST_KM = { '7k': 7, '5k': 5, '3k': 3 };

  /** STELVIO 헥사곤 등급표 — 10k 페이스(min/km) 기준 7단계 */
  var RUN_HEXAGON_PACE_TIER_CUTOFFS = [
    { tierId: 'HC', key: 'hc', label: '레벨A', levelName: '레벨A', badgeSrc: 'assets/img/A.svg', maxSecPerKm: 240 },
    { tierId: 'C1', key: 'c1', label: '레벨B', levelName: '레벨B', badgeSrc: 'assets/img/B.svg', maxSecPerKm: 270 },
    { tierId: 'C2', key: 'c2', label: '레벨C', levelName: '레벨C', badgeSrc: 'assets/img/C.svg', maxSecPerKm: 300 },
    { tierId: 'C3', key: 'c3', label: '레벨D', levelName: '레벨D', badgeSrc: 'assets/img/D.svg', maxSecPerKm: 360 },
    { tierId: 'C4', key: 'c4', label: '레벨E', levelName: '레벨E', badgeSrc: 'assets/img/E.svg', maxSecPerKm: 420 },
    { tierId: 'C5', key: 'c5', label: '레벨F', levelName: '레벨F', badgeSrc: 'assets/img/F.svg', maxSecPerKm: 480 },
    { tierId: 'C6', key: 'c6', label: '레벨G', levelName: '레벨G', badgeSrc: 'assets/img/G.svg', maxSecPerKm: Infinity }
  ];

  /**
   * 10k 페이스(초/km) → STELVIO 헥사곤 등급 (빠를수록 상위)
   * @param {number|null} secPerKm
   * @returns {{ tierId: string, key: string, label: string, levelName: string, badgeSrc: string }|null}
   */
  function getRunHexagonTierFromPaceSec(secPerKm) {
    var sec = Number(secPerKm);
    if (!isFinite(sec) || sec <= 0) return null;
    for (var i = 0; i < RUN_HEXAGON_PACE_TIER_CUTOFFS.length; i++) {
      var row = RUN_HEXAGON_PACE_TIER_CUTOFFS[i];
      if (sec <= row.maxSecPerKm) {
        return {
          tierId: row.tierId,
          key: row.key,
          label: row.label,
          levelName: row.levelName,
          badgeSrc: row.badgeSrc
        };
      }
    }
    var last = RUN_HEXAGON_PACE_TIER_CUTOFFS[RUN_HEXAGON_PACE_TIER_CUTOFFS.length - 1];
    return {
      tierId: last.tierId,
      key: last.key,
      label: last.label,
      levelName: last.levelName,
      badgeSrc: last.badgeSrc
    };
  }

  /** 피터 리겔: T2 = T1 × (D2/D1)^1.06 */
  function riegelPredictTotalSec(timeSec, fromDistKm, toDistKm) {
    if (!isFinite(timeSec) || timeSec <= 0 || !fromDistKm || !toDistKm) return null;
    return timeSec * Math.pow(toDistKm / fromDistKm, RIEGEL_FATIGUE);
  }

  /**
   * 3k/5k/7k 페이스 → 리겔 예측 + 가중치(7k 50%, 5k 35%, 3k 15%) 합산 10k 페이스
   * @returns {{ secPerKm: number, inferredFrom: string, weightsUsed: object[] }|null}
   */
  function infer10kPaceSecWeightedFromShorterDistances(peakPerformances) {
    var pp = peakPerformances || {};
    var parts = [];
    ['7k', '5k', '3k'].forEach(function(distKey) {
      var paceSec = getPaceSecFromPeakSegment(pp[distKey]);
      var distKm = INFER_DIST_KM[distKey];
      if (paceSec == null || !distKm) return;
      var totalSec = paceSec * distKm;
      var predicted10kSec = riegelPredictTotalSec(totalSec, distKm, 10);
      if (predicted10kSec == null || !isFinite(predicted10kSec) || predicted10kSec <= 0) return;
      parts.push({
        dist: distKey,
        weight: INFER_WEIGHTS[distKey],
        predicted10kSec: predicted10kSec
      });
    });
    if (!parts.length) return null;
    var weightSum = parts.reduce(function(s, p) { return s + p.weight; }, 0);
    var t10 = parts.reduce(function(s, p) {
      return s + p.predicted10kSec * (p.weight / weightSum);
    }, 0);
    return {
      secPerKm: t10 / 10,
      inferredFrom: parts.map(function(p) { return p.dist; }).join('+'),
      weightsUsed: parts
    };
  }

  function buildPaceResult(secPerKm, opts) {
    var o = opts || {};
    var parts = formatPaceDisplayParts(secPerKm);
    var tier = getRunHexagonTierFromPaceSec(secPerKm);
    return {
      secPerKm: secPerKm,
      display: parts.display,
      paceValue: parts.value,
      paceUnit: parts.unit,
      inferred: !!o.inferred,
      inferredFrom: o.inferredFrom || null,
      unavailable: false,
      hexagonTier: tier
    };
  }

  function getPaceSecFromPeakSegment(seg) {
    if (!seg || typeof seg !== 'object') return null;
    var paceStr = seg.pace || seg.calculated_pace || '';
    var sec = parsePaceToSecPerKm(paceStr);
    return sec != null && sec > 0 ? sec : null;
  }

  /**
   * 최근 90일 peak_performances → 역치 페이스(10k 표기)
   * 10k 직접 기록 우선, 없으면 7k·5k·3k 리겔 예측 + 가중치(50/35/15%) 합산
   * @param {object} peakPerformances
   * @returns {{ secPerKm: number|null, display: string|null, inferred: boolean, inferredFrom: string|null, unavailable: boolean, hexagonTier: object|null }}
   */
  function computeThresholdPaceFromPeaks(peakPerformances) {
    var pp = peakPerformances || {};
    var sec10k = getPaceSecFromPeakSegment(pp['10k']);
    if (sec10k != null) {
      return buildPaceResult(sec10k, { inferred: false, inferredFrom: '10k' });
    }
    var weighted = infer10kPaceSecWeightedFromShorterDistances(pp);
    if (weighted && weighted.secPerKm != null) {
      return buildPaceResult(weighted.secPerKm, {
        inferred: true,
        inferredFrom: weighted.inferredFrom
      });
    }
    return {
      secPerKm: null,
      display: null,
      paceValue: null,
      paceUnit: 'min/km',
      inferred: false,
      inferredFrom: null,
      unavailable: true,
      hexagonTier: null
    };
  }

  function findLeaderboardRowForUser(rows, userId) {
    if (!rows || !userId) return null;
    var uid = String(userId);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ui = r && r.user_info;
      if (!ui) continue;
      if (String(ui.user_id || '') === uid || String(ui.firebase_uid || '') === uid) return r;
    }
    return null;
  }

  function isRunTrainingLog(log) {
    if (!log) return false;
    var type = String(log.activity_type || '').trim().toLowerCase();
    if (type && RUN_ACTIVITY_TYPES[type]) return true;
    return false;
  }

  window.runDashboardPace = {
    HEXAGON_AXES: HEXAGON_AXES,
    RIEGEL_FATIGUE: RIEGEL_FATIGUE,
    RUN_HEXAGON_PACE_TIER_CUTOFFS: RUN_HEXAGON_PACE_TIER_CUTOFFS,
    parsePaceToSecPerKm: parsePaceToSecPerKm,
    formatPaceMinPerKm: formatPaceMinPerKm,
    formatPaceDisplayParts: formatPaceDisplayParts,
    getRunHexagonTierFromPaceSec: getRunHexagonTierFromPaceSec,
    riegelPredictTotalSec: riegelPredictTotalSec,
    infer10kPaceSecWeightedFromShorterDistances: infer10kPaceSecWeightedFromShorterDistances,
    computeThresholdPaceFromPeaks: computeThresholdPaceFromPeaks,
    extractHexagonPaceContext: extractHexagonPaceContext,
    computeRunVo2maxFromThresholdPace: computeRunVo2maxFromThresholdPace,
    fetchRunLeaderboardCoachContext: fetchRunLeaderboardCoachContext,
    findLeaderboardRowForUser: findLeaderboardRowForUser,
    isRunTrainingLog: isRunTrainingLog
  };
  window.isRunTrainingLog = isRunTrainingLog;
})();
