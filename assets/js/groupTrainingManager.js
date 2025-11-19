// Updated: 2025-11-16 12:30 (KST) - Change header auto-stamped per edit
// Updated: 2025-11-16 12:45 (KST) - Show all participants' BLE status; admin start button placement
// Updated: 2025-11-17 15:02 (KST) - 다른 사용자 상태 동기화 개선 (블루투스 상태, 메트릭 실시간 반영)

/* ==========================================================
   groupTrainingManager.js - 그룹 훈련 전용 관리 모듈
   기존 모듈들과 일관성을 유지하면서 그룹 훈련 기능 구현
========================================================== */
// ========== 모듈 중복 로딩 방지 ==========
if (window.groupTrainingManagerLoaded) {
  console.warn('⚠️ groupTrainingManager.js가 이미 로드되었습니다. 중복 로딩을 방지합니다.');
} else {
  window.groupTrainingManagerLoaded = true;



// ========== 전역 변수 초기화 ==========
window.groupTrainingManager = window.groupTrainingManager || {};


// 그룹 훈련 상태 관리 (전역으로 노출)
window.groupTrainingState = window.groupTrainingState || {
  currentRoom: null,
  isAdmin: false,
  isManager: false,
  participants: [],
  roomCode: null,
  syncInterval: null,
  managerInterval: null,
  isConnected: false,
  lastSyncTime: null,
  countdownStarted: false,  // 카운트다운 시작 여부 (중복 방지)
  readyOverrides: {}
};

// 로컬 변수로도 참조 유지 (기존 코드 호환성)
let groupTrainingState = window.groupTrainingState;

const READY_OVERRIDE_TTL = 60000; // 백엔드 동기화 지연 시 최대 60초 동안 로컬 상태 유지

function getParticipantIdentifier(participant) {
  if (!participant) return '';
  const id = participant.id ?? participant.participantId ?? participant.userId;
  return id !== undefined && id !== null ? String(id) : '';
}

function getRawReadyValue(participant) {
  if (!participant) return undefined;
  if (participant.ready !== undefined) return !!participant.ready;
  if (participant.isReady !== undefined) return !!participant.isReady;
  return undefined;
}

function getReadyOverride(participantId) {
  if (!participantId || !groupTrainingState.readyOverrides) return null;
  const override = groupTrainingState.readyOverrides[participantId];
  if (!override) return null;
  if (override.expiresAt && override.expiresAt <= Date.now()) {
    delete groupTrainingState.readyOverrides[participantId];
    return null;
  }
  return override;
}

function setReadyOverride(participantId, ready) {
  if (!participantId) return;
  if (!groupTrainingState.readyOverrides) {
    groupTrainingState.readyOverrides = {};
  }
  groupTrainingState.readyOverrides[participantId] = {
    ready: !!ready,
    expiresAt: Date.now() + READY_OVERRIDE_TTL
  };
}

function clearReadyOverride(participantId) {
  if (!participantId || !groupTrainingState.readyOverrides) return;
  if (groupTrainingState.readyOverrides[participantId]) {
    delete groupTrainingState.readyOverrides[participantId];
  }
}

function isParticipantReady(participant) {
  if (!participant) return false;
  const participantId = getParticipantIdentifier(participant);
  const override = getReadyOverride(participantId);
  if (override) {
    return !!override.ready;
  }
  const rawReady = getRawReadyValue(participant);
  return rawReady !== undefined ? rawReady : false;
}

function countReadyParticipants(participants = []) {
  if (!Array.isArray(participants)) return 0;
  return participants.reduce((count, participant) => {
    return count + (isParticipantReady(participant) ? 1 : 0);
  }, 0);
}



// 마이크 상태 관리
let microphoneState = {
  isActive: false,
  mediaStream: null,
  audioContext: null,
  analyser: null
};

// ========== 기본 유틸리티 함수들 ==========
/**
 * 고유 ID 생성 함수
 */
function generateId(prefix = 'id') {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${randomStr}`;
}

/**
 * 6자리 랜덤 방 코드 생성
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 현재 시간 문자열 생성
 */
function getCurrentTimeString() {
  return new Date().toISOString();
}

   
/**
 * 백엔드에서 받아온 방 데이터를 일관된 형태로 변환
 */
function normalizeRoomData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const participantsRaw = raw.ParticipantsData || raw.participants || [];
    let participants = [];

    if (typeof participantsRaw === 'string') {
      try {
        participants = JSON.parse(participantsRaw);
      } catch {
        participants = [];
      }
    } else if (Array.isArray(participantsRaw)) {
      participants = participantsRaw;
    }

    return {
      id: raw.ID || raw.id || raw.roomId || '',
      code: raw.Code || raw.code || raw.roomCode || '',
      name: raw.Name || raw.roomName || raw.name || '',
      workoutId: raw.WorkoutId || raw.workoutId || raw.workoutID || raw.workout_id || '',
      adminId: raw.AdminId || raw.adminId || raw.adminID || raw.AdminID || '',
      adminName: raw.AdminName || raw.adminName || '',
      maxParticipants: Number(raw.MaxParticipants || raw.maxParticipants || 0) || 0,
      status: raw.Status || raw.status || 'waiting',
      createdAt: raw.CreatedAt || raw.createdAt || null,
      updatedAt: raw.UpdatedAt || raw.updatedAt || null,
      startedAt: raw.StartedAt || raw.startedAt || null,
      trainingStartTime: raw.TrainingStartTime || raw.trainingStartTime || null,
      countdownStartTime: raw.CountdownStartTime || raw.countdownStartTime || null,
      countdownEndTime: raw.CountdownEndTime || raw.countdownEndTime || null,
      participants,
      settings: (() => {
        const s = raw.Settings || raw.settings;
        if (!s) return {};
        if (typeof s === 'string') {
          try {
            return JSON.parse(s);
          } catch {
            return {};
          }
        }
        return s;
      })()
    };
  } catch (error) {
    console.warn('normalizeRoomData 실패:', error);
    return null;
  }
}

   
const SAFEGET_SUPPRESSED_IDS = ['readyToggleBtn'];

/**
 * 안전한 요소 접근
 */
function safeGet(id) {
  const element = document.getElementById(id);
  if (!element) {
    if (id === 'roomWorkoutSelect') {
      console.log(`🔍 ${id} 요소를 찾는 중... (동적 생성 예정)`);
    } else if (!SAFEGET_SUPPRESSED_IDS.includes(id)) {
      console.warn(`Element not found: ${id}`);
    }
  }
  return element;
}


/**
 * 필수 HTML 요소들이 있는지 확인하고 없으면 생성
 */
function ensureRequiredElements() {
  const requiredElements = [
    {
      id: 'roomNameInput',
      parent: 'adminSection',
      html: '<input type="text" id="roomNameInput" class="form-control" placeholder="방 이름을 입력하세요" maxlength="20">'
    },
    {
      id: 'maxParticipants', 
      parent: 'adminSection',
      html: `<select id="maxParticipants" class="form-control">
        <option value="2">2명</option>
        <option value="4" selected>4명</option>
        <option value="6">6명</option>
        <option value="8">8명</option>
        <option value="10">10명</option>
        <option value="20">20명</option>
      </select>`
    }
  ];
  
  requiredElements.forEach(({ id, parent, html }) => {
    if (!safeGet(id)) {
      const parentEl = safeGet(parent);
      if (parentEl) {
        const wrapper = document.createElement('div');
        wrapper.className = 'form-group';
        wrapper.innerHTML = html;
        parentEl.appendChild(wrapper);
        console.log(`✅ ${id} 요소가 생성되었습니다`);
      }
    }
  });
}


   
/**
 * 토스트 메시지 표시
 */
function showToast(message, type = 'info') {
  const toast = safeGet('toast');
  if (!toast) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else {
      console.log(`[${type}] ${message}`);
    }
    return;
  }
  
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ========== JSONP API 연동 함수들 ==========

/**
 * JSONP 요청 함수 (workoutManager 방식 적용)
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
    
    console.log('그룹훈련 JSONP request to:', url, 'with params:', params);
    
    window[callbackName] = function(data) {
      if (isResolved) return;
      isResolved = true;
      
      console.log('그룹훈련 JSONP response received:', data);
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
      
      console.error('그룹훈련 JSONP script loading failed');
      cleanup();
      reject(new Error('네트워크 연결 오류'));
    };
    
    try {
      // 안전한 파라미터 인코딩
      const urlParts = [];
      Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
          const value = String(params[key]);
          urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      });
      
      // callback 파라미터 추가
      urlParts.push(`callback=${encodeURIComponent(callbackName)}`);
      
      const finalUrl = `${url}?${urlParts.join('&')}`;
      script.src = finalUrl;
      
      document.head.appendChild(script);
      
      // 타임아웃 설정 (30초)
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
 * 재시도가 포함된 JSONP 요청
 */
async function jsonpRequestWithRetry(url, params = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`그룹훈련 API 요청 시도 ${attempt}/${maxRetries}`);
      const result = await jsonpRequest(url, params);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`그룹훈련 API 요청 ${attempt}회 실패:`, error.message);
      
      if (attempt < maxRetries) {
        // 재시도 전 대기 (1초 * 시도 횟수)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}


// ========== 그룹 훈련 API 함수들 ==========

/**
 * 그룹 훈련방 생성 API 호출
 */
async function apiCreateRoom(roomData) {
  if (!roomData || typeof roomData !== 'object') {
    return { success: false, error: '유효하지 않은 방 데이터입니다.' };
  }
  
  try {
    const params = {
      action: 'createRoom',
      roomName: String(roomData.roomName || ''),
      maxParticipants: Number(roomData.maxParticipants) || 10,
      workoutId: String(roomData.workoutId || ''),
      adminId: String(roomData.adminId || ''),
      adminName: String(roomData.adminName || '')
    };
    
    console.log('방 생성 요청:', params);
    return await jsonpRequestWithRetry(window.GAS_URL, params);
  } catch (error) {
    console.error('apiCreateRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹 훈련방 조회
 */
async function apiGetRoom(roomCode) {
  if (!roomCode) {
    console.error('❌ apiGetRoom: 방 코드 누락');
    return { success: false, error: '방 코드가 필요합니다.' };
  }
  
  if (!window.GAS_URL) {
    console.error('❌ apiGetRoom: GAS_URL이 설정되지 않았습니다');
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = { 
      action: 'getRoom', 
      roomCode: String(roomCode).toUpperCase().trim()
    };
    
    console.log('📡 apiGetRoom 요청:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    console.log('📡 apiGetRoom 응답:', result);
    
    return result;
  } catch (error) {
    console.error('❌ apiGetRoom 실패:', error);
    console.error('오류 스택:', error.stack);
    
    // 네트워크 오류인지 확인
    const isNetworkError = error.message?.includes('네트워크') || 
                          error.message?.includes('Network') ||
                          error.message?.includes('연결') ||
                          error.message?.includes('시간 초과') || // timeout을 네트워크 오류로 간주
                          error.message === '네트워크 연결 오류';
    
    return { 
      success: false, 
      error: isNetworkError ? 'NETWORK_ERROR' : (error.message || '방 정보를 가져오는 중 오류가 발생했습니다.')
    };
  }
}

/**
 * 그룹 훈련방 참가
 */
async function apiJoinRoom(roomCode, participantData) {
  if (!roomCode || !participantData) {
    console.error('❌ apiJoinRoom: 필수 파라미터 누락', { roomCode, participantData });
    return { success: false, error: '방 코드와 참가자 데이터가 필요합니다.' };
  }
  
  if (!window.GAS_URL) {
    console.error('❌ apiJoinRoom: GAS_URL이 설정되지 않았습니다');
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = {
      action: 'joinRoom',
      roomCode: String(roomCode).toUpperCase().trim(),
      participantId: String(participantData.participantId || '').trim(),
      participantName: String(participantData.participantName || '참가자').trim()
    };
    
    console.log('📡 apiJoinRoom 요청:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    console.log('📡 apiJoinRoom 응답:', result);
    
    return result;
  } catch (error) {
    console.error('❌ apiJoinRoom 실패:', error);
    console.error('오류 스택:', error.stack);
    return { 
      success: false, 
      error: error.message || '방 참가 요청 중 오류가 발생했습니다.' 
    };
  }
}

/**
 * 그룹 훈련방 나가기
 */
async function apiLeaveRoom(roomCode, participantId) {
  if (!roomCode || !participantId) {
    return { success: false, error: '방 코드와 참가자 ID가 필요합니다.' };
  }

  try {
    return await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'leaveRoom',
      roomCode: String(roomCode),
      participantId: String(participantId)
    });
  } catch (error) {
    console.error('apiLeaveRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 참가자 실시간 데이터 저장
 */
async function apiSaveParticipantLiveData(roomCode, participantId, liveData) {
  if (!roomCode || !participantId || !liveData) {
    return { success: false, error: '필수 파라미터가 누락되었습니다.' };
  }
  
  if (!window.GAS_URL) {
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = {
      action: 'saveParticipantLiveData',
      roomCode: String(roomCode).toUpperCase().trim(),
      participantId: String(participantId).trim(),
      power: Number(liveData.power || 0),
      heartRate: Number(liveData.heartRate || 0),
      cadence: Number(liveData.cadence || 0),
      progress: Number(liveData.progress || 0),
      timestamp: String(liveData.timestamp || new Date().toISOString())
    };
    
    console.log('📡 실시간 데이터 전송:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    return result;
  } catch (error) {
    console.error('❌ apiSaveParticipantLiveData 실패:', error);
    return { 
      success: false, 
      error: error.message || '실시간 데이터 저장 중 오류가 발생했습니다.' 
    };
  }
}

/**
 * 그룹 훈련방 업데이트
 */
async function apiUpdateRoom(roomCode, data = {}) {
  if (!roomCode) {
    return { success: false, error: '방 코드가 필요합니다.' };
  }

  try {
    const payload = {
      action: 'updateGroupRoom',
      roomCode: String(roomCode)
    };

    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (typeof value === 'object') {
        payload[key] = JSON.stringify(value);
      } else {
        payload[key] = String(value);
      }
    });

    return await jsonpRequestWithRetry(window.GAS_URL, payload);
  } catch (error) {
    console.error('apiUpdateRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 목록 조회 API
 */
/**
 * 워크아웃 목록 조회 API (개선된 버전)
 */
async function apiGetWorkouts() {
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다. 기본 워크아웃 사용');
      return { 
        success: true, 
        items: getDefaultWorkouts() 
      };
    }
    
    console.log('워크아웃 목록 API 요청 시작');
    const result = await jsonpRequest(window.GAS_URL, { action: 'listWorkouts' });
    
    // API 응답 검증 및 정규화
    if (result && result.success) {
      console.log('API 응답 성공:', result);
      
      // 워크아웃 데이터가 있는지 확인
      let workouts = result.items || result.workouts || result.data || [];
      
      if (Array.isArray(workouts) && workouts.length > 0) {
        return { success: true, items: workouts };
      } else {
        console.warn('API에서 워크아웃 데이터가 없음. 기본 워크아웃 사용');
        return { success: true, items: getDefaultWorkouts() };
      }
    } else {
      console.warn('API 응답 실패 또는 성공하지 않음:', result);
      return { success: true, items: getDefaultWorkouts() };
    }
  } catch (error) {
    console.error('apiGetWorkouts 실패:', error);
    console.log('기본 워크아웃 목록으로 대체');
    return { success: true, items: getDefaultWorkouts() };
  }
}


/**
 * 즉시 중복 워크아웃 선택 요소 제거 (개선된 버전)
 */
function removeDuplicateWorkoutSelectsNow() {
  console.log('🧹 즉시 중복 워크아웃 선택 요소 제거 실행');
  
  const adminSection = document.getElementById('adminSection');
  if (!adminSection) {
    console.warn('adminSection을 찾을 수 없습니다');
    return;
  }
  
  try {
    // 모든 select 요소들 찾기
    const allSelects = adminSection.querySelectorAll('select');
    const workoutSelects = [];
    
    // 워크아웃 관련 select들만 필터링
    allSelects.forEach(select => {
      const hasWorkoutOptions = Array.from(select.options).some(option => 
        option.textContent.includes('SST') || 
        option.textContent.includes('Zone') || 
        option.textContent.includes('Sweet') ||
        option.textContent.includes('Threshold') ||
        option.textContent.includes('Vo2max') ||
        option.textContent.includes('워크아웃')
      );
      
      const hasWorkoutAttribute = 
        (select.id && select.id.includes('workout')) || 
        (select.name && select.name.includes('workout')) ||
        (select.className && select.className.includes('workout'));
      
      if (hasWorkoutOptions || hasWorkoutAttribute) {
        workoutSelects.push(select);
      }
    });
    
    console.log(`🔍 워크아웃 선택 요소 ${workoutSelects.length}개 발견`);
    
    // 첫 번째만 남기고 나머지 제거
    if (workoutSelects.length > 1) {
      for (let i = 1; i < workoutSelects.length; i++) {
        const selectToRemove = workoutSelects[i];
        
        // 부모 요소들 중에서 form-group, input-group 등을 찾아 제거
        let parentToRemove = selectToRemove.parentElement;
        
        // 적절한 부모 요소 찾기
        while (parentToRemove && !parentToRemove.classList.contains('form-group') && 
               !parentToRemove.classList.contains('input-group') && 
               !parentToRemove.classList.contains('field-group') &&
               parentToRemove !== adminSection) {
          parentToRemove = parentToRemove.parentElement;
        }
        
        if (parentToRemove && parentToRemove !== adminSection) {
          parentToRemove.remove();
          console.log(`✅ 중복 워크아웃 선택 그룹 제거됨 (${i}번째)`);
        } else {
          selectToRemove.remove();
          console.log(`✅ 중복 워크아웃 선택 요소 제거됨 (${i}번째)`);
        }
      }
      
      // 남은 첫 번째 요소의 ID 설정
      if (workoutSelects[0]) {
        workoutSelects[0].id = 'roomWorkoutSelect';
        console.log('✅ 첫 번째 워크아웃 선택 요소를 roomWorkoutSelect로 설정');
      }
    } else if (workoutSelects.length === 1) {
      // 하나만 있으면 ID만 설정
      workoutSelects[0].id = 'roomWorkoutSelect';
      console.log('✅ 워크아웃 선택 요소 ID를 roomWorkoutSelect로 설정');
    }
    
  } catch (error) {
    console.error('❌ 워크아웃 요소 제거 중 오류:', error);
  }
}
   



/**
 * 관리자 섹션 초기화 (간단하고 안전한 버전)
 */
async function initializeAdminSection() {
  console.log('🎯 관리자 섹션 초기화 시작');
  
  try {
    // 즉시 중복 제거
    removeDuplicateWorkoutSelectsNow();
    
    // 워크아웃 목록 로드
    setTimeout(async () => {
      try {
        await loadWorkoutsForRoom();
      } catch (error) {
        console.error('워크아웃 로드 중 오류:', error);
      }
    }, 100);
    
    console.log('✅ 관리자 섹션 초기화 완료');
    
  } catch (error) {
    console.error('❌ 관리자 섹션 초기화 중 오류:', error);
  }
}

/**
 * 워크아웃 관련 요소들 정리 (중복 제거)
 */
async function cleanupWorkoutElements(adminSection) {
  console.log('🧹 워크아웃 요소 정리 시작');
  
  // 가능한 모든 워크아웃 선택 요소들 찾기
  const workoutSelectors = [
    '#roomWorkoutSelect',
    'select[name*="workout"]',
    'select[id*="workout"]', 
    'select[class*="workout"]',
    'select[data-type="workout"]'
  ];
  
  let foundElements = [];
  
  workoutSelectors.forEach(selector => {
    const elements = adminSection.querySelectorAll(selector);
    elements.forEach(el => {
      if (!foundElements.includes(el)) {
        foundElements.push(el);
      }
    });
  });
  
  console.log(`🔍 발견된 워크아웃 관련 요소: ${foundElements.length}개`);
  
  // 중복 요소들 제거 (첫 번째 것만 남김)
  if (foundElements.length > 1) {
    for (let i = 1; i < foundElements.length; i++) {
      const elementToRemove = foundElements[i];
      console.log(`🗑️ 중복 요소 제거: ${elementToRemove.id || elementToRemove.className || 'unnamed'}`);
      
      // 부모 form-group도 함께 제거
      const parentGroup = elementToRemove.closest('.form-group, .input-group, .field-group');
      if (parentGroup) {
        parentGroup.remove();
      } else {
        elementToRemove.remove();
      }
    }
  }
  
  // 라벨 중복도 확인 및 제거
  // 라벨 중복도 확인 및 제거
const allLabels = adminSection.querySelectorAll('label');
const workoutLabels = Array.from(allLabels).filter(label => 
  label.getAttribute('for') && label.getAttribute('for').includes('workout') ||
  label.textContent.includes('훈련') || 
  label.textContent.includes('종목')
);
  if (workoutLabels.length > 1) {
    for (let i = 1; i < workoutLabels.length; i++) {
      const labelToRemove = workoutLabels[i];
      const parentGroup = labelToRemove.closest('.form-group, .input-group, .field-group');
      if (parentGroup && !parentGroup.querySelector('select')) {
        parentGroup.remove();
        console.log('🗑️ 중복 라벨 그룹 제거');
      }
    }
  }
  
  console.log('✅ 워크아웃 요소 정리 완료');
}

/**
 * 단일 워크아웃 선택 요소 확보
 */
function ensureSingleWorkoutSelect(adminSection) {
  // 남은 워크아웃 선택 요소 찾기
  let workoutSelect = adminSection.querySelector(
    '#roomWorkoutSelect, select[name*="workout"], select[id*="workout"]'
  );
  
  if (workoutSelect) {
    // 기존 요소가 있으면 ID 설정하고 사용
    workoutSelect.id = 'roomWorkoutSelect';
    console.log('✅ 기존 워크아웃 선택 요소 재사용');
    return workoutSelect;
  }
  
  // 요소가 없으면 새로 생성하지 말고 에러 리포트
  console.warn('❌ 워크아웃 선택 요소가 완전히 사라졌습니다. HTML 구조를 확인해주세요.');
  return null;
}







   
// ========== 그룹훈련 워크아웃 API 함수들 ==========

/**
 * 그룹훈련용 워크아웃 목록 조회
 */
async function apiGetGroupWorkouts() {
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다.');
      return { success: false, error: 'GAS_URL이 설정되지 않았습니다.' };
    }
    return await jsonpRequest(window.GAS_URL, { action: 'listGroupWorkouts' });
  } catch (error) {
    console.error('apiGetGroupWorkouts 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 단일 조회
 */
async function apiGetGroupWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { 
      action: 'getGroupWorkout', 
      id: String(id) 
    });
  } catch (error) {
    console.error('apiGetGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 생성
 */
async function apiCreateGroupWorkout(workoutData) {
  console.log('=== 그룹훈련 워크아웃 생성 시작 ===');
  console.log('워크아웃 데이터:', workoutData);
  
  if (!workoutData || typeof workoutData !== 'object') {
    return { success: false, error: '유효하지 않은 워크아웃 데이터입니다.' };
  }
  
  try {
    const params = {
      action: 'createGroupWorkout',
      title: String(workoutData.title || ''),
      description: String(workoutData.description || ''),
      author: String(workoutData.author || ''),
      duration: Number(workoutData.duration) || 60,
      difficulty: String(workoutData.difficulty || 'medium'),
      category: String(workoutData.category || 'general'),
      maxParticipants: Number(workoutData.maxParticipants) || 20,
      status: String(workoutData.status || 'active')
    };
    
    // 세그먼트 데이터가 있으면 추가
    if (workoutData.segments && Array.isArray(workoutData.segments)) {
      params.segments = JSON.stringify(workoutData.segments);
    }
    
    console.log('그룹훈련 워크아웃 생성 요청:', params);
    const result = await jsonpRequestWithRetry(window.GAS_URL, params);
    
    if (result && result.success) {
      console.log('✅ 그룹훈련 워크아웃 생성 성공:', result);
    } else {
      console.error('❌ 그룹훈련 워크아웃 생성 실패:', result);
    }
    
    return result;
  } catch (error) {
    console.error('apiCreateGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 수정
 */
async function apiUpdateGroupWorkout(id, workoutData) {
  if (!id || !workoutData) {
    return { success: false, error: '워크아웃 ID와 데이터가 필요합니다.' };
  }
  
  const params = {
    action: 'updateGroupWorkout',
    id: String(id),
    title: String(workoutData.title || ''),
    description: String(workoutData.description || ''),
    author: String(workoutData.author || ''),
    duration: Number(workoutData.duration) || 60,
    difficulty: String(workoutData.difficulty || 'medium'),
    category: String(workoutData.category || 'general'),
    maxParticipants: Number(workoutData.maxParticipants) || 20,
    status: String(workoutData.status || 'active')
  };
  
  // 세그먼트 데이터가 있으면 추가
  if (workoutData.segments && Array.isArray(workoutData.segments)) {
    params.segments = JSON.stringify(workoutData.segments);
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, params);
  } catch (error) {
    console.error('apiUpdateGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 삭제
 */
async function apiDeleteGroupWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { 
      action: 'deleteGroupWorkout', 
      id: String(id)
    });
  } catch (error) {
    console.error('apiDeleteGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 ID로 그룹방 조회
 */
async function getRoomsByWorkoutId(workoutId) {
  if (!workoutId) {
    return [];
  }
  
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다.');
      return [];
    }
    
    const result = await jsonpRequest(window.GAS_URL, {
      action: 'listGroupRooms',
      workoutId: String(workoutId)
    });
    
    if (result && result.success) {
      return result.items || result.rooms || [];
    }
    
    return [];
  } catch (error) {
    console.error('getRoomsByWorkoutId 실패:', error);
    return [];
  }
}




// ========== 화면 전환 함수들 ==========

/**
 * 훈련 방식 선택 (기존 ready 화면에서 호출)
 */
async function selectTrainingMode(mode) {
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
    // 혹시 남아있는 그룹 훈련 모달이 있다면 즉시 제거
    const residualGroupModal = document.getElementById('groupTrainingModal');
    if (residualGroupModal) {
      residualGroupModal.remove();
    }

    // 현재 워크아웃으로 생성된 그룹방이 있으면 자동 입장 (grade=1 관리자도 동일 동작)
    const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
    const currentWorkout = window.currentWorkout;
    
    if (currentWorkout && currentWorkout.id) {
      try {
        console.log('워크아웃으로 그룹방 자동 입장 시도:', currentWorkout.id);
        
        // 진행 중 표시
        if (typeof showLoading === 'function') {
          showLoading('그룹 훈련 입장 중입니다...');
        } else {
          showToast('그룹 훈련 입장 중입니다...', 'info');
        }
        
        // 워크아웃 ID로 그룹방 조회
        const rooms = await getRoomsByWorkoutId(currentWorkout.id);
        if (rooms && rooms.length > 0) {
          // 대기 중인 방 찾기
          const waitingRoom = rooms.find(r => 
            (r.status || r.Status || '').toLowerCase() === 'waiting'
          );
          
          if (waitingRoom) {
            const roomCode = waitingRoom.code || waitingRoom.Code;
            if (roomCode) {
              console.log('대기 중인 그룹방 발견, 자동 입장:', roomCode);
              // 바로 입장 (중간 화면 건너뛰기)
              await joinRoomByCode(roomCode);
              // 로딩 숨기기
              if (typeof hideLoading === 'function') {
                hideLoading();
              }
              return;
            }
          }
        }
        
        // 그룹방이 없거나 대기 중인 방이 없으면 안내 메시지와 함께 그룹방 화면으로 이동
        console.log('대기 중인 그룹방이 없습니다.');
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        showToast('현재 워크아웃으로 생성된 그룹방이 없습니다. 방 코드를 입력하거나 방 목록에서 선택하세요.', 'info');
        // 그룹방 화면으로 바로 이동 (참가자 역할 선택)
        if (typeof showScreen === 'function') {
          showScreen('groupRoomScreen');
        }
        if (typeof initializeGroupRoomScreen === 'function') {
          await initializeGroupRoomScreen();
        }
        // 참가자 역할 자동 선택
        if (typeof selectRole === 'function') {
          await selectRole('participant');
        }
      } catch (error) {
        console.error('그룹방 자동 입장 실패:', error);
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        showToast('그룹방 입장에 실패했습니다. 방 코드를 입력하거나 방 목록에서 선택하세요.', 'warning');
        // 그룹방 화면으로 바로 이동
        if (typeof showScreen === 'function') {
          showScreen('groupRoomScreen');
        }
        if (typeof initializeGroupRoomScreen === 'function') {
          await initializeGroupRoomScreen();
        }
        // 참가자 역할 자동 선택
        if (typeof selectRole === 'function') {
          await selectRole('participant');
        }
      }
    } else {
      // 워크아웃이 없으면 그룹방 화면으로 바로 이동
      if (typeof showScreen === 'function') {
        showScreen('groupRoomScreen');
      }
      if (typeof initializeGroupRoomScreen === 'function') {
        await initializeGroupRoomScreen();
      }
    }
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
async function selectRole(role) {
  console.log(`🎭 역할 선택: ${role}`);
  
  // 기존 선택 해제
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 현재 선택 활성화
  const currentBtn = safeGet(`${role}RoleBtn`);
  if (currentBtn) {
    currentBtn.classList.add('active');
  }
  
  // 섹션 표시/숨김
  const sections = ['adminSection', 'participantSection', 'managerSection'];
  sections.forEach(sectionId => {
    const section = safeGet(sectionId);
    if (section) {
      if (sectionId === `${role}Section`) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
  });
  
  // 상태 업데이트
  groupTrainingState.isAdmin = (role === 'admin');
  groupTrainingState.isManager = (role === 'manager');
  
  // 관리자 선택 시 워크아웃 목록 로드
// 관리자 선택 시 워크아웃 목록 로드
  if (role === 'admin') {
    await initializeAdminSection();
  }
  
  // 참가자 선택 시 방 목록 로드
  if (role === 'participant') {
    setTimeout(async () => {
      console.log('🎯 참가자 모드 - 방 목록 자동 로드 시작');
      try {
        await initializeParticipantSection();
      } catch (error) {
        console.error('참가자 섹션 초기화 실패:', error);
      }
    }, 150);
  }
  
  if (typeof showToast === 'function') {
    const roleNames = {
      admin: '관리자',
      participant: '참가자', 
      manager: '슈퍼 관리자'
    };
    showToast(`${roleNames[role]} 모드로 전환되었습니다`);
  }
}

   
  
 



   
   
// ========== 관리자 기능들 ==========

/**
 * 그룹방 생성을 위한 워크아웃 목록 로드
 */
// 워크아웃 매니저와 동일한 데이터 검증 함수들 추가
function validateWorkoutDataForGroup(workout) {
  if (!workout || typeof workout !== 'object') return false;
  if (workout.id === null || workout.id === undefined) return false;
  return true;
}

function normalizeWorkoutDataForGroup(workout) {
  return {
    id: workout.id,
    title: String(workout.title || '제목 없음'),
    description: String(workout.description || ''),
    author: String(workout.author || '미상'),
    status: String(workout.status || '보이기'),
    total_seconds: Number(workout.total_seconds) || 3600, // 기본 60분
    publish_date: workout.publish_date || null,
    segments: Array.isArray(workout.segments) ? workout.segments : []
  };
}

/**
 * 그룹방 생성을 위한 워크아웃 목록 로드 (워크아웃 매니저 방식 적용)
 */
/**
 * 그룹 방용 워크아웃 목록 로드
 */
/**
 * 그룹 방용 워크아웃 목록 로드 (개선된 버전)
 */
async function loadWorkoutsForGroupRoom() {
  console.log('🎯 그룹 방용 워크아웃 목록 로드');
  
  // 여러 가능한 워크아웃 선택 요소 확인
  const possibleSelectors = ['roomWorkoutSelect', 'workoutSelect', 'adminWorkoutSelect'];
  let workoutSelect = null;
  
  for (const selector of possibleSelectors) {
    workoutSelect = safeGet(selector);
    if (workoutSelect) {
      console.log(`워크아웃 선택 요소 발견: ${selector}`);
      break;
    }
  }
  
  if (!workoutSelect) {
    console.warn('워크아웃 선택 요소를 찾을 수 없습니다. 기본 워크아웃 목록 사용');
    // 기본 워크아웃 목록 반환
    return getDefaultWorkouts();
  }
  
  try {
    // 로딩 표시
    workoutSelect.innerHTML = '<option value="">워크아웃 로딩 중...</option>';
    
    const result = await apiGetWorkouts();
    
    // API 응답 구조 개선된 처리
    let workouts = [];
    
    if (result && result.success) {
      // 다양한 응답 구조 지원
      if (result.items && Array.isArray(result.items)) {
        workouts = result.items;
      } else if (result.workouts && Array.isArray(result.workouts)) {
        workouts = result.workouts;
      } else if (result.data && Array.isArray(result.data)) {
        workouts = result.data;
      }
    }
    
    console.log('API 응답 워크아웃 목록:', workouts);
    
    if (workouts && workouts.length > 0) {
      const options = workouts.map(workout => {
        const id = workout.id || workout.workoutId || workout.key;
        const name = workout.name || workout.title || workout.workoutName || `워크아웃 ${id}`;
        return `<option value="${id}">${escapeHtml(name)}</option>`;
      }).join('');
      
      workoutSelect.innerHTML = `
        <option value="">워크아웃을 선택하세요</option>
        ${options}
      `;
      
      console.log(`✅ ${workouts.length}개의 워크아웃 로드 완료`);
    } else {
      console.warn('워크아웃 목록이 비어있음. 기본 워크아웃 사용');
      // 기본 워크아웃 목록 사용
      loadDefaultWorkouts(workoutSelect);
    }
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    console.log('기본 워크아웃 목록으로 대체');
    loadDefaultWorkouts(workoutSelect);
  }
}

/**
 * 기본 워크아웃 목록 로드 (대체 함수)
 */
function loadDefaultWorkouts(workoutSelect) {
  const defaultWorkouts = getDefaultWorkouts();
  
  if (workoutSelect && defaultWorkouts.length > 0) {
    const options = defaultWorkouts.map(workout => 
      `<option value="${workout.id}">${escapeHtml(workout.name)}</option>`
    ).join('');
    
    workoutSelect.innerHTML = `
      <option value="">워크아웃을 선택하세요</option>
      ${options}
    `;
    
    console.log(`✅ ${defaultWorkouts.length}개의 기본 워크아웃 로드 완료`);
  }
}





   
/**
 * 워크아웃 목록 로드 (방 생성용)
 */
/**
 * 그룹훈련용 워크아웃 목록 로드 (DB 연동 버전)
 */
async function loadWorkoutsForRoom() {
  // 여러 가능한 워크아웃 선택 요소 확인 및 동적 생성
  let select = safeGet('roomWorkoutSelect');
  
  if (!select) {
    // adminSection 내부에 select 요소가 있는지 확인
    const adminSection = safeGet('adminSection');
    if (adminSection) {
      select = adminSection.querySelector('select[name*="workout"], select[id*="workout"]');
    }
  }
  
  if (!select) {
    // 동적으로 select 요소 생성 및 삽입
    const targetContainer = safeGet('adminSection') || safeGet('createRoomForm') || document.body;
    if (targetContainer) {
      // 워크아웃 선택 컨테이너 생성
      const workoutContainer = document.createElement('div');
      workoutContainer.className = 'form-group';
      workoutContainer.innerHTML = `
        <label for="roomWorkoutSelect">훈련 종목 선택:</label>
        <select id="roomWorkoutSelect" class="form-control">
          <option value="">워크아웃을 선택하세요</option>
        </select>
      `;
      
      // 기존 요소 앞에 삽입하거나 끝에 추가
      const insertPoint = targetContainer.querySelector('.form-group, .btn-group') || null;
      if (insertPoint) {
        targetContainer.insertBefore(workoutContainer, insertPoint);
      } else {
        targetContainer.appendChild(workoutContainer);
      }
      
      select = safeGet('roomWorkoutSelect');
      console.log('✅ roomWorkoutSelect 요소를 동적으로 생성했습니다');
    }
  }
  
  if (!select) {
    console.warn('❌ roomWorkoutSelect 요소를 찾을 수 없고 생성할 수도 없습니다');
    return;
  }
  
  try {
    console.log('🔄 그룹 훈련용 워크아웃 DB 로딩 시작...');
    
    // 로딩 상태 표시
    select.innerHTML = '<option value="">워크아웃 로딩 중...</option>';
    select.disabled = true;
    
    // 1순위: DB에서 그룹훈련용 워크아웃 로드
    const result = await apiGetGroupWorkouts();
    
    if (result && result.success && result.workouts && result.workouts.length > 0) {
      console.log(`✅ DB에서 ${result.workouts.length}개 그룹훈련 워크아웃을 로드했습니다`);
      
      // 기본 옵션 설정
      select.innerHTML = '<option value="">워크아웃 선택...</option>';
      
      // DB에서 로드한 워크아웃들 추가
      result.workouts.forEach(workout => {
        const option = document.createElement('option');
        option.value = workout.id;
        option.textContent = `${workout.title} (${workout.duration || 60}분)`;
        option.dataset.description = workout.description || '';
        option.dataset.difficulty = workout.difficulty || 'medium';
        option.dataset.category = workout.category || 'general';
        option.dataset.maxParticipants = workout.maxParticipants || 20;
        select.appendChild(option);
      });
      
      select.disabled = false;
      console.log('✅ DB 워크아웃 옵션 로드 완료');
      return;
    }
    
    console.warn('⚠️ DB에서 그룹훈련 워크아웃을 찾을 수 없습니다. 대체 방법을 시도합니다.');
    
    // 2순위: training.js의 loadWorkoutOptions 함수 사용
    if (typeof loadWorkoutOptions === 'function') {
      await loadWorkoutOptions();
      console.log('✅ training.js loadWorkoutOptions으로 워크아웃 옵션이 로드되었습니다');
      
      // 로드 후 옵션 개수 확인
      const optionCount = select.options.length;
      if (optionCount <= 1) { // 기본 옵션만 있는 경우
        console.warn('⚠️ 워크아웃 옵션이 부족합니다. 추가 로딩을 시도합니다.');
        await fallbackWorkoutLoading(select);
      }
      select.disabled = false;
      return;
    }
    
    // 2순위: listWorkouts 함수 직접 사용
    if (typeof listWorkouts === 'function') {
      console.log('🔄 listWorkouts 함수로 워크아웃 로딩 시도...');
      try {
        const workouts = await Promise.resolve(listWorkouts());
        if (workouts && workouts.length > 0) {
          select.innerHTML = '<option value="">워크아웃 선택...</option>';
          workouts.forEach(workout => {
            const option = document.createElement('option');
            option.value = workout.id || workout.title;
            option.textContent = `${workout.title || workout.name} (${workout.duration || workout.estimatedDuration || '?'}분)`;
            option.dataset.description = workout.description || workout.summary || '';
            select.appendChild(option);
          });
          console.log(`✅ listWorkouts로 ${workouts.length}개 워크아웃을 로드했습니다`);
          return;
        }
      } catch (err) {
        console.error('❌ listWorkouts 호출 실패:', err);
      }
    }
    
    // 3순위: 폴백 워크아웃 로딩
    console.log('🔄 폴백 워크아웃 로딩...');
    await fallbackWorkoutLoading(select);
    
  } catch (error) {
    console.error('❌ 워크아웃 로딩 전체 실패:', error);
    // 최종 에러 시 기본 옵션이라도 제공
    select.innerHTML = `
      <option value="">워크아웃 선택...</option>
      <option value="basic-training">기본 훈련 (60분)</option>
    `;
  }
}

/**
 * 폴백 워크아웃 로딩 함수
 */
async function fallbackWorkoutLoading(select) {
  try {
    // getDefaultWorkouts 함수가 있다면 사용
    if (typeof getDefaultWorkouts === 'function') {
      const defaultWorkouts = getDefaultWorkouts();
      select.innerHTML = '<option value="">워크아웃 선택...</option>';
      defaultWorkouts.forEach(workout => {
        const option = document.createElement('option');
        option.value = workout.id;
        option.textContent = `${workout.name} (${workout.duration}분)`;
        option.dataset.description = workout.description || '';
        select.appendChild(option);
      });
      console.log(`✅ 기본 워크아웃 ${defaultWorkouts.length}개를 로드했습니다`);
    } else {
      // 최종 대안: 하드코딩된 기본 옵션
      select.innerHTML = `
        <option value="">워크아웃 선택...</option>
        <option value="basic-endurance">기본 지구력 훈련 (60분)</option>
        <option value="interval-training">인터벌 훈련 (45분)</option>
        <option value="recovery-ride">회복 라이딩 (30분)</option>
      `;
      console.log('✅ 하드코딩된 기본 워크아웃을 로드했습니다');
    }
  } catch (error) {
    console.error('❌ 폴백 워크아웃 로딩 실패:', error);
  }
}

/**
 * 워크아웃 선택 화면에서 그룹훈련방 생성 (grade=1 관리자용)
 */
async function createGroupRoomFromWorkout(workoutId, workoutTitle) {
  // 권한 확인
  const currentUser = window.currentUser;
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    showToast('그룹훈련방 생성은 관리자만 가능합니다', 'error');
    return;
  }

  // 방 이름 입력 받기
  const roomName = prompt(`"${workoutTitle}" 워크아웃으로 그룹훈련방을 생성합니다.\n방 이름을 입력하세요:`, `${workoutTitle} 그룹훈련`);
  
  if (!roomName || !roomName.trim()) {
    return; // 취소 또는 빈 값
  }

  // 최대 참가자 수 선택
  const maxParticipants = prompt('최대 참가자 수를 입력하세요 (20~50명):', '20');
  const maxParticipantsNum = parseInt(maxParticipants) || 20;
  
  if (maxParticipantsNum < 20 || maxParticipantsNum > 50) {
    showToast('참가자 수는 20~50명 사이여야 합니다', 'error');
    return;
  }

  try {
    showToast('그룹훈련방을 생성 중입니다...', 'info');
    
    const roomCode = generateRoomCode();
    const roomData = {
      roomName: roomName.trim(),
      workoutId: String(workoutId),
      maxParticipants: maxParticipantsNum,
      adminId: currentUser.id || 'admin',
      adminName: currentUser.name || '관리자'
    };
    
    const result = await apiCreateRoom(roomData);
    
    if (result && result.success) {
      const createdRoom = result.room || result;
      groupTrainingState.currentRoom = normalizeRoomData(createdRoom);
      groupTrainingState.roomCode = createdRoom.roomCode || createdRoom.code || roomCode;
      groupTrainingState.isAdmin = true;
      
      showToast(`그룹훈련방 생성 완료! 방 코드: ${groupTrainingState.roomCode}`, 'success');
      
      // 대기실로 이동
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
    } else {
      throw new Error(result?.error || '방 생성 실패');
    }
  } catch (error) {
    console.error('그룹훈련방 생성 오류:', error);
    showToast('그룹훈련방 생성에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 그룹 훈련방 생성
 */
async function createGroupRoom() {
  const roomNameInput = safeGet('roomNameInput');
  let roomWorkoutSelect = safeGet('roomWorkoutSelect');
  const maxParticipantsSelect = safeGet('maxParticipants');
  
  // roomWorkoutSelect 요소가 없으면 워크아웃 로드 시도
  if (!roomWorkoutSelect) {
    console.log('🔄 roomWorkoutSelect 요소가 없어 워크아웃 목록을 먼저 로드합니다');
    await loadWorkoutsForRoom();
    roomWorkoutSelect = safeGet('roomWorkoutSelect');
  }
  
  const roomName = roomNameInput?.value?.trim();
  const workoutId = roomWorkoutSelect?.value;
  const maxParticipants = parseInt(maxParticipantsSelect?.value) || 4;
  
  if (!roomName) {
    showToast('방 이름을 입력해주세요', 'error');
    if (roomNameInput) roomNameInput.focus();
    return;
  }
  
  if (!workoutId) {
    showToast('훈련 종목을 선택해주세요', 'error');
    if (roomWorkoutSelect) roomWorkoutSelect.focus();
    return;
  }
  
  try {
    showToast('훈련방을 생성 중입니다...', 'info');
    
    // 입력 필드 비활성화 (중복 클릭 방지)
    if (roomNameInput) roomNameInput.disabled = true;
    if (roomWorkoutSelect) roomWorkoutSelect.disabled = true;
    if (maxParticipantsSelect) maxParticipantsSelect.disabled = true;
    
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
    
    // 방 생성 시도
    const success = await createRoomOnBackend(roomData);
    
    if (success) {
      // 상태 업데이트
      groupTrainingState.currentRoom = roomData;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = true;
      
      showToast(`방 생성 완료! 코드: ${roomCode}`, 'success');
      
      // 대기실로 이동
      if (typeof showScreen === 'function') {
        showScreen('waitingRoomScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      
    } else {
      throw new Error('방 생성에 실패했습니다');
    }
    
  } catch (error) {
    console.error('방 생성 중 오류:', error);
    showToast('방 생성에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
    
  } finally {
    // 입력 필드 다시 활성화
    if (roomNameInput) roomNameInput.disabled = false;
    if (roomWorkoutSelect) roomWorkoutSelect.disabled = false;
    if (maxParticipantsSelect) maxParticipantsSelect.disabled = false;
  }
}

/**
 * 백엔드에 방 생성 (임시 구현)
 */

/**
 * 백엔드에서 방 생성
 */
async function createRoomOnBackend(roomData) {
  console.log('🔄 백엔드 방 생성 요청:', roomData);
  
  try {
    const result = await apiCreateRoom(roomData);
    
    if (result && result.success) {
      console.log('✅ 백엔드 방 생성 성공:', result);
      return result;
    } else {
      console.error('❌ 백엔드 방 생성 실패:', result);
      throw new Error(result?.error || '방 생성 실패');
    }
  } catch (error) {
    console.error('createRoomOnBackend 실패:', error);
    throw error;
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
/**
 * 백엔드에서 방 목록 가져오기 (JSONP 방식으로 수정)
 */
async function getRoomsFromBackend() {
  try {
    console.log('🔄 백엔드에서 방 목록 조회 시작...');
    
    if (!window.GAS_URL) {
      throw new Error('GAS_URL이 설정되지 않았습니다.');
    }

    const result = await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'listGroupRooms',
      status: 'waiting'
    });
    
    if (result && result.success) {
      console.log(`✅ 백엔드에서 방 목록 조회 성공: ${result.items?.length || 0}개`);
      
      // 대기 중이고 자리가 있는 방들만 필터링
      const availableRooms = (result.items || result.rooms || []).filter(room => {
        const status = room.status || room.Status || 'unknown';
        const currentParticipants = (room.participants || room.ParticipantsData || []).length;
        const maxParticipants = room.maxParticipants || room.MaxParticipants || 10;
        
        return status.toLowerCase() === 'waiting' && currentParticipants < maxParticipants;
      });
      
      console.log(`✅ 참가 가능한 방: ${availableRooms.length}개`);
      return availableRooms;
      
    } else {
      console.warn('백엔드 API 응답 실패:', result?.error || 'Unknown error');
      return [];
    }
    
  } catch (error) {
    console.error('백엔드 방 목록 조회 실패:', error);
    return [];
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
    console.log('🚀 방 참가 시작:', roomCode);
    
    // 로딩 메시지 표시 (모달이 아닌 로딩 오버레이)
    let usedInlineOverlay = false;
    const ensureInlineLoadingOverlay = (message) => {
      // 간단한 인라인 로딩 오버레이 생성
      let overlay = document.getElementById('inlineLoadingOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'inlineLoadingOverlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.35)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.innerHTML = `
          <div style="background: #111; color: #fff; padding: 16px 20px; border-radius: 10px; display: flex; align-items: center; gap: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.4)">
            <div class="spinner" style="width: 22px; height: 22px; border: 3px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%; animation: spin 0.9s linear infinite;"></div>
            <span style="font-weight: 600;">${message || '처리 중...'}</span>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
        `;
        document.body.appendChild(overlay);
      } else {
        const span = overlay.querySelector('span');
        if (span) span.textContent = message || '처리 중...';
      }
    };
    const removeInlineLoadingOverlay = () => {
      const overlay = document.getElementById('inlineLoadingOverlay');
      if (overlay) overlay.remove();
    };

    if (typeof showLoading === 'function') {
      showLoading('그룹 훈련 입장 중입니다...');
    } else {
      ensureInlineLoadingOverlay('그룹 훈련 입장 중입니다...');
      usedInlineOverlay = true;
    }
    
    // 사용자 정보 확인
    if (!window.currentUser || !window.currentUser.id) {
      const errorMsg = '로그인이 필요합니다. 사용자를 선택해주세요.';
      console.error('❌ 사용자 정보 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    const participantId = window.currentUser.id;
    const participantName = window.currentUser.name || '참가자';
    console.log('👤 참가자 정보:', { participantId, participantName });
    
    // 백엔드에서 방 정보 확인
    console.log('📡 방 정보 조회 중...');
    const roomResponse = await apiGetRoom(roomCode);
    console.log('📡 방 정보 응답:', roomResponse);
    
    if (!roomResponse) {
      const errorMsg = '방 정보를 가져올 수 없습니다. 네트워크를 확인해주세요.';
      console.error('❌ 방 정보 응답 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!roomResponse.success) {
      const errorMsg = roomResponse.error || '방을 찾을 수 없습니다';
      console.error('❌ 방 조회 실패:', errorMsg);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!roomResponse.item) {
      const errorMsg = '방 정보가 없습니다. 방 코드를 확인해주세요.';
      console.error('❌ 방 데이터 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }

    console.log('🔄 방 데이터 정규화 중...');
    const room = normalizeRoomData(roomResponse.item);
    console.log('✅ 정규화된 방 데이터:', room);
    
    if (!room) {
      const errorMsg = '방 정보를 처리할 수 없습니다.';
      console.error('❌ 방 데이터 정규화 실패');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }

    // 방 상태 확인
    if (room.status !== 'waiting' && room.status !== 'starting') {
      const statusMsg = room.status === 'training' ? '이미 시작된 방입니다' :
                       room.status === 'finished' ? '이미 종료된 방입니다' :
                       room.status === 'closed' ? '닫힌 방입니다' :
                       '참가할 수 없는 상태입니다';
      console.error('❌ 방 상태 오류:', room.status);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
       if (usedInlineOverlay) {
         removeInlineLoadingOverlay();
       }
      showToast(statusMsg, 'error');
      return;
    }

    // 참가자 수 확인
    const currentParticipants = Array.isArray(room.participants) ? room.participants.length : 0;
    const maxParticipants = room.maxParticipants || 50;
    
    if (currentParticipants >= maxParticipants) {
      const errorMsg = `방이 가득 찼습니다 (${currentParticipants}/${maxParticipants})`;
      console.error('❌ 방 정원 초과');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    // 이미 참가한 사용자인지 확인
    const isAlreadyJoined = room.participants.some(p => {
      const pId = p.id || p.participantId || p.userId;
      return pId === participantId;
    });
    
    if (isAlreadyJoined) {
      console.log('ℹ️ 이미 참가한 방입니다. 대기실로 이동합니다.');
      
      // 로딩 숨기기
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      
      groupTrainingState.currentRoom = room;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = false;
      
      // 모달 닫기 (혹시 열려있다면)
      if (typeof closeJoinRoomModal === 'function') {
        closeJoinRoomModal();
      }
      const joinRoomModal = document.getElementById('joinRoomModal');
      if (joinRoomModal) {
        joinRoomModal.remove();
      }
      
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      showToast('이미 참가한 방입니다', 'info');
      return;
    }

    // 방 참가 API 호출
    console.log('📡 방 참가 API 호출 중...');
    const joinResult = await apiJoinRoom(roomCode, {
      participantId,
      participantName
    });
    console.log('📡 방 참가 응답:', joinResult);

    if (!joinResult) {
      const errorMsg = '방 참가 요청에 응답이 없습니다. 네트워크를 확인해주세요.';
      console.error('❌ 방 참가 응답 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!joinResult.success) {
      // "Already joined" 오류인 경우 재접속으로 처리
      if (joinResult.error === 'Already joined' || joinResult.error?.includes('Already joined')) {
        console.log('ℹ️ 이미 참가한 방입니다. 기존 참가 정보로 재접속합니다.');
        
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        if (usedInlineOverlay) {
          removeInlineLoadingOverlay();
        }
        
        // 방 정보 새로고침
        const refreshedRoomRes = await apiGetRoom(roomCode);
        let refreshedRoom = null;
        if (refreshedRoomRes?.success && refreshedRoomRes.item) {
          refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
        }
        
        // 상태 업데이트
        groupTrainingState.currentRoom = refreshedRoom || room;
        groupTrainingState.roomCode = roomCode;
        groupTrainingState.isAdmin = false;
        groupTrainingState.isManager = false;
        
        showToast('기존 참가 정보로 재접속했습니다', 'success');
        
        // 모달 닫기 (혹시 열려있다면)
        if (typeof closeJoinRoomModal === 'function') {
          closeJoinRoomModal();
        }
        const joinRoomModal = document.getElementById('joinRoomModal');
        if (joinRoomModal) {
          joinRoomModal.remove();
        }
        
        // 화면 전환
        if (typeof showScreen === 'function') {
          showScreen('groupWaitingScreen');
        }
        if (typeof initializeWaitingRoom === 'function') {
          initializeWaitingRoom();
        }
        return;
      }
      
      const errorMsg = joinResult.error || '방 참가에 실패했습니다';
      console.error('❌ 방 참가 실패:', errorMsg);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    // 이미 참가한 경우 (백엔드에서 alreadyJoined 플래그로 반환)
    if (joinResult.alreadyJoined) {
      console.log('ℹ️ 이미 참가한 방입니다. 기존 참가 정보로 재접속합니다.');
      
      // 로딩 숨기기
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      
      // 방 정보 새로고침
      const refreshedRoomRes = await apiGetRoom(roomCode);
      let refreshedRoom = null;
      if (refreshedRoomRes?.success && refreshedRoomRes.item) {
        refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
      }
      
      // 상태 업데이트
      groupTrainingState.currentRoom = refreshedRoom || room;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = false;
      groupTrainingState.isManager = false;
      
      showToast('기존 참가 정보로 재접속했습니다', 'success');
      
      // 모달 닫기 (혹시 열려있다면)
      if (typeof closeJoinRoomModal === 'function') {
        closeJoinRoomModal();
      }
      const joinRoomModal = document.getElementById('joinRoomModal');
      if (joinRoomModal) {
        joinRoomModal.remove();
      }
      
      // 화면 전환
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      return;
    }

    // 방 정보 새로고침
    console.log('🔄 방 정보 새로고침 중...');
    const refreshedRoomRes = await apiGetRoom(roomCode);
    console.log('📡 새로고침된 방 정보:', refreshedRoomRes);
    
    let refreshedRoom = null;
    if (refreshedRoomRes?.success && refreshedRoomRes.item) {
      refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
    }
    
    // 상태 업데이트
    groupTrainingState.currentRoom = refreshedRoom || {
      ...room,
      participants: [...(room.participants || []), { 
        id: participantId,
        participantId: participantId,
        name: participantName,
        participantName: participantName,
        role: 'participant', 
        ready: false 
      }]
    };
    groupTrainingState.roomCode = roomCode;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    
    console.log('✅ 방 참가 완료. 상태:', groupTrainingState);
    
    // 로딩 숨기기
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    if (usedInlineOverlay) {
      removeInlineLoadingOverlay();
    }
    
    showToast('방에 참가했습니다!', 'success');
    
    // 모달 닫기 (훈련실 참가 모달 등 - 혹시 열려있다면)
    if (typeof closeJoinRoomModal === 'function') {
      closeJoinRoomModal();
    }
    // 다른 모달들도 닫기
    const joinRoomModal = document.getElementById('joinRoomModal');
    if (joinRoomModal) {
      joinRoomModal.remove();
    }
    // 그룹 훈련 모달도 닫기
    const groupTrainingModal = document.getElementById('groupTrainingModal');
    if (groupTrainingModal) {
      groupTrainingModal.remove();
    }
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupWaitingScreen');
    } else {
      console.warn('⚠️ showScreen 함수를 찾을 수 없습니다');
      const waitingScreen = document.getElementById('groupWaitingScreen');
      if (waitingScreen) {
        waitingScreen.classList.remove('hidden');
      }
    }
    
    // 대기실 초기화
    if (typeof initializeWaitingRoom === 'function') {
      initializeWaitingRoom();
    } else {
      console.warn('⚠️ initializeWaitingRoom 함수를 찾을 수 없습니다');
    }
    
  } catch (error) {
    console.error('❌ 방 참가 오류:', error);
    console.error('오류 스택:', error.stack);
    
    // 로딩 숨기기
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    // 인라인 오버레이 제거
    const overlay = document.getElementById('inlineLoadingOverlay');
    if (overlay) overlay.remove();
    
    let errorMessage = '방 참가에 실패했습니다';
    if (error.message) {
      errorMessage += ': ' + error.message;
    } else if (typeof error === 'string') {
      errorMessage += ': ' + error;
    }
    
    showToast(errorMessage, 'error');
  }
}

/**
 * 방 코드로 방 정보 가져오기 (임시 구현)
 */
async function getRoomByCode(roomCode) {
  if (!roomCode) return null;

  try {
    const response = await apiGetRoom(roomCode);
    
    // 네트워크 오류인 경우와 실제 방이 없는 경우를 구분
    if (!response) {
      // 응답 자체가 없는 경우 (네트워크 오류 가능성)
      throw new Error('NETWORK_ERROR');
    }
    
    if (response.success && response.item) {
      return normalizeRoomData(response.item);
    }
    
    // 네트워크 오류인 경우
    if (response.error === 'NETWORK_ERROR' || 
        response.error?.includes('네트워크') || 
        response.error?.includes('Network') ||
        response.error?.includes('연결') ||
        response.error?.includes('시간 초과')) {
      throw new Error('NETWORK_ERROR');
    }
    
    // 방이 실제로 없는 경우 (success: false이고 error가 'Room not found' 등)
    if (response.error && (response.error.includes('not found') || 
                          response.error.includes('찾을 수 없') ||
                          response.error.includes('Room not found'))) {
      return { __roomDeleted: true }; // 방이 실제로 삭제됨
    }
    
    // 기타 오류는 네트워크 오류로 간주하지 않고 null 반환 (재시도하지 않음)
    console.warn('⚠️ 알 수 없는 오류:', response.error);
    return null;
  } catch (error) {
    // 네트워크 오류인 경우 재throw하여 호출자가 구분할 수 있도록
    if (error.message === 'NETWORK_ERROR' || error.message?.includes('네트워크') || error.message?.includes('시간 초과')) {
      throw error;
    }
    console.error('Failed to get room:', error);
    return null;
  }
}




// ========== 대기실 기능들 ==========

/**
 * 대기실 화면 초기화
 */
function initializeWaitingRoom() {
  const room = groupTrainingState.currentRoom;
  if (!room) {
    console.error('No current room found');
    return;
  }
  
  // 상단 정보를 워크아웃 세그먼트 테이블로 렌더링
  renderWaitingHeaderSegmentTable();
  
  // 관리자/참가자 컨트롤 표시
  // grade=1 사용자도 관리자로 인식
  const currentUser = window.currentUser || {};
  if (!groupTrainingState.isAdmin && (currentUser.grade === '1' || currentUser.grade === 1 || (typeof getViewerGrade === 'function' && getViewerGrade() === '1'))) {
    groupTrainingState.isAdmin = true;
    console.log('✅ grade=1 사용자를 관리자로 설정했습니다');
  }
  
  const adminControls = safeGet('adminControls');
  const participantControls = safeGet('participantControls');
  
  console.log('대기실 초기화 - 관리자 여부:', groupTrainingState.isAdmin, '사용자 grade:', currentUser.grade);
  console.log('adminControls 요소:', adminControls);
  console.log('participantControls 요소:', participantControls);
  
  if (adminControls) {
    adminControls.classList.add('hidden');
    adminControls.style.display = 'none';
    adminControls.innerHTML = '';
  }
  
  if (participantControls) {
    participantControls.classList.remove('hidden');
    participantControls.style.display = '';
    const inlineBtn = participantControls.querySelector('#startTrainingBtnInline');
    if (inlineBtn) {
      inlineBtn.remove();
    }
  }
  
  // 참가자 목록 업데이트 (기기 연결 상태 확인 포함)
  updateParticipantsList();
  setupGroupTrainingControlBar();
  
  // 대기실에서도 참가자 실시간 데이터 업로드 시작(관리자 포함)
  if (typeof startParticipantDataSync === 'function') {
    startParticipantDataSync();
  }
  
  // 메트릭 주기적 갱신 타이머 시작 (2초마다 목록 갱신)
  if (window.participantMetricsUpdateInterval) {
    clearInterval(window.participantMetricsUpdateInterval);
    window.participantMetricsUpdateInterval = null;
  }
  window.participantMetricsUpdateInterval = setInterval(() => {
    try {
      // 대기실 화면이 표시 중일 때만 갱신
      const screen = document.getElementById('groupWaitingScreen');
      if (screen && !screen.classList.contains('hidden')) {
        updateParticipantsList();
        renderWaitingHeaderSegmentTable();
      }
    } catch (e) {
      console.warn('participantMetricsUpdateInterval 오류:', e);
    }
  }, 2000);
  
  // 준비 완료 버튼 상태는 updateParticipantsList에서 기기 연결 상태를 확인하여 설정됨
  // 여기서는 추가로 준비 상태 텍스트만 업데이트
  if (!groupTrainingState.isAdmin) {
    const readyBtn = safeGet('readyToggleBtn');
    if (readyBtn) {
      // 현재 준비 상태 확인
      const currentUserId = window.currentUser?.id || '';
      const myParticipant = room.participants.find(p => {
        const pId = p.id || p.participantId || p.userId;
        return String(pId) === String(currentUserId);
      });
      if (myParticipant) {
        const isReady = isParticipantReady(myParticipant);
        readyBtn.textContent = isReady ? '✅ 준비 완료' : '⏳ 준비 중';
        readyBtn.classList.toggle('ready', isReady);
      }
      
      // 기기 연결 상태 확인하여 버튼 활성/비활성화 (updateParticipantsList와 동일한 로직)
      const connectedDevices = window.connectedDevices || {};
      const hasTrainer = !!(connectedDevices.trainer && connectedDevices.trainer.device);
      const hasPowerMeter = !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device);
      const hasHeartRate = !!(connectedDevices.heartRate && connectedDevices.heartRate.device);
      const hasBluetoothDevice = hasTrainer || hasPowerMeter || hasHeartRate;
      
      readyBtn.disabled = !hasBluetoothDevice;
      if (!hasBluetoothDevice) {
        readyBtn.title = '블루투스 기기를 먼저 연결하세요 (트레이너, 파워미터, 심박계 중 하나 이상)';
      } else {
        readyBtn.title = '';
      }
    }
  }
  
  // 시작 버튼 상태 즉시 업데이트
  updateStartButtonState();
  
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
    // 참가자 데이터 정규화 (다양한 필드명 지원)
    const normalizedParticipants = room.participants.map(p => {
      // 이름 필드 정규화
      const name = p.name || p.participantName || p.userName || p.displayName || '이름 없음';
      // ID 필드 정규화
      const id = p.id || p.participantId || p.userId || '';
      // 역할 정규화
      const role = p.role || 'participant';
      // 준비 상태 정규화
      const ready = isParticipantReady(p);
      // 참가 시간 정규화
      const joinedAt = p.joinedAt || p.joined_at || p.createdAt || new Date().toISOString();
      
      return {
        id,
        name: String(name),
        role,
        ready,
        joinedAt
      };
    });
    
    // 현재 사용자 ID 확인
    const currentUserId = window.currentUser?.id || '';
    const isCurrentUser = (participantId) => String(participantId) === String(currentUserId);
    
    // 블루투스 연결 상태 확인 함수
    const getBluetoothStatus = (participantId) => {
      // 1) 서버에 동기화된 참가자별 BLE 상태 우선 사용
      const serverParticipant = (room.participants || []).find(pp => {
        const pId = pp.id || pp.participantId || pp.userId;
        return String(pId) === String(participantId);
      }) || {};
      
      // 다양한 필드명 지원 (bluetoothStatus 우선, 그 다음 별칭 필드들)
      const serverBle = serverParticipant.bluetoothStatus || serverParticipant.ble || serverParticipant.devices || {};
      const sTrainer = !!(serverBle.trainer || 
                         serverBle.trainerConnected || 
                         serverParticipant.trainerConnected ||
                         serverBle.trainer_on);
      const sPower = !!(serverBle.powerMeter || 
                       serverBle.powerMeterConnected ||
                       serverBle.powerConnected || 
                       serverParticipant.powerConnected ||
                       serverParticipant.powerMeterConnected ||
                       serverBle.power || 
                       serverBle.power_on || 
                       serverBle.powerMeter_on);
      const sHr = !!(serverBle.heartRate || 
                    serverBle.heartRateConnected ||
                    serverBle.hrConnected || 
                    serverParticipant.hrConnected ||
                    serverParticipant.heartRateConnected ||
                    serverBle.hr || 
                    serverBle.hr_on || 
                    serverBle.bpm_on);

      // 2) 본인인 경우는 로컬 연결 상태로 보강
      if (isCurrentUser(participantId)) {
        const connectedDevices = window.connectedDevices || {};
        return {
          trainer: sTrainer || !!(connectedDevices.trainer && connectedDevices.trainer.device),
          powerMeter: sPower || !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device),
          heartRate: sHr || !!(connectedDevices.heartRate && connectedDevices.heartRate.device)
        };
      }

      // 3) 타인인 경우 서버 동기화 값 표시 (없으면 false)
      const result = {
        trainer: sTrainer,
        powerMeter: sPower,
        heartRate: sHr
      };
      
      // 디버깅: 타인의 블루투스 상태 확인 (연결된 기기가 있을 때만)
      if (sTrainer || sPower || sHr) {
        console.log(`🔌 타인 ${serverParticipant.name || participantId} 블루투스 상태:`, result, '서버 데이터:', {
          bluetoothStatus: serverParticipant.bluetoothStatus,
          trainerConnected: serverParticipant.trainerConnected,
          powerMeterConnected: serverParticipant.powerMeterConnected,
          heartRateConnected: serverParticipant.heartRateConnected
        });
      }
      
      return result;
    };
    
    const pickNumber = (...values) => {
      for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) {
          return n;
        }
      }
      return null;
    };
    
    const workout = window.currentWorkout || null;
    const trainingState = window.trainingState || {};
    const currentSegIndex = Math.max(0, Number(trainingState.segIndex) || 0);
    const currentSegment = workout?.segments?.[currentSegIndex] || null;
    const getFtpPercent = (segment) => {
      if (!segment) return null;
      if (segment.ftp_percent !== undefined && segment.ftp_percent !== null) {
        return Number(segment.ftp_percent);
      }
      if (typeof window.getSegmentFtpPercent === 'function') {
        const pct = Number(window.getSegmentFtpPercent(segment));
        if (Number.isFinite(pct)) return pct;
      }
      if (segment.target_value !== undefined && segment.target_value !== null) {
        return Number(segment.target_value);
      }
      return null;
    };
    const currentSegmentFtpPercent = getFtpPercent(currentSegment);
    
    const tableRows = normalizedParticipants.map((p, index) => {
      const rowNumber = index + 1;
      const bluetoothStatus = getBluetoothStatus(p.id);
      const isMe = isCurrentUser(p.id);
      
      const hasBluetoothDevice = isMe && (bluetoothStatus.trainer || bluetoothStatus.powerMeter || bluetoothStatus.heartRate);
      
      const deviceStatusIcons = `
        <span class="ble-icons" aria-label="기기 연결 상태">
          <span class="device-badge" title="심박계">
            <img src="assets/img/${bluetoothStatus.heartRate ? 'bpm_g.png' : 'bpm_i.png'}" alt="심박계" onerror="this.onerror=null; this.src='assets/img/bpm_i.png';" />
          </span>
          <span class="device-badge" title="파워미터">
            <img src="assets/img/${bluetoothStatus.powerMeter ? 'power_g.png' : 'power_i.png'}" alt="파워미터" onerror="this.onerror=null; this.src='assets/img/power_i.png';" />
          </span>
          <span class="device-badge" title="스마트 트레이너">
            <img src="assets/img/${bluetoothStatus.trainer ? 'trainer_g.png' : 'trainer_i.png'}" alt="스마트 트레이너" onerror="this.onerror=null; this.src='assets/img/trainer_i.png';" />
          </span>
        </span>
      `;

      const serverParticipant = (room.participants || []).find(pp => {
        const pId = pp.id || pp.participantId || pp.userId;
        return String(pId) === String(p.id);
      }) || {};
      const serverMetrics = serverParticipant.metrics || serverParticipant.live || serverParticipant.liveData || serverParticipant || {};
      const participantFtp = pickNumber(
        serverParticipant.ftp,
        serverParticipant.FTP,
        serverParticipant.userFtp,
        serverParticipant.profileFtp,
        serverParticipant.powerFtp,
        serverParticipant?.stats?.ftp
      );

      const liveData = (isMe ? (window.liveData || {}) : {});
      
      const computeTargetPower = () => {
        const direct = pickNumber(
          serverMetrics.segmentTargetPowerW,
          serverMetrics.targetPowerW,
          serverMetrics.segmentTargetPower,
          serverParticipant.targetPowerW,
          serverParticipant.segmentTargetPowerW,
          serverParticipant.liveData?.targetPower,
          serverParticipant.live?.targetPower
        );
        if (direct !== null) return direct;
        
        const ftpPercent = currentSegmentFtpPercent;
        if (!ftpPercent) {
          const fallback = pickNumber(
            trainingState.currentTargetPowerW,
            trainingState.targetPowerW,
            liveData.targetPower
          );
          return fallback;
        }
        
        if (isMe) {
          const ftp = pickNumber(window.currentUser?.ftp);
          if (ftp) return Math.round(ftp * ftpPercent / 100);
          const fromLive = pickNumber(liveData.targetPower);
          if (fromLive !== null) return fromLive;
        } else if (participantFtp) {
          return Math.round(participantFtp * ftpPercent / 100);
        }
        
        return null;
      };
      
      const targetPower = computeTargetPower();
      const avgPower = isMe
        ? pickNumber(liveData.avgPower, liveData.averagePower, serverMetrics.segmentAvgPowerW, serverMetrics.avgPower, serverMetrics.averagePower)
        : pickNumber(serverMetrics.segmentAvgPowerW, serverMetrics.avgPower, serverMetrics.averagePower, serverMetrics.segmentAvgPower, serverParticipant.liveData?.avgPower);
      const currentPower = isMe
        ? pickNumber(liveData.power, liveData.instantPower, liveData.watts, serverMetrics.currentPower)
        : pickNumber(serverMetrics.currentPower, serverMetrics.power, serverMetrics.currentPowerW, serverParticipant.liveData?.power);
      const heartRate = isMe
        ? pickNumber(liveData.heartRate, liveData.hr, liveData.bpm, serverMetrics.heartRate)
        : pickNumber(serverMetrics.heartRate, serverMetrics.hr, serverParticipant.liveData?.heartRate);
      const cadence = isMe
        ? pickNumber(liveData.cadence, liveData.rpm, serverMetrics.cadence)
        : pickNumber(serverMetrics.cadence, serverMetrics.rpm, serverParticipant.liveData?.cadence);
      const fmt = (v, unit) => {
        if (typeof v === 'number' && isFinite(v)) {
          return `${Math.round(v)}${unit ? `<span class="metric-unit">${unit}</span>` : ''}`;
        }
        return '-';
      };

      const readyStatusChip = `<span class="ready-chip ${ready ? 'ready' : 'not-ready'}">${ready ? '준비완료' : '준비중'}</span>`;
      const readyToggleInline = (isMe && hasBluetoothDevice) ? `
        <button class="btn btn-xs ready-toggle-inline ${ready ? 'ready' : ''}" 
                id="readyToggleBtn"
                onclick="toggleReady()">
          ${ready ? '✅ 준비완료' : '⏳ 준비하기'}
        </button>
      ` : (isMe ? `<span class="ready-hint">기기를 연결해주세요</span>` : '-');
      
      const isCurrentSegment = currentSegment && p.currentSegmentIndex !== undefined
        ? Number(p.currentSegmentIndex) === currentSegIndex
        : false;
      const rowClasses = [
        isMe ? 'current-user' : '',
        isCurrentSegment ? 'segment-active' : ''
      ].filter(Boolean).join(' ');

      return `
        <tr class="${rowClasses}">
          <td>${rowNumber}</td>
          <td class="participant-name-cell">
            <span class="participant-name-text">${escapeHtml(p.name)}${isMe ? ' (나)' : ''}</span>
          </td>
          <td>${deviceStatusIcons}</td>
          <td>${fmt(targetPower, '<span>W</span>')}</td>
          <td>${fmt(avgPower, '<span>W</span>')}</td>
          <td>${fmt(currentPower, '<span>W</span>')}</td>
          <td>${fmt(heartRate, '<span>bpm</span>')}</td>
          <td>${fmt(cadence, '<span>rpm</span>')}</td>
          <td>${readyStatusChip}</td>
          <td>${readyToggleInline}</td>
        </tr>
      `;
    }).join('') || `
      <tr>
        <td colspan="10" class="empty-state">참가자가 없습니다. 첫 번째로 참여해보세요!</td>
      </tr>
    `;

    // 스크롤 위치 보존: 업데이트 전 현재 스크롤 위치 저장
    const existingWrapper = listEl.querySelector('.participant-table-wrapper');
    const savedScrollLeft = existingWrapper ? existingWrapper.scrollLeft : 0;
    const savedScrollTop = existingWrapper ? existingWrapper.scrollTop : 0;
    
    listEl.innerHTML = `
      <div class="participant-table-wrapper">
        <table class="participant-table">
          <thead>
            <tr>
              <th>순번</th>
              <th>사용자명</th>
              <th>기기 연결</th>
              <th>목표값</th>
              <th>랩파워</th>
              <th>현재파워</th>
              <th>심박수</th>
              <th>케이던스</th>
              <th>상태</th>
              <th>동작</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `;
    
    // 스크롤 위치 복원: 업데이트 후 저장된 스크롤 위치로 복원
    requestAnimationFrame(() => {
      const newWrapper = listEl.querySelector('.participant-table-wrapper');
      if (newWrapper) {
        newWrapper.scrollLeft = savedScrollLeft;
        newWrapper.scrollTop = savedScrollTop;
      }
    });
    
    // 관리자 전용 제어 블록 추가 (참가자 목록 아래)
    // grade=1 사용자 또는 isAdmin인 경우 표시
    const currentUser = window.currentUser || {};
    const isAdminUser = groupTrainingState.isAdmin || 
                       currentUser.grade === '1' || 
                       currentUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    
    if (isAdminUser) {
      const participantsListContainer = listEl.parentElement;
      let adminControlsBlock = participantsListContainer.querySelector('.admin-training-controls-block');
      
      if (!adminControlsBlock) {
        adminControlsBlock = document.createElement('div');
        adminControlsBlock.className = 'admin-training-controls-block';
        participantsListContainer.appendChild(adminControlsBlock);
      }
      
      // 관리자 제어 블록 렌더링
      adminControlsBlock.innerHTML = `
        <div class="admin-controls-header">
          <h4>관리자 제어</h4>
          <p class="controls-hint">훈련 시작 버튼을 누르면 모든 참가자가 동시에 훈련을 시작합니다</p>
        </div>
        <div class="admin-training-controls">
          <button id="adminStartTrainingBtn" class="enhanced-control-btn play" aria-label="훈련 시작" title="훈련 시작">
          </button>
          <button id="adminPauseTrainingBtn" class="enhanced-control-btn pause" aria-label="일시정지/재생" title="일시정지/재생" disabled>
          </button>
          <button id="adminSkipSegmentBtn" class="enhanced-control-btn skip" aria-label="구간 건너뛰기" title="구간 건너뛰기" disabled>
          </button>
          <button id="adminStopTrainingBtn" class="enhanced-control-btn stop" aria-label="훈련 종료" title="훈련 종료" disabled>
          </button>
        </div>
      `;
      
      // 이벤트 리스너 설정
      const startBtn = adminControlsBlock.querySelector('#adminStartTrainingBtn');
      const pauseBtn = adminControlsBlock.querySelector('#adminPauseTrainingBtn');
      const skipBtn = adminControlsBlock.querySelector('#adminSkipSegmentBtn');
      const stopBtn = adminControlsBlock.querySelector('#adminStopTrainingBtn');
      
      if (startBtn) {
        startBtn.onclick = () => startGroupTrainingWithCountdown();
      }
      if (pauseBtn) {
        pauseBtn.onclick = () => {
          const ts = window.trainingState || {};
          if (ts.paused) {
            if (typeof togglePause === 'function') togglePause();
          } else {
            if (typeof togglePause === 'function') togglePause();
          }
        };
      }
      if (skipBtn) {
        skipBtn.onclick = () => {
          if (typeof skipCurrentSegment === 'function') skipCurrentSegment();
        };
      }
      if (stopBtn) {
        stopBtn.onclick = () => {
          if (confirm('정말 훈련을 종료하시겠습니까?')) {
            if (typeof stopSegmentLoop === 'function') stopSegmentLoop();
          }
        };
      }
      
      // 훈련 상태에 따른 버튼 활성화
      const ts = window.trainingState || {};
      const isRunning = !!ts.isRunning;
      const isPaused = !!ts.paused;
      
      if (startBtn) {
        startBtn.disabled = isRunning && !isPaused;
        if (isRunning && !isPaused) {
          startBtn.classList.remove('play');
          startBtn.classList.add('hidden');
        } else {
          startBtn.classList.remove('hidden');
          startBtn.classList.add('play');
        }
      }
      if (pauseBtn) {
        pauseBtn.disabled = !isRunning;
        pauseBtn.classList.remove('play', 'pause');
        pauseBtn.classList.add(isPaused ? 'play' : 'pause');
      }
      if (skipBtn) {
        skipBtn.disabled = !isRunning;
      }
      if (stopBtn) {
        stopBtn.disabled = !isRunning;
      }
    } else {
      // 관리자가 아니면 제어 블록 제거
      const participantsListContainer = listEl.parentElement;
      const adminControlsBlock = participantsListContainer?.querySelector('.admin-training-controls-block');
      if (adminControlsBlock) {
        adminControlsBlock.remove();
      }
    }

    // 본인의 준비완료 버튼 상태 업데이트
    const readyBtn = safeGet('readyToggleBtn');
    if (readyBtn) {
      const myParticipant = normalizedParticipants.find(p => isCurrentUser(p.id));
      if (myParticipant) {
        // 트레이너, 파워미터, 심박계 중 하나 이상 연결되면 활성화
        // getBluetoothStatus와 동일한 로직 사용 (device 속성 확인)
        const connectedDevices = window.connectedDevices || {};
        const hasTrainer = !!(connectedDevices.trainer && connectedDevices.trainer.device);
        const hasPowerMeter = !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device);
        const hasHeartRate = !!(connectedDevices.heartRate && connectedDevices.heartRate.device);
        const hasBluetoothDevice = hasTrainer || hasPowerMeter || hasHeartRate;
        
        console.log('기기 연결 상태 확인:', {
          trainer: hasTrainer,
          powerMeter: hasPowerMeter,
          heartRate: hasHeartRate,
          hasBluetoothDevice: hasBluetoothDevice,
          connectedDevices: connectedDevices
        });
        
        readyBtn.disabled = !hasBluetoothDevice;
        if (!hasBluetoothDevice) {
          readyBtn.title = '블루투스 기기를 먼저 연결하세요 (트레이너, 파워미터, 심박계 중 하나 이상)';
        } else {
          readyBtn.title = '';
        }
      }
    }
  }
  
  // 시작 버튼 활성화 체크
  updateStartButtonState();
}

/**
 * 대기실 상단: 워크아웃 세그먼트 테이블 렌더링
 */
function renderWaitingHeaderSegmentTable() {
  try {
    const screen = document.getElementById('groupWaitingScreen');
    if (!screen) return;
    const roomInfoCard = screen.querySelector('.room-info.card');
    if (!roomInfoCard) return;

    if (!window.currentWorkout || !Array.isArray(window.currentWorkout.segments)) {
      console.warn('No workout segments available for waiting room table');
      return;
    }

    const workout = window.currentWorkout;
    const segments = workout.segments;
    const room = groupTrainingState.currentRoom || {};

    // 현재 세그먼트 인덱스 계산
    const ts = window.trainingState || {};
    const elapsed = Number(ts.elapsedSec || 0);
    let currentIdx = -1;
    let currentSegStart = 0;
    let currentSegRemaining = null;
    if (segments.length > 0) {
      let start = 0;
      for (let i = 0; i < segments.length; i++) {
        const segDur = Number(segments[i].duration_sec || segments[i].duration || 0);
        const end = start + segDur;
        if (elapsed >= start && elapsed < end) {
          currentIdx = i;
          currentSegStart = start;
          const segElapsed = Math.max(0, elapsed - start);
          currentSegRemaining = Math.max(0, segDur - segElapsed);
          break;
        }
        start = end;
      }
    }

    const formatDuration = (sec) => {
      const value = Number(sec || 0);
      if (!Number.isFinite(value) || value <= 0) return '-';
      const m = Math.floor(value / 60).toString().padStart(2, '0');
      const s = Math.floor(value % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    const formatTimer = (sec) => {
      const value = Number(sec);
      if (!Number.isFinite(value) || value < 0) return '--:--';
      const total = Math.max(0, Math.floor(value));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const elapsedTimer = formatTimer(elapsed);
    const segmentTimer = currentIdx >= 0 ? formatTimer(currentSegRemaining) : '--:--';

    // 훈련 시작 여부 확인 (elapsed > 0이면 훈련이 시작된 것으로 판단)
    const isTrainingStarted = elapsed > 0;

    const tableRows = segments.map((seg, idx) => {
      const label = seg.label || seg.name || seg.title || `세그먼트 ${idx + 1}`;
      const segType = (seg.segment_type || seg.type || '-').toString().toUpperCase();
      const ftp = Math.round(Number(
        seg.target_value ??
        seg.targetValue ??
        seg.target ??
        seg.target_power_w ??
        seg.targetPowerW ??
        seg.target_power ??
        seg.intensity ??
        0
      ));
      const durationStr = formatDuration(seg.duration_sec ?? seg.duration);
      const isActive = isTrainingStarted && idx === currentIdx;

      return `
        <tr class="${isActive ? 'active' : ''}">
          <td class="seg-col-index"><span class="seg-index-badge">${idx + 1}</span></td>
          <td class="seg-col-label"><span class="seg-label">${escapeHtml(String(label))}</span></td>
          <td class="seg-col-type"><span class="seg-type">${segType}</span></td>
          <td class="seg-col-ftp">${Number.isFinite(ftp) ? `${ftp}<small class="unit">%</small>` : '-'}</td>
          <td class="seg-col-duration">${durationStr}</td>
        </tr>
      `;
    }).join('');

    const workoutTitle = escapeHtml(String(workout.title || workout.name || '워크아웃'));

    roomInfoCard.innerHTML = `
      <div class="workout-table-card">
        <div class="workout-table-head">
          <div class="workout-title">
            <span class="icon">📋</span>
            <div>
              <h3>${workoutTitle}</h3>
              <p>${segments.length || 0}개 세그먼트 • 실시간 진행 상황</p>
            </div>
          </div>
          <div class="workout-status-pill ${currentIdx >= 0 ? 'is-live' : ''}">
            ${currentIdx >= 0 ? `현재 ${currentIdx + 1}번째 구간` : '대기 중'}
          </div>
        </div>
        <div class="workout-timers">
          <div class="workout-timer elapsed">
            <div class="timer-icon">⏱️</div>
            <div class="timer-content">
              <span class="timer-label">경과 시간</span>
              <span class="timer-value">${elapsedTimer}</span>
            </div>
          </div>
          <div class="workout-timer segment">
            <div class="timer-icon">⏳</div>
            <div class="timer-content">
              <span class="timer-label">세그먼트 카운트다운</span>
              <span class="timer-value">${segmentTimer}</span>
            </div>
          </div>
        </div>
        <div class="workout-table-wrapper">
          <table class="workout-table">
            <thead>
              <tr>
                <th class="col-index">#</th>
                <th class="col-label">세그먼트명</th>
                <th class="col-type">세그먼트 타입</th>
                <th class="col-ftp">FTP 강도</th>
                <th class="col-duration">시간</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || '<tr><td colspan="5" class="empty-segment">등록된 세그먼트가 없습니다.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // 테이블 스크롤 설정 및 활성 세그먼트 추적
    requestAnimationFrame(() => {
      const wrapper = roomInfoCard.querySelector('.workout-table-wrapper');
      const rows = Array.from(wrapper?.querySelectorAll('tbody tr') || []);
      if (!wrapper || rows.length === 0) return;

      // 훈련 시작 전 스크롤 위치 보존을 위한 저장소 키
      const scrollStorageKey = `workoutTableScroll_${room.roomCode || 'default'}`;
      
      // 현재 스크롤 위치 가져오기 (렌더링 전 사용자가 설정한 위치)
      const currentScrollTop = wrapper.scrollTop;
      
      // 저장된 스크롤 위치 읽기
      let savedScrollTop = null;
      try {
        const saved = sessionStorage.getItem(scrollStorageKey);
        if (saved !== null) {
          savedScrollTop = Number(saved);
        }
      } catch (e) {
        console.warn('스크롤 위치 저장소 읽기 실패:', e);
      }

      const maxVisible = Math.min(3, rows.length);
      if (rows.length > maxVisible) {
        const rowHeight = rows[0].offsetHeight || 0;
        wrapper.style.maxHeight = `${rowHeight * maxVisible + 4}px`;
      } else {
        wrapper.style.removeProperty('max-height');
      }

      // 훈련이 시작된 경우에만 활성 세그먼트 추적 스크롤 실행
      if (isTrainingStarted && currentIdx >= 0) {
        const activeRow = wrapper.querySelector('tbody tr.active');
        if (activeRow) {
          const header = wrapper.querySelector('thead');
          const headerHeight = header ? header.offsetHeight : 0;
          const rowHeight = rows[0]?.offsetHeight || 0;
          
          // 헤더 바로 아래에 활성 세그먼트가 보이도록 스크롤 위치 계산
          // 활성 행을 헤더 바로 아래에 배치
          const targetScroll = Math.max(0, activeRow.offsetTop - headerHeight - 2);
          
          wrapper.scrollTop = targetScroll;
        }
      } else {
        // 훈련 시작 전: 사용자가 스크롤한 위치 유지 (자동 복귀 없음)
        // 현재 스크롤 위치가 있으면 그것을 우선 사용, 없으면 저장된 위치 사용
        if (currentScrollTop > 0) {
          // 사용자가 이미 스크롤한 위치가 있으면 그대로 유지
          wrapper.scrollTop = currentScrollTop;
        } else if (savedScrollTop !== null && savedScrollTop > 0) {
          // 저장된 스크롤 위치 복원
          wrapper.scrollTop = savedScrollTop;
        }
        // 둘 다 없으면 스크롤 위치 변경하지 않음 (상단 유지)
      }

      // 사용자 스크롤 이벤트 감지하여 위치 저장 (훈련 시작 전에만)
      if (!isTrainingStarted) {
        // 기존 이벤트 리스너 제거 (중복 방지)
        const existingHandler = wrapper._scrollHandler;
        if (existingHandler) {
          wrapper.removeEventListener('scroll', existingHandler);
        }

        // 새로운 스크롤 핸들러 생성
        const handleScroll = () => {
          const scrollTop = wrapper.scrollTop;
          try {
            sessionStorage.setItem(scrollStorageKey, String(scrollTop));
          } catch (e) {
            console.warn('스크롤 위치 저장 실패:', e);
          }
        };

        // 핸들러 저장 및 이벤트 등록
        wrapper._scrollHandler = handleScroll;
        wrapper.addEventListener('scroll', handleScroll, { passive: true });
      } else {
        // 훈련 시작 후에는 스크롤 이벤트 리스너 제거
        const existingHandler = wrapper._scrollHandler;
        if (existingHandler) {
          wrapper.removeEventListener('scroll', existingHandler);
          delete wrapper._scrollHandler;
        }
      }
    });
  } catch (error) {
    console.warn('renderWaitingHeaderSegmentTable 오류:', error);
  }
}

