/**
 * CYCLE 베이스캠프 화면 버튼·배경 아이콘 워치독.
 *
 * 버튼 아이콘은 CSS `background-image`로 그려지는데, <img>와 달리 background-image는
 * 로드가 실패해도 onerror 같은 감지·재시도 수단이 브라우저에 전혀 없다 — 모바일 데이터에서
 * 한 번이라도 요청이 실패(패킷 손실, DNS 지연, CDN 엣지 캐시 미스 등)하면 새로고침 전까지
 * 해당 아이콘은 영구히 빈 상태로 남는다. 이 모듈은 실제 <img>(Image()) 프로브로 로드 성공
 * 여부를 직접 확인하고, 실패 시 지수 백오프로 재시도하며, 성공하면 background-image를
 * 강제로 재적용(reflow)해 새로고침 없이 화면에 반영한다.
 *
 * URL은 CSS에서 그대로 읽어온다(getComputedStyle) — JS에 URL을 이중으로 하드코딩하지 않는다.
 */
(function () {
  'use strict';

  var TARGET_SELECTOR = '#basecampScreen .basecamp-btn, #basecampScreen .basecamp-background-image';
  var RETRY_DELAYS_MS = [1000, 3000, 8000, 20000];
  var MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

  function extractUrl(computedBg) {
    var m = /url\((['"]?)(.*?)\1\)/.exec(computedBg || '');
    return m && m[2] ? m[2] : null;
  }

  function forceRepaint(el, url) {
    el.style.setProperty('background-image', 'none', 'important');
    void el.offsetHeight; // 강제 reflow — 값이 문자열상 같아 보여도 재도색을 확실히 트리거한다
    el.style.setProperty('background-image', "url('" + url + "')", 'important');
  }

  function verify(el, attempt) {
    var state = el.__stelvioIconState || (el.__stelvioIconState = { token: 0, timer: null, pending: false, failed: false });
    if (state.pending) return;

    var url = extractUrl(getComputedStyle(el).backgroundImage);
    if (!url) return;

    // 첫 시도(attempt 0)는 원본 URL 그대로 — 정상 케이스에서 불필요한 강제 재요청을 피한다.
    // 재시도(attempt>=1)부터는 캐시 무효화 쿼리를 붙여, 실패가 캐시된 경우에도 실제 네트워크로 재시도한다.
    var probeUrl = attempt === 0 ? url : url + (url.indexOf('?') === -1 ? '?' : '&') + '_iconRetry=' + attempt + '_' + Date.now();

    // 새 검증 주기를 시작할 때마다 토큰을 올린다 — 이전에 예약된 재시도 타이머가 뒤늦게 실행되며
    // 이번 주기의 결과를 덮어쓰는 경쟁 상태(stale callback)를 막는다.
    var myToken = ++state.token;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.pending = true;
    var probe = new Image();
    probe.onload = function () {
      if (state.token !== myToken) return; // 이미 새 주기로 대체된 낡은 콜백
      state.pending = false;
      if (state.failed) {
        state.failed = false;
        forceRepaint(el, probeUrl);
      }
    };
    probe.onerror = function () {
      if (state.token !== myToken) return;
      state.pending = false;
      state.failed = true;
      if (attempt + 1 >= MAX_ATTEMPTS) return;
      state.timer = setTimeout(function () {
        verify(el, attempt + 1);
      }, RETRY_DELAYS_MS[attempt]);
    };
    probe.src = probeUrl;
  }

  function scan() {
    var screen = document.getElementById('basecampScreen');
    if (!screen) return;
    var els = document.querySelectorAll(TARGET_SELECTOR);
    for (var i = 0; i < els.length; i++) verify(els[i], 0);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scan);
    } else {
      scan();
    }
    window.addEventListener('online', scan);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') scan();
    });
  }

  init();
  window.stelvioBasecampIconWatchdog = { scan: scan };
})();
