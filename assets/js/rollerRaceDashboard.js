/**
 * 실내 평로라 대회 대시보드 (ANT+ Continuous Scanning Mode 적용됨)
 * 수정된 버전: 2025-12-25
 * - 단일 채널(0번) 연속 스캔 모드 사용으로 15개 이상 동시 연결 지원
 * - LibConfig 설정을 통한 Device ID 식별 문제 해결
 */

// 바퀴 규격 데이터 (로드바이크 700C 휠셋)
const WHEEL_SPECS = {
  '23-622': { etrto: '23-622', size: '700 x 23C', circumference: 2096, description: '구형 로드, 트랙' },
  '25-622': { etrto: '25-622', size: '700 x 25C', circumference: 2105, description: '로드 표준' },
  '28-622': { etrto: '28-622', size: '700 x 28C', circumference: 2136, description: '엔듀런스, 최신 로드' },
  '32-622': { etrto: '32-622', size: '700 x 32C', circumference: 2155, description: '그래블, 하이브리드' }
};

// 전역 상태
window.rollerRaceState = {
  speedometers: [], // 속도계 목록
  raceState: 'idle', // idle, running, paused, finished
  startTime: null,
  pausedTime: 0,
  totalElapsedTime: 0,
  raceSettings: {
    endByDistance: true,
    targetDistance: 10,
    endByTime: false,
    targetTime: 60,
    wheelSize: '25-622'
  },
  rankings: [],
  rankDisplayStartIndex: 0,
  rankDisplayTimer: null
};

// ANT+ 통신 관련 전역 상태
window.antState = {
  usbDevice: null,
  inEndpoint: null,
  outEndpoint: null,
  isScanningUI: false, // UI에서 '검색' 버튼을 눌렀는지 여부
  isRunning: false,    // ANT+ 수신 루프가 돌고 있는지 여부
  foundDevices: [],    // 검색된 디바이스 목록 (UI 표시용)
  messageBuffer: [],
  lastMessageTime: 0
};

// 속도계 데이터 구조
class SpeedometerData {
  constructor(id, name, deviceId = null) {
    this.id = id;
    this.name = name;
    this.deviceId = deviceId; // ANT+ Device ID (숫자)
    this.connected = false;   // 데이터 수신 중 여부
    this.currentSpeed = 0;
    this.maxSpeed = 0;
    this.averageSpeed = 0;
    this.totalDistance = 0;
    this.totalRevolutions = 0;
    this.lastUpdateTime = 0;
    this.lastRevolutions = 0;
    this.lastEventTime = 0;
    this.speedSum = 0;
    this.speedCount = 0;
    // 연결 끊김 감지용
    this.lastPacketTime = 0; 
  }
}

/**
 * 대시보드 초기화
 */
function initRollerRaceDashboard() {
  console.log('[평로라 대회] 대시보드 초기화 (Continuous Scan Ver.)');
  loadSpeedometerList();
  createSpeedometerGrid();
  updateSpeedometerListUI();
  loadRaceSettings();
  
  window.rollerRaceTimer = null;
  
  // 전광판 초기화
  const scoreboardTimeEl = document.getElementById('scoreboardTime');
  const scoreboardDistanceEl = document.getElementById('scoreboardDistance');
  const scoreboardRidersEl = document.getElementById('scoreboardRiders');
  if (scoreboardTimeEl) scoreboardTimeEl.textContent = '00:00:00';
  if (scoreboardDistanceEl) scoreboardDistanceEl.textContent = '0.0';
  if (scoreboardRidersEl) scoreboardRidersEl.textContent = '0';
  
  window.rollerRaceState.rankDisplayStartIndex = 0;
  stopRankDisplayRotation();
  
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  updateScoreboardRankings(sorted, false);
  updateRankDisplay(false);

  // 연결 끊김 감지 타이머 (3초간 데이터 없으면 연결 끊김 처리)
  setInterval(checkDeviceTimeouts, 1000);
}

/**
 * 연결 타임아웃 체크 (3초 이상 데이터 없으면 연결 끊김 표시)
 */
function checkDeviceTimeouts() {
  const now = Date.now();
  window.rollerRaceState.speedometers.forEach(s => {
    if (s.connected && s.deviceId && (now - s.lastPacketTime > 3000)) {
       s.connected = false;
       updateSpeedometerConnectionStatus(s.id, false);
    }
  });
}

/**
 * 속도계 그리드 생성
 */
