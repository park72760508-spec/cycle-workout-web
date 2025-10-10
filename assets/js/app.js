/* ==========================================================
   app.js (v1.2 stable) - 수정된 버전
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

// 중복 선언 방지
if (!window.showScreen) {
  window.showScreen = function(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
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
  const c = document.getElementById("cadenceValue");
  const h = document.getElementById("heartRateValue");
  const t = document.getElementById("targetPowerValue");
  if (p) p.textContent = Math.round(liveData.power || 0);
  if (c) c.textContent = Math.round(liveData.cadence || 0);
  if (h) h.textContent = Math.round(liveData.heartRate || 0);
  if (t) t.textContent = Math.round(liveData.targetPower || 0);

  const bar = document.getElementById("powerProgressBar");
  if (bar) {
    const pct = liveData.targetPower > 0 ? Math.max(0, Math.min(100, (liveData.power / liveData.targetPower) * 100)) : 0;
    bar.style.width = pct + "%";
  }
};

// 워크아웃 관련 함수들
function startWorkoutTraining() {
  showScreen("trainingScreen");
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
