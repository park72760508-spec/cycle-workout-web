/**
 * STELVIO AI - 전화번호 기반 간편 로그인/회원가입 시스템
 * 
 * 핵심 로직:
 * 1. 전화번호를 @stelvio.ai 도메인을 붙인 가짜 이메일로 변환
 * 2. One-Stop Flow: 로그인 시도 → 실패 시 회원가입 모드로 자동 전환
 * 3. Firebase Authentication (Email/Password) 사용
 */

// ============================================
// Firebase v9 Modular SDK Import (CDN)
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// ============================================
// Firebase 초기화
// ============================================
let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  console.log('✅ Firebase 초기화 완료');
} catch (error) {
  console.error('❌ Firebase 초기화 실패:', error);
  alert('Firebase 설정을 확인해주세요. firebase-config.js 파일을 확인하세요.');
}

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 전화번호를 @stelvio.ai 도메인을 붙인 가짜 이메일로 변환
 * @param {string} phoneNumber - 사용자 입력 전화번호 (예: "010-1234-5678")
 * @returns {string} - 변환된 이메일 형식 (예: "01012345678@stelvio.ai")
 */
function phoneToEmail(phoneNumber) {
  // 하이픈, 공백, 괄호 등 모든 비숫자 문자 제거
  const cleaned = phoneNumber.replace(/\D/g, '');
  return `${cleaned}@stelvio.ai`;
}

/**
 * 전화번호 입력 필드 포맷팅 (하이픈 자동 추가)
 * @param {string} value - 입력값
 * @returns {string} - 포맷팅된 전화번호
 */
function formatPhoneNumber(value) {
  // 숫자만 추출
  const numbers = value.replace(/\D/g, '');
  
  // 길이에 따라 하이픈 추가
  if (numbers.length <= 3) {
    return numbers;
  } else if (numbers.length <= 7) {
    return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  } else if (numbers.length <= 11) {
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  } else {
    // 11자리 초과 시 자르기
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
  }
}

// ============================================
// DOM 요소 참조
// ============================================
const phoneInput = document.getElementById('phone-input');
const passwordInput = document.getElementById('password-input');
const nicknameInput = document.getElementById('nickname-input');
const nicknameGroup = document.getElementById('nickname-group');
const submitButton = document.getElementById('submit-button');
const errorMessage = document.getElementById('error-message');

// ============================================
// 상태 관리
// ============================================
let isSignUpMode = false; // 회원가입 모드 여부

// ============================================
// UI 업데이트 함수
// ============================================

/**
 * 회원가입 모드로 UI 전환
 */
function switchToSignUpMode() {
  isSignUpMode = true;
  nicknameGroup.classList.remove('hidden');
  submitButton.textContent = '가입 완료';
  submitButton.classList.add('signup-mode');
  console.log('🔄 회원가입 모드로 전환');
}

/**
 * 로그인 모드로 UI 초기화
 */
function resetToLoginMode() {
  isSignUpMode = false;
  nicknameGroup.classList.add('hidden');
  submitButton.textContent = '시작하기';
  submitButton.classList.remove('signup-mode');
  nicknameInput.value = '';
  errorMessage.textContent = '';
  console.log('🔄 로그인 모드로 초기화');
}

/**
 * 에러 메시지 표시
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 5000);
}

// ============================================
// 인증 로직
// ============================================

/**
 * 로그인 시도
 */
async function attemptLogin(phone, password) {
  try {
    const email = phoneToEmail(phone);
    console.log(`🔐 로그인 시도: ${email}`);
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    console.log('✅ 로그인 성공:', user.uid);
    
    // 대시보드로 이동
    window.location.href = 'dashboard.html';
    
  } catch (error) {
    console.error('❌ 로그인 실패:', error.code, error.message);
    
    // 사용자가 존재하지 않는 경우 → 회원가입 모드로 전환
    if (error.code === 'auth/user-not-found') {
      switchToSignUpMode();
      return false; // 로그인 실패
    }
    
    // 기타 에러 처리
    handleAuthError(error);
    return false;
  }
}

/**
 * 회원가입 처리
 */
