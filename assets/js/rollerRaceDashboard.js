/**
 * 실내 평로라 대회 대시보드
 * ANT+ 1:N 연결로 10개 속도계 센서 관리
 */

// 전역 상태
window.rollerRaceState = {
  speedometers: [], // 속도계 목록
  connectedDevices: {}, // 연결된 ANT+ 디바이스 (deviceId -> device)
  raceState: 'idle', // idle, running, paused, finished
  startTime: null,
  pausedTime: 0,
  totalElapsedTime: 0,
  raceSettings: {
    endByDistance: true,
    targetDistance: 10, // km
    endByTime: false,
    targetTime: 60 // minutes
  },
  rankings: [] // 순위 정보
};

// 속도계 데이터 구조
class SpeedometerData {
  constructor(id, name, deviceId = null) {
    this.id = id;
    this.name = name;
    this.deviceId = deviceId;
    this.connected = false;
    this.currentSpeed = 0; // km/h
    this.totalDistance = 0; // km
    this.lastUpdateTime = null;
    this.speedHistory = []; // 최근 속도 기록 (그래프용)
  }
}

/**
 * 대시보드 초기화
 */
function initRollerRaceDashboard() {
  console.log('[평로라 대회] 대시보드 초기화');
  
  // 저장된 속도계 목록 로드
  loadSpeedometerList();
  
  // 속도계 그리드 생성
  createSpeedometerGrid();
  
  // 속도계 목록 UI 업데이트
  updateSpeedometerListUI();
  
  // 경기 설정 로드
  loadRaceSettings();
  
  // 타이머 초기화
  window.rollerRaceTimer = null;
}

/**
 * 속도계 그리드 생성 (10개, 5개씩 2줄)
 */
