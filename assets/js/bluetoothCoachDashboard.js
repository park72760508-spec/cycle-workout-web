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
  maxTrackCount: 10, // 기본 최대 트랙 수
  countdownTriggered: [], // 세그먼트별 카운트다운 트리거 상태
  _countdownFired: {}, // 세그먼트별 발화 기록
  _prevRemainMs: {}, // 세그먼트별 이전 남은 ms
  gaugeAnimationFrameId: null // 게이지 애니메이션 루프 ID (중복 실행 방지용)
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
      this.lastCadenceUpdateTime = 0; // 케이던스 마지막 업데이트 시간 (0 표시 오류 개선용)
      this.lastPowerValue = null; // 네트워크 단절 감지용: 마지막 파워값
      this.lastPowerChangeTime = null; // 네트워크 단절 감지용: 마지막 파워값 변경 시간
      this.networkDisconnected = false; // 네트워크 단절 상태 플래그
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
 * sessions/{roomId}/devices 에서 track 값 가져오기 (track=15 형식)
 */
async function getTrackConfigFromFirebase() {
  const sessionId = getBluetoothCoachSessionId();
  
  // db 객체 확인 및 초기화 시도
  let dbInstance = db;
  if (typeof dbInstance === 'undefined') {
    if (typeof window.db !== 'undefined') {
      dbInstance = window.db;
    } else if (typeof firebase !== 'undefined' && firebase.database) {
      try {
        dbInstance = firebase.database();
        window.db = dbInstance;
        console.log('[Bluetooth Coach] Firebase db 객체를 동적으로 초기화했습니다.');
      } catch (e) {
        console.warn('[Bluetooth Coach] Firebase db 초기화 실패, 기본값 사용:', e);
        return { maxTracks: 10 }; // 기본값
      }
    } else {
      console.warn('[Bluetooth Coach] Firebase가 초기화되지 않았습니다. 기본값 사용.');
      return { maxTracks: 10 }; // 기본값
    }
  }
  
  if (!sessionId) {
    console.warn('[Bluetooth Coach] SESSION_ID가 없습니다. 기본값 사용.');
    return { maxTracks: 10 }; // 기본값
  }
  
  try {
    // Firebase devices DB에서 track 값 가져오기
    const devicesSnapshot = await dbInstance.ref(`sessions/${sessionId}/devices`).once('value');
    const devicesData = devicesSnapshot.val();
    
    if (devicesData && typeof devicesData.track === 'number' && devicesData.track > 0) {
      console.log('[Bluetooth Coach] ✅ Firebase devices에서 트랙 개수 가져옴:', devicesData.track);
      return { maxTracks: devicesData.track };
    }
  } catch (error) {
    console.warn('[Bluetooth Coach] devices DB에서 트랙 구성 정보 가져오기 실패 (계속 진행):', error);
  }
  
  // Fallback: 기존 trackConfig 확인 (하위 호환성)
  try {
    const snapshot = await dbInstance.ref(`sessions/${sessionId}/trackConfig`).once('value');
    const config = snapshot.val();
    if (config && typeof config.maxTracks === 'number' && config.maxTracks > 0) {
      console.log('[Bluetooth Coach] ✅ trackConfig에서 트랙 개수 가져옴:', config.maxTracks);
      return { maxTracks: config.maxTracks };
    }
  } catch (error) {
    console.warn('[Bluetooth Coach] trackConfig 가져오기 실패 (계속 진행):', error);
  }
  
  // Fallback: Firebase users 데이터에서 실제 사용 중인 트랙 수 확인
  try {
    const usersSnapshot = await dbInstance.ref(`sessions/${sessionId}/users`).once('value');
    const users = usersSnapshot.val();
    if (users) {
      const trackNumbers = Object.keys(users).map(key => parseInt(key)).filter(num => !isNaN(num) && num > 0);
      if (trackNumbers.length > 0) {
        const maxTrack = Math.max(...trackNumbers);
        const result = Math.max(10, maxTrack); // 최소 10개
        console.log('[Bluetooth Coach] ✅ users 데이터에서 트랙 개수 계산:', result);
        return { maxTracks: result };
      }
    }
  } catch (error) {
    console.warn('[Bluetooth Coach] 사용자 데이터 확인 실패 (계속 진행):', error);
  }
  
  console.log('[Bluetooth Coach] 기본값 사용: 10개 트랙');
  return { maxTracks: 10 }; // 기본값
}

/**
 * Bluetooth Training Coach 대시보드 초기화
 * Indoor Training과 동일: 그리드를 동기 생성 후 Firebase 구독 (옛날 잘 되던 방식)
 */
window.initBluetoothCoachDashboard = function initBluetoothCoachDashboard() {
  console.log('🎯 [진단/bluetoothCoachDashboard.js] initBluetoothCoachDashboard 함수 실행 시작');
  console.log('🎯 [진단] 함수 호출 스택:', new Error().stack);
  
  // 0. Firebase db 객체 확인 (치명적 오류 방지)
  console.log('🔍 [진단] Firebase db 객체 확인 중...');
  if (typeof db === 'undefined' && typeof firebase !== 'undefined' && firebase.database) {
    try {
      window.db = firebase.database();
      console.log('✅ [진단] Firebase db 객체 초기화 완료');
    } catch (e) {
      console.error('❌ [진단] Firebase db 초기화 실패:', e);
    }
  } else {
    console.log(`🔍 [진단] db 상태: ${typeof db}, firebase 상태: ${typeof firebase}`);
  }
  
  // 1. CSS 충돌 방지: 컨테이너 확실하게 비우고 CSS 강제 적용
  console.log('🔍 [진단] DOM 요소(#bluetoothCoachPowerMeterGrid) 검색 중...');
  const container = document.getElementById('bluetoothCoachPowerMeterGrid');
  if (!container) {
    console.error('❌ [진단/Error] 치명적 오류: bluetoothCoachPowerMeterGrid 요소를 찾을 수 없습니다.');
    console.error('❌ [진단/Error] HTML 구조를 확인하세요. index.html에 해당 요소가 존재해야 합니다.');
    console.error('❌ [진단/Error] 현재 document.readyState:', document.readyState);
    return;
  }
  
  console.log('✅ [진단] DOM 요소 발견됨');
  const beforeStyle = window.getComputedStyle(container);
  console.log('🔍 [진단] 컨테이너 초기 스타일:', {
    display: beforeStyle.display,
    visibility: beforeStyle.visibility,
    opacity: beforeStyle.opacity,
    innerHTMLLength: container.innerHTML.length
  });
  
  container.innerHTML = ''; // 기존에 그려진 트랙 잔상 제거 (중복 렌더링 방지)
  container.style.display = 'grid'; // CSS 강제 적용 (숨김 처리 방지)
  container.style.visibility = 'visible'; // 가시성 보장
  console.log('✅ [진단] 컨테이너 초기화 완료 (innerHTML 비움, display=grid, visibility=visible)');
  
  const sessionId = getBluetoothCoachSessionId();
  console.log('🔍 [진단] SESSION_ID:', sessionId);
  
  // 2. 트랙 구성 정보 가져오기 및 트랙 그리드 생성 (강화된 에러 핸들링)
  console.log('🔍 [진단] getTrackConfigFromFirebase 호출 시작...');
  getTrackConfigFromFirebase()
    .then(config => {
      console.log('✅ [진단] 트랙 구성 정보 수신:', config);
      window.bluetoothCoachState.maxTrackCount = config.maxTracks || 10;
      console.log(`🔍 [진단] maxTrackCount 설정: ${window.bluetoothCoachState.maxTrackCount}`);
      
      // 트랙 그리드 생성
      console.log('🔍 [진단] createBluetoothCoachPowerMeterGrid 호출 시작...');
      createBluetoothCoachPowerMeterGrid();
      console.log('✅ [진단] createBluetoothCoachPowerMeterGrid 호출 완료');
      
      // Firebase 구독 시작
      console.log('🔍 [진단] setupFirebaseSubscriptions 호출 시작...');
      if (typeof setupFirebaseSubscriptions === 'function') {
        setupFirebaseSubscriptions();
        console.log('✅ [진단] setupFirebaseSubscriptions 호출 완료');
      } else {
        console.warn('⚠️ [진단] setupFirebaseSubscriptions 함수가 없습니다.');
      }
    })
    .catch(error => {
      console.error('❌ [진단/Error] 트랙 구성 정보 가져오기 실패, 기본값 사용:', error);
      // 에러 발생 시에도 기본 트랙으로 그리드 생성
      window.bluetoothCoachState.maxTrackCount = 10;
      console.log('🔍 [진단] 에러 발생으로 기본값(10)으로 그리드 생성 시도...');
      createBluetoothCoachPowerMeterGrid();
    });
  
  // 워크아웃 선택 모달은 openWorkoutSelectionModalForBluetoothCoach 함수 사용 (이미 정의됨)
  
  // 컨트롤 버튼 이벤트 연결
  if (typeof setupControlButtons === 'function') {
    setupControlButtons();
  } else {
    console.warn('[Bluetooth Coach] setupControlButtons 함수가 없습니다.');
  }
  
  // 초기 버튼 상태 설정
  if (typeof updateBluetoothCoachTrainingButtons === 'function') {
    updateBluetoothCoachTrainingButtons();
  } else {
    console.warn('[Bluetooth Coach] updateBluetoothCoachTrainingButtons 함수가 없습니다.');
  }
  
  // 속도계 바늘 애니메이션 루프 시작 (파워값에 따라 바늘이 움직이도록)
  if (typeof startGaugeAnimationLoop === 'function') {
    startGaugeAnimationLoop();
    console.log('✅ [Bluetooth Coach] 속도계 바늘 애니메이션 루프 시작됨');
  } else {
    console.warn('[Bluetooth Coach] startGaugeAnimationLoop 함수가 없습니다.');
  }
  
  // 2. 화면 리사이즈 대응: 대시보드가 켜진 상태에서 화면 회전 시 UI 안정성 확보
  if (!window.bluetoothCoachResizeHandler) {
    window.bluetoothCoachResizeHandler = function() {
      // 리사이즈 시 그리드 레이아웃 재조정
      const gridContainer = document.getElementById('bluetoothCoachPowerMeterGrid');
      if (gridContainer && window.bluetoothCoachState && window.bluetoothCoachState.powerMeters) {
        // 컨테이너가 보이는지 확인하고, 숨겨져 있으면 다시 표시
        const computedStyle = window.getComputedStyle(gridContainer);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
          gridContainer.style.display = 'grid';
          gridContainer.style.visibility = 'visible';
          console.log('[Bluetooth Coach] 리사이즈: 그리드 컨테이너 복구');
        }
      }
    };
    
    // 리사이즈 이벤트 리스너 등록 (디바운싱 적용)
    let resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(window.bluetoothCoachResizeHandler, 150);
    });
    
    // 화면 방향 변경 이벤트도 처리 (모바일 기기 회전)
    window.addEventListener('orientationchange', function() {
      setTimeout(window.bluetoothCoachResizeHandler, 200);
    });
    
    console.log('[Bluetooth Coach] 리사이즈 이벤트 리스너 등록 완료');
  }
};

/**
 * 파워계 그리드 생성 (트랙 동적 생성) - Bluetooth Coach 전용
 */
/**
 * [진단 모드] 트랙 그리드 생성 함수
 * - 로직 흐름 검증을 위한 상세 로그 추가 (Step-by-Step)
 */
function createBluetoothCoachPowerMeterGrid() {
  console.log('📌 [Step 3] 그리드 생성 함수 진입 (createBluetoothCoachPowerMeterGrid)');
  
  const gridEl = document.getElementById('bluetoothCoachPowerMeterGrid');
  if (!gridEl) {
    console.error('❌ [Critical] 그리드 컨테이너(#bluetoothCoachPowerMeterGrid)가 없습니다!');
    return;
  }

  // 1. 초기화
  gridEl.innerHTML = '';
  gridEl.style.display = 'grid';
  // CSS 강제 적용 (숨김 방지)
  gridEl.style.visibility = 'visible'; 
  gridEl.style.opacity = '1';

  // 상태 초기화
  if (!window.bluetoothCoachState.powerMeters) {
      window.bluetoothCoachState.powerMeters = [];
  } else {
      window.bluetoothCoachState.powerMeters.length = 0;
  }

  // 2. 트랙 개수 확인
  const maxTracks = window.bluetoothCoachState.maxTrackCount || 10;
  console.log(`📌 [Step 3-1] 설정된 트랙 개수: ${maxTracks}개`);

  // 3. 반복문 실행
  console.log('📌 [Step 3-2] 트랙 생성 루프 시작...');
  let successCount = 0;

  // PowerMeterData 클래스 참조 확보
  const PMClass = (typeof PowerMeterData !== 'undefined') ? PowerMeterData : window.PowerMeterData;
  if (!PMClass) {
      console.error('❌ [Critical] PowerMeterData 클래스가 정의되지 않았습니다!');
      return;
  }

  for (let i = 1; i <= maxTracks; i++) {
    // 4. 개별 트랙 요소 생성 시도
    const powerMeter = new PMClass(i, `트랙${i}`);
    window.bluetoothCoachState.powerMeters.push(powerMeter);
    
    // 핵심: 여기서 요소가 만들어지는지 확인
    let element = null;
    try {
        element = createPowerMeterElement(powerMeter); 
    } catch (err) {
        console.error(`💥 [Exception] 트랙 ${i} 생성 중 예외 발생:`, err);
    }
    
    if (element) {
      gridEl.appendChild(element);
      successCount++;
    } else {
      console.warn(`⚠️ [Step 3-Fail] 트랙 ${i}번 요소 생성 실패 (createPowerMeterElement가 null 반환 - 데이터 부족 의심)`);
    }
  }

  console.log(`📌 [Step 4] 로직 완료. 생성된 트랙: ${successCount} / ${maxTracks}`);
  
  if (successCount === 0) {
    console.error('🚨 [결과] 트랙이 하나도 생성되지 않았습니다! createPowerMeterElement 내부 로직을 점검하세요.');
  } else {
    console.log('✅ [결과] 화면 전환 및 트랙 생성 로직이 정상 동작했습니다.');
  }
  
  // 그리드 생성 후 모든 바늘이 표시되도록 보장
  setTimeout(() => {
    if (typeof initializeNeedles === 'function') {
      initializeNeedles();
    }
    // 각 트랙의 바늘이 표시되도록 개별 확인
    window.bluetoothCoachState.powerMeters.forEach(pm => {
      ensureNeedleVisible(pm.id);
    });
  }, 100);
}

/**
 * 파워계 요소 생성 (Indoor Training 카피, 클릭 이벤트 제거)
 */
function createPowerMeterElement(powerMeter) {
  // [방어 로직 1] currentWorkout 의존성 제거 - 워크아웃이 없어도 기본 UI 반환
  const hasWorkout = window.bluetoothCoachState && 
                     window.bluetoothCoachState.currentWorkout && 
                     window.bluetoothCoachState.currentWorkout.segments &&
                     Array.isArray(window.bluetoothCoachState.currentWorkout.segments) &&
                     window.bluetoothCoachState.currentWorkout.segments.length > 0;
  
  if (!hasWorkout) {
    console.log(`🔍 [진단] createPowerMeterElement: currentWorkout이 없지만 기본 UI 생성 (트랙 ${powerMeter.id})`);
  }
  
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `power-meter-${powerMeter.id}`;
  container.dataset.powerMeterId = powerMeter.id;
  
  // 트랙 버튼은 표시만 하고 클릭 이벤트는 없음 (Coach 모니터는 읽기 전용)
  const trackButtonStyle = 'background: rgba(0, 212, 170, 0.5) !important; color: #ffffff !important; cursor: default !important;';
  
  container.innerHTML = `
    <div class="speedometer-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; position: relative !important;">
      <span class="speedometer-user-name" id="user-icon-${powerMeter.id}" 
            style="display: ${powerMeter.userName ? 'inline-block' : 'none'} !important; font-size: 13px !important; color: #ffffff !important; font-weight: 500 !important; text-align: left !important; cursor: default !important; order: 1 !important;">${powerMeter.userName || ''}</span>
      <span class="speedometer-name" style="position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; font-weight: 600 !important; text-align: center !important; order: 2 !important; z-index: 1 !important; ${trackButtonStyle} padding: 6px 12px !important; border-radius: 8px !important; display: inline-block !important;">트랙${powerMeter.id}</span>
      <div class="connection-status-center" id="status-${powerMeter.id}" style="position: static !important; left: auto !important; transform: none !important; flex: 0 0 auto !important; text-align: right !important; margin-left: auto !important; order: 3 !important; display: flex !important; align-items: center !important; gap: 6px !important;">
        <span id="device-icons-${powerMeter.id}" style="display: none !important; align-items: center !important; gap: 4px !important;"></span>
        <span class="status-dot disconnected" id="status-dot-${powerMeter.id}"></span>
        <span class="status-text" id="status-text-${powerMeter.id}">미연결</span>
      </div>
    </div>
    <div class="speedometer-dial">
      <svg class="speedometer-svg" viewBox="0 0 200 200">
        <path class="speedometer-arc-bg" d="M 20 140 A 80 80 0 0 1 180 140" 
              fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5"/>
        
        <g class="speedometer-ticks">
          ${generateBluetoothCoachPowerMeterTicks(powerMeter.id)}
        </g>
        
        <g class="speedometer-labels">
          ${generateBluetoothCoachPowerMeterLabels(powerMeter.id)}
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
                transform="rotate(-90)"/>
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
        
        <text x="100" y="188" 
              text-anchor="start" 
              dominant-baseline="middle"
              fill="#ffffff" 
              font-size="21.6" 
              font-weight="500"
              id="ftp-percent-${powerMeter.id}"
              style="display: none;"></text>
        
      </svg>
    </div>
    <div class="speedometer-info disconnected">
      <div class="speed-display-left">
        <div class="speed-stat-row speed-stat-rpm">
          <span class="speed-stat-value" id="cadence-value-${powerMeter.id}">0</span>
          <span class="speed-unit-small">rpm</span>
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
      </div>
    </div>
  `;
  
  // [방어 로직 5] 반환 전 최종 검증 - 절대 null을 반환하지 않음
  if (!container) {
    console.error(`[Bluetooth Coach] ❌ 치명적 오류: createPowerMeterElement가 container를 생성하지 못했습니다 (트랙 ${powerMeter.id})`);
    // 비상 복구: 최소한의 div 요소라도 반환
    const fallbackContainer = document.createElement('div');
    fallbackContainer.className = 'speedometer-container';
    fallbackContainer.id = `power-meter-${powerMeter.id}`;
    fallbackContainer.innerHTML = `<div style="padding: 20px; color: white; text-align: center;">트랙 ${powerMeter.id} (로딩 중...)</div>`;
    return fallbackContainer;
  }
  
  // [진단 로그] 요소 생성 성공 확인
  console.log(`✅ [진단] createPowerMeterElement: 트랙 ${powerMeter.id} 요소 생성 완료 (currentWorkout: ${hasWorkout ? '있음' : '없음'})`);
  
  return container;
}

