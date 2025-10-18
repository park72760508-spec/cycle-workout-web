/* ==========================================================
   app.js (v1.4 fixed) - 모든 오류 수정이 반영된 통합 버전
========================================================== */

// ========== 전역 변수 안전 초기화 (파일 최상단) ==========
(function initializeGlobals() {
  // liveData 객체 안전 초기화
  if (!window.liveData) {
    window.liveData = {
      power: 0,
      cadence: 0,
      heartRate: 0,
      targetPower: 0
    };
  }

  // currentUser 안전 초기화
  if (!window.currentUser) {
    window.currentUser = null;
  }

  // currentWorkout 안전 초기화
  if (!window.currentWorkout) {
    window.currentWorkout = null;
  }

  // trainingState 안전 초기화
  if (!window.trainingState) {
    window.trainingState = {
      timerId: null,
      paused: false,
      elapsedSec: 0,
      segIndex: 0,
      segElapsedSec: 0,
      segEnds: [],
      totalSec: 0
    };
  }

  // connectedDevices 안전 초기화
  if (!window.connectedDevices) {
    window.connectedDevices = {
      trainer: null,
      powerMeter: null,
      heartRate: null
    };
  }

  console.log('Global variables initialized safely');
})();

// 🔥 새로운 검색 함수 추가 (app.js 상단에)
function searchUsersByPhoneLastFour(searchDigits) {
    console.log('=== 사용자 검색 함수 실행 ===');
    console.log('검색할 뒷자리:', searchDigits);
    
    if (!window.users || window.users.length === 0) {
        console.log('❌ 사용자 데이터가 없습니다');
        return [];
    }
    
    console.log('전체 사용자 수:', window.users.length);
    
    const results = window.users.filter(user => {
        // 안전한 처리
        if (!user.contact) {
            console.log(`⚠️ ${user.name}: 전화번호 없음`);
            return false;
        }
        
        // 문자열 변환 및 정제
        const contactStr = String(user.contact);
        const cleanContact = contactStr.replace(/[-\s]/g, '');
        const userLastFour = cleanContact.slice(-4);
        
        console.log(`검사: ${user.name} - "${user.contact}" → "${cleanContact}" → "${userLastFour}"`);
        
        const isMatch = userLastFour === String(searchDigits);
        if (isMatch) {
            console.log(`✅ 매칭됨: ${user.name}`);
        }
        
        return isMatch;
    });
    
    console.log('검색 결과:', results.length, '명');
    return results;
}

// ========== 안전 접근 헬퍼 함수들 ==========
function safeGetElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`Element with id '${id}' not found`);
  }
  return element;
}

function safeSetText(id, text) {
  const element = safeGetElement(id);
  if (element) {
    element.textContent = text;
  }
}

// ========== 기존 변수들 유지 ==========
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

function normalizeType(seg){
  const t = (seg.segment_type || seg.label || "").toString().toLowerCase();
  if (t.includes("warm")) return "warmup";
  if (t.includes("cool")) return "cooldown";
  if (t.includes("rest") || t.includes("recover")) return "rest";
  if (t.includes("sweet")) return "sweetspot";
  if (t.includes("tempo")) return "tempo";
  return "interval"; // 기본값
}

// 세그먼트 카운트다운 상태 관리 (전역)
let segmentCountdownActive = false;
let segmentCountdownTimer = null;
let countdownTriggered = []; // 세그먼트별 카운트다운 트리거 상태

// 세그먼트 카운트다운 함수 (수정된 버전)
async function startSegmentCountdown(remainingSeconds, nextSegment) {
  console.log(`카운트다운 요청: ${remainingSeconds}초, 현재 상태: ${segmentCountdownActive}`);
  
  if (segmentCountdownActive) {
    console.log('이미 카운트다운이 실행 중입니다.');
    return;
  }
  
  segmentCountdownActive = true;
  
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  
  if (!overlay || !num) {
    console.warn('카운트다운 오버레이를 찾을 수 없습니다.');
    segmentCountdownActive = false;
    return;
  }

  // 오버레이 표시
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";
  
  // 다음 세그먼트 정보 표시
  const nextSegmentInfo = nextSegment ? 
    `다음: ${nextSegment.label || nextSegment.segment_type} FTP ${getSegmentFtpPercent(nextSegment)}%` : 
    '훈련 완료';
    
  // 다음 세그먼트 정보 엘리먼트 생성/업데이트
  let infoDiv = document.getElementById('nextSegmentInfo');
  if (!infoDiv) {
    infoDiv = document.createElement('div');
    infoDiv.id = 'nextSegmentInfo';
    infoDiv.style.cssText = `
      position: absolute;
      bottom: 30%;
      left: 50%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 18px;
      font-weight: 600;
      text-align: center;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
      opacity: 0.9;
    `;
    overlay.appendChild(infoDiv);
  }
  infoDiv.textContent = nextSegmentInfo;

  let remain = remainingSeconds;
  
  // 초기 표시 및 첫 번째 삐 소리
  num.textContent = remain;
  console.log(`카운트다운 시작: ${remain}초`);
  playBeep(880, 120, 0.25);

  segmentCountdownTimer = setInterval(() => {
    remain -= 1;
    console.log(`카운트다운: ${remain}초 남음`);
    
    if (remain > 0) {
      // 1, 2, 3, 4초일 때 - 일반 삐 소리
      num.textContent = remain;
      playBeep(880, 120, 0.25);
      
    } else if (remain === 0) {
      // 0초일 때 - 화면에 "0" 표시하고 강조 삐 소리
      num.textContent = "0";
      console.log('카운트다운 0초 - 강조 소리 재생 시작');
      
      // 중요: await 제거하고 바로 playBeep 호출
      playBeep(1500, 700, 0.35, "square").then(() => {
        console.log('강조 소리 재생 완료');
      }).catch(err => {
        console.error('강조 소리 재생 실패:', err);
      });
      
      // 타이머 먼저 정리 (소리 재생과 분리)
      clearInterval(segmentCountdownTimer);
      segmentCountdownTimer = null;
      
      // 0.7초 후 오버레이 닫기 (소리 재생 시간 고려)
      setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        segmentCountdownActive = false;
        console.log('카운트다운 오버레이 닫힘');
      }, 700);
      
    } else {
      // remain < 0일 때 - 안전장치
      console.log('카운트다운 안전장치 실행');
      clearInterval(segmentCountdownTimer);
      segmentCountdownTimer = null;
      overlay.classList.add("hidden");
      overlay.style.display = "none";
      segmentCountdownActive = false;
    }
  }, 1000);
}

// 참고: 기존 훈련 시작 카운트다운도 동일한 방식으로 개선 (선택)
function startWithCountdown(sec = 5) {
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  
  if (!overlay || !num) {
    console.warn('Countdown elements not found, starting workout directly');
    return startWorkoutTraining();
  }

  console.log(`Starting ${sec}s countdown...`);

  // 오버레이 확실히 표시
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";

  let remain = sec;
  
  // 초기 표시 및 첫 번째 삐 소리
  num.textContent = remain;
  playBeep(880, 120, 0.25);

  const timer = setInterval(async () => {
    remain -= 1;

    if (remain > 0) {
      // 1, 2, 3, 4초일 때 - 일반 삐 소리
      num.textContent = remain;
      playBeep(880, 120, 0.25);
    } else if (remain === 0) {
      // 0초일 때 - 화면에 "0" 표시하고 강조 삐 소리
      num.textContent = "0";
      
      try {
        await playBeep(1500, 700, 0.35, "square");
      } catch (e) {
        console.warn('Failed to play beep:', e);
      }
      
      // 0.5초 추가 대기 후 오버레이 닫기 및 훈련 시작
      setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        console.log('Countdown finished, starting workout...');
        startWorkoutTraining();
      }, 500);
      
      // 타이머 정리
      clearInterval(timer);
      
    } else {
      // remain < 0일 때 - 안전장치
      console.warn('Countdown safety mechanism triggered');
      clearInterval(timer);
      overlay.classList.add("hidden");
      overlay.style.display = "none";
      startWorkoutTraining();
    }
  }, 1000);
}

