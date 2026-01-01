/**
 * Training Room Manager
 * INDOOR RACE Training Room 생성 및 관리 로직
 */

// 전역 변수
let currentSelectedTrainingRoom = null;
let trainingRoomList = [];

/**
 * Training Room 목록 로드
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
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Training Room 목록을 불러오는데 실패했습니다');
    }

    trainingRoomList = result.items || [];
    
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

  listContainer.innerHTML = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    return `
      <div class="training-room-card" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           onclick="selectTrainingRoom('${room.id}')"
           style="padding: 20px; background: white; border: 2px solid #e0e0e0; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; position: relative;">
        ${hasPassword ? `
          <div style="position: absolute; top: 10px; right: 10px;">
            <img src="assets/img/lock.png" alt="비밀번호" style="width: 20px; height: 20px; opacity: 0.6;" />
          </div>
        ` : ''}
        <h3 style="margin: 0 0 10px 0; color: #333; font-size: 1.2em;">${escapeHtml(room.title)}</h3>
        <p style="margin: 0; color: #666; font-size: 0.9em;">
          ${room.totalWeeks ? `${room.totalWeeks}주 프로그램` : 'Training Room'}
        </p>
      </div>
    `;
  }).join('');

  // CSS 스타일 추가 (hover 효과)
  const style = document.createElement('style');
  style.textContent = `
    .training-room-card:hover {
      border-color: #667eea !important;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }
    .training-room-card.selected {
      border-color: #667eea !important;
      background: #f0f4ff !important;
    }
  `;
  if (!document.getElementById('trainingRoomCardStyle')) {
    style.id = 'trainingRoomCardStyle';
    document.head.appendChild(style);
  }
}

/**
 * Training Room 선택
 */
async function selectTrainingRoom(roomId) {
  const room = trainingRoomList.find(r => r.id === roomId);
  if (!room) {
    console.error('[Training Room] 선택한 방을 찾을 수 없습니다:', roomId);
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

  // 선택된 카드 하이라이트
  document.querySelectorAll('.training-room-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.roomId === roomId) {
      card.classList.add('selected');
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

  // Player/Coach 버튼 활성화 (grade=1 or 3일 때)
  const canAccess = isAdmin || userGrade === '3' || userGrade === 3;
  if (btnPlayer) {
    btnPlayer.disabled = !canAccess;
    if (canAccess) {
      btnPlayer.style.opacity = '1';
      btnPlayer.style.cursor = 'pointer';
    } else {
      btnPlayer.style.opacity = '0.5';
      btnPlayer.style.cursor = 'not-allowed';
    }
  }
  if (btnCoach) {
    btnCoach.disabled = !canAccess;
    if (canAccess) {
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
function openPlayerList() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Player List 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('playerListScreen');
  }

  // Player List 렌더링
  renderPlayerList();
}

/**
 * Player List 렌더링 (트랙1~10)
 */
function renderPlayerList() {
  const playerListContent = document.getElementById('playerListContent');
  if (!playerListContent) return;

  // 트랙1~10 생성
  const tracks = [];
  for (let i = 1; i <= 10; i++) {
    tracks.push({
      trackNumber: i,
      userId: null,
      userName: null
    });
  }

  // TODO: Firebase에서 현재 참여자 목록 가져오기
  // 현재는 빈 상태로 표시

  playerListContent.innerHTML = tracks.map(track => {
    const hasUser = track.userId && track.userName;
    const roomCode = currentSelectedTrainingRoom ? `sk_${currentSelectedTrainingRoom.id}` : 'default';
    const dashboardUrl = `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}&room=${roomCode}`;

    return `
      <div class="player-track-item" style="display: flex; align-items: center; gap: 16px; padding: 16px; margin-bottom: 12px; background: white; border: 2px solid #e0e0e0; border-radius: 12px;">
        <div style="flex: 0 0 80px; text-align: center; font-weight: bold; color: #667eea; font-size: 1.2em;">
          트랙${track.trackNumber}
        </div>
        <div style="flex: 1; color: ${hasUser ? '#333' : '#999'};">
          ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
        </div>
        <div>
          <a href="${dashboardUrl}" 
             target="_blank"
             class="btn btn-primary btn-default-style btn-with-icon ${!hasUser ? 'disabled' : ''}"
             style="${!hasUser ? 'opacity: 0.5; cursor: not-allowed; pointer-events: none;' : ''}">
            <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
            Enter
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

// 전역 함수 노출
if (typeof window !== 'undefined') {
  window.loadTrainingRooms = loadTrainingRooms;
  window.selectTrainingRoom = selectTrainingRoom;
  window.openPlayerList = openPlayerList;
  window.openCoachMode = openCoachMode;
  window.initializeTrainingRoomScreen = initializeTrainingRoomScreen;
  window.showTrainingRoomPasswordModal = showTrainingRoomPasswordModal;
}

