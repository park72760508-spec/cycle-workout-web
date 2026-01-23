
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

/**
 * 마일리지 업데이트 함수 (TSS 기반) - Firebase 버전
 * Code.gs의 updateUserMileage를 Firebase로 마이그레이션
 */
async function updateUserMileage(userId, todayTss) {
  try {
    const usersCollection = getUsersCollection();
    const userDoc = await usersCollection.doc(userId).get();
    
    if (!userDoc.exists) {
      return { success: false, error: 'User not found' };
    }
    
    const userData = userDoc.data();
    
    // 기존 값 가져오기
    let accPoints = Number(userData.acc_points || 0);
    let remPoints = Number(userData.rem_points || 0);
    const expiryDate = userData.expiry_date || '';
    const lastTrainingDate = userData.last_training_date || '';
    
    // 현재 날짜 및 연도 확인
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD 형식
    
    // 연도 초기화 체크: 1월 1일 이후 첫 훈련인지 확인
    let shouldResetAccPoints = false;
    if (currentMonth >= 1) { // 1월 이후
      if (!lastTrainingDate || lastTrainingDate === '') {
        // 마지막 훈련 날짜가 없으면 첫 훈련으로 간주
        shouldResetAccPoints = true;
      } else {
        try {
          const lastDate = new Date(lastTrainingDate);
          const lastYear = lastDate.getFullYear();
          // 이전 연도에 마지막 훈련을 했고, 현재 연도가 다르면 초기화
          if (lastYear < currentYear) {
            shouldResetAccPoints = true;
          }
        } catch (e) {
          console.error('마지막 훈련 날짜 파싱 오류:', e);
          shouldResetAccPoints = false;
        }
      }
    }
    
    // 누적 포인트 초기화 (1월 1일 이후 첫 훈련인 경우)
    if (shouldResetAccPoints) {
      accPoints = 0;
      console.log(`[updateUserMileage] 누적 포인트 초기화: ${currentYear}년 첫 훈련`);
    }
    
    // 1단계: 합계 계산
    const calcPool = remPoints + todayTss;
    
    // 2단계: 연장할 일수 계산 (내림 함수) - 500 포인트당 1일
    const addDays = Math.floor(calcPool / 500);
    
    // 3단계: 새로운 잔액 계산 (모듈러 연산)
    const newRemPoints = calcPool % 500;
    
    // 4단계: 총 누적 마일리지 갱신
    const newAccPoints = accPoints + todayTss;
    
    // 5단계: 만료일 연장 (500 포인트당 1일)
    let newExpiryDate = expiryDate;
    if (addDays > 0 && expiryDate) {
      try {
        const expiry = new Date(expiryDate);
        expiry.setDate(expiry.getDate() + addDays);
        newExpiryDate = expiry.toISOString().split('T')[0]; // YYYY-MM-DD 형식
        console.log(`[updateUserMileage] 만료일 연장: ${expiryDate} → ${newExpiryDate} (${addDays}일)`);
      } catch (e) {
        console.error('만료일 계산 오류:', e);
        // 만료일 계산 실패 시 기존 값 유지
      }
    }
    
    // Firebase에 업데이트
    const updateData = {
      acc_points: newAccPoints,
      rem_points: newRemPoints,
      last_training_date: currentDate
    };
    
    // 만료일 연장이 있는 경우에만 expiry_date 업데이트
    if (addDays > 0 && newExpiryDate) {
      updateData.expiry_date = newExpiryDate;
    }
    
    await usersCollection.doc(userId).update(updateData);
    
    console.log(`[updateUserMileage] ✅ 업데이트 완료:`, {
      userId: userId,
      acc_points: newAccPoints,
      rem_points: newRemPoints,
      expiry_date: newExpiryDate,
      last_training_date: currentDate,
      add_days: addDays,
      earned_points: todayTss,
      acc_points_reset: shouldResetAccPoints
    });
    
    return {
      success: true,
      acc_points: newAccPoints,
      rem_points: newRemPoints,
      expiry_date: newExpiryDate,
      last_training_date: currentDate,
      add_days: addDays,
      earned_points: todayTss,
      acc_points_reset: shouldResetAccPoints
    };
  } catch (error) {
    console.error('[updateUserMileage] ❌ 업데이트 실패:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// 전역 함수로 등록
window.updateUserMileage = updateUserMileage;

// 전역 변수로 현재 모드 추적
let isEditMode = false;
let currentEditUserId = null;

// 사용자 정보 입력 모달 표시 여부 추적 (중복 호출 방지)
let isCompleteUserInfoModalShown = false;

// 로그인 성공 여부 추적 (페이지 로드 시 모달 표시 방지)
let isLoginJustCompleted = false;

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

// 사용자 정보 입력 폼의 전화번호 포맷팅 (인라인 이벤트용)
function formatUserContactPhone(input) {
  if (!input) return;
  const value = input.value;
  const numbers = value.replace(/\D/g, '');
  const limitedNumbers = numbers.slice(0, 11);
  
  let formatted = '';
  if (limitedNumbers.length > 0) {
    if (limitedNumbers.length <= 3) {
      formatted = limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3);
    } else {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3, 7) + '-' + limitedNumbers.slice(7, 11);
    }
  }
  
  if (input.value !== formatted) {
    input.value = formatted;
  }
}

// 전화번호 자동 포맷팅 (숫자만 입력해도 자동 변환)
function autoFormatPhoneNumber(input) {
  if (!input) return;
  
  // 현재 커서 위치 저장
  const cursorPosition = input.selectionStart;
  const originalLength = input.value.length;
  
  // 숫자만 추출
  const numbers = input.value.replace(/\D/g, '');
  const limitedNumbers = numbers.slice(0, 11);
  
  // 포맷팅
  let formatted = '';
  if (limitedNumbers.length > 0) {
    if (limitedNumbers.length <= 3) {
      formatted = limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3);
    } else {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3, 7) + '-' + limitedNumbers.slice(7, 11);
    }
  }
  
  // 값이 변경된 경우에만 업데이트
  if (input.value !== formatted) {
    input.value = formatted;
    
    // 커서 위치 조정 (삭제된 문자가 있으면 위치 조정)
    const newLength = formatted.length;
    const lengthDiff = newLength - originalLength;
    let newCursorPosition = cursorPosition + lengthDiff;
    
    // 하이픈 위치에 커서가 있으면 다음 위치로 이동
    if (formatted[newCursorPosition] === '-') {
      newCursorPosition++;
    }
    
    // 커서 위치가 범위를 벗어나지 않도록 조정
    newCursorPosition = Math.max(0, Math.min(newCursorPosition, formatted.length));
    
    // 커서 위치 복원
    setTimeout(() => {
      input.setSelectionRange(newCursorPosition, newCursorPosition);
    }, 0);
  }
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.formatUserContactPhone = formatUserContactPhone;
  window.autoFormatPhoneNumber = autoFormatPhoneNumber;
}

