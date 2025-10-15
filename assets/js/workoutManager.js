/* ==========================================================
   완벽한 워크아웃 관리 모듈 (perfectWorkoutManager.js)
   - 원본의 모든 기능 + 대용량 세그먼트 지원
   - CORS 문제 해결된 JSONP 방식
   - 무제한 세그먼트 지원 (분할 전송)
   - 완전한 세그먼트 관리 및 반복 기능
========================================================== */

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

// 세그먼트 분할 전송 설정 (대용량 지원)
const SEGMENT_BATCH_SIZE = 5;
const MAX_URL_LENGTH = 1800;

// JSONP 방식 API 호출 헬퍼 함수 (원본 기반 + 개선)
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.round(Math.random() * 10000);
    const script = document.createElement('script');
    
    console.log('JSONP request to:', url, 'with params:', params);
    
    window[callbackName] = function(data) {
      console.log('JSONP response received:', data);
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };
    
    script.onerror = function() {
      console.error('JSONP script loading failed');
      delete window[callbackName];
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      reject(new Error('네트워크 연결 오류'));
    };
    
    // URL 파라미터 구성 - 한글 처리 개선
    const urlParams = new URLSearchParams();
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        urlParams.set(key, params[key].toString());
      }
    });
    urlParams.set('callback', callbackName);
    
    const finalUrl = `${url}?${urlParams.toString()}`;
    console.log('Final JSONP URL:', finalUrl);
    
    script.src = finalUrl;
    document.body.appendChild(script);
    
    // 타임아웃 처리
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP request timeout');
        delete window[callbackName];
        if (document.body.contains(script)) {
          document.body.removeChild(script);
        }
        reject(new Error('요청 시간 초과'));
      }
    }, 10000);
  });
}

// 워크아웃 API 함수들 (JSONP 방식)
async function apiGetWorkouts() {
  return jsonpRequest(window.GAS_URL, { action: 'listWorkouts' });
}

async function apiGetAllWorkouts() {
  return jsonpRequest(window.GAS_URL, { action: 'listAllWorkouts' });
}

async function apiGetWorkout(id) {
  return jsonpRequest(window.GAS_URL, { action: 'getWorkout', id: id });
}

async function apiCreateWorkout(workoutData) {
  console.log('apiCreateWorkout called with:', workoutData);
  const params = {
    action: 'createWorkout',
    title: workoutData.title || '',
    description: workoutData.description || '',
    author: workoutData.author || '',
    status: workoutData.status || '보이기',
    publish_date: workoutData.publish_date || ''
  };
  console.log('Sending params:', params);
  return jsonpRequest(window.GAS_URL, params);
}

async function apiUpdateWorkout(id, workoutData) {
  const params = {
    action: 'updateWorkout',
    id: id,
    title: workoutData.title || '',
    description: workoutData.description || '',
    author: workoutData.author || '',
    status: workoutData.status || '보이기',
    publish_date: workoutData.publish_date || ''
  };
  return jsonpRequest(window.GAS_URL, params);
}

async function apiDeleteWorkout(id) {
  return jsonpRequest(window.GAS_URL, { action: 'deleteWorkout', id: id });
}

/**
 * 세그먼트 포함 워크아웃 생성 API (원본 + 대용량 지원)
 */
