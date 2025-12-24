/**
 * 실내 평로라 대회 대시보드
 * ANT+ 1:N 연결로 최대 15개 속도계 센서 관리
 */

// 바퀴 규격 데이터 (로드바이크 700C 휠셋)
const WHEEL_SPECS = {
  '23-622': {
    etrto: '23-622',
    size: '700 x 23C',
    circumference: 2096, // mm
    description: '구형 로드, 트랙'
  },
  '25-622': {
    etrto: '25-622',
    size: '700 x 25C',
    circumference: 2105, // mm
    description: '로드 표준'
  },
  '28-622': {
    etrto: '28-622',
    size: '700 x 28C',
    circumference: 2136, // mm
    description: '엔듀런스, 최신 로드'
  },
  '32-622': {
    etrto: '32-622',
    size: '700 x 32C',
    circumference: 2155, // mm
    description: '그래블, 하이브리드'
  }
};

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
    targetTime: 60, // minutes
    wheelSize: '25-622' // 기본값: 700 x 25C
  },
  rankings: [], // 순위 정보
  rankDisplayStartIndex: 0, // 전광판 순위 표시 시작 인덱스
  rankDisplayTimer: null // 순위 표시 순환 타이머
};

// ANT+ 통신 관련 전역 상태
window.antState = {
  usbDevice: null, // Web USB 디바이스
  inEndpoint: null, // 입력 엔드포인트
  outEndpoint: null, // 출력 엔드포인트
  isScanning: false, // 스캔 중 여부
  scanChannel: null, // 스캔 채널 번호
  foundDevices: [], // 검색된 디바이스 목록
  connectedChannels: {}, // 연결된 채널 (deviceId -> channelNumber)
  messageBuffer: [] // 메시지 버퍼 (여러 패킷으로 나뉜 메시지 처리용)
};

// ANT+ 채널 설정
const ANT_CHANNEL_CONFIG = {
  MAX_CHANNELS: 15, // 최대 동시 연결 채널 수 (스캔 채널 0번 제외, 1-15번 사용)
  SCAN_CHANNEL: 0, // 스캔용 채널 번호
  MIN_CHANNEL: 1, // 사용 가능한 최소 채널 번호
  MAX_CHANNEL: 15 // 사용 가능한 최대 채널 번호
};