// ========== Firebase Authentication (Google Login) ==========

/**
 * Google 로그인 (팝업 방식)
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
async function signInWithGoogle() {
  try {
    if (!window.auth) {
      throw new Error('Firebase Auth가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    // 추가 스코프 요청 (필요시)
    provider.addScope('profile');
    provider.addScope('email');

    // 팝업 방식 시도 (COOP 경고는 무시하고 계속 진행)
    let result;
    try {
      result = await window.auth.signInWithPopup(provider);
    } catch (popupError) {
      // COOP 경고는 실제로 로그인을 막지 않을 수 있으므로, 
      // 오류 코드를 확인하여 실제 오류인지 판단
      const isCOOPWarning = popupError.message?.includes('Cross-Origin-Opener-Policy') ||
                            popupError.message?.includes('window.closed');
      
      if (isCOOPWarning) {
        // COOP 경고는 무시하고 리다이렉트로 폴백
        console.warn('⚠️ COOP 정책 경고 발생 - 리다이렉트 방식으로 전환:', popupError.message);
        try {
          console.log('ℹ️ 리다이렉트 방식으로 로그인합니다...');
          await window.auth.signInWithRedirect(provider);
          return { 
            success: true, 
            redirecting: true,
            message: '로그인 페이지로 이동 중...' 
          };
        } catch (redirectError) {
          console.error('❌ 리다이렉트 로그인도 실패:', redirectError);
          throw popupError;
        }
      }
      
      // 팝업이 차단된 경우 리다이렉트로 폴백
      if (popupError.code === 'auth/popup-blocked' || 
          popupError.code === 'auth/popup-closed-by-user') {
        console.log('ℹ️ 팝업이 차단되었습니다. 리다이렉트 방식으로 로그인합니다...');
        await window.auth.signInWithRedirect(provider);
        return { 
          success: true, 
          redirecting: true,
          message: '로그인 페이지로 이동 중...' 
        };
      }
      
      throw popupError; // 다른 오류는 그대로 throw
    }
    
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
      
      // 필수 정보 확인 (전화번호, FTP, 몸무게, 운동목적 중 하나라도 없으면)
      const hasContact = userData.contact && userData.contact.trim() !== '';
      const hasFTP = userData.ftp && userData.ftp > 0;
      const hasWeight = userData.weight && userData.weight > 0;
      const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
      
      const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasChallenge;
      
      // 로그인 성공 플래그 설정
      isLoginJustCompleted = true;
      
      if (needsInfo) {
        // 필수 정보가 없으면 사용자 정보 완성 모달 표시
        setTimeout(() => {
          showCompleteUserInfoModal(userData);
        }, 500); // 로그인 후 약간의 지연
      }
      
      return { success: true, user: userData, isNewUser: false, needsInfo };
    } else {
      // 신규 회원: 기존 Google Sheets 필드 구조로 문서 생성
      const now = new Date().toISOString();
      // 최초 로그인 시에는 오늘 날짜로 설정 (3개월 연장은 사용자 정보 입력 완료 후 적용)
      const todayDate = new Date().toISOString().split('T')[0];

      const newUserData = {
        // 기존 Google Sheets 필드 구조 완벽 유지
        id: user.uid, // Firebase uid 사용
        name: user.displayName || user.email?.split('@')[0] || '사용자',
        contact: '', // 기본값: 빈 문자열
        ftp: 0, // 기본값: 0
        weight: 0, // 기본값: 0
        created_at: now,
        grade: '2', // 기본값: "2" (일반 사용자)
        expiry_date: todayDate, // 최초 로그인 시 오늘 날짜로 설정
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

      // 로그인 성공 플래그 설정
      isLoginJustCompleted = true;
      
      // 신규 회원은 항상 필수 정보 입력 필요
      setTimeout(() => {
        showCompleteUserInfoModal(newUserData);
      }, 500); // 로그인 후 약간의 지연

      return { success: true, user: newUserData, isNewUser: true, needsInfo: true };
    }
  } catch (error) {
    console.error('❌ Google 로그인 실패:', error);
    
    // OAuth 도메인 오류인 경우 상세 안내
    if (error.code === 'auth/unauthorized-domain' || error.message?.includes('not authorized')) {
      const errorMsg = 'OAuth 도메인이 승인되지 않았습니다. Firebase 콘솔에서 도메인을 추가해주세요.\n\n' +
        '해결 방법:\n' +
        '1. Firebase 콘솔 → Authentication → Settings\n' +
        '2. Authorized domains 섹션에서 "Add domain" 클릭\n' +
        '3. "stelvio.ai.kr" 도메인 추가\n' +
        '4. 자세한 내용은 FIREBASE_SETUP_GUIDE.md 참고';
      
      console.error('🔴 OAuth 도메인 오류:', errorMsg);
      
      return { 
        success: false, 
        error: 'OAuth 도메인 오류: Firebase 콘솔에서 도메인을 추가해주세요. (FIREBASE_SETUP_GUIDE.md 참고)'
      };
    }
    
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

  // 리다이렉트 로그인 결과 처리 (페이지 로드 시)
  window.auth.getRedirectResult().then(async (result) => {
    if (result.user) {
      console.log('✅ 리다이렉트 로그인 성공:', result.user.email);
      
      // Firestore에서 사용자 정보 조회 또는 생성
      const userDocRef = getUsersCollection().doc(result.user.uid);
      const userDoc = await userDocRef.get();
      
      if (userDoc.exists) {
        // 기존 회원: lastLogin만 업데이트
        await userDocRef.update({
          lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const userData = { id: result.user.uid, ...userDoc.data() };
        
        // 전역 상태 업데이트
        window.currentUser = userData;
        localStorage.setItem('currentUser', JSON.stringify(userData));
        localStorage.setItem('authUser', JSON.stringify(userData));
        
        // 필수 정보 확인 (전화번호, FTP, 몸무게, 운동목적 중 하나라도 없으면)
        const hasContact = userData.contact && userData.contact.trim() !== '';
        const hasFTP = userData.ftp && userData.ftp > 0;
        const hasWeight = userData.weight && userData.weight > 0;
        const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
        
        const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasChallenge;
        
        // 사용자 목록 새로고침
        if (typeof loadUsers === 'function') {
          await loadUsers();
        }
        if (typeof syncUsersFromDB === 'function') {
          await syncUsersFromDB();
        }
        
        // 로그인 성공 플래그 설정
        isLoginJustCompleted = true;
        
        if (needsInfo) {
          // 필수 정보가 없으면 사용자 정보 완성 모달 표시 (베이스캠프로 이동하지 않음)
          setTimeout(() => {
            showCompleteUserInfoModal(userData);
          }, 500);
        } else {
          // 필수 정보가 모두 있으면 베이스캠프 화면으로 이동
          if (typeof showScreen === 'function') {
            showScreen('basecampScreen');
          }
          if (typeof showToast === 'function') {
            showToast(`${userData.name}님, 로그인되었습니다.`);
          }
        }
      } else {
        // 신규 회원: 문서 생성
        const now = new Date().toISOString();
        // 최초 로그인 시에는 오늘 날짜로 설정 (3개월 연장은 사용자 정보 입력 완료 후 적용)
        const todayDate = new Date().toISOString().split('T')[0];
        
        const newUserData = {
          id: result.user.uid,
          name: result.user.displayName || result.user.email?.split('@')[0] || '사용자',
          contact: '',
          ftp: 0,
          weight: 0,
          created_at: now,
          grade: '2',
          expiry_date: todayDate, // 최초 로그인 시 오늘 날짜로 설정
          challenge: 'Fitness',
          acc_points: 0,
          rem_points: 0,
          last_training_date: '',
          strava_access_token: '',
          strava_refresh_token: '',
          strava_expires_at: 0,
          lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await userDocRef.set(newUserData);
        
        window.currentUser = newUserData;
        localStorage.setItem('currentUser', JSON.stringify(newUserData));
        localStorage.setItem('authUser', JSON.stringify(newUserData));
        
        if (typeof loadUsers === 'function') {
          await loadUsers();
        }
        if (typeof syncUsersFromDB === 'function') {
          await syncUsersFromDB();
        }
        
        // 로그인 성공 플래그 설정
        isLoginJustCompleted = true;
        
        // 신규 회원은 항상 필수 정보 입력 필요 (베이스캠프로 이동하지 않음)
        setTimeout(() => {
          showCompleteUserInfoModal(newUserData);
        }, 500);
      }
    }
  }).catch((error) => {
    console.error('❌ 리다이렉트 로그인 결과 처리 실패:', error);
  });

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
          
          // 사용자 목록 동기화 (로그인 후)
          if (typeof syncUsersFromDB === 'function') {
            try {
              await syncUsersFromDB();
            } catch (syncError) {
              console.warn('⚠️ 사용자 목록 동기화 실패 (무시):', syncError.message);
            }
          }
          if (typeof loadUsers === 'function') {
            try {
              await loadUsers();
            } catch (loadError) {
              console.warn('⚠️ 사용자 목록 로드 실패 (무시):', loadError.message);
            }
          }
          
          // 로그인 성공 후에만 모달 표시 (페이지 로드 시에는 표시하지 않음)
          // isLoginJustCompleted 플래그가 true일 때만 모달 표시
          if (isLoginJustCompleted) {
            const hasContact = userData.contact && userData.contact.trim() !== '';
            const hasFTP = userData.ftp && userData.ftp > 0;
            const hasWeight = userData.weight && userData.weight > 0;
            const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
            
            const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasChallenge;
            
            if (needsInfo) {
              // 필수 정보가 없으면 사용자 정보 완성 모달 표시 (베이스캠프로 이동하지 않음)
              setTimeout(() => {
                showCompleteUserInfoModal(userData);
              }, 500);
            } else {
              // 필수 정보가 모두 있으면 베이스캠프 화면으로 이동
              if (typeof showScreen === 'function') {
                showScreen('basecampScreen');
              }
            }
            
            // 플래그 리셋 (한 번만 실행되도록)
            isLoginJustCompleted = false;
          } else {
            // 페이지 로드 시 인증 상태 복원인 경우: 화면만 전환 (모달 표시하지 않음)
            const hasContact = userData.contact && userData.contact.trim() !== '';
            const hasFTP = userData.ftp && userData.ftp > 0;
            const hasWeight = userData.weight && userData.weight > 0;
            const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
            
            const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasChallenge;
            
            if (!needsInfo) {
              // 필수 정보가 모두 있으면 베이스캠프 화면으로 이동
              if (typeof showScreen === 'function') {
                showScreen('basecampScreen');
              }
            }
            // needsInfo가 true여도 페이지 로드 시에는 모달을 표시하지 않음
          }
        } else {
          // 사용자 문서가 없는 경우: signInWithGoogle에서 생성되어야 함
          // 여기서는 로그아웃하지 않고 경고만 표시
          console.warn('⚠️ Firestore에 사용자 문서가 없습니다. 로그인 시 자동 생성됩니다.');
          // signInWithGoogle에서 문서를 생성하므로 여기서는 대기
        }
      } catch (error) {
        console.error('❌ 사용자 정보 로드 실패:', error);
        // 권한 오류인 경우에도 로그아웃하지 않음 (Firestore 규칙 설정 문제일 수 있음)
        if (error.code === 'permission-denied') {
          console.error('🔴 Firestore 권한 오류: FIRESTORE_RULES.txt 파일의 규칙을 설정하세요.');
          console.error('📖 FIREBASE_SETUP_GUIDE.md 파일을 참고하여 보안 규칙을 설정해주세요.');
        }
      }
    } else {
      // 로그아웃 상태: 전역 상태 초기화
      window.currentUser = null;
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authUser');
      isLoginJustCompleted = false; // 플래그도 리셋
      console.log('ℹ️ 로그아웃 상태');
    }
  });
}

// 페이지 로드 시 인증 상태 리스너 초기화
if (typeof window !== 'undefined' && window.auth) {
  initAuthStateListener();
  // initAuthStateListener() 내부에 이미 onAuthStateChanged가 있으므로 여기서는 추가하지 않음
}

// ========== Firestore API 함수들 (기존 Google Sheets API 호환) ==========

/**
 * 모든 사용자 목록 조회
 * @returns {Promise<{success: boolean, items?: array, error?: string}>}
 */
