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

// Firebase에서 받은 목표 파워 값 저장 (전역 변수)
let firebaseTargetPower = null;

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
db.ref(`sessions/${SESSION_ID}/status`).on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
        updateTimer(status);
        
        // 세그먼트 정보 표시
        currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
        const segIdx = currentSegmentIndex + 1; // 0부터 시작하므로 +1
        document.getElementById('segment-info').innerText = status.state === 'running' 
            ? `Segment ${segIdx}` 
            : (status.state === 'paused' ? '일시정지' : '대기 중');
        
        // 랩타임 카운트다운 업데이트
        updateLapTime(status);
        
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
        window.currentWorkout = {
            segments: segments
        };
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
    
    // SVG text 요소는 textContent 사용 (innerText보다 안정적)
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

    // 2. 게이지 바늘 회전 (동일한 power 값 사용)
    // 위쪽 반원에 맞춰 -90도(왼쪽 상단) ~ 90도(오른쪽 상단)로 회전
    // FTP를 알 수 없으므로 300W를 풀 스케일(100%)로 가정하거나, 
    // 방장이 maxPower를 보내주면 더 좋음. 여기선 400W 기준.
    const maxGauge = 400; 
    let ratio = powerValue / maxGauge;
    if (ratio > 1) ratio = 1;
    if (ratio < 0) ratio = 0;
    
    // -90도(왼쪽 상단) ~ 90도(오른쪽 상단) - 위쪽 반원
    // 바늘은 기본적으로 rotate(-90)이 적용되어 있으므로
    // -90도에서 시작하여 90도까지 회전 (-90도 ~ 90도)
    const angle = -90 + (ratio * 180); // -90도에서 시작하여 180도 범위 회전 (-90도 ~ 90도)
    
    const needle = document.getElementById('gauge-needle');
    if (needle) {
        // 부드러운 움직임을 위해 CSS transition 사용 가능 (여기선 JS로 직접 제어)
        needle.setAttribute('transform', `translate(100, 140) rotate(${angle})`);
    }
}

function updateTimer(status) {
    const timerEl = document.getElementById('main-timer');
    
    if (status.state === 'running') {
        // 방장이 계산해서 보내준 elapsedTime 사용 (가장 정확)
        const totalSeconds = status.elapsedTime || 0;
        timerEl.innerText = formatHMS(totalSeconds); // hh:mm:ss 형식
        timerEl.style.color = '#00d4aa'; // 실행중 색상
    } else if (status.state === 'paused') {
        timerEl.style.color = '#ffaa00'; // 일시정지 색상
    } else {
        timerEl.innerText = "00:00:00";
        timerEl.style.color = '#fff';
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
    
    // 숫자 업데이트
    numEl.textContent = String(value);
    
    // 애니메이션 효과를 위해 클래스 재적용 (강제 리플로우)
    numEl.style.animation = 'none';
    setTimeout(() => {
        numEl.style.animation = '';
    }, 10);
    
    segmentCountdownActive = true;
    
    // 0초일 때 0.5초 후 오버레이 숨김
    if (value === 0) {
        setTimeout(() => {
            stopSegmentCountdown();
        }, 500);
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
        console.log('[updateTargetPower] Firebase targetPower 값 사용:', firebaseTargetPower, 'W');
        targetPowerEl.textContent = String(Math.round(firebaseTargetPower));
        targetPowerEl.setAttribute('fill', '#ff8c00');
        return;
    }
    
    // 2순위: 세그먼트 데이터로 계산 (Firebase targetPower가 없을 때만)
    // 워크아웃 데이터 확인
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        console.warn('[updateTargetPower] 워크아웃 데이터가 없습니다.');
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
        return;
    }
    
    // 현재 세그먼트 인덱스 확인
    if (currentSegmentIndex < 0 || currentSegmentIndex >= window.currentWorkout.segments.length) {
        console.warn('[updateTargetPower] 유효하지 않은 세그먼트 인덱스:', currentSegmentIndex, '세그먼트 개수:', window.currentWorkout.segments.length);
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
        return;
    }
    
    const seg = window.currentWorkout.segments[currentSegmentIndex];
    if (!seg) {
        console.warn('[updateTargetPower] 세그먼트 데이터가 없습니다. 인덱스:', currentSegmentIndex);
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
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
    
    console.log('[updateTargetPower] 최종 계산된 목표 파워:', targetPower, 'W');
    console.log('[updateTargetPower] 계산 상세: FTP =', ftp, ', target_type =', targetType, ', target_value =', targetValue);
    targetPowerEl.textContent = targetPower > 0 ? String(targetPower) : '0';
    targetPowerEl.setAttribute('fill', '#ff8c00');
}

// 세그먼트 그래프 업데이트 함수
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
            
            // 그래프 그리기
            drawSegmentGraph(segments, currentSegmentIndex, 'individualSegmentGraph');
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
        { index: 3, mult: 1, color: '#00d4aa' }, // 민트색
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
    document.addEventListener('DOMContentLoaded', updateGaugeTicksAndLabels);
} else {
    // DOM이 이미 로드되었으면 바로 실행
    updateGaugeTicksAndLabels();
}