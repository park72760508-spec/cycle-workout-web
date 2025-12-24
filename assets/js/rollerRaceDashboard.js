/**
 * 실내 평로라 대회 대시보드
 * ANT+ 1:N 연결로 10개 속도계 센서 관리
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
 * 속도계 시뮬레이션 (테스트용)
 * 회전수 기반 거리 계산 사용
 */
function startSpeedometerSimulation(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  // 선택된 바퀴 규격 가져오기
  const wheelSpec = WHEEL_SPECS[window.rollerRaceState.raceSettings.wheelSize] || WHEEL_SPECS['25-622'];
  const wheelCircumference = wheelSpec.circumference; // mm
  
  // 시뮬레이션 인터벌
  const interval = setInterval(() => {
    if (!speedometer.connected) {
      clearInterval(interval);
      return;
    }
    
    // 랜덤 속도 생성 (20~50 km/h)
    const speed = 20 + Math.random() * 30;
    
    // 1초당 회전수 계산
    const revolutionsPerSecond = calculateRevolutionsPerSecond(speed, wheelCircumference);
    
    // 총 회전수 누적
    speedometer.totalRevolutions += revolutionsPerSecond;
    
    // 회전수 기반 거리 계산
    speedometer.currentSpeed = speed;
    speedometer.totalDistance = calculateDistanceFromRevolutions(speedometer.totalRevolutions, wheelCircumference);
    
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
  
  // 디바이스 목록 초기화
  const deviceList = document.getElementById('antDeviceList');
  if (deviceList) {
    deviceList.classList.add('hidden');
    deviceList.innerHTML = '';
  }
}

/**
 * ANT+ 디바이스 검색
 */
async function searchANTDevices() {
  const searchButton = document.getElementById('btnSearchANTDevices');
  const searchButtonText = document.getElementById('searchButtonText');
  const deviceList = document.getElementById('antDeviceList');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  
  if (!searchButton || !deviceList) return;
  
  // 검색 중 상태로 변경
  searchButton.disabled = true;
  if (searchButtonText) searchButtonText.textContent = '검색 중...';
  deviceList.classList.remove('hidden');
  deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">ANT+ 디바이스를 검색하는 중...</div>';
  
  // 검색된 디바이스 목록
  const foundDevices = [];
  
  try {
    // ANT+ 디바이스 검색 로직
    // 실제 구현은 ANT+ 라이브러리나 Web USB/Serial API를 사용해야 합니다
    // 여기서는 시뮬레이션으로 구현
    
    if (typeof connectANTSpeedometer === 'function') {
      // 실제 ANT+ 검색 함수가 있는 경우
      const devices = await scanANTDevices();
      foundDevices.push(...devices);
    } else {
      // 시뮬레이션 모드: 실제 하드웨어가 없을 때 테스트용 디바이스 표시
      // 실제 구현 시 이 부분은 제거하고 실제 검색 로직으로 대체
      setTimeout(() => {
        const simulatedDevices = [
          { id: '12345', name: 'ANT+ Speed Sensor 1', type: 'Speed/Cadence' },
          { id: '23456', name: 'ANT+ Speed Sensor 2', type: 'Speed/Cadence' },
          { id: '34567', name: 'ANT+ Speed Sensor 3', type: 'Speed/Cadence' }
        ];
        displayANTDevices(simulatedDevices);
      }, 2000);
      return;
    }
    
    // 실제 검색 결과 표시
    if (foundDevices.length > 0) {
      displayANTDevices(foundDevices);
    } else {
      deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">검색된 디바이스가 없습니다.<br>디바이스가 켜져 있고 페어링 모드인지 확인하세요.</div>';
    }
  } catch (error) {
    console.error('[ANT+ 디바이스 검색 오류]', error);
    deviceList.innerHTML = `<div style="padding: 16px; text-align: center; color: #d32f2f;">검색 중 오류가 발생했습니다.<br>${error.message || '알 수 없는 오류'}</div>`;
  } finally {
    // 검색 완료 후 버튼 상태 복원
    searchButton.disabled = false;
    if (searchButtonText) searchButtonText.textContent = '다시 검색';
  }
}

/**
 * ANT+ 디바이스 스캔 (실제 구현 필요)
 */
async function scanANTDevices() {
  // 실제 ANT+ 디바이스 스캔 로직
  // ANT+ USB 스틱이나 Web USB/Serial API를 사용하여 구현
  // 반환 형식: [{ id: string, name: string, type: string }, ...]
  
  return new Promise((resolve) => {
    // 시뮬레이션: 2초 후 빈 배열 반환 (실제 구현 시 제거)
    setTimeout(() => {
      resolve([]);
    }, 2000);
  });
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