function createSpeedometerGrid() {
  const grid = document.getElementById('speedometerGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  // 10개 속도계 생성
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
 * 속도계 요소 생성
 */
function createSpeedometerElement(speedometer) {
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `speedometer-${speedometer.id}`;
  container.dataset.speedometerId = speedometer.id;
  
  container.innerHTML = `
    <div class="speedometer-header">
      <span class="speedometer-name">${speedometer.name}</span>
      <button class="btn-pair btn-pair-sm" onclick="pairSpeedometer(${speedometer.id})" title="페어링">
        <img src="assets/img/wifi.png" alt="페어링" style="width: 16px; height: 16px;">
      </button>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 120">
        <!-- 위쪽 반원 배경 (검은색 배경 위에) -->
        <path class="speedometer-arc-bg" d="M 20 20 A 80 80 0 0 1 180 20" 
              fill="none" stroke="rgba(255, 255, 255, 0.1)" stroke-width="2"/>
        
        <!-- 속도 눈금 (0~120km/h) -->
        <g class="speedometer-ticks">
          ${generateSpeedometerTicks()}
        </g>
        
        <!-- 속도 숫자 (반원 바깥쪽, 20단위만) -->
        <g class="speedometer-labels">
          ${generateSpeedometerLabels()}
        </g>
        
        <!-- 바늘 (위쪽 반원 중심) -->
        <g class="speedometer-needle">
          <line id="needle-${speedometer.id}" 
                x1="100" y1="20" 
                x2="100" y2="90" 
                stroke="#ff0000" 
                stroke-width="3" 
                stroke-linecap="round"
                transform="rotate(180 100 20)"/>
          <circle cx="100" cy="20" r="6" fill="#1a1a1a" stroke="#ff0000" stroke-width="2"/>
        </g>
        
        <!-- km/h 라벨 (바늘 중심 밑) -->
        <text x="100" y="30" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="10" 
              font-weight="500">km/h</text>
      </svg>
    </div>
    <div class="speedometer-info disconnected">
      <div class="speed-display">
        <span class="speed-value" id="speed-value-${speedometer.id}">0</span>
        <span class="speed-unit">km/h</span>
      </div>
      <div class="distance-display">
        <div class="distance-label">거리</div>
        <div class="distance-value-wrapper">
          <span class="distance-value" id="distance-value-${speedometer.id}">0.0</span>
          <span class="distance-unit">km</span>
        </div>
      </div>
    </div>
    <div class="speedometer-footer">
      <div class="rank-display">
        <span class="rank-label">순위</span>
        <span class="rank-value" id="rank-value-${speedometer.id}">-</span>
      </div>
    </div>
    <div class="connection-status-center" id="status-${speedometer.id}">
      <span class="status-dot disconnected"></span>
      <span class="status-text">미연결</span>
    </div>
  `;
  
  return container;
}

/**
 * 속도계 눈금 생성 (0~120km/h, 위쪽 반원 기준)
 * 20단위는 긴 눈금, 10단위는 짧은 눈금만 표시
 * 왼쪽(180도) = 0km/h, 위쪽(270도) = 60km/h, 오른쪽(0도) = 120km/h
 */
function generateSpeedometerTicks() {
  let ticks = '';
  const centerX = 100;
  const centerY = 20; // 위쪽 반원 중심
  const radius = 80;
  const maxSpeed = 120;
  
  // 0~120km/h, 10km/h 간격
  // 왼쪽(180도, 0km/h)에서 시작해서 위쪽(270도, 60km/h)를 거쳐 오른쪽(0도, 120km/h)까지
  for (let speed = 0; speed <= maxSpeed; speed += 10) {
    // 각도 계산: 180도에서 시작해서 270도를 거쳐 0도(360도)로
    // speed = 0 → 180도, speed = 60 → 270도, speed = 120 → 0도(360도)
    let angle = 180 - (speed / maxSpeed) * 180;
    if (angle < 0) angle += 360; // 음수 각도를 360도 더해서 양수로 변환
    
    const rad = (angle * Math.PI) / 180;
    
    // 바늘 방향으로 눈금 표시 (중심에서 바깥쪽으로)
    // x1, y1: 안쪽 시작점, x2, y2: 바깥쪽 끝점
    const innerRadius = radius - 8; // 안쪽 시작점
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    
    // 주요 눈금 (20km/h 간격)은 길게, 10단위는 짧게
    const isMajor = speed % 20 === 0;
    const tickLength = isMajor ? 12 : 6;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    
    // 흰색 눈금
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                    stroke="#ffffff" 
                    stroke-width="${isMajor ? 2 : 1}"/>`;
  }
  
  return ticks;
}

/**
 * 속도계 라벨 생성 (0~120km/h, 20단위만 표시, 위쪽 반원 기준)
 * 반원의 둘레에 숫자가 닿지 않도록 약간의 간격 유지
 * 왼쪽(180도) = 0km/h, 위쪽(270도) = 60km/h, 오른쪽(0도) = 120km/h
 */
function generateSpeedometerLabels() {
  let labels = '';
  const centerX = 100;
  const centerY = 20; // 위쪽 반원 중심
  const radius = 80;
  const maxSpeed = 120;
  
  // 주요 속도 표시 (0, 20, 40, 60, 80, 100, 120) - 20단위만
  const speeds = [0, 20, 40, 60, 80, 100, 120];
  
  speeds.forEach(speed => {
    // 각도 계산: 180도에서 시작해서 270도를 거쳐 0도(360도)로
    // speed = 0 → 180도, speed = 60 → 270도, speed = 120 → 0도(360도)
    let angle = 180 - (speed / maxSpeed) * 180;
    if (angle < 0) angle += 360; // 음수 각도를 360도 더해서 양수로 변환
    
    const rad = (angle * Math.PI) / 180;
    
    // 반원 바깥쪽에 배치, 숫자가 닿지 않도록 간격 유지 (radius + 15)
    const labelRadius = radius + 15;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    
    // 흰색 숫자
    labels += `<text x="${x}" y="${y}" 
                     text-anchor="middle" 
                     dominant-baseline="middle"
                     fill="#ffffff" 
                     font-size="14" 
                     font-weight="600">${speed}</text>`;
  });
  
  return labels;
}

/**
 * 속도계 바늘 업데이트 (애니메이션 포함, 0~120km/h, 위쪽 반원 기준)
 * 왼쪽(180도) = 0km/h, 위쪽(270도) = 60km/h, 오른쪽(0도) = 120km/h
 */
function updateSpeedometerNeedle(speedometerId, speed) {
  const needle = document.getElementById(`needle-${speedometerId}`);
  if (!needle) return;
  
  // 각도 계산: 180도에서 시작해서 270도를 거쳐 0도(360도)로
  // speed = 0 → 180도, speed = 60 → 270도, speed = 120 → 0도(360도)
  const maxSpeed = 120;
  let angle = 180 - (speed / maxSpeed) * 180;
  if (angle < 0) angle += 360; // 음수 각도를 360도 더해서 양수로 변환
  
  // 부드러운 애니메이션을 위해 transition 적용
  // 위쪽 반원 중심 (100, 20) 기준으로 회전
  needle.style.transition = 'transform 0.3s ease-out';
  needle.setAttribute('transform', `rotate(${angle} 100 20)`);
}

/**
 * 속도계 데이터 업데이트
 */
function updateSpeedometerData(speedometerId, speed, distance) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  speedometer.currentSpeed = speed;
  speedometer.totalDistance = distance;
  speedometer.lastUpdateTime = Date.now();
  
  // UI 업데이트
  const speedValueEl = document.getElementById(`speed-value-${speedometerId}`);
  const distanceValueEl = document.getElementById(`distance-value-${speedometerId}`);
  
  if (speedValueEl) speedValueEl.textContent = speed.toFixed(1);
  if (distanceValueEl) distanceValueEl.textContent = distance.toFixed(2);
  
  // 바늘 업데이트
  updateSpeedometerNeedle(speedometerId, speed);
  
  // 순위 업데이트
  updateRankings();
  
  // 전체 통계 업데이트
  updateDashboardStats();
}

/**
 * 순위 업데이트
 */
function updateRankings() {
  // 누적거리 기준으로 정렬
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  
  // 순위 UI 업데이트
  sorted.forEach((speedometer, index) => {
    const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
    if (rankEl) {
      rankEl.textContent = index + 1;
    }
  });
  
  // 연결되지 않았거나 거리가 0인 속도계는 순위 표시 안 함
  window.rollerRaceState.speedometers.forEach(speedometer => {
    if (!speedometer.connected || speedometer.totalDistance === 0) {
      const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
      if (rankEl) {
        rankEl.textContent = '-';
      }
    }
  });
}

/**
 * 대시보드 통계 업데이트
 */
function updateDashboardStats() {
  const totalDistance = window.rollerRaceState.speedometers
    .reduce((sum, s) => sum + s.totalDistance, 0);
  
  const activeRiders = window.rollerRaceState.speedometers
    .filter(s => s.connected && s.currentSpeed > 0).length;
  
  const totalDistanceEl = document.getElementById('totalDistance');
  const activeRidersEl = document.getElementById('activeRiders');
  
  if (totalDistanceEl) totalDistanceEl.textContent = totalDistance.toFixed(2);
  if (activeRidersEl) activeRidersEl.textContent = activeRiders;
}

/**
 * 경과시간 업데이트
 */
function updateElapsedTime() {
  if (window.rollerRaceState.raceState !== 'running') return;
  
  const now = Date.now();
  const elapsed = Math.floor((now - window.rollerRaceState.startTime - window.rollerRaceState.pausedTime) / 1000);
  
  window.rollerRaceState.totalElapsedTime = elapsed;
  
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  const elapsedTimeEl = document.getElementById('elapsedTime');
  if (elapsedTimeEl) elapsedTimeEl.textContent = timeString;
  
  // 경기 종료 조건 확인
  checkRaceEndConditions();
}

/**
 * 경기 종료 조건 확인
 */
function checkRaceEndConditions() {
  const settings = window.rollerRaceState.raceSettings;
  let shouldEnd = false;
  
  if (settings.endByDistance) {
    const totalDistance = window.rollerRaceState.speedometers
      .reduce((sum, s) => sum + s.totalDistance, 0);
    if (totalDistance >= settings.targetDistance) {
      shouldEnd = true;
      console.log(`[경기 종료] 목표 거리 달성: ${totalDistance.toFixed(2)}km >= ${settings.targetDistance}km`);
    }
  }
  
  if (settings.endByTime) {
    const elapsedMinutes = window.rollerRaceState.totalElapsedTime / 60;
    if (elapsedMinutes >= settings.targetTime) {
      shouldEnd = true;
      console.log(`[경기 종료] 목표 시간 달성: ${elapsedMinutes.toFixed(1)}분 >= ${settings.targetTime}분`);
    }
  }
  
  if (shouldEnd) {
    stopRace();
    if (typeof showToast === 'function') {
      showToast('경기가 종료되었습니다!');
    }
  }
}

/**
 * 경기 시작
 */
function startRace() {
  if (window.rollerRaceState.raceState === 'running') return;
  
  console.log('[경기 시작]');
  
  // 일시정지 상태에서 재개
  if (window.rollerRaceState.raceState === 'paused') {
    const now = Date.now();
    window.rollerRaceState.pausedTime += now - window.rollerRaceState.pauseStartTime;
    window.rollerRaceState.raceState = 'running';
  } else {
    // 새 경기 시작
    window.rollerRaceState.startTime = Date.now();
    window.rollerRaceState.pausedTime = 0;
    window.rollerRaceState.raceState = 'running';
    
    // 모든 속도계 거리 초기화
    window.rollerRaceState.speedometers.forEach(s => {
      s.totalDistance = 0;
      s.currentSpeed = 0;
    });
  }
  
  // 타이머 시작
  window.rollerRaceTimer = setInterval(updateElapsedTime, 1000);
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  
  if (btnStart) btnStart.disabled = true;
  if (btnPause) btnPause.disabled = false;
  if (btnStop) btnStop.disabled = false;
  
  if (typeof showToast === 'function') {
    showToast('경기가 시작되었습니다!');
  }
}

/**
 * 경기 일시정지
 */
function pauseRace() {
  if (window.rollerRaceState.raceState !== 'running') return;
  
  console.log('[경기 일시정지]');
  
  window.rollerRaceState.raceState = 'paused';
  window.rollerRaceState.pauseStartTime = Date.now();
  
  // 타이머 정지
  if (window.rollerRaceTimer) {
    clearInterval(window.rollerRaceTimer);
    window.rollerRaceTimer = null;
  }
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  
  if (btnStart) btnStart.disabled = false;
  if (btnPause) btnPause.disabled = true;
  
  if (typeof showToast === 'function') {
    showToast('경기가 일시정지되었습니다.');
  }
}

/**
 * 경기 종료
 */
function stopRace() {
  console.log('[경기 종료]');
  
  window.rollerRaceState.raceState = 'finished';
  
  // 타이머 정지
  if (window.rollerRaceTimer) {
    clearInterval(window.rollerRaceTimer);
    window.rollerRaceTimer = null;
  }
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  
  if (btnStart) btnStart.disabled = false;
  if (btnPause) btnPause.disabled = true;
  if (btnStop) btnStop.disabled = true;
  
  // 최종 순위 표시
  updateRankings();
  
  if (typeof showToast === 'function') {
    showToast('경기가 종료되었습니다.');
  }
}

/**
 * 속도계 페어링
 */
async function pairSpeedometer(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  console.log(`[속도계 페어링] ${speedometer.name} (ID: ${speedometerId})`);
  
  // ANT+ 연결 로직 (실제 구현 필요)
  // 여기서는 시뮬레이션
  if (typeof connectANTSpeedometer === 'function') {
    try {
      const device = await connectANTSpeedometer(speedometer.deviceId);
      if (device) {
        speedometer.connected = true;
        speedometer.deviceId = device.id;
        updateSpeedometerConnectionStatus(speedometerId, true);
        
        if (typeof showToast === 'function') {
          showToast(`${speedometer.name} 연결 완료`);
        }
      }
    } catch (error) {
      console.error('[속도계 페어링 오류]', error);
      if (typeof showToast === 'function') {
        showToast(`${speedometer.name} 연결 실패: ${error.message}`);
      }
    }
  } else {
    // 시뮬레이션 모드
    speedometer.connected = true;
    updateSpeedometerConnectionStatus(speedometerId, true);
    
    // 시뮬레이션 데이터 시작
    startSpeedometerSimulation(speedometerId);
    
    if (typeof showToast === 'function') {
      showToast(`${speedometer.name} 연결 완료 (시뮬레이션)`);
    }
  }
}

/**
 * 속도계 연결 상태 UI 업데이트
 */
function updateSpeedometerConnectionStatus(speedometerId, connected) {
  const statusEl = document.getElementById(`status-${speedometerId}`);
  if (!statusEl) return;
  
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');
  
  // 속도계 정보 블록 찾기
  const container = document.getElementById(`speedometer-${speedometerId}`);
  const infoBlock = container ? container.querySelector('.speedometer-info') : null;
  
  if (connected) {
    dot.classList.remove('disconnected');
    dot.classList.add('connected');
    if (text) text.textContent = '연결됨';
    
    // 연결됨: 연두색 배경으로 변경
    if (infoBlock) {
      infoBlock.classList.add('connected');
      infoBlock.classList.remove('disconnected');
    }
  } else {
    dot.classList.remove('connected');
    dot.classList.add('disconnected');
    if (text) text.textContent = '미연결';
    
    // 미연결: 주황색 배경으로 변경
    if (infoBlock) {
      infoBlock.classList.remove('connected');
      infoBlock.classList.add('disconnected');
    }
  }
}

/**
 * 속도계 시뮬레이션 (테스트용)
 */
function startSpeedometerSimulation(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  // 시뮬레이션 인터벌
  const interval = setInterval(() => {
    if (!speedometer.connected) {
      clearInterval(interval);
      return;
    }
    
    // 랜덤 속도 생성 (20~50 km/h)
    const speed = 20 + Math.random() * 30;
    const distanceIncrement = (speed / 3600) * (1 / 60); // 1초당 거리 증가 (km)
    
    speedometer.currentSpeed = speed;
    speedometer.totalDistance += distanceIncrement;
    
    updateSpeedometerData(speedometerId, speed, speedometer.totalDistance);
  }, 1000); // 1초마다 업데이트
  
  speedometer.simulationInterval = interval;
}

/**
 * 속도계 목록 UI 업데이트
 */
function updateSpeedometerListUI() {
  const listEl = document.getElementById('speedometerList');
  if (!listEl) return;
  
  listEl.innerHTML = '';
  
  window.rollerRaceState.speedometers.forEach(speedometer => {
    const item = document.createElement('div');
    item.className = 'speedometer-list-item';
    item.innerHTML = `
      <div class="list-item-info">
        <span class="list-item-name">${speedometer.name}</span>
        <span class="list-item-id">ID: ${speedometer.deviceId || '미설정'}</span>
      </div>
      <div class="list-item-actions">
        <button class="btn btn-sm btn-primary" onclick="pairSpeedometer(${speedometer.id})">
          페어링
        </button>
        <button class="btn btn-sm btn-danger" onclick="removeSpeedometer(${speedometer.id})">
          삭제
        </button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

/**
 * 속도계 추가 모달 표시
 */
function showAddSpeedometerModal() {
  const modal = document.getElementById('addSpeedometerModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

/**
 * 속도계 추가 모달 닫기
 */
function closeAddSpeedometerModal() {
  const modal = document.getElementById('addSpeedometerModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // 입력 필드 초기화
  const nameInput = document.getElementById('speedometerName');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  if (nameInput) nameInput.value = '';
  if (deviceIdInput) deviceIdInput.value = '';
}

/**
 * 속도계 추가
 */
function addSpeedometer() {
  const nameInput = document.getElementById('speedometerName');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  
  if (!nameInput || !nameInput.value.trim()) {
    if (typeof showToast === 'function') {
      showToast('속도계 이름을 입력해주세요.');
    }
    return;
  }
  
  const name = nameInput.value.trim();
  const deviceId = deviceIdInput ? deviceIdInput.value.trim() : null;
  
  // 빈 슬롯 찾기 또는 새로 추가
  let speedometer;
  const emptySlot = window.rollerRaceState.speedometers.findIndex(s => !s.name || s.name.startsWith('속도계 ') && !s.deviceId);
  
  if (emptySlot >= 0 && emptySlot < 10) {
    speedometer = window.rollerRaceState.speedometers[emptySlot];
    speedometer.name = name;
    speedometer.deviceId = deviceId;
  } else {
    // 10개 초과 시 목록에만 추가 (화면에는 표시 안 됨)
    const newId = window.rollerRaceState.speedometers.length + 1;
    speedometer = new SpeedometerData(newId, name, deviceId);
    window.rollerRaceState.speedometers.push(speedometer);
  }
  
  // 저장
  saveSpeedometerList();
  
  // UI 업데이트
  updateSpeedometerListUI();
  createSpeedometerGrid();
  
  closeAddSpeedometerModal();
  
  if (typeof showToast === 'function') {
    showToast(`${name} 속도계가 추가되었습니다.`);
  }
}

/**
 * 속도계 삭제
 */
function removeSpeedometer(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  if (confirm(`${speedometer.name} 속도계를 삭제하시겠습니까?`)) {
    // 연결 해제
    if (speedometer.connected) {
      speedometer.connected = false;
      if (speedometer.simulationInterval) {
        clearInterval(speedometer.simulationInterval);
      }
    }
    
    // 기본값으로 리셋
    speedometer.name = `속도계 ${speedometerId}`;
    speedometer.deviceId = null;
    speedometer.currentSpeed = 0;
    speedometer.totalDistance = 0;
    
    // 저장
    saveSpeedometerList();
    
    // UI 업데이트
    updateSpeedometerListUI();
    createSpeedometerGrid();
    
    if (typeof showToast === 'function') {
      showToast('속도계가 삭제되었습니다.');
    }
  }
}

/**
 * 속도계 목록 저장
 */
function saveSpeedometerList() {
  try {
    const data = window.rollerRaceState.speedometers.map(s => ({
      id: s.id,
      name: s.name,
      deviceId: s.deviceId
    }));
    localStorage.setItem('rollerRaceSpeedometers', JSON.stringify(data));
  } catch (error) {
    console.error('[속도계 목록 저장 오류]', error);
  }
}

/**
 * 속도계 목록 로드
 */
function loadSpeedometerList() {
  try {
    const data = localStorage.getItem('rollerRaceSpeedometers');
    if (data) {
      const list = JSON.parse(data);
      list.forEach(item => {
        const speedometer = new SpeedometerData(item.id, item.name, item.deviceId);
        window.rollerRaceState.speedometers[item.id - 1] = speedometer;
      });
    }
  } catch (error) {
    console.error('[속도계 목록 로드 오류]', error);
  }
  
  // 10개 미만이면 기본값으로 채우기
  for (let i = 0; i < 10; i++) {
    if (!window.rollerRaceState.speedometers[i]) {
      window.rollerRaceState.speedometers[i] = new SpeedometerData(i + 1, `속도계 ${i + 1}`);
    }
  }
}

/**
 * 경기 설정 저장
 */
function saveRaceSettings() {
  const endByDistance = document.getElementById('endByDistance');
  const targetDistance = document.getElementById('targetDistance');
  const endByTime = document.getElementById('endByTime');
  const targetTime = document.getElementById('targetTime');
  
  if (endByDistance) window.rollerRaceState.raceSettings.endByDistance = endByDistance.checked;
  if (targetDistance) window.rollerRaceState.raceSettings.targetDistance = parseFloat(targetDistance.value) || 10;
  if (endByTime) window.rollerRaceState.raceSettings.endByTime = endByTime.checked;
  if (targetTime) window.rollerRaceState.raceSettings.targetTime = parseInt(targetTime.value) || 60;
  
  try {
    localStorage.setItem('rollerRaceSettings', JSON.stringify(window.rollerRaceState.raceSettings));
  } catch (error) {
    console.error('[경기 설정 저장 오류]', error);
  }
  
  closeRaceSettingsModal();
  
  if (typeof showToast === 'function') {
    showToast('경기 설정이 저장되었습니다.');
  }
}

/**
 * 경기 설정 로드
 */
function loadRaceSettings() {
  try {
    const data = localStorage.getItem('rollerRaceSettings');
    if (data) {
      window.rollerRaceState.raceSettings = { ...window.rollerRaceState.raceSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[경기 설정 로드 오류]', error);
  }
}

/**
 * 경기 설정 모달 닫기
 */
function closeRaceSettingsModal() {
  const modal = document.getElementById('raceSettingsModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// 화면 전환 시 초기화
if (typeof window.showScreen === 'function') {
  const originalShowScreen = window.showScreen;
  window.showScreen = function(id, skipHistory) {
    originalShowScreen(id, skipHistory);
    
    if (id === 'rollerRaceDashboardScreen') {
      setTimeout(() => {
        initRollerRaceDashboard();
      }, 100);
    }
  };
}

