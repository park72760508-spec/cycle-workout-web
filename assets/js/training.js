// Updated: 2025-11-16 12:00 (KST) - Change header auto-stamped per edit

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


// training.js 상단 또는 유틸 섹션
const toast = (msg) => (typeof window.showToast === 'function' ? window.showToast(msg) : console.log('[Toast]', msg));
const loading = (msg) => (typeof window.showLoading === 'function' ? window.showLoading(msg) : console.log('[Loading]', msg));
const hide = () => (typeof window.hideLoading === 'function' ? window.hideLoading() : void 0);

// 사용 예:
// toast('인증을 시작합니다');
// loading('처리 중…');
// hide();




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

  // ✅ 필수 의존성 확인
  const requiredFunctions = ['apiGetUsers','jsonpRequest','showToast','showScreen'];
  const missingFunctions = requiredFunctions.filter(fn => typeof window[fn] !== 'function');

  if (missingFunctions.length > 0) {
    groupTrainingInitRetry++;
    console.warn(`⚠️ 그룹 트레이닝 초기화 지연 - 의존성 로딩 대기 (${groupTrainingInitRetry}/${maxGroupTrainingRetries})`);
    console.warn('누락된 함수들:', missingFunctions);

    const waitTime = Math.min(500 * groupTrainingInitRetry, 5000);
    setTimeout(initGroupTraining, waitTime);
    return;
  }

  // ✅ 의존성 준비 완료 → 이벤트 바인딩 및 안내
  setupGroupTrainingEvents();
  console.log('✅ 그룹 훈련 시스템 준비 완료');
} // ←←← ★★★ 이 닫힘 중괄호가 빠져 있었습니다 ★★★

