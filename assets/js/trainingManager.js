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
  'IronMan':   { min: 300, max: 500,  desc: "풀거리 트라이애슬론 완주 목표", target: 400 },
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
  
  // 대소문자 무시하여 키 찾기
  var level = null;
  var levelKey = null;
  for (var key in TRAINING_LEVELS) {
    if (key.toLowerCase() === normalizedChallenge.toLowerCase()) {
      level = TRAINING_LEVELS[key];
      levelKey = key;
      break;
    }
  }
  
  // 매칭되지 않으면 기본값 사용
  if (!level) {
    console.warn('[getWeeklyTargetTSS] Challenge not found:', normalizedChallenge, 'Using default: Fitness');
    level = TRAINING_LEVELS['Fitness'];
    levelKey = 'Fitness';
  }
  
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

// ==========================================================
// 노트북 훈련 화면 전용: 훈련 결과 저장 및 포인트 적립 (모바일과 동일 로직 미러링, 독립 구현)
// - 모바일 handleMobileStop / saveTrainingResultAtEnd 와 동일한 단계·데이터 포맷 사용
// - 노트북 문맥: window.trainingState (elapsedSec), window.currentWorkout, window.currentUser
// ==========================================================

/**
 * 노트북 훈련 종료 시 결과 저장 (모바일 saveTrainingResultAtEnd와 동일한 순서·포맷, 노트북 전용)
 * - trainingResults API(endSession, saveTrainingResult) 사용 → 포인트 계산·저장은 resultManager와 동일
 * @returns {Promise<{ success: boolean, saveResult?: object, hasSessionData?: boolean, canShowResults?: boolean, message?: string }>}
 */
async function saveLaptopTrainingResultAtEnd() {
  console.log('[saveLaptopTrainingResultAtEnd] 🚀 노트북 훈련 결과 저장 시작');

  try {
    // 0. 노트북 문맥: 경과 시간 저장 (resultManager.saveTrainingResult에서 duration 계산에 사용)
    const elapsedSec = window.trainingState?.elapsedSec;
    if (elapsedSec !== undefined && elapsedSec !== null) {
      window.lastElapsedTime = elapsedSec;
      console.log('[saveLaptopTrainingResultAtEnd] 0️⃣ lastElapsedTime 설정:', window.lastElapsedTime);
    }

    // 1. 훈련 종료 전 포인트 값 저장 (결과 화면 표시용, 모바일과 동일)
    const beforeAccPoints = window.currentUser?.acc_points || 0;
    const beforeRemPoints = window.currentUser?.rem_points || 0;
    window.beforeTrainingPoints = {
      acc_points: beforeAccPoints,
      rem_points: beforeRemPoints
    };
    console.log('[saveLaptopTrainingResultAtEnd] 1️⃣ 훈련 전 포인트 저장:', window.beforeTrainingPoints);

    // 2. 세션 종료 처리 (모바일과 동일)
    console.log('[saveLaptopTrainingResultAtEnd] 2️⃣ 세션 종료 처리');
    window.trainingResults?.endSession?.();

    // 3. 추가 메타데이터 (모바일과 동일 구조)
    const extra = {
      workoutId: window.currentWorkout?.id || '',
      workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
      completionType: 'normal',
      appVersion: '1.0.0',
      timestamp: new Date().toISOString()
    };
    console.log('[saveLaptopTrainingResultAtEnd] 3️⃣ 저장 시도, extra:', extra);

    // 4. 저장 시도 (포인트 계산·DB 저장은 resultManager.saveTrainingResult와 동일)
    let saveResult = null;
    try {
      saveResult = await window.trainingResults?.saveTrainingResult?.(extra);
      console.log('[saveLaptopTrainingResultAtEnd] 4️⃣ 저장 결과:', saveResult);
    } catch (saveError) {
      console.error('[saveLaptopTrainingResultAtEnd] ❌ 저장 중 오류:', saveError);
      saveResult = {
        success: false,
        error: saveError && saveError.message,
        fallback: true
      };
    }

    // 5. 결과 검증
    const sessionData = window.trainingResults?.getCurrentSessionData?.();
    if (sessionData) {
      console.log('[saveLaptopTrainingResultAtEnd] 5️⃣ 세션 데이터 확인 완료');
    } else {
      console.warn('[saveLaptopTrainingResultAtEnd] ⚠️ 세션 데이터 없음');
    }

    const finalResult = {
      success: true,
      saveResult: saveResult,
      hasSessionData: !!sessionData,
      canShowResults: true,
      message: saveResult && saveResult.source === 'local' ? '로컬 저장으로 결과 표시' : '정상 저장 완료'
    };
    console.log('[saveLaptopTrainingResultAtEnd] 6️⃣ 최종 결과:', finalResult);
    return finalResult;
  } catch (criticalError) {
    console.error('[saveLaptopTrainingResultAtEnd] 💥 치명적 오류:', criticalError);
    return {
      success: true,
      error: criticalError && criticalError.message,
      fallback: true,
      canShowResults: true,
      message: '오류 발생했지만 결과 화면으로 진행'
    };
  }
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.TRAINING_LEVELS = TRAINING_LEVELS;
  window.getWeeklyTargetTSS = getWeeklyTargetTSS;
  window.calculateWeeklyProgress = calculateWeeklyProgress;
  window.saveLaptopTrainingResultAtEnd = saveLaptopTrainingResultAtEnd;
}
