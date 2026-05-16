
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

/** grade 값이 관리자(1)인지 (문자/숫자/공백 안전) */
function isStelvioAdminGrade(g) {
  if (g === null || g === undefined) return false;
  const s = String(g).trim();
  if (s === '1') return true;
  const n = Number(s);
  return n === 1;
}

/** 베이스캠프 오픈 라이딩방 노출·진입: grade 1 또는 3 (문자/숫자 안전) */
function isStelvioOpenRidingRoomAdminGrade(g) {
  if (g === null || g === undefined) return false;
  const s = String(g).trim();
  if (s === '1' || s === '3') return true;
  const n = Number(s);
  return n === 1 || n === 3;
}

/** 로그인 계정 등급 — 프로필 선택으로 currentUser가 바뀌어도 로그인 UID 기준. authUser.grade는 오래된 값일 수 있어 users 목록(Firestore 동기화)을 최우선 */
function getLoginUserGrade() {
  try {
    if (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true) return '1';

    const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');

    var uid = null;
    try {
      if (window.auth && window.auth.currentUser && window.auth.currentUser.uid) {
        uid = String(window.auth.currentUser.uid);
      } else if (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) {
        uid = String(window.authV9.currentUser.uid);
      }
    } catch (e) {}
    if (!uid && authUser && authUser.id != null) uid = String(authUser.id);

    function gradeFromUserList(arr) {
      if (!uid || !Array.isArray(arr)) return null;
      const hit = arr.find(function (u) {
        if (!u || u.id == null) return false;
        return String(u.id) === uid || u.id === uid;
      });
      return hit && hit.grade != null ? String(hit.grade) : null;
    }

    var fromList = gradeFromUserList(window.users);
    if (fromList != null) return fromList;
    fromList = gradeFromUserList(window.userProfiles);
    if (fromList != null) return fromList;

    if (authUser && authUser.grade != null) return String(authUser.grade);

    try {
      const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (uid && viewer && String(viewer.id) === uid && viewer.grade != null) {
        return String(viewer.grade);
      }
    } catch (e) {}
  } catch (e) {}
  return typeof getViewerGrade === 'function' ? String(getViewerGrade()) : '2';
}
if (typeof window !== 'undefined') {
  window.getLoginUserGrade = getLoginUserGrade;
  window.isStelvioAdminGrade = isStelvioAdminGrade;
  window.isStelvioOpenRidingRoomAdminGrade = isStelvioOpenRidingRoomAdminGrade;
}

/** F12 콘솔 STELVIO 시스템·접속 상세 로그: grade=1(관리자)만 true (__TEMP_ADMIN_OVERRIDE__ 포함) */
function isStelvioSysConsoleAdmin() {
  try {
    if (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true) return true;
    var g =
      typeof getLoginUserGrade === 'function'
        ? getLoginUserGrade()
        : typeof getViewerGrade === 'function'
          ? getViewerGrade()
          : '2';
    return isStelvioAdminGrade(g);
  } catch (e) {
    return false;
  }
}
if (typeof window !== 'undefined') {
  window.isStelvioSysConsoleAdmin = isStelvioSysConsoleAdmin;
}

/**
 * 일반 사용자에게는 STELVIO 흐름 추적용 console.log/info/debug/warn 출력을 숨김 (관리자만 통과).
 * console.error는 유지 — 장애 대응용.
 */
function installStelvioNonAdminConsoleFilter() {
  if (typeof window === 'undefined' || window.__STELVIO_CONSOLE_FILTER_INSTALLED__) return;
  window.__STELVIO_CONSOLE_FILTER_INSTALLED__ = true;
  var c = window.console;
  if (!c || typeof c.log !== 'function') return;
  var origLog = c.log.bind(c);
  var origInfo = typeof c.info === 'function' ? c.info.bind(c) : origLog;
  var origDebug = typeof c.debug === 'function' ? c.debug.bind(c) : origLog;
  var origWarn = typeof c.warn === 'function' ? c.warn.bind(c) : null;
  var patterns = [
    /\[MiniCalendarJournal\]/i,
    /\[MiniCalendar\]/i,
    /\[Journal Step\]/i,
    /\[AI\]/i,
    /\[Dashboard\]/i,
    /\[Auth Guard\]/i,
    /\[Login\]/i,
    /\[Logout\]/i,
    /\[showScreen\]/i,
    /Firebase v9/i,
    /Strava 설정 Firestore/i,
    /\[Strava\]/i,
    /스플래시 화면 즉시 보호/i,
    /\[deviceConnected 수신\]/i,
    /🔐 로그인/i,
    /✅ 로그인 성공/i,
    /화면 전환/i,
    /사용자 목록 DB 동기화/i,
    /⚠️ 전화번호로 사용자를 찾지 못함/i,
    /📝 회원가입/i,
    /✅ Firebase Authentication/i,
    /✅ Firestore users/i,
    /\[Training\]/i,
    /\[StelvioWakeLock\]/i,
    /StelvioWakeLock bridge/i,
    /\[trainingDashboardBridge\]/i,
    /\[Mobile Debug\]/i,
    /\[BluetoothIndividual\].*Stelvio/i,
    /\[Laptop Training\].*Stelvio/i,
    /\[Firebase 확인\]/i,
    /stelvio-auth-ready/i,
    /훈련 결과 저장 서비스 로드/i,
    /✅ 훈련일지 화면용 미니 달력|✅ 월간 훈련 이력 미니 달력/i,
    /현재 앱 환경이 아닙니다/i,
    /비밀번호 재설정 전송 기능이 제거/i,
    /\[deviceSettings\]/i,
    /fetchAndProcessStravaData/i,
    /\[App Download\]/i,
    /\[drawSegmentGraph\]/i,
    /\[getSegmentRpmForPreview\]/i,
    /\[updateTargetPower\]/i,
    /\[updateSpeedometerSegmentInfo\]/i,
    /\[BluetoothIndividual\] ✅ 사용자 이름 실시간 업데이트/i,
    /\[getCurrentSegment\]/i,
    /\[현재 세그먼트 정보\]/i,
    /\[updateSpeedometerTargetForSegment\]/i
  ];
  function shouldSuppress(args) {
    if (typeof window.isStelvioSysConsoleAdmin === 'function' && window.isStelvioSysConsoleAdmin()) return false;
    var s = '';
    var i;
    for (i = 0; i < Math.min(args.length, 4); i++) {
      try {
        if (typeof args[i] === 'string') s += args[i];
        else if (args[i] != null && typeof args[i] === 'object') s += JSON.stringify(args[i]).slice(0, 800);
        else s += String(args[i]);
      } catch (e) {}
      s += ' ';
    }
    var j;
    for (j = 0; j < patterns.length; j++) {
      if (patterns[j].test(s)) return true;
    }
    return false;
  }
  c.log = function () {
    if (shouldSuppress(arguments)) return;
    return origLog.apply(c, arguments);
  };
  c.info = function () {
    if (shouldSuppress(arguments)) return;
    return origInfo.apply(c, arguments);
  };
  c.debug = function () {
    if (shouldSuppress(arguments)) return;
    return origDebug.apply(c, arguments);
  };
  if (origWarn) {
    c.warn = function () {
      if (shouldSuppress(arguments)) return;
      return origWarn.apply(c, arguments);
    };
  }
}
installStelvioNonAdminConsoleFilter();

/* ==========================================================
   FTP 최소값: 몸무게의 1.8배 (사용자 등록 시)
   - 최소값 = Math.round(weight * 1.8)
   - 디폴트: 몸무게 입력 시 FTP에 1.8배 자동 입력
   - 최소입력값 사용 시 확인 메시지 표시
============================================================ */
function getFtpMinFromWeight(weight) {
  const w = parseFloat(weight);
  if (!w || w <= 0) return 50;
  return Math.max(50, Math.round(w * 1.8));
}
function syncFtpFromWeight(ftpId, weightId) {
  const ftpEl = document.getElementById(ftpId);
  const weightEl = document.getElementById(weightId);
  if (!ftpEl || !weightEl) return;
  const w = parseFloat(weightEl.value);
  if (!w || w <= 0) return;
  const minFtp = getFtpMinFromWeight(w);
  ftpEl.setAttribute('min', String(minFtp));
  if (!ftpEl.value || parseInt(ftpEl.value) < minFtp) {
    ftpEl.value = String(minFtp);
  }
}
function applyFtpMinFromWeight(ftp, weight) {
  const minFtp = getFtpMinFromWeight(weight);
  if (ftp < minFtp) return { ftp: minFtp, usedMin: true };
  return { ftp: ftp, usedMin: false };
}
if (typeof window !== 'undefined') {
  window.getFtpMinFromWeight = getFtpMinFromWeight;
  window.syncFtpFromWeight = syncFtpFromWeight;
  window.applyFtpMinFromWeight = applyFtpMinFromWeight;
}

/* ==========================================================
   사용자 관리 모듈 (userManager.js)
   - Firebase Authentication (Google Login) + Firestore 연동
   - 기존 Google Sheets 필드 구조 완벽 유지
========================================================== */

// 포인트 포맷팅 유틸리티 (정수, 1000 이상은 k 형식)
function formatPoints(points) {
  const num = Math.round(Number(points) || 0);
  if (num >= 1000) {
    const k = num / 1000;
    return k % 1 === 0 ? k + 'k' : k.toFixed(1) + 'k';
  }
  return num.toString();
}

// expiry_date를 "YYYY-MM-DD" 형식으로 정규화하는 헬퍼 함수
function normalizeExpiryDate(dateValue) {
  if (!dateValue) return '';
  
  // 이미 "YYYY-MM-DD" 형식의 문자열인 경우
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  
  // Date 객체인 경우
  if (dateValue instanceof Date) {
    return dateValue.toISOString().split('T')[0];
  }
  
  // Firestore Timestamp인 경우
  if (dateValue && typeof dateValue === 'object' && dateValue.toDate) {
    return dateValue.toDate().toISOString().split('T')[0];
  }
  
  // seconds 필드가 있는 경우 (Timestamp 객체)
  if (dateValue && typeof dateValue === 'object' && dateValue.seconds) {
    return new Date(dateValue.seconds * 1000).toISOString().split('T')[0];
  }
  
  // 문자열인 경우 Date로 파싱 시도
  if (typeof dateValue === 'string') {
    try {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      // "YYYY-MM-DD" 형식이 아닌 경우 첫 10자리만 추출
      if (dateValue.length >= 10) {
        return dateValue.substring(0, 10);
      }
    } catch (e) {
      console.warn('[normalizeExpiryDate] 날짜 파싱 실패:', dateValue, e);
    }
  }
  
  // 변환 실패 시 빈 문자열 반환
  console.warn('[normalizeExpiryDate] 알 수 없는 날짜 형식:', dateValue);
  return '';
}

