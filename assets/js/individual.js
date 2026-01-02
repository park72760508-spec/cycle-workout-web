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
    
    // 사용자 이름 추출 (여러 필드명 지원)
    const userName = data.name || data.userName || data.participantName || data.user_name || data.participant_name || null;
    
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
        window.currentTrainingState = currentState; // 전역 변수에 저장
        
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
                    console.log('[Individual] 훈련 세션 시작:', { userId: currentUserIdForSession, workoutId: lastWorkoutId || window.currentWorkout?.id });
                } else if (!currentUserIdForSession) {
                    console.warn('[Individual] 사용자 ID가 없어 세션을 시작할 수 없습니다.');
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
                // 세션 종료 처리
                if (window.trainingResults && typeof window.trainingResults.endSession === 'function') {
                    window.trainingResults.endSession();
                }
                
                // elapsedTime을 전역 변수에 저장 (저장 시 사용)
                if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
                    window.lastElapsedTime = status.elapsedTime;
                    console.log('[Individual] 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
                }
                
                // 훈련 결과 저장 및 팝업 표시
                if (window.trainingResults && typeof window.trainingResults.saveTrainingResult === 'function') {
                    // 워크아웃 ID 최종 확인 (Firebase에서 다시 한 번 확인)
                    db.ref(`sessions/${SESSION_ID}/workoutId`).once('value', (workoutIdSnapshot) => {
                        const finalWorkoutId = workoutIdSnapshot.val();
                        if (finalWorkoutId) {
                            if (!window.currentWorkout) {
                                window.currentWorkout = {};
                            }
                            window.currentWorkout.id = finalWorkoutId;
                            lastWorkoutId = finalWorkoutId;
                        }
                        
                        const extra = {
                            workoutId: finalWorkoutId || lastWorkoutId || window.currentWorkout?.id || null,
                            workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
                            userId: currentUserIdForSession,
                            elapsedTime: status.elapsedTime || window.lastElapsedTime || null // elapsedTime 전달
                        };
                        
                        console.log('[Individual] 훈련 결과 저장 시도, workoutId:', extra.workoutId, {
                            finalWorkoutId,
                            lastWorkoutId,
                            currentWorkoutId: window.currentWorkout?.id,
                            workoutName: extra.workoutName
                        });
                        
                        window.trainingResults.saveTrainingResult(extra)
                            .then((result) => {
                                console.log('[Individual] 훈련 결과 저장 완료:', result);
                                // 결과 팝업 표시
                                showTrainingResultModal(status);
                            })
                            .catch((error) => {
                                console.error('[Individual] 훈련 결과 저장 실패:', error);
                                // 저장 실패해도 팝업 표시 (로컬 데이터라도 있으면)
                                showTrainingResultModal(status);
                            });
                    }).catch((error) => {
                        console.error('[Individual] workoutId 조회 실패:', error);
                        // workoutId 조회 실패해도 저장 시도
                        const extra = {
                            workoutId: lastWorkoutId || window.currentWorkout?.id || null,
                            workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
                            userId: currentUserIdForSession,
                            elapsedTime: status.elapsedTime || window.lastElapsedTime || null
                        };
                        
                        window.trainingResults.saveTrainingResult(extra)
                            .then((result) => {
                                console.log('[Individual] 훈련 결과 저장 완료 (workoutId 조회 실패 후):', result);
                                showTrainingResultModal(status);
                            })
                            .catch((error) => {
                                console.error('[Individual] 훈련 결과 저장 실패:', error);
                                showTrainingResultModal(status);
                            });
                    });
                } else {
                    // trainingResults가 없어도 팝업 표시
                    showTrainingResultModal(status);
                }
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

// =========================================================
// UI 업데이트 함수들
// =========================================================

function updateDashboard(data) {
    // 1. 텍스트 업데이트
    // 파워값 가져오기 (다양한 필드명 지원)
    const power = Number(data.power || data.currentPower || data.watts || data.currentPowerW || 0);
    const powerValue = Math.round(power); // 정수로 변환
    
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

// 5초 카운트다운 상태 관리
let segmentCountdownActive = false;
let segmentCountdownTimer = null;
let lastCountdownValue = null;

// 랩카운트다운 업데이트 함수 (훈련방의 세그먼트 시간 경과값 표시)
function updateLapTime(status) {
    const lapTimeEl = document.getElementById('ui-lap-time');
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
    
    // 카운트다운 값 표시
    if (countdownValue !== null && countdownValue >= 0) {
        lapTimeEl.textContent = formatTime(countdownValue);
        // 10초 이하면 빨간색, 그 외는 청록색
        lapTimeEl.setAttribute('fill', countdownValue <= 10 ? '#ff4444' : '#00d4aa');
    } else {
        lapTimeEl.textContent = '00:00';
        lapTimeEl.setAttribute('fill', '#00d4aa');
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
        // 5초 이상이면 오버레이 표시하지 않음 (Firebase 동기화 지연 고려)
        if (countdownValue <= 5) {
            // 이전 값과 다르거나 카운트다운이 시작되지 않은 경우
            if (lastCountdownValue !== countdownValue || !segmentCountdownActive) {
                lastCountdownValue = countdownValue;
                // 0일 때는 "GO!!" 표시
                const displayValue = countdownValue === 0 ? 'GO!!' : countdownValue;
                showSegmentCountdown(displayValue);
            }
        }
        return;
    }
    
    // 세그먼트 카운트다운 처리 (기존 로직)
    // countdownValue가 유효하지 않거나 5초보다 크면 오버레이 숨김
    if (countdownValue === null || countdownValue > 5) {
        if (segmentCountdownActive) {
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
        // 0 미만이면 오버레이 숨김
        if (segmentCountdownActive) {
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
    
    // 오버레이 표시
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    
    // 숫자 또는 "GO!!" 업데이트
    numEl.textContent = String(value);
    
    // "GO!!"일 때 스타일 조정
    if (value === 'GO!!') {
        numEl.style.fontSize = '150px'; // GO!!는 조금 작게
        numEl.style.color = '#00d4aa'; // 민트색
    } else {
        numEl.style.fontSize = '200px'; // 기본 크기
        numEl.style.color = '#fff'; // 흰색
    }
    
    // 애니메이션 효과를 위해 클래스 재적용 (강제 리플로우)
    numEl.style.animation = 'none';
    setTimeout(() => {
        numEl.style.animation = '';
    }, 10);
    
    segmentCountdownActive = true;
    
    // 0 또는 "GO!!"일 때 0.8초 후 오버레이 숨김 (GO!!는 조금 더 길게 표시)
    if (value === 0 || value === 'GO!!') {
        setTimeout(() => {
            stopSegmentCountdown();
        }, 800);
    }
}

// 세그먼트 카운트다운 오버레이 숨김
function stopSegmentCountdown() {
    const overlay = document.getElementById('countdownOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    }
    
    if (segmentCountdownTimer) {
        clearInterval(segmentCountdownTimer);
        segmentCountdownTimer = null;
    }
    
    segmentCountdownActive = false;
    lastCountdownValue = null;
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
        targetPowerEl.textContent = String(adjustedTargetPower);
        targetPowerEl.setAttribute('fill', '#ff8c00');
        // 목표 파워 원호 업데이트
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // 2순위: 세그먼트 데이터로 계산 (Firebase targetPower가 없을 때만)
    // 워크아웃 데이터 확인
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        console.warn('[updateTargetPower] 워크아웃 데이터가 없습니다.');
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
    }
    
    // 강도 조절 비율 적용 (개인 훈련 대시보드 슬라이드 바)
    const adjustedTargetPower = Math.round(targetPower * individualIntensityAdjustment);
    
    console.log('[updateTargetPower] 최종 계산된 목표 파워:', targetPower, 'W');
    console.log('[updateTargetPower] 강도 조절 적용:', individualIntensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
    console.log('[updateTargetPower] 계산 상세: FTP =', ftp, ', target_type =', targetType, ', target_value =', targetValue);
    targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
    targetPowerEl.setAttribute('fill', '#ff8c00');
    
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

function updateSegmentGraph(segments, currentSegmentIndex = -1) {
    if (!segments || segments.length === 0) return;
    
    // workoutManager.js의 drawSegmentGraph 함수 사용
    if (typeof drawSegmentGraph === 'function') {
        // 컨테이너 크기가 확정된 후 그래프 그리기
        const drawGraph = () => {
            const canvas = document.getElementById('individualSegmentGraph');
            if (!canvas) {
                console.warn('[updateSegmentGraph] Canvas 요소를 찾을 수 없습니다.');
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
            drawSegmentGraph(segments, currentSegmentIndex, 'individualSegmentGraph', elapsedTime);
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
                    drawSegmentGraph(window.currentWorkout.segments, currentSegmentIndex, 'individualSegmentGraph', elapsedTime);
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
    
    console.log('[showTrainingResultModal] 최종 결과:', { duration_min, avgPower: stats.avgPower, np, tss, hrAvg: stats.avgHR, calories });
    
    // 모달 표시
    modal.classList.remove('hidden');
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
        return;
    }
    
    // LAP AVG 파워값 가져오기
    const lapPowerEl = document.getElementById('ui-lap-power');
    const lapPower = lapPowerEl ? Number(lapPowerEl.textContent) || 0 : 0;
    
    // 세그먼트 달성도 계산 (LAP AVG / 목표 파워)
    const achievementRatio = targetPower > 0 ? lapPower / targetPower : 0;
    
    // 색상 결정: 비율이 0.985 이상이면 민트색, 미만이면 주황색
    const arcColor = achievementRatio >= 0.985 
        ? 'rgba(0, 212, 170, 0.5)'  // 투명 민트색 (#00d4aa)
        : 'rgba(255, 140, 0, 0.5)'; // 투명 주황색
    
    // FTP 기반으로 최대 파워 계산
    const maxPower = userFTP * 2;
    if (maxPower <= 0) return;
    
    // 목표 파워 비율 계산 (0 ~ 1)
    const ratio = Math.min(Math.max(targetPower / maxPower, 0), 1);
    
    // 각도 계산: 180도(왼쪽 상단)에서 시작하여 각도가 증가하는 방향으로
    // ratio = 0 → 180도 (원호 없음)
    // ratio = 0.5 → 225도 (45도 범위, FTP × 0.5)
    // ratio = 1.0 → 270도 (90도 범위, FTP × 1.0)
    // ratio = 2.0 → 360도 (180도 범위, FTP × 2.0)
    const startAngle = 180;
    const endAngle = 180 + (ratio * 180);
    
    // SVG 원호 경로 생성
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    
    // 원호 시작점과 끝점 계산
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    const startX = centerX + radius * Math.cos(startRad);
    const startY = centerY + radius * Math.sin(startRad);
    const endX = centerX + radius * Math.cos(endRad);
    const endY = centerY + radius * Math.sin(endRad);
    
    // 원호가 큰지 작은지 판단 (180도 이상이면 large-arc-flag = 1)
    // 각도가 180도에서 360도로 증가하므로, 180도 이상이면 큰 원호
    const angleDiff = endAngle - startAngle;
    const largeArcFlag = angleDiff > 180 ? 1 : 0;
    
    // SVG path 생성
    // sweep-flag = 1: 시계 반대 방향 (각도 증가 방향: 180도 → 270도 → 360도)
    const pathData = `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
    
    // 목표 파워 원호 요소 가져오기 또는 생성
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
    
    // 원호 경로 및 색상 업데이트
    targetArc.setAttribute('d', pathData);
    targetArc.setAttribute('stroke', arcColor);
    targetArc.style.display = 'block';
    
    // 디버깅 로그 (선택사항)
    if (achievementRatio > 0) {
        console.log(`[updateTargetPowerArc] 달성도: ${(achievementRatio * 100).toFixed(1)}% (LAP: ${lapPower}W / 목표: ${targetPower}W), 색상: ${achievementRatio >= 0.985 ? '민트색' : '주황색'}`);
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