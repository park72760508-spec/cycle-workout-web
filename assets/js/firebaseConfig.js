// assets/js/firebaseConfig.js

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
let db; // db 변수 선언

try {
    // 이미 초기화되어 있는지 확인 (중복 초기화 방지)
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // 데이터베이스 기능을 가져와서 누구나 쓸 수 있게 'window.db'에 담기
    window.db = firebase.database();
    db = window.db; // 호환성을 위해 db 변수에도 저장
    
    console.log("🔥 Firebase(데이터베이스) 연결 성공!");
} catch (e) {
    console.error("🔥 Firebase 연결 실패! (인터넷 연결이나 키 값을 확인하세요)", e);
}

// 3. 고정 세션 ID (방 이름)
const SESSION_ID = 'session_room_1';
