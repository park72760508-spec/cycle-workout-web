/* ==========================================================
   app.js (v1.2 stable) - 수정된 버전
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

// ──────────────────────────────
// 타임라인 생성/업데이트 함수 추가
// ──────────────────────────────
function secToMinStr(sec){
  const m = Math.floor(sec/60);
  return `${m}분`;
}





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


// 훈련화면 ==> 메인 루프 시작/정지
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

  // 루프 시작(1Hz)
  clearInterval(trainingState.timerId);
  trainingState.timerId = setInterval(() => {
    if (trainingState.paused) return;

    trainingState.elapsedSec += 1;
    trainingState.segElapsedSec += 1;

    const i = trainingState.segIndex;
    const seg = w.segments[i];

    // 세그먼트 종료 → 다음 세그먼트
    if (seg && trainingState.segElapsedSec >= Math.floor(seg.duration)) {
      trainingState.segIndex += 1;
      trainingState.segElapsedSec = 0;

      if (trainingState.segIndex >= w.segments.length) {
        // 훈련 종료
        clearInterval(trainingState.timerId);
        trainingState.timerId = null;
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




// 시작 시 복구 시도 (startWorkoutTraining 맨 앞)
function startWorkoutTraining() {
  // 0) 캐시 복구 시도
  if (!window.currentWorkout) {
    const cached = localStorage.getItem("currentWorkout");
    if (cached) {
      window.currentWorkout = JSON.parse(cached);
    }
  }
  // 0-2) 여전히 없으면 목록으로
  if (!window.currentWorkout) {
    showToast("워크아웃을 먼저 선택하세요");
    showScreen("workoutScreen");
    return;
  }

  // 1) 첫 세그먼트 기준으로 targetPower 설정 (FTP % → W)
   // 1) 첫 세그먼트 기준으로 targetPower 설정
   const w = window.currentWorkout;
   const ftp = (window.currentUser?.ftp) || 200;
   const first = w.segments?.[0];
   
   if (first) {
     // 샘플 JSON: target(0~1), duration(초)
     // 혹은 다른 형식: ftp_percent(0~100)
     if (typeof first.target === "number") {
       window.liveData.targetPower = Math.round(ftp * first.target);
     } else if (typeof first.ftp_percent === "number") {
       window.liveData.targetPower = Math.round(ftp * (first.ftp_percent / 100));
     }
   }


   // ▼ 사용자 정보!)
   renderUserInfo();

   
  // 2) 화면 전환
  showScreen("trainingScreen");

  // 3) 한 번 즉시 그려주기 (0 → 값 깜빡임 방지)
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();

   // ✅ 루프 시작 (훈련화면)
   startSegmentLoop();   

   
  // 4) (옵션) 모의 파워 데이터 타이머
  // if (window.__mock) clearInterval(window.__mock);
  // window.__mock = setInterval(() => {
  //   window.liveData.power = Math.max(
  //     0,
  //     (window.liveData.power || 0) + (Math.random()*20 - 10)
  //   );
  //   window.updateTrainingDisplay && window.updateTrainingDisplay();
  // }, 1000);

  showToast("훈련을 시작합니다");
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
   document.getElementById("btnToProfile")?.addEventListener("click", () => {
     showScreen("profileScreen");
     loadUsers();
   });

   
  
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



   
  // 훈련 시작 버튼
  //const btnStartTraining = document.getElementById("btnStartTraining");
  //if (btnStartTraining) {
    //btnStartTraining.addEventListener("click", );
  //}
  
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
function renderUserInfo() {
  // 캐시 복구(새로고침 대비)
  if (!window.currentUser) {
    try {
      const cached = localStorage.getItem("currentUser");
      if (cached) window.currentUser = JSON.parse(cached);
    } catch (e) {}
  }
  const u = window.currentUser;
  const box = document.getElementById("userInfo");
  if (!box) return;

  if (!u) {
    box.innerHTML = `<span class="muted">사용자 미선택</span>`;
    return;
  }
  const wkg = (u.weight && u.ftp) ? (u.ftp / u.weight).toFixed(2) : "-";
  box.innerHTML = `
    <strong>${u.name}</strong>
    <span class="muted">· FTP ${u.ftp}W · ${wkg} W/kg</span>
  `;
}
window.renderUserInfo = renderUserInfo; // 전역에서 재사용 가능


