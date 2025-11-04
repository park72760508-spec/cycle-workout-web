/* ==========================================================
   groupTrainingManager_part2.js - 그룹 훈련 대기실 및 모니터링 기능
   그룹 훈련 관리 모듈의 2부
========================================================== */

// ========== 대기실 참가자 기능들 ==========

/**
 * 준비 상태 토글
 */
async function toggleReady() {
  if (!groupTrainingState.currentRoom) return;
  
  const room = groupTrainingState.currentRoom;
  const myId = window.currentUser?.id || 'user_' + Date.now();
  
  // 내 참가자 정보 찾기
  const myParticipant = room.participants.find(p => p.id === myId);
  if (!myParticipant) {
    showToast('참가자 정보를 찾을 수 없습니다', 'error');
    return;
  }
  
  // 준비 상태 변경
  myParticipant.ready = !myParticipant.ready;
  
  try {
    // 백엔드 업데이트
    const success = await updateRoomOnBackend(room);
    
    if (success) {
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
 * 방 나가기
 */
async function leaveGroupRoom() {
  if (!groupTrainingState.currentRoom) return;
  
  const confirmed = confirm('정말 방을 나가시겠습니까?');
  if (!confirmed) return;
  
  try {
    const room = groupTrainingState.currentRoom;
    const myId = window.currentUser?.id || 'user_' + Date.now();
    
    // 참가자 목록에서 제거
    room.participants = room.participants.filter(p => p.id !== myId);
    
    // 백엔드 업데이트
    await updateRoomOnBackend(room);
    
    // 로컬 상태 정리
    stopRoomSync();
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    
    showToast('방을 나갔습니다', 'info');
    showScreen('groupRoomScreen');
    
  } catch (error) {
    console.error('Failed to leave room:', error);
    showToast('방 나가기에 실패했습니다', 'error');
  }
}

/**
 * 방 코드 복사
 */
function copyRoomCode() {
  const roomCode = groupTrainingState.roomCode;
  if (!roomCode) return;
  
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
    
    // 방 상태를 'training'으로 변경
    room.status = 'training';
    room.startedAt = new Date().toISOString();
    
    // 백엔드 업데이트
    const success = await updateRoomOnBackend(room);
    
    if (success) {
      // 모든 참가자에게 훈련 시작 알림
      await broadcastTrainingStart();
      
      // 훈련 세션 시작
      startGroupTrainingSession();
    } else {
      throw new Error('Failed to start training');
    }
    
  } catch (error) {
    console.error('Failed to start group training:', error);
    showToast('그룹 훈련 시작에 실패했습니다', 'error');
  }
}

/**
 * 그룹 훈련 세션 시작 (실제 훈련 화면으로 전환)
 */
function startGroupTrainingSession() {
  try {
    // 기존 개인 훈련 로직 활용
    if (typeof startTraining === 'function') {
      // 그룹 훈련 모드 플래그 설정
      window.isGroupTraining = true;
      window.groupTrainingRoom = groupTrainingState.currentRoom;
      
      // 기존 훈련 시작 함수 호출
      startTraining();
      
      // 모니터링 버튼 추가
      addMonitoringButton();
      
      showToast('그룹 훈련이 시작되었습니다!', 'success');
    } else {
      console.error('startTraining function not found');
      showToast('훈련 시작 기능을 찾을 수 없습니다', 'error');
    }
    
  } catch (error) {
    console.error('Failed to start training session:', error);
    showToast('훈련 세션 시작에 실패했습니다', 'error');
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
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 방을 닫을 수 있습니다', 'error');
    return;
  }
  
  const confirmed = confirm('정말 방을 닫으시겠습니까? 모든 참가자가 방에서 나가게 됩니다.');
  if (!confirmed) return;
  
  try {
    const room = groupTrainingState.currentRoom;
    room.status = 'closed';
    
    // 백엔드 업데이트
    await updateRoomOnBackend(room);
    
    // 로컬 상태 정리
    stopRoomSync();
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    
    showToast('방이 닫혔습니다', 'info');
    showScreen('groupRoomScreen');
    
  } catch (error) {
    console.error('Failed to close room:', error);
    showToast('방 닫기에 실패했습니다', 'error');
  }
}

// ========== 그룹 모니터링 기능들 ==========

/**
 * 그룹 모니터링 오버레이 열기
 */
function openGroupMonitoring() {
  if (!groupTrainingState.isAdmin) {
    showToast('관리자만 모니터링을 사용할 수 있습니다', 'error');
    return;
  }
  
  const overlay = safeGet('groupMonitoringOverlay');
  if (!overlay) {
    console.error('Monitoring overlay not found');
    return;
  }
  
  overlay.classList.remove('hidden');
  initializeMonitoring();
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
function initializeGroupRoomScreen() {
  // 역할 선택 초기화
  const adminBtn = safeGet('adminRoleBtn');
  const participantBtn = safeGet('participantRoleBtn');
  const managerBtn = safeGet('managerRoleBtn');
  
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
  if (currentUser && currentUser.grade === '1') {
    console.log('Grade 1 user detected, showing manager options');
    if (managerBtn) {
      managerBtn.classList.remove('hidden');
    }
  } else {
    if (managerBtn) {
      managerBtn.classList.add('hidden');
    }
  }
  
  // 입력값 초기화
  const roomNameInput = safeGet('roomNameInput');
  const roomCodeInput = safeGet('roomCodeInput');
  
  if (roomNameInput) roomNameInput.value = '';
  if (roomCodeInput) roomCodeInput.value = '';
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

console.log('✅ Group Training Manager Part 2 loaded');