/**
 * 파워계 눈금 생성 (Bluetooth Coach 전용)
 */
function generateBluetoothCoachPowerMeterTicks(powerMeterId) {
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
 * 파워계 라벨 생성 (Bluetooth Coach 전용)
 */
function generateBluetoothCoachPowerMeterLabels(powerMeterId) {
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
 * 바늘이 항상 표시되도록 보장하는 헬퍼 함수
 */
function ensureNeedleVisible(powerMeterId) {
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  if (needleEl) {
    needleEl.style.display = '';
    needleEl.style.visibility = 'visible';
    needleEl.style.opacity = '1';
    // stroke 속성도 확인 (바늘이 보이도록)
    if (!needleEl.getAttribute('stroke') || needleEl.getAttribute('stroke') === 'none') {
      needleEl.setAttribute('stroke', '#ff0000');
    }
    if (!needleEl.getAttribute('stroke-width') || needleEl.getAttribute('stroke-width') === '0') {
      needleEl.setAttribute('stroke-width', '3');
    }
  }
}

/**
 * 파워계 바늘 초기화
 */
function initializeNeedles() {
  window.bluetoothCoachState.powerMeters.forEach(pm => {
    // 바늘이 항상 표시되도록 보장
    ensureNeedleVisible(pm.id);
    
    // 바늘을 초기 위치(-90도, 0W, 왼쪽 끝)로 설정
    const needleEl = document.getElementById(`needle-${pm.id}`);
    if (needleEl) {
      needleEl.style.transition = 'none';
      // 회전 중심점을 명시적으로 설정
      needleEl.setAttribute('transform', 'rotate(-90 0 0)');
    }
    updatePowerMeterNeedle(pm.id, 0);
  });
}

/**
 * 파워계 바늘 업데이트
 */
function updatePowerMeterNeedle(powerMeterId, power) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === powerMeterId);
  if (!powerMeter) return;
  
  const now = Date.now();
  const NETWORK_TIMEOUT_MS = 3000; // 3초 동안 같은 값이면 네트워크 단절로 판단
  
  // 네트워크 단절 감지 로직
  let currentPowerValue = Math.max(0, Number(power) || 0);
  
  // 파워값이 변경되었는지 확인
  if (powerMeter.lastPowerValue === null || powerMeter.lastPowerValue !== currentPowerValue) {
    // 파워값이 변경됨 - 네트워크 정상
    powerMeter.lastPowerValue = currentPowerValue;
    powerMeter.lastPowerChangeTime = now;
    powerMeter.networkDisconnected = false;
  } else if (powerMeter.lastPowerChangeTime !== null) {
    // 파워값이 같은 상태로 유지됨
    const timeSinceLastChange = now - powerMeter.lastPowerChangeTime;
    if (timeSinceLastChange >= NETWORK_TIMEOUT_MS && currentPowerValue > 0) {
      // 일정 시간 동안 같은 값이고 0이 아니면 네트워크 단절로 판단
      powerMeter.networkDisconnected = true;
      currentPowerValue = 0;
    }
  }
  
  // 네트워크 단절 시 파워값을 0으로 설정
  if (powerMeter.networkDisconnected) {
    powerMeter.currentPower = 0;
  } else {
    powerMeter.currentPower = currentPowerValue;
  }
  
  // 파워값 표시 업데이트
  const textEl = document.getElementById(`current-power-value-${powerMeterId}`);
  if (textEl) {
    textEl.textContent = Math.round(powerMeter.currentPower);
  }
  
  // FTP 대비 % 위첨자 표시
  const ftpPercentEl = document.getElementById(`ftp-percent-${powerMeterId}`);
  if (ftpPercentEl && powerMeter.userFTP && powerMeter.userFTP > 0) {
    const ftpPercent = Math.round((powerMeter.currentPower / powerMeter.userFTP) * 100);
    if (powerMeter.currentPower > 0) {
      // 파워값의 실제 너비를 계산하여 우측에 배치
      // 파워값 폰트 크기 43.2px의 50% = 21.6px (위첨자 크기)
      const powerText = String(Math.round(powerMeter.currentPower));
      // 대략적인 문자 너비 계산 (43.2px 폰트 기준)
      const avgCharWidth = 43.2 * 0.6; // 대략적인 문자 너비
      const powerTextWidth = powerText.length * avgCharWidth;
      const startX = 100 + (powerTextWidth / 2) + 8; // 파워값 중앙에서 우측으로 8px
      ftpPercentEl.setAttribute('x', startX);
      ftpPercentEl.setAttribute('y', 188); // 파워값과 같은 높이 (수평 배치)
      ftpPercentEl.setAttribute('font-size', '21.6'); // 폰트 크기 50% (43.2 * 0.5)
      ftpPercentEl.textContent = ftpPercent + '%';
      ftpPercentEl.style.display = '';
    } else {
      ftpPercentEl.style.display = 'none';
    }
  }
  
  powerMeter.previousPower = powerMeter.currentPower;
  
  // displayPower 업데이트 (애니메이션 루프에서 부드럽게 처리됨)
  // 네트워크 단절 시 즉시 0으로 설정, 그 외에는 애니메이션 루프가 부드럽게 처리
  if (powerMeter.networkDisconnected) {
    // 네트워크 단절 시 즉시 0으로 설정
    powerMeter.displayPower = 0;
  }
  // 정상 작동 시에는 애니메이션 루프가 displayPower를 부드럽게 업데이트함
  
  // 즉시 업데이트가 필요한 경우를 위한 폴백 (애니메이션 루프가 실행되지 않을 때)
  const gaugeMaxPower = powerMeter.userFTP ? powerMeter.userFTP * 1.5 : 300;
  const ratio = Math.min(Math.max(powerMeter.currentPower / gaugeMaxPower, 0), 1);
  const angle = -90 + (ratio * 180); // -90도(왼쪽)에서 90도(오른쪽)까지
  
  // 바늘이 항상 표시되도록 보장
  ensureNeedleVisible(powerMeterId);
  
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  if (needleEl) {
    // 네트워크 단절 시 즉시 업데이트, 그 외에는 애니메이션 루프가 처리
    if (powerMeter.networkDisconnected) {
      needleEl.style.transition = 'none';
      needleEl.setAttribute('transform', `rotate(${angle} 0 0)`);
    }
    // 정상 작동 시에는 애니메이션 루프가 부드럽게 업데이트함
  }
}

/**
 * 게이지 애니메이션 루프 (Indoor Training과 동일)
 */
function startGaugeAnimationLoop() {
  // 이미 실행 중이면 중복 실행 방지
  if (window.bluetoothCoachState.gaugeAnimationFrameId !== null) {
    console.log('[Bluetooth Coach] 게이지 애니메이션 루프가 이미 실행 중입니다.');
    return;
  }
  
  // 초기 프레임 타임 설정
  if (!window.bluetoothCoachState.lastFrameTime) {
    window.bluetoothCoachState.lastFrameTime = performance.now();
  }
  
  const loop = () => {
    if (!window.bluetoothCoachState || !window.bluetoothCoachState.powerMeters) {
      window.bluetoothCoachState.gaugeAnimationFrameId = requestAnimationFrame(loop);
      return;
    }

    // 프레임 레이트 독립적인 애니메이션을 위한 델타 타임 계산
    const now = performance.now();
    const lastFrameTime = window.bluetoothCoachState.lastFrameTime || now;
    const deltaTimeMs = now - lastFrameTime;
    const deltaTime = Math.min(deltaTimeMs / 16.67, 2.5); // 최대 2.5배까지 제한 (프레임 드롭 대응)
    window.bluetoothCoachState.lastFrameTime = now;

    window.bluetoothCoachState.powerMeters.forEach(pm => {
      if (!pm.connected) return;

      const target = pm.currentPower || 0;
      const current = pm.displayPower || 0;
      const diff = target - current;
      const absDiff = Math.abs(diff);

      // Garmin 스타일 부드러운 애니메이션: 적응형 지수적 감쇠 (Exponential Decay)
      if (absDiff > 0.05) {
        // 거리에 따른 적응형 보간 속도 (Garmin의 실제 알고리즘 기반)
        // 큰 변화(>50W): 빠른 반응, 작은 변화(<10W): 부드러운 이동
        let adaptiveRate;
        if (absDiff > 50) {
          // 큰 변화: 빠른 반응 (0.25-0.30)
          adaptiveRate = 0.28;
        } else if (absDiff > 20) {
          // 중간 변화: 적당한 속도 (0.15-0.20)
          adaptiveRate = 0.18;
        } else {
          // 작은 변화: 부드러운 이동 (0.08-0.12)
          adaptiveRate = 0.10;
        }
        
        // 지수적 감쇠 (exponential decay) 적용 - Garmin 스타일
        // deltaTime을 고려하여 프레임 레이트 독립적으로 동작
        // 60FPS 기준으로 정규화된 보간 계수 계산
        const normalizedDelta = Math.min(deltaTime, 2.0);
        const smoothFactor = 1 - Math.pow(1 - adaptiveRate, normalizedDelta);
        
        // 부드러운 보간 적용 (Lerp: Linear Interpolation with exponential decay)
        pm.displayPower = current + diff * smoothFactor;
        
        // 매우 작은 차이는 즉시 목표값으로 설정 (떨림 방지 및 성능 최적화)
        if (Math.abs(pm.displayPower - target) < 0.1) {
          pm.displayPower = target;
        }
      } else {
        // 차이가 매우 작으면 목표값으로 고정 (떨림 방지)
        pm.displayPower = target;
      }

      // FTP 기반 최대 파워 계산 (FTP × 2)
      const ftp = pm.userFTP || 200;
      const maxPower = ftp * 2;
      let ratio = Math.min(Math.max(pm.displayPower / maxPower, 0), 1);
      
      // 바늘 각도 계산: -90도(왼쪽) ~ 90도(오른쪽) - 위쪽 반원
      const angle = -90 + (ratio * 180);

      // 바늘이 항상 표시되도록 보장
      ensureNeedleVisible(pm.id);
      
      const needleEl = document.getElementById(`needle-${pm.id}`);
      if (needleEl) {
        // CSS transition 대신 직접 transform 업데이트 (더 부드러운 애니메이션)
        // Garmin은 하드웨어 가속을 위해 transform만 사용
        needleEl.style.transition = 'none';
        needleEl.style.willChange = 'transform'; // 브라우저 최적화 힌트
        // 회전 중심점을 명시적으로 설정 (SVG 좌표계 기준)
        needleEl.setAttribute('transform', `rotate(${angle} 0 0)`);
      }
      
      // 바늘 궤적 업데이트 (Indoor Training과 동일한 방식)
      updateBluetoothCoachPowerMeterTrail(pm.id, pm.displayPower, angle, pm);
    });

    window.bluetoothCoachState.gaugeAnimationFrameId = requestAnimationFrame(loop);
  };
  window.bluetoothCoachState.gaugeAnimationFrameId = requestAnimationFrame(loop);
}

/**
 * Firebase Realtime Database 구독 설정
 * sessions/{sessionId}/users/{trackId} 경로를 구독하여 실시간 데이터 수신
 */
