/**
 * Indoor Training 대시보드
 * ANT+ 1:N 연결로 최대 15개 파워미터/스마트로라 관리
 * 속도계 디자인을 파워계로 변환
 */

// 전역 상태
window.indoorTrainingState = {
  powerMeters: [], // 파워계 목록
  connectedDevices: {}, // 연결된 ANT+ 디바이스
  trainingState: 'idle', // idle, running, paused, finished
  startTime: null,
  pausedTime: 0,
  totalElapsedTime: 0,
  currentWorkout: null, // 선택된 워크아웃
  currentSegmentIndex: 0,
  segmentStartTime: null,
  segmentElapsedTime: 0,
  userFTP: null, // 사용자 FTP 값
  userFTPSet: false, // FTP 값이 설정되었는지 여부
  wakeLock: null,
  rxBuffer: new Uint8Array(0), // ANT+ 데이터 버퍼 추가
  needleAngles: {} // 바늘 각도 저장용 추가
};

// ANT+ 통신 관련 전역 상태 (rollerRaceDashboard와 공유)
if (!window.antState) {
  window.antState = {
    usbDevice: null,
    inEndpoint: null,
    outEndpoint: null,
    isScanning: false,
    scanChannel: null,
    foundDevices: [],
    connectedChannels: {},
    messageBuffer: []
  };
}

// 파워계 데이터 구조
class PowerMeterData {
  constructor(id, name, deviceId = null) {
    this.id = id;
    this.name = name;
    this.deviceId = deviceId;
    this.pairingName = null; // 페어링 시 설정되는 이름
    this.connected = false;
    this.currentPower = 0; // W
    this.maxPower = 0; // W
    this.averagePower = 0; // W
    this.segmentPower = 0; // W (현재 세그먼트 평균 파워)
    this.heartRate = 0; // BPM
    this.cadence = 0; // RPM
    this.totalDistance = 0; // km (스마트로라의 경우)
    this.lastUpdateTime = null;
    this.powerHistory = [];
    this.powerSum = 0;
    this.powerCount = 0;
    this.segmentPowerSum = 0;
    this.segmentPowerCount = 0;
    this.userId = null; // 연결된 사용자 ID
    this.userFTP = null; // 사용자 FTP 값
  }
}


// [삽입 위치: initIndoorTrainingDashboard 함수 바로 위]

// ANT+ 데이터 버퍼 및 메시지 라우팅 엔진
window.processBuffer = function(newData) {
  const combined = new Uint8Array(window.indoorTrainingState.rxBuffer.length + newData.length);
  combined.set(window.indoorTrainingState.rxBuffer);
  combined.set(newData, window.indoorTrainingState.rxBuffer.length);
  window.indoorTrainingState.rxBuffer = combined;

  while (window.indoorTrainingState.rxBuffer.length >= 4) {
    const syncIndex = window.indoorTrainingState.rxBuffer.indexOf(0xA4);
    if (syncIndex === -1) {
      if (window.indoorTrainingState.rxBuffer.length > 256) window.indoorTrainingState.rxBuffer = new Uint8Array(0);
      break;
    }
    if (syncIndex > 0) {
      window.indoorTrainingState.rxBuffer = window.indoorTrainingState.rxBuffer.slice(syncIndex);
      continue;
    }

    const length = window.indoorTrainingState.rxBuffer[1];
    const totalLen = length + 4;
    if (window.indoorTrainingState.rxBuffer.length < totalLen) break;

    const packet = window.indoorTrainingState.rxBuffer.slice(0, totalLen);
    window.indoorTrainingState.rxBuffer = window.indoorTrainingState.rxBuffer.slice(totalLen);

    handleIndoorAntMessage(packet);
  }
};

function handleIndoorAntMessage(packet) {
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1);

  // 1. Tacx Wrapper 해제
  if (msgId === 0xAE && payload.length > 1 && payload[1] === 0xA4) {
      window.processBuffer(payload.slice(1));
      return;
  }

  // 2. 센서 데이터(0x4E) 처리
  if (msgId === 0x4E) {
      // 현재 화면이 인도어 트레이닝 화면일 때만 리스트 갱신 명령 수행
      const currentScreen = window.currentScreenId || ''; 
      if (currentScreen.includes('indoorTraining')) {
          parseIndoorSensorPayload(payload);
      }
  }
}

/**
 * 1. 통합 데이터 라우팅 엔진 (충돌 방지 및 강제 연결)
 * 이 함수가 rollerRaceDashboard.js의 로그 출력부와 indoor UI를 연결합니다.
 */
window.handleIndoorAntMessage = function(packet) {
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1);

  // Tacx T2028 Wrapper(0xAE) 해제
  if (msgId === 0xAE && payload.length > 1 && payload[1] === 0xA4) {
      if (typeof window.processBuffer === 'function') window.processBuffer(payload.slice(1));
      return;
  }

  // 브로드캐스트 데이터(0x4E) 처리
  if (msgId === 0x4E) {
      parseIndoorSensorPayload(payload);
  }
};



/**
 * Indoor Training 대시보드 초기화
 */
function initIndoorTrainingDashboard() {
  console.log('[Indoor Training] 대시보드 초기화');
  
  // 파워계 그리드 생성
  createPowerMeterGrid();
  
  // 전광판 초기화
  updateScoreboard();
  
  // 세그먼트 그래프 초기화
  initSegmentGraph();
  
  // 사용자 FTP 로드
  loadUserFTP();
}

/**
 * 워크아웃 목록 로드
 */
async function loadWorkoutListForTraining() {
  const selectEl = document.getElementById('workoutSelectTraining');
  if (!selectEl) return;
  
  try {
    const workouts = await loadWorkouts();
    selectEl.innerHTML = '<option value="">워크아웃 선택...</option>';
    
    if (workouts && workouts.length > 0) {
      workouts.forEach(workout => {
        const option = document.createElement('option');
        option.value = workout.id || workout.workout_id;
        option.textContent = `${workout.title || workout.workout_name} (${workout.duration || 0}분)`;
        option.dataset.workout = JSON.stringify(workout);
        selectEl.appendChild(option);
      });
    }
    
    selectEl.addEventListener('change', function() {
      const selectedOption = this.options[this.selectedIndex];
      if (selectedOption && selectedOption.value) {
        const workout = JSON.parse(selectedOption.dataset.workout);
        window.indoorTrainingState.currentWorkout = workout;
        console.log('[Indoor Training] 워크아웃 선택:', workout);
      }
    });
  } catch (error) {
    console.error('[Indoor Training] 워크아웃 목록 로드 오류:', error);
  }
}

