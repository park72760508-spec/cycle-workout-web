/**
 * Bluetooth Training Coach 대시보드
 * Firebase Realtime Database에서 사용자들의 훈련 데이터를 수신하여 모니터에 표시
 * Indoor Training 화면 디자인과 구성을 카피하되, ANT+ 관련 기능 제거
 */

// 전역 상태 (Indoor Training과 유사하지만 ANT+ 관련 제거)
window.bluetoothCoachState = {
  powerMeters: [], // 파워계 목록 (트랙 목록)
  trainingState: 'idle', // idle, running, paused, finished
  startTime: null,
  pausedTime: 0,
  totalElapsedTime: 0,
  currentWorkout: null, // 선택된 워크아웃
  currentSegmentIndex: 0,
  segmentStartTime: null,
  segmentElapsedTime: 0,
  needleAngles: {}, // 바늘 각도 저장용
  resizeHandler: null, // 리사이즈 이벤트 핸들러
  scoreboardResizeObserver: null, // 전광판 컨테이너 ResizeObserver
  segmentCountdownActive: false, // 세그먼트 카운트다운 활성화 여부
  firebaseSubscriptions: {}, // Firebase 구독 참조 저장
  maxTrackCount: 10 // 기본 최대 트랙 수
};

// 파워계 데이터 구조 (Indoor Training과 동일)
// PowerMeterData 클래스가 이미 정의되어 있으면 재사용, 없으면 새로 정의
if (typeof PowerMeterData === 'undefined') {
  class PowerMeterData {
    constructor(id, name, deviceId = null) {
      this.id = id;
      this.name = name;
      this.deviceId = deviceId;
      this.pairingName = null;
      this.connected = false;
      this.currentPower = 0; // W
      this.maxPower = 0; // W
      this.averagePower = 0; // W
      this.segmentPower = 0; // W (현재 세그먼트 평균 파워)
      this.heartRate = 0; // BPM
      this.cadence = 0; // RPM
      this.totalDistance = 0;
      this.lastUpdateTime = null;
      this.powerHistory = [];
      this.powerSum = 0;
      this.powerCount = 0;
      this.segmentPowerSum = 0;
      this.segmentPowerCount = 0;
      this.userId = null;
      this.userFTP = null;
      this.userName = null;
      this.userWeight = null;
      this.targetPower = 0;
      this.displayPower = 0;
      this.powerTrailHistory = [];
      this.lastTrailAngle = null;
      this.powerAverageBuffer = []; // 3초 평균 파워 계산용
    }
    
    /**
     * 3초 평균 파워값 계산
     * @returns {number} 3초 평균 파워값 (W)
     */
    get3SecondAveragePower() {
      const now = Date.now();
      const threeSecondsAgo = now - 3000;
      this.powerAverageBuffer = this.powerAverageBuffer.filter(item => item.timestamp >= threeSecondsAgo);
      const currentPower = this.currentPower || 0;
      if (currentPower >= 0) {
        this.powerAverageBuffer.push({ timestamp: now, power: currentPower });
      }
      this.powerAverageBuffer = this.powerAverageBuffer.filter(item => item.timestamp >= threeSecondsAgo);
      if (this.powerAverageBuffer.length === 0) {
        return currentPower;
      }
      const sum = this.powerAverageBuffer.reduce((acc, item) => acc + item.power, 0);
      return Math.round(sum / this.powerAverageBuffer.length);
    }
  }
  
  // 전역으로 노출
  window.PowerMeterData = PowerMeterData;
} else {
  // 이미 정의되어 있으면 로그만 출력
  console.log('[Bluetooth Coach] PowerMeterData 클래스를 재사용합니다.');
}

/**
 * SESSION_ID 가져오기 (Training Room ID)
 */
function getBluetoothCoachSessionId() {
  if (typeof window !== 'undefined' && window.SESSION_ID) {
    return window.SESSION_ID;
  }
  if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
    const roomId = String(window.currentTrainingRoomId);
    window.SESSION_ID = roomId;
    return roomId;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const storedRoomId = localStorage.getItem('currentTrainingRoomId');
      if (storedRoomId) {
        window.SESSION_ID = storedRoomId;
        return storedRoomId;
      }
    } catch (e) {
      console.warn('[Bluetooth Coach] localStorage 접근 실패:', e);
    }
  }
  if (typeof SESSION_ID !== 'undefined') {
    return SESSION_ID;
  }
  return 'session_room_1';
}

