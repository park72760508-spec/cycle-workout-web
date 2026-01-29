/**
 * Training Room Manager
 * INDOOR RACE Training Room 생성 및 관리 로직
 */

// 전역 변수
let currentSelectedTrainingRoom = null;
let trainingRoomList = [];
// 비밀번호 인증된 Training Room ID 추적 (재인증 방지)
// 인증된 Training Room 관리 (메모리 + sessionStorage)
let authenticatedTrainingRooms = new Set();
// 디바이스 연결 방식: 'ant' 또는 'bluetooth' (기본값: 'bluetooth')
let deviceConnectionMode = 'bluetooth';

// sessionStorage에서 인증 상태 복원
function restoreAuthenticatedRooms() {
  try {
    const stored = sessionStorage.getItem('authenticatedTrainingRooms');
    if (stored) {
      const roomIds = JSON.parse(stored);
      authenticatedTrainingRooms = new Set(roomIds);
      console.log('[Training Room] 인증 상태 복원:', Array.from(authenticatedTrainingRooms));
    }
  } catch (e) {
    console.warn('[Training Room] 인증 상태 복원 실패:', e);
  }
}

// sessionStorage에 인증 상태 저장
function saveAuthenticatedRooms() {
  try {
    const roomIds = Array.from(authenticatedTrainingRooms);
    sessionStorage.setItem('authenticatedTrainingRooms', JSON.stringify(roomIds));
    console.log('[Training Room] 인증 상태 저장:', roomIds);
  } catch (e) {
    console.warn('[Training Room] 인증 상태 저장 실패:', e);
  }
}

// 초기화 시 인증 상태 복원
restoreAuthenticatedRooms();

/**
 * Training Room 목록 로드
 * id, user_id, title, password 정보를 가져옴
 */
/**
 * 모바일 환경 감지 (Live Training Rooms용 - 공통 함수 사용)
 */
function isMobileDeviceForTrainingRooms() {
  // Live Training Session의 isMobileDevice 함수가 있으면 사용, 없으면 직접 구현
  if (typeof isMobileDevice === 'function') {
    return isMobileDevice();
  }
  
  if (typeof window === 'undefined') return false;
  
  // User Agent 기반 감지
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isMobileUA = mobileRegex.test(userAgent);
  
  // 화면 크기 기반 감지 (추가 확인)
  const isMobileScreen = window.innerWidth <= 768;
  
  // 터치 지원 여부 확인
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  return isMobileUA || (isMobileScreen && isTouchDevice);
}

/**
 * 네트워크 상태 감지 (Live Training Rooms용 - 공통 함수 사용)
 */
function getNetworkInfoForTrainingRooms() {
  // Live Training Session의 getNetworkInfo 함수가 있으면 사용, 없으면 직접 구현
  if (typeof getNetworkInfo === 'function') {
    return getNetworkInfo();
  }
  
  if (typeof navigator !== 'undefined' && navigator.connection) {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      effectiveType: conn.effectiveType || 'unknown',
      downlink: conn.downlink || 0,
      rtt: conn.rtt || 0,
      saveData: conn.saveData || false
    };
  }
  return null;
}

/**
 * 타임아웃이 있는 fetch 래퍼 (모바일 최적화 적용)
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  // 모바일 환경 감지
  const isMobile = isMobileDeviceForTrainingRooms();
  const networkInfo = getNetworkInfoForTrainingRooms();
  
  // 모바일이거나 느린 네트워크인 경우 타임아웃 증가
  let adjustedTimeout = timeoutMs;
  if (isMobile) {
    adjustedTimeout = timeoutMs * 2; // 모바일은 2배
    console.log('[Training Room] 모바일 환경 감지, 타임아웃 증가:', timeoutMs, '→', adjustedTimeout, 'ms');
  }
  
  // 네트워크 상태에 따른 추가 조정
  if (networkInfo) {
    if (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g') {
      adjustedTimeout = adjustedTimeout * 1.5; // 느린 네트워크는 1.5배 추가 증가
      console.log('[Training Room] 느린 네트워크 감지:', networkInfo.effectiveType, ', 타임아웃:', adjustedTimeout, 'ms');
    } else if (networkInfo.rtt > 500) {
      adjustedTimeout = adjustedTimeout * 1.3; // 높은 지연시간은 1.3배 증가
      console.log('[Training Room] 높은 지연시간 감지:', networkInfo.rtt, 'ms, 타임아웃:', adjustedTimeout, 'ms');
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), adjustedTimeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('요청 시간 초과');
    }
    throw error;
  }
}

/**
 * Firebase Auth 상태가 확정될 때까지 대기 (onAuthStateChanged 사용)
 * 로그인 상태든 비로그인 상태든 Auth 상태가 결정될 때까지 기다립니다.
 * @param {number} maxWaitMs - 최대 대기 시간 (밀리초), 기본값: 3000ms
 * @returns {Promise<void>}
 */
async function waitForAuthReady(maxWaitMs = 3000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let unsubscribe = null;
    let timeoutId = null;
    
    console.log('[Auth Ready] Firebase Auth 상태 확정 대기 시작 (최대', maxWaitMs, 'ms)');
    
    // 타임아웃 설정
    timeoutId = setTimeout(() => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      const elapsed = Date.now() - startTime;
      console.warn('[Auth Ready] ⚠️ 타임아웃 발생 (', elapsed, 'ms 경과) - 비로그인 상태로 간주하고 진행');
      resolve(); // 타임아웃 시 비로그인 상태로 간주하고 진행
    }, maxWaitMs);
    
    try {
      // Firebase Auth 인스턴스 가져오기
      let auth = null;
      if (window.firebase && typeof window.firebase.auth === 'function') {
        auth = window.firebase.auth();
      } else if (window.auth) {
        auth = window.auth;
      }
      
      if (!auth) {
        console.warn('[Auth Ready] ⚠️ Firebase Auth 인스턴스를 찾을 수 없습니다 - 계속 진행');
        clearTimeout(timeoutId);
        resolve();
        return;
      }
      
      // onAuthStateChanged로 Auth 상태가 확정될 때까지 대기
      unsubscribe = auth.onAuthStateChanged((user) => {
        const elapsed = Date.now() - startTime;
        console.log('[Auth Ready] ✅ Firebase Auth 상태 확정 완료 (', elapsed, 'ms, 로그인:', !!user, ')');
        
        // 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        
        // Auth 상태가 확정되었으므로 resolve
        resolve();
      }, (error) => {
        const elapsed = Date.now() - startTime;
        console.error('[Auth Ready] ❌ Firebase Auth 상태 확인 오류 (', elapsed, 'ms):', error);
        
        // 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        
        // 오류 발생 시에도 계속 진행 (비로그인 상태로 간주)
        resolve();
      });
    } catch (error) {
      console.error('[Auth Ready] ❌ Firebase Auth 초기화 오류:', error);
      
      // 정리
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      
      // 오류 발생 시에도 계속 진행
      resolve();
    }
  });
}

/**
 * Firestore 인스턴스가 준비될 때까지 폴링 방식으로 대기 (모바일 최적화)
 * Firebase Auth 대기 로직 포함 (권한 오류 방지)
 * @param {number} maxWaitMs - 최대 대기 시간 (밀리초), 기본값: 모바일 10000ms, PC 5000ms
 * @returns {Promise<{db: any, useV9: boolean}>} Firestore 인스턴스와 사용할 SDK 버전
 */
