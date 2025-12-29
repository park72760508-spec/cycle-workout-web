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

// ANT+ 메시지 처리 함수 (processBuffer보다 먼저 정의)
function handleIndoorAntMessage(packet) {
  console.log('[Training] handleIndoorAntMessage: 함수 호출됨', packet?.length, packet);
  
  if (!packet || packet.length < 4) {
    console.warn('[Training] handleIndoorAntMessage: 패킷이 너무 짧음', packet?.length);
    return;
  }
  
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1);
  
  console.log(`[Training] handleIndoorAntMessage: msgId=0x${msgId.toString(16)}, payload.length=${payload.length}, packet.length=${packet.length}`);

  // 1. Tacx Wrapper 해제
  if (msgId === 0xAE && payload.length > 1 && payload[1] === 0xA4) {
      console.log('[Training] handleIndoorAntMessage: Tacx Wrapper 해제');
      window.processBuffer(payload.slice(1));
      return;
  }

  // 2. 센서 데이터(0x4E) 처리
  if (msgId === 0x4E) {
      console.log(`[Training] handleIndoorAntMessage: 0x4E 메시지 처리, parseIndoorSensorPayload 호출`);
      // parseIndoorSensorPayload 내부에서 화면 확인을 수행하므로 항상 호출
      parseIndoorSensorPayload(payload);
  } else {
      console.log(`[Training] handleIndoorAntMessage: 알 수 없는 msgId=0x${msgId.toString(16)}`);
  }
}

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

    console.log(`[Training] processBuffer: 패킷 추출 완료, packet.length=${packet.length}, msgId=0x${packet[2]?.toString(16)}`);
    
    try {
      // window.handleIndoorAntMessage를 직접 호출 (안정성을 위해)
      if (typeof window.handleIndoorAntMessage === 'function') {
        window.handleIndoorAntMessage(packet);
      } else {
        console.error('[Training] processBuffer: window.handleIndoorAntMessage 함수를 찾을 수 없습니다!');
      }
    } catch (e) {
      console.error('[Training] processBuffer: handleIndoorAntMessage 호출 에러:', e, e.stack);
    }
  }
};

/**
 * 1. 통합 데이터 라우팅 엔진 (충돌 방지 및 강제 연결)
 * 이 함수가 rollerRaceDashboard.js의 로그 출력부와 indoor UI를 연결합니다.
 */
window.handleIndoorAntMessage = function(packet) {
  console.log('[Training] window.handleIndoorAntMessage: 함수 호출됨', packet?.length);
  
  if (!packet || packet.length < 4) {
    console.warn('[Training] window.handleIndoorAntMessage: 패킷이 너무 짧음', packet?.length);
    return;
  }
  
  const msgId = packet[2];
  const payload = packet.slice(3, packet.length - 1);
  
  console.log(`[Training] window.handleIndoorAntMessage: msgId=0x${msgId.toString(16)}, payload.length=${payload.length}, packet.length=${packet.length}`);

  // Tacx T2028 Wrapper(0xAE) 해제
  if (msgId === 0xAE && payload.length > 1 && payload[1] === 0xA4) {
      console.log('[Training] window.handleIndoorAntMessage: Tacx Wrapper 해제');
      if (typeof window.processBuffer === 'function') window.processBuffer(payload.slice(1));
      return;
  }

  // 브로드캐스트 데이터(0x4E) 처리
  if (msgId === 0x4E) {
      console.log(`[Training] window.handleIndoorAntMessage: 0x4E 메시지 처리, window.parseIndoorSensorPayload 호출`);
      try {
          if (typeof window.parseIndoorSensorPayload === 'function') {
              window.parseIndoorSensorPayload(payload);
          } else {
              console.error('[Training] window.handleIndoorAntMessage: window.parseIndoorSensorPayload 함수를 찾을 수 없습니다!');
          }
      } catch (e) {
          console.error('[Training] window.handleIndoorAntMessage: parseIndoorSensorPayload 호출 에러:', e, e.stack);
      }
  } else {
      console.log(`[Training] window.handleIndoorAntMessage: 알 수 없는 msgId=0x${msgId.toString(16)}`);
  }
};



/**
 * Indoor Training 대시보드 초기화
 */
