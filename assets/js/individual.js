// individual.js

// 1. URL 파라미터에서 자전거 번호 확인 (?bike=1)
const params = new URLSearchParams(window.location.search);
let myBikeId = params.get('bike');

// 번호가 없으면 강제로 물어봄
while (!myBikeId) {
    myBikeId = prompt("자전거 번호를 입력하세요 (예: 1, 5, 12)", "1");
    if(myBikeId) {
        // 입력받은 번호로 URL 새로고침 (즐겨찾기 용이하게)
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?bike=' + myBikeId;
        window.history.pushState({path:newUrl},'',newUrl);
    }
}

// 초기 표시 (나중에 사용자 이름으로 업데이트됨)
document.getElementById('bike-id-display').innerText = `Bike ${myBikeId}`;

// 사용자 FTP 값 저장 (전역 변수)
let userFTP = 200; // 기본값 200W
window.userFTP = userFTP; // workoutManager.js에서 접근 가능하도록 전역 노출

// Firebase에서 받은 목표 파워 값 저장 (전역 변수)
let firebaseTargetPower = null;

// 개인 훈련 대시보드 강도 조절 변수
let individualIntensityAdjustment = 1.0; // 기본값: 1.0 (100%)

// [수정] 타이머 제어용 전역 변수 추가 (로컬 시간 추적용)
let individualTrainingTimerInterval = null; // 개인훈련 대시보드 전용 타이머 인터벌
let individualLocalElapsedTime = 0; // 로컬 경과 시간 (초)
let individualTrainingStartTime = null; // 훈련 시작 시간 (Date.now())
let individualSegmentStartTime = null; // 세그먼트 시작 시간 (Date.now())
let previousIndividualSegmentIndex = -1; // 이전 세그먼트 인덱스

// 가민 스타일 부드러운 바늘 움직임을 위한 변수
let currentPowerValue = 0; // Firebase에서 받은 실제 파워값
let displayPower = 0; // 화면에 표시되는 부드러운 파워값 (보간 적용)
let gaugeAnimationFrameId = null; // 애니메이션 루프 ID

// 2. Firebase 데이터 구독 (내 자전거 데이터)
// SESSION_ID는 firebaseConfig.js에 정의됨
db.ref(`sessions/${SESSION_ID}/users/${myBikeId}`).on('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
        // 사용자 FTP 값 업데이트 (여러 필드명 및 경로 지원)
        console.log('[Firebase] 사용자 데이터:', JSON.stringify(data, null, 2));
        console.log('[Firebase] 사용자 데이터 키 목록:', Object.keys(data || {}));
        
        // targetPower 값 확인 (Firebase에서 계산된 목표 파워 값 우선 사용)
        if (data.targetPower !== undefined && data.targetPower !== null && data.targetPower !== '') {
            const targetPowerValue = Number(data.targetPower);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
                console.log('[Firebase] 목표 파워 값 (targetPower):', firebaseTargetPower, 'W');
            }
        } else if (data.target_power !== undefined && data.target_power !== null && data.target_power !== '') {
            const targetPowerValue = Number(data.target_power);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
                console.log('[Firebase] 목표 파워 값 (target_power):', firebaseTargetPower, 'W');
            }
        } else if (data.segmentTargetPowerW !== undefined && data.segmentTargetPowerW !== null && data.segmentTargetPowerW !== '') {
            const targetPowerValue = Number(data.segmentTargetPowerW);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
                console.log('[Firebase] 목표 파워 값 (segmentTargetPowerW):', firebaseTargetPower, 'W');
            }
        }
        
        // FTP 값 추출 시도 (targetPower가 없을 때 계산용으로 사용)
        let foundFTP = null;
        
        // 1순위: 직접 필드 (다양한 대소문자 조합)
        if (data.ftp !== undefined && data.ftp !== null && data.ftp !== '') {
            foundFTP = Number(data.ftp);
            console.log('[Firebase] FTP 값 발견 (data.ftp):', foundFTP);
        } else if (data.FTP !== undefined && data.FTP !== null && data.FTP !== '') {
            foundFTP = Number(data.FTP);
            console.log('[Firebase] FTP 값 발견 (data.FTP):', foundFTP);
        } else if (data.userFTP !== undefined && data.userFTP !== null && data.userFTP !== '') {
            foundFTP = Number(data.userFTP);
            console.log('[Firebase] FTP 값 발견 (data.userFTP):', foundFTP);
        } else if (data.userFtp !== undefined && data.userFtp !== null && data.userFtp !== '') {
            foundFTP = Number(data.userFtp);
            console.log('[Firebase] FTP 값 발견 (data.userFtp):', foundFTP);
        }
        // 2순위: 중첩 객체 내 FTP (participant, user 등의 객체 내부)
        else if (data.participant && data.participant.ftp !== undefined && data.participant.ftp !== null) {
            foundFTP = Number(data.participant.ftp);
            console.log('[Firebase] FTP 값 발견 (data.participant.ftp):', foundFTP);
        } else if (data.participant && data.participant.FTP !== undefined && data.participant.FTP !== null) {
            foundFTP = Number(data.participant.FTP);
            console.log('[Firebase] FTP 값 발견 (data.participant.FTP):', foundFTP);
        } else if (data.user && data.user.ftp !== undefined && data.user.ftp !== null) {
            foundFTP = Number(data.user.ftp);
            console.log('[Firebase] FTP 값 발견 (data.user.ftp):', foundFTP);
        } else if (data.user && data.user.FTP !== undefined && data.user.FTP !== null) {
            foundFTP = Number(data.user.FTP);
            console.log('[Firebase] FTP 값 발견 (data.user.FTP):', foundFTP);
        }
        
        // FTP 값이 유효한지 확인 (0보다 큰 값)
        if (foundFTP !== null && !isNaN(foundFTP) && foundFTP > 0) {
            userFTP = foundFTP;
            window.userFTP = userFTP; // workoutManager.js에서 접근 가능하도록 전역 노출
            console.log('[Firebase] 사용자 FTP 값 성공적으로 추출:', userFTP, 'W');
            // 속도계 레이블 업데이트 (FTP 값이 변경되었으므로)
            if (typeof updateGaugeTicksAndLabels === 'function') {
                updateGaugeTicksAndLabels();
            }
        } else {
            console.warn('[Firebase] FTP 값을 찾을 수 없습니다. 기본값 200 사용');
            console.warn('[Firebase] 추출 시도한 값:', foundFTP);
            console.warn('[Firebase] 데이터 키 목록:', Object.keys(data || {}));
            console.warn('[Firebase] 전체 데이터:', JSON.stringify(data, null, 2));
            // 기본값은 그대로 유지 (이미 200으로 설정됨)
        }
        
        // 사용자 ID 저장 (세션 관리용)
        if (data.userId) {
            currentUserIdForSession = String(data.userId);
        }
        
        // 사용자 ID 저장 (세션 관리용)
        if (data.userId) {
            currentUserIdForSession = String(data.userId);
        }
        
        // 사용자 이름 업데이트
        updateUserName(data);
        updateDashboard(data);
        
        // TARGET 파워도 업데이트
        updateTargetPower();
    } else {
        // 데이터가 없으면 (연결 안됨)
        document.getElementById('ui-current-power').innerText = '-';
        document.getElementById('ui-current-power').style.fill = '#555';
        // 기본값으로 Bike 번호 표시
        document.getElementById('bike-id-display').innerText = `Bike ${myBikeId}`;
        // Firebase targetPower도 초기화
        firebaseTargetPower = null;
    }
});

// 사용자 이름 업데이트 함수
function updateUserName(data) {
    const bikeIdDisplay = document.getElementById('bike-id-display');
    if (!bikeIdDisplay) return;
    
    // 사용자 이름 추출 (userName만 사용)
    const userName = data.userName || null;
    
    if (userName) {
        bikeIdDisplay.innerText = userName;
    } else {
        // 이름이 없으면 Bike 번호 표시
        bikeIdDisplay.innerText = `Bike ${myBikeId}`;
    }
}

// 3. 훈련 상태 구독 (타이머, 세그먼트 정보)
let currentSegmentIndex = -1;
let previousTrainingState = null; // 이전 훈련 상태 추적
let currentUserIdForSession = null; // 세션에 사용할 사용자 ID
let lastWorkoutId = null; // 마지막 워크아웃 ID
window.currentTrainingState = 'idle'; // 전역 훈련 상태 (마스코트 애니메이션용)

