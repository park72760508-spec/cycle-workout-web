/**
 * 러닝 랭킹보드 — 모듈화된 라우팅·진입점
 */
(function () {
  'use strict';

  function getScreenId() {
    var cfg = window.runningRankingConfig;
    return (cfg && cfg.SCREEN_ID) || 'runningRankingScreen';
  }

  function openRunningRankingBoard() {
    var sid = getScreenId();
    if (typeof showScreen === 'function') {
      showScreen(sid);
    }
    if (typeof window.initRunningRankingReact === 'function') {
      setTimeout(function () { window.initRunningRankingReact({ forceRefresh: true }); }, 50);
    }
  }

  function closeRunningRankingBoard() {
    var sid = getScreenId();
    var el = document.getElementById(sid);
    if (el && el.classList.contains('active')) {
      if (typeof showScreen === 'function') showScreen('myCareerScreen', true);
    }
  }

  /** 허브 네비·베이스캠프 등 외부에서 등록할 진입 핸들러 */
  function registerRouteHandlers() {
    var entries = (window.runningRankingConfig && window.runningRankingConfig.ROUTE_ENTRIES) || {};
    if (entries.basecamp && entries.basecamp.buttonId) {
      var btn = document.getElementById(entries.basecamp.buttonId);
      if (btn && !btn.getAttribute('data-running-route-bound')) {
        btn.setAttribute('data-running-route-bound', '1');
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          openRunningRankingBoard();
        });
      }
    }
  }

  window.runningRankingRoutes = {
    open: openRunningRankingBoard,
    close: closeRunningRankingBoard,
    registerRouteHandlers: registerRouteHandlers,
    getScreenId: getScreenId
  };

  window.openRunningRankingBoard = openRunningRankingBoard;
  window.closeRunningRankingBoard = closeRunningRankingBoard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerRouteHandlers);
  } else {
    registerRouteHandlers();
  }
})();