async function waitForFirestore(maxWaitMs = null) {
  const isMobile = isMobileDeviceForTrainingRooms();
  const timeout = maxWaitMs || (isMobile ? 10000 : 5000); // 모바일: 10초, PC: 5초
  const pollInterval = 200; // 200ms마다 확인
  const startTime = Date.now();
  let attempt = 0;
  
  console.log('[Mobile Debug] waitForFirestore 시작 - 최대 대기:', timeout, 'ms, 모바일:', isMobile);
  
  // 모바일 환경에서는 Firebase Auth가 준비될 때까지 먼저 대기 (권한 오류 방지)
  // 주의: waitForAuthReady는 waitForFirestore 내부에서 호출하지 않음
  // loadTrainingRooms에서 직접 호출하도록 변경
  
  while (Date.now() - startTime < timeout) {
    attempt++;
    let firestoreDb = null;
    let useV9 = false;
    
    // 1순위: Firebase v8 호환 모드
    if (window.firebase && typeof window.firebase.firestore === 'function') {
      try {
        firestoreDb = window.firebase.firestore();
        useV9 = false;
        console.log('[Mobile Debug] ✅ Firestore 인스턴스 확보 성공 (v8, 시도:', attempt, ', 경과:', Date.now() - startTime, 'ms)');
        return { db: firestoreDb, useV9: false };
      } catch (e) {
        console.log('[Mobile Debug] ⏳ Firestore v8 초기화 시도 중... (시도:', attempt, ')');
      }
    }
    
    // 2순위: Firebase v9 Modular SDK
    if (!firestoreDb && window.firestoreV9) {
      firestoreDb = window.firestoreV9;
      useV9 = true;
      console.log('[Mobile Debug] ✅ Firestore 인스턴스 확보 성공 (v9, 시도:', attempt, ', 경과:', Date.now() - startTime, 'ms)');
      return { db: firestoreDb, useV9: true };
    }
    
    // 3순위: window.firestore
    if (!firestoreDb && window.firestore) {
      firestoreDb = window.firestore;
      useV9 = false;
      console.log('[Mobile Debug] ✅ Firestore 인스턴스 확보 성공 (window.firestore, 시도:', attempt, ', 경과:', Date.now() - startTime, 'ms)');
      return { db: firestoreDb, useV9: false };
    }
    
    // 아직 준비되지 않음 - 대기 후 재시도
    if (attempt % 5 === 0) { // 5번마다 로그 출력 (1초마다)
      console.log('[Mobile Debug] ⏳ Firestore 인스턴스 대기 중... (시도:', attempt, ', 경과:', Date.now() - startTime, 'ms)');
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // 타임아웃 발생
  const debugInfo = {
    hasWindowFirebase: !!(window.firebase),
    hasFirebaseFirestore: !!(window.firebase && window.firebase.firestore),
    hasFirestoreV9: !!window.firestoreV9,
    hasWindowFirestore: !!window.firestore,
    isMobile: isMobile,
    elapsed: Date.now() - startTime,
    attempts: attempt
  };
  console.error('[Mobile Debug] ❌ Firestore 인스턴스 대기 타임아웃:', debugInfo);
  throw new Error('Firestore 인스턴스를 찾을 수 없습니다. 타임아웃: ' + timeout + 'ms. 디버깅 정보: ' + JSON.stringify(debugInfo));
}

/**
 * 재시도 로직이 있는 함수 실행 (모바일 최적화 적용)
 */
async function withRetryForTrainingRooms(fn, maxRetries = 2, delayMs = 500) {
  // 모바일 환경 감지
  const isMobile = isMobileDeviceForTrainingRooms();
  const networkInfo = getNetworkInfoForTrainingRooms();
  
  // 모바일이거나 느린 네트워크인 경우 재시도 횟수 증가
  let adjustedRetries = maxRetries;
  let adjustedDelay = delayMs;
  
  if (isMobile) {
    adjustedRetries = maxRetries + 1; // 모바일은 재시도 1회 추가
    adjustedDelay = delayMs * 0.8; // 초기 지연 시간 약간 감소 (빠른 재시도)
    console.log('[Training Room] 모바일 환경 감지, 재시도 횟수 증가:', maxRetries, '→', adjustedRetries);
  }
  
  // 느린 네트워크인 경우 재시도 간격 조정
  if (networkInfo && (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g')) {
    adjustedDelay = delayMs * 1.2; // 느린 네트워크는 재시도 간격 증가
    console.log('[Training Room] 느린 네트워크 감지, 재시도 간격 조정:', delayMs, '→', adjustedDelay, 'ms');
  }
  
  let lastError;
  for (let i = 0; i < adjustedRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < adjustedRetries - 1) {
        const currentDelay = adjustedDelay * Math.pow(1.5, i); // 지수 백오프
        console.warn(`[Training Room] 재시도 ${i + 1}/${adjustedRetries} - ${Math.round(currentDelay)}ms 후 재시도...`, error.message);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      }
    }
  }
  throw lastError;
}

/**
 * 사용자 목록 가져오기 (캐싱 지원, 재시도 로직 포함)
 */
async function getUsersListWithCache() {
  // 이미 로드된 사용자 목록이 있으면 재사용 (캐싱)
  if (Array.isArray(window.users) && window.users.length > 0) {
    console.log('[Training Room] 캐시된 사용자 목록 사용:', window.users.length, '명');
    return window.users;
  }
  
  // apiGetUsers 함수 확인
  const apiGetUsersFn = typeof window.apiGetUsers === 'function' 
    ? window.apiGetUsers 
    : (typeof apiGetUsers === 'function' ? apiGetUsers : null);
  
  if (!apiGetUsersFn) {
    console.warn('[Training Room] apiGetUsers 함수를 찾을 수 없습니다.');
    // 전역 변수에서 재확인
    if (Array.isArray(window.userProfiles) && window.userProfiles.length > 0) {
      console.log('[Training Room] window.userProfiles에서 사용자 목록 사용:', window.userProfiles.length, '명');
      window.users = window.userProfiles;
      return window.userProfiles;
    }
    return [];
  }
  
  // 재시도 로직이 포함된 사용자 목록 로드 (모바일 최적화: 더 많은 재시도)
  const isMobile = isMobileDeviceForTrainingRooms();
  const networkInfo = getNetworkInfoForTrainingRooms();
  
  // 모바일 환경에서 재시도 횟수 증가
  const maxRetries = isMobile ? 4 : 2; // 모바일: 4회, PC: 2회
  const initialDelay = isMobile ? 300 : 500; // 모바일: 더 빠른 재시도
  
  // 느린 네트워크인 경우 재시도 횟수 추가 증가
  const adjustedRetries = (networkInfo && (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g')) 
    ? maxRetries + 1 
    : maxRetries;
  
  console.log('[Training Room] 사용자 목록 로드 설정:', {
    isMobile,
    networkType: networkInfo?.effectiveType || 'unknown',
    maxRetries: adjustedRetries,
    initialDelay
  });
  
  try {
    const usersResult = await withRetryForTrainingRooms(
      async () => {
        const result = await apiGetUsersFn();
        if (!result) {
          throw new Error('apiGetUsers가 undefined를 반환했습니다');
        }
        if (!result.success) {
          throw new Error(result.error || '사용자 목록 로드 실패');
        }
        if (!result.items || !Array.isArray(result.items)) {
          throw new Error('사용자 목록이 배열 형식이 아닙니다');
        }
        if (result.items.length === 0) {
          console.warn('[Training Room] 사용자 목록이 비어있습니다');
        }
        return result.items;
      },
      adjustedRetries, // 동적 재시도 횟수
      initialDelay // 동적 초기 지연
    );
    
    if (usersResult && Array.isArray(usersResult) && usersResult.length > 0) {
      window.users = usersResult; // 전역 변수에 캐시 저장
      console.log('[Training Room] ✅ 사용자 목록 로드 성공:', usersResult.length, '명');
      console.log('[Training Room] 사용자 ID 샘플:', usersResult.slice(0, 3).map(u => ({ id: u.id, name: u.name })));
      return usersResult;
    } else {
      console.warn('[Training Room] ⚠️ 사용자 목록이 비어있거나 유효하지 않습니다');
      // 전역 변수에서 재확인
      if (Array.isArray(window.userProfiles) && window.userProfiles.length > 0) {
        console.log('[Training Room] window.userProfiles에서 사용자 목록 사용:', window.userProfiles.length, '명');
        window.users = window.userProfiles;
        return window.userProfiles;
      }
    }
  } catch (userError) {
    console.error('[Training Room] ❌ 사용자 목록 로드 오류:', userError);
    console.error('[Training Room] 오류 상세:', {
      message: userError.message,
      stack: userError.stack
    });
    
    // 전역 변수에서 재확인 (폴백)
    if (Array.isArray(window.userProfiles) && window.userProfiles.length > 0) {
      console.log('[Training Room] 오류 발생, window.userProfiles에서 사용자 목록 사용:', window.userProfiles.length, '명');
      window.users = window.userProfiles;
      return window.userProfiles;
    }
  }
  
  return [];
}

/**
 * Training Room 목록 로드
 * trainingResultService.js의 안정적인 패턴을 적용하여 단순화함
 * - 복잡한 폴링/타임아웃 제거
 * - Firebase SDK 기본 기능에 충실
 * - Client-side filtering으로 인덱스 이슈 방지
 */
async function loadTrainingRooms() {
  const listContainer = document.getElementById('trainingRoomList');
  
  if (!listContainer) {
    console.error('[Training Room] 목록 컨테이너를 찾을 수 없습니다.');
    return;
  }
  
  // 로딩 UI 표시
  listContainer.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">Training Room 목록을 불러오는 중...</p>
    </div>
  `;

  try {
    // trainingResultService.js 패턴: Firestore 인스턴스 직접 가져오기 (단순화)
    // v9 우선, 없으면 v8 사용
    let db = null;
    let useV9 = false;
    
    if (window.firestoreV9) {
      db = window.firestoreV9;
      useV9 = true;
    } else if (window.firebase && typeof window.firebase.firestore === 'function') {
      db = window.firebase.firestore();
      useV9 = false;
    } else if (window.firestore) {
      db = window.firestore;
      useV9 = false;
    }
    
    if (!db) {
      throw new Error('Firestore 인스턴스를 찾을 수 없습니다. window.firestoreV9 또는 window.firebase.firestore()를 확인하세요.');
    }
    
    console.log('[Training Room] Firestore 인스턴스 확보, useV9:', useV9);
    
    // trainingResultService.js 패턴: 단순한 쿼리 실행
    // training_rooms 컬렉션 전체 조회 후 client-side filtering (인덱스 이슈 방지)
    let rooms = [];
    
    if (useV9) {
      // Firebase v9 Modular SDK (trainingResultService.js와 동일한 패턴)
      const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
      const roomsRef = collection(db, TRAINING_ROOMS_COLLECTION);
      const querySnapshot = await getDocs(roomsRef);
      
      rooms = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          title: doc.data().title || doc.data().name,
          _sourceCollection: 'training_rooms'
        }))
        .filter(room => room.status !== 'inactive'); // Client-side filtering
    } else {
      // Firebase v8 호환 모드
      const querySnapshot = await db.collection(TRAINING_ROOMS_COLLECTION).get();
      
      rooms = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          title: doc.data().title || doc.data().name,
          _sourceCollection: 'training_rooms'
        }))
        .filter(room => room.status !== 'inactive'); // Client-side filtering
    }
    
    console.log('[Training Room] ✅', rooms.length, '개 Room 로드 완료');
    
    // 사용자 목록 로드 (실패해도 계속 진행)
    let usersList = [];
    try {
      usersList = await getUsersListWithCache();
      console.log('[Training Room] ✅ 사용자 목록:', usersList.length, '명');
    } catch (userError) {
      console.warn('[Training Room] ⚠️ 사용자 목록 로드 실패 (계속 진행):', userError);
      // 폴백: 전역 변수 확인
      if (Array.isArray(window.users) && window.users.length > 0) {
        usersList = window.users;
      } else if (Array.isArray(window.userProfiles) && window.userProfiles.length > 0) {
        usersList = window.userProfiles;
      }
    }
    
    // 데이터 저장 및 렌더링
    trainingRoomList = rooms;
    
    // 캐시 저장
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem('trainingRoomsListCache', JSON.stringify({
          rooms: rooms,
          users: usersList,
          timestamp: Date.now()
        }));
      } catch (cacheError) {
        console.warn('[Training Room] 캐시 저장 실패:', cacheError);
      }
    }
    
    // 렌더링 (db와 useV9 전달)
    if (rooms.length === 0) {
      listContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
          <p style="color: #666;">등록된 Training Room이 없습니다.</p>
        </div>
      `;
    } else {
      renderTrainingRoomList(rooms, usersList, db, useV9);
    }
    
    console.log('[Training Room] ✅ 목록 로드 완료:', rooms.length, '개 Room,', usersList.length, '명 사용자');
    
  } catch (error) {
    console.error('[Training Room] ❌ 목록 로드 오류:', error);
    console.error('[Training Room] 오류 상세:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    // 에러 UI 표시 (trainingResultService.js 패턴: 단순한 에러 처리)
    const errorCode = error.code || 'unknown';
    const errorMessage = error.message || '알 수 없는 오류';
    const isPermissionError = errorCode === 'permission-denied' || 
                               errorMessage.toLowerCase().includes('permission') ||
                               errorMessage.toLowerCase().includes('권한');
    
    listContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
        <p style="color: #dc3545; margin-bottom: 10px; font-weight: 600;">Training Room 목록을 불러올 수 없습니다</p>
        <p style="color: #666; font-size: 14px; margin-bottom: 20px;">
          ${isPermissionError 
            ? '권한 오류가 발생했습니다. 로그인 상태를 확인해주세요.' 
            : '네트워크 연결을 확인하고 다시 시도해주세요.'}
        </p>
        <button onclick="if(typeof loadTrainingRooms==='function'){loadTrainingRooms();}" 
                style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
          다시 시도
        </button>
      </div>
    `;
  }
}

/**
 * Training Room 목록 렌더링
 * @param {Array} rooms - Training Room 목록
 * @param {Array} users - 사용자 목록 (옵션)
 * @param {Object} db - Firestore 인스턴스 (Dependency Injection)
 * @param {boolean} useV9 - Firebase v9 Modular SDK 사용 여부
 */
function renderTrainingRoomList(rooms, users = [], db = null, useV9 = false) {
  const listContainer = document.getElementById('trainingRoomList');
  if (!listContainer) return;

  // 사용자 목록이 파라미터로 전달되지 않았으면 전역 변수에서 가져오기
  if (!users || users.length === 0) {
    users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
    console.log('[Training Room] renderTrainingRoomList - 전역 변수에서 사용자 목록 사용:', users.length, '명');
  } else {
    console.log('[Training Room] renderTrainingRoomList - 파라미터로 전달된 사용자 목록:', users.length, '명');
  }

  // 사용자 목록이 비어있으면 경고 로그 및 모바일 재시도
  if (!users || users.length === 0) {
    console.warn('[Training Room] ⚠️ 사용자 목록이 비어있습니다. Manager 정보를 표시할 수 없습니다.');
    
    // 모바일 환경에서 사용자 목록이 비어있을 때 비동기 재시도
    const isMobile = isMobileDeviceForTrainingRooms();
    if (isMobile && rooms.length > 0) {
      console.log('[Training Room] 📱 모바일 환경: 렌더링 후 사용자 목록 재시도 예약...');
      setTimeout(async () => {
        try {
          const retryUsers = await getUsersListWithCache();
          if (retryUsers && retryUsers.length > 0) {
            console.log('[Training Room] ✅ 렌더링 후 재시도 성공: 사용자 목록 로드 완료:', retryUsers.length, '명');
            // 사용자 목록이 로드되면 다시 렌더링 (db와 useV9도 전달)
            renderTrainingRoomList(rooms, retryUsers, db, useV9);
            console.log('[Training Room] 🔄 Manager 정보 업데이트 완료 (렌더링 후 재시도)');
          }
        } catch (retryError) {
          console.warn('[Training Room] 렌더링 후 재시도 실패:', retryError);
        }
      }, 1500); // 1.5초 후 재시도
    }
  }

  // ✅ 성능 최적화: 사용자 목록을 Map으로 변환 (O(N^2) → O(1))
  // userId를 Key로 하는 Map 생성 (String으로 통일하여 숫자형/문자형 ID 불일치 문제 해결)
  const userMap = new Map();
  if (users && users.length > 0) {
    users.forEach(u => {
      // 여러 필드에서 ID 추출 (id, userId, uid)
      const ids = [
        String(u.id || '').trim(),
        String(u.userId || '').trim(),
        String(u.uid || '').trim()
      ].filter(id => id !== ''); // 빈 문자열 제거
      
      // 각 ID를 Key로 사용하여 Map에 저장 (대소문자 구분 없이)
      ids.forEach(id => {
        const idLower = id.toLowerCase();
        // 이미 존재하지 않으면 저장 (첫 번째 매칭 우선)
        if (!userMap.has(idLower)) {
          userMap.set(idLower, u);
        }
        // 원본 ID도 저장 (정확한 매칭용)
        if (!userMap.has(id)) {
          userMap.set(id, u);
        }
      });
    });
    console.log(`[Training Room] ✅ 사용자 Map 생성 완료: ${userMap.size}개 키 (${users.length}명 사용자)`);
  }

  // 모바일 환경 감지
  const isMobile = isMobileDeviceForTrainingRooms();
  
  // 현재 사용자 정보 및 권한 확인 (버튼 표시용)
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  const currentUserId = currentUser?.id || currentUser?.uid || '';
  const isAdmin = userGrade === '1';
  
  // ✅ UI 블로킹 방지: DocumentFragment 사용하여 DOM 조작 최소화
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  
  // HTML 문자열 생성 (Render First 패턴: 즉시 렌더링)
  // 관리자 이름은 나중에 비동기로 업데이트되므로 초기값만 설정
  const htmlStrings = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    
    // 수정 권한 확인: grade=1 또는 지정된 관리자
    const roomManagerId = String(room.user_id || room.userId || '');
    const canEdit = isAdmin || (roomManagerId && String(currentUserId) === roomManagerId);
    const canDelete = isAdmin; // 삭제는 grade=1만
    
    // 관리자 이름 표시용 고유 ID 생성 (Render First 패턴)
    const managerNameElId = `manager-name-${room.id}`;
    
    // 초기 표시 텍스트: userId가 있으면 "로딩중..." (나중에 업데이트), 없으면 "코치 없음"
    // userId 필드를 우선적으로 사용 (user_id는 폴백)
    const userId = room.userId || room.user_id;
    const initialManagerText = userId ? '로딩중...' : '코치 없음';
    const initialManagerClass = userId ? 'no-coach loading' : 'no-coach';
    
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           data-room-track-count="${room.track_count || 0}"
           data-room-user-id="${room.user_id || room.userId || ''}"
           onclick="selectTrainingRoom('${room.id}')"
           style="cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;">
        <div class="training-room-content">
          <div class="training-room-name-section" style="display: flex; align-items: center; gap: 8px;">
            <div class="training-room-name ${room.title ? 'has-name' : 'no-name'}" style="flex: 1; min-width: 0;">
              ${room.title ? escapeHtml(room.title) : '훈련방 이름 없음'}
            </div>
            <div class="training-room-actions" onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              ${canEdit ? `
              <button type="button" class="training-room-edit-btn" onclick="openTrainingRoomEditModal('${room.id}')" aria-label="수정" title="수정">
                <img src="assets/img/check-ok.png" alt="수정" style="width: 20px; height: 20px; display: block;" />
              </button>
              ` : ''}
              ${canDelete ? `
              <button type="button" class="training-room-delete-btn" onclick="deleteTrainingRoom('${room.id}')" aria-label="삭제" title="삭제">
                <span style="font-size: 20px; line-height: 1; color: #dc3545;">✕</span>
              </button>
              ` : ''}
              ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" class="training-room-lock-icon" />
              ` : ''}
              ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
            </div>
          </div>
          <div class="training-room-coach-section">
            <div class="training-room-coach ${initialManagerClass}" id="${managerNameElId}">
              ${initialManagerText}
            </div>
          </div>
        </div>
      </div>
    `;
  });
  
  // 렌더링 완료 후 실행할 콜백 함수
  const afterRenderCallback = () => {
    // 모바일 터치 이벤트를 위한 명시적 이벤트 리스너 추가
    // 모든 카드에 터치 이벤트 리스너 추가 (모바일에서 onclick이 작동하지 않을 수 있음)
    setTimeout(() => {
      document.querySelectorAll('.training-room-card').forEach(card => {
        // 기존 터치 이벤트 리스너 제거 (중복 방지)
        if (card._cardTouchHandler) {
          card.removeEventListener('touchend', card._cardTouchHandler);
          card._cardTouchHandler = null;
        }
        
        const roomId = card.getAttribute('data-room-id');
        if (roomId) {
          // 터치 이벤트 핸들러 추가 (모바일용)
          const cardTouchHandler = (e) => {
            // 슬라이드 스위치 컨테이너나 버튼 영역을 터치한 경우 무시
            if (e.target.closest('.device-connection-switch-container') || 
                e.target.closest('.training-room-action-buttons')) {
              return;
            }
            
            // 카드 영역을 터치한 경우에만 Room 선택
            e.stopPropagation();
            selectTrainingRoom(roomId);
          };
          
          card.addEventListener('touchend', cardTouchHandler, { passive: true });
          card._cardTouchHandler = cardTouchHandler;
        }
      });
    }, 0);

    // Update Later 패턴: 렌더링 완료 후 비동기적으로 관리자 이름 업데이트
    // DOM 요소가 준비될 때까지 약간의 지연을 두고 실행
    setTimeout(() => {
      // db 인스턴스가 없으면 경고하고 스킵
      if (!db) {
        console.warn('[Training Room] renderTrainingRoomList: db 인스턴스가 없어 관리자 이름을 업데이트할 수 없습니다.');
        // db가 없어도 기본값으로 업데이트는 진행
        rooms.forEach(room => {
          const roomIdStr = String(room.id);
          const managerElId = `manager-name-${roomIdStr}`;
          const managerEl = document.getElementById(managerElId);
          if (managerEl && managerEl.textContent === '...') {
            managerEl.textContent = '알 수 없음';
            managerEl.className = 'training-room-coach no-coach';
          }
        });
        return;
      }
      
      // 각 방에 대해 fetchAndDisplayManagerName 함수를 호출하여 관리자 이름을 비동기로 업데이트
      // Fire-and-forget 패턴: await 없이 호출하여 목록 로딩 속도 저하 방지
      rooms.forEach(room => {
        // userId 필드를 우선적으로 사용 (user_id는 폴백)
        const userId = room.userId || room.user_id;
        const roomIdStr = String(room.id); // 명시적으로 문자열 변환
        const managerSpanId = `manager-name-${roomIdStr}`;
        
        if (userId) {
          // Fire-and-forget: await 없이 비동기 호출
          fetchAndDisplayManagerName(db, useV9, userId, managerSpanId);
        } else {
          // userId가 없으면 "코치 없음"으로 업데이트
          const managerEl = document.getElementById(managerSpanId);
          if (managerEl && (managerEl.textContent === '...' || managerEl.textContent === '로딩중...')) {
            managerEl.textContent = '코치 없음';
            managerEl.className = 'training-room-coach no-coach';
          }
        }
      });
    }, 50); // DOM 렌더링 완료를 위한 짧은 지연
  };

  // 모바일 환경에서 requestAnimationFrame 사용하여 렌더링 작업을 메인 스레드 대기열에 배치
  if (isMobile) {
    requestAnimationFrame(() => {
      tempDiv.innerHTML = htmlStrings.join('');
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      listContainer.innerHTML = '';
      listContainer.appendChild(fragment);
      
      // 렌더링 완료 후 콜백 실행
      afterRenderCallback();
    });
  } else {
    tempDiv.innerHTML = htmlStrings.join('');
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    listContainer.innerHTML = '';
    listContainer.appendChild(fragment);
    
    // 렌더링 완료 후 콜백 실행
    afterRenderCallback();
  }

  // CSS는 style.css에 정의되어 있음 (동적 스타일 추가 불필요)
}

/**
 * 관리자 이름 직접 조회 및 표시 함수 (간단한 Firestore 쿼리)
 * training_rooms의 userId 필드를 사용하여 users 컬렉션에서 직접 조회
 * 
 * @param {Object} db - Firestore 인스턴스 (Dependency Injection - 필수)
 * @param {boolean} useV9 - Firebase v9 Modular SDK 사용 여부
 * @param {string} userId - users 컬렉션의 문서 ID
 * @param {string} elementId - DOM 요소 ID (예: 'manager-name-1')
 */
async function fetchAndDisplayManagerName(db, useV9, userId, elementId) {
  // 파라미터 유효성 검사
  if (!db) {
    console.error('[ManagerFetch] db 인스턴스가 전달되지 않았습니다.');
    return;
  }
  
  if (!userId || !elementId) {
    console.warn('[ManagerFetch] userId 또는 elementId가 없습니다.', { userId, elementId });
    return;
  }
  
  const userIdStr = String(userId).trim();
  if (!userIdStr) {
    console.warn('[ManagerFetch] userId가 비어있습니다.');
    return;
  }
  
  // DOM 요소 찾기
  const el = document.getElementById(elementId);
  if (!el) {
    console.warn('[ManagerFetch] DOM 요소를 찾을 수 없습니다:', elementId);
    return;
  }
  
  // 이미 업데이트되었는지 확인 ("로딩중..." 또는 "..." 상태가 아니면 스킵)
  if (el.textContent !== '로딩중...' && el.textContent !== '...') {
    return; // 이미 업데이트됨
  }
  
  console.log('[ManagerFetch] 조회 시작 - elementId:', elementId, ', userId:', userIdStr, ', useV9:', useV9);
  
  try {
    let userData = null;
    
    if (useV9) {
      // Firebase v9 Modular SDK
      const { getDoc, doc, collection } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
      const usersRef = collection(db, 'users');
      const userDocRef = doc(usersRef, userIdStr);
      const docSnapshot = await getDoc(userDocRef);
      
      if (docSnapshot.exists()) {
        userData = docSnapshot.data();
        console.log('[ManagerFetch] 데이터 수신 성공 (v9) - elementId:', elementId, ', userData:', userData);
      } else {
        console.warn('[ManagerFetch] User document not found (v9) - userId:', userIdStr);
      }
    } else {
      // Firebase v8 Compat SDK: db.collection('users').doc(userId).get()
      const userDocRef = db.collection('users').doc(userIdStr);
      const userDoc = await userDocRef.get();
      
      if (userDoc.exists) {
        userData = userDoc.data();
        console.log('[ManagerFetch] 데이터 수신 성공 (v8) - elementId:', elementId, ', userData:', userData);
      } else {
        console.warn('[ManagerFetch] User document not found (v8) - userId:', userIdStr);
      }
    }
    
    // 데이터 처리 및 UI 업데이트
    if (userData && userData.name) {
      // name 필드가 있으면 표시
      el.textContent = `코치: ${userData.name}`;
      el.className = 'training-room-coach has-coach';
      console.log(`[ManagerFetch] ✅ Success - elementId: ${elementId}, Manager: ${userData.name}`);
    } else if (userData) {
      // 문서는 존재하지만 name 필드가 없음
      el.textContent = '코치: (정보 없음)';
      el.className = 'training-room-coach no-coach';
      console.warn(`[ManagerFetch] ⚠️ User document found but name field is missing - elementId: ${elementId}, userId: ${userIdStr}`);
    } else {
      // 문서가 존재하지 않음
      el.textContent = '코치: (정보 없음)';
      el.className = 'training-room-coach no-coach';
      console.warn(`[ManagerFetch] User document not found - elementId: ${elementId}, userId: ${userIdStr}`);
    }
  } catch (error) {
    // 예외 발생 시 안전하게 처리 (Fail-safe: UI 업데이트 필수)
    console.error(`[ManagerFetch] ❌ Error getting manager - elementId: ${elementId}, userId: ${userIdStr}`, error);
    console.error('[ManagerFetch] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // 에러 발생 시에도 UI 업데이트 (무한 로딩 방지)
    if (el) {
      el.textContent = '코치: (알 수 없음)';
      el.className = 'training-room-coach no-coach';
    }
  }
}

/**
 * 관리자 이름 비동기 업데이트 함수 (Dependency Injection 패턴 적용) - 레거시 호환성 유지
 * @deprecated fetchAndDisplayManagerName 사용 권장
 */
async function updateManagerName(db, useV9, userId, roomId) {
  // 1. 파라미터 유효성 검사
  if (!db) {
    console.error('[ManagerFetch] db 인스턴스가 전달되지 않았습니다.');
    return;
  }
  
  if (!userId || !roomId) {
    console.warn('[ManagerFetch] userId 또는 roomId가 없습니다.', { userId, roomId });
    return;
  }
  
  // roomId를 명시적으로 문자열로 변환
  const roomIdStr = String(roomId);
  const managerElId = `manager-name-${roomIdStr}`;
  
  // DOM 요소 찾기 (재시도 로직 포함)
  let managerEl = document.getElementById(managerElId);
  let retryCount = 0;
  const maxRetries = 5;
  
  while (!managerEl && retryCount < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 100));
    managerEl = document.getElementById(managerElId);
    retryCount++;
  }
  
  if (!managerEl) {
    console.warn('[ManagerFetch] DOM 요소를 찾을 수 없습니다 (재시도 실패).', managerElId);
    return;
  }
  
  // 이미 업데이트되었는지 확인 ("..." 상태가 아니면 스킵)
  if (managerEl.textContent !== '...') {
    return; // 이미 업데이트됨
  }
  
  // userId가 없으면 "코치 없음" 처리
  const userIdStr = String(userId).trim();
  if (!userIdStr) {
    console.log('[ManagerFetch] userId가 비어있음 - 코치 없음 처리');
    managerEl.textContent = '코치 없음';
    managerEl.className = 'training-room-coach no-coach';
    return;
  }
  
  console.log('[ManagerFetch] ID 조회 시작 - roomId:', roomIdStr, ', userId:', userIdStr, ', useV9:', useV9);
  
  try {
    // 2. 전달받은 db 인스턴스 사용 (Dependency Injection)
    const firestoreDb = db;
    
    // 3. 직접 Firestore 쿼리 실행
    let userDoc = null;
    let userData = null;
    
    if (useV9) {
      // Firebase v9 Modular SDK
      const { getDoc, doc, collection } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
      const usersRef = collection(firestoreDb, 'users');
      const userDocRef = doc(usersRef, userIdStr);
      const docSnapshot = await getDoc(userDocRef);
      
      if (docSnapshot.exists()) {
        userData = docSnapshot.data();
        console.log('[ManagerFetch] 데이터 수신 성공 (v9) - roomId:', roomIdStr, ', userData:', userData);
      } else {
        console.warn('[ManagerFetch] User document not found (v9) - userId:', userIdStr);
      }
    } else {
      // Firebase v8 Compat SDK
      const userDocRef = firestoreDb.collection('users').doc(userIdStr);
      userDoc = await userDocRef.get();
      
      if (userDoc.exists) {
        userData = userDoc.data();
        console.log('[ManagerFetch] 데이터 수신 성공 (v8) - roomId:', roomIdStr, ', userData:', userData);
      } else {
        console.warn('[ManagerFetch] User document not found (v8) - userId:', userIdStr);
      }
    }
    
    // 4. 데이터 처리 및 UI 업데이트
    if (userData) {
      // name 필드 우선, 없으면 nickname, 없으면 '알 수 없음'
      const managerName = userData.name || userData.nickname || userData.userName || userData.displayName || '알 수 없음';
      
      if (managerName && managerName !== '알 수 없음') {
        managerEl.textContent = `Manager: ${managerName}`;
        managerEl.className = 'training-room-coach has-coach';
        console.log(`[ManagerFetch] ✅ Success for Room ${roomIdStr} - Manager: ${managerName}`);
      } else {
        managerEl.textContent = '알 수 없음';
        managerEl.className = 'training-room-coach no-coach';
        console.warn(`[ManagerFetch] ⚠️ User document found but name field is missing - roomId: ${roomIdStr}, userId: ${userIdStr}`);
      }
    } else {
      // 문서가 존재하지 않음
      managerEl.textContent = '코치 없음';
      managerEl.className = 'training-room-coach no-coach';
      console.warn(`[ManagerFetch] User document not found - roomId: ${roomIdStr}, userId: ${userIdStr}`);
    }
  } catch (error) {
    // 예외 발생 시 안전하게 처리 (Fail-safe: UI 업데이트 필수)
    console.error(`[ManagerFetch] ❌ Error getting manager for Room ${roomIdStr} - userId: ${userIdStr}`, error);
    console.error('[ManagerFetch] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // 에러 발생 시에도 UI 업데이트 (무한 로딩 방지)
    if (managerEl) {
      managerEl.textContent = '알 수 없음';
      managerEl.className = 'training-room-coach no-coach';
    }
  }
}

/**
 * Training Room 선택
 */
async function selectTrainingRoom(roomId) {
  // roomId를 숫자로 변환 (문자열로 전달될 수 있음)
  const roomIdNum = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
  const room = trainingRoomList.find(r => r.id == roomIdNum || String(r.id) === String(roomIdNum));
  if (!room) {
    console.error('[Training Room] 선택한 방을 찾을 수 없습니다:', roomId, '타입:', typeof roomId, '변환:', roomIdNum);
    console.error('[Training Room] 현재 목록:', trainingRoomList.map(r => ({ id: r.id, type: typeof r.id })));
    return;
  }
  
  // 이미 선택된 카드인지 확인 (다른 Room 선택 시에는 계속 진행)
  const targetCard = document.querySelector(`.training-room-card[data-room-id="${roomIdNum}"]`);
  const currentlySelectedCard = document.querySelector('.training-room-card.selected');
  const isSameRoom = currentlySelectedCard && 
                     currentlySelectedCard.getAttribute('data-room-id') === String(roomIdNum);
  
  if (isSameRoom) {
    // 같은 Room을 다시 선택한 경우에만 중복 실행 방지
    const contentDiv = targetCard.querySelector('.training-room-content');
    if (contentDiv && 
        contentDiv.querySelector('.device-connection-switch-container') && 
        contentDiv.querySelector('.training-room-action-buttons')) {
      console.log('[Training Room] 이미 선택된 Room입니다:', roomIdNum);
      return;
    }
  }

  // 비밀번호 확인 (grade=1 관리자는 제외)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;

  const hasPassword = room.password && String(room.password).trim() !== '';
  
  if (hasPassword && !isAdmin) {
    // 비밀번호 확인 모달 표시 (room 객체 전달)
    const passwordCorrect = await showTrainingRoomPasswordModal(room.title, room);
    if (!passwordCorrect) {
      return; // 비밀번호가 틀리면 중단
    }
  }

  // 선택된 Training Room 저장
  currentSelectedTrainingRoom = room;
  
  // 전역 변수 및 localStorage에 room id와 이름 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    window.currentTrainingRoomName = room.name || room.title || room.Name || room.roomName || null;
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room] window.SESSION_ID 업데이트:', window.SESSION_ID);
    console.log('[Training Room] window.currentTrainingRoomName 저장:', window.currentTrainingRoomName);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
      if (room.name || room.title || room.Name || room.roomName) {
        localStorage.setItem('currentTrainingRoomName', room.name || room.title || room.Name || room.roomName);
      }
    } catch (e) {
      console.warn('[Training Room] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room] Room ID 저장됨:', room.id);

  // 모든 카드에서 선택 상태 및 버튼 제거
  document.querySelectorAll('.training-room-card').forEach(card => {
    card.classList.remove('selected');
    
    // 기존 체크마크 제거
    const existingCheck = card.querySelector('.training-room-check');
    if (existingCheck) {
      existingCheck.remove();
    }
    
    // 기존 슬라이드 스위치 컨테이너 제거 (이벤트 리스너도 정리)
    const existingSwitchContainer = card.querySelector('.device-connection-switch-container');
    if (existingSwitchContainer) {
      if (existingSwitchContainer._switchContainerClickHandler) {
        existingSwitchContainer.removeEventListener('click', existingSwitchContainer._switchContainerClickHandler);
        existingSwitchContainer._switchContainerClickHandler = null;
      }
      if (existingSwitchContainer._switchContainerTouchHandler) {
        existingSwitchContainer.removeEventListener('touchstart', existingSwitchContainer._switchContainerTouchHandler);
        existingSwitchContainer._switchContainerTouchHandler = null;
      }
      if (existingSwitchContainer._switchContainerTouchEndHandler) {
        existingSwitchContainer.removeEventListener('touchend', existingSwitchContainer._switchContainerTouchEndHandler);
        existingSwitchContainer._switchContainerTouchEndHandler = null;
      }
      existingSwitchContainer.remove();
    }
    
    // 기존 버튼 제거 (이벤트 리스너도 정리)
    const existingButtons = card.querySelector('.training-room-action-buttons');
    if (existingButtons) {
      if (existingButtons._buttonClickHandler) {
        existingButtons.removeEventListener('click', existingButtons._buttonClickHandler);
        existingButtons._buttonClickHandler = null;
      }
      if (existingButtons._buttonTouchHandler) {
        existingButtons.removeEventListener('touchstart', existingButtons._buttonTouchHandler);
        existingButtons._buttonTouchHandler = null;
      }
      existingButtons.remove();
    }
    
    // contentDiv의 이벤트 리스너 정리는 더 이상 필요 없음 (리스너를 추가하지 않으므로)
  });
  
  // 선택된 카드에 체크마크 및 버튼 추가
  const selectedCard = document.querySelector(`.training-room-card[data-room-id="${roomIdNum}"]`);
  if (selectedCard) {
    selectedCard.classList.add('selected');
    
    // 체크마크 추가
    if (!selectedCard.querySelector('.training-room-check')) {
      const checkMark = document.createElement('div');
      checkMark.className = 'training-room-check';
      checkMark.textContent = '✓';
      selectedCard.appendChild(checkMark);
    }
    
    // 버튼 추가
    const contentDiv = selectedCard.querySelector('.training-room-content');
    if (contentDiv && !contentDiv.querySelector('.training-room-action-buttons') && !contentDiv.querySelector('.device-connection-switch-container')) {
      // 사용자 등급 확인
      const userGradeNum = typeof userGrade === 'string' ? parseInt(userGrade, 10) : userGrade;
      const canAccessPlayer = userGradeNum === 1 || userGradeNum === 2 || userGradeNum === 3;
      const canAccessCoach = userGradeNum === 1 || userGradeNum === 3;
      
      // 디바이스 연결 방식 스위치 추가 (Player/Coach 버튼 위에)
      const switchContainer = document.createElement('div');
      switchContainer.className = 'device-connection-switch-container';
      switchContainer.style.cssText = 'margin-bottom: 10px; display: flex; flex-direction: column; align-items: center; gap: 0; width: 100%;';
      // 컨테이너 전체 클릭 시 이벤트 전파 차단 (중복 리스너 방지)
      // 슬라이드 스위치 요소 자체를 클릭한 경우에만 슬라이드가 동작하도록 함
      if (switchContainer._switchContainerClickHandler) {
        switchContainer.removeEventListener('click', switchContainer._switchContainerClickHandler);
        switchContainer.removeEventListener('touchstart', switchContainer._switchContainerTouchHandler);
      }
      
      const switchContainerClickHandler = (e) => {
        // 슬라이드 스위치 요소 자체를 클릭한 경우에만 이벤트 전파 차단 (슬라이드 동작 허용)
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          // 슬라이드 스위치를 클릭한 경우 - 이벤트 전파 차단하여 부모 카드의 selectTrainingRoom 방지
          // 하지만 슬라이드 스위치 자체의 이벤트 핸들러는 동작하도록 함
          e.stopPropagation();
        }
        // 슬라이드 스위치가 아닌 영역(label 등)을 클릭한 경우 이벤트 전파 허용하여 카드 선택 가능
      };
      switchContainer.addEventListener('click', switchContainerClickHandler);
      switchContainer._switchContainerClickHandler = switchContainerClickHandler;
      
      // 모바일 터치 이벤트도 처리
      const switchContainerTouchHandler = (e) => {
        // 슬라이드 스위치 요소 자체를 터치한 경우에만 이벤트 전파 차단
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          e.stopPropagation();
        }
        // 슬라이드 스위치가 아닌 영역(label 등)을 터치한 경우 이벤트 전파 허용하여 카드 선택 가능
        // 하지만 컨테이너 자체는 카드 선택을 방지 (touchend에서 처리)
      };
      switchContainer.addEventListener('touchstart', switchContainerTouchHandler, { passive: true });
      switchContainer._switchContainerTouchHandler = switchContainerTouchHandler;
      
      // touchend도 처리하여 카드 선택 방지
      const switchContainerTouchEndHandler = (e) => {
        const switchElement = e.target.closest('.device-connection-switch');
        if (switchElement) {
          e.stopPropagation();
        }
      };
      switchContainer.addEventListener('touchend', switchContainerTouchEndHandler, { passive: true });
      switchContainer._switchContainerTouchEndHandler = switchContainerTouchEndHandler;
      switchContainer.innerHTML = `
        <label style="font-size: 14px; color: #666; font-weight: 500;">디바이스 연결 방식</label>
        <div class="device-connection-switch" id="deviceConnectionSwitchScreen" style="position: relative; width: 200px; height: 50px; background: #e0e0e0; border-radius: 25px; cursor: pointer; transition: background 0.3s ease;">
          <!-- Bluetooth 옵션 (왼쪽) -->
          <div class="switch-option switch-option-left" data-mode="bluetooth" style="position: absolute; left: 0; top: 0; width: 50%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 25px 0 0 25px; transition: all 0.3s ease; z-index: 2;">
            <img src="assets/img/wifi.png" alt="Bluetooth" style="width: 32px; height: 32px; object-fit: contain;" />
          </div>
          <!-- ANT+ 옵션 (오른쪽) -->
          <div class="switch-option switch-option-right" data-mode="ant" style="position: absolute; right: 0; top: 0; width: 50%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 0 25px 25px 0; transition: all 0.3s ease; z-index: 2;">
            <img src="assets/img/antlogo.png" alt="ANT+" style="width: 32px; height: 32px; object-fit: contain;" />
          </div>
          <!-- 슬라이더 (움직이는 부분) -->
          <div class="switch-slider" id="switchSliderScreen" style="position: absolute; left: 50%; top: 0; width: 50%; height: 100%; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 25px; transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3); z-index: 3;"></div>
        </div>
      `;
      contentDiv.appendChild(switchContainer);
      
      // 스위치 초기화 (일반 화면용)
      setTimeout(() => {
        initializeDeviceConnectionSwitchForScreen();
      }, 100);
      
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'training-room-action-buttons';
      // 버튼 영역 클릭 시 이벤트 전파 차단 (중복 리스너 방지)
      if (buttonsDiv._buttonClickHandler) {
        buttonsDiv.removeEventListener('click', buttonsDiv._buttonClickHandler);
        buttonsDiv.removeEventListener('touchstart', buttonsDiv._buttonTouchHandler);
      }
      
      const buttonClickHandler = (e) => {
        e.stopPropagation();
      };
      buttonsDiv.addEventListener('click', buttonClickHandler);
      buttonsDiv._buttonClickHandler = buttonClickHandler;
      
      // 모바일 터치 이벤트도 처리
      const buttonTouchHandler = (e) => {
        e.stopPropagation();
      };
      buttonsDiv.addEventListener('touchstart', buttonTouchHandler, { passive: true });
      buttonsDiv._buttonTouchHandler = buttonTouchHandler;
      
      buttonsDiv.innerHTML = `
        <button class="btn btn-primary btn-default-style btn-with-icon training-room-btn-player ${!canAccessPlayer ? 'disabled' : ''}" 
                data-room-id="${room.id}" 
                onclick="event.stopPropagation(); if (typeof openPlayerList === 'function') { openPlayerList(); }"
                ${!canAccessPlayer ? 'disabled' : ''}
                style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;">
          <img src="assets/img/personals.png" alt="Player" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
          Player
        </button>
        <button class="btn btn-success btn-default-style btn-with-icon training-room-btn-coach ${!canAccessCoach ? 'disabled' : ''}" 
                data-room-id="${room.id}" 
                onclick="event.stopPropagation(); if (typeof openCoachMode === 'function') { openCoachMode(); }"
                ${!canAccessCoach ? 'disabled' : ''}
                style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;">
          <img src="assets/img/personal.png" alt="Coach" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
          Coach
        </button>
      `;
      contentDiv.appendChild(buttonsDiv);
      
      // contentDiv에는 이벤트 리스너를 추가하지 않음
      // 카드 자체의 onclick이 정상 작동하도록 함
      // 슬라이드 스위치와 버튼 영역의 이벤트 리스너가 각각 stopPropagation을 호출하여 충분함
      
      // 버튼 스타일 적용 및 모바일 터치 이벤트 추가 (DOM에 추가된 후 실행)
      setTimeout(() => {
        const btnPlayer = buttonsDiv.querySelector('.training-room-btn-player');
        const btnCoach = buttonsDiv.querySelector('.training-room-btn-coach');
        
        if (btnPlayer) {
          if (!canAccessPlayer) {
            btnPlayer.style.opacity = '0.5';
            btnPlayer.style.cursor = 'not-allowed';
          } else {
            btnPlayer.style.opacity = '1';
            btnPlayer.style.cursor = 'pointer';
            
            // 모바일 터치 이벤트 추가 (중복 방지)
            if (btnPlayer._buttonTouchHandler) {
              btnPlayer.removeEventListener('touchend', btnPlayer._buttonTouchHandler);
            }
            
            const playerTouchHandler = (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (typeof openPlayerList === 'function') {
                openPlayerList();
              }
            };
            btnPlayer.addEventListener('touchend', playerTouchHandler, { passive: false });
            btnPlayer._buttonTouchHandler = playerTouchHandler;
          }
        }
        if (btnCoach) {
          if (!canAccessCoach) {
            btnCoach.style.opacity = '0.5';
            btnCoach.style.cursor = 'not-allowed';
          } else {
            btnCoach.style.opacity = '1';
            btnCoach.style.cursor = 'pointer';
            
            // 모바일 터치 이벤트 추가 (중복 방지)
            if (btnCoach._buttonTouchHandler) {
              btnCoach.removeEventListener('touchend', btnCoach._buttonTouchHandler);
            }
            
            const coachTouchHandler = (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (typeof openCoachMode === 'function') {
                openCoachMode();
              }
            };
            btnCoach.addEventListener('touchend', coachTouchHandler, { passive: false });
            btnCoach._buttonTouchHandler = coachTouchHandler;
          }
        }
      }, 0);
    }
  }
}

/**
 * Training Room 비밀번호 확인 모달
 * @param {string} roomTitle - Training Room 제목
 * @param {object} room - Training Room 객체 (비밀번호 포함)
 */
async function showTrainingRoomPasswordModal(roomTitle, room = null) {
  return new Promise((resolve) => {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('trainingRoomPasswordModal');
    if (existingModal) {
      existingModal.remove();
    }

    // room 객체가 전달되지 않으면 currentSelectedTrainingRoom 사용
    const targetRoom = room || currentSelectedTrainingRoom;
    
    // 비밀번호 가져오기 (숫자/문자 모두 문자열로 변환)
    const correctPassword = targetRoom && targetRoom.password != null
      ? String(targetRoom.password).trim()
      : '';

    // 모달 생성
    const modal = document.createElement('div');
    modal.id = 'trainingRoomPasswordModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 style="display: flex; align-items: center; gap: 8px;">
            <img src="assets/img/lock.png" alt="비밀번호" style="width: 24px; height: 24px;" />
            비밀번호 확인
          </h3>
          <button class="modal-close" onclick="this.closest('.modal').remove(); resolve(false);">✖</button>
        </div>
        <div class="modal-body">
          <p class="schedule-password-modal-title">${escapeHtml(roomTitle || 'Training Room')}</p>
          <p class="schedule-password-modal-message">이 Training Room은 비밀번호로 보호되어 있습니다.</p>
          <div class="schedule-password-input-container">
            <input type="password" id="trainingRoomPasswordInput" class="schedule-password-input" placeholder="비밀번호를 입력하세요" autofocus />
          </div>
          <div class="schedule-password-error" id="trainingRoomPasswordError" style="display: none;"></div>
          <div class="schedule-password-modal-actions" style="display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-with-icon schedule-password-confirm-btn" style="flex: 1; min-width: 100px;">
              <img src="assets/img/save.png" alt="확인" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
              확인
            </button>
            <button class="btn btn-secondary btn-default-style schedule-password-cancel-btn" style="flex: 1; min-width: 100px;">
              <img src="assets/img/cancel2.png" alt="취소" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" />
              취소
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const passwordInput = document.getElementById('trainingRoomPasswordInput');
    const errorDiv = document.getElementById('trainingRoomPasswordError');
    const cancelBtn = modal.querySelector('.schedule-password-cancel-btn');
    const confirmBtn = modal.querySelector('.schedule-password-confirm-btn');

    // 취소 버튼
    cancelBtn.addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    // 확인 버튼
    const handleConfirm = () => {
      // 입력된 비밀번호를 문자열로 변환하고 공백 제거
      const enteredPassword = String(passwordInput.value || '').trim();
      
      if (!enteredPassword) {
        errorDiv.textContent = '비밀번호를 입력해주세요.';
        errorDiv.style.display = 'block';
        passwordInput.focus();
        return;
      }

      // 디버깅 로그 (개발 환경에서만)
      if (typeof console !== 'undefined' && console.log) {
        console.log('[비밀번호 확인] 입력값:', enteredPassword, '타입:', typeof enteredPassword);
        console.log('[비밀번호 확인] 저장값:', correctPassword, '타입:', typeof correctPassword);
        console.log('[비밀번호 확인] 비교 결과:', enteredPassword === correctPassword);
      }

      // 저장된 비밀번호와 비교 (양쪽 모두 문자열로 변환하여 비교)
      if (enteredPassword === correctPassword) {
        modal.remove();
        resolve(true);
      } else {
        errorDiv.textContent = '비밀번호가 일치하지 않습니다.';
        errorDiv.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
        errorDiv.style.animation = 'shake 0.3s ease';
        setTimeout(() => {
          errorDiv.style.animation = '';
        }, 300);
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);

    // Enter 키로 확인
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleConfirm();
      }
    });

    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    });

    // 포커스
    setTimeout(() => passwordInput.focus(), 100);
  });
}

/**
 * Player List 화면 열기
 */
async function openPlayerList() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Bluetooth 모드인지 확인
  if (deviceConnectionMode === 'bluetooth') {
    // Bluetooth 모드: Bluetooth Join Session 화면으로 이동
    await openBluetoothPlayerList();
  } else {
    // ANT+ 모드: 기존 Player List 화면으로 이동
    if (typeof showScreen === 'function') {
      showScreen('playerListScreen');
    }
    // Player List 렌더링
    await renderPlayerList();
  }
}

/**
 * Player List 렌더링 (트랙1~10)
 */
async function renderPlayerList() {
  const playerListContent = document.getElementById('playerListContent');
  if (!playerListContent) return;

  // 로딩 표시
  playerListContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">트랙 정보를 불러오는 중...</p>
    </div>
  `;

  // 트랙1~10 초기화
  const tracks = [];
  for (let i = 1; i <= 10; i++) {
    tracks.push({
      trackNumber: i,
      userId: null,
      userName: null,
      weight: null,
      ftp: null,
      gear: null,
      brake: null
    });
  }

  // Training Room id 가져오기 (여러 경로에서 확인)
  let roomId = null;
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
    roomId = currentSelectedTrainingRoom.id;
  } else if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
    roomId = String(window.currentTrainingRoomId);
  } else if (typeof localStorage !== 'undefined') {
    try {
      const storedRoomId = localStorage.getItem('currentTrainingRoomId');
      if (storedRoomId) {
        roomId = storedRoomId;
      }
    } catch (e) {
      console.warn('[Player List] localStorage 접근 실패:', e);
    }
  }

  // Training Room의 트랙별 사용자 정보 및 디바이스 정보 가져오기
  if (roomId) {
    console.log('[Player List] 트랙 정보 로드 시작, roomId:', roomId);
    try {
      // 1. 사용자 정보 가져오기 (API 또는 Firebase 직접)
      if (typeof db !== 'undefined') {
        // Firebase에서 직접 가져오기
        const sessionId = roomId;
        
        // ✅ 성능 최적화: 병렬 처리 (Promise.all 사용)
        // users와 devices 정보를 동시에 가져오기
        const [usersSnapshot, devicesSnapshot] = await Promise.all([
          db.ref(`sessions/${sessionId}/users`).once('value'),
          db.ref(`sessions/${sessionId}/devices`).once('value')
        ]);
        
        const usersData = usersSnapshot.val() || {};
        const devicesData = devicesSnapshot.val() || {};
        
        console.log('[Player List] Firebase users 데이터:', usersData);
        console.log('[Player List] Firebase devices 데이터:', devicesData);
        
        // 트랙 정보 업데이트
        for (let i = 1; i <= 10; i++) {
          const track = tracks[i - 1];
          const userData = usersData[i];
          const deviceData = devicesData[i];
          
          if (userData) {
            track.userId = userData.userId || null;
            track.userName = userData.userName || null;
            track.weight = userData.weight || null;
            track.ftp = userData.ftp || null;
          }
          
          if (deviceData) {
            // Gear (새 필드명 우선, 기존 필드명 호환)
            track.gear = deviceData.gear || 
                        deviceData['gear'] ||
                        deviceData['Gear'] || 
                        deviceData.Gear || 
                        null;
            
            // Brake (새 필드명 우선, 기존 필드명 호환)
            track.brake = deviceData.brake || 
                         deviceData['brake'] ||
                         deviceData['Brake'] || 
                         deviceData.Brake || 
                         null;
            
            // 디바이스 ID 정보
            track.smartTrainerId = deviceData.smartTrainerId || 
                                  deviceData['smartTrainerId'] ||
                                  deviceData['Smart Trainer id'] || 
                                  deviceData.trainerDeviceId || 
                                  null;
            track.powerMeterId = deviceData.powerMeterId || 
                                deviceData['powerMeterId'] ||
                                deviceData['Power Meter id'] || 
                                deviceData.deviceId || 
                                null;
            track.heartRateId = deviceData.heartRateId || 
                               deviceData['heartRateId'] ||
                               deviceData['Heart Rate id'] || 
                               deviceData.heartRateDeviceId || 
                               null;
          }
        }
      } else {
        // API로 가져오기 (기존 방식)
        const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
        console.log('[Player List] API 호출 URL:', url);
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.tracks && Array.isArray(result.tracks)) {
          result.tracks.forEach((apiTrack) => {
            const trackNumber = parseInt(apiTrack.trackNumber, 10);
            if (!isNaN(trackNumber) && trackNumber >= 1 && trackNumber <= 10) {
              const track = tracks[trackNumber - 1];
              if (track) {
                track.userId = apiTrack.userId || null;
                track.userName = apiTrack.userName || null;
                track.weight = apiTrack.weight || null;
                track.ftp = apiTrack.ftp || null;
                track.gear = apiTrack.gear || null;
                track.brake = apiTrack.brake || null;
                track.smartTrainerId = apiTrack.smartTrainerId || apiTrack.trainerDeviceId || null;
                track.powerMeterId = apiTrack.powerMeterId || apiTrack.deviceId || null;
                track.heartRateId = apiTrack.heartRateId || apiTrack.heartRateDeviceId || null;
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('[Player List] ❌ 트랙 정보 로드 오류:', error);
      console.error('[Player List] 오류 스택:', error.stack);
      // 오류가 발생해도 빈 상태로 표시 계속
    }
  } else {
    console.warn('[Player List] ⚠️ room id를 찾을 수 없어 트랙 정보를 로드할 수 없습니다.');
  }

  // Training Room id를 room 파라미터로 전달 (firebaseConfig.js에서 SESSION_ID로 사용)
  roomId = roomId || null;
  
  // roomId를 컨테이너에 data attribute로 저장 (버튼 클릭 시 사용)
  if (playerListContent && roomId) {
    playerListContent.setAttribute('data-room-id', String(roomId));
  }

  // 현재 사용자 정보 확인 (권한 체크용)
  let currentUser = null;
  let currentUserId = null;
  let userGrade = '2';
  let isAdmin = false;
  
  try {
    currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.id != null) {
      currentUserId = String(currentUser.id);
    }
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
  } catch (e) {
    console.error('[Player List] 현재 사용자 정보 확인 오류:', e);
  }

  // grade=2 사용자가 본인 계정으로 참가된 트랙이 있는지 확인
  let hasMyTrack = false;
  if (!isAdmin && currentUserId) {
    hasMyTrack = tracks.some(track => {
      const trackUserId = track.userId ? String(track.userId) : null;
      return trackUserId && trackUserId === currentUserId;
    });
  }

  playerListContent.innerHTML = tracks.map(track => {
    // userName이 있으면 사용자가 할당된 것으로 판단 (userId가 null이어도 표시 가능)
    const hasUser = !!track.userName;
    
    // 권한 체크 로직
    const trackUserId = track.userId ? String(track.userId) : null;
    let canModify = false;
    let canParticipate = false;
    
    if (isAdmin || userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3) {
      // grade=1,3 사용자는 모든 트랙에 대해 변경/삭제/Enter 가능
      canModify = true;
      canParticipate = true;
    } else if (userGrade === '2' || userGrade === 2) {
      // grade=2 사용자
      if (trackUserId && trackUserId === currentUserId) {
        // 본인 계정으로 참가된 트랙: 변경/취소/입장 버튼 활성화
        canModify = true;
        canParticipate = true;
      } else if (!hasUser && !hasMyTrack) {
        // 사용자 없음 트랙이고, 본인 계정으로 참가된 트랙이 없으면: 신청 버튼만 활성화
        canParticipate = true;
        canModify = false;
      } else {
        // 그 외의 경우: 비활성화
        canModify = false;
        canParticipate = false;
      }
    }
    
    const dashboardUrl = roomId 
      ? `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}&room=${roomId}`
      : `https://stelvio.ai.kr/individual.html?bike=${track.trackNumber}`;

    // Gear/Brake 아이콘 생성
    let gearIcon = '';
    let brakeIcon = '';
    
    if (track.gear) {
      if (track.gear === '11단' || track.gear === '11') {
        gearIcon = '<img src="assets/img/g11.png" alt="11단" class="device-icon" />';
      } else if (track.gear === '12단' || track.gear === '12') {
        gearIcon = '<img src="assets/img/g12.png" alt="12단" class="device-icon" />';
      }
    }
    
    if (track.brake) {
      if (track.brake === '디스크' || track.brake === 'Disc') {
        brakeIcon = '<img src="assets/img/d.png" alt="디스크" class="device-icon" />';
      } else if (track.brake === '림' || track.brake === 'Rim') {
        brakeIcon = '<img src="assets/img/r.png" alt="림" class="device-icon" />';
      }
    }
    
    // 디바이스 아이콘 생성 (심박계, 스마트로라, 파워메터는 배경색만 적용, 기어/브레이크는 배경 없음)
    const deviceIcons = [];
    if (track.heartRateId || track.heartRateDeviceId) {
      deviceIcons.push('<img src="assets/img/bpm_g.png" alt="심박계" class="device-icon-with-bg" title="심박계" />');
    }
    if (track.smartTrainerId || track.trainerDeviceId) {
      deviceIcons.push('<img src="assets/img/trainer_g.png" alt="스마트트레이너" class="device-icon-with-bg" title="스마트트레이너" />');
    }
    if (track.powerMeterId || track.deviceId) {
      deviceIcons.push('<img src="assets/img/power_g.png" alt="파워메터" class="device-icon-with-bg" title="파워메터" />');
    }
    if (gearIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="기어">${gearIcon}</span>`);
    }
    if (brakeIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="브레이크">${brakeIcon}</span>`);
    }
    const deviceIconsHtml = deviceIcons.length > 0 ? deviceIcons.join('') : '';
    
    return `
      <div class="player-track-item" data-track-number="${track.trackNumber}" data-room-id="${roomId || ''}">
        <div class="player-track-number-fixed">
          <div class="player-track-number-header">
            트랙${track.trackNumber}
          </div>
        </div>
        <div class="player-track-content">
          <div class="player-track-user-section">
            <div class="player-track-name ${hasUser ? 'has-user' : 'no-user'}">
              ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
            </div>
            ${deviceIconsHtml ? `<div class="player-track-devices-right">${deviceIconsHtml}</div>` : ''}
          </div>
          <div class="player-track-action">
            ${canModify || canParticipate ? `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                onclick="assignUserToTrackWithAnimation(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}', event)"
                title="훈련 신청/변경">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            ` : `
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                disabled
                title="${!isAdmin && hasUser ? '본인이 할당한 트랙만 변경 가능합니다' : '훈련 신청/변경'}">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            `}
            ${hasUser && canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                onclick="removeUserFromTrackWithAnimation(${track.trackNumber}, '${roomId || ''}', event)"
                title="훈련 참가 퇴실">
                <span>퇴실</span>
              </button>
            ` : hasUser && !canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                disabled
                title="본인이 할당한 트랙만 퇴실 가능합니다">
                <span>퇴실</span>
              </button>
            ` : ''}
            <a href="${dashboardUrl}" 
               target="_blank"
               class="btn btn-primary btn-default-style btn-with-icon player-enter-btn ${!hasUser || !canModify ? 'disabled' : ''}"
               ${!hasUser || !canModify ? 'aria-disabled="true" tabindex="-1"' : ''}
               onclick="handlePlayerEnterClick(event, ${track.trackNumber}, '${roomId || ''}')"
               title="${!hasUser ? '사용자가 할당되지 않았습니다' : (!canModify ? '본인이 할당한 트랙만 입장 가능합니다' : '훈련 시작')}">
              <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" />
              <span>Enter</span>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 일괄 퇴실 버튼 표시 여부 (grade=1,3만 표시)
  const btnClearAllTracks = document.getElementById('btnClearAllTracks');
  if (btnClearAllTracks) {
    if (isAdmin || userGrade === '3' || userGrade === 3) {
      btnClearAllTracks.style.display = 'inline-flex';
    } else {
      btnClearAllTracks.style.display = 'none';
    }
  }
}

/**
 * Coach 모드 열기 (메인 화면용)
 */
function openCoachMode() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  console.log('[Coach Mode] Coach 모드 열기 시작');
  
  // 현재 모드 확인 (우선순위: 로컬 변수 > 전역 변수 > sessionStorage > 기본값 'bluetooth')
  let mode = null;
  
  // 1순위: 로컬 변수 deviceConnectionMode (trainingRoomManager.js의 전역 변수)
  if (typeof deviceConnectionMode !== 'undefined' && deviceConnectionMode) {
    mode = deviceConnectionMode;
    console.log('[Coach Mode] 로컬 변수에서 모드 확인:', mode);
  }
  // 2순위: 전역 변수 window.deviceConnectionMode
  else if (window.deviceConnectionMode && (window.deviceConnectionMode === 'bluetooth' || window.deviceConnectionMode === 'ant')) {
    mode = window.deviceConnectionMode;
    console.log('[Coach Mode] 전역 변수에서 모드 확인:', mode);
  }
  // 3순위: sessionStorage
  else {
    const savedMode = sessionStorage.getItem('deviceConnectionMode');
    if (savedMode && (savedMode === 'bluetooth' || savedMode === 'ant')) {
      mode = savedMode;
      console.log('[Coach Mode] sessionStorage에서 모드 확인:', mode);
      // 로컬 변수와 전역 변수에도 동기화
      deviceConnectionMode = mode;
      window.deviceConnectionMode = mode;
    }
  }
  
  // 기본값: 'bluetooth' (초기 로딩 상태)
  if (!mode) {
    mode = 'bluetooth';
    console.log('[Coach Mode] 기본값 사용:', mode);
    // 기본값도 저장
    deviceConnectionMode = mode;
    window.deviceConnectionMode = mode;
    sessionStorage.setItem('deviceConnectionMode', mode);
  }
  
  console.log('[Coach Mode] 최종 디바이스 연결 방식:', mode);
  
  if (mode === 'bluetooth') {
    // Bluetooth 모드이면 바로 Bluetooth Training Coach 화면으로
    console.log('[Coach Mode] Bluetooth 모드 → bluetoothTrainingCoachScreen으로 이동');
    if (typeof showScreen === 'function') {
      showScreen('bluetoothTrainingCoachScreen');
      
      // 블루투스 코치용 트랙 정보 로드 (필요 시)
      if (typeof updateBluetoothCoachTracksFromFirebase === 'function') {
        setTimeout(() => {
          console.log('[Coach Mode] 블루투스 코치 트랙 정보 로드 시작');
          updateBluetoothCoachTracksFromFirebase();
        }, 300);
      }
    } else {
      console.error('[Coach Mode] showScreen 함수를 찾을 수 없습니다.');
      showToast('화면 전환 함수를 찾을 수 없습니다.', 'error');
    }
  } else {
    // ANT+ 모드이면 모드 선택(Race/Training) 모달 띄우기
    console.log('[Coach Mode] ANT+ 모드 → Indoor Training 모드 선택 화면으로 이동');
    if (typeof showIndoorModeSelectionModal === 'function') {
      showIndoorModeSelectionModal();
    } else {
      console.error('[Coach Mode] showIndoorModeSelectionModal 함수를 찾을 수 없습니다.');
      showToast('Indoor 모드 선택 함수를 찾을 수 없습니다.', 'error');
    }
  }
}

// ========== Training Room 모달 관련 함수 ==========

/**
 * Training Room 모달 열기
 */
async function showTrainingRoomModal() {
  const modal = document.getElementById('trainingRoomModal');
  if (!modal) {
    console.error('[Training Room Modal] 모달 요소를 찾을 수 없습니다.');
    return;
  }

  // 모달 표시
  modal.classList.remove('hidden');

  // 모달 초기화
  initializeTrainingRoomModal();

  // Training Room 목록 로드
  await loadTrainingRoomsForModal();
  
  // 선택된 Room이 있으면 스위치 초기화 (약간의 지연을 두어 DOM이 완전히 렌더링된 후 실행)
  setTimeout(() => {
    const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
    const switchElement = document.getElementById('deviceConnectionSwitch');
    
    console.log('[Training Room Modal] 모달 열림 후 스위치 확인:', {
      selectedSection: !!selectedSection,
      selectedSectionDisplay: selectedSection ? selectedSection.style.display : 'null',
      switchElement: !!switchElement
    });
    
    if (selectedSection && selectedSection.style.display !== 'none') {
      console.log('[Training Room Modal] 선택된 Room 섹션이 표시되어 있음, 스위치 초기화');
      initializeDeviceConnectionSwitch();
    } else if (currentSelectedTrainingRoom) {
      // currentSelectedTrainingRoom이 있으면 섹션을 표시하고 스위치 초기화
      console.log('[Training Room Modal] currentSelectedTrainingRoom이 있음, 섹션 표시 및 스위치 초기화');
      if (selectedSection) {
        const selectedTitle = document.getElementById('selectedTrainingRoomModalTitle');
        if (selectedTitle) {
          selectedTitle.textContent = currentSelectedTrainingRoom.title || currentSelectedTrainingRoom.name || 'Training Room';
        }
        selectedSection.style.display = 'block';
        
        setTimeout(() => {
          initializeDeviceConnectionSwitch();
        }, 100);
      }
    }
  }, 300);
}

/**
 * Training Room 모달 닫기
 */
function closeTrainingRoomModal() {
  const modal = document.getElementById('trainingRoomModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // 모달 초기화
  initializeTrainingRoomModal();
}

/**
 * Training Room 모달 초기화
 */
function initializeTrainingRoomModal() {
  // 선택된 Training Room 정보 초기화
  currentSelectedTrainingRoom = null;
  const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
  if (selectedSection) {
    selectedSection.style.display = 'none';
  }

  // 버튼 비활성화
  const btnPlayer = document.getElementById('btnPlayerModal');
  const btnCoach = document.getElementById('btnCoachModal');
  if (btnPlayer) {
    btnPlayer.disabled = true;
    btnPlayer.style.opacity = '0.5';
    btnPlayer.style.cursor = 'not-allowed';
  }
  if (btnCoach) {
    btnCoach.disabled = true;
    btnCoach.style.opacity = '0.5';
    btnCoach.style.cursor = 'not-allowed';
  }
  
  // 참고: authenticatedTrainingRooms는 초기화하지 않음 (세션 동안 유지)
}

/**
 * 모달용 Training Room 목록 로드
 * id, user_id, title, password 정보를 가져옴
 */
async function loadTrainingRoomsForModal() {
  const listContainer = document.getElementById('trainingRoomModalList');
  if (!listContainer) {
    console.error('[Training Room Modal] 목록 컨테이너를 찾을 수 없습니다.');
    return;
  }

  // 로딩 표시
  listContainer.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">Training Room 목록을 불러오는 중...</p>
    </div>
  `;

  try {
    // 구글시트에서 TrainingSchedules 목록 가져오기
    // 응답 데이터: { id, user_id, title, password, ... }
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Training Room 목록을 불러오는데 실패했습니다');
    }

    trainingRoomList = result.items || [];
    
    // 데이터 구조 확인 (디버깅용)
    if (trainingRoomList.length > 0) {
      console.log('[Training Room Modal] 로드된 Room 데이터 구조:', trainingRoomList[0]);
      console.log('[Training Room Modal] 각 Room 정보:', trainingRoomList.map(room => ({
        id: room.id,
        user_id: room.user_id || room.userId,
        title: room.title,
        hasPassword: !!(room.password && String(room.password).trim() !== '')
      })));
    }
    
    if (trainingRoomList.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <p style="color: #666;">등록된 Training Room이 없습니다.</p>
        </div>
      `;
      return;
    }

    // 사용자 목록 가져오기 (Users 테이블에서)
    let users = [];
    try {
      if (typeof window.apiGetUsers === 'function') {
        const usersResult = await window.apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room Modal] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else if (typeof apiGetUsers === 'function') {
        const usersResult = await apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
          window.users = users; // 전역 변수에 저장
          console.log('[Training Room Modal] 사용자 목록 로드 성공:', users.length, '명');
        }
      } else {
        console.warn('[Training Room Modal] apiGetUsers 함수를 찾을 수 없습니다.');
      }
    } catch (userError) {
      console.error('[Training Room Modal] 사용자 목록 로드 오류:', userError);
    }

    // 목록 렌더링 (사용자 목록과 함께)
    renderTrainingRoomListForModal(trainingRoomList, users);
  } catch (error) {
    console.error('[Training Room Modal] 목록 로드 오류:', error);
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <p style="color: #dc3545;">오류: ${error.message}</p>
      </div>
    `;
  }
}

/**
 * 모달용 Training Room 목록 렌더링
 * @param {Array} rooms - Training Room 목록
 * @param {Array} users - 사용자 목록 (옵션)
 */
function renderTrainingRoomListForModal(rooms, users = []) {
  const listContainer = document.getElementById('trainingRoomModalList');
  if (!listContainer) return;

  // 사용자 목록이 파라미터로 전달되지 않았으면 전역 변수에서 가져오기
  if (!users || users.length === 0) {
    users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
  }

  // 사용자 등급 확인 (인증 상태 체크용)
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;

  // 기존 이벤트 리스너 제거 (중복 방지)
  const existingCapturingHandler = listContainer._trainingRoomCapturingHandler;
  const existingClickHandler = listContainer._trainingRoomClickHandler;
  if (existingCapturingHandler) {
    listContainer.removeEventListener('click', existingCapturingHandler, true);
  }
  if (existingClickHandler) {
    listContainer.removeEventListener('click', existingClickHandler, false);
  }

  // ✅ 성능 최적화: 사용자 목록을 Map으로 변환 (O(N^2) → O(1))
  const userMap = new Map();
  if (users && users.length > 0) {
    users.forEach(u => {
      const id = String(u.id || '').trim();
      if (id !== '') {
        const idLower = id.toLowerCase();
        if (!userMap.has(idLower)) {
          userMap.set(idLower, u);
        }
        if (!userMap.has(id)) {
          userMap.set(id, u);
        }
      }
    });
    console.log(`[Training Room Modal] ✅ 사용자 Map 생성 완료: ${userMap.size}개 키 (${users.length}명 사용자)`);
  }

  // ✅ UI 블로킹 방지: DocumentFragment 사용
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  
  const htmlStrings = rooms.map((room, index) => {
    const hasPassword = room.password && String(room.password).trim() !== '';
    const isSelected = currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id;
    const roomIdStr = String(room.id);
    
    // 이미 선택되고 인증된 카드인지 확인
    const isAuthenticated = isSelected && (
      !hasPassword || 
      isAdmin || 
      authenticatedTrainingRooms.has(roomIdStr)
    );
    
    // user_id로 코치 이름 찾기 (Map 사용 - O(1) 조회)
    const userId = room.user_id || room.userId;
    let coachName = '';
    
    if (userId && userMap.size > 0) {
      const userIdStr = String(userId).trim();
      const userIdLower = userIdStr.toLowerCase();
      
      // Map에서 즉시 조회 (O(1))
      const coach = userMap.get(userIdStr) || userMap.get(userIdLower);
      coachName = coach ? (coach.name || '') : '';
      
      // 디버깅 로그
      if (!coachName && userId) {
        console.log(`[Training Room Modal] Coach를 찾을 수 없음 - user_id: ${userId}, Map 크기: ${userMap.size}`);
      }
    }
    
    // [Module 2] 인증된 카드에는 verified-room 클래스도 추가
    // sessionStorage에서도 체크하여 인증 상태 복원
    let finalIsAuthenticated = isAuthenticated;
    if (!finalIsAuthenticated) {
      try {
        const stored = sessionStorage.getItem('authenticatedTrainingRooms');
        if (stored) {
          const roomIds = JSON.parse(stored);
          finalIsAuthenticated = roomIds.includes(roomIdStr);
          if (finalIsAuthenticated && !authenticatedTrainingRooms.has(roomIdStr)) {
            // sessionStorage에만 있고 메모리에 없으면 메모리에도 추가
            authenticatedTrainingRooms.add(roomIdStr);
          }
        }
      } catch (e) {
        console.warn('[Training Room Modal] sessionStorage 체크 실패:', e);
      }
    }
    
    const verifiedClass = finalIsAuthenticated ? 'verified-room authenticated' : '';
    
    // onclick 속성 제거 - 이벤트 위임 사용
    return `
      <div class="training-room-card ${isSelected ? 'selected' : ''} ${verifiedClass}" 
           data-room-id="${room.id}" 
           data-room-title="${escapeHtml(room.title)}"
           data-room-password="${hasPassword ? escapeHtml(String(room.password)) : ''}"
           data-is-authenticated="${finalIsAuthenticated ? 'true' : 'false'}"
           style="${finalIsAuthenticated ? 'cursor: default; pointer-events: none;' : 'cursor: pointer;'}"
           ${finalIsAuthenticated ? 'onclick="return false;"' : ''}>
        <div class="training-room-content">
          <div class="training-room-name-section">
            <div class="training-room-name ${room.title ? 'has-name' : 'no-name'}">
              ${room.title ? escapeHtml(room.title) : '훈련방 이름 없음'}
            </div>
            ${hasPassword ? `
              <img src="assets/img/lock.png" alt="비밀번호" class="training-room-lock-icon" />
            ` : ''}
          </div>
          <div class="training-room-coach-section">
            <div class="training-room-coach ${coachName ? 'has-coach' : 'no-coach'}">
              ${coachName ? `Manager: ${escapeHtml(coachName)}` : '코치 없음'}
            </div>
          </div>
        </div>
        ${isSelected ? '<div class="training-room-check">✓</div>' : ''}
      </div>
    `;
  });
  
  // DocumentFragment를 사용하여 DOM 조작 최소화
  const isMobile = isMobileDeviceForTrainingRooms();
  if (isMobile) {
    requestAnimationFrame(() => {
      tempDiv.innerHTML = htmlStrings.join('');
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      listContainer.innerHTML = '';
      listContainer.appendChild(fragment);
    });
  } else {
    tempDiv.innerHTML = htmlStrings.join('');
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    listContainer.innerHTML = '';
    listContainer.appendChild(fragment);
  }

  // ========== 최고 수준의 클릭 차단 로직 ==========
  // 1. Capturing phase에서 차단 (가장 먼저 실행)
  const capturingHandler = (e) => {
    const card = e.target.closest('.training-room-card');
    if (!card) return;
    
    const roomId = card.dataset.roomId;
    if (!roomId) return;
    
    // sessionStorage와 메모리 모두 체크
    const roomIdStr = String(roomId);
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isVerified = card.classList.contains('verified-room') || 
                      card.classList.contains('authenticated') ||
                      card.dataset.isAuthenticated === 'true' ||
                      isInMemory ||
                      isInStorage;
    
    if (isVerified) {
      // 버튼 클릭만 허용
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      
      if (!isButtonClick) {
        // 즉시 차단 (capturing phase에서)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[Training Room Modal] [CAPTURING] 인증된 방 클릭 차단:', roomIdStr);
        return false;
      }
    }
  };
  
  // 2. Bubbling phase에서도 차단 (이중 방어)
  const clickHandler = (e) => {
    // 선택된 섹션 영역 클릭 차단
    const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
    if (selectedSection && (selectedSection.contains(e.target) || e.target === selectedSection)) {
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      if (!isButtonClick) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      return;
    }

    // 카드 클릭 확인
    const card = e.target.closest('.training-room-card');
    if (!card) return;

    const roomId = card.dataset.roomId;
    if (!roomId) return;
    
    const roomIdStr = String(roomId);
    
    // 다중 체크: DOM 클래스, data 속성, 메모리, sessionStorage
    const hasVerifiedClass = card.classList.contains('verified-room') || 
                            card.classList.contains('authenticated');
    const hasVerifiedAttr = card.dataset.isAuthenticated === 'true';
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isVerified = hasVerifiedClass || hasVerifiedAttr || isInMemory || isInStorage;
    
    if (isVerified) {
      const isButtonClick = e.target.tagName === 'BUTTON' || 
                           e.target.closest('button') ||
                           e.target.id === 'btnPlayerModal' || 
                           e.target.id === 'btnCoachModal' ||
                           e.target.closest('#btnPlayerModal') || 
                           e.target.closest('#btnCoachModal');
      
      if (!isButtonClick) {
        console.log('[Training Room Modal] [BUBBLING] 인증된 방 클릭 차단:', {
          roomId: roomIdStr,
          hasVerifiedClass,
          hasVerifiedAttr,
          isInMemory,
          isInStorage
        });
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      return;
    }

    // 인증되지 않은 카드만 선택 처리
    console.log('[Training Room Modal] 인증되지 않은 카드 클릭, 선택 처리:', roomId);
    selectTrainingRoomForModal(roomId);
  };

  // Capturing phase 리스너 (가장 먼저 실행)
  listContainer.addEventListener('click', capturingHandler, true);
  // Bubbling phase 리스너 (이중 방어)
  listContainer.addEventListener('click', clickHandler, false);
  
  // 나중에 제거하기 위해 참조 저장
  listContainer._trainingRoomCapturingHandler = capturingHandler;
  listContainer._trainingRoomClickHandler = clickHandler;

  // CSS는 style.css에 정의되어 있음 (동적 스타일 추가 불필요)
}

/**
 * 모달에서 Training Room 선택
 * Room 목록 선택 시 비밀번호 유무에 따라:
 * - 비밀번호 없는 Training Room: 체크되고 Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 * - 비밀번호 설정 Room: 비밀번호 확인 팝업창 뜨고 비밀번호 확인
 * - 비밀번호 확인 성공 > Player(grade=1,2,3), Coach(grade=1,3) 버튼 활성화
 */
async function selectTrainingRoomForModal(roomId) {
  // ========== 최고 수준의 즉시 차단 로직 ==========
  // 함수 시작 즉시 인증 상태 체크 (가장 먼저 실행)
  const roomIdStr = String(roomId);
  
  // 메모리와 sessionStorage 모두 체크
  const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
  let isInStorage = false;
  try {
    const stored = sessionStorage.getItem('authenticatedTrainingRooms');
    if (stored) {
      const roomIds = JSON.parse(stored);
      isInStorage = roomIds.includes(roomIdStr);
    }
  } catch (e) {}
  
  // DOM에서도 체크
  const card = document.querySelector(`.training-room-card[data-room-id="${roomId}"]`);
  const isInDOM = card && (
    card.classList.contains('verified-room') ||
    card.classList.contains('authenticated') ||
    card.dataset.isAuthenticated === 'true'
  );
  
  // 이미 인증된 방이면 즉시 리턴 (함수 실행 자체를 차단)
  if (isInMemory || isInStorage || isInDOM) {
    console.log('[Training Room Modal] [즉시 차단] 이미 인증된 방입니다. 함수 실행 차단:', {
      roomId: roomIdStr,
      isInMemory,
      isInStorage,
      isInDOM
    });
    return;
  }
  
  // roomId를 숫자로 변환 (문자열로 전달될 수 있음)
  const roomIdNum = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
  const room = trainingRoomList.find(r => r.id == roomIdNum || String(r.id) === String(roomIdNum));
  if (!room) {
    console.error('[Training Room Modal] 선택한 방을 찾을 수 없습니다:', roomId, '타입:', typeof roomId, '변환:', roomIdNum);
    console.error('[Training Room Modal] 현재 목록:', trainingRoomList.map(r => ({ id: r.id, type: typeof r.id })));
    return;
  }

  // 사용자 등급 확인
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (window.currentUser?.grade || '2');
  const isAdmin = userGrade === '1' || userGrade === 1;
  const hasPassword = room.password && String(room.password).trim() !== '';

  // 이미 선택된 Training Room을 다시 클릭한 경우 처리
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id == room.id) {
    // 이미 선택된 Room이고 인증된 경우, 재인증 없이 바로 리턴
    if (hasPassword && !isAdmin) {
      if (authenticatedTrainingRooms.has(roomIdStr)) {
        console.log('[Training Room Modal] 이미 선택되고 인증된 Training Room입니다. 재선택 무시');
        return;
      }
    } else {
      console.log('[Training Room Modal] 이미 선택된 Training Room입니다. 재선택 무시');
      return;
    }
  }

  console.log('[Training Room Modal] 선택한 Room 정보:', {
    id: room.id,
    user_id: room.user_id || room.userId,
    title: room.title,
    hasPassword: !!(room.password && String(room.password).trim() !== ''),
    isAlreadyAuthenticated: authenticatedTrainingRooms.has(roomIdStr)
  });

  // 사용자 등급 확인 (grade=1 관리자, grade=3 코치)
  const isCoach = userGrade === '3' || userGrade === 3;
  
  // 비밀번호 확인을 위해 임시로 room 저장
  const previousRoom = currentSelectedTrainingRoom;
  currentSelectedTrainingRoom = room;
  
  // 비밀번호가 있는 경우: 비밀번호 확인 팝업창 표시 (관리자는 제외, 이미 인증된 경우 제외)
  if (hasPassword && !isAdmin) {
    // 이미 인증된 Training Room인지 확인
    if (authenticatedTrainingRooms.has(roomIdStr)) {
      console.log('[Training Room Modal] 이미 인증된 Training Room입니다. 재인증 생략');
    } else {
      console.log('[Training Room Modal] 비밀번호 확인 필요');
      // 비밀번호 확인 모달 표시 (room 객체 전달)
      const passwordCorrect = await showTrainingRoomPasswordModal(room.title, room);
      if (!passwordCorrect) {
        // 비밀번호가 틀리면 이전 상태로 복원
        console.log('[Training Room Modal] 비밀번호 확인 실패');
        currentSelectedTrainingRoom = previousRoom;
        // 카드 목록 다시 렌더링하여 onclick 복원
        const users = Array.isArray(window.users) ? window.users : (Array.isArray(window.userProfiles) ? window.userProfiles : []);
        renderTrainingRoomListForModal(trainingRoomList, users);
        return;
      }
      // 비밀번호 확인 성공 시 인증된 Room 목록에 추가 (메모리 + sessionStorage)
      authenticatedTrainingRooms.add(roomIdStr);
      saveAuthenticatedRooms(); // sessionStorage에도 저장
      console.log('[Training Room Modal] 비밀번호 확인 성공, 인증 상태 저장 (메모리 + sessionStorage):', roomIdStr);
    }
  } else if (hasPassword && isAdmin) {
    console.log('[Training Room Modal] 관리자는 비밀번호 확인 생략');
  } else {
    console.log('[Training Room Modal] 비밀번호가 없는 Room');
  }

  // 선택된 Training Room 저장 (비밀번호 확인 완료 또는 비밀번호 없음)
  // 전역 변수 및 localStorage에 room id와 이름 저장 (Firebase Config에서 사용)
  if (typeof window !== 'undefined') {
    window.currentTrainingRoomId = String(room.id);
    window.currentTrainingRoomName = room.name || room.title || room.Name || room.roomName || null;
    // Firebase Config의 SESSION_ID도 업데이트
    window.SESSION_ID = String(room.id);
    console.log('[Training Room Modal] window.SESSION_ID 업데이트:', window.SESSION_ID);
    console.log('[Training Room Modal] window.currentTrainingRoomName 저장:', window.currentTrainingRoomName);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('currentTrainingRoomId', String(room.id));
      if (room.name || room.title || room.Name || room.roomName) {
        localStorage.setItem('currentTrainingRoomName', room.name || room.title || room.Name || room.roomName);
      }
    } catch (e) {
      console.warn('[Training Room Modal] localStorage 저장 실패:', e);
    }
  }
  console.log('[Training Room Modal] Room ID 저장됨:', room.id);

  // 선택된 카드 하이라이트 및 인증 상태 업데이트 (재선택 방지)
  const modalListContainer = document.getElementById('trainingRoomModalList');
  if (modalListContainer) {
    // 메모리와 sessionStorage 모두 체크
    const isInMemory = authenticatedTrainingRooms.has(roomIdStr);
    let isInStorage = false;
    try {
      const stored = sessionStorage.getItem('authenticatedTrainingRooms');
      if (stored) {
        const roomIds = JSON.parse(stored);
        isInStorage = roomIds.includes(roomIdStr);
      }
    } catch (e) {}
    
    const isAuthenticated = !hasPassword || isAdmin || isInMemory || isInStorage;
    
    modalListContainer.querySelectorAll('.training-room-card').forEach(card => {
      card.classList.remove('selected', 'authenticated', 'verified-room');
      
      // 기존 체크마크 제거
      const existingCheck = card.querySelector('.training-room-check');
      if (existingCheck) {
        existingCheck.remove();
      }
      
      // 선택된 카드 처리
      if (card.dataset.roomId == roomIdNum || card.dataset.roomId === String(roomIdNum)) {
        card.classList.add('selected');
        if (isAuthenticated) {
          // 인증 완료 시 verified-room 클래스 추가
          card.classList.add('authenticated', 'verified-room');
          // 인증된 카드는 data-is-authenticated 속성 업데이트하여 클릭 차단
          card.dataset.isAuthenticated = 'true';
          // 인증된 방은 클릭 가능한 느낌(포인터) 제거
          card.style.cursor = 'default';
          // onclick 속성 제거
          card.removeAttribute('onclick');
          card.onclick = null;
          
          // sessionStorage에도 저장 (혹시 모를 경우 대비)
          if (!isInMemory) {
            authenticatedTrainingRooms.add(roomIdStr);
            saveAuthenticatedRooms();
          }
          
          console.log('[Training Room Modal] 인증 완료: verified-room 상태 적용됨', {
            roomId: roomIdStr,
            hasVerifiedClass: card.classList.contains('verified-room'),
            hasAuthenticatedClass: card.classList.contains('authenticated'),
            isAuthenticatedAttr: card.dataset.isAuthenticated,
            isInMemory,
            isInStorage
          });
        }
        
        if (!card.querySelector('.training-room-check')) {
          const checkMark = document.createElement('div');
          checkMark.className = 'training-room-check';
          checkMark.textContent = '✓';
          card.appendChild(checkMark);
        }
      }
    });
  }
  
  // MutationObserver로 DOM 변경 감지하여 인증 상태 복원
  if (modalListContainer && !modalListContainer._authStateObserver) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          // 인증된 방의 상태 복원
          try {
            const stored = sessionStorage.getItem('authenticatedTrainingRooms');
            if (stored) {
              const roomIds = JSON.parse(stored);
              roomIds.forEach(roomId => {
                const card = modalListContainer.querySelector(`.training-room-card[data-room-id="${roomId}"]`);
                if (card && !card.classList.contains('verified-room')) {
                  card.classList.add('authenticated', 'verified-room');
                  card.dataset.isAuthenticated = 'true';
                  card.style.cursor = 'default';
                  card.removeAttribute('onclick');
                  card.onclick = null;
                }
              });
            }
          } catch (e) {
            console.warn('[Training Room Modal] MutationObserver 오류:', e);
          }
        }
      });
    });
    
    observer.observe(modalListContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-authenticated', 'class']
    });
    
    modalListContainer._authStateObserver = observer;
  }

  // 선택된 Training Room 정보 표시
  const selectedSection = document.getElementById('selectedTrainingRoomModalSection');
  const selectedTitle = document.getElementById('selectedTrainingRoomModalTitle');
  const btnPlayer = document.getElementById('btnPlayerModal');
  const btnCoach = document.getElementById('btnCoachModal');
  
  console.log('[Training Room Modal] DOM 요소 확인:', {
    selectedSection: !!selectedSection,
    selectedTitle: !!selectedTitle,
    btnPlayer: !!btnPlayer,
    btnCoach: !!btnCoach,
    switchElement: !!document.getElementById('deviceConnectionSwitch')
  });

  // [추가 방어] 선택된 Training Room 섹션 영역에 클릭 이벤트 차단 추가
  if (selectedSection) {
    // 기존 핸들러 제거 (중복 방지)
    const existingSectionHandler = selectedSection._clickBlockHandler;
    if (existingSectionHandler) {
      selectedSection.removeEventListener('click', existingSectionHandler, true);
    }

    // 새로운 핸들러 추가 (캡처 단계에서 차단)
    const sectionClickHandler = (e) => {
      // 버튼 클릭은 허용
      if (e.target.tagName === 'BUTTON' || e.target.closest('button') || 
          e.target.id === 'btnPlayerModal' || e.target.id === 'btnCoachModal' ||
          e.target.closest('#btnPlayerModal') || e.target.closest('#btnCoachModal')) {
        return; // 버튼 클릭은 정상 처리
      }
      
      // 스위치 클릭도 허용
      if (e.target.id === 'deviceConnectionSwitch' || 
          e.target.closest('#deviceConnectionSwitch') ||
          e.target.id === 'switchSlider' ||
          e.target.closest('.device-connection-switch')) {
        return; // 스위치 클릭은 정상 처리
      }
      
      // 버튼이 아닌 영역 클릭 차단
      console.log('[Training Room Modal] 선택된 섹션 여백 클릭 차단 (섹션 핸들러)');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    
    selectedSection.addEventListener('click', sectionClickHandler, true); // 캡처 단계
    selectedSection._clickBlockHandler = sectionClickHandler;
  }

  if (selectedSection && selectedTitle) {
    selectedTitle.textContent = room.title;
    selectedSection.style.display = 'block';
    
    console.log('[Training Room Modal] 선택된 Room 섹션 표시:', room.title);
    console.log('[Training Room Modal] selectedSection.style.display:', selectedSection.style.display);
    
    // 디바이스 연결 방식 스위치 초기화 (약간의 지연을 두어 DOM이 완전히 렌더링된 후 실행)
    setTimeout(() => {
      const switchElement = document.getElementById('deviceConnectionSwitch');
      const switchContainer = document.querySelector('.device-connection-switch-container');
      console.log('[Training Room Modal] 스위치 요소 확인:', {
        switchElement: !!switchElement,
        switchContainer: !!switchContainer,
        selectedSectionDisplay: selectedSection ? selectedSection.style.display : 'null',
        selectedSectionVisible: selectedSection ? window.getComputedStyle(selectedSection).display : 'null'
      });
      
      if (switchElement) {
        console.log('[Training Room Modal] 스위치 요소 발견, 초기화 시작');
        initializeDeviceConnectionSwitch();
      } else {
        console.warn('[Training Room Modal] 스위치 요소를 찾을 수 없습니다. DOM이 아직 준비되지 않았을 수 있습니다.');
        console.warn('[Training Room Modal] selectedSection HTML:', selectedSection ? selectedSection.innerHTML.substring(0, 200) : 'null');
        // 재시도
        setTimeout(() => {
          const retrySwitch = document.getElementById('deviceConnectionSwitch');
          if (retrySwitch) {
            console.log('[Training Room Modal] 재시도: 스위치 초기화');
            initializeDeviceConnectionSwitch();
          } else {
            console.error('[Training Room Modal] 스위치 요소를 찾을 수 없습니다.');
            console.error('[Training Room Modal] selectedSection 전체 HTML:', selectedSection ? selectedSection.innerHTML : 'null');
          }
        }, 300);
      }
    }, 100);
  } else {
    console.error('[Training Room Modal] selectedSection 또는 selectedTitle을 찾을 수 없습니다:', {
      selectedSection: !!selectedSection,
      selectedTitle: !!selectedTitle
    });
  }

  // 비밀번호 확인 성공 후 버튼 활성화
  // Player 버튼: grade=1,2,3 활성화
  // Coach 버튼: grade=1,3만 활성화
  const userGradeNum = typeof userGrade === 'string' ? parseInt(userGrade, 10) : userGrade;
  const canAccessPlayer = userGradeNum === 1 || userGradeNum === 2 || userGradeNum === 3;
  const canAccessCoach = userGradeNum === 1 || userGradeNum === 3;
  
  console.log('[Training Room Modal] 버튼 활성화:', { 
    userGrade, 
    userGradeNum,
    canAccessPlayer, 
    canAccessCoach, 
    isAdmin, 
    isCoach 
  });
  
  if (btnPlayer) {
    btnPlayer.disabled = !canAccessPlayer;
    if (canAccessPlayer) {
      btnPlayer.style.opacity = '1';
      btnPlayer.style.cursor = 'pointer';
    } else {
      btnPlayer.style.opacity = '0.5';
      btnPlayer.style.cursor = 'not-allowed';
    }
  }
  if (btnCoach) {
    btnCoach.disabled = !canAccessCoach;
    if (canAccessCoach) {
      btnCoach.style.opacity = '1';
      btnCoach.style.cursor = 'pointer';
    } else {
      btnCoach.style.opacity = '0.5';
      btnCoach.style.cursor = 'not-allowed';
    }
  }
}