/**
 * Firebase에서 트랙 구성 정보 가져오기
 * sessions/{roomId}/trackConfig 에서 최대 트랙 수 가져오기
 */
async function getTrackConfigFromFirebase() {
  const sessionId = getBluetoothCoachSessionId();
  if (!sessionId || typeof db === 'undefined') {
    return { maxTracks: 10 }; // 기본값
  }
  
  try {
    const snapshot = await db.ref(`sessions/${sessionId}/trackConfig`).once('value');
    const config = snapshot.val();
    if (config && typeof config.maxTracks === 'number' && config.maxTracks > 0) {
      return { maxTracks: config.maxTracks };
    }
  } catch (error) {
    console.error('[Bluetooth Coach] 트랙 구성 정보 가져오기 실패:', error);
  }
  
  // Firebase users 데이터에서 실제 사용 중인 트랙 수 확인
  try {
    const usersSnapshot = await db.ref(`sessions/${sessionId}/users`).once('value');
    const users = usersSnapshot.val();
    if (users) {
      const trackNumbers = Object.keys(users).map(key => parseInt(key)).filter(num => !isNaN(num) && num > 0);
      if (trackNumbers.length > 0) {
        const maxTrack = Math.max(...trackNumbers);
        return { maxTracks: Math.max(10, maxTrack) }; // 최소 10개
      }
    }
  } catch (error) {
    console.error('[Bluetooth Coach] 사용자 데이터 확인 실패:', error);
  }
  
  return { maxTracks: 10 }; // 기본값
}

/**
 * Bluetooth Training Coach 대시보드 초기화
 */
window.initBluetoothCoachDashboard = function initBluetoothCoachDashboard() {
  console.log('[Bluetooth Coach] 대시보드 초기화');
  
  const sessionId = getBluetoothCoachSessionId();
  console.log('[Bluetooth Coach] 현재 SESSION_ID:', sessionId);
  
  // 트랙 구성 정보 가져오기 및 트랙 그리드 생성
  getTrackConfigFromFirebase().then(config => {
    window.bluetoothCoachState.maxTrackCount = config.maxTracks;
    createPowerMeterGrid();
    
    // Firebase 구독 시작
    setupFirebaseSubscriptions();
  });
  
  // 워크아웃 선택 모달 재사용 (Indoor Training과 동일)
  if (typeof openWorkoutSelectionModal === 'function') {
    window.openWorkoutSelectionModalForBluetoothCoach = openWorkoutSelectionModal;
  }
  
  // 컨트롤 버튼 이벤트 연결
  setupControlButtons();
};

/**
 * 파워계 그리드 생성 (트랙 동적 생성)
 */
function createPowerMeterGrid() {
  const gridEl = document.getElementById('bluetoothCoachPowerMeterGrid');
  if (!gridEl) return;
  
  gridEl.innerHTML = '';
  window.bluetoothCoachState.powerMeters = []; // 초기화
  
  const maxTracks = window.bluetoothCoachState.maxTrackCount || 10;
  
  // 트랙 생성 (기본 10개, Firebase에서 가져온 값이 있으면 그 값 사용)
  for (let i = 1; i <= maxTracks; i++) {
    const powerMeter = new PowerMeterData(i, `트랙${i}`);
    window.bluetoothCoachState.powerMeters.push(powerMeter);
    
    const element = createPowerMeterElement(powerMeter);
    gridEl.appendChild(element);
  }
  
  // 눈금 초기화
  initializeNeedles();
  
  // 애니메이션 루프 시작
  startGaugeAnimationLoop();
  
  console.log(`[Bluetooth Coach] ${maxTracks}개 트랙 생성 완료`);
}

/**
 * 파워계 요소 생성 (Indoor Training 카피, 클릭 이벤트 제거)
 */
