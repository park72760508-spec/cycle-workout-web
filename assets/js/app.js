/* ==========================================================
   Cycle Workout App Controller (원본 1009V1 기반)
   - 화면 전환
   - BLE 연결 요약 및 진행
   - 훈련 제어 (카운트다운, 일시정지, 종료, 결과)
========================================================== */

/* ==========================================================
   CONFIG – Google Apps Script Web App URL 설정
========================================================== */
const CONFIG = {
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec"
};


window.liveData = {
  power: 0,
  cadence: 0,
  heartRate: 0,
  elapsed: 0,
  tss: 0,
  isPaused: false,
};

let currentScreen = "connectionScreen";
let countdownTimer = null;
let trainingTimer = null;
let trainingStartTime = null;
let totalDurationSec = 60 * 10; // 기본 10분, 워크아웃 로드 시 변경
let segmentProgress = 0;

/* ==========================================================
   1️⃣ 화면 전환
========================================================== */
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  const next = document.getElementById(screenId);
  if (next) next.classList.add("active");
  currentScreen = screenId;
  console.log(`📺 화면 전환: ${screenId}`);
}

function proceedToProfile() {
  if (
    !connectedDevices.trainer &&
    !connectedDevices.powerMeter &&
    !connectedDevices.heartRate
  ) {
    alert("훈련을 시작하려면 최소 하나 이상의 BLE 기기를 연결해야 합니다.");
    return;
  }
  showScreen("profileScreen");
}

/* ==========================================================
   2️⃣ 사용자 추가 / 선택
========================================================== */
const btnSaveUser = document.getElementById("btnSaveUser");
if (btnSaveUser) {
  btnSaveUser.addEventListener("click", async () => {
    const name = document.getElementById("userName").value.trim();
    const contact = document.getElementById("userContact").value.trim();
    const ftp = document.getElementById("userFTP").value.trim();
    const weight = document.getElementById("userWeight").value.trim();
    if (!name || !ftp || !weight) {
      alert("필수 항목을 모두 입력해주세요.");
      return;
    }

    // Google Apps Script로 전송
    try {
      const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "addUser",
          name,
          contact,
          ftp,
          weight,
        }),
      });
      const data = await res.json();
      alert(`✅ 사용자 저장 완료: ${data.status || "OK"}`);
      showScreen("workoutScreen");
    } catch (e) {
      console.error(e);
      alert("❌ 사용자 추가 중 오류가 발생했습니다.");
    }
  });
}

/* ==========================================================
   3️⃣ 훈련 제어 (시작 / 일시정지 / 종료)
========================================================== */
function startTrainingCountdown() {
  showScreen("trainingReadyScreen");
  const overlay = document.getElementById("countdownOverlay");
  const number = document.getElementById("countdownNumber");
  overlay.classList.remove("hidden");
  let count = 5;
  number.textContent = count;

  countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      number.textContent = count;
    } else {
      clearInterval(countdownTimer);
      overlay.classList.add("hidden");
      startTraining();
    }
  }, 1000);
}

function startTraining() {
  showScreen("trainingScreen");
  trainingStartTime = Date.now();
  window.liveData.elapsed = 0;
  window.liveData.isPaused = false;
  trainingTimer = setInterval(updateTraining, 1000);
}

function updateTraining() {
  if (window.liveData.isPaused) return;
  const now = Date.now();
  const elapsedSec = Math.floor((now - trainingStartTime) / 1000);
  window.liveData.elapsed = elapsedSec;
  segmentProgress = Math.min(100, (elapsedSec / totalDurationSec) * 100);

  // UI 업데이트
  document.getElementById("elapsedTime").textContent = formatTime(elapsedSec);
  document.getElementById("segmentProgress").textContent = segmentProgress.toFixed(0);
  document.getElementById("timelineSegments").style.width = `${segmentProgress}%`;
  document.getElementById("powerProgressBar").style.width =
    Math.min(100, (liveData.power / (liveData.targetPower || 200)) * 100) + "%";
}

function togglePause() {
  window.liveData.isPaused = !window.liveData.isPaused;
  document.getElementById("pauseIcon").textContent = window.liveData.isPaused ? "▶️" : "⏸️";
}

function stopTraining() {
  clearInterval(trainingTimer);
  showResultScreen();
}

/* ==========================================================
   4️⃣ 결과 화면
========================================================== */
function showResultScreen() {
  showScreen("resultScreen");
  const avgPower = Math.round(Math.random() * 100 + 150);
  const tss = Math.round(segmentProgress);
  document.getElementById("finalAchievement").textContent = `${tss}%`;
  document.getElementById("resultAvgPower").textContent = avgPower;
  document.getElementById("resultMaxPower").textContent = avgPower + 80;
  document.getElementById("resultAvgHR").textContent = liveData.heartRate || 0;
  document.getElementById("resultCalories").textContent = Math.round(tss * 8.9);

  // Google Apps Script로 저장
  try {
    fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "saveResult",
        avgPower,
        tss,
        heartRate: liveData.heartRate,
      }),
    });
  } catch (e) {
    console.error("결과 저장 오류:", e);
  }
}

/* ==========================================================
   5️⃣ 유틸리티
========================================================== */
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ==========================================================
   6️⃣ 버튼 이벤트 바인딩
========================================================== */
document.getElementById("btnToProfile")?.addEventListener("click", proceedToProfile);
document.getElementById("btnStartTraining")?.addEventListener("click", startTrainingCountdown);
document.getElementById("btnTogglePause")?.addEventListener("click", togglePause);
document.getElementById("btnStopTraining")?.addEventListener("click", stopTraining);
document.getElementById("btnGoHome")?.addEventListener("click", () => showScreen("connectionScreen"));

/* ==========================================================
   7️⃣ 초기화
========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  showScreen("connectionScreen");
  updateDevicesList();
  console.log("🚀 앱 초기화 완료");
});