/**
 * 디바이스 연결 방식 스위치 초기화
 */
function initializeDeviceConnectionSwitch() {
  const switchElement = document.getElementById('deviceConnectionSwitch');
  const slider = document.getElementById('switchSlider');
  const labelAnt = document.getElementById('switchLabelAnt');
  const labelBluetooth = document.getElementById('switchLabelBluetooth');
  
  if (!switchElement || !slider) {
    console.warn('[Device Connection Switch] 스위치 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 기존 이벤트 리스너 제거 (중복 방지)
  if (switchElement._clickHandler) {
    switchElement.removeEventListener('click', switchElement._clickHandler);
  }
  if (switchElement._mouseDownHandler) {
    switchElement.removeEventListener('mousedown', switchElement._mouseDownHandler);
  }
  if (switchElement._mouseMoveHandler) {
    document.removeEventListener('mousemove', switchElement._mouseMoveHandler);
  }
  if (switchElement._mouseUpHandler) {
    document.removeEventListener('mouseup', switchElement._mouseUpHandler);
  }
  if (switchElement._touchStartHandler) {
    switchElement.removeEventListener('touchstart', switchElement._touchStartHandler);
  }
  if (switchElement._touchMoveHandler) {
    document.removeEventListener('touchmove', switchElement._touchMoveHandler);
  }
  if (switchElement._touchEndHandler) {
    document.removeEventListener('touchend', switchElement._touchEndHandler);
  }
  
  // 드래그 상태 추적 변수 (클로저로 관리)
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasMoved = false;
  let isProcessing = false; // 중복 실행 방지 플래그
  const DRAG_THRESHOLD = 5; // 픽셀 단위 드래그 임계값
  
  // 저장된 모드 복원 (없으면 기본값 'bluetooth')
  const savedMode = sessionStorage.getItem('deviceConnectionMode') || 'bluetooth';
  deviceConnectionMode = savedMode;
  
  // 전역 변수도 동기화
  window.deviceConnectionMode = deviceConnectionMode;
  
  // 스위치 상태 업데이트
  updateDeviceConnectionSwitch(deviceConnectionMode);
  
  console.log('[Device Connection Switch] 초기화 완료, 모드:', deviceConnectionMode);
  
  // 마우스 이벤트 핸들러
  const mouseDownHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging = false;
    hasMoved = false;
    isProcessing = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  };
  switchElement.addEventListener('mousedown', mouseDownHandler, { passive: false });
  switchElement._mouseDownHandler = mouseDownHandler;
  
  const mouseMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mousemove', mouseMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
      isDragging = true;
      hasMoved = true;
      // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('mousemove', mouseMoveHandler, { passive: false });
  switchElement._mouseMoveHandler = mouseMoveHandler;
  
  const mouseUpHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mouseup', mouseUpHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시 (다른 화면의 버튼 동작 방해 방지)
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    e.stopPropagation();
    e.preventDefault();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      hasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !hasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    hasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('mouseup', mouseUpHandler, { passive: false });
  switchElement._mouseUpHandler = mouseUpHandler;
  
  // 클릭 이벤트 핸들러 - 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
  const clickHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (switchElement && switchElement.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      // mouseup에서 이미 처리했으므로 여기서는 아무것도 하지 않음
    }
    // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
    return false;
  };
  switchElement.addEventListener('click', clickHandler, { passive: false });
  switchElement._clickHandler = clickHandler;
  
  // 터치 이벤트 핸들러 (모바일) - 드래그 상태 추적 변수 재사용
  let touchHasMoved = false;
  
  const touchStartHandler = (e) => {
    e.stopPropagation();
    isDragging = false;
    touchHasMoved = false;
    isProcessing = false;
    if (e.touches && e.touches.length > 0) {
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
    }
  };
  switchElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  switchElement._touchStartHandler = touchStartHandler;
  
  const touchMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchmove', touchMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (e.touches && e.touches.length > 0) {
      const touchTarget = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
        return;
      }
    }
    
    if (e.touches && e.touches.length > 0) {
      const deltaX = Math.abs(e.touches[0].clientX - dragStartX);
      const deltaY = Math.abs(e.touches[0].clientY - dragStartY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDragging = true;
        touchHasMoved = true;
        // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  switchElement._touchMoveHandler = touchMoveHandler;
  
  const touchEndHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchend', touchEndHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시 (다른 화면의 버튼 동작 방해 방지)
    const touchTarget = e.changedTouches && e.changedTouches.length > 0 
      ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY) 
      : e.target;
    
    if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
      // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      touchHasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !touchHasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    touchHasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  switchElement._touchEndHandler = touchEndHandler;
  
  console.log('[Device Connection Switch] 초기화 완료, 모드:', deviceConnectionMode);
}

