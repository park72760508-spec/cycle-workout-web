/* ==========================================================
   공통 API 유틸---GAS API와 연결하고 작성/수정/삭제/검색을 추가
========================================================== */

const GAS_URL = (window.CONFIG && window.CONFIG.GAS_WEB_APP_URL) || '';

async function apiGet(action, params={}) {
  const q = new URLSearchParams({ action, ...params });
  const r = await fetch(`${GAS_URL}?${q.toString()}`, { method:'GET' });
  return r.json();
}
async function apiPost(action, body={}) {
  const r = await fetch(`${GAS_URL}?action=${action}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

/* ==========================================================
   목록 로드/검색/선택(교체)
========================================================== */
window.loadWorkouts = async function(){
  const res = await apiGet('listWorkouts');
  if (!res.success) { console.error(res.error); return; }
  displayWorkouts(res.items || []);
}

window.displayWorkouts = function(ws){
  const list = document.getElementById('workoutList');
  list.innerHTML = '';
  ws.forEach(w=>{
    const d = document.createElement('div');
    d.className = 'card workout-card';
    d.innerHTML = `
      <div class="workout-header">
        <div class="workout-title">${w.title || w.workout_name || '(무제)'}</div>
        <div class="workout-duration">${Math.round((w.total_seconds||0)/60)}분</div>
      </div>
      <div class="muted" style="margin:6px 0;">${w.author||''} · ${w.created_at? new Date(w.created_at).toLocaleDateString() : ''}</div>
      <div class="btn-row">
        <button class="btn" data-action="edit" data-id="${w.id}">수정</button>
        <button class="btn btn-secondary" data-action="delete" data-id="${w.id}">삭제</button>
        <button class="btn btn-success" data-action="use" data-id="${w.id}">선택</button>
      </div>`;
    list.appendChild(d);
  });

  // 목록 버튼 위임
  list.onclick = async (e)=>{
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action==='use'){
      const detail = await apiGet('getWorkout', { id });
      if (detail.success && detail.item){
        window.currentWorkout = convertApiWorkout(detail.item);
        window.showScreen('trainingReadyScreen'); // 기존 흐름 재사용
      }
    }
    if (action==='edit'){
      const detail = await apiGet('getWorkout', { id });
      if (detail.success && detail.item){
        openBuilderForEdit(detail.item);
      }
    }
    if (action==='delete'){
      if (!confirm('이 워크아웃을 삭제할까요?')) return;
      const r = await apiPost('deleteworkout', { id });
      if (r.success) loadWorkouts();
    }
  };
}

// 검색 버튼 바인딩


// “새 워크아웃” 버튼 → 빌더 화면 오픈
document.getElementById('btnOpenBuilder')?.addEventListener('click', ()=>{
  openBuilderForCreate();
});

// API 응답 → 프런트에서 쓰는 구조로 맞춤
function convertApiWorkout(w){
  return {
    id: w.id,
    name: w.title,
    description: w.description || '',
    segments: (w.segments||[]).map(s => ({
      label: s.label,
      segment_type: s.segment_type,
      duration_sec: Number(s.duration_sec)||0,
      target_type: s.target_type,
      target_value: Number(s.target_value)||0,
      ramp: s.ramp,
      ramp_to_value: s.ramp_to_value ? Number(s.ramp_to_value) : null
    }))
  };
}

/* ==========================================================
   수정/편집
========================================================== */

let __builderEditingId = null;

function openBuilderForCreate(){
  __builderEditingId = null;
  document.getElementById('wbTitle').value = '';
  document.getElementById('wbDesc').value  = '';
  document.getElementById('wbAuthor').value= '';
  renderSegmentRows([]);
  window.showScreen('workoutBuilderScreen');
}

function openBuilderForEdit(item){
  __builderEditingId = item.id;
  document.getElementById('wbTitle').value = item.title || '';
  document.getElementById('wbDesc').value  = item.description || '';
  document.getElementById('wbAuthor').value= item.author || '';
  renderSegmentRows(item.segments || []);
  window.showScreen('workoutBuilderScreen');
}

// 세그먼트 행 렌더
function renderSegmentRows(arr){
  const box = document.getElementById('wbSegments');
  box.innerHTML = arr.map((s, idx)=> segRowHTML(s, idx)).join('');
}

function segRowHTML(s={}, idx){
  return `
  <div class="card" data-row="${idx}">
    <div class="form-row">
      <div class="form-group" style="flex:2;">
        <label>라벨</label>
        <input type="text" data-k="label" value="${s.label||''}">
      </div>
      <div class="form-group" style="flex:1;">
        <label>타입</label>
        <select data-k="segment_type">
          ${['warmup','interval','rest','tempo','sweetspot','threshold','cooldown'].map(t=>`
            <option value="${t}" ${s.segment_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label>지속(초)</label>
        <input type="number" data-k="duration_sec" min="1" value="${s.duration_sec||60}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" style="flex:1;">
        <label>타깃 기준</label>
        <select data-k="target_type">
          ${['ftp_percent','watts','cadence','heart_rate'].map(t=>`
            <option value="${t}" ${s.target_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label>타깃 값</label>
        <input type="number" data-k="target_value" value="${s.target_value||60}">
      </div>
      <div class="form-group" style="flex:1;">
        <label>램프</label>
        <select data-k="ramp">
          ${['none','linear'].map(t=>`
            <option value="${t}" ${s.ramp===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label>램프 종료값</label>
        <input type="number" data-k="ramp_to_value" value="${s.ramp_to_value??''}">
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" data-action="remove">행 삭제</button>
    </div>
  </div>`;
}

// 세그먼트 행 추가



// 행 삭제


// 저장
// === 저장/취소 버튼: 안전 바인딩(IIFE) ===
(function bindBuilderSaveCancel(){
  const onReady = () => {
    // 저장
    const btnSave = document.getElementById('btnSaveWorkout');
    if (btnSave && !btnSave.__bound) {
      btnSave.addEventListener('click', async () => {
        // 콘솔 로그로 동작여부 확인(필요시)
        // console.log('[builder] save clicked');

        const title = document.getElementById('wbTitle').value.trim();
        const description = document.getElementById('wbDesc').value.trim();
        const author = document.getElementById('wbAuthor').value.trim();

        const segments = [...document.querySelectorAll('#wbSegments .card[data-row]')].map((row, i)=>{
          const get = k => row.querySelector(`[data-k="${k}"]`)?.value;
          return {
            label: get('label') || `세그먼트 ${i+1}`,
            segment_type: get('segment_type') || 'interval',
            duration_sec: Number(get('duration_sec'))||60,
            target_type: get('target_type') || 'ftp_percent',
            target_value: Number(get('target_value'))||60,
            ramp: get('ramp') || 'none',
            ramp_to_value: get('ramp_to_value') ? Number(get('ramp_to_value')) : null
          };
        });

        const payload = { title, description, author, segments };

        try {
          let res;
          if (window.__builderEditingId) {
            res = await apiPost('updateworkout', { id: window.__builderEditingId, ...payload });
          } else {
            res = await apiPost('createworkout', payload);
          }

          if (res && res.success) {
            alert('저장되었습니다');
            if (typeof window.showScreen === 'function') window.showScreen('workoutScreen');
            if (typeof loadWorkouts === 'function') loadWorkouts();
          } else {
            alert('오류: ' + (res?.error || '응답 없음'));
          }
        } catch (err) {
          console.error(err);
          alert('네트워크/서버 오류: ' + err);
        }
      });
      btnSave.__bound = true;
    }

    // 취소
    const btnCancel = document.getElementById('btnCancelBuilder');
    if (btnCancel && !btnCancel.__bound) {
      btnCancel.addEventListener('click', () => {
        if (typeof window.showScreen === 'function') {
          window.showScreen('workoutScreen');
        } else {
          // 임시 fallback
          document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
          document.getElementById('workoutScreen')?.classList.add('active');
        }
      });
      btnCancel.__bound = true;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();




// === 새 워크아웃 버튼 → 작성 화면으로 전환 (확실한 바인딩) ===
(function bindOpenBuilderOnce(){
  const onReady = () => {
    const btn = document.getElementById('btnOpenBuilder');
    if (!btn) return; // 아직 DOM에 없으면 다음 프레임 재시도 구조로도 확장 가능

    // 중복 바인딩 방지
    if (!btn.__boundOpenBuilder) {
      btn.addEventListener('click', () => {
        if (typeof window.showScreen === 'function') {
          window.showScreen('workoutBuilderScreen');
        } else {
          console.warn('showScreen() not found. Check app.js global export.');
          // 임시 fallback: 클래스 토글
          document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
          document.getElementById('workoutBuilderScreen')?.classList.add('active');
        }
      });
      btn.__boundOpenBuilder = true;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();



// === 검색/세그먼트 추가/행 삭제 : 안전 바인딩(IIFE) ===
(function bindWorkoutListAndSegments(){
  const onReady = () => {
    // 1) 검색
    const btnSearch = document.getElementById('btnSearchWorkout');
    const qInput    = document.getElementById('qWorkout');
    if (btnSearch && !btnSearch.__bound) {
      btnSearch.addEventListener('click', async () => {
        try {
          const q = (qInput?.value || '').trim();
          const res = await apiGet('searchWorkouts', { q });
          if (res?.success) {
            (window.displayWorkouts || displayWorkouts)(res.items || []);
          } else {
            alert('검색 오류: ' + (res?.error || '응답 없음'));
          }
        } catch (err) {
          console.error(err);
          alert('네트워크 오류: ' + err);
        }
      });
      btnSearch.__bound = true;
    }

    // 2) 세그먼트 추가
    const btnAdd = document.getElementById('btnAddSegment');
    if (btnAdd && !btnAdd.__bound) {
      btnAdd.addEventListener('click', () => {
        const box = document.getElementById('wbSegments');
        if (!box) return;
        const idx = box.querySelectorAll('.card[data-row]').length;
        // segRowHTML이 정의되어 있으므로 그대로 사용
        box.insertAdjacentHTML('beforeend', segRowHTML({}, idx));
      });
      btnAdd.__bound = true;
    }

    // 3) 세그먼트 영역 위임: 행 삭제
    const segBox = document.getElementById('wbSegments');
    if (segBox && !segBox.__delegated) {
      segBox.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action="remove"]');
        if (!btn) return;
        const row = btn.closest('.card[data-row]');
        row?.remove();
      });
      segBox.__delegated = true;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();


