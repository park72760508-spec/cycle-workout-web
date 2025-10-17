/* ==========================================================
   app.js (v1.2 stable) - 수정된 버전
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
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

async function ensureBeepContext() {
  try {
    __beepCtx = __beepCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (__beepCtx.state === "suspended") await __beepCtx.resume();
  } catch (e) {
    // 브라우저에서 차단되면 무음으로 진행
  }
}

async function playBeep(freq = 880, durationMs = 120, volume = 0.2, type = "sine") {
  try {
    await ensureBeepContext();
    if (!__beepCtx) return;
    const osc = __beepCtx.createOscillator();
    const gain = __beepCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;

    osc.connect(gain);
    gain.connect(__beepCtx.destination);

    const now = __beepCtx.currentTime;
    // 짧게 울리고 서서히 감쇄
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.start(now);
    osc.stop(now + durationMs / 1000);
  } catch (_) { /* 무시 */ }
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
function segTargetW(seg, ftp){
  if (typeof seg.target === "number") return Math.round(ftp * seg.target);
  if (typeof seg.ftp_percent === "number") return Math.round(ftp * (seg.ftp_percent/100));
  return 0;
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
function updateTimeUI() {
  const w = window.currentWorkout;
  if (!w) return;

  const elElapsed    = document.getElementById("elapsedTime");
  const elElapsedPct = document.getElementById("elapsedPercent");
  const elSegTime    = document.getElementById("segmentTime");
  const elNext       = document.getElementById("nextSegment");
  const elSegPct     = document.getElementById("segmentProgress"); // 진행률 표시 엘리먼트

  // 총 진행률 (오버플로우/NaN 방지)
  const elapsed  = Math.max(0, Number(trainingState.elapsedSec) || 0);
  const total    = Math.max(1, Number(trainingState.totalSec)  || 1);
  const totalPct = Math.min(100, Math.floor((elapsed / total) * 100));

  if (elElapsed)    elElapsed.textContent = formatMMSS(elapsed);
  if (elElapsedPct) elElapsedPct.textContent = totalPct;

  // 현재 세그먼트
  const i   = Math.max(0, Number(trainingState.segIndex) || 0);
  const seg = w.segments?.[i];

  // 세그 남은 시간(0으로 클램프)
  if (elSegTime) {
    const segDur = Math.max(0, Number(seg?.duration ?? seg?.duration_sec) || 0);
    const segRemain = Math.max(0, segDur - (Number(trainingState.segElapsedSec) || 0));
    elSegTime.textContent = formatMMSS(segRemain);
  }

  // 다음 세그 안내
  if (elNext) {
    const next = w.segments?.[i + 1];
    if (next) {
      const pct = (typeof next.target === "number")
        ? Math.round(next.target * 100)
        : (typeof next.ftp_percent === "number" ? Math.round(next.ftp_percent) : 0);
      elNext.textContent = `다음: ${next.label || next.segment_type || "세그먼트"} FTP ${pct}%`;
    } else {
      elNext.textContent = `다음: (마지막)`;
    }
  }

  // 세그 진행률 (0~100 클램프)
  if (elSegPct && seg) {
    const segDur    = Math.max(1, Number(seg?.duration ?? seg?.duration_sec) || 1);
    const segElapsed= Math.max(0, Number(trainingState.segElapsedSec) || 0);
    const sp = Math.min(100, Math.floor((segElapsed / segDur) * 100));
    elSegPct.textContent = String(sp);
  }
}

// 훈련 상태 ==> 세그먼트 전환 + 타겟파워 갱신
function applySegmentTarget(i) {
  const w   = window.currentWorkout;
  const ftp = Number(window.currentUser?.ftp) || 200;
  const seg = w?.segments?.[i];
  if (!seg) return;

  // 목표 파워 계산 (target: 0~1 비율, ftp_percent: %)
  let targetW = 0;
  if (typeof seg.target === "number") {
    targetW = Math.round(ftp * seg.target);
  } else if (typeof seg.ftp_percent === "number") {
    targetW = Math.round(ftp * (seg.ftp_percent / 100));
  }
  window.liveData = window.liveData || {};
  window.liveData.targetPower = targetW;

  // DOM 즉시 반영
  const tEl   = document.getElementById("targetPowerValue");
  const nameEl= document.getElementById("currentSegmentName");
  const progEl= document.getElementById("segmentProgress");
  const avgEl = document.getElementById("avgSegmentPowerValue");

  if (tEl)    tEl.textContent    = String(targetW || 0);
  if (nameEl) nameEl.textContent = seg.label || seg.segment_type || `세그먼트 ${i + 1}`;
  if (progEl) progEl.textContent = "0";
  if (avgEl)  avgEl.textContent  = "—";

  // 첫 프레임 즉시 반영
  window.updateTrainingDisplay && window.updateTrainingDisplay();
}

// 시작/루프
function startSegmentLoop() {
  const w = window.currentWorkout;
  if (!w || !w.segments || w.segments.length === 0) {
    console.error('워크아웃 또는 세그먼트가 없습니다:', w);
    return;
  }

  console.log('세그먼트 루프 시작, 워크아웃:', w.title, '세그먼트 수:', w.segments.length);

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

  // 첫 번째 세그먼트 타겟 적용
  applySegmentTarget(0);
  updateTimeUI();
  
  // 세그먼트 바 초기화
  if (typeof buildSegmentBar === "function") {
    buildSegmentBar();
  }

  console.log('타이머 시작, 총 시간:', window.trainingState.totalSec, '초');

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
    
    console.log(`진행 상황 - 총: ${window.trainingState.elapsedSec}초, 세그먼트: ${window.trainingState.segElapsedSec}/${segDur}초, 현재 세그먼트: ${currentSegIndex + 1}/${w.segments.length}`);

    // TSS / kcal 누적 및 표시
    updateTrainingMetrics();

    // UI 먼저 갱신 (마지막 0초 프레임 보장)
    if (typeof updateTimeUI === "function") updateTimeUI();
    if (typeof window.updateTrainingDisplay === "function") window.updateTrainingDisplay();
    if (typeof updateSegmentBarTick === "function") updateSegmentBarTick();

    // 전체 종료 판단
    if (window.trainingState.elapsedSec >= window.trainingState.totalSec) {
      console.log('훈련 완료!');
      clearInterval(window.trainingState.timerId);
      window.trainingState.timerId = null;

      if (typeof setPaused === "function") setPaused(false);
      if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
      if (typeof showScreen === "function") showScreen("resultScreen");
      return;
    }

    // 세그먼트 경계 통과 → 다음 세그먼트로 전환
    if (window.trainingState.segElapsedSec >= segDur) {
      console.log(`세그먼트 ${currentSegIndex + 1} 완료, 다음 세그먼트로 이동`);
      
      window.trainingState.segIndex += 1;
      window.trainingState.segElapsedSec = 0;

      if (window.trainingState.segIndex < w.segments.length) {
        console.log(`세그먼트 ${window.trainingState.segIndex + 1}로 전환`);
        applySegmentTarget(window.trainingState.segIndex);
        
        // 세그먼트 전환 효과음 (선택적)
        if (typeof playBeep === "function") {
          playBeep(1200, 200, 0.3);
        }
      } else {
        console.log('모든 세그먼트 완료');
      }
    }
  }, 1000);
}