/**
 * 디바이스 연결 방식 토글
 */
function toggleDeviceConnectionMode() {
  // ANT+ <-> Bluetooth 전환
  deviceConnectionMode = deviceConnectionMode === 'ant' ? 'bluetooth' : 'ant';
  
  // 전역 변수도 동기화
  window.deviceConnectionMode = deviceConnectionMode;
  
  // 스위치 상태 업데이트
  updateDeviceConnectionSwitch(deviceConnectionMode);
  
  // 모드 저장
  sessionStorage.setItem('deviceConnectionMode', deviceConnectionMode);
  
  console.log('[Device Connection Switch] 모드 변경:', deviceConnectionMode);
  
  // 토스트 메시지 표시
  if (typeof showToast === 'function') {
    const modeText = deviceConnectionMode === 'ant' ? 'ANT+' : 'Bluetooth';
    showToast(`연결 방식: ${modeText}`, 'info');
  }
}

/**
 * 디바이스 연결 방식 스위치 UI 업데이트
 */
function updateDeviceConnectionSwitch(mode) {
  const switchElement = document.getElementById('deviceConnectionSwitch');
  const slider = document.getElementById('switchSlider');
  const labelAnt = document.getElementById('switchLabelAnt');
  const labelBluetooth = document.getElementById('switchLabelBluetooth');
  
  if (!switchElement || !slider) return;
  
  // 기존 클래스 제거
  switchElement.classList.remove('active-ant', 'active-bluetooth');
  
  if (mode === 'bluetooth') {
    // Bluetooth 모드: 슬라이더를 왼쪽으로 이동 (녹색)
    switchElement.classList.add('active-bluetooth');
    slider.style.left = '0%'; // 명시적으로 '%' 포함하여 일관성 유지
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 보이고, 오른쪽(ANT+)은 가려짐
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '4'; // 보임 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '2'; // 가려짐 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '400';
      labelAnt.style.color = '#999';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '600';
      labelBluetooth.style.color = '#22c55e';
    }
  } else {
    // ANT+ 모드 (기본값): 슬라이더를 오른쪽으로 이동 (녹색)
    switchElement.classList.add('active-ant');
    slider.style.left = '50%';
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 가려지고, 오른쪽(ANT+)은 보임
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '2'; // 가려짐 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '4'; // 보임 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '600';
      labelAnt.style.color = '#22c55e';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '400';
      labelBluetooth.style.color = '#999';
    }
  }
}

/**
 * 일반 화면용 디바이스 연결 방식 스위치 초기화
 */
