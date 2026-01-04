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
  needleAngles: {}, // 바늘 각도 저장용 추가
  resizeHandler: null, // 리사이즈 이벤트 핸들러
  scoreboardResizeObserver: null, // 전광판 컨테이너 ResizeObserver
  segmentCountdownActive: false // 세그먼트 카운트다운 활성화 여부
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

// 파워계 데이터 구조 (가민 스타일 개선)
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
    this.gear = null; // Gear 정보 (11단, 12단)
    this.brake = null; // Brake 정보 (디스크, 림)
    
    // 가민 스타일: 이벤트 카운트 및 누적 파워 추적
    this.lastEventCount = null; // 마지막 이벤트 카운트
    this.lastAccumulatedPower = null; // 마지막 누적 파워 (0.25W 단위)
    this.lastAccumulatedPowerTime = null; // 누적 파워 수신 시간
    this.lastCadenceTime = null; // 마지막 케이던스 수신 시간
    this.lastPowerTime = null; // 마지막 파워 수신 시간
    this.cadenceHistory = []; // 케이던스 히스토리 (스무딩용)
    this.powerRawHistory = []; // 원시 파워 히스토리 (필터링용)
    this.powerMedianHistory = []; // 중앙값 필터 히스토리
    this.powerFiltered = null; // 필터링된 파워값
    this.outlierRejectionCount = 0; // 연속 이상치 거부 횟수
    this.emaAlpha = 0.3; // EMA 알파 값 (0.3 = 최근 값에 30% 가중치)
    this.targetPower = 0; // 목표 파워값 (세그먼트)
// [추가] 애니메이션용 현재 표시 파워 (부드러운 움직임 담당)
    this.displayPower = 0; 
    this.lastDrawnTickCount = -1; // 궤적 그리기 최적화용
    this.powerTrailHistory = []; // 파워 궤적 히스토리 (각도 배열)
    this.lastTrailAngle = null; // 마지막 궤적 각도
    this.powerHistorySmoothed = []; // 파워 히스토리 (스무딩용)
    this.previousPower = 0; // [가민 스타일] 이전 파워값 (궤적선 동기화용)
    
    // 가민 스타일: 고급 파워 필터링 (최고 수준)
    this.powerRawHistory = []; // 원시 파워 히스토리 (최근 10개, outlier detection용)
    this.powerMedianHistory = []; // 중앙값 필터 히스토리 (최근 5개)
    this.powerFiltered = 0; // 최종 필터링된 파워값
    this.powerChangeRate = 0; // 파워 변화율 (W/s)
    this.lastPowerChangeTime = null; // 마지막 파워 변화 시간
    this.outlierRejectionCount = 0; // 이상치 거부 횟수 (연속)
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
// SESSION_ID를 가져오는 헬퍼 함수 (Training Room 선택 시 저장된 room id 사용)
function getSessionId() {
  // 우선순위: 1) window.SESSION_ID 2) window.currentTrainingRoomId 3) localStorage 4) SESSION_ID 상수 5) 기본값
  if (typeof window !== 'undefined' && window.SESSION_ID) {
    return window.SESSION_ID;
  }
  
  if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
    const roomId = String(window.currentTrainingRoomId);
    if (typeof window !== 'undefined') {
      window.SESSION_ID = roomId;
    }
    console.log('[Indoor Training] 전역 변수에서 room id 가져옴:', roomId);
    return roomId;
  }
  
  if (typeof localStorage !== 'undefined') {
    try {
      const storedRoomId = localStorage.getItem('currentTrainingRoomId');
      if (storedRoomId) {
        if (typeof window !== 'undefined') {
          window.SESSION_ID = storedRoomId;
        }
        console.log('[Indoor Training] localStorage에서 room id 가져옴:', storedRoomId);
        return storedRoomId;
      }
    } catch (e) {
      console.warn('[Indoor Training] localStorage 접근 실패:', e);
    }
  }
  
  // SESSION_ID 상수 사용
  if (typeof SESSION_ID !== 'undefined') {
    return SESSION_ID;
  }
  
  // 기본값
  return 'session_room_1';
}

function initIndoorTrainingDashboard() {
  console.log('[Indoor Training] 대시보드 초기화');
  
  // SESSION_ID 확인 및 로그
  const sessionId = getSessionId();
  console.log('[Indoor Training] 현재 SESSION_ID:', sessionId);
  console.log('[Indoor Training] window.SESSION_ID:', window.SESSION_ID);
  console.log('[Indoor Training] window.currentTrainingRoomId:', window.currentTrainingRoomId);
  
  // 파워계 그리드 생성
  createPowerMeterGrid();
  
  // 저장된 페어링 정보 로드
  loadPowerMeterPairings();
  
  // 전광판 초기화
  updateScoreboard();
  
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
  
  // 화면 크기 변경 시 세그먼트 그래프 크기 재조정
  let resizeTimeout;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // 현재 워크아웃이 있고 세그먼트 그래프가 표시 중이면 크기 재조정
      if (window.indoorTrainingState.currentWorkout) {
        const currentSegmentIndex = window.indoorTrainingState.currentSegmentIndex || 0;
        displayWorkoutSegmentGraph(window.indoorTrainingState.currentWorkout, currentSegmentIndex);
      }
    }, 250); // 디바운싱: 250ms 지연
  };
  
  // 기존 리사이즈 리스너 제거 (중복 방지)
  if (window.indoorTrainingState.resizeHandler) {
    window.removeEventListener('resize', window.indoorTrainingState.resizeHandler);
  }
  
  // 리사이즈 이벤트 리스너 등록
  window.indoorTrainingState.resizeHandler = handleResize;
  window.addEventListener('resize', handleResize);
  
  // ResizeObserver를 사용하여 전광판 컨테이너 크기 변경 감지 (더 정확함)
  const scoreboardDisplay = document.querySelector('#indoorTrainingDashboardScreen .scoreboard-display');
  if (scoreboardDisplay && window.ResizeObserver) {
    // 기존 ResizeObserver 제거 (중복 방지)
    if (window.indoorTrainingState.scoreboardResizeObserver) {
      window.indoorTrainingState.scoreboardResizeObserver.disconnect();
    }
    
    const resizeObserver = new ResizeObserver((entries) => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // 현재 워크아웃이 있고 세그먼트 그래프가 표시 중이면 크기 재조정
        if (window.indoorTrainingState.currentWorkout) {
          const currentSegmentIndex = window.indoorTrainingState.currentSegmentIndex || 0;
          displayWorkoutSegmentGraph(window.indoorTrainingState.currentWorkout, currentSegmentIndex);
        }
      }, 250); // 디바운싱: 250ms 지연
    });
    
    resizeObserver.observe(scoreboardDisplay);
    window.indoorTrainingState.scoreboardResizeObserver = resizeObserver;
    // [추가] 부드러운 바늘 움직임을 위한 애니메이션 루프 시작
      startGaugeAnimationLoop();
    
  }
  
  // Firebase에서 트랙 정보 자동 업데이트 (화면 로딩 시)
  // 약간의 지연을 두어 DOM이 완전히 렌더링된 후 실행
  setTimeout(() => {
    if (typeof updateTracksFromFirebase === 'function') {
      console.log('[Indoor Training] 화면 로딩 시 Firebase에서 트랙 정보 자동 업데이트 시작');
      updateTracksFromFirebase().catch(error => {
        console.error('[Indoor Training] 화면 로딩 시 트랙 정보 업데이트 실패:', error);
      });
    }
  }, 500); // 500ms 지연
  
  // 개인 훈련 화면의 버튼에 Indoor Training 함수 연결
  const btnTogglePauseTraining = document.getElementById('btnTogglePauseTraining');
  const btnSkipSegmentTraining = document.getElementById('btnSkipSegmentTraining');
  const btnStopTrainingIndoor = document.getElementById('btnStopTrainingIndoor');
  
  if (btnTogglePauseTraining) {
    // 기존 이벤트 리스너 제거 후 새로 연결
    btnTogglePauseTraining.replaceWith(btnTogglePauseTraining.cloneNode(true));
    const newBtnTogglePause = document.getElementById('btnTogglePauseTraining');
    if (newBtnTogglePause) {
      newBtnTogglePause.addEventListener('click', toggleStartPauseTraining);
      // 초기 상태를 시작 버튼(play)으로 설정
      newBtnTogglePause.className = 'enhanced-control-btn play';
      newBtnTogglePause.setAttribute('aria-label', '시작');
      newBtnTogglePause.setAttribute('title', '시작');
    }
  }
  
  if (btnSkipSegmentTraining) {
    btnSkipSegmentTraining.replaceWith(btnSkipSegmentTraining.cloneNode(true));
    const newBtnSkip = document.getElementById('btnSkipSegmentTraining');
    if (newBtnSkip) {
      newBtnSkip.addEventListener('click', skipCurrentSegmentTraining);
    }
  }
  
  if (btnStopTrainingIndoor) {
    btnStopTrainingIndoor.replaceWith(btnStopTrainingIndoor.cloneNode(true));
    const newBtnStop = document.getElementById('btnStopTrainingIndoor');
    if (newBtnStop) {
      newBtnStop.addEventListener('click', stopTraining);
    }
  }
  
  // 초기 버튼 상태 업데이트
  updateTrainingButtons();
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
/**
 * 파워계 요소 생성
 */
