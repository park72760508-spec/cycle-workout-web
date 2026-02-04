/**
 * 앱 설정 샘플 (API 키·시크릿 미포함)
 * - 이 파일을 config.local.js 로 복사한 뒤 실제 값을 채워 넣으세요.
 * - config.local.js 는 .gitignore 에 포함되어 Git/GitHub에 올라가지 않습니다.
 *
 * 사용처: index.html, callback.html, stravaManager.js, strava_auth.js
 */
(function () {
  'use strict';

  // Firebase (index.html / callback.html 에서 사용)
  window.__FIREBASE_CONFIG__ = {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:xxxxxxxxxxxxx'
  };

  // GAS 웹앱 URL, Strava 리다이렉트 URI
  window.CONFIG = {
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/YOUR_GAS_DEPLOY_ID/exec',
    STRAVA_REDIRECT_URI: 'https://your-domain.com/callback.html'
  };

  // Strava OAuth (client_secret 은 반드시 서버에서만 사용 권장)
  window.STRAVA_CLIENT_ID = 'YOUR_STRAVA_CLIENT_ID';
  window.STRAVA_CLIENT_SECRET = 'YOUR_STRAVA_CLIENT_SECRET';
})();
