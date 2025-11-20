// Updated: 2025-11-17 14:13 (KST) - 실시간 데이터 저장/갱신 로직 개선 및 구글 시트 구조 설계
// Updated: 2025-11-17 15:02 (KST) - 다른 사용자 상태 동기화 개선 (블루투스 상태 실시간 전송 강화)

/* ==========================================================
   groupTrainingManager_part2.js - 그룹 훈련 대기실 및 모니터링 기능
   그룹 훈련 관리 모듈의 2부
========================================================== */

// groupTrainingState 전역 참조 (groupTrainingManager.js에서 정의됨)
// groupTrainingManager.js가 먼저 로드되어야 함
// 안전하게 초기화 (groupTrainingManager.js가 로드되지 않은 경우를 대비)
if (!window.groupTrainingState) {
  console.warn('groupTrainingState가 아직 초기화되지 않았습니다. groupTrainingManager.js가 먼저 로드되어야 합니다.');
  window.groupTrainingState = {
    currentRoom: null,
    isAdmin: false,
    isManager: false,
    participants: [],
    roomCode: null,
    syncInterval: null,
    managerInterval: null,
    isConnected: false,
    lastSyncTime: null
  };
}
const groupTrainingState = window.groupTrainingState;





// ========== 대기실 참가자 기능들 ==========

/**
 * 준비 상태 토글
 */
async function toggleReady() {
  if (!groupTrainingState.currentRoom) return;
  
  const room = groupTrainingState.currentRoom;
  const myId = window.currentUser?.id || 'user_' + Date.now();
  const normalizeParticipantId = (participant) => {
    const pid = participant?.id ?? participant?.participantId ?? participant?.userId;
    return pid !== undefined && pid !== null ? String(pid) : '';
  };
  const match = (participant) => normalizeParticipantId(participant) === String(myId);
  
  // 내 참가자 정보 찾기
  const myParticipant = room.participants.find(match);
  if (!myParticipant) {
    showToast('참가자 정보를 찾을 수 없습니다', 'error');
    return;
  }
  
  // 준비 상태 변경 (다양한 필드명 지원)
  const wasReady = typeof isParticipantReady === 'function' 
    ? isParticipantReady(myParticipant) 
    : (myParticipant.ready !== undefined ? myParticipant.ready : (myParticipant.isReady !== undefined ? myParticipant.isReady : false));
  const newReadyState = !wasReady;
  
  // 모든 가능한 필드에 준비 상태 저장
  myParticipant.ready = newReadyState;
  myParticipant.isReady = newReadyState;
  const participantKey = typeof getParticipantIdentifier === 'function'
    ? getParticipantIdentifier(myParticipant)
    : (myParticipant.id || myParticipant.participantId || myParticipant.userId || String(myId));
  const applyReadyOverride = () => {
    if (typeof setReadyOverride === 'function' && participantKey) {
      setReadyOverride(participantKey, newReadyState);
    }
  };
  
  try {
    // 백엔드 업데이트
    const updatedParticipants = room.participants.map(p => {
      if (match(p)) {
        return { 
          ...p, 
          ready: newReadyState,
          isReady: newReadyState
        };
      }
      return p;
    });

    // updateRoomOnBackend 함수 찾기 (전역 또는 로컬)
    const updateRoomFunc = typeof updateRoomOnBackend === 'function' 
      ? updateRoomOnBackend 
      : (typeof window.updateRoomOnBackend === 'function' 
          ? window.updateRoomOnBackend 
          : null);
    
    if (!updateRoomFunc) {
      // apiUpdateRoom을 직접 사용
      if (typeof apiUpdateRoom === 'function') {
        const result = await apiUpdateRoom(groupTrainingState.roomCode, {
          participants: updatedParticipants
        });
        
        if (result && result.success !== false) {
          groupTrainingState.currentRoom.participants = updatedParticipants;
          
          // 준비 상태 오버라이드 설정 (서버 동기화 지연 대비)
          // TTL을 갱신하여 자동 리셋 방지
          applyReadyOverride();
          
          // 오버라이드 TTL 갱신 (서버 업데이트 성공 시 만료 시간 연장)
          if (typeof setReadyOverride === 'function' && participantKey) {
            setReadyOverride(participantKey, newReadyState);
          }
          
          // UI 업데이트
          const readyBtn = safeGet('readyToggleBtn');
          if (readyBtn) {
            readyBtn.textContent = newReadyState ? '✅ 준비 완료' : '⏳ 준비 중';
            readyBtn.classList.toggle('ready', newReadyState);
          }
          
          // 참가자 목록 업데이트
          if (typeof updateParticipantsList === 'function') {
            updateParticipantsList();
          }
          
          // 시작 버튼 상태 업데이트
          if (typeof updateStartButtonState === 'function') {
            updateStartButtonState();
          }
          
          // 준비 완료 시 대기 상태 유지 (훈련 화면으로 전환하지 않음)
          if (newReadyState && !wasReady) {
            showToast('✅ 준비 완료! 관리자가 훈련을 시작할 때까지 대기합니다.', 'success');
          } else if (!newReadyState) {
            showToast('⏳ 준비 취소', 'info');
          }
          return;
        } else {
          throw new Error(result?.error || '방 업데이트 실패');
        }
      } else {
        throw new Error('apiUpdateRoom 함수를 찾을 수 없습니다');
      }
    }

    const success = await updateRoomFunc({
      ...room,
      participants: updatedParticipants
    });
    
    if (success) {
      groupTrainingState.currentRoom.participants = updatedParticipants;
      
      // 준비 상태 오버라이드 설정 (서버 동기화 지연 대비)
      // TTL을 갱신하여 자동 리셋 방지
      applyReadyOverride();
      
      // 오버라이드 TTL 갱신 (서버 업데이트 성공 시 만료 시간 연장)
      if (typeof setReadyOverride === 'function' && participantKey) {
        setReadyOverride(participantKey, newReadyState);
      }
      
      // UI 업데이트
      const readyBtn = safeGet('readyToggleBtn');
      if (readyBtn) {
        readyBtn.textContent = newReadyState ? '✅ 준비 완료' : '⏳ 준비 중';
        readyBtn.classList.toggle('ready', newReadyState);
      }
      
      // 참가자 목록 업데이트
      if (typeof updateParticipantsList === 'function') {
        updateParticipantsList();
      }
      
      // 시작 버튼 상태 업데이트
      if (typeof updateStartButtonState === 'function') {
        updateStartButtonState();
      }
      
      // 준비 완료 시 대기 상태 유지 (훈련 화면으로 전환하지 않음)
      if (newReadyState && !wasReady) {
        showToast('✅ 준비 완료! 관리자가 훈련을 시작할 때까지 대기합니다.', 'success');
      } else if (!newReadyState) {
        showToast('⏳ 준비 취소', 'info');
      }
    } else {
      throw new Error('방 업데이트 실패');
    }
    
  } catch (error) {
    console.error('Failed to toggle ready:', error);
    showToast('준비 상태 변경에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
    // 상태 되돌리기
    myParticipant.ready = wasReady;
    myParticipant.isReady = wasReady;
  }
}

/**
 * 그룹 훈련 컨트롤 바 초기화
 */
function setupGroupTrainingControlBar() {
  const bar = document.getElementById('groupTrainingControlBar');
  if (!bar) return;

  if (!groupTrainingState.isAdmin) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');

  const skipBtn = document.getElementById('groupSkipSegmentBtn');
  const toggleBtn = document.getElementById('groupToggleTrainingBtn');
  const stopBtn = document.getElementById('groupStopTrainingBtn');

  if (skipBtn && !skipBtn.dataset.bound) {
    skipBtn.addEventListener('click', handleGroupSegmentSkip);
    skipBtn.dataset.bound = '1';
  }
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.addEventListener('click', handleGroupTrainingToggle);
    toggleBtn.dataset.bound = '1';
  }
  if (stopBtn && !stopBtn.dataset.bound) {
    stopBtn.addEventListener('click', handleGroupTrainingStop);
    stopBtn.dataset.bound = '1';
  }

  updateGroupTrainingControlButtons();
}

/**
 * 그룹 훈련: 세그먼트 건너뛰기
 */
function handleGroupSegmentSkip() {
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 사용할 수 있습니다', 'error');
    return;
  }

  const trainingState = window.trainingState || {};
  if (!trainingState.isRunning) {
    showToast('진행 중인 훈련이 없습니다', 'warning');
    return;
  }

  if (typeof skipCurrentSegment === 'function') {
    skipCurrentSegment();
  } else {
    showToast('세그먼트를 건너뛸 수 없습니다', 'error');
  }
}

