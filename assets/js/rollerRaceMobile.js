/*
 * STELVIO Race 모바일 개인 기록 모니터 (#rrMobileScreen) — 2026-11-15
 *  - 개인훈련 모바일 화면 골격 + 평로라 레이스 항목: 센서 연결, 레이스 설정(시간/거리), 평균 속도 그래프, 속도계(TARGET 자리 = 누적 거리 0.00),
 *    LAP AVG(SPEED AVG / km/h 선택), 현재 값(속도 / 파워 선택), 시작·종료(저장) 버튼, 레이스 진행율 바.
 *  - 속도: 휠 센서(CSC 0x1816) 원시 패킷을 직접 처리(웹 BLE: connectedDevices.speed.characteristic, 앱: window 'speedUpdate' 이벤트).
 *    PC Race 와 같은 규칙 — 새 휠 이벤트가 3초 이상 없으면 정지(저속은 간격의 3배·최대 5초), 표시는 3초 시간가중 평균 + 스프링.
 *  - 계산(거리·평균·최고·저장)은 센서 원본 값, 평균/스프링은 표시 전용.
 *  - 저장: Supabase RPC fn_save_race_record (rides·랭킹·TSS·포인트와 분리된 전용 테이블).
 */
(function (w) {
  'use strict';

  var SCREEN_ID = 'rrMobileScreen';
  var LS_KEY = 'stelvioRaceMobile';
  var WHEEL_SPECS = { '23-622': 2096, '25-622': 2105, '28-622': 2136, '32-622': 2155 };
  var GAUGE_MAX = 120;            // km/h (PC Race 와 같은 눈금)
  var STOP_MIN_MS = 3000, STOP_MAX_MS = 5000;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (typeof w.showToast === 'function') w.showToast(msg, type || 'info'); else alert(msg); }
  function nowMs() { return (w.performance && performance.now) ? performance.now() : Date.now(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtHMS(sec) { sec = Math.max(0, Math.floor(sec)); return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(sec % 60); }
  function fmtMS(sec) { sec = Math.max(0, Math.floor(sec)); return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60); }
  function isApp() { return !!(w.ReactNativeWebView || w.StelvioInApp); }

  /* ---------------- 상태 ---------------- */
  var S = {
    mode: 'time', targetMin: 10, targetKm: 5, wheel: '25-622', metric: 'speed', lap: 'avg',
    status: 'idle',                // idle | countdown | running | done
    startPerf: 0, startedAt: 0, elapsed: 0, dist: 0, maxKmh: 0, powSum: 0, powN: 0, clientId: '',
    // 센서(원시 CSC)
    rev: null, evT: null, rawKmh: 0, lastEvAt: 0, evInterval: 0, lastPacketAt: 0, stopped: true, speedOnly: false,
    boundChar: null,
    // 표시(평균·스프링)
    gs: null, gp: null, buf: [], stopApplied: false,
    pbuf: [], zbuf: [], zonePower: 0, hist: [], lastHistAt: 0, lastTick: 0, rafId: null, active: false, saved: null, lastResult: null
  };

  /* ---------------- 설정 저장/복원 ---------------- */
  function loadSettings() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
      if (o.mode === 'time' || o.mode === 'distance') S.mode = o.mode;
      if (o.targetMin > 0) S.targetMin = Math.min(600, o.targetMin);
      if (o.targetKm > 0) S.targetKm = Math.min(500, o.targetKm);
      if (WHEEL_SPECS[o.wheel]) S.wheel = o.wheel;
      if (o.metric === 'speed' || o.metric === 'power') S.metric = o.metric;
      if (o.lap === 'avg' || o.lap === 'power') S.lap = o.lap;
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ mode: S.mode, targetMin: S.targetMin, targetKm: S.targetKm, wheel: S.wheel, metric: S.metric, lap: S.lap })); } catch (e) {}
  }
  function targetValue() { return S.mode === 'time' ? S.targetMin * 60 : S.targetKm; } // 초 또는 km
  function circM() { return (WHEEL_SPECS[S.wheel] || 2105) / 1000; }

  /* ---------------- 센서: 원시 CSC 패킷 ---------------- */
  /** DataView(CSC Measurement) 처리 — PC Race 와 같은 계산(롤오버 보정·16틱 미만 무시·150km/h 초과 리셋) */
  function onCscView(dv) {
    try {
      var flags = dv.getUint8(0);
      if (!(flags & 0x01) || dv.byteLength < 7) return;
      var rev = dv.getUint32(1, true), t = dv.getUint16(5, true);
      var tn = nowMs();
      S.lastPacketAt = tn; S.lastCscAt = tn; S.speedOnly = false;
      if (S.rev === null) { S.rev = rev; S.evT = t; return; }
      if (t === S.evT) return;                                  // 같은 이벤트 반복(바퀴가 안 돌거나 다음 이벤트 전) — 0 으로 만들지 않음
      var dt = (t - S.evT + 65536) % 65536, dr = (rev - S.rev + 4294967296) % 4294967296;
      if (dt < 16) return;                                      // 약 15.6ms 미만은 노이즈
      if (dr > 0) {
        var meters = dr * circM();
        var v = (meters / (dt / 1024)) * 3.6;
        if (v > 150) { S.rev = rev; S.evT = t; return; }        // 이상치: 기준점만 리셋
        if (v < 0.1) v = 0;
        if (S.status === 'running') S.dist += meters / 1000;    // 거리는 기록 중에만, 회전수 × 둘레로 정확하게
        if (S.lastEvAt) S.evInterval = tn - S.lastEvAt;
        S.lastEvAt = tn; S.rawKmh = v; S.stopped = false;
        if (S.active && S.rafId == null) kick();
      }
      S.rev = rev; S.evT = t;
    } catch (e) {}
  }
  function onCharChanged(ev) { try { onCscView(ev.target.value); } catch (e) {} }
  /** 앱 브리지 'speedUpdate': 원시 바이트 배열 또는 {deviceId, speed} */
  function onSpeedUpdate(ev) {
    try {
      var d = ev && ev.detail;
      var raw = Array.isArray(d) ? d : (d && (Array.isArray(d.data) ? d.data : (Array.isArray(d.payload) ? d.payload : null)));  // 브리지와 같은 형식 허용
      if (raw) { var b = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) b[i] = raw[i] & 0xff; onCscView(new DataView(b.buffer)); }
      else if (d && typeof d.speed === 'number') applySpeedOnly(d.speed);
    } catch (e) {}
  }
  function onSpeedData(ev) { try { var d = ev && ev.detail; if (d && typeof d.speed === 'number') applySpeedOnly(d.speed); } catch (e) {} }
  /** 속도 값만 오는 경로(회전수 없음): 속도는 그대로, 거리는 속도 적분(loop 에서) */
  function applySpeedOnly(v) {
    var tn = nowMs();
    if (S.lastCscAt && tn - S.lastCscAt < 1500) return;          // 회전수 기반 경로가 살아 있으면 그쪽이 기준(거리 이중 집계 방지)
    S.lastPacketAt = tn; S.speedOnly = true;
    v = Math.max(0, Number(v) || 0); if (v > 150) return;
    if (S.lastEvAt) S.evInterval = tn - S.lastEvAt;
    S.lastEvAt = tn; S.rawKmh = v < 0.1 ? 0 : v; S.stopped = false;
    if (S.active && S.rafId == null) kick();
  }
  /** 웹 BLE: 연결된 속도계 특성에 우리 리스너를 추가(기존 handleSpeedSensorData 와 공존) */
  function bindWebSensor() {
    try {
      var cd = w.connectedDevices && w.connectedDevices.speed;
      var ch = cd && cd.characteristic;
      if (ch && ch !== S.boundChar && typeof ch.addEventListener === 'function') {
        if (S.boundChar && S.boundChar.removeEventListener) { try { S.boundChar.removeEventListener('characteristicvaluechanged', onCharChanged); } catch (e) {} }
        ch.addEventListener('characteristicvaluechanged', onCharChanged);
        S.boundChar = ch; S.rev = null; S.evT = null;
      } else if (!ch && S.boundChar) { S.boundChar = null; }
    } catch (e) {}
  }
  function sensorConnected() {
    var tn = nowMs();
    var web = !!(w.connectedDevices && w.connectedDevices.speed);
    return web || (S.lastPacketAt && tn - S.lastPacketAt < 8000);
  }

  /* ---------------- 시작 / 종료 ---------------- */
  var cdTimer = null;
  function rrmStart() {
    if (S.status === 'running' || S.status === 'countdown') return;
    bindWebSensor();
    if (!sensorConnected()) { toast('속도계 센서를 먼저 연결해주세요.', 'warning'); openSensorPopup(); return; }
    if (S.status === 'done') resetRace();
    S.status = 'countdown';
    var n = 3, ov = $('rrmCountdown'), num = $('rrmCountdownNum');
    function show() { if (num) { num.textContent = String(n); num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; } }
    if (ov) ov.classList.remove('hidden');
    show();
    cdTimer = setInterval(function () {
      n--;
      if (n <= 0) { clearInterval(cdTimer); cdTimer = null; if (ov) ov.classList.add('hidden'); beginRace(); return; }
      show();
    }, 1000);
  }
  function beginRace() {
    S.status = 'running';
    S.startPerf = nowMs(); S.startedAt = Date.now(); S.elapsed = 0; S.dist = 0; S.maxKmh = 0; S.powSum = 0; S.powN = 0;
    S.hist = []; S.lastHistAt = 0; S.lastTick = S.startPerf; S.saved = null;
    S.rev = null; S.evT = null;                                  // 시작 전에 돈 회전수가 거리에 섞이지 않게: 첫 패킷은 기준점만
    S.clientId = 'rr_' + String((w.currentUser && w.currentUser.id) || 'u').slice(0, 8) + '_' + S.startedAt;
    var sc = $(SCREEN_ID); if (sc) { sc.classList.add('rrm-running'); sc.classList.remove('rrm-done'); }
    var info = $('rrm-segment-info'); if (info) info.textContent = S.mode === 'time' ? '시간 레이스 진행 중' : '거리 레이스 진행 중';
    kick();
  }
  function resetRace() {
    S.status = 'idle'; S.elapsed = 0; S.dist = 0; S.maxKmh = 0; S.powSum = 0; S.powN = 0; S.hist = [];
    var sc = $(SCREEN_ID); if (sc) sc.classList.remove('rrm-running', 'rrm-done');
    var info = $('rrm-segment-info'); if (info) info.textContent = '레이스 설정을 확인하고 시작하세요';
    render(true);
  }
  function rrmStop() {
    if (S.status === 'countdown') { clearInterval(cdTimer); cdTimer = null; var ov = $('rrmCountdown'); if (ov) ov.classList.add('hidden'); S.status = 'idle'; return; }
    if (S.status !== 'running') return;
    var run = function () { finishRace(false); };
    if (typeof w.showStelvioExitConfirmPopup === 'function') {
      w.showStelvioExitConfirmPopup(run, { message: '레이스를 종료하고 기록을 저장할까요?', cancelText: '계속', okText: '종료·저장' });
    } else if (confirm('레이스를 종료하고 기록을 저장할까요?')) run();
  }
  function finishRace(completed) {
    if (S.status !== 'running') return;
    tick(nowMs(), true);                                     // 마지막 값 반영
    if (completed && S.mode === 'time') S.elapsed = Math.min(S.elapsed, targetValue()); // 완주 기록은 목표 시간을 넘기지 않음
    S.status = 'done';
    var sc = $(SCREEN_ID); if (sc) { sc.classList.remove('rrm-running'); if (completed) sc.classList.add('rrm-done'); }
    var avg = S.elapsed > 0 ? S.dist / (S.elapsed / 3600) : 0;
    S.lastResult = {
      client_id: S.clientId, mode: S.mode, target_value: S.mode === 'time' ? S.targetMin * 60 : S.targetKm, completed: !!completed,
      elapsed_sec: Math.round(S.elapsed), distance_km: Math.round(S.dist * 1000) / 1000, avg_speed_kmh: Math.round(avg * 100) / 100,
      max_speed_kmh: Math.round(S.maxKmh * 100) / 100, avg_power_w: S.powN ? Math.round(S.powSum / S.powN) : 0, wheel_size: S.wheel,
      started_at: new Date(S.startedAt).toISOString()
    };
    try { localStorage.setItem('rrMobileRaceLast', JSON.stringify(S.lastResult)); } catch (e) {}
    showResult(completed);
    render(true);
  }

  /* ---------------- 결과 / 저장 ---------------- */
  function showResult(completed) {
    var r = S.lastResult; if (!r) return;
    var t = $('rrmResultTitle'); if (t) t.textContent = completed ? '목표 달성! 레이스 완주' : '레이스 종료';
    function set(id, v) { var e = $(id); if (e) e.textContent = v; }
    set('rrmResDist', r.distance_km.toFixed(2) + ' km'); set('rrmResTime', fmtHMS(r.elapsed_sec));
    set('rrmResAvg', r.avg_speed_kmh.toFixed(1) + ' km/h'); set('rrmResMax', r.max_speed_kmh.toFixed(1) + ' km/h');
    var m = $('rrmResultModal'); if (m) m.classList.remove('hidden');
    saveRecord();
  }
  function setSaveStatus(text, kind) {
    var e = $('rrmSaveStatus'); if (!e) return; e.textContent = text; e.className = 'rrm-save-status' + (kind ? ' is-' + kind : '');
    var b = $('rrmRetrySave'); if (b) b.style.display = kind === 'err' ? '' : 'none';
  }
  function saveRecord() {
    var r = S.lastResult;
    if (!r) return;
    if (S.saved) { setSaveStatus('기록이 저장되었습니다.', 'ok'); return; }
    if (r.elapsed_sec < 5 || r.distance_km <= 0) { setSaveStatus('이동 거리가 없어 기록을 저장하지 않았습니다.', ''); return; }
    setSaveStatus('기록 저장 중...', '');
    postRecord(r).then(function () {
      S.saved = true; setSaveStatus('기록이 저장되었습니다.', 'ok');
    }).catch(function (e) {
      console.warn('[RaceMobile] 기록 저장 실패', e);
      setSaveStatus('기록 저장에 실패했습니다. 네트워크를 확인하고 [다시 저장]을 눌러주세요.', 'err');
    });
  }
  /** 서버 저장(멱등: 같은 client_id 는 중복 저장되지 않음). 성공하면 localStorage 의 마지막 기록에 saved 표시 */
  function postRecord(r) {
    var rpc = typeof w.stelvioSupabaseRpc === 'function' ? Promise.resolve(w.stelvioSupabaseRpc)
      : import('/assets/js/supabaseDualWrite.js').then(function (m) { return m.callSupabaseRpcAsUser; });
    return rpc.then(function (f) { return f('fn_save_race_record', { p: r }); }).then(function (res) {
      if (!(res && res.success)) throw new Error((res && res.error) || 'save_failed');
      try { var cur = JSON.parse(localStorage.getItem('rrMobileRaceLast') || 'null'); if (cur && cur.client_id === r.client_id) { cur.saved = true; localStorage.setItem('rrMobileRaceLast', JSON.stringify(cur)); } } catch (e) {}
      return res;
    });
  }
  /** 저장에 실패한 채 앱을 닫았다면, 다음 진입 때 조용히 다시 저장 시도 */
  function retryUnsavedRecord() {
    try {
      var r = JSON.parse(localStorage.getItem('rrMobileRaceLast') || 'null');
      if (!r || r.saved || !r.client_id || r.elapsed_sec < 5 || !(r.distance_km > 0)) return;
      if (S.lastResult && S.lastResult.client_id === r.client_id && S.saved) return;
      postRecord(r).then(function () { toast('저장되지 않았던 이전 레이스 기록을 저장했습니다.', 'success'); }).catch(function () {});
    } catch (e) {}
  }
  function rrmRetrySave() { saveRecord(); }
  function rrmCloseResult() { var m = $('rrmResultModal'); if (m) m.classList.add('hidden'); }

  /* ---------------- 설정 팝업 ---------------- */
  var presetsTime = [5, 10, 20, 30, 60], presetsDist = [2, 5, 10, 20, 40];
  var draft = null;
  function rrmOpenSettings() {
    closeMenus();
    if (S.status === 'running' || S.status === 'countdown') { toast('레이스 진행 중에는 설정을 바꿀 수 없습니다.', 'warning'); return; }
    draft = { mode: S.mode, targetMin: S.targetMin, targetKm: S.targetKm, wheel: S.wheel };
    renderSettings();
    var m = $('rrmSettingsModal'); if (m) m.classList.remove('hidden');
  }
  function rrmCloseSettings() { var m = $('rrmSettingsModal'); if (m) m.classList.add('hidden'); }
  function rrmPickMode(mode) {
    if (!draft) return;
    var inp = $('rrmTargetInput'); if (inp) readDraftTarget(inp.value);
    draft.mode = mode; renderSettings();
  }
  function readDraftTarget(v) {
    var n = parseFloat(v);
    if (!(n > 0)) return;
    if (draft.mode === 'time') draft.targetMin = Math.min(600, Math.max(1, Math.round(n)));
    else draft.targetKm = Math.min(500, Math.max(0.5, Math.round(n * 10) / 10));
  }
  function renderSettings() {
    var d = draft; if (!d) return;
    var bt = $('rrmModeTime'), bd = $('rrmModeDist');
    if (bt) bt.classList.toggle('is-on', d.mode === 'time'); if (bd) bd.classList.toggle('is-on', d.mode === 'distance');
    var inp = $('rrmTargetInput'), lbl = $('rrmTargetLabel'), pr = $('rrmPresets');
    if (d.mode === 'time') { if (lbl) lbl.textContent = '목표 시간 (분)'; if (inp) { inp.min = 1; inp.max = 600; inp.step = 1; inp.value = d.targetMin; } }
    else { if (lbl) lbl.textContent = '목표 거리 (km)'; if (inp) { inp.min = 0.5; inp.max = 500; inp.step = 0.5; inp.value = d.targetKm; } }
    if (pr) {
      var list = d.mode === 'time' ? presetsTime : presetsDist, cur = d.mode === 'time' ? d.targetMin : d.targetKm;
      pr.innerHTML = list.map(function (v) { return '<button type="button" data-v="' + v + '" class="' + (v === cur ? 'is-on' : '') + '">' + v + (d.mode === 'time' ? '분' : 'km') + '</button>'; }).join('');
      Array.prototype.forEach.call(pr.querySelectorAll('button'), function (b) {
        b.onclick = function () { var v = parseFloat(b.getAttribute('data-v')); if (d.mode === 'time') d.targetMin = v; else d.targetKm = v; renderSettings(); };
      });
    }
    var ws = $('rrmWheelSelect'); if (ws) ws.value = d.wheel;
  }
  function rrmSaveSettings() {
    if (!draft) return;
    var inp = $('rrmTargetInput'); if (inp) readDraftTarget(inp.value);
    var ws = $('rrmWheelSelect'); if (ws && WHEEL_SPECS[ws.value]) draft.wheel = ws.value;
    S.mode = draft.mode; S.targetMin = draft.targetMin; S.targetKm = draft.targetKm; S.wheel = draft.wheel;
    saveSettings(); rrmCloseSettings();
    if (S.status === 'done') resetRace();
    render(true);
  }

  /* ---------------- 메뉴(연결·속도/파워·LAP AVG) ---------------- */
  function closeMenus() {
    ['rrmConnectMenu', 'rrmMetricMenu', 'rrmLapMenu'].forEach(function (id) { var e = $(id); if (e) e.classList.remove('show'); });
  }
  function toggleMenu(id, ev, forceOpen) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    var e = $(id); if (!e) return;
    var open = forceOpen === true ? true : !e.classList.contains('show');
    closeMenus(); if (open) e.classList.add('show');
  }
  function rrmToggleMetricMenu(ev) { markMenu('rrmMetricMenu', 'data-metric', S.metric); toggleMenu('rrmMetricMenu', ev); }
  function rrmToggleLapMenu(ev) { markMenu('rrmLapMenu', 'data-lap', S.lap); toggleMenu('rrmLapMenu', ev); }
  function markMenu(id, attr, val) {
    var m = $(id); if (!m) return;
    Array.prototype.forEach.call(m.querySelectorAll('button'), function (b) { b.classList.toggle('is-on', b.getAttribute(attr) === val); });
  }
  function rrmSetMetric(m) { S.metric = m === 'power' ? 'power' : 'speed'; saveSettings(); closeMenus(); S.gp = null; S.pbuf.length = 0; S.powNum = 0; S.powNeedle = 0; render(true); }
  function rrmSetLap(m) { S.lap = m === 'power' ? 'power' : 'avg'; saveSettings(); closeMenus(); render(true); }
  /*
   * 센서 연결: 연결 버튼 → 트리 메뉴 [센서 연결 | 레이스 설정]. [센서 연결]은 개인훈련 모바일 화면에서 연결 버튼을 눌렀을 때와 같은
   * Device Settings 팝업(저장된 기기 상태 창 포함, trainingDashboardBridge.openDeviceSettingPopup)을 연다. 앱에서는 먼저 자동 연결을 중단.
   */
  function rrmToggleConnectMenu(ev) { toggleMenu('rrmConnectMenu', ev); }
  function openSensorPopup() {
    closeMenus();
    try { if (typeof w.abortAutoConnect === 'function') w.abortAutoConnect(); } catch (e) {}
    if (typeof w.openDeviceSettingPopup === 'function') { try { w.openDeviceSettingPopup(); return; } catch (e) {} }
    toast('센서 연결 화면을 열 수 없습니다. 잠시 후 다시 시도해주세요.', 'error');
  }
  var rrmOpenSensor = openSensorPopup;
  function rrmExit() {
    closeMenus();
    var go = function () {
      if (S.status === 'running' || S.status === 'countdown') resetRace();   // 진행 중이던 레이스는 폐기(상태·버튼 잠금 해제)
      if (typeof w.showScreen === 'function') w.showScreen('indoorTrainingSubScreen');
    };
    if (S.status === 'running' && typeof w.showStelvioExitConfirmPopup === 'function') {
      w.showStelvioExitConfirmPopup(go, { message: '진행 중인 레이스가 있습니다. 저장하지 않고 나갈까요?', cancelText: '계속', okText: '나가기' });
    } else go();
  }

  /* ---------------- 속도계 눈금 ---------------- */
  function ftpNow() {
    return Number((w.currentUser && w.currentUser.ftp) || w.userFTP || w.mobileUserFTP) || 200;
  }
  var labelsKey = '';
  /** 바깥 눈금값 + 안쪽 파란 속도값 — 현재값(파워/속도)에 따라 구성이 바뀜 */
  function renderLabels() {
    var ftp = ftpNow(), key = S.metric + '|' + ftp;
    if (key === labelsKey) return; labelsKey = key;
    var outer = $('rrm-gauge-labels'), inner = $('rrm-gauge-speed-labels'), h = '', i;
    if (outer) {
      if (S.metric === 'power') {           // 개인훈련 모바일 화면과 동일: FTP 배수 파워값(FTP 는 빨강, 0 은 '0 w')
        var mults = [0, 0.33, 0.67, 1, 1.33, 1.67, 2];
        for (i = 0; i < mults.length; i++) {
          var a = (180 + (i / 6) * 180) % 360, rad = a * Math.PI / 180, val = Math.round(ftp * mults[i]);
          h += '<text x="' + (100 + 98 * Math.cos(rad)).toFixed(2) + '" y="' + (140 + 98 * Math.sin(rad)).toFixed(2) + '" text-anchor="middle" dominant-baseline="middle" fill="' + (i === 3 ? '#ef4444' : '#ffffff') + '" font-size="10" font-weight="600">' + (val === 0 ? '0 w' : val) + '</text>';
        }
      } else {                              // 속도 선택: 눈금값을 속도(0~120 km/h)로
        for (i = 0; i <= 6; i++) {
          var a2 = (180 + (i / 6) * 180) % 360, r2 = a2 * Math.PI / 180, v = i * 20;
          h += '<text x="' + (100 + 98 * Math.cos(r2)).toFixed(2) + '" y="' + (140 + 98 * Math.sin(r2)).toFixed(2) + '" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="10" font-weight="600">' + v + '</text>';
        }
      }
      outer.innerHTML = h;
    }
    if (inner) {                            // 원호 안쪽 파란 속도값: 파워 모드에서만(원본과 동일, 0 km/h 는 3시)
      var l = '';
      if (S.metric === 'power') for (i = 0; i <= 6; i++) {
        var a3 = (360 - (i / 6) * 180) * Math.PI / 180;
        l += '<text x="' + (100 + 60 * Math.cos(a3)).toFixed(2) + '" y="' + (140 + 60 * Math.sin(a3)).toFixed(2) + '" text-anchor="middle" dominant-baseline="middle" fill="#4595e6" font-size="6">' + (i === 0 ? '0 km/h' : i * 20) + '</text>';
      }
      inner.innerHTML = l;
    }
    var sh = S.metric === 'power' ? '' : 'none';
    ['rrm-gauge-speed-arc', 'rrm-gauge-speed-dot', 'rrm-gauge-speed-dot-value'].forEach(function (id) { var e = $(id); if (e) e.style.display = sh; });
  }
  function buildGauge() {
    var ticks = $('rrm-gauge-ticks');
    if (ticks && !ticks.__built) {
      var h = '';
      for (var i = 0; i <= 24; i++) {
        var major = i % 4 === 0, ang = 180 + (i / 24) * 180; if (ang >= 360) ang = ang % 360;
        var rad = ang * Math.PI / 180, ir = 70, tl = major ? 14 : 7;
        h += '<line x1="' + (100 + ir * Math.cos(rad)).toFixed(2) + '" y1="' + (140 + ir * Math.sin(rad)).toFixed(2) + '" x2="' + (100 + (ir + tl) * Math.cos(rad)).toFixed(2) + '" y2="' + (140 + (ir + tl) * Math.sin(rad)).toFixed(2) + '" stroke="#ffffff" stroke-width="' + (major ? 2.5 : 1.5) + '"/>';
      }
      ticks.innerHTML = h; ticks.__built = true;
    }
    labelsKey = ''; renderLabels();
  }

  /* ---------------- 소수점 이하 글자(정수 가운데 정렬 + 30% 크기) ---------------- */
  function setSplitDist(km) {
    var s = Math.max(0, km).toFixed(2), dot = s.indexOf('.');
    var ip = s.slice(0, dot), dp = s.slice(dot);
    var ie = $('rrm-ui-target-power'), de = $('rrm-ui-target-dec'); if (!ie || !de) return;
    var changed = false;
    if (ie.textContent !== ip) { ie.textContent = ip; changed = true; }
    if (de.textContent !== dp) { de.textContent = dp; changed = true; }
    if (changed || !de.__placed) {
      var wc = ie.__wc || (ie.__wc = {}), wd = wc[ip] || 0;
      if (!wd) { try { wd = ie.getComputedTextLength(); } catch (e) {} if (wd > 0) wc[ip] = wd; }
      if (wd > 0) { de.setAttribute('x', (100 + wd / 2 + 1).toFixed(2)); de.__placed = true; }
    }
  }

  /* ---------------- 프레임 루프: 샘플링 + 표시(3초 평균·스프링) ---------------- */
  function tick(tn, force) {
    var SG = w.StelvioGaugeSpring;
    // 정지 판정: 새 휠 이벤트가 3초 이상(저속은 간격의 3배, 최대 5초) 없으면 정지
    if (S.lastEvAt && !S.stopped) {
      var thr = Math.min(STOP_MAX_MS, Math.max(STOP_MIN_MS, 3 * (S.evInterval || 0)));
      if (tn - S.lastEvAt >= thr) { S.stopped = true; S.rawKmh = 0; }
    }
    var raw = S.stopped ? 0 : S.rawKmh;
    if (S.status === 'running') {
      var dt = Math.min(0.5, Math.max(0, (tn - S.lastTick) / 1000));
      S.elapsed = (tn - S.startPerf) / 1000;
      if (S.speedOnly) S.dist += raw * dt / 3600;                // 회전수 없는 경로는 속도 적분
      if (raw > S.maxKmh) S.maxKmh = raw;
      var p = Number(w.liveData && w.liveData.power) || 0;
      if (p > 0) { S.powSum += p * dt; S.powN += dt; }
      if (tn - S.lastHistAt >= 1000 || force) {
        S.lastHistAt = tn;
        S.hist.push([S.mode === 'time' ? S.elapsed : S.dist, S.elapsed > 0 ? S.dist / (S.elapsed / 3600) : 0]);
        if (S.hist.length > 4000) S.hist.splice(0, S.hist.length - 4000);
      }
      if (!force) {
        var tv = targetValue();
        if ((S.mode === 'time' && S.elapsed >= tv) || (S.mode === 'distance' && S.dist >= tv)) {
          if (S.mode === 'time') S.elapsed = tv;
          S.lastTick = tn; finishRace(true); return;
        }
      }
    }
    S.lastTick = tn;
    // 표시 값
    var disp = { speed: raw, power: 0 };
    if (SG && SG.avgHold && SG.step) {
      if (!S.gs) S.gs = SG.create(0);
      var tgt, opt;
      if (S.stopped) {                                           // 정지 확정: 평균을 건너뛰고 빠르게 0
        if (!S.stopApplied) { S.stopApplied = true; S.buf.length = 0; S.buf.push({ t: tn, p: 0 }); }
        tgt = 0; opt = { omega: 16, omegaZero: 16, eps: 0.3, minRate: 50, k: 8, maxRate: 300 };
      } else {
        if (S.stopApplied) { S.stopApplied = false; S.buf.length = 0; }
        tgt = SG.avgHold(S.buf, raw, tn, 3000, false);
        opt = { omega: 6, omegaZero: 9, eps: 0.05, minRate: 7, k: 3.5, maxRate: 45 };
      }
      SG.step(S.gs, tgt, tn, opt);
      S.needle = S.gs.x; S.speedNum = S.gs.n;
      // Zone 띠 강조용 현재 파워(3초 평균, 두 모드 공통): 파워미터가 연결됐을 때만 계산(속도 모드에서도 파워 존 표시)
      if (w.connectedDevices && w.connectedDevices.powerMeter) {
        var zp = Number(w.liveData && w.liveData.power); if (!isFinite(zp) || zp < 0) zp = 0;
        S.zonePower = SG.avgHold(S.zbuf, zp, tn, 3000, true);
      } else { S.zonePower = 0; if (S.zbuf.length) S.zbuf.length = 0; }
      // 파워(선택했을 때만 계산): 전용 버퍼 3초 시간가중 평균(순간 0 제외) + 정수 카운트 — 공용 평균 함수를 매 프레임 부르지 않음(발열·다른 화면 버퍼 오염 방지)
      if (S.metric === 'power') {
        var pw = Number(w.liveData && w.liveData.power); if (!isFinite(pw) || pw < 0) pw = 0;
        if (!S.gp) S.gp = SG.create(0);
        SG.step(S.gp, SG.avgHold(S.pbuf, pw, tn, 3000, true), tn, { omega: 8, omegaZero: 10, eps: 0.3, minRate: 25, k: 4, maxRate: 300 });
        S.powNum = S.gp.n; S.powNeedle = S.gp.x;
      }
    } else { S.needle = raw; S.speedNum = raw; S.powNum = Number(w.liveData && w.liveData.power) || 0; S.powNeedle = S.powNum; }
  }

  function render(force) {
    if (!S.active && !force) return;
    var txt;
    // 헤더 타이머: 경과 시간
    var tm = $('rrm-main-timer'); if (tm) { txt = fmtHMS(S.elapsed); if (tm.textContent !== txt) tm.textContent = txt; }
    // 모드별 눈금(파워/속도)과 파란 속도 요소 표시 여부
    renderLabels();
    // 바늘: 파워 모드 = 파워(FTP×2 스케일, 개인훈련 모바일 화면과 동일), 속도 모드 = 속도(0~120 km/h)
    var needle = $('rrm-gauge-needle'), spd = Math.max(0, S.needle || 0);
    var ratio = S.metric === 'power'
      ? Math.min(Math.max((S.powNeedle || 0) / (ftpNow() * 2), 0), 1)
      : Math.min(Math.max(spd / GAUGE_MAX, 0), 1);
    if (needle) needle.setAttribute('transform', 'translate(100, 140) rotate(' + (-90 + ratio * 180).toFixed(2) + ')');
    // Zone 띠: 속도 모드에서도 현재 파워 존이 강조되도록 갱신(바늘이 안 움직여도)
    var gz = $('rrmGaugeSvg'); if (gz && typeof gz.__stelvioZoneUpdate === 'function') gz.__stelvioZoneUpdate();
    // LAP AVG ▼ 표시는 눈금 종류와 값이 맞을 때만(속도 눈금+SPEED AVG / 파워 눈금+LAP AVG 파워)
    var scr = $(SCREEN_ID), lapOk = (S.metric === 'speed' && S.lap === 'avg') || (S.metric === 'power' && S.lap === 'power') ? '1' : '0';
    if (scr && scr.getAttribute('data-rrm-lapmatch') !== lapOk) scr.setAttribute('data-rrm-lapmatch', lapOk);
    if (S.metric === 'power') {                                // 원호 안쪽 파란 속도: 오른쪽(0)에서 왼쪽으로 채움 + 끝점 점과 속도값
      var sr = Math.min(Math.max(spd / GAUGE_MAX, 0), 1), arc = $('rrm-gauge-speed-arc');
      if (arc) arc.style.strokeDashoffset = (251.33 * (1 - sr)).toFixed(2);
      var dot = $('rrm-gauge-speed-dot'), dv = $('rrm-gauge-speed-dot-value');
      if (dot && dv) {
        var rad = (360 - sr * 180) * Math.PI / 180, cx = (100 + 80 * Math.cos(rad)).toFixed(2), cy = (140 + 80 * Math.sin(rad)).toFixed(2);
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dv.setAttribute('x', cx); dv.setAttribute('y', cy);
        txt = String(Math.round(spd)); if (dv.textContent !== txt) dv.textContent = txt;
      }
    }
    // 중앙 큰 숫자(정수만) + 단위
    var cur = $('rrm-ui-current-power'), unit = $('rrm-ui-unit');
    if (cur) {
      txt = S.metric === 'power' ? ((w.connectedDevices && w.connectedDevices.powerMeter) ? String(Math.round(S.powNum || 0)) : '--') : String(Math.round(Math.max(0, S.speedNum || 0)));
      if (cur.textContent !== txt) cur.textContent = txt;
    }
    if (unit) { var u = S.metric === 'power' ? 'WATTS' : 'km/h'; if (unit.textContent !== u) { unit.textContent = u; placeCaret(); } }
    // TARGET 자리: 누적 거리
    setSplitDist(S.dist);
    // 하단 정보: 개인훈련 모바일 화면과 같은 구성 — CADENCE(rpm) · LAP AVG(▾ 선택) · HEART RATE(bpm)
    var ld = w.liveData || {};
    var cad = $('rrm-ui-cadence'); if (cad) { txt = String(Math.round(Number(ld.cadence) || 0)); if (cad.textContent !== txt) cad.textContent = txt; }
    var hr = $('rrm-ui-hr'); if (hr) { txt = String(Math.round(Number(ld.heartRate) || 0)); if (hr.textContent !== txt) hr.textContent = txt; }
    var avg = S.elapsed > 0 ? S.dist / (S.elapsed / 3600) : 0;
    var lap = $('rrm-ui-lap-power'), lu = $('rrm-ui-lap-unit'), lt = $('rrmLapSelText');
    if (lap) {
      txt = S.lap === 'avg' ? String(Math.round(avg)) : String(S.powN > 0 ? Math.round(S.powSum / S.powN) : 0);   // SPEED AVG: 평균 속도(km/h) / LAP AVG: 레이스 시작 후 평균 파워(w)
      if (lap.textContent !== txt) lap.textContent = txt;
    }
    if (lu) { txt = S.lap === 'avg' ? 'km/h' : 'w'; if (lu.textContent !== txt) lu.textContent = txt; }
    if (lt) { txt = S.lap === 'avg' ? 'SPEED AVG' : 'LAP AVG'; if (lt.textContent !== txt) lt.textContent = txt; }
    var tv = targetValue();
    // 진행율 바
    var pct = tv > 0 ? Math.min(1, (S.mode === 'time' ? S.elapsed / tv : S.dist / tv)) : 0;
    var fill = $('rrmProgFill'), th = $('rrmProgThumb'), pp = $('rrmProgPct');
    if (fill) fill.style.width = (pct * 100).toFixed(2) + '%'; if (th) th.style.left = (pct * 100).toFixed(2) + '%';
    if (pp) { txt = Math.floor(pct * 100) + '%'; if (pp.textContent !== txt) pp.textContent = txt; }
    var pmax = $('rrmProgMax'); if (pmax) { txt = S.mode === 'time' ? fmtMS(tv) : tv.toFixed(1) + 'km'; if (pmax.textContent !== txt) pmax.textContent = txt; }
    var pl = $('rrmProgLabel');
    if (pl) {
      var left = S.mode === 'time' ? fmtMS(Math.max(0, tv - S.elapsed)) + ' left' : Math.max(0, tv - S.dist).toFixed(2) + 'km left';
      txt = 'RACE PROGRESS · ' + left; if (pl.textContent !== txt) pl.textContent = txt;
    }
    var names = [];
    if (w.connectedDevices) { if (w.connectedDevices.speed) names.push('속도계'); if (w.connectedDevices.powerMeter) names.push('파워'); if (w.connectedDevices.heartRate) names.push('심박'); if (w.connectedDevices.trainer) names.push('트레이너'); }
    var web = names.length > 0, appOn = S.lastPacketAt && nowMs() - S.lastPacketAt < 8000;
    var sst = $('rrmSensorStatus'); if (sst) { txt = web ? names.join('·') + ' 연결됨' : (appOn ? '속도계 연결됨' : '미연결'); if (sst.textContent !== txt) { sst.textContent = txt; sst.style.color = (web || appOn) ? '#00d4aa' : '#888'; } }
    var cbn = $('rrmConnectBtn'); if (cbn) cbn.classList.toggle('has-connection', web || !!appOn);
    var sum = $('rrmSettingsSummary'); if (sum) { txt = S.mode === 'time' ? '시간 ' + S.targetMin + '분' : '거리 ' + S.targetKm + 'km'; if (sum.textContent !== txt) sum.textContent = txt; }
    // 그래프(1초마다)
    var tn = nowMs();
    if (force || tn - (S.lastGraphAt || 0) >= 1000) { S.lastGraphAt = tn; drawGraph(); }
  }
  function placeCaret() {
    var u = $('rrm-ui-unit'), c = $('rrm-unit-caret'); if (!u || !c) return;
    try { var wd = u.getComputedTextLength(); if (wd > 0) c.setAttribute('transform', 'translate(' + (100 + wd / 2 + 4).toFixed(1) + ',156.2)'); } catch (e) {}
  }

  /* ---------------- 그래프: X = 목표 시간/거리, Y = 평균 속도 ---------------- */
  function drawGraph() {
    var cv = $('rrmRaceGraph'); if (!cv) return;
    var box = cv.parentElement, W = Math.max(280, Math.min(600, box.clientWidth || 360)), H = Math.max(100, Math.min(400, box.clientHeight || 120));
    var dpr = Math.min(3, Math.max(1, w.devicePixelRatio || 1));
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr); if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    cv.style.width = '100%'; cv.style.maxWidth = '100%';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var FF = '"Barlow Semi Condensed","Noto Sans KR",sans-serif';
    var P = { top: Math.max(16, Math.floor(H * .13)), right: 14, bottom: Math.max(20, Math.floor(H * .16)), left: 34 };
    var cw = W - P.left - P.right, ch = H - P.top - P.bottom, tv = targetValue();
    ctx.clearRect(0, 0, W, H);
    var maxAvg = 10, i;
    for (i = 0; i < S.hist.length; i++) if (S.hist[i][1] > maxAvg) maxAvg = S.hist[i][1];
    var yMax = Math.max(10, Math.ceil(maxAvg * 1.25 / 5) * 5);
    var yOf = function (v) { return P.top + ch - ch * (v / yMax); };
    var xOf = function (v) { return P.left + cw * Math.min(1, Math.max(0, v / tv)); };
    // 격자 + Y 라벨
    ctx.font = 'bold 9px ' + FF; ctx.fillStyle = '#7f90b0'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (i = 0; i <= 4; i++) {
      var gv = yMax * i / 4, gy = yOf(gv);
      ctx.strokeStyle = 'rgba(143,160,192,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P.left, gy); ctx.lineTo(P.left + cw, gy); ctx.stroke();
      ctx.fillText(String(Math.round(gv)), P.left - 4, gy);
    }
    // X 눈금(0 / 25 / 50 / 75 / 100 %)
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#9fb0cc'; ctx.font = 'bold 9px ' + FF;
    for (i = 0; i <= 4; i++) {
      var xv = tv * i / 4, gx = P.left + cw * i / 4;
      ctx.strokeStyle = 'rgba(143,160,192,0.10)'; ctx.beginPath(); ctx.moveTo(gx, P.top); ctx.lineTo(gx, P.top + ch); ctx.stroke();
      ctx.fillText(S.mode === 'time' ? fmtMS(xv) : (xv >= 10 ? xv.toFixed(0) : xv.toFixed(tv < 4 ? 2 : 1)) + 'km', gx, H - 4);
    }
    // 축
    ctx.strokeStyle = 'rgba(143,160,192,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P.left, P.top); ctx.lineTo(P.left, P.top + ch); ctx.lineTo(P.left + cw, P.top + ch); ctx.stroke();
    ctx.fillStyle = '#7f90b0'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 9px ' + FF; ctx.fillText('km/h', 3, 10);
    // 평균 속도 곡선
    if (S.hist.length > 1) {
      ctx.beginPath(); ctx.moveTo(xOf(S.hist[0][0]), yOf(S.hist[0][1]));
      for (i = 1; i < S.hist.length; i++) ctx.lineTo(xOf(S.hist[i][0]), yOf(S.hist[i][1]));
      var lx = xOf(S.hist[S.hist.length - 1][0]);
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.lineTo(lx, P.top + ch); ctx.lineTo(xOf(S.hist[0][0]), P.top + ch); ctx.closePath();
      var gr = ctx.createLinearGradient(0, P.top, 0, P.top + ch); gr.addColorStop(0, 'rgba(34,211,238,0.32)'); gr.addColorStop(1, 'rgba(34,211,238,0.02)');
      ctx.fillStyle = gr; ctx.fill();
      var ly = yOf(S.hist[S.hist.length - 1][1]);
      ctx.fillStyle = '#ff8c00'; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(255,140,0,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, P.top); ctx.lineTo(lx, P.top + ch); ctx.stroke();
    }
  }

  /* ---------------- 루프 구동 ---------------- */
  var fbTimer = null, lastFrame = 0;
  function idleSettled() {
    if (S.status === 'running' || S.status === 'countdown') return false;
    var g = S.gs;
    if (S.metric === 'power' && w.connectedDevices && w.connectedDevices.powerMeter && Number(w.liveData && w.liveData.power) > 0) return false;   // 파워 모드에서 파워가 들어오는 동안은 부드러운 바늘을 위해 프레임 루프 유지
    return S.stopped && (!g || (Math.abs(g.x) < 0.05 && Math.abs(g.n) < 0.05 && Math.abs(g.v) < 0.2)) && !(S.gp && S.metric === 'power' && S.gp.n > 0.05);
  }
  function frame() {
    S.rafId = null;
    if (!S.active) return;
    lastFrame = Date.now();
    var tn = nowMs();
    tick(tn, false); render(false);
    if (!S.active) return;
    if (idleSettled()) {                                          // 레이스 중이 아니고 값이 0 으로 안정: 프레임 루프 대신 4Hz 확인(발열 방지)
      if (!S.idleT) S.idleT = setTimeout(function () { S.idleT = null; if (S.active && S.rafId == null) { if (idleSettled()) { tick(nowMs(), false); render(false); frame2(); } else kick(); } }, 250);
      return;
    }
    S.rafId = requestAnimationFrame(frame);
  }
  function frame2() { if (S.active && idleSettled() && !S.idleT) S.idleT = setTimeout(function () { S.idleT = null; if (S.active && S.rafId == null) frame(); }, 250); else if (S.active && !idleSettled()) kick(); }
  function kick() {
    if (!S.active) return;
    if (S.idleT) { clearTimeout(S.idleT); S.idleT = null; }
    if (S.rafId == null) S.rafId = requestAnimationFrame(frame);
    // 안드로이드 WebView 가 프레임 신호를 늦게 줄 때(70ms 넘게 비면) 타이머가 대신 진행
    if (!fbTimer) fbTimer = setInterval(function () {
      if (!S.active) { clearInterval(fbTimer); fbTimer = null; return; }
      if (S.rafId == null) { clearInterval(fbTimer); fbTimer = null; return; }   // 루프가 의도적으로 멈춘 상태(대기): 타이머도 해제(깨울 때 kick 이 다시 만든다)
      if (Date.now() - lastFrame < 70 && !document.hidden) return;
      if (document.hidden && S.status !== 'running') return;
      lastFrame = Date.now(); tick(nowMs(), false); render(false);
    }, 33);
  }
  function activate() {
    if (S.active) return;
    S.active = true; loadSettingsOnce(); buildGauge();
    var nm = $('rrm-dashboard-user-name'); if (nm) nm.textContent = (w.currentUser && (w.currentUser.name || w.currentUser.userName)) || nm.textContent;
    if (S.status === 'done') resetRace();                       // 이전 레이스 결과 화면은 초기화하고 새로 시작
    var gsvg = $('rrmGaugeSvg');
    if (gsvg) gsvg.__stelvioZoneRatio = function () { return S.metric === 'speed' ? (S.zonePower || 0) / ftpNow() : null; };  // 속도 모드: 현재 파워 존 / 파워 모드: 바늘(=파워) 기준(기본 동작)
    bindWebSensor(); retryUnsavedRecord();
    w.addEventListener('speedUpdate', onSpeedUpdate); w.addEventListener('speedData', onSpeedData);
    S.bindT = setInterval(bindWebSensor, 2000);
    render(true); placeCaret(); kick();
    setTimeout(function () { placeCaret(); render(true); }, 300);
  }
  function deactivate() {
    if (!S.active) return;
    S.active = false;
    w.removeEventListener('speedUpdate', onSpeedUpdate); w.removeEventListener('speedData', onSpeedData);
    if (S.bindT) { clearInterval(S.bindT); S.bindT = null; }
    if (S.rafId != null) { try { cancelAnimationFrame(S.rafId); } catch (e) {} S.rafId = null; }
    if (fbTimer) { clearInterval(fbTimer); fbTimer = null; }
    if (cdTimer) { clearInterval(cdTimer); cdTimer = null; var ov = $('rrmCountdown'); if (ov) ov.classList.add('hidden'); }
    // 다른 경로(뒤로가기·하단 메뉴 등)로 화면을 떠나도 진행 중 레이스를 정리: 안 그러면 START 가 잠긴 채 남고 시간만 흘러간다
    if (S.status === 'running' || S.status === 'countdown') resetRace();
    if (S.idleT) { clearTimeout(S.idleT); S.idleT = null; }
    closeMenus();
  }
  var settingsLoaded = false;
  function loadSettingsOnce() { if (!settingsLoaded) { loadSettings(); settingsLoaded = true; } }

  // 화면 활성화 감지(class active) — showScreen 래퍼 순서와 무관하게 동작
  function watch() {
    var el = $(SCREEN_ID);
    if (!el) { setTimeout(watch, 500); return; }
    var apply = function () { var on = el.classList.contains('active'); if (on) activate(); else deactivate(); };
    new MutationObserver(apply).observe(el, { attributes: true, attributeFilter: ['class'] });
    apply();
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && (t.closest('.rrm-menu') || t.closest('#rrmConnectMenu') || t.closest('#rrmConnectBtn') || t.closest('#rrmLapSelBtn'))) return;
    closeMenus();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  /* ---------------- 공개 ---------------- */
  w.rrmStart = rrmStart; w.rrmStop = rrmStop; w.rrmExit = rrmExit; w.rrmToggleConnectMenu = rrmToggleConnectMenu; w.rrmOpenSensor = rrmOpenSensor;
  w.rrmToggleMetricMenu = rrmToggleMetricMenu; w.rrmSetMetric = rrmSetMetric;
  w.rrmToggleLapMenu = rrmToggleLapMenu; w.rrmSetLap = rrmSetLap;
  w.rrmOpenSettings = rrmOpenSettings; w.rrmCloseSettings = rrmCloseSettings; w.rrmPickMode = rrmPickMode; w.rrmSaveSettings = rrmSaveSettings;
  w.rrmCloseResult = rrmCloseResult; w.rrmRetrySave = rrmRetrySave;
  w.__rrm = { S: S, onCscView: onCscView, tick: tick, render: render, finishRace: finishRace, beginRace: beginRace, resetRace: resetRace, targetValue: targetValue };
})(window);
