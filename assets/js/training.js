/**
 * Group Training System - 그룹 훈련 시스템 (assets/js/training.js)
 * 실시간 그룹 훈련, 관리자 모니터링, WebRTC 음성 통신 기능
 */

// ========== 전역 변수 ==========
window.GroupTraining = window.GroupTraining || {};

// 그룹 훈련 상태 관리
const GROUP_TRAINING = {
  isGroupMode: false,
  isHost: false,
  roomId: null,
  sessionId: null,
  participants: [],
  hostData: null,
  updateInterval: null,
  syncInterval: 3000, // 3초마다 동기화
  
  // WebRTC 관련
  localStream: null,
  peerConnections: {},
  audioEnabled: false,
  
  // 모니터링 관련
  monitoringData: {},
  lastUpdateTime: null
};

// 훈련실 상태
const ROOM_STATUS = {
  WAITING: 'waiting',
  STARTING: 'starting', 
  TRAINING: 'training',
  FINISHED: 'finished'
};

// ========== 초기화 함수 ==========
let groupTrainingInitRetry = 0;
const maxGroupTrainingRetries = 10;

function initGroupTraining() {
  console.log('🚀 그룹 훈련 시스템 초기화');
  
  // ✅ 재시도 횟수 제한
  if (groupTrainingInitRetry >= maxGroupTrainingRetries) {
    console.error('❌ 그룹 트레이닝 초기화 실패 - 최대 재시도 횟수 초과');
    return;
  }
  
  // ✅ 수정된 필수 의존성 확인 (실제 존재하는 함수들만 체크)
  const requiredFunctions = [
    'apiGetUsers',
    'jsonpRequest', 
    'showToast',
    'showScreen'
  ];
  
  const missingFunctions = requiredFunctions.filter(funcName => typeof window[funcName] !== 'function');
  
  if (missingFunctions.length > 0) {
    groupTrainingInitRetry++;
    console.warn(`⚠️ 그룹 트레이닝 초기화 지연 - 의존성 로딩 대기 (${groupTrainingInitRetry}/${maxGroupTrainingRetries})`);
    console.warn('누락된 함수들:', missingFunctions);
    
    // ✅ 점진적 대기 시간 증가 (최대 5초까지)
    const waitTime = Math.min(500 * groupTrainingInitRetry, 5000);
    setTimeout(initGroupTraining, waitTime);
    return;
  }


// ========== 이벤트 설정 ==========
function setupGroupTrainingEvents() {
  // 그룹 훈련 버튼 이벤트
  const groupTrainingBtn = document.getElementById('btnGroupTraining');
  if (groupTrainingBtn) {
    groupTrainingBtn.addEventListener('click', showGroupTrainingModal);
  }
  
  // 방 생성 버튼
  const createRoomBtn = document.getElementById('btnCreateRoom');
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', createTrainingRoom);
  }
  
  // 방 참가 버튼  
  const joinRoomBtn = document.getElementById('btnJoinRoom');
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', showJoinRoomModal);
  }
}

