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
      var missing = isMissingPaceValue(pace) || penalized;
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
   * 역치 페이스(초/km) 기반 VO2max 추정 (러닝, ml/kg/min)
   * 임계 페이스 ≈ VO2max의 88% 가정
   */
  function computeRunVo2maxFromThresholdPace(secPerKm) {
    var sec = Number(secPerKm);
    if (!isFinite(sec) || sec <= 0) return 40;
    var vMmin = 60000 / sec;
    var vo2AtThreshold = 3.5 + 0.2 * vMmin;
    return Math.max(20, Math.min(85, Math.round(vo2AtThreshold / 0.88)));
  }

  async function fetchRunLeaderboardCoachContext(userId) {
    var empty = {
      thresholdPace: computeThresholdPaceFromPeaks(null),
      hexagonContext: extractHexagonPaceContext(null),
      leaderboardRow: null
    };
    if (!userId || !window.runningRankingApi || typeof window.runningRankingApi.fetchLeaderboard !== 'function') {
      return empty;
    }
    try {
      var lb = await window.runningRankingApi.fetchLeaderboard();
      if (!lb || !lb.success || !Array.isArray(lb.rows)) return empty;
      var row = findLeaderboardRowForUser(lb.rows, userId);
      if (!row) return empty;
      return {
        thresholdPace: computeThresholdPaceFromPeaks(row.peak_performances),
        hexagonContext: extractHexagonPaceContext(row),
        leaderboardRow: row
      };
    } catch (e) {
      console.warn('[runDashboardPace] fetchRunLeaderboardCoachContext failed:', e);
      return empty;
    }
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
    return min + ':' + (sec < 10 ? '0' : '') + sec + ' min/1km';
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
      return {
        secPerKm: sec10k,
        display: formatPaceMinPerKm(sec10k),
        inferred: false,
        inferredFrom: '10k',
        unavailable: false
      };
    }
    var sec5k = getPaceSecFromPeakSegment(pp['5k']);
    if (sec5k != null) {
      var from5k = sec5k + 15;
      return {
        secPerKm: from5k,
        display: formatPaceMinPerKm(from5k),
        inferred: true,
        inferredFrom: '5k',
        unavailable: false
      };
    }
    var sec3k = getPaceSecFromPeakSegment(pp['3k']);
    if (sec3k != null) {
      var from3k = sec3k + 35;
      return {
        secPerKm: from3k,
        display: formatPaceMinPerKm(from3k),
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
    computeThresholdPaceFromPeaks: computeThresholdPaceFromPeaks,
    extractHexagonPaceContext: extractHexagonPaceContext,
    computeRunVo2maxFromThresholdPace: computeRunVo2maxFromThresholdPace,
    fetchRunLeaderboardCoachContext: fetchRunLeaderboardCoachContext,
    findLeaderboardRowForUser: findLeaderboardRowForUser,
    isRunTrainingLog: isRunTrainingLog
  };
  window.isRunTrainingLog = isRunTrainingLog;
})();
