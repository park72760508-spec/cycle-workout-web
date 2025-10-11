/* ======================================================
   DATA MODULE (v1009)
   - 사용자 목록 / 워크아웃 로딩 / 샘플 JSON
   ====================================================== */

let userProfiles = [
  { id: 1, name: "박지성", contact: "010-1234-5678", ftp: 242, weight: 56 },
  { id: 2, name: "박선호", contact: "010-9876-5432", ftp: 260, weight: 85 },
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
  // ▼ 추가: 전역 사용자로 공유 + 캐시
  window.currentUser = user;
  try { localStorage.setItem("currentUser", JSON.stringify(user)); } catch(e) {}

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
/* -----------------------------
   워크아웃 선택
------------------------------ */
function selectWorkout(w) {
  // ✅ 전역/캐시에 저장: app.js가 window.currentWorkout을 읽습니다.
  window.currentWorkout = w;
  try { localStorage.setItem("currentWorkout", JSON.stringify(w)); } catch(e) {}

  // 프리뷰 채우기
  document.getElementById("previewWorkoutName").textContent = w.name;
  document.getElementById("previewDuration").textContent = w.totalMinutes + "분";
  document.getElementById("previewIntensity").textContent = w.intensity + "%";
  document.getElementById("previewTSS").textContent = w.tss;

  const segDiv = document.getElementById("segmentPreview");
  segDiv.innerHTML = w.segments
    .map((s) => `
      <div class="segment-item ${
        s.label.includes('웜업') ? 'warmup' :
        s.label.includes('휴식') ? 'rest'   : 'interval'
      }">
        <h4>${s.label}</h4>
        <div class="ftp-percent">${Math.round(s.target * 100)}%</div>
        <div class="duration">${Math.floor(s.duration / 60)}분</div>
      </div>
    `)
    .join("");

  showScreen("trainingReadyScreen");
}




/* -----------------------------
   새사용자 추가
------------------------------ */
// 새 사용자 추가 카드 클릭 이벤트
document.addEventListener("DOMContentLoaded", () => {
  // 새 사용자 추가 카드
  const cardAddUser = document.getElementById("cardAddUser");
  const addUserForm = document.getElementById("addUserForm");
  
  if (cardAddUser) {
    cardAddUser.addEventListener("click", () => {
      cardAddUser.classList.add("hidden");
      addUserForm.classList.remove("hidden");
    });
  }
  
  // 취소 버튼
  const btnCancelAddUser = document.getElementById("btnCancelAddUser");
  if (btnCancelAddUser) {
    btnCancelAddUser.addEventListener("click", () => {
      addUserForm.classList.add("hidden");
      cardAddUser.classList.remove("hidden");
      // 폼 초기화
      document.getElementById("userName").value = "";
      document.getElementById("userContact").value = "";
      document.getElementById("userFTP").value = "";
      document.getElementById("userWeight").value = "";
    });
  }
  
  // 저장 버튼
  const btnSaveUser = document.getElementById("btnSaveUser");
  if (btnSaveUser) {
    btnSaveUser.addEventListener("click", () => {
      const name = document.getElementById("userName").value;
      const contact = document.getElementById("userContact").value;
      const ftp = parseInt(document.getElementById("userFTP").value);
      const weight = parseInt(document.getElementById("userWeight").value);
      
      if (name && contact && ftp && weight) {
        // 새 사용자 추가
        const newUser = {
          id: userProfiles.length + 1,
          name: name,
          contact: contact,
          ftp: ftp,
          weight: weight
        };
        
        userProfiles.push(newUser);
        
        // 화면 갱신
        renderProfiles();
        
        // 폼 숨기고 초기화
        addUserForm.classList.add("hidden");
        cardAddUser.classList.remove("hidden");
        document.getElementById("userName").value = "";
        document.getElementById("userContact").value = "";
        document.getElementById("userFTP").value = "";
        document.getElementById("userWeight").value = "";
        
        showToast(`✅ ${name}님이 추가되었습니다`);
      } else {
        showToast("❌ 모든 필드를 입력해주세요");
      }
    });
  }
});