// Firestore users 컬렉션 참조
// v9 Modular SDK와 v8 Compat SDK 모두 지원
// 주의: v9 Modular SDK는 authV9와 연결되고, v8 Compat SDK는 auth와 연결됨
function getUsersCollection() {
  // v8 Compat SDK 사용 (기존 코드 호환성 유지)
  if (window.firestore) {
    return window.firestore.collection('users');
  }
  
  throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
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
    
    var rawData = userDoc.data() || {};
    const userData = rawData;
    
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
    // 이미 만료된 사용자: 오늘 기준 + addDays 적용. 미만료: 기존 만료일 + addDays
    let newExpiryDate = expiryDate;
    if (addDays > 0) {
      try {
        let baseDate;
        if (expiryDate) {
          const expiry = new Date(expiryDate);
          expiry.setHours(0, 0, 0, 0);
          const todayStart = new Date(today);
          todayStart.setHours(0, 0, 0, 0);
          baseDate = expiry.getTime() < todayStart.getTime()
            ? new Date(today.getTime())   // 만료됐으면 오늘 기준
            : new Date(expiry.getTime()); // 미만료면 기존 만료일 기준
        } else {
          baseDate = new Date(today.getTime()); // 만료일 없으면 오늘 기준
        }
        baseDate.setDate(baseDate.getDate() + addDays);
        newExpiryDate = baseDate.toISOString().split('T')[0]; // YYYY-MM-DD 형식
        console.log(`[updateUserMileage] 만료일 연장: ${expiryDate || '(없음)'} → ${newExpiryDate} (${addDays}일)`);
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

// 훈련 중인지 여부 (노트북/태블릿 훈련 화면 활성 또는 타이머 동작 중)
function isTrainingInProgress() {
  try {
    const trainingScreen = typeof document !== 'undefined' ? document.getElementById('trainingScreen') : null;
    if (trainingScreen && (trainingScreen.classList.contains('active') || (typeof window.getComputedStyle === 'function' && window.getComputedStyle(trainingScreen).display !== 'none'))) {
      const timerId = (typeof window.trainingState !== 'undefined' && window.trainingState) ? window.trainingState.timerId : null;
      const individualTimer = typeof window.individualTrainingTimerInterval !== 'undefined' ? window.individualTrainingTimerInterval : null;
      if (timerId || individualTimer) return true;
      return true; // 훈련 화면이 활성이면 진행 중으로 간주 (타이머만 믿지 않음)
    }
    const mobileDashboard = typeof document !== 'undefined' ? document.getElementById('mobileDashboardScreen') : null;
    if (mobileDashboard && (mobileDashboard.classList.contains('active') || (typeof window.getComputedStyle === 'function' && window.getComputedStyle(mobileDashboard).display !== 'none'))) {
      if (typeof window.mobileTrainingState !== 'undefined' && window.mobileTrainingState && (window.mobileTrainingState.running || window.mobileTrainingState.started)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// 베이스캠프 화면으로 전환하는 헬퍼 함수
function switchToBasecampScreen() {
  // callback.html에서는 basecampScreen이 없으므로 조용히 종료
  const isCallbackPage = typeof window !== 'undefined' && 
    (window.location.pathname.includes('callback.html') || 
     window.location.href.includes('callback.html'));
  if (isCallbackPage) {
    return; // callback.html에서는 화면 전환 불필요
  }
  // 훈련 중에는 전환하지 않음 (Firebase 토큰 갱신 시 onAuthStateChanged 재호출로 인한 갑작스런 베이스캠프 전환 방지)
  if (typeof isTrainingInProgress === 'function' && isTrainingInProgress()) {
    console.log('🛡️ [Auth] 훈련 진행 중이라 베이스캠프 전환 생략');
    return;
  }
  
  console.log('🔄 베이스캠프 화면으로 전환 시작');
  
  const basecampScreen = document.getElementById('basecampScreen');
  if (!basecampScreen) {
    console.error('❌ basecampScreen 요소를 찾을 수 없습니다');
    return;
  }
  
  // showScreen 함수가 있으면 사용
  if (typeof window.showScreen === 'function') {
    try {
      window.showScreen('basecampScreen');
      // 화면 전환 확인
      setTimeout(() => {
        const isVisible = basecampScreen.classList.contains('active') || 
                         window.getComputedStyle(basecampScreen).display !== 'none';
        if (!isVisible) {
          // showScreen이 작동하지 않으면 조용히 직접 전환 (경고 제거)
          directSwitchToBasecamp();
        } else {
          console.log('✅ 베이스캠프 화면 전환 성공 (showScreen 사용)');
        }
      }, 100);
      return;
    } catch (e) {
      console.error('❌ showScreen 실행 중 오류:', e);
      // 에러 발생 시 직접 전환
      directSwitchToBasecamp();
      return;
    }
  }
  
  // showScreen 함수가 없으면 직접 화면 전환
  directSwitchToBasecamp();
  
  function directSwitchToBasecamp() {
    // 모든 화면 숨기기 (splashScreen 제외)
    document.querySelectorAll('.screen').forEach(screen => {
      if (screen.id !== 'basecampScreen' && screen.id !== 'splashScreen') {
        screen.classList.remove('active');
        screen.style.display = 'none';
        screen.style.opacity = '';
        screen.style.visibility = '';
      }
    });
    
    // 베이스캠프 화면 표시
    basecampScreen.classList.add('active');
    basecampScreen.style.display = 'block';
    basecampScreen.style.opacity = '1';
    basecampScreen.style.visibility = 'visible';
    
    // 스크롤을 맨 위로
    window.scrollTo(0, 0);
    
    console.log('✅ 베이스캠프 화면 직접 표시 완료');
  }
}

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
      
      var docData = userDoc.data() || {};
      const userData = { id: user.uid };
      if (docData && typeof docData === 'object') {
        for (var k in docData) { if (docData.hasOwnProperty(k)) userData[k] = docData[k]; }
      }
      
      // 전역 상태 업데이트
      window.currentUser = userData;
      localStorage.setItem('currentUser', JSON.stringify(userData));
      localStorage.setItem('authUser', JSON.stringify(userData));
      
      // 필수 정보 확인 (전화번호, FTP, 몸무게, 운동목적 중 하나라도 없으면)
      const hasContact = userData.contact && userData.contact.trim() !== '';
      const hasFTP = userData.ftp && userData.ftp > 0;
      const hasWeight = userData.weight && userData.weight > 0;
      const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
      
      const hasBirthYear = userData.birth_year != null || userData.birthYear != null;
      const hasGender = (userData.gender === '남' || userData.gender === '여') || (userData.sex === '남' || userData.sex === '여');
      const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasBirthYear || !hasGender || !hasChallenge;
      
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
      // 최초 로그인 시에는 오늘 날짜로 설정 (6개월 연장은 사용자 정보 입력 완료 후 적용)
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
    /* [SESSION-only] 로그아웃 시 저장 자격 삭제 */
    if (typeof window.clearAuthRememberCredentials === 'function') {
      try { window.clearAuthRememberCredentials(); } catch (eClr) {}
    }
    
    // 관리자 기능 숨기기 (training.js의 함수 호출)
    if (typeof window.hideAdminFeatures === 'function') {
      try {
        window.hideAdminFeatures();
      } catch (e) {
        console.warn('관리자 기능 숨기기 실패 (무시):', e);
      }
    }
    
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
  // window.auth 또는 window.authV9 사용 (v9 모듈러 SDK 지원)
  const auth = window.auth || window.authV9;
  if (!auth) {
    console.warn('Firebase Auth가 초기화되지 않아 인증 상태 리스너를 설정할 수 없습니다.');
    return;
  }

  // 리다이렉트 로그인 결과 처리 (페이지 로드 시) - v9에서는 getRedirectResult가 다를 수 있음
  if (auth.getRedirectResult) {
    auth.getRedirectResult().then(async (result) => {
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
        
        var docData2 = userDoc.data() || {};
        const userData = { id: result.user.uid };
        if (docData2 && typeof docData2 === 'object') {
          for (var k2 in docData2) { if (docData2.hasOwnProperty(k2)) userData[k2] = docData2[k2]; }
        }
        
        // 전역 상태 업데이트
        window.currentUser = userData;
        localStorage.setItem('currentUser', JSON.stringify(userData));
        localStorage.setItem('authUser', JSON.stringify(userData));
        
        // 필수 정보 확인 (전화번호, FTP, 몸무게, 운동목적 중 하나라도 없으면)
        const hasContact = userData.contact && userData.contact.trim() !== '';
        const hasFTP = userData.ftp && userData.ftp > 0;
        const hasWeight = userData.weight && userData.weight > 0;
        const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
        
        const hasBirthYear = userData.birth_year != null || userData.birthYear != null;
        const hasGender = (userData.gender === '남' || userData.gender === '여') || (userData.sex === '남' || userData.sex === '여');
        const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasBirthYear || !hasGender || !hasChallenge;
        
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
        // 최초 로그인 시에는 오늘 날짜로 설정 (6개월 연장은 사용자 정보 입력 완료 후 적용)
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
  }

  // 인증 상태 변경 리스너 설정
  auth.onAuthStateChanged(async (firebaseUser) => {
    if (firebaseUser) {
      window.isAuthReady = true;
      
      // [Event-Driven Auth Guard] React Dashboard에 Auth 준비 신호 전달
      console.log('[Mobile Debug] [Auth] User restored. Signaling Dashboard...');
      try {
        window.dispatchEvent(new CustomEvent('stelvio-auth-ready', { detail: { user: firebaseUser } }));
        console.log('[Mobile Debug] [Auth] stelvio-auth-ready event dispatched successfully');
      } catch (e) {
        console.warn('[Auth] dispatchEvent stelvio-auth-ready failed:', e);
      }
      
      // 로그인 상태: UID로 직접 users/{uid} 문서 가져오기 (간단하고 빠름)
      try {
        const isPhoneLogin = firebaseUser.email && firebaseUser.email.endsWith('@stelvio.ai');
        const isAuthV9 = (auth === window.authV9);
        
        let userData = null;
        
        // authV9인 경우 firestoreV9 사용, 그 외에는 compat firestore 사용
        if (isAuthV9 && typeof window.getUserByUid === 'function') {
          // authV9 + firestoreV9 사용 (동일 앱)
          userData = await window.getUserByUid(firebaseUser.uid);
        } else {
          // compat auth + compat firestore 사용
          const userDoc = await getUsersCollection().doc(firebaseUser.uid).get();
          if (userDoc.exists) {
            var docData3 = userDoc.data() || {};
            userData = { id: firebaseUser.uid };
            if (docData3 && typeof docData3 === 'object') {
              for (var k3 in docData3) { if (docData3.hasOwnProperty(k3)) userData[k3] = docData3[k3]; }
            }
          }
        }
        
        if (userData) {
          // 전역 상태 업데이트 (나이·성별 포함 Firestore 전체 데이터)
          window.currentUser = userData;
          localStorage.setItem('currentUser', JSON.stringify(userData));
          localStorage.setItem('authUser', JSON.stringify(userData));
          
          if (isPhoneLogin && typeof window !== 'undefined') {
            window.isPhoneAuthenticated = true;
          }
          
          // 사용자 정보 상세 로그 (나이·성별 확인)
          console.log('✅ 인증된 사용자 정보 설정 완료 (나이/성별 포함):', {
            uid: firebaseUser.uid,
            name: userData.name,
            birth_year: userData.birth_year,
            gender: userData.gender,
            ftp: userData.ftp
          });
          
          console.log('✅ 인증 상태 복원 완료:', userData.name);
          
          // 사용자 목록 동기화 (로그인 후)
          // callback.html에서는 사용자 목록 로드 및 화면 전환 건너뛰기
          const isCallbackPage = typeof window !== 'undefined' && 
            (window.location.pathname.includes('callback.html') || 
             window.location.href.includes('callback.html'));
          
          if (!isCallbackPage) {
            const heavySyncAfterAuth = async () => {
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
              if (typeof window.syncGeminiApiRegistrationFromLocalStorage === 'function') {
                try {
                  window.syncGeminiApiRegistrationFromLocalStorage();
                } catch (_) {}
              }
            };
            if (typeof window.requestIdleCallback === 'function') {
              window.requestIdleCallback(() => heavySyncAfterAuth(), { timeout: 1800 });
            } else {
              setTimeout(() => heavySyncAfterAuth(), 0);
            }
          }
          
          // callback.html에서는 화면 전환 및 모달 표시 건너뛰기 (위에서 이미 선언된 isCallbackPage 사용)
          if (!isCallbackPage) {
            // 로그인 성공 후에만 모달 표시 (페이지 로드 시에는 표시하지 않음)
            // isLoginJustCompleted 플래그가 true일 때만 모달 표시
            if (isLoginJustCompleted) {
              const hasContact = userData.contact && userData.contact.trim() !== '';
              const hasFTP = userData.ftp && userData.ftp > 0;
              const hasWeight = userData.weight && userData.weight > 0;
              const hasChallenge = userData.challenge && userData.challenge.trim() !== '';
              
              const hasBirthYear = userData.birth_year != null || userData.birthYear != null;
              const hasGender = (userData.gender === '남' || userData.gender === '여') || (userData.sex === '남' || userData.sex === '여');
              const needsInfo = !hasContact || !hasFTP || !hasWeight || !hasBirthYear || !hasGender || !hasChallenge;
              
              if (needsInfo) {
                // 필수 정보가 없으면 사용자 정보 완성 모달 표시 (베이스캠프로 이동하지 않음)
                setTimeout(() => {
                  showCompleteUserInfoModal(userData);
                }, 500);
              } else {
                // 필수 정보가 모두 있으면 베이스캠프 화면으로 이동
                setTimeout(() => {
                  switchToBasecampScreen();
                }, 300);
              }
              
              // 플래그 리셋 (한 번만 실행되도록)
              isLoginJustCompleted = false;
            } else {
              // 🔒 보안: 페이지 로드 시 인증 복원(삼성 태블릿 등) — 베이스캠프 자동 전환 금지
              // 반드시 사용자가 인증 화면에서 로그인(시작하기)을 거쳐야 베이스캠프 진입
              // 공용 기기·삼성 갤럭시 태블릿에서 이전 사용자 계정 자동 로그인 방지
              console.log('[Auth] 인증 상태 복원됨 — 베이스캠프 자동 전환 생략 (사용자 인증 필수)');
            }
          }
        } else {
          // users/{uid} 문서가 없는 경우
          console.warn('⚠️ users/{uid} 문서가 없습니다:', firebaseUser.uid);
          console.warn('💡 회원가입 시 users/{uid} 문서가 생성되어야 합니다.');
          window.isPhoneAuthenticated = false;
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
      window.isAuthReady = false;
      if (typeof window !== 'undefined') window.isPhoneAuthenticated = false;
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authUser');
      isLoginJustCompleted = false; // 플래그도 리셋
      
      // [Event-Driven Auth Guard] Auth 손실 신호 전달
      try {
        window.dispatchEvent(new CustomEvent('stelvio-auth-lost'));
      } catch (e) {
        console.warn('[Auth] dispatchEvent stelvio-auth-lost failed:', e);
      }
      
      console.log('ℹ️ 로그아웃 상태');
      
      // 관리자 기능 숨기기 (training.js의 함수 호출)
      if (typeof window.hideAdminFeatures === 'function') {
        try {
          window.hideAdminFeatures();
        } catch (e) {
          console.warn('관리자 기능 숨기기 실패 (무시):', e);
        }
      }
    }
  });
}

// 페이지 로드 시 인증 상태 리스너 초기화 (compat / v9 택1)
if (typeof window !== 'undefined' && (window.auth || window.authV9)) {
  initAuthStateListener();
} else if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    function stelvioDeferInitAuthListenerOnce() {
      if (window.auth || window.authV9) initAuthStateListener();
    },
    { once: true }
  );
}
// ========== Firestore API 함수들 (기존 Google Sheets API 호환) ==========

/**
 * 모든 사용자 목록 조회
 * @returns {Promise<{success: boolean, items?: array, error?: string}>}
 */
async function apiGetUsers() {
  try {
    // 로그인 상태 확인 - 여러 소스에서 확인
    const authCurrentUser = window.auth?.currentUser;
    
    // Firebase v9 Modular SDK의 authV9도 확인
    let authV9CurrentUser = null;
    try {
      // authV9.currentUser는 동기적으로 접근 가능
      if (window.authV9) {
        authV9CurrentUser = window.authV9.currentUser;
      }
    } catch (e) {
      console.warn('[apiGetUsers] authV9 확인 실패:', e);
    }
    
    // localStorage에서 사용자 정보 확인 (로그인 직후 auth.currentUser가 아직 업데이트되지 않았을 수 있음)
    let storedUser = null;
    try {
      const storedUserStr = localStorage.getItem('currentUser') || localStorage.getItem('authUser');
      if (storedUserStr) {
        storedUser = JSON.parse(storedUserStr);
      }
    } catch (e) {
      console.warn('[apiGetUsers] localStorage 파싱 실패:', e);
    }
    
    // window.currentUser도 확인
    const windowCurrentUser = window.currentUser;
    
    // 우선순위: authV9.currentUser > auth.currentUser > window.currentUser > localStorage
    const currentUser = authV9CurrentUser || authCurrentUser || (windowCurrentUser?.id ? { uid: windowCurrentUser.id } : null);
    const userData = windowCurrentUser || storedUser;
    
    console.log('[apiGetUsers] 🔍 로그인 상태 확인:', { 
      hasAuth: !!window.auth, 
      hasAuthV9: !!window.authV9,
      hasAuthCurrentUser: !!authCurrentUser,
      hasAuthV9CurrentUser: !!authV9CurrentUser,
      hasWindowCurrentUser: !!windowCurrentUser,
      hasStoredUser: !!storedUser,
      currentUserId: currentUser?.uid,
      userDataGrade: userData?.grade,
      userDataId: userData?.id
    });
    
    if (!currentUser && !userData) {
      // 로그인하지 않은 경우 조용히 빈 배열 반환 (경고 메시지 제거)
      console.warn('[apiGetUsers] ⚠️ 로그인하지 않은 상태입니다.');
      return { success: true, items: [] };
    }
    
    // userData가 있지만 currentUser가 없는 경우 (로그인 직후)
    // userData의 id를 사용하여 문서 조회 시도
    const userIdToCheck = currentUser?.uid || userData?.id;
    if (!userIdToCheck) {
      console.warn('[apiGetUsers] ⚠️ 사용자 ID를 찾을 수 없습니다.');
      return { success: true, items: [] };
    }
    
    // userData에 grade 정보가 있으면 먼저 확인 (Firestore 조회 전에 빠른 체크)
    const userGradeFromData = userData?.grade ? String(userData.grade) : null;
    
    // localStorage의 grade 값만으로는 Firestore 권한을 확인할 수 없습니다.
    // Firestore 보안 규칙은 Firebase Authentication의 실제 인증 상태를 기반으로 하므로,
    // 실제 Firestore 문서를 조회한 후 grade를 확인하여 관리자인 경우에만 전체 목록을 조회합니다.
    // 이렇게 하면 권한 오류를 방지할 수 있습니다.
    
    // 현재 사용자의 문서를 먼저 조회하여 권한 확인
    let currentUserDoc;
    let currentUserData = userData; // 기본값으로 userData 사용
    
    // authV9.currentUser가 없고 auth(compat)에 사용자가 있으면 v8 firestore 사용 (권한 오류 방지)
    // 로그인 직후 auth state listener가 authV9 동기화 전에 fire될 수 있음
    const authV9HasUser = !!(window.authV9 && window.authV9.currentUser);
    const authCompatHasUser = !!(window.auth && window.auth.currentUser);
    const useV8Firestore = !authV9HasUser && authCompatHasUser && window.firestore;
    if (useV8Firestore) {
      console.log('[apiGetUsers] ℹ️ authV9 미동기화 → v8 firestore 사용 (Missing permissions 방지)');
    }
    
    try {
      // firestoreV9 사용 (authV9에 사용자 있을 때만, 그렇지 않으면 v8 사용)
      if (window.firestoreV9 && !useV8Firestore) {
        let firestoreModule;
        try {
          firestoreModule = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
        } catch (importErr) {
          console.error('[apiGetUsers] Firebase Firestore CDN 로드 실패 (방화벽/네트워크 확인):', importErr);
          throw new Error('Firebase 모듈을 불러올 수 없습니다. 회사 WiFi/방화벽에서 gstatic.com 차단 여부를 확인해주세요.');
        }
        if (!firestoreModule || typeof firestoreModule.getDoc !== 'function') {
          console.error('[apiGetUsers] Firestore 모듈이 비정상입니다. CDN 응답 확인 필요.');
          throw new Error('Firebase Firestore 모듈을 사용할 수 없습니다. 네트워크 환경을 확인해주세요.');
        }
        var mod = firestoreModule || {};
        var getDoc = mod.getDoc;
        var doc = mod.doc;
        var collection = mod.collection;
        const usersRef = collection(window.firestoreV9, 'users');
        const userDocRef = doc(usersRef, userIdToCheck);
        const userDocSnap = await getDoc(userDocRef);
        
        console.log('[apiGetUsers] 📄 현재 사용자 문서 조회 (firestoreV9):', { 
          exists: userDocSnap.exists(),
          userId: userIdToCheck 
        });
        
        if (userDocSnap.exists()) {
          // Firestore에서 조회한 데이터가 더 최신이므로 우선 사용
          currentUserData = userDocSnap.data() || {};
          currentUserDoc = { exists: true, data: () => currentUserData };
        } else if (userData) {
          // Firestore 문서가 없지만 userData가 있으면 userData 사용
          console.log('[apiGetUsers] ℹ️ Firestore 문서가 없지만 localStorage에 사용자 정보가 있습니다.');
          currentUserDoc = { exists: false };
        } else {
          // 둘 다 없으면 빈 배열 반환
          console.warn('[apiGetUsers] ⚠️ 현재 사용자 문서가 아직 생성되지 않았습니다.');
          return { success: true, items: [] };
        }
      } else {
        // v8 Compat 사용
        currentUserDoc = await getUsersCollection().doc(userIdToCheck).get();
        console.log('[apiGetUsers] 📄 현재 사용자 문서 조회 (firestore v8):', { 
          exists: currentUserDoc.exists,
          userId: userIdToCheck 
        });
        
        if (currentUserDoc.exists) {
          // Firestore에서 조회한 데이터가 더 최신이므로 우선 사용
          currentUserData = currentUserDoc.data() || {};
        } else if (userData) {
          // Firestore 문서가 없지만 userData가 있으면 userData 사용
          console.log('[apiGetUsers] ℹ️ Firestore 문서가 없지만 localStorage에 사용자 정보가 있습니다.');
        } else {
          // 둘 다 없으면 빈 배열 반환
          console.warn('[apiGetUsers] ⚠️ 현재 사용자 문서가 아직 생성되지 않았습니다.');
          return { success: true, items: [] };
        }
      }
    } catch (docError) {
      // 문서 조회 실패 시 권한 오류일 수 있음
      console.error('[apiGetUsers] ❌ 사용자 문서 조회 실패:', docError);
      
      // userData가 있으면 그것을 사용 (로그인 직후 Firestore 조회가 실패할 수 있음)
      if (userData) {
        console.log('[apiGetUsers] ℹ️ Firestore 조회 실패했지만 localStorage의 사용자 정보를 사용합니다.');
        currentUserData = userData;
      } else {
        if (docError.code === 'permission-denied') {
          console.error('🔴 Firestore 권한 오류가 발생했습니다.');
          console.error('📖 확인 사항:');
          console.error('   1. Firebase 콘솔 → Firestore Database → Rules에서 규칙이 올바르게 게시되었는지 확인');
          console.error('   2. FIRESTORE_RULES.txt 파일의 규칙과 일치하는지 확인');
          console.error('   3. 규칙 게시 후 몇 분 정도 기다린 후 다시 시도');
          console.error('   4. 브라우저 캐시를 지우고 다시 시도');
        }
        // 권한 오류가 발생해도 빈 배열 반환하여 앱이 계속 작동하도록 함
        return { success: true, items: [] };
      }
    }
    
    // grade 확인: Firestore 데이터 > userData > 기본값 '2' (관리자 판별은 문자·숫자 모두)
    const userGrade = currentUserData?.grade ?? userGradeFromData ?? '2';
    console.log('[apiGetUsers] 👤 현재 사용자 정보:', { 
      userId: userIdToCheck,
      name: currentUserData?.name,
      grade: userGrade,
      source: currentUserDoc?.exists ? 'firestore' : (userData ? 'localStorage' : 'none'),
      hasCurrentUserDoc: !!currentUserDoc?.exists
    });
    
    // 관리자(grade=1 문자·숫자)인 경우에만 전체 목록 조회
    if (typeof isStelvioAdminGrade === 'function' ? isStelvioAdminGrade(userGrade) : String(userGrade).trim() === '1') {
      console.log('[apiGetUsers] 🔑 관리자 권한 확인됨 - 전체 사용자 목록 조회 시작');
      try {
        // firestoreV9 사용 (authV9에 사용자 있을 때만)
        if (window.firestoreV9 && !useV8Firestore) {
          let firestoreModule;
          try {
            firestoreModule = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
          } catch (importErr) {
            console.error('[apiGetUsers] Firebase Firestore CDN 로드 실패:', importErr);
            throw new Error('Firebase 모듈을 불러올 수 없습니다. 회사 WiFi/방화벽에서 gstatic.com 차단 여부를 확인해주세요.');
          }
          if (!firestoreModule || typeof firestoreModule.getDocs !== 'function') {
            throw new Error('Firebase Firestore 모듈을 사용할 수 없습니다. 네트워크 환경을 확인해주세요.');
          }
          var mod2 = firestoreModule || {};
          var getDocs = mod2.getDocs;
          var collection = mod2.collection;
          const usersRef = collection(window.firestoreV9, 'users');
          const usersSnapshot = await getDocs(usersRef);
          const users = [];
          
          usersSnapshot.forEach(doc => {
            var dd = doc.data() || {};
            var o = { id: doc.id };
            if (dd && typeof dd === 'object') { for (var k in dd) { if (dd.hasOwnProperty(k)) o[k] = dd[k]; } }
            users.push(o);
          });
          
          console.log('[apiGetUsers] ✅ 전체 사용자 목록 조회 완료 (firestoreV9):', { 
            totalUsers: users.length,
            userIds: users.map(u => u.id) 
          });
          
          return { success: true, items: users };
        } else {
          // v8 Compat 사용 (fallback)
          const usersSnapshot = await getUsersCollection().get();
          const users = [];
          
          usersSnapshot.forEach(doc => {
            var dd = doc.data() || {};
            var o = { id: doc.id };
            if (dd && typeof dd === 'object') { for (var k in dd) { if (dd.hasOwnProperty(k)) o[k] = dd[k]; } }
            users.push(o);
          });
          
          console.log('[apiGetUsers] ✅ 전체 사용자 목록 조회 완료 (firestore v8):', { 
            totalUsers: users.length,
            userIds: users.map(u => u.id) 
          });
          
          return { success: true, items: users };
        }
      } catch (listError) {
        // 전체 목록 조회 실패 시 자신의 문서만 반환
        console.error('[apiGetUsers] ❌ 전체 사용자 목록 조회 실패:', listError);
        console.warn('⚠️ 전체 사용자 목록 조회 실패, 자신의 문서만 반환:', listError.message);
        var curData = currentUserData || {};
        var curObj = { id: userIdToCheck };
        if (curData && typeof curData === 'object') { for (var k in curData) { if (curData.hasOwnProperty(k)) curObj[k] = curData[k]; } }
        return { success: true, items: [curObj] };
      }
    } else {
      // 일반 사용자는 자신의 문서만 반환
      console.log('[apiGetUsers] 👤 일반 사용자 - 자신의 문서만 반환');
      var curData2 = currentUserData || {};
      var curObj2 = { id: userIdToCheck };
      if (curData2 && typeof curData2 === 'object') { for (var k in curData2) { if (curData2.hasOwnProperty(k)) curObj2[k] = curData2[k]; } }
      return { success: true, items: [curObj2] };
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
// 전역 노출 (즉시 사용 가능하도록)
window.apiGetUsers = window.apiGetUsers || apiGetUsers;

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
    
    // firestoreV9 사용 (authV9와 동일한 앱 인스턴스) - 우선 사용
    if (window.firestoreV9) {
      var firestoreMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var getDoc = firestoreMod && firestoreMod.getDoc;
      var doc = firestoreMod && firestoreMod.doc;
      var collection = firestoreMod && firestoreMod.collection;
      const usersRef = collection(window.firestoreV9, 'users');
      const userDocRef = doc(usersRef, id);
      const userDocSnap = await getDoc(userDocRef);
      
      if (!userDocSnap.exists()) {
        return { success: false, error: 'User not found' };
      }
      
      var snapData = userDocSnap.data() || {};
      var userData = { id: userDocSnap.id };
      if (snapData && typeof snapData === 'object') { for (var k in snapData) { if (snapData.hasOwnProperty(k)) userData[k] = snapData[k]; } }
      
      return { success: true, item: userData };
    } else {
      // v8 Compat 사용 (fallback)
      const userDoc = await getUsersCollection().doc(id).get();
      
      if (!userDoc.exists) {
        return { success: false, error: 'User not found' };
      }
      
      var udData = userDoc.data() || {};
      var userData = { id: userDoc.id };
      if (udData && typeof udData === 'object') { for (var k in udData) { if (udData.hasOwnProperty(k)) userData[k] = udData[k]; } }
      
      return { success: true, item: userData };
    }
  } catch (error) {
    console.error('❌ 사용자 조회 실패:', error);
    return { success: false, error: error.message };
  }
}
// 전역 노출 (즉시 사용 가능하도록)
window.apiGetUser = window.apiGetUser || apiGetUser;

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
    
    // 전화번호(contact) 중복 검사
    const inputContact = String(userData.contact || '').trim();
    if (inputContact) {
      // 전화번호 정규화 및 숫자만 추출
      const normalizedContact = typeof standardizePhoneFormat === 'function' 
        ? standardizePhoneFormat(inputContact)
        : (typeof formatPhoneForDB === 'function' ? formatPhoneForDB(inputContact) : inputContact);
      
      // 숫자만 추출 (하이픈, 공백 등 제거)
      const onlyDigits = typeof unformatPhone === 'function' 
        ? unformatPhone(normalizedContact)
        : String(normalizedContact).replace(/\D+/g, '');
      if (onlyDigits.length !== 11) {
        const msg = '전화번호 자리수를 확인해주세요';
        if (typeof alert === 'function') alert(msg);
        return { success: false, error: msg };
      }
      if (onlyDigits && onlyDigits.length > 0) {
        // 전체 사용자 목록 조회하여 중복 확인
        const listRes = await apiGetUsers();
        const users = (listRes && (listRes.items || listRes.users || listRes.data)) || [];
        
        const isDuplicated = users.some(u => {
          const uContact = String(u?.contact || '').trim();
          if (!uContact) return false;
          
          // 기존 사용자의 전화번호도 정규화 및 숫자만 추출
          const uNormalized = typeof standardizePhoneFormat === 'function' 
            ? standardizePhoneFormat(uContact)
            : (typeof formatPhoneForDB === 'function' ? formatPhoneForDB(uContact) : uContact);
          const uDigits = typeof unformatPhone === 'function' 
            ? unformatPhone(uNormalized)
            : String(uNormalized).replace(/\D+/g, '');
          
          // 숫자만 비교 (하이픈, 공백 등 무시)
          return uDigits === onlyDigits && uDigits.length > 0;
        });
        
        if (isDuplicated) {
          console.warn('[apiCreateUser] 전화번호 중복:', inputContact);
          return { success: false, error: '이미 등록된 계정입니다.' };
        }
      }
    }
    
    // 기존 Google Sheets 필드 구조로 데이터 준비
    const now = new Date().toISOString();
    const defaultExpiryDate = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 6); // 오늘 + 6개월 (신규 가입 무료 구독 기본 만료)
      return d.toISOString().split('T')[0];
    })();
    
    const newUserData = {
      // 기존 Google Sheets 필드 구조 완벽 유지
      id: currentUser.uid, // Firebase uid 사용
      name: userData.name || '',
      contact: userData.contact || '',
      ftp: parseInt(userData.ftp) || 0,
      weight: parseFloat(userData.weight) || 0,
      birth_year: parseInt(userData.birth_year) || null,
      gender: String(userData.gender || ''),
      created_at: now,
      grade: String(userData.grade || '2'), // 기본값: "2"
      expiry_date: normalizeExpiryDate(userData.expiry_date) || defaultExpiryDate,
      challenge: String(userData.challenge || 'Fitness'), // 기본값: "Fitness"
      acc_points: 0, // 기본값: 0
      rem_points: 0, // 기본값: 0
      last_training_date: '', // 기본값: 빈 문자열
      strava_access_token: '', // 기본값: 빈 문자열
      strava_refresh_token: '', // 기본값: 빈 문자열
      strava_expires_at: 0 // 기본값: 0
    };
    
    // Firestore에 저장
    // firestoreV9 사용 (authV9와 동일한 앱 인스턴스) - 우선 사용
    if (window.firestoreV9) {
      var setDocMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var setDoc = setDocMod && setDocMod.setDoc;
      var doc = setDocMod && setDocMod.doc;
      var collection = setDocMod && setDocMod.collection;
      const usersRef = collection(window.firestoreV9, 'users');
      const userDocRef = doc(usersRef, currentUser.uid);
      await setDoc(userDocRef, newUserData);
      
      console.log('✅ 사용자 생성 완료 (firestoreV9):', newUserData.id);
    } else {
      // v8 Compat 사용 (fallback)
      const userDocRef = getUsersCollection().doc(currentUser.uid);
      await userDocRef.set(newUserData);
      
      console.log('✅ 사용자 생성 완료 (firestore v8):', newUserData.id);
    }
    
    return { success: true, id: newUserData.id };
  } catch (error) {
    console.error('❌ 사용자 생성 실패:', error);
    return { success: false, error: error.message };
  }
}
// 전역 노출 (즉시 사용 가능하도록)
window.apiCreateUser = window.apiCreateUser || apiCreateUser;

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
    if (userData.birth_year != null) updateData.birth_year = parseInt(userData.birth_year);
    if (userData.gender != null) updateData.gender = String(userData.gender);
    if (userData.grade != null) updateData.grade = String(userData.grade);
    // expiry_date는 string 형식으로 유지 (Firestore가 자동으로 Timestamp로 변환하는 것을 방지)
    if (userData.expiry_date != null) {
      const normalizedDate = normalizeExpiryDate(userData.expiry_date);
      updateData.expiry_date = normalizedDate ? String(normalizedDate) : '';
    }
    if (userData.challenge != null) updateData.challenge = String(userData.challenge);
    if (userData.acc_points != null) updateData.acc_points = parseFloat(userData.acc_points);
    if (userData.rem_points != null) updateData.rem_points = parseFloat(userData.rem_points);
    if (userData.last_training_date != null) updateData.last_training_date = String(userData.last_training_date);
    if (userData.strava_access_token != null) updateData.strava_access_token = String(userData.strava_access_token);
    if (userData.strava_refresh_token != null) updateData.strava_refresh_token = String(userData.strava_refresh_token);
    if (userData.strava_expires_at != null) updateData.strava_expires_at = Number(userData.strava_expires_at);
    if (userData.is_private != null) updateData.is_private = userData.is_private === true;
    if (userData.gemini_api_registered != null) updateData.gemini_api_registered = userData.gemini_api_registered === true;
    if (userData.API_sts != null) updateData.API_sts = userData.API_sts === true;
    if (userData.profileImageUrl != null) updateData.profileImageUrl = String(userData.profileImageUrl);

    // Firestore 업데이트
    // firestoreV9 사용 (authV9와 동일한 앱 인스턴스) - 우선 사용
    if (window.firestoreV9) {
      var updateDocMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var updateDoc = updateDocMod && updateDocMod.updateDoc;
      var doc = updateDocMod && updateDocMod.doc;
      var collection = updateDocMod && updateDocMod.collection;
      const usersRef = collection(window.firestoreV9, 'users');
      const userDocRef = doc(usersRef, id);
      await updateDoc(userDocRef, updateData);
      
      console.log('✅ 사용자 정보 업데이트 완료 (firestoreV9):', id);
    } else {
      // v8 Compat 사용 (fallback)
      await getUsersCollection().doc(id).update(updateData);
      
      console.log('✅ 사용자 정보 업데이트 완료 (firestore v8):', id);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ 사용자 정보 업데이트 실패:', error);
    return { success: false, error: error.message };
  }
}
// 전역 노출 (즉시 사용 가능하도록)
window.apiUpdateUser = window.apiUpdateUser || apiUpdateUser;

/**
 * 비공개 설정 토글 (프로필 선택 화면)
 * @param {string} userId - 사용자 ID
 * @param {boolean} isPrivate - true=비공개, false=공개
 */
async function toggleUserPrivacy(userId, isPrivate) {
  if (!userId) return;
  try {
    const res = await apiUpdateUser(userId, { is_private: isPrivate });
    if (res && res.success) {
      if (window.currentUser && String(window.currentUser.id) === userId) {
        window.currentUser.is_private = isPrivate;
        try { localStorage.setItem('currentUser', JSON.stringify(window.currentUser)); } catch (e) {}
      }
      if (typeof loadUsers === 'function') await loadUsers();
      if (typeof showToast === 'function') showToast(isPrivate ? '비공개로 설정되었습니다.' : '공개로 설정되었습니다.');
    } else {
      if (typeof showToast === 'function') showToast('설정 변경에 실패했습니다.', 'error');
    }
  } catch (e) {
    console.warn('[toggleUserPrivacy] 실패:', e);
    if (typeof showToast === 'function') showToast('설정 변경에 실패했습니다.', 'error');
  }
}
window.toggleUserPrivacy = toggleUserPrivacy;

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
    
    // 1. Firestore에서 사용자 문서 삭제
    if (window.firestoreV9) {
      var deleteDocMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var deleteDoc = deleteDocMod && deleteDocMod.deleteDoc;
      var doc = deleteDocMod && deleteDocMod.doc;
      var collection = deleteDocMod && deleteDocMod.collection;
      const usersRef = collection(window.firestoreV9, 'users');
      const userDocRef = doc(usersRef, id);
      await deleteDoc(userDocRef);
      
      console.log('✅ 사용자 삭제 완료 (firestoreV9):', id);
    } else {
      // v8 Compat 사용 (fallback)
      await getUsersCollection().doc(id).delete();
      
      console.log('✅ 사용자 삭제 완료 (firestore v8):', id);
    }
    
    // 2. Firebase Authentication에서 사용자 삭제
    try {
      // 현재 로그인한 사용자가 본인을 삭제하는 경우
      const currentAuthUser = window.auth?.currentUser;
      const currentAuthV9User = window.authV9?.currentUser;
      const isOwnAccount = (currentAuthUser && currentAuthUser.uid === id) || 
                           (currentAuthV9User && currentAuthV9User.uid === id);
      
      if (isOwnAccount) {
        // 본인 계정 삭제: auth.currentUser.delete() 또는 authV9.deleteUser() 사용
        console.log('🔐 본인 계정 삭제: Firebase Authentication에서 삭제 시작:', id);
        
        try {
          // v8 Compat 삭제
          if (currentAuthUser && currentAuthUser.uid === id) {
            await currentAuthUser.delete();
            console.log('✅ Firebase Authentication에서 본인 계정 삭제 완료 (v8):', id);
          }
          
          // v9 Modular 삭제
          if (currentAuthV9User && currentAuthV9User.uid === id && window.authV9) {
            var authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
            var deleteUserV9 = authMod && authMod.deleteUser;
            if (deleteUserV9) await deleteUserV9(currentAuthV9User);
            console.log('✅ Firebase Authentication에서 본인 계정 삭제 완료 (v9):', id);
          }
        } catch (authError) {
          console.error('❌ Firebase Authentication 삭제 실패:', authError);
          if (authError.code === 'auth/requires-recent-login') {
            throw new Error('보안을 위해 최근에 로그인한 후 다시 시도해주세요.');
          }
          throw authError;
        }
      } else {
        // 다른 사용자 삭제: Firebase Admin SDK가 필요하지만 클라이언트에서는 불가능
        console.warn('⚠️ 다른 사용자 삭제: Firebase Authentication 삭제는 Firebase Admin SDK가 필요합니다.');
        console.warn('⚠️ 현재는 Firestore에서만 삭제되며, Firebase Authentication 삭제는 수동으로 처리해야 합니다.');
      }
    } catch (authError) {
      console.error('❌ Firebase Authentication 삭제 실패:', authError);
      
      // 본인 계정 삭제 시 Authentication 삭제 실패는 전체 삭제 실패로 처리
      const currentAuthUser = window.auth?.currentUser;
      const currentAuthV9User = window.authV9?.currentUser;
      const isOwnAccount = (currentAuthUser && currentAuthUser.uid === id) || 
                           (currentAuthV9User && currentAuthV9User.uid === id);
      
      if (isOwnAccount) {
        return {
          success: false,
          error: 'Firebase Authentication 삭제에 실패했습니다: ' + (authError.message || authError.code || '알 수 없는 오류')
        };
      }
      
      // 다른 사용자 삭제 실패 시에는 Firestore 삭제는 성공했으므로 경고만 표시하고 계속 진행
      console.warn('⚠️ 다른 사용자 삭제: Firebase Authentication 삭제는 실패했지만 Firestore 삭제는 성공했습니다.');
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ 사용자 삭제 실패:', error);
    return { success: false, error: error.message };
  }
}
// 전역 노출 (즉시 사용 가능하도록)
window.apiDeleteUser = window.apiDeleteUser || apiDeleteUser;

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
  
  // 가입 축하(환영) 모달보다 먼저 환경설정(Strava/API)을 노출 — 닫히면 app.js closeSettingsModal에서 축하 모달 진행
  const welcomeName =
    typeof userData.name === 'string' && userData.name.trim() !== ''
      ? userData.name.trim()
      : '회원';
  window.__pendingWelcomeModalAfterRegistrationSettingsClose = welcomeName;

  var openedSettings = false;
  if (typeof window.openSettingsModal === 'function') {
    try {
      window.openSettingsModal();
      openedSettings = true;
    } catch (eRegSet) {}
  }

  if (!openedSettings) {
    window.__pendingWelcomeModalAfterRegistrationSettingsClose = null;
    if (typeof showUserWelcomeModal === 'function') {
      showUserWelcomeModal(userData.name || welcomeName);
      window.userWelcomeModalShown = true;
      window.userWelcomeModalUserName = userData.name || welcomeName;
    } else if (typeof showToast === 'function') {
      showToast(`${welcomeName}님 등록이 완료되었습니다! 🎉`);
    }
  }

  return true;
}

function onUserRegistrationError(error, source = 'auth') {
  console.error(`User registration failed from ${source}:`, error);
  const errorMessage = error.message || '등록 중 오류가 발생했습니다';
  if (errorMessage === '전화번호 자리수를 확인해주세요') {
    return false;
  }
  if (typeof showToast === 'function') {
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
    if (onlyDigits.length !== 11) {
      const msg = '전화번호 자리수를 확인해주세요';
      if (typeof alert === 'function') alert(msg);
      throw new Error(msg);
    }
    userData.contact = normalizedContact;

    const listRes = await apiGetUsers();
    const users = (listRes && (listRes.items || listRes.users || listRes.data)) || [];
    const isDuplicated = users.some(u => {
      const uDigits = unformatPhone(u?.contact || '');
      return uDigits === onlyDigits;
    });

    if (isDuplicated) {
      throw new Error('이미 등록된 계정입니다.');
    }

    if (!userData.expiry_date) {
      const d = new Date();
      d.setMonth(d.getMonth() + 6);
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
      오늘부터 <span style="color: #1a1a1a; font-weight: 600;">6개월간 무료 체험</span>이 시작됩니다.<br>
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

/**
 * FTP 기준 파워 영역대 계산 (사용자 예시: FTP 200W)
 * Zone 1~7: 회색, 파랑, 초록, 노랑, 주황, 빨강, 보라
 */
function getFtpPowerZones(ftp) {
  const f = Number(ftp) || 0;
  if (f <= 0) return null;
  return [
    { zone: 1, label: 'Z1', min: 0, max: Math.max(0, Math.floor(f * 0.55) - 1), color: '#9ca3af', desc: '회복' },
    { zone: 2, label: 'Z2', min: Math.ceil(f * 0.56), max: Math.floor(f * 0.75), color: '#3b82f6', desc: '장거리' },
    { zone: 3, label: 'Z3', min: Math.ceil(f * 0.76), max: Math.floor(f * 0.90), color: '#22c55e', desc: '템포' },
    { zone: 4, label: 'Z4', min: Math.ceil(f * 0.91), max: Math.floor(f * 1.05), color: '#eab308', desc: 'FTP' },
    { zone: 5, label: 'Z5', min: Math.ceil(f * 1.06), max: Math.floor(f * 1.20), color: '#f97316', desc: 'VO2max' },
    { zone: 6, label: 'Z6', min: Math.ceil(f * 1.21), max: Math.floor(f * 1.50), color: '#ef4444', desc: '무산소' },
    { zone: 7, label: 'Z7', min: Math.ceil(f * 1.51), max: null, color: '#a855f7', desc: '스프린트' }
  ];
}

/**
 * 최대 심박수 기준 심박 영역대 (50~100%)
 * Zone 1~5: 회색, 파랑, 초록, 주황, 빨강
 */
function getHrZones(maxHr) {
  const m = Number(maxHr) || 0;
  if (m <= 0) return null;
  return [
    { zone: 1, pct: '50~60%', min: Math.round(m * 0.50), max: Math.round(m * 0.60), color: '#9ca3af', desc: '회복' },
    { zone: 2, pct: '60~70%', min: Math.round(m * 0.60), max: Math.round(m * 0.70), color: '#3b82f6', desc: '지구력' },
    { zone: 3, pct: '70~80%', min: Math.round(m * 0.70), max: Math.round(m * 0.80), color: '#22c55e', desc: '유산소' },
    { zone: 4, pct: '80~90%', min: Math.round(m * 0.80), max: Math.round(m * 0.90), color: '#f97316', desc: '역치' },
    { zone: 5, pct: '90~100%', min: Math.round(m * 0.90), max: m, color: '#ef4444', desc: '최대' }
  ];
}

/**
 * FTP/심박 Zone 테이블 HTML 생성 (카드용·상단 참고용 공통)
 * @param {number} ftp - 사용자 FTP (W)
 * @param {number} maxHr - 사용자 최대 심박수 (bpm)
 * @param {{ compact?: boolean, maxHrDate?: string }} opts - compact: true면 스윗스팟 캡션 생략, maxHrDate: YYYY-MM-DD
 * @returns {{ ftpHtml: string, hrHtml: string }}
 */
function buildProfileZoneTableHtml(ftp, maxHr, opts) {
  const f = Number(ftp) || 0;
  const m = Number(maxHr) || 0;
  const compact = opts && opts.compact;
  const maxHrDate = opts && opts.maxHrDate;
  const dateFmt = maxHrDate ? (function(d) {
    if (!d || typeof d !== 'string') return '';
    var parts = d.trim().split(/[-/]/);
    if (parts.length >= 3) return parts[0] + '.' + String(parts[1]).padStart(2, '0') + '.' + String(parts[2]).padStart(2, '0');
    return d;
  })(maxHrDate) : '';

  const ftpZones = f > 0 ? [
    { label: 'Z1', pct: '55% 미만', min: null, max: Math.floor(f * 0.55), color: '#9ca3af', desc: '리커버리 라이딩, 젖산 분해 및 피로도 회복 촉진' },
    { label: 'Z2', pct: '56 ~ 75%', min: Math.ceil(f * 0.56), max: Math.floor(f * 0.75), color: '#3b82f6', desc: '유산소 베이스 구축, 장거리 체력 배양 (인도어 훈련의 핵심)' },
    { label: 'Z3', pct: '76 ~ 90%', min: Math.ceil(f * 0.76), max: Math.floor(f * 0.90), color: '#22c55e', desc: '근지구력 향상, 묵직하고 리듬감 있는 주행 유지' },
    { label: 'Z4', pct: '91 ~ 105%', min: Math.ceil(f * 0.91), max: Math.floor(f * 1.05), color: '#eab308', desc: 'FTP(역치 파워) 직접 향상, 고통스러운 젖산 역치 훈련' },
    { label: 'Z5', pct: '106 ~ 120%', min: Math.ceil(f * 1.06), max: Math.floor(f * 1.20), color: '#f97316', desc: '최대 산소 섭취량(VO2 Max) 확장, 3~8분 길이의 업힐 어택' },
    { label: 'Z6', pct: '121 ~ 150%', min: Math.ceil(f * 1.21), max: Math.floor(f * 1.50), color: '#ef4444', desc: '무산소 용량 확장, 짧은 급경사 및 펠로톤 펀치력 향상' },
    { label: 'Z7', pct: '150% 이상', min: Math.ceil(f * 1.51), max: null, color: '#a855f7', desc: '신경근 파워, 폭발적인 가속력 및 결승선 스프린트' }
  ] : [];

  const hrZones = m > 0 ? [
    { label: 'Z1', pct: '50 ~ 60%', min: Math.round(m * 0.50), max: Math.round(m * 0.60), color: '#9ca3af', desc: '가벼운 워밍업/쿨다운, 피로 회복. 편안한 상태.' },
    { label: 'Z2', pct: '60 ~ 70%', min: Math.round(m * 0.60), max: Math.round(m * 0.70), color: '#3b82f6', desc: '기초 유산소 능력 향상, 체지방 연소 최적화 (LSD 훈련)' },
    { label: 'Z3', pct: '70 ~ 80%', min: Math.round(m * 0.70), max: Math.round(m * 0.80), color: '#22c55e', desc: '심폐 지구력 강화, 근기능 및 혈액 순환 향상' },
    { label: 'Z4', pct: '80 ~ 90%', min: Math.round(m * 0.80), max: Math.round(m * 0.90), color: '#f97316', desc: '무산소 역치 증가, 고강도 지속 능력 향상' },
    { label: 'Z5', pct: '90 ~ 100%', min: Math.round(m * 0.90), max: m, color: '#ef4444', desc: '무산소 능력, 최대 스피드 및 파워 향상. 한계 상태.' }
  ] : [];

  const fmtFtpVal = (z) => {
    if (z.min == null && z.max != null) return '&lt; ' + z.max;
    if (z.min != null && z.max == null) return z.min + ' 이상';
    return z.min + ' ~ ' + z.max;
  };
  const fmtHrVal = (z) => z.min + ' ~ ' + z.max;

  const ftpRows = ftpZones.map(z => `
    <tr>
      <td><span class="profile-zone-badge" style="background:${z.color};color:#000">${z.label}</span></td>
      <td>${z.pct}</td>
      <td>${fmtFtpVal(z)}</td>
      <td>${z.desc}</td>
    </tr>
  `).join('');

  const hrRows = hrZones.map(z => `
    <tr>
      <td><span class="profile-zone-badge" style="background:${z.color};color:#000">${z.label}</span></td>
      <td>${z.pct}</td>
      <td>${fmtHrVal(z)}</td>
      <td>${z.desc}</td>
    </tr>
  `).join('');

  const sweetSpotCaption = compact ? '' : '<p class="profile-zone-caption">💡 스윗 스팟 (Sweet Spot): 88% ~ 93% 구간. 훈련 피로도 대비 FTP 향상 효과가 가장 뛰어난 가성비 최고의 훈련 구간.</p>';

  const ftpHtml = f > 0 ? `
    <div class="profile-zone-table-block profile-zone-table-in-card">
      <div class="profile-zone-table-header">사용자 FTP: ${f}W</div>
      <table class="profile-zone-table">
        <thead><tr><th>구분</th><th>범위(%)</th><th>값(W)</th><th>내용</th></tr></thead>
        <tbody>${ftpRows}</tbody>
      </table>
      ${sweetSpotCaption}
    </div>
  ` : '';

  const hrHtml = m > 0 ? `
    <div class="profile-zone-table-block profile-zone-table-in-card">
      <div class="profile-zone-table-header">사용자 최대 심박수: ${m} bpm${dateFmt ? ' (' + dateFmt + ')' : ''}</div>
      <table class="profile-zone-table">
        <thead><tr><th>구분</th><th>범위(%)</th><th>값(bpm)</th><th>내용</th></tr></thead>
        <tbody>${hrRows}</tbody>
      </table>
    </div>
  ` : '';

  return { ftpHtml, hrHtml };
}

if (typeof window !== 'undefined') {
  window.buildProfileZoneTableHtml = buildProfileZoneTableHtml;
}

/**
 * 프로필 선택 화면: FTP 파워 영역 / 심박 영역 상세 테이블 렌더링 (상단 참고용)
 * @param {number} [ftp=200] - 사용자 FTP (W)
 * @param {number} [maxHr=190] - 사용자 최대 심박수 (bpm)
 */
function renderProfileZoneTables(ftp, maxHr) {
  const f = Number(ftp) || 200;
  const m = Number(maxHr) || 190;
  const container = document.getElementById('profileZoneTablesContent');
  if (!container) return;
  var zoneResult = buildProfileZoneTableHtml(f, m, { compact: false });
  var ftpHtml = zoneResult ? zoneResult.ftpHtml : '';
  var hrHtml = zoneResult ? zoneResult.hrHtml : '';
  container.innerHTML = ftpHtml + hrHtml;
}

/** 프로필 Zone 테이블 값 갱신 (prop/상태 전달용) */
window.updateProfileZoneTables = function(ftp, maxHr) {
  if (typeof renderProfileZoneTables === 'function') {
    renderProfileZoneTables(ftp, maxHr);
  }
};

/**
 * yearly_peaks/{year}에서 해당 연도의 최대 심박수 조회
 * - time_in_zones HR 존 표시 시 저장 기준과 동일한 yearly_peaks 사용
 * @param {string} userId - 사용자 ID
 * @param {number} year - 연도 (예: 2025)
 * @returns {Promise<number|null>} max_hr 또는 null
 */
async function fetchMaxHrForYear(userId, year) {
  if (!userId || !year) return null;
  var db = window.firestoreV9 || (window.firestore && window.firestore);
  if (!db) return null;
  try {
    var yearStr = String(year);
    if (window.firestoreV9) {
      var fsMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var getDoc = fsMod && fsMod.getDoc;
      var doc = fsMod && fsMod.doc;
      if (!getDoc || !doc) return null;
      var ref = doc(db, 'users', userId, 'yearly_peaks', yearStr);
      var snap = await getDoc(ref);
      if (snap && snap.exists) {
        var d = snap.data() || {};
        var hr = Number(d.max_hr ?? d.max_heartrate ?? 0);
        return hr > 0 ? hr : null;
      }
      return null;
    }
    var docRef = db.collection('users').doc(userId).collection('yearly_peaks').doc(yearStr);
    var docSnap = await docRef.get();
    if (docSnap && docSnap.exists) {
      var data = docSnap.data() || {};
      var hr = Number(data.max_hr ?? data.max_heartrate ?? 0);
      return hr > 0 ? hr : null;
    }
    return null;
  } catch (e) {
    var perm =
      e &&
      (e.code === 'permission-denied' ||
        (String(e.message || '').indexOf('Missing or insufficient permissions') >= 0));
    if (!perm && typeof console !== 'undefined' && console.warn) {
      console.warn('[UserManager] fetchMaxHrForYear 실패:', userId, year, e);
    }
    return null;
  }
}
if (typeof window !== 'undefined') window.fetchMaxHrForYear = fetchMaxHrForYear;

var HR_ROLLING_MAX_BPM = 220;

/**
 * Max HR from training logs in the last 365 days (local today), same basis as HR time_in_zones.
 * Uses max of max_hr_5sec, max_hr, max_heartrate per log.
 * @param {string} userId
 * @returns {Promise<{ maxHr: number, maxHrDate?: string|null }|null>}
 */
async function fetchMaxHrRolling365Days(userId) {
  if (!userId || !window.firestoreV9) return null;
  try {
    var fsMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    var collection = fsMod.collection;
    var query = fsMod.query;
    var where = fsMod.where;
    var getDocs = fsMod.getDocs;
    var Timestamp = fsMod.Timestamp;
    if (!collection || !query || !where || !getDocs || !Timestamp) return null;
    var db = window.firestoreV9;
    var pad2 = function (n) {
      return String(n).padStart(2, '0');
    };
    var localYmd = function (d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    };
    var end = new Date();
    var start = new Date(end.getTime());
    start.setDate(start.getDate() - 365);
    var startStr = localYmd(start);
    var endStr = localYmd(end);
    var userLogsRef = collection(db, 'users', userId, 'logs');
    var seen = {};
    var bestHr = 0;
    var bestDate = null;
    var considerData = function (data) {
      var d = data || {};
      var hr = Math.max(
        Number(d.max_hr_5sec) || 0,
        Number(d.max_hr) || 0,
        Number(d.max_heartrate) || 0
      );
      if (hr > 0 && hr <= HR_ROLLING_MAX_BPM && hr > bestHr) {
        bestHr = hr;
        var ds = '';
        if (d.date != null && typeof d.date === 'string') {
          ds = String(d.date).trim().slice(0, 10);
        } else if (d.date && typeof d.date.toDate === 'function') {
          try {
            ds = localYmd(d.date.toDate());
          } catch (eD) {
            ds = '';
          }
        }
        bestDate = ds || null;
      }
    };
    try {
      var startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
      var endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      var qTs = query(
        userLogsRef,
        where('date', '>=', Timestamp.fromDate(startDate)),
        where('date', '<=', Timestamp.fromDate(endDate))
      );
      var snapTs = await getDocs(qTs);
      snapTs.forEach(function (docSnap) {
        seen[docSnap.id] = true;
        considerData(docSnap.data());
      });
    } catch (eTs) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[UserManager] fetchMaxHrRolling365Days Timestamp query:', eTs);
      }
    }
    try {
      var qStr = query(userLogsRef, where('date', '>=', startStr), where('date', '<=', endStr));
      var snapStr = await getDocs(qStr);
      snapStr.forEach(function (docSnap) {
        if (seen[docSnap.id]) return;
        considerData(docSnap.data());
      });
    } catch (eStr) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[UserManager] fetchMaxHrRolling365Days string date query:', eStr);
      }
    }
    return bestHr > 0 ? { maxHr: bestHr, maxHrDate: bestDate } : null;
  } catch (e) {
    var perm =
      e &&
      (e.code === 'permission-denied' ||
        (String(e.message || '').indexOf('Missing or insufficient permissions') >= 0));
    if (!perm && typeof console !== 'undefined' && console.warn) {
      console.warn('[UserManager] fetchMaxHrRolling365Days 실패:', userId, e);
    }
    return null;
  }
}
if (typeof window !== 'undefined') {
  window.fetchMaxHrRolling365Days = fetchMaxHrRolling365Days;
  window.getMaxHrFromLogsRolling365Days = fetchMaxHrRolling365Days;
}