// 카운트다운 강제 정지 함수
function stopSegmentCountdown() {
  console.log('카운트다운 강제 정지');
  if (segmentCountdownTimer) {
    clearInterval(segmentCountdownTimer);
    segmentCountdownTimer = null;
  }
  
  const overlay = document.getElementById("countdownOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }
  
  segmentCountdownActive = false;
}

// 세그먼트 건너뛰기 시에도 카운트다운 정리
function skipCurrentSegment() {
  try {
    const w = window.currentWorkout;
    if (!w || !w.segments) {
      console.warn('No workout or segments available for skipping');
      return;
    }
    
    // 활성 카운트다운 정지
    if (segmentCountdownActive) {
      stopSegmentCountdown();
    }
    
    // 해당 세그먼트의 카운트다운 트리거 상태도 리셋
    if (countdownTriggered && window.trainingState.segIndex < countdownTriggered.length) {
      countdownTriggered[window.trainingState.segIndex] = true; // 건너뛴 것으로 표시
    }
    
    // 다음 세그먼트로 이동
    const newIndex = Math.min(w.segments.length - 1, (window.trainingState?.segIndex || 0) + 1);
    if (window.trainingState) {
      window.trainingState.segIndex = newIndex;
      window.trainingState.segElapsedSec = 0;
    }
    
    if (typeof applySegmentTarget === 'function') {
      applySegmentTarget(newIndex);
    }
    if (typeof updateTimeUI === 'function') {
      updateTimeUI();
    }
    
    console.log(`세그먼트 건너뛰기: ${newIndex + 1}번째 세그먼트로 이동`);
    
    if (typeof showToast === 'function') {
      showToast(`세그먼트 ${newIndex + 1}로 건너뛰기`);
    }
    
  } catch (error) {
    console.error('Error in skipCurrentSegment:', error);
  }
}

// 훈련 화면의 세그먼트에서 FTP 백분율 추출하는 헬퍼 함수 추가
function getSegmentFtpPercent(seg) {
  if (!seg) return 0;
  
  // 1순위: target_value (이미 퍼센트)
  if (typeof seg.target_value === "number") {
    return Math.round(seg.target_value);
  }
  
  // 2순위: ftp_percent (이미 퍼센트)
  if (typeof seg.ftp_percent === "number") {
    return Math.round(seg.ftp_percent);
  }
  
  // 3순위: target (0~1 비율을 퍼센트로 변환)
  if (typeof seg.target === "number") {
    return Math.round(seg.target * 100);
  }
  
  console.warn('FTP 백분율을 찾을 수 없습니다:', seg);
  return 100; // 기본값
}

// 훈련 지표 상태 (TSS / kcal / NP 근사)
const trainingMetrics = {
  elapsedSec: 0,      // 전체 경과(초)
  joules: 0,          // 누적 일(줄). 1초마다 W(=J/s)를 더해줌
  ra30: 0,            // 30초 롤링 평균 파워(근사: 1차 IIR)
  np4sum: 0,          // (ra30^4)의 누적 합
  count: 0            // 표본 개수(초 단위)
};

// 타임라인 생성/업데이트 함수 추가
function secToMinStr(sec){
  const m = Math.floor(sec/60);
  return `${m}분`;
}

// Beep 사운드 (Web Audio)
let __beepCtx = null;

// 오디오 컨텍스트 초기화 함수 개선
async function ensureBeepContext() {
  try {
    if (!window.AudioContext && !window.webkitAudioContext) {
      console.warn('Web Audio API not supported');
      return false;
    }

    if (!__beepCtx) {
      __beepCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('New audio context created');
    }
    
    if (__beepCtx.state === "suspended") {
      await __beepCtx.resume();
      console.log('Audio context resumed');
    }
    
    return __beepCtx.state === "running";
    
  } catch (error) {
    console.error('Audio context initialization failed:', error);
    __beepCtx = null;
    return false;
  }
}

// 향상된 playBeep 함수 (더 안정적인 오디오 재생)
async function playBeep(freq = 880, durationMs = 120, volume = 0.2, type = "sine") {
  try {
    console.log(`Beep 재생 시도: ${freq}Hz, ${durationMs}ms, ${volume} 볼륨, ${type} 타입`);
    
    const contextReady = await ensureBeepContext();
    if (!contextReady) {
      console.warn('Audio context not available for beep');
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
    
    console.log(`Beep 재생 성공: ${freq}Hz`);
    
    // Promise로 재생 완료 시점 반환
    return new Promise(resolve => {
      setTimeout(resolve, durationMs);
    });
    
  } catch (error) {
    console.error('Beep 재생 실패:', error);
  }
}

// 시간 포맷: 75 -> "01:15"
function formatMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

// 훈련 상태 => 타임라인 생성 (initializeTraining 내부에서 호출)
function createTimeline(){
  const cont = document.getElementById("timelineSegments");
  if (!cont || !currentWorkout) return;

  const segs = currentWorkout.segments || [];
  const total = segs.reduce((s, seg)=> s + (seg.duration_sec||0), 0) || 1;

  // 누적 종료시각(초)도 계산해두면 편함
  trainingSession._segEnds = [];
  let acc = 0;

  cont.innerHTML = segs.map((seg, i)=>{
    const dur = seg.duration_sec || 0;
    acc += dur; trainingSession._segEnds[i] = acc;
    const w = (dur / total) * 100;
    const label = seg.segment_type || "세그먼트";
    return `
      <div class="timeline-segment" data-index="${i}" style="width:${w}%">
        <div class="progress-fill" id="segFill-${i}"></div>
        <span class="segment-label">${label}</span>
        <span class="segment-time">${secToMinStr(dur)}</span>
      </div>`;
  }).join("");
}

// 훈련 상태 => 세그먼트별 달성도를 시간 기준 달성도(=진행률)로 표현
function updateTimelineByTime(){
  if (!trainingSession.startTime || !currentWorkout) return;

  const nowSec = Math.floor((Date.now() - trainingSession.startTime) / 1000);
  const segs = currentWorkout.segments || [];
  let startAt = 0;

  for (let i=0;i<segs.length;i++){
    const dur = segs[i].duration_sec || 0;
    const endAt = startAt + dur;
    const fill = document.getElementById(`segFill-${i}`);
    if (!fill){ startAt = endAt; continue; }

    let pct = 0;
    if (nowSec >= endAt) pct = 100;                   // 지난 세그먼트
    else if (nowSec <= startAt) pct = 0;              // 아직 시작 전
    else pct = Math.min(100, Math.round((nowSec - startAt) / dur * 100)); // 현재 세그먼트 진행

    fill.style.width = pct + "%";
    startAt = endAt;
  }
}

// 훈련 상태 => 현재 세그먼트 전환 시 색/타이틀 업데이트
function onSegmentChanged(newIndex){
  const seg = currentWorkout.segments[newIndex];
  if (!seg) return;
  const ftp = currentUser?.ftp || 200;
  liveData.targetPower = Math.round(ftp * (seg.ftp_percent/100));
  const nameEl = document.getElementById("currentSegmentName");
  if (nameEl) nameEl.textContent = `${seg.segment_type || "세그먼트"} - FTP ${seg.ftp_percent}%`;
  updateTrainingDisplay();
}

// 훈련 상태 => 시간 달성도
function colorFillByPower(i, avg, target){
  const el = document.getElementById(`segFill-${i}`);
  if (!el) return;
  const ratio = target>0 ? (avg/target) : 0;
  // 90% 미만 주황, 110% 초과 빨강, 그 외 파랑 등 자유롭게
  if (ratio < 0.9) el.style.background = "#F56500";
  else if (ratio > 1.1) el.style.background = "#DC3545";
  else el.style.background = "#2E74E8";
}

// 달성도 색상: 목표 대비 평균 파워 비율(ratio)
function colorByAchievement(ratio){
  if (!isFinite(ratio) || ratio <= 0) return "#3b82f6"; // 기본 파랑
  if (ratio < 0.9)  return "#f59e0b"; // 부족(주황)
  if (ratio > 1.1)  return "#ef4444"; // 과도(빨강)
  return "#22c55e";                   // 적정(초록)
}

// 세그먼트 바 상태(전역)
const segBar = {
  totalSec: 0,     // 전체 운동 시간(초)
  ends: [],        // 각 세그먼트의 누적 종료시각(초)
  sumPower: [],    // 세그먼트별 평균 파워 계산용 합
  samples: [],     // 세그먼트별 표본 수(초)
};

// 초 → "m분" 짧은 표기
function secToMinShort(sec){ return `${Math.floor((sec||0)/60)}분`; }

// 세그먼트 duration(초) 추출
// 1. 세그먼트 지속시간 추출 함수 수정 (통일된 방식)
function segDurationSec(seg) {
  if (!seg) return 0;
  
  // duration_sec 우선, 없으면 duration 사용
  if (typeof seg.duration_sec === "number") {
    return Math.max(0, Math.floor(seg.duration_sec));
  }
  if (typeof seg.duration === "number") {
    return Math.max(0, Math.floor(seg.duration));
  }
  
  console.warn('세그먼트 지속시간을 찾을 수 없습니다:', seg);
  return 300; // 기본값 5분
}

// 목표 파워(W)
function segTargetW(seg, ftp) {
  const ftpPercent = getSegmentFtpPercent(seg);
  return Math.round(ftp * (ftpPercent / 100));
}

// 세그먼트 바 생성
// app.js의 buildSegmentBar 함수를 대체
// app.js의 buildSegmentBar 함수 대체
function buildSegmentBar(){
  const cont = document.getElementById("timelineSegments");
  const w = window.currentWorkout;
  if (!cont || !w) return;

  const segs = w.segments || [];
  const total = segs.reduce((s, seg)=> s + segDurationSec(seg), 0) || 1;

  // 그룹화된 세그먼트 생성 (workoutManager.js 함수 활용)
  const groupedSegments = typeof window.detectAndGroupSegments === 'function' 
    ? window.detectAndGroupSegments(segs) 
    : segs.map((seg, i) => ({ type: 'single', segment: seg, originalIndex: i }));

  segBar.totalSec = total;
  segBar.ends = [];
  segBar.sumPower = Array(segs.length).fill(0);
  segBar.samples  = Array(segs.length).fill(0);

  // 누적 종료시각 계산 (원본 세그먼트 기준)
  let acc = 0;
  segs.forEach((seg, i) => {
    const dur = segDurationSec(seg);
    acc += dur; 
    segBar.ends[i] = acc;
  });

  // 그룹화된 세그먼트를 렌더링
  cont.innerHTML = groupedSegments.map((item, groupIndex) => {
    if (item.type === 'single') {
      const seg = item.segment;
      const dur = segDurationSec(seg);
      const widthPct = (dur / total) * 100;
      const type = normalizeType(seg);
      const segmentNumber = item.originalIndex + 1; // 순번
      const timeMinutes = Math.floor(dur / 60);
      const timeSeconds = dur % 60;
      const timeLabel = timeSeconds > 0 ? `${timeMinutes}:${timeSeconds.toString().padStart(2, '0')}` : `${timeMinutes}분`;
      
      return `
        <div class="timeline-segment" data-index="${item.originalIndex}" data-type="${type}" 
             data-group-type="single" style="width:${widthPct}%"
             aria-label="세그먼트 ${segmentNumber} · ${timeLabel}">
          <div class="progress-fill" id="segFill-${item.originalIndex}"></div>
          <div class="segment-labels">
            <span class="segment-number">#${segmentNumber}</span>
            <span class="segment-time">${timeLabel}</span>
          </div>
        </div>
      `;
    } else {
      // 그룹화된 세그먼트 (반복)
      const { pattern, repeatCount, totalDuration, startIndex, endIndex } = item;
      const widthPct = (totalDuration / total) * 100;
      const mainType = normalizeType(pattern[0]);
      const timeMinutes = Math.round(totalDuration / 60);
      const timeLabel = `${timeMinutes}분`;
      const groupNumber = `G${groupIndex + 1}`; // 그룹 번호
      
      return `
        <div class="timeline-segment timeline-group" data-group-index="${groupIndex}" 
             data-type="${mainType}" data-group-type="grouped" style="width:${widthPct}%"
             data-start-index="${startIndex}" data-end-index="${endIndex}"
             aria-label="반복 그룹 ${groupNumber} × ${repeatCount}회 · ${timeLabel}">
          <div class="progress-fill" id="groupFill-${groupIndex}"></div>
          <div class="segment-labels">
            <span class="segment-number">${groupNumber}</span>
            <span class="repeat-count">×${repeatCount}</span>
            <span class="segment-time">${timeLabel}</span>
          </div>
        </div>
      `;
    }
  }).filter(Boolean).join('');
}

// 메인 업데이트 함수(1초마다 호출):
// app.js의 updateSegmentBarTick 함수를 대체
// app.js의 updateSegmentBarTick 함수 대체 - 달성도 기반 색상 적용
function updateSegmentBarTick(){
  const w = window.currentWorkout;
  const ftp = (window.currentUser?.ftp) || 200;
  if (!w || !w.segments) return;

  const elapsed = window.trainingState.elapsedSec || 0;
  const segIndex = window.trainingState.segIndex || 0;

  // 1) 개별 세그먼트 진행률 업데이트
  let startAt = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg);
    const endAt = startAt + dur;
    const fill = document.getElementById(`segFill-${i}`);
    
    if (fill) {
      let ratio = 0;
      if (elapsed >= endAt) {
        ratio = 1; // 완료된 세그먼트
      } else if (elapsed > startAt) {
        ratio = (elapsed - startAt) / dur; // 진행 중인 세그먼트
      }
      // else ratio = 0 (아직 시작 안 된 세그먼트)
      
      ratio = Math.min(1, Math.max(0, ratio));
      fill.style.width = (ratio * 100) + "%";
    }
    startAt = endAt;
  }

  // 2) 그룹화된 세그먼트 진행률 업데이트
  const groupedElements = document.querySelectorAll('.timeline-group');
  groupedElements.forEach(groupEl => {
    const startIndex = parseInt(groupEl.dataset.startIndex) || 0;
    const endIndex = parseInt(groupEl.dataset.endIndex) || 0;
    const groupIndex = parseInt(groupEl.dataset.groupIndex) || 0;
    
    // 그룹 내 전체 시간 계산
    let groupStartTime = 0;
    let groupTotalTime = 0;
    
    for (let i = 0; i < startIndex; i++) {
      groupStartTime += segDurationSec(w.segments[i]);
    }
    
    for (let i = startIndex; i < endIndex; i++) {
      groupTotalTime += segDurationSec(w.segments[i]);
    }
    
    // 그룹 진행률 계산
    const groupElapsed = Math.max(0, elapsed - groupStartTime);
    const groupRatio = Math.min(1, Math.max(0, groupElapsed / groupTotalTime));
    
    const groupFill = document.getElementById(`groupFill-${groupIndex}`);
    if (groupFill) {
      groupFill.style.width = (groupRatio * 100) + "%";
    }
  });

  // 3) 세그먼트 상태 클래스 업데이트 + 달성도 기반 색상 적용
  let startAt2 = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg);
    const endAt2 = startAt2 + dur;

    const el = document.querySelector(`.timeline-segment[data-index="${i}"]`);
    if (el) {
      el.classList.remove("is-complete", "is-current", "is-upcoming");
      el.classList.remove("achievement-low", "achievement-good", "achievement-high", "achievement-over");
      
      if (elapsed >= endAt2) {
        // 완료된 세그먼트 - 달성도 기반 색상 적용
        el.classList.add("is-complete");
        
        // 달성도 계산 및 색상 적용
        const targetW = segTargetW(seg, ftp);
        const avgW = segBar.samples[i] ? (segBar.sumPower[i] / segBar.samples[i]) : 0;
        const achievement = targetW > 0 ? (avgW / targetW) : 0;
        
        // 달성도에 따른 CSS 클래스 추가
        if (achievement < 0.85) {
          el.classList.add("achievement-low");
        } else if (achievement >= 0.85 && achievement <= 1.15) {
          el.classList.add("achievement-good");
        } else if (achievement > 1.15 && achievement <= 1.3) {
          el.classList.add("achievement-high");
        } else if (achievement > 1.3) {
          el.classList.add("achievement-over");
        }
        
      } else if (elapsed >= startAt2 && elapsed < endAt2) {
        el.classList.add("is-current");
      } else {
        el.classList.add("is-upcoming");
      }
    }
    startAt2 = endAt2;
  }

  // 4) 그룹 상태 클래스 업데이트는 기존과 동일...
  // (생략 - 기존 코드와 동일)

  // 5) 평균 파워 누적
  const p = Math.max(0, Number(window.liveData?.power) || 0);
  if (w.segments[segIndex]) {
    segBar.sumPower[segIndex] = (segBar.sumPower[segIndex] || 0) + p;
    segBar.samples[segIndex] = (segBar.samples[segIndex] || 0) + 1;

    const curSamples = segBar.samples[segIndex] || 0;
    const curAvg = curSamples > 0 ? Math.round(segBar.sumPower[segIndex] / curSamples) : 0;
    const elAvg = document.getElementById("avgSegmentPowerValue");
    if (elAvg) elAvg.textContent = String(curAvg);
  }
}

