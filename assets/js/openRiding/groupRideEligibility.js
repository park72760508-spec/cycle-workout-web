/**
 * 오픈 라이딩 — 평지 항속·그룹 드래프팅 기반 참가 적합성 (FTP·체중)
 * @module groupRideEligibility
 */

/**
 * 평지에서 공기저항·구름저항을 반영해 일정 파워로 유지 가능한 평균 속도(km/h)를 구합니다.
 * CdA는 체중에 따른 단순 근사(도로 자전거·드롭바 자세 가정)입니다.
 *
 * @param {number} power 절대 파워(W). FTP(60분 지속 파워)를 넣으면 '개인 평속' 근사에 사용합니다.
 * @param {number} weight 체중(kg)
 * @returns {number} 예상 평지 평균 속도(km/h). 입력이 유효하지 않으면 0.
 */
export function calculateSpeedOnFlat(power, weight) {
  var P = Number(power);
  var m = Number(weight);
  if (!isFinite(P) || P <= 0 || !isFinite(m) || m <= 0) return 0;

  var rho = 1.225;
  var g = 9.81;
  var Crr = 0.0045;
  var CdA = 0.328 + (m - 70) * 0.0012;
  if (CdA < 0.22) CdA = 0.22;
  if (CdA > 0.42) CdA = 0.42;

  function powerAtV(vMs) {
    var aero = 0.5 * rho * CdA * vMs * vMs * vMs;
    var roll = Crr * m * g * vMs;
    return aero + roll;
  }

  var lo = 0.1;
  var hi = 40;
  var i;
  for (i = 0; i < 55; i++) {
    var mid = (lo + hi) / 2;
    if (powerAtV(mid) < P) lo = mid;
    else hi = mid;
  }
  var vMs = (lo + hi) / 2;
  return vMs * 3.6;
}

/**
 * RIDING_LEVEL_OPTIONS의 value에 대응하는 '모임 기준 평속'(km/h) 근사.
 * 각 레벨 구간의 상한(또는 상급은 35km/h 이상 구간의 대표 페이스)을 targetSpeed로 사용합니다.
 *
 * @param {string} levelValue 예: '초급', '입문', '중급'
 * @returns {number|null}
 */
export function getRidingLevelTargetSpeedKmH(levelValue) {
  var map = {
    초급: 25,
    입문: 28,
    중급: 32,
    중상급: 35,
    /** 35km/h 이상 — 팩 페이스 상층 근사 */
    상급: 38
  };
  var k = String(levelValue || '').trim();
  return map[k] != null ? map[k] : null;
}

/** 맞춤 필터 — 관심 레벨: 피크 부재 시 FTP 평지 평속에 곱하는 계수 */
var FTP_FALLBACK_FOR_FILTER_SOLO = 0.93;

var OPEN_RIDING_INTEREST_LEVEL_ORDER = ['초급', '입문', '중급', '중상급', '상급'];

/** 항속 구간 → 티어 인덱스(0=초급 … 4=상급) */
function soloSpeedTierIndexFromKmH(soloKmh) {
  var v = Number(soloKmh);
  if (!isFinite(v)) return 0;
  if (v < 25) return 0;
  if (v < 28) return 1;
  if (v < 32) return 2;
  if (v < 35) return 3;
  return 4;
}

function interestLevelValueToTierIndex(levelValue) {
  var k = String(levelValue || '').trim();
  var i = OPEN_RIDING_INTEREST_LEVEL_ORDER.indexOf(k);
  return i >= 0 ? i : -1;
}

/** 관심 레벨 티어의 구간 하한(km/h) — 초급 0, 입문 25, … */
function interestLevelBandMinKmHByTierIndex(tierIdx) {
  var mins = [0, 25, 28, 32, 35];
  if (tierIdx < 0 || tierIdx >= mins.length) return 0;
  return mins[tierIdx];
}

/**
 * 맞춤 필터용 참조 평지 개인 평속(km/h)
 * - 60분 피크(W)가 있으면 그 파워로 산출
 * - 없으면 FTP 평지 개인 평속 × 93%
 *
 * @param {number} peakWatts 60분 최고 평균 파워(없으면 0)
 * @param {number} ftpWatts FTP
 * @param {number} weightKg
 * @returns {number|null}
 */
export function getFilterInterestReferenceSoloSpeedKmH(peakWatts, ftpWatts, weightKg) {
  var w = Number(weightKg);
  var peak = Number(peakWatts);
  var ftp = Number(ftpWatts);
  if (!isFinite(w) || w <= 0) return null;
  if (isFinite(peak) && peak > 0) {
    var sPeak = calculateSpeedOnFlat(peak, w);
    return Math.round(sPeak * 100) / 100;
  }
  if (isFinite(ftp) && ftp > 0) {
    var sFtp = calculateSpeedOnFlat(ftp, w);
    return Math.round(sFtp * FTP_FALLBACK_FOR_FILTER_SOLO * 100) / 100;
  }
  return null;
}