// ========== 이벤트 설정 ==========
function setupGroupTrainingEvents() {
  // 그룹 훈련 버튼 이벤트는 index.html의 onclick 또는 app.js에서 처리하므로 여기서는 제거
  // btnGroupTraining 버튼은 selectTrainingMode('group')를 직접 호출하도록 변경됨
  
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
/**
 * 향상된 그룹 훈련 모달 (관리자용 버튼 수정)
 */
function showGroupTrainingModal() {
  const currentUser = window.currentUser;
  if (!currentUser) {
    if (typeof showToast === 'function') {
      showToast('로그인이 필요합니다');
    } else {
      alert('로그인이 필요합니다');
    }
    return;
  }
  
  const isAdmin = currentUser.grade === '1' || currentUser.grade === 1;
  console.log('그룹 훈련 모달 표시 - 관리자 권한:', isAdmin);
  
  const modalHtml = `
    <div id="groupTrainingModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>🏆 그룹 훈련 ${isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''}</h3>
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
          
          ${isAdmin ? `
            <div class="admin-actions-section" style="margin: 24px 0; padding: 20px; background: rgba(111, 66, 193, 0.1); border-radius: 12px; border: 1px solid rgba(111, 66, 193, 0.2);">
              <h4 style="color: #6f42c1; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                👑 관리자 전용 기능
              </h4>
              <div class="admin-modal-actions" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                <button class="btn btn-success" onclick="showTrainingRoomManagement(); closeGroupTrainingModal();" style="display: flex; align-items: center; gap: 8px; justify-content: center; padding: 12px 16px;">
                  <span class="btn-icon">🏠</span>
                  훈련실 관리
                </button>
                
                <button class="btn btn-warning" onclick="showActiveRoomsManagement(); closeGroupTrainingModal();" style="display: flex; align-items: center; gap: 8px; justify-content: center; padding: 12px 16px;">
                  <span class="btn-icon">📊</span>
                  모니터링
                </button>
                
                <button class="btn btn-info" onclick="quickCreateRoom(); closeGroupTrainingModal();" style="display: flex; align-items: center; gap: 8px; justify-content: center; padding: 12px 16px;">
                  <span class="btn-icon">⚡</span>
                  즉시 생성
                </button>
              </div>
            </div>
          ` : ''}
          
          <div class="general-actions" style="margin-top: ${isAdmin ? '16px' : '24px'};">
            <h4 style="margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
              🚪 일반 기능
            </h4>
            <div class="group-actions" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <button class="btn btn-primary" id="btnJoinRoom" style="display: flex; align-items: center; gap: 8px; justify-content: center; padding: 12px 16px;">
                <span class="btn-icon">🚪</span>
                훈련실 참가하기
              </button>
              
              <button class="btn btn-secondary" onclick="showActiveRoomsManagement(); closeGroupTrainingModal();" style="display: flex; align-items: center; gap: 8px; justify-content: center; padding: 12px 16px;">
                <span class="btn-icon">👀</span>
                활성 훈련실 보기
              </button>
            </div>
          </div>
          
          ${!isAdmin ? `
            <div class="admin-notice" style="margin-top: 20px; padding: 16px; background: rgba(45, 116, 232, 0.1); border-radius: 8px; border-left: 4px solid #2e74e8;">
              <p style="margin: 0; color: #2e74e8;"><strong>💡 알림:</strong> 훈련실 생성은 관리자만 가능합니다</p>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  // 기존 모달 제거 후 새로 추가
  if (typeof removeExistingModal === 'function') {
    removeExistingModal('groupTrainingModal');
  } else {
    const existing = document.getElementById('groupTrainingModal');
    if (existing) existing.remove();
  }
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // 이벤트 리스너 재설정
  if (typeof setupModalEvents === 'function') {
    setupModalEvents();
  }
  
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
    
    // GAS_URL 확인
        if (!window.GAS_URL || window.GAS_URL.includes('https://script.google.com/macros/s/AKfycbzF8br63uD3ziNxCFkp0UUSpP49zURthDsEVZ6o3uRu47pdS5uXE5S1oJ3d7AKHFouJ/exec')) {
          throw new Error('GAS_URL이 설정되지 않았습니다. 관리자에게 문의하세요.');
        }
        
        const response = await fetch(`${window.GAS_URL}?${q.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();

    
    if (result.success) {
      GROUP_TRAINING.roomId = result.roomId;
      GROUP_TRAINING.isHost = true;
      GROUP_TRAINING.isGroupMode = true;
      
      if (typeof hideLoading === 'function') hideLoading();
            
            if (typeof closeGroupTrainingModal === 'function') {
              closeGroupTrainingModal();
            }
            
            if (typeof showTrainingRoom === 'function') {
              showTrainingRoom();
            } else {
              console.log('훈련실 화면으로 이동합니다...');
              // 대체 로직: 화면 전환
              if (typeof showScreen === 'function') {
                showScreen('groupTrainingScreen');
              }
            }
            
            if (typeof showToast === 'function') {
              showToast('훈련실이 생성되었습니다!');
            } else {
              alert('훈련실이 생성되었습니다!');
            }
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
  const roomCode = roomIdInput?.value?.trim()?.toUpperCase();
  const currentUser = window.currentUser;
  
  if (!roomCode) {
    showToast('훈련실 코드를 입력하세요', 'error');
    return;
  }
  
  if (roomCode.length !== 6) {
    showToast('방 코드는 6자리여야 합니다', 'error');
    return;
  }
  
  if (!currentUser) {
    showToast('로그인이 필요합니다. 사용자를 선택해주세요.', 'error');
    return;
  }
  
  try {
    console.log('🚀 joinTrainingRoom 호출:', roomCode);
    
    // groupTrainingManager.js의 joinRoomByCode 함수 사용
    if (typeof joinRoomByCode === 'function') {
      console.log('✅ joinRoomByCode 함수 사용');
      closeJoinRoomModal();
      await joinRoomByCode(roomCode);
      return;
    }
    
    // 대체 방법: groupTrainingManager.js의 joinGroupRoom 함수 사용
    if (typeof joinGroupRoom === 'function') {
      console.log('✅ joinGroupRoom 함수 사용');
      // 방 코드 입력 필드 설정
      const roomCodeInput = document.getElementById('roomCodeInput');
      if (roomCodeInput) {
        roomCodeInput.value = roomCode;
      } else {
        // roomCodeInput이 없으면 임시로 생성
        const tempInput = document.createElement('input');
        tempInput.id = 'roomCodeInput';
        tempInput.value = roomCode;
        tempInput.style.display = 'none';
        document.body.appendChild(tempInput);
      }
      
      closeJoinRoomModal();
      await joinGroupRoom();
      return;
    }
    
    // 최후의 수단: 직접 API 호출 (JSONP 방식)
    console.log('⚠️ 직접 API 호출 (fallback)');
    showLoading('훈련실에 참가하는 중...');
    
    // JSONP 방식으로 joinRoom API 호출
    if (typeof jsonpRequest === 'function' && window.GAS_URL) {
      const joinResult = await jsonpRequest(window.GAS_URL, {
        action: 'joinRoom',
        roomCode: roomCode,
        participantId: String(currentUser.id),
        participantName: String(currentUser.name || '참가자')
      });
      
      hideLoading();
      
      if (joinResult?.success) {
        closeJoinRoomModal();
        
        // 그룹 훈련 상태 업데이트
        if (window.groupTrainingState) {
          window.groupTrainingState.roomCode = roomCode;
          window.groupTrainingState.isAdmin = false;
        }
        
        // 화면 전환
        if (typeof showScreen === 'function') {
          showScreen('groupWaitingScreen');
        }
        
        if (typeof initializeWaitingRoom === 'function') {
          initializeWaitingRoom();
        }
        
        showToast('방에 참가했습니다!', 'success');
      } else {
        throw new Error(joinResult?.error || '방 참가에 실패했습니다');
      }
    } else {
      throw new Error('그룹 훈련 참가 기능을 사용할 수 없습니다. groupTrainingManager.js가 로드되었는지 확인해주세요.');
    }
    
  } catch (error) {
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    console.error('❌ 훈련실 참가 오류:', error);
    console.error('오류 스택:', error.stack);
    
    let errorMessage = '훈련실 참가에 실패했습니다';
    if (error.message) {
      errorMessage += ': ' + error.message;
    } else if (typeof error === 'string') {
      errorMessage += ': ' + error;
    }
    
    showToast(errorMessage, 'error');
  }
}

// ========== 워크아웃 로드 ==========
async function loadWorkoutForGroup(workoutId) {
  try {
    const result = await window.stelvioWorkoutGet(workoutId);
    
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



/**
 * JSONP 요청 함수 (training.js용)
 */
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      reject(new Error('유효하지 않은 URL입니다.'));
      return;
    }
    
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let isResolved = false;
    
    window[callbackName] = function(data) {
      if (isResolved) return;
      isResolved = true;
      
      cleanup();
      resolve(data);
    };
    
    function cleanup() {
      try {
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      } catch (e) {
        console.warn('JSONP cleanup warning:', e);
      }
    }
    
    script.onerror = function() {
      if (isResolved) return;
      isResolved = true;
      
      cleanup();
      reject(new Error('네트워크 연결 오류'));
    };
    
    try {
      const urlParts = [];
      Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
          const value = String(params[key]);
          urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      });
      
      urlParts.push(`callback=${encodeURIComponent(callbackName)}`);
      
      const finalUrl = `${url}?${urlParts.join('&')}`;
      script.src = finalUrl;
      
      document.head.appendChild(script);
      
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error('요청 시간 초과'));
        }
      }, 30000);
      
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * 재시도가 포함된 JSONP 요청 (training.js용)
 */
async function jsonpRequestWithRetry(url, params = {}, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`훈련실 API 요청 시도 ${attempt}/${maxRetries}`);
      const result = await jsonpRequest(url, params);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`훈련실 API 요청 ${attempt}회 실패:`, error.message);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}



// ========== 활성 훈련실 보기 ==========
async function showActiveRooms() {
  try {
    showLoading('활성 훈련실을 조회하는 중...');
    
    // JSONP 방식으로 API 호출 (그룹 훈련 모듈과 일관성 유지)
    const result = await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'listGroupRooms'
      // 모든 상태의 방 조회 (waiting, training, completed)
    });
    
    hideLoading();
    
    if (result && result.success) {
      // 활성 상태(대기중, 훈련중)인 방만 필터링
      const activeRooms = (result.items || result.rooms || []).filter(room => {
        const status = room.status || room.Status || '';
        return status === 'waiting' || status === 'training';
      });
      
      console.log(`✅ 활성 훈련실 ${activeRooms.length}개 조회 성공`);
      displayActiveRoomsModal(activeRooms);
    } else {
      throw new Error(result?.error || 'API 응답 실패');
    }
  } catch (error) {
    hideLoading();
    console.error('활성 훈련실 조회 오류:', error);
    
    // 대체 방법: localStorage에서 로컬 방 목록 조회
    try {
      const localRooms = getLocalActiveRooms();
      if (localRooms.length > 0) {
        console.log(`📂 로컬에서 ${localRooms.length}개 훈련실 발견`);
        displayActiveRoomsModal(localRooms);
        showToast('로컬 훈련실 목록을 표시합니다', 'warning');
      } else {
        showToast('현재 활성 훈련실이 없습니다');
        displayActiveRoomsModal([]);
      }
    } catch (fallbackError) {
      console.error('로컬 데이터 조회도 실패:', fallbackError);
      showToast('훈련실 목록을 가져올 수 없습니다');
      displayActiveRoomsModal([]);
    }
  }
}

/**
 * 로컬 저장소에서 활성 훈련실 목록 조회 (대체 방법)
 */
function getLocalActiveRooms() {
  try {
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    return Object.values(rooms).filter(room => 
      room.status === 'waiting' || room.status === 'training'
    );
  } catch (error) {
    console.warn('로컬 훈련실 데이터 조회 실패:', error);
    return [];
  }
}

// ========== 활성 훈련실 모달 표시 ==========
function displayActiveRoomsModal(rooms) {
  const roomsHtml = rooms.length > 0 ? rooms.map(room => {
    // 방 데이터 정규화 (다양한 응답 구조 지원)
    const roomName = room.name || room.roomName || room.RoomName || '이름 없음';
    const adminName = room.adminName || room.hostName || room.AdminName || '관리자';
    const workoutTitle = room.workoutTitle || room.workoutName || room.WorkoutTitle || '워크아웃';
    const participants = room.participants || room.ParticipantsData || [];
    const maxParticipants = room.maxParticipants || room.MaxParticipants || 10;
    const status = room.status || room.Status || 'unknown';
    const roomCode = room.code || room.roomCode || room.RoomCode || room.id;
    
    const statusText = {
      'waiting': '🟡 대기중',
      'training': '🟢 훈련중',
      'completed': '⚪ 완료',
      'closed': '🔴 종료'
    }[status] || '❓ 알 수 없음';
    
    return `
      <div class="room-item" data-room-id="${room.id || roomCode}">
        <div class="room-info">
          <h4>${escapeHtml(roomName)}</h4>
          <p><strong>워크아웃:</strong> ${escapeHtml(workoutTitle)}</p>
          <p><strong>관리자:</strong> ${escapeHtml(adminName)}</p>
          <p><strong>참가자:</strong> ${participants.length}/${maxParticipants}명</p>
          <p><strong>방 코드:</strong> ${escapeHtml(roomCode)}</p>
          <p><strong>상태:</strong> ${statusText}</p>
          <p><strong>생성시간:</strong> ${room.createdAt ? new Date(room.createdAt).toLocaleTimeString() : '알 수 없음'}</p>
        </div>
        <div class="room-actions">
          ${status === 'training' ? 
            `<button class="btn btn-primary btn-sm" onclick="monitorRoom('${roomCode}')">
              🎯 모니터링
            </button>` : 
            status === 'waiting' ?
            `<button class="btn btn-success btn-sm" onclick="navigateToJoinRoom('${roomCode}')">
              👥 참가하기
            </button>` :
            `<button class="btn btn-secondary btn-sm" onclick="viewRoomDetails('${roomCode}')" disabled>
              📋 완료됨
            </button>`
          }
          <button class="btn btn-outline btn-sm" onclick="copyRoomCode('${roomCode}')">
            📋 코드복사
          </button>
        </div>
      </div>
    `;
  }).join('') : `
    <div class="empty-rooms">
      <div class="empty-state-icon">🏠</div>
      <div class="empty-state-title">활성 훈련실이 없습니다</div>
      <div class="empty-state-description">
        현재 진행 중인 그룹 훈련이 없습니다.<br>
        새로운 훈련방을 생성하거나 잠시 후 다시 확인해보세요.
      </div>
    </div>
  `;
  
  const modalHtml = `
    <div id="activeRoomsModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>🏠 활성 훈련실 (${rooms.length}개)</h3>
          <div class="modal-header-actions">
            <button class="btn btn-sm btn-outline" onclick="refreshActiveRooms()">
              🔄 새로고침
            </button>
            <button class="modal-close" onclick="closeActiveRoomsModal()">✖</button>
          </div>
        </div>
        
        <div class="modal-body">
          <div class="rooms-list">
            ${roomsHtml}
          </div>
        </div>
        
        <div class="modal-footer">
          <p class="text-muted">
            💡 팁: 훈련 중인 방은 모니터링할 수 있고, 대기 중인 방은 참가할 수 있습니다
          </p>
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

/**
 * 활성 훈련실 새로고침
 */
function refreshActiveRooms() {
  console.log('🔄 활성 훈련실 새로고침');
  closeActiveRoomsModal();
  setTimeout(() => {
    showActiveRooms();
  }, 300);
}

/**
 * 방 코드 복사
 */
function copyRoomCode(roomCode) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomCode).then(() => {
      showToast(`방 코드 "${roomCode}"가 복사되었습니다!`, 'success');
    }).catch(() => {
      fallbackCopyRoomCode(roomCode);
    });
  } else {
    fallbackCopyRoomCode(roomCode);
  }
}