/**
 * yearly_peaks/{year} 전체 문서 조회 (PR 표시용)
 * @param {string} userId - 사용자 ID
 * @param {number|string} year - 연도 (예: 2025)
 * @returns {Promise<Object|null>} yearly_peaks 문서 데이터 또는 null
 */
async function fetchYearlyPeaksForYear(userId, year) {
  if (!userId || year == null) return null;
  var db = window.firestoreV9 || (window.firestore && window.firestore);
  if (!db) return null;
  try {
    var yearStr = String(year);
    if (window.firestoreV9) {
      var fsMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var getDoc = fsMod && fsMod.getDoc;
      var doc = fsMod && fsMod.doc;
      if (!getDoc || !doc) return null;
      var ref = doc(db, 'users', userId, 'yearly_peaks', yearStr);
      var snap = await getDoc(ref);
      if (snap && snap.exists) {
        return snap.data() || null;
      }
      return null;
    }
    var docRef = db.collection('users').doc(userId).collection('yearly_peaks').doc(yearStr);
    var docSnap = await docRef.get();
    if (docSnap && docSnap.exists) {
      return docSnap.data() || null;
    }
    return null;
  } catch (e) {
    console.warn('[UserManager] fetchYearlyPeaksForYear 실패:', userId, year, e);
    return null;
  }
}
if (typeof window !== 'undefined') window.fetchYearlyPeaksForYear = fetchYearlyPeaksForYear;

