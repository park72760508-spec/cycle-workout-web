// 이 함수는 app.js의 startMobileWorkout() 함수 다음에 추가되어야 합니다
// 파일: app.js
// 위치: startMobileWorkout() 함수 정의 직후 (약 13495번째 줄)

/**
 * 모바일 개인훈련 대시보드 전용 독립적인 타이머 루프 (Firebase와 무관)
 * Indoor Training의 startSegmentLoop와 유사하지만 모바일 전용 상태를 사용
 */
function startMobileTrainingTimerLoop() {
  console.log('[Mobile Dashboard] 모바일 전용 타이머 루프 시작');
  
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    console.log('[Mobile Dashboard] 모바일 화면이 아니므로 타이머 루프 실행하지 않음');
    return;
  }
  
  const w = window.currentWorkout;
  if (!w || !w.segments || w.segments.length === 0) {
    console.error('[Mobile Dashboard] 워크아웃 또는 세그먼트가 없습니다:', w);
    return;
  }
  
  const mts = window.mobileTrainingState;
  
  // 기존 타이머가 있으면 정리
  if (mts.timerId) {
    clearInterval(mts.timerId);
    mts.timerId = null;
  }
  
  console.log('[Mobile Dashboard] 타이머 시작, 총 시간:', mts.totalSec, '초');
  
  // 1초마다 실행되는 메인 루프
  mts.timerId = setInterval(() => {
    // 모바일 화면 체크
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    const isMobileActive = mobileScreen && 
      (mobileScreen.classList.contains('active') || 
       window.getComputedStyle(mobileScreen).display !== 'none');
    
    if (!isMobileActive) {
      // 모바일 화면이 아니면 타이머 정지
      console.log('[Mobile Dashboard] 모바일 화면이 아니므로 타이머 정지');
      if (mts.timerId) {
        clearInterval(mts.timerId);
        mts.timerId = null;
      }
      return;
    }
    
    if (!mts) {
      console.error('[Mobile Dashboard] mobileTrainingState가 없습니다!');
      return;
    }
    
    if (mts.paused) {
      // 일시정지 중이면 스킵
      return;
    }
    
    // === 시간 진행(벽시계 기반) ===
    const nowMs = Date.now();
    
    if (!mts.workoutStartMs) {
      console.warn('[Mobile Dashboard] workoutStartMs가 없어서 현재 시간으로 설정합니다.');
      mts.workoutStartMs = nowMs;
      mts.pauseAccumMs = 0;
      mts.pausedAtMs = null;
    }
    
    // 일시정지 누적 반영
    const pausedMs = mts.pauseAccumMs + (mts.pausedAtMs ? (nowMs - mts.pausedAtMs) : 0);
    const newElapsedSec = Math.floor((nowMs - mts.workoutStartMs - pausedMs) / 1000);
    
    // 음수 방지
    if (newElapsedSec < 0) {
      console.warn('[Mobile Dashboard] 경과 시간이 음수입니다. workoutStartMs를 재설정합니다.');
      mts.workoutStartMs = nowMs;
      mts.pauseAccumMs = 0;
      mts.elapsedSec = 0;
    } else {
      mts.elapsedSec = newElapsedSec;
    }
    
    // 현재 세그 경과초 계산
    const cumStart = getCumulativeStartSec(mts.segIndex);
    mts.segElapsedSec = Math.max(0, mts.elapsedSec - cumStart);
    
    // 세그먼트 정보
    const currentSegIndex = mts.segIndex;
    const currentSeg = w.segments[currentSegIndex];
    if (!currentSeg) {
      console.error('[Mobile Dashboard] 현재 세그먼트가 없습니다. 인덱스:', currentSegIndex);
      return;
    }
    const segDur = segDurationSec(currentSeg);
    const segRemaining = segDur - mts.segElapsedSec;
    
    // UI 업데이트
    // 1. 경과 시간 표시
    const timerEl = safeGetElement('mobile-main-timer');
    if (timerEl) {
      const hours = Math.floor(mts.elapsedSec / 3600);
      const minutes = Math.floor((mts.elapsedSec % 3600) / 60);
      const seconds = Math.floor(mts.elapsedSec % 60);
      timerEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    // 2. 랩 카운트다운 표시
    const lapTimeEl = safeGetElement('mobile-ui-lap-time');
    if (lapTimeEl && segRemaining >= 0) {
      const lapMinutes = Math.floor(segRemaining / 60);
      const lapSeconds = Math.floor(segRemaining % 60);
      lapTimeEl.textContent = `${String(lapMinutes).padStart(2, '0')}:${String(lapSeconds).padStart(2, '0')}`;
      lapTimeEl.setAttribute('fill', segRemaining <= 10 ? '#ff4444' : '#00d4aa');
    }
    
    // 3. 세그먼트 그래프 업데이트 (마스코트 위치)
    if (typeof drawSegmentGraph === 'function') {
      drawSegmentGraph(w.segments, currentSegIndex, 'mobileIndividualSegmentGraph', mts.elapsedSec);
    }
    
    // 4. 세그먼트 정보 업데이트
    if (typeof updateMobileDashboardUI === 'function') {
      updateMobileDashboardUI();
    }
    
    // 전체 종료 판단
    if (mts.elapsedSec >= mts.totalSec) {
      console.log('[Mobile Dashboard] 훈련 완료!');
      clearInterval(mts.timerId);
      mts.timerId = null;
      
      if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
      
      // 결과 모달 표시
      Promise.resolve()
        .then(() => window.saveTrainingResultAtEnd?.())
        .catch((e) => { console.warn('[Mobile Dashboard] saveTrainingResultAtEnd error', e); })
        .then(() => window.trainingResults?.initializeResultScreen?.())
        .catch((e) => { console.warn('[Mobile Dashboard] initializeResultScreen error', e); })
        .then(() => { 
          if (typeof showMobileTrainingResultModal === 'function') {
            showMobileTrainingResultModal();
          }
        });
      return;
    }
    
    // 세그먼트 경계 통과 → 다음 세그먼트로 전환
    const prevSegIndex = mts._lastProcessedSegIndex ?? currentSegIndex;
    const segEndAtSec = getCumulativeStartSec(currentSegIndex) + segDur;
    const shouldTransition = (mts.segElapsedSec >= segDur || mts.elapsedSec >= segEndAtSec) && prevSegIndex === currentSegIndex;
    
    if (shouldTransition) {
      console.log(`[Mobile Dashboard] 세그먼트 ${currentSegIndex + 1} 완료, 다음 세그먼트로 이동`);
      
      const nextSegIndex = currentSegIndex + 1;
      mts.segIndex = nextSegIndex;
      mts.segElapsedSec = 0;
      mts._lastProcessedSegIndex = nextSegIndex;
      
      // 다음 세그먼트의 카운트다운 상태 초기화
      if (nextSegIndex < w.segments.length) {
        const nextSeg = w.segments[nextSegIndex];
        const nextSegDur = segDurationSec(nextSeg);
        mts._countdownFired[String(nextSegIndex)] = {};
        mts._prevRemainMs[String(nextSegIndex)] = nextSegDur * 1000;
      }
      
      if (nextSegIndex < w.segments.length) {
        console.log(`[Mobile Dashboard] 세그먼트 ${nextSegIndex + 1}로 전환`);
        if (typeof updateMobileDashboardUI === 'function') {
          updateMobileDashboardUI();
        }
      } else {
        console.log('[Mobile Dashboard] 모든 세그먼트 완료');
      }
    } else if (prevSegIndex !== currentSegIndex) {
      mts._lastProcessedSegIndex = currentSegIndex;
    }
    
  }, 1000); // 1초마다 실행
}