function initializeDeviceConnectionSwitchForScreen() {
  const switchElement = document.getElementById('deviceConnectionSwitchScreen');
  const slider = document.getElementById('switchSliderScreen');
  const labelAnt = document.getElementById('switchLabelAntScreen');
  const labelBluetooth = document.getElementById('switchLabelBluetoothScreen');
  
  if (!switchElement || !slider) {
    console.warn('[Device Connection Switch Screen] 스위치 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 기존 이벤트 리스너 제거 (중복 방지)
  if (switchElement._clickHandler) {
    switchElement.removeEventListener('click', switchElement._clickHandler);
  }
  if (switchElement._mouseDownHandler) {
    switchElement.removeEventListener('mousedown', switchElement._mouseDownHandler);
  }
  if (switchElement._mouseMoveHandler) {
    document.removeEventListener('mousemove', switchElement._mouseMoveHandler);
  }
  if (switchElement._mouseUpHandler) {
    document.removeEventListener('mouseup', switchElement._mouseUpHandler);
  }
  if (switchElement._touchStartHandler) {
    switchElement.removeEventListener('touchstart', switchElement._touchStartHandler);
  }
  if (switchElement._touchMoveHandler) {
    document.removeEventListener('touchmove', switchElement._touchMoveHandler);
  }
  if (switchElement._touchEndHandler) {
    document.removeEventListener('touchend', switchElement._touchEndHandler);
  }
  
  // 드래그 상태 추적 변수 (클로저로 관리)
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasMoved = false;
  let isProcessing = false; // 중복 실행 방지 플래그
  const DRAG_THRESHOLD = 5; // 픽셀 단위 드래그 임계값
  
  // 저장된 모드 복원 (없으면 기본값 'bluetooth')
  const savedMode = sessionStorage.getItem('deviceConnectionMode') || 'bluetooth';
  deviceConnectionMode = savedMode;
  
  // 스위치 상태 업데이트 (일반 화면용)
  updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
  
  // 슬라이드 스위치 요소 자체인지 확인하는 헬퍼 함수
  const isSwitchElement = (target) => {
    return target === switchElement || 
           target.closest('.switch-option') || 
           target.closest('.switch-slider') ||
           switchElement.contains(target);
  };
  
  // 마우스 이벤트 핸들러
  const mouseDownHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (isSwitchElement(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      isDragging = false;
      hasMoved = false;
      isProcessing = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    } else {
      // 슬라이드 스위치가 아닌 영역을 클릭한 경우 이벤트 전파 차단
      e.stopPropagation();
      e.preventDefault();
    }
  };
  switchElement.addEventListener('mousedown', mouseDownHandler, { passive: false });
  switchElement._mouseDownHandler = mouseDownHandler;
  
  const mouseMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mousemove', mouseMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (!switchElement.contains(e.target) && e.target !== switchElement) {
      return;
    }
    
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
      isDragging = true;
      hasMoved = true;
      // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('mousemove', mouseMoveHandler, { passive: false });
  switchElement._mouseMoveHandler = mouseMoveHandler;
  
  const mouseUpHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('mouseup', mouseUpHandler);
      return;
    }
    
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (!isSwitchElement(e.target)) {
      // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.stopPropagation();
    e.preventDefault();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      hasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !hasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    hasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('mouseup', mouseUpHandler, { passive: false });
  switchElement._mouseUpHandler = mouseUpHandler;
  
  // 클릭 이벤트 핸들러 - 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
  const clickHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 클릭한 경우에만 처리
    if (switchElement && isSwitchElement(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      // mouseup에서 이미 처리했으므로 여기서는 아무것도 하지 않음
    }
    // 슬라이드 스위치가 아닌 영역을 클릭한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
    return false;
  };
  switchElement.addEventListener('click', clickHandler, { passive: false });
  switchElement._clickHandler = clickHandler;
  
  // 터치 이벤트 핸들러 (모바일) - 드래그 상태 추적 변수 재사용
  let touchHasMoved = false;
  
  const touchStartHandler = (e) => {
    // 슬라이드 스위치 요소 자체를 터치한 경우에만 처리
    const touchTarget = e.touches && e.touches.length > 0 ? document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) : e.target;
    if (touchTarget && isSwitchElement(touchTarget)) {
      e.stopPropagation();
      isDragging = false;
      touchHasMoved = false;
      isProcessing = false;
      if (e.touches && e.touches.length > 0) {
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
      }
    }
    // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
  };
  switchElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  switchElement._touchStartHandler = touchStartHandler;
  
  const touchMoveHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchmove', touchMoveHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시
      return;
    }
    
    if (dragStartX === 0 && dragStartY === 0) return;
    
    // 이벤트 타겟이 슬라이드 스위치와 관련이 없는 경우 무시
    if (e.touches && e.touches.length > 0) {
      const touchTarget = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touchTarget || (!switchElement.contains(touchTarget) && touchTarget !== switchElement)) {
        return;
      }
    }
    
    if (e.touches && e.touches.length > 0) {
      const deltaX = Math.abs(e.touches[0].clientX - dragStartX);
      const deltaY = Math.abs(e.touches[0].clientY - dragStartY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDragging = true;
        touchHasMoved = true;
        // 드래그가 감지되면 즉시 모든 후속 이벤트 차단
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  switchElement._touchMoveHandler = touchMoveHandler;
  
  const touchEndHandler = (e) => {
    // 슬라이드 스위치와 관련된 이벤트인지 확인
    if (!switchElement || !switchElement.parentElement || !document.body.contains(switchElement)) {
      // 슬라이드 스위치가 DOM에서 제거된 경우 리스너 제거
      document.removeEventListener('touchend', touchEndHandler);
      return;
    }
    
    // 슬라이드 스위치가 보이는 화면인지 확인 (다른 화면에서는 동작하지 않도록)
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    const isTrainingRoomScreenActive = trainingRoomScreen && 
      (trainingRoomScreen.classList.contains('active') || 
       window.getComputedStyle(trainingRoomScreen).display !== 'none');
    
    if (!isTrainingRoomScreenActive) {
      // Training Room 화면이 아닌 경우 무시 (다른 화면의 버튼 동작 방해 방지)
      return;
    }
    
    // 슬라이드 스위치 요소 자체를 터치한 경우에만 처리
    const touchTarget = e.changedTouches && e.changedTouches.length > 0 
      ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY) 
      : e.target;
    
    if (!touchTarget || !isSwitchElement(touchTarget)) {
      // 슬라이드 스위치가 아닌 영역을 터치한 경우 - 다른 버튼 동작을 방해하지 않도록 아무것도 하지 않음
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // 이미 처리 중이면 무시
    if (isProcessing) {
      // 상태만 리셋
      isDragging = false;
      touchHasMoved = false;
      dragStartX = 0;
      dragStartY = 0;
      return;
    }
    
    // 드래그가 아니고 움직임이 없었을 때만 토글
    if (!isDragging && !touchHasMoved) {
      isProcessing = true;
      toggleDeviceConnectionMode();
      updateDeviceConnectionSwitchForScreen(deviceConnectionMode);
      // 약간의 지연 후 플래그 리셋
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
    
    // 상태 리셋
    isDragging = false;
    touchHasMoved = false;
    dragStartX = 0;
    dragStartY = 0;
  };
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  switchElement._touchEndHandler = touchEndHandler;
  
  console.log('[Device Connection Switch Screen] 초기화 완료, 모드:', deviceConnectionMode);
}

/**
 * 일반 화면용 디바이스 연결 방식 스위치 UI 업데이트
 */
function updateDeviceConnectionSwitchForScreen(mode) {
  const switchElement = document.getElementById('deviceConnectionSwitchScreen');
  const slider = document.getElementById('switchSliderScreen');
  const labelAnt = document.getElementById('switchLabelAntScreen');
  const labelBluetooth = document.getElementById('switchLabelBluetoothScreen');
  
  if (!switchElement || !slider) return;
  
  // 기존 클래스 제거
  switchElement.classList.remove('active-ant', 'active-bluetooth');
  
  if (mode === 'bluetooth') {
    // Bluetooth 모드: 슬라이더를 왼쪽으로 이동 (녹색)
    switchElement.classList.add('active-bluetooth');
    slider.style.left = '0%'; // 명시적으로 '%' 포함하여 일관성 유지
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 보이고, 오른쪽(ANT+)은 가려짐
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '4'; // 보임 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '2'; // 가려짐 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '400';
      labelAnt.style.color = '#999';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '600';
      labelBluetooth.style.color = '#22c55e';
    }
  } else {
    // ANT+ 모드 (기본값): 슬라이더를 오른쪽으로 이동 (녹색)
    switchElement.classList.add('active-ant');
    slider.style.left = '50%';
    slider.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    slider.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
    
    // z-index 조정: 왼쪽(Bluetooth)은 가려지고, 오른쪽(ANT+)은 보임
    const optionLeft = switchElement.querySelector('.switch-option-left');
    const optionRight = switchElement.querySelector('.switch-option-right');
    if (optionLeft) optionLeft.style.zIndex = '2'; // 가려짐 (Bluetooth)
    if (optionRight) optionRight.style.zIndex = '4'; // 보임 (ANT+)
    
    if (labelAnt) {
      labelAnt.style.fontWeight = '600';
      labelAnt.style.color = '#22c55e';
    }
    if (labelBluetooth) {
      labelBluetooth.style.fontWeight = '400';
      labelBluetooth.style.color = '#999';
    }
  }
}

/**
 * 현재 디바이스 연결 방식 가져오기
 */
function getDeviceConnectionMode() {
  // 우선순위: 로컬 변수 > 전역 변수 > sessionStorage > 기본값 'bluetooth'
  if (typeof deviceConnectionMode !== 'undefined' && deviceConnectionMode) {
    return deviceConnectionMode;
  }
  if (window.deviceConnectionMode && (window.deviceConnectionMode === 'bluetooth' || window.deviceConnectionMode === 'ant')) {
    return window.deviceConnectionMode;
  }
  const savedMode = sessionStorage.getItem('deviceConnectionMode');
  if (savedMode && (savedMode === 'bluetooth' || savedMode === 'ant')) {
    return savedMode;
  }
  return 'bluetooth'; // 기본값: bluetooth (초기 로딩 상태)
}

/**
 * 모달에서 Player List 화면 열기
 */
async function openPlayerListFromModal(event) {
  // [Module 3 - Fix Logic] 이벤트 전파 중단 (필수)
  // 버튼 클릭이 부모(훈련방 리스트)로 전달되어 클릭 핸들러를 건드리는 것을 원천 차단
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // 모달 닫기
  closeTrainingRoomModal();

  // Player List 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('playerListScreen');
  }

  // Player List 렌더링
  await renderPlayerList();
}

/**
 * 모달에서 Coach 모드 열기 (디바이스 연결 방식에 따라 화면 이동)
 * [수정됨] 변수 상태를 최우선으로 확인하여 화면 이동 오류 수정
 */
function openCoachModeFromModal(event) {
  console.log('[Coach Modal] ========== Coach 버튼 클릭 시작 ==========');
  
  // [Module 3 - Fix Logic] 이벤트 전파 중단 (필수)
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (!currentSelectedTrainingRoom) {
    console.error('[Coach Modal] ❌ Training Room이 선택되지 않았습니다.');
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }

  // 1. [핵심 수정] 변수 및 스토리지 값을 최우선으로 확인 (UI 위치 계산보다 정확함)
  let currentDeviceMode = 'bluetooth'; // 기본값

  // 전역 변수 확인
  if (window.deviceConnectionMode && (window.deviceConnectionMode === 'bluetooth' || window.deviceConnectionMode === 'ant')) {
    currentDeviceMode = window.deviceConnectionMode;
    console.log('[Coach Modal] 전역 변수에서 모드 확인:', currentDeviceMode);
  } 
  // sessionStorage 확인
  else {
    const savedMode = sessionStorage.getItem('deviceConnectionMode');
    if (savedMode && (savedMode === 'bluetooth' || savedMode === 'ant')) {
      currentDeviceMode = savedMode;
      console.log('[Coach Modal] sessionStorage에서 모드 확인:', currentDeviceMode);
    }
    // 로컬 변수 확인
    else if (typeof deviceConnectionMode !== 'undefined') {
      currentDeviceMode = deviceConnectionMode;
    }
  }

  // 2. 만약 변수 값이 모호할 경우에만 UI 슬라이더 위치 확인 (Fallback)
  const switchSlider = document.getElementById('switchSlider');
  if (switchSlider && !window.deviceConnectionMode && !sessionStorage.getItem('deviceConnectionMode')) {
    const computedStyle = window.getComputedStyle(switchSlider);
    const sliderLeft = switchSlider.style.left || computedStyle.left;
    
    // left 값이 0에 가까우면(왼쪽) Bluetooth, 크면(오른쪽) ANT+
    let isBluetoothPosition = false;
    
    if (sliderLeft.includes('%')) {
      isBluetoothPosition = parseFloat(sliderLeft) < 25;
    } else if (sliderLeft.includes('px')) {
      // px일 경우 부모 너비 대비 비율로 대략적 계산
      isBluetoothPosition = parseFloat(sliderLeft) < 50; 
    }
    
    if (isBluetoothPosition) {
      currentDeviceMode = 'bluetooth';
      console.log('[Coach Modal] UI 슬라이더 위치로 Bluetooth 감지');
    }
  }
  
  // 상태 동기화
  deviceConnectionMode = currentDeviceMode;
  window.deviceConnectionMode = currentDeviceMode;
  sessionStorage.setItem('deviceConnectionMode', currentDeviceMode);
  
  console.log('[Coach Modal] ========== 최종 디바이스 연결 방식:', currentDeviceMode, '==========');
  
  // 모달 닫기
  closeTrainingRoomModal();
  
  // 3. 모드에 따른 화면 이동 분기 처리
  if (currentDeviceMode === 'bluetooth') {
    // [Bluetooth 모드] -> Bluetooth Training Coach 화면으로 이동
    console.log('[Coach Modal] 🚀 Bluetooth 선택됨 → bluetoothTrainingCoachScreen 화면으로 이동');
    
    if (typeof showScreen === 'function') {
      try {
        // [수정 요청 사항 반영] 블루투스 코치 스크린으로 이동
        showScreen('bluetoothTrainingCoachScreen');
        
        // 블루투스 코치용 트랙 정보 로드 (필요 시)
        if (typeof updateBluetoothCoachTracksFromFirebase === 'function') {
          setTimeout(() => updateBluetoothCoachTracksFromFirebase(), 300);
        }
      } catch (error) {
        console.error('[Coach Modal] ❌ 화면 전환 오류:', error);
        showToast('화면 전환 중 오류가 발생했습니다.', 'error');
      }
    }
  } else {
    // [ANT+ 모드] -> 기존 Indoor Training 모드 선택 모달로 이동
    console.log('[Coach Modal] 🚀 ANT+ 선택됨 → Indoor Training 모드 선택 화면으로 이동');
    
    if (typeof showIndoorModeSelectionModal === 'function') {
      showIndoorModeSelectionModal();
    } else {
      // 함수가 없으면 바로 ANT+ 대시보드로 이동 (Fallback)
      if (typeof showScreen === 'function') {
        showScreen('indoorTrainingDashboardScreen');
      }
    }
  }
}

/**
 * Training Room 화면 초기화
 */
function initializeTrainingRoomScreen() {
  // Training Room 생성 팝업 입력 제한 (숫자만)
  initTrainingRoomCreateInputs();
  
  // 생성 버튼 권한 체크 (grade=1만 표시)
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  const createBtn = document.querySelector('.training-room-create-btn');
  if (createBtn) {
    if (userGrade === '1') {
      createBtn.style.display = 'block';
    } else {
      createBtn.style.display = 'none';
    }
  }
  
  // Training Room 목록 로드
  loadTrainingRooms();

  // 선택된 Training Room 정보 초기화
  currentSelectedTrainingRoom = null;
  
  // 모든 카드에서 선택 상태 및 버튼 제거
  setTimeout(() => {
    document.querySelectorAll('.training-room-card').forEach(card => {
      card.classList.remove('selected');
      const existingCheck = card.querySelector('.training-room-check');
      if (existingCheck) {
        existingCheck.remove();
      }
      const existingButtons = card.querySelector('.training-room-action-buttons');
      if (existingButtons) {
        existingButtons.remove();
      }
    });
  }, 100);
  
  // 뒤로 가기 버튼에 모바일 터치 이벤트 추가
  setTimeout(() => {
    const trainingRoomScreen = document.getElementById('trainingRoomScreen');
    if (trainingRoomScreen) {
      // 뒤로 가기 버튼 찾기 (다양한 선택자 시도)
      let backButton = trainingRoomScreen.querySelector('.connection-exit-container .btn-exit-inline');
      if (!backButton) {
        backButton = trainingRoomScreen.querySelector('button.btn-exit-inline[onclick*="basecampScreen"]');
      }
      if (!backButton) {
        // onclick 속성으로 찾기
        const allButtons = trainingRoomScreen.querySelectorAll('.connection-exit-container button');
        backButton = Array.from(allButtons).find(btn => 
          btn.getAttribute('onclick') && btn.getAttribute('onclick').includes('basecampScreen')
        );
      }
      
      if (backButton) {
        // 기존 터치 이벤트 리스너 제거 (중복 방지)
        if (backButton._backButtonTouchHandler) {
          backButton.removeEventListener('touchend', backButton._backButtonTouchHandler);
        }
        
        // 터치 이벤트 핸들러 추가
        const backButtonTouchHandler = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (typeof showScreen === 'function') {
            showScreen('basecampScreen');
          }
        };
        backButton.addEventListener('touchend', backButtonTouchHandler, { passive: false });
        backButton._backButtonTouchHandler = backButtonTouchHandler;
        
        // 터치 스타일 개선
        backButton.style.touchAction = 'manipulation';
        backButton.style.webkitTapHighlightColor = 'transparent';
      }
    }
  }, 150);
}

/**
 * HTML 이스케이프 유틸리티
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ========== Training Room 생성 오버레이 팝업 ========== */
const TRAINING_ROOMS_COLLECTION = 'training_rooms';
const USERS_COLLECTION = 'users';

/**
 * Firestore users 컬렉션에서 grade=3 사용자 목록 조회
 */
async function getGrade3UsersFromFirestore() {
  try {
    if (window.firebase && window.firebase.firestore) {
      const db = window.firebase.firestore();
      const snapshot = await db.collection(USERS_COLLECTION)
        .where('grade', '==', '3')
        .get();
      const users = [];
      snapshot.forEach((doc) => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('[Training Room] Firestore users에서 grade=3 사용자', users.length, '명 로드');
      return users;
    }
    if (window.firestoreV9) {
      const firestoreModule = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
      const collection = firestoreModule.collection;
      const query = firestoreModule.query;
      const where = firestoreModule.where;
      const getDocs = firestoreModule.getDocs;
      const usersRef = collection(window.firestoreV9, USERS_COLLECTION);
      const q = query(usersRef, where('grade', '==', '3'));
      const snapshot = await getDocs(q);
      const users = [];
      snapshot.forEach((doc) => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('[Training Room] Firestore(v9) users에서 grade=3 사용자', users.length, '명 로드');
      return users;
    }
  } catch (e) {
    console.warn('[Training Room] Firestore users 조회 실패:', e);
  }
  return [];
}

/**
 * grade=3 권한 사용자 목록 반환 (Firestore users 우선, 없으면 캐시/API 폴백)
 */
async function getGrade3Users() {
  const fromFirestore = await getGrade3UsersFromFirestore();
  if (Array.isArray(fromFirestore) && fromFirestore.length > 0) {
    return fromFirestore;
  }
  const users = await getUsersListWithCache();
  if (!Array.isArray(users)) return [];
  return users.filter(u => String(u.grade || '') === '3');
}

/**
 * Training Room 생성 모달 열기
 */
async function openTrainingRoomCreateModal() {
  // 권한 체크: grade=1만 생성 가능
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  
  if (userGrade !== '1') {
    if (typeof showToast === 'function') {
      showToast('Training Room 생성 권한이 없습니다. 관리자(grade=1)만 생성할 수 있습니다.', 'error');
    }
    return;
  }

  const overlay = document.getElementById('trainingRoomCreateOverlay');
  if (!overlay) return;
  if (!window._trainingRoomCreateInputsInited) {
    initTrainingRoomCreateInputs();
    window._trainingRoomCreateInputsInited = true;
  }
  
  // 수정 모드 플래그 초기화
  window._trainingRoomEditMode = false;
  window._trainingRoomEditId = null;
  
  overlay.classList.remove('hidden');

  const nameEl = document.getElementById('createRoomName');
  const trackEl = document.getElementById('createRoomTrackCount');
  const managerEl = document.getElementById('createRoomManager');
  const passwordEl = document.getElementById('createRoomPassword');
  const titleEl = document.querySelector('.training-room-create-title');

  if (nameEl) nameEl.value = '';
  if (trackEl) trackEl.value = '';
  if (passwordEl) passwordEl.value = '';
  if (titleEl) titleEl.textContent = 'Training Room 생성';

  if (managerEl) {
    managerEl.innerHTML = '<option value="">관리자 선택 (grade=3 권한 사용자)</option>';
    try {
      const grade3Users = await getGrade3Users();
      grade3Users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = String(u.id || '');
        opt.textContent = (u.name || '이름 없음') + ' (grade=3)';
        managerEl.appendChild(opt);
      });
    } catch (e) {
      console.warn('[Training Room] grade=3 사용자 로드 실패:', e);
    }
  }

  if (typeof showToast === 'function') {
    showToast('Training Room 생성', 'info');
  }
}

/**
 * Training Room 수정 모달 열기
 */
async function openTrainingRoomEditModal(roomId) {
  if (!roomId) return;
  
  // 권한 체크: grade=1 또는 지정된 관리자만 수정 가능
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  const currentUserId = currentUser?.id || currentUser?.uid || '';
  
  // 1순위: 메모리의 trainingRoomList에서 찾기 (가장 빠름)
  let roomData = null;
  const roomIdStr = String(roomId);
  if (Array.isArray(trainingRoomList) && trainingRoomList.length > 0) {
    roomData = trainingRoomList.find(r => String(r.id) === roomIdStr);
    if (roomData) {
      console.log('[Training Room] 메모리에서 Training Room 찾음:', roomData);
      // 수정 시 사용할 컬렉션/문서 ID 저장 (Firestore 조회에 필요)
      window._trainingRoomEditCollection = roomData._sourceCollection || TRAINING_ROOMS_COLLECTION;
    }
  }
  
  // 2순위: Firestore에서 찾기 (training_rooms만 조회)
  if (!roomData) {
    try {
      const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
      if (!db) {
        if (typeof showToast === 'function') showToast('Firestore를 사용할 수 없습니다.', 'error');
        return;
      }

      // ✅ training_rooms에서만 찾기 (training_schedules 제거)
      let docRef = db.collection(TRAINING_ROOMS_COLLECTION).doc(roomIdStr);
      let doc = await docRef.get();
      
      if (doc.exists) {
        roomData = { id: doc.id, ...doc.data(), _sourceCollection: 'training_rooms' };
        window._trainingRoomEditCollection = 'training_rooms';
        console.log('[Training Room] training_rooms에서 찾음:', roomData);
      }
      
      if (!roomData) {
        if (typeof showToast === 'function') showToast('Training Room을 찾을 수 없습니다.', 'error');
        return;
      }
    } catch (e) {
      console.error('[Training Room] Firestore 조회 실패:', e);
      if (typeof showToast === 'function') showToast('Training Room 정보를 불러올 수 없습니다.', 'error');
      return;
    }
  }

  // GAS에서 로드된 방: Firestore에 동일 id 필드로 문서가 있는지 조회해 문서 ID 확보
  if (roomData._sourceCollection === 'gas') {
    try {
      const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
      if (db) {
        const numId = parseInt(roomIdStr, 10);
        if (!isNaN(numId)) {
          let found = await db.collection(TRAINING_ROOMS_COLLECTION).where('id', '==', numId).limit(1).get();
          if (!found.empty) {
            const d = found.docs[0];
            window._trainingRoomEditId = d.id;
            window._trainingRoomEditCollection = TRAINING_ROOMS_COLLECTION;
            roomData = { id: d.id, ...d.data(), _sourceCollection: 'training_rooms' };
            console.log('[Training Room] GAS 방 → Firestore training_rooms 문서 ID로 매핑:', d.id);
          }
          // ✅ training_schedules 조회 제거 (더 이상 사용하지 않음)
        }
      }
    } catch (e) {
      console.warn('[Training Room] GAS 방 Firestore 매핑 조회 실패:', e);
    }
  }

  // 권한 확인
  const roomManagerId = String(roomData.user_id || roomData.userId || '');
  const isAdmin = userGrade === '1';
  const isManager = roomManagerId && String(currentUserId) === roomManagerId;
  
  if (!isAdmin && !isManager) {
    if (typeof showToast === 'function') {
      showToast('Training Room 수정 권한이 없습니다. 관리자(grade=1) 또는 지정된 관리자만 수정할 수 있습니다.', 'error');
    }
    return;
  }
  
  const overlay = document.getElementById('trainingRoomCreateOverlay');
  if (!overlay) return;
  if (!window._trainingRoomCreateInputsInited) {
    initTrainingRoomCreateInputs();
    window._trainingRoomCreateInputsInited = true;
  }
  
  // 수정 모드 플래그 설정 (GAS 방은 위에서 Firestore 문서 ID로 이미 설정됨)
  window._trainingRoomEditMode = true;
  if (window._trainingRoomEditId == null || window._trainingRoomEditId === '') {
    window._trainingRoomEditId = String(roomId);
  }
  
  overlay.classList.remove('hidden');

  const nameEl = document.getElementById('createRoomName');
  const trackEl = document.getElementById('createRoomTrackCount');
  const managerEl = document.getElementById('createRoomManager');
  const passwordEl = document.getElementById('createRoomPassword');
  const titleEl = document.querySelector('.training-room-create-title');

  if (titleEl) titleEl.textContent = 'Training Room 수정';
  
  // roomData에서 정보 로드
  if (nameEl) nameEl.value = roomData.title || roomData.name || '';
  if (trackEl) trackEl.value = String(roomData.track_count || 0);
  if (passwordEl) passwordEl.value = roomData.password || '';

  if (managerEl) {
    managerEl.innerHTML = '<option value="">관리자 선택 (grade=3 권한 사용자)</option>';
    try {
      const grade3Users = await getGrade3Users();
      const currentManagerId = String(roomData.user_id || roomData.userId || '');
      grade3Users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = String(u.id || '');
        opt.textContent = (u.name || '이름 없음') + ' (grade=3)';
        if (String(u.id) === currentManagerId) {
          opt.selected = true;
        }
        managerEl.appendChild(opt);
      });
    } catch (e) {
      console.warn('[Training Room] grade=3 사용자 로드 실패:', e);
    }
  }

  if (typeof showToast === 'function') {
    showToast('Training Room 수정', 'info');
  }
}

/**
 * Training Room 생성 모달 닫기
 */
function closeTrainingRoomCreateModal() {
  const overlay = document.getElementById('trainingRoomCreateOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/**
 * Track 설치 수 입력: 숫자만 허용
 */
function initTrainingRoomCreateInputs() {
  const trackEl = document.getElementById('createRoomTrackCount');
  const passwordEl = document.getElementById('createRoomPassword');
  if (trackEl) {
    trackEl.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });
    trackEl.addEventListener('paste', function (e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
      this.value = text;
    });
  }
  if (passwordEl) {
    passwordEl.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });
    passwordEl.addEventListener('paste', function (e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
      this.value = text;
    });
  }
}

/**
 * Firestore training_rooms 컬렉션에서 다음 일련번호(id) 조회
 */
async function getNextTrainingRoomId() {
  try {
    const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
    if (!db) return 1;

    const snapshot = await db.collection(TRAINING_ROOMS_COLLECTION).get();
    if (snapshot.empty) return 1;

    let maxId = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      const id = typeof data.id === 'number' ? data.id : parseInt(data.id, 10);
      if (!isNaN(id) && id > maxId) maxId = id;
    });
    return maxId + 1;
  } catch (e) {
    console.warn('[Training Room] 다음 ID 조회 실패, 1 사용:', e);
    return 1;
  }
}

/**
 * Training Room 생성/수정 제출 (Firestore training_rooms에 저장)
 */
