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

  function isCycleSportActive() {
    return getActiveSport() === 'cycle';
  }

  /** CYCLE 주간 마일리지 TOP10 — RUN 베이스캠프·카테고리 화면에서는 자동 표시하지 않음 */
  function shouldAutoShowCycleWeeklyTop10Modal() {
    return isCycleSportActive();
  }

  function showSportCategoryScreen() {
    if (typeof showScreen === 'function') showScreen('sportCategoryScreen');
  }

  function enterCycleBasecamp() {
    setActiveSport('cycle');
    if (typeof showScreen === 'function') showScreen('basecampScreen');
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
    setActiveSport('run');
    try {
      window.__basecampShownAfterAuth = false;
      window.__deferWeeklyTop10UntilIntegratedDismiss = false;
    } catch (eRunTop) {}
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

  /** 오픈 라이딩·러닝 크루 — 베이스캠프 진입 카테고리 (세션 유지) */
  function setOpenRidingMoimCategory(category) {
    var c = String(category || '').trim().toUpperCase() === 'RUN' ? 'RUN' : 'CYCLE';
    window.__openRidingMoimCategory = c;
    if (c === 'RUN') setActiveSport('run');
    else setActiveSport('cycle');
    return c;
  }

  function resolveOpenRidingMoimCategory() {
    try {
      var pinned = String(window.__openRidingMoimCategory || '').trim().toUpperCase();
      if (pinned === 'RUN' || pinned === 'CYCLE') return pinned;
    } catch (ePin) {}
    return getActiveSport() === 'run' ? 'RUN' : 'CYCLE';
  }

  /** CYCLE 베이스캠프 → 라이딩 모임 */
  function navigateToRidingMoimFromBasecamp() {
    setOpenRidingMoimCategory('CYCLE');
    try {
      window.__rideMoimIntroFromBasecampPending = true;
    } catch (eIntro) {}
    if (typeof showScreen === 'function') showScreen('openRidingRoomScreen');
  }

  /** RUN 베이스캠프 → 러닝 크루 (동일 화면, RUN UI) */
  function navigateToRunCrewFromBasecamp() {
    setOpenRidingMoimCategory('RUN');
    if (typeof showScreen === 'function') showScreen('openRidingRoomScreen');
  }

  /** RUN 베이스캠프 → 대시보드(분석) */
  function openRunDashboardFromBasecamp() {
    setActiveSport('run');
    if (typeof showScreen === 'function') showScreen('runDashboardScreen');
  }

  /** CYCLE 베이스캠프 → 대시보드(분석) */
  function openCycleDashboardFromBasecamp() {
    setActiveSport('cycle');
    if (typeof showScreen === 'function') showScreen('performanceDashboardScreen');
  }

  /** 모임 화면 홈 버튼 — 진입 카테고리 기준 베이스캠프 */
  function goOpenRidingMoimHomeBasecamp() {
    if (resolveOpenRidingMoimCategory() === 'RUN') enterRunBasecamp();
    else enterCycleBasecamp();
  }

  /** CYCLE·RUN 공통: 환경설정 상단에 로그인 본인 프로필 카드 표시 (관리자·일반 회원 공통) */
  function shouldShowSettingsProfileCard() {
    return true;
  }

  window.sportCategoryRoutes = {
    getActiveSport: getActiveSport,
    setActiveSport: setActiveSport,
    isCycleSportActive: isCycleSportActive,
    shouldAutoShowCycleWeeklyTop10Modal: shouldAutoShowCycleWeeklyTop10Modal,
    showSportCategoryScreen: showSportCategoryScreen,
    enterCycleBasecamp: enterCycleBasecamp,
    enterRunBasecamp: enterRunBasecamp,
    goHomeBasecamp: goHomeBasecamp,
    routeAfterAuth: routeAfterAuth,
    getHomeScreenId: getHomeScreenId,
    openJournalForActiveSport: openJournalForActiveSport,
    setOpenRidingMoimCategory: setOpenRidingMoimCategory,
    resolveOpenRidingMoimCategory: resolveOpenRidingMoimCategory,
    navigateToRidingMoimFromBasecamp: navigateToRidingMoimFromBasecamp,
    navigateToRunCrewFromBasecamp: navigateToRunCrewFromBasecamp,
    openRunDashboardFromBasecamp: openRunDashboardFromBasecamp,
    openCycleDashboardFromBasecamp: openCycleDashboardFromBasecamp,
    goOpenRidingMoimHomeBasecamp: goOpenRidingMoimHomeBasecamp,
    shouldShowSettingsProfileCard: shouldShowSettingsProfileCard
  };

  window.enterCycleBasecamp = enterCycleBasecamp;
  window.enterRunBasecamp = enterRunBasecamp;
  window.showSportCategoryScreen = showSportCategoryScreen;
  window.stelvioShouldAutoShowCycleWeeklyTop10Modal = shouldAutoShowCycleWeeklyTop10Modal;
  window.routeAfterAuth = routeAfterAuth;
  window.goHomeBasecamp = goHomeBasecamp;
  window.openJournalForActiveSport = openJournalForActiveSport;
  window.setOpenRidingMoimCategory = setOpenRidingMoimCategory;
  window.resolveOpenRidingMoimCategory = resolveOpenRidingMoimCategory;
  window.navigateToRidingMoimFromBasecamp = navigateToRidingMoimFromBasecamp;
  window.navigateToRunCrewFromBasecamp = navigateToRunCrewFromBasecamp;
  window.openRunDashboardFromBasecamp = openRunDashboardFromBasecamp;
  window.openCycleDashboardFromBasecamp = openCycleDashboardFromBasecamp;
  window.goOpenRidingMoimHomeBasecamp = goOpenRidingMoimHomeBasecamp;
  window.shouldShowSettingsProfileCard = shouldShowSettingsProfileCard;
  window.showRunServiceComingSoonModal = showRunServiceComingSoonModal;
  window.closeRunServiceComingSoonModal = closeRunServiceComingSoonModal;
})();