/**
 * Workout ID를 가져오는 헬퍼 함수 (비동기)
 * 개인훈련 대시보드: users/{userId}/workout 경로에서 읽기
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
    
    // 3순위: Firebase에서 users/{userId}/workout/workoutId에서 가져오기 (개인훈련용)
    try {
        // 현재 사용자 ID 가져오기
        const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
        const userId = currentUser?.id || currentUser?.uid;
        
        if (userId) {
            const snapshot = await db.ref(`users/${userId}/workout/workoutId`).once('value');
            const workoutId = snapshot.val();
            if (workoutId) {
                // 가져온 값 저장
                if (!window.currentWorkout) {
                    window.currentWorkout = {};
                }
                window.currentWorkout.id = workoutId;
                lastWorkoutId = workoutId;
                console.log('[Individual] workoutId loaded from users/' + userId + '/workout/workoutId:', workoutId);
                return workoutId;
            }
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
        // Firebase status 저장 (타이머에서 사용)
        window.individualFirebaseStatus = status;
        
        // 훈련 상태 변화 감지 및 세션 관리
        const currentState = status.state || 'idle';
        const previousState = window.currentTrainingState;
        window.currentTrainingState = currentState; // 전역 변수에 저장
        
        // 화면 잠금 방지 제어 (훈련 진행 중에만 활성화)
        if (typeof window.wakeLockControl !== 'undefined') {
            if (currentState === 'running' && previousState !== 'running') {
                // 훈련 시작: 화면 잠금 방지 활성화
                console.log('[개인 훈련] 훈련 시작 - 화면 잠금 방지 활성화');
                window.wakeLockControl.request();
            } else if ((currentState === 'idle' || currentState === 'paused' || currentState === 'ended') && previousState === 'running') {
                // 훈련 종료/일시정지: 화면 잠금 방지 해제
                console.log('[개인 훈련] 훈련 종료/일시정지 - 화면 잠금 방지 해제');
                window.wakeLockControl.release();
            }
        }
        
        // 훈련 시작 감지 (idle/paused -> running)
        if (previousTrainingState !== 'running' && currentState === 'running') {
            // 로컬 타이머 시작
            startIndividualTrainingTimer();
            
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
                    console.log('[Individual] 훈련 세션 시작:', { userId: currentUserIdForSession, workoutId: lastWorkoutId || window.currentWorkout?.id });
                } else if (!currentUserIdForSession) {
                    console.warn('[Individual] 사용자 ID가 없어 세션을 시작할 수 없습니다.');
                }
            });
        }
        
        // 훈련 일시정지 감지 (running -> paused)
        if (previousTrainingState === 'running' && currentState === 'paused') {
            // 로컬 타이머 일시정지
            stopIndividualTrainingTimer();
        }
        
        // 훈련 재개 감지 (paused -> running)
        if (previousTrainingState === 'paused' && currentState === 'running') {
            // 로컬 타이머 재개
            startIndividualTrainingTimer();
        }
        
        // 훈련 종료 감지 (running -> finished/stopped/idle 또는 모든 세그먼트 완료)
        if (previousTrainingState === 'running' && (currentState === 'finished' || currentState === 'stopped' || currentState === 'idle')) {
            // 로컬 타이머 정지
            stopIndividualTrainingTimer();
            // 또는 모든 세그먼트가 완료되었는지 확인
            const totalSegments = window.currentWorkout?.segments?.length || 0;
            const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
            const isAllSegmentsComplete = (status.segmentIndex !== undefined && status.segmentIndex >= lastSegmentIndex) || currentState === 'finished';
            
            if (isAllSegmentsComplete || currentState === 'finished' || currentState === 'stopped') {
                // elapsedTime을 전역 변수에 저장 (저장 시 사용)
                if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
                    window.lastElapsedTime = status.elapsedTime;
                    console.log('[Individual] 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
                }
                
                // Android 등에서 탭 백그라운드 시 Promise 미완료로 저장이 누락되는 문제 방지:
                // 저장이 완료될 때까지 await 후 결과 모달 표시 (저장 완료 전에 화면 전환되지 않도록)
                (async function individualSaveAndShowResult() {
                    if (typeof showToast === "function") {
                        showToast("훈련 결과 저장 중입니다...", "info");
                    }
                    console.log('[Individual] 🚀 결과 저장 시작 (저장 완료까지 대기)');
                    try {
                        var saveResult = await (window.saveTrainingResultAtEnd?.() || Promise.resolve(null));
                        console.log('[Individual] ✅ 저장 완료:', saveResult);
                        if (saveResult?.saveResult?.source === 'local') {
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 기기에 저장되었습니다 (서버 연결 불가)", "warning");
                            }
                        } else if (saveResult?.saveResult?.source === 'gas') {
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 서버에 저장되었습니다");
                            }
                        }
                        await (window.trainingResults?.initializeResultScreen?.() || Promise.resolve());
                    } catch (e) {
                        console.warn('[Individual] initializeResultScreen error', e);
                    }
                    try {
                        showTrainingResultModal(status);
                    } catch (err) {
                        console.error('[Individual] ❌ 훈련 결과 저장/초기화 실패:', err);
                        showTrainingResultModal(status);
                    }
                })();
            }
        }
        
        previousTrainingState = currentState;
        
        updateTimer(status);
        
        // 세그먼트 정보 표시
        currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
        
        // 세그먼트 변경 감지 (로컬 시간 추적 초기화)
        if (previousIndividualSegmentIndex !== currentSegmentIndex && currentSegmentIndex >= 0 && currentState === 'running') {
            individualSegmentStartTime = Date.now();
            console.log('[Individual] 세그먼트 변경:', previousIndividualSegmentIndex, '→', currentSegmentIndex);
        }
        previousIndividualSegmentIndex = currentSegmentIndex;
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
// 개인훈련 대시보드: users/{userId}/workout/workoutPlan 경로에서 읽기
(async () => {
    try {
        // 현재 사용자 ID 가져오기
        const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
        const userId = currentUser?.id || currentUser?.uid;
        
        if (userId) {
            const userWorkoutPlanRef = db.ref(`users/${userId}/workout/workoutPlan`);
            userWorkoutPlanRef.on('value', (snapshot) => {
                const segments = snapshot.val();
                if (segments && Array.isArray(segments) && segments.length > 0) {
                    // 워크아웃 객체 생성
                    if (!window.currentWorkout) {
                        window.currentWorkout = {};
                    }
                    window.currentWorkout.segments = segments;
                    console.log('[Individual] workoutPlan loaded from users/' + userId + '/workout/workoutPlan:', segments.length, 'segments');
                    
                    // 워크아웃 ID 가져오기 (Firebase에서 확인)
                    // workoutPlan이 업데이트될 때 workoutId도 함께 확인하여 저장
                    // 헬퍼 함수를 사용하여 workoutId 가져오기
                    (async () => {
                        try {
                            const workoutId = await getWorkoutId();
                            if (workoutId) {
                                console.log('[Individual] workoutPlan 업데이트 시 workoutId 확인:', workoutId);
                            } else {
                                // workoutId가 없어도 경고만 출력 (나중에 로드될 수 있음)
                                console.log('[Individual] workoutPlan은 있지만 workoutId를 아직 찾을 수 없습니다. (나중에 로드될 수 있음)');
                            }
                        } catch (error) {
                            console.warn('[Individual] workoutId 가져오기 실패:', error);
                        }
                    })();
                    
                    // 세그먼트 그래프 그리기
                    updateSegmentGraph(segments, currentSegmentIndex);
                    // TARGET 파워 업데이트 (워크아웃 정보 로드 시)
                    updateTargetPower();
                }
            });
        } else {
            console.warn('[Individual] 사용자 ID가 없어 users/{userId}/workout/workoutPlan을 구독할 수 없습니다.');
        }
    } catch (error) {
        console.error('[Individual] users/{userId}/workout/workoutPlan 구독 실패:', error);
    }
})();
});

// =========================================================
// UI 업데이트 함수들
// =========================================================

function updateDashboard(data) {
    // 1. 텍스트 업데이트
    // 파워값 가져오기 (다양한 필드명 지원)
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
    // 개인훈련 대시보드 화면 체크 (individual.html만 - 모바일은 독립적으로 구동)
    const individualScreen = document.getElementById('individualScreen');
    const isIndividualActive = individualScreen && 
        (individualScreen.classList.contains('active') || 
         window.getComputedStyle(individualScreen).display !== 'none');
    
    // 개인훈련 대시보드 화면이 아니면 실행하지 않음 (모바일 대시보드는 Firebase와 무관하게 독립 구동)
    if (!isIndividualActive) {
        return;
    }
    
    // individual.html의 main-timer 업데이트만 수행 (모바일은 독립적으로 구동)
    const timerEl = document.getElementById('main-timer');
    
    if (status.state === 'running') {
        // 방장이 계산해서 보내준 elapsedTime 사용 (가장 정확)
        const totalSeconds = status.elapsedTime || 0;
        const timeText = formatHMS(totalSeconds); // hh:mm:ss 형식
        
        // individual.html 타이머 업데이트만 수행 (모바일은 독립적으로 구동)
        if (timerEl) {
            timerEl.innerText = timeText;
            timerEl.style.color = '#00d4aa'; // 실행중 색상
        }
        
        // 경과시간을 전역 변수에 저장 (마스코트 위치 계산용)
        if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
            window.lastElapsedTime = status.elapsedTime;
        }
        
        // 세그먼트 그래프 업데이트 (마스코트 위치 업데이트) - individual.html만
        if (window.currentWorkout && window.currentWorkout.segments) {
            const currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    } else if (status.state === 'paused') {
        if (timerEl) {
            timerEl.style.color = '#ffaa00'; // 일시정지 색상
        }
    } else {
        if (timerEl) {
            timerEl.innerText = "00:00:00";
            timerEl.style.color = '#fff';
        }
        
        // 훈련이 종료되거나 시작 전이면 마스코트를 0 위치로 (individual.html만)
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

// [추가] 개인훈련 대시보드 전용 타이머 시작 함수
function startIndividualTrainingTimer() {
    // 기존 타이머가 있으면 정지
    if (individualTrainingTimerInterval) {
        clearInterval(individualTrainingTimerInterval);
        individualTrainingTimerInterval = null;
    }
    
    // 훈련 시작 시간 기록
    if (!individualTrainingStartTime) {
        individualTrainingStartTime = Date.now();
    }
    
    // 세그먼트 시작 시간 기록
    if (!individualSegmentStartTime && currentSegmentIndex >= 0) {
        individualSegmentStartTime = Date.now();
    }
    
    // 1초마다 UI 업데이트
    individualTrainingTimerInterval = setInterval(() => {
        // 개인훈련 대시보드 화면 체크
        const individualScreen = document.getElementById('individualScreen');
        const mobileScreen = document.getElementById('mobileDashboardScreen');
        const isIndividualActive = individualScreen && 
            (individualScreen.classList.contains('active') || 
             window.getComputedStyle(individualScreen).display !== 'none');
        const isMobileActive = mobileScreen && 
            (mobileScreen.classList.contains('active') || 
             window.getComputedStyle(mobileScreen).display !== 'none');
        
        // 개인훈련 대시보드 화면이 아니면 타이머 정지
        if (!isIndividualActive && !isMobileActive) {
            stopIndividualTrainingTimer();
            return;
        }
        
        // 훈련 중이 아니면 타이머 정지
        if (window.currentTrainingState !== 'running') {
            stopIndividualTrainingTimer();
            return;
        }
        
        // 로컬 경과 시간 계산
        if (individualTrainingStartTime) {
            const now = Date.now();
            individualLocalElapsedTime = Math.floor((now - individualTrainingStartTime) / 1000);
            
            // 모바일 대시보드: 로컬 시간 기반 세그먼트 자동 전환
            if (isMobileActive && window.currentWorkout && window.currentWorkout.segments) {
                updateSegmentIndexByLocalTime(individualLocalElapsedTime);
                // 모바일 대시보드 랩 카운트다운 업데이트
                updateMobileLapTimeDisplay(individualLocalElapsedTime);
            }
            
            // Firebase status가 없거나 오래된 경우 로컬 시간으로 UI 업데이트
            const firebaseStatus = window.individualFirebaseStatus || null;
            if (!firebaseStatus || !firebaseStatus.elapsedTime) {
                // 로컬 시간으로 UI 업데이트
                updateIndividualTimerDisplay(individualLocalElapsedTime);
                updateIndividualLapTimeDisplay(individualLocalElapsedTime);
            }
        }
    }, 1000); // 1초마다 실행
    
    console.log('[Individual] 로컬 타이머 시작');
}

// [추가] 개인훈련 대시보드 전용 타이머 정지 함수
function stopIndividualTrainingTimer() {
    if (individualTrainingTimerInterval) {
        clearInterval(individualTrainingTimerInterval);
        individualTrainingTimerInterval = null;
    }
    individualTrainingStartTime = null;
    individualSegmentStartTime = null;
    individualLocalElapsedTime = 0;
    previousIndividualSegmentIndex = -1;
    console.log('[Individual] 로컬 타이머 정지');
}

// [추가] 개인훈련 대시보드 전용 타이머 디스플레이 업데이트 (로컬 시간 사용)
function updateIndividualTimerDisplay(elapsedSeconds) {
    // individual.html의 main-timer 업데이트만 수행 (모바일은 독립적으로 구동)
    const timerEl = document.getElementById('main-timer');
    
    const timeText = formatHMS(elapsedSeconds);
    
    if (timerEl) {
        timerEl.innerText = timeText;
        timerEl.style.color = '#00d4aa';
    }
    
    // 경과시간을 전역 변수에 저장 (마스코트 위치 계산용)
    window.lastElapsedTime = elapsedSeconds;
}

// [추가] 로컬 시간 기반 세그먼트 인덱스 자동 전환 (모바일 대시보드 전용)
function updateSegmentIndexByLocalTime(elapsedSeconds) {
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        return;
    }
    
    // 경과 시간 기반으로 현재 세그먼트 인덱스 계산
    let accumulatedTime = 0;
    let newSegmentIndex = -1;
    
    for (let i = 0; i < window.currentWorkout.segments.length; i++) {
        const seg = window.currentWorkout.segments[i];
        const segDuration = seg.duration_sec || seg.duration || 0;
        const segmentEndTime = accumulatedTime + segDuration;
        
        if (elapsedSeconds >= accumulatedTime && elapsedSeconds < segmentEndTime) {
            newSegmentIndex = i;
            break;
        }
        
        accumulatedTime = segmentEndTime;
    }
    
    // 마지막 세그먼트를 넘어간 경우
    if (newSegmentIndex === -1 && elapsedSeconds >= accumulatedTime) {
        newSegmentIndex = window.currentWorkout.segments.length - 1;
    }
    
    // 세그먼트 변경 감지 및 처리
    if (newSegmentIndex !== currentSegmentIndex && newSegmentIndex >= 0) {
        const oldIndex = currentSegmentIndex;
        currentSegmentIndex = newSegmentIndex;
        previousIndividualSegmentIndex = oldIndex; // 이전 인덱스 업데이트
        
        // 세그먼트 시작 시간 업데이트
        individualSegmentStartTime = Date.now();
        
        console.log('[Individual] 로컬 시간 기반 세그먼트 전환:', oldIndex, '→', currentSegmentIndex, '(경과 시간:', elapsedSeconds, '초)');
        
        // 세그먼트 변경 시 UI 업데이트
        updateTargetPower();
        updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        
        // 세그먼트 정보 업데이트
        const segmentInfoEl = document.getElementById('segment-info');
        if (segmentInfoEl) {
            const currentSegment = getCurrentSegment();
            if (currentSegment) {
                const segmentName = currentSegment.name || '';
                const targetText = formatSegmentInfo(
                    currentSegment.target_type,
                    currentSegment.target_value
                );
                const segmentText = segmentName 
                    ? `${segmentName}(${targetText})`
                    : targetText;
                segmentInfoEl.innerText = segmentText;
            }
        }
        
        // 랩 카운트다운 표시 (5초 카운트다운)
        const seg = window.currentWorkout.segments[currentSegmentIndex];
        if (seg) {
            const segDuration = seg.duration_sec || seg.duration || 0;
            // 세그먼트 시작 시 5초 카운트다운 표시
            if (typeof showSegmentCountdown === 'function') {
                showSegmentCountdown(5);
                setTimeout(() => {
                    if (typeof stopSegmentCountdown === 'function') {
                        stopSegmentCountdown();
                    }
                }, 1000);
            }
        }
    }
}

// [추가] 모바일 대시보드 전용 랩타임 디스플레이 업데이트 (로컬 시간 사용)
function updateMobileLapTimeDisplay(elapsedSeconds) {
    // 모바일 대시보드 화면 체크
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    const isMobileActive = mobileScreen && 
        (mobileScreen.classList.contains('active') || 
         window.getComputedStyle(mobileScreen).display !== 'none');
    
    if (!isMobileActive) {
        return;
    }
    
    // 세그먼트 남은 시간 계산
    let countdownValue = null;
    
    if (window.currentWorkout && window.currentWorkout.segments && currentSegmentIndex >= 0) {
        const seg = window.currentWorkout.segments[currentSegmentIndex];
        
        if (seg) {
            const segDuration = seg.duration_sec || seg.duration || 0;
            
            // 로컬 세그먼트 경과 시간 계산
            if (individualSegmentStartTime) {
                const now = Date.now();
                const segElapsed = Math.floor((now - individualSegmentStartTime) / 1000);
                countdownValue = Math.max(0, segDuration - segElapsed);
            } else {
                // 전체 경과 시간에서 이전 세그먼트들의 시간을 빼서 계산
                let prevSegmentsTime = 0;
                for (let i = 0; i < currentSegmentIndex; i++) {
                    const prevSeg = window.currentWorkout.segments[i];
                    if (prevSeg) {
                        prevSegmentsTime += (prevSeg.duration_sec || prevSeg.duration || 0);
                    }
                }
                const segElapsed = Math.max(0, elapsedSeconds - prevSegmentsTime);
                countdownValue = Math.max(0, segDuration - segElapsed);
            }
        }
    }
    
    // 모바일 대시보드 세그먼트 정보 업데이트 (랩 카운트다운 표시)
    const mobileSegmentInfoEl = document.getElementById('mobile-segment-info');
    if (mobileSegmentInfoEl) {
        if (countdownValue !== null && countdownValue >= 0) {
            const currentSegment = getCurrentSegment();
            if (currentSegment) {
                const segmentName = currentSegment.name || '';
                const targetText = formatSegmentInfo(
                    currentSegment.target_type,
                    currentSegment.target_value
                );
                const timeText = formatTime(countdownValue);
                const segmentText = segmentName 
                    ? `${segmentName}(${targetText}) - ${timeText}`
                    : `${targetText} - ${timeText}`;
                mobileSegmentInfoEl.innerText = segmentText;
            } else {
                mobileSegmentInfoEl.innerText = countdownValue > 0 ? formatTime(countdownValue) : '준비 중';
            }
        } else {
            mobileSegmentInfoEl.innerText = '준비 중';
        }
    }
}

// [추가] 개인훈련 대시보드 전용 랩타임 디스플레이 업데이트 (로컬 시간 사용)
function updateIndividualLapTimeDisplay(elapsedSeconds) {
    // 개인훈련 대시보드 화면 체크 (individual.html만 - 모바일은 독립적으로 구동)
    const individualScreen = document.getElementById('individualScreen');
    const isIndividualActive = individualScreen && 
        (individualScreen.classList.contains('active') || 
         window.getComputedStyle(individualScreen).display !== 'none');
    
    if (!isIndividualActive) {
        return;
    }
    
    // individual.html의 ui-lap-time 업데이트만 수행 (모바일은 독립적으로 구동)
    const lapTimeEl = document.getElementById('ui-lap-time');
    
    if (!lapTimeEl) return;
    
    // 세그먼트 남은 시간 계산
    let countdownValue = null;
    
    if (window.currentWorkout && window.currentWorkout.segments && currentSegmentIndex >= 0) {
        const seg = window.currentWorkout.segments[currentSegmentIndex];
        
        if (seg) {
            const segDuration = seg.duration_sec || seg.duration || 0;
            
            // 로컬 세그먼트 경과 시간 계산
            if (individualSegmentStartTime) {
                const now = Date.now();
                const segElapsed = Math.floor((now - individualSegmentStartTime) / 1000);
                countdownValue = Math.max(0, segDuration - segElapsed);
            } else {
                // 전체 경과 시간에서 이전 세그먼트들의 시간을 빼서 계산
                let prevSegmentsTime = 0;
                for (let i = 0; i < currentSegmentIndex; i++) {
                    const prevSeg = window.currentWorkout.segments[i];
                    if (prevSeg) {
                        prevSegmentsTime += (prevSeg.duration_sec || prevSeg.duration || 0);
                    }
                }
                const segElapsed = Math.max(0, elapsedSeconds - prevSegmentsTime);
                countdownValue = Math.max(0, segDuration - segElapsed);
            }
        }
    }
    
    // 카운트다운 값 표시 (individual.html만 - 모바일은 독립적으로 구동)
    if (countdownValue !== null && countdownValue >= 0) {
        const timeText = formatTime(countdownValue);
        const color = countdownValue <= 10 ? '#ff4444' : '#00d4aa';
        
        if (lapTimeEl) {
            lapTimeEl.textContent = timeText;
            lapTimeEl.setAttribute('fill', color);
        }
    } else {
        if (lapTimeEl) {
            lapTimeEl.textContent = '00:00';
            lapTimeEl.setAttribute('fill', '#00d4aa');
        }
    }
}

// Firebase status 저장용 전역 변수
window.individualFirebaseStatus = null;

// 5초 카운트다운 상태 관리
let segmentCountdownActive = false;
let segmentCountdownTimer = null;
let lastCountdownValue = null;
let startCountdownActive = false; // 시작 카운트다운 활성 상태
let goDisplayTime = null; // GO!! 표시 시작 시간

// Beep 사운드 (Web Audio)
let __beepCtx = null;

// 오디오 컨텍스트 초기화 함수
async function ensureBeepContext() {
    try {
        if (!window.AudioContext && !window.webkitAudioContext) {
            console.warn('[개인 훈련] Web Audio API not supported');
            return false;
        }

        if (!__beepCtx) {
            __beepCtx = new (window.AudioContext || window.webkitAudioContext)();
            console.log('[개인 훈련] New audio context created');
        }
        
        if (__beepCtx.state === "suspended") {
            await __beepCtx.resume();
            console.log('[개인 훈련] Audio context resumed');
        }
        
        return __beepCtx.state === "running";
        
    } catch (error) {
        console.error('[개인 훈련] Audio context initialization failed:', error);
        __beepCtx = null;
        return false;
    }
}

// 벨소리 재생 함수
async function playBeep(freq = 880, durationMs = 120, volume = 0.2, type = "sine") {
    try {
        console.log(`[개인 훈련] Beep 재생 시도: ${freq}Hz, ${durationMs}ms, ${volume} 볼륨, ${type} 타입`);
        
        const contextReady = await ensureBeepContext();
        if (!contextReady) {
            console.warn('[개인 훈련] Audio context not available for beep');
            return;
        }

        const osc = __beepCtx.createOscillator();
        const gain = __beepCtx.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = volume;

        osc.connect(gain);
        gain.connect(__beepCtx.destination);

        const now = __beepCtx.currentTime;
        
        // 볼륨 페이드 아웃 설정
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

        // 오실레이터 시작 및 정지
        osc.start(now);
        osc.stop(now + durationMs / 1000);
        
        console.log(`[개인 훈련] Beep 재생 성공: ${freq}Hz`);
        
        // Promise로 재생 완료 시점 반환
        return new Promise(resolve => {
            setTimeout(resolve, durationMs);
        });
        
    } catch (error) {
        console.error('[개인 훈련] Beep 재생 실패:', error);
    }
}

// 랩카운트다운 업데이트 함수 (훈련방의 세그먼트 시간 경과값 표시)
function updateLapTime(status) {
    // 개인훈련 대시보드 화면 체크 (individual.html만 - 모바일은 독립적으로 구동)
    const individualScreen = document.getElementById('individualScreen');
    const isIndividualActive = individualScreen && 
        (individualScreen.classList.contains('active') || 
         window.getComputedStyle(individualScreen).display !== 'none');
    
    // 개인훈련 대시보드 화면이 아니면 실행하지 않음 (모바일 대시보드는 Firebase와 무관하게 독립 구동)
    if (!isIndividualActive) {
        return;
    }
    
    // individual.html의 ui-lap-time 업데이트만 수행 (모바일은 독립적으로 구동)
    const lapTimeEl = document.getElementById('ui-lap-time');
    
    // 없으면 종료
    if (!lapTimeEl) return;
    
    // 훈련방의 세그먼트 남은 시간 값 사용 (5,4,3,2,1,0 카운트다운과는 별개)
    let countdownValue = null;
    
    // 훈련 중일 때: 세그먼트 남은 시간 우선 사용
    if (status.state === 'running') {
        // 1순위: segmentRemainingSec (훈련방에서 계산된 세그먼트 남은 시간)
        if (status.segmentRemainingSec !== undefined && status.segmentRemainingSec !== null && Number.isFinite(status.segmentRemainingSec)) {
            countdownValue = Math.max(0, Math.floor(status.segmentRemainingSec));
        }
        // 2순위: segmentRemainingTime (다른 필드명)
        else if (status.segmentRemainingTime !== undefined && status.segmentRemainingTime !== null && Number.isFinite(status.segmentRemainingTime)) {
            countdownValue = Math.max(0, Math.floor(status.segmentRemainingTime));
        }
        // 3순위: 세그먼트 정보로 직접 계산
        else if (window.currentWorkout && window.currentWorkout.segments) {
            const segIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            const seg = window.currentWorkout.segments[segIndex];
            
            if (seg) {
                const segDuration = seg.duration_sec || seg.duration || 0;
                
                // segmentElapsedSec가 있으면 사용
                if (status.segmentElapsedSec !== undefined && Number.isFinite(status.segmentElapsedSec)) {
                    countdownValue = Math.max(0, segDuration - Math.floor(status.segmentElapsedSec));
                }
                // segmentElapsedTime이 있으면 사용
                else if (status.segmentElapsedTime !== undefined && Number.isFinite(status.segmentElapsedTime)) {
                    countdownValue = Math.max(0, segDuration - Math.floor(status.segmentElapsedTime));
                }
                // elapsedTime과 segmentStartTime으로 계산
                else if (status.elapsedTime !== undefined && status.segmentStartTime !== undefined) {
                    const segElapsed = Math.max(0, status.elapsedTime - status.segmentStartTime);
                    countdownValue = Math.max(0, segDuration - segElapsed);
                }
                // 전체 경과 시간에서 이전 세그먼트들의 시간을 빼서 계산
                else if (status.elapsedTime !== undefined) {
                    let prevSegmentsTime = 0;
                    for (let i = 0; i < segIndex; i++) {
                        const prevSeg = window.currentWorkout.segments[i];
                        if (prevSeg) {
                            prevSegmentsTime += (prevSeg.duration_sec || prevSeg.duration || 0);
                        }
                    }
                    const segElapsed = Math.max(0, status.elapsedTime - prevSegmentsTime);
                    countdownValue = Math.max(0, segDuration - segElapsed);
                }
            }
        }
    }
    // 훈련 시작 전: countdownRemainingSec (전체 훈련 시작 카운트다운)
    else if (status.countdownRemainingSec !== undefined && status.countdownRemainingSec !== null && Number.isFinite(status.countdownRemainingSec)) {
        countdownValue = Math.max(0, Math.floor(status.countdownRemainingSec));
    }
    
    // 세그먼트 카운트다운 시간 로그 출력
    if (countdownValue !== null && countdownValue >= 0) {
        console.log('[updateLapTime] 세그먼트 카운트다운 시간:', countdownValue, '초');
    }
    
    // 카운트다운 값 표시 (individual.html만 - 모바일은 독립적으로 구동)
    if (lapTimeEl) {
        if (countdownValue !== null && countdownValue >= 0) {
            lapTimeEl.textContent = formatTime(countdownValue);
            // 10초 이하면 빨간색, 그 외는 청록색
            lapTimeEl.setAttribute('fill', countdownValue <= 10 ? '#ff4444' : '#00d4aa');
        } else {
            lapTimeEl.textContent = '00:00';
            lapTimeEl.setAttribute('fill', '#00d4aa');
        }
    }
    
    // 5초 카운트다운 오버레이 처리
    handleSegmentCountdown(countdownValue, status);
}

// 5초 카운트다운 오버레이 처리 함수
function handleSegmentCountdown(countdownValue, status) {
    // 시작 카운트다운인지 세그먼트 카운트다운인지 구분
    const isStartCountdown = status.state === 'countdown' || 
                             (status.countdownRemainingSec !== undefined && 
                              status.countdownRemainingSec !== null && 
                              status.countdownRemainingSec >= 0 && 
                              status.state !== 'running');
    
    // 시작 카운트다운 처리 (5, 4, 3, 2, 1, GO!!)
    if (isStartCountdown && countdownValue !== null && countdownValue >= 0) {
        startCountdownActive = true; // 시작 카운트다운 활성화
        
        // 5초 이상이면 오버레이 표시하지 않음 (Firebase 동기화 지연 고려)
        if (countdownValue <= 5) {
            // 이전 값과 다르거나 카운트다운이 시작되지 않은 경우
            if (lastCountdownValue !== countdownValue || !segmentCountdownActive) {
                lastCountdownValue = countdownValue;
                // 0일 때는 "GO!!" 표시
                const displayValue = countdownValue === 0 ? 'GO!!' : countdownValue;
                showSegmentCountdown(displayValue);
                
                // GO!! 표시 시 시간 기록
                if (displayValue === 'GO!!') {
                    goDisplayTime = Date.now();
                }
            }
        }
        return; // 시작 카운트다운 중에는 세그먼트 카운트다운 로직 실행하지 않음
    }
    
    // GO!! 표시 후 1초 이내에는 오버레이 유지 (시작 카운트다운 종료 후 보호)
    if (goDisplayTime !== null) {
        const elapsedSinceGo = Date.now() - goDisplayTime;
        if (elapsedSinceGo < 1000) { // GO!! 표시 후 1초 이내
            // 오버레이가 표시되어 있는지 확인하고 유지
            const overlay = document.getElementById('countdownOverlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                return; // 오버레이 유지
            }
        } else {
            // 1초 경과 후 GO!! 표시 시간 초기화
            goDisplayTime = null;
            startCountdownActive = false;
        }
    }
    
    // 시작 카운트다운이 활성화되어 있으면 세그먼트 카운트다운 로직 실행하지 않음
    if (startCountdownActive) {
        return;
    }
    
    // 세그먼트 카운트다운 처리 (기존 로직)
    // countdownValue가 유효하지 않거나 5초보다 크면 오버레이 숨김
    if (countdownValue === null || countdownValue > 5) {
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
        return;
    }
    
    // 5초 이하일 때만 오버레이 표시
    if (countdownValue <= 5 && countdownValue >= 0) {
        // 이전 값과 다르거나 카운트다운이 시작되지 않은 경우
        if (lastCountdownValue !== countdownValue || !segmentCountdownActive) {
            lastCountdownValue = countdownValue;
            showSegmentCountdown(countdownValue);
        }
    } else if (countdownValue < 0) {
        // 0 미만이면 오버레이 숨김 (시작 카운트다운이 아닐 때만)
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
    }
}

// 세그먼트 카운트다운 오버레이 표시
function showSegmentCountdown(value) {
    const overlay = document.getElementById('countdownOverlay');
    const numEl = document.getElementById('countdownNumber');
    
    if (!overlay || !numEl) return;
    
    // 오버레이 표시 (강제로 표시)
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
    
    // 숫자 또는 "GO!!" 업데이트
    numEl.textContent = String(value);
    
    // "GO!!"일 때 스타일 조정
    if (value === 'GO!!') {
        numEl.style.fontSize = '150px'; // GO!!는 조금 작게
        numEl.style.color = '#00d4aa'; // 민트색
        goDisplayTime = Date.now(); // GO!! 표시 시간 기록
    } else {
        numEl.style.fontSize = '200px'; // 기본 크기
        numEl.style.color = '#fff'; // 흰색
    }
    
    // 애니메이션 효과를 위해 클래스 재적용 (강제 리플로우)
    numEl.style.animation = 'none';
    setTimeout(() => {
        numEl.style.animation = '';
    }, 10);
    
    // 벨소리 재생
    if (value === 'GO!!' || value === 0) {
        // GO!! 또는 0일 때: 강조 벨소리 (높은 주파수, 긴 지속시간)
        playBeep(1500, 700, 0.35, "square").catch(err => {
            console.warn('[개인 훈련] 벨소리 재생 실패:', err);
        });
    } else if (typeof value === 'number' && value > 0 && value <= 5) {
        // 1~5초일 때: 일반 벨소리
        playBeep(880, 120, 0.25, "sine").catch(err => {
            console.warn('[개인 훈련] 벨소리 재생 실패:', err);
        });
    }
    
    segmentCountdownActive = true;
    
    // 0 또는 "GO!!"일 때 1초 후 오버레이 숨김 (GO!!는 더 길게 표시)
    if (value === 0 || value === 'GO!!') {
        // 기존 타이머가 있으면 제거
        if (segmentCountdownTimer) {
            clearTimeout(segmentCountdownTimer);
        }
        segmentCountdownTimer = setTimeout(() => {
            // GO!! 표시 후 1초가 지났는지 확인
            if (goDisplayTime !== null) {
                const elapsedSinceGo = Date.now() - goDisplayTime;
                if (elapsedSinceGo >= 1000) {
                    stopSegmentCountdown();
                    goDisplayTime = null;
                    startCountdownActive = false;
                } else {
                    // 아직 1초가 안 지났으면 추가 대기
                    const remainingTime = 1000 - elapsedSinceGo;
                    segmentCountdownTimer = setTimeout(() => {
                        stopSegmentCountdown();
                        goDisplayTime = null;
                        startCountdownActive = false;
                    }, remainingTime);
                }
            } else {
                stopSegmentCountdown();
            }
        }, 1000); // 1초로 증가
    }
}

// 세그먼트 카운트다운 오버레이 숨김
function stopSegmentCountdown() {
    // 시작 카운트다운 중이거나 GO!! 표시 후 1초가 안 지났으면 숨기지 않음
    if (startCountdownActive || (goDisplayTime !== null && (Date.now() - goDisplayTime) < 1000)) {
        return;
    }
    
    const overlay = document.getElementById('countdownOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
    }
    
    if (segmentCountdownTimer) {
        clearTimeout(segmentCountdownTimer);
        segmentCountdownTimer = null;
    }
    
    segmentCountdownActive = false;
    lastCountdownValue = null;
    startCountdownActive = false;
    goDisplayTime = null;
}

// TARGET 파워 업데이트 함수 (Firebase에서 계산된 값 우선 사용)
function updateTargetPower() {
    const targetPowerEl = document.getElementById('ui-target-power');
    if (!targetPowerEl) {
        console.warn('[updateTargetPower] ui-target-power 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 1순위: Firebase에서 받은 targetPower 값 사용 (서버에서 계산된 값)
    if (firebaseTargetPower !== null && !isNaN(firebaseTargetPower) && firebaseTargetPower >= 0) {
        // 강도 조절 비율 적용 (개인 훈련 대시보드 슬라이드 바)
        const adjustedTargetPower = Math.round(firebaseTargetPower * individualIntensityAdjustment);
        console.log('[updateTargetPower] Firebase targetPower 값 사용:', firebaseTargetPower, 'W');
        console.log('[updateTargetPower] 강도 조절 적용:', individualIntensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
        
        // TARGET 라벨 업데이트 로직 (Firebase 값 사용 시)
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        const seg = getCurrentSegment();
        const targetType = seg?.target_type || 'ftp_pct';
        
        // ftp_pctz 타입인 경우 상한값 저장
        if (targetType === 'ftp_pctz' && seg?.target_value) {
            const targetValue = seg.target_value;
            let minPercent = 60;
            let maxPercent = 75;
            
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                }
            } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
                // 기존 형식(쉼표)도 지원 (하위 호환성)
                const parts = targetValue.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                }
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                minPercent = Number(targetValue[0]) || 60;
                maxPercent = Number(targetValue[1]) || 75;
            }
            
            const ftp = userFTP || window.currentUser?.ftp || 200;
            window.currentSegmentMaxPower = Math.round(ftp * (maxPercent / 100));
            window.currentSegmentMinPower = Math.round(ftp * (minPercent / 100));
        } else {
            window.currentSegmentMaxPower = null;
            window.currentSegmentMinPower = null;
        }
        
        if (targetType === 'dual') {
            // dual 타입: TARGET 라벨에 RPM 값과 단위를 1줄에 표시, 숫자는 빨강색, 단위는 그레이
            const targetValue = seg?.target_value || seg?.target || '0';
            let targetRpm = 0;
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                targetRpm = Number(parts[1]) || 0;
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                targetRpm = Number(targetValue[1]) || 0;
            }
            
            if (targetRpm > 0 && targetLabelEl) {
                // 기존 내용 삭제
                targetLabelEl.textContent = '';
                targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
                targetLabelEl.setAttribute('font-size', '10'); // 속도계 눈금 폰트 크기와 동일
                targetLabelEl.setAttribute('y', '90'); // 위치 동일하게 유지
                
                // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
                const rpmNumber = Math.round(targetRpm);
                const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
                tspanNumber.textContent = rpmNumber.toString();
                targetLabelEl.appendChild(tspanNumber);
                
                const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanUnit.setAttribute('fill', '#888'); // 그레이
                tspanUnit.textContent = ' RPM';
                targetLabelEl.appendChild(tspanUnit);
                
                // RPM 단위 요소는 숨김 처리
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
            } else {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'TARGET';
                    targetLabelEl.setAttribute('fill', '#888');
                    targetLabelEl.setAttribute('font-size', '6'); // 원래 폰트 크기로 복원
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        } else if (targetType === 'cadence_rpm') {
            // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
            const targetValue = seg?.target_value || seg?.target || '0';
            const targetRpm = Number(targetValue) || 0;
            
            if (targetRpm > 0) {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'CADENCE';
                    targetLabelEl.setAttribute('fill', '#888');
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
                targetPowerEl.textContent = Math.round(targetRpm).toString();
                targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
            } else {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'TARGET';
                    targetLabelEl.setAttribute('fill', '#888');
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
                targetPowerEl.textContent = '0';
                targetPowerEl.setAttribute('fill', '#ff8c00');
            }
        } else if (targetType === 'ftp_pctz') {
            // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        } else {
            // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        }
        
        // 목표 파워 원호 업데이트
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // 2순위: 세그먼트 데이터로 계산 (Firebase targetPower가 없을 때만)
    // 워크아웃 데이터 확인
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        // 경고 메시지는 디버깅 모드에서만 출력 (조용히 처리)
        if (window.DEBUG_MODE) {
            console.warn('[updateTargetPower] 워크아웃 데이터가 없습니다.');
        }
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
        // 목표 파워 원호 숨김
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // 현재 세그먼트 정보 가져오기 (헬퍼 함수 사용)
    const seg = getCurrentSegment();
    if (!seg) {
        console.warn('[updateTargetPower] 현재 세그먼트 정보를 가져올 수 없습니다.');
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
        // 목표 파워 원호 숨김
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // FTP 값 사용 (Firebase에서 가져온 사용자 FTP 값)
    const ftp = userFTP;
    
    // 세그먼트 목표 파워 계산
    let targetPower = 0;
    
    // target_type에 따라 계산
    const targetType = seg.target_type || 'ftp_pct';
    const targetValue = seg.target_value;
    
    console.log('[updateTargetPower] 세그먼트 데이터로 계산 (Firebase targetPower 없음)');
    console.log('[updateTargetPower] 세그먼트 인덱스:', currentSegmentIndex);
    console.log('[updateTargetPower] target_type:', targetType, 'target_value:', targetValue, '타입:', typeof targetValue);
    console.log('[updateTargetPower] 사용자 FTP 값:', ftp);
    
    if (targetType === 'ftp_pct') {
        const ftpPercent = Number(targetValue) || 100;
        targetPower = Math.round(ftp * (ftpPercent / 100));
        console.log('[updateTargetPower] ftp_pct 계산: FTP', ftp, '*', ftpPercent, '% =', targetPower);
    } else if (targetType === 'dual') {
        // dual 타입: "100/120" 형식 파싱
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 1) {
                const ftpPercent = Number(parts[0]) || 100;
                targetPower = Math.round(ftp * (ftpPercent / 100));
            }
        } else if (Array.isArray(targetValue) && targetValue.length > 0) {
            const ftpPercent = Number(targetValue[0]) || 100;
            targetPower = Math.round(ftp * (ftpPercent / 100));
        } else {
            // 숫자로 저장된 경우 처리
            const numValue = Number(targetValue);
            if (numValue > 1000 && numValue < 1000000) {
                const str = String(numValue);
                if (str.length >= 4) {
                    const ftpPart = str.slice(0, -3);
                    const ftpPercent = Number(ftpPart) || 100;
                    targetPower = Math.round(ftp * (ftpPercent / 100));
                }
            } else {
                const ftpPercent = numValue <= 1000 ? numValue : 100;
                targetPower = Math.round(ftp * (ftpPercent / 100));
            }
        }
    } else if (targetType === 'cadence_rpm') {
        // RPM만 있는 경우 파워는 0
        targetPower = 0;
    } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: "56/75" 형식 (하한, 상한)
        let minPercent = 60;
        let maxPercent = 75;
        
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            } else {
                minPercent = Number(parts[0]) || 60;
                maxPercent = 75;
            }
        } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
            // 기존 형식(쉼표)도 지원 (하위 호환성)
            const parts = targetValue.split(',').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            } else {
                minPercent = Number(parts[0]) || 60;
                maxPercent = 75;
            }
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            minPercent = Number(targetValue[0]) || 60;
            maxPercent = Number(targetValue[1]) || 75;
        }
        
        // 하한값을 목표 파워값으로 사용
        targetPower = Math.round(ftp * (minPercent / 100));
        console.log('[updateTargetPower] ftp_pctz 계산: FTP', ftp, '* 하한', minPercent, '% =', targetPower, 'W (상한:', maxPercent, '%)');
        
        // 상한값을 전역 변수에 저장 (updateTargetPowerArc에서 사용)
        window.currentSegmentMaxPower = Math.round(ftp * (maxPercent / 100));
        window.currentSegmentMinPower = targetPower;
    }
    
    // 강도 조절 비율 적용 (개인 훈련 대시보드 슬라이드 바)
    const adjustedTargetPower = Math.round(targetPower * individualIntensityAdjustment);
    
    console.log('[updateTargetPower] 최종 계산된 목표 파워:', targetPower, 'W');
    console.log('[updateTargetPower] 강도 조절 적용:', individualIntensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
    console.log('[updateTargetPower] 계산 상세: FTP =', ftp, ', target_type =', targetType, ', target_value =', targetValue);
    
    // TARGET 라벨 업데이트 로직
    const targetLabelEl = document.getElementById('ui-target-label');
    const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
    
    if (targetType === 'dual') {
        // dual 타입: TARGET 라벨에 RPM 값과 단위를 1줄에 표시, 숫자는 빨강색, 단위는 그레이
        let targetRpm = 0;
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            targetRpm = Number(parts[1]) || 0;
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            targetRpm = Number(targetValue[1]) || 0;
        }
        
        if (targetRpm > 0 && targetLabelEl) {
            // 기존 내용 삭제
            targetLabelEl.textContent = '';
            targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
            targetLabelEl.setAttribute('font-size', '10'); // 속도계 눈금 폰트 크기와 동일
            targetLabelEl.setAttribute('y', '90'); // 위치 동일하게 유지
            
            // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
            const rpmNumber = Math.round(targetRpm);
            const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
            tspanNumber.textContent = rpmNumber.toString();
            targetLabelEl.appendChild(tspanNumber);
            
            const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspanUnit.setAttribute('fill', '#888'); // 그레이
            tspanUnit.textContent = ' RPM';
            targetLabelEl.appendChild(tspanUnit);
            
            // RPM 단위 요소는 숨김 처리
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
        } else if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
            targetLabelEl.setAttribute('font-size', '6'); // 원래 폰트 크기로 복원
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
        }
        
        // targetPowerEl은 파워 값 표시 (dual이므로 파워도 있음)
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    } else if (targetType === 'cadence_rpm') {
        // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
        const targetRpm = Number(targetValue) || 0;
        
        if (targetRpm > 0) {
            // TARGET 라벨을 CADENCE로 변경
            if (targetLabelEl) {
                targetLabelEl.textContent = 'CADENCE';
                targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
            }
            // RPM 단위 숨김
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            // 목표 파워값 자리에 RPM 값 표시
            targetPowerEl.textContent = Math.round(targetRpm).toString();
            targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
        } else {
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = '0';
            targetPowerEl.setAttribute('fill', '#ff8c00');
        }
    } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    } else {
        // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    }
    
    // 목표 파워 원호 업데이트 (애니메이션 루프에서도 호출되지만 여기서도 즉시 업데이트)
    if (typeof updateTargetPowerArc === 'function') {
        updateTargetPowerArc();
    }
}

/**
 * 세그먼트 정보를 표시 형식으로 변환 (예: FTP 60%, RPM 90 등)
 */