async function submitTrainingRoomCreate() {
  // 권한 체크
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  const currentUserId = currentUser?.id || currentUser?.uid || '';
  
  const isEditMode = window._trainingRoomEditMode === true;
  const editId = window._trainingRoomEditId;

  // 생성 모드: grade=1만 허용
  if (!isEditMode && userGrade !== '1') {
    if (typeof showToast === 'function') {
      showToast('Training Room 생성 권한이 없습니다. 관리자(grade=1)만 생성할 수 있습니다.', 'error');
    }
    return;
  }

  // 수정 모드: grade=1 또는 지정된 관리자만 허용
  if (isEditMode && editId) {
    try {
      const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
      if (db) {
        let roomData = null;
        let collectionName = window._trainingRoomEditCollection || TRAINING_ROOMS_COLLECTION;
        let docRef = db.collection(collectionName).doc(String(editId));
        let doc = await docRef.get();

        if (doc.exists) {
          roomData = doc.data();
        } else {
          // 문서 ID로 못 찾으면 다른 컬렉션/문서 ID로 시도
          docRef = db.collection(TRAINING_ROOMS_COLLECTION).doc(String(editId));
          doc = await docRef.get();
          if (doc.exists) {
            roomData = doc.data();
            collectionName = TRAINING_ROOMS_COLLECTION;
          } else {
            // ✅ training_schedules 조회 제거 (더 이상 사용하지 않음)
          }
        }

        // 문서 ID로 못 찾은 경우: id 필드(숫자)로 쿼리 (GAS/레거시 대응)
        if (!roomData) {
          const numId = parseInt(String(editId), 10);
          if (!isNaN(numId)) {
            let snap = await db.collection(TRAINING_ROOMS_COLLECTION).where('id', '==', numId).limit(1).get();
            if (!snap.empty) {
              doc = snap.docs[0];
              docRef = doc.ref;
              roomData = doc.data();
              collectionName = TRAINING_ROOMS_COLLECTION;
              window._trainingRoomEditId = doc.id;
            }
            // ✅ training_schedules 조회 제거 (더 이상 사용하지 않음)
          }
        }

        if (roomData) {
          const roomManagerId = String(roomData.user_id || roomData.userId || '');
          const isAdmin = userGrade === '1';
          const isManager = roomManagerId && String(currentUserId) === roomManagerId;

          if (!isAdmin && !isManager) {
            if (typeof showToast === 'function') {
              showToast('Training Room 수정 권한이 없습니다. 관리자(grade=1) 또는 지정된 관리자만 수정할 수 있습니다.', 'error');
            }
            return;
          }

          window._trainingRoomEditCollection = collectionName;
        } else {
          if (typeof showToast === 'function') {
            showToast('Training Room을 찾을 수 없습니다.', 'error');
          }
          return;
        }
      }
    } catch (e) {
      console.error('[Training Room] 수정 권한 확인 실패:', e);
      if (typeof showToast === 'function') showToast('권한 확인 중 오류가 발생했습니다.', 'error');
      return;
    }
  }

  const nameEl = document.getElementById('createRoomName');
  const trackEl = document.getElementById('createRoomTrackCount');
  const managerEl = document.getElementById('createRoomManager');
  const passwordEl = document.getElementById('createRoomPassword');

  const title = nameEl ? String(nameEl.value || '').trim() : '';
  const trackCountStr = trackEl ? String(trackEl.value || '').trim() : '';
  const managerId = managerEl ? String(managerEl.value || '').trim() : '';
  const password = passwordEl ? String(passwordEl.value || '').trim() : '';

  if (!title) {
    if (typeof showToast === 'function') showToast('Training Room Name을 입력하세요.', 'error');
    if (nameEl) nameEl.focus();
    return;
  }

  const trackCount = trackCountStr === '' ? 0 : parseInt(trackCountStr, 10);
  if (isNaN(trackCount) || trackCount < 0) {
    if (typeof showToast === 'function') showToast('Track 설치 수는 0 이상의 숫자만 입력 가능합니다.', 'error');
    if (trackEl) trackEl.focus();
    return;
  }

  if (password.length > 0 && (password.length !== 4 || !/^\d{4}$/.test(password))) {
    if (typeof showToast === 'function') showToast('비밀번호는 4자리 숫자로만 입력하세요.', 'error');
    if (passwordEl) passwordEl.focus();
    return;
  }

  try {
    // Firestore 인스턴스 (로컬 변수명 firestoreDb 사용 → 전역 window.db와 구분)
    const firestoreDb = window.firebase && window.firebase.firestore ? window.firebase.firestore() : (window.firestore || null);
    if (!firestoreDb) {
      if (typeof showToast === 'function') showToast('Firestore를 사용할 수 없습니다.', 'error');
      return;
    }

    let firestoreDocId = null;
    let trainingRoomId = null; // Realtime Database sessionId로 사용할 id 필드 값 (숫자)

    if (isEditMode && editId) {
      // 수정 모드 (권한 체크에서 확정된 컬렉션/문서 ID 사용)
      const collectionName = window._trainingRoomEditCollection || TRAINING_ROOMS_COLLECTION;
      const docIdForUpdate = String(window._trainingRoomEditId || editId);
      const docRef = firestoreDb.collection(collectionName).doc(docIdForUpdate);
      const doc = await docRef.get();

      if (!doc.exists) {
        // id 필드로 한 번 더 조회 (권한 체크와 저장 경로 차이 대비)
        const numId = parseInt(String(editId), 10);
        if (!isNaN(numId)) {
          let snap = await firestoreDb.collection(TRAINING_ROOMS_COLLECTION).where('id', '==', numId).limit(1).get();
          if (!snap.empty) {
            const d = snap.docs[0];
            const docData = d.data();
            const updateData = {
              title: title,
              track_count: trackCount,
              user_id: managerId || null,
              userId: managerId || null,
              password: password || '',
              updated_at: new Date().toISOString ? new Date().toISOString() : new Date().toLocaleString()
            };
            await d.ref.update(updateData);
            firestoreDocId = d.id;
            // Realtime Database용: 문서의 id 필드 값 사용
            trainingRoomId = docData.id || numId;
            console.log('[Training Room] 수정 완료 (training_rooms, id 필드 조회):', d.id, ', trainingRoomId:', trainingRoomId);
          } else {
            // ✅ training_schedules 조회 제거 (더 이상 사용하지 않음)
            if (typeof showToast === 'function') showToast('Training Room을 찾을 수 없습니다.', 'error');
            return;
          }
        } else {
          if (typeof showToast === 'function') showToast('Training Room을 찾을 수 없습니다.', 'error');
          return;
        }
      } else {
        const docData = doc.data();
        const updateData = {
          title: title,
          track_count: trackCount,
          user_id: managerId || null,
          userId: managerId || null,
          password: password || '',
          updated_at: new Date().toISOString ? new Date().toISOString() : new Date().toLocaleString()
        };
        await docRef.update(updateData);
        firestoreDocId = docIdForUpdate;
        // Realtime Database용: 문서의 id 필드 값 사용
        trainingRoomId = docData.id || parseInt(String(editId), 10);
        console.log('[Training Room] 수정 완료 (' + collectionName + '):', docIdForUpdate, ', trainingRoomId:', trainingRoomId);
      }
    } else {
      // 생성 모드
      const nextId = await getNextTrainingRoomId();
      const docData = {
        id: nextId,
        title: title,
        track_count: trackCount,
        user_id: managerId || null,
        userId: managerId || null,
        password: password || '',
        status: 'active',
        created_at: new Date().toISOString ? new Date().toISOString() : new Date().toLocaleString()
      };

      const colRef = firestoreDb.collection(TRAINING_ROOMS_COLLECTION);
      const docRef = await colRef.add(docData);
      firestoreDocId = docRef.id;
      // Realtime Database용: 생성한 문서의 id 필드 값 사용
      trainingRoomId = nextId;
      
      console.log('[Training Room] 생성 완료:', nextId, ', Firestore 문서 ID:', firestoreDocId);
    }

    // Realtime Database > sessions/{trainingRoomId}/devices 에 track 값 반영
    // trainingRoomId는 Firestore 문서의 id 필드 값 (숫자: 1, 2, 3, ...)
    if (trainingRoomId != null) {
      try {
        // Realtime Database: firebaseConfig.js에서 window.db = firebase.database() 로 초기화됨
        const realtimeDb = (typeof window !== 'undefined' && window.db && typeof window.db.ref === 'function')
          ? window.db
          : (typeof firebase !== 'undefined' && firebase.database)
            ? firebase.database()
            : null;
        
        if (realtimeDb && realtimeDb.ref) {
          const roomId = String(trainingRoomId); // 숫자를 문자열로 변환 (예: "1", "2", "3")
          const trackValue = Number(trackCount);
          await realtimeDb.ref(`sessions/${roomId}/devices`).set({ track: trackValue });
          console.log('[Training Room] Realtime Database 반영 완료: sessions/' + roomId + '/devices/track = ' + trackValue);
        } else {
          console.warn('[Training Room] Realtime Database 인스턴스를 찾을 수 없습니다. (window.db 또는 firebase.database 확인)');
        }
      } catch (realtimeError) {
        console.warn('[Training Room] Realtime Database 업데이트 실패:', realtimeError);
      }
    } else {
      console.warn('[Training Room] trainingRoomId가 없어 Realtime Database 업데이트를 건너뜁니다.');
    }

    closeTrainingRoomCreateModal();
    if (isEditMode) {
      if (typeof showToast === 'function') showToast('Training Room이 수정되었습니다.', 'success');
    } else {
      if (typeof showToast === 'function') showToast('Training Room이 생성되었습니다.', 'success');
    }
    loadTrainingRooms();
  } catch (e) {
    console.error('[Training Room] 저장 실패:', e);
    if (typeof showToast === 'function') showToast('저장 실패: ' + (e.message || String(e)), 'error');
  }
}

/**
 * Training Room 삭제
 */
async function deleteTrainingRoom(roomId) {
  if (!roomId) return;

  // 권한 체크: grade=1만 삭제 가능
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  
  if (userGrade !== '1') {
    if (typeof showToast === 'function') {
      showToast('Training Room 삭제 권한이 없습니다. 관리자(grade=1)만 삭제할 수 있습니다.', 'error');
    }
    return;
  }

  const confirmed = confirm('Training Room을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.');
  if (!confirmed) return;

  try {
    const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
    if (!db) {
      if (typeof showToast === 'function') showToast('Firestore를 사용할 수 없습니다.', 'error');
      return;
    }

    const roomIdStr = String(roomId);
    
    // training_rooms에서 먼저 찾아서 삭제
    let docRef = db.collection(TRAINING_ROOMS_COLLECTION).doc(roomIdStr);
    let doc = await docRef.get();
    
    if (doc.exists) {
      await docRef.delete();
      console.log('[Training Room] 삭제 완료 (training_rooms):', roomIdStr);
    } else {
      // ✅ training_schedules 조회 제거 (더 이상 사용하지 않음)
      if (typeof showToast === 'function') showToast('Training Room을 찾을 수 없습니다.', 'error');
      return;
    }

    if (typeof showToast === 'function') showToast('Training Room이 삭제되었습니다.', 'success');
    loadTrainingRooms();
  } catch (e) {
    console.error('[Training Room] 삭제 실패:', e);
    if (typeof showToast === 'function') showToast('삭제 실패: ' + (e.message || String(e)), 'error');
  }
}

/**
 * 트랙에 사용자 할당 (애니메이션 효과 포함)
 */
async function assignUserToTrackWithAnimation(trackNumber, currentUserId, roomIdParam, event) {
  // 버튼이 비활성화되어 있으면 실행하지 않음 (UI 레벨 권한 체크)
  const button = event?.target?.closest('button.player-assign-btn');
  if (button && button.disabled) {
    return;
  }
  
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (roomId) {
    roomId = String(roomId);
    
    // 권한 체크: 트랙에 할당된 사용자 정보 확인 (기존 사용자가 있는 경우만)
    if (currentUserId) {
      try {
        const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success && result.tracks && Array.isArray(result.tracks)) {
          const track = result.tracks.find(t => parseInt(t.trackNumber, 10) === trackNumber);
          
          if (track && track.userId) {
            // 현재 사용자 정보 확인
            let currentUser = null;
            let currentUserIdCheck = null;
            let userGrade = '2';
            let isAdmin = false;
            
            try {
              currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
              if (currentUser && currentUser.id != null) {
                currentUserIdCheck = String(currentUser.id);
              }
              userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
              isAdmin = userGrade === '1' || userGrade === 1;
              
              // grade=2 사용자는 본인이 할당한 트랙만 변경 가능
              if (!isAdmin && String(track.userId) !== currentUserIdCheck) {
                if (typeof showToast === 'function') {
                  showToast('본인이 할당한 트랙만 변경할 수 있습니다.', 'error');
                }
                return;
              }
            } catch (e) {
              console.error('[assignUserToTrackWithAnimation] 권한 체크 오류:', e);
            }
          }
        }
      } catch (error) {
        console.error('[assignUserToTrackWithAnimation] 트랙 정보 확인 오류:', error);
        // 오류가 발생해도 계속 진행 (권한 체크 실패 시에도 관리자는 진행 가능하도록)
      }
    }
  }
  
  const originalText = button ? button.querySelector('span')?.textContent : '';
  const originalDisabled = button ? button.disabled : false;
  
  // 버튼 애니메이션 효과
  if (button) {
    button.disabled = true;
    button.style.transition = 'all 0.2s ease';
    button.style.transform = 'scale(0.95)';
    button.style.opacity = '0.7';
    const span = button.querySelector('span');
    if (span) {
      span.textContent = '처리 중...';
    }
  }
  
  try {
    await assignUserToTrack(trackNumber, currentUserId, roomIdParam);
  } finally {
    // 버튼 상태 복원
    if (button) {
      setTimeout(() => {
        button.disabled = originalDisabled;
        button.style.transform = 'scale(1)';
        button.style.opacity = '1';
        const span = button.querySelector('span');
        if (span && originalText) {
          span.textContent = originalText;
        }
      }, 300);
    }
  }
}

/**
 * 트랙에 사용자 할당
 */
async function assignUserToTrack(trackNumber, currentUserId, roomIdParam) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    // 파라미터로 전달되지 않았으면 전역 변수 확인
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    // data attribute에서 가져오기 시도
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[assignUserToTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);

  // 사용자 목록 가져오기
  let users = [];
  try {
    if (typeof apiGetUsers === 'function') {
      const result = await apiGetUsers();
      if (result && result.success && result.items) {
        users = result.items;
      }
    } else if (Array.isArray(window.users)) {
      users = window.users;
    } else {
      // 사용자 목록이 없으면 로드 시도
      if (typeof loadUsers === 'function') {
        await loadUsers();
        users = Array.isArray(window.users) ? window.users : [];
      }
    }
  } catch (error) {
    console.error('[assignUserToTrack] 사용자 목록 로드 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 목록을 불러올 수 없습니다.', 'error');
    }
    return;
  }

  if (users.length === 0) {
    if (typeof showToast === 'function') {
      showToast('등록된 사용자가 없습니다.', 'error');
    }
    return;
  }

  // 사용자 선택 모달 생성
  const modalId = 'trackUserSelectModal';
  let modal = document.getElementById(modalId);
  
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal';
    modal.style.position = 'fixed';
    modal.style.zIndex = '10000';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    document.body.appendChild(modal);
  }

  // 사용자 grade 확인
  let userGrade = '2';
  let isAdmin = false;
  let isCoach = false;
  let loggedInUserId = null; // 함수 파라미터 currentUserId와 구분하기 위해 다른 이름 사용
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    loggedInUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isAdmin = userGrade === '1' || userGrade === 1;
    isCoach = userGrade === '3' || userGrade === 3;
  } catch (e) {
    console.error('[assignUserToTrack] 사용자 grade 확인 오류:', e);
  }
  
  // grade=2 사용자는 사용자와 심박계만 변경 가능
  const isGrade2 = userGrade === '2' || userGrade === 2;
  
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 사용 가능
  if (isGrade2 && loggedInUserId) {
    // grade=2 사용자는 본인 계정만 필터링
    users = users.filter(user => String(user.id) === loggedInUserId);
    console.log('[assignUserToTrack] 일반 사용자 제한: 본인 계정만 표시', {
      loggedInUserId: loggedInUserId,
      filteredCount: users.length
    });
  }

  // 모든 사용자 목록을 전역 변수에 저장 (검색 필터링용)
  window._allUsersForTrackSelection = users;

  // [일반 사용자 디바이스 입력 활성화] grade=2 사용자도 디바이스 정보 입력 가능
  const canModifyDevices = isAdmin || isCoach || isGrade2; // grade=1,3,2 모두 디바이스 입력 가능
  
  // Firebase에서 현재 트랙의 정보 가져오기
  let currentUserData = null;
  let currentDeviceData = null;
  
  if (typeof db !== 'undefined') {
    try {
      const sessionId = roomId;
      
      // users 정보 가져오기
      const usersRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      const usersSnapshot = await usersRef.once('value');
      currentUserData = usersSnapshot.val();
      
      // devices 정보 가져오기
      const devicesRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
      const devicesSnapshot = await devicesRef.once('value');
      currentDeviceData = devicesSnapshot.val();
      
      console.log('[assignUserToTrack] 현재 트랙 정보:', {
        trackNumber: trackNumber,
        userData: currentUserData,
        deviceData: currentDeviceData,
        userGrade: userGrade,
        canModifyDevices: canModifyDevices
      });
    } catch (error) {
      console.error('[assignUserToTrack] Firebase 정보 로드 오류:', error);
    }
  }

  modal.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">트랙${trackNumber} 훈련 신청</h2>
      
      <!-- 이름 검색 입력 필드 -->
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">이름 검색</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" 
                 id="trackUserSearchInput" 
                 placeholder="이름을 입력하세요" 
                 style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 onkeypress="if(event.key==='Enter') searchUsersForTrackSelection(${trackNumber}, '${roomId}')">
          <button onclick="searchUsersForTrackSelection(${trackNumber}, '${roomId}')" 
                  id="btnSearchUsersForTrack"
                  style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
            검색
          </button>
        </div>
      </div>
      
      <!-- 사용자 목록 컨테이너 -->
      <div id="trackUserListContainer" style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
        <!-- 검색 후에만 사용자 목록이 표시됩니다 -->
      </div>
      
      <!-- 선택된 사용자 표시 -->
      <div id="selectedUserForTrack" style="display: none; margin-bottom: 20px; padding: 12px; background: #e3f2fd; border-radius: 4px; border: 2px solid #2196F3;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: bold; margin-bottom: 4px;">선택된 사용자: <span id="selectedUserNameForTrack"></span></div>
            <div style="font-size: 0.9em; color: #666;">FTP: <span id="selectedUserFTPForTrack"></span>W | 체중: <span id="selectedUserWeightForTrack"></span>kg</div>
          </div>
          <span style="color: #2196F3; font-size: 24px;">✓</span>
        </div>
      </div>
      
      <!-- 디바이스 입력 필드 -->
      <div id="deviceInputSection" style="display: none; margin-bottom: 20px;">
        <h3 style="margin: 0 0 16px 0; font-size: 1.1em; color: #333;">디바이스 정보 입력</h3>
        
        ${canModifyDevices ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">스마트로라 ID</label>
          <input type="text" 
                 id="trackTrainerDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">파워메터 ID</label>
          <input type="text" 
                 id="trackPowerMeterDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        ` : `
        <div style="margin-bottom: 16px; display: none;">
          <input type="text" id="trackTrainerDeviceId" style="display: none;">
          <input type="text" id="trackPowerMeterDeviceId" style="display: none;">
        </div>
        `}
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">심박계 ID</label>
          <input type="text" 
                 id="trackHeartRateDeviceId" 
                 placeholder="가민에 표시되는 ID값 입력" 
                 style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '')">
        </div>
        
        ${canModifyDevices ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Gear</label>
            <select id="trackGearSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="11단">11단</option>
              <option value="12단">12단</option>
            </select>
          </div>
          
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Brake</label>
            <select id="trackBrakeSelect" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
              <option value="">선택하세요</option>
              <option value="디스크">디스크</option>
              <option value="림">림</option>
            </select>
          </div>
        </div>
        ` : `
        <div style="display: none;">
          <select id="trackGearSelect" style="display: none;"><option value=""></option></select>
          <select id="trackBrakeSelect" style="display: none;"><option value=""></option></select>
        </div>
        `}
      </div>
      
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        ${canModifyDevices ? `
        <button onclick="resetTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnResetTrackApplication"
                style="padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          초기화
        </button>
        ` : ''}
        <button onclick="saveTrackApplication(${trackNumber}, '${roomId}')" 
                id="btnSaveTrackApplication"
                style="display: none; padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          저장
        </button>
        <button onclick="closeTrackUserSelectModal()" 
                style="padding: 10px 20px; background: #ccc; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
          취소
        </button>
      </div>
    </div>
  `;
  
  // 전역 변수에 현재 트랙 정보 저장 (기존 정보가 있으면 사용)
  window._currentTrackApplication = {
    trackNumber: trackNumber,
    roomId: roomId,
    selectedUserId: currentUserData?.userId || null,
    selectedUserName: currentUserData?.userName || null,
    selectedUserFTP: currentUserData?.ftp || null,
    selectedUserWeight: currentUserData?.weight || null
  };
  
  // 모달이 생성된 후 현재 정보로 필드 채우기
  setTimeout(() => {
    // 사용자 정보가 있으면 선택된 사용자로 표시
    if (currentUserData && currentUserData.userId) {
      const selectedUserDiv = document.getElementById('selectedUserForTrack');
      const selectedUserNameSpan = document.getElementById('selectedUserNameForTrack');
      const selectedUserFTPSpan = document.getElementById('selectedUserFTPForTrack');
      const selectedUserWeightSpan = document.getElementById('selectedUserWeightForTrack');
      const deviceInputSection = document.getElementById('deviceInputSection');
      const saveBtn = document.getElementById('btnSaveTrackApplication');
      const searchInput = document.getElementById('trackUserSearchInput');
      
      if (selectedUserDiv && selectedUserNameSpan && selectedUserFTPSpan && selectedUserWeightSpan) {
        selectedUserNameSpan.textContent = currentUserData.userName || '';
        selectedUserFTPSpan.textContent = currentUserData.ftp || '-';
        selectedUserWeightSpan.textContent = currentUserData.weight || '-';
        selectedUserDiv.style.display = 'block';
      }
      
      if (deviceInputSection) {
        deviceInputSection.style.display = 'block';
      }
      
      if (saveBtn) {
        saveBtn.style.display = 'block';
      }
      
      // 현재 선택된 사용자 이름을 검색 입력 필드에 채우고 자동 검색 (선택된 사용자는 제외)
      if (searchInput && currentUserData.userName) {
        searchInput.value = currentUserData.userName;
        // 자동으로 검색 실행 (현재 선택된 사용자는 검색 결과에서 제외됨)
        setTimeout(() => {
          if (typeof searchUsersForTrackSelection === 'function') {
            searchUsersForTrackSelection(trackNumber, roomId);
          }
        }, 200);
      }
    }
    
    // 디바이스 정보가 있으면 입력 필드에 값 채우기
    if (currentDeviceData) {
      console.log('[assignUserToTrack] 디바이스 데이터:', currentDeviceData);
      
      const trainerDeviceIdInput = document.getElementById('trackTrainerDeviceId');
      const powerMeterDeviceIdInput = document.getElementById('trackPowerMeterDeviceId');
      const heartRateDeviceIdInput = document.getElementById('trackHeartRateDeviceId');
      const gearSelect = document.getElementById('trackGearSelect');
      const brakeSelect = document.getElementById('trackBrakeSelect');
      
      // 스마트로라 ID (새 필드명 우선, 기존 필드명 호환)
      if (trainerDeviceIdInput) {
        trainerDeviceIdInput.value = currentDeviceData.smartTrainerId || 
                                     currentDeviceData['smartTrainerId'] || 
                                     currentDeviceData['Smart Trainer id'] || 
                                     currentDeviceData.trainerId || 
                                     '';
      }
      
      // 파워메터 ID (새 필드명 우선, 기존 필드명 호환)
      if (powerMeterDeviceIdInput) {
        powerMeterDeviceIdInput.value = currentDeviceData.powerMeterId || 
                                        currentDeviceData['powerMeterId'] ||
                                        currentDeviceData['Power Meter id'] || 
                                        currentDeviceData['Power Meter Id'] ||
                                        currentDeviceData.powerMeter || 
                                        '';
      }
      
      // 심박계 ID (새 필드명 우선, 기존 필드명 호환)
      if (heartRateDeviceIdInput) {
        heartRateDeviceIdInput.value = currentDeviceData.heartRateId || 
                                       currentDeviceData['heartRateId'] ||
                                       currentDeviceData['Heart Rate id'] || 
                                       currentDeviceData['Heart Rate Id'] ||
                                       currentDeviceData.heartRate || 
                                       '';
      }
      
      // Gear (새 필드명 우선, 기존 필드명 호환)
      if (gearSelect) {
        gearSelect.value = currentDeviceData.gear || 
                           currentDeviceData['gear'] ||
                           currentDeviceData['Gear'] || 
                           currentDeviceData.Gear || 
                           '';
      }
      
      // Brake (새 필드명 우선, 기존 필드명 호환)
      if (brakeSelect) {
        brakeSelect.value = currentDeviceData.brake || 
                           currentDeviceData['brake'] ||
                           currentDeviceData['Brake'] || 
                           currentDeviceData.Brake || 
                           '';
      }
      
      console.log('[assignUserToTrack] 디바이스 필드 값 설정 완료:', {
        powerMeter: powerMeterDeviceIdInput?.value,
        heartRate: heartRateDeviceIdInput?.value,
        gear: gearSelect?.value,
        brake: brakeSelect?.value
      });
    } else {
      console.log('[assignUserToTrack] 디바이스 데이터가 없습니다.');
    }
  }, 100);

  modal.style.display = 'flex';
  
  // 모달 외부 클릭 시 닫기
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeTrackUserSelectModal();
    }
  };
  
  // 검색 입력 필드에 포커스
  setTimeout(() => {
    const searchInput = document.getElementById('trackUserSearchInput');
    if (searchInput) {
      searchInput.focus();
    }
  }, 100);
}

/**
 * 트랙 사용자 선택용 사용자 목록 렌더링
 */
function renderUserListForTrackSelection(users, trackNumber, roomId, currentUserId) {
  if (!users || users.length === 0) {
    return '<div style="padding: 20px; text-align: center; color: #999;">등록된 사용자가 없습니다.</div>';
  }
  
  return users.map(user => {
    const isSelected = window._currentTrackApplication && window._currentTrackApplication.selectedUserId === String(user.id);
    return `
      <div class="user-select-item" 
           data-user-id="${user.id}"
           style="padding: 12px; margin: 8px 0; border: 2px solid ${isSelected ? '#2196F3' : '#ddd'}; border-radius: 4px; cursor: pointer; background: ${isSelected ? '#e3f2fd' : '#fff'}; transition: all 0.2s ease; position: relative;"
           onmouseover="if (!${isSelected}) { this.style.background='#f5f5f5'; this.style.transform='translateX(4px)'; }"
           onmouseout="if (!${isSelected}) { this.style.background='#fff'; this.style.transform='translateX(0)'; }"
           onclick="selectUserForTrackSelection(${trackNumber}, ${user.id}, '${escapeHtml(user.name || '')}', ${user.ftp || 0}, ${user.weight || 0}, '${roomId}', event)">
        <div style="font-weight: bold; margin-bottom: 4px;">${escapeHtml(user.name || '이름 없음')}</div>
        <div style="font-size: 0.9em; color: #666;">FTP: ${user.ftp || '-'}W | 체중: ${user.weight || '-'}kg</div>
        ${isSelected ? '<div style="position: absolute; top: 8px; right: 8px; color: #2196F3; font-size: 20px; font-weight: bold;">✓</div>' : ''}
      </div>
    `;
  }).join('');
}

/**
 * 트랙 사용자 검색 (검색 버튼 클릭 시에만 실행)
 */
async function searchUsersForTrackSelection(trackNumber, roomId) {
  const searchInput = document.getElementById('trackUserSearchInput');
  const listContainer = document.getElementById('trackUserListContainer');
  const searchBtn = document.getElementById('btnSearchUsersForTrack');
  
  if (!searchInput || !listContainer) return;
  
  const searchTerm = searchInput.value.trim();
  let allUsers = window._allUsersForTrackSelection || [];
  
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 검색 가능
  let currentUserId = null;
  let userGrade = '2';
  let isGrade2 = false;
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    currentUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isGrade2 = userGrade === '2' || userGrade === 2;
  } catch (e) {
    console.error('[searchUsersForTrackSelection] 사용자 정보 확인 오류:', e);
  }

  if (isGrade2 && currentUserId) {
    // grade=2 사용자는 본인 계정만 필터링
    allUsers = allUsers.filter(user => String(user.id) === currentUserId);
    console.log('[searchUsersForTrackSelection] 일반 사용자 제한: 본인 계정만 검색', {
      currentUserId: currentUserId,
      filteredCount: allUsers.length
    });
  }
  
  // 검색어가 없으면 목록을 비워둠
  if (!searchTerm) {
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색어를 입력하세요.</div>';
    return;
  }
  
  // 검색 버튼 비활성화 및 로딩 표시
  if (searchBtn) {
    searchBtn.disabled = true;
    const originalText = searchBtn.textContent;
    searchBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> 검색 중...';
    
    // CSS 애니메이션 추가 (이미 있으면 무시)
    if (!document.getElementById('searchLoadingStyle')) {
      const style = document.createElement('style');
      style.id = 'searchLoadingStyle';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // 결과 영역에 로딩 표시
    listContainer.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #10b981;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid rgba(16, 185, 129, 0.2); border-top-color: #10b981; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
        <p style="margin: 0; font-size: 14px;">사용자 검색 중...</p>
      </div>
    `;
  }
  
  try {
    // 검색어로 필터링
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || '').toLowerCase();
      return name.includes(searchTerm.toLowerCase());
    });
    
    // 현재 선택된 사용자 ID 가져오기
    const currentSelectedUserId = window._currentTrackApplication?.selectedUserId ? String(window._currentTrackApplication.selectedUserId) : null;
    
    // 현재 선택된 사용자를 제외한 목록 필터링
    const usersToShow = currentSelectedUserId 
      ? filteredUsers.filter(user => String(user.id) !== currentSelectedUserId)
      : filteredUsers;
    
    // 필터링된 목록 렌더링
    if (usersToShow.length === 0) {
      listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색 결과가 없습니다.</div>';
    } else {
      listContainer.innerHTML = renderUserListForTrackSelection(usersToShow, trackNumber, roomId, null);
    }
  } catch (error) {
    console.error('[searchUsersForTrackSelection] 검색 오류:', error);
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545;">검색 중 오류가 발생했습니다.</div>';
  } finally {
    // 검색 버튼 복원
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '검색';
    }
  }
}