/**
 * 맞춤 필터 — 관심 레벨 체크박스 배지(참석 가능/주의/불가)
 * 평지 개인 평속(60분 피크 우선, 없으면 FTP×93%)을 초급~상급 항속 구간과 비교합니다.
 *
 * @param {number} userSoloKmh getFilterInterestReferenceSoloSpeedKmH 결과
 * @param {string} levelValue '초급' … '상급'
 * @returns {{ tier: string, label: string, comment: string, estimatedGroupSpeed: number, targetSpeed: number, margin: number } | null}
 */
export function classifyOpenRidingInterestLevelFilter(userSoloKmh, levelValue) {
  var needIdx = interestLevelValueToTierIndex(levelValue);
  if (needIdx < 0) return null;
  var u = Number(userSoloKmh);
  if (!isFinite(u) || u <= 0) return null;

  var userIdx = soloSpeedTierIndexFromKmH(u);
  var bandMin = interestLevelBandMinKmHByTierIndex(needIdx);
  var tgt = getRidingLevelTargetSpeedKmH(levelValue);
  var marginTier = userIdx - needIdx;

  if (userIdx >= needIdx) {
    return {
      tier: 'go',
      label: '참석 가능',
      comment:
        '참조 평지 개인 평속 ' +
        u +
        'km/h(60분 피크, 없으면 FTP 평속×' +
        String(FTP_FALLBACK_FOR_FILTER_SOLO) +
        ') 기준, 이 관심 레벨 구간과 같거나 상위 난이도에 맞습니다.',
      estimatedGroupSpeed: Math.round(u * 10) / 10,
      targetSpeed: tgt != null ? tgt : bandMin,
      margin: marginTier
    };
  }
  if (userIdx === needIdx - 1) {
    return {
      tier: 'caution',
      label: '주의',
      comment:
        '참조 평지 개인 평속은 바로 아래 구간에 가깝습니다. 컨디션·바람에 따라 버거울 수 있으니 한 단계 낮은 관심도 검토해 보세요.',
      estimatedGroupSpeed: Math.round(u * 10) / 10,
      targetSpeed: tgt != null ? tgt : bandMin,
      margin: marginTier
    };
  }
  return {
    tier: 'stop',
    label: '불가',
    comment:
      '참조 평지 개인 평속 기준으로는 이 관심 레벨보다 두 단계 이상 낮은 구간에 가깝습니다. 하위 레벨을 권장합니다.',
    estimatedGroupSpeed: Math.round(u * 10) / 10,
    targetSpeed: tgt != null ? tgt : bandMin,
    margin: marginTier
  };
}

/**
 * 평지 개인 평속(km/h)에 해당하는 레벨 명칭(초급~상급)
 * @param {number} soloKmh 60분 피크 또는 FTP×93% 등 참조 평속
 * @returns {string}
 */
export function getOpenRidingSoloTierLevelLabelFromKmH(soloKmh) {
  var idx = soloSpeedTierIndexFromKmH(soloKmh);
  return OPEN_RIDING_INTEREST_LEVEL_ORDER[idx] || '초급';
}

/**
 * 평지 개인 항속(solo km/h)에 필요한 W/kg — calculateSpeedOnFlat 역추정 (분포 차트 등급 막대·눈금 환산용)
 *
 * @param {number} soloSpeedKmH 목표 평지 평균 속도(km/h) (예: 25, 28, …)
 * @param {number} weightKg 체중(kg)
 * @returns {number|null}
 */
export function wkgForOpenRidingSoloSpeedKmH(soloSpeedKmH, weightKg) {
  var target = Number(soloSpeedKmH);
  var w = Number(weightKg);
  if (!isFinite(target) || target <= 0 || !isFinite(w) || w <= 0) return null;
  var lo = 0.5;
  var hi = 2000;
  var i;
  for (i = 0; i < 72; i++) {
    var mid = (lo + hi) / 2;
    var spd = calculateSpeedOnFlat(mid, w);
    if (spd < target) lo = mid;
    else hi = mid;
  }
  var P = (lo + hi) / 2;
  return Math.round((P / w) * 100) / 100;
}

/** 참가 판정과 동일: 그룹 목표 평속(km/h)을 맞추려면 개인 평속이 target/1.2이어야 함 */
var OPEN_RIDING_DRAFTING_FACTOR = 1.2;

