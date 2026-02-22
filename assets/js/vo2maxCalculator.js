/**
 * STELVIO VO2 Max 계산기 (공통 유틸리티)
 * - AI API 없이 100% 로컬·결정론적 산출
 * - ACSM 공식 + FTP 베이스라인 + 훈련 세션별 동적 추정
 */
(function (global) {
  'use strict';

  /** 최소 유산소 훈련 시간(초): 20분 */
  var MIN_DURATION_SEC = 20 * 60;
  /** 최소 평균 심박(bpm) */
  var MIN_AVG_HR = 110;
  /** 최소 평균 파워(W) */
  var MIN_AVG_POWER_W = 100;
  /** 훈련 로그 기반 가중치 */
  var WEIGHT_TRAINING = 0.7;
  /** FTP 베이스라인 가중치 */
  var WEIGHT_BASELINE = 0.3;
  /** MAP = FTP * 이 비율 (최대 유산소 파워) */
  var MAP_FTP_RATIO = 1.18;
  /** 반환값 하한(ml/kg/min) */
  var VO2_MIN = 20;
  /** 반환값 상한(ml/kg/min) */
  var VO2_MAX = 100;
  /** MaxHR 미지정 시 Fallback */
  var FALLBACK_MAX_HR = 190;

  /**
   * Tanaka 공식: 예측 최대 심박수 = 208 - 0.7 * 나이
   * @param {number} age - 나이
   * @returns {number}
   */
  function tanakaMaxHR(age) {
    var a = Number(age);
    if (isNaN(a) || a < 10 || a > 120) return FALLBACK_MAX_HR;
    var hr = 208 - 0.7 * a;
    return Math.max(80, Math.min(220, Math.round(hr)));
  }

  /**
   * 사용자 최대 심박수 결정: 프로필 > Tanaka(나이) > 190
   * @param {Object} userProfile - { max_hr, age }
   * @returns {number}
   */
  function getMaxHR(userProfile) {
    userProfile = userProfile || {};
    var maxHr = Number(userProfile.max_hr);
    if (!isNaN(maxHr) && maxHr >= 80 && maxHr <= 220) return Math.round(maxHr);
    return tanakaMaxHR(Number(userProfile.age));
  }

  /**
   * 로그 1건의 duration(초) 추출
   * @param {Object} log
   * @returns {number}
   */
  function getDurationSec(log) {
    if (!log) return 0;
    var min = Number(log.duration_min);
    if (!isNaN(min) && min > 0) return min * 60;
    var sec = Number(log.duration_sec || log.time || log.duration || 0);
    return isNaN(sec) ? 0 : Math.max(0, sec);
  }

  /**
   * 로그 1건의 파워(W): weighted_watts 우선, 없으면 avg_watts/avg_power
   * @param {Object} log
   * @returns {number}
   */
  function getWatts(log) {
    if (!log) return 0;
    var w = Number(log.weighted_watts || log.np || log.avg_watts || log.avg_power || 0);
    return isNaN(w) ? 0 : Math.max(0, w);
  }

  /**
   * 로그 1건의 평균 심박(bpm)
   * @param {Object} log
   * @returns {number}
   */
  function getAvgHR(log) {
    if (!log) return 0;
    var hr = Number(log.avg_hr || log.hr_avg || 0);
    return isNaN(hr) ? 0 : Math.max(0, hr);
  }

  /**
   * ACSM: VO2 (ml/kg/min) = (파워 * 10.8 / 몸무게) + 7
   * @param {number} powerW - 파워(W)
   * @param {number} weightKg - 체중(kg)
   * @returns {number}
   */
  function acsmVO2(powerW, weightKg) {
    if (!weightKg || weightKg <= 0) return 0;
    return (powerW * 10.8 / weightKg) + 7;
  }

  /**
   * FTP 베이스라인 VO2 Max: MAP = FTP * 1.18 기준
   * Baseline VO2 = ((FTP * 1.18) * 10.8 / Weight) + 7
   * @param {number} ftp - FTP(W)
   * @param {number} weightKg - 체중(kg)
   * @returns {number}
   */
  function baselineVO2FromFTP(ftp, weightKg) {
    if (!weightKg || weightKg <= 0) return 0;
    var map = Number(ftp) * MAP_FTP_RATIO;
    return acsmVO2(map, weightKg);
  }

  /**
   * 세션별 동적 추정: Session VO2 Max = (((Watts*10.8)/Weight)+7) * (MaxHR/AvgHR)
   * @param {number} powerW - 세션 파워(W)
   * @param {number} weightKg - 체중(kg)
   * @param {number} maxHR - 최대 심박
   * @param {number} avgHR - 세션 평균 심박
   * @returns {number}
   */
  function sessionVO2Estimate(powerW, weightKg, maxHR, avgHR) {
    var base = acsmVO2(powerW, weightKg);
    if (!avgHR || avgHR < 1 || !maxHR || maxHR < 1) return base;
    return base * (maxHR / avgHR);
  }

  /**
   * 유의미한 유산소 훈련만 필터: 20분 이상, 평균심박 110 이상, 평균파워 100W 이상
   * @param {Array} recentLogs
   * @param {number} weightKg
   * @param {number} maxHR
   * @returns {Array<number>} 세션별 VO2 추정값 배열
   */
  function filterAndEstimateSessions(recentLogs, weightKg, maxHR) {
    if (!Array.isArray(recentLogs) || !weightKg || weightKg <= 0) return [];
    var out = [];
    for (var i = 0; i < recentLogs.length; i++) {
      var log = recentLogs[i];
      var sec = getDurationSec(log);
      var watts = getWatts(log);
      var avgHr = getAvgHR(log);
      if (sec < MIN_DURATION_SEC || avgHr < MIN_AVG_HR || watts < MIN_AVG_POWER_W) continue;
      var vo2 = sessionVO2Estimate(watts, weightKg, maxHR, avgHr);
      if (vo2 > 0 && isFinite(vo2)) out.push(vo2);
    }
    return out;
  }

  /**
   * STELVIO VO2 Max 산출 (공통 유틸리티)
   * - (훈련 기반 평균 * 0.7) + (FTP 베이스라인 * 0.3) 반올림 정수, 20~100 클램프
   * - 유효 훈련이 없으면 FTP 베이스라인만 반환
   * @param {Object} userProfile - { weight, ftp, max_hr?, age? }
   * @param {Array} recentLogs - 훈련 로그 배열 (duration_sec|duration_min|time|duration, weighted_watts|avg_watts|np|avg_power, avg_hr|hr_avg)
   * @returns {number} VO2 Max (ml/kg/min) 정수, 20~100
   */
  function calculateStelvioVO2Max(userProfile, recentLogs) {
    userProfile = userProfile || {};
    var weightKg = Number(userProfile.weight);
    if (isNaN(weightKg) || weightKg <= 0) weightKg = 70;
    var ftp = Number(userProfile.ftp);
    if (isNaN(ftp) || ftp < 0) ftp = 200;

    var maxHR = getMaxHR(userProfile);
    var baseline = baselineVO2FromFTP(ftp, weightKg);

    var sessionVO2s = filterAndEstimateSessions(recentLogs || [], weightKg, maxHR);

    var finalVO2;
    if (sessionVO2s.length > 0) {
      var sum = 0;
      for (var j = 0; j < sessionVO2s.length; j++) sum += sessionVO2s[j];
      var meanSession = sum / sessionVO2s.length;
      finalVO2 = meanSession * WEIGHT_TRAINING + baseline * WEIGHT_BASELINE;
    } else {
      finalVO2 = baseline;
    }

    var rounded = Math.round(finalVO2);
    return Math.max(VO2_MIN, Math.min(VO2_MAX, rounded));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      calculateStelvioVO2Max: calculateStelvioVO2Max,
      getMaxHR: getMaxHR,
      tanakaMaxHR: tanakaMaxHR,
      baselineVO2FromFTP: baselineVO2FromFTP,
      acsmVO2: acsmVO2
    };
  }
  if (typeof global !== 'undefined') {
    global.calculateStelvioVO2Max = calculateStelvioVO2Max;
    global.getStelvioVO2MaxHR = getMaxHR;
    global.tanakaMaxHR = tanakaMaxHR;
    global.StelvioVO2Max = {
      calculate: calculateStelvioVO2Max,
      getMaxHR: getMaxHR,
      tanakaMaxHR: tanakaMaxHR,
      baselineVO2FromFTP: baselineVO2FromFTP,
      acsmVO2: acsmVO2
    };
  }
})(typeof window !== 'undefined' ? window : this);