/**
 * 그룹 훈련: 시작 / 일시정지 토글
 */
async function handleGroupTrainingToggle() {
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 사용할 수 있습니다', 'error');
    return;
  }

  const trainingState = window.trainingState || {};

  if (!trainingState.isRunning) {
    if (typeof startGroupTraining === 'function') {
      await startGroupTraining();
    } else if (typeof startWorkoutTraining === 'function') {
      startWorkoutTraining();
    } else {
      showToast('훈련을 시작할 수 없습니다', 'error');
    }
    return;
  }

  if (typeof togglePause === 'function') {
    togglePause();
  } else if (typeof setPaused === 'function') {
    setPaused(!trainingState.paused);
  } else {
    showToast('일시정지 기능을 찾을 수 없습니다', 'error');
  }

  updateGroupTrainingControlButtons();
}

/**
 * 그룹 훈련: 강제 종료
 */
function handleGroupTrainingStop() {
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 사용할 수 있습니다', 'error');
    return;
  }

  const trainingState = window.trainingState || {};
  if (!trainingState.isRunning) {
    showToast('진행 중인 훈련이 없습니다', 'warning');
    return;
  }

  const confirmed = confirm('정말 훈련을 종료하시겠습니까?\n현재 진행 중인 세션이 종료됩니다.');
  if (!confirmed) return;

  if (typeof stopSegmentLoop === 'function') {
    stopSegmentLoop();
  } else {
    showToast('훈련 종료 기능을 찾을 수 없습니다', 'error');
  }

  updateGroupTrainingControlButtons();
}

/**
 * 그룹 컨트롤 버튼 상태 갱신 (전역 노출)
 */
function updateGroupTrainingControlButtons() {
  const toggleBtn = document.getElementById('groupToggleTrainingBtn');
  const skipBtn = document.getElementById('groupSkipSegmentBtn');
  const stopBtn = document.getElementById('groupStopTrainingBtn');
  const trainingState = window.trainingState || {};
  const running = !!trainingState.isRunning;
  const paused = !!trainingState.paused;

  if (toggleBtn) {
    toggleBtn.classList.remove('play', 'pause');
    let ariaLabel = '훈련 시작';

    if (!running) {
      toggleBtn.classList.add('play');
      ariaLabel = '훈련 시작';
    } else if (paused) {
      toggleBtn.classList.add('play');
      ariaLabel = '훈련 재개';
    } else {
      toggleBtn.classList.add('pause');
      ariaLabel = '훈련 일시정지';
    }

    toggleBtn.setAttribute('aria-label', ariaLabel);
  }

  if (skipBtn) {
    skipBtn.disabled = !running;
    skipBtn.title = running ? '' : '훈련이 시작되면 활성화됩니다';
  }

  if (stopBtn) {
    stopBtn.disabled = !running;
    stopBtn.title = running ? '훈련을 강제 종료합니다' : '훈련이 시작되면 활성화됩니다';
  }
}

window.updateGroupTrainingControlButtons = updateGroupTrainingControlButtons;

/**
 * 훈련 화면으로 전환 (타이머는 멈춘 상태로 시작)
 */
async function moveToTrainingScreenWithPausedTimer() {
  try {
    const room = groupTrainingState.currentRoom;
    if (!room || !room.workoutId) {
      showToast('워크아웃 정보가 없습니다', 'error');
      return;
    }
    
    // 워크아웃 로드
    if (room.workoutId) {
      try {
        // apiGetWorkout 함수 사용
        if (typeof apiGetWorkout === 'function') {
          const workoutResult = await apiGetWorkout(room.workoutId);
          if (workoutResult && workoutResult.success && workoutResult.item) {
            window.currentWorkout = workoutResult.item;
            // 로컬 스토리지에도 저장
            try {
              localStorage.setItem('currentWorkout', JSON.stringify(workoutResult.item));
            } catch (e) {
              console.warn('로컬 스토리지 저장 실패:', e);
            }
          } else {
            console.warn('워크아웃 로드 실패:', workoutResult?.error);
            showToast('워크아웃 정보를 불러올 수 없습니다', 'error');
            return;
          }
        } else {
          console.warn('apiGetWorkout 함수를 찾을 수 없습니다');
        }
      } catch (error) {
        console.error('워크아웃 로드 중 오류:', error);
        showToast('워크아웃 로드 중 오류가 발생했습니다', 'error');
        return;
      }
    }
    
    // 그룹 훈련 모드 설정
    window.isGroupTraining = true;
    window.groupTrainingRoom = {
      ...room,
      code: groupTrainingState.roomCode,
      isAdmin: false
    };
    
    // 훈련 화면으로 전환
    if (typeof showScreen === 'function') {
      showScreen('trainingScreen');
    }
    
    // 훈련 초기화 (타이머는 시작하지 않음)
    if (typeof startWorkoutTraining === 'function') {
      // 훈련 상태 초기화
      if (window.trainingState) {
        window.trainingState.elapsedSec = 0;
        window.trainingState.segElapsedSec = 0;
        window.trainingState.segIndex = 0;
        window.trainingState.paused = true; // 일시정지 상태로 시작
        window.trainingState.isRunning = false; // 실행 중이 아님
      }
      
      // 워크아웃 초기화만 수행 (타이머는 시작하지 않음)
      initializeWorkoutForGroupTraining();
      
      // 시작 신호 확인 시작
      startCheckingTrainingStartSignal();
    }
    
    showToast('훈련 화면으로 이동했습니다. 관리자가 시작할 때까지 대기합니다.', 'info');
    
  } catch (error) {
    console.error('Failed to move to training screen:', error);
    showToast('훈련 화면으로 이동하는데 실패했습니다', 'error');
  }
}

/**
 * 그룹 훈련용 워크아웃 초기화 (타이머 시작 없이)
 */
function initializeWorkoutForGroupTraining() {
  try {
    const w = window.currentWorkout;
    if (!w) {
      console.error('No workout available');
      return;
    }
    
    // 세그먼트 타임라인 생성
    if (typeof buildSegmentBar === 'function') {
      buildSegmentBar();
    }
    
    // 첫 세그먼트 타겟 적용
    if (typeof applySegmentTarget === 'function') {
      applySegmentTarget(0);
    }
    
    // 시간 UI 초기화
    if (typeof updateTimeUI === 'function') {
      updateTimeUI();
    }
    
    // 차트 초기화
    if (window.initTrainingCharts) {
      window.initTrainingCharts();
    }
    
    // 사용자 정보 렌더링
    if (typeof renderUserInfo === 'function') {
      renderUserInfo();
    }
    
    console.log('✅ 그룹 훈련 워크아웃 초기화 완료 (타이머 대기 중)');
    
  } catch (error) {
    console.error('Failed to initialize workout:', error);
  }
}

/**
 * 훈련 시작 신호 확인 시작
 */
function startCheckingTrainingStartSignal() {
  // 기존 인터벌 정리
  if (window.trainingStartCheckInterval) {
    clearInterval(window.trainingStartCheckInterval);
  }
  
  // 1초마다 시작 신호 확인
  window.trainingStartCheckInterval = setInterval(async () => {
    try {
      const roomCode = groupTrainingState.roomCode;
      if (!roomCode) {
        clearInterval(window.trainingStartCheckInterval);
        return;
      }
      
      // 방 정보 가져오기
      const roomResponse = await apiGetRoom(roomCode);
      if (!roomResponse?.success || !roomResponse.item) {
        return;
      }
      
      const room = normalizeRoomData(roomResponse.item);
      if (!room) return;
      
      // 훈련 시작 시간 확인
      const trainingStartTime = room.trainingStartTime || room.TrainingStartTime;
      
      if (trainingStartTime) {
        // 시작 신호가 있으면 타이머 시작
        clearInterval(window.trainingStartCheckInterval);
        window.trainingStartCheckInterval = null;
        
        // 시작 시간 계산 (서버 시간 기준)
        const startTime = new Date(trainingStartTime).getTime();
        const now = Date.now();
        const delay = Math.max(0, startTime - now);
        
        if (delay > 0) {
          // 약간의 지연이 있으면 대기
          setTimeout(() => {
            startGroupTrainingTimer();
          }, delay);
        } else {
          // 이미 시작 시간이 지났으면 즉시 시작
          startGroupTrainingTimer();
        }
      }
      
    } catch (error) {
      console.error('Failed to check training start signal:', error);
    }
  }, 1000); // 1초마다 확인
}

/**
 * 그룹 훈련 타이머 시작
 */
