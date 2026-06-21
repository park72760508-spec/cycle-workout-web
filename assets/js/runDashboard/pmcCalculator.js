/**
 * PMC(CTL/ATL/TSB) — web RUN 대시보드 (mobile/src/utils/pmcCalculator.ts 동형)
 */
(function (global) {
  'use strict';

  var DEFAULT_CTL_TAU = 42;
  var DEFAULT_ATL_TAU = 7;
  var DEFAULT_BUILDUP = 42;
  var DEFAULT_CHART_DAYS = 30;
  var DEFAULT_MAX_TSS = 1200;
  var RIEGEL_K = 1.06;
  var INFER_WEIGHTS = { '7k': 0.5, '5k': 0.35, '3k': 0.15 };
  var INFER_DIST_KM = { '3k': 3, '5k': 5, '7k': 7, '10k': 10 };
  var RUN_TYPES = { run: 1, trailrun: 1, virtualrun: 1 };

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toSeoulYmd(d) {
    d = d || new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    } catch (e) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }

  function addDaysYmd(ymd, delta) {
    var p = ymd.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  }

  function parseLogYmd(log) {
    var raw = log.date != null ? log.date : log.completed_at;
    if (!raw) return null;
    var s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return toSeoulYmd(d);
  }

  function isRunActivity(log) {
    var t = String(log.activity_type != null ? log.activity_type : 'run').trim().toLowerCase();
    return !!RUN_TYPES[t];
  }

  function parsePaceToSecPerKm(pace) {
    if (pace == null) return null;
    var s = String(pace).replace(/\s*min\/1?km\s*$/i, '').trim();
    if (!s || s === '—' || s === '-') return null;
    if (s.indexOf(':') >= 0) {
      var parts = s.split(':').map(Number);
      if (parts.length >= 2 && parts.every(function (x) { return isFinite(x); })) {
        return parts[0] * 60 + parts[1];
      }
    }
    var n = Number(s);
    return isFinite(n) && n > 0 ? n : null;
  }

  function getPaceSecFromSegment(seg) {
    if (!seg) return null;
    return parsePaceToSecPerKm(seg.pace != null ? seg.pace : seg.calculated_pace);
  }

  function riegelPredictTotalSec(timeSec, fromKm, toKm) {
    if (!isFinite(timeSec) || timeSec <= 0 || fromKm <= 0 || toKm <= 0) return null;
    return timeSec * Math.pow(toKm / fromKm, RIEGEL_K);
  }

  function inferThresholdPaceSecPerKm(peaks) {
    peaks = peaks || {};
    var direct10k = getPaceSecFromSegment(peaks['10k']);
    if (direct10k != null && direct10k > 0) return direct10k;
    var parts = [];
    ['7k', '5k', '3k'].forEach(function (distKey) {
      var paceSec = getPaceSecFromSegment(peaks[distKey]);
      var distKm = INFER_DIST_KM[distKey];
      if (paceSec == null || !distKm) return;
      var predicted = riegelPredictTotalSec(paceSec * distKm, distKm, 10);
      if (predicted == null || !isFinite(predicted) || predicted <= 0) return;
      parts.push({ weight: INFER_WEIGHTS[distKey], predicted10kSec: predicted });
    });
    if (!parts.length) return null;
    var wSum = parts.reduce(function (a, p) { return a + p.weight; }, 0);
    var t10 = parts.reduce(function (a, p) { return a + p.predicted10kSec * (p.weight / wSum); }, 0);
    return t10 / 10;
  }

  function resolveThresholdPaceSec(profile, logs) {
    profile = profile || {};
    if (profile.threshold_pace_sec != null && isFinite(Number(profile.threshold_pace_sec)) && Number(profile.threshold_pace_sec) > 0) {
      return Number(profile.threshold_pace_sec);
    }
    if (profile.threshold_pace) {
      var parsed = parsePaceToSecPerKm(profile.threshold_pace);
      if (parsed != null && parsed > 0) return parsed;
    }
    var fromProfile = inferThresholdPaceSecPerKm(profile.peak_performances);
    if (fromProfile != null) return fromProfile;
    for (var i = 0; i < (logs || []).length; i++) {
      var fromLog = inferThresholdPaceSecPerKm(logs[i].peak_performances);
      if (fromLog != null) return fromLog;
    }
    return null;
  }

  function resolveLthr(profile) {
    profile = profile || {};
    if (profile.lthr != null && isFinite(Number(profile.lthr)) && Number(profile.lthr) > 0) return Number(profile.lthr);
    if (profile.threshold_hr != null && isFinite(Number(profile.threshold_hr)) && Number(profile.threshold_hr) > 0) {
      return Number(profile.threshold_hr);
    }
    if (profile.max_hr != null && isFinite(Number(profile.max_hr)) && Number(profile.max_hr) > 0) {
      return Math.round(Number(profile.max_hr) * 0.92);
    }
    return null;
  }

  function sanitizeTss(val, maxDaily) {
    var n = Number(val);
    if (!isFinite(n) || n <= 0 || n >= maxDaily) return 0;
    return round1(n);
  }

  function logDurationSec(log) {
    var d = Number(log.duration_sec != null ? log.duration_sec : log.moving_time);
    return isFinite(d) && d > 0 ? d : 0;
  }

  function logAvgSpeedMps(log) {
    var direct = Number(log.average_speed);
    if (isFinite(direct) && direct > 0) return direct;
    var dur = logDurationSec(log);
    var distM = Number(log.distance_m != null ? log.distance_m : log.distance);
    if ((!distM || distM <= 0) && log.distance != null) distM = Number(log.distance) * 1000;
    if (dur > 0 && distM > 0) return distM / dur;
    return null;
  }

  function thresholdPaceToSpeedMps(secPerKm) {
    return 1000 / secPerKm;
  }

  function calculateRtssFromPace(durationSec, avgSpeedMps, ftpSpeedMps) {
    if (durationSec <= 0 || avgSpeedMps <= 0 || ftpSpeedMps <= 0) return 0;
    var intensityFactor = avgSpeedMps / ftpSpeedMps;
    var rtss = (durationSec * avgSpeedMps * intensityFactor) / (ftpSpeedMps * 3600) * 100;
    return round1(Math.max(0, Math.min(500, rtss)));
  }

  function calculateHrTss(durationSec, avgHr, lthr) {
    if (durationSec <= 0 || avgHr <= 0 || lthr <= 0) return 0;
    var intensityFactor = avgHr / lthr;
    var hrTss = (durationSec * avgHr * intensityFactor) / (lthr * 3600) * 100;
    return round1(Math.max(0, Math.min(500, hrTss)));
  }

  function resolveSessionTss(log, profile, thresholdPaceSec, lthr, maxDaily) {
    var official = sanitizeTss(log.tss, maxDaily);
    if (official > 0) return official;
    var durationSec = logDurationSec(log);
    if (durationSec <= 0) return 0;
    var avgSpeed = logAvgSpeedMps(log);
    if (avgSpeed != null && thresholdPaceSec != null && thresholdPaceSec > 0) {
      var ftpSpeed = thresholdPaceToSpeedMps(thresholdPaceSec);
      var rtss = calculateRtssFromPace(durationSec, avgSpeed, ftpSpeed);
      if (rtss > 0) return sanitizeTss(rtss, maxDaily);
    }
    var avgHr = Number(log.average_heartrate);
    if (isFinite(avgHr) && avgHr > 0 && lthr != null && lthr > 0) {
      var hrTss = calculateHrTss(durationSec, avgHr, lthr);
      if (hrTss > 0) return sanitizeTss(hrTss, maxDaily);
    }
    return 0;
  }

  function buildDailyTssMap(logs, profile, opts) {
    opts = opts || {};
    var maxDaily = opts.maxDailyTss != null ? opts.maxDailyTss : DEFAULT_MAX_TSS;
    var thresholdPaceSec = resolveThresholdPaceSec(profile, logs);
    var lthr = resolveLthr(profile);
    var byDate = {};
    (logs || []).forEach(function (log) {
      if (!isRunActivity(log)) return;
      var ymd = parseLogYmd(log);
      if (!ymd) return;
      var tss = resolveSessionTss(log, profile, thresholdPaceSec, lthr, maxDaily);
      if (tss <= 0) return;
      byDate[ymd] = round1((byDate[ymd] || 0) + tss);
    });
    return byDate;
  }

  function enumerateDates(startYmd, endYmd) {
    var out = [];
    var cur = startYmd;
    while (cur <= endYmd) {
      out.push(cur);
      cur = addDaysYmd(cur, 1);
    }
    return out;
  }

  function computePmcSeries(dailyTss, opts) {
    opts = opts || {};
    var chartDays = opts.chartDays != null ? opts.chartDays : DEFAULT_CHART_DAYS;
    var buildupDays = opts.buildupDays != null ? opts.buildupDays : DEFAULT_BUILDUP;
    var ctlTau = opts.ctlTimeConstant != null ? opts.ctlTimeConstant : DEFAULT_CTL_TAU;
    var atlTau = opts.atlTimeConstant != null ? opts.atlTimeConstant : DEFAULT_ATL_TAU;
    var endYmd = opts.endDate ? toSeoulYmd(opts.endDate) : toSeoulYmd();
    var startYmd = addDaysYmd(endYmd, -(chartDays + buildupDays - 1));
    var dates = enumerateDates(startYmd, endYmd);
    var ctl = 0;
    var atl = 0;
    var series = [];
    dates.forEach(function (ymd) {
      var tssToday = round1(dailyTss[ymd] || 0);
      ctl = round1(ctl + (tssToday - ctl) / ctlTau);
      atl = round1(atl + (tssToday - atl) / atlTau);
      var tsb = round1(ctl - atl);
      series.push({
        date: ymd,
        fitness_ctl: ctl,
        fatigue_atl: atl,
        form_tsb: tsb,
        daily_tss: tssToday
      });
    });
    return series;
  }

  function buildPmcChartData(logs, profile, opts) {
    opts = opts || {};
    var chartDays = opts.chartDays != null ? opts.chartDays : DEFAULT_CHART_DAYS;
    var endYmd = opts.endDate ? toSeoulYmd(opts.endDate) : toSeoulYmd();
    var daily = buildDailyTssMap(logs, profile, opts);
    var full = computePmcSeries(daily, opts);
    var chartStart = addDaysYmd(endYmd, -(chartDays - 1));
    return full.filter(function (row) {
      return row.date >= chartStart && row.date <= endYmd;
    });
  }

  function getTsbTrainingStatusFeedback(tsb) {
    var t = round1(tsb);
    if (t > 5) {
      return {
        zone: 'freshness',
        title: '회복 · 최적 경기력 구간',
        message: '체력 대비 피로가 낮습니다. 레이스나 고강도 세션에 유리한 Freshness Zone입니다.',
        tsb: t
      };
    }
    if (t >= -10) {
      return {
        zone: 'optimal',
        title: '최적 훈련 효율 구간',
        message: '훈련 부하와 회복의 균형이 양호합니다. 계획된 러닝을 유지하세요 (Optimal Training Zone).',
        tsb: t
      };
    }
    if (t >= -30) {
      return {
        zone: 'overreaching',
        title: '과부하 · 부상 주의',
        message: '피로가 누적 중입니다. Z1~Z2 회복 러닝과 수면·영양 관리를 강화하세요 (Overreaching Zone).',
        tsb: t
      };
    }
    return {
      zone: 'overtraining',
      title: '위험 · 훈련 중단 권고',
      message: '과훈련 위험이 높습니다. 강도 훈련을 중단하고 회복을 우선하세요 (Overtraining Zone).',
      tsb: t
    };
  }

  function formatYmdMdLabel(ymd) {
    if (!ymd || String(ymd).length < 10) return '';
    var p = String(ymd).split('-');
    return parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
  }

  function toLegacyFitnessTrendRows(pmcRows) {
    return (pmcRows || []).map(function (row) {
      return {
        date: formatYmdMdLabel(row.date),
        dateYmd: row.date,
        fitness: row.fitness_ctl,
        fatigue: row.fatigue_atl,
        form_tsb: row.form_tsb,
        daily_tss: row.daily_tss
      };
    });
  }

  global.runPmcCalculator = {
    buildPmcChartData: buildPmcChartData,
    buildDailyTssMap: buildDailyTssMap,
    computePmcSeries: computePmcSeries,
    getTsbTrainingStatusFeedback: getTsbTrainingStatusFeedback,
    toLegacyFitnessTrendRows: toLegacyFitnessTrendRows,
    resolveSessionTss: resolveSessionTss,
    calculateRtssFromPace: calculateRtssFromPace,
    calculateHrTss: calculateHrTss,
    inferThresholdPaceSecPerKm: inferThresholdPaceSecPerKm
  };
})(typeof window !== 'undefined' ? window : global);