/**
 * 방 코드 복사 대체 방법
 */
function fallbackCopyRoomCode(roomCode) {
  const textArea = document.createElement('textarea');
  textArea.value = roomCode;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showToast(`방 코드 "${roomCode}"가 복사되었습니다!`, 'success');
  } catch (err) {
    showToast(`복사 실패. 방 코드: ${roomCode}`, 'error');
  }
  
  document.body.removeChild(textArea);
}

/**
 * 빠른 방 참가 (UI 전환용)
 */
function navigateToJoinRoom(roomCode) {
  if (!roomCode) {
    showToast('유효하지 않은 방 코드입니다', 'error');
    return;
  }
  
  console.log(`🚀 방 참가 화면으로 이동: ${roomCode}`);
  
  // 활성 훈련실 모달 닫기
  closeActiveRoomsModal();
  
  // 그룹 훈련 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('groupRoomScreen');
    
    // 참가자 역할 선택 및 방 코드 입력
    setTimeout(() => {
      if (typeof selectRole === 'function') {
        selectRole('participant');
      }
      
      // 방 코드 자동 입력
      setTimeout(() => {
        const roomCodeInput = document.getElementById('roomCodeInput');
        if (roomCodeInput) {
          roomCodeInput.value = roomCode;
          roomCodeInput.focus();
        }
      }, 500);
    }, 300);
  }
  
  showToast(`방 ${roomCode} 참가 화면으로 이동합니다`, 'info');
}