/** PR 적용 필드: yearly_peaks 키 → 로그 필드 매핑 */
var PR_FIELDS = ['max_hr', 'max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
/** W/kg 비교 대상 필드 (파워 계열: 몸무게 변동 시 절대값 비교 오류 방지) */
var PR_WKG_FIELDS = ['max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
if (typeof window !== 'undefined') {
  window.PR_FIELDS = PR_FIELDS;
  window.PR_WKG_FIELDS = PR_WKG_FIELDS;
}

/** PR 비교용 몸무게(kg) 반환: log.weight 우선, 없으면 userWeight. 최소 45kg */
function getWeightForPr(log, userWeight) {
  var w = Number(log && log.weight) || Number(userWeight) || 0;
  return w > 0 ? Math.max(w, 45) : 0;
}

/** W/kg 소수점 2자리 산출 (비교 키용) */
function toWkg2Decimals(watts, weightKg) {
  if (!weightKg || weightKg <= 0 || !watts || watts <= 0) return null;
  return Math.round((watts / weightKg) * 100) / 100;
}

/**
 * 로그가 yearly_peaks 대비 PR(개인기록)을 1개 이상 갖는지 확인
 * 파워 필드: W/kg(소수점 2자리)로 비교. log.weight 있으면 사용, 없으면 userWeight 사용
 * @param {Object} log - 훈련 로그
 * @param {Object} yearlyPeaks - yearly_peaks/{year} 문서
 * @param {number} [userWeight] - 사용자 현재 몸무게(kg). log.weight 없을 때 사용
 * @returns {boolean}
 */
function logHasAnyPr(log, yearlyPeaks, userWeight) {
  if (!log || !yearlyPeaks) return false;
  var weightKg = getWeightForPr(log, userWeight);
  for (var i = 0; i < PR_FIELDS.length; i++) {
    var key = PR_FIELDS[i];
    var peakVal = yearlyPeaks[key];
    if (peakVal == null || peakVal === '' || Number.isNaN(Number(peakVal))) continue;
    var logVal = log[key];
    if (key === 'max_hr' && (logVal == null || logVal === '' || Number.isNaN(Number(logVal)))) {
      logVal = log.max_heartrate;
    }
    if (logVal == null || logVal === '' || Number.isNaN(Number(logVal))) continue;
    if (PR_WKG_FIELDS.indexOf(key) >= 0) {
      if (weightKg <= 0) continue;
      var logWkg = toWkg2Decimals(Number(logVal), weightKg);
      if (logWkg == null) continue;
      var peakWkg = yearlyPeaks[key.replace('_watts', '_wkg')];
      if (peakWkg != null && peakWkg !== '' && !Number.isNaN(Number(peakWkg))) {
        peakWkg = Math.round(Number(peakWkg) * 100) / 100;
      } else {
        peakWkg = toWkg2Decimals(Number(peakVal), weightKg);
      }
      if (peakWkg != null && logWkg === peakWkg) return true;
    } else {
      if (Math.round(Number(logVal)) === Math.round(Number(peakVal))) return true;
    }
  }
  return false;
}
if (typeof window !== 'undefined') window.logHasAnyPr = logHasAnyPr;

/**
 * 특정 필드가 yearly_peaks와 일치하는지(PR인지) 확인
 * 파워 필드: W/kg(소수점 2자리)로 비교. log.weight 있으면 사용, 없으면 userWeight 사용
 * @param {Object} log - 훈련 로그
 * @param {Object} yearlyPeaks - yearly_peaks/{year} 문서
 * @param {string} field - 필드명 (max_hr, max_1min_watts 등)
 * @param {number} [userWeight] - 사용자 현재 몸무게(kg). log.weight 없을 때 사용
 * @returns {boolean}
 */
function isPrField(log, yearlyPeaks, field, userWeight) {
  if (!log || !yearlyPeaks || !field) return false;
  var peakVal = yearlyPeaks[field];
  if (peakVal == null || peakVal === '' || Number.isNaN(Number(peakVal))) return false;
  var logVal = log[field];
  if (field === 'max_hr' && (logVal == null || logVal === '' || Number.isNaN(Number(logVal)))) {
    logVal = log.max_heartrate;
  }
  if (logVal == null || logVal === '' || Number.isNaN(Number(logVal))) return false;
  if (PR_WKG_FIELDS.indexOf(field) >= 0) {
    var weightKg = getWeightForPr(log, userWeight);
    if (weightKg <= 0) return false;
    var logWkg = toWkg2Decimals(Number(logVal), weightKg);
    if (logWkg == null) return false;
    var peakWkg = yearlyPeaks[field.replace('_watts', '_wkg')];
    if (peakWkg != null && peakWkg !== '' && !Number.isNaN(Number(peakWkg))) {
      peakWkg = Math.round(Number(peakWkg) * 100) / 100;
    } else {
      peakWkg = toWkg2Decimals(Number(peakVal), weightKg);
    }
    return peakWkg != null && logWkg === peakWkg;
  }
  return Math.round(Number(logVal)) === Math.round(Number(peakVal));
}
if (typeof window !== 'undefined') window.isPrField = isPrField;

/**
 * Profile/dashboard: same as fetchMaxHrRolling365Days (rolling 365d max HR from logs).
 * @returns {{ maxHr: number, maxHrDate?: string|null }|null}
 */
async function fetchMaxHrFromYearlyPeaks(userId) {
  return fetchMaxHrRolling365Days(userId);
}

if (typeof window !== 'undefined') {
  window.fetchMaxHrFromYearlyPeaks = fetchMaxHrFromYearlyPeaks;
}

/**
 * 프로필 관리자 통계: A=Gemini API 등록(API_sts / gemini_api_registered / gemini_api_key), S=Strava 토큰 보유
 */
function userHasGeminiApiRegistered(u) {
  if (!u || typeof u !== 'object') return false;
  var sts = u.API_sts;
  if (sts === true || sts === 'true' || sts === 1 || sts === '1') return true;
  var reg = u.gemini_api_registered;
  if (reg === true || reg === 'true' || reg === 1 || reg === '1') return true;
  const k = u.gemini_api_key != null ? String(u.gemini_api_key).trim() : '';
  return k.length > 0;
}

function userHasStravaConnected(u) {
  if (!u || typeof u !== 'object') return false;
  const r = u.strava_refresh_token != null ? String(u.strava_refresh_token).trim() : '';
  const a = u.strava_access_token != null ? String(u.strava_access_token).trim() : '';
  return !!(r || a);
}

function countProfileIntegrationStats(users) {
  if (!Array.isArray(users)) return { a: 0, s: 0 };
  let a = 0;
  let s = 0;
  for (const u of users) {
    if (userHasGeminiApiRegistered(u)) a++;
    if (userHasStravaConnected(u)) s++;
  }
  return { a, s };
}

function setProfileSearchUserCountText(userArray) {
  const el = document.getElementById('profileSearchUserCount');
  if (!el || !Array.isArray(userArray)) return;
  const st = countProfileIntegrationStats(userArray);
  el.textContent = '등록된 사용자: ' + userArray.length + '명 (A:' + st.a + '명, S:' + st.s + '명)';
}

window.countProfileIntegrationStats = countProfileIntegrationStats;
window.setProfileSearchUserCountText = setProfileSearchUserCountText;
window.userHasGeminiApiRegistered = userHasGeminiApiRegistered;
window.userHasStravaConnected = userHasStravaConnected;

/**
 * 베이스캠프 인증 후 강제 환경설정 게이트: Strava 토큰 없음 또는 Gemini/API_sts 미등록
 */
function userNeedsMandatoryIntegratedSetup(u) {
  if (!u || typeof u !== 'object') return false;
  return !userHasStravaConnected(u) || !userHasGeminiApiRegistered(u);
}
window.userNeedsMandatoryIntegratedSetup = userNeedsMandatoryIntegratedSetup;

function stelvioEscapeHtmlAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * 프로필 화면 사용자 카드 목록 렌더링 (loadUsers / searchProfileUsers 공용)
 * @param {Array} usersToRender - 렌더할 사용자 배열
 * @param {string} viewerGrade - 뷰어 등급
 * @param {string|null} viewerId - 뷰어 ID
 * @param {Object} [maxHrByUser] - userId -> maxHr 맵 (훈련로그 기반, 비동기 채움)
 */
function renderProfileUserCards(usersToRender, viewerGrade, viewerId) {
  const userList = document.getElementById('userList');
  if (!userList) return;
  let hasAiKeyLocal = false;
  try {
    const key = typeof localStorage !== 'undefined' ? localStorage.getItem('geminiApiKey') : null;
    hasAiKeyLocal = !!(key && String(key).trim());
  } catch (e) {}
  /** 로그인 계정이 관리자면 표시등은 Firestore(사용자별 등록)만 반영 — 기기 로컬 키만으로 전원 녹색 처리 방지, (A:n명) 집계와 일치 */
  const loginGradeForAiDot =
    typeof getLoginUserGrade === 'function' ? String(getLoginUserGrade()) : '2';
  const canEditFor = (u) => {
    if (viewerGrade === '1') return true;
    if (viewerGrade === '2' || viewerGrade === '3') return viewerId && String(u.id) === viewerId;
    return false;
  };
    const canDeleteFor = (u) => {
    if (viewerGrade === '1') return true;
    if (viewerGrade === '2' || viewerGrade === '3') return viewerId && String(u.id) === viewerId;
    return false;
  };
  const canTogglePrivacyFor = (u) => viewerId && String(u.id) === viewerId; // 본인만 비공개 설정
  const showDashboardBtn = (viewerGrade === '1'); // grade=1만 대시보드 버튼 표시
  const sorted = [...usersToRender].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  userList.innerHTML = sorted.map(user => {
    const wkg = (user.ftp && user.weight) ? (user.ftp / user.weight).toFixed(2) : '-';
    const expRaw = user.expiry_date;
    let expiryText = '미설정';
    let expiryClass = '';
    if (expRaw) {
      const expiryDate = new Date(expRaw);
      const today = new Date();
      expiryDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiryDate - today) / (24 * 60 * 60 * 1000));
      expiryText = expiryDate.toLocaleDateString();
      if (diffDays < 0) { expiryClass = 'is-expired'; } else if (diffDays === 0) { expiryClass = 'is-soon'; expiryText += ' (D-DAY)'; } else if (diffDays <= 7) { expiryClass = 'is-soon'; expiryText += ` (D-${diffDays})`; }
    }
    const canEdit = canEditFor(user);
    const canDelete = canDeleteFor(user);
    const canTogglePrivacy = canTogglePrivacyFor(user);
    const isPrivate = user.is_private === true;
    const deleteButtonDisabled = !canDelete ? 'disabled' : '';
    const deleteButtonClass = !canDelete ? 'disabled' : '';
    const challenge = String(user.challenge || 'Fitness').trim();
    let challengeImage = 'yellow.png';
    if (challenge === 'GranFondo') challengeImage = 'green.png'; else if (challenge === 'IronMan') challengeImage = 'dgreen.png'; else if (challenge === 'Racing') challengeImage = 'blue.png'; else if (challenge === 'Elite') challengeImage = 'orenge.png'; else if (challenge === 'PRO') challengeImage = 'red.png';
    const accPoints = user.acc_points || 0;
    const remPoints = user.rem_points || 0;
    const hasStrava = !!(user.strava_refresh_token || user.strava_access_token);
    const hasAiForUser =
      loginGradeForAiDot === '1'
        ? userHasGeminiApiRegistered(user)
        : hasAiKeyLocal || userHasGeminiApiRegistered(user);
    const aiDot = hasAiForUser ? 'background:#22c55e' : 'background:#d1d5db';
    const stravaDot = hasStrava ? 'background:#22c55e' : 'background:#d1d5db';
    const defaultAv =
      typeof window.STELVIO_DEFAULT_PROFILE_IMAGE_URL === 'string' && window.STELVIO_DEFAULT_PROFILE_IMAGE_URL
        ? window.STELVIO_DEFAULT_PROFILE_IMAGE_URL
        : 'assets/img/profile-placeholder.svg';
    const profileUrlRaw =
      user.profileImageUrl && String(user.profileImageUrl).trim()
        ? String(user.profileImageUrl).trim()
        : defaultAv;
    const profileUrl = stelvioEscapeHtmlAttr(profileUrlRaw);
    const canEditAvatar = !!(viewerId && String(user.id) === String(viewerId));
    /* 공개/비공개 토글 – 4번째 칸 (본인만 표시) */
    const privacyColHtml = canTogglePrivacy
      ? `<span class="avatar-row-privacy" onclick="event.stopPropagation();">
              <label class="privacy-toggle-label">
                <input type="checkbox" class="privacy-toggle-input" ${isPrivate ? 'checked' : ''} onchange="toggleUserPrivacy('${user.id}', this.checked)">
                <span class="privacy-toggle-slider"></span>
                <span class="privacy-toggle-text">${isPrivate ? '비공개' : '공개'}</span>
              </label>
            </span>`
      : '<span class="avatar-row-privacy"></span>';
    const avatarBlock = canEditAvatar
      ? `<button type="button" class="stelvio-profile-card-avatar-btn" onclick="event.stopPropagation();typeof stelvioOpenProfilePhotoPicker==='function'&&stelvioOpenProfilePhotoPicker('${user.id}')" aria-label="프로필 사진 변경">
              <span class="stelvio-profile-card-avatar-ring">
                <img class="stelvio-profile-card-avatar-img" src="${profileUrl}" alt="" width="60" height="60" loading="lazy" decoding="async" data-stelvio-profile-img="${user.id}" />
                <span class="stelvio-profile-card-avatar-camera" aria-hidden="true"></span>
              </span>
            </button>`
      : `<span class="stelvio-profile-card-avatar-readonly"><span class="stelvio-profile-card-avatar-ring">
              <img class="stelvio-profile-card-avatar-img" src="${profileUrl}" alt="" width="60" height="60" loading="lazy" decoding="async" />
            </span></span>`;

    return `
      <div class="user-card" data-user-id="${user.id}" onclick="selectUser('${user.id}')" style="cursor: pointer;">
        <div class="user-header">

          <!-- 1줄: 2분할 (좌: 등급+이름+연결표시, 우: 대시보드·수정·삭제) -->
          <div class="user-row1">
            <div class="user-name-wrapper">
              <div class="user-name user-name-with-indicators">
                <span class="user-name-text"><img src="assets/img/${challengeImage}" alt="" class="user-name-icon"> ${user.name}</span>
                <span class="user-name-badges" title="AI 페어링 / Strava 연결">
                  <span class="profile-indicator-dot" style="width:8px;height:8px;border-radius:50%;${aiDot}" title="AI 페어링" aria-label="AI 페어링"></span>
                  <span class="profile-indicator-dot" style="width:8px;height:8px;border-radius:50%;${stravaDot}" title="Strava 연결" aria-label="Strava 연결"></span>
                </span>
              </div>
            </div>
            <div class="user-actions" onclick="event.stopPropagation();">
              ${showDashboardBtn ? `<button class="btn-dashboard" onclick="event.stopPropagation();showPerformanceDashboard('${user.id}')" title="대시보드 보기">📊 대시보드</button>` : ''}
              ${canEdit ? `<button class="btn-edit" onclick="event.stopPropagation();editUser('${user.id}')" title="수정"><img src="assets/img/edit2.png" alt="수정" style="width:20px;height:20px;display:block;" /></button><button class="btn-delete ${deleteButtonClass}" onclick="event.stopPropagation();deleteUser('${user.id}')" title="삭제" ${deleteButtonDisabled}><img src="assets/img/delete2.png" alt="삭제" style="width:20px;height:20px;display:block;" /></button>` : ''}
            </div>
          </div>

          <!-- 2줄: 4등분 전체 너비 (아바타 25% | 누적포인트 25% | 보유포인트 25% | 공개/비공개 25%) -->
          <div class="stelvio-user-points-with-avatar">
            ${avatarBlock}
            <span class="point-badge point-accumulated" title="누적 포인트"><span class="point-icon">⭐</span><span class="point-value">${formatPoints(accPoints)}</span></span>
            <span class="point-badge point-remaining" title="보유 포인트"><span class="point-icon">💎</span><span class="point-value">${formatPoints(remPoints)}</span></span>
            ${privacyColHtml}
          </div>

        </div>
        <div class="user-details">

          <!-- 3줄: FTP · 체중 · W/kg -->
          <div class="user-stats">
            <span class="stat">FTP: ${user.ftp || '-'}W</span>
            <span class="stat">체중: ${user.weight || '-'}kg</span>
            <span class="stat">W/kg: ${wkg}</span>
          </div>

          <!-- 4줄: 2분할 (연락처 | 만료일) -->
          <div class="user-meta">
            <span class="contact">${user.contact || ''}</span>
            <span class="expiry ${expiryClass}">만료일: ${expiryText}</span>
          </div>

        </div>
      </div>
    `;
  }).join('');
}

