/**
 * RUN 대시보드 — 90일 peak 페이스 기반 역치 페이스(10k) 유추 · RUN 로그 판별
 */
(function () {
  'use strict';

  var RUN_ACTIVITY_TYPES = { run: 1, trailrun: 1, virtualrun: 1 };

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
    parsePaceToSecPerKm: parsePaceToSecPerKm,
    formatPaceMinPerKm: formatPaceMinPerKm,
    computeThresholdPaceFromPeaks: computeThresholdPaceFromPeaks,
    findLeaderboardRowForUser: findLeaderboardRowForUser,
    isRunTrainingLog: isRunTrainingLog
  };
  window.isRunTrainingLog = isRunTrainingLog;
})();
