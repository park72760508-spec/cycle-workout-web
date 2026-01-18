/**
 * Bluetooth Training Manager
 * Bluetooth 모드 전용 트랙 관리 및 페어링 로직
 */

/**
 * Bluetooth 트랙에 사용자 할당 (애니메이션 효과 포함)
 * 로딩 애니메이션 적용 (Bluetooth Join Session 전용, 독립적 구동)
 */
async function assignUserToBluetoothTrackWithAnimation(trackNumber, currentUserId, roomIdParam, event) {
  if (event) {
    event.stopPropagation();
  }

  // 버튼 찾기
  const button = event?.target?.closest('.player-assign-btn');
  
  // 버튼이 비활성화되어 있으면 실행하지 않음
  if (button && button.disabled) {
    return;
  }

  // 로딩 애니메이션 시작
  if (button) {
    button.classList.add('loading');
    button.disabled = true;
    // 모달 표시 시 로딩 상태 해제를 위해 전역 변수에 저장
    window._currentBluetoothAssignButton = button;
  }

  try {
    // 실제 할당 함수 호출
    await assignUserToBluetoothTrack(trackNumber, currentUserId, roomIdParam);
    
    // 바로 신청 완료된 경우에만 로딩 상태 해제
    // 모달이 표시된 경우는 모달 표시 로직에서 처리
    if (button && !document.getElementById('bluetoothTrackUserSelectModal')) {
      button.classList.remove('loading');
      button.disabled = false;
      window._currentBluetoothAssignButton = null;
    }
  } catch (error) {
    // 오류 발생 시 로딩 상태 해제 (항상 복원)
    if (button) {
      button.classList.remove('loading');
      button.disabled = false;
      window._currentBluetoothAssignButton = null;
    }
    // 에러는 상위로 전파하지 않음 (이미 처리됨)
    console.error('[assignUserToBluetoothTrackWithAnimation] 처리 완료:', error.message);
  }
}

/**
 * Bluetooth 트랙에 사용자 할당 (Bluetooth 페어링 방식)
 * 로그인한 사용자 정보가 있으면 바로 신청, 없으면 모달 표시 (Bluetooth Join Session 전용, 독립적 구동)
 */
