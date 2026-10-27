/**
 * 루트맵 현재 속도 추정기 (2026-10-27)
 *
 * 내비게이션 앱(카카오맵·네이버 지도)과 같은 방식:
 *  1) 1순위: 휴대폰 GPS 칩이 주는 도플러 속도(coords.speed). 위치를 미분한 값이 아니라 위성 신호의
 *     주파수 변화로 잰 속도라, 위치가 몇 m 흔들려도 저속(걷기 2~5km/h)까지 안정적이다.
 *  2) 2순위(도플러 속도가 없거나 정확도가 나쁠 때): 최근 8초 위치를 직선 회귀(최소제곱)한 속도.
 *     두 점 사이 거리보다 흔들림에 훨씬 덜 예민하다.
 *  3) 칼만 필터(속도 1차원): 측정 오차(정확도)에 따라 반영 비율을 자동 조절 → 급변 없이 부드럽게, 지연은 최소.
 *  4) 정지·출발 판정(히스테리시스): 멈추면 빠르게 0, 출발은 2번 연속(또는 빠른 속도 1번) 확인.
 *     한 번 낮게 잡힌 값으로 0 으로 떨어지지 않는다(예전 문제).
 *  5) 실내 보호: 정확도가 20m 보다 나쁘면 기기 속도는 믿지 않고, 6~10초 실제 이동 거리가 위치 오차보다 작으면 정지.
 *
 * 화면 바늘·숫자의 프레임 단위 부드러운 이동은 outdoorRide.js(바늘 애니메이션)가 맡는다.
 */