function setupFirebaseSubscriptions() {
  const sessionId = getBluetoothCoachSessionId();
  
  // db 객체 확인 및 초기화 시도
  let dbInstance = db;
  if (typeof dbInstance === 'undefined') {
    if (typeof window.db !== 'undefined') {
      dbInstance = window.db;
    } else if (typeof firebase !== 'undefined' && firebase.database) {
      try {
        dbInstance = firebase.database();
        window.db = dbInstance;
        console.log('[Bluetooth Coach] setupFirebaseSubscriptions: Firebase db 객체를 동적으로 초기화했습니다.');
      } catch (e) {
        console.warn('[Bluetooth Coach] Firebase db 초기화 실패:', e);
        return;
      }
    } else {
      console.warn('[Bluetooth Coach] Firebase가 초기화되지 않았습니다.');
      return;
    }
  }
  
  if (!sessionId) {
    console.warn('[Bluetooth Coach] SESSION_ID가 없습니다.');
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
  const powerMeters = window.bluetoothCoachState.powerMeters;
  if (Array.isArray(powerMeters)) {
    powerMeters.forEach(pm => {
      const trackId = pm && pm.id;
      if (trackId == null) return;
      const userRef = dbInstance.ref(`sessions/${sessionId}/users/${trackId}`);
      
      const unsubscribe = userRef.on('value', (snapshot) => {
        try {
          if (!snapshot) return;
          const userData = snapshot.val();
          if (userData) {
            updatePowerMeterDataFromFirebase(trackId, userData);
          } else {
            resetPowerMeterData(trackId);
          }
        } catch (e) {
          console.warn('[Bluetooth Coach] user value callback error:', e);
        }
      });
      
      window.bluetoothCoachState.firebaseSubscriptions[`user_${trackId}`] = unsubscribe;
    });
  } else {
    console.warn('[Bluetooth Coach] powerMeters가 배열이 아닙니다.');
  }
  
  // 워크아웃 상태 구독 (Indoor Training과 동일한 방식)
  const statusRef = dbInstance.ref(`sessions/${sessionId}/status`);
  const statusUnsubscribe = statusRef.on('value', (snapshot) => {
    try {
      if (!snapshot) return;
      const status = snapshot.val();
      if (status) {
        updateTrainingStatus(status);
      }
    } catch (e) {
      console.warn('[Bluetooth Coach] status value callback error:', e);
    }
  });
  window.bluetoothCoachState.firebaseSubscriptions['status'] = statusUnsubscribe;
  
  // 워크아웃 플랜 구독 (Firebase에서 워크아웃 변경 감지)
  const workoutPlanRef = dbInstance.ref(`sessions/${sessionId}/workoutPlan`);
  const workoutPlanUnsubscribe = workoutPlanRef.on('value', (snapshot) => {
    try {
      if (!snapshot) return;
      const workoutPlan = snapshot.val();
      if (workoutPlan) {
        if (Array.isArray(workoutPlan)) {
        // segments 배열인 경우
        if (window.bluetoothCoachState.currentWorkout) {
          // 기존 currentWorkout이 있으면 segments만 업데이트 (다른 속성 보존)
          window.bluetoothCoachState.currentWorkout.segments = workoutPlan;
          // 세그먼트 그래프는 이미 표시되어 있으므로 업데이트만 수행 (삭제하지 않음)
          if (window.bluetoothCoachState.trainingState === 'running') {
            // 훈련 중이면 세그먼트 그래프 업데이트 (마스코트 위치 등)
            updateWorkoutSegmentGraph();
          }
        } else {
          // currentWorkout이 없으면 segments 배열만으로는 워크아웃 객체를 만들 수 없음
          // 이 경우는 워크아웃이 선택되지 않은 상태이므로 그래프를 표시하지 않음
          console.log('[Bluetooth Coach] Firebase에서 workoutPlan 업데이트됨 (segments 배열), 하지만 currentWorkout이 없음');
        }
      } else if (workoutPlan && typeof workoutPlan === 'object') {
        // workoutPlan이 객체인 경우 (전체 워크아웃 정보)
        if (!window.bluetoothCoachState.currentWorkout || window.bluetoothCoachState.trainingState === 'idle') {
          window.bluetoothCoachState.currentWorkout = workoutPlan;
          updateWorkoutSegmentGraph();
        } else {
          if (workoutPlan.segments) {
            window.bluetoothCoachState.currentWorkout.segments = workoutPlan.segments;
            updateWorkoutSegmentGraph();
          }
        }
      }
    }
    } catch (e) {
      console.warn('[Bluetooth Coach] workoutPlan value callback error:', e);
    }
  });
  window.bluetoothCoachState.firebaseSubscriptions['workoutPlan'] = workoutPlanUnsubscribe;
  
  console.log('[Bluetooth Coach] Firebase 구독 설정 완료');
  
  // 초기 사용자 정보 로드하여 FTP 적용
  loadInitialUserDataForTracks();
}

/**
 * 초기 트랙 사용자 정보 로드하여 FTP 적용
 */
async function loadInitialUserDataForTracks() {
  const sessionId = getBluetoothCoachSessionId();
  if (!sessionId || typeof db === 'undefined') {
    console.warn('[Bluetooth Coach] Firebase가 초기화되지 않아 초기 사용자 데이터를 로드할 수 없습니다.');
    return;
  }
  
  try {
    const usersSnapshot = await db.ref(`sessions/${sessionId}/users`).once('value');
    const usersData = usersSnapshot.val();
    
    if (usersData) {
      Object.keys(usersData).forEach(trackIdStr => {
        const trackId = parseInt(trackIdStr, 10);
        if (!isNaN(trackId) && trackId > 0) {
          const userData = usersData[trackId];
          if (userData) {
            const powerMeter = window.bluetoothCoachState.powerMeters.find(pm => pm.id === trackId);
            if (powerMeter) {
              // 사용자 정보 업데이트
              if (userData.userId) powerMeter.userId = userData.userId;
              if (userData.userName) powerMeter.userName = userData.userName;
              if (userData.weight) powerMeter.userWeight = userData.weight;
              
              // FTP 적용
              if (userData.ftp) {
                const prevFTP = powerMeter.userFTP;
                powerMeter.userFTP = userData.ftp;
                if (prevFTP !== userData.ftp) {
                  console.log(`[Bluetooth Coach] 초기 로드: 트랙 ${trackId} FTP 적용: ${userData.ftp}`);
                  updateBluetoothCoachPowerMeterTicks(trackId);
                }
              }
              
              // 사용자 이름 UI 업데이트
              const userNameEl = document.getElementById(`user-name-${trackId}`);
              if (userNameEl && userData.userName) {
                userNameEl.textContent = userData.userName;
                userNameEl.style.display = 'inline-block';
              }
            }
          }
        }
      });
    }
  } catch (error) {
    console.error('[Bluetooth Coach] 초기 사용자 데이터 로드 실패:', error);
  }
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
    const userNameEl = document.getElementById(`user-icon-${trackId}`);
    if (userNameEl) {
      userNameEl.textContent = userData.userName;
      userNameEl.style.display = 'inline-block';
    }
  }
  
  // FTP 변경 감지를 위해 이전 값 저장 (업데이트 전에)
  const prevFTP = powerMeter.userFTP;
  
  // FTP 업데이트
  if (userData.ftp) {
    powerMeter.userFTP = userData.ftp;
  }
  
  // FTP 변경 시 눈금 업데이트
  if (userData.ftp && userData.ftp !== prevFTP) {
    console.log(`[Bluetooth Coach] 트랙 ${trackId} FTP 변경: ${prevFTP || '없음'} → ${userData.ftp}`);
    updateBluetoothCoachPowerMeterTicks(trackId);
  }
  
  if (userData.weight) powerMeter.userWeight = userData.weight;
  
  // 훈련 데이터 업데이트
  const power = userData.power || 0;
  const heartRate = userData.hr || 0;
  const cadence = userData.cadence || 0;
  const avgPower = userData.avgPower || 0;
  const maxPower = userData.maxPower || 0;
  const segmentPower = userData.segmentPower || 0;
  const targetPower = userData.targetPower || 0;
  
  // 파워계 데이터 업데이트 (네트워크 단절 감지를 위해 updatePowerMeterNeedle 사용)
  powerMeter.heartRate = heartRate;
  powerMeter.cadence = cadence;
  powerMeter.averagePower = avgPower;
  powerMeter.maxPower = maxPower;
  powerMeter.segmentPower = segmentPower;
  powerMeter.targetPower = targetPower;
  powerMeter.lastUpdateTime = userData.lastUpdate || Date.now();
  
  // 파워값 업데이트 (네트워크 단절 감지 포함)
  if (typeof updatePowerMeterNeedle === 'function') {
    updatePowerMeterNeedle(trackId, power);
  } else {
    powerMeter.currentPower = power;
  }
  
  // 연결 상태 업데이트
  powerMeter.connected = (powerMeter.currentPower > 0 || heartRate > 0 || cadence > 0);
  
  // UI 업데이트
  updatePowerMeterUI(trackId);
  
  // 연결 상태 표시 업데이트 (Firebase 디바이스 정보 확인)
  updateBluetoothCoachConnectionStatus(trackId);
  
  // 바늘 궤적 업데이트 (목표 파워 및 궤적 표시)
  const ftp = powerMeter.userFTP || 200;
  const gaugeMaxPower = ftp * 2; // 게이지 최대값 (FTP의 200%)
  const currentPower = powerMeter.currentPower || 0;
  const ratio = Math.min(Math.max(currentPower / gaugeMaxPower, 0), 1);
  const angle = -90 + (ratio * 180);
  updateBluetoothCoachPowerMeterTrail(trackId, currentPower, angle, powerMeter);
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
  
  // FTP 대비 % 위첨자 표시 (updatePowerMeterNeedle에서도 처리되지만 여기서도 업데이트)
  const ftpPercentEl = document.getElementById(`ftp-percent-${trackId}`);
  if (ftpPercentEl && powerMeter.userFTP && powerMeter.userFTP > 0) {
    const currentPower = powerMeter.currentPower || 0;
    const ftpPercent = Math.round((currentPower / powerMeter.userFTP) * 100);
    if (currentPower > 0) {
      const powerText = String(Math.round(currentPower));
      const avgCharWidth = 43.2 * 0.6;
      const powerTextWidth = powerText.length * avgCharWidth;
      const startX = 100 + (powerTextWidth / 2) + 8;
      ftpPercentEl.setAttribute('x', startX);
      ftpPercentEl.setAttribute('y', 188); // 파워값과 같은 높이 (수평 배치)
      ftpPercentEl.setAttribute('font-size', '21.6'); // 폰트 크기 50% (43.2 * 0.5)
      ftpPercentEl.textContent = ftpPercent + '%';
      ftpPercentEl.style.display = '';
    } else {
      ftpPercentEl.style.display = 'none';
    }
  }
  
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
  
  // 케이던스 (좌측 표시) - 0 표시 오류 개선
  const cadenceEl = document.getElementById(`cadence-value-${trackId}`);
  if (cadenceEl) {
    const now = Date.now();
    // 케이던스가 업데이트되었는지 확인 (0 표시 오류 개선)
    if (powerMeter.cadence > 0) {
      powerMeter.lastCadenceUpdateTime = now;
    }
    
    // 5초 이내에 업데이트가 있었으면 케이던스 표시, 없으면 0 표시
    const timeSinceLastUpdate = now - (powerMeter.lastCadenceUpdateTime || 0);
    let cadenceValue = 0;
    if (timeSinceLastUpdate <= 5000 && powerMeter.cadence > 0) {
      cadenceValue = (typeof powerMeter.cadence === 'number' && powerMeter.cadence >= 0 && powerMeter.cadence <= 254) 
        ? Math.round(powerMeter.cadence) 
        : 0;
    }
    
    cadenceEl.textContent = cadenceValue.toString();
  }
  
  // 목표 파워
  const targetPowerEl = document.getElementById(`target-power-value-${trackId}`);
  if (targetPowerEl && powerMeter.targetPower > 0) {
    targetPowerEl.textContent = Math.round(powerMeter.targetPower);
  }
  
  // 배경색 업데이트 (RPM 값이 0보다 크면 초록색) - 0 표시 오류 개선
  const infoEl = document.querySelector(`#power-meter-${trackId} .speedometer-info`);
  if (infoEl) {
    const now = Date.now();
    const timeSinceLastUpdate = now - (powerMeter.lastCadenceUpdateTime || 0);
    // 5초 이내에 업데이트가 있었고 케이던스가 0보다 크면 초록색
    const cadenceValue = (timeSinceLastUpdate <= 5000 && powerMeter.cadence > 0) 
      ? ((typeof powerMeter.cadence === 'number' && powerMeter.cadence >= 0 && powerMeter.cadence <= 254) 
          ? Math.round(powerMeter.cadence) 
          : 0)
      : 0;
    if (cadenceValue > 0) {
      // RPM 값이 0보다 크면 초록색 (#00d4aa)
      infoEl.style.backgroundColor = '#00d4aa';
      infoEl.style.color = '#ffffff';
      infoEl.classList.remove('disconnected');
      infoEl.classList.add('connected');
    } else {
      // RPM 값이 0이면 기본 색상
      infoEl.style.backgroundColor = '';
      infoEl.style.color = '';
      infoEl.classList.remove('connected');
      infoEl.classList.add('disconnected');
    }
  }
  
  // 연결 상태 업데이트 (Firebase 디바이스 정보 확인)
  updateBluetoothCoachConnectionStatus(trackId);
}

/**
 * Firebase에서 트랙의 디바이스 정보 가져오기
 */
async function getFirebaseDevicesForTrackBluetoothCoach(trackId) {
  const sessionId = getBluetoothCoachSessionId();
  if (!sessionId || typeof db === 'undefined') {
    return null;
  }
  
  try {
    const snapshot = await db.ref(`sessions/${sessionId}/devices/${trackId}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error(`[Bluetooth Coach] Firebase 디바이스 정보 가져오기 실패 (트랙 ${trackId}):`, error);
    return null;
  }
}

/**
 * 연결 상태 업데이트 (Indoor Training의 updatePowerMeterConnectionStatus 참고)
 */
function updateBluetoothCoachConnectionStatus(powerMeterId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const statusTextEl = document.getElementById(`status-text-${powerMeterId}`);
  const statusDotEl = document.getElementById(`status-dot-${powerMeterId}`);
  const deviceIconsEl = document.getElementById(`device-icons-${powerMeterId}`);
  
  // Firebase에서 디바이스 정보 가져오기 (비동기)
  getFirebaseDevicesForTrackBluetoothCoach(powerMeterId).then(deviceData => {
    // Firebase devices 정보가 있으면 사용
    const smartTrainerId = deviceData?.smartTrainerId || null;
    const powerMeterId_fb = deviceData?.powerMeterId || null;
    const heartRateId = deviceData?.heartRateId || null;
    
    // 조건 확인
    const hasUser = !!(powerMeter.userId);
    const hasPowerDevice = !!(powerMeterId_fb || smartTrainerId);
    const hasHeartRateDevice = !!(heartRateId);
    const hasAnyDevice = hasPowerDevice || hasHeartRateDevice;
    const hasData = powerMeter.currentPower > 0 || powerMeter.heartRate > 0 || powerMeter.cadence > 0;
  
    let statusClass = 'disconnected';
    let statusText = '미연결';
    
    // 연결 상태 판단 (Bluetooth Coach 로직)
    if (!hasUser) {
      // 사용자 미지정
      statusClass = 'disconnected';
      statusText = '미연결';
      powerMeter.connected = false;
    } else if (hasUser && hasAnyDevice) {
      // 사용자 지정 + 디바이스 정보 저장된 상태
      if (hasData) {
        // 데이터 수신 중
        statusClass = 'connected';
        statusText = '연결됨';
        powerMeter.connected = true;
      } else {
        // 디바이스 정보는 있지만 데이터 미수신
        statusClass = 'ready';
        statusText = '준비됨';
        powerMeter.connected = false;
      }
    } else {
      // 사용자 지정만 되어 있고 디바이스 정보 없음
      statusClass = 'disconnected';
      statusText = '미연결';
      powerMeter.connected = false;
    }
    
    // 상태 텍스트 업데이트
    if (statusTextEl) {
      statusTextEl.textContent = statusText;
    }
    
    // 상태 점 표시/숨김 처리 (녹색/빨강색 표시)
    if (statusDotEl) {
      if (statusClass === 'disconnected') {
        // 미연결 상태: 빨간 원 표시
        statusDotEl.style.display = 'inline-block';
        statusDotEl.classList.remove('ready', 'connected');
        statusDotEl.classList.add('disconnected');
      } else if (statusClass === 'connected') {
        // 연결됨 상태: 녹색 점 표시
        statusDotEl.style.display = 'inline-block';
        statusDotEl.classList.remove('disconnected', 'ready');
        statusDotEl.classList.add('connected');
      } else {
        // 준비됨 상태: 점 숨김
        statusDotEl.style.display = 'none';
      }
    }
    
    // 디바이스 아이콘 표시/숨김 처리
    if (deviceIconsEl) {
      if (statusClass === 'ready' || statusClass === 'connected') {
        // 준비됨 또는 연결됨 상태: 등록된 기기 이미지 표시
        deviceIconsEl.style.display = 'inline-flex';
        updateBluetoothCoachDeviceIcons(powerMeterId, deviceData);
      } else {
        // 미연결 상태: 디바이스 아이콘 숨김
        deviceIconsEl.style.display = 'none';
      }
    }
  }).catch(error => {
    console.error(`[Bluetooth Coach] updateBluetoothCoachConnectionStatus 오류 (트랙 ${powerMeterId}):`, error);
    // 오류 시 기본 상태로 폴백
    if (statusTextEl) {
      statusTextEl.textContent = '미연결';
    }
    if (statusDotEl) {
      statusDotEl.style.display = 'inline-block';
      statusDotEl.classList.remove('ready', 'connected');
      statusDotEl.classList.add('disconnected');
    }
    if (deviceIconsEl) {
      deviceIconsEl.style.display = 'none';
    }
  });
}

/**
 * 디바이스 아이콘 업데이트 (Bluetooth Coach 전용)
 */
function updateBluetoothCoachDeviceIcons(powerMeterId, deviceData) {
  const deviceIconsEl = document.getElementById(`device-icons-${powerMeterId}`);
  if (!deviceIconsEl) return;
  
  const icons = [];
  
  // 심박계 아이콘
  if (deviceData?.heartRateId) {
    icons.push('<img src="assets/img/bpm_g.png" alt="심박계" class="device-icon-with-bg" title="심박계" style="width: 16px; height: 16px;" />');
  }
  
  // 스마트 트레이너 아이콘
  if (deviceData?.smartTrainerId) {
    icons.push('<img src="assets/img/trainer_g.png" alt="스마트트레이너" class="device-icon-with-bg" title="스마트트레이너" style="width: 16px; height: 16px;" />');
  }
  
  // 파워메터 아이콘
  if (deviceData?.powerMeterId) {
    icons.push('<img src="assets/img/power_g.png" alt="파워메터" class="device-icon-with-bg" title="파워메터" style="width: 16px; height: 16px;" />');
  }
  
  deviceIconsEl.innerHTML = icons.join('');
}

/**
 * 파워미터 바늘 궤적 업데이트 (Indoor Training의 updatePowerMeterTrail 참고)
 */
function updateBluetoothCoachPowerMeterTrail(powerMeterId, currentPower, currentAngle, powerMeter) {
  const trailContainer = document.getElementById(`needle-path-${powerMeterId}`);
  const targetTextEl = document.getElementById(`target-power-value-${powerMeterId}`);
  
  // 컨테이너가 없거나 연결되지 않은 경우 초기화 후 종료
  if (!trailContainer) return;
  if (!powerMeter.connected) {
    trailContainer.innerHTML = '';
    if (targetTextEl) targetTextEl.textContent = '';
    return;
  }

  // 1. 기본 설정값 로드
  const ftp = powerMeter.userFTP || 200;
  const maxPower = ftp * 2; // 게이지 최대값 (FTP의 200%)
  
  // 2. 훈련 상태 확인
  const isTrainingRunning = window.bluetoothCoachState && window.bluetoothCoachState.trainingState === 'running';
  
  // 3. 목표 파워 및 랩파워 데이터 준비 (워크아웃 중일 때만 유효)
  let targetPower = 0;
  let segmentPower = 0;
  
  // [방어 로직 2] currentWorkout이 없어도 에러 없이 기본값 사용
  const hasWorkout = window.bluetoothCoachState && 
                     window.bluetoothCoachState.currentWorkout && 
                     window.bluetoothCoachState.currentWorkout.segments &&
                     Array.isArray(window.bluetoothCoachState.currentWorkout.segments) &&
                     window.bluetoothCoachState.currentWorkout.segments.length > 0;
  
  if (hasWorkout) {
    const segments = window.bluetoothCoachState.currentWorkout.segments;
    const currentSegmentIndex = window.bluetoothCoachState.currentSegmentIndex || 0;
    const currentSegment = segments[currentSegmentIndex] || segments[0]; 
    
    // 목표 파워 및 RPM 계산
    if (currentSegment) {
      const targetType = currentSegment.target_type || 'ftp_pct';
      let ftpPercent = 100; // 기본값
      const targetValue = currentSegment.target_value || currentSegment.target || '100';
      
      if (targetType === 'cadence_rpm') {
        // cadence_rpm 타입: target_value가 RPM 값
        targetPower = 0; // RPM만 있는 경우 파워는 0
      } else if (targetType === 'dual') {
        // dual 타입: target_value는 "100/120" 형식 (앞값: ftp%, 뒤값: rpm)
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
          const parts = targetValue.split('/').map(s => s.trim());
          ftpPercent = Number(parts[0].replace('%', '')) || 100;
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
          ftpPercent = Number(targetValue[0]) || 100;
        } else {
          ftpPercent = Number(targetValue) || 100;
        }
        targetPower = (ftp * ftpPercent) / 100;
      } else {
        // ftp_pct 타입
        if (typeof targetValue === 'string') {
          if (targetValue.includes('/')) {
            ftpPercent = Number(targetValue.split('/')[0].trim().replace('%', '')) || 100;
          } else {
            ftpPercent = Number(targetValue.replace('%', '')) || 100;
          }
        } else if (typeof targetValue === 'number') {
          ftpPercent = targetValue;
        }
        targetPower = (ftp * ftpPercent) / 100;
      }
    }
    
    // 현재 랩파워 (Segment Average Power) 가져오기
    segmentPower = powerMeter.segmentPower || 0;
  } else {
    // [방어 로직] currentWorkout이 없으면 기본값 사용 (에러 없이 계속 진행)
    targetPower = 0;
    segmentPower = 0;
    // 로그는 너무 많이 출력되지 않도록 주석 처리 (필요시 활성화)
    // console.log(`[Bluetooth Coach] currentWorkout이 없어 기본값 사용 (트랙 ${powerMeter.id})`);
  }
  
  // 목표 파워 텍스트 업데이트
  if (targetTextEl) {
    if (isTrainingRunning && targetPower > 0) {
      targetTextEl.textContent = Math.round(targetPower);
      targetTextEl.setAttribute('fill', '#ff8c00'); // 주황색
    } else {
      targetTextEl.textContent = '';
    }
  }
  
  // 목표 각도 계산 (주황색 아크 표시용)
  let targetAngle = -90;
  if (maxPower > 0 && targetPower > 0) {
    const targetRatio = Math.min(Math.max(targetPower / maxPower, 0), 1);
    targetAngle = -90 + (targetRatio * 180);
  }
  
  // 파워미터 객체에 목표값 저장 (참조용)
  powerMeter.targetPower = targetPower;

  // 4. 그리기 함수 호출 (핵심 로직)
  drawBluetoothCoachPowerMeterTrail(
    trailContainer, 
    targetAngle, 
    targetPower, 
    currentPower, 
    segmentPower,
    maxPower,
    isTrainingRunning
  );
}

/**
 * 파워미터 바늘 궤적 그리기 (SVG) - Indoor Training의 drawPowerMeterTrail 참고
 * 1. 목표 파워 원둘레선: 진한 투명 주황색 (두께 = 작은 눈금 높이)
 * 2. 바늘 궤적선: 98.5% 달성률 기준 민트/주황 분기
 * 3. 동작 방식: 바늘 위치(Value)에 따라 즉시 생성/삭제 (잔상 없음)
 */
function drawBluetoothCoachPowerMeterTrail(container, targetAngle, targetPower, currentPower, segmentPower, maxPower, isTrainingRunning) {
  // [방어 로직 3] container가 없으면 에러 방지
  if (!container) {
    console.warn('[Bluetooth Coach] drawBluetoothCoachPowerMeterTrail: container가 없습니다.');
    return;
  }
  
  // [핵심] 매 프레임 초기화로 잔상 완벽 제거
  container.innerHTML = '';
  
  // [방어 로직 4] currentWorkout이 없어도 기본 눈금만 그리기 (에러 없이 계속 진행)
  // segments 데이터가 없어도 기본 UI는 유지됨
  
  const centerX = 0; 
  const centerY = 0;
  const radius = 80; 
  const innerRadius = radius - 10; // 70
  const tickLengthShort = 7;       // 작은 눈금 높이
  const tickLengthLong = 14; 
  const centerCircleRadius = 7; 
  
  const angleOffset = 270;
  const startAngleNeedle = -90; 

  // =========================================================
  // A. 목표 파워 궤적 (원둘레 호) - 주황색띠
  // - 색상: 진한 투명 주황색 (rgba 255, 165, 0, 0.6)
  // - 두께: 작은 눈금 높이 (7px)
  // =========================================================
  if (targetPower > 0) {
    const targetPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    const startAng = startAngleNeedle;
    const endAng = targetAngle;
    
    const startRad = ((startAng + angleOffset) * Math.PI) / 180;
    const endRad = ((endAng + angleOffset) * Math.PI) / 180;
    
    // [수정] 호가 눈금의 중앙을 지나도록 반지름 조정
    // 눈금 범위: 70 ~ 77. 중앙: 73.5
    const arcRadius = innerRadius + (tickLengthShort / 2);
    
    const startX = centerX + arcRadius * Math.cos(startRad);
    const startY = centerY + arcRadius * Math.sin(startRad);
    const endX = centerX + arcRadius * Math.cos(endRad);
    const endY = centerY + arcRadius * Math.sin(endRad);
    
    const largeArcFlag = Math.abs(endAng - startAng) > 180 ? 1 : 0;
    const sweepFlag = endAng > startAng ? 1 : 0;
    
    const pathData = `M ${startX} ${startY} A ${arcRadius} ${arcRadius} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;
    
    targetPath.setAttribute('d', pathData);
    targetPath.setAttribute('fill', 'none');
    // [요청 반영] 진한 투명 주황색
    targetPath.setAttribute('stroke', 'rgba(255, 165, 0, 0.6)'); 
    // [요청 반영] 두께는 작은 눈금 높이(7px)
    targetPath.setAttribute('stroke-width', tickLengthShort); 
    targetPath.setAttribute('stroke-linecap', 'butt');
    
    container.appendChild(targetPath);
  }

  // =========================================================
  // B. 바늘 궤적선 (Radial Lines)
  // - 색상: 98.5% 기준 민트/주황 (단, 시작 전에는 무조건 민트)
  // - 로직: 현재 파워값까지만 루프를 돌아 자동 삭제 효과 구현
  // =========================================================
  
  // 기본 색상: 투명 주황색
  let trailColor = 'rgba(255, 165, 0, 0.4)'; 

  if (!isTrainingRunning) {
    // 1. 워크아웃 시작 전(Idle): 무조건 투명 민트색
    trailColor = 'rgba(0, 212, 170, 0.4)'; 
  } else if (targetPower > 0) {
    // 2. 훈련 중: 달성률 확인
    const achievementRatio = (segmentPower / targetPower) * 100;
    if (achievementRatio >= 98.5) {
      trailColor = 'rgba(0, 212, 170, 0.4)'; // 98.5% 이상: 투명 민트
    } else {
      trailColor = 'rgba(255, 165, 0, 0.4)'; // 98.5% 미만: 투명 주황
    }
  } else {
    // 3. 훈련 중이지만 목표가 없는 경우 (자유 주행): 민트색 (성공으로 간주)
    trailColor = 'rgba(0, 212, 170, 0.4)';
  }

  // 스케일 설정 (0 ~ 120)
  const maxScalePos = 120; 
  const tickInterval = 2.5; // 눈금 1/2 간격
  
  // 현재 파워를 스케일(0~120)로 변환
  let currentScalePos = 0;
  if (maxPower > 0) {
    currentScalePos = (currentPower / maxPower) * maxScalePos;
  }
  
  // [핵심 로직] 현재 파워 위치까지만 루프 실행
  // currentScalePos를 넘는 구간은 for문이 돌지 않으므로 자동으로 삭제됨
  const limitPos = Math.min(currentScalePos, maxScalePos);

  for (let pos = 0; pos <= limitPos; pos += tickInterval) {
    // 위치 -> 각도 변환
    const ratio = pos / maxScalePos;
    const needleAngle = -90 + (ratio * 180);
    
    // SVG 좌표계 변환
    const mathAngle = needleAngle + 270;
    const rad = (mathAngle * Math.PI) / 180;
    
    // 20단위마다 긴 눈금
    const isMajor = (Math.abs(pos % 20) < 0.01);
    const tickLen = isMajor ? tickLengthLong : tickLengthShort;
    
    const outerRadius = innerRadius + tickLen;
    const startR = centerCircleRadius + 2; 
    
    const x1 = centerX + startR * Math.cos(rad);
    const y1 = centerY + startR * Math.sin(rad);
    const x2 = centerX + outerRadius * Math.cos(rad);
    const y2 = centerY + outerRadius * Math.sin(rad);
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', trailColor);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linecap', 'round');
    
    container.appendChild(line);
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
    userNameEl.style.display = 'none';
  }
  
  updatePowerMeterUI(trackId);
  
  // 연결 상태 표시 업데이트
  updateBluetoothCoachConnectionStatus(trackId);
}