function createPowerMeterElement(powerMeter) {
  const container = document.createElement('div');
  container.className = 'speedometer-container';
  container.id = `power-meter-${powerMeter.id}`;
  container.dataset.powerMeterId = powerMeter.id;
  
  // 현재 사용자의 grade 확인 (openPowerMeterSettings와 동일한 로직)
  let viewerGrade = '2'; // 기본값
  let gradeSource = 'default';
  
  // 1) getViewerGrade 함수 사용
  if (typeof getViewerGrade === 'function') {
    try {
      viewerGrade = String(getViewerGrade());
      gradeSource = 'getViewerGrade';
    } catch (e) {
      console.warn('[Indoor Training] getViewerGrade() 호출 실패:', e);
    }
  }
  
  // 2) getViewerGrade가 실패했거나 없으면 window.currentUser 확인
  if (viewerGrade === '2' && window.currentUser) {
    if (window.currentUser.grade != null) {
      viewerGrade = String(window.currentUser.grade);
      gradeSource = 'window.currentUser';
    }
  }
  
  // 3) window.currentUser에도 없으면 localStorage 확인
  if (viewerGrade === '2') {
    try {
      const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (storedUser && storedUser.grade != null) {
        viewerGrade = String(storedUser.grade);
        gradeSource = 'localStorage.currentUser';
      }
    } catch (e) {
      console.warn('[Indoor Training] localStorage.currentUser 파싱 실패:', e);
    }
  }
  
  // 4) authUser도 확인
  if (viewerGrade === '2') {
    try {
      const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
      if (authUser && authUser.grade != null) {
        viewerGrade = String(authUser.grade);
        gradeSource = 'localStorage.authUser';
      }
    } catch (e) {
      console.warn('[Indoor Training] localStorage.authUser 파싱 실패:', e);
    }
  }
  
  const isGrade1 = viewerGrade === '1' || viewerGrade === 1;
  const isGrade2 = viewerGrade === '2' || viewerGrade === 2;
  const isGrade3 = viewerGrade === '3' || viewerGrade === 3;
  const isTrack1 = powerMeter.id === 1;
  
  // 권한 체크: grade=1,3은 모든 트랙 활성화, grade=2는 트랙1만 활성화
  const isTrackDisabled = isGrade2 && !isTrack1; // grade=2이고 트랙1이 아니면 비활성화
  
  // 디버깅 로그 (처음 생성 시에만)
  if (powerMeter.id === 1) {
    console.log('[Indoor Training] 트랙 버튼 권한 확인:', {
      viewerGrade: viewerGrade,
      gradeSource: gradeSource,
      isGrade1: isGrade1,
      isGrade2: isGrade2,
      isGrade3: isGrade3,
      trackNumber: powerMeter.id,
      isTrackDisabled: isTrackDisabled,
      currentUser: window.currentUser ? {
        id: window.currentUser.id,
        name: window.currentUser.name,
        grade: window.currentUser.grade
      } : null
    });
  }
  
  // 트랙 버튼 스타일 및 클릭 이벤트 설정
  const trackButtonStyle = isTrackDisabled 
    ? 'background: rgba(100, 100, 100, 0.5) !important; color: #999999 !important; cursor: not-allowed !important; opacity: 0.5 !important;'
    : 'background: rgba(0, 212, 170, 0.5) !important; color: #ffffff !important; cursor: pointer !important;';
  const trackButtonOnclick = isTrackDisabled ? '' : `onclick="openPowerMeterSettings(${powerMeter.id})"`;
  const pairingNameOnclick = isTrackDisabled ? '' : `onclick="openPowerMeterSettings(${powerMeter.id})"`;
  const pairingNameStyle = isTrackDisabled 
    ? 'font-size: 11px !important; color: #999999 !important; font-weight: 400 !important; text-align: left !important; opacity: 0.5 !important; cursor: not-allowed !important;'
    : 'font-size: 11px !important; color: #ffffff !important; font-weight: 400 !important; text-align: left !important; opacity: 0.8 !important; cursor: pointer !important;';
  
  container.innerHTML = `
    <div class="speedometer-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; position: relative !important;">
      <div style="display: flex !important; flex-direction: column !important; align-items: flex-start !important; flex: 0 0 auto !important; min-width: 100px !important; order: 1 !important;">
        <div style="display: ${powerMeter.userName ? 'flex' : 'none'} !important; align-items: center !important; flex-wrap: wrap !important;">
          <span class="speedometer-user-name" id="user-name-${powerMeter.id}" style="font-size: 13px !important; color: #ffffff !important; font-weight: 600 !important; text-align: left !important; margin-bottom: 2px !important;">${powerMeter.userName || ''}</span>
        </div>
      </div>
      <span class="speedometer-name" style="position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; font-weight: 600 !important; text-align: center !important; order: 2 !important; z-index: 1 !important; ${trackButtonStyle} padding: 6px 12px !important; border-radius: 8px !important; display: inline-block !important;" ${trackButtonOnclick}>트랙${powerMeter.id}</span>
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
  
  // FTP 값 확인: 해당 트랙의 FTP 값만 사용 (다른 트랙의 FTP 값 사용하지 않음)
  // 미연결 상태일 때는 0, 0.33, 0.67, 1, 1.33, 1.67, 2로 표시되어야 함
  const ftp = powerMeter.userFTP || null;
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
      // pos=60 → 1×FTP (빨강색), pos=40 → 1.33×FTP, pos=20 → 1.67×FTP, pos=0 → 2×FTP
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
      
      // 1×FTP는 빨강색으로 표기, 나머지는 흰색
      const textColor = isOneFTP ? '#ef4444' : '#ffffff';
      
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

/**
 * [수정됨] 데이터 수신 시 호출되는 함수
 * - 바늘/궤적 제어권은 애니메이션 루프로 넘기고, 여기서는 텍스트 값만 즉시 갱신
 */
function updatePowerMeterNeedle(powerMeterId, power) {
    const powerMeter = window.indoorTrainingState.powerMeters.find(pm => pm.id === powerMeterId);
    if (!powerMeter) return;
    
    // 텍스트는 즉각 반응해야 하므로 여기서 바로 업데이트
    const textEl = document.getElementById(`current-power-value-${powerMeterId}`);
    if (textEl) {
        textEl.textContent = Math.round(power);
    }
    
    // 이전 파워값 저장 (로직 유지용)
    powerMeter.previousPower = power;
    
    // 주의: 여기서 updatePowerMeterTrail이나 setAttribute('transform')을 호출하지 않습니다.
    // 그 역할은 startGaugeAnimationLoop가 수행합니다.
}


/**
 * [현존 최고 로직] 게이지 애니메이션 루프 (60FPS 보간 이동)
 * - 바늘은 매 프레임 부드럽게 이동 (Lerp 적용)
 * - 궤적은 눈금 개수가 변할 때만 다시 그려 성능 최적화
 */
function startGaugeAnimationLoop() {
    const loop = () => {
        // 훈련 상태나 파워미터 목록이 없으면 루프만 유지
        if (!window.indoorTrainingState || !window.indoorTrainingState.powerMeters) {
            requestAnimationFrame(loop);
            return;
        }

        window.indoorTrainingState.powerMeters.forEach(pm => {
            if (!pm.connected) return;

            // 1. 목표값(currentPower)과 현재표시값(displayPower)의 차이 계산
            // 목표값은 updatePowerMeterData에서 갱신됨
            const target = pm.currentPower || 0;
            const current = pm.displayPower || 0;
            const diff = target - current;

            // 2. 보간(Interpolation) 적용: 거리가 멀면 빠르게, 가까우면 천천히 (감속 효과)
            // 0.15는 반응속도 계수 (높을수록 빠름, 낮을수록 부드러움. 0.1~0.2 추천)
            if (Math.abs(diff) > 0.1) {
                pm.displayPower = current + diff * 0.15;
            } else {
                pm.displayPower = target; // 차이가 미세하면 목표값으로 고정 (떨림 방지)
            }

            // 3. 바늘 각도 계산 및 업데이트 (매 프레임 실행)
            const ftp = pm.userFTP || window.indoorTrainingState?.userFTP || 200;
            const maxPower = ftp * 2;
            let ratio = Math.min(Math.max(pm.displayPower / maxPower, 0), 1);
            const angle = -90 + (ratio * 180);

            const needleEl = document.getElementById(`needle-${pm.id}`);
            if (needleEl) {
                // CSS Transition 간섭 제거하고 직접 제어
                needleEl.style.transition = 'none'; 
                needleEl.setAttribute('transform', `rotate(${angle})`);
            }

            // 4. 궤적(Radial Lines) 업데이트 (최적화 적용)
            // 매 프레임 그리면 성능 저하되므로, 눈금(Tick) 개수가 바뀔 때만 그리기 함수 호출
            // updatePowerMeterTrail 내부에서 displayPower를 사용하여 그립니다.
            updatePowerMeterTrailOptimized(pm.id, pm.displayPower, angle, pm);
        });

        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

/**
 * [최적화] 궤적 업데이트 (변경된 경우에만 그리기)
 */
function updatePowerMeterTrailOptimized(powerMeterId, displayPower, currentAngle, powerMeter) {
    // 기존 updatePowerMeterTrail 로직을 활용하되, 그리기 빈도 제어
    const ftp = powerMeter.userFTP || window.indoorTrainingState?.userFTP || 200;
    const maxPower = ftp * 2;
    
    // 현재 파워를 스케일(0~120)로 변환했을 때의 눈금 위치
    const maxScalePos = 120;
    const tickInterval = 2.5;
    
    let currentScalePos = 0;
    if (maxPower > 0) {
        currentScalePos = Math.min(displayPower / maxPower, 1.0) * maxScalePos;
    }
    
    // 현재 그려져야 할 눈금의 개수 (정수형)
    const tickCount = Math.floor(currentScalePos / tickInterval);
    
    // 훈련 상태가 변경되었거나, 눈금 개수가 달라졌을 때만 다시 그리기 (성능 보호)
    // 단, 목표 파워 궤적(Target Arc)이 변경될 수 있으므로 워크아웃 중에는 조금 더 자주 갱신 가능
    const isTrainingRunning = window.indoorTrainingState.trainingState === 'running';
    
    // 상태가 변했거나 눈금 개수가 다르면 그리기 수행
    if (powerMeter.lastDrawnTickCount !== tickCount || 
        powerMeter.lastTrainingState !== isTrainingRunning) {
        
        // 기존 함수 호출 (이제 displayPower를 기반으로 그려짐)
        updatePowerMeterTrail(powerMeterId, displayPower, currentAngle, powerMeter);
        
        // 상태 저장
        powerMeter.lastDrawnTickCount = tickCount;
        powerMeter.lastTrainingState = isTrainingRunning;
    }
}





/**
 * 바늘 각도에서 파워값으로 역변환 (궤적선 동기화용)
 */
function calculatePowerFromAngle(angle, maxPower) {
    // 각도: -90도 ~ 90도
    // ratio: 0 ~ 1
    const ratio = (angle + 90) / 180;
    return ratio * maxPower;
}

/**
 * [정밀 구현] 파워미터 바늘 궤적 업데이트 관리자
 * - 바늘 움직임(currentPower)에 따라 즉시 반응
 * - 워크아웃 상태 및 랩파워 달성률에 따라 색상 결정 정보 전달
 */
function updatePowerMeterTrail(powerMeterId, currentPower, currentAngle, powerMeter) {
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
    const ftp = powerMeter.userFTP || window.indoorTrainingState?.userFTP || 200;
    const maxPower = ftp * 2; // 게이지 최대값 (FTP의 200%)
    
    // 2. 훈련 상태 확인
    const isTrainingRunning = window.indoorTrainingState && window.indoorTrainingState.trainingState === 'running';
    
    // 3. 목표 파워 및 랩파워 데이터 준비 (워크아웃 중일 때만 유효)
    let targetPower = 0;
    let segmentPower = 0;
    
    if (window.indoorTrainingState.currentWorkout && window.indoorTrainingState.currentWorkout.segments) {
        const segments = window.indoorTrainingState.currentWorkout.segments;
        const currentSegmentIndex = window.indoorTrainingState.currentSegmentIndex || 0;
        const currentSegment = segments[currentSegmentIndex] || segments[0]; 
        
        // 목표 파워 계산
        if (currentSegment) {
            let ftpPercent = 100; // 기본값
            const targetValue = currentSegment.target_value || currentSegment.target || '100';
            
            if (typeof targetValue === 'string') {
                if (targetValue.includes('/')) {
                    // "100/120" 등의 형식일 경우 앞의 값 사용
                    ftpPercent = Number(targetValue.split('/')[0].trim().replace('%', '')) || 100;
                } else {
                    ftpPercent = Number(targetValue.replace('%', '')) || 100;
                }
            } else if (typeof targetValue === 'number') {
                ftpPercent = targetValue;
            }
            targetPower = (ftp * ftpPercent) / 100;
        }
        
        // 현재 랩파워 (Segment Average Power) 가져오기
        segmentPower = powerMeter.segmentPower || 0;
    }
    
    // 목표 파워 텍스트 업데이트 (목표가 있을 때만 표시)
    if (targetTextEl) {
        targetTextEl.textContent = (isTrainingRunning && targetPower > 0) ? Math.round(targetPower) : '';
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
    drawPowerMeterTrail(
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
 * 파워미터 바늘 궤적 그리기 (SVG)
 * 1. 목표 파워 원둘레선: 진한 투명 주황색 (두께 = 작은 눈금 높이)
 * 2. 바늘 궤적선: 98.5% 달성률 기준 민트/주황 분기
 * 3. 동작 방식: 바늘 위치(Value)에 따라 즉시 생성/삭제 (잔상 없음)
 */
function drawPowerMeterTrail(container, targetAngle, targetPower, currentPower, segmentPower, maxPower, isTrainingRunning) {
    // [핵심] 매 프레임 초기화로 잔상 완벽 제거
    container.innerHTML = '';
    
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
    // A. 목표 파워 궤적 (원둘레 호)
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
  const statusTextEl = document.getElementById(`status-text-${powerMeterId}`);
  
  // 조건 확인
  const hasUser = !!(powerMeter.userId);
  const hasReceiver = !!(window.antState && window.antState.usbDevice && window.antState.usbDevice.opened);
  const hasPowerDevice = !!(powerMeter.deviceId || powerMeter.trainerDeviceId);
  const hasHeartRateDevice = !!(powerMeter.heartRateDeviceId);
  const hasAnyDevice = hasPowerDevice || hasHeartRateDevice; // 파워메터/스마트로라/심박계 중 하나라도 있으면
  const hasData = powerMeter.currentPower > 0 || powerMeter.heartRate > 0 || powerMeter.cadence > 0;
  
  let statusClass = 'disconnected';
  let statusText = '미연결';
  
  // 연결 상태 판단 (새로운 로직)
  if (!hasUser) {
    // 사용자 미지정
    statusClass = 'disconnected';
    statusText = '미연결';
    powerMeter.connected = false;
  } else if (hasUser && hasAnyDevice) {
    // 사용자 지정 + 파워미터/스마트로라/심박계 정보 저장된 상태
    // "준비됨" 상태는 hasData 체크 없이 표시 (화면 재접속 시에도 올바르게 표시)
    if (hasReceiver && hasData) {
      // 수신기 연결 + 데이터 수신 중
      statusClass = 'connected';
      statusText = '연결됨';
      powerMeter.connected = true;
    } else {
      // 디바이스 정보는 있지만 수신기 미연결 또는 데이터 미수신
      // 화면 재접속 시에도 "준비됨"으로 표시되어야 함
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
  
  // 상태 표시 업데이트
  const deviceIconsEl = document.getElementById(`device-icons-${powerMeterId}`);
  const statusDotEl = document.getElementById(`status-dot-${powerMeterId}`);
  
  if (statusTextEl) {
    statusTextEl.textContent = statusText;
  }
  
  // 상태 점 표시/숨김 처리
  if (statusDotEl) {
    if (statusClass === 'disconnected') {
      // 미연결 상태: 빨간 원 표시
      statusDotEl.style.display = 'inline-block';
      statusDotEl.classList.remove('ready', 'connected');
      statusDotEl.classList.add('disconnected');
    } else {
      // 준비됨 또는 연결됨 상태: 점 숨김
      statusDotEl.style.display = 'none';
    }
  }
  
  // 디바이스 아이콘 표시/숨김 처리
  if (deviceIconsEl) {
    if (statusClass === 'ready' || statusClass === 'connected') {
      // 준비됨 또는 연결됨 상태: 등록된 기기 이미지 표시 (상태에 따라 다른 이미지 사용)
      deviceIconsEl.style.display = 'inline-flex';
      updateDeviceIcons(powerMeterId, statusClass);
    } else {
      // 미연결 상태: 디바이스 아이콘 숨김
      deviceIconsEl.style.display = 'none';
    }
  }
  
  // 속도계 모양 아래 파워 정보창 색상 제거 (주황색/녹색등 제거)
  const infoEl = document.querySelector(`#power-meter-${powerMeterId} .speedometer-info`);
  if (infoEl) {
    // 모든 색상 클래스 제거 (기본 스타일만 유지)
    infoEl.classList.remove('connected', 'warning', 'disconnected');
    
    // 정보표시창 색상 변경 시 랩파워 색상도 업데이트 (항상 검정색)
    const segPowerEl = document.getElementById(`segment-power-value-${powerMeterId}`);
    if (segPowerEl) {
      // 랩파워는 항상 검정색
      segPowerEl.style.color = '#000000'; // 검정색
    }
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
/**
 * 파워미터 데이터 업데이트 및 UI(바늘 포함) 반영
 */
function updatePowerMeterData(powerMeterId, power, heartRate = 0, cadence = 0) {
    const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
    if (!powerMeter) return;

    // 1. 데이터 저장 (유효 범위 체크)
    if (power >= 0 && power <= 2000) {
        powerMeter.currentPower = power;
        powerMeter.powerFiltered = power;
        
        // [추가됨] 워크아웃 실행 중('running')일 때만 통계 집계
        if (window.indoorTrainingState.trainingState === 'running') {
            // A. 최대 파워 갱신
            if (power > powerMeter.maxPower) {
                powerMeter.maxPower = power;
            }
            
            // B. 워크아웃 전체 평균 파워 (단순 평균)
            // 0W도 포함해서 평균을 내야 정확함 (코스팅 등 고려)
            powerMeter.powerSum += power;
            powerMeter.powerCount++;
            powerMeter.averagePower = Math.round(powerMeter.powerSum / powerMeter.powerCount);
            
            // C. 세그먼트 평균 파워
            powerMeter.segmentPowerSum += power;
            powerMeter.segmentPowerCount++;
            powerMeter.segmentPower = Math.round(powerMeter.segmentPowerSum / powerMeter.segmentPowerCount);
        }
    }
    
    if (cadence >= 0 && cadence <= 254) {
        powerMeter.cadence = cadence;
    }
    
    powerMeter.heartRate = heartRate;
    powerMeter.lastUpdateTime = Date.now();

    // 2. 바늘(Needle) 각도 계산
    const userFTP = powerMeter.userFTP || window.indoorTrainingState?.userFTP || 200;
    const maxGaugePower = userFTP * 2;
    const validPower = (power >= 0 && power <= 2000) ? power : powerMeter.currentPower;
    
    let powerRatio = validPower / maxGaugePower;
    if (powerRatio > 1) powerRatio = 1;
    if (powerRatio < 0) powerRatio = 0;

    const angle = -90 + (powerRatio * 180);

    // 3. UI 업데이트
    // 현재 파워값
    const currentPowerEl = document.getElementById(`current-power-value-${powerMeterId}`);
    if (currentPowerEl) {
        const displayPower = (power >= 0 && power <= 2000) ? power : powerMeter.currentPower;
        currentPowerEl.textContent = Math.round(displayPower);
    }
    
    // [추가됨] 통계 값 UI 업데이트 (최대, 평균, 세그먼트)
    const maxPowerEl = document.getElementById(`max-power-value-${powerMeterId}`);
    const avgPowerEl = document.getElementById(`avg-power-value-${powerMeterId}`);
    const segPowerEl = document.getElementById(`segment-power-value-${powerMeterId}`);
    
    if (maxPowerEl) maxPowerEl.textContent = Math.round(powerMeter.maxPower);
    if (avgPowerEl) avgPowerEl.textContent = Math.round(powerMeter.averagePower);
    if (segPowerEl) {
        segPowerEl.textContent = Math.round(powerMeter.segmentPower);
        
        // 랩파워 색상 설정: 항상 검정색
        segPowerEl.style.color = '#000000'; // 검정색
    }

    // 케이던스
    const cadenceEl = document.getElementById(`cadence-value-${powerMeterId}`);
    if (cadenceEl) {
        const cadenceValue = (typeof cadence === 'number' && cadence >= 0 && cadence <= 254) ? Math.round(cadence) : 0;
        cadenceEl.textContent = cadenceValue.toString();
        cadenceEl.style.display = '';
    }

    // 심박수 (찐녹색으로 표시)
    const heartRateEl = document.getElementById(`heart-rate-value-${powerMeterId}`);
    if (heartRateEl && heartRate > 0) {
        heartRateEl.textContent = Math.round(heartRate);
        heartRateEl.style.color = '#006400'; // 찐녹색
    } else if (heartRateEl) {
        heartRateEl.style.color = ''; // 기본 색상으로 복원
    }

    // 바늘 애니메이션
    const needleEl = document.getElementById(`needle-${powerMeterId}`);
    if (needleEl) {
        needleEl.setAttribute('transform', `rotate(${angle})`);
        needleEl.style.visibility = 'visible';
    }
    
    // 연결 상태 업데이트
    updatePowerMeterConnectionStatus(powerMeterId);
}

/**
 * 전광판 업데이트
 */
function updateScoreboard() {
  // 경과시간
  const elapsedEl = document.getElementById('trainingElapsedTime');
  if (elapsedEl) {
    const elapsed = Math.max(0, window.indoorTrainingState.totalElapsedTime || 0); // 음수 방지
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
 * 세그먼트 그래프 초기화 (사용 안 함 - 가운데 그래프 삭제됨)
 */
function initSegmentGraph() {
  // 가운데 세그먼트 그래프는 완전히 삭제되었으므로 아무 작업도 하지 않음
  return;
}

/**
 * 세그먼트 그래프 그리기 (사용 안 함 - 가운데 그래프 제거됨)
 * 우측 그래프만 사용하므로 이 함수는 호출하지 않음
 */
function drawTrainingSegmentGraph() {
  // 가운데 세그먼트 그래프는 사용하지 않음 (우측 그래프만 사용)
  return;
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
  
  // 권한 체크: grade=1,3은 모든 트랙 사용 가능, grade=2는 트랙1만 사용 가능
  // getViewerGrade 함수가 있으면 사용, 없으면 window.currentUser나 localStorage에서 가져오기
  let viewerGrade = '2'; // 기본값
  let gradeSource = 'default';
  
  // 1) getViewerGrade 함수 사용
  if (typeof getViewerGrade === 'function') {
    try {
      viewerGrade = String(getViewerGrade());
      gradeSource = 'getViewerGrade';
    } catch (e) {
      console.warn('[Indoor Training] getViewerGrade() 호출 실패:', e);
    }
  }
  
  // 2) getViewerGrade가 실패했거나 없으면 window.currentUser 확인
  if (viewerGrade === '2' && window.currentUser) {
    if (window.currentUser.grade != null) {
      viewerGrade = String(window.currentUser.grade);
      gradeSource = 'window.currentUser';
    }
  }
  
  // 3) window.currentUser에도 없으면 localStorage 확인
  if (viewerGrade === '2') {
    try {
      const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (storedUser && storedUser.grade != null) {
        viewerGrade = String(storedUser.grade);
        gradeSource = 'localStorage.currentUser';
      }
    } catch (e) {
      console.warn('[Indoor Training] localStorage.currentUser 파싱 실패:', e);
    }
  }
  
  // 4) authUser도 확인
  if (viewerGrade === '2') {
    try {
      const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
      if (authUser && authUser.grade != null) {
        viewerGrade = String(authUser.grade);
        gradeSource = 'localStorage.authUser';
      }
    } catch (e) {
      console.warn('[Indoor Training] localStorage.authUser 파싱 실패:', e);
    }
  }
  
  const isGrade1 = viewerGrade === '1' || viewerGrade === 1;
  const isGrade2 = viewerGrade === '2' || viewerGrade === 2;
  const isGrade3 = viewerGrade === '3' || viewerGrade === 3;
  const isTrack1 = powerMeterId === 1;
  
  console.log('[Indoor Training] 트랙 버튼 클릭 권한 확인:', {
    viewerGrade: viewerGrade,
    gradeSource: gradeSource,
    isGrade1: isGrade1,
    isGrade2: isGrade2,
    isGrade3: isGrade3,
    trackNumber: powerMeterId,
    isTrack1: isTrack1,
    currentUser: window.currentUser ? {
      id: window.currentUser.id,
      name: window.currentUser.name,
      grade: window.currentUser.grade
    } : null,
    localStorage_currentUser: (() => {
      try {
        const u = JSON.parse(localStorage.getItem('currentUser') || 'null');
        return u ? { id: u.id, name: u.name, grade: u.grade } : null;
      } catch (e) { return null; }
    })(),
    localStorage_authUser: (() => {
      try {
        const u = JSON.parse(localStorage.getItem('authUser') || 'null');
        return u ? { id: u.id, name: u.name, grade: u.grade } : null;
      } catch (e) { return null; }
    })()
  });
  
  // grade=2 사용자는 트랙1만 사용 가능
  if (isGrade2 && !isTrack1) {
    if (typeof showToast === 'function') {
      showToast('일반 사용자(grade=2)는 트랙1만 사용할 수 있습니다.');
    }
    console.warn('[Indoor Training] 권한 없음: grade=2 사용자는 트랙1만 사용 가능', {
      viewerGrade: viewerGrade,
      gradeSource: gradeSource,
      trackNumber: powerMeterId
    });
    return;
  }
  
  // grade=1,3은 모든 트랙 사용 가능 (추가 체크 없음)
  
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
  // 선택된 사용자 카드 영역 업데이트
  const selectedUserCard = document.getElementById('pairingSelectedUserCard');
  
  if (powerMeter.userId && powerMeter.userName) {
    // 선택된 사용자가 있으면 카드 표시
    if (selectedUserCard) {
      const wkg = powerMeter.userFTP && powerMeter.userWeight ? (powerMeter.userFTP / powerMeter.userWeight).toFixed(1) : '-';
      selectedUserCard.innerHTML = `
        <div style="padding: 16px; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-size: 18px; font-weight: 600; color: #155724; margin-bottom: 8px;">${powerMeter.userName}</div>
              <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #155724;">
                <span><strong>FTP:</strong> ${powerMeter.userFTP || '-'}W</span>
                <span><strong>체중:</strong> ${powerMeter.userWeight || '-'}kg</span>
                <span><strong>W/kg:</strong> ${wkg}</span>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearSelectedUser()" style="white-space: nowrap; margin-left: 16px;">선택 해제</button>
          </div>
        </div>
      `;
      selectedUserCard.style.display = 'block';
    }
    
    // 검색 결과 영역은 비워둠
    const resultEl = document.getElementById('pairingUserSearchResult');
    if (resultEl) {
      resultEl.innerHTML = '';
    }
    
    // Gear, Brake 선택 필드에 값 설정
    const gearSelect = document.getElementById('pairingGearSelect');
    const brakeSelect = document.getElementById('pairingBrakeSelect');
    if (gearSelect) {
      gearSelect.value = powerMeter.gear || '';
    }
    if (brakeSelect) {
      brakeSelect.value = powerMeter.brake || '';
    }
  } else {
    // 선택된 사용자가 없으면 카드 숨김
    if (selectedUserCard) {
      selectedUserCard.style.display = 'none';
      selectedUserCard.innerHTML = '';
    }
    
    // 검색 결과 영역도 비움
    const resultEl = document.getElementById('pairingUserSearchResult');
    if (resultEl) {
      resultEl.innerHTML = '';
    }
    
    // Gear, Brake 선택 필드 비우기
    const gearSelect = document.getElementById('pairingGearSelect');
    const brakeSelect = document.getElementById('pairingBrakeSelect');
    if (gearSelect) {
      gearSelect.value = '';
    }
    if (brakeSelect) {
      brakeSelect.value = '';
    }
  }
  
  // 스마트로라 정보 표시
  const trainerSelectedCard = document.getElementById('trainerSelectedDeviceCard');
  if (powerMeter.trainerDeviceId) {
    const trainerNameEl = document.getElementById('trainerPairingName');
    const trainerDeviceIdEl = document.getElementById('trainerDeviceId');
    const btnClearTrainer = document.getElementById('btnClearTrainer');
    if (trainerNameEl) trainerNameEl.value = powerMeter.trainerName || '';
    if (trainerDeviceIdEl) trainerDeviceIdEl.value = powerMeter.trainerDeviceId || '';
    if (btnClearTrainer) btnClearTrainer.style.display = 'block';
    
    // 페어링된 스마트로라 카드 표시 (사용자 선택 카드와 동일한 스타일)
    if (trainerSelectedCard) {
      trainerSelectedCard.innerHTML = `
        <div style="padding: 16px; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-size: 18px; font-weight: 600; color: #155724; margin-bottom: 8px;">${powerMeter.trainerName || '스마트로라'}</div>
              <div style="font-size: 14px; color: #155724;">
                <span><strong>디바이스 ID:</strong> ${powerMeter.trainerDeviceId || '-'}</span>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearPairedDevice('trainer')" style="white-space: nowrap; margin-left: 16px;">선택 해제</button>
          </div>
        </div>
      `;
      trainerSelectedCard.style.display = 'block';
    }
  } else {
    const btnClearTrainer = document.getElementById('btnClearTrainer');
    if (btnClearTrainer) btnClearTrainer.style.display = 'none';
    if (trainerSelectedCard) {
      trainerSelectedCard.style.display = 'none';
      trainerSelectedCard.innerHTML = '';
    }
  }
  
  // 파워메터 정보 표시
  const powerSelectedCard = document.getElementById('powerSelectedDeviceCard');
  if (powerMeter.deviceId) {
    const powerNameEl = document.getElementById('powerMeterPairingName');
    const powerDeviceIdEl = document.getElementById('powerMeterDeviceId');
    const btnClearPower = document.getElementById('btnClearPower');
    if (powerNameEl) powerNameEl.value = powerMeter.pairingName || '';
    if (powerDeviceIdEl) powerDeviceIdEl.value = powerMeter.deviceId || '';
    if (btnClearPower) btnClearPower.style.display = 'block';
    
    // 페어링된 파워메터 카드 표시 (사용자 선택 카드와 동일한 스타일)
    if (powerSelectedCard) {
      powerSelectedCard.innerHTML = `
        <div style="padding: 16px; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-size: 18px; font-weight: 600; color: #155724; margin-bottom: 8px;">${powerMeter.pairingName || '파워메터'}</div>
              <div style="font-size: 14px; color: #155724;">
                <span><strong>디바이스 ID:</strong> ${powerMeter.deviceId || '-'}</span>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearPairedDevice('power')" style="white-space: nowrap; margin-left: 16px;">선택 해제</button>
          </div>
        </div>
      `;
      powerSelectedCard.style.display = 'block';
    }
  } else {
    const btnClearPower = document.getElementById('btnClearPower');
    if (btnClearPower) btnClearPower.style.display = 'none';
    if (powerSelectedCard) {
      powerSelectedCard.style.display = 'none';
      powerSelectedCard.innerHTML = '';
    }
  }
  
  // 심박계 정보 표시
  const heartSelectedCard = document.getElementById('heartSelectedDeviceCard');
  if (powerMeter.heartRateDeviceId) {
    const heartNameEl = document.getElementById('heartRatePairingName');
    const heartDeviceIdEl = document.getElementById('heartRateDeviceId');
    const btnClearHeart = document.getElementById('btnClearHeart');
    if (heartNameEl) heartNameEl.value = powerMeter.heartRateName || '';
    if (heartDeviceIdEl) heartDeviceIdEl.value = powerMeter.heartRateDeviceId || '';
    if (btnClearHeart) btnClearHeart.style.display = 'block';
    
    // 페어링된 심박계 카드 표시 (사용자 선택 카드와 동일한 스타일)
    if (heartSelectedCard) {
      heartSelectedCard.innerHTML = `
        <div style="padding: 16px; border: 2px solid #28a745; border-radius: 8px; background: #d4edda;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-size: 18px; font-weight: 600; color: #155724; margin-bottom: 8px;">${powerMeter.heartRateName || '심박계'}</div>
              <div style="font-size: 14px; color: #155724;">
                <span><strong>디바이스 ID:</strong> ${powerMeter.heartRateDeviceId || '-'}</span>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearPairedDevice('heart')" style="white-space: nowrap; margin-left: 16px;">선택 해제</button>
          </div>
        </div>
      `;
      heartSelectedCard.style.display = 'block';
    }
  } else {
    const btnClearHeart = document.getElementById('btnClearHeart');
    if (btnClearHeart) btnClearHeart.style.display = 'none';
    if (heartSelectedCard) {
      heartSelectedCard.style.display = 'none';
      heartSelectedCard.innerHTML = '';
    }
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
  
  // 수신기 활성화 버튼 상태 업데이트 (표시등)
  if (typeof updateReceiverButtonStatus === 'function') {
    updateReceiverButtonStatus();
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
  const powerMeterId = window.currentTargetPowerMeterId;
  const powerMeter = powerMeterId ? window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId) : null;
  
  // 탭 전환 전에 현재 Gear, Brake 값 저장
  const gearSelect = document.getElementById('pairingGearSelect');
  const brakeSelect = document.getElementById('pairingBrakeSelect');
  let savedGear = null;
  let savedBrake = null;
  
  if (gearSelect && gearSelect.value) {
    savedGear = gearSelect.value;
  }
  if (brakeSelect && brakeSelect.value) {
    savedBrake = brakeSelect.value;
  }
  
  // powerMeter 객체에 저장 (다른 탭에서도 유지)
  if (powerMeter) {
    if (savedGear) powerMeter.gear = savedGear;
    if (savedBrake) powerMeter.brake = savedBrake;
  }
  
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
  
  // 사용자 선택 탭인 경우 이름 검색 입력 필드에 포커스
  if (tabName === 'user') {
    setTimeout(() => {
      const nameInput = document.getElementById('pairingUserNameSearch');
      const resultEl = document.getElementById('pairingUserSearchResult');
      
      if (nameInput) {
        nameInput.focus();
        // 초기 로드 시 검색어가 없으면 목록을 비워둠 (검색 후에만 표시)
        if (resultEl && !nameInput.value.trim()) {
          resultEl.innerHTML = '';
        }
      }
      
      // 선택된 사용자 카드 업데이트 (Gear, Brake 값 포함)
      if (powerMeter) {
        updatePairingModalWithSavedData(powerMeter);
      }
    }, 100);
  } else {
    // 다른 탭으로 이동할 때도 Gear, Brake 값 복원
    setTimeout(() => {
      if (powerMeter) {
        const gearSelectAfter = document.getElementById('pairingGearSelect');
        const brakeSelectAfter = document.getElementById('pairingBrakeSelect');
        
        if (gearSelectAfter && powerMeter.gear) {
          gearSelectAfter.value = powerMeter.gear;
        }
        if (brakeSelectAfter && powerMeter.brake) {
          brakeSelectAfter.value = powerMeter.brake;
        }
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
 * 이름으로 사용자 검색 (페어링용)
 */
async function searchUserByNameForPairing() {
  const nameInput = document.getElementById('pairingUserNameSearch');
  const resultEl = document.getElementById('pairingUserSearchResult');
  const searchBtn = document.getElementById('btnSearchUserByName');
  
  if (!nameInput || !resultEl) return;
  
  const searchName = nameInput.value.trim();
  
  if (!searchName) {
    // 이름이 없으면 목록 비우기 (검색 후에만 표시)
    resultEl.innerHTML = '';
    return;
  }
  
  // 검색 버튼 비활성화 및 애니메이션
  const originalText = searchBtn ? searchBtn.textContent : '';
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> 검색 중...';
    searchBtn.style.opacity = '0.7';
    searchBtn.style.cursor = 'not-allowed';
  }
  
  // 결과 영역에 로딩 표시
  resultEl.innerHTML = `
    <div style="padding: 40px; text-align: center; color: #10b981;">
      <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid rgba(16, 185, 129, 0.2); border-top-color: #10b981; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
      <p style="margin: 0; font-size: 14px;">사용자 검색 중...</p>
    </div>
  `;
  
  // CSS 애니메이션 추가 (이미 있으면 무시)
  if (!document.getElementById('searchLoadingStyle')) {
    const style = document.createElement('style');
    style.id = 'searchLoadingStyle';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  try {
    // 결과 영역에 필터링된 사용자 목록 표시
    await filterUsersByNameForPairing();
  } catch (error) {
    console.error('[Indoor Training] 사용자 검색 오류:', error);
    resultEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545;">검색 중 오류가 발생했습니다.</div>';
  } finally {
    // 검색 버튼 복원
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = originalText;
      searchBtn.style.opacity = '1';
      searchBtn.style.cursor = 'pointer';
    }
  }
}

/**
 * 이름으로 사용자 필터링 (페어링용)
 */
async function filterUsersByNameForPairing() {
  const nameInput = document.getElementById('pairingUserNameSearch');
  const resultEl = document.getElementById('pairingUserSearchResult');
  
  if (!nameInput || !resultEl) return;
  
  const searchTerm = nameInput.value.trim().toLowerCase();
  
  // 사용자 목록 가져오기
  let allUsers = [];
  try {
    if (typeof apiGetUsers === 'function') {
      const result = await apiGetUsers();
      if (result && result.success && result.items) {
        allUsers = result.items;
      }
    } else if (typeof window.apiGetUsers === 'function') {
      const result = await window.apiGetUsers();
      if (result && result.success && result.items) {
        allUsers = result.items;
      }
    } else if (Array.isArray(window.users)) {
      allUsers = window.users;
    }
  } catch (error) {
    console.error('[Indoor Training] 사용자 목록 로드 오류:', error);
    resultEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545;">사용자 목록을 불러올 수 없습니다.</div>';
    return;
  }
  
  if (allUsers.length === 0) {
    resultEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 사용자가 없습니다.</div>';
    return;
  }
  
  // 검색어가 없으면 목록을 비워둠 (검색 후에만 표시)
  if (!searchTerm) {
    resultEl.innerHTML = '';
    return;
  }
  
  // 이름으로 필터링
  let filteredUsers = allUsers.filter(user => {
    const name = (user.name || '').toLowerCase();
    return name.includes(searchTerm);
  });
  
  if (filteredUsers.length === 0) {
    resultEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999; border: 1px solid #ddd; border-radius: 8px;">
        <p style="margin: 0;">검색 결과가 없습니다.</p>
      </div>
    `;
    return;
  }
  
  // 필터링된 사용자 목록 표시
  const powerMeterId = window.currentTargetPowerMeterId;
  const userListHtml = filteredUsers.map(user => {
    const wkg = user.ftp && user.weight ? (user.ftp / user.weight).toFixed(1) : '-';
    
    // 중복 체크: 다른 트랙에서 이미 사용 중인지 확인
    const isAlreadyPaired = window.indoorTrainingState.powerMeters.some(pm => 
      pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(user.id)
    );
    
    let warningMessage = '';
    let selectButton = '';
    
    if (isAlreadyPaired) {
      const pairedTrack = window.indoorTrainingState.powerMeters.find(pm => 
        pm.id !== powerMeterId && pm.userId && String(pm.userId) === String(user.id)
      );
      warningMessage = `<div style="padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; margin-bottom: 12px; color: #856404; font-size: 12px;">⚠️ 이 사용자는 이미 트랙${pairedTrack?.id || '?'}에서 사용 중입니다.</div>`;
      selectButton = `<button class="btn btn-secondary" style="width: 100%;" disabled>이미 사용 중</button>`;
    } else {
      selectButton = `<button class="btn btn-primary" style="width: 100%;" onclick="event.stopPropagation(); selectSearchedUserForPowerMeter(${user.id})">선택</button>`;
    }
    
    return `
      <div class="user-card-compact" style="padding: 16px; margin-bottom: 12px; border: 2px solid #007bff; border-radius: 8px; background: #f0f7ff;">
        ${warningMessage}
        <div class="user-info">
          <div class="user-name" style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">${user.name || '-'}</div>
          <div class="user-stats-compact" style="display: flex; gap: 16px; flex-wrap: wrap;">
            <span style="font-size: 14px;"><strong>FTP:</strong> ${user.ftp || '-'}W</span>
            <span style="font-size: 14px;"><strong>체중:</strong> ${user.weight || '-'}kg</span>
            <span style="font-size: 14px;"><strong>W/kg:</strong> ${wkg}</span>
          </div>
        </div>
        <div style="margin-top: 12px; text-align: center;">
          ${selectButton}
        </div>
      </div>
    `;
  }).join('');
  
  resultEl.innerHTML = `<div style="max-height: 400px; overflow-y: auto;">${userListHtml}</div>`;
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
        
        // Gear, Brake 정보 읽기
        const gearSelect = document.getElementById('pairingGearSelect');
        const brakeSelect = document.getElementById('pairingBrakeSelect');
        const gear = gearSelect ? gearSelect.value : '';
        const brake = brakeSelect ? brakeSelect.value : '';
        
        // 파워계에 사용자 정보 저장
        powerMeter.userId = userId;
        powerMeter.userFTP = user.ftp || null; // FTP 값 저장 (null 체크)
        powerMeter.userName = user.name;
        powerMeter.userWeight = user.weight;
        powerMeter.userContact = user.contact;
        powerMeter.gear = gear || null; // Gear 정보 저장
        powerMeter.brake = brake || null; // Brake 정보 저장
        
        console.log(`[Indoor Training] 파워미터 ${powerMeterId}에 사용자 할당:`, {
          userId: userId,
          userName: user.name,
          userFTP: powerMeter.userFTP,
          gear: powerMeter.gear,
          brake: powerMeter.brake
        });
        
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
        
        // Firebase에 사용자 정보 저장 (Player List와 동일한 구조)
        // sessions/{roomId}/users/{trackNumber} 경로에 저장
        if (typeof db !== 'undefined') {
          // SESSION_ID 가져오기 (Training Room id)
          const sessionId = getSessionId();
          
          if (sessionId) {
            // Player List 화면과 동일한 데이터 구조로 저장
            const userData = {
              userId: String(powerMeter.userId || ''),
              userName: powerMeter.userName || '',
              weight: powerMeter.userWeight || 0,
              ftp: powerMeter.userFTP || 0
            };
            
            // Firebase Users에 저장
            const userRef = db.ref(`sessions/${sessionId}/users/${powerMeterId}`);
            userRef.once('value').then(snapshot => {
              const existingData = snapshot.val() || {};
              
              // 필수 유지값과 새 데이터 병합 (필수값 우선 보존)
              const mergedData = {
                ...existingData, // 기존 데이터 보존 (워크아웃 진행 중 데이터 포함)
                ...userData,    // 새 필수값으로 업데이트
                // 워크아웃 진행 중 데이터는 유지 (있는 경우)
                power: existingData.power !== undefined ? existingData.power : undefined,
                cadence: existingData.cadence !== undefined ? existingData.cadence : undefined,
                hr: existingData.hr !== undefined ? existingData.hr : undefined,
                maxPower: existingData.maxPower !== undefined ? existingData.maxPower : undefined,
                avgPower: existingData.avgPower !== undefined ? existingData.avgPower : undefined,
                segmentPower: existingData.segmentPower !== undefined ? existingData.segmentPower : undefined,
                targetPower: existingData.targetPower !== undefined ? existingData.targetPower : undefined,
                lastUpdate: existingData.lastUpdate || firebase.database.ServerValue.TIMESTAMP
              };
              
              // undefined 값 제거
              Object.keys(mergedData).forEach(key => {
                if (mergedData[key] === undefined) {
                  delete mergedData[key];
                }
              });
              
              return userRef.set(mergedData);
            }).then(() => {
              console.log(`[Firebase] Users 저장 완료: 트랙 ${powerMeterId}`, userData);
            }).catch(error => {
              console.error(`[Firebase] Users 저장 실패:`, error);
            });
          } else {
            console.warn('[Firebase] SESSION_ID를 찾을 수 없어 사용자 정보를 저장할 수 없습니다.');
          }
        }
        
        // 선택된 사용자 카드 업데이트
        updatePairingModalWithSavedData(powerMeter);
        
        // 검색 결과 영역은 비워둠 (선택된 사용자 카드에 표시됨)
        const resultEl = document.getElementById('pairingUserSearchResult');
        if (resultEl) {
          resultEl.innerHTML = '';
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
  powerMeter.equipment = null; // 장비 정보도 제거
  
  // UI 업데이트
  const userNameEl = document.getElementById(`user-name-${powerMeterId}`);
  if (userNameEl) {
    userNameEl.parentElement.style.display = 'none';
  }
  
  // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
  updatePowerMeterConnectionStatus(powerMeterId);
  
  // 선택된 사용자 카드 숨김
  const selectedUserCard = document.getElementById('pairingSelectedUserCard');
  if (selectedUserCard) {
    selectedUserCard.style.display = 'none';
    selectedUserCard.innerHTML = '';
  }
  
  // 모달 내 검색 결과 영역 초기화
  const resultEl = document.getElementById('pairingUserSearchResult');
  if (resultEl) {
    resultEl.innerHTML = '';
  }
  
  // 모달에 저장된 데이터 다시 업데이트 (선택된 사용자 카드가 비워지도록)
  updatePairingModalWithSavedData(powerMeter);
  
  // FTP 기반 눈금 업데이트 (기본값으로 복귀)
  updatePowerMeterTicks(powerMeterId);
  
  // 연결 상태 업데이트
  updatePowerMeterConnectionStatus(powerMeterId);
  
  // 저장
  saveAllPowerMeterPairingsToStorage();
  
  // Firebase에서 사용자 정보 삭제
  if (typeof db !== 'undefined') {
    const sessionId = getSessionId();
    
    if (sessionId) {
      db.ref(`sessions/${sessionId}/users/${powerMeterId}`).remove()
        .then(() => {
          console.log(`[Firebase] 트랙 ${powerMeterId}에서 사용자 정보 삭제 완료:`, {
            roomId: sessionId,
            trackNumber: powerMeterId
          });
        })
        .catch(error => {
          console.error(`[Firebase] 사용자 정보 삭제 실패:`, error);
        });
    }
  }
  
  if (typeof showToast === 'function') {
    showToast('사용자 선택이 해제되었습니다.');
  }
}

/**
 * 모든 트랙의 사용자 선택 및 심박계 해제 (스마트로라, 파워메터는 유지)
 */
function clearAllUsersAndHeartRateDevices() {
  console.log('[Indoor Training] 워크아웃 종료 시 사용자 자동 퇴실 실행');
  
  const state = window.indoorTrainingState;
  if (!state || !state.powerMeters) {
    console.warn('[Indoor Training] powerMeters가 없습니다.');
    return;
  }
  
  // 모든 트랙(1~10)에 대해 처리
  state.powerMeters.forEach(pm => {
    // 사용자 정보 제거
    if (pm.userId || pm.userName) {
      pm.userId = null;
      pm.userFTP = null;
      pm.userName = null;
      pm.userWeight = null;
      pm.userContact = null;
      pm.gear = null;
      pm.brake = null;
      
      // UI 업데이트
      const userNameEl = document.getElementById(`user-name-${pm.id}`);
      if (userNameEl) {
        userNameEl.parentElement.style.display = 'none';
      }
      
      // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
      updatePowerMeterConnectionStatus(pm.id);
      
      console.log(`[Indoor Training] 트랙 ${pm.id} 사용자 정보 제거`);
    }
    
    // 심박계 해제 (스마트로라, 파워메터는 유지)
    if (pm.heartRateDeviceId) {
      pm.heartRateName = null;
      pm.heartRateDeviceId = null;
      
      // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
      updatePowerMeterConnectionStatus(pm.id);
      
      // UI 업데이트
      const heartSelectedCard = document.getElementById('heartSelectedDeviceCard');
      if (heartSelectedCard && window.currentTargetPowerMeterId === pm.id) {
        heartSelectedCard.style.display = 'none';
        heartSelectedCard.innerHTML = '';
      }
      
      const heartNameEl = document.getElementById('heartRatePairingName');
      const heartDeviceIdEl = document.getElementById('heartRateDeviceId');
      const btnClearHeart = document.getElementById('btnClearHeart');
      if (heartNameEl) heartNameEl.value = '';
      if (heartDeviceIdEl) heartDeviceIdEl.value = '';
      if (btnClearHeart) btnClearHeart.style.display = 'none';
      
      console.log(`[Indoor Training] 트랙 ${pm.id} 심박계 해제`);
    }
  });
  
  // 선택된 사용자 카드 숨김 (모달이 열려있을 경우)
  const selectedUserCard = document.getElementById('pairingSelectedUserCard');
  if (selectedUserCard) {
    selectedUserCard.style.display = 'none';
    selectedUserCard.innerHTML = '';
  }
  
  // 장비 정보 입력 필드 비우기
  const gearSelect = document.getElementById('pairingGearSelect');
  const brakeSelect = document.getElementById('pairingBrakeSelect');
  if (gearSelect) {
    gearSelect.value = '';
  }
  if (brakeSelect) {
    brakeSelect.value = '';
  }
  
  // Firebase에서 사용자 정보 및 심박계 정보 삭제 (스마트로라, 파워메터는 유지)
  if (typeof db !== 'undefined') {
    const sessionId = getSessionId();
    
    if (sessionId) {
      state.powerMeters.forEach(pm => {
        const userRef = db.ref(`sessions/${sessionId}/users/${pm.id}`);
        
        // Firebase에서 기존 데이터 읽기
        userRef.once('value').then(snapshot => {
          const existingData = snapshot.val() || {};
          
          // 사용자 정보와 심박계 정보만 제거, 스마트로라와 파워메터는 유지
          const updatedData = {
            ...existingData,
            userId: null,
            userName: null,
            ftp: null,
            weight: null,
            gear: null,
            brake: null,
            heartRateDeviceId: null,
            heartRateName: null,
            // 스마트로라와 파워메터는 유지
            trainerDeviceId: existingData.trainerDeviceId || null,
            trainerName: existingData.trainerName || null,
            deviceId: existingData.deviceId || null,
            pairingName: existingData.pairingName || null
          };
          
          // null 값 제거
          Object.keys(updatedData).forEach(key => {
            if (updatedData[key] === null) {
              delete updatedData[key];
            }
          });
          
          return userRef.update(updatedData);
        }).then(() => {
          console.log(`[Firebase] 트랙 ${pm.id} 사용자 및 심박계 정보 제거 완료`);
        }).catch(error => {
          console.error(`[Firebase] 트랙 ${pm.id} 정보 업데이트 실패:`, error);
        });
      });
    }
  }
  
  // 페어링 모달이 열려있으면 업데이트
  if (window.currentTargetPowerMeterId) {
    const currentPowerMeter = state.powerMeters.find(p => p.id === window.currentTargetPowerMeterId);
    if (currentPowerMeter && typeof updatePairingModalWithSavedData === 'function') {
      updatePairingModalWithSavedData(currentPowerMeter);
    }
  }
  
  // 로컬 스토리지에 저장
  saveAllPowerMeterPairingsToStorage();
  
  if (typeof showToast === 'function') {
    showToast('모든 트랙의 사용자 선택과 심박계가 해제되었습니다.');
  }
  
  console.log('[Indoor Training] 사용자 자동 퇴실 완료');
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
    
    // 페어링된 스마트로라 카드 숨김
    const trainerSelectedCard = document.getElementById('trainerSelectedDeviceCard');
    if (trainerSelectedCard) {
      trainerSelectedCard.style.display = 'none';
      trainerSelectedCard.innerHTML = '';
    }
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
    
    // 페어링된 파워메터 카드 숨김
    const powerSelectedCard = document.getElementById('powerSelectedDeviceCard');
    if (powerSelectedCard) {
      powerSelectedCard.style.display = 'none';
      powerSelectedCard.innerHTML = '';
    }
    
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
    
    // 페어링된 심박계 카드 숨김
    const heartSelectedCard = document.getElementById('heartSelectedDeviceCard');
    if (heartSelectedCard) {
      heartSelectedCard.style.display = 'none';
      heartSelectedCard.innerHTML = '';
    }
    
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
  
  // 모달에 저장된 데이터 다시 업데이트 (페어링된 기기 카드가 업데이트되도록)
  updatePairingModalWithSavedData(powerMeter);
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
window.searchUserByNameForPairing = searchUserByNameForPairing;
window.filterUsersByNameForPairing = filterUsersByNameForPairing;
window.selectSearchedUserForPowerMeter = selectSearchedUserForPowerMeter;
window.formatPhoneNumberInput = formatPhoneNumberInput;
window.clearSelectedUser = clearSelectedUser;
window.clearPairedDevice = clearPairedDevice;

/**
 * Firebase에서 트랙별 사용자 정보를 가져와 Indoor Training 화면의 트랙에 업데이트
 * - 선택된 워크아웃 유지
 * - 훈련 진행 중일 때 훈련 상태 유지
 * - 훈련 도중 입장하는 사용자 반영을 위해 기존 훈련 사항들 유지
 * - 기존 페어링 정보(deviceId, trainerDeviceId 등)는 유지하고 사용자 정보만 업데이트
 */
async function updateTracksFromFirebase() {
  const btn = document.getElementById('btnUpdateTracksFromFirebase');
  const originalText = btn ? btn.innerHTML : '';
  
  // 버튼 상태 업데이트
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<img src="assets/img/reload.png" alt="업데이트 중" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> 업데이트 중...';
  }
  
  try {
    // 현재 SESSION_ID (Training Room ID) 가져오기
    const sessionId = getSessionId();
    
    if (!sessionId) {
      if (typeof showToast === 'function') {
        showToast('Training Room ID를 찾을 수 없습니다.', 'error');
      }
      return;
    }
    
    console.log('[Indoor Training] Firebase에서 트랙 정보 업데이트 시작, roomId:', sessionId);
    
    // Firebase에서 트랙별 사용자 정보 가져오기
    const url = `${window.GAS_URL}?action=getTrainingRoomUsers&roomId=${sessionId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '트랙 정보를 가져오는데 실패했습니다');
    }
    
    const tracks = result.tracks || [];
    console.log('[Indoor Training] Firebase에서 가져온 트랙 정보:', tracks);
    
    // 사용자 목록 가져오기 (FTP, weight 등 상세 정보를 위해)
    let users = [];
    try {
      if (typeof apiGetUsers === 'function') {
        const usersResult = await apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
        }
      } else if (typeof window.apiGetUsers === 'function') {
        const usersResult = await window.apiGetUsers();
        if (usersResult && usersResult.success && usersResult.items) {
          users = usersResult.items;
        }
      }
    } catch (userError) {
      console.warn('[Indoor Training] 사용자 목록 로드 실패 (트랙 업데이트):', userError);
    }
    
    // Firebase에서 Device 정보 가져오기
    let deviceData = {};
    if (typeof db !== 'undefined' && sessionId) {
      try {
        const deviceRef = db.ref(`sessions/${sessionId}/devices`);
        const deviceSnapshot = await deviceRef.once('value');
        deviceData = deviceSnapshot.val() || {};
        console.log('[Indoor Training] Firebase Device 정보 로드:', deviceData);
      } catch (error) {
        console.warn('[Indoor Training] Firebase Device 정보 로드 실패:', error);
      }
    }
    
    // Firebase에서 Users 정보 가져오기 (기존 tracks 데이터와 병합)
    let usersData = {};
    if (typeof db !== 'undefined' && sessionId) {
      try {
        const usersRef = db.ref(`sessions/${sessionId}/users`);
        const usersSnapshot = await usersRef.once('value');
        usersData = usersSnapshot.val() || {};
        console.log('[Indoor Training] Firebase Users 정보 로드:', usersData);
      } catch (error) {
        console.warn('[Indoor Training] Firebase Users 정보 로드 실패:', error);
      }
    }
    
    // 각 트랙에 사용자 정보 및 디바이스 정보 업데이트
    let updatedCount = 0;
    
    tracks.forEach(track => {
      const powerMeter = window.indoorTrainingState.powerMeters.find(pm => pm.id === track.trackNumber);
      
      if (!powerMeter) {
        console.warn(`[Indoor Training] 트랙 ${track.trackNumber}의 파워미터를 찾을 수 없습니다.`);
        return;
      }
      
      // Firebase Device 정보 업데이트 (트랙번호별)
      const trackDeviceData = deviceData[track.trackNumber];
      if (trackDeviceData) {
        powerMeter.trainerDeviceId = trackDeviceData.smartTrainerId || null;
        powerMeter.deviceId = trackDeviceData.powerMeterId || null;
        powerMeter.heartRateDeviceId = trackDeviceData.heartRateId || null;
        powerMeter.gear = trackDeviceData.gear || null;
        powerMeter.brake = trackDeviceData.brake || null;
        
        // 디바이스 이름 업데이트 제거: 디바이스 아이콘으로 대체됨
        // pairingName은 더 이상 화면에 표시하지 않음
        
        console.log(`[Indoor Training] 트랙 ${track.trackNumber} Device 정보 업데이트:`, trackDeviceData);
      }
      
      // Firebase Users 정보 업데이트 (트랙번호별, tracks 데이터와 병합)
      const trackUserData = usersData[track.trackNumber];
      if (trackUserData && trackUserData.userId) {
        // 사용자 이름 확인 (userName만 사용)
        const userName = trackUserData.userName || track.userName;
        
        if (userName) {
          // 사용자 상세 정보 찾기
          const user = users.find(u => String(u.id) === String(trackUserData.userId));
          
          // 파워미터에 사용자 정보 저장 (Firebase Users 데이터 우선)
          powerMeter.userId = trackUserData.userId;
          powerMeter.userName = userName;
          powerMeter.userWeight = trackUserData.weight || (user ? user.weight : null);
          powerMeter.userFTP = trackUserData.ftp || (user ? user.ftp : null);
          
          if (user) {
            powerMeter.userContact = user.contact || null;
          }
          
          // UI 업데이트 (사용자 이름 표시)
          const userNameEl = document.getElementById(`user-name-${track.trackNumber}`);
          if (userNameEl) {
            userNameEl.textContent = powerMeter.userName;
            userNameEl.parentElement.style.display = 'flex';
          }
          
          // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
          updatePowerMeterConnectionStatus(track.trackNumber);
          
          // FTP 기반 눈금 업데이트
          updatePowerMeterTicks(track.trackNumber);
          
          updatedCount++;
          
          console.log(`[Indoor Training] 트랙 ${track.trackNumber} 업데이트:`, {
            userId: powerMeter.userId,
            userName: powerMeter.userName,
            userFTP: powerMeter.userFTP,
            weight: powerMeter.userWeight,
            gear: powerMeter.gear,
            brake: powerMeter.brake
          });
        }
      } else if (track.userId && track.userName) {
        // Firebase Users에 없지만 tracks에 있는 경우 (기존 로직 유지)
        const user = users.find(u => String(u.id) === String(track.userId));
        
        powerMeter.userId = track.userId;
        powerMeter.userName = track.userName;
        
        if (user) {
          powerMeter.userFTP = user.ftp || null;
          powerMeter.userWeight = user.weight || null;
          powerMeter.userContact = user.contact || null;
        }
        
        const userNameEl = document.getElementById(`user-name-${track.trackNumber}`);
        if (userNameEl) {
          userNameEl.textContent = track.userName;
          userNameEl.parentElement.style.display = 'flex';
        }
        
        // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
        updatePowerMeterConnectionStatus(track.trackNumber);
        
        updatePowerMeterTicks(track.trackNumber);
        updatedCount++;
      } else {
        // 사용자 정보가 없는 경우
        powerMeter.userId = null;
        powerMeter.userName = null;
        powerMeter.userFTP = null;
        powerMeter.userWeight = null;
        powerMeter.userContact = null;
        
        const userNameEl = document.getElementById(`user-name-${track.trackNumber}`);
        if (userNameEl) {
          userNameEl.textContent = '';
          userNameEl.style.display = 'none';
        }
        
        updatePowerMeterTicks(track.trackNumber);
      }
      
      // 연결 상태 업데이트
      updatePowerMeterConnectionStatus(track.trackNumber);
    });
    
    // 페어링 정보 저장 (localStorage)
    saveAllPowerMeterPairingsToStorage();
    
    // Firebase에도 동기화 (각 트랙의 사용자 정보를 Firebase에 저장)
    if (typeof db !== 'undefined') {
      tracks.forEach(track => {
        const powerMeter = window.indoorTrainingState.powerMeters.find(pm => pm.id === track.trackNumber);
        
        if (powerMeter && powerMeter.userId) {
          const userData = {
            userId: String(powerMeter.userId),
            userName: powerMeter.userName || '',
            ftp: powerMeter.userFTP || 0,
            weight: powerMeter.userWeight || 0
          };
          
          // Firebase에 저장 (update를 사용하여 기존 데이터 보존)
          const userRef = db.ref(`sessions/${sessionId}/users/${track.trackNumber}`);
          userRef.once('value').then(snapshot => {
            const existingData = snapshot.val() || {};
            
            // 필수 유지값과 새 데이터 병합 (필수값 우선 보존)
            const mergedData = {
              ...existingData, // 기존 데이터 보존 (워크아웃 진행 중 데이터 포함)
              ...userData,    // 새 필수값으로 업데이트
              // 워크아웃 진행 중 데이터는 유지 (있는 경우)
              power: existingData.power !== undefined ? existingData.power : undefined,
              cadence: existingData.cadence !== undefined ? existingData.cadence : undefined,
              hr: existingData.hr !== undefined ? existingData.hr : undefined,
              maxPower: existingData.maxPower !== undefined ? existingData.maxPower : undefined,
              avgPower: existingData.avgPower !== undefined ? existingData.avgPower : undefined,
              segmentPower: existingData.segmentPower !== undefined ? existingData.segmentPower : undefined,
              targetPower: existingData.targetPower !== undefined ? existingData.targetPower : undefined,
              lastUpdate: existingData.lastUpdate || firebase.database.ServerValue.TIMESTAMP
            };
            
            // undefined 값 제거
            Object.keys(mergedData).forEach(key => {
              if (mergedData[key] === undefined) {
                delete mergedData[key];
              }
            });
            
            return userRef.set(mergedData);
          }).then(() => {
            console.log(`[Indoor Training] Firebase 동기화 완료 (필수값 보존): 트랙 ${track.trackNumber}`, {
              userId: powerMeter.userId,
              userName: powerMeter.userName
            });
          }).catch(error => {
            console.error(`[Indoor Training] Firebase 동기화 실패: 트랙 ${track.trackNumber}`, error);
          });
        }
      });
    }
    
    if (typeof showToast === 'function') {
      showToast(`트랙 정보가 업데이트되었습니다. (${updatedCount}개 트랙)`, 'success');
    }
    
    console.log('[Indoor Training] 트랙 정보 업데이트 완료');
    
  } catch (error) {
    console.error('[Indoor Training] 트랙 정보 업데이트 오류:', error);
    if (typeof showToast === 'function') {
      showToast('트랙 정보 업데이트 실패: ' + (error.message || 'Unknown error'), 'error');
    }
  } finally {
    // 버튼 상태 복구
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// 전역 함수로 등록
window.updateTracksFromFirebase = updateTracksFromFirebase;

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
        
        // 저장
        saveAllPowerMeterPairingsToStorage();
        
        // Firebase에 사용자 정보 저장 (Player List와 동일한 구조)
        if (typeof db !== 'undefined') {
          const sessionId = getSessionId();
          
          if (sessionId) {
            // Player List 화면과 동일한 데이터 구조로 저장
            const userData = {
              userId: String(powerMeter.userId || ''),
              userName: powerMeter.userName || '',
              ftp: powerMeter.userFTP || 0,
              weight: powerMeter.userWeight || 0,
              gear: powerMeter.gear || null, // Gear 정보
              brake: powerMeter.brake || null // Brake 정보
            };
            
            // Firebase에 저장 (update를 사용하여 기존 데이터 보존)
            const userRef = db.ref(`sessions/${sessionId}/users/${powerMeterId}`);
            userRef.once('value').then(snapshot => {
              const existingData = snapshot.val() || {};
              
              // 필수 유지값과 새 데이터 병합 (필수값 우선 보존)
              const mergedData = {
                ...existingData, // 기존 데이터 보존 (워크아웃 진행 중 데이터 포함)
                ...userData,    // 새 필수값으로 업데이트
                // 워크아웃 진행 중 데이터는 유지 (있는 경우)
                power: existingData.power !== undefined ? existingData.power : undefined,
                cadence: existingData.cadence !== undefined ? existingData.cadence : undefined,
                hr: existingData.hr !== undefined ? existingData.hr : undefined,
                maxPower: existingData.maxPower !== undefined ? existingData.maxPower : undefined,
                avgPower: existingData.avgPower !== undefined ? existingData.avgPower : undefined,
                segmentPower: existingData.segmentPower !== undefined ? existingData.segmentPower : undefined,
                targetPower: existingData.targetPower !== undefined ? existingData.targetPower : undefined,
                lastUpdate: existingData.lastUpdate || firebase.database.ServerValue.TIMESTAMP
              };
              
              // undefined 값 제거
              Object.keys(mergedData).forEach(key => {
                if (mergedData[key] === undefined) {
                  delete mergedData[key];
                }
              });
              
              return userRef.set(mergedData);
            }).then(() => {
              console.log(`[Firebase] 트랙 ${powerMeterId}에 사용자 정보 저장 완료 (필수값 보존):`, {
                roomId: sessionId,
                trackNumber: powerMeterId,
                userId: userData.userId,
                userName: userData.userName,
                ftp: userData.ftp,
                weight: userData.weight,
                gear: powerMeter.gear || null,
                brake: powerMeter.brake || null
              });
            }).catch(error => {
              console.error(`[Firebase] 사용자 정보 저장 실패:`, error);
            });
          }
        }
        
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
 * 디바이스 아이콘 업데이트
 */
function updateDeviceIcons(powerMeterId, statusClass = 'connected') {
  const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
  if (!powerMeter) return;
  
  const deviceIconsContainer = document.getElementById(`device-icons-${powerMeterId}`);
  if (!deviceIconsContainer) return;
  
  // 상태에 따라 이미지 선택: 준비됨(ready) = 비활성화 이미지(_i.png), 연결됨(connected) = 활성화 이미지(_g.png)
  const imageSuffix = statusClass === 'ready' ? '_i.png' : '_g.png';
  
  // 디바이스 아이콘 생성 (우측 연결 상태 영역용)
  const deviceIcons = [];
  if (powerMeter.trainerDeviceId) {
    deviceIcons.push(`<img src="assets/img/trainer${imageSuffix}" alt="스마트트레이너" style="height: 16px; width: auto; vertical-align: middle;" />`);
  }
  if (powerMeter.deviceId || powerMeter.powerMeterDeviceId) {
    deviceIcons.push(`<img src="assets/img/power${imageSuffix}" alt="파워메터" style="height: 16px; width: auto; vertical-align: middle;" />`);
  }
  if (powerMeter.heartRateDeviceId) {
    deviceIcons.push(`<img src="assets/img/bpm${imageSuffix}" alt="심박계" style="height: 16px; width: auto; vertical-align: middle;" />`);
  }
  
  deviceIconsContainer.innerHTML = deviceIcons.join('');
  
  // 사용자명이 있으면 사용자명 컨테이너 표시
  const userNameEl = document.getElementById(`user-name-${powerMeterId}`);
  if (userNameEl && powerMeter.userName) {
    userNameEl.parentElement.style.display = 'flex';
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
  
  // Gear, Brake 읽기 및 저장
  const gearSelect = document.getElementById('pairingGearSelect');
  const brakeSelect = document.getElementById('pairingBrakeSelect');
  if (gearSelect) {
    powerMeter.gear = gearSelect.value || null;
  }
  if (brakeSelect) {
    powerMeter.brake = brakeSelect.value || null;
  }
  
  // Firebase DB에 저장하는 공통 함수
  const saveToFirebase = () => {
    if (typeof db !== 'undefined') {
      const sessionId = getSessionId();
      
      if (!sessionId) {
        console.warn('[Firebase] SESSION_ID를 찾을 수 없어 페어링 정보를 저장할 수 없습니다.');
        return;
      }
      
      // Device 정보 저장 (트랙번호별) - 모든 탭에서 저장
      const deviceData = {
        smartTrainerId: powerMeter.trainerDeviceId || null,
        powerMeterId: powerMeter.deviceId || null,
        heartRateId: powerMeter.heartRateDeviceId || null,
        gear: powerMeter.gear || null,
        brake: powerMeter.brake || null
      };
      
      const deviceRef = db.ref(`sessions/${sessionId}/devices/${powerMeterId}`);
      deviceRef.set(deviceData).then(() => {
        console.log(`[Firebase] Device 저장 완료: 트랙 ${powerMeterId}`, deviceData);
      }).catch(error => {
        console.error(`[Firebase] Device 저장 실패:`, error);
      });
      
      // Users 정보 저장 (트랙번호별) - 사용자 정보가 있을 때만 저장
      if (powerMeter.userId && powerMeter.userName) {
        const userData = {
          userId: String(powerMeter.userId || ''),
          userName: powerMeter.userName || '',
          weight: powerMeter.userWeight || 0,
          ftp: powerMeter.userFTP || 0
        };
        
        const userRef = db.ref(`sessions/${sessionId}/users/${powerMeterId}`);
        userRef.once('value').then(snapshot => {
          const existingData = snapshot.val() || {};
          
          // 기존 데이터 보존하면서 사용자 정보 업데이트
          const mergedData = {
            ...existingData,
            ...userData,
            // 워크아웃 진행 중 데이터는 유지
            power: existingData.power !== undefined ? existingData.power : undefined,
            cadence: existingData.cadence !== undefined ? existingData.cadence : undefined,
            hr: existingData.hr !== undefined ? existingData.hr : undefined,
            maxPower: existingData.maxPower !== undefined ? existingData.maxPower : undefined,
            avgPower: existingData.avgPower !== undefined ? existingData.avgPower : undefined,
            segmentPower: existingData.segmentPower !== undefined ? existingData.segmentPower : undefined,
            targetPower: existingData.targetPower !== undefined ? existingData.targetPower : undefined,
            lastUpdate: existingData.lastUpdate || firebase.database.ServerValue.TIMESTAMP
          };
          
          // undefined 값 제거
          Object.keys(mergedData).forEach(key => {
            if (mergedData[key] === undefined) {
              delete mergedData[key];
            }
          });
          
          return userRef.set(mergedData);
        }).then(() => {
          console.log(`[Firebase] Users 저장 완료: 트랙 ${powerMeterId}`, userData);
        }).catch(error => {
          console.error(`[Firebase] Users 저장 실패:`, error);
        });
      }
    }
  };
  
  if (tabName === 'user') {
    // 사용자 선택은 이미 selectSearchedUserForPowerMeter에서 저장됨
    // devices 정보만 업데이트 (gear, brake 변경 시)
    saveToFirebase();
    
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
    
    powerMeter.trainerName = name;
    powerMeter.trainerDeviceId = deviceId;
    
    // Firebase에 저장 (devices 정보 업데이트)
    saveToFirebase();
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 모달에 저장된 데이터 업데이트 (페어링된 기기 카드 표시)
    updatePairingModalWithSavedData(powerMeter);
    
    // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
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
    
    powerMeter.pairingName = name;
    powerMeter.deviceId = deviceId;
    
    // Firebase에 저장 (devices 정보 업데이트)
    saveToFirebase();
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 모달에 저장된 데이터 업데이트 (페어링된 기기 카드 표시)
    updatePairingModalWithSavedData(powerMeter);
    
    // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
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
    
    powerMeter.heartRateName = name;
    powerMeter.heartRateDeviceId = deviceId;
    
    // Firebase에 저장 (devices 정보 업데이트)
    saveToFirebase();
    
    // 저장
    saveAllPowerMeterPairingsToStorage();
    
    // 모달에 저장된 데이터 업데이트 (페어링된 기기 카드 표시)
    updatePairingModalWithSavedData(powerMeter);
    
    // 연결 상태 업데이트 (디바이스 아이콘도 함께 업데이트됨)
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
  
  // pairing-name 요소는 제거됨 (디바이스 아이콘으로 대체)
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
  
  // 다른 리스트에서 잘못 표시된 동일 디바이스 제거 (안전장치)
  // 파워미터 리스트를 렌더링할 때는 스마트로라 리스트에서 같은 ID 제거
  if (targetType === 0x0B) {
    const trainerListEl = document.getElementById('trainerDeviceList');
    if (trainerListEl) {
      devices.forEach(device => {
        const wrongItem = trainerListEl.querySelector(`[data-device-id="${device.id}"]`);
        if (wrongItem) {
          console.log(`[Training] 파워미터 리스트 렌더링: 스마트로라 리스트에서 잘못 표시된 디바이스 제거 (ID: ${device.id})`);
          wrongItem.remove();
        }
      });
    }
  }
  // 스마트로라 리스트를 렌더링할 때는 파워미터 리스트에서 같은 ID 제거
  else if (targetType === 0x11 || targetType === 0x10) {
    const powerListEl = document.getElementById('powerMeterDeviceList');
    if (powerListEl) {
      devices.forEach(device => {
        const wrongItem = powerListEl.querySelector(`[data-device-id="${device.id}"]`);
        if (wrongItem) {
          console.log(`[Training] 스마트로라 리스트 렌더링: 파워미터 리스트에서 잘못 표시된 디바이스 제거 (ID: ${device.id})`);
          wrongItem.remove();
        }
      });
    }
  }
  
  // 스크롤 위치 저장 (업데이트 전)
  const scrollTop = listEl.scrollTop;
  const wasScrolled = scrollTop > 0;
  
  // 디바이스 검색 창 초기값 빈값으로 설정
  const deviceIdInput = (targetType === 0x78) ? document.getElementById('heartRateDeviceId') :
                        (targetType === 0x0B) ? document.getElementById('powerMeterDeviceId') :
                        document.getElementById('trainerDeviceId');
  if (deviceIdInput && !deviceIdInput.value) {
    deviceIdInput.value = '';
  }
  
  if (devices.length > 0) {
    // 기존 아이템들을 data-device-id로 추적
    const existingItems = Array.from(listEl.querySelectorAll('.ant-device-item'));
    const existingIds = new Set(existingItems.map(item => item.getAttribute('data-device-id')));
    const newDevices = devices.filter(d => !existingIds.has(String(d.id)));
    
    // 리스트에 있지만 현재 필터링된 devices에 없는 디바이스 처리
    // 주의: deviceType 필터링 때문에 devices 배열에 없을 수 있지만, foundDevices에는 있을 수 있음
    existingItems.forEach(item => {
      const deviceId = parseInt(item.getAttribute('data-device-id'));
      const device = devices.find(d => d.id === deviceId);
      
      if (!device) {
        // 현재 필터링된 devices에 없음
        // foundDevices에 있는지 확인 (deviceType이 다를 수 있음)
        const foundDevice = window.antState.foundDevices.find(d => d.id === deviceId);
        
        if (foundDevice) {
          // foundDevices에 있으면 deviceType이 다른 것일 수 있음
          // 이 경우 제거하지 않음 (다른 리스트로 이동했을 수 있음)
          // 단, 현재 타입과 다른 타입이면 제거 (이미 다른 리스트로 이동했을 것)
          if (foundDevice.deviceType !== targetType) {
            // deviceType이 다르면 제거 (다른 리스트에 표시되어야 함)
            item.remove();
          }
          // deviceType이 같으면 유지 (일시적으로 필터에서 제외되었을 수 있음)
        } else {
          // foundDevices에도 없음 - 신호가 끊긴 것으로 간주
          // 하지만 페어링된 경우는 유지
          const powerMeterId = window.currentTargetPowerMeterId;
          let deviceTypeStr = '';
          if (targetType === 0x78) deviceTypeStr = 'heart';
          else if (targetType === 0x0B) deviceTypeStr = 'power';
          else if (targetType === 0x11 || targetType === 0x10) deviceTypeStr = 'trainer';
          
          const isPaired = isDeviceAlreadyPaired(deviceId, deviceTypeStr, powerMeterId);
          if (!isPaired) {
            // 페어링되지 않은 디바이스만 제거
            // 하지만 너무 빠르게 제거하지 않기 위해 타임아웃 체크는 하지 않음
            // (foundDevices에 없으면 이미 신호가 끊긴 것으로 확실함)
            item.remove();
          }
        }
      }
    });
    
    // 기존 아이템 업데이트 (페어링 상태 변경 등)
    existingItems.forEach(item => {
      const deviceId = item.getAttribute('data-device-id');
      const device = devices.find(d => String(d.id) === deviceId);
      if (device && item.parentNode) { // item이 아직 DOM에 있는 경우만
        const isPaired = isDeviceAlreadyPaired(device.id, deviceType, powerMeterId);
        const pairedTrack = isPaired ? window.indoorTrainingState.powerMeters.find(pm => {
          if (pm.id === powerMeterId) return false;
          if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === String(device.id)) return true;
          if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === String(device.id)) return true;
          if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === String(device.id)) return true;
          return false;
        }) : null;
        
        const deviceName = (targetType === 0x78) ? '심박계' : (targetType === 0x0B) ? '파워미터' : '스마트로라';
        
        // 상태에 따라 스타일 업데이트
        if (isPaired) {
          item.style.borderColor = '#dc3545';
          item.style.backgroundColor = '#f8d7da';
          item.style.cursor = 'not-allowed';
          item.style.opacity = '0.6';
          item.onclick = null; // 클릭 이벤트 제거
          const btn = item.querySelector('button');
          if (btn) {
            btn.className = 'btn btn-sm btn-secondary';
            btn.disabled = true;
            btn.textContent = '사용 중';
          }
          const statusSpan = item.querySelector('.device-status');
          if (statusSpan) {
            const trackId = pairedTrack?.id || '?';
            statusSpan.innerHTML = `<span style="font-size:11px; color:#dc3545;">⚠️ 트랙${trackId}에서 사용 중</span>`;
          }
        } else {
          item.style.borderColor = '#007bff';
          item.style.backgroundColor = '#f0f7ff';
          item.style.cursor = 'pointer';
          item.style.opacity = '1';
          item.onclick = () => selectDeviceForInput(device.id, targetType);
          const btn = item.querySelector('button');
          if (btn) {
            btn.className = 'btn btn-sm btn-primary';
            btn.disabled = false;
            btn.textContent = '선택';
          }
          const statusSpan = item.querySelector('.device-status');
          if (statusSpan) {
            statusSpan.innerHTML = '<span style="font-size:11px; color:#28a745;">신호 감지됨</span>';
          }
        }
      }
    });
    
    // 새 디바이스만 추가 (깜빡임 최소화)
    newDevices.forEach(d => {
      const isPaired = isDeviceAlreadyPaired(d.id, deviceType, powerMeterId);
      const pairedTrack = isPaired ? window.indoorTrainingState.powerMeters.find(pm => {
        if (pm.id === powerMeterId) return false;
        if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === String(d.id)) return true;
        if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === String(d.id)) return true;
        if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === String(d.id)) return true;
        return false;
      }) : null;
      
      const deviceName = (targetType === 0x78) ? '심박계' : (targetType === 0x0B) ? '파워미터' : '스마트로라';
      
      const item = document.createElement('div');
      item.className = 'ant-device-item';
      item.setAttribute('data-device-id', d.id);
      item.style.cssText = `padding:12px; border:1px solid ${isPaired ? '#dc3545' : '#007bff'}; background:${isPaired ? '#f8d7da' : '#f0f7ff'}; border-radius:8px; margin-bottom:8px; ${!isPaired ? 'cursor:pointer;' : 'cursor:not-allowed; opacity:0.6;'} display:flex; justify-content:space-between; align-items:center; transition: background 0.2s;`;
      
      if (!isPaired) {
        item.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          selectDeviceForInput(d.id, targetType, e);
        };
      }
      
      // 중첩 템플릿 리터럴 문제 해결: 내부 템플릿을 변수로 분리
      const statusText = isPaired ? `⚠️ 트랙${pairedTrack?.id || '?'}에서 사용 중` : '신호 감지됨';
      const statusColor = isPaired ? '#dc3545' : '#28a745';
      
      item.innerHTML = `
        <div style="display:flex; flex-direction:column;">
          <span style="font-weight:bold; color:${isPaired ? '#721c24' : '#0056b3'}; font-size:14px;">${deviceName} (ID: ${d.id})</span>
          <span class="device-status" style="font-size:11px; color:${statusColor};">${statusText}</span>
        </div>
        <button class="btn btn-sm ${isPaired ? 'btn-secondary' : 'btn-primary'}" ${isPaired ? 'disabled' : ''} style="pointer-events:none;">${isPaired ? '사용 중' : '선택'}</button>
      `;
      
      listEl.appendChild(item);
    });
    
    // 스크롤 위치 복원 (안정적으로)
    // requestAnimationFrame을 사용하여 DOM 업데이트 후 스크롤 복원
    if (wasScrolled) {
      requestAnimationFrame(() => {
        listEl.scrollTop = scrollTop;
      });
    }
    
    listEl.classList.remove('hidden');
    
    if (newDevices.length > 0) {
      console.log(`[UI] ${newDevices.length}개의 새로운 ${deviceType} 디바이스 추가, 총 ${devices.length}개`);
    }
  } else {
    // 디바이스가 없을 때: "연결된 디바이스가 없음" 메시지 표시
    const existingItems = Array.from(listEl.querySelectorAll('.ant-device-item'));
    const hasPairedDevices = existingItems.some(item => {
      const deviceId = item.getAttribute('data-device-id');
      const powerMeterId = window.currentTargetPowerMeterId;
      let deviceTypeStr = '';
      if (targetType === 0x78) deviceTypeStr = 'heart';
      else if (targetType === 0x0B) deviceTypeStr = 'power';
      else if (targetType === 0x11 || targetType === 0x10) deviceTypeStr = 'trainer';
      
      return isDeviceAlreadyPaired(parseInt(deviceId), deviceTypeStr, powerMeterId);
    });
    
    if (listEl.children.length === 0 && !hasPairedDevices) {
      // 디바이스가 없고 리스트도 비어있고 페어링된 디바이스도 없으면 메시지 표시
      listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; border: 1px solid #ddd; border-radius: 8px;">연결된 디바이스가 없음</div>';
      listEl.classList.remove('hidden');
    }
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
  
  // Firebase에 시작 카운트다운 상태 전송 (개인 대시보드 동기화용)
  if (typeof db !== 'undefined') {
    const sessionId = getSessionId();
    let countdown = 5;
    // Firebase에 카운트다운 시작 신호 전송
    db.ref(`sessions/${sessionId}/status`).update({
      countdownRemainingSec: countdown,
      state: 'countdown' // 카운트다운 중임을 표시
    }).catch(e => console.warn('[Indoor Training] 카운트다운 상태 전송 실패:', e));
    
    // 카운트다운 진행 중 Firebase 업데이트
    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown >= 0) {
        db.ref(`sessions/${sessionId}/status`).update({
          countdownRemainingSec: countdown
        }).catch(e => console.warn('[Indoor Training] 카운트다운 상태 업데이트 실패:', e));
      } else {
        clearInterval(countdownInterval);
        // 카운트다운 종료 후 running 상태로 변경
        db.ref(`sessions/${sessionId}/status`).update({
          countdownRemainingSec: null,
          state: 'running'
        }).catch(e => console.warn('[Indoor Training] 훈련 시작 상태 전송 실패:', e));
      }
    }, 1000);
  }
  
  // 카운트다운 모달 생성 및 표시
  const countdownModal = document.createElement('div');
  countdownModal.id = 'trainingCountdownModal';
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
  
  // CSS 애니메이션 추가
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
  
  // 초기 표시 및 첫 번째 삐 소리
  countdownText.textContent = count.toString();
  if (typeof playBeep === 'function') {
    playBeep(880, 120, 0.25);
  }
  
  const countdownInterval = setInterval(async () => {
    count--;
    
    if (count > 0) {
      // 4, 3, 2, 1초일 때 - 일반 삐 소리
      countdownText.textContent = count.toString();
      countdownText.style.animation = 'none';
      setTimeout(() => {
        countdownText.style.animation = 'countdownPulse 0.5s ease-out';
      }, 10);
      if (typeof playBeep === 'function') {
        playBeep(880, 120, 0.25);
      }
    } else if (count === 0) {
      // GO!!일 때 - 강조 삐 소리
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
        document.body.removeChild(countdownModal);
        startTraining();
      }, 300);
    }
  }, 1000);
}

