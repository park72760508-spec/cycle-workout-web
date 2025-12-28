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
    distanceMode: 'total', // 'individual' or 'total' (개인 거리 or 통합 거리)
    endByTime: false,
    targetTime: 0, // seconds (HH:MM:SS 형식으로 저장)
    wheelSize: '25-622' // 기본값: 700 x 25C
  },
  wakeLock: null, // 화면 잠금 해제용
  rankings: [], // 순위 정보
  rankDisplayStartIndex: 0, // 전광판 순위 표시 시작 인덱스
  rankDisplayTimer: null, // 순위 표시 순환 타이머
  raceDataHistory: [], // 경기 중 데이터 히스토리 (주기적 저장)
  dataSaveTimer: null, // 데이터 저장 타이머
  connectionStatusCheckTimer: null, // 연결 상태 체크 타이머
  needleAngles: {} // 각 속도계의 이전 바늘 각도 (속도계 ID -> 각도)
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
  MAX_CHANNELS: 8, // USB ANT+ 수신기의 실제 최대 채널 수 (채널 0-7 또는 1-8)
  SCAN_CHANNEL: 0, // 스캔용 채널 번호 (스캔 모드에서는 채널 0번 하나만 사용)
  MIN_CHANNEL: 1, // 사용 가능한 최소 채널 번호
  MAX_CHANNEL: 7, // 사용 가능한 최대 채널 번호 (USB 수신기는 8개 채널만 지원)
  // 참고: 스캔 모드를 사용하므로 실제로는 채널 제한 없이 여러 디바이스 수신 가능
  // 하지만 하드웨어 제한을 고려하여 MAX_CHANNELS를 8로 설정
};

// 속도계 데이터 구조
class SpeedometerData {
  constructor(id, name, deviceId = null) {
    this.id = id;
    this.name = name;
    this.deviceId = deviceId;
    this.pairingName = null; // 페어링 시 설정되는 이름 (트랙명과 별도)
    this.connected = false;
    this.currentSpeed = 0; // km/h
    this.maxSpeed = 0; // km/h
    this.averageSpeed = 0; // km/h
    this.totalDistance = 0; // km
    this.totalRevolutions = 0; // 총 회전수
    this.lastUpdateTime = null;
    this.lastRevolutions = 0; // 마지막 회전수 (CSC 센서에서)
    this.lastEventTime = 0; // 마지막 이벤트 시간 (1/1024초 단위)
    this.lastPacketTime = 0; // 마지막 패킷 수신 시간 (ms)
    this.speedHistory = []; // 최근 속도 기록 (그래프용)
    this.speedSum = 0; // 평균 속도 계산용
    this.speedCount = 0; // 평균 속도 계산용
    this.filteredSpeed = 0; // [추가] 가민 스타일 필터링 속도
    this.lastDecelerationCheck = Date.now(); // [추가] 감속 체크 시간
    this.previousSpeed = 0; // [추가] 이전 속도 (궤적선 동기화용)
  }
}

/**
 * 대시보드 초기화
 */
/**
 * 대시보드 초기화
 * 센서 연결 즉시 정지 감지가 작동하도록 타이머 로직을 전면에 배치했습니다.
 */
function initRollerRaceDashboard() {
  console.log('[평로라 대회] 대시보드 초기화');
  
  // 저장된 데이터 및 설정 로드
  loadSpeedometerList();
  createSpeedometerGrid();
  updateSpeedometerListUI();
  loadRaceSettings();
  loadTargetSettings();
  
  // 수신기 및 UI 상태 초기화
  updateReceiverButtonStatus();
  window.rollerRaceTimer = null;
  
  // 전광판 초기값 설정
  const scoreboardTimeEl = document.getElementById('scoreboardTime');
  const scoreboardDistanceEl = document.getElementById('scoreboardDistance');
  const scoreboardRidersEl = document.getElementById('scoreboardRiders');
  if (scoreboardTimeEl) scoreboardTimeEl.textContent = '00:00:00';
  if (scoreboardDistanceEl) scoreboardDistanceEl.textContent = '0.0';
  if (scoreboardRidersEl) scoreboardRidersEl.textContent = '0';
  
  // 순위 표시 초기화 및 타겟 설정 업데이트
  window.rollerRaceState.rankDisplayStartIndex = 0;
  stopRankDisplayRotation();
  updateTargetSettingsDisplay();
  
  // 버튼 초기 상태 설정
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  const btnBack = document.getElementById('btnBackFromRollerRace');
  
  if (btnStart) btnStart.disabled = false;
  if (btnPause) btnPause.disabled = true;
  if (btnStop) btnStop.disabled = true;
  if (btnBack) btnBack.disabled = false;

  // [핵심 수정] 경기 시작 전이라도 센서가 인식되면 정지를 감지할 수 있도록 타이머 즉시 시작
  startConnectionStatusCheck(); 

  // 화면 잠금 활성화 및 리사이즈 이벤트 등록
  activateWakeLock();
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => { normalizeTrackWidths(); }, 150);
  });
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
    const speedometer = window.rollerRaceState.speedometers[i] || new SpeedometerData(i + 1, `트랙${i + 1}`);
    if (!window.rollerRaceState.speedometers[i]) {
      window.rollerRaceState.speedometers[i] = speedometer;
    }
    
    const speedometerEl = createSpeedometerElement(speedometer);
    grid.appendChild(speedometerEl);
    
    // 페어링 이름 업데이트
    if (speedometer.pairingName) {
      updateSpeedometerPairingName(speedometer.id, speedometer.pairingName);
    }
    
    // 연결 상태 업데이트
    // deviceId가 없으면 미연결, deviceId가 있으면 준비됨 또는 연결됨 상태로 표시
    if (!speedometer.deviceId) {
      updateSpeedometerConnectionStatus(speedometer.id, false, 'disconnected');
    } else if (speedometer.connected) {
      // 센서 데이터를 받고 있으면 연결됨
      updateSpeedometerConnectionStatus(speedometer.id, true, 'connected');
    } else {
      // deviceId가 있지만 센서 데이터를 받지 않고 있으면 준비됨
      updateSpeedometerConnectionStatus(speedometer.id, false, 'ready');
    }
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
    <div class="speedometer-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; position: relative !important;">
      <span class="speedometer-pairing-name" id="pairing-name-${speedometer.id}" style="font-size: 12px !important; color: #ffffff !important; font-weight: 500 !important; flex: 0 0 auto !important; text-align: left !important; min-width: 80px !important; order: 1 !important;">${speedometer.pairingName || ''}</span>
      <span class="speedometer-name" style="position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; font-weight: 600 !important; text-align: center !important; order: 2 !important; z-index: 1 !important; background: rgba(0, 212, 170, 0.5) !important; color: #ffffff !important; padding: 6px 12px !important; border-radius: 8px !important; display: inline-block !important;">트랙${speedometer.id}</span>
      <div class="connection-status-center" id="status-${speedometer.id}" style="position: static !important; left: auto !important; transform: none !important; flex: 0 0 auto !important; text-align: right !important; margin-left: auto !important; order: 3 !important; justify-content: flex-end !important;">
        <span class="status-dot disconnected"></span>
        <span class="status-text">미연결</span>
      </div>
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
        
        <!-- 바늘 행적선 (바늘 밑에 위치) -->
        <g id="needle-path-${speedometer.id}" class="speedometer-needle-path" transform="translate(100, 140)">
        </g>
        
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
          <span class="speed-stat-value" id="max-speed-value-${speedometer.id}">0.0</span>
          <div class="speed-stat-label-wrapper">
            <span class="speed-stat-label">최대</span>
            <span class="speed-unit-bottom">km/h</span>
          </div>
        </div>
        <div class="speed-stat-row speed-stat-avg">
          <span class="speed-stat-value" id="avg-speed-value-${speedometer.id}">0.0</span>
          <div class="speed-stat-label-wrapper">
            <span class="speed-stat-label">평균</span>
            <span class="speed-unit-bottom">km/h</span>
          </div>
        </div>
      </div>
      <!-- 중앙: 거리 (단위는 하단에 표시) -->
      <div class="speed-display-center">
        <div class="speed-value-wrapper">
          <span class="speed-value" id="distance-value-${speedometer.id}">0.0</span>
          <div class="speed-unit-bottom">km</div>
        </div>
      </div>
      <!-- 우측: 현재속도 -->
      <div class="distance-display-right">
        <div class="speed-value-wrapper">
          <span class="distance-value" id="speed-value-${speedometer.id}">0</span>
          <div class="speed-unit-bottom">km/h</div>
        </div>
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
 * 60km/h 경계를 넘어갈 때 반대로 돌아가지 않도록 연속적인 각도 추적

function updateSpeedometerNeedle(speedometerId, speed) {
  const needle = document.getElementById(`needle-${speedometerId}`);
  if (!needle) return;
  
  // 바늘 각도 계산 (공통 함수 사용)
  const targetAngle = calculateNeedleAngle(speed);
  
  // 이전 각도 가져오기 (연속적인 각도 값 유지)
  let previousAngle = window.rollerRaceState.needleAngles[speedometerId];
  
  if (previousAngle === undefined) {
    // 첫 번째 업데이트인 경우, 목표 각도로 초기화
    previousAngle = targetAngle;
    window.rollerRaceState.needleAngles[speedometerId] = previousAngle;
  }
  
  // 이전 속도 가져오기 (속도 변화 방향 판단용)
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  const previousSpeed = speedometer?.previousSpeed ?? speed;
  speedometer.previousSpeed = speed;
  
  // 속도 변화 방향에 따라 각도 변화 방향 결정
  const speedDiff = speed - previousSpeed;
  
  // 이전 각도 정규화
  let normalizedPrevious = previousAngle;
  while (normalizedPrevious >= 360) normalizedPrevious -= 360;
  while (normalizedPrevious < 0) normalizedPrevious += 360;
  
  // 각도 차이 계산
  let angleDiff = targetAngle - normalizedPrevious;
  
  // 180도 이상 차이나는 경우 최단 경로 선택
  if (Math.abs(angleDiff) > 180) {
    if (speedDiff > 0) {
      // 속도 증가: 각도 증가 방향
      if (angleDiff < 0) angleDiff += 360;
    } else if (speedDiff < 0) {
      // 속도 감소: 각도 감소 방향
      if (angleDiff > 0) angleDiff -= 360;
    } else {
      // 속도 변화 없음: 최단 경로 선택
      if (angleDiff > 180) {
        angleDiff -= 360;
      } else if (angleDiff < -180) {
        angleDiff += 360;
      }
    }
  }
  
  // 이전 각도에서 연속적으로 이동한 새로운 각도 계산
  let newAngle = normalizedPrevious + angleDiff;
  
  // 각도를 0~360도 범위로 정규화 (표시용)
  let displayAngle = newAngle;
  while (displayAngle >= 360) displayAngle -= 360;
  while (displayAngle < 0) displayAngle += 360;
  
  // 이전 각도 저장 (정규화된 값으로 저장)
  window.rollerRaceState.needleAngles[speedometerId] = displayAngle;
  
  // 부드러운 애니메이션을 위해 transition 적용
  // 그룹이 이미 translate(100, 140)로 이동되어 있으므로, 바늘은 원점(0,0) 기준으로 회전
  needle.style.transition = 'transform 0.3s ease-out';
  needle.setAttribute('transform', `rotate(${displayAngle})`);
  
  // 바늘 행적선 업데이트
  updateSpeedometerNeedlePath(speedometerId, speed);
}
 */




/**
 * 속도계 바늘 업데이트 (부드러운 애니메이션 최적화)
 * 60km/h 경계값을 부드럽게 넘어가도록 설계되었습니다.
 */
function updateSpeedometerNeedle(speedometerId, speed) {
  const needle = document.getElementById(`needle-${speedometerId}`);
  if (!needle) return;
  
  // 1. 목표 각도 계산 (기존 공식 유지)
  const targetAngle = calculateNeedleAngle(speed);
  
  // 2. 이전 각도 상태 가져오기
  let previousAngle = window.rollerRaceState.needleAngles[speedometerId];
  
  if (previousAngle === undefined) {
    previousAngle = targetAngle;
    window.rollerRaceState.needleAngles[speedometerId] = targetAngle;
  }

  // 3. 최단 경로 회전 계산 (360도 회전 방지)
  // 바늘이 0도와 360도 사이를 지나갈 때 반대로 한 바퀴 도는 현상을 방지합니다.
  let diff = targetAngle - (previousAngle % 360);
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  
  const finalAngle = previousAngle + diff;
  window.rollerRaceState.needleAngles[speedometerId] = finalAngle;

  // 4. 애니메이션 속성 적용
  // cubic-bezier(0.25, 0.1, 0.25, 1)는 실제 기계 바늘처럼 처음에 빠르고 끝에 부드럽게 멈춥니다.
  // 0.4초는 ANT+ 센서 데이터 수신 주기(0.25s) 사이를 자연스럽게 이어줍니다.
  needle.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)';
  needle.setAttribute('transform', `rotate(${finalAngle})`);
  
  // 5. 바늘 행적선 업데이트
  // 속도 변화 방향에 따라 궤적선 업데이트 전략이 달라집니다:
  // - 감속 시: 목표 속도를 기준으로 즉시 궤적 업데이트 (바늘이 지나간 부분 즉시 삭제)
  // - 증가 시: 이전 각도를 기준으로 궤적 업데이트 + 애니메이션 완료 후 목표 속도까지 업데이트
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  const previousSpeed = speedometer?.previousSpeed ?? 0;
  const isAccelerating = speed > previousSpeed;
  const isDecelerating = speed < previousSpeed;
  
  if (isDecelerating) {
    // 감속 시: 목표 속도를 기준으로 즉시 궤적 업데이트 (바늘이 지나간 부분 즉시 삭제)
    updateSpeedometerNeedlePath(speedometerId, speed);
  } else if (isAccelerating) {
    // 증가 시: 바늘의 현재 실제 각도(previousAngle)를 기준으로 궤적선을 즉시 업데이트
    // 급격한 속도 증가 시 바늘이 목표 위치에 도달하기 전에 궤적선이 먼저 그려지는 문제 방지
    const currentNeedleSpeed = calculateSpeedFromAngle(previousAngle);
    updateSpeedometerNeedlePath(speedometerId, currentNeedleSpeed);
    
    // 바늘 애니메이션 완료 후 목표 속도까지 궤적선 업데이트
    const animationDuration = 400; // 0.4초 = 400ms
    setTimeout(() => {
      updateSpeedometerNeedlePath(speedometerId, speed);
    }, animationDuration);
  } else {
    // 속도 변화 없음: 현재 속도 기준으로 업데이트
    updateSpeedometerNeedlePath(speedometerId, speed);
  }
  
  // 속도 저장 (다음 비교용)
  if (speedometer) {
    speedometer.previousSpeed = speed;
  }
}




/**
 * 속도에 따른 바늘 각도 계산 (공통 함수)
 * 0~60km/h: 270도 + 180도 × (현재속도/120)
 * 60km/h 초과: 180도 × (현재속도/120) - 90도
 */
function calculateNeedleAngle(speed) {
  const maxSpeed = 120;
  let angle;
  if (speed <= 60) {
    // 0~60km/h: 270도 + 180도 × (속도/120)
    // speed = 0 → angle = 270도
    // speed = 60 → angle = 270 + 90 = 360도 (0도)
    angle = 270 + 180 * (speed / maxSpeed);
  } else {
    // 60km/h 초과: 180도 × (속도/120) - 90도
    // speed = 60.01 → angle = 180*(60.01/120) - 90 = 0.015도
    // speed = 120 → angle = 180 - 90 = 90도
    angle = 180 * (speed / maxSpeed) - 90;
  }
  
  // 각도를 0~360도 범위로 정규화
  while (angle >= 360) angle -= 360;
  while (angle < 0) angle += 360;
  
  return angle;
}

/**
 * 바늘 각도에서 속도로 역변환 (궤적선 동기화용)
 * 각도 → 속도 변환
 * 
 * calculateNeedleAngle의 역함수:
 * - 0~60km/h: angle = 270 + 180 * (speed / 120) → speed = (angle - 270) * 120 / 180
 * - 60~120km/h: angle = 180 * (speed / 120) - 90 → speed = (angle + 90) * 120 / 180
 */
function calculateSpeedFromAngle(angle) {
  const maxSpeed = 120;
  
  // 각도를 0~360도 범위로 정규화
  let normalizedAngle = angle;
  while (normalizedAngle >= 360) normalizedAngle -= 360;
  while (normalizedAngle < 0) normalizedAngle += 360;
  
  let speed;
  
  // 각도 범위에 따른 속도 계산
  if (normalizedAngle >= 270) {
    // 270~360도: 0~60km/h 구간
    // angle = 270 → speed = 0
    // angle = 360(0) → speed = 60 (하지만 360도는 0도로 정규화되므로 별도 처리)
    speed = ((normalizedAngle - 270) / 180) * maxSpeed;
  } else if (normalizedAngle >= 0 && normalizedAngle < 90) {
    // 0~90도: 60~120km/h 구간
    // angle = 0 → speed = (0 + 90) * 120 / 180 = 60
    // angle = 90 → speed = (90 + 90) * 120 / 180 = 120
    speed = ((normalizedAngle + 90) / 180) * maxSpeed;
  } else {
    // 90~270도 범위는 속도계 범위 밖 (이론적으로 발생하지 않아야 함)
    // 안전장치: 가장 가까운 경계값 사용
    if (normalizedAngle >= 90 && normalizedAngle < 180) {
      speed = maxSpeed; // 120km/h (90도에 해당)
    } else {
      speed = 60; // 60km/h (270도에 해당)
    }
  }
  
  // 속도 범위 제한
  if (speed < 0) speed = 0;
  if (speed > maxSpeed) speed = maxSpeed;
  
  return speed;
}

/**
 * 속도계 바늘 행적선 업데이트
 * 눈금 위치(5km/h 간격)에서만 반지름 실선을 그림
 * 속도가 감소하면 현재 속도보다 높은 지점의 선은 삭제
 */
/**
 * 속도계 바늘 행적선 업데이트 (수정본)
 * 바늘의 각도 계산 공식과 Math.cos/sin 좌표계를 정확히 일치시킴
 */
function updateSpeedometerNeedlePath(speedometerId, speed) {
  const pathGroup = document.getElementById(`needle-path-${speedometerId}`);
  if (!pathGroup) return;
  
  const maxSpeed = 120;
  const centerX = 0; // transform(100, 140)으로 이미 이동됨
  const centerY = 0; 
  const radius = 80; 
  const innerRadius = radius - 10; 
  const tickLengthShort = 7; 
  const tickLengthLong = 14; 
  const centerCircleRadius = 7; 
  
  // 현재 속도까지의 2.5km/h 단위 눈금 계산 (기존 5km/h의 1/2 간격)
  const tickInterval = 2.5;
  const currentTickSpeed = Math.floor(speed / tickInterval) * tickInterval;
  const maxTickSpeed = Math.min(currentTickSpeed, maxSpeed);
  
  // 모든 기존 궤적 삭제 (감속 시 바늘이 지나간 부분 제거)
  pathGroup.innerHTML = '';
  
  // 현재 속도까지만 궤적 표시 (바늘이 지나간 부분은 자동으로 제거됨)
  for (let tickSpeed = 0; tickSpeed <= maxTickSpeed; tickSpeed += tickInterval) {
    // 1. 바늘과 동일한 각도 계산
    let needleAngle = calculateNeedleAngle(tickSpeed);
    
    // 2. 좌표계 보정 (핵심 수정 부분)
    // SVG rotate(0)은 '위쪽'을 가리키지만, Math.cos(0)은 '오른쪽'을 가리킵니다.
    // 바늘 각도에서 90도를 빼야 Math 좌표계와 일치하게 됩니다.
    let mathAngle = needleAngle - 90; 
    
    const rad = (mathAngle * Math.PI) / 180;
    
    // 3. 선의 길이 결정 (10km 단위는 길게, 2.5km/h 간격에 맞춤)
    const isMajor = tickSpeed % 10 === 0;
    const tickLength = isMajor ? tickLengthLong : tickLengthShort;
    const outerRadius = innerRadius + tickLength;
    
    // 4. 좌표 계산
    const startRadius = centerCircleRadius + 1;
    const x1 = centerX + startRadius * Math.cos(rad);
    const y1 = centerY + startRadius * Math.sin(rad);
    const x2 = centerX + outerRadius * Math.cos(rad);
    const y2 = centerY + outerRadius * Math.sin(rad);
    
    // 5. SVG Line 생성 및 추가
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(0, 255, 200, 0.4)'); // 민트색 반투명
    line.setAttribute('stroke-width', '1.2');
    line.setAttribute('stroke-linecap', 'round');
    
    pathGroup.appendChild(line);
  }
}


/**
 * 속도계 데이터 업데이트
 */
function updateSpeedometerData(speedometerId, speed, distance) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  // 속도 값을 즉시 반영 (0이어도 반영)
  speedometer.currentSpeed = speed;
  speedometer.totalDistance = distance;
  speedometer.lastUpdateTime = Date.now();
  
  // 최대속도 업데이트 (속도가 0이 아닐 때만)
  if (speed > speedometer.maxSpeed) {
    speedometer.maxSpeed = speed;
  }
  
  // 평균속도 계산 (누적 평균, 속도가 0보다 클 때만)
  if (speed > 0) {
    speedometer.speedSum += speed;
    speedometer.speedCount += 1;
    speedometer.averageSpeed = speedometer.speedSum / speedometer.speedCount;
  }
  
  // UI 업데이트 (속도가 0이어도 즉시 반영)
  // 중앙: 거리, 우측: 속도로 변경됨
  const speedValueEl = document.getElementById(`speed-value-${speedometerId}`); // 우측에 표시
  const maxSpeedValueEl = document.getElementById(`max-speed-value-${speedometerId}`);
  const avgSpeedValueEl = document.getElementById(`avg-speed-value-${speedometerId}`);
  const distanceValueEl = document.getElementById(`distance-value-${speedometerId}`); // 중앙에 표시
  
  if (speedValueEl) {
    // 우측에 속도 표시 (속도가 0이어도 즉시 "0.0"으로 표시)
    speedValueEl.textContent = speed.toFixed(1);
  }
  if (maxSpeedValueEl) maxSpeedValueEl.textContent = speedometer.maxSpeed.toFixed(1);
  if (avgSpeedValueEl) avgSpeedValueEl.textContent = speedometer.averageSpeed.toFixed(1);
  if (distanceValueEl) {
    // 중앙에 거리 표시
    distanceValueEl.textContent = distance.toFixed(2);
  }
  
  // 직선 트랙 내 속도 및 거리 표시 업데이트
  updateStraightTrackStats(speedometerId, speed, distance);
  
  // 바늘 업데이트 (속도가 0이어도 즉시 반영)
  updateSpeedometerNeedle(speedometerId, speed);
  
  // 순위 업데이트
  updateRankings();
  
  // 전체 통계 업데이트
  updateDashboardStats();
  
  // 직선 트랙 마스코트 위치 업데이트 (경기 진행 중일 때만)
  if (window.rollerRaceState.raceState === 'running') {
    updateAllStraightTrackMascots();
  }
}

/**
 * 순위 업데이트
 */
