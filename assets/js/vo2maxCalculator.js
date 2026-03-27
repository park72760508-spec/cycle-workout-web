/**
 * VO2max 연령·성별 참고 기준 (ACSM / Cooper Institute 계열 일반 성인 자료를 참고한 추정치)
 * ml/kg/min — 의학적 진단이 아닌 트레이닝·대시보드 참고용입니다.
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

  /** "1:30:00", "45:00", 숫자(분) 등 → 분 */
  function coerceDurationToMinutes(duration) {
    if (duration == null) return 0;
    if (typeof duration === 'number' && isFinite(duration) && duration >= 0) return duration;
    var s = String(duration).trim();
    if (!s) return 0;
    var parts = s.split(':').map(function (p) {
      return parseFloat(p, 10);
    });
    if (parts.some(function (x) {
      return isNaN(x);
    })) return 0;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    var n = parseFloat(s, 10);
    return isFinite(n) ? n : 0;
  }

  /**
   * 로그 1건에서 지속시간(초) 추출 (일별 합산·세션 로그 공통)
   */
  function parseLogDurationSec(row) {
    if (!row || typeof row !== 'object') return 0;
    var sec = Number(row.duration_sec);
    if (isFinite(sec) && sec > 0) return sec;
    var t = Number(row.time);
    if (isFinite(t) && t > 0) return t;
    var dm = Number(row.duration_min);
    if (isFinite(dm) && dm > 0) return Math.round(dm * 60);
    if (row.duration != null) {
      var minFromStr = typeof global.parseDurationToMinutes === 'function'
        ? global.parseDurationToMinutes(row.duration)
        : coerceDurationToMinutes(row.duration);
      if (isFinite(minFromStr) && minFromStr > 0) return Math.round(minFromStr * 60);
    }
    return 0;
  }

  /**
   * NP/평균파워 후보 필드 통합
   */
  function parseLogNpWatts(row) {
    if (!row || typeof row !== 'object') return 0;
    var v = Number(
      row.np != null
        ? row.np
        : row.weighted_watts != null
          ? row.weighted_watts
          : row.normPower != null
            ? row.normPower
            : row.NP != null
              ? row.NP
              : row.avg_watts != null
                ? row.avg_watts
                : row.avgPower != null
                  ? row.avgPower
                  : row.avg_power != null
                    ? row.avg_power
                    : 0
    );
    return isFinite(v) && v > 0 ? v : 0;
  }

  function clampVo2MlKg(n) {
    return Math.max(20, Math.min(100, Math.round(Number(n))));
  }

  /**
   * STELVIO 대시보드·코치용 VO₂max 추정 (ml/kg/min, 정수).
   * conditionScoreModule의 computeVo2maxEstimate와 동일 계열: VO₂max ≈ 15×(w/kg)+3.5 (파워·체중 기반).
   *
   * @param {Object|null} profile - ftp, weight 등
   * @param {Array<Object>} logs - (1) 월별 일자 합산 배열 또는 (2) 세션 로그 배열. 빈 배열이면 null.
   * @returns {number|null} 훈련이 없거나 파워로 산출 불가하면 null (월별 트렌드에서 0 처리)
   */
  function calculateStelvioVO2Max(profile, logs) {
    profile = profile && typeof profile === 'object' ? profile : {};
    if (!Array.isArray(logs) || logs.length === 0) {
      return null;
    }
    var wKg = Number(profile.weight) || 0;
    if (wKg <= 0) wKg = 70;

    var totalSec = 0;
    var sumNpSec = 0;
    var i;
    for (i = 0; i < logs.length; i++) {
      var row = logs[i];
      var sec = parseLogDurationSec(row);
      var np = parseLogNpWatts(row);
      if (sec <= 0) continue;
      totalSec += sec;
      sumNpSec += np * sec;
    }

    if (totalSec < 60) {
      return null;
    }

    var avgNp = sumNpSec / totalSec;
    if (!isFinite(avgNp) || avgNp <= 0) {
      return null;
    }

    return clampVo2MlKg(15 * (avgNp / wKg) + 3.5);
  }

  global.parseLogDurationSecForVO2 = parseLogDurationSec;
  global.parseLogNpWattsForVO2 = parseLogNpWatts;
  global.calculateStelvioVO2Max = calculateStelvioVO2Max;
})(typeof window !== 'undefined' ? window : this);
