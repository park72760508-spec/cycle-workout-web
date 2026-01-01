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

document.getElementById('bike-id-display').innerText = `Bike ${myBikeId}`;

// 2. Firebase 데이터 구독 (내 자전거 데이터)
// SESSION_ID는 firebaseConfig.js에 정의됨
db.ref(`sessions/${SESSION_ID}/users/${myBikeId}`).on('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
        updateDashboard(data);
    } else {
        // 데이터가 없으면 (연결 안됨)
        document.getElementById('ui-current-power').innerText = '-';
        document.getElementById('ui-current-power').style.fill = '#555';
    }
});

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
    }
});

// =========================================================
// UI 업데이트 함수들
// =========================================================

function updateDashboard(data) {
    // 1. 텍스트 업데이트
    const power = data.power || 0;
    
    document.getElementById('ui-current-power').innerText = power;
    document.getElementById('ui-current-power').style.fill = '#fff';
    
    // TARGET 파워는 세그먼트 정보에서 계산
    updateTargetPower();
    
    document.getElementById('ui-cadence').innerText = data.cadence || 0;
    document.getElementById('ui-hr').innerText = data.hr || 0;
    
    // 랩파워 표시 (세그먼트 평균 파워)
    const lapPower = data.segmentPower || data.avgPower || 0;
    document.getElementById('ui-lap-power').innerText = Math.round(lapPower);

    // 2. 게이지 바늘 회전
    // FTP를 알 수 없으므로 300W를 풀 스케일(100%)로 가정하거나, 
    // 방장이 maxPower를 보내주면 더 좋음. 여기선 400W 기준.
    const maxGauge = 400; 
    let ratio = power / maxGauge;
    if (ratio > 1) ratio = 1;
    if (ratio < 0) ratio = 0;
    
    // -90도(왼쪽) ~ 90도(오른쪽)
    const angle = -90 + (ratio * 180);
    
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
        timerEl.innerText = formatTime(totalSeconds);
        timerEl.style.color = '#00d4aa'; // 실행중 색상
    } else if (status.state === 'paused') {
        timerEl.style.color = '#ffaa00'; // 일시정지 색상
    } else {
        timerEl.innerText = "00:00";
        timerEl.style.color = '#fff';
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

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
    
    // 카운트다운 값 표시
    if (countdownValue !== null && countdownValue >= 0) {
        lapTimeEl.innerText = formatTime(countdownValue);
        // 10초 이하면 빨간색, 그 외는 청록색
        lapTimeEl.style.fill = countdownValue <= 10 ? '#ff4444' : '#00d4aa';
    } else {
        lapTimeEl.innerText = '00:00';
        lapTimeEl.style.fill = '#00d4aa';
    }
}

// TARGET 파워 업데이트 함수 (세그먼트 목표값 계산)
function updateTargetPower() {
    const targetPowerEl = document.getElementById('ui-target-power');
    if (!targetPowerEl) return;
    
    if (window.currentWorkout && window.currentWorkout.segments && currentSegmentIndex >= 0) {
        const seg = window.currentWorkout.segments[currentSegmentIndex];
        if (seg) {
            // FTP 값 가져오기 (기본값 200W)
            const ftp = 200; // 개인 대시보드에서는 FTP를 알 수 없으므로 기본값 사용
            
            // 세그먼트 목표 파워 계산
            let targetPower = 0;
            
            // target_type에 따라 계산
            const targetType = seg.target_type || 'ftp_pct';
            const targetValue = seg.target_value;
            
            if (targetType === 'ftp_pct') {
                const ftpPercent = Number(targetValue) || 100;
                targetPower = Math.round(ftp * (ftpPercent / 100));
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
            
            targetPowerEl.innerText = targetPower > 0 ? targetPower : '-';
        } else {
            targetPowerEl.innerText = '-';
        }
    } else {
        targetPowerEl.innerText = '-';
    }
}

// 세그먼트 그래프 업데이트 함수
function updateSegmentGraph(segments, currentSegmentIndex = -1) {
    if (!segments || segments.length === 0) return;
    
    // workoutManager.js의 drawSegmentGraph 함수 사용
    if (typeof drawSegmentGraph === 'function') {
        // 개인 대시보드용으로 작은 크기로 조정
        setTimeout(() => {
            drawSegmentGraph(segments, currentSegmentIndex, 'individualSegmentGraph');
        }, 100);
    } else {
        console.warn('[Individual] drawSegmentGraph 함수를 찾을 수 없습니다.');
    }
}