function createPowerMeterElement(powerMeter) {
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `power-meter-${powerMeter.id}`;
  container.dataset.powerMeterId = powerMeter.id;
  
  // 트랙 버튼은 표시만 하고 클릭 이벤트는 없음 (Coach 모니터는 읽기 전용)
  const trackButtonStyle = 'background: rgba(0, 212, 170, 0.5) !important; color: #ffffff !important; cursor: default !important;';
  
  container.innerHTML = `
    <div class="speedometer-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; position: relative !important;">
      <div style="display: flex !important; flex-direction: column !important; align-items: flex-start !important; flex: 0 0 auto !important; min-width: 100px !important; order: 1 !important;">
        <div style="display: ${powerMeter.userName ? 'flex' : 'none'} !important; align-items: center !important; flex-wrap: wrap !important;">
          <span class="speedometer-user-name" id="user-name-${powerMeter.id}" 
                style="font-size: 13px !important; color: #000000 !important; font-weight: 600 !important; text-align: left !important; margin-bottom: 2px !important; background: rgba(0, 212, 170, 0.8) !important; padding: 4px 10px !important; border-radius: 6px !important; cursor: default !important; transition: all 0.2s ease !important;">${powerMeter.userName || ''}</span>
        </div>
      </div>
      <span class="speedometer-name" style="position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; font-weight: 600 !important; text-align: center !important; order: 2 !important; z-index: 1 !important; ${trackButtonStyle} padding: 6px 12px !important; border-radius: 8px !important; display: inline-block !important;">트랙${powerMeter.id}</span>
      <div class="connection-status-center" id="status-${powerMeter.id}" style="position: static !important; left: auto !important; transform: none !important; flex: 0 0 auto !important; text-align: right !important; margin-left: auto !important; order: 3 !important; justify-content: flex-end !important; align-items: center !important; gap: 6px !important;">
        <span id="device-icons-${powerMeter.id}" style="display: none !important; align-items: center !important; gap: 4px !important;"></span>
        <span class="status-dot disconnected" id="status-dot-${powerMeter.id}" style="display: none !important;"></span>
        <span class="status-text" id="status-text-${powerMeter.id}">미연결</span>
      </div>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 200">
        <path class="speedometer-arc-bg" d="M 20 140 A 80 80 0 0 1 180 140" 
              fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5"/>
        
        <g class="speedometer-ticks">
          ${generatePowerMeterTicks(powerMeter.id)}
        </g>
        
        <g class="speedometer-labels">
          ${generatePowerMeterLabels(powerMeter.id)}
        </g>
        
        <text x="100" y="100" 
              id="target-power-value-${powerMeter.id}"
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ff8c00" 
              font-size="20" 
              font-weight="700"></text>

        <circle cx="100" cy="140" r="7" fill="#000000" stroke="#ff0000" stroke-width="2"/>
        
        <g id="needle-path-${powerMeter.id}" class="speedometer-needle-path" transform="translate(100, 140)">
        </g>
        
        <g class="speedometer-needle" transform="translate(100, 140)">
          <line id="needle-${powerMeter.id}" 
                x1="0" y1="-7" 
                x2="0" y2="-80" 
                stroke="#ff0000" 
                stroke-width="3" 
                stroke-linecap="round"
                transform="rotate(270)"/>
        </g>
        
        <text x="100" y="188" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="43.2" 
              font-weight="700"
              id="current-power-value-${powerMeter.id}">-</text>
        
        <text x="100" y="157" 
              text-anchor="middle" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="10" 
              font-weight="500">W</text>
        
      </svg>
    </div>
    <div class="speedometer-info disconnected">
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
      <div class="speed-display-center">
        <div class="speed-value-wrapper">
          <span class="speed-value" id="segment-power-value-${powerMeter.id}">0</span>
          <div class="speed-unit-bottom">랩파워[W]</div>
        </div>
      </div>
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
 * 파워계 눈금 생성 (Indoor Training과 동일)
 */
function generatePowerMeterTicks(powerMeterId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return '';
  
  let ticks = '';
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const maxPos = 120;
  
  for (let pos = 0; pos <= maxPos; pos += 5) {
    let angle = 180 - (pos / maxPos) * 180;
    angle = angle + 180;
    
    const rad = (angle * Math.PI) / 180;
    const innerRadius = radius - 10;
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    
    const isMajor = pos % 20 === 0;
    const tickLength = isMajor ? 14 : 7;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                    stroke="#ffffff" 
                    stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
  }
  
  return ticks;
}

/**
 * 파워계 라벨 생성 (Indoor Training과 동일)
 */
function generatePowerMeterLabels(powerMeterId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return '';
  
  let labels = '';
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const maxPos = 120;
  
  const ftp = powerMeter.userFTP || null;
  const useFTPValue = !!ftp;
  const majorPositions = [0, 20, 40, 60, 80, 100, 120];
  
  majorPositions.forEach(pos => {
    let angle = 180 - (pos / maxPos) * 180;
    angle = angle + 180;
    
    const rad = (angle * Math.PI) / 180;
    const labelRadius = radius + 18;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    
    let displayValue;
    let isOneFTP = false;
    
    if (useFTPValue) {
      let multiplier;
      if (pos === 120) multiplier = 0;
      else if (pos === 100) multiplier = 0.33;
      else if (pos === 80) multiplier = 0.67;
      else if (pos === 60) { multiplier = 1; isOneFTP = true; }
      else if (pos === 40) multiplier = 1.33;
      else if (pos === 20) multiplier = 1.67;
      else if (pos === 0) multiplier = 2;
      else multiplier = 1;
      
      displayValue = Math.round(ftp * multiplier).toString();
      const textColor = isOneFTP ? '#ef4444' : '#ffffff';
      labels += `<text x="${x}" y="${y}" 
                     text-anchor="middle" 
                     dominant-baseline="middle"
                     fill="${textColor}" 
                     font-size="15" 
                     font-weight="700">${displayValue}</text>`;
      return;
    } else {
      const percent = (120 - pos) / 120 * 200;
      const value = percent / 100;
      if (Math.abs(value - Math.round(value)) < 0.01) {
        displayValue = Math.round(value).toString();
      } else {
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
 * 파워계 바늘 초기화
 */
function initializeNeedles() {
  window.bluetoothCoachState.powerMeters.forEach(pm => {
    updatePowerMeterNeedle(pm.id, 0);
  });
}

/**
 * 파워계 바늘 업데이트
 */
function updatePowerMeterNeedle(powerMeterId, power) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === powerMeterId);
  if (!powerMeter) return;
  
  const textEl = document.getElementById(`current-power-value-${powerMeterId}`);
  if (textEl) {
    textEl.textContent = Math.round(power);
  }
  
  powerMeter.previousPower = power;
}

/**
 * 게이지 애니메이션 루프 (Indoor Training과 동일)
 */
function startGaugeAnimationLoop() {
  const loop = () => {
    if (!window.bluetoothCoachState || !window.bluetoothCoachState.powerMeters) {
      requestAnimationFrame(loop);
      return;
    }

    window.bluetoothCoachState.powerMeters.forEach(pm => {
      if (!pm.connected) return;

      const target = pm.currentPower || 0;
      const current = pm.displayPower || 0;
      const diff = target - current;

      if (Math.abs(diff) > 0.1) {
        pm.displayPower = current + diff * 0.15;
      } else {
        pm.displayPower = target;
      }

      const ftp = pm.userFTP || 200;
      const maxPower = ftp * 2;
      let ratio = Math.min(Math.max(pm.displayPower / maxPower, 0), 1);
      const angle = -90 + (ratio * 180);

      const needleEl = document.getElementById(`needle-${pm.id}`);
      if (needleEl) {
        needleEl.style.transition = 'none';
        needleEl.setAttribute('transform', `rotate(${angle})`);
      }
    });

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Firebase Realtime Database 구독 설정
 * sessions/{sessionId}/users/{trackId} 경로를 구독하여 실시간 데이터 수신
 */
function setupFirebaseSubscriptions() {
  const sessionId = getBluetoothCoachSessionId();
  if (!sessionId || typeof db === 'undefined') {
    console.warn('[Bluetooth Coach] Firebase가 초기화되지 않았습니다.');
    return;
  }
  
  // 기존 구독 해제
  Object.values(window.bluetoothCoachState.firebaseSubscriptions).forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
  window.bluetoothCoachState.firebaseSubscriptions = {};
  
  // 각 트랙에 대한 구독 설정
  window.bluetoothCoachState.powerMeters.forEach(pm => {
    const trackId = pm.id;
    const userRef = db.ref(`sessions/${sessionId}/users/${trackId}`);
    
    // 사용자 데이터 구독
    const unsubscribe = userRef.on('value', (snapshot) => {
      const userData = snapshot.val();
      if (userData) {
        updatePowerMeterDataFromFirebase(trackId, userData);
      } else {
        // 데이터가 없으면 초기화
        resetPowerMeterData(trackId);
      }
    });
    
    window.bluetoothCoachState.firebaseSubscriptions[`user_${trackId}`] = unsubscribe;
  });
  
  // 워크아웃 상태 구독 (Indoor Training과 동일한 방식)
  const statusRef = db.ref(`sessions/${sessionId}/status`);
  const statusUnsubscribe = statusRef.on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
      updateTrainingStatus(status);
    }
  });
  window.bluetoothCoachState.firebaseSubscriptions['status'] = statusUnsubscribe;
  
  // 워크아웃 플랜 구독
  const workoutPlanRef = db.ref(`sessions/${sessionId}/workoutPlan`);
  const workoutPlanUnsubscribe = workoutPlanRef.on('value', (snapshot) => {
    const workoutPlan = snapshot.val();
    if (workoutPlan) {
      window.bluetoothCoachState.currentWorkout = workoutPlan;
      updateWorkoutSegmentGraph();
    }
  });
  window.bluetoothCoachState.firebaseSubscriptions['workoutPlan'] = workoutPlanUnsubscribe;
  
  console.log('[Bluetooth Coach] Firebase 구독 설정 완료');
}

/**
 * Firebase 데이터로 파워계 업데이트
 */
function updatePowerMeterDataFromFirebase(trackId, userData) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === trackId);
  if (!powerMeter) return;
  
  // 사용자 정보 업데이트
  if (userData.userId) powerMeter.userId = userData.userId;
  if (userData.userName) {
    powerMeter.userName = userData.userName;
    const userNameEl = document.getElementById(`user-name-${trackId}`);
    if (userNameEl) {
      userNameEl.textContent = userData.userName;
      userNameEl.parentElement.style.display = 'flex';
    }
  }
  if (userData.ftp) powerMeter.userFTP = userData.ftp;
  if (userData.weight) powerMeter.userWeight = userData.weight;
  
  // 훈련 데이터 업데이트
  const power = userData.power || 0;
  const heartRate = userData.hr || 0;
  const cadence = userData.cadence || 0;
  const avgPower = userData.avgPower || 0;
  const maxPower = userData.maxPower || 0;
  const segmentPower = userData.segmentPower || 0;
  const targetPower = userData.targetPower || 0;
  
  // 파워계 데이터 업데이트
  powerMeter.currentPower = power;
  powerMeter.heartRate = heartRate;
  powerMeter.cadence = cadence;
  powerMeter.averagePower = avgPower;
  powerMeter.maxPower = maxPower;
  powerMeter.segmentPower = segmentPower;
  powerMeter.targetPower = targetPower;
  powerMeter.lastUpdateTime = userData.lastUpdate || Date.now();
  
  // 연결 상태 업데이트
  powerMeter.connected = (power > 0 || heartRate > 0 || cadence > 0);
  
  // UI 업데이트
  updatePowerMeterUI(trackId);
  
  // FTP 변경 시 눈금 업데이트
  if (userData.ftp && userData.ftp !== powerMeter.userFTP) {
    updatePowerMeterTicks(trackId);
  }
}

/**
 * 파워계 UI 업데이트
 */
function updatePowerMeterUI(trackId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === trackId);
  if (!powerMeter) return;
  
  // 현재 파워값 (3초 평균)
  const currentPowerEl = document.getElementById(`current-power-value-${trackId}`);
  if (currentPowerEl) {
    const avgPower = powerMeter.get3SecondAveragePower ? powerMeter.get3SecondAveragePower() : powerMeter.currentPower;
    currentPowerEl.textContent = Math.round(avgPower);
  }
  
  // 최대 파워
  const maxPowerEl = document.getElementById(`max-power-value-${trackId}`);
  if (maxPowerEl) maxPowerEl.textContent = Math.round(powerMeter.maxPower);
  
  // 평균 파워
  const avgPowerEl = document.getElementById(`avg-power-value-${trackId}`);
  if (avgPowerEl) avgPowerEl.textContent = Math.round(powerMeter.averagePower);
  
  // 세그먼트 파워
  const segPowerEl = document.getElementById(`segment-power-value-${trackId}`);
  if (segPowerEl) {
    segPowerEl.textContent = Math.round(powerMeter.segmentPower);
    segPowerEl.style.color = '#000000';
  }
  
  // 심박수
  const heartRateEl = document.getElementById(`heart-rate-value-${trackId}`);
  if (heartRateEl) {
    if (powerMeter.heartRate > 0) {
      heartRateEl.textContent = Math.round(powerMeter.heartRate);
      heartRateEl.style.color = '#006400';
    } else {
      heartRateEl.textContent = '0';
      heartRateEl.style.color = '';
    }
  }
  
  // 케이던스
  const cadenceEl = document.getElementById(`cadence-value-${trackId}`);
  if (cadenceEl) {
    const cadenceValue = (typeof powerMeter.cadence === 'number' && powerMeter.cadence >= 0 && powerMeter.cadence <= 254) ? Math.round(powerMeter.cadence) : 0;
    cadenceEl.textContent = cadenceValue.toString();
  }
  
  // 목표 파워
  const targetPowerEl = document.getElementById(`target-power-value-${trackId}`);
  if (targetPowerEl && powerMeter.targetPower > 0) {
    targetPowerEl.textContent = Math.round(powerMeter.targetPower);
  }
  
  // 배경색 업데이트 (데이터 수신 여부에 따라)
  const infoEl = document.querySelector(`#power-meter-${trackId} .speedometer-info`);
  if (infoEl) {
    if (powerMeter.connected) {
      infoEl.style.backgroundColor = '#90EE90';
      infoEl.classList.remove('disconnected');
      infoEl.classList.add('connected');
    } else {
      infoEl.style.backgroundColor = '#FFA500';
      infoEl.classList.remove('connected');
      infoEl.classList.add('disconnected');
    }
  }
  
  // 연결 상태 텍스트 업데이트
  const statusTextEl = document.getElementById(`status-text-${trackId}`);
  if (statusTextEl) {
    statusTextEl.textContent = powerMeter.connected ? '연결됨' : '미연결';
  }
}