async function handleSignUp(phone, password, nickname) {
  try {
    const email = phoneToEmail(phone);
    console.log(`📝 회원가입 시도: ${email}, 닉네임: ${nickname}`);
    
    // 1. 계정 생성
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    console.log('✅ 계정 생성 성공:', user.uid);
    
    // 2. 닉네임 프로필 업데이트
    if (nickname && nickname.trim()) {
      await updateProfile(user, {
        displayName: nickname.trim()
      });
      console.log('✅ 닉네임 저장 완료:', nickname);
    }
    
    // 3. 대시보드로 이동
    window.location.href = 'dashboard.html';
    
  } catch (error) {
    console.error('❌ 회원가입 실패:', error.code, error.message);
    handleAuthError(error);
  }
}

/**
 * 인증 에러 처리
 */
function handleAuthError(error) {
  let message = '알 수 없는 오류가 발생했습니다.';
  
  switch (error.code) {
    case 'auth/wrong-password':
      message = '비밀번호가 올바르지 않습니다.';
      break;
    case 'auth/invalid-email':
      message = '전화번호 형식이 올바르지 않습니다.';
      break;
    case 'auth/weak-password':
      message = '비밀번호는 최소 6자 이상이어야 합니다.';
      break;
    case 'auth/email-already-in-use':
      message = '이미 사용 중인 전화번호입니다.';
      break;
    case 'auth/network-request-failed':
      message = '네트워크 연결을 확인해주세요.';
      break;
    case 'auth/too-many-requests':
      message = '너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.';
      break;
    default:
      message = `오류: ${error.message}`;
  }
  
  showError(message);
}

// ============================================
// 이벤트 리스너
// ============================================

/**
 * 전화번호 입력 필드 포맷팅
 */
if (phoneInput) {
  phoneInput.addEventListener('input', (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    e.target.value = formatted;
  });
  
  // Enter 키로 다음 필드로 이동
  phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      passwordInput.focus();
    }
  });
}

/**
 * 비밀번호 입력 필드
 */
if (passwordInput) {
  // Enter 키로 제출
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isSignUpMode) {
      submitButton.click();
    } else if (e.key === 'Enter' && isSignUpMode) {
      nicknameInput.focus();
    }
  });
}

/**
 * 닉네임 입력 필드
 */
if (nicknameInput) {
  // Enter 키로 제출
  nicknameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && isSignUpMode) {
      submitButton.click();
    }
  });
}

/**
 * 제출 버튼 클릭 이벤트
 */
if (submitButton) {
  submitButton.addEventListener('click', async () => {
    // 입력값 가져오기
    const phone = phoneInput.value.trim();
    const password = passwordInput.value;
    const nickname = nicknameInput.value.trim();
    
    // 유효성 검사
    if (!phone) {
      showError('전화번호를 입력해주세요.');
      phoneInput.focus();
      return;
    }
    
    if (!password) {
      showError('비밀번호를 입력해주세요.');
      passwordInput.focus();
      return;
    }
    
    // 회원가입 모드인 경우 닉네임 검사
    if (isSignUpMode) {
      if (!nickname) {
        showError('닉네임을 입력해주세요.');
        nicknameInput.focus();
        return;
      }
      
      if (nickname.length < 2) {
        showError('닉네임은 최소 2자 이상이어야 합니다.');
        nicknameInput.focus();
        return;
      }
      
      // 회원가입 처리
      submitButton.disabled = true;
      submitButton.textContent = '가입 중...';
      await handleSignUp(phone, password, nickname);
      submitButton.disabled = false;
      submitButton.textContent = '가입 완료';
      
    } else {
      // 로그인 처리
      submitButton.disabled = true;
      submitButton.textContent = '로그인 중...';
      await attemptLogin(phone, password);
      submitButton.disabled = false;
      submitButton.textContent = '시작하기';
    }
  });
}

// ============================================
// 페이지 로드 시 초기화
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 STELVIO AI 인증 시스템 초기화 완료');
  resetToLoginMode();
  
  // 이미 로그인된 사용자 확인
  if (auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        console.log('✅ 이미 로그인된 사용자:', user.uid);
        // 대시보드로 리다이렉트 (선택사항)
        // window.location.href = 'dashboard.html';
      }
    });
  }
});