async function assignUserToBluetoothTrack(trackNumber, currentUserId, roomIdParam) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (typeof currentSelectedTrainingRoom !== 'undefined' && currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('bluetoothPlayerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[assignUserToBluetoothTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);

  // 로그인한 사용자 정보 확인 (Bluetooth Join Session 전용, 독립적 구동)
  let loggedInUser = null;
  let loggedInUserId = null;
  let userGrade = '2';
  let isAdmin = false;
  let isCoach = false;
  let hasUserInfo = false;
  
  try {
    loggedInUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (loggedInUser && loggedInUser.id != null) {
      loggedInUserId = String(loggedInUser.id);
      userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (loggedInUser?.grade ? String(loggedInUser.grade) : '2');
      isAdmin = userGrade === '1' || userGrade === 1;
      isCoach = userGrade === '3' || userGrade === 3;
      hasUserInfo = true;
      
      const userName = loggedInUser.name || loggedInUser.userName || '이름 없음';
      const userFTP = loggedInUser.ftp || null;
      const userWeight = loggedInUser.weight || null;
      
      console.log('[Bluetooth Join Session] ✅ 로그인한 사용자 정보 확인 완료:', {
        userId: loggedInUserId,
        userName: userName,
        grade: userGrade,
        ftp: userFTP || '없음',
        weight: userWeight || '없음',
        hasUserInfo: true,
        canAutoApply: true
      });
      
      // 사용자에게 정보 표시 (짧은 시간만 표시)
      // 바로 신청이 진행되므로 토스트는 표시하지 않음 (신청 완료 메시지가 표시됨)
    } else {
      hasUserInfo = false;
      console.log('[Bluetooth Join Session] ⚠️ 로그인한 사용자 정보가 없습니다. 사용자 선택 모달을 표시합니다.');
      
      // 사용자 정보가 없을 때는 모달에서 안내하므로 여기서는 토스트 표시하지 않음
    }
  } catch (e) {
    console.error('[assignUserToBluetoothTrack] 사용자 정보 확인 오류:', e);
    hasUserInfo = false;
  }
  
  const isGrade2 = userGrade === '2' || userGrade === 2;
  
  // Firebase에서 현재 트랙에 할당된 사용자 확인
  let currentTrackUser = null;
  if (typeof db !== 'undefined') {
    try {
      const sessionId = roomId;
      const usersRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      const usersSnapshot = await usersRef.once('value');
      currentTrackUser = usersSnapshot.val();
    } catch (error) {
      console.error('[assignUserToBluetoothTrack] 현재 트랙 사용자 확인 오류:', error);
    }
  }
  
  const hasCurrentUser = currentTrackUser && currentTrackUser.userId;
  
  console.log('[assignUserToBluetoothTrack] 상태 확인:', {
    hasUserInfo,
    hasLoggedInUser: !!loggedInUser,
    loggedInUserId,
    isGrade2,
    isAdmin,
    hasCurrentUser,
    currentTrackUserId: currentTrackUser?.userId,
    trackNumber,
    roomId
  });
  
  // 로그인한 사용자 정보가 있고, 트랙에 사용자가 없는 경우(신청)만 바로 신청 진행
  // 관리자가 변경 버튼을 클릭한 경우(트랙에 이미 사용자가 있음)는 모달 표시
  // 일반 사용자(grade=2)는 변경 버튼이 표시되지 않으므로 신청만 가능
  if (hasUserInfo && loggedInUser && loggedInUserId && (isGrade2 || !isAdmin)) {
    // 트랙에 이미 다른 사용자가 신청되어 있는지 확인 (Live Training Session 전용)
    if (hasCurrentUser && currentTrackUser.userId !== loggedInUserId) {
      // 이미 다른 사용자가 신청되어 있으면 안내 메시지 표시
      if (typeof showToast === 'function') {
        showToast('이미 다른 사용자가 신청되었습니다. 다른 트랙을 선택하세요.', 'warning');
      }
      console.log('[Bluetooth Join Session] 트랙에 이미 다른 사용자가 신청되어 있음:', {
        currentUserId: currentTrackUser.userId,
        loggedInUserId: loggedInUserId,
        trackNumber: trackNumber
      });
      // 버튼 로딩 상태 해제 (assignUserToBluetoothTrackWithAnimation에서 처리)
      throw new Error('이미 다른 사용자가 신청되어 있습니다.');
    }
    
    // 트랙에 사용자가 없거나 본인인 경우에만 신청 진행
    console.log('[Bluetooth Join Session] 로그인한 사용자 정보로 바로 신청 진행');
    
    try {
      // 사용자 정보로 바로 신청
      if (typeof db !== 'undefined') {
        const sessionId = roomId;
        
        // 사용자 정보 저장
        const userData = {
          userId: loggedInUserId,
          userName: loggedInUser.name || loggedInUser.userName || '',
          ftp: loggedInUser.ftp || null,
          weight: loggedInUser.weight || null
        };
        
        await db.ref(`sessions/${sessionId}/users/${trackNumber}`).set(userData);
        
        // 기존 디바이스 정보 유지 (있는 경우)
        const devicesRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
        const devicesSnapshot = await devicesRef.once('value');
        const currentDeviceData = devicesSnapshot.val() || {};
        
        // 디바이스 정보가 없으면 빈 객체로 초기화
        if (!currentDeviceData || Object.keys(currentDeviceData).length === 0) {
          await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).set({
            smartTrainerId: '',
            powerMeterId: '',
            heartRateId: '',
            gear: '',
            brake: ''
          });
        }
        
        if (typeof showToast === 'function') {
          showToast('트랙 신청이 완료되었습니다.', 'success');
        }
        
        console.log('[Bluetooth Join Session] ✅ 로그인한 사용자 정보로 바로 신청 완료:', userData);
        
        // 리스트 새로고침
        if (typeof renderBluetoothPlayerList === 'function') {
          await renderBluetoothPlayerList();
        }
        
        return; // 바로 신청 완료, 모달 표시하지 않음
      } else {
        throw new Error('Firebase가 초기화되지 않았습니다.');
      }
    } catch (error) {
      console.error('[assignUserToBluetoothTrack] 바로 신청 오류:', error);
      if (typeof showToast === 'function') {
        // 이미 다른 사용자 메시지는 위에서 표시했으므로 중복 표시하지 않음
        if (!error.message || !error.message.includes('이미 다른 사용자가 신청되어 있습니다')) {
          showToast('트랙 신청 중 오류가 발생했습니다.', 'error');
        }
      }
      // 오류 발생 시 에러를 다시 throw하여 assignUserToBluetoothTrackWithAnimation에서 버튼 상태 복원
      throw error;
    }
  }
  
  // 관리자가 변경 버튼을 클릭한 경우 또는 사용자 정보가 없는 경우 모달 표시
  if ((isAdmin && hasCurrentUser) || !hasUserInfo || !loggedInUserId) {
    console.log('[Bluetooth Join Session] 사용자 선택 모달을 표시합니다.', {
      isAdmin,
      hasCurrentUser,
      hasUserInfo,
      loggedInUserId
    });
  
    // 모달이 표시되므로 원래 버튼의 로딩 상태 해제
    // assignUserToBluetoothTrackWithAnimation에서 전달된 버튼 정보를 활용하기 위해
    // 전역 변수에 저장된 버튼 참조를 사용하여 로딩 상태 해제
    if (window._currentBluetoothAssignButton) {
      window._currentBluetoothAssignButton.classList.remove('loading');
      window._currentBluetoothAssignButton.disabled = false;
      window._currentBluetoothAssignButton = null;
    }

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
        if (typeof loadUsers === 'function') {
          await loadUsers();
          users = Array.isArray(window.users) ? window.users : [];
        }
      }
    } catch (error) {
      console.error('[assignUserToBluetoothTrack] 사용자 목록 로드 오류:', error);
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
    const modalId = 'bluetoothTrackUserSelectModal';
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
    
    // grade=2 사용자는 본인 계정만 사용 가능
    if (isGrade2 && loggedInUserId) {
      users = users.filter(user => String(user.id) === loggedInUserId);
    }

    window._allUsersForBluetoothTrackSelection = users;

    const canModifyDevices = isAdmin || isCoach || isGrade2;
    
    // Firebase에서 현재 트랙의 정보 가져오기
    let currentUserData = null;
    let currentDeviceData = null;
    
    if (typeof db !== 'undefined') {
      try {
        const sessionId = roomId;
        const usersRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
        const usersSnapshot = await usersRef.once('value');
        currentUserData = usersSnapshot.val();
        
        const devicesRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
        const devicesSnapshot = await devicesRef.once('value');
        currentDeviceData = devicesSnapshot.val();
      } catch (error) {
        console.error('[assignUserToBluetoothTrack] Firebase 정보 로드 오류:', error);
      }
    }

    // HTML 이스케이프 헬퍼 함수
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    modal.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">트랙${trackNumber} 훈련 신청 (Bluetooth)</h2>
      
      <!-- 이름 검색 입력 필드 -->
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">이름 검색</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" 
                 id="bluetoothTrackUserSearchInput" 
                 placeholder="이름을 입력하세요" 
                 style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 onkeypress="if(event.key==='Enter') searchUsersForBluetoothTrackSelection(${trackNumber}, '${roomId}')">
          <button onclick="searchUsersForBluetoothTrackSelection(${trackNumber}, '${roomId}')" 
                  id="btnSearchUsersForBluetoothTrack"
                  style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
            검색
          </button>
        </div>
      </div>
      
      <!-- 사용자 목록 컨테이너 -->
      <div id="bluetoothTrackUserListContainer" style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
        <!-- 검색 후에만 사용자 목록이 표시됩니다 -->
      </div>
      
      <!-- 선택된 사용자 표시 -->
      <div id="selectedUserForBluetoothTrack" style="display: none; margin-bottom: 20px; padding: 12px; background: #e3f2fd; border-radius: 4px; border: 2px solid #2196F3;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: bold; margin-bottom: 4px;">선택된 사용자: <span id="selectedUserNameForBluetoothTrack"></span></div>
            <div style="font-size: 0.9em; color: #666;">FTP: <span id="selectedUserFTPForBluetoothTrack"></span>W | 체중: <span id="selectedUserWeightForBluetoothTrack"></span>kg</div>
          </div>
          <span style="color: #2196F3; font-size: 24px;">✓</span>
        </div>
      </div>
      
      <!-- 디바이스 입력 필드 (Bluetooth 페어링 방식) -->
      <div id="bluetoothDeviceInputSection" style="display: none; margin-bottom: 20px;">
        <h3 style="margin: 0 0 16px 0; font-size: 1.1em; color: #333;">디바이스 정보 입력 (Bluetooth)</h3>
        
        ${canModifyDevices ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">스마트 트레이너</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" 
                   id="bluetoothTrackTrainerDeviceId" 
                   placeholder="Bluetooth 페어링 후 연결된 기기명" 
                   readonly
                   style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: #f5f5f5;">
            <button onclick="pairBluetoothDevice('trainer', 'bluetoothTrackTrainerDeviceId')" 
                    style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; white-space: nowrap;">
              페어링
            </button>
          </div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">파워메터</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" 
                   id="bluetoothTrackPowerMeterDeviceId" 
                   placeholder="Bluetooth 페어링 후 연결된 기기명" 
                   readonly
                   style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: #f5f5f5;">
            <button onclick="pairBluetoothDevice('powerMeter', 'bluetoothTrackPowerMeterDeviceId')" 
                    style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; white-space: nowrap;">
              페어링
            </button>
          </div>
        </div>
        ` : `
        <div style="margin-bottom: 16px; display: none;">
          <input type="text" id="bluetoothTrackTrainerDeviceId" style="display: none;">
          <input type="text" id="bluetoothTrackPowerMeterDeviceId" style="display: none;">
        </div>
        `}
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">심박계</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" 
                   id="bluetoothTrackHeartRateDeviceId" 
                   placeholder="Bluetooth 페어링 후 연결된 기기명" 
                   readonly
                   style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: #f5f5f5;">
            <button onclick="pairBluetoothDevice('heartRate', 'bluetoothTrackHeartRateDeviceId')" 
                    style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; white-space: nowrap;">
              페어링
            </button>
          </div>
        </div>
        
        ${canModifyDevices ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Gear</label>
            <select id="bluetoothTrackGearSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="11단">11단</option>
              <option value="12단">12단</option>
            </select>
          </div>
          
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Brake</label>
            <select id="bluetoothTrackBrakeSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="디스크">디스크</option>
              <option value="림">림</option>
            </select>
          </div>
        </div>
        ` : `
        <div style="display: none;">
          <select id="bluetoothTrackGearSelect" style="display: none;"><option value=""></option></select>
          <select id="bluetoothTrackBrakeSelect" style="display: none;"><option value=""></option></select>
        </div>
        `}
      </div>
      
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        ${canModifyDevices ? `
        <button onclick="resetBluetoothTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnResetBluetoothTrackApplication"
                style="padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          초기화
        </button>
        ` : ''}
        <button onclick="saveBluetoothTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnSaveBluetoothTrackApplication"
                style="display: none; padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          저장
        </button>
        <button onclick="closeBluetoothTrackUserSelectModal()" 
                style="padding: 10px 20px; background: #ccc; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          취소
        </button>
      </div>
    </div>
    `;
    
    // 전역 변수에 현재 트랙 정보 저장
    window._currentBluetoothTrackApplication = {
      trackNumber: trackNumber,
      roomId: roomId,
      selectedUserId: currentUserData?.userId || null,
      selectedUserName: currentUserData?.userName || null,
      selectedUserFTP: currentUserData?.ftp || null,
      selectedUserWeight: currentUserData?.weight || null
    };
    
    // 모달이 생성된 후 현재 정보로 필드 채우기
    setTimeout(() => {
    if (currentUserData && currentUserData.userId) {
      const selectedUserDiv = document.getElementById('selectedUserForBluetoothTrack');
      const selectedUserNameSpan = document.getElementById('selectedUserNameForBluetoothTrack');
      const selectedUserFTPSpan = document.getElementById('selectedUserFTPForBluetoothTrack');
      const selectedUserWeightSpan = document.getElementById('selectedUserWeightForBluetoothTrack');
      const deviceInputSection = document.getElementById('bluetoothDeviceInputSection');
      const saveBtn = document.getElementById('btnSaveBluetoothTrackApplication');
      const searchInput = document.getElementById('bluetoothTrackUserSearchInput');
      
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
      
      if (searchInput && currentUserData.userName) {
        searchInput.value = currentUserData.userName;
        setTimeout(() => {
          if (typeof searchUsersForBluetoothTrackSelection === 'function') {
            searchUsersForBluetoothTrackSelection(trackNumber, roomId);
          }
        }, 200);
      }
    }
    
    // 디바이스 정보가 있으면 입력 필드에 값 채우기
    if (currentDeviceData) {
      const trainerDeviceIdInput = document.getElementById('bluetoothTrackTrainerDeviceId');
      const powerMeterDeviceIdInput = document.getElementById('bluetoothTrackPowerMeterDeviceId');
      const heartRateDeviceIdInput = document.getElementById('bluetoothTrackHeartRateDeviceId');
      const gearSelect = document.getElementById('bluetoothTrackGearSelect');
      const brakeSelect = document.getElementById('bluetoothTrackBrakeSelect');
      
      if (trainerDeviceIdInput) {
        trainerDeviceIdInput.value = currentDeviceData.smartTrainerId || '';
      }
      
      if (powerMeterDeviceIdInput) {
        powerMeterDeviceIdInput.value = currentDeviceData.powerMeterId || '';
      }
      
      if (heartRateDeviceIdInput) {
        heartRateDeviceIdInput.value = currentDeviceData.heartRateId || '';
      }
      
      if (gearSelect) {
        gearSelect.value = currentDeviceData.gear || '';
      }
      
      if (brakeSelect) {
        brakeSelect.value = currentDeviceData.brake || '';
      }
    }
    }, 100);
  } // if 문 닫기
}

/**
 * Bluetooth 디바이스 페어링 함수
 */
async function pairBluetoothDevice(deviceType, inputId) {
  try {
    let device = null;
    let deviceName = '';
    
    // 디바이스 타입에 따라 다른 서비스 필터 사용
    if (deviceType === 'trainer') {
      // 스마트 트레이너 연결
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [
            { services: ["fitness_machine"] },
            { services: ["cycling_power"] },
            { namePrefix: "KICKR" },
            { namePrefix: "Wahoo" },
            { namePrefix: "Tacx" },
          ],
          optionalServices: ["fitness_machine", "cycling_power", "device_information"],
        });
      } catch (filterError) {
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["fitness_machine", "cycling_power", "device_information"],
        });
      }
      deviceName = device.name || '';
    } else if (deviceType === 'powerMeter') {
      // 파워메터 연결
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ services: ["cycling_power"] }],
          optionalServices: ["device_information"],
        });
      } catch {
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["cycling_power", "device_information"],
        });
      }
      deviceName = device.name || '';
    } else if (deviceType === 'heartRate') {
      // 심박계 연결
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ services: ["heart_rate"] }],
          optionalServices: ["device_information"],
        });
      } catch {
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["heart_rate", "device_information"],
        });
      }
      deviceName = device.name || '';
    }
    
    if (device && deviceName) {
      const input = document.getElementById(inputId);
      if (input) {
        input.value = deviceName;
        if (typeof showToast === 'function') {
          showToast(`✅ ${deviceName} 페어링 완료`, 'success');
        }
      }
    }
  } catch (error) {
    console.error('[pairBluetoothDevice] 페어링 오류:', error);
    if (typeof showToast === 'function') {
      showToast(`❌ 페어링 실패: ${error.message}`, 'error');
    }
  }
}

/**
 * Bluetooth 트랙에서 사용자 제거 (애니메이션 효과 포함)
 * 로딩 애니메이션 적용 (Bluetooth Join Session 전용, 독립적 구동)
 */
async function removeUserFromBluetoothTrackWithAnimation(trackNumber, roomIdParam, event) {
  if (event) {
    event.stopPropagation();
  }

  // 버튼 찾기
  const button = event?.target?.closest('.player-remove-btn');
  
  // 버튼이 비활성화되어 있으면 실행하지 않음
  if (button && button.disabled) {
    return;
  }

  // 로딩 애니메이션 시작
  if (button) {
    button.classList.add('loading');
    button.disabled = true;
  }

  try {
    await removeUserFromBluetoothTrack(trackNumber, roomIdParam);
  } finally {
    // 로딩 애니메이션 종료
    if (button) {
      button.classList.remove('loading');
      // 버튼 상태 복원 (원래 disabled 상태가 아니었다면)
      // 실제 제거 결과에 따라 버튼 상태가 변경될 수 있으므로 여기서는 강제로 활성화하지 않음
    }
  }
}

/**
 * Bluetooth 트랙에서 사용자 제거
 */
async function removeUserFromBluetoothTrack(trackNumber, roomIdParam) {
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (typeof currentSelectedTrainingRoom !== 'undefined' && currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('bluetoothPlayerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);

  // 확인 대화상자
  if (!confirm(`트랙${trackNumber}에서 퇴실하시겠습니까?`)) {
    // 확인 취소 시 로딩 상태 해제는 removeUserFromBluetoothTrackWithAnimation의 finally에서 처리
    return;
  }

  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // Firebase에서 사용자 및 디바이스 정보 제거
      await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
      await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).remove();
      
      if (typeof showToast === 'function') {
        showToast('사용자가 제거되었습니다.', 'success');
      }
      
      // 리스트 새로고침
      if (typeof renderBluetoothPlayerList === 'function') {
        await renderBluetoothPlayerList();
      }
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[removeUserFromBluetoothTrack] 사용자 제거 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 제거 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * Bluetooth 트랙 신청 초기화
 */
function resetBluetoothTrackApplication(trackNumber, roomId) {
  if (!confirm('입력한 정보를 모두 초기화하시겠습니까?')) {
    return;
  }
  
  // 입력 필드 초기화
  const searchInput = document.getElementById('bluetoothTrackUserSearchInput');
  const selectedUserDiv = document.getElementById('selectedUserForBluetoothTrack');
  const deviceInputSection = document.getElementById('bluetoothDeviceInputSection');
  const saveBtn = document.getElementById('btnSaveBluetoothTrackApplication');
  const userListContainer = document.getElementById('bluetoothTrackUserListContainer');
  
  if (searchInput) searchInput.value = '';
  if (selectedUserDiv) selectedUserDiv.style.display = 'none';
  if (deviceInputSection) deviceInputSection.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';
  if (userListContainer) userListContainer.innerHTML = '';
  
  // 디바이스 입력 필드 초기화
  const trainerInput = document.getElementById('bluetoothTrackTrainerDeviceId');
  const powerMeterInput = document.getElementById('bluetoothTrackPowerMeterDeviceId');
  const heartRateInput = document.getElementById('bluetoothTrackHeartRateDeviceId');
  const gearSelect = document.getElementById('bluetoothTrackGearSelect');
  const brakeSelect = document.getElementById('bluetoothTrackBrakeSelect');
  
  if (trainerInput) trainerInput.value = '';
  if (powerMeterInput) powerMeterInput.value = '';
  if (heartRateInput) heartRateInput.value = '';
  if (gearSelect) gearSelect.value = '';
  if (brakeSelect) brakeSelect.value = '';
  
  // 전역 변수 초기화
  window._currentBluetoothTrackApplication = {
    trackNumber: trackNumber,
    roomId: roomId,
    selectedUserId: null,
    selectedUserName: null,
    selectedUserFTP: null,
    selectedUserWeight: null
  };
}

/**
 * Bluetooth 트랙 신청 저장
 */
async function saveBluetoothTrackApplication(trackNumber, roomId) {
  const app = window._currentBluetoothTrackApplication;
  if (!app || !app.selectedUserId) {
    if (typeof showToast === 'function') {
      showToast('사용자를 선택해주세요.', 'error');
    }
    return;
  }

  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // Firebase에서 현재 트랙에 할당된 사용자 확인 (Live Training Session 전용)
      const usersRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      const usersSnapshot = await usersRef.once('value');
      const currentTrackUser = usersSnapshot.val();
      const hasCurrentUser = currentTrackUser && currentTrackUser.userId;
      
      // 트랙에 이미 다른 사용자가 신청되어 있는지 확인
      if (hasCurrentUser && currentTrackUser.userId !== app.selectedUserId) {
        // 이미 다른 사용자가 신청되어 있으면 안내 메시지 표시
        if (typeof showToast === 'function') {
          showToast('이미 다른 사용자가 신청되었습니다. 다른 트랙을 선택하세요.', 'warning');
        }
        console.log('[saveBluetoothTrackApplication] 트랙에 이미 다른 사용자가 신청되어 있음:', {
          currentUserId: currentTrackUser.userId,
          selectedUserId: app.selectedUserId,
          trackNumber: trackNumber
        });
        return; // 저장 취소
      }
      
      // 사용자 정보 저장
      const userData = {
        userId: app.selectedUserId,
        userName: app.selectedUserName,
        ftp: app.selectedUserFTP,
        weight: app.selectedUserWeight
      };
      
      await db.ref(`sessions/${sessionId}/users/${trackNumber}`).set(userData);
      
      // 디바이스 정보 저장
      const trainerInput = document.getElementById('bluetoothTrackTrainerDeviceId');
      const powerMeterInput = document.getElementById('bluetoothTrackPowerMeterDeviceId');
      const heartRateInput = document.getElementById('bluetoothTrackHeartRateDeviceId');
      const gearSelect = document.getElementById('bluetoothTrackGearSelect');
      const brakeSelect = document.getElementById('bluetoothTrackBrakeSelect');
      
      const deviceData = {
        smartTrainerId: trainerInput?.value || '',
        powerMeterId: powerMeterInput?.value || '',
        heartRateId: heartRateInput?.value || '',
        gear: gearSelect?.value || '',
        brake: brakeSelect?.value || ''
      };
      
      await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).set(deviceData);
      
      if (typeof showToast === 'function') {
        showToast('트랙 신청이 완료되었습니다.', 'success');
      }
      
      // 모달 닫기
      closeBluetoothTrackUserSelectModal();
      
      // 리스트 새로고침
      if (typeof renderBluetoothPlayerList === 'function') {
        await renderBluetoothPlayerList();
      }
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[saveBluetoothTrackApplication] 저장 오류:', error);
    if (typeof showToast === 'function') {
      showToast('저장 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * Bluetooth 트랙 사용자 선택 모달 닫기
 */
function closeBluetoothTrackUserSelectModal() {
  const modal = document.getElementById('bluetoothTrackUserSelectModal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Bluetooth 트랙 사용자 검색
 */
function searchUsersForBluetoothTrackSelection(trackNumber, roomId) {
  const searchInput = document.getElementById('bluetoothTrackUserSearchInput');
  const searchTerm = searchInput?.value?.trim().toLowerCase() || '';
  const userListContainer = document.getElementById('bluetoothTrackUserListContainer');
  
  if (!userListContainer) return;
  
  const allUsers = window._allUsersForBluetoothTrackSelection || [];
  const app = window._currentBluetoothTrackApplication || {};
  const selectedUserId = app.selectedUserId ? String(app.selectedUserId) : null;
  
  // 검색어가 없으면 빈 목록 표시
  if (!searchTerm) {
    userListContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">이름을 입력하여 검색하세요</p>';
    return;
  }
  
  // HTML 이스케이프 헬퍼 함수
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // 검색 필터링 (선택된 사용자는 제외)
  const filteredUsers = allUsers.filter(user => {
    const userName = (user.name || '').toLowerCase();
    const userId = user.id ? String(user.id) : null;
    return userName.includes(searchTerm) && userId !== selectedUserId;
  });
  
  if (filteredUsers.length === 0) {
    userListContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">검색 결과가 없습니다</p>';
    return;
  }
  
  // 사용자 목록 렌더링
  userListContainer.innerHTML = filteredUsers.map(user => {
    const userId = user.id ? String(user.id) : null;
    return `
      <div style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='#f5f5f5'"
           onmouseout="this.style.background='white'"
           onclick="selectUserForBluetoothTrackSelection(${user.id}, '${escapeHtml(user.name || '')}', ${user.ftp || 0}, ${user.weight || 0}, ${trackNumber}, '${roomId}')">
        <div style="font-weight: bold; margin-bottom: 4px;">${escapeHtml(user.name || '')}</div>
        <div style="font-size: 0.9em; color: #666;">FTP: ${user.ftp || '-'}W | 체중: ${user.weight || '-'}kg</div>
      </div>
    `;
  }).join('');
}

/**
 * Bluetooth 트랙 사용자 선택
 */
function selectUserForBluetoothTrackSelection(userId, userName, userFTP, userWeight, trackNumber, roomId) {
  const app = window._currentBluetoothTrackApplication || {};
  app.selectedUserId = userId;
  app.selectedUserName = userName;
  app.selectedUserFTP = userFTP;
  app.selectedUserWeight = userWeight;
  window._currentBluetoothTrackApplication = app;
  
  // 선택된 사용자 표시
  const selectedUserDiv = document.getElementById('selectedUserForBluetoothTrack');
  const selectedUserNameSpan = document.getElementById('selectedUserNameForBluetoothTrack');
  const selectedUserFTPSpan = document.getElementById('selectedUserFTPForBluetoothTrack');
  const selectedUserWeightSpan = document.getElementById('selectedUserWeightForBluetoothTrack');
  const deviceInputSection = document.getElementById('bluetoothDeviceInputSection');
  const saveBtn = document.getElementById('btnSaveBluetoothTrackApplication');
  
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
  
  // 사용자 목록에서 선택된 사용자 제거
  searchUsersForBluetoothTrackSelection(trackNumber, roomId);
}

/**
 * Bluetooth 트랙 일괄 퇴실
 */
async function clearAllBluetoothTracksData() {
  if (!confirm('모든 트랙의 사용자를 제거하시겠습니까?')) {
    return;
  }

  let roomId = null;
  if (typeof currentSelectedTrainingRoom !== 'undefined' && currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
    roomId = currentSelectedTrainingRoom.id;
  } else if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
    roomId = String(window.currentTrainingRoomId);
  }

  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }

  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      await db.ref(`sessions/${sessionId}/users`).remove();
      await db.ref(`sessions/${sessionId}/devices`).remove();
      
      if (typeof showToast === 'function') {
        showToast('모든 트랙이 초기화되었습니다.', 'success');
      }
      
      if (typeof renderBluetoothPlayerList === 'function') {
        await renderBluetoothPlayerList();
      }
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[clearAllBluetoothTracksData] 일괄 퇴실 오류:', error);
    if (typeof showToast === 'function') {
      showToast('일괄 퇴실 중 오류가 발생했습니다.', 'error');
    }
  }
}

// 전역 함수 노출
if (typeof window !== 'undefined') {
  window.assignUserToBluetoothTrackWithAnimation = assignUserToBluetoothTrackWithAnimation;
  window.removeUserFromBluetoothTrackWithAnimation = removeUserFromBluetoothTrackWithAnimation;
  window.pairBluetoothDevice = pairBluetoothDevice;
  window.searchUsersForBluetoothTrackSelection = searchUsersForBluetoothTrackSelection;
  window.selectUserForBluetoothTrackSelection = selectUserForBluetoothTrackSelection;
  window.saveBluetoothTrackApplication = saveBluetoothTrackApplication;
  window.resetBluetoothTrackApplication = resetBluetoothTrackApplication;
  window.closeBluetoothTrackUserSelectModal = closeBluetoothTrackUserSelectModal;
  window.clearAllBluetoothTracksData = clearAllBluetoothTracksData;
}