/**
 * 프로필 화면: 사용자별 Max HR 비동기 조회 후 카드 재렌더링
 * yearly_peaks에서 조회 (MMP 업데이트 시 max_hr도 반영됨, 로그 스캔 대비 효율적)
 */
async function refreshProfileMaxHrAndRerender(usersToRender, viewerGrade, viewerId) {
  renderProfileUserCards(usersToRender, viewerGrade, viewerId);
}

/**
 * 관리자(grade=1) 전용: 프로필 화면 사용자 검색 (이름/전화번호, 빈값이면 전체 검색)
 */
function searchProfileUsers() {
  const userList = document.getElementById('userList');
  const allUsers = window._profileScreenAllUsers;
  const ctx = window._profileScreenContext;
  if (!userList || !Array.isArray(allUsers) || !ctx) {
    if (typeof loadUsers === 'function') loadUsers();
    return;
  }
  const nameInput = document.getElementById('profileSearchName');
  const contactInput = document.getElementById('profileSearchContact');
  const nameRaw = (nameInput && nameInput.value) ? String(nameInput.value).trim() : '';
  const contactRaw = (contactInput && contactInput.value) ? String(contactInput.value).trim() : '';
  const nameQuery = nameRaw.toLowerCase();
  const contactDigits = (contactRaw || '').replace(/\D/g, '');
  let filtered = allUsers;
  if (nameQuery || contactDigits) {
    filtered = allUsers.filter(u => {
      const nameMatch = !nameQuery || (u.name && String(u.name).toLowerCase().includes(nameQuery));
      const uContact = (u.contact || '').replace(/\D/g, '');
      const contactMatch = !contactDigits || (uContact && uContact.includes(contactDigits));
      return nameMatch && contactMatch;
    });
  }
  renderProfileUserCards(filtered, ctx.viewerGrade, ctx.viewerId);
  if (filtered.length > 0 && typeof window.refreshProfileMaxHrAndRerender === 'function') {
    window.refreshProfileMaxHrAndRerender(filtered, ctx.viewerGrade, ctx.viewerId).catch(() => {});
  }
  if (typeof setProfileSearchUserCountText === 'function') {
    setProfileSearchUserCountText(filtered);
  }
  if (typeof showToast === 'function') {
    showToast(nameQuery || contactDigits ? `검색 결과 ${filtered.length}명` : `전체 ${filtered.length}명`);
  }
}

