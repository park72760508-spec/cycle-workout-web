/* ==========================================================
   Training Manager - 훈련 등급별 TSS 목표 계산
   - 주간 목표 TSS (Weekly Target TSS) 계산 로직
   - 대시보드에서 사용
========================================================== */

/**
 * 훈련 등급별 주간 권장 TSS 범위
 */
const TRAINING_LEVELS = {
  'Fitness':   { min: 150, max: 300,  desc: "건강 유지 및 기초 체력", target: 225 },
  'GranFondo': { min: 300, max: 500,  desc: "중장거리 완주 목표", target: 400 },
  'Racing':    { min: 500, max: 700,  desc: "MCT/아마추어 레이스 입상권", target: 600 },
  'Elite':     { min: 700, max: 900,  desc: "최상위 동호인 및 선수 준비", target: 800 },
  'PRO':       { min: 900, max: 1200, desc: "프로 선수 레벨", target: 1050 }
};

/**
 * 사용자의 훈련 등급에 따른 주간 목표 TSS 계산
 * @param {string} challenge - 사용자의 훈련 등급 ('Fitness', 'GranFondo', 'Racing', 'Elite', 'PRO')
 * @param {number} [customTarget] - 사용자 지정 목표 (선택사항, 없으면 등급별 기본 target 사용)
 * @returns {Object} { target: number, min: number, max: number, desc: string }
 */
function getWeeklyTargetTSS(challenge, customTarget) {
  // challenge 정규화 (대소문자 무시, 공백 제거)
  const normalizedChallenge = String(challenge || 'Fitness').trim();
  
  // 등급별 설정 가져오기
  const level = TRAINING_LEVELS[normalizedChallenge] || TRAINING_LEVELS['Fitness'];
  
  // 사용자 지정 목표가 있으면 사용, 없으면 등급별 기본 target 사용
  const target = customTarget && customTarget > 0 ? customTarget : level.target;
  
  return {
    target: Math.max(level.min, Math.min(level.max, target)), // min~max 범위 내로 제한
    min: level.min,
    max: level.max,
    desc: level.desc
  };
}

/**
 * 주간 진행률 계산 (0~100%)
 * @param {number} currentTSS - 현재 주간 누적 TSS
 * @param {number} targetTSS - 주간 목표 TSS
 * @returns {number} 진행률 (0~100)
 */
function calculateWeeklyProgress(currentTSS, targetTSS) {
  if (!targetTSS || targetTSS <= 0) return 0;
  const progress = (currentTSS / targetTSS) * 100;
  return Math.min(100, Math.max(0, progress)); // 0~100%로 제한
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.TRAINING_LEVELS = TRAINING_LEVELS;
  window.getWeeklyTargetTSS = getWeeklyTargetTSS;
  window.calculateWeeklyProgress = calculateWeeklyProgress;
}