// ========== 빠른 방 참가 (실제 API 호출) ==========
async function quickJoinRoom(roomCode) {
  const currentUser = window.currentUser;
  
  if (!currentUser) {
    showToast('로그인이 필요합니다', 'error');
    return;
  }
  
  if (!roomCode) {
    showToast('방 코드가 필요합니다', 'error');
    return;
  }
  
  const normalizedRoomCode = String(roomCode).toUpperCase().trim();
  
  if (normalizedRoomCode.length !== 6) {
    showToast('방 코드는 6자리여야 합니다', 'error');
    return;
  }
  
  try {
    console.log('🚀 quickJoinRoom 호출:', normalizedRoomCode);
    
    // groupTrainingManager.js의 joinRoomByCode 함수 사용
    if (typeof joinRoomByCode === 'function') {
      console.log('✅ joinRoomByCode 함수 사용');
      await joinRoomByCode(normalizedRoomCode);
      return;
    }
    
    // 대체 방법: 직접 API 호출
    console.log('⚠️ 직접 API 호출 (fallback)');
    if (typeof showLoading === 'function') {
      showLoading('훈련실에 참가하는 중...');
    }
    
    if (typeof jsonpRequest === 'function' && window.GAS_URL) {
      const joinResult = await jsonpRequest(window.GAS_URL, {
        action: 'joinRoom',
        roomCode: normalizedRoomCode,
        participantId: String(currentUser.id),
        participantName: String(currentUser.name || '참가자')
      });
      
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      
      if (joinResult?.success) {
        // 그룹 훈련 상태 업데이트
        if (window.groupTrainingState) {
          window.groupTrainingState.roomCode = normalizedRoomCode;
          window.groupTrainingState.isAdmin = false;
        }
        
        // 모달 닫기
        if (typeof closeActiveRoomsModal === 'function') {
          closeActiveRoomsModal();
        }
        if (typeof closeGroupTrainingModal === 'function') {
          closeGroupTrainingModal();
        }
        
        // 화면 전환
        if (typeof showScreen === 'function') {
          showScreen('groupWaitingScreen');
        }
        
        if (typeof initializeWaitingRoom === 'function') {
          initializeWaitingRoom();
        }
        
        showToast('방에 참가했습니다!', 'success');
      } else {
        throw new Error(joinResult?.error || '방 참가에 실패했습니다');
      }
    } else {
      throw new Error('그룹 훈련 참가 기능을 사용할 수 없습니다.');
    }
    
  } catch (error) {
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    console.error('❌ 훈련실 참가 오류:', error);
    console.error('오류 스택:', error.stack);
    
    let errorMessage = '훈련실 참가에 실패했습니다';
    if (error.message) {
      errorMessage += ': ' + error.message;
    }
    
    showToast(errorMessage, 'error');
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

// ===== 안전 UI 프록시 (비재귀) =====
(function patchUiProxies(){
  if (window.__uiProxyPatched) return;
  window.__uiProxyPatched = true;

  // 기존 전역 레퍼런스 "사본"을 먼저 캡처
  const _origShowLoading = typeof window.showLoading === 'function' ? window.showLoading : null;
  const _origHideLoading  = typeof window.hideLoading  === 'function' ? window.hideLoading  : null;
  const _origShowToast    = typeof window.showToast    === 'function' ? window.showToast    : null;

  // 전역 함수 덮어쓰기: 캡처한 "원본"으로만 호출 (자기 자신 방지)
  window.showLoading = function(message) {
    if (_origShowLoading && _origShowLoading !== window.showLoading) {
      return _origShowLoading(message);
    }
    console.log('Loading:', message ?? '');
  };

  window.hideLoading = function() {
    if (_origHideLoading && _origHideLoading !== window.hideLoading) {
      return _origHideLoading();
    }
    // no-op
  };

  window.showToast = function(message) {
    if (_origShowToast && _origShowToast !== window.showToast) {
      return _origShowToast(message);
    }
    try {
      // UI 토스트가 전혀 없다면 브라우저 alert로 폴백
      alert(String(message ?? ''));
    } catch {
      console.error('[Toast]', message);
    }
  };
})();


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

// ✅ 파일 끝 마크 및 안전한 종료
console.log('✅ training.js 그룹 훈련 모듈 로딩 완료');

(function endGuard(){
  // ✅ 그룹 훈련 시스템 상태 확인
  if (typeof window !== 'undefined') {
    window.GROUP_TRAINING_LOADED = true;
    console.log('🏆 GROUP_TRAINING_LOADED 플래그 설정 완료');
  }

  // ✅ 모듈 안전성 검증
  try {
    if (typeof initGroupTraining === 'function') {
      console.log('그룹 훈련 시스템 함수 검증 완료');
    }
  } catch (e) {
    console.warn('그룹 훈련 함수 검증 중 경고:', e);
  }

  console.log('training.js 로딩 완료');
})(); // ← 파일 말미 구문 안정화




// ========== 관리자 기능 표시 및 관리 ==========

/**
 * 훈련 준비 화면 로드 시 관리자 권한 확인
 */
function checkAndShowAdminFeatures() {
  // 1. Firebase 인증 상태 먼저 확인 (전화번호 로그인은 authV9 사용)
  const auth = window.authV9 || window.auth;
  const firebaseUser = auth?.currentUser;
  
  if (!firebaseUser) {
    // 로그인하지 않았으면 관리자 기능 숨김
    console.log('로그인하지 않았습니다. 관리자 기능을 숨깁니다.');
    hideAdminFeatures();
    return;
  }
  
  // 2. 사용자 정보 확인
  const currentUser = window.currentUser;
  if (!currentUser) {
    console.log('사용자 정보가 없습니다');
    hideAdminFeatures();
    return;
  }
  
  // 3. Firebase 인증 사용자와 현재 사용자 정보가 일치하는지 확인
  // 전화번호 로그인인 경우 이메일에서 전화번호 추출하여 비교
  const isPhoneLogin = firebaseUser.email && firebaseUser.email.endsWith('@stelvio.ai');
  let userMatches = false;
  
  if (isPhoneLogin) {
    // 전화번호 로그인: 이메일에서 전화번호 추출, 숫자만 정규화하여 비교
    const rawFromEmail = (firebaseUser.email || '').replace('@stelvio.ai', '').trim();
    const phoneFromEmail = rawFromEmail.replace(/\D/g, '');
    const userPhone = (currentUser.contact || '').toString().trim().replace(/\D/g, '');
    userMatches = phoneFromEmail.length > 0 && userPhone.length > 0 && phoneFromEmail === userPhone;
    if (!userMatches) {
      console.log('Firebase 인증 사용자와 현재 사용자 정보가 일치하지 않습니다.', {
        email: firebaseUser.email,
        phoneFromEmail,
        userPhone,
        contact: currentUser.contact,
        userName: currentUser.name
      });
    }
  } else {
    // 일반 로그인 (Google 등): UID 비교
    userMatches = firebaseUser.uid === currentUser.id;
  }
  
  if (!userMatches) {
    if (!isPhoneLogin) {
      console.log('Firebase 인증 사용자와 현재 사용자 정보가 일치하지 않습니다.');
    }
    hideAdminFeatures();
    return;
  }
  
  // 4. 관리자 권한 확인
  const isAdmin = currentUser.grade === '1' || currentUser.grade === 1;
  console.log('관리자 권한 확인:', { 
    userId: currentUser.id, 
    grade: currentUser.grade, 
    isAdmin,
    authenticated: true,
    userMatches: true
  });
  
  if (isAdmin) {
    showAdminFeatures();
  } else {
    hideAdminFeatures();
  }
}

/**
 * 관리자 기능 표시
 */
function showAdminFeatures() {
  console.log('관리자 기능을 표시합니다');
  
  // 관리자 전용 섹션 표시
  const adminSection = document.getElementById('adminFunctionsSection');
  if (adminSection) {
    adminSection.style.display = 'block';
  }
  
  // 그룹 훈련 카드 내 관리자 버튼 표시
  const adminGroupButtons = document.getElementById('adminGroupButtons');
  if (adminGroupButtons) {
    adminGroupButtons.style.display = 'block';
  }
  
  // 관리자 배지 추가
  addAdminBadgeToHeader();
  
  if (typeof toast === 'function') {
    toast('관리자 기능이 활성화되었습니다 👑');
  }
}

/**
 * 관리자 기능 숨김
 */
function hideAdminFeatures() {
  console.log('관리자 기능을 숨깁니다');
  
  // 관리자 전용 섹션 숨김
  const adminSection = document.getElementById('adminFunctionsSection');
  if (adminSection) {
    adminSection.style.display = 'none';
  }
  
  // 그룹 훈련 카드 내 관리자 버튼 숨김
  const adminGroupButtons = document.getElementById('adminGroupButtons');
  if (adminGroupButtons) {
    adminGroupButtons.style.display = 'none';
  }
  
  // 관리자 배지 제거
  removeAdminBadgeFromHeader();
}

/**
 * 헤더에 관리자 배지 추가
 */
function addAdminBadgeToHeader() {
  const header = document.querySelector('#trainingReadyScreen .header h1');
  if (header && !header.querySelector('.admin-badge')) {
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    badge.textContent = 'ADMIN';
    header.appendChild(badge);
  }
}

/**
 * 헤더에서 관리자 배지 제거
 */
function removeAdminBadgeFromHeader() {
  const badge = document.querySelector('#trainingReadyScreen .admin-badge');
  if (badge) {
    badge.remove();
  }
}

/**
 * 빠른 훈련실 생성 (관리자 전용)
 */
async function quickCreateRoom() {
  const currentUser = window.currentUser;
  const selectedWorkout = window.selectedWorkout;
  
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    if (typeof toast === 'function') toast('관리자 권한이 필요합니다');
    return;
  }
  
  if (!selectedWorkout) {
    if (typeof toast === 'function') toast('먼저 워크아웃을 선택해주세요');
    return;
  }
  
  const confirmed = confirm(`현재 선택된 워크아웃 "${selectedWorkout.title}"으로 훈련실을 즉시 생성하시겠습니까?`);
  if (!confirmed) return;
  
  try {
    if (typeof loading === 'function') loading('훈련실을 생성하는 중...');
    
    const q = new URLSearchParams({
      action: 'createTrainingRoom',
      hostId: currentUser.id,
      hostName: currentUser.name,
      workoutId: selectedWorkout.id,
      workoutTitle: selectedWorkout.title,
      maxParticipants: '20',
      status: 'waiting',
      quickCreate: 'true'
    });
    
    const response = await fetch(`${window.GAS_URL}?${q.toString()}`);
    const result = await response.json();
    
    if (result.success) {
      GROUP_TRAINING.roomId = result.roomId;
      GROUP_TRAINING.isHost = true;
      GROUP_TRAINING.isGroupMode = true;
      
      if (typeof hide === 'function') hide();
      if (typeof toast === 'function') toast('훈련실이 생성되었습니다! 🎉');
      
      setTimeout(() => {
        if (typeof showTrainingRoom === 'function') {
          showTrainingRoom();
        }
      }, 1000);
      
    } else {
      throw new Error(result.error || '훈련실 생성에 실패했습니다');
    }
    
  } catch (error) {
    if (typeof hide === 'function') hide();
    console.error('빠른 훈련실 생성 오류:', error);
    if (typeof toast === 'function') toast('훈련실 생성에 실패했습니다: ' + error.message);
  }
}

// ========== 화면 전환 감지 ==========

/**
 * 훈련 준비 화면이 표시될 때 관리자 기능 확인
 */
function onTrainingReadyScreenShow() {
  console.log('훈련 준비 화면 표시됨');
  setTimeout(() => {
    checkAndShowAdminFeatures();
  }, 100);
}

// 기존 showScreen 함수 확장
const originalShowScreen = window.showScreen;
if (typeof originalShowScreen === 'function') {
  window.showScreen = function(screenId) {
    const result = originalShowScreen.apply(this, arguments);
    
    if (screenId === 'trainingReadyScreen') {
      onTrainingReadyScreenShow();
    }
    
    return result;
  };
}

// ========== 전역 함수 등록 ==========
window.checkAndShowAdminFeatures = checkAndShowAdminFeatures;
window.showAdminFeatures = showAdminFeatures;
window.hideAdminFeatures = hideAdminFeatures;
window.quickCreateRoom = quickCreateRoom;
window.onTrainingReadyScreenShow = onTrainingReadyScreenShow;

// ========== 자동 초기화 ==========
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkAndShowAdminFeatures, 500);
});

