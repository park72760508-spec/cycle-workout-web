/**
 * 동적 fTP 산출 — 풀코스(42.195km) 마라톤 예측 (Multi-Point Riegel + 가중치 재분배 + 지구력 패널티)
 * @module dynamicRunFtpCalculation
 */
(function () {
  'use strict';

  var MARATHON_DIST_KM = 42.195;
  var BASE_RIEGEL_EXPONENT = 1.06;
  var SHORT_BAND_LABELS = ['1k', '3k', '5k', '7k'];
  var CASE_C_LABELS = ['1k', '3k', '5k'];

  /** 풀코스 예측 신뢰도 가중치 — 20k=0.40, 1k~10k 합=0.60 */
  var FTP_INTERVAL_CONFIG = [
    { label: '1k', speedField: 'speed_1k', distKm: 1, weight: 0.05 },
    { label: '3k', speedField: 'speed_3k', distKm: 3, weight: 0.05 },
    { label: '5k', speedField: 'speed_5k', distKm: 5, weight: 0.10 },
    { label: '7k', speedField: 'speed_7k', distKm: 7, weight: 0.15 },
    { label: '10k', speedField: 'speed_10k', distKm: 10, weight: 0.25 },
    { label: '20k', speedField: 'speed_20k', distKm: 20, weight: 0.40 }
  ];

  var FTP_GUIDANCE_RECOMMENDED =
    '보다 정확한 풀코스 산출을 위해서는 1k~10k 기록이 반드시 존재해야 합니다.';

  function parseActivityDate(d) {
    if (!d) return null;
    if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return null;
  }

  function getTimeDecayWeight(dateStr) {
    if (typeof window.getEtpTimeDecayWeight === 'function') {
      return window.getEtpTimeDecayWeight(dateStr);
    }
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

  function speedMsToSecPerKm(speedMs) {
    var s = Number(speedMs);
    if (!isFinite(s) || s <= 0) return null;
    return 1000 / s;
  }

  function formatPaceMmSs(secPerKm) {
    var sec = Math.round(Number(secPerKm));
    if (!isFinite(sec) || sec <= 0) return '-';
    var min = Math.floor(sec / 60);
    var s = sec % 60;
    return min + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatPaceSummary(secPerKm) {
    var sec = Math.round(Number(secPerKm));
    if (!isFinite(sec) || sec <= 0) return '-';
    var min = Math.floor(sec / 60);
    var s = sec % 60;
    return min + '분 ' + (s < 10 ? '0' : '') + s + '초/km';
  }

  function formatMarathonFinish(secTotal) {
    var sec = Math.round(Number(secTotal));
    if (!isFinite(sec) || sec <= 0) return '-';
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  function isRunEffortRecord(row) {
    var RUN_ACTIVITY_TYPES = { run: 1, virtualrun: 1, trailrun: 1 };
    if (!row) return false;
    var type = String(row.activity_type || '').trim().toLowerCase();
    if (type && RUN_ACTIVITY_TYPES[type]) return true;
    if (row.source && String(row.source).toLowerCase() === 'strava' && !type) return true;
    return !type;
  }

  function getPacePrRowsFromEfforts(efforts) {
    if (typeof window.getPacePrWithDatesFromEfforts === 'function') {
      var etpRows = window.getPacePrWithDatesFromEfforts(efforts);
      var byLabel = {};
      etpRows.forEach(function (r) { byLabel[r.label] = r; });
      return FTP_INTERVAL_CONFIG.map(function (cfg) {
        var src = byLabel[cfg.label] || {};
        return {
          label: cfg.label,
          speedField: cfg.speedField,
          distKm: cfg.distKm,
          paceSec: src.paceSec != null ? src.paceSec : null,
          dateStr: src.dateStr || null,
          weight: cfg.weight
        };
      });
    }
    var result = [];
    for (var i = 0; i < FTP_INTERVAL_CONFIG.length; i++) {
      var cfg = FTP_INTERVAL_CONFIG[i];
      var bestSec = null;
      var achievedDate = null;
      for (var j = 0; j < efforts.length; j++) {
        var row = efforts[j];
        if (!isRunEffortRecord(row)) continue;
        var sec = speedMsToSecPerKm(row[cfg.speedField]);
        if (sec == null) continue;
        if (bestSec == null || sec < bestSec) {
          bestSec = sec;
          achievedDate = parseActivityDate(row.activity_date || row.date);
        }
      }
      result.push({
        label: cfg.label,
        speedField: cfg.speedField,
        distKm: cfg.distKm,
        paceSec: bestSec,
        dateStr: achievedDate,
        weight: cfg.weight
      });
    }
    return result;
  }

  /**
   * @param {object|null} userProfile
   * @returns {number|null}
   */
  function resolveRunFtpProfileAge(userProfile) {
    if (!userProfile) return null;
    var age = Number(userProfile.age);
    if (!isFinite(age) || age <= 0) {
      var birthYear = userProfile.birth_year != null ? userProfile.birth_year : userProfile.birthYear;
      if (birthYear != null && isFinite(Number(birthYear))) {
        age = new Date().getFullYear() - Number(birthYear);
      } else {
        return null;
      }
    }
    return isFinite(age) && age > 0 && age < 120 ? Math.round(age) : null;
  }

  /**
   * @param {object|null} userProfile
   * @returns {string}
   */
  function resolveRunFtpProfileGenderLabel(userProfile) {
    if (!userProfile) return '미등록';
    var g = String(userProfile.gender || userProfile.sex || '').trim();
    if (!g) return '미등록';
    var gl = g.toLowerCase();
    if (g === '남' || gl === 'male' || gl === 'm' || gl === 'man') return '남';
    if (g === '여' || gl === 'female' || gl === 'f' || gl === 'woman') return '여';
    return g;
  }

  /**
   * 연령·성별에 따른 Riegel 지수 미세 보정 (±0.02 이내)
   * @param {object|null} userProfile
   * @returns {number}
   */
  function getAgeGenderRiegelFactor(userProfile) {
    if (!userProfile) return 0;
    var factor = 0;
    var genderLabel = resolveRunFtpProfileGenderLabel(userProfile);
    if (genderLabel === '여') factor += 0.005;
    var age = resolveRunFtpProfileAge(userProfile);
    if (age != null && age >= 50) factor += 0.005;
    if (age != null && age >= 60) factor += 0.01;
    return Math.min(Math.max(factor, 0), 0.02);
  }

  function hasSegmentData(prRows, label) {
    for (var i = 0; i < prRows.length; i++) {
      if (prRows[i].label === label && prRows[i].paceSec != null && prRows[i].paceSec > 0) return true;
    }
    return false;
  }

  /**
   * @returns {{ penalty: number, caseId: string, penaltyLabels: string[], message: string|null }}
   */
  function resolveFatiguePenaltyContext(prRows) {
    var has20k = hasSegmentData(prRows, '20k');
    var has10k = hasSegmentData(prRows, '10k');
    var has7k = hasSegmentData(prRows, '7k');
    if (!has20k && has10k) {
      return {
        penalty: 0.01,
        caseId: 'A',
        penaltyLabels: SHORT_BAND_LABELS.slice(),
        message: '20k 기록이 없어 1k~7k 구간 예측에 유산소 지구력 패널티(+0.01)가 적용되었습니다.'
      };
    }
    if (!has20k && !has10k && has7k) {
      return {
        penalty: 0.03,
        caseId: 'B',
        penaltyLabels: SHORT_BAND_LABELS.slice(),
        message: '20k·10k 기록이 없어 1k~7k 구간 예측에 장거리 대사 불확실성 패널티(+0.03)가 적용되었습니다.'
      };
    }
    if (!has20k && !has10k && !has7k) {
      return {
        penalty: 0.05,
        caseId: 'C',
        penaltyLabels: CASE_C_LABELS.slice(),
        message: '5k 이하 기록만 있어 1k~5k 구간 예측에 최대 지구력 패널티(+0.05)가 적용되었습니다.'
      };
    }
    return { penalty: 0, caseId: 'none', penaltyLabels: [], message: null };
  }

  function segmentPenaltyApplies(label, penaltyCtx) {
    return penaltyCtx.penalty > 0 && penaltyCtx.penaltyLabels.indexOf(label) >= 0;
  }

  function riegelPredictMarathonSec(paceSecPerKm, distKm, exponent) {
    if (!isFinite(paceSecPerKm) || paceSecPerKm <= 0 || !distKm || distKm <= 0) return null;
    var totalSec = paceSecPerKm * distKm;
    return totalSec * Math.pow(MARATHON_DIST_KM / distKm, exponent);
  }

  function hasRecommended1kTo10kBand(prRows) {
    var required = ['1k', '3k', '5k', '7k', '10k'];
    for (var i = 0; i < required.length; i++) {
      if (!hasSegmentData(prRows, required[i])) return false;
    }
    return true;
  }

  function hasMinimumShortBand(prRows) {
    var labels = ['1k', '3k', '5k', '7k'];
    for (var i = 0; i < labels.length; i++) {
      if (hasSegmentData(prRows, labels[i])) return true;
    }
    return hasSegmentData(prRows, '10k') || hasSegmentData(prRows, '20k');
  }

  /**
   * @param {Array} efforts
   * @param {object|null} [userProfile]
   * @returns {object}
   */
  function calculateDynamicRunFtp(efforts, userProfile) {
    if (!Array.isArray(efforts) || efforts.length === 0) {
      return { success: false, error: '러닝 구간 기록이 없습니다. Strava 러닝 활동을 먼저 동기화해 주세요.' };
    }
    var runEfforts = efforts.filter(isRunEffortRecord);
    if (runEfforts.length === 0) {
      return { success: false, error: '러닝(Run) 활동 구간 데이터가 없습니다.' };
    }

    var prRows = getPacePrRowsFromEfforts(runEfforts);
    if (!hasMinimumShortBand(prRows)) {
      return {
        success: false,
        error: '풀코스 예측을 위해 최소 1k~7k 구간 중 하나 이상의 PR 페이스가 필요합니다.'
      };
    }

    var penaltyCtx = resolveFatiguePenaltyContext(prRows);
    var appliedAge = resolveRunFtpProfileAge(userProfile);
    var appliedGenderLabel = resolveRunFtpProfileGenderLabel(userProfile);
    var ageGenderFactor = getAgeGenderRiegelFactor(userProfile);
    var validRows = prRows.filter(function (r) { return r.paceSec != null && r.paceSec > 0; });
    var validWSum = validRows.reduce(function (s, r) { return s + r.weight; }, 0);
    var renormalized = validWSum > 0 && validWSum < 0.999;

    var sumWeighted = 0;
    var sumWeights = 0;
    var usedCount = 0;
    var details = [];

    for (var i = 0; i < prRows.length; i++) {
      var row = prRows[i];
      if (row.paceSec == null || row.paceSec <= 0) {
        details.push({
          label: row.label,
          distKm: row.distKm,
          paceDisplay: '-',
          paceSec: 0,
          dateStr: row.dateStr,
          predictedMarathonSec: 0,
          predictedMarathonDisplay: '-',
          weight: row.weight,
          normalizedWeight: 0,
          timeDecay: 0,
          appliedWeight: 0,
          baseExponent: BASE_RIEGEL_EXPONENT,
          ageGenderFactor: ageGenderFactor,
          fatiguePenalty: 0,
          finalExponent: BASE_RIEGEL_EXPONENT + ageGenderFactor,
          used: false
        });
        continue;
      }

      var penaltyApplied = segmentPenaltyApplies(row.label, penaltyCtx) ? penaltyCtx.penalty : 0;
      var finalExponent = BASE_RIEGEL_EXPONENT + ageGenderFactor + penaltyApplied;
      var predictedMarathonSec = riegelPredictMarathonSec(row.paceSec, row.distKm, finalExponent);
      var normalizedWeight = validWSum > 0 ? row.weight / validWSum : 0;
      var timeDecay = getTimeDecayWeight(row.dateStr);
      var appliedWeight = normalizedWeight * timeDecay;

      sumWeighted += (predictedMarathonSec || 0) * normalizedWeight * timeDecay;
      sumWeights += appliedWeight;
      usedCount++;

      details.push({
        label: row.label,
        distKm: row.distKm,
        paceDisplay: formatPaceMmSs(row.paceSec),
        paceSec: Math.round(row.paceSec),
        dateStr: row.dateStr,
        predictedMarathonSec: predictedMarathonSec ? Math.round(predictedMarathonSec) : 0,
        predictedMarathonDisplay: predictedMarathonSec ? formatMarathonFinish(predictedMarathonSec) : '-',
        weight: row.weight,
        normalizedWeight: Math.round(normalizedWeight * 1000) / 1000,
        timeDecay: timeDecay,
        appliedWeight: Math.round(appliedWeight * 1000) / 1000,
        baseExponent: BASE_RIEGEL_EXPONENT,
        ageGenderFactor: ageGenderFactor,
        fatiguePenalty: penaltyApplied,
        finalExponent: Math.round(finalExponent * 1000) / 1000,
        used: true
      });
    }

    if (sumWeights <= 0 || usedCount === 0) {
      return {
        success: false,
        error: '6개 구간(1k~20k) 중 유효한 PR 페이스 데이터가 없습니다. 러닝 기록을 동기화해 주세요.'
      };
    }

    var marathonSec = Math.round(sumWeighted / sumWeights);
    var marathonPaceSec = marathonSec / MARATHON_DIST_KM;
    var guidanceMessages = [FTP_GUIDANCE_RECOMMENDED];
    if (!hasRecommended1kTo10kBand(prRows)) {
      guidanceMessages.push('1k~10k 구간 기록이 일부 누락되어 예측 정확도가 낮을 수 있습니다.');
    }
    if (penaltyCtx.message) guidanceMessages.push(penaltyCtx.message);
    if (renormalized) {
      guidanceMessages.push(
        '누락 구간 가중치를 제외하고 유효 가중치 합 ' + Math.round(validWSum * 100) + '% 기준으로 재분배(Normalized)했습니다.'
      );
    }

    return {
      success: true,
      marathonSec: marathonSec,
      marathonDisplay: formatMarathonFinish(marathonSec),
      marathonPaceSec: Math.round(marathonPaceSec),
      marathonPaceDisplay: formatPaceMmSs(marathonPaceSec) + '/km',
      marathonPaceSummary: formatPaceSummary(marathonPaceSec),
      validWSum: Math.round(validWSum * 1000) / 1000,
      renormalized: renormalized,
      penaltyCase: penaltyCtx.caseId,
      penaltyValue: penaltyCtx.penalty,
      ageGenderFactor: ageGenderFactor,
      appliedAge: appliedAge,
      appliedGenderLabel: appliedGenderLabel,
      hasRecommended1kTo10k: hasRecommended1kTo10kBand(prRows),
      guidanceMessages: guidanceMessages,
      guidanceRecommended: FTP_GUIDANCE_RECOMMENDED,
      details: details
    };
  }

  if (typeof window !== 'undefined') {
    window.calculateDynamicRunFtp = calculateDynamicRunFtp;
    window.FTP_INTERVAL_CONFIG = FTP_INTERVAL_CONFIG;
    window.RUN_MARATHON_DIST_KM = MARATHON_DIST_KM;
    window.RUN_FTP_GUIDANCE_RECOMMENDED = FTP_GUIDANCE_RECOMMENDED;
    window.resolveRunFtpFatiguePenalty = resolveFatiguePenaltyContext;
    window.getRunFtpAgeGenderRiegelFactor = getAgeGenderRiegelFactor;
    window.resolveRunFtpProfileAge = resolveRunFtpProfileAge;
    window.resolveRunFtpProfileGenderLabel = resolveRunFtpProfileGenderLabel;
  }
})();