window.searchProfileUsers = searchProfileUsers;
window.refreshProfileMaxHrAndRerender = refreshProfileMaxHrAndRerender;

/**
 * 날짜에 N개월 더한 YYYY-MM-DD 반환
 * @param {string|Date|object} dateValue - 기존 만료일
 * @param {number} months - 연장할 개월 수
 * @returns {string} YYYY-MM-DD
 */
function addMonthsToExpiry(dateValue, months) {
  let d;
  if (!dateValue) {
    d = new Date();
  } else if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
    d = new Date(dateValue.substring(0, 10));
  } else if (dateValue && typeof dateValue === 'object' && dateValue.toDate) {
    d = dateValue.toDate();
  } else if (dateValue && typeof dateValue === 'object' && dateValue.seconds) {
    d = new Date(dateValue.seconds * 1000);
  } else {
    d = new Date(dateValue);
  }
  if (isNaN(d.getTime())) d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

/**
 * 관리자(grade=1) 전용: 모든 사용자 만료일 일괄 연장 (적용 전 확인 메시지)
 */
async function bulkExtendExpiry() {
  const allUsers = window._profileScreenAllUsers;
  const ctx = window._profileScreenContext;
  if (!Array.isArray(allUsers) || !ctx || ctx.viewerGrade !== '1') {
    if (typeof showToast === 'function') showToast('권한이 없거나 사용자 목록이 없습니다.', 'warning');
    return;
  }
  const monthsEl = document.getElementById('profileBulkExpiryMonths');
  const months = monthsEl ? parseInt(monthsEl.value, 10) : 1;
  if (!months || months < 1 || months > 12) {
    if (typeof showToast === 'function') showToast('1~12개월 중 선택해 주세요.', 'warning');
    return;
  }
  const msg = '전체 ' + allUsers.length + '명 사용자의 만료일을 ' + months + '개월 연장합니다.\n진행할까요?';
  if (!confirm(msg)) return;
  const btn = document.getElementById('profileBulkExpiryBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '처리 중...';
  }
  let done = 0;
  let fail = 0;
  for (const user of allUsers) {
    try {
      const newExpiry = addMonthsToExpiry(user.expiry_date, months);
      const res = await apiUpdateUser(user.id, { expiry_date: newExpiry });
      if (res && res.success) done++; else fail++;
    } catch (e) {
      console.warn('[bulkExtendExpiry] 실패:', user.id, e);
      fail++;
    }
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = '적용';
  }
  if (typeof showToast === 'function') {
    showToast('만료일 연장 완료: ' + done + '명' + (fail ? ', 실패 ' + fail + '명' : ''));
  }
  if (typeof loadUsers === 'function') await loadUsers();
}

window.bulkExtendExpiry = bulkExtendExpiry;

