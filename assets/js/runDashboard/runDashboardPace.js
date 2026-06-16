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

  function getPaceSecFromPeakSegment(seg) {
    if (!seg || typeof seg !== 'object') return null;
    var paceStr = seg.pace || seg.calculated_pace || '';
    var sec = parsePaceToSecPerKm(paceStr);
    return sec != null && sec > 0 ? sec : null;
  }

  /**
   * 최근 90일 peak_performances → 역치 페이스(10k 표기)
   * 10k 없으면 5k+15초, 3k만 있으면 3k+35초
   * @param {object} peakPerformances
   * @returns {{ secPerKm: number|null, display: string|null, inferred: boolean, inferredFrom: string|null, unavailable: boolean }}
   */
  function computeThresholdPaceFromPeaks(peakPerformances) {
    var pp = peakPerformances || {};
    var sec10k = getPaceSecFromPeakSegment(pp['10k']);
    if (sec10k != null) {
      var parts10k = formatPaceDisplayParts(sec10k);
      return {
        secPerKm: sec10k,
        display: parts10k.display,
        paceValue: parts10k.value,
        paceUnit: parts10k.unit,
        inferred: false,
        inferredFrom: '10k',
        unavailable: false
      };
    }
    var sec5k = getPaceSecFromPeakSegment(pp['5k']);
    if (sec5k != null) {
      var from5k = sec5k + 15;
      var parts5k = formatPaceDisplayParts(from5k);
      return {
        secPerKm: from5k,
        display: parts5k.display,
        paceValue: parts5k.value,
        paceUnit: parts5k.unit,
        inferred: true,
        inferredFrom: '5k',
        unavailable: false
      };
    }
    var sec3k = getPaceSecFromPeakSegment(pp['3k']);
    if (sec3k != null) {
      var from3k = sec3k + 35;
      var parts3k = formatPaceDisplayParts(from3k);
      return {
        secPerKm: from3k,
        display: parts3k.display,
        paceValue: parts3k.value,
        paceUnit: parts3k.unit,
        inferred: true,
        inferredFrom: '3k',
        unavailable: false
      };
    }
    return {
      secPerKm: null,
      display: null,
      inferred: false,
      inferredFrom: null,
      unavailable: true
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
    parsePaceToSecPerKm: parsePaceToSecPerKm,
    formatPaceMinPerKm: formatPaceMinPerKm,
    formatPaceDisplayParts: formatPaceDisplayParts,
    computeThresholdPaceFromPeaks: computeThresholdPaceFromPeaks,
    extractHexagonPaceContext: extractHexagonPaceContext,
    computeRunVo2maxFromThresholdPace: computeRunVo2maxFromThresholdPace,
    fetchRunLeaderboardCoachContext: fetchRunLeaderboardCoachContext,
    findLeaderboardRowForUser: findLeaderboardRowForUser,
    isRunTrainingLog: isRunTrainingLog
  };
  window.isRunTrainingLog = isRunTrainingLog;
})();
