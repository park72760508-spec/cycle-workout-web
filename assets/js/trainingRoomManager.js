/**
 * Training Room Manager
 * INDOOR RACE Training Room 생성 및 관리 로직
 */

// 전역 변수
let currentSelectedTrainingRoom = null;
let trainingRoomList = [];

/**
 * Training Room 목록 로드
 * id, user_id, title, password 정보를 가져옴
 */
async function loadTrainingRooms() {
  const listContainer = document.getElementById('trainingRoomList');
  if (!listContainer) {
    console.error('[Training Room] 목록 컨테이너를 찾을 수 없습니다.');
    return;
  }

  // 로딩 표시
  listContainer.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">Training Room 목록을 불러오는 중...</p>
    </div>
  `;

  try {
    // 구글시트에서 TrainingSchedules 목록 가져오기
    // 응답 데이터: { id, user_id, title, password, ... }
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Training Room 목록을 불러오는데 실패했습니다');
    }

    trainingRoomList = result.items || [];
    
    // 데이터 구조 확인 (디버깅용)
    if (trainingRoomList.length > 0) {
      console.log('[Training Room] 로드된 Room 데이터 구조:', trainingRoomList[0]);
      console.log('[Training Room] 각 Room 정보:', trainingRoomList.map(room => ({
        id: room.id,
        user_id: room.user_id || room.userId,
        title: room.title,
        hasPassword: !!(room.password && String(room.password).trim() !== '')
      })));
    }
    
    if (trainingRoomList.length === 0) {
      listContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
          <p style="color: #666;">등록된 Training Room이 없습니다.</p>
        </div>
      `;
      return;
    }

    // 목록 렌더링
    renderTrainingRoomList(trainingRoomList);
  } catch (error) {
    console.error('[Training Room] 목록 로드 오류:', error);
    listContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
        <p style="color: #dc3545;">오류: ${error.message}</p>
      </div>
    `;
  }
}

/**
 * Training Room 목록 렌더링
 */
function renderTrainingRoomList(rooms) {
  const listContainer = document.getElementById('trainingRoomList');
  if (!listContainer) return;

  // 사용자 목록 가져오기 (window.users 또는 window.userProfiles)
  const users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);

  listContainer.innerHTML = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    
    // user_id로 코치 이름 찾기
    const userId = room.user_id || room.userId;
    const coach = userId ? users.find(u => String(u.id) === String(userId)) : null;
    const coachName = coach ? coach.name : '';
    
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           onclick="selectTrainingRoom('${room.id}')"
           style="padding: 20px; background: white; border: 2px solid #e0e0e0; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; position: relative; display: flex; align-items: flex-start; gap: 12px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;">
            <h3 style="margin: 0; color: #333; font-size: 1.2em; flex: 1;">${escapeHtml(room.title)}</h3>
            ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" style="width: 18px; height: 18px; opacity: 0.6; margin-left: 8px; flex-shrink: 0;" />
            ` : ''}
          </div>
          <p style="margin: 0; color: #666; font-size: 0.9em;">
            ${coachName ? `Coach: ${escapeHtml(coachName)}` : ''}
          </p>
        </div>
        ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
      </div>
    `;
  }).join('');

  // CSS 스타일 추가 (일별 워크아웃 지정 화면과 동일한 선택 효과)
  // trainingRoomCardStyle이 이미 존재하면 업데이트, 없으면 추가
  let style = document.getElementById('trainingRoomCardStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'trainingRoomCardStyle';
    document.head.appendChild(style);
  }
  style.textContent = `
    .training-room-card:hover {
      border-color: #2e74e8 !important;
      box-shadow: 0 4px 12px rgba(46, 116, 232, 0.15);
      transform: translateY(-2px);
    }
    .training-room-card.selected {
      border-color: #2e74e8 !important;
      background: #e8f2ff !important;
      box-shadow: 0 0 0 2px rgba(46, 116, 232, 0.1) !important;
    }
    .training-room-check {
      width: 24px;
      height: 24px;
      background: #2e74e8;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      flex-shrink: 0;
      margin-left: 8px;
    }
  `;
}

/**
 * Training Room 선택
 */
async function selectTrainingRoom(roomId) {
  // roomId를 숫자로 변환 (문자열로 전달될 수 있음)
  const roomIdNum = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
  const room = trainingRoomList.find(r => r.id == roomIdNum || String(r.id) === String(roomIdNum));
  if (!room) {
    console.error('[Training Room] 선택한 방을 찾을 수 없습니다:', roomId, '타입:', typeof roomId, '변환:', roomIdNum);
    console.error('[Training Room] 현재 목록:', trainingRoomList.map(r => ({ id: r.id, type: typeof r.id })));
    return;
  }

  // 비밀번호 확인 (grade=1 관리자는 제외)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;

  const hasPassword = room.password && String(room.password).trim() !== '';
  
  if (hasPassword && !isAdmin) {
    // 비밀번호 확인 모달 표시
    const passwordCorrect = await showTrainingRoomPasswordModal(room.title);
    if (!passwordCorrect) {
      return; // 비밀번호가 틀리면 중단
    }
  }

  // 선택된 Training Room 저장
  currentSelectedTrainingRoom = room;
  
  // 전역 변수 및 localStorage에 room id 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room] window.SESSION_ID 업데이트:', window.SESSION_ID);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
    } catch (e) {
      console.warn('[Training Room] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room] Room ID 저장됨:', room.id);

  // 선택된 카드 하이라이트 (체크마크 추가/제거)
  document.querySelectorAll('.training-room-card').forEach(card => {
    card.classList.remove('selected');
    
    // 기존 체크마크 제거
    const existingCheck = card.querySelector('.training-room-check');
    if (existingCheck) {
      existingCheck.remove();
    }
    
    // 선택된 카드에 체크마크 추가
    if (card.dataset.roomId == roomIdNum || card.dataset.roomId === String(roomIdNum)) {
      card.classList.add('selected');
      if (!card.querySelector('.training-room-check')) {
        const checkMark = document.createElement('div');
        checkMark.className = 'training-room-check';
        checkMark.textContent = '✓';
        card.appendChild(checkMark);
      }
    }
  });

  // 선택된 Training Room 정보 표시
  const selectedSection = document.getElementById('selectedTrainingRoomSection');
  const selectedTitle = document.getElementById('selectedTrainingRoomTitle');
  const btnPlayer = document.getElementById('btnPlayer');
  const btnCoach = document.getElementById('btnCoach');

  if (selectedSection && selectedTitle) {
    selectedTitle.textContent = room.title;
    selectedSection.style.display = 'block';
  }

  // Player/Coach 버튼 활성화
  // Player 버튼: grade=1,2,3 활성화
  // Coach 버튼: grade=1,3만 활성화
  const userGradeNum = typeof userGrade === 'string' ? parseInt(userGrade, 10) : userGrade;
  const canAccessPlayer = userGradeNum === 1 || userGradeNum === 2 || userGradeNum === 3;
  const canAccessCoach = userGradeNum === 1 || userGradeNum === 3;
  
  if (btnPlayer) {
    btnPlayer.disabled = !canAccessPlayer;
    if (canAccessPlayer) {
      btnPlayer.style.opacity = '1';
      btnPlayer.style.cursor = 'pointer';
    } else {
      btnPlayer.style.opacity = '0.5';
      btnPlayer.style.cursor = 'not-allowed';
    }
  }
  if (btnCoach) {
    btnCoach.disabled = !canAccessCoach;
    if (canAccessCoach) {
      btnCoach.style.opacity = '1';
      btnCoach.style.cursor = 'pointer';
    } else {
      btnCoach.style.opacity = '0.5';
      btnCoach.style.cursor = 'not-allowed';
    }
  }
}

/**
 * Training Room 비밀번호 확인 모달
 */
async function showTrainingRoomPasswordModal(roomTitle) {
  return new Promise((resolve) => {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('trainingRoomPasswordModal');
    if (existingModal) {
      existingModal.remove();
    }

    // 모달 생성
    const modal = document.createElement('div');
    modal.id = 'trainingRoomPasswordModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 style="display: flex; align-items: center; gap: 8px;">
            <img src="assets/img/lock.png" alt="비밀번호" style="width: 24px; height: 24px;" />
            비밀번호 확인
          </h3>
          <button class="modal-close" onclick="this.closest('.modal').remove(); resolve(false);">✖</button>
        </div>
        <div class="modal-body">
          <p class="schedule-password-modal-title">${escapeHtml(roomTitle || 'Training Room')}</p>
          <p class="schedule-password-modal-message">이 Training Room은 비밀번호로 보호되어 있습니다.</p>
          <div class="schedule-password-input-container">
            <input type="password" id="trainingRoomPasswordInput" class="schedule-password-input" placeholder="비밀번호를 입력하세요" autofocus />
          </div>
          <div class="schedule-password-error" id="trainingRoomPasswordError" style="display: none;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary btn-with-icon schedule-password-confirm-btn">
            <img src="assets/img/save.png" alt="확인" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
            확인
          </button>
          <button class="btn btn-secondary btn-default-style schedule-password-cancel-btn">
            <img src="assets/img/cancel2.png" alt="취소" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
            취소
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const passwordInput = document.getElementById('trainingRoomPasswordInput');
    const errorDiv = document.getElementById('trainingRoomPasswordError');
    const cancelBtn = modal.querySelector('.schedule-password-cancel-btn');
    const confirmBtn = modal.querySelector('.schedule-password-confirm-btn');

    // 취소 버튼
    cancelBtn.addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    // 확인 버튼
    const handleConfirm = () => {
      const enteredPassword = passwordInput.value.trim();
      if (!enteredPassword) {
        errorDiv.textContent = '비밀번호를 입력해주세요.';
        errorDiv.style.display = 'block';
        passwordInput.focus();
        return;
      }

      // 저장된 비밀번호와 비교 (문자열로 변환하여 비교)
      const correctPassword = currentSelectedTrainingRoom && currentSelectedTrainingRoom.password != null
        ? String(currentSelectedTrainingRoom.password).trim()
        : '';

      if (enteredPassword === correctPassword) {
        modal.remove();
        resolve(true);
      } else {
        errorDiv.textContent = '비밀번호가 일치하지 않습니다.';
        errorDiv.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
        errorDiv.style.animation = 'shake 0.3s ease';
        setTimeout(() => {
          errorDiv.style.animation = '';
        }, 300);
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);

    // Enter 키로 확인
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleConfirm();
      }
    });

    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    });

    // 포커스
    setTimeout(() => passwordInput.focus(), 100);
  });
}

/**
 * Player List 화면 열기
 */
async function openPlayerList() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Player List 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('playerListScreen');
  }

  // Player List 렌더링
  await renderPlayerList();
}

/**
 * Player List 렌더링 (트랙1~10)
 */
async function renderPlayerList() {
  const playerListContent = document.getElementById('playerListContent');
  if (!playerListContent) return;

  // 로딩 표시
  playerListContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">트랙 정보를 불러오는 중...</p>
    </div>
  `;

  // 트랙1~10 초기화
  const tracks = [];
  for (let i = 1; i <= 10; i++) {
    tracks.push({
      trackNumber: i,
      userId: null,
      userName: null
    });
  }

  // Training Room id 가져오기 (여러 경로에서 확인)
  let roomId = null;
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
    roomId = currentSelectedTrainingRoom.id;
  } else if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
    roomId = String(window.currentTrainingRoomId);
  } else if (typeof localStorage !== 'undefined') {
    try {
      const storedRoomId = localStorage.getItem('currentTrainingRoomId');
      if (storedRoomId) {
        roomId = storedRoomId;
      }
    } catch (e) {
      console.warn('[Player List] localStorage 접근 실패:', e);
    }
  }

  // Training Room의 트랙별 사용자 정보 가져오기
  if (roomId) {
    console.log('[Player List] 트랙 정보 로드 시작, roomId:', roomId);
    try {
      const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
      console.log('[Player List] API 호출 URL:', url);
      const response = await fetch(url);
      const result = await response.json();
      
      console.log('[Player List] API 응답:', result);
      
      if (result.success && result.tracks && Array.isArray(result.tracks)) {
        console.log('[Player List] 트랙 데이터 수:', result.tracks.length);
        // 트랙 정보 업데이트
        result.tracks.forEach(apiTrack => {
          const trackNumber = parseInt(apiTrack.trackNumber, 10);
          if (!isNaN(trackNumber) && trackNumber >= 1 && trackNumber <= 10) {
            const track = tracks[trackNumber - 1];
            if (track) {
              track.userId = apiTrack.userId || null;
              track.userName = apiTrack.userName || null;
              if (track.userName) {
                console.log(`[Player List] 트랙 ${trackNumber} 업데이트: ${track.userName}${track.userId ? ` (ID: ${track.userId})` : ' (ID: 없음)'}`);
              }
            }
          }
        });
        console.log('[Player List] 트랙 정보 업데이트 완료');
      } else {
        console.warn('[Player List] API 응답이 예상과 다릅니다:', result);
      }
    } catch (error) {
      console.error('[Player List] 트랙 정보 로드 오류:', error);
      // 오류가 발생해도 빈 상태로 표시 계속
    }
  } else {
    console.warn('[Player List] room id를 찾을 수 없어 트랙 정보를 로드할 수 없습니다.');
    console.log('[Player List] currentSelectedTrainingRoom:', currentSelectedTrainingRoom);
    console.log('[Player List] window.currentTrainingRoomId:', window.currentTrainingRoomId);
    console.log('[Player List] localStorage currentTrainingRoomId:', localStorage.getItem('currentTrainingRoomId'));
  }

  // Training Room id를 room 파라미터로 전달 (firebaseConfig.js에서 SESSION_ID로 사용)
  roomId = roomId || null;
  
  // roomId를 컨테이너에 data attribute로 저장 (버튼 클릭 시 사용)
  if (playerListContent && roomId) {
    playerListContent.setAttribute('data-room-id', String(roomId));
  }

  playerListContent.innerHTML = tracks.map(track => {
    // userName이 있으면 사용자가 할당된 것으로 판단 (userId가 null이어도 표시 가능)
    const hasUser = !!track.userName;
    const dashboardUrl = roomId 
      ? `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}&room=${roomId}`
      : `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}`;

    return `
      <div class="player-track-item" data-track-number="${track.trackNumber}" data-room-id="${roomId || ''}">
        <div class="player-track-number">
          트랙${track.trackNumber}
        </div>
        <div class="player-track-name ${hasUser ? 'has-user' : 'no-user'}">
          ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
        </div>
        <div class="player-track-action">
          <button 
            class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
            onclick="assignUserToTrack(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}')"
            title="사용자 할당/변경">
            <span>${hasUser ? '변경' : '할당'}</span>
          </button>
          ${hasUser ? `
            <button 
              class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
              onclick="removeUserFromTrack(${track.trackNumber}, '${roomId || ''}')"
              title="사용자 제거">
              <span>제거</span>
            </button>
          ` : ''}
          <a href="${dashboardUrl}" 
             target="_blank"
             class="btn btn-primary btn-default-style btn-with-icon player-enter-btn ${!hasUser ? 'disabled' : ''}"
             ${!hasUser ? 'aria-disabled="true" tabindex="-1"' : ''}>
            <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" />
            <span>Enter</span>
          </a>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Coach 모드 열기 (Indoor 모드 선택 화면으로 이동)
 */
function openCoachMode() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Indoor 모드 선택 화면으로 이동
  if (typeof showIndoorModeSelectionModal === 'function') {
    showIndoorModeSelectionModal();
  }
}

// ========== Training Room 모달 관련 함수 ==========

/**
 * Training Room 모달 열기
 */
async function showTrainingRoomModal() {
  const modal = document.getElementById('trainingRoomModal');
  if (!modal) {
    console.error('[Training Room Modal] 모달 요소를 찾을 수 없습니다.');
    return;
  }

  // 모달 표시
  modal.classList.remove('hidden');

  // 모달 초기화
  initializeTrainingRoomModal();

  // Training Room 목록 로드
  await loadTrainingRoomsForModal();
}

/**
 * Training Room 모달 닫기
 */
function closeTrainingRoomModal() {
  const modal = document.getElementById('trainingRoomModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // 모달 초기화
  initializeTrainingRoomModal();
}

/**
 * Training Room 모달 초기화
 */
function initializeTrainingRoomModal() {
  // 선택된 Training Room 정보 초기화
  currentSelectedTrainingRoom = null;
  const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
  if (selectedSection) {
    selectedSection.style.display = 'none';
  }

  // 버튼 비활성화
  const btnPlayer = document.getElementById('btnPlayerModal');
  const btnCoach = document.getElementById('btnCoachModal');
  if (btnPlayer) {
    btnPlayer.disabled = true;
    btnPlayer.style.opacity = '0.5';
    btnPlayer.style.cursor = 'not-allowed';
  }
  if (btnCoach) {
    btnCoach.disabled = true;
    btnCoach.style.opacity = '0.5';
    btnCoach.style.cursor = 'not-allowed';
  }
}

/**
 * 모달용 Training Room 목록 로드
 * id, user_id, title, password 정보를 가져옴
 */
async function loadTrainingRoomsForModal() {
  const listContainer = document.getElementById('trainingRoomModalList');
  if (!listContainer) {
    console.error('[Training Room Modal] 목록 컨테이너를 찾을 수 없습니다.');
    return;
  }

  // 로딩 표시
  listContainer.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">Training Room 목록을 불러오는 중...</p>
    </div>
  `;

  try {
    // 구글시트에서 TrainingSchedules 목록 가져오기
    // 응답 데이터: { id, user_id, title, password, ... }
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Training Room 목록을 불러오는데 실패했습니다');
    }

    trainingRoomList = result.items || [];
    
    // 데이터 구조 확인 (디버깅용)
    if (trainingRoomList.length > 0) {
      console.log('[Training Room Modal] 로드된 Room 데이터 구조:', trainingRoomList[0]);
      console.log('[Training Room Modal] 각 Room 정보:', trainingRoomList.map(room => ({
        id: room.id,
        user_id: room.user_id || room.userId,
        title: room.title,
        hasPassword: !!(room.password && String(room.password).trim() !== '')
      })));
    }
    
    if (trainingRoomList.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <p style="color: #666;">등록된 Training Room이 없습니다.</p>
        </div>
      `;
      return;
    }

    // 목록 렌더링
    renderTrainingRoomListForModal(trainingRoomList);
  } catch (error) {
    console.error('[Training Room Modal] 목록 로드 오류:', error);
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <p style="color: #dc3545;">오류: ${error.message}</p>
      </div>
    `;
  }
}

/**
 * 모달용 Training Room 목록 렌더링
 */
function renderTrainingRoomListForModal(rooms) {
  const listContainer = document.getElementById('trainingRoomModalList');
  if (!listContainer) return;

  // 사용자 목록 가져오기 (window.users 또는 window.userProfiles)
  const users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);

  listContainer.innerHTML = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    
    // user_id로 코치 이름 찾기
    const userId = room.user_id || room.userId;
    const coach = userId ? users.find(u => String(u.id) === String(userId)) : null;
    const coachName = coach ? coach.name : '';
    
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           onclick="selectTrainingRoomForModal('${room.id}')"
           style="padding: 16px; background: white; border: 2px solid #e0e0e0; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; position: relative; display: flex; align-items: flex-start; gap: 12px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px;">
            <h3 style="margin: 0; color: #333; font-size: 1.1em; flex: 1;">${escapeHtml(room.title)}</h3>
            ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" style="width: 16px; height: 16px; opacity: 0.6; margin-left: 8px; flex-shrink: 0;" />
            ` : ''}
          </div>
          <p style="margin: 0; color: #666; font-size: 0.85em;">
            ${room.totalWeeks ? `${room.totalWeeks}주 프로그램` : 'Training Room'}${coachName ? ` · Coach: ${escapeHtml(coachName)}` : ''}
          </p>
        </div>
        ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
      </div>
    `;
  }).join('');

  // CSS 스타일 추가 (일별 워크아웃 지정 화면과 동일한 선택 효과)
  // trainingRoomCardStyle이 이미 존재하면 업데이트, 없으면 추가
  let style = document.getElementById('trainingRoomCardStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'trainingRoomCardStyle';
    document.head.appendChild(style);
  }
  style.textContent = `
    .training-room-card:hover {
      border-color: #2e74e8 !important;
      box-shadow: 0 4px 12px rgba(46, 116, 232, 0.15);
      transform: translateY(-2px);
    }
    .training-room-card.selected {
      border-color: #2e74e8 !important;
      background: #e8f2ff !important;
      box-shadow: 0 0 0 2px rgba(46, 116, 232, 0.1) !important;
    }
    .training-room-check {
      width: 24px;
      height: 24px;
      background: #2e74e8;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      flex-shrink: 0;
      margin-left: 8px;
    }
  `;
}

