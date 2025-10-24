
/* ============================================================
   [TEMP ADMIN OVERRIDE] — 목록 표시 권한 강제용
   - 로그인 화면 구축 전까지 임시로 grade=1(관리자 권한)로 고정
   - 적용 범위: localStorage('currentUser'), window.currentUser
   - 제거 방법: 이 블록 전체 삭제
============================================================ */
;(function(){
  try {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};
    saved.grade = '1';
    localStorage.setItem('currentUser', JSON.stringify(saved));
    if (typeof window !== 'undefined') {
      window.currentUser = Object.assign({}, window.currentUser || {}, saved);
      window.__TEMP_ADMIN_OVERRIDE__ = true;
      console.info('[TEMP] viewer grade forced to 1 (admin). Remove this block after login screen is ready.');
    }
  } catch(e) {
    if (typeof console !== 'undefined') console.warn('[TEMP] admin override failed:', e);
  }
})();

// ▼ 현재 로그인/선택 사용자(뷰어) 등급 헬퍼
function getViewerGrade() {
  try {
    const viewer = (window.currentUser) || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (viewer && viewer.grade != null) return String(viewer.grade);
  } catch (e) {}
  return '2'; // 기본은 일반
}


/* ==========================================================
   사용자 관리 모듈 (userManager.js)
   - Google Sheets API와 연동한 사용자 CRUD (JSONP 방식)
   - 프로필 관리 및 FTP 업데이트
========================================================== */

const GAS_URL = window.GAS_URL;

// 전역 변수로 현재 모드 추적
let isEditMode = false;
let currentEditUserId = null;

// 전화번호 유틸: 숫자만 남기기
// 숫자만 남기기 (입력값 → "01012345678")
// 숫자만 남기기 (입력값 → "01012345678")
function unformatPhone(input) {
  return String(input || '').replace(/\D+/g, '');
}

// DB 저장용 하이픈 포맷 (digits → "010-1234-5678")
function formatPhoneForDB(digits) {
  const d = unformatPhone(digits);
  if (d.length < 7) return d;
  const head = d.slice(0, 3);
  const tail = d.slice(-4);
  const mid  = d.slice(head.length, d.length - tail.length);
  return `${head}-${mid}-${tail}`;
}



// JSONP 방식 API 호출 헬퍼 함수
// JSONP 방식 API 호출 헬퍼 함수 - 한글 처리 개선
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.round(Math.random() * 10000);
    const script = document.createElement('script');
    
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
      reject(new Error('JSONP request failed'));
    };
    
    // URL 파라미터 구성 - encodeURIComponent 사용으로 개선
    const urlParams = new URLSearchParams();
    Object.keys(params).forEach(key => {
      let value = params[key].toString();
      
      // 기존의 수동 유니코드 이스케이프 제거하고 자동 인코딩 사용
      urlParams.set(key, value); // URLSearchParams가 자동으로 encodeURIComponent 적용
    });
    urlParams.set('callback', callbackName);
    
    const finalUrl = `${url}?${urlParams.toString()}`;
    console.log('JSONP request URL:', finalUrl);
    
    script.src = finalUrl;
    document.body.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        console.warn('JSONP request timeout');
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
    weight: (userData.weight || 0).toString(),

    // ▼ 신규 필드 (요청 사양)
    grade: (userData.grade ?? '2').toString(),      // 가입시 기본값 "2"
    expiry_date: userData.expiry_date ?? ''         // 기본값 공백 저장
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

  // ▼ 관리자일 때만 들어오는 선택 필드(있을 때만 전송)
  if (userData.grade != null)       params.grade = String(userData.grade);
  if (userData.expiry_date != null) params.expiry_date = String(userData.expiry_date);

  return jsonpRequest(GAS_URL, params);
}


