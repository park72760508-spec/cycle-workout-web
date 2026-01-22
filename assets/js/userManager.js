
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
   - Firebase Authentication (Google Login) + Firestore 연동
   - 기존 Google Sheets 필드 구조 완벽 유지
========================================================== */

// Firestore users 컬렉션 참조
function getUsersCollection() {
  if (!window.firestore) {
    throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
  }
  return window.firestore.collection('users');
}

// 전역 변수로 현재 모드 추적
let isEditMode = false;
let currentEditUserId = null;

// 전화번호 유틸: 숫자만 남기기
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

// 전화번호 포맷 통합 함수
function standardizePhoneFormat(phoneNumber) {
  return formatPhoneForDB(phoneNumber);
}

// ========== Firebase Authentication (Google Login) ==========

/**
 * Google 로그인 (팝업 방식)
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
async function signInWithGoogle() {
  try {
    if (!window.auth) {
      throw new Error('Firebase Auth가 초기화되지 않았습니다.');
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    // 추가 스코프 요청 (필요시)
    provider.addScope('profile');
    provider.addScope('email');

    const result = await window.auth.signInWithPopup(provider);
    const user = result.user;

    console.log('✅ Google 로그인 성공:', user.email);

    // Firestore에서 사용자 정보 조회 또는 생성
    const userDocRef = getUsersCollection().doc(user.uid);
    const userDoc = await userDocRef.get();

    if (userDoc.exists) {
      // 기존 회원: lastLogin만 업데이트
      await userDocRef.update({
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      const userData = { id: user.uid, ...userDoc.data() };
      
      // 전역 상태 업데이트
      window.currentUser = userData;
      localStorage.setItem('currentUser', JSON.stringify(userData));
      localStorage.setItem('authUser', JSON.stringify(userData));
      
      return { success: true, user: userData, isNewUser: false };
    } else {
      // 신규 회원: 기존 Google Sheets 필드 구조로 문서 생성
      const now = new Date().toISOString();
      const defaultExpiryDate = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 3); // 오늘 + 3개월
        return d.toISOString().split('T')[0];
      })();

      const newUserData = {
        // 기존 Google Sheets 필드 구조 완벽 유지
        id: user.uid, // Firebase uid 사용
        name: user.displayName || user.email?.split('@')[0] || '사용자',
        contact: '', // 기본값: 빈 문자열
        ftp: 0, // 기본값: 0
        weight: 0, // 기본값: 0
        created_at: now,
        grade: '2', // 기본값: "2" (일반 사용자)
        expiry_date: defaultExpiryDate, // 기본값: 오늘 + 3개월
        challenge: 'Fitness', // 기본값: "Fitness"
        acc_points: 0, // 기본값: 0
        rem_points: 0, // 기본값: 0
        last_training_date: '', // 기본값: 빈 문자열
        strava_access_token: '', // 기본값: 빈 문자열
        strava_refresh_token: '', // 기본값: 빈 문자열
        strava_expires_at: 0, // 기본값: 0
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      };

      await userDocRef.set(newUserData);

      // 전역 상태 업데이트
      window.currentUser = newUserData;
      localStorage.setItem('currentUser', JSON.stringify(newUserData));
      localStorage.setItem('authUser', JSON.stringify(newUserData));

      return { success: true, user: newUserData, isNewUser: true };
    }
  } catch (error) {
    console.error('❌ Google 로그인 실패:', error);
    return { 
      success: false, 
      error: error.message || '로그인 중 오류가 발생했습니다.' 
    };
  }
}

/**
 * 로그아웃
 */
