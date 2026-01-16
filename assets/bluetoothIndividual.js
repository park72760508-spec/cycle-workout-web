// bluetoothIndividual.js

// 1. URL 파라미터에서 트랙 번호 확인 (?track=1)
const params = new URLSearchParams(window.location.search);
let myTrackId = params.get('track');

// 번호가 없으면 강제로 물어봄
while (!myTrackId) {
    myTrackId = prompt("트랙 번호를 입력하세요 (예: 1, 5, 12)", "1");
    if(myTrackId) {
        // 입력받은 번호로 URL 새로고침 (즐겨찾기 용이하게)
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?track=' + myTrackId;
        window.history.pushState({path:newUrl},'',newUrl);
    }
}

// 초기 표시 (나중에 사용자 이름으로 업데이트됨)
document.getElementById('bike-id-display').innerText = `Track ${myTrackId}`;

// 사용자 FTP 값 저장 (전역 변수)
let userFTP = 200; // 기본값 200W
window.userFTP = userFTP; // workoutManager.js에서 접근 가능하도록 전역 노출

// Firebase에서 받은 목표 파워 값 저장 (전역 변수)
let firebaseTargetPower = null;

// 개인 훈련 대시보드 강도 조절 변수
let individualIntensityAdjustment = 1.0; // 기본값: 1.0 (100%)

// 가민 스타일 부드러운 바늘 움직임을 위한 변수
let currentPowerValue = 0; // window.liveData에서 받은 실제 파워값
let displayPower = 0; // 화면에 표시되는 부드러운 파워값 (보간 적용)
let gaugeAnimationFrameId = null; // 애니메이션 루프 ID

// 2. window.liveData에서 데이터 읽기 및 Firebase로 전송
// SESSION_ID는 firebaseConfig.js에 정의됨
// window.liveData는 bluetooth.js에서 업데이트됨 (power, heartRate, cadence)
let firebaseDataUpdateInterval = null; // Firebase 전송 인터벌

// Firebase에 데이터를 전송하는 함수
function sendDataToFirebase() {
    if (!window.liveData || !SESSION_ID || !myTrackId) {
        return;
    }
    
    // window.liveData에서 데이터 읽기
    const power = Number(window.liveData.power || 0);
    const heartRate = Number(window.liveData.heartRate || 0);
    const cadence = Number(window.liveData.cadence || 0);
    
    // Firebase에 전송할 데이터 객체
    const dataToSend = {
        power: power > 0 ? power : 0,
        hr: heartRate > 0 ? heartRate : 0,
        heartRate: heartRate > 0 ? heartRate : 0,
        cadence: cadence > 0 ? cadence : 0,
        rpm: cadence > 0 ? cadence : 0,
        timestamp: Date.now()
    };
    
    // Firebase에 업데이트 (merge: true로 기존 데이터 보존)
    db.ref(`sessions/${SESSION_ID}/users/${myTrackId}`).update(dataToSend)
        .then(() => {
            // 성공 시 대시보드 업데이트
            updateDashboard(dataToSend);
        })
        .catch((error) => {
            console.error('[BluetoothIndividual] Firebase 전송 실패:', error);
        });
}

// 주기적으로 Firebase에 데이터 전송 (1초마다)
function startFirebaseDataTransmission() {
    // 기존 인터벌이 있으면 제거
    if (firebaseDataUpdateInterval) {
        clearInterval(firebaseDataUpdateInterval);
    }
    
    // 1초마다 데이터 전송
    firebaseDataUpdateInterval = setInterval(() => {
        sendDataToFirebase();
    }, 1000);
    
    console.log('[BluetoothIndividual] Firebase 데이터 전송 시작 (1초마다)');
}

// Firebase 데이터 전송 중지
function stopFirebaseDataTransmission() {
    if (firebaseDataUpdateInterval) {
        clearInterval(firebaseDataUpdateInterval);
        firebaseDataUpdateInterval = null;
        console.log('[BluetoothIndividual] Firebase 데이터 전송 중지');
    }
}

// 페이지 로드 시 Firebase 데이터 전송 시작
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        startFirebaseDataTransmission();
    });
} else {
    startFirebaseDataTransmission();
}

// 페이지 언로드 시 Firebase 데이터 전송 중지
window.addEventListener('beforeunload', () => {
    stopFirebaseDataTransmission();
});