// 6. stopSegmentLoop 함수 수정
function stopSegmentLoop() {
  if (window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
    window.trainingState.timerId = null;
    console.log('세그먼트 루프 정지됨');
  }
}

// 중복 선언 방지
if (!window.showScreen) {
  window.showScreen = function(id) {
    // 1) 모든 화면 숨김
    document.querySelectorAll(".screen").forEach(s => {
      s.style.display = "none";
      s.classList.remove("active");
    });
    // 2) 대상 화면만 표시
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "block";
      el.classList.add("active");
    }
    
    if (id === 'workoutScreen' && typeof loadWorkouts === 'function') {
      loadWorkouts();
    }
    
    if (id === 'profileScreen') {
      console.log('Loading real users for profile screen...');
      setTimeout(() => {
        if (typeof window.loadUsers === 'function') {
          window.loadUsers();
        } else {
          console.error('loadUsers function not available');
        }
      }, 100);
    }
  };
}

if (!window.showConnectionStatus) {
  window.showConnectionStatus = function(show) {
    const el = document.getElementById("connectionStatus");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  };
}

if (!window.showToast) {
  window.showToast = function(msg) {
    const t = document.getElementById("toast");
    if (!t) return alert(msg);
    t.classList.remove("hidden");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
  };
}

// 실시간 표시
window.updateTrainingDisplay = function () {
  const p = document.getElementById("currentPowerValue");
  const h = document.getElementById("heartRateValue");
  const bar = document.getElementById("powerProgressBar");
  const t = document.getElementById("targetPowerValue");

  const currentPower = liveData.power || 0;
  const target = liveData.targetPower || 200; // 기준값
  const hr = liveData.heartRate || 0;

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

  // 중앙 디스플레이에 펄스 애니메이션 추가
  const powerDisplay = document.querySelector("#trainingScreen .power-display");
  if (powerDisplay) {
    if (currentPower > 0) powerDisplay.classList.add("active");
    else powerDisplay.classList.remove("active");

    // 훈련화면에 케이던스 표시
    const c = document.getElementById("cadenceValue");
    if (c && typeof liveData.cadence === "number") c.textContent = Math.round(liveData.cadence);
  }
};

