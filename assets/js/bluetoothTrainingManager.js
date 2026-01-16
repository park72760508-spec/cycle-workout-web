/**
 * Bluetooth Training Manager
 * Bluetooth 모드 전용 트랙 관리 및 페어링 로직
 */

/**
 * Bluetooth 트랙에 사용자 할당 (애니메이션 효과 포함)
 */
async function assignUserToBluetoothTrackWithAnimation(trackNumber, currentUserId, roomIdParam, event) {
  if (event) {
    event.stopPropagation();
  }

  // 애니메이션 효과
  const button = event?.target?.closest('.player-assign-btn');
  if (button) {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
      button.style.transform = '';
    }, 150);
  }

  // 실제 할당 함수 호출
  await assignUserToBluetoothTrack(trackNumber, currentUserId, roomIdParam);
}

/**
 * Bluetooth 트랙에 사용자 할당 (Bluetooth 페어링 방식)
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

  // 사용자 grade 확인
  let userGrade = '2';
  let isAdmin = false;
  let isCoach = false;
  let loggedInUserId = null;
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    loggedInUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
    isCoach = userGrade === '3' || userGrade === 3;
  } catch (e) {
    console.error('[assignUserToBluetoothTrack] 사용자 grade 확인 오류:', e);
  }
  
  const isGrade2 = userGrade === '2' || userGrade === 2;
  
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
 */
async function removeUserFromBluetoothTrackWithAnimation(trackNumber, roomIdParam, event) {
  if (event) {
    event.stopPropagation();
  }

  const button = event?.target?.closest('.player-remove-btn');
  if (button) {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
      button.style.transform = '';
    }, 150);
  }

  await removeUserFromBluetoothTrack(trackNumber, roomIdParam);
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
  if (!confirm(`트랙${trackNumber}에서 사용자를 제거하시겠습니까?`)) {
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
