/**
 * STELVIO 조기 부트 — app.js(본문 하단) 로드 전 스플래시 → 인증/베이스캠프 전환
 * Android·iOS WebView: HTML 전체 파싱(10초+)을 기다리지 않고 authScreen DOM 직후 실행
 */
(function stelvioBootEarly() {
  'use strict';

  if (window._openDeviceSettingsOnly) return;

  var SPLASH_MIN_MS = 380;
  var FAILSAFE_MS = 2800;
  var BASECAMP_POLL_MS = 40;
  var BASECAMP_POLL_MAX = 240;
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

  function showScreenEarly(screenId) {
    dismissSplashEarly();
    hideOtherScreens(screenId);
    var el = document.getElementById(screenId);
    if (!el) return false;
    el.classList.add('active');
    if (screenId === 'authScreen') {
      el.style.setProperty('display', 'flex', 'important');
      el.style.setProperty('flex-direction', 'column', 'important');
      el.style.setProperty('justify-content', 'center', 'important');
      el.style.setProperty('align-items', 'center', 'important');
    } else {
      el.style.setProperty('display', 'block', 'important');
    }
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    return true;
  }

  function hasLocalSessionHint() {
    try {
      if (window.currentUser && (window.currentUser.id != null || window.currentUser.uid != null)) {
        return true;
      }
      var keys = ['authUser', 'currentUser'];
      var i;
      for (i = 0; i < keys.length; i++) {
        var u = JSON.parse(localStorage.getItem(keys[i]) || 'null');
        if (!u || (u.id == null && u.uid == null)) continue;
        if (u.withdrawn === true || u.isWithdrawn === true) continue;
        return true;
      }
    } catch (eHint) {}
    return false;
  }

  function finishBoot(screenId) {
    bootDone = true;
    window.__stelvioEarlyBootDone = true;
    if (screenId === 'authScreen') {
      window.__stelvioEarlyAuthShown = true;
    } else if (screenId === 'basecampScreen') {
      window.__stelvioEarlyBasecampShown = true;
    }
    try {
      document.body.style.setProperty('background-color', '#f6f8fa', 'important');
    } catch (eBody) {}
  }

  function routeToBasecampOrAuth() {
    if (bootDone || window._openDeviceSettingsOnly) return;

    if (!hasLocalSessionHint()) {
      if (showScreenEarly('authScreen')) {
        finishBoot('authScreen');
      }
      return;
    }

    if (showScreenEarly('basecampScreen')) {
      finishBoot('basecampScreen');
      return;
    }

    var tries = 0;
    var poll = setInterval(function () {
      tries += 1;
      if (showScreenEarly('basecampScreen')) {
        clearInterval(poll);
        finishBoot('basecampScreen');
        return;
      }
      if (tries >= BASECAMP_POLL_MAX) {
        clearInterval(poll);
        if (showScreenEarly('authScreen')) {
          finishBoot('authScreen');
        }
      }
    }, BASECAMP_POLL_MS);
  }

  function scheduleRoute() {
    var elapsed = Date.now() - splashStartedAt;
    var wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(routeToBasecampOrAuth, wait);
    setTimeout(function () {
      if (!bootDone && !window._openDeviceSettingsOnly) {
        routeToBasecampOrAuth();
      }
    }, FAILSAFE_MS);
  }

  scheduleRoute();
})();