// (카운트다운 + Beep + 자동 시작)
function startWithCountdown(sec = 5) {
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  if (!overlay || !num) return startWorkoutTraining(); // 없으면 바로 시작

  // 오버레이 확실히 표시
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";

  let remain = sec;
  num.textContent = remain;

  // 첫 숫자 노출과 동시에 짧은 Beep
  playBeep(880, 120, 0.25);

  const timer = setInterval(async () => {
    remain -= 1;

    if (remain <= 0) {
      clearInterval(timer);

      // 마지막은 길고 높은 Beep
      await playBeep(1500, 700, 0.35, "square");

      // 오버레이 닫고 실제 시작
      overlay.classList.add("hidden");
      overlay.style.display = "none";
      startWorkoutTraining();
      return;
    }

    // 매초 짧은 Beep
    num.textContent = remain;
    playBeep(880, 120, 0.25);
  }, 1000);
}

// 시작 시 복구 시도 (startWorkoutTraining 맨 앞)
function startWorkoutTraining() {
  // 훈련 시작 직전(예: startWorkoutTraining()에서) 리셋:
  Object.assign(trainingMetrics, {
    elapsedSec: 0, joules: 0, ra30: 0, np4sum: 0, count: 0
  });
  
  // (A) 워크아웃 보장: 캐시 복구 포함
  if (!window.currentWorkout) {
    try {
      const cached = localStorage.getItem("currentWorkout");
      if (cached) window.currentWorkout = JSON.parse(cached);
    } catch (_) {}
  }
  if (!window.currentWorkout) {
    showToast && showToast("워크아웃을 먼저 선택하세요");
    return showScreen && showScreen("workoutScreen");
  }

  // (B) 상태 초기화 (일시정지 해제 + 타이머 변수 초기화)
  if (typeof setPaused === "function") setPaused(false);
  if (window.trainingState) {
    trainingState.elapsedSec = 0;
    trainingState.segElapsedSec = 0;
    trainingState.segIndex = 0;
  }
  // 카운트다운 직후 훈련 시작 때마다 TSS/kcal 계산용 누적 상태
  Object.assign(trainingMetrics, {
    elapsedSec: 0,
    joules: 0,
    ra30: 0,
    np4sum: 0,
    count: 0
  });
  
  // (C) 세그먼트 타임라인 생성(있을 때만)
  if (typeof buildSegmentBar === "function") buildSegmentBar();

  // (D) 첫 세그먼트 타겟/이름 적용 + 시간 UI 1회 갱신 (있을 때만)
  if (typeof applySegmentTarget === "function") applySegmentTarget(0);
  if (typeof updateTimeUI === "function") updateTimeUI();

  // (E) 화면 전환
  if (typeof showScreen === "function") showScreen("trainingScreen");

  // 사용자 정보 출력
  if (typeof renderUserInfo === "function") renderUserInfo();   

  // (F) 첫 프레임 즉시 렌더(깜빡임 방지)
  if (typeof window.updateTrainingDisplay === "function") window.updateTrainingDisplay();

  // (G) 1Hz 루프 시작 (세그먼트/시간 진행)
  if (typeof startSegmentLoop === "function") startSegmentLoop();

  showToast && showToast("훈련을 시작합니다");
}

function backToWorkoutSelection() {
  showScreen("workoutScreen");
}

// 훈련 화면 상단에 사용자 정보가 즉시 표시
function renderUserInfo() {
  const box = document.getElementById("userInfo");
  const u = window.currentUser;
  if (!box) return;

  if (!u) { box.textContent = "사용자 미선택"; return; }

  const cleanName = String(u.name || "").replace(/^👤+/g, "").trim();
  const ftp = Number(u.ftp);
  const wt  = Number(u.weight);
  const wkg = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0) ? (ftp / wt).toFixed(2) : "-";

  box.textContent = `${cleanName} · FTP ${Number.isFinite(ftp) ? ftp : "-"}W · ${wkg} W/kg`;
}