function startGroupTrainingTimer() {
  try {
    console.log('🚀 그룹 훈련 타이머 시작!');
    
    // 훈련 상태 활성화
    if (window.trainingState) {
      window.trainingState.paused = false;
      window.trainingState.isRunning = true;
      const expectedStart = groupTrainingState.currentRoom?.trainingStartTime;
      const startMs = expectedStart ? new Date(expectedStart).getTime() : Date.now();
      window.trainingState.workoutStartMs = startMs;
      window.trainingState.pauseAccumMs = 0;
      window.trainingState.pausedAtMs = null;
    }
    
    // 세그먼트 루프 시작
    if (typeof startSegmentLoop === 'function') {
      startSegmentLoop();
    } else if (typeof startWorkoutTraining === 'function') {
      // 폴백: 전체 훈련 시작
      startWorkoutTraining();
    }
    
    // 화면 항상 켜짐 요청
    if (typeof ScreenAwake !== 'undefined' && ScreenAwake.acquire) {
      ScreenAwake.acquire();
    }
    
    showToast('훈련이 시작되었습니다!', 'success');
    
  } catch (error) {
    console.error('Failed to start training timer:', error);
    showToast('훈련 시작에 실패했습니다', 'error');
  }
}

/**
 * 방 나가기 (무한 재귀 방지)
 */
async function leaveGroupRoom() {
  // 재귀 방지 플래그
  if (groupTrainingState._leaving) {
    console.warn('방 나가기 이미 진행 중입니다');
    return;
  }
  
  try {
    groupTrainingState._leaving = true;
    console.log('🚪 그룹 훈련방에서 나가는 중...');
    
    // 동기화 인터벌 정리
    if (groupTrainingState.syncInterval) {
      clearInterval(groupTrainingState.syncInterval);
      groupTrainingState.syncInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 실시간 데이터 동기화 중지
    if (typeof stopParticipantDataSync === 'function') {
      stopParticipantDataSync();
    }
    
    // 방에서 참가자 제거 (백엔드 업데이트)
    if (groupTrainingState.currentRoom && groupTrainingState.roomCode) {
      try {
        const userId = window.currentUser?.id || 'unknown';
        if (typeof apiLeaveRoom === 'function') {
          await apiLeaveRoom(groupTrainingState.roomCode, userId);
          console.log('✅ 방에서 성공적으로 나갔습니다');
        }
      } catch (error) {
        console.error('❌ 방 나가기 중 백엔드 업데이트 실패:', error);
        // 백엔드 업데이트 실패해도 로컬 상태는 정리
      }
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    groupTrainingState.participants = [];
    groupTrainingState.isConnected = false;
    groupTrainingState.lastSyncTime = null;
    
    // 훅 호출
    if (window.groupTrainingHooks?.endSession) {
      window.groupTrainingHooks.endSession();
    }
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupRoomScreen');
    } else {
      // 대체 방법: 그룹 화면들 숨기기
      const groupScreens = ['groupWaitingScreen', 'groupTrainingScreen'];
      groupScreens.forEach(screenId => {
        const screen = document.getElementById(screenId);
        if (screen) {
          screen.classList.add('hidden');
        }
      });
    }
    
    showToast('그룹 훈련방에서 나왔습니다', 'info');
    
  } catch (error) {
    console.error('❌ 방 나가기 중 오류:', error);
    showToast('방 나가기 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  } finally {
    // 재귀 방지 플래그 해제
    groupTrainingState._leaving = false;
  }
}

/**
 * 방 코드 복사
 */
function copyRoomCode() {
  // groupTrainingState가 전역으로 노출되어 있는지 확인
  const state = window.groupTrainingState || groupTrainingState;
  const roomCode = state?.roomCode;
  if (!roomCode) {
    showToast('방 코드를 찾을 수 없습니다', 'error');
    return;
  }
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomCode).then(() => {
      showToast('방 코드가 복사되었습니다!', 'success');
    }).catch(() => {
      fallbackCopyText(roomCode);
    });
  } else {
    fallbackCopyText(roomCode);
  }
}

/**
 * 텍스트 복사 대체 함수
 */
function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showToast('방 코드가 복사되었습니다!', 'success');
  } catch (err) {
    showToast('복사에 실패했습니다. 방 코드: ' + text, 'error');
  }
  
  document.body.removeChild(textArea);
}

// ========== 관리자 대기실 기능들 ==========

/**
 * 그룹 훈련 시작
 */
async function startGroupTraining() {
  if (!groupTrainingState.isAdmin || !groupTrainingState.currentRoom) {
    showToast('관리자만 훈련을 시작할 수 있습니다', 'error');
    return;
  }
  
  const room = groupTrainingState.currentRoom;
  
  const participantCount = room.participants.length;
  if (participantCount < 2) {
    showToast('최소 2명의 참가자가 필요합니다', 'error');
    return;
  }
  
  const readyCount = typeof countReadyParticipants === 'function'
    ? countReadyParticipants(room.participants)
    : room.participants.filter(p => p.ready).length;
  
  if (readyCount < participantCount) {
    showToast(`준비되지 않은 참가자가 있지만 훈련을 시작합니다 (${readyCount}/${participantCount})`, 'warning');
  }
  
  try {
    showToast('그룹 훈련을 시작합니다...', 'info');
    
    // 그룹운동 대기 상태 표시
    showGroupTrainingWaitingStatus();
    
    // 방 상태를 'starting'으로 변경 (카운트다운 중)
    room.status = 'starting';
    room.countdownStartTime = new Date().toISOString();
    
    // 백엔드 업데이트
    const success = await updateRoomOnBackend(room);
    
    if (success) {
      // 관리자 제어 카운트다운 시작 (10초)
      startAdminControlledCountdown(10);
    } else {
      throw new Error('Failed to start training');
    }
    
  } catch (error) {
    console.error('Failed to start group training:', error);
    showToast('그룹 훈련 시작에 실패했습니다', 'error');
    // 대기 상태 오버레이 제거
    const waitingOverlay = document.getElementById('groupTrainingWaitingOverlay');
    if (waitingOverlay) {
      waitingOverlay.remove();
    }
  }
}

/**
 * 그룹운동 대기 상태 표시
 */
