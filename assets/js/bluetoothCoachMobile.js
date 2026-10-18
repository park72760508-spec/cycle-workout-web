/**
 * Live Training Room — Coach 휴대폰 전용 화면 (#bluetoothCoachMobileScreen)
 *
 * 디자인은 모바일 훈련 화면(#mobileDashboardScreen)과 같지만 완전히 별개로 동작한다.
 * - 데이터·제어는 기존 Coach 엔진(bluetoothCoachDashboard.js)을 그대로 사용:
 *   참가자 수신(bluetoothCoachState.powerMeters), 워크아웃 적용(applyBluetoothCoachSelectedWorkout /
 *   selectWorkoutForBluetoothCoach), 시작·일시정지(toggleStartPauseBluetoothCoachTraining),
 *   건너뛰기·종료, 경과시간·랩 카운트다운(엔진이 PC 화면 DOM 에 기록하는 값).
 * - 휴대폰에서 Coach 화면(bluetoothTrainingCoachScreen)으로 들어오면 엔진 초기화 직후 이 화면을 띄운다.
 * - 연결 메뉴: 슬롯(1~N : 사용자명) → 선택한 사용자의 데이터를 계기판에 표시, 구분선 아래 워크아웃 선택.
 */
(function () {
  'use strict';

  var SCREEN_ID = 'bluetoothCoachMobileScreen';
  var PC_SCREEN_ID = 'bluetoothTrainingCoachScreen';
  var SPEED_STALE_MS = 5000;

  var st = {
    trackId: null, // 선택된 슬롯(트랙) — null 이면 첫 접속 사용자 자동 선택
    displayPower: 0,
    rafId: null,
    lastTextAt: 0,
    lastGraphAt: 0,
    gaugeFtp: 0,
    statusRef: null,
    statusCb: null,
    workoutCache: { general: null }
  };

  function $(id) { return document.getElementById(id); }

  /** 휴대폰(폰 크기 터치 기기)만 — 태블릿·PC 는 기존 Coach 화면 */
  function isPhone() {
    // localStorage stelvioCoachLayout = 'mobile' | 'pc' 로 강제 가능(점검·특수 기기용)
    try {
      var forced = localStorage.getItem('stelvioCoachLayout');
      if (forced === 'mobile') return true;
      if (forced === 'pc') return false;
    } catch (e) {}
    var ua = navigator.userAgent || '';
    if (/iPhone|iPod/.test(ua)) return true;
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
    try {
      return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
    } catch (e) {
      return false;
    }
  }
  window.isCoachMobilePhone = isPhone;

  function isActive() {
    var el = $(SCREEN_ID);
    return !!(el && el.classList.contains('active'));
  }

  function coachState() {
    return window.bluetoothCoachState || {};
  }

  function powerMeters() {
    var pms = coachState().powerMeters;
    return Array.isArray(pms) ? pms : [];
  }

  function selectedPm() {
    var pms = powerMeters();
    if (!pms.length) return null;
    var pm = null;
    if (st.trackId != null) {
      pm = pms.find(function (p) { return p && String(p.id) === String(st.trackId); }) || null;
    }
    // 직접 고르기 전(자동 선택)에는 빈 슬롯에 머물지 않고 접속자가 생기면 그 슬롯으로
    if (pm && !pm.userName && !st.userPicked) pm = null;
    if (!pm) {
      pm = pms.find(function (p) { return p && p.userName; }) || pms[0];
      if (pm) st.trackId = pm.id;
    }
    return pm;
  }

  function textOf(id) {
    var el = $(id);
    return el ? String(el.textContent || '').trim() : '';
  }

  function escapeText(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---------- 계기판(모바일 훈련 화면과 같은 눈금·라벨) ---------- */
  function buildTicks() {
    var html = '';
    for (var i = 0; i <= 24; i++) {
      var isMajor = i % 4 === 0;
      var angle = 180 + (i / 24) * 180;
      if (angle >= 360) angle = angle % 360;
      var rad = (angle * Math.PI) / 180;
      var inner = 70;
      var len = isMajor ? 14 : 7;
      html += '<line x1="' + (100 + inner * Math.cos(rad)) + '" y1="' + (140 + inner * Math.sin(rad)) +
        '" x2="' + (100 + (inner + len) * Math.cos(rad)) + '" y2="' + (140 + (inner + len) * Math.sin(rad)) +
        '" stroke="#ffffff" stroke-width="' + (isMajor ? 2.5 : 1.5) + '"/>';
    }
    return html;
  }

  /** ftp > 0 이면 W 눈금, 모르면(0) PC Coach와 같은 FTP 배수(0.33·0.67·1…) 눈금 — 기본값 200W 숫자로 오인 표시 방지 */
  function buildLabels(ftp) {
    var mults = [0, 0.33, 0.67, 1, 1.33, 1.67, 2];
    var known = Number(ftp) > 0;
    var html = '';
    mults.forEach(function (m, i) {
      var angle = 180 + (i / 6) * 180;
      if (angle >= 360) angle = angle % 360;
      var rad = (angle * Math.PI) / 180;
      var label;
      if (known) {
        var v = Math.round(ftp * m);
        label = v === 0 ? '0 w' : String(v);
      } else {
        label = m === 0 ? '0' : String(m);
      }
      html += '<text x="' + (100 + 98 * Math.cos(rad)) + '" y="' + (140 + 98 * Math.sin(rad)) +
        '" text-anchor="middle" dominant-baseline="middle" fill="' + (m === 1 ? '#ef4444' : '#ffffff') +
        '" font-size="10" font-weight="600">' + label + '</text>';
    });
    return html;
  }

  function buildSpeedLabels() {
    var vals = [0, 20, 40, 60, 80, 100, 120];
    var html = '';
    vals.forEach(function (val, i) {
      var rad = ((360 - (i / 6) * 180) * Math.PI) / 180;
      html += '<text x="' + (100 + 60 * Math.cos(rad)) + '" y="' + (140 + 60 * Math.sin(rad)) +
        '" text-anchor="middle" dominant-baseline="middle" fill="#4595e6" font-size="6">' + (val === 0 ? '0 km/h' : String(val)) + '</text>';
    });
    return html;
  }

  function ensureGaugeScale(ftp) {
    if (st.gaugeFtp === ftp && $('coachm-gauge-ticks') && $('coachm-gauge-ticks').childNodes.length) return;
    st.gaugeFtp = ftp;
    if ($('coachm-gauge-ticks')) $('coachm-gauge-ticks').innerHTML = buildTicks();
    if ($('coachm-gauge-labels')) $('coachm-gauge-labels').innerHTML = buildLabels(ftp);
    if ($('coachm-gauge-speed-labels')) $('coachm-gauge-speed-labels').innerHTML = buildSpeedLabels();
  }

  /** 목표 파워 원호 — LAP AVG/목표 ≥ 98.5% 면 민트, 아니면 주황 (모바일 훈련 화면과 동일) */
  function updateTargetArc(target, lap, ftp) {
    var arc = $('coachm-gauge-target-arc');
    var targetEl = $('coachm-ui-target-power');
    if (!arc) return;
    if (!(target > 0)) {
      arc.style.display = 'none';
      if (targetEl) targetEl.setAttribute('fill', '#ff8c00');
      return;
    }
    var ok = lap / target >= 0.985;
    var ratio = Math.min(Math.max(target / (ftp * 2), 0), 1);
    var endRad = ((180 + ratio * 180) * Math.PI) / 180;
    var sx = 100 + 80 * Math.cos(Math.PI);
    var sy = 140 + 80 * Math.sin(Math.PI);
    var ex = 100 + 80 * Math.cos(endRad);
    var ey = 140 + 80 * Math.sin(endRad);
    arc.setAttribute('d', 'M ' + sx + ' ' + sy + ' A 80 80 0 0 1 ' + ex + ' ' + ey);
    arc.setAttribute('stroke', ok ? '#00d4aa' : '#ff8c00'); // 목표값 숫자와 같은 진한 민트/주황(2026-10-18)
    arc.style.display = 'block';
    if (targetEl) targetEl.setAttribute('fill', ok ? '#00d4aa' : '#ff8c00');
  }

  /** 속도계 센서 원호 (0~120 km/h, 모바일 훈련 화면과 동일) */
  function updateSpeedArc(pm) {
    var arc = $('coachm-gauge-speed-arc');
    var dot = $('coachm-gauge-speed-dot');
    var dotValue = $('coachm-gauge-speed-dot-value');
    if (!arc) return;
    var speed = Number(pm && pm.speed) || 0;
    var fresh = pm && pm.lastUpdateTime && Date.now() - Number(pm.lastUpdateTime) <= SPEED_STALE_MS;
    if (!fresh) speed = 0;
    var total = Math.PI * 80;
    var ratio = Math.min(Math.max(speed / 120, 0), 1);
    arc.style.strokeDasharray = total + ' ' + total;
    arc.style.strokeDashoffset = String(total - total * ratio);
    if (dot && dotValue) {
      var rad = ((360 - ratio * 180) * Math.PI) / 180;
      var cx = 100 + 80 * Math.cos(rad);
      var cy = 140 + 80 * Math.sin(rad);
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dotValue.setAttribute('x', cx);
      dotValue.setAttribute('y', cy);
      dotValue.textContent = String(Math.round(speed));
    }
  }

  function setText(id, v) {
    var el = $(id);
    if (el && el.textContent !== String(v)) el.textContent = String(v);
  }

  function renderTexts(pmRaw) {
    var cs = coachState();
    // 접속자가 없는 슬롯은 엔진 기본값(목표 등) 대신 0 으로 표시
    var pm = pmRaw && pmRaw.userName ? pmRaw : (pmRaw ? { id: pmRaw.id } : null);
    var name = pm ? (pm.userName || ('슬롯 ' + pm.id)) : '슬롯 선택';
    setText('coachm-user-name', pm ? pm.id + ' : ' + name : name);
    setText('coachm-main-timer', textOf('bluetoothCoachElapsedTime') || '00:00:00');
    setText('coachm-ui-lap-time', textOf('bluetoothCoachLapCountdown') || '00:00');

    var w = cs.currentWorkout;
    var segInfo = textOf('bluetoothCoachCurrentSegmentInfo');
    setText('coachm-segment-info', w && w.segments && w.segments.length
      ? (segInfo || (w.title || '워크아웃'))
      : '워크아웃을 선택하세요');

    // 2026-10-10: 목표 파워 = 현재 세그먼트 목표 % × 트랙 사용자 프로필 FTP (PC Coach 와 같은 계산)
    if (pmRaw && pm && pm.userName && pm.userId && typeof window.bluetoothCoachResolveFtp === 'function') {
      var resolved = window.bluetoothCoachResolveFtp(pmRaw, pm.userId, pmRaw.userFTP);
      if (resolved > 0) pmRaw.userFTP = resolved;
    }
    var target = Math.round(userTargetPower(pm));
    var lap = Math.round(Number(pm && pm.segmentPower) || 0);
    setText('coachm-ui-target-power', target);
    setText('coachm-ui-current-power', Math.round(Number(pm && pm.currentPower) || 0));
    setText('coachm-ui-cadence', Math.round(Number(pm && pm.cadence) || 0));
    setText('coachm-ui-lap-power', lap);
    setText('coachm-ui-hr', Math.round(Number(pm && pm.heartRate) || 0));

    var ftpKnown = Number(pm && pm.userFTP) > 0;
    var ftp = ftpKnown ? Number(pm.userFTP) : 200; // 바늘·원호 배율 계산용(눈금 숫자는 모르면 배수로 표시)
    ensureGaugeScale(ftpKnown ? ftp : 0);
    updateTargetArc(target, lap, ftp);
    updateSpeedArc(pm);

    var state = cs.trainingState || 'idle';
    var img = $('coachmToggleImg');
    var icon = state === 'running' ? 'assets/img/pause0.png' : 'assets/img/play0.png';
    if (img && img.getAttribute('href') !== icon) img.setAttribute('href', icon);
    var pulse = $('coachmStartPulseWrap');
    if (pulse) {
      var showPulse = state !== 'running' && !!(w && w.segments && w.segments.length);
      pulse.classList.toggle('pulse-active', showPulse);
      pulse.classList.toggle('pulse-hidden', !showPulse);
    }
  }

  function renderGraph() {
    var cs = coachState();
    var w = cs.currentWorkout;
    var canvas = $('coachmSegmentGraph');
    if (!canvas) return;
    var hasWorkout = !!(w && Array.isArray(w.segments) && w.segments.length);
    var ph = $('coachmGraphPlaceholder');
    if (ph) ph.style.display = hasWorkout ? 'none' : 'flex';
    if (!hasWorkout || typeof window.drawSegmentGraph !== 'function') {
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    var idx = cs.trainingState === 'idle' ? -1 : (cs.currentSegmentIndex || 0);
    // 그래프 FTP = 선택한 슬롯 사용자의 FTP (없으면 workoutManager 기본 로직)
    var pmSel = selectedPm();
    window.__coachmGraphFtp = Number(pmSel && pmSel.userName && pmSel.userFTP) || 0;
    window.drawSegmentGraph(w.segments, idx, 'coachmSegmentGraph', Number(cs.totalElapsedTime) || 0);
  }

  function loop() {
    if (!isActive()) {
      st.rafId = null;
      return;
    }
    checkLoadingDone();
    if (st.monitorMode) {
      var nowM = Date.now();
      if (!st.lastMonitorAt || nowM - st.lastMonitorAt >= 300) {
        st.lastMonitorAt = nowM;
        renderMonitor(false);
      }
    }
    var pm = selectedPm();
    var target = pm && pm.userName ? Math.max(0, Number(pm.currentPower) || 0) : 0;
    var diff = target - st.displayPower;
    st.displayPower = Math.abs(diff) > 0.1 ? st.displayPower + diff * 0.15 : target;
    var ftp = Number(pm && pm.userName && pm.userFTP) || 200;
    var ratio = Math.min(Math.max(st.displayPower / (ftp * 2), 0), 1);
    var needle = $('coachm-gauge-needle');
    if (needle) needle.setAttribute('transform', 'translate(100, 140) rotate(' + (-90 + ratio * 180) + ')');

    var now = Date.now();
    if (now - st.lastTextAt >= 150) {
      st.lastTextAt = now;
      renderTexts(pm);
      var menu = $('coachmMenu');
      if (menu && menu.classList.contains('show')) {
        /*
         * 2026-09-30: 메뉴를 연 뒤 슬롯이 준비되거나(첫 진입 직후 연결 메뉴를 누른 경우) 접속자가 바뀌면 목록을 다시 그림.
         * 예전에는 메뉴를 여는 순간 한 번만 그려, 트랙 데이터가 1초 뒤 준비돼도 "슬롯 정보를 불러오는 중..."에 머물렀다.
         */
        if (slotListSignature() !== st.slotListSig) renderSlotList();
        else updateSlotAchievementDots();
      }
    }
    if (now - st.lastGraphAt >= 1000) {
      st.lastGraphAt = now;
      renderGraph();
    }
    st.rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (st.rafId == null) st.rafId = requestAnimationFrame(loop);
  }

  /* ---------- 시작 카운트다운 (엔진이 기록하는 status.countdownRemainingSec) ---------- */
  function subscribeStatus() {
    unsubscribeStatus();
    try {
      var sid = typeof window.getBluetoothCoachSessionId === 'function' ? window.getBluetoothCoachSessionId()
        : (window.SESSION_ID || window.currentTrainingRoomId);
      var db = window.db || (window.firebase && window.firebase.database && window.firebase.database());
      if (!sid || !db) return;
      // 2026-10-18: SDK 무응답 휴대폰 대비 — Coach 엔진의 SDK 우선 + REST 스트림 폴백 구독 사용
      var watch = typeof window.bluetoothCoachWatch === 'function'
        ? window.bluetoothCoachWatch
        : function (dbi, path, cb) {
            var r = dbi.ref(path);
            var c = r.on('value', cb);
            return function () { try { r.off('value', c); } catch (e) {} };
          };
      st.planUnsub = watch(db, 'sessions/' + sid + '/workoutPlan', function (snap) {
        var v = snap && snap.val();
        st.fbPlan = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : null);
      });
      st.statusUnsub = watch(db, 'sessions/' + sid + '/status', function (snap) {
        var s = snap && snap.val();
        st.fbStatus = s || null;
        var overlay = $('coachmCountdownOverlay');
        if (!overlay) return;
        var n = s && s.state === 'countdown' ? Number(s.countdownRemainingSec) : NaN;
        if (Number.isFinite(n) && n > 0) {
          clearTimeout(st.cdHideTimer);
          st.startCdShown = true;
          st.segCdShown = false;
          setText('coachmCountdownNumber', n);
          overlay.style.display = 'flex';
        } else if ((Number.isFinite(n) && n === 0) || (st.startCdShown && s && s.state === 'running')) {
          // 5·4·3·2·1 다음 "Go!" 1초 표시 (시작 카운트다운에서만)
          clearTimeout(st.cdHideTimer);
          st.startCdShown = false;
          setText('coachmCountdownNumber', 'Go!');
          overlay.style.display = 'flex';
          st.cdHideTimer = setTimeout(function () { overlay.style.display = 'none'; }, 1000);
        } else if (st.startCdShown) {
          st.startCdShown = false;
          overlay.style.display = 'none';
        } else {
          updateSegmentEndCountdown(s, overlay);
        }
      });
    } catch (e) {
      console.warn('[Coach Mobile] status 구독 실패:', e && e.message ? e.message : e);
    }
  }

  /**
   * 2026-10-10: 세그먼트 종료 5초 카운트다운 — PC Coach와 같은 시점·숫자(남은 6초 → 5 … 남은 1초 → 0, 0.8초 뒤 닫힘,
   * 마지막 세그먼트는 표시 안 함). PC는 자기 화면에서만 띄우므로 휴대폰은 PC가 매초 기록하는
   * status.segmentIndex·segmentElapsedSec와 워크아웃 구간 길이로 동일하게 계산한다.
   */
  function updateSegmentEndCountdown(s, overlay) {
    function hide() {
      if (st.segCdShown) { overlay.style.display = 'none'; st.segCdShown = false; }
    }
    if (!s || s.state !== 'running') { hide(); return; }
    var cs = coachState();
    var segs = (cs.currentWorkout && Array.isArray(cs.currentWorkout.segments) && cs.currentWorkout.segments.length)
      ? cs.currentWorkout.segments : (st.fbPlan || []);
    var idx = Number(s.segmentIndex);
    if (!(idx >= 0) || !segs[idx] || idx >= segs.length - 1) { hide(); return; }
    var dur = Number(segs[idx].duration_sec || segs[idx].duration || 0);
    var el = Number(s.segmentElapsedSec);
    if (!(dur > 0) || !Number.isFinite(el)) { hide(); return; }
    var remaining = Math.round(dur - el);
    if (remaining >= 1 && remaining <= 6) {
      var num = remaining - 1;
      if (st.segCdKey !== idx + ':' + num) {
        st.segCdKey = idx + ':' + num;
        clearTimeout(st.cdHideTimer);
        setText('coachmCountdownNumber', num);
        overlay.style.display = 'flex';
        st.segCdShown = true;
        if (num === 0) {
          st.cdHideTimer = setTimeout(function () { overlay.style.display = 'none'; st.segCdShown = false; }, 800);
        }
      }
    } else {
      hide();
    }
  }

  function unsubscribeStatus() {
    if (typeof st.statusUnsub === 'function') {
      try { st.statusUnsub(); } catch (e) {}
    }
    if (typeof st.planUnsub === 'function') {
      try { st.planUnsub(); } catch (e) {}
    }
    st.statusUnsub = null;
    st.planUnsub = null;
    st.fbStatus = null;
    st.fbPlan = null;
  }

  /* ---------- 슬롯 정보 로딩 스피너 (2026-10-18) ----------
   * 진입 후 슬롯(트랙)이 만들어지고 참가자 정보가 처음 들어올 때까지 녹색 스피너 오버레이.
   * (Coach 엔진이 bluetoothCoachState._usersDataAt 에 첫 수신 시각 기록) 25초가 지나면 그냥 닫는다. */
  var LOADING_MAX_MS = 25000;
  function loadingEl() {
    var el = $('coachmLoadingOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'coachmLoadingOverlay';
    el.className = 'coachm-loading-overlay';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="auth-transition-spinner-stage coachm-loading-overlay__spinner" aria-hidden="true">' +
      '<div class="auth-transition-spinner-glow"></div>' +
      '<div class="auth-transition-spinner-ring auth-transition-spinner-ring--track"></div>' +
      '<div class="auth-transition-spinner-ring auth-transition-spinner-ring--spin"></div>' + // 바깥 원 1개만(안쪽 원 없음)
      '</div>' +
      '<p class="coachm-loading-overlay__msg">슬롯 정보를 불러오는 중...</p>';
    el.addEventListener('click', hideLoading); // 기다리지 않고 바로 화면을 보려면 탭해서 닫기
    // 화면(스크린) 요소 안에 두면 그 요소 높이·변형 기준으로 배치돼 휴대폰 화면 중앙에서 벗어날 수 있어 body 에 붙인다
    document.body.appendChild(el);
    return el;
  }
  function showLoading() {
    var el = loadingEl();
    if (!el) return;
    st.loadingSince = Date.now();
    el.style.display = 'flex';
  }
  function hideLoading() {
    st.loadingSince = 0;
    var el = $('coachmLoadingOverlay');
    if (el) el.style.display = 'none';
  }
  /** loop 에서 호출 — 슬롯이 있고 참가자 정보가 들어왔으면(또는 시간 초과) 닫기 */
  function checkLoadingDone() {
    if (!st.loadingSince) return;
    var cs = coachState();
    var ready = powerMeters().length > 0 && Number(cs._usersDataAt) > 0;
    if (ready || Date.now() - st.loadingSince > LOADING_MAX_MS) hideLoading();
  }

  function onEnter() {
    showLoading();
    applyMonitorMode();
    st.userPicked = false;
    st.trackId = null;
    st.displayPower = 0;
    st.gaugeFtp = 0;
    closeMenu();
    subscribeStatus();
    startLoop();
    armSlotWatchdog();
  }

  /*
   * 안전장치(2026-09-29): 진입 후에도 슬롯(트랙)이 만들어지지 않으면 엔진 초기화를 다시 호출.
   * 트랙 구성 조회가 네트워크 재연결 중 멈추거나 초기화 호출이 누락돼 "슬롯 정보를 불러오는 중..."에 머물던 문제.
   */
  var slotWatchdogTimer = null;
  function armSlotWatchdog() {
    if (slotWatchdogTimer) clearTimeout(slotWatchdogTimer);
    var tries = 0;
    function check() {
      slotWatchdogTimer = null;
      if (!isActive()) return;
      if (powerMeters().length) return;
      tries++;
      if (typeof window.initBluetoothCoachDashboard === 'function') window.initBluetoothCoachDashboard();
      if (tries < 3) slotWatchdogTimer = setTimeout(check, 20000);
    }
    slotWatchdogTimer = setTimeout(check, 20000); // 첫 초기화(구성 조회 최대 ~13초)가 끝날 시간을 준 뒤
  }

  function onLeave() {
    hideLoading();
    if (slotWatchdogTimer) { clearTimeout(slotWatchdogTimer); slotWatchdogTimer = null; }
    unsubscribeStatus();
    closeMenu();
    closeCoachMobileWorkoutPicker();
  }

  /* ---------- 연결 메뉴: 슬롯 목록 · 워크아웃 선택 ---------- */

  /**
   * 트랙 목표 파워: 현재 세그먼트 목표 % × 사용자 프로필 FTP(PC Coach 와 같은 함수). 사용자 기기 보고값은
   * 세그먼트 전환·FTP 차이로 늦거나 틀릴 수 있어(예: 120 고정) FTP·워크아웃을 모를 때만 보조로 쓴다.
   */
  function userTargetPower(pm) {
    var cs = coachState();
    var fbS = st.fbStatus || {};
    var w = cs.currentWorkout;
    var segs = Array.isArray(st.fbPlan) && st.fbPlan.length ? st.fbPlan : (w && w.segments);
    var ftp = Number(pm && pm.userFTP) || 0;
    if (pm && pm.userName && ftp > 0 && Array.isArray(segs) && segs.length && typeof window.bluetoothCoachSegmentTargetPower === 'function') {
      var idx = typeof fbS.segmentIndex === 'number' ? fbS.segmentIndex : (cs.currentSegmentIndex || 0);
      var seg = segs[idx] || segs[0];
      return window.bluetoothCoachSegmentTargetPower(seg, ftp) || 0;
    }
    if (pm && typeof pm.reportedTargetPower === 'number' && isFinite(pm.reportedTargetPower)) return pm.reportedTargetPower;
    return Number(pm && pm.targetPower) || 0;
  }

  /**
   * 세그먼트 달성도 점 색 — 사용자 계기판 목표 원호와 동일 규칙:
   * LAP AVG / 목표 ≥ 98.5% 민트, 미만 주황. 워밍업·휴식·쿨다운·목표 없음·RPM 목표는 회색.
   */
  function achievementClass(pm) {
    // 방의 Firebase 상태·워크아웃 계획 우선 — 워크아웃을 고르지 않은(나중에 접속한) Coach 기기에서도 동일
    var cs = coachState();
    var fbS = st.fbStatus || {};
    var w = cs.currentWorkout;
    var segments = Array.isArray(st.fbPlan) && st.fbPlan.length ? st.fbPlan : (w && Array.isArray(w.segments) ? w.segments : []);
    var idx = typeof fbS.segmentIndex === 'number' ? fbS.segmentIndex : (cs.currentSegmentIndex || 0);
    var state = fbS.state || cs.trainingState;
    var seg = segments[idx] || null;
    var type = String(seg && seg.segment_type || '').toLowerCase();
    if (!seg || type === 'warmup' || type === 'rest' || type === 'cooldown' || seg.target_type === 'cadence_rpm') return 'rest';
    if (state !== 'running' && state !== 'paused') return 'rest';
    var target = userTargetPower(pm);
    if (!(target > 0)) return 'rest';
    return (Number(pm.segmentPower) || 0) / target >= 0.985 ? 'ok' : 'under';
  }

  function updateSlotAchievementDots() {
    var list = $('coachmSlotList');
    if (!list) return;
    var pms = powerMeters();
    Array.prototype.forEach.call(list.querySelectorAll('.coachm-slot-item[data-track]'), function (row) {
      var dot = row.querySelector('.coachm-slot-item__ach');
      if (!dot) return;
      var pm = pms.find(function (p) { return p && String(p.id) === row.getAttribute('data-track'); });
      var cls = 'coachm-slot-item__ach coachm-slot-item__ach--' + (pm && pm.userName ? achievementClass(pm) : 'rest');
      if (dot.className !== cls) dot.className = cls;
    });
  }
  /** 슬롯 목록 구성(트랙 수·접속자 이름·선택 슬롯) — 바뀌었을 때만 다시 그리기 위한 비교값 */
  function slotListSignature() {
    var pms = powerMeters();
    var sel = selectedPm();
    return pms.length + '|' + (sel ? sel.id : '') + '|' + pms.map(function (p) { return p && p.userName ? p.userName : ''; }).join(',');
  }

  function renderSlotList() {
    var list = $('coachmSlotList');
    if (!list) return;
    st.slotListSig = slotListSignature();
    var pms = powerMeters();
    var sel = selectedPm();
    if (!pms.length) {
      list.innerHTML = '<div class="coachm-slot-item coachm-slot-item--empty"><span class="coachm-slot-item__name">슬롯 정보를 불러오는 중...</span></div>';
      return;
    }
    list.innerHTML = pms.map(function (pm) {
      var has = !!pm.userName;
      return '<div class="coachm-slot-item' + (has ? '' : ' coachm-slot-item--empty') +
        (sel && String(sel.id) === String(pm.id) ? ' selected' : '') + '" data-track="' + escapeText(pm.id) + '">' +
        // 슬롯에 사용자가 접속해 있으면 번호와 같은 색(민트), 비어 있으면 회색
        '<span class="coachm-slot-item__dot' + (has ? ' on' : '') + '"></span>' +
        '<span class="coachm-slot-item__no">' + escapeText(pm.id) + '</span>' +
        '<span class="coachm-slot-item__name">' + (has ? escapeText(pm.userName) : '-') + '</span>' +
        (has ? '<span class="coachm-slot-item__ach coachm-slot-item__ach--' + achievementClass(pm) + '" title="세그먼트 달성도"></span>' : '') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.coachm-slot-item[data-track]'), function (row) {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        st.trackId = row.getAttribute('data-track');
        st.userPicked = true;
        st.displayPower = 0;
        st.lastTextAt = 0;
        closeMenu();
      });
    });
  }

  /* ---------- 모니터 대시보드 (2026-10-18) ----------
   * 연결 메뉴 > 모니터 대시보드: 속도계 계기판 자리에 슬롯 카드 최대 20개(한 줄 5개).
   * 카드: 슬롯번호 · 사용자명 · 현재 파워 · 랩 평균 파워 · RPM · BPM.
   * 카드 바탕색은 PC Coach 슬롯 정보창(updateBluetoothCoachInfoBarColor)과 같은 규칙:
   *   흰색 = 접속자 없음 / 연한 하늘색 = 접속했지만 10초 데이터 없음·훈련 전 / 초록 = 훈련 중 랩 달성 98.5% 이상 / 주황 = 미만
   * 카드를 누르면 그 슬롯을 선택하고 계기판 화면으로 돌아간다. */
  var MONITOR_MAX = 20;
  var MONITOR_LS = 'coachmMonitorMode';
  st.monitorMode = (function () { try { return localStorage.getItem(MONITOR_LS) === '1'; } catch (e) { return false; } })();

  function monitorCardState(pm) {
    if (!pm || !pm.userName) return 'idle';
    var fresh = Date.now() - Number(pm.lastUpdateTime || 0) <= 10000;
    var hasData = fresh && ((Number(pm.currentPower) || 0) > 0 || (Number(pm.cadence) || 0) > 0 || (Number(pm.heartRate) || 0) > 0);
    var cs = coachState();
    var state = (st.fbStatus && st.fbStatus.state) || cs.trainingState;
    if (!hasData || state !== 'running') return 'waiting';
    var target = Number(userTargetPower(pm)) || Number(pm.targetPower) || 0;
    var lap = Number(pm.segmentPower) || 0;
    return target <= 0 || (lap / target) * 100 >= 98.5 ? 'ok' : 'low';
  }

  /* 모니터 화면 = [위: 랩 카운트다운] + [카드 그리드], 하단 통계(CADENCE·LAP AVG·HEART RATE) 자리에 건너뛰기·시작·종료 버튼 */
  function monitorGrid() {
    var grid = $('coachmMonitorGrid');
    if (grid) return grid;
    var screen = $(SCREEN_ID);
    var gauge = screen && screen.querySelector('.mobile-gauge-container');
    if (!gauge || !gauge.parentNode) return null;
    var wrap = document.createElement('div');
    wrap.id = 'coachmMonitor';
    wrap.className = 'coachm-monitor';
    wrap.innerHTML =
      '<div class="coachm-monitor__lap"><span class="coachm-monitor__lap-label">LAP</span><span id="coachmMonitorLapTime" class="coachm-monitor__lap-time">00:00</span></div>' +
      '<div id="coachmMonitorGrid" class="coachm-monitor__grid" role="list" aria-label="모니터 대시보드"></div>';
    gauge.parentNode.insertBefore(wrap, gauge.nextSibling);
    grid = $('coachmMonitorGrid');
    ensureMonitorControls();
    grid.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.coachm-mcard[data-track]');
      if (!card) return;
      st.trackId = card.getAttribute('data-track');
      st.userPicked = true;
      st.displayPower = 0;
      st.lastTextAt = 0;
      setMonitorMode(false); // 고른 슬롯을 계기판으로 크게 보기
    });
    return grid;
  }

  /** 하단 버튼(건너뛰기·시작/일시정지·종료) — 계기판 버튼과 같은 함수 호출 */
  function ensureMonitorControls() {
    if ($('coachmMonitorControls')) return;
    var screen = $(SCREEN_ID);
    var footer = screen && screen.querySelector('.mobile-stats-footer');
    if (!footer || !footer.parentNode) return;
    var bar = document.createElement('div');
    bar.id = 'coachmMonitorControls';
    bar.className = 'coachm-monitor-controls';
    bar.innerHTML =
      '<button type="button" class="coachm-mctl" aria-label="건너뛰기" onclick="handleCoachMobileSkip()"><img src="assets/img/next0.png" alt=""></button>' +
      '<button type="button" class="coachm-mctl coachm-mctl--main" aria-label="시작/일시정지" onclick="handleCoachMobileToggle()"><img id="coachmMonitorToggleImg" src="assets/img/play0.png" alt=""></button>' +
      '<button type="button" class="coachm-mctl" aria-label="종료" onclick="handleCoachMobileStop()"><img src="assets/img/stop0.png" alt=""></button>';
    footer.parentNode.insertBefore(bar, footer.nextSibling);
  }

  function applyMonitorMode() {
    var screen = $(SCREEN_ID);
    var gauge = screen && screen.querySelector('.mobile-gauge-container');
    var grid = monitorGrid();
    var wrap = $('coachmMonitor');
    if (gauge) gauge.style.display = st.monitorMode ? 'none' : '';
    if (wrap) wrap.style.display = st.monitorMode ? 'flex' : 'none';
    var label = $('coachmMonitorMenuLabel');
    if (label) label.textContent = st.monitorMode ? '계기판 보기' : '모니터 대시보드';
    if (screen) screen.classList.toggle('coachm-monitor-on', !!st.monitorMode);
    st.monitorSig = '';
    if (st.monitorMode) renderMonitor(true);
  }

  function setMonitorMode(on) {
    st.monitorMode = !!on;
    try { localStorage.setItem(MONITOR_LS, on ? '1' : '0'); } catch (e) {}
    applyMonitorMode();
  }

  window.toggleCoachMobileMonitor = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    setMonitorMode(!st.monitorMode);
  };

  function monitorNum(v) {
    var n = Math.round(Number(v) || 0);
    return n > 0 ? String(n) : '–';
  }

  /** 카드 목록(슬롯 구성)이 바뀔 때만 다시 만들고, 값·색은 매번 제자리 갱신 */
  function renderMonitor(force) {
    if (!st.monitorMode) return;
    var grid = monitorGrid();
    if (!grid) return;
    // 랩 카운트다운·시작 버튼 아이콘은 계기판(숨김)과 같은 값
    var lapSrc = $('coachm-ui-lap-time');
    var lapEl = $('coachmMonitorLapTime');
    if (lapSrc && lapEl && lapEl.textContent !== lapSrc.textContent) lapEl.textContent = lapSrc.textContent;
    var tgSrc = $('coachmToggleImg');
    var tgEl = $('coachmMonitorToggleImg');
    if (tgSrc && tgEl) {
      var href = tgSrc.getAttribute('href') || tgSrc.getAttribute('xlink:href');
      if (href && tgEl.getAttribute('src') !== href) tgEl.setAttribute('src', href);
    }
    var pms = powerMeters().slice(0, MONITOR_MAX);
    var sig = pms.map(function (pm) { return pm.id; }).join(',');
    if (force || sig !== st.monitorSig) {
      st.monitorSig = sig;
      if (!pms.length) {
        grid.innerHTML = '<div class="coachm-monitor__empty">슬롯 정보를 불러오는 중...</div>';
        return;
      }
      grid.innerHTML = pms.map(function (pm) {
        return '<div class="coachm-mcard" role="listitem" data-track="' + escapeText(pm.id) + '">' +
          '<div class="coachm-mcard__head"><span class="coachm-mcard__no"></span><span class="coachm-mcard__name"></span></div>' +
          '<div class="coachm-mcard__power"><b class="coachm-mcard__pw"></b><small>W</small></div>' +
          '<div class="coachm-mcard__stats">' +
          '<div class="coachm-mcard__row"><i>LAP</i><b class="coachm-mcard__lap"></b></div>' +
          '<div class="coachm-mcard__row"><i>RPM</i><b class="coachm-mcard__rpm"></b></div>' +
          '<div class="coachm-mcard__row"><i>BPM</i><b class="coachm-mcard__bpm"></b></div>' +
          '</div></div>';
      }).join('');
    }
    var sel = st.trackId;
    var cards = grid.querySelectorAll('.coachm-mcard');
    pms.forEach(function (pm, i) {
      var card = cards[i];
      if (!card) return;
      var state = monitorCardState(pm);
      var cls = 'coachm-mcard coachm-mcard--' + state + (sel != null && String(sel) === String(pm.id) ? ' is-selected' : '');
      if (card.className !== cls) card.className = cls;
      function put(selector, text) {
        var el = card.querySelector(selector);
        if (el && el.textContent !== text) el.textContent = text;
      }
      put('.coachm-mcard__no', String(pm.id));
      put('.coachm-mcard__name', pm.userName ? String(pm.userName) : '비어 있음');
      put('.coachm-mcard__pw', pm.userName ? String(Math.round(Number(pm.currentPower) || 0)) : '–');
      put('.coachm-mcard__lap', pm.userName ? monitorNum(pm.segmentPower) : '–');
      put('.coachm-mcard__rpm', pm.userName ? monitorNum(pm.cadence) : '–');
      put('.coachm-mcard__bpm', pm.userName ? monitorNum(pm.heartRate) : '–');
    });
  }

  function closeMenu() {
    var menu = $('coachmMenu');
    if (menu) menu.classList.remove('show');
  }

  window.toggleCoachMobileMenu = function () {
    var menu = $('coachmMenu');
    if (!menu) return;
    var open = !menu.classList.contains('show');
    if (open) renderSlotList();
    menu.classList.toggle('show', open);
  };

  /** 워크아웃 미설정 그래프(막대) 클릭 → 연결 메뉴를 펼치고 워크아웃 선택 항목이 보이게 */
  window.openCoachMobileWorkoutMenu = function (e) {
    if (e) e.stopPropagation(); // 문서 클릭(메뉴 닫기) 처리로 바로 닫히지 않게
    var menu = $('coachmMenu');
    if (!menu) return;
    renderSlotList();
    menu.classList.add('show');
    var divider = menu.querySelector('.coachm-menu-divider');
    if (divider) menu.scrollTop = Math.max(0, divider.offsetTop - 8);
  };

  document.addEventListener('click', function (e) {
    var menu = $('coachmMenu');
    if (!menu || !menu.classList.contains('show')) return;
    if (e.target.closest && (e.target.closest('#coachmMenu') || e.target.closest('#coachmMenuBtn'))) return;
    closeMenu();
  });

  function workoutMinutes(w) {
    var sec = Number(w.total_seconds || w.totalSeconds) || 0;
    if (!sec && Array.isArray(w.segments)) {
      sec = w.segments.reduce(function (a, s) { return a + (Number(s.duration_sec) || 0); }, 0);
    }
    return Math.round(sec / 60);
  }

  /** 클럽 워크아웃 세그먼트(target_value 문자열) → 엔진·참가자가 쓰는 형식 */
  function normalizeClubWorkout(w) {
    return {
      id: String(w.id),
      title: w.title,
      description: w.description || '',
      author: w.author || '',
      source: 'club',
      groupId: w.groupId,
      total_seconds: w.total_seconds,
      segments: (w.segments || []).map(function (s) {
        var type = s.target_type === 'ftp_percent' ? 'ftp_pct' : String(s.target_type || 'ftp_pct');
        var val = s.target_value;
        if (type !== 'dual' && type !== 'ftp_pctz') {
          var n = Number(val);
          val = Number.isFinite(n) ? n : val;
        }
        return {
          label: s.label || '',
          segment_type: s.segment_type || 'interval',
          duration_sec: Number(s.duration_sec) || 0,
          target_type: type,
          target_value: val,
          ramp: s.ramp || 'none',
          ramp_to_value: s.ramp_to_value != null ? Number(s.ramp_to_value) : null
        };
      })
    };
  }

  function currentWorkoutId() {
    var w = coachState().currentWorkout;
    return w && w.id != null ? String(w.id) : '';
  }

  function renderPickerItems(items, grouped) {
    var list = $('coachmWorkoutPickerList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="coachm-picker__empty">' +
        (grouped ? '이 Training Room 에 연결된 클럽의 그룹 전용 워크아웃이 없습니다.' : '워크아웃이 없습니다.') + '</div>';
      return;
    }
    var curId = currentWorkoutId();
    var html = '';
    var lastGroup = null;
    items.forEach(function (w, i) {
      if (grouped && w.groupName !== lastGroup) {
        lastGroup = w.groupName;
        html += '<div class="coachm-picker__group">' + escapeText(lastGroup) + '</div>';
      }
      html += '<button type="button" class="coachm-picker__item' + (String(w.id) === curId ? ' selected' : '') + '" data-index="' + i + '">' +
        '<span class="coachm-picker__item-title">' + escapeText(w.title || '제목 없음') + '</span>' +
        '<span class="coachm-picker__item-min">' + workoutMinutes(w) + '분</span></button>';
    });
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll('.coachm-picker__item'), function (btn) {
      btn.addEventListener('click', function () {
        var w = items[Number(btn.getAttribute('data-index'))];
        if (w) chooseWorkout(w, grouped);
      });
    });
  }

  function chooseWorkout(w, isClub) {
    // PC Coach 와 동일하게 선택 허용 — 방 상태가 이전 훈련의 'paused' 로 남아 있는 경우가 많다.
    // 실제로 진행 중(running)일 때만 확인 후 교체(적용 시 엔진이 idle 로 초기화)
    if (coachState().trainingState === 'running' && !confirm('훈련이 진행 중입니다. 워크아웃을 바꿀까요?')) return;
    closeCoachMobileWorkoutPicker();
    if (isClub) {
      if (typeof window.applyBluetoothCoachSelectedWorkout === 'function') {
        window.applyBluetoothCoachSelectedWorkout(normalizeClubWorkout(w));
      }
    } else if (typeof window.selectWorkoutForBluetoothCoach === 'function') {
      window.selectWorkoutForBluetoothCoach(String(w.id));
    }
    st.lastGraphAt = 0;
  }

  async function loadGroupWorkouts() {
    var sid = typeof window.getBluetoothCoachSessionId === 'function' ? window.getBluetoothCoachSessionId()
      : (window.SESSION_ID || window.currentTrainingRoomId);
    var rpc = typeof window.stelvioSupabaseRpc === 'function'
      ? window.stelvioSupabaseRpc
      : (await import('/assets/js/supabaseDualWrite.js')).callSupabaseRpcAsUser;
    var res = await rpc('fn_club_workouts_for_training_room', { p_room_code: String(sid || '') });
    if (!res || res.success !== true || !Array.isArray(res.items)) throw new Error('그룹 전용 워크아웃을 불러오지 못했습니다.');
    return res.items;
  }

  async function loadGeneralWorkouts() {
    if (st.workoutCache.general) return st.workoutCache.general;
    if (typeof window.apiGetWorkouts !== 'function') throw new Error('워크아웃 목록을 불러올 수 없습니다.');
    var r = await window.apiGetWorkouts();
    var items = r && r.success && Array.isArray(r.items) ? r.items.filter(function (w) { return w && w.id && w.title; }) : [];
    st.workoutCache.general = items;
    return items;
  }

  /** 선택 창을 지금 보이는 Coach 화면(PC/휴대폰) 안으로 옮김 — 숨겨진 화면 안에 있으면 보이지 않으므로 */
  function mountPickerToActiveScreen() {
    var picker = $('coachmWorkoutPicker');
    if (!picker) return null;
    var pc = $(PC_SCREEN_ID);
    var host = pc && pc.classList.contains('active') ? pc : $(SCREEN_ID);
    if (host && picker.parentNode !== host) host.appendChild(picker);
    return picker;
  }

  /**
   * PC Coach 화면 "워크아웃 선택" — 그룹 전용 / 일반 워크아웃 중 선택(2026-10-03).
   * 그룹 전용은 휴대폰 화면과 같은 목록(이 Training Room 에 연결된 클럽의 그룹 전용 워크아웃), 일반은 기존 PC 선택 창.
   */
  window.openCoachPcWorkoutChooser = function () {
    var picker = mountPickerToActiveScreen();
    var list = $('coachmWorkoutPickerList');
    if (!picker || !list) {
      if (typeof window.openWorkoutSelectionModalForBluetoothCoach === 'function') window.openWorkoutSelectionModalForBluetoothCoach();
      return;
    }
    setText('coachmWorkoutPickerTitle', '워크아웃 선택');
    list.innerHTML =
      '<button type="button" class="coachm-picker__item" data-kind="group"><span class="coachm-picker__item-title">그룹 전용 워크아웃</span><span class="coachm-picker__item-min">클럽</span></button>' +
      '<button type="button" class="coachm-picker__item" data-kind="general"><span class="coachm-picker__item-title">일반 워크아웃</span><span class="coachm-picker__item-min">STELVIO</span></button>';
    picker.style.display = 'flex';
    Array.prototype.forEach.call(list.querySelectorAll('[data-kind]'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-kind') === 'group') {
          window.openCoachMobileWorkoutPicker('group');
        } else {
          closeCoachMobileWorkoutPicker();
          if (typeof window.openWorkoutSelectionModalForBluetoothCoach === 'function') window.openWorkoutSelectionModalForBluetoothCoach();
        }
      });
    });
  };

  window.openCoachMobileWorkoutPicker = async function (kind) {
    closeMenu();
    var picker = mountPickerToActiveScreen();
    var list = $('coachmWorkoutPickerList');
    if (!picker || !list) return;
    var grouped = kind === 'group';
    setText('coachmWorkoutPickerTitle', grouped ? '워크아웃 선택 (그룹 전용)' : '워크아웃 선택 (일반 워크아웃)');
    list.innerHTML = '<div class="coachm-picker__empty">불러오는 중...</div>';
    picker.style.display = 'flex';
    try {
      var items = grouped ? await loadGroupWorkouts() : await loadGeneralWorkouts();
      if (picker.style.display === 'none') return;
      renderPickerItems(items, grouped);
    } catch (e) {
      list.innerHTML = '<div class="coachm-picker__empty">' + escapeText(e && e.message ? e.message : '불러오지 못했습니다.') + '</div>';
    }
  };

  window.closeCoachMobileWorkoutPicker = closeCoachMobileWorkoutPicker;
  function closeCoachMobileWorkoutPicker() {
    var picker = $('coachmWorkoutPicker');
    if (picker) picker.style.display = 'none';
  }

  /* ---------- 계기판 버튼: 엔진 제어 그대로 ---------- */
  window.handleCoachMobileToggle = function () {
    if (typeof window.toggleStartPauseBluetoothCoachTraining === 'function') window.toggleStartPauseBluetoothCoachTraining();
    st.lastTextAt = 0;
  };
  window.handleCoachMobileSkip = function () {
    if (coachState().trainingState !== 'running') return;
    if (typeof window.skipCurrentBluetoothCoachSegmentTraining === 'function') window.skipCurrentBluetoothCoachSegmentTraining();
  };
  window.handleCoachMobileStop = function () {
    var state = coachState().trainingState;
    if (state !== 'running' && state !== 'paused') return;
    if (!confirm('훈련을 종료할까요?')) return;
    if (typeof window.stopBluetoothCoachTraining === 'function') window.stopBluetoothCoachTraining();
  };

  /**
   * 연결 메뉴 "슬롯 비우기" — STELVIO 스타일 확인 후 이 Live Training Session 의 모든 슬롯 사용자 제거
   * (Live Training Session 화면 "퇴실"과 같은 clearAllBluetoothTracksData: users 삭제, 트랙 수 유지)
   */
  window.confirmCoachMobileClearSlots = function (e) {
    if (e) e.stopPropagation();
    closeMenu();
    var sid = typeof window.getBluetoothCoachSessionId === 'function' ? window.getBluetoothCoachSessionId()
      : (window.SESSION_ID || window.currentTrainingRoomId);
    var run = function () {
      if (typeof window.clearAllBluetoothTracksData !== 'function') {
        if (typeof window.showToast === 'function') window.showToast('슬롯 비우기 기능을 불러오지 못했습니다.', 'error');
        return;
      }
      window.clearAllBluetoothTracksData({ skipConfirm: true, roomId: sid });
      st.trackId = null;
      st.userPicked = false;
      st.displayPower = 0;
    };
    var msg = '모든 슬롯을 비우시겠습니까?';
    if (typeof window.showStelvioExitConfirmPopup === 'function') {
      window.showStelvioExitConfirmPopup(run, { message: msg, cancelText: '취소', okText: '비우기' });
    } else if (window.confirm(msg)) {
      run();
    }
  };

  /** 연결 > 종료 — STELVIO 확인창 후 CYCLE 베이스캠프로 */
  window.exitCoachMobileScreen = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    var state = coachState().trainingState;
    var msg = (state === 'running' || state === 'paused')
      ? '훈련이 진행 중입니다. Coach 화면을 종료하시겠습니까?'
      : 'Coach 화면을 종료하시겠습니까?';
    var run = function () {
      // 종료 → CYCLE 베이스캠프
      if (typeof window.enterCycleBasecamp === 'function') window.enterCycleBasecamp();
      else if (typeof window.showScreen === 'function') window.showScreen('basecampScreen');
    };
    if (typeof window.showStelvioExitConfirmPopup === 'function') {
      window.showStelvioExitConfirmPopup(run, { message: msg, cancelText: '취소', okText: '종료' });
    } else if (window.confirm(msg)) {
      run();
    }
  };

  /* ---------- 라우팅: 휴대폰에서 Coach 화면 진입 시 전용 화면으로 ----------
   * showScreen 은 여러 모듈이 감싸고 로드 순서에 따라 래퍼가 교체되므로, 화면 활성화(class active)를
   * 직접 감지한다. PC Coach 화면이 켜지면(엔진 초기화 시작) 휴대폰에서는 곧바로 전용 화면으로 전환. */
  var wasActive = false;
  function onPcScreenClass() {
    var pc = $(PC_SCREEN_ID);
    if (!pc || !pc.classList.contains('active')) return;
    if (!isPhone() || window.__coachForcePcScreen) return;
    // Coach 엔진 초기화가 PC 화면에 active 를 다시 붙여도 이미 휴대폰 화면이면 재전환하지 않음
    // (재전환하면 표시 애니메이션이 처음부터 다시 시작돼 깜빡여 보인다). PC 화면은 CSS 로 숨김.
    if (isActive()) return;
    // MutationObserver 콜백은 화면을 그리기 전에 실행된다 — 지연(setTimeout) 없이 바로 전환해야
    // PC Coach 화면이 한 프레임 그려졌다 사라지는 깜빡임이 생기지 않는다.
    if (typeof window.showScreen === 'function') window.showScreen(SCREEN_ID, true);
    // Coach 엔진(트랙 그리드·Firebase 구독) 초기화 — index.html showScreen 폴백이 하던 초기화를
    // 휴대폰 전환에서는 폴백을 건너뛰므로 여기서 보장한다.
    setTimeout(function () {
      if (typeof window.initBluetoothCoachDashboard === 'function') window.initBluetoothCoachDashboard();
    }, 100);
  }
  function onMobileScreenClass() {
    var active = isActive();
    if (active && !wasActive) onEnter();
    else if (!active && wasActive) onLeave();
    wasActive = active;
  }
  function install() {
    if (window.__coachMobileInstalled) return;
    // 휴대폰에서는 PC Coach 화면을 그리지 않음(엔진 초기화용 DOM 은 유지) — 전환 중 깜빡임 방지
    try { document.documentElement.classList.toggle('coachm-phone', isPhone()); } catch (e) {}
    var pc = $(PC_SCREEN_ID);
    var mobile = $(SCREEN_ID);
    if (!pc || !mobile || typeof MutationObserver !== 'function') return;
    window.__coachMobileInstalled = true;
    new MutationObserver(onPcScreenClass).observe(pc, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(onMobileScreenClass).observe(mobile, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