// 사용자 정보 변경 감지
let lastUserId = null;
setInterval(() => {
  const currentUser = window.currentUser;
  const currentUserId = currentUser ? currentUser.id : null;
  
  if (lastUserId !== currentUserId) {
    lastUserId = currentUserId;
    checkAndShowAdminFeatures();
  }
}, 2000);

console.log('✅ 관리자 기능 모듈 추가 완료');



// ========== 관리자 화면 전환 함수들 ==========

/**
 * 훈련실 관리 화면으로 이동
 */
// ========== 수정된 관리자 화면 전환 함수 (빈 화면 문제 해결) ==========

/**
 * 훈련실 관리 화면으로 이동 (개선된 버전)
 */
function showTrainingRoomManagement() {
  const currentUser = window.currentUser;
  
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    if (typeof toast === 'function') {
      toast('관리자 권한이 필요합니다');
    } else {
      alert('관리자 권한이 필요합니다');
    }
    return;
  }
  
  console.log('🏠 훈련실 관리 화면으로 이동');
  
  // 1단계: 그룹 룸 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('groupRoomScreen');
  } else {
    // showScreen 함수가 없는 경우 직접 화면 전환
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    const groupRoomScreen = document.getElementById('groupRoomScreen');
    if (groupRoomScreen) {
      groupRoomScreen.classList.add('active');
    }
  }
  
  // 2단계: 관리자 UI 설정 (약간의 지연을 둬서 DOM이 준비되도록)
  setTimeout(async () => {
    await setupManagerMode();
  }, 150);
}

/**
 * 관리자 모드 UI 설정
 */
async function setupManagerMode() {
  console.log('🔧 관리자 모드 UI 설정 중...');
  
  // 1. 관리자 역할 버튼 표시 및 활성화
  const managerBtn = document.getElementById('managerRoleBtn');
  if (managerBtn) {
    managerBtn.classList.remove('hidden');
    managerBtn.classList.add('active');
    console.log('✅ 관리자 버튼 활성화');
  }
  
  // 2. 다른 역할 버튼들 비활성화
  const adminBtn = document.getElementById('adminRoleBtn');
  const participantBtn = document.getElementById('participantRoleBtn');
  if (adminBtn) adminBtn.classList.remove('active');
  if (participantBtn) participantBtn.classList.remove('active');
  
  // 3. 모든 섹션 숨김
  const sections = ['adminSection', 'participantSection', 'managerSection'];
  sections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.add('hidden');
    }
  });
  
  // 4. 관리자 섹션 표시
  // 4. 관리자 섹션 표시
  // 4. 관리자 섹션 표시
  const managerSection = document.getElementById('managerSection');
  if (managerSection) {
    managerSection.classList.remove('hidden');
    console.log('✅ 관리자 섹션 표시');
    
    // 워크아웃 리스트 로드
    await loadWorkoutOptions();
  } else {
    console.error('❌ managerSection을 찾을 수 없습니다 - 대신 adminSection을 사용합니다');
    
    // adminSection을 대안으로 사용
    const adminSection = document.getElementById('adminSection');
    if (adminSection) {
      adminSection.classList.remove('hidden');
      console.log('✅ adminSection 표시 (대안)');
      
      // 워크아웃 리스트 로드
      await loadWorkoutOptions();
    }
  }
  
  
  // 5. 관리자 데이터 로드
  await loadManagerData();
  
  // 6. 사용자 알림
  if (typeof toast === 'function') {
    toast('훈련실 관리 화면으로 이동했습니다 🏠');
  }
}