/**
 * 파워계 눈금 업데이트 (FTP 변경 시) - Bluetooth Coach 전용
 */
function updateBluetoothCoachPowerMeterTicks(powerMeterId) {
  const powerMeter = window.bluetoothCoachState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const ticksEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-ticks`);
  const labelsEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-labels`);
  
  if (!ticksEl || !labelsEl) return;
  
  ticksEl.innerHTML = generateBluetoothCoachPowerMeterTicks(powerMeterId);
  labelsEl.innerHTML = generateBluetoothCoachPowerMeterLabels(powerMeterId);
  
  // 바늘이 항상 표시되도록 보장
  ensureNeedleVisible(powerMeterId);
  
  // 바늘 위치 복원
  const needleEl = document.getElementById(`needle-${powerMeterId}`);
  if (needleEl && typeof updatePowerMeterNeedle === 'function') {
    updatePowerMeterNeedle(powerMeterId, powerMeter.currentPower || 0);
  } else if (needleEl) {
    // updatePowerMeterNeedle이 없을 경우 직접 업데이트
    const gaugeMaxPower = powerMeter.userFTP ? powerMeter.userFTP * 1.5 : 300;
    const currentPower = powerMeter.currentPower || 0;
    const ratio = Math.min(Math.max(currentPower / gaugeMaxPower, 0), 1);
    const angle = -90 + (ratio * 180);
    needleEl.setAttribute('transform', `rotate(${angle} 0 0)`);
  }
}

/**
 * 훈련 상태 업데이트 (Firebase status 구독)
 */
function updateTrainingStatus(status) {
  // 워크아웃이 선택되지 않았거나 시작되지 않았으면 상태를 'idle'로 강제 설정
  const currentWorkout = window.bluetoothCoachState && window.bluetoothCoachState.currentWorkout;
  const hasWorkout = currentWorkout && (
    (currentWorkout.segments && Array.isArray(currentWorkout.segments) && currentWorkout.segments.length > 0) ||
    (currentWorkout.id && currentWorkout.title)
  );
  const firebaseState = status.state || 'idle';
  
  // Firebase 상태가 'running'이어도 워크아웃이 없으면 'idle'로 설정
  if (firebaseState === 'running' && !hasWorkout) {
    console.log('[Bluetooth Coach] Firebase 상태가 running이지만 워크아웃이 선택되지 않아 idle로 설정', {
      hasCurrentWorkout: !!currentWorkout,
      hasSegments: !!(currentWorkout && currentWorkout.segments),
      segmentsLength: currentWorkout && currentWorkout.segments ? currentWorkout.segments.length : 0
    });
    window.bluetoothCoachState.trainingState = 'idle';
  } else {
    window.bluetoothCoachState.trainingState = firebaseState;
  }
  
  const prevSegmentIndex = window.bluetoothCoachState.currentSegmentIndex || 0;
  window.bluetoothCoachState.currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : 0;
  
  // 세그먼트 인덱스가 변경되었거나 경과시간이 업데이트되면 세그먼트 정보도 업데이트
  const segmentIndexChanged = prevSegmentIndex !== window.bluetoothCoachState.currentSegmentIndex;
  
  // 경과시간 업데이트 (워크아웃이 있을 때만)
  if (status.elapsedTime !== undefined && hasWorkout) {
    window.bluetoothCoachState.totalElapsedTime = status.elapsedTime || 0;
    updateScoreboard();
  } else if (!hasWorkout) {
    // 워크아웃이 없으면 경과시간 초기화
    window.bluetoothCoachState.totalElapsedTime = 0;
    updateScoreboard();
  } else if (segmentIndexChanged) {
    // 세그먼트 인덱스만 변경된 경우에도 세그먼트 정보 업데이트
    updateCurrentSegmentInfo();
  }
  
  // 랩카운트다운 업데이트 (워크아웃이 있을 때만)
  if (status.lapCountdown !== undefined && hasWorkout) {
    const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (countdownEl) {
      const minutes = Math.floor(status.lapCountdown / 60);
      const seconds = Math.floor(status.lapCountdown % 60);
      countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  } else if (!hasWorkout) {
    // 워크아웃이 없으면 카운트다운 초기화
    const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (countdownEl) {
      countdownEl.textContent = '00:00';
    }
  }
  
  // 모든 세그먼트 완료 감지 및 Firebase status 업데이트 (Bluetooth Coach 전용)
  if (hasWorkout && firebaseState === 'running' && currentWorkout.segments) {
    const totalSegments = currentWorkout.segments.length;
    const currentSegmentIdx = window.bluetoothCoachState.currentSegmentIndex || 0;
    const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
    
    // 모든 세그먼트가 완료되었는지 확인
    // 1. 현재 세그먼트 인덱스가 마지막 세그먼트를 넘었거나
    // 2. 마지막 세그먼트이고 남은 시간이 0 이하인 경우
    const isAllSegmentsComplete = currentSegmentIdx > lastSegmentIndex || 
                                   (currentSegmentIdx === lastSegmentIndex && 
                                    status.segmentRemainingSec !== undefined && 
                                    status.segmentRemainingSec !== null && 
                                    status.segmentRemainingSec <= 0);
    
    if (isAllSegmentsComplete && window.bluetoothCoachState.trainingState === 'running') {
      console.log('[Bluetooth Coach] 모든 세그먼트 완료 감지 - Firebase status 업데이트', {
        currentSegmentIdx,
        lastSegmentIndex,
        totalSegments,
        segmentRemainingSec: status.segmentRemainingSec
      });
      const sessionId = getBluetoothCoachSessionId();
      if (sessionId && typeof db !== 'undefined') {
        db.ref(`sessions/${sessionId}/status`).update({
          state: 'finished',
          completionMessage: '모든 세그먼트 훈련이 완료되었습니다.',
          completedAt: Date.now()
        }).then(() => {
          console.log('[Bluetooth Coach] Firebase status 업데이트 완료: finished');
          // 로컬 상태도 업데이트
          window.bluetoothCoachState.trainingState = 'finished';
        }).catch((error) => {
          console.error('[Bluetooth Coach] Firebase status 업데이트 실패:', error);
        });
      }
    }
  }
  
  // 버튼 상태 업데이트
  updateBluetoothCoachTrainingButtons();
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
  
  // 현재 세그먼트 정보 업데이트
  updateCurrentSegmentInfo();
}

/**
 * 현재 세그먼트 정보 업데이트 (제목 라인 중앙에 표시)
 */
function updateCurrentSegmentInfo() {
  const segmentInfoEl = document.getElementById('bluetoothCoachCurrentSegmentInfo');
  if (!segmentInfoEl) return;
  
  const currentWorkout = window.bluetoothCoachState.currentWorkout;
  const currentSegmentIndex = window.bluetoothCoachState.currentSegmentIndex || 0;
  
  // 워크아웃이 없거나 세그먼트가 없으면 숨김
  if (!currentWorkout || !currentWorkout.segments || currentWorkout.segments.length === 0) {
    segmentInfoEl.textContent = '';
    segmentInfoEl.style.display = 'none';
    return;
  }
  
  const currentSegment = currentWorkout.segments[currentSegmentIndex];
  if (!currentSegment) {
    segmentInfoEl.textContent = '';
    segmentInfoEl.style.display = 'none';
    return;
  }
  
  // 세그먼트 label 가져오기
  const segmentLabel = currentSegment.label || currentSegment.segment_type || '세그먼트';
  
  // 세그먼트 duration 계산 (분 단위)
  let durationSec = 0;
  if (typeof currentSegment.duration_sec === 'number') {
    durationSec = Math.max(0, Math.floor(currentSegment.duration_sec));
  } else if (typeof currentSegment.duration === 'number') {
    durationSec = Math.max(0, Math.floor(currentSegment.duration));
  }
  const durationMinutes = Math.floor(durationSec / 60);
  const durationText = durationMinutes > 0 ? `(${durationMinutes}분)` : '';
  
  // target_type과 target_value에 따라 표시 형식 결정
  const targetType = currentSegment.target_type || 'ftp_pct';
  const targetValue = currentSegment.target_value || currentSegment.target || '100';
  
  let segmentInfoText = '';
  
  if (targetType === 'ftp_pct') {
    // ftp_pct: label "FTP" target_value % (10분)
    // 예: "Main FTP 80% (10분)"
    const ftpPercent = typeof targetValue === 'number' ? targetValue : 
                       (typeof targetValue === 'string' ? parseFloat(targetValue.replace('%', '').trim()) : 100);
    segmentInfoText = `${segmentLabel} FTP ${Math.round(ftpPercent)}% ${durationText}`;
  } else if (targetType === 'cadence_rpm') {
    // cadence_rpm: label "RPM " target_value (10분)
    // 예: "Main RPM 95 (10분)"
    const rpm = typeof targetValue === 'number' ? targetValue : 
                (typeof targetValue === 'string' ? parseFloat(targetValue.trim()) : 0);
    segmentInfoText = `${segmentLabel} RPM ${Math.round(rpm)} ${durationText}`;
  } else if (targetType === 'dual') {
    // dual: label "FTP" target_value1 %, "RPM" target_value2 (10분)
    // 예: "Main FTP 80%, RPM 95 (10분)"
    // dual target_value: "target_value1/target_value2" 형식으로 구분
    let ftpPercent = 100;
    let rpm = 0;
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      // "100/120" 형식 (target_value1/target_value2)
      const parts = targetValue.split('/').map(s => s.trim());
      ftpPercent = parseFloat(parts[0].replace('%', '').trim()) || 100;
      rpm = parseFloat(parts[1].trim()) || 0;
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      // 배열 형식 [100, 120]
      ftpPercent = parseFloat(targetValue[0]) || 100;
      rpm = parseFloat(targetValue[1]) || 0;
    } else {
      // 단일 값인 경우 (기본값)
      ftpPercent = parseFloat(targetValue) || 100;
    }
    
    segmentInfoText = `${segmentLabel} FTP ${Math.round(ftpPercent)}%, RPM ${Math.round(rpm)} ${durationText}`;
  } else {
    // 기본 형식: "세그먼트 이름 (10분)"
    segmentInfoText = `${segmentLabel} ${durationText}`;
  }
  
  // 폰트 사이즈 설정 (제목 폰트 사이즈의 70% = 36px * 0.7 = 25.2px)
  segmentInfoEl.style.fontSize = '25.2px';
  segmentInfoText = segmentInfoText.trim();
  segmentInfoEl.textContent = segmentInfoText;
  segmentInfoEl.style.display = 'block';
  
  // 디버깅 로그
  console.log('[Bluetooth Coach] 세그먼트 정보 업데이트:', {
    label: segmentLabel,
    targetType: targetType,
    targetValue: targetValue,
    durationText: durationText,
    result: segmentInfoText
  });
}

