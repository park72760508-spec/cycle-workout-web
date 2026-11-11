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
  var TEST_MODEL = 'claude-haiku-5-5';
  var API_URL = 'https://api.anthropic.com/v1/messages';

  var GRADES = [
    { max: 2.5, name: '입문', hint: '주로 Z1~Z2(55~75%), 인터벌은 짧고 낮게(최대 SS 85~90%, 1회 8~10분 이하). 총 부하 낮게, 꾸준함 우선.' },
    { max: 3.2, name: '초급', hint: 'Z2 중심 + 가벼운 템포/SS(최대 88~92%, 1회 10~15분). 고강도(VO2)는 짧게(2~3분)·소량.' },
    { max: 3.7, name: '중급', hint: 'Z2·템포·SS·역치(95~100%, 1회 10~20분) 균형. VO2(106~118%) 3~4분 x 4~5회까지.' },
    { max: 4.2, name: '상급', hint: 'SS·역치·오버언더·VO2 적극 활용(역치 2x20분, VO2 5x4~5분 가능). 회복 간격 충분히.' },
    { max: 5.0, name: '엘리트', hint: '고강도 볼륨 높음(역치 3x15~20분, VO2 6x4분, 혐기 30~60초 반복). 회복일 엄수.' },
    { max: 99, name: '프로선수', hint: '대회 특이 훈련·고강도 큰 볼륨(역치 3x20분+, VO2 6~8x4~5분, 스프린트·혐기). 정확한 회복·테이퍼링.' }
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
  function getKey() { try { return (localStorage.getItem(KEY_NAME) || '').trim(); } catch (e) { return ''; } }
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
      '</div>';
    m.style.display = 'flex';
    m.querySelector('[data-close]').onclick = function () { m.style.display = 'none'; };
    m.querySelector('[data-eng="gemini"]').onclick = function () { m.style.display = 'none'; if (typeof w.handleGeminiRecommendationClick === 'function') w.handleGeminiRecommendationClick(); };
    m.querySelector('[data-eng="claude"]').onclick = function () { m.style.display = 'none'; startClaudeFlow(); };
  }

  /* ---------------- 2) Claude 키 확인 → 설정 ---------------- */
  function startClaudeFlow() {
    var user = w.currentUser;
    if (!user || !user.id) { toast('사용자 정보가 없습니다. 먼저 로그인해주세요.', 'error'); return; }
    if (!getKey()) { openSettingsForClaudeKey(); return; }
    openOptionsModal();
  }
  function openSettingsForClaudeKey() {
    if (typeof w.openSettingsModal === 'function') w.openSettingsModal();
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
    var weeks = [0, 0, 0, 0], total = 0, last7 = 0, days = {};
    logs.forEach(function (l) {
      var dd = Math.floor((t0 - new Date(l.date + 'T00:00:00')) / 86400000);
      var wi = Math.min(3, Math.max(0, Math.floor(dd / 7)));
      weeks[wi] += l.tss || 0; total += l.tss || 0; if (dd < 7) last7 += l.tss || 0; days[l.date] = (days[l.date] || 0) + (l.tss || 0);
    });
    var lastDate = logs.length ? logs[0].date : null;
    var daysSince = lastDate ? Math.floor((t0 - new Date(lastDate + 'T00:00:00')) / 86400000) : null;
    var hard = logs.filter(function (l) { return (l.tss || 0) >= 90; }).length;
    return {
      sessions: logs.length, total_tss_30d: Math.round(total), weekly_tss_newest_first: weeks.map(Math.round), last7d_tss: Math.round(last7),
      riding_days_30d: Object.keys(days).length, days_since_last_ride: daysSince, hard_sessions_tss90plus: hard,
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
    var sys = '당신은 사이클 전문 코치입니다. 사용자의 FTP·W/kg 등급·오늘 컨디션·최근 30일 훈련 로그·훈련 목표·오늘 가능 시간을 모두 반영해 도로/실내 사이클 훈련에 최적화된 워크아웃 3개(1~3순위)를 설계하고 submit_workouts 도구로만 답하세요.\n' +
      '규칙:\n' +
      '- 모든 강도는 %FTP(정수)로 표현. 구간 합계 시간은 반드시 가능 시간 이내(웜업·쿨다운 포함).\n' +
      '- 모든 워크아웃은 웜업(warmup)으로 시작해 쿨다운(cooldown)으로 끝낼 것(각 5~15분, 점진 상승/하강 ramp 사용 가능).\n' +
      '- 최근 30일 부하(주간 TSS, 최근 7일 TSS, 마지막 라이딩 이후 일수, 고강도 횟수)로 피로를 판단해 과부하면 회복/지구력 위주로, 휴식이 충분하면 질적 훈련을 배치.\n' +
      '- 1순위=가장 적합, 2·3순위=강도/형태가 다른 대안(예: 한 단계 쉬운 안/한 단계 강한 안). 세 워크아웃의 이름·구성이 서로 달라야 함.\n' +
      '- interval 블록은 reps x (on_minutes@on_percent + off_minutes@off_percent). 한 블록에 웜업·쿨다운을 섞지 말 것.\n' +
      '- 등급별 강도 상한을 넘기지 말 것. 안전을 위해 단일 인터벌 %FTP는 200 초과 금지.\n' +
      '- 한국어로, goal_comment는 오늘 훈련의 목표를 1줄(60자 이내)로.\n- 반드시 submit_workouts 도구를 정확히 한 번 호출해서 답하세요(텍스트로 답하지 말 것).';
    var user = '[사용자]\n' +
      '- FTP: ' + ctx.ftp + 'W / 체중: ' + (ctx.weight || '미입력') + 'kg / W/kg: ' + (ctx.wkg ? ctx.wkg.toFixed(2) : '알 수 없음') + '\n' +
      '- 등급: ' + (grade ? grade.name + ' — ' + grade.hint : '알 수 없음(체중 미입력): 보수적으로 중급 이하 강도 적용') + '\n' +
      '  (등급 기준 W/kg: 입문 2.5 미만, 초급 2.5~3.2, 중급 3.2~3.7, 상급 3.7~4.2, 엘리트 4.2~5.0, 프로선수 5.0 이상)\n' +
      '[오늘 컨디션] ' + cond.id + ' — ' + cond.hint + '\n' +
      '[훈련 목표] ' + goal.label + ' — ' + goal.hint + '\n' +
      (daysToEvent != null ? '[대회/이벤트 일자] ' + ctx.date + ' (D-' + daysToEvent + '일) — 남은 기간에 맞는 훈련 단계(베이스/빌드/피크/테이퍼)를 적용\n' : '') +
      '[오늘 가능 시간] ' + tm.label + ' → 총 시간 ' + tm.minMin + '~' + tm.maxMin + '분 범위(절대 ' + tm.maxMin + '분 초과 금지)\n' +
      '[최근 30일 훈련 요약]\n' + JSON.stringify(ctx.summary) + '\n' +
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
        var res = await callClaude(key, { model: MODEL, max_tokens: 12000, output_config: { effort: 'medium' }, system: pr.sys, tools: [TOOL], tool_choice: { type: 'auto' }, messages: messages }, 120000);
        var tu = (res.content || []).filter(function (c) { return c.type === 'tool_use' && c.name === 'submit_workouts'; })[0];
        if (!tu || !tu.input) { lastErr = res.stop_reason === 'max_tokens' ? '응답이 길어 잘렸습니다.' : '응답 형식이 올바르지 않습니다.'; continue; }
        var checked = validate(tu.input, ctx);
        if (checked.ok) { result = checked.data; break; }
        lastErr = checked.error;
        messages = [{ role: 'user', content: pr.user + '\n\n[이전 응답 문제] ' + checked.error + '\n위 문제를 고쳐 다시 submit_workouts 로 제출하세요.' }];
      }
      if (!result) throw new Error('조건에 맞는 워크아웃을 만들지 못했습니다. ' + lastErr);
      renderResult(result, ctx);
    } catch (e) {
      console.warn('[ClaudeReco]', e);
      if (content) content.innerHTML = '<div style="padding:24px;text-align:center;"><div style="font-size:15px;color:#b91c1c;margin-bottom:14px;">' + esc(e && e.message || '추천 중 오류가 발생했습니다.') + '</div>' +
        '<button type="button" onclick="document.getElementById(\'workoutRecommendationModal\').style.display=\'none\'" style="padding:10px 18px;border:0;border-radius:10px;background:#e5e7eb;cursor:pointer;">닫기</button></div>';
    } finally { w.__claudeRecoBusy = false; }
  }

  function validate(input, ctx) {
    var list = Array.isArray(input.workouts) ? input.workouts : [];
    if (list.length < 1) return { ok: false, error: '워크아웃이 비어 있습니다.' };
    var out = [], maxSec = ctx.time.maxMin * 60, minSec = Math.max(20, ctx.time.minMin - 15) * 60;
    for (var i = 0; i < list.length && out.length < 3; i++) {
      var wk = list[i], conv = blocksToSegments(wk.blocks), t = totalSec(conv.segments);
      if (!conv.segments.length) continue;
      if (t > maxSec + 60) return { ok: false, error: '"' + (wk.name || i + 1) + '" 총 ' + Math.round(t / 60) + '분 — 가능 시간 ' + ctx.time.maxMin + '분 이내로 줄여야 합니다.' };
      if (t < minSec) return { ok: false, error: '"' + (wk.name || i + 1) + '" 총 ' + Math.round(t / 60) + '분 — 너무 짧습니다. ' + ctx.time.minMin + '~' + ctx.time.maxMin + '분으로 맞춰주세요.' };
      out.push({ rank: Number(wk.rank) || i + 1, name: String(wk.name || '맞춤 워크아웃').slice(0, 40), category: String(wk.category || input.category || '').slice(0, 30), why: String(wk.why || '').slice(0, 120), segments: conv.segments, flow: conv.flow, seconds: t, tss: calcTSS(conv.segments) });
    }
    if (!out.length) return { ok: false, error: '유효한 워크아웃이 없습니다.' };
    out.sort(function (a, b) { return a.rank - b.rank; });
    return { ok: true, data: { category: String(input.category || out[0].category || '').slice(0, 30), comment: String(input.goal_comment || '').slice(0, 120), workouts: out } };
  }

  /* ---------------- 8) 결과 화면 ---------------- */
  var COLORS = ['#3b82f6', '#10b981', '#f59e0b'];
  function renderResult(res, ctx) {
    var content = $('workoutRecommendationContent'); if (!content) return;
    w.__claudeRecs = res.workouts;
    var html = '<div style="padding:4px 2px;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;"><span style="background:#7c3aed;color:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">Claude</span>' +
      '<b style="font-size:17px;color:#111827;">추천 카테고리: ' + esc(res.category) + '</b></div>' +
      '<div style="font-size:14px;color:#374151;line-height:1.5;margin-bottom:6px;">' + esc(res.comment) + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-bottom:12px;">' + esc(ctx.goal.label) + ' · 컨디션 ' + esc(ctx.cond.id) + ' · ' + esc(ctx.time.label) + (ctx.grade ? ' · ' + esc(ctx.grade.name) + ' (' + ctx.wkg.toFixed(2) + ' W/kg)' : '') + '</div>';
    res.workouts.forEach(function (wk, idx) {
      var col = COLORS[idx] || '#6b7280', total = wk.seconds || 1;
      var bars = wk.segments.map(function (s) {
        var h = Math.max(8, Math.min(100, Math.round(((Number(s.ramp_to_value) || s.target_value) / 140) * 100)));
        var c = s.target_value >= 106 ? '#ef4444' : s.target_value >= 91 ? '#f97316' : s.target_value >= 76 ? '#eab308' : s.target_value >= 56 ? '#22c55e' : '#94a3b8';
        return '<div style="flex:' + s.duration_sec + ';height:' + h + '%;background:' + c + ';min-width:1px;"></div>';
      }).join('');
      html += '<div data-claude-pick="' + idx + '" style="border:2px solid ' + col + ';border-radius:12px;padding:14px;margin-bottom:12px;cursor:pointer;background:#fff;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;"><div style="width:30px;height:30px;border-radius:50%;background:' + col + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none;">' + (idx + 1) + '</div>' +
        '<div style="min-width:0;"><div style="font-size:16px;font-weight:700;color:#111827;word-break:keep-all;">' + esc(wk.name) + '</div><div style="font-size:12px;color:#6b7280;">' + esc(wk.category) + '</div></div></div>' +
        '<div style="font-size:12px;color:#374151;text-align:right;flex:none;">' + Math.round(total / 60) + '분<br>예상 TSS ' + wk.tss + '</div></div>' +
        (wk.why ? '<div style="font-size:13px;color:#6b7280;margin-bottom:8px;">' + esc(wk.why) + '</div>' : '') +
        '<div style="display:flex;align-items:flex-end;gap:1px;height:56px;background:#f9fafb;border-radius:8px;padding:6px;margin-bottom:8px;">' + bars + '</div>' +
        '<div style="font-size:12px;font-family:ui-monospace,Menlo,monospace;color:#374151;background:#f3f4f6;border-radius:8px;padding:8px;line-height:1.5;word-break:break-word;">' + esc(wk.flow) + '</div>' +
        '<div style="margin-top:8px;text-align:right;font-size:12px;color:' + col + ';font-weight:700;">선택하면 훈련 준비 화면으로 이동 ›</div></div>';
    });
    html += '</div>';
    content.innerHTML = html;
    Array.prototype.forEach.call(content.querySelectorAll('[data-claude-pick]'), function (el) {
      el.onclick = function () { pick(Number(el.getAttribute('data-claude-pick'))); };
    });
  }
  function pick(idx) {
    var wk = (w.__claudeRecs || [])[idx]; if (!wk) return;
    w.__aiRecommendationInProgress = false;
    if (typeof w.selectAIRecommendedWorkout !== 'function') { toast('워크아웃 준비 기능을 불러오지 못했습니다.', 'error'); return; }
    w.selectAIRecommendedWorkout(idx, wk.name, JSON.parse(JSON.stringify(wk.segments)));
    try { if (w.currentWorkout) { w.currentWorkout.description = 'Claude AI가 생성한 워크아웃 · ' + wk.flow; w.currentWorkout.author = 'Claude AI'; w.currentWorkout.id = 'claude-ai-' + Date.now() + '-' + idx; } } catch (e) {}
  }

  /* ---------------- 9) 설정: Claude 키 저장/삭제/검증 ---------------- */
  function updateStatusLine() {
    var el = $('settingsClaudeApiStatusLine'), inp = $('settingsClaudeApiKey'), k = getKey();
    if (el) el.textContent = k ? '✅ Claude API 키가 이 기기에 저장되어 있습니다.' : '키가 없으면 Claude 추천을 사용할 수 없습니다. (console.anthropic.com 에서 발급)';
    if (inp) { if (k) { inp.value = '••••••••••••••••'; inp.disabled = true; } else if (inp.disabled) { inp.value = ''; inp.disabled = false; } }
  }
  function testKey(key) {
    return callClaude(key, { model: TEST_MODEL, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }, 20000);
  }
  w.saveClaudeApiKeyFromSettings = async function () {
    var inp = $('settingsClaudeApiKey'); if (!inp) return;
    var v = inp.disabled ? '' : inp.value.trim();
    if (!v) { toast('Claude API 키를 입력해주세요.', 'error'); return; }
    if (!/^sk-ant-/.test(v)) { toast('Claude API 키는 sk-ant- 로 시작합니다.', 'error'); return; }
    var btn = $('settingsSaveClaudeKeyBtn'); if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
    try {
      await testKey(v);
      localStorage.setItem(KEY_NAME, v);
      updateStatusLine();
      toast('Claude API 키가 저장되었습니다.', 'success');
      try { w.dispatchEvent(new CustomEvent('stelvio-claude-apikey-changed', { detail: { hasKey: true } })); } catch (e) {}
      if (w.__claudeRecoAfterKey && Date.now() - w.__claudeRecoAfterKey < 10 * 60000) {
        w.__claudeRecoAfterKey = 0;
        if (typeof w.closeSettingsModal === 'function') w.closeSettingsModal();
        setTimeout(openOptionsModal, 300);
      }
    } catch (e) { toast((e && e.message) || '키 검증에 실패했습니다.', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '저장'; } }
  };
  w.testClaudeApiKeyFromSettings = async function () {
    var k = getKey() || ($('settingsClaudeApiKey') && !$('settingsClaudeApiKey').disabled ? $('settingsClaudeApiKey').value.trim() : '');
    if (!k) { toast('먼저 Claude API 키를 입력/저장해주세요.', 'error'); return; }
    try { await testKey(k); toast('Claude API 키가 정상입니다.', 'success'); } catch (e) { toast((e && e.message) || '키 검증 실패', 'error'); }
  };
  w.resetClaudeApiKeyFromSettings = function () {
    if (getKey() && !confirm('저장된 Claude API 키를 삭제할까요?')) return;
    try { localStorage.removeItem(KEY_NAME); } catch (e) {}
    var inp = $('settingsClaudeApiKey'); if (inp) { inp.disabled = false; inp.value = ''; }
    updateStatusLine();
    var inp2 = $('settingsClaudeApiKey'); if (inp2) { inp2.disabled = false; inp2.value = ''; inp2.focus(); }
  };
  // 설정 모달이 열릴 때 상태 갱신
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#settingsModal')) setTimeout(updateStatusLine, 0); }, true);
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
  w.__claudeReco = { blocksToSegments: blocksToSegments, calcTSS: calcTSS, validate: validate, gradeFor: gradeFor, buildPrompt: buildPrompt, GRADES: GRADES };
})(window);