function formatSegmentInfo(targetType, targetValue) {
    if (!targetType || targetValue === undefined || targetValue === null) {
        return '준비 중';
    }
    
    // target_type에 따라 표시 형식 결정
    if (targetType === 'ftp_pct') {
        // FTP 퍼센트: "FTP 60%"
        const percent = Number(targetValue) || 100;
        return `FTP ${percent}%`;
    } else if (targetType === 'dual') {
        // Dual 타입: "100/120" 형식에서 앞의 값 사용
        let ftpPercent = 100;
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 1) {
                ftpPercent = Number(parts[0].replace('%', '')) || 100;
            }
        } else if (Array.isArray(targetValue) && targetValue.length > 0) {
            ftpPercent = Number(targetValue[0]) || 100;
        } else if (typeof targetValue === 'number') {
            // 숫자로 저장된 경우 처리
            const numValue = targetValue;
            if (numValue > 1000 && numValue < 1000000) {
                const str = String(numValue);
                if (str.length >= 4) {
                    const ftpPart = str.slice(0, -3);
                    ftpPercent = Number(ftpPart) || 100;
                }
            } else {
                ftpPercent = numValue <= 1000 ? numValue : 100;
            }
        }
        return `FTP ${ftpPercent}%`;
    } else if (targetType === 'cadence_rpm') {
        // RPM: "RPM 90"
        const rpm = Number(targetValue) || 0;
        return `RPM ${rpm}`;
    } else {
        // 알 수 없는 타입: 기본값 표시
        const segIdx = (currentSegmentIndex >= 0 ? currentSegmentIndex + 1 : 1);
        return `Segment ${segIdx}`;
    }
}