/**
 * 시작/일시정지 토글
 */
function toggleStartPauseTraining() {
  const state = window.indoorTrainingState.trainingState;
  
  if (state === 'idle' || state === 'finished') {
    // 시작 전 수신기 상태 확인
    const isReceiverActive = window.antState && window.antState.usbDevice && window.antState.usbDevice.opened;
    
    if (!isReceiverActive) {
      // 수신기가 비활성화 상태면 메시지 표시하고 동작 중단
      if (typeof showToast === 'function') {
        showToast('수신기를 먼저 활성화 하세요');
      } else {
        console.warn('[Indoor Training] 수신기가 비활성화 상태입니다. 수신기를 먼저 활성화해주세요.');
        alert('수신기를 먼저 활성화 하세요');
      }
      return;
    }
    
    // 수신기가 활성화된 상태에서만 시작
    startTrainingWithCountdown();
  } else if (state === 'running') {
    // 일시정지
    pauseTraining();
  } else if (state === 'paused') {
    // 재개
    resumeTraining();
  }
}

/**
 * 화면 보호기 및 절전모드 해제 (Screen Wake Lock)
 */
window.indoorTrainingWakeLock = {
  wakeLock: null,
  fallbackVideo: null,
  
  async acquire() {
    // 1순위: Screen Wake Lock API 사용 (최신 브라우저)
    if ('wakeLock' in navigator) {
      try {
        if (this.wakeLock) return; // 이미 활성화되어 있으면 재요청하지 않음
        
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[Indoor Training] Screen Wake Lock 활성화됨');
        
        // 시스템이 임의로 해제했을 때 자동 재획득
        this.wakeLock.addEventListener('release', () => {
          console.log('[Indoor Training] Screen Wake Lock이 시스템에 의해 해제됨');
          this.wakeLock = null;
          // 훈련 중이면 자동 재획득
          if (window.indoorTrainingState?.trainingState === 'running') {
            setTimeout(() => this.acquire(), 100);
          }
        });
      } catch (err) {
        console.warn('[Indoor Training] Screen Wake Lock API 실패:', err);
        this.wakeLock = null;
        // Fallback으로 비디오 트릭 사용
        this.acquireFallback();
      }
    } else {
      // Wake Lock API 미지원 시 Fallback 사용
      console.log('[Indoor Training] Screen Wake Lock API 미지원, Fallback 사용');
      this.acquireFallback();
    }
  },
  
  acquireFallback() {
    // 2순위: 비디오 트릭 (iOS 및 구형 브라우저용)
    try {
      if (this.fallbackVideo) return; // 이미 활성화되어 있으면 재생성하지 않음
      
      const video = document.createElement('video');
      video.id = 'indoorTrainingWakeLockVideo';
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.style.cssText = 'position:absolute; top:-9999px; left:-9999px; opacity:0; width:1px; height:1px; pointer-events:none;';
      
      // 투명한 비디오 스트림 생성 (Canvas + MediaStream)
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(1); // 1fps로 충분
      
      video.srcObject = stream;
      document.body.appendChild(video);
      
      // 주기적으로 캔버스 업데이트 (화면이 꺼지지 않도록)
      const updateInterval = setInterval(() => {
        if (ctx && window.indoorTrainingState?.trainingState === 'running') {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 1, 1);
        } else {
          clearInterval(updateInterval);
        }
      }, 1000);
      
      this.fallbackVideo = { video, updateInterval };
      console.log('[Indoor Training] Fallback 화면 잠금 방지 활성화됨');
    } catch (err) {
      console.warn('[Indoor Training] Fallback 화면 잠금 방지 실패:', err);
    }
  },
  
  async release() {
    // Screen Wake Lock 해제
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        console.log('[Indoor Training] Screen Wake Lock 해제됨');
      } catch (err) {
        console.warn('[Indoor Training] Screen Wake Lock 해제 실패:', err);
      }
      this.wakeLock = null;
    }
    
    // Fallback 비디오 제거
    if (this.fallbackVideo) {
      try {
        if (this.fallbackVideo.updateInterval) {
          clearInterval(this.fallbackVideo.updateInterval);
        }
        if (this.fallbackVideo.video) {
          this.fallbackVideo.video.pause();
          this.fallbackVideo.video.srcObject = null;
          if (this.fallbackVideo.video.parentNode) {
            this.fallbackVideo.video.parentNode.removeChild(this.fallbackVideo.video);
          }
        }
        console.log('[Indoor Training] Fallback 화면 잠금 방지 해제됨');
      } catch (err) {
        console.warn('[Indoor Training] Fallback 해제 실패:', err);
      }
      this.fallbackVideo = null;
    }
  }
};

