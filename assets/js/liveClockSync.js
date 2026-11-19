/**
 * 그룹훈련 공용 경과·랩 시간 보간 시계 (2026-11-19)
 *
 * 문제: 참석자 화면·휴대폰 Coach 는 호스트(PC Coach)가 1초마다 보내는 elapsedTime 을 "받는 순간" 그대로 표시했다.
 *       네트워크 지연·REST 폴백·메인 스레드 지연으로 메시지 도착 간격이 흔들리면 화면이 1→2→3초씩 불규칙하게 뛴다.
 * 해결: 메시지는 "시계를 맞추는 기준점"으로만 쓰고, 표시는 로컬 단조 시계(performance.now)로 매끄럽게 1초씩 진행.
 *       NTP 방식 — 메시지마다 (호스트 경과 − 도착 시각) 오프셋을 구하고, 최근 N개 중 최대값(= 지연이 가장 적었던 메시지)을 채택.
 *       오차가 크면(재시작·점프) 즉시 재동기화, 표시값은 역행하지 않는다.
 */
(function (g) {
  'use strict';
  var WIN_MS = 40000, WIN_N = 30, RESYNC_SEC = 2.5;
  function nowSec() { return (g.performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function Clock() { this.reset(); }
  Clock.prototype.reset = function () {
    this.win = []; this.o = null; this.lastOut = -1; this.segIdx = null; this.segStart = null; this.running = false; this.lastE = null; this.disp = null; this.dispT = null;
  };
  /** status: { state, elapsedTime, segmentIndex, segmentElapsedSec } — 호스트가 게시한 값 */
  Clock.prototype.feed = function (status) {
    if (!status) return;
    var running = status.state === 'running';
    var E = Number(status.elapsedTime);
    if (!running || !isFinite(E)) { this.running = false; if (!running) { this.win = []; this.o = null; this.lastOut = -1; } return; }
    var t = nowSec();
    if (this.lastE != null && E < this.lastE) {
      if (E >= this.lastE - 8) return; // 순서가 뒤바뀌어 늦게 도착한 옛 메시지 — 무시
      this.win = []; this.lastOut = -1; this.segIdx = null; this.disp = null; // 재시작(경과가 크게 줄어듦)
    }
    this.lastE = E;
    this.running = true;
    this.win.push({ v: E - t, t: t });
    while (this.win.length > WIN_N || (this.win.length > 1 && t - this.win[0].t > WIN_MS / 1000)) this.win.shift();
    var o = -Infinity;
    for (var i = 0; i < this.win.length; i++) if (this.win[i].v > o) o = this.win[i].v;
    // 호스트가 예측보다 크게 앞서면(점프·시계 이상) 즉시 재동기화. 메시지가 늦게 온 경우(예측이 앞섬)는 무시 — 지연일 뿐이다
    if (this.o != null && E - (t + this.o) > RESYNC_SEC) { this.win = [{ v: E - t, t: t }]; o = E - t; this.lastOut = -1; this.disp = null; }
    this.o = o;
    // 구간 시작 시점의 전체 경과(구간 내 경과 보간용)
    var idx = status.segmentIndex;
    var se = Number(status.segmentElapsedSec);
    if (isFinite(se)) {
      var ss = E - se;
      if (this.segIdx !== idx || this.segStart == null || Math.abs(ss - this.segStart) > 1.5) { this.segStart = ss; this.segIdx = idx; }
    } else { this.segStart = null; this.segIdx = idx; }
  };
  Clock.prototype.ready = function () { return this.running && this.o != null; };
  /** 전체 경과(초, 소수) — 기준(목표)보다 뒤처지면 25% 빠르게, 앞서면 25% 느리게 따라가며(슬루) 점프 없이 수렴 */
  Clock.prototype.elapsedFloat = function () {
    var t = nowSec(), target = t + this.o;
    if (this.disp == null) { this.disp = target; this.dispT = t; return this.disp; }
    var dt = t - this.dispT;
    if (dt > 0) {
      var diff = target - this.disp;
      if (Math.abs(diff) > RESYNC_SEC) this.disp = target;
      else if (diff > 0.02) this.disp += Math.min(diff, dt * 1.25);
      else if (diff < -0.02) this.disp = Math.max(target, this.disp + dt * 0.75); // 앞서 있으면 느리게
      else this.disp = target;
      this.dispT = t;
    }
    return this.disp;
  };
  /** 표시용 전체 경과(정수 초, 단조 증가) */
  Clock.prototype.elapsed = function () {
    if (!this.ready()) return null;
    var v = Math.floor(this.elapsedFloat() + 1e-6);
    if (v < this.lastOut && this.lastOut - v < 3) v = this.lastOut;
    this.lastOut = v;
    return v;
  };
  /** 표시용 구간 내 경과(정수 초) — 구간 정보가 없으면 null */
  Clock.prototype.segElapsed = function () {
    if (!this.ready() || this.segStart == null) return null;
    return Math.max(0, Math.floor(this.elapsedFloat() - this.segStart + 1e-6));
  };
  g.StelvioLiveClock = Clock;
})(window);
