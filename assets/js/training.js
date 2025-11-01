
/**
 * 그룹 훈련 관리 모듈 (assets/training.js)
 * 기존 개인 훈련 기능을 유지하면서 그룹 훈련 기능을 추가
 */

// ===== 그룹 훈련 관련 전역 변수 =====
window.groupTraining = {
  currentRoom: null,
  isGroupMode: false,
  participants: [],
  roomStatus: 'waiting', // waiting, training, finished
  isHost: false,
  pollingInterval: null,
  lastUpdate: null
};

// ===== 그룹 훈련 메인 함수들 =====

/**
 * 그룹 훈련 모드 초기화
 */
export function initGroupTraining() {
  console.log('그룹 훈련 모드 초기화');
  
  // 기존 개인 훈련 상태 정리
  if (window.trainingState && window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
  }
  
  // 그룹 훈련 상태 초기화
  window.groupTraining = {
    currentRoom: null,
    isGroupMode: true,
    participants: [],
    roomStatus: 'waiting',
    isHost: false,
    pollingInterval: null,
    lastUpdate: Date.now()
  };
  
  // UI 초기화
  updateGroupTrainingUI();
}

/**
 * 그룹 훈련방 생성 (관리자만)
 */
export async function createGroupRoom(roomName, workoutId, scheduledTime = null, maxParticipants = 10) {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    
    if (!currentUser || currentUser.grade !== '1') {
      throw new Error('관리자만 그룹 훈련방을 생성할 수 있습니다.');
    }
    
    if (!roomName || !workoutId) {
      throw new Error('방 이름과 워크아웃을 선택해주세요.');
    }
    
    showLoadingSpinner('그룹 훈련방을 생성하는 중...');
    
    const params = {
      action: 'createGroupRoom',
      roomName: roomName,
      hostUserId: currentUser.userId,
      workoutId: workoutId,
      hostGrade: currentUser.grade,
      scheduledTime: scheduledTime,
      maxParticipants: maxParticipants
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      window.groupTraining.currentRoom = result.data;
      window.groupTraining.isHost = true;
      window.groupTraining.roomStatus = 'waiting';
      
      showToast('그룹 훈련방이 생성되었습니다!');
      showGroupWaitingRoom();
      startRoomStatusPolling();
      
      return result.data;
    } else {
      throw new Error(result.error || '방 생성에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('그룹 훈련방 생성 오류:', error);
    showToast(error.message, 'error');
    throw error;
  } finally {
    hideLoadingSpinner();
  }
}

/**
 * 그룹 훈련방 목록 조회
 */
export async function getGroupRoomList() {
  try {
    const params = {
      action: 'listGroupRooms'
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || '방 목록 조회에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('그룹 훈련방 목록 조회 오류:', error);
    return [];
  }
}

/**
 * 그룹 훈련방 참가
 */
export async function joinGroupRoom(roomId) {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    
    if (!currentUser) {
      throw new Error('로그인이 필요합니다.');
    }
    
    showLoadingSpinner('그룹 훈련방에 참가하는 중...');
    
    const params = {
      action: 'joinGroupRoom',
      roomId: roomId,
      userId: currentUser.userId,
      userName: currentUser.name || currentUser.userId
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      // 방 정보 조회
      const roomStatus = await getGroupRoomStatus(roomId);
      if (roomStatus) {
        window.groupTraining.currentRoom = roomStatus.room;
        window.groupTraining.participants = roomStatus.participants;
        window.groupTraining.isHost = (roomStatus.room.hostUserId === currentUser.userId);
        window.groupTraining.roomStatus = roomStatus.room.status;
        window.groupTraining.isGroupMode = true;
        
        showToast('그룹 훈련방에 참가했습니다!');
        showGroupWaitingRoom();
        startRoomStatusPolling();
        
        return result.data;
      }
    } else {
      throw new Error(result.error || '방 참가에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('그룹 훈련방 참가 오류:', error);
    showToast(error.message, 'error');
    throw error;
  } finally {
    hideLoadingSpinner();
  }
}

/**
 * 그룹 훈련방 나가기
 */
export async function leaveGroupRoom() {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    const roomId = window.groupTraining.currentRoom?.roomId;
    
    if (!roomId || !currentUser) {
      throw new Error('참가 중인 방이 없습니다.');
    }
    
    const params = {
      action: 'leaveGroupRoom',
      roomId: roomId,
      userId: currentUser.userId
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      // 그룹 훈련 상태 정리
      stopRoomStatusPolling();
      window.groupTraining = {
        currentRoom: null,
        isGroupMode: false,
        participants: [],
        roomStatus: 'waiting',
        isHost: false,
        pollingInterval: null,
        lastUpdate: null
      };
      
      showToast('그룹 훈련방에서 나왔습니다.');
      showWorkoutSelectionScreen();
      
      return true;
    } else {
      throw new Error(result.error || '방 나가기에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('그룹 훈련방 나가기 오류:', error);
    showToast(error.message, 'error');
    return false;
  }
}

/**
 * 그룹 훈련방 상태 조회
 */
export async function getGroupRoomStatus(roomId) {
  try {
    const params = {
      action: 'getGroupRoomStatus',
      roomId: roomId
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      return result.data;
    } else {
      console.error('방 상태 조회 실패:', result.error);
      return null;
    }
    
  } catch (error) {
    console.error('그룹 훈련방 상태 조회 오류:', error);
    return null;
  }
}

/**
 * 그룹 훈련 시작 (방장만)
 */
export async function startGroupTraining() {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    const roomId = window.groupTraining.currentRoom?.roomId;
    
    if (!window.groupTraining.isHost) {
      throw new Error('방장만 훈련을 시작할 수 있습니다.');
    }
    
    if (!roomId) {
      throw new Error('참가 중인 방이 없습니다.');
    }
    
    showLoadingSpinner('그룹 훈련을 시작하는 중...');
    
    const params = {
      action: 'startGroupTraining',
      roomId: roomId,
      hostUserId: currentUser.userId
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      window.groupTraining.roomStatus = 'training';
      showToast('그룹 훈련이 시작되었습니다!');
      
      // 훈련 화면으로 전환
      await startActualGroupTraining();
      
      return true;
    } else {
      throw new Error(result.error || '그룹 훈련 시작에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('그룹 훈련 시작 오류:', error);
    showToast(error.message, 'error');
    return false;
  } finally {
    hideLoadingSpinner();
  }
}

/**
 * 실제 그룹 훈련 시작 (훈련 화면 표시)
 */
async function startActualGroupTraining() {
  try {
    // 워크아웃 데이터 로드
    const workoutId = window.groupTraining.currentRoom?.workoutId;
    if (!workoutId) {
      throw new Error('워크아웃 정보가 없습니다.');
    }
    
    // 기존 개인 훈련 함수 활용하여 워크아웃 로드
    await loadWorkoutForTraining(workoutId);
    
    // 그룹 훈련 전용 UI로 변경
    showGroupTrainingScreen();
    
    // 그룹 훈련 데이터 전송 시작
    startGroupTrainingDataSync();
    
    // 기존 훈련 타이머 시작 (개인 훈련 로직 재활용)
    if (window.startTraining) {
      window.startTraining();
    }
    
  } catch (error) {
    console.error('실제 그룹 훈련 시작 오류:', error);
    showToast('훈련 시작에 실패했습니다: ' + error.message, 'error');
  }
}

/**
 * 그룹 훈련 데이터 동기화 시작
 */
function startGroupTrainingDataSync() {
  // 기존 동기화 정리
  if (window.groupTraining.dataSyncInterval) {
    clearInterval(window.groupTraining.dataSyncInterval);
  }
  
  // 5초마다 데이터 전송
  window.groupTraining.dataSyncInterval = setInterval(async () => {
    await syncGroupTrainingData();
  }, 5000);
  
  console.log('그룹 훈련 데이터 동기화 시작');
}

/**
 * 그룹 훈련 데이터 동기화
 */
async function syncGroupTrainingData() {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    const roomId = window.groupTraining.currentRoom?.roomId;
    
    if (!roomId || !currentUser || window.groupTraining.roomStatus !== 'training') {
      return;
    }
    
    // 현재 훈련 데이터 수집
    const liveData = window.liveData || {};
    const trainingState = window.trainingState || {};
    
    const params = {
      action: 'updateGroupTrainingData',
      roomId: roomId,
      userId: currentUser.userId,
      power: liveData.power || 0,
      cadence: liveData.cadence || 0,
      heartRate: liveData.heartRate || 0,
      currentSegment: trainingState.segIndex || 0,
      elapsedTime: trainingState.elapsedSec || 0
    };
    
    const result = await makeGASRequest(params);
    
    if (!result.success) {
      console.error('그룹 훈련 데이터 동기화 실패:', result.error);
    }
    
  } catch (error) {
    console.error('그룹 훈련 데이터 동기화 오류:', error);
  }
}

/**
 * 방 상태 폴링 시작
 */
function startRoomStatusPolling() {
  // 기존 폴링 정리
  stopRoomStatusPolling();
  
  // 3초마다 방 상태 확인
  window.groupTraining.pollingInterval = setInterval(async () => {
    await updateRoomStatus();
  }, 3000);
  
  console.log('방 상태 폴링 시작');
}

/**
 * 방 상태 폴링 중지
 */
function stopRoomStatusPolling() {
  if (window.groupTraining.pollingInterval) {
    clearInterval(window.groupTraining.pollingInterval);
    window.groupTraining.pollingInterval = null;
  }
  
  if (window.groupTraining.dataSyncInterval) {
    clearInterval(window.groupTraining.dataSyncInterval);
    window.groupTraining.dataSyncInterval = null;
  }
}

/**
 * 방 상태 업데이트
 */
async function updateRoomStatus() {
  try {
    const roomId = window.groupTraining.currentRoom?.roomId;
    if (!roomId) return;
    
    const status = await getGroupRoomStatus(roomId);
    if (!status) return;
    
    const oldStatus = window.groupTraining.roomStatus;
    const newStatus = status.room.status;
    
    // 상태 업데이트
    window.groupTraining.participants = status.participants;
    window.groupTraining.roomStatus = newStatus;
    
    // 상태 변화 감지
    if (oldStatus !== newStatus) {
      handleRoomStatusChange(oldStatus, newStatus);
    }
    
    // UI 업데이트
    updateGroupTrainingUI();
    
    // 관리자인 경우 참가자 모니터링 데이터 업데이트
    if (window.groupTraining.isHost && newStatus === 'training') {
      await updateAdminMonitoring();
    }
    
  } catch (error) {
    console.error('방 상태 업데이트 오류:', error);
  }
}

/**
 * 방 상태 변화 처리
 */
function handleRoomStatusChange(oldStatus, newStatus) {
  console.log('방 상태 변화:', oldStatus, '->', newStatus);
  
  if (oldStatus === 'waiting' && newStatus === 'training') {
    // 훈련 시작됨
    showToast('그룹 훈련이 시작되었습니다!');
    if (!window.groupTraining.isHost) {
      // 참가자는 자동으로 훈련 화면으로 전환
      startActualGroupTraining();
    }
  } else if (newStatus === 'finished') {
    // 훈련 종료됨
    showToast('그룹 훈련이 종료되었습니다.');
    handleGroupTrainingFinished();
  }
}

/**
 * 그룹 훈련 종료 처리
 */
function handleGroupTrainingFinished() {
  // 폴링 중지
  stopRoomStatusPolling();
  
  // 훈련 타이머 정지
  if (window.trainingState && window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
  }
  
  // 결과 화면 표시
  showGroupTrainingResults();
}

/**
 * 관리자 모니터링 데이터 업데이트
 */
async function updateAdminMonitoring() {
  try {
    const roomId = window.groupTraining.currentRoom?.roomId;
    if (!roomId) return;
    
    const params = {
      action: 'getGroupTrainingData',
      roomId: roomId
    };
    
    const result = await makeGASRequest(params);
    
    if (result.success) {
      updateAdminMonitoringUI(result.data);
    }
    
  } catch (error) {
    console.error('관리자 모니터링 데이터 업데이트 오류:', error);
  }
}

// ===== UI 관련 함수들 =====

/**
 * 그룹 훈련 UI 업데이트
 */
function updateGroupTrainingUI() {
  const container = document.getElementById('groupTrainingContainer');
  if (!container) return;
  
  const room = window.groupTraining.currentRoom;
  const participants = window.groupTraining.participants;
  const isHost = window.groupTraining.isHost;
  const status = window.groupTraining.roomStatus;
  
  // 방 정보 표시
  const roomInfoElement = document.getElementById('groupRoomInfo');
  if (roomInfoElement && room) {
    roomInfoElement.innerHTML = `
      <h3>${escapeHtml(room.roomName)}</h3>
      <p>상태: ${getStatusText(status)} | 참가자: ${participants.length}명</p>
      ${isHost ? '<span class="host-badge">방장</span>' : ''}
    `;
  }
  
  // 참가자 목록 표시
  const participantsElement = document.getElementById('groupParticipantsList');
  if (participantsElement) {
    participantsElement.innerHTML = participants.map(p => `
      <div class="participant-item">
        <span class="participant-name">${escapeHtml(p.userName || p.userId)}</span>
        <span class="participant-status">참가중</span>
      </div>
    `).join('');
  }
  
  // 버튼 상태 업데이트
  updateGroupTrainingButtons(status, isHost);
}

/**
 * 그룹 훈련 버튼 상태 업데이트
 */
function updateGroupTrainingButtons(status, isHost) {
  const startButton = document.getElementById('groupTrainingStartBtn');
  const leaveButton = document.getElementById('groupTrainingLeaveBtn');
  
  if (startButton) {
    if (status === 'waiting' && isHost) {
      startButton.style.display = 'block';
      startButton.disabled = false;
    } else {
      startButton.style.display = 'none';
    }
  }
  
  if (leaveButton) {
    leaveButton.style.display = status === 'waiting' ? 'block' : 'none';
  }
}

/**
 * 그룹 대기실 화면 표시
 */
function showGroupWaitingRoom() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  
  mainContent.innerHTML = `
    <div id="groupTrainingContainer" class="group-training-container">
      <div class="group-room-header">
        <div id="groupRoomInfo"></div>
        <button id="groupTrainingLeaveBtn" class="btn btn-secondary">방 나가기</button>
      </div>
      
      <div class="group-participants-section">
        <h4>참가자 목록</h4>
        <div id="groupParticipantsList" class="participants-list"></div>
      </div>
      
      <div class="group-waiting-actions">
        <button id="groupTrainingStartBtn" class="btn btn-primary" style="display: none;">
          훈련 시작
        </button>
        <div class="waiting-message">
          <p>다른 참가자들을 기다리는 중입니다...</p>
          <div class="loading-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // 이벤트 리스너 등록
  const startBtn = document.getElementById('groupTrainingStartBtn');
  const leaveBtn = document.getElementById('groupTrainingLeaveBtn');
  
  if (startBtn) {
    startBtn.addEventListener('click', startGroupTraining);
  }
  
  if (leaveBtn) {
    leaveBtn.addEventListener('click', leaveGroupRoom);
  }
  
  // 초기 UI 업데이트
  updateGroupTrainingUI();
}

/**
 * 그룹 훈련 화면 표시
 */
function showGroupTrainingScreen() {
  // 기존 훈련 화면을 베이스로 하되, 그룹 요소 추가
  if (window.showTrainingScreen) {
    window.showTrainingScreen();
  }
  
  // 그룹 훈련 전용 요소 추가
  addGroupTrainingElements();
}

/**
 * 그룹 훈련 전용 요소 추가
 */
function addGroupTrainingElements() {
  const trainingScreen = document.querySelector('.training-screen');
  if (!trainingScreen) return;
  
  // 그룹 정보 패널 추가
  const groupPanel = document.createElement('div');
  groupPanel.className = 'group-training-panel';
  groupPanel.innerHTML = `
    <div class="group-info">
      <span class="group-icon">👥</span>
      <span class="group-text">그룹 훈련 중</span>
      <span id="groupParticipantCount">${window.groupTraining.participants.length}명</span>
    </div>
    ${window.groupTraining.isHost ? '<button id="adminMonitorBtn" class="btn btn-sm">모니터링</button>' : ''}
  `;
  
  trainingScreen.insertBefore(groupPanel, trainingScreen.firstChild);
  
  // 관리자 모니터링 버튼 이벤트
  const monitorBtn = document.getElementById('adminMonitorBtn');
  if (monitorBtn) {
    monitorBtn.addEventListener('click', showAdminMonitoring);
  }
}

/**
 * 관리자 모니터링 화면 표시
 */
function showAdminMonitoring() {
  if (!window.groupTraining.isHost) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content admin-monitoring-modal">
      <div class="modal-header">
        <h3>그룹 훈련 모니터링</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="adminMonitoringData" class="monitoring-grid">
          <div class="loading-spinner">데이터를 불러오는 중...</div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 닫기 버튼 이벤트
  modal.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  // 모니터링 데이터 업데이트
  updateAdminMonitoring();
}

/**
 * 관리자 모니터링 UI 업데이트
 */
function updateAdminMonitoringUI(data) {
  const container = document.getElementById('adminMonitoringData');
  if (!container) return;
  
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="no-data">훈련 데이터가 없습니다.</div>';
    return;
  }
  
  // 사용자별로 최신 데이터 그룹화
  const userDataMap = {};
  data.forEach(log => {
    if (!userDataMap[log.userId] || new Date(log.timestamp) > new Date(userDataMap[log.userId].timestamp)) {
      userDataMap[log.userId] = log;
    }
  });
  
  const userDataArray = Object.values(userDataMap);
  
  container.innerHTML = userDataArray.map(log => {
    const participant = window.groupTraining.participants.find(p => p.userId === log.userId);
    const userName = participant ? participant.userName : log.userId;
    
    return `
      <div class="monitoring-card">
        <div class="user-info">
          <h4>${escapeHtml(userName)}</h4>
          <span class="segment-info">세그먼트 ${log.currentSegment + 1}</span>
        </div>
        <div class="training-data">
          <div class="data-item">
            <span class="label">파워</span>
            <span class="value">${log.power}W</span>
          </div>
          <div class="data-item">
            <span class="label">케이던스</span>
            <span class="value">${log.cadence}rpm</span>
          </div>
          <div class="data-item">
            <span class="label">심박수</span>
            <span class="value">${log.heartRate}bpm</span>
          </div>
          <div class="data-item">
            <span class="label">경과시간</span>
            <span class="value">${formatTime(log.elapsedTime)}</span>
          </div>
        </div>
        <div class="last-update">
          마지막 업데이트: ${formatTimestamp(log.timestamp)}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 그룹 훈련 결과 화면 표시
 */
function showGroupTrainingResults() {
  // 기존 결과 화면을 베이스로 하되, 그룹 요소 추가
  if (window.showResultScreen) {
    window.showResultScreen();
  }
  
  // 그룹 결과 추가 정보 표시
  addGroupResultElements();
}

/**
 * 그룹 결과 추가 요소
 */
function addGroupResultElements() {
  const resultScreen = document.querySelector('.result-screen');
  if (!resultScreen) return;
  
  const groupResultPanel = document.createElement('div');
  groupResultPanel.className = 'group-result-panel';
  groupResultPanel.innerHTML = `
    <h3>그룹 훈련 완료</h3>
    <p>참가자 ${window.groupTraining.participants.length}명과 함께 훈련을 완료했습니다!</p>
    <button id="backToGroupListBtn" class="btn btn-primary">그룹 훈련 목록으로</button>
  `;
  
  resultScreen.appendChild(groupResultPanel);
  
  // 버튼 이벤트
  document.getElementById('backToGroupListBtn').addEventListener('click', () => {
    leaveGroupRoom();
  });
}

/**
 * 워크아웃 선택 화면 표시 (그룹 훈련 옵션 포함)
 */
export function showWorkoutSelectionWithGroupOption() {
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const isAdmin = currentUser && currentUser.grade === '1';
  
  // 기존 워크아웃 선택 화면 표시
  if (window.showWorkoutSelection) {
    window.showWorkoutSelection();
  }
  
  // 그룹 훈련 옵션 추가
  setTimeout(() => {
    addGroupTrainingOptions(isAdmin);
  }, 100);
}

/**
 * 워크아웃 선택 화면에 그룹 훈련 옵션 추가
 */
function addGroupTrainingOptions(isAdmin) {
  const workoutActions = document.querySelector('.workout-actions');
  if (!workoutActions) return;
  
  // 그룹 훈련 버튼들 추가
  const groupButtons = document.createElement('div');
  groupButtons.className = 'group-training-buttons';
  groupButtons.innerHTML = `
    <div class="button-group">
      <button id="joinGroupRoomBtn" class="btn btn-secondary">
        <span class="icon">👥</span>
        그룹 훈련 참가
      </button>
      ${isAdmin ? `
        <button id="createGroupRoomBtn" class="btn btn-primary">
          <span class="icon">➕</span>
          그룹 훈련방 생성
        </button>
      ` : ''}
    </div>
  `;
  
  workoutActions.appendChild(groupButtons);
  
  // 이벤트 리스너 등록
  document.getElementById('joinGroupRoomBtn').addEventListener('click', showGroupRoomList);
  
  if (isAdmin) {
    document.getElementById('createGroupRoomBtn').addEventListener('click', showCreateGroupRoomModal);
  }
}

/**
 * 그룹 훈련방 목록 표시
 */
async function showGroupRoomList() {
  try {
    showLoadingSpinner('그룹 훈련방 목록을 불러오는 중...');
    
    const rooms = await getGroupRoomList();
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content group-room-list-modal">
        <div class="modal-header">
          <h3>그룹 훈련방 목록</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="groupRoomList" class="room-list">
            ${rooms.length === 0 ? 
              '<div class="no-rooms">현재 활성 중인 그룹 훈련방이 없습니다.</div>' :
              rooms.map(room => `
                <div class="room-item" data-room-id="${room.roomId}">
                  <div class="room-info">
                    <h4>${escapeHtml(room.roomName)}</h4>
                    <p>상태: ${getStatusText(room.status)}</p>
                    <p>워크아웃: ${room.workoutId}</p>
                  </div>
                  <button class="btn btn-primary join-room-btn" data-room-id="${room.roomId}">
                    참가하기
                  </button>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 이벤트 리스너
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    modal.querySelectorAll('.join-room-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const roomId = e.target.dataset.roomId;
        document.body.removeChild(modal);
        await joinGroupRoom(roomId);
      });
    });
    
  } catch (error) {
    console.error('그룹 훈련방 목록 표시 오류:', error);
    showToast('방 목록을 불러올 수 없습니다.', 'error');
  } finally {
    hideLoadingSpinner();
  }
}

/**
 * 그룹 훈련방 생성 모달 표시
 */
function showCreateGroupRoomModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content create-room-modal">
      <div class="modal-header">
        <h3>그룹 훈련방 생성</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <form id="createGroupRoomForm">
          <div class="form-group">
            <label for="roomName">방 이름</label>
            <input type="text" id="roomName" required placeholder="예: 오늘 저녁 그룹 훈련">
          </div>
          
          <div class="form-group">
            <label for="workoutSelect">워크아웃 선택</label>
            <select id="workoutSelect" required>
              <option value="">워크아웃을 선택하세요</option>
              <!-- 워크아웃 목록이 동적으로 추가됩니다 -->
            </select>
          </div>
          
          <div class="form-group">
            <label for="maxParticipants">최대 참가자 수</label>
            <input type="number" id="maxParticipants" value="10" min="2" max="20">
          </div>
          
          <div class="form-group">
            <label for="scheduledTime">시작 시간 (선택사항)</label>
            <input type="datetime-local" id="scheduledTime">
          </div>
          
          <div class="form-actions">
            <button type="button" class="btn btn-secondary modal-close">취소</button>
            <button type="submit" class="btn btn-primary">방 생성</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 워크아웃 목록 로드
  loadWorkoutOptionsForGroupRoom();
  
  // 이벤트 리스너
  modal.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
  });
  
  modal.querySelector('#createGroupRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const roomName = formData.get('roomName');
    const workoutId = formData.get('workoutSelect');
    const maxParticipants = parseInt(formData.get('maxParticipants'));
    const scheduledTime = formData.get('scheduledTime');
    
    try {
      document.body.removeChild(modal);
      await createGroupRoom(roomName, workoutId, scheduledTime, maxParticipants);
    } catch (error) {
      // 오류 처리는 createGroupRoom에서 함
    }
  });
}

/**
 * 그룹 훈련방 생성용 워크아웃 옵션 로드
 */
async function loadWorkoutOptionsForGroupRoom() {
  try {
    const workoutSelect = document.getElementById('workoutSelect');
    if (!workoutSelect) return;
    
    // 기존 워크아웃 목록 가져오기
    if (window.loadWorkouts) {
      await window.loadWorkouts();
    }
    
    // 전역 workouts 변수에서 옵션 생성
    const workouts = window.workouts || [];
    workouts.forEach(workout => {
      const option = document.createElement('option');
      option.value = workout.workoutId;
      option.textContent = workout.workoutName;
      workoutSelect.appendChild(option);
    });
    
  } catch (error) {
    console.error('워크아웃 옵션 로드 오류:', error);
  }
}

// ===== 유틸리티 함수들 =====

/**
 * 상태 텍스트 반환
 */
function getStatusText(status) {
  const statusMap = {
    'waiting': '대기 중',
    'training': '훈련 중',
    'finished': '완료'
  };
  return statusMap[status] || status;
}

/**
 * 시간 포맷팅 (초 -> MM:SS)
 */
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 타임스탬프 포맷팅
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ko-KR');
}

/**
 * HTML 이스케이프
 */
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * GAS 요청 (기존 함수 활용)
 */
async function makeGASRequest(params) {
  if (window.makeGASRequest) {
    return await window.makeGASRequest(params);
  } else {
    throw new Error('GAS 요청 함수를 찾을 수 없습니다.');
  }
}

/**
 * 로딩 스피너 표시 (기존 함수 활용)
 */
function showLoadingSpinner(message) {
  if (window.showLoadingSpinner) {
    window.showLoadingSpinner(message);
  }
}

/**
 * 로딩 스피너 숨김 (기존 함수 활용)
 */
function hideLoadingSpinner() {
  if (window.hideLoadingSpinner) {
    window.hideLoadingSpinner();
  }
}

/**
 * 토스트 메시지 표시 (기존 함수 활용)
 */
function showToast(message, type = 'info') {
  if (window.showToast) {
    window.showToast(message, type);
  } else {
    alert(message);
  }
}

/**
 * 워크아웃 선택 화면 표시 (기존 함수 활용)
 */
function showWorkoutSelectionScreen() {
  if (window.showWorkoutSelection) {
    window.showWorkoutSelection();
  }
}

/**
 * 훈련용 워크아웃 로드 (기존 함수 활용)
 */
async function loadWorkoutForTraining(workoutId) {
  if (window.loadWorkoutForTraining) {
    return await window.loadWorkoutForTraining(workoutId);
  } else {
    throw new Error('워크아웃 로드 함수를 찾을 수 없습니다.');
  }
}

// ===== 모듈 초기화 =====
console.log('그룹 훈련 모듈 로드 완료');

// 전역 함수로 등록하여 다른 모듈에서 사용 가능
window.groupTrainingModule = {
  initGroupTraining,
  createGroupRoom,
  joinGroupRoom,
  leaveGroupRoom,
  startGroupTraining,
  showWorkoutSelectionWithGroupOption
};