// 사용자 이름 및 기타 메타데이터는 Firebase에서 한 번만 읽기
let userDataLoaded = false;
db.ref(`sessions/${SESSION_ID}/users/${myTrackId}`).once('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data && !userDataLoaded) {
        userDataLoaded = true;
        
        // 사용자 FTP 값 업데이트
        let foundFTP = null;
        
        if (data.ftp !== undefined && data.ftp !== null && data.ftp !== '') {
            foundFTP = Number(data.ftp);
        } else if (data.FTP !== undefined && data.FTP !== null && data.FTP !== '') {
            foundFTP = Number(data.FTP);
        } else if (data.userFTP !== undefined && data.userFTP !== null && data.userFTP !== '') {
            foundFTP = Number(data.userFTP);
        } else if (data.userFtp !== undefined && data.userFtp !== null && data.userFtp !== '') {
            foundFTP = Number(data.userFtp);
        } else if (data.participant && data.participant.ftp !== undefined && data.participant.ftp !== null) {
            foundFTP = Number(data.participant.ftp);
        } else if (data.participant && data.participant.FTP !== undefined && data.participant.FTP !== null) {
            foundFTP = Number(data.participant.FTP);
        } else if (data.user && data.user.ftp !== undefined && data.user.ftp !== null) {
            foundFTP = Number(data.user.ftp);
        } else if (data.user && data.user.FTP !== undefined && data.user.FTP !== null) {
            foundFTP = Number(data.user.FTP);
        }
        
        if (foundFTP !== null && !isNaN(foundFTP) && foundFTP > 0) {
            userFTP = foundFTP;
            window.userFTP = userFTP;
            if (typeof updateGaugeTicksAndLabels === 'function') {
                updateGaugeTicksAndLabels();
            }
        }
        
        // targetPower 값 확인
        if (data.targetPower !== undefined && data.targetPower !== null && data.targetPower !== '') {
            const targetPowerValue = Number(data.targetPower);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        } else if (data.target_power !== undefined && data.target_power !== null && data.target_power !== '') {
            const targetPowerValue = Number(data.target_power);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        } else if (data.segmentTargetPowerW !== undefined && data.segmentTargetPowerW !== null && data.segmentTargetPowerW !== '') {
            const targetPowerValue = Number(data.segmentTargetPowerW);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        }
        
        // 사용자 ID 저장
        if (data.userId) {
            currentUserIdForSession = String(data.userId);
        }
        
        // 사용자 이름 업데이트
        updateUserName(data);
        
        // TARGET 파워 업데이트
        updateTargetPower();
    }
});

// 사용자 이름 업데이트 함수
function updateUserName(data) {
    const bikeIdDisplay = document.getElementById('bike-id-display');
    if (!bikeIdDisplay) return;
    
    // 사용자 이름 추출
    const userName = data.userName || null;
    
    if (userName) {
        bikeIdDisplay.innerText = userName;
    } else {
        // 이름이 없으면 Track 번호 표시
        bikeIdDisplay.innerText = `Track ${myTrackId}`;
    }
}

// 3. 훈련 상태 구독 (타이머, 세그먼트 정보)
let currentSegmentIndex = -1;
let previousTrainingState = null; // 이전 훈련 상태 추적
let lastWorkoutId = null; // 마지막 워크아웃 ID
window.currentTrainingState = 'idle'; // 전역 훈련 상태 (마스코트 애니메이션용)

/**
 * Workout ID를 가져오는 헬퍼 함수 (비동기)
 * @returns {Promise<string|null>} workoutId 또는 null
 */
async function getWorkoutId() {
    // 1순위: window.currentWorkout.id (가장 빠름)
    if (window.currentWorkout?.id) {
        return window.currentWorkout.id;
    }
    
    // 2순위: lastWorkoutId (로컬 변수)
    if (lastWorkoutId) {
        return lastWorkoutId;
    }
    
    // 3순위: Firebase에서 직접 가져오기
    try {
        const snapshot = await db.ref(`sessions/${SESSION_ID}/workoutId`).once('value');
        const workoutId = snapshot.val();
        if (workoutId) {
            // 가져온 값 저장
            if (!window.currentWorkout) {
                window.currentWorkout = {};
            }
            window.currentWorkout.id = workoutId;
            lastWorkoutId = workoutId;
            return workoutId;
        }
    } catch (error) {
        console.error('[getWorkoutId] Firebase에서 workoutId 가져오기 실패:', error);
    }
    
    return null;
}

/**
 * Workout ID를 동기적으로 가져오는 함수 (이미 로드된 경우)
 * @returns {string|null} workoutId 또는 null
 */
function getWorkoutIdSync() {
    // 1순위: window.currentWorkout.id
    if (window.currentWorkout?.id) {
        return window.currentWorkout.id;
    }
    
    // 2순위: lastWorkoutId
    if (lastWorkoutId) {
        return lastWorkoutId;
    }
    
    return null;
}

