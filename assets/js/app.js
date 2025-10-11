/* ==========================================================
   app.js (v1.2 stable) - 수정된 버전
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;
window.loadUsers = loadUsers

// ── 훈련 지표 상태 (TSS / kcal / NP 근사) ─────────────────
const trainingMetrics = {
  elapsedSec: 0,      // 전체 경과(초)
  joules: 0,          // 누적 일(줄). 1초마다 W(=J/s)를 더해줌
  ra30: 0,            // 30초 롤링 평균 파워(근사: 1차 IIR)
  np4sum: 0,          // (ra30^4)의 누적합
  count: 0            // 표본 개수(초 단위)
};


// ──────────────────────────────
// 타임라인 생성/업데이트 함수 추가
// ──────────────────────────────
function secToMinStr(sec){
  const m = Math.floor(sec/60);
  return `${m}분`;
}

// ──────────────────────────────
// 사용자 목록
// ──────────────────────────────

showScreen("profileScreen");
loadUsers();  // 또는 typeof 체크 후 호출


// ──────────────────────────────
// Beep 사운드 (Web Audio)
// ──────────────────────────────
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


// ──────────────────────────────
// 훈련화면 시간 및 훈련 상태/유틸 + 훈련 상태 전역 (파일 상단 유틸 근처)
// ──────────────────────────────
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

// 훈련 상태 => 세그먼트별 달성도”를 시간 기준 달성도(=진행률)로 표현
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
} // ✅ 누락됐던 닫는 중괄호 추가

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

// 메인 업데이트 함수(1초마다 호출):
function updateSegmentBarTick(){
  const w = window.currentWorkout;
  const ftp = (window.currentUser?.ftp) || 200;
  if (!w) return;

  // 총 경과/현재 세그먼트/세그 경과는 기존 trainingState를 그대로 사용
  const elapsed = (window.trainingState?.elapsedSec) || 0;
  const segIndex = (window.trainingState?.segIndex) || 0;
  const segElapsed = (window.trainingState?.segElapsedSec) || 0;

  // 1) 각 세그먼트 채우기 폭(시간 기반)
  let startAt = 0;
  for (let i=0; i<w.segments.length; i++){
    const seg = w.segments[i];
    const dur = segDurationSec(seg);
    const endAt = startAt + dur;
    const fill = document.getElementById(`segFill-${i}`);
    if (fill){
      let pct = 0;
      if (elapsed >= endAt) pct = 100;                     // 완료
      else if (elapsed <= startAt) pct = 0;                // 아직 시작 전
      else pct = Math.min(100, Math.round((elapsed - startAt) / dur * 100)); // 진행 중
      fill.style.width = pct + "%";
    }
    startAt = endAt;
  }

  // 2) 달성도 색상(세그 평균 파워 / 목표 파워)
  // - 표본: liveData.power를 1초당 하나씩 누적
  const p = Math.max(0, Number(window.liveData?.power) || 0);
  if (w.segments[segIndex]) {
    segBar.sumPower[segIndex] += p;
    segBar.samples[segIndex]  += 1;
  }

  // 현재/완료 세그먼트의 평균과 목표 비교해서 색 지정
  for (let i=0; i<w.segments.length; i++){
    const seg = w.segments[i];
    const targetW = segTargetW(seg, ftp);
    const avgW = segBar.samples[i] ? (segBar.sumPower[i] / segBar.samples[i]) : 0;
    const ratio = targetW > 0 ? (avgW / targetW) : 0;
    const fill = document.getElementById(`segFill-${i}`);
    if (fill) fill.style.background = colorByAchievement(ratio);
  }
}



// 훈련 상태---------------------------------------OLD---------------------------------------------------
const trainingState = {
  timerId: null,
  paused: false,
  elapsedSec: 0,           // 총 경과(초)
  segIndex: 0,             // 현재 세그먼트 인덱스
  segElapsedSec: 0,        // 현재 세그먼트 내 경과(초)
  segEnds: [],             // 누적 종료시각 배열(초)
  totalSec: 0              // 총 훈련 시간(초)
};

// 훈련 상태 => 시간/세그먼트 UI 갱신 함수
function updateTimeUI() {
  const w = window.currentWorkout;
  if (!w) return;

  const elElapsed = document.getElementById("elapsedTime");
  const elElapsedPct = document.getElementById("elapsedPercent");
  const elSegTime = document.getElementById("segmentTime");
  const elNext = document.getElementById("nextSegment");
  const elSegPct = document.getElementById("segmentProgress");
  const barTimeline = document.getElementById("timelineSegments");

  // 총 진행률
  const elapsed = trainingState.elapsedSec;
  const total = trainingState.totalSec || 1;
  const totalPct = Math.min(100, Math.round((elapsed / total) * 100));
  if (elElapsed) elElapsed.textContent = formatMMSS(elapsed);
  if (elElapsedPct) elElapsedPct.textContent = totalPct;

  // 현재 세그먼트
  const i = trainingState.segIndex;
  const seg = w.segments[i];
  const segRemain = seg ? Math.max(0, Math.floor(seg.duration - trainingState.segElapsedSec)) : 0;
  if (elSegTime) elSegTime.textContent = formatMMSS(segRemain);

  // 다음 세그먼트 안내
  const next = w.segments[i + 1];
  if (elNext) {
    if (next) {
      const pct = typeof next.target === "number" ? Math.round(next.target * 100)
                : (typeof next.ftp_percent === "number" ? Math.round(next.ftp_percent) : 0);
      elNext.textContent = `다음: ${next.label || "세그먼트"} FTP ${pct}%`;
    } else {
      elNext.textContent = `다음: (마지막)`;
    }
  }

  // 현재 세그먼트 진행률
  if (elSegPct && seg) {
    const sp = Math.min(100, Math.round((trainingState.segElapsedSec / seg.duration) * 100));
    elSegPct.textContent = sp;
  }

  // 타임라인 바
  if (barTimeline) {
    barTimeline.style.width = `${totalPct}%`;
  }
}

// 훈련 상태 ==> 세그먼트 전환 + 타겟파워 갱신
function applySegmentTarget(i) {
  const w = window.currentWorkout;
  const ftp = (window.currentUser?.ftp) || 200;
  const seg = w?.segments?.[i];
  if (!seg) return;

  if (typeof seg.target === "number") {
    window.liveData.targetPower = Math.round(ftp * seg.target);
  } else if (typeof seg.ftp_percent === "number") {
    window.liveData.targetPower = Math.round(ftp * (seg.ftp_percent / 100));
  }

  const segName = document.getElementById("currentSegmentName");
  if (segName) segName.textContent = seg.label || `세그먼트 ${i + 1}`;

  // 첫 프레임 즉시 반영
  window.updateTrainingDisplay && window.updateTrainingDisplay();
}


// -------------------------------------------------
// 시작/루프에 연결 (딱 두 줄
// 중요 루프 
// ------------------------------------------------
function startSegmentLoop() {
  const w = window.currentWorkout;
  if (!w) return;

  // 누적 종료시각 배열 계산
  trainingState.segEnds = [];
  let acc = 0;
  for (const s of w.segments) {
    acc += Math.max(0, Math.floor(s.duration || s.duration_sec || 0));
    trainingState.segEnds.push(acc);
  }
  trainingState.totalSec = acc;

  // 초기 상태
  trainingState.elapsedSec = 0;
  trainingState.segIndex = 0;
  trainingState.segElapsedSec = 0;
  trainingState.paused = false;

  applySegmentTarget(0);
  updateTimeUI();


// ── 세그먼트 바 상태 ─────────────────────────
const segBar = {
  totalSec: 0,     // 전체 운동 시간(초)
  ends: [],        // 각 세그먼트의 누적 종료시각(초)
  sumPower: [],    // 세그먼트별 평균 파워 계산용 합
  samples: [],     // 세그먼트별 표본 수(초)
};

// 초 → "m분" 짧은 표기
function secToMinShort(sec){ return `${Math.floor((sec||0)/60)}분`; }

// 세그먼트 배열에서 duration(초) 추출
function segDurationSec(seg){
  return (typeof seg.duration === "number" ? seg.duration
        : typeof seg.duration_sec === "number" ? seg.duration_sec : 0) | 0;
}

// 목표 파워(W) 얻기
function segTargetW(seg, ftp){
  if (typeof seg.target === "number") return Math.round(ftp * seg.target);
  if (typeof seg.ftp_percent === "number") return Math.round(ftp * (seg.ftp_percent/100));
  return 0;
}


// 세그먼트 바 만드는 함수를 추가:
function buildSegmentBar(){
  const cont = document.getElementById("timelineSegments");
  const w = window.currentWorkout;
  if (!cont || !w) return;

  const segs = w.segments || [];
  const total = segs.reduce((s, seg)=> s + segDurationSec(seg), 0) || 1;

  segBar.totalSec = total;
  segBar.ends = [];
  segBar.sumPower = Array(segs.length).fill(0);
  segBar.samples  = Array(segs.length).fill(0);

  let acc = 0;
  cont.innerHTML = segs.map((seg, i) => {
    const dur = segDurationSec(seg);
    acc += dur; segBar.ends[i] = acc;
    const widthPct = (dur / total) * 100;
    const label = seg.segment_type || seg.label || `세그 ${i+1}`;
    return `
      <div class="timeline-segment" data-index="${i}" style="width:${widthPct}%">
        <div class="progress-fill" id="segFill-${i}"></div>
        <span class="segment-label">${label}</span>
        <span class="segment-time">${secToMinShort(dur)}</span>
      </div>
    `;
  }).join("");
}

   
  // 루프 시작(1Hz)/ 1초 인터벌
  clearInterval(trainingState.timerId);
  trainingState.timerId = setInterval(() => {
    if (trainingState.paused) return;
   updateSegmentBarTick();
    trainingState.elapsedSec += 1;
    trainingState.segElapsedSec += 1;

    const i = trainingState.segIndex;
    const seg = w.segments[i];

   // setInterval(…, 1000) 내부
   if (!trainingState.paused) {
     // ... TSS/kcal 계산 ...
     const tssEl = document.getElementById("tssValue");
     const kcalEl = document.getElementById("kcalValue");
     if (tssEl)  tssEl.textContent  = TSS.toFixed(1);
     if (kcalEl) kcalEl.textContent = Math.round(kcal);
   }

    // 세그먼트 종료 → 다음 세그먼트
    if (seg && trainingState.segElapsedSec >= Math.floor(seg.duration)) {
      trainingState.segIndex += 1;
      trainingState.segElapsedSec = 0;

      if (trainingState.segIndex >= w.segments.length) {
        // 훈련 종료
        clearInterval(trainingState.timerId);
        trainingState.timerId = null;
         setPaused(false); // 다음 시작 대비
        showToast("훈련이 완료되었습니다!");
        showScreen("resultScreen");
        return;
      } else {
        applySegmentTarget(trainingState.segIndex);
      }
    }

    // 화면 갱신
    updateTimeUI();
    window.updateTrainingDisplay && window.updateTrainingDisplay();
  }, 1000);
}

function stopSegmentLoop() {
  clearInterval(trainingState.timerId);
  trainingState.timerId = null;
}

// ──────────────────────────────
// 훈련화면  끝 지점
// ──────────────────────────────




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


// 훈련 시작 전에 지표 리셋
Object.assign(trainingMetrics, {
  elapsedSec: 0,
  joules: 0,
  ra30: 0,
  np4sum: 0,
  count: 0
});


// 시작 시 복구 시도 (startWorkoutTraining 맨 앞)
// app.js (또는 app (3).js)에서 기존 startWorkoutTraining() 전체 교체
function startWorkoutTraining() {
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

  // (C) 세그먼트 타임라인 생성(있을 때만)
  if (typeof buildSegmentBar === "function") buildSegmentBar();

  // (D) 첫 세그먼트 타겟/이름 적용 + 시간 UI 1회 갱신(있을 때만)
  if (typeof applySegmentTarget === "function") applySegmentTarget(0);
  if (typeof updateTimeUI === "function") updateTimeUI();

  // (E) 화면 전환
  if (typeof showScreen === "function") showScreen("trainingScreen");

  // (F) 첫 프레임 즉시 렌더(깜빡임 방지)
  if (typeof window.updateTrainingDisplay === "function") window.updateTrainingDisplay();

  // (G) 1Hz 루프 시작 (세그먼트/시간 진행)
  if (typeof startSegmentLoop === "function") startSegmentLoop();

  showToast && showToast("훈련을 시작합니다");
}



function backToWorkoutSelection() {
  showScreen("workoutScreen");
}





   
// -------------------------------------
// 단일 DOMContentLoaded 이벤트/ 시작, 버튼 클릭
// ------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  console.log("===== APP INIT =====");
  
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

   // ✅ 훈련 준비 → 훈련 시작
   const btnStartTraining = document.getElementById("btnStartTraining");
   if (btnStartTraining) {
     btnStartTraining.addEventListener("click", () => startWithCountdown(5));
   }


   
   
   // ✅ 훈련 준비 → 워크아웃 변경
   document.getElementById("btnBackToWorkouts")?.addEventListener("click", () => {
     backToWorkoutSelection();
   });
   
   // ✅ 연결 요약 → 프로필 화면
   // 프로필 화면 이동 + 사용자 목록 로드(가드 포함)
   document.getElementById("btnToProfile")?.addEventListener("click", () => {
     if (typeof showScreen === "function") showScreen("profileScreen");
   
     if (typeof loadUsers === "function") {
       loadUsers();
     } else if (typeof renderUserList === "function") {
       renderUserList();
     } else {
       console.warn("사용자 목록 렌더러(loadUsers)가 없습니다.");
     }
   });

   
   //loadUsers()가 userProfiles도 인식하게(방어)
   function loadUsers() {
     const box = document.getElementById("userList");
     if (!box) return;
   
     // ✅ 어떤 이름이든 데이터가 있으면 잡아쓴다
     const list =
       (Array.isArray(window.users) && window.users.length ? window.users :
        Array.isArray(window.userProfiles) && window.userProfiles.length ? window.userProfiles :
        []);
   
     if (list.length === 0) {
       box.innerHTML = `<div class="muted">등록된 사용자가 없습니다.</div>`;
       return;
     }
   
        // ⬇⬇ 여기를 당신이 보낸 코드로 붙여넣기(= 교체) ⬇⬇
        box.innerHTML = list.map(u => `
          <div class="user-card" data-id="${u.id}">
            <div class="user-name">👤 ${u.name}</div>
            <div class="user-meta">FTP ${u.ftp}W</div>
            <button class="btn btn-primary" data-action="select">선택</button>
          </div>
        `).join("");
        // ⬆⬆ 여기까지 ⬆⬆
   
     box.onclick = (e) => {
       const btn = e.target.closest('[data-action="select"]');
       if (!btn) return;
       const card = btn.closest(".user-card");
       const id = card?.getAttribute("data-id");
       const user = list.find(x => String(x.id) === String(id));
       if (user && typeof window.selectProfile === "function") {
         window.selectProfile(user);
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
  
  // 다음 단계 버튼
  const btnToProfile = document.getElementById("btnToProfile");
  if (btnToProfile) {
    btnToProfile.addEventListener("click", () => {
      showScreen("profileScreen");
      if (window.renderProfiles) {
        window.renderProfiles();
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
  
  console.log("App initialization complete!");

   // 일시정지/재개
   document.getElementById("btnTogglePause")?.addEventListener("click", () => {
     trainingState.paused = !trainingState.paused;
     const icon = document.getElementById("pauseIcon");
     if (icon) icon.textContent = trainingState.paused ? "▶️" : "⏸️";
   });


   // 일시정지/재개   
function setPaused(isPaused) {
  trainingState.paused = !!isPaused;

  // 버튼 라벨/아이콘 업데이트
  const btn = document.getElementById("btnTogglePause");
  const icon = document.getElementById("pauseIcon");
  if (btn)  btn.textContent = trainingState.paused ? " ▶️ 재개" : " ⏸️ 일시정지";
  if (icon) icon.textContent = trainingState.paused ? "▶️" : "⏸️";

  // (선택) 토스트/상태 표시
  if (typeof showToast === "function") {
    showToast(trainingState.paused ? "일시정지됨" : "재개됨");
  }
}

function togglePause() {
  setPaused(!trainingState.paused);
}

// DOMContentLoaded 안에 추가:
document.addEventListener("DOMContentLoaded", () => {
  const btnPause = document.getElementById("btnTogglePause");
  if (btnPause) {
    btnPause.addEventListener("click", togglePause);
  }
});






   
  // 훈련 시작 버튼 tSS/kcal 갱신 블록도 가드
   
if (!trainingState.paused) {
  const ftp = (window.currentUser?.ftp) || 200;
  const p = Math.max(0, Number(window.liveData?.power) || 0);

  trainingMetrics.elapsedSec += 1;
  trainingMetrics.joules += p;                    // 1초당 J 누적
  trainingMetrics.ra30 += (p - trainingMetrics.ra30) / 30;
  trainingMetrics.np4sum += Math.pow(trainingMetrics.ra30, 4);
  trainingMetrics.count += 1;

  const NP = Math.pow(trainingMetrics.np4sum / trainingMetrics.count, 0.25);
  const IF = ftp ? (NP / ftp) : 0;
  const TSS = (trainingMetrics.elapsedSec / 3600) * (IF * IF) * 100;
  const kcal = trainingMetrics.joules / 1000;

  const tssEl = document.getElementById("tssValue");
  const kcalEl = document.getElementById("kcalValue");
  if (tssEl)  tssEl.textContent  = TSS.toFixed(1);
  if (kcalEl) kcalEl.textContent = Math.round(kcal);
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

   
});
// -------------------------------------
// 단일 DOMContentLoaded 이벤트/ 종료, 버튼 클릭
// ------------------------------------




// Export
window.startWorkoutTraining = startWorkoutTraining;
window.backToWorkoutSelection = backToWorkoutSelection;

// 훈련 화면 상단에 사용자 정보가 즉시 표시
// 사용자 정보 렌더
function renderUserInfo() {
  const box = document.getElementById("userInfo");
  const u = window.currentUser;
  if (!box) return;
  if (!u) {
    box.textContent = "👤 사용자 미선택";
    return;
  }
  // 몸무게 제외 표기
  box.innerHTML = `👤 <strong>${u.name}</strong> · FTP <strong>${u.ftp}</strong>W`;
}

//window.renderUserInfo = renderUserInfo; // 전역에서 재사용 가능

// 프로필 선택 직후(훈련 준비/훈련 화면에서 보이게)
if (typeof renderUserInfo === "function") renderUserInfo();

// startWorkoutTraining() 안, 화면 전환 직후
showScreen("trainingScreen");
renderUserInfo && renderUserInfo();