/**
 * 워크아웃 세그먼트 그래프 표시 (Indoor Training의 displayWorkoutSegmentGraph 로직을 Bluetooth Coach용으로 수정)
 * @param {Object} workout - 워크아웃 객체
 * @param {number} currentSegmentIndex - 현재 세그먼트 인덱스 (-1이면 선택 안됨)
 */
function updateWorkoutSegmentGraphForBluetoothCoach(workout, currentSegmentIndex = -1) {
  const container = document.getElementById('bluetoothCoachSegmentGraphContainer');
  if (!container) {
    console.warn('[Bluetooth Coach] 세그먼트 그래프 컨테이너를 찾을 수 없습니다.');
    return;
  }
  
  // 세그먼트가 있는 경우에만 표시 (workout이 null이거나 segments가 없으면 숨김)
  if (!workout) {
    console.warn('[Bluetooth Coach] 워크아웃이 없어서 세그먼트 그래프를 숨깁니다.');
    container.style.display = 'none';
    return;
  }
  
  if (!workout.segments || workout.segments.length === 0) {
    console.warn('[Bluetooth Coach] 세그먼트가 없어서 세그먼트 그래프를 숨깁니다.');
    container.style.display = 'none';
    return;
  }
  
  // 세그먼트가 있으면 표시
  container.style.display = 'block';
  
  // 세그먼트 그래프 그리기 (전광판 크기에 맞춤 - 랩카운트다운과 겹치지 않는 최대 크기)
  setTimeout(() => {
    const canvas = document.getElementById('bluetoothCoachSegmentGraphCanvas');
    if (!canvas) {
      console.warn('[Bluetooth Coach] 세그먼트 그래프 캔버스를 찾을 수 없습니다.');
      return;
    }
    
    // 전광판 컨테이너 크기 확인
    const scoreboardContainer = container.closest('.scoreboard-display');
    if (!scoreboardContainer) {
      console.warn('[Bluetooth Coach] 전광판 컨테이너를 찾을 수 없습니다.');
      return;
    }
    
    // 전광판의 초기 높이를 저장 (세그먼트 그래프가 높이에 영향을 주지 않도록)
    if (!scoreboardContainer.dataset.initialHeight) {
      // 세그먼트 그래프를 숨긴 상태에서 초기 높이 측정
      const originalDisplay = container.style.display;
      container.style.display = 'none';
      const initialRect = scoreboardContainer.getBoundingClientRect();
      scoreboardContainer.dataset.initialHeight = initialRect.height.toString();
      container.style.display = originalDisplay;
    }
    
    const scoreboardRect = scoreboardContainer.getBoundingClientRect();
    const scoreboardWidth = scoreboardRect.width;
    // 초기 높이를 사용하여 세그먼트 그래프가 전광판 높이에 영향을 주지 않도록 함
    const scoreboardHeight = parseFloat(scoreboardContainer.dataset.initialHeight) || scoreboardRect.height;
    
    // 세그먼트 그래프 크기: 전광판 가로 길이의 1/3 범위에서 최대로 채우기
    const targetWidthRatio = 1 / 3; // 전광판 가로 길이의 1/3
    const marginFromRight = 20; // 전광판 오른쪽 끝과의 여백
    const calculatedMaxWidth = scoreboardWidth * targetWidthRatio - marginFromRight;
    const maxWidth = Math.max(250, calculatedMaxWidth); // 최소 250px 보장
    
    // 전광판 높이를 넘지 않는 최대 높이 계산
    const marginFromTop = 10; // 상단 여백
    const marginFromBottom = 10; // 하단 여백
    const availableHeight = scoreboardHeight - marginFromTop - marginFromBottom;
    const maxHeight = Math.max(120, Math.min(availableHeight, scoreboardHeight - 20)); // 최소 120px, 최대는 전광판 높이 - 20px
    
    // 컨테이너 크기 설정 (전광판 높이를 절대 넘지 않도록)
    container.style.width = `${maxWidth}px`;
    container.style.maxWidth = `${maxWidth}px`;
    container.style.height = `${maxHeight}px`;
    container.style.maxHeight = `${maxHeight}px`;
    container.style.overflow = 'hidden'; // 넘치는 내용 숨김
    container.style.flexShrink = '0'; // 축소 방지
    container.style.flexGrow = '0'; // 확장 방지
    container.style.alignSelf = 'stretch'; // 전광판 높이에 맞춤
    
    // 내부 그래프 컨테이너도 높이 제한
    const graphContainer = container.querySelector('.scoreboard-segment-graph-container');
    if (graphContainer) {
      graphContainer.style.height = `${maxHeight}px`;
      graphContainer.style.maxHeight = `${maxHeight}px`;
      graphContainer.style.overflow = 'hidden';
      graphContainer.style.flexShrink = '0'; // 축소 방지
    }
    
    // 세그먼트 그래프를 전광판 크기에 맞춰 그리기 (현재 세그먼트 인덱스 전달)
    // drawSegmentGraphForScoreboard 함수는 window.indoorTrainingState를 참조하므로
    // Bluetooth Coach용으로 별도 함수를 만들거나, drawSegmentGraph를 사용
    if (typeof drawSegmentGraphForScoreboard === 'function') {
      // 임시로 window.indoorTrainingState를 window.bluetoothCoachState로 교체하여 사용
      // 단, window.trainingState는 절대 건드리지 않음 (Indoor Training과 분리)
      const originalIndoorState = window.indoorTrainingState;
      window.indoorTrainingState = window.bluetoothCoachState;
      
      try {
        drawSegmentGraphForScoreboard(workout.segments, currentSegmentIndex, 'bluetoothCoachSegmentGraphCanvas', maxWidth, maxHeight);
      } finally {
        // 원래 상태 복원 (Indoor Training에 영향 없도록)
        if (originalIndoorState !== undefined) {
          window.indoorTrainingState = originalIndoorState;
        } else {
          delete window.indoorTrainingState;
        }
      }
    } else if (typeof drawSegmentGraph === 'function') {
      // 기본 drawSegmentGraph 함수 사용하되, canvas 크기를 제한
      // 경과시간 전달하여 마스코트 위치 계산
      const elapsedTime = window.bluetoothCoachState.totalElapsedTime || 0;
      drawSegmentGraph(workout.segments, currentSegmentIndex, 'bluetoothCoachSegmentGraphCanvas', elapsedTime);
      
      // Canvas 크기를 전광판에 맞게 조정
      canvas.style.maxWidth = `${maxWidth}px`;
      canvas.style.maxHeight = `${maxHeight}px`;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
    } else {
      console.warn('[Bluetooth Coach] drawSegmentGraph 함수를 찾을 수 없습니다.');
    }
  }, 100);
}

/**
 * 워크아웃 세그먼트 그래프 업데이트 (기존 함수 호출용 래퍼)
 */
function updateWorkoutSegmentGraph() {
  const workout = window.bluetoothCoachState.currentWorkout;
  const currentSegmentIndex = window.bluetoothCoachState.currentSegmentIndex || -1;
  
  if (workout) {
    updateWorkoutSegmentGraphForBluetoothCoach(workout, currentSegmentIndex);
  }
}

/**
 * 컨트롤 버튼 이벤트 설정
 */
function setupControlButtons() {
  console.log('🎮 [진단] setupControlButtons 함수 호출됨');
  
  // 워크아웃 선택 버튼은 이미 HTML에서 onclick으로 연결됨
  
  // 건너뛰기 버튼
  const skipBtn = document.getElementById('btnSkipSegmentBluetoothCoach');
  if (skipBtn) {
    // 기존 이벤트 리스너 제거 후 추가 (중복 방지)
    skipBtn.replaceWith(skipBtn.cloneNode(true));
    const newSkipBtn = document.getElementById('btnSkipSegmentBluetoothCoach');
    if (newSkipBtn) {
      newSkipBtn.addEventListener('click', () => {
        console.log('🎮 [진단] 건너뛰기 버튼 클릭됨');
        if (typeof skipCurrentBluetoothCoachSegmentTraining === 'function') {
          skipCurrentBluetoothCoachSegmentTraining();
        } else {
          console.error('🎮 [진단/Error] skipCurrentBluetoothCoachSegmentTraining 함수가 없습니다!');
        }
      });
      console.log('🎮 [진단] 건너뛰기 버튼 이벤트 연결 완료');
    }
  } else {
    console.warn('🎮 [진단] btnSkipSegmentBluetoothCoach 버튼을 찾을 수 없습니다.');
  }
  
  // 일시정지/재생 버튼 (시작 버튼)
  const togglePauseBtn = document.getElementById('btnTogglePauseBluetoothCoach');
  if (togglePauseBtn) {
    // 기존 이벤트 리스너 제거 후 추가 (중복 방지)
    togglePauseBtn.replaceWith(togglePauseBtn.cloneNode(true));
    const newToggleBtn = document.getElementById('btnTogglePauseBluetoothCoach');
    if (newToggleBtn) {
      newToggleBtn.addEventListener('click', () => {
        console.log('🎮 [진단] 시작/일시정지 버튼 클릭됨');
        if (typeof toggleStartPauseBluetoothCoachTraining === 'function') {
          toggleStartPauseBluetoothCoachTraining();
        } else {
          console.error('🎮 [진단/Error] toggleStartPauseBluetoothCoachTraining 함수가 없습니다!');
        }
      });
      console.log('🎮 [진단] 시작/일시정지 버튼 이벤트 연결 완료');
    }
  } else {
    console.error('🎮 [진단/Error] btnTogglePauseBluetoothCoach 버튼을 찾을 수 없습니다!');
  }
  
  // 종료 버튼
  const stopBtn = document.getElementById('btnStopTrainingBluetoothCoach');
  if (stopBtn) {
    // 기존 이벤트 리스너 제거 후 추가 (중복 방지)
    stopBtn.replaceWith(stopBtn.cloneNode(true));
    const newStopBtn = document.getElementById('btnStopTrainingBluetoothCoach');
    if (newStopBtn) {
      newStopBtn.addEventListener('click', () => {
        console.log('🎮 [진단] 종료 버튼 클릭됨');
        if (typeof stopBluetoothCoachTraining === 'function') {
          stopBluetoothCoachTraining();
        } else {
          console.error('🎮 [진단/Error] stopBluetoothCoachTraining 함수가 없습니다!');
        }
      });
      console.log('🎮 [진단] 종료 버튼 이벤트 연결 완료');
    }
  } else {
    console.warn('🎮 [진단] btnStopTrainingBluetoothCoach 버튼을 찾을 수 없습니다.');
  }
  
  console.log('🎮 [진단] setupControlButtons 완료');
}

/**
 * Firebase에서 트랙 구성 업데이트
 */
