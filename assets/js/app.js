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

/* ==========================================================
   Workouts 목록 로드 및 선택 UI
========================================================== */
async function loadWorkouts() {
  const container = document.getElementById("workoutList");
  if (!container) return;

  container.innerHTML = "<div class='muted'>불러오는 중...</div>";

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({ action: "getWorkouts" }),
    });
    const data = await res.json();

    if (!data.workouts || !data.workouts.length) {
      container.innerHTML = "<div class='muted'>등록된 훈련 프로그램이 없습니다.</div>";
      return;
    }

    container.innerHTML = "";
    data.workouts.forEach((w, idx) => {
      const card = document.createElement("div");
      card.className = "card workout-card";
      card.innerHTML = `
        <h3>${w.title}</h3>
        <p><strong>⏱ ${w.duration}분</strong> | 🎯 ${w.targetPower}W</p>
        <p class="muted">${w.description}</p>
        <button class="btn btn-success mt-10" onclick="selectWorkout(${idx})">선택</button>
      `;
      container.appendChild(card);
    });

    window.workoutData = data.workouts;
    console.log("✅ Workouts 불러오기 완료:", data.workouts.length);
  } catch (err) {
    console.error("❌ Workouts 로드 오류:", err);
    container.innerHTML = "<div class='muted'>로드 실패. 나중에 다시 시도해주세요.</div>";
  }
}

function selectWorkout(index) {
  if (!window.workoutData) return;
  const selected = window.workoutData[index];
  if (!selected) return;

  alert(`🎯 선택된 훈련: ${selected.title}\n목표 파워: ${selected.targetPower}W\n총 ${selected.duration}분`);
  // 훈련 세션에 값 반영
  liveData.targetPower = selected.targetPower;
  totalDurationSec = selected.duration * 60;
  showScreen("trainingReadyScreen");
}

/* ==========================================================
   사용자별 훈련 결과 통계 불러오기
========================================================== */
async function loadResultsStatsByUser(userName) {
  const container = document.getElementById("resultChart");
  if (!container) return;

  container.innerHTML = `<div class='muted'>${userName}님의 결과 데이터를 불러오는 중...</div>`;

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "getResultsDataByUser",
        name: userName,
      }),
    });
    const data = await res.json();

    if (!data.results || !data.results.length) {
      container.innerHTML = `<div class='muted'>${userName}님의 기록이 없습니다.</div>`;
      return;
    }

    google.charts.load("current", { packages: ["corechart"] });
    google.charts.setOnLoadCallback(() => drawResultsChart(data.results, userName));
  } catch (err) {
    console.error("결과 로드 오류:", err);
    container.innerHTML = "<div class='muted'>불러오기 실패</div>";
  }
}

function drawResultsChart(results, userName) {
  const container = document.getElementById("resultChart");
  if (!container) return;

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn("string", "날짜");
  dataTable.addColumn("number", "평균 파워");
  dataTable.addColumn("number", "TSS");
  dataTable.addColumn("number", "심박수");

  results.forEach(r => {
    const dateStr = new Date(r[0]).toLocaleDateString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
    });
    dataTable.addRow([dateStr, Number(r[2]), Number(r[3]), Number(r[4])]);
  });

  const options = {
    title: `${userName}님의 훈련 통계`,
    curveType: "function",
    legend: { position: "bottom" },
    height: 360,
    series: {
      0: { color: "#2e74e8" },
      1: { color: "#f39c12" },
      2: { color: "#e74c3c" },
    },
  };

  const chart = new google.visualization.LineChart(container);
  chart.draw(dataTable, options);
}





/* ==========================================================
   Results 통계 시각화 (Google Charts)
========================================================== */
async function loadResultsStats() {
  const container = document.getElementById("resultChart");
  if (!container) return;

  container.innerHTML = "<div class='muted'>결과 데이터를 불러오는 중...</div>";

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({ action: "getResultsData" }),
    });
    const data = await res.json();

    if (!data.results || !data.results.length) {
      container.innerHTML = "<div class='muted'>아직 결과 데이터가 없습니다.</div>";
      return;
    }

    // Google Charts 로드
    google.charts.load("current", { packages: ["corechart"] });
    google.charts.setOnLoadCallback(() => drawResultsChart(data.results));
  } catch (err) {
    console.error(err);
    container.innerHTML = "<div class='muted'>결과 데이터를 불러오지 못했습니다.</div>";
  }
}

