// ===========================================
// Cycle Workout Web App (v5.0) - app.js
// ===========================================

// ✅ Google Apps Script 연동 URL
const GAS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec";

// ✅ 전역 상태 관리
let currentScreen = "connectionScreen";
let connectedDevices = { trainer: null, powerMeter: null, heartRate: null };
let isTraining = false;
let isPaused = false;
let currentSegment = 0;
let totalSegments = 0;
let workoutData = [];
let elapsedTime = 0;
let timerInterval = null;

// ===========================================
// 화면 전환
// ===========================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  currentScreen = id;
}

// ===========================================
// 사용자 프로필 관리
// ===========================================
async function loadUserProfiles() {
  const res = await fetch(`${GAS_WEB_APP_URL}?action=getUsers`);
  const users = await res.json();
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  users.forEach((u) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h3>${u.name}</h3><p>FTP: ${u.ftp}W | ${u.weight}kg</p>`;
    el.onclick = () => selectUser(u);
    list.appendChild(el);
  });
}

function showAddUserForm() {
  document.getElementById("addUserForm").classList.remove("hidden");
}

async function saveNewUser() {
  const name = document.getElementById("userName").value;
  const ftp = +document.getElementById("userFTP").value;
  const weight = +document.getElementById("userWeight").value;
  const contact = document.getElementById("userContact").value;

  const body = { action: "addUser", name, ftp, weight, contact };
  const res = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (result.success) {
    alert("✅ 사용자 등록 완료");
    loadUserProfiles();
  } else {
    alert("⚠️ 사용자 추가 중 오류가 발생했습니다");
  }
}

// ===========================================
// 워크아웃 관리
// ===========================================
async function loadWorkouts() {
  const res = await fetch(`${GAS_WEB_APP_URL}?action=getWorkouts`);
  const workouts = await res.json();
  const list = document.getElementById("workoutList");
  list.innerHTML = "";
  workouts.forEach((w) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h3>${w.name}</h3><p>${w.duration}분 | ${w.intensity}% | ${w.tss}TSS</p>`;
    card.onclick = () => selectWorkout(w);
    list.appendChild(card);
  });
}

function selectWorkout(w) {
  workoutData = w.segments;
  totalSegments = w.segments.length;
  document.getElementById("previewWorkoutName").textContent = w.name;
  document.getElementById("previewDuration").textContent = `${w.duration}분`;
  document.getElementById("previewIntensity").textContent = `${w.intensity}%`;
  document.getElementById("previewTSS").textContent = w.tss;
  showScreen("trainingReadyScreen");
}

// ===========================================
// 훈련 진행
// ===========================================
function startWorkoutTraining() {
  showScreen("trainingScreen");
  isTraining = true;
  currentSegment = 0;
  elapsedTime = 0;
  updateTrainingUI();
  timerInterval = setInterval(trainingTick, 1000);
}

function trainingTick() {
  if (!isTraining || isPaused) return;
  elapsedTime++;
  document.getElementById("elapsedTime").textContent = formatTime(elapsedTime);
  // 훈련 구간 로직 등 추가
}

function togglePause() {
  isPaused = !isPaused;
  document.getElementById("pauseIcon").textContent = isPaused ? "▶️" : "⏸️";
}

function stopTraining() {
  isTraining = false;
  clearInterval(timerInterval);
  showScreen("resultScreen");
  analyzeAIResult();
}

function skipSegment() {
  if (currentSegment < totalSegments - 1) currentSegment++;
  updateTrainingUI();
}

// ===========================================
// 훈련 결과 및 AI 분석
// ===========================================
async function analyzeAIResult() {
  const aiBox = document.getElementById("aiAnalysis");
  aiBox.textContent = "AI 분석 중...";
  const res = await fetch(`${GAS_WEB_APP_URL}?action=analyzePerformance&sessionId=auto`);
  const data = await res.json();
  aiBox.textContent = data.analysis || "분석 결과를 가져오지 못했습니다.";
}

// ===========================================
// BLE 장치 연결 상태 (bluetooth.js에서 처리)
// ===========================================
function updateDeviceStatusUI() {
  const list = document.getElementById("connectedDevicesList");
  list.innerHTML = Object.entries(connectedDevices)
    .map(([key, dev]) => `<p>${key}: ${dev ? dev.name : "❌ 미연결"}</p>`)
    .join("");
}

// ===========================================
// 유틸 함수
// ===========================================
function formatTime(sec) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function goHome() {
  showScreen("connectionScreen");
}

// ===========================================
// BLE 실시간 데이터 UI 업데이트 + ERG 제어
// ===========================================

// 훈련 화면의 파워/심박/케이던스 값 실시간 반영
function updateTrainingDisplay() {
  const { power, cadence, heartRate, targetPower } = liveData;
  document.getElementById("currentPowerValue").textContent = power;
  document.getElementById("cadenceValue").textContent = cadence;
  document.getElementById("heartRateValue").textContent = heartRate;
  document.getElementById("targetPowerValue").textContent = targetPower;
  document.getElementById("achievementValueBar").textContent = Math.round(
    (power / (targetPower || 1)) * 100
  );
  const bar = document.getElementById("powerProgressBar");
  if (bar) bar.style.width = `${Math.min(100, (power / (targetPower || 1)) * 100)}%`;
}

// 목표 파워값 변경 시 FTMS로 전송
function updateERGTarget() {
  if (connectedDevices.trainer) {
    const target = workoutData[currentSegment]?.targetPower || 150;
    setTargetPower(target);
  }
}

// 훈련 루프 내부에서 1초마다 업데이트
function trainingTick() {
  if (!isTraining || isPaused) return;
  elapsedTime++;
  document.getElementById("elapsedTime").textContent = formatTime(elapsedTime);

  // 실시간 BLE 데이터 반영
  updateTrainingDisplay();

  // 구간 타이머 관리
  if (elapsedTime % 5 === 0) updateERGTarget();

  // 자동 구간 전환 (예시)
  if (elapsedTime > workoutData[currentSegment]?.durationSec) {
    if (currentSegment < totalSegments - 1) {
      currentSegment++;
      updateERGTarget();
      document.getElementById("currentSegmentName").textContent =
        workoutData[currentSegment].name;
    } else {
      stopTraining();
    }
  }
}