/**
 * 파워계 그리드 생성 (10개, 5개씩 2줄)
 */
function createPowerMeterGrid() {
  const gridEl = document.getElementById('powerMeterGrid');
  if (!gridEl) return;
  
  gridEl.innerHTML = '';
  
  // 10개 파워계 생성
  for (let i = 1; i <= 10; i++) {
    const powerMeter = new PowerMeterData(i, `파워계${i}`);
    window.indoorTrainingState.powerMeters.push(powerMeter);
    
    const element = createPowerMeterElement(powerMeter);
    gridEl.appendChild(element);
  }
}

/**
 * 파워계 요소 생성
 */
function createPowerMeterElement(powerMeter) {
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `power-meter-${powerMeter.id}`;
  container.dataset.powerMeterId = powerMeter.id;
  
  container.innerHTML = `
    <div class="speedometer-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; position: relative !important;">
      <span class="speedometer-pairing-name" id="pairing-name-${powerMeter.id}" style="font-size: 12px !important; color: #ffffff !important; font-weight: 500 !important; flex: 0 0 auto !important; text-align: left !important; min-width: 80px !important; order: 1 !important; cursor: pointer;" onclick="openPowerMeterSettings(${powerMeter.id})">${powerMeter.pairingName || ''}</span>
      <span class="speedometer-name" style="position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; font-weight: 600 !important; text-align: center !important; order: 2 !important; z-index: 1 !important; background: rgba(0, 212, 170, 0.5) !important; color: #ffffff !important; padding: 6px 12px !important; border-radius: 8px !important; display: inline-block !important; cursor: pointer;" onclick="openPowerMeterSettings(${powerMeter.id})">트랙${powerMeter.id}</span>
      <div class="connection-status-center" id="status-${powerMeter.id}" style="position: static !important; left: auto !important; transform: none !important; flex: 0 0 auto !important; text-align: right !important; margin-left: auto !important; order: 3 !important; justify-content: flex-end !important;">
        <span class="status-dot disconnected"></span>
        <span class="status-text">미연결</span>
      </div>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 200">
        <!-- 아래쪽 반원 배경 -->
        <path class="speedometer-arc-bg" d="M 20 140 A 80 80 0 0 1 180 140" 
              fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5"/>
        
        <!-- 파워 눈금 (0~120 위치) -->
        <g class="speedometer-ticks">
          ${generatePowerMeterTicks(powerMeter.id)}
        </g>
        
        <!-- 파워 숫자 (반원 바깥쪽, 20단위만) -->
        <g class="speedometer-labels">
          ${generatePowerMeterLabels(powerMeter.id)}
        </g>
        
        <!-- 바늘 중심 원 -->
        <circle cx="100" cy="140" r="7" fill="#000000" stroke="#ff0000" stroke-width="2"/>
        
        <!-- 바늘 행적선 -->
        <g id="needle-path-${powerMeter.id}" class="speedometer-needle-path" transform="translate(100, 140)">
        </g>
        
        <!-- 바늘 -->
        <g class="speedometer-needle" transform="translate(100, 140)">
          <line id="needle-${powerMeter.id}" 
                x1="0" y1="-7" 
                x2="0" y2="-80" 
                stroke="#ff0000" 
                stroke-width="3" 
                stroke-linecap="round"
                transform="rotate(270)"/>
        </g>
        
        <!-- FTP 라벨 -->
        <text x="100" y="155" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="10" 
              font-weight="500">FTP [%]</text>
        
        <!-- X 100 표기 (반지름 중간 위치) -->
        <text x="100" y="100" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#d3d3d3" 
              font-size="10" 
              font-weight="500">X 100</text>
        
        <!-- 현재 파워값 (FTP 표기와 하단의 중간 위치) -->
        <text x="100" y="177.5" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="43.2" 
              font-weight="700"
              id="current-power-value-${powerMeter.id}">-</text>
      </svg>
    </div>
    <div class="speedometer-info disconnected">
      <!-- 좌측: 최대파워, 평균파워 -->
      <div class="speed-display-left">
        <div class="speed-stat-row speed-stat-max">
          <span class="speed-stat-value" id="max-power-value-${powerMeter.id}">0</span>
          <div class="speed-stat-label-wrapper">
            <span class="speed-stat-label">최대</span>
            <span class="speed-unit-bottom">W</span>
          </div>
        </div>
        <div class="speed-stat-row speed-stat-avg">
          <span class="speed-stat-value" id="avg-power-value-${powerMeter.id}">0</span>
          <div class="speed-stat-label-wrapper">
            <span class="speed-stat-label">평균</span>
            <span class="speed-unit-bottom">W</span>
          </div>
        </div>
      </div>
      <!-- 중앙: 세그먼트파워 -->
      <div class="speed-display-center">
        <div class="speed-value-wrapper">
          <span class="speed-value" id="segment-power-value-${powerMeter.id}">0</span>
          <div class="speed-unit-bottom">랩파워[W]</div>
        </div>
      </div>
      <!-- 우측: 심박, 케이던스 (2줄로 표기) -->
      <div class="distance-display-right">
        <div class="heart-rate-row">
          <span class="distance-value" id="heart-rate-value-${powerMeter.id}">0</span>
          <span class="speed-unit-small">bpm</span>
        </div>
        <div class="cadence-row">
          <span class="distance-value" id="cadence-value-${powerMeter.id}">0</span>
          <span class="speed-unit-small">rpm</span>
        </div>
      </div>
    </div>
  `;
  
  return container;
}