async function loadUsers() {
  const userList = document.getElementById('userList');
  if (!userList) {
    // callback.html이나 iframe에서는 userList가 없을 수 있음 (정상)
    const isCallbackPage = typeof window !== 'undefined' && 
      (window.location.pathname.includes('callback.html') || 
       window.location.href.includes('callback.html'));
    if (window === window.top && !isCallbackPage) {
      console.warn('[loadUsers] userList 요소를 찾을 수 없습니다. 함수를 종료합니다.');
    }
    return; // callback.html 또는 iframe(대시보드 등)에서는 userList 없음 → 로그 생략 후 종료
  }

  try {
    userList.innerHTML = `
      <div class="loading-container">
        <div class="dots-loader"><div></div><div></div><div></div></div>
        <div style="color:#666;font-size:14px;">사용자 목록을 불러오는 중...</div>
      </div>
    `;

    console.log('[loadUsers] 🚀 사용자 목록 로드 시작');
    const result = await apiGetUsers();
    console.log('[loadUsers] 📥 apiGetUsers 결과:', { 
      success: result?.success, 
      itemsCount: result?.items?.length || 0,
      error: result?.error 
    });
    
    if (!result || !result.success) {
      console.error('[loadUsers] ❌ 사용자 목록 로드 실패:', result?.error);
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
    console.log('[loadUsers] 👥 사용자 목록:', { 
      totalUsers: users.length,
      userIds: users.map(u => u.id),
      userNames: users.map(u => u.name)
    });

    if (users.length === 0) {
      console.warn('[loadUsers] ⚠️ 등록된 사용자가 없습니다.');
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
      if (typeof setProfileSearchUserCountText === 'function') {
        setProfileSearchUserCountText([]);
      }
      const profileSubtitleEmpty = document.getElementById('profileScreenSubtitle');
      if (profileSubtitleEmpty) {
        var _lg =
          typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true
            ? '1'
            : typeof getLoginUserGrade === 'function'
              ? getLoginUserGrade()
              : '2';
        if (typeof isStelvioAdminGrade === 'function' ? isStelvioAdminGrade(_lg) : String(_lg).trim() === '1') {
          profileSubtitleEmpty.textContent = '현재 가입자 수(전체) : 0 명';
          profileSubtitleEmpty.style.display = '';
        } else {
          profileSubtitleEmpty.textContent = '';
          profileSubtitleEmpty.style.display = 'none';
        }
      }
      return;
    }

    let viewer = null, authUser = null;
    try { viewer   = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
    try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}

    const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
    const isTempAdmin  = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
    /** 프로필 카드 권한(수정·대시보드): 로그인 계정 기준 — 관리자가 다른 프로필을 선택해도 전체 관리 UI 유지 */
    const loginGradeRaw =
      isTempAdmin
        ? '1'
        : (typeof getLoginUserGrade === 'function' ? getLoginUserGrade() : String(mergedViewer?.grade ?? '2'));
    const isLoginAdmin =
      isTempAdmin ||
      (typeof isStelvioAdminGrade === 'function' && isStelvioAdminGrade(loginGradeRaw));
    const profileCardGrade = isLoginAdmin ? '1' : String(loginGradeRaw).trim();

    const viewerId = (mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null;

    console.log('[loadUsers] 🔐 권한 확인:', { 
      profileCardGrade,
      isLoginAdmin,
      viewerId,
      isTempAdmin,
      mergedViewerName: mergedViewer?.name 
    });

    // 목록 노출: 로그인이 관리자면 API 전체(users) — 선택 프로필 등급(getViewerGrade)과 무관
    let visibleUsers = users;
    if (isLoginAdmin) {
      visibleUsers = users;
      console.log('[loadUsers] ✅ 로그인 관리자 - 전체 사용자 표시:', visibleUsers.length);
    } else if (profileCardGrade === '2' || profileCardGrade === '3') {
      if (viewerId) {
        visibleUsers = users.filter(u => String(u.id) === viewerId);
        console.log('[loadUsers] 👤 일반·코치 - 본인 계정만 표시:', visibleUsers.length);
      } else {
        visibleUsers = [];
        console.warn('[loadUsers] ⚠️ viewerId가 없어 빈 목록 반환');
      }
    }

    visibleUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    const totalMemberCountForAdmin = isLoginAdmin ? users.length : visibleUsers.length;

    // 로그인 관리자일 때만 검색 섹션 표시 및 전체 목록 저장 (검색 시 사용)
    const searchSection = document.getElementById('profileSearchSection');
    if (searchSection) {
      if (isLoginAdmin) {
        searchSection.style.display = 'block';
        window._profileScreenAllUsers = visibleUsers.slice();
        window._profileScreenContext = { viewerGrade: profileCardGrade, viewerId };
        const nameInput = document.getElementById('profileSearchName');
        const contactInput = document.getElementById('profileSearchContact');
        if (nameInput) nameInput.value = '';
        if (contactInput) contactInput.value = '';
        if (typeof setProfileSearchUserCountText === 'function') {
          setProfileSearchUserCountText(visibleUsers);
        }
      } else {
        searchSection.style.display = 'none';
        window._profileScreenAllUsers = null;
        window._profileScreenContext = null;
      }
    }

    renderProfileUserCards(visibleUsers, profileCardGrade, viewerId);
    const profileSubtitle = document.getElementById('profileScreenSubtitle');
    if (profileSubtitle) {
      if (isLoginAdmin) {
        profileSubtitle.textContent = '현재 가입자 수(전체) : ' + totalMemberCountForAdmin + ' 명';
        profileSubtitle.style.display = '';
      } else {
        profileSubtitle.textContent = '';
        profileSubtitle.style.display = 'none';
      }
    }
    if (visibleUsers.length > 0 && typeof window.refreshProfileMaxHrAndRerender === 'function') {
      window.refreshProfileMaxHrAndRerender(visibleUsers, profileCardGrade, viewerId).catch(() => {});
    }

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

    try {
      var uidSync = null;
      if (typeof window !== 'undefined' && window.auth && window.auth.currentUser && window.auth.currentUser.uid) {
        uidSync = String(window.auth.currentUser.uid);
      } else if (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) {
        uidSync = String(window.authV9.currentUser.uid);
      }
      if (uidSync && users.length) {
        var meRow = users.find(function (u) {
          return u && String(u.id) === uidSync;
        });
        if (meRow && meRow.grade != null) {
          var auStr = localStorage.getItem('authUser');
          if (auStr) {
            var au = JSON.parse(auStr);
            if (au && String(au.grade) !== String(meRow.grade)) {
              au.grade = String(meRow.grade);
              localStorage.setItem('authUser', JSON.stringify(au));
            }
          }
        }
      }
    } catch (e) {}

    if (typeof window.refreshSettingsModalAdminExtras === 'function') {
      try {
        window.refreshSettingsModalAdminExtras();
      } catch (_) {}
    }
    if (typeof window.syncGeminiApiRegistrationFromLocalStorage === 'function') {
      try {
        window.syncGeminiApiRegistrationFromLocalStorage();
      } catch (_) {}
    }
    if (typeof window.updateSettingsGeminiApiStatusLine === 'function') {
      try {
        window.updateSettingsGeminiApiStatusLine();
      } catch (_) {}
    }

    console.log('[loadUsers] ✅ 사용자 목록 렌더링 완료:', { 
      totalUsers: users.length,
      visibleUsers: visibleUsers.length,
      profileCardGrade
    });
    
    if (typeof showToast === 'function') {
      showToast('사용자 정보를 불러왔습니다.');
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
    
  } catch (error) {
    console.error('사용자 선택 실패:', error);
    showToast('사용자 선택 중 오류가 발생했습니다.');
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
    const birthYearEl = document.getElementById('userBirthYear');
    const genderEl = document.getElementById('userGender');
    const challengeSelect = document.getElementById('userChallenge');
    
    if (nameEl) nameEl.value = '';
    if (contactEl) contactEl.value = '';
    if (ftpEl) ftpEl.value = '';
    if (birthYearEl) birthYearEl.value = '';
    if (genderEl) genderEl.value = '';
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
        // 기본값: 오늘 + 6개월
        const defaultDate = new Date();
        defaultDate.setMonth(defaultDate.getMonth() + 6);
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
  const birthYear = parseInt(document.getElementById('userBirthYear').value);
  const gender = document.getElementById('userGender')?.value;
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

  if (!name) { showToast('이름을 입력해주세요.'); return; }
  if (!ftp || ftp < 50 || ftp > 600) { showToast('올바른 FTP 값을 입력해주세요. (50-600W)'); return; }
  if (!weight || weight < 30 || weight > 200) { showToast('올바른 체중을 입력해주세요. (30-200kg)'); return; }
  if (!birthYear || birthYear < 1900) { showToast('올바른 생년을 입력해주세요. (1900년 이상)'); return; }
  if (!gender || (gender !== '남' && gender !== '여')) { showToast('성별을 선택해주세요.'); return; }

  try {
    // 기본 사용자 데이터
    const userData = { 
      name, 
      contact: contactDB, 
      ftp, 
      weight,
      birth_year: birthYear,
      gender: gender,
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
      if (expiryEl && expiryEl.value) userData.expiry_date = normalizeExpiryDate(expiryEl.value);
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
    // 권한 판단 시 로그인 사용자(authUser) 우선: 프로필 선택으로 currentUser가 다른 사용자로 바뀌어도 관리자(grade=1) 수정 가능
    const viewerGrade = isTempAdmin
      ? '1'
      : (authUser && authUser.grade != null)
        ? String(authUser.grade)
        : (typeof getViewerGrade === 'function'
            ? String(getViewerGrade())
            : String(mergedViewer?.grade ?? '2'));
    const viewerId = (authUser && authUser.id != null) ? String(authUser.id) : ((mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null);
    
    // 권한 확인: 관리자(grade=1)만 모든 사용자 수정 가능, 일반 사용자(grade=2,3)는 본인만 수정 가능
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
    
    // 비밀번호 변경 섹션 표시/숨김 처리 (본인 계정만 표시)
    const passwordSection = document.getElementById('editPasswordSection');
    const isOwnAccount = (viewerId && String(userId) === viewerId);
    if (passwordSection) {
      passwordSection.style.display = isOwnAccount ? 'block' : 'none';
      
      // 비밀번호 입력 필드 초기화
      if (isOwnAccount) {
        const currentPasswordEl = document.getElementById('editCurrentPassword');
        const newPasswordEl = document.getElementById('editNewPassword');
        const newPasswordConfirmEl = document.getElementById('editNewPasswordConfirm');
        const passwordStatusEl = document.getElementById('editPasswordStatus');
        
        if (currentPasswordEl) currentPasswordEl.value = '';
        if (newPasswordEl) newPasswordEl.value = '';
        if (newPasswordConfirmEl) newPasswordConfirmEl.value = '';
        if (passwordStatusEl) {
          passwordStatusEl.textContent = '';
          passwordStatusEl.style.display = 'none';
          passwordStatusEl.className = '';
        }
      }
    }
    
    // 관리자 전용 필드 섹션 표시/숨김 처리 (위에서 선언한 viewerGrade 재사용, grade=1만 관리자)
    const isAdmin = (viewerGrade === '1');
    const adminFieldsSection = document.getElementById('editAdminFieldsSection');
    if (adminFieldsSection) {
      adminFieldsSection.style.display = isAdmin ? 'block' : 'none';
    }
    
    // 관리자 비밀번호 초기화 섹션 표시/숨김 처리
    const adminPasswordResetSection = document.getElementById('adminPasswordResetSection');
    if (adminPasswordResetSection) {
      adminPasswordResetSection.style.display = isAdmin ? 'block' : 'none';
      
      // 관리자인 경우 비밀번호 입력 필드 초기화
      if (isAdmin) {
        const tempPasswordEl = document.getElementById('adminTempPassword');
        const tempPasswordConfirmEl = document.getElementById('adminTempPasswordConfirm');
        const passwordStatusEl = document.getElementById('adminPasswordResetStatus');
        
        if (tempPasswordEl) tempPasswordEl.value = '';
        if (tempPasswordConfirmEl) tempPasswordConfirmEl.value = '';
        if (passwordStatusEl) {
          passwordStatusEl.textContent = '';
          passwordStatusEl.style.display = 'none';
          passwordStatusEl.className = '';
        }
      }
    }
    
    // 폼 데이터 채우기
    const fillFormData = () => {
      // 기본 필드
      const nameEl = document.getElementById('editUserName');
      const contactEl = document.getElementById('editUserContact');
      const ftpEl = document.getElementById('editUserFTP');
      const weightEl = document.getElementById('editUserWeight');
      const birthYearEl = document.getElementById('editUserBirthYear');
      const genderEl = document.getElementById('editUserGender');
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
      if (birthYearEl) birthYearEl.value = user.birth_year || '';
      if (genderEl) genderEl.value = user.gender || '';
      if (challengeSelect) challengeSelect.value = user.challenge || 'Fitness';
      
      // 관리자 전용 필드
      if (gradeEl) gradeEl.value = String(user.grade || '2');
      if (expiryEl && user.expiry_date) {
        // Firestore Timestamp 객체 처리
        let expiryDateStr = '';
        if (user.expiry_date && typeof user.expiry_date === 'object') {
          // Firestore Timestamp 객체인 경우
          if (user.expiry_date.toDate) {
            expiryDateStr = user.expiry_date.toDate().toISOString().substring(0, 10);
          } else if (user.expiry_date.seconds) {
            // Timestamp 객체이지만 toDate 메서드가 없는 경우
            expiryDateStr = new Date(user.expiry_date.seconds * 1000).toISOString().substring(0, 10);
          } else {
            // 일반 Date 객체인 경우
            expiryDateStr = new Date(user.expiry_date).toISOString().substring(0, 10);
          }
        } else if (typeof user.expiry_date === 'string') {
          // 문자열인 경우
          expiryDateStr = user.expiry_date.substring(0, 10);
        }
        expiryEl.value = expiryDateStr;
      }
      if (accPointsEl) accPointsEl.value = user.acc_points || '';
      if (remPointsEl) remPointsEl.value = user.rem_points || '';
      if (lastTrainingDateEl && user.last_training_date) {
        // Firestore Timestamp 객체 처리
        let lastTrainingDateStr = '';
        if (user.last_training_date && typeof user.last_training_date === 'object') {
          // Firestore Timestamp 객체인 경우
          if (user.last_training_date.toDate) {
            lastTrainingDateStr = user.last_training_date.toDate().toISOString().substring(0, 10);
          } else if (user.last_training_date.seconds) {
            // Timestamp 객체이지만 toDate 메서드가 없는 경우
            lastTrainingDateStr = new Date(user.last_training_date.seconds * 1000).toISOString().substring(0, 10);
          } else {
            // 일반 Date 객체인 경우
            lastTrainingDateStr = new Date(user.last_training_date).toISOString().substring(0, 10);
          }
        } else if (typeof user.last_training_date === 'string') {
          // 문자열인 경우
          lastTrainingDateStr = user.last_training_date.substring(0, 10);
        }
        lastTrainingDateEl.value = lastTrainingDateStr;
      }
      if (stravaAccessTokenEl) stravaAccessTokenEl.value = user.strava_access_token || '';
      if (stravaRefreshTokenEl) stravaRefreshTokenEl.value = user.strava_refresh_token || '';
      if (stravaExpiresAtEl) stravaExpiresAtEl.value = user.strava_expires_at || '';
    };
    
    fillFormData();
    
    // 모달 표시 — body 최상단으로 이동해 stacking context 문제 방지
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.style.setProperty('z-index', '10100300', 'important');
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

  // 저장 중 오버레이 표시
  const savingOverlay = document.getElementById('editUserModalSavingOverlay');
  if (savingOverlay) {
    savingOverlay.classList.remove('hidden');
  }

  // 권한 체크
  let viewer = null, authUser = null;
  try { viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}
  try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch(_) {}
  
  const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
  const isTempAdmin = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
  // 권한 판단 시 로그인 사용자(authUser) 우선: 프로필 선택으로 currentUser가 다른 사용자로 바뀌어도 관리자(grade=1) 수정 버튼 동작
  const viewerGrade = isTempAdmin
    ? '1'
    : (authUser && authUser.grade != null)
      ? String(authUser.grade)
      : (typeof getViewerGrade === 'function'
          ? String(getViewerGrade())
          : String(mergedViewer?.grade ?? '2'));
  const viewerId = (authUser && authUser.id != null) ? String(authUser.id) : ((mergedViewer && mergedViewer.id != null) ? String(mergedViewer.id) : null);
  
  // 권한 확인: 관리자(grade=1)만 모든 사용자 수정 가능, 일반 사용자(grade=2,3)는 본인만 수정 가능
  if (viewerGrade !== '1' && (!viewerId || String(currentEditUserId) !== viewerId)) {
    // 오버레이 숨기기
    if (savingOverlay) {
      savingOverlay.classList.add('hidden');
    }
    showToast('본인 계정만 수정할 수 있습니다.', 'warning');
    return;
  }

  // 기본 필수 필드
  const name = document.getElementById('editUserName')?.value.trim();
  const contactRaw = document.getElementById('editUserContact')?.value.trim();
  const contactDB  = formatPhoneForDB(contactRaw);
  let ftp = parseInt(document.getElementById('editUserFTP')?.value);
  const weight = parseFloat(document.getElementById('editUserWeight')?.value);
  const birthYear = parseInt(document.getElementById('editUserBirthYear')?.value);
  const gender = document.getElementById('editUserGender')?.value;
  const challenge = document.getElementById('editUserChallenge')?.value || 'Fitness';

  // FTP 최소값 적용 (몸무게의 1.8배)
  let ftpUsedMin = false;
  if (weight && typeof getFtpMinFromWeight === 'function') {
    const minFtp = getFtpMinFromWeight(weight);
    if (ftp < minFtp) {
      ftp = minFtp;
      ftpUsedMin = true;
    }
  }

  if (!name || !ftp || !weight || !birthYear || !gender) {
    // 오버레이 숨기기
    if (savingOverlay) {
      savingOverlay.classList.add('hidden');
    }
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    // 기본 사용자 데이터
    const userData = {
      name,
      contact: contactDB,
      ftp,
      weight,
      birth_year: birthYear,
      gender: gender,
      challenge
    };

    // 관리자 전용 필드 업데이트 (grade=1만 관리자 권한)
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
      if (expiryEl && expiryEl.value) userData.expiry_date = normalizeExpiryDate(expiryEl.value);
      if (accPointsEl && accPointsEl.value !== '') userData.acc_points = parseFloat(accPointsEl.value) || 0;
      if (remPointsEl && remPointsEl.value !== '') userData.rem_points = parseFloat(remPointsEl.value) || 0;
      if (lastTrainingDateEl && lastTrainingDateEl.value) userData.last_training_date = lastTrainingDateEl.value;
      if (stravaAccessTokenEl) userData.strava_access_token = stravaAccessTokenEl.value.trim() || '';
      if (stravaRefreshTokenEl) userData.strava_refresh_token = stravaRefreshTokenEl.value.trim() || '';
      if (stravaExpiresAtEl && stravaExpiresAtEl.value) userData.strava_expires_at = parseInt(stravaExpiresAtEl.value) || 0;
    }

    const result = await apiUpdateUser(currentEditUserId, userData);

    // 오버레이 숨기기
    if (savingOverlay) {
      savingOverlay.classList.add('hidden');
    }

    if (result.success) {
      if (ftpUsedMin && typeof showToast === 'function') {
        showToast('FTP가 최소입력값(몸무게의 1.8배)으로 설정되었습니다.');
      }
      showToast('사용자 정보가 수정되었습니다.');
      closeEditUserModal();
      loadUsers();
    } else {
      showToast('사용자 수정 실패: ' + result.error);
    }

  } catch (error) {
    console.error('사용자 업데이트 실패:', error);
    // 오버레이 숨기기
    if (savingOverlay) {
      savingOverlay.classList.add('hidden');
    }
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
  const birthYearEl = document.getElementById('completeUserBirthYear');
  const genderEl = document.getElementById('completeUserGender');
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
  if (weightEl && weightEl.value && typeof syncFtpFromWeight === 'function') {
    syncFtpFromWeight('completeUserFTP', 'completeUserWeight');
  }
  if (birthYearEl) birthYearEl.value = userData.birth_year || userData.birthYear || '';
  if (genderEl) genderEl.value = userData.gender || userData.sex || '';
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
  const birthYear = parseInt(document.getElementById('completeUserBirthYear')?.value);
  const gender = document.getElementById('completeUserGender')?.value?.trim();
  const challenge = document.getElementById('completeUserChallenge')?.value;
  
  if (!contactRaw) {
    showToast('전화번호를 입력해주세요.');
    return;
  }
  if (!birthYear || birthYear < 1900 || birthYear > new Date().getFullYear()) {
    showToast('올바른 생년을 입력해주세요. (1900년 이상)');
    return;
  }
  if (!gender || (gender !== '남' && gender !== '여')) {
    showToast('성별을 선택해주세요.');
    return;
  }
  if (!weight || weight < 30 || weight > 200) {
    showToast('올바른 체중을 입력해주세요. (30-200kg)');
    return;
  }
  const minFtp = getFtpMinFromWeight(weight);
  let ftpToUse = ftp;
  let ftpUsedMin = false;
  if (!ftpToUse || ftpToUse < minFtp) {
    ftpToUse = minFtp;
    ftpUsedMin = true;
  }
  if (ftpToUse > 600) {
    showToast('FTP는 600 이하여야 합니다.');
    return;
  }
  if (!challenge) {
    showToast('운동 목적을 선택해주세요.');
    return;
  }
  
  try {
    const contactDB = formatPhoneForDB(contactRaw);
    
    // 6개월 무료 연장 적용 (사용자 정보 입력 완료 시)
    const extendedExpiryDate = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 6); // 오늘 + 6개월
      return d.toISOString().split('T')[0];
    })();
    
    // 사용자 정보 업데이트 (6개월 연장 + 나이·성별 포함)
    const updateData = {
      contact: contactDB,
      ftp: ftpToUse,
      weight: weight,
      birth_year: birthYear,
      gender: gender,
      challenge: challenge,
      expiry_date: normalizeExpiryDate(extendedExpiryDate) // 6개월 무료 연장 적용
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
        if (ftpUsedMin) {
          showToast('FTP가 최소입력값(몸무게의 1.8배)으로 설정되었습니다.');
        }
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
  const birthYear = parseInt(document.getElementById('userBirthYear').value);
  const gender = document.getElementById('userGender')?.value;
  const challenge = document.getElementById('userChallenge')?.value || 'Fitness';

  if (!name || !ftp || !weight || !birthYear || !gender) {
    showToast('모든 필수 필드를 입력해주세요.');
    return;
  }

  try {
    const userData = {
      name,
      contact: contactDB,
      ftp,
      weight,
      birth_year: birthYear,
      gender: gender,
      challenge
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
      if (expiryEl && expiryEl.value) userData.expiry_date = normalizeExpiryDate(expiryEl.value);
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
  const viewerId = mergedViewer?.id || mergedViewer?.uid || null;
  const isTempAdmin = (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true);
  const viewerGrade = isTempAdmin
    ? '1'
    : (typeof getViewerGrade === 'function'
        ? String(getViewerGrade())
        : String(mergedViewer?.grade ?? '2'));
  
  // 권한 체크: 관리자 또는 본인 계정만 삭제 가능
  const isAdmin = viewerGrade === '1';
  const isOwnAccount = viewerId && String(userId) === String(viewerId);
  
  if (!isAdmin && !isOwnAccount) {
    showToast('삭제 권한이 없습니다. 본인 계정만 삭제할 수 있습니다.', 'warning');
    return;
  }
  
  // 본인 계정 삭제 시 경고 메시지
  const confirmMessage = isOwnAccount
    ? '정말로 본인 계정을 삭제하시겠습니까?\n삭제된 계정의 훈련 기록도 함께 삭제되며, 재가입 시에도 기존 계정으로 인식될 수 있습니다.\n계정을 삭제하면 로그아웃됩니다.'
    : '정말로 이 사용자를 삭제하시겠습니까?\n삭제된 사용자의 훈련 기록도 함께 삭제됩니다.';
  
  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    const result = await apiDeleteUser(userId);
    
    if (result.success) {
      showToast('사용자가 삭제되었습니다.');
      
      // 본인 계정 삭제 시 로그아웃 처리
      if (isOwnAccount) {
        try {
          // 로그아웃 처리
          if (typeof window.handleLogout === 'function') {
            await window.handleLogout();
          } else {
            if (window.auth?.currentUser) {
              await window.auth.signOut();
            }
            if (window.authV9?.currentUser) {
              var signOutMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
              var signOut = signOutMod && signOutMod.signOut;
              if (signOut) await signOut(window.authV9);
            }
          }
          // 프로필 선택 화면으로 이동
          if (typeof showScreen === 'function') {
            showScreen('profileScreen');
          }
        } catch (logoutError) {
          console.error('로그아웃 실패:', logoutError);
          // 프로필 선택 화면으로 이동
          if (typeof showScreen === 'function') {
            showScreen('profileScreen');
          }
        }
      }
      
      loadUsers();
    } else {
      showToast('사용자 삭제 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    
    // 최근 로그인 필요 오류 처리
    if (error.code === 'auth/requires-recent-login') {
      showToast('보안을 위해 최근에 로그인한 후 다시 시도해주세요.', 'warning');
    } else {
      showToast('사용자 삭제 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
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

/**
 * 사용자 비밀번호 변경 (본인 계정만)
 */
async function changeUserPassword() {
  const currentPasswordEl = document.getElementById('editCurrentPassword');
  const newPasswordEl = document.getElementById('editNewPassword');
  const newPasswordConfirmEl = document.getElementById('editNewPasswordConfirm');
  const passwordStatusEl = document.getElementById('editPasswordStatus');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  
  if (!currentPasswordEl || !newPasswordEl || !newPasswordConfirmEl || !passwordStatusEl || !changePasswordBtn) {
    console.error('비밀번호 변경 요소를 찾을 수 없습니다.');
    return;
  }
  
  const currentPassword = currentPasswordEl.value.trim();
  const newPassword = newPasswordEl.value.trim();
  const newPasswordConfirm = newPasswordConfirmEl.value.trim();
  
  // 입력값 검증
  if (!currentPassword) {
    showPasswordStatus('현재 비밀번호를 입력해주세요.', 'error');
    currentPasswordEl.focus();
    return;
  }
  
  if (!newPassword || newPassword.length < 6) {
    showPasswordStatus('새 비밀번호는 6자 이상이어야 합니다.', 'error');
    newPasswordEl.focus();
    return;
  }
  
  if (newPassword !== newPasswordConfirm) {
    showPasswordStatus('새 비밀번호가 일치하지 않습니다.', 'error');
    newPasswordConfirmEl.focus();
    return;
  }
  
  if (currentPassword === newPassword) {
    showPasswordStatus('현재 비밀번호와 새 비밀번호가 같습니다.', 'error');
    newPasswordEl.focus();
    return;
  }
  
  try {
    changePasswordBtn.disabled = true;
    changePasswordBtn.textContent = '변경 중...';
    showPasswordStatus('비밀번호를 변경하고 있습니다...', 'info');
    
    // 현재 로그인한 사용자 확인
    const currentUser = window.authV9?.currentUser;
    if (!currentUser) {
      throw new Error('로그인한 사용자를 찾을 수 없습니다. 다시 로그인해주세요.');
    }
    
    // 현재 비밀번호로 재인증
    const email = currentUser.email;
    if (!email) {
      throw new Error('이메일 정보를 찾을 수 없습니다.');
    }
    
    if (!window.EmailAuthProviderV9 || !window.reauthenticateWithCredentialV9) {
      throw new Error('Firebase Auth 함수가 로드되지 않았습니다.');
    }
    
    const credential = window.EmailAuthProviderV9.credential(email, currentPassword);
    await window.reauthenticateWithCredentialV9(currentUser, credential);
    
    // 새 비밀번호로 변경
    if (!window.updatePasswordV9) {
      throw new Error('비밀번호 변경 함수가 로드되지 않았습니다.');
    }
    
    await window.updatePasswordV9(currentUser, newPassword);
    
    showPasswordStatus('✅ 비밀번호가 성공적으로 변경되었습니다.', 'success');
    
    // 입력 필드 초기화
    currentPasswordEl.value = '';
    newPasswordEl.value = '';
    newPasswordConfirmEl.value = '';
    
    // 3초 후 상태 메시지 숨기기
    setTimeout(() => {
      passwordStatusEl.style.display = 'none';
    }, 3000);
    
  } catch (error) {
    console.error('비밀번호 변경 실패:', error);
    
    let errorMessage = '비밀번호 변경에 실패했습니다.';
    if (error.code === 'auth/wrong-password') {
      errorMessage = '현재 비밀번호가 올바르지 않습니다.';
      currentPasswordEl.focus();
      currentPasswordEl.value = '';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = '새 비밀번호는 6자 이상이어야 합니다.';
      newPasswordEl.focus();
    } else if (error.code === 'auth/requires-recent-login') {
      errorMessage = '보안을 위해 다시 로그인한 후 비밀번호를 변경해주세요.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    showPasswordStatus(errorMessage, 'error');
    
    // 입력 필드 초기화
    currentPasswordEl.value = '';
    newPasswordEl.value = '';
    newPasswordConfirmEl.value = '';
  } finally {
    changePasswordBtn.disabled = false;
    changePasswordBtn.textContent = '비밀번호 변경';
  }
}

/**
 * 비밀번호 변경 상태 메시지 표시
 */
function showPasswordStatus(message, type = 'info') {
  const passwordStatusEl = document.getElementById('editPasswordStatus');
  if (passwordStatusEl) {
    passwordStatusEl.textContent = message;
    passwordStatusEl.className = '';
    passwordStatusEl.style.display = 'block';
    
    // 타입에 따른 스타일 적용
    if (type === 'success') {
      passwordStatusEl.style.background = '#d1fae5';
      passwordStatusEl.style.color = '#059669';
      passwordStatusEl.style.border = '1px solid #10b981';
    } else if (type === 'error') {
      passwordStatusEl.style.background = '#fee2e2';
      passwordStatusEl.style.color = '#dc2626';
      passwordStatusEl.style.border = '1px solid #ef4444';
    } else {
      passwordStatusEl.style.background = '#eef2ff';
      passwordStatusEl.style.color = '#667eea';
      passwordStatusEl.style.border = '1px solid #818cf8';
    }
  }
}

// 전역 함수로 등록
window.changeUserPassword = changeUserPassword;

/**
 * 관리자 비밀번호 초기화 (관리자 전용)
 * Firebase HTTPS Function(adminResetUserPasswordHttp)을 호출하여 대상 사용자 비밀번호를 실제로 변경합니다.
 * Cloud Function이 배포되어 있어야 동작하며, 호출자는 Firestore users/{uid}.grade === 1 이어야 합니다.
 */
async function adminResetUserPassword() {
  const tempPasswordEl = document.getElementById('adminTempPassword');
  const tempPasswordConfirmEl = document.getElementById('adminTempPasswordConfirm');
  const passwordStatusEl = document.getElementById('adminPasswordResetStatus');
  const resetBtn = document.getElementById('adminResetPasswordBtn');
  
  if (!tempPasswordEl || !tempPasswordConfirmEl || !passwordStatusEl || !resetBtn) {
    console.error('관리자 비밀번호 초기화 요소를 찾을 수 없습니다.');
    return;
  }
  
  const tempPassword = tempPasswordEl.value.trim();
  const tempPasswordConfirm = tempPasswordConfirmEl.value.trim();
  
  // 입력값 검증
  if (!tempPassword || tempPassword.length < 6) {
    showAdminPasswordStatus('임시 비밀번호는 6자 이상이어야 합니다.', 'error');
    tempPasswordEl.focus();
    return;
  }
  
  if (tempPassword !== tempPasswordConfirm) {
    showAdminPasswordStatus('임시 비밀번호가 일치하지 않습니다.', 'error');
    tempPasswordConfirmEl.focus();
    return;
  }
  
  // 현재 수정 중인 사용자 ID 확인
  if (!currentEditUserId) {
    showAdminPasswordStatus('사용자 ID를 찾을 수 없습니다.', 'error');
    return;
  }
  
  try {
    resetBtn.disabled = true;
    resetBtn.textContent = '처리 중...';
    showAdminPasswordStatus('비밀번호를 초기화하고 있습니다...', 'info');
    
    // onRequest 함수 호출 (CORS 수동 처리로 preflight 통과) — ID 토큰으로 인증
    const currentUser = (window.authV9 && window.authV9.currentUser) ? window.authV9.currentUser : null;
    if (!currentUser) {
      showAdminPasswordStatus('비밀번호 초기화를 하려면 관리자 계정으로 로그인한 뒤 다시 시도해주세요.', 'error');
    } else {
      const projectId = (window.authV9 && window.authV9.app && window.authV9.app.options && window.authV9.app.options.projectId) || 'stelvio-ai';
      const url = 'https://us-central1-' + projectId + '.cloudfunctions.net/adminResetUserPasswordHttp';
      let idToken;
      try {
        idToken = await currentUser.getIdToken();
      } catch (tokenErr) {
        console.error('[adminResetUserPassword] getIdToken 실패:', tokenErr);
        showAdminPasswordStatus('로그인 정보를 가져오지 못했습니다. 다시 로그인한 뒤 시도해 주세요.', 'error');
        return;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ targetUserId: currentEditUserId, newPassword: tempPassword })
      });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        showAdminPasswordStatus('응답을 읽는 중 오류가 발생했습니다.', 'error');
        return;
      }
      const result = data && data.result ? data.result : null;
      const error = data && data.error ? data.error : null;
      if (res.ok && result && result.success === true) {
        showAdminPasswordStatus('✅ 비밀번호가 초기화되었습니다. 해당 사용자는 새 비밀번호로 로그인할 수 있습니다.', 'success');
        tempPasswordEl.value = '';
        tempPasswordConfirmEl.value = '';
        setTimeout(function () {
          if (passwordStatusEl) passwordStatusEl.style.display = 'none';
        }, 5000);
      } else {
        const errMsg = (error && error.message) ? error.message : '비밀번호 초기화에 실패했습니다.';
        showAdminPasswordStatus(errMsg, 'error');
      }
    }
    
  } catch (error) {
    const errCode = (error && (error.code || error.details?.code)) || '';
    const errMsgRaw = (error && (error.message || error.details?.message)) || '비밀번호 초기화 중 오류가 발생했습니다.';
    console.error('[adminResetUserPassword] 실패 code=', errCode, 'message=', errMsgRaw, 'error=', error);
    let errMsg = errMsgRaw;
    if (error && error.details) errMsg = (error.details.message || errMsg) + (error.details.details ? ' ' + JSON.stringify(error.details.details) : '');
    // "Internal" 등 영문 코드가 그대로 노출되는 경우 한글 안내로 대체
    if (/^internal$/i.test(String(errMsg).trim()) || (errCode === 'functions/internal' || errCode === 'internal')) {
      errMsg = '비밀번호 변경 처리 중 일시적인 오류가 발생했습니다.\n\n'
        + '• F12 > 콘솔에서 code/message를 확인해 보세요.\n'
        + '• 앱을 https://stelvio.ai.kr 에서 열고 다시 시도해 보세요.\n'
        + '• 그래도 실패하면 Firebase 콘솔 > Functions > 로그에서 서버 오류를 확인해 주세요.';
    }
    showAdminPasswordStatus(errMsg, 'error');
  } finally {
    resetBtn.disabled = false;
    resetBtn.textContent = '비밀번호 초기화';
  }
}

/**
 * 관리자 비밀번호 초기화 상태 메시지 표시
 */
function showAdminPasswordStatus(message, type = 'info') {
  const passwordStatusEl = document.getElementById('adminPasswordResetStatus');
  if (passwordStatusEl) {
    passwordStatusEl.textContent = message;
    passwordStatusEl.className = '';
    passwordStatusEl.style.display = 'block';
    passwordStatusEl.style.whiteSpace = 'pre-line'; // 줄바꿈 허용
    
    // 타입에 따른 스타일 적용
    if (type === 'success') {
      passwordStatusEl.style.background = '#d1fae5';
      passwordStatusEl.style.color = '#059669';
      passwordStatusEl.style.border = '1px solid #10b981';
    } else if (type === 'error') {
      passwordStatusEl.style.background = '#fee2e2';
      passwordStatusEl.style.color = '#dc2626';
      passwordStatusEl.style.border = '1px solid #ef4444';
    } else {
      passwordStatusEl.style.background = '#eef2ff';
      passwordStatusEl.style.color = '#667eea';
      passwordStatusEl.style.border = '1px solid #818cf8';
    }
  }
}

// 전역 함수로 등록
window.adminResetUserPassword = adminResetUserPassword;
window.deleteUser = deleteUser;
window.saveUser = saveUser;
window.selectProfile = selectUser;
window.showExpiryWarningModal = showExpiryWarningModal;
window.closeExpiryWarningModal = closeExpiryWarningModal;

/**
 * Performance Dashboard 화면 표시
 * @param {string} userId - 사용자 ID (선택사항, 없으면 현재 사용자)
 */
function showPerformanceDashboard(userId) {
  // 사용자 선택 (대시보드에서 사용)
  if (userId) {
    // 해당 사용자 정보를 가져와서 currentUser로 설정
    apiGetUser(userId).then(result => {
      if (result.success) {
        var user = result.item;
        // 구독 만료 사용자 제한
        if (typeof isUserExpired === 'function' && isUserExpired(user)) {
          if (typeof showExpiryRestrictionModal === 'function') showExpiryRestrictionModal();
          return;
        }
        window.currentUser = user;
        localStorage.setItem('currentUser', JSON.stringify(user));
      }
      // 대시보드 화면 표시
      if (typeof showScreen === 'function') {
        showScreen('performanceDashboardScreen');
      }
    }).catch(error => {
      console.error('사용자 정보 가져오기 실패:', error);
      // 오류가 있어도 대시보드 표시
      if (typeof showScreen === 'function') {
        showScreen('performanceDashboardScreen');
      }
    });
  } else {
    // 현재 사용자로 대시보드 표시
    if (typeof showScreen === 'function') {
      showScreen('performanceDashboardScreen');
    }
  }
}

window.showPerformanceDashboard = showPerformanceDashboard;

// API 함수들 전역 노출
window.apiGetUsers   = window.apiGetUsers   || apiGetUsers;
window.apiGetUser    = window.apiGetUser    || apiGetUser;
window.apiCreateUser = window.apiCreateUser || apiCreateUser;
window.apiUpdateUser = window.apiUpdateUser || apiUpdateUser;
window.apiDeleteUser = window.apiDeleteUser || apiDeleteUser;

// 전화번호 유틸리티 함수들 전역 노출
window.formatPhoneForDB = window.formatPhoneForDB || formatPhoneForDB;
window.standardizePhoneFormat = window.standardizePhoneFormat || standardizePhoneFormat;
window.unformatPhone = window.unformatPhone || unformatPhone;

/**
 * [레거시 함수] 전화번호로 사용자 정보 찾기
 * ⚠️ 이 함수는 더 이상 사용되지 않습니다.
 * ✅ UID 직접 조회 방식으로 대체: auth.currentUser.uid → users/{uid}
 * 
 * @param {string} phoneNumber - 전화번호 (형식 무관)
 * @returns {Promise<{success: boolean, userData?: object, error?: string}>}
 * @deprecated UID 직접 조회 방식 사용 권장
 */
async function findUserByPhone(phoneNumber) {
  try {
    if (!phoneNumber) {
      return { success: false, error: '전화번호가 필요합니다.' };
    }
    
    // "010-1234-5678" 형식으로 변환
    const formattedPhone = formatPhoneForDB(phoneNumber);
    
    console.log('📞 전화번호로 사용자 찾기:', { 
      inputPhone: phoneNumber,
      formattedPhone: formattedPhone 
    });
    
    // Firestore에서 전화번호(contact 필드)로 사용자 찾기
    const usersSnapshot = await getUsersCollection().get();
    let foundUser = null;
    
    for (const doc of usersSnapshot.docs) {
      const docData = doc.data() || {};
      const docContact = docData.contact || '';
      
      // DB의 contact 필드를 "010-1234-5678" 형식으로 변환
      const formattedDocContact = formatPhoneForDB(docContact);
      
      // 형식화된 전화번호로 비교
      if (formattedDocContact === formattedPhone) {
        var foundObj = { id: doc.id };
        if (docData && typeof docData === 'object') { for (var k in docData) { if (docData.hasOwnProperty(k)) foundObj[k] = docData[k]; } }
        foundUser = foundObj;
        console.log('✅ 전화번호로 사용자 찾음:', {
          name: foundUser.name,
          contact: foundUser.contact,
          formattedContact: formattedDocContact,
          grade: foundUser.grade,
          ftp: foundUser.ftp,
          weight: foundUser.weight
        });
        break;
      }
    }
    
    if (foundUser) {
      // 전역 상태 업데이트
      window.currentUser = foundUser;
      localStorage.setItem('currentUser', JSON.stringify(foundUser));
      localStorage.setItem('authUser', JSON.stringify(foundUser));
      
      // 사용자 정보 상세 로그
      console.log('✅ 인증된 사용자 정보 설정 완료:', {
        id: foundUser.id,
        name: foundUser.name,
        contact: foundUser.contact,
        grade: foundUser.grade,
        ftp: foundUser.ftp,
        weight: foundUser.weight,
        acc_points: foundUser.acc_points,
        rem_points: foundUser.rem_points,
        challenge: foundUser.challenge,
        expiry_date: foundUser.expiry_date,
        last_training_date: foundUser.last_training_date
      });
      
      // isPhoneAuthenticated 플래그 설정
      if (typeof window !== 'undefined') {
        window.isPhoneAuthenticated = true;
      }
      
      return { success: true, userData: foundUser };
    } else {
      console.warn('⚠️ 전화번호로 사용자를 찾지 못함:', formattedPhone);
      return { success: false, error: '사용자를 찾을 수 없습니다.' };
    }
  } catch (error) {
    console.error('❌ 전화번호로 사용자 찾기 실패:', error);
    return { success: false, error: error.message };
  }
}

// 전역 노출
window.findUserByPhone = window.findUserByPhone || findUserByPhone;

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