/**
 * 백엔드에 방 데이터 업데이트 (임시 구현)
 */
async function updateRoomOnBackend(roomData) {
  if (!roomData || !roomData.code) {
    console.warn('updateRoomOnBackend: roomData.code가 필요합니다');
    return false;
  }

  try {
    const payload = {
      roomName: roomData.name || roomData.roomName || '',
      maxParticipants: roomData.maxParticipants,
      workoutId: roomData.workoutId || roomData.workoutID || '',
      status: roomData.status,
      participants: roomData.participants || [],
      settings: roomData.settings || {}
    };

    const result = await apiUpdateRoom(roomData.code, payload);
    return !!(result && result.success);
  } catch (error) {
    console.error('updateRoomOnBackend 실패:', error);
    return false;
  }
}



   
/**
 * 시작 버튼 상태 업데이트
 */
function updateStartButtonState() {
  const startBtn = safeGet('startGroupTrainingBtn');
  if (!startBtn || !groupTrainingState.isAdmin) {
    // 관리자가 아니면 버튼 숨기기
    if (startBtn) {
      startBtn.style.display = 'none';
    }
    return;
  }
  
  // 관리자면 버튼 표시
  if (startBtn) {
    startBtn.style.display = '';
  }
  
  const room = groupTrainingState.currentRoom;
  if (!room || !room.participants) {
    startBtn.disabled = true;
    startBtn.textContent = '⏳ 방 정보 로딩 중...';
    return;
  }
  
  const totalParticipants = room.participants.length;
  const readyCount = room.participants.reduce((count, participant) => {
    return count + (isParticipantReady(participant) ? 1 : 0);
  }, 0);
  
  const hasParticipants = totalParticipants >= 2; // 최소 2명
  const canStart = hasParticipants;
  
  startBtn.disabled = !canStart;
  startBtn.textContent = canStart
    ? `🚀 그룹 훈련 시작 (${readyCount}/${totalParticipants}명 준비)`
    : '👥 참가자 대기 중 (최소 2명 필요)';
  startBtn.title = `${readyCount}/${totalParticipants}명 준비 완료`;
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
 * 방 나가기 (조용히 - API 호출 실패 무시)
 */
async function leaveGroupRoomSilently() {
  try {
    // 동기화 인터벌 정리
    stopRoomSync();
    // 메트릭 인터벌 정리
    if (window.participantMetricsUpdateInterval) {
      clearInterval(window.participantMetricsUpdateInterval);
      window.participantMetricsUpdateInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 훈련 시작 신호 확인 인터벌 정리
    if (window.trainingStartCheckInterval) {
      clearInterval(window.trainingStartCheckInterval);
      window.trainingStartCheckInterval = null;
    }
    
    // 방에서 참가자 제거 시도 (실패해도 무시)
    if (groupTrainingState.roomCode) {
      try {
        const userId = window.currentUser?.id || 'unknown';
        await apiLeaveRoom(groupTrainingState.roomCode, userId);
      } catch (error) {
        // 조용히 실패 처리
        console.log('방 나가기 API 호출 실패 (무시):', error.message);
      }
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupTrainingScreen');
    }
    
  } catch (error) {
    console.error('leaveGroupRoomSilently 오류:', error);
  }
}

/**
 * 방 데이터 동기화
 */
// 네트워크 오류 카운터 (연속 실패 추적)
let networkErrorCount = 0;
const MAX_NETWORK_ERRORS = 10; // 연속 10번 실패하면 동기화만 중지 (사용자는 방에 남음)

async function syncRoomData() {
  if (!groupTrainingState.roomCode) {
    // 방 코드가 없으면 동기화 중지
    stopRoomSync();
    return;
  }
  
  try {
    const latestRoom = await getRoomByCode(groupTrainingState.roomCode);
    
    // 성공적으로 방 정보를 가져온 경우 오류 카운터 리셋
    if (latestRoom && !latestRoom.__roomDeleted) {
      networkErrorCount = 0;

      // 참가자 라이브 데이터 조회 후 병합(모든 참가자의 화면에 실시간 반영)
      let mergedRoom = latestRoom;
      try {
        if (typeof apiGetParticipantsLiveData === 'function') {
          const liveRes = await apiGetParticipantsLiveData(groupTrainingState.roomCode);
          const liveItems = Array.isArray(liveRes?.items) ? liveRes.items : [];
          
          // 디버깅: 라이브 데이터 수신 확인
          if (liveItems.length > 0) {
            console.log(`📊 라이브 데이터 수신: ${liveItems.length}명의 참가자 데이터`, liveItems);
          }
          
          if (Array.isArray(mergedRoom.participants) && liveItems.length > 0) {
            const idOf = (p) => String(p.id || p.participantId || p.userId || '');
            const liveById = {};
            liveItems.forEach(item => {
              const pid = String(item.participantId || item.id || item.userId || '');
              if (!pid) return;
              liveById[pid] = item;
            });
            mergedRoom.participants = mergedRoom.participants.map(p => {
              const pid = idOf(p);
              const live = liveById[pid];
              if (!live) return p;
              
              // 블루투스 상태 병합 (다양한 필드명 지원)
              const bluetoothStatus = live.bluetoothStatus || {
                trainer: !!(live.trainerConnected || live.trainer || live.trainer_on),
                powerMeter: !!(live.powerMeterConnected || live.powerConnected || live.powerMeter || live.power || live.power_on || live.powerMeter_on),
                heartRate: !!(live.heartRateConnected || live.hrConnected || live.heartRate || live.hr || live.hr_on || live.bpm_on)
              };
              
              // 메트릭 병합 (다양한 필드명 지원)
              const metrics = {
                segmentTargetPowerW: live.segmentTargetPowerW ?? live.targetPowerW ?? live.segmentTargetPower ?? null,
                segmentAvgPowerW: live.segmentAvgPowerW ?? live.segmentAvgPower ?? null,
                currentPower: live.power ?? live.currentPowerW ?? live.currentPower ?? live.instantPower ?? null,
                avgPower: live.avgPower ?? live.overallAvgPowerW ?? live.averagePower ?? live.avgPowerW ?? null,
                heartRate: live.heartRate ?? live.hr ?? live.bpm ?? null,
                cadence: live.cadence ?? live.rpm ?? null,
                progress: live.progress ?? null,
                segmentIndex: live.segmentIndex ?? null
              };
              
              const mergedParticipant = {
                ...p,
                bluetoothStatus,
                metrics,
                // 호환성을 위한 별칭 필드도 유지
                live: metrics,
                liveData: metrics
              };
              
              // 디버깅: 병합된 참가자 데이터 확인
              if (bluetoothStatus.trainer || bluetoothStatus.powerMeter || bluetoothStatus.heartRate) {
                console.log(`🔌 참가자 ${p.name} (${pid}) 블루투스 상태 병합:`, bluetoothStatus);
              }
              
              return mergedParticipant;
            });
          }
        }
      } catch (mergeErr) {
        console.warn('라이브 데이터 병합 오류:', mergeErr?.message || mergeErr);
      }

      if (Array.isArray(mergedRoom.participants) && groupTrainingState.readyOverrides) {
        mergedRoom.participants = mergedRoom.participants.map(p => {
          const participantId = getParticipantIdentifier(p);
          if (!participantId) return p;
          const override = getReadyOverride(participantId);
          if (!override) return p;
          const rawReady = getRawReadyValue(p);
          if (rawReady === override.ready) {
            clearReadyOverride(participantId);
            return p;
          }
          return { ...p, ready: override.ready };
        });
      }

      // 방 상태가 변경되었는지 확인
      const hasChanges = JSON.stringify(mergedRoom) !== JSON.stringify(groupTrainingState.currentRoom);

      if (hasChanges) {
        groupTrainingState.currentRoom = mergedRoom;
        updateParticipantsList();
        
        if (window.groupTrainingHooks?.updateRoom) {
          window.groupTrainingHooks.updateRoom({
            ...mergedRoom,
            code: groupTrainingState.roomCode,
            isAdmin: !!groupTrainingState.isAdmin
          });
        }

        // 카운트다운/훈련 시작 상태 체크
        const roomStatus = mergedRoom.status || mergedRoom.Status || 'waiting';
        const countdownEndTime = mergedRoom.countdownEndTime || mergedRoom.CountdownEndTime;
        const wasStarting = groupTrainingState.currentRoom?.status === 'starting';
        const isStarting = roomStatus === 'starting';
        
        // 참가자가 카운트다운 시작 신호를 감지한 경우 (중복 실행 방지)
        if (isStarting && !groupTrainingState.isAdmin && !wasStarting) {
          console.log('📢 훈련 시작 카운트다운 감지됨');
          
          // 카운트다운 종료 시간이 있으면 그 시간을 기준으로 카운트다운
          if (countdownEndTime) {
            const endTime = new Date(countdownEndTime).getTime();
            const now = Date.now();
            const remainingMs = Math.max(0, endTime - now);
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            
            if (remainingSeconds > 0) {
              console.log(`⏱️ 카운트다운 시작: ${remainingSeconds}초 남음`);
              // 참가자 화면에도 카운트다운 표시 (중복 방지를 위해 플래그 설정)
              if (!groupTrainingState.countdownStarted) {
                groupTrainingState.countdownStarted = true;
                showGroupCountdownOverlay(remainingSeconds).then(() => {
                  groupTrainingState.countdownStarted = false;
                });
              }
            } else {
              // 카운트다운이 이미 끝났으면 바로 훈련 시작
              console.log('⏱️ 카운트다운 이미 종료됨, 즉시 훈련 시작');
              if (!groupTrainingState.countdownStarted) {
                startLocalGroupTraining();
              }
            }
          } else {
            // 카운트다운 종료 시간이 없으면 기본 5초 카운트다운
            console.log('⏱️ 카운트다운 시작 (기본 5초)');
            if (!groupTrainingState.countdownStarted) {
              groupTrainingState.countdownStarted = true;
              showGroupCountdownOverlay(5).then(() => {
                groupTrainingState.countdownStarted = false;
              });
            }
          }
        }
        
        // 훈련 상태 체크 (카운트다운 후)
        if (roomStatus === 'training') {
          const ts = window.trainingState || {};
          if (!ts.isRunning) {
            // 훈련이 시작되었지만 아직 로컬에서 시작하지 않은 경우
            console.log('📢 훈련 시작 신호 감지됨');
            if (typeof startGroupTrainingSession === 'function') {
              startGroupTrainingSession();
            } else {
              startLocalGroupTraining();
            }
          }
        }
      } else {
        // 구조 변경이 없어도 라이브 데이터가 갱신될 수 있으므로 상태에 병합된 참가자만 반영하고 UI 갱신
        // 항상 UI를 갱신하여 실시간 데이터 반영 (블루투스 상태, 메트릭 등)
        if (groupTrainingState.currentRoom && mergedRoom?.participants) {
          groupTrainingState.currentRoom.participants = mergedRoom.participants;
          updateParticipantsList(); // 강제 UI 갱신
        } else if (mergedRoom?.participants) {
          // currentRoom이 없어도 participants만 있으면 UI 갱신
          if (!groupTrainingState.currentRoom) {
            groupTrainingState.currentRoom = mergedRoom;
          } else {
            groupTrainingState.currentRoom.participants = mergedRoom.participants;
          }
          updateParticipantsList();
        }
      }

      groupTrainingState.lastSyncTime = new Date();

    } else if (latestRoom && latestRoom.__roomDeleted) {
      // 방이 실제로 삭제됨 → 동기화 중지 및 조용히 방 나가기
      networkErrorCount = 0;
      console.log('⚠️ 방이 삭제되었습니다. 동기화를 중지하고 방에서 나갑니다.');
      stopRoomSync();
      showToast('방이 삭제되었거나 찾을 수 없습니다', 'error');
      await leaveGroupRoomSilently();
      return;
    } else {
      // latestRoom이 null: 일시적/알 수 없는 오류 → 강제 퇴장 없이 다음 주기로 재시도
      console.warn('⚠️ 방 정보를 일시적으로 가져오지 못했습니다. 다음 동기화에서 재시도합니다.');
      return;
    }
    
  } catch (error) {
    // 네트워크 오류인 경우
    if (error.message === 'NETWORK_ERROR' || error.message?.includes('네트워크')) {
      networkErrorCount++;
      console.warn(`⚠️ 네트워크 오류 발생 (${networkErrorCount}/${MAX_NETWORK_ERRORS}), 다음 동기화에서 재시도`);
      
      // 연속으로 여러 번 실패한 경우에도 사용자를 강제로 나가게 하지 않음
      // 단지 동기화만 중지하고 사용자는 방에 남아있도록 함
      if (networkErrorCount >= MAX_NETWORK_ERRORS) {
        console.error('❌ 네트워크 오류가 계속 발생합니다. 동기화를 중지합니다.');
        stopRoomSync();
        // 사용자에게 알림만 표시하고 방에서 나가게 하지 않음
        showToast('네트워크 연결이 불안정합니다. 연결이 복구되면 자동으로 재연결됩니다.', 'warning');
        // 사용자를 강제로 나가게 하지 않고, 동기화만 중지
        // 사용자는 방에 남아있고, 수동으로 나갈 수 있음
        // 네트워크가 복구되면 수동으로 동기화 재시작 가능
        return;
      }
      
      // 네트워크 오류는 일시적일 수 있으므로 계속 시도
      // 사용자에게 알림은 표시하지 않음 (너무 많은 알림 방지)
      // 조용히 재시도만 진행
      return;
    }
    
    // 기타 오류 (예상치 못한 오류)
    console.error('방 동기화 오류:', error);
    networkErrorCount = 0; // 네트워크 오류가 아니면 카운터 리셋
    // 예상치 못한 오류는 사용자에게 알림하지 않고 조용히 처리
    // 다음 동기화에서 재시도
  }
}



/**
 * 그룹 훈련방 나가기
 */
async function leaveGroupRoom() {
  try {
    console.log('🚪 그룹 훈련방에서 나가는 중...');
    
    // 동기화 인터벌 정리 (먼저 정리하여 중복 호출 방지)
    stopRoomSync();
    // 메트릭 인터벌 정리
    if (window.participantMetricsUpdateInterval) {
      clearInterval(window.participantMetricsUpdateInterval);
      window.participantMetricsUpdateInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 훈련 시작 신호 확인 인터벌 정리
    if (window.trainingStartCheckInterval) {
      clearInterval(window.trainingStartCheckInterval);
      window.trainingStartCheckInterval = null;
    }
    
    // 방에서 참가자 제거 (백엔드 업데이트)
    if (groupTrainingState.currentRoom && groupTrainingState.roomCode) {
      try {
        const userId = window.currentUser?.id || 'unknown';
        await apiLeaveRoom(groupTrainingState.roomCode, userId);
        console.log('✅ 방에서 성공적으로 나갔습니다');
      } catch (error) {
        console.error('❌ 방 나가기 중 백엔드 업데이트 실패:', error);
        // API 호출 실패는 무시하고 계속 진행
      }
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    groupTrainingState.participants = [];
    groupTrainingState.isConnected = false;
    groupTrainingState.lastSyncTime = null;
    
    if (window.groupTrainingHooks?.endSession) {
      window.groupTrainingHooks.endSession();
    }
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('trainingModeScreen');
    } else {
      // 대체 방법: 그룹 화면들 숨기기
      const groupScreens = ['groupWaitingScreen', 'groupTrainingScreen'];
      groupScreens.forEach(screenId => {
        const screen = document.getElementById(screenId);
        if (screen) {
          screen.classList.add('hidden');
        }
      });
    }
    
    showToast('그룹 훈련방에서 나왔습니다', 'info');
    
  } catch (error) {
    console.error('❌ 방 나가기 중 오류:', error);
    showToast('방 나가기 중 오류가 발생했습니다', 'error');
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
// leaveGroupRoom은 groupTrainingManager_part2.js에서 최종 등록됨
// window.leaveGroupRoom = leaveGroupRoom; // 주석 처리 - part2에서 등록

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
    console.log('🎯 방 모니터링 시작:', roomCode);
    
    const room = await getRoomByCode(roomCode);
    if (!room) {
      showToast('방 정보를 찾을 수 없습니다', 'error');
      return;
    }
    
    // 방 데이터 정규화
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) {
      showToast('방 정보를 처리할 수 없습니다', 'error');
      return;
    }
    
    // 모니터링 모달 표시
    showRoomMonitoringModal(normalizedRoom, roomCode);
    
  } catch (error) {
    console.error('Failed to monitor room:', error);
    showToast('방 모니터링에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 방 모니터링 모달 표시
 */
function showRoomMonitoringModal(room, roomCode) {
  console.log('📊 모니터링 모달 표시:', room, roomCode);
  
  // 기존 모니터링 오버레이가 있으면 제거
  const existingOverlay = document.getElementById('roomMonitoringModal');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  // 모니터링 모달 HTML 생성
  const modalHTML = `
    <div id="roomMonitoringModal" class="monitoring-modal">
      <div class="monitoring-modal-content">
        <div class="monitoring-modal-header">
          <div class="modal-header-info">
            <h2>🎯 방 모니터링</h2>
            <div class="room-info-summary">
              <span class="room-name">${escapeHtml(room.name || roomCode)}</span>
              <span class="room-code">코드: ${escapeHtml(roomCode)}</span>
            </div>
          </div>
          <button class="close-btn" onclick="closeRoomMonitoringModal()" title="닫기">✕</button>
        </div>
        
        <div class="monitoring-modal-body">
          <div class="room-status-section">
            <div class="status-item">
              <span class="status-label">상태:</span>
              <span class="status-value ${room.status}">
                ${room.status === 'waiting' ? '⏳ 대기중' : 
                  room.status === 'starting' ? '🚀 시작중' :
                  room.status === 'training' ? '🟢 훈련중' :
                  room.status === 'finished' ? '✅ 완료' :
                  room.status === 'closed' ? '🔴 종료' : '❓ 알 수 없음'}
              </span>
            </div>
            <div class="status-item">
              <span class="status-label">참가자:</span>
              <span class="status-value">${(room.participants || []).length}/${room.maxParticipants || 0}명</span>
            </div>
          </div>
          
          <div class="participants-monitoring-section">
            <h3>👥 참가자 모니터링</h3>
            <div id="roomMonitoringParticipantsList" class="monitoring-participants-list">
              ${renderMonitoringParticipants(room.participants || [])}
            </div>
          </div>
          
          ${room.status === 'waiting' || room.status === 'starting' ? `
          <div class="monitoring-controls-section">
            <h3>🚀 훈련 제어</h3>
            <div class="coaching-controls">
              <button class="btn btn-success" onclick="startTrainingFromMonitoring('${roomCode}')" id="startTrainingFromMonitoringBtn">
                🚀 훈련 시작
              </button>
              <button class="btn btn-secondary" onclick="refreshRoomMonitoring('${roomCode}')">
                🔄 새로고침
              </button>
            </div>
            <div class="training-requirements">
              <p class="requirements-text">
                <small>
                  ${countReadyParticipants(room.participants || [])}/${(room.participants || []).length}명 준비 완료
                </small>
              </p>
            </div>
          </div>
          ` : room.status === 'training' ? `
          <div class="monitoring-controls-section">
            <h3>🎤 코칭 제어</h3>
            <div class="coaching-controls">
              <button class="btn btn-primary" onclick="startRoomMonitoringCoaching('${roomCode}')">
                🎤 코칭 시작
              </button>
              <button class="btn btn-secondary" onclick="refreshRoomMonitoring('${roomCode}')">
                🔄 새로고침
              </button>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  // 모달을 body에 추가
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // 모달 표시
  const modal = document.getElementById('roomMonitoringModal');
  if (modal) {
    modal.style.display = 'flex';
    
    // 모달 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeRoomMonitoringModal();
      }
    });
    
    // 주기적으로 참가자 목록 업데이트 (5초마다)
    if (window.roomMonitoringInterval) {
      clearInterval(window.roomMonitoringInterval);
    }
    
    window.roomMonitoringInterval = setInterval(async () => {
      await refreshRoomMonitoring(roomCode);
    }, 5000);
  }
  
  console.log('✅ 모니터링 모달 표시 완료');
}

/**
 * 모니터링 참가자 목록 렌더링
 */
function renderMonitoringParticipants(participants) {
  if (!participants || participants.length === 0) {
    return '<div class="empty-participants">참가자가 없습니다</div>';
  }
  
  // 현재 방 상태 확인 (훈련 중인지 여부)
  const room = groupTrainingState?.currentRoom || null;
  const isTraining = room?.status === 'training';
  
  return participants.map(p => {
    // 참가자 데이터 정규화
    const name = p.name || p.participantName || p.userName || '이름 없음';
    const id = p.id || p.participantId || '';
    const role = p.role || 'participant';
    const ready = isParticipantReady(p);
    
    // 상태에 따른 설명
    let statusText = '';
    let statusDescription = '';
    
    if (!ready) {
      // 비활성 상태: 준비 완료 버튼을 누르지 않은 상태
      statusText = '🔴 비활성';
      statusDescription = '대기 중 - 준비 완료 버튼을 누르지 않음';
    } else if (!isTraining) {
      // 준비 완료 상태: 준비는 했지만 훈련이 시작되지 않음
      statusText = '🟡 준비완료';
      statusDescription = '준비 완료 - 훈련 시작 대기 중';
    } else {
      // 활성 상태: 훈련 진행 중
      statusText = '🟢 활성';
      statusDescription = '훈련 진행 중';
    }
    
    // 실시간 데이터는 비동기로 가져오므로 여기서는 플레이스홀더 사용
    // 실제 데이터는 refreshRoomMonitoring에서 업데이트됨
    const liveData = {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0
    };
    
    return `
      <div class="monitoring-participant-item" data-id="${id}">
        <div class="participant-header">
          <div class="participant-name-section">
            <span class="participant-name">${escapeHtml(name)}</span>
            <span class="participant-role-badge ${role}">
              ${role === 'admin' ? '🎯 관리자' : '🏃‍♂️ 참가자'}
            </span>
          </div>
          <span class="participant-status-indicator ${ready && isTraining ? 'ready' : 'not-ready'}" title="${statusDescription}">
            ${statusText}
          </span>
        </div>
        ${isTraining && ready ? `
        <div class="participant-metrics">
          <div class="metric-item">
            <span class="metric-label">파워</span>
            <span class="metric-value">${liveData.power || 0}W</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">심박</span>
            <span class="metric-value">${liveData.heartRate || 0}bpm</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">케이던스</span>
            <span class="metric-value">${liveData.cadence || 0}rpm</span>
          </div>
        </div>
        <div class="participant-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${liveData.progress || 0}%"></div>
          </div>
          <span class="progress-text">${liveData.progress || 0}% 완료</span>
        </div>
        ` : `
        <div class="participant-status-message">
          ${!ready ? 
            '<p class="status-info">⏳ 참가자가 준비 완료 버튼을 누르지 않았습니다.</p>' :
            '<p class="status-info">⏸️ 훈련이 시작되면 실시간 데이터가 표시됩니다.</p>'
          }
        </div>
        `}
      </div>
    `;
  }).join('');
}

/**
 * 방 모니터링 새로고침
 */
async function refreshRoomMonitoring(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    if (!room) return;
    
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) return;
    
    // groupTrainingState에 방 정보 업데이트 (renderMonitoringParticipants에서 사용)
    if (window.groupTrainingState) {
      window.groupTrainingState.currentRoom = normalizedRoom;
    }
    
    // 훈련 중인 경우 참가자들의 실시간 데이터 가져오기
    if (normalizedRoom.status === 'training') {
      const participantsWithData = await Promise.all(
        (normalizedRoom.participants || []).map(async (p) => {
          const id = p.id || p.participantId || '';
          const ready = isParticipantReady(p);
          
          if (ready) {
            const liveData = await getParticipantLiveDataForRoom(id);
            return { ...p, liveData };
          }
          return { ...p, liveData: { power: 0, heartRate: 0, cadence: 0, progress: 0 } };
        })
      );
      normalizedRoom.participants = participantsWithData;
    }
    
    const participantsList = document.getElementById('roomMonitoringParticipantsList');
    if (participantsList) {
      participantsList.innerHTML = renderMonitoringParticipantsWithData(normalizedRoom.participants || [], normalizedRoom.status);
    }
    
    // 방 상태 업데이트
    const statusValue = document.querySelector('#roomMonitoringModal .status-value');
    if (statusValue) {
      const status = normalizedRoom.status;
      statusValue.className = `status-value ${status}`;
      statusValue.textContent = 
        status === 'waiting' ? '⏳ 대기중' : 
        status === 'starting' ? '🚀 시작중' :
        status === 'training' ? '🟢 훈련중' :
        status === 'finished' ? '✅ 완료' :
        status === 'closed' ? '🔴 종료' : '❓ 알 수 없음';
    }
    
    // 훈련 시작 버튼 상태 업데이트
    const startBtn = document.getElementById('startTrainingFromMonitoringBtn');
    if (startBtn) {
      const totalCount = (normalizedRoom.participants || []).length;
      const readyCount = countReadyParticipants(normalizedRoom.participants || []);
      startBtn.disabled = totalCount < 2 || normalizedRoom.status !== 'waiting';
      startBtn.title = `${readyCount}/${totalCount}명 준비 완료`;
    }
    
  } catch (error) {
    console.error('방 모니터링 새로고침 실패:', error);
  }
}