// 페이지 가시성 변경 시 자동 재획득
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && 
      window.indoorTrainingState?.trainingState === 'running' &&
      window.indoorTrainingWakeLock) {
    // 훈련 중이고 페이지가 다시 보이면 Wake Lock 재획득
    setTimeout(() => {
      window.indoorTrainingWakeLock.acquire();
    }, 100);
  }
});

// 페이지 포커스 시 재획득
window.addEventListener('focus', () => {
  if (window.indoorTrainingState?.trainingState === 'running' &&
      window.indoorTrainingWakeLock) {
    setTimeout(() => {
      window.indoorTrainingWakeLock.acquire();
    }, 100);
  }
});

// 사용자 상호작용 시 재획득 (터치, 클릭 등)
['touchstart', 'click', 'pointerdown'].forEach(eventType => {
  document.addEventListener(eventType, () => {
    if (window.indoorTrainingState?.trainingState === 'running' &&
        window.indoorTrainingWakeLock && !window.indoorTrainingWakeLock.wakeLock) {
      window.indoorTrainingWakeLock.acquire();
    }
  }, { once: true, passive: true });
});

/**
 * 훈련 시작
 */
function startTraining() {
  window.indoorTrainingState.trainingState = 'running';
  window.indoorTrainingState.startTime = Date.now();
  window.indoorTrainingState.currentSegmentIndex = 0;
  window.indoorTrainingState.segmentStartTime = Date.now();
  window.indoorTrainingState.segmentElapsedTime = 0;
  
  // 화면 보호기 및 절전모드 해제
  if (window.indoorTrainingWakeLock) {
    window.indoorTrainingWakeLock.acquire();
  }
  
  // 워크아웃 시작 시 모든 파워미터의 궤적 및 통계 데이터 초기화
  window.indoorTrainingState.powerMeters.forEach(pm => {
    // 1. 궤적 초기화
    pm.powerTrailHistory = [];
    pm.lastTrailAngle = null;
    
    // 2. [추가됨] 통계 데이터 초기화 (최대, 평균, 세그먼트)
    pm.maxPower = 0;
    pm.powerSum = 0;
    pm.powerCount = 0;
    pm.averagePower = 0;
    pm.segmentPowerSum = 0;
    pm.segmentPowerCount = 0;
    pm.segmentPower = 0;
    
    // 3. UI 초기화 (0으로 표시)
    const maxEl = document.getElementById(`max-power-value-${pm.id}`);
    const avgEl = document.getElementById(`avg-power-value-${pm.id}`);
    const segEl = document.getElementById(`segment-power-value-${pm.id}`);
    if (maxEl) maxEl.textContent = '0';
    if (avgEl) avgEl.textContent = '0';
    if (segEl) {
        segEl.textContent = '0';
        // 랩파워 색상 설정: 항상 검정색
        segEl.style.color = '#000000'; // 검정색
    }

    // 연결된 파워미터의 경우 목표 파워 궤적 표시를 위해 업데이트
    if (pm.connected) {
      const currentPower = pm.currentPower || 0;
      const ftp = pm.userFTP || window.indoorTrainingState?.userFTP || 200;
      const maxPower = ftp * 2;
      const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
      const angle = -90 + (ratio * 180);
      updatePowerMeterTrail(pm.id, currentPower, angle, pm);
    }
  });
  
  // 버튼 상태 업데이트
  updateTrainingButtons();
  
  // 우측 세그먼트 그래프 업데이트
  if (window.indoorTrainingState.currentWorkout) {
    setTimeout(() => {
      displayWorkoutSegmentGraph(window.indoorTrainingState.currentWorkout, 0);
    }, 100);
  }
  
  // 타이머 시작
  startTrainingTimer();
}