// 속도계 데이터 구조
class SpeedometerData {
  constructor(id, name, deviceId = null) {
    this.id = id;
    this.name = name;
    this.deviceId = deviceId;
    this.connected = false;
    this.currentSpeed = 0; // km/h
    this.maxSpeed = 0; // km/h
    this.averageSpeed = 0; // km/h
    this.totalDistance = 0; // km
    this.totalRevolutions = 0; // 총 회전수
    this.lastUpdateTime = null;
    this.lastRevolutions = 0; // 마지막 회전수 (CSC 센서에서)
    this.speedHistory = []; // 최근 속도 기록 (그래프용)
    this.speedSum = 0; // 평균 속도 계산용
    this.speedCount = 0; // 평균 속도 계산용
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
  
  // 전광판 초기화
  const scoreboardTimeEl = document.getElementById('scoreboardTime');
  const scoreboardDistanceEl = document.getElementById('scoreboardDistance');
  const scoreboardRidersEl = document.getElementById('scoreboardRiders');
  if (scoreboardTimeEl) scoreboardTimeEl.textContent = '00:00:00';
  if (scoreboardDistanceEl) scoreboardDistanceEl.textContent = '0.0';
  if (scoreboardRidersEl) scoreboardRidersEl.textContent = '0';
  
  // 순위 표시 초기화
  window.rollerRaceState.rankDisplayStartIndex = 0;
  stopRankDisplayRotation();
  
  // 초기 순위 표시 (고정된 상자 생성)
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  updateScoreboardRankings(sorted, false);
  updateRankDisplay(false);
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
      <div class="connection-status-center" id="status-${speedometer.id}">
        <span class="status-dot disconnected"></span>
        <span class="status-text">미연결</span>
      </div>
      <button class="btn-pair btn-pair-sm" onclick="pairSpeedometer(${speedometer.id})" title="페어링">
        <img src="assets/img/wifi.png" alt="페어링" style="width: 16px; height: 16px;">
      </button>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 200">
        <!-- 아래쪽 반원 배경 (원지름의 1/4만큼 아래로 이동) -->
        <path class="speedometer-arc-bg" d="M 20 140 A 80 80 0 0 1 180 140" 
              fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5"/>
        
        <!-- 속도 눈금 (0~120km/h) -->
        <g class="speedometer-ticks">
          ${generateSpeedometerTicks()}
        </g>
        
        <!-- 속도 숫자 (반원 바깥쪽, 20단위만) -->
        <g class="speedometer-labels">
          ${generateSpeedometerLabels()}
        </g>
        
        <!-- 바늘 중심 원 (고정) -->
        <circle cx="100" cy="140" r="7" fill="#000000" stroke="#ff0000" stroke-width="2"/>
        
        <!-- 바늘 (원의 중심에 위치, 원지름의 1/4만큼 아래로 이동, 초기 위치: 270도) -->
        <!-- 바늘은 원의 위쪽 가장자리에서 시작하여 원 안에 보이지 않게 함 -->
        <g class="speedometer-needle" transform="translate(100, 140)">
          <line id="needle-${speedometer.id}" 
                x1="0" y1="-7" 
                x2="0" y2="-80" 
                stroke="#ff0000" 
                stroke-width="3" 
                stroke-linecap="round"
                transform="rotate(270)"/>
        </g>
        
        <!-- km/h 라벨 (바늘 중심 아래, 바늘에 붙지 않게 간격 유지, 문자 높이의 1/2만큼 아래로 이동) -->
        <text x="100" y="155" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="10" 
              font-weight="500">km/h</text>
      </svg>
      <!-- 순위 표시 (속도계 검은 바탕 하단 중앙) -->
      <div class="rank-display-bottom">
        <img class="rank-value-bottom" id="rank-value-${speedometer.id}" src="" alt="" style="display: none;" />
      </div>
    </div>
    <div class="speedometer-info disconnected">
      <!-- 좌측: 최대속도, 평균속도 (2줄) -->
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
      <!-- 중앙: 현재속도 (단위는 하단에 표시) -->
      <div class="speed-display-center">
        <div class="speed-value-wrapper">
          <span class="speed-value" id="speed-value-${speedometer.id}">0</span>
          <div class="speed-unit-bottom">km/h</div>
        </div>
      </div>
      <!-- 우측: 거리 -->
      <div class="distance-display-right">
        <span class="distance-value" id="distance-value-${speedometer.id}">0.0</span>
        <sup class="distance-unit-sup">km</sup>
      </div>
    </div>
  `;
  
  return container;
}

/**
 * 속도계 눈금 생성 (0~120km/h, 자동차 속도계 스타일)
 * 모든 눈금 표시 (5km/h 간격), 20단위는 긴 눈금, 나머지는 짧은 눈금
 * 원 중심으로 180도 회전
 * 하단 왼쪽(180도) = 0km/h, 위쪽(90도) = 60km/h, 하단 오른쪽(0도) = 120km/h
 * 원지름의 1/4만큼 아래로 이동
 */
function generateSpeedometerTicks() {
  let ticks = '';
  const centerX = 100;
  const centerY = 140; // 원의 중심 (원지름의 1/4만큼 아래로 이동: 100 + 40 = 140)
  const radius = 80;
  const maxSpeed = 120;
  
  // 0~120km/h, 5km/h 간격으로 모든 눈금 표시
  // 하단 왼쪽(180도, 0km/h)에서 시작해서 위쪽(90도, 60km/h)를 거쳐 하단 오른쪽(0도, 120km/h)까지
  for (let speed = 0; speed <= maxSpeed; speed += 5) {
    // 각도 계산: 180도에서 시작해서 90도를 거쳐 0도로, 그 다음 180도 회전
    // speed = 0 → 180도 (하단 왼쪽), speed = 60 → 90도 (위쪽), speed = 120 → 0도 (하단 오른쪽)
    // 180도 회전: 각도에 180도 추가
    let angle = 180 - (speed / maxSpeed) * 180;
    angle = angle + 180; // 원 중심으로 180도 회전
    
    const rad = (angle * Math.PI) / 180;
    
    // 반원의 곡선 부분에 눈금 표시 (자동차 속도계 스타일)
    // 눈금은 반원의 곡선을 따라 안쪽에서 바깥쪽으로
    const innerRadius = radius - 10; // 안쪽 시작점
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    
    // 주요 눈금 (20km/h 간격)은 길게, 나머지는 짧게
    const isMajor = speed % 20 === 0;
    const tickLength = isMajor ? 14 : 7;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    
    // 흰색 눈금 (자동차 속도계 스타일)
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                    stroke="#ffffff" 
                    stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
  }
  
  return ticks;
}

/**
 * 속도계 라벨 생성 (0~120km/h, 20단위만 표시, 자동차 속도계 스타일)
 * 원 중심으로 180도 회전
 * 반원의 둘레에 숫자가 닿지 않도록 약간의 간격 유지
 * 하단 왼쪽(180도) = 0km/h, 위쪽(90도) = 60km/h, 하단 오른쪽(0도) = 120km/h
 * 원지름의 1/4만큼 아래로 이동
 */
function generateSpeedometerLabels() {
  let labels = '';
  const centerX = 100;
  const centerY = 140; // 원의 중심 (원지름의 1/4만큼 아래로 이동: 100 + 40 = 140)
  const radius = 80;
  const maxSpeed = 120;
  
  // 주요 속도 표시 (0, 20, 40, 60, 80, 100, 120) - 20단위만
  const speeds = [0, 20, 40, 60, 80, 100, 120];
  
  speeds.forEach(speed => {
    // 각도 계산: 180도에서 시작해서 90도를 거쳐 0도로, 그 다음 180도 회전
    // speed = 0 → 180도 (하단 왼쪽), speed = 60 → 90도 (위쪽), speed = 120 → 0도 (하단 오른쪽)
    // 180도 회전: 각도에 180도 추가
    let angle = 180 - (speed / maxSpeed) * 180;
    angle = angle + 180; // 원 중심으로 180도 회전
    
    const rad = (angle * Math.PI) / 180;
    
    // 반원 바깥쪽에 배치, 숫자가 닿지 않도록 간격 유지 (자동차 속도계 스타일)
    const labelRadius = radius + 18;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    
    // 숫자 역순 표시: 120 → 0, 100 → 20, 80 → 40, 60 → 60, 40 → 80, 20 → 100, 0 → 120
    const displayValue = maxSpeed - speed;
    
    // 흰색 숫자 (자동차 속도계 스타일)
    labels += `<text x="${x}" y="${y}" 
                     text-anchor="middle" 
                     dominant-baseline="middle"
                     fill="#ffffff" 
                     font-size="15" 
                     font-weight="700">${displayValue}</text>`;
  });
  
  return labels;
}

/**
 * 속도계 바늘 업데이트 (애니메이션 포함, 0~120km/h)
 * 바늘 각도 계산: 270도 + 180도*(속도/120)
 * 속도 0 → 270도 (초기 위치), 속도 60 → 360도(0도), 속도 120 → 450도(90도)
 * 바늘 중심: 원의 중심 (100, 140) - 원지름의 1/4만큼 아래로 이동
 */
function updateSpeedometerNeedle(speedometerId, speed) {
  const needle = document.getElementById(`needle-${speedometerId}`);
  if (!needle) return;
  
  const maxSpeed = 120;
  
  // 바늘 각도 계산: 270도 + 180도*(속도/120)
  // speed = 0 → angle = 270도 (초기 위치)
  // speed = 60 → angle = 270 + 90 = 360도 (0도)
  // speed = 120 → angle = 270 + 180 = 450도 (90도)
  let angle = 270 + 180 * (speed / maxSpeed);
  
  // 360도 이상인 경우 정규화 (450도 → 90도)
  if (angle >= 360) angle = angle - 360;
  
  // 부드러운 애니메이션을 위해 transition 적용
  // 그룹이 이미 translate(100, 140)로 이동되어 있으므로, 바늘은 원점(0,0) 기준으로 회전
  needle.style.transition = 'transform 0.3s ease-out';
  needle.setAttribute('transform', `rotate(${angle})`);
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
  
  // 최대속도 업데이트
  if (speed > speedometer.maxSpeed) {
    speedometer.maxSpeed = speed;
  }
  
  // 평균속도 계산 (누적 평균)
  if (speed > 0) {
    speedometer.speedSum += speed;
    speedometer.speedCount += 1;
    speedometer.averageSpeed = speedometer.speedSum / speedometer.speedCount;
  }
  
  // UI 업데이트
  const speedValueEl = document.getElementById(`speed-value-${speedometerId}`);
  const maxSpeedValueEl = document.getElementById(`max-speed-value-${speedometerId}`);
  const avgSpeedValueEl = document.getElementById(`avg-speed-value-${speedometerId}`);
  const distanceValueEl = document.getElementById(`distance-value-${speedometerId}`);
  
  if (speedValueEl) speedValueEl.textContent = speed.toFixed(1);
  if (maxSpeedValueEl) maxSpeedValueEl.textContent = speedometer.maxSpeed.toFixed(1);
  if (avgSpeedValueEl) avgSpeedValueEl.textContent = speedometer.averageSpeed.toFixed(1);
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
  
  // 연결되지 않았거나 거리가 0인 속도계는 순위 표시 안 함
  window.rollerRaceState.speedometers.forEach(speedometer => {
    if (!speedometer.connected || speedometer.totalDistance === 0) {
      const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
      if (rankEl) {
        rankEl.style.display = 'none';
      }
    }
  });
  
  // 전광판 순위 목록 데이터 업데이트 (표시는 별도로 처리)
  updateScoreboardRankings(sorted, false);
}

/**
 * 전광판 순위 목록 생성 및 업데이트
 * @param {Array} sorted - 정렬된 속도계 목록
 * @param {boolean} updateDisplay - 표시 업데이트 여부 (기본값: false)
 */
function updateScoreboardRankings(sorted, updateDisplay = false) {
  const ranksContainer = document.getElementById('scoreboardRanks');
  if (!ranksContainer) return;
  
  const existingItems = ranksContainer.querySelectorAll('.rank-item');
  const currentStartIndex = window.rollerRaceState.rankDisplayStartIndex;
  const displayCount = Math.min(3, sorted.length);
  
  // 항상 3개의 고정된 상자 유지
  if (existingItems.length === 0) {
    // 초기 생성: 3개의 고정된 상자 생성
    for (let i = 0; i < 3; i++) {
      const rankItem = document.createElement('div');
      rankItem.className = 'rank-item';
      rankItem.dataset.slotIndex = i;
      rankItem.innerHTML = `
        <div class="rank-item-content">
          <img class="rank-number" src="" alt="" style="display: none;" />
          <span class="rank-name">-</span>
          <span class="rank-distance">0.0km</span>
        </div>
      `;
      ranksContainer.appendChild(rankItem);
    }
  }
  
  // 데이터만 업데이트 (텍스트 내용만 변경, 상자는 고정)
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
          if (rank >= 1 && rank <= 10) {
            numberEl.src = `assets/img/${rank}.png`;
            numberEl.alt = `${rank}위`;
            numberEl.style.display = 'inline-block';
          } else {
            numberEl.style.display = 'none';
          }
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
  
  // 나머지 항목 숨기기
  for (let i = displayCount; i < visibleItems.length; i++) {
    visibleItems[i].classList.remove('rank-item-visible');
  }
  
  // 표시 업데이트가 요청된 경우에만 호출 (애니메이션과 함께)
  if (updateDisplay) {
    updateRankDisplay(true);
  }
}

/**
 * 전광판 순위 표시 범위 업데이트 (순환 표시)
 * @param {boolean} withAnimation - 애니메이션 적용 여부 (기본값: true)
 */
function updateRankDisplay(withAnimation = true) {
  const ranksContainer = document.getElementById('scoreboardRanks');
  if (!ranksContainer) return;
  
  // 정렬된 순위 데이터 가져오기
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  
  const totalRanks = sorted.length;
  if (totalRanks === 0) {
    // 순위가 없을 때 빈 상태 표시
    const rankItems = ranksContainer.querySelectorAll('.rank-item');
    for (let i = 0; i < Math.min(3, rankItems.length); i++) {
      const item = rankItems[i];
      if (item) {
        const nameEl = item.querySelector('.rank-name');
        const distanceEl = item.querySelector('.rank-distance');
        const numberEl = item.querySelector('.rank-number');
        if (nameEl) nameEl.textContent = '-';
        if (distanceEl) distanceEl.textContent = '0.0km';
        if (numberEl) numberEl.style.display = 'none';
        item.classList.add('rank-item-visible');
      }
    }
    return;
  }
  
  // 표시할 순위 개수 (항상 3개)
  const displayCount = 3;
  
  // 시작 인덱스 계산 (무한 순환)
  // 예: 1~3위 → 2~4위 → ... → 마지막-2~마지막 → 마지막-1, 마지막, 1위 → 마지막, 1~2위 → 1~3위 → ...
  let startIndex = window.rollerRaceState.rankDisplayStartIndex;
  
  // 순위가 3개 이하일 때는 순환하지 않음
  if (totalRanks <= 3) {
    startIndex = 0;
    window.rollerRaceState.rankDisplayStartIndex = 0;
  }
  
  const rankItems = ranksContainer.querySelectorAll('.rank-item');
  
  // 각 고정된 상자에 데이터 업데이트 (무한 순환)
  for (let i = 0; i < Math.min(3, rankItems.length); i++) {
    const item = rankItems[i];
    
    // 순환 인덱스 계산: startIndex + i가 totalRanks를 넘어가면 0부터 다시 시작
    let targetIndex = (startIndex + i) % totalRanks;
    
    if (totalRanks > 0) {
      // 표시할 순위가 있는 경우
      const speedometer = sorted[targetIndex];
      const nameEl = item.querySelector('.rank-name');
      const distanceEl = item.querySelector('.rank-distance');
      const numberEl = item.querySelector('.rank-number');
      
      const rank = targetIndex + 1;
      if (nameEl) nameEl.textContent = speedometer.name;
      if (distanceEl) distanceEl.textContent = speedometer.totalDistance.toFixed(2) + 'km';
      if (numberEl) {
        if (rank >= 1 && rank <= 10) {
          numberEl.src = `assets/img/${rank}.png`;
          numberEl.alt = `${rank}위`;
          numberEl.style.display = 'inline-block';
        } else {
          numberEl.style.display = 'none';
        }
      }
      
      item.classList.add('rank-item-visible');
    } else {
      // 순위가 없는 경우 (빈 상자)
      const nameEl = item.querySelector('.rank-name');
      const distanceEl = item.querySelector('.rank-distance');
      const numberEl = item.querySelector('.rank-number');
      if (nameEl) nameEl.textContent = '-';
      if (distanceEl) distanceEl.textContent = '0.0km';
      if (numberEl) numberEl.style.display = 'none';
      item.classList.remove('rank-item-visible');
    }
  }
  
  // 애니메이션 적용 (2초마다만)
  if (withAnimation) {
    ranksContainer.classList.remove('rank-scroll-animation');
    // 강제 리플로우
    void ranksContainer.offsetWidth;
    ranksContainer.classList.add('rank-scroll-animation');
  }
}

/**
 * 전광판 순위 순환 타이머 시작
 */
function startRankDisplayRotation() {
  // 기존 타이머 정리
  if (window.rollerRaceState.rankDisplayTimer) {
    clearInterval(window.rollerRaceState.rankDisplayTimer);
    window.rollerRaceState.rankDisplayTimer = null;
  }
  
  // 시작 인덱스 초기화 (1~3위부터 시작)
  window.rollerRaceState.rankDisplayStartIndex = 0;
  
  // 초기 표시 (애니메이션 없이)
  updateRankDisplay(false);
  
  // 2초마다 순환 (애니메이션과 함께)
  window.rollerRaceState.rankDisplayTimer = setInterval(() => {
    // 정렬된 순위 데이터 가져오기
    const sorted = [...window.rollerRaceState.speedometers]
      .filter(s => s.connected && s.totalDistance > 0)
      .sort((a, b) => b.totalDistance - a.totalDistance);
    
    const totalRanks = sorted.length;
    
    if (totalRanks === 0) {
      // 순위가 없으면 업데이트하지 않음
      return;
    }
    
    // 다음 시작 인덱스로 이동 (무한 순환)
    if (totalRanks > 3) {
      // 순위가 3개 초과일 때: 1씩 증가, totalRanks를 넘어가면 0부터 다시 시작
      // 예: 1~3위 → 2~4위 → ... → 마지막-2~마지막 → 마지막-1, 마지막, 1위 → 마지막, 1~2위 → 1~3위 → ...
      window.rollerRaceState.rankDisplayStartIndex += 1;
      // totalRanks를 넘어가면 0부터 다시 시작 (무한 순환)
      if (window.rollerRaceState.rankDisplayStartIndex >= totalRanks) {
        window.rollerRaceState.rankDisplayStartIndex = 0;
      }
    } else {
      // 순위가 3개 이하일 때: 순환하지 않고 항상 처음부터 표시
      // (1~2위 또는 1~3위만 표시)
      window.rollerRaceState.rankDisplayStartIndex = 0;
    }
    
    // 애니메이션과 함께 업데이트
    updateRankDisplay(true);
  }, 5000); // 5초
}

/**
 * 전광판 순위 순환 타이머 정지
 */
function stopRankDisplayRotation() {
  if (window.rollerRaceState.rankDisplayTimer) {
    clearInterval(window.rollerRaceState.rankDisplayTimer);
    window.rollerRaceState.rankDisplayTimer = null;
  }
}

/**
 * 대시보드 통계 업데이트
 */
function updateDashboardStats() {
  const totalDistance = window.rollerRaceState.speedometers
    .reduce((sum, s) => sum + s.totalDistance, 0);
  
  // 전광판 업데이트
  const scoreboardDistanceEl = document.getElementById('scoreboardDistance');
  if (scoreboardDistanceEl) scoreboardDistanceEl.textContent = totalDistance.toFixed(2);
}

/**
 * 경과시간 업데이트
 */
function updateElapsedTime() {
  // raceState 확인
  if (!window.rollerRaceState || window.rollerRaceState.raceState !== 'running') {
    return;
  }
  
  // startTime이 없으면 초기화
  if (!window.rollerRaceState.startTime) {
    window.rollerRaceState.startTime = Date.now();
    window.rollerRaceState.pausedTime = 0;
  }
  
  const now = Date.now();
  const elapsed = Math.floor((now - window.rollerRaceState.startTime - (window.rollerRaceState.pausedTime || 0)) / 1000);
  
  window.rollerRaceState.totalElapsedTime = elapsed;
  
  // 시간 형식: HH:MM:SS
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  const elapsedTimeEl = document.getElementById('elapsedTime');
  if (elapsedTimeEl) elapsedTimeEl.textContent = timeString;
  
  // 전광판 경과시간 업데이트
  const scoreboardTimeEl = document.getElementById('scoreboardTime');
  if (scoreboardTimeEl) scoreboardTimeEl.textContent = timeString;
  
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
    window.rollerRaceState.totalElapsedTime = 0;
    
    // 모든 속도계 거리 및 회전수 초기화
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
    
    // 초기 시간 표시
    const elapsedTimeEl = document.getElementById('elapsedTime');
    const scoreboardTimeEl = document.getElementById('scoreboardTime');
    if (elapsedTimeEl) elapsedTimeEl.textContent = '00:00:00';
    if (scoreboardTimeEl) scoreboardTimeEl.textContent = '00:00:00';
  }
  
  // 기존 타이머가 있으면 정리
  if (window.rollerRaceTimer) {
    clearInterval(window.rollerRaceTimer);
    window.rollerRaceTimer = null;
  }
  
  // 타이머 시작 (즉시 시작)
  updateElapsedTime(); // 즉시 한 번 실행
  window.rollerRaceTimer = setInterval(() => {
    updateElapsedTime();
  }, 1000);
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');

  if (btnStart) btnStart.disabled = true;
  if (btnPause) btnPause.disabled = false;
  if (btnStop) btnStop.disabled = false;
  
  // 전광판 순위 순환 시작
  startRankDisplayRotation();

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
  
  // 전광판 순위 순환 정지
  stopRankDisplayRotation();

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
  
  // 전광판 순위 순환 정지
  stopRankDisplayRotation();
  
  // 첫 번째 순위부터 다시 표시 (애니메이션 없이)
  window.rollerRaceState.rankDisplayStartIndex = 0;
  updateRankDisplay(false);

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
  
  // 이미 연결되어 있으면 연결 해제
  if (speedometer.connected) {
    await unpairSpeedometer(speedometerId);
    return;
  }
  
  console.log(`[속도계 페어링] ${speedometer.name} (ID: ${speedometerId})`);
  
  if (!speedometer.deviceId) {
    if (typeof showToast === 'function') {
      showToast('디바이스 ID가 설정되지 않았습니다. 속도계를 추가할 때 디바이스를 선택해주세요.');
    }
    return;
  }
  
  try {
    // ANT+ USB 스틱 연결 확인
    if (!window.antState.usbDevice) {
      await connectANTUSBStick();
    }
    
    // ANT+ 디바이스 연결
    const device = await connectANTSpeedometer(speedometer.deviceId);
    if (device) {
      speedometer.connected = true;
      speedometer.deviceId = device.id;
      window.rollerRaceState.connectedDevices[speedometer.deviceId] = device;
      updateSpeedometerConnectionStatus(speedometerId, true);
      
      if (typeof showToast === 'function') {
        showToast(`${speedometer.name} 연결 완료`);
      }
    }
  } catch (error) {
    console.error('[속도계 페어링 오류]', error);
    speedometer.connected = false;
    updateSpeedometerConnectionStatus(speedometerId, false);
    
    if (typeof showToast === 'function') {
      showToast(`${speedometer.name} 연결 실패: ${error.message || '알 수 없는 오류'}`);
    }
  }
}

/**
 * 속도계 연결 해제
 */
async function unpairSpeedometer(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer || !speedometer.connected) return;
  
  try {
    // 연결된 채널 찾기
    const channelEntry = Object.entries(window.antState.connectedChannels).find(
      ([channel, info]) => info.deviceId === speedometer.deviceId
    );
    
    if (channelEntry) {
      const [channelNumber, channelInfo] = channelEntry;
      
      // 데이터 수신 중지
      if (channelInfo.receiving) {
        channelInfo.receiving = false;
      }
      
      // 채널 닫기
      if (window.antState.usbDevice) {
        await sendANTMessage(0x4C, [parseInt(channelNumber)]); // Close Channel
      }
      
      // 연결된 채널에서 제거
      delete window.antState.connectedChannels[channelNumber];
    }
    
    // 속도계 상태 업데이트
    speedometer.connected = false;
    delete window.rollerRaceState.connectedDevices[speedometer.deviceId];
    updateSpeedometerConnectionStatus(speedometerId, false);
    
    if (typeof showToast === 'function') {
      showToast(`${speedometer.name} 연결 해제됨`);
    }
  } catch (error) {
    console.error('[속도계 연결 해제 오류]', error);
    // 오류가 발생해도 상태는 업데이트
    speedometer.connected = false;
    updateSpeedometerConnectionStatus(speedometerId, false);
  }
}

/**
 * ANT+ 속도계 연결
 */
async function connectANTSpeedometer(deviceId) {
  if (!window.antState.usbDevice) {
    throw new Error('ANT+ USB 스틱이 연결되어 있지 않습니다.');
  }
  
  const deviceNumber = parseInt(deviceId, 10);
  if (isNaN(deviceNumber)) {
    throw new Error('유효하지 않은 디바이스 ID입니다.');
  }
  
  // 사용 가능한 채널 찾기 (1-15, 스캔 채널 0번 제외)
  let channelNumber = ANT_CHANNEL_CONFIG.MIN_CHANNEL;
  while (channelNumber <= ANT_CHANNEL_CONFIG.MAX_CHANNEL && window.antState.connectedChannels[channelNumber]) {
    channelNumber++;
  }
  
  if (channelNumber > ANT_CHANNEL_CONFIG.MAX_CHANNEL) {
    throw new Error(`사용 가능한 채널이 없습니다. (최대 ${ANT_CHANNEL_CONFIG.MAX_CHANNELS}개 디바이스 연결 가능)`);
  }
  
  // 채널 할당
  await sendANTMessage(0x42, [channelNumber, 0x00]); // Assign Channel (Receive Mode)
  
  // 채널 ID 설정 (Speed/Cadence 센서)
  const deviceType = 0x79; // Speed and Cadence Sensor
  const transmissionType = 0x05; // ANT+ 표준 전송 타입
  await sendANTMessage(0x51, [
    channelNumber,
    deviceNumber & 0xFF,
    (deviceNumber >> 8) & 0xFF,
    deviceType,
    transmissionType,
    0x00 // Device Number (MSB)
  ]);
  
  // 채널 주기 설정 (4096 * 1/32768 초 = 125ms)
  await sendANTMessage(0x60, [channelNumber, 0x00, 0x10]); // Set Channel Period
  
  // 채널 RF 주파수 설정 (ANT+ 공개 주파수: 57)
  await sendANTMessage(0x45, [channelNumber, 0x39]); // Set Channel RF Frequency
  
  // 채널 열기
  await sendANTMessage(0x4B, [channelNumber]); // Open Channel
  
  // 연결된 채널 저장
  window.antState.connectedChannels[channelNumber] = {
    deviceId: deviceId,
    deviceNumber: deviceNumber,
    speedometerId: null // 나중에 설정
  };
  
  // 속도계 데이터 수신 시작
  startSpeedometerDataReceiver(channelNumber, deviceId);
  
  console.log(`[ANT+] 속도계 연결 완료: 디바이스 ${deviceId}, 채널 ${channelNumber}`);
  
  return {
    id: deviceId,
    name: `ANT+ Speed Sensor ${deviceId}`,
    channelNumber: channelNumber,
    deviceNumber: deviceNumber
  };
}

/**
 * 속도계 데이터 수신 시작
 */
function startSpeedometerDataReceiver(channelNumber, deviceId) {
  // 이미 수신 중인 경우 무시
  if (window.antState.connectedChannels[channelNumber]?.receiving) {
    return;
  }
  
  window.antState.connectedChannels[channelNumber].receiving = true;
  
  const receiveData = async () => {
    const channelInfo = window.antState.connectedChannels[channelNumber];
    if (!channelInfo || !channelInfo.receiving) {
      return;
    }
    
    try {
      const message = await receiveANTMessage();
      if (message) {
        // 브로드캐스트 데이터 처리
        if (message.messageId === 0x4E) {
          const data = message.data;
          const msgChannel = data[0];
          
          if (msgChannel === channelNumber) {
            // Speed/Cadence 데이터 파싱
            // ANT+ 브로드캐스트 메시지 구조: [Channel, Data...]
            // Speed/Cadence 데이터는 8바이트
            const speedData = data.slice(1, 9);
            if (speedData.length >= 6) {
              processSpeedCadenceData(deviceId, speedData);
            }
          }
        }
      }
    } catch (error) {
      // 연결이 끊어진 경우 오류 무시
      if (error.message && error.message.includes('연결')) {
        console.log(`[ANT+ 채널 ${channelNumber}] 연결 해제됨`);
        return;
      }
      console.error(`[ANT+ 채널 ${channelNumber}] 데이터 수신 오류:`, error);
    }
    
    // 다음 데이터 대기
    setTimeout(receiveData, 10);
  };
  
  receiveData();
}

/**
 * Speed/Cadence 데이터 처리
 */
function processSpeedCadenceData(deviceId, data) {
  // Speed/Cadence 센서 데이터 구조:
  // Byte 0-1: Event Time (LSB, MSB) - 1/1024초 단위
  // Byte 2-3: Cumulative Wheel Revolutions (LSB, MSB)
  // Byte 4-5: Last Wheel Event Time (LSB, MSB) - 1/1024초 단위
  // Byte 6-7: Cumulative Crank Revolutions (LSB, MSB) - 선택적
  
  if (data.length < 6) {
    return; // 데이터가 충분하지 않음
  }
  
  const eventTime = (data[1] << 8) | data[0];
  const wheelRevolutions = (data[3] << 8) | data[2];
  const lastWheelEventTime = (data[5] << 8) | data[4];
  
  // 해당 속도계 찾기
  const speedometer = window.rollerRaceState.speedometers.find(
    s => s.deviceId === deviceId
  );
  
  if (!speedometer) {
    return;
  }
  
  // 속도 계산
  const wheelSpec = WHEEL_SPECS[window.rollerRaceState.raceSettings.wheelSize] || WHEEL_SPECS['25-622'];
  const wheelCircumference = wheelSpec.circumference; // mm
  
  // 이전 회전수와 시간
  const prevRevolutions = speedometer.lastRevolutions || 0;
  const prevEventTime = speedometer.lastEventTime || lastWheelEventTime;
  
  // 회전수 차이
  let revolutionDelta = wheelRevolutions - prevRevolutions;
  
  // 오버플로우 처리 (65535를 넘어가면 0으로 리셋)
  if (revolutionDelta < 0) {
    revolutionDelta += 65536;
  }
  
  // 시간 차이 (1/1024초 단위)
  let timeDelta = lastWheelEventTime - prevEventTime;
  if (timeDelta < 0) {
    timeDelta += 65536;
  }
  
  // 속도 계산 (km/h)
  // 속도 = (회전수 차이 × 둘레(mm)) / (시간 차이(초) × 1000) × 3600
  let speed = 0;
  if (timeDelta > 0 && revolutionDelta > 0) {
    const timeDeltaSeconds = timeDelta / 1024.0;
    const distanceMeters = (revolutionDelta * wheelCircumference) / 1000.0;
    speed = (distanceMeters / timeDeltaSeconds) * 3.6; // m/s to km/h
  }
  
  // 데이터 업데이트
  speedometer.lastRevolutions = wheelRevolutions;
  speedometer.lastEventTime = lastWheelEventTime;
  speedometer.totalRevolutions += revolutionDelta;
  speedometer.totalDistance = calculateDistanceFromRevolutions(
    speedometer.totalRevolutions,
    wheelCircumference
  );
  speedometer.currentSpeed = speed;
  
  // UI 업데이트
  updateSpeedometerData(speedometer.id, speed, speedometer.totalDistance);
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
 * 회전수 기반 거리 계산
 * 이동 거리(km) = 총 회전수 × L(mm) / 1,000,000
 */
function calculateDistanceFromRevolutions(revolutions, wheelCircumference) {
  return (revolutions * wheelCircumference) / 1000000; // km
}

/**
 * 속도로부터 1초당 회전수 계산
 * 속도(km/h) = 회전수(rpm) × 둘레(mm) / 1,000,000 × 60
 * 1초당 회전수 = 속도(km/h) × 1,000,000 / (둘레(mm) × 3600)
 */
function calculateRevolutionsPerSecond(speed, wheelCircumference) {
  return (speed * 1000000) / (wheelCircumference * 3600);
}

/**
 * 속도계 시뮬레이션 함수 제거됨
 * 실제 ANT+ 하드웨어 연결 사용
 */

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
  
  // 디바이스 목록 초기화
  const deviceList = document.getElementById('antDeviceList');
  if (deviceList) {
    deviceList.classList.add('hidden');
    deviceList.innerHTML = '';
  }
  
  // USB 수신기 상태 확인
  checkANTUSBStatus();
  
  // 주기적으로 상태 확인 (5초마다)
  if (window.antUSBStatusInterval) {
    clearInterval(window.antUSBStatusInterval);
  }
  window.antUSBStatusInterval = setInterval(() => {
    checkANTUSBStatus();
  }, 5000);
}

/**
 * ANT+ 디바이스 검색
 * 사용자 제스처 컨텍스트를 유지하기 위해 requestDevice를 즉시 호출
 */
async function searchANTDevices() {
  const searchButton = document.getElementById('btnSearchANTDevices');
  const searchButtonText = document.getElementById('searchButtonText');
  const deviceList = document.getElementById('antDeviceList');
  
  if (!searchButton || !deviceList) return;
  
  // 검색 중 상태로 변경
  searchButton.disabled = true;
  if (searchButtonText) searchButtonText.textContent = 'USB 스틱 연결 중...';
  deviceList.classList.remove('hidden');
  deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">USB 스틱을 선택해주세요...</div>';
  
  try {
    // ANT+ USB 스틱 연결 확인 및 연결
    // 사용자 제스처가 있는 동안 즉시 requestDevice 호출
    if (!window.antState.usbDevice) {
      // 사용자 제스처 컨텍스트에서 즉시 requestDevice 호출
      // await를 사용하지만 호출 자체는 동기적으로 실행됨
      const devicePromise = requestANTUSBDevice();
      await connectANTUSBStickWithDevice(devicePromise);
    }
    
    // USB 스틱 연결 후 검색 시작
    if (searchButtonText) searchButtonText.textContent = '디바이스 검색 중...';
    deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">ANT+ 디바이스를 검색하는 중...</div>';
    
    // 디바이스 검색 시작
    const devices = await scanANTDevices();
    
    // 검색 결과 표시
    if (devices.length > 0) {
      displayANTDevices(devices);
    } else {
      deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">검색된 디바이스가 없습니다.<br>디바이스가 켜져 있고 페어링 모드인지 확인하세요.</div>';
    }
  } catch (error) {
    console.error('[ANT+ 디바이스 검색 오류]', error);
    
    // SecurityError인 경우 사용자에게 안내
    if (error.name === 'SecurityError' || error.message.includes('user gesture') || error.message.includes('접근 권한')) {
      deviceList.innerHTML = `<div style="padding: 16px; text-align: center; color: #d32f2f;">
        USB 디바이스 선택 권한 오류가 발생했습니다.<br>
        <small>버튼을 다시 클릭해주세요. (사용자 제스처 필요)</small>
      </div>`;
    } else {
      deviceList.innerHTML = `<div style="padding: 16px; text-align: center; color: #d32f2f;">검색 중 오류가 발생했습니다.<br>${error.message || '알 수 없는 오류'}<br><small>ANT+ USB 스틱이 연결되어 있는지 확인하세요.</small></div>`;
    }
  } finally {
    // 검색 완료 후 버튼 상태 복원
    searchButton.disabled = false;
    if (searchButtonText) {
      if (window.antState.usbDevice) {
        searchButtonText.textContent = '다시 검색';
      } else {
        searchButtonText.textContent = '디바이스 검색';
      }
    }
  }
}

/**
 * 사용자 제스처 컨텍스트에서 즉시 USB 디바이스 요청
 * 이 함수는 동기적으로 호출되어야 함
 */
function requestANTUSBDevice() {
  // ANT+ USB 스틱의 Vendor ID 목록
  const filters = [
    { vendorId: 0x0fcf }, // Garmin/Dynastream/Tacx (대부분의 ANT+ 스틱)
    { vendorId: 0x04d8 }, // Microchip (일부 ANT+ 스틱)
    { vendorId: 0x0483 }, // STMicroelectronics (일부 ANT+ 스틱)
  ];
  
  // 사용자 제스처 컨텍스트에서 즉시 호출
  try {
    return navigator.usb.requestDevice({ filters });
  } catch (filterError) {
    // 필터로 찾지 못한 경우, 필터 없이 모든 USB 디바이스 목록 표시
    console.log('[ANT+] 필터로 디바이스를 찾지 못함, 전체 목록에서 선택');
    if (filterError.name === 'SecurityError') {
      throw filterError;
    }
    return navigator.usb.requestDevice({ filters: [] });
  }
}

/**
 * 요청된 USB 디바이스로 연결 설정
 */
async function connectANTUSBStickWithDevice(devicePromise) {
  try {
    // 디바이스 Promise 해결 (사용자 선택 대기)
    const device = await devicePromise;
    
    // 이미 연결된 디바이스가 있으면 재사용
    if (window.antState.usbDevice && window.antState.usbDevice === device && device.opened) {
      console.log('[ANT+ USB 스틱] 이미 연결된 디바이스 재사용');
      return device;
    }
    
    // 디바이스 정보 로그
    console.log('[ANT+ USB 스틱] 발견된 디바이스:', {
      vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
      productId: '0x' + device.productId.toString(16).toUpperCase(),
      manufacturerName: device.manufacturerName,
      productName: device.productName
    });
    
    // 디바이스 열기
    await device.open();
    
    // 디바이스 구성 확인 및 선택
    const configurations = device.configurations;
    if (configurations.length === 0) {
      throw new Error('디바이스 구성이 없습니다.');
    }
    
    // 첫 번째 구성 선택 (일반적으로 구성 1)
    const configNumber = configurations[0].configurationValue || 1;
    await device.selectConfiguration(configNumber);
    
    // 인터페이스 찾기 (ANT+ USB 스틱은 일반적으로 인터페이스 0 사용)
    const interfaces = configurations[0].interfaces;
    let targetInterface = null;
    
    // 인터페이스 0부터 순차적으로 확인
    for (let i = 0; i < interfaces.length; i++) {
      const intf = interfaces[i];
      // 인터럽트 또는 벌크 타입 엔드포인트가 있는 인터페이스 찾기
      const alt = intf.alternates.find(alt => 
        alt.endpoints.some(ep => (ep.type === 'interrupt' || ep.type === 'bulk'))
      );
      if (alt) {
        targetInterface = { interfaceNumber: intf.interfaceNumber, alternate: alt };
        break;
      }
    }
    
    if (!targetInterface) {
      // 인터페이스 0을 기본으로 시도
      targetInterface = interfaces.find(i => i.interfaceNumber === 0);
      if (!targetInterface) {
        throw new Error('ANT+ 인터페이스를 찾을 수 없습니다.');
      }
      targetInterface = {
        interfaceNumber: targetInterface.interfaceNumber,
        alternate: targetInterface.alternates[0]
      };
    }
    
    // 인터페이스 클레임
    await device.claimInterface(targetInterface.interfaceNumber);
    
    // 입력/출력 엔드포인트 찾기 (interrupt 또는 bulk 타입)
    const inEndpoint = targetInterface.alternate.endpoints.find(
      e => e.direction === 'in' && (e.type === 'interrupt' || e.type === 'bulk')
    );
    const outEndpoint = targetInterface.alternate.endpoints.find(
      e => e.direction === 'out' && (e.type === 'interrupt' || e.type === 'bulk')
    );
    
    if (!inEndpoint || !outEndpoint) {
      throw new Error('ANT+ 엔드포인트를 찾을 수 없습니다. (입력/출력 엔드포인트 필요)');
    }
    
    // 전역 상태에 저장
    window.antState.usbDevice = device;
    window.antState.inEndpoint = inEndpoint.endpointNumber;
    window.antState.outEndpoint = outEndpoint.endpointNumber;
    window.antState.interfaceNumber = targetInterface.interfaceNumber;
    
    // ANT+ 초기화 메시지 전송
    await initializeANT();
    
    console.log('[ANT+ USB 스틱] 연결 성공', {
      vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
      productId: '0x' + device.productId.toString(16).toUpperCase(),
      interface: targetInterface.interfaceNumber,
      inEndpoint: inEndpoint.endpointNumber,
      outEndpoint: outEndpoint.endpointNumber
    });
    
    // USB 상태 UI 업데이트
    checkANTUSBStatus();
    
    return device;
  } catch (error) {
    console.error('[ANT+ USB 스틱 연결 오류]', error);
    if (error.name === 'SecurityError') {
      throw new Error('USB 디바이스 접근 권한이 필요합니다. 버튼을 다시 클릭해주세요.');
    }
    if (error.message) {
      throw error;
    }
    throw new Error(`ANT+ USB 스틱 연결 실패: ${error.name || '알 수 없는 오류'}`);
  }
}

/**
 * ANT+ USB 스틱 연결 (Web USB API)
 * 이 함수는 requestANTUSBDevice()로 얻은 Promise를 사용합니다.
 */
async function connectANTUSBStick() {
  // 이미 연결된 디바이스가 있으면 재사용
  if (window.antState.usbDevice && window.antState.usbDevice.opened) {
    console.log('[ANT+ USB 스틱] 이미 연결된 디바이스 재사용');
    return window.antState.usbDevice;
  }
  
  // 사용자 제스처 컨텍스트에서 즉시 requestDevice 호출
  const devicePromise = requestANTUSBDevice();
  return await connectANTUSBStickWithDevice(devicePromise);
}

/**
 * ANT+ 초기화
 */
async function initializeANT() {
  // ANT+ 리셋 메시지 전송
  await sendANTMessage(0x4A, [0x00]); // Reset System
  
  // 초기화 대기
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 네트워크 키 설정 (ANT+ 공개 네트워크 키)
  const networkKey = [0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45];
  await sendANTMessage(0x46, [0x00, ...networkKey]); // Set Network Key
  
  // 채널 주기 설정
  await sendANTMessage(0x60, [0x00, 0x00, 0x00]); // Set Channel Period (기본값)
  
  console.log('[ANT+] 초기화 완료');
}

/**
 * ANT+ 메시지 전송
 */
async function sendANTMessage(messageId, data = []) {
  if (!window.antState.usbDevice || !window.antState.outEndpoint) {
    throw new Error('ANT+ USB 스틱이 연결되어 있지 않습니다.');
  }
  
  // ANT+ 메시지 포맷: [Sync(0xA4), Length, MessageID, Data..., Checksum]
  const length = data.length + 1; // MessageID 포함
  const checksum = calculateChecksum([messageId, ...data]);
  const message = [0xA4, length, messageId, ...data, checksum];
  
  // 8바이트 패킷으로 전송
  const packet = new Uint8Array(8);
  packet.set(message.slice(0, 8), 0);
  
  await window.antState.usbDevice.transferOut(window.antState.outEndpoint, packet);
  
  // 메시지가 8바이트보다 길면 추가 패킷 전송
  if (message.length > 8) {
    for (let i = 8; i < message.length; i += 8) {
      const remainingPacket = new Uint8Array(8);
      remainingPacket.set(message.slice(i, i + 8), 0);
      await window.antState.usbDevice.transferOut(window.antState.outEndpoint, remainingPacket);
    }
  }
}

/**
 * ANT+ 체크섬 계산
 */
function calculateChecksum(data) {
  let checksum = 0;
  for (let byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

/**
 * ANT+ 메시지 수신
 */
async function receiveANTMessage() {
  if (!window.antState.usbDevice || !window.antState.inEndpoint) {
    throw new Error('ANT+ USB 스틱이 연결되어 있지 않습니다.');
  }
  
  try {
    const result = await window.antState.usbDevice.transferIn(window.antState.inEndpoint, 8);
    const data = new Uint8Array(result.data.buffer);
    
    // 버퍼에 데이터 추가
    window.antState.messageBuffer.push(...Array.from(data));
    
    // 동기화 바이트(0xA4) 찾기
    let syncIndex = -1;
    for (let i = 0; i < window.antState.messageBuffer.length; i++) {
      if (window.antState.messageBuffer[i] === 0xA4) {
        syncIndex = i;
        break;
      }
    }
    
    // 동기화 바이트가 없으면 버퍼 초기화
    if (syncIndex === -1) {
      // 버퍼가 너무 크면 초기화 (동기화 바이트를 찾지 못한 경우)
      if (window.antState.messageBuffer.length > 64) {
        window.antState.messageBuffer = [];
      }
      return null;
    }
    
    // 동기화 바이트 이전 데이터 제거
    if (syncIndex > 0) {
      window.antState.messageBuffer = window.antState.messageBuffer.slice(syncIndex);
    }
    
    // 최소 메시지 길이 확인 (Sync + Length + MessageID + Checksum = 4바이트)
    if (window.antState.messageBuffer.length < 4) {
      return null; // 더 많은 데이터 필요
    }
    
    const length = window.antState.messageBuffer[1];
    
    // 메시지 전체 길이 확인 (Sync + Length + MessageID + Data + Checksum)
    const totalLength = 2 + length + 1; // Sync(1) + Length(1) + MessageID(1) + Data(length) + Checksum(1)
    
    // 메시지가 완전히 수신되지 않았으면 대기
    if (window.antState.messageBuffer.length < totalLength) {
      return null; // 더 많은 데이터 필요
    }
    
    // 메시지 추출
    const messageBytes = window.antState.messageBuffer.slice(0, totalLength);
    window.antState.messageBuffer = window.antState.messageBuffer.slice(totalLength);
    
    // 메시지 파싱
    const messageId = messageBytes[2];
    const messageData = messageBytes.slice(3, 3 + length - 1);
    const checksum = messageBytes[3 + length - 1];
    
    // 체크섬 검증 (MessageID부터 Data까지)
    const calculatedChecksum = calculateChecksum([messageId, ...messageData]);
    if (checksum !== calculatedChecksum) {
      // 디버깅 정보 (개발 중에만 표시)
      const debugInfo = {
        messageId: '0x' + messageId.toString(16).toUpperCase(),
        received: '0x' + checksum.toString(16).toUpperCase(),
        calculated: '0x' + calculatedChecksum.toString(16).toUpperCase(),
        dataLength: messageData.length,
        length: length,
        rawMessage: Array.from(messageBytes).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
      };
      
      // 0xAE (Capabilities) 메시지는 체크섬 오류가 있어도 처리
      // 일부 ANT+ 스틱은 특정 메시지에서 체크섬 계산이 다를 수 있음
      if (messageId === 0xAE) {
        console.log('[ANT+] Capabilities 메시지 (체크섬 오류 무시)', debugInfo);
        return { messageId, data: messageData };
      }
      
      // 중요한 메시지들은 체크섬 오류가 있어도 처리
      if (messageId === 0x43 || messageId === 0x4E || messageId === 0x4D || 
          messageId === 0x51 || messageId === 0x46 || messageId === 0x47) {
        // Channel Event, Broadcast Data, Acknowledged Data, Channel ID Response, 
        // Burst Data, Extended Broadcast Data는 처리
        console.log('[ANT+] 중요 메시지 (체크섬 오류 무시)', debugInfo);
        return { messageId, data: messageData };
      }
      
      // 체크섬 오류가 발생한 경우 경고만 표시하고 무시
      console.warn('[ANT+] 체크섬 오류 (메시지 무시)', debugInfo);
      return null;
    }
    
    return { messageId, data: messageData };
  } catch (error) {
    // USB 전송 오류 시 버퍼 초기화
    if (error.name === 'NetworkError' || error.name === 'NotFoundError') {
      window.antState.messageBuffer = [];
    }
    throw error;
  }
}

/**
 * ANT+ 디바이스 스캔
 */
async function scanANTDevices() {
  if (!window.antState.usbDevice) {
    throw new Error('ANT+ USB 스틱이 연결되어 있지 않습니다.');
  }
  
  // 기존 검색 결과 초기화
  window.antState.foundDevices = [];
  window.antState.isScanning = true;
  
  // 스캔 채널 열기 (채널 0 사용)
  const channelNumber = ANT_CHANNEL_CONFIG.SCAN_CHANNEL;
  window.antState.scanChannel = channelNumber;
  
  // 채널 할당
  await sendANTMessage(0x42, [channelNumber, 0x20]); // Assign Channel (Scan Mode)
  
  // 채널 ID 설정 (Wildcard: 모든 디바이스 검색)
  await sendANTMessage(0x51, [channelNumber, 0x00, 0x00, 0x00, 0x00, 0x00]); // Set Channel ID (Wildcard)
  
  // 채널 주기 설정 (8192 * 1/32768 초 = 250ms)
  await sendANTMessage(0x60, [channelNumber, 0x00, 0x20]); // Set Channel Period
  
  // 채널 RF 주파수 설정 (ANT+ 공개 주파수: 57)
  await sendANTMessage(0x45, [channelNumber, 0x39]); // Set Channel RF Frequency
  
  // 채널 열기
  await sendANTMessage(0x4B, [channelNumber]); // Open Channel
  
  // 메시지 수신 시작
  startANTMessageListener();
  
  // 스캔 시작 후 Channel ID 요청을 주기적으로 보내어 디바이스 정보 얻기
  startChannelIDRequest(channelNumber);
  
  // 15초간 스캔 (스피드센서 검색을 위해 시간 연장)
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  // 스캔 중지
  await sendANTMessage(0x4C, [channelNumber]); // Close Channel
  window.antState.isScanning = false;
  
  // Channel ID 요청 중지
  if (window.antChannelIDRequestInterval) {
    clearInterval(window.antChannelIDRequestInterval);
    window.antChannelIDRequestInterval = null;
  }
  
  return window.antState.foundDevices;
}

/**
 * ANT+ 메시지 리스너 시작
 */
function startANTMessageListener() {
  if (window.antMessageListener) {
    return; // 이미 실행 중
  }
  
  window.antMessageListener = true;
  
  const listen = async () => {
    if (!window.antState.isScanning && !window.antState.usbDevice) {
      window.antMessageListener = false;
      return;
    }
    
    try {
      const message = await receiveANTMessage();
      if (message) {
        handleANTMessage(message);
      }
    } catch (error) {
      console.error('[ANT+ 메시지 수신 오류]', error);
    }
    
    // 다음 메시지 대기
    setTimeout(listen, 10);
  };
  
  listen();
}

/**
 * ANT+ 메시지 처리
 */
function handleANTMessage(message) {
  const { messageId, data } = message;
  
  switch (messageId) {
    case 0x43: // Channel Event
      handleChannelEvent(data);
      break;
    case 0x4E: // Broadcast Data
      handleBroadcastData(data);
      break;
    case 0x4D: // Acknowledged Data
      handleAcknowledgedData(data);
      break;
    case 0x51: // Channel ID Response
      handleChannelIDResponse(data);
      break;
    default:
      // 기타 메시지 무시
      break;
  }
}

/**
 * 채널 이벤트 처리
 */
function handleChannelEvent(data) {
  const channelNumber = data[0];
  const messageId = data[1];
  const messageCode = data[2];
  
  switch (messageCode) {
    case 0x01: // RX_SEARCH_TIMEOUT
      // 검색 타임아웃
      break;
    case 0x03: // RX_FAIL
      // 수신 실패
      break;
    case 0x06: // TRANSFER_RX_FAILED
      // 전송 수신 실패
      break;
    case 0x07: // TRANSFER_TX_COMPLETED
      // 전송 완료
      break;
    case 0x08: // TRANSFER_TX_FAILED
      // 전송 실패
      break;
    case 0x09: // CHANNEL_CLOSED
      // 채널 닫힘
      break;
    case 0x0F: // RX_EXT_MESSAGE
      // 확장 메시지 수신
      break;
    default:
      break;
  }
}

/**
 * 브로드캐스트 데이터 처리 (스캔 중 발견된 디바이스)
 */
function handleBroadcastData(data) {
  if (!window.antState.isScanning) {
    return;
  }
  
  // ANT+ 브로드캐스트 메시지 구조: [Channel, Data0-7]
  // 스캔 채널(0번)의 브로드캐스트 데이터만 처리
  const channelNumber = data[0];
  if (channelNumber !== ANT_CHANNEL_CONFIG.SCAN_CHANNEL) {
    return;
  }
  
  // 브로드캐스트 데이터는 8바이트
  // 실제 디바이스 정보는 Channel ID Response를 통해 얻어야 함
  // 여기서는 브로드캐스트 데이터가 수신되었다는 것만 확인
}

/**
 * Channel ID Response 처리 (스캔 중 발견된 디바이스 정보)
 * 이 메시지에서 실제 디바이스 타입과 번호를 얻을 수 있음
 */
function handleChannelIDResponse(data) {
  if (!window.antState.isScanning) {
    return;
  }
  
  // Channel ID Response 메시지 구조: [Channel, DeviceNumber(LSB), DeviceNumber(MSB), DeviceType, TransmissionType]
  if (data.length < 5) {
    return;
  }
  
  const channelNumber = data[0];
  const deviceNumber = (data[2] << 8) | data[1]; // LSB, MSB 순서
  const deviceType = data[3];
  const transmissionType = data[4];
  
  // 스캔 채널의 응답만 처리
  if (channelNumber !== ANT_CHANNEL_CONFIG.SCAN_CHANNEL) {
    return;
  }
  
  // Speed/Cadence 센서 타입 확인
  // 0x79: Speed and Cadence Sensor (Combined) - 속도와 케이던스 모두
  // 0x7A: Speed Sensor (Separate) - 속도만
  // 0x78: Cadence Sensor (Separate) - 케이던스만
  if (deviceType === 0x79 || deviceType === 0x7A) {
    // 이미 발견된 디바이스인지 확인
    const existingDevice = window.antState.foundDevices.find(
      d => d.deviceNumber === deviceNumber
    );
    
    if (!existingDevice) {
      // 새 스피드센서 추가
      const device = {
        id: deviceNumber.toString(),
        name: `ANT+ Speed Sensor ${deviceNumber}`,
        type: deviceType === 0x79 ? 'Speed/Cadence (Combined)' : 'Speed Sensor',
        deviceNumber: deviceNumber,
        deviceType: deviceType,
        transmissionType: transmissionType
      };
      
      window.antState.foundDevices.push(device);
      console.log('[ANT+] 스피드센서 발견:', device);
      
      // UI 업데이트
      displayANTDevices(window.antState.foundDevices);
    }
  }
}

/**
 * Channel ID 요청 주기적 전송 (스캔 중 디바이스 정보 얻기)
 */
function startChannelIDRequest(channelNumber) {
  if (window.antChannelIDRequestInterval) {
    clearInterval(window.antChannelIDRequestInterval);
  }
  
  // 500ms마다 Channel ID 요청 전송
  window.antChannelIDRequestInterval = setInterval(async () => {
    if (!window.antState.isScanning || !window.antState.usbDevice) {
      clearInterval(window.antChannelIDRequestInterval);
      window.antChannelIDRequestInterval = null;
      return;
    }
    
    try {
      // Channel ID 요청은 Request Message (0x4D)를 사용
      // Request Message 구조: [Channel, Requested Message ID]
      // 0x51은 Channel ID Response 메시지 ID이므로, 이를 요청
      await sendANTMessage(0x4D, [channelNumber, 0x51]); // Request Channel ID
    } catch (error) {
      // 오류는 조용히 무시 (스캔 중이므로)
      // console.error('[ANT+] Channel ID 요청 오류:', error);
    }
  }, 500);
}

/**
 * 확인된 데이터 처리
 */
function handleAcknowledgedData(data) {
  // 확인된 데이터 처리 (필요시 구현)
}

/**
 * 검색된 ANT+ 디바이스 목록 표시
 */
function displayANTDevices(devices) {
  const deviceList = document.getElementById('antDeviceList');
  if (!deviceList) return;
  
  if (devices.length === 0) {
    deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">검색된 디바이스가 없습니다.<br>디바이스가 켜져 있고 페어링 모드인지 확인하세요.</div>';
    return;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
  devices.forEach(device => {
    html += `
      <div class="ant-device-item" 
           style="padding: 12px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: white; transition: background 0.2s;"
           onmouseover="this.style.background='#f0f0f0'"
           onmouseout="this.style.background='white'"
           onclick="selectANTDevice('${device.id}', '${device.name || device.id}')">
        <div style="font-weight: 600; color: #333; margin-bottom: 4px;">${device.name || `디바이스 ${device.id}`}</div>
        <div style="font-size: 12px; color: #666;">
          <span>ID: ${device.id}</span>
          ${device.type ? `<span style="margin-left: 8px;">타입: ${device.type}</span>` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  
  deviceList.innerHTML = html;
}

/**
 * ANT+ 디바이스 선택
 */
function selectANTDevice(deviceId, deviceName) {
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  const deviceList = document.getElementById('antDeviceList');
  
  if (deviceIdInput) {
    deviceIdInput.value = deviceId;
  }
  
  // 선택된 디바이스 하이라이트
  if (deviceList) {
    const items = deviceList.querySelectorAll('.ant-device-item');
    items.forEach(item => {
      item.style.border = '1px solid #ddd';
      item.style.background = 'white';
    });
    
    // 선택된 항목 찾기
    const selectedItem = Array.from(items).find(item => 
      item.textContent.includes(deviceId)
    );
    if (selectedItem) {
      selectedItem.style.border = '2px solid #28a745';
      selectedItem.style.background = '#f0f9ff';
    }
  }
  
  if (typeof showToast === 'function') {
    showToast(`${deviceName || deviceId} 선택됨`);
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
  const deviceList = document.getElementById('antDeviceList');
  const searchButton = document.getElementById('btnSearchANTDevices');
  const searchButtonText = document.getElementById('searchButtonText');
  
  if (nameInput) nameInput.value = '';
  if (deviceIdInput) deviceIdInput.value = '';
  if (deviceList) {
    deviceList.classList.add('hidden');
    deviceList.innerHTML = '';
  }
  if (searchButton) searchButton.disabled = false;
  if (searchButtonText) searchButtonText.textContent = '디바이스 검색';
  
  // 검색 중지
  if (window.antDeviceSearchInterval) {
    clearInterval(window.antDeviceSearchInterval);
    window.antDeviceSearchInterval = null;
  }
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
    speedometer.maxSpeed = 0;
    speedometer.averageSpeed = 0;
    speedometer.speedSum = 0;
    speedometer.speedCount = 0;
    speedometer.totalDistance = 0;
    speedometer.totalRevolutions = 0;
    speedometer.lastRevolutions = 0;
    
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
  const wheelSize = document.getElementById('wheelSize');
  
  if (endByDistance) window.rollerRaceState.raceSettings.endByDistance = endByDistance.checked;
  if (targetDistance) window.rollerRaceState.raceSettings.targetDistance = parseFloat(targetDistance.value) || 10;
  if (endByTime) window.rollerRaceState.raceSettings.endByTime = endByTime.checked;
  if (targetTime) window.rollerRaceState.raceSettings.targetTime = parseInt(targetTime.value) || 60;
  if (wheelSize) window.rollerRaceState.raceSettings.wheelSize = wheelSize.value || '25-622';
  
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
    // UI 업데이트
    updateRaceSettingsUI();
  } catch (error) {
    console.error('[경기 설정 로드 오류]', error);
  }
}

/**
 * 경기 설정 UI 업데이트
 */
function updateRaceSettingsUI() {
  const settings = window.rollerRaceState.raceSettings;
  
  const endByDistance = document.getElementById('endByDistance');
  const targetDistance = document.getElementById('targetDistance');
  const endByTime = document.getElementById('endByTime');
  const targetTime = document.getElementById('targetTime');
  const wheelSize = document.getElementById('wheelSize');
  
  if (endByDistance) endByDistance.checked = settings.endByDistance;
  if (targetDistance) targetDistance.value = settings.targetDistance || 10;
  if (endByTime) endByTime.checked = settings.endByTime;
  if (targetTime) targetTime.value = settings.targetTime || 60;
  if (wheelSize) wheelSize.value = settings.wheelSize || '25-622';
}

/**
 * 경기 설정 모달 열기
 */
function openRaceSettingsModal() {
  const modal = document.getElementById('raceSettingsModal');
  if (modal) {
    updateRaceSettingsUI();
    modal.classList.remove('hidden');
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

/**
 * ANT+ USB 수신기 연결 상태 확인
 */
async function checkANTUSBStatus() {
  const statusIcon = document.getElementById('antUSBStatusIcon');
  const statusText = document.getElementById('antUSBStatusText');
  const refreshButton = document.getElementById('btnRefreshUSBStatus');
  const connectButton = document.getElementById('btnConnectUSBStick');
  
  if (!statusIcon || !statusText) return;
  
  // 새로고침 버튼 비활성화
  if (refreshButton) refreshButton.disabled = true;
  if (connectButton) connectButton.disabled = true;
  
  try {
    // 이미 연결된 디바이스 확인
    if (window.antState.usbDevice) {
      try {
        // 디바이스가 여전히 열려있는지 확인
        if (window.antState.usbDevice.opened) {
          const deviceInfo = {
            vendorId: '0x' + window.antState.usbDevice.vendorId.toString(16).toUpperCase(),
            productId: '0x' + window.antState.usbDevice.productId.toString(16).toUpperCase(),
            manufacturerName: window.antState.usbDevice.manufacturerName || '알 수 없음',
            productName: window.antState.usbDevice.productName || 'ANT+ USB 수신기'
          };
          updateANTUSBStatusUI('connected', 'USB 수신기 연결됨', deviceInfo);
          if (refreshButton) refreshButton.disabled = false;
          if (connectButton) connectButton.style.display = 'none';
          return;
        }
      } catch (error) {
        // 디바이스가 연결 해제된 경우
        window.antState.usbDevice = null;
      }
    }
    
    // Web USB API 지원 확인
    if (!navigator.usb) {
      updateANTUSBStatusUI('not_supported', 'Web USB API를 지원하지 않습니다 (Chrome/Edge 필요)', null);
      if (connectButton) connectButton.style.display = 'none';
      return;
    }
    
    // Web USB API로 이미 권한이 부여된 디바이스 목록 확인
    if (typeof navigator.usb.getDevices === 'function') {
      console.log('[ANT+ USB 상태 확인] 권한이 부여된 디바이스 목록 확인 중...');
      const devices = await navigator.usb.getDevices();
      console.log('[ANT+ USB 상태 확인] 발견된 디바이스 수:', devices.length);
      
      // ANT+ USB 스틱 찾기 (Vendor ID로 필터링)
      const antDevices = devices.filter(device => {
        const vendorId = device.vendorId;
        const isANTDevice = vendorId === 0x0fcf || vendorId === 0x04d8 || vendorId === 0x0483;
        if (isANTDevice) {
          console.log('[ANT+ USB 상태 확인] ANT+ 디바이스 발견:', {
            vendorId: '0x' + vendorId.toString(16).toUpperCase(),
            productId: '0x' + device.productId.toString(16).toUpperCase(),
            productName: device.productName || '알 수 없음'
          });
        }
        return isANTDevice;
      });
      
      if (antDevices.length > 0) {
        const device = antDevices[0];
        const deviceInfo = {
          vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
          productId: '0x' + device.productId.toString(16).toUpperCase(),
          manufacturerName: device.manufacturerName || '알 수 없음',
          productName: device.productName || 'ANT+ USB 수신기'
        };
        
        console.log('[ANT+ USB 상태 확인] 디바이스 정보:', deviceInfo);
        
        // 디바이스가 열려있는지 확인
        let isOpened = false;
        try {
          isOpened = device.opened;
          console.log('[ANT+ USB 상태 확인] 디바이스 열림 상태:', isOpened);
        } catch (e) {
          console.log('[ANT+ USB 상태 확인] 디바이스 열림 상태 확인 실패:', e);
          isOpened = false;
        }
        
        if (isOpened) {
          // 이미 열려있으면 전역 상태에 저장하고 연결됨 상태로 표시
          window.antState.usbDevice = device;
          updateANTUSBStatusUI('connected', `${deviceInfo.productName} 연결됨`, deviceInfo);
          if (connectButton) connectButton.style.display = 'none';
          if (refreshButton) refreshButton.disabled = false;
          console.log('[ANT+ USB 상태 확인] 이미 연결된 디바이스 확인됨');
        } else {
          updateANTUSBStatusUI('available', `${deviceInfo.productName} 감지됨 (자동 연결 중...)`, deviceInfo);
          if (connectButton) connectButton.style.display = 'inline-block';
          
          // 자동 연결 시도 (이미 권한이 부여된 디바이스는 자동으로 열 수 있음)
          console.log('[ANT+ USB 상태 확인] 자동 연결 시작...');
          try {
            const connectedDevice = await autoConnectANTUSBStick(device);
            
            // 연결 성공 확인
            if (connectedDevice) {
              console.log('[ANT+ USB 상태 확인] 자동 연결 성공');
              // 연결 성공 시 상태 다시 확인
              const connectedDeviceInfo = {
                vendorId: '0x' + connectedDevice.vendorId.toString(16).toUpperCase(),
                productId: '0x' + connectedDevice.productId.toString(16).toUpperCase(),
                manufacturerName: connectedDevice.manufacturerName || '알 수 없음',
                productName: connectedDevice.productName || 'ANT+ USB 수신기'
              };
              updateANTUSBStatusUI('connected', `${connectedDeviceInfo.productName} 연결됨`, connectedDeviceInfo);
              if (connectButton) connectButton.style.display = 'none';
              if (refreshButton) refreshButton.disabled = false;
              return; // 성공적으로 연결되었으므로 종료
            } else {
              console.warn('[ANT+ USB 상태 확인] 자동 연결 실패: connectedDevice가 null');
              updateANTUSBStatusUI('available', `${deviceInfo.productName} 감지됨 (연결 필요)`, deviceInfo);
            }
          } catch (error) {
            console.error('[ANT+] 자동 연결 실패:', error);
            console.error('[ANT+] 자동 연결 실패 상세:', {
              name: error.name,
              message: error.message,
              stack: error.stack
            });
            updateANTUSBStatusUI('available', `${deviceInfo.productName} 감지됨 (연결 필요)`, deviceInfo);
          }
        }
      } else {
        // 권한이 부여된 디바이스가 없는 경우
        console.log('[ANT+ USB 상태 확인] 권한이 부여된 ANT+ 디바이스 없음');
        // USB 수신기가 연결되어 있지만 권한이 없는 상태
        updateANTUSBStatusUI('not_found', 'USB 수신기 권한이 필요합니다. "USB 수신기 연결" 버튼을 클릭하세요', null);
        if (connectButton) connectButton.style.display = 'inline-block';
      }
    } else {
      updateANTUSBStatusUI('not_supported', 'Web USB API를 지원하지 않습니다', null);
      if (connectButton) connectButton.style.display = 'none';
    }
  } catch (error) {
    console.error('[ANT+ USB 상태 확인 오류]', error);
    updateANTUSBStatusUI('error', '상태 확인 실패: ' + (error.message || '알 수 없는 오류'), null);
    if (connectButton) connectButton.style.display = 'inline-block';
  } finally {
    if (refreshButton) refreshButton.disabled = false;
    if (connectButton) connectButton.disabled = false;
  }
}

/**
 * USB 수신기 자동 연결 (이미 권한이 부여된 디바이스)
 */
async function autoConnectANTUSBStick(device) {
  console.log('[ANT+ USB 자동 연결] 시작', {
    vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
    productId: '0x' + device.productId.toString(16).toUpperCase()
  });
  
  try {
    // 이미 열려있는 디바이스인지 확인
    let isOpened = false;
    try {
      isOpened = device.opened;
      console.log('[ANT+ USB 자동 연결] 디바이스 열림 상태:', isOpened);
    } catch (e) {
      console.log('[ANT+ USB 자동 연결] 디바이스 열림 상태 확인 실패:', e);
      isOpened = false;
    }
    
    // 이미 열려있고 연결된 상태면 재사용
    if (isOpened && window.antState.usbDevice === device) {
      console.log('[ANT+ USB 스틱] 이미 연결된 디바이스 재사용');
      const deviceInfo = {
        vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
        productId: '0x' + device.productId.toString(16).toUpperCase(),
        manufacturerName: device.manufacturerName || '알 수 없음',
        productName: device.productName || 'ANT+ USB 수신기'
      };
      updateANTUSBStatusUI('connected', `${deviceInfo.productName} 연결됨`, deviceInfo);
      return device;
    }
    
    // 디바이스 열기 (이미 열려있으면 오류 발생할 수 있으므로 try-catch)
    console.log('[ANT+ USB 자동 연결] 디바이스 열기 시도...');
    try {
      if (!isOpened) {
        await device.open();
        console.log('[ANT+ USB 자동 연결] 디바이스 열기 성공');
      } else {
        console.log('[ANT+ USB 자동 연결] 디바이스가 이미 열려있음');
      }
    } catch (openError) {
      // 이미 열려있는 경우 무시
      const errorMsg = openError.message || openError.toString();
      if (errorMsg.includes('already') || errorMsg.includes('열려') || errorMsg.includes('open')) {
        console.log('[ANT+] 디바이스가 이미 열려있음 (오류 무시)');
        // 열림 상태 다시 확인
        try {
          isOpened = device.opened;
          if (isOpened) {
            console.log('[ANT+] 디바이스 열림 상태 확인됨');
          }
        } catch (e) {
          console.warn('[ANT+] 디바이스 열림 상태 확인 실패:', e);
        }
      } else {
        console.error('[ANT+ USB 자동 연결] 디바이스 열기 실패:', openError);
        throw openError;
      }
    }
    
    // 디바이스 구성 확인 및 선택
    console.log('[ANT+ USB 자동 연결] 디바이스 구성 확인 중...');
    const configurations = device.configurations;
    if (configurations.length === 0) {
      throw new Error('디바이스 구성이 없습니다.');
    }
    console.log('[ANT+ USB 자동 연결] 발견된 구성 수:', configurations.length);
    
    // 첫 번째 구성 선택
    const configNumber = configurations[0].configurationValue || 1;
    console.log('[ANT+ USB 자동 연결] 구성 선택 시도 (번호:', configNumber, ')');
    try {
      await device.selectConfiguration(configNumber);
      console.log('[ANT+ USB 자동 연결] 구성 선택 성공');
    } catch (configError) {
      // 이미 선택된 구성이면 무시
      const errorMsg = configError.message || configError.toString();
      if (errorMsg.includes('already') || errorMsg.includes('선택') || errorMsg.includes('selected')) {
        console.log('[ANT+ USB 자동 연결] 구성이 이미 선택됨 (오류 무시)');
      } else {
        console.error('[ANT+ USB 자동 연결] 구성 선택 오류:', configError);
        throw configError;
      }
    }
    
    // 인터페이스 찾기
    console.log('[ANT+ USB 자동 연결] 인터페이스 찾기 중...');
    const interfaces = configurations[0].interfaces;
    console.log('[ANT+ USB 자동 연결] 발견된 인터페이스 수:', interfaces.length);
    let targetInterface = null;
    
    for (let i = 0; i < interfaces.length; i++) {
      const intf = interfaces[i];
      const alt = intf.alternates.find(alt => 
        alt.endpoints.some(ep => (ep.type === 'interrupt' || ep.type === 'bulk'))
      );
      if (alt) {
        targetInterface = { interfaceNumber: intf.interfaceNumber, alternate: alt };
        console.log('[ANT+ USB 자동 연결] 인터페이스 발견:', intf.interfaceNumber);
        break;
      }
    }
    
    if (!targetInterface) {
      targetInterface = interfaces.find(i => i.interfaceNumber === 0);
      if (!targetInterface) {
        throw new Error('ANT+ 인터페이스를 찾을 수 없습니다.');
      }
      targetInterface = {
        interfaceNumber: targetInterface.interfaceNumber,
        alternate: targetInterface.alternates[0]
      };
      console.log('[ANT+ USB 자동 연결] 기본 인터페이스 사용:', targetInterface.interfaceNumber);
    }
    
    // 인터페이스 클레임 (이미 클레임된 경우 오류 발생할 수 있음)
    console.log('[ANT+ USB 자동 연결] 인터페이스 클레임 시도 (번호:', targetInterface.interfaceNumber, ')');
    try {
      await device.claimInterface(targetInterface.interfaceNumber);
      console.log('[ANT+ USB 자동 연결] 인터페이스 클레임 성공');
    } catch (claimError) {
      // 이미 클레임된 경우 무시
      const errorMsg = claimError.message || claimError.toString();
      if (errorMsg.includes('already') || errorMsg.includes('클레임') || errorMsg.includes('claimed')) {
        console.log('[ANT+ USB 자동 연결] 인터페이스가 이미 클레임됨 (오류 무시)');
      } else {
        console.error('[ANT+ USB 자동 연결] 인터페이스 클레임 오류:', claimError);
        throw claimError;
      }
    }
    
    // 엔드포인트 찾기
    console.log('[ANT+ USB 자동 연결] 엔드포인트 찾기 중...');
    const inEndpoint = targetInterface.alternate.endpoints.find(
      e => e.direction === 'in' && (e.type === 'interrupt' || e.type === 'bulk')
    );
    const outEndpoint = targetInterface.alternate.endpoints.find(
      e => e.direction === 'out' && (e.type === 'interrupt' || e.type === 'bulk')
    );
    
    if (!inEndpoint || !outEndpoint) {
      console.error('[ANT+ USB 자동 연결] 엔드포인트 찾기 실패:', {
        inEndpoint: inEndpoint ? inEndpoint.endpointNumber : null,
        outEndpoint: outEndpoint ? outEndpoint.endpointNumber : null,
        availableEndpoints: targetInterface.alternate.endpoints.map(e => ({
          number: e.endpointNumber,
          direction: e.direction,
          type: e.type
        }))
      });
      throw new Error('ANT+ 엔드포인트를 찾을 수 없습니다.');
    }
    console.log('[ANT+ USB 자동 연결] 엔드포인트 발견:', {
      in: inEndpoint.endpointNumber,
      out: outEndpoint.endpointNumber
    });
    
    // 전역 상태에 저장
    console.log('[ANT+ USB 자동 연결] 전역 상태에 저장 중...');
    window.antState.usbDevice = device;
    window.antState.inEndpoint = inEndpoint.endpointNumber;
    window.antState.outEndpoint = outEndpoint.endpointNumber;
    window.antState.interfaceNumber = targetInterface.interfaceNumber;
    
    // ANT+ 초기화 메시지 전송
    console.log('[ANT+ USB 자동 연결] ANT+ 초기화 시작...');
    try {
      await initializeANT();
      console.log('[ANT+ USB 자동 연결] ANT+ 초기화 성공');
    } catch (initError) {
      console.warn('[ANT+ USB 자동 연결] 초기화 오류 (무시하고 계속):', initError);
      // 초기화 오류는 무시하고 계속 진행
    }
    
    console.log('[ANT+ USB 스틱] 자동 연결 성공', {
      vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
      productId: '0x' + device.productId.toString(16).toUpperCase(),
      interface: targetInterface.interfaceNumber,
      inEndpoint: inEndpoint.endpointNumber,
      outEndpoint: outEndpoint.endpointNumber
    });
    
    // 연결 상태 최종 확인
    console.log('[ANT+ USB 자동 연결] 연결 상태 최종 확인 중...');
    let finalOpened = false;
    try {
      finalOpened = device.opened;
      console.log('[ANT+ USB 자동 연결] 최종 열림 상태:', finalOpened);
    } catch (e) {
      console.warn('[ANT+ USB 자동 연결] 최종 열림 상태 확인 실패:', e);
      finalOpened = false;
    }
    
    if (!finalOpened) {
      console.error('[ANT+ USB 자동 연결] 디바이스가 열리지 않았습니다.');
      throw new Error('디바이스가 열리지 않았습니다.');
    }
    
    // 상태 업데이트
    const deviceInfo = {
      vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
      productId: '0x' + device.productId.toString(16).toUpperCase(),
      manufacturerName: device.manufacturerName || '알 수 없음',
      productName: device.productName || 'ANT+ USB 수신기'
    };
    updateANTUSBStatusUI('connected', `${deviceInfo.productName} 연결됨`, deviceInfo);
    
    console.log('[ANT+ USB 스틱] 자동 연결 완료 및 상태 업데이트됨');
    
    return device;
  } catch (error) {
    console.error('[ANT+ USB 스틱 자동 연결 오류]', error);
    console.error('[ANT+ USB 스틱 자동 연결 오류 상세]', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      vendorId: device ? '0x' + device.vendorId.toString(16).toUpperCase() : 'N/A',
      productId: device ? '0x' + device.productId.toString(16).toUpperCase() : 'N/A'
    });
    throw error;
  }
}

/**
 * USB 수신기 직접 연결 (권한 요청)
 */
async function connectUSBStickDirectly() {
  const statusText = document.getElementById('antUSBStatusText');
  const connectButton = document.getElementById('btnConnectUSBStick');
  
  if (connectButton) connectButton.disabled = true;
  if (statusText) statusText.textContent = 'USB 수신기 연결 중...';
  
  try {
    // 사용자 제스처 컨텍스트에서 즉시 requestDevice 호출
    const devicePromise = requestANTUSBDevice();
    await connectANTUSBStickWithDevice(devicePromise);
    
    // 연결 성공 시 상태 업데이트
    await checkANTUSBStatus();
    
    if (typeof showToast === 'function') {
      showToast('USB 수신기 연결 완료');
    }
  } catch (error) {
    console.error('[USB 수신기 연결 오류]', error);
    
    if (error.name === 'SecurityError' || error.message.includes('접근 권한')) {
      if (statusText) {
        statusText.textContent = '권한 오류: 버튼을 다시 클릭해주세요';
      }
    } else if (error.name === 'NotFoundError') {
      if (statusText) {
        statusText.textContent = 'USB 수신기를 찾을 수 없습니다. USB 포트를 확인하세요';
      }
    } else {
      if (statusText) {
        statusText.textContent = '연결 실패: ' + (error.message || '알 수 없는 오류');
      }
    }
    
    // 상태 다시 확인
    await checkANTUSBStatus();
    
    if (typeof showToast === 'function') {
      showToast('USB 수신기 연결 실패: ' + (error.message || '알 수 없는 오류'));
    }
  } finally {
    if (connectButton) connectButton.disabled = false;
  }
}

/**
 * ANT+ USB 상태 UI 업데이트
 */
function updateANTUSBStatusUI(status, message, deviceInfo) {
  const statusIcon = document.getElementById('antUSBStatusIcon');
  const statusText = document.getElementById('antUSBStatusText');
  const statusContainer = document.getElementById('antUSBStatus');
  
  if (!statusIcon || !statusText) return;
  
  // 상태에 따른 아이콘 색상 및 배경색 설정
  switch (status) {
    case 'connected':
      statusIcon.style.background = '#28a745';
      statusIcon.style.boxShadow = '0 0 8px rgba(40, 167, 69, 0.6)';
      if (statusContainer) {
        statusContainer.style.background = '#d4edda';
        statusContainer.style.border = '1px solid #c3e6cb';
      }
      statusText.style.color = '#155724';
      break;
    case 'available':
      statusIcon.style.background = '#ffc107';
      statusIcon.style.boxShadow = '0 0 8px rgba(255, 193, 7, 0.6)';
      if (statusContainer) {
        statusContainer.style.background = '#fff3cd';
        statusContainer.style.border = '1px solid #ffeaa7';
      }
      statusText.style.color = '#856404';
      break;
    case 'not_found':
      statusIcon.style.background = '#dc3545';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f8d7da';
        statusContainer.style.border = '1px solid #f5c6cb';
      }
      statusText.style.color = '#721c24';
      break;
    case 'not_supported':
      statusIcon.style.background = '#6c757d';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#e2e3e5';
        statusContainer.style.border = '1px solid #d6d8db';
      }
      statusText.style.color = '#383d41';
      break;
    case 'error':
      statusIcon.style.background = '#dc3545';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f8d7da';
        statusContainer.style.border = '1px solid #f5c6cb';
      }
      statusText.style.color = '#721c24';
      break;
    default:
      statusIcon.style.background = '#999';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f0f0f0';
        statusContainer.style.border = '1px solid #ddd';
      }
      statusText.style.color = '#666';
  }
  
  // 메시지 업데이트
  let displayMessage = message;
  if (deviceInfo && deviceInfo.productName) {
    displayMessage = message;
  }
  statusText.textContent = displayMessage;
  
  // 디바이스 정보가 있으면 툴팁에 표시
  if (deviceInfo) {
    statusText.title = `제조사: ${deviceInfo.manufacturerName}\n제품: ${deviceInfo.productName}\nVendor ID: ${deviceInfo.vendorId}\nProduct ID: ${deviceInfo.productId}`;
  } else {
    statusText.title = '';
  }
}

