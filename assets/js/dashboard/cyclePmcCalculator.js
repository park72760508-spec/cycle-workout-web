/**
 * PMC(CTL/ATL/TSB) — CYCLE 대시보드 (Andrew Coggan · Banister EWMA)
 * RUN(runPmcCalculator.js)과 완전 분리 — 공유·import 없음
 *
 * TSS 우선순위 (Coggan & Allen, Training and Racing with a Power Meter):
 * 1) 기록된 TSS  2) IF²×시간  3) NP(또는 평균파워)×FTP  4) hrTSS(LTHR)
 * FTP: ftp_at_time → 프로필 FTP → 20분 파워×0.95 (Coggan FTP 추정)
 */
(function (global) {
  'use strict';

  var DEFAULT_CTL_TAU = 42;
  var DEFAULT_ATL_TAU = 7;
  var DEFAULT_BUILDUP = 42;
  var DEFAULT_CHART_DAYS = 30;
  var DEFAULT_MAX_TSS = 1200;
  /** Coggan: FTP ≈ 95% of 20-min mean max power */
  var FTP_FROM_20MIN_RATIO = 0.95;
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
    var raw = log.date != null ? log.date : log.completed_at != null ? log.completed_at : log.ride_date;
    if (!raw) return null;
    if (raw && typeof raw.toDate === 'function') {
      try {
        return toSeoulYmd(raw.toDate());
      } catch (e0) {}
    }
    var s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return toSeoulYmd(d);
  }

  function isRunActivity(log) {
    if (global.isRunTrainingLog && typeof global.isRunTrainingLog === 'function') {
      return global.isRunTrainingLog(log);
    }
    var t = String(log.activity_type != null ? log.activity_type : '').trim().toLowerCase();
    return !!RUN_TYPES[t];
  }

  function isCycleActivity(log) {
    if (!log || isRunActivity(log)) return false;
    var t = String(log.activity_type != null ? log.activity_type : 'ride').trim().toLowerCase();
    if (RUN_TYPES[t]) return false;
    if (!t || t === 'ride' || t === 'virtualride' || t === 'ebikeride' || t === 'handcycle' || t === 'mountainbikeride') {
      return true;
    }
    return !!(Number(log.avg_watts) > 0 || Number(log.weighted_watts) > 0 || Number(log.tss) > 0);
  }

  function sanitizeTss(val, maxDaily) {
    var n = Number(val);
    if (!isFinite(n) || n <= 0 || n >= maxDaily) return 0;
    return round1(n);
  }

  function logDurationSec(log) {
    var d = Number(log.duration_sec != null ? log.duration_sec : log.moving_time);
    if (isFinite(d) && d > 0) return d;
    var min = Number(log.duration_min != null ? log.duration_min : log.elapsed_time);
    if (isFinite(min) && min > 0) return min * 60;
    return 0;
  }

  function resolveNp(log) {
    var np = Number(
      log.weighted_watts != null
        ? log.weighted_watts
        : log.normalized_power != null
          ? log.normalized_power
          : NaN
    );
    if (isFinite(np) && np > 0) return np;
    var avg = Number(log.avg_watts != null ? log.avg_watts : log.average_watts);
    return isFinite(avg) && avg > 0 ? avg : null;
  }

  function resolveFtpForSession(log, profile) {
    profile = profile || {};
    var atTime = Number(log.ftp_at_time != null ? log.ftp_at_time : log.ftp);
    if (isFinite(atTime) && atTime > 0) return atTime;
    var profFtp = Number(profile.ftp);
    if (isFinite(profFtp) && profFtp > 0) return profFtp;
    var w20 = Number(log.max_20min_watts);
    if (isFinite(w20) && w20 > 0) return round1(w20 * FTP_FROM_20MIN_RATIO);
    var peaks = profile.peak_performances;
    if (peaks && typeof peaks === 'object') {
      var p20 = Number(peaks.max_20min_watts != null ? peaks.max_20min_watts : peaks['20min']);
      if (isFinite(p20) && p20 > 0) return round1(p20 * FTP_FROM_20MIN_RATIO);
    }
    return null;
  }

  function resolveLthr(profile) {
    profile = profile || {};
    if (profile.lthr != null && isFinite(Number(profile.lthr)) && Number(profile.lthr) > 0) {
      return Number(profile.lthr);
    }
    if (profile.threshold_hr != null && isFinite(Number(profile.threshold_hr)) && Number(profile.threshold_hr) > 0) {
      return Number(profile.threshold_hr);
    }
    var maxHr = Number(profile.max_hr != null ? profile.max_hr : profile.maxHr);
    if (isFinite(maxHr) && maxHr > 0) return Math.round(maxHr * 0.91);
    return null;
  }

  /** TSS = (hours) × IF² × 100  — Coggan/TrainingPeaks */
  function calculatePowerTss(durationSec, np, ftp) {
    if (durationSec <= 0 || np <= 0 || ftp <= 0) return 0;
    var intensityFactor = np / ftp;
    var hours = durationSec / 3600;
    var tss = hours * intensityFactor * intensityFactor * 100;
    return round1(Math.max(0, Math.min(500, tss)));
  }

  function calculateTssFromIntensityFactor(durationSec, intensityFactor) {
    if (durationSec <= 0 || !isFinite(intensityFactor) || intensityFactor <= 0) return 0;
    var hours = durationSec / 3600;
    var tss = hours * intensityFactor * intensityFactor * 100;
    return round1(Math.max(0, Math.min(500, tss)));
  }

  /** hrTSS — Coggan heart-rate based load (LTHR anchor) */
  function calculateHrTss(durationSec, avgHr, lthr) {
    if (durationSec <= 0 || avgHr <= 0 || lthr <= 0) return 0;
    var intensityFactor = avgHr / lthr;
    var hrTss = (durationSec * avgHr * intensityFactor) / (lthr * 3600) * 100;
    return round1(Math.max(0, Math.min(500, hrTss)));
  }

  function resolveSessionTss(log, profile, lthr, maxDaily) {
    var official = sanitizeTss(log.tss, maxDaily);
    if (official > 0) return official;

    var durationSec = logDurationSec(log);
    if (durationSec <= 0) return 0;

    var ifDirect = Number(log.intensity_factor != null ? log.intensity_factor : log.if);
    if (isFinite(ifDirect) && ifDirect > 0 && ifDirect <= 2.5) {
      var tssIf = calculateTssFromIntensityFactor(durationSec, ifDirect);
      if (tssIf > 0) return sanitizeTss(tssIf, maxDaily);
    }

    var ftp = resolveFtpForSession(log, profile);
    var np = resolveNp(log);
    if (np != null && ftp != null && ftp > 0) {
      var pTss = calculatePowerTss(durationSec, np, ftp);
      if (pTss > 0) return sanitizeTss(pTss, maxDaily);
    }

    var avgHr = Number(log.average_heartrate != null ? log.average_heartrate : log.avg_hr);
    if (isFinite(avgHr) && avgHr > 0 && lthr != null && lthr > 0) {
      var hrTss = calculateHrTss(durationSec, avgHr, lthr);
      if (hrTss > 0) return sanitizeTss(hrTss, maxDaily);
    }

    return 0;
  }

  function buildDailyTssMap(logs, profile, opts) {
    opts = opts || {};
    var maxDaily = opts.maxDailyTss != null ? opts.maxDailyTss : DEFAULT_MAX_TSS;
    var lthr = resolveLthr(profile);
    var byDate = {};
    (logs || []).forEach(function (log) {
      if (!isCycleActivity(log)) return;
      var ymd = parseLogYmd(log);
      if (!ymd) return;
      var tss = resolveSessionTss(log, profile, lthr, maxDaily);
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

  /** Banister exponential impulse-response (Coggan CTL/ATL EWMA) */
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

  /** TrainingPeaks / Coggan TSB 구간 (사이클 문구) */
  function getTsbTrainingStatusFeedback(tsb) {
    var t = round1(tsb);
    if (t > 5) {
      return {
        zone: 'freshness',
        title: '회복 · 레이스 준비 구간',
        message:
          'CTL 대비 ATL이 낮습니다. 레이스·FTP 테스트·VO₂max 인터벌 등 고강도 세션에 유리한 Freshness Zone입니다 (Coggan TSB).',
        tsb: t
      };
    }
    if (t >= -10) {
      return {
        zone: 'optimal',
        title: '최적 훈련 효율 구간',
        message:
          '훈련 부하와 회복의 균형이 양호합니다. Sweet Spot·Tempo 등 계획된 사이클 훈련을 유지하세요 (Optimal Training Zone).',
        tsb: t
      };
    }
    if (t >= -30) {
      return {
        zone: 'overreaching',
        title: '과부하 · Functional Overreaching',
        message:
          '단기 피로(ATL)가 누적 중입니다. Z1~Z2 회복 라이딩·수면·영양을 강화하고 강도 세션 빈도를 줄이세요.',
        tsb: t
      };
    }
    return {
      zone: 'overtraining',
      title: '위험 · Non-functional Overreaching',
      message:
        '과훈련 위험이 높습니다. HIIT·레이스 페이스 훈련을 중단하고 회복(Z1)을 우선하세요.',
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

  global.cyclePmcCalculator = {
    buildPmcChartData: buildPmcChartData,
    buildDailyTssMap: buildDailyTssMap,
    computePmcSeries: computePmcSeries,
    getTsbTrainingStatusFeedback: getTsbTrainingStatusFeedback,
    toLegacyFitnessTrendRows: toLegacyFitnessTrendRows,
    resolveSessionTss: resolveSessionTss,
    calculatePowerTss: calculatePowerTss,
    calculateHrTss: calculateHrTss,
    isCycleActivity: isCycleActivity
  };
})(typeof window !== 'undefined' ? window : global);
