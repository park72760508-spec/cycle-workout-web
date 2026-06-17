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

  function isRunBasecampAllowed() {
    if (typeof window !== 'undefined' && window.__TEMP_ADMIN_OVERRIDE__ === true) return true;
    var g =
      typeof getLoginUserGrade === 'function'
        ? getLoginUserGrade()
        : typeof getViewerGrade === 'function'
          ? getViewerGrade()
          : '2';
    return typeof isStelvioAdminGrade === 'function'
      ? isStelvioAdminGrade(g)
      : String(g).trim() === '1' || Number(g) === 1;
  }

  function showRunServiceComingSoonModal() {
    var modal = document.getElementById('runServiceComingSoonModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeRunServiceComingSoonModal() {
    var modal = document.getElementById('runServiceComingSoonModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    document.body.style.overflow = '';
  }

  function enterRunBasecamp() {
    if (!isRunBasecampAllowed()) {
      showRunServiceComingSoonModal();
      return;
    }
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

  /** CYCLE: 라이딩 기록 / RUN: Run 기록 */
  function openJournalForActiveSport() {
    if (getActiveSport() === 'run') {
      if (typeof showScreen === 'function') showScreen('runTrainingJournalScreen');
    } else if (typeof showScreen === 'function') {
      showScreen('trainingJournalScreen');
    }
  }

  /** RUN + 일반 회원(grade≠1): 하단 네비「마이」대신 환경설정 상단에 프로필 카드 표시 */
  function shouldShowSettingsProfileCard() {
    if (getActiveSport() !== 'run') return false;
    var g =
      typeof getLoginUserGrade === 'function'
        ? String(getLoginUserGrade())
        : typeof getViewerGrade === 'function'
          ? String(getViewerGrade())
          : '2';
    return typeof window.isStelvioAdminGrade === 'function'
      ? !window.isStelvioAdminGrade(g)
      : String(g).trim() !== '1' && Number(g) !== 1;
  }

  window.sportCategoryRoutes = {
    getActiveSport: getActiveSport,
    setActiveSport: setActiveSport,
    showSportCategoryScreen: showSportCategoryScreen,
    enterCycleBasecamp: enterCycleBasecamp,
    enterRunBasecamp: enterRunBasecamp,
    goHomeBasecamp: goHomeBasecamp,
    routeAfterAuth: routeAfterAuth,
    getHomeScreenId: getHomeScreenId,
    openJournalForActiveSport: openJournalForActiveSport,
    shouldShowSettingsProfileCard: shouldShowSettingsProfileCard
  };

  window.enterCycleBasecamp = enterCycleBasecamp;
  window.enterRunBasecamp = enterRunBasecamp;
  window.showSportCategoryScreen = showSportCategoryScreen;
  window.routeAfterAuth = routeAfterAuth;
  window.goHomeBasecamp = goHomeBasecamp;
  window.openJournalForActiveSport = openJournalForActiveSport;
  window.shouldShowSettingsProfileCard = shouldShowSettingsProfileCard;
  window.showRunServiceComingSoonModal = showRunServiceComingSoonModal;
  window.closeRunServiceComingSoonModal = closeRunServiceComingSoonModal;
})();
