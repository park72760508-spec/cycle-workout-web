/* ==========================================================
   향상된 워크아웃 관리 모듈 (enhancedWorkoutManager.js)
   - 무제한 세그먼트 지원 (분할 전송 방식)
   - CORS 문제 해결된 하이브리드 JSONP 방식
   - 대용량 세그먼트 데이터 처리 최적화
========================================================== */

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

// 세그먼트 분할 전송 설정
const SEGMENT_BATCH_SIZE = 5; // 한 번에 전송할 세그먼트 개수
const MAX_URL_LENGTH = 1800; // 안전한 URL 길이 (IE 호환)

// 개선된 JSONP 방식 API 호출 헬퍼 함수
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
    
    // URL 파라미터 구성
    const urlParams = new URLSearchParams();
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        urlParams.set(key, params[key].toString());
      }
    });
    urlParams.set('callback', callbackName);
    
    const finalUrl = `${url}?${urlParams.toString()}`;
    
    // URL 길이 체크
    if (finalUrl.length > MAX_URL_LENGTH) {
      console.warn('URL length exceeds limit:', finalUrl.length);
    }
    
    console.log('Final JSONP URL length:', finalUrl.length);
    
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
    }, 15000); // 15초 타임아웃
  });
}

/**
 * 세그먼트 데이터 최적화 (크기 축소)
 */
function optimizeSegmentData(segments) {
  return segments.map(segment => ({
    l: segment.label || 'S', // label → l
    t: segment.segment_type || 'i', // type → t (i=interval, w=warmup, r=rest, c=cooldown)
    d: segment.duration_sec || 300, // duration → d
    v: segment.target_value || 100, // value → v
    r: segment.ramp === 'linear' ? 1 : 0, // ramp → r (0=none, 1=linear)
    e: segment.ramp_to_value || null // end → e
  }));
}

/**
 * 최적화된 세그먼트 데이터 복원
 */
function restoreSegmentData(optimizedSegments) {
  if (!optimizedSegments) return [];
  
  return optimizedSegments.map(seg => ({
    label: seg.l || '세그먼트',
    segment_type: seg.t || 'interval',
    duration_sec: seg.d || 300,
    target_type: 'ftp_percent',
    target_value: seg.v || 100,
    ramp: seg.r ? 'linear' : 'none',
    ramp_to_value: seg.e
  }));
}

/**
 * 대용량 세그먼트 포함 워크아웃 생성 (분할 전송 방식)
 */
