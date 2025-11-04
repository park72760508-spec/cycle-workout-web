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
  participants: [],
  roomCode: null,
  syncInterval: null,
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
  const adminSection = safeGet('adminSection');
  const participantSection = safeGet('participantSection');
  
  if (!adminBtn || !participantBtn || !adminSection || !participantSection) {
    console.error('Role UI elements not found');
    return;
  }
  
  // 버튼 상태 업데이트
  adminBtn.classList.toggle('active', role === 'admin');
  participantBtn.classList.toggle('active', role === 'participant');
  
  // 섹션 표시/숨김
  if (role === 'admin') {
    adminSection.classList.remove('hidden');
    participantSection.classList.add('hidden');
    groupTrainingState.isAdmin = true;
    loadWorkoutsForRoom();
  } else {
    adminSection.classList.add('hidden');
    participantSection.classList.remove('hidden');
    groupTrainingState.isAdmin = false;
    refreshRoomList();
  }
}

// ========== 관리자 기능들 ==========

/**
 * 워크아웃 목록 로드 (방 생성용)
 */
function loadWorkoutsForRoom() {
  const select = safeGet('roomWorkoutSelect');
  if (!select) return;
  
  // 기존 워크아웃 목록 사용
  if (typeof listWorkouts === 'function') {
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
    console.warn('listWorkouts function not found');
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
      }]
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
    
    const response = await fetch(`${APP_SCRIPT_URL}?${params.toString()}`);
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
        <button class="retry-button" onclick="refreshRoomList()">다시 시도</button>
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
    
    const response = await fetch(`${APP_SCRIPT_URL}?${params.toString()}`);
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