/**
 * 모달에서 Training Room 선택
 * Room 목록 선택 시 비밀번호 유무에 따라:
 * - 비밀번호 없는 Training Room: 체크되고 Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 * - 비밀번호 설정 Room: 비밀번호 확인 팝업창 뜨고 비밀번호 확인
 * - 비밀번호 확인 성공 > Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 */
async function selectTrainingRoomForModal(roomId) {
  // roomId를 숫자로 변환 (문자열로 전달될 수 있음)
  const roomIdNum = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
  const room = trainingRoomList.find(r => r.id == roomIdNum || String(r.id) === String(roomIdNum));
  if (!room) {
    console.error('[Training Room Modal] 선택한 방을 찾을 수 없습니다:', roomId, '타입:', typeof roomId, '변환:', roomIdNum);
    console.error('[Training Room Modal] 현재 목록:', trainingRoomList.map(r => ({ id: r.id, type: typeof r.id })));
    return;
  }

  console.log('[Training Room Modal] 선택한 Room 정보:', {
    id: room.id,
    user_id: room.user_id || room.userId,
    title: room.title,
    hasPassword: !!(room.password && String(room.password).trim() !== '')
  });

  // 사용자 등급 확인 (grade=1 관리자, grade=3 코치)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;
  const isCoach = userGrade === '3' || userGrade === 3;

  // 비밀번호 유무 확인
  const hasPassword = room.password && String(room.password).trim() !== '';
  
  // 비밀번호 확인을 위해 임시로 room 저장
  const previousRoom = currentSelectedTrainingRoom;
  currentSelectedTrainingRoom = room;
  
  // 비밀번호가 있는 경우: 비밀번호 확인 팝업창 표시 (관리자는 제외)
  if (hasPassword && !isAdmin) {
    console.log('[Training Room Modal] 비밀번호 확인 필요');
    // 비밀번호 확인 모달 표시
    const passwordCorrect = await showTrainingRoomPasswordModal(room.title);
    if (!passwordCorrect) {
      // 비밀번호가 틀리면 이전 상태로 복원
      console.log('[Training Room Modal] 비밀번호 확인 실패');
      currentSelectedTrainingRoom = previousRoom;
      return;
    }
    console.log('[Training Room Modal] 비밀번호 확인 성공');
  } else if (hasPassword && isAdmin) {
    console.log('[Training Room Modal] 관리자는 비밀번호 확인 생략');
  } else {
    console.log('[Training Room Modal] 비밀번호가 없는 Room');
  }

  // 선택된 Training Room 저장 (비밀번호 확인 완료 또는 비밀번호 없음)
  // 전역 변수 및 localStorage에 room id 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room Modal] window.SESSION_ID 업데이트:', window.SESSION_ID);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
    } catch (e) {
      console.warn('[Training Room Modal] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room Modal] Room ID 저장됨:', room.id);

  // 선택된 카드 하이라이트 (체크마크 추가/제거)
  const modalListContainer = document.getElementById('trainingRoomModalList');
  if (modalListContainer) {
    modalListContainer.querySelectorAll('.training-room-card').forEach(card => {
      card.classList.remove('selected');
      
      // 기존 체크마크 제거
      const existingCheck = card.querySelector('.training-room-check');
      if (existingCheck) {
        existingCheck.remove();
      }
      
      // 선택된 카드에 체크마크 추가
      if (card.dataset.roomId == roomIdNum || card.dataset.roomId === String(roomIdNum)) {
        card.classList.add('selected');
        if (!card.querySelector('.training-room-check')) {
          const checkMark = document.createElement('div');
          checkMark.className = 'training-room-check';
          checkMark.textContent = '✓';
          card.appendChild(checkMark);
        }
      }
    });
  }

  // 선택된 Training Room 정보 표시
  const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
  const selectedTitle = document.getElementById('selectedTrainingRoomModalTitle');
  const btnPlayer = document.getElementById('btnPlayerModal');
  const btnCoach = document.getElementById('btnCoachModal');

  if (selectedSection && selectedTitle) {
    selectedTitle.textContent = room.title;
    selectedSection.style.display = 'block';
  }

  // 비밀번호 확인 성공 후 버튼 활성화
  // Player 버튼: grade=1,2,3 활성화
  // Coach 버튼: grade=1,3만 활성화
  const userGradeNum = typeof userGrade === 'string' ? parseInt(userGrade, 10) : userGrade;
  const canAccessPlayer = userGradeNum === 1 || userGradeNum === 2 || userGradeNum === 3;
  const canAccessCoach = userGradeNum === 1 || userGradeNum === 3;
  
  console.log('[Training Room Modal] 버튼 활성화:', { 
    userGrade, 
    userGradeNum,
    canAccessPlayer, 
    canAccessCoach, 
    isAdmin, 
    isCoach 
  });
  
  if (btnPlayer) {
    btnPlayer.disabled = !canAccessPlayer;
    if (canAccessPlayer) {
      btnPlayer.style.opacity = '1';
      btnPlayer.style.cursor = 'pointer';
    } else {
      btnPlayer.style.opacity = '0.5';
      btnPlayer.style.cursor = 'not-allowed';
    }
  }
  if (btnCoach) {
    btnCoach.disabled = !canAccessCoach;
    if (canAccessCoach) {
      btnCoach.style.opacity = '1';
      btnCoach.style.cursor = 'pointer';
    } else {
      btnCoach.style.opacity = '0.5';
      btnCoach.style.cursor = 'not-allowed';
    }
  }
}