// 전역으로 노출 (다른 스크립트에서도 사용 가능)
window.getWorkoutId = getWorkoutId;
window.getWorkoutIdSync = getWorkoutIdSync;

db.ref(`sessions/${SESSION_ID}/status`).on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
        // 훈련 상태 변화 감지 및 세션 관리
        const currentState = status.state || 'idle';
        const previousState = window.currentTrainingState;
        window.currentTrainingState = currentState; // 전역 변수에 저장
        
        // 화면 잠금 방지 제어 (훈련 진행 중에만 활성화)
        if (typeof window.wakeLockControl !== 'undefined') {
            if (currentState === 'running' && previousState !== 'running') {
                // 훈련 시작: 화면 잠금 방지 활성화
                console.log('[Bluetooth 개인 훈련] 훈련 시작 - 화면 잠금 방지 활성화');
                window.wakeLockControl.request();
            } else if ((currentState === 'idle' || currentState === 'paused' || currentState === 'ended') && previousState === 'running') {
                // 훈련 종료/일시정지: 화면 잠금 방지 해제
                console.log('[Bluetooth 개인 훈련] 훈련 종료/일시정지 - 화면 잠금 방지 해제');
                window.wakeLockControl.release();
            }
        }
        
        // 훈련 시작 감지 (idle/paused -> running)
        if (previousTrainingState !== 'running' && currentState === 'running') {
            // 워크아웃 ID 가져오기 (Firebase에서 또는 window.currentWorkout에서)
            db.ref(`sessions/${SESSION_ID}/workoutId`).once('value', (workoutIdSnapshot) => {
                const workoutId = workoutIdSnapshot.val();
                if (workoutId) {
                    if (!window.currentWorkout) {
                        window.currentWorkout = {};
                    }
                    window.currentWorkout.id = workoutId;
                    lastWorkoutId = workoutId;
                }
                
                // 세션 시작 (사용자 ID는 이미 currentUserIdForSession에 저장됨)
                if (window.trainingResults && typeof window.trainingResults.startSession === 'function' && currentUserIdForSession) {
                    window.trainingResults.startSession(currentUserIdForSession);
                    console.log('[BluetoothIndividual] 훈련 세션 시작:', { userId: currentUserIdForSession, workoutId: lastWorkoutId || window.currentWorkout?.id });
                } else if (!currentUserIdForSession) {
                    console.warn('[BluetoothIndividual] 사용자 ID가 없어 세션을 시작할 수 없습니다.');
                }
            });
        }
        
        // 훈련 종료 감지 (running -> finished/stopped/idle 또는 모든 세그먼트 완료)
        if (previousTrainingState === 'running' && (currentState === 'finished' || currentState === 'stopped' || currentState === 'idle')) {
            // 또는 모든 세그먼트가 완료되었는지 확인
            const totalSegments = window.currentWorkout?.segments?.length || 0;
            const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
            const isAllSegmentsComplete = (status.segmentIndex !== undefined && status.segmentIndex >= lastSegmentIndex) || currentState === 'finished';
            
            if (isAllSegmentsComplete || currentState === 'finished' || currentState === 'stopped') {
                // elapsedTime을 전역 변수에 저장 (저장 시 사용)
                if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
                    window.lastElapsedTime = status.elapsedTime;
                    console.log('[BluetoothIndividual] 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
                }
                
                // 모바일 대시보드와 동일한 훈련 결과 저장 로직 적용
                // ✅ await 없이 순차 실행(저장 → 초기화 → 결과 모달 표시)
                Promise.resolve()
                    .then(() => {
                        console.log('[BluetoothIndividual] 🚀 1단계: 결과 저장 시작');
                        return window.saveTrainingResultAtEnd?.();
                    })
                    .then((saveResult) => {
                        console.log('[BluetoothIndividual] ✅ 1단계 완료:', saveResult);
                        
                        // 저장 결과 확인 및 알림
                        if (saveResult?.saveResult?.source === 'local') {
                            console.log('[BluetoothIndividual] 📱 로컬 저장 모드 - CORS 오류로 서버 저장 실패');
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 기기에 저장되었습니다 (서버 연결 불가)", "warning");
                            }
                        } else if (saveResult?.saveResult?.source === 'gas') {
                            console.log('[BluetoothIndividual] 🌐 서버 저장 성공');
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 서버에 저장되었습니다");
                            }
                        }
                        
                        return window.trainingResults?.initializeResultScreen?.();
                    })
                    .catch((e) => { 
                        console.warn('[BluetoothIndividual] initializeResultScreen error', e); 
                    })
                    .then(() => {
                        console.log('[BluetoothIndividual] ✅ 2단계: 결과 화면 초기화 완료');
                        // 결과 팝업 표시
                        showTrainingResultModal(status);
                    })
                    .catch((error) => {
                        console.error('[BluetoothIndividual] ❌ 훈련 결과 저장/초기화 실패:', error);
                        // 저장 실패해도 팝업 표시 (로컬 데이터라도 있으면)
                        showTrainingResultModal(status);
                    });
            }
        }
        
        previousTrainingState = currentState;
        
        updateTimer(status);
        
        // 세그먼트 정보 표시
        currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
        const segmentInfoEl = document.getElementById('segment-info');
        if (segmentInfoEl) {
            if (status.state === 'running') {
                // 현재 세그먼트 정보 가져오기
                const currentSegment = getCurrentSegment();
                if (currentSegment) {
                    // 세그먼트 이름과 목표 값을 조합하여 표시
                    const segmentName = currentSegment.name || '';
                    const targetText = formatSegmentInfo(
                        status.segmentTargetType || currentSegment.target_type,
                        status.segmentTargetValue !== undefined ? status.segmentTargetValue : currentSegment.target_value
                    );
                    
                    // 세그먼트 이름이 있으면 "세그먼트 이름(목표 값)" 형식, 없으면 "목표 값"만 표시
                    const segmentText = segmentName 
                        ? `${segmentName}(${targetText})`
                        : targetText;
                    segmentInfoEl.innerText = segmentText;
                } else {
                    // 세그먼트 정보가 없으면 Firebase status에서 받은 정보로 표시
                    if (status.segmentTargetType && status.segmentTargetValue !== undefined) {
                        const segmentText = formatSegmentInfo(status.segmentTargetType, status.segmentTargetValue);
                        segmentInfoEl.innerText = segmentText;
                    } else {
                        segmentInfoEl.innerText = '준비 중';
                    }
                }
            } else if (status.state === 'paused') {
                segmentInfoEl.innerText = '일시정지';
            } else {
                segmentInfoEl.innerText = '대기 중';
            }
        }
        
        // 랩타임 카운트다운 업데이트
        updateLapTime(status);
        
        // 현재 세그먼트 정보 확인 및 로그 출력 (디버깅용)
        if (status.state === 'running') {
            logCurrentSegmentInfo();
        }
        
        // TARGET 파워 업데이트 (세그먼트 변경 시)
        updateTargetPower();
        
        // 세그먼트 그래프 업데이트
        if (window.currentWorkout && window.currentWorkout.segments) {
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    }
});