function showGroupTrainingWaitingStatus() {
  // 기존 오버레이가 있으면 제거
  const existingOverlay = document.getElementById('groupTrainingWaitingOverlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  // 대기 상태 오버레이 생성
  const overlay = document.createElement('div');
  overlay.id = 'groupTrainingWaitingOverlay';
  overlay.className = 'group-training-waiting-overlay';
  overlay.innerHTML = `
    <div class="waiting-content">
      <div class="waiting-icon">⏳</div>
      <h2>그룹운동 대기 중</h2>
      <p>모든 참가자가 준비되었습니다.</p>
      <p>곧 훈련이 시작됩니다...</p>
      <div class="waiting-spinner">
        <div class="spinner"></div>
      </div>
    </div>
  `;
  
  // 스타일 추가 (없는 경우)
  if (!document.getElementById('groupTrainingWaitingStyles')) {
    const style = document.createElement('style');
    style.id = 'groupTrainingWaitingStyles';
    style.textContent = `
      .group-training-waiting-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
      }
      .waiting-content {
        background: white;
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        max-width: 400px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      }
      .waiting-icon {
        font-size: 64px;
        margin-bottom: 20px;
      }
      .waiting-content h2 {
        margin: 0 0 10px 0;
        color: #333;
      }
      .waiting-content p {
        margin: 10px 0;
        color: #666;
      }
      .waiting-spinner {
        margin-top: 20px;
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(overlay);
  
  // 훈련 시작 시 오버레이 자동 제거 (5초 후 또는 훈련 시작 시)
  setTimeout(() => {
    const overlayToRemove = document.getElementById('groupTrainingWaitingOverlay');
    if (overlayToRemove) {
      overlayToRemove.remove();
    }
  }, 15000); // 15초 후 자동 제거 (안전장치)
}

/**
 * 관리자 제어 카운트다운 시스템 (모든 참가자가 동시에 시작)
 */
async function startAdminControlledCountdown(seconds = 10) {
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
  // 대기 상태 오버레이 제거
  const waitingOverlay = document.getElementById('groupTrainingWaitingOverlay');
  if (waitingOverlay) {
    waitingOverlay.remove();
  }
  
  // 관리자 화면에 카운트다운 표시
  if (groupTrainingState.isAdmin) {
    showAdminCountdownOverlay(seconds);
  }
  
  // 모든 참가자에게 카운트다운 시작 신호 전송
  await broadcastCountdownStart(seconds);
  
  // 백엔드에 카운트다운 시작 시간 저장
  const countdownEndTime = new Date(Date.now() + seconds * 1000).toISOString();
  await apiUpdateRoom(groupTrainingState.roomCode, {
    countdownEndTime: countdownEndTime,
    status: 'starting'
  });
  
  // 카운트다운 완료 후 실제 훈련 시작
  setTimeout(async () => {
    room.status = 'training';
    const startIso = new Date().toISOString();
    room.startedAt = startIso;
    room.trainingStartTime = startIso;
    
    await updateRoomOnBackend(room);
    await broadcastTrainingStart();
    
    // 실제 훈련 세션 시작
    startGroupTrainingSession();
  }, seconds * 1000);
}

/**
 * 관리자 카운트다운 오버레이 표시
 */
function showAdminCountdownOverlay(seconds) {
  const overlay = document.createElement('div');
  overlay.id = 'adminCountdownOverlay';
  overlay.className = 'countdown-overlay';
  overlay.innerHTML = `
    <div class="countdown-content">
      <h2>🚀 그룹 훈련 시작!</h2>
      <div class="countdown-number" id="adminCountdownNumber">${seconds}</div>
      <p>모든 참가자가 동시에 시작합니다</p>
      <button class="btn btn-danger" onclick="cancelGroupCountdown()">취소</button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  let count = seconds;
  const countdownInterval = setInterval(() => {
    count--;
    const numberEl = document.getElementById('adminCountdownNumber');
    if (numberEl) {
      numberEl.textContent = count;
      
      if (count <= 3) {
        numberEl.style.color = '#e74c3c';
        numberEl.style.transform = 'scale(1.2)';
      }
    }
    
    if (count <= 0) {
      clearInterval(countdownInterval);
      overlay.remove();
    }
  }, 1000);
}

/**
 * 참가자 카운트다운 표시 (동기화)
 */
function showParticipantCountdown(seconds) {
  return new Promise((resolve) => {
    if (typeof showToast === 'function') {
      showToast('관리자가 훈련 시작을 알렸습니다. 잠시 후 시작합니다!', 'info');
    }
    
    const existing = document.getElementById('participantCountdownOverlay');
    if (existing) {
      existing.remove();
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'participantCountdownOverlay';
    overlay.className = 'countdown-overlay';
    overlay.innerHTML = `
      <div class="countdown-content">
        <h2>🚀 곧 훈련이 시작됩니다</h2>
        <div class="countdown-number" id="participantCountdownNumber">${seconds}</div>
        <p>관리자가 훈련을 시작합니다. 준비해주세요!</p>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    let count = seconds;
    const countdownInterval = setInterval(() => {
      count--;
      const numberEl = document.getElementById('participantCountdownNumber');
      if (numberEl) {
        numberEl.textContent = count;
        
        if (count <= 3) {
          numberEl.style.color = '#e74c3c';
          numberEl.style.transform = 'scale(1.2)';
        }
      }
      
      if (count <= 0) {
        clearInterval(countdownInterval);
        overlay.remove();
        resolve();
      }
    }, 1000);
  });
}

/**
 * 카운트다운 취소
 */
async function cancelGroupCountdown() {
  const room = groupTrainingState.currentRoom;
  if (!room || !groupTrainingState.isAdmin) return;
  
  room.status = 'waiting';
  delete room.countdownStartTime;
  delete room.countdownEndTime;
  
  await updateRoomOnBackend(room);
  await broadcastCountdownCancel();
  
  const overlay = document.getElementById('adminCountdownOverlay');
  if (overlay) overlay.remove();
  
  showToast('카운트다운이 취소되었습니다', 'info');
}

/**
 * 카운트다운 시작 브로드캐스트
 */
async function broadcastCountdownStart(seconds) {
  // 실제 구현 시 웹소켓 또는 서버 푸시 사용
  console.log(`Broadcasting countdown start: ${seconds} seconds`);
  
  // 참가자들은 방 동기화를 통해 카운트다운 시작 시간을 감지
  if (typeof checkAndSyncCountdown === 'function') {
    checkAndSyncCountdown();
  }
}

/**
 * 카운트다운 취소 브로드캐스트
 */
async function broadcastCountdownCancel() {
  console.log('Broadcasting countdown cancel');
  
  const overlay = document.getElementById('participantCountdownOverlay');
  if (overlay) overlay.remove();
}

/**
 * 참가자가 카운트다운 동기화 확인
 */
async function checkAndSyncCountdown() {
  if (!groupTrainingState.roomCode) return;
  
  try {
    const roomRes = await apiGetRoom(groupTrainingState.roomCode);
    if (roomRes?.success && roomRes.item) {
      const room = normalizeRoomData(roomRes.item);
      
      if (room.status === 'starting' && room.countdownEndTime) {
        // 대기 상태 오버레이 제거
        const waitingOverlay = document.getElementById('groupTrainingWaitingOverlay');
        if (waitingOverlay) {
          waitingOverlay.remove();
        }
        
        const endTime = new Date(room.countdownEndTime);
        const now = new Date();
        const remainingSeconds = Math.max(0, Math.ceil((endTime - now) / 1000));
        
        if (remainingSeconds > 0) {
          showParticipantCountdown(remainingSeconds);
        }
      } else if (room.status === 'waiting' && room.participants) {
        // 모든 참가자가 준비되었는지 확인
        const allReady = room.participants.every(p => {
          return typeof isParticipantReady === 'function'
            ? isParticipantReady(p)
            : (p.ready !== undefined ? p.ready : (p.isReady !== undefined ? p.isReady : false));
        });
        
        // 모든 참가자가 준비되었고 아직 시작하지 않았으면 대기 상태 표시
        if (allReady && room.participants.length >= 2 && !groupTrainingState.isAdmin) {
          const existingOverlay = document.getElementById('groupTrainingWaitingOverlay');
          if (!existingOverlay) {
            showGroupTrainingWaitingStatus();
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to sync countdown:', error);
  }
}

/**
 * 그룹 훈련 세션 시작 (실제 훈련 화면으로 전환)
 */
function startGroupTrainingSession() {
  try {
    const canAutoStart = typeof shouldAutoStartLocalTraining === 'function'
      ? shouldAutoStartLocalTraining()
      : true;
    if (groupTrainingState.isAdmin && !canAutoStart) {
      console.log('관리자 모니터링 모드 - startGroupTrainingSession 실행을 건너뜁니다');
      return;
    }
    
    const roomSnapshot = {
      ...(groupTrainingState.currentRoom || {}),
      code: groupTrainingState.roomCode,
      isAdmin: !!groupTrainingState.isAdmin,
      participants: (groupTrainingState.currentRoom?.participants || []).slice()
    };

    if (window.groupTrainingHooks?.beginSession) {
      window.groupTrainingHooks.beginSession(roomSnapshot);
    } else {
      // 폴백: 기존 로직 활용
      window.isGroupTraining = true;
      window.groupTrainingRoom = roomSnapshot;
      if (typeof startWorkoutTraining === 'function') {
        startWorkoutTraining();
      } else if (typeof startTraining === 'function') {
        startTraining();
      } else {
        console.error('startTraining function not found');
        showToast('훈련 시작 기능을 찾을 수 없습니다', 'error');
        return;
      }
    }

    // 모니터링 버튼 추가
    addMonitoringButton();
    
    // 실시간 데이터 전송 시작 (관리자 포함 모든 사용자)
    startParticipantDataSync();
    
    showToast('그룹 훈련이 시작되었습니다!', 'success');
    
  } catch (error) {
    console.error('Failed to start training session:', error);
    showToast('훈련 세션 시작에 실패했습니다', 'error');
  }
}

/**
 * 참가자 실시간 데이터 동기화 시작
 * 훈련방 입장 순간부터 즉시 첫 데이터를 전송하고, 이후 3초마다 주기적으로 전송
 */
function startParticipantDataSync() {
  // 기존 인터벌 정리
  if (window.participantDataSyncInterval) {
    clearInterval(window.participantDataSyncInterval);
  }
  
  console.log('🔄 참가자 실시간 데이터 동기화 시작');
  
  // 즉시 첫 데이터 전송 (훈련방 입장 순간부터 데이터 저장 시작)
  syncParticipantLiveData().catch(err => {
    console.warn('⚠️ 첫 데이터 전송 실패 (재시도 예정):', err);
  });
  
  // 3초마다 블루투스 데이터를 백엔드에 전송
  window.participantDataSyncInterval = setInterval(async () => {
    await syncParticipantLiveData();
  }, 3000); // 3초마다 전송
}

/**
 * 참가자 실시간 데이터 동기화 중지
 */
function stopParticipantDataSync() {
  if (window.participantDataSyncInterval) {
    clearInterval(window.participantDataSyncInterval);
    window.participantDataSyncInterval = null;
    console.log('⏹️ 참가자 실시간 데이터 동기화 중지');
  }
}

/**
 * 참가자 실시간 데이터를 백엔드에 전송
 * 훈련방 입장 순간부터 실시간으로 데이터를 저장/갱신
 */
async function syncParticipantLiveData() {
  try {
    const roomCode = groupTrainingState?.roomCode;
    const participantId = window.currentUser?.id;
    
    if (!roomCode || !participantId) {
      return; // 방 코드나 참가자 ID가 없으면 전송하지 않음
    }
    
    // 블루투스에서 실시간 데이터 및 연결 상태 가져오기
    const connectedDevices = window.connectedDevices || {};
    const liveData = window.liveData || {};
    
    // 훈련 진행률 계산 (trainingState에서 가져오기)
    const trainingState = window.trainingState || {};
    const currentWorkout = window.currentWorkout;
    let progress = 0;
    let segmentIndex = 0;
    let segmentTargetPowerW = 0;
    let segmentAvgPowerW = 0;
    let currentPowerW = 0;
    
    if (currentWorkout && currentWorkout.segments) {
      const elapsedSec = trainingState.elapsedSec || 0;
      const totalDuration = currentWorkout.segments.reduce((sum, seg) => {
        return sum + (seg.duration_sec || 0);
      }, 0);
      
      if (totalDuration > 0) {
        progress = Math.min(100, Math.floor((elapsedSec / totalDuration) * 100));
      }
      
      // 현재 세그먼트 인덱스 가져오기
      segmentIndex = trainingState.segIndex || 0;
      const currentSegment = currentWorkout.segments[segmentIndex];
      
      // 현재 세그먼트 타깃 파워 계산
      if (currentSegment) {
        const ftp = Number(window.currentUser?.ftp) || 200;
        const ftpPercent = getSegmentFtpPercent(currentSegment);
        segmentTargetPowerW = Math.round(ftp * (ftpPercent / 100));
      } else {
        segmentTargetPowerW = trainingState.currentTargetPowerW || trainingState.targetPowerW || 0;
      }
      
      // 현재 세그먼트 평균 파워 계산 (segBar에서 가져오기)
      if (typeof window.segBar !== 'undefined' && window.segBar) {
        const segBar = window.segBar;
        if (segBar.samples && segBar.samples[segmentIndex] && segBar.sumPower && segBar.sumPower[segmentIndex]) {
          const samples = segBar.samples[segmentIndex] || 0;
          segmentAvgPowerW = samples > 0 ? Math.round(segBar.sumPower[segmentIndex] / samples) : 0;
        }
      }
      
      // 세그먼트 평균값을 가져올 수 없는 경우 대체 방법 시도
      if (segmentAvgPowerW === 0) {
        // DOM에서 직접 가져오기
        const avgEl = document.getElementById('avgSegmentPowerValue');
        if (avgEl) {
          const avgText = avgEl.textContent || avgEl.innerText || '';
          const avgNum = parseFloat(avgText);
          if (!isNaN(avgNum) && avgNum > 0) {
            segmentAvgPowerW = Math.round(avgNum);
          }
        }
      }
      
      // 전체 평균 파워 (세션 전체 평균)
      const overallAvgPower = liveData.avgPower || liveData.averagePower || segmentAvgPowerW || 0;
      
      // 현재 파워값
      currentPowerW = liveData.power || liveData.instantPower || 0;
    } else {
      // 워크아웃이 없는 경우 (대기실 상태)
      segmentTargetPowerW = trainingState.currentTargetPowerW || trainingState.targetPowerW || 0;
      currentPowerW = liveData.power || liveData.instantPower || 0;
      segmentAvgPowerW = liveData.avgPower || liveData.averagePower || 0;
    }
    
    // 백엔드에 데이터 전송 (BLE 상태 + 메트릭 확장)
    const result = await apiSaveParticipantLiveData(roomCode, participantId, {
      bluetoothStatus: {
        trainer: !!(connectedDevices.trainer && connectedDevices.trainer.device),
        powerMeter: !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device),
        heartRate: !!(connectedDevices.heartRate && connectedDevices.heartRate.device)
      },
      // 현재 파워값 (W)
      power: currentPowerW,
      // 세그먼트 평균 파워값 (W) - 현재 세그먼트의 평균
      segmentAvgPowerW: segmentAvgPowerW,
      // 전체 평균 파워값 (W) - 세션 전체 평균
      avgPower: liveData.avgPower || liveData.averagePower || segmentAvgPowerW || 0,
      // 세그먼트 목표 파워값 (W)
      segmentTargetPowerW: segmentTargetPowerW,
      // 현재 세그먼트 인덱스
      segmentIndex: segmentIndex,
      // 심박수 (bpm)
      heartRate: liveData.heartRate || liveData.hr || 0,
      // 케이던스 (rpm)
      cadence: liveData.cadence || liveData.rpm || 0,
      // 훈련 진행률 (%)
      progress: progress,
      // 타임스탬프
      timestamp: new Date().toISOString()
    });
    
    if (result?.success) {
      // 성공적으로 전송됨
      const bluetoothStatus = {
        trainer: !!(connectedDevices.trainer && connectedDevices.trainer.device),
        powerMeter: !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device),
        heartRate: !!(connectedDevices.heartRate && connectedDevices.heartRate.device)
      };
      
      console.log('✅ 실시간 데이터 전송 성공', {
        participantId,
        roomCode,
        segmentIndex,
        segmentTargetPowerW,
        segmentAvgPowerW,
        currentPowerW,
        heartRate: liveData.heartRate || liveData.hr || 0,
        cadence: liveData.cadence || liveData.rpm || 0,
        bluetoothStatus
      });
    } else {
      console.warn('⚠️ 실시간 데이터 전송 실패:', result?.error);
    }
    
  } catch (error) {
    console.error('❌ 실시간 데이터 동기화 오류:', error);
  }
}

/**
 * 세그먼트 FTP 백분율 가져오기 (app.js의 getSegmentFtpPercent 함수와 동일한 로직)
 */
function getSegmentFtpPercent(seg) {
  if (!seg) return 100;
  
  // 직접 ftp_percent 필드가 있는 경우
  if (seg.ftp_percent !== undefined && seg.ftp_percent !== null) {
    return Number(seg.ftp_percent);
  }
  
  // segment_type으로 판단
  const type = String(seg.segment_type || seg.type || '').toLowerCase();
  if (type.includes('warmup') || type.includes('warm-up')) return 50;
  if (type.includes('cooldown') || type.includes('cool-down')) return 50;
  if (type.includes('rest') || type.includes('recovery')) return 30;
  if (type.includes('interval')) return 120;
  if (type.includes('tempo')) return 85;
  if (type.includes('endurance')) return 70;
  
  // target_value가 있는 경우 (FTP 기준 백분율로 가정)
  if (seg.target_value !== undefined && seg.target_value !== null) {
    const ftp = Number(window.currentUser?.ftp) || 200;
    if (ftp > 0) {
      return Math.round((Number(seg.target_value) / ftp) * 100);
    }
  }
  
  return 100; // 기본값
}

/**
 * 참가자 실시간 데이터 저장 API
 * 구글 시트 "GroupTrainingLiveData"에 저장
 */
async function apiSaveParticipantLiveData(roomCode, participantId, payload) {
  try {
    if (!window.GAS_URL) {
      return { success: false, error: 'GAS_URL not configured' };
    }

    // 여러 백엔드 버전 호환: 순차적으로 시도
    const actionsToTry = ['updateParticipantLiveData', 'saveParticipantLiveData', 'saveLiveData'];

    // 일부 백엔드는 개별 필드로 받는 경우가 있어 병행 제공
    const flat = payload || {};

    let lastError = 'Unknown error';
    for (const action of actionsToTry) {
      try {
        const params = {
          action,
          roomCode: String(roomCode),
          participantId: String(participantId),
          // 공통: payload JSON
          payload: JSON.stringify(flat),
          // 호환용 개별 필드
          power: flat.power ?? flat.metrics?.currentPower ?? null,
          // 세그먼트 평균 파워값 (W)
          segmentAvgPowerW: flat.segmentAvgPowerW ?? flat.metrics?.segmentAvgPowerW ?? null,
          // 전체 평균 파워값 (W)
          avgPower: flat.avgPower ?? flat.metrics?.avgPower ?? null,
          heartRate: flat.heartRate ?? flat.metrics?.heartRate ?? null,
          cadence: flat.cadence ?? flat.metrics?.cadence ?? null,
          // 세그먼트 목표 파워값 (W)
          segmentTargetPowerW: flat.segmentTargetPowerW ?? flat.metrics?.segmentTargetPowerW ?? null,
          // 현재 세그먼트 인덱스
          segmentIndex: flat.segmentIndex ?? flat.metrics?.segmentIndex ?? null,
          progress: flat.progress ?? null,
          // 블루투스 연결 상태
          trainerConnected: flat.bluetoothStatus?.trainer ?? null,
          powerConnected: flat.bluetoothStatus?.powerMeter ?? null,
          hrConnected: flat.bluetoothStatus?.heartRate ?? null,
          timestamp: flat.timestamp || new Date().toISOString()
        };
        const res = await jsonpRequest(window.GAS_URL, params);
        if (res && res.success) {
          return res;
        }
        lastError = res?.error || 'Unknown action';
        // Unknown action이면 다음 액션 시도
        if (String(lastError).toLowerCase().includes('unknown')) {
          continue;
        }
      } catch (inner) {
        lastError = inner?.message || 'request failed';
        continue;
      }
    }
    return { success: false, error: lastError };
  } catch (e) {
    return { success: false, error: e.message || 'request failed' };
  }
}

/**
 * 참가자 실시간 데이터 조회 API (전체 방 참가자)
 */
async function apiGetParticipantsLiveData(roomCode) {
  try {
    if (!window.GAS_URL) {
      return { success: false, error: 'GAS_URL not configured' };
    }
    const actionsToTry = ['getParticipantsLiveData', 'listParticipantLiveData', 'getLiveData'];
    let last = { success: false, error: 'Unknown error' };
    for (const action of actionsToTry) {
      try {
        const res = await jsonpRequest(window.GAS_URL, {
          action,
          roomCode: String(roomCode)
        });
        if (res && res.success && Array.isArray(res.items || res.list || res.data)) {
          return {
            success: true,
            items: res.items || res.list || res.data
          };
        }
        last = res || last;
        if (String(last?.error || '').toLowerCase().includes('unknown')) continue;
      } catch (inner) {
        last = { success: false, error: inner?.message || 'request failed' };
      }
    }
    return last;
  } catch (e) {
    return { success: false, error: e.message || 'request failed' };
  }
}

/**
 * 훈련 화면에 모니터링 버튼 추가
 */
function addMonitoringButton() {
  if (!groupTrainingState.isAdmin) return;
  
  const trainingControls = document.querySelector('.training-controls');
  if (!trainingControls) return;
  
  // 기존 모니터링 버튼이 있으면 제거
  const existingBtn = document.getElementById('btnGroupMonitoring');
  if (existingBtn) {
    existingBtn.remove();
  }
  
  // 새 모니터링 버튼 생성
  const monitoringBtn = document.createElement('button');
  monitoringBtn.id = 'btnGroupMonitoring';
  monitoringBtn.className = 'enhanced-control-btn monitoring';
  monitoringBtn.innerHTML = '👥';
  monitoringBtn.setAttribute('aria-label', '그룹 모니터링');
  monitoringBtn.onclick = openGroupMonitoring;
  
  // 첫 번째 버튼 앞에 추가
  trainingControls.insertBefore(monitoringBtn, trainingControls.firstChild);
}

/**
 * 훈련 시작 브로드캐스트
 */
async function broadcastTrainingStart() {
  // 실제 구현 시 푸시 알림, 웹소켓 등 사용
  console.log('Broadcasting training start to all participants');
}

/**
 * 참가자 내보내기
 */
async function kickParticipant() {
  // 구현 예정 - 관리자가 특정 참가자를 방에서 내보내는 기능
  showToast('참가자 내보내기 기능은 준비 중입니다', 'info');
}

/**
 * 방 닫기
 */
async function closeGroupRoom() {
  // 상태 확인
  if (!groupTrainingState || !groupTrainingState.isAdmin) {
    showToast('관리자만 방을 닫을 수 있습니다', 'error');
    return;
  }
  
  const room = groupTrainingState.currentRoom;
  const roomCode = groupTrainingState.roomCode;
  
  // 방 정보 확인
  if (!room || !roomCode) {
    showToast('방 정보를 찾을 수 없습니다', 'error');
    console.error('방 닫기 실패: 방 정보 없음', { room, roomCode });
    return;
  }
  
  // 이미 닫힌 방인지 확인
  if (room.status === 'closed' || room.status === 'finished') {
    showToast('이미 닫힌 방입니다', 'warning');
    // 상태 정리 후 화면 전환
    stopRoomSync();
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    if (typeof showScreen === 'function') {
      showScreen('groupRoomScreen');
    }
    return;
  }
  
  // 확인 대화상자
  const confirmed = confirm('정말 방을 닫으시겠습니까?\n\n모든 참가자가 방에서 나가게 되며, 이 작업은 되돌릴 수 없습니다.');
  if (!confirmed) return;
  
  try {
    showToast('방을 닫는 중입니다...', 'info');
    
    // 백엔드에 방 상태 업데이트
    const updateData = {
      status: 'closed',
      closedAt: new Date().toISOString()
    };
    
    // apiUpdateRoom 함수 사용 (더 안정적)
    let updateSuccess = false;
    if (typeof apiUpdateRoom === 'function') {
      const updateResult = await apiUpdateRoom(roomCode, updateData);
      updateSuccess = updateResult && updateResult.success;
    } else if (typeof updateRoomOnBackend === 'function') {
      // 대체 방법: updateRoomOnBackend 사용
      room.status = 'closed';
      updateSuccess = await updateRoomOnBackend(room);
    } else {
      throw new Error('방 업데이트 함수를 찾을 수 없습니다');
    }
    
    if (!updateSuccess) {
      throw new Error('백엔드 업데이트 실패');
    }
    
    // 로컬 상태 정리
    if (typeof stopRoomSync === 'function') {
      stopRoomSync();
    }
    
    // 동기화 인터벌 정리
    if (groupTrainingState.syncInterval) {
      clearInterval(groupTrainingState.syncInterval);
      groupTrainingState.syncInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 실시간 데이터 동기화 중지
    if (typeof stopParticipantDataSync === 'function') {
      stopParticipantDataSync();
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    groupTrainingState.participants = [];
    groupTrainingState.isConnected = false;
    groupTrainingState.lastSyncTime = null;
    
    // 훅 호출
    if (window.groupTrainingHooks?.endSession) {
      window.groupTrainingHooks.endSession();
    }
    
    showToast('방이 성공적으로 닫혔습니다', 'success');
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupRoomScreen');
    } else {
      // 대체 방법: 그룹 화면들 숨기기
      const groupScreens = ['groupWaitingScreen', 'groupTrainingScreen'];
      groupScreens.forEach(screenId => {
        const screen = document.getElementById(screenId);
        if (screen) {
          screen.classList.add('hidden');
        }
      });
    }
    
  } catch (error) {
    console.error('❌ 방 닫기 실패:', error);
    
    // 오류 메시지 상세화
    let errorMessage = '방 닫기에 실패했습니다';
    if (error.message) {
      errorMessage += `: ${error.message}`;
    } else if (typeof error === 'string') {
      errorMessage += `: ${error}`;
    }
    
    showToast(errorMessage, 'error');
    
    // 네트워크 오류인 경우 재시도 옵션 제공
    if (error.message && (error.message.includes('네트워크') || error.message.includes('연결') || error.message.includes('timeout'))) {
      const retry = confirm('네트워크 오류가 발생했습니다.\n다시 시도하시겠습니까?');
      if (retry) {
        // 1초 후 재시도
        setTimeout(() => {
          closeGroupRoom();
        }, 1000);
      }
    }
  }
}

// ========== 그룹 모니터링 기능들 ==========


// ========== 그룹 모니터링 기능들 ==========

/**
 * 모니터링 오버레이용 CSS 스타일 추가
 */
function addMonitoringStyles() {
  if (document.getElementById('monitoringStyles')) return; // 이미 추가됨
  
  const style = document.createElement('style');
  style.id = 'monitoringStyles';
  style.textContent = `
    .monitoring-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    
    .monitoring-overlay.hidden {
      display: none;
    }
    
    .monitoring-container {
      background: white;
      border-radius: 12px;
      width: 90vw;
      max-width: 1200px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    }
    
    .monitoring-header {
      background: #2196F3;
      color: white;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 12px 12px 0 0;
    }
    
    .monitoring-content {
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 300px 300px;
      gap: 20px;
    }
    
    .participants-list {
      max-height: 400px;
      overflow-y: auto;
    }
    
    .monitoring-participant-card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
      background: #f9f9f9;
    }
    
    .mic-btn {
      background: #4CAF50;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      margin-right: 10px;
    }
    
    .mic-btn.active {
      background: #F44336;
    }
    
    .coaching-section {
      margin-top: 15px;
    }
    
    .coaching-section.hidden {
      display: none;
    }
    
    .coaching-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 15px;
    }
    
    .coach-btn {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: white;
      cursor: pointer;
    }
    
    .coach-btn:hover {
      background: #f0f0f0;
    }
    
    .chat-messages {
      height: 200px;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 10px;
      overflow-y: auto;
      margin-bottom: 10px;
      background: white;
    }
    
    .chat-input-group, .custom-input-group {
      display: flex;
      gap: 10px;
    }
    
    .chat-input-group input, .custom-input-group input {
      flex: 1;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    
    .send-btn {
      background: #2196F3;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .close-btn {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `;
  
  document.head.appendChild(style);
  console.log('✅ 모니터링 스타일 추가 완료');
}

// 그 다음에 ensureMonitoringOverlay 함수도 추가...





/**
 * 그룹 모니터링 오버레이 열기
 */
/**
 * 그룹 모니터링 오버레이 열기 (개선된 버전)
 */
function openGroupMonitoring() {
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 모니터링을 사용할 수 있습니다', 'error');
    return;
  }
  
  console.log('🎯 그룹 모니터링 오버레이 열기');
  
  // 모니터링 오버레이 확보 (없으면 생성)
  const overlay = ensureMonitoringOverlay();
  if (!overlay) {
    showToast('모니터링 화면을 열 수 없습니다', 'error');
    return;
  }
  
  // 오버레이 표시
  overlay.classList.remove('hidden');
  
  // 모니터링 초기화
  initializeMonitoring();
  
  console.log('✅ 그룹 모니터링 화면 열림');
}

/**
 * 그룹 모니터링 닫기
 */
function closeMonitoring() {
  const overlay = safeGet('groupMonitoringOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
  
  // 마이크 끄기
  if (microphoneState.isActive) {
    toggleMicrophone();
  }
}

/**
 * 모니터링 초기화
 */
function initializeMonitoring() {
  updateMonitoringParticipants();
  
  // 주기적으로 참가자 데이터 업데이트
  if (window.monitoringInterval) {
    clearInterval(window.monitoringInterval);
  }
  
  window.monitoringInterval = setInterval(updateMonitoringParticipants, 5000); // 5초마다
}

/**
 * 모니터링 참가자 목록 업데이트
 */
function updateMonitoringParticipants() {
  const container = safeGet('monitoringParticipantsList');
  if (!container) return;
  
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
  // 실제 구현 시 각 참가자의 실시간 데이터를 가져와야 함
  container.innerHTML = room.participants.map(participant => {
    const liveData = getParticipantLiveData(participant.id);
    
    return `
      <div class="monitoring-participant-card" data-id="${participant.id}">
        <div class="participant-header">
          <h4>${participant.name}</h4>
          <span class="participant-status ${participant.ready ? 'active' : 'inactive'}">
            ${participant.ready ? '🟢 활성' : '🔴 비활성'}
          </span>
        </div>
        
        <div class="participant-metrics">
          <div class="metric">
            <span class="metric-label">파워</span>
            <span class="metric-value">${liveData.power || 0}W</span>
          </div>
          <div class="metric">
            <span class="metric-label">심박</span>
            <span class="metric-value">${liveData.heartRate || 0}bpm</span>
          </div>
          <div class="metric">
            <span class="metric-label">케이던스</span>
            <span class="metric-value">${liveData.cadence || 0}rpm</span>
          </div>
        </div>
        
        <div class="participant-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${liveData.progress || 0}%"></div>
          </div>
          <span class="progress-text">${liveData.progress || 0}% 완료</span>
        </div>
        
        <div class="participant-actions">
          <button class="coaching-quick-btn" onclick="sendQuickCoaching('${participant.id}', 'encourage')">
            👍 격려
          </button>
          <button class="coaching-quick-btn" onclick="sendQuickCoaching('${participant.id}', 'powerup')">
            ⚡ 파워업
          </button>
        </div>
      </div>
    `;
  }).join('');
}



/**
 * 모니터링 오버레이 HTML 요소 확보
 */
function ensureMonitoringOverlay() {
  let overlay = safeGet('groupMonitoringOverlay');
  
  if (!overlay) {
    console.log('🔨 모니터링 오버레이 생성 중...');
    
    // 모니터링 오버레이 HTML 생성
    const overlayHTML = `
      <div id="groupMonitoringOverlay" class="monitoring-overlay hidden">
        <div class="monitoring-container">
          <div class="monitoring-header">
            <h2>🎯 그룹 모니터링</h2>
            <button class="close-btn" onclick="closeMonitoring()">✕</button>
          </div>
          
          <div class="monitoring-content">
            <div class="monitoring-participants">
              <h3>참가자 모니터링</h3>
              <div id="monitoringParticipantsList" class="participants-list">
                <!-- 참가자 목록이 여기에 로드됩니다 -->
              </div>
            </div>
            
            <div class="monitoring-controls">
              <h3>코칭 제어</h3>
              
              <div class="microphone-section">
                <button id="micToggleBtn" class="mic-btn" onclick="toggleMicrophone()">
                  🎤 마이크 켜기
                </button>
                <span id="micStatus" class="mic-status">마이크 준비됨</span>
              </div>
              
              <div id="coachingSection" class="coaching-section hidden">
                <div class="quick-coaching">
                  <h4>빠른 코칭</h4>
                  <div class="coaching-buttons">
                    <button onclick="sendQuickCoaching('motivation')" class="coach-btn">💪 동기부여</button>
                    <button onclick="sendQuickCoaching('technique')" class="coach-btn">🎯 기술지도</button>
                    <button onclick="sendQuickCoaching('warning')" class="coach-btn">⚠️ 주의사항</button>
                    <button onclick="sendQuickCoaching('encouragement')" class="coach-btn">👏 격려</button>
                  </div>
                </div>
                
                <div class="custom-coaching">
                  <h4>사용자 정의 메시지</h4>
                  <div class="custom-input-group">
                    <input type="text" id="customCoachingInput" placeholder="코칭 메시지를 입력하세요..." maxlength="100">
                    <button onclick="sendCustomCoaching()" class="send-btn">전송</button>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    `;
    
    // body에 추가
    document.body.insertAdjacentHTML('beforeend', overlayHTML);
    overlay = safeGet('groupMonitoringOverlay');
    
    if (overlay) {
      console.log('✅ 모니터링 오버레이 생성 완료');
    } else {
      console.error('❌ 모니터링 오버레이 생성 실패');
    }
  }
  
  return overlay;
}






/**
 * 참가자 실시간 데이터 가져오기 (임시 구현)
 */
function getParticipantLiveData(participantId) {
  // 실제 구현 시 백엔드에서 실시간 데이터를 가져와야 함
  // 여기서는 임시 데이터 반환
  return {
    power: Math.floor(Math.random() * 300) + 100,
    heartRate: Math.floor(Math.random() * 50) + 120,
    cadence: Math.floor(Math.random() * 30) + 70,
    progress: Math.floor(Math.random() * 100)
  };
}

/**
 * 빠른 코칭 메시지 전송
 */
function sendQuickCoaching(participantId, type) {
  const messages = {
    encourage: '좋습니다! 계속 유지하세요! 💪',
    powerup: '파워를 조금 더 올려보세요! ⚡',
    pacedown: '페이스를 조절하세요 🎯',
    rest: '휴식 시간입니다 😌'
  };
  
  const message = messages[type] || '화이팅!';
  broadcastMessage(message, participantId);
}

// ========== 마이크 및 코칭 기능들 ==========

/**
 * 마이크 토글
 */
async function toggleMicrophone() {
  if (microphoneState.isActive) {
    stopMicrophone();
  } else {
    await startMicrophone();
  }
}

/**
 * 마이크 시작
 */
async function startMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    microphoneState.mediaStream = stream;
    microphoneState.isActive = true;
    
    // 오디오 컨텍스트 생성 (음성 레벨 표시용)
    microphoneState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    microphoneState.analyser = microphoneState.audioContext.createAnalyser();
    
    const source = microphoneState.audioContext.createMediaStreamSource(stream);
    source.connect(microphoneState.analyser);
    
    // UI 업데이트
    updateMicrophoneUI();
    
    // 코칭 섹션 표시
    const coachingSection = safeGet('coachingSection');
    if (coachingSection) {
      coachingSection.classList.remove('hidden');
    }
    
    showToast('마이크가 활성화되었습니다', 'success');
    
  } catch (error) {
    console.error('Failed to start microphone:', error);
    showToast('마이크를 시작할 수 없습니다', 'error');
  }
}

/**
 * 마이크 중지
 */
function stopMicrophone() {
  if (microphoneState.mediaStream) {
    microphoneState.mediaStream.getTracks().forEach(track => track.stop());
    microphoneState.mediaStream = null;
  }
  
  if (microphoneState.audioContext) {
    microphoneState.audioContext.close();
    microphoneState.audioContext = null;
    microphoneState.analyser = null;
  }
  
  microphoneState.isActive = false;
  
  // UI 업데이트
  updateMicrophoneUI();
  
  // 코칭 섹션 숨김
  const coachingSection = safeGet('coachingSection');
  if (coachingSection) {
    coachingSection.classList.add('hidden');
  }
  
  showToast('마이크가 비활성화되었습니다', 'info');
}

/**
 * 마이크 UI 업데이트
 */
function updateMicrophoneUI() {
  const micBtn = safeGet('micToggleBtn');
  const micStatus = safeGet('micStatus');
  const micIndicator = safeGet('micIndicator');
  
  if (micBtn) {
    micBtn.textContent = microphoneState.isActive ? '🎤 마이크 끄기' : '🎤 마이크 켜기';
    micBtn.classList.toggle('active', microphoneState.isActive);
  }
  
  if (micStatus) {
    micStatus.textContent = microphoneState.isActive ? '마이크 활성' : '마이크 준비됨';
  }
  
  if (micIndicator) {
    micIndicator.textContent = microphoneState.isActive ? '🎤' : '🎙️';
  }
}

/**
 * 코칭 메시지 브로드캐스트
 */
function broadcastMessage(message, targetId = null) {
  if (!microphoneState.isActive && !message) {
    showToast('마이크를 먼저 활성화해주세요', 'error');
    return;
  }
  
  try {
    // 실제 구현 시 음성 메시지를 모든 참가자에게 전송
    console.log('Broadcasting message:', message, 'to:', targetId || 'all');
    
    // 참가자들에게 텍스트 메시지로도 전송
    const chatMessage = {
      type: 'coaching',
      from: '관리자',
      message: message,
      timestamp: new Date().toISOString(),
      targetId: targetId
    };
    
    // 실제 구현 시 웹소켓, 푸시 알림 등으로 전송
    sendChatMessageToParticipants(chatMessage);
    
    showToast('코칭 메시지가 전송되었습니다', 'success');
    
  } catch (error) {
    console.error('Failed to broadcast message:', error);
    showToast('메시지 전송에 실패했습니다', 'error');
  }
}

/**
 * 사용자 정의 코칭 메시지 전송
 */
function sendCustomCoaching() {
  const input = safeGet('customCoachingInput');
  if (!input) return;
  
  const message = input.value.trim();
  if (!message) {
    showToast('메시지를 입력해주세요', 'error');
    return;
  }
  
  broadcastMessage(message);
  input.value = '';
}

/**
 * 채팅 메시지를 참가자들에게 전송 (임시 구현)
 */
function sendChatMessageToParticipants(chatMessage) {
  // 실제 구현 시 백엔드 API 호출
  console.log('Sending chat message to participants:', chatMessage);
}

// ========== 그룹 훈련 화면 초기화 함수 ==========

/**
 * 그룹 방 화면 초기화
 */
async function initializeGroupRoomScreen() {
  console.log('🔍 initializeGroupRoomScreen called');
  console.log('👤 Current user:', window.currentUser);
  
  // 역할 선택 초기화
  const adminBtn = safeGet('adminRoleBtn');
  const participantBtn = safeGet('participantRoleBtn');
  const managerBtn = safeGet('managerRoleBtn');
  
  console.log('🔘 UI Elements found:', {
    adminBtn: !!adminBtn,
    participantBtn: !!participantBtn,
    managerBtn: !!managerBtn
  });
  
  if (adminBtn) adminBtn.classList.remove('active');
  if (participantBtn) participantBtn.classList.remove('active');
  if (managerBtn) managerBtn.classList.remove('active');
  
  // 섹션 숨김
  const adminSection = safeGet('adminSection');
  const participantSection = safeGet('participantSection');
  const managerSection = safeGet('managerSection');
  
  if (adminSection) adminSection.classList.add('hidden');
  if (participantSection) participantSection.classList.add('hidden');
  if (managerSection) managerSection.classList.add('hidden');
  
  // grade=1 사용자인지 확인하여 관리자 메뉴 표시
   const currentUser = window.currentUser;
   console.log('👤 Current user grade check:', currentUser?.grade, typeof currentUser?.grade);
   
   if (currentUser && (currentUser.grade === 1 || currentUser.grade === '1')) {
     console.log('✅ Grade 1 user detected, showing manager options');
     if (managerBtn) {
       managerBtn.classList.remove('hidden');
       managerBtn.style.display = 'flex'; // 추가 보장
     }
   } else {
     console.log('❌ Not grade 1 user, hiding manager options');
     if (managerBtn) {
       managerBtn.classList.add('hidden');
     }
   }
  
  // 입력값 초기화
  const roomNameInput = safeGet('roomNameInput');
  const roomCodeInput = safeGet('roomCodeInput');
  
  if (roomNameInput) roomNameInput.value = '';
  if (roomCodeInput) roomCodeInput.value = '';
  
  // 워크아웃 드롭다운 미리 로드 (성능 향상)
  if (typeof window.loadWorkoutsForGroupRoom === 'function') {
    try {
      await window.loadWorkoutsForGroupRoom();
    } catch (error) {
      console.warn('워크아웃 목록 사전 로드 실패:', error);
    }
  }
  
  console.log('✅ initializeGroupRoomScreen completed');
}



// ========== 전역 함수 등록 ==========
window.toggleReady = toggleReady;
window.leaveGroupRoom = leaveGroupRoom;
window.copyRoomCode = copyRoomCode;
window.startGroupTraining = startGroupTraining;
window.kickParticipant = kickParticipant;
window.closeGroupRoom = closeGroupRoom;
window.openGroupMonitoring = openGroupMonitoring;
window.closeMonitoring = closeMonitoring;
window.toggleMicrophone = toggleMicrophone;
window.broadcastMessage = broadcastMessage;
window.sendCustomCoaching = sendCustomCoaching;
window.sendQuickCoaching = sendQuickCoaching;
window.initializeGroupRoomScreen = initializeGroupRoomScreen;
// createGroupRoomFromWorkout는 groupTrainingManager.js에서 등록됨
// window.createGroupRoomFromWorkout = createGroupRoomFromWorkout; // 주석 처리
window.startAdminControlledCountdown = startAdminControlledCountdown;
window.cancelGroupCountdown = cancelGroupCountdown;
window.checkAndSyncCountdown = checkAndSyncCountdown;
window.broadcastCountdownStart = broadcastCountdownStart;
window.showParticipantCountdown = showParticipantCountdown;

// 🆕 새로 추가된 함수들
window.ensureMonitoringOverlay = ensureMonitoringOverlay;
window.addMonitoringStyles = addMonitoringStyles;


// 🆕 관리자 기능 전역 함수 등록 추가
// 🆕 관리자 기능 전역 함수 등록 추가 (조건부 확인)
if (typeof refreshActiveRooms === 'function') {
  window.refreshActiveRooms = refreshActiveRooms;
}
if (typeof updateRoomStatistics === 'function') {
  window.updateRoomStatistics = updateRoomStatistics;
}
if (typeof monitorRoom === 'function') {
  window.monitorRoom = monitorRoom;
}
if (typeof forceStopRoom === 'function') {
  window.forceStopRoom = forceStopRoom;
}
if (typeof cleanupExpiredRooms === 'function') {
  window.cleanupExpiredRooms = cleanupExpiredRooms;
}
if (typeof emergencyStopAllRooms === 'function') {
  window.emergencyStopAllRooms = emergencyStopAllRooms;
}
if (typeof initializeManagerDashboard === 'function') {
  window.initializeManagerDashboard = initializeManagerDashboard;
}


console.log('✅ Group Training Manager Part 2 loaded');