// ========== 그룹 훈련 모달 표시 ==========
function showGroupTrainingModal() {
  const currentUser = window.currentUser;
  if (!currentUser) {
    showToast('로그인이 필요합니다');
    return;
  }
  
  const isAdmin = currentUser.grade === '1';
  
  const modalHtml = `
    <div id="groupTrainingModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>🏆 그룹 훈련</h3>
          <button class="modal-close" onclick="closeGroupTrainingModal()">✖</button>
        </div>
        
        <div class="modal-body">
          <div class="group-training-intro">
            <p>여러 명이 함께 동시에 훈련할 수 있습니다!</p>
            <div class="feature-list">
              <div class="feature-item">
                <span class="feature-icon">👥</span>
                <span>최대 20명까지 동시 참여</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🎯</span>
                <span>실시간 동기화 훈련</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🎤</span>
                <span>관리자 음성 코칭</span>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📊</span>
                <span>실시간 모니터링</span>
              </div>
            </div>
          </div>
          
          <div class="group-actions">
            ${isAdmin ? `
              <button class="btn btn-success" id="btnCreateRoom">
                <span class="btn-icon">🏠</span>
                훈련실 만들기
              </button>
            ` : ''}
            
            <button class="btn btn-primary" id="btnJoinRoom">
              <span class="btn-icon">🚪</span>
              훈련실 참가하기
            </button>
            
            <button class="btn btn-secondary" id="btnViewActiveRooms">
              <span class="btn-icon">👀</span>
              활성 훈련실 보기
            </button>
          </div>
          
          ${!isAdmin ? `
            <div class="admin-notice">
              <p><strong>💡 알림:</strong> 훈련실 생성은 관리자만 가능합니다</p>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  // 기존 모달 제거 후 새로 추가
  removeExistingModal('groupTrainingModal');
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // 이벤트 리스너 재설정
  setupModalEvents();
  
  // 모달 표시
  const modal = document.getElementById('groupTrainingModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// ========== 모달 이벤트 설정 ==========
function setupModalEvents() {
  const createBtn = document.getElementById('btnCreateRoom');
  const joinBtn = document.getElementById('btnJoinRoom');
  const viewBtn = document.getElementById('btnViewActiveRooms');
  
  if (createBtn) {
    createBtn.addEventListener('click', createTrainingRoom);
  }
  
  if (joinBtn) {
    joinBtn.addEventListener('click', showJoinRoomModal);
  }
  
  if (viewBtn) {
    viewBtn.addEventListener('click', showActiveRooms);
  }
}

// ========== 모달 닫기 ==========
function closeGroupTrainingModal() {
  const modal = document.getElementById('groupTrainingModal');
  if (modal) {
    modal.remove();
  }
}

// ========== 훈련실 생성 ==========
async function createTrainingRoom() {
  const currentUser = window.currentUser;
  const selectedWorkout = window.selectedWorkout;
  
  if (!currentUser || currentUser.grade !== '1') {
    showToast('훈련실 생성은 관리자만 가능합니다');
    return;
  }
  
  if (!selectedWorkout) {
    showToast('먼저 워크아웃을 선택해주세요');
    return;
  }
  
  try {
    showLoading('훈련실을 생성하는 중...');
    
    const roomData = {
      hostId: currentUser.id,
      hostName: currentUser.name,
      workoutId: selectedWorkout.id,
      workoutTitle: selectedWorkout.title,
      maxParticipants: 20,
      status: ROOM_STATUS.WAITING,
      createdAt: new Date().toISOString(),
      participants: [
        {
          userId: currentUser.id,
          userName: currentUser.name,
          isHost: true,
          joinedAt: new Date().toISOString()
        }
      ]
    };
    
    // [training.js] — POST → GET 통일 (간단 버전)
    const q = new URLSearchParams({
      action: 'createTrainingRoom',
      hostId: currentUser.id,
      hostName: currentUser.name,
      workoutId: selectedWorkout.id,
      workoutTitle: selectedWorkout.title,
      maxParticipants: '30',
      status: ROOM_STATUS.WAITING
    });
    const response = await fetch(`${window.GAS_URL}?${q.toString()}`);
    const result = await response.json();

    
    if (result.success) {
      GROUP_TRAINING.roomId = result.roomId;
      GROUP_TRAINING.isHost = true;
      GROUP_TRAINING.isGroupMode = true;
      
      hideLoading();
      closeGroupTrainingModal();
      showTrainingRoom();
      
      showToast('훈련실이 생성되었습니다!');
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    hideLoading();
    console.error('훈련실 생성 오류:', error);
    showToast('훈련실 생성에 실패했습니다: ' + error.message);
  }
}

// ========== 훈련실 참가 모달 ==========
function showJoinRoomModal() {
  const modalHtml = `
    <div id="joinRoomModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>🚪 훈련실 참가</h3>
          <button class="modal-close" onclick="closeJoinRoomModal()">✖</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label for="roomIdInput">훈련실 ID</label>
            <input type="text" id="roomIdInput" placeholder="훈련실 ID를 입력하세요" maxlength="10">
            <small class="form-help">관리자로부터 받은 훈련실 ID를 입력하세요</small>
          </div>
          
          <div class="join-actions">
            <button class="btn btn-primary" onclick="joinTrainingRoom()">
              <span class="btn-icon">🔗</span>
              참가하기
            </button>
            <button class="btn btn-secondary" onclick="closeJoinRoomModal()">
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  removeExistingModal('joinRoomModal');
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  const modal = document.getElementById('joinRoomModal');
  if (modal) {
    modal.style.display = 'flex';
    
    // 입력 필드에 포커스
    const input = document.getElementById('roomIdInput');
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }
}

// ========== 훈련실 참가 ==========
async function joinTrainingRoom() {
  const roomIdInput = document.getElementById('roomIdInput');
  const roomId = roomIdInput?.value?.trim();
  const currentUser = window.currentUser;
  
  if (!roomId) {
    showToast('훈련실 ID를 입력하세요');
    return;
  }
  
  if (!currentUser) {
    showToast('로그인이 필요합니다');
    return;
  }
  
  try {
    showLoading('훈련실에 참가하는 중...');
    
    const response = await fetch(`${window.GAS_URL}?action=joinTrainingRoom&roomId=${roomId}&userId=${currentUser.id}&userName=${encodeURIComponent(currentUser.name)}`);
    const result = await response.json();
    
    if (result.success) {
      GROUP_TRAINING.roomId = roomId;
      GROUP_TRAINING.isHost = false;
      GROUP_TRAINING.isGroupMode = true;
      
      // 워크아웃 정보 설정
      if (result.workoutId) {
        await loadWorkoutForGroup(result.workoutId);
      }
      
      hideLoading();
      closeJoinRoomModal();
      showTrainingRoom();
      
      showToast('훈련실에 참가했습니다!');
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    hideLoading();
    console.error('훈련실 참가 오류:', error);
    showToast('훈련실 참가에 실패했습니다: ' + error.message);
  }
}

// ========== 워크아웃 로드 ==========
async function loadWorkoutForGroup(workoutId) {
  try {
    const response = await fetch(`${window.GAS_URL}?action=getWorkout&id=${workoutId}`);
    const result = await response.json();
    
    if (result.success) {
      window.selectedWorkout = result.workout;
    }
  } catch (error) {
    console.error('워크아웃 로드 오류:', error);
  }
}

// ========== 훈련실 화면 표시 ==========
function showTrainingRoom() {
  // 기존 화면 숨기기
  hideAllScreens();
  
  const roomHtml = `
    <div id="groupTrainingRoomScreen" class="screen active">
      <div class="header">
        <h1>🏆 그룹 훈련실</h1>
        <p class="subtitle">
          ${GROUP_TRAINING.isHost ? '관리자' : '참가자'} | 
          훈련실 ID: <strong>${GROUP_TRAINING.roomId}</strong>
        </p>
      </div>
      
      <div class="room-content">
        <!-- 훈련 상태 표시 -->
        <div class="training-status-card">
          <div class="status-info">
            <div class="status-indicator" id="roomStatusIndicator">
              <span class="status-dot waiting"></span>
              <span id="roomStatusText">대기 중</span>
            </div>
            <div class="workout-info">
              <h3 id="roomWorkoutTitle">${window.selectedWorkout?.title || '워크아웃'}</h3>
              <p id="roomWorkoutDuration">${formatDuration(window.selectedWorkout?.total_seconds || 0)}</p>
            </div>
          </div>
        </div>
        
        <!-- 참가자 목록 -->
        <div class="participants-section">
          <h3>👥 참가자 목록</h3>
          <div id="participantsList" class="participants-list">
            <!-- 동적으로 생성 -->
          </div>
        </div>
        
        <!-- 관리자 컨트롤 (호스트만 표시) -->
        ${GROUP_TRAINING.isHost ? `
          <div class="host-controls">
            <h3>🎮 관리자 컨트롤</h3>
            <div class="control-buttons">
              <button class="btn btn-primary" id="btnStartCountdown">
                <span class="btn-icon">⏰</span>
                훈련 시작 (10초 카운트다운)
              </button>
              
              <button class="btn btn-secondary" id="btnToggleMic" disabled>
                <span class="btn-icon">🎤</span>
                <span id="micStatus">마이크 켜기</span>
              </button>
              
              <button class="btn btn-warning" id="btnEndTraining" style="display: none;">
                <span class="btn-icon">⏹️</span>
                훈련 종료
              </button>
            </div>
          </div>
        ` : ''}
        
        <!-- 채팅/메시지 -->
        <div class="chat-section">
          <h3>💬 메시지</h3>
          <div id="chatMessages" class="chat-messages">
            <div class="chat-message system">
              <span class="timestamp">${formatTime(new Date())}</span>
              <span class="message">훈련실에 입장했습니다</span>
            </div>
          </div>
        </div>
        
        <!-- 하단 버튼 -->
        <div class="room-actions">
          <button class="btn btn-danger" onclick="leaveTrainingRoom()">
            <span class="btn-icon">🚪</span>
            훈련실 나가기
          </button>
        </div>
      </div>
    </div>
  `;
  
  // 기존 그룹 훈련 화면 제거 후 새로 추가
  const existingScreen = document.getElementById('groupTrainingRoomScreen');
  if (existingScreen) {
    existingScreen.remove();
  }
  
  document.body.insertAdjacentHTML('beforeend', roomHtml);
  
  // 이벤트 리스너 설정
  setupRoomEvents();
  
  // 상태 업데이트 시작
  startRoomStatusUpdates();
  
  // 초기 참가자 목록 로드
  updateParticipantsList();
}

// ========== 훈련실 이벤트 설정 ==========
function setupRoomEvents() {
  const startBtn = document.getElementById('btnStartCountdown');
  const micBtn = document.getElementById('btnToggleMic');
  const endBtn = document.getElementById('btnEndTraining');
  
  if (startBtn) {
    startBtn.addEventListener('click', startGroupTrainingCountdown);
  }
  
  if (micBtn) {
    micBtn.addEventListener('click', toggleMicrophone);
  }
  
  if (endBtn) {
    endBtn.addEventListener('click', endGroupTraining);
  }
}

// ========== 그룹 훈련 시작 카운트다운 ==========
async function startGroupTrainingCountdown() {
  if (!GROUP_TRAINING.isHost) {
    showToast('훈련 시작은 관리자만 가능합니다');
    return;
  }
  
  try {
    // 서버에 훈련 시작 신호 전송
    const response = await fetch(`${window.GAS_URL}?action=startGroupTraining&roomId=${GROUP_TRAINING.roomId}`);
    const result = await response.json();
    
    if (result.success) {
      showGroupCountdown();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('그룹 훈련 시작 오류:', error);
    showToast('훈련 시작에 실패했습니다');
  }
}

// ========== 그룹 카운트다운 표시 ==========
function showGroupCountdown() {
  const countdownOverlay = `
    <div id="groupCountdownOverlay" class="countdown-overlay">
      <div class="countdown-content">
        <h2>🚀 그룹 훈련 시작!</h2>
        <div class="countdown-number" id="countdownNumber">10</div>
        <p>모든 참가자가 동시에 시작합니다</p>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', countdownOverlay);
  
  let count = 10;
  const countdownInterval = setInterval(() => {
    count--;
    const numberEl = document.getElementById('countdownNumber');
    if (numberEl) {
      numberEl.textContent = count;
      
      if (count <= 3) {
        numberEl.style.color = '#e74c3c';
        numberEl.style.transform = 'scale(1.2)';
      }
    }
    
    if (count <= 0) {
      clearInterval(countdownInterval);
      
      // 카운트다운 오버레이 제거
      const overlay = document.getElementById('groupCountdownOverlay');
      if (overlay) {
        overlay.remove();
      }
      
      // 실제 훈련 시작
      startActualGroupTraining();
    }
  }, 1000);
}

// ========== 실제 그룹 훈련 시작 ==========
function startActualGroupTraining() {
  // 기존 훈련 화면으로 전환
  hideAllScreens();
  
  const trainingScreen = document.getElementById('trainingScreen');
  if (trainingScreen) {
    trainingScreen.classList.add('active');
  }
  
  // 그룹 모드로 훈련 시작
  if (window.initTraining) {
    GROUP_TRAINING.isGroupMode = true;
    window.trainingSession.isGroupMode = true;
    window.initTraining();
  }
  
  // 관리자용 모니터링 오버레이 추가
  if (GROUP_TRAINING.isHost) {
    addMonitoringOverlay();
  }
  
  showToast('그룹 훈련이 시작되었습니다!');
}

// ========== 관리자 모니터링 오버레이 ==========
function addMonitoringOverlay() {
  const monitoringHtml = `
    <div id="monitoringOverlay" class="monitoring-overlay">
      <div class="monitoring-header">
        <h4>📊 참가자 모니터링</h4>
        <button class="btn-close-monitoring" onclick="toggleMonitoringOverlay()">─</button>
      </div>
      <div id="monitoringContent" class="monitoring-content">
        <!-- 동적으로 생성 -->
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', monitoringHtml);
  
  // 모니터링 데이터 업데이트 시작
  startMonitoringUpdates();
}

// ========== 마이크 토글 ==========
async function toggleMicrophone() {
  if (!GROUP_TRAINING.isHost) {
    showToast('마이크 기능은 관리자만 사용할 수 있습니다');
    return;
  }
  
  try {
    if (!GROUP_TRAINING.audioEnabled) {
      // 마이크 활성화
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      GROUP_TRAINING.localStream = stream;
      GROUP_TRAINING.audioEnabled = true;
      
      updateMicButton(true);
      showToast('마이크가 활성화되었습니다');
      
      // WebRTC 연결 설정 (실제 구현 시 추가)
      // setupWebRTCConnections();
      
    } else {
      // 마이크 비활성화
      if (GROUP_TRAINING.localStream) {
        GROUP_TRAINING.localStream.getTracks().forEach(track => track.stop());
        GROUP_TRAINING.localStream = null;
      }
      
      GROUP_TRAINING.audioEnabled = false;
      updateMicButton(false);
      showToast('마이크가 비활성화되었습니다');
    }
  } catch (error) {
    console.error('마이크 설정 오류:', error);
    showToast('마이크 접근에 실패했습니다. 브라우저 권한을 확인해주세요.');
  }
}

// ========== 마이크 버튼 업데이트 ==========
function updateMicButton(enabled) {
  const micBtn = document.getElementById('btnToggleMic');
  const micStatus = document.getElementById('micStatus');
  
  if (micBtn && micStatus) {
    if (enabled) {
      micBtn.className = 'btn btn-danger';
      micStatus.textContent = '마이크 끄기';
      micBtn.querySelector('.btn-icon').textContent = '🔴';
    } else {
      micBtn.className = 'btn btn-secondary';
      micStatus.textContent = '마이크 켜기';
      micBtn.querySelector('.btn-icon').textContent = '🎤';
    }
  }
}

// ========== 상태 업데이트 시작 ==========
function startRoomStatusUpdates() {
  if (GROUP_TRAINING.updateInterval) {
    clearInterval(GROUP_TRAINING.updateInterval);
  }
  
  GROUP_TRAINING.updateInterval = setInterval(async () => {
    await updateRoomStatus();
  }, GROUP_TRAINING.syncInterval);
  
  // 초기 업데이트
  updateRoomStatus();
}

// ========== 방 상태 업데이트 ==========
async function updateRoomStatus() {
  if (!GROUP_TRAINING.roomId) return;
  
  try {
    const response = await fetch(`${window.GAS_URL}?action=getRoomStatus&roomId=${GROUP_TRAINING.roomId}`);
    const result = await response.json();
    
    if (result.success) {
      const roomData = result.room;
      updateRoomUI(roomData);
      
      // 훈련 시작 신호 체크
      if (roomData.status === ROOM_STATUS.STARTING && !GROUP_TRAINING.isHost) {
        startGroupTrainingCountdown();
      }
    }
  } catch (error) {
    console.error('방 상태 업데이트 오류:', error);
  }
}

// ========== 방 UI 업데이트 ==========
function updateRoomUI(roomData) {
  // 상태 표시 업데이트
  const statusIndicator = document.getElementById('roomStatusIndicator');
  const statusText = document.getElementById('roomStatusText');
  
  if (statusIndicator && statusText) {
    const statusDot = statusIndicator.querySelector('.status-dot');
    statusDot.className = `status-dot ${roomData.status}`;
    
    const statusTexts = {
      [ROOM_STATUS.WAITING]: '대기 중',
      [ROOM_STATUS.STARTING]: '시작 준비 중',
      [ROOM_STATUS.TRAINING]: '훈련 중',
      [ROOM_STATUS.FINISHED]: '훈련 완료'
    };
    
    statusText.textContent = statusTexts[roomData.status] || '알 수 없음';
  }
  
  // 참가자 목록 업데이트
  GROUP_TRAINING.participants = roomData.participants || [];
  updateParticipantsList();
}

// ========== 참가자 목록 업데이트 ==========
function updateParticipantsList() {
  const participantsList = document.getElementById('participantsList');
  if (!participantsList) return;
  
  if (GROUP_TRAINING.participants.length === 0) {
    participantsList.innerHTML = `
      <div class="empty-participants">
        <p>아직 참가자가 없습니다</p>
      </div>
    `;
    return;
  }
  
  const participantsHtml = GROUP_TRAINING.participants.map(participant => `
    <div class="participant-item ${participant.isHost ? 'host' : ''}">
      <div class="participant-info">
        <span class="participant-name">${escapeHtml(participant.userName)}</span>
        ${participant.isHost ? '<span class="host-badge">관리자</span>' : ''}
      </div>
      <div class="participant-status">
        <span class="status-dot online"></span>
        <small>온라인</small>
      </div>
    </div>
  `).join('');
  
  participantsList.innerHTML = participantsHtml;
}

// ========== 활성 훈련실 보기 ==========
async function showActiveRooms() {
  try {
    showLoading('활성 훈련실을 조회하는 중...');
    
    const response = await fetch(`${window.GAS_URL}?action=listActiveRooms`);
    const result = await response.json();
    
    hideLoading();
    
    if (result.success) {
      displayActiveRoomsModal(result.rooms || []);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    hideLoading();
    console.error('활성 훈련실 조회 오류:', error);
    showToast('훈련실 목록을 가져올 수 없습니다');
  }
}

// ========== 활성 훈련실 모달 표시 ==========
function displayActiveRoomsModal(rooms) {
  const roomsHtml = rooms.length > 0 ? rooms.map(room => `
    <div class="room-item">
      <div class="room-info">
        <h4>${escapeHtml(room.workoutTitle)}</h4>
        <p>관리자: ${escapeHtml(room.hostName)}</p>
        <p>참가자: ${room.participantCount}/${room.maxParticipants}명</p>
      </div>
      <div class="room-actions">
        <button class="btn btn-primary btn-sm" onclick="quickJoinRoom('${room.id}')">
          참가하기
        </button>
      </div>
    </div>
  `).join('') : `
    <div class="empty-rooms">
      <p>현재 활성 상태인 훈련실이 없습니다</p>
    </div>
  `;
  
  const modalHtml = `
    <div id="activeRoomsModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>🏠 활성 훈련실</h3>
          <button class="modal-close" onclick="closeActiveRoomsModal()">✖</button>
        </div>
        
        <div class="modal-body">
          <div class="rooms-list">
            ${roomsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
  
  removeExistingModal('activeRoomsModal');
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  const modal = document.getElementById('activeRoomsModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// ========== 빠른 방 참가 ==========
async function quickJoinRoom(roomId) {
  const currentUser = window.currentUser;
  
  if (!currentUser) {
    showToast('로그인이 필요합니다');
    return;
  }
  
  try {
    showLoading('훈련실에 참가하는 중...');
    
    const response = await fetch(`${window.GAS_URL}?action=joinTrainingRoom&roomId=${roomId}&userId=${currentUser.id}&userName=${encodeURIComponent(currentUser.name)}`);
    const result = await response.json();
    
    if (result.success) {
      GROUP_TRAINING.roomId = roomId;
      GROUP_TRAINING.isHost = false;
      GROUP_TRAINING.isGroupMode = true;
      
      // 워크아웃 정보 설정
      if (result.workoutId) {
        await loadWorkoutForGroup(result.workoutId);
      }
      
      hideLoading();
      closeActiveRoomsModal();
      closeGroupTrainingModal();
      showTrainingRoom();
      
      showToast('훈련실에 참가했습니다!');
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    hideLoading();
    console.error('훈련실 참가 오류:', error);
    showToast('훈련실 참가에 실패했습니다: ' + error.message);
  }
}

// ========== 훈련실 나가기 ==========
async function leaveTrainingRoom() {
  const currentUser = window.currentUser;
  
  if (!currentUser || !GROUP_TRAINING.roomId) {
    return;
  }
  
  try {
    // 서버에 나가기 신호 전송
    await fetch(`${window.GAS_URL}?action=leaveTrainingRoom&roomId=${GROUP_TRAINING.roomId}&userId=${currentUser.id}`);
    
    // 로컬 상태 정리
    cleanupGroupTraining();
    
    // 원래 화면으로 돌아가기
    hideAllScreens();
    const readyScreen = document.getElementById('trainingReadyScreen');
    if (readyScreen) {
      readyScreen.classList.add('active');
    }
    
    showToast('훈련실에서 나왔습니다');
    
  } catch (error) {
    console.error('훈련실 나가기 오류:', error);
    showToast('훈련실 나가기에 실패했습니다');
  }
}

// ========== 정리 함수 ==========
function cleanupGroupTraining() {
  // 인터벌 정리
  if (GROUP_TRAINING.updateInterval) {
    clearInterval(GROUP_TRAINING.updateInterval);
    GROUP_TRAINING.updateInterval = null;
  }
  
  // 마이크 스트림 정리
  if (GROUP_TRAINING.localStream) {
    GROUP_TRAINING.localStream.getTracks().forEach(track => track.stop());
    GROUP_TRAINING.localStream = null;
  }
  
  // WebRTC 연결 정리
  Object.values(GROUP_TRAINING.peerConnections).forEach(pc => {
    if (pc) pc.close();
  });
  GROUP_TRAINING.peerConnections = {};
  
  // 상태 초기화
  GROUP_TRAINING.isGroupMode = false;
  GROUP_TRAINING.isHost = false;
  GROUP_TRAINING.roomId = null;
  GROUP_TRAINING.sessionId = null;
  GROUP_TRAINING.participants = [];
  GROUP_TRAINING.audioEnabled = false;
  
  // UI 요소 제거
  const groupElements = [
    'groupTrainingRoomScreen',
    'monitoringOverlay',
    'groupCountdownOverlay'
  ];
  
  groupElements.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.remove();
  });
  
  // 훈련 세션 그룹 모드 해제
  if (window.trainingSession) {
    window.trainingSession.isGroupMode = false;
  }
}

// ========== 유틸리티 함수들 ==========
function hideAllScreens() {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(screen => screen.classList.remove('active'));
}

function removeExistingModal(modalId) {
  const existing = document.getElementById(modalId);
  if (existing) {
    existing.remove();
  }
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}분 ${secs}초`;
}

function formatTime(date) {
  return date.toLocaleTimeString('ko-KR', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showLoading(message = '처리 중...') {
  // 기존 로딩 함수 사용 또는 구현
  if (window.showLoading) {
    window.showLoading(message);
  } else {
    console.log('Loading:', message);
  }
}

function hideLoading() {
  // 기존 로딩 함수 사용 또는 구현
  if (window.hideLoading) {
    window.hideLoading();
  }
}

function showToast(message) {
  // 기존 토스트 함수 사용 또는 구현
  if (window.showToast) {
    window.showToast(message);
  } else {
    alert(message);
  }
}

// ========== 모달 닫기 함수들 (전역으로 노출) ==========
window.closeGroupTrainingModal = closeGroupTrainingModal;
window.closeJoinRoomModal = () => {
  const modal = document.getElementById('joinRoomModal');
  if (modal) modal.remove();
};
window.closeActiveRoomsModal = () => {
  const modal = document.getElementById('activeRoomsModal');
  if (modal) modal.remove();
};
window.joinTrainingRoom = joinTrainingRoom;
window.quickJoinRoom = quickJoinRoom;
window.leaveTrainingRoom = leaveTrainingRoom;
window.toggleMonitoringOverlay = () => {
  const overlay = document.getElementById('monitoringOverlay');
  if (overlay) {
    overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
  }
};

// ========== 초기화 실행 ==========
if (typeof window !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGroupTraining);
} else if (typeof window !== 'undefined') {
  initGroupTraining();
}

// ========== 내보내기 ==========
// 2) 하단 export 블록 삭제하고 전역 노출
window.GROUP_TRAINING = window.GROUP_TRAINING || GROUP_TRAINING;
window.ROOM_STATUS = ROOM_STATUS;

window.initGroupTraining = initGroupTraining;
window.showGroupTrainingModal = showGroupTrainingModal;
window.closeGroupTrainingModal = closeGroupTrainingModal;
window.createTrainingRoom = createTrainingRoom;
window.showJoinRoomModal = showJoinRoomModal;
window.joinTrainingRoom = joinTrainingRoom;
window.showTrainingRoom = showTrainingRoom;
window.startGroupTrainingCountdown = startGroupTrainingCountdown;
window.toggleMicrophone = toggleMicrophone;
window.showActiveRooms = showActiveRooms;