/**
 * 현재 진행 중인 세그먼트 정보 가져오기
 * @returns {Object|null} 현재 세그먼트 객체 또는 null
 */
function getCurrentSegment() {
    // 세그먼트 인덱스 확인
    if (currentSegmentIndex < 0) {
        console.log('[getCurrentSegment] 현재 세그먼트 인덱스가 유효하지 않음:', currentSegmentIndex);
        return null;
    }
    
    // 워크아웃 데이터 확인
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        console.log('[getCurrentSegment] 워크아웃 데이터가 없음');
        return null;
    }
    
    // 세그먼트 인덱스 범위 확인
    if (currentSegmentIndex >= window.currentWorkout.segments.length) {
        console.warn('[getCurrentSegment] 세그먼트 인덱스가 범위를 벗어남:', currentSegmentIndex, '세그먼트 개수:', window.currentWorkout.segments.length);
        return null;
    }
    
    const segment = window.currentWorkout.segments[currentSegmentIndex];
    if (!segment) {
        console.warn('[getCurrentSegment] 세그먼트 데이터가 없음. 인덱스:', currentSegmentIndex);
        return null;
    }
    
    return segment;
}

/**
 * 현재 세그먼트 정보를 로그로 출력 (디버깅용)
 */
function logCurrentSegmentInfo() {
    const segment = getCurrentSegment();
    if (segment) {
        console.log('[현재 세그먼트 정보]', {
            index: currentSegmentIndex,
            target_type: segment.target_type,
            target_value: segment.target_value,
            duration_sec: segment.duration_sec || segment.duration,
            segment_type: segment.segment_type,
            name: segment.name
        });
    } else {
        console.log('[현재 세그먼트 정보] 세그먼트를 찾을 수 없음');
    }
}

