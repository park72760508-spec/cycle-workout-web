/* ==========================================================
   통합 워크아웃 관리 모듈 (integratedWorkoutManager.js)
   - POST 방식 API 통신으로 변환
   - Google Sheets API와 연동한 워크아웃 CRUD
   - 상태(보이기/숨기기) 및 게시날짜 필터링 지원
   - 세그먼트 관리 및 반복 기능 포함
========================================================== */

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

// API 기본 설정
const API_CONFIG = {
  baseURL: window.GAS_URL || '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};

// POST 방식 API 호출 헬퍼 함수
async function postRequest(url, data = {}) {
  try {
    console.log('POST request to:', url, 'with data:', data);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(API_CONFIG.timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('POST response received:', result);
    
    return result;
    
  } catch (error) {
    console.error('POST request failed:', error);
    
    if (error.name === 'AbortError') {
      throw new Error('요청 시간 초과');
    } else if (error.name === 'TypeError') {
      throw new Error('네트워크 연결 오류');
    } else {
      throw error;
    }
  }
}

// 워크아웃 API 함수들 (POST 방식)
async function apiGetWorkouts() {
  return postRequest(API_CONFIG.baseURL, { action: 'listWorkouts' });
}

async function apiGetAllWorkouts() {
  return postRequest(API_CONFIG.baseURL, { action: 'listAllWorkouts' });
}

async function apiGetWorkout(id) {
  return postRequest(API_CONFIG.baseURL, { 
    action: 'getWorkout', 
    id: id 
  });
}

async function apiCreateWorkout(workoutData) {
  console.log('apiCreateWorkout called with:', workoutData);
  
  const requestData = {
    action: 'createWorkout',
    title: workoutData.title || '',
    description: workoutData.description || '',
    author: workoutData.author || '',
    status: workoutData.status || '보이기',
    publish_date: workoutData.publish_date || ''
  };
  
  console.log('Sending request data:', requestData);
  return postRequest(API_CONFIG.baseURL, requestData);
}

async function apiUpdateWorkout(id, workoutData) {
  const requestData = {
    action: 'updateWorkout',
    id: id,
    title: workoutData.title || '',
    description: workoutData.description || '',
    author: workoutData.author || '',
    status: workoutData.status || '보이기',
    publish_date: workoutData.publish_date || ''
  };
  
  return postRequest(API_CONFIG.baseURL, requestData);
}

async function apiDeleteWorkout(id) {
  return postRequest(API_CONFIG.baseURL, { 
    action: 'deleteWorkout', 
    id: id 
  });
}

/**
 * 세그먼트 포함 워크아웃 생성 API (POST 방식)
 */
async function apiCreateWorkoutWithSegments(workoutData) {
  console.log('apiCreateWorkoutWithSegments called with:', workoutData);
  
  try {
    const requestData = {
      action: 'createWorkout',
      title: workoutData.title || '',
      description: workoutData.description || '',
      author: workoutData.author || '',
      status: workoutData.status || '보이기',
      publish_date: workoutData.publish_date || ''
    };
    
    // 세그먼트 데이터가 있으면 직접 포함 (POST에서는 JSON 직렬화 불필요)
    if (workoutData.segments && workoutData.segments.length > 0) {
      requestData.segments = workoutData.segments;
      console.log('Including segments:', requestData.segments);
    }
    
    console.log('Final API request data:', requestData);
    
    const result = await postRequest(API_CONFIG.baseURL, requestData);
    console.log('API response:', result);
    
    return result;
    
  } catch (error) {
    console.error('API call failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 목록 로드 및 렌더링 (개선된 버전)
 */
async function loadWorkouts() {
  const workoutList = document.getElementById('workoutList');
  if (!workoutList) return;

  try {
    // 로딩 상태 표시 (스피너 포함)
    workoutList.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <div style="color: #666; font-size: 14px;">워크아웃 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetWorkouts();
    
    if (!result.success) {
      // 오류 상태 표시
      workoutList.innerHTML = `
        <div class="error-state">
          <div class="error-state-icon">⚠️</div>
          <div class="error-state-title">워크아웃 목록을 불러올 수 없습니다</div>
          <div class="error-state-description">오류: ${result.error}</div>
          <button class="retry-button" onclick="loadWorkouts()">다시 시도</button>
        </div>
      `;
      return;
    }

    const workouts = result.items || [];
    
    if (workouts.length === 0) {
      // 빈 상태 표시
      workoutList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">등록된 워크아웃이 없습니다</div>
          <div class="empty-state-description">
            새로운 워크아웃을 만들어 훈련을 시작해보세요.<br>
            다양한 세그먼트를 조합하여 나만의 훈련 프로그램을 구성할 수 있습니다.
          </div>
          <div class="empty-state-action">
            <button class="btn btn-primary" onclick="showAddWorkoutForm(true)">
              ➕ 첫 번째 워크아웃 만들기
            </button>
          </div>
        </div>
      `;
      return;
    }

    // 워크아웃 카드 렌더링
    workoutList.innerHTML = workouts.map(workout => {
      const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
      const statusBadge = workout.status === '보이기' ? 
        '<span class="status-badge visible">공개</span>' : 
        '<span class="status-badge hidden">비공개</span>';
      
      return `
        <div class="workout-card" data-workout-id="${workout.id}">
          <div class="workout-header">
            <div class="workout-title">${workout.title}</div>
            <div class="workout-actions">
              <button class="btn-edit" onclick="editWorkout(${workout.id})" title="수정">✏️</button>
              <button class="btn-delete" onclick="deleteWorkout(${workout.id})" title="삭제">🗑️</button>
            </div>
          </div>
          <div class="workout-details">
            <div class="workout-meta">
              <span class="author">작성자: ${workout.author || '미상'}</span>
              <span class="duration">${totalMinutes}분</span>
              ${statusBadge}
            </div>
            <div class="workout-description">${workout.description || ''}</div>
            ${workout.publish_date ? `<div class="publish-date">게시일: ${new Date(workout.publish_date).toLocaleDateString()}</div>` : ''}
          </div>
          <button class="btn btn-primary" onclick="selectWorkout(${workout.id})">선택</button>
        </div>
      `;
    }).join('');

    // 전역에 워크아웃 목록 저장
    window.workouts = workouts;
    
    // 성공 메시지 (선택적)
    if (typeof showToast === 'function') {
      showToast(`${workouts.length}개의 워크아웃을 불러왔습니다.`);
    }
    
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    
    // 네트워크 오류 상태 표시
    workoutList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">🌐</div>
        <div class="error-state-title">연결 오류</div>
        <div class="error-state-description">
          인터넷 연결을 확인하고 다시 시도해주세요.<br>
          문제가 지속되면 관리자에게 문의하세요.
        </div>
        <button class="retry-button" onclick="loadWorkouts()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 워크아웃 선택
 */
async function selectWorkout(workoutId) {
  try {
    console.log('Selecting workout with ID:', workoutId);
    const result = await apiGetWorkout(workoutId);
    
    if (!result.success) {
      console.error('Failed to get workout:', result.error);
      showToast('워크아웃 정보를 불러올 수 없습니다.');
      return;
    }

    const workout = result.item;
    console.log('Retrieved workout:', workout);
    
    // 전역 상태에 현재 워크아웃 설정
    window.currentWorkout = workout;
    
    // 로컬 스토리지에 저장
    try {
      localStorage.setItem('currentWorkout', JSON.stringify(workout));
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }

    showToast(`${workout.title} 워크아웃이 선택되었습니다.`);
    
    // 훈련 준비 화면으로 이동
    if (typeof showScreen === 'function') {
      showScreen('trainingReadyScreen');
      console.log('Calling updateWorkoutPreview...');
      if (typeof updateWorkoutPreview === 'function') {
        updateWorkoutPreview();
      } else {
        console.error('updateWorkoutPreview function not found');
      }
    }
    
  } catch (error) {
    console.error('워크아웃 선택 실패:', error);
    showToast('워크아웃 선택 중 오류가 발생했습니다.');
  }
}

/**
 * 새 워크아웃 추가 폼 표시
 */
function showAddWorkoutForm(clearForm = true) {
  if (typeof showScreen === 'function') {
    showScreen('workoutBuilderScreen');
  }
  
  // clearForm이 true일 때만 폼 초기화
  if (clearForm) {
    // 각 요소가 존재하는지 확인 후 값 설정
    const titleEl = document.getElementById('wbTitle');
    const descEl = document.getElementById('wbDesc');
    const authorEl = document.getElementById('wbAuthor');
    const statusEl = document.getElementById('wbStatus');
    const publishDateEl = document.getElementById('wbPublishDate');
    
    if (titleEl) titleEl.value = '';
    if (descEl) descEl.value = '';
    if (authorEl) authorEl.value = '';
    if (statusEl) statusEl.value = '보이기';
    if (publishDateEl) publishDateEl.value = '';
    
    // 세그먼트 초기화
    workoutSegments = [];
    renderSegments();
    updateSegmentSummary();
  }
}

/**
 * 새 워크아웃 저장 - 애니메이션 및 개선된 오류 처리 포함
 */
async function saveWorkout() {
  // 수정 모드일 때는 실행하지 않음
  if (isWorkoutEditMode) {
    console.log('Edit mode active - saveWorkout blocked');
    return;
  }

  // 요소들 가져오기 및 null 체크
  const titleEl = document.getElementById('wbTitle');
  const descEl = document.getElementById('wbDesc');
  const authorEl = document.getElementById('wbAuthor');
  const statusEl = document.getElementById('wbStatus');
  const publishDateEl = document.getElementById('wbPublishDate');
  const saveBtn = document.getElementById('btnSaveWorkout');

  if (!titleEl || !descEl || !authorEl || !statusEl || !publishDateEl) {
    console.error('워크아웃 폼 요소를 찾을 수 없습니다.');
    showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }

  const title = titleEl.value.trim();
  const description = descEl.value.trim();
  const author = authorEl.value.trim();
  const status = statusEl.value || '보이기';
  const publishDate = publishDateEl.value || null;

  // 유효성 검사
  if (!title) {
    showToast('제목을 입력해주세요.');
    titleEl.focus();
    return;
  }

  // 저장 시작 - UI 상태 변경
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>저장 중...';
  }

  // 진행 상태 토스트
  showToast('워크아웃을 저장하는 중입니다...');

  try {
    console.log('=== 워크아웃 저장 시작 ===');
    console.log('Title:', title);
    console.log('Segments count:', workoutSegments.length);
    console.log('Segments data:', workoutSegments);

    // 세그먼트 데이터 검증
    const validSegments = workoutSegments.map(segment => ({
      label: segment.label || '세그먼트',
      segment_type: segment.segment_type || 'interval',
      duration_sec: Number(segment.duration_sec) || 300,
      target_type: segment.target_type || 'ftp_percent',
      target_value: Number(segment.target_value) || 100,
      ramp: segment.ramp || 'none',
      ramp_to_value: segment.ramp !== 'none' ? Number(segment.ramp_to_value) || null : null
    }));

    console.log('Validated segments:', validSegments);

    // 워크아웃 데이터 구성
    const workoutData = { 
      title, 
      description, 
      author, 
      status, 
      publish_date: publishDate,
      segments: validSegments
    };

    console.log('Final workout data:', workoutData);
    
    // API 호출 (POST 방식)
    const result = await apiCreateWorkoutWithSegments(workoutData);
    
    console.log('API result:', result);
    
    if (result.success) {
      // 성공 처리
      showToast(`${title} 워크아웃이 성공적으로 저장되었습니다!`);
      
      // 세그먼트 초기화
      workoutSegments = [];
      renderSegments();
      updateSegmentSummary();
      
      // 화면 전환
      if (typeof showScreen === 'function') {
        showScreen('workoutScreen');
      }
      
      // 목록 새로고침
      setTimeout(() => {
        loadWorkouts();
      }, 500);
      
    } else {
      throw new Error(result.error || '알 수 없는 오류가 발생했습니다.');
    }
    
  } catch (error) {
    console.error('워크아웃 저장 실패:', error);
    showToast('워크아웃 저장 중 오류가 발생했습니다: ' + error.message);
  } finally {
    // 저장 완료 - UI 상태 복원
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '💾 저장';
    }
  }
}

/**
 * 워크아웃 수정
 */
async function editWorkout(workoutId) {
  try {
    const result = await apiGetWorkout(workoutId);
    
    if (!result.success) {
      showToast('워크아웃 정보를 불러올 수 없습니다.');
      return;
    }

    const workout = result.item;
    
    // 수정 모드 활성화
    isWorkoutEditMode = true;
    currentEditWorkoutId = workoutId;
    console.log('Edit mode activated for workout:', workoutId);
    
    // 폼 표시 (초기화하지 않음)
    showAddWorkoutForm(false);
    
    // 요소들 가져오기 및 null 체크
    const titleEl = document.getElementById('wbTitle');
    const descEl = document.getElementById('wbDesc');
    const authorEl = document.getElementById('wbAuthor');
    const statusEl = document.getElementById('wbStatus');
    const publishDateEl = document.getElementById('wbPublishDate');
    
    if (!titleEl || !descEl || !authorEl || !statusEl || !publishDateEl) {
      console.error('워크아웃 폼 요소를 찾을 수 없습니다.');
      showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
      return;
    }
    
    // 수정 폼에 기존 데이터 채우기
    titleEl.value = workout.title || '';
    descEl.value = workout.description || '';
    authorEl.value = workout.author || '';
    statusEl.value = workout.status || '보이기';
    publishDateEl.value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
    
    // 저장 버튼을 업데이트 버튼으로 완전히 교체
    const saveBtn = document.getElementById('btnSaveWorkout');
    if (saveBtn) {
      saveBtn.textContent = '수정';
      saveBtn.removeEventListener('click', saveWorkout);
      saveBtn.onclick = null;
      saveBtn.onclick = () => performWorkoutUpdate();
    }
    
    // 폼 제목도 변경
    const formTitle = document.querySelector('#workoutBuilderScreen .header h1');
    if (formTitle) {
      formTitle.textContent = '워크아웃 수정';
    }
    
  } catch (error) {
    console.error('워크아웃 수정 실패:', error);
    showToast('워크아웃 정보 로드 중 오류가 발생했습니다.');
  }
}

/**
 * 실제 워크아웃 업데이트 실행 함수
 */
async function performWorkoutUpdate() {
  if (!isWorkoutEditMode || !currentEditWorkoutId) {
    console.error('Invalid edit mode state');
    return;
  }

  // 요소들 가져오기 및 null 체크
  const titleEl = document.getElementById('wbTitle');
  const descEl = document.getElementById('wbDesc');
  const authorEl = document.getElementById('wbAuthor');
  const statusEl = document.getElementById('wbStatus');
  const publishDateEl = document.getElementById('wbPublishDate');

  if (!titleEl || !descEl || !authorEl || !statusEl || !publishDateEl) {
    console.error('워크아웃 폼 요소를 찾을 수 없습니다.');
    showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }

  const title = titleEl.value.trim();
  const description = descEl.value.trim();
  const author = authorEl.value.trim();
  const status = statusEl.value || '보이기';
  const publishDate = publishDateEl.value || null;

  // 유효성 검사
  if (!title) {
    showToast('제목을 입력해주세요.');
    return;
  }

  try {
    const workoutData = { title, description, author, status, publish_date: publishDate };
    console.log('Updating workout:', currentEditWorkoutId, 'with data:', workoutData);
    
    const result = await apiUpdateWorkout(currentEditWorkoutId, workoutData);
    
    if (result.success) {
      showToast('워크아웃 정보가 수정되었습니다.');
      resetWorkoutFormMode(); // 모드 리셋 및 화면 이동
      loadWorkouts(); // 목록 새로고침
    } else {
      showToast('워크아웃 수정 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 업데이트 실패:', error);
    showToast('워크아웃 수정 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 삭제
 */
async function deleteWorkout(workoutId) {
  if (!confirm('정말로 이 워크아웃을 삭제하시겠습니까?\n삭제된 워크아웃의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    const result = await apiDeleteWorkout(workoutId);
    
    if (result.success) {
      showToast('워크아웃이 삭제되었습니다.');
      loadWorkouts(); // 목록 새로고침
    } else {
      showToast('워크아웃 삭제 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 삭제 실패:', error);
    showToast('워크아웃 삭제 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 폼 모드 리셋
 */
function resetWorkoutFormMode() {
  isWorkoutEditMode = false;
  currentEditWorkoutId = null;
  
  // 워크아웃 목록 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('workoutScreen');
  }
  
  // 저장 버튼을 다시 생성 모드로 되돌리기
  const saveBtn = document.getElementById('btnSaveWorkout');
  if (saveBtn) {
    saveBtn.textContent = '💾 저장';
    saveBtn.onclick = null;
    saveBtn.onclick = saveWorkout;
  }
  
  // 폼 제목도 원상 복구
  const formTitle = document.querySelector('#workoutBuilderScreen .header h1');
  if (formTitle) {
    formTitle.textContent = '✏️ 워크아웃 작성';
  }
  
  console.log('Workout form mode reset to add mode');
}

/* ==========================================================
   세그먼트 관리 기능
========================================================== */

// 세그먼트 관련 전역 변수
let workoutSegments = [];
let currentEditingSegmentIndex = null;

/**
 * 세그먼트 초기화 및 이벤트 바인딩
 */
function initializeSegmentManager() {
  // 세그먼트 추가 버튼
  const btnAddSegment = document.getElementById('btnAddSegment');
  if (btnAddSegment) {
    btnAddSegment.addEventListener('click', showAddSegmentModal);
  }
  
  // Ramp 체크박스
  const segmentRamp = document.getElementById('segmentRamp');
  if (segmentRamp) {
    segmentRamp.addEventListener('change', toggleRampSettings);
  }
  
  // 모달 외부 클릭 시 닫기
  const segmentModal = document.getElementById('segmentModal');
  if (segmentModal) {
    segmentModal.addEventListener('click', (e) => {
      if (e.target === segmentModal) {
        closeSegmentModal();
      }
    });
  }
}

/**
 * 빠른 세그먼트 추가
 */
function addQuickSegment(type) {
  const templates = {
    warmup: { label: '워밍업', type: 'warmup', duration: 600, intensity: 60 },
    interval: { label: '인터벌', type: 'interval', duration: 300, intensity: 120 },
    rest: { label: '휴식', type: 'rest', duration: 120, intensity: 50 },
    cooldown: { label: '쿨다운', type: 'cooldown', duration: 600, intensity: 60 }
  };
  
  const template = templates[type];
  if (template) {
    const segment = {
      id: Date.now(),
      label: template.label,
      segment_type: template.type,
      duration_sec: template.duration,
      target_type: 'ftp_percent',
      target_value: template.intensity,
      ramp: 'none',
      ramp_to_value: null
    };
    
    workoutSegments.push(segment);
    renderSegments();
    updateSegmentSummary();
  }
}

// 나머지 세그먼트 관련 함수들은 다음 파트에서 계속...

/**
 * 워크아웃 프리뷰 업데이트 함수
 */
function updateWorkoutPreview() {
  const workout = window.currentWorkout;
  if (!workout) {
    console.warn('currentWorkout이 설정되지 않았습니다.');
    return;
  }

  console.log('Updating workout preview with:', workout);

  // 기본 정보 업데이트
  const nameEl = document.getElementById('previewWorkoutName');
  const durationEl = document.getElementById('previewDuration');
  const intensityEl = document.getElementById('previewIntensity');
  const tssEl = document.getElementById('previewTSS');

  if (nameEl) nameEl.textContent = workout.title || '워크아웃';
  
  // 총 시간 계산 (초 -> 분)
  const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;

  // 평균 강도 계산
  let avgIntensity = 0;
  let totalDuration = 0;
  
  if (workout.segments && workout.segments.length > 0) {
    let weightedSum = 0;
    
    workout.segments.forEach(segment => {
      const duration = segment.duration_sec || 0;
      const intensity = segment.target_value || 0;
      weightedSum += (duration * intensity);
      totalDuration += duration;
    });
    
    if (totalDuration > 0) {
      avgIntensity = Math.round(weightedSum / totalDuration);
    }
  }
  
  if (intensityEl) intensityEl.textContent = `${avgIntensity}%`;

  // TSS 계산 (간단한 추정)
  const estimatedTSS = Math.round((totalMinutes * avgIntensity * avgIntensity) / 10000);
  if (tssEl) tssEl.textContent = estimatedTSS;

  // 세그먼트 프리뷰 업데이트
  updateSegmentPreview(workout.segments || []);
}

// 전역 함수로 내보내기
window.loadWorkouts = loadWorkouts;
window.selectWorkout = selectWorkout;
window.editWorkout = editWorkout;
window.deleteWorkout = deleteWorkout;
window.saveWorkout = saveWorkout;
window.updateWorkoutPreview = updateWorkoutPreview;
window.addQuickSegment = addQuickSegment;

// API 함수 전역 내보내기
window.apiCreateWorkoutWithSegments = apiCreateWorkoutWithSegments;