/**
 * 파워계 데이터 초기화 (데이터가 없을 때)
 */
function resetPowerMeterData(trackId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === trackId);
  if (!powerMeter) return;
  
  powerMeter.currentPower = 0;
  powerMeter.heartRate = 0;
  powerMeter.cadence = 0;
  powerMeter.connected = false;
  powerMeter.userId = null;
  powerMeter.userName = null;
  powerMeter.userFTP = null;
  
  // UI 초기화
  const userNameEl = document.getElementById(`user-name-${trackId}`);
  if (userNameEl) {
    userNameEl.parentElement.style.display = 'none';
  }
  
  updatePowerMeterUI(trackId);
}

/**
 * 파워계 눈금 업데이트 (FTP 변경 시)
 */
function updatePowerMeterTicks(powerMeterId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const ticksEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-ticks`);
  const labelsEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-labels`);
  
  if (!ticksEl || !labelsEl) return;
  
  ticksEl.innerHTML = generatePowerMeterTicks(powerMeterId);
  labelsEl.innerHTML = generatePowerMeterLabels(powerMeterId);
  
  // 바늘 위치 복원
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  if (needleEl && typeof updatePowerMeterNeedle === 'function') {
    updatePowerMeterNeedle(powerMeterId, powerMeter.currentPower || 0);
  }
}

