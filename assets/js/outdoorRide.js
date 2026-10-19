/**
 * 아웃도어 라이딩 (2026-10-19) — #outdoorRideScreen
 *
 * - 휴대폰 GPS(navigator.geolocation.watchPosition)로 현재 속도·이동 거리·평균 속도·경과 시간·누적 고도 계산
 * - GPX 코스맵(라이딩 모임 코스 또는 내 코스 라이브러리)을 지도에 그리고 실시간 안내(가민 코스 안내와 비슷하게):
 *   진행 방향 회전 안내(○○m 후 좌/우회전), 코스 이탈 경고, 남은 거리
 * - 라이딩 시작/일시정지, 종료 시 훈련 일지 저장(saveStravaActivityToFirebase, source 'stelvio_outdoor' → Supabase rides
 *   'stelvio', 경로는 summary_polyline) + GPX 파일 받기
 * 진입: 라이딩 모임 상세 "이 코스로 아웃도어 라이딩" → window.openOutdoorRide({ gpxUrl, title, rideId })
 */
(function () {
  'use strict';

  var SCREEN_ID = 'outdoorRideScreen';
  var GAUGE_MAX_KMH = 60;
  var OFF_COURSE_M = 45; // 코스에서 이만큼 벗어나면 이탈 경고
  var TURN_MIN_DEG = 35; // 이 각도 이상 꺾이면 회전 안내
  var TURN_ANNOUNCE_M = 400; // 이 거리 안의 다음 회전만 안내
  var TURN_BIG_M = 150; // 이 거리 안이면 큰 회전 화살표 카드 + 지도 확대 + 회전 구간 강조
  var TURN_ZOOM = 18;

  var st = {
    status: 'idle', // idle | running | paused
    elapsedMs: 0,
    runSince: 0,
    startedAt: 0,
    distanceM: 0,
    elevGainM: 0,
    altBase: null,
    altEma: null,
    speedKmh: 0,
    displaySpeed: 0,
    lastFix: null, // { lat, lng, t, acc }
    lastFixAt: 0,
    lastTrackPt: null,
    track: [], // [lat, lng, ele|null, timeMs]
    watchId: null,
    map: null,
    meMarker: null,
    trail: null,
    course: null, // { title, latlngs, cum[], turns[], totalM }
    courseLayer: null,
    courseIdx: 0,
    follow: true,
    timer: null,
    rafId: null,
    prevScreen: '',
    gpsQuality: 0,
    lastNavText: '',
    turnBigIdx: null,
    turnBuzz: {},
    turnLayer: null,
    turnLayerIdx: null,
    turnZoomed: false,
    zoomBeforeTurn: 16,
    maxSpeedKmh: 0,
    movingMs: 0,
    headingUp: true,
    heading: null,
    appliedHeading: null,
    mapRotDeg: null,
    lastHeadPt: null
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, v) {
    var el = $(id);
    if (el && el.textContent !== String(v)) el.textContent = String(v);
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }
  /* ---------- 소리 안내(2026-10-20): 알림음(Web Audio) + 한국어 음성(speechSynthesis) ----------
   * 모드: 'voice'(음성+알림음) → 'beep'(알림음만) → 'off'. 기기에 기억(localStorage).
   * 휴대폰은 사용자가 화면을 터치한 뒤에만 소리를 낼 수 있어 시작·메뉴·경로 선택 때 unlockAudio() 로 미리 깨운다. */
  var SOUND_LS = 'stelvioOutdoorSound';
  var soundMode = (function () { try { return localStorage.getItem(SOUND_LS) || 'voice'; } catch (e) { return 'voice'; } })();
  var audioCtx = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
    // 음성 엔진도 첫 터치 때 빈 문장으로 깨움(iOS)
    try {
      if (!unlockAudio.spoke && window.speechSynthesis && window.SpeechSynthesisUtterance) {
        unlockAudio.spoke = true;
        var u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch (e) {}
  }
  /** seq: [[주파수Hz, 길이ms, 시작지연ms], ...] — 짧은 사인파 음(부드러운 시작·끝) */
  function playTones(seq, vol) {
    if (soundMode === 'off' || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // 앞 소리가 끝난 뒤 이어서(겹치지 않게)
      var t0 = Math.max(audioCtx.currentTime + 0.02, playTones.busyUntil || 0);
      var endMs = 0;
      seq.forEach(function (n) { endMs = Math.max(endMs, (n[2] || 0) + n[1]); });
      playTones.busyUntil = t0 + endMs / 1000 + 0.12;
      seq.forEach(function (n) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        var start = t0 + (n[2] || 0) / 1000;
        var dur = n[1] / 1000;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n[0], start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(vol || 0.35, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      });
    } catch (e) {}
  }
  /** priority: 재탐색·이탈·도착 안내 — 바로 뒤 회전 안내가 이 말을 끊지 않고 이어서 말한다 */
  function speak(text, priority) {
    if (soundMode !== 'voice' || !text) return;
    try {
      var synth = window.speechSynthesis;
      if (!synth || !window.SpeechSynthesisUtterance) return;
      var now = Date.now();
      var keep = !priority && speak.priorityUntil && now < speak.priorityUntil;
      if (!keep) synth.cancel();
      if (priority) speak.priorityUntil = now + 3500;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 1.05;
      u.volume = 1;
      var ko = (synth.getVoices() || []).filter(function (v) { return /^ko/i.test(v.lang); })[0];
      if (ko) u.voice = ko;
      // 알림음이 끝난 뒤 말하도록 살짝 늦춤
      setTimeout(function () { try { synth.speak(u); } catch (e) {} }, 380);
    } catch (e) {}
  }
  function voiceDist(dm) {
    var m = dm >= 100 ? Math.round(dm / 10) * 10 : Math.max(10, Math.round(dm / 5) * 5);
    return m >= 1000 ? (m / 1000).toFixed(1) + '킬로미터' : m + '미터';
  }
  /** 상황별 소리 */
  function cue(kind, text) {
    switch (kind) {
      case 'turnFar': playTones([[880, 140, 0], [1175, 200, 160]]); break; // 분기점 접근: 띵-띵
      case 'turnNear': playTones([[1319, 110, 0], [1319, 110, 150], [1568, 220, 300]], 0.4); break; // 바로 앞: 빠른 세 번
      case 'off': playTones([[440, 260, 0], [330, 360, 300]], 0.4); break; // 이탈: 낮은 경고음
      case 'reroute': playTones([[784, 120, 0], [988, 120, 140], [1319, 220, 280]]); break; // 재탐색 완료
      case 'arrive': playTones([[784, 160, 0], [988, 160, 180], [1175, 160, 360], [1568, 420, 540]]); break; // 도착
      default: break;
    }
    speak(text, kind === 'reroute' || kind === 'off' || kind === 'arrive');
  }
  function soundLabel() {
    return soundMode === 'voice' ? '소리 안내: 음성 + 알림음' : soundMode === 'beep' ? '소리 안내: 알림음만' : '소리 안내: 끔';
  }
  window.cycleOutdoorSound = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    unlockAudio();
    soundMode = soundMode === 'voice' ? 'beep' : soundMode === 'beep' ? 'off' : 'voice';
    try { localStorage.setItem(SOUND_LS, soundMode); } catch (err) {}
    setText('outdSoundLabel', soundLabel());
    if (soundMode !== 'off') cue('turnFar', soundMode === 'voice' ? '소리 안내를 켰습니다' : '');
  };

  function isActive() {
    var el = $(SCREEN_ID);
    return !!(el && el.classList.contains('active'));
  }

  /* ---------- 지리 계산 ---------- */
  function hav(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR;
    var dLon = (lon2 - lon1) * toR;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var toR = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * toR) * Math.cos(lat2 * toR);
    var x = Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lon2 - lon1) * toR);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function angleDiff(a, b) {
    var d = (b - a + 540) % 360 - 180;
    return d; // -180~180, + = 오른쪽
  }

  /* ---------- 표시 ---------- */
  function fmtHms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function elapsedNow() {
    return st.elapsedMs + (st.status === 'running' && st.runSince ? Date.now() - st.runSince : 0);
  }

  function buildGaugeScale() {
    var ticks = $('outd-gauge-ticks');
    var labels = $('outd-gauge-labels');
    if (!ticks || !labels || ticks.childNodes.length) return;
    var ns = 'http://www.w3.org/2000/svg';
    var cx = 100, cy = 140, r = 80;
    // 눈금: 모바일 개인훈련 속도계와 같은 디자인 — 총 25개(주눈금 7 + 보조 18), 흰색,
    // 주눈금(10 km/h마다) 길이 14·두께 2.5, 보조(2.5 km/h마다) 길이 7·두께 1.5, 안쪽 시작 반지름 70
    var innerR = r - 10;
    for (var i0 = 0; i0 <= 24; i0++) {
      var major = i0 % 4 === 0;
      var rad = Math.PI + (i0 / 24) * Math.PI;
      var len = major ? 14 : 7;
      var ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', cx + innerR * Math.cos(rad));
      ln.setAttribute('y1', cy + innerR * Math.sin(rad));
      ln.setAttribute('x2', cx + (innerR + len) * Math.cos(rad));
      ln.setAttribute('y2', cy + (innerR + len) * Math.sin(rad));
      ln.setAttribute('stroke', '#ffffff');
      ln.setAttribute('stroke-width', major ? '2.5' : '1.5');
      ticks.appendChild(ln);
    }
    // 숫자: 0km/h, 10, 20, 30, 40, 50, 60 (원 바깥, 다른 계기판과 같은 반지름 98)
    for (var i = 0; i <= 6; i++) {
      var val = i * 10;
      var ang = Math.PI + (i / 6) * Math.PI;
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', cx + 98 * Math.cos(ang));
      t.setAttribute('y', cy + 98 * Math.sin(ang));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('fill', val === 30 ? '#ef4444' : '#ffffff'); // 30 km/h 는 빨간색
      t.setAttribute('font-size', '10');
      t.setAttribute('font-weight', '600');
      t.textContent = val === 0 ? '0km/h' : String(val);
      labels.appendChild(t);
    }
  }

  /** 정수 부분은 가운데(text-anchor middle), 소수점 이하는 정수 오른쪽 끝에 작게 붙인다 */
  function setSplitNumber(intId, decId, value, decimals) {
    var intEl = $(intId);
    var decEl = $(decId);
    if (!intEl || !decEl) return;
    var v = Math.max(0, Number(value) || 0);
    var str = v.toFixed(decimals);
    var dot = str.indexOf('.');
    var ip = dot >= 0 ? str.slice(0, dot) : str;
    var dp = dot >= 0 ? str.slice(dot) : '';
    var changed = false;
    if (intEl.textContent !== ip) { intEl.textContent = ip; changed = true; }
    if (decEl.textContent !== dp) { decEl.textContent = dp; changed = true; }
    if (changed || !decEl.__placed) {
      var w = 0;
      try { w = intEl.getComputedTextLength(); } catch (e) {}
      if (w > 0) {
        decEl.setAttribute('x', (Number(intEl.getAttribute('x')) + w / 2 + 1).toFixed(1));
        decEl.__placed = true;
      }
    }
  }

  /** 평균 속도 = 거리 ÷ 이동 시간(멈춘 시간 제외, 스트라바·가민과 같은 기준). 이동 시간이 없으면 경과 시간 */
  function avgSpeedKmh() {
    var ms = st.movingMs > 0 ? st.movingMs : elapsedNow();
    var v = ms > 0 ? (st.distanceM / 1000) / (ms / 3600000) : 0;
    return isFinite(v) ? v : 0;
  }

  function renderStats() {
    var el = elapsedNow();
    setText('outd-main-timer', fmtHms(el));
    setSplitNumber('outd-ui-distance', 'outd-ui-distance-dec', st.distanceM / 1000, 2);
    var avg = avgSpeedKmh();
    setText('outd-ui-avg', (isFinite(avg) ? avg : 0).toFixed(1));
    setText('outd-ui-elev', Math.round(st.elevGainM));
    // 남은 거리: 코스맵(피니쉬)·길찾기(목적지)까지. 코스가 없으면(자유 라이딩) --
    if (!st.course) setText('outd-ui-remain', '--');
    // GPS 신호가 5초 넘게 끊기면 속도 0 으로
    if (Date.now() - st.lastFixAt > 5000 && st.speedKmh !== 0) {
      st.speedKmh = 0;
      kickLoop();
    }
  }

  /* 배터리·발열 최적화(2026-10-19): 바늘 애니메이션은 초당 최대 30번, 목표 속도에 도달하면 멈추고
     새 GPS 값이 오면(kickLoop) 다시 시작. 화면이 가려져 있으면(document.hidden) 그리지 않는다. */
  var FRAME_MS = 33;
  function kickLoop() {
    if (st.rafId == null && isActive() && !document.hidden) st.rafId = requestAnimationFrame(loop);
  }
  function loop(ts) {
    st.rafId = null;
    if (!isActive() || document.hidden) return;
    if (st.lastFrameTs && ts - st.lastFrameTs < FRAME_MS) {
      st.rafId = requestAnimationFrame(loop);
      return;
    }
    st.lastFrameTs = ts;
    var diff = st.speedKmh - st.displaySpeed;
    var settled = Math.abs(diff) <= 0.05;
    st.displaySpeed = settled ? st.speedKmh : st.displaySpeed + diff * 0.25;
    var ratio = Math.min(Math.max(st.displaySpeed / GAUGE_MAX_KMH, 0), 1);
    var needle = $('outd-gauge-needle');
    if (needle) needle.setAttribute('transform', 'translate(100, 140) rotate(' + (-90 + ratio * 180).toFixed(2) + ')');
    // 현재 속도까지 원호가 하늘색으로 차오름(벤츠 디지털 계기판 스윕)
    var sweep = $('outd-gauge-sweep');
    if (sweep) {
      if (ratio < 0.005) {
        if (sweep.style.display !== 'none') sweep.style.display = 'none';
      } else {
        var end = Math.PI + ratio * Math.PI;
        var ex = (100 + 80 * Math.cos(end)).toFixed(2);
        var ey = (140 + 80 * Math.sin(end)).toFixed(2);
        var dPath = 'M 20 140 A 80 80 0 0 1 ' + ex + ' ' + ey;
        sweep.setAttribute('d', dPath);
        if (sweep.style.display === 'none') sweep.style.display = '';
      }
      // 빛 번짐(블러 필터 대신 넓은 반투명 선 — 매 프레임 블러 재계산 없이 같은 느낌)
      var glow = $('outd-gauge-sweep-glow');
      if (glow) {
        if (sweep.style.display === 'none') { if (glow.style.display !== 'none') glow.style.display = 'none'; }
        else { glow.setAttribute('d', sweep.getAttribute('d')); if (glow.style.display === 'none') glow.style.display = ''; }
      }
    }
    setSplitNumber('outd-ui-speed', 'outd-ui-speed-dec', st.speedKmh, 1);
    if (!settled) st.rafId = requestAnimationFrame(loop);
  }

  function renderToggle() {
    var img = $('outdToggleImg');
    if (img) img.setAttribute('href', st.status === 'running' ? 'assets/img/pause0.png' : 'assets/img/play0.png');
    var pulse = $('outdStartPulseWrap');
    if (pulse) {
      pulse.classList.toggle('pulse-active', st.status !== 'running');
      pulse.classList.toggle('pulse-hidden', st.status === 'running');
    }
  }

  function renderGps(acc) {
    var q = 0;
    if (acc != null && isFinite(acc)) q = acc <= 10 ? 4 : acc <= 20 ? 3 : acc <= 35 ? 2 : 1;
    st.gpsQuality = q;
    var dot = $('outdGpsDot');
    if (dot) {
      dot.classList.toggle('is-good', q >= 3);
      dot.classList.toggle('is-weak', q > 0 && q < 3);
    }
    var bars = $('outdGpsBars');
    if (bars) Array.prototype.forEach.call(bars.children, function (b, i) { b.classList.toggle('on', i < q); });
    setText('outdGpsText', q === 0 ? 'GPS 신호 없음' : 'GPS 연결됨 · 정확도 ±' + Math.round(acc) + 'm');
  }

  /* ---------- GPS ---------- */
  function onPosition(pos) {
    var c = pos && pos.coords;
    if (!c) return;
    var lat = c.latitude, lng = c.longitude, acc = c.accuracy;
    var t = pos.timestamp || Date.now();
    renderGps(acc);
    st.lastFixAt = Date.now();
    if (acc != null && acc <= 35) updateHeading(c, lat, lng);
    maybeResumeFollow();
    updateMeOnMap(lat, lng);

    var prev = st.lastFix;
    st.lastFix = { lat: lat, lng: lng, t: t, acc: acc };

    // 현재 속도: 기기가 주는 speed(m/s) 우선, 없으면 직전 위치와의 거리/시간
    var spd = null;
    var accOk = acc != null && acc <= 35; // 위치 정확도가 나쁘면(실내·PC 네트워크 위치 등) 위치가 튀어 엉뚱한 속도가 나온다
    if (accOk && c.speed != null && isFinite(c.speed) && c.speed >= 0) spd = c.speed * 3.6;
    var d = prev ? hav(prev.lat, prev.lng, lat, lng) : 0;
    var dt = prev ? (t - prev.t) / 1000 : 0;
    if (spd == null && accOk && prev && prev.acc <= 35 && dt >= 1) spd = (d / dt) * 3.6;
    if (!accOk) spd = 0;
    if (spd != null && isFinite(spd)) st.speedKmh = spd < 1.5 ? 0 : Math.min(spd, 120);
    kickLoop();

    if (st.status === 'running') {
      // 이동 시간(멈춘 시간 제외)·최고 속도 — 정확도 좋은 값만(위치 튐으로 인한 순간 고속 제외)
      if (accOk && prev && dt > 0 && dt < 10 && st.speedKmh >= 3) {
        // 시작(재개) 이전 구간은 빼고, 경과 시간을 넘지 않게
        var fromMs = Math.max(prev.t, st.runSince || 0);
        if (t > fromMs) st.movingMs = Math.min(st.movingMs + (t - fromMs), elapsedNow());
      }
      if (accOk && st.speedKmh > st.maxSpeedKmh && st.speedKmh < 100) st.maxSpeedKmh = st.speedKmh;
      // 거리 누적: 정확도가 괜찮고(≤35m), 순간 이동(>30m/s)이 아니며, 실제로 움직였을 때만
      if (prev && acc <= 35 && dt > 0 && d / dt < 30 && (st.speedKmh >= 1.5 || d > Math.max(3, acc * 0.5))) {
        st.distanceM += d;
      }
      // 누적 고도: 고도값을 부드럽게(EMA) 한 뒤 기준점보다 3m 이상 오르면 더한다(GPS 고도 흔들림 제거)
      if (c.altitude != null && isFinite(c.altitude) && acc <= 35) {
        st.altEma = st.altEma == null ? c.altitude : st.altEma + (c.altitude - st.altEma) * 0.25;
        if (st.altBase == null) st.altBase = st.altEma;
        if (st.altEma - st.altBase >= 3) {
          st.elevGainM += st.altEma - st.altBase;
          st.altBase = st.altEma;
        } else if (st.altEma < st.altBase) {
          st.altBase = st.altEma;
        }
      }
      var lp = st.lastTrackPt;
      if (!lp || hav(lp[0], lp[1], lat, lng) >= 5) {
        var pt = [lat, lng, c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude * 10) / 10 : null, t];
        st.track.push(pt);
        st.lastTrackPt = pt;
        // 지나온 경로 선은 15m마다만 다시 그림(저장용 track 은 5m 간격 그대로)
        var tl = st.lastTrailPt;
        if (st.trail && (!tl || hav(tl[0], tl[1], lat, lng) >= 15)) {
          st.trail.addLatLng([lat, lng]);
          st.lastTrailPt = [lat, lng];
        }
      }
    }
    updateNavigation(lat, lng);
  }

  function onPositionError(err) {
    renderGps(null);
    if (err && err.code === 1) setText('outdGpsText', '위치 권한이 필요합니다');
  }

  function startGps() {
    if (st.watchId != null) return;
    if (!navigator.geolocation) {
      setText('outdGpsText', '이 기기는 GPS를 지원하지 않습니다');
      return;
    }
    st.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
  }
  function stopGps() {
    if (st.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(st.watchId);
    st.watchId = null;
  }

  /* ---------- 지도 ---------- */
  function ensureMap() {
    if (st.map || typeof window.L === 'undefined') return st.map;
    var L = window.L;
    sizeRotLayer();
    // 확대·축소는 항상 지도 가운데(=회전 중심) 기준 — 회전한 지도에서도 손가락 확대가 어긋나지 않게
    st.map = L.map('outdMap', {
      zoomControl: false,
      attributionControl: false, // 출처 표시는 회전판 밖(.outd-attrib)에 고정
      fadeAnimation: false,
      touchZoom: 'center',
      scrollWheelZoom: 'center',
      doubleClickZoom: 'center'
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1,
      attribution: '&copy; OpenStreetMap'
    }).addTo(st.map);
    st.map.setView([37.5665, 126.978], 13);
    st.trail = L.polyline([], { color: '#00d4aa', weight: 4, opacity: 0.95 }).addTo(st.map);
    st.map.dragging.disable();
    bindRotatedDrag();
    return st.map;
  }

  /* ---------- 진행 방향 위(헤딩업) 지도 (2026-10-20) ----------
   * 자동차 내비처럼 진행 방향이 항상 화면 위쪽. 지도를 대각선 크기 정사각형 회전판에 올려 회전(모서리 빈틈 없음).
   * 진행 방향: GPS heading(3 km/h 이상) → 없으면 최근 8m 이상 이동한 방향, 부드럽게 보정, 3° 이상 바뀔 때만 회전.
   * 내 위치는 화면 아래쪽(약 65% 높이)에 두어 앞길이 더 보이게. 나침반 버튼으로 '북쪽 위' 전환(이때만 지도 끌기 가능). */
  function sizeRotLayer() {
    var rot = $('outdMapRot');
    var wrap = rot && rot.parentNode;
    if (!rot || !wrap) return;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    var D = Math.ceil(Math.sqrt(w * w + h * h)) + 2;
    rot.style.width = D + 'px';
    rot.style.height = D + 'px';
    rot.style.left = Math.round((w - D) / 2) + 'px';
    rot.style.top = Math.round((h - D) / 2) + 'px';
  }

  function applyRotation() {
    var target = st.headingUp && st.heading != null ? -st.heading : 0;
    // 누적 각도로 회전(359°→1° 에서 한 바퀴 반대로 도는 것 방지)
    st.mapRotDeg = st.mapRotDeg == null ? target : st.mapRotDeg + angleDiff(st.mapRotDeg, target);
    var rot = $('outdMapRot');
    if (rot) rot.style.transform = 'rotate(' + st.mapRotDeg.toFixed(1) + 'deg)';
    var needle = $('outdCompassNeedle');
    if (needle) needle.style.transform = 'rotate(' + st.mapRotDeg.toFixed(1) + 'deg)'; // 빨간 끝 = 북쪽
    setText('outdCompassMode', st.headingUp ? '진행' : '북쪽');
    // 지도 끌기는 Leaflet 기본 대신 회전 보정 핸들러(bindRotatedDrag)가 맡는다
    if (st.map && st.map.dragging) st.map.dragging.disable();
  }

  function updateHeading(c, lat, lng) {
    var h = null;
    var spdKmh = c.speed != null && isFinite(c.speed) ? c.speed * 3.6 : 0;
    if (c.heading != null && isFinite(c.heading) && spdKmh >= 3) h = c.heading;
    var hp = st.lastHeadPt;
    if (h == null && hp && hav(hp[0], hp[1], lat, lng) >= 8) h = bearing(hp[0], hp[1], lat, lng);
    if (!hp || h != null) st.lastHeadPt = [lat, lng];
    if (h == null) return;
    st.heading = st.heading == null ? h : (st.heading + angleDiff(st.heading, h) * 0.5 + 360) % 360;
    if (st.appliedHeading == null || Math.abs(angleDiff(st.appliedHeading, st.heading)) >= 3) {
      st.appliedHeading = st.heading;
      applyRotation();
    }
  }

  /** 위도·경도에서 방위각 brg 로 dist(m) 떨어진 지점 */
  function destPoint(lat, lng, brg, dist) {
    var R = 6371000, toR = Math.PI / 180;
    var d = dist / R, b = brg * toR, p1 = lat * toR, l1 = lng * toR;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / toR, l2 / toR];
  }

  /** 따라가기: 헤딩업이면 내 위치가 화면 아래쪽(65%)에 오도록 진행 방향 앞쪽을 지도 중심으로 */
  function followUser(lat, lng, zoom, animate) {
    var map = st.map;
    if (!map) return;
    var z = zoom != null ? zoom : map.getZoom();
    var center = [lat, lng];
    if (st.headingUp && st.heading != null) {
      var wrap = document.querySelector('#' + SCREEN_ID + ' .outd-map-wrap');
      var hPx = wrap ? wrap.clientHeight : 300;
      var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
      center = destPoint(lat, lng, st.heading, hPx * 0.15 * mpp);
    }
    map.setView(center, z, { animate: animate !== false, duration: 0.8 });
  }

  /* 회전된 지도 끌기(2026-10-20): Leaflet 기본 끌기는 회전된 지도에서 손가락과 다른 방향으로 움직여서,
     화면에서 움직인 양을 지도 회전만큼 되돌려(panBy) 손가락을 정확히 따라가게 한다. 한 손가락만(두 손가락은 확대·축소).
     끌면 따라가기 일시 해제 → 주행 중 10초 동안 손대지 않으면 자동으로 진행 방향 따라가기로 복귀(◎ 로 즉시 복귀). */
  var FOLLOW_RESUME_MS = 10000;
  function bindRotatedDrag() {
    var el = $('outdMap');
    if (!el || el.__rotDragBound) return;
    el.__rotDragBound = true;
    var pointers = {};
    var last = null;
    function count() { return Object.keys(pointers).length; }
    el.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = true;
      if (count() === 1) {
        last = { x: e.clientX, y: e.clientY, id: e.pointerId };
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
      } else {
        last = null; // 두 손가락 → 확대·축소(Leaflet touchZoom)
      }
    });
    el.addEventListener('pointermove', function (e) {
      if (!last || e.pointerId !== last.id || count() !== 1 || !st.map) return;
      var sx = e.clientX - last.x, sy = e.clientY - last.y;
      if (!sx && !sy) return;
      last.x = e.clientX;
      last.y = e.clientY;
      var th = ((st.mapRotDeg || 0) * Math.PI) / 180;
      var mx = sx * Math.cos(th) + sy * Math.sin(th);
      var my = -sx * Math.sin(th) + sy * Math.cos(th);
      if (st.follow) st.follow = false;
      st.userPanAt = Date.now();
      st.map.panBy([-mx, -my], { animate: false });
    });
    function end(e) {
      delete pointers[e.pointerId];
      if (last && e.pointerId === last.id) last = null;
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** 끌어서 둘러본 뒤 주행 중 10초 손대지 않으면 따라가기 복귀 */
  function maybeResumeFollow() {
    if (st.follow || st.status !== 'running') return;
    if (Date.now() - (st.userPanAt || 0) < FOLLOW_RESUME_MS) return;
    st.follow = true;
  }

  window.toggleOutdoorHeadingUp = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    st.headingUp = !st.headingUp;
    st.follow = true;
    applyRotation();
    if (st.lastFix) followUser(st.lastFix.lat, st.lastFix.lng);
    toast(st.headingUp ? '진행 방향이 위로 오도록 지도를 회전합니다' : '북쪽이 위로 오도록 지도를 고정합니다', 'info');
  };

  function updateMeOnMap(lat, lng) {
    var map = ensureMap();
    if (!map) return;
    var L = window.L;
    if (!st.meMarker) {
      st.meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="outd-me"><span class="outd-me__pulse"></span><span class="outd-me__pulse outd-me__pulse--2"></span><span class="outd-me__dot"></span></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
      followUser(lat, lng, Math.max(map.getZoom(), 16), false);
    } else {
      st.meMarker.setLatLng([lat, lng]);
      if (st.follow && st.headingUp) {
        // 헤딩업: 회전 중심이 지도 가운데라 매 위치마다 진행 방향 앞쪽으로 중심을 맞춘다(부드럽게 이동)
        followUser(lat, lng);
      } else if (st.follow) {
        // 북쪽 위: 매초 지도를 옮기지 않고 내 위치가 가운데 영역(가로·세로 40%)을 벗어날 때만 이동
        var sz = map.getSize();
        var cp = map.latLngToContainerPoint([lat, lng]);
        if (Math.abs(cp.x - sz.x / 2) > sz.x * 0.2 || Math.abs(cp.y - sz.y / 2) > sz.y * 0.2) {
          map.panTo([lat, lng], { animate: true, duration: 0.6 });
        }
      }
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) kickLoop();
  });

  window.recenterOutdoorMap = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    st.follow = true;
    st.headingUp = true;
    applyRotation();
    if (st.map && st.lastFix) followUser(st.lastFix.lat, st.lastFix.lng, Math.max(st.map.getZoom(), 16));
  };

  /* ---------- 코스 & 내비게이션 ---------- */
  function prepareCourse(title, latlngs) {
    var cum = [0];
    for (var i = 1; i < latlngs.length; i++) {
      cum.push(cum[i - 1] + hav(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]));
    }
    // 회전 지점: 앞뒤 약 25m 구간의 진행 방향이 TURN_MIN_DEG 이상 바뀌는 곳(40m 안의 연속 후보는 가장 크게 꺾이는 곳 하나)
    var turns = [];
    var j0 = 0, j1 = 0;
    for (var k = 1; k < latlngs.length - 1; k++) {
      while (j0 < k && cum[k] - cum[j0 + 1] >= 25) j0++;
      if (j1 < k) j1 = k;
      while (j1 < latlngs.length - 1 && cum[j1] - cum[k] < 25) j1++;
      if (cum[k] - cum[j0] < 15 || cum[j1] - cum[k] < 15) continue;
      var bin = bearing(latlngs[j0][0], latlngs[j0][1], latlngs[k][0], latlngs[k][1]);
      var bout = bearing(latlngs[k][0], latlngs[k][1], latlngs[j1][0], latlngs[j1][1]);
      var delta = angleDiff(bin, bout);
      if (Math.abs(delta) < TURN_MIN_DEG) continue;
      var last = turns[turns.length - 1];
      if (last && cum[k] - last.at < 40) {
        if (Math.abs(delta) > Math.abs(last.delta)) { last.at = cum[k]; last.delta = delta; last.idx = k; }
      } else {
        turns.push({ at: cum[k], delta: delta, idx: k });
      }
    }
    return { title: title, latlngs: latlngs, cum: cum, turns: turns, totalM: cum[cum.length - 1] };
  }

  function drawCourse() {
    var map = ensureMap();
    if (!map || !st.course) return;
    var L = window.L;
    if (st.courseLayer) map.removeLayer(st.courseLayer);
    st.courseLayer = L.layerGroup().addTo(map);
    L.polyline(st.course.latlngs, { color: '#7c3aed', weight: 5, opacity: 0.85, smoothFactor: 1.5 }).addTo(st.courseLayer);
    var first = st.course.latlngs[0], lastP = st.course.latlngs[st.course.latlngs.length - 1];
    L.circleMarker(first, { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(st.courseLayer);
    L.circleMarker(lastP, { radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(st.courseLayer);
    if (st.trail) st.trail.bringToFront();
    if (!st.lastFix) map.fitBounds(L.latLngBounds(st.course.latlngs), { padding: [16, 16] });
    var empty = $('outdMapEmpty');
    if (empty) empty.style.display = 'none';
    var nav = $('outdNav');
    if (nav) nav.style.display = 'flex';
    setText('outdNavText', st.course.title ? st.course.title : '코스를 따라 이동하세요');
    setText('outdNavRemain', (st.course.totalM / 1000).toFixed(1) + ' km');
    setText('outd-ui-remain', (st.course.totalM / 1000).toFixed(st.course.totalM < 10000 ? 2 : 1));
  }

  /** 현재 위치에서 코스상 가장 가까운 지점(직전 위치 주변을 먼저 찾고, 멀면 전체 검색) */
  function nearestCourseIdx(lat, lng) {
    var c = st.course;
    var n = c.latlngs.length;
    var best = -1, bestD = Infinity;
    function scan(a, b) {
      for (var i = Math.max(0, a); i < Math.min(n, b); i++) {
        var d = hav(lat, lng, c.latlngs[i][0], c.latlngs[i][1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    scan(st.courseIdx - 30, st.courseIdx + 200);
    // 코스 전체 검색은 5초에 한 번만(이탈 상태에서 매초 최대 3만 점 계산 방지)
    if (bestD > OFF_COURSE_M * 2 && Date.now() - (st.lastFullScanAt || 0) > 5000) {
      st.lastFullScanAt = Date.now();
      scan(0, n);
    }
    return { idx: best, dist: bestD };
  }

  function turnWord(delta) {
    var a = Math.abs(delta);
    var side = delta > 0 ? '우' : '좌';
    if (a >= 135) return side + '측 유턴';
    if (a >= 60) return side + '회전';
    return side + '측 방향';
  }

  /* ---------- 회전 지점 확대 안내(2026-10-19) ----------
   * 다음 회전이 150m 안에 들어오면: 지도 위 큰 회전 화살표 카드(꺾이는 각도대로) + 남은 거리,
   * 지도에 회전 구간(앞뒤 40m) 노란 강조선·화살촉, 지도 확대(따라가기 중일 때), 150m·40m 진동 */
  function pointAtDist(D) {
    var c = st.course;
    var lo = 0, hi = c.cum.length - 1;
    D = Math.max(0, Math.min(c.totalM, D));
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (c.cum[mid] < D) lo = mid + 1; else hi = mid;
    }
    var i = Math.max(1, lo);
    var a = c.latlngs[i - 1], b = c.latlngs[i];
    var seg = c.cum[i] - c.cum[i - 1];
    var t = seg > 0 ? (D - c.cum[i - 1]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** 꺾이는 각도대로 그린 회전 화살표 SVG(위로 들어와서 delta 만큼 꺾여 나감) */
  function turnArrowSvg(delta) {
    if (Math.abs(delta) >= 135) {
      // 유턴: 위로 올라가 반원을 그리며 옆으로 내려오는 U 화살표(좌유턴은 좌우 대칭)
      var right = delta > 0;
      var fx = function (x) { return right ? x : 100 - x; };
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
        '<path d="M ' + fx(34) + ' 94 L ' + fx(34) + ' 42 A 20 20 0 0 ' + (right ? 1 : 0) + ' ' + fx(74) + ' 42 L ' + fx(74) + ' 62" ' +
        'fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<polygon points="' + fx(74) + ',84 ' + fx(61) + ',62 ' + fx(87) + ',62" fill="#ffffff"/>' +
        '</svg>';
    }
    var d = Math.max(-170, Math.min(170, delta)) * Math.PI / 180;
    var cx = 50, cy = 56, L = 34;
    var ex = cx + L * Math.sin(d), ey = cy - L * Math.cos(d);
    // 화살촉
    var hx = Math.sin(d), hy = -Math.cos(d);
    var px = -hy, py = hx;
    var tipX = ex + hx * 12, tipY = ey + hy * 12;
    var l1x = ex + px * 11, l1y = ey + py * 11, l2x = ex - px * 11, l2y = ey - py * 11;
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M 50 96 L 50 ' + cy + ' Q 50 ' + (cy - 6) + ' ' + (cx + 6 * Math.sin(d)).toFixed(1) + ' ' + (cy - 6 * Math.cos(d)).toFixed(1) + ' L ' + ex.toFixed(1) + ' ' + ey.toFixed(1) + '" ' +
      'fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<polygon points="' + tipX.toFixed(1) + ',' + tipY.toFixed(1) + ' ' + l1x.toFixed(1) + ',' + l1y.toFixed(1) + ' ' + l2x.toFixed(1) + ',' + l2y.toFixed(1) + '" fill="#ffffff"/>' +
      '</svg>';
  }

  function turnBigEl() {
    var el = $('outdTurnBig');
    if (el) return el;
    var wrap = document.querySelector('#' + SCREEN_ID + ' .outd-map-wrap');
    if (!wrap) return null;
    el = document.createElement('div');
    el.id = 'outdTurnBig';
    el.className = 'outd-turn-big';
    el.innerHTML = '<div class="outd-turn-big__arrow"></div><div class="outd-turn-big__info"><b class="outd-turn-big__dist"></b><span class="outd-turn-big__word"></span></div>';
    wrap.appendChild(el);
    return el;
  }

  function showTurnBig(turn, dm) {
    var el = turnBigEl();
    if (!el) return;
    if (st.turnBigIdx !== turn.idx) {
      st.turnBigIdx = turn.idx;
      el.querySelector('.outd-turn-big__arrow').innerHTML = turnArrowSvg(turn.delta);
      el.querySelector('.outd-turn-big__word').textContent = turnWord(turn.delta);
      st.turnBuzz = {};
    }
    var dist = dm >= 100 ? Math.round(dm / 10) * 10 + 'm' : Math.max(0, Math.round(dm / 5) * 5) + 'm';
    var distEl = el.querySelector('.outd-turn-big__dist');
    if (distEl.textContent !== dist) distEl.textContent = dist;
    el.classList.toggle('is-near', dm <= 40);
    el.style.display = 'flex';
    // 150m 진입 1회·40m 진입 1회: 진동 + 알림음 + 음성
    var word = turn.text || turnWord(turn.delta);
    if (!st.turnBuzz.far) {
      st.turnBuzz.far = true;
      try { if (navigator.vibrate) navigator.vibrate(150); } catch (e) {}
      cue('turnFar', voiceDist(dm) + ' 후 ' + word);
    }
    if (dm <= 40 && !st.turnBuzz.near) {
      st.turnBuzz.near = true;
      try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) {}
      cue('turnNear', '곧 ' + turnWord(turn.delta));
    }
    drawTurnOnMap(turn);
    if (st.follow && st.map && st.lastFix && st.map.getZoom() < TURN_ZOOM && !st.turnZoomed) {
      st.turnZoomed = true;
      st.zoomBeforeTurn = st.map.getZoom();
      followUser(st.lastFix.lat, st.lastFix.lng, TURN_ZOOM);
    }
  }

  function hideTurnBig() {
    var el = $('outdTurnBig');
    if (el && el.style.display !== 'none') el.style.display = 'none';
    st.turnBigIdx = null;
    clearTurnOnMap();
    if (st.turnZoomed && st.map && st.follow) {
      if (st.lastFix) followUser(st.lastFix.lat, st.lastFix.lng, st.zoomBeforeTurn || 16);
      else st.map.setZoom(st.zoomBeforeTurn || 16, { animate: true });
    }
    st.turnZoomed = false;
  }

  function drawTurnOnMap(turn) {
    if (!st.map || st.turnLayerIdx === turn.idx) return;
    clearTurnOnMap();
    var L = window.L;
    var pts = [];
    for (var dd = -40; dd <= 40; dd += 5) pts.push(pointAtDist(turn.at + dd));
    st.turnLayer = L.layerGroup().addTo(st.map);
    L.polyline(pts, { color: '#111827', weight: 11, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(st.turnLayer);
    L.polyline(pts, { color: '#fbbf24', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(st.turnLayer);
    // 화살촉: 끝점에서 진행 방향으로 삼각형
    var e1 = pts[pts.length - 2], e2 = pts[pts.length - 1];
    var map = st.map;
    var p1 = map.latLngToLayerPoint(e1), p2 = map.latLngToLayerPoint(e2);
    var vx = p2.x - p1.x, vy = p2.y - p1.y;
    var len = Math.sqrt(vx * vx + vy * vy) || 1;
    vx /= len; vy /= len;
    var size = 14;
    var tip = L.point(p2.x + vx * size, p2.y + vy * size);
    var left = L.point(p2.x - vy * size * 0.7, p2.y + vx * size * 0.7);
    var right = L.point(p2.x + vy * size * 0.7, p2.y - vx * size * 0.7);
    L.polygon([map.layerPointToLatLng(tip), map.layerPointToLatLng(left), map.layerPointToLatLng(right)], {
      color: '#111827', weight: 2, fillColor: '#fbbf24', fillOpacity: 1
    }).addTo(st.turnLayer);
    st.turnLayerIdx = turn.idx;
    if (st.meMarker && st.meMarker.bringToFront) st.meMarker.setZIndexOffset(1000);
  }

  function clearTurnOnMap() {
    if (st.turnLayer && st.map) st.map.removeLayer(st.turnLayer);
    st.turnLayer = null;
    st.turnLayerIdx = null;
  }

  function updateNavigation(lat, lng) {
    if (!st.course || !st.course.latlngs.length) return;
    var r = nearestCourseIdx(lat, lng);
    if (r.idx < 0) return;
    st.courseIdx = r.idx;
    var c = st.course;
    var nav = $('outdNav');
    var arrow = $('outdNavArrow');
    var remainM = Math.max(0, c.totalM - c.cum[r.idx]);
    setText('outdNavRemain', '남은 ' + (remainM / 1000).toFixed(1) + ' km');
    setText('outd-ui-remain', (remainM / 1000).toFixed(remainM < 10000 ? 2 : 1));
    var offCourse = r.dist > OFF_COURSE_M + Math.min(30, (st.lastFix && st.lastFix.acc) || 0);
    if (nav) nav.classList.toggle('is-off', offCourse);
    if (offCourse) {
      // 코스로 돌아가는 방향
      var p = c.latlngs[r.idx];
      var toCourse = bearing(lat, lng, p[0], p[1]);
      hideTurnBig();
      setText('outdNavText', (c.isRoute ? '경로를 벗어났습니다 · ' : '코스를 벗어났습니다 · ') + Math.round(r.dist) + 'm');
      if (!st.offCued && st.speedKmh >= 3) { st.offCued = true; cue('off', c.isRoute ? '경로를 벗어났습니다' : '코스를 벗어났습니다'); }
      maybeReroute();
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(toCourse) + 'deg)';
      return;
    }
    st.offRouteSince = 0;
    st.offCued = false;
    st.lastOnRouteIdx = r.idx;
    if (remainM < 30) {
      hideTurnBig();
      setText('outdNavText', c.isRoute ? '목적지에 도착했습니다' : '도착 지점입니다');
      if (!c.arrivedCue) { c.arrivedCue = true; cue('arrive', c.isRoute ? '목적지에 도착했습니다' : '코스 도착 지점입니다'); }
      if (arrow) { arrow.textContent = '🏁'; arrow.style.transform = 'none'; }
      return;
    }
    if (arrow && arrow.textContent !== '↑') arrow.textContent = '↑';
    var here = c.cum[r.idx];
    var next = null;
    for (var i = 0; i < c.turns.length; i++) {
      if (c.turns[i].at > here + 8) { next = c.turns[i]; break; }
    }
    if (next && next.at - here <= TURN_ANNOUNCE_M) {
      var dm = next.at - here;
      var dist = dm >= 100 ? Math.round(dm / 10) * 10 + 'm' : Math.max(10, Math.round(dm / 5) * 5) + 'm';
      setText('outdNavText', dist + ' 후 ' + (next.text || turnWord(next.delta)));
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(Math.max(-150, Math.min(150, next.delta))) + 'deg)';
      if (dm <= TURN_BIG_M) showTurnBig(next, dm);
      else hideTurnBig();
    } else {
      hideTurnBig();
      setText('outdNavText', next ? '코스를 따라 직진 · ' + ((next.at - here) / 1000).toFixed(1) + ' km 후 회전' : '코스를 따라 직진');
      if (arrow) arrow.style.transform = 'none';
    }
  }

  /** GPX → [[lat,lng],...] — 내비게이션 정밀도를 위해 줄이지 않고(5m 이내 연속 점만 정리) 최대 30000점 */
  function parseCourseGpx(text) {
    var doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX 형식이 올바르지 않습니다.');
    var nodes = doc.querySelectorAll('trkpt, rtept');
    var out = [];
    for (var i = 0; i < nodes.length && out.length < 30000; i++) {
      var lat = parseFloat(nodes[i].getAttribute('lat'));
      var lon = parseFloat(nodes[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      var lp = out[out.length - 1];
      if (lp && hav(lp[0], lp[1], lat, lon) < 5) continue;
      out.push([lat, lon]);
    }
    return out;
  }

  function loadCourseFromUrl(url, title) {
    if (!url) return Promise.resolve();
    setText('outdNavText', '코스맵 불러오는 중...');
    return fetch(url, { cache: 'force-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (txt) {
        var latlngs = parseCourseGpx(txt);
        if (latlngs.length < 2) throw new Error('코스 포인트가 없습니다.');
        hideTurnBig();
        st.course = prepareCourse(title || '', latlngs);
        st.courseIdx = 0;
        drawCourse();
        if (st.lastFix) updateNavigation(st.lastFix.lat, st.lastFix.lng);
      })
      .catch(function (e) {
        toast('코스맵을 불러오지 못했습니다: ' + ((e && e.message) || e), 'error');
      });
  }

  /* ---------- 길찾기(2026-10-20): 목적지 검색 + 자전거 경로 안내 ----------
   * 검색: Photon(OSM, 입력하는 대로, 현재 위치 우선) → 결과 없으면 Nominatim(OSM).
   * 경로: Valhalla(FOSSGIS 공개 서버) 자전거 모드 — 자전거 통행 금지 도로(자동차 전용·bicycle=no) 자동 제외,
   *   [자전거도로 우선] use_roads 0.2(자전거 도로·한적한 길 선호) / [최단 거리] shortest. 한국어 회전 안내문 사용.
   * 안내: 기존 코스 안내(회전 카드·지도 강조·진동) 재사용, 경로 이탈 10초 이상이면 현재 위치에서 다시 탐색(30초에 1회). */
  var VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
  var PHOTON_URL = 'https://photon.komoot.io/api/';
  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  function decodePolyline6(str) {
    var idx = 0, lat = 0, lng = 0, out = [];
    while (idx < str.length) {
      var b, shift = 0, res = 0;
      do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += res & 1 ? ~(res >> 1) : res >> 1;
      shift = 0; res = 0;
      do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += res & 1 ? ~(res >> 1) : res >> 1;
      out.push([lat / 1e6, lng / 1e6]);
    }
    return out;
  }

  /** Valhalla 회전 종류 → 화살표 각도(+ 오른쪽). 안내하지 않는 종류는 null */
  function maneuverDelta(type) {
    switch (type) {
      case 9: return 35; case 10: return 90; case 11: return 135; case 12: return 170;
      case 13: return -170; case 14: return -135; case 15: return -90; case 16: return -35;
      case 18: case 20: case 23: return 25; case 19: case 21: case 24: return -25;
      case 26: case 27: return 90; // 회전교차로
      default: return null;
    }
  }

  function fetchJson(url, opts) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(url, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts || {}))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  /** @returns {Promise<{ name: string, sub: string, lat: number, lng: number }[]>} */
  function searchPlaces(q) {
    var here = st.lastFix;
    // lang=default: 기기 언어(영문 등)와 무관하게 현지(한글) 이름
    var url = PHOTON_URL + '?limit=8&lang=default&q=' + encodeURIComponent(q) + (here ? '&lat=' + here.lat.toFixed(5) + '&lon=' + here.lng.toFixed(5) : '');
    return fetchJson(url).then(function (d) {
      var list = (d && d.features || []).map(function (f) {
        var p = f.properties || {};
        var c = f.geometry && f.geometry.coordinates;
        if (!c) return null;
        var sub = [p.city || p.county || '', p.district || p.locality || '', p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '']
          .filter(Boolean).join(' ');
        return { name: p.name || p.street || q, sub: sub, lat: c[1], lng: c[0] };
      }).filter(Boolean);
      if (list.length) return list;
      return fetchJson(NOMINATIM_URL + '?format=jsonv2&limit=8&countrycodes=kr&accept-language=ko&q=' + encodeURIComponent(q)).then(function (n) {
        return (n || []).map(function (x) {
          return { name: x.name || String(x.display_name || '').split(',')[0], sub: String(x.display_name || '').split(',').slice(1, 4).join(','), lat: Number(x.lat), lng: Number(x.lon) };
        });
      });
    });
  }

  /**
   * @param {'bike'|'short'} mode
   * @param {{ heading?: number, via?: {lat:number,lng:number} }} [opt]
   *   heading: 출발 시 진행 방향(°) — 지금 달리는 방향으로 출발하는 경로(바로 유턴 안내 방지)
   *   via: 경유(through) 지점 — 원래 경로 앞쪽에 다시 합류하는 재탐색 후보용
   */
  function fetchBikeRoute(from, to, mode, opt) {
    opt = opt || {};
    var start = { lat: from.lat, lon: from.lng };
    if (opt.heading != null && isFinite(opt.heading)) {
      start.heading = Math.round(opt.heading);
      start.heading_tolerance = 60;
    }
    var locs = [start];
    if (opt.via) locs.push({ lat: opt.via.lat, lon: opt.via.lng, type: 'through' });
    locs.push({ lat: to.lat, lon: to.lng });
    var body = {
      locations: locs,
      costing: 'bicycle',
      costing_options: {
        bicycle: mode === 'short'
          ? { bicycle_type: 'Hybrid', shortest: true }
          : { bicycle_type: 'Hybrid', use_roads: 0.2, use_hills: 0.4, avoid_bad_surfaces: 0.3 }
      },
      language: 'ko-KR',
      units: 'kilometers'
    };
    return fetchJson(VALHALLA_URL + '?json=' + encodeURIComponent(JSON.stringify(body))).then(function (d) {
      var trip = d && d.trip;
      if (!trip || trip.status !== 0 || !trip.legs || !trip.legs.length) throw new Error('경로를 찾지 못했습니다.');
      var leg = trip.legs[0];
      return {
        mode: mode,
        latlngs: decodePolyline6(leg.shape),
        maneuvers: leg.maneuvers || [],
        km: trip.summary.length,
        min: Math.round(trip.summary.time / 60)
      };
    });
  }

  /** 경로를 코스로 등록(회전 안내는 Valhalla 안내문 기준) */
  function useRouteAsCourse(route, dest) {
    hideTurnBig();
    var course = prepareCourse(dest.name, route.latlngs);
    var turns = [];
    route.maneuvers.forEach(function (m) {
      var delta = maneuverDelta(m.type);
      var i = m.begin_shape_index;
      if (delta == null || i == null || i <= 0 || i >= course.cum.length) return;
      var text = String(m.instruction || '').replace(/\.$/, '');
      turns.push({ at: course.cum[i], delta: delta, idx: i, text: text });
    });
    if (turns.length) course.turns = turns;
    course.isRoute = true;
    course.dest = dest;
    course.routeMode = route.mode;
    st.course = course;
    st.courseIdx = 0;
    st.offRouteSince = 0;
    st.lastOnRouteIdx = null;
    drawCourse();
    drawDestMarker(dest);
    if (st.lastFix) updateNavigation(st.lastFix.lat, st.lastFix.lng);
  }

  function drawDestMarker(dest) {
    if (!st.map || !st.courseLayer) return;
    var L = window.L;
    L.marker([dest.lat, dest.lng], {
      icon: L.divIcon({ className: '', html: '<div class="outd-dest-pin">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] }),
      interactive: false
    }).addTo(st.courseLayer);
  }

  /*
   * 경로 이탈 재탐색(2026-10-20) — 자전거 내비(가민·코무트 방식) 기준
   *  1) 판정: GPS 정확도에 맞춘 허용 거리 밖 + 실제 이동 중(3 km/h↑) + 경로에서 점점 멀어지거나 80m 이상 → 약 6초 유지 시 이탈
   *     (경로 옆에서 쉬거나 교차로를 도는 순간은 재탐색하지 않음)
   *  2) 원래 선택한 방식(자전거도로 우선 / 최단 거리) 그대로, 현재 진행 방향으로 출발하는 경로(heading)
   *  3) 후보 두 개 비교: ① 원래 경로 앞쪽(약 200m 앞)으로 합류 후 목적지 ② 목적지까지 새 경로
   *     → ①이 ②보다 15% 이내로 길면 ①(고른 경로 유지), 아니면 ②
   *  4) 간격: 첫 재탐색 6초, 연속이면 15초 → 30초. 목적지 150m 안에서는 재탐색 안 함.
   */
  var REROUTE_STEPS_MS = [0, 15000, 30000];
  function maybeReroute() {
    var c = st.course;
    if (!c || !c.isRoute || !st.lastFix || st.rerouting) return;
    var now = Date.now();
    var fix = st.lastFix;
    var r = nearestCourseIdx(fix.lat, fix.lng);
    var destDist = hav(fix.lat, fix.lng, c.dest.lat, c.dest.lng);
    if (destDist < 150) return;
    if (st.speedKmh < 3) { st.offRouteSince = 0; return; } // 멈춰 있으면(휴식 등) 재탐색 안 함
    if (!st.offRouteSince) {
      st.offRouteSince = now;
      st.offRouteStartDist = r.dist;
      return;
    }
    var gettingFarther = r.dist > (st.offRouteStartDist || 0) + 5 || r.dist > 80;
    if (now - st.offRouteSince < 6000 || !gettingFarther) return;
    // 연속 재탐색 간격(2분 안에 반복되면 점점 길게)
    if (now - (st.lastRerouteAt || 0) > 120000) st.rerouteCount = 0;
    var wait = REROUTE_STEPS_MS[Math.min(st.rerouteCount || 0, REROUTE_STEPS_MS.length - 1)];
    if (now - (st.lastRerouteAt || 0) < wait) return;
    st.lastRerouteAt = now;
    st.rerouteCount = (st.rerouteCount || 0) + 1;
    st.rerouting = true;
    setText('outdNavText', '경로를 다시 찾는 중...');

    var mode = c.routeMode || 'bike';
    var from = { lat: fix.lat, lng: fix.lng };
    var heading = st.heading != null && st.speedKmh >= 5 ? st.heading : null;
    // 합류 지점: 마지막으로 경로 위에 있던 곳에서 약 200m 앞(남은 경로가 짧으면 목적지)
    var baseIdx = st.lastOnRouteIdx != null ? st.lastOnRouteIdx : r.idx;
    var rejoinAt = c.cum[baseIdx] + 200;
    var via = rejoinAt < c.totalM - 150 ? (function () { var p = pointAtDist(rejoinAt); return { lat: p[0], lng: p[1] }; })() : null;

    var fresh = fetchBikeRoute(from, c.dest, mode, { heading: heading }).catch(function () { return null; });
    var rejoin = via ? fetchBikeRoute(from, c.dest, mode, { heading: heading, via: via }).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([rejoin, fresh]).then(function (res) {
      var rj = res[0], fr = res[1];
      var pick = null, how = '';
      if (rj && fr) {
        if (rj.km <= fr.km * 1.15) { pick = rj; how = '원래 경로로 합류'; } else { pick = fr; how = '새 경로'; }
      } else {
        pick = rj || fr;
        how = rj ? '원래 경로로 합류' : '새 경로';
      }
      if (!pick) throw new Error('no route');
      // 재탐색 안내를 먼저 말하고, 이어서 새 경로의 첫 회전 안내(useRouteAsCourse → showTurnBig)가 뒤따르게
      cue('reroute', '경로를 다시 안내합니다');
      useRouteAsCourse(pick, c.dest);
      st.offRouteSince = 0;
      try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch (e) {}
      st.offCued = false;
      toast('경로를 다시 안내합니다 · ' + how + ' · ' + pick.km.toFixed(1) + ' km (' + (mode === 'short' ? '최단 거리' : '자전거도로 우선') + ')', 'info');
    }).catch(function () {
      setText('outdNavText', '경로를 다시 찾지 못했습니다 · 잠시 후 다시 시도합니다');
    }).then(function () {
      st.rerouting = false;
    });
  }

  function routeSheet() {
    var el = $('outdRouteSheet');
    if (el) return el;
    var screen = $(SCREEN_ID);
    el = document.createElement('div');
    el.id = 'outdRouteSheet';
    el.className = 'coachm-picker outd-route';
    el.style.display = 'none';
    el.innerHTML =
      '<div class="coachm-picker__sheet outd-route__sheet">' +
      '<div class="coachm-picker__head"><span>길찾기</span><button type="button" class="coachm-picker__close" data-route-close aria-label="닫기">✕</button></div>' +
      '<div class="outd-route__search"><input id="outdRouteInput" type="search" placeholder="목적지 검색 (장소·주소)" autocomplete="off" enterkeyhint="search"></div>' +
      '<div id="outdRouteList" class="coachm-picker__list outd-route__list"></div>' +
      '<div class="outd-route__credit">경로: Valhalla(OSM) · 검색: Photon/Nominatim(OSM)</div>' +
      '</div>';
    screen.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.closest('[data-route-close]')) el.style.display = 'none';
    });
    var input = el.querySelector('#outdRouteInput');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { renderRouteList([]); return; }
      timer = setTimeout(function () { runSearch(q); }, 450);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(timer); var q = input.value.trim(); if (q) runSearch(q); }
    });
    return el;
  }

  var searchSeq = 0;
  function runSearch(q) {
    var seq = ++searchSeq;
    $('outdRouteList').innerHTML = '<div class="coachm-picker__empty">검색 중...</div>';
    searchPlaces(q).then(function (list) {
      if (seq !== searchSeq) return;
      renderRouteList(list);
    }).catch(function () {
      if (seq !== searchSeq) return;
      $('outdRouteList').innerHTML = '<div class="coachm-picker__empty">검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</div>';
    });
  }

  function renderRouteList(list) {
    var box = $('outdRouteList');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="coachm-picker__empty">' + ($('outdRouteInput').value.trim().length >= 2 ? '검색 결과가 없습니다.' : '가고 싶은 장소나 주소를 입력하세요.') + '</div>';
      return;
    }
    box.innerHTML = '';
    list.forEach(function (p) {
      var item = document.createElement('div');
      item.className = 'coachm-picker__item outd-route__place';
      var d = st.lastFix ? hav(st.lastFix.lat, st.lastFix.lng, p.lat, p.lng) / 1000 : null;
      item.innerHTML = '<span class="outd-route__name"></span><span class="outd-route__sub"></span><span class="coachm-picker__item-min"></span>';
      item.children[0].textContent = p.name;
      item.children[1].textContent = p.sub || '';
      item.children[2].textContent = d != null ? (d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km') : '';
      item.addEventListener('click', function () { chooseDestination(p); });
      box.appendChild(item);
    });
  }

  function chooseDestination(dest) {
    var box = $('outdRouteList');
    if (!st.lastFix) {
      box.innerHTML = '<div class="coachm-picker__empty">현재 위치(GPS)를 찾는 중입니다. 잠시 후 다시 선택해 주세요.</div>';
      return;
    }
    box.innerHTML = '<div class="coachm-picker__empty">자전거 경로를 찾는 중...</div>';
    var from = { lat: st.lastFix.lat, lng: st.lastFix.lng };
    Promise.all([
      fetchBikeRoute(from, dest, 'bike', { heading: st.speedKmh >= 5 ? st.heading : null }).catch(function () { return null; }),
      fetchBikeRoute(from, dest, 'short', { heading: st.speedKmh >= 5 ? st.heading : null }).catch(function () { return null; })
    ]).then(function (routes) {
      routes = routes.filter(Boolean);
      if (!routes.length) {
        box.innerHTML = '<div class="coachm-picker__empty">자전거로 갈 수 있는 경로를 찾지 못했습니다.</div>';
        return;
      }
      box.innerHTML = '<div class="outd-route__dest">🏁 ' + escHtml(dest.name) + '</div>';
      routes.forEach(function (rt) {
        var item = document.createElement('div');
        item.className = 'coachm-picker__item outd-route__opt' + (rt.mode === 'bike' ? ' is-reco' : '');
        item.innerHTML =
          '<span class="outd-route__optname">' + (rt.mode === 'bike' ? '🚲 자전거도로 우선 <em>추천</em>' : '📏 최단 거리') + '</span>' +
          '<span class="outd-route__optinfo">' + rt.km.toFixed(1) + ' km · 약 ' + rt.min + '분</span>';
        item.addEventListener('click', function () {
          unlockAudio();
          $('outdRouteSheet').style.display = 'none';
          useRouteAsCourse(rt, dest);
          toast('길안내를 시작합니다 · ' + rt.km.toFixed(1) + ' km', 'success');
        });
        box.appendChild(item);
      });
    });
  }

  function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  window.openOutdoorRouteSearch = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    var el = routeSheet();
    el.style.display = 'flex';
    var input = $('outdRouteInput');
    renderRouteList([]);
    setTimeout(function () { try { input.focus(); } catch (err) {} }, 50);
  };

  /* ---------- 메뉴 · 코스 선택 ---------- */
  window.toggleOutdoorRideMenu = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    unlockAudio();
    setText('outdSoundLabel', soundLabel());
    var m = $('outdMenu');
    if (m) m.classList.toggle('show');
  };
  function closeMenu() {
    var m = $('outdMenu');
    if (m) m.classList.remove('show');
  }
  document.addEventListener('click', function (e) {
    var m = $('outdMenu');
    if (m && m.classList.contains('show') && !e.target.closest('#outdMenu') && !e.target.closest('#outdMenuBtn')) closeMenu();
  });

  function currentUid() {
    try {
      if (window.authV9 && window.authV9.currentUser) return window.authV9.currentUser.uid;
    } catch (e) {}
    return (window.currentUser && window.currentUser.id) || '';
  }

  window.openOutdoorCoursePicker = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    var picker = $('outdCoursePicker');
    var list = $('outdCoursePickerList');
    if (!picker || !list) return;
    picker.style.display = 'flex';
    list.innerHTML = '<div class="coachm-picker__empty">코스맵을 불러오는 중...</div>';
    var client = window.openRidingReadClient;
    var uid = currentUid();
    if (!client || typeof client.fetchMyGpxCoursesRouted !== 'function' || !uid) {
      list.innerHTML = '<div class="coachm-picker__empty">코스맵 목록을 불러올 수 없습니다.</div>';
      return;
    }
    client.fetchMyGpxCoursesRouted(uid, 'CYCLE').then(function (courses) {
      courses = Array.isArray(courses) ? courses.filter(function (c) { return c && c.gpxUrl; }) : [];
      if (!courses.length) {
        list.innerHTML = '<div class="coachm-picker__empty">저장된 코스맵이 없습니다.<br>라이딩 모임에서 GPX 코스를 등록하면 여기에 표시됩니다.</div>';
        return;
      }
      list.innerHTML = '';
      courses.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'coachm-picker__item';
        var km = Number(c.distanceKm || c.distance_km || 0);
        item.innerHTML = '<span class="coachm-picker__item-title"></span><span class="coachm-picker__item-min"></span>';
        item.firstChild.textContent = c.title || c.name || '코스';
        item.lastChild.textContent = km > 0 ? km.toFixed(1) + ' km' : '';
        item.addEventListener('click', function () {
          window.closeOutdoorCoursePicker();
          loadCourseFromUrl(c.gpxUrl, c.title || c.name || '');
        });
        list.appendChild(item);
      });
    }).catch(function () {
      list.innerHTML = '<div class="coachm-picker__empty">코스맵 목록을 불러오지 못했습니다.</div>';
    });
  };
  /** 자유 라이딩: 코스맵 없이 현재 위치 기준으로 기록(코스 안내·회전 안내 끄기) */
  window.startOutdoorFreeRide = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    hideTurnBig();
    st.course = null;
    st.courseIdx = 0;
    if (st.courseLayer && st.map) { st.map.removeLayer(st.courseLayer); st.courseLayer = null; }
    var nav = $('outdNav');
    if (nav) nav.style.display = 'none';
    var empty = $('outdMapEmpty');
    if (empty) {
      empty.innerHTML = '자유 라이딩 · 현재 위치 기준으로 기록합니다<br><small>시작 버튼을 누르면 기록이 시작됩니다</small>';
      empty.style.display = '';
    }
    st.follow = true;
    if (st.lastFix) followUser(st.lastFix.lat, st.lastFix.lng, Math.max(st.map ? st.map.getZoom() : 16, 16));
    toast('자유 라이딩 모드 · 코스 없이 현재 위치 기준으로 기록합니다', 'info');
  };

  window.closeOutdoorCoursePicker = function () {
    var picker = $('outdCoursePicker');
    if (picker) picker.style.display = 'none';
  };

  /* ---------- 시작 · 일시정지 · 종료 ---------- */
  function startTimer() {
    if (st.timer) return;
    st.timer = setInterval(renderStats, 1000);
  }

  window.toggleOutdoorRide = function () {
    unlockAudio();
    if (st.status === 'running') {
      st.elapsedMs += Date.now() - st.runSince;
      st.runSince = 0;
      st.status = 'paused';
      toast('라이딩 일시정지', 'info');
    } else {
      if (!st.lastFix) toast('GPS 신호를 찾는 중입니다. 신호가 잡히면 거리가 기록됩니다.', 'info');
      if (!st.startedAt) st.startedAt = Date.now();
      st.runSince = Date.now();
      st.status = 'running';
      // 일시정지 동안 이동한 거리는 넣지 않도록 기준 위치를 지금으로
      st.lastTrackPt = st.lastFix ? [st.lastFix.lat, st.lastFix.lng, null, Date.now()] : st.lastTrackPt;
    }
    renderToggle();
    renderStats();
  };

  function hasRideData() {
    return st.distanceM >= 50 || elapsedNow() >= 60000;
  }

  /** Google encoded polyline (훈련 일지 지도용 summary_polyline) */
  function encodePolyline(points) {
    var out = '';
    var pLat = 0, pLng = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : v << 1;
      var s = '';
      while (v >= 0x20) {
        s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      return s + String.fromCharCode(v + 63);
    }
    points.forEach(function (p) {
      var lat = Math.round(p[0] * 1e5), lng = Math.round(p[1] * 1e5);
      out += enc(lat - pLat) + enc(lng - pLng);
      pLat = lat; pLng = lng;
    });
    return out;
  }
  function thin(points, maxN) {
    if (points.length <= maxN) return points;
    var step = (points.length - 1) / (maxN - 1);
    var out = [];
    for (var i = 0; i < maxN; i++) out.push(points[Math.round(i * step)]);
    return out;
  }

  function buildGpx() {
    var title = '아웃도어 라이딩' + (st.course && st.course.title ? ' · ' + st.course.title : '');
    var esc = function (s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
    var pts = st.track.map(function (p) {
      return '      <trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '">' +
        (p[2] != null ? '<ele>' + p[2] + '</ele>' : '') +
        '<time>' + new Date(p[3]).toISOString() + '</time></trkpt>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="STELVIO" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <metadata><name>' + esc(title) + '</name><time>' + new Date(st.startedAt || Date.now()).toISOString() + '</time></metadata>\n' +
      '  <trk><name>' + esc(title) + '</name><type>cycling</type><trkseg>\n' + pts + '\n  </trkseg></trk>\n</gpx>\n';
  }

  function downloadGpx() {
    if (st.track.length < 2) {
      toast('GPX로 저장할 경로가 없습니다.', 'error');
      return;
    }
    var d = new Date(st.startedAt || Date.now());
    var name = 'STELVIO_ride_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.gpx';
    var blob = new Blob([buildGpx()], { type: 'application/gpx+xml' });
    // 휴대폰(앱 포함)에서는 공유 시트로 파일 저장·전송, 안 되면 다운로드 링크
    try {
      var file = new File([blob], name, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file], title: name }).catch(function () {});
        return;
      }
    } catch (e) {}
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /** 훈련 일지 고도 그래프용: 경로를 따라 고도값 최대 200개(고도 없는 점 제외) */
  function elevationProfile() {
    var elev = st.track.filter(function (p) { return p[2] != null && isFinite(p[2]); }).map(function (p) { return p[2]; });
    if (elev.length < 2) return null;
    return thin(elev.map(function (v) { return [v]; }), 200).map(function (a) { return Math.round(a[0] * 10) / 10; });
  }

  function saveRide() {
    var uid = currentUid();
    if (!uid) return Promise.reject(new Error('로그인 후 저장할 수 있습니다.'));
    if (typeof window.saveStravaActivityToFirebase !== 'function') return Promise.reject(new Error('저장 모듈을 불러오지 못했습니다.'));
    var el = elapsedNow();
    var d = new Date(st.startedAt || Date.now());
    var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var km = Math.round(st.distanceM / 10) / 100;
    var avg = Math.round(avgSpeedKmh() * 10) / 10;
    var weight = Number((window.currentUser && (window.currentUser.weight || window.currentUser.weightKg)) || 0);
    return window.saveStravaActivityToFirebase({
      activity_id: 'outdoor_' + uid.slice(0, 8) + '_' + (st.startedAt || Date.now()),
      user_id: uid,
      source: 'stelvio_outdoor',
      activity_type: 'Ride',
      date: dateStr,
      title: st.course && st.course.title ? '아웃도어 라이딩 · ' + st.course.title : '자유 라이딩',
      distance_km: km,
      duration_sec: Math.round(el / 1000),
      time: Math.round(el / 1000),
      elevation_gain: Math.round(st.elevGainM),
      avg_speed_kmh: avg,
      tss: 0,
      weight: weight > 0 ? weight : null,
      summary_polyline: st.track.length >= 2 ? encodePolyline(thin(st.track, 1500)) : null,
      elevation_profile: elevationProfile(),
      max_speed_kmh: st.maxSpeedKmh > 0 ? Math.round(st.maxSpeedKmh * 10) / 10 : null,
      moving_time_sec: st.movingMs > 0 ? Math.round(st.movingMs / 1000) : null
    });
  }

  function resetRide() {
    st.status = 'idle';
    st.elapsedMs = 0;
    st.runSince = 0;
    st.startedAt = 0;
    st.distanceM = 0;
    st.elevGainM = 0;
    st.maxSpeedKmh = 0;
    st.movingMs = 0;
    st.altBase = null;
    st.altEma = null;
    st.track = [];
    st.lastTrackPt = null;
    if (st.trail) st.trail.setLatLngs([]);
    st.lastTrailPt = null;
    renderToggle();
    renderStats();
  }

  /** 종료: 요약 + [저장하고 종료] [GPX 받기] [계속 라이딩] */
  window.finishOutdoorRide = function () {
    if (st.status === 'idle' && !hasRideData()) {
      toast('라이딩을 시작하지 않았습니다.', 'info');
      return;
    }
    if (st.status === 'running') {
      st.elapsedMs += Date.now() - st.runSince;
      st.runSince = 0;
      st.status = 'paused';
      renderToggle();
    }
    var el = elapsedNow();
    var avg = avgSpeedKmh();
    var old = $('outdFinishModal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'outdFinishModal';
    m.className = 'outd-finish';
    m.innerHTML =
      '<div class="outd-finish__card" role="dialog" aria-modal="true">' +
      '<h3>라이딩 종료</h3>' +
      '<dl class="outd-finish__stats">' +
      '<div><dt>거리</dt><dd>' + (st.distanceM / 1000).toFixed(2) + ' km</dd></div>' +
      '<div><dt>시간</dt><dd>' + fmtHms(el) + '</dd></div>' +
      '<div><dt>평균 속도</dt><dd>' + (isFinite(avg) ? avg : 0).toFixed(1) + ' km/h</dd></div>' +
      '<div><dt>누적 고도</dt><dd>' + Math.round(st.elevGainM) + ' m</dd></div>' +
      '<div><dt>이동 시간</dt><dd>' + fmtHms(st.movingMs) + '</dd></div>' +
      '<div><dt>최고 속도</dt><dd>' + st.maxSpeedKmh.toFixed(1) + ' km/h</dd></div>' +
      '</dl>' +
      '<div class="outd-finish__btns">' +
      '<button type="button" class="outd-finish__btn outd-finish__btn--primary" data-act="save">훈련 일지에 저장하고 종료</button>' +
      '<button type="button" class="outd-finish__btn" data-act="gpx">GPX 파일 받기</button>' +
      '<button type="button" class="outd-finish__btn" data-act="discard">저장하지 않고 종료</button>' +
      '<button type="button" class="outd-finish__btn outd-finish__btn--ghost" data-act="resume">계속 라이딩</button>' +
      '</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'resume') {
        m.remove();
        window.toggleOutdoorRide();
      } else if (act === 'gpx') {
        downloadGpx();
      } else if (act === 'discard') {
        if (!window.confirm('이번 라이딩 기록을 저장하지 않고 종료할까요?')) return;
        m.remove();
        resetRide();
        toast('라이딩을 종료했습니다.', 'info');
      } else if (act === 'save') {
        btn.disabled = true;
        btn.textContent = '저장 중...';
        saveRide().then(function () {
          m.remove();
          resetRide();
          toast('훈련 일지에 저장했습니다.', 'success');
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = '훈련 일지에 저장하고 종료';
          toast('저장에 실패했습니다: ' + ((err && err.message) || err), 'error');
        });
      }
    });
  };

  /* 지도는 화면이 실제로 보인 뒤 크기를 다시 계산해야 타일이 전체에 그려진다 — 화면 활성화·회전·크기 변경 때 재계산 */
  function fixMapSize() {
    if (!isActive()) return;
    sizeRotLayer();
    if (st.map) st.map.invalidateSize();
  }
  (function watchScreen() {
    var el = $(SCREEN_ID);
    if (!el || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (isActive()) {
        setTimeout(fixMapSize, 50);
        setTimeout(fixMapSize, 400);
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { setTimeout(fixMapSize, 100); });
  })();

  /* ---------- 진입 · 나가기 ---------- */
  function activeScreenId() {
    var el = document.querySelector('.screen.active');
    return el && el.id !== SCREEN_ID ? el.id : '';
  }

  /**
   * @param {{ gpxUrl?: string, title?: string, rideId?: string }} [opts]
   */
  window.openOutdoorRide = function (opts) {
    opts = opts || {};
    st.prevScreen = activeScreenId() || st.prevScreen;
    if (typeof window.showScreen === 'function') window.showScreen(SCREEN_ID);
    var me = window.currentUser || {};
    setText('outd-user-name', me.name || '라이더');
    buildGaugeScale();
    renderToggle();
    renderStats();
    startTimer();
    // 지도는 화면이 보인 뒤 크기를 다시 계산해야 타일이 제대로 그려진다
    setTimeout(function () {
      ensureMap();
      fixMapSize();
      applyRotation();
      if (opts.gpxUrl) loadCourseFromUrl(opts.gpxUrl, opts.title || '');
    }, 80);
    setTimeout(fixMapSize, 600);
    startGps();
    kickLoop();
  };

  window.exitOutdoorRide = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    if (st.status !== 'idle' && hasRideData()) {
      window.finishOutdoorRide();
      return;
    }
    resetRide();
    stopGps();
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    var back = st.prevScreen || 'basecampScreen';
    if (typeof window.showScreen === 'function') window.showScreen(back);
  };
})();
