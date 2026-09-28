/**
 * 트래픽 절감(2026-09-28): 화면에 켜둔 채 방치된 탭의 백그라운드 폴링 정지.
 *
 * document.hidden 게이트는 최소화·백그라운드 탭만 막고, 화면에 보이는 채 방치된 PC 탭
 * (모니터가 꺼져 있어도 visible 로 남는 경우 포함)은 15~45초마다 계속 조회했다.
 * 마우스·키보드·터치·스크롤 입력이 IDLE_MS 동안 없으면 idle 로 보고, 폴링 쪽이
 * window.stelvioIsUserIdle() 로 확인해 건너뛴다. 다시 입력하면 'stelvio:user-resume' 이벤트를
 * 보내 즉시 갱신하게 한다. 로그인·화면 상태는 건드리지 않는다.
 */
(function (global) {
  'use strict';
  if (global.stelvioIsUserIdle) return;

  var IDLE_MS = 10 * 60 * 1000;
  var lastActiveAt = Date.now();
  var idle = false;

  function markActive() {
    lastActiveAt = Date.now();
    if (idle) {
      idle = false;
      try { global.dispatchEvent(new CustomEvent('stelvio:user-resume')); } catch (e) {}
    }
  }

  function isUserIdle() {
    if (!idle && Date.now() - lastActiveAt >= IDLE_MS) idle = true;
    return idle;
  }

  var opts = { passive: true, capture: true };
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (ev) {
    try { global.addEventListener(ev, markActive, opts); } catch (e) {}
  });
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') markActive();
    });
  } catch (e) {}

  global.stelvioIsUserIdle = isUserIdle;
  global.STELVIO_IDLE_MS = IDLE_MS;
})(typeof window !== 'undefined' ? window : this);