/**
 * 트랙 사용자 선택 (체크 표시만, 자동 저장 안 함)
 */
function selectUserForTrackSelection(trackNumber, userId, userName, userFTP, userWeight, roomId, event) {
  // [일반 사용자 제한] grade=2 사용자는 본인 계정만 선택 가능
  let currentUserId = null;
  let userGrade = '2';
  let isGrade2 = false;
  
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    currentUserId = currentUser?.id ? String(currentUser.id) : null;
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
    isGrade2 = userGrade === '2' || userGrade === 2;
  } catch (e) {
    console.error('[selectUserForTrackSelection] 사용자 정보 확인 오류:', e);
  }

  if (isGrade2 && currentUserId) {
    // grade=2 사용자는 본인 계정만 선택 가능
    if (String(userId) !== currentUserId) {
      if (typeof showToast === 'function') {
        showToast('본인 계정만 선택할 수 있습니다.', 'error');
      }
      console.log('[selectUserForTrackSelection] 일반 사용자 제한: 본인 계정만 선택 가능', {
        selectedUserId: userId,
        currentUserId: currentUserId
      });
      return;
    }
  }

  // 선택된 사용자 정보 저장
  window._currentTrackApplication = {
    trackNumber: trackNumber,
    roomId: roomId,
    selectedUserId: String(userId),
    selectedUserName: userName,
    selectedUserFTP: userFTP,
    selectedUserWeight: userWeight
  };
  
  // 선택된 사용자 표시 영역 업데이트
  const selectedUserDiv = document.getElementById('selectedUserForTrack');
  const selectedUserNameSpan = document.getElementById('selectedUserNameForTrack');
  const selectedUserFTPSpan = document.getElementById('selectedUserFTPForTrack');
  const selectedUserWeightSpan = document.getElementById('selectedUserWeightForTrack');
  const deviceInputSection = document.getElementById('deviceInputSection');
  const saveBtn = document.getElementById('btnSaveTrackApplication');
  
  if (selectedUserDiv && selectedUserNameSpan && selectedUserFTPSpan && selectedUserWeightSpan) {
    selectedUserNameSpan.textContent = userName;
    selectedUserFTPSpan.textContent = userFTP || '-';
    selectedUserWeightSpan.textContent = userWeight || '-';
    selectedUserDiv.style.display = 'block';
  }
  
  if (deviceInputSection) {
    deviceInputSection.style.display = 'block';
  }
  
  if (saveBtn) {
    saveBtn.style.display = 'block';
  }
  
  // 사용자 목록 다시 렌더링 (체크 표시 업데이트 및 현재 선택된 사용자 제외)
  const searchInput = document.getElementById('trackUserSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim() : '';
  const allUsers = window._allUsersForTrackSelection || [];
  
  if (searchTerm) {
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || '').toLowerCase();
      return name.includes(searchTerm.toLowerCase());
    });
    
    // 현재 선택된 사용자를 제외
    const currentSelectedUserId = String(userId);
    const usersToShow = filteredUsers.filter(user => String(user.id) !== currentSelectedUserId);
    
    const listContainer = document.getElementById('trackUserListContainer');
    if (listContainer) {
      if (usersToShow.length === 0) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">검색 결과가 없습니다.</div>';
      } else {
        listContainer.innerHTML = renderUserListForTrackSelection(usersToShow, trackNumber, roomId, null);
      }
    }
  }
}

/**
 * 트랙에서 사용자 제거 (애니메이션 효과 포함)
 */
async function removeUserFromTrackWithAnimation(trackNumber, roomIdParam, event) {
  // roomId를 파라미터, 전역 변수, 또는 data attribute에서 가져오기
  let roomId = roomIdParam;
  
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    const playerListContent = document.getElementById('playerListContent');
    if (playerListContent) {
      roomId = playerListContent.getAttribute('data-room-id');
    }
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    console.error('[removeUserFromTrack] roomId를 찾을 수 없습니다.');
    return;
  }
  
  roomId = String(roomId);
  
  // 권한 체크: 트랙에 할당된 사용자 정보 확인
  try {
    const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success && result.tracks && Array.isArray(result.tracks)) {
      const track = result.tracks.find(t => parseInt(t.trackNumber, 10) === trackNumber);
      
      if (track && track.userId) {
        // 현재 사용자 정보 확인
        let currentUser = null;
        let currentUserIdCheck = null;
        let userGrade = '2';
        let isAdmin = false;
        
        try {
          currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
          if (currentUser && currentUser.id != null) {
            currentUserIdCheck = String(currentUser.id);
          }
          userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
          isAdmin = userGrade === '1' || userGrade === 1;
          
          // grade=2 사용자는 본인이 할당한 트랙만 제거 가능
          if (!isAdmin && String(track.userId) !== currentUserIdCheck) {
            if (typeof showToast === 'function') {
              showToast('본인이 할당한 트랙만 제거할 수 있습니다.', 'error');
            }
            return;
          }
        } catch (e) {
          console.error('[removeUserFromTrackWithAnimation] 권한 체크 오류:', e);
        }
      }
    }
  } catch (error) {
    console.error('[removeUserFromTrackWithAnimation] 트랙 정보 확인 오류:', error);
    // 오류가 발생해도 계속 진행 (권한 체크 실패 시에도 관리자는 진행 가능하도록)
  }

  if (!confirm(`트랙${trackNumber}에서 퇴실하시겠습니까?`)) {
    return;
  }
  
  const button = event?.target?.closest('button.player-remove-btn');
  const originalText = button ? button.querySelector('span')?.textContent : '';
  const originalDisabled = button ? button.disabled : false;
  
  // 버튼 즉시 클릭 애니메이션 효과
  if (button) {
    // 즉시 피드백: 클릭 애니메이션 클래스 추가
    button.classList.add('clicking');
    setTimeout(() => {
      button.classList.remove('clicking');
    }, 300);
    
    // 로딩 상태 표시
    button.classList.add('loading');
    button.disabled = true;
    
    const span = button.querySelector('span');
    if (span) {
      span.textContent = '처리 중...';
    }
  }
  
  try {
    // removeUserFromTrack 함수 호출 (roomId만 전달)
    await removeUserFromTrackInternal(trackNumber, roomId);
  } finally {
    // 버튼 상태 복원
    if (button) {
      setTimeout(() => {
        button.classList.remove('loading', 'clicking');
        button.disabled = originalDisabled;
        button.style.transform = '';
        button.style.opacity = '';
        const span = button.querySelector('span');
        if (span && originalText) {
          span.textContent = originalText;
        }
      }, 300);
    }
  }
}

/**
 * 트랙에서 사용자 제거 (내부 함수 - roomId만 받음)
 * grade=2: 사용자와 심박계만 삭제
 * grade=1,3: 모든 데이터 삭제
 */
async function removeUserFromTrackInternal(trackNumber, roomId) {
  roomId = String(roomId);
  
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[removeUserFromTrack] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;

  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      if (isAdmin) {
        // grade=1,3: 모든 데이터 삭제
        await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
        await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).remove();
        console.log(`[removeUserFromTrack] 트랙 ${trackNumber} 모든 데이터 삭제 완료`);
      } else {
        // grade=2: 사용자와 심박계만 삭제 (스마트로라, 파워메터, gear, brake는 유지)
        await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
        
        // devices에서 심박계만 삭제
        const deviceRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
        const deviceSnapshot = await deviceRef.once('value');
        const deviceData = deviceSnapshot.val();
        
        if (deviceData) {
          await deviceRef.update({
            heartRateId: null
          });
          console.log(`[removeUserFromTrack] 트랙 ${trackNumber} 사용자 및 심박계만 삭제 완료`);
        }
      }
      
      if (typeof showToast === 'function') {
        showToast('사용자가 제거되었습니다.', 'success');
      }
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[removeUserFromTrack] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 제거 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 트랙 신청 저장 (Firebase에 users와 devices 정보 저장)
 */
async function saveTrackApplication(trackNumber, roomIdParam) {
  const appData = window._currentTrackApplication;
  
  if (!appData || !appData.selectedUserId) {
    if (typeof showToast === 'function') {
      showToast('사용자를 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  // roomId 확인
  let roomId = roomIdParam || appData.roomId;
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  // 디바이스 정보 읽기
  const trainerDeviceId = document.getElementById('trackTrainerDeviceId')?.value?.trim() || '';
  const powerMeterDeviceId = document.getElementById('trackPowerMeterDeviceId')?.value?.trim() || '';
  const heartRateDeviceId = document.getElementById('trackHeartRateDeviceId')?.value?.trim() || '';
  const gear = document.getElementById('trackGearSelect')?.value || '';
  const brake = document.getElementById('trackBrakeSelect')?.value || '';
  
  // 저장 버튼 비활성화 및 로딩 표시
  const saveBtn = document.getElementById('btnSaveTrackApplication');
  const originalText = saveBtn ? saveBtn.textContent : '';
  
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> 저장 중...';
    saveBtn.style.opacity = '0.7';
    saveBtn.style.cursor = 'not-allowed';
  }
  
  try {
    // Firebase에 저장
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // 1. users 정보 저장
      const userData = {
        userId: appData.selectedUserId,
        userName: appData.selectedUserName,
        weight: appData.selectedUserWeight || null,
        ftp: appData.selectedUserFTP || null
      };
      
      const userRef = db.ref(`sessions/${sessionId}/users/${trackNumber}`);
      await userRef.set(userData);
      console.log('[saveTrackApplication] 사용자 정보 저장 완료:', userData);
      
      // 2. devices 정보 저장
      const deviceData = {
        smartTrainerId: trainerDeviceId || null,
        powerMeterId: powerMeterDeviceId || null,
        heartRateId: heartRateDeviceId || null,
        gear: gear || null,
        brake: brake || null
      };
      
      const deviceRef = db.ref(`sessions/${sessionId}/devices/${trackNumber}`);
      await deviceRef.set(deviceData);
      console.log('[saveTrackApplication] 디바이스 정보 저장 완료:', deviceData);
      
      if (typeof showToast === 'function') {
        showToast(`트랙${trackNumber} 신청이 완료되었습니다.`, 'success');
      }
      
      // 모달 닫기
      closeTrackUserSelectModal();
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[saveTrackApplication] 저장 오류:', error);
    if (typeof showToast === 'function') {
      showToast('저장 중 오류가 발생했습니다: ' + error.message, 'error');
    }
  } finally {
    // 저장 버튼 복원
    if (saveBtn) {
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
      }, 500);
    }
  }
}

/**
 * 사용자 선택 모달 닫기
 */
function closeTrackUserSelectModal() {
  const modal = document.getElementById('trackUserSelectModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Firebase에 저장된 트랙별 사용자 정보 확인 (디버깅용)
 * 브라우저 콘솔에서 checkFirebaseTrackUsers(roomId) 호출 가능
 */
async function checkFirebaseTrackUsers(roomId) {
  if (!roomId) {
    // roomId가 없으면 현재 선택된 room id 사용
    roomId = currentSelectedTrainingRoom?.id 
      || window.currentTrainingRoomId 
      || localStorage.getItem('currentTrainingRoomId')
      || window.SESSION_ID;
  }
  
  if (!roomId) {
    console.error('[Firebase 확인] room id를 찾을 수 없습니다.');
    console.log('사용법: checkFirebaseTrackUsers("room_id_값")');
    return;
  }
  
  console.log(`[Firebase 확인] Room ID: ${roomId}`);
  console.log(`[Firebase 확인] Firebase URL: https://stelvio-ai-default-rtdb.firebaseio.com/sessions/${roomId}/users.json`);
  
  try {
    const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${roomId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success) {
      console.log('[Firebase 확인] ✅ 데이터 조회 성공');
      console.log('[Firebase 확인] 트랙별 사용자 정보:', result.tracks);
      
      // 상세 정보 출력
      const tracksWithUsers = result.tracks.filter(t => t.userId && t.userName);
      if (tracksWithUsers.length > 0) {
        console.log('[Firebase 확인] 할당된 트랙:');
        tracksWithUsers.forEach(track => {
          console.log(`  트랙${track.trackNumber}: ${track.userName} (ID: ${track.userId})`);
        });
      } else {
        console.log('[Firebase 확인] ⚠️ 할당된 사용자가 없습니다.');
      }
      
      return result;
    } else {
      console.error('[Firebase 확인] ❌ 데이터 조회 실패:', result.error);
      return result;
    }
  } catch (error) {
    console.error('[Firebase 확인] ❌ 오류 발생:', error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Firebase에 직접 접근하여 원시 데이터 확인 (디버깅용)
 * 브라우저 콘솔에서 checkFirebaseRawData(roomId) 호출 가능
 */
async function checkFirebaseRawData(roomId) {
  if (!roomId) {
    roomId = currentSelectedTrainingRoom?.id 
      || window.currentTrainingRoomId 
      || localStorage.getItem('currentTrainingRoomId')
      || window.SESSION_ID;
  }
  
  if (!roomId) {
    console.error('[Firebase 원시 데이터 확인] room id를 찾을 수 없습니다.');
    return;
  }
  
  const firebaseUrl = `https://stelvio-ai-default-rtdb.firebaseio.com/sessions/${roomId}/users.json`;
  console.log(`[Firebase 원시 데이터 확인] URL: ${firebaseUrl}`);
  
  try {
    const response = await fetch(firebaseUrl);
    const data = await response.json();
    
    console.log('[Firebase 원시 데이터 확인] ✅ 원시 데이터:', data);
    
    if (data) {
      console.log('[Firebase 원시 데이터 확인] 트랙별 상세 정보:');
      Object.keys(data).forEach(trackNumber => {
        const trackData = data[trackNumber];
        console.log(`  트랙 ${trackNumber}:`, trackData);
      });
    } else {
      console.log('[Firebase 원시 데이터 확인] ⚠️ 데이터가 없습니다.');
    }
    
    return data;
  } catch (error) {
    console.error('[Firebase 원시 데이터 확인] ❌ 오류 발생:', error);
    return null;
  }
}

/**
 * 일괄 퇴실 (모든 트랙의 사용자 및 디바이스 정보 삭제, grade=1,3만 사용 가능)
 */
async function clearAllTracksData() {
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[clearAllTracksData] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;
  
  if (!isAdmin) {
    if (typeof showToast === 'function') {
      showToast('관리자만 일괄 퇴실을 수행할 수 있습니다.', 'error');
    }
    return;
  }
  
  if (!confirm('모든 트랙의 사용자 및 디바이스 정보를 삭제하시겠습니까?\n(사용자 정보, 스마트로라, 파워메터, 기어, 브레이크, 심박계가 모두 삭제됩니다)')) {
    return;
  }
  
  // roomId 가져오기
  let roomId = null;
  if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
    roomId = currentSelectedTrainingRoom.id;
  } else if (window.currentTrainingRoomId) {
    roomId = window.currentTrainingRoomId;
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // Step 1: Fetch the current track count from devices/track (default to 10 if null)
      let maxTracks = 10;
      try {
        const trackSnapshot = await db.ref(`sessions/${sessionId}/devices/track`).once('value');
        const trackValue = trackSnapshot.val();
        if (trackValue !== null && trackValue !== undefined) {
          maxTracks = Number(trackValue) || 10;
        }
        console.log(`[clearAllTracksData] Step 1 - 트랙 개수 확인: ${maxTracks}`);
      } catch (e) {
        console.warn('[clearAllTracksData] Step 1 - track 값 읽기 실패, 기본값 10 사용:', e);
      }
      
      // Step 2: Remove the entire users node using .remove()
      try {
        await db.ref(`sessions/${sessionId}/users`).remove();
        console.log(`[clearAllTracksData] Step 2 - users 노드 전체 삭제 완료`);
      } catch (e) {
        console.error('[clearAllTracksData] Step 2 - users 노드 삭제 실패:', e);
        throw e;
      }
      
      // Step 3: Remove all track-specific device data (트랙 1부터 maxTracks까지)
      // 트랙별 디바이스 정보를 명시적으로 삭제하여 트랙 1번이 남는 문제 해결
      try {
        const deviceRemovePromises = [];
        for (let trackNum = 1; trackNum <= maxTracks; trackNum++) {
          deviceRemovePromises.push(
            db.ref(`sessions/${sessionId}/devices/${trackNum}`).remove()
          );
        }
        await Promise.all(deviceRemovePromises);
        console.log(`[clearAllTracksData] Step 3 - 트랙 1~${maxTracks} 디바이스 정보 삭제 완료`);
      } catch (e) {
        console.error('[clearAllTracksData] Step 3 - 트랙별 디바이스 정보 삭제 실패:', e);
        throw e;
      }
      
      // Step 4: Ensure track count is preserved
      try {
        await db.ref(`sessions/${sessionId}/devices/track`).set(maxTracks);
        console.log(`[clearAllTracksData] Step 4 - track 개수 보존 완료 (track: ${maxTracks})`);
      } catch (e) {
        console.error('[clearAllTracksData] Step 4 - track 개수 보존 실패:', e);
        throw e;
      }
      
      if (typeof showToast === 'function') {
        showToast(`모든 트랙(${maxTracks}개)의 사용자 및 디바이스 정보가 삭제되었습니다.`, 'success');
      }
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[clearAllTracksData] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('일괄 퇴실 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 트랙 초기화 (해당 트랙의 모든 데이터 삭제, grade=1,3만 사용 가능)
 */
async function resetTrackApplication(trackNumber, roomIdParam) {
  // grade 확인
  let userGrade = '2';
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
  } catch (e) {
    console.error('[resetTrackApplication] grade 확인 오류:', e);
  }
  
  const isAdmin = userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3;
  
  if (!isAdmin) {
    if (typeof showToast === 'function') {
      showToast('관리자만 초기화를 수행할 수 있습니다.', 'error');
    }
    return;
  }
  
  if (!confirm(`트랙${trackNumber}의 모든 사용자 및 디바이스 정보를 삭제하시겠습니까?`)) {
    return;
  }
  
  // roomId 확인
  let roomId = roomIdParam;
  if (!roomId) {
    roomId = (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) 
      ? currentSelectedTrainingRoom.id 
      : (window.currentTrainingRoomId || null);
  }
  
  if (!roomId) {
    if (typeof showToast === 'function') {
      showToast('Training Room을 먼저 선택해주세요.', 'error');
    }
    return;
  }
  
  roomId = String(roomId);
  
  try {
    if (typeof db !== 'undefined') {
      const sessionId = roomId;
      
      // 사용자 및 디바이스 정보 모두 삭제
      await db.ref(`sessions/${sessionId}/users/${trackNumber}`).remove();
      await db.ref(`sessions/${sessionId}/devices/${trackNumber}`).remove();
      
      console.log(`[resetTrackApplication] 트랙 ${trackNumber} 초기화 완료`);
      
      if (typeof showToast === 'function') {
        showToast(`트랙${trackNumber}이(가) 초기화되었습니다.`, 'success');
      }
      
      // 모달 닫기
      closeTrackUserSelectModal();
      
      // Player List 다시 로드
      await renderPlayerList();
    } else {
      throw new Error('Firebase가 초기화되지 않았습니다.');
    }
  } catch (error) {
    console.error('[resetTrackApplication] 오류:', error);
    if (typeof showToast === 'function') {
      showToast('초기화 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * Player List 새로고침
 */
async function refreshPlayerList() {
  console.log('[Player List] 새로고침 시작');
  
  // 새로고침 버튼 비활성화 및 로딩 표시
  const refreshBtn = document.getElementById('btnRefreshPlayerList');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    const originalContent = refreshBtn.innerHTML;
    refreshBtn.innerHTML = '<img src="assets/img/reload.png" alt="새로고침" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle; animation: spin 1s linear infinite;" /> 새로고침 중...';
    
    try {
      // Player List 다시 렌더링
      await renderPlayerList();
      
      if (typeof showToast === 'function') {
        showToast('리스트가 새로고침되었습니다.', 'success');
      }
    } catch (error) {
      console.error('[Player List] 새로고침 오류:', error);
      if (typeof showToast === 'function') {
        showToast('리스트 새로고침 중 오류가 발생했습니다.', 'error');
      }
    } finally {
      // 버튼 복원
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = originalContent;
      }
    }
  } else {
    // 버튼이 없어도 새로고침은 실행
    await renderPlayerList();
  }
}

// 전역 함수 노출
if (typeof window !== 'undefined') {
  window.loadTrainingRooms = loadTrainingRooms;
  window.openTrainingRoomCreateModal = openTrainingRoomCreateModal;
  window.openTrainingRoomEditModal = openTrainingRoomEditModal;
  window.closeTrainingRoomCreateModal = closeTrainingRoomCreateModal;
  window.submitTrainingRoomCreate = submitTrainingRoomCreate;
  window.deleteTrainingRoom = deleteTrainingRoom;
  window.selectTrainingRoom = selectTrainingRoom;
  window.openPlayerList = openPlayerList;
  window.openCoachMode = openCoachMode;
  window.initializeTrainingRoomScreen = initializeTrainingRoomScreen;
  window.showTrainingRoomPasswordModal = showTrainingRoomPasswordModal;
  // 모달 관련 함수
  window.showTrainingRoomModal = showTrainingRoomModal;
  window.closeTrainingRoomModal = closeTrainingRoomModal;
window.getDeviceConnectionMode = getDeviceConnectionMode;
window.toggleDeviceConnectionMode = toggleDeviceConnectionMode;
  window.selectTrainingRoomForModal = selectTrainingRoomForModal;
  window.openPlayerListFromModal = openPlayerListFromModal;
  window.openCoachModeFromModal = openCoachModeFromModal;
  // 트랙 사용자 할당 관련 함수
  window.assignUserToTrack = assignUserToTrack;
  window.assignUserToTrackWithAnimation = assignUserToTrackWithAnimation;
  window.removeUserFromTrackWithAnimation = removeUserFromTrackWithAnimation;
  window.searchUsersForTrackSelection = searchUsersForTrackSelection;
  window.selectUserForTrackSelection = selectUserForTrackSelection;
  window.saveTrackApplication = saveTrackApplication;
  window.closeTrackUserSelectModal = closeTrackUserSelectModal;
  // Player List 새로고침 함수
  window.refreshPlayerList = refreshPlayerList;
  // 일괄 퇴실 함수
  window.clearAllTracksData = clearAllTracksData;
  // 트랙 초기화 함수
  window.resetTrackApplication = resetTrackApplication;
  // 디버깅 함수
  window.checkFirebaseTrackUsers = checkFirebaseTrackUsers;
  window.checkFirebaseRawData = checkFirebaseRawData;
  // 입장 버튼 클릭 핸들러
  window.handlePlayerEnterClick = handlePlayerEnterClick;
}

/**
 * Bluetooth Player List 화면 열기 (트랙 수 유동적)
 */
async function openBluetoothPlayerList() {
  if (!currentSelectedTrainingRoom) {
    showToast('Training Room을 먼저 선택해주세요.', 'error');
    return;
  }

  // Bluetooth Join Session 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('bluetoothPlayerListScreen');
  }

  // Bluetooth Player List 렌더링
  await renderBluetoothPlayerList();
}

/**
 * 타임아웃이 있는 Promise 래퍼
 */
/**
 * 모바일 환경 감지
 */
function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  
  // User Agent 기반 감지
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isMobileUA = mobileRegex.test(userAgent);
  
  // 화면 크기 기반 감지 (추가 확인)
  const isMobileScreen = window.innerWidth <= 768;
  
  // 터치 지원 여부 확인
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  return isMobileUA || (isMobileScreen && isTouchDevice);
}

/**
 * 네트워크 상태 감지 (Connection API 사용)
 */
function getNetworkInfo() {
  if (typeof navigator !== 'undefined' && navigator.connection) {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      effectiveType: conn.effectiveType || 'unknown', // 'slow-2g', '2g', '3g', '4g'
      downlink: conn.downlink || 0, // Mbps
      rtt: conn.rtt || 0, // ms
      saveData: conn.saveData || false
    };
  }
  return null;
}

/**
 * 타임아웃이 있는 Promise 래퍼 (모바일 최적화)
 */
function withTimeout(promise, timeoutMs, errorMessage = '요청 시간 초과') {
  // 모바일 환경 감지
  const isMobile = isMobileDevice();
  const networkInfo = getNetworkInfo();
  
  // 모바일이거나 느린 네트워크인 경우 타임아웃 증가
  let adjustedTimeout = timeoutMs;
  if (isMobile) {
    adjustedTimeout = timeoutMs * 2; // 모바일은 2배
    console.log('[withTimeout] 모바일 환경 감지, 타임아웃 증가:', timeoutMs, '→', adjustedTimeout, 'ms');
  }
  
  // 네트워크 상태에 따른 추가 조정
  if (networkInfo) {
    if (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g') {
      adjustedTimeout = adjustedTimeout * 1.5; // 느린 네트워크는 1.5배 추가 증가
      console.log('[withTimeout] 느린 네트워크 감지:', networkInfo.effectiveType, ', 타임아웃:', adjustedTimeout, 'ms');
    } else if (networkInfo.rtt > 500) {
      adjustedTimeout = adjustedTimeout * 1.3; // 높은 지연시간은 1.3배 증가
      console.log('[withTimeout] 높은 지연시간 감지:', networkInfo.rtt, 'ms, 타임아웃:', adjustedTimeout, 'ms');
    }
  }
  
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), adjustedTimeout)
    )
  ]);
}

/**
 * 재시도 로직이 있는 함수 실행 (모바일 최적화)
 */