// 2. 훈련 상태 객체 통일 (window.trainingState 사용)
window.trainingState = window.trainingState || {
  timerId: null,
  paused: false,
  elapsedSec: 0,
  segIndex: 0,
  segElapsedSec: 0,
  segEnds: [],
  totalSec: 0
};

// 훈련 상태 => 시간/세그먼트 UI 갱신 함수
// 수정된 updateTimeUI 함수 (다음 세그먼트 부분만)
function updateTimeUI() {
  try {
    const w = window.currentWorkout;
    if (!w) {
      console.warn('No current workout in updateTimeUI');
      return;
    }

    const elapsed = Math.max(0, Number(window.trainingState?.elapsedSec) || 0);
    const total = Math.max(1, Number(window.trainingState?.totalSec) || 1);
    const totalPct = Math.min(100, Math.floor((elapsed / total) * 100));

    // 안전한 요소 업데이트
    safeSetText("elapsedTime", formatMMSS(elapsed));
    safeSetText("elapsedPercent", totalPct);

    // 현재 세그먼트
    const i = Math.max(0, Number(window.trainingState?.segIndex) || 0);
    const seg = w.segments?.[i];

    // 세그먼트 남은 시간 (0으로 클램프)
    if (seg) {
      const segDur = Math.max(0, segDurationSec(seg) || 0);
      const segRemain = Math.max(0, segDur - (Number(window.trainingState?.segElapsedSec) || 0));
      safeSetText("segmentTime", formatMMSS(segRemain));
    }

    // 다음 세그먼트 안내 - 수정된 부분
    const nextEl = safeGetElement("nextSegment");
    if (nextEl) {
      const next = w.segments?.[i + 1];
      if (next) {
        const ftpPercent = getSegmentFtpPercent(next);
        const segmentName = next.label || next.segment_type || "세그먼트";
        nextEl.textContent = `다음: ${segmentName} FTP ${ftpPercent}%`;
      } else {
        nextEl.textContent = `다음: (마지막)`;
      }
    }

    // 세그먼트 진행률 (0~100 클램프)
    if (seg) {
      const segDur = Math.max(1, segDurationSec(seg) || 1);
      const segElapsed = Math.max(0, Number(window.trainingState?.segElapsedSec) || 0);
      const sp = Math.min(100, Math.floor((segElapsed / segDur) * 100));
      safeSetText("segmentProgress", String(sp));
    }
    
  } catch (error) {
    console.error('Error in updateTimeUI:', error);
  }
}

