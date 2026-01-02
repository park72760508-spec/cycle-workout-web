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
        }
        
        // FTP 값 업데이트 (여러 필드명 지원)
        if (data.ftp !== undefined && data.ftp !== null && data.ftp !== '') {
            const ftpValue = Number(data.ftp);
            if (!isNaN(ftpValue) && ftpValue > 0) {
                userFTP = ftpValue;
                window.userFTP = ftpValue; // 전역 변수 업데이트
                console.log('[Firebase] FTP 값 업데이트:', userFTP, 'W');
            }
        }
        
        // 사용자 이름 업데이트
        updateUserName(data);
        updateDashboard(data);
        
        // TARGET 파워 업데이트
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
    
    // 여러 필드명 지원: userName, name, participantName
    const userName = data.userName || data.name || data.participantName || null;
    
    if (userName) {
        bikeIdDisplay.innerText = userName;
        
        // 사용자 ID도 저장 (세션 관리용)
        const userId = data.userId || data.id || null;
        if (userId) {
            currentUserIdForSession = userId;
            console.log('[Individual] 사용자 ID 저장:', currentUserIdForSession);
        }
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
 * Workout ID를 가져오는 헬퍼 함수
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
                    // 워크아웃 ID 가져오기 (헬퍼 함수 사용)
                    (async () => {
                        try {
                            // 헬퍼 함수를 사용하여 workoutId 가져오기 (Firebase에서도 확인)
                            const workoutId = await getWorkoutId();
                            
                            const extra = {
                                workoutId: workoutId,
                                workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
                                userId: currentUserIdForSession,
                                elapsedTime: status.elapsedTime || window.lastElapsedTime || null // elapsedTime 전달
                            };
                            
                            console.log('[Individual] 훈련 결과 저장 시도, workoutId:', extra.workoutId, {
                                workoutIdFromHelper: workoutId,
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
                        } catch (error) {
                            console.error('[Individual] workoutId 가져오기 실패:', error);
                            // workoutId 가져오기 실패해도 저장 시도 (동기 함수로 재시도)
                            const fallbackWorkoutId = getWorkoutIdSync();
                            const extra = {
                                workoutId: fallbackWorkoutId,
                                workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
                                userId: currentUserIdForSession,
                                elapsedTime: status.elapsedTime || window.lastElapsedTime || null
                            };
                            
                            console.log('[Individual] workoutId 가져오기 실패 후 동기 함수로 재시도, workoutId:', extra.workoutId);
                            
                            window.trainingResults.saveTrainingResult(extra)
                                .then((result) => {
                                    console.log('[Individual] 훈련 결과 저장 완료 (workoutId 가져오기 실패 후):', result);
                                    showTrainingResultModal(status);
                                })
                                .catch((error) => {
                                    console.error('[Individual] 훈련 결과 저장 실패:', error);
                                    showTrainingResultModal(status);
                                });
                        }
                    })();
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
        db.ref(`sessions/${SESSION_ID}/workoutId`).once('value', (workoutIdSnapshot) => {
            const workoutId = workoutIdSnapshot.val();
            if (workoutId) {
                window.currentWorkout.id = workoutId;
                lastWorkoutId = workoutId;
                console.log('[Individual] workoutPlan 업데이트 시 workoutId 확인:', workoutId);
            } else {
                console.warn('[Individual] workoutPlan은 있지만 workoutId를 찾을 수 없습니다.');
            }
        });
        
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
    
    // 2. 바늘 움직임은 startGaugeAnimationLoop에서 처리 (가민 스타일 부드러운 움직임)
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

function updateLapTime(status) {
    const lapTimeEl = document.getElementById('lap-time');
    if (!lapTimeEl) return;
    
    // 세그먼트 카운트다운 시간 계산
    let countdownValue = null;
    
    if (status.state === 'running' && window.currentWorkout && window.currentWorkout.segments) {
        const segIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
        if (segIndex >= 0 && segIndex < window.currentWorkout.segments.length) {
            const seg = window.currentWorkout.segments[segIndex];
            const segDuration = seg.duration_sec || seg.duration || 0;
            
            // segmentElapsedTime이 있으면 우선 사용
            if (status.segmentElapsedTime !== undefined && status.segmentElapsedTime !== null) {
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
    // 훈련 시작 전: countdownRemainingSec (전체 훈련 시작 카운트다운)
    else if (status.countdownRemainingSec !== undefined && status.countdownRemainingSec !== null && Number.isFinite(status.countdownRemainingSec)) {
        countdownValue = Math.max(0, Math.floor(status.countdownRemainingSec));
    }
    
    // 세그먼트 카운트다운 시간 로그 출력
    if (countdownValue !== null && countdownValue >= 0) {
        console.log('[updateLapTime] 세그먼트 카운트다운 시간:', countdownValue, '초');
    }
    
    // 카운트다운 표시
    if (countdownValue !== null && countdownValue >= 0) {
        // 5초 이하일 때만 카운트다운 표시
        if (countdownValue <= 5) {
            lapTimeEl.innerText = countdownValue.toString();
            lapTimeEl.style.color = '#ffaa00'; // 주황색
            lapTimeEl.style.fontSize = '48px'; // 큰 글씨
            lapTimeEl.style.fontWeight = 'bold';
            segmentCountdownActive = true;
        } else {
            // 5초 초과일 때는 일반 랩타임 표시
            const segIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            if (segIndex >= 0 && window.currentWorkout && window.currentWorkout.segments) {
                const seg = window.currentWorkout.segments[segIndex];
                const segDuration = seg.duration_sec || seg.duration || 0;
                
                // 세그먼트 경과 시간 계산
                let segElapsed = 0;
                if (status.segmentElapsedTime !== undefined && status.segmentElapsedTime !== null) {
                    segElapsed = Math.floor(status.segmentElapsedTime);
                } else if (status.elapsedTime !== undefined) {
                    let prevSegmentsTime = 0;
                    for (let i = 0; i < segIndex; i++) {
                        const prevSeg = window.currentWorkout.segments[i];
                        if (prevSeg) {
                            prevSegmentsTime += (prevSeg.duration_sec || prevSeg.duration || 0);
                        }
                    }
                    segElapsed = Math.max(0, status.elapsedTime - prevSegmentsTime);
                }
                
                lapTimeEl.innerText = formatTime(segElapsed);
                lapTimeEl.style.color = '#00d4aa'; // 민트색
                lapTimeEl.style.fontSize = '32px'; // 일반 크기
                lapTimeEl.style.fontWeight = 'normal';
                segmentCountdownActive = false;
            } else {
                lapTimeEl.innerText = '00:00';
                lapTimeEl.style.color = '#fff';
                lapTimeEl.style.fontSize = '32px';
                lapTimeEl.style.fontWeight = 'normal';
                segmentCountdownActive = false;
            }
        }
    } else {
        lapTimeEl.innerText = '00:00';
        lapTimeEl.style.color = '#fff';
        lapTimeEl.style.fontSize = '32px';
        lapTimeEl.style.fontWeight = 'normal';
        segmentCountdownActive = false;
    }
}

// 현재 세그먼트 가져오기
function getCurrentSegment() {
    if (!window.currentWorkout || !window.currentWorkout.segments) {
        return null;
    }
    
    if (currentSegmentIndex < 0 || currentSegmentIndex >= window.currentWorkout.segments.length) {
        return null;
    }
    
    return window.currentWorkout.segments[currentSegmentIndex];
}

// 세그먼트 정보 포맷팅
function formatSegmentInfo(targetType, targetValue) {
    if (!targetType || targetValue === undefined || targetValue === null) {
        return '';
    }
    
    if (targetType === 'ftp_pct') {
        return `${targetValue}% FTP`;
    } else if (targetType === 'cadence_rpm') {
        return `${targetValue} RPM`;
    } else if (targetType === 'dual') {
        // dual 타입: "100/120" 형식
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/');
            return `${parts[0]}% FTP / ${parts[1]} RPM`;
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            return `${targetValue[0]}% FTP / ${targetValue[1]} RPM`;
        } else {
            return `${targetValue}`;
        }
    } else {
        return `${targetValue}`;
    }
}

// TARGET 파워 업데이트
function updateTargetPower() {
    // Firebase에서 받은 targetPower 우선 사용
    if (firebaseTargetPower !== null && firebaseTargetPower !== undefined) {
        const targetPowerEl = document.getElementById('ui-target-power');
        if (targetPowerEl) {
            targetPowerEl.textContent = Math.round(firebaseTargetPower);
            targetPowerEl.setAttribute('fill', '#ffaa00'); // 주황색
        }
        return;
    }
    
    // Firebase targetPower가 없으면 현재 세그먼트에서 계산
    const currentSegment = getCurrentSegment();
    if (currentSegment) {
        const targetType = currentSegment.target_type || 'ftp_pct';
        let targetValue = currentSegment.target_value;
        
        let targetPower = 0;
        
        if (targetType === 'ftp_pct') {
            // FTP 백분율로 계산
            targetPower = userFTP * (targetValue / 100);
        } else if (targetType === 'dual') {
            // dual 타입: "100/120" 형식에서 첫 번째 값 사용
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                const ftpPercent = Number(parts[0]) || 100;
                targetPower = userFTP * (ftpPercent / 100);
            } else if (Array.isArray(targetValue) && targetValue.length > 0) {
                const ftpPercent = Number(targetValue[0]) || 100;
                targetPower = userFTP * (ftpPercent / 100);
            } else {
                // 숫자로 저장된 경우 (예: 100120)
                const numValue = Number(targetValue);
                if (numValue > 1000 && numValue < 1000000) {
                    const str = String(numValue);
                    if (str.length >= 4) {
                        const ftpPart = str.slice(0, -3);
                        const ftpPercent = Number(ftpPart) || 100;
                        targetPower = userFTP * (ftpPercent / 100);
                    }
                } else {
                    targetPower = userFTP * (numValue <= 1000 ? numValue / 100 : 1);
                }
            }
        } else if (targetType === 'cadence_rpm') {
            // RPM만 있는 경우 파워는 0 (또는 기본값)
            targetPower = 0;
        }
        
        const targetPowerEl = document.getElementById('ui-target-power');
        if (targetPowerEl) {
            targetPowerEl.textContent = Math.round(targetPower);
            targetPowerEl.setAttribute('fill', '#ffaa00'); // 주황색
        }
    } else {
        // 세그먼트가 없으면 기본값
        const targetPowerEl = document.getElementById('ui-target-power');
        if (targetPowerEl) {
            targetPowerEl.textContent = '0';
            targetPowerEl.setAttribute('fill', '#555');
        }
    }
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
    
    const ticks = [];
    const labels = [];
    
    // 0부터 1000까지 100 단위로 눈금 생성
    for (let i = 0; i <= 10; i++) {
        const value = i * 100;
        const angle = Math.PI - (i * Math.PI / 10); // 0도부터 180도까지
        
        const x1 = centerX + radius * Math.cos(angle);
        const y1 = centerY - radius * Math.sin(angle);
        const x2 = centerX + (radius - 8) * Math.cos(angle);
        const y2 = centerY - (radius - 8) * Math.sin(angle);
        
        ticks.push({ x1, y1, x2, y2, value });
        
        // 라벨 위치 (눈금보다 약간 더 안쪽)
        const labelX = centerX + (radius - 20) * Math.cos(angle);
        const labelY = centerY - (radius - 20) * Math.sin(angle);
        labels.push({ x: labelX, y: labelY, value });
    }
    
    return { ticks, labels };
}

// 속도계 초기화 및 애니메이션 루프
function startGaugeAnimationLoop() {
    // 기존 애니메이션 루프가 있으면 중지
    if (gaugeAnimationFrameId) {
        cancelAnimationFrame(gaugeAnimationFrameId);
    }
    
    const loop = () => {
        // 현재 파워값과 표시 파워값 사이의 보간 (가민 스타일 부드러운 움직임)
        const diff = currentPowerValue - displayPower;
        const step = diff * 0.15; // 15%씩 이동 (값이 클수록 더 빠르게)
        displayPower += step;
        
        // 바늘 각도 계산 (0W = 180도, 1000W = 0도)
        const maxPower = 1000;
        const normalizedPower = Math.min(Math.max(displayPower, 0), maxPower);
        const angle = Math.PI - (normalizedPower / maxPower) * Math.PI;
        
        // 바늘 끝점 계산
        const centerX = 100;
        const centerY = 140;
        const needleLength = 60;
        const needleX = centerX + needleLength * Math.cos(angle);
        const needleY = centerY - needleLength * Math.sin(angle);
        
        // SVG 바늘 업데이트
        const needle = document.getElementById('gauge-needle');
        if (needle) {
            needle.setAttribute('x2', needleX);
            needle.setAttribute('y2', needleY);
        }
        
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
    
    // 모달 표시
    modal.classList.remove('hidden');
    
    // 세션 데이터 가져오기
    const sessionData = window.trainingResults?.getCurrentSessionData?.() || {};
    
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
    
    // trainingMetrics가 있으면 우선 사용
    if (window.trainingMetrics && window.trainingMetrics.tss !== undefined && window.trainingMetrics.tss !== null) {
        tss = window.trainingMetrics.tss;
        console.log('[showTrainingResultModal] trainingMetrics.tss 사용:', tss);
    }
    if (window.trainingMetrics && window.trainingMetrics.np !== undefined && window.trainingMetrics.np !== null) {
        np = window.trainingMetrics.np;
        console.log('[showTrainingResultModal] trainingMetrics.np 사용:', np);
    }
    
    // trainingMetrics가 없으면 대체 계산 (elapsedTime 또는 totalSeconds 사용)
    if (!tss || tss === 0) {
        const userFtp = window.currentUser?.ftp || userFTP || 200;
        
        // NP가 없으면 평균 파워 * 1.05로 근사
        if (!np || np === 0) {
            np = (stats.avgPower || 0) * 1.05;
        }
        
        const IF = userFtp > 0 ? (np / userFtp) : 0;
        
        // TSS 계산: elapsedTime 우선 사용, 없으면 totalSeconds 사용
        const timeForTss = totalSeconds > 0 ? totalSeconds : (duration_min * 60);
        tss = (timeForTss / 3600) * (IF * IF) * 100;
        console.log('[showTrainingResultModal] TSS 계산 (대체):', { totalSeconds, duration_min, timeForTss, np, IF, tss, userFtp, avgPower: stats.avgPower });
    }
    
    // 값 반올림 및 최소값 보장
    tss = Math.max(0, Math.round(tss * 100) / 100);
    np = Math.max(0, Math.round(np * 10) / 10);
    
    // 칼로리 계산 (평균 파워 * 시간(분) * 0.0143)
    const calories = Math.round((stats.avgPower || 0) * duration_min * 0.0143);
    
    // UI 업데이트
    const resultDuration = document.getElementById('result-duration');
    const resultAvgPower = document.getElementById('result-avg-power');
    const resultNP = document.getElementById('result-np');
    const resultTSS = document.getElementById('result-tss');
    const resultHr = document.getElementById('result-hr');
    const resultCalories = document.getElementById('result-calories');
    
    if (resultDuration) {
        const hours = Math.floor(duration_min / 60);
        const minutes = duration_min % 60;
        resultDuration.textContent = hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
    }
    
    if (resultAvgPower) {
        resultAvgPower.textContent = Math.round(stats.avgPower || 0);
    }
    
    if (resultNP) {
        resultNP.textContent = np.toFixed(1);
    }
    
    if (resultTSS) {
        resultTSS.textContent = tss.toFixed(2);
    }
    
    if (resultHr) {
        resultHr.textContent = Math.round(stats.avgHr || 0);
    }
    
    if (resultCalories) {
        resultCalories.textContent = calories;
    }
}

// 속도계 애니메이션 시작
startGaugeAnimationLoop();
