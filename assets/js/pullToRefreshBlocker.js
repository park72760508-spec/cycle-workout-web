/**
 * Pull-to-Refresh Blocker (STELVIO AI)
 * - CSS(overscroll-behavior-y)만으로 부족한 환경(iOS Bluefy 등) 대응
 * - 특정 화면에서만 활성화/해제 가능한 재사용 유틸
 *
 * 사용법:
 * 1) 화면 ID로 한 줄 적용: enableForScreen('authScreen') → cleanup 반환
 * 2) iOS Bluefy 등 강한 차단: enableForScreen('authScreen', { documentCapture: true }) + lockBodyScroll(true)
 * 3) app.js에서 다른 화면 추가: PULL_TO_REFRESH_BLOCKED_SCREENS에 ID만 추가
 * 4) 요소 직접 지정: enablePullToRefreshBlock(document.getElementById('myScreen')) → cleanup 반환
 */

(function (global) {
  'use strict';

  var BODY_LOCK_CLASS = 'body-pull-to-refresh-lock';

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
   * @param {{ useCapture?: boolean }} options - useCapture: true면 document에 캡처 단계로 등록 (Bluefy 대응)
   * @returns {function} cleanup - 호출 시 리스너 제거
   */
  function enablePullToRefreshBlock(elementOrSelector, options) {
    var useDocumentCapture = options && options.useCapture === true;
    var target = useDocumentCapture ? document : (typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector);

    if (!target) {
      if (!useDocumentCapture) console.warn('[pullToRefreshBlocker] 요소를 찾을 수 없습니다:', elementOrSelector);
      return function noop() {};
    }

    var touchStartY = 0;
    var capture = useDocumentCapture;

    function onTouchStart(e) {
      if (e.touches && e.touches.length) {
        touchStartY = e.touches[0].clientY;
      }
    }

    function onTouchMove(e) {
      if (!e.touches || !e.touches.length) return;
      var currentY = e.touches[0].clientY;
      var scrollTop = useDocumentCapture
        ? getScrollTop(document.body)
        : getScrollTop(target);
      if (scrollTop <= 0 && currentY > touchStartY) {
        e.preventDefault();
        e.stopPropagation();
      }
      touchStartY = currentY;
    }

    target.addEventListener('touchstart', onTouchStart, { passive: true, capture: capture });
    target.addEventListener('touchmove', onTouchMove, { passive: false, capture: capture });

    return function cleanup() {
      target.removeEventListener('touchstart', onTouchStart, capture);
      target.removeEventListener('touchmove', onTouchMove, capture);
    };
  }

  /**
   * 화면 ID로 Pull-to-refresh 차단 활성화 (한 줄로 적용용)
   * @param {string} screenId - 예: 'authScreen', 'trainingScreen'
   * @param {{ documentCapture?: boolean }} options - documentCapture: true면 document 캡처 단계로 등록 (iOS Bluefy 권장)
   * @returns {function|undefined} cleanup 또는 undefined(요소 없음)
   */
  function enableForScreen(screenId, options) {
    if (options && options.documentCapture) {
      return enablePullToRefreshBlock(document, { useCapture: true });
    }
    var el = document.getElementById(screenId);
    if (!el) return undefined;
    return enablePullToRefreshBlock(el);
  }

  /**
   * body 스크롤 잠금 (window 레벨 overscroll 제거 → Bluefy 등 네이티브 Pull-to-refresh 무력화)
   * 인증 화면 등에서 true, 화면 이탈 시 false 호출.
   * @param {boolean} lock - true: 잠금, false: 해제
   */
  function lockBodyScroll(lock) {
    if (typeof document === 'undefined' || !document.body) return;
    if (lock) {
      document.body.classList.add(BODY_LOCK_CLASS);
    } else {
      document.body.classList.remove(BODY_LOCK_CLASS);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { enablePullToRefreshBlock: enablePullToRefreshBlock, enableForScreen: enableForScreen, lockBodyScroll: lockBodyScroll };
  } else {
    global.enablePullToRefreshBlock = enablePullToRefreshBlock;
    global.enableForScreen = enableForScreen;
    global.lockBodyScroll = lockBodyScroll;
  }
})(typeof window !== 'undefined' ? window : this);