// 4. 워크아웃 정보 구독 (세그먼트 그래프 표시용)
db.ref(`sessions/${SESSION_ID}/workoutPlan`).on('value', (snapshot) => {
    const segments = snapshot.val();
    if (segments && Array.isArray(segments) && segments.length > 0) {
        // 워크아웃 객체 생성
        if (!window.currentWorkout) {
            window.currentWorkout = {};
        }
        window.currentWorkout.segments = segments;
        
        // 워크아웃 ID 가져오기 (Firebase에서 확인)
        // workoutPlan이 업데이트될 때 workoutId도 함께 확인하여 저장
        // 헬퍼 함수를 사용하여 workoutId 가져오기
        (async () => {
            try {
                const workoutId = await getWorkoutId();
                if (workoutId) {
                    console.log('[BluetoothIndividual] workoutPlan 업데이트 시 workoutId 확인:', workoutId);
                } else {
                    // workoutId가 없어도 경고만 출력 (나중에 로드될 수 있음)
                    console.log('[BluetoothIndividual] workoutPlan은 있지만 workoutId를 아직 찾을 수 없습니다. (나중에 로드될 수 있음)');
                }
            } catch (error) {
                console.warn('[BluetoothIndividual] workoutId 가져오기 실패:', error);
            }
        })();
        
        // 세그먼트 그래프 그리기
        updateSegmentGraph(segments, currentSegmentIndex);
        // TARGET 파워 업데이트 (워크아웃 정보 로드 시)
        updateTargetPower();
    }
});

// =========================================================
// UI 업데이트 함수들
// =========================================================

