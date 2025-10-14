/* ==========================================================
   워크아웃 관리 모듈 (workoutManager.js)
   - Google Sheets API와 연동한 워크아웃 CRUD
   - 상태(보이기/숨기기) 및 게시날짜 필터링 지원
========================================================== */

// GAS_URL 선언 제거 - window.GAS_URL 직접 사용

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

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
 * 워크아웃 목록 로드 및 렌더링
 */
async function loadWorkouts() {
  const workoutList = document.getElementById('workoutList');
  if (!workoutList) return;

  try {
    // 로딩 상태 표시
    workoutList.innerHTML = '<div class="loading-spinner">워크아웃 목록을 불러오는 중...</div>';
    
    const result = await apiGetWorkouts();
    
    if (!result.success) {
      workoutList.innerHTML = `<div class="error">오류: ${result.error}</div>`;
      return;
    }

    const workouts = result.items || [];
    
    if (workouts.length === 0) {
      workoutList.innerHTML = '<div class="muted">등록된 워크아웃이 없습니다.</div>';
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
    
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    workoutList.innerHTML = '<div class="error">워크아웃 목록을 불러올 수 없습니다.</div>';
  }
}

/**
 * 워크아웃 선택
 */
async function selectWorkout(workoutId) {
  try {
    const result = await apiGetWorkout(workoutId);
    
    if (!result.success) {
      showToast('워크아웃 정보를 불러올 수 없습니다.');
      return;
    }

    const workout = result.item;
    
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
      if (typeof updateWorkoutPreview === 'function') {
        updateWorkoutPreview();
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
    
    // 디버깅: 찾지 못한 요소 확인
    if (!titleEl) console.error('Element with ID "wbTitle" not found');
    if (!descEl) console.error('Element with ID "wbDesc" not found');
    if (!authorEl) console.error('Element with ID "wbAuthor" not found');
    if (!statusEl) console.error('Element with ID "wbStatus" not found');
    if (!publishDateEl) console.error('Element with ID "wbPublishDate" not found');
  }
}

/**
 * 새 워크아웃 저장 - 수정 모드일 때 실행 방지 (null 체크 추가)
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
    const result = await apiCreateWorkout(workoutData);
    
    if (result.success) {
      showToast(`${title} 워크아웃이 추가되었습니다.`);
      if (typeof showScreen === 'function') {
        showScreen('workoutScreen');
      }
      loadWorkouts(); // 목록 새로고침
    } else {
      showToast('워크아웃 추가 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 저장 실패:', error);
    showToast('워크아웃 저장 중 오류가 발생했습니다.');
  }
}

/**
 * 워크아웃 수정 (null 체크 추가)
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
 * 실제 워크아웃 업데이트 실행 함수 (null 체크 추가)
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

/**
 * 초기화 및 이벤트 바인딩
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
});

// 전역 함수로 내보내기
window.loadWorkouts = loadWorkouts;
window.selectWorkout = selectWorkout;
window.editWorkout = editWorkout;
window.deleteWorkout = deleteWorkout;
window.saveWorkout = saveWorkout;

/* ==========================================================
   세그먼트 관리 기능 (workoutManager.js에 추가)
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

/**
 * 세그먼트 추가 모달 표시
 */
function showAddSegmentModal() {
  currentEditingSegmentIndex = null;
  
  // 폼 초기화
  document.getElementById('segmentModalTitle').textContent = '새 세그먼트 추가';
  document.getElementById('segmentLabel').value = '';
  document.getElementById('segmentType').value = 'interval';
  document.getElementById('segmentMinutes').value = '5';
  document.getElementById('segmentSeconds').value = '0';
  document.getElementById('segmentIntensity').value = '100';
  document.getElementById('segmentRamp').checked = false;
  document.getElementById('rampEndIntensity').value = '120';
  
  // 삭제 버튼 숨기기
  document.getElementById('btnDeleteSegment').style.display = 'none';
  
  // Ramp 설정 숨기기
  document.getElementById('rampSettings').classList.add('hidden');
  
  // 모달 표시
  document.getElementById('segmentModal').classList.remove('hidden');
}

/**
 * 세그먼트 편집 모달 표시
 */
function showEditSegmentModal(index) {
  const segment = workoutSegments[index];
  if (!segment) return;
  
  currentEditingSegmentIndex = index;
  
  // 폼에 기존 데이터 채우기
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
  
  // 삭제 버튼 표시
  document.getElementById('btnDeleteSegment').style.display = 'inline-block';
  
  // Ramp 설정 표시/숨기기
  const rampSettings = document.getElementById('rampSettings');
  if (hasRamp) {
    rampSettings.classList.remove('hidden');
  } else {
    rampSettings.classList.add('hidden');
  }
  
  // 모달 표시
  document.getElementById('segmentModal').classList.remove('hidden');
}

/**
 * Ramp 설정 토글
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
 * 세그먼트 저장
 */
function saveSegment() {
  // 폼 데이터 수집
  const label = document.getElementById('segmentLabel').value.trim();
  const type = document.getElementById('segmentType').value;
  const minutes = parseInt(document.getElementById('segmentMinutes').value) || 0;
  const seconds = parseInt(document.getElementById('segmentSeconds').value) || 0;
  const intensity = parseInt(document.getElementById('segmentIntensity').value) || 100;
  const hasRamp = document.getElementById('segmentRamp').checked;
  const rampEndIntensity = parseInt(document.getElementById('rampEndIntensity').value) || 120;
  
  // 유효성 검사
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
  
  // 세그먼트 객체 생성
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
  
  // 세그먼트 추가 또는 수정
  if (currentEditingSegmentIndex !== null) {
    workoutSegments[currentEditingSegmentIndex] = segment;
  } else {
    workoutSegments.push(segment);
  }
  
  // UI 업데이트
  renderSegments();
  updateSegmentSummary();
  closeSegmentModal();
  
  showToast(currentEditingSegmentIndex !== null ? '세그먼트가 수정되었습니다.' : '세그먼트가 추가되었습니다.');
}

/**
 * 현재 편집 중인 세그먼트 삭제
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
 * 세그먼트 모달 닫기
 */
function closeSegmentModal() {
  document.getElementById('segmentModal').classList.add('hidden');
  currentEditingSegmentIndex = null;
}

/**
 * 세그먼트 목록 렌더링
 */
function renderSegments() {
  const container = document.getElementById('wbSegments');
  const emptyState = document.getElementById('segmentsEmpty');
  
  if (!container) return;
  
  if (workoutSegments.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    // 기존 세그먼트 카드들 제거
    container.querySelectorAll('.segment-card').forEach(card => card.remove());
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  // 기존 세그먼트 카드들 제거
  container.querySelectorAll('.segment-card').forEach(card => card.remove());
  
  // 새 세그먼트 카드들 생성
  workoutSegments.forEach((segment, index) => {
    const card = createSegmentCard(segment, index);
    container.appendChild(card);
  });
}

/**
 * 세그먼트 카드 생성
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
 * 세그먼트 삭제
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
 * 세그먼트 요약 정보 업데이트
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

// 기존 saveWorkout 함수 수정 (세그먼트 포함)
const originalSaveWorkout = window.saveWorkout;
window.saveWorkout = async function() {
  // 수정 모드일 때는 실행하지 않음
  if (isWorkoutEditMode) {
    console.log('Edit mode active - saveWorkout blocked');
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

  // 유효성 검사
  if (!title) {
    showToast('제목을 입력해주세요.');
    return;
  }

  try {
    // 세그먼트 포함해서 워크아웃 데이터 구성
    const workoutData = { 
      title, 
      description, 
      author, 
      status, 
      publish_date: publishDate,
      segments: workoutSegments // 세그먼트 데이터 포함
    };
    
    const result = await apiCreateWorkout(workoutData);
    
    if (result.success) {
      showToast(`${title} 워크아웃이 추가되었습니다.`);
      // 세그먼트 초기화
      workoutSegments = [];
      renderSegments();
      updateSegmentSummary();
      
      if (typeof showScreen === 'function') {
        showScreen('workoutScreen');
      }
      loadWorkouts();
    } else {
      showToast('워크아웃 추가 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('워크아웃 저장 실패:', error);
    showToast('워크아웃 저장 중 오류가 발생했습니다.');
  }
};

// DOMContentLoaded에 세그먼트 초기화 추가
document.addEventListener('DOMContentLoaded', () => {
  // 기존 초기화 코드...
  
  // 세그먼트 관리 초기화
  initializeSegmentManager();
});

// 전역 함수 내보내기
window.addQuickSegment = addQuickSegment;
window.showEditSegmentModal = showEditSegmentModal;
window.deleteSegment = deleteSegment;
window.saveSegment = saveSegment;
window.closeSegmentModal = closeSegmentModal;
window.deleteCurrentSegment = deleteCurrentSegment;