async function apiGetUsers() {
  try {
    // 로그인 상태 확인
    const currentUser = window.auth?.currentUser;
    if (!currentUser) {
      // 로그인하지 않은 경우 조용히 빈 배열 반환 (경고 메시지 제거)
      return { success: true, items: [] };
    }
    
    // 현재 사용자의 문서를 먼저 조회하여 권한 확인
    let currentUserDoc;
    try {
      currentUserDoc = await getUsersCollection().doc(currentUser.uid).get();
    } catch (docError) {
      // 문서 조회 실패 시 권한 오류일 수 있음
      if (docError.code === 'permission-denied') {
        console.error('🔴 Firestore 권한 오류가 발생했습니다.');
        console.error('📖 확인 사항:');
        console.error('   1. Firebase 콘솔 → Firestore Database → Rules에서 규칙이 올바르게 게시되었는지 확인');
        console.error('   2. FIRESTORE_RULES.txt 파일의 규칙과 일치하는지 확인');
        console.error('   3. 규칙 게시 후 몇 분 정도 기다린 후 다시 시도');
        console.error('   4. 브라우저 캐시를 지우고 다시 시도');
        // 권한 오류가 발생해도 빈 배열 반환하여 앱이 계속 작동하도록 함
        return { success: true, items: [] };
      }
      // 다른 오류인 경우에도 빈 배열 반환 (앱 안정성)
      console.warn('⚠️ 사용자 문서 조회 실패:', docError.message);
      return { success: true, items: [] };
    }
    
    if (!currentUserDoc.exists) {
      // 사용자 문서가 없으면 빈 배열 반환 (문서는 로그인 시 생성됨)
      console.warn('⚠️ 현재 사용자 문서가 아직 생성되지 않았습니다.');
      return { success: true, items: [] };
    }
    
    const currentUserData = currentUserDoc.data();
    const userGrade = currentUserData?.grade || '2';
    
    // 관리자(grade='1')인 경우에만 전체 목록 조회
    if (userGrade === '1') {
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
      } catch (listError) {
        // 전체 목록 조회 실패 시 자신의 문서만 반환
        console.warn('⚠️ 전체 사용자 목록 조회 실패, 자신의 문서만 반환:', listError.message);
        return { 
          success: true, 
          items: [{
            id: currentUser.uid,
            ...currentUserData
          }]
        };
      }
    } else {
      // 일반 사용자는 자신의 문서만 반환
      return { 
        success: true, 
        items: [{
          id: currentUser.uid,
          ...currentUserData
        }]
      };
    }
  } catch (error) {
    console.error('❌ 사용자 목록 조회 실패:', error);
    
    // 권한 오류인 경우 상세 안내
    if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
      console.error('🔴 Firestore 보안 규칙이 설정되지 않았습니다!');
      console.error('📖 해결 방법: FIREBASE_SETUP_GUIDE.md 파일을 참고하세요.');
      console.error('   1. Firebase 콘솔 → Firestore Database → Rules');
      console.error('   2. FIRESTORE_RULES.txt 파일의 규칙을 복사하여 붙여넣으세요');
      console.error('   3. 보안 규칙을 설정하고 게시하세요');
    }
    
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

    // 권한에 따른 사용자 목록 필터링
    let visibleUsers = users;
    if (viewerGrade === '1') {
      // 관리자(grade=1): 모든 사용자 보기
      visibleUsers = users;
    } else if (viewerGrade === '2' || viewerGrade === '3') {
      // 일반 사용자(grade=2,3): 본인 계정만 보기
      if (viewerId) {
        visibleUsers = users.filter(u => String(u.id) === viewerId);
      } else {
        visibleUsers = [];
      }
    }

    visibleUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    // 수정 권한 체크 함수
    const canEditFor = (u) => {
      if (viewerGrade === '1') {
        // 관리자: 모든 사용자 수정 가능
        return true;
      } else if (viewerGrade === '2' || viewerGrade === '3') {
        // 일반 사용자: 본인 계정만 수정 가능
        return viewerId && String(u.id) === viewerId;
      }
      return false;
    };
    
    // 삭제 권한 체크 함수
    const canDeleteFor = (u) => {
      if (viewerGrade === '1') {
        // 관리자: 모든 사용자 삭제 가능
        return true;
      } else {
        // 일반 사용자(grade=2,3): 삭제 권한 없음
        return false;
      }
    };

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
      const canDelete = canDeleteFor(user);
      const deleteButtonDisabled = !canDelete ? 'disabled' : '';
      const deleteButtonClass = !canDelete ? 'disabled' : '';

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
        <div class="user-card" data-user-id="${user.id}" onclick="selectUser('${user.id}')" style="cursor: pointer;">
          <div class="user-header">
            <div class="user-name"><img src="assets/img/${challengeImage}" alt="" class="user-name-icon"> ${user.name}</div>
            <div class="user-actions" onclick="event.stopPropagation();">
              ${canEdit ? `
                <button class="btn-edit"   onclick="editUser('${user.id}')"   title="수정">✏️</button>
                <button class="btn-delete ${deleteButtonClass}" onclick="deleteUser('${user.id}')" title="삭제" ${deleteButtonDisabled}>🗑️</button>
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
  
  // 관리자 전용 필드 표시/숨김 처리
  const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
  const isAdmin = (viewerGrade === '1');
  const adminFieldsSection = document.getElementById('adminFieldsSection');
  if (adminFieldsSection) {
    adminFieldsSection.style.display = isAdmin ? 'block' : 'none';
  }
  
  if (clearForm) {
    // 기본 필드 초기화
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
    
    // 관리자 전용 필드 초기화
    if (isAdmin) {
      const gradeEl = document.getElementById('userGrade');
      const expiryEl = document.getElementById('userExpiryDate');
      const accPointsEl = document.getElementById('userAccPoints');
      const remPointsEl = document.getElementById('userRemPoints');
      const lastTrainingDateEl = document.getElementById('userLastTrainingDate');
      const stravaAccessTokenEl = document.getElementById('userStravaAccessToken');
      const stravaRefreshTokenEl = document.getElementById('userStravaRefreshToken');
      const stravaExpiresAtEl = document.getElementById('userStravaExpiresAt');
      
      if (gradeEl) gradeEl.value = '2';
      if (expiryEl) {
        // 기본값: 오늘 + 3개월
        const defaultDate = new Date();
        defaultDate.setMonth(defaultDate.getMonth() + 3);
        expiryEl.value = defaultDate.toISOString().split('T')[0];
      }
      if (accPointsEl) accPointsEl.value = '';
      if (remPointsEl) remPointsEl.value = '';
      if (lastTrainingDateEl) lastTrainingDateEl.value = '';
      if (stravaAccessTokenEl) stravaAccessTokenEl.value = '';
      if (stravaRefreshTokenEl) stravaRefreshTokenEl.value = '';
      if (stravaExpiresAtEl) stravaExpiresAtEl.value = '';
    }
  }
  
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

  // 기본 필수 필드
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
    // 기본 사용자 데이터
    const userData = { 
      name, 
      contact: contactDB, 
      ftp, 
      weight, 
      challenge 
    };

    // 관리자 전용 필드 (관리자인 경우에만 포함)
    const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
    if (viewerGrade === '1') {
      const gradeEl = document.getElementById('userGrade');
      const expiryEl = document.getElementById('userExpiryDate');
      const accPointsEl = document.getElementById('userAccPoints');
      const remPointsEl = document.getElementById('userRemPoints');
      const lastTrainingDateEl = document.getElementById('userLastTrainingDate');
      const stravaAccessTokenEl = document.getElementById('userStravaAccessToken');
      const stravaRefreshTokenEl = document.getElementById('userStravaRefreshToken');
      const stravaExpiresAtEl = document.getElementById('userStravaExpiresAt');

      if (gradeEl) userData.grade = String(gradeEl.value || '2');
      if (expiryEl && expiryEl.value) userData.expiry_date = expiryEl.value;
      if (accPointsEl && accPointsEl.value) userData.acc_points = parseFloat(accPointsEl.value) || 0;
      if (remPointsEl && remPointsEl.value) userData.rem_points = parseFloat(remPointsEl.value) || 0;
      if (lastTrainingDateEl && lastTrainingDateEl.value) userData.last_training_date = lastTrainingDateEl.value;
      if (stravaAccessTokenEl) userData.strava_access_token = stravaAccessTokenEl.value.trim() || '';
      if (stravaRefreshTokenEl) userData.strava_refresh_token = stravaRefreshTokenEl.value.trim() || '';
      if (stravaExpiresAtEl && stravaExpiresAtEl.value) userData.strava_expires_at = parseInt(stravaExpiresAtEl.value) || 0;
    } else {
      // 일반 사용자는 기본값 사용
      userData.grade = '2';
    }

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

async function editUser(userId) {
  try {
    // 권한 체크
    let viewer = null, authUser = null;
    try { viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
    try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}
    
    const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
    const isTempAdmin = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
    const viewerGrade = isTempAdmin
      ? '1'
      : (typeof getViewerGrade === 'function'
          ? String(getViewerGrade())
          : String(mergedViewer?.grade ?? '2'));
    const viewerId = (mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null;
    
    // 권한 확인: 관리자는 모든 사용자 수정 가능, 일반 사용자는 본인만 수정 가능
    if (viewerGrade !== '1' && (!viewerId || String(userId) !== viewerId)) {
      showToast('본인 계정만 수정할 수 있습니다.', 'warning');
      return;
    }
    
    const result = await apiGetUser(userId);
    
    if (!result.success) {
      showToast('사용자 정보를 불러올 수 없습니다.');
      return;
    }

    const user = result.item;
    
    isEditMode = true;
    currentEditUserId = userId;
    console.log('Edit mode activated for user:', userId);
    
    // 모달 표시
    const modal = document.getElementById('editUserModal');
    if (!modal) {
      console.error('editUserModal을 찾을 수 없습니다.');
      showToast('수정 화면을 불러올 수 없습니다.');
      return;
    }
    
    // 모달 제목 설정
    const modalTitle = document.getElementById('editUserModalTitle');
    if (modalTitle) {
      modalTitle.textContent = `${user.name || '사용자'} 정보 수정`;
    }
    
    // 관리자 전용 필드 섹션 표시/숨김 처리
    const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
    const isAdmin = (viewerGrade === '1');
    const adminFieldsSection = document.getElementById('editAdminFieldsSection');
    if (adminFieldsSection) {
      adminFieldsSection.style.display = isAdmin ? 'block' : 'none';
    }
    
    // 폼 데이터 채우기
    const fillFormData = () => {
      // 기본 필드
      const nameEl = document.getElementById('editUserName');
      const contactEl = document.getElementById('editUserContact');
      const ftpEl = document.getElementById('editUserFTP');
      const weightEl = document.getElementById('editUserWeight');
      const challengeSelect = document.getElementById('editUserChallenge');
      
      // 관리자 전용 필드
      const gradeEl = document.getElementById('editUserGrade');
      const expiryEl = document.getElementById('editUserExpiryDate');
      const accPointsEl = document.getElementById('editUserAccPoints');
      const remPointsEl = document.getElementById('editUserRemPoints');
      const lastTrainingDateEl = document.getElementById('editUserLastTrainingDate');
      const stravaAccessTokenEl = document.getElementById('editUserStravaAccessToken');
      const stravaRefreshTokenEl = document.getElementById('editUserStravaRefreshToken');
      const stravaExpiresAtEl = document.getElementById('editUserStravaExpiresAt');
      
      if (nameEl) nameEl.value = user.name || '';
      if (contactEl) {
        // 전화번호는 숫자만 추출하여 포맷팅
        const phoneNumbers = unformatPhone(user.contact || '');
        contactEl.value = phoneNumbers;
        // 자동 포맷팅 적용
        if (typeof autoFormatPhoneNumber === 'function') {
          autoFormatPhoneNumber(contactEl);
        }
      }
      if (ftpEl) ftpEl.value = user.ftp || '';
      if (weightEl) weightEl.value = user.weight || '';
      if (challengeSelect) challengeSelect.value = user.challenge || 'Fitness';
      
      // 관리자 전용 필드
      if (gradeEl) gradeEl.value = String(user.grade || '2');
      if (expiryEl && user.expiry_date) {
        expiryEl.value = user.expiry_date.substring(0, 10);
      }
      if (accPointsEl) accPointsEl.value = user.acc_points || '';
      if (remPointsEl) remPointsEl.value = user.rem_points || '';
      if (lastTrainingDateEl && user.last_training_date) {
        lastTrainingDateEl.value = user.last_training_date.substring(0, 10);
      }
      if (stravaAccessTokenEl) stravaAccessTokenEl.value = user.strava_access_token || '';
      if (stravaRefreshTokenEl) stravaRefreshTokenEl.value = user.strava_refresh_token || '';
      if (stravaExpiresAtEl) stravaExpiresAtEl.value = user.strava_expires_at || '';
    };
    
    fillFormData();
    
    // 모달 표시
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
    
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    showToast('사용자 정보 로드 중 오류가 발생했습니다.');
  }
}

// 모달 닫기 함수
function closeEditUserModal() {
  const modal = document.getElementById('editUserModal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = ''; // 배경 스크롤 복원
  }
  
  isEditMode = false;
  currentEditUserId = null;
}

// 모달에서 업데이트 수행
async function performUpdateFromModal() {
  if (!isEditMode || !currentEditUserId) {
    console.error('Invalid edit mode state');
    return;
  }

  // 권한 체크
  let viewer = null, authUser = null;
  try { viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
  try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}
  
  const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
  const isTempAdmin = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
  const viewerGrade = isTempAdmin
    ? '1'
    : (typeof getViewerGrade === 'function'
        ? String(getViewerGrade())
        : String(mergedViewer?.grade ?? '2'));
  const viewerId = (mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null;
  
  // 권한 확인: 관리자는 모든 사용자 수정 가능, 일반 사용자는 본인만 수정 가능
  if (viewerGrade !== '1' && (!viewerId || String(currentEditUserId) !== viewerId)) {
    showToast('본인 계정만 수정할 수 있습니다.', 'warning');
    return;
  }

  // 기본 필수 필드
  const name = document.getElementById('editUserName')?.value.trim();
  const contactRaw = document.getElementById('editUserContact')?.value.trim();
  const contactDB  = formatPhoneForDB(contactRaw);
  const ftp = parseInt(document.getElementById('editUserFTP')?.value);
  const weight = parseFloat(document.getElementById('editUserWeight')?.value);
  const challenge = document.getElementById('editUserChallenge')?.value || 'Fitness';

  if (!name || !ftp || !weight) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    // 기본 사용자 데이터
    const userData = {
      name,
      contact: contactDB,
      ftp,
      challenge,
      weight
    };

    // 관리자 전용 필드 업데이트
    const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
    if (viewerGrade === '1') {
      const gradeEl = document.getElementById('editUserGrade');
      const expiryEl = document.getElementById('editUserExpiryDate');
      const accPointsEl = document.getElementById('editUserAccPoints');
      const remPointsEl = document.getElementById('editUserRemPoints');
      const lastTrainingDateEl = document.getElementById('editUserLastTrainingDate');
      const stravaAccessTokenEl = document.getElementById('editUserStravaAccessToken');
      const stravaRefreshTokenEl = document.getElementById('editUserStravaRefreshToken');
      const stravaExpiresAtEl = document.getElementById('editUserStravaExpiresAt');
      
      if (gradeEl) userData.grade = String(gradeEl.value || '2');
      if (expiryEl && expiryEl.value) userData.expiry_date = expiryEl.value;
      if (accPointsEl && accPointsEl.value !== '') userData.acc_points = parseFloat(accPointsEl.value) || 0;
      if (remPointsEl && remPointsEl.value !== '') userData.rem_points = parseFloat(remPointsEl.value) || 0;
      if (lastTrainingDateEl && lastTrainingDateEl.value) userData.last_training_date = lastTrainingDateEl.value;
      if (stravaAccessTokenEl) userData.strava_access_token = stravaAccessTokenEl.value.trim() || '';
      if (stravaRefreshTokenEl) userData.strava_refresh_token = stravaRefreshTokenEl.value.trim() || '';
      if (stravaExpiresAtEl && stravaExpiresAtEl.value) userData.strava_expires_at = parseInt(stravaExpiresAtEl.value) || 0;
    }

    const result = await apiUpdateUser(currentEditUserId, userData);

    if (result.success) {
      showToast('사용자 정보가 수정되었습니다.');
      closeEditUserModal();
      loadUsers();
    } else {
      showToast('사용자 수정 실패: ' + result.error);
    }

  } catch (error) {
    console.error('사용자 업데이트 실패:', error);
    showToast('사용자 수정 중 오류가 발생했습니다.');
  }
}

// 사용자 정보 완성 모달 표시
function showCompleteUserInfoModal(userData) {
  // 중복 호출 방지
  if (isCompleteUserInfoModalShown) {
    console.log('⚠️ 사용자 정보 입력 모달이 이미 표시되어 있습니다. 중복 호출 무시.');
    return;
  }
  
  const modal = document.getElementById('completeUserInfoModal');
  if (!modal) {
    console.error('completeUserInfoModal을 찾을 수 없습니다.');
    return;
  }
  
  // 모달이 이미 표시되어 있는지 확인
  const isAlreadyVisible = !modal.classList.contains('hidden') && 
                           window.getComputedStyle(modal).display !== 'none';
  if (isAlreadyVisible) {
    console.log('⚠️ 사용자 정보 입력 모달이 이미 표시되어 있습니다.');
    return;
  }
  
  // 플래그 설정
  isCompleteUserInfoModalShown = true;
  
  // 모든 화면 숨기기
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.setProperty('display', 'none', 'important');
    screen.style.setProperty('opacity', '0', 'important');
    screen.style.setProperty('visibility', 'hidden', 'important');
    screen.style.setProperty('z-index', '1', 'important');
  });
  
  // 로그인 화면 숨기기
  const authScreen = document.getElementById('authScreen');
  if (authScreen) {
    authScreen.classList.remove('active');
    authScreen.style.setProperty('display', 'none', 'important');
    authScreen.style.setProperty('opacity', '0', 'important');
    authScreen.style.setProperty('visibility', 'hidden', 'important');
  }
  
  // 기존 값이 있으면 채우기
  const contactEl = document.getElementById('completeUserContact');
  const ftpEl = document.getElementById('completeUserFTP');
  const weightEl = document.getElementById('completeUserWeight');
  const challengeEl = document.getElementById('completeUserChallenge');
  
  // 필드 초기화
  if (contactEl) {
    contactEl.value = userData.contact || '';
    if (userData.contact && typeof autoFormatPhoneNumber === 'function') {
      autoFormatPhoneNumber(contactEl);
    }
  }
  if (ftpEl) ftpEl.value = userData.ftp || '';
  if (weightEl) weightEl.value = userData.weight || '';
  if (challengeEl) challengeEl.value = userData.challenge || 'Fitness';
  
  // 모달을 body의 직접 자식으로 이동 (z-index 문제 방지)
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  
  // 모든 화면 강제로 숨기기
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.setProperty('display', 'none', 'important');
    screen.style.setProperty('opacity', '0', 'important');
    screen.style.setProperty('visibility', 'hidden', 'important');
    screen.style.setProperty('z-index', '1', 'important');
  });
  
  // 모달 표시 (강제로 표시)
  modal.classList.remove('hidden');
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('top', '0', 'important');
  modal.style.setProperty('left', '0', 'important');
  modal.style.setProperty('width', '100%', 'important');
  modal.style.setProperty('height', '100%', 'important');
  modal.style.setProperty('z-index', '10001', 'important');
  modal.style.setProperty('background', 'rgba(0, 0, 0, 0.5)', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');
  modal.style.setProperty('pointer-events', 'auto', 'important');
  document.body.style.overflow = 'hidden';
  
  // 모달 내용도 확인
  const modalContent = modal.querySelector('.modal-content');
  if (modalContent) {
    modalContent.style.setProperty('position', 'relative', 'important');
    modalContent.style.setProperty('z-index', '10002', 'important');
  }
  
  // requestAnimationFrame으로 모달 표시 확인 및 강제 표시
  requestAnimationFrame(() => {
    const computedStyle = window.getComputedStyle(modal);
    const isVisible = computedStyle.display !== 'none' && 
                     computedStyle.visibility !== 'hidden' &&
                     computedStyle.opacity !== '0';
    
    if (!isVisible) {
      console.warn('⚠️ 모달이 표시되지 않음. 강제로 다시 표시 시도');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('visibility', 'visible', 'important');
      modal.style.setProperty('opacity', '1', 'important');
    }
  });
  
  console.log('✅ 사용자 정보 입력 모달 표시:', {
    hasContact: !!userData.contact,
    hasFTP: !!userData.ftp,
    hasWeight: !!userData.weight,
    hasChallenge: !!userData.challenge,
    modalDisplay: modal.style.display,
    modalZIndex: modal.style.zIndex,
    modalComputedDisplay: window.getComputedStyle(modal).display,
    modalComputedZIndex: window.getComputedStyle(modal).zIndex,
    isModalShown: isCompleteUserInfoModalShown
  });
}

// 사용자 정보 완성 처리
async function completeUserInfo() {
  const currentUser = window.auth?.currentUser;
  if (!currentUser) {
    showToast('로그인 상태를 확인할 수 없습니다.');
    return;
  }
  
  // 필수 필드 확인
  const contactRaw = document.getElementById('completeUserContact')?.value.trim();
  const ftp = parseInt(document.getElementById('completeUserFTP')?.value);
  const weight = parseFloat(document.getElementById('completeUserWeight')?.value);
  const challenge = document.getElementById('completeUserChallenge')?.value;
  
  if (!contactRaw) {
    showToast('전화번호를 입력해주세요.');
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
  if (!challenge) {
    showToast('운동 목적을 선택해주세요.');
    return;
  }
  
  try {
    const contactDB = formatPhoneForDB(contactRaw);
    
    // 3개월 무료 연장 적용 (사용자 정보 입력 완료 시)
    const extendedExpiryDate = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 3); // 오늘 + 3개월
      return d.toISOString().split('T')[0];
    })();
    
    // 사용자 정보 업데이트 (3개월 연장 포함)
    const updateData = {
      contact: contactDB,
      ftp: ftp,
      weight: weight,
      challenge: challenge,
      expiry_date: extendedExpiryDate // 3개월 무료 연장 적용
    };
    
    const result = await apiUpdateUser(currentUser.uid, updateData);
    
    if (result.success) {
      // 전역 상태 업데이트
      if (window.currentUser) {
        window.currentUser = { ...window.currentUser, ...updateData };
        localStorage.setItem('currentUser', JSON.stringify(window.currentUser));
        localStorage.setItem('authUser', JSON.stringify(window.currentUser));
      }
      
      // 모달 닫기
      const modal = document.getElementById('completeUserInfoModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.setProperty('display', 'none', 'important');
        document.body.style.overflow = '';
      }
      
      // 플래그 리셋
      isCompleteUserInfoModalShown = false;
      
      // 사용자 목록 새로고침
      if (typeof loadUsers === 'function') {
        await loadUsers();
      }
      
      // 환영 오버레이 표시 (백만킬로 아카데미 특별이벤트)
      setTimeout(() => {
        if (typeof showUserWelcomeModal === 'function') {
          showUserWelcomeModal(window.currentUser?.name || '사용자');
        } else {
          showToast('정보 입력이 완료되었습니다! 🎉');
        }
      }, 300); // 모달 닫힌 후 약간의 지연
      
      // 사용자 정보 입력 완료 후 베이스캠프 화면으로 이동
      setTimeout(() => {
        if (typeof showScreen === 'function') {
          showScreen('basecampScreen');
        }
      }, 100); // 환영 오버레이 표시 전에 베이스캠프로 이동
    } else {
      showToast('정보 저장 실패: ' + result.error);
    }
  } catch (error) {
    console.error('사용자 정보 완성 실패:', error);
    showToast('정보 저장 중 오류가 발생했습니다.');
  }
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.closeEditUserModal = closeEditUserModal;
  window.performUpdateFromModal = performUpdateFromModal;
  window.showCompleteUserInfoModal = showCompleteUserInfoModal;
  window.completeUserInfo = completeUserInfo;
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

    // 관리자 전용 필드 업데이트
    const viewerGrade = (typeof getViewerGrade === 'function' ? getViewerGrade() : '2');
    if (viewerGrade === '1') {
      const gradeEl = document.getElementById('userGrade');
      const expiryEl = document.getElementById('userExpiryDate');
      const accPointsEl = document.getElementById('userAccPoints');
      const remPointsEl = document.getElementById('userRemPoints');
      const lastTrainingDateEl = document.getElementById('userLastTrainingDate');
      const stravaAccessTokenEl = document.getElementById('userStravaAccessToken');
      const stravaRefreshTokenEl = document.getElementById('userStravaRefreshToken');
      const stravaExpiresAtEl = document.getElementById('userStravaExpiresAt');
      
      if (gradeEl) userData.grade = String(gradeEl.value || '2');
      if (expiryEl && expiryEl.value) userData.expiry_date = expiryEl.value;
      if (accPointsEl && accPointsEl.value !== '') userData.acc_points = parseFloat(accPointsEl.value) || 0;
      if (remPointsEl && remPointsEl.value !== '') userData.rem_points = parseFloat(remPointsEl.value) || 0;
      if (lastTrainingDateEl && lastTrainingDateEl.value) userData.last_training_date = lastTrainingDateEl.value;
      if (stravaAccessTokenEl) userData.strava_access_token = stravaAccessTokenEl.value.trim() || '';
      if (stravaRefreshTokenEl) userData.strava_refresh_token = stravaRefreshTokenEl.value.trim() || '';
      if (stravaExpiresAtEl && stravaExpiresAtEl.value) userData.strava_expires_at = parseInt(stravaExpiresAtEl.value) || 0;
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
  // 권한 체크
  let viewer = null, authUser = null;
  try { viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
  try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}
  
  const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
  const isTempAdmin = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
  const viewerGrade = isTempAdmin
    ? '1'
    : (typeof getViewerGrade === 'function'
        ? String(getViewerGrade())
        : String(mergedViewer?.grade ?? '2'));
  
  // 관리자(grade=1)만 삭제 가능
  if (viewerGrade !== '1') {
    showToast('삭제 권한이 없습니다. 관리자만 사용자를 삭제할 수 있습니다.', 'warning');
    return;
  }
  
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
      showScreen('basecampScreen');
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
