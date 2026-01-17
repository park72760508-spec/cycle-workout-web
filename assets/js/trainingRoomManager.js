/**
 * Training Room Manager
 * INDOOR RACE Training Room 생성 및 관리 로직
 */

// 전역 변수
let currentSelectedTrainingRoom = null;
let trainingRoomList = [];
// 비밀번호 인증된 Training Room ID 추적 (재인증 방지)
// 인증된 Training Room 관리 (메모리 + sessionStorage)
let authenticatedTrainingRooms = new Set();
// 디바이스 연결 방식: 'ant' 또는 'bluetooth' (기본값: 'bluetooth')
let deviceConnectionMode = 'bluetooth';

// sessionStorage에서 인증 상태 복원
function restoreAuthenticatedRooms() {
  try {
    const stored = sessionStorage.getItem('authenticatedTrainingRooms');
    if (stored) {
      const roomIds = JSON.parse(stored);
      authenticatedTrainingRooms = new Set(roomIds);
      console.log('[Training Room] 인증 상태 복원:', Array.from(authenticatedTrainingRooms));
    }
  } catch (e) {
    console.warn('[Training Room] 인증 상태 복원 실패:', e);
  }
}

// sessionStorage에 인증 상태 저장
function saveAuthenticatedRooms() {
  try {
    const roomIds = Array.from(authenticatedTrainingRooms);
    sessionStorage.setItem('authenticatedTrainingRooms', JSON.stringify(roomIds));
    console.log('[Training Room] 인증 상태 저장:', roomIds);
  } catch (e) {
    console.warn('[Training Room] 인증 상태 저장 실패:', e);
  }
}

// 초기화 시 인증 상태 복원
restoreAuthenticatedRooms();

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

    // 사용자 목록 가져오기 (Users 테이블에서)
    let users = [];
    try {
      if (typeof window.apiGetUsers === 'function') {
        const usersResult = await window.apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else if (typeof apiGetUsers === 'function') {
        const usersResult = await apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else {
        console.warn('[Training Room] apiGetUsers 함수를 찾을 수 없습니다.');
      }
    } catch (userError) {
      console.error('[Training Room] 사용자 목록 로드 오류:', userError);
    }

    // 목록 렌더링 (사용자 목록과 함께)
    renderTrainingRoomList(trainingRoomList, users);
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
 * @param {Array} rooms - Training Room 목록
 * @param {Array} users - 사용자 목록 (옵션)
 */
function renderTrainingRoomList(rooms, users = []) {
  const listContainer = document.getElementById('trainingRoomList');
  if (!listContainer) return;

  // 사용자 목록이 파라미터로 전달되지 않았으면 전역 변수에서 가져오기
  if (!users || users.length === 0) {
    users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
  }

  listContainer.innerHTML = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    
    // user_id로 코치 이름 찾기 (Users 테이블의 id와 매칭)
    const userId = room.user_id || room.userId;
    let coachName = '';
    
    if (userId && users.length > 0) {
      const coach = users.find(u => {
        const userIdStr = String(userId);
        const userStr = String(u.id || '');
        return userIdStr === userStr;
      });
      coachName = coach ? (coach.name || '') : '';
      
      // 디버깅 로그
      if (!coachName && userId) {
        console.log(`[Training Room] Coach를 찾을 수 없음 - user_id: ${userId}, users 배열 길이: ${users.length}`);
        if (users.length > 0) {
          console.log('[Training Room] 사용자 ID 목록:', users.map(u => u.id).slice(0, 5));
        }
      }
    }
    
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           onclick="selectTrainingRoom('${room.id}')"
           style="cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;">
        <div class="training-room-content">
          <div class="training-room-name-section">
            <div class="training-room-name ${room.title ? 'has-name' : 'no-name'}">
              ${room.title ? escapeHtml(room.title) : '훈련방 이름 없음'}
            </div>
            ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" class="training-room-lock-icon" />
            ` : ''}
          </div>
          <div class="training-room-coach-section">
            <div class="training-room-coach ${coachName ? 'has-coach' : 'no-coach'}">
              ${coachName ? `Manager: ${escapeHtml(coachName)}` : '코치 없음'}
            </div>
          </div>
        </div>
        ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
      </div>
    `;
  }).join('');

  // 모바일 터치 이벤트를 위한 명시적 이벤트 리스너 추가
  // 모든 카드에 터치 이벤트 리스너 추가 (모바일에서 onclick이 작동하지 않을 수 있음)
  setTimeout(() => {
    document.querySelectorAll('.training-room-card').forEach(card => {
      // 기존 터치 이벤트 리스너 제거 (중복 방지)
      if (card._cardTouchHandler) {
        card.removeEventListener('touchend', card._cardTouchHandler);
        card._cardTouchHandler = null;
      }
      
      const roomId = card.getAttribute('data-room-id');
      if (roomId) {
        // 터치 이벤트 핸들러 추가 (모바일용)
        const cardTouchHandler = (e) => {
          // 슬라이드 스위치 컨테이너나 버튼 영역을 터치한 경우 무시
          if (e.target.closest('.device-connection-switch-container') || 
              e.target.closest('.training-room-action-buttons')) {
            return;
          }
          
          // 카드 영역을 터치한 경우에만 Room 선택
          e.stopPropagation();
          selectTrainingRoom(roomId);
        };
        
        card.addEventListener('touchend', cardTouchHandler, { passive: true });
        card._cardTouchHandler = cardTouchHandler;
      }
    });
  }, 0);

  // CSS는 style.css에 정의되어 있음 (동적 스타일 추가 불필요)
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
  
  // 이미 선택된 카드인지 확인 (다른 Room 선택 시에는 계속 진행)
  const targetCard = document.querySelector(`.training-room-card[data-room-id="${roomIdNum}"]`);
  const currentlySelectedCard = document.querySelector('.training-room-card.selected');
  const isSameRoom = currentlySelectedCard && 
                     currentlySelectedCard.getAttribute('data-room-id') === String(roomIdNum);
  
  if (isSameRoom) {
    // 같은 Room을 다시 선택한 경우에만 중복 실행 방지
    const contentDiv = targetCard.querySelector('.training-room-content');
    if (contentDiv && 
        contentDiv.querySelector('.device-connection-switch-container') && 
        contentDiv.querySelector('.training-room-action-buttons')) {
      console.log('[Training Room] 이미 선택된 Room입니다:', roomIdNum);
      return;
    }
  }

  // 비밀번호 확인 (grade=1 관리자는 제외)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;

  const hasPassword = room.password && String(room.password).trim() !== '';
  
  if (hasPassword && !isAdmin) {
    // 비밀번호 확인 모달 표시 (room 객체 전달)
    const passwordCorrect = await showTrainingRoomPasswordModal(room.title, room);
    if (!passwordCorrect) {
      return; // 비밀번호가 틀리면 중단
    }
  }

  // 선택된 Training Room 저장
  currentSelectedTrainingRoom = room;
  
  // 전역 변수 및 localStorage에 room id와 이름 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    window.currentTrainingRoomName = room.name || room.title || room.Name || room.roomName || null;
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room] window.SESSION_ID 업데이트:', window.SESSION_ID);
    console.log('[Training Room] window.currentTrainingRoomName 저장:', window.currentTrainingRoomName);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
      if (room.name || room.title || room.Name || room.roomName) {
        localStorage.setItem('currentTrainingRoomName', room.name || room.title || room.Name || room.roomName);
      }
    } catch (e) {
      console.warn('[Training Room] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room] Room ID 저장됨:', room.id);

  // 모든 카드에서 선택 상태 및 버튼 제거
  document.querySelectorAll('.training-room-card').forEach(card => {
    card.classList.remove('selected');
    
    // 기존 체크마크 제거
    const existingCheck = card.querySelector('.training-room-check');
    if (existingCheck) {
      existingCheck.remove();
    }
    
    // 기존 슬라이드 스위치 컨테이너 제거 (이벤트 리스너도 정리)
    const existingSwitchContainer = card.querySelector('.device-connection-switch-container');
    if (existingSwitchContainer) {
      if (existingSwitchContainer._switchContainerClickHandler) {
        existingSwitchContainer.removeEventListener('click', existingSwitchContainer._switchContainerClickHandler);
        existingSwitchContainer._switchContainerClickHandler = null;
      }
      if (existingSwitchContainer._switchContainerTouchHandler) {
        existingSwitchContainer.removeEventListener('touchstart', existingSwitchContainer._switchContainerTouchHandler);
        existingSwitchContainer._switchContainerTouchHandler = null;
      }
      if (existingSwitchContainer._switchContainerTouchEndHandler) {
        existingSwitchContainer.removeEventListener('touchend', existingSwitchContainer._switchContainerTouchEndHandler);
        existingSwitchContainer._switchContainerTouchEndHandler = null;
      }
      existingSwitchContainer.remove();
    }
    
    // 기존 버튼 제거 (이벤트 리스너도 정리)
    const existingButtons = card.querySelector('.training-room-action-buttons');
    if (existingButtons) {
      if (existingButtons._buttonClickHandler) {
        existingButtons.removeEventListener('click', existingButtons._buttonClickHandler);
        existingButtons._buttonClickHandler = null;
      }
      if (existingButtons._buttonTouchHandler) {
        existingButtons.removeEventListener('touchstart', existingButtons._buttonTouchHandler);
        existingButtons._buttonTouchHandler = null;
      }
      existingButtons.remove();
    }
    
    // contentDiv의 이벤트 리스너 정리는 더 이상 필요 없음 (리스너를 추가하지 않으므로)
  });
  
  // 선택된 카드에 체크마크 및 버튼 추가
  const selectedCard = document.querySelector(`.training-room-card[data-room-id="${roomIdNum}"]`);
  if (selectedCard) {
    selectedCard.classList.add('selected');
    
    // 체크마크 추가
    if (!selectedCard.querySelector('.training-room-check')) {
      const checkMark = document.createElement('div');
      checkMark.className = 'training-room-check';
      checkMark.textContent = '✓';
      selectedCard.appendChild(checkMark);
    }
    
    // 버튼 추가
    const contentDiv = selectedCard.querySelector('.training-room-content');
    if (contentDiv && !contentDiv.querySelector('.training-room-action-buttons') && !contentDiv.querySelector('.device-connection-switch-container')) {
      // 사용자 등급 확인
      const userGradeNum = typeof userGrade === 'string' ? parseInt(userGrade, 10) : userGrade;
      const canAccessPlayer = userGradeNum === 1 || userGradeNum === 2 || userGradeNum === 3;
      const canAccessCoach = userGradeNum === 1 || userGradeNum === 3;
      
      // 디바이스 연결 방식 스위치 추가 (Player/Coach 버튼 위에)
      const switchContainer = document.createElement('div');
      switchContainer.className = 'device-connection-switch-container';
      switchContainer.style.cssText = 'margin-bottom: 10px; display: flex; flex-direction: column; align-items: center; gap: 0; width: 100%;';
      // 컨테이너 전체 클릭 시 이벤트 전파 차단 (중복 리스너 방지)
      // 슬라이드 스위치 요소 자체를 클릭한 경우에만 슬라이드가 동작하도록 함
      if (switchContainer._switchContainerClickHandler) {
        switchContainer.removeEventListener('click', switchContainer._switchContainerClickHandler);
        switchContainer.removeEventListener('touchstart', switchContainer._switchContainerTouchHandler);
      }
      
      const switchContainerClickHandler = (e) => {
        // 슬라이드 스위치 요소 자체를 클릭한 경우에만 이벤트 전파 차단 (슬라이드 동작 허용)
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          // 슬라이드 스위치를 클릭한 경우 - 이벤트 전파 차단하여 부모 카드의 selectTrainingRoom 방지
          // 하지만 슬라이드 스위치 자체의 이벤트 핸들러는 동작하도록 함
          e.stopPropagation();
        }
        // 슬라이드 스위치가 아닌 영역(label 등)을 클릭한 경우 이벤트 전파 허용하여 카드 선택 가능
      };
      switchContainer.addEventListener('click', switchContainerClickHandler);
      switchContainer._switchContainerClickHandler = switchContainerClickHandler;
      
      // 모바일 터치 이벤트도 처리
      const switchContainerTouchHandler = (e) => {
        // 슬라이드 스위치 요소 자체를 터치한 경우에만 이벤트 전파 차단
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          e.stopPropagation();
        }
        // 슬라이드 스위치가 아닌 영역(label 등)을 터치한 경우 이벤트 전파 허용하여 카드 선택 가능
        // 하지만 컨테이너 자체는 카드 선택을 방지 (touchend에서 처리)
      };
      switchContainer.addEventListener('touchstart', switchContainerTouchHandler, { passive: true });
      switchContainer._switchContainerTouchHandler = switchContainerTouchHandler;
      
      // touchend도 처리하여 카드 선택 방지
      const switchContainerTouchEndHandler = (e) => {
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          e.stopPropagation();
        }
      };
      switchContainer.addEventListener('touchend', switchContainerTouchEndHandler, { passive: true });
      switchContainer._switchContainerTouchEndHandler = switchContainerTouchEndHandler;
      switchContainer.innerHTML = `
        <label style="font-size: 14px; color: #666; font-weight: 500;">디바이스 연결 방식</label>
        <div class="device-connection-switch" id="deviceConnectionSwitchScreen" style="position: relative; width: 200px; height: 50px; background: #e0e0e0; border-radius: 25px; cursor: pointer; transition: background 0.3s ease;">
          <!-- Bluetooth 옵션 (왼쪽) -->
          <div class="switch-option switch-option-left" data-mode="bluetooth" style="position: absolute; left: 0; top: 0; width: 50%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 25px 0 0 25px; transition: all 0.3s ease; z-index: 2;">
            <img src="assets/img/wifi.png" alt="Bluetooth" style="width: 32px; height: 32px; object-fit: contain;" />
          </div>
          <!-- ANT+ 옵션 (오른쪽) -->
          <div class="switch-option switch-option-right" data-mode="ant" style="position: absolute; right: 0; top: 0; width: 50%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 0 25px 25px 0; transition: all 0.3s ease; z-index: 2;">
            <img src="assets/img/antlogo.png" alt="ANT+" style="width: 32px; height: 32px; object-fit: contain;" />
          </div>
          <!-- 슬라이더 (움직이는 부분) -->
          <div class="switch-slider" id="switchSliderScreen" style="position: absolute; left: 50%; top: 0; width: 50%; height: 100%; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 25px; transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3); z-index: 3;"></div>
        </div>
      `;
      contentDiv.appendChild(switchContainer);
      
      // 스위치 초기화 (일반 화면용)
      setTimeout(() => {
        initializeDeviceConnectionSwitchForScreen();
      }, 100);
      
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'training-room-action-buttons';
      // 버튼 영역 클릭 시 이벤트 전파 차단 (중복 리스너 방지)
      if (buttonsDiv._buttonClickHandler) {
        buttonsDiv.removeEventListener('click', buttonsDiv._buttonClickHandler);
        buttonsDiv.removeEventListener('touchstart', buttonsDiv._buttonTouchHandler);
      }
      
      const buttonClickHandler = (e) => {
        e.stopPropagation();
      };
      buttonsDiv.addEventListener('click', buttonClickHandler);
      buttonsDiv._buttonClickHandler = buttonClickHandler;
      
      // 모바일 터치 이벤트도 처리
      const buttonTouchHandler = (e) => {
        e.stopPropagation();
      };
      buttonsDiv.addEventListener('touchstart', buttonTouchHandler, { passive: true });
      buttonsDiv._buttonTouchHandler = buttonTouchHandler;
      
      buttonsDiv.innerHTML = `
        <button class="btn btn-primary btn-default-style btn-with-icon training-room-btn-player ${!canAccessPlayer ? 'disabled' : ''}" 
                data-room-id="${room.id}" 
                onclick="event.stopPropagation(); if (typeof openPlayerList === 'function') { openPlayerList(); }"
                ${!canAccessPlayer ? 'disabled' : ''}
                style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;">
          <img src="assets/img/personals.png" alt="Player" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
          Player
        </button>
        <button class="btn btn-success btn-default-style btn-with-icon training-room-btn-coach ${!canAccessCoach ? 'disabled' : ''}" 
                data-room-id="${room.id}" 
                onclick="event.stopPropagation(); if (typeof openCoachMode === 'function') { openCoachMode(); }"
                ${!canAccessCoach ? 'disabled' : ''}
                style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;">
          <img src="assets/img/personal.png" alt="Coach" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
          Coach
        </button>
      `;
      contentDiv.appendChild(buttonsDiv);
      
      // contentDiv에는 이벤트 리스너를 추가하지 않음
      // 카드 자체의 onclick이 정상 작동하도록 함
      // 슬라이드 스위치와 버튼 영역의 이벤트 리스너가 각각 stopPropagation을 호출하여 충분함
      
      // 버튼 스타일 적용 및 모바일 터치 이벤트 추가 (DOM에 추가된 후 실행)
      setTimeout(() => {
        const btnPlayer = buttonsDiv.querySelector('.training-room-btn-player');
        const btnCoach = buttonsDiv.querySelector('.training-room-btn-coach');
        
        if (btnPlayer) {
          if (!canAccessPlayer) {
            btnPlayer.style.opacity = '0.5';
            btnPlayer.style.cursor = 'not-allowed';
          } else {
            btnPlayer.style.opacity = '1';
            btnPlayer.style.cursor = 'pointer';
            
            // 모바일 터치 이벤트 추가 (중복 방지)
            if (btnPlayer._buttonTouchHandler) {
              btnPlayer.removeEventListener('touchend', btnPlayer._buttonTouchHandler);
            }
            
            const playerTouchHandler = (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (typeof openPlayerList === 'function') {
                openPlayerList();
              }
            };
            btnPlayer.addEventListener('touchend', playerTouchHandler, { passive: false });
            btnPlayer._buttonTouchHandler = playerTouchHandler;
          }
        }
        if (btnCoach) {
          if (!canAccessCoach) {
            btnCoach.style.opacity = '0.5';
            btnCoach.style.cursor = 'not-allowed';
          } else {
            btnCoach.style.opacity = '1';
            btnCoach.style.cursor = 'pointer';
            
            // 모바일 터치 이벤트 추가 (중복 방지)
            if (btnCoach._buttonTouchHandler) {
              btnCoach.removeEventListener('touchend', btnCoach._buttonTouchHandler);
            }
            
            const coachTouchHandler = (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (typeof openCoachMode === 'function') {
                openCoachMode();
              }
            };
            btnCoach.addEventListener('touchend', coachTouchHandler, { passive: false });
            btnCoach._buttonTouchHandler = coachTouchHandler;
          }
        }
      }, 0);
    }
  }
}

