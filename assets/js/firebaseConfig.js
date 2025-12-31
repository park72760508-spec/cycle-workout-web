// firebaseConfig.js
// Firebase 설정 (메인 화면과 개인 화면 공통 사용)

const firebaseConfig = {
    apiKey: "AIzaSyBKoRoOwgcv7mRZx8kfuuLtZyLzxTxjjW4",             // <--- 여기를 실제 값으로 변경
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://stelvio-indoor-default-rtdb.firebaseio.com", // <--- 여기가 제일 중요
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

// Firebase 초기화
try {
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    console.log("Firebase initialized successfully");
} catch (e) {
    console.error("Firebase initialization failed:", e);
}

// 고정 세션 ID (방 이름)
const SESSION_ID = 'session_room_1';