// 세그먼트 그래프 업데이트 함수
let mascotAnimationInterval = null; // 마스코트 애니메이션 인터벌

function updateSegmentGraph(segments, currentSegmentIndex = -1, canvasId = 'individualSegmentGraph') {
    if (!segments || segments.length === 0) return;
    
    // workoutManager.js의 drawSegmentGraph 함수 사용
    if (typeof drawSegmentGraph === 'function') {
        // 컨테이너 크기가 확정된 후 그래프 그리기
        const drawGraph = () => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                console.warn('[updateSegmentGraph] Canvas 요소를 찾을 수 없습니다:', canvasId);
                return;
            }
            
            const container = canvas.parentElement;
            if (!container) {
                console.warn('[updateSegmentGraph] 컨테이너 요소를 찾을 수 없습니다.');
                return;
            }
            
            // 컨테이너가 실제 높이를 가지도록 대기
            if (container.clientHeight === 0) {
                // 컨테이너가 아직 준비되지 않았으면 다시 시도
                setTimeout(drawGraph, 50);
                return;
            }
            
            // 그래프 그리기 (경과시간 전달)
            const elapsedTime = window.lastElapsedTime || 0;
            drawSegmentGraph(segments, currentSegmentIndex, canvasId, elapsedTime);
        };
        
        // DOM이 준비될 때까지 대기 후 그리기
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(drawGraph, 150);
            });
        } else {
            // DOM이 이미 로드되었으면 바로 실행 (약간의 지연으로 레이아웃 안정화)
            setTimeout(drawGraph, 150);
        }
        
        // 마스코트 펄스 애니메이션을 위한 주기적 그래프 재그리기 (훈련 중일 때만)
        if (window.currentTrainingState === 'running') {
            // 기존 인터벌이 있으면 제거
            if (mascotAnimationInterval) {
                clearInterval(mascotAnimationInterval);
            }
            
            // 100ms마다 그래프를 다시 그려서 펄스 애니메이션 효과
            mascotAnimationInterval = setInterval(() => {
                if (window.currentWorkout && window.currentWorkout.segments && window.currentTrainingState === 'running') {
                    const elapsedTime = window.lastElapsedTime || 0;
                    drawSegmentGraph(window.currentWorkout.segments, currentSegmentIndex, canvasId, elapsedTime);
                } else {
                    // 훈련이 종료되면 애니메이션 중지
                    if (mascotAnimationInterval) {
                        clearInterval(mascotAnimationInterval);
                        mascotAnimationInterval = null;
                    }
                }
            }, 100);
        } else {
            // 훈련이 실행 중이 아니면 애니메이션 중지
            if (mascotAnimationInterval) {
                clearInterval(mascotAnimationInterval);
                mascotAnimationInterval = null;
            }
        }
    } else {
        console.warn('[Individual] drawSegmentGraph 함수를 찾을 수 없습니다.');
    }
}

// 속도계 눈금 생성 함수 (Indoor Training 스타일)
function generateGaugeTicks() {
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    const innerRadius = radius - 10; // 눈금 안쪽 시작점
    
    let ticksHTML = '';
    
    // 주눈금: 0, 1, 2, 3, 4, 5, 6 (총 7개)
    // 각도: 180도(왼쪽 상단, 0)에서 270도(위쪽)를 거쳐 360도(0도, 오른쪽 상단, 6)까지 180도 범위
    // 주눈금 간격: 180도 / 6 = 30도
    
    // 모든 눈금 생성 (주눈금 + 보조눈금)
    for (let i = 0; i <= 24; i++) { // 0~24 (주눈금 7개 + 보조눈금 18개 = 총 25개)
        const isMajor = i % 4 === 0; // 4 간격마다 주눈금 (0, 4, 8, 12, 16, 20, 24)
        
        // 각도 계산: 180도에서 시작하여 270도를 거쳐 360도(0도)까지 (위쪽 반원)
        // i=0 → 180도 (왼쪽 상단), i=12 → 270도 (위쪽), i=24 → 360도(0도) (오른쪽 상단)
        // 180도에서 시작하여 270도를 거쳐 360도(0도)로 가는 경로 (총 180도 범위)
        // 각도가 증가하는 방향: 180 → 270 → 360(0)
        let angle = 180 + (i / 24) * 180; // 180도에서 시작하여 360도까지
        if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
        const rad = (angle * Math.PI) / 180;
        
        // 눈금 위치 계산
        const x1 = centerX + innerRadius * Math.cos(rad);
        const y1 = centerY + innerRadius * Math.sin(rad);
        
        // 주눈금은 길게, 보조눈금은 짧게
        const tickLength = isMajor ? 14 : 7;
        const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
        const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
        
        // 흰색 눈금
        ticksHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                            stroke="#ffffff" 
                            stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
    }
    
    return ticksHTML;
}

// 속도계 레이블 생성 함수 (Indoor Training 스타일)
function generateGaugeLabels() {
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    const labelRadius = radius + 18; // 레이블 위치 (원 바깥쪽)
    
    let labelsHTML = '';
    
    // FTP 배수 정의
    const multipliers = [
        { index: 0, mult: 0, color: '#ffffff' },
        { index: 1, mult: 0.33, color: '#ffffff' },
        { index: 2, mult: 0.67, color: '#ffffff' },
        { index: 3, mult: 1, color: '#ef4444' }, // 빨강색
        { index: 4, mult: 1.33, color: '#ffffff' },
        { index: 5, mult: 1.67, color: '#ffffff' },
        { index: 6, mult: 2, color: '#ffffff' }
    ];
    
    // 주눈금 레이블 생성 (7개)
    multipliers.forEach((item, i) => {
        // 각도 계산: 180도에서 270도를 거쳐 360도(0도)까지 (위쪽 반원)
        // i=0 → 180도 (왼쪽 상단), i=3 → 270도 (위쪽), i=6 → 360도(0도) (오른쪽 상단)
        // 각도가 증가하는 방향: 180 → 270 → 360(0)
        let angle = 180 + (i / 6) * 180; // 180도에서 시작하여 360도까지
        if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
        const rad = (angle * Math.PI) / 180;
        
        // 레이블 위치 계산
        const x = centerX + labelRadius * Math.cos(rad);
        const y = centerY + labelRadius * Math.sin(rad);
        
        // FTP 값을 곱한 값 계산 (정수만 표기)
        const value = Math.round(userFTP * item.mult);
        
        // 레이블 생성 (정수값만 표기)
        labelsHTML += `<text x="${x}" y="${y}" 
                             text-anchor="middle" 
                             dominant-baseline="middle"
                             fill="${item.color}" 
                             font-size="10" 
                             font-weight="600">${value}</text>`;
    });
    
    return labelsHTML;
}

// 속도계 눈금 및 레이블 업데이트 함수
function updateGaugeTicksAndLabels() {
    const ticksGroup = document.getElementById('gauge-ticks');
    const labelsGroup = document.getElementById('gauge-labels');
    
    if (ticksGroup) {
        ticksGroup.innerHTML = generateGaugeTicks();
    }
    
    if (labelsGroup) {
        labelsGroup.innerHTML = generateGaugeLabels();
    }
}

// 초기 속도계 눈금 및 레이블 생성
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // 개인 훈련 대시보드 강도 조절 슬라이드 바 초기화
        initializeIndividualIntensitySlider();
        updateGaugeTicksAndLabels();
        startGaugeAnimationLoop(); // 바늘 애니메이션 루프 시작
    });
} else {
    // DOM이 이미 로드되었으면 바로 실행
    updateGaugeTicksAndLabels();
    startGaugeAnimationLoop(); // 바늘 애니메이션 루프 시작
}

/**
 * [가민 스타일] 게이지 애니메이션 루프 (60FPS 보간 이동)
 * - 바늘은 매 프레임 부드럽게 이동 (Lerp 적용)
 * - Indoor Training의 바늘 움직임 로직과 동일
 */
function startGaugeAnimationLoop() {
    // 이미 실행 중이면 중복 실행 방지
    if (gaugeAnimationFrameId !== null) return;
    
    const loop = () => {
        // 1. 목표값(currentPowerValue)과 현재표시값(displayPower)의 차이 계산
        const target = currentPowerValue || 0;
        const current = displayPower || 0;
        const diff = target - current;
        
        // 2. 보간(Interpolation) 적용: 거리가 멀면 빠르게, 가까우면 천천히 (감속 효과)
        // 0.15는 반응속도 계수 (높을수록 빠름, 낮을수록 부드러움. 0.1~0.2 추천)
        if (Math.abs(diff) > 0.1) {
            displayPower = current + diff * 0.15;
        } else {
            displayPower = target; // 차이가 미세하면 목표값으로 고정 (떨림 방지)
        }
        
        // 3. 바늘 각도 계산 및 업데이트 (매 프레임 실행)
        // FTP 기반으로 최대 파워 계산 (FTP × 2)
        const maxPower = userFTP * 2;
        let ratio = Math.min(Math.max(displayPower / maxPower, 0), 1);
        
        // -90도(왼쪽 상단) ~ 90도(오른쪽 상단) - 위쪽 반원
        const angle = -90 + (ratio * 180);
        
        const needle = document.getElementById('gauge-needle');
        if (needle) {
            // CSS Transition 간섭 제거하고 직접 제어
            needle.style.transition = 'none';
            needle.setAttribute('transform', `translate(100, 140) rotate(${angle})`);
        }
        
        // 4. 목표 파워 원호 업데이트
        updateTargetPowerArc();
        
        // 다음 프레임 요청
        gaugeAnimationFrameId = requestAnimationFrame(loop);
    };
    
    // 루프 시작
    gaugeAnimationFrameId = requestAnimationFrame(loop);
}

/**
 * 훈련 결과 팝업 표시
 * @param {Object} status - Firebase status 객체 (elapsedTime 포함)
 */