async function apiCreateWorkoutWithSegments(workoutData) {
  console.log('apiCreateWorkoutWithSegments called with:', workoutData);
  
  try {
    const params = {
      action: 'createWorkout',
      title: workoutData.title || '',
      description: workoutData.description || '',
      author: workoutData.author || '',
      status: workoutData.status || '보이기',
      publish_date: workoutData.publish_date || ''
    };
    
    // 세그먼트 데이터가 있으면 처리
    if (workoutData.segments && workoutData.segments.length > 0) {
      // 원본 방식 (소량) 또는 분할 방식 (대량) 자동 선택
      if (workoutData.segments.length <= 8) {
        // 원본 방식: JSON 문자열로 인코딩
        params.segments = encodeURIComponent(JSON.stringify(workoutData.segments));
        console.log('Using original method for', workoutData.segments.length, 'segments');
        
        const result = await jsonpRequest(window.GAS_URL, params);
        return result;
      } else {
        // 대용량 방식: 분할 전송
        console.log('Using batch method for', workoutData.segments.length, 'segments');
        return await apiCreateWorkoutWithBatchSegments(workoutData);
      }
    }
    
    console.log('Final API params:', params);
    const result = await jsonpRequest(window.GAS_URL, params);
    console.log('API response:', result);
    return result;
    
  } catch (error) {
    console.error('API call failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 대용량 세그먼트 분할 전송 방식
 */
async function apiCreateWorkoutWithBatchSegments(workoutData) {
  try {
    // 1단계: 기본 워크아웃 생성
    const baseParams = {
      action: 'createWorkout',
      title: workoutData.title || '',
      description: workoutData.description || '',
      author: workoutData.author || '',
      status: workoutData.status || '보이기',
      publish_date: workoutData.publish_date || ''
    };
    
    const createResult = await jsonpRequest(window.GAS_URL, baseParams);
    if (!createResult.success) {
      throw new Error(createResult.error || '워크아웃 생성 실패');
    }
    
    const workoutId = createResult.workoutId || createResult.id;
    
    // 2단계: 세그먼트 분할 전송
    const segments = workoutData.segments;
    const batches = [];
    for (let i = 0; i < segments.length; i += SEGMENT_BATCH_SIZE) {
      batches.push(segments.slice(i, i + SEGMENT_BATCH_SIZE));
    }
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const segmentParams = {
        action: 'addSegments',
        workoutId: workoutId,
        batchIndex: batchIndex,
        totalBatches: batches.length,
        segments: encodeURIComponent(JSON.stringify(batch))
      };
      
      const batchResult = await jsonpRequest(window.GAS_URL, segmentParams);
      if (!batchResult.success) {
        throw new Error(`배치 ${batchIndex + 1} 전송 실패: ${batchResult.error}`);
      }
      
      // 배치 간 간격
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return { success: true, workoutId: workoutId };
    
  } catch (error) {
    console.error('Batch creation failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 목록 로드 및 렌더링 (원본 기반)
 */
async function loadWorkouts() {
  const workoutList = document.getElementById('workoutList');
  if (!workoutList) return;

  try {
    // 로딩 상태 표시
    workoutList.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <div style="color: #666; font-size: 14px;">워크아웃 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetWorkouts();
    
    if (!result.success) {
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
    
    if (typeof showToast === 'function') {
      showToast(`${workouts.length}개의 워크아웃을 불러왔습니다.`);
    }
    
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    
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
 * 워크아웃 선택 (원본)
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
 * 새 워크아웃 추가 폼 표시 (원본)
 */
function showAddWorkoutForm(clearForm = true) {
  if (typeof showScreen === 'function') {
    showScreen('workoutBuilderScreen');
  }
  
  if (clearForm) {
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
 * 새 워크아웃 저장 (원본 + 대용량 지원)
 */
async function saveWorkout() {
  if (isWorkoutEditMode) {
    console.log('Edit mode active - saveWorkout blocked');
    return;
  }

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

  // 세그먼트 개수에 따른 진행 상태 토스트
  if (workoutSegments.length > 8) {
    showToast(`대용량 워크아웃(${workoutSegments.length}개 세그먼트)을 저장하는 중입니다...`);
  } else {
    showToast('워크아웃을 저장하는 중입니다...');
  }

  try {
    console.log('=== 워크아웃 저장 시작 ===');
    console.log('Title:', title);
    console.log('Segments count:', workoutSegments.length);

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
    
    // API 호출 (자동 방식 선택)
    const result = await apiCreateWorkoutWithSegments(workoutData);
    
    console.log('API result:', result);
    
    if (result.success) {
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
 * 워크아웃 수정 (원본)
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
 * 실제 워크아웃 업데이트 실행 함수 (원본)
 */
async function performWorkoutUpdate() {
  if (!isWorkoutEditMode || !currentEditWorkoutId) {
    console.error('Invalid edit mode state');
    return;
  }

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
      resetWorkoutFormMode();
      loadWorkouts();
    } else {
      showToast('워크아웃 수정 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 업데이트 실패:', error);
    showToast('워크아웃 수정 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 삭제 (원본)
 */
async function deleteWorkout(workoutId) {
  if (!confirm('정말로 이 워크아웃을 삭제하시겠습니까?\n삭제된 워크아웃의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    const result = await apiDeleteWorkout(workoutId);
    
    if (result.success) {
      showToast('워크아웃이 삭제되었습니다.');
      loadWorkouts();
    } else {
      showToast('워크아웃 삭제 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 삭제 실패:', error);
    showToast('워크아웃 삭제 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 폼 모드 리셋 (원본)
 */
function resetWorkoutFormMode() {
  isWorkoutEditMode = false;
  currentEditWorkoutId = null;
  
  if (typeof showScreen === 'function') {
    showScreen('workoutScreen');
  }
  
  const saveBtn = document.getElementById('btnSaveWorkout');
  if (saveBtn) {
    saveBtn.textContent = '💾 저장';
    saveBtn.onclick = null;
    saveBtn.onclick = saveWorkout;
  }
  
  const formTitle = document.querySelector('#workoutBuilderScreen .header h1');
  if (formTitle) {
    formTitle.textContent = '✏️ 워크아웃 작성';
  }
  
  console.log('Workout form mode reset to add mode');
}

/* ==========================================================
   세그먼트 관리 기능 (원본 완전 포함)
========================================================== */

// 세그먼트 관련 전역 변수
let workoutSegments = [];
let currentEditingSegmentIndex = null;

/**
 * 세그먼트 초기화 및 이벤트 바인딩 (원본)
 */
function initializeSegmentManager() {
  const btnAddSegment = document.getElementById('btnAddSegment');
  if (btnAddSegment) {
    btnAddSegment.addEventListener('click', showAddSegmentModal);
  }
  
  const segmentRamp = document.getElementById('segmentRamp');
  if (segmentRamp) {
    segmentRamp.addEventListener('change', toggleRampSettings);
  }
  
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
 * 빠른 세그먼트 추가 (원본)
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

/**
 * 세그먼트 추가 모달 표시 (원본)
 */
function showAddSegmentModal() {
  currentEditingSegmentIndex = null;
  
  document.getElementById('segmentModalTitle').textContent = '새 세그먼트 추가';
  document.getElementById('segmentLabel').value = '';
  document.getElementById('segmentType').value = 'interval';
  document.getElementById('segmentMinutes').value = '5';
  document.getElementById('segmentSeconds').value = '0';
  document.getElementById('segmentIntensity').value = '100';
  document.getElementById('segmentRamp').checked = false;
  document.getElementById('rampEndIntensity').value = '120';
  
  document.getElementById('btnDeleteSegment').style.display = 'none';
  document.getElementById('rampSettings').classList.add('hidden');
  document.getElementById('segmentModal').classList.remove('hidden');
}

/**
 * 세그먼트 편집 모달 표시 (원본)
 */
function showEditSegmentModal(index) {
  const segment = workoutSegments[index];
  if (!segment) return;
  
  currentEditingSegmentIndex = index;
  
  document.getElementById('segmentModalTitle').textContent = '세그먼트 편집';
  document.getElementById('segmentLabel').value = segment.label || '';
  document.getElementById('segmentType').value = segment.segment_type || 'interval';
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  document.getElementById('segmentMinutes').value = minutes;
  document.getElementById('segmentSeconds').value = seconds;
  
  document.getElementById('segmentIntensity').value = segment.target_value || 100;
  
  const hasRamp = segment.ramp && segment.ramp !== 'none';
  document.getElementById('segmentRamp').checked = hasRamp;
  document.getElementById('rampEndIntensity').value = segment.ramp_to_value || 120;
  
  document.getElementById('btnDeleteSegment').style.display = 'inline-block';
  
  const rampSettings = document.getElementById('rampSettings');
  if (hasRamp) {
    rampSettings.classList.remove('hidden');
  } else {
    rampSettings.classList.add('hidden');
  }
  
  document.getElementById('segmentModal').classList.remove('hidden');
}

/**
 * Ramp 설정 토글 (원본)
 */
function toggleRampSettings() {
  const isChecked = document.getElementById('segmentRamp').checked;
  const rampSettings = document.getElementById('rampSettings');
  
  if (isChecked) {
    rampSettings.classList.remove('hidden');
  } else {
    rampSettings.classList.add('hidden');
  }
}

/**
 * 통합된 세그먼트 저장 함수 (원본)
 */
function saveSegment() {
  // 반복 세그먼트 편집 모드인지 먼저 확인
  if (typeof currentEditingRepeatIndex === 'number' && currentEditingRepeatIndex !== null) {
    console.log('Saving repeat segment at index:', currentEditingRepeatIndex);
    saveRepeatSegment();
    return;
  }
  
  // 기존 일반 세그먼트 저장 로직
  console.log('Saving regular segment');
  
  const label = document.getElementById('segmentLabel').value.trim();
  const type = document.getElementById('segmentType').value;
  const minutes = parseInt(document.getElementById('segmentMinutes').value) || 0;
  const seconds = parseInt(document.getElementById('segmentSeconds').value) || 0;
  const intensity = parseInt(document.getElementById('segmentIntensity').value) || 100;
  const hasRamp = document.getElementById('segmentRamp').checked;
  const rampEndIntensity = parseInt(document.getElementById('rampEndIntensity').value) || 120;
  
  if (!label) {
    showToast('세그먼트 이름을 입력해주세요.');
    return;
  }
  
  const totalSeconds = minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    showToast('지속 시간은 0보다 커야 합니다.');
    return;
  }
  
  if (intensity < 30 || intensity > 200) {
    showToast('목표 강도는 30-200% 범위여야 합니다.');
    return;
  }
  
  const segment = {
    id: currentEditingSegmentIndex !== null ? workoutSegments[currentEditingSegmentIndex].id : Date.now(),
    label: label,
    segment_type: type,
    duration_sec: totalSeconds,
    target_type: 'ftp_percent',
    target_value: intensity,
    ramp: hasRamp ? 'linear' : 'none',
    ramp_to_value: hasRamp ? rampEndIntensity : null
  };
  
  if (currentEditingSegmentIndex !== null) {
    workoutSegments[currentEditingSegmentIndex] = segment;
  } else {
    workoutSegments.push(segment);
  }
  
  renderSegments();
  updateSegmentSummary();
  closeSegmentModal();
  
  showToast(currentEditingSegmentIndex !== null ? '세그먼트가 수정되었습니다.' : '세그먼트가 추가되었습니다.');
}

/**
 * 현재 편집 중인 세그먼트 삭제 (원본)
 */
function deleteCurrentSegment() {
  if (currentEditingSegmentIndex === null) return;
  
  if (confirm('이 세그먼트를 삭제하시겠습니까?')) {
    workoutSegments.splice(currentEditingSegmentIndex, 1);
    renderSegments();
    updateSegmentSummary();
    closeSegmentModal();
    showToast('세그먼트가 삭제되었습니다.');
  }
}

/**
 * 세그먼트 모달 닫기 (원본)
 */
function closeSegmentModal() {
  document.getElementById('segmentModal').classList.add('hidden');
  
  // 반복 편집 모드였다면 반복 모달을 다시 표시
  if (currentEditingRepeatIndex !== null) {
    document.getElementById('repeatModal').classList.remove('hidden');
    currentEditingRepeatIndex = null;
  }
  
  currentEditingSegmentIndex = null;
}

/**
 * 세그먼트 목록 렌더링 (원본)
 */
function renderSegments() {
  const container = document.getElementById('wbSegments');
  const emptyState = document.getElementById('segmentsEmpty');
  
  if (!container) return;
  
  if (workoutSegments.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.querySelectorAll('.segment-card').forEach(card => card.remove());
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  container.querySelectorAll('.segment-card').forEach(card => card.remove());
  
  workoutSegments.forEach((segment, index) => {
    const card = createSegmentCard(segment, index);
    container.appendChild(card);
  });
}

/**
 * 세그먼트 카드 생성 (원본)
 */
function createSegmentCard(segment, index) {
  const card = document.createElement('div');
  card.className = 'segment-card';
  card.setAttribute('data-index', index);
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  const intensityText = segment.ramp !== 'none' 
    ? `${segment.target_value}% → ${segment.ramp_to_value}%`
    : `${segment.target_value}%`;
  
  card.innerHTML = `
    <div class="segment-drag-handle">⋮⋮</div>
    <div class="segment-info">
      <span class="segment-type-badge ${segment.segment_type}">${segment.segment_type}</span>
      <div class="segment-details">
        <div class="segment-label">${segment.label}</div>
        <div class="segment-meta">
          <span>${duration}</span> • 
          <span class="segment-intensity">${intensityText} FTP</span>
        </div>
      </div>
    </div>
    <div class="segment-actions">
      <button class="segment-edit-btn" onclick="showEditSegmentModal(${index})" title="편집">✏️</button>
      <button class="segment-delete-btn" onclick="deleteSegment(${index})" title="삭제">🗑️</button>
    </div>
  `;
  
  return card;
}

/**
 * 세그먼트 삭제 (원본)
 */
function deleteSegment(index) {
  if (confirm('이 세그먼트를 삭제하시겠습니까?')) {
    workoutSegments.splice(index, 1);
    renderSegments();
    updateSegmentSummary();
    showToast('세그먼트가 삭제되었습니다.');
  }
}

/**
 * 세그먼트 요약 정보 업데이트 (원본)
 */
function updateSegmentSummary() {
  const totalSeconds = workoutSegments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  const segmentCount = workoutSegments.length;
  
  const durationEl = document.getElementById('totalDuration');
  const countEl = document.getElementById('segmentCount');
  
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;
  if (countEl) countEl.textContent = `${segmentCount}개`;
}

/* ==========================================================
   세그먼트 반복 기능 (원본 완전 포함)
========================================================== */

// 반복용 세그먼트 임시 저장소
let repeatSegments = [];
let currentEditingRepeatIndex = null;

/**
 * 반복 모달 표시 (원본)
 */
function showRepeatModal() {
  document.getElementById('repeatCount').value = '3';
  repeatSegments = [];
  renderRepeatSegments();
  document.getElementById('repeatModal').classList.remove('hidden');
}

/**
 * 반복 모달 닫기 (원본)
 */
function closeRepeatModal() {
  document.getElementById('repeatModal').classList.add('hidden');
  repeatSegments = [];
  currentEditingRepeatIndex = null;
}

/**
 * 반복용 세그먼트 추가 (원본)
 */
function addRepeatSegment() {
  const newSegment = {
    id: Date.now(),
    label: '새 세그먼트',
    segment_type: 'interval',
    duration_sec: 300,
    target_type: 'ftp_percent',
    target_value: 100,
    ramp: 'none',
    ramp_to_value: null
  };
  
  repeatSegments.push(newSegment);
  renderRepeatSegments();
}

/**
 * 반복용 세그먼트 목록 렌더링 (원본)
 */
function renderRepeatSegments() {
  const container = document.getElementById('repeatSegmentsList');
  
  if (repeatSegments.length === 0) {
    container.innerHTML = '<div class="repeat-segments-empty">반복할 세그먼트를 추가하세요</div>';
    return;
  }
  
  container.innerHTML = repeatSegments.map((segment, index) => {
    const minutes = Math.floor(segment.duration_sec / 60);
    const seconds = segment.duration_sec % 60;
    const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    return `
      <div class="repeat-segment-item" data-index="${index}">
        <div class="repeat-segment-info">
          <div class="repeat-segment-label">${segment.label}</div>
          <div class="repeat-segment-details">
            ${segment.segment_type} · ${duration} · ${segment.target_value}% FTP
          </div>
        </div>
        <div class="repeat-segment-actions">
          <button class="btn btn-secondary btn-sm" onclick="editRepeatSegment(${index})">편집</button>
          <button class="repeat-segment-remove" onclick="removeRepeatSegment(${index})" title="삭제">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 반복용 세그먼트 편집 (원본)
 */
function editRepeatSegment(index) {
  console.log('editRepeatSegment called with index:', index);
  
  const segment = repeatSegments[index];
  if (!segment) {
    console.error('Segment not found at index:', index);
    showToast('세그먼트를 찾을 수 없습니다.');
    return;
  }
  
  currentEditingRepeatIndex = index;
  currentEditingSegmentIndex = null;
  
  document.getElementById('segmentModalTitle').textContent = '반복 세그먼트 편집';
  document.getElementById('segmentLabel').value = segment.label || '';
  document.getElementById('segmentType').value = segment.segment_type || 'interval';
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  document.getElementById('segmentMinutes').value = minutes;
  document.getElementById('segmentSeconds').value = seconds;
  
  document.getElementById('segmentIntensity').value = segment.target_value || 100;
  
  const hasRamp = segment.ramp && segment.ramp !== 'none';
  document.getElementById('segmentRamp').checked = hasRamp;
  document.getElementById('rampEndIntensity').value = segment.ramp_to_value || 120;
  
  const rampSettings = document.getElementById('rampSettings');
  if (hasRamp) {
    rampSettings.classList.remove('hidden');
  } else {
    rampSettings.classList.add('hidden');
  }
  
  const deleteBtn = document.getElementById('btnDeleteSegment');
  if (deleteBtn) {
    deleteBtn.style.display = 'none';
  }
  
  document.getElementById('repeatModal').classList.add('hidden');
  document.getElementById('segmentModal').classList.remove('hidden');
}

/**
 * 반복용 세그먼트 제거 (원본)
 */
function removeRepeatSegment(index) {
  if (confirm('이 세그먼트를 제거하시겠습니까?')) {
    repeatSegments.splice(index, 1);
    renderRepeatSegments();
  }
}

/**
 * 반복 적용 (원본)
 */
function applyRepeat() {
  const repeatCount = parseInt(document.getElementById('repeatCount').value);
  
  if (!repeatCount || repeatCount < 1 || repeatCount > 20) {
    showToast('반복 횟수는 1-20 사이여야 합니다.');
    return;
  }
  
  if (repeatSegments.length === 0) {
    showToast('반복할 세그먼트를 최소 1개 이상 추가해주세요.');
    return;
  }
  
  for (let i = 0; i < repeatCount; i++) {
    repeatSegments.forEach(segment => {
      const newSegment = {
        id: Date.now() + Math.random(),
        label: `${segment.label} (${i + 1}회차)`,
        segment_type: segment.segment_type,
        duration_sec: segment.duration_sec,
        target_type: segment.target_type,
        target_value: segment.target_value,
        ramp: segment.ramp,
        ramp_to_value: segment.ramp_to_value
      };
      
      workoutSegments.push(newSegment);
    });
  }
  
  renderSegments();
  updateSegmentSummary();
  closeRepeatModal();
  
  const totalAdded = repeatSegments.length * repeatCount;
  showToast(`${totalAdded}개의 세그먼트가 추가되었습니다.`);
}

/**
 * 반복 세그먼트 저장 (원본)
 */
function saveRepeatSegment() {
  console.log('saveRepeatSegment called');
  
  const label = document.getElementById('segmentLabel').value.trim();
  const type = document.getElementById('segmentType').value;
  const minutes = parseInt(document.getElementById('segmentMinutes').value) || 0;
  const seconds = parseInt(document.getElementById('segmentSeconds').value) || 0;
  const intensity = parseInt(document.getElementById('segmentIntensity').value) || 100;
  const hasRamp = document.getElementById('segmentRamp').checked;
  const rampEndIntensity = parseInt(document.getElementById('rampEndIntensity').value) || 120;
  
  if (!label) {
    showToast('세그먼트 이름을 입력해주세요.');
    return;
  }
  
  const totalSeconds = minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    showToast('지속 시간은 0보다 커야 합니다.');
    return;
  }
  
  if (intensity < 30 || intensity > 200) {
    showToast('목표 강도는 30-200% 범위여야 합니다.');
    return;
  }
  
  if (currentEditingRepeatIndex !== null && repeatSegments[currentEditingRepeatIndex]) {
    repeatSegments[currentEditingRepeatIndex] = {
      id: repeatSegments[currentEditingRepeatIndex].id,
      label: label,
      segment_type: type,
      duration_sec: totalSeconds,
      target_type: 'ftp_percent',
      target_value: intensity,
      ramp: hasRamp ? 'linear' : 'none',
      ramp_to_value: hasRamp ? rampEndIntensity : null
    };
    
    document.getElementById('segmentModal').classList.add('hidden');
    document.getElementById('repeatModal').classList.remove('hidden');
    renderRepeatSegments();
    currentEditingRepeatIndex = null;
    
    showToast('반복 세그먼트가 수정되었습니다.');
  } else {
    console.error('Invalid currentEditingRepeatIndex:', currentEditingRepeatIndex);
    showToast('저장 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 프리뷰 업데이트 함수 (원본)
 */
function updateWorkoutPreview() {
  const workout = window.currentWorkout;
  if (!workout) {
    console.warn('currentWorkout이 설정되지 않았습니다.');
    return;
  }

  console.log('Updating workout preview with:', workout);

  const nameEl = document.getElementById('previewWorkoutName');
  const durationEl = document.getElementById('previewDuration');
  const intensityEl = document.getElementById('previewIntensity');
  const tssEl = document.getElementById('previewTSS');

  if (nameEl) nameEl.textContent = workout.title || '워크아웃';
  
  const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;

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

  const estimatedTSS = Math.round((totalMinutes * avgIntensity * avgIntensity) / 10000);
  if (tssEl) tssEl.textContent = estimatedTSS;

  updateSegmentPreview(workout.segments || []);
}

/**
 * 세그먼트 프리뷰 업데이트 (원본)
 */
function updateSegmentPreview(segments) {
  const segDiv = document.getElementById('segmentPreview');
  if (!segDiv) return;

  if (!segments || segments.length === 0) {
    segDiv.innerHTML = '<div class="text-center muted">세그먼트 정보가 없습니다.</div>';
    return;
  }

  segDiv.innerHTML = segments.map(segment => {
    const minutes = Math.floor((segment.duration_sec || 0) / 60);
    const seconds = (segment.duration_sec || 0) % 60;
    const duration = seconds > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${minutes}분`;
    
    const segmentTypeClass = getSegmentTypeClass(segment.segment_type);
    
    return `
      <div class="segment-item ${segmentTypeClass}">
        <h4>${segment.label || '세그먼트'}</h4>
        <div class="ftp-percent">${segment.target_value || 0}%</div>
        <div class="duration">${duration}</div>
      </div>
    `;
  }).join('');
}

/**
 * 세그먼트 타입에 따른 CSS 클래스 반환 (원본)
 */
function getSegmentTypeClass(segmentType) {
  const typeMapping = {
    'warmup': 'warmup',
    'rest': 'rest', 
    'interval': 'interval',
    'cooldown': 'rest',
    'tempo': 'interval',
    'sweetspot': 'interval',
    'threshold': 'interval',
    'vo2max': 'interval'
  };
  
  return typeMapping[segmentType] || 'interval';
}

/**
 * 초기화 및 이벤트 바인딩 (원본)
 */
document.addEventListener('DOMContentLoaded', () => {
  // 새 워크아웃 버튼
  const btnOpenBuilder = document.getElementById('btnOpenBuilder');
  if (btnOpenBuilder) {
    btnOpenBuilder.addEventListener('click', () => showAddWorkoutForm(true));
  }
  
  // 취소 버튼
  const btnCancel = document.getElementById('btnCancelBuilder');
  if (btnCancel) {
    btnCancel.addEventListener('click', resetWorkoutFormMode);
  }
  
  // 저장 버튼
  const btnSave = document.getElementById('btnSaveWorkout');
  if (btnSave) {
    btnSave.addEventListener('click', saveWorkout);
  }
  
  // 세그먼트 관리 초기화
  initializeSegmentManager();
  
  // 반복 모달 외부 클릭 시 닫기
  const repeatModal = document.getElementById('repeatModal');
  if (repeatModal) {
    repeatModal.addEventListener('click', (e) => {
      if (e.target === repeatModal) {
        closeRepeatModal();
      }
    });
  }
});

// 전역 함수로 내보내기 (완전한 목록)
window.loadWorkouts = loadWorkouts;
window.selectWorkout = selectWorkout;
window.editWorkout = editWorkout;
window.deleteWorkout = deleteWorkout;
window.saveWorkout = saveWorkout;
window.updateWorkoutPreview = updateWorkoutPreview;
window.showAddWorkoutForm = showAddWorkoutForm;
window.resetWorkoutFormMode = resetWorkoutFormMode;
window.performWorkoutUpdate = performWorkoutUpdate;

// 세그먼트 관련 전역 함수
window.addQuickSegment = addQuickSegment;
window.showAddSegmentModal = showAddSegmentModal;
window.showEditSegmentModal = showEditSegmentModal;
window.deleteSegment = deleteSegment;
window.saveSegment = saveSegment;
window.closeSegmentModal = closeSegmentModal;
window.deleteCurrentSegment = deleteCurrentSegment;
window.toggleRampSettings = toggleRampSettings;
window.renderSegments = renderSegments;
window.updateSegmentSummary = updateSegmentSummary;

// 반복 기능 전역 함수
window.showRepeatModal = showRepeatModal;
window.closeRepeatModal = closeRepeatModal;
window.addRepeatSegment = addRepeatSegment;
window.editRepeatSegment = editRepeatSegment;
window.removeRepeatSegment = removeRepeatSegment;
window.applyRepeat = applyRepeat;

// API 함수 전역 내보내기
window.apiCreateWorkoutWithSegments = apiCreateWorkoutWithSegments;
window.apiGetWorkouts = apiGetWorkouts;
window.apiGetWorkout = apiGetWorkout;
window.apiCreateWorkout = apiCreateWorkout;
window.apiUpdateWorkout = apiUpdateWorkout;
window.apiDeleteWorkout = apiDeleteWorkout;
