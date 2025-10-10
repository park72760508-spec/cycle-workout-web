/* ==========================================================
   app.js (v1.2 stable)
   - 화면 전환, 스피너, 사용자·워크아웃 로딩, 실시간 표시
   - BLE 이벤트 핸들러와 연동되어 동작
========================================================== */

window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}
function showConnectionStatus(show) {
  const el = document.getElementById("connectionStatus");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.classList.remove("hidden");         // ✅ 중요: 숨김 해제
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}


// 실시간 표시 (필요 필드만 예시)
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

// 사용자/워크아웃 로딩 더미 (GAS 연동 전에도 동작)
async function loadUsers() {
  const profileList = document.getElementById("profileList");
  if (!profileList) return;
  // GAS 연동 실패 대비 더미
  const users = [
    { user_id: "U1", name: "박지성", contact: "010-1234-5678", ftp: 242, weight: 56 },
    { user_id: "U2", name: "박선호", contact: "010-9876-5432", ftp: 200, weight: 70 },
  ];
  profileList.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "card profile-card";
    div.onclick = () => selectUser(u);
    const initials = u.name.substring(0, 2);
    const wkg = (u.ftp / u.weight).toFixed(1);
    div.innerHTML = `
      <div class="profile-info">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-details">
          <h3>${u.name}</h3>
          <div class="profile-stats">
            <div><div class="stat-value">${u.ftp}W</div><div class="stat-label">FTP</div></div>
            <div><div class="stat-value">${u.weight}kg</div><div class="stat-label">몸무게</div></div>
            <div><div class="stat-value">${wkg}</div><div class="stat-label">W/kg</div></div>
          </div>
        </div>
      </div>`;
    profileList.appendChild(div);
  });
}
function selectUser(u) {
  window.currentUser = u;
  showToast(`${u.name}님 선택됨`);
  showScreen("workoutScreen");
  loadWorkouts();
}

async function loadWorkouts() {
  const list = document.getElementById("workoutList");
  if (!list) return;
  const workouts = [
    {
      workout_id: "SST_MCT14",
      workout_name: "SST_MCT(14)",
      total_duration: 5520,
      avg_intensity: 78,
      segments: [
        { segment_order: 1, segment_type: "웜업", description: "80RPM FTP 60%", ftp_percent: 60, duration_sec: 300, target_rpm: 80 },
        { segment_order: 2, segment_type: "인터벌", description: "FTP 88%", ftp_percent: 88, duration_sec: 600, target_rpm: 90 },
        { segment_order: 3, segment_type: "휴식", description: "FTP 50%", ftp_percent: 50, duration_sec: 300, target_rpm: 75 },
      ]
    }
  ];
  list.innerHTML = "";
  workouts.forEach(w => {
    const d = document.createElement("div");
    d.className = "card workout-card";
    d.onclick = () => selectWorkout(w);
    d.innerHTML = `
      <div class="workout-header">
        <div class="workout-title">${w.workout_name}</div>
        <div class="workout-duration">${Math.floor(w.total_duration/60)}분</div>
      </div>
      <div style="margin: 10px 0; font-size:14px; color:#6C757D">
        평균: ${w.avg_intensity}% FTP
      </div>`;
    list.appendChild(d);
  });
}
function selectWorkout(w) {
  window.currentWorkout = w;
  showScreen("trainingReadyScreen");
  renderPreview();
}
function renderPreview() {
  const name = document.getElementById("previewWorkoutName");
  const dur = document.getElementById("previewDuration");
  const avg = document.getElementById("previewIntensity");
  const tss = document.getElementById("previewTSS");
  const segBox = document.getElementById("segmentPreview");
  const w = currentWorkout;
  if (!w) return;
  if (name) name.textContent = w.workout_name;
  if (dur) dur.textContent = Math.floor(w.total_duration/60) + "분";
  if (avg) avg.textContent = w.avg_intensity + "%";
  if (tss) tss.textContent = calcWorkoutTSS(w);
  if (segBox) {
    segBox.innerHTML = "";
    w.segments.forEach(s => {
      const di = document.createElement("div");
      di.className = `segment-item ${s.segment_type === "웜업" ? "warmup" : s.segment_type === "휴식" ? "rest" : "interval"}`;
      di.innerHTML = `<h4>${s.segment_type}</h4>
        <div class="ftp-percent">${s.ftp_percent}%</div>
        <div class="duration">${Math.floor(s.duration_sec/60)}분</div>`;
      segBox.appendChild(di);
    });
  }
}
function calcWorkoutTSS(w) {
  let total = 0;
  w.segments.forEach(s => {
    const IF = s.ftp_percent / 100;
    total += (s.duration_sec / 3600) * IF * IF * 100;
  });
  return Math.round(total);
}

// 버튼 핸들러
window.startWorkoutTraining = function () {
  showScreen("trainingScreen");
  // 필요 시 카운트다운/세션 초기화 로직 연결
  showToast("훈련을 시작합니다");
};
window.backToWorkoutSelection = function () {
  showScreen("workoutScreen");
};

// connection → profile 자동 시 로딩
document.addEventListener("click", (e) => {
  const id = e.target?.id;
  if (id === "btnLoadUsers") loadUsers();
});

// export
window.showScreen = showScreen;
window.showConnectionStatus = showConnectionStatus;

// app.js의 첫 번째 DOMContentLoaded (61번째 줄 근처) 삭제하고
// 맨 아래 있는 것만 유지하되 다음과 같이 수정:

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing app...");
  
  // 브라우저 체크
  if (!navigator.bluetooth) {
    showToast("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
  }
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    showToast("BLE를 사용하려면 HTTPS가 필요합니다.");
  }
  
  showScreen("connectionScreen");

  // 심박계 버튼 - ID 확인 후 연결
  const btnHR = document.getElementById("btnConnectHR");
  console.log("Heart rate button found:", !!btnHR);
  
  if (btnHR) {
    btnHR.addEventListener("click", async () => {
      console.log("HR button clicked");
      btnHR.disabled = true;
      const original = btnHR.textContent;
      btnHR.textContent = "검색 중…";
      
      try {
        if (window.connectHeartRate) {
          await window.connectHeartRate();
        } else {
          console.error("connectHeartRate function not found!");
          showToast("심박계 연결 함수를 찾을 수 없습니다.");
        }
      } catch (err) {
        console.error("HR connection error:", err);
      } finally {
        btnHR.disabled = false;
        btnHR.textContent = original;
      }
    });
  }

  // 트레이너 버튼
  const btnTrainer = document.getElementById("btnConnectTrainer");
  if (btnTrainer) {
    btnTrainer.addEventListener("click", () => {
      console.log("Trainer button clicked");
      if (window.connectTrainer) {
        window.connectTrainer();
      }
    });
  }

  // 파워미터 버튼  
  const btnPM = document.getElementById("btnConnectPM");
  if (btnPM) {
    btnPM.addEventListener("click", () => {
      console.log("PM button clicked");
      if (window.connectPowerMeter) {
        window.connectPowerMeter();
      }
    });
  }

  // 프로필 화면 이동 버튼
  const btnToProfile = document.getElementById("btnToProfile");
  if (btnToProfile) {
    btnToProfile.addEventListener("click", () => {
      showScreen("profileScreen");
      if (window.renderProfiles) {
        window.renderProfiles();
      }
    });
  }
});

