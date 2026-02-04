/**
 * 앱 설정 (실제 API 키·시크릿) — Git에 커밋하지 마세요 (.gitignore)
 * 이 파일이 없으면 config.sample.js 의 placeholder 로 동작해 Firebase/Strava가 동작하지 않습니다.
 */
(function () {
  'use strict';

  window.__FIREBASE_CONFIG__ = {
    apiKey: 'AIzaSyDVQJZV6NIbqhPdz1CKfbA8yHHYClSC35Q',
    authDomain: 'stelvio-ai.firebaseapp.com',
    projectId: 'stelvio-ai',
    storageBucket: 'stelvio-ai.firebasestorage.app',
    messagingSenderId: '752285835508',
    appId: '1:752285835508:web:0662a24874209ebb483ea1'
  };

  window.CONFIG = {
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzF8br63uD3ziNxCFkp0UUSpP49zURthDsEVZ6o3uRu47pdS5uXE5S1oJ3d7AKHFouJ/exec',
    STRAVA_REDIRECT_URI: 'https://stelvio.ai.kr/callback.html'
  };

  window.STRAVA_CLIENT_ID = '197363';
  window.STRAVA_CLIENT_SECRET = '6cd67a28f1c516c0f004f1c7f97f4d74be187d85';
})();
