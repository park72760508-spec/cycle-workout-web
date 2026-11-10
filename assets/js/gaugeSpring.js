/*
 * 속도계 바늘·파워 숫자 공용 스프링 (2026-11-10, 루트맵 outdoorRide.js 와 같은 방식)
 *  - 바늘(x): 시간 기반 임계감쇠 스프링 — 목표가 갑자기 바뀌어도 각속도가 연속이라 끊기지 않고 출렁임도 없음
 *  - 숫자(n): 목표까지 중간 정수를 빠짐없이 지나가는 시간당 속도 제한 카운터 (5→8 이면 5,6,7,8)
 *  표시용일 뿐 — 달성률·평균·기록 등 계산에는 쓰지 않고 원래 목표값(target)을 그대로 사용한다.
 */
(function (w) {
  function create(v0) { v0 = Number(v0) || 0; return { x: v0, v: 0, n: v0, ts: 0 }; }
  /** s: create() 상태, tgt: 실제 목표값, ts: rAF 시각(ms). 반환: s (s.x = 바늘 값, s.n = 숫자 값) */
  function step(s, tgt, ts, opt) {
    opt = opt || {};
    tgt = Number(tgt);
    if (!isFinite(tgt) || tgt < 0) tgt = 0;
    if (!isFinite(s.x)) s.x = tgt;
    if (!isFinite(s.v)) s.v = 0;
    if (!isFinite(s.n)) s.n = tgt;
    var now = isFinite(ts) ? ts : Date.now();
    var dtMs = s.ts ? Math.min(100, Math.max(1, now - s.ts)) : 16;
    s.ts = now;
    var om = tgt === 0 ? (opt.omegaZero || 10) : (opt.omega || 8);
    var rem = dtMs / 1000;
    while (rem > 0) {
      var h = Math.min(rem, 0.012);
      s.v += (om * om * (tgt - s.x) - 2 * om * s.v) * h;
      s.x += s.v * h;
      rem -= h;
    }
    if (s.x < 0) { s.x = 0; if (s.v < 0) s.v = 0; }
    var eps = opt.eps != null ? opt.eps : 0.1;
    if (Math.abs(tgt - s.x) <= eps && Math.abs(s.v) <= eps * 4) { s.x = tgt; s.v = 0; }
    var nd = tgt - s.n;
    if (Math.abs(nd) <= 0.05) s.n = tgt;
    else {
      var rate = Math.min(opt.maxRate || 300, Math.max(opt.minRate || 25, Math.abs(nd) * (opt.k || 4)));
      var st = rate * dtMs / 1000;
      s.n += Math.abs(nd) <= st ? nd : (nd > 0 ? st : -st);
    }
    return s;
  }
  /*
   * 안드로이드 WebView 보조 구동(2026-11-10): 프레임 신호(requestAnimationFrame)가 70ms 넘게 비면 33ms 타이머가 body 를 대신 실행.
   * id: 화면별 구분, body: 한 프레임 처리 함수(false 반환 시 중단), beat: 마지막 프레임 실행 시각(Date.now 기준) 반환 함수.
   */
  var timers = {};
  function fallback(id, body, beat) {
    if (timers[id]) return;
    timers[id] = setInterval(function () {
      var go = true;
      try {
        if (Date.now() - (Number(beat()) || 0) < 70 && !document.hidden) return; // 프레임 신호 정상
        go = body() !== false;
      } catch (e) {}
      if (!go) { clearInterval(timers[id]); timers[id] = null; }
    }, 33);
  }
  w.StelvioGaugeSpring = { create: create, step: step, fallback: fallback };
})(window);