/**
 * 훈련 상태 업데이트 (Firebase status 구독)
 */
function updateTrainingStatus(status) {
  window.bluetoothCoachState.trainingState = status.state || 'idle';
  window.bluetoothCoachState.currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : 0;
  
  // 경과시간 업데이트
  if (status.elapsedTime !== undefined) {
    window.bluetoothCoachState.totalElapsedTime = status.elapsedTime || 0;
    updateScoreboard();
  }
  
  // 랩카운트다운 업데이트
  if (status.lapCountdown !== undefined) {
    const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (countdownEl) {
      const minutes = Math.floor(status.lapCountdown / 60);
      const seconds = Math.floor(status.lapCountdown % 60);
      countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }
}

/**
 * 전광판 업데이트
 */
function updateScoreboard() {
  const elapsedEl = document.getElementById('bluetoothCoachElapsedTime');
  if (elapsedEl) {
    const elapsed = Math.max(0, window.bluetoothCoachState.totalElapsedTime || 0);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = Math.floor(elapsed % 60);
    elapsedEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

/**
 * 워크아웃 세그먼트 그래프 업데이트
 */
function updateWorkoutSegmentGraph() {
  // Indoor Training의 세그먼트 그래프 업데이트 로직 재사용
  if (typeof displayWorkoutSegmentGraph === 'function') {
    displayWorkoutSegmentGraph(
      window.bluetoothCoachState.currentWorkout,
      window.bluetoothCoachState.currentSegmentIndex,
      'bluetoothCoachSegmentGraphCanvas',
      'bluetoothCoachSegmentGraphContainer'
    );
  }
}

/**
 * 컨트롤 버튼 이벤트 설정
 */
function setupControlButtons() {
  // 워크아웃 선택 버튼은 이미 HTML에서 onclick으로 연결됨
  
  // 건너뛰기 버튼
  const skipBtn = document.getElementById('btnSkipSegmentBluetoothCoach');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      // Indoor Training의 skipSegment 함수 재사용
      if (typeof skipCurrentSegmentTraining === 'function') {
        skipCurrentSegmentTraining();
      }
    });
  }
  
  // 일시정지/재생 버튼
  const togglePauseBtn = document.getElementById('btnTogglePauseBluetoothCoach');
  if (togglePauseBtn) {
    togglePauseBtn.addEventListener('click', () => {
      // Indoor Training의 toggleStartPauseTraining 함수 재사용
      if (typeof toggleStartPauseTraining === 'function') {
        toggleStartPauseTraining();
      }
    });
  }
  
  // 종료 버튼
  const stopBtn = document.getElementById('btnStopTrainingBluetoothCoach');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      // Indoor Training의 stopTraining 함수 재사용
      if (typeof stopTraining === 'function') {
        stopTraining();
      }
    });
  }
}

