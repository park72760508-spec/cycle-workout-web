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

window.userProfiles = userProfiles;  // 전역으로 노출
window.users = userProfiles;         // loadUsers()에서 쓰는 별칭


/* -----------------------------
   프로필 화면 렌더링
------------------------------ */
/* ===== 안전한 프로필 렌더러: data.js에 붙여넣기 ===== */
(function () {
  // 프로필 목록을 그릴 컨테이너 후보 셀렉터 (필요시 추가)
  const PROFILE_CONTAINER_SELECTORS = ['#profilesContainer', '[data-profiles]'];

  function findProfilesRoot(explicitRoot) {
    if (explicitRoot instanceof Element) return explicitRoot;
    for (const sel of PROFILE_CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // 카드 템플릿(원래 쓰던 형태로 바꿔도 됨)
  function profileCard(u) {
    const name = u?.name ?? '이름없음';
    const id = u?.id ?? '';
    return `
      <div class="user-card" data-id="${id}">
        <div class="user-main">
          <div class="user-name">${name}</div>
          <div class="user-id">ID: ${id}</div>
        </div>
        <div class="user-actions">
          <button type="button" data-action="select">선택</button>
        </div>
      </div>
    `;
  }

  // ✅ 안전 가드 적용된 렌더 함수
  function renderProfiles(users = [], rootEl) {
    const container = findProfilesRoot(rootEl);
    if (!container) {
      console.warn('[renderProfiles] profiles container not found. Skip render.');
      return; // 화면이 프로필 뷰가 아닐 때는 조용히 스킵
    }

    container.innerHTML = (users || []).map(profileCard).join('');

    // 선택 버튼(위임) 핸들러: app.js와 중복되지 않게 1회만 바인딩
    if (!container.__profilesBound) {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="select"]');
        if (!btn) return;
        const card = btn.closest('.user-card');
        const id = card?.getAttribute('data-id');
        if (!id) return;
        if (typeof window.selectProfile === 'function') {
          window.selectProfile(id);
        }
      });
      container.__profilesBound = true;
    }
  }

  // 전역 노출(기존 코드 호환)
  window.renderProfiles = renderProfiles;
})();


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
window.selectProfile = selectProfile;

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


// 예시 users 데이터가 window.users에 있다고 가정
// window.users = [{ id: 1, name: "홍길동", ftp: 230, weight: 70 }, ...];
/* -----------------------------
   사용자 파일관리
------------------------------ */
function loadUsers() {
  const box = document.getElementById("userList");
  if (!box) return;

  const list = Array.isArray(window.users) ? window.users : [];
  if (list.length === 0) {
    box.innerHTML = `<div class="muted">등록된 사용자가 없습니다.</div>`;
    return;
  }

  box.innerHTML = list.map(u => `
    <div class="user-card" data-id="${u.id}">
      <div class="user-name">👤 ${u.name}</div>
      <div class="user-meta">FTP ${u.ftp}W</div>
      <button class="btn btn-primary" data-action="select">선택</button>
    </div>
  `).join("");

  // 선택 이벤트(한 번만 바인딩)
  box.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="select"]');
    if (!btn) return;
    const card = btn.closest(".user-card");
    const id = card?.getAttribute("data-id");
    const user = window.users.find(x => String(x.id) === String(id));
    if (user && typeof window.selectProfile === "function") {
      window.selectProfile(user);
    }
  }, { once: true });
}

// 전역 노출
window.loadUsers = loadUsers;





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
  
  // 저장 버튼 이벤트는 제거 - userManager.js에서 처리
});
