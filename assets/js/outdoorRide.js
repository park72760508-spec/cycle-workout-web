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
      var now = Date.now();
      var keep = !priority && speak.priorityUntil && now < speak.priorityUntil;
      if (!synth || !window.SpeechSynthesisUtterance) {
        // Android 앱(WebView)은 speechSynthesis 가 없다 — 1.0.7 이상 앱의 네이티브 TTS(AndroidBridge.speak) 사용
        var ab = window.AndroidBridge;
        if (ab && typeof ab.speak === 'function') {
          if (priority) speak.priorityUntil = now + 3500;
          setTimeout(function () { try { ab.speak(String(text), !keep); } catch (e) {} }, 380);
        }
        return;
      }
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
  /** 안내 거리: 10m 단위(100m → 90m → 80m … → 10m), 최소 10m — 카드·안내줄·음성 공통 */
  function navDistM(dm) {
    return Math.max(10, Math.round(dm / 10) * 10);
  }
  function voiceDist(dm) {
    var m = navDistM(dm);
    return m >= 1000 ? (m / 1000).toFixed(1) + '킬로미터' : m + '미터';
  }
  /** 상황별 소리 */
  function cue(kind, text) {
    switch (kind) {
      case 'turnFar': playTones([[880, 140, 0], [1175, 200, 160]]); break; // 분기점 접근: 띵-띵
      case 'turnPre': playTones([[880, 160, 0]], 0.25); break; // 미리 알림(약 30초 전): 짧은 한 번
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
    setText('outdExpDist', (st.distanceM / 1000).toFixed(2)); // 지도 크게 보기 위쪽 이동 거리
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
    deadReckon(); // GPS 끊김(터널 등) 추정 이동
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
    if (st.expanded) setText('outdExpSpeed', (st.speedKmh || 0).toFixed(1)); // 지도 크게 보기 위쪽 속도
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
    // 지도 크게 보기의 떠 있는 시작 버튼도 같은 상태(아이콘·녹색 펄스)
    var fimg = $('outdFloatToggleImg');
    if (fimg) fimg.setAttribute('src', st.status === 'running' ? 'assets/img/pause0.png' : 'assets/img/play0.png');
    var fctrl = $('outdFloatCtrl');
    if (fctrl) fctrl.classList.toggle('is-running', st.status === 'running');
    // 자유 라이딩 안내("시작 버튼을 누르면 기록이 시작됩니다")는 기록을 시작하면 숨김
    var empty = $('outdMapEmpty');
    if (empty && !st.course && st.status === 'running') empty.style.display = 'none';
  }

  /**
   * 지도 크게 보기(2026-10-21): 속도계를 숨기고 지도를 하단 정보(평균 속도·남은 거리·누적 고도) 위 테두리까지 확장.
   * 시작·정지는 지도 위 떠 있는 버튼, 내 위치는 화면 아래쪽(따라가기 기준점 65% → 80%). 다시 누르면 원래 화면.
   */
  /** 진단용(읽기 전용): 화면 표시 진행 거리·속도 — 시뮬레이션 검증(뒤로 감 여부 등)에 사용 */
  window.stelvioOutdoorDebug = function () {
    return { along: st.mo ? st.mo.along : null, v: st.mo ? st.mo.v : null, pos: st.mePos ? st.mePos.slice() : null, locked: !!st.navLocked, follow: !!st.follow, zooming: !!st.mapZooming, zoom: st.map ? st.map.getZoom() : null, turnZoomed: !!st.turnZoomed };
  };

  window.toggleOutdoorExpand = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    st.expanded = !st.expanded;
    var screen = $(SCREEN_ID);
    if (screen) screen.classList.toggle('outd-expanded', st.expanded);
    var btn = $('outdExpand');
    if (btn) {
      btn.setAttribute('aria-pressed', st.expanded ? 'true' : 'false');
      btn.setAttribute('aria-label', st.expanded ? '지도 원래 크기로' : '지도 크게 보기');
    }
    renderToggle();
    setText('outdExpSpeed', (st.speedKmh || 0).toFixed(1));
    setText('outdExpDist', (st.distanceM / 1000).toFixed(2));
    // 지도 크기가 바뀌었으니 다시 계산하고 내 위치 기준으로 다시 맞춤
    [40, 320].forEach(function (ms) {
      setTimeout(function () {
        fixMapSize();
        if (st.follow && st.map && (st.mePos || st.lastFix)) {
          var p = st.mePos || [st.lastFix.lat, st.lastFix.lng];
          followUser(p[0], p[1], null, false);
        }
      }, ms);
    });
  };

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
    ensureMap();

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
      /*
       * 이동 시간·거리(2026-10-21 수정 — 휴대폰 걷기 실측에서 이동 시간이 짧게·평균 속도가 5→7km/h 로 나오던 오류):
       *  예전: 기기 순간 속도 3km/h 이상일 때만 이동 시간에 넣어(걷기는 순간 속도가 3 밑으로 자주 떨어짐) 시간이 빠졌고,
       *        GPS 점마다 거리를 더해 좌우로 3~5m 씩 흔들리는 지그재그가 거리에 쌓였다 → 평균 = 거리÷시간이 크게 부풀음.
       *  지금: 움직임 = 최근 약 10초 동안 실제로 옮겨 간 거리(초속 0.6m=2.2km/h 이상) 또는 기기 속도 2.5km/h 이상,
       *        거리 = 마지막 기준점에서 10초가 지나거나 20m 이상 멀어졌을 때 그 직선 거리만 더함(GPS 흔들림이 쌓이지 않음).
       *  시뮬레이션: 5km/h 걷기 30분 — 평균 5.02~5.04km/h(실제 5.00), 자전거 커브 길 거리 오차 -1.7%
       */
      if (accOk) {
        var hist = st.mvHist || (st.mvHist = []);
        hist.push([t, lat, lng]);
        while (hist.length && t - hist[0][0] > 12000) hist.shift();
        var base = null;
        for (var hi = 0; hi < hist.length; hi++) { if (t - hist[hi][0] >= 8000) base = hist[hi]; }
        var winS = base ? (t - base[0]) / 1000 : 0;
        st.isMoving = (base && hav(base[1], base[2], lat, lng) / winS >= 0.6) || st.speedKmh >= 2.5;
        if (prev && dt > 0 && dt <= 30 && st.isMoving) {
          // 시작(재개) 이전 구간은 빼고, 경과 시간을 넘지 않게
          var fromMs = Math.max(prev.t, st.runSince || 0);
          if (t > fromMs) st.movingMs = Math.min(st.movingMs + (t - fromMs), elapsedNow());
        }
        var an = st.distAnchor;
        if (!an) {
          st.distAnchor = [t, lat, lng];
        } else {
          var da = hav(an[1], an[2], lat, lng);
          if (!st.isMoving) {
            if (t - an[0] >= 10000) st.distAnchor = [t, lat, lng]; // 멈춰 있을 때 흔들림은 거리에 넣지 않음
          } else if ((t - an[0] >= 10000 || da >= 20) && da / Math.max(1, (t - an[0]) / 1000) < 30) {
            st.distanceM += da;
            st.distAnchor = [t, lat, lng];
          }
        }
      }
      if (accOk && st.speedKmh > st.maxSpeedKmh && st.speedKmh < 100) st.maxSpeedKmh = st.speedKmh;
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
        // 자유 라이딩 지나온 길은 화면 표시 위치(아바타와 같은 위치)로 updateMeOnMap 에서 그림
      }
    }
    updateNavigation(lat, lng, t); // 맵매칭·길 방향(route-up) 먼저 정하고
    updateMeOnMap(lat, lng); // 그 방향 기준으로 지도 중심·내 위치 표시
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
    // 확대·축소 애니메이션 중에는 프레임 따라가기(followFrame)를 멈춤 — 서로 끊지 않게
    st.map.on('zoomstart', function () {
      st.mapZooming = true;
      // 확대 애니메이션이 중간에 끊겨 zoomend 가 안 오면 카메라가 멈춘 채로 남지 않게 1초 뒤 자동 해제
      clearTimeout(st.zoomGuard);
      st.zoomGuard = setTimeout(function () { if (st.mapZooming) { st.mapZooming = false; cameraFrame(); } }, 1000);
    });
    st.map.on('zoomend', function () { st.mapZooming = false; cameraFrame(); });
    // 자유 라이딩 지나온 길(2026-10-21): 진한 녹색(속도계 원호 녹색 계열의 가장 진한 색), 코스 안내선과 같은 굵기(10). 코스·길찾기 중에는 그리지 않음
    st.trail = L.polyline([], { color: '#15803d', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', smoothFactor: 0.5, interactive: false }).addTo(st.map);
    st.trailTip = L.polyline([], { color: '#15803d', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(st.map);
    st.trailRaw = [];
    st.trailDone = [];
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
    // 카메라 이동(translate)·회전 때도 화면 모서리가 비지 않게 대각선 + 여유(아바타 기준점 이동량 + 재정렬 여유)
    var D = Math.ceil(Math.sqrt(w * w + h * h)) + 2 * (Math.ceil(h * 0.3) + 160);
    rot.style.width = D + 'px';
    rot.style.height = D + 'px';
    rot.style.left = Math.round((w - D) / 2) + 'px';
    rot.style.top = Math.round((h - D) / 2) + 'px';
  }

  /*
   * 지도 회전(2026-10-21 개선): CSS 0.6초 회전 애니메이션은 화면 가운데를 축으로 도는 동안 지도 위치는 목표 방향 기준으로
   * 바로 맞춰져, 가운데보다 아래에 있는 내 위치 아바타가 방향이 바뀔 때마다 옆으로 휘었다 돌아왔다(좌우 흔들림).
   * → 회전 각도를 프레임마다 직접 부드럽게 바꾸고(st.dispRot), 같은 프레임에서 지도 위치도 "지금 보이는 각도"로 맞춤
   *   → 회전 중에도 아바타는 화면의 한 점에 고정되고 앞으로만 움직임.
   */
  function applyRotation() {
    var target = st.headingUp && st.heading != null ? -st.heading : 0;
    // 누적 각도로 회전(359°→1° 에서 한 바퀴 반대로 도는 것 방지)
    st.mapRotDeg = st.mapRotDeg == null ? target : st.mapRotDeg + angleDiff(st.mapRotDeg, target);
    if (st.dispRot == null || document.hidden) { st.dispRot = st.mapRotDeg; paintRotation(); }
    else kickRotation();
    setText('outdCompassMode', st.headingUp ? '진행' : '북쪽');
    // 지도 끌기는 Leaflet 기본 대신 회전 보정 핸들러(bindRotatedDrag)가 맡는다
    if (st.map && st.map.dragging) st.map.dragging.disable();
  }

  /** 지금 화면에 보이는 회전 각도를 지도·나침반·내 위치 화살표에 적용 */
  function paintRotation() {
    var d = (st.dispRot || 0).toFixed(2);
    cameraFrame(); // 지도 판: 이동(translate) + 회전을 한 번에
    var needle = $('outdCompassNeedle');
    if (needle) needle.style.transform = 'rotate(' + d + 'deg)'; // 빨간 끝 = 북쪽
    updateMeArrow();
  }
  /** 화면에 보이는 진행 방향(°) — 지도 위치 맞춤(followCenter)에 사용 */
  function dispHeading() {
    if (st.dispRot == null) return st.heading;
    return ((-st.dispRot % 360) + 360) % 360;
  }
  function kickRotation() {
    if (st.rotAnimId) return;
    var last = performance.now();
    function frame(now) {
      var dt = Math.min(100, now - last);
      last = now;
      var diff = st.mapRotDeg - st.dispRot;
      if (Math.abs(diff) < 0.05 || !isActive() || document.hidden) {
        st.dispRot = st.mapRotDeg;
        paintRotation();
        st.rotAnimId = null;
        return;
      }
      st.dispRot += diff * (1 - Math.exp(-dt / 220)); // 약 0.5초에 걸쳐 부드럽게
      paintRotation(); // 같은 프레임에서 카메라도 지금 각도 기준(아바타 고정)
      st.rotAnimId = requestAnimationFrame(frame);
    }
    st.rotAnimId = requestAnimationFrame(frame);
  }

  /**
   * 흔들림 없는 지도 방향(2026-10-21, 길안내·자유 라이딩 공통):
   * 목표 방향을 k 비율로 천천히 따라가고(지수 평활), 2.5° 미만 변화는 무시,
   * 직전과 반대 방향으로 8° 미만 되돌아가는 변화도 무시(좌우 번갈아 흔들림 방지). 실제 회전(큰 변화)은 바로 따라감.
   */
  function steadyHeading(target, k) {
    st.steadyHd = st.steadyHd == null ? target : (st.steadyHd + angleDiff(st.steadyHd, target) * k + 360) % 360;
    if (st.heading == null) { st.lastTurnSign = 0; setMapHeading(st.steadyHd); return; }
    var d = angleDiff(st.heading, st.steadyHd);
    if (Math.abs(d) < 2.5) return;
    var sg = d > 0 ? 1 : -1;
    if (st.lastTurnSign && sg !== st.lastTurnSign && Math.abs(d) < 8) return;
    st.lastTurnSign = sg;
    setMapHeading(st.steadyHd);
  }

  /** 지도 방향 적용(3° 이상 바뀔 때만 회전) */
  function setMapHeading(h) {
    st.heading = h;
    if (st.appliedHeading == null || Math.abs(angleDiff(st.appliedHeading, h)) >= 1) {
      st.appliedHeading = h;
      applyRotation();
    }
  }

  /** 내 위치 화살표: 카카오내비처럼 항상 화면 위쪽(2026-10-20) — 지도 판이 돌아간 만큼 반대로 돌려 화면에서 똑바로 위.
   *  지도가 진행(길) 방향을 위로 맞추므로 위쪽 = 진행 방향. */
  function updateMeArrow() {
    if (!st.meMarker || !st.meMarker.getElement) return;
    var el = st.meMarker.getElement();
    var dir = el && el.querySelector('.outd-me__dir');
    if (!dir) return;
    var deg = -(st.dispRot != null ? st.dispRot : st.mapRotDeg || 0);
    if (dir.__deg === deg) return;
    dir.__deg = deg;
    dir.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
  }

  function updateHeading(c, lat, lng) {
    // 실제 진행 방향(삼각형 표시용) — 코스 따라가는 중에도 계속 계산
    var mh = null;
    var sk = c.speed != null && isFinite(c.speed) ? c.speed * 3.6 : 0;
    if (c.heading != null && isFinite(c.heading) && sk >= 3) mh = c.heading;
    var mp = st.lastMovePt;
    if (mh == null && mp && hav(mp[0], mp[1], lat, lng) >= 8) mh = bearing(mp[0], mp[1], lat, lng);
    if (!mp || mh != null) st.lastMovePt = [lat, lng];
    if (mh != null) {
      st.moveHeading = st.moveHeading == null ? mh : (st.moveHeading + angleDiff(st.moveHeading, mh) * 0.5 + 360) % 360;
      updateMeArrow();
    }
    // 지도 방향: 코스·경로 위면 길 방향(route-up, updateNavigation), 자유 이동·이탈 중이면 위치 필터의 진행 방향(updateMeOnMap → freeHeading)
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
  /** 내 위치 아바타가 놓일 화면 높이: 화면 가운데에서 아래로 몇 px(기본 65% 지점, 크게 보기는 80%보다 아바타 5개 높이 위) */
  function anchorShiftPx() {
    if (!st.headingUp) return 0;
    var wrap = document.querySelector('#' + SCREEN_ID + ' .outd-map-wrap');
    var hPx = wrap ? wrap.clientHeight : 300;
    return st.expanded ? Math.max(0, hPx * 0.30 - 27 * 5) : hPx * 0.15;
  }
  /** (호환) 따라가기 지도 중심 = 내 위치 — 화면 기준점 맞춤은 카메라(cameraFrame)가 함 */
  function followCenter(lat, lng) { return [lat, lng]; }
  function followUser(lat, lng, zoom) {
    var map = st.map;
    if (!map) return;
    var z = zoom != null ? zoom : map.getZoom();
    map.setView([lat, lng], z, { animate: false });
    cameraFrame();
  }

  /*
   * 카메라(2026-10-21, 티맵식 흔들림 없는 이동):
   * 예전에는 매 프레임 Leaflet setView 로 지도를 다시 맞췄는데, Leaflet 이 픽셀 위치를 정수로 반올림해
   * 매 프레임 ±0.5px 씩 지도가 떨렸다(회전된 화면에서는 좌우 미세 흔들림). 프레임마다 지도를 다시 그려 배터리도 소모.
   * → 지도는 가만히 두고, 지도 판 전체를 GPU 변환(translate 소수점 + rotate)으로 움직여 아바타를 화면의 기준점에 정확히 둔다.
   *   아바타가 판 가운데에서 120px 넘게 멀어질 때만 지도 중심을 다시 맞추고, 같은 프레임에서 변환을 다시 계산해 이음매 없음.
   */
  function cameraFrame() {
    var rot = $('outdMapRot');
    var map = st.map;
    if (!rot) return;
    var th = st.dispRot || 0;
    if (map && st.follow && st.mePos && !st.mapZooming && rot.offsetWidth) {
      var wrap = rot.parentNode;
      var D = rot.offsetWidth, C = D / 2;
      var P = map.latLngToContainerPoint(st.mePos);
      if (Math.abs(P.x - C) > 120 || Math.abs(P.y - C) > 120) {
        map.setView(st.mePos, map.getZoom(), { animate: false });
        P = map.latLngToContainerPoint(st.mePos);
      }
      var ax = wrap.clientWidth / 2, ay = wrap.clientHeight / 2 + anchorShiftPx(); // 화면 기준점
      var r = th * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
      var vx = P.x - C, vy = P.y - C;
      var rx = vx * cs - vy * sn, ry = vx * sn + vy * cs; // CSS rotate(θ) (화면 y 아래 방향)
      st.camT = [ax - rot.offsetLeft - C - rx, ay - rot.offsetTop - C - ry];
    }
    var T = st.camT || [0, 0];
    rot.style.transform = 'translate(' + T[0].toFixed(2) + 'px,' + T[1].toFixed(2) + 'px) rotate(' + th.toFixed(2) + 'deg)';
  }
  /**
   * 확대·축소(회전 지점 확대·복귀, 속도 자동 확대) — 화면 가운데가 아니라 내 위치 아바타를 고정점으로(setZoomAround).
   * 가운데 기준이면 확대되는 0.2초 동안 아래쪽 아바타가 옆으로 밀렸다 돌아옴(실측 최대 35px) → 고정점 확대로 제거.
   * 따라가기 기준점(followCenter)은 화면 픽셀 거리라 확대 후에도 같은 자리.
   */
  function zoomKeepMe(z) {
    var map = st.map;
    if (!map) return;
    var p = st.mePos || (st.lastFix ? [st.lastFix.lat, st.lastFix.lng] : null);
    if (!p) { map.setZoom(z, { animate: true }); return; }
    if (map.getZoom() === z) return;
    if (st.follow) map.setZoomAround(window.L.latLng(p[0], p[1]), z, { animate: true });
    else map.setZoom(z, { animate: true });
  }

  /** 아이콘 이동 프레임마다 지도도 함께(헤딩업 따라가기) — 지도·아이콘이 따로 움직여 출렁이지 않게. 확대·축소 중엔 건너뜀 */
  function followFrame() {
    cameraFrame();
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
      var th = ((st.dispRot != null ? st.dispRot : st.mapRotDeg || 0) * Math.PI) / 180;
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

  /* ---------- 경로 맵매칭(2026-10-21) — 상용 내비(티맵·카카오) + 가민 코스 내비 방식을 자전거·걷기에 맞춤 ----------
   * 1) 투영: GPS 점에서 경로 선분에 수선을 내려 가장 가까운 "선분 위 점"과 진행 거리(along, m)를 연속 값으로 계산
   *    (꼭짓점 단위가 아니라서 긴 직선 구간에서도 남은 거리·회전까지 거리가 매끄럽게 줄어듦)
   * 2) 후보 점수(간이 HMM): (거리/GPS오차)² + 진행 방향 불일치 + 뒤로 가기·순간 점프 벌점
   *    → 왕복·순환 코스, 겹치는 구간, 나란한 길에서 반대편 경로로 튀지 않음(앞으로 나아가는 쪽 우선)
   * 3) 이동 수단별 기준(걷기는 더 좁게): 경로에 붙여 표시하는 범위, 이탈 판정 거리·지속 시간을 GPS 정확도에 맞춰 조정
   * 4) 경로를 잃으면(재탐색 직후·GPS 점프) 전체 경로에서 다시 찾음(3초에 한 번)
   */
  function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function navIsWalk() {
    var m = st.course && st.course.routeMode;
    if (m) return m === 'walk' || m === 'walkShort';
    return travelMode === 'walk';
  }
  function navParams() {
    var walk = navIsWalk();
    var acc = clampN((st.lastFix && st.lastFix.acc) || 10, 3, 60);
    return {
      walk: walk,
      sigma: clampN(acc, 5, 25), // 위치 오차 기준(m)
      snapM: LOCK_ACQUIRE_M, // 경로 고정 시작 거리(±15m) — 고정 후에는 이탈 확정 전까지 계속 경로 위 표시
      offM: (walk ? 25 : 35) + Math.min(20, acc * 0.5), // 이보다 멀면 이탈 후보
      offHoldMs: walk ? 5000 : 3000 // 이탈 후보가 이만큼 이어지면 이탈 확정
    };
  }
  /** 경로 선분 i(i-1 → i)에 수선을 내린 결과 */
  function projectOnSeg(c, i, lat, lng, kx, ky) {
    var a = c.latlngs[i - 1], b = c.latlngs[i];
    var ax = (a[1] - lng) * kx, ay = (a[0] - lat) * ky;
    var bx = (b[1] - lng) * kx, by = (b[0] - lat) * ky;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? clampN(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
    var px = ax + dx * t, py = ay + dy * t;
    return {
      seg: i,
      d: Math.sqrt(px * px + py * py),
      along: c.cum[i - 1] + (c.cum[i] - c.cum[i - 1]) * t,
      lat: lat + py / ky,
      lng: lng + px / kx,
      brg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
    };
  }
  /** 진행 거리 D 가 들어 있는 선분 번호 */
  function segAt(D) {
    var cum = st.course.cum, lo = 1, hi = cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] < D) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function resetMatch() {
    st.matchAlong = null;
    st.match = null;
    st.offSince = 0;
    st.lastOnRouteAlong = null;
    st.dispAlong = null;
    st.navAlong = null;
    st.navAlongAt = 0;
    st.navLocked = false;
  }
  /** @returns {{seg,d,along,lat,lng,brg}|null} */
  function matchCourse(lat, lng, t) {
    var c = st.course;
    if (!c || c.latlngs.length < 2) return null;
    var P = navParams();
    var kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
    var v = Math.max(0, st.speedKmh / 3.6);
    var hd = v >= 1.5 && st.moveHeading != null ? st.moveHeading : null;
    var last = st.matchAlong;
    var dtSec = st.matchAt ? clampN((t - st.matchAt) / 1000, 0, 30) : 1;
    function score(p, useProgress) {
      var s = (p.d / P.sigma) * (p.d / P.sigma);
      if (hd != null) s += 3 * (1 - Math.cos(angleDiff(hd, p.brg) * Math.PI / 180)); // 반대 방향이면 +6
      if (useProgress && last != null) {
        var back = last - p.along;
        if (back > 8) s += (back / 15) * (back / 15); // 뒤로 가기
        var fwd = p.along - (last + v * dtSec * 1.5 + 40);
        if (fwd > 0) s += (fwd / 60) * (fwd / 60); // 갈 수 없는 거리만큼 앞으로 점프
      }
      return s;
    }
    var best = null, bestS = Infinity, i, p, s;
    if (last != null) {
      var i0 = segAt(Math.max(0, last - 60));
      var i1 = segAt(Math.min(c.totalM, last + Math.max(250, v * 20 + 100)));
      for (i = Math.max(1, i0); i <= Math.min(c.latlngs.length - 1, i1); i++) {
        p = projectOnSeg(c, i, lat, lng, kx, ky);
        s = score(p, true);
        if (s < bestS) { bestS = s; best = p; }
      }
    }
    // 처음·경로를 잃었을 때: 전체에서 다시 찾기(3초에 한 번)
    if ((!best || best.d > P.offM * 2) && (last == null || Date.now() - (st.lastFullScanAt || 0) > 3000)) {
      st.lastFullScanAt = Date.now();
      var gBest = null, gS = Infinity;
      for (i = 1; i < c.latlngs.length; i++) {
        p = projectOnSeg(c, i, lat, lng, kx, ky);
        s = score(p, false);
        if (s < gS) { gS = s; gBest = p; }
      }
      if (gBest && (!best || gBest.d < best.d - 5)) best = gBest;
    }
    st.matchAt = t;
    if (best && best.d <= P.offM * 1.5) st.matchAlong = best.along;
    return best;
  }

  /** 화면 표시용: 경로 가까이면 경로 위 점(맵매칭 결과), 아니면 실제 GPS 위치 */
  function snapToCourse(lat, lng) {
    if (!st.course || !st.navLocked || st.navAlong == null) return null;
    return pointAtDist(st.navAlong);
  }

  /* ---------- 내 위치 아이콘 부드러운 이동(2026-10-21) ----------
   * GPS 는 1초에 한 번이라 아이콘이 툭툭 끊겨 움직인다 → 직전 표시 위치에서 새 위치까지 GPS 간격 동안 이어서 이동.
   * 경로 위에 붙어 있으면 직선이 아니라 경로를 따라(진행 거리 보간) 곡선·교차로도 자연스럽게.
   * 터널·고가 아래 등 GPS 가 2~15초 끊기면 마지막 속도로 경로를 따라 계속 이동한 것으로 추정 표시(티맵 터널 모드). */
  /* 자유 라이딩 지나온 길 곡선(2026-10-21): GPS 점(5m 간격)을 [1,4,6,4,1]/16 가중 평균해 부드럽게.
     앞뒤 2점이 생긴 점부터 확정하고, 확정되지 않은 끝부분만 매번 다시 그림 → 긴 라이딩에서도 가볍게 */
  var TRAIL_K = [1, 4, 6, 4, 1];
  function trailSmoothAt(i) {
    var r = st.trailRaw, n = r.length, la = 0, lo = 0, w = 0;
    for (var k = -2; k <= 2; k++) {
      var j = clampN(i + k, 0, n - 1);
      la += r[j][0] * TRAIL_K[k + 2];
      lo += r[j][1] * TRAIL_K[k + 2];
      w += TRAIL_K[k + 2];
    }
    return [la / w, lo / w];
  }
  function trailAdd(p) {
    if (!st.trail || !st.trailRaw) return;
    var r = st.trailRaw;
    var last = r[r.length - 1];
    if (last && hav(last[0], last[1], p[0], p[1]) < 8) return; // 8m 간격(곡선은 충분히 매끄럽고 긴 라이딩도 가볍게)
    r.push(p);
    var done = st.trailDone;
    while (done.length < r.length - 2) done.push(trailSmoothAt(done.length));
    // 확정된 곡선 + 아직 확정 안 된 끝부분(임시 평균). 마지막 점~아바타는 trailTip(프레임마다 아바타를 따라감)
    var tail = [];
    for (var i = done.length; i < r.length; i++) tail.push(trailSmoothAt(i));
    st.trail.setLatLngs(done.concat(tail));
    st.trailEnd = tail.length ? tail[tail.length - 1] : done[done.length - 1];
    trailTipTo(st.mePos);
  }
  function trailTipTo(p) {
    if (!st.trailTip || !st.trailEnd || !p || st.course) return;
    st.trailTip.setLatLngs([st.trailEnd, p]);
  }
  function trailClear() {
    st.trailRaw = [];
    st.trailDone = [];
    st.trailEnd = null;
    if (st.trail) st.trail.setLatLngs([]);
    if (st.trailTip) st.trailTip.setLatLngs([]);
  }

  function placeMe(lat, lng) {
    st.mePos = [lat, lng];
    if (st.meMarker) st.meMarker.setLatLng([lat, lng]);
    if (!st.course && st.status === 'running') trailTipTo(st.mePos); // 녹색 선 끝이 아바타에 붙어 따라감
  }
  /*
   * 연속 이동(2026-10-21, 티맵식): GPS(1초)마다 구간별로 끊어 움직이면 멈췄다 가는 출렁임·뒤로 당겨짐이 생긴다.
   * → 아바타는 매 프레임 "예측 속도"로 앞으로 계속 이동하고, GPS 와의 차이는 속도로만 약 2초에 걸쳐 메움
   *   (앞서면 살짝 느리게·뒤처지면 살짝 빠르게, 뒤로는 절대 가지 않음). 옆(좌우) 차이는 약 2.5초에 걸쳐 아주 천천히.
   *   = 업데이트를 덜 예민하게 반영하면서도 지연 없이 실제 위치를 따라감. 멈추면 루프도 멈춰 배터리 절약.
   * 경로 위(경로 고정)에서는 경로 진행 거리(along)로 움직여 항상 코스선 중심 위.
   */
  var CATCHUP_S = 2.0, LATERAL_S = 2.5;
  function setMotionTarget(lat, lng, along) {
    var acc = (st.lastFix && st.lastFix.acc) || 10;
    var now = performance.now();
    var v = Math.max(0, st.speedKmh / 3.6);
    if (!st.mo) st.mo = { pos: [lat, lng], along: along, v: v };
    // 정확도 나쁜 값(25m 초과)은 위치 보정에 쓰지 않고 예측을 이어감
    if (acc > 25 && st.mt) { st.mt.v = v; kickMotion(); return; }
    st.mt = { lat: lat, lng: lng, along: along, t: now, v: v };
    kickMotion();
  }
  /** 표시 속도는 부드럽게: 목표로 1초 시정수로 다가가되 초당 최대 4m/s 변화(급가속·급감속처럼 보이지 않게) */
  function smoothSpeed(v, want, dt) {
    var dv = (want - v) * Math.min(1, dt * 1.5);
    dv = clampN(dv, -4 * dt, 4 * dt);
    return Math.max(0, v + dv);
  }
  function kickMotion() {
    if (st.moId || document.hidden || !isActive()) return;
    st.moLast = performance.now();
    st.moId = requestAnimationFrame(motionStep);
  }
  function motionStep(now) {
    st.moId = null;
    var T = st.mt, M = st.mo;
    if (!T || !M) return;
    var dt = clampN((now - (st.moLast || now)) / 1000, 0, 0.1);
    st.moLast = now;
    var age = Math.min(15, (now - T.t) / 1000); // GPS 끊김(터널 등)도 15초까지 예측 이동
    var c = st.course, errAbs = 0, want;
    if (T.along != null && c && st.navLocked) {
      if (M.along == null) M.along = T.along;
      var tgt = Math.min(c.totalM, T.along + T.v * age);
      var e = tgt - M.along;
      if (Math.abs(e) > 60) { M.along = tgt; e = 0; }
      want = e < -15 ? 0 : Math.max(0, T.v + clampN(e / CATCHUP_S, -3, 3));
      M.v = smoothSpeed(M.v, want, dt);
      M.along = Math.min(c.totalM, M.along + M.v * dt);
      M.pos = pointAtDist(M.along);
      errAbs = Math.abs(e);
    } else {
      M.along = null;
      var kx = Math.cos(M.pos[0] * Math.PI / 180) * 111320, ky = 110540;
      var hd = st.steadyHd != null ? st.steadyHd : st.freeHd;
      var ux = 0, uy = 0;
      if (hd != null) { var hr = hd * Math.PI / 180; ux = Math.sin(hr); uy = Math.cos(hr); }
      // 예측 목표 = 마지막 표시 목표 + 진행 방향 × 속도 × 경과
      var tx = (T.lng - M.pos[1]) * kx + ux * T.v * age, ty = (T.lat - M.pos[0]) * ky + uy * T.v * age;
      var dist = Math.sqrt(tx * tx + ty * ty);
      if (dist > 60 || hd == null) {
        var k = dist > 60 ? 1 : Math.min(1, dt / 1.0);
        M.pos = [M.pos[0] + (ty * k) / ky, M.pos[1] + (tx * k) / kx];
        M.v = T.v;
      } else {
        var fwdErr = tx * ux + ty * uy;
        var latErr = tx * uy - ty * ux; // 오른쪽(+)
        want = fwdErr < -15 ? 0 : Math.max(0, T.v + clampN(fwdErr / CATCHUP_S, -3, 3));
        M.v = smoothSpeed(M.v, want, dt);
        var lk = Math.min(1, dt / LATERAL_S);
        var mx = ux * M.v * dt + uy * latErr * lk, my = uy * M.v * dt - ux * latErr * lk;
        M.pos = [M.pos[0] + my / ky, M.pos[1] + mx / kx];
      }
      errAbs = dist;
      if (!c && st.status === 'running') trailAdd(M.pos); // 지나온 길 = 아바타가 지나간 자리
    }
    placeMe(M.pos[0], M.pos[1]);
    cameraFrame();
    if (isActive() && !document.hidden && (M.v > 0.05 || errAbs > 0.3)) st.moId = requestAnimationFrame(motionStep);
  }
  /** GPS 끊김 추정 이동 — renderStats(1초)에서 호출 */
  function deadReckon() {
    var c = st.course, m = st.match;
    if (!c || !m || !st.onRoute || !st.meMarker || st.navAlong == null) return;
    var gap = Date.now() - st.lastFixAt;
    var v = st.drSpeed || 0; // m/s, 마지막 GPS 속도
    if (gap < 2000 || gap > 15000 || v < (navIsWalk() ? 0.8 : 2)) return;
    var along = Math.min(c.totalM, st.navAlong + Math.min(200, v * gap / 1000)); // 아바타는 연속 이동(motionStep)이 예측해 움직임
    kickMotion();
    setText('outdNavRemain', '남은 ' + (Math.max(0, c.totalM - along) / 1000).toFixed(1) + ' km · GPS 약함');
  }

  /**
   * 자유 이동 위치 필터(2026-10-21, 알파-베타 필터 — 위치·속도 예측 후 GPS 와 차이만큼만 보정):
   * 경로가 없을 때(자유 라이딩·이탈) GPS 흔들림으로 아이콘·지도가 출렁이지 않게. 멈춰 있을 때 오차 안의 흔들림은 무시(제자리 고정).
   * 40m 넘게 튀거나 5초 넘게 끊기면 측정값으로 다시 시작. 거리·기록은 원래 GPS 값 그대로.
   */
  function freeFilter(lat, lng, t, acc) {
    var f = st.ff;
    if (!f || t - f.t > 5000) {
      st.ff = { lat0: lat, lng0: lng, x: 0, y: 0, vx: 0, vy: 0, t: t };
      return [lat, lng];
    }
    var kx = Math.cos(f.lat0 * Math.PI / 180) * 111320, ky = 110540;
    var dt = clampN((t - f.t) / 1000, 0.2, 5);
    var mx = (lng - f.lng0) * kx, my = (lat - f.lat0) * ky;
    var px = f.x + f.vx * dt, py = f.y + f.vy * dt;
    var rx = mx - px, ry = my - py, rr = Math.sqrt(rx * rx + ry * ry);
    var v = st.speedKmh / 3.6;
    if (rr > 40) {
      f.x = mx; f.y = my; f.vx = 0; f.vy = 0;
    } else if (v < 0.6 && rr < Math.max(6, acc)) {
      f.vx *= 0.3; f.vy *= 0.3; // 정지: 제자리 유지
    } else {
      var a = acc > 20 ? 0.2 : 0.3, b = 0.08;
      f.x = px + a * rx; f.y = py + a * ry;
      f.vx += (b * rx) / dt; f.vy += (b * ry) / dt;
      // GPS 가 주는 속도·방향으로 속도를 살짝 맞춤(출발 직후 반응 빠르게)
      if (v >= 2 && st.moveHeading != null) {
        var hr = st.moveHeading * Math.PI / 180;
        f.vx = f.vx * 0.7 + Math.sin(hr) * v * 0.3;
        f.vy = f.vy * 0.7 + Math.cos(hr) * v * 0.3;
      }
    }
    f.t = t;
    return [f.lat0 + f.y / ky, f.lng0 + f.x / kx];
  }
  /**
   * 앞으로만 움직이는 표시(2026-10-21, 자유 이동): 필터 위치의 변화를 진행 방향 성분(앞)과 옆 성분으로 나눠
   * 앞은 그대로, 옆은 조금씩(12%)만 반영(6m 넘게 벗어나면 50%) → 좌우로 흔들리지 않고 앞으로 미끄러지듯 이동.
   * 실제로 길을 꺾으면 진행 방향(steadyHd)이 함께 돌아가 옆 성분이 앞 성분이 되므로 커브도 자연스럽게 따라감.
   */
  function forwardOnly(F) {
    var D = st.ffDisp;
    var hd = st.steadyHd != null ? st.steadyHd : st.freeHd;
    if (!D || hd == null) { st.ffDisp = F; return F; }
    var kx = Math.cos(D[0] * Math.PI / 180) * 111320, ky = 110540;
    var dx = (F[1] - D[1]) * kx, dy = (F[0] - D[0]) * ky;
    if (Math.sqrt(dx * dx + dy * dy) > 60) { st.ffDisp = F; return F; }
    var r = hd * Math.PI / 180, ux = Math.sin(r), uy = Math.cos(r);
    var fwd = dx * ux + dy * uy;
    var lat = dx * uy - dy * ux; // 오른쪽(+) 옆 성분
    if (st.speedKmh >= 3.6 && fwd < 0) fwd = 0; // 움직이는 중엔 뒤로 가지 않음
    var kl = Math.abs(lat) > 6 ? 0.5 : 0.12;
    var nx = dx === 0 && dy === 0 ? 0 : 1;
    var ex = ux * fwd + uy * lat * kl * nx, ey = uy * fwd - ux * lat * kl * nx;
    var out = [D[0] + ey / ky, D[1] + ex / kx];
    st.ffDisp = out;
    return out;
  }

  /** 자유 이동 지도 방향: 필터 속도 방향을 천천히(0.25) 따라가고 4° 미만 변화는 무시 */
  function freeHeading(fp) {
    // 진행 방향 = 25m 이상 뒤의 지점 → 지금 위치(1초 속도 방향보다 GPS 흔들림 영향이 훨씬 적음, 길안내의 50m 앞 방향과 같은 방식)
    var hist = st.hdHist || (st.hdHist = []);
    if (fp) {
      var lastH = hist[hist.length - 1];
      if (!lastH || hav(lastH[0], lastH[1], fp[0], fp[1]) >= 3) hist.push(fp);
      if (hist.length > 40) hist.shift();
    }
    if (st.speedKmh < 5 || !fp) return;
    var base = null;
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hav(hist[i][0], hist[i][1], fp[0], fp[1]) >= 25) { base = hist[i]; break; }
    }
    if (!base) return;
    steadyHeading(bearing(base[0], base[1], fp[0], fp[1]), 0.2);
  }

  function updateMeOnMap(lat, lng) {
    var snapped = snapToCourse(lat, lng);
    var along = null;
    if (snapped) {
      lat = snapped[0]; lng = snapped[1]; along = st.navAlong;
      st.ff = null; // 경로 위: 필터는 쉬고(경로 고정이 대신함), 벗어나면 그 자리에서 새로 시작
      st.ffDisp = null;
      st.hdHist = [];
    } else {
      var fp = freeFilter(lat, lng, Date.now(), (st.lastFix && st.lastFix.acc) || 10);
      if (!(st.course && st.onRoute)) freeHeading(fp);
      lat = fp[0]; lng = fp[1]; // 앞으로만·옆은 천천히 = 연속 이동(motionStep)이 처리, 지나온 길도 거기서
    }
    st.drSpeed = st.speedKmh / 3.6;
    var map = ensureMap();
    if (!map) return;
    var L = window.L;
    if (!st.meMarker) {
      st.meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="outd-me"><span class="outd-me__pulse"></span><span class="outd-me__pulse outd-me__pulse--2"></span><span class="outd-me__dot"></span><span class="outd-me__dir"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M10 2 L16.5 17 L10 12.6 L3.5 17 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/></svg></span></div>', iconSize: [27, 27], iconAnchor: [13.5, 13.5] }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
      st.mePos = [lat, lng];
      st.mo = { pos: [lat, lng], along: along, v: 0 };
      updateMeArrow();
      followUser(lat, lng, Math.max(map.getZoom(), 16));
    } else if (document.hidden) {
      placeMe(lat, lng);
      if (st.mo) { st.mo.pos = [lat, lng]; st.mo.along = along; }
    }
    // 아바타·지도는 연속 이동 루프가 매 프레임 함께 움직임(카메라)
    setMotionTarget(lat, lng, along);
    st.prevMeFixAt = Date.now();
    if (st.follow && !st.turnZoomed && st.course) autoZoomBySpeed(map);
  }

  /**
   * 속도에 맞춘 자동 확대(가민·티맵 방식, 2026-10-21): 걷기 18 · 자전거 17 · 28km/h 이상 16.
   * 같은 단계가 4초 이어질 때만 바꿔 출렁임 없음. 사용자가 직접 확대·축소하면 '내 위치' 버튼을 누를 때까지 멈춤.
   */
  function autoZoomBySpeed(map) {
    var want = navIsWalk() ? 18 : st.speedKmh >= 28 ? 16 : 17;
    var cur = map.getZoom();
    if (st.autoZoomSet != null && cur !== st.autoZoomSet) return; // 사용자가 직접 바꿈
    if (want === cur) { st.autoZoomSet = cur; st.zoomWant = null; return; }
    if (st.zoomWant !== want) { st.zoomWant = want; st.zoomWantSince = Date.now(); return; }
    if (Date.now() - st.zoomWantSince < 4000) return;
    st.autoZoomSet = want;
    st.zoomWant = null;
    zoomKeepMe(want);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) kickLoop();
  });

  window.recenterOutdoorMap = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    st.follow = true;
    st.autoZoomSet = null; // 속도 자동 확대 다시 켬
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
    trailClear(); // 코스·길찾기 안내 중에는 녹색 지나온 길 대신 회색 지나간 구간 표시
    L.polyline(st.course.latlngs, { color: '#7c3aed', weight: 10, opacity: 0.85, smoothFactor: 1.5, lineCap: 'round', lineJoin: 'round' }).addTo(st.courseLayer);
    // 지나간 구간(출발점 ~ 현재 위치)은 회색으로 덮음 — updatePassedLine 에서 갱신
    st.passedLine = L.polyline([], { color: '#9ca3af', weight: 10, opacity: 0.95, smoothFactor: 1.5, lineCap: 'round', lineJoin: 'round' }).addTo(st.courseLayer);
    st.passedAt = -1;
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

  /** (호환) 최근 맵매칭 결과를 { idx, dist } 로 — idx 는 선분 끝 꼭짓점 */
  function nearestCourseIdx() {
    var m = st.match;
    return m ? { idx: m.seg, dist: m.d } : { idx: -1, dist: Infinity };
  }

  /**
   * 회전 안내 거리(2026-10-21) — 고정 거리 대신 "회전까지 남은 시간" 기준(가민·티맵 방식), 걷기는 짧게
   *  pre: 미리 알림(음성만), card: 큰 회전 카드·지도 확대 + 알림, near: "곧 ○회전"
   */
  function turnDistances() {
    var v = Math.max(st.speedKmh / 3.6, navIsWalk() ? 1.3 : 4);
    if (navIsWalk()) return { show: 200, pre: 0, card: 60, near: 15 };
    return {
      show: 400,
      pre: clampN(v * 30, 200, 400), // 약 30초 전
      card: clampN(v * 15, 100, 250), // 약 15초 전
      near: clampN(v * 5, 25, 60) // 약 5초 전
    };
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

  /**
   * 회전 안내 카드 화살표(녹색·황색 카드 공통, 2026-10-21 티맵·카카오내비 방식)
   * - 교차로의 다른 길(직진·반대쪽)은 반투명 흰 도로로 깔아 교차로 모양을 보여 주고
   * - 진행할 길은 일정한 굵기 몸통이 둥글게 꺾여 각진 넓은 화살촉으로 이어짐(몸통·화살촉 이음매 없음)
   * - 위→아래 흰색 그라데이션 + 짙은 얇은 테두리 + 아래쪽 그림자 → 녹색·주황 배경 모두 또렷
   */
  function turnArrowSvg(delta) {
    var f = function (n) { return n.toFixed(1); };
    var BODY = 13; // 몸통 굵기
    var HEAD_LEN = 24, HEAD_HALF = 18; // 화살촉 길이·반폭
    var CTX = 'rgba(255,255,255,0.26)';
    var EDGE = 'rgba(0,0,0,0.30)'; // 테두리
    var SHADOW = 'rgba(0,0,0,0.22)';
    var FILL = 'url(#outdArrowFill)';
    function stroke(d, w, color, dy) {
      return '<path d="' + d + '"' + (dy ? ' transform="translate(0 ' + dy + ')"' : '') + ' fill="none" stroke="' + color +
        '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    function headPts(tx, ty, ux, uy) {
      var px = -uy, py = ux;
      var bx = tx - ux * HEAD_LEN, by = ty - uy * HEAD_LEN;
      return f(tx) + ',' + f(ty) + ' ' + f(bx + px * HEAD_HALF) + ',' + f(by + py * HEAD_HALF) + ' ' +
        f(bx + ux * 3) + ',' + f(by + uy * 3) + ' ' + // 밑변 가운데를 살짝 안쪽으로(티맵식 날렵한 화살촉)
        f(bx - px * HEAD_HALF) + ',' + f(by - py * HEAD_HALF);
    }
    function poly(pts, fill, strokeColor, sw, dy) {
      return '<polygon points="' + pts + '"' + (dy ? ' transform="translate(0 ' + dy + ')"' : '') + ' fill="' + fill +
        '" stroke="' + strokeColor + '" stroke-width="' + sw + '" stroke-linejoin="round"/>';
    }
    /** 그림자 → 테두리 → 흰 화살표 순서로 겹쳐 그림 */
    function arrow(body, hp) {
      return stroke(body, BODY + 4, SHADOW, 2.5) + poly(hp, SHADOW, SHADOW, 4, 2.5) +
        stroke(body, BODY + 3, EDGE) + poly(hp, EDGE, EDGE, 3.5) +
        stroke(body, BODY, FILL) + poly(hp, FILL, FILL, 1.2);
    }
    var svg = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
      '<defs><linearGradient id="outdArrowFill" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3eaf2"/></linearGradient></defs>';
    if (Math.abs(delta) >= 135) {
      // 유턴: 올라가서 반원으로 돌아 내려오는 U 화살표(좌유턴은 좌우 대칭)
      var right = delta > 0;
      var fx = function (x) { return right ? x : 100 - x; };
      var u = 'M ' + fx(30) + ' 94 L ' + fx(30) + ' 42 A 22 22 0 0 ' + (right ? 1 : 0) + ' ' + fx(74) + ' 42 L ' + fx(74) + ' 62';
      return svg + stroke('M ' + fx(30) + ' 50 L ' + fx(30) + ' 6', 12, CTX) +
        arrow(u, headPts(fx(74), 86, 0, 1)) + '</svg>';
    }
    var a = Math.max(-170, Math.min(170, delta)) * Math.PI / 180;
    var ux = Math.sin(a), uy = -Math.cos(a);
    var jx = 50, jy = 58; // 교차로 중심
    var reach = 42; // 교차로에서 화살촉 끝까지
    var tx = jx + ux * reach, ty = jy + uy * reach;
    var ex = tx - ux * (HEAD_LEN - 3), ey = ty - uy * (HEAD_LEN - 3); // 몸통 끝은 화살촉 안쪽까지(이음매 없음)
    var R = 16; // 꺾이는 곳 둥글기
    var body = 'M 50 96 L 50 ' + f(jy + R) + ' Q 50 ' + f(jy) + ' ' + f(jx + ux * R) + ' ' + f(jy + uy * R) + ' L ' + f(ex) + ' ' + f(ey);
    var ctx = '';
    if (Math.abs(delta) >= 20) ctx += stroke('M 50 ' + jy + ' L 50 6', 12, CTX); // 직진 길
    if (Math.abs(delta) >= 50) ctx += stroke('M 50 ' + jy + ' L ' + (delta > 0 ? 6 : 94) + ' ' + jy, 12, CTX); // 반대쪽 길
    return svg + ctx + arrow(body, headPts(tx, ty, ux, uy)) + '</svg>';
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

  function showTurnBig(turn, dm, TD) {
    var nearM = TD && TD.near ? TD.near : 40;
    var el = turnBigEl();
    if (!el) return;
    if (st.turnBigIdx !== turn.idx) {
      st.turnBigIdx = turn.idx;
      el.querySelector('.outd-turn-big__arrow').innerHTML = turnArrowSvg(turn.delta);
      el.querySelector('.outd-turn-big__word').textContent = turnWord(turn.delta);
      st.turnBuzz = {};
    }
    var dist = navDistM(dm) + 'm';
    var distEl = el.querySelector('.outd-turn-big__dist');
    if (distEl.textContent !== dist) distEl.textContent = dist;
    el.classList.toggle('is-near', dm <= nearM);
    el.style.display = 'flex';
    // 카드 진입 1회·바로 앞(속도 기준 약 5초 전, 걷기 15m) 1회: 진동 + 알림음 + 음성
    var word = turn.text || turnWord(turn.delta);
    if (!st.turnBuzz.far) {
      st.turnBuzz.far = true;
      try { if (navigator.vibrate) navigator.vibrate(150); } catch (e) {}
      cue('turnFar', voiceDist(dm) + ' 후 ' + word);
    }
    if (dm <= nearM && !st.turnBuzz.near) {
      st.turnBuzz.near = true;
      try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) {}
      cue('turnNear', '곧 ' + turnWord(turn.delta));
    }
    drawTurnOnMap(turn);
    if (st.follow && st.map && st.lastFix && st.map.getZoom() < TURN_ZOOM && !st.turnZoomed) {
      st.turnZoomed = true;
      st.zoomBeforeTurn = st.map.getZoom();
      zoomKeepMe(TURN_ZOOM);
    }
  }

  function hideTurnBig() {
    var el = $('outdTurnBig');
    if (el && el.style.display !== 'none') el.style.display = 'none';
    st.turnBigIdx = null;
    clearTurnOnMap();
    if (st.turnZoomed && st.map && st.follow) {
      zoomKeepMe(st.zoomBeforeTurn || 16);
    }
    st.turnZoomed = false;
  }

  /*
   * 분기점 화살표(2026-10-20) — 티맵·카카오내비 방식: 코스 위에 [그림자 → 짙은 남색 테두리 → 흰 몸통] 굵은 화살표,
   * 끝에 넓은 흰 화살촉(같은 남색 테두리). 화살촉은 화면 픽셀 크기로 그려 확대·축소(zoomend) 때 다시 계산.
   */
  var TURN_ARROW_BACK_M = 35, TURN_ARROW_FWD_M = 28;
  function drawTurnOnMap(turn) {
    if (!st.map || st.turnLayerIdx === turn.idx) return;
    clearTurnOnMap();
    st.turnLayerIdx = turn.idx;
    st.turnLayerTurn = turn;
    renderTurnArrow();
    if (!st.turnZoomBound) {
      st.turnZoomBound = true;
      st.map.on('zoomend', function () { if (st.turnLayerTurn) renderTurnArrow(); });
    }
  }

  function renderTurnArrow() {
    var turn = st.turnLayerTurn;
    if (!st.map || !turn) return;
    var L = window.L;
    var map = st.map;
    if (st.turnLayer) map.removeLayer(st.turnLayer);
    st.turnLayer = L.layerGroup().addTo(map);
    var pts = [];
    for (var dd = -TURN_ARROW_BACK_M; dd <= TURN_ARROW_FWD_M; dd += 4) pts.push(pointAtDist(turn.at + dd));
    // 화살촉 방향: 마지막 구간
    var e1 = map.latLngToLayerPoint(pts[pts.length - 2]);
    var e2 = map.latLngToLayerPoint(pts[pts.length - 1]);
    var vx = e2.x - e1.x, vy = e2.y - e1.y;
    var len = Math.sqrt(vx * vx + vy * vy) || 1;
    vx /= len; vy /= len;
    var px = -vy, py = vx; // 수직
    var headLen = 20, headHalf = 15;
    // 몸통은 화살촉 밑변까지만(겹침 없이 깔끔하게)
    var bodyEnd = map.layerPointToLatLng(L.point(e2.x - vx * 2, e2.y - vy * 2));
    var body = pts.slice(0, -1).concat([bodyEnd]);
    var tip = L.point(e2.x + vx * headLen, e2.y + vy * headLen);
    var bl = L.point(e2.x + px * headHalf, e2.y + py * headHalf);
    var br = L.point(e2.x - px * headHalf, e2.y - py * headHalf);
    var head = [map.layerPointToLatLng(tip), map.layerPointToLatLng(bl), map.layerPointToLatLng(br)];
    var opt = { lineCap: 'round', lineJoin: 'round', interactive: false };
    // 그림자
    L.polyline(body, Object.assign({ color: '#000000', weight: 19, opacity: 0.22 }, opt)).addTo(st.turnLayer);
    L.polygon(head, { color: '#000000', weight: 7, opacity: 0.22, fillColor: '#000000', fillOpacity: 0.22, lineJoin: 'round', interactive: false }).addTo(st.turnLayer);
    // 남색 테두리
    L.polyline(body, Object.assign({ color: '#1e3a8a', weight: 15, opacity: 1 }, opt)).addTo(st.turnLayer);
    L.polygon(head, { color: '#1e3a8a', weight: 5, opacity: 1, fillColor: '#1e3a8a', fillOpacity: 1, lineJoin: 'round', interactive: false }).addTo(st.turnLayer);
    // 흰 몸통·화살촉
    L.polyline(body, Object.assign({ color: '#ffffff', weight: 9, opacity: 1 }, opt)).addTo(st.turnLayer);
    L.polygon(head, { color: '#ffffff', weight: 1, opacity: 1, fillColor: '#ffffff', fillOpacity: 1, lineJoin: 'round', interactive: false }).addTo(st.turnLayer);
  }

  function clearTurnOnMap() {
    if (st.turnLayer && st.map) st.map.removeLayer(st.turnLayer);
    st.turnLayer = null;
    st.turnLayerIdx = null;
    st.turnLayerTurn = null;
  }

  /** 코스 위 진행 거리(here, m)까지를 회색으로 — 5m 이상 나아갔을 때만 다시 그림 */
  function updatePassedLine(here, lat, lng) {
    var c = st.course;
    if (!c || !st.passedLine) return;
    if (st.passedAt >= 0 && Math.abs(here - st.passedAt) < 5) return;
    st.passedAt = here;
    var pts = [];
    for (var i = 0; i < c.cum.length && c.cum[i] <= here; i++) pts.push(c.latlngs[i]);
    var tip = snapToCourse(lat, lng) || pointAtDist(here);
    pts.push(tip);
    st.passedLine.setLatLngs(pts.length >= 2 ? pts : []);
  }

  var LOCK_ACQUIRE_M = 15; // 이 거리 안에 들어오면 경로에 고정
  /**
   * 진행 거리 필터(2026-10-21): 직전 값 + 속도×시간으로 예측한 값과 GPS 맵매칭 값을 섞어(가중 0.45) 앞뒤 출렁임 제거,
   * 움직이는 중(1m/s 이상)에는 뒤로 밀리지 않게 유지. 예측과 30m 넘게 다르면(점프·재탐색) 측정값을 그대로 씀.
   */
  function filterAlong(meas, t) {
    var prev = st.navAlong, prevT = st.navAlongAt;
    var v = Math.max(0, st.speedKmh / 3.6);
    var out = meas;
    if (prev != null && prevT) {
      var dt = clampN((t - prevT) / 1000, 0, 5);
      var pred = prev + v * dt;
      if (Math.abs(meas - pred) < 30) out = pred + (meas - pred) * 0.45;
      if (v >= 1 && out < prev) out = prev;
    }
    out = clampN(out, 0, st.course.totalM);
    st.navAlong = out;
    st.navAlongAt = t;
    return out;
  }

  function updateNavigation(lat, lng, t) {
    if (!st.course || !st.course.latlngs.length) return;
    var c = st.course;
    var m = matchCourse(lat, lng, t || Date.now());
    st.match = m;
    if (!m) return;
    var P = navParams();
    var now = Date.now();
    var nav = $('outdNav');
    var arrow = $('outdNavArrow');
    // 이탈 판정: 기준 거리 밖이 일정 시간(자전거 3초·걷기 5초) 이어질 때만(순간 GPS 튐·교차로 회전은 이탈 아님).
    // 아주 멀면(기준 2배) 바로 이탈. GPS 정확도가 나쁘면(>50m) 판정 보류.
    var badFix = st.lastFix && st.lastFix.acc > 50;
    if (m.d > P.offM && !badFix) {
      if (!st.offSince) st.offSince = now;
    } else if (m.d <= P.offM) {
      st.offSince = 0;
    }
    var offCourse = !!st.offSince && (now - st.offSince >= P.offHoldMs || m.d > P.offM * 2);
    // 경로 고정(Route Lock, 2026-10-21 티맵·카카오 방식): ±15m 안에 들어오면 고정하고, 이탈이 확정되기 전까지는
    // GPS 가 흔들려도 내 위치를 항상 코스선 중심(진행 거리 위 점)에 표시. 이탈 확정 시에만 실제 GPS 위치로.
    if (offCourse) st.navLocked = false;
    else if (m.d <= LOCK_ACQUIRE_M) st.navLocked = true;
    var here;
    if (offCourse) {
      here = st.lastOnRouteAlong != null ? st.lastOnRouteAlong : 0; // 아직 코스에 올라탄 적 없으면 출발점 기준(왕복 코스에서 도착점으로 오인 방지)
      st.navAlong = null;
    } else {
      here = filterAlong(m.along, t || now);
    }
    var remainM = Math.max(0, c.totalM - here);
    setText('outdNavRemain', '남은 ' + (remainM / 1000).toFixed(1) + ' km');
    setText('outd-ui-remain', (remainM / 1000).toFixed(remainM < 10000 ? 2 : 1));
    if (nav) nav.classList.toggle('is-off', offCourse);
    if (offCourse) {
      st.onRoute = false; // 이탈 중에는 진행 방향(GPS) 기준으로 지도 회전
      hideTurnBig();
      // 코스로 돌아가는 방향·거리(가민 Off Course 안내)
      var toCourse = bearing(lat, lng, m.lat, m.lng);
      setText('outdNavText', (c.isRoute ? '경로를 벗어났습니다 · ' : '코스를 벗어났습니다 · ') + navDistM(m.d) + 'm');
      if (!st.offCued && st.speedKmh >= (P.walk ? 1.5 : 3)) { st.offCued = true; cue('off', c.isRoute ? '경로를 벗어났습니다' : '코스를 벗어났습니다'); }
      maybeReroute();
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(toCourse) + 'deg)';
      return;
    }
    if (st.offCued) {
      st.offCued = false;
      cue('reroute', c.isRoute ? '경로로 돌아왔습니다' : '코스로 돌아왔습니다');
    }
    st.offRouteSince = 0;
    st.lastOnRouteAlong = here;
    st.lastOnRouteIdx = m.seg;
    // 길 방향이 항상 화면 위쪽(route-up): 내 위치에서 약 40m 앞 경로 방향 — 멈춰 있어도·출발 전에도 맞춰짐
    st.onRoute = true;
    updatePassedLine(here, lat, lng);
    if (here < c.totalM - 5) {
      // 길 방향: 50m 앞을 보고(작은 지그재그 무시) 천천히 따라가며, 좌우 번갈아 흔들리는 작은 변화는 무시(steadyHeading)
      var pa = pointAtDist(here), pb = pointAtDist(Math.min(c.totalM, here + 50));
      if (hav(pa[0], pa[1], pb[0], pb[1]) > 3) steadyHeading(bearing(pa[0], pa[1], pb[0], pb[1]), 0.35);
    }
    // 도착: 남은 거리 또는 목적지까지 직선거리(걷기 15m·자전거 25m)
    var arriveM = P.walk ? 15 : 25;
    var destPt = c.dest ? [c.dest.lat, c.dest.lng] : c.latlngs[c.latlngs.length - 1];
    if (remainM < arriveM || (remainM < 80 && hav(lat, lng, destPt[0], destPt[1]) < arriveM)) {
      hideTurnBig();
      setText('outdNavText', c.isRoute ? '목적지에 도착했습니다' : '도착 지점입니다');
      if (!c.arrivedCue) { c.arrivedCue = true; cue('arrive', c.isRoute ? '목적지에 도착했습니다' : '코스 도착 지점입니다'); }
      if (arrow) { arrow.textContent = '🏁'; arrow.style.transform = 'none'; }
      return;
    }
    if (arrow && arrow.textContent !== '↑') arrow.textContent = '↑';
    // 다음 회전: 회전 지점을 6m 지날 때까지 유지(지나기 전에 카드가 사라지지 않게)
    var next = null;
    for (var i = 0; i < c.turns.length; i++) {
      if (c.turns[i].at > here - 6) { next = c.turns[i]; break; }
    }
    var TD = turnDistances();
    if (next && next.at - here <= TD.show) {
      var dm = Math.max(0, next.at - here);
      var word = next.text || turnWord(next.delta);
      setText('outdNavText', dm < 10 ? '지금 ' + word : navDistM(dm) + 'm 후 ' + word);
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(Math.max(-150, Math.min(150, next.delta))) + 'deg)';
      // 미리 알림(자전거, 약 30초 전 · 음성만 1회)
      if (TD.pre && dm <= TD.pre && dm > TD.card && st.preCuedTurn !== next.idx) {
        st.preCuedTurn = next.idx;
        cue('turnPre', voiceDist(dm) + ' 앞 ' + word);
      }
      if (dm <= TD.card) showTurnBig(next, dm, TD);
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
      .then(function (txt) { useCourseGpxText(txt, title); })
      .catch(function (e) {
        toast('코스맵을 불러오지 못했습니다: ' + ((e && e.message) || e), 'error');
      });
  }
  /** GPX 글자 → 코스로 등록(즐겨찾기 코스·기기 파일 공통) */
  function useCourseGpxText(txt, title) {
    var latlngs = parseCourseGpx(txt);
    if (latlngs.length < 2) throw new Error('코스 포인트가 없습니다.');
    hideTurnBig();
    st.course = prepareCourse(title || '', latlngs);
    st.courseIdx = 0;
    resetMatch();
    drawCourse();
    if (st.lastFix) updateNavigation(st.lastFix.lat, st.lastFix.lng);
  }

  /* ---------- 길찾기(2026-10-20): 목적지 검색 + 자전거 경로 안내 ----------
   * 검색: 카카오(상호·주소, 현재 위치 우선) → 실패·결과 없으면 Photon(OSM) → Nominatim(OSM).
   * 경로: Valhalla(FOSSGIS 공개 서버) 자전거 모드 — 자전거 통행 금지 도로(자동차 전용·bicycle=no) 자동 제외,
   *   [자전거도로 우선] use_roads 0.2(자전거 도로·한적한 길 선호) / [최단 거리] shortest. 한국어 회전 안내문 사용.
   * 안내: 기존 코스 안내(회전 카드·지도 강조·진동) 재사용, 경로 이탈 10초 이상이면 현재 위치에서 다시 탐색(30초에 1회). */
  var VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
  /** 길찾기 이동 수단: 'bike'(기본) | 'walk' */
  var travelMode = 'bike';
  var lastDest = null;
  var ICON_BIKE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h6l3 8"/><path d="M9.5 9l3 8h2"/><path d="M14 6h2.5l1 3"/><path d="M8 6h3"/></svg>';
  var ICON_WALK = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="1.8"/><path d="M10.5 21l2-6.5 2.5 2.5V21"/><path d="M8 11.5l2.5-3.5h3l2.5 3.5 2 1"/><path d="M12.5 14.5l-1-6.5"/><path d="M9 21l1.5-4.5"/></svg>';
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

  /* 카카오 장소·주소 검색(2026-10-20): 카카오맵 JS SDK services(키워드=상호·POI, 주소=지번·도로명).
   * 처음 검색할 때만 SDK 를 불러오고, 실패하거나 결과가 없으면 아래 OSM(Photon/Nominatim) 검색으로 넘어간다. */
  var kakaoMapsPromise = null;
  function loadKakaoMaps() {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve(window.kakao);
    var key = window.STELVIO_KAKAO_JS_KEY;
    if (!key) return Promise.reject(new Error('no kakao key'));
    if (kakaoMapsPromise) return kakaoMapsPromise;
    kakaoMapsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&libraries=services&autoload=false';
      s.async = true;
      var t = setTimeout(function () { reject(new Error('kakao timeout')); }, 10000);
      s.onload = function () {
        try {
          window.kakao.maps.load(function () { clearTimeout(t); resolve(window.kakao); });
        } catch (e) { clearTimeout(t); reject(e); }
      };
      s.onerror = function () { clearTimeout(t); reject(new Error('kakao sdk load failed')); };
      document.head.appendChild(s);
    }).catch(function (e) {
      kakaoMapsPromise = null; // 다음 검색에서 다시 시도
      throw e;
    });
    return kakaoMapsPromise;
  }

  function searchKakao(q) {
    var here = st.lastFix;
    return loadKakaoMaps().then(function (kakao) {
      var svc = kakao.maps.services;
      var OK = svc.Status.OK;
      var places = new svc.Places();
      var opt = here ? { location: new kakao.maps.LatLng(here.lat, here.lng), size: 15 } : { size: 15 };
      function kw(page) {
        return new Promise(function (resolve) {
          places.keywordSearch(q, function (data, status) { resolve(status === OK ? data : []); }, Object.assign({ page: page }, opt));
        });
      }
      var addr = new Promise(function (resolve) {
        new svc.Geocoder().addressSearch(q, function (data, status) { resolve(status === OK ? data : []); });
      });
      return Promise.all([addr, kw(1), kw(2)]).then(function (r) {
        var out = [];
        var seen = {};
        function push(item) {
          var k = item.name + '|' + item.lat.toFixed(5) + '|' + item.lng.toFixed(5);
          if (seen[k]) return;
          seen[k] = 1;
          out.push(item);
        }
        r[0].slice(0, 3).forEach(function (a) {
          var road = a.road_address && a.road_address.address_name;
          var bld = a.road_address && a.road_address.building_name;
          push({ name: bld || road || a.address_name, sub: road && road !== a.address_name ? a.address_name : '주소', lat: Number(a.y), lng: Number(a.x) });
        });
        r[1].concat(r[2]).forEach(function (p) {
          var cat = p.category_group_name || String(p.category_name || '').split('>').pop().trim();
          var where = p.road_address_name || p.address_name || '';
          push({ name: p.place_name, sub: [cat, where].filter(Boolean).join(' · '), lat: Number(p.y), lng: Number(p.x) });
        });
        return out.filter(function (x) { return isFinite(x.lat) && isFinite(x.lng); });
      });
    });
  }

  /** @returns {Promise<{ name: string, sub: string, lat: number, lng: number }[]>} */
  function searchPlaces(q) {
    return searchKakao(q).then(function (list) {
      return list.length ? list : searchOsm(q);
    }, function () {
      return searchOsm(q);
    });
  }

  function searchOsm(q) {
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
    if (mode === 'walk' || mode === 'walkShort') return fetchWalkRoute(from, to, mode, opt);
    return fetchValhallaRoute(from, to, mode, opt).then(function (base) {
      return improveBikeRouteSidePath(base, mode);
    });
  }

  /**
   * 자전거 경로 보완(2026-10-21): 최단 거리(shortest)는 도로 종류를 보지 않아 바로 옆 자전거도로를 두고 차도 중앙선을 따라가고,
   * 자전거도로 우선도 지도상 별도 자전거도로와 연결이 애매하면 차도로 그려진다.
   * → 차도 중앙선이 100m 넘게 남으면 경로를 좌우 16m 옮겨 자전거로 지도 매칭(trace_route) — 나란한 자전거도로가 있으면 그 길로.
   *   실측(최단): 잠실→석촌 중앙선 1.08→0.05km, 시청→광화문 0.66→0.09km, 송파→올림픽공원 1.06→0.11km (거리 +2~7%)
   */
  function improveBikeRouteSidePath(base, mode) {
    return measureBigRoadKm(base, 'bicycle').then(function (k) {
      base.bigRoadKm = k;
      if (k == null || k <= 0.1) return base;
      var limit = mode === 'short' ? 1.1 : 1.15;
      return Promise.all([sideSnapRoute(base, 1, 'bicycle'), sideSnapRoute(base, -1, 'bicycle')]).then(function (sides) {
        var best = base;
        sides.forEach(function (s) {
          if (!s || s.bigRoadKm == null || s.km > base.km * limit) return;
          if (s.bigRoadKm < best.bigRoadKm - 0.05) best = s;
        });
        return best;
      });
    }, function () { return base; });
  }

  /* 걷기 경로 보완(2026-10-20): 국내 OSM 은 큰길 인도가 따로 그려지지 않은 곳이 많아 보행자 경로가 차도 중앙선 위에 그려진다.
   * 자전거도로 우선 경로(대부분 자전거·보행자 겸용도로)를 함께 받아, 보행자로 통행 가능한지 확인한 뒤
   * 큰길 중앙선 구간이 더 짧고 거리 차이가 허용 범위 안이면 그쪽을 쓴다. */
  var WALK_CYCLE_MAX_RATIO = { walk: 1.35, walkShort: 1.1 };
  var cycleWalkMemo = { key: '', at: 0, promise: null };

  function walkCycleCandidate(from, to, opt) {
    var key = [from.lat.toFixed(5), from.lng.toFixed(5), to.lat.toFixed(5), to.lng.toFixed(5),
      opt && opt.via ? opt.via.lat.toFixed(5) + ',' + opt.via.lng.toFixed(5) : ''].join('|');
    var now = Date.now();
    if (cycleWalkMemo.key !== key || now - cycleWalkMemo.at > 30000) {
      cycleWalkMemo = {
        key: key,
        at: now,
        promise: fetchValhallaRoute(from, to, 'walkCycle', opt).then(function (rt) {
          return measureBigRoadKm(rt).then(function (bigKm) {
            if (bigKm == null) return null; // 보행자로 매칭 안 되는 경로(보행 불가 구간 포함)는 버림
            rt.bigRoadKm = bigKm;
            return rt;
          });
        }).catch(function () { return null; })
      };
    }
    return cycleWalkMemo.promise;
  }

  /** 경로 중 큰길(간선·보조간선·집산도로) 차도 중앙선 길이(km). 보행자로 매칭 실패 시 null */
  function measureBigRoadKm(rt, costing) {
    var body = {
      encoded_polyline: rt.shape,
      shape_match: 'edge_walk',
      costing: costing || 'pedestrian',
      filters: { attributes: ['edge.use', 'edge.road_class', 'edge.length'], action: 'include' }
    };
    return fetchJson(VALHALLA_URL.replace(/\/route$/, '/trace_attributes') + '?json=' + encodeURIComponent(JSON.stringify(body)))
      .then(function (d) {
        var edges = d && d.edges;
        if (!edges || !edges.length) return null;
        var km = 0;
        edges.forEach(function (e) {
          if ((e.use === 'road' || e.use === 'turn_channel') &&
            ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].indexOf(e.road_class) >= 0) km += e.length || 0;
        });
        return km;
      })
      .catch(function () { return null; });
  }

  function fetchWalkRoute(from, to, mode, opt) {
    var ped = fetchValhallaRoute(from, to, mode, opt);
    return Promise.all([
      ped.then(function (rt) { return measureBigRoadKm(rt).then(function (k) { rt.bigRoadKm = k; return rt; }); }),
      walkCycleCandidate(from, to, opt)
    ]).then(function (r) {
      var p = r[0], c = r[1];
      if (p.bigRoadKm == null) return p;
      var ratio = WALK_CYCLE_MAX_RATIO[mode] || 1.2;
      var best = p;
      // (1) 자전거도로 우선 경로: 큰길 중앙선이 50m 이상 줄고 거리는 허용 범위 안일 때.
      // 인도 우선은 늘어난 거리가 줄어든 중앙선 길이 이하면 1.5배까지 허용(예: 송파→올림픽공원 중앙선 1.3km → 0)
      if (c) {
        var saved = p.bigRoadKm - c.bigRoadKm;
        var withinLen = c.km <= p.km * ratio ||
          (mode === 'walk' && c.km <= p.km * 1.5 && c.km - p.km <= saved);
        if (saved > 0.05 && withinLen) {
          best = {
            mode: mode,
            latlngs: c.latlngs,
            maneuvers: c.maneuvers,
            km: c.km,
            min: Math.round(c.km / 5.1 * 60), // 자전거 시간 대신 걷기 시간(5.1km/h)
            shape: c.shape,
            bigRoadKm: c.bigRoadKm,
            viaCycleway: true
          };
        }
      }
      // (2) 같은 경로를 옆 보행로·자전거도로로: 아직 차도 중앙선이 100m 넘게 남으면, 경로 모양을 오른쪽/왼쪽으로
      //     16m 옮겨 지도 매칭 → 나란한 자전거도로·인도가 있으면 그쪽에 붙는다(강남→선릉 실측 중앙선 2.04→0.12km, 거리 +2%)
      if (best.bigRoadKm == null || best.bigRoadKm <= 0.1) return best;
      return Promise.all([sideSnapRoute(p, 1), sideSnapRoute(p, -1)]).then(function (sides) {
        sides.forEach(function (s) {
          if (!s || s.bigRoadKm == null) return;
          if (s.km > p.km * (mode === 'walkShort' ? 1.1 : 1.2)) return;
          if (s.bigRoadKm < best.bigRoadKm - 0.05) best = s;
        });
        return best;
      });
    }, function () { return ped; });
  }

  /** Google polyline(정밀도 1e6, Valhalla 형식) 인코딩 */
  function encodePolyline6(points) {
    var out = '', pLat = 0, pLng = 0;
    function enc(v) {
      v = v < 0 ? ~(v * 2) : v * 2;
      var s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v % 32)) + 63); v = Math.floor(v / 32); }
      return s + String.fromCharCode(v + 63);
    }
    points.forEach(function (pt) {
      var la = Math.round(pt[0] * 1e6), lo = Math.round(pt[1] * 1e6);
      out += enc(la - pLat) + enc(lo - pLng);
      pLat = la; pLng = lo;
    });
    return out;
  }

  /**
   * 경로 모양을 진행 방향 오른쪽(side=1)/왼쪽(-1)으로 16m 옮긴 뒤 지도 매칭(trace_route, costing: 걷기 pedestrian·자전거 bicycle).
   * 나란한 인도·자전거도로가 있으면 그 길로, 없으면 원래 도로로 붙는다. 실패·끊김이면 null.
   */
  function sideSnapRoute(base, side, costing) {
    costing = costing === 'bicycle' ? 'bicycle' : 'pedestrian';
    var src = base.latlngs || [];
    if (src.length < 2) return Promise.resolve(null);
    var total = 0, i;
    for (i = 1; i < src.length; i++) total += hav(src[i - 1][0], src[i - 1][1], src[i][0], src[i][1]);
    var step = Math.max(10, total / 1200); // 점 개수 상한(요청 주소 길이)
    var pts = [src[0]];
    for (i = 1; i < src.length; i++) {
      var a = src[i - 1], b = src[i];
      var n = Math.max(1, Math.floor(hav(a[0], a[1], b[0], b[1]) / step));
      for (var k = 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    var OFF = 16;
    var off = pts.map(function (pt, j) {
      var p0 = pts[Math.max(0, j - 1)], p1 = pts[Math.min(pts.length - 1, j + 1)];
      var cos = Math.cos(pt[0] * Math.PI / 180);
      var dy = (p1[0] - p0[0]) * 111320, dx = (p1[1] - p0[1]) * 111320 * cos;
      var L = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = (dy / L) * side, ny = (-dx / L) * side; // 진행 방향 기준 오른쪽(+)/왼쪽(-) 법선
      return [pt[0] + (ny * OFF) / 111320, pt[1] + (nx * OFF) / (111320 * cos)];
    });
    var body = {
      encoded_polyline: encodePolyline6(off),
      costing: costing,
      shape_match: 'map_snap',
      trace_options: { search_radius: 18, gps_accuracy: 6 },
      costing_options: costing === 'bicycle'
        ? { bicycle: { bicycle_type: 'Hybrid', use_roads: 0.2 } }
        : { pedestrian: { walkway_factor: 0.5, sidewalk_factor: 0.5 } },
      language: 'ko-KR',
      units: 'kilometers'
    };
    return fetchJson(VALHALLA_URL.replace(/\/route$/, '/trace_route') + '?json=' + encodeURIComponent(JSON.stringify(body)))
      .then(function (d) {
        var trip = d && d.trip;
        if (!trip || !trip.legs || trip.legs.length !== 1) return null;
        var leg = trip.legs[0];
        var rt = {
          mode: base.mode,
          latlngs: decodePolyline6(leg.shape),
          maneuvers: leg.maneuvers || [],
          km: trip.summary.length,
          min: Math.round(trip.summary.time / 60),
          shape: leg.shape,
          viaSidePath: true
        };
        return measureBigRoadKm(rt, costing).then(function (k) { rt.bigRoadKm = k; return rt; });
      })
      .catch(function () { return null; });
  }

  function fetchValhallaRoute(from, to, mode, opt) {
    opt = opt || {};
    var start = { lat: from.lat, lon: from.lng };
    if (opt.heading != null && isFinite(opt.heading)) {
      start.heading = Math.round(opt.heading);
      start.heading_tolerance = 60;
    }
    var locs = [start];
    if (opt.via) locs.push({ lat: opt.via.lat, lon: opt.via.lng, type: 'through' });
    locs.push({ lat: to.lat, lon: to.lng });
    // 2026-10-20: 걷기(보행자) — 'walk' 인도·보행로 강하게 우선(별도 인도·보행로 0.25, 골목·진입로·주차장 통로 회피),
    // 'walkShort' 걷기 최단: shortest(순수 거리)는 차도 중앙선만 따라가서(서울 구간 실측 97~100%) 쓰지 않고,
    // 인도 가중치 0.5 로 거리 +0~10% 안에서 인도·보행로를 고른다.
    var walking = mode === 'walk' || mode === 'walkShort';
    var costingOptions = walking
      ? { pedestrian: mode === 'walkShort'
          // 2026-10-21: 걷기 최단은 순수 최단 거리로 찾고, 차도 중앙선 구간은 fetchWalkRoute 가 옆 보행로·자전거도로로 옮긴다
          ? { shortest: true, use_ferry: 0 }
          : { walkway_factor: 0.25, sidewalk_factor: 0.25, alley_factor: 2, driveway_factor: 5, service_factor: 1.5, step_penalty: 10, use_living_streets: 0.6, use_ferry: 0 } }
      : { bicycle: mode === 'short'
          ? { bicycle_type: 'Hybrid', shortest: true }
          : mode === 'walkCycle'
            // 걷기 보완 후보: 차도 대신 자전거도로를 최대한(use_roads 0)
            ? { bicycle_type: 'Hybrid', use_roads: 0, use_living_streets: 0.3, use_hills: 0.5, avoid_bad_surfaces: 0, use_ferry: 0 }
            : { bicycle_type: 'Hybrid', use_roads: 0.2, use_hills: 0.4, avoid_bad_surfaces: 0.3 } };
    var body = {
      locations: locs,
      costing: walking ? 'pedestrian' : 'bicycle',
      costing_options: costingOptions,
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
        min: Math.round(trip.summary.time / 60),
        shape: leg.shape
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
    resetMatch();
    st.offRouteSince = 0;
    st.lastOnRouteIdx = null;
    drawCourse();
    drawDestMarker(dest);
    if (st.lastFix) {
      updateNavigation(st.lastFix.lat, st.lastFix.lng);
      st.follow = true;
      followUser(st.lastFix.lat, st.lastFix.lng, Math.max(st.map ? st.map.getZoom() : 16, 16));
    }
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
    if (st.speedKmh < (navIsWalk() ? 1.5 : 3)) { st.offRouteSince = 0; return; } // 멈춰 있으면(휴식 등) 재탐색 안 함
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
    var baseAlong = st.lastOnRouteAlong != null ? st.lastOnRouteAlong : (r.idx > 0 ? c.cum[r.idx] : 0);
    var rejoinAt = baseAlong + (navIsWalk() ? 100 : 200);
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
      toast('경로를 다시 안내합니다 · ' + how + ' · ' + pick.km.toFixed(1) + ' km (' + ({ bike: '자전거도로 우선', short: '최단 거리', walk: '도보 · 인도 우선', walkShort: '도보 · 최단 거리' }[mode] || '') + ')', 'info');
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
      '<div class="coachm-picker__head"><span class="outd-route__title">길찾기' +
      '<span class="outd-route__modes" role="radiogroup" aria-label="이동 수단">' +
      '<button type="button" class="outd-route__mode" data-travel="bike" role="radio" aria-label="자전거">' + ICON_BIKE + '</button>' +
      '<button type="button" class="outd-route__mode" data-travel="walk" role="radio" aria-label="걷기">' + ICON_WALK + '</button>' +
      '</span></span>' +
      '<button type="button" class="coachm-picker__close" data-route-close aria-label="닫기">✕</button></div>' +
      '<div class="outd-route__search"><input id="outdRouteInput" type="search" placeholder="목적지 검색 (장소·주소)" autocomplete="off" enterkeyhint="search"></div>' +
      '<div id="outdRouteList" class="coachm-picker__list outd-route__list"></div>' +
      '<div class="outd-route__credit">경로: Valhalla(OSM) · 검색: 카카오 · Photon(OSM)</div>' +
      '</div>';
    screen.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.closest('[data-route-close]')) { el.style.display = 'none'; return; }
      var mb = e.target.closest && e.target.closest('[data-travel]');
      if (mb) {
        var m = mb.getAttribute('data-travel');
        if (m === travelMode) return;
        travelMode = m;
        renderTravelModes();
        // 경로 후보를 보고 있었다면 같은 목적지로 새 이동 수단 경로를 다시 찾음
        if (lastDest && $('outdRouteList').querySelector('.outd-route__opt')) chooseDestination(lastDest);
      }
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

  function renderTravelModes() {
    var sheet = $('outdRouteSheet');
    if (!sheet) return;
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-travel]'), function (b) {
      var on = b.getAttribute('data-travel') === travelMode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  var searchSeq = 0;
  /** 길찾기 검색·경로 계산 중 화면 앞 녹색 원 스피너(2026-10-21, 로그인 로딩과 같은 원) */
  function outdBusy(show, msg) {
    var el = $('outdBusyOverlay');
    if (!el && show) {
      el = document.createElement('div');
      el.id = 'outdBusyOverlay';
      el.className = 'phone-verify-overlay outd-busy hidden';
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<div class="auth-transition-overlay__inner"><div class="auth-transition-spinner-stage" role="status">' +
        '<div class="auth-transition-spinner-glow" aria-hidden="true"></div>' +
        '<div class="auth-transition-spinner-ring auth-transition-spinner-ring--track" aria-hidden="true"></div>' +
        '<div class="auth-transition-spinner-ring auth-transition-spinner-ring--spin" aria-hidden="true"></div>' +
        '</div><p class="auth-transition-message"></p></div>';
      document.body.appendChild(el);
    }
    if (!el) return;
    if (show) el.querySelector('.auth-transition-message').textContent = msg || '검색 중...';
    el.classList.toggle('hidden', !show);
  }

  function runSearch(q) {
    var seq = ++searchSeq;
    $('outdRouteList').innerHTML = '<div class="coachm-picker__empty">검색 중...</div>';
    outdBusy(true, '장소를 검색하는 중...');
    var busyAt = Date.now();
    searchPlaces(q).then(function (list) {
      if (seq !== searchSeq) return;
      renderRouteList(list);
    }).catch(function () {
      if (seq !== searchSeq) return;
      $('outdRouteList').innerHTML = '<div class="coachm-picker__empty">검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</div>';
    }).then(function () {
      // 너무 빨리 끝나도 0.5초는 보여 줌(깜빡임처럼 보이지 않게)
      setTimeout(function () { if (seq === searchSeq) outdBusy(false); }, Math.max(0, 500 - (Date.now() - busyAt)));
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
    lastDest = dest;
    var walk = travelMode === 'walk';
    box.innerHTML = '<div class="coachm-picker__empty">' + (walk ? '도보 경로를 찾는 중...' : '자전거 경로를 찾는 중...') + '</div>';
    var from = { lat: st.lastFix.lat, lng: st.lastFix.lng };
    var hd = { heading: st.speedKmh >= 5 ? st.heading : null };
    var modes = walk ? ['walk', 'walkShort'] : ['bike', 'short'];
    var reqMode = travelMode;
    outdBusy(true, walk ? '도보 경로를 찾는 중...' : '자전거 경로를 찾는 중...');
    Promise.all(modes.map(function (m) {
      return fetchBikeRoute(from, dest, m, hd).catch(function () { return null; });
    })).then(function (routes) {
      outdBusy(false);
      if (reqMode !== travelMode) return; // 그사이 이동 수단을 바꿨으면 무시
      routes = routes.filter(Boolean);
      if (!routes.length) {
        box.innerHTML = '<div class="coachm-picker__empty">' + (walk ? '걸어서 갈 수 있는 경로를 찾지 못했습니다.' : '자전거로 갈 수 있는 경로를 찾지 못했습니다.') + '</div>';
        return;
      }
      box.innerHTML = '<div class="outd-route__dest">🏁 ' + escHtml(dest.name) + '</div>';
      routes.forEach(function (rt) {
        var item = document.createElement('div');
        var reco = rt.mode === 'bike' || rt.mode === 'walk';
        var optName = rt.mode === 'bike' ? '🚲 자전거도로 우선 <em>추천</em>'
          : rt.mode === 'walk' ? '🚶 인도 우선 <em>추천</em>'
          : '📏 최단 거리';
        item.className = 'coachm-picker__item outd-route__opt' + (reco ? ' is-reco' : '');
        item.innerHTML =
          '<span class="outd-route__optname">' + optName + '</span>' +
          '<span class="outd-route__optinfo">' + rt.km.toFixed(1) + ' km · 약 ' + rt.min + '분' +
          (rt.viaCycleway ? ' · 자전거도로(겸용) 경유' : rt.viaSidePath ? (rt.mode === 'bike' || rt.mode === 'short' ? ' · 길옆 자전거도로' : ' · 길옆 보행로·자전거도로') : '') + '</span>';
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
    renderTravelModes();
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

  /*
   * 코스맵 선택(2026-10-21): 라이딩 생성 화면의 "GPX 파일(선택) > 파일 선택"과 같은 방식
   *  GPX 파일 선택 팝업 → [📁 코스 폴더에서 선택] 기기의 GPX 파일 / [⭐ 즐겨찾기 코스에서 선택] 내가 만든 모임의 코스
   */
  window.openOutdoorCoursePicker = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    var old = $('outdGpxSource');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'outdGpxSource';
    m.className = 'outd-gpx-src';
    m.innerHTML =
      '<div class="outd-gpx-src__card" role="dialog" aria-modal="true" aria-label="GPX 파일 선택">' +
      '<p class="outd-gpx-src__title">GPX 파일 선택</p>' +
      '<button type="button" class="outd-gpx-src__btn" data-src="folder"><span class="outd-gpx-src__ico">📁</span>' +
      '<span><b>코스 폴더에서 선택</b><small>내 기기에서 GPX 파일을 직접 선택합니다</small></span></button>' +
      '<button type="button" class="outd-gpx-src__btn" data-src="fav"><span class="outd-gpx-src__ico">⭐</span>' +
      '<span><b>즐겨찾기 코스에서 선택</b><small>내가 만든 모임의 코스 GPX를 다시 사용합니다</small></span></button>' +
      '<button type="button" class="outd-gpx-src__cancel" data-src="cancel">취소</button>' +
      '<input type="file" accept=".gpx,application/gpx+xml" class="outd-gpx-src__file" hidden>' +
      '</div>';
    document.body.appendChild(m);
    var fileIn = m.querySelector('.outd-gpx-src__file');
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (!/\.gpx$/i.test(f.name || '')) { toast('GPX 파일(.gpx)을 선택해 주세요.', 'error'); return; }
      var rd = new FileReader();
      rd.onload = function () {
        try {
          useCourseGpxText(String(rd.result || ''), String(f.name || '').replace(/\.gpx$/i, ''));
          m.remove();
          toast('코스를 불러왔습니다 · ' + (st.course.totalM / 1000).toFixed(1) + ' km', 'success');
        } catch (err) {
          toast('GPX 파일을 읽지 못했습니다: ' + ((err && err.message) || err), 'error');
        }
      };
      rd.onerror = function () { toast('GPX 파일을 읽지 못했습니다.', 'error'); };
      rd.readAsText(f);
    });
    m.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-src]');
      if (ev.target === m || (b && b.getAttribute('data-src') === 'cancel')) { m.remove(); return; }
      if (!b) return;
      if (b.getAttribute('data-src') === 'folder') { fileIn.value = ''; fileIn.click(); return; }
      m.remove();
      openFavoriteCourses();
    });
  };
  /** 즐겨찾기 코스(내가 만든 모임의 GPX) 목록 */
  function openFavoriteCourses() {
    var picker = $('outdCoursePicker');
    var list = $('outdCoursePickerList');
    if (!picker || !list) return;
    picker.style.display = 'flex';
    list.innerHTML = '<div class="coachm-picker__empty">코스맵을 불러오는 중...</div>';
    var uid = currentUid();
    if (!uid) {
      list.innerHTML = '<div class="coachm-picker__empty">로그인 후 이용할 수 있습니다.</div>';
      return;
    }
    // 오픈라이딩 화면을 거치지 않고 바로 들어오면 읽기 모듈이 아직 없음 → 같은 주소(버전)로 불러온 뒤 사용
    var ready = window.openRidingReadClient && typeof window.openRidingReadClient.fetchMyGpxCoursesRouted === 'function'
      ? Promise.resolve(window.openRidingReadClient)
      : import('/assets/js/openRiding/openRidingReadClient.js?v=routing-ls-20260928').then(function () { return window.openRidingReadClient; });
    ready.then(function (client) {
      if (!client || typeof client.fetchMyGpxCoursesRouted !== 'function') throw new Error('no client');
      return client.fetchMyGpxCoursesRouted(uid, 'CYCLE');
    }).then(function (courses) {
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
  }
  /** 자유 라이딩: 코스맵 없이 현재 위치 기준으로 기록(코스 안내·회전 안내 끄기) */
  window.startOutdoorFreeRide = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    hideTurnBig();
    st.course = null;
    st.courseIdx = 0;
    resetMatch();
    st.onRoute = false;
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
      // 일시정지 중 이동은 이동 시간·거리에 넣지 않음
      st.mvHist = [];
      st.distAnchor = st.lastFix ? [Date.now(), st.lastFix.lat, st.lastFix.lng] : null;
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

  /* ---------- 종목 판별·러닝 지표(2026-10-21) ----------
   * GPS 트랙(5m 간격 점 + 시각)으로 라이딩 / 러닝 / 걷기를 판별하고, 러닝·걷기는 1km 구간 기록(splits)·
   * 구간 최고 속도(1k~42k, RUN 랭킹·대시보드 피크 페이스)를 계산해 RUN 기록(activities)에 저장한다. */
  var MAX_GAP_SEC = 10; // 이보다 긴 점 사이 간격(일시정지·신호 끊김)은 이동 시간에 넣지 않음

  /** 이동 시간축 기준 누적 거리(m)·시간(s) 배열 */
  function trackSeries() {
    var tr = st.track;
    var dist = [0], time = [0];
    for (var i = 1; i < tr.length; i++) {
      var d = hav(tr[i - 1][0], tr[i - 1][1], tr[i][0], tr[i][1]);
      var dt = (tr[i][3] - tr[i - 1][3]) / 1000;
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_GAP_SEC) dt = Math.min(dt, Math.max(1, d / 2)); // 멈춘 시간 제외(2m/s 로 이동했다고 보고 보정)
      dist.push(dist[i - 1] + d);
      time.push(time[i - 1] + dt);
    }
    return { dist: dist, time: time };
  }

  /** 시간 창(windowSec) 이동 평균 속도(km/h) 목록 — 순간 GPS 튐을 걸러낸 "지속 속도" */
  function windowSpeeds(s, windowSec) {
    var out = [];
    var j = 0;
    for (var i = 1; i < s.time.length; i++) {
      while (j < i && s.time[i] - s.time[j] > windowSec) j++;
      var k = Math.max(0, j - 1);
      var dt = s.time[i] - s.time[k];
      if (dt >= windowSec * 0.8) out.push(((s.dist[i] - s.dist[k]) / dt) * 3.6);
    }
    return out;
  }

  function percentile(arr, p) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  }

  /**
   * 라이딩/러닝/걷기 판별.
   * - 사람이 달려서 낼 수 없는 지속 속도(60초 평균 24km/h↑ 또는 30초 구간 상위 10% 22km/h↑) → 라이딩
   * - 이동 평균 17km/h↑(1km 3분32초보다 빠른 페이스를 계속 유지) → 라이딩
   * - 이동 평균 7km/h 미만이고 빠른 구간도 9km/h 미만 → 걷기
   * - 그 밖 → 러닝
   */
  function classifyActivity() {
    var s = trackSeries();
    var movingSec = s.time[s.time.length - 1] || st.movingMs / 1000 || 0;
    var totalM = s.dist[s.dist.length - 1] || st.distanceM;
    var avg = movingSec > 0 ? (totalM / movingSec) * 3.6 : avgSpeedKmh();
    var w30 = windowSpeeds(s, 30);
    var w60 = windowSpeeds(s, 60);
    var p90 = percentile(w30, 0.9);
    var max60 = w60.length ? Math.max.apply(null, w60) : 0;
    var r = { avgKmh: avg, p90Kmh: p90, max60Kmh: max60 };
    if (st.track.length < 5 || totalM < 100) {
      r.kind = travelMode === 'walk' ? 'walk' : 'ride';
      r.reason = '기록이 짧아 ' + (travelMode === 'walk' ? '길찾기 이동 수단(걷기)' : '기본값(라이딩)') + '으로 판단';
    } else if (max60 >= 24 || p90 >= 22) {
      r.kind = 'ride';
      r.reason = '달리기로 낼 수 없는 지속 속도(최고 1분 평균 ' + max60.toFixed(1) + 'km/h)';
    } else if (avg >= 17) {
      r.kind = 'ride';
      r.reason = '이동 평균 ' + avg.toFixed(1) + 'km/h — 달리기 범위를 넘는 속도';
    } else if (avg >= 12 && max60 >= 19) {
      // 평균 4~5분/km 대에서 1분 이상 3분09초/km(19km/h)보다 빠른 구간 — 동호인 러닝으론 드문 패턴(내리막 자전거 등)
      r.kind = 'ride';
      r.reason = '이동 평균 ' + avg.toFixed(1) + 'km/h에 1분 이상 ' + max60.toFixed(1) + 'km/h 구간 — 자전거 패턴';
    } else if (avg >= 10 && st.course && st.course.isRoute && (st.course.routeMode === 'bike' || st.course.routeMode === 'short')) {
      // 애매한 속도대(10~17km/h)는 길찾기에서 고른 이동 수단(자전거)을 따른다
      r.kind = 'ride';
      r.reason = '이동 평균 ' + avg.toFixed(1) + 'km/h(달리기·자전거 겹치는 속도) — 자전거 길찾기로 이동';
    } else if (avg < 7 && p90 < 9) {
      r.kind = 'walk';
      r.reason = '이동 평균 ' + avg.toFixed(1) + 'km/h — 걷기 속도';
    } else {
      r.kind = 'run';
      r.reason = '이동 평균 ' + avg.toFixed(1) + 'km/h · 빠른 구간 ' + p90.toFixed(1) + 'km/h — 달리기 속도';
    }
    return r;
  }

  /** 누적 거리 target(m)을 지나는 시각(s) — 선형 보간 */
  function timeAtDist(s, target) {
    var d = s.dist, t = s.time;
    if (target <= 0) return 0;
    for (var i = 1; i < d.length; i++) {
      if (d[i] >= target) {
        var seg = d[i] - d[i - 1];
        return seg > 0 ? t[i - 1] + (t[i] - t[i - 1]) * (target - d[i - 1]) / seg : t[i];
      }
    }
    return null;
  }

  /** 1km 구간 기록(Strava splits_metric 경량 형식: distance m · elapsed_time s · average_speed m/s) */
  function computeSplits(s) {
    var total = s.dist[s.dist.length - 1];
    var out = [];
    var prevT = 0;
    for (var k = 1000; k <= total + 1e-6; k += 1000) {
      var tk = timeAtDist(s, k);
      if (tk == null) break;
      var el = Math.max(1, Math.round(tk - prevT));
      out.push({ split: out.length + 1, distance: 1000, elapsed_time: el, average_speed: Math.round((1000 / el) * 1000) / 1000, average_heartrate: null, max_heartrate: null });
      prevT = tk;
    }
    var rest = total - out.length * 1000;
    if (rest >= 50) {
      var el2 = Math.max(1, Math.round(s.time[s.time.length - 1] - prevT));
      out.push({ split: out.length + 1, distance: Math.round(rest), elapsed_time: el2, average_speed: Math.round((rest / el2) * 1000) / 1000, average_heartrate: null, max_heartrate: null });
    }
    return out;
  }

  /** 거리별 최고 기록(가장 빠른 연속 구간) 속도 m/s — 서버 calculateAndSaveRunEfforts 와 같은 슬라이딩 윈도우 */
  function computeEfforts(s) {
    var targets = { '1k': 1000, '3k': 3000, '5k': 5000, '7k': 7000, '10k': 10000, '20k': 20000, '42k': 42000 };
    var out = {};
    var d = s.dist, t = s.time, n = d.length;
    Object.keys(targets).forEach(function (label) {
      var L = targets[label];
      var best = null;
      if (n >= 2 && d[n - 1] >= L) {
        var j = 0;
        for (var i = 0; i < n; i++) {
          // 시작점 d[i] 에서 L 만큼 간 지점의 시각
          while (j < n - 1 && d[j] < d[i] + L) j++;
          if (d[j] < d[i] + L) break;
          var seg = d[j] - d[j - 1];
          var tEnd = seg > 0 ? t[j - 1] + (t[j] - t[j - 1]) * (d[i] + L - d[j - 1]) / seg : t[j];
          var el = tEnd - t[i];
          if (el > 0 && (best == null || el < best)) best = el;
        }
      }
      out['speed_' + label] = best ? Math.round((L / best) * 10000) / 10000 : null;
    });
    return out;
  }

  function fmtPace(secPerKm) {
    if (!(secPerKm > 0) || !isFinite(secPerKm)) return '--';
    var m = Math.floor(secPerKm / 60), sec = Math.round(secPerKm % 60);
    if (sec === 60) { m += 1; sec = 0; }
    return m + "'" + String(sec).padStart(2, '0') + '"';
  }

  function loadDualWriteModule() {
    return import('/assets/js/supabaseDualWrite.js');
  }

  /** @param {'ride'|'run'|'walk'} kind */
  function saveRide(kind) {
    var uid = currentUid();
    if (!uid) return Promise.reject(new Error('로그인 후 저장할 수 있습니다.'));
    kind = kind === 'run' || kind === 'walk' ? kind : 'ride';
    var el = elapsedNow();
    var d = new Date(st.startedAt || Date.now());
    var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var km = Math.round(st.distanceM / 10) / 100;
    var avg = Math.round(avgSpeedKmh() * 10) / 10;
    var weight = Number((window.currentUser && (window.currentUser.weight || window.currentUser.weightKg)) || 0);
    var courseTitle = st.course && st.course.title ? st.course.title : '';
    var titleBase = { ride: courseTitle ? '아웃도어 라이딩' : '자유 라이딩', run: '아웃도어 러닝', walk: '아웃도어 걷기' }[kind];
    var payload = {
      kind: kind,
      activity_id: 'outdoor_' + uid.slice(0, 8) + '_' + (st.startedAt || Date.now()),
      date: dateStr,
      start_time: new Date(st.startedAt || Date.now()).toISOString(),
      title: courseTitle ? titleBase + ' · ' + courseTitle : titleBase,
      distance_km: km,
      duration_sec: Math.round(el / 1000),
      moving_time_sec: st.movingMs > 0 ? Math.round(st.movingMs / 1000) : null,
      elevation_gain_m: Math.round(st.elevGainM),
      avg_speed_kmh: avg > 0 ? avg : null,
      max_speed_kmh: st.maxSpeedKmh > 0 ? Math.round(st.maxSpeedKmh * 10) / 10 : null,
      weight: weight > 0 ? weight : null,
      summary_polyline: st.track.length >= 2 ? encodePolyline(thin(st.track, 1500)) : null,
      elevation_profile: elevationProfile()
    };
    if (kind !== 'ride') {
      var s = trackSeries();
      var splits = computeSplits(s);
      var movingSec = payload.moving_time_sec || payload.duration_sec;
      payload.splits_metric = splits;
      payload.performance_metrics = {
        avg_pace_sec_per_km: km > 0 ? Math.round(movingSec / km) : null,
        best_split_pace_sec_per_km: splits.filter(function (x) { return x.distance === 1000; })
          .reduce(function (b, x) { return b == null || x.elapsed_time < b ? x.elapsed_time : b; }, null),
        classification: st.lastClassify || null
      };
      if (kind === 'run') {
        var eff = computeEfforts(s);
        // 1km 미만 등 기록할 구간이 하나도 없으면 빈 행을 만들지 않음
        if (Object.keys(eff).some(function (k) { return eff[k] != null; })) payload.efforts = eff;
      }
    }
    return loadDualWriteModule().then(function (mod) {
      if (!mod || typeof mod.callSupabaseRpcAsUser !== 'function') throw new Error('저장 모듈을 불러오지 못했습니다.');
      return mod.callSupabaseRpcAsUser('fn_save_outdoor_activity', { p: payload });
    }).then(function (res) {
      if (kind === 'ride') {
        // 주간 TSS·랭킹 등 실시간 보드 갱신 신호(실내 훈련 저장과 동일)
        try {
          if (typeof window.stelvioHandleRankingMetricsLiveUpdate === 'function') {
            window.stelvioHandleRankingMetricsLiveUpdate({ source: 'ride_write' }).catch(function () {});
          }
        } catch (e) {}
      }
      return res;
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
    st.mvHist = [];
    st.distAnchor = null;
    st.altBase = null;
    st.altEma = null;
    st.track = [];
    st.lastTrackPt = null;
    st.lastClassify = null;
    trailClear();
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
    var cls = classifyActivity();
    st.lastClassify = { kind: cls.kind, reason: cls.reason, avg_kmh: Math.round(cls.avgKmh * 10) / 10, p90_kmh: Math.round(cls.p90Kmh * 10) / 10, max60_kmh: Math.round(cls.max60Kmh * 10) / 10 };
    var chosen = cls.kind;
    var KIND_LABEL = { ride: '🚴 라이딩', run: '🏃 러닝', walk: '🚶 걷기' };
    var old = $('outdFinishModal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'outdFinishModal';
    m.className = 'outd-finish';
    var movingSec = (st.movingMs || el) / 1000;
    var km = st.distanceM / 1000;
    var splits = computeSplits(trackSeries());
    function statsHtml() {
      var foot = chosen !== 'ride';
      return '<div><dt>거리</dt><dd>' + km.toFixed(2) + ' km</dd></div>' +
        '<div><dt>시간</dt><dd>' + fmtHms(el) + '</dd></div>' +
        (foot
          ? '<div><dt>평균 페이스</dt><dd>' + fmtPace(km > 0 ? movingSec / km : 0) + ' /km</dd></div>'
          : '<div><dt>평균 속도</dt><dd>' + (isFinite(avg) ? avg : 0).toFixed(1) + ' km/h</dd></div>') +
        '<div><dt>누적 고도</dt><dd>' + Math.round(st.elevGainM) + ' m</dd></div>' +
        '<div><dt>이동 시간</dt><dd>' + fmtHms(st.movingMs) + '</dd></div>' +
        (foot
          ? '<div><dt>평균 속도</dt><dd>' + (isFinite(avg) ? avg : 0).toFixed(1) + ' km/h</dd></div>'
          : '<div><dt>최고 속도</dt><dd>' + st.maxSpeedKmh.toFixed(1) + ' km/h</dd></div>');
    }
    function splitsHtml() {
      if (chosen === 'ride' || !splits.length) return '';
      return '<div class="outd-finish__splits"><div class="outd-finish__splits-h">구간 페이스</div>' +
        splits.map(function (x) {
          var pace = x.distance > 0 ? x.elapsed_time / (x.distance / 1000) : 0;
          return '<div><span>' + (x.distance === 1000 ? x.split + ' km' : (x.distance / 1000).toFixed(2) + ' km') + '</span><b>' + fmtPace(pace) + '</b></div>';
        }).join('') + '</div>';
    }
    function render() {
      m.innerHTML =
        '<div class="outd-finish__card" role="dialog" aria-modal="true">' +
        '<h3>운동 종료</h3>' +
        '<div class="outd-finish__kind" role="radiogroup" aria-label="운동 종류">' +
        ['ride', 'run', 'walk'].map(function (k) {
          return '<button type="button" data-kind="' + k + '" class="outd-finish__kindbtn' + (k === chosen ? ' is-on' : '') + '" aria-checked="' + (k === chosen) + '" role="radio">' + KIND_LABEL[k] + '</button>';
        }).join('') +
        '</div>' +
        '<p class="outd-finish__why">자동 판별: ' + KIND_LABEL[cls.kind] + ' · ' + cls.reason + '</p>' +
        '<dl class="outd-finish__stats">' + statsHtml() + '</dl>' +
        splitsHtml() +
        '<div class="outd-finish__btns">' +
        '<button type="button" class="outd-finish__btn outd-finish__btn--primary" data-act="save">' +
        (chosen === 'ride' ? '라이딩 훈련 일지에 저장하고 종료' : '러닝 기록에 저장하고 종료' + (chosen === 'walk' ? ' (걷기)' : '')) + '</button>' +
        '<button type="button" class="outd-finish__btn" data-act="gpx">GPX 파일 받기</button>' +
        '<button type="button" class="outd-finish__btn" data-act="discard">저장하지 않고 종료</button>' +
        '<button type="button" class="outd-finish__btn outd-finish__btn--ghost" data-act="resume">계속하기</button>' +
        '</div></div>';
    }
    render();
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var kb = e.target.closest && e.target.closest('[data-kind]');
      if (kb) {
        chosen = kb.getAttribute('data-kind');
        render();
        return;
      }
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'resume') {
        m.remove();
        window.toggleOutdoorRide();
      } else if (act === 'gpx') {
        downloadGpx();
      } else if (act === 'discard') {
        if (!window.confirm('이번 기록을 저장하지 않고 종료할까요?')) return;
        m.remove();
        resetRide();
        toast('기록을 저장하지 않고 종료했습니다.', 'info');
      } else if (act === 'save') {
        // 저장 종목은 화면에서 선택돼 보이는 버튼 기준(표시와 저장이 어긋나지 않게)
        var onBtn = m.querySelector('.outd-finish__kindbtn.is-on');
        var savedKind = onBtn ? onBtn.getAttribute('data-kind') : chosen;
        if (savedKind !== 'ride' && savedKind !== 'run' && savedKind !== 'walk') savedKind = chosen;
        var label = btn.textContent;
        btn.disabled = true;
        btn.textContent = '저장 중...';
        saveRide(savedKind).then(function () {
          m.remove();
          resetRide();
          toast(savedKind === 'ride' ? '라이딩 훈련 일지에 저장했습니다.' : (savedKind === 'run' ? '러닝' : '걷기') + ' 기록으로 저장했습니다.', 'success');
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = label;
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
    cameraFrame();
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