(function (root) {
  'use strict';

  var STOP_V = 0.25;    // m/s(≈0.9km/h) — 2번 연속 또는 최근 3번 평균이 이보다 낮으면 정지(한 번 낮게 잡힌 값으로는 정지 안 함)
  var HARD_STOP_V = 0.05; // 도플러 속도 사실상 0 → 바로 정지
  var GO_V = 0.5;       // m/s(≈1.8km/h) 이상 2번 연속(정확도 나쁘면 3번) → 출발
  var FAST_GO_V = 1.4;  // m/s(≈5km/h) 이상이면 1번에 출발
  var ACC_DEV_OK = 20;  // 이 정확도(m) 이내일 때만 기기 속도 사용
  var ACC_POS_OK = 35;  // 위치 회귀에 쓰는 최대 정확도(m)
  var HIST_MS = 10000;

  function hav(a, b, c, d) {
    var R = 6371000, toR = Math.PI / 180;
    var dLa = (c - a) * toR, dLo = (d - b) * toR;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /** 최근 위치들을 시간에 대해 직선 회귀 → 속도(m/s)와 그 오차 추정. 점 4개·4초 이상 필요 */
  function regressionSpeed(hist, now) {
    var pts = [];
    for (var i = 0; i < hist.length; i++) if (now - hist[i].t <= 8000) pts.push(hist[i]);
    if (pts.length < 4) return null;
    var span = (pts[pts.length - 1].t - pts[0].t) / 1000;
    if (span < 4) return null;
    var lat0 = pts[0].lat, lng0 = pts[0].lng, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    var n = pts.length, st = 0, sx = 0, sy = 0, accSum = 0;
    var T = [], X = [], Y = [];
    for (var j = 0; j < n; j++) {
      var tt = (pts[j].t - pts[0].t) / 1000, xx = (pts[j].lng - lng0) * kx, yy = (pts[j].lat - lat0) * ky;
      T.push(tt); X.push(xx); Y.push(yy); st += tt; sx += xx; sy += yy; accSum += pts[j].acc;
    }
    var tm = st / n, xm = sx / n, ym = sy / n, stt = 0, stx = 0, sty = 0;
    for (var k = 0; k < n; k++) { var dtt = T[k] - tm; stt += dtt * dtt; stx += dtt * (X[k] - xm); sty += dtt * (Y[k] - ym); }
    if (stt <= 0) return null;
    var vx = stx / stt, vy = sty / stt;
    var sigPos = Math.max(2, (accSum / n) * 0.5); // 정확도(약 68% 반경)의 절반 ≈ 축별 표준편차
    return { v: Math.sqrt(vx * vx + vy * vy), sigma: sigPos / Math.sqrt(stt) };
  }

  /** 6~10초 동안 실제 이동 거리가 위치 오차보다 작은지(실내 흔들림 판별) */
  function looksStill(hist, now) {
    if (!hist.length) return false;
    var base = null;
    for (var i = 0; i < hist.length; i++) if (now - hist[i].t >= 6000) { base = hist[i]; break; }
    if (!base) return false;
    var last = hist[hist.length - 1];
    var accM = (base.acc + last.acc) / 2;
    var noise = accM > 12 ? Math.min(30, accM * 0.85) : Math.max(5, accM * 0.5);
    return hav(base.lat, base.lng, last.lat, last.lng) < noise;
  }

  function create() {
    return { v: 0, P: 4, t: 0, moving: false, goN: 0, hist: [], zs: [] };
  }

  /**
   * GPS 위치 1개 반영 → 표시할 속도(km/h).
   * @param {object} s create() 로 만든 상태
   * @param {{lat:number,lng:number,acc:number,speed:(number|null),t:number}} fix  speed 는 m/s(없으면 null)
   */
  function step(s, fix) {
    var t = fix.t, acc = fix.acc != null ? fix.acc : 999;
    if (acc <= ACC_POS_OK) {
      s.hist.push({ t: t, lat: fix.lat, lng: fix.lng, acc: acc });
      while (s.hist.length && t - s.hist[0].t > HIST_MS) s.hist.shift();
    }
    var dev = fix.speed != null && isFinite(fix.speed) && fix.speed >= 0 && acc <= ACC_DEV_OK ? fix.speed : null;
    if (dev != null) s.lastDevT = t;
    // 기기 속도가 잠깐(5초 이내) 한두 번 빠진 것은 '측정 없음' — 위치 회귀·실내 정지 판정으로 넘어가지 않고 직전 값 유지
    if (dev == null && s.lastDevT && t - s.lastDevT < 5000) {
      s.t = t;
      return s.moving ? Math.max(0, s.v * 3.6) : 0;
    }
    var z = null, R = null;
    if (dev != null) {
      z = dev;
      var sd = 0.25 + 0.02 * acc; // 도플러 속도 오차(m/s): 정확도가 나쁠수록 크게
      R = sd * sd;
    } else if (acc <= ACC_POS_OK) {
      var rg = regressionSpeed(s.hist, t);
      if (rg) {
        // 정지해 있으면 회귀 속도는 흔들림 크기만큼 0 이 아닌 값(편향)이 나온다 → 오차만큼 빼서 보정
        z = Math.max(0, rg.v - 0.5 * rg.sigma);
        R = Math.max(0.04, rg.sigma * rg.sigma * 2);
      }
    }
    var dt = s.t ? Math.min(5, Math.max(0.2, (t - s.t) / 1000)) : 1;
    s.t = t;

    // 실내 보호: 정확도가 나쁜데(기기 속도 미사용) 실제로 거의 안 움직였으면 정지
    var still = dev == null && looksStill(s.hist, t);
    if (z == null && !still) return s.moving ? Math.max(0, s.v * 3.6) : 0; // 측정 없음 → 직전 값 유지

    var zz = still ? 0 : z;
    s.zs.push(zz); if (s.zs.length > 3) s.zs.shift();

    // 정지 / 출발 판정(히스테리시스)
    if (s.moving) {
      var avg3 = (s.zs[0] + s.zs[s.zs.length - 1] + s.zs[Math.floor(s.zs.length / 2)]) / 3;
      // 정지: 도플러 속도가 사실상 0(1번) · 낮은 값 2번 연속 · 최근 3번 평균이 낮음 중 하나 → 바로 0
      var hardStop = dev != null && zz <= HARD_STOP_V;
      var low2 = s.zs.length >= 2 && s.zs[s.zs.length - 1] < STOP_V && s.zs[s.zs.length - 2] < STOP_V;
      if (still || hardStop || low2 || (s.zs.length >= 3 && avg3 < STOP_V)) { s.moving = false; s.goN = 0; s.v = 0; s.P = 1; return 0; }
    } else {
      // 출발: 정확도가 좋으면 2번, 12m 보다 나쁘면(실내 가짜 속도 가능) 3번 연속 확인. 빠른 속도는 정확도 좋을 때 1번
      s.goN = zz >= GO_V ? s.goN + 1 : 0;
      var needGo = acc <= 12 ? 2 : 3;
      if ((zz >= FAST_GO_V && acc <= 12) || s.goN >= needGo) { s.moving = true; s.v = zz; s.P = R || 1; return zz * 3.6; }
      return 0;
    }

    // 칼만 필터(속도 1차원): 예측(가속 허용 ±0.7m/s²) → 측정 반영
    var q = 0.7 * dt; s.P += q * q;
    var K = s.P / (s.P + R);
    s.v = Math.max(0, s.v + K * (zz - s.v));
    s.P = (1 - K) * s.P;
    return s.v * 3.6;
  }

  root.OutdoorSpeedFilter = { create: create, step: step };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OutdoorSpeedFilter;
})(typeof window !== 'undefined' ? window : globalThis);
