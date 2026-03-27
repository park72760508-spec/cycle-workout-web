/**
 * VO2max 연령·성별 참고 기준 (ACSM / Cooper Institute 계열 일반 성인 자료를 참고한 추정치)
 * ml/kg/min — 의학적 진단이 아닌 트레이닝·대시보드 참고용입니다.
 */
(function (global) {
  'use strict';

  /** 연령대별·성별 일반 성인 집단 평균에 가까운 참고값 (가로 기준선용) */
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
  global.getVo2maxAgeBracket = getAgeBracket;
  global.normalizeGenderForVO2 = normalizeGender;
  global.evaluateVO2maxLevel = evaluateVO2maxLevel;
  global.resolveProfileAgeGenderForVO2 = resolveProfileAgeGenderForVO2;
  global.getVo2maxReferenceAverageMlKg = getReferenceAverageMlKg;
})(typeof window !== 'undefined' ? window : this);