function drawResultsChart(results) {
  const container = document.getElementById("resultChart");
  if (!container) return;

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn("string", "날짜");
  dataTable.addColumn("number", "평균 파워");
  dataTable.addColumn("number", "TSS");
  dataTable.addColumn("number", "심박수");

  results.forEach(r => {
    const date = new Date(r[0]);
    const dateStr = Utilities ? Utilities.formatDate(date, "Asia/Seoul", "MM/dd") : date.toLocaleDateString();
    dataTable.addRow([dateStr, Number(r[2]), Number(r[3]), Number(r[4])]);
  });

  const options = {
    title: "훈련 통계 (최근 세션)",
    curveType: "function",
    legend: { position: "bottom" },
    height: 350,
    series: {
      0: { color: "#2e74e8" },
      1: { color: "#f39c12" },
      2: { color: "#e74c3c" },
    },
    backgroundColor: "#fff",
  };

  const chart = new google.visualization.LineChart(container);
  chart.draw(dataTable, options);
}



/* ==========================================================
   DOM 로드 후 Workouts 자동 로드
========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  showScreen("connectionScreen");
  updateDevicesList();
  loadWorkouts(); // ✅ 워크아웃 자동 불러오기 추가
  console.log("🚀 앱 초기화 완료");
});


/* ==========================================================
   Users 시트에서 사용자 목록 불러오기
========================================================== */
async function loadUserList() {
  const sel = document.getElementById("resultUserSelect");
  if (!sel) return;

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({ action: "getUsers" }),
    });
    const data = await res.json();

    if (data.users && data.users.length) {
      data.users.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.name;
        opt.textContent = u.name;
        sel.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("사용자 목록 로드 실패:", err);
  }
}

/* ==========================================================
   사용자 선택 시 그래프 갱신
========================================================== */
function handleUserSelect(name) {
  if (!name) return;
  loadResultsStatsByUser(name);
}

/* ==========================================================
   기간 필터 적용 (사용자 + 날짜)
========================================================== */
function applyDateFilter() {
  const name = document.getElementById("resultUserSelect")?.value;
  const start = document.getElementById("startDate")?.value;
  const end = document.getElementById("endDate")?.value;
  if (!name) {
    alert("먼저 사용자를 선택하세요.");
    return;
  }
  loadResultsStatsByUserAndDate(name, start, end);
}

/* ==========================================================
   CSV 내보내기 기능
========================================================== */
async function exportResults() {
  const name = document.getElementById("resultUserSelect")?.value;
  const start = document.getElementById("startDate")?.value;
  const end = document.getElementById("endDate")?.value;

  if (!name) {
    alert("먼저 사용자를 선택하세요.");
    return;
  }

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "exportResultsByUserAndDate",
        name,
        startDate: start,
        endDate: end,
      }),
    });
    const data = await res.json();

    if (data.status === "success" && data.fileUrl) {
      alert("✅ 내보내기 완료! Google Drive에서 파일을 열 수 있습니다.");
      window.open(data.fileUrl, "_blank");
    } else {
      alert("❌ 내보내기 실패: " + (data.message || "Unknown error"));
    }
  } catch (err) {
    console.error("Export error:", err);
    alert("❌ 내보내기 중 오류가 발생했습니다.");
  }
}




/* ==========================================================
   기간별 데이터 로드
========================================================== */
async function loadResultsStatsByUserAndDate(name, startDate, endDate) {
  const container = document.getElementById("resultChart");
  if (!container) return;
  container.innerHTML = "<div class='muted'>데이터를 불러오는 중...</div>";

  try {
    const res = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "getResultsDataByUserAndDate",
        name,
        startDate,
        endDate,
      }),
    });
    const data = await res.json();

    if (!data.results || !data.results.length) {
      container.innerHTML = "<div class='muted'>해당 기간의 기록이 없습니다.</div>";
      return;
    }

    google.charts.load("current", { packages: ["corechart"] });
    google.charts.setOnLoadCallback(() => drawResultsChart(data.results, `${name} (${startDate || "시작"}~${endDate || "현재"})`));
  } catch (err) {
    console.error("기간별 로드 오류:", err);
    container.innerHTML = "<div class='muted'>불러오기 실패</div>";
  }
}



document.addEventListener("DOMContentLoaded", () => {
  showScreen("connectionScreen");
  updateDevicesList();
  loadUserList(); // ✅ 사용자 목록 자동 로드
  console.log("🚀 사용자 필터 기능 포함 앱 초기화 완료");
});

