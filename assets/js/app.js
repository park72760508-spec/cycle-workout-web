/* ======================================================
   CYCLE WORKOUT APP LOGIC (v1009)
   - 화면 전환
   - 훈련 로직
   - 카운트다운, 결과 계산
   - Google Apps Script 연동
====================================================== */

const GAS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbw3S9rMcLkOYQXGLH0uZx8IKR5Aap-i453Nt1jwgPJ5moV65vq6MaynozfZHmJV81He/exec";

let currentScreen = "connectionScreen";
let currentWorkout = null;
let selectedUser = null;
let isTraining = false;
let isPaused = false;
let elapsedSeconds = 0;
let totalTSS = 0;
let updateLoop = null;

/* ---------------------------
   화면 전환
--------------------------- */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  currentScreen = id;
}

/* ---------------------------
   초기화
--------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  showScreen("connectionScreen");
  initEventHandlers();
  console.log("🚀 Cycle Workout App Loaded");
});

function initEventHandlers() {
  const map = {
    btnConnectTrainer: connectTrainer,
    btnConnectHeart: connectHeartRate,
    btnConnectPower: connectPowerMeter,
    btnProceedToProfile: () => showScreen("profileScreen"),
    btnStartTraining: startTraining,
    btnStopTraining: stopTraining,
    btnPauseResume: togglePause,
    btnSkipSegment: skipSegment,
    btnNewTraining: () => showScreen("connectionScreen"),
  };
  for (const [id, fn] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }
}

/* ---------------------------
   훈련 시작
--------------------------- */
function startTraining() {
  showCountdown(() => {
    showScreen("trainingScreen");
    startWorkoutLoop();
  });
}

/* ---------------------------
   훈련 메인 루프
--------------------------- */
function startWorkoutLoop() {
  isTraining = true;
  isPaused = false;
  elapsedSeconds = 0;
  totalTSS = 0;

  updateLoop = setInterval(() => {
    if (isPaused) return;
    elapsedSeconds++;

    // UI 업데이트
    updateTrainingUI();

    // 간단한 TSS 계산 (파워 기준)
    const ftp = selectedUser?.ftp || 250;
    const power = liveData.power || 0;
    const intensity = power / ftp;
    const tssIncrement = ((intensity ** 2) * (1 / 3600)) * 100; // 1초 단위
    totalTSS += tssIncrement;
    document.getElementById("tssValue").textContent = totalTSS.toFixed(1);

    // 경과시간 표시
    const min = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const sec = String(elapsedSeconds % 60).padStart(2, "0");
    document.getElementById("elapsedTime").textContent = `${min}:${sec}`;
  }, 1000);
}

/* ---------------------------
   일시정지 / 재개
--------------------------- */
function togglePause() {
  if (!isTraining) return;
  isPaused = !isPaused;
  const icon = document.getElementById("pauseIcon");
  icon.textContent = isPaused ? "▶️" : "⏸️";
}

/* ---------------------------
   구간 스킵 (테스트용)
--------------------------- */
function skipSegment() {
  alert("⏭️ 다음 세그먼트로 이동 (개발 중)");
}

/* ---------------------------
   훈련 종료
--------------------------- */
function stopTraining() {
  if (!isTraining) return;
  clearInterval(updateLoop);
  isTraining = false;
  showScreen("resultScreen");

  // 결과 데이터 표시
  document.getElementById("resultAvgPower").textContent = liveData.power || 0;
  document.getElementById("resultAvgHR").textContent = liveData.heartRate || 0;
  document.getElementById("resultCalories").textContent = (liveData.power * elapsedSeconds / 420).toFixed(0);
  document.getElementById("finalAchievement").textContent = Math.min(100, (liveData.power / liveData.targetPower) * 100).toFixed(0) + "%";

  // GAS 저장
  saveResultToGAS();
}

/* ---------------------------
   카운트다운
--------------------------- */
function showCountdown(callback) {
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  let count = 5;
  overlay.classList.remove("hidden");
  num.textContent = count;

  const timer = setInterval(() => {
    count--;
    num.textContent = count;
    if (count <= 0) {
      clearInterval(timer);
      overlay.classList.add("hidden");
      if (callback) callback();
    }
  }, 1000);
}

/* ---------------------------
   결과 저장 (GAS)
--------------------------- */
async function saveResultToGAS() {
  try {
    const payload = {
      user: selectedUser?.name || "게스트",
      avgPower: liveData.power,
      heartRate: liveData.heartRate,
      duration: elapsedSeconds,
      tss: totalTSS.toFixed(1),
      date: new Date().toISOString(),
    };
    const res = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    console.log("✅ GAS 저장 결과:", data);
  } catch (e) {
    console.error("❌ GAS 저장 오류:", e);
  }
}

/* ---------------------------
   AI 분석 (샘플)
--------------------------- */
async function analyzeAIResult() {
  const aiBox = document.getElementById("aiAnalysis");
  aiBox.textContent = "AI 분석 중...";
  setTimeout(() => {
    aiBox.textContent = "이번 훈련은 목표 파워 대비 92% 달성했습니다. 심박수 안정성과 피로 관리가 우수하며, 다음 세션은 FTP +10W 추천합니다.";
  }, 2500);
}
