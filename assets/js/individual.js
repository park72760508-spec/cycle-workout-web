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
db.ref(`sessions/${SESSION_ID}/status`).on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
        updateTimer(status);
        
        // 세그먼트 정보 표시
        const segIdx = status.segmentIndex + 1; // 0부터 시작하므로 +1
        document.getElementById('segment-info').innerText = status.state === 'running' 
            ? `Segment ${segIdx}` 
            : (status.state === 'paused' ? '일시정지' : '대기 중');
    }
});

// =========================================================
// UI 업데이트 함수들
// =========================================================

function updateDashboard(data) {
    // 1. 텍스트 업데이트
    const power = data.power || 0;
    const target = data.targetPower || 0;
    
    document.getElementById('ui-current-power').innerText = power;
    document.getElementById('ui-current-power').style.fill = '#fff';
    
    document.getElementById('ui-target-power').innerText = target > 0 ? target : '-';
    
    document.getElementById('ui-cadence').innerText = data.cadence || 0;
    document.getElementById('ui-hr').innerText = data.hr || 0;
    document.getElementById('ui-lap-power').innerText = data.segmentPower || 0;

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