function createSpeedometerGrid() {
  const grid = document.getElementById('speedometerGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const speedometer = window.rollerRaceState.speedometers[i] || new SpeedometerData(i + 1, `속도계 ${i + 1}`);
    if (!window.rollerRaceState.speedometers[i]) {
      window.rollerRaceState.speedometers[i] = speedometer;
    }
    const speedometerEl = createSpeedometerElement(speedometer);
    grid.appendChild(speedometerEl);
  }
}

/**
 * 속도계 요소 HTML 생성
 */
function createSpeedometerElement(speedometer) {
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `speedometer-${speedometer.id}`;
  container.dataset.speedometerId = speedometer.id;
  
  container.innerHTML = `
    <div class="speedometer-header">
      <span class="speedometer-name">${speedometer.name}</span>
      <div class="connection-status-center" id="status-${speedometer.id}">
        <span class="status-dot disconnected"></span>
        <span class="status-text">미연결</span>
      </div>
      <button class="btn-pair btn-pair-sm" onclick="pairSpeedometer(${speedometer.id})" title="설정">
        <img src="assets/img/wifi.png" alt="설정" style="width: 16px; height: 16px;">
      </button>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 200">
        <path class="speedometer-arc-bg" d="M 20 140 A 80 80 0 0 1 180 140" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5"/>
        <g class="speedometer-ticks">${generateSpeedometerTicks()}</g>
        <g class="speedometer-labels">${generateSpeedometerLabels()}</g>
        <circle cx="100" cy="140" r="7" fill="#000000" stroke="#ff0000" stroke-width="2"/>
        <g class="speedometer-needle" transform="translate(100, 140)">
          <line id="needle-${speedometer.id}" x1="0" y1="-7" x2="0" y2="-80" stroke="#ff0000" stroke-width="3" stroke-linecap="round" transform="rotate(270)"/>
        </g>
        <text x="100" y="155" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="10" font-weight="500">km/h</text>
      </svg>
      <div class="rank-display-bottom">
        <img class="rank-value-bottom" id="rank-value-${speedometer.id}" src="" alt="" style="display: none;" />
      </div>
    </div>
    <div class="speedometer-info disconnected">
      <div class="speed-display-left">
        <div class="speed-stat-row speed-stat-max">
          <span class="speed-stat-label">Max</span>
          <span class="speed-stat-value" id="max-speed-value-${speedometer.id}">0</span>
          <sup class="speed-unit-sup">km/h</sup>
        </div>
        <div class="speed-stat-row speed-stat-avg">
          <span class="speed-stat-label">Avg</span>
          <span class="speed-stat-value" id="avg-speed-value-${speedometer.id}">0</span>
          <sup class="speed-unit-sup">km/h</sup>
        </div>
      </div>
      <div class="speed-display-center">
        <div class="speed-value-wrapper">
          <span class="speed-value" id="speed-value-${speedometer.id}">0</span>
          <div class="speed-unit-bottom">km/h</div>
        </div>
      </div>
      <div class="distance-display-right">
        <span class="distance-value" id="distance-value-${speedometer.id}">0.0</span>
        <sup class="distance-unit-sup">km</sup>
      </div>
    </div>
  `;
  return container;
}

function generateSpeedometerTicks() {
  let ticks = '';
  const centerX = 100, centerY = 140, radius = 80, maxSpeed = 120;
  for (let speed = 0; speed <= maxSpeed; speed += 5) {
    let angle = 180 - (speed / maxSpeed) * 180 + 180;
    const rad = (angle * Math.PI) / 180;
    const innerRadius = radius - 10;
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    const isMajor = speed % 20 === 0;
    const tickLength = isMajor ? 14 : 7;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
  }
  return ticks;
}