/**
 * 훈련 일시정지
 */
function pauseTraining() {
  window.indoorTrainingState.trainingState = 'paused';
  window.indoorTrainingState.pausedTime = Date.now();
  
  // 버튼 상태 업데이트
  updateTrainingButtons();
}

/**
 * 훈련 재개
 */
function resumeTraining() {
  if (window.indoorTrainingState.pausedTime) {
    const pausedDuration = Date.now() - window.indoorTrainingState.pausedTime;
    window.indoorTrainingState.startTime += pausedDuration;
    window.indoorTrainingState.segmentStartTime += pausedDuration;
    window.indoorTrainingState.pausedTime = 0;
  }
  
  window.indoorTrainingState.trainingState = 'running';
  
  // 버튼 상태 업데이트
  updateTrainingButtons();
  
  // 타이머 재개
  startTrainingTimer();
}

/**
 * 훈련 종료
 */
function stopTraining() {
  window.indoorTrainingState.trainingState = 'idle';
  window.indoorTrainingState.startTime = null;
  window.indoorTrainingState.pausedTime = 0;
  window.indoorTrainingState.totalElapsedTime = 0;
  window.indoorTrainingState.currentSegmentIndex = 0;
  window.indoorTrainingState.segmentStartTime = null;
  window.indoorTrainingState.segmentElapsedTime = 0;
  window.indoorTrainingState.segmentCountdownActive = false;
  
  // 화면 보호기 및 절전모드 해제
  if (window.indoorTrainingWakeLock) {
    window.indoorTrainingWakeLock.release();
  }
  
  // 카운트다운 모달 제거
  const existingModal = document.getElementById('segmentCountdownModal');
  if (existingModal) document.body.removeChild(existingModal);
  
  // 워크아웃 종료 시 사용자 자동 퇴실 체크
  const autoClearCheckbox = document.getElementById('autoClearUsersOnWorkoutEnd');
  if (autoClearCheckbox && autoClearCheckbox.checked) {
    clearAllUsersAndHeartRateDevices();
  }
  
  // 버튼 상태 업데이트
  updateTrainingButtons();
}

