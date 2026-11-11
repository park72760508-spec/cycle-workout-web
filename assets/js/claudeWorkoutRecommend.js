/*
 * Claude API 워크아웃 추천 (2026-11-11)
 *  - 워크아웃 > "AI분석 워크아웃 추천" 클릭 → [Gemini 무료 추천 | Claude 유료 API] 선택
 *  - Gemini: 기존 로직(handleGeminiRecommendationClick) 그대로
 *  - Claude: 사용자 본인의 Anthropic API 키(설정에 저장, localStorage 'claudeApiKey')로 브라우저에서 직접 호출
 *    조건: FTP·W/kg 등급, 오늘 컨디션, 최근 30일 로그, 훈련 목표(+대회일), 오늘 가능 시간
 *    결과: 카테고리·1줄 코멘트 + 1~3순위 워크아웃(이름·카테고리·시간·예상 TSS·플로우) → 선택 시 기존
 *          selectAIRecommendedWorkout() 로 훈련 준비 화면에 업로드 → 개인훈련 시작
 */
(function (w) {
  'use strict';

  var KEY_NAME = 'claudeApiKey';
  var PREF_NAME = 'claudeRecoPrefs';
  var MODEL = 'claude-sonnet-5-5';
  var API_URL = 'https://api.anthropic.com/v1/messages';

  var GRADES = [
    { max: 2.5, ifMax: 0.75, name: '입문', hint: '주로 Z1~Z2(55~75%), 인터벌은 짧고 낮게(최대 SS 85~90%, 1회 8~10분 이하). 총 부하 낮게, 꾸준함 우선.' },
    { max: 3.2, ifMax: 0.82, name: '초급', hint: 'Z2 중심 + 가벼운 템포/SS(최대 88~92%, 1회 10~15분). 고강도(VO2)는 짧게(2~3분)·소량.' },
    { max: 3.7, ifMax: 0.88, name: '중급', hint: 'Z2·템포·SS·역치(95~100%, 1회 10~20분) 균형. VO2(106~118%) 3~4분 x 4~5회까지.' },
    { max: 4.2, ifMax: 0.93, name: '상급', hint: 'SS·역치·오버언더·VO2 적극 활용(역치 2x20분, VO2 5x4~5분 가능). 회복 간격 충분히.' },
    { max: 5.0, ifMax: 0.98, name: '엘리트', hint: '고강도 볼륨 높음(역치 3x15~20분, VO2 6x4분, 혐기 30~60초 반복). 회복일 엄수.' },
    { max: 99, ifMax: 1.05, name: '프로선수', hint: '대회 특이 훈련·고강도 큰 볼륨(역치 3x20분+, VO2 6~8x4~5분, 스프린트·혐기). 정확한 회복·테이퍼링.' }
  ];
  var GOALS = [
    { id: 'diet', label: '다이어트', ask: false, hint: '지방 연소·칼로리 소모: 긴 Z2(55~70%) 중심, 약간의 템포. 과도한 고강도 지양(회복 저하).' },
    { id: 'fitness', label: '체력향상', ask: false, hint: '유산소 기반 + 균형: Z2 지구력, 템포/SS 약간, 가끔 짧은 VO2.' },
    { id: 'ftp', label: 'FTP 향상', ask: false, hint: 'SS(88~94%)·역치(95~105%)·오버언더 중심 질적 훈련.' },
    { id: 'granfondo', label: '그란폰도 대비', ask: true, hint: '장거리 지구력 + 오르막 대비 템포/SS/역치. 대회일까지 남은 기간에 따라 베이스→빌드→피크→테이퍼.' },
    { id: 'race', label: '대회 준비', ask: true, hint: '대회 특이성: 역치·VO2·혐기 반복/변속(서지). 대회일까지 남은 기간에 따라 빌드→피크→테이퍼(대회 1주 전은 볼륨↓ 짧은 자극).' }
  ];
  var CONDS = [
    { id: '최상', hint: '컨디션 최상: 계획한 강도 상단까지 가능(+3~5% 허용).' },
    { id: '좋음', hint: '컨디션 좋음: 계획대로.' },
    { id: '보통', hint: '컨디션 보통: 계획 강도 유지하되 무리한 상단은 피함.' },
    { id: '나쁨', hint: '컨디션 나쁨: 강도·볼륨을 낮추고 회복 위주(Z1~Z2, 인터벌은 짧거나 생략).' }
  ];
  var TIMES = [
    { id: 60, label: '1시간 이내', maxMin: 60, minMin: 30 },
    { id: 90, label: '1시간 30분 이내', maxMin: 90, minMin: 60 },
    { id: 120, label: '2시간 이내', maxMin: 120, minMin: 75 },
    { id: 180, label: '2시간 이상', maxMin: 210, minMin: 120 }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, type) { if (typeof w.showToast === 'function') w.showToast(msg, type || 'info'); else alert(msg); }
  /*
   * 키 저장소(2026-11-11): localStorage 가 가득 차면(QuotaExceededError "The quota has been exceeded") 저장이 실패해 매번 설정 화면으로 돌아갔다.
   * → localStorage + IndexedDB(별도 할당량) 이중 저장, 읽기는 메모리 → localStorage → IndexedDB 순. 한쪽만 성공해도 저장 성공으로 처리.
   */
  var memKey = '';
  function lsGet() { try { return (localStorage.getItem(KEY_NAME) || '').trim(); } catch (e) { return ''; } }
  function getKey() { return memKey || lsGet(); }
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; reject(new Error('idb timeout')); } }, 3000);
      try {
        var rq = indexedDB.open('stelvioClaude', 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore('kv'); } catch (e) {} };
        rq.onsuccess = function () { if (done) { try { rq.result.close(); } catch (e) {} return; } done = true; clearTimeout(t); resolve(rq.result); };
        rq.onerror = function () { if (done) return; done = true; clearTimeout(t); reject(rq.error || new Error('idb open')); };
      } catch (e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
    });
  }
  function idbOp(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var finished = false, t = setTimeout(function () { if (!finished) { finished = true; try { db.close(); } catch (e) {} reject(new Error('idb tx timeout')); } }, 4000);
        function end(ok, v) { if (finished) return; finished = true; clearTimeout(t); try { db.close(); } catch (e) {} ok ? resolve(v) : reject(v); }
        try {
          var tx = db.transaction('kv', mode), rq = fn(tx.objectStore('kv'));
          tx.oncomplete = function () { end(true, rq && rq.result); };
          tx.onerror = tx.onabort = function () { end(false, tx.error || new Error('idb tx')); };
        } catch (e) { end(false, e); }
      });
    });
  }
  function idbGetKey() { return idbOp('readonly', function (st) { return st.get(KEY_NAME); }).then(function (v) { return String(v || '').trim(); }, function () { return ''; }); }
  function idbSetKey(v) { return idbOp('readwrite', function (st) { return st.put(v, KEY_NAME); }).then(function () { return true; }, function () { return false; }); }
  function idbDelKey() { return idbOp('readwrite', function (st) { return st.delete(KEY_NAME); }).then(function () { return true; }, function () { return false; }); }
  function lsSet(v) {
    try { localStorage.setItem(KEY_NAME, v); if (lsGet() === v) return true; } catch (e) {}
    // 용량 초과: 이 기능의 오래된 캐시를 비우고 한 번 더
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('claudeRecoDay:') === 0) localStorage.removeItem(k); }); localStorage.setItem(KEY_NAME, v); return lsGet() === v; } catch (e2) { return false; }
  }
  /** 저장: { ls, idb } — 둘 중 하나라도 true 면 다음 방문에도 유지 */
  async function saveKey(v) {
    memKey = v;
    var ls = lsSet(v), idb = await idbSetKey(v);
    return { ls: ls, idb: idb };
  }
  var memOnly = false; // 키 확인은 됐지만 어느 저장소에도 못 써서 이번 접속에서만 유지
  async function removeKey() {
    memKey = ''; memOnly = false;
    try { localStorage.removeItem(KEY_NAME); } catch (e) {}
    var ok = await idbDelKey();
    if (!ok) await idbSetKey(''); // 삭제 실패 시 빈 값으로 덮어써 다음 로드에 되살아나지 않게
  }
  function bigLocalStorageKeys(n) {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i), v = localStorage.getItem(k) || ''; out.push([k, (k.length + v.length) * 2]); } } catch (e) {}
    out.sort(function (a, b) { return b[1] - a[1]; });
    return out.slice(0, n || 4).map(function (x) { return x[0].slice(0, 40) + ' (' + Math.round(x[1] / 1024) + 'KB)'; });
  }
  try { window.addEventListener('storage', function (e) { if (e.key === KEY_NAME) { memKey = (e.newValue || '').trim(); try { updateStatusLine(); } catch (x) {} } }); } catch (e) {}
  // 시작 시 localStorage 에 없으면 IndexedDB 에서 복구(예: localStorage 가 정리된 경우)
  var keyReady = (function () {
    var ls = lsGet();
    if (ls) { memKey = ls; idbSetKey(ls); return Promise.resolve(); } // IndexedDB 에도 백업
    return idbGetKey().then(function (v) { if (v) { memKey = v; try { localStorage.setItem(KEY_NAME, v); } catch (e) {} } });
  })().then(function () { try { updateStatusLine(); } catch (e) {} }, function () {});
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_NAME) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(PREF_NAME, JSON.stringify(p)); } catch (e) {} }
  function ymd(d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }

  /* ---------------- 등급 ---------------- */
  function gradeFor(wkg) {
    if (!(wkg > 0)) return null;
    for (var i = 0; i < GRADES.length; i++) if (wkg < GRADES[i].max) return GRADES[i];
    return GRADES[GRADES.length - 1];
  }

  /* ---------------- 공용 모달 껍데기 ---------------- */
  function ensureModal(id) {
    var el = $(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);align-items:center;justify-content:center;padding:16px;';
    el.addEventListener('click', function (e) { if (e.target === el) el.style.display = 'none'; });
    document.body.appendChild(el);
    return el;
  }
  var CARD = 'background:#fff;color:#111827;border-radius:16px;width:100%;max-width:440px;max-height:92vh;overflow:auto;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.3);';
  function chip(group, id, label, on) {
    return '<button type="button" data-g="' + group + '" data-v="' + esc(id) + '" style="flex:1 1 auto;min-width:76px;padding:10px 12px;border-radius:10px;border:2px solid ' + (on ? '#7c3aed' : '#e5e7eb') + ';background:' + (on ? '#f5f3ff' : '#fff') + ';color:' + (on ? '#5b21b6' : '#374151') + ';font-weight:' + (on ? '700' : '500') + ';font-size:14px;cursor:pointer;">' + esc(label) + '</button>';
  }

  /* ---------------- 1) 엔진 선택 ---------------- */
  function openChooser() {
    w.__claudeRecoAfterKey = 0;
    var m = ensureModal('aiEngineChooserModal');
    var hasKey = !!getKey();
    m.innerHTML = '<div style="' + CARD + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><b style="font-size:18px;">AI 워크아웃 추천</b>' +
      '<button type="button" data-close style="border:0;background:none;font-size:22px;cursor:pointer;color:#6b7280;">✕</button></div>' +
      '<p style="margin:0 0 14px;font-size:13px;color:#6b7280;">추천에 사용할 AI 엔진을 선택하세요.</p>' +
      '<button type="button" data-eng="gemini" style="width:100%;text-align:left;padding:14px;border:2px solid #e5e7eb;border-radius:12px;background:#fff;margin-bottom:10px;cursor:pointer;">' +
      '<b style="font-size:16px;color:#111827;">Gemini 무료 추천</b><div style="font-size:12px;color:#6b7280;margin-top:4px;">기존 방식 · 내 Gemini API 키(무료)로 STELVIO 워크아웃 중에서 추천</div></button>' +
      '<button type="button" data-eng="claude" style="width:100%;text-align:left;padding:14px;border:2px solid #7c3aed;border-radius:12px;background:#faf5ff;cursor:pointer;">' +
      '<b style="font-size:16px;color:#5b21b6;">Claude 유료 API 추천 <span style="font-size:11px;background:#7c3aed;color:#fff;border-radius:999px;padding:2px 8px;vertical-align:middle;">NEW</span></b>' +
      '<div style="font-size:12px;color:#6b7280;margin-top:4px;">FTP·컨디션·최근 30일 로그·목표·가능 시간에 맞춰 맞춤 워크아웃을 새로 생성' +
      (hasKey ? '' : '<br><span style="color:#b45309;">※ 내 Claude API 키 등록 필요(설정에서 저장)</span>') + '</div></button>' +
      '<button type="button" data-eng="saved" style="width:100%;margin-top:10px;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;color:#374151;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + '<img src="assets/img/workout-bars-purple.svg?v=20261111" alt="" aria-hidden="true" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:8px;">' + '나의 훈련 목록 (저장된 Claude 워크아웃)</button>' +
      '</div>';
    m.style.display = 'flex';
    m.querySelector('[data-close]').onclick = function () { m.style.display = 'none'; };
    m.querySelector('[data-eng="gemini"]').onclick = function () { m.style.display = 'none'; if (typeof w.handleGeminiRecommendationClick === 'function') w.handleGeminiRecommendationClick(); };
    m.querySelector('[data-eng="claude"]').onclick = function () { m.style.display = 'none'; startClaudeFlow(); };
    m.querySelector('[data-eng="saved"]').onclick = function () { m.style.display = 'none'; openSavedList(); };
  }

  /* ---------------- 2) Claude 키 확인 → 설정 ---------------- */
  async function startClaudeFlow() {
    var user = w.currentUser;
    if (!user || !user.id) { toast('사용자 정보가 없습니다. 먼저 로그인해주세요.', 'error'); return; }
    // 오늘 이미 생성했다면 키·토큰 없이 그 결과를 보여줌(하루 1회)
    await keyReady;
    var today = await loadToday(user);
    if (today) { showDay(today, true); return; }
    if (!getKey()) { openSettingsForClaudeKey(); return; }
    openOptionsModal();
  }
  function openSettingsForClaudeKey() {
    if (typeof w.openSettingsModal === 'function') w.openSettingsModal();
    setStatus('Claude API 키를 입력하고 [저장]을 누르면 자동으로 추천이 이어집니다.', 'info');
    toast('Claude API 키를 먼저 저장해주세요. 저장하면 자동으로 이어집니다.', 'warning');
    setTimeout(function () { var i = $('settingsClaudeApiKey'); if (i) { i.focus(); try { i.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} } }, 300);
    w.__claudeRecoAfterKey = Date.now();
    updateStatusLine();
  }

  /* ---------------- 3) 조건 선택 모달 ---------------- */
  function openOptionsModal() {
    var m = ensureModal('claudeRecoOptionsModal');
    var p = loadPrefs();
    var st = { cond: p.cond || '보통', goal: p.goal || 'fitness', time: Number(p.time) || 90, date: p.date || '' };
    function render() {
      var goal = GOALS.filter(function (g) { return g.id === st.goal; })[0];
      var min = ymd(new Date(Date.now() + 86400000));
      m.innerHTML = '<div style="' + CARD + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><b style="font-size:18px;">Claude 맞춤 워크아웃</b>' +
        '<button type="button" data-close style="border:0;background:none;font-size:22px;cursor:pointer;color:#6b7280;">✕</button></div>' +
        '<p style="margin:0 0 12px;font-size:12px;color:#6b7280;">FTP·최근 30일 훈련 기록이 내 Claude API 키로 Anthropic에 전송되며 사용량만큼 요금이 부과됩니다.</p>' +
        '<div style="font-weight:700;margin:10px 0 6px;">1. 오늘 컨디션</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + CONDS.map(function (c) { return chip('cond', c.id, c.id, st.cond === c.id); }).join('') + '</div>' +
        '<div style="font-weight:700;margin:14px 0 6px;">2. 훈련 목표</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + GOALS.map(function (g) { return chip('goal', g.id, g.label, st.goal === g.id); }).join('') + '</div>' +
        (goal && goal.ask ? '<div style="margin-top:10px;"><label style="font-size:13px;color:#374151;">대회 일자</label><input type="date" id="claudeRecoDate" min="' + min + '" value="' + esc(st.date) + '" style="width:100%;margin-top:4px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;"/></div>' : '') +
        '<div style="font-weight:700;margin:14px 0 6px;">3. 오늘 훈련 가능 시간</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + TIMES.map(function (t) { return chip('time', t.id, t.label, st.time === t.id); }).join('') + '</div>' +
        '<button type="button" data-go style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#7c3aed;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">워크아웃 추천 받기</button></div>';
      m.querySelector('[data-close]').onclick = function () { m.style.display = 'none'; };
      Array.prototype.forEach.call(m.querySelectorAll('[data-g]'), function (b) {
        b.onclick = function () {
          var g = b.getAttribute('data-g'), v = b.getAttribute('data-v');
          var di = $('claudeRecoDate'); if (di) st.date = di.value;
          st[g] = g === 'time' ? Number(v) : v;
          render();
        };
      });
      m.querySelector('[data-go]').onclick = function () {
        var di = $('claudeRecoDate'); if (di) st.date = di.value;
        var gl = GOALS.filter(function (g) { return g.id === st.goal; })[0];
        if (gl.ask) {
          if (!st.date) { toast('대회 일자를 선택해주세요.', 'warning'); return; }
          if (st.date <= ymd(new Date())) { toast('대회 일자는 오늘 이후로 선택해주세요.', 'warning'); return; }
        }
        savePrefs({ cond: st.cond, goal: st.goal, time: st.time, date: st.date });
        m.style.display = 'none';
        runRecommendation({ cond: st.cond, goal: st.goal, time: st.time, date: gl.ask ? st.date : '' });
      };
    }
    render();
    m.style.display = 'flex';
  }

  /* ---------------- 4) 최근 30일 로그 ---------------- */
  async function fetchLogs30(user) {
    var out = [];
    try {
      if (!user.id || typeof w.getTrainingLogsByDateRange !== 'function') return out;
      var today = new Date(), start = new Date(today); start.setDate(start.getDate() - 29);
      var sStr = ymd(start), eStr = ymd(today);
      var d = new Date(start.getFullYear(), start.getMonth(), 1), endD = new Date(today.getFullYear(), today.getMonth(), 1);
      while (d <= endD) {
        var logs = await w.getTrainingLogsByDateRange(user.id, d.getFullYear(), d.getMonth());
        (logs || []).forEach(function (log) {
          var dv = log.date;
          if (dv && typeof dv.toDate === 'function') dv = ymd(dv.toDate());
          else if (dv && typeof dv !== 'string') dv = (dv.toISOString ? ymd(dv) : String(dv).slice(0, 10));
          if (typeof dv === 'string') dv = dv.slice(0, 10);
          if (!dv || dv < sStr || dv > eStr) return;
          var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration || 0));
          if (sec < 60) return;
          out.push({
            completed_at: dv + 'T12:00:00.000Z', date: dv, name: log.title || log.workout_name || '훈련',
            min: Math.round(sec / 60), avgW: Math.round(log.avg_watts != null ? log.avg_watts : (log.avg_power || 0)),
            np: Math.round(log.weighted_watts != null ? log.weighted_watts : (log.np != null ? log.np : (log.avg_watts || log.avg_power || 0))),
            tss: Math.round(log.tss || 0), hr: Math.round(log.avg_hr || log.hr_avg || 0), duration_min: Math.round(sec / 60), source: log.source || ''
          });
        });
        d.setMonth(d.getMonth() + 1);
      }
      // 같은 날 Strava 있으면 Strava 우선 등 기존 TSS 규칙
      if (typeof w.buildHistoryWithTSSRuleByDate === 'function') {
        var ruled = w.buildHistoryWithTSSRuleByDate(out);
        if (Array.isArray(ruled)) out = ruled.map(function (r) { r.date = r.date || String(r.completed_at || '').slice(0, 10); r.name = r.name || r.workout_name || '훈련'; r.min = r.min || r.duration_min || 0; r.avgW = r.avgW != null ? r.avgW : (r.avg_power || 0); r.np = r.np != null ? r.np : (r.avgW || 0); return r; });
      }
    } catch (e) { console.warn('[ClaudeReco] 로그 조회 실패', e); }
    out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return out;
  }
  function summarizeLogs(logs) {
    var todayStr = ymd(new Date()), t0 = new Date(todayStr + 'T00:00:00');
    var weeks = [0, 0, 0, 0], total = 0, last7 = 0, last48 = 0, days = {}, daily = [];
    for (var i = 0; i < 30; i++) daily.push(0); // daily[0]=29일 전 … daily[29]=오늘
    logs.forEach(function (l) {
      var dd = Math.floor((t0 - new Date(l.date + 'T00:00:00')) / 86400000);
      var wi = Math.min(3, Math.max(0, Math.floor(dd / 7)));
      weeks[wi] += l.tss || 0; total += l.tss || 0; if (dd < 7) last7 += l.tss || 0; if (dd <= 1) last48 += l.tss || 0;
      days[l.date] = (days[l.date] || 0) + (l.tss || 0);
      if (dd >= 0 && dd < 30) daily[29 - dd] += l.tss || 0;
    });
    // CTL(42일)·ATL(7일) 지수가중 — 30일치만 있으므로 평균 일일 TSS 로 초기화한 추정치
    var seed = total / 30, ctl = seed, atl = seed;
    daily.forEach(function (t) { ctl += (t - ctl) / 42; atl += (t - atl) / 7; });
    var lastDate = logs.length ? logs[0].date : null;
    var daysSince = lastDate ? Math.floor((t0 - new Date(lastDate + 'T00:00:00')) / 86400000) : null;
    var hard = logs.filter(function (l) { return (l.tss || 0) >= 90; });
    var lastHard = hard.length ? Math.floor((t0 - new Date(hard[0].date + 'T00:00:00')) / 86400000) : null;
    return {
      sessions: logs.length, total_tss_30d: Math.round(total), weekly_tss_newest_first: weeks.map(Math.round), last7d_tss: Math.round(last7), last48h_tss: Math.round(last48),
      ctl_est: Math.round(ctl), atl_est: Math.round(atl), tsb_est: Math.round(ctl - atl),
      riding_days_30d: Object.keys(days).length, days_since_last_ride: daysSince, hard_sessions_tss90plus: hard.length, days_since_last_hard_session: lastHard,
      recent_sessions: logs.slice(0, 12).map(function (l) { return { date: l.date, name: String(l.name).slice(0, 40), min: l.min, avg_w: l.avgW, np_w: l.np, tss: l.tss, hr: l.hr || undefined }; })
    };
  }

  /* ---------------- 5) 프롬프트 ---------------- */
  var TOOL = {
    name: 'submit_workouts',
    description: '사이클 훈련 워크아웃 추천 결과 제출',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '오늘 추천 워크아웃 카테고리(예: Sweet Spot, Endurance, Threshold, VO2 Max, Recovery, Tempo, Over-Under)' },
        goal_comment: { type: 'string', description: '오늘 훈련 목표 1줄 코멘트(한국어, 60자 이내)' },
        workouts: {
          type: 'array', minItems: 3, maxItems: 3,
          items: {
            type: 'object',
            properties: {
              rank: { type: 'integer', description: '1~3 (1순위가 가장 적합)' },
              name: { type: 'string', description: '워크아웃 훈련명(한국어 가능, 25자 이내)' },
              category: { type: 'string' },
              why: { type: 'string', description: '이 워크아웃을 추천하는 이유 한 줄' },
              blocks: {
                type: 'array', minItems: 2,
                description: '순서대로 실행되는 블록. 합계 시간이 가능 시간 이내여야 함.',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['warmup', 'steady', 'interval', 'ramp', 'cooldown'] },
                    minutes: { type: 'number', description: 'steady/warmup/cooldown 길이(분), ramp 길이(분)' },
                    percent: { type: 'number', description: 'steady 목표 %FTP' },
                    from_percent: { type: 'number', description: 'warmup/cooldown/ramp 시작 %FTP' },
                    to_percent: { type: 'number', description: 'warmup/cooldown/ramp 끝 %FTP' },
                    reps: { type: 'integer', description: 'interval 반복 수' },
                    on_minutes: { type: 'number' }, on_percent: { type: 'number' },
                    off_minutes: { type: 'number' }, off_percent: { type: 'number' }
                  },
                  required: ['kind']
                }
              }
            },
            required: ['rank', 'name', 'category', 'blocks']
          }
        }
      },
      required: ['category', 'goal_comment', 'workouts']
    }
  };

  function buildPrompt(ctx) {
    var goal = ctx.goal, cond = ctx.cond, grade = ctx.grade, tm = ctx.time;
    var daysToEvent = ctx.date ? Math.ceil((new Date(ctx.date + 'T00:00:00') - new Date(ymd(new Date()) + 'T00:00:00')) / 86400000) : null;
    var sys = '당신은 세계 최고 수준의 사이클 파워 트레이닝 코치입니다(운동생리학·훈련 주기화·파워 기반 훈련 전문). ' +
      '사용자의 FTP·W/kg 등급·오늘 컨디션·최근 30일 부하(CTL/ATL/TSB 추정 포함)·훈련 목표·오늘 가능 시간을 모두 반영해 사이클 훈련에 과학적으로 최적화된 워크아웃 3개(1~3순위)를 설계하고, 반드시 submit_workouts 도구를 정확히 한 번 호출해서만 답하세요(텍스트 답변 금지).\n\n' +
      '[파워존(Coggan, %FTP)] Z1 활성회복 <55 / Z2 지구력 56~75 / Z3 템포 76~90 / 스위트스팟(SS) 88~94 / Z4 역치 91~105 / Z5 VO2max 106~120 / Z6 무산소 121~150 / Z7 신경근 최대(6~15초).\n\n' +
      '[세션 설계 원칙]\n' +
      '1) 한 세션 = 하나의 주 자극(SS·역치·VO2 중 하나). 서로 다른 에너지 시스템을 한 세션에 과적하지 말 것.\n' +
      '2) 인터벌 설계(일:휴식): SS 2~4x10~20분 @88~94% (휴식 3~5분 @50~55%) / 역치 2~3x8~20분 @95~105% (휴식 4~6분, 약 4:1) / VO2max 4~8x3~5분 @106~120% (휴식 = 일 시간의 100%, @45~50%) / 무산소 6~10x30~60초 @121~150% (휴식 2~4분) / 오버언더: reps x (on 2~3분 @102~105% + off 2~3분 @88~92%) / 지구력 Z2 연속(필요 시 짧은 템포 삽입) / 회복 Z1~Z2 낮은 케이던스 부담 없이.\n' +
      '3) 웜업 10~15분을 55%→75% 정도로 점진 상승(ramp)시키고, SS 이상의 질적 세션은 웜업 뒤에 오프너(예: 2x40초 @105~110%, 휴식 2분 @50%)를 넣을 것. 쿨다운 5~10분은 60%→40%로 점진 하강.\n' +
      '4) 부하 관리: TSB(=CTL−ATL) < −25면 회복/Z2 위주, −25~−10은 생산적 피로(중강도 가능, 고강도는 신중), −10~+5는 질적 훈련 적기, +5 이상이면 고강도·장시간 가능. 최근 48시간 TSS가 크거나(예: 90+) 마지막 고강도 세션이 1일 전이면 오늘은 지구력/회복 위주. 고강도(Z4 이상) 세션은 주 2회(최대 3회)로 제한하고 사이 48시간을 확보, 나머지는 Z1~Z2(극분화 80/20 또는 피라미드).\n' +
      '5) 점진적 과부하: 새 세션의 TSS는 최근 세션 평균/최근 7일 TSS 추세 대비 약 +5~10% 이내로 시작(기록이 없으면 보수적으로). 급격한 증가 금지.\n' +
      '6) 강도계수(IF) 가이드: 회복 <0.55, 지구력 0.55~0.75, 템포/SS 0.75~0.88, 역치 0.88~0.95, VO2 위주 0.90~1.05(짧은 시간). 등급별 IF 한도를 넘기지 말 것.\n' +
      '7) 컨디션: 최상=계획 강도 상단까지 가능, 좋음=계획대로, 보통=질적 훈련 유지하되 강도·볼륨을 3~5% 낮춤, 나쁨=인터벌 없이 Z1~Z2 회복 중심(IF ≤ 0.70).\n' +
      '8) 목표별 처방: 다이어트=긴 Z2 + 약간의 템포로 총 에너지 소모(칼로리) 극대화·회복 가능한 범위, 체력향상=지구력 기반 + 템포/SS + 가끔 VO2, FTP 향상=SS/역치/오버언더 중심, 그란폰도=장시간 Z2 + 오르막 대비 템포/SS·역치(지구력 우선), 대회=레이스 특이 훈련(역치·VO2·서지/변속) .\n' +
      '9) 대회/이벤트 D-day 주기화: D-84 이상=베이스(Z2·템포 볼륨), D-28~84=빌드(SS·역치·VO2 점진 과부하), D-14~28=피크(대회 특이·강도 유지, 볼륨 감소 시작), D-7~14=테이퍼 1(볼륨 −30~40%, 강도 유지), D-2~7=테이퍼 2(볼륨 −50~60%, 짧은 오프너 위주), D-1 이하=회복·오프너만(매우 짧게).\n' +
      '10) 시간 제약을 절대 넘기지 말 것(웜업·쿨다운 포함). 시간이 짧으면(60분 이내) 질을 높이고 볼륨을 줄이며, 길면(2시간 이상) 지구력 기반 + 후반부 템포/SS 블록 등으로 구성.\n' +
      '11) 세 안의 구성: 1순위=오늘의 상태에 가장 적합한 최적안, 2순위=다른 자극(에너지 시스템/형태)의 대안, 3순위=가장 보수적인 안(피로가 높거나 컨디션이 나빠도 수행 가능, 또는 더 짧은 안). 세 워크아웃의 이름·구성·카테고리가 서로 달라야 함.\n\n' +
      '[출력 규칙] 모든 강도는 %FTP(정수). 각 워크아웃은 warmup 으로 시작해 cooldown 으로 끝남. interval 블록은 reps x (on_minutes@on_percent + off_minutes@off_percent)로 표현(오버언더도 interval 로). 한 블록에 웜업·쿨다운을 섞지 말 것. 단일 구간 %FTP는 200 초과 금지. ' +
      'why 에는 이 워크아웃을 고른 근거를 TSB·최근 부하·목표·컨디션 수치를 들어 한 줄로(한국어). goal_comment 는 오늘 훈련의 목표를 1줄(60자 이내, 한국어).';
    var user = '[사용자]\n' +
      '- FTP: ' + ctx.ftp + 'W / 체중: ' + (ctx.weight || '미입력') + 'kg / W/kg: ' + (ctx.wkg ? ctx.wkg.toFixed(2) : '알 수 없음') + '\n' +
      '- 등급: ' + (grade ? grade.name + ' — ' + grade.hint + ' (IF 한도 ' + grade.ifMax + ')' : '알 수 없음(체중 미입력): 보수적으로 중급 이하 강도 적용') + '\n' +
      '  (등급 기준 W/kg: 입문 2.5 미만, 초급 2.5~3.2, 중급 3.2~3.7, 상급 3.7~4.2, 엘리트 4.2~5.0, 프로선수 5.0 이상)\n' +
      '[오늘 컨디션] ' + cond.id + ' — ' + cond.hint + '\n' +
      '[훈련 목표] ' + goal.label + ' — ' + goal.hint + '\n' +
      (daysToEvent != null ? '[대회/이벤트 일자] ' + ctx.date + ' (D-' + daysToEvent + '일) — 위 D-day 주기화 규칙의 해당 단계를 적용\n' : '') +
      '[오늘 가능 시간] ' + tm.label + ' → 총 시간 ' + tm.minMin + '~' + tm.maxMin + '분 범위(절대 ' + tm.maxMin + '분 초과 금지)\n' +
      '[최근 30일 훈련 요약(ctl_est/atl_est/tsb_est 는 30일 기록 기반 추정치)]\n' + JSON.stringify(ctx.summary) + '\n' +
      (ctx.summary.sessions === 0 ? '(최근 30일 기록 없음: 보수적으로 시작)\n' : '');
    return { sys: sys, user: user };
  }

  /* ---------------- 6) 블록 → 세그먼트 ---------------- */
  function clampPct(v, d) { v = Number(v); if (!isFinite(v) || v <= 0) v = d; return Math.max(30, Math.min(200, Math.round(v))); }
  function clampMin(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.min(240, v) : 0; }
  function blocksToSegments(blocks) {
    var segs = [], iv = 0, flow = [];
    (blocks || []).forEach(function (b) {
      var k = b.kind;
      if (k === 'interval') {
        var reps = Math.min(30, parseInt(b.reps, 10) || 0);
        var on = clampMin(b.on_minutes), off = clampMin(b.off_minutes), onP = clampPct(b.on_percent, 90), offP = clampPct(b.off_percent, 50);
        if (!on || !reps) return;
        iv++;
        for (var r = 1; r <= reps; r++) {
          segs.push({ label: '인터벌 ' + iv + (reps > 1 ? '-' + r : ''), segment_type: 'interval', duration_sec: Math.round(on * 60), target_type: 'ftp_pct', target_value: onP, ramp: 'none' });
          if (off) segs.push({ label: '휴식', segment_type: 'rest', duration_sec: Math.round(off * 60), target_type: 'ftp_pct', target_value: offP, ramp: 'none' });
        }
        flow.push(reps + ' X (' + fmtMin(on) + '@' + onP + '%' + (off ? ' + ' + fmtMin(off) + '@' + offP + '%' : '') + ')');
      } else if (k === 'steady') {
        var m = clampMin(b.minutes), p = clampPct(b.percent, 70); if (!m) return;
        segs.push({ label: '본운동', segment_type: 'interval', duration_sec: Math.round(m * 60), target_type: 'ftp_pct', target_value: p, ramp: 'none' });
        flow.push(fmtMin(m) + '@' + p + '%');
      } else {
        var mm = clampMin(b.minutes); if (!mm) return;
        var f = clampPct(b.from_percent != null ? b.from_percent : (k === 'cooldown' ? 60 : 50), k === 'cooldown' ? 60 : 50);
        var t = clampPct(b.to_percent != null ? b.to_percent : (k === 'cooldown' ? 45 : 70), k === 'cooldown' ? 45 : 70);
        var label = k === 'warmup' ? '웜업' : (k === 'cooldown' ? '쿨다운' : '램프');
        var seg = { label: label, segment_type: (k === 'warmup' ? 'warmup' : (k === 'cooldown' ? 'cooldown' : 'interval')), duration_sec: Math.round(mm * 60), target_type: 'ftp_pct', target_value: f, ramp: f !== t ? 'linear' : 'none' };
        if (f !== t) seg.ramp_to_value = t;
        segs.push(seg);
        flow.push((k === 'warmup' ? 'WD ' : (k === 'cooldown' ? 'CD ' : 'RAMP ')) + fmtMin(mm) + (f !== t ? '(' + f + '→' + t + '%)' : '@' + f + '%'));
      }
    });
    return { segments: segs, flow: flow.join(' | ') };
  }
  function fmtMin(m) { return (Math.round(m * 10) / 10) + 'm'; }
  function totalSec(segs) { return segs.reduce(function (s, x) { return s + (x.duration_sec || 0); }, 0); }
  function calcIF(segs) {
    var T = 0, s4 = 0;
    segs.forEach(function (x) {
      var t = x.duration_sec || 0; if (t <= 0) return;
      var a = (Number(x.target_value) || 50) / 100, b = x.ramp_to_value != null ? Number(x.ramp_to_value) / 100 : a;
      s4 += ((Math.pow(a, 4) + Math.pow(b, 4)) / 2) * t; T += t;
    });
    return T ? Math.pow(s4 / T, 0.25) : 0;
  }
  function calcTSS(segs) {
    var T = 0, s4 = 0;
    segs.forEach(function (s) {
      var t = s.duration_sec || 0; if (t <= 0) return;
      var a = (Number(s.target_value) || 50) / 100, b = s.ramp_to_value != null ? Number(s.ramp_to_value) / 100 : a;
      s4 += ((Math.pow(a, 4) + Math.pow(b, 4)) / 2) * t; T += t;
    });
    if (!T) return 0;
    var IF = Math.pow(s4 / T, 0.25);
    return Math.round((T / 3600) * IF * IF * 100);
  }

  /* ---------------- 7) API 호출 ---------------- */
  function callClaude(key, body, timeoutMs) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 90000) : null;
    return fetch(API_URL, {
      method: 'POST', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function (e) { if (e && e.name === 'AbortError') throw e; return {}; }).then(function (j) {
        if (!r.ok) {
          var msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
          var e = new Error(r.status === 401 ? 'Claude API 키가 올바르지 않습니다. 설정에서 다시 저장해주세요.' :
            r.status === 403 ? 'Claude API 사용 권한이 없습니다(키 권한/결제 확인).' :
            r.status === 429 ? '요청이 많거나 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.' :
            (r.status === 529 || r.status >= 500) ? 'Claude 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.' :
            (/credit|billing|balance/i.test(msg) ? 'Claude API 크레딧이 부족합니다. Anthropic 콘솔에서 충전해주세요.' : 'Claude 호출 실패: ' + msg));
          e.status = r.status; throw e;
        }
        return j;
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw new Error('응답 시간이 초과되었습니다. 다시 시도해주세요.');
      if (e && !e.status && /Failed to fetch|NetworkError|Load failed/i.test(String(e.message))) throw new Error('네트워크 오류로 Claude에 연결하지 못했습니다.');
      throw e;
    }).then(function (j) { if (timer) clearTimeout(timer); return j; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  async function runRecommendation(opts) {
    if (w.__claudeRecoBusy) return;
    var user = w.currentUser, key = getKey();
    if (!user || !key) { startClaudeFlow(); return; }
    w.__claudeRecoBusy = true;
    var modal = $('workoutRecommendationModal'), content = $('workoutRecommendationContent');
    if (modal) { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
    function status(msg) { if (content) content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><div class="loading-text">' + esc(msg) + '</div></div>'; }
    try {
      // 하루 1회: 다른 기기·직전 클릭으로 이미 생성됐다면 토큰을 쓰지 않고 그 결과를 보여줌
      var already = await loadToday(user);
      if (already) { showDay(already, true); return; }
      status('최근 30일 훈련 기록을 분석 중입니다...');
      var ftp = Math.round(Number(user.ftp) || 0) || 200;
      var weight = Number(user.weight) || 0;
      var wkg = weight > 0 ? ftp / weight : 0;
      var logs = await fetchLogs30(user);
      var ctx = {
        ftp: ftp, weight: weight, wkg: wkg, grade: gradeFor(wkg),
        cond: CONDS.filter(function (c) { return c.id === opts.cond; })[0] || CONDS[2],
        goal: GOALS.filter(function (g) { return g.id === opts.goal; })[0] || GOALS[1],
        time: TIMES.filter(function (t) { return t.id === opts.time; })[0] || TIMES[1],
        date: opts.date, summary: summarizeLogs(logs)
      };
      var pr = buildPrompt(ctx);
      var messages = [{ role: 'user', content: pr.user }], result = null, lastErr = '';
      for (var attempt = 0; attempt < 2 && !result; attempt++) {
        status('Claude가 맞춤 워크아웃을 설계 중입니다...' + (attempt ? ' (보정 중)' : ''));
        var res = await callClaude(key, { model: MODEL, max_tokens: 12000, output_config: { effort: 'high' }, system: pr.sys, tools: [TOOL], tool_choice: { type: 'auto' }, messages: messages }, 150000);
        var tu = (res.content || []).filter(function (c) { return c.type === 'tool_use' && c.name === 'submit_workouts'; })[0];
        if (!tu || !tu.input) { lastErr = res.stop_reason === 'max_tokens' ? '응답이 길어 잘렸습니다.' : '응답 형식이 올바르지 않습니다.'; continue; }
        var checked = validate(tu.input, ctx, attempt > 0); // 2차 시도는 IF 한도를 경고로만 취급(시간 제한은 항상 적용)
        if (checked.ok) { result = checked.data; break; }
        lastErr = checked.error;
        messages = [{ role: 'user', content: pr.user + '\n\n[이전 응답 문제] ' + checked.error + '\n위 문제를 고쳐 다시 submit_workouts 로 제출하세요.' }];
      }
      if (!result) throw new Error('조건에 맞는 워크아웃을 만들지 못했습니다. ' + lastErr);
      var day = {
        date: ymd(new Date()), category: result.category, comment: result.comment, workouts: result.workouts,
        label: ctx.goal.label + ' · 컨디션 ' + ctx.cond.id + ' · ' + ctx.time.label + (ctx.grade ? ' · ' + ctx.grade.name + ' (' + ctx.wkg.toFixed(2) + ' W/kg)' : '')
      };
      day = await saveDay(user, day); // 서버 저장(실패해도 이 기기에는 저장) — 다른 기기에서 먼저 만든 게 있으면 그걸 반환
      showDay(day, false);
    } catch (e) {
      console.warn('[ClaudeReco]', e);
      if (content) content.innerHTML = '<div style="padding:24px;text-align:center;"><div style="font-size:15px;color:#b91c1c;margin-bottom:14px;">' + esc(e && e.message || '추천 중 오류가 발생했습니다.') + '</div>' +
        '<button type="button" onclick="document.getElementById(\'workoutRecommendationModal\').style.display=\'none\'" style="padding:10px 18px;border:0;border-radius:10px;background:#e5e7eb;cursor:pointer;">닫기</button></div>';
    } finally { w.__claudeRecoBusy = false; }
  }

  /* ---------------- 하루 1회 캐시 + 서버 저장(나의 훈련 목록) ---------------- */
  function dayKey(user) { return 'claudeRecoDay:' + user.id + ':' + ymd(new Date()); }
  function rpcFn() {
    return typeof w.stelvioSupabaseRpc === 'function' ? Promise.resolve(w.stelvioSupabaseRpc)
      : import('/assets/js/supabaseDualWrite.js').then(function (m) { return m.callSupabaseRpcAsUser; });
  }
  function rpc(name, args) { return rpcFn().then(function (f) { return f(name, args); }); }
  function fromServer(res) {
    var items = (res.items || []).map(function (it) {
      return { id: it.id, rank: it.rank, name: it.title, category: it.category, why: it.why, flow: it.flow, seconds: it.total_seconds, tss: it.tss, segments: it.segments || [], date: it.workout_date };
    });
    var m = res.meta || {};
    return { date: items.length ? String(items[0].date).slice(0, 10) : ymd(new Date()), category: m.category || (items[0] && items[0].category) || '', comment: m.comment || '', label: m.label || '', workouts: items };
  }
  function cacheLocal(user, day) {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('claudeRecoDay:' + user.id + ':') === 0 && k !== dayKey(user)) localStorage.removeItem(k); });
      localStorage.setItem(dayKey(user), JSON.stringify(day));
    } catch (e) { console.warn('[ClaudeReco] 오늘 결과 캐시를 이 기기에 저장하지 못함(서버 기록으로 대체)', e && e.name); }
  }
  /** 오늘 이미 생성된 결과(없으면 null): 이 기기 캐시 → 서버 순 */
  async function loadToday(user) {
    try { var c = JSON.parse(localStorage.getItem(dayKey(user)) || 'null'); if (c && c.workouts && c.workouts.length) return c; } catch (e) {}
    try {
      var res = await rpc('fn_ai_workout_day_get', { p_date: ymd(new Date()) });
      if (res && res.success && res.exists) {
        var day = fromServer(res);
        if (day.workouts.length) { cacheLocal(user, day); return day; }
        return { date: ymd(new Date()), category: '', comment: '', label: '', workouts: [], emptied: true }; // 오늘 생성했지만 목록에서 전부 삭제됨
      }
    } catch (e) { console.warn('[ClaudeReco] 오늘 기록 조회 실패', e); }
    return null;
  }
  async function saveDay(user, day) {
    cacheLocal(user, day); // 서버 저장이 실패해도 이 기기에서는 하루 1회 보장
    try {
      var res = await rpc('fn_ai_workout_day_save', {
        p_date: ymd(new Date()),
        p_meta: { category: day.category, comment: day.comment, label: day.label },
        p_items: day.workouts.map(function (x) { return { title: x.name, category: x.category, why: x.why, flow: x.flow, total_seconds: x.seconds, tss: x.tss, segments: x.segments }; })
      });
      if (res && res.success && res.items && res.items.length) { var d2 = fromServer(res); if (d2.workouts.length) { cacheLocal(user, d2); return d2; } }
    } catch (e) { console.warn('[ClaudeReco] 서버 저장 실패(이 기기에는 저장됨)', e); }
    return day;
  }
  function showDay(day, cached) {
    var modal = $('workoutRecommendationModal'); if (modal) { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
    renderResult(day, cached);
  }

  function validate(input, ctx, relaxed) {
    var list = Array.isArray(input.workouts) ? input.workouts : [];
    if (list.length < 1) return { ok: false, error: '워크아웃이 비어 있습니다.' };
    var out = [], maxSec = ctx.time.maxMin * 60, minSec = Math.max(20, ctx.time.minMin - 15) * 60;
    var ifCap = ctx.grade ? ctx.grade.ifMax : 0.88;
    if (ctx.cond && ctx.cond.id === '나쁨') ifCap = Math.min(ifCap, 0.72);
    for (var i = 0; i < list.length && out.length < 3; i++) {
      var wk = list[i], conv = blocksToSegments(wk.blocks), t = totalSec(conv.segments);
      if (!conv.segments.length) continue;
      if (t > maxSec + 60) return { ok: false, error: '"' + (wk.name || i + 1) + '" 총 ' + Math.round(t / 60) + '분 — 가능 시간 ' + ctx.time.maxMin + '분 이내로 줄여야 합니다.' };
      if (t < minSec) return { ok: false, error: '"' + (wk.name || i + 1) + '" 총 ' + Math.round(t / 60) + '분 — 너무 짧습니다. ' + ctx.time.minMin + '~' + ctx.time.maxMin + '분으로 맞춰주세요.' };
      var IFv = calcIF(conv.segments);
      if (!relaxed && IFv > ifCap + 0.005) return { ok: false, error: '"' + (wk.name || i + 1) + '" 강도계수(IF) ' + IFv.toFixed(2) + ' — 이 사용자(' + (ctx.grade ? ctx.grade.name : '등급 미상') + ', 컨디션 ' + (ctx.cond ? ctx.cond.id : '') + ')의 IF 한도 ' + ifCap.toFixed(2) + ' 이하로 낮춰주세요.' };
      out.push({ rank: Number(wk.rank) || i + 1, name: String(wk.name || '맞춤 워크아웃').slice(0, 40), category: String(wk.category || input.category || '').slice(0, 30), why: String(wk.why || '').slice(0, 160), segments: conv.segments, flow: conv.flow, seconds: t, tss: calcTSS(conv.segments) });
    }
    if (!out.length) return { ok: false, error: '유효한 워크아웃이 없습니다.' };
    out.sort(function (a, b) { return a.rank - b.rank; });
    return { ok: true, data: { category: String(input.category || out[0].category || '').slice(0, 30), comment: String(input.goal_comment || '').slice(0, 120), workouts: out } };
  }

  /* ---------------- 8) 결과 화면 ---------------- */
  var COLORS = ['#3b82f6', '#10b981', '#f59e0b'];
  function barsHtml(wk) {
    return (wk.segments || []).map(function (s) {
      var v = Number(s.ramp_to_value) || Number(s.target_value) || 50;
      var h = Math.max(8, Math.min(100, Math.round((v / 140) * 100)));
      var c = s.target_value >= 106 ? '#ef4444' : s.target_value >= 91 ? '#f97316' : s.target_value >= 76 ? '#eab308' : s.target_value >= 56 ? '#22c55e' : '#94a3b8';
      return '<div style="flex:' + s.duration_sec + ';height:' + h + '%;background:' + c + ';min-width:1px;"></div>';
    }).join('');
  }
  function renderResult(day, cached) {
    var content = $('workoutRecommendationContent'); if (!content) return;
    w.__claudeRecs = day.workouts;
    if (!day.workouts.length) {
      content.innerHTML = '<div style="padding:24px;text-align:center;color:#374151;">오늘 이미 Claude 추천을 받으셨습니다(하루 1회).<br>저장된 워크아웃은 목록에서 모두 삭제되었습니다. 내일 다시 추천받을 수 있어요.<br><br><button type="button" data-claude-list style="padding:10px 18px;border:0;border-radius:10px;background:#7c3aed;color:#fff;cursor:pointer;">나의 훈련 목록 보기</button></div>';
      var lb = content.querySelector('[data-claude-list]'); if (lb) lb.onclick = openSavedList;
      return;
    }
    var html = '<div style="padding:4px 2px;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;"><span style="background:#7c3aed;color:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">Claude</span>' +
      '<b style="font-size:17px;color:#111827;">추천 카테고리: ' + esc(day.category) + '</b></div>' +
      '<div style="font-size:14px;color:#374151;line-height:1.5;margin-bottom:6px;">' + esc(day.comment) + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">' + esc(day.label) + '</div>' +
      '<div style="font-size:12px;color:#5b21b6;background:#f5f3ff;border-radius:8px;padding:8px 10px;margin-bottom:12px;line-height:1.5;">' +
      (cached ? '오늘(' + esc(day.date) + ') 이미 생성된 워크아웃입니다. Claude 추천은 하루 1회이며, 다시 열어도 토큰이 사용되지 않습니다.' : '오늘 추천 3개가 <b>나의 훈련 목록</b>에 저장되었습니다. 다음에도 사용할 수 있어요.') +
      ' <a href="javascript:void(0)" data-claude-list style="color:#5b21b6;font-weight:700;text-decoration:underline;">나의 훈련 목록 ›</a></div>';
    day.workouts.forEach(function (wk, idx) {
      var col = COLORS[idx] || '#6b7280', total = wk.seconds || 1;
      html += '<div data-claude-pick="' + idx + '" style="border:2px solid ' + col + ';border-radius:12px;padding:14px;margin-bottom:12px;cursor:pointer;background:#fff;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;"><div style="width:30px;height:30px;border-radius:50%;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none;">' + (idx + 1) + '</div>' +
        '<div style="min-width:0;"><div style="font-size:16px;font-weight:700;color:#111827;word-break:keep-all;">' + esc(wk.name) + '</div><div style="font-size:12px;color:#6b7280;">' + esc(wk.category) + '</div></div></div>' +
        '<div style="font-size:12px;color:#374151;text-align:right;flex:none;">' + Math.round(total / 60) + '분<br>예상 TSS ' + wk.tss + '</div></div>' +
        (wk.why ? '<div style="font-size:13px;color:#6b7280;margin-bottom:8px;">' + esc(wk.why) + '</div>' : '') +
        '<div style="display:flex;align-items:flex-end;gap:1px;height:56px;background:#f9fafb;border-radius:8px;padding:6px;margin-bottom:8px;">' + barsHtml(wk) + '</div>' +
        '<div style="font-size:12px;font-family:ui-monospace,Menlo,monospace;color:#374151;background:#f3f4f6;border-radius:8px;padding:8px;line-height:1.5;word-break:break-word;">' + esc(wk.flow) + '</div>' +
        '<div style="margin-top:8px;text-align:right;font-size:12px;color:' + col + ';font-weight:700;">선택하면 훈련 준비 화면으로 이동 ›</div></div>';
    });
    html += '</div>';
    content.innerHTML = html;
    Array.prototype.forEach.call(content.querySelectorAll('[data-claude-pick]'), function (el) {
      el.onclick = function () { pick(w.__claudeRecs[Number(el.getAttribute('data-claude-pick'))]); };
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-claude-list]'), function (el) { el.onclick = openSavedList; });
  }
  function pick(wk) {
    if (!wk) return;
    w.__aiRecommendationInProgress = false;
    if (typeof w.selectAIRecommendedWorkout !== 'function') { toast('워크아웃 준비 기능을 불러오지 못했습니다.', 'error'); return; }
    var sm = $('claudeRecoSavedModal'); if (sm) sm.style.display = 'none';
    w.selectAIRecommendedWorkout(Number(wk.rank) || 1, wk.name, JSON.parse(JSON.stringify(wk.segments)));
    try { if (w.currentWorkout) { w.currentWorkout.description = 'Claude AI가 생성한 워크아웃 · ' + wk.flow; w.currentWorkout.author = 'Claude AI'; w.currentWorkout.id = 'claude-ai-' + (wk.id || Date.now()); } } catch (e) {}
  }

  /* ---------------- 나의 훈련 목록(저장된 Claude 워크아웃) ---------------- */
  async function openSavedList() {
    var m = ensureModal('claudeRecoSavedModal');
    m.style.zIndex = '100001';
    m.innerHTML = '<div style="' + CARD + '"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b style="font-size:18px;display:inline-flex;align-items:center;">' + '<img src="assets/img/workout-bars-purple.svg?v=20261111" alt="" aria-hidden="true" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:8px;">' + '나의 훈련 목록 <span style="font-size:11px;background:#7c3aed;color:#fff;border-radius:999px;padding:2px 8px;vertical-align:middle;">Claude</span></b>' +
      '<button type="button" data-close style="border:0;background:none;font-size:22px;cursor:pointer;color:#6b7280;">✕</button></div><div data-body style="font-size:14px;color:#6b7280;padding:16px 0;text-align:center;">불러오는 중...</div></div>';
    m.style.display = 'flex';
    m.querySelector('[data-close]').onclick = function () { m.style.display = 'none'; };
    var body = m.querySelector('[data-body]');
    try {
      var res = await rpc('fn_ai_workout_list', { p_limit: 90 });
      if (!res || !res.success) throw new Error('목록을 불러오지 못했습니다.');
      var items = (res.items || []).map(function (it) { return { id: it.id, rank: it.rank, name: it.title, category: it.category, why: it.why, flow: it.flow, seconds: it.total_seconds, tss: it.tss, segments: it.segments || [], date: String(it.workout_date).slice(0, 10) }; });
      w.__claudeSaved = items;
      if (!items.length) { body.textContent = '저장된 워크아웃이 없습니다. Claude 추천을 받으면 이곳에 저장됩니다.'; return; }
      var html = '', lastDate = '';
      items.forEach(function (wk, i) {
        if (wk.date !== lastDate) { lastDate = wk.date; html += '<div style="font-weight:700;color:#111827;margin:12px 0 6px;text-align:left;">' + esc(wk.date) + '</div>'; }
        html += '<div data-card="' + i + '" style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin-bottom:8px;text-align:left;content-visibility:auto;contain-intrinsic-size:auto 130px;">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;"><div style="min-width:0;"><div style="font-weight:700;color:#111827;">' + esc(wk.name) + '</div><div style="font-size:12px;color:#6b7280;">' + esc(wk.category) + ' · ' + Math.round(wk.seconds / 60) + '분 · TSS ' + wk.tss + '</div></div>' +
          '<div style="display:flex;gap:6px;flex:none;align-items:flex-start;"><button type="button" data-use="' + i + '" style="padding:6px 12px;border:0;border-radius:8px;background:#7c3aed;color:#fff;font-size:13px;cursor:pointer;">사용</button>' +
          '<button type="button" data-del="' + i + '" aria-label="삭제" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#b91c1c;font-size:13px;cursor:pointer;">삭제</button></div></div>' +
          '<div style="display:flex;align-items:flex-end;gap:1px;height:36px;background:#f9fafb;border-radius:6px;padding:4px;margin:8px 0 6px;">' + barsHtml(wk) + '</div>' +
          '<div style="font-size:11px;font-family:ui-monospace,Menlo,monospace;color:#4b5563;word-break:break-word;">' + esc(wk.flow) + '</div></div>';
      });
      body.style.textAlign = 'left'; body.style.padding = '0'; body.innerHTML = html;
      Array.prototype.forEach.call(body.querySelectorAll('[data-use]'), function (b) { b.onclick = function () { pick(w.__claudeSaved[Number(b.getAttribute('data-use'))]); }; });
      Array.prototype.forEach.call(body.querySelectorAll('[data-del]'), function (b) {
        b.onclick = async function () {
          var wk = w.__claudeSaved[Number(b.getAttribute('data-del'))];
          if (!wk || !confirm('"' + wk.name + '" 워크아웃을 목록에서 삭제할까요?')) return;
          try {
            await rpc('fn_ai_workout_delete', { p_id: wk.id });
            try { var u = w.currentUser; if (u) localStorage.removeItem(dayKey(u)); } catch (e) {}
            // 전체 목록을 다시 불러와 다시 그리지 않고 해당 카드만 제거(날짜 제목만 남으면 함께 제거)
            var card = b.closest('[data-card]');
            if (card) {
              var prev = card.previousElementSibling, next = card.nextElementSibling;
              card.remove();
              if (prev && !prev.hasAttribute('data-card') && (!next || !next.hasAttribute('data-card'))) prev.remove();
              if (!body.querySelector('[data-card]')) body.textContent = '저장된 워크아웃이 없습니다. Claude 추천을 받으면 이곳에 저장됩니다.';
            } else { openSavedList(); }
          } catch (e) { toast('삭제하지 못했습니다.', 'error'); }
        };
      });
    } catch (e) { body.textContent = (e && e.message) || '목록을 불러오지 못했습니다.'; }
  }

  /* ---------------- 9) 설정: Claude 키 저장/삭제/검증 ----------------
   * 2026-11-11 수정: 알림(toast)이 설정 모달 뒤에 가려져 결과가 안 보이던 문제 → 상태줄(모달 안)에 결과를 고정 표시 + 오류는 alert.
   * 키 검증은 토큰을 쓰지 않는 GET /v1/models 로(모델명·요청 형식과 무관, 401 = 잘못된 키). */
  var statusMsg = null; // { text, kind('ok'|'err'|'info') } — 사용자가 마지막으로 본 결과를 유지
  function setStatus(text, kind) { statusMsg = text ? { text: text, kind: kind || 'info' } : null; updateStatusLine(); }
  function updateStatusLine() {
    var el = $('settingsClaudeApiStatusLine'), inp = $('settingsClaudeApiKey'), k = getKey();
    if (el) {
      var def = k ? (memOnly ? '⚠ 키는 확인됐지만 이 기기에 저장하지 못해 이번 접속 동안만 유지됩니다.' : '✅ Claude API 키가 이 기기에 저장되어 있습니다.') : '키가 없으면 Claude 추천을 사용할 수 없습니다. (console.anthropic.com 에서 발급 후 입력 → 저장)';
      el.textContent = statusMsg ? statusMsg.text : def;
      el.style.color = statusMsg ? (statusMsg.kind === 'err' ? '#b91c1c' : (statusMsg.kind === 'ok' ? '#15803d' : '#64748b')) : (k ? (memOnly ? '#b45309' : '#15803d') : '#64748b');
      el.style.fontWeight = statusMsg ? '600' : '400';
    }
    if (inp) { if (k) { inp.value = '••••••••••••••••'; inp.disabled = true; } else if (inp.disabled) { inp.value = ''; inp.disabled = false; } }
  }
  function describeKeyError(e) {
    var st = e && e.status, m = (e && e.message) || '';
    if (st === 401) return 'Claude API 키가 올바르지 않습니다. console.anthropic.com 에서 키를 다시 복사해 입력해주세요.';
    if (st === 403) return 'Claude API 사용 권한이 없는 키입니다(권한·조직 설정 확인).';
    if (st === 429) return '요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
    if (st >= 500) return 'Claude 서버 응답 오류(' + st + '). 잠시 후 다시 시도해주세요.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '네트워크 오류로 Claude 에 연결하지 못했습니다. 인터넷 연결(VPN·광고차단 확장 프로그램 포함)을 확인해주세요.';
    return m || '키 검증에 실패했습니다.';
  }
  /** 토큰을 쓰지 않는 키 확인: 모델 목록 1건 조회 */
  function verifyKey(key) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.ok) return true;
      return r.json().catch(function () { return {}; }).then(function (j) {
        var e = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status)); e.status = r.status; throw e;
      });
    }, function (e) { if (timer) clearTimeout(timer); if (e && e.name === 'AbortError') throw new Error('응답 시간이 초과되었습니다. 다시 시도해주세요.'); throw e; });
  }
  function btnBusy(id, busy, idle) { var b = $(id); if (b) { b.disabled = !!busy; b.textContent = busy ? '확인 중...' : idle; } }

  w.saveClaudeApiKeyFromSettings = async function () {
    var inp = $('settingsClaudeApiKey'); if (!inp) { alert('설정 화면 요소를 찾지 못했습니다. 새로고침 후 다시 시도해주세요.'); return; }
    var v = inp.disabled ? '' : (inp.value || '').trim();
    if (!v) { var msg0 = getKey() ? '이미 키가 저장되어 있습니다. 바꾸려면 [삭제] 후 새 키를 입력하세요.' : 'Claude API 키를 입력해주세요.'; setStatus(msg0, getKey() ? 'ok' : 'err'); if (!getKey()) alert(msg0); return; }
    v = v.replace(/\s+/g, '');
    if (!/^sk-ant-/.test(v)) { var m1 = 'Claude API 키는 sk-ant- 로 시작합니다. (Gemini 키가 아닌 Anthropic 키를 입력해주세요)'; setStatus(m1, 'err'); alert(m1); return; }
    btnBusy('settingsSaveClaudeKeyBtn', true, '저장'); setStatus('키 확인 중...', 'info');
    try {
      await verifyKey(v);
      var saved = await saveKey(v);
      var persisted = saved.ls || saved.idb, note = '';
      memOnly = !persisted;
      if (!saved.ls && saved.idb) note = ' (브라우저 저장 공간이 가득 차 보조 저장소에 저장했습니다)';
      if (!persisted) {
        var big = bigLocalStorageKeys(3).join(', ');
        console.warn('[ClaudeReco] 키를 영구 저장하지 못함. localStorage 큰 항목:', bigLocalStorageKeys(8));
        var warn = '⚠ 키는 확인됐지만 이 기기의 저장 공간이 가득 차 영구 저장하지 못했습니다. 이번 접속 동안만 사용할 수 있고, 새로고침하면 다시 입력해야 합니다.' + (big ? ' (큰 항목: ' + big + ')' : '');
        setStatus(warn, 'err'); alert(warn);
        if (w.__claudeRecoAfterKey && Date.now() - w.__claudeRecoAfterKey < 10 * 60000) { w.__claudeRecoAfterKey = 0; if (typeof w.closeSettingsModal === 'function') w.closeSettingsModal(); setTimeout(function () { w.startClaudeRecommendFlow && w.startClaudeRecommendFlow(); }, 300); }
        return;
      }
      setStatus('✅ Claude API 키가 확인되어 저장되었습니다.' + note, 'ok');
      try { w.dispatchEvent(new CustomEvent('stelvio-claude-apikey-changed', { detail: { hasKey: true } })); } catch (e) {}
      if (w.__claudeRecoAfterKey && Date.now() - w.__claudeRecoAfterKey < 10 * 60000) {
        w.__claudeRecoAfterKey = 0;
        if (typeof w.closeSettingsModal === 'function') w.closeSettingsModal();
        setTimeout(function () { w.startClaudeRecommendFlow && w.startClaudeRecommendFlow(); }, 300);
      } else { alert('Claude API 키가 저장되었습니다.' + note); }
    } catch (e) {
      console.warn('[ClaudeReco] 키 저장 실패', e);
      var m2 = describeKeyError(e); setStatus('❌ ' + m2, 'err'); alert(m2);
    } finally { btnBusy('settingsSaveClaudeKeyBtn', false, '저장'); }
  };
  w.testClaudeApiKeyFromSettings = async function () {
    var inp = $('settingsClaudeApiKey');
    var k = getKey() || (inp && !inp.disabled ? (inp.value || '').replace(/\s+/g, '') : '');
    if (!k) { var m0 = '먼저 Claude API 키를 입력해주세요.'; setStatus(m0, 'err'); alert(m0); return; }
    if (!/^sk-ant-/.test(k)) { var m1 = 'Claude API 키는 sk-ant- 로 시작합니다.'; setStatus(m1, 'err'); alert(m1); return; }
    btnBusy('settingsTestClaudeKeyBtn', true, 'API 키 검증'); setStatus('키 확인 중...', 'info');
    try {
      await verifyKey(k);
      var ok = '✅ Claude API 키가 정상입니다.' + (getKey() ? '' : ' (아직 저장 전입니다 — [저장]을 눌러주세요)');
      setStatus(ok, 'ok'); alert(ok);
    } catch (e) { var m2 = describeKeyError(e); setStatus('❌ ' + m2, 'err'); alert(m2); }
    finally { btnBusy('settingsTestClaudeKeyBtn', false, 'API 키 검증'); }
  };
  w.resetClaudeApiKeyFromSettings = async function () {
    if (getKey() && !confirm('저장된 Claude API 키를 삭제할까요?')) return;
    await removeKey();
    var inp = $('settingsClaudeApiKey'); if (inp) { inp.disabled = false; inp.value = ''; }
    setStatus('키를 삭제했습니다. 새 키를 입력하고 저장하세요.', 'info');
    var i2 = $('settingsClaudeApiKey'); if (i2) i2.focus();
  };
  // 설정 모달이 열릴 때 상태 갱신(클릭마다 덮어쓰지 않음)
  (function hookSettingsOpen() {
    function wrap() {
      if (typeof w.openSettingsModal !== 'function' || w.openSettingsModal.__claudeWrapped) return !!(w.openSettingsModal && w.openSettingsModal.__claudeWrapped);
      var orig = w.openSettingsModal;
      var wrapped = function () { var r = orig.apply(this, arguments); setTimeout(updateStatusLine, 0); return r; };
      wrapped.__claudeWrapped = true; w.openSettingsModal = wrapped; return true;
    }
    if (!wrap()) { var n = 0, t = setInterval(function () { if (wrap() || ++n > 40) clearInterval(t); }, 500); }
  })();
  document.addEventListener('DOMContentLoaded', updateStatusLine);
  setTimeout(updateStatusLine, 1500);

  /* ---------------- 공개 ---------------- */
  w.handleAIRecommendationClick = function () {
    if (w.__aiRecommendationInProgress) return;
    var user = w.currentUser;
    if (!user || !user.id) { toast('사용자 정보가 없습니다. 먼저 로그인해주세요.', 'error'); return; }
    openChooser();
  };
  w.openClaudeRecommendOptions = openOptionsModal;
  w.startClaudeRecommendFlow = startClaudeFlow;
  w.__claudeReco = { loadToday: loadToday, saveDay: saveDay, blocksToSegments: blocksToSegments, calcTSS: calcTSS, calcIF: calcIF, summarizeLogs: summarizeLogs, validate: validate, gradeFor: gradeFor, buildPrompt: buildPrompt, GRADES: GRADES };
})(window);
