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

  function buildLabels(ftp) {
    var mults = [0, 0.33, 0.67, 1, 1.33, 1.67, 2];
    var html = '';
    mults.forEach(function (m, i) {
      var angle = 180 + (i / 6) * 180;
      if (angle >= 360) angle = angle % 360;
      var rad = (angle * Math.PI) / 180;
      var v = Math.round(ftp * m);
      html += '<text x="' + (100 + 98 * Math.cos(rad)) + '" y="' + (140 + 98 * Math.sin(rad)) +
        '" text-anchor="middle" dominant-baseline="middle" fill="' + (m === 1 ? '#ef4444' : '#ffffff') +
        '" font-size="10" font-weight="600">' + (v === 0 ? '0 w' : String(v)) + '</text>';
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
    arc.setAttribute('stroke', ok ? 'rgba(0, 212, 170, 0.5)' : 'rgba(255, 140, 0, 0.5)');
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

    var target = Math.round(Number(pm && pm.targetPower) || 0);
    var lap = Math.round(Number(pm && pm.segmentPower) || 0);
    setText('coachm-ui-target-power', target);
    setText('coachm-ui-current-power', Math.round(Number(pm && pm.currentPower) || 0));
    setText('coachm-ui-cadence', Math.round(Number(pm && pm.cadence) || 0));
    setText('coachm-ui-lap-power', lap);
    setText('coachm-ui-hr', Math.round(Number(pm && pm.heartRate) || 0));

    var ftp = Number(pm && pm.userFTP) || 200;
    ensureGaugeScale(ftp);
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
    if (!w || !Array.isArray(w.segments) || !w.segments.length || typeof window.drawSegmentGraph !== 'function') {
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    var idx = cs.trainingState === 'idle' ? -1 : (cs.currentSegmentIndex || 0);
    window.drawSegmentGraph(w.segments, idx, 'coachmSegmentGraph', Number(cs.totalElapsedTime) || 0);
  }

  function loop() {
    if (!isActive()) {
      st.rafId = null;
      return;
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
      st.statusRef = db.ref('sessions/' + sid + '/status');
      st.statusCb = st.statusRef.on('value', function (snap) {
        var s = snap && snap.val();
        var overlay = $('coachmCountdownOverlay');
        if (!overlay) return;
        var n = s && s.state === 'countdown' ? Number(s.countdownRemainingSec) : NaN;
        if (Number.isFinite(n) && n > 0) {
          setText('coachmCountdownNumber', n);
          overlay.style.display = 'flex';
        } else {
          overlay.style.display = 'none';
        }
      });
    } catch (e) {
      console.warn('[Coach Mobile] status 구독 실패:', e && e.message ? e.message : e);
    }
  }

  function unsubscribeStatus() {
    if (st.statusRef && st.statusCb) {
      try { st.statusRef.off('value', st.statusCb); } catch (e) {}
    }
    st.statusRef = null;
    st.statusCb = null;
  }

  function onEnter() {
    st.displayPower = 0;
    st.gaugeFtp = 0;
    closeMenu();
    subscribeStatus();
    startLoop();
  }

  function onLeave() {
    unsubscribeStatus();
    closeMenu();
    closeCoachMobileWorkoutPicker();
  }

  /* ---------- 연결 메뉴: 슬롯 목록 · 워크아웃 선택 ---------- */
  function renderSlotList() {
    var list = $('coachmSlotList');
    if (!list) return;
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
        '<span class="coachm-slot-item__dot' + (has && pm.connected !== false ? ' on' : '') + '"></span>' +
        '<span class="coachm-slot-item__no">' + escapeText(pm.id) + '</span>' +
        '<span class="coachm-slot-item__name">' + (has ? escapeText(pm.userName) : '미접속') + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.coachm-slot-item[data-track]'), function (row) {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        st.trackId = row.getAttribute('data-track');
        st.displayPower = 0;
        st.lastTextAt = 0;
        closeMenu();
      });
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
    var state = coachState().trainingState;
    if (state === 'running' || state === 'paused') {
      if (typeof window.showToast === 'function') window.showToast('훈련 중에는 워크아웃을 바꿀 수 없습니다. 종료 후 선택하세요.');
      return;
    }
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

  window.openCoachMobileWorkoutPicker = async function (kind) {
    closeMenu();
    var picker = $('coachmWorkoutPicker');
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

  window.exitCoachMobileScreen = function () {
    var state = coachState().trainingState;
    if ((state === 'running' || state === 'paused') && !confirm('훈련이 진행 중입니다. Coach 화면을 나갈까요?')) return;
    closeMenu();
    var back = $('btnBackFromBluetoothCoach');
    if (back) back.click();
    else if (typeof window.showScreen === 'function') window.showScreen('connectionScreen');
  };

  /* ---------- 라우팅: 휴대폰에서 Coach 화면 진입 시 전용 화면으로 ----------
   * showScreen 은 여러 모듈이 감싸고 로드 순서에 따라 래퍼가 교체되므로, 화면 활성화(class active)를
   * 직접 감지한다. PC Coach 화면이 켜지면(엔진 초기화 시작) 휴대폰에서는 곧바로 전용 화면으로 전환. */
  var wasActive = false;
  function onPcScreenClass() {
    var pc = $(PC_SCREEN_ID);
    if (!pc || !pc.classList.contains('active')) return;
    if (!isPhone() || window.__coachForcePcScreen) return;
    setTimeout(function () {
      if (typeof window.showScreen === 'function') window.showScreen(SCREEN_ID, true);
    }, 0);
  }
  function onMobileScreenClass() {
    var active = isActive();
    if (active && !wasActive) onEnter();
    else if (!active && wasActive) onLeave();
    wasActive = active;
  }
  function install() {
    if (window.__coachMobileInstalled) return;
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