// 훈련 상태 ==> 세그먼트 전환 + 타겟파워 갱신 
function applySegmentTarget(i) {
  try {
    const w   = window.currentWorkout;
    const ftp = Number(window.currentUser?.ftp) || 200;
    const seg = w?.segments?.[i];
    if (!seg) return;

    // 목표 파워 계산 - 통일된 방식 사용
    const ftpPercent = getSegmentFtpPercent(seg);
    const targetW = Math.round(ftp * (ftpPercent / 100));
    
    window.liveData = window.liveData || {};
    window.liveData.targetPower = targetW;

    // DOM 즉시 반영
    safeSetText("targetPowerValue", String(targetW || 0));
    
    const nameEl = safeGetElement("currentSegmentName");
    if (nameEl) {
      const segmentName = seg.label || seg.segment_type || `세그먼트 ${i + 1}`;
      nameEl.textContent = `${segmentName} - FTP ${ftpPercent}%`;
    }
    
    safeSetText("segmentProgress", "0");
    safeSetText("avgSegmentPowerValue", "—");

    // 첫 프레임 즉시 반영
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
    
  } catch (error) {
    console.error('Error in applySegmentTarget:', error);
  }
}

// 시작/루프
// 수정된 startSegmentLoop 함수 (카운트다운 로직 추가)
// 세그먼트 카운트다운 함수 (수정된 버전)
// 수정된 startSegmentLoop 함수
function startSegmentLoop() {
  const w = window.currentWorkout;
  if (!w || !w.segments || w.segments.length === 0) {
    console.error('워크아웃 또는 세그먼트가 없습니다:', w);
    return;
  }

  console.log('세그먼트 루프 시작', '워크아웃:', w.title, '세그먼트 수:', w.segments.length);

  // 누적 종료시각 배열 계산
  window.trainingState.segEnds = [];
  let acc = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const durSec = segDurationSec(w.segments[i]);
    acc += durSec;
    window.trainingState.segEnds.push(acc);
    console.log(`세그먼트 ${i + 1}: ${durSec}초, 누적: ${acc}초`);
  }
  window.trainingState.totalSec = acc;

  // 초기 상태 설정
  window.trainingState.elapsedSec = 0;
  window.trainingState.segIndex = 0;
  window.trainingState.segElapsedSec = 0;
  window.trainingState.paused = false;

  // 세그먼트별 카운트다운 트리거 상태 초기화
  countdownTriggered = Array(w.segments.length).fill(false);

  // 첫 번째 세그먼트 타겟 적용
  applySegmentTarget(0);
  updateTimeUI();
  
  // 세그먼트 바 초기화
  if (typeof buildSegmentBar === "function") {
    buildSegmentBar();
  }

  console.log('타이머 시작', '총 시간:', window.trainingState.totalSec, '초');

  // 기존 타이머 정리
  if (window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
  }

  // 1초마다 실행되는 메인 루프
  window.trainingState.timerId = setInterval(() => {
    if (window.trainingState.paused) {
      return; // 일시정지 중이면 스킵
    }

    // 시간 진행
    window.trainingState.elapsedSec += 1;
    window.trainingState.segElapsedSec += 1;

    const currentSegIndex = window.trainingState.segIndex;
    const currentSeg = w.segments[currentSegIndex];
    
    if (!currentSeg) {
      console.error('현재 세그먼트가 없습니다. 인덱스:', currentSegIndex);
      return;
    }

    const segDur = segDurationSec(currentSeg);
    const segRemaining = segDur - window.trainingState.segElapsedSec;
    
    // 디버깅 로그 (5초 주변에서만 출력)
    if (segRemaining <= 7 && segRemaining >= 3) {
      console.log(`세그먼트 ${currentSegIndex + 1} 종료까지: ${segRemaining}초`);
    }

    // 세그먼트 종료 5초 전 카운트다운 트리거 (개선된 조건)
    if (segRemaining <= 5 && segRemaining > 0 && 
        !countdownTriggered[currentSegIndex] && 
        currentSegIndex < w.segments.length - 1) {
      
      // 마지막 세그먼트가 아닐 때만 카운트다운 실행
      countdownTriggered[currentSegIndex] = true;
      const nextSegment = w.segments[currentSegIndex + 1];
      console.log(`세그먼트 ${currentSegIndex + 1} 종료 ${segRemaining}초 전 카운트다운 시작`);
      startSegmentCountdown(segRemaining, nextSegment);
    }

    // TSS / kcal 누적 및 표시
    updateTrainingMetrics();

    // UI 먼저 갱신
    if (typeof updateTimeUI === "function") updateTimeUI();
    if (typeof window.updateTrainingDisplay === "function") window.updateTrainingDisplay();
    if (typeof updateSegmentBarTick === "function") updateSegmentBarTick();

    // 전체 종료 판단
    if (window.trainingState.elapsedSec >= window.trainingState.totalSec) {
      console.log('훈련 완료!');
      clearInterval(window.trainingState.timerId);
      window.trainingState.timerId = null;

      // 활성 카운트다운 정지
      stopSegmentCountdown();

      if (typeof setPaused === "function") setPaused(false);
      if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
      if (typeof showScreen === "function") showScreen("resultScreen");
      return;
    }

    // 세그먼트 경계 통과 → 다음 세그먼트로 전환 (카운트다운 고려)
    if (window.trainingState.segElapsedSec >= segDur) {
      // 카운트다운이 활성화되어 있다면 0초 완료까지 잠시 대기
      if (segmentCountdownActive) {
        console.log('카운트다운 활성 중 - 0초 완료 대기');
        // 0.8초 후에 세그먼트 전환 (카운트다운 0초 + 강조음 재생 시간 고려)
        setTimeout(() => {
          performSegmentTransition(currentSegIndex, w);
        }, 800);
        return; // 현재 루프에서는 세그먼트 전환하지 않음
      }
      
      // 카운트다운이 없으면 즉시 전환
      performSegmentTransition(currentSegIndex, w);
    }
  }, 1000);
}

