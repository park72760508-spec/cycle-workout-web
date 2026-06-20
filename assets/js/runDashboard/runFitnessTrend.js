/**
 * RUN 대시보드 — 훈련 트렌드(Fitness/Fatigue) · RUN 사용자 평균 샘플
 * CYCLE fitness_demographic_samples / stats_fitness_stelvio_rolling 과 분리
 */
(function (global) {
  'use strict';

  var FITNESS_DECAY = Math.pow(0.5, 1 / 42);
  var FATIGUE_DECAY = Math.pow(0.5, 1 / 7);

  function sanitizeRtss(val) {
    var n = Number(val) || 0;
    return n > 0 && n < 1200 ? n : 0;
  }

  function isRunLog(log) {
    if (typeof global.isRunTrainingLog === 'function') return global.isRunTrainingLog(log);
    var type = String(log && log.activity_type || '').trim().toLowerCase();
    return type === 'run' || type === 'trailrun' || type === 'virtualrun';
  }

  function parseLogDateYmd(log, parseDateFn) {
    if (typeof parseDateFn === 'function') return parseDateFn(log.date || log.completed_at);
    if (!log) return null;
    var d = log.date || log.completed_at;
    if (d && typeof d.toDate === 'function') d = d.toDate();
    if (d instanceof Date) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    if (typeof d === 'string') return d.slice(0, 10);
    return null;
  }

  /**
   * RUN 로그 → 일별 rTSS 맵 (Strava 우선·동일일 1건 규칙)
   */
  function buildRunDailyRtssMap(runLogs, startStr, endStr, parseDateFn) {
    var logs = (runLogs || []).filter(isRunLog);
    if (typeof global.buildHistoryWithTSSRuleByDate === 'function') {
      logs = global.buildHistoryWithTSSRuleByDate(logs);
    }
    var byDate = {};
    logs.forEach(function (log) {
      var ds = parseLogDateYmd(log, parseDateFn);
      if (!ds || ds < startStr || ds > endStr) return;
      if (!byDate[ds]) byDate[ds] = 0;
      byDate[ds] += sanitizeRtss(log.tss);
    });
    return byDate;
  }

  function calcFitnessFatigueAt(byDateChart, targetStr) {
    var fit = 0;
    var fat = 0;
    var sorted = Object.keys(byDateChart)
      .sort()
      .filter(function (d) {
        return d <= targetStr;
      });
    for (var idx = sorted.length - 1; idx >= 0; idx--) {
      var logStr = sorted[idx];
      var logDate = new Date(logStr + 'T00:00:00');
      var targetDate = new Date(targetStr + 'T00:00:00');
      var daysAgo = Math.floor((targetDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo < 0) continue;
      var tss = byDateChart[logStr] || 0;
      fit += tss * Math.pow(FITNESS_DECAY, daysAgo);
      if (daysAgo <= 7) fat += tss * Math.pow(FATIGUE_DECAY, daysAgo);
    }
    return { fitness: Math.round(fit * 10) / 10, fatigue: Math.round(fat * 10) / 10 };
  }

  /**
   * @param {Array} runLogs
   * @param {{ today?: Date, parseDate?: Function, windowDays?: number }} [opts]
   * @returns {Array<{ date: string, fitness: number, fatigue: number }>}
   */
  function buildRunFitnessTrendChartData(runLogs, opts) {
    opts = opts || {};
    var today = opts.today instanceof Date ? opts.today : new Date();
    today.setHours(0, 0, 0, 0);
    var pad2 = function (n) {
      return String(n).padStart(2, '0');
    };
    var todayStr = today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
    var windowDays = opts.windowDays != null ? opts.windowDays : 60;
    var start = new Date(today);
    start.setDate(today.getDate() - windowDays);
    var startStr = start.getFullYear() + '-' + pad2(start.getMonth() + 1) + '-' + pad2(start.getDate());

    var byDateChart = buildRunDailyRtssMap(runLogs, startStr, todayStr, opts.parseDate);
    var xAxisDates = [];
    var i;
    for (i = 30; i >= 0; i -= 7) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      d.setHours(0, 0, 0, 0);
      xAxisDates.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
    }
    if (xAxisDates[xAxisDates.length - 1] !== todayStr) xAxisDates.push(todayStr);

    return xAxisDates.map(function (ds) {
      var res = calcFitnessFatigueAt(byDateChart, ds);
      var logD = new Date(ds + 'T00:00:00');
      var daysDiff = Math.floor((today.getTime() - logD.getTime()) / (1000 * 60 * 60 * 24));
      var label = daysDiff === 0 ? '오늘' : '-' + daysDiff + '일';
      return { date: label, fitness: res.fitness, fatigue: res.fatigue };
    });
  }

  var FIRESTORE_MOD_RUN_FITNESS = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
  var firestoreModRunFitnessPromise = null;
  function getFirestoreModRunFitness() {
    if (typeof global.getFirestoreModVo2Stats === 'function') {
      return global.getFirestoreModVo2Stats();
    }
    if (!firestoreModRunFitnessPromise) firestoreModRunFitnessPromise = import(FIRESTORE_MOD_RUN_FITNESS);
    return firestoreModRunFitnessPromise;
  }

  function docSnapExists(snap) {
    if (!snap) return false;
    return typeof snap.exists === 'function' ? snap.exists() : snap.exists === true;
  }

  function persistRunFitnessDemographicSampleAsync(userProfile, fitnessChartRows) {
    var uid = userProfile && userProfile.id;
    var db = global.firestoreV9;
    if (!uid || !db || !Array.isArray(fitnessChartRows) || fitnessChartRows.length === 0) {
      return Promise.resolve();
    }
    var vals = [];
    for (var fi = 0; fi < fitnessChartRows.length; fi++) {
      var fv = Number(fitnessChartRows[fi].fitness);
      if (isFinite(fv) && fv >= 0) vals.push(fv);
    }
    if (vals.length === 0) return Promise.resolve();
    var avgTrend =
      vals.reduce(function (a, b) {
        return a + b;
      }, 0) / vals.length;

    return getFirestoreModRunFitness()
      .then(function (mod) {
        if (!mod) return;
        return mod.setDoc(
          mod.doc(db, 'run_fitness_demographic_samples', uid),
          {
            sport: 'run',
            avgTrendFitness: Math.round(avgTrend * 10) / 10,
            updatedAt: mod.serverTimestamp()
          },
          { merge: true }
        );
      })
      .catch(function () {});
  }

  /**
   * RUN 사용자 전체 평균 Fitness — stats_fitness_run_stelvio_rolling/all_all
   * @returns {Promise<{ avgFitness: number, userCount: number }|null>}
   */
  function fetchStelvioRollingRunFitnessStatsGlobal() {
    var db = global.firestoreV9;
    if (!db) return Promise.resolve(null);
    return getFirestoreModRunFitness()
      .then(function (mod) {
        if (!mod) return null;
        return mod.getDoc(mod.doc(db, 'stats_fitness_run_stelvio_rolling', 'all_all'));
      })
      .then(function (snap) {
        if (!docSnapExists(snap)) return null;
        var d = snap.data();
        if (!d || d.minSamplesMet !== true) return null;
        var avg = Number(d.avgFitness);
        if (!isFinite(avg) || avg < 0) return null;
        return {
          avgFitness: Math.round(avg * 10) / 10,
          userCount: Math.max(0, Math.floor(Number(d.userCount) || 0))
        };
      })
      .catch(function () {
        return null;
      });
  }

  global.buildRunFitnessTrendChartData = buildRunFitnessTrendChartData;
  global.persistRunFitnessDemographicSampleAsync = persistRunFitnessDemographicSampleAsync;
  global.fetchStelvioRollingRunFitnessStatsGlobal = fetchStelvioRollingRunFitnessStatsGlobal;
})(typeof window !== 'undefined' ? window : global);