/**
 * 파워계 눈금 생성 (Indoor Race 속도계와 동일한 스타일)
 * 0~120 위치, 5 간격으로 모든 눈금 표시
 * 20단위는 긴 눈금, 나머지는 짧은 눈금
 * 원 중심으로 180도 회전
 * 하단 왼쪽(180도) = 0, 위쪽(90도) = 60, 하단 오른쪽(0도) = 120
 * 원지름의 1/4만큼 아래로 이동
 */
function generatePowerMeterTicks(powerMeterId) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return '';
  
  let ticks = '';
  const centerX = 100;
  const centerY = 140; // 원의 중심 (원지름의 1/4만큼 아래로 이동: 100 + 40 = 140)
  const radius = 80;
  const maxPos = 120;
  
  // 0~120, 5 간격으로 모든 눈금 표시 (Indoor Race와 동일)
  // 하단 왼쪽(180도, 0)에서 시작해서 위쪽(90도, 60)를 거쳐 하단 오른쪽(0도, 120)까지
  for (let pos = 0; pos <= maxPos; pos += 5) {
    // 각도 계산: 180도에서 시작해서 90도를 거쳐 0도로, 그 다음 180도 회전
    // pos = 0 → 180도 (하단 왼쪽), pos = 60 → 90도 (위쪽), pos = 120 → 0도 (하단 오른쪽)
    // 180도 회전: 각도에 180도 추가
    let angle = 180 - (pos / maxPos) * 180;
    angle = angle + 180; // 원 중심으로 180도 회전
    
    const rad = (angle * Math.PI) / 180;
    
    // 반원의 곡선 부분에 눈금 표시 (자동차 속도계 스타일)
    // 눈금은 반원의 곡선을 따라 안쪽에서 바깥쪽으로
    const innerRadius = radius - 10; // 안쪽 시작점
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    
    // 주요 눈금 (20 간격)은 길게, 나머지는 짧게
    const isMajor = pos % 20 === 0;
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
 * 파워계 라벨 생성 (주요 눈금에만 숫자 표시)
 * pos=120 → 0%, pos=60 → 100%, pos=0 → 200%
 * 주요 눈금(20 간격)에만 숫자 표시: pos=0, 20, 40, 60, 80, 100, 120
 * 원 중심으로 180도 회전
 * 반원의 둘레에 숫자가 닿지 않도록 약간의 간격 유지
 * 하단 왼쪽(180도, pos=0) = 200%, 위쪽(90도, pos=60) = 100%, 하단 오른쪽(0도, pos=120) = 0%
 * 원지름의 1/4만큼 아래로 이동
 */
function generatePowerMeterLabels(powerMeterId) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return '';
  
  let labels = '';
  const centerX = 100;
  const centerY = 140; // 원의 중심 (원지름의 1/4만큼 아래로 이동: 100 + 40 = 140)
  const radius = 80;
  const maxPos = 120;
  
  // 주요 눈금 위치만 표시 (20 간격: 0, 20, 40, 60, 80, 100, 120)
  const majorPositions = [0, 20, 40, 60, 80, 100, 120];
  
  majorPositions.forEach(pos => {
    // pos와 퍼센트의 관계: pos=120 → 0, pos=60 → 100, pos=0 → 200
    // percent = (120 - pos) / 120 * 200
    const percent = (120 - pos) / 120 * 200;
    
    // 각도 계산: 180도에서 시작해서 90도를 거쳐 0도로, 그 다음 180도 회전
    // pos = 0 → 180도 (하단 왼쪽), pos = 60 → 90도 (위쪽), pos = 120 → 0도 (하단 오른쪽)
    // 180도 회전: 각도에 180도 추가
    let angle = 180 - (pos / maxPos) * 180;
    angle = angle + 180; // 원 중심으로 180도 회전
    
    const rad = (angle * Math.PI) / 180;
    
    // 반원 바깥쪽에 배치, 숫자가 닿지 않도록 간격 유지 (자동차 속도계 스타일)
    const labelRadius = radius + 18;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    
    // 0~200 범위를 0~2 범위로 변환 (100으로 나눔)
    const value = percent / 100;
    
    // 표기 형식: 정수는 소수점 없이, 소수는 적절한 자릿수로 표시
    let displayValue;
    if (Math.abs(value - Math.round(value)) < 0.01) {
      // 정수인 경우 (0, 1, 2)
      displayValue = Math.round(value).toString();
    } else {
      // 소수인 경우
      // 0.3, 0.7, 1.3, 1.7 등은 소수점 1자리
      // 0.67은 소수점 2자리
      const rounded = Math.round(value * 100) / 100; // 소수점 2자리로 반올림
      const oneDecimal = Math.round(rounded * 10) / 10;
      
      if (Math.abs(rounded - oneDecimal) < 0.01) {
        // 소수점 1자리로 표현 가능한 경우
        displayValue = oneDecimal.toFixed(1);
        // 불필요한 0 제거 (예: 1.0 → 1)
        if (oneDecimal === Math.round(oneDecimal)) {
          displayValue = Math.round(oneDecimal).toString();
        }
      } else {
        // 소수점 2자리 필요 (0.67)
        displayValue = rounded.toFixed(2);
        // 불필요한 0 제거 (예: 0.70 → 0.7)
        displayValue = parseFloat(displayValue).toString();
      }
    }
    
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
 * 파워계 눈금 업데이트 (FTP 변경 시)
 */
function updatePowerMeterTicks(powerMeterId) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  // 눈금과 라벨 요소 찾기
  const ticksEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-ticks`);
  const labelsEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-labels`);
  
  if (!ticksEl || !labelsEl) return;
  
  // 눈금 재생성
  ticksEl.innerHTML = generatePowerMeterTicks(powerMeterId);
  labelsEl.innerHTML = generatePowerMeterLabels(powerMeterId);
}

/**
 * 파워계 바늘 업데이트 (0% ~ 100% ~ 200% 기준)
 * 실제 파워값을 FTP 기준 퍼센트로 변환하여 바늘 위치 결정
 */
function updatePowerMeterNeedle(powerMeterId, power) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const ftp = powerMeter.userFTP || window.indoorTrainingState.userFTP || 250;
  
  // 실제 파워값을 FTP 기준 퍼센트로 변환 (0% ~ 200%)
  const percent = (power / ftp) * 100;
  const clampedPercent = Math.max(0, Math.min(200, percent));
  
  // 퍼센트를 pos로 변환: pos=120 → 0%, pos=60 → 100%, pos=0 → 200%
  // pos = 120 - (percent / 200) * 120
  const speedPos = 120 - (clampedPercent / 200) * 120;
  
  // 각도 계산
  let angle = 180 - (speedPos / 120) * 180;
  angle = angle + 180;
  
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  if (needleEl) {
    needleEl.setAttribute('transform', `rotate(${angle})`);
  }
}