window.updateBluetoothCoachTracksFromFirebase = async function updateBluetoothCoachTracksFromFirebase() {
  const config = await getTrackConfigFromFirebase();
  const newMaxTracks = config.maxTracks || 10;
  
  if (newMaxTracks !== window.bluetoothCoachState.maxTrackCount) {
    window.bluetoothCoachState.maxTrackCount = newMaxTracks;
    createBluetoothCoachPowerMeterGrid();
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
 * 트랙 개수 설정 (지정한 개수로 트랙 유지)
 */
window.addTracksToBluetoothCoach = async function addTracksToBluetoothCoach() {
  const inputEl = document.getElementById('addTrackCountInput');
  if (!inputEl) {
    console.error('[Bluetooth Coach] 트랙 개수 입력 필드를 찾을 수 없습니다.');
    return;
  }
  
  const targetTrackCount = parseInt(inputEl.value, 10);
  if (isNaN(targetTrackCount) || targetTrackCount < 1 || targetTrackCount > 50) {
    if (typeof showToast === 'function') {
      showToast('1~50 사이의 숫자를 입력해주세요.', 'error');
    }
    return;
  }
  
  const sessionId = getBluetoothCoachSessionId();
  if (!sessionId || typeof db === 'undefined') {
    if (typeof showToast === 'function') {
      showToast('세션 정보를 찾을 수 없습니다.', 'error');
    }
    return;
  }
  
  try {
    // 현재 트랙 개수 가져오기
    const currentMaxTracks = window.bluetoothCoachState.maxTrackCount || 10;
    
    // 목표 트랙 개수와 현재 트랙 개수 비교
    if (targetTrackCount === currentMaxTracks) {
      if (typeof showToast === 'function') {
        showToast(`이미 ${currentMaxTracks}개 트랙이 설정되어 있습니다.`, 'info');
      }
      return;
    }
    
    // Firebase devices DB에 track 값 저장 (지정한 개수로 설정)
    await db.ref(`sessions/${sessionId}/devices`).update({
      track: targetTrackCount
    });
    
    const changeType = targetTrackCount > currentMaxTracks ? '추가' : '삭제';
    const changeCount = Math.abs(targetTrackCount - currentMaxTracks);
    console.log(`[Bluetooth Coach] 트랙 개수 설정: ${currentMaxTracks} → ${targetTrackCount} (${changeCount}개 ${changeType})`);
    
    // 로컬 상태 업데이트
    window.bluetoothCoachState.maxTrackCount = targetTrackCount;
    
    // 트랙 그리드 완전히 재생성 (지정한 개수만큼만 생성)
    if (typeof createBluetoothCoachPowerMeterGrid === 'function') {
      createBluetoothCoachPowerMeterGrid();
    } else {
      // 폴백: 직접 그리드 재생성
      const gridEl = document.getElementById('bluetoothCoachPowerMeterGrid');
      if (gridEl) {
        gridEl.innerHTML = '';
        window.bluetoothCoachState.powerMeters = [];
        
        for (let i = 1; i <= targetTrackCount; i++) {
          const powerMeter = new PowerMeterData(i, `트랙${i}`);
          window.bluetoothCoachState.powerMeters.push(powerMeter);
          
          const element = createPowerMeterElement(powerMeter);
          if (element) {
            gridEl.appendChild(element);
          }
        }
        
        // 모든 트랙의 눈금 초기화
        for (let i = 1; i <= targetTrackCount; i++) {
          generateBluetoothCoachPowerMeterTicks(i);
          generateBluetoothCoachPowerMeterLabels(i);
          updatePowerMeterNeedle(i, 0);
        }
      }
    }
    
    // Firebase 구독 업데이트 (새 트랙 개수에 맞춰)
    if (typeof setupFirebaseSubscriptions === 'function') {
      setupFirebaseSubscriptions();
    }
    
    // 초과하는 트랙의 Firebase 데이터 삭제 (선택적 - 필요시 주석 해제)
    if (targetTrackCount < currentMaxTracks) {
      const deletePromises = [];
      for (let i = targetTrackCount + 1; i <= currentMaxTracks; i++) {
        // users 삭제
        deletePromises.push(db.ref(`sessions/${sessionId}/users/${i}`).remove());
        // devices 삭제 (track 필드는 devices 루트에 있으므로 개별 트랙 devices만 삭제)
        deletePromises.push(db.ref(`sessions/${sessionId}/devices/${i}`).remove());
      }
      await Promise.all(deletePromises);
      console.log(`[Bluetooth Coach] 초과 트랙(${targetTrackCount + 1}~${currentMaxTracks}) 데이터 삭제 완료`);
    }
    
    if (typeof showToast === 'function') {
      if (targetTrackCount > currentMaxTracks) {
        showToast(`${changeCount}개 트랙이 추가되었습니다. (총 ${targetTrackCount}개)`, 'success');
      } else {
        showToast(`${changeCount}개 트랙이 삭제되었습니다. (총 ${targetTrackCount}개)`, 'success');
      }
    }
    
    // 입력 필드 초기화
    inputEl.value = String(targetTrackCount);
    
  } catch (error) {
    console.error('[Bluetooth Coach] 트랙 설정 실패:', error);
    if (typeof showToast === 'function') {
      showToast('트랙 설정에 실패했습니다.', 'error');
    }
  }
};

/**
 * 워크아웃 선택 (Indoor Training의 selectWorkoutForTraining을 참고하여 Bluetooth Coach용으로 수정)
 */
async function selectWorkoutForBluetoothCoach(workoutId) {
  try {
    console.log('[Bluetooth Coach] 워크아웃 선택 시도:', workoutId);
    
    // 이전 선택 해제
    const allRows = document.querySelectorAll('.workout-selection-row');
    allRows.forEach(row => {
      row.classList.remove('selected');
    });
    
    // 현재 선택된 행에 선택 애니메이션 적용
    const selectedRow = document.querySelector(`.workout-selection-row[data-workout-id="${workoutId}"]`);
    if (selectedRow) {
      selectedRow.classList.add('selected');
      
      // 클릭 피드백 애니메이션
      selectedRow.style.transform = 'scale(0.98)';
      setTimeout(() => {
        selectedRow.style.transform = '';
      }, 150);
      
      // 워크아웃 업로드 애니메이션 시작
      selectedRow.classList.add('uploading');
      
      // 시간 컬럼에 로딩 스피너 표시
      const durationCell = selectedRow.querySelector('.workout-duration-cell');
      if (durationCell) {
        const originalDuration = durationCell.getAttribute('data-duration') || durationCell.textContent;
        durationCell.setAttribute('data-original-duration', originalDuration);
        durationCell.innerHTML = '<div class="workout-upload-spinner"></div>';
      }
    }
    
    // apiGetWorkout 함수 확인
    if (typeof apiGetWorkout !== 'function') {
      console.error('[Bluetooth Coach] apiGetWorkout 함수를 찾을 수 없습니다.');
      if (selectedRow) {
        selectedRow.classList.remove('selected', 'uploading');
        const durationCell = selectedRow.querySelector('.workout-duration-cell');
        if (durationCell) {
          const originalDuration = durationCell.getAttribute('data-original-duration') || durationCell.getAttribute('data-duration');
          if (originalDuration) {
            durationCell.innerHTML = originalDuration;
          }
        }
      }
      if (typeof showToast === 'function') {
        showToast('워크아웃 정보를 불러올 수 없습니다.', 'error');
      }
      return;
    }
    
    // 워크아웃 상세 정보 로드
    const workoutResult = await apiGetWorkout(workoutId);
    
    if (!workoutResult || !workoutResult.success) {
      if (selectedRow) {
        selectedRow.classList.remove('selected', 'uploading');
        const durationCell = selectedRow.querySelector('.workout-duration-cell');
        if (durationCell) {
          const originalDuration = durationCell.getAttribute('data-original-duration') || durationCell.getAttribute('data-duration');
          if (originalDuration) {
            durationCell.innerHTML = originalDuration;
          }
        }
      }
      return;
    }
    
    const loadedWorkout = workoutResult.workout || workoutResult.item;
    
    if (!loadedWorkout) {
      console.error('[Bluetooth Coach] workout 데이터가 없습니다.');
      if (selectedRow) {
        selectedRow.classList.remove('selected', 'uploading');
        const durationCell = selectedRow.querySelector('.workout-duration-cell');
        if (durationCell) {
          const originalDuration = durationCell.getAttribute('data-original-duration') || durationCell.getAttribute('data-duration');
          if (originalDuration) {
            durationCell.innerHTML = originalDuration;
          }
        }
      }
      if (typeof showToast === 'function') {
        showToast('워크아웃 정보를 불러올 수 없습니다.', 'error');
      }
      return;
    }
    
    console.log('[Bluetooth Coach] 선택된 워크아웃:', {
      id: loadedWorkout.id,
      title: loadedWorkout.title,
      segmentsCount: loadedWorkout.segments ? loadedWorkout.segments.length : 0
    });
    
    // 선택된 워크아웃 저장 (Bluetooth Coach State만 사용, window.currentWorkout은 덮어쓰지 않음)
    window.bluetoothCoachState.currentWorkout = loadedWorkout;
    // 주의: window.currentWorkout은 Indoor Training에서 사용하므로 덮어쓰지 않음
    // Bluetooth Coach는 window.bluetoothCoachState.currentWorkout만 사용
    
    console.log('🎮 [진단] 워크아웃 선택 완료:', {
      id: loadedWorkout.id,
      title: loadedWorkout.title,
      segmentsCount: loadedWorkout.segments ? loadedWorkout.segments.length : 0,
      storedIn: 'bluetoothCoachState.currentWorkout'
    });
    
    // 버튼 상태 업데이트 (워크아웃 선택 후 시작 버튼 활성화)
    if (typeof updateBluetoothCoachTrainingButtons === 'function') {
      updateBluetoothCoachTrainingButtons();
      console.log('🎮 [진단] 버튼 상태 업데이트 완료');
    }
    
    // Firebase에 workoutPlan 및 workoutId 저장
    if (loadedWorkout.segments && loadedWorkout.segments.length > 0 && typeof db !== 'undefined') {
      const sessionId = getBluetoothCoachSessionId();
      if (sessionId) {
        // workoutPlan 저장 (세그먼트 배열)
        db.ref(`sessions/${sessionId}/workoutPlan`).set(loadedWorkout.segments)
          .then(() => {
            console.log('[Bluetooth Coach] 워크아웃 선택 시 workoutPlan Firebase 저장 완료:', sessionId);
          })
          .catch(error => {
            console.error('[Bluetooth Coach] 워크아웃 선택 시 workoutPlan Firebase 저장 실패:', error);
          });
        
        // workoutId 저장
        if (loadedWorkout.id) {
          db.ref(`sessions/${sessionId}/workoutId`).set(loadedWorkout.id)
            .then(() => {
              console.log('[Bluetooth Coach] 워크아웃 선택 시 workoutId Firebase 저장 완료:', loadedWorkout.id, sessionId);
            })
            .catch(error => {
              console.error('[Bluetooth Coach] 워크아웃 선택 시 workoutId Firebase 저장 실패:', error);
            });
        }
        
        // Firebase status에 idle 상태 저장 (워크아웃 선택 시, 사용자 접속 시 현재 상황 바로 반영)
        db.ref(`sessions/${sessionId}/status`).update({
          state: 'idle',
          segmentIndex: 0,
          elapsedTime: 0,
          countdownRemainingSec: null
        }).then(() => {
          console.log('[Bluetooth Coach] 워크아웃 선택 시 Firebase status 업데이트 완료: idle');
        }).catch(error => {
          console.error('[Bluetooth Coach] 워크아웃 선택 시 Firebase status 업데이트 실패:', error);
        });
      }
    }
    
    // 모달 닫기
    if (typeof closeWorkoutSelectionModal === 'function') {
      closeWorkoutSelectionModal();
    }
    
    // 업로드 애니메이션 제거
    if (selectedRow) {
      selectedRow.classList.remove('uploading');
      selectedRow.classList.add('upload-complete');
      setTimeout(() => {
        selectedRow.classList.remove('upload-complete');
      }, 500);
    }
    
    // 전광판 우측에 세그먼트 그래프 표시 (Indoor Training과 동일한 방식)
    // 워크아웃 선택 시에는 현재 세그먼트 없음 (-1)
    updateWorkoutSegmentGraphForBluetoothCoach(loadedWorkout, -1);
    
    // 워크아웃 선택 시 경과시간, 랩카운트다운, 랩파워 등 초기화
    window.bluetoothCoachState.trainingState = 'idle';
    window.bluetoothCoachState.startTime = null;
    window.bluetoothCoachState.pausedTime = 0;
    window.bluetoothCoachState.totalElapsedTime = 0;
    window.bluetoothCoachState.currentSegmentIndex = 0;
    window.bluetoothCoachState.segmentStartTime = null;
    window.bluetoothCoachState.segmentElapsedTime = 0;
    window.bluetoothCoachState.segmentCountdownActive = false;
    
    // 경과시간 및 랩카운트다운 UI 초기화
    const elapsedTimeEl = document.getElementById('bluetoothCoachElapsedTime');
    if (elapsedTimeEl) {
      elapsedTimeEl.textContent = '00:00:00';
    }
    
    // 세그먼트 정보 업데이트 (워크아웃 선택 시 첫 번째 세그먼트 표시)
    updateCurrentSegmentInfo();
    const lapCountdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (lapCountdownEl) {
      lapCountdownEl.textContent = '00:00';
    }
    
    // 모든 트랙의 랩파워 및 통계 초기화
    window.bluetoothCoachState.powerMeters.forEach(pm => {
      // 랩파워 초기화
      pm.segmentPower = 0;
      pm.segmentPowerSum = 0;
      pm.segmentPowerCount = 0;
      
      // 궤적 초기화
      pm.powerTrailHistory = [];
      pm.lastTrailAngle = null;
      const trailContainer = document.getElementById(`needle-path-${pm.id}`);
      if (trailContainer) trailContainer.innerHTML = '';
      
      // 목표 파워 초기화
      pm.targetPower = 0;
      const targetPowerEl = document.getElementById(`target-power-value-${pm.id}`);
      if (targetPowerEl) targetPowerEl.textContent = '';
      
      // 랩파워 UI 초기화
      const segmentPowerEl = document.getElementById(`segment-power-value-${pm.id}`);
      if (segmentPowerEl) segmentPowerEl.textContent = '0';
      
      // FTP 값이 있으면 속도계 눈금 업데이트 (워크아웃 선택 시에도 반영)
      if (pm.userFTP) {
        updateBluetoothCoachPowerMeterTicks(pm.id);
      }
      
      // 목표 파워 궤적 업데이트 (초기 상태)
      const currentPower = pm.currentPower || 0;
      const ftp = pm.userFTP || 200;
      const maxPower = ftp * 2;
      const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
      const angle = -90 + (ratio * 180);
      updateBluetoothCoachPowerMeterTrail(pm.id, currentPower, angle, pm);
    });
    
    // 버튼 상태 업데이트
    updateBluetoothCoachTrainingButtons();
    
    if (typeof showToast === 'function') {
      showToast(`"${loadedWorkout.title || '워크아웃'}" 워크아웃이 선택되었습니다.`, 'success');
    }
    
  } catch (error) {
    console.error('[Bluetooth Coach] 워크아웃 선택 오류:', error);
    
    const selectedRow = document.querySelector(`.workout-selection-row[data-workout-id="${workoutId}"]`);
    if (selectedRow) {
      selectedRow.classList.remove('selected', 'uploading');
      const durationCell = selectedRow.querySelector('.workout-duration-cell');
      if (durationCell) {
        const originalDuration = durationCell.getAttribute('data-original-duration') || durationCell.getAttribute('data-duration');
        if (originalDuration) {
          durationCell.innerHTML = originalDuration;
        }
      }
    }
    
    if (typeof showToast === 'function') {
      showToast(`워크아웃 선택 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, 'error');
    }
  }
}

/**
 * 워크아웃 선택 모달 열기 (Indoor Training 함수를 재사용하되, selectWorkoutForBluetoothCoach 호출하도록 수정)
 */
async function openWorkoutSelectionModalForBluetoothCoach() {
  const modal = document.getElementById('workoutSelectionModal');
  if (!modal) {
    console.error('[Bluetooth Coach] 워크아웃 선택 모달을 찾을 수 없습니다.');
    return;
  }
  
  // 워크아웃 선택 버튼 클릭 애니메이션
  const selectBtn = document.getElementById('btnSelectWorkoutBluetoothCoach');
  if (selectBtn) {
    selectBtn.style.transform = 'scale(0.95)';
    selectBtn.style.transition = 'transform 0.1s ease';
    setTimeout(() => {
      if (selectBtn) {
        selectBtn.style.transform = 'scale(1)';
      }
    }, 100);
  }
  
  // 모달 표시
  modal.classList.remove('hidden');
  
  // 로딩 상태 표시
  const tbody = document.getElementById('workoutSelectionTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px;">
          <div class="loading-spinner" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;">
            <div class="spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255, 255, 255, 0.2); border-top: 4px solid #00d4aa; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p style="color: #ffffff; font-size: 14px; margin: 0;">워크아웃 목록을 불러오는 중...</p>
          </div>
        </td>
      </tr>
    `;
  }
  
  // 워크아웃 목록 로드 (Indoor Training의 loadWorkoutsForSelection 재사용)
  if (typeof loadWorkoutsForSelection === 'function') {
    await loadWorkoutsForSelection();
    
    // 워크아웃 선택 시 selectWorkoutForBluetoothCoach 호출하도록 이벤트 리스너 추가
    setTimeout(() => {
      const rows = document.querySelectorAll('.workout-selection-row');
      rows.forEach(row => {
        const workoutId = row.getAttribute('data-workout-id');
        if (workoutId) {
          row.onclick = () => selectWorkoutForBluetoothCoach(workoutId);
        }
      });
    }, 100);
  } else {
    console.error('[Bluetooth Coach] loadWorkoutsForSelection 함수를 찾을 수 없습니다.');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #dc2626;">워크아웃 목록을 불러올 수 없습니다.</td></tr>';
    }
  }
}

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

// openWorkoutSelectionModalForBluetoothCoach 함수를 전역으로 노출
window.openWorkoutSelectionModalForBluetoothCoach = openWorkoutSelectionModalForBluetoothCoach;

/**
 * 워크아웃 카운트다운 후 훈련 시작 (Indoor Training의 startTrainingWithCountdown 참고)
 */
function startBluetoothCoachTrainingWithCountdown() {
  console.log('🎮 [진단] startBluetoothCoachTrainingWithCountdown 함수 호출됨');
  
  // 워크아웃 확인 (강화된 검증)
  const hasWorkout = window.bluetoothCoachState && 
                     window.bluetoothCoachState.currentWorkout && 
                     window.bluetoothCoachState.currentWorkout.segments &&
                     Array.isArray(window.bluetoothCoachState.currentWorkout.segments) &&
                     window.bluetoothCoachState.currentWorkout.segments.length > 0;
  
  if (!hasWorkout) {
    console.error('🎮 [진단/Error] 워크아웃이 선택되지 않았습니다!');
    console.error('🎮 [진단/Error] currentWorkout 상태:', {
      exists: !!(window.bluetoothCoachState && window.bluetoothCoachState.currentWorkout),
      hasSegments: !!(window.bluetoothCoachState?.currentWorkout?.segments),
      segmentsLength: window.bluetoothCoachState?.currentWorkout?.segments?.length || 0
    });
    
    if (typeof showToast === 'function') {
      showToast('워크아웃을 선택해주세요.', 'error');
    }
    return;
  }
  
  console.log('🎮 [진단] 워크아웃 확인 완료, 카운트다운 시작');
  
  // Firebase에 시작 카운트다운 상태 전송
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    let countdown = 5;
    // Firebase에 카운트다운 시작 신호 전송
    db.ref(`sessions/${sessionId}/status`).update({
      countdownRemainingSec: countdown,
      state: 'countdown' // 카운트다운 중임을 표시
    }).catch(e => console.warn('[Bluetooth Coach] 카운트다운 상태 전송 실패:', e));
    
    // 카운트다운 진행 중 Firebase 업데이트
    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown >= 0) {
        db.ref(`sessions/${sessionId}/status`).update({
          countdownRemainingSec: countdown
        }).catch(e => console.warn('[Bluetooth Coach] 카운트다운 상태 업데이트 실패:', e));
      } else {
        clearInterval(countdownInterval);
        // 카운트다운 종료 후 running 상태로 변경
        db.ref(`sessions/${sessionId}/status`).update({
          countdownRemainingSec: null,
          state: 'running'
        }).catch(e => console.warn('[Bluetooth Coach] 훈련 시작 상태 전송 실패:', e));
      }
    }, 1000);
  }
  
  // 카운트다운 모달 생성 및 표시 (Indoor Training과 동일)
  const countdownModal = document.createElement('div');
  countdownModal.id = 'bluetoothCoachCountdownModal';
  countdownModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: "Pretendard", "Noto Sans KR", sans-serif;
  `;
  
  const countdownText = document.createElement('div');
  countdownText.style.cssText = `
    font-size: 600px;
    font-weight: 900;
    color: #00d4aa;
    text-shadow: 0 0 30px rgba(0, 212, 170, 0.8);
    animation: countdownPulse 0.5s ease-out;
  `;
  
  // CSS 애니메이션 추가 (Indoor Training과 동일)
  if (!document.getElementById('countdownAnimationStyle')) {
    const style = document.createElement('style');
    style.id = 'countdownAnimationStyle';
    style.textContent = `
      @keyframes countdownPulse {
        0% { transform: scale(0.5); opacity: 0; }
        50% { transform: scale(1.2); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes countdownFadeOut {
        0% { transform: scale(1); opacity: 1; }
        100% { transform: scale(1.5); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  countdownModal.appendChild(countdownText);
  document.body.appendChild(countdownModal);
  
  // 카운트다운 시작 (5, 4, 3, 2, 1, GO!!)
  let count = 5;
  countdownText.textContent = count.toString();
  if (typeof playBeep === 'function') {
    playBeep(880, 120, 0.25);
  }
  
  const countdownInterval = setInterval(async () => {
    count--;
    
    if (count > 0) {
      countdownText.textContent = count.toString();
      countdownText.style.animation = 'none';
      setTimeout(() => {
        countdownText.style.animation = 'countdownPulse 0.5s ease-out';
      }, 10);
      if (typeof playBeep === 'function') {
        playBeep(880, 120, 0.25);
      }
    } else if (count === 0) {
      countdownText.textContent = 'GO!!';
      countdownText.style.animation = 'countdownPulse 0.5s ease-out';
      if (typeof playBeep === 'function') {
        try {
          await playBeep(1500, 700, 0.35, 'square');
        } catch (e) {
          console.warn('Failed to play beep:', e);
        }
      }
      count--;
    } else {
      clearInterval(countdownInterval);
      countdownText.style.animation = 'countdownFadeOut 0.3s ease-out';
      setTimeout(() => {
        if (countdownModal.parentElement) {
          document.body.removeChild(countdownModal);
        }
        startBluetoothCoachTraining();
      }, 300);
    }
  }, 1000);
}

/**
 * 시작/일시정지 토글 (Indoor Training의 toggleStartPauseTraining 참고)
 */
function toggleStartPauseBluetoothCoachTraining() {
  console.log('🎮 [진단] toggleStartPauseBluetoothCoachTraining 함수 호출됨');
  
  const state = window.bluetoothCoachState ? window.bluetoothCoachState.trainingState : 'idle';
  const hasWorkout = window.bluetoothCoachState && 
                     window.bluetoothCoachState.currentWorkout && 
                     window.bluetoothCoachState.currentWorkout.segments &&
                     Array.isArray(window.bluetoothCoachState.currentWorkout.segments) &&
                     window.bluetoothCoachState.currentWorkout.segments.length > 0;
  
  console.log('🎮 [진단] 현재 상태:', {
    trainingState: state,
    hasWorkout: hasWorkout,
    currentWorkout: window.bluetoothCoachState?.currentWorkout ? '있음' : '없음'
  });
  
  if (state === 'idle' || state === 'finished') {
    if (!hasWorkout) {
      console.error('🎮 [진단/Error] 워크아웃이 선택되지 않았습니다!');
      if (typeof showToast === 'function') {
        showToast('워크아웃을 먼저 선택해주세요.', 'error');
      }
      return;
    }
    console.log('🎮 [진단] 워크아웃 시작 시도 (카운트다운 포함)');
    startBluetoothCoachTrainingWithCountdown();
  } else if (state === 'running') {
    console.log('🎮 [진단] 훈련 일시정지');
    pauseBluetoothCoachTraining();
  } else if (state === 'paused') {
    console.log('🎮 [진단] 훈련 재개');
    resumeBluetoothCoachTraining();
  } else {
    console.warn('🎮 [진단] 알 수 없는 상태:', state);
  }
}

/**
 * 훈련 시작 (Indoor Training의 startTraining 참고)
 */
function startBluetoothCoachTraining() {
  window.bluetoothCoachState.trainingState = 'running';
  window.bluetoothCoachState.startTime = Date.now();
  window.bluetoothCoachState.currentSegmentIndex = 0;
  window.bluetoothCoachState.segmentStartTime = Date.now();
  window.bluetoothCoachState.segmentElapsedTime = 0;
  
  // 세그먼트별 카운트다운 트리거 상태 초기화
  if (window.bluetoothCoachState.currentWorkout && window.bluetoothCoachState.currentWorkout.segments) {
    const segments = window.bluetoothCoachState.currentWorkout.segments;
    window.bluetoothCoachState.segmentCountdownActive = false;
    window.bluetoothCoachState.countdownTriggered = Array(segments.length).fill(false);
    window.bluetoothCoachState._countdownFired = {};
    window.bluetoothCoachState._prevRemainMs = {};
  }
  
  // Firebase에 훈련 시작 상태 전송
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    const segments = window.bluetoothCoachState.currentWorkout?.segments || [];
    const firstSegment = segments[0];
    
    const updateData = {
      state: 'running',
      segmentIndex: 0,
      elapsedTime: 0
    };
    
    // 첫 번째 세그먼트의 target_type과 target_value도 함께 설정
    if (firstSegment) {
      updateData.segmentTargetType = firstSegment.target_type || 'ftp_pct';
      updateData.segmentTargetValue = firstSegment.target_value !== undefined ? firstSegment.target_value : null;
      console.log('[Bluetooth Coach] 워크아웃 시작 시 첫 세그먼트 목표값 설정:', {
        targetType: updateData.segmentTargetType,
        targetValue: updateData.segmentTargetValue
      });
    }
    
    db.ref(`sessions/${sessionId}/status`).update(updateData)
      .catch(e => console.warn('[Bluetooth Coach] 훈련 시작 상태 전송 실패:', e));
  }
  
  // 워크아웃 시작 시 모든 파워미터의 궤적 및 통계 데이터 초기화
  window.bluetoothCoachState.powerMeters.forEach(pm => {
    pm.powerTrailHistory = [];
    pm.lastTrailAngle = null;
    pm.maxPower = 0;
    pm.powerSum = 0;
    pm.powerCount = 0;
    pm.averagePower = 0;
    pm.segmentPowerSum = 0;
    pm.segmentPowerCount = 0;
    pm.segmentPower = 0;
  });
  
  // 버튼 상태 업데이트
  updateBluetoothCoachTrainingButtons();
  
  // 세그먼트 정보 업데이트 (훈련 시작 시 첫 번째 세그먼트 표시)
  updateCurrentSegmentInfo();
  
  // 우측 세그먼트 그래프 업데이트 (Indoor Training과 동일)
  // currentWorkout이 있는지 확인하고, segments도 확인
  if (window.bluetoothCoachState.currentWorkout && 
      window.bluetoothCoachState.currentWorkout.segments && 
      window.bluetoothCoachState.currentWorkout.segments.length > 0) {
    // 세그먼트 그래프를 즉시 표시 (setTimeout 없이)
    updateWorkoutSegmentGraphForBluetoothCoach(window.bluetoothCoachState.currentWorkout, 0);
    
    // 추가로 setTimeout으로도 업데이트 (레이아웃 계산을 위해)
    setTimeout(() => {
      if (window.bluetoothCoachState.currentWorkout) {
        updateWorkoutSegmentGraphForBluetoothCoach(window.bluetoothCoachState.currentWorkout, 0);
      }
    }, 100);
  } else {
    console.warn('[Bluetooth Coach] 워크아웃 또는 세그먼트가 없어서 세그먼트 그래프를 표시할 수 없습니다.', {
      hasWorkout: !!window.bluetoothCoachState.currentWorkout,
      hasSegments: !!(window.bluetoothCoachState.currentWorkout && window.bluetoothCoachState.currentWorkout.segments),
      segmentsLength: window.bluetoothCoachState.currentWorkout?.segments?.length || 0
    });
  }
  
  // 타이머 시작
  startBluetoothCoachTrainingTimer();
}

/**
 * 훈련 일시정지 (Indoor Training의 pauseTraining 참고)
 */
function pauseBluetoothCoachTraining() {
  window.bluetoothCoachState.trainingState = 'paused';
  window.bluetoothCoachState.pausedTime = Date.now();
  
  // 활성 카운트다운 정지
  if (window.bluetoothCoachState.segmentCountdownActive) {
    stopBluetoothCoachSegmentCountdown();
  }
  
  // Firebase에 일시정지 상태 전송
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    db.ref(`sessions/${sessionId}/status`).update({
      state: 'paused'
    }).catch(e => console.warn('[Bluetooth Coach] 일시정지 상태 전송 실패:', e));
  }
  
  // 버튼 상태 업데이트
  updateBluetoothCoachTrainingButtons();
}

/**
 * 훈련 재개 (Indoor Training의 resumeTraining 참고)
 */
function resumeBluetoothCoachTraining() {
  if (window.bluetoothCoachState.pausedTime) {
    const pausedDuration = Date.now() - window.bluetoothCoachState.pausedTime;
    window.bluetoothCoachState.startTime += pausedDuration;
    window.bluetoothCoachState.segmentStartTime += pausedDuration;
    window.bluetoothCoachState.pausedTime = 0;
  }
  
  window.bluetoothCoachState.trainingState = 'running';
  
  // Firebase에 재개 상태 전송
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    db.ref(`sessions/${sessionId}/status`).update({
      state: 'running'
    }).catch(e => console.warn('[Bluetooth Coach] 재개 상태 전송 실패:', e));
  }
  
  // 버튼 상태 업데이트
  updateBluetoothCoachTrainingButtons();
  
  // 타이머 재개
  startBluetoothCoachTrainingTimer();
}

