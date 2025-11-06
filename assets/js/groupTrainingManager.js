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




/**
 * 그룹방 생성을 위한 워크아웃 목록 로드
 */
async function loadWorkoutsForGroupRoom() {
  console.log('🔄 그룹방용 워크아웃 목록 로드 시작');
  
  const select = safeGet('roomWorkoutSelect');
  if (!select) {
    console.warn('roomWorkoutSelect 요소를 찾을 수 없습니다');
    return;
  }
  
  try {
    // 기본 옵션만 유지
    select.innerHTML = '<option value="">워크아웃을 불러오는 중...</option>';
    
    // 기존 워크아웃 매니저의 API 사용
    let workouts = [];
    
    // 1. 로컬 워크아웃 데이터 확인
    if (window.workoutData && Array.isArray(window.workoutData)) {
      workouts = [...window.workoutData];
    }
    
    // 2. DB에서 워크아웃 목록 조회 (workoutManager의 방식 사용)
    if (typeof window.apiGetWorkouts === 'function') {
      try {
        const result = await window.apiGetWorkouts();
        if (result && result.success && Array.isArray(result.workouts)) {
          // DB 워크아웃과 로컬 워크아웃 병합 (중복 제거)
          const dbWorkouts = result.workouts.map(w => ({
            id: w.id,
            name: w.title || w.name,
            duration: w.duration || 60,
            description: w.description || '',
            author: w.author || '',
            difficulty: w.difficulty || 'medium'
          }));
          
          workouts = [...workouts, ...dbWorkouts];
        }
      } catch (error) {
        console.warn('DB 워크아웃 로드 실패:', error);
      }
    }
    
    // 3. 중복 제거 (ID 기준)
    const uniqueWorkouts = workouts.filter((workout, index, self) => 
      index === self.findIndex(w => w.id === workout.id)
    );
    
    // 4. 옵션 생성
    if (uniqueWorkouts.length > 0) {
      select.innerHTML = `
        <option value="">워크아웃 선택...</option>
        ${uniqueWorkouts.map(workout => `
          <option value="${workout.id}" data-duration="${workout.duration || 60}">
            ${escapeHtml(workout.name)} (${workout.duration || 60}분) ${workout.difficulty ? `- ${workout.difficulty}` : ''}
          </option>
        `).join('')}
      `;
      
      console.log(`✅ ${uniqueWorkouts.length}개의 워크아웃 로드 완료`);
    } else {
      select.innerHTML = `
        <option value="">워크아웃이 없습니다</option>
        <option value="default">기본 훈련 (60분)</option>
      `;
      console.warn('⚠️ 로드된 워크아웃이 없습니다');
    }
    
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    select.innerHTML = `
      <option value="">로드 실패</option>
      <option value="default">기본 훈련 (60분)</option>
    `;
    
    if (typeof showToast === 'function') {
      showToast('워크아웃 목록을 불러오지 못했습니다', 'error');
    }
  }
}

/**
 * 관리자 섹션 초기화 (워크아웃 목록 포함)
 */
async function initializeAdminSection() {
  console.log('🎯 관리자 섹션 초기화');
  
  // 워크아웃 목록 로드
  await loadWorkoutsForGroupRoom();
  
  // 기타 초기화 작업
  const roomNameInput = safeGet('roomNameInput');
  if (roomNameInput) {
    roomNameInput.value = '';
  }
  
  const maxParticipants = safeGet('maxParticipants');
  if (maxParticipants && !maxParticipants.value) {
    maxParticipants.value = '10'; // 기본값 설정
  }
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
  if (role === 'admin') {
    await initializeAdminSection();
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
 * 워크아웃 목록 로드 (방 생성용)
 */
/**
 * 그룹훈련용 워크아웃 목록 로드 (DB 연동 버전)
 */
async function loadWorkoutsForRoom() {
  const select = safeGet('roomWorkoutSelect');
  if (!select) {
    console.warn('❌ roomWorkoutSelect 요소를 찾을 수 없습니다');
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
 * 백엔드에 방 데이터 업데이트 (임시 구현)
 */
async function updateRoomOnBackend(roomData) {
  try {
    // 로컬 스토리지에 저장 (임시)
    const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
    if (roomData.code) {
      rooms[roomData.code] = roomData;
      localStorage.setItem('groupTrainingRooms', JSON.stringify(rooms));
    }
    
    // 실제 백엔드 API 호출이 필요한 경우
    if (window.GAS_URL) {
      const params = new URLSearchParams({
        action: 'updateGroupRoom',
        code: roomData.code,
        data: JSON.stringify(roomData)
      });
      
      const response = await fetch(`${window.GAS_URL}?${params.toString()}`);
      const result = await response.json();
      return result.success || true;
    }
    
    return true;
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



/**
 * 그룹 훈련방 나가기
 */
async function leaveGroupRoom() {
  try {
    console.log('🚪 그룹 훈련방에서 나가는 중...');
    
    // 동기화 인터벌 정리
    if (groupTrainingState.syncInterval) {
      clearInterval(groupTrainingState.syncInterval);
      groupTrainingState.syncInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 방에서 참가자 제거 (백엔드 업데이트)
    if (groupTrainingState.currentRoom && groupTrainingState.roomCode) {
      try {
        const currentRoom = groupTrainingState.currentRoom;
        const userId = window.currentUser?.id || 'unknown';
        
        // 참가자 목록에서 현재 사용자 제거
        currentRoom.participants = currentRoom.participants.filter(p => p.id !== userId);
        
        // 백엔드 업데이트
        await updateRoomOnBackend(currentRoom);
        console.log('✅ 방에서 성공적으로 나갔습니다');
      } catch (error) {
        console.error('❌ 방 나가기 중 백엔드 업데이트 실패:', error);
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



   
// 다음 블록에서 계속...

// ========== 내보내기 ==========
// 전역 함수들을 window 객체에 등록
window.selectTrainingMode = selectTrainingMode;
window.selectGroupMode = selectGroupMode;
window.selectRole = selectRole;
window.createGroupRoom = createGroupRoom;
window.joinGroupRoom = joinGroupRoom;
window.leaveGroupRoom = leaveGroupRoom;

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




     
// 그룹훈련 모듈 함수 등록 확인 (변수명 변경으로 충돌 방지)
const groupTrainingFunctions = [
  'showGroupWorkoutManagement', 'loadGroupWorkoutList', 'deleteGroupWorkout',
  'apiGetGroupWorkouts', 'apiCreateGroupWorkout', 'apiDeleteGroupWorkout',
  'showToast', 'safeGet'
];

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
  if (typeof getCurrentTimeString === 'function') {
    window.getCurrentTimeString = getCurrentTimeString;
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
  if (typeof joinGroupRoom === 'function') {
    window.joinGroupRoom = joinGroupRoom;
  }
  if (typeof leaveGroupRoom === 'function') {
    window.leaveGroupRoom = leaveGroupRoom;
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

