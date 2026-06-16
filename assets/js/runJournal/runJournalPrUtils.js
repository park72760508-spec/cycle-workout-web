/**
 * RUN 일지 — 1k~42k 페이스 PR 판정 (연간 best speed 기준)
 */
(function () {
  'use strict';

  var PACE_AXES = ['1k', '3k', '5k', '7k', '10k', '20k', '42k'];
  var PR_BADGE_BG = '#dc2626';

  function speedMsToPaceSec(speed) {
    var sp = Number(speed);
    if (!isFinite(sp) || sp <= 0) return null;
    return 1000 / sp;
  }

  function formatPaceFromSpeed(speed) {
    var sec = speedMsToPaceSec(speed);
    if (sec == null) return '—';
    if (window.runningRankingFormat && typeof window.runningRankingFormat.formatPaceSecPerKm === 'function') {
      return window.runningRankingFormat.formatPaceSecPerKm(sec);
    }
    var m = Math.floor(sec / 60);
    var s = Math.round(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s + '/km';
  }

  function formatSpeedKmhFromMs(speedMs) {
    var sp = Number(speedMs);
    if (!isFinite(sp) || sp <= 0) return null;
    return Math.round(sp * 3.6) + 'km/h';
  }

  function formatPaceWithSpeed(speedMs) {
    var pace = formatPaceFromSpeed(speedMs);
    var kmh = formatSpeedKmhFromMs(speedMs);
    if (pace === '—' || !kmh) return pace;
    return pace + '(' + kmh + ')';
  }

  function effortSpeed(effort, axis) {
    if (!effort) return null;
    var v = Number(effort['speed_' + axis]);
    return isFinite(v) && v > 0 ? v : null;
  }

  /**
   * @param {object[]} efforts
   * @param {number|string} year
   * @returns {Record<string, { speed: number, activity_id: string, activity_date: string }>}
   */
  function buildYearlyPacePrByAxis(efforts, year) {
    var y = String(year);
    var best = {};
    PACE_AXES.forEach(function (axis) {
      best[axis] = null;
    });
    (efforts || []).forEach(function (e) {
      var actDate = e.activity_date ? String(e.activity_date).slice(0, 10) : '';
      if (!actDate || actDate.slice(0, 4) !== y) return;
      PACE_AXES.forEach(function (axis) {
        var sp = effortSpeed(e, axis);
        if (sp == null) return;
        if (!best[axis] || sp > best[axis].speed) {
          best[axis] = {
            speed: sp,
            activity_id: String(e.activity_id || ''),
            activity_date: actDate,
          };
        }
      });
    });
    return best;
  }

  function isAxisPrForEffort(effort, axis, yearlyBest) {
    if (!effort || !yearlyBest) return false;
    var sp = effortSpeed(effort, axis);
    if (sp == null) return false;
    var best = yearlyBest[axis];
    if (!best || !best.activity_id) return false;
    return String(best.activity_id) === String(effort.activity_id) && Math.abs(sp - best.speed) < 0.0005;
  }

  function effortHasAnyPr(effort, yearlyBest) {
    if (!effort || !yearlyBest) return false;
    var i;
    for (i = 0; i < PACE_AXES.length; i++) {
      if (isAxisPrForEffort(effort, PACE_AXES[i], yearlyBest)) return true;
    }
    return false;
  }

  function logsHaveAnyPr(logs, effortsByActivityId, yearlyBestByYear) {
    if (!logs || !logs.length || !effortsByActivityId) return false;
    var i, log, effort, year, yb;
    for (i = 0; i < logs.length; i++) {
      log = logs[i];
      year = log.date ? String(log.date).slice(0, 4) : '';
      yb = yearlyBestByYear && yearlyBestByYear[year];
      if (!yb) continue;
      effort = effortsByActivityId[String(log.activity_id || '')];
      if (effort && effortHasAnyPr(effort, yb)) return true;
    }
    return false;
  }

  function groupLogsByDate(logs) {
    var map = {};
    (logs || []).forEach(function (log) {
      var dk = log.date ? String(log.date).slice(0, 10) : '';
      if (!dk) return;
      if (!map[dk]) map[dk] = [];
      map[dk].push(log);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        var ta = Number(a.activity_id) || 0;
        var tb = Number(b.activity_id) || 0;
        return tb - ta;
      });
    });
    return map;
  }

  function indexEffortsByActivityId(efforts) {
    var map = {};
    (efforts || []).forEach(function (e) {
      if (e && e.activity_id != null) map[String(e.activity_id)] = e;
    });
    return map;
  }

  function mergeEffortIntoLog(log, effort) {
    if (!log) return log;
    var merged = Object.assign({}, log);
    if (!effort) return merged;
    PACE_AXES.forEach(function (axis) {
      var sp = effortSpeed(effort, axis);
      if (sp != null) merged['speed_' + axis] = sp;
      var hr = effort['hr_' + axis];
      if (hr != null) merged['hr_' + axis] = hr;
    });
    return merged;
  }

  window.runJournalPrUtils = {
    PACE_AXES: PACE_AXES,
    PR_BADGE_BG: PR_BADGE_BG,
    speedMsToPaceSec: speedMsToPaceSec,
    formatPaceFromSpeed: formatPaceFromSpeed,
    formatSpeedKmhFromMs: formatSpeedKmhFromMs,
    formatPaceWithSpeed: formatPaceWithSpeed,
    buildYearlyPacePrByAxis: buildYearlyPacePrByAxis,
    isAxisPrForEffort: isAxisPrForEffort,
    effortHasAnyPr: effortHasAnyPr,
    logsHaveAnyPr: logsHaveAnyPr,
    groupLogsByDate: groupLogsByDate,
    indexEffortsByActivityId: indexEffortsByActivityId,
    mergeEffortIntoLog: mergeEffortIntoLog,
  };
})();