/**
 * 훈련 종료 (Indoor Training의 stopTraining 참고)
 */
function stopBluetoothCoachTraining() {
  window.bluetoothCoachState.trainingState = 'idle';
  
  // 활성 카운트다운 정지
  if (window.bluetoothCoachState.segmentCountdownActive) {
    stopBluetoothCoachSegmentCountdown();
  }
  
  // Firebase에 종료 상태 전송
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    db.ref(`sessions/${sessionId}/status`).update({
      state: 'idle',
      segmentIndex: 0,
      elapsedTime: 0
    }).catch(e => console.warn('[Bluetooth Coach] 훈련 종료 상태 전송 실패:', e));
  }
  
  // 상태 초기화
  window.bluetoothCoachState.startTime = null;
  window.bluetoothCoachState.pausedTime = 0;
  window.bluetoothCoachState.totalElapsedTime = 0;
  window.bluetoothCoachState.currentSegmentIndex = 0;
  window.bluetoothCoachState.segmentStartTime = null;
  window.bluetoothCoachState.segmentElapsedTime = 0;
  window.bluetoothCoachState.segmentCountdownActive = false;
  window.bluetoothCoachState.countdownTriggered = [];
  window.bluetoothCoachState._countdownFired = {};
  window.bluetoothCoachState._prevRemainMs = {};
  
  // 버튼 상태 업데이트
  updateBluetoothCoachTrainingButtons();
  
  // 세그먼트 그래프 업데이트
  updateWorkoutSegmentGraph();
  
  if (typeof showToast === 'function') {
    showToast('훈련이 종료되었습니다.');
  }
}

/**
 * 세그먼트 건너뛰기 (Indoor Training의 skipCurrentSegmentTraining 참고)
 */
function skipCurrentBluetoothCoachSegmentTraining() {
  if (!window.bluetoothCoachState.currentWorkout || !window.bluetoothCoachState.currentWorkout.segments) {
    return;
  }
  
  // 활성 카운트다운 정지
  if (window.bluetoothCoachState.segmentCountdownActive) {
    stopBluetoothCoachSegmentCountdown();
  }
  
  // 해당 세그먼트의 카운트다운 트리거 상태도 리셋
  const currentIndex = window.bluetoothCoachState.currentSegmentIndex;
  if (window.bluetoothCoachState.countdownTriggered && currentIndex < window.bluetoothCoachState.countdownTriggered.length) {
    window.bluetoothCoachState.countdownTriggered[currentIndex] = true; // 건너뛴 것으로 표시
  }
  
  const segments = window.bluetoothCoachState.currentWorkout.segments;
  
  if (currentIndex >= segments.length - 1) {
    // 마지막 세그먼트이면 워크아웃 종료
    stopBluetoothCoachTraining();
    return;
  }
  
  // 다음 세그먼트로 이동
  window.bluetoothCoachState.currentSegmentIndex = currentIndex + 1;
  window.bluetoothCoachState.segmentStartTime = Date.now();
  window.bluetoothCoachState.segmentElapsedTime = 0;
  
  // 카운트다운 상태 초기화 (다음 세그먼트를 위해)
  window.bluetoothCoachState.segmentCountdownActive = false;
  
  // 세그먼트 정보 업데이트
  updateCurrentSegmentInfo();
  const nextKey = String(window.bluetoothCoachState.currentSegmentIndex);
  if (window.bluetoothCoachState._countdownFired[nextKey]) {
    delete window.bluetoothCoachState._countdownFired[nextKey];
  }
  if (window.bluetoothCoachState._prevRemainMs[nextKey]) {
    delete window.bluetoothCoachState._prevRemainMs[nextKey];
  }
  
  // Firebase에 세그먼트 인덱스 및 세그먼트 목표값 업데이트
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    const currentSegIndex = window.bluetoothCoachState.currentSegmentIndex;
    const segments = window.bluetoothCoachState.currentWorkout?.segments || [];
    const currentSegment = segments[currentSegIndex];
    
    const updateData = {
      segmentIndex: currentSegIndex
    };
    
    // 현재 세그먼트의 target_type과 target_value도 함께 업데이트
    if (currentSegment) {
      updateData.segmentTargetType = currentSegment.target_type || 'ftp_pct';
      updateData.segmentTargetValue = currentSegment.target_value !== undefined ? currentSegment.target_value : null;
      console.log('[Bluetooth Coach] 세그먼트 목표값 업데이트:', {
        segmentIndex: currentSegIndex,
        targetType: updateData.segmentTargetType,
        targetValue: updateData.segmentTargetValue
      });
    }
    
    db.ref(`sessions/${sessionId}/status`).update(updateData)
      .catch(e => console.warn('[Bluetooth Coach] 세그먼트 인덱스 및 목표값 업데이트 실패:', e));
  }
  
  // 세그먼트 변경 시 데이터 초기화
  window.bluetoothCoachState.powerMeters.forEach(pm => {
    if (pm.connected) {
      // 궤적 초기화
      pm.powerTrailHistory = [];
      pm.lastTrailAngle = null;
      const trailContainer = document.getElementById(`needle-path-${pm.id}`);
      if (trailContainer) trailContainer.innerHTML = '';
      
      // 세그먼트 평균 파워 통계 리셋
      pm.segmentPowerSum = 0;
      pm.segmentPowerCount = 0;
      pm.segmentPower = 0;
      
      // 목표 파워 궤적 업데이트
      const currentPower = pm.currentPower || 0;
      const ftp = pm.userFTP || 200;
      const maxPower = ftp * 2;
      const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
      const angle = -90 + (ratio * 180);
      updateBluetoothCoachPowerMeterTrail(pm.id, currentPower, angle, pm);
    }
  });
  
  // 세그먼트 그래프 업데이트 (Indoor Training과 동일)
  updateWorkoutSegmentGraphForBluetoothCoach(window.bluetoothCoachState.currentWorkout, window.bluetoothCoachState.currentSegmentIndex);
}

/**
 * 훈련 타이머 (Indoor Training의 startTrainingTimer 참고)
 */
function startBluetoothCoachTrainingTimer() {
  if (window.bluetoothCoachState.trainingState !== 'running') return;
  
  const now = Date.now();
  
  // Indoor Training과 동일한 로직: startTime이 있으면 경과 시간 계산
  if (window.bluetoothCoachState.startTime) {
    const elapsed = Math.floor((now - window.bluetoothCoachState.startTime - window.bluetoothCoachState.pausedTime) / 1000);
    window.bluetoothCoachState.totalElapsedTime = Math.max(0, elapsed);
    
    // 세그먼트 경과 시간 업데이트 (Indoor Training과 동일)
    // segmentStartTime이 없으면 현재 시간으로 초기화
    if (!window.bluetoothCoachState.segmentStartTime) {
      window.bluetoothCoachState.segmentStartTime = now;
      window.bluetoothCoachState.segmentElapsedTime = 0;
    } else {
      // segmentStartTime은 resume 시 조정되므로 pausedTime을 빼지 않음
      window.bluetoothCoachState.segmentElapsedTime = Math.floor((now - window.bluetoothCoachState.segmentStartTime) / 1000);
    }
  }
  
  // 전광판 업데이트
  updateScoreboard();
  
  // 랩 카운트다운 업데이트 (항상 호출)
  updateBluetoothCoachLapTime();
  
  // Firebase에 경과 시간 및 세그먼트 정보 업데이트
  if (typeof db !== 'undefined') {
    const sessionId = getBluetoothCoachSessionId();
    const currentSegIndex = window.bluetoothCoachState.currentSegmentIndex;
    const segments = window.bluetoothCoachState.currentWorkout?.segments || [];
    const currentSegment = segments[currentSegIndex];
    
    const updateData = {
      elapsedTime: window.bluetoothCoachState.totalElapsedTime,
      segmentIndex: currentSegIndex
    };
    
    // 현재 세그먼트의 target_type과 target_value도 함께 업데이트
    if (currentSegment) {
      updateData.segmentTargetType = currentSegment.target_type || 'ftp_pct';
      updateData.segmentTargetValue = currentSegment.target_value !== undefined ? currentSegment.target_value : null;
    }
    
    db.ref(`sessions/${sessionId}/status`).update(updateData)
      .catch(e => console.warn('[Bluetooth Coach] 경과 시간 및 세그먼트 정보 업데이트 실패:', e));
  }
  
  // 세그먼트 전환 체크 및 카운트다운 로직 (Indoor Training과 동일한 로직)
  if (window.bluetoothCoachState.currentWorkout && window.bluetoothCoachState.currentWorkout.segments) {
    const segments = window.bluetoothCoachState.currentWorkout.segments;
    const currentIndex = window.bluetoothCoachState.currentSegmentIndex;
    const currentSegment = segments[currentIndex];
    
    if (currentSegment) {
      const segmentDuration = currentSegment.duration_sec || currentSegment.duration || 0;
      const segmentElapsed = window.bluetoothCoachState.segmentElapsedTime;
      const remaining = segmentDuration - segmentElapsed;
      
      // 5초 카운트다운 로직 (Indoor Training과 동일)
      if (remaining > 0) {
        // 다음 세그(마지막이면 null)
        const nextSeg = (currentIndex < segments.length - 1) ? segments[currentIndex + 1] : null;
        
        const state = window.bluetoothCoachState;
        state._countdownFired = state._countdownFired || {};   // 세그먼트별 발화 기록
        state._prevRemainMs = state._prevRemainMs || {};   // 세그먼트별 이전 남은 ms
        const key = String(currentIndex);
        
        // 남은 ms 계산
        const remainMsPrev = state._prevRemainMs[key] ?? Math.round(remaining * 1000); // 바로 직전 남은 ms
        const remainMsNow = Math.round(remaining * 1000);           // 현재 남은 ms
        
        // Edge-Driven 카운트다운: 6초(표시 5) → 1초(표시 0)에서 끝
        function maybeFire(n) {
          const firedMap = state._countdownFired[key] || {};
          if (firedMap[n]) return;
        
          // 경계: 6→5, 5→4, ..., 2→1 은 (n+1)*1000ms, 1→0 은 1000ms
          const boundary = (n > 0) ? (n + 1) * 1000 : 1000;
          const crossed = (remainMsPrev > boundary && remainMsNow <= boundary);
          if (!crossed) return;
        
          // 오버레이 표시 시작(6초 시점에 "5" 표시)
          if (n === 5 && !state.segmentCountdownActive && nextSeg) {
            startBluetoothCoachSegmentCountdown(5, nextSeg); // 오버레이 켜고 5 표시 + 짧은 비프
          } else if (state.segmentCountdownActive) {
            // 진행 중이면 숫자 업데이트만(내부 타이머 없음)
            BluetoothCoachCountdownDisplay.render(n);
            
            // 4, 3, 2, 1초일 때 벨소리 재생
            if (n > 0 && typeof playBeep === 'function') {
              playBeep(880, 120, 0.25);
            }
          }
        
          // 0은 "세그먼트 종료 1초 전"에 표시 + 강조 벨소리, 그리고 오버레이 닫기 예약
          if (n === 0) {
            // 강조 벨소리 (조금 더 강한 톤)
            if (typeof playBeep === 'function') {
              playBeep(1500, 700, 0.35, "square");
            }
            // 오버레이는 약간의 여유를 두고 닫기
            BluetoothCoachCountdownDisplay.finish(800);
            state.segmentCountdownActive = false;
          }
        
          state._countdownFired[key] = { ...firedMap, [n]: true };
        }
        
        // 5→0 모두 확인(틱이 건너뛰어도 놓치지 않음)
        maybeFire(5);
        maybeFire(4);
        maybeFire(3);
        maybeFire(2);
        maybeFire(1);
        maybeFire(0);
        
        // 다음 비교를 위해 현재 값 저장
        state._prevRemainMs[key] = remainMsNow;
      }
      
      // 세그먼트 시간이 지나면 다음 세그먼트로 이동
      if (segmentElapsed >= segmentDuration) {
        if (currentIndex >= segments.length - 1) {
          // 워크아웃 종료
          window.bluetoothCoachState.trainingState = 'finished';
          
          // Firebase에 완료 상태 전송
          if (typeof db !== 'undefined') {
            const sessionId = getBluetoothCoachSessionId();
            db.ref(`sessions/${sessionId}/status`).update({
              state: 'finished',
              completionMessage: '모든 세그먼트 훈련이 완료되었습니다.',
              completedAt: Date.now()
            }).then(() => {
              console.log('[Bluetooth Coach] 워크아웃 완료 - Firebase status 업데이트 완료: finished');
            }).catch((error) => {
              console.error('[Bluetooth Coach] 워크아웃 완료 - Firebase status 업데이트 실패:', error);
            });
          }
          
          // 버튼 상태 업데이트
          updateBluetoothCoachTrainingButtons();
          
          console.log(`[Bluetooth Coach] 워크아웃 완료`);
          return;
        } else {
          // 다음 세그먼트로 이동
          window.bluetoothCoachState.currentSegmentIndex = currentIndex + 1;
          window.bluetoothCoachState.segmentStartTime = Date.now();
          window.bluetoothCoachState.segmentElapsedTime = 0;
          
          // 카운트다운 상태 초기화 (다음 세그먼트를 위해)
          window.bluetoothCoachState.segmentCountdownActive = false;
          
          // 세그먼트 정보 업데이트
          updateCurrentSegmentInfo();
          const nextKey = String(window.bluetoothCoachState.currentSegmentIndex);
          if (window.bluetoothCoachState._countdownFired[nextKey]) {
            delete window.bluetoothCoachState._countdownFired[nextKey];
          }
          if (window.bluetoothCoachState._prevRemainMs[nextKey]) {
            delete window.bluetoothCoachState._prevRemainMs[nextKey];
          }
          
          // Firebase에 세그먼트 인덱스 및 세그먼트 목표값 업데이트
          if (typeof db !== 'undefined') {
            const sessionId = getBluetoothCoachSessionId();
            const currentSegIndex = window.bluetoothCoachState.currentSegmentIndex;
            const segments = window.bluetoothCoachState.currentWorkout?.segments || [];
            const currentSegment = segments[currentSegIndex];
            
            const updateData = {
              segmentIndex: currentSegIndex
            };
            
            // 현재 세그먼트의 target_type과 target_value도 함께 업데이트
            if (currentSegment) {
              updateData.segmentTargetType = currentSegment.target_type || 'ftp_pct';
              updateData.segmentTargetValue = currentSegment.target_value !== undefined ? currentSegment.target_value : null;
              console.log('[Bluetooth Coach] 세그먼트 전환 시 목표값 업데이트:', {
                segmentIndex: currentSegIndex,
                targetType: updateData.segmentTargetType,
                targetValue: updateData.segmentTargetValue
              });
            }
            
            db.ref(`sessions/${sessionId}/status`).update(updateData)
              .catch(e => console.warn('[Bluetooth Coach] 세그먼트 인덱스 및 목표값 업데이트 실패:', e));
          }
          
          // 세그먼트 변경 시 데이터 초기화 (Indoor Training과 동일)
          window.bluetoothCoachState.powerMeters.forEach(pm => {
            if (pm.connected) {
              // 궤적 초기화
              pm.powerTrailHistory = [];
              pm.lastTrailAngle = null;
              const trailContainer = document.getElementById(`needle-path-${pm.id}`);
              if (trailContainer) trailContainer.innerHTML = '';
              
              // 세그먼트 평균 파워 통계 리셋
              pm.segmentPowerSum = 0;
              pm.segmentPowerCount = 0;
              pm.segmentPower = 0;
              
              // 목표 파워 궤적 업데이트
              const currentPower = pm.currentPower || 0;
              const ftp = pm.userFTP || 200;
              const maxPower = ftp * 2;
              const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
              const angle = -90 + (ratio * 180);
              updateBluetoothCoachPowerMeterTrail(pm.id, currentPower, angle, pm);
            }
          });
        }
      }
    }
  }
  
  // 세그먼트 그래프 업데이트 (마스코트 위치 업데이트를 위해) - Indoor Training과 동일
  if (window.bluetoothCoachState.currentWorkout) {
    const currentSegmentIndex = window.bluetoothCoachState.currentSegmentIndex;
    updateWorkoutSegmentGraphForBluetoothCoach(window.bluetoothCoachState.currentWorkout, currentSegmentIndex);
  }
  
  if (window.bluetoothCoachState.trainingState === 'running') {
    setTimeout(startBluetoothCoachTrainingTimer, 1000);
  }
}

