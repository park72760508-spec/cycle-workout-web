/* ==========================================================
   사용자 관리 모듈 (userManager.js)
   - Google Sheets API와 연동한 사용자 CRUD (JSONP 방식)
   - 프로필 관리 및 FTP 업데이트
========================================================== */

const GAS_URL = window.GAS_URL;

// JSONP 방식 API 호출 헬퍼 함수
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.round(Math.random() * 10000);
    const script = document.createElement('script');
    
    // 전역 콜백 함수 등록
    window[callbackName] = function(data) {
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };
    
    // 에러 처리
    script.onerror = function() {
      delete window[callbackName];
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      reject(new Error('JSONP request failed'));
    };
    
    // URL 파라미터 구성
    const urlParams = new URLSearchParams(params);
    urlParams.set('callback', callbackName);
    
    script.src = `${url}?${urlParams.toString()}`;
    document.body.appendChild(script);
    
    // 타임아웃 처리 (10초)
    setTimeout(() => {
      if (window[callbackName]) {
        delete window[callbackName];
        if (document.body.contains(script)) {
          document.body.removeChild(script);
        }
        reject(new Error('JSONP request timeout'));
      }
    }, 10000);
  });
}

// 사용자 API 함수들 (JSONP 방식)
async function apiGetUsers() {
  return jsonpRequest(GAS_URL, { action: 'listUsers' });
}

async function apiGetUser(id) {
  return jsonpRequest(GAS_URL, { action: 'getUser', id: id });
}

async function apiCreateUser(userData) {
  console.log('apiCreateUser called with:', userData);
  const params = {
    action: 'createUser',
    name: userData.name || '',
    contact: userData.contact || '',
    ftp: (userData.ftp || 0).toString(),
    weight: (userData.weight || 0).toString()
  };
  console.log('Sending params:', params);
  return jsonpRequest(GAS_URL, params);
}

async function apiUpdateUser(id, userData) {
  const params = {
    action: 'updateUser',
    id: id,
    name: userData.name,
    contact: userData.contact || '',
    ftp: userData.ftp,
    weight: userData.weight
  };
  return jsonpRequest(GAS_URL, params);
}

async function apiDeleteUser(id) {
  return jsonpRequest(GAS_URL, { action: 'deleteUser', id: id });
}



/**
 * 사용자 목록 로드 및 렌더링
 */
