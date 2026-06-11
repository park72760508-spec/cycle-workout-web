/**
 * 스포츠 카테고리(CYCLE/RUN) → 베이스캠프 라우팅
 */
(function () {
  'use strict';

  var SPORT_KEY = 'stelvioActiveSport';

  function getActiveSport() {
    if (window.__stelvioActiveSport === 'run' || window.__stelvioActiveSport === 'cycle') {
      return window.__stelvioActiveSport;
    }
    try {
      var s = sessionStorage.getItem(SPORT_KEY);
      if (s === 'run' || s === 'cycle') return s;
    } catch (e) {}
    return 'cycle';
  }

  function setActiveSport(sport) {
    var s = sport === 'run' ? 'run' : 'cycle';
    window.__stelvioActiveSport = s;
    try {
      sessionStorage.setItem(SPORT_KEY, s);
    } catch (e2) {}
  }

  function showSportCategoryScreen() {
    if (typeof showScreen === 'function') showScreen('sportCategoryScreen');
  }

  function enterCycleBasecamp() {
    setActiveSport('cycle');
    if (typeof showScreen === 'function') showScreen('basecampScreen');
  }

  function enterRunBasecamp() {
    setActiveSport('run');
    if (typeof showScreen === 'function') showScreen('runBasecampScreen');
  }

  /** 하단 네비 홈 — 선택한 스포츠 베이스캠프 */
  function goHomeBasecamp() {
    if (getActiveSport() === 'run') enterRunBasecamp();
    else enterCycleBasecamp();
  }

  /** 인증 완료·앱 셸 진입 시 카테고리 화면 */
  function routeAfterAuth() {
    showSportCategoryScreen();
  }

  function getHomeScreenId() {
    return getActiveSport() === 'run' ? 'runBasecampScreen' : 'basecampScreen';
  }

  window.sportCategoryRoutes = {
    getActiveSport: getActiveSport,
    setActiveSport: setActiveSport,
    showSportCategoryScreen: showSportCategoryScreen,
    enterCycleBasecamp: enterCycleBasecamp,
    enterRunBasecamp: enterRunBasecamp,
    goHomeBasecamp: goHomeBasecamp,
    routeAfterAuth: routeAfterAuth,
    getHomeScreenId: getHomeScreenId
  };

  window.enterCycleBasecamp = enterCycleBasecamp;
  window.enterRunBasecamp = enterRunBasecamp;
  window.showSportCategoryScreen = showSportCategoryScreen;
  window.routeAfterAuth = routeAfterAuth;
  window.goHomeBasecamp = goHomeBasecamp;
})();