// updateDashboard 함수: window.liveData에서 읽어서 대시보드 업데이트
function updateDashboard(data = null) {
    // data가 없으면 window.liveData에서 읽기 (Bluetooth 데이터)
    if (!data) {
        data = window.liveData || {};
    }
    
    // 1. 텍스트 업데이트
    // 파워값 가져오기 (window.liveData 또는 data에서)
    const power = Number(data.power || data.currentPower || data.watts || data.currentPowerW || 0);
    
    // window.liveData에 파워값 업데이트 (3초 평균 계산을 위해)
    if (!window.liveData) {
      window.liveData = {};
    }
    window.liveData.power = power;
    
    // 3초 평균 파워값 계산 (전역 함수 사용)
    let powerValue = power; // 기본값은 현재 파워값
    if (window.get3SecondAveragePower && typeof window.get3SecondAveragePower === 'function') {
      powerValue = window.get3SecondAveragePower();
    } else {
      // 함수가 없으면 현재값 사용
      powerValue = Math.round(power);
    }
    
    // 현재 파워값을 전역 변수에 저장 (바늘 애니메이션 루프에서 사용)
    currentPowerValue = powerValue;
    
    // SVG text 요소는 textContent 사용 (innerText보다 안정적)
    // 텍스트는 즉시 업데이트 (바늘은 애니메이션 루프에서 부드럽게 이동)
    const powerEl = document.getElementById('ui-current-power');
    if (powerEl) {
        powerEl.textContent = powerValue;
        powerEl.setAttribute('fill', '#fff');
    }
    
    // TARGET 파워는 세그먼트 정보에서 계산
    updateTargetPower();
    
    // CADENCE 표시
    const cadence = Number(data.cadence || data.rpm || 0);
    const cadenceEl = document.getElementById('ui-cadence');
    if (cadenceEl) {
        cadenceEl.textContent = Math.round(cadence);
    }
    
    // HEART RATE 표시
    const hr = Number(data.hr || data.heartRate || data.bpm || 0);
    const hrEl = document.getElementById('ui-hr');
    if (hrEl) {
        hrEl.textContent = Math.round(hr);
    }
    
    // 랩파워 표시 (세그먼트 평균 파워)
    const lapPower = Number(data.segmentPower || data.avgPower || data.segmentAvgPower || data.averagePower || 0);
    const lapPowerEl = document.getElementById('ui-lap-power');
    if (lapPowerEl) {
        lapPowerEl.textContent = Math.round(lapPower);
    }
    
    // 실시간 데이터를 resultManager에 기록 (훈련 진행 중일 때만)
    if (window.trainingResults && typeof window.trainingResults.appendStreamSample === 'function') {
        // 파워 데이터 기록
        if (powerValue > 0) {
            window.trainingResults.appendStreamSample('power', powerValue);
        }
        // 심박수 데이터 기록
        if (hr > 0) {
            window.trainingResults.appendStreamSample('hr', hr);
        }
        // 케이던스 데이터 기록
        if (cadence > 0) {
            window.trainingResults.appendStreamSample('cadence', cadence);
        }
    }
    
    // 바늘 움직임은 startGaugeAnimationLoop에서 처리 (가민 스타일 부드러운 움직임)
}

function updateTimer(status) {
    const timerEl = document.getElementById('main-timer');
    
    if (status.state === 'running') {
        // 방장이 계산해서 보내준 elapsedTime 사용 (가장 정확)
        const totalSeconds = status.elapsedTime || 0;
        timerEl.innerText = formatHMS(totalSeconds); // hh:mm:ss 형식
        timerEl.style.color = '#00d4aa'; // 실행중 색상
        
        // 경과시간을 전역 변수에 저장 (마스코트 위치 계산용)
        if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
            window.lastElapsedTime = status.elapsedTime;
        }
        
        // 세그먼트 그래프 업데이트 (마스코트 위치 업데이트)
        if (window.currentWorkout && window.currentWorkout.segments) {
            const currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    } else if (status.state === 'paused') {
        timerEl.style.color = '#ffaa00'; // 일시정지 색상
    } else {
        timerEl.innerText = "00:00:00";
        timerEl.style.color = '#fff';
        
        // 훈련이 종료되거나 시작 전이면 마스코트를 0 위치로
        if (window.currentWorkout && window.currentWorkout.segments) {
            window.lastElapsedTime = 0;
            const currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    }
}

// 시간 포맷: 초 → "mm:ss"
function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// 시간 포맷: 초 → "hh:mm:ss"
function formatHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// NOTE: 나머지 함수들(updateLapTime, updateTargetPower, formatSegmentInfo, getCurrentSegment, logCurrentSegmentInfo, updateSegmentGraph, generateGaugeTicks, generateGaugeLabels, updateGaugeTicksAndLabels, startGaugeAnimationLoop, showTrainingResultModal, closeTrainingResultModal, updateTargetPowerArc, initializeIndividualIntensitySlider, updateIndividualIntensityAdjustment, updateIndividualIntensityDisplay)은 individual.js와 동일하게 사용
// 이 함수들은 individual.js에서 직접 참조하거나, 필요시 추가할 수 있습니다.
