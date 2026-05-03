/**
 * Pull-to-Refresh Blocker (STELVIO AI)
 * - CSS(overscroll-behavior-y)만으로 부족한 환경(iOS Bluefy 등) 대응
 * - 인증 화면: body 잠금 + #authScreen 요소에만 터치 차단 → 스크롤 유지, Pull-to-refresh만 차단
 *
 * 사용법:
 * 1) authScreen: enableForScreen('authScreen') + lockBodyScroll(true) → 요소 기준 차단, 내부 스크롤 가능
 * 2) app.js에서 다른 화면 추가: PULL_TO_REFRESH_BLOCKED_SCREENS에 ID만 추가
 * 3) 요소 직접 지정: enablePullToRefreshBlock(document.getElementById('myScreen')) → cleanup 반환
 * 4) 바깥 화면은 overflow:hidden·고정이고 실제 스크롤이 내부 #scrollArea 인 경우:
 *    nestedScrollRoots: ['#myScrollArea'] 를 넘겨 맨 위 판단 시 내부 scrollTop을 함께 봄 (아래로 당김 오차단 방지)
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

  /** primary(화면 루트) 아래에서만 선택 — 문서 앞쪽 다른 노드가 잡히면 scrollTop=0 오판 → 아래로 스크롤 전부 preventDefault 되는 문제 방지 */
  function resolveNestedElement(primaryEl, item) {
    if (item && typeof item === 'object' && item.nodeType === 1) return item;
    if (typeof item !== 'string') return null;
    if (primaryEl && primaryEl.querySelector) {
      try {
        var scoped = primaryEl.querySelector(item);
        if (scoped) return scoped;
      } catch (eQ) {}
    }
    try {
      return document.querySelector(item);
    } catch (eQ2) {
      return null;
    }
  }

  var PULL_DOWN_BLOCK_PX = 10;

  /**
   * primary가 맨 위(0)일 때 nestedScrollRoots 안 요소 중 하나라도 스크롤되어 있으면 "맨 위 아님"으로 취급
   * @param {Element} primaryEl
   * @param {Array<string|Element>|undefined} nestedScrollRoots
   * @returns {number} 0 이면 둘 다 맨 위 → PTR 차단 후보
   */
  function getEffectiveScrollTop(primaryEl, nestedScrollRoots) {
    var t = getScrollTop(primaryEl);
    if (t > 0) return t;
    if (!nestedScrollRoots || !nestedScrollRoots.length) return t;
    var i;
    for (i = 0; i < nestedScrollRoots.length; i++) {
      var nel = resolveNestedElement(primaryEl, nestedScrollRoots[i]);
      if (nel && getScrollTop(nel) > 0) return 1;
    }
    return t;
  }

  /**
   * Pull-to-refresh 차단 활성화
   * - 스크롤이 맨 위일 때만 아래로 당기는 터치를 막아 브라우저 새로고침 방지
   * @param {Element|string} elementOrSelector - 대상 DOM 요소 또는 CSS 선택자
   * @param {{ useCapture?: boolean, scrollElement?: Element, nestedScrollRoots?: Array<string|Element> }} options - useCapture: true면 document에 캡처 단계로 등록 (Bluefy 대응). scrollElement: 캡처 시 스크롤 위치 확인할 요소 (미지정 시 body). nestedScrollRoots: 실제 스크롤이 자식에만 있을 때 선택자/요소 목록
   * @returns {function} cleanup - 호출 시 리스너 제거
   */
  function enablePullToRefreshBlock(elementOrSelector, options) {
    var useDocumentCapture = options && options.useCapture === true;
    var scrollElement = options && options.scrollElement;
    var nestedScrollRoots = options && options.nestedScrollRoots;
    var target = useDocumentCapture ? document : (typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector);

    if (!target) {
      if (!useDocumentCapture) console.warn('[pullToRefreshBlocker] 요소를 찾을 수 없습니다:', elementOrSelector);
      return function noop() {};
    }

    var touchStartY = 0;
    var capture = useDocumentCapture;
    var elForScroll = useDocumentCapture ? (scrollElement || document.body) : target;

    function onTouchStart(e) {
      if (e.touches && e.touches.length) {
        touchStartY = e.touches[0].clientY;
      }
    }

    function onTouchMove(e) {
      if (!e.touches || !e.touches.length || !e.cancelable) return;
      var currentY = e.touches[0].clientY;
      var scrollTop = getEffectiveScrollTop(elForScroll, nestedScrollRoots);
      if (
        scrollTop <= 0 &&
        currentY > touchStartY + PULL_DOWN_BLOCK_PX
      ) {
        e.preventDefault();
      }
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
   * @param {string} screenId - 예: 'authScreen', 'basecampScreen'
   * @param {{ documentCapture?: boolean, nestedScrollRoots?: Array<string|Element> }} options - documentCapture: true면 document 캡처 단계로 등록, 해당 화면 요소의 scrollTop으로 판단 (iOS Bluefy 권장). nestedScrollRoots: 실제 세로 스크롤 루트가 자식인 경우
   * @returns {function|undefined} cleanup 또는 undefined(요소 없음)
   */
  function enableForScreen(screenId, options) {
    var el = document.getElementById(screenId);
    var nested = options && options.nestedScrollRoots;
    if (options && options.documentCapture && el) {
      return enablePullToRefreshBlock(document, { useCapture: true, scrollElement: el, nestedScrollRoots: nested });
    }
    if (options && options.documentCapture) {
      return enablePullToRefreshBlock(document, { useCapture: true, nestedScrollRoots: nested });
    }
    if (!el) return undefined;
    return enablePullToRefreshBlock(el, { nestedScrollRoots: nested });
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