/**
 * 세그먼트 건너뛰기 (훈련화면과 동일한 로직)
 */
function skipCurrentSegmentTraining() {
  try {
    const w = window.indoorTrainingState.currentWorkout;
    if (!w || !w.segments) {
      if (typeof showToast === 'function') {
        showToast('워크아웃 또는 세그먼트가 없습니다.');
      }
      return;
    }
    
    // 활성 카운트다운 정지
    if (window.indoorTrainingState.segmentCountdownActive) {
      const existingModal = document.getElementById('segmentCountdownModal');
      if (existingModal) document.body.removeChild(existingModal);
      window.indoorTrainingState.segmentCountdownActive = false;
    }
    
    const currentIndex = window.indoorTrainingState.currentSegmentIndex || 0;
    
    // 다음 세그먼트로 이동
    const newIndex = Math.min(w.segments.length - 1, currentIndex + 1);
    
    if (newIndex === currentIndex) {
      // 마지막 세그먼트이면 건너뛰기 불가
      if (typeof showToast === 'function') {
        showToast('마지막 세그먼트입니다.');
      }
      return;
    }
    
    // 세그먼트 변경
    window.indoorTrainingState.currentSegmentIndex = newIndex;
    window.indoorTrainingState.segmentStartTime = Date.now();
    window.indoorTrainingState.segmentElapsedTime = 0;
    
    // 세그먼트 변경 시 데이터 초기화
    window.indoorTrainingState.powerMeters.forEach(pm => {
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
        const ftp = pm.userFTP || window.indoorTrainingState?.userFTP || 200;
        const maxPower = ftp * 2;
        const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
        const angle = -90 + (ratio * 180);
        updatePowerMeterTrail(pm.id, currentPower, angle, pm);
      }
    });
    
    // 세그먼트 그래프 업데이트
    if (window.indoorTrainingState.currentWorkout) {
      displayWorkoutSegmentGraph(window.indoorTrainingState.currentWorkout, newIndex);
    }
    
    console.log(`[Training] 세그먼트 건너뛰기: ${newIndex + 1}번째 세그먼트로 이동`);
    
    if (typeof showToast === 'function') {
      showToast(`세그먼트 ${newIndex + 1}로 건너뛰기`);
    }
    
  } catch (error) {
    console.error('Error in skipCurrentSegmentTraining:', error);
  }
}

/**
 * 버튼 상태 업데이트
 */
function updateTrainingButtons() {
  const state = window.indoorTrainingState.trainingState;
  // 개인 훈련 화면의 버튼 사용
  const startPauseBtn = document.getElementById('btnTogglePauseTraining');
  const skipBtn = document.getElementById('btnSkipSegmentTraining');
  const stopBtn = document.getElementById('btnStopTrainingIndoor');
  
  if (startPauseBtn) {
    if (state === 'idle' || state === 'finished') {
      // 시작 버튼
      startPauseBtn.className = 'enhanced-control-btn play';
      startPauseBtn.disabled = false;
      startPauseBtn.setAttribute('aria-label', '시작');
      startPauseBtn.setAttribute('title', '시작');
    } else if (state === 'running') {
      // 일시정지 버튼
      startPauseBtn.className = 'enhanced-control-btn pause';
      startPauseBtn.disabled = false;
      startPauseBtn.setAttribute('aria-label', '일시정지');
      startPauseBtn.setAttribute('title', '일시정지');
    } else if (state === 'paused') {
      // 재개 버튼
      startPauseBtn.className = 'enhanced-control-btn play';
      startPauseBtn.disabled = false;
      startPauseBtn.setAttribute('aria-label', '재개');
      startPauseBtn.setAttribute('title', '재개');
    }
  }
  
  if (skipBtn) {
    // 건너뛰기는 실행 중일 때만 활성화
    skipBtn.disabled = (state !== 'running');
    skipBtn.setAttribute('title', '건너뛰기');
  }
  
  if (stopBtn) {
    // 종료는 실행 중이거나 일시정지 상태일 때만 활성화
    stopBtn.disabled = (state !== 'running' && state !== 'paused');
    stopBtn.setAttribute('title', '종료');
  }
}

/**
 * 훈련 타이머 시작
 */
/**
 * 훈련 타이머 및 세그먼트 관리
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
  
  // 세그먼트 전환 체크
  if (window.indoorTrainingState.currentWorkout && window.indoorTrainingState.currentWorkout.segments) {
    const segments = window.indoorTrainingState.currentWorkout.segments;
    const currentIndex = window.indoorTrainingState.currentSegmentIndex;
    const currentSegment = segments[currentIndex];
    
    if (currentSegment) {
      const segmentDuration = currentSegment.duration_sec || currentSegment.duration || 0;
      const segmentElapsed = window.indoorTrainingState.segmentElapsedTime;
      const remaining = segmentDuration - segmentElapsed;
      
      // 세그먼트 종료 6초 전에 5초 카운트다운
      if (remaining <= 6 && remaining > 1 && !window.indoorTrainingState.segmentCountdownActive) {
        window.indoorTrainingState.segmentCountdownActive = true;
        showSegmentCountdown(5);
      }
      
      // 세그먼트 시간이 지나면 다음 세그먼트로 이동
      if (segmentElapsed >= segmentDuration) {
        if (currentIndex >= segments.length - 1) {
          // 워크아웃 종료
          window.indoorTrainingState.trainingState = 'finished';
          window.indoorTrainingState.segmentCountdownActive = false;
          
          // 화면 보호기 및 절전모드 해제
          if (window.indoorTrainingWakeLock) {
            window.indoorTrainingWakeLock.release();
          }
          
          const existingModal = document.getElementById('segmentCountdownModal');
          if (existingModal) document.body.removeChild(existingModal);
          
          // 워크아웃 종료 시 사용자 자동 퇴실 체크
          const autoClearCheckbox = document.getElementById('autoClearUsersOnWorkoutEnd');
          if (autoClearCheckbox && autoClearCheckbox.checked) {
            clearAllUsersAndHeartRateDevices();
          }
          
          // 버튼 상태 업데이트
          updateTrainingButtons();
          
          console.log(`[Training] 워크아웃 완료`);
          return;
        } else {
          // 다음 세그먼트로 이동
          window.indoorTrainingState.currentSegmentIndex = currentIndex + 1;
          window.indoorTrainingState.segmentStartTime = Date.now();
          window.indoorTrainingState.segmentElapsedTime = 0;
          window.indoorTrainingState.segmentCountdownActive = false;
          
          // [추가됨] 세그먼트 변경 시 데이터 초기화
          window.indoorTrainingState.powerMeters.forEach(pm => {
              if (pm.connected) {
                  // 궤적 초기화
                  pm.powerTrailHistory = [];
                  pm.lastTrailAngle = null;
                  const trailContainer = document.getElementById(`needle-path-${pm.id}`);
                  if (trailContainer) trailContainer.innerHTML = '';
                  
                  // [중요] 세그먼트 평균 파워 통계 리셋
                  pm.segmentPowerSum = 0;
                  pm.segmentPowerCount = 0;
                  pm.segmentPower = 0;
                  // UI 리셋 (선택 사항 - 바로 0으로 보여줄지, 데이터 들어올때까지 유지할지)
                  // const segEl = document.getElementById(`segment-power-value-${pm.id}`);
                  // if (segEl) segEl.textContent = '0';

                  // 목표 파워 궤적 업데이트
                  const currentPower = pm.currentPower || 0;
                  const ftp = pm.userFTP || window.indoorTrainingState?.userFTP || 200;
                  const maxPower = ftp * 2;
                  const ratio = Math.min(Math.max(currentPower / maxPower, 0), 1);
                  const angle = -90 + (ratio * 180);
                  updatePowerMeterTrail(pm.id, currentPower, angle, pm);
              }
          });
          
          const existingModal = document.getElementById('segmentCountdownModal');
          if (existingModal) document.body.removeChild(existingModal);
        }
      }
    }
  }
  
  if (window.indoorTrainingState.currentWorkout) {
    const currentSegmentIndex = window.indoorTrainingState.currentSegmentIndex;
    displayWorkoutSegmentGraph(window.indoorTrainingState.currentWorkout, currentSegmentIndex);
  }
  
  if (window.indoorTrainingState.trainingState === 'running') {
    setTimeout(startTrainingTimer, 1000);
  }
}

/**
 * 세그먼트 종료 카운트다운 애니메이션 표시 (5초 카운트다운)
 */