function showTrainingResultModal(status = null) {
    const modal = document.getElementById('trainingResultModal');
    if (!modal) {
        console.warn('[Individual] 훈련 결과 모달을 찾을 수 없습니다.');
        return;
    }
    
    // 결과값 계산
    const sessionData = window.trainingResults?.getCurrentSessionData?.();
    if (!sessionData) {
        console.warn('[Individual] 세션 데이터를 찾을 수 없습니다.');
        return;
    }
    
    // 통계 계산
    const stats = window.trainingResults?.calculateSessionStats?.() || {};
    
    // 훈련 시간 계산 - status.elapsedTime 우선 사용 (세그먼트 그래프 상단 시간값)
    let totalSeconds = 0;
    let duration_min = 0;
    
    if (status && status.elapsedTime !== undefined && status.elapsedTime !== null) {
        // Firebase에서 받은 elapsedTime 사용 (가장 정확)
        totalSeconds = Math.max(0, Math.floor(status.elapsedTime));
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] elapsedTime 사용:', { elapsedTime: status.elapsedTime, totalSeconds, duration_min });
    } else if (window.lastElapsedTime !== undefined && window.lastElapsedTime !== null) {
        // 전역 변수에 저장된 elapsedTime 사용
        totalSeconds = Math.max(0, Math.floor(window.lastElapsedTime));
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] lastElapsedTime 사용:', { lastElapsedTime: window.lastElapsedTime, totalSeconds, duration_min });
    } else {
        // 대체: startTime과 endTime으로 계산
        const startTime = sessionData.startTime ? new Date(sessionData.startTime) : null;
        const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
        totalSeconds = startTime ? Math.floor((endTime - startTime) / 1000) : 0;
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] startTime/endTime 사용:', { startTime, endTime, totalSeconds, duration_min });
    }
    
    // TSS 및 NP 계산 (resultManager.js와 동일한 로직)
    let tss = 0;
    let np = 0;
    
    // trainingMetrics가 있으면 사용 (가장 정확)
    if (window.trainingMetrics && window.trainingMetrics.elapsedSec > 0) {
        const elapsedSec = window.trainingMetrics.elapsedSec;
        const np4sum = window.trainingMetrics.np4sum || 0;
        const count = window.trainingMetrics.count || 1;
        
        if (count > 0 && np4sum > 0) {
            np = Math.pow(np4sum / count, 0.25);
            const userFtp = window.currentUser?.ftp || userFTP || 200;
            const IF = userFtp > 0 ? (np / userFtp) : 0;
            tss = (elapsedSec / 3600) * (IF * IF) * 100;
            console.log('[showTrainingResultModal] TSS 계산 (trainingMetrics):', { elapsedSec, np, IF, tss, userFtp });
        }
    }
    
    // trainingMetrics가 없으면 대체 계산 (elapsedTime 또는 totalSeconds 사용)
    if (!tss || tss === 0) {
        const userFtp = window.currentUser?.ftp || userFTP || 200;
        
        // NP가 없으면 평균 파워 * 1.05로 근사
        if (!np || np === 0) {
            np = Math.round((stats.avgPower || 0) * 1.05);
        }
        
        // IF 계산
        const IF = userFtp > 0 ? (np / userFtp) : 0;
        
        // TSS 계산: elapsedTime 우선 사용, 없으면 totalSeconds 사용
        const timeForTss = totalSeconds > 0 ? totalSeconds : (duration_min * 60);
        tss = (timeForTss / 3600) * (IF * IF) * 100;
        console.log('[showTrainingResultModal] TSS 계산 (대체):', { totalSeconds, duration_min, timeForTss, np, IF, tss, userFtp, avgPower: stats.avgPower });
    }
    
    // 값 반올림 및 최소값 보장
    tss = Math.max(0, Math.round(tss * 100) / 100);
    np = Math.max(0, Math.round(np * 10) / 10);
    
    // 칼로리 계산 (평균 파워 * 시간(초) * 3.6 / 4184)
    // 또는 더 간단한 공식: 평균 파워(W) * 시간(분) * 0.0143
    const avgPower = stats.avgPower || 0;
    const calories = Math.round(avgPower * duration_min * 0.0143);
    
    // 결과값 표시
    const durationEl = document.getElementById('result-duration');
    const avgPowerEl = document.getElementById('result-avg-power');
    const npEl = document.getElementById('result-np');
    const tssEl = document.getElementById('result-tss');
    const hrAvgEl = document.getElementById('result-hr-avg');
    const caloriesEl = document.getElementById('result-calories');
    
    if (durationEl) durationEl.textContent = `${duration_min}분`;
    if (avgPowerEl) avgPowerEl.textContent = `${stats.avgPower || 0}W`;
    if (npEl) npEl.textContent = `${np}W`;
    if (tssEl) tssEl.textContent = `${tss}`;
    if (hrAvgEl) hrAvgEl.textContent = `${stats.avgHR || 0}bpm`;
    if (caloriesEl) caloriesEl.textContent = `${calories}kcal`;
    
    // 마일리지 정보 표시 (주황색톤)
    const accPointsEl = document.getElementById('result-acc-points');
    const remPointsEl = document.getElementById('result-rem-points');
    const earnedPointsEl = document.getElementById('result-earned-points');
    
    // 훈련 전 포인트 값 가져오기 (훈련 종료 전 저장된 값)
    const beforePoints = window.beforeTrainingPoints || null;
    const beforeAccPoints = beforePoints ? beforePoints.acc_points : (window.currentUser?.acc_points || 0);
    const beforeRemPoints = beforePoints ? beforePoints.rem_points : (window.currentUser?.rem_points || 0);
    
    // 마일리지 업데이트 결과가 있으면 사용 (서버에서 업데이트된 최종 값)
    const mileageUpdate = window.lastMileageUpdate || null;
    if (mileageUpdate && mileageUpdate.success) {
        // 훈련 후 값 = 훈련 전 값 + TSS (획득 포인트)
        const afterAccPoints = beforeAccPoints + tss;
        const afterRemPoints = beforeRemPoints + tss;
        
        // 서버에서 업데이트된 최종 값 사용 (500 이상일 때 차감된 값)
        if (accPointsEl) accPointsEl.textContent = Math.round(mileageUpdate.acc_points || afterAccPoints);
        if (remPointsEl) remPointsEl.textContent = Math.round(mileageUpdate.rem_points || afterRemPoints);
        if (earnedPointsEl) earnedPointsEl.textContent = Math.round(tss);
    } else {
        // 마일리지 업데이트가 아직 완료되지 않았거나 실패한 경우: 훈련 전 값 + TSS로 표시
        const afterAccPoints = beforeAccPoints + tss;
        const afterRemPoints = beforeRemPoints + tss;
        if (accPointsEl) accPointsEl.textContent = Math.round(afterAccPoints);
        if (remPointsEl) remPointsEl.textContent = Math.round(afterRemPoints);
        if (earnedPointsEl) earnedPointsEl.textContent = Math.round(tss);
    }
    
    console.log('[showTrainingResultModal] 최종 결과:', { duration_min, avgPower: stats.avgPower, np, tss, hrAvg: stats.avgHR, calories, mileageUpdate });
    
    // 모달 표시
    modal.classList.remove('hidden');
    
    // 축하 오버레이 표시 (보유포인트 500 이상일 때 또는 마일리지 연장 시)
    const shouldShowCelebration = (mileageUpdate && mileageUpdate.success && mileageUpdate.add_days > 0) ||
                                   (mileageUpdate && mileageUpdate.success && (mileageUpdate.rem_points || 0) >= 500);
    if (shouldShowCelebration) {
        showIndividualMileageCelebration(mileageUpdate, tss);
    }
}

/**
 * 블루투스 개인화면 대시보드 마일리지 축하 오버레이 표시
 */
