// assets/js/firebaseConfig.js

/**
 * Firebase Auth 웹 API(setPersistence, getRedirectResult 등) 사용 가능 환경인지.
 * file://, in-app WebView, storage 비활성 시 false.
 */
function isStelvioFirebaseAuthWebEnv() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    var proto = String(window.location.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'chrome-extension:') return false;
    if (typeof localStorage === 'undefined') return false;
    var testKey = '__stelvio_auth_env__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (_e) {
    return false;
  }
}
if (typeof window !== 'undefined') {
  window.isStelvioFirebaseAuthWebEnv = isStelvioFirebaseAuthWebEnv;
}

// 1. 복사해둔 진짜 키 값으로 설정 (제일 중요!)
const firebaseConfig = {
    apiKey: "AIzaSyDVQJZV6NIbqhPdz1CKfbA8yHHYClSC35Q",
    authDomain: "stelvio-ai.firebaseapp.com",
    projectId: "stelvio-ai",
    storageBucket: "stelvio-ai.firebasestorage.app",
    messagingSenderId: "752285835508",
    appId: "1:752285835508:web:0662a24874209ebb483ea1",
    // ★주의: databaseURL이 빠지면 작동 안 합니다. 
    // 보통 프로젝트ID 뒤에 -default-rtdb.firebaseio.com 가 붙습니다.
    // 만약 아래 주소로 안 되면 Firebase 콘솔에서 다시 확인해주세요.
    databaseURL: "https://stelvio-ai-default-rtdb.firebaseio.com"
};

// 2. Firebase 초기화 (전역 변수 window.db에 저장해야 다른 파일들이 갖다 씁니다)
let db; // db 변수 선언 (Realtime Database용)
let auth; // auth 변수 선언 (Authentication용)
let firestore; // firestore 변수 선언 (Firestore용)

try {
    // 이미 초기화되어 있는지 확인 (중복 초기화 방지)
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // Realtime Database (기존 코드 호환성 유지)
    window.db = firebase.database();
    db = window.db; // 호환성을 위해 db 변수에도 저장
    
    // Authentication 초기화
    auth = firebase.auth();
    window.auth = auth; // 전역 접근용
    // 🔒 SESSION persistence — http(s) + storage 가능 환경에서만 (WebView/file://는 기본 persistence 유지)
    if (isStelvioFirebaseAuthWebEnv()) {
      auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).then(function() {
        console.log('🔥 Firebase Auth: SESSION persistence 적용 (탭 종료 시 로그아웃)');
      }).catch(function(e) {
        var code = e && e.code;
        if (code === 'auth/unsupported-persistence-type' || code === 'auth/operation-not-supported-in-this-environment') {
          console.log('[Firebase] setPersistence(SESSION) 생략 — 현재 환경에서 미지원');
        } else {
          console.warn('[Firebase] setPersistence(SESSION) 실패:', e && e.message);
        }
      });
    } else {
      console.log('[Firebase] setPersistence(SESSION) 생략 — protocol:', window.location && window.location.protocol);
    }
    
    // Firestore 초기화 (WebChannel 400 오류 방지: Long Polling 강제)
    firestore = firebase.firestore();
    try {
        firestore.settings({ experimentalForceLongPolling: true, merge: true });
        console.log("🔥 Firestore Long Polling 적용 (WebChannel 400 방지)");
    } catch (e) {
        if (e.message && (e.message.indexOf('already been started') !== -1 || e.message.indexOf('settings can no longer be changed') !== -1)) {
            console.warn("🔥 Firestore settings 이미 적용됨:", e.message);
        } else {
            console.warn("🔥 Firestore Long Polling 적용 실패:", e);
        }
    }
    window.firestore = firestore; // 전역 접근용
    
    console.log("🔥 Firebase(Realtime Database) 연결 성공!");
    console.log("🔥 Firebase Authentication 초기화 완료!");
    console.log("🔥 Firebase Firestore 초기화 완료!");
} catch (e) {
    console.error("🔥 Firebase 연결 실패! (인터넷 연결이나 키 값을 확인하세요)", e);
}