/**
 * 모달에서 Player List 화면 열기
 */
async function openPlayerListFromModal() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // 모달 닫기
  closeTrainingRoomModal();

  // Player List 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('playerListScreen');
  }

  // Player List 렌더링
  await renderPlayerList();
}

/**
 * 모달에서 Coach 모드 열기 (Indoor 모드 선택 화면으로 이동)
 */
function openCoachModeFromModal() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // 모달 닫기
  closeTrainingRoomModal();

  // Indoor 모드 선택 화면으로 이동
  if (typeof showIndoorModeSelectionModal === 'function') {
    showIndoorModeSelectionModal();
  }
}

/**
 * Training Room 화면 초기화
 */
function initializeTrainingRoomScreen() {
  // Training Room 목록 로드
  loadTrainingRooms();

  // 선택된 Training Room 정보 초기화
  currentSelectedTrainingRoom = null;
  const selectedSection = document.getElementById('selectedTrainingRoomSection');
  if (selectedSection) {
    selectedSection.style.display = 'none';
  }

  // 버튼 비활성화
  const btnPlayer = document.getElementById('btnPlayer');
  const btnCoach = document.getElementById('btnCoach');
  if (btnPlayer) {
    btnPlayer.disabled = true;
    btnPlayer.style.opacity = '0.5';
    btnPlayer.style.cursor = 'not-allowed';
  }
  if (btnCoach) {
    btnCoach.disabled = true;
    btnCoach.style.opacity = '0.5';
    btnCoach.style.cursor = 'not-allowed';
  }
}