/**
 * 모임 레벨의 '그룹 기준 평속'을 충족하는 데 필요한 W/kg (같은 평지·드래프팅 모델).
 *
 * @param {number} groupTargetSpeedKmH getRidingLevelTargetSpeedKmH와 동일 스케일 (예: 25)
 * @param {number} weightKg 체중(kg)
 * @returns {number|null}
 */
export function wkgForOpenRidingGroupTargetSpeed(groupTargetSpeedKmH, weightKg) {
  var tgt = Number(groupTargetSpeedKmH);
  var w = Number(weightKg);
  if (!isFinite(tgt) || tgt <= 0 || !isFinite(w) || w <= 0) return null;
  var soloNeededKmH = tgt / OPEN_RIDING_DRAFTING_FACTOR;
  var lo = 1;
  var hi = 1000;
  var i;
  for (i = 0; i < 70; i++) {
    var mid = (lo + hi) / 2;
    var spd = calculateSpeedOnFlat(mid, w);
    if (spd < soloNeededKmH) lo = mid;
    else hi = mid;
  }
  var P = (lo + hi) / 2;
  return Math.round((P / w) * 100) / 100;
}

/**
 * FTP·체중·모임 기준 평속으로 그룹 라이딩 적합성을 평가합니다.
 * - 개인 평속: calculateSpeedOnFlat(ftp, weight)
 * - 드래프팅 효과: 아웃도어 팩에서 공기저항 부담 감소를 계수 1.2로 근사(개인 평속 × 1.2 = 예상 그룹 평속)
 *
 * @param {number} ftp 사용자 FTP(W)
 * @param {number} weight 체중(kg)
 * @param {number} targetSpeed 모임에서 요구하는 기준 평속(km/h)
 * @returns {{
 *   wkg: number,
 *   soloSpeed: number,
 *   estimatedGroupSpeed: number,
 *   isEligible: boolean,
 *   guideMessage: string
 * }}
 */
export function evaluateGroupRideEligibility(ftp, weight, targetSpeed) {
  var f = Number(ftp);
  var w = Number(weight);
  var tgt = Number(targetSpeed);

  if (!isFinite(f) || f <= 0 || !isFinite(w) || w <= 0) {
    return {
      wkg: 0,
      soloSpeed: 0,
      estimatedGroupSpeed: 0,
      isEligible: false,
      guideMessage: '프로필에 FTP와 체중을 등록하면 맞춤 분석이 표시됩니다.'
    };
  }

  if (!isFinite(tgt) || tgt <= 0) {
    var soloOnly = calculateSpeedOnFlat(f, w);
    var D0 = 1.2;
    return {
      wkg: Math.round((f / w) * 100) / 100,
      soloSpeed: Math.round(soloOnly * 10) / 10,
      estimatedGroupSpeed: Math.round(soloOnly * D0 * 10) / 10,
      isEligible: false,
      guideMessage: ''
    };
  }

  var wkg = Math.round((f / w) * 100) / 100;
  var soloSpeed = calculateSpeedOnFlat(f, w);

  /** 드래프팅 계수: 그룹 라이딩 시 개인 대비 유효 항속 상승을 1.2배로 단순화 */
  var DRAFTING_FACTOR = 1.2;
  var estimatedGroupSpeed = soloSpeed * DRAFTING_FACTOR;

  var isEligible = estimatedGroupSpeed >= tgt;

  var margin = estimatedGroupSpeed - tgt;
  var guideMessage;
  if (margin >= 5) {
    guideMessage = '충분히 여유 있게 팩 속도를 맞출 수 있는 편입니다.';
  } else if (margin >= 1) {
    guideMessage = '해당 레벨 모임에 참가하기에 무리가 크지 않은 수준입니다. 컨디션을 확인해 보세요.';
  } else if (margin >= -2) {
    guideMessage =
      '경계선에 가깝습니다. 바람·지형에 따라 버거울 수 있으니 한 단계 낮은 레벨도 검토해 보세요.';
  } else {
    guideMessage = '현재 FTP로는 팩을 따라가기 벅찰 수 있습니다. 한 단계 낮은 레벨을 추천합니다.';
  }

  return {
    wkg: wkg,
    soloSpeed: Math.round(soloSpeed * 10) / 10,
    estimatedGroupSpeed: Math.round(estimatedGroupSpeed * 10) / 10,
    isEligible: isEligible,
    guideMessage: guideMessage
  };
}