// 3. 세션 ID (Training Room ID를 URL 파라미터 또는 전역 변수에서 가져옴)
// 우선순위: 1) URL 파라미터 2) 전역 변수 (window.currentTrainingRoomId) 3) localStorage 4) 기본값
const urlParams = new URLSearchParams(window.location.search);
let SESSION_ID = urlParams.get('room');

// URL에 room 파라미터가 없으면 전역 변수에서 확인
if (!SESSION_ID && typeof window !== 'undefined' && window.currentTrainingRoomId) {
    SESSION_ID = String(window.currentTrainingRoomId);
    console.log("🔥 [Firebase Config] URL에 room 파라미터가 없어 전역 변수에서 가져옴:", SESSION_ID);
}

// 전역 변수에도 없으면 localStorage에서 확인
if (!SESSION_ID && typeof localStorage !== 'undefined') {
    try {
        const storedRoomId = localStorage.getItem('currentTrainingRoomId');
        if (storedRoomId) {
            SESSION_ID = storedRoomId;
            console.log("🔥 [Firebase Config] localStorage에서 가져옴:", SESSION_ID);
        }
    } catch (e) {
        console.warn("🔥 [Firebase Config] localStorage 접근 실패:", e);
    }
}

// 모든 방법으로 가져올 수 없으면 기본값 사용
if (!SESSION_ID) {
    SESSION_ID = 'session_room_1';
    console.log("🔥 [Firebase Config] 기본값 사용:", SESSION_ID);
}

// SESSION_ID를 window 객체에 저장 (다른 파일에서 접근 가능하도록)
window.SESSION_ID = SESSION_ID;

console.log("🔥 [Firebase Config] 최종 SESSION_ID:", SESSION_ID);
console.log("🔥 [Firebase Config] URL 파라미터:", window.location.search);
console.log("🔥 [Firebase Config] 전역 변수 currentTrainingRoomId:", window.currentTrainingRoomId);
console.log("🔥 [Firebase Config] window.SESSION_ID:", window.SESSION_ID);

/* Supabase Dual-Write (웹) — stelvioSupabaseConfig.js 와 동일. 배포 시 이 파일만 올려도 됨 */
(function () {
  var supabaseDefaults = {
    supabaseUrl: 'https://eacrwhtbdqanaxpicqsm.supabase.co',
    supabaseAnonKey: 'sb_publishable_H4woEe6KlAnkz9jGoVbjOQ_cyUHk8v4',
    authBridgeUrl:
      'https://us-central1-stelvio-ai.cloudfunctions.net/mintSupabaseSessionHttp',
    provisionUserAfterProfileUrl:
      'https://us-central1-stelvio-ai.cloudfunctions.net/provisionSupabaseUserAfterProfileHttp',
    uidNamespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  };
  var supabaseOver =
    typeof window !== 'undefined' && window.__STELVIO_SUPABASE__;
  window.STELVIO_SUPABASE_CONFIG = Object.assign(
    {},
    supabaseDefaults,
    supabaseOver && typeof supabaseOver === 'object' ? supabaseOver : {}
  );
})();

/* GPS 위치 추적 — Supabase/Firestore 스위치 (USE_SUPABASE_FOR_TRACKING) */
(function () {
  var trackingDefaults = {
    useSupabaseForTracking: false,
    batchIntervalMs: 45000,
    maxBufferSize: 120,
    geolocationOptions: {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    },
    supabaseRequestTimeoutMs: 20000,
  };
  var trackingOver =
    typeof window !== 'undefined' && window.__STELVIO_TRACKING__;
  window.STELVIO_TRACKING_CONFIG = Object.assign(
    {},
    trackingDefaults,
    trackingOver && typeof trackingOver === 'object' ? trackingOver : {}
  );
  window.stelvioParseTrackingBool = function (raw, fallback) {
    if (raw === true || raw === 1) return true;
    if (raw === false || raw === 0) return false;
    if (raw == null || raw === '') return fallback;
    var s = String(raw).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return fallback;
  };
})();