// 세그먼트 전환 처리 함수 (카운트다운 완료 후 호출)==> 0초 카운트 다운 보완
function performSegmentTransition(currentSegIndex, workoutData) {
  console.log(`세그먼트 ${currentSegIndex + 1} 완료, 다음 세그먼트로 이동`);
  
  window.trainingState.segIndex += 1;
  window.trainingState.segElapsedSec = 0;

  if (window.trainingState.segIndex < workoutData.segments.length) {
    console.log(`세그먼트 ${window.trainingState.segIndex + 1}로 전환`);
    applySegmentTarget(window.trainingState.segIndex);
    
    // 세그먼트 전환 완료 후 카운트다운 정리
    if (segmentCountdownActive) {
      stopSegmentCountdown();
    }
    
  } else {
    console.log('모든 세그먼트 완료');
  }
}

// 6. stopSegmentLoop 함수 수정
// 수정된 stopSegmentLoop 함수 (카운트다운도 함께 정지)
function stopSegmentLoop() {
  if (window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
    window.trainingState.timerId = null;
    console.log('세그먼트 루프 정지됨');
  }
  
  // 활성 카운트다운도 정지
  stopSegmentCountdown();
}

// 일시정지 시에도 카운트다운 정지
function setPaused(isPaused) {
  window.trainingState.paused = !!isPaused;

  // 일시정지 시 카운트다운 정지
  if (isPaused && segmentCountdownActive) {
    stopSegmentCountdown();
  }

  // 버튼 라벨/아이콘 업데이트
  const btn = safeGetElement("btnTogglePause");
  const icon = safeGetElement("pauseIcon");
  if (btn)  btn.textContent = window.trainingState.paused ? " ▶️" : " ⏸️";
  if (icon) icon.textContent = window.trainingState.paused ? "▶️" : "⏸️";

  // 토스트 표시
  if (typeof showToast === "function") {
    showToast(window.trainingState.paused ? "일시정지됨" : "재개됨");
  }
}

// 중복 선언 방지
if (!window.showScreen) {
   // 기존 showScreen 함수를 이 코드로 교체하세요
      window.showScreen = function(id) {
     try {
       console.log(`Switching to screen: ${id}`);
       
       // 모든 화면 숨기기
       document.querySelectorAll(".screen").forEach(screen => {
         screen.classList.remove("active");
       });
       
       // 짧은 지연 후 대상 화면만 표시
       setTimeout(() => {
         const targetScreen = document.getElementById(id);
         if (targetScreen) {
           targetScreen.classList.add("active");
           
           // 스크롤을 최상단으로 이동
           window.scrollTo(0, 0);
           if (targetScreen.scrollTop !== undefined) {
             targetScreen.scrollTop = 0;
           }
           
           console.log(`Successfully switched to: ${id}`);
         } else {
           console.error(`Screen element '${id}' not found`);
         }
       }, 50);
       
     } catch (error) {
       console.error('Error in showScreen:', error);
     }
   };
}


if (!window.showConnectionStatus) {
  window.showConnectionStatus = function(show) {
    const el = safeGetElement("connectionStatus");
    if (el) {
      el.classList.toggle("hidden", !show);
    }
  };
}

if (!window.showToast) {
  window.showToast = function(msg) {
    const t = safeGetElement("toast");
    if (!t) return alert(msg);
    t.classList.remove("hidden");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
  };
}

// *** 핵심 수정: updateTrainingDisplay 함수 - currentPower 변수 초기화 문제 해결 ***
window.updateTrainingDisplay = function () {
  // *** 중요: currentPower 변수를 맨 앞에서 정의 ***
  const currentPower = window.liveData?.power || 0;
  const target = window.liveData?.targetPower || 200;
  const hr = window.liveData?.heartRate || 0;

  const p = safeGetElement("currentPowerValue");
  const h = safeGetElement("heartRateValue");
  const bar = safeGetElement("powerProgressBar");
  const t = safeGetElement("targetPowerValue");

  if (p) {
    p.textContent = Math.round(currentPower);
    p.classList.remove("power-low","power-mid","power-high","power-max");
    const ratio = currentPower / target;
    if (ratio < 0.8) p.classList.add("power-low");
    else if (ratio < 1.0) p.classList.add("power-mid");
    else if (ratio < 1.2) p.classList.add("power-high");
    else p.classList.add("power-max");
  }

  if (bar) {
    const pct = target > 0 ? Math.min(100, (currentPower / target) * 100) : 0;
    bar.style.width = pct + "%";
    if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
    else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
    else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
    else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
  }

  if (t) t.textContent = String(Math.round(target));

  if (h) {
    h.textContent = Math.round(hr);
    h.classList.remove("hr-zone1","hr-zone2","hr-zone3","hr-zone4","hr-zone5");
    if (hr < 100) h.classList.add("hr-zone1");
    else if (hr < 120) h.classList.add("hr-zone2");
    else if (hr < 140) h.classList.add("hr-zone3");
    else if (hr < 160) h.classList.add("hr-zone4");
    else h.classList.add("hr-zone5");
  }

  // *** 케이던스 표시 개선 ***
  const cadenceElement = safeGetElement("cadenceValue");
  if (cadenceElement) {
    const cadence = window.liveData?.cadence;
    if (typeof cadence === "number" && cadence > 0) {
      cadenceElement.textContent = Math.round(cadence);
    } else {
      cadenceElement.textContent = "--";
    }
  }

  // 중앙 디스플레이에 펄스 애니메이션 추가
  const powerDisplay = document.querySelector("#trainingScreen .power-display");
  if (powerDisplay) {
    if (currentPower > 0) powerDisplay.classList.add("active");
    else powerDisplay.classList.remove("active");
  }

  // *** 네온 효과를 위한 달성도 계산 및 클래스 적용 ***
  const targetPower = window.liveData?.targetPower || 200;
  const segmentAvgElement = safeGetElement("avgSegmentPowerValue");
  const segmentAvgPower = segmentAvgElement ? parseInt(segmentAvgElement.textContent) || 0 : 0;
  
  // 달성도 계산 (세그먼트 평균 파워 기준)
  const achievement = targetPower > 0 ? (segmentAvgPower / targetPower) : 0;
  
  // 모든 패널에서 이전 달성도 클래스 제거
  const panels = document.querySelectorAll('.enhanced-metric-panel');
  panels.forEach(panel => {
    panel.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over', 'neon-active');
  });
  
  // 현재 파워 값에서도 달성도 클래스 제거
  const currentPowerEl = safeGetElement("currentPowerValue");
  if (currentPowerEl) {
    currentPowerEl.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
  }
  
  // 달성도에 따른 클래스 적용
  let achievementClass = '';
  if (achievement < 0.85) {
    achievementClass = 'achievement-low';
  } else if (achievement >= 0.85 && achievement <= 1.15) {
    achievementClass = 'achievement-good';
  } else if (achievement > 1.15 && achievement <= 1.30) {
    achievementClass = 'achievement-high';
  } else if (achievement > 1.30) {
    achievementClass = 'achievement-over';
  }
  
  // 세그먼트 평균이 있을 때만 네온 효과 적용
  if (segmentAvgPower > 0 && achievementClass) {
    panels.forEach(panel => {
      panel.classList.add('neon-active', achievementClass);
    });
    
    // 현재 파워 값에도 글로우 효과 적용
    if (currentPowerEl && (achievementClass === 'achievement-good' || 
                          achievementClass === 'achievement-high' || 
                          achievementClass === 'achievement-over')) {
      currentPowerEl.classList.add(achievementClass);
    }
  }
};