/**
 * 파워계 데이터 업데이트
 */
function updatePowerMeterData(powerMeterId, power, heartRate = 0, cadence = 0) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  powerMeter.currentPower = power;
  powerMeter.heartRate = heartRate;
  powerMeter.cadence = cadence;
  powerMeter.lastUpdateTime = Date.now();
  
  // 최대 파워 업데이트
  if (power > powerMeter.maxPower) {
    powerMeter.maxPower = power;
  }
  
  // 평균 파워 계산
  if (power > 0) {
    powerMeter.powerSum += power;
    powerMeter.powerCount += 1;
    powerMeter.averagePower = powerMeter.powerSum / powerMeter.powerCount;
  }
  
  // 세그먼트 평균 파워 계산
  if (window.indoorTrainingState.trainingState === 'running') {
    powerMeter.segmentPowerSum += power;
    powerMeter.segmentPowerCount += 1;
    powerMeter.segmentPower = powerMeter.segmentPowerSum / powerMeter.segmentPowerCount;
  }
  
  // UI 업데이트
  const maxPowerEl = document.getElementById(`max-power-value-${powerMeterId}`);
  const avgPowerEl = document.getElementById(`avg-power-value-${powerMeterId}`);
  const segmentPowerEl = document.getElementById(`segment-power-value-${powerMeterId}`);
  const heartRateEl = document.getElementById(`heart-rate-value-${powerMeterId}`);
  const cadenceEl = document.getElementById(`cadence-value-${powerMeterId}`);
  const currentPowerEl = document.getElementById(`current-power-value-${powerMeterId}`);
  
  if (maxPowerEl) maxPowerEl.textContent = Math.round(powerMeter.maxPower);
  if (avgPowerEl) avgPowerEl.textContent = Math.round(powerMeter.averagePower);
  if (segmentPowerEl) segmentPowerEl.textContent = Math.round(powerMeter.segmentPower);
  if (heartRateEl) heartRateEl.textContent = Math.round(heartRate) || 0;
  if (cadenceEl) cadenceEl.textContent = Math.round(cadence) || 0;
  
  // 현재 파워값 업데이트 (값이 없으면 "-" 표시)
  if (currentPowerEl) {
    if (power && power > 0) {
      currentPowerEl.textContent = Math.round(power);
    } else {
      currentPowerEl.textContent = '-';
    }
  }
  
  // 바늘 업데이트
  updatePowerMeterNeedle(powerMeterId, power);
}

/**
 * 전광판 업데이트
 */
