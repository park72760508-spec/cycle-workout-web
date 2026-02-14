/**
 * Pull-to-Refresh Blocker (STELVIO AI)
 * - CSS(overscroll-behavior-y)만으로 부족한 환경(iOS Bluefy 등) 대응
 * - 특정 화면에서만 활성화/해제 가능한 재사용 유틸
 *
 * 사용법:
 * 1) 화면 ID로 한 줄 적용: enableForScreen('authScreen') → cleanup 반환
 * 2) app.js에서 다른 화면 추가: PULL_TO_REFRESH_BLOCKED_SCREENS에 ID만 추가 (예: 'trainingScreen')
 * 3) 요소 직접 지정: enablePullToRefreshBlock(document.getElementById('myScreen')) → cleanup 반환
 */

(function (global) {
  'use strict';

  /**
   * 요소의 현재 스크롤 위치(맨 위=0) 반환
   * @param {Element} el - 대상 요소 (body/documentElement이면 문서 스크롤)
   * @returns {number}
   */
  function getScrollTop(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return (document.documentElement && document.documentElement.scrollTop) || document.body.scrollTop || 0;
    }
    return el.scrollTop || 0;
  }

  /**
   * Pull-to-refresh 차단 활성화
   * - 스크롤이 맨 위일 때만 아래로 당기는 터치를 막아 브라우저 새로고침 방지
   * @param {Element|string} elementOrSelector - 대상 DOM 요소 또는 CSS 선택자
   * @returns {function} cleanup - 호출 시 리스너 제거
   */
  function enablePullToRefreshBlock(elementOrSelector) {
    var el = typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;

    if (!el) {
      console.warn('[pullToRefreshBlocker] 요소를 찾을 수 없습니다:', elementOrSelector);
      return function noop() {};
    }

    var touchStartY = 0;

    function onTouchStart(e) {
      if (e.touches && e.touches.length) {
        touchStartY = e.touches[0].clientY;
      }
    }

    function onTouchMove(e) {
      if (!e.touches || !e.touches.length) return;
      var currentY = e.touches[0].clientY;
      var scrollTop = getScrollTop(el);
      if (scrollTop <= 0 && currentY > touchStartY) {
        e.preventDefault();
      }
      touchStartY = currentY;
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });

    return function cleanup() {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }

  /**
   * 화면 ID로 Pull-to-refresh 차단 활성화 (한 줄로 적용용)
   * @param {string} screenId - 예: 'authScreen', 'trainingScreen'
   * @returns {function|undefined} cleanup 또는 undefined(요소 없음)
   */
  function enableForScreen(screenId) {
    var el = document.getElementById(screenId);
    if (!el) return undefined;
    return enablePullToRefreshBlock(el);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { enablePullToRefreshBlock: enablePullToRefreshBlock, enableForScreen: enableForScreen };
  } else {
    global.enablePullToRefreshBlock = enablePullToRefreshBlock;
    global.enableForScreen = enableForScreen;
  }
})(typeof window !== 'undefined' ? window : this);