/**
 * 관리자 데이터 로드
 */
async function loadManagerData() {
  console.log('📊 관리자 데이터 로딩 중...');
  
  try {
    // 활성 훈련실 목록 새로고침
    if (typeof refreshActiveRooms === 'function') {
      await refreshActiveRooms();
    } else {
      await loadActiveRoomsList();
    }
    
    // 훈련방 통계 로드
    await loadRoomStatistics();
    
    console.log('✅ 관리자 데이터 로딩 완료');
    
  } catch (error) {
    console.error('❌ 관리자 데이터 로딩 오류:', error);
  }
}








/**
 * 기본 워크아웃 데이터 반환
 */
function getDefaultWorkouts() {
  return [
    {
      id: 'basic-endurance',
      name: '기본 지구력 훈련',
      duration: 60,
      description: '중강도 지구력 향상을 위한 기본 훈련'
    },
    {
      id: 'interval-training',
      name: '인터벌 훈련',
      duration: 45,
      description: '고강도 인터벌 훈련으로 심폐 능력 향상'
    },
    {
      id: 'recovery-ride',
      name: '회복 라이딩',
      duration: 30,
      description: '저강도 회복 라이딩'
    },
    {
      id: 'tempo-training',
      name: '템포 훈련',
      duration: 50,
      description: '중고강도 템포 훈련'
    },
    {
      id: 'hill-climbing',
      name: '언덕 오르기',
      duration: 40,
      description: '언덕 오르기 시뮬레이션 훈련'
    }
  ];
}

/**
 * 워크아웃 옵션 로드 (개선된 버전)
 */
/**
 * 대체 워크아웃 로딩 함수 (함수 외부로 이동)
 */
async function tryAlternativeWorkoutLoading() {
  try {
    console.log('📋 등록된 워크아웃 데이터를 로드합니다...');
    if (typeof listWorkouts === 'function') {
      const registeredWorkouts = await Promise.resolve(listWorkouts());
      if (registeredWorkouts && registeredWorkouts.length > 0) {
        return registeredWorkouts.map(workout => ({
          id: workout.id || workout.title || workout.name,
          name: workout.title || workout.name,
          duration: workout.duration || workout.estimatedDuration || 60,
          description: workout.description || workout.summary || ''
        }));
      }
    }
    
    console.warn('등록된 워크아웃이 없습니다. 기본 워크아웃을 사용합니다.');
    return getDefaultWorkouts();
  } catch (error) {
    console.error('등록된 워크아웃 로드 실패:', error);
    console.log('🔄 기본 워크아웃으로 대체합니다.');
    return getDefaultWorkouts();
  }
}

/**
 * 워크아웃 옵션 로드 (개선된 버전 - 구문 오류 수정)
 */
/**
 * 워크아웃 옵션 로드 (개선된 버전 - 오류 수정)
 */
async function loadWorkoutOptions() {
  console.log('📋 워크아웃 옵션 로딩 중...');
  
  // 여러 가능한 워크아웃 선택 요소 확인
  const possibleSelectors = ['roomWorkoutSelect', 'workoutSelect', 'adminWorkoutSelect'];
  let workoutSelect = null;
  
  for (const selector of possibleSelectors) {
    workoutSelect = document.getElementById(selector);
    if (workoutSelect) {
      console.log(`워크아웃 선택 요소 발견: ${selector}`);
      break;
    }
  }
  
  if (!workoutSelect) {
    console.warn('워크아웃 선택 요소를 찾을 수 없습니다. DOM 생성 후 재시도');
    
    // 0.5초 후 재시도
    setTimeout(() => {
      loadWorkoutOptions();
    }, 500);
    return;
  }
  
  try {
    // 기존 옵션 제거 (기본 옵션 제외)
    workoutSelect.innerHTML = '<option value="">워크아웃 로딩 중...</option>';
    
    let workouts = [];
    
    // 1순위: API를 통한 워크아웃 조회
    try {
      if (typeof apiGetWorkouts === 'function') {
        console.log('API를 통한 워크아웃 조회 시도');
        const result = await apiGetWorkouts();
        
        if (result && result.success) {
          // 다양한 응답 구조 지원
          const apiWorkouts = result.items || result.workouts || result.data || [];
          
          if (Array.isArray(apiWorkouts) && apiWorkouts.length > 0) {
            workouts = apiWorkouts;
            console.log(`API를 통한 워크아웃 조회 성공: ${workouts.length}개`);
          }
        }
      }
    } catch (apiError) {
      console.warn('API 워크아웃 조회 실패:', apiError);
    }
    
    // 2순위: 전역 워크아웃 데이터 사용
    if (workouts.length === 0) {
      if (window.workoutData && Array.isArray(window.workoutData) && window.workoutData.length > 0) {
        workouts = window.workoutData;
        console.log(`전역 워크아웃 데이터 사용: ${workouts.length}개`);
      }
    }
    
    // 3순위: 기본 워크아웃 사용
    if (workouts.length === 0) {
      workouts = getDefaultWorkouts();
      console.log(`기본 워크아웃 사용: ${workouts.length}개`);
    }
    
    // 워크아웃 옵션 생성
    const options = [`<option value="">워크아웃을 선택하세요</option>`];
    
    workouts.forEach(workout => {
      const id = workout.id || workout.workoutId || workout.key;
      const name = workout.name || workout.title || workout.workoutName || `워크아웃 ${id}`;
      options.push(`<option value="${id}">${escapeHtml(name)}</option>`);
    });
    
    workoutSelect.innerHTML = options.join('');
    
    console.log(`✅ ${workouts.length}개 워크아웃 옵션 로드 완료`);
    
  } catch (error) {
    console.error('워크아웃 옵션 로드 실패:', error);
    
    // 최종 대체: 기본 워크아웃 로드
    try {
      const defaults = getDefaultWorkouts();
      const fallbackOptions = [`<option value="">워크아웃을 선택하세요</option>`];
      
      defaults.forEach(workout => {
        fallbackOptions.push(`<option value="${workout.id}">${escapeHtml(workout.name)}</option>`);
      });
      
      workoutSelect.innerHTML = fallbackOptions.join('');
      console.log(`기본 워크아웃으로 복구: ${defaults.length}개`);
    } catch (fallbackError) {
      console.error('기본 워크아웃 로드도 실패:', fallbackError);
      workoutSelect.innerHTML = '<option value="">워크아웃을 사용할 수 없습니다</option>';
    }
  }
}

/**
 * 활성 훈련실 목록 로드 (대체 함수)
 */






/**
 * 활성 훈련실 목록 로드 (대체 함수)
 */
