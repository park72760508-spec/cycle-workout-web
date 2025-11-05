/* ==========================================================
   groupTrainingManager.js - 그룹 훈련 전용 관리 모듈
   기존 모듈들과 일관성을 유지하면서 그룹 훈련 기능 구현
========================================================== */

// ========== 전역 변수 초기화 ==========
window.groupTrainingManager = window.groupTrainingManager || {};


// 그룹 훈련 상태 관리
let groupTrainingState = {
  currentRoom: null,
  isAdmin: false,
  isManager: false,        // 🆕 추가
  participants: [],
  roomCode: null,
  syncInterval: null,
  managerInterval: null,   // 🆕 추가
  isConnected: false,
  lastSyncTime: null
};



// 마이크 상태 관리
let microphoneState = {
  isActive: false,
  mediaStream: null,
  audioContext: null,
  analyser: null
};

// ========== 기본 유틸리티 함수들 ==========

/**
 * 안전한 요소 접근
 */
function safeGet(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`Element not found: ${id}`);
  }
  return element;
}

/**
 * 토스트 메시지 표시
 */
function showToast(message, type = 'info') {
  const toast = safeGet('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * 6자리 랜덤 방 코드 생성
 */
function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

/**
 * 현재 시간 문자열 생성
 */
function getCurrentTimeString() {
  return new Date().toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ========== 화면 전환 함수들 ==========

/**
 * 훈련 방식 선택 (기존 ready 화면에서 호출)
 */
function selectTrainingMode(mode) {
  console.log('Training mode selected:', mode);
  
  if (mode === 'individual') {
    // 기존 개인 훈련 시작 로직
    if (typeof startTraining === 'function') {
      startTraining();
    } else {
      console.warn('startTraining function not found');
      showToast('개인 훈련 기능을 찾을 수 없습니다', 'error');
    }
  } else if (mode === 'group') {
    // 그룹 훈련 화면으로 이동
    showScreen('trainingModeScreen');
  }
}

/**
 * 그룹 훈련 모드 선택 (신규 화면에서)
 */
function selectGroupMode(mode) {
  console.log('Group mode selected:', mode);
  
  if (mode === 'individual') {
    // 다시 개인 훈련으로
    showScreen('trainingReadyScreen');
    selectTrainingMode('individual');
  } else if (mode === 'group') {
    // 그룹 훈련 방 화면으로
    showScreen('groupRoomScreen');
    initializeGroupRoomScreen();
  }
}

/**
 * 역할 선택 (관리자/참가자)
 */
function selectRole(role) {
  console.log('Role selected:', role);
  
  const adminBtn = safeGet('adminRoleBtn');
  const participantBtn = safeGet('participantRoleBtn');
  // managerRoleBtn은 선택사항이므로 경고 없이 처리
  const managerBtn = document.getElementById('managerRoleBtn'); // safeGet 대신 직접 접근
  const adminSection = safeGet('adminSection');
  const participantSection = safeGet('participantSection');
  const managerSection = safeGet('managerSection');
  
  if (!adminBtn || !participantBtn) {
    console.error('Role UI elements not found');
    return;
  }
  
  // 모든 버튼 비활성화
  adminBtn.classList.remove('active');
  participantBtn.classList.remove('active');
  if (managerBtn) managerBtn.classList.remove('active');
  
  // 모든 섹션 숨김
  if (adminSection) adminSection.classList.add('hidden');
  if (participantSection) participantSection.classList.add('hidden');
  if (managerSection) managerSection.classList.add('hidden');
  
  // 선택된 역할에 따라 활성화
  if (role === 'admin') {
    adminBtn.classList.add('active');
    if (adminSection) adminSection.classList.remove('hidden');
    groupTrainingState.isAdmin = true;
    groupTrainingState.isManager = false;
    await loadWorkoutsForRoom();
  } else if (role === 'participant') {
    participantBtn.classList.add('active');
    if (participantSection) participantSection.classList.remove('hidden');
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    refreshRoomList();
   } else if (role === 'manager') {
     console.log('🔧 Manager role selected');
     if (managerBtn) managerBtn.classList.add('active');
     if (managerSection) managerSection.classList.remove('hidden');
     groupTrainingState.isAdmin = false;
     groupTrainingState.isManager = true;
     
     // initializeManagerDashboard 함수가 정의되어 있는지 확인
     if (typeof initializeManagerDashboard === 'function') {
       initializeManagerDashboard();
     } else {
       console.error('❌ initializeManagerDashboard function not found');
     }
   }
}

// ========== 관리자 기능들 ==========

/**
 * 워크아웃 목록 로드 (방 생성용)
 */
async function loadWorkoutsForRoom() {
  const select = safeGet('roomWorkoutSelect');
  if (!select) return;
  
  try {
    // training.js의 loadWorkoutOptions 함수 사용
    if (typeof loadWorkoutOptions === 'function') {
      await loadWorkoutOptions();
      console.log('✅ 워크아웃 옵션이 로드되었습니다');
    } else if (typeof listWorkouts === 'function') {
      // 대안: 기존 워크아웃 목록 사용
      listWorkouts().then(workouts => {
        select.innerHTML = '<option value="">워크아웃 선택...</option>';
        workouts.forEach(workout => {
          const option = document.createElement('option');
          option.value = workout.id;
          option.textContent = `${workout.title} (${workout.duration || '?'}분)`;
          select.appendChild(option);
        });
      }).catch(err => {
        console.error('Failed to load workouts:', err);
        showToast('워크아웃 목록을 불러올 수 없습니다', 'error');
      });
    } else {
      console.warn('워크아웃 로드 함수를 찾을 수 없습니다 - 기본 옵션을 추가합니다');
      // 기본 워크아웃 옵션 추가
      select.innerHTML = `
        <option value="">워크아웃 선택...</option>
        <option value="ftp-test">FTP 테스트 (75분)</option>
        <option value="vo2max">VO2 Max 인터벌 (45분)</option>
        <option value="endurance">지구력 훈련 (90분)</option>
        <option value="threshold">역치 훈련 (60분)</option>
        <option value="recovery">회복 라이드 (30분)</option>
      `;
    }
  } catch (error) {
    console.error('워크아웃 로드 중 오류:', error);
    showToast('워크아웃 목록 로딩 실패', 'error');
  }
}

/**
 * 그룹 훈련방 생성
 */
async function createGroupRoom() {
  const roomName = safeGet('roomNameInput')?.value?.trim();
  const workoutId = safeGet('roomWorkoutSelect')?.value;
  const maxParticipants = parseInt(safeGet('maxParticipants')?.value) || 4;
  
  if (!roomName) {
    showToast('방 이름을 입력해주세요', 'error');
    return;
  }
  
  if (!workoutId) {
    showToast('훈련 종목을 선택해주세요', 'error');
    return;
  }
  
  try {
    showToast('훈련방을 생성 중입니다...', 'info');
    
    const roomCode = generateRoomCode();
      const roomData = {
        code: roomCode,
        name: roomName,
        workoutId: workoutId,
        maxParticipants: maxParticipants,
        adminId: window.currentUser?.id || 'admin',
        adminName: window.currentUser?.name || '관리자',
        status: 'waiting',
        createdAt: new Date().toISOString(),
        participants: [{
          id: window.currentUser?.id || 'admin',
          name: window.currentUser?.name || '관리자',
          role: 'admin',
          ready: true,
          joinedAt: new Date().toISOString()
        }],
        settings: {
          allowSpectators: false,
          autoStart: false,
          voiceChat: true
        }
      };
    
    // 백엔드에 방 생성 요청 (실제 구현 시 API 호출)
    const success = await createRoomOnBackend(roomData);
    
    if (success) {
      groupTrainingState.currentRoom = roomData;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = true;
      
      showToast('훈련방이 생성되었습니다!', 'success');
      showScreen('groupWaitingScreen');
      initializeWaitingRoom();
    } else {
      throw new Error('Failed to create room');
    }
    
  } catch (error) {
    console.error('Error creating room:', error);
    showToast('훈련방 생성에 실패했습니다', 'error');
  }
}

/**
 * 백엔드에 방 생성 (임시 구현)
 */
async function createRoomOnBackend(roomData) {
  try {
    // Google Apps Script API 호출
    const params = new URLSearchParams({
      action: 'createGroupRoom',
      code: encodeURIComponent(roomData.code),
      name: encodeURIComponent(roomData.name),
      workoutId: roomData.workoutId,
      adminId: roomData.adminId,
      adminName: encodeURIComponent(roomData.adminName),
      maxParticipants: roomData.maxParticipants,
      status: roomData.status,
      participants: encodeURIComponent(JSON.stringify(roomData.participants)),
      settings: encodeURIComponent(JSON.stringify(roomData.settings))
    });
    
    const scriptUrl = window.GAS_URL || window.APP_SCRIPT_URL || 'your-gas-deployment-url';
    const response = await fetch(`${scriptUrl}?${params.toString()}`);
    const result = await response.json();
    
    if (result.success) {
      return true;
    } else {
      console.error('Backend error:', result.error);
      return false;
    }
    
  } catch (error) {
    console.error('Failed to create room on backend:', error);
    
    // Fallback: localStorage에 저장
    try {
      const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
      rooms[roomData.code] = roomData;
      localStorage.setItem('groupTrainingRooms', JSON.stringify(rooms));
      return true;
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      return false;
    }
  }
}

// ========== 참가자 기능들 ==========

/**
 * 방 목록 새로고침
 */
async function refreshRoomList() {
  const listContainer = safeGet('availableRoomsList');
  if (!listContainer) return;
  
  try {
    listContainer.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>방 목록을 불러오는 중...</p>
      </div>
    `;
    
    // 백엔드에서 방 목록 가져오기 (임시 구현)
    const rooms = await getRoomsFromBackend();
    
    if (rooms.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          <div class="empty-state-title">참가 가능한 방이 없습니다</div>
          <div class="empty-state-description">관리자가 새로운 훈련방을 생성할 때까지 기다려주세요</div>
        </div>
      `;
      return;
    }
    
    listContainer.innerHTML = rooms.map(room => `
      <div class="room-card" onclick="joinRoomByCode('${room.code}')">
        <div class="room-header">
          <h4>${room.name}</h4>
          <span class="room-code">${room.code}</span>
        </div>
        <div class="room-details">
          <span class="room-workout">📋 ${room.workoutName || '워크아웃'}</span>
          <span class="room-participants">👥 ${room.participants.length}/${room.maxParticipants}</span>
        </div>
        <div class="room-admin">
          <span>관리자: ${room.adminName}</span>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading rooms:', error);
    listContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">방 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="refreshRoomList().catch(console.error)">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 백엔드에서 방 목록 가져오기 (임시 구현)
 */
async function getRoomsFromBackend() {
  try {
    // Google Apps Script API 호출
    const params = new URLSearchParams({
      action: 'listGroupRooms',
      status: 'waiting'
    });
    
    const scriptUrl = window.GAS_URL || window.APP_SCRIPT_URL || 'your-gas-deployment-url';
    const response = await fetch(`${scriptUrl}?${params.toString()}`);
    const result = await response.json();
    
    if (result.success) {
      return result.items.filter(room => 
        room.Status === 'waiting' && 
        (room.ParticipantsData || []).length < room.MaxParticipants
      );
    } else {
      console.error('Backend error:', result.error);
      return [];
    }
    
  } catch (error) {
    console.error('Failed to get rooms from backend:', error);
    
    // Fallback: localStorage에서 조회
    try {
      const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
      return Object.values(rooms).filter(room => 
        room.status === 'waiting' && 
        room.participants.length < room.maxParticipants
      );
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * 방 코드로 참가
 */
async function joinGroupRoom() {
  const roomCode = safeGet('roomCodeInput')?.value?.trim()?.toUpperCase();
  
  if (!roomCode) {
    showToast('방 코드를 입력해주세요', 'error');
    return;
  }
  
  if (roomCode.length !== 6) {
    showToast('방 코드는 6자리여야 합니다', 'error');
    return;
  }
  
  await joinRoomByCode(roomCode);
}

/**
 * 방 코드로 방 참가 실행
 */
async function joinRoomByCode(roomCode) {
  try {
    showToast('방에 참가 중입니다...', 'info');
    
    // 백엔드에서 방 정보 확인
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      showToast('방을 찾을 수 없습니다', 'error');
      return;
    }
    
    if (room.status !== 'waiting') {
      showToast('이미 시작된 방입니다', 'error');
      return;
    }
    
    if (room.participants.length >= room.maxParticipants) {
      showToast('방이 가득 찼습니다', 'error');
      return;
    }
    
    // 방에 참가자 추가
    const participant = {
      id: window.currentUser?.id || 'user_' + Date.now(),
      name: window.currentUser?.name || '참가자',
      role: 'participant',
      ready: false,
      joinedAt: new Date().toISOString()
    };
    
    room.participants.push(participant);
    
    // 백엔드 업데이트
    const success = await updateRoomOnBackend(room);
    
    if (success) {
      groupTrainingState.currentRoom = room;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = false;
      
      showToast('방에 참가했습니다!', 'success');
      showScreen('groupWaitingScreen');
      initializeWaitingRoom();
    } else {
      throw new Error('Failed to join room');
    }
    
  } catch (error) {
    console.error('Error joining room:', error);
    showToast('방 참가에 실패했습니다', 'error');
  }
}

/**
 * 방 코드로 방 정보 가져오기 (임시 구현)
 */
async function getRoomByCode(roomCode) {
  try {
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    return rooms[roomCode] || null;
  } catch (error) {
    console.error('Failed to get room:', error);
    return null;
  }
}

/**
 * 백엔드에 방 정보 업데이트 (임시 구현)
 */
async function updateRoomOnBackend(roomData) {
  try {
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    rooms[roomData.code] = roomData;
    localStorage.setItem('groupTrainingRooms', JSON.stringify(rooms));
    return true;
  } catch (error) {
    console.error('Failed to update room:', error);
    return false;
  }
}

// ========== 대기실 기능들 ==========

/**
 * 대기실 화면 초기화
 */
function initializeWaitingRoom() {
  if (!groupTrainingState.currentRoom) {
    console.error('No current room found');
    return;
  }
  
  const room = groupTrainingState.currentRoom;
  
  // 방 정보 업데이트
  const titleEl = safeGet('waitingRoomTitle');
  const codeEl = safeGet('currentRoomCode');
  const workoutEl = safeGet('currentRoomWorkout');
  
  if (titleEl) titleEl.textContent = `📱 훈련방: ${room.name}`;
  if (codeEl) codeEl.textContent = room.code;
  if (workoutEl) workoutEl.textContent = '로딩 중...';
  
  // 관리자/참가자 컨트롤 표시
  const adminControls = safeGet('adminControls');
  const participantControls = safeGet('participantControls');
  
  if (groupTrainingState.isAdmin) {
    adminControls?.classList.remove('hidden');
    participantControls?.classList.add('hidden');
  } else {
    adminControls?.classList.add('hidden');
    participantControls?.classList.remove('hidden');
  }
  
  // 참가자 목록 업데이트
  updateParticipantsList();
  
  // 실시간 동기화 시작
  startRoomSync();
  
  // 워크아웃 정보 로드
  loadWorkoutInfo(room.workoutId);
}

/**
 * 참가자 목록 업데이트
 */
function updateParticipantsList() {
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
  const countEl = safeGet('participantCount');
  const maxCountEl = safeGet('maxParticipantCount');
  const listEl = safeGet('participantsList');
  
  if (countEl) countEl.textContent = room.participants.length;
  if (maxCountEl) maxCountEl.textContent = room.maxParticipants;
  
  if (listEl) {
    listEl.innerHTML = room.participants.map(p => `
      <div class="participant-card ${p.role}" data-id="${p.id}">
        <div class="participant-info">
          <span class="participant-name">${p.name}</span>
          <span class="participant-role">${p.role === 'admin' ? '🎯 관리자' : '🏃‍♂️ 참가자'}</span>
        </div>
        <div class="participant-status">
          <span class="ready-status ${p.ready ? 'ready' : 'not-ready'}">
            ${p.ready ? '✅ 준비완료' : '⏳ 준비중'}
          </span>
          <span class="join-time">${new Date(p.joinedAt).toLocaleTimeString('ko-KR')}</span>
        </div>
      </div>
    `).join('');
  }
  
  // 시작 버튼 활성화 체크
  updateStartButtonState();
}

/**
 * 시작 버튼 상태 업데이트
 */
function updateStartButtonState() {
  const startBtn = safeGet('startGroupTrainingBtn');
  if (!startBtn || !groupTrainingState.isAdmin) return;
  
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
  const allReady = room.participants.every(p => p.ready);
  const hasParticipants = room.participants.length >= 2; // 최소 2명
  
  const canStart = allReady && hasParticipants;
  
  startBtn.disabled = !canStart;
  startBtn.textContent = canStart ? '🚀 그룹 훈련 시작' : 
    !hasParticipants ? '👥 참가자 대기 중' : '⏳ 준비 완료 대기 중';
}

/**
 * 워크아웃 정보 로드
 */
async function loadWorkoutInfo(workoutId) {
  try {
    if (typeof getWorkout === 'function') {
      const workout = await getWorkout(workoutId);
      const workoutEl = safeGet('currentRoomWorkout');
      if (workoutEl && workout) {
        workoutEl.textContent = workout.title;
      }
    }
  } catch (error) {
    console.error('Failed to load workout info:', error);
  }
}

// ========== 실시간 동기화 ==========

/**
 * 방 실시간 동기화 시작
 */
function startRoomSync() {
  if (groupTrainingState.syncInterval) {
    clearInterval(groupTrainingState.syncInterval);
  }
  
  groupTrainingState.syncInterval = setInterval(syncRoomData, 3000); // 3초마다
  groupTrainingState.isConnected = true;
}

/**
 * 방 실시간 동기화 중지
 */
function stopRoomSync() {
  if (groupTrainingState.syncInterval) {
    clearInterval(groupTrainingState.syncInterval);
    groupTrainingState.syncInterval = null;
  }
  groupTrainingState.isConnected = false;
}

/**
 * 방 데이터 동기화
 */
async function syncRoomData() {
  if (!groupTrainingState.roomCode) return;
  
  try {
    const latestRoom = await getRoomByCode(groupTrainingState.roomCode);
    
    if (!latestRoom) {
      showToast('방이 삭제되었습니다', 'error');
      leaveGroupRoom();
      return;
    }
    
    // 방 상태가 변경되었는지 확인
    const hasChanges = JSON.stringify(latestRoom) !== JSON.stringify(groupTrainingState.currentRoom);
    
    if (hasChanges) {
      groupTrainingState.currentRoom = latestRoom;
      updateParticipantsList();
      
      // 훈련 시작 상태 확인
      if (latestRoom.status === 'training' && !groupTrainingState.isTraining) {
        startGroupTrainingSession();
      }
    }
    
    groupTrainingState.lastSyncTime = new Date();
    
  } catch (error) {
    console.error('Sync error:', error);
    // 연결 오류 시 사용자에게 알림
    if (groupTrainingState.isConnected) {
      showToast('연결이 불안정합니다', 'warning');
    }
  }
}

// 다음 블록에서 계속...

// ========== 내보내기 ==========
// 전역 함수들을 window 객체에 등록
window.selectTrainingMode = selectTrainingMode;
window.selectGroupMode = selectGroupMode;
window.selectRole = selectRole;
window.createGroupRoom = createGroupRoom;
window.joinGroupRoom = joinGroupRoom;
window.joinRoomByCode = joinRoomByCode;
window.refreshRoomList = refreshRoomList;

console.log('✅ Group Training Manager loaded');




// ========== 훈련방 관리자 기능들 (grade=1 전용) ==========

// 관리자 대시보드 초기화


async function initializeManagerDashboard() {
  console.log('Initializing manager dashboard');
  
  try {
    // 활성 훈련방 목록 로드
    await refreshActiveRooms();
    
    // 통계 업데이트
    await updateRoomStatistics();
    
    // 자동 새로고침 설정 (30초마다)
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
    }
    
    groupTrainingState.managerInterval = setInterval(() => {
      if (groupTrainingState.isManager) {
        refreshActiveRooms();
        updateRoomStatistics();
      }
    }, 30000);
    
  } catch (error) {
    console.error('Failed to initialize manager dashboard:', error);
    showToast('관리자 대시보드 초기화에 실패했습니다', 'error');
  }
}

/**
 * 활성 훈련방 목록 새로고침
 */
async function refreshActiveRooms() {
  const container = safeGet('activeRoomsList');
  if (!container) return;
  
  try {
    container.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>활성 훈련방을 불러오는 중...</p>
      </div>
    `;
    
    // 모든 상태의 방 목록 가져오기
    const allRooms = await getAllRoomsFromBackend();
    
    // 활성 방만 필터링 (waiting, training 상태)
    const activeRooms = allRooms.filter(room => 
      room.Status === 'waiting' || room.Status === 'training'
    );
    
    if (activeRooms.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          <div class="empty-state-title">활성 훈련방이 없습니다</div>
          <div class="empty-state-description">현재 진행 중인 훈련방이 없습니다</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = activeRooms.map(room => `
      <div class="active-room-card ${room.Status}">
        <div class="room-header">
          <span class="room-name">${room.Name}</span>
          <span class="room-status ${room.Status}">
            ${room.Status === 'waiting' ? '⏳ 대기중' : '🔴 진행중'}
          </span>
        </div>
        
        <div class="room-details">
          <div><strong>방 코드:</strong> ${room.Code}</div>
          <div><strong>관리자:</strong> ${room.AdminName}</div>
          <div><strong>참가자:</strong> ${(room.ParticipantsData || []).length}/${room.MaxParticipants}명</div>
          <div><strong>생성시간:</strong> ${new Date(room.CreatedAt).toLocaleString()}</div>
        </div>
        
        <div class="room-participants">
          ${(room.ParticipantsData || []).map(p => `
            <span class="participant-tag ${p.role}">${p.name}</span>
          `).join('')}
        </div>
        
        <div class="room-actions">
          <button class="room-action-btn monitor" onclick="monitorRoom('${room.Code}')">
            👁️ 모니터링
          </button>
          <button class="room-action-btn stop" onclick="forceStopRoom('${room.Code}')">
            🛑 강제 중단
          </button>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Failed to refresh active rooms:', error);
    container.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">활성 방 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="refreshActiveRooms()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 전체 방 목록 가져오기 (관리자용)
 */
async function getAllRoomsFromBackend() {
  try {
    const params = new URLSearchParams({
      action: 'listGroupRooms'
      // status 파라미터 없이 모든 방 조회
    });
    
    const scriptUrl = window.GAS_URL || window.APP_SCRIPT_URL || 'your-gas-deployment-url';
    const response = await fetch(`${scriptUrl}?${params.toString()}`);
    const result = await response.json();
    
    if (result.success) {
      return result.items || [];
    } else {
      console.error('Backend error:', result.error);
      return [];
    }
    
  } catch (error) {
    console.error('Failed to get all rooms from backend:', error);
    
    // Fallback: localStorage에서 조회
    try {
      const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
      return Object.values(rooms);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * 훈련방 통계 업데이트
 */
async function updateRoomStatistics() {
  try {
    const allRooms = await getAllRoomsFromBackend();
    
    const totalRooms = allRooms.length;
    const activeRooms = allRooms.filter(r => r.Status === 'waiting' || r.Status === 'training').length;
    const trainingRooms = allRooms.filter(r => r.Status === 'training').length;
    const totalParticipants = allRooms.reduce((sum, room) => 
      sum + (room.ParticipantsData || []).length, 0
    );
    
    // UI 업데이트
    const totalEl = safeGet('totalRoomsCount');
    const activeEl = safeGet('activeRoomsCount');
    const participantsEl = safeGet('totalParticipantsCount');
    const trainingEl = safeGet('trainingRoomsCount');
    
    if (totalEl) totalEl.textContent = totalRooms;
    if (activeEl) activeEl.textContent = activeRooms;
    if (participantsEl) participantsEl.textContent = totalParticipants;
    if (trainingEl) trainingEl.textContent = trainingRooms;
    
  } catch (error) {
    console.error('Failed to update room statistics:', error);
  }
}

/**
 * 특정 방 모니터링
 */
async function monitorRoom(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    if (!room) {
      showToast('방 정보를 찾을 수 없습니다', 'error');
      return;
    }
    
    // 모니터링 모달 또는 새 창 열기
    showRoomMonitoringModal(room);
    
  } catch (error) {
    console.error('Failed to monitor room:', error);
    showToast('방 모니터링에 실패했습니다', 'error');
  }
}

/**
 * 방 강제 중단
 */
async function forceStopRoom(roomCode) {
  const confirmed = confirm(`정말 방 ${roomCode}를 강제로 중단하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
  if (!confirmed) return;
  
  try {
    const success = await updateRoomOnBackend({
      code: roomCode,
      status: 'closed'
    });
    
    if (success) {
      showToast('방이 강제 중단되었습니다', 'success');
      refreshActiveRooms();
      updateRoomStatistics();
    } else {
      throw new Error('Failed to stop room');
    }
    
  } catch (error) {
    console.error('Failed to force stop room:', error);
    showToast('방 강제 중단에 실패했습니다', 'error');
  }
}

/**
 * 만료된 방 정리
 */
async function cleanupExpiredRooms() {
  const confirmed = confirm('24시간 이상 된 비활성 방들을 정리하시겠습니까?');
  if (!confirmed) return;
  
  try {
    showToast('만료된 방을 정리하는 중...', 'info');
    
    const allRooms = await getAllRoomsFromBackend();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    let cleanedCount = 0;
    
    for (const room of allRooms) {
      const createdAt = new Date(room.CreatedAt);
      if (createdAt < oneDayAgo && room.Status !== 'training') {
        try {
          await deleteGroupTrainingRoom(room.Code);
          cleanedCount++;
        } catch (error) {
          console.error(`Failed to delete room ${room.Code}:`, error);
        }
      }
    }
    
    showToast(`${cleanedCount}개의 만료된 방을 정리했습니다`, 'success');
    refreshActiveRooms();
    updateRoomStatistics();
    
  } catch (error) {
    console.error('Failed to cleanup expired rooms:', error);
    showToast('방 정리에 실패했습니다', 'error');
  }
}

/**
 * 전체 방 긴급 중단
 */
async function emergencyStopAllRooms() {
  const confirmed = confirm('⚠️ 경고: 모든 활성 훈련방을 긴급 중단하시겠습니까?\n이 작업은 되돌릴 수 없으며, 모든 참가자의 훈련이 중단됩니다.');
  if (!confirmed) return;
  
  const doubleConfirmed = confirm('정말로 확실하십니까? "예"를 클릭하면 모든 방이 즉시 중단됩니다.');
  if (!doubleConfirmed) return;
  
  try {
    showToast('모든 방을 긴급 중단하는 중...', 'warning');
    
    const allRooms = await getAllRoomsFromBackend();
    const activeRooms = allRooms.filter(r => r.Status === 'waiting' || r.Status === 'training');
    
    let stoppedCount = 0;
    
    for (const room of activeRooms) {
      try {
        await updateRoomOnBackend({
          code: room.Code,
          status: 'emergency_stopped'
        });
        stoppedCount++;
      } catch (error) {
        console.error(`Failed to stop room ${room.Code}:`, error);
      }
    }
    
    showToast(`${stoppedCount}개의 훈련방이 긴급 중단되었습니다`, 'success');
    refreshActiveRooms();
    updateRoomStatistics();
    
  } catch (error) {
    console.error('Failed to emergency stop all rooms:', error);
    showToast('긴급 중단에 실패했습니다', 'error');
  }
}

// 전역 함수 등록
window.refreshActiveRooms = refreshActiveRooms;
window.updateRoomStatistics = updateRoomStatistics;
window.monitorRoom = monitorRoom;
window.forceStopRoom = forceStopRoom;
window.cleanupExpiredRooms = cleanupExpiredRooms;
window.emergencyStopAllRooms = emergencyStopAllRooms;
window.initializeManagerDashboard = initializeManagerDashboard;