/**
 * ANT+ USB 수신기 연결 상태 확인
 */
async function checkANTUSBStatus() {
  const statusIcon = document.getElementById('antUSBStatusIcon');
  const statusText = document.getElementById('antUSBStatusText');
  const refreshButton = document.getElementById('btnRefreshUSBStatus');
  
  if (!statusIcon || !statusText) return;
  
  // 새로고침 버튼 비활성화
  if (refreshButton) refreshButton.disabled = true;
  
  try {
    // 이미 연결된 디바이스 확인
    if (window.antState.usbDevice) {
      try {
        // 디바이스가 여전히 열려있는지 확인
        if (window.antState.usbDevice.opened) {
          const deviceInfo = {
            vendorId: '0x' + window.antState.usbDevice.vendorId.toString(16).toUpperCase(),
            productId: '0x' + window.antState.usbDevice.productId.toString(16).toUpperCase(),
            manufacturerName: window.antState.usbDevice.manufacturerName || '알 수 없음',
            productName: window.antState.usbDevice.productName || 'ANT+ USB 수신기'
          };
          updateANTUSBStatusUI('connected', 'USB 수신기 연결됨', deviceInfo);
          if (refreshButton) refreshButton.disabled = false;
          return;
        }
      } catch (error) {
        // 디바이스가 연결 해제된 경우
        window.antState.usbDevice = null;
      }
    }
    
    // Web USB API로 이미 권한이 부여된 디바이스 목록 확인
    if (navigator.usb && typeof navigator.usb.getDevices === 'function') {
      const devices = await navigator.usb.getDevices();
      
      // ANT+ USB 스틱 찾기 (Vendor ID로 필터링)
      const antDevices = devices.filter(device => {
        const vendorId = device.vendorId;
        return vendorId === 0x0fcf || vendorId === 0x04d8 || vendorId === 0x0483;
      });
      
      if (antDevices.length > 0) {
        const device = antDevices[0];
        const deviceInfo = {
          vendorId: '0x' + device.vendorId.toString(16).toUpperCase(),
          productId: '0x' + device.productId.toString(16).toUpperCase(),
          manufacturerName: device.manufacturerName || '알 수 없음',
          productName: device.productName || 'ANT+ USB 수신기'
        };
        
        // 디바이스가 열려있는지 확인
        let isOpened = false;
        try {
          isOpened = device.opened;
        } catch (e) {
          isOpened = false;
        }
        
        if (isOpened) {
          updateANTUSBStatusUI('connected', `${deviceInfo.productName} 연결됨`, deviceInfo);
        } else {
          updateANTUSBStatusUI('available', `${deviceInfo.productName} 감지됨 (연결 필요)`, deviceInfo);
        }
      } else {
        updateANTUSBStatusUI('not_found', 'USB 수신기를 찾을 수 없습니다', null);
      }
    } else {
      updateANTUSBStatusUI('not_supported', 'Web USB API를 지원하지 않습니다', null);
    }
  } catch (error) {
    console.error('[ANT+ USB 상태 확인 오류]', error);
    updateANTUSBStatusUI('error', '상태 확인 실패: ' + (error.message || '알 수 없는 오류'), null);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

/**
 * ANT+ USB 상태 UI 업데이트
 */
function updateANTUSBStatusUI(status, message, deviceInfo) {
  const statusIcon = document.getElementById('antUSBStatusIcon');
  const statusText = document.getElementById('antUSBStatusText');
  const statusContainer = document.getElementById('antUSBStatus');
  
  if (!statusIcon || !statusText) return;
  
  // 상태에 따른 아이콘 색상 및 배경색 설정
  switch (status) {
    case 'connected':
      statusIcon.style.background = '#28a745';
      statusIcon.style.boxShadow = '0 0 8px rgba(40, 167, 69, 0.6)';
      if (statusContainer) {
        statusContainer.style.background = '#d4edda';
        statusContainer.style.border = '1px solid #c3e6cb';
      }
      statusText.style.color = '#155724';
      break;
    case 'available':
      statusIcon.style.background = '#ffc107';
      statusIcon.style.boxShadow = '0 0 8px rgba(255, 193, 7, 0.6)';
      if (statusContainer) {
        statusContainer.style.background = '#fff3cd';
        statusContainer.style.border = '1px solid #ffeaa7';
      }
      statusText.style.color = '#856404';
      break;
    case 'not_found':
      statusIcon.style.background = '#dc3545';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f8d7da';
        statusContainer.style.border = '1px solid #f5c6cb';
      }
      statusText.style.color = '#721c24';
      break;
    case 'not_supported':
      statusIcon.style.background = '#6c757d';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#e2e3e5';
        statusContainer.style.border = '1px solid #d6d8db';
      }
      statusText.style.color = '#383d41';
      break;
    case 'error':
      statusIcon.style.background = '#dc3545';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f8d7da';
        statusContainer.style.border = '1px solid #f5c6cb';
      }
      statusText.style.color = '#721c24';
      break;
    default:
      statusIcon.style.background = '#999';
      statusIcon.style.boxShadow = 'none';
      if (statusContainer) {
        statusContainer.style.background = '#f0f0f0';
        statusContainer.style.border = '1px solid #ddd';
      }
      statusText.style.color = '#666';
  }
  
  // 메시지 업데이트
  let displayMessage = message;
  if (deviceInfo && deviceInfo.productName) {
    displayMessage = message;
  }
  statusText.textContent = displayMessage;
  
  // 디바이스 정보가 있으면 툴팁에 표시
  if (deviceInfo) {
    statusText.title = `제조사: ${deviceInfo.manufacturerName}\n제품: ${deviceInfo.productName}\nVendor ID: ${deviceInfo.vendorId}\nProduct ID: ${deviceInfo.productId}`;
  } else {
    statusText.title = '';
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

