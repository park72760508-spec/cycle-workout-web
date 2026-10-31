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
    return { v: 0, a: 0, P: 4, P00: 1, P01: 0, P11: 1, t: 0, moving: false, goN: 0, hist: [], zs: [], mode: null };
  }

  /**
   * GPS 위치 1개 반영 → 표시할 속도(km/h).
   * @param {object} s create() 로 만든 상태
   * @param {{lat:number,lng:number,acc:number,speed:(number|null),t:number}} fix  speed 는 m/s(없으면 null)
   */
  var WALK_MAX_V = 2.0;  // m/s(≈7.2km/h) 미만에서만 걸음 정보를 쓴다(자전거 노면 진동 오판 방지)
  var STRIDE_M = 0.7;    // 걸음 수만 있을 때 보폭 가정(m)

  /*
   * 걸음 정보로 본 판단: 'walk'(걷는 중) | 'stopped'(걷다가 멈춤) | null(판단 안 함)
   * 2026-10-29 실측(아이폰·플립 걷기 로그): GPS 도플러 속도가 4~6km/h 인데도 걸음 신호가 1.8초 끊기면 '멈춤'으로 보고
   *  즉시 0 을 표시 → 걷는 중 0 깜빡임의 주원인. 이제 걸음 끊김은 GPS 도 느릴 때(최근 3초 도플러 2.2km/h 미만·없음)만 멈춤.
   */
  var STEP_STOP_GPS_V = 0.6; // m/s(≈2.2km/h)
  function gpsSaysMoving(s, now) {
    return s.lastDev != null && s.lastDevT && now - s.lastDevT < 3000 && s.lastDev >= STEP_STOP_GPS_V;
  }
  function motionVerdict(s, motion, now) {
    if (!motion || !motion.available) return null;
    if (s.v > WALK_MAX_V) return null;
    if (motion.walkingNow) return 'walk';
    if (motion.walkContext && motion.lastStepAgo >= 1800 && !gpsSaysMoving(s, now || Date.now())) return 'stopped';
    return null;
  }

  /**
   * GPS 사이(약 0.3초마다) 걸음 상태만으로 빠르게 정지 — 걷다가 멈추면 GPS 를 기다리지 않고 바로 0.
   * @returns {boolean} 이번에 정지로 바뀌었으면 true
   */
  function motionTick(s, motion) {
    if (!s.moving || (s.mode && s.mode !== 'walk')) return false; // 걸음 끊김 정지는 걷기만
    if (motionVerdict(s, motion, Date.now()) !== 'stopped') return false;
    s.moving = false; s.goN = 0; s.v = 0; s.P = 1; s.zs = [];
    return true;
  }

  function stepLegacy(s, fix, motion) {
    var t = fix.t, acc = fix.acc != null ? fix.acc : 999;
    var dev0 = fix.speed != null && isFinite(fix.speed) && fix.speed >= 0 && acc <= ACC_DEV_OK ? fix.speed : null;
    if (dev0 != null) { s.lastDev = dev0; s.lastDevT = t; } // 걸음 끊김 판정에 이번 GPS 속도도 반영
    var mv = motionVerdict(s, motion, t);
    if (acc <= ACC_POS_OK) {
      s.hist.push({ t: t, lat: fix.lat, lng: fix.lng, acc: acc });
      while (s.hist.length && t - s.hist[0].t > HIST_MS) s.hist.shift();
    }
    var dev = fix.speed != null && isFinite(fix.speed) && fix.speed >= 0 && acc <= ACC_DEV_OK ? fix.speed : null;
    if (dev != null) s.lastDevT = t;
    // 기기 속도가 잠깐(5초 이내) 한두 번 빠진 것은 '측정 없음' — 위치 회귀·실내 정지 판정으로 넘어가지 않고 직전 값 유지
    if (dev == null && s.lastDevT && t - s.lastDevT < 5000 && mv !== 'stopped') {
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

    // 걸음 수만 있고 GPS 속도가 없으면 분당 걸음 수 × 보폭으로 보조 측정
    if (z == null && mv === 'walk' && motion.cadence > 0) {
      z = (motion.cadence / 60) * STRIDE_M;
      R = 0.3 * 0.3;
    }
    // 실내 보호: 정확도가 나쁜데(기기 속도 미사용) 실제로 거의 안 움직였으면 정지 — 단, 걷는 중이면 정지로 보지 않음
    var still = dev == null && mv !== 'walk' && looksStill(s.hist, t);
    if (mv === 'stopped') still = true; // 걷다가 멈춤(걸음 끊김) → 바로 정지
    if (z == null && !still) return s.moving ? Math.max(0, s.v * 3.6) : 0; // 측정 없음 → 직전 값 유지

    var zz = still ? 0 : z;
    s.zs.push(zz); if (s.zs.length > 3) s.zs.shift();

    // 정지 / 출발 판정(히스테리시스)
    if (s.moving) {
      var avg3 = (s.zs[0] + s.zs[s.zs.length - 1] + s.zs[Math.floor(s.zs.length / 2)]) / 3;
      // 정지: 도플러 속도가 사실상 0(1번) · 낮은 값 2번 연속 · 최근 3번 평균이 낮음 중 하나 → 바로 0
      var hardStop = dev != null && zz <= HARD_STOP_V;
      var low2 = s.zs.length >= 2 && s.zs[s.zs.length - 1] < STOP_V && s.zs[s.zs.length - 2] < STOP_V;
      // 걷는 중(규칙적인 걸음)이면 GPS 값이 낮게 튀어도 정지로 보지 않는다
      var walkHold = mv === 'walk' && !still;
      if (still || (!walkHold && (hardStop || low2 || (s.zs.length >= 3 && avg3 < STOP_V)))) { s.moving = false; s.goN = 0; s.v = 0; s.P = 1; return 0; }
    } else {
      // 출발: 정확도가 좋으면 2번, 12m 보다 나쁘면(실내 가짜 속도 가능) 3번 연속 확인. 빠른 속도는 정확도 좋을 때 1번
      s.goN = zz >= GO_V ? s.goN + 1 : 0;
      var needGo = acc <= 12 ? 2 : 3;
      // 걷기 시작(규칙적인 걸음 확인) + GPS 도 약간이라도 움직임 → 1번에 출발
      var walkGo = mv === 'walk' && zz >= STOP_V;
      if (walkGo || (zz >= FAST_GO_V && acc <= 12) || s.goN >= needGo) { s.moving = true; s.v = zz; s.P = R || 1; return zz * 3.6; }
      return 0;
    }

    // 칼만 필터(속도 1차원): 예측(가속 허용 ±0.7m/s²) → 측정 반영
    var q = 0.7 * dt; s.P += q * q;
    var K = s.P / (s.P + R);
    s.v = Math.max(0, s.v + K * (zz - s.v));
    s.P = (1 - K) * s.P;
    return s.v * 3.6;
  }


  /*
   * 자전거·오토바이 속도(2026-10-31) — 출발·정지 반응을 상용 내비 수준으로.
   * 실측(아이폰 자전거 101분): 정지·출발 같은 저속 구간에서 iOS 가 속도 정확도(speedAccuracy)를 1.6~4.0 으로 크게 보내
   * 예전엔 '믿지 않음'으로 버리고 8초 위치 회귀로 넘어가 정지 후 0 까지 5~7초, 출발 후 속도가 3~5초 늦게 올랐다.
   * 실제 도플러 값은 그 구간에서도 매끄럽고 정확했다 → 버리지 않고 정확도만큼 가중치만 낮춘다.
   *  1) 속도·가속도 2상태 칼만 필터(등가속 모델): 가속·감속 중에도 뒤처지지 않음(1상태 필터의 램프 지연 제거)
   *  2) 정지: 도플러 0.3m/s 이하 1번, 또는 감속 추세상 1초 안에 멈출 것이 확실하면 바로 0(지연 없는 정지 판정)
   *  3) 출발: 도플러 1.0m/s 이상 1번(또는 0.5m/s 이상 2번 연속)이면 바로 출발, 그 값부터 표시
   *  4) 튀는 값: 이동 중 1초 만에 물리적으로 불가능한 급감속(정지된 이전 위치 재전송 등)은 한 번 무시, 다음 값이 같으면 인정
   *  5) 화면 표시(display): 일정 속도 주행은 2초 평균(지금처럼 안정적), 가속·감속 중엔 필터값 + 다음 GPS 까지 가속도로 이어 그림
   */
  var V_STOP = 0.3;      // m/s(≈1.1km/h) 이하 도플러 1번 → 정지
  var V_GO = 1.0;        // m/s(≈3.6km/h) 이상 1번 → 출발
  var V_GO2 = 0.5;       // m/s(≈1.8km/h) 이상 2번 연속 → 출발
  var JERK = 2.5;        // 가속도 변화 허용(m/s³) — 클수록 빠르게 따라감
  var MAX_DECEL = 3.5;   // m/s² — 자전거·오토바이 급제동 한계(이보다 큰 1초 급감속은 한 번 보류)

  function kfPredict(s, dt) {
    // x = [v, a], F = [[1, dt], [0, 1]], Q = 저크 백색잡음
    s.v += s.a * dt;
    var p00 = s.P00 + dt * (2 * s.P01 + dt * s.P11), p01 = s.P01 + dt * s.P11, p11 = s.P11;
    var q = JERK * JERK;
    s.P00 = p00 + q * dt * dt * dt * dt * dt / 20;
    s.P01 = p01 + q * dt * dt * dt * dt / 8;
    s.P11 = p11 + q * dt * dt * dt / 3;
  }
  function kfUpdate(s, z, R) {
    var S = s.P00 + R, k0 = s.P00 / S, k1 = s.P01 / S, y = z - s.v;
    s.v += k0 * y; s.a += k1 * y;
    var p00 = (1 - k0) * s.P00, p01 = (1 - k0) * s.P01, p11 = s.P11 - k1 * s.P01;
    s.P00 = p00; s.P01 = p01; s.P11 = p11;
    if (s.v < 0) { s.v = 0; if (s.a < 0) s.a = 0; }
  }
  function vStop(s) { s.moving = false; s.v = 0; s.a = 0; s.goN = 0; s.lowHold = 0; s.zs = []; return 0; }
  function vGo(s, z, t) {
    s.moving = true; s.v = z; s.a = 0; s.P00 = 0.3; s.P01 = 0; s.P11 = 1.5; s.goAt = t; s.lowHold = 0;
    return z * 3.6;
  }

  function stepVehicle(s, fix) {
    var t = fix.t, acc = fix.acc != null ? fix.acc : 999;
    if (acc <= ACC_POS_OK) {
      s.hist.push({ t: t, lat: fix.lat, lng: fix.lng, acc: acc });
      while (s.hist.length && t - s.hist[0].t > HIST_MS) s.hist.shift();
    }
    var dt = s.t ? Math.min(5, Math.max(0.2, (t - s.t) / 1000)) : 1;
    s.t = t;
    s.fixAt = t;
    var z = fix.speed != null && isFinite(fix.speed) && fix.speed >= 0 && acc <= 50 ? fix.speed : null;
    var R;
    if (z != null) {
      s.lastDevT = t;
      var sa = fix.speedAcc != null && isFinite(fix.speedAcc) && fix.speedAcc > 0 ? fix.speedAcc : 0.6 + 0.02 * acc;
      // iOS 저속 정확도 값(3.7~4.0)은 매우 보수적 — 그대로 쓰면 반응이 둔해져 상한을 둠
      sa = Math.min(1.6, Math.max(0.35, sa));
      R = sa * sa * 0.5 + (acc > 25 ? 0.3 : 0);
    } else {
      // 속도값이 잠깐 빠짐 → 3초까지는 가속도로 이어 감(값을 그대로 붙잡지 않음)
      if (s.lastDevT && t - s.lastDevT < 3000) {
        if (s.moving) { kfPredict(s, dt); if (s.v <= V_STOP) return vStop(s); }
        return s.moving ? s.v * 3.6 : 0;
      }
      var rg = acc <= ACC_POS_OK ? regressionSpeed(s.hist, t) : null;
      if (!rg) return s.moving ? s.v * 3.6 : 0;
      z = Math.max(0, rg.v - 0.5 * rg.sigma);
      R = Math.max(0.1, rg.sigma * rg.sigma * 2);
      if (looksStill(s.hist, t)) z = 0;
    }

    if (!s.moving) {
      s.goN = z >= V_GO2 ? s.goN + 1 : 0;
      if ((z >= V_GO && acc <= 25) || s.goN >= 2) return vGo(s, z, t);
      return 0;
    }

    var vPrev = s.v;
    kfPredict(s, dt);
    // 튀는 값: 1초 만에 급제동 한계보다 크게 떨어짐 → 한 번 보류(다음 값도 낮으면 그때 반영)
    if (z < vPrev - MAX_DECEL * dt - 0.5 && !s.lowHold) { s.lowHold = 1; return s.v * 3.6; }
    s.lowHold = 0;
    if (z <= V_STOP) return vStop(s);
    kfUpdate(s, z, R);
    // 감속 추세상 1초 안에 멈춤이 확실(도플러 1m/s 미만 + 감속 중) → 기다리지 않고 0
    if (z < 1.0 && s.a < -0.6 && s.v + s.a * 1.0 <= 0.25) return vStop(s);
    return s.v * 3.6;
  }

  /**
   * 화면에 보일 속도(km/h) — now 시각 기준. 일정 주행은 최근 2초 평균, 가속·감속 중엔 필터값을 다음 GPS 까지 가속도로 이어 그림(최대 1초).
   * 걷기는 null(기존 3초 평균 표시 사용).
   */
  function display(s, now) {
    if (s.mode === 'walk' || s.v == null) return null;
    if (!s.moving) { s.dh = []; return 0; }
    var h = s.dh || (s.dh = []);
    if (!h.length || h[h.length - 1][0] !== s.fixAt) h.push([s.fixAt, s.v]);
    while (h.length && now - h[0][0] > 2000) h.shift();
    var age = Math.min(1, Math.max(0, (now - s.fixAt) / 1000));
    if (Math.abs(s.a) >= 0.35 || now - (s.goAt || 0) < 2500) return Math.max(0, (s.v + s.a * age)) * 3.6;
    var sum = 0;
    for (var i = 0; i < h.length; i++) sum += h[i][1];
    return Math.max(0, sum / h.length) * 3.6;
  }

  function step(s, fix, motion) {
    if (s.mode && s.mode !== 'walk') return stepVehicle(s, fix);
    return stepLegacy(s, fix, motion);
  }

  root.OutdoorSpeedFilter = { create: create, step: step, motionTick: motionTick, display: display };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OutdoorSpeedFilter;
})(typeof window !== 'undefined' ? window : globalThis);
