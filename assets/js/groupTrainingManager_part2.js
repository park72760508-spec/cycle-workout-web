/* ==========================================================
   groupTrainingManager_part2.js - 그룹 훈련 대기실 및 모니터링 기능
   그룹 훈련 관리 모듈의 2부
========================================================== */

// groupTrainingState 전역 참조 (groupTrainingManager.js에서 정의됨)
// groupTrainingManager.js가 먼저 로드되어야 함
const groupTrainingState = window.groupTrainingState || (() => {
  console.warn('groupTrainingState가 아직 초기화되지 않았습니다. groupTrainingManager.js가 먼저 로드되어야 합니다.');
  return {
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
})();





// ========== 대기실 참가자 기능들 ==========

/**
 * 준비 상태 토글
 */
async function toggleReady() {
  if (!groupTrainingState.currentRoom) return;
  
  const room = groupTrainingState.currentRoom;
  const myId = window.currentUser?.id || 'user_' + Date.now();
  const match = (participant) => {
    const pid = participant.id || participant.participantId;
    return String(pid) === String(myId);
  };
  
  // 내 참가자 정보 찾기
  const myParticipant = room.participants.find(match);
  if (!myParticipant) {
    showToast('참가자 정보를 찾을 수 없습니다', 'error');
    return;
  }
  
  // 준비 상태 변경
  myParticipant.ready = !myParticipant.ready;
  
  try {
    // 백엔드 업데이트
    const updatedParticipants = room.participants.map(p => {
      if (match(p)) {
        return { ...p, ready: myParticipant.ready };
      }
      return p;
    });

    const success = await updateRoomOnBackend({
      ...room,
      participants: updatedParticipants
    });
    
    if (success) {
      groupTrainingState.currentRoom.participants = updatedParticipants;
      // UI 업데이트
      const readyBtn = safeGet('readyToggleBtn');
      if (readyBtn) {
        readyBtn.textContent = myParticipant.ready ? '✅ 준비 완료' : '⏳ 준비 중';
        readyBtn.classList.toggle('ready', myParticipant.ready);
      }
      
      updateParticipantsList();
      showToast(myParticipant.ready ? '준비 완료!' : '준비 취소', 'success');
    }
    
  } catch (error) {
    console.error('Failed to toggle ready:', error);
    showToast('준비 상태 변경에 실패했습니다', 'error');
    // 상태 되돌리기
    myParticipant.ready = !myParticipant.ready;
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
  
  // 시작 조건 확인
  const allReady = room.participants.every(p => p.ready);
  const hasParticipants = room.participants.length >= 2;
  
  if (!allReady) {
    showToast('모든 참가자가 준비되지 않았습니다', 'error');
    return;
  }
  
  if (!hasParticipants) {
    showToast('최소 2명의 참가자가 필요합니다', 'error');
    return;
  }
  
  try {
    showToast('그룹 훈련을 시작합니다...', 'info');
    
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
  }
}

/**
 * 관리자 제어 카운트다운 시스템 (모든 참가자가 동시에 시작)
 */
async function startAdminControlledCountdown(seconds = 10) {
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
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
    room.startedAt = new Date().toISOString();
    
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
  const overlay = document.createElement('div');
  overlay.id = 'participantCountdownOverlay';
  overlay.className = 'countdown-overlay';
  overlay.innerHTML = `
    <div class="countdown-content">
      <h2>🚀 그룹 훈련 시작!</h2>
      <div class="countdown-number" id="participantCountdownNumber">${seconds}</div>
      <p>관리자가 훈련을 시작합니다</p>
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
    }
  }, 1000);
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
  if (!groupTrainingState.isAdmin) {
    // 참가자는 방 상태를 확인하여 카운트다운 시작
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
        const endTime = new Date(room.countdownEndTime);
        const now = new Date();
        const remainingSeconds = Math.max(0, Math.ceil((endTime - now) / 1000));
        
        if (remainingSeconds > 0) {
          showParticipantCountdown(remainingSeconds);
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
    
    // 실시간 데이터 전송 시작 (참가자만)
    if (!groupTrainingState.isAdmin) {
      startParticipantDataSync();
    }
    
    showToast('그룹 훈련이 시작되었습니다!', 'success');
    
  } catch (error) {
    console.error('Failed to start training session:', error);
    showToast('훈련 세션 시작에 실패했습니다', 'error');
  }
}

/**
 * 참가자 실시간 데이터 동기화 시작
 */
function startParticipantDataSync() {
  // 기존 인터벌 정리
  if (window.participantDataSyncInterval) {
    clearInterval(window.participantDataSyncInterval);
  }
  
  console.log('🔄 참가자 실시간 데이터 동기화 시작');
  
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
 */
async function syncParticipantLiveData() {
  try {
    const roomCode = groupTrainingState?.roomCode;
    const participantId = window.currentUser?.id;
    
    if (!roomCode || !participantId) {
      return; // 방 코드나 참가자 ID가 없으면 전송하지 않음
    }
    
    // 블루투스에서 실시간 데이터 가져오기
    const liveData = window.liveData || {};
    
    // 훈련 진행률 계산 (trainingState에서 가져오기)
    const trainingState = window.trainingState || {};
    const currentWorkout = window.currentWorkout;
    let progress = 0;
    
    if (currentWorkout && currentWorkout.segments) {
      const elapsedSec = trainingState.elapsedSec || 0;
      const totalDuration = currentWorkout.segments.reduce((sum, seg) => {
        return sum + (seg.duration_sec || 0);
      }, 0);
      
      if (totalDuration > 0) {
        progress = Math.min(100, Math.floor((elapsedSec / totalDuration) * 100));
      }
    }
    
    // 백엔드에 데이터 전송
    const result = await apiSaveParticipantLiveData(roomCode, participantId, {
      power: liveData.power || 0,
      heartRate: liveData.heartRate || 0,
      cadence: liveData.cadence || 0,
      progress: progress,
      timestamp: new Date().toISOString()
    });
    
    if (result?.success) {
      // 성공적으로 전송됨 (조용히 처리)
      console.log('✅ 실시간 데이터 전송 성공');
    } else {
      console.warn('⚠️ 실시간 데이터 전송 실패:', result?.error);
    }
    
  } catch (error) {
    console.error('❌ 실시간 데이터 동기화 오류:', error);
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
            
            <div class="monitoring-chat">
              <h3>실시간 채팅</h3>
              <div id="chatMessages" class="chat-messages">
                <!-- 채팅 메시지들이 여기에 표시됩니다 -->
              </div>
              <div class="chat-input-group">
                <input type="text" id="chatInput" placeholder="메시지를 입력하세요..." maxlength="200" onkeypress="if(event.key==='Enter') sendChatMessage()">
                <button onclick="sendChatMessage()" class="send-btn">전송</button>
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

// ========== 채팅 기능 ==========

/**
 * 채팅 메시지 전송
 */
function sendChatMessage() {
  const input = safeGet('chatInput');
  if (!input) return;
  
  const message = input.value.trim();
  if (!message) return;
  
  const chatMessage = {
    type: 'chat',
    from: window.currentUser?.name || '익명',
    message: message,
    timestamp: new Date().toISOString()
  };
  
  // 채팅 메시지 표시
  addChatMessage(chatMessage);
  
  // 백엔드로 전송 (실제 구현 시)
  sendChatMessageToParticipants(chatMessage);
  
  input.value = '';
}

/**
 * 채팅 메시지 추가
 */
function addChatMessage(chatMessage) {
  const container = safeGet('chatMessages');
  if (!container) return;
  
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${chatMessage.type}`;
  messageEl.innerHTML = `
    <span class="chat-from">${chatMessage.from}</span>
    <span class="chat-text">${chatMessage.message}</span>
    <span class="chat-time">${getCurrentTimeString()}</span>
  `;
  
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
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
window.sendChatMessage = sendChatMessage;
window.initializeGroupRoomScreen = initializeGroupRoomScreen;
window.createGroupRoomFromWorkout = createGroupRoomFromWorkout;
window.startAdminControlledCountdown = startAdminControlledCountdown;
window.cancelGroupCountdown = cancelGroupCountdown;
window.checkAndSyncCountdown = checkAndSyncCountdown;

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