function showSegmentCountdown(startCount) {
  // 기존 카운트다운 모달이 있으면 제거
  const existingModal = document.getElementById('segmentCountdownModal');
  if (existingModal) {
    document.body.removeChild(existingModal);
  }
  
  // 카운트다운 모달 생성 및 표시
  const countdownModal = document.createElement('div');
  countdownModal.id = 'segmentCountdownModal';
  countdownModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    font-family: "Pretendard", "Noto Sans KR", sans-serif;
    pointer-events: none;
  `;
  
  const countdownText = document.createElement('div');
  countdownText.style.cssText = `
    font-size: 500px;
    font-weight: 900;
    color: #ff6b6b;
    text-shadow: 0 0 30px rgba(255, 107, 107, 0.8);
    animation: countdownPulse 0.3s ease-out;
  `;
  
  countdownModal.appendChild(countdownText);
  document.body.appendChild(countdownModal);
  
  // 5초 카운트다운 시작 (5, 4, 3, 2, 1)
  let count = startCount || 5;
  
  // 초기 표시 및 첫 번째 삐 소리
  countdownText.textContent = count.toString();
  if (typeof playBeep === 'function') {
    playBeep(880, 120, 0.25);
  }
  
  const countdownInterval = setInterval(async () => {
    count--;
    
    if (count > 0) {
      // 4, 3, 2, 1초일 때 - 일반 삐 소리
      countdownText.textContent = count.toString();
      countdownText.style.animation = 'none';
      setTimeout(() => {
        countdownText.style.animation = 'countdownPulse 0.3s ease-out';
      }, 10);
      // 카운트다운 소리 재생
      if (typeof playBeep === 'function') {
        playBeep(880, 120, 0.25);
      }
    } else if (count === 0) {
      // 0초일 때 - 시작 카운트다운 GO!!와 같은 소리
      countdownText.textContent = '0';
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
      // 카운트다운 종료 (0초 이후)
      clearInterval(countdownInterval);
      if (countdownModal.parentNode) {
        countdownModal.style.animation = 'countdownFadeOut 0.3s ease-out';
        setTimeout(() => {
          if (countdownModal.parentNode) {
            document.body.removeChild(countdownModal);
          }
        }, 300);
      }
      window.indoorTrainingState.segmentCountdownActive = false;
    }
  }, 1000); // 1초마다 업데이트
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

/**
 * [수정됨] 장치 목록 업데이트 (스마트로라 우선순위 고정 로직 적용)
 * 스마트로라(0x11)가 파워미터(0x0B)로 강등되는 것을 방지합니다.
 */
function updateFoundDevicesList(deviceId, deviceType) {
  let existing = window.antState.foundDevices.find(d => d.id === deviceId);
  
  // 1. 신규 장치 발견
  if (!existing) {
    let typeName;
    if (deviceType === 0x78 || deviceType === 0x7D) {
      typeName = '심박계';
    } else if (deviceType === 0x0B || deviceType === 0x11) {
      typeName = deviceType === 0x0B ? '파워미터' : '스마트로라';
    } else {
      typeName = '알 수 없음';
    }
    existing = { id: deviceId, type: typeName, deviceType: deviceType, lastSeen: Date.now() };
    window.antState.foundDevices.push(existing);
    console.log(`[Training] 신규 장치 발견: ${typeName} ID: ${deviceId}`);
    
    const timerKey = `_deviceListUpdateTimer_${deviceType}`;
    if (window[timerKey]) clearTimeout(window[timerKey]);
    window[timerKey] = setTimeout(() => {
      renderPairingDeviceList(deviceType);
      window[timerKey] = null;
    }, 800);
  } else {
    // 2. 기존 장치 업데이트 (타입 충돌 방지 로직)
    existing.lastSeen = Date.now();
    const oldDeviceType = existing.deviceType;
    
    // [핵심] 스마트로라(0x11)는 파워미터(0x0B)보다 상위 호환입니다.
    // 이미 스마트로라로 인식된 장비가 파워미터 신호를 보내면 무시합니다. (타입 변경 금지)
    if (oldDeviceType === 0x11 && deviceType === 0x0B) {
      return; 
    }

    // 파워미터(0x0B)로 등록되어 있었는데 스마트로라(0x11) 신호가 오면 '업그레이드'
    if (oldDeviceType === 0x0B && deviceType === 0x11) {
      existing.deviceType = deviceType;
      existing.type = '스마트로라';
      console.log(`[Training] 장치 업그레이드: ID ${deviceId} 파워미터 -> 스마트로라(0x11) 고정`);
      
      // UI 리스트 갱신
      const oldListEl = document.getElementById('powerMeterDeviceList');
      if (oldListEl) {
        const oldItem = oldListEl.querySelector(`[data-device-id="${deviceId}"]`);
        if (oldItem) oldItem.remove();
      }
      setTimeout(() => { renderPairingDeviceList(0x0B); }, 500);
      setTimeout(() => { renderPairingDeviceList(0x11); }, 500);
    }
  }
}


/**
 * [최적화됨] ANT+ 데이터 처리 프로세서 (케이던스 오류 수정 패치 포함)
 * - 스마트로라의 일반 정보(0x10) 페이지를 케이던스 데이터로 오인하는 버그 수정
 */
function processLiveTrainingData(deviceId, deviceType, payload) {
    const antData = payload.slice(1, 9);
    const pageNum = antData[0] & 0x7F; 

    window.indoorTrainingState.powerMeters.forEach(pm => {
        // 페어링된 장비 매칭 확인
        const pmHeartRateDeviceId = pm.heartRateDeviceId ? String(pm.heartRateDeviceId) : null;
        const pmDeviceId = pm.deviceId ? String(pm.deviceId) : null; // 파워미터
        const pmTrainerDeviceId = pm.trainerDeviceId ? String(pm.trainerDeviceId) : null; // 스마트로라
        const receivedDeviceId = String(deviceId);
        
        // 1. 심박계 처리
        if ((deviceType === 0x78 || deviceType === 0x7D) && pmHeartRateDeviceId === receivedDeviceId) {
            const heartRate = antData[7];
            if (heartRate > 0 && heartRate < 255) {
                pm.heartRate = heartRate;
                updatePowerMeterData(pm.id, pm.currentPower, heartRate, pm.cadence);
            }
        }

        // 2. 파워/케이던스 처리
        if ( (pmDeviceId === receivedDeviceId && deviceType === 0x0B) || 
             (pmTrainerDeviceId === receivedDeviceId && deviceType === 0x11) ) {

            // 버퍼 초기화
            if (!pm.dataBuffer) {
                pm.dataBuffer = {
                    powerHistory: [],    
                    cadenceHistory: [],  
                    prevTimestamp: Date.now()
                };
            }

            const now = Date.now();
            let rawPower = -1;
            let rawCadence = -1;
            
            // =================================================================
            // [A] 스마트로라 (FE-C) 전용 데이터 (Page 0x19)
            // =================================================================
            if (deviceType === 0x11 && pageNum === 0x19) {
                 // FE-C Page 25: Trainer Data (가장 정확한 소스)
                 // Byte 2: Instant Cadence
                 // Byte 5: Instant Power LSB
                 // Byte 6: Instant Power MSB (bits 0-3) & Trainer Status
                 
                 rawCadence = antData[2]; // 정확한 케이던스 위치
                 const pLSB = antData[5];
                 const pMSB = antData[6] & 0x0F;
                 rawPower = (pMSB << 8) | pLSB;
            }

            // =================================================================
            // [B] 표준 파워미터 데이터 (Page 0x10) - *수정됨*
            // =================================================================
            // [중요] deviceType이 0x0B(파워미터)일 때만 이 페이지를 파워/케이던스로 해석해야 함
            // 스마트로라(0x11)도 0x10번 페이지를 보내지만, 내용은 '장비 정보'이므로 읽으면 안 됨 (226 오류의 원인)
            else if (deviceType === 0x0B && pageNum === 0x10) {
                rawCadence = antData[3]; // 파워미터의 케이던스 위치
                const instantPower = (antData[7] << 8) | antData[6]; 
                rawPower = instantPower; 
            }
            
            // [참고] 스마트로라(0x11)가 보내는 0x10 페이지는 무시됨 -> rawCadence = -1 유지 -> 이전 값 보존

            // -----------------------------------------------------------
            // [C] 필터링 및 안정화 로직
            // -----------------------------------------------------------

            // 1. 유효성 검사 (Garbage Reject)
            if (rawPower > 3000) rawPower = pm.currentPower || 0; 
            if (rawCadence > 250) rawCadence = pm.cadence || 0; // 255(0xFF) 등 잘못된 값 방어

            // 2. 케이던스 안정화 (Median Filter)
            if (rawCadence >= 0) { // 유효한 데이터가 들어왔을 때만 갱신
                pm.dataBuffer.cadenceHistory.push(rawCadence);
                if (pm.dataBuffer.cadenceHistory.length > 5) pm.dataBuffer.cadenceHistory.shift();
                
                // 튀는 값 제거를 위한 중앙값 필터
                const sorted = [...pm.dataBuffer.cadenceHistory].sort((a,b) => a-b);
                const medianCadence = sorted[Math.floor(sorted.length / 2)];
                pm.cadence = medianCadence;
            }

            // 3. 파워 안정화 (Zero-Cut)
            if (rawPower !== -1) {
                // [Zero-Cut] 케이던스가 10 미만이면(멈춤) 파워도 0으로 강제
                if (pm.cadence < 10) { 
                    rawPower = 0;
                    pm.dataBuffer.powerHistory = []; 
                }

                if (rawPower > 0) {
                    pm.dataBuffer.powerHistory.push(rawPower);
                    if (pm.dataBuffer.powerHistory.length > 4) pm.dataBuffer.powerHistory.shift();
                    const sum = pm.dataBuffer.powerHistory.reduce((a,b) => a+b, 0);
                    pm.currentPower = Math.round(sum / pm.dataBuffer.powerHistory.length);
                } else {
                    pm.currentPower = 0;
                }
            }

            // 4. 데이터 타임스탬프 갱신 및 UI 업데이트
            pm.lastUpdateTime = now;
            updatePowerMeterData(pm.id, pm.currentPower, pm.heartRate, pm.cadence);
        }
    });
}

/**
 * [추가] 주기적인 데이터 연결 상태 점검 (1초마다 호출 권장)
 * 데이터가 2초 이상 안 들어오면 강제로 0으로 만듦
 */
setInterval(() => {
    const now = Date.now();
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
        window.indoorTrainingState.powerMeters.forEach(pm => {
            if (pm.connected && pm.lastUpdateTime) {
                // 2초(2000ms) 이상 데이터가 없으면 정지 상태로 간주
                if (now - pm.lastUpdateTime > 2000) {
                    if (pm.currentPower > 0 || pm.cadence > 0) {
                        console.log(`[Training] 신호 끊김 감지 - ID ${pm.id} 0점 처리`);
                        updatePowerMeterData(pm.id, 0, pm.heartRate, 0);
                        // 내부 버퍼도 초기화
                        if (pm.dataBuffer) {
                            pm.dataBuffer.powerHistory = [];
                            pm.dataBuffer.cadenceHistory = [];
                        }
                    }
                }
            }
        });
    }
}, 1000);


/**
 * 검색된 장치를 인도어 트레이닝 페어링 모달 리스트에 표시
 */
// 이 함수는 위에서 이미 수정되었으므로 중복 제거


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
    if (!powerMeterId) {
        console.warn('[selectIndoorDevice] powerMeterId가 없습니다.');
        if (typeof showToast === 'function') {
            showToast('먼저 트랙을 선택해주세요.');
        }
        return;
    }
    
    // deviceId를 문자열로 변환하여 일관성 유지
    deviceId = String(deviceId);
    
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
    } else {
        console.error('[selectIndoorDevice] 알 수 없는 listId:', listId);
        return;
    }

    // 중복 체크
    if (isDeviceAlreadyPaired(deviceId, deviceType, powerMeterId)) {
        const pairedTrack = window.indoorTrainingState.powerMeters.find(pm => {
            if (pm.id === powerMeterId) return false;
            if (deviceType === 'trainer' && pm.trainerDeviceId && String(pm.trainerDeviceId) === deviceId) return true;
            if (deviceType === 'power' && pm.deviceId && String(pm.deviceId) === deviceId) return true;
            if (deviceType === 'heart' && pm.heartRateDeviceId && String(pm.heartRateDeviceId) === deviceId) return true;
            return false;
        });
        
        if (typeof showToast === 'function') {
            showToast(`이 디바이스는 이미 트랙${pairedTrack?.id || '?'}에서 사용 중입니다.`);
        }
        return;
    }

    // 입력 필드에 값 설정
    const inputEl = document.getElementById(inputId);
    if (inputEl) {
        inputEl.value = deviceId;
        inputEl.style.backgroundColor = '#d4edda';
        setTimeout(() => {
            inputEl.style.backgroundColor = '';
        }, 500);
        
        // 이벤트 트리거하여 저장 로직 실행
        const changeEvent = new Event('change', { bubbles: true });
        inputEl.dispatchEvent(changeEvent);
        
        // powerMeter 객체에 디바이스 정보 저장
        const powerMeter = window.indoorTrainingState.powerMeters.find(p => p.id === powerMeterId);
        if (powerMeter) {
            if (deviceType === 'trainer') {
                powerMeter.trainerDeviceId = deviceId;
                const nameInput = document.getElementById('trainerPairingName');
                if (nameInput && !nameInput.value.trim()) {
                    powerMeter.trainerName = '스마트로라';
                } else if (nameInput) {
                    powerMeter.trainerName = nameInput.value.trim();
                }
            } else if (deviceType === 'power') {
                powerMeter.deviceId = deviceId;
                const nameInput = document.getElementById('powerMeterPairingName');
                if (nameInput && !nameInput.value.trim()) {
                    powerMeter.pairingName = '파워메터';
                } else if (nameInput) {
                    powerMeter.pairingName = nameInput.value.trim();
                }
            } else if (deviceType === 'heart') {
                powerMeter.heartRateDeviceId = deviceId;
                const nameInput = document.getElementById('heartRatePairingName');
                if (nameInput && !nameInput.value.trim()) {
                    powerMeter.heartRateName = '심박계';
                } else if (nameInput) {
                    powerMeter.heartRateName = nameInput.value.trim();
                }
            }
            
            // 저장
            saveAllPowerMeterPairingsToStorage();
            
            // 모달에 저장된 데이터 업데이트 (페어링된 기기 카드 표시)
            updatePairingModalWithSavedData(powerMeter);
        }
        
        if (typeof showToast === 'function') {
            showToast(`✅ ${deviceId} 장치가 선택되었습니다.`);
        }
        
        // 리스트에서 선택된 디바이스 표시 업데이트
        const listEl = document.getElementById(listId);
        if (listEl) {
            const item = listEl.querySelector(`[data-device-id="${deviceId}"]`);
            if (item) {
                item.style.borderColor = '#28a745';
                item.style.backgroundColor = '#d4edda';
                const btn = item.querySelector('button');
                if (btn) {
                    btn.className = 'btn btn-sm btn-success';
                    btn.textContent = '선택됨';
                    btn.disabled = true;
                }
                const statusSpan = item.querySelector('.device-status');
                if (statusSpan) {
                    statusSpan.innerHTML = '<span style="font-size:11px; color:#28a745;">✓ 선택됨</span>';
                }
            }
        }
    } else {
        console.error(`[selectIndoorDevice] 입력 필드를 찾을 수 없습니다: ${inputId}`);
        if (typeof showToast === 'function') {
            showToast('입력 필드를 찾을 수 없습니다.');
        }
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
    }, 50);
};

// 4. selectDeviceForInput 함수 (targetType 기반)
window.selectDeviceForInput = function(deviceId, targetType, event) {
    // 이벤트 전파 방지
    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
        event.preventDefault();
    }
    
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
        // 약간의 지연을 주어 클릭 이벤트가 완전히 처리되도록 함
        setTimeout(() => {
            window.selectIndoorDevice(deviceId, listId);
        }, 10);
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
    
    // 워크아웃 선택 버튼 클릭 애니메이션
    const selectBtn = document.getElementById('btnSelectWorkoutTraining');
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
    
    // 로딩 상태는 이미 openWorkoutSelectionModal에서 표시됨
    // 여기서는 로딩 상태 유지
    
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
                        <button class="btn btn-primary btn-sm workout-select-btn" 
                                onclick="selectWorkoutForTraining('${workout.id}')" 
                                data-workout-id="${workout.id}"
                                style="padding: 6px 16px; transition: all 0.3s ease; position: relative; overflow: hidden;">
                            <span class="btn-text">선택</span>
                            <span class="btn-loading" style="display: none;">
                                <span style="display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid #ffffff; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 6px;"></span>
                                로딩...
                            </span>
                        </button>
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
        
        // 선택 버튼 애니메이션 시작
        const selectButtons = document.querySelectorAll(`.workout-select-btn[data-workout-id="${workoutId}"]`);
        selectButtons.forEach(btn => {
            const btnText = btn.querySelector('.btn-text');
            const btnLoading = btn.querySelector('.btn-loading');
            if (btnText && btnLoading) {
                btnText.style.display = 'none';
                btnLoading.style.display = 'inline';
                btn.disabled = true;
                btn.style.opacity = '0.7';
                btn.style.cursor = 'not-allowed';
            }
        });
        
        // apiGetWorkout 함수 확인
        if (typeof apiGetWorkout !== 'function') {
            console.error('[Training] apiGetWorkout 함수를 찾을 수 없습니다.');
            // 버튼 상태 복원
            selectButtons.forEach(btn => {
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');
                if (btnText && btnLoading) {
                    btnText.style.display = 'inline';
                    btnLoading.style.display = 'none';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
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
            // 버튼 상태 복원
            selectButtons.forEach(btn => {
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');
                if (btnText && btnLoading) {
                    btnText.style.display = 'inline';
                    btnLoading.style.display = 'none';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
            if (typeof showToast === 'function') {
                showToast('워크아웃 정보를 불러올 수 없습니다. (응답 없음)', 'error');
            }
            return;
        }
        
        if (!workoutResult.success) {
            console.error('[Training] 워크아웃 로드 실패:', workoutResult.error);
            // 버튼 상태 복원
            selectButtons.forEach(btn => {
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');
                if (btnText && btnLoading) {
                    btnText.style.display = 'inline';
                    btnLoading.style.display = 'none';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
            if (typeof showToast === 'function') {
                showToast(`워크아웃 정보를 불러올 수 없습니다: ${workoutResult.error || '알 수 없는 오류'}`, 'error');
            }
            return;
        }
        
        // Code.gs의 getWorkout은 'item' 필드로 반환함
        const workout = workoutResult.workout || workoutResult.item;
        
        if (!workout) {
            console.error('[Training] workout 데이터가 없습니다. workoutResult:', workoutResult);
            // 버튼 상태 복원
            selectButtons.forEach(btn => {
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');
                if (btnText && btnLoading) {
                    btnText.style.display = 'inline';
                    btnLoading.style.display = 'none';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
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
        
        // Firebase에 workoutPlan 및 workoutId 저장 (개인 대시보드 세그먼트 그래프 표시용)
        if (workout.segments && workout.segments.length > 0 && typeof db !== 'undefined') {
            const sessionId = getSessionId();
            if (sessionId) {
                // workoutPlan 저장 (세그먼트 배열)
                db.ref(`sessions/${sessionId}/workoutPlan`).set(workout.segments)
                    .then(() => {
                        console.log('[Indoor Training] 워크아웃 선택 시 workoutPlan Firebase 저장 완료:', sessionId);
                    })
                    .catch(error => {
                        console.error('[Indoor Training] 워크아웃 선택 시 workoutPlan Firebase 저장 실패:', error);
                    });
                
                // workoutId 저장 (개인훈련 대시보드 훈련 종료 시 사용)
                if (workout.id) {
                    db.ref(`sessions/${sessionId}/workoutId`).set(workout.id)
                        .then(() => {
                            console.log('[Indoor Training] 워크아웃 선택 시 workoutId Firebase 저장 완료:', workout.id, sessionId);
                        })
                        .catch(error => {
                            console.error('[Indoor Training] 워크아웃 선택 시 workoutId Firebase 저장 실패:', error);
                        });
                } else {
                    console.warn('[Indoor Training] 워크아웃 ID가 없어 workoutId를 저장할 수 없습니다.');
                }
            } else {
                console.warn('[Indoor Training] SESSION_ID를 찾을 수 없어 workoutPlan과 workoutId를 저장할 수 없습니다.');
            }
        }
        
        // 모달 닫기
        closeWorkoutSelectionModal();
        
        // 전광판 우측에 세그먼트 그래프 표시
        displayWorkoutSegmentGraph(workout, -1); // 워크아웃 선택 시에는 현재 세그먼트 없음
        
        if (typeof showToast === 'function') {
            showToast(`"${workout.title || '워크아웃'}" 워크아웃이 선택되었습니다.`, 'success');
        }
        
    } catch (error) {
        console.error('[Training] 워크아웃 선택 오류:', error, error.stack);
        // 버튼 상태 복원
        const selectButtons = document.querySelectorAll(`.workout-select-btn[data-workout-id="${workoutId}"]`);
        selectButtons.forEach(btn => {
            const btnText = btn.querySelector('.btn-text');
            const btnLoading = btn.querySelector('.btn-loading');
            if (btnText && btnLoading) {
                btnText.style.display = 'inline';
                btnLoading.style.display = 'none';
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });
        if (typeof showToast === 'function') {
            showToast(`워크아웃 선택 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, 'error');
        }
    }
}

/**
 * 전광판 우측에 워크아웃 세그먼트 그래프 표시
 * @param {Object} workout - 워크아웃 객체
 * @param {number} currentSegmentIndex - 현재 세그먼트 인덱스 (-1이면 선택 안됨)
 */