/**
 * 라이딩 모임 레벨(평속 상한) 대비 참가 난이도 3단계 — 60분 피크(또는 FTP)·체중·드래프팅 1.2× 동일 모델.
 *
 * @param {number} powerW 60분 최고 평균 파워(W) 또는 FTP(W)
 * @param {number} weightKg 체중(kg)
 * @param {string} rideLevelValue 모임 레벨 문자열 (예: '중급')
 * @returns {{ tier: 'go'|'caution'|'stop', label: string, comment: string, estimatedGroupSpeed: number, targetSpeed: number, margin: number } | null}
 */
export function classifyOpenRidingParticipation(powerW, weightKg, rideLevelValue) {
  var tgt = getRidingLevelTargetSpeedKmH(rideLevelValue);
  if (tgt == null) return null;
  var p = Number(powerW);
  var w = Number(weightKg);
  if (!isFinite(p) || p <= 0 || !isFinite(w) || w <= 0) return null;

  var ev = evaluateGroupRideEligibility(p, w, tgt);
  var margin = ev.estimatedGroupSpeed - tgt;

  if (margin >= 1) {
    return {
      tier: 'go',
      label: '참석 가능',
      comment:
        '현실 지표(60분 피크·체중) 기준 예상 그룹 항속이 이 모임 레벨 요구를 안정적으로 충족합니다.',
      estimatedGroupSpeed: ev.estimatedGroupSpeed,
      targetSpeed: tgt,
      margin: Math.round(margin * 10) / 10
    };
  }
  if (margin >= -2) {
    return {
      tier: 'caution',
      label: '주의',
      comment:
        '경계에 가깝습니다. 컨디션·풍향·지형에 따라 버거울 수 있으니 한 단계 낮은 레벨도 검토해 보세요.',
      estimatedGroupSpeed: ev.estimatedGroupSpeed,
      targetSpeed: tgt,
      margin: Math.round(margin * 10) / 10
    };
  }
  return {
    tier: 'stop',
    label: '불가',
    comment:
      '현실 지표 기준 예상 그룹 항속이 모임 요구에 크게 못 미칩니다. 하위 레벨 모임을 권장합니다.',
    estimatedGroupSpeed: ev.estimatedGroupSpeed,
    targetSpeed: tgt,
    margin: Math.round(margin * 10) / 10
  };
}

/**
 * 난이도 순(쉬운 것 → 어려운 것) 레벨 문자열 배열에 대해,
 * '참석 가능'인 가장 어려운 레벨과, 그게 없을 때 '주의'인 가장 어려운 레벨.
 *
 * @param {number} powerW
 * @param {number} weightKg
 * @param {string[]} levelValuesEasiestFirst
 * @returns {{ maxGoLevel: string|null, maxCautionLevel: string|null }}
 */
export function getMaxRidingLevelsForPeakParticipation(powerW, weightKg, levelValuesEasiestFirst) {
  var arr = Array.isArray(levelValuesEasiestFirst) ? levelValuesEasiestFirst.slice() : [];
  var maxGo = null;
  var maxCaution = null;
  var i;
  for (i = arr.length - 1; i >= 0; i--) {
    var r = classifyOpenRidingParticipation(powerW, weightKg, arr[i]);
    if (r && r.tier === 'go') {
      maxGo = arr[i];
      break;
    }
  }
  if (!maxGo) {
    for (i = arr.length - 1; i >= 0; i--) {
      var r2 = classifyOpenRidingParticipation(powerW, weightKg, arr[i]);
      if (r2 && r2.tier === 'caution') {
        maxCaution = arr[i];
        break;
      }
    }
  }
  return { maxGoLevel: maxGo, maxCautionLevel: maxCaution };
}

if (typeof window !== 'undefined') {
  window.calculateSpeedOnFlat = calculateSpeedOnFlat;
  window.evaluateGroupRideEligibility = evaluateGroupRideEligibility;
  window.getRidingLevelTargetSpeedKmH = getRidingLevelTargetSpeedKmH;
  window.wkgForOpenRidingGroupTargetSpeed = wkgForOpenRidingGroupTargetSpeed;
  window.getFilterInterestReferenceSoloSpeedKmH = getFilterInterestReferenceSoloSpeedKmH;
  window.classifyOpenRidingInterestLevelFilter = classifyOpenRidingInterestLevelFilter;
  window.getOpenRidingSoloTierLevelLabelFromKmH = getOpenRidingSoloTierLevelLabelFromKmH;
  window.wkgForOpenRidingSoloSpeedKmH = wkgForOpenRidingSoloSpeedKmH;
  window.classifyOpenRidingParticipation = classifyOpenRidingParticipation;
  window.getMaxRidingLevelsForPeakParticipation = getMaxRidingLevelsForPeakParticipation;
}
