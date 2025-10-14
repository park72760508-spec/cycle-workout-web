/* ==========================================================
   워크아웃 관리 모듈 (workoutManager.js)
   - Google Sheets API와 연동한 워크아웃 CRUD
   - 상태(보이기/숨기기) 및 게시날짜 필터링 지원
========================================================== */

const GAS_URL = window.GAS_URL;

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

// 워크아웃 API 함수들 (JSONP 방식)
async function apiGetWorkouts() {
  return jsonpRequest(GAS_URL, { action: 'listWorkouts' });
}

async function apiGetAllWorkouts() {
  return jsonpRequest(GAS_URL, { action: 'listAllWorkouts' });
}

async function apiGetWorkout(id) {
  return jsonpRequest(GAS_URL, { action: 'getWorkout', id: id });
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
  return jsonpRequest(GAS_URL, params);
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
  return jsonpRequest(GAS_URL, params);
}

async function apiDeleteWorkout(id) {
  return jsonpRequest(GAS_URL, { action: 'deleteWorkout', id: id });
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
    document.getElementById('wbTitle').value = '';
    document.getElementById('wbDesc').value = '';
    document.getElementById('wbAuthor').value = '';
    document.getElementById('wbStatus').value = '보이기';
    document.getElementById('wbPublishDate').value = '';
  }
}

/**
 * 새 워크아웃 저장 - 수정 모드일 때 실행 방지
 */
async function saveWorkout() {
  // 수정 모드일 때는 실행하지 않음
  if (isWorkoutEditMode) {
    console.log('Edit mode active - saveWorkout blocked');
    return;
  }

  const title = document.getElementById('wbTitle').value.trim();
  const description = document.getElementById('wbDesc').value.trim();
  const author = document.getElementById('wbAuthor').value.trim();
  const status = document.getElementById('wbStatus').value || '보이기';
  const publishDate = document.getElementById('wbPublishDate').value || null;

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
    
    // 수정 폼에 기존 데이터 채우기
    document.getElementById('wbTitle').value = workout.title || '';
    document.getElementById('wbDesc').value = workout.description || '';
    document.getElementById('wbAuthor').value = workout.author || '';
    document.getElementById('wbStatus').value = workout.status || '보이기';
    document.getElementById('wbPublishDate').value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
    
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

  const title = document.getElementById('wbTitle').value.trim();
  const description = document.getElementById('wbDesc').value.trim();
  const author = document.getElementById('wbAuthor').value.trim();
  const status = document.getElementById('wbStatus').value || '보이기';
  const publishDate = document.getElementById('wbPublishDate').value || null;

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
