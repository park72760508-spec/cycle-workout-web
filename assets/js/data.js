/* ======================================================
   DATA MODULE (v1009)
   - 사용자 목록 / 워크아웃 로딩 / 샘플 JSON
   ====================================================== */

let userProfiles = [
  { id: 1, name: "박지성", contact: "010-1234-5678", ftp: 250, weight: 72 },
  { id: 2, name: "이순신", contact: "010-9876-5432", ftp: 220, weight: 68 },
];

// 선택된 사용자 / 워크아웃
let selectedUser = null;
let currentWorkout = null;

/* -----------------------------
   프로필 화면 렌더링
------------------------------ */
function renderProfiles() {
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  userProfiles.forEach((u) => {
    const div = document.createElement("div");
    div.className = "card profile-card pointer";
    div.innerHTML = `
      <h3>${u.name}</h3>
      <p class="muted">FTP: ${u.ftp}W · ${u.weight}kg</p>
    `;
    div.onclick = () => selectProfile(u);
    list.appendChild(div);
  });
}

/* -----------------------------
   프로필 선택
------------------------------ */
function selectProfile(user) {
  selectedUser = user;
  alert(`✅ ${user.name}님 프로필 선택됨`);
  showScreen("workoutScreen");
  renderWorkouts();
}

/* -----------------------------
   워크아웃 로드
------------------------------ */
async function renderWorkouts() {
  const list = document.getElementById("workoutList");
  list.innerHTML = "불러오는 중...";
  try {
    const res = await fetch("assets/data/sample_workouts.json");
    const workouts = await res.json();
    list.innerHTML = "";
    workouts.forEach((w) => {
      const div = document.createElement("div");
      div.className = "card pointer";
      div.innerHTML = `
        <h3>${w.name}</h3>
        <p class="muted">${w.description}</p>
        <p>⌛ ${w.totalMinutes}분 · 강도 ${w.intensity}%</p>
      `;
      div.onclick = () => selectWorkout(w);
      list.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    list.innerHTML = "❌ 워크아웃 로드 실패";
  }
}

/* -----------------------------
   워크아웃 선택
------------------------------ */
function selectWorkout(w) {
  currentWorkout = w;
  document.getElementById("previewWorkoutName").textContent = w.name;
  document.getElementById("previewDuration").textContent = w.totalMinutes + "분";
  document.getElementById("previewIntensity").textContent = w.intensity + "%";
  document.getElementById("previewTSS").textContent = w.tss;
  
  const segDiv = document.getElementById("segmentPreview");
  segDiv.innerHTML = w.segments
    .map((s) => `
      <div class="segment-item ${
        s.label.includes('웜업') ? 'warmup' : 
        s.label.includes('휴식') ? 'rest' : 'interval'
      }">
        <h4>${s.label}</h4>
        <div class="ftp-percent">${Math.round(s.target * 100)}%</div>
        <div class="duration">${Math.floor(s.duration / 60)}분</div>
      </div>
    `)
    .join("");
  
  showScreen("trainingReadyScreen");
}
