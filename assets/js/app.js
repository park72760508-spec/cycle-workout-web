/* ===============================================
 * app.js
 * - 화면 전환 / 사용자·워크아웃 로드 (GAS)
 * - 훈련 실행 / 실시간 UI 업데이트 / 기록 및 결과
 * - bluetooth.js 와 전역 상태 공유
 * =============================================== */

// ====== 설정(GAS 웹 앱 URL 교체 필요) =========================
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec';

// ====== 전역 상태 =============================================
let currentScreen = 'connectionScreen';
let countdownActive = false;
let segmentCountdownStarted = false;

let currentUser = null;
let currentWorkout = null;

window.trainingSession = {
  sessionId: null,
  isRunning: false,
  isPaused: false,
  startTime: null,
  currentSegment: 0,
  segments: [],
  segmentStartTime: null,
  data: { power: [], cadence: [], heartRate: [], time: [] }
};

// ====== 유틸 UI ===============================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  currentScreen = id;

  if (id === 'profileScreen') loadUsers();
  else if (id === 'workoutScreen') loadWorkouts();
  else if (id === 'trainingReadyScreen') showWorkoutPreview();
}

function showConnectionStatus(show) {
  const el = document.getElementById('connectionStatus');
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

function updateDevicesList() {
  const deviceList = document.getElementById('deviceList');
  const summary = document.getElementById('connectedDevicesSummary');
  const summaryList = document.getElementById('connectedDevicesList');

  let connectedCount = 0;
  let html = '';

  if (connectedDevices.trainer) {
    connectedCount++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">🚴‍♂️</div>
          <div class="device-details">
            <h3>${connectedDevices.trainer.name}</h3>
            <p>Smart Trainer</p>
          </div>
        </div>
        <div style="color: var(--success-color); font-weight: 600;">연결됨</div>
      </div>`;
  }

  if (connectedDevices.powerMeter) {
    connectedCount++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">⚡</div>
          <div class="device-details">
            <h3>${connectedDevices.powerMeter.name}</h3>
            <p>Crank Power Meter (BLE)</p>
          </div>
        </div>
        <div style="color: var(--success-color); font-weight: 600;">연결됨</div>
      </div>`;
  }

  if (connectedDevices.heartRate) {
    connectedCount++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon" style="background: var(--danger-color);">❤️</div>
          <div class="device-details">
            <h3>${connectedDevices.heartRate.name}</h3>
            <p>Heart Rate Monitor</p>
          </div>
        </div>
        <div style="color: var(--success-color); font-weight: 600;">연결됨</div>
      </div>`;
  }

  if (deviceList) deviceList.innerHTML = html;
  if (connectedCount > 0 && summary && summaryList) {
    summaryList.innerHTML = html;
    summary.classList.remove('hidden');
  } else {
    summary?.classList.add('hidden');
  }
}

function proceedToProfile() {
  if (!connectedDevices.trainer && !connectedDevices.powerMeter) {
    alert('훈련을 위해서는 스마트 트레이너 또는 파워메터가 필요합니다.');
  }
  showScreen('profileScreen');
}

// ====== 사용자 / 워크아웃 로딩 ================================
async function loadUsers() {
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getUsers' })
    });
    const users = await res.json();
    displayUsers(users);
  } catch (e) {
    console.error('사용자 로드 실패:', e);
    const dummy = [
      { user_id: 'U1', name: '박지성', contact: '010-1234-5678', ftp: 242, weight: 56 },
      { user_id: 'U2', name: '박선호', contact: '010-9876-5432', ftp: 200, weight: 70 }
    ];
    displayUsers(dummy);
  }
}

function displayUsers(users) {
  const list = document.getElementById('profileList');
  if (!list) return;
  list.innerHTML = '';

  users.forEach(u => {
    const card = document.createElement('div');
    card.className = 'card profile-card';
    card.onclick = () => selectUser(u);
    const initials = u.name.substring(0, 2);
    const wkg = (u.ftp / u.weight).toFixed(1);

    card.innerHTML = `
      <div class="profile-info">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-details">
          <h3>${u.name}</h3>
          <div class="profile-stats">
            <div><div class="stat-value">${u.ftp}W</div><div class="stat-label">FTP</div></div>
            <div><div class="stat-value">${u.weight}kg</div><div class="stat-label">몸무게</div></div>
            <div><div class="stat-value">${wkg}</div><div class="stat-label">W/kg</div></div>
          </div>
        </div>
      </div>`;
    list.appendChild(card);
  });
}

function selectUser(user) {
  currentUser = user;
  alert(`${user.name}님, 환영합니다!`);
  showScreen('workoutScreen');
}

function showAddUserForm() {
  document.getElementById('addUserForm')?.classList.remove('hidden');
}
function cancelAddUser() {
  document.getElementById('addUserForm')?.classList.add('hidden');
  ['userName','userContact','userFTP','userWeight'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}
async function saveNewUser() {
  const name = document.getElementById('userName').value.trim();
  const contact = document.getElementById('userContact').value.trim();
  const ftp = parseInt(document.getElementById('userFTP').value, 10);
  const weight = parseInt(document.getElementById('userWeight').value, 10);

  if (!name || !contact || !ftp || !weight) return alert('모든 필드를 입력해주세요.');
  if (ftp < 100 || ftp > 500) return alert('FTP는 100~500W 범위로 입력해주세요.');
  if (weight < 40 || weight > 150) return alert('몸무게는 40~150kg 범위로 입력해주세요.');

  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addUser', userData: { name, contact, ftp, weight } })
    });
    const result = await res.json();
    if (result.success) {
      alert('새 사용자가 추가되었습니다!');
      cancelAddUser();
      loadUsers();
    } else {
      alert('사용자 추가 실패: ' + result.error);
    }
  } catch (e) {
    console.error('사용자 추가 오류:', e);
    alert('사용자 추가 중 오류가 발생했습니다.');
  }
}

async function loadWorkouts() {
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getWorkouts' })
    });
    const workouts = await res.json();
    displayWorkouts(workouts);
  } catch (e) {
    console.error('워크아웃 로드 실패:', e);
    const dummy = [{
      workout_id: 'SST_MCT14',
      workout_name: 'SST_MCT(14)',
      total_duration: 5520,
      avg_intensity: 78,
      segments: [
        { segment_order: 1, segment_type: '웜업', description: '80RPM FTP 60%', ftp_percent: 60, duration_sec: 20, target_rpm: 80 },
        { segment_order: 2, segment_type: '인터벌', description: 'FTP 88%',   ftp_percent: 88, duration_sec: 30, target_rpm: 90 },
        { segment_order: 3, segment_type: '휴식',  description: 'FTP 50%',   ftp_percent: 50, duration_sec: 10, target_rpm: 75 },
        { segment_order: 4, segment_type: '인터벌', description: 'FTP 92%',   ftp_percent: 92, duration_sec: 60, target_rpm: 90 },
        { segment_order: 5, segment_type: '쿨다운', description: 'FTP 45%',   ftp_percent: 45, duration_sec: 10, target_rpm: 70 },
      ],
    }];
    displayWorkouts(dummy);
  }
}

function displayWorkouts(workouts) {
  const list = document.getElementById('workoutList');
  if (!list) return;
  list.innerHTML = '';
  workouts.forEach(w => {
    const card = document.createElement('div');
    card.className = 'card workout-card';
    card.onclick = () => selectWorkout(w);
    const durationMin = Math.floor((w.total_duration || 0) / 60);
    const tss = calculateWorkoutTSS(w);
    card.innerHTML = `
      <div class="workout-header">
        <div class="workout-title">${w.workout_name}</div>
        <div class="workout-duration">${durationMin}분</div>
      </div>
      <div style="margin: 15px 0;">
        <div style="font-size: 14px; color: var(--gray-color);">
          평균: ${w.avg_intensity}% FTP | TSS: ${tss}
        </div>
      </div>`;
    list.appendChild(card);
  });
}

function calculateWorkoutTSS(workout) {
  let totalTSS = 0;
  (workout.segments || []).forEach(s => {
    const IF = (s.ftp_percent || 0) / 100;
    const h = (s.duration_sec || 0) / 3600;
    totalTSS += h * IF * IF * 100;
  });
  return Math.round(totalTSS);
}

function selectWorkout(w) {
  currentWorkout = w;
  showScreen('trainingReadyScreen');
}

function showWorkoutPreview() {
  if (!currentWorkout || !currentUser) return;
  document.getElementById('previewWorkoutName').textContent = currentWorkout.workout_name;
  document.getElementById('previewDuration').textContent = Math.floor(currentWorkout.total_duration / 60) + '분';
  document.getElementById('previewIntensity').textContent = currentWorkout.avg_intensity + '%';
  document.getElementById('previewTSS').textContent = calculateWorkoutTSS(currentWorkout);

  const wrap = document.getElementById('segmentPreview');
  wrap.innerHTML = '';
  currentWorkout.segments.forEach(s => {
    const dMin = Math.floor((s.duration_sec || 0) / 60);
    const div = document.createElement('div');
    const klass = (s.segment_type || '').toLowerCase();
    div.className = `segment-item ${klass}`;
    div.innerHTML = `
      <h4>${s.segment_type}</h4>
      <div class="ftp-percent">${s.ftp_percent}%</div>
      <div class="duration">${dMin}분</div>`;
    wrap.appendChild(div);
  });
}

// ====== 훈련 실행 ===============================================
function startWorkoutTraining() {
  showScreen('trainingScreen');
  initializeTraining();
}

function backToWorkoutSelection() {
  showScreen('workoutScreen');
}

function showUserInfo() {
  if (!currentUser) return;
  const wkg = (currentUser.ftp / currentUser.weight).toFixed(1);
  const el = document.getElementById('userInfo');
  let bg;
  if (wkg >= 4) bg = '#ff3333';
  else if (wkg >= 3.5) bg = '#ff6600';
  else if (wkg >= 3) bg = '#1a5ab8';
  else if (wkg >= 2.2) bg = '#7ED321';
  else bg = '#FFD700';
  el.innerHTML = `<strong>${currentUser.name}</strong> | FTP: ${currentUser.ftp}W | ${wkg} W/kg`;
  Object.assign(el.style, { background: bg, padding: '6px 10px', borderRadius: '8px', color: '#fff' });
}

function initializeTraining() {
  if (!currentWorkout || !currentUser) return;

  showUserInfo();
  countdownActive = false;
  segmentCountdownStarted = false;

  window.trainingSession = {
    sessionId: 'S' + Date.now(),
    isRunning: false,
    isPaused: false,
    startTime: null,
    currentSegment: 0,
    segments: currentWorkout.segments,
    segmentStartTime: null,
    data: { power: [], cadence: [], heartRate: [], time: [] }
  };

  updateTrainingDisplay();
  createTimeline();
  updateSegmentDisplay();

  showCountdown(5, startTraining);
}

let audioCtx = null;
let beepActive = false;
function playBeep() {
  if (beepActive) return;
  beepActive = true;
  try {
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 950;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => (beepActive = false);
  } catch {
    beepActive = false;
  }
}

function showCountdown(sec, callback, message = '훈련 시작 준비!', isFirst = true) {
  if (isFirst && countdownActive) return;
  if (isFirst) countdownActive = true;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  }

  const overlay = document.getElementById('countdownOverlay');
  const number = document.getElementById('countdownNumber');
  let msg = document.getElementById('countdownMessage');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'countdownMessage';
    Object.assign(msg.style, {
      position: 'absolute', top: '20%', width: '100%', textAlign: 'center',
      color: 'white', fontSize: '36px', opacity: '0', transition: 'opacity 0.5s ease-in-out'
    });
    overlay.appendChild(msg);
  }
  msg.textContent = message;
  msg.style.opacity = '1';
  overlay.classList.remove('hidden');
  number.textContent = sec;
  playBeep();

  if (sec > 0) {
    setTimeout(() => {
      number.textContent = sec - 1;
      if (sec > 1) playBeep();
      showCountdown(sec - 1, callback, message, false);
    }, 1000);
  } else {
    msg.style.opacity = '0';
    setTimeout(() => {
      overlay.classList.add('hidden');
      countdownActive = false;
      callback();
    }, 300);
  }
}

function startTraining() {
  trainingSession.isRunning = true;
  trainingSession.startTime = Date.now();
  trainingSession.segmentStartTime = Date.now();
  segmentCountdownStarted = false;

  updateTrainingTimer();
  updateTargetPower();

  // 서버 알림(실패해도 진행)
  fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'startTrainingSessionAPI', sessionData: {
      user_id: currentUser.user_id, workout_id: currentWorkout.workout_id
    }})
  }).catch(()=>{});

  // 기기 없으면 시뮬레이션
  if (!connectedDevices.trainer && !connectedDevices.powerMeter) startDataSimulation();
}

function startDataSimulation() {
  const simTimer = setInterval(() => {
    if (!trainingSession.isRunning || trainingSession.isPaused) return;
    const seg = trainingSession.segments[trainingSession.currentSegment];
    if (!seg) { clearInterval(simTimer); return; }
    const target = Math.round(currentUser.ftp * (seg.ftp_percent / 100));
    const variation = (Math.random() - 0.5) * 30;
    liveData.power = Math.max(0, target + variation);
    liveData.cadence = seg.target_rpm + (Math.random() - 0.5) * 10;
    liveData.targetPower = target;
    updateTrainingDisplay();
    recordDataPoint();
  }, 1000);
}

function updateTargetPower() {
  if (!trainingSession.isRunning || trainingSession.isPaused) return;
  const seg = trainingSession.segments[trainingSession.currentSegment];
  if (seg && currentUser) {
    const target = Math.round(currentUser.ftp * (seg.ftp_percent / 100));
    liveData.targetPower = target;
    window.setTargetPower?.(target); // FTMS ERG 반영
  }
  const targetEl = document.getElementById('targetPowerValue');
  if (targetEl) targetEl.textContent = Math.round(liveData.targetPower);
  colorizeLapPower();
}

function updateTrainingDisplay() {
  const { power, cadence, heartRate, targetPower } = liveData;
  const p = Math.round(power || 0);
  const c = Math.round(cadence || 0);
  const h = Math.round(heartRate || 0);
  const t = Math.round(targetPower || 0);

  const ach = t > 0 ? Math.min(100, Math.round((p / t) * 100)) : 0;

  const id = s => document.getElementById(s);
  id('currentPowerValue').textContent = p;
  id('cadenceValue').textContent = c;
  id('heartRateValue').textContent = h;
  id('targetPowerValue').textContent = t;
  id('achievementValueBar').textContent = ach;

  const bar = id('powerProgressBar');
  if (bar) bar.style.width = `${Math.min(100, (p / (t || 1)) * 100)}%`;

  // 전체 평균 파워
  if (trainingSession.data.power.length) {
    const avg = trainingSession.data.power.reduce((a,b)=>a+b,0) / trainingSession.data.power.length;
    id('avgPowerValue').textContent = Math.round(avg);
  }

  // 현재 세그 평균
  const segStart = trainingSession.segmentStartTime;
  const now = Date.now();
  const segP = trainingSession.data.power.filter((_, i) => {
    const tt = trainingSession.data.time[i];
    return tt >= segStart && tt <= now;
  });
  const avgSeg = segP.length ? segP.reduce((a,b)=>a+b,0)/segP.length : 0;
  const avgSegEl = id('avgSegmentPowerValue');
  if (avgSegEl) {
    avgSegEl.textContent = Math.round(avgSeg);
    if (avgSeg < t * 0.9) avgSegEl.style.color = '#F56500';
    else if (avgSeg > t * 1.1) avgSegEl.style.color = '#7ED321';
    else avgSegEl.style.color = 'white';
  }

  // 세그 진행률%
  const seg = trainingSession.segments[trainingSession.currentSegment];
  let segPct = 0;
  if (seg && trainingSession.segmentStartTime) {
    const segElapsed = now - trainingSession.segmentStartTime;
    segPct = Math.min(100, Math.floor((segElapsed / (seg.duration_sec * 1000)) * 100));
  }
  const sp = id('segmentProgress');
  if (sp) sp.textContent = segPct;

  colorizeLapPower();
}

function colorizeLapPower() {
  let target = 0;
  if (Number(liveData.targetPower) > 0) target = Number(liveData.targetPower);
  else {
    const tEl = document.getElementById('targetPowerValue');
    if (tEl) target = Number(tEl.textContent.replace(/[^\d.-]/g, '')) || 0;
  }
  if (!target) return;

  ['avgSegmentPowerValue', 'avgPowerValue'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = Number(String(el.textContent).replace(/[^\d.-]/g, '')) || 0;
    if (!val) return;
    const pct = (val / target) * 100;
    el.classList.remove('lap-power--mint','lap-power--yellow','lap-power--white');
    if (pct >= 95) el.classList.add('lap-power--mint');
    else if (pct < 90) el.classList.add('lap-power--yellow');
    else el.classList.add('lap-power--white');
  });
}

function recordDataPoint() {
  trainingSession.data.power.push(liveData.power);
  trainingSession.data.cadence.push(liveData.cadence);
  trainingSession.data.heartRate.push(liveData.heartRate);
  trainingSession.data.time.push(Date.now());
}

function updateTrainingTimer() {
  const tick = setInterval(() => {
    if (!trainingSession.isRunning) { clearInterval(tick); return; }
    if (trainingSession.isPaused) return;

    const now = Date.now();
    const elapsed = now - trainingSession.startTime;
    const segElapsed = now - trainingSession.segmentStartTime;

    const mm = Math.floor(elapsed / 60000);
    const ss = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('elapsedTime').textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;

    // 전체 진행률
    const totalMs = getPlanTotalDurationMs();
    if (totalMs > 0) {
      const percent = Math.min(100, Math.floor((elapsed / totalMs) * 100));
      const ep = document.getElementById('elapsedPercent');
      if (ep) ep.textContent = percent;
    }

    // 세그먼트 남은시간
    updateSegmentTimer();

    // 세그 진행/전환
    checkSegmentProgress(segElapsed);

    // kcal/TSS
    updateCaloriesAndTSS();
  }, 1000);
}

function getPlanTotalDurationMs() {
  if (!currentWorkout) return 0;
  const sumSec = (currentWorkout.segments || []).reduce((a,s)=>a+(Number(s.duration_sec)||0),0);
  const metaSec = Number(currentWorkout.total_duration) || 0;
  if (sumSec > 0 && (metaSec === 0 || Math.abs(sumSec - metaSec) > 1)) return sumSec*1000;
  return (metaSec || sumSec)*1000;
}

function updateSegmentTimer() {
  const seg = trainingSession.segments[trainingSession.currentSegment];
  if (!seg) return;
  const endAt = trainingSession.segmentStartTime + seg.duration_sec*1000;
  const remain = Math.max(0, endAt - Date.now());
  const m = Math.floor(remain/60000);
  const s = Math.floor((remain%60000)/1000);
  const el = document.getElementById('segmentTime');
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  if (remain > 0 && remain <= 10000) el.classList.add('countdown-alert');
  else el.classList.remove('countdown-alert');
}

function checkSegmentProgress(segmentElapsed) {
  const idx = trainingSession.currentSegment;
  const seg = trainingSession.segments[idx];
  if (!seg) return;
  if (window.isSegmentChanging) return;

  const pct = Math.min(100, (segmentElapsed / (seg.duration_sec * 1000)) * 100);
  document.querySelectorAll('.timeline-segment').forEach((s, i) => {
    const fill = s.querySelector('.progress-fill');
    if (!fill) return;
    if (i < idx) fill.style.width = '100%';
    else if (i === idx) fill.style.width = `${pct}%`;
    else fill.style.width = '0%';
  });

  const remaining = seg.duration_sec * 1000 - segmentElapsed;
  if (!segmentCountdownStarted && remaining <= 5000 && remaining > 4000) {
    segmentCountdownStarted = true;
    window.isSegmentChanging = true;
    if (idx < trainingSession.segments.length - 1) {
      showCountdown(5, () => { completeCurrentSegment(); nextSegment(); window.isSegmentChanging = false; }, '다음 세그먼트 준비!');
    } else {
      showCountdown(5, () => { completeCurrentSegment(); completeTraining(); window.isSegmentChanging = false; }, '훈련 완료!');
    }
    return;
  }

  if (remaining <= 0 && !window.isSegmentChanging) {
    completeCurrentSegment();
    if (idx < trainingSession.segments.length - 1) nextSegment();
    else completeTraining();
  }
}

function completeCurrentSegment() {
  const idx = trainingSession.currentSegment;
  const seg = trainingSession.segments[idx];
  if (!seg) return;

  const st = trainingSession.segmentStartTime;
  const ed = Date.now();
  const P = trainingSession.data.power;
  const T = trainingSession.data.time;

  const segP = P.filter((_, i) => (T[i] >= st && T[i] <= ed));
  const avgPow = segP.length ? segP.reduce((a,b)=>a+b,0)/segP.length : 0;

  const target = currentUser.ftp * (seg.ftp_percent/100);
  const achieve = target > 0 ? (avgPow/target)*100 : 0;
  const color = achieve >= 100 ? '#7ED321' : '#F56500';

  const segmentEl = document.getElementById(`timeline-segment-${idx}`);
  const fill = segmentEl?.querySelector('.progress-fill');
  if (fill) { fill.style.width = '100%'; fill.style.background = color; }

  // console.log(`seg ${idx+1} avg ${Math.round(avgPow)}W, ${Math.round(achieve)}%`);
}

function nextSegment() {
  trainingSession.currentSegment++;
  segmentCountdownStarted = false;
  window.isSegmentChanging = false;

  if (trainingSession.currentSegment >= trainingSession.segments.length) {
    completeTraining();
    return;
  }
  trainingSession.segmentStartTime = Date.now();
  const sp = document.getElementById('segmentProgress');
  if (sp) sp.textContent = 0;
  updateSegmentDisplay();
  updateTargetPower();
  updateTimelineSegment(trainingSession.currentSegment, 'current');
}

function updateSegmentDisplay() {
  const seg = trainingSession.segments[trainingSession.currentSegment];
  if (!seg) return;
  document.getElementById('currentSegmentName').textContent = `${seg.description} (${seg.segment_type})`;
  const next = trainingSession.segments[trainingSession.currentSegment + 1];
  document.getElementById('nextSegment').textContent = next ? `다음: ${next.description}` : '다음: 훈련 완료';
}

function createTimeline() {
  const timeline = document.getElementById('timelineSegments');
  timeline.innerHTML = '';
  const totalSec = trainingSession.segments.reduce((s, x)=>s+(x.duration_sec||0), 0);
  trainingSession.segments.forEach((seg, i) => {
    const w = (seg.duration_sec / totalSec) * 100;
    const m = Math.floor(seg.duration_sec / 60);
    const s = seg.duration_sec % 60;
    const label = seg.duration_sec >= 60 ? `${m}:${String(s).padStart(2,'0')}` : `${s}s`;
    const div = document.createElement('div');
    div.className = 'timeline-segment';
    div.id = `timeline-segment-${i}`;
    div.style.flex = 'unset';
    div.style.width = `${w}%`;
    div.innerHTML = `
      <div class="progress-fill"></div>
      <div class="segment-label">${i+1}<br><span class="segment-time">${label}</span></div>`;
    timeline.appendChild(div);
  });
}

function updateTimelineSegment(i, status) {
  const el = document.getElementById(`timeline-segment-${i}`);
  if (el) el.className = `timeline-segment ${status}`;
}

function updateCaloriesAndTSS() {
  if (!trainingSession.startTime) return;
  if (!trainingSession.isRunning || !currentUser) return;
  if (trainingSession.data.power.length < 5) return;

  const heartRate = trainingSession.data.heartRate.slice(-1)[0] || 0;
  const weight = currentUser.weight || 70;

  const elapsedSec = (Date.now() - trainingSession.startTime)/1000;

  const kcalPerMin = (0.6309 * heartRate + 0.1988 * weight + 0.2017 * 30 - 55.0969) / 4.184;
  const totalKcal = Math.max(0, kcalPerMin * (elapsedSec/60) * 0.5);
  document.getElementById('calorieValue').textContent = totalKcal.toFixed(0);

  const ftp = currentUser.ftp || 200;
  const avgPower = trainingSession.data.power.reduce((a,b)=>a+b,0)/trainingSession.data.power.length;
  const IF = avgPower / ftp;
  const tss = (elapsedSec * avgPower * IF) / (ftp * 3600) * 100;
  document.getElementById('tssValue').textContent = tss.toFixed(1);
}

function togglePause() {
  trainingSession.isPaused = !trainingSession.isPaused;
  document.getElementById('pauseIcon').textContent = trainingSession.isPaused ? '▶️' : '⏸️';
  // ERG 일시정지/재개(트레이너 있을 때)
  if (connectedDevices.trainer) {
    if (trainingSession.isPaused) setERGMode?.(false);
    else setERGMode?.(true, liveData.targetPower || 150);
  }
}

function skipSegment() {
  if (confirm('현재 구간을 건너뛰시겠습니까?')) {
    completeCurrentSegment();
    nextSegment();
  }
}

function stopTraining() {
  if (!confirm('정말 훈련을 중단하시겠습니까?')) return;
  trainingSession.isRunning = false;
  completeTraining();
}

function completeTraining() {
  trainingSession.isRunning = false;

  const avgP = average(trainingSession.data.power);
  const maxP = trainingSession.data.power.length ? Math.max(...trainingSession.data.power) : 0;
  const avgHR = average(trainingSession.data.heartRate);

  const durH = (Date.now() - trainingSession.startTime) / 3600000;
  const calories = Math.round(avgP * durH * 3.6);

  const achieve = calculateOverallAchievement();

  document.getElementById('finalAchievement').textContent = `${achieve}%`;
  document.getElementById('workoutCompletedName').textContent =
    `${currentWorkout.workout_name} - ${Math.floor(durH * 60)}분 완주`;
  document.getElementById('resultAvgPower').textContent = Math.round(avgP);
  document.getElementById('resultMaxPower').textContent = Math.round(maxP);
  document.getElementById('resultAvgHR').textContent = Math.round(avgHR);
  document.getElementById('resultCalories').textContent = calories;

  requestAIAnalysis();
  showScreen('resultScreen');
}

function average(arr) {
  return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
}

function calculateOverallAchievement() {
  const targetPowerTime = trainingSession.segments.reduce((sum, seg) => {
    const tp = currentUser.ftp * (seg.ftp_percent/100);
    return sum + (tp * seg.duration_sec);
  }, 0);
  const totalActualPowerTime = trainingSession.data.power.reduce((s,p)=>s+p, 0);
  if (targetPowerTime === 0) return 100;
  return Math.min(100, Math.round((totalActualPowerTime / targetPowerTime) * 100));
}

function requestAIAnalysis() {
  const el = document.getElementById('aiAnalysis');
  el.textContent = '분석 중...';
  fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'analyzeTrainingPerformance', sessionId: trainingSession.sessionId })
  })
  .then(r=>r.json())
  .then(res=>{
    if (res.success) el.textContent = res.analysis;
    else el.textContent = 'AI 분석을 수행할 수 없습니다.';
  })
  .catch(e => {
    console.error(e);
    el.textContent = 'AI 분석 중 오류가 발생했습니다.';
  });
}

function saveResult() {
  alert('훈련 결과가 저장되었습니다!');
}

function shareResult() {
  const achievement = document.getElementById('finalAchievement').textContent;
  const workoutName = document.getElementById('workoutCompletedName').textContent;
  const avgPower = document.getElementById('resultAvgPower').textContent;
  const avgHR = document.getElementById('resultAvgHR').textContent;

  const text = `🚴‍♂️ 사이클 아카데미 훈련 완료!
${workoutName}
달성률: ${achievement}
평균 파워: ${avgPower}W
평균 심박: ${avgHR}bpm

🎯 당신도 도전해보세요!
${window.location.href}`;

  if (navigator.share) navigator.share({ title: '사이클 아카데미 - 훈련 완료!', text, url: window.location.href });
  else navigator.clipboard.writeText(text).then(()=> alert('결과가 클립보드에 복사되었습니다!'));
}

function goHome() {
  currentUser = null;
  currentWorkout = null;
  countdownActive = false;
  segmentCountdownStarted = false;
  window.trainingSession = {
    sessionId: null, isRunning: false, isPaused: false, startTime: null,
    currentSegment: 0, segments: [], data: { power: [], cadence: [], heartRate: [], time: [] }
  };
  window.liveData = { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
  showScreen('connectionScreen');
}

// ====== Helpers =================================================
function getSegmentDurationMs(seg){
  if(!seg) return 0;
  const parentMs = (Number(seg.duration_sec)||0)*1000;
  const childMs = (seg.steps||seg.segments||seg.intervals||seg.children||[])
    .reduce((a,s)=>a+((Number(s.duration_sec)||0)*1000),0);
  return childMs>0 ? childMs : parentMs;
}

window.addEventListener('load', () => {
  colorizeLapPower();
  if (!navigator.bluetooth) {
    alert('이 브라우저는 Web Bluetooth를 지원하지 않습니다.\nChrome, Edge, Opera 브라우저를 사용해주세요.');
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    alert('블루투스 연결을 위해서는 HTTPS 환경이 필요합니다.');
  }
  console.log('사이클 아카데미 훈련 앱 로드 완료');
});