function updateScoreboard() {
  // 경과시간
  const elapsedEl = document.getElementById('trainingElapsedTime');
  if (elapsedEl) {
    const elapsed = window.indoorTrainingState.totalElapsedTime;
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = Math.floor(elapsed % 60);
    elapsedEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  
  // 랩카운트다운
  const countdownEl = document.getElementById('lapCountdown');
  if (countdownEl && window.indoorTrainingState.currentWorkout) {
    // 세그먼트 남은 시간 계산
    const remaining = calculateSegmentRemainingTime();
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

/**
 * 세그먼트 남은 시간 계산
 */
function calculateSegmentRemainingTime() {
  if (!window.indoorTrainingState.currentWorkout || !window.indoorTrainingState.currentWorkout.segments) {
    return 0;
  }
  
  const segment = window.indoorTrainingState.currentWorkout.segments[window.indoorTrainingState.currentSegmentIndex];
  if (!segment) return 0;
  
  const duration = segment.duration_sec || segment.duration || 0;
  const elapsed = window.indoorTrainingState.segmentElapsedTime;
  
  return Math.max(0, duration - elapsed);
}

/**
 * 세그먼트 그래프 초기화
 */
function initSegmentGraph() {
  const canvas = document.getElementById('trainingSegmentGraphCanvas');
  if (!canvas) return;
  
  // 캔버스 크기 설정
  canvas.width = canvas.offsetWidth || 400;
  canvas.height = canvas.offsetHeight || 100;
  
  // 그래프 그리기
  drawSegmentGraph();
}

/**
 * 세그먼트 그래프 그리기 (훈련 화면과 동일한 형식)
 * workoutManager.js의 drawSegmentGraph 함수 사용
 */
function drawTrainingSegmentGraph() {
  if (!window.indoorTrainingState.currentWorkout) return;
  
  const segments = window.indoorTrainingState.currentWorkout.segments || [];
  if (segments.length === 0) return;
  
  // workoutManager.js의 drawSegmentGraph 함수 사용
  if (typeof drawSegmentGraph === 'function') {
    const currentSegmentIndex = window.indoorTrainingState.currentSegmentIndex;
    drawSegmentGraph(segments, currentSegmentIndex, 'trainingSegmentGraphCanvas');
  }
}

/**
 * 사용자 FTP 로드
 */
function loadUserFTP() {
  if (window.currentUser && window.currentUser.ftp) {
    window.indoorTrainingState.userFTP = window.currentUser.ftp;
    window.indoorTrainingState.userFTPSet = true;
  }
}

/**
 * 파워계 설정 모달 열기
 */
/**
 * 파워계 설정 모달 열기
 */
function openPowerMeterSettings(powerMeterId) {
  console.log('[Indoor Training] 파워계 설정 열기:', powerMeterId);
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  // 현재 타겟 파워계 ID 저장
  window.currentTargetPowerMeterId = powerMeterId;
  
  const modal = document.getElementById('powerMeterPairingModal');
  const modalTitle = document.getElementById('powerMeterPairingModalTitle');
  
  if (modal && modalTitle) {
    const trackName = `트랙${powerMeterId}`;
    modalTitle.textContent = `${trackName} 페어링`;
    
    // 첫 번째 탭(사용자 선택)으로 초기화
    showPairingTab('user');
    
    // 사용자 목록 로드
    loadUsersForPairing();
    
    // USB 상태 확인 및 업데이트
    updatePairingModalUSBStatus();
    
    // 모달 표시
    modal.classList.remove('hidden');
  }
}

/**
 * 페어링 모달의 USB 상태 업데이트
 */
async function updatePairingModalUSBStatus() {
  // 각 탭의 USB 상태 업데이트
  const statusIds = [
    { status: 'trainerAntUSBStatus', icon: 'trainerAntUSBStatusIcon', text: 'trainerAntUSBStatusText' },
    { status: 'powerAntUSBStatus', icon: 'powerAntUSBStatusIcon', text: 'powerAntUSBStatusText' },
    { status: 'heartAntUSBStatus', icon: 'heartAntUSBStatusIcon', text: 'heartAntUSBStatusText' }
  ];
  
  const isConnected = window.antState && window.antState.usbDevice && window.antState.usbDevice.opened;
  
  statusIds.forEach(({ status, icon, text }) => {
    const statusEl = document.getElementById(status);
    const iconEl = document.getElementById(icon);
    const textEl = document.getElementById(text);
    
    if (statusEl && iconEl && textEl) {
      if (isConnected) {
        iconEl.style.background = '#28a745';
        textEl.textContent = 'USB 수신기 연결됨';
      } else {
        iconEl.style.background = '#999';
        textEl.textContent = 'USB 수신기 미연결';
      }
    }
  });
  
  // USB 상태 확인 함수가 있으면 호출
  if (typeof checkANTUSBStatus === 'function') {
    await checkANTUSBStatus();
    // 상태 업데이트 후 다시 UI 업데이트
    setTimeout(updatePairingModalUSBStatus, 500);
  }
}

/**
 * 파워계 페어링 모달 닫기
 */
function closePowerMeterPairingModal() {
  const modal = document.getElementById('powerMeterPairingModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  window.currentTargetPowerMeterId = null;
}

/**
 * 페어링 탭 전환
 */
function showPairingTab(tabName) {
  // 모든 탭 버튼 비활성화
  document.querySelectorAll('.pairing-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 모든 탭 컨텐츠 숨김
  document.querySelectorAll('.pairing-tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  
  // 선택된 탭 활성화
  const tabBtn = document.getElementById(`tab-${tabName}`);
  const tabContent = document.getElementById(`pairing-tab-${tabName}`);
  
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.remove('hidden');
}

/**
 * 페어링용 사용자 목록 로드
 */
async function loadUsersForPairing() {
  const userListEl = document.getElementById('powerMeterUserList');
  if (!userListEl) return;
  
  try {
    const loadUsersFunc = window.loadUsers || (typeof loadUsers === 'function' ? loadUsers : null);
    if (loadUsersFunc) {
      const users = await loadUsersFunc();
      renderUsersForPairing(users);
    } else {
      userListEl.innerHTML = '<div class="loading-spinner">사용자 목록을 불러오는 중...</div>';
    }
  } catch (error) {
    console.error('[Indoor Training] 사용자 목록 로드 오류:', error);
    if (userListEl) {
      userListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">사용자 목록을 불러올 수 없습니다.</div>';
    }
  }
}

/**
 * 페어링용 사용자 목록 렌더링
 */
function renderUsersForPairing(users) {
  const userListEl = document.getElementById('powerMeterUserList');
  if (!userListEl) return;
  
  if (!users || users.length === 0) {
    userListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 사용자가 없습니다.</div>';
    return;
  }
  
  const currentUserId = window.currentUser?.id;
  
  userListEl.innerHTML = users.map(user => {
    const isSelected = user.id === currentUserId;
    const wkg = user.ftp && user.weight ? (user.ftp / user.weight).toFixed(1) : '-';
    
    return `
      <div class="user-card-compact ${isSelected ? 'selected' : ''}" onclick="selectUserForPowerMeter(${user.id})">
        <div class="user-info">
          <div class="user-name">${user.name || '-'}</div>
          <div class="user-stats-compact">
            <span>FTP: ${user.ftp || '-'}W</span>
            <span>체중: ${user.weight || '-'}kg</span>
            <span>W/kg: ${wkg}</span>
          </div>
        </div>
        ${isSelected ? '<span class="selected-badge">선택됨</span>' : ''}
      </div>
    `;
  }).join('');
}

/**
 * 파워계에 사용자 선택
 */
function selectUserForPowerMeter(userId) {
  const powerMeterId = window.currentTargetPowerMeterId;
  if (!powerMeterId) return;
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  // 사용자 정보 로드
  const loadUsersFunc = window.loadUsers || (typeof loadUsers === 'function' ? loadUsers : null);
  if (loadUsersFunc) {
    loadUsersFunc().then(users => {
      const user = users.find(u => u.id === userId);
      if (user) {
        // 파워계에 사용자 정보 저장
        powerMeter.userId = userId;
        powerMeter.userFTP = user.ftp;
        powerMeter.userName = user.name;
        
        // FTP 기반 눈금 업데이트
        updatePowerMeterTicks(powerMeterId);
        
        // UI 업데이트
        renderUsersForPairing(users);
        
        if (typeof showToast === 'function') {
          showToast(`${user.name}이(가) 선택되었습니다.`);
        }
      }
    }).catch(error => {
      console.error('[Indoor Training] 사용자 정보 로드 오류:', error);
    });
  }
}

/**
 * 페어링 저장
 */
function savePowerMeterPairing() {
  const powerMeterId = window.currentTargetPowerMeterId;
  if (!powerMeterId) {
    if (typeof showToast === 'function') {
      showToast('파워계를 선택해주세요.');
    }
    return;
  }
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  // 현재 활성화된 탭에 따라 저장
  const activeTab = document.querySelector('.pairing-tab-btn.active');
  if (!activeTab) return;
  
  const tabName = activeTab.id.replace('tab-', '');
  
  if (tabName === 'user') {
    // 사용자 선택은 이미 저장됨
    closePowerMeterPairingModal();
    if (typeof showToast === 'function') {
      showToast('사용자가 선택되었습니다.');
    }
  } else if (tabName === 'trainer') {
    // 스마트로라 페어링 저장
    const name = document.getElementById('trainerPairingName')?.value.trim() || '';
    const deviceId = document.getElementById('trainerDeviceId')?.value.trim() || '';
    
    if (!deviceId) {
      if (typeof showToast === 'function') {
        showToast('디바이스 ID를 입력해주세요.');
      }
      return;
    }
    
    powerMeter.trainerName = name;
    powerMeter.trainerDeviceId = deviceId;
    
    closePowerMeterPairingModal();
    if (typeof showToast === 'function') {
      showToast('스마트로라가 페어링되었습니다.');
    }
  } else if (tabName === 'power') {
    // 파워메터 페어링 저장
    const name = document.getElementById('powerMeterPairingName')?.value.trim() || '';
    const deviceId = document.getElementById('powerMeterDeviceId')?.value.trim() || '';
    
    if (!deviceId) {
      if (typeof showToast === 'function') {
        showToast('디바이스 ID를 입력해주세요.');
      }
      return;
    }
    
    powerMeter.pairingName = name;
    powerMeter.deviceId = deviceId;
    
    closePowerMeterPairingModal();
    if (typeof showToast === 'function') {
      showToast('파워메터가 페어링되었습니다.');
    }
  } else if (tabName === 'heart') {
    // 심박계 페어링 저장
    const name = document.getElementById('heartRatePairingName')?.value.trim() || '';
    const deviceId = document.getElementById('heartRateDeviceId')?.value.trim() || '';
    
    if (!deviceId) {
      if (typeof showToast === 'function') {
        showToast('디바이스 ID를 입력해주세요.');
      }
      return;
    }
    
    powerMeter.heartRateName = name;
    powerMeter.heartRateDeviceId = deviceId;
    
    closePowerMeterPairingModal();
    if (typeof showToast === 'function') {
      showToast('심박계가 페어링되었습니다.');
    }
  }
}

/**
 * 스마트로라 디바이스 검색
 */
async function searchTrainerDevices() {
  const btn = document.getElementById('btnSearchTrainerDevices');
  if (btn) btn.disabled = true;
  
  const listEl = document.getElementById('trainerDeviceList');
  if (listEl) {
    listEl.classList.remove('hidden');
  }
  
  // USB 수신기가 연결되어 있는지 확인
  if (!window.antState || !window.antState.usbDevice || !window.antState.usbDevice.opened) {
    if (listEl) listEl.innerHTML = '<div style="color:red;padding:10px">USB 수신기를 먼저 활성화해주세요.<br><small>위의 "활성화" 버튼을 클릭하세요.</small></div>';
    if (btn) btn.disabled = false;
    return;
  }
  
  // 스캔 모드 확실히 켜기
  if (typeof startContinuousScan === 'function') {
    await startContinuousScan();
  }
  
  if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:blue;font-weight:bold">스마트로라 검색 중...<br>바퀴를 굴려주세요!</div>';
  if (window.antState) {
    window.antState.foundDevices = []; // 목록 초기화
  }
  
  if (btn) btn.disabled = false;
}

/**
 * 파워메터 디바이스 검색
 */
async function searchPowerMeterDevices() {
  const btn = document.getElementById('btnSearchPowerDevices');
  if (btn) btn.disabled = true;
  
  const listEl = document.getElementById('powerMeterDeviceList');
  if (listEl) {
    listEl.classList.remove('hidden');
  }
  
  // USB 수신기가 연결되어 있는지 확인
  if (!window.antState || !window.antState.usbDevice || !window.antState.usbDevice.opened) {
    if (listEl) listEl.innerHTML = '<div style="color:red;padding:10px">USB 수신기를 먼저 활성화해주세요.<br><small>위의 "활성화" 버튼을 클릭하세요.</small></div>';
    if (btn) btn.disabled = false;
    return;
  }
  
  // 스캔 모드 확실히 켜기
  if (typeof startContinuousScan === 'function') {
    await startContinuousScan();
  }
  
  if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:blue;font-weight:bold">파워메터 검색 중...<br>페달을 돌려주세요!</div>';
  if (window.antState) {
    window.antState.foundDevices = []; // 목록 초기화
  }
  
  if (btn) btn.disabled = false;
}

/**
 * 심박계 디바이스 검색
 */
/**
 * 심박계 디바이스 검색 버튼 동작 보완 버전
 */
async function searchHeartRateDevices() {
  const btn = document.getElementById('btnSearchHeartDevices');
  const listEl = document.getElementById('heartRateDeviceList');
  
  // 1. 버튼 비활성화 및 리스트 노출
  if (btn) btn.disabled = true;
  if (listEl) {
    listEl.classList.remove('hidden');
    // 초기 메시지 설정
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:blue;font-weight:bold">심박계 검색 중...<br><span style="font-weight:normal; font-size:12px; color:#666;">심박계를 착용하고 잠시 기다려주세요!</span></div>';
  }
  
  // 2. USB 수신기가 연결되어 있는지 확인
  if (!window.antState || !window.antState.usbDevice || !window.antState.usbDevice.opened) {
    if (listEl) {
      listEl.innerHTML = `
        <div style="color:red;padding:15px;text-align:center;border:1px dashed red;border-radius:8px;">
          <strong>USB 수신기가 비활성 상태입니다.</strong><br>
          <small>위의 [활성화] 버튼을 먼저 클릭하여 USB 연결을 완료해주세요.</small>
        </div>`;
    }
    if (btn) btn.disabled = false;
    return;
  }

  // 3. [보완 핵심] 이미 발견된 심박계가 있다면 즉시 UI에 렌더링
  // 수신기가 이미 켜져 있다면, foundDevices에 데이터가 있을 수 있으므로 먼저 보여줍니다.
  if (window.antState.foundDevices && window.antState.foundDevices.length > 0) {
    console.log("[검색] 기존 발견된 기기 목록 로드 시도");
    renderPairingDeviceList(0x78); // 0x78 = 심박계 장치 타입
  }

  // 4. 스캔 모드 확실히 가동 (이미 켜져 있어도 안전하게 재호출)
  try {
    if (typeof startContinuousScan === 'function') {
      await startContinuousScan();
      console.log("[ANT+] Continuous Scan Mode 활성화 완료");
    }
  } catch (error) {
    console.error("[ANT+] 스캔 모드 가동 실패:", error);
    if (listEl) listEl.innerHTML += '<div style="color:red; font-size:11px;">수신기 명령 전송 실패</div>';
  }

  // 5. 버튼 복구
  if (btn) btn.disabled = false;
}

/**
 * [함께 필요한 도우미 함수] 특정 타입의 기기 리스트를 UI에 그리는 함수
 * @param {number} targetType - 0x78(심박계), 0x0B(파워미터) 등
 */
function renderPairingDeviceList(targetType) {
  const listId = (targetType === 0x78) ? 'heartRateDeviceList' : 
                 (targetType === 0x0B) ? 'powerMeterDeviceList' : 'trainerDeviceList';
  
  const listEl = document.getElementById(listId);
  if (!listEl) return;

  // window.antState.foundDevices에서 해당 타입 기기만 추출
  const devices = window.antState.foundDevices.filter(d => d.deviceType === targetType);
  
  if (devices.length > 0) {
    // 검색 중 메시지 대신 기기 목록으로 교체
    listEl.innerHTML = devices.map(d => `
      <div class="ant-device-item" onclick="selectDeviceForInput('${d.id}', '${targetType}')" 
           style="padding:12px; border:1px solid #007bff; background:#f0f7ff; border-radius:8px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition: background 0.2s;">
        <div style="display:flex; flex-direction:column;">
          <span style="font-weight:bold; color:#0056b3; font-size:14px;">심박계 (ID: ${d.id})</span>
          <span style="font-size:11px; color:#28a745;">신호 감지됨</span>
        </div>
        <button class="btn btn-sm btn-primary" style="pointer-events:none;">선택</button>
      </div>
    `).join('');
    
    console.log(`[UI] ${devices.length}개의 심박계 리스트 출력 완료`);
  }
}

/**
 * 훈련 시작
 */
function startTrainingWithCountdown() {
  if (!window.indoorTrainingState.currentWorkout) {
    if (typeof showToast === 'function') {
      showToast('워크아웃을 선택해주세요.');
    }
    return;
  }
  
  // 카운트다운 후 시작
  // TODO: 카운트다운 구현
  startTraining();
}

/**
 * 훈련 시작
 */
function startTraining() {
  window.indoorTrainingState.trainingState = 'running';
  window.indoorTrainingState.startTime = Date.now();
  window.indoorTrainingState.currentSegmentIndex = 0;
  window.indoorTrainingState.segmentStartTime = Date.now();
  window.indoorTrainingState.segmentElapsedTime = 0;
  
  // 버튼 상태 업데이트
  const startBtn = document.getElementById('btnStartTraining');
  const pauseBtn = document.getElementById('btnPauseTraining');
  const stopBtn = document.getElementById('btnStopTraining');
  
  if (startBtn) startBtn.disabled = true;
  if (pauseBtn) pauseBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = false;
  
  // 타이머 시작
  startTrainingTimer();
}

/**
 * 훈련 일시정지
 */
function pauseTraining() {
  window.indoorTrainingState.trainingState = 'paused';
  window.indoorTrainingState.pausedTime = Date.now();
  
  const pauseBtn = document.getElementById('btnPauseTraining');
  if (pauseBtn) pauseBtn.disabled = true;
}

/**
 * 훈련 종료
 */
function stopTraining() {
  window.indoorTrainingState.trainingState = 'idle';
  
  const startBtn = document.getElementById('btnStartTraining');
  const pauseBtn = document.getElementById('btnPauseTraining');
  const stopBtn = document.getElementById('btnStopTraining');
  
  if (startBtn) startBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
}

/**
 * 훈련 타이머 시작
 */
function startTrainingTimer() {
  if (window.indoorTrainingState.trainingState !== 'running') return;
  
  const now = Date.now();
  if (window.indoorTrainingState.startTime) {
    const elapsed = Math.floor((now - window.indoorTrainingState.startTime - window.indoorTrainingState.pausedTime) / 1000);
    window.indoorTrainingState.totalElapsedTime = elapsed;
    
    // 세그먼트 경과 시간 업데이트
    if (window.indoorTrainingState.segmentStartTime) {
      window.indoorTrainingState.segmentElapsedTime = Math.floor((now - window.indoorTrainingState.segmentStartTime) / 1000);
    }
  }
  
  updateScoreboard();
  drawTrainingSegmentGraph();
  
  setTimeout(startTrainingTimer, 1000);
}

// 화면 전환 시 초기화
if (typeof showScreen === 'function') {
  const originalShowScreen = showScreen;
  window.showScreen = function(screenId) {
    originalShowScreen(screenId);
    
    if (screenId === 'indoorTrainingDashboardScreen') {
      setTimeout(() => {
        initIndoorTrainingDashboard();
      }, 100);
    }
  };
}



// [삽입 위치: 파일 맨 마지막]

function parseIndoorSensorPayload(payload) {
  if (payload.length < 13) return;
  
  const idLow = payload[10];
  const idHigh = payload[11];
  const deviceType = payload[12]; // 0x78: 심박계, 0x0B: 파워미터, 0x11: FE-C
  const transType = payload[13];
  
  // ID 계산 (로그의 9297 등 정상 추출)
  const deviceId = ((transType & 0xF0) << 12) | (idHigh << 8) | idLow;

  // 장치 목록 업데이트
  updateFoundDevicesList(deviceId, deviceType);

  // 실시간 데이터 반영 (훈련 중일 때)
  if (window.indoorTrainingState.trainingState === 'running') {
    processLiveTrainingData(deviceId, deviceType, payload);
  }
}

function updateFoundDevicesList(deviceId, deviceType) {
  let existing = window.antState.foundDevices.find(d => d.id === deviceId);
  
  if (!existing) {
    let typeName = (deviceType === 0x78) ? '심박계' : (deviceType === 0x0B ? '파워미터' : '스마트로라');
    existing = { id: deviceId, type: typeName, deviceType: deviceType };
    window.antState.foundDevices.push(existing);
    console.log(`[신규 장치 발견] ${typeName} ID: ${deviceId}`);
  }

  // [보완] 기존에 발견된 장치라도 현재 페어링 모달이 열려있다면 UI를 강제로 다시 그림
  renderPairingDeviceList(deviceType);
}

// 심박수(BPM) 및 파워 데이터 실시간 UI 반영
function processLiveTrainingData(deviceId, deviceType, payload) {
  const antData = payload.slice(1, 9);
  window.indoorTrainingState.powerMeters.forEach(pm => {
    // 심박수 업데이트 (로그 분석 결과 반영)
    if (pm.heartRateDeviceId == deviceId && deviceType === 0x78) {
      pm.heartRate = antData[7];
      const hrEl = document.getElementById(`heart-rate-value-${pm.id}`);
      if (hrEl) hrEl.textContent = pm.heartRate;
    }
    // 파워 데이터 업데이트
    if ((pm.deviceId == deviceId || pm.trainerDeviceId == deviceId) && (deviceType === 0x0B || deviceType === 0x11)) {
      const power = (antData[5] << 8) | antData[4];
      updatePowerMeterData(pm.id, power, pm.heartRate, antData[3]);
    }
  });
}


/**
 * 검색된 장치를 인도어 트레이닝 페어링 모달 리스트에 표시
 */
function renderPairingDeviceList(targetType) {
  const listId = (targetType === 0x78) ? 'heartRateDeviceList' : 
                 (targetType === 0x0B) ? 'powerMeterDeviceList' : 'trainerDeviceList';
  
  const listEl = document.getElementById(listId);
  if (!listEl) return;

  const devices = window.antState.foundDevices.filter(d => d.deviceType === targetType);
  
  // 리스트가 비어있지 않다면 즉시 렌더링
  if (devices.length > 0) {
    listEl.innerHTML = devices.map(d => `
      <div class="ant-device-item" onclick="selectDeviceForInput('${d.id}', '${targetType}')" 
           style="padding:10px; border:1px solid #007bff; background:#f0f7ff; border-radius:6px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-weight:600; color:#0056b3;">${d.type} (ID: ${d.id})</div>
        <button class="btn btn-sm btn-primary">선택</button>
      </div>
    `).join('');
    listEl.classList.remove('hidden');
  }
}


/**
 * [최종 패치] ANT+ 데이터와 index.html UI 강제 연결 로직
 */

// 1. 데이터 수신 및 분류 엔진 (ANT+ 0x4E 메시지 분석)
window.parseIndoorSensorPayload = function(payload) {
    if (payload.length < 13) return;
    
    // 로그에 찍힌 24 78 (0x78) 등 장치 정보 추출
    const idLow = payload[10];
    const idHigh = payload[11];
    const deviceType = payload[12]; // 0x78: 심박계, 0x0B: 파워미터, 0x11: FE-C
    const transType = payload[13];
    const deviceId = ((transType & 0xF0) << 12) | (idHigh << 8) | idLow;

    // 장치 발견 시 목록 업데이트 호출
    updateIndoorPairingUI(deviceId, deviceType);
    
    // 실시간 데이터 처리 (실행 중인 경우)
    if (window.indoorTrainingState.trainingState === 'running') {
        processLiveTrainingData(deviceId, deviceType, payload);
    }
};

// 2. index.html의 ID들과 직접 연동하여 리스트 생성
function updateIndoorPairingUI(deviceId, deviceType) {
    // 중복 체크
    if (window.antState.foundDevices.find(d => d.id === deviceId)) return;

    let typeName = '';
    let listId = '';
    
    // 장치 타입별 매핑 (index.html ID 기준)
    if (deviceType === 0x78) {
        typeName = '심박계';
        listId = 'heartRateDeviceList'; //
    } else if (deviceType === 0x0B) {
        typeName = '파워미터';
        listId = 'powerMeterDeviceList'; //
    } else if (deviceType === 0x11 || deviceType === 0x10) {
        typeName = '스마트로라';
        listId = 'trainerDeviceList'; //
    }

    if (!listId) return;

    // foundDevices 배열에 추가
    window.antState.foundDevices.push({ id: deviceId, type: typeName, deviceType: deviceType });

    // UI 리스트 업데이트
    const listEl = document.getElementById(listId);
    if (listEl) {
        // 기존 '검색 중' 메시지 제거 후 리스트 렌더링
        const devices = window.antState.foundDevices.filter(d => d.deviceType === deviceType);
        listEl.innerHTML = devices.map(d => `
            <div class="device-item" onclick="selectIndoorDevice('${d.id}', '${listId}')" 
                 style="padding:10px; border-bottom:1px solid #ddd; cursor:pointer; display:flex; justify-content:space-between;">
                <span><strong>${d.type}</strong> (ID: ${d.id})</span>
                <button class="btn btn-xs btn-primary">선택</button>
            </div>
        `).join('');
    }
}

// 3. 리스트 클릭 시 입력창(ID 필드)에 자동 삽입
window.selectIndoorDevice = function(deviceId, listId) {
    let inputId = '';
    // 리스트 ID에 따라 타겟 입력 필드 결정
    if (listId === 'heartRateDeviceList') inputId = 'heartRateDeviceId'; //
    else if (listId === 'powerMeterDeviceList') inputId = 'powerMeterDeviceId'; //
    else if (listId === 'trainerDeviceList') inputId = 'trainerDeviceId'; //

    const inputEl = document.getElementById(inputId);
    if (inputEl) {
        inputEl.value = deviceId;
        inputEl.style.backgroundColor = '#d4edda';
        setTimeout(() => inputEl.style.backgroundColor = '', 500);
        if (typeof showToast === 'function') showToast(`${deviceId} 장치가 선택되었습니다.`);
    }
};