/**
 * 훈련 버튼 상태 업데이트 (Indoor Training의 updateTrainingButtons 참고)
 */
function updateBluetoothCoachTrainingButtons() {
  const toggleBtn = document.getElementById('btnTogglePauseBluetoothCoach');
  const stopBtn = document.getElementById('btnStopTrainingBluetoothCoach');
  const skipBtn = document.getElementById('btnSkipSegmentBluetoothCoach');
  
  const state = window.bluetoothCoachState.trainingState;
  
  if (toggleBtn) {
    if (state === 'idle' || state === 'finished') {
      toggleBtn.className = 'enhanced-control-btn play';
      toggleBtn.title = '시작';
    } else if (state === 'running') {
      toggleBtn.className = 'enhanced-control-btn pause';
      toggleBtn.title = '일시정지';
    } else if (state === 'paused') {
      toggleBtn.className = 'enhanced-control-btn play';
      toggleBtn.title = '재개';
    }
  }
  
  if (stopBtn) {
    stopBtn.disabled = (state === 'idle');
  }
  
  if (skipBtn) {
    skipBtn.disabled = (state === 'idle' || state === 'finished');
  }
}

/**
 * Bluetooth Coach 전용 카운트다운 표시 컨트롤러 (Indoor Training의 CountdownDisplay 참고)
 */
const BluetoothCoachCountdownDisplay = {
  active: false,
  overlay: null,
  num: null,
  infoDiv: null,
  ensure(nextSegment) {
    // 오버레이가 없으면 동적으로 생성
    if (!this.overlay) {
      this.overlay = document.getElementById("bluetoothCoachCountdownOverlay");
      if (!this.overlay) {
        // 동적으로 생성
        this.overlay = document.createElement('div');
        this.overlay.id = 'bluetoothCoachCountdownOverlay';
        this.overlay.className = 'countdown-overlay hidden';
        this.overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.9);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
          transition: opacity 0.3s ease;
        `;
        document.body.appendChild(this.overlay);
      }
    }
    
    if (!this.num) {
      this.num = document.getElementById("bluetoothCoachCountdownNumber");
      if (!this.num) {
        // 동적으로 생성
        this.num = document.createElement('div');
        this.num.id = 'bluetoothCoachCountdownNumber';
        this.num.className = 'countdown-number';
        this.num.style.cssText = `
          font-size: 600px;
          font-weight: 900;
          color: #00d4aa;
          text-shadow: 0 0 30px rgba(0, 212, 170, 0.8);
          animation: countdownPulse 0.5s ease-out;
        `;
        this.overlay.appendChild(this.num);
      }
    }
    
    if (!this.overlay || !this.num) return false;

    // CSS 애니메이션 추가 (Indoor Training과 동일)
    if (!document.getElementById('countdownAnimationStyle')) {
      const style = document.createElement('style');
      style.id = 'countdownAnimationStyle';
      style.textContent = `
        @keyframes countdownPulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes countdownFadeOut {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // 다음 세그먼트 안내
    if (!this.infoDiv) {
      this.infoDiv = document.createElement('div');
      this.infoDiv.id = 'bluetoothCoachNextSegmentInfo';
      this.infoDiv.style.cssText = `
        position: absolute;
        bottom: 30%;
        left: 50%;
        transform: translateX(-50%);
        color: #fff;
        font-size: 18px;
        font-weight: 600;
        text-align: center;
        text-shadow: 0 2px 4px rgba(0,0,0,.5);
        opacity: .9;
      `;
      this.overlay.appendChild(this.infoDiv);
    }
    
    // getSegmentFtpPercent 함수가 있는지 확인
    const getSegmentFtpPercent = typeof window.getSegmentFtpPercent === 'function' 
      ? window.getSegmentFtpPercent 
      : (seg) => {
          if (seg.ftp_percent) return seg.ftp_percent;
          if (seg.target_type === 'ftp_pct' && seg.target_value) return Number(seg.target_value) || 60;
          if (seg.target_type === 'ftp_pctz' && seg.target_value) {
            const parts = String(seg.target_value).split('/');
            return Number(parts[0]) || 60;
          }
          return 60;
        };
    
    const nextInfo = nextSegment
      ? `다음: ${(nextSegment.label || nextSegment.segment_type || '세그먼트')} FTP ${getSegmentFtpPercent(nextSegment)}%`
      : '훈련 완료';
    this.infoDiv.textContent = nextInfo;

    this.overlay.classList.remove("hidden");
    this.overlay.style.display = "flex";
    this.active = true;
    return true;
  },
  render(n) {
    if (!this.overlay || !this.num) return;
    this.num.textContent = String(n);
    // 애니메이션 재시작
    this.num.style.animation = 'none';
    setTimeout(() => {
      this.num.style.animation = 'countdownPulse 0.5s ease-out';
    }, 10);
  },
  finish(delayMs = 800) {
    if (!this.overlay) return;
    setTimeout(() => {
      this.overlay.classList.add("hidden");
      this.overlay.style.display = "none";
      this.active = false;
    }, delayMs);
  },
  hideImmediate() {
    if (!this.overlay) return;
    this.overlay.classList.add("hidden");
    this.overlay.style.display = "none";
    this.active = false;
  }
};

/**
 * Bluetooth Coach 세그먼트 카운트다운 시작 (Indoor Training의 startSegmentCountdown 참고)
 */
function startBluetoothCoachSegmentCountdown(initialNumber, nextSegment) {
  // initialNumber 는 보통 5 (6초 시점에서 5 표시)
  if (window.bluetoothCoachState.segmentCountdownActive) return;
  window.bluetoothCoachState.segmentCountdownActive = true;

  const ok = BluetoothCoachCountdownDisplay.ensure(nextSegment);
  if (!ok) {
    window.bluetoothCoachState.segmentCountdownActive = false;
    return;
  }

  // 처음 숫자와 짧은 비프
  BluetoothCoachCountdownDisplay.render(initialNumber);
  if (typeof playBeep === 'function') {
    playBeep(880, 120, 0.25);
  }
}

/**
 * Bluetooth Coach 카운트다운 강제 정지 (Indoor Training의 stopSegmentCountdown 참고)
 */
function stopBluetoothCoachSegmentCountdown() {
  console.log('[Bluetooth Coach] 카운트다운 강제 정지');
  BluetoothCoachCountdownDisplay.hideImmediate();
  window.bluetoothCoachState.segmentCountdownActive = false;
}

/**
 * 랩 카운트다운 업데이트 (Indoor Training의 updateLapTime 참고)
 */
function updateBluetoothCoachLapTime() {
  // 현재 세그먼트 정보 업데이트 (세그먼트 변경 시에도 반영)
  updateCurrentSegmentInfo();
  
  if (!window.bluetoothCoachState.currentWorkout || !window.bluetoothCoachState.currentWorkout.segments) {
    // 워크아웃이 없으면 랩카운트다운을 00:00으로 표시
    const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (countdownEl) {
      countdownEl.textContent = '00:00';
    }
    return;
  }
  
  const segments = window.bluetoothCoachState.currentWorkout.segments;
  const currentIndex = window.bluetoothCoachState.currentSegmentIndex || 0;
  const currentSegment = segments[currentIndex];
  
  if (!currentSegment) {
    // 현재 세그먼트가 없으면 00:00으로 표시
    const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
    if (countdownEl) {
      countdownEl.textContent = '00:00';
    }
    return;
  }
  
  const segmentDuration = currentSegment.duration_sec || currentSegment.duration || 0;
  const segmentElapsed = window.bluetoothCoachState.segmentElapsedTime || 0;
  const remaining = Math.max(0, segmentDuration - segmentElapsed);
  
  const countdownEl = document.getElementById('bluetoothCoachLapCountdown');
  if (countdownEl) {
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  
  // 디버깅 로그 (개발 중에만)
  if (window.DEBUG_BLUETOOTH_COACH) {
    console.log('[Bluetooth Coach] 랩카운트다운 업데이트:', {
      segmentIndex: currentIndex,
      segmentDuration,
      segmentElapsed,
      remaining,
      countdown: `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`
    });
  }
}

// [Critical Fix] 전역 객체에 함수 노출 (app.js에서 호출 가능하도록)
// 함수가 이미 window 객체에 할당되어 있더라도, 명시적으로 재할당하여 로드 순서 문제 해결
if (typeof initBluetoothCoachDashboard === 'function') {
  window.initBluetoothCoachDashboard = initBluetoothCoachDashboard;
} else if (typeof window.initBluetoothCoachDashboard === 'function') {
  // 이미 window에 할당되어 있는 경우, 참조만 유지
  console.log('[Bluetooth Coach] initBluetoothCoachDashboard 함수가 이미 window 객체에 할당되어 있습니다.');
} else {
  console.error('[Bluetooth Coach] ❌ 치명적 오류: initBluetoothCoachDashboard 함수를 찾을 수 없습니다.');
}

// renderBluetoothCoachDashboard 함수가 있다면 노출 (없으면 무시)
if (typeof renderBluetoothCoachDashboard === 'function') {
  window.renderBluetoothCoachDashboard = renderBluetoothCoachDashboard;
}

console.log('✅ [System] Bluetooth Coach Dashboard 모듈 로드 완료');
console.log('[Bluetooth Coach] 노출된 함수 확인:', {
  initBluetoothCoachDashboard: typeof window.initBluetoothCoachDashboard,
  renderBluetoothCoachDashboard: typeof window.renderBluetoothCoachDashboard
});

/* ==================================================================================
   [Self-Starter] 자동 실행 감지 센서 (Final Fix)
   설명: app.js의 호출 여부와 관계없이, 화면이 노출되면 스스로 감지하여 데이터를 로드합니다.
   ================================================================================== */
(function() {
    // 중복 실행 방지 플래그
    let isInitializing = false;
    let lastCheckTime = 0;

    // 1초 간격으로 화면 상태 모니터링
    setInterval(() => {
        const now = Date.now();
        // 너무 빈번한 체크 방지 (최소 500ms 간격)
        if (now - lastCheckTime < 500) return;
        lastCheckTime = now;

        const screenEl = document.getElementById('bluetoothTrainingCoachScreen');
        const gridEl = document.getElementById('bluetoothCoachPowerMeterGrid');
        
        // 조건 1: 화면 요소가 존재하고
        // 조건 2: 화면이 현재 눈에 보이며 (display != none)
        // 조건 3: 속도계 그리드가 비어있고 (초기화 안 됨)
        // 조건 4: 현재 초기화 진행 중이 아닐 때
        if (screenEl && gridEl && 
            window.getComputedStyle(screenEl).display !== 'none' && 
            gridEl.children.length === 0 &&
            !isInitializing) {
            
            console.log('⚡ [Self-Starter] 화면 노출 감지! 대시보드 자동 초기화 시작...');
            isInitializing = true;
            
            // 1. 초기화 함수 실행
            if (typeof window.initBluetoothCoachDashboard === 'function') {
                try {
                    window.initBluetoothCoachDashboard();
                    console.log('⚡ [Self-Starter] initBluetoothCoachDashboard 호출 완료');
                } catch (error) {
                    console.error('⚡ [Self-Starter] 초기화 중 오류:', error);
                    isInitializing = false;
                    return;
                }
                
                // 2. 안전장치: 1.5초 후에도 비어있으면 데이터 강제 로드 (Firebase 연동)
                setTimeout(() => {
                    if (gridEl && gridEl.children.length === 0) {
                        console.log('⚡ [Self-Starter] 데이터 로드 재시도 (updateBluetoothCoachTracksFromFirebase)...');
                        if (typeof window.updateBluetoothCoachTracksFromFirebase === 'function') {
                            window.updateBluetoothCoachTracksFromFirebase().then(() => {
                                console.log('⚡ [Self-Starter] 재시도 완료');
                                isInitializing = false;
                            }).catch(err => {
                                console.error('⚡ [Self-Starter] 재시도 실패:', err);
                                isInitializing = false;
                            });
                        } else {
                            console.warn('⚡ [Self-Starter] updateBluetoothCoachTracksFromFirebase 함수가 없습니다.');
                            isInitializing = false;
                        }
                    } else {
                        console.log('⚡ [Self-Starter] 데이터 로드 성공 확인');
                        isInitializing = false;
                    }
                }, 1500);
            } else {
                console.error('⚡ [Self-Starter] initBluetoothCoachDashboard 함수가 없습니다!');
                isInitializing = false;
            }
        }
    }, 1000);
    
    console.log('⚡ [Self-Starter] 자동 감지 센서 활성화됨 (1초 간격 모니터링)');
})();
