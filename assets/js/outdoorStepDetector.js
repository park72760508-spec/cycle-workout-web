/**
 * 루트맵 걸음 감지기 (2026-10-27) — 휴대폰 가속도 센서(devicemotion)로 걸음을 센다.
 *
 * 내비 앱이 운영체제 만보계로 하는 "걷는 중 / 멈춤" 판단을 웹에서 직접 한다:
 *  - 가속도 크기에서 중력(느린 평균)을 빼고, 짧은 평균으로 잔떨림을 줄인 뒤
 *  - 적응형 문턱값을 넘는 봉우리를 걸음 1번으로 센다(걸음 사이 0.28~2초만 인정).
 *  - 최근 걸음 간격이 규칙적이면 '걷는 중'.
 * 아이폰은 기록 시작 버튼을 누를 때 requestPermission() 으로 '동작 및 방향' 권한을 받아야 한다.
 */
(function (root) {
  'use strict';

  var MIN_STEP_MS = 280;   // 이보다 빠른 봉우리는 같은 걸음의 흔들림
  var MAX_STEP_MS = 2000;  // 이보다 긴 간격은 연속 걸음이 아님
  var KEEP_MS = 60000;

  function createCore() {
    return {
      g: null, lp: 0, prevLp: 0, rising: false, peakVal: 0, peakT: 0,
      thr: 0.6, peaks: [], steps: [], lastT: 0, samples: 0, walkSeenT: 0
    };
  }

  /** 가속도 표본 1개(m/s², 중력 포함 크기) 처리 → 걸음이면 true */
  function feed(c, mag, t) {
    c.samples++;
    var dt = c.lastT ? Math.min(0.2, Math.max(0.005, (t - c.lastT) / 1000)) : 0.016;
    c.lastT = t;
    if (c.g == null) c.g = mag;
    c.g += (mag - c.g) * Math.min(1, dt / 1.0);       // 중력 성분(약 1초 평균)
    var dyn = mag - c.g;
    c.lp += (dyn - c.lp) * Math.min(1, dt / 0.06);    // 잔떨림 제거(약 0.06초)
    var stepped = false;
    if (c.lp > c.prevLp) {
      if (!c.rising) { c.rising = true; c.peakVal = c.lp; c.peakT = t; }
      if (c.lp > c.peakVal) { c.peakVal = c.lp; c.peakT = t; }
    } else if (c.rising && c.lp < c.prevLp) {
      c.rising = false;
      var last = c.steps.length ? c.steps[c.steps.length - 1] : 0;
      if (c.peakVal >= c.thr && c.peakT - last >= MIN_STEP_MS) {
        c.steps.push(c.peakT);
        stepped = true;
        c.peaks.push(c.peakVal);
        if (c.peaks.length > 8) c.peaks.shift();
        // 적응형 문턱값: 최근 봉우리 세기의 45%(최소 0.5, 최대 3 m/s²)
        var avg = 0; for (var i = 0; i < c.peaks.length; i++) avg += c.peaks[i];
        avg /= c.peaks.length;
        c.thr = Math.min(3, Math.max(0.5, avg * 0.45));
      }
    }
    c.prevLp = c.lp;
    while (c.steps.length && t - c.steps[0] > KEEP_MS) c.steps.shift();
    // 오래 걸음이 없으면 문턱값을 기본으로 되돌림(다시 걷기 시작할 때 놓치지 않게)
    if (c.steps.length && t - c.steps[c.steps.length - 1] > 4000) { c.thr = 0.6; c.peaks = []; }
    return stepped;
  }

  /** 현재 걸음 상태 */
  function stateOf(c, now, active) {
    var s = c.steps, n = s.length;
    var lastAgo = n ? now - s[n - 1] : Infinity;
    // 최근 6초 걸음 간격(규칙적인 것만)으로 분당 걸음 수
    var recent = [];
    for (var i = n - 1; i > 0 && now - s[i] <= 6000; i--) {
      var iv = s[i] - s[i - 1];
      if (iv >= MIN_STEP_MS && iv <= MAX_STEP_MS) recent.push(iv);
    }
    // 규칙성: 실제 걸음은 간격이 일정(최근 4간격 이상, 변동계수 20% 미만)하고 초당 1~3걸음. 자전거 노면 진동은 불규칙해서 걸러진다
    var cadence = 0, regular = false;
    if (recent.length >= 4) {
      var sum = 0; for (var j = 0; j < recent.length; j++) sum += recent[j];
      var mean = sum / recent.length, vs = 0;
      for (var q = 0; q < recent.length; q++) vs += (recent[q] - mean) * (recent[q] - mean);
      var cv = Math.sqrt(vs / recent.length) / mean;
      regular = cv < 0.2 && mean >= 330 && mean <= 1000;
      if (regular) cadence = 60000 / mean;
    }
    var walkingNow = regular && lastAgo < 1500;
    if (walkingNow) c.walkSeenT = now;
    return {
      available: !!active && c.samples > 20,
      walkingNow: walkingNow,
      lastStepAgo: lastAgo,
      cadence: cadence,
      // 최근 1분 안에 규칙적으로 걸었는지(걷기 중이라는 맥락 — 이때만 '걸음 멈춤 = 정지'를 쓴다)
      walkContext: c.walkSeenT > 0 && now - c.walkSeenT <= 60000
    };
  }

  // ---- 브라우저 연결 ----
  var core = createCore(), active = false, handler = null;

  function onMotion(e) {
    var a = e && (e.accelerationIncludingGravity || e.acceleration);
    if (!a || a.x == null) return;
    var mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (!isFinite(mag)) return;
    feed(core, mag, (e.timeStamp && e.timeStamp > 1e12 ? e.timeStamp : Date.now()));
  }

  /** 기록 시작 버튼(사용자 터치) 안에서 불러야 아이폰 권한 창이 뜬다. Promise<boolean> */
  function start() {
    if (active) return Promise.resolve(true);
    if (typeof window === 'undefined' || typeof window.DeviceMotionEvent === 'undefined') return Promise.resolve(false);
    var go = function () {
      handler = onMotion;
      window.addEventListener('devicemotion', handler, { passive: true });
      active = true;
      return true;
    };
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        return DeviceMotionEvent.requestPermission().then(function (r) { return r === 'granted' ? go() : false; }, function () { return false; });
      }
    } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(go());
  }
  function stop() {
    if (handler) window.removeEventListener('devicemotion', handler);
    handler = null; active = false; core = createCore();
  }

  root.OutdoorStepDetector = {
    start: start,
    stop: stop,
    state: function () { return stateOf(core, Date.now(), active); },
    stepTimes: function () { return core.steps.slice(); },
    // 시험용(node)
    _createCore: createCore, _feed: feed, _stateOf: stateOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OutdoorStepDetector;
})(typeof window !== 'undefined' ? window : globalThis);
