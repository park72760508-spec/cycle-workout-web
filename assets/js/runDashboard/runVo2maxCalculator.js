/**
 * STELVIO RUN VO₂max 추정 (ml/kg/min)
 *
 * CYCLE(calculateStelvioVO2Max) 대비:
 * - CYCLE: ACSM 자전거 VO₂ = (W×10.8/kg)+7, FTP→MAP 베이스라인, 세션 70% + 베이스 30%
 * - RUN: Daniels–Gilbert 달리기 산소비용 + HR reserve(Swain 1994) 세션, 역치 페이스 베이스라인, 최고 지구력 페이스
 *
 * 참고 문헌·모델:
 * - Daniels & Gilbert (1979): VO₂ = −4.60 + 0.182258v + 0.000104v²  (v: m/min)
 * - Swain et al. (1994): %VO₂max ≈ %HRR (달리기)
 * - Billat & Demarle (2002): LT ≈ 85–88% VO₂max (훈련된 러너)
 * - ACSM (2018): 달리기 VO₂ = 3.5 + 0.2v (보조·교차검증)
 *
 * @module runVo2maxCalculator
 */
(function (global) {
  'use strict';

  var VO2_MIN = 20;
  var VO2_MAX = 85;
  var MIN_SESSION_SEC = 15 * 60;
  var MIN_SESSION_KM = 2.0;
  var MIN_BEST_EFFORT_SEC = 20 * 60;
  var MIN_BEST_EFFORT_KM = 5.0;
  var LT_FRACTION = 0.86;
  var BEST_EFFORT_FRACTION = 0.90;
  var WEIGHT_SESSIONS = 0.70;
  var WEIGHT_THRESHOLD = 0.30;
  var WEIGHT_BEST = 0.15;
  var HR_EXTRAP_CAP = 1.42;
  var RESTING_HR_DEFAULT = 60;

  function clampVo2(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return null;
    return Math.max(VO2_MIN, Math.min(VO2_MAX, n));
  }

  function parseLogDateStr(log) {
    if (!log) return null;
    var d = log.date || log.activity_date;
    if (d && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (log.completed_at) return String(log.completed_at).slice(0, 10);
    return null;
  }

  function getTimeDecayWeight(dateStr) {
    if (!dateStr) return 0.2;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    var daysDiff = Math.floor((today - date) / (24 * 60 * 60 * 1000));
    if (daysDiff <= 30) return 1.0;
    if (daysDiff <= 90) return 0.8;
    if (daysDiff <= 180) return 0.5;
    return 0.2;
  }

  function getDurationSec(log) {
    if (!log) return 0;
    var min = Number(log.duration_min);
    if (isFinite(min) && min > 0) return min * 60;
    var sec = Number(log.duration_sec != null ? log.duration_sec : log.time);
    return isFinite(sec) && sec > 0 ? sec : 0;
  }

  function getDistanceKm(log) {
    var d = Number(log.distance_km);
    if (isFinite(d) && d > 0) return d;
    var m = Number(log.distance);
    if (isFinite(m) && m > 100) return m / 1000;
    if (isFinite(m) && m > 0 && m < 200) return m;
    return 0;
  }

  function getAvgHr(log) {
    var hr = Number(log.avg_hr || log.hr_avg || 0);
    return isFinite(hr) && hr > 0 ? hr : 0;
  }

  function paceSecPerKmFromLog(log) {
    var sec = getDurationSec(log);
    var km = getDistanceKm(log);
    if (sec <= 0 || km <= 0) return null;
    return sec / km;
  }

  function velocityMminFromPaceSec(secPerKm) {
    var sec = Number(secPerKm);
    if (!isFinite(sec) || sec <= 0) return 0;
    return 60000 / sec;
  }

  /** Daniels & Gilbert (1979) — v in m/min */
  function danielsVo2FromVelocityMmin(vMmin) {
    var v = Number(vMmin);
    if (!isFinite(v) || v <= 0) return 0;
    return -4.6 + 0.182258 * v + 0.000104 * v * v;
  }

  function danielsVo2FromPaceSecPerKm(secPerKm) {
    return danielsVo2FromVelocityMmin(velocityMminFromPaceSec(secPerKm));
  }

  function acsmRunVo2FromPaceSecPerKm(secPerKm) {
    var v = velocityMminFromPaceSec(secPerKm);
    if (v <= 0) return 0;
    return 3.5 + 0.2 * v;
  }

  function getMaxHr(userProfile) {
    userProfile = userProfile || {};
    if (typeof global.getStelvioVO2MaxHR === 'function') {
      return global.getStelvioVO2MaxHR(userProfile);
    }
    var maxHr = Number(userProfile.max_hr);
    if (isFinite(maxHr) && maxHr >= 80 && maxHr <= 220) return Math.round(maxHr);
    var age = Number(userProfile.age || userProfile.birth_year);
    if (userProfile.birth_year && !userProfile.age) {
      age = new Date().getFullYear() - Number(userProfile.birth_year);
    }
    if (isFinite(age) && age >= 10 && age <= 120) {
      return Math.max(80, Math.min(220, Math.round(208 - 0.7 * age)));
    }
    return 190;
  }

  /**
   * 역치 페이스 → VO₂max (LT ≈ 86% VO₂max)
   */
  function vo2maxFromThresholdPaceSec(secPerKm, ltFraction) {
    var sec = Number(secPerKm);
    if (!isFinite(sec) || sec <= 0) return null;
    var frac = ltFraction != null ? Number(ltFraction) : LT_FRACTION;
    if (!isFinite(frac) || frac <= 0) frac = LT_FRACTION;
    var vo2Lt = danielsVo2FromPaceSecPerKm(sec);
    var vo2Acsm = acsmRunVo2FromPaceSecPerKm(sec);
    var vo2AtLt = 0.65 * vo2Lt + 0.35 * vo2Acsm;
    return vo2AtLt / frac;
  }

  /**
   * 단일 RUN 세션 VO₂max 추정
   * - Daniels/ACSM 페이스 VO₂ + CYCLE과 동일한 maxHR/avgHR 외삽
   * - 고강도 구간은 Swain %HRR 보정 가중
   */
  function sessionVo2maxEstimate(log, maxHr, restingHr) {
    var sec = getDurationSec(log);
    var km = getDistanceKm(log);
    if (sec < MIN_SESSION_SEC || km < MIN_SESSION_KM) return null;

    var paceSec = sec / km;
    var vo2Daniels = danielsVo2FromPaceSecPerKm(paceSec);
    var vo2Acsm = acsmRunVo2FromPaceSecPerKm(paceSec);
    var vo2Cost = 0.7 * vo2Daniels + 0.3 * vo2Acsm;

    var avgHr = getAvgHr(log);
    if (avgHr < 110 || maxHr <= avgHr + 5) return vo2Cost;

    var rhr = restingHr != null ? Number(restingHr) : RESTING_HR_DEFAULT;
    var hrExtrap = vo2Cost * (maxHr / avgHr);
    hrExtrap = Math.min(vo2Cost * HR_EXTRAP_CAP, hrExtrap);

    var hrrExtrap = null;
    if (avgHr > rhr + 10) {
      var hrr = (avgHr - rhr) / (maxHr - rhr);
      hrr = Math.max(0.45, Math.min(0.95, hrr));
      if (hrr >= 0.55) hrrExtrap = vo2Cost / hrr;
    }

    var estimate = hrExtrap;
    if (hrrExtrap != null && avgHr >= maxHr * 0.78) {
      estimate = 0.35 * hrExtrap + 0.65 * hrrExtrap;
    } else if (hrrExtrap != null && avgHr >= maxHr * 0.68) {
      estimate = 0.55 * hrExtrap + 0.45 * hrrExtrap;
    }

    return estimate;
  }

  function collectWeightedSessionEstimates(runLogs, maxHr, restingHr) {
    var weightedSum = 0;
    var weightTotal = 0;
    var count = 0;
    (runLogs || []).forEach(function (log) {
      var est = sessionVo2maxEstimate(log, maxHr, restingHr);
      if (est == null || est <= 0) return;
      var ds = parseLogDateStr(log);
      var w = getTimeDecayWeight(ds);
      var durW = Math.min(1.2, 0.85 + getDurationSec(log) / (60 * 60));
      var applied = w * durW;
      weightedSum += est * applied;
      weightTotal += applied;
      count++;
    });
    if (weightTotal <= 0) return { mean: null, count: 0 };
    return { mean: weightedSum / weightTotal, count: count };
  }

  function findBestEnduranceVo2max(runLogs) {
    var bestPaceSec = null;
    (runLogs || []).forEach(function (log) {
      var sec = getDurationSec(log);
      var km = getDistanceKm(log);
      if (sec < MIN_BEST_EFFORT_SEC && km < MIN_BEST_EFFORT_KM) return;
      var pace = paceSecPerKmFromLog(log);
      if (pace == null) return;
      if (bestPaceSec == null || pace < bestPaceSec) bestPaceSec = pace;
    });
    if (bestPaceSec == null) return null;
    var vo2AtBest = 0.65 * danielsVo2FromPaceSecPerKm(bestPaceSec) + 0.35 * acsmRunVo2FromPaceSecPerKm(bestPaceSec);
    return vo2AtBest / BEST_EFFORT_FRACTION;
  }

  function ageGenderFallbackVo2(userProfile) {
    if (typeof global.getVo2maxReferenceAverageMlKg === 'function' && typeof global.resolveProfileAgeGenderForVO2 === 'function') {
      var pr = global.resolveProfileAgeGenderForVO2(userProfile || {});
      return global.getVo2maxReferenceAverageMlKg(pr.genderKey, pr.ageBracket);
    }
    return 40;
  }

  /**
   * RUN VO₂max 통합 산출 (Supabase activities 로그 + 역치 페이스)
   * @param {Object} userProfile
   * @param {Array} runLogs - activities 기반 RUN 로그
   * @param {{ thresholdPaceSec?: number, restingHr?: number, maxHr?: number }} [options]
   * @returns {{ vo2max: number, components: Object, method: string }}
   */
  function calculateStelvioRunVO2Max(userProfile, runLogs, options) {
    options = options || {};
    userProfile = userProfile || {};
    var logs = Array.isArray(runLogs) ? runLogs : [];
    var maxHr = options.maxHr != null ? Number(options.maxHr) : getMaxHr(userProfile);
    var restingHr = options.restingHr != null ? Number(options.restingHr) : RESTING_HR_DEFAULT;

    var thresholdSec = options.thresholdPaceSec != null ? Number(options.thresholdPaceSec) : null;
    if ((thresholdSec == null || thresholdSec <= 0) && userProfile.threshold_pace_sec != null) {
      thresholdSec = Number(userProfile.threshold_pace_sec);
    }

    var sessions = collectWeightedSessionEstimates(logs, maxHr, restingHr);
    var thresholdVo2 = thresholdSec > 0 ? vo2maxFromThresholdPaceSec(thresholdSec) : null;
    var bestVo2 = findBestEnduranceVo2max(logs);

    var parts = [];
    var weights = [];
    if (sessions.mean != null && sessions.count > 0) {
      parts.push(sessions.mean);
      weights.push(WEIGHT_SESSIONS);
    }
    if (thresholdVo2 != null && thresholdVo2 > 0) {
      parts.push(thresholdVo2);
      weights.push(WEIGHT_THRESHOLD);
    }
    if (bestVo2 != null && bestVo2 > 0) {
      parts.push(bestVo2);
      weights.push(WEIGHT_BEST);
    }

    var finalVo2;
    var method;
    if (sessions.mean != null && sessions.count > 0 && thresholdVo2 != null && thresholdVo2 > 0) {
      finalVo2 = sessions.mean * WEIGHT_SESSIONS + thresholdVo2 * WEIGHT_THRESHOLD;
      method = 'blended_sessions_threshold';
    } else if (parts.length === 0) {
      if (thresholdSec > 0) {
        finalVo2 = vo2maxFromThresholdPaceSec(thresholdSec);
        method = 'threshold_only';
      } else if (bestVo2 != null && bestVo2 > 0) {
        finalVo2 = bestVo2;
        method = 'best_effort_only';
      } else {
        finalVo2 = ageGenderFallbackVo2(userProfile);
        method = 'population_fallback';
      }
    } else if (sessions.mean != null && sessions.count > 0 && thresholdVo2 == null) {
      finalVo2 = bestVo2 != null && bestVo2 > sessions.mean
        ? sessions.mean * (1 - WEIGHT_BEST) + bestVo2 * WEIGHT_BEST
        : sessions.mean;
      method = 'sessions_only';
    } else {
      var wSum = weights.reduce(function (a, b) { return a + b; }, 0);
      var acc = 0;
      for (var i = 0; i < parts.length; i++) {
        acc += parts[i] * (weights[i] / wSum);
      }
      finalVo2 = acc;
      method = 'blended';
    }

    var rounded = clampVo2(finalVo2);
    return {
      vo2max: rounded != null ? rounded : VO2_MIN,
      components: {
        sessions: sessions.mean != null ? Math.round(sessions.mean * 10) / 10 : null,
        sessionCount: sessions.count,
        threshold: thresholdVo2 != null ? Math.round(thresholdVo2 * 10) / 10 : null,
        bestEffort: bestVo2 != null ? Math.round(bestVo2 * 10) / 10 : null,
        thresholdPaceSec: thresholdSec,
      },
      method: method,
    };
  }

  /** @returns {number} ml/kg/min 정수 */
  function calculateStelvioRunVO2MaxSimple(userProfile, runLogs, options) {
    return calculateStelvioRunVO2Max(userProfile, runLogs, options).vo2max;
  }

  global.calculateStelvioRunVO2Max = calculateStelvioRunVO2Max;
  global.calculateStelvioRunVO2MaxSimple = calculateStelvioRunVO2MaxSimple;
  global.danielsVo2FromPaceSecPerKm = danielsVo2FromPaceSecPerKm;
  global.vo2maxFromRunThresholdPaceSec = vo2maxFromThresholdPaceSec;
  global.StelvioRunVO2Max = {
    calculate: calculateStelvioRunVO2Max,
    calculateSimple: calculateStelvioRunVO2MaxSimple,
    danielsVo2FromPaceSecPerKm: danielsVo2FromPaceSecPerKm,
    vo2maxFromThresholdPaceSec: vo2maxFromThresholdPaceSec,
    sessionVo2maxEstimate: sessionVo2maxEstimate,
  };
})(typeof window !== 'undefined' ? window : global);