/**
 * Training Room 비밀번호 확인 모달
 * @param {string} roomTitle - Training Room 제목
 * @param {object} room - Training Room 객체 (비밀번호 포함)
 */
async function showTrainingRoomPasswordModal(roomTitle, room = null) {
  return new Promise((resolve) => {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('trainingRoomPasswordModal');
    if (existingModal) {
      existingModal.remove();
    }

    // room 객체가 전달되지 않으면 currentSelectedTrainingRoom 사용
    const targetRoom = room || currentSelectedTrainingRoom;
    
    // 비밀번호 가져오기 (숫자/문자 모두 문자열로 변환)
    const correctPassword = targetRoom && targetRoom.password != null
      ? String(targetRoom.password).trim()
      : '';

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
      // 입력된 비밀번호를 문자열로 변환하고 공백 제거
      const enteredPassword = String(passwordInput.value || '').trim();
      
      if (!enteredPassword) {
        errorDiv.textContent = '비밀번호를 입력해주세요.';
        errorDiv.style.display = 'block';
        passwordInput.focus();
        return;
      }

      // 디버깅 로그 (개발 환경에서만)
      if (typeof console !== 'undefined' && console.log) {
        console.log('[비밀번호 확인] 입력값:', enteredPassword, '타입:', typeof enteredPassword);
        console.log('[비밀번호 확인] 저장값:', correctPassword, '타입:', typeof correctPassword);
        console.log('[비밀번호 확인] 비교 결과:', enteredPassword === correctPassword);
      }

      // 저장된 비밀번호와 비교 (양쪽 모두 문자열로 변환하여 비교)
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

  // Bluetooth 모드인지 확인
  if (deviceConnectionMode === 'bluetooth') {
    // Bluetooth 모드: Bluetooth Join Session 화면으로 이동
    await openBluetoothPlayerList();
  } else {
    // ANT+ 모드: 기존 Player List 화면으로 이동
    if (typeof showScreen === 'function') {
      showScreen('playerListScreen');
    }
    // Player List 렌더링
    await renderPlayerList();
  }
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
      userName: null,
      weight: null,
      ftp: null,
      gear: null,
      brake: null
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

  // Training Room의 트랙별 사용자 정보 및 디바이스 정보 가져오기
  if (roomId) {
    console.log('[Player List] 트랙 정보 로드 시작, roomId:', roomId);
    try {
      // 1. 사용자 정보 가져오기 (API 또는 Firebase 직접)
      if (typeof db !== 'undefined') {
        // Firebase에서 직접 가져오기
        const sessionId = roomId;
        
        // users 정보 가져오기
        const usersRef = db.ref(`sessions/${sessionId}/users`);
        const usersSnapshot = await usersRef.once('value');
        const usersData = usersSnapshot.val() || {};
        
        // devices 정보 가져오기
        const devicesRef = db.ref(`sessions/${sessionId}/devices`);
        const devicesSnapshot = await devicesRef.once('value');
        const devicesData = devicesSnapshot.val() || {};
        
        console.log('[Player List] Firebase users 데이터:', usersData);
        console.log('[Player List] Firebase devices 데이터:', devicesData);
        
        // 트랙 정보 업데이트
        for (let i = 1; i <= 10; i++) {
          const track = tracks[i - 1];
          const userData = usersData[i];
          const deviceData = devicesData[i];
          
          if (userData) {
            track.userId = userData.userId || null;
            track.userName = userData.userName || null;
            track.weight = userData.weight || null;
            track.ftp = userData.ftp || null;
          }
          
          if (deviceData) {
            // Gear (새 필드명 우선, 기존 필드명 호환)
            track.gear = deviceData.gear || 
                        deviceData['gear'] ||
                        deviceData['Gear'] || 
                        deviceData.Gear || 
                        null;
            
            // Brake (새 필드명 우선, 기존 필드명 호환)
            track.brake = deviceData.brake || 
                         deviceData['brake'] ||
                         deviceData['Brake'] || 
                         deviceData.Brake || 
                         null;
            
            // 디바이스 ID 정보
            track.smartTrainerId = deviceData.smartTrainerId || 
                                  deviceData['smartTrainerId'] ||
                                  deviceData['Smart Trainer id'] || 
                                  deviceData.trainerDeviceId || 
                                  null;
            track.powerMeterId = deviceData.powerMeterId || 
                                deviceData['powerMeterId'] ||
                                deviceData['Power Meter id'] || 
                                deviceData.deviceId || 
                                null;
            track.heartRateId = deviceData.heartRateId || 
                               deviceData['heartRateId'] ||
                               deviceData['Heart Rate id'] || 
                               deviceData.heartRateDeviceId || 
                               null;
          }
        }
      } else {
        // API로 가져오기 (기존 방식)
        const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
        console.log('[Player List] API 호출 URL:', url);
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.tracks && Array.isArray(result.tracks)) {
          result.tracks.forEach((apiTrack) => {
            const trackNumber = parseInt(apiTrack.trackNumber, 10);
            if (!isNaN(trackNumber) && trackNumber >= 1 && trackNumber <= 10) {
              const track = tracks[trackNumber - 1];
              if (track) {
                track.userId = apiTrack.userId || null;
                track.userName = apiTrack.userName || null;
                track.weight = apiTrack.weight || null;
                track.ftp = apiTrack.ftp || null;
                track.gear = apiTrack.gear || null;
                track.brake = apiTrack.brake || null;
                track.smartTrainerId = apiTrack.smartTrainerId || apiTrack.trainerDeviceId || null;
                track.powerMeterId = apiTrack.powerMeterId || apiTrack.deviceId || null;
                track.heartRateId = apiTrack.heartRateId || apiTrack.heartRateDeviceId || null;
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('[Player List] ❌ 트랙 정보 로드 오류:', error);
      console.error('[Player List] 오류 스택:', error.stack);
      // 오류가 발생해도 빈 상태로 표시 계속
    }
  } else {
    console.warn('[Player List] ⚠️ room id를 찾을 수 없어 트랙 정보를 로드할 수 없습니다.');
  }

  // Training Room id를 room 파라미터로 전달 (firebaseConfig.js에서 SESSION_ID로 사용)
  roomId = roomId || null;
  
  // roomId를 컨테이너에 data attribute로 저장 (버튼 클릭 시 사용)
  if (playerListContent && roomId) {
    playerListContent.setAttribute('data-room-id', String(roomId));
  }

  // 현재 사용자 정보 확인 (권한 체크용)
  let currentUser = null;
  let currentUserId = null;
  let userGrade = '2';
  let isAdmin = false;
  
  try {
    currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.id != null) {
      currentUserId = String(currentUser.id);
    }
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
  } catch (e) {
    console.error('[Player List] 현재 사용자 정보 확인 오류:', e);
  }

  // grade=2 사용자가 본인 계정으로 참가된 트랙이 있는지 확인
  let hasMyTrack = false;
  if (!isAdmin && currentUserId) {
    hasMyTrack = tracks.some(track => {
      const trackUserId = track.userId ? String(track.userId) : null;
      return trackUserId && trackUserId === currentUserId;
    });
  }

  playerListContent.innerHTML = tracks.map(track => {
    // userName이 있으면 사용자가 할당된 것으로 판단 (userId가 null이어도 표시 가능)
    const hasUser = !!track.userName;
    
    // 권한 체크 로직
    const trackUserId = track.userId ? String(track.userId) : null;
    let canModify = false;
    let canParticipate = false;
    
    if (isAdmin || userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3) {
      // grade=1,3 사용자는 모든 트랙에 대해 변경/삭제/Enter 가능
      canModify = true;
      canParticipate = true;
    } else if (userGrade === '2' || userGrade === 2) {
      // grade=2 사용자
      if (trackUserId && trackUserId === currentUserId) {
        // 본인 계정으로 참가된 트랙: 변경/취소/입장 버튼 활성화
        canModify = true;
        canParticipate = true;
      } else if (!hasUser && !hasMyTrack) {
        // 사용자 없음 트랙이고, 본인 계정으로 참가된 트랙이 없으면: 신청 버튼만 활성화
        canParticipate = true;
        canModify = false;
      } else {
        // 그 외의 경우: 비활성화
        canModify = false;
        canParticipate = false;
      }
    }
    
    const dashboardUrl = roomId 
      ? `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}&room=${roomId}`
      : `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}`;

    // Gear/Brake 아이콘 생성
    let gearIcon = '';
    let brakeIcon = '';
    
    if (track.gear) {
      if (track.gear === '11단' || track.gear === '11') {
        gearIcon = '<img src="assets/img/g11.png" alt="11단" class="device-icon" />';
      } else if (track.gear === '12단' || track.gear === '12') {
        gearIcon = '<img src="assets/img/g12.png" alt="12단" class="device-icon" />';
      }
    }
    
    if (track.brake) {
      if (track.brake === '디스크' || track.brake === 'Disc') {
        brakeIcon = '<img src="assets/img/d.png" alt="디스크" class="device-icon" />';
      } else if (track.brake === '림' || track.brake === 'Rim') {
        brakeIcon = '<img src="assets/img/r.png" alt="림" class="device-icon" />';
      }
    }
    
    // 디바이스 아이콘 생성 (심박계, 스마트로라, 파워메터는 배경색만 적용, 기어/브레이크는 배경 없음)
    const deviceIcons = [];
    if (track.heartRateId || track.heartRateDeviceId) {
      deviceIcons.push('<img src="assets/img/bpm_g.png" alt="심박계" class="device-icon-with-bg" title="심박계" />');
    }
    if (track.smartTrainerId || track.trainerDeviceId) {
      deviceIcons.push('<img src="assets/img/trainer_g.png" alt="스마트트레이너" class="device-icon-with-bg" title="스마트트레이너" />');
    }
    if (track.powerMeterId || track.deviceId) {
      deviceIcons.push('<img src="assets/img/power_g.png" alt="파워메터" class="device-icon-with-bg" title="파워메터" />');
    }
    if (gearIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="기어">${gearIcon}</span>`);
    }
    if (brakeIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="브레이크">${brakeIcon}</span>`);
    }
    const deviceIconsHtml = deviceIcons.length > 0 ? deviceIcons.join('') : '';
    
    return `
      <div class="player-track-item" data-track-number="${track.trackNumber}" data-room-id="${roomId || ''}">
        <div class="player-track-number-fixed">
          <div class="player-track-number-header">
            트랙${track.trackNumber}
          </div>
        </div>
        <div class="player-track-content">
          <div class="player-track-user-section">
            <div class="player-track-name ${hasUser ? 'has-user' : 'no-user'}">
              ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
            </div>
            ${deviceIconsHtml ? `<div class="player-track-devices-right">${deviceIconsHtml}</div>` : ''}
          </div>
          <div class="player-track-action">
            ${canModify || canParticipate ? `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                onclick="assignUserToTrackWithAnimation(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}', event)"
                title="훈련 신청/변경">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            ` : `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                disabled
                title="${!isAdmin && hasUser ? '본인이 할당한 트랙만 변경 가능합니다' : '훈련 신청/변경'}">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            `}
            ${hasUser && canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                onclick="removeUserFromTrackWithAnimation(${track.trackNumber}, '${roomId || ''}', event)"
                title="훈련 참가 퇴실">
                <span>퇴실</span>
              </button>
            ` : hasUser && !canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                disabled
                title="본인이 할당한 트랙만 퇴실 가능합니다">
                <span>퇴실</span>
              </button>
            ` : ''}
            <a href="${dashboardUrl}" 
               target="_blank"
               class="btn btn-primary btn-default-style btn-with-icon player-enter-btn ${!hasUser || !canModify ? 'disabled' : ''}"
               ${!hasUser || !canModify ? 'aria-disabled="true" tabindex="-1"' : ''}
               onclick="handlePlayerEnterClick(event, ${track.trackNumber}, '${roomId || ''}')"
               title="${!hasUser ? '사용자가 할당되지 않았습니다' : (!canModify ? '본인이 할당한 트랙만 입장 가능합니다' : '훈련 시작')}">
              <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" />
              <span>Enter</span>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 일괄 퇴실 버튼 표시 여부 (grade=1,3만 표시)
  const btnClearAllTracks = document.getElementById('btnClearAllTracks');
  if (btnClearAllTracks) {
    if (isAdmin || userGrade === '3' || userGrade === 3) {
      btnClearAllTracks.style.display = 'inline-flex';
    } else {
      btnClearAllTracks.style.display = 'none';
    }
  }
}

/**
 * Coach 모드 열기 (메인 화면용)
 */
function openCoachMode() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // 현재 모드 확인
  let mode = window.deviceConnectionMode || sessionStorage.getItem('deviceConnectionMode') || 'bluetooth';

  if (mode === 'bluetooth') {
    // Bluetooth 모드이면 바로 코치 화면으로
    if (typeof showScreen === 'function') {
        showScreen('bluetoothTrainingCoachScreen');
    }
  } else {
    // ANT+ 모드이면 모드 선택(Race/Training) 모달 띄우기
    if (typeof showIndoorModeSelectionModal === 'function') {
      showIndoorModeSelectionModal();
    }
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
  
  // 선택된 Room이 있으면 스위치 초기화 (약간의 지연을 두어 DOM이 완전히 렌더링된 후 실행)
  setTimeout(() => {
    const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
    const switchElement = document.getElementById('deviceConnectionSwitch');
    
    console.log('[Training Room Modal] 모달 열림 후 스위치 확인:', {
      selectedSection: !!selectedSection,
      selectedSectionDisplay: selectedSection ? selectedSection.style.display : 'null',
      switchElement: !!switchElement
    });
    
    if (selectedSection && selectedSection.style.display !== 'none') {
      console.log('[Training Room Modal] 선택된 Room 섹션이 표시되어 있음, 스위치 초기화');
      initializeDeviceConnectionSwitch();
    } else if (currentSelectedTrainingRoom) {
      // currentSelectedTrainingRoom이 있으면 섹션을 표시하고 스위치 초기화
      console.log('[Training Room Modal] currentSelectedTrainingRoom이 있음, 섹션 표시 및 스위치 초기화');
      if (selectedSection) {
        const selectedTitle = document.getElementById('selectedTrainingRoomModalTitle');
        if (selectedTitle) {
          selectedTitle.textContent = currentSelectedTrainingRoom.title || currentSelectedTrainingRoom.name || 'Training Room';
        }
        selectedSection.style.display = 'block';
        
        setTimeout(() => {
          initializeDeviceConnectionSwitch();
        }, 100);
      }
    }
  }, 300);
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
  
  // 참고: authenticatedTrainingRooms는 초기화하지 않음 (세션 동안 유지)
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

    // 사용자 목록 가져오기 (Users 테이블에서)
    let users = [];
    try {
      if (typeof window.apiGetUsers === 'function') {
        const usersResult = await window.apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room Modal] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else if (typeof apiGetUsers === 'function') {
        const usersResult = await apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room Modal] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else {
        console.warn('[Training Room Modal] apiGetUsers 함수를 찾을 수 없습니다.');
      }
    } catch (userError) {
      console.error('[Training Room Modal] 사용자 목록 로드 오류:', userError);
    }

    // 목록 렌더링 (사용자 목록과 함께)
    renderTrainingRoomListForModal(trainingRoomList, users);
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
 * @param {Array} rooms - Training Room 목록
 * @param {Array} users - 사용자 목록 (옵션)
 */
function renderTrainingRoomListForModal(rooms, users = []) {
  const listContainer = document.getElementById('trainingRoomModalList');
  if (!listContainer) return;

  // 사용자 목록이 파라미터로 전달되지 않았으면 전역 변수에서 가져오기
  if (!users || users.length === 0) {
    users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
  }

  // 사용자 등급 확인 (인증 상태 체크용)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;

  // 기존 이벤트 리스너 제거 (중복 방지)
  const existingCapturingHandler = listContainer._trainingRoomCapturingHandler;
  const existingClickHandler = listContainer._trainingRoomClickHandler;
  if (existingCapturingHandler) {
    listContainer.removeEventListener('click', existingCapturingHandler, true);
  }
  if (existingClickHandler) {
    listContainer.removeEventListener('click', existingClickHandler, false);
  }

  listContainer.innerHTML = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    const roomIdStr = String(room.id);
    
    // 이미 선택되고 인증된 카드인지 확인
    const isAuthenticated = isSelected && (
      !hasPassword || 
      isAdmin || 
      authenticatedTrainingRooms.has(roomIdStr)
    );
    
    // user_id로 코치 이름 찾기 (Users 테이블의 id와 매칭)
    const userId = room.user_id || room.userId;
    let coachName = '';
    
    if (userId && users.length > 0) {
      const coach = users.find(u => {
        const userIdStr = String(userId);
        const userStr = String(u.id || '');
        return userIdStr === userStr;
      });
      coachName = coach ? (coach.name || '') : '';
      
      // 디버깅 로그
      if (!coachName && userId) {
        console.log(`[Training Room Modal] Coach를 찾을 수 없음 - user_id: ${userId}, users 배열 길이: ${users.length}`);
      }
    }
    
    // [Module 2] 인증된 카드에는 verified-room 클래스도 추가
    // sessionStorage에서도 체크하여 인증 상태 복원
    let finalIsAuthenticated = isAuthenticated;
    if (!finalIsAuthenticated) {
      try {
        const stored = sessionStorage.getItem('authenticatedTrainingRooms');
        if (stored) {
          const roomIds = JSON.parse(stored);
          finalIsAuthenticated = roomIds.includes(roomIdStr);
          if (finalIsAuthenticated && !authenticatedTrainingRooms.has(roomIdStr)) {
            // sessionStorage에만 있고 메모리에 없으면 메모리에도 추가
            authenticatedTrainingRooms.add(roomIdStr);
          }
        }
      } catch (e) {
        console.warn('[Training Room Modal] sessionStorage 체크 실패:', e);
      }
    }
    
    const verifiedClass = finalIsAuthenticated ? 'verified-room authenticated' : '';
    
    // onclick 속성 제거 - 이벤트 위임 사용
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''} ${verifiedClass}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           data-is-authenticated="${finalIsAuthenticated ? 'true' : 'false'}"
           style="${finalIsAuthenticated ? 'cursor: default; pointer-events: none;' : 'cursor: pointer;'}"
           ${finalIsAuthenticated ? 'onclick="return false;"' : ''}>
        <div class="training-room-content">
          <div class="training-room-name-section">
            <div class="training-room-name ${room.title ? 'has-name' : 'no-name'}">
              ${room.title ? escapeHtml(room.title) : '훈련방 이름 없음'}
            </div>
            ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" class="training-room-lock-icon" />
            ` : ''}
          </div>
          <div class="training-room-coach-section">
            <div class="training-room-coach ${coachName ? 'has-coach' : 'no-coach'}">
              ${coachName ? `Manager: ${escapeHtml(coachName)}` : '코치 없음'}
            </div>
          </div>
        </div>
        ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
      </div>
    `;
  }).join('');

  // ========== 최고 수준의 클릭 차단 로직 ==========
  // 1. Capturing phase에서 차단 (가장 먼저 실행)
  const capturingHandler = (e) => {
    const card = e.target.closest('.training-room-card');
    if (!card) return;
    
    const roomId = card.dataset.roomId;
    if (!roomId) return;
    
    // sessionStorage와 메모리 모두 체크
    const roomIdStr = String(roomId);
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isVerified = card.classList.contains('verified-room') || 
                      card.classList.contains('authenticated') ||
                      card.dataset.isAuthenticated === 'true' ||
                      isInMemory ||
                      isInStorage;
    
    if (isVerified) {
      // 버튼 클릭만 허용
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      
      if (!isButtonClick) {
        // 즉시 차단 (capturing phase에서)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[Training Room Modal] [CAPTURING] 인증된 방 클릭 차단:', roomIdStr);
        return false;
      }
    }
  };
  
  // 2. Bubbling phase에서도 차단 (이중 방어)
  const clickHandler = (e) => {
    // 선택된 섹션 영역 클릭 차단
    const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
    if (selectedSection && (selectedSection.contains(e.target) || e.target === selectedSection)) {
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      if (!isButtonClick) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      return;
    }

    // 카드 클릭 확인
    const card = e.target.closest('.training-room-card');
    if (!card) return;

    const roomId = card.dataset.roomId;
    if (!roomId) return;
    
    const roomIdStr = String(roomId);
    
    // 다중 체크: DOM 클래스, data 속성, 메모리, sessionStorage
    const hasVerifiedClass = card.classList.contains('verified-room') || 
                            card.classList.contains('authenticated');
    const hasVerifiedAttr = card.dataset.isAuthenticated === 'true';
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isVerified = hasVerifiedClass || hasVerifiedAttr || isInMemory || isInStorage;
    
    if (isVerified) {
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      
      if (!isButtonClick) {
        console.log('[Training Room Modal] [BUBBLING] 인증된 방 클릭 차단:', {
          roomId: roomIdStr,
          hasVerifiedClass,
          hasVerifiedAttr,
          isInMemory,
          isInStorage
        });
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      return;
    }

    // 인증되지 않은 카드만 선택 처리
    console.log('[Training Room Modal] 인증되지 않은 카드 클릭, 선택 처리:', roomId);
    selectTrainingRoomForModal(roomId);
  };

  // Capturing phase 리스너 (가장 먼저 실행)
  listContainer.addEventListener('click', capturingHandler, true);
  // Bubbling phase 리스너 (이중 방어)
  listContainer.addEventListener('click', clickHandler, false);
  
  // 나중에 제거하기 위해 참조 저장
  listContainer._trainingRoomCapturingHandler = capturingHandler;
  listContainer._trainingRoomClickHandler = clickHandler;

  // CSS는 style.css에 정의되어 있음 (동적 스타일 추가 불필요)
}

/**
 * 모달에서 Training Room 선택
 * Room 목록 선택 시 비밀번호 유무에 따라:
 * - 비밀번호 없는 Training Room: 체크되고 Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 * - 비밀번호 설정 Room: 비밀번호 확인 팝업창 뜨고 비밀번호 확인
 * - 비밀번호 확인 성공 > Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 */
async function selectTrainingRoomForModal(roomId) {
  // ========== 최고 수준의 즉시 차단 로직 ==========
  // 함수 시작 즉시 인증 상태 체크 (가장 먼저 실행)
  const roomIdStr = String(roomId);
  
  // 메모리와 sessionStorage 모두 체크
  const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
  let isInStorage = false;
  try {
    const stored = sessionStorage.getItem('authenticatedTrainingRooms');
    if (stored) {
      const roomIds = JSON.parse(stored);
      isInStorage = roomIds.includes(roomIdStr);
    }
  } catch (e) {}
  
  // DOM에서도 체크
  const card = document.querySelector(`.training-room-card[data-room-id="${roomId}"]`);
  const isInDOM = card && (
    card.classList.contains('verified-room') ||
    card.classList.contains('authenticated') ||
    card.dataset.isAuthenticated === 'true'
  );
  
  // 이미 인증된 방이면 즉시 리턴 (함수 실행 자체를 차단)
  if (isInMemory || isInStorage || isInDOM) {
    console.log('[Training Room Modal] [즉시 차단] 이미 인증된 방입니다. 함수 실행 차단:', {
      roomId: roomIdStr,
      isInMemory,
      isInStorage,
      isInDOM
    });
    return;
  }
  
  // roomId를 숫자로 변환 (문자열로 전달될 수 있음)
  const roomIdNum = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
  const room = trainingRoomList.find(r => r.id == roomIdNum || String(r.id) === String(roomIdNum));
  if (!room) {
    console.error('[Training Room Modal] 선택한 방을 찾을 수 없습니다:', roomId, '타입:', typeof roomId, '변환:', roomIdNum);
    console.error('[Training Room Modal] 현재 목록:', trainingRoomList.map(r => ({ id: r.id, type: typeof r.id })));
    return;
  }

  // 사용자 등급 확인
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;
  const hasPassword = room.password && String(room.password).trim() !== '';

  // 이미 선택된 Training Room을 다시 클릭한 경우 처리
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id) {
    // 이미 선택된 Room이고 인증된 경우, 재인증 없이 바로 리턴
    if (hasPassword && !isAdmin) {
      if (authenticatedTrainingRooms.has(roomIdStr)) {
        console.log('[Training Room Modal] 이미 선택되고 인증된 Training Room입니다. 재선택 무시');
        return;
      }
    } else {
      console.log('[Training Room Modal] 이미 선택된 Training Room입니다. 재선택 무시');
      return;
    }
  }

  console.log('[Training Room Modal] 선택한 Room 정보:', {
    id: room.id,
    user_id: room.user_id || room.userId,
    title: room.title,
    hasPassword: !!(room.password && String(room.password).trim() !== ''),
    isAlreadyAuthenticated: authenticatedTrainingRooms.has(roomIdStr)
  });

  // 사용자 등급 확인 (grade=1 관리자, grade=3 코치)
  const isCoach = userGrade === '3' || userGrade === 3;
  
  // 비밀번호 확인을 위해 임시로 room 저장
  const previousRoom = currentSelectedTrainingRoom;
  currentSelectedTrainingRoom = room;
  
  // 비밀번호가 있는 경우: 비밀번호 확인 팝업창 표시 (관리자는 제외, 이미 인증된 경우 제외)
  if (hasPassword && !isAdmin) {
    // 이미 인증된 Training Room인지 확인
    if (authenticatedTrainingRooms.has(roomIdStr)) {
      console.log('[Training Room Modal] 이미 인증된 Training Room입니다. 재인증 생략');
    } else {
      console.log('[Training Room Modal] 비밀번호 확인 필요');
      // 비밀번호 확인 모달 표시 (room 객체 전달)
      const passwordCorrect = await showTrainingRoomPasswordModal(room.title, room);
      if (!passwordCorrect) {
        // 비밀번호가 틀리면 이전 상태로 복원
        console.log('[Training Room Modal] 비밀번호 확인 실패');
        currentSelectedTrainingRoom = previousRoom;
        // 카드 목록 다시 렌더링하여 onclick 복원
        const users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
        renderTrainingRoomListForModal(trainingRoomList, users);
        return;
      }
      // 비밀번호 확인 성공 시 인증된 Room 목록에 추가 (메모리 + sessionStorage)
      authenticatedTrainingRooms.add(roomIdStr);
      saveAuthenticatedRooms(); // sessionStorage에도 저장
      console.log('[Training Room Modal] 비밀번호 확인 성공, 인증 상태 저장 (메모리 + sessionStorage):', roomIdStr);
    }
  } else if (hasPassword && isAdmin) {
    console.log('[Training Room Modal] 관리자는 비밀번호 확인 생략');
  } else {
    console.log('[Training Room Modal] 비밀번호가 없는 Room');
  }

  // 선택된 Training Room 저장 (비밀번호 확인 완료 또는 비밀번호 없음)
  // 전역 변수 및 localStorage에 room id와 이름 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    window.currentTrainingRoomName = room.name || room.title || room.Name || room.roomName || null;
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room Modal] window.SESSION_ID 업데이트:', window.SESSION_ID);
    console.log('[Training Room Modal] window.currentTrainingRoomName 저장:', window.currentTrainingRoomName);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
      if (room.name || room.title || room.Name || room.roomName) {
        localStorage.setItem('currentTrainingRoomName', room.name || room.title || room.Name || room.roomName);
      }
    } catch (e) {
      console.warn('[Training Room Modal] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room Modal] Room ID 저장됨:', room.id);

  // 선택된 카드 하이라이트 및 인증 상태 업데이트 (재선택 방지)
  const modalListContainer = document.getElementById('trainingRoomModalList');
  if (modalListContainer) {
    // 메모리와 sessionStorage 모두 체크
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isAuthenticated = !hasPassword || isAdmin || isInMemory || isInStorage;
    
    modalListContainer.querySelectorAll('.training-room-card').forEach(card => {
      card.classList.remove('selected', 'authenticated', 'verified-room');
      
      // 기존 체크마크 제거
      const existingCheck = card.querySelector('.training-room-check');
      if (existingCheck) {
        existingCheck.remove();
      }
      
      // 선택된 카드 처리
      if (card.dataset.roomId == roomIdNum || card.dataset.roomId === String(roomIdNum)) {
        card.classList.add('selected');
        if (isAuthenticated) {
          // 인증 완료 시 verified-room 클래스 추가
          card.classList.add('authenticated', 'verified-room');
          // 인증된 카드는 data-is-authenticated 속성 업데이트하여 클릭 차단
          card.dataset.isAuthenticated = 'true';
          // 인증된 방은 클릭 가능한 느낌(포인터) 제거
          card.style.cursor = 'default';
          // onclick 속성 제거
          card.removeAttribute('onclick');
          card.onclick = null;
          
          // sessionStorage에도 저장 (혹시 모를 경우 대비)
          if (!isInMemory) {
            authenticatedTrainingRooms.add(roomIdStr);
            saveAuthenticatedRooms();
          }
          
          console.log('[Training Room Modal] 인증 완료: verified-room 상태 적용됨', {
            roomId: roomIdStr,
            hasVerifiedClass: card.classList.contains('verified-room'),
            hasAuthenticatedClass: card.classList.contains('authenticated'),
            isAuthenticatedAttr: card.dataset.isAuthenticated,
            isInMemory,
            isInStorage
          });
        }
        
        if (!card.querySelector('.training-room-check')) {
          const checkMark = document.createElement('div');
          checkMark.className = 'training-room-check';
          checkMark.textContent = '✓';
          card.appendChild(checkMark);
        }
      }
    });
  }
  
  // MutationObserver로 DOM 변경 감지하여 인증 상태 복원
  if (modalListContainer && !modalListContainer._authStateObserver) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          // 인증된 방의 상태 복원
          try {
            const stored = sessionStorage.getItem('authenticatedTrainingRooms');
            if (stored) {
              const roomIds = JSON.parse(stored);
              roomIds.forEach(roomId => {
                const card = modalListContainer.querySelector(`.training-room-card[data-room-id="${roomId}"]`);
                if (card && !card.classList.contains('verified-room')) {
                  card.classList.add('authenticated', 'verified-room');
                  card.dataset.isAuthenticated = 'true';
                  card.style.cursor = 'default';
                  card.removeAttribute('onclick');
                  card.onclick = null;
                }
              });
            }
          } catch (e) {
            console.warn('[Training Room Modal] MutationObserver 오류:', e);
          }
        }
      });
    });
    
    observer.observe(modalListContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-authenticated', 'class']
    });
    
    modalListContainer._authStateObserver = observer;
  }

  // 선택된 Training Room 정보 표시
  const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
  const selectedTitle = document.getElementById('selectedTrainingRoomModalTitle');
  const btnPlayer = document.getElementById('btnPlayerModal');
  const btnCoach = document.getElementById('btnCoachModal');
  
  console.log('[Training Room Modal] DOM 요소 확인:', {
    selectedSection: !!selectedSection,
    selectedTitle: !!selectedTitle,
    btnPlayer: !!btnPlayer,
    btnCoach: !!btnCoach,
    switchElement: !!document.getElementById('deviceConnectionSwitch')
  });

  // [추가 방어] 선택된 Training Room 섹션 영역에 클릭 이벤트 차단 추가
  if (selectedSection) {
    // 기존 핸들러 제거 (중복 방지)
    const existingSectionHandler = selectedSection._clickBlockHandler;
    if (existingSectionHandler) {
      selectedSection.removeEventListener('click', existingSectionHandler, true);
    }

    // 새로운 핸들러 추가 (캡처 단계에서 차단)
    const sectionClickHandler = (e) => {
      // 버튼 클릭은 허용
      if (e.target.tagName === 'BUTTON' || e.target.closest('button') || 
          e.target.id === 'btnPlayerModal' || e.target.id === 'btnCoachModal' ||
          e.target.closest('#btnPlayerModal') || e.target.closest('#btnCoachModal')) {
        return; // 버튼 클릭은 정상 처리
      }
      
      // 스위치 클릭도 허용
      if (e.target.id === 'deviceConnectionSwitch' || 
          e.target.closest('#deviceConnectionSwitch') ||
          e.target.id === 'switchSlider' ||
          e.target.closest('.device-connection-switch')) {
        return; // 스위치 클릭은 정상 처리
      }
      
      // 버튼이 아닌 영역 클릭 차단
      console.log('[Training Room Modal] 선택된 섹션 여백 클릭 차단 (섹션 핸들러)');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    
    selectedSection.addEventListener('click', sectionClickHandler, true); // 캡처 단계
    selectedSection._clickBlockHandler = sectionClickHandler;
  }

  if (selectedSection && selectedTitle) {
    selectedTitle.textContent = room.title;
    selectedSection.style.display = 'block';
    
    console.log('[Training Room Modal] 선택된 Room 섹션 표시:', room.title);
    console.log('[Training Room Modal] selectedSection.style.display:', selectedSection.style.display);
    
    // 디바이스 연결 방식 스위치 초기화 (약간의 지연을 두어 DOM이 완전히 렌더링된 후 실행)
    setTimeout(() => {
      const switchElement = document.getElementById('deviceConnectionSwitch');
      const switchContainer = document.querySelector('.device-connection-switch-container');
      console.log('[Training Room Modal] 스위치 요소 확인:', {
        switchElement: !!switchElement,
        switchContainer: !!switchContainer,
        selectedSectionDisplay: selectedSection ? selectedSection.style.display : 'null',
        selectedSectionVisible: selectedSection ? window.getComputedStyle(selectedSection).display : 'null'
      });
      
      if (switchElement) {
        console.log('[Training Room Modal] 스위치 요소 발견, 초기화 시작');
        initializeDeviceConnectionSwitch();
      } else {
        console.warn('[Training Room Modal] 스위치 요소를 찾을 수 없습니다. DOM이 아직 준비되지 않았을 수 있습니다.');
        console.warn('[Training Room Modal] selectedSection HTML:', selectedSection ? selectedSection.innerHTML.substring(0, 200) : 'null');
        // 재시도
        setTimeout(() => {
          const retrySwitch = document.getElementById('deviceConnectionSwitch');
          if (retrySwitch) {
            console.log('[Training Room Modal] 재시도: 스위치 초기화');
            initializeDeviceConnectionSwitch();
          } else {
            console.error('[Training Room Modal] 스위치 요소를 찾을 수 없습니다.');
            console.error('[Training Room Modal] selectedSection 전체 HTML:', selectedSection ? selectedSection.innerHTML : 'null');
          }
        }, 300);
      }
    }, 100);
  } else {
    console.error('[Training Room Modal] selectedSection 또는 selectedTitle을 찾을 수 없습니다:', {
      selectedSection: !!selectedSection,
      selectedTitle: !!selectedTitle
    });
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
 * 디바이스 연결 방식 스위치 초기화
 */
function initializeDeviceConnectionSwitch() {
  const switchElement = document.getElementById('deviceConnectionSwitch');
  const slider = document.getElementById('switchSlider');
  const labelAnt = document.getElementById('switchLabelAnt');
  const labelBluetooth = document.getElementById('switchLabelBluetooth');
  
  if (!switchElement || !slider) {
    console.warn('[Device Connection Switch] 스위치 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 기존 이벤트 리스너 제거 (중복 방지)
  if (switchElement._clickHandler) {
    switchElement.removeEventListener('click', switchElement._clickHandler);
  }
  if (switchElement._mouseDownHandler) {
    switchElement.removeEventListener('mousedown', switchElement._mouseDownHandler);
  }
  if (switchElement._mouseMoveHandler) {
    document.removeEventListener('mousemove', switchElement._mouseMoveHandler);
  }
  if (switchElement._mouseUpHandler) {
    document.removeEventListener('mouseup', switchElement._mouseUpHandler);
  }
  if (switchElement._touchStartHandler) {
    switchElement.removeEventListener('touchstart', switchElement._touchStartHandler);
  }
  if (switchElement._touchMoveHandler) {
    document.removeEventListener('touchmove', switchElement._touchMoveHandler);
  }
  if (switchElement._touchEndHandler) {
    document.removeEventListener('touchend', switchElement._touchEndHandler);
  }
  
  // 드래그 상태 추적 변수 (클로저로 관리)
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasMoved = false;
  let isProcessing = false; // 중복 실행 방지 플래그
  const DRAG_THRESHOLD = 5; // 픽셀 단위 드래그 임계값
  
  // 저장된 모드 복원 (없으면 기본값 'bluetooth')
  const savedMode = sessionStorage.getItem('deviceConnectionMode') || 'bluetooth';
  deviceConnectionMode = savedMode;
  
  // 전역 변수도 동기화
  window.deviceConnectionMode = deviceConnectionMode;
  
  // 스위치 상태 업데이트
  updateDeviceConnectionSwitch(deviceConnectionMode);
  
  console.log('[Device Connection Switch] 초기화 완료, 모드:', deviceConnectionMode);
  
  // 마우스 이벤트 핸들러
  const mouseDownHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging = false;
    hasMoved = false;
    isProcessing = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  };
  switchElement.addEventListener('mousedown', mouseDownHandler, { passive: false });
  switchElement._mouseDownHandler = mouseDownHandler;
  
  const mouseMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mousemove', mouseMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
      isDragging = true;
      hasMoved = true;
      // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('mousemove', mouseMoveHandler, { passive: false });
  switchElement._mouseMoveHandler = mouseMoveHandler;
  
  const mouseUpHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mouseup', mouseUpHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시 (다른 화면의 버튼 동작 방해 방지)
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    e.stopPropagation();
    e.preventDefault();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      hasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !hasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    hasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('mouseup', mouseUpHandler, { passive: false });
  switchElement._mouseUpHandler = mouseUpHandler;
  
  // 클릭 이벤트 핸들러 - 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
  const clickHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (switchElement && switchElement.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      // mouseup에서 이미 처리했으므로 여기서는 아무것도 하지 않음
    }
    // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
    return false;
  };
  switchElement.addEventListener('click', clickHandler, { passive: false });
  switchElement._clickHandler = clickHandler;
  
  // 터치 이벤트 핸들러 (모바일) - 드래그 상태 추적 변수 재사용
  let touchHasMoved = false;
  
  const touchStartHandler = (e) => {
    e.stopPropagation();
    isDragging = false;
    touchHasMoved = false;
    isProcessing = false;
    if (e.touches && e.touches.length > 0) {
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
    }
  };
  switchElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  switchElement._touchStartHandler = touchStartHandler;
  
  const touchMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchmove', touchMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (e.touches && e.touches.length > 0) {
      const touchTarget = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
        return;
      }
    }
    
    if (e.touches && e.touches.length > 0) {
      const deltaX = Math.abs(e.touches[0].clientX - dragStartX);
      const deltaY = Math.abs(e.touches[0].clientY - dragStartY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDragging = true;
        touchHasMoved = true;
        // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  switchElement._touchMoveHandler = touchMoveHandler;
  
  const touchEndHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchend', touchEndHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시 (다른 화면의 버튼 동작 방해 방지)
    const touchTarget = e.changedTouches && e.changedTouches.length > 0 
      ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY) 
      : e.target;
    
    if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
      // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      touchHasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !touchHasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    touchHasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  switchElement._touchEndHandler = touchEndHandler;
  
  console.log('[Device Connection Switch] 초기화 완료, 모드:', deviceConnectionMode);
}

/**
 * 디바이스 연결 방식 토글
 */
function toggleDeviceConnectionMode() {
  // ANT+ <-> Bluetooth 전환
  deviceConnectionMode = deviceConnectionMode === 'ant' ? 'bluetooth' : 'ant';
  
  // 전역 변수도 동기화
  window.deviceConnectionMode = deviceConnectionMode;
  
  // 스위치 상태 업데이트
  updateDeviceConnectionSwitch(deviceConnectionMode);
  
  // 모드 저장
  sessionStorage.setItem('deviceConnectionMode', deviceConnectionMode);
  
  console.log('[Device Connection Switch] 모드 변경:', deviceConnectionMode);
  
  // 토스트 메시지 표시
  if (typeof showToast === 'function') {
    const modeText = deviceConnectionMode === 'ant' ? 'ANT+' : 'Bluetooth';
    showToast(`연결 방식: ${modeText}`, 'info');
  }
}

/**
 * 디바이스 연결 방식 스위치 UI 업데이트
 */
function updateDeviceConnectionSwitch(mode) {
  const switchElement = document.getElementById('deviceConnectionSwitch');
  const slider = document.getElementById('switchSlider');
  const labelAnt = document.getElementById('switchLabelAnt');
  const labelBluetooth = document.getElementById('switchLabelBluetooth');
  
  if (!switchElement || !slider) return;
  
  // 기존 클래스 제거
  switchElement.classList.remove('active-ant', 'active-bluetooth');
  
  if (mode === 'bluetooth') {
    // Bluetooth 모드: 슬라이더를 왼쪽으로 이동 (녹색)
    switchElement.classList.add('active-bluetooth');
    slider.style.left = '0%'; // 명시적으로 '%' 포함하여 일관성 유지
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 보이고, 오른쪽(ANT+)은 가려짐
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '4'; // 보임 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '2'; // 가려짐 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '400';
      labelAnt.style.color = '#999';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '600';
      labelBluetooth.style.color = '#22c55e';
    }
  } else {
    // ANT+ 모드 (기본값): 슬라이더를 오른쪽으로 이동 (녹색)
    switchElement.classList.add('active-ant');
    slider.style.left = '50%';
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 가려지고, 오른쪽(ANT+)은 보임
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '2'; // 가려짐 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '4'; // 보임 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '600';
      labelAnt.style.color = '#22c55e';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '400';
      labelBluetooth.style.color = '#999';
    }
  }
}

/**
 * 일반 화면용 디바이스 연결 방식 스위치 초기화
 */
function initializeDeviceConnectionSwitchForScreen() {
  const switchElement = document.getElementById('deviceConnectionSwitchScreen');
  const slider = document.getElementById('switchSliderScreen');
  const labelAnt = document.getElementById('switchLabelAntScreen');
  const labelBluetooth = document.getElementById('switchLabelBluetoothScreen');
  
  if (!switchElement || !slider) {
    console.warn('[Device Connection Switch Screen] 스위치 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 기존 이벤트 리스너 제거 (중복 방지)
  if (switchElement._clickHandler) {
    switchElement.removeEventListener('click', switchElement._clickHandler);
  }
  if (switchElement._mouseDownHandler) {
    switchElement.removeEventListener('mousedown', switchElement._mouseDownHandler);
  }
  if (switchElement._mouseMoveHandler) {
    document.removeEventListener('mousemove', switchElement._mouseMoveHandler);
  }
  if (switchElement._mouseUpHandler) {
    document.removeEventListener('mouseup', switchElement._mouseUpHandler);
  }
  if (switchElement._touchStartHandler) {
    switchElement.removeEventListener('touchstart', switchElement._touchStartHandler);
  }
  if (switchElement._touchMoveHandler) {
    document.removeEventListener('touchmove', switchElement._touchMoveHandler);
  }
  if (switchElement._touchEndHandler) {
    document.removeEventListener('touchend', switchElement._touchEndHandler);
  }
  
  // 드래그 상태 추적 변수 (클로저로 관리)
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasMoved = false;
  let isProcessing = false; // 중복 실행 방지 플래그
  const DRAG_THRESHOLD = 5; // 픽셀 단위 드래그 임계값
  
  // 저장된 모드 복원 (없으면 기본값 'bluetooth')
  const savedMode = sessionStorage.getItem('deviceConnectionMode') || 'bluetooth';
  deviceConnectionMode = savedMode;
  
  // 스위치 상태 업데이트 (일반 화면용)
  updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
  
  // 슬라이드 스위치 요소 자체인지 확인하는 헬퍼 함수
  const isSwitchElement = (target) => {
    return target === switchElement || 
           target.closest('.switch-option') || 
           target.closest('.switch-slider') ||
           switchElement.contains(target);
  };
  
  // 마우스 이벤트 핸들러
  const mouseDownHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (isSwitchElement(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      isDragging = false;
      hasMoved = false;
      isProcessing = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    } else {
      // 슬라이드 스위치가 아닌 영역을 클릭한 경우 이벤트 전파 차단
      e.stopPropagation();
      e.preventDefault();
    }
  };
  switchElement.addEventListener('mousedown', mouseDownHandler, { passive: false });
  switchElement._mouseDownHandler = mouseDownHandler;
  
  const mouseMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mousemove', mouseMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
      isDragging = true;
      hasMoved = true;
      // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('mousemove', mouseMoveHandler, { passive: false });
  switchElement._mouseMoveHandler = mouseMoveHandler;
  
  const mouseUpHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mouseup', mouseUpHandler);
      return;
    }
    
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (!isSwitchElement(e.target)) {
      // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.stopPropagation();
    e.preventDefault();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      hasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !hasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    hasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('mouseup', mouseUpHandler, { passive: false });
  switchElement._mouseUpHandler = mouseUpHandler;
  
  // 클릭 이벤트 핸들러 - 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
  const clickHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (switchElement && isSwitchElement(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      // mouseup에서 이미 처리했으므로 여기서는 아무것도 하지 않음
    }
    // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
    return false;
  };
  switchElement.addEventListener('click', clickHandler, { passive: false });
  switchElement._clickHandler = clickHandler;
  
  // 터치 이벤트 핸들러 (모바일) - 드래그 상태 추적 변수 재사용
  let touchHasMoved = false;
  
  const touchStartHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 터치한 경우에만 처리
    const touchTarget = e.touches && e.touches.length > 0 ? document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) : e.target;
    if (touchTarget && isSwitchElement(touchTarget)) {
      e.stopPropagation();
      isDragging = false;
      touchHasMoved = false;
      isProcessing = false;
      if (e.touches && e.touches.length > 0) {
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
      }
    }
    // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
  };
  switchElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  switchElement._touchStartHandler = touchStartHandler;
  
  const touchMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchmove', touchMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (e.touches && e.touches.length > 0) {
      const touchTarget = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
        return;
      }
    }
    
    if (e.touches && e.touches.length > 0) {
      const deltaX = Math.abs(e.touches[0].clientX - dragStartX);
      const deltaY = Math.abs(e.touches[0].clientY - dragStartY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDragging = true;
        touchHasMoved = true;
        // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  switchElement._touchMoveHandler = touchMoveHandler;
  
  const touchEndHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchend', touchEndHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 슬라이드 스위치 요소 자체를 터치한 경우에만 처리
    const touchTarget = e.changedTouches && e.changedTouches.length > 0 
      ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY) 
      : e.target;
    
    if (!touchTarget || !isSwitchElement(touchTarget)) {
      // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      touchHasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !touchHasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    touchHasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  switchElement._touchEndHandler = touchEndHandler;
  
  console.log('[Device Connection Switch Screen] 초기화 완료, 모드:', deviceConnectionMode);
}

/**
 * 일반 화면용 디바이스 연결 방식 스위치 UI 업데이트
 */
function updateDeviceConnectionSwitchForScreen(mode) {
  const switchElement = document.getElementById('deviceConnectionSwitchScreen');
  const slider = document.getElementById('switchSliderScreen');
  const labelAnt = document.getElementById('switchLabelAntScreen');
  const labelBluetooth = document.getElementById('switchLabelBluetoothScreen');
  
  if (!switchElement || !slider) return;
  
  // 기존 클래스 제거
  switchElement.classList.remove('active-ant', 'active-bluetooth');
  
  if (mode === 'bluetooth') {
    // Bluetooth 모드: 슬라이더를 왼쪽으로 이동 (녹색)
    switchElement.classList.add('active-bluetooth');
    slider.style.left = '0%'; // 명시적으로 '%' 포함하여 일관성 유지
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 보이고, 오른쪽(ANT+)은 가려짐
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '4'; // 보임 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '2'; // 가려짐 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '400';
      labelAnt.style.color = '#999';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '600';
      labelBluetooth.style.color = '#22c55e';
    }
  } else {
    // ANT+ 모드 (기본값): 슬라이더를 오른쪽으로 이동 (녹색)
    switchElement.classList.add('active-ant');
    slider.style.left = '50%';
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 가려지고, 오른쪽(ANT+)은 보임
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '2'; // 가려짐 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '4'; // 보임 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '600';
      labelAnt.style.color = '#22c55e';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '400';
      labelBluetooth.style.color = '#999';
    }
  }
}

/**
 * 현재 디바이스 연결 방식 가져오기
 */
function getDeviceConnectionMode() {
  return deviceConnectionMode || 'ant';
}

/**
 * 모달에서 Player List 화면 열기
 */
async function openPlayerListFromModal(event) {
  // [Module 3 - Fix Logic] 이벤트 전파 중단 (필수)
  // 버튼 클릭이 부모(훈련방 리스트)로 전달되어 클릭 핸들러를 건드리는 것을 원천 차단
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

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
 * 모달에서 Coach 모드 열기 (디바이스 연결 방식에 따라 화면 이동)
 * [수정됨] 변수 상태를 최우선으로 확인하여 화면 이동 오류 수정
 */
function openCoachModeFromModal(event) {
  console.log('[Coach Modal] ========== Coach 버튼 클릭 시작 ==========');
  
  // [Module 3 - Fix Logic] 이벤트 전파 중단 (필수)
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (!currentSelectedTrainingRoom) {
    console.error('[Coach Modal] ❌ Training Room이 선택되지 않았습니다.');
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }

  // 1. [핵심 수정] 변수 및 스토리지 값을 최우선으로 확인 (UI 위치 계산보다 정확함)
  let currentDeviceMode = 'bluetooth'; // 기본값

  // 전역 변수 확인
  if (window.deviceConnectionMode && (window.deviceConnectionMode === 'bluetooth' || window.deviceConnectionMode === 'ant')) {
    currentDeviceMode = window.deviceConnectionMode;
    console.log('[Coach Modal] 전역 변수에서 모드 확인:', currentDeviceMode);
  } 
  // sessionStorage 확인
  else {
    const savedMode = sessionStorage.getItem('deviceConnectionMode');
    if (savedMode && (savedMode === 'bluetooth' || savedMode === 'ant')) {
      currentDeviceMode = savedMode;
      console.log('[Coach Modal] sessionStorage에서 모드 확인:', currentDeviceMode);
    }
    // 로컬 변수 확인
    else if (typeof deviceConnectionMode !== 'undefined') {
      currentDeviceMode = deviceConnectionMode;
    }
  }

  // 2. 만약 변수 값이 모호할 경우에만 UI 슬라이더 위치 확인 (Fallback)
  const switchSlider = document.getElementById('switchSlider');
  if (switchSlider && !window.deviceConnectionMode && !sessionStorage.getItem('deviceConnectionMode')) {
    const computedStyle = window.getComputedStyle(switchSlider);
    const sliderLeft = switchSlider.style.left || computedStyle.left;
    
    // left 값이 0에 가까우면(왼쪽) Bluetooth, 크면(오른쪽) ANT+
    let isBluetoothPosition = false;
    
    if (sliderLeft.includes('%')) {
      isBluetoothPosition = parseFloat(sliderLeft) < 25;
    } else if (sliderLeft.includes('px')) {
      // px일 경우 부모 너비 대비 비율로 대략적 계산
      isBluetoothPosition = parseFloat(sliderLeft) < 50; 
    }
    
    if (isBluetoothPosition) {
      currentDeviceMode = 'bluetooth';
      console.log('[Coach Modal] UI 슬라이더 위치로 Bluetooth 감지');
    }
  }
  
  // 상태 동기화
  deviceConnectionMode = currentDeviceMode;
  window.deviceConnectionMode = currentDeviceMode;
  sessionStorage.setItem('deviceConnectionMode', currentDeviceMode);
  
  console.log('[Coach Modal] ========== 최종 디바이스 연결 방식:', currentDeviceMode, '==========');
  
  // 모달 닫기
  closeTrainingRoomModal();
  
  // 3. 모드에 따른 화면 이동 분기 처리
  if (currentDeviceMode === 'bluetooth') {
    // [Bluetooth 모드] -> Bluetooth Training Coach 화면으로 이동
    console.log('[Coach Modal] 🚀 Bluetooth 선택됨 → bluetoothTrainingCoachScreen 화면으로 이동');
    
    if (typeof showScreen === 'function') {
      try {
        // [수정 요청 사항 반영] 블루투스 코치 스크린으로 이동
        showScreen('bluetoothTrainingCoachScreen');
        
        // 블루투스 코치용 트랙 정보 로드 (필요 시)
        if (typeof updateBluetoothCoachTracksFromFirebase === 'function') {
          setTimeout(() => updateBluetoothCoachTracksFromFirebase(), 300);
        }
      } catch (error) {
        console.error('[Coach Modal] ❌ 화면 전환 오류:', error);
        showToast('화면 전환 중 오류가 발생했습니다.', 'error');
      }
    }
  } else {
    // [ANT+ 모드] -> 기존 Indoor Training 모드 선택 모달로 이동
    console.log('[Coach Modal] 🚀 ANT+ 선택됨 → Indoor Training 모드 선택 화면으로 이동');
    
    if (typeof showIndoorModeSelectionModal === 'function') {
      showIndoorModeSelectionModal();
    } else {
      // 함수가 없으면 바로 ANT+ 대시보드로 이동 (Fallback)
      if (typeof showScreen === 'function') {
        showScreen('indoorTrainingDashboardScreen');
      }
    }
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
  
  // 모든 카드에서 선택 상태 및 버튼 제거
  setTimeout(() => {
    document.querySelectorAll('.training-room-card').forEach(card => {
      card.classList.remove('selected');
      const existingCheck = card.querySelector('.training-room-check');
      if (existingCheck) {
        existingCheck.remove();
      }
      const existingButtons = card.querySelector('.training-room-action-buttons');
      if (existingButtons) {
        existingButtons.remove();
      }
    });
  }, 100);
  
  // 뒤로 가기 버튼에 모바일 터치 이벤트 추가
  setTimeout(() => {
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    if (trainingRoomScreen) {
      // 뒤로 가기 버튼 찾기 (다양한 선택자 시도)
      let backButton = trainingRoomScreen.querySelector('.connection-exit-container .btn-exit-inline');
      if (!backButton) {
        backButton = trainingRoomScreen.querySelector('button.btn-exit-inline[onclick*="basecampScreen"]');
      }
      if (!backButton) {
        // onclick 속성으로 찾기
        const allButtons = trainingRoomScreen.querySelectorAll('.connection-exit-container button');
        backButton = Array.from(allButtons).find(btn => 
          btn.getAttribute('onclick') && btn.getAttribute('onclick').includes('basecampScreen')
        );
      }
      
      if (backButton) {
        // 기존 터치 이벤트 리스너 제거 (중복 방지)
        if (backButton._backButtonTouchHandler) {
          backButton.removeEventListener('touchend', backButton._backButtonTouchHandler);
        }
        
        // 터치 이벤트 핸들러 추가
        const backButtonTouchHandler = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (typeof showScreen === 'function') {
            showScreen('basecampScreen');
          }
        };
        backButton.addEventListener('touchend', backButtonTouchHandler, { passive: false });
        backButton._backButtonTouchHandler = backButtonTouchHandler;
        
        // 터치 스타일 개선
        backButton.style.touchAction = 'manipulation';
        backButton.style.webkitTapHighlightColor = 'transparent';
      }
    }
  }, 150);
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
 * 트랙에 사용자 할당 (애니메이션 효과 포함)
 */
async function assignUserToTrackWithAnimation(trackNumber, currentUserId, roomIdParam, event) {
  // 버튼이 비활성화되어 있으면 실행하지 않음 (UI 레벨 권한 체크)
  const button = event?.target?.closest('button.player-assign-btn');
  if (button && button.disabled) {
    return;
  }
  
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
  
  if (roomId) {
    roomId = String(roomId);
    
    // 권한 체크: 트랙에 할당된 사용자 정보 확인 (기존 사용자가 있는 경우만)
    if (currentUserId) {
      try {
        const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.tracks && Array.isArray(result.tracks)) {
          const track = result.tracks.find(t => parseInt(t.trackNumber, 10) === trackNumber);
          
          if (track && track.userId) {
            // 현재 사용자 정보 확인
            let currentUser = null;
            let currentUserIdCheck = null;
            let userGrade = '2';
            let isAdmin = false;
            
            try {
              currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
              if (currentUser && currentUser.id != null) {
                currentUserIdCheck = String(currentUser.id);
              }
              userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
              isAdmin = userGrade === '1' || userGrade === 1;
              
              // grade=2 사용자는 본인이 할당한 트랙만 변경 가능
              if (!isAdmin && String(track.userId) !== currentUserIdCheck) {
                if (typeof showToast === 'function') {
                  showToast('본인이 할당한 트랙만 변경할 수 있습니다.', 'error');
                }
                return;
              }
            } catch (e) {
              console.error('[assignUserToTrackWithAnimation] 권한 체크 오류:', e);
            }
          }
        }
      } catch (error) {
        console.error('[assignUserToTrackWithAnimation] 트랙 정보 확인 오류:', error);
        // 오류가 발생해도 계속 진행 (권한 체크 실패 시에도 관리자는 진행 가능하도록)
      }
    }
  }
  
  const originalText = button ? button.querySelector('span')?.textContent : '';
  const originalDisabled = button ? button.disabled : false;
  
  // 버튼 애니메이션 효과
  if (button) {
    button.disabled = true;
    button.style.transition = 'all 0.2s ease';
    button.style.transform = 'scale(0.95)';
    button.style.opacity = '0.7';
    const span = button.querySelector('span');
    if (span) {
      span.textContent = '처리 중...';
    }
  }
  
  try {
    await assignUserToTrack(trackNumber, currentUserId, roomIdParam);
  } finally {
    // 버튼 상태 복원
    if (button) {
      setTimeout(() => {
        button.disabled = originalDisabled;
        button.style.transform = 'scale(1)';
        button.style.opacity = '1';
        const span = button.querySelector('span');
        if (span && originalText) {
          span.textContent = originalText;
        }
      }, 300);
    }
  }
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

  // 사용자 grade 확인
  let userGrade = '2';
  let isAdmin = false;
  let isCoach = false;
  let loggedInUserId = null; // 함수 파라미터 currentUserId와 구분하기 위해 다른 이름 사용
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    loggedInUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
    isCoach = userGrade === '3' || userGrade === 3;
  } catch (e) {
    console.error('[assignUserToTrack] 사용자 grade 확인 오류:', e);
  }
  
  // grade=2 사용자는 사용자와 심박계만 변경 가능
  const isGrade2 = userGrade === '2' || userGrade === 2;
  
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 사용 가능
  if (isGrade2 && loggedInUserId) {
    // grade=2 사용자는 본인 계정만 필터링
    users = users.filter(user => String(user.id) === loggedInUserId);
    console.log('[assignUserToTrack] 일반 사용자 제한: 본인 계정만 표시', {
      loggedInUserId: loggedInUserId,
      filteredCount: users.length
    });
  }

  // 모든 사용자 목록을 전역 변수에 저장 (검색 필터링용)
  window._allUsersForTrackSelection = users;

  // [일반 사용자 디바이스 입력 활성화] grade=2 사용자도 디바이스 정보 입력 가능
  const canModifyDevices = isAdmin || isCoach || isGrade2; // grade=1,3,2 모두 디바이스 입력 가능
  
  // Firebase에서 현재 트랙의 정보 가져오기
  let currentUserData = null;
  let currentDeviceData = null;
  
  if (typeof db !== 'undefined') {
    try {
      const sessionId = roomId;
      
      // users 정보 가져오기
      const usersRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      const usersSnapshot = await usersRef.once('value');
      currentUserData = usersSnapshot.val();
      
      // devices 정보 가져오기
      const devicesRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
      const devicesSnapshot = await devicesRef.once('value');
      currentDeviceData = devicesSnapshot.val();
      
      console.log('[assignUserToTrack] 현재 트랙 정보:', {
        trackNumber: trackNumber,
        userData: currentUserData,
        deviceData: currentDeviceData,
        userGrade: userGrade,
        canModifyDevices: canModifyDevices
      });
    } catch (error) {
      console.error('[assignUserToTrack] Firebase 정보 로드 오류:', error);
    }
  }

  modal.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">트랙${trackNumber} 훈련 신청</h2>
      
      <!-- 이름 검색 입력 필드 -->
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">이름 검색</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" 
                 id="trackUserSearchInput" 
                 placeholder="이름을 입력하세요" 
                 style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 onkeypress="if(event.key==='Enter') searchUsersForTrackSelection(${trackNumber}, '${roomId}')">
          <button onclick="searchUsersForTrackSelection(${trackNumber}, '${roomId}')" 
                  id="btnSearchUsersForTrack"
                  style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
            검색
          </button>
        </div>
      </div>
      
      <!-- 사용자 목록 컨테이너 -->
      <div id="trackUserListContainer" style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
        <!-- 검색 후에만 사용자 목록이 표시됩니다 -->
      </div>
      
      <!-- 선택된 사용자 표시 -->
      <div id="selectedUserForTrack" style="display: none; margin-bottom: 20px; padding: 12px; background: #e3f2fd; border-radius: 4px; border: 2px solid #2196F3;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: bold; margin-bottom: 4px;">선택된 사용자: <span id="selectedUserNameForTrack"></span></div>
            <div style="font-size: 0.9em; color: #666;">FTP: <span id="selectedUserFTPForTrack"></span>W | 체중: <span id="selectedUserWeightForTrack"></span>kg</div>
          </div>
          <span style="color: #2196F3; font-size: 24px;">✓</span>
        </div>
      </div>
      
      <!-- 디바이스 입력 필드 -->
      <div id="deviceInputSection" style="display: none; margin-bottom: 20px;">
        <h3 style="margin: 0 0 16px 0; font-size: 1.1em; color: #333;">디바이스 정보 입력</h3>
        
        ${canModifyDevices ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">스마트로라 ID</label>
          <input type="text" 
                 id="trackTrainerDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">파워메터 ID</label>
          <input type="text" 
                 id="trackPowerMeterDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        ` : `
        <div style="margin-bottom: 16px; display: none;">
          <input type="text" id="trackTrainerDeviceId" style="display: none;">
          <input type="text" id="trackPowerMeterDeviceId" style="display: none;">
        </div>
        `}
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">심박계 ID</label>
          <input type="text" 
                 id="trackHeartRateDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        
        ${canModifyDevices ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Gear</label>
            <select id="trackGearSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="11단">11단</option>
              <option value="12단">12단</option>
            </select>
          </div>
          
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Brake</label>
            <select id="trackBrakeSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="디스크">디스크</option>
              <option value="림">림</option>
            </select>
          </div>
        </div>
        ` : `
        <div style="display: none;">
          <select id="trackGearSelect" style="display: none;"><option value=""></option></select>
          <select id="trackBrakeSelect" style="display: none;"><option value=""></option></select>
        </div>
        `}
      </div>
      
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        ${canModifyDevices ? `
        <button onclick="resetTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnResetTrackApplication"
                style="padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          초기화
        </button>
        ` : ''}
        <button onclick="saveTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnSaveTrackApplication"
                style="display: none; padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          저장
        </button>
        <button onclick="closeTrackUserSelectModal()" 
                style="padding: 10px 20px; background: #ccc; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          취소
        </button>
      </div>
    </div>
  `;
  
  // 전역 변수에 현재 트랙 정보 저장 (기존 정보가 있으면 사용)
  window._currentTrackApplication = {
    trackNumber: trackNumber,
    roomId: roomId,
    selectedUserId: currentUserData?.userId || null,
    selectedUserName: currentUserData?.userName || null,
    selectedUserFTP: currentUserData?.ftp || null,
    selectedUserWeight: currentUserData?.weight || null
  };
  
  // 모달이 생성된 후 현재 정보로 필드 채우기
  setTimeout(() => {
    // 사용자 정보가 있으면 선택된 사용자로 표시
    if (currentUserData && currentUserData.userId) {
      const selectedUserDiv = document.getElementById('selectedUserForTrack');
      const selectedUserNameSpan = document.getElementById('selectedUserNameForTrack');
      const selectedUserFTPSpan = document.getElementById('selectedUserFTPForTrack');
      const selectedUserWeightSpan = document.getElementById('selectedUserWeightForTrack');
      const deviceInputSection = document.getElementById('deviceInputSection');
      const saveBtn = document.getElementById('btnSaveTrackApplication');
      const searchInput = document.getElementById('trackUserSearchInput');
      
      if (selectedUserDiv && selectedUserNameSpan && selectedUserFTPSpan && selectedUserWeightSpan) {
        selectedUserNameSpan.textContent = currentUserData.userName || '';
        selectedUserFTPSpan.textContent = currentUserData.ftp || '-';
        selectedUserWeightSpan.textContent = currentUserData.weight || '-';
        selectedUserDiv.style.display = 'block';
      }
      
      if (deviceInputSection) {
        deviceInputSection.style.display = 'block';
      }
      
      if (saveBtn) {
        saveBtn.style.display = 'block';
      }
      
      // 현재 선택된 사용자 이름을 검색 입력 필드에 채우고 자동 검색 (선택된 사용자는 제외)
      if (searchInput && currentUserData.userName) {
        searchInput.value = currentUserData.userName;
        // 자동으로 검색 실행 (현재 선택된 사용자는 검색 결과에서 제외됨)
        setTimeout(() => {
          if (typeof searchUsersForTrackSelection === 'function') {
            searchUsersForTrackSelection(trackNumber, roomId);
          }
        }, 200);
      }
    }
    
    // 디바이스 정보가 있으면 입력 필드에 값 채우기
    if (currentDeviceData) {
      console.log('[assignUserToTrack] 디바이스 데이터:', currentDeviceData);
      
      const trainerDeviceIdInput = document.getElementById('trackTrainerDeviceId');
      const powerMeterDeviceIdInput = document.getElementById('trackPowerMeterDeviceId');
      const heartRateDeviceIdInput = document.getElementById('trackHeartRateDeviceId');
      const gearSelect = document.getElementById('trackGearSelect');
      const brakeSelect = document.getElementById('trackBrakeSelect');
      
      // 스마트로라 ID (새 필드명 우선, 기존 필드명 호환)
      if (trainerDeviceIdInput) {
        trainerDeviceIdInput.value = currentDeviceData.smartTrainerId || 
                                     currentDeviceData['smartTrainerId'] || 
                                     currentDeviceData['Smart Trainer id'] || 
                                     currentDeviceData.trainerId || 
                                     '';
      }
      
      // 파워메터 ID (새 필드명 우선, 기존 필드명 호환)
      if (powerMeterDeviceIdInput) {
        powerMeterDeviceIdInput.value = currentDeviceData.powerMeterId || 
                                        currentDeviceData['powerMeterId'] ||
                                        currentDeviceData['Power Meter id'] || 
                                        currentDeviceData['Power Meter Id'] ||
                                        currentDeviceData.powerMeter || 
                                        '';
      }
      
      // 심박계 ID (새 필드명 우선, 기존 필드명 호환)
      if (heartRateDeviceIdInput) {
        heartRateDeviceIdInput.value = currentDeviceData.heartRateId || 
                                       currentDeviceData['heartRateId'] ||
                                       currentDeviceData['Heart Rate id'] || 
                                       currentDeviceData['Heart Rate Id'] ||
                                       currentDeviceData.heartRate || 
                                       '';
      }
      
      // Gear (새 필드명 우선, 기존 필드명 호환)
      if (gearSelect) {
        gearSelect.value = currentDeviceData.gear || 
                           currentDeviceData['gear'] ||
                           currentDeviceData['Gear'] || 
                           currentDeviceData.Gear || 
                           '';
      }
      
      // Brake (새 필드명 우선, 기존 필드명 호환)
      if (brakeSelect) {
        brakeSelect.value = currentDeviceData.brake || 
                           currentDeviceData['brake'] ||
                           currentDeviceData['Brake'] || 
                           currentDeviceData.Brake || 
                           '';
      }
      
      console.log('[assignUserToTrack] 디바이스 필드 값 설정 완료:', {
        powerMeter: powerMeterDeviceIdInput?.value,
        heartRate: heartRateDeviceIdInput?.value,
        gear: gearSelect?.value,
        brake: brakeSelect?.value
      });
    } else {
      console.log('[assignUserToTrack] 디바이스 데이터가 없습니다.');
    }
  }, 100);

  modal.style.display = 'flex';
  
  // 모달 외부 클릭 시 닫기
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeTrackUserSelectModal();
    }
  };
  
  // 검색 입력 필드에 포커스
  setTimeout(() => {
    const searchInput = document.getElementById('trackUserSearchInput');
    if (searchInput) {
      searchInput.focus();
    }
  }, 100);
}

/**
 * 트랙 사용자 선택용 사용자 목록 렌더링
 */
function renderUserListForTrackSelection(users, trackNumber, roomId, currentUserId) {
  if (!users || users.length === 0) {
    return '<div style="padding: 20px; text-align: center; color: #999;">등록된 사용자가 없습니다.</div>';
  }
  
  return users.map(user => {
    const isSelected = window._currentTrackApplication && window._currentTrackApplication.selectedUserId === String(user.id);
    return `
      <div class="user-select-item" 
           data-user-id="${user.id}"
           style="padding: 12px; margin: 8px 0; border: 2px solid ${isSelected ? '#2196F3' : '#ddd'}; border-radius: 4px; cursor: pointer; background: ${isSelected ? '#e3f2fd' : '#fff'}; transition: all 0.2s ease; position: relative;"
           onmouseover="if (!${isSelected}) { this.style.background='#f5f5f5'; this.style.transform='translateX(4px)'; }"
           onmouseout="if (!${isSelected}) { this.style.background='#fff'; this.style.transform='translateX(0)'; }"
           onclick="selectUserForTrackSelection(${trackNumber}, ${user.id}, '${escapeHtml(user.name || '')}', ${user.ftp || 0}, ${user.weight || 0}, '${roomId}', event)">
        <div style="font-weight: bold; margin-bottom: 4px;">${escapeHtml(user.name || '이름 없음')}</div>
        <div style="font-size: 0.9em; color: #666;">FTP: ${user.ftp || '-'}W | 체중: ${user.weight || '-'}kg</div>
        ${isSelected ? '<div style="position: absolute; top: 8px; right: 8px; color: #2196F3; font-size: 20px; font-weight: bold;">✓</div>' : ''}
      </div>
    `;
  }).join('');
}

/**
 * 트랙 사용자 검색 (검색 버튼 클릭 시에만 실행)
 */
async function searchUsersForTrackSelection(trackNumber, roomId) {
  const searchInput = document.getElementById('trackUserSearchInput');
  const listContainer = document.getElementById('trackUserListContainer');
  const searchBtn = document.getElementById('btnSearchUsersForTrack');
  
  if (!searchInput || !listContainer) return;
  
  const searchTerm = searchInput.value.trim();
  let allUsers = window._allUsersForTrackSelection || [];
  
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 검색 가능
  let currentUserId = null;
  let userGrade = '2';
  let isGrade2 = false;
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    currentUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isGrade2 = userGrade === '2' || userGrade === 2;
  } catch (e) {
    console.error('[searchUsersForTrackSelection] 사용자 정보 확인 오류:', e);
  }

  if (isGrade2 && currentUserId) {
    // grade=2 사용자는 본인 계정만 필터링
    allUsers = allUsers.filter(user => String(user.id) === currentUserId);
    console.log('[searchUsersForTrackSelection] 일반 사용자 제한: 본인 계정만 검색', {
      currentUserId: currentUserId,
      filteredCount: allUsers.length
    });
  }
  
  // 검색어가 없으면 목록을 비워둠
  if (!searchTerm) {
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색어를 입력하세요.</div>';
    return;
  }
  
  // 검색 버튼 비활성화 및 로딩 표시
  if (searchBtn) {
    searchBtn.disabled = true;
    const originalText = searchBtn.textContent;
    searchBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> 검색 중...';
    
    // CSS 애니메이션 추가 (이미 있으면 무시)
    if (!document.getElementById('searchLoadingStyle')) {
      const style = document.createElement('style');
      style.id = 'searchLoadingStyle';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // 결과 영역에 로딩 표시
    listContainer.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #10b981;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid rgba(16, 185, 129, 0.2); border-top-color: #10b981; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
        <p style="margin: 0; font-size: 14px;">사용자 검색 중...</p>
      </div>
    `;
  }
  
  try {
    // 검색어로 필터링
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || '').toLowerCase();
      return name.includes(searchTerm.toLowerCase());
    });
    
    // 현재 선택된 사용자 ID 가져오기
    const currentSelectedUserId = window._currentTrackApplication?.selectedUserId ? String(window._currentTrackApplication.selectedUserId) : null;
    
    // 현재 선택된 사용자를 제외한 목록 필터링
    const usersToShow = currentSelectedUserId 
      ? filteredUsers.filter(user => String(user.id) !== currentSelectedUserId)
      : filteredUsers;
    
    // 필터링된 목록 렌더링
    if (usersToShow.length === 0) {
      listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색 결과가 없습니다.</div>';
    } else {
      listContainer.innerHTML = renderUserListForTrackSelection(usersToShow, trackNumber, roomId, null);
    }
  } catch (error) {
    console.error('[searchUsersForTrackSelection] 검색 오류:', error);
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545;">검색 중 오류가 발생했습니다.</div>';
  } finally {
    // 검색 버튼 복원
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '검색';
    }
  }
}

/**
 * 트랙 사용자 선택 (체크 표시만, 자동 저장 안 함)
 */
function selectUserForTrackSelection(trackNumber, userId, userName, userFTP, userWeight, roomId, event) {
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 선택 가능
  let currentUserId = null;
  let userGrade = '2';
  let isGrade2 = false;
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    currentUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isGrade2 = userGrade === '2' || userGrade === 2;
  } catch (e) {
    console.error('[selectUserForTrackSelection] 사용자 정보 확인 오류:', e);
  }

  if (isGrade2 && currentUserId) {
    // grade=2 사용자는 본인 계정만 선택 가능
    if (String(userId) !== currentUserId) {
      if (typeof showToast === 'function') {
        showToast('본인 계정만 선택할 수 있습니다.', 'error');
      }
      console.log('[selectUserForTrackSelection] 일반 사용자 제한: 본인 계정만 선택 가능', {
        selectedUserId: userId,
        currentUserId: currentUserId
      });
      return;
    }
  }

  // 선택된 사용자 정보 저장
  window._currentTrackApplication = {
    trackNumber: trackNumber,
    roomId: roomId,
    selectedUserId: String(userId),
    selectedUserName: userName,
    selectedUserFTP: userFTP,
    selectedUserWeight: userWeight
  };
  
  // 선택된 사용자 표시 영역 업데이트
  const selectedUserDiv = document.getElementById('selectedUserForTrack');
  const selectedUserNameSpan = document.getElementById('selectedUserNameForTrack');
  const selectedUserFTPSpan = document.getElementById('selectedUserFTPForTrack');
  const selectedUserWeightSpan = document.getElementById('selectedUserWeightForTrack');
  const deviceInputSection = document.getElementById('deviceInputSection');
  const saveBtn = document.getElementById('btnSaveTrackApplication');
  
  if (selectedUserDiv && selectedUserNameSpan && selectedUserFTPSpan && selectedUserWeightSpan) {
    selectedUserNameSpan.textContent = userName;
    selectedUserFTPSpan.textContent = userFTP || '-';
    selectedUserWeightSpan.textContent = userWeight || '-';
    selectedUserDiv.style.display = 'block';
  }
  
  if (deviceInputSection) {
    deviceInputSection.style.display = 'block';
  }
  
  if (saveBtn) {
    saveBtn.style.display = 'block';
  }
  
  // 사용자 목록 다시 렌더링 (체크 표시 업데이트 및 현재 선택된 사용자 제외)
  const searchInput = document.getElementById('trackUserSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim() : '';
  const allUsers = window._allUsersForTrackSelection || [];
  
  if (searchTerm) {
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || '').toLowerCase();
      return name.includes(searchTerm.toLowerCase());
    });
    
    // 현재 선택된 사용자를 제외
    const currentSelectedUserId = String(userId);
    const usersToShow = filteredUsers.filter(user => String(user.id) !== currentSelectedUserId);
    
    const listContainer = document.getElementById('trackUserListContainer');
    if (listContainer) {
      if (usersToShow.length === 0) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색 결과가 없습니다.</div>';
      } else {
        listContainer.innerHTML = renderUserListForTrackSelection(usersToShow, trackNumber, roomId, null);
      }
    }
  }
}

/**
 * 트랙에서 사용자 제거 (애니메이션 효과 포함)
 */
async function removeUserFromTrackWithAnimation(trackNumber, roomIdParam, event) {
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
  
  // 권한 체크: 트랙에 할당된 사용자 정보 확인
  try {
    const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success && result.tracks && Array.isArray(result.tracks)) {
      const track = result.tracks.find(t => parseInt(t.trackNumber, 10) === trackNumber);
      
      if (track && track.userId) {
        // 현재 사용자 정보 확인
        let currentUser = null;
        let currentUserIdCheck = null;
        let userGrade = '2';
        let isAdmin = false;
        
        try {
          currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
          if (currentUser && currentUser.id != null) {
            currentUserIdCheck = String(currentUser.id);
          }
          userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
          isAdmin = userGrade === '1' || userGrade === 1;
          
          // grade=2 사용자는 본인이 할당한 트랙만 제거 가능
          if (!isAdmin && String(track.userId) !== currentUserIdCheck) {
            if (typeof showToast === 'function') {
              showToast('본인이 할당한 트랙만 제거할 수 있습니다.', 'error');
            }
            return;
          }
        } catch (e) {
          console.error('[removeUserFromTrackWithAnimation] 권한 체크 오류:', e);
        }
      }
    }
  } catch (error) {
    console.error('[removeUserFromTrackWithAnimation] 트랙 정보 확인 오류:', error);
    // 오류가 발생해도 계속 진행 (권한 체크 실패 시에도 관리자는 진행 가능하도록)
  }

  if (!confirm(`트랙${trackNumber}에서 퇴실하시겠습니까?`)) {
    return;
  }
  
  const button = event?.target?.closest('button.player-remove-btn');
  const originalText = button ? button.querySelector('span')?.textContent : '';
  const originalDisabled = button ? button.disabled : false;
  
  // 버튼 즉시 클릭 애니메이션 효과
  if (button) {
    // 즉시 피드백: 클릭 애니메이션 클래스 추가
    button.classList.add('clicking');
    setTimeout(() => {
      button.classList.remove('clicking');
    }, 300);
    
    // 로딩 상태 표시
    button.classList.add('loading');
    button.disabled = true;
    
    const span = button.querySelector('span');
    if (span) {
      span.textContent = '처리 중...';
    }
  }
  
  try {
    // removeUserFromTrack 함수 호출 (roomId만 전달)
    await removeUserFromTrackInternal(trackNumber, roomId);
  } finally {
    // 버튼 상태 복원
    if (button) {
      setTimeout(() => {
        button.classList.remove('loading', 'clicking');
        button.disabled = originalDisabled;
        button.style.transform = '';
        button.style.opacity = '';
        const span = button.querySelector('span');
        if (span && originalText) {
          span.textContent = originalText;
        }
      }, 300);
    }
  }
}

/**
 * 트랙에서 사용자 제거 (내부 함수 - roomId만 받음)
 * grade=2: 사용자와 심박계만 삭제
 * grade=1,3: 모든 데이터 삭제
 */
async function removeUserFromTrackInternal(trackNumber, roomId) {
  roomId = String(roomId);
  
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[removeUserFromTrack] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;

  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      if (isAdmin) {
        // grade=1,3: 모든 데이터 삭제
        await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
        await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).remove();
        console.log(`[removeUserFromTrack] 트랙 ${trackNumber} 모든 데이터 삭제 완료`);
      } else {
        // grade=2: 사용자와 심박계만 삭제 (스마트로라, 파워메터, gear, brake는 유지)
        await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
        
        // devices에서 심박계만 삭제
        const deviceRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
        const deviceSnapshot = await deviceRef.once('value');
        const deviceData = deviceSnapshot.val();
        
        if (deviceData) {
          await deviceRef.update({
            heartRateId: null
          });
          console.log(`[removeUserFromTrack] 트랙 ${trackNumber} 사용자 및 심박계만 삭제 완료`);
        }
      }
      
      if (typeof showToast === 'function') {
        showToast('사용자가 제거되었습니다.', 'success');
      }
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[removeUserFromTrack] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 제거 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 트랙 신청 저장 (Firebase에 users와 devices 정보 저장)
 */
async function saveTrackApplication(trackNumber, roomIdParam) {
  const appData = window._currentTrackApplication;
  
  if (!appData || !appData.selectedUserId) {
    if (typeof showToast === 'function') {
      showToast('사용자를 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  // roomId 확인
  let roomId = roomIdParam || appData.roomId;
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  // 디바이스 정보 읽기
  const trainerDeviceId = document.getElementById('trackTrainerDeviceId')?.value?.trim() || '';
  const powerMeterDeviceId = document.getElementById('trackPowerMeterDeviceId')?.value?.trim() || '';
  const heartRateDeviceId = document.getElementById('trackHeartRateDeviceId')?.value?.trim() || '';
  const gear = document.getElementById('trackGearSelect')?.value || '';
  const brake = document.getElementById('trackBrakeSelect')?.value || '';
  
  // 저장 버튼 비활성화 및 로딩 표시
  const saveBtn = document.getElementById('btnSaveTrackApplication');
  const originalText = saveBtn ? saveBtn.textContent : '';
  
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> 저장 중...';
    saveBtn.style.opacity = '0.7';
    saveBtn.style.cursor = 'not-allowed';
  }
  
  try {
    // Firebase에 저장
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // 1. users 정보 저장
      const userData = {
        userId: appData.selectedUserId,
        userName: appData.selectedUserName,
        weight: appData.selectedUserWeight || null,
        ftp: appData.selectedUserFTP || null
      };
      
      const userRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      await userRef.set(userData);
      console.log('[saveTrackApplication] 사용자 정보 저장 완료:', userData);
      
      // 2. devices 정보 저장
      const deviceData = {
        smartTrainerId: trainerDeviceId || null,
        powerMeterId: powerMeterDeviceId || null,
        heartRateId: heartRateDeviceId || null,
        gear: gear || null,
        brake: brake || null
      };
      
      const deviceRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
      await deviceRef.set(deviceData);
      console.log('[saveTrackApplication] 디바이스 정보 저장 완료:', deviceData);
      
      if (typeof showToast === 'function') {
        showToast(`트랙${trackNumber} 신청이 완료되었습니다.`, 'success');
      }
      
      // 모달 닫기
      closeTrackUserSelectModal();
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[saveTrackApplication] 저장 오류:', error);
    if (typeof showToast === 'function') {
      showToast('저장 중 오류가 발생했습니다: ' + error.message, 'error');
    }
  } finally {
    // 저장 버튼 복원
    if (saveBtn) {
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
      }, 500);
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

/**
 * 일괄 퇴실 (모든 트랙의 사용자 및 심박계 삭제, grade=1,3만 사용 가능)
 */
async function clearAllTracksData() {
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[clearAllTracksData] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;
  
  if (!isAdmin) {
    if (typeof showToast === 'function') {
      showToast('관리자만 일괄 퇴실을 수행할 수 있습니다.', 'error');
    }
    return;
  }
  
  if (!confirm('모든 트랙의 사용자와 심박계 정보를 삭제하시겠습니까?\n(스마트로라, 파워메터, Gear, Brake는 유지됩니다)')) {
    return;
  }
  
  // roomId 가져오기
  let roomId = null;
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
    roomId = currentSelectedTrainingRoom.id;
  } else if (window.currentTrainingRoomId) {
    roomId = window.currentTrainingRoomId;
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // 모든 트랙(1~10) 처리
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        // users 삭제
        promises.push(db.ref(`sessions/${sessionId}/users/${i}`).remove());
        
        // devices에서 심박계만 삭제
        promises.push(
          db.ref(`sessions/${sessionId}/devices/${i}`).once('value').then(snapshot => {
            const deviceData = snapshot.val();
            if (deviceData) {
              return db.ref(`sessions/${sessionId}/devices/${i}`).update({
                heartRateId: null
              });
            }
          })
        );
      }
      
      await Promise.all(promises);
      
      if (typeof showToast === 'function') {
        showToast('모든 트랙의 사용자 및 심박계가 삭제되었습니다.', 'success');
      }
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[clearAllTracksData] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('일괄 퇴실 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 트랙 초기화 (해당 트랙의 모든 데이터 삭제, grade=1,3만 사용 가능)
 */
async function resetTrackApplication(trackNumber, roomIdParam) {
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[resetTrackApplication] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;
  
  if (!isAdmin) {
    if (typeof showToast === 'function') {
      showToast('관리자만 초기화를 수행할 수 있습니다.', 'error');
    }
    return;
  }
  
  if (!confirm(`트랙${trackNumber}의 모든 사용자 및 디바이스 정보를 삭제하시겠습니까?`)) {
    return;
  }
  
  // roomId 확인
  let roomId = roomIdParam;
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // 사용자 및 디바이스 정보 모두 삭제
      await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
      await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).remove();
      
      console.log(`[resetTrackApplication] 트랙 ${trackNumber} 초기화 완료`);
      
      if (typeof showToast === 'function') {
        showToast(`트랙${trackNumber}이(가) 초기화되었습니다.`, 'success');
      }
      
      // 모달 닫기
      closeTrackUserSelectModal();
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[resetTrackApplication] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('초기화 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * Player List 새로고침
 */
async function refreshPlayerList() {
  console.log('[Player List] 새로고침 시작');
  
  // 새로고침 버튼 비활성화 및 로딩 표시
  const refreshBtn = document.getElementById('btnRefreshPlayerList');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    const originalContent = refreshBtn.innerHTML;
    refreshBtn.innerHTML = '<img src="assets/img/reload.png" alt="새로고침" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle; animation: spin 1s linear infinite;" /> 새로고침 중...';
    
    try {
      // Player List 다시 렌더링
      await renderPlayerList();
      
      if (typeof showToast === 'function') {
        showToast('리스트가 새로고침되었습니다.', 'success');
      }
    } catch (error) {
      console.error('[Player List] 새로고침 오류:', error);
      if (typeof showToast === 'function') {
        showToast('리스트 새로고침 중 오류가 발생했습니다.', 'error');
      }
    } finally {
      // 버튼 복원
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = originalContent;
      }
    }
  } else {
    // 버튼이 없어도 새로고침은 실행
    await renderPlayerList();
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
window.getDeviceConnectionMode = getDeviceConnectionMode;
window.toggleDeviceConnectionMode = toggleDeviceConnectionMode;
  window.selectTrainingRoomForModal = selectTrainingRoomForModal;
  window.openPlayerListFromModal = openPlayerListFromModal;
  window.openCoachModeFromModal = openCoachModeFromModal;
  // 트랙 사용자 할당 관련 함수
  window.assignUserToTrack = assignUserToTrack;
  window.assignUserToTrackWithAnimation = assignUserToTrackWithAnimation;
  window.removeUserFromTrackWithAnimation = removeUserFromTrackWithAnimation;
  window.searchUsersForTrackSelection = searchUsersForTrackSelection;
  window.selectUserForTrackSelection = selectUserForTrackSelection;
  window.saveTrackApplication = saveTrackApplication;
  window.closeTrackUserSelectModal = closeTrackUserSelectModal;
  // Player List 새로고침 함수
  window.refreshPlayerList = refreshPlayerList;
  // 일괄 퇴실 함수
  window.clearAllTracksData = clearAllTracksData;
  // 트랙 초기화 함수
  window.resetTrackApplication = resetTrackApplication;
  // 디버깅 함수
  window.checkFirebaseTrackUsers = checkFirebaseTrackUsers;
  window.checkFirebaseRawData = checkFirebaseRawData;
  // 입장 버튼 클릭 핸들러
  window.handlePlayerEnterClick = handlePlayerEnterClick;
}

/**
 * Bluetooth Player List 화면 열기 (트랙 수 유동적)
 */
async function openBluetoothPlayerList() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Bluetooth Join Session 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('bluetoothPlayerListScreen');
  }

  // Bluetooth Player List 렌더링
  await renderBluetoothPlayerList();
}

/**
 * Bluetooth Player List 렌더링 (트랙 수 유동적: 기본 10개, 5개씩 확장)
 */
async function renderBluetoothPlayerList() {
  const playerListContent = document.getElementById('bluetoothPlayerListContent');
  if (!playerListContent) return;

  // 로딩 표시
  playerListContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">트랙 정보를 불러오는 중...</p>
    </div>
  `;

  // Training Room id 가져오기
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
      console.warn('[Bluetooth Player List] localStorage 접근 실패:', e);
    }
  }

  // 트랙 정보 가져오기 및 최대 트랙 수 계산
  let maxTrackNumber = 10; // 기본 10개
  const tracks = [];
  
  if (roomId && typeof db !== 'undefined') {
    try {
      const sessionId = roomId;
      
      // Firebase devices DB에서 track 값 가져오기 (우선순위 1)
      const devicesRef = db.ref(`sessions/${sessionId}/devices`);
      const devicesSnapshot = await devicesRef.once('value');
      const devicesData = devicesSnapshot.val() || {};
      
      if (devicesData && typeof devicesData.track === 'number' && devicesData.track > 0) {
        maxTrackNumber = devicesData.track;
        console.log('[Bluetooth Player List] Firebase devices에서 트랙 개수 가져옴:', maxTrackNumber);
      } else {
        // Fallback: 사용자가 할당된 최대 트랙 번호 찾기
        const usersRef = db.ref(`sessions/${sessionId}/users`);
        const usersSnapshot = await usersRef.once('value');
        const usersData = usersSnapshot.val() || {};
        
        const assignedTrackNumbers = Object.keys(usersData)
          .map(key => parseInt(key, 10))
          .filter(num => !isNaN(num) && num > 0);
        
        if (assignedTrackNumbers.length > 0) {
          const maxAssignedTrack = Math.max(...assignedTrackNumbers);
          // 최대 할당된 트랙이 10개 이상이면 5개씩 확장
          if (maxAssignedTrack >= 10) {
            // 10개 단위로 올림 후 5개씩 확장
            maxTrackNumber = Math.ceil((maxAssignedTrack + 1) / 5) * 5;
          } else {
            maxTrackNumber = 10;
          }
        }
      }
      
      // users 정보 가져오기 (트랙별 사용자 데이터) - devicesData는 이미 위에서 가져옴
      const usersRef = db.ref(`sessions/${sessionId}/users`);
      const usersSnapshot = await usersRef.once('value');
      const usersData = usersSnapshot.val() || {};
      
      // 트랙별 device 정보 가져오기 (트랙 번호별로 저장된 경우)
      const trackDevicesData = {};
      if (devicesData) {
        // devicesData가 객체이고 각 키가 트랙 번호인 경우
        Object.keys(devicesData).forEach(key => {
          const trackNum = parseInt(key, 10);
          if (!isNaN(trackNum) && trackNum > 0) {
            trackDevicesData[trackNum] = devicesData[key];
          }
        });
      }
      
      // 트랙 초기화
      for (let i = 1; i <= maxTrackNumber; i++) {
        const userData = usersData[i];
        const deviceData = trackDevicesData[i] || null;
        
        tracks.push({
          trackNumber: i,
          userId: userData?.userId || null,
          userName: userData?.userName || null,
          weight: userData?.weight || null,
          ftp: userData?.ftp || null,
          gear: deviceData?.gear || null,
          brake: deviceData?.brake || null,
          smartTrainerId: deviceData?.smartTrainerId || null,
          powerMeterId: deviceData?.powerMeterId || null,
          heartRateId: deviceData?.heartRateId || null
        });
      }
    } catch (error) {
      console.error('[Bluetooth Player List] 트랙 정보 로드 오류:', error);
      // 오류 발생 시 기본 10개 트랙 생성
      for (let i = 1; i <= 10; i++) {
        tracks.push({
          trackNumber: i,
          userId: null,
          userName: null,
          weight: null,
          ftp: null,
          gear: null,
          brake: null,
          smartTrainerId: null,
          powerMeterId: null,
          heartRateId: null
        });
      }
    }
  } else {
    // roomId가 없으면 기본 10개 트랙 생성
    for (let i = 1; i <= 10; i++) {
      tracks.push({
        trackNumber: i,
        userId: null,
        userName: null,
        weight: null,
        ftp: null,
        gear: null,
        brake: null,
        smartTrainerId: null,
        powerMeterId: null,
        heartRateId: null
      });
    }
  }

  // roomId를 컨테이너에 data attribute로 저장
  if (playerListContent && roomId) {
    playerListContent.setAttribute('data-room-id', String(roomId));
  }

  // 현재 사용자 정보 확인 (권한 체크용)
  let currentUser = null;
  let currentUserId = null;
  let userGrade = '2';
  let isAdmin = false;
  
  try {
    currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.id != null) {
      currentUserId = String(currentUser.id);
    }
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
  } catch (e) {
    console.error('[Bluetooth Player List] 현재 사용자 정보 확인 오류:', e);
  }

  // grade=2 사용자가 본인 계정으로 참가된 트랙이 있는지 확인
  let hasMyTrack = false;
  if (!isAdmin && currentUserId) {
    hasMyTrack = tracks.some(track => {
      const trackUserId = track.userId ? String(track.userId) : null;
      return trackUserId && trackUserId === currentUserId;
    });
  }

  // 트랙 목록 렌더링
  playerListContent.innerHTML = tracks.map(track => {
    const hasUser = !!track.userName;
    const trackUserId = track.userId ? String(track.userId) : null;
    let canModify = false;
    let canParticipate = false;
    
    if (isAdmin || userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3) {
      canModify = true;
      canParticipate = true;
    } else if (userGrade === '2' || userGrade === 2) {
      if (trackUserId && trackUserId === currentUserId) {
        canModify = true;
        canParticipate = true;
      } else if (!hasUser && !hasMyTrack) {
        canParticipate = true;
        canModify = false;
      } else {
        canModify = false;
        canParticipate = false;
      }
    }
    
    const dashboardUrl = roomId 
      ? `https://stelvio.ai.kr/bluetoothIndividual.html?bike=${track.trackNumber}&room=${roomId}`
      : `https://stelvio.ai.kr/bluetoothIndividual.html?bike=${track.trackNumber}`;

    // Gear/Brake 아이콘 생성
    let gearIcon = '';
    let brakeIcon = '';
    
    if (track.gear) {
      if (track.gear === '11단' || track.gear === '11') {
        gearIcon = '<img src="assets/img/g11.png" alt="11단" class="device-icon" />';
      } else if (track.gear === '12단' || track.gear === '12') {
        gearIcon = '<img src="assets/img/g12.png" alt="12단" class="device-icon" />';
      }
    }
    
    if (track.brake) {
      if (track.brake === '디스크' || track.brake === 'Disc') {
        brakeIcon = '<img src="assets/img/d.png" alt="디스크" class="device-icon" />';
      } else if (track.brake === '림' || track.brake === 'Rim') {
        brakeIcon = '<img src="assets/img/r.png" alt="림" class="device-icon" />';
      }
    }
    
    // 디바이스 아이콘 생성
    const deviceIcons = [];
    if (track.heartRateId) {
      deviceIcons.push('<img src="assets/img/bpm_g.png" alt="심박계" class="device-icon-with-bg" title="심박계" />');
    }
    if (track.smartTrainerId) {
      deviceIcons.push('<img src="assets/img/trainer_g.png" alt="스마트트레이너" class="device-icon-with-bg" title="스마트트레이너" />');
    }
    if (track.powerMeterId) {
      deviceIcons.push('<img src="assets/img/power_g.png" alt="파워메터" class="device-icon-with-bg" title="파워메터" />');
    }
    if (gearIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="기어">${gearIcon}</span>`);
    }
    if (brakeIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="브레이크">${brakeIcon}</span>`);
    }
    const deviceIconsHtml = deviceIcons.length > 0 ? deviceIcons.join('') : '';
    
    return `
      <div class="player-track-item" data-track-number="${track.trackNumber}" data-room-id="${roomId || ''}">
        <div class="player-track-number-fixed">
          <div class="player-track-number-header">
            트랙${track.trackNumber}
          </div>
        </div>
        <div class="player-track-content">
          <div class="player-track-user-section">
            <div class="player-track-name ${hasUser ? 'has-user' : 'no-user'}">
              ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
            </div>
            ${deviceIconsHtml ? `<div class="player-track-devices-right">${deviceIconsHtml}</div>` : ''}
          </div>
          <div class="player-track-action">
            ${canModify || canParticipate ? `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                onclick="assignUserToBluetoothTrackWithAnimation(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}', event)"
                title="훈련 신청/변경">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            ` : `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                disabled
                title="${!isAdmin && hasUser ? '본인이 할당한 트랙만 변경 가능합니다' : '훈련 신청/변경'}">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            `}
            ${hasUser && canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                onclick="removeUserFromBluetoothTrackWithAnimation(${track.trackNumber}, '${roomId || ''}', event)"
                title="훈련 참가 퇴실">
                <span>퇴실</span>
              </button>
            ` : hasUser && !canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                disabled
                title="본인이 할당한 트랙만 퇴실 가능합니다">
                <span>퇴실</span>
              </button>
            ` : ''}
            <a href="${dashboardUrl}" 
               target="_blank"
               class="btn btn-primary btn-default-style btn-with-icon player-enter-btn ${!hasUser || !canModify ? 'disabled' : ''}"
               ${!hasUser || !canModify ? 'aria-disabled="true" tabindex="-1"' : ''}
               onclick="handleBluetoothPlayerEnterClick(event, ${track.trackNumber}, '${roomId || ''}')"
               title="${!hasUser ? '사용자가 할당되지 않았습니다' : (!canModify ? '본인이 할당한 트랙만 입장 가능합니다' : '훈련 시작')}">
              <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" />
              <span>Enter</span>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 일괄 퇴실 버튼 표시 여부
  const btnClearAllTracks = document.getElementById('btnClearAllBluetoothTracks');
  if (btnClearAllTracks) {
    if (isAdmin || userGrade === '3' || userGrade === 3) {
      btnClearAllTracks.style.display = 'inline-flex';
    } else {
      btnClearAllTracks.style.display = 'none';
    }
  }
}

/**
 * 입장 버튼 클릭 핸들러 (애니메이션 적용)
 */
function handlePlayerEnterClick(event, trackNumber, roomId) {
  const button = event?.target?.closest('a.player-enter-btn');
  
  // 비활성화된 버튼은 클릭 무시
  if (button && (button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true')) {
    event.preventDefault();
    return;
  }
  
  // 즉시 클릭 애니메이션 효과
  if (button) {
    button.classList.add('clicking');
    setTimeout(() => {
      button.classList.remove('clicking');
    }, 300);
  }
  
  // href로 이동하는 것은 브라우저가 처리하도록 허용
  // 애니메이션은 클릭 시 즉시 표시됨
}

/**
 * Bluetooth 입장 버튼 클릭 핸들러
 */
function handleBluetoothPlayerEnterClick(event, trackNumber, roomId) {
  handlePlayerEnterClick(event, trackNumber, roomId);
}