function generateSpeedometerLabels() {
  let labels = '';
  const centerX = 100, centerY = 140, radius = 80, maxSpeed = 120;
  const speeds = [0, 20, 40, 60, 80, 100, 120];
  speeds.forEach(speed => {
    let angle = 180 - (speed / maxSpeed) * 180 + 180;
    const rad = (angle * Math.PI) / 180;
    const labelRadius = radius + 18;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    const displayValue = maxSpeed - speed; // 역순 배치 유지
    labels += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="15" font-weight="700">${displayValue}</text>`;
  });
  return labels;
}

function updateSpeedometerNeedle(speedometerId, speed) {
  const needle = document.getElementById(`needle-${speedometerId}`);
  if (!needle) return;
  const maxSpeed = 120;
  let angle = 270 + 180 * (speed / maxSpeed);
  if (angle >= 360) angle = angle - 360;
  needle.style.transition = 'transform 0.3s ease-out';
  needle.setAttribute('transform', `rotate(${angle})`);
}

/**
 * 속도계 데이터 업데이트 (데이터 수신 시 호출)
 */
function updateSpeedometerData(speedometerId, speed, distance) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  speedometer.currentSpeed = speed;
  speedometer.totalDistance = distance;
  speedometer.lastUpdateTime = Date.now();
  
  if (speed > speedometer.maxSpeed) speedometer.maxSpeed = speed;
  if (speed > 0) {
    speedometer.speedSum += speed;
    speedometer.speedCount += 1;
    speedometer.averageSpeed = speedometer.speedSum / speedometer.speedCount;
  }
  
  // UI 요소 찾기
  const speedValueEl = document.getElementById(`speed-value-${speedometerId}`);
  const maxSpeedValueEl = document.getElementById(`max-speed-value-${speedometerId}`);
  const avgSpeedValueEl = document.getElementById(`avg-speed-value-${speedometerId}`);
  const distanceValueEl = document.getElementById(`distance-value-${speedometerId}`);
  
  if (speedValueEl) speedValueEl.textContent = speed.toFixed(1);
  if (maxSpeedValueEl) maxSpeedValueEl.textContent = speedometer.maxSpeed.toFixed(1);
  if (avgSpeedValueEl) avgSpeedValueEl.textContent = speedometer.averageSpeed.toFixed(1);
  if (distanceValueEl) distanceValueEl.textContent = distance.toFixed(2);
  
  updateSpeedometerNeedle(speedometerId, speed);
  updateRankings();
  updateDashboardStats();
}

/**
 * 순위 업데이트 및 전광판 로직
 */
function updateRankings() {
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  
  // 개별 속도계 랭킹 뱃지 표시
  sorted.forEach((speedometer, index) => {
    const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
    if (rankEl) {
      const rank = index + 1;
      if (rank >= 1 && rank <= 10) {
        rankEl.src = `assets/img/${rank}.png`;
        rankEl.alt = `${rank}위`;
        rankEl.style.display = 'inline-block';
      } else {
        rankEl.style.display = 'none';
      }
    }
  });

  // 미연결/거리0 숨김
  window.rollerRaceState.speedometers.forEach(speedometer => {
    if (!speedometer.connected || speedometer.totalDistance === 0) {
      const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
      if (rankEl) rankEl.style.display = 'none';
    }
  });
  
  updateScoreboardRankings(sorted, false);
}

function updateScoreboardRankings(sorted, updateDisplay = false) {
  const ranksContainer = document.getElementById('scoreboardRanks');
  if (!ranksContainer) return;
  
  const existingItems = ranksContainer.querySelectorAll('.rank-item');
  const currentStartIndex = window.rollerRaceState.rankDisplayStartIndex;
  
  if (existingItems.length === 0) {
    for (let i = 0; i < 3; i++) {
      const rankItem = document.createElement('div');
      rankItem.className = 'rank-item';
      rankItem.innerHTML = `<div class="rank-item-content"><img class="rank-number" src="" style="display:none;"/><span class="rank-name">-</span><span class="rank-distance">0.0km</span></div>`;
      ranksContainer.appendChild(rankItem);
    }
  }
  
  const visibleItems = ranksContainer.querySelectorAll('.rank-item');
  for (let i = 0; i < Math.min(3, visibleItems.length); i++) {
    const targetIndex = (currentStartIndex + i) % sorted.length;
    const item = visibleItems[i];
    if (item) {
      const nameEl = item.querySelector('.rank-name');
      const distanceEl = item.querySelector('.rank-distance');
      const numberEl = item.querySelector('.rank-number');
      
      if (sorted.length > 0 && sorted[targetIndex]) {
        const speedometer = sorted[targetIndex];
        const rank = targetIndex + 1;
        if (nameEl) nameEl.textContent = speedometer.name;
        if (distanceEl) distanceEl.textContent = speedometer.totalDistance.toFixed(2) + 'km';
        if (numberEl) {
            if (rank <= 10) {
                numberEl.src = `assets/img/${rank}.png`;
                numberEl.style.display = 'inline-block';
            } else { numberEl.style.display = 'none'; }
        }
        item.classList.add('rank-item-visible');
      } else {
        if (nameEl) nameEl.textContent = '-';
        if (distanceEl) distanceEl.textContent = '0.0km';
        if (numberEl) numberEl.style.display = 'none';
        item.classList.add('rank-item-visible');
      }
    }
  }
  
  if (updateDisplay) updateRankDisplay(true);
}

function updateRankDisplay(withAnimation = true) {
  const ranksContainer = document.getElementById('scoreboardRanks');
  if (!ranksContainer) return;
  if (withAnimation) {
    ranksContainer.classList.remove('rank-scroll-animation');
    void ranksContainer.offsetWidth;
    ranksContainer.classList.add('rank-scroll-animation');
  }
}

function startRankDisplayRotation() {
  if (window.rollerRaceState.rankDisplayTimer) clearInterval(window.rollerRaceState.rankDisplayTimer);
  window.rollerRaceState.rankDisplayStartIndex = 0;
  updateRankDisplay(false);
  window.rollerRaceState.rankDisplayTimer = setInterval(() => {
    const sorted = [...window.rollerRaceState.speedometers].filter(s => s.connected && s.totalDistance > 0);
    const totalRanks = sorted.length;
    if (totalRanks === 0) return;
    
    if (totalRanks > 3) {
      window.rollerRaceState.rankDisplayStartIndex += 1;
      if (window.rollerRaceState.rankDisplayStartIndex >= totalRanks) window.rollerRaceState.rankDisplayStartIndex = 0;
    } else {
      window.rollerRaceState.rankDisplayStartIndex = 0;
    }
    updateScoreboardRankings(sorted, true);
  }, 5000);
}

function stopRankDisplayRotation() {
  if (window.rollerRaceState.rankDisplayTimer) {
    clearInterval(window.rollerRaceState.rankDisplayTimer);
    window.rollerRaceState.rankDisplayTimer = null;
  }
}

function updateDashboardStats() {
  const totalDistance = window.rollerRaceState.speedometers.reduce((sum, s) => sum + s.totalDistance, 0);
  const scoreboardDistanceEl = document.getElementById('scoreboardDistance');
  if (scoreboardDistanceEl) scoreboardDistanceEl.textContent = totalDistance.toFixed(2);
}

/**
 * 타이머 및 경기 로직
 */
function updateElapsedTime() {
  if (!window.rollerRaceState || window.rollerRaceState.raceState !== 'running') return;
  
  const now = Date.now();
  const elapsed = Math.floor((now - window.rollerRaceState.startTime - (window.rollerRaceState.pausedTime || 0)) / 1000);
  window.rollerRaceState.totalElapsedTime = elapsed;
  
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  const elapsedTimeEl = document.getElementById('elapsedTime');
  const scoreboardTimeEl = document.getElementById('scoreboardTime');
  if (elapsedTimeEl) elapsedTimeEl.textContent = timeString;
  if (scoreboardTimeEl) scoreboardTimeEl.textContent = timeString;
  
  checkRaceEndConditions();
}

function checkRaceEndConditions() {
  const settings = window.rollerRaceState.raceSettings;
  let shouldEnd = false;
  
  if (settings.endByDistance) {
    const totalDistance = window.rollerRaceState.speedometers.reduce((sum, s) => sum + s.totalDistance, 0);
    if (totalDistance >= settings.targetDistance) shouldEnd = true;
  }
  if (settings.endByTime) {
    const elapsedMinutes = window.rollerRaceState.totalElapsedTime / 60;
    if (elapsedMinutes >= settings.targetTime) shouldEnd = true;
  }
  
  if (shouldEnd) {
    stopRace();
    if (typeof showToast === 'function') showToast('경기가 종료되었습니다!');
  }
}

function startRace() {
  if (window.rollerRaceState.raceState === 'running') return;
  
  if (window.rollerRaceState.raceState === 'paused') {
    window.rollerRaceState.pausedTime += Date.now() - window.rollerRaceState.pauseStartTime;
  } else {
    window.rollerRaceState.startTime = Date.now();
    window.rollerRaceState.pausedTime = 0;
    window.rollerRaceState.totalElapsedTime = 0;
    // 데이터 초기화
    window.rollerRaceState.speedometers.forEach(s => {
      s.totalDistance = 0;
      s.totalRevolutions = 0;
      s.currentSpeed = 0;
      s.maxSpeed = 0;
      s.averageSpeed = 0;
      s.speedSum = 0;
      s.speedCount = 0;
      s.lastRevolutions = 0;
    });
  }
  
  window.rollerRaceState.raceState = 'running';
  if (window.rollerRaceTimer) clearInterval(window.rollerRaceTimer);
  updateElapsedTime();
  window.rollerRaceTimer = setInterval(updateElapsedTime, 1000);
  
  // ANT+ 수신 시작 (이미 실행 중이면 무시됨)
  startContinuousScan();
  
  // 버튼 상태
  setButtonState('btnStartRace', true);
  setButtonState('btnPauseRace', false);
  setButtonState('btnStopRace', false);
  
  startRankDisplayRotation();
  if (typeof showToast === 'function') showToast('경기가 시작되었습니다!');
}

function pauseRace() {
  if (window.rollerRaceState.raceState !== 'running') return;
  window.rollerRaceState.raceState = 'paused';
  window.rollerRaceState.pauseStartTime = Date.now();
  if (window.rollerRaceTimer) clearInterval(window.rollerRaceTimer);
  
  setButtonState('btnStartRace', false);
  setButtonState('btnPauseRace', true);
  stopRankDisplayRotation();
  if (typeof showToast === 'function') showToast('일시정지');
}

function stopRace() {
  window.rollerRaceState.raceState = 'finished';
  if (window.rollerRaceTimer) clearInterval(window.rollerRaceTimer);
  setButtonState('btnStartRace', false);
  setButtonState('btnPauseRace', true);
  setButtonState('btnStopRace', true);
  updateRankings();
  stopRankDisplayRotation();
  window.rollerRaceState.rankDisplayStartIndex = 0;
  updateRankDisplay(false);
  if (typeof showToast === 'function') showToast('종료됨');
}

function setButtonState(id, disabled) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = disabled;
}


/* =================================================================================
 * [핵심] ANT+ Continuous Scanning Mode 구현 (단일 채널 다중 기기 지원)
 * ================================================================================= */

/**
 * 속도계 페어링 (이제 단순히 ID를 등록하는 과정임)
 */
function pairSpeedometer(speedometerId) {
  // 모달을 열어 ID를 입력받거나 검색된 목록에서 선택하게 함
  // 기존 코드의 showAddSpeedometerModal 등을 활용하기 위해 ID 설정
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;

  // 현재 모달 시스템을 활용 (이름, ID 수정)
  const modal = document.getElementById('addSpeedometerModal');
  const nameInput = document.getElementById('speedometerName');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  const title = document.getElementById('modalTitle');
  
  if (modal) {
    if (nameInput) nameInput.value = speedometer.name;
    if (deviceIdInput) deviceIdInput.value = speedometer.deviceId || '';
    if (title) title.textContent = `속도계 ${speedometerId} 설정`;
    
    // 저장 버튼 클릭 시 동작을 이 속도계에 맞게 수정
    // (간단하게 구현하기 위해 전역 변수에 타겟 ID 저장)
    window.currentTargetSpeedometerId = speedometerId;
    
    showAddSpeedometerModal();
  }
}

/**
 * 속도계 정보 저장 (모달에서 '저장' 클릭 시)
 */
function addSpeedometer() { // 기존 함수명 재사용
  const nameInput = document.getElementById('speedometerName');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  
  const targetId = window.currentTargetSpeedometerId;
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === targetId);
  
  if (speedometer && nameInput) {
    speedometer.name = nameInput.value;
    const newDeviceId = deviceIdInput.value.trim();
    
    // ID가 변경되었으면 상태 초기화
    if (speedometer.deviceId != newDeviceId) {
        speedometer.deviceId = newDeviceId;
        speedometer.connected = false;
        speedometer.totalDistance = 0;
        updateSpeedometerConnectionStatus(targetId, false);
    }
    
    saveSpeedometerList();
    updateSpeedometerListUI();
    createSpeedometerGrid(); // 이름 등 업데이트
    closeAddSpeedometerModal();
    
    // USB가 연결되어 있다면 바로 수신 시작 (스캔 모드는 항상 켜둠)
    if (window.antState.usbDevice) {
        startContinuousScan();
    }
  }
}

/**
 * ANT+ USB 스틱 연결 및 초기화 (Continuous Scanning Mode)
 */
async function connectANTUSBStickWithDevice(devicePromise) {
  try {
    const device = await devicePromise;
    await device.open();
    await device.selectConfiguration(1);
    
    // 인터페이스 찾기 (보통 0번)
    await device.claimInterface(0);

    // [중요] 엔드포인트 명확하게 찾기 (Bulk 우선, 없으면 Interrupt)
    const endpoints = device.configuration.interfaces[0].alternate.endpoints;
    let inEndpoint = endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
    let outEndpoint = endpoints.find(e => e.direction === 'out' && e.type === 'bulk');

    if (!inEndpoint) inEndpoint = endpoints.find(e => e.direction === 'in' && e.type === 'interrupt');
    if (!outEndpoint) outEndpoint = endpoints.find(e => e.direction === 'out' && e.type === 'interrupt');

    if (!inEndpoint || !outEndpoint) {
      throw new Error('ANT+ 엔드포인트를 찾을 수 없습니다.');
    }

    window.antState.usbDevice = device;
    window.antState.inEndpoint = inEndpoint.endpointNumber;
    window.antState.outEndpoint = outEndpoint.endpointNumber;
    
    console.log('[ANT+] USB 연결 성공 (EP IN:', inEndpoint.endpointNumber, 'OUT:', outEndpoint.endpointNumber, ')');
    
    // 초기화 후 바로 스캔 모드 진입
    await startContinuousScan();
    
    checkANTUSBStatus();
    return device;

  } catch (error) {
    console.error('[ANT+ 연결 오류]', error);
    if (typeof showToast === 'function') showToast('USB 연결 실패: ' + error.message);
    throw error;
  }
}

/**
 * [핵심] 연속 스캔 모드 시작 (Start Continuous Scan)
 * 채널 0번을 Rx Scan Mode로 설정하여 모든 패킷을 수신
 */
async function startContinuousScan() {
  if (window.antState.isRunning) return; // 이미 실행 중
  if (!window.antState.usbDevice) return;

  console.log('[ANT+] 연속 스캔 모드 설정 시작...');
  window.antState.isRunning = true;
  
  try {
    // 1. Reset
    await sendANTMessage(0x4A, [0x00]); 
    await new Promise(r => setTimeout(r, 500));

    // 2. Set Network Key
    await sendANTMessage(0x46, [0x00, 0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45]);
    await new Promise(r => setTimeout(r, 100));

    // 3. Assign Channel 0 as Slave (0x00) - 스캔 모드 진입 전엔 일반 수신으로 할당
    await sendANTMessage(0x42, [0x00, 0x00]);
    await new Promise(r => setTimeout(r, 100));

    // 4. Set Channel ID (Wildcard: 0,0,0)
    await sendANTMessage(0x51, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    await new Promise(r => setTimeout(r, 100));

    // 5. Set Frequency (57 = 2457MHz)
    await sendANTMessage(0x45, [0x00, 57]);
    await new Promise(r => setTimeout(r, 100));

    // 6. [중요] Lib Config (0x6E) - Device ID를 꼬리표로 붙임 (0xE0 = ID, RSSI, Timestamp)
    await sendANTMessage(0x6E, [0x00, 0xE0]);
    await new Promise(r => setTimeout(r, 100));

    // 7. [핵심] Open Rx Scan Mode (0x5B) - 채널 0을 스캔 모드로 오픈
    console.log('[ANT+] Rx Scan Mode(0x5B) 활성화');
    await sendANTMessage(0x5B, [0x00]); 
    
    // 메시지 수신 루프 시작
    startANTMessageListener();
    
  } catch (error) {
    console.error('[ANT+ 설정 오류]', error);
    window.antState.isRunning = false;
  }
}

/**
 * ANT+ 메시지 송신
 */
async function sendANTMessage(messageId, data) {
  if (!window.antState.usbDevice) return;
  
  const length = data.length + 1;
  let checksum = 0xA4 ^ length ^ messageId;
  for (let b of data) checksum ^= b;
  
  const packet = new Uint8Array([0xA4, length, messageId, ...data, checksum]);
  // 0으로 패딩하여 64바이트(또는 엔드포인트 크기)로 맞출 필요는 없으나, 
  // 일부 컨트롤러는 8바이트 정렬을 선호함. 여기선 단순 전송.
  
  try {
    await window.antState.usbDevice.transferOut(window.antState.outEndpoint, packet);
  } catch (e) {
    console.warn('전송 실패:', e);
  }
}

/**
 * ANT+ 메시지 수신 루프
 */
async function startANTMessageListener() {
  if (!window.antState.usbDevice || !window.antState.isRunning) return;

  try {
    const result = await window.antState.usbDevice.transferIn(window.antState.inEndpoint, 64); // 넉넉하게 읽음
    const data = new Uint8Array(result.data.buffer);
    
    // 버퍼에 추가 및 파싱
    processIncomingBuffer(data);
    
  } catch (error) {
    if (error.name === 'NetworkError' || error.name === 'NotFoundError') {
        console.log('USB 연결 끊김');
        window.antState.isRunning = false;
        window.antState.usbDevice = null;
        updateANTUSBStatusUI('error', 'USB 연결 끊김', null);
        return;
    }
  }
  
  // 다음 패킷 대기 (재귀 호출)
  if (window.antState.usbDevice) {
     setTimeout(startANTMessageListener, 0); // 즉시 대기
  }
}

/**
 * 수신된 Raw 데이터 버퍼 처리
 */
function processIncomingBuffer(newData) {
  // 간단한 파서: 0xA4(Sync)를 찾아 패킷 분리
  // 실제 프로덕션에서는 잔여 버퍼(buffer remaining) 처리가 필요하지만,
  // 여기서는 패킷이 온전하게 온다고 가정하고 간단히 구현
  
  let i = 0;
  while (i < newData.length) {
    if (newData[i] === 0xA4) {
      if (i + 1 >= newData.length) break; // 길이 정보 없음
      const length = newData[i + 1];
      const totalLen = length + 4; // Sync(1)+Len(1)+MsgID(1)+Payload(Len)+Checksum(1) = Len+4 ?? 
                                   // 아니오: Sync(1) + Len(1) + [MsgID(1) + Payload(Length-1)] + Checksum(1)
                                   // Protocol: Sync, Length, MsgID, Data..., Checksum
                                   // Length Byte Value = N (Number of data bytes + 1 for MsgID)
                                   // Total bytes = 1(Sync) + 1(Len) + N(Payload) + 1(Checksum) = N + 3
      const packetLen = length + 4; // 왜냐면 length값은 MsgID 포함 길이니까.
      
      if (i + packetLen <= newData.length) {
        const packet = newData.slice(i, i + packetLen);
        handleParsedPacket(packet);
        i += packetLen;
        continue;
      }
    }
    i++;
  }
}

/**
 * 파싱된 단일 패킷 처리
 */
function handleParsedPacket(packet) {
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1); // MsgID 다음부터 Checksum 전까지
  
  // Broadcast Data (0x4E) 처리
  if (msgId === 0x4E) {
    // Rx Scan Mode & LibConfig(0xE0) 사용 시 데이터 구조:
    // [Channel(0), Data0..7, Flag, DevID_L, DevID_H, DevType, TransType]
    // 총 Payload 길이: 1 + 8 + 1 + 2 + 1 + 1 = 14 bytes (최소)
    
    if (payload.length >= 13) {
      const channel = payload[0]; // Scan Mode에서는 항상 0
      const antData = payload.slice(1, 9); // 실제 센서 데이터 (8바이트)
      
      // Extended Data 파싱 (Device ID 추출)
      // Flag 바이트 체크 (보통 9번째 바이트, index 9)
      const flag = payload[9];
      // Device ID는 Flag 뒤에 옴 (index 10, 11)
      const deviceId = (payload[11] << 8) | payload[10];
      const deviceType = payload[12];
      
      // 1. 디바이스 검색 모드일 때: 목록에 추가
      if (window.antState.isScanningUI) {
        addFoundDevice(deviceId, deviceType);
      }
      
      // 2. 주행 모드일 때: 등록된 속도계인지 확인하고 업데이트
      processSensorData(deviceId, antData);
    }
  }
}

/**
 * 검색된 디바이스 목록 관리
 */
function addFoundDevice(deviceId, deviceType) {
  // Speed(122/0x7A), Speed&Cadence(121/0x79) 만 필터링
  if (deviceType !== 0x79 && deviceType !== 0x7A) return; // 파워미터 등 제외하려면 주석 해제

  const idStr = deviceId.toString();
  const existing = window.antState.foundDevices.find(d => d.id === idStr);
  
  if (!existing) {
    const typeName = (deviceType === 0x79) ? 'Speed/Cadence' : 'Speed Sensor';
    window.antState.foundDevices.push({
      id: idStr,
      name: `ANT+ ${typeName} (${deviceId})`,
      deviceType: typeName,
      rssi: 0 // 필요시 RSSI 파싱 추가
    });
    // UI 갱신
    displayANTDevices(window.antState.foundDevices);
  }
}

/**
 * [핵심] 센서 데이터 처리 및 속도 계산
 * 등록된 속도계 목록에서 ID가 일치하는 것을 찾아 업데이트
 */
function processSensorData(deviceId, data) {
  const idStr = deviceId.toString();
  const speedometer = window.rollerRaceState.speedometers.find(s => s.deviceId == idStr);
  
  if (!speedometer) return; // 등록되지 않은 센서는 무시
  
  // 연결 상태 업데이트
  speedometer.connected = true;
  speedometer.lastPacketTime = Date.now();
  updateSpeedometerConnectionStatus(speedometer.id, true);
  
  // 데이터 파싱 (기존 로직 활용)
  // Data: [EventTime_L, EventTime_H, Rev_L, Rev_H, LastEvent_L, LastEvent_H, ...]
  const eventTime = (data[1] << 8) | data[0];
  const revolutions = (data[3] << 8) | data[2];
  const lastEventTime = (data[5] << 8) | data[4];
  
  // 초기값이면 저장만 하고 리턴
  if (speedometer.lastRevolutions === 0 && speedometer.lastEventTime === 0) {
    speedometer.lastRevolutions = revolutions;
    speedometer.lastEventTime = lastEventTime;
    return;
  }
  
  // 변화량 계산
  let revDiff = revolutions - speedometer.lastRevolutions;
  if (revDiff < 0) revDiff += 65536; // Overflow 처리
  
  let timeDiff = lastEventTime - speedometer.lastEventTime;
  if (timeDiff < 0) timeDiff += 65536; // Overflow 처리
  
  // 업데이트 (변화가 있을 때만)
  if (timeDiff > 0) {
    const wheelSpec = WHEEL_SPECS[window.rollerRaceState.raceSettings.wheelSize] || WHEEL_SPECS['25-622'];
    const circumference = wheelSpec.circumference; // mm
    
    // 속도 = (회전수 * 둘레(mm) / 1000)m / (시간(1/1024s) / 1024)s * 3.6 (km/h)
    // Speed (m/s) = (revDiff * circ_m) / (timeDiff / 1024)
    const distM = (revDiff * circumference) / 1000;
    const timeS = timeDiff / 1024;
    const speedKmh = (distM / timeS) * 3.6;
    
    // 튀는 값 필터링 (예: 200km/h 이상 무시)
    if (speedKmh < 200) {
      // 경기 중일 때만 거리 누적
      if (window.rollerRaceState.raceState === 'running') {
        speedometer.totalRevolutions += revDiff;
        speedometer.totalDistance += (distM / 1000); // km
      }
      
      // UI 업데이트
      updateSpeedometerData(speedometer.id, speedKmh, speedometer.totalDistance);
    }
    
    // 상태 저장
    speedometer.lastRevolutions = revolutions;
    speedometer.lastEventTime = lastEventTime;
  } else if (Date.now() - speedometer.lastPacketTime > 2000) {
    // 2초 이상 데이터 변화 없으면 속도 0 처리
    updateSpeedometerData(speedometer.id, 0, speedometer.totalDistance);
  }
}

/**
 * UI: 디바이스 검색 버튼 클릭 시
 */
async function searchANTDevices() {
  window.antState.isScanningUI = true;
  window.antState.foundDevices = [];
  
  const listEl = document.getElementById('antDeviceList');
  if (listEl) {
    listEl.classList.remove('hidden');
    listEl.innerHTML = '<div style="padding:20px; text-align:center;">디바이스 검색 중...<br>(센서 휠을 굴려 깨워주세요)</div>';
  }

  // USB 연결이 안되어 있으면 연결 시도
  if (!window.antState.usbDevice) {
    try {
        await connectUSBStickDirectly(); // 권한 요청
    } catch(e) {
        return;
    }
  }
  
  // 이미 Scan Mode는 켜져 있으므로(connectUSBStickDirectly에서 킴),
  // isScanningUI 플래그만 true로 하면 handleParsedPacket에서 목록을 채워줌.
}

/**
 * UI Helper Functions
 */
function requestANTUSBDevice() {
  const filters = [{ vendorId: 0x0fcf }, { vendorId: 0x04d8 }, { vendorId: 0x0483 }];
  return navigator.usb.requestDevice({ filters: [] }); // 필터 없이 전체 검색 권장 (호환성)
}

async function connectUSBStickDirectly() {
  const device = await requestANTUSBDevice();
  await connectANTUSBStickWithDevice(Promise.resolve(device));
}

function updateSpeedometerConnectionStatus(id, connected) {
  const statusEl = document.getElementById(`status-${id}`);
  const infoEl = document.getElementById(`speedometer-${id}`)?.querySelector('.speedometer-info');
  
  if (statusEl) {
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');
    if (connected) {
      dot.className = 'status-dot connected';
      text.textContent = '연결됨';
      if (infoEl) {
         infoEl.classList.remove('disconnected');
         infoEl.classList.add('connected');
      }
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = '미연결';
      if (infoEl) {
         infoEl.classList.remove('connected');
         infoEl.classList.add('disconnected');
      }
    }
  }
}

// ... 기타 UI 헬퍼 함수들은 기존 코드와 동일하게 유지하거나 필요시 추가 ...
// 파일의 끝
