/**
 * Firebase Configuration (v9 Modular SDK)
 * 
 * 사용 방법:
 * 1. Firebase 콘솔(https://console.firebase.google.com)에서 프로젝트 설정으로 이동
 * 2. "앱 추가" > "웹" 선택 후 앱 등록
 * 3. 아래 firebaseConfig 객체의 값들을 실제 프로젝트 값으로 교체하세요
 * 
 * 주의: 이 파일은 공개적으로 노출되므로 보안 규칙에서 클라이언트 접근을 제한하세요.
 */

// ============================================
// 🔥 Firebase 설정 객체 (기존 firebaseConfig.js에서 가져온 실제 값)
// ============================================
export const firebaseConfig = {
  apiKey: "AIzaSyDVQJZV6NIbqhPdz1CKfbA8yHHYClSC35Q",
  authDomain: "stelvio-ai.firebaseapp.com",
  projectId: "stelvio-ai",
  storageBucket: "stelvio-ai.firebasestorage.app",
  messagingSenderId: "752285835508",
  appId: "1:752285835508:web:0662a24874209ebb483ea1",
  // 참고: Authentication만 사용하므로 databaseURL은 선택사항입니다
  // databaseURL: "https://stelvio-ai-default-rtdb.firebaseio.com"
};

// ============================================
// 설정 가이드:
// ============================================
// 1. apiKey: "AIzaSy..." 형식의 API 키
// 2. authDomain: "프로젝트ID.firebaseapp.com"
// 3. projectId: Firebase 프로젝트 ID
// 4. storageBucket: "프로젝트ID.appspot.com"
// 5. messagingSenderId: 숫자로 된 메시징 발신자 ID
// 6. appId: "1:..." 형식의 앱 ID
//
// 예시:
// export const firebaseConfig = {
//   apiKey: "AIzaSyDVQJZV6NIbqhPdz1CKfbA8yHHYClSC35Q",
//   authDomain: "stelvio-ai.firebaseapp.com",
//   projectId: "stelvio-ai",
//   storageBucket: "stelvio-ai.appspot.com",
//   messagingSenderId: "752285835508",
//   appId: "1:752285835508:web:0662a24874209ebb483ea1"
// };
// ============================================
