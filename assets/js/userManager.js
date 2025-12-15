
/* ============================================================
   [TEMP ADMIN OVERRIDE] — 목록 표시 권한 강제용
   - 로그인 화면 구축 전까지 임시로 grade=1(관리자 권한)로 고정
   - 적용 범위: localStorage('currentUser'), window.currentUser
   - 제거 방법: 이 블록 전체 삭제
============================================================ */


// ▼ 현재 로그인/선택 사용자(뷰어) 등급 헬퍼
function getViewerGrade() {
  try {
    const viewer = (window.currentUser) || JSON.parse(localStorage.getItem('currentUser') || 'null');

    // 1) 현재 뷰어에 grade가 있으면 그걸 사용
    if (viewer && viewer.grade != null) return String(viewer.grade);

    // 2) 혹시 인증 단계에서 따로 저장해둔 authUser(등급 포함)가 있으면 보강
    const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
    if (authUser && authUser.grade != null) return String(authUser.grade);
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


/*
=== UserManager.js 연동 함수 ===
파일: userManager.js 또는 새로운 연동 스크립트

새 사용자 등록과 기존 사용자 추가 기능을 연결하는 브릿지 함수들
*/

// 1. 새 사용자 등록을 위한 헬퍼 함수 (userManager.js에 추가하거나 별도 파일)
function createUserFromAuth(authFormData) {
  // 인증 화면의 새 사용자 등록 데이터를 userManager 형식으로 변환
  const userData = {
    name: authFormData.name || '',
    contact: formatPhoneForDB(authFormData.contact || ''), // 하이픈 포맷으로 변환
    ftp: parseInt(authFormData.ftp) || 0,
    weight: parseFloat(authFormData.weight) || 0,
    grade: '2', // 기본 사용자 등급
    expiry_date: '' // 빈 값
  };
  
  console.log('Creating user from auth form:', userData);
  return apiCreateUser(userData);
}

// 2. 전화번호 포맷 통합 함수 (기존 formatPhoneForDB 함수 활용)
function standardizePhoneFormat(phoneNumber) {
  // 인증 화면과 프로필 화면 간 전화번호 포맷 통일
  return formatPhoneForDB(phoneNumber);
}

// 3. 사용자 등록 후 콜백 함수
   
   function onUserRegistrationSuccess(userData, source = 'auth') {
     console.log(`User registered successfully from ${source}:`, userData);
   
     // 방금 생성한 사용자를 현재 뷰어로 채택
     adoptCreatedUserAsViewer(userData).then(ok => {
       if (!ok) console.warn('방금 생성한 사용자를 찾지 못해 뷰어 채택에 실패');
       // 프로필 화면에서 다시 볼 때를 대비해 목록도 새로고침
       if (typeof loadUsers === 'function') loadUsers();
     });
   
     if (typeof showToast === 'function') {
       showToast(`${userData.name}님 등록이 완료되었습니다! 🎉`);
     }
     return true;
   }



// 4. 사용자 등록 오류 처리 함수
function onUserRegistrationError(error, source = 'auth') {
  console.error(`User registration failed from ${source}:`, error);
  
  if (typeof showToast === 'function') {
    const errorMessage = error.message || '등록 중 오류가 발생했습니다';
    showToast(`등록 실패: ${errorMessage} ❌`);
  }
  
  return false;
}

// 5. 통합 사용자 생성 함수 (추천)
// 통합 사용자 생성 (중복 방지 포함)
async function unifiedCreateUser(userData, source = 'profile') {
  try {
    // 1) 필수값 검사
    if (!userData.name || !userData.ftp || !userData.weight) {
      throw new Error('필수 필드가 누락되었습니다');
    }

    // 2) 전화번호 포맷 표준화
    const inputContact = String(userData.contact || '');
    const normalizedContact = standardizePhoneFormat(inputContact); // "010-1234-5678"
    const onlyDigits = unformatPhone(normalizedContact);           // "01012345678"
    userData.contact = normalizedContact;

    // 3) DB 사용자 목록 조회 → 전화번호(숫자만)로 중복 검사
    const listRes = await apiGetUsers(); // { success, items: [...] }
    const users = (listRes && (listRes.items || listRes.users || listRes.data)) || [];
    const isDuplicated = users.some(u => {
      const uDigits = unformatPhone(u?.contact || '');
      return uDigits === onlyDigits;
    });

    if (isDuplicated) {
      // ✅ 요구문구: "이미 등록된 사용자입니다."
      throw new Error('✅ 이미 등록된 사용자입니다.');
    }

    // 4) 만기일 기본값(오늘+10일) 자동 세팅
    if (!userData.expiry_date) {
      const d = new Date();
      d.setDate(d.getDate() + 10);
      userData.expiry_date = d.toISOString().slice(0, 10);
    }

    // 5) 실제 생성 (JSONP API)
    const result = await apiCreateUser({
      ...userData,
      grade: userData.grade || '2'
    });

    if (result?.success) {
      if (typeof showToast === 'function') showToast('정상 등록되었습니다.');
      onUserRegistrationSuccess(userData, source);
      return result;
    } else {
      throw new Error(result?.error || '등록에 실패했습니다');
    }
  } catch (error) {
    onUserRegistrationError(error, source);
    throw error;
  }
}



// 6. 기존 saveUser 함수와의 호환성 유지
function saveUserFromAuth(formData) {
  // 인증 화면에서 호출되는 사용자 저장 함수
  return unifiedCreateUser({
    name: formData.name,
    contact: formData.contact,
    ftp: formData.ftp,
    weight: formData.weight,
    grade: '2',
   // expiry_date는 비워두면 unifiedCreateUser에서 오늘+10일 자동 설정
    expiry_date: ''
  }, 'auth');
}

// 7. 전역 함수로 내보내기 (window 객체에 추가)
if (typeof window !== 'undefined') {
  window.createUserFromAuth = createUserFromAuth;
  window.unifiedCreateUser = unifiedCreateUser;
  window.saveUserFromAuth = saveUserFromAuth;
  window.standardizePhoneFormat = standardizePhoneFormat;
}

/*
사용 방법:
1. 인증 화면에서 새 사용자 등록 시:
   - handleNewUserSubmit에서 unifiedCreateUser 호출
   
2. 프로필 화면에서 사용자 추가 시:
   - 기존 saveUser 함수에서 unifiedCreateUser 호출
   
3. 전화번호 포맷 통일:
   - standardizePhoneFormat 함수 사용
*/



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
    expiry_date: userData.expiry_date ?? '',         // 기본값 공백 저장
    challenge: (userData.challenge ?? 'Fitness').toString()  // 운동 목적 기본값 "Fitness"
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
  // ▼ 운동 목적 필드 (항상 전송)
  if (userData.challenge != null)   params.challenge = String(userData.challenge);

  return jsonpRequest(GAS_URL, params);
}


async function apiDeleteUser(id) {
  return jsonpRequest(GAS_URL, { action: 'deleteUser', id: id });
}



/**
 * 사용자 목록 로드 및 렌더링 (개선된 버전)
 */
/**
 * 사용자 목록 로드 및 렌더링 (개선된 버전)
 */
// ===== 사용자 목록 로드 및 렌더링 (모듈 교체 버전) =====
async function loadUsers() {
  const userList = document.getElementById('userList');
  if (!userList) return;

  try {
    // 1) 로딩 UI
    userList.innerHTML = `
      <div class="loading-container">
        <div class="dots-loader"><div></div><div></div><div></div></div>
        <div style="color:#666;font-size:14px;">사용자 목록을 불러오는 중...</div>
      </div>
    `;

    // 2) 데이터 가져오기
    const result = await apiGetUsers();
    if (!result || !result.success) {
      userList.innerHTML = `
        <div class="error-state">
          <div class="error-state-icon">⚠️</div>
          <div class="error-state-title">사용자 목록을 불러올 수 없습니다</div>
          <div class="error-state-description">오류: ${result?.error || 'Unknown'}</div>
          <button class="retry-button" onclick="loadUsers()">다시 시도</button>
        </div>
      `;
      return;
    }

    const users = Array.isArray(result.items) ? result.items : [];

    // 3) 빈 상태
    if (users.length === 0) {
      userList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <div class="empty-state-title">등록된 사용자가 없습니다</div>
          <div class="empty-state-description">
            첫 번째 사용자를 등록하여 훈련을 시작해보세요.<br>
            FTP와 체중 정보를 입력하면 맞춤형 훈련 강도를 제공받을 수 있습니다.
          </div>
          <div class="empty-state-action">
            <button class="btn btn-primary" onclick="showAddUserForm(true)">➕ 첫 번째 사용자 등록</button>
          </div>
        </div>
      `;
      return;
    }

    // 4) 뷰어(현재 사용자) 파악 및 등급/아이디
    let viewer = null, authUser = null;
    try { viewer   = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
    try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}

    const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
    const isTempAdmin  = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
    const viewerGrade  = isTempAdmin
      ? '1'
      : (typeof getViewerGrade === 'function'
          ? String(getViewerGrade())
          : String(mergedViewer?.grade ?? '2'));
    const viewerId     = (mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null;

    // 5) grade=2 는 "본인만" 보이게, grade=1 은 전체
    let visibleUsers = users;
    if (viewerGrade === '2' && viewerId) {
      visibleUsers = users.filter(u => String(u.id) === viewerId);
    }

    // 6) 이름 정렬
    visibleUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    // 7) 카드 단위 편집 권한: 관리자 or 본인
    const canEditFor = (u) => (viewerGrade === '1') || (viewerId && String(u.id) === viewerId);

    // 8) 렌더링
    userList.innerHTML = visibleUsers.map(user => {
      const wkg = (user.ftp && user.weight) ? (user.ftp / user.weight).toFixed(2) : '-';

      // 만료일 표시(임박/만료 배지)
      const expRaw = user.expiry_date;
      let expiryText = '미설정';
      let expiryClass = '';
      if (expRaw) {
        const d = new Date(expRaw);
        const today = new Date();
        d.setHours(0,0,0,0);
        today.setHours(0,0,0,0);
        const diffDays = Math.round((d - today) / (24*60*60*1000));
        expiryText = d.toLocaleDateString();

        if (diffDays < 0) {
          expiryClass = 'is-expired';
        } else if (diffDays === 0) {
          expiryClass = 'is-soon';
          expiryText += ' (D-DAY)';
        } else if (diffDays <= 7) {
          expiryClass = 'is-soon';
          expiryText += ` (D-${diffDays})`;
        }
      }

      const canEdit = canEditFor(user);

      return `
        <div class="user-card" data-user-id="${user.id}">
          <div class="user-header">
            <div class="user-name"><img src="assets/img/add-user3.gif" alt="" class="user-name-icon"> ${user.name}</div>
            <div class="user-actions">
              ${canEdit ? `
                <button class="btn-edit"   onclick="editUser(${user.id})"   title="수정">✏️</button>
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
              <span class="expiry ${expiryClass}">만료일: ${expiryText}</span>
            </div>
          </div>

          <button class="btn btn-primary" id="selectBtn-${user.id}" onclick="selectUser(${user.id})">선택</button>
        </div>
      `;
    }).join('');

    // 9) 전역 상태/토스트
    window.users = users;
    window.userProfiles = users;
    if (typeof showToast === 'function') {
      showToast(`${users.length}명의 사용자를 불러왔습니다.`);
    }
  } catch (error) {
    console.error('사용자 목록 로드 실패:', error);
    userList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">🌐</div>
        <div class="error-state-title">연결 오류</div>
        <div class="error-state-description">
          서버와 연결할 수 없습니다.<br>인터넷 연결을 확인하고 다시 시도해주세요.
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
      // 기존 뷰어(등급 등 보존용) 가져오기
      let prevViewer = null;
      try {
        prevViewer = (window.currentUser) || JSON.parse(localStorage.getItem('currentUser') || 'null');
      } catch (e) { prevViewer = null; }
      
      // API가 grade를 안 주는 경우, 이전 등급을 보존
      if (prevViewer && prevViewer.grade != null && (user.grade == null)) {
        user.grade = String(prevViewer.grade);
      }
      
      // 전역 상태에 현재 사용자 설정
      window.currentUser = user;
    
    // 로컬 스토리지에 저장
    try {
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }

    showToast(`${user.name}님이 선택되었습니다.`);
    
    // RPE 컨디션 선택 모달 표시
    showRPEModal();
    
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




/**------------------------------------
 * 새 사용자 추가 폼 표시
 -------------------------------------*/
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
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

  // 유효성 검사
  if (!name) { showToast('이름을 입력해주세요.'); return; }
  if (!ftp || ftp < 50 || ftp > 600) { showToast('올바른 FTP 값을 입력해주세요. (50-600W)'); return; }
  if (!weight || weight < 30 || weight > 200) { showToast('올바른 체중을 입력해주세요. (30-200kg)'); return; }

  try {
    const userData = { name, contact: contactDB, ftp, weight, challenge }; // ← challenge 추가
   // 5) 실제 생성 (재귀 금지: API 직접 호출)
      const payload = {
        ...userData,
        grade: userData.grade || '2',
        // expiry_date는 아래 기본값 로직(오늘 + 10일)으로 세팅됨
      };
      const result = await apiCreateUser(payload);

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
    const challengeSelect = document.getElementById('userChallenge');
    if (challengeSelect) challengeSelect.value = 'Fitness';
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
   const challengeSelect = document.getElementById('userChallenge');
   if (challengeSelect) challengeSelect.value = user.challenge || 'Fitness';
   
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
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

  // 유효성 검사
  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = { name, contact: contactDB, ftp, weight, challenge }; // ← challenge 추가
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
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

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
      challenge,
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


/**
 * 새로 생성된 사용자를 현재 뷰어로 채택 + 저장 + 라우팅 헬퍼
 * - createdInput: { name, contact, ... } (등록에 사용한 원본 입력)
 * - 동작:
 *   1) 최신 사용자 목록 재조회
 *   2) contact(숫자만) 우선, 실패 시 name으로 매칭
 *   3) window.currentUser, localStorage(authUser/currentUser) 갱신
 *   4) 기기선택 화면으로 라우팅(선호대로 조정 가능)
 */
async function adoptCreatedUserAsViewer(createdInput) {
  try {
    if (typeof apiGetUsers !== 'function') {
      console.warn('adoptCreatedUserAsViewer: apiGetUsers가 없습니다.');
      return false;
    }

    // 1) 최신 사용자 목록 조회
    const listRes = await apiGetUsers();
    const users = (listRes && listRes.items) ? listRes.items : [];

    // 2) contact 숫자만 비교 (010-1234-5678 → 01012345678)
    const onlyDigits = (createdInput?.contact || '').replace(/\D+/g, '');
    let user = null;
    if (onlyDigits) {
      user = users.find(u => (u.contact || '').replace(/\D+/g, '') === onlyDigits) || null;
    }
    // 3) contact로 못 찾으면 name으로 폴백
    if (!user && createdInput?.name) {
      const targetName = String(createdInput.name);
      user = users.find(u => String(u.name || '') === targetName) || null;
    }
    if (!user) {
      console.warn('adoptCreatedUserAsViewer: 방금 생성한 사용자를 목록에서 찾지 못했습니다.', createdInput);
      return false;
    }

    // 4) 현재 사용자/인증 사용자로 반영
    window.currentUser = user;
    try {
      localStorage.setItem('authUser', JSON.stringify(user));
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (e) {
      console.warn('localStorage 저장 실패(무시 가능):', e);
    }

    // 5) 라우팅: 기기 선택 화면으로 이동 (필요 시 화면 키만 바꾸세요)
    if (typeof showScreen === 'function') {
      showScreen('connectionScreen'); // 기기선택 화면
    }

    // 6) 프로필 목록 대비 선반영(선택)
    if (typeof loadUsers === 'function') {
      // 다음 화면에서 프로필을 다시 볼 때를 대비해 미리 캐시/상태 갱신
      loadUsers();
    }

    return true;
  } catch (e) {
    console.error('adoptCreatedUserAsViewer() 실패:', e);
    return false;
  }
}




// 전역 노출 보강: app.js에서 접근 가능하도록
window.apiGetUsers   = window.apiGetUsers   || apiGetUsers;
window.apiGetUser    = window.apiGetUser    || apiGetUser;
window.apiCreateUser = window.apiCreateUser || apiCreateUser;
window.apiUpdateUser = window.apiUpdateUser || apiUpdateUser;
window.apiDeleteUser = window.apiDeleteUser || apiDeleteUser;