// *** 시작 시 복구 시도 및 오류 처리 강화 ***
function startWorkoutTraining() {
  try {
    console.log('Starting workout training...');
    
    // 훈련 시작 직전 리셋
    Object.assign(trainingMetrics, {
      elapsedSec: 0, joules: 0, ra30: 0, np4sum: 0, count: 0
    });
    
    // (A) 워크아웃 보장: 캐시 복구 포함
    if (!window.currentWorkout) {
      try {
        const cached = localStorage.getItem("currentWorkout");
        if (cached) window.currentWorkout = JSON.parse(cached);
      } catch (e) {
        console.warn('Failed to load cached workout:', e);
      }
    }
    
    if (!window.currentWorkout) {
      console.error('No workout selected');
      if (typeof showToast === "function") showToast("워크아웃을 먼저 선택하세요");
      if (typeof showScreen === "function") showScreen("workoutScreen");
      return;
    }

    console.log('Current workout:', window.currentWorkout.title);

    // (B) 상태 초기화 (일시정지 해제 + 타이머 변수 초기화)
    if (typeof setPaused === "function") setPaused(false);
    if (window.trainingState) {
      window.trainingState.elapsedSec = 0;
      window.trainingState.segElapsedSec = 0;
      window.trainingState.segIndex = 0;
    }

    // (C) 세그먼트 타임라인 생성 (안전 장치 추가)
    if (typeof buildSegmentBar === "function") {
      try {
        buildSegmentBar();
      } catch (e) {
        console.warn('Failed to build segment bar:', e);
      }
    }

    // (D) 첫 세그먼트 타겟/이름 적용 + 시간 UI 1회 갱신 (안전 장치 추가)
    if (typeof applySegmentTarget === "function") {
      try {
        applySegmentTarget(0);
      } catch (e) {
        console.error('Failed to apply segment target:', e);
        // 기본값으로 설정
        window.liveData.targetPower = 200;
      }
    }
    
    if (typeof updateTimeUI === "function") {
      try {
        updateTimeUI();
      } catch (e) {
        console.warn('Failed to update time UI:', e);
      }
    }

    // (E) 화면 전환
    if (typeof showScreen === "function") {
      showScreen("trainingScreen");
      console.log('Switched to training screen');
    }

    // 사용자 정보 출력 (안전 장치 추가)
    if (typeof renderUserInfo === "function") {
      try {
        renderUserInfo();
      } catch (e) {
        console.warn('Failed to render user info:', e);
      }
    }

    // (F) 첫 프레임 즉시 렌더 (깜빡임 방지)
    if (typeof window.updateTrainingDisplay === "function") {
      try {
        window.updateTrainingDisplay();
      } catch (e) {
        console.error('Failed to update training display:', e);
      }
    }

    // (G) 1Hz 루프 시작 (세그먼트/시간 진행)
    if (typeof startSegmentLoop === "function") {
      try {
        startSegmentLoop();
        console.log('Segment loop started');
      } catch (e) {
        console.error('Failed to start segment loop:', e);
      }
    }

    if (typeof showToast === "function") showToast("훈련을 시작합니다");
    
  } catch (error) {
    console.error('Critical error in startWorkoutTraining:', error);
    if (typeof showToast === "function") {
      showToast("훈련 시작 중 오류가 발생했습니다: " + error.message);
    }
    // 오류 발생 시 워크아웃 선택 화면으로 돌아가기
    if (typeof showScreen === "function") {
      showScreen("workoutScreen");
    }
  }
}

function backToWorkoutSelection() {
  if (typeof showScreen === "function") {
    showScreen("workoutScreen");
  }
}

// 훈련 화면 상단에 사용자 정보가 즉시 표시
// renderUserInfo 함수를 다음과 같이 수정하세요 (app.js 파일에서)

function renderUserInfo() {
  try {
    const box = safeGetElement("userInfo");
    const u = window.currentUser;
    if (!box) return;

    if (!u) { 
      box.textContent = "사용자 미선택"; 
      // 등급 클래스 제거
      const parentEl = box.closest('.enhanced-training-user-info');
      if (parentEl) {
        parentEl.classList.remove('grade-expert', 'grade-advanced', 'grade-intermediate', 'grade-beginner', 'grade-novice');
      }
      return; 
    }

    const cleanName = String(u.name || "").replace(/^👤+/g, "").trim();
    const ftp = Number(u.ftp);
    const wt  = Number(u.weight);
    const wkg = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0) ? (ftp / wt) : 0;

    // W/kg 등급 계산
    let gradeText = "";
    let gradeClass = "";
    
    if (wkg >= 4.0) {
      gradeText = "상급";
      gradeClass = "grade-expert";
    } else if (wkg >= 3.5) {
      gradeText = "중급";
      gradeClass = "grade-advanced";
    } else if (wkg >= 3.0) {
      gradeText = "초중급";
      gradeClass = "grade-intermediate";
    } else if (wkg >= 2.2) {
      gradeText = "초급";
      gradeClass = "grade-beginner";
    } else if (wkg > 0) {
      gradeText = "입문";
      gradeClass = "grade-novice";
    }

    // 텍스트 설정 (등급 포함)
    const wkgDisplay = wkg > 0 ? wkg.toFixed(2) : "-";
    const gradeDisplay = gradeText ? ` [${gradeText}]` : "";
    
    box.textContent = `${cleanName} · FTP ${Number.isFinite(ftp) ? ftp : "-"}W · ${wkgDisplay} W/kg${gradeDisplay}`;
    
    // 부모 요소에 등급 클래스 적용
    const parentEl = box.closest('.enhanced-training-user-info');
    if (parentEl) {
      // 기존 등급 클래스 제거
      parentEl.classList.remove('grade-expert', 'grade-advanced', 'grade-intermediate', 'grade-beginner', 'grade-novice');
      // 새 등급 클래스 추가
      if (gradeClass) {
        parentEl.classList.add(gradeClass);
      }
    }
    
  } catch (error) {
    console.error('Error in renderUserInfo:', error);
  }
}

function togglePause() {
  setPaused(!window.trainingState.paused);
}

// ========== 로그인 화면 JavaScript 코드 ==========
// app.js 파일의 DOMContentLoaded 이벤트 내부에 추가하세요

// 로그인 화면 초기화 (기존 showScreen("connectionScreen") 대신)
if (typeof showScreen === "function") {
  showScreen("loginScreen"); // 첫 화면을 로그인 화면으로 변경
}

// 전화번호 인증 기능
// 기존 initializeLoginScreen 함수를 이 코드로 교체하세요

function initializeLoginScreen() {
  const phoneInput = safeGetElement("phoneAuth");
  const authButton = safeGetElement("btnAuthenticate");
  const registerButton = safeGetElement("btnGoRegister");
  const authError = safeGetElement("authError");
  const authStatus = safeGetElement("authStatus");

  // 초기 버튼 상태 설정
  if (authButton) {
    authButton.disabled = true;
    authButton.style.opacity = "0.6";
  }

  // 전화번호 입력 유효성 검사
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      // 숫자만 입력 허용
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
      
      // 4자리 제한
      if (e.target.value.length > 4) {
        e.target.value = e.target.value.slice(0, 4);
      }
      
      // 에러 메시지 숨기기 (요소가 존재할 때만)
      if (authError) {
        authError.classList.add("hidden");
      }
      
      // 상태 메시지 숨기기 (요소가 존재할 때만)
      if (authStatus) {
        authStatus.classList.add("hidden");
      }
      
      // 버튼 활성화/비활성화
      if (authButton) {
        const isValid = e.target.value.length === 4;
        authButton.disabled = !isValid;
        authButton.style.opacity = isValid ? "1" : "0.6";
      }
    });

    // Enter 키 이벤트
    phoneInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && phoneInput.value.length === 4) {
        handleAuthentication();
      }
    });

    // 포커스 이벤트 (입력 필드 선택 시)
    phoneInput.addEventListener("focus", () => {
      if (authError) {
        authError.classList.add("hidden");
      }
      if (authStatus) {
        authStatus.classList.add("hidden");
      }
    });
  }

  // 인증 버튼 클릭
  if (authButton) {
    authButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (!authButton.disabled) {
        handleAuthentication();
      }
    });
  }

  // 사용자 등록 버튼 클릭
  if (registerButton) {
    registerButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof showScreen === "function") {
        showScreen("profileScreen");
      }
    });
  }

  console.log("로그인 화면 초기화 완료");
}