// 일시정지/재개 함수
function setPaused(isPaused) {
  trainingState.paused = !!isPaused;

  // 버튼 라벨/아이콘 업데이트
  const btn = document.getElementById("btnTogglePause");
  const icon = document.getElementById("pauseIcon");
  if (btn)  btn.textContent = trainingState.paused ? " ▶️" : " ⏸️";
  if (icon) icon.textContent = trainingState.paused ? "▶️" : "⏸️";

  // (선택) 토스트/상태 표시
  if (typeof showToast === "function") {
    showToast(trainingState.paused ? "일시정지됨" : "재개됨");
  }
}

function togglePause() {
  setPaused(!trainingState.paused);
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
    const info = document.getElementById("iosInfo");
    if (info) info.classList.remove("hidden");

    ["btnConnectPM","btnConnectTrainer","btnConnectHR"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add("is-disabled");
        el.setAttribute("aria-disabled","true");
        el.title = "iOS Safari에서는 블루투스 연결이 지원되지 않습니다";
      }
    });

    // null 체크 강화
    const btn = document.getElementById("btnIosContinue");
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
    showToast("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
    console.error("Web Bluetooth not supported");
  }
  
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    showToast("BLE를 사용하려면 HTTPS가 필요합니다.");
    console.warn("HTTPS required for BLE");
  }
  
  showScreen("connectionScreen");

  // 훈련 준비 → 훈련 시작
  const btnStartTraining = document.getElementById("btnStartTraining");
  if (btnStartTraining) {
    btnStartTraining.addEventListener("click", () => startWithCountdown(5));
  }

  // 훈련 준비 → 워크아웃 변경
  document.getElementById("btnBackToWorkouts")?.addEventListener("click", () => {
    backToWorkoutSelection();
  });

  // loadUsers()가 userProfiles도 인식하게(방어)
  function loadUsers() {
    const box = document.getElementById("userList");
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
  const btnHR = document.getElementById("btnConnectHR");
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnPM = document.getElementById("btnConnectPM");
  
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
        showToast("심박계 연결 함수를 찾을 수 없습니다.");
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

  // 다파워소스 우선순위도 같이 표기
  function updateDevicesList() {
    const box = document.getElementById("connectedDevicesList");
    if (!box) return;

    const pm = connectedDevices?.powerMeter;
    const tr = connectedDevices?.trainer;
    const hr = connectedDevices?.heartRate;

    const active = getActivePowerSource();
    const pmBadge = pm ? (active==="powermeter" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";
    const trBadge = tr ? (active==="trainer" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";

    box.innerHTML = `
      ${pm ? `<div class="dev">⚡ 파워미터: ${pm.name}${pmBadge}</div>` : ""}
      ${tr ? `<div class="dev">🚲 스마트 트레이너: ${tr.name}${trBadge}</div>` : ""}
      ${hr ? `<div class="dev">❤️ 심박계: ${hr.name}</div>` : ""}
    `;
  }

  // 워크아웃 변경 버튼
  const btnBackToWorkouts = document.getElementById("btnBackToWorkouts");
  if (btnBackToWorkouts) {
    btnBackToWorkouts.addEventListener("click", backToWorkoutSelection);
  }

  // 일시정지/재개
  const btnPause = document.getElementById("btnTogglePause");
  if (btnPause) {
    btnPause.addEventListener("click", togglePause);
  }

  // 구간 건너뛰기
  document.getElementById("btnSkipSegment")?.addEventListener("click", () => {
    const w = window.currentWorkout;
    if (!w) return;
    trainingState.segIndex = Math.min(w.segments.length - 1, trainingState.segIndex + 1);
    trainingState.segElapsedSec = 0;
    applySegmentTarget(trainingState.segIndex);
    updateTimeUI();
  });

  // 훈련 종료
  document.getElementById("btnStopTraining")?.addEventListener("click", () => {
    stopSegmentLoop();
    showScreen("resultScreen");
  });

  console.log("App initialization complete!");

  if (isIOS()) enableIOSMode();
});

// 프로필 화면 이동 & 목록 로드: 단일 핸들러(안전)
(() => {
  const btn = document.getElementById("btnToProfile");
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
        document.getElementById("profilesContainer") ||
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

  const tssEl = document.getElementById("tssValue");
  const kcalEl = document.getElementById("kcalValue");
  if (tssEl) tssEl.textContent = TSS.toFixed(1);
  if (kcalEl) kcalEl.textContent = Math.round(kcal);
}

// 7. 전역 상태 접근을 위한 별칭 (호환성)
window.trainingState = window.trainingState || trainingState;
