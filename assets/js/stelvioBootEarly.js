/**
 * STELVIO 조기 부트 — app.js(본문 하단) 로드 전 스플래시 → 인증 화면 전환
 * Android WebView: 거대 index.html 파싱(10초+)을 기다리지 않고 로고 → 인증 화면 노출
 * 자동 로그인(initializeAuthenticationSystem 등)은 app.js applyInitialAuthRouting 에서 그대로 수행
 */
(function stelvioBootEarly() {
  'use strict';

  if (window._openDeviceSettingsOnly || window._openDeviceSettingsFromBluetooth) return;

  var ua = (navigator && navigator.userAgent) || '';
  var isAndroid = /Android/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
  /* 로고 최소 표시: Android WebView 체감 지연 보정(짧게), iOS는 기존과 유사 */
  var SPLASH_MIN_MS = isAndroid ? 380 : 420;
  var FAILSAFE_MS = isAndroid ? 2800 : 3200;
  var bootDone = false;
  var splashStartedAt = Date.now();

  function dismissSplashEarly() {
    window.isSplashActive = false;
    var splash = document.getElementById('splashScreen');
    if (splash) {
      splash.classList.remove('active');
      splash.style.setProperty('display', 'none', 'important');
      splash.style.setProperty('opacity', '0', 'important');
      splash.style.setProperty('visibility', 'hidden', 'important');
      splash.style.setProperty('z-index', '-1', 'important');
      splash.style.setProperty('transition', 'none', 'important');
    }
    var splashContainer = document.querySelector('.splash-container');
    if (splashContainer) {
      splashContainer.style.setProperty('display', 'none', 'important');
      splashContainer.style.setProperty('opacity', '0', 'important');
      splashContainer.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  function hideOtherScreens(exceptId) {
    document.querySelectorAll('.screen').forEach(function (screen) {
      if (screen.id === exceptId || screen.id === 'splashScreen') return;
      screen.classList.remove('active');
      screen.style.setProperty('display', 'none', 'important');
      screen.style.setProperty('opacity', '0', 'important');
      screen.style.setProperty('visibility', 'hidden', 'important');
    });
  }

  function showAuthScreenEarly() {
    dismissSplashEarly();
    hideOtherScreens('authScreen');
    var el = document.getElementById('authScreen');
    if (!el) return false;
    el.classList.add('active');
    el.style.removeProperty('position');
    el.style.removeProperty('z-index');
    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('flex-direction', 'column', 'important');
    el.style.setProperty('justify-content', 'center', 'important');
    el.style.setProperty('align-items', 'center', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    try {
      document.body.style.setProperty('background-color', '#f6f8fa', 'important');
    } catch (eBody) {}
    return true;
  }

  function finishBoot() {
    if (bootDone || window._openDeviceSettingsOnly) return;
    bootDone = true;
    window.__stelvioEarlyBootDone = true;
    window.__stelvioEarlyAuthShown = true;
    showAuthScreenEarly();
  }

  function scheduleRoute() {
    var elapsed = Date.now() - splashStartedAt;
    var wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(finishBoot, wait);
    setTimeout(function () {
      if (!bootDone && !window._openDeviceSettingsOnly) {
        finishBoot();
      }
    }, FAILSAFE_MS);
  }

  scheduleRoute();
})();
