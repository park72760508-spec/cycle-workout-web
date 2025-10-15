/* ==========================================================
   통합 사용자 관리 모듈 (integratedUserManager.js)
   - POST 방식 API 통신으로 변환
   - Google Sheets API와 연동한 사용자 CRUD
   - 프로필 관리 및 FTP 업데이트
========================================================== */

// 전역 변수로 현재 모드 추적
let isEditMode = false;
let currentEditUserId = null;

// API 기본 설정
const USER_API_CONFIG = {
  baseURL: window.GAS_URL || '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};

/**
 * POST 방식 API 호출 헬퍼 함수 - 한글 처리 개선
 */
async function postUserRequest(url, data = {}) {
  try {
    console.log('POST user request to:', url, 'with data:', data);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: USER_API_CONFIG.headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(USER_API_CONFIG.timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('POST user response received:', result);
    
    return result;
    
  } catch (error) {
    console.error('POST user request failed:', error);
    
    if (error.name === 'AbortError') {
      throw new Error('요청 시간 초과');
    } else if (error.name === 'TypeError') {
      throw new Error('네트워크 연결 오류');
    } else {
      throw error;
    }
  }
}

// 사용자 API 함수들 (POST 방식)
async function apiGetUsers() {
  return postUserRequest(USER_API_CONFIG.baseURL, { action: 'listUsers' });
}

async function apiGetUser(id) {
  return postUserRequest(USER_API_CONFIG.baseURL, { 
    action: 'getUser', 
    id: id 
  });
}

async function apiCreateUser(userData) {
  console.log('apiCreateUser called with:', userData);
  
  const requestData = {
    action: 'createUser',
    name: userData.name || '',
    contact: userData.contact || '',
    ftp: (userData.ftp || 0).toString(),
    weight: (userData.weight || 0).toString()
  };
  
  console.log('Sending user request data:', requestData);
  return postUserRequest(USER_API_CONFIG.baseURL, requestData);
}

async function apiUpdateUser(id, userData) {
  const requestData = {
    action: 'updateUser',
    id: id,
    name: userData.name,
    contact: userData.contact || '',
    ftp: userData.ftp,
    weight: userData.weight
  };
  
  return postUserRequest(USER_API_CONFIG.baseURL, requestData);
}

async function apiDeleteUser(id) {
  return postUserRequest(USER_API_CONFIG.baseURL, { 
    action: 'deleteUser', 
    id: id 
  });
}

/**
 * 사용자 목록 로드 및 렌더링 (개선된 버전)
 */
async function loadUsers() {
  const userList = document.getElementById('userList');
  if (!userList) return;

  try {
    // 로딩 상태 표시 (점 애니메이션 포함)
    userList.innerHTML = `
      <div class="loading-container">
        <div class="dots-loader">
          <div></div>
          <div></div>
          <div></div>
        </div>
        <div style="color: #666; font-size: 14px;">사용자 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetUsers();
    
    if (!result.success) {
      // 오류 상태 표시
      userList.innerHTML = `
        <div class="error-state">
          <div class="error-state-icon">⚠️</div>
          <div class="error-state-title">사용자 목록을 불러올 수 없습니다</div>
          <div class="error-state-description">오류: ${result.error}</div>
          <button class="retry-button" onclick="loadUsers()">다시 시도</button>
        </div>
      `;
      return;
    }

    const users = result.items || [];
    
    if (users.length === 0) {
      // 빈 상태 표시
      userList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <div class="empty-state-title">등록된 사용자가 없습니다</div>
          <div class="empty-state-description">
            첫 번째 사용자를 등록하여 훈련을 시작해보세요.<br>
            FTP와 체중 정보를 입력하면 맞춤형 훈련 강도를 제공받을 수 있습니다.
          </div>
          <div class="empty-state-action">
            <button class="btn btn-primary" onclick="showAddUserForm(true)">
              ➕ 첫 번째 사용자 등록
            </button>
          </div>
        </div>
      `;
      return;
    }

    // 사용자 카드 렌더링
    userList.innerHTML = users.map(user => {
      const wkg = (user.ftp && user.weight) ? (user.ftp / user.weight).toFixed(2) : '-';
      
      return `
        <div class="user-card" data-user-id="${user.id}">
          <div class="user-header">
            <div class="user-name">👤 ${user.name}</div>
            <div class="user-actions">
              <button class="btn-edit" onclick="editUser(${user.id})" title="수정">✏️</button>
              <button class="btn-delete" onclick="deleteUser(${user.id})" title="삭제">🗑️</button>
            </div>
          </div>
          <div class="user-details">
            <div class="user-stats">
              <span class="stat">FTP: ${user.ftp || '-'}W</span>
              <span class="stat">체중: ${user.weight || '-'}kg</span>
              <span class="stat">W/kg: ${wkg}</span>
            </div>
            <div class="user-meta">
              <span class="contact">${user.contact || ''}</span>
              <span class="created">가입: ${new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button class="btn btn-primary" onclick="selectUser(${user.id})">선택</button>
        </div>
      `;
    }).join('');

    // 전역에 사용자 목록 저장
    window.users = users;
    window.userProfiles = users;
    
    // 성공 메시지 (선택적)
    if (typeof showToast === 'function') {
      showToast(`${users.length}명의 사용자를 불러왔습니다.`);
    }
    
  } catch (error) {
    console.error('사용자 목록 로드 실패:', error);
    
    // 네트워크 오류 상태 표시
    userList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">🌐</div>
        <div class="error-state-title">연결 오류</div>
        <div class="error-state-description">
          서버와 연결할 수 없습니다.<br>
          인터넷 연결을 확인하고 다시 시도해주세요.
        </div>
        <button class="retry-button" onclick="loadUsers()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 사용자 선택
 */
async function selectUser(userId) {
  try {
    const result = await apiGetUser(userId);
    
    if (!result.success) {
      showToast('사용자 정보를 불러올 수 없습니다.');
      return;
    }

    const user = result.item;
    
    // 전역 상태에 현재 사용자 설정
    window.currentUser = user;
    
    // 로컬 스토리지에 저장
    try {
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }

    showToast(`${user.name}님이 선택되었습니다.`);
    
    // 워크아웃 선택 화면으로 이동
    if (typeof showScreen === 'function') {
      showScreen('workoutScreen');
      if (typeof loadWorkouts === 'function') {
        loadWorkouts();
      }
    }
    
  } catch (error) {
    console.error('사용자 선택 실패:', error);
    showToast('사용자 선택 중 오류가 발생했습니다.');
  }
}

/**
 * 새 사용자 추가 폼 표시 - 초기화 옵션 추가
 */
function showAddUserForm(clearForm = true) {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (cardAddUser) cardAddUser.classList.add('hidden');
  if (addUserForm) addUserForm.classList.remove('hidden');
  
  // clearForm이 true일 때만 폼 초기화 (기본값은 true로 기존 동작 유지)
  if (clearForm) {
    const userNameEl = document.getElementById('userName');
    const userContactEl = document.getElementById('userContact');
    const userFTPEl = document.getElementById('userFTP');
    const userWeightEl = document.getElementById('userWeight');
    
    if (userNameEl) userNameEl.value = '';
    if (userContactEl) userContactEl.value = '';
    if (userFTPEl) userFTPEl.value = '';
    if (userWeightEl) userWeightEl.value = '';
  }
}

/**
 * 사용자 추가 폼 숨기기 - 모드 리셋 포함
 */
function hideAddUserForm() {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (addUserForm) addUserForm.classList.add('hidden');
  if (cardAddUser) cardAddUser.classList.remove('hidden');
  
  // 저장 버튼을 다시 생성 모드로 되돌리기
  const saveBtn = document.getElementById('btnSaveUser');
  if (saveBtn) {
    saveBtn.textContent = '저장';
    saveBtn.onclick = null;
    saveBtn.onclick = saveUser; // 다시 saveUser로 바인딩
  }
  
  // 폼 제목도 원상 복구
  const formTitle = document.querySelector('#addUserForm h3');
  if (formTitle) {
    formTitle.textContent = '새 사용자 등록';
  }
  
  // 모드 리셋
  isEditMode = false;
  currentEditUserId = null;
}

/**
 * 새 사용자 저장 - 수정 모드일 때 실행 방지 및 개선된 오류 처리
 */
async function saveUser() {
  // 수정 모드일 때는 실행하지 않음
  if (isEditMode) {
    console.log('Edit mode active - saveUser blocked');
    return;
  }

  // 요소들 가져오기 및 null 체크
  const userNameEl = document.getElementById('userName');
  const userContactEl = document.getElementById('userContact');
  const userFTPEl = document.getElementById('userFTP');
  const userWeightEl = document.getElementById('userWeight');
  const saveBtn = document.getElementById('btnSaveUser');

  if (!userNameEl || !userContactEl || !userFTPEl || !userWeightEl) {
    console.error('사용자 폼 요소를 찾을 수 없습니다.');
    showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }

  const name = userNameEl.value.trim();
  const contact = userContactEl.value.trim();
  const ftp = parseInt(userFTPEl.value);
  const weight = parseFloat(userWeightEl.value);

  // 유효성 검사
  if (!name) {
    showToast('이름을 입력해주세요.');
    userNameEl.focus();
    return;
  }
  
  if (!ftp || ftp < 50 || ftp > 600) {
    showToast('올바른 FTP 값을 입력해주세요. (50-600W)');
    userFTPEl.focus();
    return;
  }
  
  if (!weight || weight < 30 || weight > 200) {
    showToast('올바른 체중을 입력해주세요. (30-200kg)');
    userWeightEl.focus();
    return;
  }

  // 저장 시작 - UI 상태 변경
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>저장 중...';
  }

  // 진행 상태 토스트
  showToast('사용자 정보를 저장하는 중입니다...');

  try {
    console.log('=== 사용자 저장 시작 ===');
    console.log('Name:', name, 'FTP:', ftp, 'Weight:', weight);

    const userData = { name, contact, ftp, weight };
    console.log('Final user data:', userData);
    
    const result = await apiCreateUser(userData);
    console.log('API result:', result);
    
    if (result.success) {
      showToast(`${name}님이 성공적으로 추가되었습니다!`);
      hideAddUserForm();
      
      // 목록 새로고침
      setTimeout(() => {
        loadUsers();
      }, 500);
      
    } else {
      throw new Error(result.error || '알 수 없는 오류가 발생했습니다.');
    }
    
  } catch (error) {
    console.error('사용자 저장 실패:', error);
    showToast('사용자 저장 중 오류가 발생했습니다: ' + error.message);
  } finally {
    // 저장 완료 - UI 상태 복원
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '저장';
    }
  }
}

/**
 * 사용자 수정
 */
async function editUser(userId) {
  try {
    const result = await apiGetUser(userId);
    
    if (!result.success) {
      showToast('사용자 정보를 불러올 수 없습니다.');
      return;
    }

    const user = result.item;
    
    // 수정 모드 활성화
    isEditMode = true;
    currentEditUserId = userId;
    console.log('Edit mode activated for user:', userId);
    
    // 폼 표시 (초기화하지 않음)
    showAddUserForm(false);
    
    // 요소들 가져오기 및 null 체크
    const userNameEl = document.getElementById('userName');
    const userContactEl = document.getElementById('userContact');
    const userFTPEl = document.getElementById('userFTP');
    const userWeightEl = document.getElementById('userWeight');
    
    if (!userNameEl || !userContactEl || !userFTPEl || !userWeightEl) {
      console.error('사용자 폼 요소를 찾을 수 없습니다.');
      showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
      return;
    }
    
    // 수정 폼에 기존 데이터 채우기
    userNameEl.value = user.name || '';
    userContactEl.value = user.contact || '';
    userFTPEl.value = user.ftp || '';
    userWeightEl.value = user.weight || '';
    
    // 저장 버튼을 업데이트 버튼으로 완전히 교체
    const saveBtn = document.getElementById('btnSaveUser');
    if (saveBtn) {
      saveBtn.textContent = '수정';
      // 기존 이벤트 리스너 제거하고 새로 바인딩
      saveBtn.removeEventListener('click', saveUser);
      saveBtn.onclick = null;
      saveBtn.onclick = () => performUserUpdate();
    }
    
    // 폼 제목도 변경
    const formTitle = document.querySelector('#addUserForm h3');
    if (formTitle) {
      formTitle.textContent = '사용자 정보 수정';
    }
    
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    showToast('사용자 정보 로드 중 오류가 발생했습니다.');
  }
}

/**
 * 실제 사용자 업데이트 실행 함수
 */
async function performUserUpdate() {
  if (!isEditMode || !currentEditUserId) {
    console.error('Invalid edit mode state');
    return;
  }

  // 요소들 가져오기 및 null 체크
  const userNameEl = document.getElementById('userName');
  const userContactEl = document.getElementById('userContact');
  const userFTPEl = document.getElementById('userFTP');
  const userWeightEl = document.getElementById('userWeight');
  const saveBtn = document.getElementById('btnSaveUser');

  if (!userNameEl || !userContactEl || !userFTPEl || !userWeightEl) {
    console.error('사용자 폼 요소를 찾을 수 없습니다.');
    showToast('폼 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }

  const name = userNameEl.value.trim();
  const contact = userContactEl.value.trim();
  const ftp = parseInt(userFTPEl.value);
  const weight = parseFloat(userWeightEl.value);

  // 유효성 검사
  if (!name) {
    showToast('이름을 입력해주세요.');
    userNameEl.focus();
    return;
  }
  
  if (!ftp || ftp < 50 || ftp > 600) {
    showToast('올바른 FTP 값을 입력해주세요. (50-600W)');
    userFTPEl.focus();
    return;
  }
  
  if (!weight || weight < 30 || weight > 200) {
    showToast('올바른 체중을 입력해주세요. (30-200kg)');
    userWeightEl.focus();
    return;
  }

  // 업데이트 시작 - UI 상태 변경
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>수정 중...';
  }

  // 진행 상태 토스트
  showToast('사용자 정보를 수정하는 중입니다...');

  try {
    const userData = { name, contact, ftp, weight };
    console.log('Updating user:', currentEditUserId, 'with data:', userData);
    
    const result = await apiUpdateUser(currentEditUserId, userData);
    
    if (result.success) {
      showToast('사용자 정보가 성공적으로 수정되었습니다!');
      resetUserFormMode(); // 모드 리셋 및 폼 숨기기
      
      // 목록 새로고침
      setTimeout(() => {
        loadUsers();
      }, 500);
      
    } else {
      throw new Error(result.error || '알 수 없는 오류가 발생했습니다.');
    }
    
  } catch (error) {
    console.error('사용자 업데이트 실패:', error);
    showToast('사용자 수정 중 오류가 발생했습니다: ' + error.message);
  } finally {
    // 업데이트 완료 - UI 상태 복원
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '수정';
    }
  }
}

/**
 * 사용자 폼 모드 리셋
 */
function resetUserFormMode() {
  isEditMode = false;
  currentEditUserId = null;
  hideAddUserForm();
  console.log('User form mode reset to add mode');
}

/**
 * 사용자 삭제
 */
async function deleteUser(userId) {
  if (!confirm('정말로 이 사용자를 삭제하시겠습니까?\n삭제된 사용자의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    // 삭제 진행 상태 표시
    showToast('사용자를 삭제하는 중입니다...');
    
    const result = await apiDeleteUser(userId);
    
    if (result.success) {
      showToast('사용자가 성공적으로 삭제되었습니다.');
      
      // 목록 새로고침
      setTimeout(() => {
        loadUsers();
      }, 500);
      
    } else {
      throw new Error(result.error || '알 수 없는 오류가 발생했습니다.');
    }
    
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    showToast('사용자 삭제 중 오류가 발생했습니다: ' + error.message);
  }
}

/**
 * 사용자 통계 계산 함수
 */
function calculateUserStats(users) {
  if (!users || users.length === 0) {
    return {
      totalUsers: 0,
      avgFTP: 0,
      avgWeight: 0,
      avgWKG: 0
    };
  }
  
  const validUsers = users.filter(user => user.ftp && user.weight);
  
  if (validUsers.length === 0) {
    return {
      totalUsers: users.length,
      avgFTP: 0,
      avgWeight: 0,
      avgWKG: 0
    };
  }
  
  const totalFTP = validUsers.reduce((sum, user) => sum + (user.ftp || 0), 0);
  const totalWeight = validUsers.reduce((sum, user) => sum + (user.weight || 0), 0);
  const totalWKG = validUsers.reduce((sum, user) => {
    return sum + (user.ftp && user.weight ? user.ftp / user.weight : 0);
  }, 0);
  
  return {
    totalUsers: users.length,
    validUsers: validUsers.length,
    avgFTP: Math.round(totalFTP / validUsers.length),
    avgWeight: Math.round(totalWeight / validUsers.length * 10) / 10,
    avgWKG: Math.round(totalWKG / validUsers.length * 100) / 100
  };
}

/**
 * 사용자 통계 표시
 */
function displayUserStats() {
  const users = window.users || [];
  const stats = calculateUserStats(users);
  
  const statsEl = document.getElementById('userStats');
  if (statsEl && stats.totalUsers > 0) {
    statsEl.innerHTML = `
      <div class="stats-container">
        <div class="stat-item">
          <span class="stat-label">총 사용자</span>
          <span class="stat-value">${stats.totalUsers}명</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">평균 FTP</span>
          <span class="stat-value">${stats.avgFTP}W</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">평균 체중</span>
          <span class="stat-value">${stats.avgWeight}kg</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">평균 W/kg</span>
          <span class="stat-value">${stats.avgWKG}</span>
        </div>
      </div>
    `;
  }
}

/**
 * 사용자 프로필 유효성 검사
 */
function validateUserProfile(userData) {
  const errors = [];
  
  if (!userData.name || userData.name.trim().length < 2) {
    errors.push('이름은 2글자 이상이어야 합니다.');
  }
  
  if (userData.name && userData.name.length > 50) {
    errors.push('이름은 50글자를 초과할 수 없습니다.');
  }
  
  if (!userData.ftp || userData.ftp < 50 || userData.ftp > 600) {
    errors.push('FTP는 50-600W 범위여야 합니다.');
  }
  
  if (!userData.weight || userData.weight < 30 || userData.weight > 200) {
    errors.push('체중은 30-200kg 범위여야 합니다.');
  }
  
  if (userData.contact && userData.contact.length > 100) {
    errors.push('연락처는 100글자를 초과할 수 없습니다.');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * 초기화 및 이벤트 바인딩
 */
document.addEventListener('DOMContentLoaded', () => {
  // 새 사용자 추가 카드 클릭 이벤트
  const cardAddUser = document.getElementById('cardAddUser');
  if (cardAddUser) {
    cardAddUser.addEventListener('click', () => showAddUserForm(true));
  }
  
  // 취소 버튼
  const btnCancel = document.getElementById('btnCancelAddUser');
  if (btnCancel) {
    btnCancel.addEventListener('click', hideAddUserForm);
  }
  
  // 저장 버튼
  const btnSave = document.getElementById('btnSaveUser');
  if (btnSave) {
    btnSave.addEventListener('click', saveUser);
  }
  
  // 폼 필드 실시간 유효성 검사
  const userNameEl = document.getElementById('userName');
  const userFTPEl = document.getElementById('userFTP');
  const userWeightEl = document.getElementById('userWeight');
  
  if (userNameEl) {
    userNameEl.addEventListener('input', (e) => {
      const value = e.target.value.trim();
      if (value.length > 50) {
        e.target.setCustomValidity('이름은 50글자를 초과할 수 없습니다.');
      } else if (value.length > 0 && value.length < 2) {
        e.target.setCustomValidity('이름은 2글자 이상이어야 합니다.');
      } else {
        e.target.setCustomValidity('');
      }
    });
  }
  
  if (userFTPEl) {
    userFTPEl.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      if (value && (value < 50 || value > 600)) {
        e.target.setCustomValidity('FTP는 50-600W 범위여야 합니다.');
      } else {
        e.target.setCustomValidity('');
      }
    });
  }
  
  if (userWeightEl) {
    userWeightEl.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      if (value && (value < 30 || value > 200)) {
        e.target.setCustomValidity('체중은 30-200kg 범위여야 합니다.');
      } else {
        e.target.setCustomValidity('');
      }
    });
  }
});

// 전역 함수로 내보내기
window.loadUsers = loadUsers;
window.selectUser = selectUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.saveUser = saveUser;
window.selectProfile = selectUser; // 기존 코드와의 호환성
window.showAddUserForm = showAddUserForm;
window.hideAddUserForm = hideAddUserForm;
window.calculateUserStats = calculateUserStats;
window.displayUserStats = displayUserStats;
window.validateUserProfile = validateUserProfile;

// API 함수 전역 내보내기
window.apiCreateUser = apiCreateUser;
window.apiUpdateUser = apiUpdateUser;
window.apiDeleteUser = apiDeleteUser;
window.apiGetUser = apiGetUser;
window.apiGetUsers = apiGetUsers;