/**
 * Firebase에서 트랙 구성 업데이트
 */
window.updateBluetoothCoachTracksFromFirebase = async function updateBluetoothCoachTracksFromFirebase() {
  const config = await getTrackConfigFromFirebase();
  const newMaxTracks = config.maxTracks || 10;
  
  if (newMaxTracks !== window.bluetoothCoachState.maxTrackCount) {
    window.bluetoothCoachState.maxTrackCount = newMaxTracks;
    createPowerMeterGrid();
    setupFirebaseSubscriptions();
    
    if (typeof showToast === 'function') {
      showToast(`${newMaxTracks}개 트랙으로 업데이트되었습니다.`);
    }
  } else {
    if (typeof showToast === 'function') {
      showToast('트랙 구성이 변경되지 않았습니다.');
    }
  }
};

/**
 * showScreen 함수 감시하여 화면 활성화 시 초기화
 */
if (typeof showScreen === 'function') {
  const originalShowScreen = window.showScreen;
  window.showScreen = function(screenId, skipHistory) {
    originalShowScreen(screenId, skipHistory);
    
    if (screenId === 'bluetoothTrainingCoachScreen') {
      setTimeout(() => {
        if (typeof window.initBluetoothCoachDashboard === 'function') {
          window.initBluetoothCoachDashboard();
        }
      }, 100);
    }
  };
}
