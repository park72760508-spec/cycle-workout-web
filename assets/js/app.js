/* ==========================================================
   app.js (v1.3 fixed) - 모든 오류 수정이 반영된 통합 버전
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

window.userPanelNeonMode = 'static';  // 'static' 고정 (동적 계산 끔)

   
  console.log('Global variables initialized safely');
})();

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
     console.log(`카운트다운: ${remain}초 남음`);
     
     if (remain > 0) {
       // 1, 2, 3, 4, 5초일 때 - 일반 삐 소리
       num.textContent = remain;
       playBeep(880, 120, 0.25);
       remain -= 1;
       
      } else if (remain === 0) {
        // 0초일 때 - 화면에 "0" 표시하고 강조 삐 소리
        num.textContent = "0";
        console.log('카운트다운 0초 - 강조 소리 재생');
        
        // 강조 소리 재생
        playBeep(1500, 700, 0.35, "square").then(() => {
          console.log('강조 소리 재생 완료');
        }).catch(err => {
          console.error('강조 소리 재생 실패:', err);
        });
        
        // 타이머 즉시 정리
        clearInterval(segmentCountdownTimer);
        segmentCountdownTimer = null;
        
        // 오버레이는 벨소리 시간만큼 지연 후 닫기
        setTimeout(() => {
          overlay.classList.add("hidden");
          overlay.style.display = "none";
          segmentCountdownActive = false;
          console.log('카운트다운 완료 - 오버레이 닫힘');
        }, 800); // 벨소리 재생 시간(700ms) + 여유시간(100ms)
       
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

// 참고: 기존 훈련 시작 카운트다운도 동일한 방식으로 개선 (선택적)
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

    // 🔽 현재 세그먼트를 '완료'로 처리
    let avgW_now = 0;
    const avgEl = document.getElementById('avgSegmentPowerValue');
    if (avgEl) {
      const n = parseFloat(avgEl.textContent);
      if (!Number.isNaN(n)) avgW_now = n;
    }
     
       const cur = window.trainingState?.segIndex || 0;
      finalizeSegmentCompletion(cur, avgW_now);

     
    // 다음 세그먼트로 이동
    const newIndex = Math.min(w.segments.length - 1, (window.trainingState?.segIndex || 0) + 1);
    if (window.trainingState) {
      window.trainingState.segIndex = newIndex;
      window.trainingState.segElapsedSec = 0;
       
      // 🔵 핵심: 전체 경과시간을 '새 세그먼트 시작 시각'으로 점프
      const jumpTo = getCumulativeStartSec(newIndex);
      // window.trainingState.elapsedSec = jumpTo;  // ❌ 이건 이제 비추천
      window.setElapsedSecSafely?.(jumpTo);          // ✅ startMs까지 보정

       
      // (참고) 그룹 타임라인을 쓰는 경우 start time을 가진 객체가 따로 있으면 그것도 갱신
      if (window.trainingSession && window.trainingSession.startTime) {
        // startTime을 과거로 재조정해서 now-startTime ≈ jumpTo 가 되도록 보정할 수도 있음
        // 필요 없다면 생략 가능
      }
       
    }
    
    if (typeof applySegmentTarget === 'function') {
      applySegmentTarget(newIndex);
    }
    if (typeof updateTimeUI === 'function') {
      updateTimeUI();
    }

    // 🔵 타임라인 즉시 반영
    if (typeof updateSegmentBarTick === 'function') updateSegmentBarTick();
    if (typeof updateTimelineByTime === 'function') updateTimelineByTime();
     
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

// 훈련화면의 건너뛰기에서 활용 >>> 새 세그먼트의 누적 시작 시각(초) 구하기
function getCumulativeStartSec(index) {
  const w = window.currentWorkout;
  if (!w || !Array.isArray(w.segments)) return 0;

  let acc = 0;
  for (let i = 0; i < index; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg); // 이미 파일 내에 존재하는 함수 사용
    acc += dur;
  }
  return acc;
}


// 세그먼트 누적 시작초
// function getCumulativeStartSec(index) {
  // const w = window.currentWorkout;
  // if (!w || !Array.isArray(w.segments)) return 0;
  // let acc = 0;
  // for (let i = 0; i < index; i++) {
    // acc += segDurationSec(w.segments[i]); // 기존 함수 그대로 사용
  // }
  // return acc;
// }



// 세그먼트 목표 파워(W) 계산
function getSegmentTargetW(i) {
  const w = window.currentWorkout;
  const seg = w?.segments?.[i];
  if (!seg) return 0;
  const ftp = Number(window.currentUser?.ftp) || 200;
  const ftpPercent = getSegmentFtpPercent(seg); // 기존 로직 활용
  return Math.round(ftp * (ftpPercent / 100));
}

// 세그먼트 타입(휴식/쿨다운 여부 확인용)
function getSegmentType(i) {
  const w = window.currentWorkout;
  const seg = w?.segments?.[i];
  const t = (seg?.segment_type || seg?.type || "").toLowerCase();
  return t; // e.g., "rest", "cooldown", "interval" 등
}


// 세그 평균 파워 → 달성도(%) → 색상 등급 → 타임라인에 적용
function finalizeSegmentCompletion(i, avgW) {
  try {
    // 휴식/쿨다운은 회색 고정
    const segType = getSegmentType(i);
    const isGray = (segType.includes('rest') || segType.includes('cooldown'));
    
    // 타임라인 세그 컨테이너 찾기 (data-index 또는 id 둘 다 시도)
    let segEl = document.querySelector(`.timeline-segment[data-index="${i}"]`);
    if (!segEl) segEl = document.getElementById(`seg-${i}`); // 프로젝트 구조에 맞춰 폴백
    if (!segEl) return;

    // 기존 done-* 클래스 제거
    segEl.classList.remove(
      'done-mint','done-green','done-lime','done-yellow','done-orange','done-red','done-gray'
    );

    if (isGray) {
      segEl.classList.add('done-gray');
      return;
    }

    // 달성도 계산
    const targetW = getSegmentTargetW(i);
    const avg = Number(avgW);
    const ratioPct = (targetW > 0 && Number.isFinite(avg)) ? (avg / targetW) * 100 : 0;

    // 버킷 분기
    let cls = 'done-red'; // 기본: 75% 미만
    if (ratioPct >= 115)       cls = 'done-mint';
    else if (ratioPct >= 105)  cls = 'done-green';
    else if (ratioPct >= 95)   cls = 'done-lime';
    else if (ratioPct >= 85)   cls = 'done-yellow';
    else if (ratioPct >= 75)   cls = 'done-orange';

    segEl.classList.add(cls);
  } catch (e) {
    console.error('finalizeSegmentCompletion error:', e);
  }
}





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
// 훈련 상태 => 타임라인 생성 (initializeTraining 내부에서 호출)
function createTimeline() {
  const cont = document.getElementById("timelineSegments");
  const w = window.currentWorkout;
  if (!cont || !w || !Array.isArray(w.segments)) return;

  const segs = w.segments;
  const total = segs.reduce((sum, seg) => sum + (seg.duration_sec || seg.duration || 0), 0) || 1;

  // 누적 종료시각(초) 계산 → window.trainingState.segEnds 에 저장
  const segEnds = [];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const dur = (typeof segs[i].duration_sec === "number" ? segs[i].duration_sec
               : typeof segs[i].duration === "number" ? segs[i].duration : 0);
    acc += dur;
    segEnds[i] = acc;
  }
  if (window.trainingState) window.trainingState.segEnds = segEnds;

  // 타임라인 DOM 렌더
  cont.innerHTML = segs.map((seg, i) => {
    const dur = (typeof seg.duration_sec === "number" ? seg.duration_sec
               : typeof seg.duration === "number" ? seg.duration : 0);
    const widthPct = (dur / total) * 100;
    const label = seg.segment_type || seg.label || "세그먼트";
    const timeMin = Math.floor(dur / 60);
    const timeSec = dur % 60;
    const timeLabel = timeSec > 0 ? `${timeMin}:${String(timeSec).padStart(2, "0")}` : `${timeMin}분`;

    return `
      <div class="timeline-segment" data-index="${i}" id="seg-${i}" style="width:${widthPct}%">
        <div class="progress-fill" id="segFill-${i}"></div>
        <span class="segment-label">${label}</span>
        <span class="segment-time">${timeLabel}</span>
      </div>
    `;
  }).join("");
}



// 훈련 상태 => 세그먼트별 달성도를 시간 기준 달성도(=진행률)로 표현
// === PATCH: robust timeline updater (no hard dependency on trainingSession) ===
function updateTimelineByTime() {
  try {
    const ts = window.trainingState || {};
    const w  = window.currentWorkout;
    if (!w || !Array.isArray(w.segments)) return;

    // 1) 경과초 결정: trainingState.elapsedSec 우선, 없으면 trainingSession.startTime 보조
    let elapsed = Number(ts.elapsedSec);
    if (!Number.isFinite(elapsed)) {
      const session = window.trainingSession;
      if (session && session.startTime) {
        elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      } else {
        elapsed = 0;
      }
    }

    // 2) 세그먼트 경계(누적 종료시각) 이용해 진행률 계산
    const segEnds = ts.segEnds || [];
    let startAt = 0;
    for (let i = 0; i < w.segments.length; i++) {
      const endAt = (segEnds[i] != null)
        ? segEnds[i]
        : startAt + (segDurationSec(w.segments[i]) || 0);
      const dur = Math.max(1, endAt - startAt);

      // 타임라인 DOM
      const segEl  = document.querySelector(`.timeline-segment[data-index="${i}"]`)
                   || document.getElementById(`seg-${i}`);
      const fillEl = segEl?.querySelector('.progress-fill');

      if (fillEl) {
        let ratio = 0;
        if (elapsed >= endAt)      ratio = 1;
        else if (elapsed > startAt) ratio = (elapsed - startAt) / dur;

        ratio = Math.max(0, Math.min(1, ratio));
        fillEl.style.width = (ratio * 100) + "%";

        // 현재 세그먼트면 파랑으로 강제
        if (elapsed > startAt && elapsed < endAt) {
          fillEl.style.background = "#2E74E8";
        }
      }

      startAt = endAt;
    }
  } catch (e) {
    console.error("updateTimelineByTime error:", e);
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
       
        // 🔵 현재 세그먼트면 파랑색으로 강제
        if (elapsed > startAt && elapsed < endAt) {
          fill.style.background = "#2E74E8";
        }
       
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

  // ⬇️⬇️⬇️ 여기 "초기 상태 설정" 바로 아래에 추가 ⬇️⬇️⬇️
  // — 벽시계 기반 타이밍 상태(추가) —
  window.trainingState.workoutStartMs = Date.now(); // 훈련 시작 시각(ms)
  window.trainingState.pauseAccumMs   = 0;          // 일시정지 누적(ms)
  window.trainingState.pausedAtMs     = null;       // 일시정지 시작 시각(ms)

  // 전체 경과초를 강제로 세팅할 때(예: 스킵 점프) 사용할 헬퍼
  window.setElapsedSecSafely = function(newSec) {
    const ts = window.trainingState;
    ts.elapsedSec = Math.max(0, Math.floor(newSec));
    // 다음 틱의 벽시계 계산과 일치하도록 startMs 재보정
    ts.workoutStartMs = Date.now() - (ts.elapsedSec * 1000 + ts.pauseAccumMs);
  };
  // ⬆️⬆️⬆️ 여기까지 추가 ⬆️⬆️⬆️


   
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

   // === 시간 진행(벽시계 기반) ===
   const ts = window.trainingState;
   const nowMs = Date.now();
   // 일시정지 누적 반영: pauseAccumMs + (일시정지 중이라면 지금까지 경과)
   const pausedMs = ts.pauseAccumMs + (ts.pausedAtMs ? (nowMs - ts.pausedAtMs) : 0);
   // 시작시각/일시정지 보정으로 경과초를 직접 계산
   const newElapsedSec = Math.floor((nowMs - ts.workoutStartMs - pausedMs) / 1000);
   
   // 같은 초에 중복 처리 방지(선택)
   if (newElapsedSec === ts.elapsedSec) {
     // 같은 초면 UI만 가볍게 유지하고 빠져도 OK
     // updateSegmentBarTick?.();
     return;
   }
   ts.elapsedSec = newElapsedSec;
   
   // 현재 세그 경과초 = 전체경과초 - 해당 세그 누적시작초
   const cumStart = getCumulativeStartSec(ts.segIndex);
   ts.segElapsedSec = Math.max(0, ts.elapsedSec - cumStart);
   
   // 이후 로직은 기존과 동일하게 진행 (currentSegIndex/segDur/segRemaining 계산 등)
   const currentSegIndex = ts.segIndex;
   const currentSeg = w.segments[currentSegIndex];
   if (!currentSeg) {
     console.error('현재 세그먼트가 없습니다. 인덱스:', currentSegIndex);
     return;
   }
   const segDur = segDurationSec(currentSeg);
   const segRemaining = segDur - ts.segElapsedSec;

    
    // 디버깅 로그 (5초 주변에서만 출력)
     
      // ── 카운트다운/벨: 경계(엣지) 기반 트리거 ──
      // 벽시계 기반으로 '이전 남은 ms' → '현재 남은 ms'가
      // 5s,4s,3s,2s,1s,0s 경계를 '넘었는지' 판정해서 정확히 한 번씩만 울림.
      ts._countdownFired = ts._countdownFired || {};      // 세그먼트별 발화 기록
      ts._prevRemainMs   = ts._prevRemainMs   || {};      // 세그먼트별 이전 남은 ms
      
      const key = String(currentSegIndex);
      // 남은시간(ms) 계산: 세그 끝 시각(ms) - 현재 경과(ms)
      const totalElapsedMs = (nowMs - ts.workoutStartMs) - (ts.pauseAccumMs + (ts.pausedAtMs ? (nowMs - ts.pausedAtMs) : 0));
      const segEndMs = (getCumulativeStartSec(currentSegIndex) + segDur) * 1000;
      const remainMsPrev = ts._prevRemainMs[key] ?? (segDur * 1000);
      const remainMsNow  = Math.round(segEndMs - (ts.workoutStartMs + totalElapsedMs));
      
      // 0초는 조금 이르게(ε) 트리거해서 놓침 방지
      const EPS_0_MS = 200;
      
      // 유틸: n초 경계를 방금 '지났으면' 발화
      function maybeFire(n) {
        const fired = ts._countdownFired[key] || {};
        if (fired[n]) return;
      
        const boundary = n * 1000;
        const crossed = (n > 0)
          ? (remainMsPrev > boundary && remainMsNow <= boundary)
          : (remainMsPrev > 0 && remainMsNow <= (0 + EPS_0_MS)); // 0초만 여유 적용
      
        if (crossed) {
          if (n > 0) {
            if (typeof playCountdownBeep === "function") playCountdownBeep(n);
            // showCountdownNumber?.(n); // 5~1 숫자 UI도 표시하고 싶으면 사용
          } else {
            if (typeof playSegmentEndBeep === "function") playSegmentEndBeep();
            // showCountdownNumber?.(0); // 0 숫자를 보이려면 사용
          }
          ts._countdownFired[key] = { ...(ts._countdownFired[key]||{}), [n]: true };
        }
      }
      
      // 5→0 모두 확인(한 틱에 여러 경계 통과되어도 누락 없이 발화)
      maybeFire(5);
      maybeFire(4);
      maybeFire(3);
      maybeFire(2);
      maybeFire(1);
      maybeFire(0);
      
      // 다음 틱 비교를 위해 저장
      ts._prevRemainMs[key] = remainMsNow;

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

    // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   if (window.trainingState.segElapsedSec >= segDur) {
     // (변경) 소리와 전환을 분리: 전환은 즉시, 소리는 비동기로 마무리
     if (segmentCountdownActive && typeof stopSegmentCountdown === "function") {
       setTimeout(() => { try { stopSegmentCountdown(); } catch(_){} }, 750);
     }
   
     // ✅ [완료처리 삽입 지점] 현재 세그먼트의 달성도 색 확정
     // 평균파워는 통계값이 있으면 그 값을, 없으면 화면의 평균 표시에서 가져옵니다.
     let avgW_now = 0;
     if (window.segmentStats && window.segmentStats[currentSegIndex] && Number.isFinite(window.segmentStats[currentSegIndex].avg)) {
       avgW_now = window.segmentStats[currentSegIndex].avg;
     } else {
       const avgEl = document.getElementById('avgSegmentPowerValue');
       if (avgEl) {
         const n = parseFloat(avgEl.textContent);
         if (!Number.isNaN(n)) avgW_now = n;
       }
     }
     // 현재 세그먼트 완료 색상 확정(휴식/쿨다운은 내부에서 회색 처리)
     if (typeof finalizeSegmentCompletion === 'function') {
       finalizeSegmentCompletion(currentSegIndex, avgW_now);
     }
   
     console.log(`세그먼트 ${currentSegIndex + 1} 완료, 다음 세그먼트로 이동`);
   
     // 다음 세그먼트로 인덱스 전환
     window.trainingState.segIndex += 1;
     window.trainingState.segElapsedSec = 0;
   
     if (window.trainingState.segIndex < w.segments.length) {
       console.log(`세그먼트 ${window.trainingState.segIndex + 1}로 전환`);
       applySegmentTarget(window.trainingState.segIndex);
   
       // 남아있을 수 있는 카운트다운 정리
       if (segmentCountdownActive) {
         stopSegmentCountdown();
       }
   
       // 진행바 즉시 반영(선택)
       if (typeof updateSegmentBarTick === "function") updateSegmentBarTick();
       if (typeof updateTimelineByTime === "function") updateTimelineByTime();
   
     } else {
       console.log('모든 세그먼트 완료');
     }
   }

  }, 1000);
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
  const ts = window.trainingState;
  const wantPause = !!isPaused;
  ts.paused = wantPause;

  if (wantPause) {
    // 일시정지 시작
    if (!ts.pausedAtMs) ts.pausedAtMs = Date.now();
  } else {
    // 일시정지 해제 → 누적 일시정지 시간 더해주기
    if (ts.pausedAtMs) {
      ts.pauseAccumMs += (Date.now() - ts.pausedAtMs);
      ts.pausedAtMs = null;
    }
  }

  // 카운트다운 정지
  if (wantPause && segmentCountdownActive) stopSegmentCountdown();

  const btn = safeGetElement("btnTogglePause");
  if (btn) {
    btn.classList.remove("pause", "play");
    btn.classList.add(wantPause ? "play" : "pause");
    btn.setAttribute("aria-label", wantPause ? "재생" : "일시정지");
  }
  showToast?.(wantPause ? "일시정지됨" : "재개됨");
}


// 중복 선언 방지
if (!window.showScreen) {
  window.showScreen = function(id) {
    try {
      console.log(`Switching to screen: ${id}`);
      
      // 1) 모든 화면 숨김
      document.querySelectorAll(".screen").forEach(s => {
        s.style.display = "none";
        s.classList.remove("active");
      });
      
      // 2) 대상 화면만 표시
      const el = safeGetElement(id);
      if (el) {
        el.style.display = "block";
        el.classList.add("active");
        console.log(`Successfully switched to: ${id}`);
      } else {
        console.error(`Screen element '${id}' not found`);
        return;
      }
      
      // 3) 화면별 특별 처리
      if (id === 'workoutScreen' && typeof loadWorkouts === 'function') {
        setTimeout(() => loadWorkouts(), 100);
      }
      
      if (id === 'profileScreen') {
        console.log('Loading users for profile screen...');
        setTimeout(() => {
          if (typeof window.loadUsers === 'function') {
            window.loadUsers();
          } else {
            console.error('loadUsers function not available');
          }
        }, 100);
      }
      
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
   // *** 케이던스 표시 개선 - 0 값도 표시 ***
   const cadenceElement = safeGetElement("cadenceValue");
   if (cadenceElement) {
     const cadence = window.liveData?.cadence;
     if (typeof cadence === "number" && !isNaN(cadence)) {
       // 숫자 값이면 0 포함해서 모두 표시
       cadenceElement.textContent = Math.round(cadence).toString();
     } else {
       // 값이 없거나 유효하지 않으면 0으로 표시
       cadenceElement.textContent = "0";
     }
   }

  // 중앙 디스플레이에 펄스 애니메이션 추가
   // === 중앙 패널 네온 클래스 갱신 ===
   (function updateCenterPanelNeon(){
           const panel = document.querySelector(
        '.enhanced-metric-panel.enhanced-center-panel.enhanced-main-power-display'
      );
     if (!panel) return;
   
     // 현재 파워/타깃
     const cur = Number(window.liveData?.power) || 0;
     const tgt = Number(window.liveData?.targetPower) || 0;
   
     // 이전 효과 제거
     panel.classList.remove('neon-active', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
   
     if (tgt <= 0 || cur <= 0) return; // 목표/현재 값 없으면 네온 미적용
   
     // 달성도 구간 선택
     let ach = 'achievement-good';
     const ratio = cur / tgt;
     if (ratio < 0.9)       ach = 'achievement-low';
     else if (ratio <= 1.15) ach = 'achievement-good';
     else if (ratio <= 1.30) ach = 'achievement-high';
     else                    ach = 'achievement-over';
   
     // 오직 중앙 컨테이너에만 부여
     panel.classList.add('neon-active', ach);
   })();


   // 사용자 등급 표기(상급~입문)
   // === 사용자 패널 W/kg 네온 동적 갱신 ===
   (function applyWkgNeon(){
     if (window.userPanelNeonMode === 'static') return; // 🔧 정적 모드일 땐 아무것도 하지 않음
   
     const power  = Number(window.liveData?.power) || 0;
     const weight = Number(window.userProfile?.weightKg || window.user?.weightKg) || 0;
     const wkg = (weight > 0) ? (power / weight) : NaN;
     updateUserPanelNeonByWkg(wkg);
   })();


   
   
};

// *** 시작 시 복구 시도 및 오류 처리 강화 ***
function startWorkoutTraining() {
  try {
    console.log('Starting workout training...');
    
    // 훈련 시작 직전 리셋
    Object.assign(trainingMetrics, {
      elapsedSec: 0, joules: 0, ra30: 0, np4sum: 0, count: 0
    });

    // liveData 초기화 강화
    if (!window.liveData) {
      window.liveData = {};
    }
    window.liveData.cadence = 0;  // 케이던스 명시적 초기화
     
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

// 케이던스 강제 리셋
window.resetCadence = function() {
  console.log("케이던스 강제 리셋 실행");
  
  window.liveData = window.liveData || {};
  window.liveData.cadence = 0;
  
  const cadenceElement = safeGetElement("cadenceValue");
  if (cadenceElement) {
    cadenceElement.textContent = "0";
    console.log("케이던스 값을 0으로 리셋 완료");
  }
  
  // 화면 업데이트
  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
  }
};



function backToWorkoutSelection() {
  if (typeof showScreen === "function") {
    showScreen("workoutScreen");
  }
}

// 훈련 화면 상단에 사용자 정보가 즉시 표시
// 사용자 정보 렌더 + W/kg 네온(정적) 적용
function renderUserInfo() {
  try {
    const box = document.getElementById("userInfo");
    if (!box) return;

    const u = window.currentUser;
    if (!u) {
      box.textContent = "사용자 미선택";
      // 사용자 패널 네온 제거(선택)
      if (typeof updateUserPanelNeonByWkg === "function") updateUserPanelNeonByWkg(0);
      return;
    }

    // 표시값 구성
    const cleanName = String(u.name || "").replace(/^👤+/g, "").trim();
    const ftp = Number(u.ftp);
    const wt  = Number(u.weight ?? u.weightKg); // 둘 중 하나 쓰는 구조면 병행 지원
    const wkgNum = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0) ? (ftp / wt) : NaN;

    const ftpDisp = Number.isFinite(ftp) ? String(ftp) : "-";
    const wkgDisp = Number.isFinite(wkgNum) ? wkgNum.toFixed(2) : "-";

    box.textContent = `${cleanName} · FTP ${ftpDisp}W · ${wkgDisp} W/kg`;

    // ★ 사용자 판넬 네온은 "한 번만" 적용 (동적 갱신 안 함)
    if (typeof updateUserPanelNeonByWkg === "function") {
      updateUserPanelNeonByWkg(Number.isFinite(wkgNum) ? wkgNum : 0);
    }

  } catch (error) {
    console.error('Error in renderUserInfo:', error);
  }
}



// ---------------------------------------------

function togglePause() {
  setPaused(!window.trainingState.paused);
}

// DOMContentLoaded 이벤트
document.addEventListener("DOMContentLoaded", () => {
  console.log("===== APP INIT =====");

  // iOS용 처리 프로세스
  function isIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function enableIOSMode() {
    const info = safeGetElement("iosInfo");
    if (info) info.classList.remove("hidden");

    ["btnConnectPM","btnConnectTrainer","btnConnectHR"].forEach(id => {
      const el = safeGetElement(id);
      if (el) {
        el.classList.add("is-disabled");
        el.setAttribute("aria-disabled","true");
        el.title = "iOS Safari에서는 블루투스 연결이 지원되지 않습니다";
      }
    });

    // null 체크 강화
    const btn = safeGetElement("btnIosContinue");
    if (btn) {
      btn.addEventListener("click", () => {
        console.log("iOS continue button clicked");
        if (typeof showScreen === "function") {
          showScreen("profileScreen");
        } else {
          console.error("showScreen function not available");
        }
      });
    } else {
      console.warn("btnIosContinue element not found in DOM");
    }
  }

  // 브라우저 지원 확인
  if (!navigator.bluetooth) {
    if (typeof showToast === "function") {
      showToast("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
    }
    console.error("Web Bluetooth not supported");
  }
  
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    if (typeof showToast === "function") {
      showToast("BLE를 사용하려면 HTTPS가 필요합니다.");
    }
    console.warn("HTTPS required for BLE");
  }
  
  if (typeof showScreen === "function") {
    showScreen("connectionScreen");
  }

  // 훈련 준비 → 훈련 시작
  const btnStartTraining = safeGetElement("btnStartTraining");
  if (btnStartTraining) {
    btnStartTraining.addEventListener("click", () => startWithCountdown(5));
  }

  // 훈련 준비 → 워크아웃 변경
  const btnBackToWorkouts = safeGetElement("btnBackToWorkouts");
  if (btnBackToWorkouts) {
    btnBackToWorkouts.addEventListener("click", () => {
      backToWorkoutSelection();
    });
  }

  // loadUsers()가 userProfiles도 인식하게(방어)
  function loadUsers() {
    const box = safeGetElement("userList");
    if (!box) return;

    // 전역 데이터: window.users → window.userProfiles 순으로 폴백
    const list =
      (Array.isArray(window.users) && window.users.length ? window.users :
       Array.isArray(window.userProfiles) && window.userProfiles.length ? window.userProfiles :
       []);

    if (!Array.isArray(list) || list.length === 0) {
      box.innerHTML = `<div class="muted">등록된 사용자가 없습니다.</div>`;
      box.onclick = null; // 이전 위임 핸들러 제거
      return;
    }

    // 카드 렌더 (이름, FTP, W/kg 포함)
    box.innerHTML = list.map((u) => {
      const name = (u?.name ?? "").toString();
      const ftp  = Number(u?.ftp);
      const wt   = Number(u?.weight);
      const wkg  = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0)
        ? (ftp / wt).toFixed(2)
        : "-";

      return `
        <div class="user-card" data-id="${u.id}">
          <div class="user-name">👤 ${name}</div>
          <div class="user-meta">FTP ${Number.isFinite(ftp) ? ftp : "-"}W · ${wkg} W/kg</div>
          <button class="btn btn-primary" data-action="select" aria-label="${name} 선택">선택</button>
        </div>
      `;
    }).join("");

    // 선택 버튼 위임(매번 새로 바인딩되도록 on*로 설정)
    box.onclick = (e) => {
      const btn = e.target.closest('[data-action="select"]');
      if (!btn) return;
      const card = btn.closest(".user-card");
      const id = card?.getAttribute("data-id");
      const user = list.find((x) => String(x.id) === String(id));
      if (user && typeof window.selectProfile === "function") {
        window.selectProfile(user.id);
      }
    };
  }

  // 블루투스 연결 버튼들
  const btnHR = safeGetElement("btnConnectHR");
  const btnTrainer = safeGetElement("btnConnectTrainer");
  const btnPM = safeGetElement("btnConnectPM");
  
  console.log("Button elements found:", {
    HR: !!btnHR,
    Trainer: !!btnTrainer,
    PM: !!btnPM
  });
  
  // 심박계 버튼
  if (btnHR) {
    btnHR.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("HR button clicked!");
      
      if (!window.connectHeartRate) {
        console.error("connectHeartRate function not found!");
        if (typeof showToast === "function") {
          showToast("심박계 연결 함수를 찾을 수 없습니다.");
        }
        return;
      }
      
      btnHR.disabled = true;
      const originalText = btnHR.textContent;
      btnHR.textContent = "검색 중...";
      
      try {
        await window.connectHeartRate();
      } catch (err) {
        console.error("HR connection error:", err);
      } finally {
        btnHR.disabled = false;
        btnHR.textContent = originalText;
      }
    });
  }
  
  // 트레이너 버튼
  if (btnTrainer) {
    btnTrainer.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("Trainer button clicked!");
      if (window.connectTrainer) {
        await window.connectTrainer();
      }
    });
  }
  
  // 파워미터 버튼
  if (btnPM) {
    btnPM.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("PM button clicked!");
      if (window.connectPowerMeter) {
        await window.connectPowerMeter();
      }
    });
  }

  // 다른 파워소스 우선순위도 같이 표기
  function updateDevicesList() {
    const box = safeGetElement("connectedDevicesList");
    if (!box) return;

    const pm = window.connectedDevices?.powerMeter;
    const tr = window.connectedDevices?.trainer;
    const hr = window.connectedDevices?.heartRate;

    const active = typeof getActivePowerSource === 'function' ? getActivePowerSource() : 'none';
    const pmBadge = pm ? (active==="powermeter" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";
    const trBadge = tr ? (active==="trainer" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";

    box.innerHTML = `
      ${pm ? `<div class="dev">⚡ 파워미터: ${pm.name}${pmBadge}</div>` : ""}
      ${tr ? `<div class="dev">🚲 스마트 트레이너: ${tr.name}${trBadge}</div>` : ""}
      ${hr ? `<div class="dev">❤️ 심박계: ${hr.name}</div>` : ""}
    `;
  }

  // 일시정지/재개
  const btnPause = safeGetElement("btnTogglePause");
  if (btnPause) {
    btnPause.addEventListener("click", togglePause);
  }

  // 구간 건너뛰기 - 기존 코드 교체
  const btnSkipSegment = safeGetElement("btnSkipSegment");
  if (btnSkipSegment) {
    btnSkipSegment.addEventListener("click", skipCurrentSegment);
  }

  // 훈련 종료
  const btnStopTraining = safeGetElement("btnStopTraining");
  if (btnStopTraining) {
    btnStopTraining.addEventListener("click", () => {
      stopSegmentLoop();
      if (typeof showScreen === "function") {
        showScreen("resultScreen");
      }
    });
  }

  console.log("App initialization complete!");

  if (isIOS()) enableIOSMode();
});

// 프로필 화면 이동 & 목록 로드: 단일 핸들러(안전)
(() => {
  const btn = safeGetElement("btnToProfile");
  if (!btn) return;

  btn.addEventListener("click", () => {
    // 1) 화면 전환
    if (typeof window.showScreen === "function") {
      window.showScreen("profileScreen");
    }

    // 2) 사용자 목록 렌더
    if (typeof window.loadUsers === "function") {
      // userManager.js의 전역 loadUsers가 있으면 이걸로 불러오기(권장)
      window.loadUsers();
      return;
    }

    // 대체 렌더러 1: renderUserList가 있다면 사용
    if (typeof window.renderUserList === "function") {
      window.renderUserList();
      return;
    }

    // 대체 렌더러 2: renderProfiles만 있을 때 컨테이너를 명시적으로 찾아 전달
    if (typeof window.renderProfiles === "function") {
      const root =
        safeGetElement("profilesContainer") ||
        document.querySelector("[data-profiles]");
      if (root) {
        // users 데이터를 내부에서 읽는 구현이라면 첫 인자는 생략 가능
        window.renderProfiles(undefined, root);
        return;
      }
    }

    console.warn(
      "[btnToProfile] 프로필 렌더러(loadUsers/renderUserList/renderProfiles)가 없습니다."
    );
  });
})();

// Export
window.startWorkoutTraining = startWorkoutTraining;
window.backToWorkoutSelection = backToWorkoutSelection;

// app.js 하단에 추가
// 그룹화 기능 통합
window.initializeGroupedTimeline = function() {
  // workoutManager.js의 그룹화 함수들을 app.js에서 사용할 수 있도록 연결
  if (typeof window.detectAndGroupSegments !== 'function') {
    console.warn('detectAndGroupSegments function not found in workoutManager.js');
  }
  
  // 타임라인 생성 시 그룹화 적용
  if (typeof buildSegmentBar === 'function') {
    buildSegmentBar();
  }
};

// 훈련 시작 시 호출
window.addEventListener('DOMContentLoaded', () => {
  // 기존 초기화 코드 후에 추가
  if (typeof window.initializeGroupedTimeline === 'function') {
    window.initializeGroupedTimeline();
  }
});

// 5. TSS/칼로리 업데이트 함수 분리
function updateTrainingMetrics() {
  try {
    const ftp = Number(window.currentUser?.ftp) || 200;
    const p = Math.max(0, Number(window.liveData?.power) || 0);

    trainingMetrics.elapsedSec += 1;
    trainingMetrics.joules += p;
    trainingMetrics.ra30 += (p - trainingMetrics.ra30) / 30;
    trainingMetrics.np4sum += Math.pow(trainingMetrics.ra30, 4);
    trainingMetrics.count += 1;

    const NP = Math.pow(trainingMetrics.np4sum / trainingMetrics.count, 0.25);
    const IF = ftp ? (NP / ftp) : 0;
    const TSS = (trainingMetrics.elapsedSec / 3600) * (IF * IF) * 100;
    const kcal = trainingMetrics.joules / 1000;

    safeSetText("tssValue", TSS.toFixed(1));
    safeSetText("kcalValue", Math.round(kcal));
    
  } catch (error) {
    console.error('Error in updateTrainingMetrics:', error);
  }
}

// 7. 전역 상태 접근을 위한 별칭 (호환성)
window.trainingState = window.trainingState || trainingState;

// 케이던스 상태 확인 함수
window.checkCadenceStatus = function() {
  console.log("=== Cadence Status Check ===");
  console.log("liveData.cadence:", window.liveData.cadence);
  console.log("cadenceValue element exists:", !!safeGetElement("cadenceValue"));
  console.log("cadenceValue current text:", safeGetElement("cadenceValue")?.textContent);
  console.log("__pmPrev state:", window.__pmPrev || "Not accessible");
  
  // 테스트용 케이던스 설정
  console.log("Testing manual cadence update...");
  window.liveData.cadence = 90;
  const el = safeGetElement("cadenceValue");
  if (el) {
    el.textContent = "90";
    console.log("Manual update successful");
  }
};

// 전역에서 __pmPrev 접근 가능하도록
window.__pmPrev = window.__pmPrev || {};

// 네온 효과 수동 테스트 함수
window.testNeonEffect = function(achievementPercent) {
  const panels = document.querySelectorAll('.enhanced-metric-panel');
  const currentPowerEl = safeGetElement("currentPowerValue");
  
  // 기존 클래스 제거
  panels.forEach(panel => {
    panel.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over', 'neon-active');
  });
  
  if (currentPowerEl) {
    currentPowerEl.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
  }
  
  // 테스트 클래스 적용
  let testClass = '';
  if (achievementPercent < 85) testClass = 'achievement-low';
  else if (achievementPercent <= 110) testClass = 'achievement-good';
  else if (achievementPercent <= 120) testClass = 'achievement-high';
  else testClass = 'achievement-over';
  
   // === FIX: 중앙 패널에만 네온/달성도 클래스 적용 ===
   // === 중앙 패널 1곳에만 네온/달성도 적용 ===
   const centerPanel = document.querySelector(
     '.enhanced-metric-panel.enhanced-center-panel.enhanced-main-power-display'
   );
     
   // 1) 모든 패널/파워 텍스트에서 이전 효과 제거
   //document.querySelectorAll('.enhanced-metric-panel').forEach(panel => {
     //panel.classList.remove(
       //'neon-active',
       //'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over'
     //);
   //});

   // (예시) 패널 전체 순회 루틴 어딘가에 있다면:
   document.querySelectorAll('.enhanced-metric-panel').forEach(panel => {
     if (panel.id === 'userPanel') return; // 🔧 사용자 패널은 건드리지 않음 (정적 네온 유지)
     panel.classList.remove('neon-active','achievement-low','achievement-good','achievement-high','achievement-over');
   });

   
   if (currentPowerEl) {
     currentPowerEl.classList.remove(
       'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over'
     );
   }
   
   // 2) 중앙 패널에만 새 효과 적용
   if (centerPanel && achievementClass) {
     centerPanel.classList.add('neon-active', achievementClass);
   }
   if (currentPowerEl && (achievementClass === 'achievement-good' ||
                          achievementClass === 'achievement-high' ||
                          achievementClass === 'achievement-over')) {
     currentPowerEl.classList.add(achievementClass);
   }
   
   // 3) (선택) 3초 후 “중앙 패널”만 효과 제거
   setTimeout(() => {
     if (centerPanel) centerPanel.classList.remove('neon-active', achievementClass);
     if (currentPowerEl) currentPowerEl.classList.remove(achievementClass);
   }, 3000);


  
  if (currentPowerEl) {
    currentPowerEl.classList.add(testClass);
  }
  
  console.log(`Test neon effect applied: ${testClass} (${achievementPercent}%)`);
  
  // 3초 후 효과 제거
  setTimeout(() => {
    panels.forEach(panel => {
      panel.classList.remove('neon-active', testClass);
    });
    if (currentPowerEl) {
      currentPowerEl.classList.remove(testClass);
    }
    console.log('Test neon effect removed');
  }, 3000);
};

// 전역 에러 핸들러 추가
window.addEventListener('error', function(event) {
  console.error('Global JavaScript error:', event.error);
  console.error('Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack
  });
});

window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault(); // 브라우저 콘솔에 에러가 표시되는 것을 방지
});

console.log('App.js v1.3 loaded successfully with all fixes applied');



// ====== app.js 파일 끝에 추가할 디버깅 함수들 ======

// 케이던스 상태 확인 함수
window.debugCadence = function() {
  console.log("=== Cadence Debug Info ===");
  console.log("liveData.cadence:", window.liveData?.cadence);
  console.log("cadenceValue element:", document.getElementById("cadenceValue"));
  console.log("cadenceValue current text:", document.getElementById("cadenceValue")?.textContent);
  console.log("updateTrainingDisplay function exists:", typeof window.updateTrainingDisplay === "function");
  
  // 수동으로 케이던스 설정 테스트
  if (window.liveData) {
    window.liveData.cadence = 85;
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = "85";
      console.log("✅ Manual cadence test completed - set to 85 RPM");
    }
    
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
      console.log("✅ updateTrainingDisplay called manually");
    }
  }
};

// 케이던스 강제 설정 함수 (테스트용)
window.setCadence = function(value) {
  if (window.liveData) {
    window.liveData.cadence = value;
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = value.toString();
      console.log(`✅ Cadence manually set to ${value} RPM`);
    }
    
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
  }
};

// 블루투스 상태 확인 함수
window.checkBluetoothStatus = function() {
  console.log("=== Bluetooth Status ===");
  console.log("Connected devices:", window.connectedDevices || "Not available");
  console.log("Live data:", window.liveData || "Not available");
  
  // __pmPrev 상태 확인 (bluetooth.js에서 접근 가능한 경우)
  if (typeof __pmPrev !== 'undefined') {
    console.log("Previous crank data:", __pmPrev);
  }
};


// ====== app.js 파일 끝에 추가할 고급 디버깅 함수들 ======

// 케이던스 강제 테스트
window.testCadence = function(value = 85) {
  console.log(`=== Testing Cadence with ${value} RPM ===`);
  
  // liveData 확인
  if (!window.liveData) {
    window.liveData = {};
    console.log("Created liveData object");
  }
  
  // 케이던스 설정
  window.liveData.cadence = value;
  console.log(`Set liveData.cadence to ${value}`);
  
  // UI 요소 확인 및 업데이트
  const cadenceEl = document.getElementById("cadenceValue");
  if (cadenceEl) {
    cadenceEl.textContent = value.toString();
    console.log(`✅ Updated cadenceValue element to ${value}`);
  } else {
    console.log("❌ cadenceValue element not found");
  }
  
  // updateTrainingDisplay 호출
  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
    console.log("✅ Called updateTrainingDisplay");
  } else {
    console.log("❌ updateTrainingDisplay function not found");
  }
  
  // 결과 확인
  setTimeout(() => {
    const finalEl = document.getElementById("cadenceValue");
    console.log(`Final cadenceValue content: "${finalEl?.textContent}"`);
  }, 100);
};

// 블루투스 상태 상세 확인
window.debugBluetoothState = function() {
  console.log("=== Bluetooth State Debug ===");
  console.log("Connected devices:", window.connectedDevices);
  console.log("Live data:", window.liveData);
  
  // __pmPrev 상태 확인 (전역 변수로 접근 시도)
  try {
    if (typeof __pmPrev !== 'undefined') {
      console.log("__pmPrev state:", __pmPrev);
    } else {
      console.log("__pmPrev not accessible from global scope");
    }
  } catch (e) {
    console.log("Error accessing __pmPrev:", e);
  }
  
  // UI 요소들 확인
  console.log("cadenceValue element:", document.getElementById("cadenceValue"));
  console.log("powerValue element:", document.getElementById("powerValue"));
  console.log("heartRateValue element:", document.getElementById("heartRateValue"));
};

// 케이던스 계산 시뮬레이션
window.simulateCadence = function() {
  console.log("=== Simulating Cadence Calculation ===");
  
  // 가상의 크랭크 데이터로 케이던스 계산 시뮬레이션
  const revolutions = 2; // 2회전
  const timeSeconds = 1.5; // 1.5초
  const cadence = (revolutions / timeSeconds) * 60; // RPM 계산
  
  console.log(`Simulation: ${revolutions} revs in ${timeSeconds}s = ${cadence} RPM`);
  
  if (cadence >= 30 && cadence <= 120) {
    window.liveData = window.liveData || {};
    window.liveData.cadence = Math.round(cadence);
    
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = Math.round(cadence).toString();
      console.log(`✅ Simulated cadence set to ${Math.round(cadence)} RPM`);
    }
  }
};

// 자동 케이던스 애니메이션 (테스트용)
window.animateCadence = function(duration = 10000) {
  console.log(`=== Starting Cadence Animation for ${duration}ms ===`);
  
  let startTime = Date.now();
  let animationId;
  
  function updateCadence() {
    const elapsed = Date.now() - startTime;
    if (elapsed > duration) {
      console.log("Animation completed");
      return;
    }
    
    // 60-100 RPM 사이에서 sine wave 패턴으로 변화
    const progress = elapsed / duration;
    const cadence = 80 + 20 * Math.sin(progress * Math.PI * 4);
    const roundedCadence = Math.round(cadence);
    
    window.liveData = window.liveData || {};
    window.liveData.cadence = roundedCadence;
    
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = roundedCadence.toString();
    }
    
    console.log(`Animated cadence: ${roundedCadence} RPM`);
    
    setTimeout(updateCadence, 1000); // 1초마다 업데이트
  }
  
  updateCadence();
};

// 파워미터 데이터 패킷 시뮬레이션
window.simulatePowerMeterData = function() {
  console.log("=== Simulating Power Meter Data ===");
  
  // 가상의 BLE 데이터 패킷 생성
  const flags = 0x23; // crank data present
  const power = 75; // 75W
  const revs = 1000; // 임의의 회전수
  const time = 30000; // 임의의 시간
  
  console.log(`Simulated packet - Flags: 0x${flags.toString(16)}, Power: ${power}W, Revs: ${revs}, Time: ${time}`);
  
  // 실제 handlePowerMeterData 함수가 존재한다면 호출
  if (typeof handlePowerMeterData === "function") {
    // ArrayBuffer 생성하여 시뮬레이션
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint16(0, flags, true);
    view.setInt16(2, power, true);
    view.setUint16(4, revs, true);
    view.setUint16(6, time, true);
    
    const mockEvent = {
      target: {
        value: view
      }
    };
    
    console.log("Calling handlePowerMeterData with simulated data");
    handlePowerMeterData(mockEvent);
  } else {
    console.log("❌ handlePowerMeterData function not found");
  }
};

// W/kg → 네온 등급 클래스 결정 + 사용자 패널에 적용
function updateUserPanelNeonByWkg(wkg) {
  const panel = document.querySelector('#userPanel');
  if (!panel) return;

  // 기존 제거 로직은 유지
  panel.classList.remove('neon-active','wkg-elite','wkg-advanced','wkg-intermediate','wkg-novice','wkg-beginner');

  // 🔧 여기 변경: 값이 없으면 '그냥 아무것도 붙이지 않고' return
  if (!Number.isFinite(wkg) || wkg <= 0) return;

  let tier;
  if (wkg >= 4.0)      tier = 'wkg-elite';
  else if (wkg >= 3.5) tier = 'wkg-advanced';
  else if (wkg >= 3.0) tier = 'wkg-intermediate';
  else if (wkg >= 2.2) tier = 'wkg-novice';
  else                 tier = 'wkg-beginner';

  panel.classList.add('neon-active', tier);
}