function showIndividualMileageCelebration(mileageUpdate, earnedTss) {
    const modal = document.getElementById('individualMileageCelebrationModal');
    const messageEl = document.getElementById('individual-celebration-message');
    
    if (!modal || !messageEl) {
        console.warn('[Individual] 축하 오버레이 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 이전 보유 포인트 계산: 현재 잔액 + 사용한 포인트 - 획득 포인트
    // 예: 잔액 100 + 사용 500 - 획득 120 = 이전 보유 480
    const currentRemPoints = Math.round(mileageUpdate.rem_points || 0);
    const earnedPoints = Math.round(earnedTss);
    const addDays = mileageUpdate.add_days || 0;
    const usedPoints = addDays * 500;
    const previousRemPoints = Math.round(currentRemPoints + usedPoints - earnedPoints);
    const totalAfterEarned = previousRemPoints + earnedPoints;
    
    // 축하 메시지 생성
    const message = `
        <div style="margin-bottom: 12px; font-size: 1.1em; font-weight: 600;">
            오늘의 훈련으로 ${earnedPoints} S-Point 획득!
        </div>
        <div style="margin-bottom: 12px; font-size: 0.95em;">
            💰 (현재 보유: ${previousRemPoints} SP + ${earnedPoints} SP = ${totalAfterEarned} SP)
        </div>
        <div style="font-size: 0.95em; font-weight: 600;">
            🎉 ${usedPoints} SP를 사용하여 구독 기간이 ${addDays}일 연장되었습니다! (잔액: ${currentRemPoints} SP)
        </div>
    `;
    
    messageEl.innerHTML = message;
    
    // 오버레이 표시 (결과 모달 위에 표시)
    modal.classList.remove('hidden');
    
    console.log('[Individual] 축하 오버레이 표시:', { mileageUpdate, earnedTss });
}

/**
 * 블루투스 개인화면 대시보드 마일리지 축하 오버레이 닫기
 */
function closeIndividualMileageCelebration() {
    const modal = document.getElementById('individualMileageCelebrationModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * 훈련 결과 팝업 닫기
 */
function closeTrainingResultModal() {
    const modal = document.getElementById('trainingResultModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 전역 함수로 노출
window.showTrainingResultModal = showTrainingResultModal;
window.closeTrainingResultModal = closeTrainingResultModal;
window.showIndividualMileageCelebration = showIndividualMileageCelebration;
window.closeIndividualMileageCelebration = closeIndividualMileageCelebration;

/**
 * 속도계 원호에 목표 파워값만큼 채우기 (세그먼트 달성도에 따라 색상 변경)
 * - LAP AVG 파워값 / 목표 파워값 비율이 0.985 이상이면 투명 민트색
 * - 미만이면 투명 주황색
 */
function updateTargetPowerArc() {
    // 목표 파워값 가져오기
    const targetPowerEl = document.getElementById('ui-target-power');
    if (!targetPowerEl) return;
    
    const targetPower = Number(targetPowerEl.textContent) || 0;
    if (targetPower <= 0) {
        // 목표 파워가 없으면 원호 숨김
        const targetArc = document.getElementById('gauge-target-arc');
        if (targetArc) {
            targetArc.style.display = 'none';
        }
        // 상한 원호도 숨김
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
        return;
    }
    
    // LAP AVG 파워값 가져오기
    const lapPowerEl = document.getElementById('ui-lap-power');
    const lapPower = lapPowerEl ? Number(lapPowerEl.textContent) || 0 : 0;
    
    // 세그먼트 달성도 계산 (LAP AVG / 목표 파워) - 하한값 기준
    const achievementRatio = targetPower > 0 ? lapPower / targetPower : 0;
    
    // 색상 결정: 비율이 0.985 이상이면 민트색, 미만이면 주황색
    const arcColor = achievementRatio >= 0.985 
        ? 'rgba(0, 212, 170, 0.5)'  // 투명 민트색 (#00d4aa)
        : 'rgba(255, 140, 0, 0.5)'; // 투명 주황색
    
    // FTP 기반으로 최대 파워 계산
    const maxPower = userFTP * 2;
    if (maxPower <= 0) return;
    
    // 현재 세그먼트 정보 가져오기
    const seg = getCurrentSegment();
    const targetType = seg?.target_type || 'ftp_pct';
    const isFtpPctz = targetType === 'ftp_pctz';
    
    // cadence_rpm 타입인 경우: 파워값이 없으므로 원호 표시하지 않음
    if (targetType === 'cadence_rpm') {
        const targetArc = document.getElementById('gauge-target-arc');
        if (targetArc) {
            targetArc.style.display = 'none';
        }
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
        return;
    }
    
    // 목표 파워 비율 계산 (0 ~ 1) - 하한값 기준
    const minRatio = Math.min(Math.max(targetPower / maxPower, 0), 1);
    
    // 각도 계산: 180도(왼쪽 상단)에서 시작하여 각도가 증가하는 방향으로
    const startAngle = 180;
    let minEndAngle = 180 + (minRatio * 180);
    
    // SVG 원호 경로 생성
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    
    // 하한값 원호 경로 생성
    const startRad = (startAngle * Math.PI) / 180;
    const minEndRad = (minEndAngle * Math.PI) / 180;
    
    const startX = centerX + radius * Math.cos(startRad);
    const startY = centerY + radius * Math.sin(startRad);
    const minEndX = centerX + radius * Math.cos(minEndRad);
    const minEndY = centerY + radius * Math.sin(minEndRad);
    
    const minAngleDiff = minEndAngle - startAngle;
    const minLargeArcFlag = minAngleDiff > 180 ? 1 : 0;
    const minPathData = `M ${startX} ${startY} A ${radius} ${radius} 0 ${minLargeArcFlag} 1 ${minEndX} ${minEndY}`;
    
    // 목표 파워 원호 요소 가져오기 또는 생성 (하한값)
    let targetArc = document.getElementById('gauge-target-arc');
    if (!targetArc) {
        // SVG에 원호 요소 추가
        const svg = document.querySelector('.gauge-container svg');
        if (svg) {
            targetArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            targetArc.id = 'gauge-target-arc';
            targetArc.setAttribute('fill', 'none');
            targetArc.setAttribute('stroke-width', '12');
            targetArc.setAttribute('stroke-linecap', 'round');
            // 원호 배경 뒤에, 눈금 앞에 배치
            const arcBg = svg.querySelector('path[d*="M 20 140"]');
            if (arcBg && arcBg.nextSibling) {
                svg.insertBefore(targetArc, arcBg.nextSibling);
            } else {
                svg.insertBefore(targetArc, svg.firstChild.nextSibling);
            }
        } else {
            return;
        }
    }
    
    // 하한값 원호 경로 및 색상 업데이트
    targetArc.setAttribute('d', minPathData);
    targetArc.setAttribute('stroke', arcColor);
    targetArc.style.display = 'block';
    
    // ftp_pctz 타입인 경우 상한값 원호 추가
    if (isFtpPctz && window.currentSegmentMaxPower && window.currentSegmentMaxPower > targetPower) {
        const maxPowerValue = window.currentSegmentMaxPower;
        const maxRatio = Math.min(Math.max(maxPowerValue / maxPower, 0), 1);
        const maxEndAngle = 180 + (maxRatio * 180);
        const maxEndRad = (maxEndAngle * Math.PI) / 180;
        const maxEndX = centerX + radius * Math.cos(maxEndRad);
        const maxEndY = centerY + radius * Math.sin(maxEndRad);
        
        const maxAngleDiff = maxEndAngle - minEndAngle;
        const maxLargeArcFlag = maxAngleDiff > 180 ? 1 : 0;
        const maxPathData = `M ${minEndX} ${minEndY} A ${radius} ${radius} 0 ${maxLargeArcFlag} 1 ${maxEndX} ${maxEndY}`;
        
        // 상한값 원호 요소 가져오기 또는 생성
        let maxArc = document.getElementById('gauge-max-arc');
        if (!maxArc) {
            const svg = document.querySelector('.gauge-container svg');
            if (svg) {
                maxArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                maxArc.id = 'gauge-max-arc';
                maxArc.setAttribute('fill', 'none');
                maxArc.setAttribute('stroke-width', '12');
                maxArc.setAttribute('stroke-linecap', 'round');
                // 하한값 원호 다음에 배치
                if (targetArc && targetArc.nextSibling) {
                    svg.insertBefore(maxArc, targetArc.nextSibling);
                } else {
                    svg.appendChild(maxArc);
                }
            } else {
                return;
            }
        }
        
        // 상한값 원호 경로 및 색상 업데이트 (투명도 낮춘 주황색)
        maxArc.setAttribute('d', maxPathData);
        maxArc.setAttribute('stroke', 'rgba(255, 140, 0, 0.2)'); // 더 투명한 주황색
        maxArc.style.display = 'block';
    } else {
        // ftp_pctz가 아니거나 상한값이 없으면 상한 원호 숨김
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
    }
    
    // 디버깅 로그 (선택사항)
    if (achievementRatio > 0) {
        console.log(`[updateTargetPowerArc] 달성도: ${(achievementRatio * 100).toFixed(1)}% (LAP: ${lapPower}W / 목표: ${targetPower}W), 색상: ${achievementRatio >= 0.985 ? '민트색' : '주황색'}${isFtpPctz ? `, 상한: ${window.currentSegmentMaxPower}W` : ''}`);
    }
}

/**
 * 개인 훈련 대시보드 강도 조절 슬라이드 바 초기화
 */
function initializeIndividualIntensitySlider() {
    const slider = document.getElementById('individualIntensityAdjustmentSlider');
    const valueDisplay = document.getElementById('individualIntensityAdjustmentValue');
    
    if (!slider || !valueDisplay) {
        console.warn('[개인 훈련] 강도 조절 슬라이더 요소를 찾을 수 없습니다');
        return;
    }
    
    // 초기값 설정: 로컬 스토리지에서 불러오기
    let currentAdjustment = individualIntensityAdjustment;
    
    try {
        const saved = localStorage.getItem('individualIntensityAdjustment');
        if (saved) {
            currentAdjustment = parseFloat(saved);
            individualIntensityAdjustment = currentAdjustment;
        } else {
            currentAdjustment = 1.0;
            individualIntensityAdjustment = 1.0;
        }
    } catch (e) {
        currentAdjustment = 1.0;
        individualIntensityAdjustment = 1.0;
    }
    
    // 조정 계수를 슬라이더 값으로 변환 (0.95 → -5, 1.0 → 0, 1.05 → +5)
    const sliderValue = Math.round((currentAdjustment - 1.0) * 100);
    // 슬라이더 범위는 -5 ~ +5이므로 클램프
    const clampedValue = Math.max(-5, Math.min(5, sliderValue));
    
    console.log('[개인 훈련] 강도 조절 초기값 설정:', {
        adjustment: currentAdjustment,
        sliderValue: sliderValue,
        clampedValue: clampedValue
    });
    
    slider.value = clampedValue;
    updateIndividualIntensityDisplay(clampedValue);
    
    // 초기화 시에도 목표 파워 업데이트
    updateTargetPower();
    
    // 기존 이벤트 리스너 제거 (중복 방지)
    const newSlider = slider.cloneNode(true);
    slider.parentNode.replaceChild(newSlider, slider);
    
    // 슬라이더 이벤트 리스너 (input: 실시간 반영)
    newSlider.addEventListener('input', function(e) {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value)) {
            // 실시간으로 목표 파워와 표시 값 업데이트
            updateIndividualIntensityAdjustment(value);
        }
    });
    
    // 슬라이더 변경 완료 시 (마우스 떼거나 터치 종료) - 로컬 스토리지 저장
    newSlider.addEventListener('change', function(e) {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value)) {
            updateIndividualIntensityAdjustment(value);
            // 로컬 스토리지에 저장
            localStorage.setItem('individualIntensityAdjustment', String(individualIntensityAdjustment));
            console.log('[개인 훈련] 강도 조절 로컬 스토리지에 저장:', individualIntensityAdjustment);
        }
    });
}

/**
 * 개인 훈련 대시보드 강도 조절 업데이트
 */
function updateIndividualIntensityAdjustment(sliderValue) {
    // 슬라이더 값(-5 ~ +5)을 조정 계수로 변환 (0.95 ~ 1.05)
    const adjustment = 1.0 + (sliderValue / 100);
    individualIntensityAdjustment = adjustment;
    
    console.log('[개인 훈련] 강도 조절 값 변경:', {
        sliderValue: sliderValue,
        adjustment: adjustment,
        percentage: (adjustment * 100).toFixed(1) + '%'
    });
    
    // 1. 표시 업데이트 (강도 조절 % 표시) - 즉시 반영
    updateIndividualIntensityDisplay(sliderValue);
    
    // 2. 목표 파워 실시간 업데이트
    updateTargetPower();
}

/**
 * 개인 훈련 대시보드 강도 조절 표시 업데이트
 */
function updateIndividualIntensityDisplay(sliderValue) {
    const valueDisplay = document.getElementById('individualIntensityAdjustmentValue');
    if (valueDisplay) {
        const sign = sliderValue >= 0 ? '+' : '';
        valueDisplay.textContent = `${sign}${sliderValue}%`;
        
        // 색상 변경 (음수: 파란색, 0: 회색, 양수: 빨간색)
        if (sliderValue < 0) {
            valueDisplay.style.color = '#3b82f6'; // 파란색
        } else if (sliderValue > 0) {
            valueDisplay.style.color = '#ef4444'; // 빨간색
        } else {
            valueDisplay.style.color = '#9ca3af'; // 회색
        }
        
        console.log('[개인 훈련] 강도 조절 표시 업데이트:', `${sign}${sliderValue}%`);
    } else {
        console.warn('[개인 훈련] individualIntensityAdjustmentValue 요소를 찾을 수 없습니다');
    }
}

// ========== 블루투스 연결 기능 (개인훈련 대시보드 전용, 독립적 구동) ==========
// 블루투스 연결 드롭다운 토글 (개인훈련 대시보드 전용)
function toggleIndividualBluetoothDropdown() {
    const dropdown = document.getElementById('individualBluetoothDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
        // 드롭다운 외부 클릭 시 닫기
        if (dropdown.classList.contains('show')) {
            // 드롭다운 열 때 저장된 기기 목록 업데이트
            updateIndividualBluetoothDropdownWithSavedDevices();
            setTimeout(() => {
                document.addEventListener('click', closeIndividualBluetoothDropdownOnOutsideClick);
            }, 0);
        } else {
            document.removeEventListener('click', closeIndividualBluetoothDropdownOnOutsideClick);
        }
    }
}

// 드롭다운 외부 클릭 시 닫기 (개인훈련 대시보드 전용)
function closeIndividualBluetoothDropdownOnOutsideClick(event) {
    const dropdown = document.getElementById('individualBluetoothDropdown');
    const button = document.getElementById('individualBluetoothConnectBtn');
    if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
        dropdown.classList.remove('show');
        document.removeEventListener('click', closeIndividualBluetoothDropdownOnOutsideClick);
    }
}

// 저장된 기기에 재연결하는 함수 (개인훈련 대시보드 전용)
async function connectIndividualBluetoothDeviceToSaved(deviceId, deviceType) {
  try {
    // bluetooth.js의 reconnectToSavedDevice 함수 활용
    const reconnectFn = typeof reconnectToSavedDevice === 'function' 
      ? reconnectToSavedDevice 
      : (typeof window.reconnectToSavedDevice === 'function' ? window.reconnectToSavedDevice : null);
    
    if (!reconnectFn) {
      throw new Error('재연결 함수를 찾을 수 없습니다. bluetooth.js가 로드되었는지 확인해주세요.');
    }
    
    console.log('[Individual Dashboard] 저장된 기기 재연결 시도:', { deviceId, deviceType });
    
    let result;
    try {
      result = await reconnectFn(deviceId, deviceType);
      
      // getDevices() API가 사용 불가능하거나 기기를 찾지 못한 경우 null 반환
      if (!result) {
        console.warn('[Individual Dashboard] 저장된 기기 재연결 실패 (getDevices API 미지원 또는 기기 없음), 새 기기 검색으로 진행');
        // 재연결 실패 시 일반 디바이스 함수로 폴백 (새 기기 검색)
        const connectFunction = deviceType === 'trainer' ? window.connectTrainer 
          : deviceType === 'heartRate' ? window.connectHeartRate 
          : deviceType === 'powerMeter' ? window.connectPowerMeter 
          : null;
        
        if (connectFunction && typeof connectFunction === 'function') {
          if (typeof showToast === 'function') {
            showToast('저장된 기기를 찾을 수 없습니다. 새 기기를 검색합니다...');
          }
          await connectFunction();
          setTimeout(() => {
            updateIndividualBluetoothConnectionStatus();
          }, 200);
          return;
        } else {
          throw new Error('기기를 찾을 수 없고 새 기기 검색도 실패했습니다.');
        }
      }
    } catch (reconnectError) {
      console.warn('[Individual Dashboard] 저장된 기기 재연결 실패, 새 기기 검색으로 진행:', reconnectError);
      // 재연결 실패 시 일반 디바이스 함수로 폴백 (새 기기 검색)
      const connectFunction = deviceType === 'trainer' ? window.connectTrainer 
        : deviceType === 'heartRate' ? window.connectHeartRate 
        : deviceType === 'powerMeter' ? window.connectPowerMeter 
        : null;
      
      if (connectFunction && typeof connectFunction === 'function') {
        if (typeof showToast === 'function') {
          showToast('저장된 기기를 찾을 수 없습니다. 새 기기를 검색합니다...');
        }
        await connectFunction();
        setTimeout(() => {
          updateIndividualBluetoothConnectionStatus();
        }, 200);
        return;
      } else {
        throw reconnectError; // 디바이스 함수가 없으면 원래 에러를 다시 던짐
      }
    }
    
    const { device, server } = result;
    
    // 디바이스 타입별 연결 처리
    if (deviceType === 'heartRate') {
      let service;
      try { 
        service = await server.getPrimaryService('heart_rate'); 
      } catch (e) { 
        service = await server.getPrimaryService('0000180d-0000-1000-8000-00805f9b34fb'); 
      }
      
      let characteristic;
      try { 
        characteristic = await service.getCharacteristic('heart_rate_measurement'); 
      } catch (e) { 
        characteristic = await service.getCharacteristic(0x2A37); 
      }
      
      await characteristic.startNotifications();
      const hrHandler = typeof handleHeartRateData === 'function' ? handleHeartRateData : (typeof window.handleHeartRateData === 'function' ? window.handleHeartRateData : null);
      if (hrHandler) {
        characteristic.addEventListener("characteristicvaluechanged", hrHandler);
      }
      
      window.connectedDevices.heartRate = { 
        name: device.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic 
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'heartRate' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('heartRate', device));
      }
      
      // 저장된 기기 정보 업데이트
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'heartRate');
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'heartRate', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      if (typeof showToast === 'function') {
        showToast(`✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결 성공`);
      }
      
    } else if (deviceType === 'trainer') {
      // 스마트 트레이너 연결 처리 (bluetooth.js의 connectTrainer 로직과 동일)
      const UUIDS = {
        FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
        FTMS_DATA: '00002ad2-0000-1000-8000-00805f9b34fb',
        FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
        CPS_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
        CPS_DATA: '00002a63-0000-1000-8000-00805f9b34fb',
        CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
        CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592',
        WAHOO_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
        WAHOO_CONTROL: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      };
      
      const _safeGetService = async (uuid) => { 
        try { return await server.getPrimaryService(uuid); } 
        catch (e) { return null; } 
      };
      const _safeGetChar = async (svc, uuid) => { 
        if(!svc) return null; 
        try { return await svc.getCharacteristic(uuid); } 
        catch (e) { return null; } 
      };
      
      let dataChar = null;
      let dataProtocol = 'UNKNOWN';
      
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
        dataChar = await _safeGetChar(svc, UUIDS.FTMS_DATA);
        if(dataChar) dataProtocol = 'FTMS';
      }
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.CPS_SERVICE);
        dataChar = await _safeGetChar(svc, UUIDS.CPS_DATA);
        if(dataChar) dataProtocol = 'CPS';
      }
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
        if (svc) {
          try {
            const chars = await svc.getCharacteristics();
            if (chars.length > 0) { 
              dataChar = chars[0]; 
              dataProtocol = 'CYCLEOPS_LEGACY'; 
            }
          } catch(e) {}
        }
      }
      
      if (!dataChar) throw new Error("데이터 전송 서비스를 찾을 수 없습니다.");
      
      await dataChar.startNotifications();
      const trainerHandler = typeof handleTrainerData === 'function' ? handleTrainerData : (typeof window.handleTrainerData === 'function' ? window.handleTrainerData : null);
      const powerHandler = typeof handlePowerMeterData === 'function' ? handlePowerMeterData : (typeof window.handlePowerMeterData === 'function' ? window.handlePowerMeterData : null);
      const parser = (dataProtocol === 'FTMS') ? (trainerHandler || (() => {})) : (powerHandler || (() => {})); 
      if (parser) {
        dataChar.addEventListener("characteristicvaluechanged", parser);
      }
      
      let controlChar = null;
      let controlProtocol = 'NONE';
      
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.FTMS_CONTROL);
        if(controlChar) controlProtocol = 'FTMS';
      }
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.CYCLEOPS_CONTROL);
        if(controlChar) controlProtocol = 'CYCLEOPS';
      }
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.WAHOO_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.WAHOO_CONTROL);
        if(controlChar) controlProtocol = 'WAHOO';
      }
      
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'trainer');
      
      window.connectedDevices.trainer = { 
        name: device.name || saved?.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic: dataChar, 
        controlPoint: controlChar,
        protocol: controlProtocol, 
        dataProtocol: dataProtocol, 
        realProtocol: controlProtocol
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'trainer' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('trainer', device));
      }
      
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'trainer', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      
      let statusMsg = `✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결됨 [${dataProtocol}]`;
      if (controlChar) statusMsg += `\n⚡ ERG 모드 가능 [${controlProtocol}]`;
      else statusMsg += `\n⚠️ 파워미터 모드 (제어 불가)`;
      if (typeof showToast === 'function') showToast(statusMsg);
      
      if (window.ergController) setTimeout(() => window.ergController.initializeTrainer(), 500);
      
    } else if (deviceType === 'powerMeter') {
      // 파워미터 연결 처리
      const UUIDS = {
        CPS_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
        CPS_DATA: '00002a63-0000-1000-8000-00805f9b34fb',
        CSC_SERVICE: '00001816-0000-1000-8000-00805f9b34fb',
      };
      
      let service, characteristic;
      try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
      } catch (e) {
        service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
        characteristic = await service.getCharacteristic(0x2A5B);
      }
      
      await characteristic.startNotifications();
      const powerHandler = typeof handlePowerMeterData === 'function' ? handlePowerMeterData : (typeof window.handlePowerMeterData === 'function' ? window.handlePowerMeterData : null);
      if (powerHandler) {
        characteristic.addEventListener("characteristicvaluechanged", powerHandler);
      }
      
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'powerMeter');
      
      window.connectedDevices.powerMeter = { 
        name: device.name || saved?.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic 
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'powerMeter' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('powerMeter', device));
      }
      
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'powerMeter', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      if (typeof showToast === 'function') {
        showToast(`✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결 성공`);
      }
    }
    
    // 연결 성공 후 상태 업데이트
    setTimeout(() => {
      updateIndividualBluetoothConnectionStatus();
    }, 200);
    
  } catch (error) {
    console.error('[Individual Dashboard] 저장된 기기 재연결 실패:', error);
    if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
    
    // 재연결 실패 시 자동으로 새 기기 검색으로 폴백
    const errorMessage = error.message || '알 수 없는 오류';
    if (typeof showToast === 'function') {
      showToast(`저장된 기기를 찾을 수 없습니다.\n기기가 전원이 켜져 있고 범위 내에 있는지 확인해주세요.\n\n새 기기 검색을 진행합니다...`);
    }
    
    // 자동으로 새 기기 검색으로 폴백
    try {
      const connectFunction = deviceType === 'trainer' ? window.connectTrainer 
        : deviceType === 'heartRate' ? window.connectHeartRate 
        : deviceType === 'powerMeter' ? window.connectPowerMeter 
        : null;
      
      if (connectFunction && typeof connectFunction === 'function') {
        console.log('[Individual Dashboard] 새 기기 검색으로 폴백:', deviceType);
        await connectFunction();
        setTimeout(() => {
          updateIndividualBluetoothConnectionStatus();
        }, 200);
        return;
      }
    } catch (fallbackError) {
      console.error('[Individual Dashboard] 새 기기 검색 폴백 실패:', fallbackError);
      if (typeof showToast === 'function') {
        showToast('기기 연결에 실패했습니다: ' + (fallbackError.message || '알 수 없는 오류'));
      }
    }
  }
}

