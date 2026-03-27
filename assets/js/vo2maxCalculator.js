/**
 * VO2max 연령·성별 참고 + STELVIO 공통 VO₂max 산출 (vo2maxCalculator.js)
 *
 * calculateStelvioVO2Max — 260327_V1 원본과 동일 계열:
 * ACSM VO₂ = (W×10.8/체중)+7, FTP→MAP(=FTP×1.18) 베이스라인, 세션별 HR 보정 후
 * (세션 평균×0.7)+(베이스라인×0.3), 20~100 정수.
 * (프로필·FTP·체중 기반 결정론적 산출 — AI 미사용)
 *
 * 참고: conditionScoreModule의 computeVo2maxEstimate는 FTP·체중만으로 15×(FTP/w)+3.5 로
 * 대시보드 코치 fallback 등에 사용되며, 본 함수와는 식이 다릅니다.
 */
(function (global) {
  'use strict';

  /**
   * 학술 문헌·일반 성인 집단(ACS/Cooper 계열) 연령·성별 평균 — 가이드 라인 녹색
   * ml/kg/min
   */
  var VO2MAX_POPULATION_AVERAGE_MLKG = {
    male: {
      '20-29': 47.5,
      '30-39': 44.0,
      '40-49': 41.0,
      '50-59': 37.5,
      '60+': 33.5
    },
    female: {
      '20-29': 39.5,
      '30-39': 36.5,
      '40-49': 33.5,
      '50-59': 30.5,
      '60+': 27.5
    }
  };

  /**
   * Stelvio 앱 사용자 집단(연령·성별) 참고 평균 — 가이드 라인 주황
   * 실제 집계가 연결되기 전까지 대표값(사이클 앱 사용자 특성 반영, 학술 평균보다 소폭 높게 설정)
   */
  var STELVIO_USER_AVG_VO2MAX_MLKG = {
    male: {
      '20-29': 50.5,
      '30-39': 47.0,
      '40-49': 43.5,
      '50-59': 39.5,
      '60+': 35.5
    },
    female: {
      '20-29': 42.5,
      '30-39': 39.5,
      '40-49': 36.0,
      '50-59': 32.5,
      '60+': 29.0
    }
  };

  /**
   * 등급 구간(상대적) — 평균 대비 비율로 ACSM 카테고리 느낌의 라벨 부여
   * @type {Array<{ minRatio: number, tier: string, percentileHint: string }>}
   */
  var RELATIVE_TIERS = [
    { minRatio: 1.18, tier: '최우수', percentileHint: '상위 10%' },
    { minRatio: 1.08, tier: '우수', percentileHint: '상위 25%' },
    { minRatio: 1.0, tier: '양호', percentileHint: '상위 50%' },
    { minRatio: 0.9, tier: '보통', percentileHint: '평균 부근' },
    { minRatio: 0, tier: '부족', percentileHint: '개선 권장' }
  ];

  function getAgeBracket(age) {
    if (age == null || isNaN(Number(age))) return '30-39';
    var a = Number(age);
    if (a < 30) return '20-29';
    if (a < 40) return '30-39';
    if (a < 50) return '40-49';
    if (a < 60) return '50-59';
    return '60+';
  }

  function normalizeGender(g) {
    var s = g == null ? '' : String(g).trim().toLowerCase();
    if (s === '남' || s === 'm' || s === 'male' || s === '남성' || s === 'man') return 'male';
    if (s === '여' || s === 'f' || s === 'female' || s === '여성' || s === 'woman') return 'female';
    return 'male';
  }

  function getReferenceAverageMlKg(genderKey, ageBracket) {
    var g = genderKey === 'female' ? 'female' : 'male';
    var t = VO2MAX_POPULATION_AVERAGE_MLKG[g];
    if (!t || t[ageBracket] == null) return g === 'female' ? 36.5 : 44.0;
    return t[ageBracket];
  }

  /** Stelvio 사용자 연령·성별 평균 (주황 가이드 라인) */
  function getStelvioUserAvgVo2maxMlKg(genderKey, ageBracket) {
    var g = genderKey === 'female' ? 'female' : 'male';
    var t = STELVIO_USER_AVG_VO2MAX_MLKG[g];
    if (!t || t[ageBracket] == null) return g === 'female' ? 39.5 : 47.0;
    return t[ageBracket];
  }

  /**
   * @param {number|null} age - 만 나이
   * @param {string|null} gender - 남/여 등
   * @param {number|null} vo2max - ml/kg/min
   * @returns {{
   *   gradeText: string,
   *   tierLabel: string,
   *   percentileHint: string,
   *   averageVO2max: number,
   *   ageBracket: string,
   *   genderKey: string,
   *   ratio: number|null
   * }}
   */
  function evaluateVO2maxLevel(age, gender, vo2max) {
    var g = normalizeGender(gender);
    var bracket = getAgeBracket(age);
    var avg = getReferenceAverageMlKg(g, bracket);
    var v = Number(vo2max);
    if (!isFinite(v) || v <= 0) {
      return {
        gradeText: '측정값 없음',
        tierLabel: '—',
        percentileHint: '',
        averageVO2max: avg,
        ageBracket: bracket,
        genderKey: g,
        ratio: null
      };
    }
    var ratio = v / avg;
    var tierLabel = '보통';
    var percentileHint = '평균 부근';
    var i;
    for (i = 0; i < RELATIVE_TIERS.length; i++) {
      if (ratio >= RELATIVE_TIERS[i].minRatio) {
        tierLabel = RELATIVE_TIERS[i].tier;
        percentileHint = RELATIVE_TIERS[i].percentileHint;
        break;
      }
    }
    var gradeText = percentileHint + ' · ' + tierLabel;
    return {
      gradeText: gradeText,
      tierLabel: tierLabel,
      percentileHint: percentileHint,
      averageVO2max: avg,
      ageBracket: bracket,
      genderKey: g,
      ratio: ratio
    };
  }

  /**
   * currentUser / 프로필 객체 + localStorage currentUser 병합
   * @returns {{
   *   age: number,
   *   gender: string,
   *   genderKey: string,
   *   ageBracket: string,
   *   missingAge: boolean,
   *   missingGender: boolean,
   *   isDefaultFallback: boolean
   * }}
   */
  function resolveProfileAgeGenderForVO2(user) {
    var missingAge = false;
    var missingGender = false;
    var u = user && typeof user === 'object' ? Object.assign({}, user) : {};
    try {
      var ls = JSON.parse(global.localStorage && global.localStorage.getItem('currentUser') || 'null');
      if (ls && typeof ls === 'object') {
        u = Object.assign({}, ls, u);
      }
    } catch (e) {}

    var age = null;
    if (u.birth_year != null && !isNaN(Number(u.birth_year))) {
      var by = Number(u.birth_year);
      var y = new Date().getFullYear();
      age = Math.max(0, Math.min(110, y - by));
    } else if (u.age != null && !isNaN(Number(u.age))) {
      age = Number(u.age);
    } else {
      missingAge = true;
      age = 35;
    }

    var gender = '남';
    if (u.gender != null && String(u.gender).trim()) {
      gender = String(u.gender).trim();
    } else if (u.sex != null && String(u.sex).trim()) {
      gender = String(u.sex).trim();
    } else {
      missingGender = true;
    }

    var gk = normalizeGender(gender);
    return {
      age: age,
      gender: gender,
      genderKey: gk,
      ageBracket: getAgeBracket(age),
      missingAge: missingAge,
      missingGender: missingGender,
      isDefaultFallback: missingAge || missingGender
    };
  }

  global.VO2MAX_POPULATION_AVERAGE_MLKG = VO2MAX_POPULATION_AVERAGE_MLKG;
  global.STELVIO_USER_AVG_VO2MAX_MLKG = STELVIO_USER_AVG_VO2MAX_MLKG;
  global.getVo2maxAgeBracket = getAgeBracket;
  global.normalizeGenderForVO2 = normalizeGender;
  global.evaluateVO2maxLevel = evaluateVO2maxLevel;
  global.resolveProfileAgeGenderForVO2 = resolveProfileAgeGenderForVO2;
  global.getVo2maxReferenceAverageMlKg = getReferenceAverageMlKg;
  global.getStelvioUserAvgVo2maxMlKg = getStelvioUserAvgVo2maxMlKg;

  // --- STELVIO VO2 Max (260327_V1 원본 로직) ---------------------------------

  var MIN_DURATION_SEC = 20 * 60;
  var MIN_AVG_HR = 110;
  var MIN_AVG_POWER_W = 100;
  var WEIGHT_TRAINING = 0.7;
  var WEIGHT_BASELINE = 0.3;
  var MAP_FTP_RATIO = 1.18;
  var VO2_MIN = 20;
  var VO2_MAX = 100;
  var FALLBACK_MAX_HR = 190;

  function tanakaMaxHR(age) {
    var a = Number(age);
    if (isNaN(a) || a < 10 || a > 120) return FALLBACK_MAX_HR;
    var hr = 208 - 0.7 * a;
    return Math.max(80, Math.min(220, Math.round(hr)));
  }

  function getMaxHR(userProfile) {
    userProfile = userProfile || {};
    var maxHr = Number(userProfile.max_hr);
    if (!isNaN(maxHr) && maxHr >= 80 && maxHr <= 220) return Math.round(maxHr);
    return tanakaMaxHR(Number(userProfile.age));
  }

  function v1GetDurationSec(log) {
    if (!log) return 0;
    var min = Number(log.duration_min);
    if (!isNaN(min) && min > 0) return min * 60;
    var sec = Number(log.duration_sec || log.time || log.duration || 0);
    return isNaN(sec) ? 0 : Math.max(0, sec);
  }

  function v1GetWatts(log) {
    if (!log) return 0;
    var w = Number(log.weighted_watts || log.np || log.avg_watts || log.avg_power || 0);
    return isNaN(w) ? 0 : Math.max(0, w);
  }

  function v1GetAvgHR(log) {
    if (!log) return 0;
    var hr = Number(log.avg_hr || log.hr_avg || 0);
    return isNaN(hr) ? 0 : Math.max(0, hr);
  }

  function acsmVO2(powerW, weightKg) {
    if (!weightKg || weightKg <= 0) return 0;
    return (powerW * 10.8 / weightKg) + 7;
  }

  function baselineVO2FromFTP(ftp, weightKg) {
    if (!weightKg || weightKg <= 0) return 0;
    var map = Number(ftp) * MAP_FTP_RATIO;
    return acsmVO2(map, weightKg);
  }

  function sessionVO2Estimate(powerW, weightKg, maxHR, avgHR) {
    var base = acsmVO2(powerW, weightKg);
    if (!avgHR || avgHR < 1 || !maxHR || maxHR < 1) return base;
    return base * (maxHR / avgHR);
  }

  function filterAndEstimateSessions(recentLogs, weightKg, maxHR) {
    if (!Array.isArray(recentLogs) || !weightKg || weightKg <= 0) return [];
    var out = [];
    for (var i = 0; i < recentLogs.length; i++) {
      var log = recentLogs[i];
      var sec = v1GetDurationSec(log);
      var watts = v1GetWatts(log);
      var avgHr = v1GetAvgHR(log);
      if (sec < MIN_DURATION_SEC || avgHr < MIN_AVG_HR || watts < MIN_AVG_POWER_W) continue;
      var vo2 = sessionVO2Estimate(watts, weightKg, maxHR, avgHr);
      if (vo2 > 0 && isFinite(vo2)) out.push(vo2);
    }
    return out;
  }

  /**
   * STELVIO VO₂max (V1): 유효 세션이 있으면 (세션 VO₂ 평균×0.7)+(FTP·MAP 베이스라인×0.3), 없으면 베이스라인만.
   * @param {Object} userProfile - weight, ftp, max_hr?, age?
   * @param {Array} recentLogs - 세션 또는 일별 합산 행 (duration_sec|duration_min|…, weighted_watts|np|…, avg_hr|…)
   * @returns {number} 20~100 정수 (항상 반환)
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

  global.calculateStelvioVO2Max = calculateStelvioVO2Max;
  global.getStelvioVO2MaxHR = getMaxHR;
  global.tanakaMaxHR = tanakaMaxHR;
  global.baselineVO2FromFTP = baselineVO2FromFTP;
  global.acsmVO2 = acsmVO2;
  global.StelvioVO2Max = {
    calculate: calculateStelvioVO2Max,
    getMaxHR: getMaxHR,
    tanakaMaxHR: tanakaMaxHR,
    baselineVO2FromFTP: baselineVO2FromFTP,
    acsmVO2: acsmVO2
  };

  if (typeof module !== 'undefined' && module.exports) {
    var ex = module.exports;
    ex.calculateStelvioVO2Max = calculateStelvioVO2Max;
    ex.getMaxHR = getMaxHR;
    ex.tanakaMaxHR = tanakaMaxHR;
    ex.baselineVO2FromFTP = baselineVO2FromFTP;
    ex.acsmVO2 = acsmVO2;
  }

  /**
   * 성장 트렌드: 구간별(년간 PR과 동일 7슬롯) Stelvio 연령·성별 참고 PR (FTP·예측 MaxHR 기반)
   * slotIndex 0=M … 6=60분 — 녹색=파워(W), 주황=심박(bpm)
   */
  var GROWTH_REF_FTP_MULT = [2.35, 1.5, 1.34, 1.2, 1.06, 0.96, 0.84];
  var GROWTH_REF_HR_FRAC = [0.9, 0.94, 0.92, 0.89, 0.87, 0.84, 0.81];

  function getGrowthStelvioReferencePowerHr(slotIndex, userProfile) {
    userProfile = userProfile || {};
    var ftp = Number(userProfile.ftp);
    if (isNaN(ftp) || ftp < 1) ftp = 200;
    var idx = Math.max(0, Math.min(6, Number(slotIndex) || 0));
    var pr = typeof resolveProfileAgeGenderForVO2 === 'function'
      ? resolveProfileAgeGenderForVO2(userProfile)
      : { age: 35 };
    var age = pr.age != null ? Number(pr.age) : 35;
    var ageFactor = age >= 55 ? 0.9 : age >= 45 ? 0.95 : 1;
    var maxHR = getMaxHR(userProfile);
    var refW = Math.round(ftp * GROWTH_REF_FTP_MULT[idx] * ageFactor);
    var refHr = Math.round(maxHR * GROWTH_REF_HR_FRAC[idx]);
    refW = Math.max(50, Math.min(2000, refW));
    refHr = Math.max(70, Math.min(220, refHr));
    return { watts: refW, hr: refHr };
  }

  global.getGrowthStelvioReferencePowerHr = getGrowthStelvioReferencePowerHr;
  global.GROWTH_PR_SLOT_COUNT = 7;
})(typeof window !== 'undefined' ? window : this);