async function loadActiveRoomsList() {
  const activeRoomsList = document.getElementById('activeRoomsList');
  if (!activeRoomsList) return;
  
  try {
    // 로딩 표시
    activeRoomsList.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>활성 훈련방을 불러오는 중...</p>
      </div>
    `;
    
    // 서버에서 활성 방 목록 가져오기
    const response = await fetch(`${window.GAS_URL}?action=getActiveRooms`);
    const result = await response.json();
    
    if (result.success && result.rooms) {
      displayActiveRooms(result.rooms);
    } else {
      activeRoomsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          <div class="empty-state-title">활성 훈련방이 없습니다</div>
          <div class="empty-state-description">현재 진행 중인 훈련방이 없습니다</div>
        </div>
      `;
    }
    
  } catch (error) {
    console.error('활성 훈련실 목록 로드 오류:', error);
    activeRoomsList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">❌</div>
        <div class="error-state-title">로딩 실패</div>
        <div class="error-state-description">활성 훈련방 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="loadActiveRoomsList().catch(console.error)">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 활성 훈련실 표시
 */
function displayActiveRooms(rooms) {
  const activeRoomsList = document.getElementById('activeRoomsList');
  if (!activeRoomsList) return;
  
  if (!rooms || rooms.length === 0) {
    activeRoomsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏠</div>
        <div class="empty-state-title">활성 훈련방이 없습니다</div>
        <div class="empty-state-description">현재 진행 중인 훈련방이 없습니다</div>
      </div>
    `;
    return;
  }
  
  const roomsHtml = rooms.map(room => `
    <div class="active-room-card">
      <div class="room-header">
        <div class="room-title">
          <strong>${escapeHtml(room.name || `방 ${room.id}`)}</strong>
          <span class="room-status ${room.status}">${getStatusText(room.status)}</span>
        </div>
        <div class="room-code">코드: ${room.code || room.id}</div>
      </div>
      
      <div class="room-details">
        <div class="room-info">
          <span>호스트: ${escapeHtml(room.hostName || '알 수 없음')}</span>
          <span>참가자: ${room.participantCount || 0}/${room.maxParticipants || 4}명</span>
        </div>
        <div class="room-workout">
          워크아웃: ${escapeHtml(room.workoutTitle || '선택 안됨')}
        </div>
      </div>
      
      <div class="room-actions">
        <button class="btn btn-sm btn-outline" onclick="viewRoomDetails('${room.id}')">
          👀 상세보기
        </button>
        <button class="btn btn-sm btn-warning" onclick="manageRoom('${room.id}')">
          ⚙️ 관리
        </button>
        <button class="btn btn-sm btn-danger" onclick="closeRoom('${room.id}')">
          🚪 종료
        </button>
      </div>
    </div>
  `).join('');
  
  activeRoomsList.innerHTML = roomsHtml;
}

/**
 * 상태 텍스트 변환
 */
function getStatusText(status) {
  switch (status) {
    case 'waiting': return '대기중';
    case 'starting': return '시작중';
    case 'training': return '훈련중';
    case 'finished': return '종료됨';
    default: return '알 수 없음';
  }
}

/**
 * 훈련방 통계 로드 (개선된 버전)
 */
async function loadRoomStatistics() {
  try {
    const response = await fetch(`${window.GAS_URL}?action=getRoomStatistics`);
    const result = await response.json();
    
    if (result.success && result.stats) {
      const stats = result.stats;
      
      // 통계 업데이트
      const statsElements = {
        'totalRoomsCount': stats.totalRooms || 0,
        'activeRoomsCount': stats.activeRooms || 0,
        'totalParticipantsCount': stats.totalParticipants || 0,
        'trainingRoomsCount': stats.trainingRooms || 0
      };
      
      Object.entries(statsElements).forEach(([elementId, value]) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.textContent = value;
          // 애니메이션 효과 추가
          element.style.transform = 'scale(1.1)';
          setTimeout(() => {
            element.style.transform = 'scale(1)';
          }, 200);
        }
      });
      
      console.log('✅ 훈련방 통계 업데이트 완료:', stats);
    } else {
      console.warn('⚠️ 훈련방 통계를 가져올 수 없습니다');
    }
  } catch (error) {
    console.error('❌ 훈련방 통계 로드 오류:', error);
    // 기본값으로 설정
    ['totalRoomsCount', 'activeRoomsCount', 'totalParticipantsCount', 'trainingRoomsCount'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '-';
    });
  }
}

/**
 * 문자열 이스케이프 (보안)
 */
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ========== 전역 함수 등록 ==========
// ========== 전역 함수 등록 ==========
window.showTrainingRoomManagement = showTrainingRoomManagement;
window.setupManagerMode = setupManagerMode;
window.loadManagerData = loadManagerData;
window.loadActiveRoomsList = loadActiveRoomsList;
window.displayActiveRooms = displayActiveRooms;
window.getStatusText = getStatusText;
window.loadRoomStatistics = loadRoomStatistics;
window.loadWorkoutOptions = loadWorkoutOptions;
window.getDefaultWorkouts = getDefaultWorkouts;

// 안전한 함수 등록 확인
const registeredFunctions = [
  'showTrainingRoomManagement', 'setupManagerMode', 'loadManagerData',
  'loadActiveRoomsList', 'displayActiveRooms', 'getStatusText', 
  'loadRoomStatistics', 'loadWorkoutOptions', 'getDefaultWorkouts'
];

registeredFunctions.forEach(funcName => {
  if (typeof window[funcName] !== 'function') {
    console.warn(`⚠️ ${funcName} 함수가 제대로 등록되지 않았습니다`);
  }
});

console.log('✅ 관리자 화면 및 워크아웃 관련 함수들이 등록되었습니다');



(function attachGroupTrainingHooks() {
  const hooks = window.groupTrainingHooks = window.groupTrainingHooks || {};

  if (typeof hooks.beginSession !== 'function') {
    hooks.beginSession = function beginGroupSession(roomInfo = {}) {
      const snapshot = {
        ...roomInfo,
        code: roomInfo.code || roomInfo.roomCode,
        isAdmin: !!roomInfo.isAdmin
      };

      window.groupTrainingRoom = snapshot;
      window.isGroupTraining = true;
      window.groupTrainingRole = snapshot.isAdmin ? 'admin' : 'participant';

      if (!window.__groupTrainingSessionActive) {
        window.__groupTrainingSessionActive = true;

        if (typeof showScreen === 'function') {
          showScreen('trainingScreen');
        }

        try {
          const userId =
            window.currentUser?.id ||
            (JSON.parse(localStorage.getItem('currentUser') || 'null')?.id) ||
            null;
          const sessionData = window.trainingResults?.getCurrentSessionData?.();
          if (!sessionData?.startTime) {
            window.trainingResults?.startSession?.(userId || undefined, snapshot.name || snapshot.roomName || '');
          }
        } catch (error) {
          console.warn('[groupTrainingHooks] startSession failed:', error);
        }

        if (typeof startWorkoutTraining === 'function') {
          startWorkoutTraining();
        } else if (typeof startWithCountdown === 'function') {
          startWithCountdown(3);
        } else if (typeof startTraining === 'function') {
          startTraining();
        } else {
          console.warn('[groupTrainingHooks] No training starter available');
        }
      }
    };
  }

  if (typeof hooks.updateRoom !== 'function') {
    hooks.updateRoom = function updateGroupRoom(roomInfo = {}) {
      if (!roomInfo) return;
      window.groupTrainingRoom = {
        ...(window.groupTrainingRoom || {}),
        ...roomInfo,
        code: roomInfo.code || roomInfo.roomCode
      };
    };
  }

  if (typeof hooks.endSession !== 'function') {
    hooks.endSession = function endGroupSession() {
      window.__groupTrainingSessionActive = false;
      window.isGroupTraining = false;
      window.groupTrainingRoom = null;
      window.groupTrainingRole = null;
    };
  }
})();



/**
 * 활성 훈련실 모니터링 화면으로 이동
 */
function showActiveRoomsManagement() {
  const currentUser = window.currentUser;
  
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    if (typeof toast === 'function') {
      toast('관리자 권한이 필요합니다');
    } else {
      alert('관리자 권한이 필요합니다');
    }
    return;
  }
  
  console.log('활성 훈련실 모니터링 화면으로 이동');
  
  // 기존 showActiveRooms 함수가 있는지 확인
  if (typeof showActiveRooms === 'function') {
    showActiveRooms();
  } else {
    // showActiveRooms 함수가 없는 경우 관리자 화면으로 이동
    showTrainingRoomManagement();
    
    setTimeout(async () => {
      if (typeof refreshActiveRooms === 'function') {
        await refreshActiveRooms().catch(console.error);
      }
      if (typeof toast === 'function') {
        toast('활성 훈련실을 확인하세요 📊');
      }
    }, 200);
  }
}

/**
 * 관리자 섹션 직접 표시 (selectRole 함수가 없는 경우 대비)
 */
function showManagerSection() {
  console.log('관리자 섹션을 직접 표시합니다');
  
  // 모든 섹션 숨김
  const sections = ['adminSection', 'participantSection', 'managerSection'];
  sections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.add('hidden');
    }
  });
  
  // 역할 버튼들 상태 초기화
  const roleButtons = document.querySelectorAll('.role-btn');
  roleButtons.forEach(btn => btn.classList.remove('active'));
  
  // 관리자 섹션 표시
  const managerSection = document.getElementById('managerSection');
  if (managerSection) {
    managerSection.classList.remove('hidden');
    console.log('관리자 섹션이 표시되었습니다');
  }
  
  // 관리자 역할 버튼 활성화
  const managerBtn = document.getElementById('managerRoleBtn');
  if (managerBtn) {
    managerBtn.classList.add('active');
    managerBtn.classList.remove('hidden'); // 관리자에게 표시
  }
  
  // 활성 훈련실 목록 자동 새로고침
  setTimeout(async () => {
    if (typeof refreshActiveRooms === 'function') {
      await refreshActiveRooms().catch(console.error);
    }
    await loadRoomStatistics().catch(console.error);
  }, 300);
}



// ========== 전역 함수 등록 ==========
// ========== 전역 함수 등록 (중복 제거) ==========
// 이미 위에서 등록된 함수들은 제거하고 새로운 함수만 추가




/**
 * 활성 훈련실 새로고침
 */
async function refreshActiveRooms() {
  console.log('🔄 활성 훈련실 새로고침...');
  
  const activeRoomsList = document.getElementById('activeRoomsList');
  if (!activeRoomsList) return;
  
  try {
    // 로딩 표시
    activeRoomsList.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>훈련실 목록을 새로고침하는 중...</p>
      </div>
    `;
    
    // 실제 API 호출 또는 로컬 저장소에서 데이터 가져오기
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    const roomList = Object.values(rooms).filter(room => room.status !== 'finished');
    
    displayActiveRooms(roomList);
    
    // 통계 업데이트
    updateRoomStatistics(roomList);
    
  } catch (error) {
    console.error('활성 훈련실 새로고침 실패:', error);
    activeRoomsList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">❌</div>
        <div class="error-state-title">새로고침 실패</div>
        <div class="error-state-description">활성 훈련방 목록을 새로고침할 수 없습니다</div>
        <button class="retry-button" onclick="refreshActiveRooms().catch(console.error)">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 훈련실 통계 업데이트
 */
function updateRoomStatistics(rooms) {
  const totalActiveRoomsEl = document.getElementById('totalActiveRooms');
  const totalParticipantsEl = document.getElementById('totalParticipants');
  const averageOccupancyEl = document.getElementById('averageOccupancy');
  
  if (totalActiveRoomsEl) {
    totalActiveRoomsEl.textContent = rooms.length;
  }
  
  if (totalParticipantsEl) {
    const totalParticipants = rooms.reduce((sum, room) => sum + (room.participantCount || 0), 0);
    totalParticipantsEl.textContent = totalParticipants;
  }
  
  if (averageOccupancyEl) {
    const avgOccupancy = rooms.length > 0 
      ? Math.round(rooms.reduce((sum, room) => {
          return sum + ((room.participantCount || 0) / (room.maxParticipants || 4)) * 100;
        }, 0) / rooms.length)
      : 0;
    averageOccupancyEl.textContent = `${avgOccupancy}%`;
  }
}

/**
 * 방 상세보기
 */
function viewRoomDetails(roomId) {
  console.log('방 상세보기:', roomId);
  // TODO: 방 상세 정보 모달 표시
  showToast('방 상세보기 기능 준비 중입니다', 'info');
}

/**
 * 훈련실 통계 표시
 */
function showRoomStatistics() {
  console.log('훈련실 통계 표시');
  // TODO: 상세 통계 모달 표시
  showToast('상세 통계 기능 준비 중입니다', 'info');
}

/**
 * 데이터 내보내기
 */
function exportRoomData() {
  console.log('데이터 내보내기');
  try {
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    const dataStr = JSON.stringify(rooms, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `training-rooms-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    showToast('훈련실 데이터가 내보내졌습니다', 'success');
  } catch (error) {
    console.error('데이터 내보내기 실패:', error);
    showToast('데이터 내보내기에 실패했습니다', 'error');
  }
}

// 전역 함수로 등록
// 전역 함수로 등록
window.refreshActiveRooms = refreshActiveRooms;
window.updateRoomStatistics = updateRoomStatistics;
window.viewRoomDetails = viewRoomDetails;
window.showRoomStatistics = showRoomStatistics;
window.exportRoomData = exportRoomData;

// 모듈 로딩 완료 확인
try {
  console.log('✅ 훈련실 관리 모듈 전역 등록 완료');
  
  // 필수 함수들 등록 확인
  const requiredFunctions = [
    'refreshActiveRooms', 'updateRoomStatistics', 
    'viewRoomDetails', 'showRoomStatistics', 'exportRoomData'
  ];
  
  requiredFunctions.forEach(funcName => {
    if (typeof window[funcName] !== 'function') {
      console.warn(`⚠️ ${funcName} 함수가 제대로 등록되지 않았습니다`);
    }
  });
  
} catch (error) {
  console.error('❌ 모듈 등록 중 오류:', error);
}