/**
 * 실시간 데이터가 포함된 참가자 목록 렌더링
 */
function renderMonitoringParticipantsWithData(participants, roomStatus) {
  if (!participants || participants.length === 0) {
    return '<div class="empty-participants">참가자가 없습니다</div>';
  }
  
  const isTraining = roomStatus === 'training';
  
  return participants.map(p => {
    const name = p.name || p.participantName || p.userName || '이름 없음';
    const id = p.id || p.participantId || '';
    const role = p.role || 'participant';
    const ready = isParticipantReady(p);
    const liveData = p.liveData || { power: 0, heartRate: 0, cadence: 0, progress: 0 };
    
    let statusText = '';
    let statusDescription = '';
    
    if (!ready) {
      statusText = '🔴 비활성';
      statusDescription = '대기 중 - 준비 완료 버튼을 누르지 않음';
    } else if (!isTraining) {
      statusText = '🟡 준비완료';
      statusDescription = '준비 완료 - 훈련 시작 대기 중';
    } else {
      statusText = '🟢 활성';
      statusDescription = '훈련 진행 중';
    }
    
    return `
      <div class="monitoring-participant-item" data-id="${id}">
        <div class="participant-header">
          <div class="participant-name-section">
            <span class="participant-name">${escapeHtml(name)}</span>
            <span class="participant-role-badge ${role}">
              ${role === 'admin' ? '🎯 관리자' : '🏃‍♂️ 참가자'}
            </span>
          </div>
          <span class="participant-status-indicator ${ready && isTraining ? 'ready' : 'not-ready'}" title="${statusDescription}">
            ${statusText}
          </span>
        </div>
        ${isTraining && ready ? `
        <div class="participant-metrics">
          <div class="metric-item">
            <span class="metric-label">파워</span>
            <span class="metric-value">${liveData.power || 0}W</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">심박</span>
            <span class="metric-value">${liveData.heartRate || 0}bpm</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">케이던스</span>
            <span class="metric-value">${liveData.cadence || 0}rpm</span>
          </div>
        </div>
        <div class="participant-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${liveData.progress || 0}%"></div>
          </div>
          <span class="progress-text">${liveData.progress || 0}% 완료</span>
        </div>
        ` : `
        <div class="participant-status-message">
          ${!ready ? 
            '<p class="status-info">⏳ 참가자가 준비 완료 버튼을 누르지 않았습니다.</p>' :
            '<p class="status-info">⏸️ 훈련이 시작되면 실시간 데이터가 표시됩니다.</p>'
          }
        </div>
        `}
      </div>
    `;
  }).join('');
}

