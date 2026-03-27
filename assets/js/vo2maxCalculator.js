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
   * 성장 트렌드 참고선: Stelvio **연령대(30대 이하·40·50·60대 이상)·성별** 피크 W/kg 평균 × 체중 → W,
   * 심박은 동일 코호트 피크 심박(bpm) 평균.
   * 키: u40=만 39세 이하, 40s=40–49, 50s=50–59, 60p=60세 이상
   */
  var STELVIO_COHORT_AVG_PEAK_WKG = {
    male: {
      u40: [12.0, 6.6, 5.83, 5.18, 4.5, 3.93, 3.35],
      '40s': [10.5, 6.0, 5.3, 4.7, 4.05, 3.55, 3.05],
      '50s': [9.5, 5.5, 4.85, 4.3, 3.75, 3.25, 2.8],
      '60p': [8.2, 5.0, 4.4, 3.9, 3.4, 2.95, 2.55]
    },
    female: {
      u40: [9.85, 5.35, 4.7, 4.18, 3.63, 3.15, 2.73],
      '40s': [8.6, 4.85, 4.25, 3.8, 3.3, 2.85, 2.45],
      '50s': [7.8, 4.45, 3.95, 3.5, 3.05, 2.65, 2.25],
      '60p': [6.8, 4.0, 3.55, 3.15, 2.75, 2.4, 2.05]
    }
  };

  var STELVIO_COHORT_AVG_PEAK_HR_BPM = {
    male: {
      u40: [197, 193, 188, 182, 175, 167, 157],
      '40s': [192, 188, 182, 176, 169, 161, 152],
      '50s': [188, 184, 178, 172, 165, 157, 148],
      '60p': [182, 178, 172, 166, 159, 152, 143]
    },
    female: {
      u40: [191, 187, 182, 176, 169, 161, 152],
      '40s': [186, 182, 176, 170, 163, 155, 146],
      '50s': [182, 178, 172, 166, 159, 151, 142],
      '60p': [176, 172, 166, 160, 153, 146, 137]
    }
  };

  /** 30대 이하(≤39) / 40대 / 50대 / 60대 이상 */
  function getGrowthAgeBracket(age) {
    var a = Number(age);
    if (isNaN(a) || a < 0) return '40s';
    if (a < 40) return 'u40';
    if (a < 50) return '40s';
    if (a < 60) return '50s';
    return '60p';
  }

  function getCohortRow(table, genderKey, growthAgeBracket) {
    var g = genderKey === 'female' ? 'female' : 'male';
    var t = table[g];
    if (!t) return null;
    if (t[growthAgeBracket]) return t[growthAgeBracket];
    return t['40s'] || t.u40;
  }

  /**
   * @returns {{ watts: number, hr: number, cohortAvgWkg: number, cohortAvgPeakHrBpm: number, growthAgeBracket: string }}
   */
  function getGrowthStelvioReferencePowerHr(slotIndex, userProfile) {
    userProfile = userProfile || {};
    var idx = Math.max(0, Math.min(6, Number(slotIndex) || 0));
    var pr = typeof resolveProfileAgeGenderForVO2 === 'function'
      ? resolveProfileAgeGenderForVO2(userProfile)
      : { genderKey: 'male', age: 35 };
    var gk = pr.genderKey === 'female' ? 'female' : 'male';
    var growthBracket = getGrowthAgeBracket(pr.age != null ? pr.age : 35);
    var weightKg = Number(userProfile.weight);
    if (isNaN(weightKg) || weightKg <= 0) weightKg = 70;

    var rowWkg = getCohortRow(STELVIO_COHORT_AVG_PEAK_WKG, gk, growthBracket);
    var rowHr = getCohortRow(STELVIO_COHORT_AVG_PEAK_HR_BPM, gk, growthBracket);
    if (!rowWkg) rowWkg = STELVIO_COHORT_AVG_PEAK_WKG.male['40s'];
    if (!rowHr) rowHr = STELVIO_COHORT_AVG_PEAK_HR_BPM.male['40s'];

    var avgWkg = rowWkg[idx] != null ? Number(rowWkg[idx]) : 4.0;
    var avgPeakHr = rowHr[idx] != null ? Number(rowHr[idx]) : 165;

    var refW = Math.round(avgWkg * weightKg);
    var refHr = Math.round(avgPeakHr);
    refW = Math.max(30, Math.min(2500, refW));
    refHr = Math.max(70, Math.min(220, refHr));

    return {
      watts: refW,
      hr: refHr,
      cohortAvgWkg: Math.round(avgWkg * 100) / 100,
      cohortAvgPeakHrBpm: refHr,
      growthAgeBracket: growthBracket
    };
  }

  global.STELVIO_COHORT_AVG_PEAK_WKG = STELVIO_COHORT_AVG_PEAK_WKG;
  global.STELVIO_COHORT_AVG_PEAK_HR_BPM = STELVIO_COHORT_AVG_PEAK_HR_BPM;
  global.getGrowthAgeBracket = getGrowthAgeBracket;
  global.getGrowthStelvioReferencePowerHr = getGrowthStelvioReferencePowerHr;
  global.GROWTH_PR_SLOT_COUNT = 7;
})(typeof window !== 'undefined' ? window : this);