async function apiDeleteUser(id) {
  return jsonpRequest(GAS_URL, { action: 'deleteUser', id: id });
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
   // 현재 사용자(선택된 사용자) 기준 등급 파악
   let viewer = null;
   try {
     viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
   } catch (e) { viewer = null; }
   
   // 등급: 미지정 사용자는 정책상 '2'(본인만)로 간주
   const viewerGrade = (viewer && viewer.grade != null) ? String(viewer.grade) : '2';
   
   // grade=2 인 경우: 본인만 보이도록 목록 필터링
   let visibleUsers = users;
   if (viewerGrade === '2' && viewer && viewer.id != null) {
     visibleUsers = users.filter(u => String(u.id) === String(viewer.id));
   }
   
   // 사용자 카드 렌더링 (권한에 따라 버튼 노출 제어)
   userList.innerHTML = visibleUsers.map(user => {
     const wkg = (user.ftp && user.weight) ? (user.ftp / user.weight).toFixed(2) : '-';
   
     // 수정/삭제 권한: grade=1 전체 / grade=2 본인만
     const canEdit = (viewerGrade === '1') ||
                     (viewerGrade === '2' && viewer && String(user.id) === String(viewer.id));
   
     return `
       <div class="user-card" data-user-id="${user.id}">
         <div class="user-header">
           <div class="user-name">👤 ${user.name}</div>
           <div class="user-actions">
             ${canEdit ? `
               <button class="btn-edit" onclick="editUser(${user.id})" title="수정">✏️</button>
               <button class="btn-delete" onclick="deleteUser(${user.id})" title="삭제">🗑️</button>
             ` : ''}
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
         <button class="btn btn-primary" id="selectBtn-${user.id}" onclick="selectUser(${user.id})">선택</button>
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
  // ID로 정확한 버튼 찾기
  const selectButton = document.getElementById(`selectBtn-${userId}`);
  let originalButtonText = '';
  
  if (selectButton) {
    originalButtonText = selectButton.textContent;
    selectButton.textContent = '사용자 정보 연결 중...';
    selectButton.disabled = true;
    selectButton.classList.add('loading');
  }
  
  // ... 나머지 코드는 동일

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
  } finally {
    // 버튼 상태 복원 (화면 전환으로 인해 실제로는 실행되지 않을 수 있음)
    if (selectButton && originalButtonText) {
      selectButton.textContent = originalButtonText;
      selectButton.disabled = false;
      selectButton.classList.remove('loading');
    }
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
 * 새 사용자 저장 - 수정 모드일 때 실행 방지
 */
async function saveUser() {
  // 수정 모드일 때는 실행하지 않음
  if (isEditMode) {
    console.log('Edit mode active - saveUser blocked');
    return;
  }

  const name = document.getElementById('userName').value.trim();
  const contactRaw = document.getElementById('userContact').value.trim();
  const contactDB  = formatPhoneForDB(contactRaw);
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);

  // 유효성 검사
  if (!name) { showToast('이름을 입력해주세요.'); return; }
  if (!ftp || ftp < 50 || ftp > 600) { showToast('올바른 FTP 값을 입력해주세요. (50-600W)'); return; }
  if (!weight || weight < 30 || weight > 200) { showToast('올바른 체중을 입력해주세요. (30-200kg)'); return; }

  try {
    const userData = { name, contact: contactDB, ftp, weight }; // ← 여기!
    const result = await apiCreateUser(userData);

    if (result.success) {
      showToast(`${name}님이 추가되었습니다.`);
      hideAddUserForm();
      loadUsers();
    } else {
      showToast('사용자 추가 실패: ' + result.error);
    }
  } catch (error) {
    console.error('사용자 저장 실패:', error);
    showToast('사용자 저장 중 오류가 발생했습니다.');
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
    document.getElementById('userName').value = '';
    document.getElementById('userContact').value = '';
    document.getElementById('userFTP').value = '';
    document.getElementById('userWeight').value = '';
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
    
    // 수정 폼에 기존 데이터 채우기
   // ... user 로드 및 모드 전환 생략 ...
   document.getElementById('userName').value = user.name || '';
   document.getElementById('userContact').value = unformatPhone(user.contact || '');
   document.getElementById('userFTP').value = user.ftp || '';
   document.getElementById('userWeight').value = user.weight || '';
   
   // ▼ 관리자(grade=1)일 때만 추가 필드 표시
   const isAdmin = (typeof getViewerGrade === 'function' ? getViewerGrade() === '1' : false);
   const form = document.getElementById('addUserForm');
   
   // 기존 adminFields 제거(중복 방지)
   const prev = document.getElementById('adminFields');
   if (prev) prev.remove();
   
   if (isAdmin && form) {
     const adminWrap = document.createElement('div');
     adminWrap.id = 'adminFields';
     adminWrap.innerHTML = `
       <div class="form-row">
         <label>회원등급</label>
         <select id="editGrade">
           <option value="1" ${String(user.grade || '') === '1' ? 'selected' : ''}>1 (관리자)</option>
           <option value="2" ${String(user.grade || '2') !== '1' ? 'selected' : ''}>2 (일반)</option>
         </select>
       </div>
       <div class="form-row">
         <label>만기일(expiry_date)</label>
         <input id="editExpiryDate" type="date" value="${(user.expiry_date || '').substring(0,10)}">
       </div>
     `;
     // 폼 내 버튼 영역 앞에 삽입
     const actions = form.querySelector('.form-actions') || form.lastElementChild;
     form.insertBefore(adminWrap, actions);
   }

// 저장 버튼 교체 유지
const saveBtn = document.getElementById('btnSaveUser');
if (saveBtn) {
  saveBtn.textContent = '수정';
  saveBtn.removeEventListener('click', saveUser);
  saveBtn.onclick = null;
  saveBtn.onclick = () => performUpdate();
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
 * 사용자 정보 업데이트
 */
async function updateUser(userId) {
  const name = document.getElementById('userName').value.trim();
  const contactRaw = document.getElementById('userContact').value.trim();
  const contactDB  = formatPhoneForDB(contactRaw);
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);

  // 유효성 검사
  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = { name, contact: contactDB, ftp, weight }; // ← 여기!
    const result = await apiUpdateUser(userId, userData);

    if (result.success) {
      showToast('사용자 정보가 수정되었습니다.');
      hideAddUserForm();
      loadUsers();

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
 * 실제 업데이트 실행 함수
 */
async function performUpdate() {
  if (!isEditMode || !currentEditUserId) {
    console.error('Invalid edit mode state');
    return;
  }

  const name = document.getElementById('userName').value.trim();
  const contactRaw = document.getElementById('userContact').value.trim();   // ← 추가
  const contactDB  = formatPhoneForDB(contactRaw);                          // ← 추가
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);

  // 유효성 검사
  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = {
      name,
      contact: contactDB, // ← contactDB 사용
      ftp,
      weight
    };

    if (typeof getViewerGrade === 'function' && getViewerGrade() === '1') {
      const gradeEl = document.getElementById('editGrade');
      const expiryEl = document.getElementById('editExpiryDate');
      if (gradeEl)  userData.grade = String(gradeEl.value || '2');
      if (expiryEl) userData.expiry_date = String(expiryEl.value || '');
    }

    const result = await apiUpdateUser(currentEditUserId, userData);

    if (result.success) {
      showToast('사용자 정보가 수정되었습니다.');
      resetFormMode();
      loadUsers();
    } else {
      showToast('사용자 수정 실패: ' + result.error);
    }

  } catch (error) {
    console.error('사용자 업데이트 실패:', error);
    showToast('사용자 수정 중 오류가 발생했습니다.');
  }
}


/**
 * 폼 모드 리셋
 */
function resetFormMode() {
  isEditMode = false;
  currentEditUserId = null;
  hideAddUserForm();
  console.log('Form mode reset to add mode');
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
  const cardAddUser = document.getElementById('cardAddUser');
  if (cardAddUser) {
    cardAddUser.addEventListener('click', showAddUserForm);
  }
  
  const btnCancel = document.getElementById('btnCancelAddUser');
  if (btnCancel) {
    btnCancel.addEventListener('click', hideAddUserForm);
  }
  
  const btnSave = document.getElementById('btnSaveUser');
  if (btnSave) {
    btnSave.addEventListener('click', saveUser);
  }

  // ▼ 전화번호 입력: 숫자만 허용 (저장은 문자열 그대로)
  const contactInput = document.getElementById('userContact');
  if (contactInput) {
    contactInput.setAttribute('inputmode', 'numeric');   // 모바일 키패드 유도
    contactInput.setAttribute('pattern', '[0-9]*');      // 브라우저 힌트
    contactInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D+/g, ''); // 숫자 이외 제거
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