// 3. 개선된 화면 전환 함수
function switchToNextScreen(targetScreenId) {
  console.log(`화면 전환: ${targetScreenId}`);
  
  try {
    // 1) 모든 화면 완전히 숨김 (강제)
    document.querySelectorAll(".screen").forEach(screen => {
      screen.style.display = "none";
      screen.classList.remove("active");
      screen.style.position = "static";
      screen.style.zIndex = "auto";
    });
    
    // 2) 잠시 대기 후 대상 화면만 표시 (렌더링 보장)
    setTimeout(() => {
      const targetScreen = document.getElementById(targetScreenId);
      if (targetScreen) {
        // 화면이 전체를 차지하도록 강제 설정
        targetScreen.style.display = "block";
        targetScreen.classList.add("active");
        targetScreen.style.position = "relative";
        targetScreen.style.zIndex = "1000";
        targetScreen.style.width = "100%";
        targetScreen.style.height = "100vh";
        targetScreen.style.overflow = "auto";
        
        console.log(`성공적으로 ${targetScreenId}로 전환되었습니다.`);
        
        // 스크롤을 최상단으로 이동
        window.scrollTo(0, 0);
        targetScreen.scrollTop = 0;
        
        // 화면별 특별 처리
        if (targetScreenId === 'profileScreen') {
          console.log('프로필 화면 로딩 중...');
          setTimeout(() => {
            if (typeof window.loadUsers === 'function') {
              window.loadUsers();
            } else {
              console.error('loadUsers 함수를 찾을 수 없습니다');
            }
          }, 150);
        }
        
      } else {
        console.error(`화면 요소 '${targetScreenId}'를 찾을 수 없습니다.`);
        return;
      }
    }, 50);
    
  } catch (error) {
    console.error('화면 전환 중 오류:', error);
  }
}

// 사용자 인증 처리
// 기존 handleAuthentication 함수를 이 코드로 교체하세요
// 1. 개선된 사용자 인증 함수 (수정된 버전 - matchingUsers 중복 선언 제거)
async function handleAuthentication() {
  const phoneInput = safeGetElement("phoneAuth");
  const authButton = safeGetElement("btnAuthenticate");
  const authError = safeGetElement("authError");
  
  if (!phoneInput || phoneInput.value.length !== 4) {
    return;
  }

  const phoneLastFour = phoneInput.value;
  console.log(`인증 시도: 전화번호 뒷자리 ${phoneLastFour}`);
  
  try {
    // 로딩 상태 시작
    if (authButton) {
      authButton.classList.add("loading");
      authButton.disabled = true;
    }

    // 에러 메시지 숨기기
    if (authError) {
      authError.classList.add("hidden");
    }

    // 진행 상태 표시
    showAuthStatus("loading", "사용자 정보를 확인하는 중...", "⏳");

    // 사용자 목록 강제 새로고침
    console.log('사용자 데이터 로딩 시작...');
    await loadUsersForAuth(true); // force reload
    
    // 로딩 완료 후 잠시 대기 (데이터 안정화)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 전화번호 뒷자리로 매칭되는 모든 사용자 찾기 (중복 선언 제거)
    const users = window.users || window.userProfiles || [];
    console.log(`로딩된 사용자 수: ${users.length}`);
    console.log('사용자 목록:', users);
    
    // ⭐ 수정된 부분: searchUsersByPhoneLastFour 함수 사용
    const matchingUsers = searchUsersByPhoneLastFour(phoneLastFour);

    if (matchingUsers.length >= 1) {
      // 매칭되는 사용자가 1명 이상인 경우
      
      // 첫 번째 사용자를 현재 사용자로 설정
      window.currentUser = matchingUsers[0];
      console.log('선택된 사용자:', window.currentUser);
      
      // 여러 명이 매칭되는 경우 로그에 표시
      if (matchingUsers.length > 1) {
        console.log("여러 사용자가 매칭됨:", matchingUsers.map(u => u.name));
        console.log("첫 번째 사용자를 선택:", matchingUsers[0].name);
      }
      
      // 성공 상태 표시
      showAuthStatus("success", `${matchingUsers[0].name}님 인증 완료`, "✅");
      
      // 성공 피드백
      if (typeof showToast === "function") {
        showToast(`${matchingUsers[0].name}님 환영합니다!`);
      }
      
      // 블루투스 연결 화면으로 이동
      setTimeout(() => {
        hideAuthStatus();
        switchToNextScreen("connectionScreen");
      }, 1500);
      
    } else {
      // 매칭되는 사용자가 0명인 경우
      
      console.log("매칭되는 사용자가 없음 - 사용자 등록 화면으로 이동");
      
      // 리다이렉트 상태 표시
      showAuthStatus("redirect", "미등록 번호입니다. 회원가입으로 이동합니다...", "📋");
      
      // 안내 메시지 표시
      if (typeof showToast === "function") {
        showToast("등록되지 않은 번호입니다. 사용자 등록을 진행합니다.");
      }
      
      // 사용자 등록 화면으로 자동 이동
      setTimeout(() => {
        hideAuthStatus();
        switchToNextScreen("profileScreen");
      }, 2000);
    }
    
  } catch (error) {
    console.error("Authentication error:", error);
    
    hideAuthStatus();
    
    if (authError) {
      authError.classList.remove("hidden");
      authError.textContent = "인증 중 오류가 발생했습니다. 다시 시도해주세요.";
    }
    
    // 입력 필드 에러 표시
    const inputWrapper = phoneInput.closest('.input-wrapper');
    if (inputWrapper) {
      inputWrapper.classList.add('error');
      setTimeout(() => {
        inputWrapper.classList.remove('error');
      }, 2000);
    }
    
    // 입력 필드 포커스
    phoneInput.select();
    
  } finally {
    // 로딩 상태 종료
    if (authButton) {
      authButton.classList.remove("loading");
      authButton.disabled = false;
    }
  }
}

// 추가: 다중 사용자 선택 함수 (필요시 사용)
function showUserSelectionModal(matchingUsers) {
  // 여러 사용자가 매칭될 때 선택 모달을 표시하는 함수
  // 현재는 첫 번째 사용자를 자동 선택하지만, 
  // 향후 사용자가 직접 선택할 수 있도록 확장 가능
  
  console.log("매칭된 사용자들:");
  matchingUsers.forEach((user, index) => {
    console.log(`${index + 1}. ${user.name} (${user.contact})`);
  });
  
  // 첫 번째 사용자 반환
  return matchingUsers[0];
}

// 추가: 인증 성공 후 사용자 정보 미리 설정
function prepareUserData(user) {
  // 선택된 사용자의 정보를 전역 변수에 설정
  window.currentUser = user;
  
  // 로컬 스토리지에 마지막 로그인 사용자 저장 (선택사항)
  try {
    localStorage.setItem('lastLoginUser', JSON.stringify({
      id: user.id,
      name: user.name,
      loginTime: new Date().toISOString()
    }));
  } catch (e) {
    console.warn('로컬 스토리지 저장 실패:', e);
  }
  
  return user;
}

