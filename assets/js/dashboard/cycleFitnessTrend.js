/**
 * CYCLE 대시보드 — 훈련 트렌드(Fitness/Fatigue) · Coggan PMC(CTL/ATL/TSB)
 * RUN(runFitnessTrend.js / runPmcCalculator.js)과 완전 분리
 */
(function (global) {
  'use strict';

  function profileFromOpts(opts) {
    opts = opts || {};
    return {
      ftp: opts.ftp,
      lthr: opts.lthr,
      threshold_hr: opts.thresholdHr || opts.threshold_hr,
      max_hr: opts.maxHr != null ? opts.maxHr : opts.max_hr,
      peak_performances: opts.peakPerformances || opts.peak_performances
    };
  }

  /**
   * PMC 기반 CYCLE 훈련 트렌드 — 최근 30일 CTL/ATL + TSB 피드백
   */
  function buildCyclePmcTrendPayload(cycleLogs, opts) {
    opts = opts || {};
    var pmc = global.cyclePmcCalculator;
    if (!pmc || typeof pmc.buildPmcChartData !== 'function') {
      return { chartRows: [], pmcSeries: [], tsbFeedback: null, latestTsb: null };
    }
    var today = opts.today instanceof Date ? opts.today : new Date();
    today.setHours(0, 0, 0, 0);
    var chartDays = opts.chartDays != null ? opts.chartDays : 30;
    var logs = cycleLogs || [];
    if (typeof global.buildHistoryWithTSSRuleByDate === 'function') {
      logs = global.buildHistoryWithTSSRuleByDate(logs);
    }
    if (pmc.isCycleActivity) {
      logs = logs.filter(function (log) {
        return pmc.isCycleActivity(log);
      });
    }
    var profile = profileFromOpts(opts.profile || opts);
    var pmcSeries = pmc.buildPmcChartData(logs, profile, {
      chartDays: chartDays,
      buildupDays: 42,
      endDate: today
    });
    var chartRows =
      typeof pmc.toLegacyFitnessTrendRows === 'function'
        ? pmc.toLegacyFitnessTrendRows(pmcSeries)
        : pmcSeries.map(function (row) {
            return { date: row.date, fitness: row.fitness_ctl, fatigue: row.fatigue_atl };
          });
    var latest = pmcSeries.length ? pmcSeries[pmcSeries.length - 1] : null;
    var tsbFeedback =
      latest && typeof pmc.getTsbTrainingStatusFeedback === 'function'
        ? pmc.getTsbTrainingStatusFeedback(latest.form_tsb)
        : null;
    return {
      chartRows: chartRows,
      pmcSeries: pmcSeries,
      tsbFeedback: tsbFeedback,
      latestTsb: latest ? latest.form_tsb : null
    };
  }

  /**
   * @returns {Array<{ date: string, fitness: number, fatigue: number, form_tsb?: number, daily_tss?: number }>}
   */
  function buildCycleFitnessTrendChartData(cycleLogs, opts) {
    opts = opts || {};
    var payload = buildCyclePmcTrendPayload(cycleLogs, opts);
    if (payload.chartRows && payload.chartRows.length) {
      return payload.chartRows;
    }

    /* PMC 모듈 미로드 시 — 기존 decay 합산 fallback (CYCLE 전용) */
    var FITNESS_DECAY = Math.pow(0.5, 1 / 42);
    var FATIGUE_DECAY = Math.pow(0.5, 1 / 7);
    var today = opts.today instanceof Date ? opts.today : new Date();
    today.setHours(0, 0, 0, 0);
    var pad2 = function (n) {
      return String(n).padStart(2, '0');
    };
    var todayStr = today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
    var parseDateFn = opts.parseDate;
    var byDateChart = {};
    (cycleLogs || []).forEach(function (log) {
      var ds =
        typeof parseDateFn === 'function'
          ? parseDateFn(log.date)
          : log.date
            ? String(log.date).slice(0, 10)
            : null;
      if (!ds || ds > todayStr) return;
      var n = Number(log.tss) || 0;
      var tss = n > 0 && n < 1200 ? n : 0;
      if (!tss) return;
      byDateChart[ds] = (byDateChart[ds] || 0) + tss;
    });

    function calcFitnessFatigueAt(byDateChartInner, targetStr) {
      var fit = 0;
      var fat = 0;
      var sorted = Object.keys(byDateChartInner)
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
        var tssVal = byDateChartInner[logStr] || 0;
        fit += tssVal * Math.pow(FITNESS_DECAY, daysAgo);
        if (daysAgo <= 7) fat += tssVal * Math.pow(FATIGUE_DECAY, daysAgo);
      }
      return { fitness: Math.round(fit * 10) / 10, fatigue: Math.round(fat * 10) / 10 };
    }

    var xAxisDates = [];
    var endYmd = todayStr;
    var startYmd = addDaysYmdLocal(endYmd, -29);
    var cur = startYmd;
    while (cur <= endYmd) {
      xAxisDates.push(cur);
      cur = addDaysYmdLocal(cur, 1);
    }

    return xAxisDates.map(function (ds) {
      var res = calcFitnessFatigueAt(byDateChart, ds);
      var p = ds.split('-');
      var label = parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
      return { date: label, dateYmd: ds, fitness: res.fitness, fatigue: res.fatigue };
    });
  }

  function addDaysYmdLocal(ymd, delta) {
    var p = ymd.split('-').map(Number);
    var dt = new Date(p[0], p[1] - 1, p[2]);
    dt.setDate(dt.getDate() + delta);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  global.buildCycleFitnessTrendChartData = buildCycleFitnessTrendChartData;
  global.buildCyclePmcTrendPayload = buildCyclePmcTrendPayload;
})(typeof window !== 'undefined' ? window : global);