async function apiCreateWorkoutWithSegments(workoutData) {
  console.log('=== 대용량 세그먼트 워크아웃 생성 시작 ===');
  console.log('세그먼트 개수:', workoutData.segments?.length || 0);
  
  try {
    // 1단계: 기본 워크아웃 생성 (세그먼트 없이)
    const baseParams = {
      action: 'createWorkout',
      title: workoutData.title || '',
      description: workoutData.description || '',
      author: workoutData.author || '',
      status: workoutData.status || '보이기',
      publish_date: workoutData.publish_date || ''
    };
    
    console.log('1단계: 기본 워크아웃 생성');
    const createResult = await jsonpRequest(window.GAS_URL, baseParams);
    
    if (!createResult.success) {
      throw new Error(createResult.error || '워크아웃 생성 실패');
    }
    
    const workoutId = createResult.workoutId || createResult.id;
    console.log('워크아웃 생성 완료, ID:', workoutId);
    
    // 2단계: 세그먼트가 있으면 분할 전송
    if (workoutData.segments && workoutData.segments.length > 0) {
      console.log('2단계: 세그먼트 분할 전송 시작');
      
      // 세그먼트 데이터 최적화
      const optimizedSegments = optimizeSegmentData(workoutData.segments);
      console.log('최적화된 세그먼트:', optimizedSegments);
      
      // 세그먼트를 배치로 분할
      const batches = [];
      for (let i = 0; i < optimizedSegments.length; i += SEGMENT_BATCH_SIZE) {
        batches.push(optimizedSegments.slice(i, i + SEGMENT_BATCH_SIZE));
      }
      
      console.log(`${optimizedSegments.length}개 세그먼트를 ${batches.length}개 배치로 분할`);
      
      // 각 배치별로 전송
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        // URL 길이 체크를 위한 테스트 인코딩
        const testJson = JSON.stringify(batch);
        const testEncoded = encodeURIComponent(testJson);
        
        console.log(`배치 ${batchIndex + 1}/${batches.length}: ${batch.length}개 세그먼트, 크기: ${testEncoded.length}바이트`);
        
        const segmentParams = {
          action: 'addSegments',
          workoutId: workoutId,
          batchIndex: batchIndex,
          totalBatches: batches.length,
          segments: encodeURIComponent(testJson)
        };
        
        // URL 길이 최종 체크
        const testUrl = `${window.GAS_URL}?${new URLSearchParams(segmentParams).toString()}&callback=test`;
        if (testUrl.length > MAX_URL_LENGTH) {
          console.warn(`배치 ${batchIndex + 1} URL이 너무 김: ${testUrl.length}바이트`);
          // 배치 크기를 더 줄여야 함
          throw new Error(`세그먼트 데이터가 너무 큽니다. 배치 ${batchIndex + 1}의 크기를 줄여주세요.`);
        }
        
        const batchResult = await jsonpRequest(window.GAS_URL, segmentParams);
        
        if (!batchResult.success) {
          throw new Error(`배치 ${batchIndex + 1} 전송 실패: ${batchResult.error}`);
        }
        
        console.log(`배치 ${batchIndex + 1} 전송 완료`);
        
        // 배치 간 간격 (서버 부하 방지)
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log('모든 세그먼트 배치 전송 완료');
    }
    
    return {
      success: true,
      workoutId: workoutId,
      message: '워크아웃이 성공적으로 생성되었습니다.'
    };
    
  } catch (error) {
    console.error('대용량 워크아웃 생성 실패:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * 세그먼트 개수 체크 및 경고
 */
function checkSegmentCount(segments) {
  const count = segments?.length || 0;
  
  if (count === 0) {
    return { status: 'empty', message: '세그먼트가 없습니다.' };
  } else if (count <= 10) {
    return { status: 'optimal', message: `${count}개 세그먼트 - 최적 상태` };
  } else if (count <= 50) {
    return { status: 'large', message: `${count}개 세그먼트 - 분할 전송 사용` };
  } else if (count <= 100) {
    return { status: 'xlarge', message: `${count}개 세그먼트 - 대용량 처리` };
  } else {
    return { status: 'warning', message: `${count}개 세그먼트 - 권장 제한 초과` };
  }
}

/**
 * 세그먼트 요약 정보 업데이트 (개선된 버전)
 */
function updateSegmentSummary() {
  const totalSeconds = workoutSegments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  const segmentCount = workoutSegments.length;
  
  const durationEl = document.getElementById('totalDuration');
  const countEl = document.getElementById('segmentCount');
  const statusEl = document.getElementById('segmentStatus'); // 새로운 상태 표시 요소
  
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;
  if (countEl) countEl.textContent = `${segmentCount}개`;
  
  // 세그먼트 상태 표시
  if (statusEl) {
    const status = checkSegmentCount(workoutSegments);
    statusEl.textContent = status.message;
    statusEl.className = `segment-status ${status.status}`;
  }
}

// 기존 API 함수들 (JSONP 방식)
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
 * 워크아웃 목록 로드 및 렌더링
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
            이제 <strong>무제한 세그먼트</strong>를 지원합니다!
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

    // 워크아웃 카드 렌더링 (세그먼트 개수 표시 추가)
    workoutList.innerHTML = workouts.map(workout => {
      const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
      const segmentCount = workout.segment_count || 0;
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
              <span class="segments">${segmentCount}개 세그먼트</span>
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
    
    // 세그먼트 데이터 복원 (최적화된 형태에서)
    if (workout.segments) {
      workout.segments = restoreSegmentData(workout.segments);
    }
    
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
 * 새 워크아웃 저장 (대용량 세그먼트 지원)
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

  // 세그먼트 개수 체크
  const segmentStatus = checkSegmentCount(workoutSegments);
  if (segmentStatus.status === 'warning') {
    if (!confirm(`${segmentStatus.message}\n계속 진행하시겠습니까?`)) {
      return;
    }
  }

  // 저장 시작 - UI 상태 변경
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>저장 중...';
  }

  // 진행 상태 토스트
  if (workoutSegments.length > 10) {
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
    
    // 대용량 세그먼트 지원 API 호출
    const result = await apiCreateWorkoutWithSegments(workoutData);
    
    console.log('API result:', result);
    
    if (result.success) {
      showToast(`${title} 워크아웃이 성공적으로 저장되었습니다! (${validSegments.length}개 세그먼트)`);
      
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

// 나머지 함수들은 기존과 동일하므로 생략...
// (editWorkout, deleteWorkout, resetWorkoutFormMode, 세그먼트 관리 함수들 등)

/* ==========================================================
   세그먼트 관리 기능 (기존과 동일)
========================================================== */

let workoutSegments = [];
let currentEditingSegmentIndex = null;

// 세그먼트 관련 함수들은 기존 코드와 동일하므로 여기서는 핵심 함수들만 포함
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
 * 워크아웃 프리뷰 업데이트 함수
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

// 전역 함수로 내보내기
window.loadWorkouts = loadWorkouts;
window.selectWorkout = selectWorkout;
window.saveWorkout = saveWorkout;
window.updateWorkoutPreview = updateWorkoutPreview;
window.addQuickSegment = addQuickSegment;
window.updateSegmentSummary = updateSegmentSummary;
window.checkSegmentCount = checkSegmentCount;

// API 함수 전역 내보내기
window.apiCreateWorkoutWithSegments = apiCreateWorkoutWithSegments;
