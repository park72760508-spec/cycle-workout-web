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
 * RIDING_LEVEL_OPTIONS의 value에 대응하는 '모임 기준 평속'(km/h) 상한 근사.
 * 관심 레벨 필터 힌트(항속 구간)의 상한을 targetSpeed로 사용합니다.
 *
 * @param {string} levelValue 예: '초급', '중급'
 * @returns {number|null}
 */
export function getRidingLevelTargetSpeedKmH(levelValue) {
  var map = {
    초급: 25,
    중급: 30,
    중상급: 35,
    /** '35km/h 이상' 구간 — 팩 상층 페이스를 다소 높게 잡은 기준 */
    상급: 38
  };
  var k = String(levelValue || '').trim();
  return map[k] != null ? map[k] : null;
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
      label: '참가',
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

if (typeof window !== 'undefined') {
  window.calculateSpeedOnFlat = calculateSpeedOnFlat;
  window.evaluateGroupRideEligibility = evaluateGroupRideEligibility;
  window.getRidingLevelTargetSpeedKmH = getRidingLevelTargetSpeedKmH;
  window.classifyOpenRidingParticipation = classifyOpenRidingParticipation;
}