/**
 * 방 모니터링 모달 닫기
 */
function closeRoomMonitoringModal() {
  const modal = document.getElementById('roomMonitoringModal');
  if (modal) {
    modal.remove();
  }
  
  // 인터벌 정리
  if (window.roomMonitoringInterval) {
    clearInterval(window.roomMonitoringInterval);
    window.roomMonitoringInterval = null;
  }
}

/**
 * 모니터링 화면에서 훈련 시작
 */
async function startTrainingFromMonitoring(roomCode) {
  try {
    console.log('🚀 모니터링 화면에서 훈련 시작:', roomCode);
    
    // 방 정보 확인
    const room = await getRoomByCode(roomCode);
    if (!room) {
      showToast('방 정보를 찾을 수 없습니다', 'error');
      return;
    }
    
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) {
      showToast('방 정보를 처리할 수 없습니다', 'error');
      return;
    }
    
    const participants = normalizedRoom.participants || [];
    const participantCount = participants.length;
    
    if (participantCount < 2) {
      showToast('최소 2명의 참가자가 필요합니다', 'error');
      return;
    }
    
    const readyCount = countReadyParticipants(participants);
    if (readyCount < participantCount) {
      showToast(`준비되지 않은 참가자가 있지만 훈련을 시작합니다 (${readyCount}/${participantCount})`, 'warning');
    }
    
    if (normalizedRoom.status !== 'waiting' && normalizedRoom.status !== 'starting') {
      showToast('이미 시작되었거나 종료된 방입니다', 'error');
      return;
    }
    
    // groupTrainingState 업데이트
    if (window.groupTrainingState) {
      window.groupTrainingState.currentRoom = normalizedRoom;
      window.groupTrainingState.roomCode = roomCode;
      window.groupTrainingState.isAdmin = true;
    }
    
    // 훈련 시작 시간 설정 (3초 후 시작 - 참가자들이 준비할 시간)
    const startDelay = 3000; // 3초
    const trainingStartTime = new Date(Date.now() + startDelay).toISOString();
    
    showToast('3초 후 모든 참가자의 훈련이 동시에 시작됩니다!', 'info');
    
    // 방 상태 업데이트 (trainingStartTime 포함)
    const success = await apiUpdateRoom(roomCode, {
      status: 'training',
      trainingStartTime: trainingStartTime
    });
    
    if (success) {
      // 모니터링 화면 새로고침
      await refreshRoomMonitoring(roomCode);
      
      showToast('훈련이 시작되었습니다! 모든 참가자가 동시에 시작됩니다.', 'success');
    } else {
      throw new Error('방 상태 업데이트 실패');
    }
    
  } catch (error) {
    console.error('❌ 모니터링 화면에서 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 방 모니터링 코칭 시작
 */
function startRoomMonitoringCoaching(roomCode) {
  showToast('코칭 기능은 준비 중입니다', 'info');
  // TODO: 코칭 기능 구현
}

/**
 * 참가자 실시간 데이터 가져오기 (방 모니터링용)
 */
async function getParticipantLiveDataForRoom(participantId) {
  try {
    // 백엔드에서 실시간 데이터 가져오기
    if (window.GAS_URL && participantId) {
      const result = await jsonpRequest(window.GAS_URL, {
        action: 'getParticipantLiveData',
        participantId: String(participantId)
      });
      
      if (result?.success && result.data) {
        return {
          power: result.data.power || 0,
          heartRate: result.data.heartRate || 0,
          cadence: result.data.cadence || 0,
          progress: result.data.progress || 0,
          timestamp: result.data.timestamp || new Date().toISOString()
        };
      }
    }
    
    // 백엔드에서 데이터를 가져올 수 없는 경우 빈 데이터 반환
    return {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('참가자 실시간 데이터 가져오기 실패:', error);
    return {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0,
      timestamp: new Date().toISOString()
    };
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



/**
 * 참가자 섹션 초기화
 */
async function initializeParticipantSection() {
  console.log('🎯 참가자 섹션 초기화 시작');
  
  // 방 코드 입력 필드 초기화
  const roomCodeInput = safeGet('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.value = '';
  }
  
  // 방 목록 로드
  await refreshRoomList();
  
  console.log('✅ 참가자 섹션 초기화 완료');
}

// 그룹훈련 모듈 함수 등록 확인 (변수명 변경으로 충돌 방지)
const groupTrainingFunctions = [
  'showGroupWorkoutManagement', 'loadGroupWorkoutList', 'deleteGroupWorkout',
  'apiGetGroupWorkouts', 'apiCreateGroupWorkout', 'apiDeleteGroupWorkout',
  'showToast', 'safeGet',
  'initializeParticipantSection', 'refreshRoomList', 'removeDuplicateWorkoutSelectsNow'
];




// 전역 함수 등록
window.refreshActiveRooms = refreshActiveRooms;
window.updateRoomStatistics = updateRoomStatistics;
window.monitorRoom = monitorRoom;
window.showRoomMonitoringModal = showRoomMonitoringModal;
window.closeRoomMonitoringModal = closeRoomMonitoringModal;
window.refreshRoomMonitoring = refreshRoomMonitoring;
window.startTrainingFromMonitoring = startTrainingFromMonitoring;
window.getParticipantLiveDataForRoom = getParticipantLiveDataForRoom;
window.startRoomMonitoringCoaching = startRoomMonitoringCoaching;
window.forceStopRoom = forceStopRoom;
window.cleanupExpiredRooms = cleanupExpiredRooms;
window.emergencyStopAllRooms = emergencyStopAllRooms;
window.initializeManagerDashboard = initializeManagerDashboard;


// ========== 그룹훈련 워크아웃 관리 UI 함수들 ==========

/**
 * 그룹훈련 워크아웃 목록 화면 표시
 */
async function showGroupWorkoutManagement() {
  console.log('🎯 그룹훈련 워크아웃 관리 화면 표시');
  
  const currentUser = window.currentUser;
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    if (typeof showToast === 'function') {
      showToast('그룹훈련 워크아웃 관리는 관리자만 접근할 수 있습니다');
    } else {
      alert('관리자 권한이 필요합니다');
    }
    return;
  }
  
  // 화면 전환
  if (typeof showScreen === 'function') {
    showScreen('groupWorkoutManagementScreen');
  } else {
    // 대체 방법: 모든 화면 숨김 후 그룹워크아웃 관리 화면만 표시
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.add('hidden');
    });
    
    const groupWorkoutScreen = document.getElementById('groupWorkoutManagementScreen');
    if (groupWorkoutScreen) {
      groupWorkoutScreen.classList.remove('hidden');
    }
  }
  
  // 워크아웃 목록 로드
  setTimeout(async () => {
    await loadGroupWorkoutList();
  }, 150);
}

/**
 * 그룹훈련 워크아웃 목록 로드
 */
async function loadGroupWorkoutList() {
  const workoutList = safeGet('groupWorkoutList');
  if (!workoutList) {
    console.warn('groupWorkoutList 요소를 찾을 수 없습니다');
    return;
  }
  
  try {
    workoutList.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <div style="color: #666; font-size: 14px;">그룹훈련 워크아웃 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetGroupWorkouts();
    
    if (result && result.success && result.workouts) {
      renderGroupWorkoutList(result.workouts);
    } else {
      workoutList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div class="empty-state-title">그룹훈련 워크아웃이 없습니다</div>
          <div class="empty-state-description">새로운 그룹훈련 워크아웃을 추가해보세요</div>
          <button class="btn btn-primary" onclick="showCreateGroupWorkoutModal()">
            <span class="btn-icon">➕</span>
            워크아웃 추가
          </button>
        </div>
      `;
    }
  } catch (error) {
    console.error('그룹훈련 워크아웃 목록 로드 실패:', error);
    workoutList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">❌</div>
        <div class="error-state-title">로딩 실패</div>
        <div class="error-state-description">그룹훈련 워크아웃 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="loadGroupWorkoutList()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 그룹훈련 워크아웃 목록 렌더링
 */
function renderGroupWorkoutList(workouts) {
  const workoutList = safeGet('groupWorkoutList');
  if (!workoutList) return;
  
  const workoutCards = workouts.map(workout => `
    <div class="workout-card" data-workout-id="${workout.id}">
      <div class="workout-header">
        <h3 class="workout-title">${escapeHtml(workout.title)}</h3>
        <div class="workout-badges">
          <span class="badge badge-${workout.difficulty || 'medium'}">${workout.difficulty || 'Medium'}</span>
          <span class="badge badge-category">${workout.category || 'General'}</span>
        </div>
      </div>
      
      <div class="workout-info">
        <div class="workout-meta">
          <span class="meta-item">
            <i class="icon-time"></i>
            ${workout.duration || 60}분
          </span>
          <span class="meta-item">
            <i class="icon-users"></i>
            최대 ${workout.maxParticipants || 20}명
          </span>
          <span class="meta-item">
            <i class="icon-user"></i>
            ${escapeHtml(workout.author || '미상')}
          </span>
        </div>
        
        <p class="workout-description">${escapeHtml(workout.description || '설명 없음')}</p>
      </div>
      
      <div class="workout-actions">
        <button class="btn btn-secondary btn-sm" onclick="editGroupWorkout('${workout.id}')">
          <span class="btn-icon">✏️</span>
          편집
        </button>
        <button class="btn btn-primary btn-sm" onclick="useGroupWorkout('${workout.id}')">
          <span class="btn-icon">🚀</span>
          사용
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteGroupWorkout('${workout.id}')">
          <span class="btn-icon">🗑️</span>
          삭제
        </button>
      </div>
    </div>
  `).join('');
  
  workoutList.innerHTML = `
    <div class="workout-management-header">
      <h2>그룹훈련 워크아웃 관리</h2>
      <button class="btn btn-primary" onclick="showCreateGroupWorkoutModal()">
        <span class="btn-icon">➕</span>
        새 워크아웃 추가
      </button>
    </div>
    <div class="workout-grid">
      ${workoutCards}
    </div>
  `;
}

/**
 * 그룹훈련 워크아웃 삭제
 */
async function deleteGroupWorkout(workoutId) {
  if (!workoutId) {
    showToast('유효하지 않은 워크아웃 ID입니다');
    return;
  }
  
  if (!confirm('정말로 이 그룹훈련 워크아웃을 삭제하시겠습니까?\n삭제된 워크아웃은 복구할 수 없습니다.')) {
    return;
  }
  
  try {
    if (typeof showLoading === 'function') showLoading('워크아웃 삭제 중...');
    
    const result = await apiDeleteGroupWorkout(workoutId);
    
    if (result && result.success) {
      if (typeof showToast === 'function') {
        showToast('그룹훈련 워크아웃이 삭제되었습니다');
      }
      await loadGroupWorkoutList(); // 목록 새로고침
    } else {
      throw new Error(result.error || '삭제 실패');
    }
  } catch (error) {
    console.error('그룹훈련 워크아웃 삭제 실패:', error);
    if (typeof showToast === 'function') {
      showToast('워크아웃 삭제에 실패했습니다: ' + error.message);
    }
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
}

/**
 * HTML 이스케이프 (XSS 방지)
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

// ========== 전역 함수 등록 ==========
// ========== 전역 함수 등록 ==========
window.showGroupWorkoutManagement = showGroupWorkoutManagement;
window.loadGroupWorkoutList = loadGroupWorkoutList;
window.deleteGroupWorkout = deleteGroupWorkout;
window.apiGetGroupWorkouts = apiGetGroupWorkouts;
window.apiCreateGroupWorkout = apiCreateGroupWorkout;
window.apiDeleteGroupWorkout = apiDeleteGroupWorkout;
window.showToast = showToast;
window.safeGet = safeGet;
window.loadWorkoutsForGroupRoom = loadWorkoutsForGroupRoom;
window.initializeAdminSection = initializeAdminSection;
window.createGroupRoomFromWorkout = createGroupRoomFromWorkout;


// 🆕 새로 추가된 함수들
window.initializeParticipantSection = initializeParticipantSection;
window.refreshRoomList = refreshRoomList;
window.removeDuplicateWorkoutSelectsNow = removeDuplicateWorkoutSelectsNow;
window.getRoomsByWorkoutId = getRoomsByWorkoutId;

/**
 * 그룹 훈련 시작 (5초 카운트다운 포함)
 * 모든 참가자가 동시에 훈련을 시작하도록 함
 */
async function startGroupTrainingWithCountdown() {
  try {
    // 관리자 체크 (groupTrainingState.isAdmin 또는 grade=1)
    const currentUser = window.currentUser || {};
    const isAdminUser = groupTrainingState.isAdmin || 
                       currentUser.grade === '1' || 
                       currentUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    
    if (!isAdminUser) {
      showToast('관리자만 훈련을 시작할 수 있습니다', 'error');
      return;
    }

    const room = groupTrainingState.currentRoom;
    if (!room || !room.workoutId || !room.roomCode) {
      showToast('방 정보가 없습니다', 'error');
      return;
    }

    // 워크아웃 확인
    if (!window.currentWorkout) {
      showToast('워크아웃을 먼저 로드해주세요', 'error');
      return;
    }

    const participantCount = room.participants?.length || 0;
    if (participantCount < 2) {
      showToast('최소 2명의 참가자가 필요합니다', 'warning');
      return;
    }
    
    const readyCount = countReadyParticipants(room.participants || []);
    if (readyCount === 0) {
      showToast('준비 완료된 참가자가 없지만 훈련을 시작합니다', 'warning');
    } else if (readyCount < participantCount) {
      showToast(`일부 참가자가 아직 준비되지 않았습니다 (${readyCount}/${participantCount})`, 'info');
    }
    
    console.log('🚀 그룹 훈련 시작 카운트다운 시작');
    console.log(`✅ 준비 완료된 참가자: ${readyCount}명`);

    // 서버에 카운트다운 시작 신호 전송 (모든 참가자가 감지할 수 있도록)
    const countdownSeconds = 5;
    const countdownEndTime = new Date(Date.now() + countdownSeconds * 1000).toISOString();
    
    try {
      // 방 상태를 'starting'으로 변경하고 카운트다운 종료 시간 저장
      if (typeof apiUpdateRoom === 'function') {
        await apiUpdateRoom(room.roomCode, {
          status: 'starting',
          countdownEndTime: countdownEndTime
        });
      } else if (typeof updateRoomOnBackend === 'function') {
        await updateRoomOnBackend({
          ...room,
          status: 'starting',
          countdownEndTime: countdownEndTime
        });
      }
      console.log('✅ 서버에 카운트다운 시작 신호 전송 완료');
    } catch (error) {
      console.warn('서버에 카운트다운 시작 신호 전송 실패:', error);
      // 서버 전송 실패해도 로컬에서는 계속 진행
    }

    // 관리자 화면에서 카운트다운 오버레이 표시
    await showGroupCountdownOverlay(countdownSeconds);

  } catch (error) {
    console.error('❌ 그룹 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 그룹 훈련 카운트다운 오버레이 표시 (5초)
 */
async function showGroupCountdownOverlay(seconds = 5) {
  return new Promise((resolve) => {
    // 카운트다운 오버레이 요소 찾기 또는 생성
    let overlay = document.getElementById('countdownOverlay');
    let countdownNumber = document.getElementById('countdownNumber');

    if (!overlay) {
      // 오버레이 생성 (groupWaitingScreen 또는 전체 화면에)
      overlay = document.createElement('div');
      overlay.id = 'countdownOverlay';
      overlay.className = 'countdown-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(10px);
      `;

      countdownNumber = document.createElement('div');
      countdownNumber.id = 'countdownNumber';
      countdownNumber.className = 'countdown-number';
      countdownNumber.style.cssText = `
        font-size: 120px;
        font-weight: 900;
        color: #4cc9f0;
        text-shadow: 0 0 40px rgba(76, 201, 240, 0.8), 0 0 80px rgba(76, 201, 240, 0.5);
        animation: countdownPulse 1s ease-in-out infinite;
      `;

      overlay.appendChild(countdownNumber);
      document.body.appendChild(overlay);

      // 애니메이션 CSS 추가
      if (!document.getElementById('countdownAnimationStyle')) {
        const style = document.createElement('style');
        style.id = 'countdownAnimationStyle';
        style.textContent = `
          @keyframes countdownPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.2); opacity: 0.8; }
          }
        `;
        document.head.appendChild(style);
      }
    }

    // 오버레이 표시
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    let remain = seconds;
    countdownNumber.textContent = remain;

    // 첫 삐 소리
    if (typeof playBeep === 'function') {
      playBeep(880, 120, 0.25);
    }

    const timer = setInterval(() => {
      remain -= 1;

      if (remain > 0) {
        countdownNumber.textContent = remain;
        if (typeof playBeep === 'function') {
          playBeep(880, 120, 0.25);
        }
      } else if (remain === 0) {
        countdownNumber.textContent = '0';
        if (typeof playBeep === 'function') {
          playBeep(1500, 700, 0.35, 'square').catch(() => {});
        }

        // 0.5초 후 오버레이 닫고 훈련 시작
        setTimeout(async () => {
          overlay.classList.add('hidden');
          overlay.style.display = 'none';
          clearInterval(timer);

          console.log('✅ 카운트다운 완료, 훈련 시작');

          // 모든 참가자 화면을 개인 훈련 화면으로 전환하고 훈련 시작
          await startAllParticipantsTraining();

          resolve();
        }, 500);
      } else {
        clearInterval(timer);
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        resolve();
      }
    }, 1000);
  });
}

/**
 * 모든 참가자에게 훈련 시작 신호 전송 및 로컬 훈련 시작
 */
async function startAllParticipantsTraining() {
  try {
    const room = groupTrainingState.currentRoom;
    if (!room || !room.roomCode) {
      console.error('방 정보가 없습니다');
      return;
    }

    // 서버에 훈련 시작 신호 전송 (관리자만)
    // grade=1 사용자도 관리자로 인식
    const currentUser = window.currentUser || {};
    const isAdminUser = groupTrainingState.isAdmin || 
                       currentUser.grade === '1' || 
                       currentUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    
    if (isAdminUser) {
      try {
        // API 호출로 방 상태를 'training'으로 변경하여 모든 참가자에게 신호 전송
        if (typeof apiUpdateRoom === 'function') {
          await apiUpdateRoom(room.roomCode, {
            status: 'training'
          });
        } else if (typeof updateRoomOnBackend === 'function') {
          await updateRoomOnBackend({
            ...room,
            status: 'training'
          });
        }
        console.log('✅ 서버에 훈련 시작 신호 전송 완료');
      } catch (error) {
        console.warn('서버에 훈련 시작 신호 전송 실패:', error);
        // 서버 전송 실패해도 로컬 훈련은 시작
      }
    }

    // 로컬 훈련 시작 (모든 참가자, 관리자 포함)
    await startLocalGroupTraining();

  } catch (error) {
    console.error('❌ 모든 참가자 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다', 'error');
  }
}

/**
 * 로컬 훈련 시작 (개인 훈련 화면 전환 및 훈련 시작)
 */
async function startLocalGroupTraining() {
  try {
    const room = groupTrainingState.currentRoom;
    if (!room || !room.workoutId) {
      console.error('워크아웃 정보가 없습니다');
      return;
    }

    // 워크아웃이 로드되지 않았다면 로드
    if (!window.currentWorkout) {
      if (typeof loadWorkoutInfo === 'function') {
        await loadWorkoutInfo(room.workoutId);
      } else if (typeof apiGetWorkout === 'function') {
        const result = await apiGetWorkout(room.workoutId);
        if (result && result.success && result.item) {
          window.currentWorkout = result.item;
        }
      }
    }

    if (!window.currentWorkout) {
      showToast('워크아웃을 로드할 수 없습니다', 'error');
      return;
    }

    // 개인 훈련 화면으로 전환
    const trainingScreen = document.getElementById('trainingScreen');
    const waitingScreen = document.getElementById('groupWaitingScreen');

    if (trainingScreen && waitingScreen) {
      waitingScreen.classList.remove('active');
      waitingScreen.classList.add('hidden');
      trainingScreen.classList.remove('hidden');
      trainingScreen.classList.add('active');
    } else if (typeof showScreen === 'function') {
      showScreen('trainingScreen');
    }

    // 훈련 시작 (개인 훈련 시작 함수 호출)
    if (typeof startWithCountdown === 'function') {
      // startWithCountdown은 이미 카운트다운을 표시하므로 바로 startWorkoutTraining 호출
      if (typeof startWorkoutTraining === 'function') {
        startWorkoutTraining();
      } else {
        console.warn('startWorkoutTraining 함수를 찾을 수 없습니다');
      }
    } else if (typeof startWorkoutTraining === 'function') {
      startWorkoutTraining();
    } else {
      console.error('훈련 시작 함수를 찾을 수 없습니다');
      showToast('훈련을 시작할 수 없습니다', 'error');
    }

    console.log('✅ 로컬 훈련 시작 완료');

  } catch (error) {
    console.error('❌ 로컬 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

// 함수를 전역으로 노출
window.startGroupTrainingWithCountdown = startGroupTrainingWithCountdown;
window.showGroupCountdownOverlay = showGroupCountdownOverlay;
window.startAllParticipantsTraining = startAllParticipantsTraining;
window.startLocalGroupTraining = startLocalGroupTraining;

     

groupTrainingFunctions.forEach(funcName => {
  if (typeof window[funcName] !== 'function') {
    console.warn(`⚠️ 그룹훈련 함수 ${funcName}가 제대로 등록되지 않았습니다`);
  }
});

console.log('✅ 그룹 훈련 관리자 모듈 로딩 완료');

// 추가 그룹훈련 유틸리티 함수들 전역 등록
// 추가 그룹훈련 유틸리티 함수들 전역 등록 (존재하는 함수만)
try {
  // 유틸리티 함수들
  if (typeof generateRoomCode === 'function') {
    window.generateRoomCode = generateRoomCode;
  }
  if (typeof generateId === 'function') {
    window.generateId = generateId;
  }
  if (typeof getCurrentTimeString === 'function') {
    window.getCurrentTimeString = getCurrentTimeString;
  }
  
  // 🆕 API 함수들 추가
  if (typeof apiCreateRoom === 'function') {
    window.apiCreateRoom = apiCreateRoom;
  }
  if (typeof apiGetRoom === 'function') {
    window.apiGetRoom = apiGetRoom;
  }
  if (typeof apiJoinRoom === 'function') {
    window.apiJoinRoom = apiJoinRoom;
  }
  if (typeof apiUpdateRoom === 'function') {
    window.apiUpdateRoom = apiUpdateRoom;
  }
  if (typeof updateRoomOnBackend === 'function') {
    window.updateRoomOnBackend = updateRoomOnBackend;
  }
  if (typeof apiGetWorkouts === 'function') {
    window.apiGetWorkouts = apiGetWorkouts;
  }
  if (typeof apiLeaveRoom === 'function') {
    window.apiLeaveRoom = apiLeaveRoom;
  }
  if (typeof apiSyncRoom === 'function') {
    window.apiSyncRoom = apiSyncRoom;
  }
  
  // 화면 전환 함수들
  if (typeof selectTrainingMode === 'function') {
    window.selectTrainingMode = selectTrainingMode;
  }
  if (typeof selectGroupMode === 'function') {
    window.selectGroupMode = selectGroupMode;
  }
  
  // 방 관리 함수들
  if (typeof createGroupRoom === 'function') {
    window.createGroupRoom = createGroupRoom;
  }
  if (typeof createRoomOnBackend === 'function') {
    window.createRoomOnBackend = createRoomOnBackend;
  }
  if (typeof joinGroupRoom === 'function') {
    window.joinGroupRoom = joinGroupRoom;
  }
  if (typeof leaveGroupRoom === 'function') {
    // leaveGroupRoom은 groupTrainingManager_part2.js에서 최종 등록됨
// window.leaveGroupRoom = leaveGroupRoom; // 주석 처리 - part2에서 등록
  }
  
  // 역할 선택 함수
  if (typeof selectRole === 'function') {
    window.selectRole = selectRole;
  }
  
  console.log('✅ 그룹훈련 추가 함수들 안전 등록 완료');
} catch (error) {
  console.error('❌ 그룹훈련 함수 등록 중 오류:', error);
}

// 모듈 로딩 완료 마크
window.groupTrainingManagerReady = true;
console.log('🎯 그룹훈련 관리자 모듈 준비 완료');

} // 모듈 중복 로딩 방지 블록 종료