// 블루투스 디바이스 연결 함수 (개인훈련 대시보드 전용, 독립적 구동)
async function connectIndividualBluetoothDevice(deviceType, savedDeviceId) {
    // 드롭다운 닫기
    const dropdown = document.getElementById('individualBluetoothDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
        document.removeEventListener('click', closeIndividualBluetoothDropdownOnOutsideClick);
    }
    
    // 저장된 기기 ID가 제공된 경우 재연결 시도
    if (savedDeviceId) {
        await connectIndividualBluetoothDeviceToSaved(savedDeviceId, deviceType);
        return;
    }
    
    // 연결 함수가 있는지 확인
    let connectFunction;
    switch (deviceType) {
        case 'trainer':
            connectFunction = window.connectTrainer;
            break;
        case 'heartRate':
            connectFunction = window.connectHeartRate;
            break;
        case 'powerMeter':
            connectFunction = window.connectPowerMeter;
            break;
        default:
            console.error('[Individual] 알 수 없는 디바이스 타입:', deviceType);
            return;
    }
    
    if (!connectFunction || typeof connectFunction !== 'function') {
        console.error('[Individual] 블루투스 연결 함수를 찾을 수 없습니다:', deviceType);
        alert('블루투스 연결 기능이 로드되지 않았습니다. 페이지를 새로고침해주세요.');
        return;
    }
    
    try {
        console.log('[Individual] 블루투스 디바이스 연결 시도:', deviceType);
        await connectFunction();
        
        // 연결 성공 후 잠시 대기 (window.connectedDevices 업데이트를 위해)
        setTimeout(() => {
            // 연결 상태 업데이트
            updateIndividualBluetoothConnectionStatus();
        }, 200); // 200ms 대기 후 업데이트
    } catch (error) {
        console.error('[Individual] 블루투스 디바이스 연결 실패:', deviceType, error);
        // 에러는 bluetooth.js의 showToast에서 표시됨
    }
}

// 저장된 기기 목록을 드롭다운에 동적으로 표시하는 함수 (개인훈련 대시보드 전용)
function updateIndividualBluetoothDropdownWithSavedDevices() {
  const dropdown = document.getElementById('individualBluetoothDropdown');
  if (!dropdown) return;
  
  // 저장된 기기 로드 함수가 있는지 확인
  const getSavedDevicesByTypeFn = typeof getSavedDevicesByType === 'function' 
    ? getSavedDevicesByType 
    : (typeof window.getSavedDevicesByType === 'function' ? window.getSavedDevicesByType : null);
  
  if (!getSavedDevicesByTypeFn) {
    console.warn('[Individual Dashboard] getSavedDevicesByType 함수를 찾을 수 없습니다.');
    return;
  }
  
  // 각 디바이스 타입별로 저장된 기기 목록 가져오기
  const deviceTypes = ['trainer', 'heartRate', 'powerMeter'];
  const deviceTypeLabels = {
    trainer: '스마트 트레이너',
    heartRate: '심박계',
    powerMeter: '파워미터'
  };
  
  deviceTypes.forEach(deviceType => {
    const savedDevices = getSavedDevicesByTypeFn(deviceType);
    if (savedDevices.length === 0) return;
    
    // 해당 메인 아이템 찾기
    let itemId = '';
    switch(deviceType) {
      case 'trainer':
        itemId = 'individualBluetoothTrainerItem';
        break;
      case 'heartRate':
        itemId = 'individualBluetoothHRItem';
        break;
      case 'powerMeter':
        itemId = 'individualBluetoothPMItem';
        break;
    }
    
    const mainItem = document.getElementById(itemId);
    if (!mainItem) return;
    
    // 저장된 기기 목록 컨테이너 ID
    const savedListId = `individualBluetoothSaved${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}List`;
    
    // 기존 저장된 기기 목록 제거
    const existingList = document.getElementById(savedListId);
    if (existingList) {
      existingList.remove();
    }
    
    // 저장된 기기 목록 컨테이너 생성
    const savedListContainer = document.createElement('div');
    savedListContainer.id = savedListId;
    savedListContainer.style.cssText = 'border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 8px; margin-top: 8px;';
    
    // 저장된 기기 목록 헤더
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 11px; color: #888; padding: 4px 12px; margin-bottom: 4px;';
    header.textContent = `⭐ 저장된 ${deviceTypeLabels[deviceType]}`;
    savedListContainer.appendChild(header);
    
    // 각 저장된 기기 항목 생성 (닉네임(디바이스코드) 왼쪽, 오른쪽 끝에 "삭제")
    savedDevices.forEach(saved => {
      const savedItem = document.createElement('div');
      savedItem.className = 'bluetooth-dropdown-item';
      savedItem.style.cssText = 'padding: 8px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
      
      const labelWrap = document.createElement('span');
      labelWrap.style.cssText = 'flex: 1; min-width: 0;';
      labelWrap.onclick = (e) => {
        e.stopPropagation();
        console.log('[Individual Dashboard] 저장된 기기 클릭:', { 
          deviceType, 
          deviceId: saved.deviceId, 
          nickname: saved.nickname,
          name: saved.name 
        });
        connectIndividualBluetoothDevice(deviceType, saved.deviceId);
      };
      
      const nickname = document.createElement('span');
      nickname.textContent = saved.nickname || saved.name || '알 수 없는 기기';
      nickname.style.cssText = 'color: #fff;';
      
      const deviceName = document.createElement('span');
      deviceName.textContent = ` (${saved.name || ''})`;
      deviceName.style.cssText = 'color: #888; font-size: 11px;';
      
      labelWrap.appendChild(nickname);
      labelWrap.appendChild(deviceName);
      savedItem.appendChild(labelWrap);
      
      const deleteBtn = document.createElement('span');
      deleteBtn.textContent = '삭제';
      deleteBtn.style.cssText = 'color: #f87171; font-size: 12px; flex-shrink: 0; cursor: pointer;';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        var removed = false;
        if (typeof window.removeSavedDevice === 'function') {
          removed = window.removeSavedDevice(saved.deviceId, deviceType);
        }
        if (removed && typeof showToast === 'function') {
          showToast('저장된 기기가 목록에서 삭제되었습니다.');
        }
        if (typeof updateIndividualBluetoothDropdownWithSavedDevices === 'function') {
          updateIndividualBluetoothDropdownWithSavedDevices();
        }
      };
      savedItem.appendChild(deleteBtn);
      savedListContainer.appendChild(savedItem);
    });
    
    // 메인 아이템 다음에 삽입
    mainItem.parentNode.insertBefore(savedListContainer, mainItem.nextSibling);
  });
}

// 블루투스 연결 상태 업데이트 함수 (개인훈련 대시보드 전용, 독립적 구동)
function updateIndividualBluetoothConnectionStatus() {
    const hrItem = document.getElementById('individualBluetoothHRItem');
    const hrStatus = document.getElementById('individualHeartRateStatus');
    const trainerItem = document.getElementById('individualBluetoothTrainerItem');
    const trainerStatus = document.getElementById('individualTrainerStatus');
    const pmItem = document.getElementById('individualBluetoothPMItem');
    const pmStatus = document.getElementById('individualPowerMeterStatus');
    const connectBtn = document.getElementById('individualBluetoothConnectBtn');
    
    // 드롭다운에 저장된 기기 목록 업데이트
    updateIndividualBluetoothDropdownWithSavedDevices();
    
    // 심박계 상태
    if (window.connectedDevices?.heartRate) {
        if (hrItem) hrItem.classList.add('connected');
        if (hrStatus) {
            hrStatus.textContent = '연결됨';
            hrStatus.style.color = '#00d4aa';
        }
    } else {
        if (hrItem) hrItem.classList.remove('connected');
        if (hrStatus) {
            hrStatus.textContent = '미연결';
            hrStatus.style.color = '#888';
        }
    }
    
    // 스마트 트레이너 상태
    if (window.connectedDevices?.trainer) {
        if (trainerItem) trainerItem.classList.add('connected');
        if (trainerStatus) {
            trainerStatus.textContent = '연결됨';
            trainerStatus.style.color = '#00d4aa';
        }
        
        // ERG 동작 메뉴 표시 (스마트 트레이너 연결 시)
        const ergMenu = document.getElementById('individualBluetoothErgMenu');
        if (ergMenu) {
            ergMenu.style.display = 'block';
        }
    } else {
        if (trainerItem) trainerItem.classList.remove('connected');
        if (trainerStatus) {
            trainerStatus.textContent = '미연결';
            trainerStatus.style.color = '#888';
        }
        
        // ERG 동작 메뉴 숨김 (스마트 트레이너 미연결 시)
        const ergMenu = document.getElementById('individualBluetoothErgMenu');
        if (ergMenu) {
            ergMenu.style.display = 'none';
        }
    }
    
    // 파워미터 상태
    if (window.connectedDevices?.powerMeter) {
        if (pmItem) pmItem.classList.add('connected');
        if (pmStatus) {
            pmStatus.textContent = '연결됨';
            pmStatus.style.color = '#00d4aa';
        }
    } else {
        if (pmItem) pmItem.classList.remove('connected');
        if (pmStatus) {
            pmStatus.textContent = '미연결';
            pmStatus.style.color = '#888';
        }
    }
    
    // 연결 버튼 상태 업데이트 (연결된 디바이스가 하나라도 있으면)
    if (connectBtn) {
        if (window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter) {
            connectBtn.classList.add('has-connection');
        } else {
            connectBtn.classList.remove('has-connection');
        }
    }
}

// 전역 함수로 노출 (개인훈련 대시보드 전용)
window.toggleIndividualBluetoothDropdown = toggleIndividualBluetoothDropdown;
window.connectIndividualBluetoothDevice = connectIndividualBluetoothDevice;
window.connectIndividualBluetoothDeviceToSaved = connectIndividualBluetoothDeviceToSaved;
window.updateIndividualBluetoothConnectionStatus = updateIndividualBluetoothConnectionStatus;
window.updateIndividualBluetoothDropdownWithSavedDevices = updateIndividualBluetoothDropdownWithSavedDevices;

// 페이지 로드 시 연결 상태 업데이트 및 주기적 업데이트
document.addEventListener('DOMContentLoaded', () => {
    // 초기 연결 상태 업데이트
    setTimeout(() => {
        updateIndividualBluetoothConnectionStatus();
    }, 500);
    
    // 주기적으로 연결 상태 업데이트 (5초마다)
    setInterval(() => {
        updateIndividualBluetoothConnectionStatus();
    }, 5000);
});