async function signOut() {
  try {
    if (window.auth) {
      await window.auth.signOut();
    }
    
    // 전역 상태 초기화
    window.currentUser = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authUser');
    
    console.log('✅ 로그아웃 완료');
    return { success: true };
  } catch (error) {
    console.error('❌ 로그아웃 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 현재 로그인 상태 감지 및 자동 복원
 * onAuthStateChanged를 사용하여 새로고침 시에도 로그인 유지
 */
function initAuthStateListener() {
  if (!window.auth) {
    console.warn('Firebase Auth가 초기화되지 않아 인증 상태 리스너를 설정할 수 없습니다.');
    return;
  }

  window.auth.onAuthStateChanged(async (firebaseUser) => {
    if (firebaseUser) {
      // 로그인 상태: Firestore에서 사용자 정보 가져오기
      try {
        const userDoc = await getUsersCollection().doc(firebaseUser.uid).get();
        
        if (userDoc.exists) {
          const userData = { id: firebaseUser.uid, ...userDoc.data() };
          
          // 전역 상태 업데이트
          window.currentUser = userData;
          localStorage.setItem('currentUser', JSON.stringify(userData));
          localStorage.setItem('authUser', JSON.stringify(userData));
          
          console.log('✅ 인증 상태 복원 완료:', userData.name);
        } else {
          console.warn('⚠️ Firestore에 사용자 문서가 없습니다. 로그아웃합니다.');
          await signOut();
        }
      } catch (error) {
        console.error('❌ 사용자 정보 로드 실패:', error);
      }
    } else {
      // 로그아웃 상태: 전역 상태 초기화
      window.currentUser = null;
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authUser');
      console.log('ℹ️ 로그아웃 상태');
    }
  });
}

// 페이지 로드 시 인증 상태 리스너 초기화
if (typeof window !== 'undefined' && window.auth) {
  initAuthStateListener();
}

// ========== Firestore API 함수들 (기존 Google Sheets API 호환) ==========

/**
 * 모든 사용자 목록 조회
 * @returns {Promise<{success: boolean, items?: array, error?: string}>}
 */
async function apiGetUsers() {
  try {
    const usersSnapshot = await getUsersCollection().get();
    const users = [];
    
    usersSnapshot.forEach(doc => {
      users.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, items: users };
  } catch (error) {
    console.error('❌ 사용자 목록 조회 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 특정 사용자 조회
 * @param {string} id - 사용자 ID (Firebase uid)
 * @returns {Promise<{success: boolean, item?: object, error?: string}>}
 */
async function apiGetUser(id) {
  try {
    if (!id) {
      return { success: false, error: '사용자 ID가 필요합니다.' };
    }
    
    const userDoc = await getUsersCollection().doc(id).get();
    
    if (!userDoc.exists) {
      return { success: false, error: 'User not found' };
    }
    
    const userData = {
      id: userDoc.id,
      ...userDoc.data()
    };
    
    return { success: true, item: userData };
  } catch (error) {
    console.error('❌ 사용자 조회 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 새 사용자 생성
 * @param {object} userData - 사용자 데이터 (기존 Google Sheets 필드 구조)
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
async function apiCreateUser(userData) {
  try {
    console.log('apiCreateUser called with:', userData);
    
    // 현재 로그인한 사용자 확인
    const currentUser = window.auth?.currentUser;
    if (!currentUser) {
      return { success: false, error: '로그인이 필요합니다.' };
    }
    
    // 기존 Google Sheets 필드 구조로 데이터 준비
    const now = new Date().toISOString();
    const defaultExpiryDate = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 3); // 오늘 + 3개월
      return d.toISOString().split('T')[0];
    })();
    
    const newUserData = {
      // 기존 Google Sheets 필드 구조 완벽 유지
      id: currentUser.uid, // Firebase uid 사용
      name: userData.name || '',
      contact: userData.contact || '',
      ftp: parseInt(userData.ftp) || 0,
      weight: parseFloat(userData.weight) || 0,
      created_at: now,
      grade: String(userData.grade || '2'), // 기본값: "2"
      expiry_date: userData.expiry_date || defaultExpiryDate,
      challenge: String(userData.challenge || 'Fitness'), // 기본값: "Fitness"
      acc_points: 0, // 기본값: 0
      rem_points: 0, // 기본값: 0
      last_training_date: '', // 기본값: 빈 문자열
      strava_access_token: '', // 기본값: 빈 문자열
      strava_refresh_token: '', // 기본값: 빈 문자열
      strava_expires_at: 0 // 기본값: 0
    };
    
    // Firestore에 저장
    const userDocRef = getUsersCollection().doc(currentUser.uid);
    await userDocRef.set(newUserData);
    
    console.log('✅ 사용자 생성 완료:', newUserData.id);
    return { success: true, id: newUserData.id };
  } catch (error) {
    console.error('❌ 사용자 생성 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 사용자 정보 업데이트
 * @param {string} id - 사용자 ID (Firebase uid)
 * @param {object} userData - 업데이트할 사용자 데이터
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function apiUpdateUser(id, userData) {
  try {
    if (!id) {
      return { success: false, error: '사용자 ID가 필요합니다.' };
    }
    
    // 업데이트할 데이터 준비 (기존 필드 구조 유지)
    const updateData = {};
    
    if (userData.name != null) updateData.name = userData.name;
    if (userData.contact != null) updateData.contact = userData.contact;
    if (userData.ftp != null) updateData.ftp = parseInt(userData.ftp);
    if (userData.weight != null) updateData.weight = parseFloat(userData.weight);
    if (userData.grade != null) updateData.grade = String(userData.grade);
    if (userData.expiry_date != null) updateData.expiry_date = String(userData.expiry_date);
    if (userData.challenge != null) updateData.challenge = String(userData.challenge);
    if (userData.acc_points != null) updateData.acc_points = parseFloat(userData.acc_points);
    if (userData.rem_points != null) updateData.rem_points = parseFloat(userData.rem_points);
    if (userData.last_training_date != null) updateData.last_training_date = String(userData.last_training_date);
    if (userData.strava_access_token != null) updateData.strava_access_token = String(userData.strava_access_token);
    if (userData.strava_refresh_token != null) updateData.strava_refresh_token = String(userData.strava_refresh_token);
    if (userData.strava_expires_at != null) updateData.strava_expires_at = Number(userData.strava_expires_at);
    
    // Firestore 업데이트
    await getUsersCollection().doc(id).update(updateData);
    
    console.log('✅ 사용자 정보 업데이트 완료:', id);
    return { success: true };
  } catch (error) {
    console.error('❌ 사용자 정보 업데이트 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 사용자 삭제
 * @param {string} id - 사용자 ID (Firebase uid)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function apiDeleteUser(id) {
  try {
    if (!id) {
      return { success: false, error: '사용자 ID가 필요합니다.' };
    }
    
    await getUsersCollection().doc(id).delete();
    
    console.log('✅ 사용자 삭제 완료:', id);
    return { success: true };
  } catch (error) {
    console.error('❌ 사용자 삭제 실패:', error);
    return { success: false, error: error.message };
  }
}

// ========== 기존 호환성 함수들 (유지) ==========

function createUserFromAuth(authFormData) {
  const userData = {
    name: authFormData.name || '',
    contact: formatPhoneForDB(authFormData.contact || ''),
    ftp: parseInt(authFormData.ftp) || 0,
    weight: parseFloat(authFormData.weight) || 0,
    challenge: authFormData.challenge || 'Fitness',
    grade: '2',
    expiry_date: ''
  };
  
  console.log('Creating user from auth form:', userData);
  return apiCreateUser(userData);
}

function onUserRegistrationSuccess(userData, source = 'auth') {
  console.log(`User registered successfully from ${source}:`, userData);
  
  adoptCreatedUserAsViewer(userData).then(ok => {
    if (!ok) console.warn('방금 생성한 사용자를 찾지 못해 뷰어 채택에 실패');
    if (typeof loadUsers === 'function') loadUsers();
  });
  
  if (typeof showUserWelcomeModal === 'function') {
    showUserWelcomeModal(userData.name);
    window.userWelcomeModalShown = true;
    window.userWelcomeModalUserName = userData.name;
  } else if (typeof showToast === 'function') {
    showToast(`${userData.name}님 등록이 완료되었습니다! 🎉`);
  }
  return true;
}

function onUserRegistrationError(error, source = 'auth') {
  console.error(`User registration failed from ${source}:`, error);
  
  if (typeof showToast === 'function') {
    const errorMessage = error.message || '등록 중 오류가 발생했습니다';
    showToast(`등록 실패: ${errorMessage} ❌`);
  }
  
  return false;
}

async function unifiedCreateUser(userData, source = 'profile') {
  try {
    if (!userData.name || !userData.ftp || !userData.weight) {
      throw new Error('필수 필드가 누락되었습니다');
    }

    const inputContact = String(userData.contact || '');
    const normalizedContact = standardizePhoneFormat(inputContact);
    const onlyDigits = unformatPhone(normalizedContact);
    userData.contact = normalizedContact;

    const listRes = await apiGetUsers();
    const users = (listRes && (listRes.items || listRes.users || listRes.data)) || [];
    const isDuplicated = users.some(u => {
      const uDigits = unformatPhone(u?.contact || '');
      return uDigits === onlyDigits;
    });

    if (isDuplicated) {
      throw new Error('✅ 이미 등록된 사용자입니다.');
    }

    if (!userData.expiry_date) {
      const d = new Date();
      d.setMonth(d.getMonth() + 3);
      userData.expiry_date = d.toISOString().slice(0, 10);
    }

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

function saveUserFromAuth(formData) {
  return unifiedCreateUser({
    name: formData.name,
    contact: formData.contact,
    ftp: formData.ftp,
    weight: formData.weight,
    grade: '2',
    expiry_date: ''
  }, 'auth');
}

// 전역 함수로 내보내기
if (typeof window !== 'undefined') {
  window.createUserFromAuth = createUserFromAuth;
  window.unifiedCreateUser = unifiedCreateUser;
  window.saveUserFromAuth = saveUserFromAuth;
  window.standardizePhoneFormat = standardizePhoneFormat;
  window.signInWithGoogle = signInWithGoogle;
  window.signOut = signOut;
}

/**
 * 사용자 등록 환영 오버레이 표시
 */
function showUserWelcomeModal(userName) {
  const modal = document.getElementById('userWelcomeModal');
  const messageEl = document.getElementById('user-welcome-message');
  
  if (!modal || !messageEl) {
    console.warn('[User Welcome] 환영 오버레이 요소를 찾을 수 없습니다.', { modal: !!modal, messageEl: !!messageEl });
    if (typeof showToast === 'function') {
      showToast(`${userName}님 등록이 완료되었습니다! 🎉`);
    }
    return;
  }
  
  const eventTitleEl = document.getElementById('user-welcome-event-title');
  if (eventTitleEl) {
    eventTitleEl.innerHTML = '백만킬로아카데미 회원대상 특별 이벤트(한시적)';
  }
  
  const message = `
    <div style="margin-bottom: 12px; font-size: 1.05em; line-height: 1.8;">
      <strong>${userName}</strong>님, STELVIO AI의 멤버가 되신 것을 축하합니다!
    </div>
    <div style="margin-bottom: 12px; font-size: 0.95em; line-height: 1.8;">
      오늘부터 <span style="color: #1a1a1a; font-weight: 600;">3개월간 무료 체험</span>이 시작됩니다.<br>
      이제 날씨와 공간의 제약 없이 마음껏 달리세요.
    </div>
    <div style="font-size: 0.95em; line-height: 1.8;">
      <strong>${userName}</strong>님이 흘린 땀방울이 헛되지 않도록,<br>
      목표하신 정상까지 STELVIO AI가 최고의<br>
      페이스메이커가 되어드리겠습니다.
    </div>
  `;
  
  messageEl.innerHTML = message;
  
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
    console.log('[User Welcome] 모달을 body로 이동 완료');
  }
  
  document.querySelectorAll('.screen').forEach(screen => {
    screen.style.setProperty('z-index', '1000', 'important');
  });
  
  modal.classList.remove('hidden');
  
  requestAnimationFrame(() => {
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('z-index', '99999', 'important');
    modal.style.setProperty('position', 'fixed', 'important');
    modal.style.setProperty('top', '0', 'important');
    modal.style.setProperty('left', '0', 'important');
    modal.style.setProperty('width', '100%', 'important');
    modal.style.setProperty('height', '100%', 'important');
    modal.style.setProperty('background', 'rgba(0, 0, 0, 0.9)', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    
    document.querySelectorAll('*').forEach(el => {
      if (el === modal || el === modal.querySelector('.welcome-content')) return;
      const zIndex = window.getComputedStyle(el).zIndex;
      if (zIndex && zIndex !== 'auto' && parseInt(zIndex) >= 10002) {
        el.style.setProperty('z-index', '1000', 'important');
      }
    });
    
    window.userWelcomeModalShown = true;
    window.userWelcomeModalUserName = userName;
    
    setTimeout(() => {
      const rect = modal.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(modal);
      const isVisible = rect.width > 0 && rect.height > 0 && 
                       computedStyle.display !== 'none' &&
                       computedStyle.visibility !== 'hidden' &&
                       computedStyle.opacity !== '0';
      
      console.log('[User Welcome] 환영 오버레이 표시 확인:', userName, { 
        modalDisplay: modal.style.display, 
        modalZIndex: modal.style.zIndex,
        hasHiddenClass: modal.classList.contains('hidden'),
        computedDisplay: computedStyle.display,
        computedZIndex: computedStyle.zIndex,
        computedVisibility: computedStyle.visibility,
        computedOpacity: computedStyle.opacity,
        windowFlag: window.userWelcomeModalShown,
        isVisible: isVisible,
        rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
        parentElement: modal.parentElement?.tagName || 'N/A'
      });
      
      if (!isVisible) {
        console.error('[User Welcome] ⚠️ 모달이 표시되지 않습니다! 강제로 다시 표시 시도');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('z-index', '99999', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('opacity', '1', 'important');
        modal.style.setProperty('position', 'fixed', 'important');
        modal.style.setProperty('top', '0', 'important');
        modal.style.setProperty('left', '0', 'important');
        modal.style.setProperty('width', '100%', 'important');
        modal.style.setProperty('height', '100%', 'important');
      }
    }, 50);
  });
}

function closeUserWelcomeModal() {
  const modal = document.getElementById('userWelcomeModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    window.userWelcomeModalShown = false;
    window.userWelcomeModalUserName = null;
    console.log('[User Welcome] 환영 오버레이 닫기 완료');
  }
}

if (typeof window !== 'undefined') {
  window.showUserWelcomeModal = showUserWelcomeModal;
  window.closeUserWelcomeModal = closeUserWelcomeModal;
}

// ========== 사용자 목록 로드 및 렌더링 ==========

async function loadUsers() {
  const userList = document.getElementById('userList');
  if (!userList) return;

  try {
    userList.innerHTML = `
      <div class="loading-container">
        <div class="dots-loader"><div></div><div></div><div></div></div>
        <div style="color:#666;font-size:14px;">사용자 목록을 불러오는 중...</div>
      </div>
    `;

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

    let visibleUsers = users;
    if (viewerGrade === '2' && viewerId) {
      visibleUsers = users.filter(u => String(u.id) === viewerId);
    }

    visibleUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    const canEditFor = (u) => (viewerGrade === '1' || viewerGrade === '3') || (viewerId && String(u.id) === viewerId);

    userList.innerHTML = visibleUsers.map(user => {
      const wkg = (user.ftp && user.weight) ? (user.ftp / user.weight).toFixed(2) : '-';

      const expRaw = user.expiry_date;
      let expiryText = '미설정';
      let expiryClass = '';
      let isExpired = false;
      let shouldShowWarning = false;
      let expiryDate = null;
      
      if (expRaw) {
        expiryDate = new Date(expRaw);
        const today = new Date();
        expiryDate.setHours(0,0,0,0);
        today.setHours(0,0,0,0);
        const diffDays = Math.round((expiryDate - today) / (24*60*60*1000));
        expiryText = expiryDate.toLocaleDateString();

        if (diffDays < 0) {
          expiryClass = 'is-expired';
          isExpired = true;
        } else if (diffDays === 0) {
          expiryClass = 'is-soon';
          expiryText += ' (D-DAY)';
          shouldShowWarning = true;
        } else if (diffDays <= 7) {
          expiryClass = 'is-soon';
          expiryText += ` (D-${diffDays})`;
          shouldShowWarning = true;
        } else if (diffDays <= 10) {
          shouldShowWarning = true;
        }
      }

      const canEdit = canEditFor(user);
      
      const userGrade = String(user.grade || '2');
      const canDelete = canEdit && (userGrade !== '2' && userGrade !== '3');
      const deleteButtonDisabled = canEdit && !canDelete ? 'disabled' : '';
      const deleteButtonClass = canEdit && !canDelete ? 'disabled' : '';

      const challenge = String(user.challenge || 'Fitness').trim();
      let challengeImage = 'yellow.png';
      if (challenge === 'GranFondo') {
        challengeImage = 'green.png';
      } else if (challenge === 'Racing') {
        challengeImage = 'blue.png';
      } else if (challenge === 'Elite') {
        challengeImage = 'orenge.png';
      } else if (challenge === 'PRO') {
        challengeImage = 'red.png';
      }

      return `
        <div class="user-card" data-user-id="${user.id}" onclick="selectUser(${user.id})" style="cursor: pointer;">
          <div class="user-header">
            <div class="user-name"><img src="assets/img/${challengeImage}" alt="" class="user-name-icon"> ${user.name}</div>
            <div class="user-actions" onclick="event.stopPropagation();">
              ${canEdit ? `
                <button class="btn-edit"   onclick="editUser(${user.id})"   title="수정">✏️</button>
                <button class="btn-delete ${deleteButtonClass}" onclick="deleteUser(${user.id})" title="삭제" ${deleteButtonDisabled}>🗑️</button>
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
        </div>
      `;
    }).join('');

    const profileScreen = document.getElementById('profileScreen');
    const isProfileScreenActive = profileScreen && profileScreen.classList.contains('active');
    
    if (isProfileScreenActive) {
      const expiryModal = document.getElementById('expiryWarningModal');
      const isModalAlreadyOpen = expiryModal && expiryModal.style.display !== 'none' && expiryModal.style.display !== '';
      
      if (!isModalAlreadyOpen) {
        const firstExpiringUser = visibleUsers.find(user => {
          const expRaw = user.expiry_date;
          if (expRaw) {
            const expiryDate = new Date(expRaw);
            const today = new Date();
            expiryDate.setHours(0,0,0,0);
            today.setHours(0,0,0,0);
            const diffDays = Math.round((expiryDate - today) / (24*60*60*1000));
            
            const userGrade = String(user.grade || '2');
            if (userGrade === '2' && diffDays <= 10 && diffDays >= 0) {
              const warningKey = `expiryWarningShown_${user.id}_${expRaw}`;
              const alreadyShown = sessionStorage.getItem(warningKey);
              return !alreadyShown;
            }
          }
          return false;
        });
        
        if (firstExpiringUser) {
          const warningKey = `expiryWarningShown_${firstExpiringUser.id}_${firstExpiringUser.expiry_date}`;
          sessionStorage.setItem(warningKey, 'true');
          
          setTimeout(() => {
            const modal = document.getElementById('expiryWarningModal');
            if (modal && (modal.style.display === 'none' || modal.style.display === '')) {
              showExpiryWarningModal(firstExpiringUser.expiry_date);
            }
          }, 500);
        }
      }
    }

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

async function selectUser(userId) {
  const userCard = document.querySelector(`.user-card[data-user-id="${userId}"]`);
  
  if (userCard) {
    userCard.style.opacity = '0.6';
    userCard.style.pointerEvents = 'none';
  }
  
  try {
    const result = await apiGetUser(userId);
    
    if (!result.success) {
      showToast('사용자 정보를 불러올 수 없습니다.');
      return;
    }

    const user = result.item;
    
    const userGrade = String(user.grade || '2');
    if (userGrade === '2' && user.expiry_date) {
      const expiryDate = new Date(user.expiry_date);
      const today = new Date();
      expiryDate.setHours(0,0,0,0);
      today.setHours(0,0,0,0);
      const diffDays = Math.round((expiryDate - today) / (24*60*60*1000));
      
      if (diffDays < 0) {
        showToast('사용기간이 만료되어 선택할 수 없습니다.');
        if (userCard) {
          userCard.style.opacity = '1';
          userCard.style.pointerEvents = 'auto';
        }
        return;
      }
    }
    
    let prevViewer = null;
    try {
      prevViewer = (window.currentUser) || JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (e) { prevViewer = null; }
    
    if (prevViewer && prevViewer.grade != null && (user.grade == null)) {
      user.grade = String(prevViewer.grade);
    }
    
    window.currentUser = user;
    
    try {
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }

    showToast(`${user.name}님이 선택되었습니다.`);
    
    if (typeof showRPEModal === 'function') {
      showRPEModal();
    }
    
  } catch (error) {
    console.error('사용자 선택 실패:', error);
    showToast('사용자 선택 중 오류가 발생했습니다.');
    if (userCard) {
      userCard.style.opacity = '1';
      userCard.style.pointerEvents = 'auto';
    }
  }
}

function showAddUserForm(clearForm = true) {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (cardAddUser) cardAddUser.classList.add('hidden');
  if (addUserForm) addUserForm.classList.remove('hidden');
  
  if (clearForm) {
    const nameEl = document.getElementById('userName');
    const contactEl = document.getElementById('userContact');
    const ftpEl = document.getElementById('userFTP');
    const weightEl = document.getElementById('userWeight');
    const challengeSelect = document.getElementById('userChallenge');
    
    if (nameEl) nameEl.value = '';
    if (contactEl) contactEl.value = '';
    if (ftpEl) ftpEl.value = '';
    if (weightEl) weightEl.value = '';
    if (challengeSelect) challengeSelect.value = 'Fitness';
  }
}

function hideAddUserForm() {
  const cardAddUser = document.getElementById('cardAddUser');
  const addUserForm = document.getElementById('addUserForm');
  
  if (addUserForm) addUserForm.classList.add('hidden');
  if (cardAddUser) cardAddUser.classList.remove('hidden');
  
  const saveBtn = document.getElementById('btnSaveUser');
  if (saveBtn) {
    saveBtn.textContent = '저장';
    saveBtn.onclick = null;
    saveBtn.onclick = saveUser;
  }
  
  const formTitle = document.querySelector('#addUserForm h3');
  if (formTitle) {
    formTitle.textContent = '새 사용자 등록';
  }
  
  isEditMode = false;
  currentEditUserId = null;
}

async function saveUser() {
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

  if (!name) { showToast('이름을 입력해주세요.'); return; }
  if (!ftp || ftp < 50 || ftp > 600) { showToast('올바른 FTP 값을 입력해주세요. (50-600W)'); return; }
  if (!weight || weight < 30 || weight > 200) { showToast('올바른 체중을 입력해주세요. (30-200kg)'); return; }

  try {
    const userData = { name, contact: contactDB, ftp, weight, challenge };
    const payload = {
      ...userData,
      grade: userData.grade || '2',
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

async function editUser(userId) {
  try {
    const result = await apiGetUser(userId);
    
    if (!result.success) {
      showToast('사용자 정보를 불러올 수 없습니다.');
      return;
    }

    const user = result.item;
    
    isEditMode = true;
    currentEditUserId = userId;
    console.log('Edit mode activated for user:', userId);
    
    showAddUserForm(false);
    
    const fillFormData = (retries = 10) => {
      const nameEl = document.getElementById('userName');
      const contactEl = document.getElementById('userContact');
      const ftpEl = document.getElementById('userFTP');
      const weightEl = document.getElementById('userWeight');
      const challengeSelect = document.getElementById('userChallenge');
      
      if (nameEl && contactEl && ftpEl && weightEl && challengeSelect) {
        nameEl.value = user.name || '';
        contactEl.value = unformatPhone(user.contact || '');
        ftpEl.value = user.ftp || '';
        weightEl.value = user.weight || '';
        challengeSelect.value = user.challenge || 'Fitness';
      } else if (retries > 0) {
        setTimeout(() => fillFormData(retries - 1), 50);
      } else {
        console.warn('폼 요소를 찾을 수 없습니다. 일부 필드가 채워지지 않았을 수 있습니다.');
        if (nameEl) nameEl.value = user.name || '';
        if (contactEl) contactEl.value = unformatPhone(user.contact || '');
        if (ftpEl) ftpEl.value = user.ftp || '';
        if (weightEl) weightEl.value = user.weight || '';
        if (challengeSelect) challengeSelect.value = user.challenge || 'Fitness';
      }
    };
    
    setTimeout(() => fillFormData(), 100);
   
   const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
   const isAdmin = (viewerGrade === '1');
   const form = document.getElementById('addUserForm');
   
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
           <option value="2" ${String(user.grade || '') === '2' ? 'selected' : ''}>2 (일반)</option>
           <option value="3" ${String(user.grade || '') === '3' ? 'selected' : ''}>3 (부관리자)</option>
         </select>
       </div>
       <div class="form-row">
         <label>만기일(expiry_date)</label>
         <input id="editExpiryDate" type="date" value="${(user.expiry_date || '').substring(0,10)}">
       </div>
     `;
     const actions = form.querySelector('.form-actions') || form.lastElementChild;
     form.insertBefore(adminWrap, actions);
   }

const saveBtn = document.getElementById('btnSaveUser');
if (saveBtn) {
  saveBtn.textContent = '수정';
  saveBtn.removeEventListener('click', saveUser);
  saveBtn.onclick = null;
  saveBtn.onclick = () => performUpdate();
}

    const formTitle = document.querySelector('#addUserForm h3');
    if (formTitle) {
      formTitle.textContent = '사용자 정보 수정';
    }
    
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    showToast('사용자 정보 로드 중 오류가 발생했습니다.');
  }
}

async function performUpdate() {
  if (!isEditMode || !currentEditUserId) {
    console.error('Invalid edit mode state');
    return;
  }

  const name = document.getElementById('userName').value.trim();
  const contactRaw = document.getElementById('userContact').value.trim();
  const contactDB  = formatPhoneForDB(contactRaw);
  const ftp = parseInt(document.getElementById('userFTP').value);
  const weight = parseFloat(document.getElementById('userWeight').value);
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = {
      name,
      contact: contactDB,
      ftp,
      challenge,
      weight
    };

    const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
    if (viewerGrade === '1') {
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

function resetFormMode() {
  isEditMode = false;
  currentEditUserId = null;
  hideAddUserForm();
  console.log('Form mode reset to add mode');
}

async function deleteUser(userId) {
  if (!confirm('정말로 이 사용자를 삭제하시겠습니까?\n삭제된 사용자의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    const result = await apiDeleteUser(userId);
    
    if (result.success) {
      showToast('사용자가 삭제되었습니다.');
      loadUsers();
    } else {
      showToast('사용자 삭제 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    showToast('사용자 삭제 중 오류가 발생했습니다.');
  }
}

async function adoptCreatedUserAsViewer(createdInput) {
  try {
    if (typeof apiGetUsers !== 'function') {
      console.warn('adoptCreatedUserAsViewer: apiGetUsers가 없습니다.');
      return false;
    }

    const listRes = await apiGetUsers();
    const users = (listRes && listRes.items) ? listRes.items : [];

    const onlyDigits = (createdInput?.contact || '').replace(/\D+/g, '');
    let user = null;
    if (onlyDigits) {
      user = users.find(u => (u.contact || '').replace(/\D+/g, '') === onlyDigits) || null;
    }
    if (!user && createdInput?.name) {
      const targetName = String(createdInput.name);
      user = users.find(u => String(u.name || '') === targetName) || null;
    }
    if (!user) {
      console.warn('adoptCreatedUserAsViewer: 방금 생성한 사용자를 목록에서 찾지 못했습니다.', createdInput);
      return false;
    }

    window.currentUser = user;
    try {
      localStorage.setItem('authUser', JSON.stringify(user));
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (e) {
      console.warn('localStorage 저장 실패(무시 가능):', e);
    }

    if (typeof showScreen === 'function') {
      showScreen('connectionScreen');
    }

    if (typeof loadUsers === 'function') {
      loadUsers();
    }

    return true;
  } catch (e) {
    console.error('adoptCreatedUserAsViewer() 실패:', e);
    return false;
  }
}

function showExpiryWarningModal(expiryDate) {
  const modal = document.getElementById('expiryWarningModal');
  const dateElement = document.getElementById('expiryWarningDate');
  
  if (modal && dateElement) {
    if (expiryDate) {
      const date = new Date(expiryDate);
      const formattedDate = date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      dateElement.textContent = formattedDate;
    }
    
    modal.style.display = 'flex';
  }
}

function closeExpiryWarningModal() {
  const modal = document.getElementById('expiryWarningModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 전역 함수로 등록
window.loadUsers = loadUsers;
window.selectUser = selectUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.saveUser = saveUser;
window.selectProfile = selectUser;
window.showExpiryWarningModal = showExpiryWarningModal;
window.closeExpiryWarningModal = closeExpiryWarningModal;

// API 함수들 전역 노출
window.apiGetUsers   = window.apiGetUsers   || apiGetUsers;
window.apiGetUser    = window.apiGetUser    || apiGetUser;
window.apiCreateUser = window.apiCreateUser || apiCreateUser;
window.apiUpdateUser = window.apiUpdateUser || apiUpdateUser;
window.apiDeleteUser = window.apiDeleteUser || apiDeleteUser;

// 초기화 이벤트
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

  const contactInput = document.getElementById('userContact');
  if (contactInput) {
    contactInput.setAttribute('inputmode', 'numeric');
    contactInput.setAttribute('pattern', '[0-9]*');
    contactInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D+/g, '');
    });
  }
});