// 인증용 사용자 목록 로드
// 2. 개선된 사용자 데이터 로딩 함수
async function loadUsersForAuth(forceReload = false) {
  try {
    console.log('loadUsersForAuth 시작', 'forceReload:', forceReload);
    
    // 강제 새로고침이 아니고 기존 사용자 데이터가 있으면 사용
    if (!forceReload && ((window.users && window.users.length > 0) || 
        (window.userProfiles && window.userProfiles.length > 0))) {
      console.log('기존 사용자 데이터 사용');
      return;
    }

    // userManager.js의 loadUsers 함수가 있으면 사용
    if (typeof window.loadUsers === "function") {
      console.log('userManager.loadUsers 함수 호출');
      await window.loadUsers();
      console.log('userManager.loadUsers 완료, 사용자 수:', (window.users || []).length);
      return;
    }

    // Google Apps Script에서 사용자 데이터 가져오기
    if (window.CONFIG && window.CONFIG.GAS_WEB_APP_URL) {
      console.log('Google Apps Script에서 사용자 데이터 가져오기');
      const url = window.CONFIG.GAS_WEB_APP_URL + "?action=getUsers&t=" + Date.now();
      console.log('요청 URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      console.log('응답 상태:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('받은 데이터:', data);
        
        if (data && data.users && Array.isArray(data.users)) {
          window.users = data.users;
          console.log(`성공적으로 ${data.users.length}명의 사용자 데이터를 로딩했습니다.`);
          console.log('첫 번째 사용자 예시:', data.users[0]);
        } else {
          console.warn('올바르지 않은 데이터 형식:', data);
          window.users = [];
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } else {
      console.warn('Google Apps Script URL이 설정되지 않았습니다.');
      window.users = [];
    }
    
  } catch (error) {
    console.error("사용자 데이터 로딩 실패:", error);
    // 사용자 목록 로드 실패시에도 계속 진행
    window.users = window.users || [];
  }
}

// 전화번호 포맷팅 함수
function formatPhoneNumber(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('010')) {
    return `${cleaned.slice(0,3)}-${cleaned.slice(3,7)}-${cleaned.slice(7)}`;
  }
  return phone;
}

// 로그인 화면 애니메이션 효과
function addLoginAnimations() {
  // 컨테이너 등장 애니메이션
  const container = document.querySelector('.login-container');
  if (container) {
    container.style.opacity = '0';
    container.style.transform = 'translateY(30px)';
    
    setTimeout(() => {
      container.style.transition = 'all 0.8s ease-out';
      container.style.opacity = '1';
      container.style.transform = 'translateY(0)';
    }, 300);
  }

  // 순차적 요소 등장 애니메이션
  const elements = [
    '.app-logo',
    '.features-preview',
    '.login-form',
    '.register-section',
    '.login-footer'
  ];

  elements.forEach((selector, index) => {
    const element = document.querySelector(selector);
    if (element) {
      element.style.opacity = '0';
      element.style.transform = 'translateY(20px)';
      
      setTimeout(() => {
        element.style.transition = 'all 0.6s ease-out';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
      }, 500 + (index * 150));
    }
  });
}

// 사용자 등록 화면으로 이동 (기존 profileScreen 활용)
function goToUserRegistration() {
  if (typeof showScreen === "function") {
    showScreen("profileScreen");
  }
}

// iOS 모드 체크 및 처리 (기존 코드 수정)
function checkIOSMode() {
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  
  if (isIOSDevice) {
    // iOS에서는 블루투스 관련 메시지 표시
    const statusItems = document.querySelectorAll('.status-item');
    statusItems.forEach(item => {
      if (item.textContent.includes('블루투스')) {
        item.innerHTML = `
          <div class="status-indicator" style="background:#f59e0b;"></div>
          <span>iOS 제한 모드</span>
        `;
      }
    });
  }
}

// 디버그 함수 (개발용)
window.debugLogin = function() {
  console.log("=== Login Debug Info ===");
  console.log("Current users:", window.users || window.userProfiles);
  console.log("Current user:", window.currentUser);
  console.log("Phone input value:", document.getElementById("phoneAuth")?.value);
};

// 테스트용 빠른 로그인 (개발용)
window.quickLogin = function(userIndex = 0) {
  const users = window.users || window.userProfiles || [];
  if (users[userIndex]) {
    window.currentUser = users[userIndex];
    console.log("Quick login as:", users[userIndex].name);
    if (typeof showScreen === "function") {
      showScreen("connectionScreen");
    }
  }
};

// 상태 메시지 처리 함수들 (handleAuthentication 함수와 함께 추가)

// 상태 메시지 표시 함수
// 기존 showAuthStatus 함수를 이 코드로 교체하세요

function showAuthStatus(type, message, icon = '⏳') {
  const statusEl = safeGetElement("authStatus");
  const statusIcon = statusEl?.querySelector(".status-icon");
  const statusText = statusEl?.querySelector(".status-text");
  
  if (!statusEl || !statusIcon || !statusText) return;
  
  // 상태에 따른 스타일 적용
  statusEl.classList.remove("hidden", "success", "redirect", "loading");
  
  // type이 빈 문자열이 아닐 때만 클래스 추가
  if (type && type.trim()) {
    statusEl.classList.add(type);
  } else {
    // 기본 로딩 상태
    statusEl.classList.add("loading");
  }
  
  // 아이콘과 텍스트 업데이트
  statusIcon.textContent = icon;
  statusText.textContent = message;
}

// 상태 메시지 숨기기 함수
function hideAuthStatus() {
  const statusEl = safeGetElement("authStatus");
  if (statusEl) {
    statusEl.classList.add("hidden");
  }
}

// 전화번호 형식 정규화 함수 (데이터 일관성 향상)
// 4. 개선된 전화번호 정규화 함수
function normalizePhoneNumber(phone) {
  if (!phone) return "";
  
  // 숫자만 추출
  const numbers = phone.replace(/[^0-9]/g, '');
  
  console.log(`전화번호 정규화: "${phone}" → "${numbers}"`);
  
  // 11자리 010 번호인 경우
  if (numbers.length === 11 && numbers.startsWith('010')) {
    return numbers;
  }
  
  // 10자리인 경우 앞에 0 추가
  if (numbers.length === 10 && numbers.startsWith('10')) {
    return '0' + numbers;
  }
  
  return numbers;
}

// 개선된 사용자 매칭 함수
function findMatchingUsers(phoneLastFour, users) {
  return users.filter(user => {
    const contact = user.contact || user.phone || "";
    const normalized = normalizePhoneNumber(contact);
    const lastFour = normalized.slice(-4);
    
    // 디버그 정보
    if (phoneLastFour === lastFour) {
      console.log(`매칭 성공: ${user.name} (${contact} → ${normalized} → ${lastFour})`);
    }
    
    return lastFour === phoneLastFour;
  });
}

// 사용자 등록 화면으로 이동 시 입력된 전화번호 뒷자리 전달
function goToRegistrationWithPhone(phoneLastFour) {
  // 전화번호 뒷자리를 세션에 저장 (등록 화면에서 활용 가능)
  try {
    sessionStorage.setItem('pendingPhoneLastFour', phoneLastFour);
  } catch (e) {
    console.warn('세션 스토리지 저장 실패:', e);
  }
  
  if (typeof showScreen === "function") {
    showScreen("profileScreen");
  }
}

// 5. 디버깅용 함수들

// 5. 디버깅용 함수들
window.debugAuth = function() {
  console.log("=== 인증 디버그 정보 ===");
  console.log("현재 사용자:", window.currentUser);
  console.log("로딩된 사용자 목록:", window.users || window.userProfiles || []);
  console.log("전화번호 입력값:", document.getElementById("phoneAuth")?.value);
};

// 테스트용 빠른 로그인 (개발용)
window.quickLogin = function(userIndex = 0) {
  const users = window.users || window.userProfiles || [];
  if (users[userIndex]) {
    window.currentUser = users[userIndex];
    console.log("Quick login as:", users[userIndex].name);
    if (typeof showScreen === "function") {
      showScreen("connectionScreen");
    }
  }
};

// DOM 로딩 완료 후 초기화
document.addEventListener('DOMContentLoaded', function() {
  console.log('앱 초기화 시작');
  
  // 로그인 화면 초기화
  if (typeof initializeLoginScreen === "function") {
    initializeLoginScreen();
  }
  
  // iOS 모드 체크
  if (typeof checkIOSMode === "function") {
    checkIOSMode();
  }
  
  // 로그인 애니메이션 추가
  if (typeof addLoginAnimations === "function") {
    addLoginAnimations();
  }
  
  console.log('앱 초기화 완료');
});

// TSS/kcal 업데이트 함수 추가
function updateTrainingMetrics() {
  try {
    if (!window.liveData || !window.currentUser) return;
    
    const power = Number(window.liveData.power) || 0;
    const ftp = Number(window.currentUser.ftp) || 200;
    const weight = Number(window.currentUser.weight) || 70;
    
    // TSS 계산 (간단 근사)
    trainingMetrics.elapsedSec += 1;
    trainingMetrics.joules += power;
    
    // 30초 롤링 평균 (간단 근사)
    const alpha = 2 / (30 + 1);
    trainingMetrics.ra30 = trainingMetrics.ra30 * (1 - alpha) + power * alpha;
    
    // NP 4제곱 누적
    trainingMetrics.np4sum += Math.pow(trainingMetrics.ra30, 4);
    trainingMetrics.count += 1;
    
    // TSS 계산
    const np = trainingMetrics.count > 0 ? Math.pow(trainingMetrics.np4sum / trainingMetrics.count, 0.25) : 0;
    const tss = (trainingMetrics.elapsedSec * np * np) / (ftp * ftp) * 100 / 3600;
    
    // 칼로리 계산 (간단 근사: 1 kJ = 0.24 kcal)
    const kcal = (trainingMetrics.joules / 1000) * 0.24;
    
    // UI 업데이트
    safeSetText("tssValue", tss.toFixed(1));
    safeSetText("kcalValue", Math.round(kcal));
    
  } catch (error) {
    console.error('Error in updateTrainingMetrics:', error);
  }
}