async function withRetry(fn, maxRetries = 3, delayMs = 1000) {
  const isMobile = isMobileDevice();
  const networkInfo = getNetworkInfo();
  
  // 모바일이거나 느린 네트워크인 경우 재시도 횟수 증가
  let adjustedRetries = maxRetries;
  let adjustedDelay = delayMs;
  
  if (isMobile) {
    adjustedRetries = maxRetries + 1; // 모바일은 재시도 1회 추가
    adjustedDelay = delayMs * 0.8; // 초기 지연 시간 약간 감소 (빠른 재시도)
    console.log('[withRetry] 모바일 환경 감지, 재시도 횟수 증가:', maxRetries, '→', adjustedRetries);
  }
  
  // 느린 네트워크인 경우 재시도 간격 조정
  if (networkInfo && (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g')) {
    adjustedDelay = delayMs * 1.2; // 느린 네트워크는 재시도 간격 증가
    console.log('[withRetry] 느린 네트워크 감지, 재시도 간격 조정:', delayMs, '→', adjustedDelay, 'ms');
  }
  
  let lastError;
  for (let i = 0; i < adjustedRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < adjustedRetries - 1) {
        const currentDelay = adjustedDelay * Math.pow(1.5, i); // 지수 백오프
        console.warn(`[재시도 ${i + 1}/${adjustedRetries}] 실패, ${Math.round(currentDelay)}ms 후 재시도...`, error.message);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      }
    }
  }
  throw lastError;
}

/**
 * 기본 트랙 배열 생성 (안전장치)
 */
function createDefaultTracks(count = 10) {
  const tracks = [];
  for (let i = 1; i <= count; i++) {
    tracks.push({
      trackNumber: i,
      userId: null,
      userName: null,
      weight: null,
      ftp: null,
      gear: null,
      brake: null,
      smartTrainerId: null,
      powerMeterId: null,
      heartRateId: null
    });
  }
  return tracks;
}

/**
 * Bluetooth Player List 렌더링 (트랙 수 고정: 항상 10개)
 * 개선: 타임아웃, 재시도, 에러 핸들링 강화, 모바일 최적화, 점진적 로딩
 */
async function renderBluetoothPlayerList() {
  const playerListContent = document.getElementById('bluetoothPlayerListContent');
  if (!playerListContent) {
    console.error('[Bluetooth Player List] playerListContent 요소를 찾을 수 없습니다.');
    return;
  }

  // 모바일 환경 감지
  const isMobile = isMobileDevice();
  const networkInfo = getNetworkInfo();
  
  // 로딩 표시 (모바일 최적화 메시지)
  const loadingMessage = isMobile 
    ? '트랙 정보를 불러오는 중... (모바일 최적화 모드)'
    : '트랙 정보를 불러오는 중...';
  
  playerListContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner" style="margin: 0 auto 20px;"></div>
      <p style="color: #666;">${loadingMessage}</p>
      ${networkInfo && (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g') 
        ? '<p style="color: #f59e0b; font-size: 12px; margin-top: 8px;">느린 네트워크 감지: 로딩 시간이 다소 걸릴 수 있습니다</p>'
        : ''}
    </div>
  `;
  
  // 점진적 로딩: 먼저 기본 트랙을 표시하고 데이터를 점진적으로 업데이트
  const showProgressiveLoading = isMobile && networkInfo && 
    (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g' || networkInfo.rtt > 500);
  
  if (showProgressiveLoading) {
    console.log('[Bluetooth Player List] 점진적 로딩 모드 활성화');
    // 기본 트랙을 먼저 표시하여 사용자 경험 개선
    const defaultTracks = createDefaultTracks(10);
    const initialHtml = defaultTracks.map(track => `
      <div class="player-track-item" data-track-number="${track.trackNumber}">
        <div class="player-track-number-fixed">
          <div class="player-track-number-header">트랙${track.trackNumber}</div>
        </div>
        <div class="player-track-content">
          <div class="player-track-user-section">
            <div class="player-track-name no-user">로딩 중...</div>
          </div>
          <div class="player-track-action">
            <button class="btn btn-secondary btn-default-style" disabled>로딩 중</button>
          </div>
        </div>
      </div>
    `).join('');
    playerListContent.innerHTML = initialHtml;
  }

  // 성능 측정 시작
  const performanceStart = performance.now();
  
  // 전체 함수를 try-catch로 감싸서 모든 에러 처리 (스피너가 항상 제거되도록 보장)
  let tracks = [];
  let roomId = null;
  let maxTrackNumber = 10;
  let currentUser = null;
  let currentUserId = null;
  let userGrade = '2';
  let isAdmin = false;
  let hasMyTrack = false;
  
  // 캐싱: 최근 로드한 데이터를 메모리에 저장 (5초간 유효)
  const CACHE_KEY = 'bluetoothPlayerListCache';
  const CACHE_DURATION = 5000; // 5초
  const now = Date.now();
  
  try {
    // Training Room id 가져오기 (먼저 roomId 확인)
    try {
      if (currentSelectedTrainingRoom && currentSelectedTrainingRoom.id) {
        roomId = currentSelectedTrainingRoom.id;
      } else if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
        roomId = String(window.currentTrainingRoomId);
      } else if (typeof localStorage !== 'undefined') {
        const storedRoomId = localStorage.getItem('currentTrainingRoomId');
        if (storedRoomId) {
          roomId = storedRoomId;
        }
      }
    } catch (e) {
      console.warn('[Bluetooth Player List] roomId 가져오기 실패:', e);
    }
    
    // 캐시 확인 (같은 roomId인 경우)
    let useCache = false;
    if (typeof sessionStorage !== 'undefined' && roomId) {
      try {
        const cachedData = sessionStorage.getItem(CACHE_KEY);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          const cacheAge = now - parsed.timestamp;
          
          // 캐시가 유효하고 같은 roomId인 경우 사용
          if (cacheAge < CACHE_DURATION && parsed.roomId === String(roomId) && parsed.tracks && parsed.tracks.length > 0) {
            console.log('[Bluetooth Player List] ✅ 캐시된 데이터 사용 (', Math.round(cacheAge), 'ms 전)');
            tracks = parsed.tracks;
            maxTrackNumber = parsed.maxTrackNumber || 10;
            useCache = true;
            
            // 캐시된 데이터로 즉시 렌더링 (성능 개선)
            const cacheLoadTime = performance.now() - performanceStart;
            console.log('[Bluetooth Player List] 📊 캐시 로딩 시간:', Math.round(cacheLoadTime), 'ms');
          } else {
            console.log('[Bluetooth Player List] 캐시 만료 또는 roomId 불일치, 새로 로드');
          }
        }
      } catch (cacheError) {
        console.warn('[Bluetooth Player List] 캐시 읽기 오류:', cacheError);
      }
    }
    
    // 캐시를 사용하지 않는 경우에만 Firebase에서 로드
    if (!useCache) {
      // 트랙 정보 가져오기 및 최대 트랙 수 계산 (Live Training Session 전용)
      
      // Firebase 연결 확인
      const isFirebaseAvailable = typeof db !== 'undefined' && db !== null;
      
      if (roomId && isFirebaseAvailable) {
      try {
      const sessionId = roomId;
      
      // Firebase devices DB와 users DB에서 데이터 가져오기 (병렬 처리 + 타임아웃 + 재시도)
      const devicesRef = db.ref(`sessions/${sessionId}/devices`);
      const usersRef = db.ref(`sessions/${sessionId}/users`);
      
      // 모바일 최적화: 타임아웃 및 재시도 조정
      const isMobile = isMobileDevice();
      const networkInfo = getNetworkInfo();
      
      // 기본 타임아웃: PC 10초, 모바일 20초
      let baseTimeout = isMobile ? 20000 : 10000;
      
      // 네트워크 상태에 따른 추가 조정
      if (networkInfo) {
        if (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g') {
          baseTimeout = 30000; // 매우 느린 네트워크는 30초
        } else if (networkInfo.effectiveType === '3g') {
          baseTimeout = isMobile ? 25000 : 15000; // 3G는 중간값
        }
      }
      
      // 재시도 횟수: PC 3회, 모바일 4회
      const maxRetries = isMobile ? 4 : 3;
      const initialDelay = isMobile ? 800 : 1000; // 모바일은 약간 빠른 재시도
      
      console.log('[Bluetooth Player List] 로딩 설정:', {
        isMobile,
        networkType: networkInfo?.effectiveType || 'unknown',
        timeout: baseTimeout,
        maxRetries,
        initialDelay
      });
      
      // 타임아웃 및 재시도 적용
      const [devicesSnapshot, usersSnapshot] = await withRetry(
        () => withTimeout(
          Promise.all([
            devicesRef.once('value'),
            usersRef.once('value')
          ]),
          baseTimeout, // 동적 타임아웃
          'Firebase 데이터 로드 시간 초과'
        ),
        maxRetries, // 동적 재시도 횟수
        initialDelay // 동적 초기 지연
      );
      
      const devicesData = devicesSnapshot.val() || {};
      const usersData = usersSnapshot.val() || {};
      
      // devicesData에서 track 값 확인 (최상위 레벨)
      if (devicesData && typeof devicesData.track === 'number' && devicesData.track > 0) {
        maxTrackNumber = devicesData.track;
        console.log('[Bluetooth Player List] Firebase devices에서 트랙 개수 가져옴:', maxTrackNumber);
      } else {
        // track 값이 없으면 실제 존재하는 트랙 번호를 확인하여 최대값 사용
        const existingTrackNumbers = [];
        if (devicesData) {
          Object.keys(devicesData).forEach(key => {
            const trackNum = parseInt(key, 10);
            if (!isNaN(trackNum) && trackNum > 0 && trackNum <= 50) { // 최대 50개까지 확인
              existingTrackNumbers.push(trackNum);
            }
          });
        }
        
        // users 데이터에서도 트랙 번호 확인
        if (usersData) {
          Object.keys(usersData).forEach(key => {
            const trackNum = parseInt(key, 10);
            if (!isNaN(trackNum) && trackNum > 0 && trackNum <= 50) {
              if (!existingTrackNumbers.includes(trackNum)) {
                existingTrackNumbers.push(trackNum);
              }
            }
          });
        }
        
        if (existingTrackNumbers.length > 0) {
          maxTrackNumber = Math.max(...existingTrackNumbers);
          console.log('[Bluetooth Player List] devices/track 값이 없어 실제 존재하는 트랙 번호로 계산:', maxTrackNumber, '(존재하는 트랙:', existingTrackNumbers.sort((a, b) => a - b).join(', '), ')');
        } else {
          // 트랙 번호도 없으면 디폴트 10개 할당
          maxTrackNumber = 10;
          console.log('[Bluetooth Player List] Firebase devices에 track 값이 없고 실제 트랙도 없어 디폴트 10개 할당');
        }
      }
      
      // 트랙별 device 정보 가져오기 (트랙 번호별로 저장된 경우)
      const trackDevicesData = {};
      if (devicesData) {
        // devicesData가 객체이고 각 키가 트랙 번호인 경우
        Object.keys(devicesData).forEach(key => {
          const trackNum = parseInt(key, 10);
          if (!isNaN(trackNum) && trackNum > 0) {
            trackDevicesData[trackNum] = devicesData[key];
          }
        });
      }
      
      // 트랙 초기화
      for (let i = 1; i <= maxTrackNumber; i++) {
        const userData = usersData[i];
        const deviceData = trackDevicesData[i] || null;
        
        tracks.push({
          trackNumber: i,
          userId: userData?.userId || null,
          userName: userData?.userName || null,
          weight: userData?.weight || null,
          ftp: userData?.ftp || null,
          gear: deviceData?.gear || null,
          brake: deviceData?.brake || null,
          smartTrainerId: deviceData?.smartTrainerId || null,
          powerMeterId: deviceData?.powerMeterId || null,
          heartRateId: deviceData?.heartRateId || null
        });
      }
      
      // 성능 측정: Firebase 로드 완료
      const firebaseLoadTime = performance.now() - performanceStart;
      console.log('[Bluetooth Player List] 📊 Firebase 로드 시간:', Math.round(firebaseLoadTime), 'ms');
      
      // 캐시 저장 (성공적으로 로드한 경우)
      if (typeof sessionStorage !== 'undefined' && tracks.length > 0) {
        try {
          const cacheData = {
            tracks: tracks,
            maxTrackNumber: maxTrackNumber,
            roomId: roomId,
            timestamp: now
          };
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
          console.log('[Bluetooth Player List] ✅ 데이터 캐시 저장 완료');
        } catch (cacheError) {
          console.warn('[Bluetooth Player List] 캐시 저장 오류:', cacheError);
        }
      }
    } catch (error) {
      console.error('[Bluetooth Player List] ❌ 트랙 정보 로드 오류:', error);
      console.error('[Bluetooth Player List] 오류 상세:', {
        message: error.message,
        stack: error.stack,
        roomId: roomId,
        isFirebaseAvailable: isFirebaseAvailable
      });
        // 오류 발생 시 기본 10개 트랙 생성 (사용자는 계속 사용 가능)
        maxTrackNumber = 10;
        const defaultTracks = createDefaultTracks(10);
        tracks.push(...defaultTracks);
      }
    } else {
      // roomId가 없거나 Firebase가 사용 불가능한 경우 기본 10개 트랙 생성
      if (!roomId) {
        console.warn('[Bluetooth Player List] ⚠️ roomId가 없어 기본 트랙으로 표시합니다.');
      }
      const isFirebaseAvailable = typeof db !== 'undefined' && db !== null;
      if (!isFirebaseAvailable) {
        console.warn('[Bluetooth Player List] ⚠️ Firebase가 사용 불가능하여 기본 트랙으로 표시합니다.');
      }
      const defaultTracks = createDefaultTracks(10);
      tracks.push(...defaultTracks);
    }
    } // 캐시 사용하지 않는 경우의 Firebase 로드 블록 종료

    // tracks 배열이 비어있으면 기본 트랙 생성 (안전장치)
    if (tracks.length === 0) {
      console.warn('[Bluetooth Player List] ⚠️ tracks 배열이 비어있어 기본 10개 트랙을 생성합니다.');
      const defaultTracks = createDefaultTracks(10);
      tracks.push(...defaultTracks);
    }

    // roomId를 컨테이너에 data attribute로 저장
    if (playerListContent && roomId) {
      playerListContent.setAttribute('data-room-id', String(roomId));
    }

    // 현재 사용자 정보 확인 (권한 체크용)
    try {
      currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (currentUser && currentUser.id != null) {
        currentUserId = String(currentUser.id);
      }
      userGrade = (typeof getViewerGrade === 'function') ? getViewerGrade() : (currentUser?.grade ? String(currentUser.grade) : '2');
      isAdmin = userGrade === '1' || userGrade === 1;
    } catch (e) {
      console.error('[Bluetooth Player List] 현재 사용자 정보 확인 오류:', e);
    }

    // grade=2 사용자가 본인 계정으로 참가된 트랙이 있는지 확인
    if (!isAdmin && currentUserId) {
      hasMyTrack = tracks.some(track => {
        const trackUserId = track.userId ? String(track.userId) : null;
        return trackUserId && trackUserId === currentUserId;
      });
    }

    // 트랙 목록 렌더링 (try-catch로 감싸서 에러 발생 시에도 스피너 제거)
    try {
      const tracksHtml = tracks.map(track => {
    const hasUser = !!track.userName;
    const trackUserId = track.userId ? String(track.userId) : null;
    let canModify = false;
    let canParticipate = false;
    
    if (isAdmin || userGrade === '1' || userGrade === 1 || userGrade === '3' || userGrade === 3) {
      canModify = true;
      canParticipate = true;
    } else if (userGrade === '2' || userGrade === 2) {
      if (trackUserId && trackUserId === currentUserId) {
        canModify = true;
        canParticipate = true;
      } else if (!hasUser && !hasMyTrack) {
        canParticipate = true;
        canModify = false;
      } else {
        canModify = false;
        canParticipate = false;
      }
    }
    
    const dashboardUrl = roomId 
      ? `https://stelvio.ai.kr/bluetoothIndividual.html?bike=${track.trackNumber}&room=${roomId}`
      : `https://stelvio.ai.kr/bluetoothIndividual.html?bike=${track.trackNumber}`;

    // Gear/Brake 아이콘 생성
    let gearIcon = '';
    let brakeIcon = '';
    
    if (track.gear) {
      if (track.gear === '11단' || track.gear === '11') {
        gearIcon = '<img src="assets/img/g11.png" alt="11단" class="device-icon" />';
      } else if (track.gear === '12단' || track.gear === '12') {
        gearIcon = '<img src="assets/img/g12.png" alt="12단" class="device-icon" />';
      }
    }
    
    if (track.brake) {
      if (track.brake === '디스크' || track.brake === 'Disc') {
        brakeIcon = '<img src="assets/img/d.png" alt="디스크" class="device-icon" />';
      } else if (track.brake === '림' || track.brake === 'Rim') {
        brakeIcon = '<img src="assets/img/r.png" alt="림" class="device-icon" />';
      }
    }
    
    // 디바이스 아이콘 생성
    const deviceIcons = [];
    if (track.heartRateId) {
      deviceIcons.push('<img src="assets/img/bpm_g.png" alt="심박계" class="device-icon-with-bg" title="심박계" />');
    }
    if (track.smartTrainerId) {
      deviceIcons.push('<img src="assets/img/trainer_g.png" alt="스마트트레이너" class="device-icon-with-bg" title="스마트트레이너" />');
    }
    if (track.powerMeterId) {
      deviceIcons.push('<img src="assets/img/power_g.png" alt="파워메터" class="device-icon-with-bg" title="파워메터" />');
    }
    if (gearIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="기어">${gearIcon}</span>`);
    }
    if (brakeIcon) {
      deviceIcons.push(`<span class="device-icon-plain" title="브레이크">${brakeIcon}</span>`);
    }
    const deviceIconsHtml = deviceIcons.length > 0 ? deviceIcons.join('') : '';
    
    return `
      <div class="player-track-item" data-track-number="${track.trackNumber}" data-room-id="${roomId || ''}">
        <div class="player-track-number-fixed">
          <div class="player-track-number-header">
            트랙${track.trackNumber}
          </div>
        </div>
        <div class="player-track-content">
          <div class="player-track-user-section">
            <div class="player-track-name ${hasUser ? 'has-user' : 'no-user'}">
              ${hasUser ? escapeHtml(track.userName) : '사용자 없음'}
            </div>
            ${deviceIconsHtml ? `<div class="player-track-devices-right">${deviceIconsHtml}</div>` : ''}
          </div>
          <div class="player-track-action">
            ${!hasUser && canParticipate ? `
              <!-- 신청 버튼: 사용자 없음 + 신청 가능한 경우 -->
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                onclick="assignUserToBluetoothTrackWithAnimation(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}', event)"
                title="훈련 신청">
                <span>신청</span>
              </button>
            ` : hasUser && isAdmin ? `
              <!-- 변경 버튼: 사용자 있음 + 관리자인 경우 (Bluetooth Join Session 전용) -->
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                onclick="assignUserToBluetoothTrackWithAnimation(${track.trackNumber}, '${escapeHtml(track.userId || '')}', '${roomId || ''}', event)"
                title="훈련 변경">
                <span>변경</span>
              </button>
            ` : hasUser && !isAdmin ? `
              <!-- 일반 사용자(grade=2)는 변경 버튼 표시하지 않음 -->
            ` : `
              <!-- 비활성화된 신청 버튼 -->
              <button 
                class="btn btn-secondary btn-default-style btn-with-icon player-assign-btn"
                disabled
                title="훈련 신청/변경">
                <span>${hasUser ? '변경' : '신청'}</span>
              </button>
            `}
            ${hasUser && canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                onclick="removeUserFromBluetoothTrackWithAnimation(${track.trackNumber}, '${roomId || ''}', event)"
                title="훈련 참가 퇴실">
                <span>퇴실</span>
              </button>
            ` : hasUser && !canModify ? `
              <button 
                class="btn btn-danger btn-default-style btn-with-icon player-remove-btn"
                disabled
                title="본인이 할당한 트랙만 퇴실 가능합니다">
                <span>퇴실</span>
              </button>
            ` : ''}
            <a href="${dashboardUrl}" 
               target="_blank"
               class="btn btn-primary btn-default-style btn-with-icon player-enter-btn ${!hasUser || !canModify ? 'disabled' : ''}"
               ${!hasUser || !canModify ? 'aria-disabled="true" tabindex="-1"' : ''}
               onclick="handleBluetoothPlayerEnterClick(event, ${track.trackNumber}, '${roomId || ''}'); return true;"
               title="${!hasUser ? '사용자가 할당되지 않았습니다' : (!canModify ? '본인이 할당한 트랙만 입장 가능합니다' : '훈련 시작')}">
              <img src="assets/img/enter.png" alt="Enter" class="btn-icon-image" />
              <span>Enter</span>
            </a>
          </div>
        </div>
      </div>
    `;
    }).join('');
    
    // 렌더링 성공 시 HTML 업데이트
    // 점진적 로딩 모드에서는 부드러운 전환을 위해 requestAnimationFrame 사용
    if (showProgressiveLoading) {
      // 모바일에서 부드러운 전환을 위해 약간의 지연 후 업데이트
      requestAnimationFrame(() => {
        playerListContent.innerHTML = tracksHtml;
        console.log('[Bluetooth Player List] ✅ 트랙 정보 렌더링 완료 (점진적 로딩):', tracks.length, '개 트랙');
      });
    } else {
      playerListContent.innerHTML = tracksHtml;
      console.log('[Bluetooth Player List] ✅ 트랙 정보 렌더링 완료:', tracks.length, '개 트랙');
    }
    
    // 일괄 퇴실 버튼 표시 여부
    const btnClearAllTracks = document.getElementById('btnClearAllBluetoothTracks');
    if (btnClearAllTracks) {
      if (isAdmin || userGrade === '3' || userGrade === 3) {
        btnClearAllTracks.style.display = 'inline-flex';
      } else {
        btnClearAllTracks.style.display = 'none';
      }
    }
    
    // 성능 로그 (모바일에서만)
    if (isMobile) {
      const loadTime = performance.now();
      console.log('[Bluetooth Player List] 📱 모바일 로딩 완료 시간:', Math.round(loadTime), 'ms');
    }
    } catch (renderError) {
      console.error('[Bluetooth Player List] ❌ 렌더링 오류:', renderError);
      // 렌더링 실패 시에도 기본 트랙으로 표시
      try {
        // tracks 배열이 비어있으면 기본 트랙 생성
        if (tracks.length === 0) {
          const defaultTracks = createDefaultTracks(10);
          tracks.push(...defaultTracks);
        }
        
        const fallbackHtml = tracks.map(track => `
          <div class="player-track-item" data-track-number="${track.trackNumber}">
            <div class="player-track-number-fixed">
              <div class="player-track-number-header">트랙${track.trackNumber}</div>
            </div>
            <div class="player-track-content">
              <div class="player-track-user-section">
                <div class="player-track-name ${track.userName ? 'has-user' : 'no-user'}">
                  ${track.userName ? escapeHtml(track.userName) : '사용자 없음'}
                </div>
              </div>
              <div class="player-track-action">
                <button class="btn btn-secondary btn-default-style" disabled>신청</button>
              </div>
            </div>
          </div>
        `).join('');
        playerListContent.innerHTML = fallbackHtml;
        console.log('[Bluetooth Player List] ✅ 기본 트랙으로 표시 완료 (렌더링 오류 복구)');
      } catch (fallbackError) {
        console.error('[Bluetooth Player List] ❌ 기본 트랙 표시도 실패:', fallbackError);
        // 최후의 수단: 에러 메시지 표시
        playerListContent.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #dc2626;">
            <p style="font-size: 16px; font-weight: 600; margin-bottom: 10px;">트랙 정보를 불러올 수 없습니다</p>
            <p style="font-size: 14px; color: #666; margin-bottom: 20px;">네트워크 연결을 확인하고 잠시 후 다시 시도해주세요.</p>
            <button onclick="if(typeof renderBluetoothPlayerList==='function'){renderBluetoothPlayerList();}" 
                    style="padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
              다시 시도
            </button>
          </div>
        `;
      }
    }
    } catch (globalError) {
    // 전체 함수에서 발생한 모든 에러 처리
    console.error('[Bluetooth Player List] ❌ 치명적 오류:', globalError);
    console.error('[Bluetooth Player List] 오류 상세:', {
      message: globalError.message,
      stack: globalError.stack
    });
    
    // 최후의 수단: 기본 트랙으로 표시
    try {
      const defaultTracks = createDefaultTracks(10);
      const fallbackHtml = defaultTracks.map(track => `
        <div class="player-track-item" data-track-number="${track.trackNumber}">
          <div class="player-track-number-fixed">
            <div class="player-track-number-header">트랙${track.trackNumber}</div>
          </div>
          <div class="player-track-content">
            <div class="player-track-user-section">
              <div class="player-track-name no-user">사용자 없음</div>
            </div>
            <div class="player-track-action">
              <button class="btn btn-secondary btn-default-style" disabled>신청</button>
            </div>
          </div>
        </div>
      `).join('');
      
      playerListContent.innerHTML = fallbackHtml;
      console.log('[Bluetooth Player List] ✅ 기본 트랙으로 표시 완료 (에러 복구)');
    } catch (fallbackError) {
      console.error('[Bluetooth Player List] ❌ 기본 트랙 표시도 실패:', fallbackError);
      // 최후의 수단: 에러 메시지 표시
      playerListContent.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #dc2626;">
          <p style="font-size: 16px; font-weight: 600; margin-bottom: 10px;">트랙 정보를 불러올 수 없습니다</p>
          <p style="font-size: 14px; color: #666; margin-bottom: 20px;">네트워크 연결을 확인하고 잠시 후 다시 시도해주세요.</p>
          <button onclick="if(typeof renderBluetoothPlayerList==='function'){renderBluetoothPlayerList();}" 
                  style="padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
            다시 시도
          </button>
        </div>
      `;
    }
  }
}

/**
 * 입장 버튼 클릭 핸들러 (애니메이션 적용)
 */
function handlePlayerEnterClick(event, trackNumber, roomId) {
  const button = event?.target?.closest('a.player-enter-btn');
  
  // 비활성화된 버튼은 클릭 무시
  if (button && (button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true')) {
    event.preventDefault();
    return;
  }
  
  // 즉시 클릭 애니메이션 효과
  if (button) {
    button.classList.add('clicking');
    setTimeout(() => {
      button.classList.remove('clicking');
    }, 300);
  }
  
  // href로 이동하는 것은 브라우저가 처리하도록 허용
  // 애니메이션은 클릭 시 즉시 표시됨
}

/**
 * Bluetooth 입장 버튼 클릭 핸들러 (로딩 애니메이션 적용, Bluetooth Join Session 전용, 독립적 구동)
 */
function handleBluetoothPlayerEnterClick(event, trackNumber, roomId) {
  const button = event?.target?.closest('a.player-enter-btn');
  
  // 비활성화된 버튼은 클릭 무시
  if (button && (button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true')) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  
  // 로딩 애니메이션 시작
  if (button) {
    button.classList.add('loading');
    // 페이지 이동이 시작되면 로딩 상태가 자연스럽게 사라짐
  }
  
  // 기존 클릭 애니메이션도 유지
  if (button) {
    button.classList.add('clicking');
    setTimeout(() => {
      button.classList.remove('clicking');
    }, 300);
  }
  
  // href로 이동하는 것은 브라우저가 처리하도록 허용 (preventDefault 호출하지 않음)
  // bluetoothIndividual.html이 새 창(target="_blank")으로 열림
  // 로딩 애니메이션은 페이지 이동 전까지 표시됨
  // return true를 통해 기본 동작(링크 이동)을 명시적으로 허용
  
  // 축하 모달이 표시되지 않도록 확인 (혹시 다른 곳에서 호출되는 경우 대비)
  const registerCelebrationModal = document.getElementById('registerCelebrationModal');
  if (registerCelebrationModal && registerCelebrationModal.style.display !== 'none') {
    registerCelebrationModal.classList.add('hidden');
    registerCelebrationModal.style.display = 'none';
    console.log('[handleBluetoothPlayerEnterClick] 축하 모달이 열려있어서 닫았습니다.');
  }
  
  return true;
}

