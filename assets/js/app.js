/* ==========================================================
   app.js (v1.2 stable) - 수정된 버전
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

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
  }
};


// 5초 카운트다운 후 자동 시작
function startWithCountdown(sec = 5) {
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  if (!overlay || !num) {
    // 엘리먼트가 없으면 바로 시작
    return startWorkoutTraining();
  }

  overlay.classList.remove("hidden");
  let remain = sec;
  num.textContent = remain;

  const timer = setInterval(() => {
    remain -= 1;
    if (remain <= 0) {
      clearInterval(timer);
      overlay.classList.add("hidden");
      startWorkoutTraining();
    } else {
      num.textContent = remain;
    }
  }, 1000);
}




// 워크아웃 관련 함수들
// 선택 시 저장 (selectWorkout 안)
function selectWorkout(w) {
  window.currentWorkout = w;
  localStorage.setItem("currentWorkout", JSON.stringify(w)); // ✅ 저장
  showScreen("trainingReadyScreen");
  renderPreview();
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
  const w = window.currentWorkout;
  const ftp = (window.currentUser?.ftp) || 200; // 사용자 FTP가 없으면 임시 200W
  const first = w.segments?.[0];
  if (first?.ftp_percent) {
    window.liveData.targetPower = Math.round(ftp * (first.ftp_percent / 100));
  }

  // 2) 화면 전환
  showScreen("trainingScreen");

  // 3) 한 번 즉시 그려주기 (0 → 값 깜빡임 방지)
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();

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

// 단일 DOMContentLoaded 이벤트
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
   document.getElementById("btnStartTraining")?.addEventListener("click", () => {
     // 카운트다운이 필요 없으면 바로 시작
     startWorkoutTraining(); // 아래에서 정의됨(기존 전역 함수)
   });
   
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
  
  // 훈련 시작 버튼
  const btnStartTraining = document.getElementById("btnStartTraining");
  if (btnStartTraining) {
    btnStartTraining.addEventListener("click", startWorkoutTraining);
  }
  
  // 워크아웃 변경 버튼
  const btnBackToWorkouts = document.getElementById("btnBackToWorkouts");
  if (btnBackToWorkouts) {
    btnBackToWorkouts.addEventListener("click", backToWorkoutSelection);
  }
  
  console.log("App initialization complete!");
});

// Export
window.startWorkoutTraining = startWorkoutTraining;
window.backToWorkoutSelection = backToWorkoutSelection;