function displayWorkoutSegmentGraph(workout, currentSegmentIndex = -1) {
    const container = document.getElementById('selectedWorkoutSegmentGraphContainer');
    if (!container) return;
    
    // 세그먼트가 있는 경우에만 표시
    if (!workout.segments || workout.segments.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    // 세그먼트 그래프 그리기 (전광판 크기에 맞춤 - 랩카운트다운과 겹치지 않는 최대 크기)
    setTimeout(() => {
        const canvas = document.getElementById('selectedWorkoutSegmentGraphCanvas');
        if (!canvas) return;
        
        // 전광판 컨테이너 크기 확인
        const scoreboardContainer = container.closest('.scoreboard-display');
        if (!scoreboardContainer) return;
        
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
        // 전광판 높이에 영향을 주지 않는 범위에서 최대한 크게
        // 전광판의 실제 높이를 절대 넘지 않도록 엄격하게 제한
        const marginFromTop = 10; // 상단 여백
        const marginFromBottom = 10; // 하단 여백
        const availableHeight = scoreboardHeight - marginFromTop - marginFromBottom;
        // 전광판 높이를 절대 넘지 않도록 제한 (최소 120px, 최대는 전광판 높이를 넘지 않음)
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
        if (typeof drawSegmentGraphForScoreboard === 'function') {
            drawSegmentGraphForScoreboard(workout.segments, currentSegmentIndex, 'selectedWorkoutSegmentGraphCanvas', maxWidth, maxHeight);
        } else if (typeof drawSegmentGraph === 'function') {
            // 기본 drawSegmentGraph 함수 사용하되, canvas 크기를 제한
            drawSegmentGraph(workout.segments, currentSegmentIndex, 'selectedWorkoutSegmentGraphCanvas');
            
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
    
    // 그래프 크기 설정 (전광판 크기에 맞춤 - 상하 여백 최소화하여 확대)
    const padding = { top: 5, right: 15, bottom: 5, left: 35 }; // 상하 여백 최소화 (5px)
    const availableWidth = maxWidth - padding.left - padding.right;
    const availableHeight = maxHeight - padding.top - padding.bottom;
    
    // 전광판 높이를 절대 넘지 않도록 엄격하게 제한
    const graphWidth = Math.max(availableWidth, 200); // 최소 200px
    const graphHeight = Math.min(Math.max(availableHeight, 80), maxHeight - padding.top - padding.bottom); // 최소 80px, 최대는 maxHeight를 넘지 않음
    const chartWidth = graphWidth - padding.left - padding.right;
    const chartHeight = graphHeight - padding.top - padding.bottom;
    
    // Canvas 크기 설정 (전광판 높이를 절대 넘지 않도록)
    canvas.width = graphWidth;
    canvas.height = graphHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = `${maxWidth}px`;
    canvas.style.maxHeight = `${maxHeight}px`;
    canvas.style.objectFit = 'contain'; // 비율 유지하며 컨테이너에 맞춤
    
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
    
    // Y축 FTP % 값 표기 (0, 0.5, FTP, 1.5, 2)
    const yAxisLabels = [
        { value: 0, label: '0', isFTP: false },
        { value: 50, label: '0.5', isFTP: false },
        { value: 100, label: 'FTP', isFTP: true },
        { value: 150, label: '1.5', isFTP: false },
        { value: 200, label: '2', isFTP: false }
    ];
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    yAxisLabels.forEach(({ value: ftpPercent, label, isFTP }) => {
        // FTP %에 따른 Y 위치 계산 (200%를 최대값으로)
        const maxFtpPercent = 200;
        const yRatio = ftpPercent / maxFtpPercent;
        const y = padding.top + chartHeight - (yRatio * chartHeight);
        
        // FTP 라벨은 둥근네모상자(투명 주황색 바탕)로 표기 - 가운데 정렬
        if (isFTP) {
            // 텍스트 크기 측정
            ctx.font = '9px sans-serif';
            const textMetrics = ctx.measureText(label);
            const textWidth = textMetrics.width;
            const textHeight = 12; // 폰트 크기 기준 높이
            const paddingX = 6;
            const paddingY = 3;
            const boxWidth = textWidth + paddingX * 2;
            const boxHeight = textHeight + paddingY * 2;
            const boxX = padding.left - 8 - boxWidth;
            const boxY = y - boxHeight / 2;
            
            // 둥근네모상자 그리기 (투명 주황색 바탕)
            ctx.fillStyle = 'rgba(255, 165, 0, 0.3)'; // 투명 주황색
            ctx.beginPath();
            const radius = 4;
            ctx.moveTo(boxX + radius, boxY);
            ctx.lineTo(boxX + boxWidth - radius, boxY);
            ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
            ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
            ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
            ctx.lineTo(boxX + radius, boxY + boxHeight);
            ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
            ctx.lineTo(boxX, boxY + radius);
            ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
            ctx.closePath();
            ctx.fill();
            
            // 텍스트 그리기 - 상자 안에 가운데 정렬
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.textAlign = 'center'; // 가운데 정렬
            ctx.textBaseline = 'middle'; // 수직 가운데 정렬
            const textX = boxX + boxWidth / 2; // 상자의 가로 중앙
            const textY = boxY + boxHeight / 2; // 상자의 세로 중앙
            ctx.fillText(label, textX, textY);
            
            // textAlign과 textBaseline을 원래대로 복원 (다른 라벨에 영향 방지)
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
        } else {
            // 일반 라벨 (0, 0.5, 1.5, 2)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.fillText(label, padding.left - 8, y);
        }
        
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
    
    // Y축 라벨 아래에 "X 100%" 표기
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const x100LabelY = padding.top + chartHeight + 5; // X축 아래 5px
    ctx.fillText('X 100%', padding.left - 8, x100LabelY);
    
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
        
        // 현재 세그먼트에 흰색 네온 효과 추가 (훈련 화면과 동일한 방식)
        // 시작 버튼 클릭 후에만 네온 효과 적용 (trainingState === 'running')
        const isTrainingRunning = window.indoorTrainingState && window.indoorTrainingState.trainingState === 'running';
        if (isCurrent && currentSegmentIndex >= 0 && isTrainingRunning) {
            // 세그먼트 진행률 계산 (0~1)
            let segmentProgress = 0;
            if (window.indoorTrainingState && window.indoorTrainingState.segmentElapsedTime !== undefined) {
                const segmentDuration = segDuration || 0;
                if (segmentDuration > 0) {
                    segmentProgress = Math.min(1, Math.max(0, window.indoorTrainingState.segmentElapsedTime / segmentDuration));
                }
            }
            
            // 진행된 부분의 너비 계산
            const progressWidth = segWidth * segmentProgress;
            
            // 밝기 애니메이션 효과 (0.5초 주기로 밝았다 어두워졌다)
            const animationTime = Date.now() / 500; // 500ms 주기
            const brightness = 0.5 + 0.5 * Math.sin(animationTime); // 0.5 ~ 1.0 사이 진동
            const neonOpacity = 0.4 + 0.4 * brightness; // 0.4 ~ 0.8 사이 진동
            
            // 전체 세그먼트 경계선 (흰색 네온 효과 - 얇은 테두리, 애니메이션)
            ctx.shadowBlur = 6 + 4 * brightness; // 6 ~ 10 사이 진동
            ctx.shadowColor = `rgba(255, 255, 255, ${neonOpacity})`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + 0.3 * brightness})`; // 0.6 ~ 0.9 사이 진동
            ctx.lineWidth = 1.5; // 얇은 테두리
            ctx.strokeRect(x, y, segWidth, powerHeight);
            
            // 진행된 부분에 더 강한 흰색 네온 효과 (훈련 화면의 progress-fill 네온 효과와 동일)
            if (progressWidth > 0) {
                // 진행된 부분의 사각형 그리기 (흰색 네온 글로우)
                ctx.shadowBlur = 8 + 4 * brightness; // 8 ~ 12 사이 진동
                ctx.shadowColor = `rgba(255, 255, 255, ${neonOpacity * 0.8})`;
                ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + 0.2 * brightness})`; // 0.2 ~ 0.4 사이 진동
                ctx.fillRect(x, y, progressWidth, powerHeight);
                
                // 진행된 부분의 경계선 (더 강한 네온 효과)
                ctx.shadowBlur = 10 + 5 * brightness; // 10 ~ 15 사이 진동
                ctx.shadowColor = `rgba(255, 255, 255, ${neonOpacity})`;
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 + 0.3 * brightness})`; // 0.7 ~ 1.0 사이 진동
                ctx.lineWidth = 1.5; // 얇은 테두리
                ctx.strokeRect(x, y, progressWidth, powerHeight);
            }
            
            // 내부 흰색 네온 효과 (전체 세그먼트)
            ctx.shadowBlur = 6 + 4 * brightness; // 6 ~ 10 사이 진동
            ctx.shadowColor = `rgba(255, 255, 255, ${neonOpacity * 0.7})`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + 0.2 * brightness})`; // 0.5 ~ 0.7 사이 진동
            ctx.lineWidth = 1; // 얇은 테두리
            ctx.strokeRect(x + 1, y + 1, segWidth - 2, powerHeight - 2);
            
            // 그림자 효과 리셋
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
        } else {
            // 일반 세그먼트 경계선
            ctx.strokeStyle = segmentStrokeColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, segWidth, powerHeight);
        }
        
        currentTime += segDuration;
    });
    
    // X축 라벨: 워크아웃 운동시간 (단위:분) - Y축 라벨의 1.5와 2 사이 높이에 위치
    const totalMinutes = Math.round(totalSeconds / 60);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '12.6px sans-serif'; // 18px의 70% (12.6px)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; // 텍스트 기준선을 중앙으로 설정
    // Y축 라벨 1.5(150%)와 2(200%) 사이 높이 계산 (약 175% 위치)
    const maxFtpPercent = 200;
    const targetFtpPercent = 175; // 1.5와 2 사이 (1.75)
    const yRatio = targetFtpPercent / maxFtpPercent; // 0.875
    const xLabelY = padding.top + chartHeight - (yRatio * chartHeight);
    ctx.fillText(`${totalMinutes}분`, padding.left + chartWidth / 2, xLabelY);
}



/**
 * =================================================================
 * [ADD-ON] Firebase 실시간 데이터 동기화 모듈 (방장 -> 클라우드)
 * 기존 로직에 영향을 주지 않고 데이터를 1초마다 업로드합니다.
 * =================================================================
 */

// 1. 업로드 쓰로틀링 변수 (1초에 한번만 전송)
let _lastFbUploadTime = 0;
const _FB_UPLOAD_INTERVAL = 1000; 

// 2. updatePowerMeterData 함수 래핑 (기존 함수 실행 후 업로드 로직 추가)
// 기존 함수를 백업합니다.
const _originalUpdatePowerMeterData = window.updatePowerMeterData;

// 함수 덮어쓰기
window.updatePowerMeterData = function(powerMeterId, power, heartRate, cadence) {
    // A. 원래 기능 실행 (화면 표시, 바늘 돌리기 등)
    if (typeof _originalUpdatePowerMeterData === 'function') {
        _originalUpdatePowerMeterData(powerMeterId, power, heartRate, cadence);
    }

    // B. Firebase 업로드 로직 (방장 PC 부하 방지를 위해 1초 간격 제한)
    const now = Date.now();
    if (now - _lastFbUploadTime > _FB_UPLOAD_INTERVAL) {
        uploadToFirebase();
        _lastFbUploadTime = now;
    }
};

// 3. 실제 업로드 함수
function uploadToFirebase() {
    if (typeof db === 'undefined') return; // Firebase 미설정 시 패스
    
    // SESSION_ID 확인 및 업데이트 (Training Room 선택 시 저장된 room id 사용)
    let sessionId = null;
    if (typeof SESSION_ID !== 'undefined') {
        sessionId = SESSION_ID;
    } else if (typeof window !== 'undefined' && window.SESSION_ID) {
        sessionId = window.SESSION_ID;
    }
    
    // 전역 변수나 localStorage에서 room id 확인
    if (!sessionId || sessionId === 'session_room_1') {
        if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
            sessionId = String(window.currentTrainingRoomId);
            console.log('[Firebase Upload] 전역 변수에서 room id 사용:', sessionId);
        } else if (typeof localStorage !== 'undefined') {
            try {
                const storedRoomId = localStorage.getItem('currentTrainingRoomId');
                if (storedRoomId) {
                    sessionId = storedRoomId;
                    console.log('[Firebase Upload] localStorage에서 room id 사용:', sessionId);
                }
            } catch (e) {
                console.warn('[Firebase Upload] localStorage 접근 실패:', e);
            }
        }
    }
    
    // SESSION_ID가 여전히 없으면 기본값 사용
    if (!sessionId) {
        sessionId = 'session_room_1';
    }
    
    console.log(`[Firebase Upload] 사용할 SESSION_ID: ${sessionId}`);
    
    // window.SESSION_ID 업데이트
    if (typeof window !== 'undefined') {
        window.SESSION_ID = sessionId;
    }

    const state = window.indoorTrainingState;
    const updates = {};

    // (1) 17명 사용자 데이터 일괄 패키징
    // 필수 유지값: userId, userName, ftp, weight, equipment
    // 워크아웃 시작 시 추가 항목: avgPower, cadence, hr, lastUpdate, maxPower, power, segmentPower, targetPower
    state.powerMeters.forEach(pm => {
        if (pm.connected) {
            // Firebase에서 기존 데이터를 먼저 읽어서 필수 필드 보존
            const userRef = db.ref(`sessions/${sessionId}/users/${pm.id}`);
            
            // 비동기 처리를 위해 Promise 사용 (각 사용자별로 개별 업데이트)
            userRef.once('value').then(snapshot => {
                const existingData = snapshot.val() || {};
                
                // 필수 유지값 포함 (powerMeter 객체에서 가져오기, 없으면 기존 값 유지)
                const userData = {
                    // 필수 유지값 (powerMeter에 있으면 업데이트, 없으면 기존 값 유지)
                    userId: pm.userId ? String(pm.userId) : (existingData.userId || undefined),
                    userName: pm.userName || existingData.userName || undefined,
                    ftp: pm.userFTP ? Math.round(pm.userFTP) : (existingData.ftp !== undefined ? existingData.ftp : undefined),
                    weight: pm.userWeight || existingData.weight || undefined,
                    gear: pm.gear || existingData.gear || undefined, // gear 필드 보존 (기존 값 우선)
                    brake: pm.brake || existingData.brake || undefined, // brake 필드 보존 (기존 값 우선)
                    // 워크아웃 시작 시 추가 항목
                    power: Math.round(pm.currentPower || 0),
                    cadence: Math.round(pm.cadence || 0),
                    hr: Math.round(pm.heartRate || 0),
                    maxPower: Math.round(pm.maxPower || 0),
                    avgPower: Math.round(pm.averagePower || 0),
                    segmentPower: Math.round(pm.segmentPower || 0),
                    targetPower: Math.round(pm.targetPower || 0),
                    lastUpdate: firebase.database.ServerValue.TIMESTAMP
                };
                
                // undefined 값 제거 (Firebase update는 undefined를 null로 변환하므로 제거)
                Object.keys(userData).forEach(key => {
                    if (userData[key] === undefined) {
                        delete userData[key];
                    }
                });
                
                // update()를 사용하여 기존 데이터는 유지하고 지정된 필드만 업데이트
                return userRef.update(userData);
            }).then(() => {
                console.log(`[Firebase Upload] 트랙 ${pm.id} 사용자 데이터 업데이트 완료 (equipment 보존):`, {
                    gear: pm.gear || '기존 값 유지',
                    brake: pm.brake || '기존 값 유지',
                    userId: pm.userId,
                    userName: pm.userName
                });
            }).catch(error => {
                console.error(`[Firebase Upload] 트랙 ${pm.id} 사용자 데이터 업데이트 실패:`, error);
            });
        }
    });

    // (2) 훈련 상태 정보 (타이머 동기화용)
    const statusUpdate = {
        state: state.trainingState, // 'idle', 'running', 'paused'
        startTime: state.startTime,
        pausedTime: state.pausedTime || 0,
        segmentIndex: state.currentSegmentIndex,
        elapsedTime: state.totalElapsedTime, // 방장 기준 경과시간
        segmentElapsedTime: state.segmentElapsedTime
    };
    
    // 현재 세그먼트 정보 추가 (개인 대시보드 표시용)
    if (state.currentWorkout && state.currentWorkout.segments && 
        state.currentSegmentIndex >= 0 && 
        state.currentSegmentIndex < state.currentWorkout.segments.length) {
        const currentSegment = state.currentWorkout.segments[state.currentSegmentIndex];
        if (currentSegment) {
            statusUpdate.segmentTargetType = currentSegment.target_type || 'ftp_pct';
            statusUpdate.segmentTargetValue = currentSegment.target_value;
            // 세그먼트 이름도 있으면 추가
            if (currentSegment.name) {
                statusUpdate.segmentName = currentSegment.name;
            }
        }
    }
    
    updates[`sessions/${sessionId}/status`] = statusUpdate;

    // (3) 워크아웃 정보 (변경되었을 때만 보내면 좋지만 단순화를 위해 매번 체크)
    // 실제로는 데이터양이 크므로 startTraining에서 한 번만 보내는 게 정석이지만 안전하게 구현
    
    // (4) 전송 실행
    if (Object.keys(updates).length > 0) {
        db.ref().update(updates).catch(e => console.warn("FB Upload Error:", e));
    }
}

// 4. 상태 변경 함수들도 래핑 (시작/정지 즉시 반영을 위해)
const _originalStartTraining = window.startTraining;
window.startTraining = function() {
    _originalStartTraining();
    // 워크아웃 전체 정보 업로드 (그래프 그리기용)
    if (window.indoorTrainingState.currentWorkout && typeof db !== 'undefined') {
        const sessionId = getSessionId();
        if (sessionId) {
            // workoutPlan 저장 (세그먼트 배열)
            db.ref(`sessions/${sessionId}/workoutPlan`).set(window.indoorTrainingState.currentWorkout.segments)
                .then(() => {
                    console.log('[Indoor Training] workoutPlan Firebase 저장 완료:', sessionId);
                })
                .catch(error => {
                    console.error('[Indoor Training] workoutPlan Firebase 저장 실패:', error);
                });
            
            // workoutId 저장 (개인훈련 대시보드 훈련 종료 시 사용)
            if (window.indoorTrainingState.currentWorkout.id) {
                db.ref(`sessions/${sessionId}/workoutId`).set(window.indoorTrainingState.currentWorkout.id)
                    .then(() => {
                        console.log('[Indoor Training] workoutId Firebase 저장 완료:', window.indoorTrainingState.currentWorkout.id, sessionId);
                    })
                    .catch(error => {
                        console.error('[Indoor Training] workoutId Firebase 저장 실패:', error);
                    });
            } else {
                console.warn('[Indoor Training] 워크아웃 ID가 없어 workoutId를 저장할 수 없습니다.');
            }
        } else {
            console.warn('[Indoor Training] SESSION_ID를 찾을 수 없어 workoutPlan과 workoutId를 저장할 수 없습니다.');
        }
    }
    uploadToFirebase(); // 즉시 전송
};

const _originalPauseTraining = window.pauseTraining;
window.pauseTraining = function() {
    _originalPauseTraining();
    uploadToFirebase();
};

const _originalResumeTraining = window.resumeTraining;
window.resumeTraining = function() {
    _originalResumeTraining();
    uploadToFirebase();
};

const _originalStopTraining = window.stopTraining;
window.stopTraining = function() {
    _originalStopTraining();
    // 종료 상태 전송
    if (typeof db !== 'undefined') {
        const sessionId = getSessionId();
        db.ref(`sessions/${sessionId}/status`).update({ state: 'idle' });
    }
};

const _originalSkipSegment = window.skipSegment;
window.skipSegment = function() {
    _originalSkipSegment();
    uploadToFirebase();
};






