/**
 * HTML 이스케이프 유틸리티
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 트랙에 사용자 할당
 */
async function assignUserToTrack(trackNumber, currentUserId, roomIdParam) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    // 파라미터로 전달되지 않았으면 전역 변수 확인
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    // data attribute에서 가져오기 시도
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[assignUserToTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);

  // 사용자 목록 가져오기
  let users = [];
  try {
    if (typeof apiGetUsers === 'function') {
      const result = await apiGetUsers();
      if (result && result.success && result.items) {
        users = result.items;
      }
    } else if (Array.isArray(window.users)) {
      users = window.users;
    } else {
      // 사용자 목록이 없으면 로드 시도
      if (typeof loadUsers === 'function') {
        await loadUsers();
        users = Array.isArray(window.users) ? window.users : [];
      }
    }
  } catch (error) {
    console.error('[assignUserToTrack] 사용자 목록 로드 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 목록을 불러올 수 없습니다.', 'error');
    }
    return;
  }

  if (users.length === 0) {
    if (typeof showToast === 'function') {
      showToast('등록된 사용자가 없습니다.', 'error');
    }
    return;
  }

  // 사용자 선택 모달 생성
  const modalId = 'trackUserSelectModal';
  let modal = document.getElementById(modalId);
  
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal';
    modal.style.position = 'fixed';
    modal.style.zIndex = '10000';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    document.body.appendChild(modal);
  }

  const userListHtml = users.map(user => `
    <div class="user-select-item" 
         style="padding: 12px; margin: 8px 0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: ${currentUserId === String(user.id) ? '#e3f2fd' : '#fff'};"
         onclick="selectUserForTrack(${trackNumber}, ${user.id}, '${escapeHtml(user.name || '')}', '${roomId}')">
      <div style="font-weight: bold; margin-bottom: 4px;">${escapeHtml(user.name || '이름 없음')}</div>
      <div style="font-size: 0.9em; color: #666;">FTP: ${user.ftp || '-'}W | 체중: ${user.weight || '-'}kg</div>
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">트랙${trackNumber} 사용자 할당</h2>
      <div style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
        ${userListHtml}
      </div>
      <div style="text-align: right;">
        <button onclick="closeTrackUserSelectModal()" 
                style="padding: 8px 16px; background: #ccc; border: none; border-radius: 4px; cursor: pointer;">
          취소
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  
  // 모달 외부 클릭 시 닫기
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeTrackUserSelectModal();
    }
  };
}

/**
 * 트랙에서 사용자 제거
 */
async function removeUserFromTrack(trackNumber, roomIdParam) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[removeUserFromTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);

  if (!confirm(`트랙${trackNumber}에서 사용자를 제거하시겠습니까?`)) {
    return;
  }

  try {
    const url = `${window.GAS_URL}?action=updateTrainingRoomUser&roomId=${roomId}&trackNumber=${trackNumber}&userId=`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.success) {
      if (typeof showToast === 'function') {
        showToast('사용자가 제거되었습니다.', 'success');
      }
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      if (typeof showToast === 'function') {
        showToast('사용자 제거 실패: ' + (result.error || 'Unknown error'), 'error');
      }
    }
  } catch (error) {
    console.error('[removeUserFromTrack] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 제거 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 트랙에 선택된 사용자 할당 실행
 */
async function selectUserForTrack(trackNumber, userId, userName, roomIdParam) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[selectUserForTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);

  try {
    const url = `${window.GAS_URL}?action=updateTrainingRoomUser&roomId=${roomId}&trackNumber=${trackNumber}&userId=${userId}`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.success) {
      if (typeof showToast === 'function') {
        showToast(`트랙${trackNumber}에 ${userName}이(가) 할당되었습니다.`, 'success');
      }
      // 모달 닫기
      closeTrackUserSelectModal();
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      if (typeof showToast === 'function') {
        showToast('사용자 할당 실패: ' + (result.error || 'Unknown error'), 'error');
      }
    }
  } catch (error) {
    console.error('[selectUserForTrack] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 할당 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 사용자 선택 모달 닫기
 */
function closeTrackUserSelectModal() {
  const modal = document.getElementById('trackUserSelectModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Firebase에 저장된 트랙별 사용자 정보 확인 (디버깅용)
 * 브라우저 콘솔에서 checkFirebaseTrackUsers(roomId) 호출 가능
 */
async function checkFirebaseTrackUsers(roomId) {
  if (!roomId) {
    // roomId가 없으면 현재 선택된 room id 사용
    roomId = currentSelectedTrainingRoom?.id 
      || window.currentTrainingRoomId 
      || localStorage.getItem('currentTrainingRoomId')
      || window.SESSION_ID;
  }
  
  if (!roomId) {
    console.error('[Firebase 확인] room id를 찾을 수 없습니다.');
    console.log('사용법: checkFirebaseTrackUsers("room_id_값")');
    return;
  }
  
  console.log(`[Firebase 확인] Room ID: ${roomId}`);
  console.log(`[Firebase 확인] Firebase URL: https://stelvio-ai-default-rtdb.firebaseio.com/sessions/${roomId}/users.json`);
  
  try {
    const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success) {
      console.log('[Firebase 확인] ✅ 데이터 조회 성공');
      console.log('[Firebase 확인] 트랙별 사용자 정보:', result.tracks);
      
      // 상세 정보 출력
      const tracksWithUsers = result.tracks.filter(t => t.userId && t.userName);
      if (tracksWithUsers.length > 0) {
        console.log('[Firebase 확인] 할당된 트랙:');
        tracksWithUsers.forEach(track => {
          console.log(`  트랙${track.trackNumber}: ${track.userName} (ID: ${track.userId})`);
        });
      } else {
        console.log('[Firebase 확인] ⚠️ 할당된 사용자가 없습니다.');
      }
      
      return result;
    } else {
      console.error('[Firebase 확인] ❌ 데이터 조회 실패:', result.error);
      return result;
    }
  } catch (error) {
    console.error('[Firebase 확인] ❌ 오류 발생:', error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Firebase에 직접 접근하여 원시 데이터 확인 (디버깅용)
 * 브라우저 콘솔에서 checkFirebaseRawData(roomId) 호출 가능
 */
async function checkFirebaseRawData(roomId) {
  if (!roomId) {
    roomId = currentSelectedTrainingRoom?.id 
      || window.currentTrainingRoomId 
      || localStorage.getItem('currentTrainingRoomId')
      || window.SESSION_ID;
  }
  
  if (!roomId) {
    console.error('[Firebase 원시 데이터 확인] room id를 찾을 수 없습니다.');
    return;
  }
  
  const firebaseUrl = `https://stelvio-ai-default-rtdb.firebaseio.com/sessions/${roomId}/users.json`;
  console.log(`[Firebase 원시 데이터 확인] URL: ${firebaseUrl}`);
  
  try {
    const response = await fetch(firebaseUrl);
    const data = await response.json();
    
    console.log('[Firebase 원시 데이터 확인] ✅ 원시 데이터:', data);
    
    if (data) {
      console.log('[Firebase 원시 데이터 확인] 트랙별 상세 정보:');
      Object.keys(data).forEach(trackNumber => {
        const trackData = data[trackNumber];
        console.log(`  트랙 ${trackNumber}:`, trackData);
      });
    } else {
      console.log('[Firebase 원시 데이터 확인] ⚠️ 데이터가 없습니다.');
    }
    
    return data;
  } catch (error) {
    console.error('[Firebase 원시 데이터 확인] ❌ 오류 발생:', error);
    return null;
  }
}

// 전역 함수 노출
if (typeof window !== 'undefined') {
  window.loadTrainingRooms = loadTrainingRooms;
  window.selectTrainingRoom = selectTrainingRoom;
  window.openPlayerList = openPlayerList;
  window.openCoachMode = openCoachMode;
  window.initializeTrainingRoomScreen = initializeTrainingRoomScreen;
  window.showTrainingRoomPasswordModal = showTrainingRoomPasswordModal;
  // 모달 관련 함수
  window.showTrainingRoomModal = showTrainingRoomModal;
  window.closeTrainingRoomModal = closeTrainingRoomModal;
  window.selectTrainingRoomForModal = selectTrainingRoomForModal;
  window.openPlayerListFromModal = openPlayerListFromModal;
  window.openCoachModeFromModal = openCoachModeFromModal;
  // 트랙 사용자 할당 관련 함수
  window.assignUserToTrack = assignUserToTrack;
  window.removeUserFromTrack = removeUserFromTrack;
  window.selectUserForTrack = selectUserForTrack;
  window.closeTrackUserSelectModal = closeTrackUserSelectModal;
  // 디버깅 함수
  window.checkFirebaseTrackUsers = checkFirebaseTrackUsers;
  window.checkFirebaseRawData = checkFirebaseRawData;
}