function updateRankings() {
  // 누적거리 기준으로 정렬
  const sorted = [...window.rollerRaceState.speedometers]
    .filter(s => s.connected && s.totalDistance > 0)
    .sort((a, b) => b.totalDistance - a.totalDistance);
  
  // 최대 거리 계산 (진행률 계산용)
  const maxDistance = sorted.length > 0 ? sorted[0].totalDistance : 1;
  
  // 순위 UI 업데이트 및 마스코트 위치 업데이트
  sorted.forEach((speedometer, index) => {
    const rank = index + 1;
    
    // 순위 이미지 업데이트
    const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
    if (rankEl) {
      if (rank >= 1 && rank <= 10) {
        rankEl.src = `assets/img/${rank}.png`;
        rankEl.alt = `${rank}위`;
        rankEl.style.display = 'inline-block';
      } else {
        rankEl.style.display = 'none';
      }
    }
    
    // 직선 트랙 순위 업데이트
    updateStraightTrackRank(speedometer.id, rank);
    
    // 거리 격차 계산 및 업데이트 (앞 순위와의 거리 차이)
    if (index > 0) {
      // 앞 순위(더 앞에 있는 선수)와의 거리 차이 계산
      const aheadRank = index; // 앞 순위 (0-based index이므로 rank-1)
      const aheadDistance = sorted[index - 1].totalDistance; // km
      const currentDistance = speedometer.totalDistance; // km
      const gapKm = aheadDistance - currentDistance; // km
      const gapMeters = gapKm * 1000; // m로 변환
      updateStraightTrackGap(speedometer.id, aheadRank, gapMeters);
    } else {
      // 1등은 격차 표시 안 함
      updateStraightTrackGap(speedometer.id, null, null);
    }
  });
  
  // 연결되지 않았거나 거리가 0인 속도계는 순위 표시 안 함
  window.rollerRaceState.speedometers.forEach(speedometer => {
    if (!speedometer.connected || speedometer.totalDistance === 0) {
      const rankEl = document.getElementById(`rank-value-${speedometer.id}`);
      if (rankEl) {
        rankEl.style.display = 'none';
      }
      // 직선 트랙 순위 숨김
      updateStraightTrackRank(speedometer.id, null);
      // 거리 격차 숨김
      updateStraightTrackGap(speedometer.id, null, null);
      // 마스코트를 시작 위치로
      updateStraightTrackMascot(speedometer.id, 0);
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
        // 페어링 이름을 우선 사용, 없으면 기본 이름 사용
        if (nameEl) nameEl.textContent = speedometer.pairingName || speedometer.name || '-';
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
  
  // 항상 3개 고정 표시 (순위가 1개만 있어도 3개 표시)
  // 시작 인덱스는 항상 0 (순위가 3개 이하일 때는 순환하지 않음)
  let startIndex = 0;
  if (totalRanks > 3) {
    startIndex = window.rollerRaceState.rankDisplayStartIndex;
  } else {
    window.rollerRaceState.rankDisplayStartIndex = 0;
  }
  
  const rankItems = ranksContainer.querySelectorAll('.rank-item');
  
  // 항상 3개 고정 표시 (순위가 1개만 있어도 3개 표시)
  for (let i = 0; i < 3; i++) {
    const item = rankItems[i];
    if (!item) continue;
    
    // 순환 인덱스 계산: startIndex + i가 totalRanks를 넘어가면 빈 상태로 표시
    let targetIndex = startIndex + i;
    
    if (totalRanks > 0 && targetIndex < totalRanks) {
      // 표시할 순위가 있는 경우
      const speedometer = sorted[targetIndex];
      const nameEl = item.querySelector('.rank-name');
      const distanceEl = item.querySelector('.rank-distance');
      const numberEl = item.querySelector('.rank-number');
      
      const rank = targetIndex + 1;
      if (nameEl) nameEl.textContent = speedometer.pairingName || speedometer.name || '-';
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
      // 순위가 없거나 해당 인덱스에 데이터가 없는 경우 (빈 상자)
      const nameEl = item.querySelector('.rank-name');
      const distanceEl = item.querySelector('.rank-distance');
      const numberEl = item.querySelector('.rank-number');
      if (nameEl) nameEl.textContent = '-';
      if (distanceEl) distanceEl.textContent = '0.0km';
      if (numberEl) numberEl.style.display = 'none';
      item.classList.add('rank-item-visible'); // 항상 표시
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
  
  // 경기 종료 조건 확인 (거리 체크)
  if (window.rollerRaceState.raceState === 'running') {
    checkRaceEndConditions();
  }
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
  
  // 경기 종료 조건 확인 (시간 체크)
  checkRaceEndConditions();
}

/**
 * 타겟 설정 토글 함수
 */
function toggleTargetDistance() {
  const enabled = document.getElementById('targetDistanceEnabled');
  const controls = document.getElementById('targetDistanceControls');
  if (enabled && controls) {
    if (enabled.checked) {
      controls.style.opacity = '1';
      controls.style.pointerEvents = 'auto';
      controls.querySelectorAll('input, select').forEach(el => el.disabled = false);
    } else {
      controls.style.opacity = '0.4';
      controls.style.pointerEvents = 'none';
      controls.querySelectorAll('input, select').forEach(el => el.disabled = true);
    }
  }
}

function toggleTargetTime() {
  const enabled = document.getElementById('targetTimeEnabled');
  const controls = document.getElementById('targetTimeControls');
  if (enabled && controls) {
    if (enabled.checked) {
      controls.style.opacity = '1';
      controls.style.pointerEvents = 'auto';
      controls.querySelectorAll('input').forEach(el => el.disabled = false);
    } else {
      controls.style.opacity = '0.4';
      controls.style.pointerEvents = 'none';
      controls.querySelectorAll('input').forEach(el => el.disabled = true);
    }
  }
}

/**
 * 타겟 설정 저장
 */
function saveTargetSettings() {
  const distanceEnabled = document.getElementById('targetDistanceEnabled');
  const distanceValue = document.getElementById('targetDistanceValue');
  const distanceMode = document.getElementById('targetDistanceMode');
  const timeEnabled = document.getElementById('targetTimeEnabled');
  const timeValue = document.getElementById('targetTimeValue');
  
  if (!distanceEnabled || !timeEnabled) return;
  
  const settings = window.rollerRaceState.raceSettings;
  
  // 거리 설정
  settings.endByDistance = distanceEnabled.checked;
  if (distanceEnabled.checked && distanceValue) {
    settings.targetDistance = parseFloat(distanceValue.value) || 0;
  }
  if (distanceMode) {
    settings.distanceMode = distanceMode.value || 'total';
  }
  
  // 시간 설정
  settings.endByTime = timeEnabled.checked;
  if (timeEnabled.checked && timeValue) {
    const timeStr = timeValue.value.trim();
    if (timeStr.match(/^(\d{2}):(\d{2}):(\d{2})$/)) {
      const [hours, minutes, seconds] = timeStr.split(':').map(Number);
      settings.targetTime = hours * 3600 + minutes * 60 + seconds;
    } else {
      settings.targetTime = 0;
    }
  }
  
  // 저장
  try {
    localStorage.setItem('rollerRaceSettings', JSON.stringify(settings));
  } catch (error) {
    console.error('[타겟 설정 저장 오류]', error);
  }
  
  if (typeof showToast === 'function') {
    showToast('타겟 설정이 저장되었습니다.');
  }
  
  console.log('[타겟 설정 저장]', settings);
  
  // 타겟 설정 표시 업데이트
  updateTargetSettingsDisplay();
}

/**
 * 타겟 설정 표시 업데이트 (속도계 목록 옆에 표시)
 */
function updateTargetSettingsDisplay() {
  const settings = window.rollerRaceState.raceSettings;
  const targetDisplayEl = document.getElementById('targetSettingsDisplay');
  
  if (!targetDisplayEl) return;
  
  let displayText = '';
  
  if (settings.endByDistance && settings.targetDistance > 0) {
    const modeText = settings.distanceMode === 'total' ? '통합' : '개인';
    displayText += `${modeText} 거리: ${settings.targetDistance}km`;
  }
  
  if (settings.endByTime && settings.targetTime > 0) {
    if (displayText) displayText += ' / ';
    const hours = Math.floor(settings.targetTime / 3600);
    const minutes = Math.floor((settings.targetTime % 3600) / 60);
    const seconds = settings.targetTime % 60;
    displayText += `시간: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  
  if (!displayText) {
    displayText = '타겟 미설정';
  }
  
  targetDisplayEl.textContent = displayText;
  targetDisplayEl.style.display = displayText ? 'inline-block' : 'none';
}

/**
 * 타겟 설정 로드
 */
function loadTargetSettings() {
  const settings = window.rollerRaceState.raceSettings;
  
  const distanceEnabled = document.getElementById('targetDistanceEnabled');
  const distanceValue = document.getElementById('targetDistanceValue');
  const distanceMode = document.getElementById('targetDistanceMode');
  const timeEnabled = document.getElementById('targetTimeEnabled');
  const timeValue = document.getElementById('targetTimeValue');
  
  if (distanceEnabled) distanceEnabled.checked = settings.endByDistance || false;
  if (distanceValue) distanceValue.value = settings.targetDistance || 10;
  if (distanceMode) distanceMode.value = settings.distanceMode || 'total';
  if (timeEnabled) timeEnabled.checked = settings.endByTime || false;
  
  if (timeValue && settings.targetTime) {
    const hours = Math.floor(settings.targetTime / 3600);
    const minutes = Math.floor((settings.targetTime % 3600) / 60);
    const seconds = settings.targetTime % 60;
    timeValue.value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else if (timeValue) {
    timeValue.value = '00:00:00';
  }
  
  // 토글 상태 적용
  toggleTargetDistance();
  toggleTargetTime();
  
  // 타겟 설정 표시 업데이트
  updateTargetSettingsDisplay();
}

/**
 * 시간 입력 자동 포맷팅 (HH:MM:SS)
 */
function formatTimeInput(input) {
  let value = input.value.replace(/[^0-9]/g, ''); // 숫자만 추출
  
  if (value.length > 6) {
    value = value.substring(0, 6); // 최대 6자리
  }
  
  // HH:MM:SS 형식으로 변환
  let formatted = '';
  if (value.length > 0) {
    formatted = value.substring(0, 2);
    if (value.length > 2) {
      formatted += ':' + value.substring(2, 4);
      if (value.length > 4) {
        formatted += ':' + value.substring(4, 6);
      }
    }
  }
  
  input.value = formatted;
}

/**
 * 경기 종료 조건 확인
 */
function checkRaceEndConditions() {
  if (window.rollerRaceState.raceState !== 'running') {
    return;
  }
  
  const settings = window.rollerRaceState.raceSettings;
  let shouldEnd = false;
  let endReason = '';
  
  // 거리 조건 체크
  if (settings.endByDistance && settings.targetDistance > 0) {
    if (settings.distanceMode === 'total') {
      // 통합 거리: 모든 속도계의 총 거리 합계
      const totalDistance = window.rollerRaceState.speedometers
        .filter(s => s.deviceId && s.connected)
        .reduce((sum, s) => sum + s.totalDistance, 0);
      
      if (totalDistance >= settings.targetDistance) {
        const elapsed = window.rollerRaceState.totalElapsedTime || 0;
        
        // 통합 거리 달성 시 1등 선수의 finishTime 저장 (1등이 결승선 통과)
        const sortedByDistance = window.rollerRaceState.speedometers
          .filter(s => s.deviceId && s.connected)
          .sort((a, b) => b.totalDistance - a.totalDistance);
        
        if (sortedByDistance.length > 0) {
          const firstPlace = sortedByDistance[0];
          if (firstPlace.finishTime === null) {
            firstPlace.finishTime = elapsed;
            console.log(`[결승점 도달] 1등 트랙${firstPlace.id} (${firstPlace.pairingName || firstPlace.name}): ${elapsed}초`);
          }
        }
        
        shouldEnd = true;
        endReason = `통합 거리 달성: ${totalDistance.toFixed(2)}km >= ${settings.targetDistance}km`;
        console.log(`[경기 종료] ${endReason}`);
      }
    } else if (settings.distanceMode === 'individual') {
      // 개인 거리: 모든 선수가 목표 거리에 도달했는지 확인
      const connectedSpeedometers = window.rollerRaceState.speedometers
        .filter(s => s.deviceId && s.connected);
      
      if (connectedSpeedometers.length > 0) {
        const elapsed = window.rollerRaceState.totalElapsedTime || 0;
        
        // 각 속도계가 목표 거리에 도달했을 때 finishTime 저장
        connectedSpeedometers.forEach(s => {
          if (s.totalDistance >= settings.targetDistance && s.finishTime === null) {
            s.finishTime = elapsed;
            console.log(`[결승점 도달] 트랙${s.id} (${s.pairingName || s.name}): ${elapsed}초`);
          }
        });
        
        // 모든 연결된 속도계가 목표 거리에 도달했는지 확인
        const allReached = connectedSpeedometers.every(s => s.totalDistance >= settings.targetDistance);
        
        if (allReached) {
          shouldEnd = true;
          const lastReached = connectedSpeedometers
            .filter(s => s.totalDistance >= settings.targetDistance)
            .sort((a, b) => b.totalDistance - a.totalDistance)[0];
          endReason = `모든 선수 목표 거리 달성 (마지막 주자: ${lastReached.pairingName || lastReached.name}, ${lastReached.totalDistance.toFixed(2)}km)`;
          console.log(`[경기 종료] ${endReason}`);
        }
      }
    }
  }
  
  // 시간 조건 체크
  if (!shouldEnd && settings.endByTime && settings.targetTime > 0) {
    const elapsed = window.rollerRaceState.totalElapsedTime || 0;
    if (elapsed >= settings.targetTime) {
      shouldEnd = true;
      const hours = Math.floor(settings.targetTime / 3600);
      const minutes = Math.floor((settings.targetTime % 3600) / 60);
      const seconds = settings.targetTime % 60;
      const targetTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      endReason = `목표 시간 도달: ${targetTimeStr}`;
      console.log(`[경기 종료] ${endReason}`);
    }
  }
  
  if (shouldEnd) {
    stopRace();
    if (typeof showToast === 'function') {
      showToast(endReason || '경기가 종료되었습니다!');
    }
  }
}

/**
 * 경기 시작 카운트다운
 */
function startRaceWithCountdown() {
  if (window.rollerRaceState.raceState === 'running') return;
  
  // 일시정지 상태에서 재개하는 경우는 카운트다운 없이 바로 시작
  if (window.rollerRaceState.raceState === 'paused') {
    startRace();
    return;
  }
  
  console.log('[경기 시작 카운트다운]');
  
  const overlay = document.getElementById('countdownOverlay');
  const numberEl = document.getElementById('countdownNumber');
  
  if (!overlay || !numberEl) {
    console.warn('카운트다운 오버레이를 찾을 수 없습니다. 바로 시작합니다.');
    startRace();
    return;
  }
  
  // 오버레이 표시
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  
  let countdown = 5;
  numberEl.textContent = countdown;
  numberEl.style.fontSize = '120px';
  numberEl.style.color = '#ffffff';
  
  // 첫 번째 비프음
  if (typeof playBeep === 'function') {
    playBeep(880, 120, 0.25);
  }
  
  const countdownTimer = setInterval(() => {
    countdown -= 1;
    
    if (countdown > 0) {
      numberEl.textContent = countdown;
      // 비프음 재생
      if (typeof playBeep === 'function') {
        playBeep(880, 120, 0.25);
      }
    } else {
      // "Go!" 표시
      numberEl.textContent = 'Go!';
      numberEl.style.fontSize = '100px';
      numberEl.style.color = '#00ff88';
      numberEl.style.textShadow = '0 0 20px rgba(0, 255, 136, 0.8), 0 0 40px rgba(0, 255, 136, 0.6)';
      
      // Go! 효과음 (더 긴 소리)
      if (typeof playBeep === 'function') {
        playBeep(1500, 700, 0.4, 'square');
      }
      
      clearInterval(countdownTimer);
      
      // 0.5초 후 오버레이 숨기고 경기 시작
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        startRace();
      }, 500);
    }
  }, 1000);
}

/**
 * 화면 잠금 활성화 (절전 모드 방지)
 */
async function activateWakeLock() {
  if (!('wakeLock' in navigator)) {
    console.warn('[WakeLock] Wake Lock API not supported in this browser.');
    return;
  }
  try {
    // 이미 있으면 재요청하지 않음
    if (window.rollerRaceState.wakeLock) return;
    window.rollerRaceState.wakeLock = await navigator.wakeLock.request('screen');
    console.log('[WakeLock] Screen wake lock acquired');

    // 시스템이 임의로 해제했을 때 플래그 정리
    window.rollerRaceState.wakeLock.addEventListener('release', () => {
      console.log('[WakeLock] Screen wake lock released by system');
      window.rollerRaceState.wakeLock = null;
    });
  } catch (err) {
    console.warn('[WakeLock] Failed to acquire wake lock:', err);
    window.rollerRaceState.wakeLock = null;
  }
}

/**
 * 화면 잠금 해제
 */
async function releaseWakeLock() {
  try {
    if (window.rollerRaceState.wakeLock) {
      await window.rollerRaceState.wakeLock.release();
      console.log('[WakeLock] Screen wake lock released by app');
    }
  } catch (err) {
    console.warn('[WakeLock] Failed to release wake lock:', err);
  } finally {
    window.rollerRaceState.wakeLock = null;
  }
}

/**
 * 경기 시작
 */
function startRace() {
  if (window.rollerRaceState.raceState === 'running') return;
  
  console.log('[경기 시작]');
  
  if (window.rollerRaceState.raceState === 'paused') {
    const now = Date.now();
    window.rollerRaceState.pausedTime += now - window.rollerRaceState.pauseStartTime;
    window.rollerRaceState.raceState = 'running';
    startRaceDataSaving();
    startConnectionStatusCheck();
  } else {
    // 새 경기 시작
    window.rollerRaceState.startTime = Date.now();
    window.rollerRaceState.pausedTime = 0;
    window.rollerRaceState.raceState = 'running';
    window.rollerRaceState.totalElapsedTime = 0;
    
    window.rollerRaceState.speedometers.forEach(s => {
      s.finishTime = null;
    });
    
    window.rollerRaceState.needleAngles = {};
    window.rollerRaceState.speedometers.forEach(s => {
      window.rollerRaceState.needleAngles[s.id] = 270;
      const needle = document.getElementById(`needle-${s.id}`);
      if (needle) {
        needle.style.transition = 'none';
        needle.setAttribute('transform', 'rotate(270)');
      }
      const pathGroup = document.getElementById(`needle-path-${s.id}`);
      if (pathGroup) pathGroup.innerHTML = '';
    });
    
    // 데이터 초기화 및 동기화 플래그 설정
    window.rollerRaceState.speedometers.forEach(s => {
      s.totalDistance = 0;
      s.totalRevolutions = 0;
      s.currentSpeed = 0;
      s.maxSpeed = 0;
      s.averageSpeed = 0;
      s.speedSum = 0;
      s.speedCount = 0;
      
      // [수정 핵심] lastRevolutions를 0으로 리셋하지 않고 동기화 플래그 부여
      // 이렇게 해야 센서의 현재 누적값을 경기 시작점으로 인식합니다.
      s.needsSync = true; 
      s.lastEventTime = 0; 
      
      updateStraightTrackStats(s.id, 0, 0);
    });
    
    window.rollerRaceState.mascotPositions = {};
    const elapsedTimeEl = document.getElementById('elapsedTime');
    const scoreboardTimeEl = document.getElementById('scoreboardTime');
    if (elapsedTimeEl) elapsedTimeEl.textContent = '00:00:00';
    if (scoreboardTimeEl) scoreboardTimeEl.textContent = '00:00:00';
    
    updateAllStraightTrackMascots();
  }
  
  if (window.rollerRaceTimer) {
    clearInterval(window.rollerRaceTimer);
    window.rollerRaceTimer = null;
  }
  
  updateElapsedTime();
  window.rollerRaceTimer = setInterval(() => { updateElapsedTime(); }, 1000);
  
  startRaceDataSaving();
  startConnectionStatusCheck();
  
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  const btnBack = document.getElementById('btnBackFromRollerRace');

  if (btnStart) btnStart.disabled = true;
  if (btnPause) btnPause.disabled = false;
  if (btnStop) btnStop.disabled = false;
  if (btnBack) btnBack.disabled = true;

  if (window.antState.usbDevice) {
    if (typeof startContinuousScan === 'function') startContinuousScan();
  }
  
  startRankDisplayRotation();
  activateWakeLock();

  if (typeof showToast === 'function') showToast('경기가 시작되었습니다!');
}

/**
 * 경기 일시정지
 */
function pauseRace() {
  if (window.rollerRaceState.raceState !== 'running') return;
    
    window.rollerRaceState.raceState = 'paused';
    window.rollerRaceState.pauseStartTime = Date.now();
    
    if (window.rollerRaceTimer) {
      clearInterval(window.rollerRaceTimer);
      window.rollerRaceTimer = null;
    }
  
  // 데이터 저장 일시정지 (데이터는 유지)
  stopRaceDataSaving();
  
  // 연결 상태 체크 일시정지
  stopConnectionStatusCheck();
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  const btnBack = document.getElementById('btnBackFromRollerRace');

  if (btnStart) btnStart.disabled = false;
  if (btnPause) btnPause.disabled = true;
  if (btnStop) btnStop.disabled = false; // 종료 버튼은 일시정지 중에도 활성화
  // 뒤로가기 버튼은 경기 진행 중이므로 비활성화 유지

  // 전광판 순위 순환 정지
  stopRankDisplayRotation();

  if (typeof showToast === 'function') {
    showToast('경기가 일시정지되었습니다.');
  }
}

/**
 * 경기 종료
 */
/**
 * 경기 종료
 * 종료 후에도 바퀴 정지 감지가 작동하도록 상태 체크 정지 로직을 제거했습니다.
 */
function stopRace() {
  console.log('[경기 종료]');
  
  // 경기가 이미 종료되었거나 시작되지 않았으면 무시
  if (window.rollerRaceState.raceState === 'finished' || window.rollerRaceState.raceState === 'idle') {
    console.warn('[경기 종료] 경기가 이미 종료되었거나 시작되지 않았습니다. 현재 상태:', window.rollerRaceState.raceState);
    return;
  }
  
  window.rollerRaceState.raceState = 'finished';
  
  // 경기 타이머(경과 시간) 정지
  if (window.rollerRaceTimer) {
    clearInterval(window.rollerRaceTimer);
    window.rollerRaceTimer = null;
  }
  
  // 데이터 저장 정지
  stopRaceDataSaving();
  
  // [핵심 수정] 아래 코드를 삭제하거나 주석 처리하여 종료 후에도 정지 감지가 작동하게 합니다.
  // stopConnectionStatusCheck(); 
  
  // 화면 잠금 해제
  releaseWakeLock();
  
  // 버튼 상태 업데이트
  const btnStart = document.getElementById('btnStartRace');
  const btnPause = document.getElementById('btnPauseRace');
  const btnStop = document.getElementById('btnStopRace');
  const btnBack = document.getElementById('btnBackFromRollerRace');

  if (btnStart) btnStart.disabled = false;
  if (btnPause) btnPause.disabled = true;
  if (btnStop) btnStop.disabled = true;
  if (btnBack) btnBack.disabled = false; // 경기 종료 시 뒤로가기 활성화

  // 최종 순위 및 마스코트 위치 업데이트
  updateRankings();
  updateAllStraightTrackMascots();
  
  // 전광판 순위 순환 정지 및 초기화
  stopRankDisplayRotation();
  window.rollerRaceState.rankDisplayStartIndex = 0;
  updateRankDisplay(false);
  
  // 경기 종료 리포트 생성
  generateRaceReportPDF();

  if (typeof showToast === 'function') {
    showToast('경기가 종료되었습니다. 리포트가 생성되었습니다.');
  }
}

/**
 * 속도계 페어링
 */
/**
 * [수정됨] 속도계 페어링
 * 하드웨어 채널을 열지 않고, ID만 등록하여 스캔 데이터가 매칭되도록 함
 */
async function pairSpeedometer(speedometerId) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  if (!speedometer) return;
  
  // 페어링 모달 띄우기 (기존 함수 활용)
  // 전역 변수에 타겟 ID 저장하여 모달에서 저장 시 활용
  window.currentTargetSpeedometerId = speedometerId;
  
  // 모달 UI 설정
  const modal = document.getElementById('addSpeedometerModal');
  const nameInput = document.getElementById('speedometerName');
  const deviceIdInput = document.getElementById('speedometerDeviceId');
  const modalTitle = modal ? modal.querySelector('.modal-header h3') : null;
  
  if (modal) {
    // 트랙명 생성 (트랙1~10 형식)
    const trackName = `트랙${speedometerId}`;
    
    // 모달 제목에 트랙명 표시
    if (modalTitle) {
      modalTitle.textContent = `${trackName} 페어링`;
    }
    
    // 트랙명 표시 영역 추가/업데이트
    let trackNameDisplay = modal.querySelector('.track-name-display');
    if (!trackNameDisplay) {
      trackNameDisplay = document.createElement('div');
      trackNameDisplay.className = 'track-name-display';
      trackNameDisplay.style.cssText = 'padding: 12px; background: #f0f0f0; border-radius: 4px; margin-bottom: 16px; font-weight: 600; color: #333;';
      const modalBody = modal.querySelector('.modal-body');
      if (modalBody) {
        modalBody.insertBefore(trackNameDisplay, modalBody.firstChild);
      }
    }
    trackNameDisplay.innerHTML = `<span style="color: #2e74e8; font-size: 1.1em; font-weight: 600;">${trackName}</span>`;
    
    // 이름 입력 필드 레이블 변경 및 값 설정
    if (nameInput) {
      const nameLabel = nameInput.previousElementSibling;
      if (nameLabel && nameLabel.tagName === 'LABEL') {
        nameLabel.innerHTML = `이름 <span style="color: #666; font-size: 0.9em;">(팀명 및 선수명)</span>`;
      }
      // 페어링 이름이 있으면 표시, 없으면 빈 값
      nameInput.value = speedometer.pairingName || '';
    }
    if (deviceIdInput) deviceIdInput.value = speedometer.deviceId || '';
    // 기존 showAddSpeedometerModal 함수 호출 (자동 활성화 비활성화)
    showAddSpeedometerModal(false); 
  }
}

// [추가] 모달에서 '저장' 버튼 클릭 시 실행될 함수 (addSpeedometer 함수 대체 또는 수정 필요)
// 기존 addSpeedometer 함수 내에 아래 로직을 통합하거나 교체하세요.
function saveSpeedometerPairing() {
    const nameInput = document.getElementById('speedometerName');
    const deviceIdInput = document.getElementById('speedometerDeviceId');
    const targetId = window.currentTargetSpeedometerId;
    
    if (!targetId) return addSpeedometer(); // 타겟이 없으면 신규 추가 로직으로

    const speedometer = window.rollerRaceState.speedometers.find(s => s.id === targetId);
    if (speedometer && nameInput) {
        // 트랙명은 유지하고, 이름만 저장 (별도 필드로 관리하거나 deviceId 옆에 표시)
        const pairingName = nameInput.value.trim();
        const newDeviceId = deviceIdInput.value.trim();
        
        // 중복 체크: 다른 트랙에 이미 지정된 디바이스인지 확인 (트랙1~10만 체크)
        if (newDeviceId) {
            const existingSpeedometer = window.rollerRaceState.speedometers.find(
                s => s.id !== targetId && s.id >= 1 && s.id <= 10 && s.deviceId === newDeviceId && s.deviceId
            );
            
            if (existingSpeedometer) {
                // 이미 다른 트랙에 지정된 경우
                const existingTrackName = `트랙${existingSpeedometer.id}`;
                const currentTrackName = `트랙${targetId}`;
                if (typeof showToast === 'function') {
                    showToast(`이미 ${existingTrackName}에 지정된 센서입니다. 기존 트랙에서 삭제 후 다시 시도해주세요.`, 'error');
                }
                return;
            }
        }
        
        // 기존에 다른 디바이스가 지정되어 있었다면 해당 디바이스 해제
        const oldDeviceId = speedometer.deviceId;
        if (oldDeviceId && oldDeviceId !== newDeviceId) {
            // 기존 디바이스 연결 해제
            speedometer.connected = false;
            updateSpeedometerConnectionStatus(targetId, false);
        }
        
        // 페어링 이름을 별도로 저장 (deviceId 옆에 표시용)
        // 빈 문자열이어도 저장 (사용자가 의도적으로 빈 값으로 설정할 수 있음)
        speedometer.pairingName = pairingName || null;
        
        console.log('[페어링 저장]', {
            speedometerId: targetId,
            pairingName: pairingName,
            savedPairingName: speedometer.pairingName,
            deviceId: newDeviceId
        });
        
        // ID 변경 시 (센서 교체 시)
        if (speedometer.deviceId != newDeviceId) {
            // 경기 중인 경우: 기존 데이터 유지 (거리, 속도 등은 트랙에 연결되므로 유지)
            if (window.rollerRaceState.raceState === 'running' || window.rollerRaceState.raceState === 'paused') {
                // 기존 데이터는 유지하고 deviceId만 변경
                speedometer.deviceId = newDeviceId;
                speedometer.connected = false; 
                updateSpeedometerConnectionStatus(targetId, false);
                console.log(`[경기 중 센서 교체] 트랙${targetId}: 기존 데이터 유지, 새 센서 ID: ${newDeviceId}`);
            } else {
                // 경기 중이 아닌 경우: deviceId만 변경
                speedometer.deviceId = newDeviceId;
            }
        } else if (!speedometer.deviceId && newDeviceId) {
            // deviceId가 없었는데 새로 설정하는 경우
            speedometer.deviceId = newDeviceId;
        }
        
        // deviceId가 설정되어 있으면 준비 상태로 표시 (경기 시작 전)
        if (speedometer.deviceId && (window.rollerRaceState.raceState === 'idle' || !window.rollerRaceState.raceState)) {
            // 경기 시작 전 준비 상태로 연결 상태 업데이트
            // 실제 센서 데이터를 받기 전까지는 준비됨 상태
            speedometer.connected = false;
            updateSpeedometerConnectionStatus(targetId, false, 'ready');
            console.log(`[페어링 완료] 트랙${targetId}: 준비 상태로 설정, deviceId: ${speedometer.deviceId}`);
        }
        
        // 저장 및 UI 갱신
        saveSpeedometerList();
        
        // UI 업데이트 전에 pairingName이 제대로 저장되었는지 확인
        console.log('[UI 업데이트 전]', {
            speedometerId: targetId,
            pairingName: speedometer.pairingName,
            speedometer: speedometer
        });
        
        // 속도계 목록 UI 업데이트
        updateSpeedometerListUI();
        
        // 속도계 그리드 재생성 (이름이 포함되도록)
        createSpeedometerGrid();
        
        // 페어링 이름 업데이트 (그리드 생성 후)
        updateSpeedometerPairingName(targetId, speedometer.pairingName || '');
        
        // 연결 상태 업데이트 (그리드 생성 후)
        if (speedometer.deviceId && (window.rollerRaceState.raceState === 'idle' || !window.rollerRaceState.raceState)) {
            updateSpeedometerConnectionStatus(targetId, true, 'ready');
        }
        
        // 수신기 활성화 버튼 상태 업데이트 (페어링 완료 시)
        updateReceiverButtonStatus();
        
        // 약간의 지연 후 다시 한 번 이름 및 연결 상태 업데이트 (DOM 업데이트 보장)
        setTimeout(() => {
            updateSpeedometerPairingName(targetId, speedometer.pairingName || '');
            // 연결 상태도 다시 업데이트
            if (speedometer.deviceId && (window.rollerRaceState.raceState === 'idle' || !window.rollerRaceState.raceState)) {
                updateSpeedometerConnectionStatus(targetId, true, 'ready');
            }
            // 속도계 목록도 다시 업데이트
            updateSpeedometerListUI();
        }, 100);
        
        closeAddSpeedometerModal();
        
        // 토스트 메시지 표시
        if (typeof showToast === 'function') {
            const trackName = `트랙${targetId}`;
            if (speedometer.pairingName) {
                showToast(`${trackName}에 ${speedometer.pairingName}이(가) 페어링되었습니다.`);
            } else {
                showToast(`${trackName}에 페어링되었습니다.`);
            }
        }
        
        // USB가 연결되어 있다면 바로 스캔 시작하여 연결 확인
        if (window.antState.usbDevice) {
            startContinuousScan(); 
        }
    }
}

/**
 * [신규] 연속 스캔 모드 시작 (경기 중 데이터 수신용)
 */
/**
 * [핵심] 연속 스캔 모드 시작 (15개 이상 동시 수신)
 * Reset(0x4A) 명령을 제거하여 연결 끊김 방지
 */
/**
 * [수정됨] 스캔 모드 진입 (안전한 초기화)
 */
/**
 * [수정] 스캔 모드 대신 일반 채널 열기 테스트
 */
// =========================================================
// [수정 3] 연속 스캔 모드 진입 (안정성 강화)
// =========================================================

/**
 * [수정됨] 스캔 모드 설정 (호환성 모드)
 */
/**
 * [수정됨] Tacx T2028 전용 연속 스캔 모드 설정
 */
/**
 * [재확인] 안정적인 스캔 모드 설정
 */
/**
 * [수정됨] Tacx T2028 전용 스캔 설정 (파라미터 수정)
 * 0x42(Assign Channel) 명령의 파라미터 갯수 오류 수정
 */
async function startContinuousScan() {
  if (!window.antState.usbDevice) return;
  
  // [수정] 중복 실행 방지 (이미 초기화 중이면 차단)
  if (window.antState.isInitializing) {
    console.log('[ANT+] 이미 초기화가 진행 중입니다. 중복 실행을 차단합니다.');
    return;
  }
  
  window.antState.isInitializing = true;
  window.antState.isScanning = true;

  console.log('[ANT+] Tacx T2028 스캔 가동 (안정성 강화 모드)...');

  try {
    // 1. Reset (충분한 대기)
    await sendANTMessage(0x4A, [0x00]);
    await new Promise(r => setTimeout(r, 800));

    // 2. Network Key
    await sendANTMessage(0x46, [0x00, 0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45]);
    await new Promise(r => setTimeout(r, 300));

    // 3. [핵심 수정] Assign Channel 0 (반드시 3바이트 전달)
    // 파라미터: 채널 0, 타입 0x00(Slave Receive), 네트워크 0
    await sendANTMessage(0x42, [0x00, 0x00, 0x00]); 
    await new Promise(r => setTimeout(r, 300));

    // 4. Channel ID (Wildcard)
    await sendANTMessage(0x51, [0x00, 0x00, 0x00, 0x00, 0x00]);
    await new Promise(r => setTimeout(r, 300));

    // 5. Frequency 57 (ANT+ 표준 주파수)
    await sendANTMessage(0x45, [0x00, 57]);
    await new Promise(r => setTimeout(r, 300));

    // 6. LibConfig (Extended Data 활성화)
    await sendANTMessage(0x6E, [0x00, 0xE0]); 
    await new Promise(r => setTimeout(r, 300));

    // 7. Open Rx Scan Mode (0x5B)
    console.log('[ANT+] Rx Scan Mode(0x5B) 명령 전송');
    await sendANTMessage(0x5B, [0x00]); 
    
    if (!window.antMessageListenerActive) {
        window.antMessageListenerActive = true;
        startANTMessageListener();
    }
    
    window.antState.isScanningActive = true;

  } catch (e) {
    console.error('[ANT+] 스캔 설정 오류:', e);
  } finally {
    // 초기화 잠금 해제
    window.antState.isInitializing = false;
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
  
  // 사용 가능한 채널 찾기 (1-7, 스캔 채널 0번 제외)
  // 참고: 현재는 스캔 모드를 사용하므로 이 함수는 실제로 호출되지 않지만,
  // 향후 개별 채널 연결 방식으로 변경 시를 대비하여 유지
  let channelNumber = ANT_CHANNEL_CONFIG.MIN_CHANNEL;
  while (channelNumber <= ANT_CHANNEL_CONFIG.MAX_CHANNEL && window.antState.connectedChannels[channelNumber]) {
    channelNumber++;
  }
  
  if (channelNumber > ANT_CHANNEL_CONFIG.MAX_CHANNEL) {
    throw new Error(`사용 가능한 채널이 없습니다. (최대 ${ANT_CHANNEL_CONFIG.MAX_CHANNELS}개 채널 사용 가능)`);
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
 * 속도계 페어링 이름 업데이트
 */
function updateSpeedometerPairingName(speedometerId, pairingName) {
  const pairingNameEl = document.getElementById(`pairing-name-${speedometerId}`);
  if (pairingNameEl) {
    const displayName = pairingName || '';
    pairingNameEl.textContent = displayName;
    pairingNameEl.style.color = displayName ? '#ffffff' : '#999';
    pairingNameEl.style.fontWeight = displayName ? '500' : 'normal';
    
    console.log('[페어링 이름 업데이트]', {
      speedometerId: speedometerId,
      pairingName: pairingName,
      displayName: displayName,
      elementFound: true
    });
  } else {
    console.warn('[페어링 이름 업데이트 실패]', {
      speedometerId: speedometerId,
      pairingName: pairingName,
      elementNotFound: `pairing-name-${speedometerId}`
    });
  }
}

/**
 * 속도계 연결 상태 UI 업데이트
 * @param {number} speedometerId - 속도계 ID
 * @param {boolean} connected - 연결 여부
 * @param {string} status - 상태 ('ready': 준비됨, 'connected': 연결됨, 'disconnected': 미연결)
 */
function updateSpeedometerConnectionStatus(speedometerId, connected, status = null) {
  const statusEl = document.getElementById(`status-${speedometerId}`);
  if (!statusEl) return;
  
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');
  
  // 속도계 정보 블록 찾기
  const container = document.getElementById(`speedometer-${speedometerId}`);
  const infoBlock = container ? container.querySelector('.speedometer-info') : null;
  
  // 속도계 객체 가져오기
  const speedometer = window.rollerRaceState.speedometers.find(s => s.id === speedometerId);
  
  // 상태 결정 로직:
  // 1. deviceId가 없으면: 미연결 (주황, 미연결)
  // 2. deviceId가 있고 센서 데이터를 받지 않으면: 준비됨 (주황, 준비됨)
  // 3. deviceId가 있고 센서 데이터를 받고 있으면: 연결됨 (초록, 연결됨)
  // 4. deviceId가 있고 30초 이상 데이터 미수신: 타임아웃 (주황, 준비됨)
  
  let finalStatus = 'disconnected';
  let statusText = '미연결';
  let isConnected = false;
  
  if (!speedometer || !speedometer.deviceId) {
    // 디바이스 미설정
    finalStatus = 'disconnected';
    statusText = '미연결';
    isConnected = false;
  } else if (status === 'timeout') {
    // 30초 이상 데이터 미수신
    finalStatus = 'timeout';
    statusText = '준비됨';
    isConnected = false;
  } else if (status === 'connected' || (connected && status !== 'ready')) {
    // deviceId 있음 + 센서 데이터 수신 중
    finalStatus = 'connected';
    statusText = '연결됨';
    isConnected = true;
  } else {
    // deviceId 있음 + 센서 데이터 미수신 (30초 미만)
    finalStatus = 'ready';
    statusText = '준비됨';
    isConnected = false;
  }
  
  // 상태 표시 업데이트
  if (finalStatus === 'connected') {
    dot.classList.remove('disconnected');
    dot.classList.add('connected');
    if (text) text.textContent = statusText;
    
    // 연결됨: 초록색 배경
    if (infoBlock) {
      infoBlock.classList.add('connected');
      infoBlock.classList.remove('disconnected');
    }
  } else {
    // 준비됨, 타임아웃 또는 미연결: 주황색 배경
    if (finalStatus === 'ready' || finalStatus === 'timeout') {
      dot.classList.remove('disconnected');
      dot.classList.add('connected');
    } else {
      dot.classList.remove('connected');
      dot.classList.add('disconnected');
    }
    if (text) text.textContent = statusText;
    
    if (infoBlock) {
      infoBlock.classList.remove('connected');
      infoBlock.classList.add('disconnected');
    }
  }
  
  // speedometer 객체의 connected 상태도 업데이트
  if (speedometer) {
    speedometer.connected = isConnected;
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
  
  // 트랙1~10 순서대로 정렬하여 표시
  for (let i = 0; i < 10; i++) {
    const speedometer = window.rollerRaceState.speedometers[i];
    if (!speedometer) continue;
    
    const item = document.createElement('div');
    item.className = 'speedometer-list-item';
    const trackName = `트랙${speedometer.id}`;
    const pairingName = speedometer.pairingName || '';
    item.innerHTML = `
      <!-- 트랙번호 -->
      <div class="list-item-track-number">
        <span class="list-item-name">${trackName}</span>
      </div>
      <!-- ID -->
      <div class="list-item-id-section">
        <span class="list-item-id">ID: ${speedometer.deviceId || '미설정'}</span>
      </div>
      <!-- 직선 경기장 트랙 -->
      <div class="straight-track-container" id="straight-track-${speedometer.id}">
        <!-- 이름 표시 (주황색 블럭 안 왼쪽) -->
        <div class="track-name-inside">
          <span class="track-name-text">${pairingName || ''}</span>
        </div>
        <!-- 속도 및 이동거리 표시 (주황색 블럭 안 오른쪽 끝) -->
        <div class="track-stats-inside">
          <div class="track-stats-item">
            <span class="track-stat-value" id="straight-speed-text-${speedometer.id}">0</span>
            <span class="track-stat-unit">km/h</span>
          </div>
          <div class="track-stats-item">
            <span class="track-stat-value" id="straight-distance-text-${speedometer.id}">0.00</span>
            <span class="track-stat-unit">km</span>
          </div>
        </div>
        <svg class="straight-track-svg" viewBox="0 0 900 40" preserveAspectRatio="xMidYMid meet">
          <!-- 트랙 배경 (잔디 느낌) - 우측 끝까지 채움 -->
          <rect x="0" y="0" width="900" height="40" fill="#2d5016" opacity="0.2"/>
          
          <!-- 트랙 레인 (10개 레인) -->
          ${generateTrackLanes()}
          
          <!-- 시작선 (좌측) -->
          <line x1="35" y1="0" x2="35" y2="40" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
          
          <!-- 종료선 (우측) - viewBox 끝까지 -->
          <line x1="900" y1="0" x2="900" y2="40" stroke="#ff0000" stroke-width="2" opacity="0.9"/>
          
          <!-- 거리 격차 표시 (결승선 우측) -->
          <g id="straight-gap-group-${speedometer.id}" opacity="0">
            <text x="910" y="22" text-anchor="start" fill="#ffffff" font-size="9" font-weight="400" id="straight-gap-text-${speedometer.id}" dominant-baseline="middle">
              <tspan id="straight-gap-rank-${speedometer.id}">1</tspan>
              <tspan>위와의 격차 : </tspan>
              <tspan id="straight-gap-value-${speedometer.id}" font-weight="500">0</tspan>
              <tspan id="straight-gap-unit-${speedometer.id}" font-weight="300">m</tspan>
            </text>
          </g>
          
          <!-- 마스코트 위치 (자전거 타는 모습) -->
          <g class="straight-race-mascot" id="straight-mascot-${speedometer.id}" transform="translate(35, 20)">
            <!-- 펄스 효과용 빨간색 원 (깜빡임 끝에 퍼지는 효과) -->
            <circle cx="0" cy="0" r="7" class="mascot-pulse-ring" id="mascot-pulse-ring-${speedometer.id}" fill="#ff0000" opacity="0"/>
            <!-- 자전거 프레임 -->
            <circle cx="0" cy="0" r="7" class="mascot-color-ring" id="mascot-color-ring-${speedometer.id}" fill="${getMascotColor(speedometer.id)}" opacity="0.9"/>
            <circle cx="0" cy="0" r="4" fill="#ffffff"/>
          </g>
          
          <!-- 순위 표시 (출발선 왼쪽 녹색 바탕) -->
          <g id="straight-rank-group-${speedometer.id}" opacity="0">
            <rect x="2" y="9" width="30" height="22" rx="11" ry="11" fill="#2d5016" stroke="rgba(255, 255, 255, 0.8)" stroke-width="1.5"/>
            <text x="17" y="22" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold" id="straight-rank-text-${speedometer.id}" dominant-baseline="middle">-</text>
          </g>
        </svg>
      </div>
      <!-- 페어링 버튼 -->
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
    
    // 초기 속도 및 거리 표시 설정
    updateStraightTrackStats(speedometer.id, speedometer.currentSpeed || 0, speedometer.totalDistance || 0);
  }
  
  // 초기 마스코트 위치 설정
  updateAllStraightTrackMascots();
  
  // 모든 경기장 트랙의 너비를 동일하게 맞춤 (가장 작은 넓이 기준)
  // DOM 렌더링 완료 후 실행
  setTimeout(() => {
    normalizeTrackWidths();
  }, 100);
}

/**
 * 모든 경기장 트랙의 너비를 동일하게 맞춤 (가장 작은 넓이 기준)
 * 각 항목의 사용 가능한 공간을 측정하여 경기장 트랙이 차지할 수 있는 최대 공간 계산
 * 가장 짧은 트랙의 오른쪽 끝에 맞춰 모든 트랙을 정렬
 */
function normalizeTrackWidths() {
  const listItems = document.querySelectorAll('.speedometer-list-item');
  if (listItems.length === 0) return;
  
  let minTrackWidth = Infinity;
  let minTrackIndex = -1;
  const trackContainers = [];
  const itemData = []; // 각 항목의 정보 저장
  
  // 1단계: 각 항목의 사용 가능한 트랙 너비 계산 및 데이터 수집
  listItems.forEach((item, index) => {
    const trackNumberEl = item.querySelector('.list-item-track-number');
    const idSectionEl = item.querySelector('.list-item-id-section');
    const actionsEl = item.querySelector('.list-item-actions');
    const trackEl = item.querySelector('.straight-track-container');
    
    if (!trackNumberEl || !idSectionEl || !actionsEl || !trackEl) return;
    
    // 현재 트랙 스타일 저장
    const originalTrackWidth = trackEl.style.width;
    const originalTrackFlex = trackEl.style.flex;
    const originalTrackDisplay = trackEl.style.display;
    
    // 트랙을 임시로 숨겨서 다른 요소들의 실제 너비 측정
    trackEl.style.display = 'none';
    
    // 강제로 리플로우 발생
    void item.offsetWidth;
    
    // 트랙번호 영역 너비 측정
    const trackNumberWidth = trackNumberEl.offsetWidth;
    
    // ID 영역 너비 측정
    const idSectionWidth = idSectionEl.offsetWidth;
    
    // 버튼 영역 너비 측정
    const actionsWidth = actionsEl.offsetWidth;
    
    // 항목의 전체 너비와 패딩, 간격 계산
    const itemWidth = item.offsetWidth;
    const itemStyle = getComputedStyle(item);
    const itemPaddingLeft = parseFloat(itemStyle.paddingLeft);
    const itemPaddingRight = parseFloat(itemStyle.paddingRight);
    const itemGap = parseFloat(itemStyle.gap) || 12;
    
    // 트랙번호 + ID + 버튼 영역 + 간격들을 제외한 트랙이 사용할 수 있는 공간
    // (간격: trackNumber와 idSection 사이, idSection와 track 사이, track과 actions 사이)
    const availableWidth = itemWidth - itemPaddingLeft - itemPaddingRight - trackNumberWidth - idSectionWidth - actionsWidth - (itemGap * 3);
    
    // 가장 짧은 트랙 찾기
    if (availableWidth < minTrackWidth && availableWidth > 0) {
      minTrackWidth = availableWidth;
      minTrackIndex = index;
    }
    
    // 항목 데이터 저장
    itemData[index] = {
      item,
      trackNumberEl,
      idSectionEl,
      actionsEl,
      trackEl,
      trackNumberWidth,
      idSectionWidth,
      actionsWidth,
      itemWidth,
      itemPaddingLeft,
      itemPaddingRight,
      itemGap,
      availableWidth,
      originalTrackWidth,
      originalTrackFlex,
      originalTrackDisplay
    };
    
    trackContainers[index] = trackEl;
    
    // 원래 스타일 복원
    trackEl.style.width = originalTrackWidth;
    trackEl.style.flex = originalTrackFlex;
    trackEl.style.display = originalTrackDisplay || '';
  });
  
  // 2단계: 모든 트랙을 가장 작은 너비로 설정하고 오른쪽 끝 정렬
  if (minTrackWidth !== Infinity && minTrackWidth > 0 && minTrackIndex >= 0) {
    // 최소 너비에서 약간의 여유 공간 제거 (여백 최소화)
    const finalWidth = Math.max(minTrackWidth - 2, 100); // 최소 100px 보장
    
    // 가장 짧은 트랙이 있는 항목의 데이터
    const minItemData = itemData[minTrackIndex];
    
    // 부모 컨테이너 찾기
    const parentContainer = listItems[0]?.parentElement;
    if (!parentContainer) return;
    
    const parentRect = parentContainer.getBoundingClientRect();
    
    // 가장 짧은 트랙이 있는 항목의 트랙 오른쪽 끝 위치 계산 (부모 컨테이너 기준)
    const minItemRect = minItemData.item.getBoundingClientRect();
    const minItemRightEdge = minItemRect.right - parentRect.left; // 부모 컨테이너 기준 상대 위치
    const referenceTrackRightEdge = minItemRightEdge - minItemData.itemPaddingRight - minItemData.actionsWidth - minItemData.itemGap;
    
    // 3단계: 모든 트랙을 동일한 너비로 설정하고 오른쪽 끝 정렬
    listItems.forEach((item, index) => {
      const data = itemData[index];
      if (!data || !data.trackEl) return;
      
      // 각 항목의 오른쪽 끝 위치 (부모 컨테이너 기준)
      const itemRect = item.getBoundingClientRect();
      const itemRightEdge = itemRect.right - parentRect.left;
      
      // 트랙의 오른쪽 끝 위치는 기준 위치로 고정
      const trackRightEdge = referenceTrackRightEdge;
      
      // 트랙의 왼쪽 시작 위치 = 트랙 오른쪽 끝 - 트랙 너비
      const trackLeftEdge = trackRightEdge - finalWidth;
      
      // 항목의 왼쪽 끝 위치 (부모 컨테이너 기준)
      const itemLeftEdge = itemRect.left - parentRect.left;
      
      // 트랙번호 + ID 영역의 오른쪽 끝 위치 (부모 컨테이너 기준)
      const infoRightEdge = itemLeftEdge + data.itemPaddingLeft + data.trackNumberWidth + data.itemGap + data.idSectionWidth + data.itemGap;
      
      // 트랙의 왼쪽 시작 위치가 정보 영역 오른쪽 끝보다 왼쪽에 있으면 조정
      const actualTrackLeft = Math.max(trackLeftEdge, infoRightEdge);
      const actualTrackWidth = Math.min(finalWidth, trackRightEdge - actualTrackLeft);
      
      // marginLeft 계산 (정보 영역 오른쪽 끝에서 트랙 왼쪽 시작까지의 거리)
      const marginLeft = actualTrackLeft - infoRightEdge;
      
      // 트랙 스타일 적용
      data.trackEl.style.width = actualTrackWidth + 'px';
      data.trackEl.style.marginLeft = marginLeft + 'px';
      data.trackEl.style.marginRight = '0';
      data.trackEl.style.flexShrink = '0';
      data.trackEl.style.flexGrow = '0';
      data.trackEl.style.display = '';
    });
    
    console.log('[경기장 트랙] 모든 트랙 너비 통일:', finalWidth + 'px', '(사용 가능 공간:', minTrackWidth + 'px)', '기준 항목:', minTrackIndex + 1, '오른쪽 끝 위치:', referenceTrackRightEdge + 'px');
  }
}

/**
 * 트랙 번호에 따른 마스코트 색상 반환
 * 옵션1: 밝고 채도 높은 색상 (어두운 녹색 배경에서 잘 보임)
 */
function getMascotColor(trackNumber) {
  const colors = {
    1: '#FF4444',  // 빨강
    2: '#4A90E2',  // 파랑
    3: '#FFD700',  // 노랑
    4: '#9B59B6',  // 보라
    5: '#FF8C00',  // 주황
    6: '#00CED1',  // 청록
    7: '#FF69B4',  // 분홍
    8: '#7FFF00',  // 연두
    9: '#D2691E',  // 갈색
    10: '#00BFFF'  // 하늘색
  };
  return colors[trackNumber] || '#FF4444'; // 기본값: 빨강
}

/**
 * 트랙 레인 생성 (10개 레인)
 */
function generateTrackLanes() {
  let lanes = '';
  const laneWidth = 40 / 10; // 총 높이 40을 10개 레인으로 나눔 (50% 축소)
  
  for (let i = 0; i < 10; i++) {
    const y = i * laneWidth;
    // 레인 구분선 (좌측 시작 35, 우측 끝 900까지)
    lanes += `<line x1="35" y1="${y}" x2="900" y2="${y}" stroke="#ffffff" stroke-width="0.8" stroke-dasharray="7,3" opacity="0.4"/>`;
  }
  
  return lanes;
}

/**
 * 모든 직선 트랙 마스코트 위치 업데이트
 * 경기 타입에 따라 다른 로직 적용
 */
/**
 * 모든 직선 트랙 마스코트 위치 업데이트
 * 통합 거리 모드 시 1등 팀이 결승선(Progress 1.0)에 정확히 도달하도록 로직 개선
 */
function updateAllStraightTrackMascots() {
  const settings = window.rollerRaceState.raceSettings;
  const connectedSpeedometers = window.rollerRaceState.speedometers
    .filter(s => s.connected && s.totalDistance > 0);

  // 1. 데이터 부재 시 처리
  if (connectedSpeedometers.length === 0) {
    if (window.rollerRaceState.raceState === 'idle') {
      for (let i = 1; i <= 10; i++) updateStraightTrackMascot(i, 0);
    } else {
      window.rollerRaceState.speedometers.forEach(s => updateStraightTrackMascot(s.id, 0));
    }
    return;
  }

  // 2. 누적거리 기준 정렬 및 1등 거리 산출
  const sorted = [...connectedSpeedometers].sort((a, b) => b.totalDistance - a.totalDistance);
  const firstPlaceDistance = sorted[0].totalDistance;
  const isFinished = window.rollerRaceState.raceState === 'finished';

  // 3. 경기 모드별 진행 위치 계산
  if (settings.distanceMode === 'total') {
    /**
     * [통합 경기 방식 개선 로직]
     * 목표: 모든 팀의 합산 거리가 Target에 도달할 때 1등 마스코트가 결승선에 도착
     */
    const totalDistance = window.rollerRaceState.speedometers.reduce((sum, s) => sum + s.totalDistance, 0);
    const targetDistance = settings.targetDistance || 1500; // 기본값 1500km
    
    // 전체 경기 진행률 (0.0 ~ 1.0)
    const gameProgress = Math.min(totalDistance / targetDistance, 1.0);
    
    // 1등 팀의 거리 (0 나누기 방지용 안전장치)
    const leaderDist = Math.max(firstPlaceDistance, 0.0001);

    window.rollerRaceState.speedometers.forEach(speedometer => {
      if (!speedometer.connected || speedometer.totalDistance === 0) {
        updateStraightTrackMascot(speedometer.id, 0, isFinished);
        return;
      }
      
      // 상대적 성과 비율 (해당 팀 거리 / 1등 팀 거리)
      const relativePerformance = speedometer.totalDistance / leaderDist;
      
      // 최종 위치 계산: 전체 진행률 * 상대 성과
      let progress = gameProgress * relativePerformance;

      // [시각적 보정] 99% 이상 도달 시 1등 팀은 결승선에 강제 수렴 (Garmin 스타일)
      if (gameProgress > 0.99 && speedometer.totalDistance === firstPlaceDistance) {
        progress = gameProgress; 
      }

      // 마스코트 업데이트 (종료 상태라면 즉시 이동)
      updateStraightTrackMascot(speedometer.id, Math.min(progress, 1.0), isFinished);
    });

  } else if (settings.distanceMode === 'individual') {
    // 4. 개인 경기 방식 (기존 로직 유지)
    if (settings.endByDistance && settings.targetDistance > 0) {
      const targetDistance = settings.targetDistance;
      window.rollerRaceState.speedometers.forEach(speedometer => {
        if (!speedometer.connected || speedometer.totalDistance === 0) {
          updateStraightTrackMascot(speedometer.id, 0, isFinished);
          return;
        }
        const progress = Math.min(speedometer.totalDistance / targetDistance, 1.0);
        updateStraightTrackMascot(speedometer.id, progress, isFinished);
      });

    } else if (settings.endByTime && settings.targetTime > 0) {
      const targetTime = settings.targetTime;
      const elapsedTime = window.rollerRaceState.totalElapsedTime || 0;
      const firstPlaceProgress = Math.min(elapsedTime / targetTime, 1.0);
      const leaderDist = Math.max(firstPlaceDistance, 0.0001);

      window.rollerRaceState.speedometers.forEach(speedometer => {
        if (!speedometer.connected || speedometer.totalDistance === 0) {
          updateStraightTrackMascot(speedometer.id, 0, isFinished);
          return;
        }
        const relativeProgress = speedometer.totalDistance / leaderDist;
        const progress = Math.min(firstPlaceProgress * relativeProgress, 1.0);
        updateStraightTrackMascot(speedometer.id, progress, isFinished);
      });
    }
  } else {
    // 5. 기본값 (100m 기준 순환 표시)
    window.rollerRaceState.speedometers.forEach(speedometer => {
      if (!speedometer.connected || speedometer.totalDistance === 0) {
        updateStraightTrackMascot(speedometer.id, 0, isFinished);
      } else {
        const progress = Math.min((speedometer.totalDistance / 0.1) % 1.0, 1.0);
        updateStraightTrackMascot(speedometer.id, progress, isFinished);
      }
    });
  }
}

/**
 * 직선 트랙 마스코트 위치 업데이트
 * Lerp(선형 보간)를 사용하여 부드러운 이동 구현
 * @param {number} speedometerId - 속도계 ID
 * @param {number} targetProgress - 목표 진행률 (0.0 ~ 1.0)
 * @param {boolean} forceImmediate - 강제 즉시 이동 (경기 종료 시 사용)
 */
function updateStraightTrackMascot(speedometerId, targetProgress, forceImmediate = false) {
  // targetProgress: 0.0 ~ 1.0 (목표 진행률)
  const mascotEl = document.getElementById(`straight-mascot-${speedometerId}`);
  if (!mascotEl) return;
  
  // 현재 위치 저장 (첫 호출 시 초기화)
  if (!window.rollerRaceState.mascotPositions) {
    window.rollerRaceState.mascotPositions = {};
  }
  
  // 현재 위치 가져오기 (없으면 목표 위치로 초기화)
  let currentProgress = window.rollerRaceState.mascotPositions[speedometerId];
  if (currentProgress === undefined) {
    currentProgress = targetProgress;
  }
  
  // 강제 즉시 이동 (경기 종료 시에만)
  if (forceImmediate) {
    currentProgress = targetProgress;
  } else {
    // Lerp(선형 보간): 부드러운 이동을 위해 현재 위치에서 목표 위치로 점진적으로 이동
    // 목표에 가까울수록 더 빠르게 반응하도록 동적 factor 사용
    const distance = Math.abs(targetProgress - currentProgress);
    
    // 거리 차이에 따라 동적으로 Lerp factor 조정
    // 목표에 가까울수록 더 빠르게 반응하여 정확한 위치 추적
    let lerpFactor;
    if (targetProgress >= 0.95) {
      // 목표에 매우 가까울 때: 매우 빠르게 반응 (0.7 ~ 0.9)
      lerpFactor = 0.7 + (targetProgress - 0.95) * 4; // 0.95일 때 0.7, 1.0일 때 0.9
    } else if (targetProgress >= 0.8) {
      // 목표에 가까울 때: 빠르게 반응 (0.6 ~ 0.7)
      lerpFactor = 0.6 + (targetProgress - 0.8) * 0.5; // 0.8일 때 0.6, 0.95일 때 0.675
    } else if (distance > 0.05) {
      // 거리 차이가 클 때: 빠르게 이동 (0.5)
      lerpFactor = 0.5;
    } else {
      // 거리 차이가 작을 때: 빠르게 이동 (0.4) - 부드럽지만 빠르게
      lerpFactor = 0.4;
    }
    
    // Lerp(current, target, factor) = current + (target - current) * factor
    currentProgress = currentProgress + (targetProgress - currentProgress) * lerpFactor;
    
    // 목표에 매우 가까우면(0.01 이하 차이) 즉시 목표 위치로 (더 빠른 수렴)
    if (Math.abs(targetProgress - currentProgress) < 0.01) {
      currentProgress = targetProgress;
    }
  }
  
  // 위치 저장
  window.rollerRaceState.mascotPositions[speedometerId] = currentProgress;
  
  // 직선 트랙: 시작선(35)에서 종료선(900)까지 (viewBox 전체 너비)
  const startX = 35;
  const endX = 900; // viewBox의 끝 (0 0 900 40)
  const trackLength = endX - startX; // 900 - 35 = 865
  const x = startX + (trackLength * currentProgress);
  const y = 20; // 트랙 중앙 (높이 50% 축소: 40 → 20)
  
  mascotEl.classList.add('moving');
  mascotEl.setAttribute('transform', `translate(${x}, ${y})`);
  
  // 애니메이션 완료 후 클래스 제거
  setTimeout(() => {
    mascotEl.classList.remove('moving');
  }, 500);
}

/**
 * 직선 트랙 내 속도 및 거리 표시 업데이트
 */
function updateStraightTrackStats(speedometerId, speed, distance) {
  const speedTextEl = document.getElementById(`straight-speed-text-${speedometerId}`);
  const distanceTextEl = document.getElementById(`straight-distance-text-${speedometerId}`);
  
  if (speedTextEl) {
    // 현재 속도 표시 (숫자만, 단위는 별도 span)
    speedTextEl.textContent = speed.toFixed(1);
  }
  
  if (distanceTextEl) {
    // 이동거리 표시 (숫자만, 단위는 별도 span)
    distanceTextEl.textContent = distance.toFixed(2);
  }
  
  // 속도값이 인지되면 마스코트 색깔띠 원에 깜빡임 효과 및 펄스 효과 적용
  const mascotRingEl = document.getElementById(`mascot-color-ring-${speedometerId}`);
  const mascotPulseEl = document.getElementById(`mascot-pulse-ring-${speedometerId}`);
  if (mascotRingEl) {
    if (speed > 0) {
      mascotRingEl.classList.add('blinking');
      if (mascotPulseEl) {
        mascotPulseEl.classList.add('blinking');
      }
    } else {
      mascotRingEl.classList.remove('blinking');
      if (mascotPulseEl) {
        mascotPulseEl.classList.remove('blinking');
      }
    }
  }
}

/**
 * 직선 트랙 순위 업데이트
 */
function updateStraightTrackRank(speedometerId, rank) {
  const rankGroupEl = document.getElementById(`straight-rank-group-${speedometerId}`);
  const rankTextEl = document.getElementById(`straight-rank-text-${speedometerId}`);
  if (!rankGroupEl || !rankTextEl) return;
  
  if (rank && rank > 0) {
    rankTextEl.textContent = `${rank}위`;
    rankGroupEl.style.opacity = '1';
    // 순위별 텍스트 색상 (상자 배경색은 트랙번호 라벨과 동일하게 유지)
    rankTextEl.style.fill = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#ffffff';
  } else {
    rankGroupEl.style.opacity = '0';
  }
}

/**
 * 직선 트랙 거리 격차 업데이트 (앞 순위와의 거리 차이)
 */
function updateStraightTrackGap(speedometerId, aheadRank, gapMeters) {
  const gapGroupEl = document.getElementById(`straight-gap-group-${speedometerId}`);
  const gapRankEl = document.getElementById(`straight-gap-rank-${speedometerId}`);
  const gapValueEl = document.getElementById(`straight-gap-value-${speedometerId}`);
  
  if (!gapGroupEl || !gapRankEl || !gapValueEl) return;
  
  if (aheadRank !== null && aheadRank !== undefined && gapMeters !== null && gapMeters !== undefined && gapMeters > 0) {
    // 앞 순위 표시
    gapRankEl.textContent = aheadRank;
    // 미터 단위로 표시 (소수점 없이 정수로)
    gapValueEl.textContent = Math.round(gapMeters);
    gapGroupEl.style.opacity = '1';
  } else {
    // 1등이거나 격차가 없으면 숨김
    gapGroupEl.style.opacity = '0';
  }
}

/**
 * USB 수신기 활성화 모달 표시
 */
async function showUSBReceiverActivationModal() {
  const modal = document.getElementById('usbReceiverActivationModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
  
  // 상태 메시지 초기화
  const messageEl = document.getElementById('usbActivationMessage');
  if (messageEl) {
    messageEl.textContent = 'USB 수신기 상태를 확인 중입니다...';
    messageEl.style.background = '#e7f3ff';
    messageEl.style.color = '#0056b3';
  }
  
  // USB 상태 확인
  await checkUSBActivationStatus();
  
  // 주기적으로 상태 확인 (5초마다)
  if (window.usbActivationStatusInterval) {
    clearInterval(window.usbActivationStatusInterval);
  }
  window.usbActivationStatusInterval = setInterval(() => {
    checkUSBActivationStatus();
  }, 5000);
}

/**
 * USB 수신기 활성화 모달 닫기
 */
function closeUSBReceiverActivationModal() {
  const modal = document.getElementById('usbReceiverActivationModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // 주기적 상태 확인 중지
  if (window.usbActivationStatusInterval) {
    clearInterval(window.usbActivationStatusInterval);
    window.usbActivationStatusInterval = null;
  }
}

/**
 * USB 수신기 활성화 모달에서 활성화 버튼 클릭
 */
async function activateUSBReceiverFromModal() {
  const activateBtn = document.getElementById('btnUSBActivationActivate');
  const messageEl = document.getElementById('usbActivationMessage');
  
  if(activateBtn) activateBtn.disabled = true;
  
  if(messageEl) {
    messageEl.textContent = 'USB 수신기 연결 중...';
    messageEl.style.background = '#fff3cd';
    messageEl.style.color = '#856404';
  }

  // USB가 없으면 연결 시도
  if (!window.antState.usbDevice) {
    try {
      const device = await requestANTUSBDevice();
      await connectANTUSBStickWithDevice(Promise.resolve(device));
      if(messageEl) {
        messageEl.textContent = 'USB 수신기 연결 완료! 스캔 모드를 활성화합니다...';
        messageEl.style.background = '#d4edda';
        messageEl.style.color = '#155724';
      }
      
      // 스캔 모드 활성화
      await startContinuousScan();
      
      if(messageEl) {
        messageEl.textContent = 'USB 수신기 활성화 완료!';
        messageEl.style.background = '#d4edda';
        messageEl.style.color = '#155724';
      }
    } catch(e) {
      if(messageEl) {
        messageEl.textContent = `USB 연결 실패: ${e.message}`;
        messageEl.style.background = '#f8d7da';
        messageEl.style.color = '#721c24';
      }
      if(activateBtn) activateBtn.disabled = false;
      return;
    }
  } else {
    // 이미 연결되어 있다면 스캔 모드 확실히 켜기
    await startContinuousScan();
    if(messageEl) {
      messageEl.textContent = 'USB 수신기 활성화 완료!';
      messageEl.style.background = '#d4edda';
      messageEl.style.color = '#155724';
    }
  }
  
  // USB 상태 업데이트
  await checkUSBActivationStatus();
  
  // 수신기 활성화 버튼 상태 업데이트
  updateReceiverButtonStatus();
  
  if(activateBtn) activateBtn.disabled = false;
  
  // 활성화 완료 후 USB 수신기 선택 목록 화면 표시 (연결 상태와 관계없이 표시)
  // 현재 모달 닫기
  closeUSBReceiverActivationModal();
  
  // 약간의 지연 후 선택 목록 화면 표시 (이미 활성화되었으므로 skipActivation=true)
  setTimeout(() => {
    if(typeof showReceiverSelectionModal === 'function') {
      showReceiverSelectionModal(true); // 이미 활성화되었으므로 활성화 시도 건너뜀
    }
  }, 300);
}

/**
 * USB 수신기 활성화 모달용 USB 상태 확인
 */
async function checkUSBActivationStatus() {
  const statusIcon = document.getElementById('usbActivationStatusIcon');
  const statusText = document.getElementById('usbActivationStatusText');
  const activateButton = document.getElementById('btnUSBActivationActivate');
  const connectButton = document.getElementById('btnUSBActivationConnect');
  
  if (!statusIcon || !statusText) return;
  
  if (activateButton) activateButton.disabled = true;
  if (connectButton) connectButton.disabled = true;
  
  try {
    if (window.antState.usbDevice) {
      try {
        if (window.antState.usbDevice.opened) {
          const deviceInfo = {
            vendorId: '0x' + window.antState.usbDevice.vendorId.toString(16).toUpperCase(),
            productId: '0x' + window.antState.usbDevice.productId.toString(16).toUpperCase(),
            manufacturerName: window.antState.usbDevice.manufacturerName || '알 수 없음',
            productName: window.antState.usbDevice.productName || 'ANT+ USB 수신기'
          };
          statusIcon.style.background = '#28a745';
          statusText.textContent = 'USB 수신기 연결됨';
          if (activateButton) activateButton.disabled = false;
          if (connectButton) connectButton.style.display = 'none';
          return;
        }
      } catch (error) {
        window.antState.usbDevice = null;
      }
    }
    
    if (!navigator.usb) {
      statusIcon.style.background = '#dc3545';
      statusText.textContent = 'Web USB API를 지원하지 않습니다 (Chrome/Edge 필요)';
      if (connectButton) connectButton.style.display = 'none';
      return;
    }
    
    if (typeof navigator.usb.getDevices === 'function') {
      const devices = await navigator.usb.getDevices();
      const antDevices = devices.filter(device => {
        const vid = device.vendorId;
        return vid === 0x0FCF || vid === 0x1004;
      });
      
      if (antDevices.length > 0) {
        const device = antDevices[0];
        let isOpened = false;
        try {
          isOpened = device.opened;
        } catch (e) {
          isOpened = false;
        }
        
        if (isOpened) {
          window.antState.usbDevice = device;
          statusIcon.style.background = '#28a745';
          statusText.textContent = `${device.productName || 'ANT+ USB 수신기'} 연결됨`;
          if (activateButton) activateButton.disabled = false;
          if (connectButton) connectButton.style.display = 'none';
          return;
        }
      }
    }
    
    statusIcon.style.background = '#ffc107';
    statusText.textContent = 'Ant USBStick2 수신기를 연결해주세요';
    if (connectButton) connectButton.style.display = 'inline-block';
    if (activateButton) activateButton.disabled = false;
  } catch (error) {
    console.error('[ANT+ USB 상태 확인 오류]', error);
    statusIcon.style.background = '#dc3545';
    statusText.textContent = '상태 확인 중 오류 발생';
    if (activateButton) activateButton.disabled = false;
  }
}

/**
 * 수신기 선택 모달 표시
 * @param {boolean} skipActivation - true이면 활성화 시도를 건너뜀 (이미 활성화된 경우)
 */
async function showReceiverSelectionModal(skipActivation = false) {
  const modal = document.getElementById('receiverSelectionModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
  
  // 디바이스 목록 초기화
  const deviceList = document.getElementById('receiverSelectionDeviceList');
  if (deviceList) {
    deviceList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">USB 수신기 연결 중...</div>';
  }
  
  // USB 상태 확인
  await checkANTUSBStatusForSelection();
  
  // 모달을 열면서 바로 수신기 활성화 시도 (skipActivation이 false인 경우만)
  if (!skipActivation) {
    await activateReceiverFromSelection();
  }
  
  // 주기적으로 상태 확인 (5초마다)
  if (window.antUSBStatusInterval) {
    clearInterval(window.antUSBStatusInterval);
  }
  window.antUSBStatusInterval = setInterval(() => {
    checkANTUSBStatusForSelection();
  }, 5000);
}

/**
 * 수신기 선택 모달 닫기
 */
function closeReceiverSelectionModal() {
  const modal = document.getElementById('receiverSelectionModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // 주기적 상태 확인 중지
  if (window.antUSBStatusInterval) {
    clearInterval(window.antUSBStatusInterval);
    window.antUSBStatusInterval = null;
  }
}

/**
 * 수신기 선택 화면에서 수신기 활성화
 */
async function activateReceiverFromSelection() {
  const activateBtn = document.getElementById('btnReceiverSelectionActivate');
  if(activateBtn) activateBtn.disabled = true;
  
  const listEl = document.getElementById('receiverSelectionDeviceList');
  if(listEl) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center">USB 수신기 연결 중...</div>';
  }

  // USB가 없으면 연결 시도
  if (!window.antState.usbDevice) {
    try {
      const device = await requestANTUSBDevice();
      await connectANTUSBStickWithDevice(Promise.resolve(device));
      if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:green;font-weight:bold">USB 수신기 연결 완료!<br><small>디바이스 검색 버튼을 클릭하세요.</small></div>';
    } catch(e) {
      if(listEl) listEl.innerHTML = `<div style="color:red;padding:10px">USB 연결 실패: ${e.message}</div>`;
      if(activateBtn) activateBtn.disabled = false;
      return;
    }
  } else {
    // 이미 연결되어 있다면 스캔 모드 확실히 켜기
    await startContinuousScan();
    if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:green;font-weight:bold">USB 수신기 활성화 완료!<br><small>디바이스 검색 버튼을 클릭하세요.</small></div>';
  }
  
  // USB 상태 업데이트
  await checkANTUSBStatusForSelection();
  
  // 수신기 활성화 버튼 상태 업데이트
  updateReceiverButtonStatus();
  
  if(activateBtn) activateBtn.disabled = false;
}

/**
 * 수신기 선택 화면에서 디바이스 검색
 */
async function searchSpeedometerDevicesForSelection() {
  const btn = document.getElementById('btnReceiverSelectionSearch');
  if(btn) btn.disabled = true;
  
  const listEl = document.getElementById('receiverSelectionDeviceList');
  if(listEl) {
    listEl.classList.remove('hidden');
  }

  // USB 수신기가 연결되어 있는지 확인
  if (!window.antState.usbDevice || !window.antState.usbDevice.opened) {
    if(listEl) listEl.innerHTML = '<div style="color:red;padding:10px">USB 수신기를 먼저 활성화해주세요.<br><small>위의 "활성화" 버튼을 클릭하세요.</small></div>';
    if(btn) btn.disabled = false;
    return;
  }

  // 스캔 모드 확실히 켜기
  await startContinuousScan();

  if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:blue;font-weight:bold">속도계 센서 검색 중...<br>바퀴를 굴려주세요!</div>';
  window.antState.foundDevices = []; // 목록 초기화
  
  // 검색 버튼 텍스트 변경
  const searchButtonText = document.getElementById('receiverSelectionSearchButtonText');
  if(searchButtonText) searchButtonText.textContent = '검색 중...';
  
  // 10초 후 검색 중지
  setTimeout(() => {
    if(btn) btn.disabled = false;
    if(searchButtonText) searchButtonText.textContent = '디바이스 검색';
    
    if(window.antState.foundDevices.length === 0) {
      if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">검색된 디바이스가 없습니다.<br><small>바퀴를 굴려주시고 다시 검색해주세요.</small></div>';
    } else {
      // 검색된 디바이스 목록 표시
      displayANTDevicesForSelection(window.antState.foundDevices);
    }
  }, 10000);
}

/**
 * 수신기 선택 화면에 디바이스 목록 표시
 */
function displayANTDevicesForSelection(devices) {
  const list = document.getElementById('receiverSelectionDeviceList');
  if (!list) return;

  if (devices.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">검색된 디바이스가 없습니다.</div>';
    return;
  }
  
  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  devices.forEach(d => {
    // 이미 다른 트랙에 지정된 디바이스인지 확인 (트랙1~10만 체크)
    const existingSpeedometer = window.rollerRaceState.speedometers.find(
      s => s.id >= 1 && s.id <= 10 && s.deviceId == d.deviceNumber && s.deviceId
    );
    
    const isAssigned = !!existingSpeedometer;
    const assignedTrack = existingSpeedometer ? `트랙${existingSpeedometer.id}` : '';
    
    html += `
      <div style="padding:12px; border:1px solid ${isAssigned ? '#ccc' : '#007bff'}; background:${isAssigned ? '#f5f5f5' : '#eef6fc'}; border-radius:5px; cursor:${isAssigned ? 'not-allowed' : 'pointer'}; display:flex; justify-content:space-between; align-items:center; opacity:${isAssigned ? '0.6' : '1'};"
           onclick="${isAssigned ? '' : `selectReceiverDevice('${d.deviceNumber}', '${d.name}')`}">
        <div style="flex: 1;">
            <div style="font-weight:bold; color:${isAssigned ? '#999' : '#0056b3'}; margin-bottom: 4px;">
              ${d.name}
              ${isAssigned ? ` <span style="color:#dc3545; font-size:11px;">(이미 ${assignedTrack}에 지정됨)</span>` : ''}
            </div>
            <div style="font-size:12px; color:${isAssigned ? '#999' : '#555'};">ID: ${d.deviceNumber}</div>
        </div>
        <button style="background:${isAssigned ? '#ccc' : '#007bff'}; color:white; border:none; padding:6px 12px; border-radius:3px; cursor:${isAssigned ? 'not-allowed' : 'pointer'}; font-size:12px;" ${isAssigned ? 'disabled' : ''}>${isAssigned ? '사용중' : '선택'}</button>
      </div>
    `;
  });
  html += '</div>';
  list.innerHTML = html;
}

/**
 * 수신기 선택 화면에서 디바이스 선택
 */
window.selectReceiverDevice = function(deviceId, deviceName) {
  // 선택한 디바이스를 전역 변수에 저장
  window.selectedReceiverDevice = {
    deviceId: deviceId,
    deviceName: deviceName
  };
  
  // 모달 닫기
  closeReceiverSelectionModal();
  
  // 토스트 메시지 표시
  if (typeof showToast === 'function') {
    showToast(`수신기 선택 완료: ${deviceName} (ID: ${deviceId})`);
  }
  
  // 수신기 활성화 버튼 상태 업데이트
  updateReceiverButtonStatus();
  
  console.log('[수신기 선택]', { deviceId, deviceName });
};

/**
 * 수신기 선택 화면용 USB 상태 확인
 */
async function checkANTUSBStatusForSelection() {
  const statusIcon = document.getElementById('receiverSelectionUSBStatusIcon');
  const statusText = document.getElementById('receiverSelectionUSBStatusText');
  const activateButton = document.getElementById('btnReceiverSelectionActivate');
  const connectButton = document.getElementById('btnReceiverSelectionConnectUSB');
  
  if (!statusIcon || !statusText) return;
  
  if (activateButton) activateButton.disabled = true;
  if (connectButton) connectButton.disabled = true;
  
  try {
    if (window.antState.usbDevice) {
      try {
        if (window.antState.usbDevice.opened) {
          const deviceInfo = {
            vendorId: '0x' + window.antState.usbDevice.vendorId.toString(16).toUpperCase(),
            productId: '0x' + window.antState.usbDevice.productId.toString(16).toUpperCase(),
            manufacturerName: window.antState.usbDevice.manufacturerName || '알 수 없음',
            productName: window.antState.usbDevice.productName || 'ANT+ USB 수신기'
          };
          statusIcon.style.background = '#28a745';
          statusText.textContent = 'USB 수신기 연결됨';
          if (activateButton) activateButton.disabled = false;
          if (connectButton) connectButton.style.display = 'none';
          return;
        }
      } catch (error) {
        window.antState.usbDevice = null;
      }
    }
    
    if (!navigator.usb) {
      statusIcon.style.background = '#dc3545';
      statusText.textContent = 'Web USB API를 지원하지 않습니다 (Chrome/Edge 필요)';
      if (connectButton) connectButton.style.display = 'none';
      return;
    }
    
    if (typeof navigator.usb.getDevices === 'function') {
      const devices = await navigator.usb.getDevices();
      const antDevices = devices.filter(device => {
        const vid = device.vendorId;
        return vid === 0x0FCF || vid === 0x1004;
      });
      
      if (antDevices.length > 0) {
        const device = antDevices[0];
        let isOpened = false;
        try {
          isOpened = device.opened;
        } catch (e) {
          isOpened = false;
        }
        
        if (isOpened) {
          window.antState.usbDevice = device;
          statusIcon.style.background = '#28a745';
          statusText.textContent = `${device.productName || 'ANT+ USB 수신기'} 연결됨`;
          if (activateButton) activateButton.disabled = false;
          if (connectButton) connectButton.style.display = 'none';
          return;
        }
      }
    }
    
    statusIcon.style.background = '#ffc107';
    statusText.textContent = 'Ant USBStick2 수신기를 연결해주세요';
    if (connectButton) connectButton.style.display = 'inline-block';
    if (activateButton) activateButton.disabled = false;
  } catch (error) {
    console.error('[ANT+ USB 상태 확인 오류]', error);
    statusIcon.style.background = '#dc3545';
    statusText.textContent = '상태 확인 중 오류 발생';
    if (activateButton) activateButton.disabled = false;
  }
}

/**
 * 속도계 추가 모달 표시 (기존 함수 유지 - 페어링 화면용)
 */
async function showAddSpeedometerModal(autoActivate = true) {
  const modal = document.getElementById('addSpeedometerModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
  
  // 디바이스 목록 초기화 및 표시
  const deviceList = document.getElementById('antDeviceList');
  if (deviceList) {
    deviceList.classList.remove('hidden'); // 목록 영역 표시
    if (autoActivate) {
      deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">USB 수신기 연결 중...</div>';
    } else {
      deviceList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">디바이스 검색 버튼을 클릭하여 수신기를 검색하세요.</div>';
    }
  }
  
  // autoActivate가 true일 때만 자동으로 수신기 활성화 시도
  if (autoActivate) {
    // 모달을 열면서 바로 수신기 활성화 시도
    await activateANTReceiver();
    
    // 주기적으로 상태 확인 (5초마다)
    if (window.antUSBStatusInterval) {
      clearInterval(window.antUSBStatusInterval);
    }
    window.antUSBStatusInterval = setInterval(() => {
      checkANTUSBStatus();
    }, 5000);
  } else {
    // 페어링 모드에서는 주기적 상태 확인만 수행
    if (window.antUSBStatusInterval) {
      clearInterval(window.antUSBStatusInterval);
    }
    window.antUSBStatusInterval = setInterval(() => {
      checkANTUSBStatus();
    }, 5000);
  }
}

/**
 * ANT+ 수신기 활성화 (USB 수신기 연결)
 */
async function activateANTReceiver() {
  const refreshBtn = document.getElementById('btnRefreshUSBStatus');
  if(refreshBtn) refreshBtn.disabled = true;
  
  const listEl = document.getElementById('antDeviceList');
  if(listEl) {
    listEl.classList.remove('hidden');
    listEl.innerHTML = '<div style="padding:20px;text-align:center">USB 수신기 연결 중...</div>';
  }

  // USB가 없으면 연결 시도
  if (!window.antState.usbDevice) {
    try {
      // 사용자 액션(클릭) 내에서 실행되어야 함
      const device = await requestANTUSBDevice();
      await connectANTUSBStickWithDevice(Promise.resolve(device));
      if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:green;font-weight:bold">USB 수신기 연결 완료!</div>';
    } catch(e) {
      if(listEl) listEl.innerHTML = `<div style="color:red;padding:10px">USB 연결 실패: ${e.message}</div>`;
      if(refreshBtn) refreshBtn.disabled = false;
      return;
    }
  } else {
    // 이미 연결되어 있다면 스캔 모드 확실히 켜기
    await startContinuousScan();
    if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:green;font-weight:bold">USB 수신기 활성화 완료!</div>';
  }
  
  // USB 상태 업데이트
  await checkANTUSBStatus();
  
  // 수신기 활성화 버튼 상태 업데이트
  updateReceiverButtonStatus();
  
  if(refreshBtn) refreshBtn.disabled = false;
}

/**
 * 속도계 디바이스 검색 (USB 수신기가 이미 활성화되어 있어야 함)
 */
async function searchSpeedometerDevices() {
  const btn = document.getElementById('btnSearchANTDevices');
  if(btn) btn.disabled = true;
  
  const listEl = document.getElementById('antDeviceList');
  if(listEl) {
    listEl.classList.remove('hidden');
  }

  // USB 수신기가 연결되어 있는지 확인
  if (!window.antState.usbDevice || !window.antState.usbDevice.opened) {
    if(listEl) listEl.innerHTML = '<div style="color:red;padding:10px">USB 수신기를 먼저 활성화해주세요.<br><small>위의 "활성화" 버튼을 클릭하세요.</small></div>';
    if(btn) btn.disabled = false;
    return;
  }

  // 스캔 모드 확실히 켜기
  await startContinuousScan();

  if(listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:blue;font-weight:bold">속도계 센서 검색 중...<br>바퀴를 굴려주세요!</div>';
  window.antState.foundDevices = []; // 목록 초기화
  
  if(btn) btn.disabled = false;
}

/**
 * ANT+ 디바이스 검색 (기존 함수 - 호환성 유지)
 * @deprecated searchSpeedometerDevices() 사용 권장
 */
async function searchANTDevices() {
  return searchSpeedometerDevices();
}

/**
 * 사용자 제스처 컨텍스트에서 즉시 USB 디바이스 요청
 * 이 함수는 동기적으로 호출되어야 함
 */
/**
 * USB 장치 요청 (필터 완화)
 */
function requestANTUSBDevice() {
  // Tacx T2028(0x1008) 및 최신 스틱(0x1009) 모두 포함
  // 필터를 빈 배열로 주면 브라우저가 모든 USB 장치를 보여주므로 호환성이 가장 좋음
  return navigator.usb.requestDevice({ filters: [] });
}

/**
 * 요청된 USB 디바이스로 연결 설정
 */
/**
 * [수정됨] 요청된 USB 디바이스로 연결 설정
 */
/**
 * USB 연결 설정 (엔드포인트 탐색 강화)
 */
/**
 * [수정됨] USB 연결 및 즉시 수신 시작
 */
async function connectANTUSBStickWithDevice(devicePromise) {
  try {
    const device = await devicePromise;
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);

    const endpoints = device.configuration.interfaces[0].alternate.endpoints;
    
    // Tacx T2028 최적화: IN(Interrupt/Bulk), OUT(Bulk/Interrupt)
    let inEndpoint = endpoints.find(e => e.direction === 'in' && e.type === 'interrupt') 
                  || endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
    let outEndpoint = endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
                   || endpoints.find(e => e.direction === 'out' && e.type === 'interrupt');

    if (!inEndpoint || !outEndpoint) throw new Error('ANT+ 엔드포인트를 찾을 수 없습니다.');

    window.antState.usbDevice = device;
    window.antState.inEndpoint = inEndpoint.endpointNumber;
    window.antState.outEndpoint = outEndpoint.endpointNumber;
    
    console.log(`[ANT+] USB 연결 성공 (IN:${inEndpoint.endpointNumber} OUT:${outEndpoint.endpointNumber})`);
    
    // [핵심 변경] 명령 보내기 전에 '듣기'부터 시작 (응답 누락 방지)
    window.antState.isScanning = true; // 리스너 동작 허용
    startANTMessageListener(); 
    
    // 잠시 대기 후 스캔 모드 진입
    setTimeout(() => startContinuousScan(), 500);
    
    checkANTUSBStatus();
    return device;
  } catch (error) {
    console.error('[ANT+ 연결 실패]', error);
    if(typeof showToast === 'function') showToast('USB 연결 실패: ' + error.message);
    throw error;
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
  // [중요] Reset(0x4A) 명령 제거 - 연결 끊김 방지
  // Reset은 startContinuousScan에서 처리하지 않음
  
  // 네트워크 키 설정 (ANT+ 공개 네트워크 키)
  const networkKey = [0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45];
  await sendANTMessage(0x46, [0x00, ...networkKey]); // Set Network Key
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // 채널 주기 설정
  await sendANTMessage(0x60, [0x00, 0x00, 0x00]); // Set Channel Period (기본값)
  await new Promise(resolve => setTimeout(resolve, 50));
  
  console.log('[ANT+] 초기화 완료 (Reset 제외)');
}

/**
 * ANT+ 메시지 전송
 */
/**
 * [수정됨] ANT+ 메시지 전송 (Tacx 호환성 패치: 패딩 제거)
 */
/**
 * [수정됨] ANT+ 메시지 전송 (Tacx T2028 호환성: 64바이트 패딩 적용)
 * 짧은 패킷(5바이트 등)이 거부되는 문제를 해결하기 위해 0으로 채워서 보냅니다.
 */
async function sendANTMessage(messageId, data) {
  if (!window.antState.usbDevice) return;
  
  const length = data.length + 1; // MsgID 포함 길이
  let checksum = 0xA4 ^ length ^ messageId;
  for (let b of data) checksum ^= b;
  
  // 실제 보낼 ANT+ 메시지
  const message = [0xA4, length, messageId, ...data, checksum];
  
  // [핵심 변경] Tacx T2028은 짧은 패킷을 싫어하므로 64바이트로 패딩
  // (USB 엔드포인트의 최대 패킷 크기에 맞춤)
  const paddedPacket = new Uint8Array(64); 
  paddedPacket.set(message, 0); // 앞부분에 메시지 복사, 나머지는 0
  
  try {
    // console.log('[TX]', Array.from(message).map(b=>b.toString(16).padStart(2,'0')).join(' '));
    await window.antState.usbDevice.transferOut(window.antState.outEndpoint, paddedPacket);
  } catch (e) {
    console.warn('[ANT+] 전송 실패:', e);
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
      // 동기화 바이트 이전의 잘못된 데이터 제거
      console.log(`[ANT+] 동기화 바이트 이전 ${syncIndex}바이트 제거`);
      window.antState.messageBuffer = window.antState.messageBuffer.slice(syncIndex);
    }
    
    // 최소 메시지 길이 확인 (Sync + Length + MessageID + Checksum = 4바이트)
    if (window.antState.messageBuffer.length < 4) {
      return null; // 더 많은 데이터 필요
    }
    
    // 동기화 바이트 확인 (버퍼의 첫 번째 바이트가 0xA4여야 함)
    if (window.antState.messageBuffer[0] !== 0xA4) {
      console.warn('[ANT+] 동기화 바이트 오류:', '0x' + window.antState.messageBuffer[0].toString(16).toUpperCase());
      window.antState.messageBuffer = [];
      return null;
    }
    
    const length = window.antState.messageBuffer[1];
    
    // Length 필드 유효성 검사
    // 일반적으로 1-8 사이지만, 일부 확장 메시지는 더 클 수 있음
    // 9 이상이면 버퍼에 여러 메시지가 섞여있을 가능성이 높음
    if (length < 1) {
      console.warn('[ANT+] 잘못된 Length 필드:', length, '버퍼 초기화');
      window.antState.messageBuffer = [];
      return null;
    }
    
    // Length가 8보다 크면 버퍼에 문제가 있을 수 있음
    // 하지만 일부 특수 메시지는 더 클 수 있으므로, 최대 길이를 더 크게 설정
    if (length > 16) {
      console.warn('[ANT+] 비정상적으로 큰 Length 필드:', length, '버퍼 초기화');
      window.antState.messageBuffer = [];
      return null;
    }
    
    // Length가 9 이상이면 로그만 출력하고 계속 진행 (확장 메시지일 수 있음)
    if (length > 8) {
      console.log('[ANT+] 확장 메시지 감지 (Length > 8):', length);
    }
    
    // 메시지 전체 길이 확인 (Sync + Length + MessageID + Data + Checksum)
    // Length는 MessageID(1바이트) + Data 바이트 수를 나타냄
    // 따라서 전체 길이 = Sync(1) + Length(1) + Length바이트 + Checksum(1) = 2 + length + 1
    const totalLength = 2 + length + 1;
    
    // 메시지가 완전히 수신되지 않았으면 대기
    if (window.antState.messageBuffer.length < totalLength) {
      return null; // 더 많은 데이터 필요
    }
    
    // 메시지 추출
    const messageBytes = window.antState.messageBuffer.slice(0, totalLength);
    window.antState.messageBuffer = window.antState.messageBuffer.slice(totalLength);
    
    // 메시지 파싱
    // ANT+ 메시지 구조: [Sync(0xA4), Length, MessageID, Data..., Checksum]
    // Length 필드는 MessageID(1바이트) + Data 바이트 수를 나타냄
    // 예: Length=3이면 MessageID(1) + Data(2) = 3바이트
    const messageId = messageBytes[2];
    const dataLength = length - 1; // Length에서 MessageID(1바이트) 제외
    const messageData = messageBytes.slice(3, 3 + dataLength);
    const checksum = messageBytes[2 + length]; // Sync(1) + Length(1) + MessageID(1) + Data(length-1) = 2 + length
    
    // 디버깅: 원시 메시지 로그 (중요한 메시지만)
    if (messageId === 0x51 || messageId === 0x4E || messageId === 0x43) {
      console.log('[ANT+] 메시지 파싱:', {
        messageId: '0x' + messageId.toString(16).toUpperCase(),
        length: length,
        dataLength: dataLength,
        rawMessage: Array.from(messageBytes).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
        parsedData: Array.from(messageData).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
      });
    }
    
    // 디버깅: 특정 메시지 타입에 대한 상세 로그
    const isImportantMessage = messageId === 0x43 || messageId === 0x4E || messageId === 0x4D || 
                                messageId === 0x51 || messageId === 0x46 || messageId === 0x47 || 
                                messageId === 0xAE;
    
    // 체크섬 검증 (MessageID부터 Data까지)
    const calculatedChecksum = calculateChecksum([messageId, ...messageData]);
    if (checksum !== calculatedChecksum) {
      // 디버깅 정보
      const debugInfo = {
        messageId: '0x' + messageId.toString(16).toUpperCase(),
        received: '0x' + checksum.toString(16).toUpperCase(),
        calculated: '0x' + calculatedChecksum.toString(16).toUpperCase(),
        dataLength: messageData.length,
        length: length,
        rawMessage: Array.from(messageBytes).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
        parsedData: Array.from(messageData).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
      };
      
      // 중요한 메시지들은 체크섬 오류가 있어도 처리
      if (messageId === 0x51) {
        // Channel ID Response는 매우 중요하므로 체크섬 오류가 있어도 처리
        console.log('[ANT+] Channel ID Response (체크섬 오류 무시)', debugInfo);
        return { messageId, data: messageData };
      }
      
      if (messageId === 0x43 || messageId === 0x4E || messageId === 0x4D || 
          messageId === 0x46 || messageId === 0x47) {
        // Channel Event, Broadcast Data, Acknowledged Data, 
        // Burst Data, Extended Broadcast Data는 처리
        console.log('[ANT+] 중요 메시지 (체크섬 오류 무시)', debugInfo);
        return { messageId, data: messageData };
      }
      
      // 0xAE (Capabilities) 메시지는 체크섬 오류가 있어도 처리하되 로그는 최소화
      if (messageId === 0xAE) {
        // Capabilities 메시지는 너무 자주 오므로 로그 최소화
        if (!window.antState.lastCapabilitiesLog || Date.now() - window.antState.lastCapabilitiesLog > 5000) {
          console.log('[ANT+] Capabilities 메시지 (체크섬 오류 무시)', debugInfo);
          window.antState.lastCapabilitiesLog = Date.now();
        }
        return { messageId, data: messageData };
      }
      
      // 체크섬 오류가 발생한 경우 경고만 표시하고 무시
      if (isImportantMessage) {
        console.warn('[ANT+] 체크섬 오류 (메시지 무시)', debugInfo);
      }
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
/**
 * [수정됨] ANT+ 디바이스 스캔 (Continuous Scanning Mode 적용)
 * 상용 표준 방식으로 변경: 채널 0번을 '연속 스캔 모드'로 열어 모든 패킷을 수신합니다.
 */
async function scanANTDevices() {
  if (!window.antState.usbDevice) {
    throw new Error('ANT+ USB 스틱이 연결되어 있지 않습니다.');
  }
  
  console.log('[ANT+ 스캔] Continuous Scanning Mode 진입 시작...');
  
  // 기존 검색 결과 초기화
  window.antState.foundDevices = [];
  window.antState.isScanning = true;
  window.antState.broadcastDevices = window.antState.broadcastDevices || new Map();
  window.antState.broadcastDevices.clear();
  
  // 스캔은 항상 0번 채널 사용
  const channelNumber = 0;
  window.antState.scanChannel = channelNumber;
  
  try {
    // 1. ANT+ 리셋
    await sendANTMessage(0x4A, [0x00]); 
    await new Promise(r => setTimeout(r, 500)); // 리셋 대기 필수
    
    // 2. 네트워크 키 설정 (공개 키)
    const networkKey = [0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45];
    await sendANTMessage(0x46, [0x00, ...networkKey]);
    await new Promise(r => setTimeout(r, 100));

    // 3. 채널 할당 (중요: 0x00 = 일반 양방향 수신 모드로 할당)
    // *기존 코드의 0x20(Background) 대신 0x00 사용*
    await sendANTMessage(0x42, [channelNumber, 0x00]); 
    await new Promise(r => setTimeout(r, 100));

    // 4. 채널 ID 설정 (Wildcard: 0, 0, 0 -> 모든 디바이스 수신)
    await sendANTMessage(0x51, [channelNumber, 0x00, 0x00, 0x00, 0x00, 0x00]);
    await new Promise(r => setTimeout(r, 100));

    console.log('[ANT+ 스캔] LibConfig 설정 (Device ID 포함 요청)');
    await sendANTMessage(0x6E, [0x00, 0xE0]); // Channel 0, Enable ID, RSSI, Timestamp
    await new Promise(r => setTimeout(r, 100));
    
    // 5. RF 주파수 설정 (57 = 2457MHz)
    await sendANTMessage(0x45, [channelNumber, 57]);
    await new Promise(r => setTimeout(r, 100));

    // 6. [핵심] Open Rx Scan Mode (0x5B)
    // 이 명령어가 '채널 열기(0x4B)'를 대체하며, 스틱을 '고성능 스캔 모드'로 만듭니다.
    // 데이터 패킷 1: [0x00] (채널 0번을 스캔 모드로)
    // 주의: 일부 구형 스틱은 0x4B를 써야하지만, 다중 연결을 위해선 0x5B가 필수입니다.
    console.log('[ANT+ 스캔] Open Rx Scan Mode (0x5B) 명령 전송');
    // 메시지 구조: [Sync, Len, 0x5B, ChannelNum, Sync]
    await sendANTMessage(0x5B, [0x00]); 
    await new Promise(r => setTimeout(r, 100));
    
    console.log('[ANT+ 스캔] 메시지 리스너 시작');
    startANTMessageListener();

    // 7. 검색 루프 (30초)
    // Rx Scan Mode에서는 별도의 요청 없이도 브로드캐스트 패킷이 쏟아져 들어옵니다.
    for (let i = 0; i < 30; i++) {
      if (!window.antState.isScanning) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (i % 5 === 0) console.log(`[ANT+ 스캔] 진행 중... ${i}/30초`);
    }

  } catch (error) {
    console.error('[ANT+ 스캔] 오류:', error);
    throw error;
  } finally {
    // 스캔 종료 시 채널 닫기 대신 리셋 권장 (Rx Scan Mode는 닫기가 잘 안될 수 있음)
    // 하지만 여기서는 채널 닫기 시도
    if (window.antState.isScanning) {
        await sendANTMessage(0x4C, [channelNumber]); 
    }
    window.antState.isScanning = false;
  }
  
  return window.antState.foundDevices;
}

/**
 * ANT+ 메시지 리스너 시작
 */
/**
 * 메시지 수신 루프 (고속 데이터 처리용 개선)
 */
/**
 * [수정됨] 메시지 수신부 (Raw 데이터 디버깅 추가)
 */
async function startANTMessageListener() {
  if (!window.antState.usbDevice || !window.antState.isScanning) return;

  try {
    // 64바이트 읽기 시도
    const result = await window.antState.usbDevice.transferIn(window.antState.inEndpoint, 64);
    
    if (result.data && result.data.byteLength > 0) {
      const data = new Uint8Array(result.data.buffer);
      
      // [디버깅용] 들어오는 모든 데이터를 콘솔에 출력
      // 예: 0xA4 0x03 0x40 0x00 ...
      console.log('[RX Raw]', Array.from(data).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' '));
      
      // processBuffer를 통해 processMasterBuffer 호출
      console.log('[Race] startANTMessageListener: 함수 확인 시작');
      console.log('[Race] typeof processBuffer:', typeof processBuffer);
      console.log('[Race] typeof processIncomingData:', typeof processIncomingData);
      console.log('[Race] typeof processMasterBuffer:', typeof processMasterBuffer);
      console.log('[Race] typeof window.processBuffer:', typeof window.processBuffer);
      console.log('[Race] typeof window.processMasterBuffer:', typeof window.processMasterBuffer);
      
      // processMasterBuffer를 우선적으로 호출 (routeANTMessage를 직접 호출)
      if (typeof processMasterBuffer === 'function') {
        console.log('[Race] processMasterBuffer 함수 호출 시도, data.length=', data.length);
        try {
          processMasterBuffer(data);
          console.log('[Race] processMasterBuffer 함수 호출 완료');
        } catch (e) {
          console.error('[Race] processMasterBuffer 함수 호출 에러:', e);
        }
      } else if (typeof processBuffer === 'function') {
        console.log('[Race] processBuffer 함수 호출 시도, data.length=', data.length);
        try {
          processBuffer(data);
          console.log('[Race] processBuffer 함수 호출 완료');
        } catch (e) {
          console.error('[Race] processBuffer 함수 호출 에러:', e);
        }
      } else if (typeof processIncomingData === 'function') {
        console.log('[Race] processIncomingData 함수 호출 시도');
        try {
          processIncomingData(data);
        } catch (e) {
          console.error('[Race] processIncomingData 함수 호출 에러:', e);
        }
      } else if (typeof window.processBuffer === 'function') {
        console.log('[Race] window.processBuffer 함수 호출 시도');
        window.processBuffer(data);
      } else if (typeof window.processIncomingData === 'function') {
        console.log('[Race] window.processIncomingData 함수 호출 시도');
        window.processIncomingData(data);
      } else if (typeof window.processMasterBuffer === 'function') {
        console.log('[Race] window.processMasterBuffer 함수 호출 시도');
        window.processMasterBuffer(data);
      } else {
        console.error('[Race] processBuffer, processIncomingData, processMasterBuffer 함수를 모두 찾을 수 없습니다!');
        // 직접 패킷 처리 시도
        console.log('[Race] 직접 패킷 처리 시도');
        if (data.length >= 4 && data[0] === 0xA4) {
          const msgId = data[2];
          if (msgId === 0x4E) {
            const payload = data.slice(3, data.length - 1);
            console.log('[Race] 직접 handleBroadcastData 호출 시도, payload.length=', payload.length);
            if (typeof handleBroadcastData === 'function') {
              handleBroadcastData(payload);
            } else {
              console.error('[Race] handleBroadcastData 함수도 찾을 수 없습니다!');
            }
          }
        }
      }
      
      // window.antDevice.onMessage도 호출 (이중 처리 방지를 위해 조건부)
      if (window.antDevice && typeof window.antDevice.onMessage === 'function') {
        // processMasterBuffer가 이미 처리하므로 여기서는 호출하지 않음
        // 대신 processMasterBuffer 내부에서 routeANTMessage가 호출됨
      }
    }
  } catch (error) {
    // 타임아웃이나 장치 분리 에러가 아니면 로그 출력
    if (error.name !== 'NetworkError' && error.name !== 'NotFoundError') {
        // console.warn('RX Error:', error); // 너무 잦은 에러는 무시
    } else {
        console.error('[ANT+] USB 끊김 감지');
        window.antState.isScanning = false;
        updateANTUSBStatusUI('error', 'USB 연결 끊김', null);
        return;
    }
  }
  
  // 끊기지 않고 계속 대기
  if (window.antState.isScanning) {
     setTimeout(startANTMessageListener, 0);
  }
}

/**
 * 수신 데이터 파싱 (버퍼링 처리)
 */
// =========================================================
// [수정 1] 데이터 버퍼링 및 파싱 로직 (Tacx 호환성 강화)
// =========================================================


/**
 * USB로부터 들어온 Raw 데이터를 처리하는 함수
 */
// [수정됨] 수신 데이터 처리기
let packetBuffer = new Uint8Array(0);

function processIncomingData(newData) {
  console.log(`[Race] processIncomingData 호출: newData.length=${newData?.length}, packetBuffer.length=${packetBuffer?.length}`);
  
  const combined = new Uint8Array(packetBuffer.length + newData.length);
  combined.set(packetBuffer);
  combined.set(newData, packetBuffer.length);
  packetBuffer = combined;

  while (packetBuffer.length >= 4) {
    const syncIndex = packetBuffer.indexOf(0xA4);
    if (syncIndex === -1) { 
        // Sync 없으면 버림 (단, 데이터가 끊겨 올 수 있으므로 너무 빨리 버리지 않도록 주의)
        if(packetBuffer.length > 64) packetBuffer = new Uint8Array(0);
        break; 
    }
    
    if (syncIndex > 0) {
      packetBuffer = packetBuffer.slice(syncIndex);
      continue;
    }

    const length = packetBuffer[1];
    const totalLen = length + 4;

    if (packetBuffer.length < totalLen) break;

    const packet = packetBuffer.slice(0, totalLen);
    packetBuffer = packetBuffer.slice(totalLen);

    // [핵심] Tacx Wrapper (0xAE) 처리
    // 구조: [A4][09][AE][Status][InnerSync]...
    if (packet[2] === 0xAE) {
        const status = packet[3]; // 0x02면 에러/Echo 가능성
        const innerSyncIndex = 4; // 보통 5번째 바이트가 내부 패킷 시작
        
        if (status !== 0x00) {
            // console.warn('[ANT+] Tacx 상태 코드:', status.toString(16));
        }

        if (packet.length > innerSyncIndex && packet[innerSyncIndex] === 0xA4) {
            // 포장지 뜯고 내부 데이터만 다시 처리
            console.log('[ANT+] Tacx 포장지 해제 -> 재처리');
            const innerData = packet.slice(innerSyncIndex); // 0xA4부터 끝까지
            
            // 재귀 호출로 내부 패킷 처리
            processIncomingData(innerData);
            continue; 
        }
    }

    // 일반 메시지 처리
    // 패킷을 Uint8Array 형태로 전달하여 handleANTMessage에서 일관되게 처리
    handleANTMessage(packet);
  }
}

/**
 * 추출된 단일 패킷을 분석하고 처리하는 함수
 */
function parseAndHandlePacket(packet) {
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1); // MsgID 다음부터 Checksum 전까지

  // [핵심] Tacx T2028 Wrapper (0xAE) 해제 로직
  // 구조: [A4][Len][AE][02][A4(InnerSync)]...
  if (msgId === 0xAE) {
    // Tacx 패킷은 payload[0]이 0x02이고, payload[1]이 내부 패킷의 Sync(0xA4)임
    if (payload.length > 1 && payload[1] === 0xA4) {
      // console.log('[ANT+] Tacx 포장지(0xAE) 해제 -> 내부 데이터 처리');
      
      // 포장지(헤더 2바이트)를 벗겨내고 내부 데이터를 다시 버퍼 처리기에 넣음
      // payload.slice(1)은 InnerSync(0xA4)부터 시작하는 진짜 데이터
      const innerData = payload.slice(1);
      
      // 재귀적으로 처리하지 않고, 별도 함수로 내부 패킷만 즉시 파싱 시도 (버퍼 꼬임 방지)
      // 여기서는 간단히 processIncomingData를 재호출하여 큐에 넣는 방식 사용
      processIncomingData(innerData);
      return;
    }
  }

  // 일반 메시지 처리
  // 패킷을 Uint8Array 형태로 전달하여 handleANTMessage에서 일관되게 처리
  // 원본 패킷이 필요하므로 packet을 그대로 전달
  if (packet instanceof Uint8Array || Array.isArray(packet)) {
    handleANTMessage(packet);
  } else {
    // 객체 형태인 경우 Uint8Array로 변환 불가능하므로 원래 방식 사용
    handleANTMessage({ messageId: msgId, data: payload });
  }
}

/**
 * 채널 이벤트 처리
 */
function handleChannelEvent(data) {
  if (!window.antState.isScanning) {
    return;
  }
  
  const channelNumber = data[0];
  const messageId = data[1];
  const messageCode = data[2];
  
  // 스캔 채널의 이벤트만 처리
  if (channelNumber !== ANT_CHANNEL_CONFIG.SCAN_CHANNEL) {
    return;
  }
  
  console.log('[ANT+] Channel Event:', {
    channel: channelNumber,
    messageId: '0x' + messageId.toString(16).toUpperCase(),
    eventCode: '0x' + messageCode.toString(16).toUpperCase(),
    eventName: getChannelEventName(messageCode)
  });
  
  switch (messageCode) {
    case 0x01: // RX_SEARCH_TIMEOUT
      // 검색 타임아웃 - 정상적인 이벤트
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
 * Channel Event 코드 이름 반환
 */
function getChannelEventName(code) {
  const eventNames = {
    0x01: 'RX_SEARCH_TIMEOUT',
    0x02: 'RX_SEARCH_TIMEOUT',
    0x03: 'RX_FAIL',
    0x04: 'TX',
    0x05: 'TRANSFER_RX_FAILED',
    0x06: 'TRANSFER_TX_COMPLETED',
    0x07: 'TRANSFER_TX_FAILED',
    0x08: 'CHANNEL_CLOSED',
    0x09: 'RX_FAIL_GO_TO_SEARCH',
    0x0A: 'CHANNEL_COLLISION',
    0x0B: 'TRANSFER_TX_START',
    0x0C: 'TRANSFER_NEXT_DATA_BLOCK',
    0x0D: 'RX_EXT_MESSAGE',
    0x0E: 'RX_EXT_MESSAGE'
  };
  return eventNames[code] || 'UNKNOWN';
}



// ==========================================
// [수정됨] 패킷 버퍼 처리 및 래퍼(Wrapper) 해제 로직
// ==========================================

let rxBuf = new Uint8Array(0);

function processBuffer(newData) {
  try {
    if (!newData || !(newData instanceof Uint8Array)) {
      console.error('[Race] processBuffer: 유효하지 않은 데이터:', newData);
      return;
    }
    
    console.log(`[Race] processBuffer 호출: newData.length=${newData.length}, rxBuf.length=${rxBuf?.length || 0}`);
    
    // 1. 기존 버퍼에 새 데이터 추가
    const tmp = new Uint8Array((rxBuf?.length || 0) + newData.length);
    if (rxBuf && rxBuf.length > 0) {
      tmp.set(rxBuf);
    }
    tmp.set(newData, rxBuf?.length || 0);
    rxBuf = tmp;

  let processedCount = 0;
  // 2. 패킷 파싱 루프
  while (rxBuf.length >= 4) {
    // Sync Byte (0xA4) 찾기
    const syncIndex = rxBuf.indexOf(0xA4);
    if (syncIndex === -1) {
      if (rxBuf.length > 256) {
        console.warn('[Race] processBuffer: Sync 바이트를 찾을 수 없어 버퍼 초기화');
        rxBuf = new Uint8Array(0); // Sync 없으면 버림
      }
      break;
    }
    
    // Sync 이전의 쓰레기 데이터 제거
    if (syncIndex > 0) {
      console.log(`[Race] processBuffer: Sync 바이트 앞부분 ${syncIndex}바이트 제거`);
      rxBuf = rxBuf.slice(syncIndex);
      continue;
    }

    const len = rxBuf[1];
    const totalLen = len + 4; // Sync(1)+Len(1)+MsgID(1)+Payload(Len)+Chk(1)
    
    if (rxBuf.length < totalLen) {
        // console.log(`[Race] processBuffer: 패킷 대기 중: 현재=${rxBuf.length}, 필요=${totalLen}`);
        break; // 데이터가 다 안 옴 -> 대기
    }

    // 패킷 추출
    const pkt = rxBuf.slice(0, totalLen);
    rxBuf = rxBuf.slice(totalLen);
    
    processedCount++;
    const msgId = pkt[2];
    console.log(`[Race] processBuffer: 패킷 추출 (${processedCount}번째), msgId=0x${msgId?.toString(16)}, packet.length=${pkt.length}`);
    
    // [중요] 추출한 패킷 처리 핸들러 호출
    if (typeof handleANTMessage === 'function') {
      handleANTMessage(pkt);
    } else {
      console.error('[Race] processBuffer: handleANTMessage 함수가 정의되지 않았습니다!');
    }
  }
  
    if (processedCount > 0) {
      console.log(`[Race] processBuffer 완료: ${processedCount}개 패킷 처리, 남은 버퍼=${rxBuf.length}바이트`);
    }
  } catch (error) {
    console.error('[Race] processBuffer 에러:', error);
    console.error('[Race] processBuffer 에러 스택:', error.stack);
  }
}

/**
 * [신규] ANT+ 메시지 처리기 (Wrapper 해제 기능 포함)
 */
// =========================================================
// [수정 2] 메시지 분배 및 로그 최적화
// =========================================================

/**
 * [최종 통합본] ANT+ 메시지 처리기
 * Tacx T2028 Wrapper 해제 로직 + 표준 메시지 처리 통합
 */
/**
 * [최종 통합] ANT+ 메시지 처리기
 * 기존의 모든 handleANTMessage 및 routeANTMessage를 이 하나로 대체하세요.
 */
/**
 * [최종 통합본] ANT+ 메시지 처리기
 * Tacx Wrapper 해제 및 표준 메시지 분배를 하나로 관리
 */
function handleANTMessage(packet) {
  console.log('[Race] handleANTMessage 호출됨, packet.length=', packet?.length);
  
  // 패킷 형태 확인 및 messageId 추출
  let messageId, data;
  if (packet instanceof Uint8Array || Array.isArray(packet)) {
    if (packet.length < 3) {
      console.warn('[Race] handleANTMessage: 패킷이 너무 짧음', packet.length);
      return;
    }
    messageId = packet[2];
    data = packet.slice(3, packet.length - 1);
  } else {
    messageId = packet.messageId;
    data = packet.data;
  }
  
  console.log(`[Race] handleANTMessage: messageId=0x${messageId?.toString(16)}, data.length=${data?.length}`);

  // 1. Tacx T2028 전용 포장지(0xAE) 처리
  if (messageId === 0xAE && data && data.length > 1 && data[1] === 0xA4) {
      console.log('[Race] Tacx Wrapper 감지, 내부 데이터 재처리');
      // 포장지를 벗기고 내부의 진짜 ANT+ 데이터를 다시 처리 루프에 넣음
      if (typeof processBuffer === 'function') {
          processBuffer(data.slice(1)); 
      } else if (typeof processMasterBuffer === 'function') {
          processMasterBuffer(data.slice(1));
      }
      return;
  }

  // 2. Broadcast Data (0x4E) 처리 - routeANTMessage로 전달
  if (messageId === 0x4E) {
    console.log('[Race] Broadcast Data (0x4E) 감지, routeANTMessage 호출');
    if (typeof routeANTMessage === 'function') {
      routeANTMessage(packet);
    } else {
      console.error('[Race] routeANTMessage 함수가 정의되지 않았습니다!');
      // fallback: handleBroadcastData 직접 호출
      if (typeof handleBroadcastData === 'function') {
        console.log('[Race] fallback: handleBroadcastData 직접 호출');
        handleBroadcastData(data);
      }
    }
    return;
  }

  // 3. 기타 메시지 처리
  switch (messageId) {
    case 0x51: // Channel ID Response (센서 발견 정보)
      if (typeof handleChannelIDResponse === 'function') {
          handleChannelIDResponse(data);
      }
      break;
      
    case 0x40: // 명령 응답 (Command Response)
      if (data && data[2] !== 0x00) {
        // 0x01(검색 타임아웃) 등 무의미한 응답은 제외하고 실제 오류만 출력
        if (data[2] !== 0x01) {
            console.warn(`[ANT+] 명령(${data[1].toString(16)}) 실패 코드: ${data[2].toString(16)}`);
        }
      }
      break;
      
    default:
      console.log(`[Race] handleANTMessage: 처리되지 않은 메시지 ID: 0x${messageId?.toString(16)}`);
      break;
  }
}






/**
 * Channel ID Response 처리 (스캔 중 발견된 디바이스 정보)
 * 이 메시지에서 실제 디바이스 타입과 번호를 얻을 수 있음
 */
function handleChannelIDResponse(data) {
  if (!window.antState.isScanning) {
    return;
  }
  
  // Channel ID Response 메시지 구조 확인
  // ANT+ Channel ID Response 구조: [Channel, DeviceNumber(LSB), DeviceNumber(MSB), DeviceType, TransmissionType]
  console.log('[ANT+] Channel ID Response 수신 (원시 데이터):', {
    dataLength: data.length,
    rawData: Array.from(data).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    decimal: Array.from(data).join(', ')
  });
  
  // 데이터 길이에 따라 다른 구조로 파싱 시도
  let channelNumber, deviceNumber, deviceType, transmissionType;
  
  if (data.length >= 5) {
    // 구조 1: [Channel, DeviceNumber(LSB), DeviceNumber(MSB), DeviceType, TransmissionType]
    channelNumber = data[0];
    deviceNumber = (data[2] << 8) | data[1]; // LSB, MSB 순서
    deviceType = data[3];
    transmissionType = data[4];
    
    console.log('[ANT+] Channel ID Response 파싱 (구조 1):', {
      channel: channelNumber,
      deviceNumberLSB: '0x' + data[1].toString(16).toUpperCase(),
      deviceNumberMSB: '0x' + data[2].toString(16).toUpperCase(),
      deviceNumber: deviceNumber,
      deviceType: '0x' + deviceType.toString(16).toUpperCase(),
      transmissionType: transmissionType
    });
  } else if (data.length >= 4) {
    // 구조 2: [DeviceNumber(LSB), DeviceNumber(MSB), DeviceType, TransmissionType] (Channel 없음)
    channelNumber = ANT_CHANNEL_CONFIG.SCAN_CHANNEL; // 스캔 채널로 가정
    deviceNumber = (data[1] << 8) | data[0]; // LSB, MSB 순서
    deviceType = data[2];
    transmissionType = data[3];
    
    console.log('[ANT+] Channel ID Response 파싱 (구조 2):', {
      channel: channelNumber,
      deviceNumberLSB: '0x' + data[0].toString(16).toUpperCase(),
      deviceNumberMSB: '0x' + data[1].toString(16).toUpperCase(),
      deviceNumber: deviceNumber,
      deviceType: '0x' + deviceType.toString(16).toUpperCase(),
      transmissionType: transmissionType
    });
  } else {
    console.warn('[ANT+] Channel ID Response 데이터 길이 부족:', data.length, '데이터:', Array.from(data).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    return;
  }
  
  // 스캔 채널의 응답만 처리 (또는 Channel 필드가 없는 경우 모두 처리)
  if (data.length >= 5 && channelNumber !== ANT_CHANNEL_CONFIG.SCAN_CHANNEL) {
    console.log('[ANT+] Channel ID Response가 스캔 채널이 아님:', channelNumber, 'vs', ANT_CHANNEL_CONFIG.SCAN_CHANNEL);
    return;
  }
  
  // ANT+ 디바이스 타입 정의
  // 0x78: Cadence Sensor (Separate) - 케이던스만
  // 0x79: Speed and Cadence Sensor (Combined) - 속도와 케이던스 모두
  // 0x7A: Speed Sensor (Separate) - 속도만
  // 0x7B: Power Meter
  // 0x7C: Fitness Equipment
  // 0x7D: Heart Rate Monitor - 심박계
  // 0x7E: Multi-Sport Speed and Distance
  // 0x7F: Control
  
  // 지원하는 디바이스 타입 확인
  let deviceName = '';
  let deviceCategory = '';
  
  if (deviceType === 0x79) {
    deviceName = `ANT+ Speed/Cadence Sensor ${deviceNumber}`;
    deviceCategory = 'Speed/Cadence (Combined)';
  } else if (deviceType === 0x7A) {
    deviceName = `ANT+ Speed Sensor ${deviceNumber}`;
    deviceCategory = 'Speed Sensor';
  } else if (deviceType === 0x78) {
    deviceName = `ANT+ Cadence Sensor ${deviceNumber}`;
    deviceCategory = 'Cadence Sensor';
  } else if (deviceType === 0x7D) {
    deviceName = `ANT+ Heart Rate Monitor ${deviceNumber}`;
    deviceCategory = 'Heart Rate Monitor';
  } else if (deviceType === 0x7B) {
    deviceName = `ANT+ Power Meter ${deviceNumber}`;
    deviceCategory = 'Power Meter';
  } else if (deviceType === 0x7C) {
    deviceName = `ANT+ Fitness Equipment ${deviceNumber}`;
    deviceCategory = 'Fitness Equipment';
  } else {
    // 알 수 없는 타입도 표시 (디버깅용)
    deviceName = `ANT+ Device ${deviceNumber} (Type: 0x${deviceType.toString(16).toUpperCase()})`;
    deviceCategory = `Unknown (0x${deviceType.toString(16).toUpperCase()})`;
    console.log('[ANT+] 알 수 없는 디바이스 타입 발견:', {
      deviceNumber,
      deviceType: '0x' + deviceType.toString(16).toUpperCase(),
      transmissionType
    });
  }
  
  // 이미 발견된 디바이스인지 확인
  const existingDevice = window.antState.foundDevices.find(
    d => d.deviceNumber === deviceNumber && d.deviceType === deviceType
  );
  
  if (!existingDevice) {
    // 새 디바이스 추가
    const device = {
      id: deviceNumber.toString(),
      name: deviceName,
      type: deviceCategory,
      deviceNumber: deviceNumber,
      deviceType: deviceType,
      transmissionType: transmissionType
    };
    
    window.antState.foundDevices.push(device);
    console.log('[ANT+] 디바이스 발견:', device);
    
    // UI 업데이트
    displayANTDevices(window.antState.foundDevices);
  }
}

/**
 * Channel ID 요청 주기적 전송 (스캔 중 디바이스 정보 얻기)
 */
function startChannelIDRequest(channelNumber) {
  if (window.antChannelIDRequestInterval) {
    clearInterval(window.antChannelIDRequestInterval);
  }
  
  console.log('[ANT+ 스캔] Channel ID 요청 시작 (500ms 간격)');
  
  let requestCount = 0;
  
  // 500ms마다 Channel ID 요청 전송 (더 자주 요청하여 디바이스 발견 확률 증가)
  window.antChannelIDRequestInterval = setInterval(async () => {
    if (!window.antState.isScanning || !window.antState.usbDevice) {
      clearInterval(window.antChannelIDRequestInterval);
      window.antChannelIDRequestInterval = null;
      return;
    }
    
    try {
      requestCount++;
      // Channel ID 요청은 Request Message (0x4D)를 사용
      // Request Message 구조: [Channel, Requested Message ID]
      // 0x51은 Channel ID Response 메시지 ID이므로, 이를 요청
      await sendANTMessage(0x4D, [channelNumber, 0x51]); // Request Channel ID
      
      // 10번마다 로그 출력 (너무 많은 로그 방지)
      if (requestCount % 10 === 0) {
        console.log(`[ANT+ 스캔] Channel ID 요청 전송 (${requestCount}회, 발견된 디바이스: ${window.antState.foundDevices.length}개)`);
      }
    } catch (error) {
      // 오류는 조용히 처리 (너무 많은 오류 로그 방지)
      if (requestCount % 20 === 0) {
        console.error('[ANT+] Channel ID 요청 오류:', error);
      }
    }
  }, 500); // 500ms 간격으로 요청 (더 빠른 디바이스 발견)
}

/**
 * 확인된 데이터 처리
 */
function handleAcknowledgedData(data) {
  // 확인된 데이터 처리 (필요시 구현)
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
  const emptySlot = window.rollerRaceState.speedometers.findIndex(s => !s.name || s.name.startsWith('트랙') && !s.deviceId);
  
  if (emptySlot >= 0 && emptySlot < 10) {
    speedometer = window.rollerRaceState.speedometers[emptySlot];
    // 트랙명은 유지하고, 입력된 이름은 pairingName으로 저장
    speedometer.pairingName = name;
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
  
  // 페어링 이름 업데이트
  if (speedometer.pairingName) {
    updateSpeedometerPairingName(speedometer.id, speedometer.pairingName);
  }
  
  closeAddSpeedometerModal();
  
  if (typeof showToast === 'function') {
    showToast(`${speedometer.name}에 ${speedometer.pairingName || '이름 없음'}이 추가되었습니다.`);
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
    speedometer.name = `트랙${speedometerId}`;
    speedometer.deviceId = null;
    speedometer.pairingName = null;
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
    
    // 페어링 이름 초기화
    updateSpeedometerPairingName(speedometerId, '');
    
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
      deviceId: s.deviceId,
      pairingName: s.pairingName || null
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
        if (item.pairingName) {
          speedometer.pairingName = item.pairingName;
        }
        window.rollerRaceState.speedometers[item.id - 1] = speedometer;
      });
    }
  } catch (error) {
    console.error('[속도계 목록 로드 오류]', error);
  }
  
  // 10개 미만이면 기본값으로 채우기
  for (let i = 0; i < 10; i++) {
    if (!window.rollerRaceState.speedometers[i]) {
      window.rollerRaceState.speedometers[i] = new SpeedometerData(i + 1, `트랙${i + 1}`);
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
          updateReceiverButtonStatus(); // 수신기 활성화 버튼 상태 업데이트
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
              updateReceiverButtonStatus(); // 수신기 활성화 버튼 상태 업데이트
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





// =========================================================================
// [최종 강제 표시 패치] 조건 검사 없이 무조건 화면에 센서 표시
// =========================================================================



// 4. 선택 함수 (입력창 연동)
function selectANTDevice(deviceId, deviceName) {
  const currentTargetId = window.currentTargetSpeedometerId;
  
  // 중복 체크: 다른 트랙에 이미 지정된 디바이스인지 확인 (트랙1~10만 체크)
  const existingSpeedometer = window.rollerRaceState.speedometers.find(
    s => s.id >= 1 && s.id <= 10 && s.deviceId == deviceId && s.deviceId && s.id !== currentTargetId
  );
  
  if (existingSpeedometer) {
    // 이미 다른 트랙에 지정된 경우
    const existingTrackName = `트랙${existingSpeedometer.id}`;
    if (typeof showToast === 'function') {
      showToast(`이미 ${existingTrackName}에 지정된 센서입니다. 기존 트랙에서 삭제 후 다시 시도해주세요.`, 'error');
    }
    return;
  }
  
  const input = document.getElementById('speedometerDeviceId');
  if (input) {
      input.value = deviceId;
      input.style.backgroundColor = '#d4edda'; // 녹색 깜빡임
      setTimeout(() => input.style.backgroundColor = '', 300);
      
      // 토스트 알림
      if (typeof showToast === 'function') showToast(`${deviceId} 선택됨`);
  }
}




// =========================================================================
// [최종 마스터 패치] 센서 데이터 강제 처리 및 화면 표시 통합 모듈
// (이 코드가 파일의 맨 마지막에 위치해야 합니다)
// =========================================================================

// 1. 데이터 수신 버퍼 처리 (함수 이름 혼동 방지를 위해 두 가지 이름 모두 정의)
let masterRxBuffer = new Uint8Array(0);

// 기존 코드에서 어떤 이름을 쓰든 이 로직이 실행되도록 연결
window.processBuffer = processMasterBuffer;
window.processIncomingData = processMasterBuffer;

function processMasterBuffer(newData) {
  if (!newData || newData.length === 0) return;
  
  console.log(`[Race] processMasterBuffer 호출: newData.length=${newData.length}, masterRxBuffer.length=${masterRxBuffer.length}`);
  
  // 버퍼 병합
  const combined = new Uint8Array(masterRxBuffer.length + newData.length);
  combined.set(masterRxBuffer);
  combined.set(newData, masterRxBuffer.length);
  masterRxBuffer = combined;

  let processedCount = 0;
  while (masterRxBuffer.length >= 4) {
    const syncIndex = masterRxBuffer.indexOf(0xA4);
    if (syncIndex === -1) {
      if (masterRxBuffer.length > 256) {
        console.warn('[Race] Sync 바이트를 찾을 수 없어 버퍼 초기화');
        masterRxBuffer = new Uint8Array(0); // 너무 쌓이면 비움
      }
      break;
    }
    if (syncIndex > 0) {
      console.log(`[Race] Sync 바이트 앞부분 ${syncIndex}바이트 제거`);
      masterRxBuffer = masterRxBuffer.slice(syncIndex); // Sync 앞부분 제거
      continue;
    }

    const length = masterRxBuffer[1];
    const totalLen = length + 4; // ANT+ 패킷 길이 계산

    if (masterRxBuffer.length < totalLen) {
      // console.log(`[Race] 패킷 대기 중: 현재=${masterRxBuffer.length}, 필요=${totalLen}`);
      break; // 데이터 대기
    }

    // 패킷 추출
    const packet = masterRxBuffer.slice(0, totalLen);
    masterRxBuffer = masterRxBuffer.slice(totalLen);
    
    processedCount++;
    console.log(`[Race] 패킷 추출: msgId=0x${packet[2]?.toString(16)}, packet.length=${packet.length}, 처리된 패킷 수=${processedCount}`);

    // [핵심] 메시지 처리기로 전달
    routeANTMessage(packet);
  }
  
  if (processedCount > 0) {
    console.log(`[Race] processMasterBuffer 완료: ${processedCount}개 패킷 처리, 남은 버퍼=${masterRxBuffer.length}바이트`);
  }
}

// 2. 메시지 라우팅 (Wrapper 해제 및 데이터 분배)
function routeANTMessage(packet) {
  if (!packet || packet.length < 4) {
    console.warn('[Race] routeANTMessage: 패킷이 너무 짧음', packet?.length);
    return;
  }
  
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1);
  
  console.log(`[Race] routeANTMessage: msgId=0x${msgId.toString(16)}, payload.length=${payload.length}, packet.length=${packet.length}`);

  // Tacx Wrapper (0xAE) 해제
  if (msgId === 0xAE && payload.length > 1 && payload[1] === 0xA4) {
      console.log('[Race] Wrapper 해제');
      processMasterBuffer(payload.slice(1)); // 내부 데이터 재처리
      return;
  }

  // 센서 데이터 (0x4E) 처리
  if (msgId === 0x4E) {
      console.log(`[Race] Broadcast Data (0x4E) 처리: payload.length=${payload.length}`);
      handleBroadcastData(payload);
  } else {
      console.log(`[Race] 알 수 없는 메시지 ID: 0x${msgId.toString(16)}`);
  }
}

// 3. 데이터 해석 및 ID 추출 (구형 센서 0x78 완벽 지원)
// OLD 버전과 동일하게 processSpeedCadenceData를 통해 가민 필터 적용
function handleBroadcastData(payload) {
  if (payload.length < 9) return;
  const antData = payload.slice(1, 9); 
  
  // Extended Data (ID 정보) 확인
  if (payload.length >= 13) {
    const flag = payload[9];
    
    // 0x80 비트가 있거나, 길이가 충분하면 ID가 있다고 가정
    if ((flag & 0x80) || payload.length > 12) { 
      const idLow = payload[10];
      const idHigh = payload[11];
      const deviceType = payload[12]; // 0x78(구형속도), 0x7B(신형속도) 등
      const transType = payload[13];
      
      // ID 계산
      const extendedId = ((transType & 0xF0) << 12) | (idHigh << 8) | idLow;
      
      // 목록 추가 및 데이터 업데이트 (processSpeedCadenceData를 통해 가민 필터 적용)
      addFoundDeviceToUI(extendedId, deviceType);
      updateSpeedometerDataInternal(extendedId, antData);
    }
  }
}

// 4. 화면 목록에 강제 추가 (필터 완화)
function addFoundDeviceToUI(deviceId, deviceType) {
  // 0x78 (Bike Speed Sensor) 필수 포함
  const validTypes = [0x79, 0x7A, 0x7B, 0x78, 0x0B]; 
  
  // 타입이 리스트에 없어도 일단 로그 남기고 추가 시도 (강제 표시)
  if (!validTypes.includes(deviceType)) {
      console.log(`[UI] 새로운 타입 센서 발견: ${deviceId} (Type: 0x${deviceType.toString(16)})`);
  }

  // 중복 방지
  const existing = window.antState.foundDevices.find(d => d.deviceNumber === deviceId);
  if (existing) return;

  console.log(`[UI] 목록 추가 성공: ${deviceId}`);

  let typeName = '알 수 없음';
  if (deviceType === 0x79) typeName = '콤보 센서';
  else if (deviceType === 0x7B) typeName = '속도 센서 (New)';
  else if (deviceType === 0x78) typeName = '속도 센서 (Old)'; // 사용자님 센서
  else if (deviceType === 0x7A) typeName = '케이던스';
  
  const device = {
    deviceNumber: deviceId,
    name: `ANT+ ${typeName}`,
    id: deviceId,
    type: typeName
  };
  
  window.antState.foundDevices.push(device);
  displayANTDevices(window.antState.foundDevices);
}

// 5. 화면 그리기 (DOM 강제 주입)
function displayANTDevices(devices) {
  const list = document.getElementById('antDeviceList');
  if (!list) return;

  // 숨겨진 목록 강제 표시
  if (list.parentElement && list.parentElement.classList.contains('hidden')) {
      list.parentElement.classList.remove('hidden');
  }

  if (devices.length === 0) return;
  
  // 현재 페어링 중인 트랙 ID 가져오기
  const currentTargetId = window.currentTargetSpeedometerId;
  
  let html = '<div style="display:flex;flex-direction:column;gap:5px; max-height:200px; overflow-y:auto;">';
  devices.forEach(d => {
    // 이미 다른 트랙에 지정된 디바이스인지 확인 (트랙1~10만 체크)
    const existingSpeedometer = window.rollerRaceState.speedometers.find(
      s => s.id >= 1 && s.id <= 10 && s.deviceId == d.deviceNumber && s.deviceId && s.id !== currentTargetId
    );
    
    const isAssigned = !!existingSpeedometer;
    const assignedTrack = existingSpeedometer ? `트랙${existingSpeedometer.id}` : '';
    const isCurrentDevice = currentTargetId && window.rollerRaceState.speedometers.find(
      s => s.id >= 1 && s.id <= 10 && s.id === currentTargetId && s.deviceId == d.deviceNumber
    );
    
    // 현재 트랙에 이미 지정된 디바이스이거나 사용 가능한 경우만 활성화
    const isEnabled = isCurrentDevice || !isAssigned;
    
    html += `
      <div style="padding:10px; border:1px solid ${isEnabled ? '#007bff' : '#ccc'}; background:${isEnabled ? '#eef6fc' : '#f5f5f5'}; border-radius:5px; cursor:${isEnabled ? 'pointer' : 'not-allowed'}; display:flex; justify-content:space-between; align-items:center; opacity:${isEnabled ? '1' : '0.6'};"
           onclick="${isEnabled ? `selectANTDevice('${d.deviceNumber}', '${d.name}')` : ''}">
        <div>
            <div style="font-weight:bold; color:${isEnabled ? '#0056b3' : '#999'};">
              ${d.name}
              ${isAssigned && !isCurrentDevice ? ` <span style="color:#dc3545; font-size:11px;">(이미 ${assignedTrack}에 지정됨)</span>` : ''}
              ${isCurrentDevice ? ` <span style="color:#28a745; font-size:11px;">(현재 트랙)</span>` : ''}
            </div>
            <div style="font-size:12px; color:${isEnabled ? '#555' : '#999'};">ID: ${d.deviceNumber}</div>
        </div>
        <button style="background:${isEnabled ? '#007bff' : '#ccc'}; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:${isEnabled ? 'pointer' : 'not-allowed'};" ${isEnabled ? '' : 'disabled'}>${isEnabled ? '선택' : '사용중'}</button>
      </div>
    `;
  });
  html += '</div>';
  list.innerHTML = html;
}

// 6. 내부 데이터 업데이트 헬퍼
function updateSpeedometerDataInternal(deviceId, antData) {
  const speedometer = window.rollerRaceState.speedometers.find(s => s.deviceId == deviceId);
  if (speedometer) {
    // 센서 데이터를 받으면 연결됨 상태로 업데이트 (초록색)
    speedometer.lastPacketTime = Date.now();
    speedometer.connected = true;
    if(typeof updateSpeedometerConnectionStatus === 'function') {
      updateSpeedometerConnectionStatus(speedometer.id, true, 'connected');
    }
    if(typeof processSpeedCadenceData === 'function') processSpeedCadenceData(speedometer.deviceId, antData);
  }
}

// 7. 선택 함수 (입력창 연동)
window.selectANTDevice = function(deviceId, deviceName) {
  const currentTargetId = window.currentTargetSpeedometerId;
  
  // 중복 체크: 다른 트랙에 이미 지정된 디바이스인지 확인 (트랙1~10만 체크)
  const existingSpeedometer = window.rollerRaceState.speedometers.find(
    s => s.id >= 1 && s.id <= 10 && s.deviceId == deviceId && s.deviceId && s.id !== currentTargetId
  );
  
  if (existingSpeedometer) {
    // 이미 다른 트랙에 지정된 경우
    const existingTrackName = `트랙${existingSpeedometer.id}`;
    if (typeof showToast === 'function') {
      showToast(`이미 ${existingTrackName}에 지정된 센서입니다. 기존 트랙에서 삭제 후 다시 시도해주세요.`, 'error');
    }
    return;
  }
  
  const input = document.getElementById('speedometerDeviceId');
  if (input) {
      input.value = deviceId;
      input.style.backgroundColor = '#d4edda';
      setTimeout(() => input.style.backgroundColor = '', 300);
  }
  if (typeof showToast === 'function') showToast(`${deviceId} 선택됨`);
};

/**
 * 경기 데이터 저장 시작 (5초마다 저장)
 */
function startRaceDataSaving() {
  // 기존 타이머가 있으면 정리
  if (window.rollerRaceState.dataSaveTimer) {
    clearInterval(window.rollerRaceState.dataSaveTimer);
    window.rollerRaceState.dataSaveTimer = null;
  }
  
  // 즉시 한 번 저장
  saveRaceDataSnapshot();
  
  // 5초마다 저장
  window.rollerRaceState.dataSaveTimer = setInterval(() => {
    if (window.rollerRaceState.raceState === 'running') {
      saveRaceDataSnapshot();
    }
  }, 5000);
}

/**
 * 경기 데이터 저장 정지
 */
function stopRaceDataSaving() {
  if (window.rollerRaceState.dataSaveTimer) {
    clearInterval(window.rollerRaceState.dataSaveTimer);
    window.rollerRaceState.dataSaveTimer = null;
  }
}

/**
 * 센서 연결 상태 주기적 체크 시작 (1초마다)
 */
/**
 * 센서 연결 및 주행 상태 주기적 체크 (정지 감지 강화)
 */
/**
 * 센서 연결 및 정지 상태 주기적 체크 (대기 중 정지 감지 포함)
 */
function startConnectionStatusCheck() {
  if (window.rollerRaceState.connectionStatusCheckTimer) {
    clearInterval(window.rollerRaceState.connectionStatusCheckTimer);
  }
  
  // 주기를 1000ms -> 200ms로 변경 (반응성 강화)
  window.rollerRaceState.connectionStatusCheckTimer = setInterval(() => {
    const now = Date.now();
    
    // 수신기 연결 상태 체크 및 업데이트
    const isReceiverActive = window.antState.usbDevice && window.antState.usbDevice.opened;
    const previousStatus = window.rollerRaceState.lastReceiverStatus;
    const currentStatus = isReceiverActive 
      ? (window.rollerRaceState.speedometers.some(s => s.id >= 1 && s.id <= 10 && s.deviceId && s.deviceId.trim() !== '') ? 'active-paired' : 'active') 
      : 'inactive';
    
    // 수신기 연결 상태가 변경되었으면 버튼 상태 업데이트
    if (previousStatus !== currentStatus) {
      updateReceiverButtonStatus();
    }
    
    window.rollerRaceState.speedometers.forEach(speedometer => {
      if (!speedometer.deviceId) return;

      // 1. 패킷 단절 체크 (5초간 무응답 시)
      const timeSinceLastPacket = now - (speedometer.lastPacketTime || 0);
      if (timeSinceLastPacket > 5000) {
        updateSpeedometerConnectionStatus(speedometer.id, false, 'timeout');
        updateSpeedometerData(speedometer.id, 0, speedometer.totalDistance);
        return;
      }

      // 2. [솔루션 1 적용] 가변 감속 예측 로직
      if (speedometer.currentSpeed > 0) {
        const wheelSpec = WHEEL_SPECS[window.rollerRaceState.raceSettings.wheelSize] || WHEEL_SPECS['25-622'];
        const circumferenceM = wheelSpec.circumference / 1000;
        
        // 현재 속도에서 1회전에 걸려야 할 예상 시간
        const expectedInterval = (circumferenceM / (speedometer.currentSpeed / 3.6)) * 1000;
        const timeSinceLastEvent = now - (speedometer.lastEventUpdate || 0);

        // 예상 시간보다 1.5배 지연되면 즉시 감속 시작
        // [보완] 지수적 감쇠 처리 (바늘이 스르륵 멈추도록)
        if (timeSinceLastEvent > Math.max(expectedInterval * 1.5, 800)) {
            // 200ms마다 고정 비율이 아닌, 경과 시간에 따른 자연스러운 감속
            const decayFactor = Math.pow(0.5, (now - speedometer.lastDecelerationCheck) / 300); // 300ms마다 반감
            let predictedSpeed = speedometer.currentSpeed * decayFactor;
            
            if (predictedSpeed < 1.0) predictedSpeed = 0;
            
            updateSpeedometerData(speedometer.id, predictedSpeed, speedometer.totalDistance);
            speedometer.lastDecelerationCheck = now; // 시간 기준점 갱신
        }
      }
    });
  }, 200); // 0.2초마다 정밀 감시
}

/**
 * 센서 연결 상태 주기적 체크 정지
 */
function stopConnectionStatusCheck() {
  if (window.rollerRaceState.connectionStatusCheckTimer) {
    clearInterval(window.rollerRaceState.connectionStatusCheckTimer);
    window.rollerRaceState.connectionStatusCheckTimer = null;
  }
}

/**
 * 경기 데이터 스냅샷 저장
 */
function saveRaceDataSnapshot() {
  const timestamp = Date.now();
  const elapsedTime = window.rollerRaceState.totalElapsedTime || 0;
  
  const snapshot = {
    timestamp: timestamp,
    elapsedTime: elapsedTime,
    speedometers: window.rollerRaceState.speedometers.map(s => ({
      id: s.id,
      name: s.name,
      pairingName: s.pairingName,
      deviceId: s.deviceId,
      connected: s.connected,
      totalDistance: s.totalDistance,
      currentSpeed: s.currentSpeed,
      maxSpeed: s.maxSpeed,
      averageSpeed: s.averageSpeed,
      totalRevolutions: s.totalRevolutions
    }))
  };
  
  window.rollerRaceState.raceDataHistory.push(snapshot);
  
  // localStorage에 저장 (최근 100개만 유지)
  if (window.rollerRaceState.raceDataHistory.length > 100) {
    window.rollerRaceState.raceDataHistory.shift();
  }
  
  try {
    localStorage.setItem('rollerRaceDataHistory', JSON.stringify(window.rollerRaceState.raceDataHistory));
  } catch (error) {
    console.error('[경기 데이터 저장 오류]', error);
  }
}

/**
 * 경기 종료 리포트 PDF 생성
 */
function generateRaceReportPDF() {
  try {
    // jsPDF와 html2canvas가 로드되어 있는지 확인
    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      console.error('[PDF 생성] jsPDF가 로드되지 않았습니다.');
      if (typeof showToast === 'function') {
        showToast('PDF 생성 라이브러리를 불러올 수 없습니다.', 'error');
      }
      return;
    }
    
    if (typeof html2canvas === 'undefined') {
      console.error('[PDF 생성] html2canvas가 로드되지 않았습니다.');
      if (typeof showToast === 'function') {
        showToast('PDF 생성에 필요한 라이브러리를 불러올 수 없습니다.', 'error');
      }
      return;
    }
    
    const { jsPDF } = window.jspdf || window;
    
    // 순위별 데이터 정렬
    const settings = window.rollerRaceState.raceSettings || {};
    let sorted;
    
    if (settings.endByDistance) {
      // 거리 경기: 경과시간(finishTime)이 작을수록 선순위
      sorted = [...window.rollerRaceState.speedometers]
        .filter(s => s.totalDistance > 0)
        .sort((a, b) => {
          // finishTime이 있는 경우: 작을수록 선순위
          const aTime = a.finishTime !== null && a.finishTime !== undefined ? a.finishTime : Infinity;
          const bTime = b.finishTime !== null && b.finishTime !== undefined ? b.finishTime : Infinity;
          
          if (aTime !== Infinity && bTime !== Infinity) {
            return aTime - bTime; // 오름차순 (작을수록 선순위)
          } else if (aTime !== Infinity) {
            return -1; // a가 finishTime이 있으면 선순위
          } else if (bTime !== Infinity) {
            return 1; // b가 finishTime이 있으면 선순위
          } else {
            // 둘 다 finishTime이 없으면 거리로 정렬 (큰 거리가 선순위)
            return b.totalDistance - a.totalDistance;
          }
        });
    } else if (settings.endByTime) {
      // 시간 경기: 이동거리가 클수록 선순위
      sorted = [...window.rollerRaceState.speedometers]
        .filter(s => s.totalDistance > 0)
        .sort((a, b) => b.totalDistance - a.totalDistance);
    } else {
      // 기본값: 이동거리로 정렬
      sorted = [...window.rollerRaceState.speedometers]
        .filter(s => s.totalDistance > 0)
        .sort((a, b) => b.totalDistance - a.totalDistance);
    }
    
    // HTML 테이블 생성 (한글 폰트 문제 해결을 위해 HTML로 생성 후 이미지 변환)
    const reportHTML = `
      <div style="font-family: 'Pretendard', 'Noto Sans KR', sans-serif; padding: 20px; background: white; color: #333;">
        <h1 style="text-align: center; font-size: 24px; margin-bottom: 20px; color: #2563eb;">
          Stelvio AI Indoor Race - 경기 결과 리포트
        </h1>
        
        <div style="margin-bottom: 20px; font-size: 14px;">
          <p><strong>경기 일시:</strong> ${new Date().toLocaleString('ko-KR')}</p>
          <p><strong>경기 시간:</strong> ${formatTime(window.rollerRaceState.totalElapsedTime || 0)}</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #2563eb; color: white;">
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">순위</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">트랙</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">이름</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">이동거리(km)</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">평균속도(km/h)</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">최고속도(km/h)</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">경과시간</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.slice(0, 10).map((speedometer, index) => {
              const rank = index + 1;
              const trackName = `트랙${speedometer.id}`;
              const name = speedometer.pairingName || '-';
              const distance = speedometer.totalDistance.toFixed(2);
              const avgSpeed = speedometer.averageSpeed > 0 ? speedometer.averageSpeed.toFixed(1) : '0.0';
              const maxSpeed = speedometer.maxSpeed > 0 ? speedometer.maxSpeed.toFixed(1) : '0.0';
              
              // 거리 경기 시: 결승점 도달 시간 사용, 없으면 전체 경과 시간 사용
              // 시간 경기 시: 전체 경과 시간 사용
              let elapsedTime;
              if (settings.endByDistance && speedometer.finishTime !== null && speedometer.finishTime !== undefined) {
                // 거리 경기이고 결승점 도달 시간이 있으면 사용
                elapsedTime = formatTime(speedometer.finishTime);
              } else {
                // 시간 경기이거나 결승점 도달 시간이 없으면 전체 경과 시간 사용
                elapsedTime = formatTime(window.rollerRaceState.totalElapsedTime || 0);
              }
              
              return `
                <tr style="background: ${index % 2 === 0 ? '#f9f9f9' : 'white'};">
                  <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${rank}</td>
                  <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${trackName}</td>
                  <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${name}</td>
                  <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${distance}</td>
                  <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${avgSpeed}</td>
                  <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${maxSpeed}</td>
                  <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${elapsedTime}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    
    // 임시 div 생성
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.width = '800px';
    tempDiv.innerHTML = reportHTML;
    document.body.appendChild(tempDiv);
    
    // html2canvas로 이미지 변환
    html2canvas(tempDiv, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    }).then(canvas => {
      // 임시 div 제거
      document.body.removeChild(tempDiv);
      
      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      
      const doc = new jsPDF('p', 'mm', 'a4');
      let position = 0;
      
      // 첫 페이지 추가
      doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      
      // 여러 페이지가 필요한 경우
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        doc.addPage();
        doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      // 파일명 생성
      const fileName = `경기결과_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}.pdf`;
      
      // PDF 저장
      doc.save(fileName);
      
      console.log('[PDF 리포트] 생성 완료:', fileName);
      
      if (typeof showToast === 'function') {
        showToast('PDF 리포트가 생성되었습니다.');
      }
    }).catch(error => {
      document.body.removeChild(tempDiv);
      console.error('[PDF 리포트 생성 오류]', error);
      if (typeof showToast === 'function') {
        showToast('PDF 리포트 생성 중 오류가 발생했습니다.', 'error');
      }
    });
    
  } catch (error) {
    console.error('[PDF 리포트 생성 오류]', error);
    if (typeof showToast === 'function') {
      showToast('PDF 리포트 생성 중 오류가 발생했습니다.', 'error');
    }
  }
}

/**
 * 시간 포맷팅 헬퍼 함수
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 수신기 활성화 버튼 상태 업데이트
 * - 활성화 전: 빨강색 원
 * - 활성화만 됨: 연두색 원 (체크마크 없음)
 * - 페어링 완료: 연두색 원 + 체크마크
 * - 연결 끊김: 빨강색 원 (LED 효과)
 */
// 이전 수신기 연결 상태 저장 (상태 변화 감지용)
window.rollerRaceState.lastReceiverStatus = null;

function updateReceiverButtonStatus() {
  const indicator = document.getElementById('receiverStatusIndicator');
  if (!indicator) return;
  
  // USB 수신기가 활성화되어 있고, 페어링된 속도계가 있는지 확인
  const isReceiverActive = window.antState.usbDevice && window.antState.usbDevice.opened;
  const hasPairedSpeedometer = window.rollerRaceState.speedometers.some(
    s => s.id >= 1 && s.id <= 10 && s.deviceId && s.deviceId.trim() !== ''
  );
  
  // 현재 상태를 문자열로 표현 (상태 변화 감지용)
  const currentStatus = isReceiverActive 
    ? (hasPairedSpeedometer ? 'active-paired' : 'active') 
    : 'inactive';
  
  // 상태가 변경되었는지 확인
  const statusChanged = window.rollerRaceState.lastReceiverStatus !== currentStatus;
  window.rollerRaceState.lastReceiverStatus = currentStatus;
  
  if (isReceiverActive && hasPairedSpeedometer) {
    // 페어링 완료: 연두색 원 + 체크마크
    indicator.style.background = 'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.5), #28a745 60%)';
    indicator.innerHTML = '✓';
    indicator.style.color = 'white';
    indicator.style.fontSize = '10px';
    indicator.style.lineHeight = '12px';
    indicator.style.textAlign = 'center';
    indicator.style.fontWeight = 'bold';
    indicator.classList.add('led-active');
    indicator.classList.remove('led-inactive');
  } else if (isReceiverActive) {
    // 활성화만 됨: 연두색 원 (체크마크 없음)
    indicator.style.background = 'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.5), #28a745 60%)';
    indicator.innerHTML = '';
    indicator.classList.add('led-active');
    indicator.classList.remove('led-inactive');
  } else {
    // 활성화 전 또는 연결 끊김: 빨강색 원 (LED 효과)
    indicator.style.background = 'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.4), #dc3545 60%)';
    indicator.innerHTML = '';
    indicator.classList.add('led-inactive');
    indicator.classList.remove('led-active');
  }
  
  // 상태 변화 로그 (디버깅용)
  if (statusChanged) {
    console.log('[수신기 상태 변경]', currentStatus, {
      isReceiverActive,
      hasPairedSpeedometer,
      usbDevice: window.antState.usbDevice ? '존재' : '없음',
      opened: window.antState.usbDevice?.opened || false
    });
  }
}


/**
 * [수정본] Speed/Cadence 데이터 처리
 * 중복 데이터 리셋 버그 수정 및 데이터 페이지 필터링 추가
 */
/**
 * 개선된 Speed/Cadence 데이터 처리 로직
 * 고속 회전 및 급격한 가속 시에도 즉각적인 반응성을 보장합니다.
 */
/**
 * [통합 개선본] Speed/Cadence 데이터 처리 모듈
 * 고속 주행 대응, 경기 시작 동기화, 정지 감지 로직이 모두 포함되었습니다.
 */
/**
 * 통합 Speed/Cadence 데이터 처리 모듈
 * 고속 주행 인식 + 경기 시작 동기화 + 정지 시 즉시 0 리셋 로직 통합
 */
function processSpeedCadenceData(deviceId, data) {
  if (data.length < 8) return;

  // 데이터 추출 (이벤트 시간 및 누적 회전수)
  const eventTime = (data[5] << 8) | data[4];
  const revolutions = (data[7] << 8) | data[6];

  const speedometer = window.rollerRaceState.speedometers.find(s => s.deviceId == deviceId);
  if (!speedometer) return;

  const now = Date.now();
  speedometer.lastPacketTime = now;

  // 1. 초기 동기화
  if (speedometer.needsSync || speedometer.lastEventTime === 0 || speedometer.lastEventTime === undefined) {
    speedometer.lastRevolutions = revolutions;
    speedometer.lastEventTime = eventTime;
    speedometer.lastEventUpdate = now;
    speedometer.needsSync = false;
    return;
  }

  // 2. 바퀴 회전 여부 판별
  if (speedometer.lastEventTime === eventTime) return;

  // 3. 변화량 계산 (16비트 롤오버 대응)
  let revDiff = revolutions - speedometer.lastRevolutions;
  if (revDiff < 0) revDiff += 65536;

  let timeDiff = eventTime - speedometer.lastEventTime;
  if (timeDiff < 0) timeDiff += 65536;

  // 4. 속도 계산 및 필터 적용
  if (timeDiff > 0 && revDiff > 0) {
    const wheelSpec = WHEEL_SPECS[window.rollerRaceState.raceSettings.wheelSize] || WHEEL_SPECS['25-622'];
    const distM = (revDiff * wheelSpec.circumference) / 1000;
    const timeS = timeDiff / 1024;
    
    // 원본 속도 계산 (rawSpeed)
    const rawSpeed = (distM / timeS) * 3.6;

    // 비정상적인 고속 데이터 처리
    if (rawSpeed > 150) {
      console.warn(`[트랙${speedometer.id}] 과속 감지. 기준점 리셋.`);
      speedometer.lastRevolutions = revolutions;
      speedometer.lastEventTime = eventTime;
      return; 
    }

    // 5. [가민 스타일 개선] 가변 알파(Adaptive Alpha) 필터 로직
    // 이전에 값이 없었다면 현재 속도로 초기화
    if (speedometer.filteredSpeed === undefined || speedometer.filteredSpeed === 0) {
      speedometer.filteredSpeed = rawSpeed;
    } else {
      /**
       * 가변 알파 설정:
       * - 가속 중(raw > filtered): 0.9 (반응성 극대화, 바늘이 실제 속도를 빠르게 추적)
       * - 감속/유지 중: 0.5 (부드러움 극대화, 센서 노이즈로 인한 바늘 떨림 방지)
       */
      const dynamicAlpha = rawSpeed > speedometer.filteredSpeed ? 0.9 : 0.5;
      speedometer.filteredSpeed = (dynamicAlpha * rawSpeed) + ((1 - dynamicAlpha) * speedometer.filteredSpeed);
    }

    // 경기 중일 때 거리 누적
    if (window.rollerRaceState.raceState === 'running') {
      speedometer.totalDistance += (distM / 1000);
    }

    // 6. UI 업데이트 (보정된 filteredSpeed 사용)
    updateSpeedometerData(speedometer.id, speedometer.filteredSpeed, speedometer.totalDistance);
    
    // 기준점 업데이트
    speedometer.lastRevolutions = revolutions;
    speedometer.lastEventTime = eventTime;
    speedometer.lastEventUpdate = now; 
    speedometer.connected = true;
  }
}

/**
 * 대시보드 전환 시 모든 바늘을 강제로 0위치에 렌더링
 */
window.initializeGauges = function() {
    // 레이스 바늘 초기화
    for (let i = 0; i < 4; i++) {
        const n = document.getElementById(`needle-${i}`);
        if (n) n.setAttribute('transform', 'rotate(180, 100, 140)');
    }
    // 트레이닝 바늘 초기화
    if (window.indoorTrainingState?.powerMeters) {
        window.indoorTrainingState.powerMeters.forEach(pm => {
            const n = document.getElementById(`needle-${pm.id}`);
            if (n) n.setAttribute('transform', 'rotate(180, 100, 140)');
        });
    }
};

// 페이지 로드 시 및 대시보드 버튼 클릭 시 실행되도록 연결
window.addEventListener('load', window.initializeGauges);





/**
 * [신규 추가] 속도계 바늘 회전 및 텍스트 업데이트 로직
 * trackId: 0, 1, 2, 3 (트랙 번호)
 * speed: 계산된 속도값
 */





/**
 * [최종 통합] 레이스용 데이터 처리 엔진
 * OLD 버전의 검증된 속도 계산 로직을 유지하면서 67536 ID를 지원합니다.
 */
/**
 * [통합 개선본] ANT+ 데이터 엔진 (Race & Training 독립 구동 최적화)
 * 분석 결과 반영: ID 67536을 정확히 인식하고 트랙 2(백만킬로)에 매핑합니다.
 */

// 1. 외부(Training)에서 호출할 수 있도록 함수명 표준화
/**
 * [최종 정밀 수정] ANT+ 속도 데이터 엔진 (24바이트 확장 패킷 대응)
 * 로그 분석 결과: ID 67536(0x107D0) 및 속도 데이터를 정확한 바이트 주소에서 추출합니다.
 */
window.processRaceData = function(payload) {
    // 24바이트 확장 패킷임을 확인 (A4 14... 형식이므로 최소 18바이트 이상 필요)
    if (!payload || payload.length < 18) return;

    // 1. 장치 ID 정밀 추출 (사용자 로그 바이트 주소: D0:13, 07:14, 10:17)
    const idLow = payload[13];
    const idHigh = payload[14];
    const transType = payload[17]; 
    const deviceType = payload[15]; // 0x7B (속도/케이던스 통합)

    // ANT+ 3바이트 확장 ID 계산 공식 (정확히 67536 생성)
    const deviceId = ((transType & 0xF0) << 12) | (idHigh << 8) | idLow;

    // 2. 장치 필터링 및 트랙 매핑
    if (deviceType === 0x79 || deviceType === 0x7B) {
        let trackIndex = -1;

        // 현재 설정된 트랙 정보에서 해당 장치 ID 찾기
        if (window.raceState && window.raceState.tracks) {
            trackIndex = window.raceState.tracks.findIndex(t => String(t.deviceId) === String(deviceId));
        }

        // [트랙 2 강제 매핑] 로그 확인 결과 ID 67536은 트랙 2(Index 1) 전용임
        if (deviceId === 67536) {
            trackIndex = 1; 
        }

        if (trackIndex === -1) return; // 미등록 장치 무시

        // 3. 속도 계산 데이터 정밀 추출 (로그 주소: Time:8-9, Rev:10-11)
        const currentEventTime = payload[8] | (payload[9] << 8);  // CE 56 -> 22222
        const currentRevCount = payload[10] | (payload[11] << 8); // 82 D2 -> 53890

        if (!window.lastAntData) window.lastAntData = {};
        const key = `track_${trackIndex}`;

        if (!window.lastAntData[key]) {
            window.lastAntData[key] = { time: currentEventTime, rev: currentRevCount };
            updateSpeedometer(trackIndex, 0);
            return;
        }

        const prevData = window.lastAntData[key];
        let revDiff = currentRevCount - prevData.rev;
        let timeDiff = currentEventTime - prevData.time;

        // 16비트 롤오버 처리
        if (revDiff < 0) revDiff += 65536;
        if (timeDiff < 0) timeDiff += 65536;

        if (timeDiff > 0 && revDiff > 0) {
            const wheelCircumference = 2.096; // 700x23c
            const speed = (revDiff * wheelCircumference * 1024 * 3.6) / timeDiff;
            
            // 실제 UI 업데이트 실행
            updateSpeedometer(trackIndex, Math.min(speed, 100));
        }
        
        window.lastAntData[key] = { time: currentEventTime, rev: currentRevCount };
    }
};

/**
 * [가시성 개선] 속도계 UI 업데이트 (숫자 + 바늘)
 */
function updateSpeedometer(trackId, speed) {
    // 1. 숫자 텍스트 (ID: speed-text-0, speed-text-1 ...)
    const speedText = document.getElementById(`speed-text-${trackId}`);
    if (speedText) {
        speedText.textContent = speed.toFixed(1);
        speedText.style.fill = "#ffffff"; // 흰색 강제
        speedText.style.visibility = "visible";
    }

    // 2. 바늘 회전 (이미 잘 반영된 좌표계 사용)
    const needle = document.getElementById(`needle-${trackId}`);
    if (needle) {
        const maxSpeed = 60;
        const ratio = Math.min(Math.max(speed / maxSpeed, 0), 1);
        const angle = -90 + (ratio * 180); // -90도 ~ 90도
        
        // 중심점(100, 140)을 속성으로 강제 부여하여 CSS 간섭 차단
        needle.setAttribute('transform', `rotate(${angle}, 100, 140)`);
        needle.style.stroke = "#ff4757";
        needle.style.visibility = "visible";
    }
}

// ---------------------------------------------------------
// ANT+ 수신 이벤트 최종 통합
// ---------------------------------------------------------
if (window.antDevice) {
    window.antDevice.onMessage = function(packet) {
        // packet은 객체 {messageId, data} 형태일 수도 있고 Uint8Array일 수도 있음
        let msgId, payload;
        
        if (packet.messageId) {
             msgId = packet.messageId;
             payload = packet.data;
        } else if (packet instanceof Uint8Array || Array.isArray(packet)) {
             msgId = packet[2];
             payload = packet.slice(3, packet.length - 1);
        }

        // 0x4E (Broadcast Data) 처리
        if (msgId === 0x4E) {
            if (typeof window.parseIndoorSensorPayload === 'function') {
                // 트레이닝 대시보드가 있으면 그쪽으로 먼저 보냄 (통합 처리)
                window.parseIndoorSensorPayload(payload);
            } else {
                // 없으면 레이스 대시보드에서 직접 처리
                handleBroadcastData(payload);
            }
        }
    };
}

// 초기 로딩 시 바늘 0점 정렬
window.addEventListener('load', () => {
    setTimeout(() => {
        const needles = document.querySelectorAll('line[id^="needle-"]');
        needles.forEach(n => {
            n.setAttribute('transform', 'rotate(-90, 100, 140)');
        });
    }, 1500);
});