async function loadUsers() {
  const userList = document.getElementById('userList');
  if (!userList) return;

  try {
    // 로딩 상태 표시
    userList.innerHTML = '<div class="loading-spinner">사용자 목록을 불러오는 중...</div>';
    
    const result = await apiGetUsers();
    
    if (!result.success) {
      userList.innerHTML = `<div class="error">오류: ${result.error}</div>`;
      return;
    }

    const users = result.items || [];
    
    if (users.length === 0) {
      userList.innerHTML = '<div class="muted">등록된 사용자가 없습니다.</div>';
      return;
    }

    // 사용자 카드 렌더링
    userList.innerHTML = users.map(user => `
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
            <span class="stat">FTP: ${user.ftp}W</span>
            <span class="stat">체중: ${user.weight}kg</span>
            <span class="stat">W/kg: ${(user.ftp / user.weight).toFixed(2)}</span>
          </div>
          <div class="user-meta">
            <span class="contact">${user.contact || ''}</span>
            <span class="created">가입: ${new Date(user.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn btn-primary" onclick="selectUser(${user.id})">선택</button>
      </div>
    `).join('');

    // 전역에 사용자 목록 저장
    window.users = users;
    window.userProfiles = users;
    
  } catch (error) {
    console.error('사용자 목록 로드 실패:', error);
    userList.innerHTML = '<div class="error">사용자 목록을 불러올 수 없습니다.</div>';
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
 * 새 사용자 추가 폼 표시
 */
function showAddUserForm() {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (cardAddUser) cardAddUser.classList.add('hidden');
  if (addUserForm) addUserForm.classList.remove('hidden');
  
  // 폼 초기화
  document.getElementById('userName').value = '';
  document.getElementById('userContact').value = '';
  document.getElementById('userFTP').value = '';
  document.getElementById('userWeight').value = '';
}

/**
 * 사용자 추가 폼 숨기기
 */
function hideAddUserForm() {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (addUserForm) addUserForm.classList.add('hidden');
  if (cardAddUser) cardAddUser.classList.remove('hidden');
}

/**
 * 새 사용자 저장
 */
async function saveUser() {
  const name = document.getElementById('userName').value.trim();
  const contact = document.getElementById('userContact').value.trim();
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);

  // 유효성 검사
  if (!name) {
    showToast('이름을 입력해주세요.');
    return;
  }
  
  if (!ftp || ftp < 50 || ftp > 600) {
    showToast('올바른 FTP 값을 입력해주세요. (50-600W)');
    return;
  }
  
  if (!weight || weight < 30 || weight > 200) {
    showToast('올바른 체중을 입력해주세요. (30-200kg)');
    return;
  }

  try {
    const userData = { name, contact, ftp, weight };
    const result = await apiCreateUser(userData);
    
    if (result.success) {
      showToast(`${name}님이 추가되었습니다.`);
      hideAddUserForm();
      loadUsers(); // 목록 새로고침
    } else {
      showToast('사용자 추가 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('사용자 저장 실패:', error);
    showToast('사용자 저장 중 오류가 발생했습니다.');
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
    
    // 수정 폼에 기존 데이터 채우기
    document.getElementById('userName').value = user.name;
    document.getElementById('userContact').value = user.contact || '';
    document.getElementById('userFTP').value = user.ftp;
    document.getElementById('userWeight').value = user.weight;
    
    // 폼 표시
    showAddUserForm();
    
    // 저장 버튼을 업데이트 모드로 변경
    const saveBtn = document.getElementById('btnSaveUser');
    if (saveBtn) {
      saveBtn.textContent = '수정';
      saveBtn.onclick = () => updateUser(userId);
    }
    
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    showToast('사용자 정보 로드 중 오류가 발생했습니다.');
  }
}

/**
 * 사용자 정보 업데이트
 */
async function updateUser(userId) {
  const name = document.getElementById('userName').value.trim();
  const contact = document.getElementById('userContact').value.trim();
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);

  // 유효성 검사
  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = { name, contact, ftp, weight };
    const result = await apiUpdateUser(userId, userData);
    
    if (result.success) {
      showToast('사용자 정보가 수정되었습니다.');
      hideAddUserForm();
      loadUsers(); // 목록 새로고침
      
      // 저장 버튼을 다시 생성 모드로 되돌리기
      const saveBtn = document.getElementById('btnSaveUser');
      if (saveBtn) {
        saveBtn.textContent = '저장';
        saveBtn.onclick = saveUser;
      }
    } else {
      showToast('사용자 수정 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('사용자 업데이트 실패:', error);
    showToast('사용자 수정 중 오류가 발생했습니다.');
  }
}

/**
 * 사용자 삭제
 */
async function deleteUser(userId) {
  if (!confirm('정말로 이 사용자를 삭제하시겠습니까?\n삭제된 사용자의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    const result = await apiDeleteUser(userId);
    
    if (result.success) {
      showToast('사용자가 삭제되었습니다.');
      loadUsers(); // 목록 새로고침
    } else {
      showToast('사용자 삭제 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    showToast('사용자 삭제 중 오류가 발생했습니다.');
  }
}

/**
 * 초기화 및 이벤트 바인딩
 */
document.addEventListener('DOMContentLoaded', () => {
  // 새 사용자 추가 카드 클릭 이벤트
  const cardAddUser = document.getElementById('cardAddUser');
  if (cardAddUser) {
    cardAddUser.addEventListener('click', showAddUserForm);
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
});

// 전역 함수로 내보내기
window.loadUsers = loadUsers;
window.selectUser = selectUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.saveUser = saveUser;
window.selectProfile = selectUser; // 기존 코드와의 호환성