function initIndoorTrainingDashboard() {
  console.log('[Indoor Training] 대시보드 초기화');
  
  // 파워계 그리드 생성
  createPowerMeterGrid();
  
  // 저장된 페어링 정보 로드
  loadPowerMeterPairings();
  
  // 전광판 초기화
  updateScoreboard();
  
  // 세그먼트 그래프 초기화
  initSegmentGraph();
  
  // 사용자 FTP 로드
  loadUserFTP();
  
  // 모든 파워계의 연결 상태 업데이트
  updateAllPowerMeterConnectionStatuses();
  
  // 수신기 상태 변경 시 연결 상태 업데이트 (주기적으로 확인)
  if (window.indoorTrainingState.statusCheckInterval) {
    clearInterval(window.indoorTrainingState.statusCheckInterval);
  }
  window.indoorTrainingState.statusCheckInterval = setInterval(() => {
    updateAllPowerMeterConnectionStatuses();
  }, 1000); // 1초마다 확인
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
  window.indoorTrainingState.powerMeters = []; // 초기화
  
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
      <div style="display: flex !important; flex-direction: column !important; align-items: flex-start !important; flex: 0 0 auto !important; min-width: 100px !important; order: 1 !important;">
        <span class="speedometer-user-name" id="user-name-${powerMeter.id}" style="font-size: 13px !important; color: #ffffff !important; font-weight: 600 !important; text-align: left !important; margin-bottom: 2px !important; display: ${powerMeter.userName ? 'block' : 'none'} !important;">${powerMeter.userName || ''}</span>
        <span class="speedometer-pairing-name" id="pairing-name-${powerMeter.id}" style="font-size: 11px !important; color: #ffffff !important; font-weight: 400 !important; text-align: left !important; opacity: 0.8 !important; cursor: pointer;" onclick="openPowerMeterSettings(${powerMeter.id})">${powerMeter.pairingName || ''}</span>
      </div>
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
        
        <!-- 현재 파워값 (속도계 하단) -->
        <text x="100" y="188" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="43.2" 
              font-weight="700"
              id="current-power-value-${powerMeter.id}">-</text>
        
        <!-- 단위 W (바늘 중심 원 아래와 현재 파워값 위의 중간) -->
        <text x="100" y="157" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="10" 
              font-weight="500">W</text>
        
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
 * 사용자 FTP 값이 있으면: pos=120 → FTP*0, pos=100 → FTP*0.33, pos=80 → FTP*0.67, pos=60 → FTP*1, pos=40 → FTP*1.33, pos=20 → FTP*1.67, pos=0 → FTP*2
 * 사용자 FTP 값이 없으면: pos=120 → 0%, pos=60 → 100%, pos=0 → 200%
 * 주요 눈금(20 간격)에만 숫자 표시: pos=0, 20, 40, 60, 80, 100, 120
 * 원 중심으로 180도 회전
 * 반원의 둘레에 숫자가 닿지 않도록 약간의 간격 유지
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
  
  // FTP 값 확인
  const ftp = powerMeter.userFTP || window.indoorTrainingState.userFTP || null;
  const useFTPValue = !!ftp;
  
  // 주요 눈금 위치만 표시 (20 간격: 0, 20, 40, 60, 80, 100, 120)
  const majorPositions = [0, 20, 40, 60, 80, 100, 120];
  
  majorPositions.forEach(pos => {
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
    
    let displayValue;
    
    if (useFTPValue) {
      // FTP 값이 있는 경우: 특정 배수 적용
      // pos=120 → 0×FTP, pos=100 → 0.33×FTP, pos=80 → 0.67×FTP, 
      // pos=60 → 1×FTP (주황색), pos=40 → 1.33×FTP, pos=20 → 1.67×FTP, pos=0 → 2×FTP
      let multiplier;
      let isOneFTP = false; // 1×FTP 여부
      
      if (pos === 120) multiplier = 0;
      else if (pos === 100) multiplier = 0.33;
      else if (pos === 80) multiplier = 0.67;
      else if (pos === 60) {
        multiplier = 1;
        isOneFTP = true;
      }
      else if (pos === 40) multiplier = 1.33;
      else if (pos === 20) multiplier = 1.67;
      else if (pos === 0) multiplier = 2;
      else multiplier = 1;
      
      // FTP 값에 배수를 곱한 값을 정수로 표시
      displayValue = Math.round(ftp * multiplier).toString();
      
      // 1×FTP는 주황색으로 표기, 나머지는 흰색
      const textColor = isOneFTP ? '#ff8c00' : '#ffffff';
      
      labels += `<text x="${x}" y="${y}" 
                     text-anchor="middle" 
                     dominant-baseline="middle"
                     fill="${textColor}" 
                     font-size="15" 
                     font-weight="700">${displayValue}</text>`;
      return; // 이 부분에서는 return하여 아래 코드 실행 방지
    } else {
      // FTP 값이 없는 경우: 기존 방식 (퍼센트)
      // pos와 퍼센트의 관계: pos=120 → 0, pos=60 → 100, pos=0 → 200
      const percent = (120 - pos) / 120 * 200;
      const value = percent / 100;
      
      // 표기 형식: 정수는 소수점 없이, 소수는 적절한 자릿수로 표시
      if (Math.abs(value - Math.round(value)) < 0.01) {
        // 정수인 경우 (0, 1, 2)
        displayValue = Math.round(value).toString();
      } else {
        // 소수인 경우
        const rounded = Math.round(value * 100) / 100;
        const oneDecimal = Math.round(rounded * 10) / 10;
        
        if (Math.abs(rounded - oneDecimal) < 0.01) {
          displayValue = oneDecimal.toFixed(1);
          if (oneDecimal === Math.round(oneDecimal)) {
            displayValue = Math.round(oneDecimal).toString();
          }
        } else {
          displayValue = rounded.toFixed(2);
          displayValue = parseFloat(displayValue).toString();
        }
      }
    }
    
    // 흰색 숫자 (자동차 속도계 스타일) - FTP 값이 없을 때만 실행됨
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
  
  // 현재 바늘 각도 저장 (바늘 위치 유지)
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  let savedTransform = null;
  if (needleEl) {
    savedTransform = needleEl.getAttribute('transform');
  }
  
  // 눈금 재생성
  ticksEl.innerHTML = generatePowerMeterTicks(powerMeterId);
  labelsEl.innerHTML = generatePowerMeterLabels(powerMeterId);
  
  // 바늘 위치 복원 (현재 파워값으로 업데이트)
  if (needleEl && typeof updatePowerMeterNeedle === 'function') {
    const currentPower = powerMeter.currentPower || 0;
    updatePowerMeterNeedle(powerMeterId, currentPower);
  } else if (needleEl && savedTransform) {
    // updatePowerMeterNeedle 함수가 없으면 저장된 transform 복원
    needleEl.setAttribute('transform', savedTransform);
    needleEl.style.visibility = 'visible';
  }
}

/**
 * 파워계 바늘 업데이트
 * FTP 값이 있으면: 실제 파워값을 FTP 기준 눈금에 맞게 변환
 * FTP 값이 없으면: 실제 파워값을 퍼센트로 변환 (0% ~ 200%)
 */
/**
 * 파워계 바늘 업데이트 (Indoor Race 속도계 로직 적용)
 * 최대값: 사용자 FTP의 2배
 * 각도: 180도(0W) ~ 360도(Max)
 */
// 파워미터 카드 HTML을 생성한 직후 또는 목록을 그릴 때 호출
function initializeNeedles() {
  window.indoorTrainingState.powerMeters.forEach(pm => {
    // 초기 로딩 시 0W 기준으로 바늘 위치 설정 (180도)
    updatePowerMeterNeedle(pm.id, 0);
  });
}

// 기존 updatePowerMeterNeedle 함수 보강 (null 체크 및 초기값)
function updatePowerMeterNeedle(powerMeterId, power) {
    const needleEl = document.getElementById(`needle-${powerMeterId}`);
    if (!needleEl) {
        console.warn(`[PowerMeter] updatePowerMeterNeedle: 바늘 요소를 찾을 수 없음 (powerMeterId=${powerMeterId})`);
        return;
    }

    const ftp = window.indoorTrainingState?.userFTP || 200;
    const maxPower = ftp * 2;
    const ratio = Math.min(Math.max((power || 0) / maxPower, 0), 1);

    // 파워계도 속도계와 동일한 각도 체계 적용 (-90도 ~ 90도)
    const angle = -90 + (ratio * 180);

    // 부모 그룹이 translate(100, 140)을 하므로, rotate(angle)만 하면 됩니다
    needleEl.setAttribute('transform', `rotate(${angle})`);
    needleEl.style.visibility = 'visible';
    
    console.log(`[PowerMeter] updatePowerMeterNeedle: powerMeterId=${powerMeterId}, power=${power}, angle=${angle}, transform=${needleEl.getAttribute('transform')}, visibility=${needleEl.style.visibility}`);
}

// 페이지 로딩 완료 후 모든 바늘 0점으로 초기화
window.addEventListener('load', () => {
    setTimeout(() => {
        // 모든 바늘(needle-0, needle-1, needle-...)을 찾아서 -90도(0점)로 설정
        // 주의: 이 코드는 초기 로딩 시에만 실행되어야 하며, selectIndoorDevice 후에는 실행되지 않아야 함
        const allNeedles = document.querySelectorAll('line[id^="needle-"]');
        allNeedles.forEach(n => {
            // 부모 그룹이 translate(100, 140)을 하므로, rotate(-90)만 하면 됩니다
            n.setAttribute('transform', 'rotate(-90)');
        });
    }, 1500); // 레이스 트랙 생성 시간을 고려하여 충분히 대기
});

/**
 * 파워계 연결 상태 업데이트 (데이터 수신과 무관하게 상태만 업데이트)
 */
function updatePowerMeterConnectionStatus(powerMeterId) {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const statusEl = document.getElementById(`status-${powerMeterId}`);
  const statusDotEl = statusEl?.querySelector('.status-dot');
  const statusTextEl = statusEl?.querySelector('.status-text');
  
  // 조건 확인
  const hasUser = !!(powerMeter.userId);
  const hasReceiver = !!(window.antState && window.antState.usbDevice && window.antState.usbDevice.opened);
  const hasPowerDevice = !!(powerMeter.deviceId || powerMeter.trainerDeviceId);
  const hasData = powerMeter.currentPower > 0 || powerMeter.heartRate > 0 || powerMeter.cadence > 0;
  
  let statusClass = 'disconnected';
  let statusText = '미연결';
  
  // 연결 상태 판단
  if (hasUser && hasReceiver && hasPowerDevice && hasData) {
    statusClass = 'connected';
    statusText = '연결됨';
    powerMeter.connected = true;
  } else if (hasUser && hasReceiver) {
    statusClass = 'ready';
    statusText = '준비됨';
    powerMeter.connected = false;
  } else {
    statusClass = 'disconnected';
    statusText = '미연결';
    powerMeter.connected = false;
  }
  
  // 상태 표시 업데이트
  if (statusDotEl) {
    statusDotEl.classList.remove('disconnected', 'ready', 'connected');
    statusDotEl.classList.add(statusClass);
  }
  
  if (statusTextEl) {
    statusTextEl.textContent = statusText;
  }
}

/**
 * 모든 파워계의 연결 상태 업데이트
 */
function updateAllPowerMeterConnectionStatuses() {
  window.indoorTrainingState.powerMeters.forEach(pm => {
    updatePowerMeterConnectionStatus(pm.id);
  });
}

/**
 * 파워계 데이터 업데이트
 */
/**
 * 파워미터 데이터 업데이트 및 UI(바늘 포함) 반영
 */
function updatePowerMeterData(powerMeterId, power, heartRate = 0, cadence = 0) {
    const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
    if (!powerMeter) return;

    // 1. 데이터 저장
    powerMeter.currentPower = power;
    powerMeter.heartRate = heartRate;
    powerMeter.cadence = cadence;
    powerMeter.lastUpdateTime = Date.now();

    // 2. 바늘(Needle) 각도 계산 로직
    // 사용자 FTP 값을 가져옴 (설정 안 되어 있으면 기본값 200W 사용)
    const userFTP = window.indoorTrainingState.userFTP || 200;
    const maxGaugePower = userFTP * 2; // 게이지 최대치는 FTP의 2배
    
    // 파워 비율 계산 (0 ~ 1.0 사이로 제한)
    let powerRatio = power / maxGaugePower;
    if (powerRatio > 1) powerRatio = 1;
    if (powerRatio < 0) powerRatio = 0;

    // 각도 계산 (updatePowerMeterNeedle 함수와 동일한 방식)
    // -90도 = 위쪽/0W, 90도 = 아래쪽/최대값
    const angle = -90 + (powerRatio * 180);

    // 3. UI 업데이트
    // 숫자 값 업데이트
    const currentPowerEl = document.getElementById(`current-power-value-${powerMeterId}`);
    if (currentPowerEl) {
        currentPowerEl.textContent = Math.round(power);
    }

    // 케이던스 값 업데이트 (0 값도 표시)
    const cadenceEl = document.getElementById(`cadence-value-${powerMeterId}`);
    if (cadenceEl) {
        const cadenceValue = Math.round(cadence);
        cadenceEl.textContent = cadenceValue >= 0 ? cadenceValue : 0;
        console.log(`[Training] 케이던스 UI 업데이트: pm.id=${powerMeterId}, cadence=${cadenceValue}`);
    } else {
        console.warn(`[Training] 케이던스 UI 요소를 찾을 수 없음: cadence-value-${powerMeterId}`);
    }

    // 심박수 값 업데이트 (이미 processLiveTrainingData에서 업데이트되지만, 여기서도 업데이트)
    const heartRateEl = document.getElementById(`heart-rate-value-${powerMeterId}`);
    if (heartRateEl && heartRate > 0) {
        heartRateEl.textContent = Math.round(heartRate);
    }

    // 바늘 각도 애니메이션 적용
    // 부모 그룹이 translate(100, 140)을 하므로 rotate(angle)만 하면 됩니다
    const needleEl = document.getElementById(`needle-${powerMeterId}`);
    if (needleEl) {
        // updatePowerMeterNeedle과 완전히 동일한 방식 사용 (rotate(angle)만)
        needleEl.setAttribute('transform', `rotate(${angle})`);
        needleEl.style.visibility = 'visible';
    }
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
    
    // 저장된 페어링 정보 표시
    updatePairingModalWithSavedData(powerMeter);
    
    // 첫 번째 탭(사용자 선택)으로 초기화
    showPairingTab('user');
    
    // USB 상태 확인 및 업데이트
    updatePairingModalUSBStatus();
    
    // 바늘 위치 유지 (현재 파워값으로 업데이트)
    const currentPower = powerMeter.currentPower || 0;
    if (typeof updatePowerMeterNeedle === 'function') {
        updatePowerMeterNeedle(powerMeterId, currentPower);
    }
    
    // 모달 표시
    modal.classList.remove('hidden');
  }
}

/**
 * 저장된 페어링 정보를 모달에 표시
 */
function updatePairingModalWithSavedData(powerMeter) {
  // 사용자 정보 표시
  if (powerMeter.userId && powerMeter.userName) {
    const resultEl = document.getElementById('pairingUserSearchResult');
    if (resultEl) {
      const wkg = powerMeter.userFTP && powerMeter.userWeight ? (powerMeter.userFTP / powerMeter.userWeight).toFixed(1) : '-';
      resultEl.innerHTML = `
        <div style="padding: 16px; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <div style="font-size: 18px; font-weight: 600; color: #155724; margin-bottom: 8px;">${powerMeter.userName}</div>
              <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #155724;">
                <span><strong>FTP:</strong> ${powerMeter.userFTP || '-'}W</span>
                <span><strong>체중:</strong> ${powerMeter.userWeight || '-'}kg</span>
                <span><strong>W/kg:</strong> ${wkg}</span>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearSelectedUser()" style="white-space: nowrap;">선택 해제</button>
          </div>
        </div>
      `;
    }
  } else {
    const resultEl = document.getElementById('pairingUserSearchResult');
    if (resultEl) {
      resultEl.innerHTML = '';
    }
  }
  
  // 스마트로라 정보 표시
  if (powerMeter.trainerDeviceId) {
    const trainerNameEl = document.getElementById('trainerPairingName');
    const trainerDeviceIdEl = document.getElementById('trainerDeviceId');
    const btnClearTrainer = document.getElementById('btnClearTrainer');
    if (trainerNameEl) trainerNameEl.value = powerMeter.trainerName || '';
    if (trainerDeviceIdEl) trainerDeviceIdEl.value = powerMeter.trainerDeviceId || '';
    if (btnClearTrainer) btnClearTrainer.style.display = 'block';
  } else {
    const btnClearTrainer = document.getElementById('btnClearTrainer');
    if (btnClearTrainer) btnClearTrainer.style.display = 'none';
  }
  
  // 파워메터 정보 표시
  if (powerMeter.deviceId) {
    const powerNameEl = document.getElementById('powerMeterPairingName');
    const powerDeviceIdEl = document.getElementById('powerMeterDeviceId');
    const btnClearPower = document.getElementById('btnClearPower');
    if (powerNameEl) powerNameEl.value = powerMeter.pairingName || '';
    if (powerDeviceIdEl) powerDeviceIdEl.value = powerMeter.deviceId || '';
    if (btnClearPower) btnClearPower.style.display = 'block';
  } else {
    const btnClearPower = document.getElementById('btnClearPower');
    if (btnClearPower) btnClearPower.style.display = 'none';
  }
  
  // 심박계 정보 표시
  if (powerMeter.heartRateDeviceId) {
    const heartNameEl = document.getElementById('heartRatePairingName');
    const heartDeviceIdEl = document.getElementById('heartRateDeviceId');
    const btnClearHeart = document.getElementById('btnClearHeart');
    if (heartNameEl) heartNameEl.value = powerMeter.heartRateName || '';
    if (heartDeviceIdEl) heartDeviceIdEl.value = powerMeter.heartRateDeviceId || '';
    if (btnClearHeart) btnClearHeart.style.display = 'block';
  } else {
    const btnClearHeart = document.getElementById('btnClearHeart');
    if (btnClearHeart) btnClearHeart.style.display = 'none';
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
  
  // 사용자 선택 탭인 경우 전화번호 입력 필드에 포커스
  if (tabName === 'user') {
    setTimeout(() => {
      const phoneInput = document.getElementById('pairingPhoneNumber');
      if (phoneInput) {
        phoneInput.focus();
      }
    }, 100);
  }
}

/**
 * 페어링용 사용자 목록 로드 (더 이상 사용하지 않음 - 전화번호 검색 방식으로 변경)
 */
async function loadUsersForPairing() {
  // 전화번호 검색 방식으로 변경되었으므로 이 함수는 더 이상 사용하지 않음
  // 하지만 호환성을 위해 유지
  const userListEl = document.getElementById('powerMeterUserList');
  if (userListEl) {
    userListEl.style.display = 'none';
  }
}

/**
 * 전화번호로 사용자 검색 (페어링용)
 */
async function searchUserByPhoneForPairing() {
  const phoneInput = document.getElementById('pairingPhoneNumber');
  const resultEl = document.getElementById('pairingUserSearchResult');
  const searchBtn = document.getElementById('btnSearchUserByPhone');
  
  if (!phoneInput || !resultEl) return;
  
  const phoneNumber = phoneInput.value.trim();
  
  if (!phoneNumber) {
    if (typeof showToast === 'function') {
      showToast('전화번호를 입력해주세요.');
    }
    return;
  }
  
  // 검색 버튼 비활성화
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.textContent = '검색 중...';
  }
  
  // 결과 영역 초기화
  resultEl.innerHTML = '<div class="loading-spinner">사용자를 검색하는 중...</div>';
  
  try {
    // authenticatePhoneWithDB 함수 사용
    if (typeof authenticatePhoneWithDB === 'function') {
      const authResult = await authenticatePhoneWithDB(phoneNumber);
      
      if (authResult.success && authResult.user) {
        // 사용자 찾음 - 선택 가능하도록 표시
        const user = authResult.user;
        const wkg = user.ftp && user.weight ? (user.ftp / user.weight).toFixed(1) : '-';
        
        // 중복 체크: 다른 트랙에서 이미 사용 중인지 확인
        const powerMeterId = window.currentTargetPowerMeterId;
        const isAlreadyPaired = window.indoorTrainingState.powerMeters.some(pm => 
          pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(user.id)
        );
        
        // 사용자 정보를 전역에 임시 저장 (선택 시 사용)
        window._searchedUserForPairing = user;
        
        let selectButton = '';
        let warningMessage = '';
        
        if (isAlreadyPaired) {
          // 이미 다른 트랙에서 사용 중
          const pairedTrack = window.indoorTrainingState.powerMeters.find(pm => 
            pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(user.id)
          );
          warningMessage = `<div style="padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; margin-bottom: 12px; color: #856404; font-size: 12px;">⚠️ 이 사용자는 이미 트랙${pairedTrack?.id || '?'}에서 사용 중입니다.</div>`;
          selectButton = `<button class="btn btn-secondary" style="width: 100%;" disabled>이미 사용 중</button>`;
        } else {
          selectButton = `<button class="btn btn-primary" style="width: 100%;" onclick="event.stopPropagation(); selectSearchedUserForPowerMeter(${user.id})">선택</button>`;
        }
        
        resultEl.innerHTML = `
          <div class="user-card-compact" style="padding: 16px; border: 2px solid #007bff; border-radius: 8px; background: #f0f7ff;">
            ${warningMessage}
            <div class="user-info">
              <div class="user-name" style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">${user.name || '-'}</div>
              <div class="user-stats-compact" style="display: flex; gap: 16px; flex-wrap: wrap;">
                <span style="font-size: 14px;"><strong>FTP:</strong> ${user.ftp || '-'}W</span>
                <span style="font-size: 14px;"><strong>체중:</strong> ${user.weight || '-'}kg</span>
                <span style="font-size: 14px;"><strong>W/kg:</strong> ${wkg}</span>
                <span style="font-size: 14px;"><strong>전화번호:</strong> ${user.contact || phoneNumber}</span>
              </div>
            </div>
            <div style="margin-top: 12px; text-align: center;">
              ${selectButton}
            </div>
          </div>
        `;
        
        if (typeof showToast === 'function') {
          if (isAlreadyPaired) {
            showToast('이 사용자는 이미 다른 트랙에서 사용 중입니다.');
          } else {
            showToast('사용자를 찾았습니다. 선택해주세요.');
          }
        }
      } else {
        // 사용자를 찾을 수 없음
        resultEl.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #dc3545; border: 1px solid #dc3545; border-radius: 8px; background: #f8d7da;">
            <p style="margin: 0 0 12px 0; font-weight: 600;">${authResult.message || '사용자를 찾을 수 없습니다.'}</p>
            <p style="margin: 0; font-size: 12px; color: #721c24;">등록되지 않은 전화번호입니다.</p>
          </div>
        `;
      }
    } else {
      // authenticatePhoneWithDB 함수가 없는 경우 대체 방법
      resultEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #dc3545;">
          인증 함수를 찾을 수 없습니다. 앱을 새로고침해주세요.
        </div>
      `;
    }
  } catch (error) {
    console.error('[Indoor Training] 사용자 검색 오류:', error);
    resultEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #dc3545;">
        검색 중 오류가 발생했습니다: ${error.message}
      </div>
    `;
  } finally {
    // 검색 버튼 복구
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '검색';
    }
  }
}

/**
 * 검색된 사용자를 파워계에 선택
 */
async function selectSearchedUserForPowerMeter(userId) {
  const powerMeterId = window.currentTargetPowerMeterId;
  if (!powerMeterId) {
    if (typeof showToast === 'function') {
      showToast('파워계를 선택해주세요.');
    }
    return;
  }
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  try {
    // 사용자 정보 가져오기
    let user = null;
    
    // 방법 1: 검색 결과에서 임시 저장된 사용자 정보 사용 (가장 빠름)
    if (window._searchedUserForPairing && String(window._searchedUserForPairing.id) === String(userId)) {
      user = window._searchedUserForPairing;
    }
    
    // 방법 2: apiGetUsers 함수 사용
    if (!user && typeof apiGetUsers === 'function') {
      const result = await apiGetUsers();
      if (result && result.success && Array.isArray(result.items)) {
        user = result.items.find(u => String(u.id) === String(userId));
      }
    }
    
    // 방법 3: apiGetUsers가 없으면 window.apiGetUsers 시도
    if (!user && typeof window.apiGetUsers === 'function') {
      const result = await window.apiGetUsers();
      if (result && result.success && Array.isArray(result.items)) {
        user = result.items.find(u => String(u.id) === String(userId));
      }
    }
    
    // 방법 4: dbUsers에서 직접 찾기 (app.js에서 사용하는 방식)
    if (!user && window.dbUsers && Array.isArray(window.dbUsers)) {
      user = window.dbUsers.find(u => String(u.id) === String(userId));
    }
    
    if (user) {
        // 중복 체크: 다른 트랙에서 이미 사용 중인지 확인
        const isAlreadyPaired = window.indoorTrainingState.powerMeters.some(pm => 
          pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(userId)
        );
        
        if (isAlreadyPaired) {
          const pairedTrack = window.indoorTrainingState.powerMeters.find(pm => 
            pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(userId)
          );
          if (typeof showToast === 'function') {
            showToast(`이 사용자는 이미 트랙${pairedTrack?.id || '?'}에서 사용 중입니다.`);
          }
          return;
        }
        
        // 파워계에 사용자 정보 저장
        powerMeter.userId = userId;
        powerMeter.userFTP = user.ftp;
        powerMeter.userName = user.name;
        powerMeter.userWeight = user.weight;
        powerMeter.userContact = user.contact;
        
        // 사용자명 UI 업데이트 (트랙번호 라인 좌측)
        const userNameEl = document.getElementById(`user-name-${powerMeterId}`);
        if (userNameEl) {
          userNameEl.textContent = user.name;
          userNameEl.style.display = 'block';
        }
        
        // FTP 기반 눈금 업데이트
        updatePowerMeterTicks(powerMeterId);
        
        // 현재 사용자로 설정 (훈련 자료에 활용)
        window.currentUser = {
          id: user.id,
          name: user.name,
          contact: user.contact,
          ftp: user.ftp,
          weight: user.weight,
          grade: user.grade || '2',
          challenge: user.challenge || 'Fitness',
          expiry_date: user.expiry_date || ''
        };
        window.authUser = window.currentUser; // 인증 사용자로도 설정
        
        // 사용자 정보 UI 업데이트 (훈련 화면 등에서 사용)
        if (typeof renderUserInfo === 'function') {
          renderUserInfo();
        }
        
        // 저장
        saveAllPowerMeterPairingsToStorage();
        
        // UI 업데이트
        const resultEl = document.getElementById('pairingUserSearchResult');
        if (resultEl) {
          resultEl.innerHTML = `
            <div style="padding: 16px; text-align: center; color: #28a745; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
              <p style="margin: 0; font-weight: 600; font-size: 16px;">✅ ${user.name}님이 선택되었습니다.</p>
              <p style="margin: 8px 0 0 0; font-size: 12px;">이 사용자 정보가 훈련 자료에 활용됩니다.</p>
            </div>
          `;
        }
        
        if (typeof showToast === 'function') {
          showToast(`${user.name}님이 선택되었습니다. 훈련 자료에 활용됩니다.`);
        }
        
        console.log('[Indoor Training] 사용자 선택 완료:', {
          powerMeterId,
          userId,
          userName: user.name,
          userFTP: user.ftp,
          userWeight: user.weight
        });
    } else {
      // 사용자 정보를 찾을 수 없는 경우
      if (typeof showToast === 'function') {
        showToast('사용자 정보를 찾을 수 없습니다.');
      }
    }
  } catch (error) {
    console.error('[Indoor Training] 사용자 선택 오류:', error);
    if (typeof showToast === 'function') {
      showToast('사용자 선택 중 오류가 발생했습니다.');
    }
  }
}

/**
 * 전화번호 입력 시 자동 포맷팅
 */
function formatPhoneNumberInput(input) {
  let value = input.value.replace(/\D/g, ''); // 숫자만 남기기
  
  // 11자리 숫자인 경우 하이픈 추가
  if (value.length === 11 && value.startsWith('010')) {
    value = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7, 11);
  }
  
  input.value = value;
}

/**
 * 선택된 사용자 해제
 */
function clearSelectedUser() {
  const powerMeterId = window.currentTargetPowerMeterId;
  if (!powerMeterId) return;
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  // 사용자 정보 제거
  powerMeter.userId = null;
  powerMeter.userFTP = null;
  powerMeter.userName = null;
  powerMeter.userWeight = null;
  powerMeter.userContact = null;
  
  // UI 업데이트
  const userNameEl = document.getElementById(`user-name-${powerMeterId}`);
  if (userNameEl) {
    userNameEl.style.display = 'none';
  }
  
  // 모달 내 검색 결과 영역 초기화
  const resultEl = document.getElementById('pairingUserSearchResult');
  if (resultEl) {
    resultEl.innerHTML = '';
  }
  
  // FTP 기반 눈금 업데이트 (기본값으로 복귀)
  updatePowerMeterTicks(powerMeterId);
  
  // 연결 상태 업데이트
  updatePowerMeterConnectionStatus(powerMeterId);
  
  // 저장
  saveAllPowerMeterPairingsToStorage();
  
  if (typeof showToast === 'function') {
    showToast('사용자 선택이 해제되었습니다.');
  }
}

/**
 * 페어링된 기기 해제
 */
function clearPairedDevice(deviceType) {
  const powerMeterId = window.currentTargetPowerMeterId;
  if (!powerMeterId) return;
  
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  if (deviceType === 'trainer') {
    powerMeter.trainerName = null;
    powerMeter.trainerDeviceId = null;
    const trainerNameEl = document.getElementById('trainerPairingName');
    const trainerDeviceIdEl = document.getElementById('trainerDeviceId');
    const btnClearTrainer = document.getElementById('btnClearTrainer');
    if (trainerNameEl) trainerNameEl.value = '';
    if (trainerDeviceIdEl) trainerDeviceIdEl.value = '';
    if (btnClearTrainer) btnClearTrainer.style.display = 'none';
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    if (typeof showToast === 'function') {
      showToast('스마트로라 페어링이 해제되었습니다.');
    }
  } else if (deviceType === 'power') {
    powerMeter.pairingName = null;
    powerMeter.deviceId = null;
    const powerNameEl = document.getElementById('powerMeterPairingName');
    const powerDeviceIdEl = document.getElementById('powerMeterDeviceId');
    const btnClearPower = document.getElementById('btnClearPower');
    if (powerNameEl) powerNameEl.value = '';
    if (powerDeviceIdEl) powerDeviceIdEl.value = '';
    if (btnClearPower) btnClearPower.style.display = 'none';
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    if (typeof showToast === 'function') {
      showToast('파워메터 페어링이 해제되었습니다.');
    }
  } else if (deviceType === 'heart') {
    powerMeter.heartRateName = null;
    powerMeter.heartRateDeviceId = null;
    const heartNameEl = document.getElementById('heartRatePairingName');
    const heartDeviceIdEl = document.getElementById('heartRateDeviceId');
    const btnClearHeart = document.getElementById('btnClearHeart');
    if (heartNameEl) heartNameEl.value = '';
    if (heartDeviceIdEl) heartDeviceIdEl.value = '';
    if (btnClearHeart) btnClearHeart.style.display = 'none';
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    if (typeof showToast === 'function') {
      showToast('심박계 페어링이 해제되었습니다.');
    }
  }
}

/**
 * 디바이스 ID 중복 체크
 */
function isDeviceAlreadyPaired(deviceId, deviceType, excludePowerMeterId) {
  if (!deviceId) return false;
  
  return window.indoorTrainingState.powerMeters.some(pm => {
    if (pm.id === excludePowerMeterId) return false;
    
    if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === String(deviceId)) {
      return true;
    }
    if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === String(deviceId)) {
      return true;
    }
    if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === String(deviceId)) {
      return true;
    }
    return false;
  });
}

// 전역 함수로 등록
window.searchUserByPhoneForPairing = searchUserByPhoneForPairing;
window.selectSearchedUserForPowerMeter = selectSearchedUserForPowerMeter;
window.formatPhoneNumberInput = formatPhoneNumberInput;
window.clearSelectedUser = clearSelectedUser;
window.clearPairedDevice = clearPairedDevice;

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
        powerMeter.userWeight = user.weight;
        powerMeter.userContact = user.contact;
        
        // 사용자명 UI 업데이트 (트랙번호 라인 좌측)
        const userNameEl = document.getElementById(`user-name-${powerMeterId}`);
        if (userNameEl) {
          userNameEl.textContent = user.name;
          userNameEl.style.display = 'block';
        }
        
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
    // 눈금 업데이트
    updatePowerMeterTicks(powerMeterId);
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    // 바늘 위치 유지 (현재 파워값으로 업데이트)
    const currentPower = powerMeter.currentPower || 0;
    updatePowerMeterNeedle(powerMeterId, currentPower);
    
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
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    // 바늘 위치 유지 (현재 파워값으로 업데이트)
    const currentPower = powerMeter.currentPower || 0;
    updatePowerMeterNeedle(powerMeterId, currentPower);
    
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
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    // 바늘 위치 유지 (현재 파워값으로 업데이트)
    const currentPower = powerMeter.currentPower || 0;
    updatePowerMeterNeedle(powerMeterId, currentPower);
    
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
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
    
    // 바늘 위치 유지 (현재 파워값으로 업데이트)
    const currentPower = powerMeter.currentPower || 0;
    updatePowerMeterNeedle(powerMeterId, currentPower);
    
    closePowerMeterPairingModal();
    if (typeof showToast === 'function') {
      showToast('심박계가 페어링되었습니다.');
    }
  }
}

/**
 * 모든 파워계 페어링 정보를 localStorage에 저장
 */
function saveAllPowerMeterPairingsToStorage() {
  try {
    const pairings = window.indoorTrainingState.powerMeters.map(pm => ({
      id: pm.id,
      userId: pm.userId,
      userName: pm.userName,
      userFTP: pm.userFTP,
      userWeight: pm.userWeight,
      userContact: pm.userContact,
      trainerName: pm.trainerName,
      trainerDeviceId: pm.trainerDeviceId,
      pairingName: pm.pairingName,
      deviceId: pm.deviceId,
      heartRateName: pm.heartRateName,
      heartRateDeviceId: pm.heartRateDeviceId
    }));
    localStorage.setItem('indoorTrainingPowerMeterPairings', JSON.stringify(pairings));
    console.log('[Indoor Training] 페어링 정보 저장 완료');
  } catch (error) {
    console.error('[Indoor Training] 페어링 정보 저장 실패:', error);
  }
}

/**
 * localStorage에서 파워계 페어링 정보 로드
 */
function loadPowerMeterPairings() {
  try {
    const stored = localStorage.getItem('indoorTrainingPowerMeterPairings');
    if (!stored) return;
    
    const pairings = JSON.parse(stored);
    if (!Array.isArray(pairings)) return;
    
    pairings.forEach(pairing => {
      const powerMeter = window.indoorTrainingState.powerMeters.find(pm => pm.id === pairing.id);
      if (powerMeter) {
        // 페어링 정보 복원
        powerMeter.userId = pairing.userId || null;
        powerMeter.userName = pairing.userName || null;
        powerMeter.userFTP = pairing.userFTP || null;
        powerMeter.userWeight = pairing.userWeight || null;
        powerMeter.userContact = pairing.userContact || null;
        powerMeter.trainerName = pairing.trainerName || null;
        powerMeter.trainerDeviceId = pairing.trainerDeviceId || null;
        powerMeter.pairingName = pairing.pairingName || null;
        powerMeter.deviceId = pairing.deviceId || null;
        powerMeter.heartRateName = pairing.heartRateName || null;
        powerMeter.heartRateDeviceId = pairing.heartRateDeviceId || null;
        
        // UI 업데이트
        updatePowerMeterUIFromPairing(powerMeter);
        
        // FTP 기반 눈금 업데이트
        updatePowerMeterTicks(powerMeter.id);
        
        // 연결 상태 업데이트
        updatePowerMeterConnectionStatus(powerMeter.id);
        
        // 바늘 위치 유지 (현재 파워값으로 업데이트)
        const currentPower = powerMeter.currentPower || 0;
        if (typeof updatePowerMeterNeedle === 'function') {
            updatePowerMeterNeedle(powerMeter.id, currentPower);
        }
      }
    });
    
    console.log('[Indoor Training] 페어링 정보 로드 완료');
  } catch (error) {
    console.error('[Indoor Training] 페어링 정보 로드 실패:', error);
  }
}

/**
 * 페어링 정보로부터 UI 업데이트
 */
function updatePowerMeterUIFromPairing(powerMeter) {
  // 사용자 이름 표시
  const userNameEl = document.getElementById(`user-name-${powerMeter.id}`);
  if (userNameEl) {
    if (powerMeter.userName) {
      userNameEl.textContent = powerMeter.userName;
      userNameEl.style.display = 'block';
    } else {
      userNameEl.style.display = 'none';
    }
  }
  
  // 페어링 이름 표시
  const pairingNameEl = document.getElementById(`pairing-name-${powerMeter.id}`);
  if (pairingNameEl) {
    pairingNameEl.textContent = powerMeter.pairingName || '';
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

  const powerMeterId = window.currentTargetPowerMeterId;
  let deviceType = '';
  if (targetType === 0x78) deviceType = 'heart';
  else if (targetType === 0x0B) deviceType = 'power';
  else if (targetType === 0x11 || targetType === 0x10) deviceType = 'trainer';

  // window.antState.foundDevices에서 해당 타입 기기만 추출
  const devices = window.antState.foundDevices.filter(d => d.deviceType === targetType);
  
  if (devices.length > 0) {
    // 검색 중 메시지 대신 기기 목록으로 교체
    listEl.innerHTML = devices.map(d => {
      const isPaired = isDeviceAlreadyPaired(d.id, deviceType, powerMeterId);
      const pairedTrack = isPaired ? window.indoorTrainingState.powerMeters.find(pm => {
        if (pm.id === powerMeterId) return false;
        if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === String(d.id)) return true;
        if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === String(d.id)) return true;
        if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === String(d.id)) return true;
        return false;
      }) : null;
      
      const deviceName = (targetType === 0x78) ? '심박계' : (targetType === 0x0B) ? '파워미터' : '스마트로라';
      
      return `
        <div class="ant-device-item" ${!isPaired ? `onclick="selectDeviceForInput('${d.id}', '${targetType}')"` : ''}
             style="padding:12px; border:1px solid ${isPaired ? '#dc3545' : '#007bff'}; background:${isPaired ? '#f8d7da' : '#f0f7ff'}; border-radius:8px; margin-bottom:8px; ${!isPaired ? 'cursor:pointer;' : ''} display:flex; justify-content:space-between; align-items:center; transition: background 0.2s;">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:bold; color:${isPaired ? '#721c24' : '#0056b3'}; font-size:14px;">${deviceName} (ID: ${d.id})</span>
            ${isPaired ? `<span style="font-size:11px; color:#dc3545;">⚠️ 트랙${pairedTrack?.id || '?'}에서 사용 중</span>` : '<span style="font-size:11px; color:#28a745;">신호 감지됨</span>'}
          </div>
          <button class="btn btn-sm ${isPaired ? 'btn-secondary' : 'btn-primary'}" style="pointer-events:none;" ${isPaired ? 'disabled' : ''}>${isPaired ? '사용 중' : '선택'}</button>
        </div>
      `;
    }).join('');
    
    console.log(`[UI] ${devices.length}개의 ${deviceType} 리스트 출력 완료`);
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
  console.log('[Training] parseIndoorSensorPayload: 함수 호출됨, payload.length=', payload.length);
  
  // 현재 화면 확인 (Training 화면일 때만 처리)
  const currentScreen = document.querySelector('.screen.active');
  const isTrainingScreen = currentScreen && currentScreen.id === 'indoorTrainingDashboardScreen';
  console.log('[Training] parseIndoorSensorPayload: 화면 확인', {
    currentScreen: currentScreen?.id,
    isTrainingScreen: isTrainingScreen,
    powerMeterGrid: !!document.getElementById('powerMeterGrid')
  });
  
  if (!isTrainingScreen) {
    // Training 화면이 아니면 처리하지 않음
    console.log('[Training] parseIndoorSensorPayload: Training 화면이 아니므로 처리하지 않음');
    return;
  }
  
  // 페이로드 길이 체크 (20바이트 확장 패킷 기준)
  if (payload.length < 18) {
    // 구형 13바이트 패킷도 지원
    if (payload.length < 13) {
      console.log('[Training] parseIndoorSensorPayload: payload가 너무 짧음', payload.length);
      return;
    }
  }
  
  // ID 추출 위치 확인
  // 로그 분석: A4 14 4E 00 00 FF FF FF CF 91 9B 68 E0 51 24 78 01 10 00 68 00 77 53 1C
  // payload[10]=0x51 (idLow), payload[11]=0x24 (idHigh), payload[12]=0x78 (deviceType), payload[13]=0x01 (transType)
  let idLow, idHigh, deviceType, transType;
  if (payload.length >= 14) {
    // 표준 위치: payload[10]=idLow, payload[11]=idHigh, payload[12]=deviceType, payload[13]=transType
    idLow = payload[10];
    idHigh = payload[11];
    deviceType = payload[12];
    transType = payload[13];
  } else if (payload.length >= 13) {
    // 최소 길이: payload[10]=idLow, payload[11]=idHigh, payload[12]=deviceType
    idLow = payload[10];
    idHigh = payload[11];
    deviceType = payload[12];
    transType = payload.length > 13 ? payload[13] : 0;
  } else {
    console.log('[Training] parseIndoorSensorPayload: payload가 ID 추출에 필요한 길이보다 짧음', payload.length);
    return;
  }
  
  // ID 계산 (로그의 9297 등 정상 추출)
  const deviceId = ((transType & 0xF0) << 12) | (idHigh << 8) | idLow;
  
  console.log(`[Training] parseIndoorSensorPayload: deviceId=${deviceId}, deviceType=0x${deviceType.toString(16)}, payload.length=${payload.length}`);

  // 장치 목록 업데이트
  updateFoundDevicesList(deviceId, deviceType);

  // 실시간 데이터 반영 (훈련 중이거나 페어링된 장치의 경우)
  // 페어링된 장치는 훈련 시작 전에도 데이터를 받을 수 있도록
  // 심박계 타입: 0x78 (구형), 0x7D (신형)
  const isPairedDevice = window.indoorTrainingState.powerMeters.some(pm => {
    const pmHeartRateDeviceId = pm.heartRateDeviceId ? String(pm.heartRateDeviceId) : null;
    const pmDeviceId = pm.deviceId ? String(pm.deviceId) : null;
    const pmTrainerDeviceId = pm.trainerDeviceId ? String(pm.trainerDeviceId) : null;
    const receivedDeviceId = String(deviceId);
    
    return ((deviceType === 0x78 || deviceType === 0x7D) && pmHeartRateDeviceId === receivedDeviceId) ||
           ((deviceType === 0x0B || deviceType === 0x11) && (pmDeviceId === receivedDeviceId || pmTrainerDeviceId === receivedDeviceId));
  });
  
  console.log(`[Training] parseIndoorSensorPayload: isPairedDevice=${isPairedDevice}, trainingState=${window.indoorTrainingState.trainingState}, powerMeters.length=${window.indoorTrainingState.powerMeters.length}`);
  
  if (window.indoorTrainingState.trainingState === 'running' || isPairedDevice) {
    console.log(`[Training] processLiveTrainingData 호출: deviceId=${deviceId}, deviceType=0x${deviceType.toString(16)}`);
    processLiveTrainingData(deviceId, deviceType, payload);
  } else {
    console.log(`[Training] 데이터 처리 건너뜀: 페어링 안됨, 훈련 중 아님`);
  }
}

function updateFoundDevicesList(deviceId, deviceType) {
  let existing = window.antState.foundDevices.find(d => d.id === deviceId);
  
  if (!existing) {
    let typeName;
    if (deviceType === 0x78 || deviceType === 0x7D) {
      typeName = '심박계';
    } else if (deviceType === 0x0B || deviceType === 0x11) {
      typeName = deviceType === 0x0B ? '파워미터' : '스마트로라';
    } else {
      typeName = '알 수 없음';
    }
    existing = { id: deviceId, type: typeName, deviceType: deviceType };
    window.antState.foundDevices.push(existing);
    console.log(`[Training] 신규 장치 발견: ${typeName} ID: ${deviceId}`);
  }
  
  // [보완] 기존에 발견된 장치라도 현재 페어링 모달이 열려있다면 UI를 강제로 다시 그림
  renderPairingDeviceList(deviceType);
}

// 심박수(BPM) 및 파워 데이터 실시간 UI 반영
// 심박수(BPM) 및 파워 데이터 실시간 UI 반영 (수정본)
function processLiveTrainingData(deviceId, deviceType, payload) {
    const antData = payload.slice(1, 9);
    const pageNum = antData[0] & 0x7F; // 토글 비트 제외한 페이지 번호

    window.indoorTrainingState.powerMeters.forEach(pm => {
        const pmHeartRateDeviceId = pm.heartRateDeviceId ? String(pm.heartRateDeviceId) : null;
        const pmDeviceId = pm.deviceId ? String(pm.deviceId) : null;
        const pmTrainerDeviceId = pm.trainerDeviceId ? String(pm.trainerDeviceId) : null;
        const receivedDeviceId = String(deviceId);

        // 1. 심박계 처리 (0x78: 구형, 0x7D: 신형)
        if ((deviceType === 0x78 || deviceType === 0x7D) && pmHeartRateDeviceId === receivedDeviceId) {
            // ANT+ Heart Rate Profile: 대부분의 페이지에서 Byte 7이 Computed Heart Rate임
            const heartRate = antData[7];
            console.log(`[Training] 심박계 데이터 수신: deviceId=${receivedDeviceId}, heartRate=${heartRate}, pm.id=${pm.id}`);
            if (heartRate > 0 && heartRate < 255) {
                pm.heartRate = heartRate;
                const hrEl = document.getElementById(`heart-rate-value-${pm.id}`);
                if (hrEl) {
                    hrEl.textContent = Math.round(heartRate);
                    console.log(`[Training] 심박수 UI 업데이트: pm.id=${pm.id}, heartRate=${heartRate}`);
                } else {
                    console.warn(`[Training] 심박수 UI 요소를 찾을 수 없음: heart-rate-value-${pm.id}`);
                }
                
                // 파워미터 데이터도 함께 업데이트 (심박수 변경 시)
                updatePowerMeterData(pm.id, pm.currentPower, heartRate, pm.cadence);
            } else {
                console.log(`[Training] 심박수 값이 유효하지 않음: ${heartRate}`);
            }
        } else if ((deviceType === 0x78 || deviceType === 0x7D)) {
            // 심박계이지만 페어링되지 않은 경우
            console.log(`[Training] 심박계 데이터 수신 (페어링 안됨): deviceId=${receivedDeviceId}, deviceType=0x${deviceType.toString(16)}, pmHeartRateDeviceId=${pmHeartRateDeviceId}`);
        }

        // 2. 파워미터/스마트로라 처리 (0x0B, 0x11)
        if ((deviceType === 0x0B || deviceType === 0x11) && 
            (pmDeviceId === receivedDeviceId || pmTrainerDeviceId === receivedDeviceId)) {
            
            let power = -1;
            let cadence = -1;

            console.log(`[Training] 파워미터/스마트로라 데이터 수신: deviceId=${receivedDeviceId}, deviceType=0x${deviceType.toString(16)}, pageNum=0x${pageNum.toString(16)}, antData=[${Array.from(antData).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

            // 데이터 페이지 분석 (ANT+ Bike Power Profile)
            if (pageNum === 0x10) { // Standard Power Only Page (시마노 포함 대부분의 파워미터)
                // Byte 3: Instantaneous Cadence
                // Byte 6-7: Instantaneous Power (LSB-MSB)
                if (antData.length > 3) {
                    cadence = antData[3];
                }
                if (antData.length > 7) {
                    power = antData[6] | (antData[7] << 8);
                }
                console.log(`[Training] Page 0x10 파싱: power=${power}, cadence=${cadence}`);
            } else if (pageNum === 0x12) { // Crank Torque Frequency Page
                if (antData.length > 3) {
                    cadence = antData[3];
                }
                console.log(`[Training] Page 0x12 파싱: cadence=${cadence}`);
            } else if (pageNum === 0x13) { // Torque Effectiveness
                if (antData.length > 3) {
                    cadence = antData[3];
                }
                console.log(`[Training] Page 0x13 파싱: cadence=${cadence}`);
            } else if (pageNum === 0x01) { // Calibration Response (일부 스마트로라)
                // 스마트로라의 경우 케이던스가 다른 위치에 있을 수 있음
                if (antData.length > 3 && antData[3] !== 255) {
                    cadence = antData[3];
                }
                // 파워값도 확인 (일부 스마트로라는 여기에 파워값 포함)
                if (antData.length > 7) {
                    const possiblePower = antData[6] | (antData[7] << 8);
                    if (possiblePower > 0 && possiblePower < 2000) {
                        power = possiblePower;
                    }
                }
                console.log(`[Training] Page 0x01 파싱: power=${power}, cadence=${cadence}`);
            } else if (pageNum === 0x19) { // Trainer Data Page (스마트로라 전용)
                // ANT+ Trainer Profile: Trainer Data Page
                // Byte 2-3: Event Count
                // Byte 4-5: Instantaneous Cadence (0.5 rpm units)
                // Byte 6-7: Accumulated Power (LSB-MSB)
                if (antData.length > 5) {
                    const cadenceHalf = antData[4] | (antData[5] << 8);
                    if (cadenceHalf > 0 && cadenceHalf < 500) {
                        cadence = Math.round(cadenceHalf / 2); // 0.5 rpm units
                    }
                }
                if (antData.length > 7) {
                    // Accumulated Power는 누적값이므로 Instantaneous Power를 계산해야 함
                    // 하지만 일부 스마트로라는 여기에 Instantaneous Power를 직접 보냄
                    const possiblePower = antData[6] | (antData[7] << 8);
                    if (possiblePower > 0 && possiblePower < 2000) {
                        power = possiblePower;
                    }
                }
                console.log(`[Training] Page 0x19 (Trainer Data) 파싱: power=${power}, cadence=${cadence}`);
            } else if (pageNum === 0x50 || pageNum === 0x51) { // Manufacturer's Data (스마트로라)
                // 스마트로라의 경우 제조사별 데이터 형식
                if (antData.length > 3 && antData[3] !== 255) {
                    cadence = antData[3];
                }
                if (antData.length > 7) {
                    power = antData[6] | (antData[7] << 8);
                }
                console.log(`[Training] Page 0x${pageNum.toString(16)} 파싱: power=${power}, cadence=${cadence}`);
            } else {
                console.log(`[Training] 알 수 없는 페이지: 0x${pageNum.toString(16)}, 모든 바이트 확인: [${Array.from(antData).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
                // 알 수 없는 페이지라도 Byte 3에 케이던스가 있을 수 있음
                if (antData.length > 3 && antData[3] !== 255 && antData[3] !== 0) {
                    cadence = antData[3];
                    console.log(`[Training] 알 수 없는 페이지에서 케이던스 추출: cadence=${cadence}`);
                }
                // 알 수 없는 페이지에서도 Byte 6-7에 파워값이 있을 수 있음 (스마트로라)
                if (deviceType === 0x11 && antData.length > 7) {
                    const possiblePower = antData[6] | (antData[7] << 8);
                    if (possiblePower > 0 && possiblePower < 2000) {
                        power = possiblePower;
                        console.log(`[Training] 알 수 없는 페이지에서 파워 추출 (스마트로라): power=${power}`);
                    }
                }
            }

            // 유효한 파워 또는 케이던스 데이터가 수신된 경우에만 UI 업데이트
            // 케이던스는 0~254 범위에서 유효 (255는 무효값, 0은 정지 상태)
            const isValidCadence = (cadence !== -1 && cadence !== 255 && cadence >= 0 && cadence <= 254);
            const isValidPower = (power !== -1 && power >= 0);
            
            if (isValidPower || isValidCadence) {
                const finalPower = isValidPower ? power : (pm.currentPower || 0);
                const finalCadence = isValidCadence ? cadence : (pm.cadence || 0);
                
                console.log(`[Training] 파워미터 데이터 업데이트: pm.id=${pm.id}, power=${finalPower}, cadence=${finalCadence}, heartRate=${pm.heartRate}`);
                
                // 전역 상태 업데이트 및 UI 반영
                updatePowerMeterData(pm.id, finalPower, pm.heartRate, finalCadence);
            } else {
                console.log(`[Training] 유효하지 않은 데이터: power=${power}, cadence=${cadence}`);
            }
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
// 1. 데이터 수신 및 통합 라우팅 엔진
/**
 * [통합 ANT+ 데이터 라우터]
 * Indoor Race(속도계)와 Indoor Training(파워/심박) 데이터를 모두 처리합니다.
 */
// 로컬 함수 parseIndoorSensorPayload를 window 객체에 직접 할당
// 이렇게 하면 무한 재귀를 방지할 수 있습니다.
window.parseIndoorSensorPayload = parseIndoorSensorPayload;

/**
 * [초기 로딩 시 바늘 위치 강제 설정]
 * 페이지 로드 직후 모든 바늘을 0(180도) 위치로 보냅니다.
 */
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // 레이스 바늘 초기화 (0~3번 트랙)
        for (let i = 0; i < 4; i++) {
            const needle = document.getElementById(`needle-${i}`);
            if (needle) {
                needle.setAttribute('transform', 'rotate(180, 100, 140)');
                needle.style.visibility = 'visible';
            }
        }
        // 트레이닝 바늘 초기화 (updatePowerMeterNeedle 함수 사용)
        if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
            window.indoorTrainingState.powerMeters.forEach(pm => {
                if (typeof updatePowerMeterNeedle === 'function') {
                    updatePowerMeterNeedle(pm.id, 0);
                }
            });
        }
    }, 1000); // UI 렌더링 대기
});

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
    const powerMeterId = window.currentTargetPowerMeterId;
    if (!powerMeterId) return;
    
    let inputId = '';
    let deviceType = '';
    
    // 리스트 ID에 따라 타겟 입력 필드 결정
    if (listId === 'heartRateDeviceList') {
        inputId = 'heartRateDeviceId';
        deviceType = 'heart';
    } else if (listId === 'powerMeterDeviceList') {
        inputId = 'powerMeterDeviceId';
        deviceType = 'power';
    } else if (listId === 'trainerDeviceList') {
        inputId = 'trainerDeviceId';
        deviceType = 'trainer';
    }

    // 중복 체크
    if (isDeviceAlreadyPaired(deviceId, deviceType, powerMeterId)) {
        const pairedTrack = window.indoorTrainingState.powerMeters.find(pm => {
            if (pm.id === powerMeterId) return false;
            if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === String(deviceId)) return true;
            if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === String(deviceId)) return true;
            if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === String(deviceId)) return true;
            return false;
        });
        
        if (typeof showToast === 'function') {
            showToast(`이 디바이스는 이미 트랙${pairedTrack?.id || '?'}에서 사용 중입니다.`);
        }
        return;
    }

    const inputEl = document.getElementById(inputId);
    if (inputEl) {
        inputEl.value = deviceId;
        inputEl.style.backgroundColor = '#d4edda';
        setTimeout(() => inputEl.style.backgroundColor = '', 500);
        if (typeof showToast === 'function') showToast(`${deviceId} 장치가 선택되었습니다.`);
    }
    
    // 바늘 위치 유지 (다른 코드 실행 후 마지막에 실행되도록 setTimeout 사용)
    setTimeout(() => {
        const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
        if (powerMeter && typeof updatePowerMeterNeedle === 'function') {
            const currentPower = powerMeter.currentPower || 0;
            console.log(`[PowerMeter] selectIndoorDevice: 바늘 위치 유지 시도, powerMeterId=${powerMeterId}, currentPower=${currentPower}`);
            updatePowerMeterNeedle(powerMeterId, currentPower);
        } else {
            console.warn(`[PowerMeter] selectIndoorDevice: 바늘 위치 유지 실패, powerMeter=${!!powerMeter}, updatePowerMeterNeedle=${typeof updatePowerMeterNeedle}`);
        }
    }, 50); // 약간의 지연을 주어 다른 코드가 실행된 후 실행
};

// 4. selectDeviceForInput 함수 (targetType 기반)
window.selectDeviceForInput = function(deviceId, targetType) {
    // targetType을 숫자로 변환 (문자열일 수도 있음)
    const type = typeof targetType === 'string' ? parseInt(targetType, 10) : targetType;
    
    // targetType을 listId로 변환
    let listId = '';
    if (type === 0x78 || type === 120) { // 0x78 = 120 (심박계)
        listId = 'heartRateDeviceList';
    } else if (type === 0x0B || type === 11) { // 0x0B = 11 (파워미터)
        listId = 'powerMeterDeviceList';
    } else if (type === 0x11 || type === 17 || type === 0x10 || type === 16) { // 스마트로라
        listId = 'trainerDeviceList';
    }
    
    // selectIndoorDevice 함수 호출
    if (listId) {
        window.selectIndoorDevice(deviceId, listId);
    } else {
        console.error('[selectDeviceForInput] 알 수 없는 장치 타입:', targetType, '(숫자:', type, ')');
    }
};

/**
 * 워크아웃 선택 모달 열기
 */
async function openWorkoutSelectionModal() {
    const modal = document.getElementById('workoutSelectionModal');
    if (!modal) {
        console.error('[Training] 워크아웃 선택 모달을 찾을 수 없습니다.');
        return;
    }
    
    modal.classList.remove('hidden');
    
    // 워크아웃 목록 로드
    await loadWorkoutsForSelection();
}

/**
 * 워크아웃 선택 모달 닫기
 */
function closeWorkoutSelectionModal() {
    const modal = document.getElementById('workoutSelectionModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * 워크아웃 선택 모달용 워크아웃 목록 로드
 */
async function loadWorkoutsForSelection() {
    const tbody = document.getElementById('workoutSelectionTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">워크아웃 목록을 불러오는 중...</td></tr>';
    
    try {
        // apiGetWorkouts 함수 사용 (workoutManager.js에 있음)
        const result = typeof apiGetWorkouts === 'function' ? await apiGetWorkouts() : null;
        
        if (!result || !result.success) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #dc2626;">워크아웃 목록을 불러올 수 없습니다.</td></tr>';
            return;
        }
        
        const workouts = result.items || [];
        const validWorkouts = workouts.filter(w => {
            // validateWorkoutData 함수가 있으면 사용
            if (typeof validateWorkoutData === 'function') {
                return validateWorkoutData(w);
            }
            return w && w.id && w.title;
        });
        
        if (validWorkouts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">표시할 워크아웃이 없습니다.</td></tr>';
            return;
        }
        
        // 워크아웃 목록 렌더링
        tbody.innerHTML = validWorkouts.map((workout, index) => {
            // 카테고리 항목 사용 (category 필드가 있으면 사용, 없으면 author 사용)
            const category = workout.category || workout.author || '-';
            
            // 시간은 세그먼트 총합으로 계산
            let duration = '-';
            if (workout.total_seconds) {
                const minutes = Math.floor(workout.total_seconds / 60);
                duration = `${minutes}분`;
            }
            
            return `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="text-align: center; padding: 12px;">${index + 1}</td>
                    <td style="padding: 12px;">${escapeHtml(workout.title || '-')}</td>
                    <td style="text-align: center; padding: 12px;">${escapeHtml(category)}</td>
                    <td style="text-align: center; padding: 12px;">${duration}</td>
                    <td style="text-align: center; padding: 12px;">
                        <button class="btn btn-primary btn-sm" onclick="selectWorkoutForTraining('${workout.id}')" style="padding: 6px 16px;">선택</button>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('[Training] 워크아웃 목록 로드 오류:', error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #dc2626;">오류가 발생했습니다.</td></tr>';
    }
}

/**
 * HTML 이스케이프 함수
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 워크아웃 선택 처리
 */
async function selectWorkoutForTraining(workoutId) {
    try {
        console.log('[Training] 워크아웃 선택 시도:', workoutId);
        
        // apiGetWorkout 함수 확인
        if (typeof apiGetWorkout !== 'function') {
            console.error('[Training] apiGetWorkout 함수를 찾을 수 없습니다.');
            if (typeof showToast === 'function') {
                showToast('워크아웃 정보를 불러올 수 없습니다. (apiGetWorkout 함수 없음)', 'error');
            }
            return;
        }
        
        // 워크아웃 상세 정보 로드
        const workoutResult = await apiGetWorkout(workoutId);
        
        console.log('[Training] 워크아웃 로드 결과:', workoutResult);
        
        if (!workoutResult) {
            console.error('[Training] workoutResult가 null입니다.');
            if (typeof showToast === 'function') {
                showToast('워크아웃 정보를 불러올 수 없습니다. (응답 없음)', 'error');
            }
            return;
        }
        
        if (!workoutResult.success) {
            console.error('[Training] 워크아웃 로드 실패:', workoutResult.error);
            if (typeof showToast === 'function') {
                showToast(`워크아웃 정보를 불러올 수 없습니다: ${workoutResult.error || '알 수 없는 오류'}`, 'error');
            }
            return;
        }
        
        // Code.gs의 getWorkout은 'item' 필드로 반환함
        const workout = workoutResult.workout || workoutResult.item;
        
        if (!workout) {
            console.error('[Training] workout 데이터가 없습니다. workoutResult:', workoutResult);
            if (typeof showToast === 'function') {
                showToast('워크아웃 정보를 불러올 수 없습니다. (데이터 없음)', 'error');
            }
            return;
        }
        
        console.log('[Training] 선택된 워크아웃:', {
            id: workout.id,
            title: workout.title,
            segmentsCount: workout.segments ? workout.segments.length : 0
        });
        
        // 선택된 워크아웃 저장
        window.indoorTrainingState.currentWorkout = workout;
        
        // 모달 닫기
        closeWorkoutSelectionModal();
        
        // 전광판 우측에 세그먼트 그래프 표시
        displayWorkoutSegmentGraph(workout);
        
        if (typeof showToast === 'function') {
            showToast(`"${workout.title || '워크아웃'}" 워크아웃이 선택되었습니다.`, 'success');
        }
        
    } catch (error) {
        console.error('[Training] 워크아웃 선택 오류:', error, error.stack);
        if (typeof showToast === 'function') {
            showToast(`워크아웃 선택 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, 'error');
        }
    }
}

/**
 * 전광판 우측에 워크아웃 세그먼트 그래프 표시
 */
function displayWorkoutSegmentGraph(workout) {
    const container = document.getElementById('selectedWorkoutSegmentGraphContainer');
    if (!container) return;
    
    // 세그먼트가 있는 경우에만 표시
    if (!workout.segments || workout.segments.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    // 세그먼트 그래프 그리기 (전광판 크기에 맞춤)
    setTimeout(() => {
        const canvas = document.getElementById('selectedWorkoutSegmentGraphCanvas');
        if (!canvas) return;
        
        // 전광판 컨테이너 크기 확인
        const scoreboardContainer = container.closest('.scoreboard-display');
        if (!scoreboardContainer) return;
        
        const containerRect = container.getBoundingClientRect();
        const maxWidth = containerRect.width || 300; // 기본값 300px
        const maxHeight = containerRect.height || 120; // 기본값 120px (scoreboard-segment-graph-container의 min-height)
        
        // 세그먼트 그래프를 전광판 크기에 맞춰 그리기
        if (typeof drawSegmentGraphForScoreboard === 'function') {
            drawSegmentGraphForScoreboard(workout.segments, -1, 'selectedWorkoutSegmentGraphCanvas', maxWidth, maxHeight);
        } else if (typeof drawSegmentGraph === 'function') {
            // 기본 drawSegmentGraph 함수 사용하되, canvas 크기를 제한
            drawSegmentGraph(workout.segments, -1, 'selectedWorkoutSegmentGraphCanvas');
            
            // Canvas 크기를 전광판에 맞게 조정
            canvas.style.maxWidth = `${maxWidth}px`;
            canvas.style.maxHeight = `${maxHeight}px`;
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
        } else {
            console.warn('[Training] drawSegmentGraph 함수를 찾을 수 없습니다.');
        }
    }, 100);
}

/**
 * 전광판용 세그먼트 그래프 그리기 (크기 제한 적용)
 */
function drawSegmentGraphForScoreboard(segments, currentSegmentIndex = -1, canvasId = 'selectedWorkoutSegmentGraphCanvas', maxWidth = 300, maxHeight = 120) {
    if (!segments || segments.length === 0) return;
    
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    // 사용자 FTP 가져오기
    const ftp = Number(window.currentUser?.ftp) || 200;
    
    // 총 시간 계산
    const totalSeconds = segments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
    if (totalSeconds <= 0) return;
    
    // 그래프 크기 설정 (전광판 크기에 맞춤)
    const padding = { top: 10, right: 15, bottom: 25, left: 35 };
    const availableWidth = maxWidth - padding.left - padding.right;
    const availableHeight = maxHeight - padding.top - padding.bottom;
    
    const graphWidth = Math.max(availableWidth, 200); // 최소 200px
    const graphHeight = Math.max(availableHeight, 80); // 최소 80px
    const chartWidth = graphWidth - padding.left - padding.right;
    const chartHeight = graphHeight - padding.top - padding.bottom;
    
    // Canvas 크기 설정
    canvas.width = graphWidth;
    canvas.height = graphHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = `${maxWidth}px`;
    canvas.style.maxHeight = `${maxHeight}px`;
    
    const ctx = canvas.getContext('2d');
    
    // 배경 투명하게
    ctx.clearRect(0, 0, graphWidth, graphHeight);
    
    // 축 그리기 (전광판용 밝은 색상)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    
    // 세로축 (파워)
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.stroke();
    
    // 가로축 (시간)
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y축 FTP % 값 표기 (0%, 50%, FTP(100%), 150%, 200%)
    const yAxisLabels = [
        { value: 0, label: '0%' },
        { value: 50, label: '50%' },
        { value: 100, label: 'FTP' },
        { value: 150, label: '150%' },
        { value: 200, label: '200%' }
    ];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    yAxisLabels.forEach(({ value: ftpPercent, label }) => {
        // FTP %에 따른 Y 위치 계산 (200%를 최대값으로)
        const maxFtpPercent = 200;
        const yRatio = ftpPercent / maxFtpPercent;
        const y = padding.top + chartHeight - (yRatio * chartHeight);
        
        // 라벨 위치 (축 왼쪽)
        ctx.fillText(label, padding.left - 8, y);
        
        // FTP(100%) 라인에 주황색 작은 점선 가이드 라인 표기
        if (ftpPercent === 100) {
            ctx.strokeStyle = 'rgba(255, 165, 0, 0.6)'; // 주황색
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]); // 더 작은 점선 (2px 점, 3px 간격)
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
            ctx.setLineDash([]); // 점선 해제
        }
        // 50% 라인에 얇은 흰색 실선 가이드 라인 표기
        else if (ftpPercent === 50) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; // 흰색
            ctx.lineWidth = 0.5;
            ctx.setLineDash([]); // 실선
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }
        
        // 눈금선 (선택적)
        if (ftpPercent > 0 && ftpPercent < maxFtpPercent) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(padding.left - 3, y);
            ctx.lineTo(padding.left, y);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 원래 색상 복원
        }
    });
    
    // 세그먼트 그리기
    let currentTime = 0;
    segments.forEach((seg, index) => {
        const segDuration = seg.duration_sec || 0;
        if (segDuration <= 0) return;
        
        const segWidth = (segDuration / totalSeconds) * chartWidth;
        const x = padding.left + (currentTime / totalSeconds) * chartWidth;
        
        // 세그먼트 FTP 비율 계산 (간단 버전)
        let ftpPercent = 100;
        if (seg.target_type === 'ftp_pct') {
            ftpPercent = Number(seg.target_value) || 100;
        } else if (seg.target_type === 'dual') {
            const targetValue = String(seg.target_value || '100');
            const parts = targetValue.split('/');
            if (parts.length > 0) {
                const ftpPart = parts[0].trim().replace('%', '');
                ftpPercent = Number(ftpPart) || 100;
            }
        }
        
        // 파워 높이 계산 (FTP의 2배를 최대값으로)
        const maxPower = ftp * 2;
        const targetPower = (ftp * ftpPercent) / 100;
        const powerHeight = (targetPower / maxPower) * chartHeight;
        const y = padding.top + chartHeight - powerHeight;
        
        // 현재 세그먼트인지 확인
        const isCurrent = index === currentSegmentIndex;
        
        // 세그먼트 타입에 따른 색상 결정
        const segmentType = seg.segment_type || 'interval';
        let segmentColor;
        let segmentStrokeColor;
        
        // 휴식: 흰색
        if (segmentType === 'rest') {
            segmentColor = 'rgba(255, 255, 255, 0.6)';
            segmentStrokeColor = 'rgba(255, 255, 255, 0.8)';
        }
        // 100% 이상: 빨강
        else if (ftpPercent >= 100) {
            segmentColor = isCurrent ? 'rgba(255, 0, 0, 0.8)' : 'rgba(255, 0, 0, 0.5)';
            segmentStrokeColor = 'rgba(255, 0, 0, 1)';
        }
        // 80% 이상 ~ 100% 미만: 주황
        else if (ftpPercent >= 80) {
            segmentColor = isCurrent ? 'rgba(255, 165, 0, 0.8)' : 'rgba(255, 165, 0, 0.5)';
            segmentStrokeColor = 'rgba(255, 165, 0, 1)';
        }
        // 워밍업, 쿨다운 등: 민트색 (현재 적용된 색)
        else {
            segmentColor = isCurrent ? 'rgba(0, 212, 170, 0.8)' : 'rgba(0, 212, 170, 0.4)';
            segmentStrokeColor = isCurrent ? 'rgba(0, 212, 170, 1)' : 'rgba(255, 255, 255, 0.3)';
        }
        
        // 세그먼트 사각형 그리기
        ctx.fillStyle = segmentColor;
        ctx.fillRect(x, y, segWidth, powerHeight);
        
        // 세그먼트 경계선
        ctx.strokeStyle = segmentStrokeColor;
        ctx.lineWidth = isCurrent ? 2 : 1;
        ctx.strokeRect(x, y, segWidth, powerHeight);
        
        currentTime += segDuration;
    });
    
    // X축 라벨: 워크아웃 운동시간 (단위:분)
    const totalMinutes = Math.round(totalSeconds / 60);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '12.6px sans-serif'; // 18px의 70% (12.6px)
    ctx.textAlign = 'center';
    ctx.fillText(`${totalMinutes}분`, padding.left + chartWidth / 2, graphHeight - 5);
}







