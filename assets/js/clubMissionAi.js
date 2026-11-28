/*
 * 클럽 챌린지 미션 AI 추천 생성 (2026-11-28)
 *  - 환경설정에 저장한 Claude API 키(claudeWorkoutRecommend.js 의 키 저장소)로 브라우저에서 직접 호출
 *  - 테마·기간·개수·챌린지 타겟·적용 대상(그룹 W/kg 범위 / 개인 FTP + 최근 30일 기록)을 반영해 미션 N개(워크아웃 N개)를 설계
 *  - 확정하면 각 워크아웃을 클럽 전용 워크아웃으로 저장하고 미션 단계(steps)로 돌려준다 → 이후 달성·진행은 기존 미션과 동일
 *  - 점수 판정은 인터벌 구간만 반영(웜업·쿨다운·휴식 제외)되므로 모든 워크아웃은 warmup … cooldown 구조로 만든다
 */
(function (w) {
  'use strict';
  var MAX_STEPS = 30; // 한 번의 응답으로 안정적으로 받을 수 있는 상한

  function R() { return w.__claudeReco || null; }
  function hasKey() { var r = R(); return !!(r && r.getKey && r.getKey()); }
  function ready() { var r = R(); return r && r.keyReady ? r.keyReady : Promise.resolve(); }

  function myProfile() {
    var u = w.currentUser || {};
    var ftp = Math.round(Number(u.ftp) || 0), weight = Number(u.weight) || 0;
    var wkg = ftp > 0 && weight > 0 ? ftp / weight : 0;
    var r = R(), grade = r && wkg ? r.gradeFor(wkg) : null;
    return { ftp: ftp, weight: weight, wkg: wkg, gradeName: grade ? grade.name : '' };
  }

  var TOOL = {
    name: 'submit_mission',
    description: '클럽 챌린지 미션(순서대로 수행하는 워크아웃 N개) 제출',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '이 미션의 전체 설계 의도 2~3문장(한국어)' },
        workouts: {
          type: 'array', minItems: 1,
          description: '수행 순서대로 정확히 N개',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '워크아웃 이름(한국어 가능, 25자 이내, 번호 접두어 없이)' },
              category: { type: 'string', description: 'Endurance / Tempo / Sweet Spot / Threshold / VO2 Max / Recovery / Over-Under 등' },
              why: { type: 'string', description: '이 회차의 목적 한 줄' },
              blocks: null // 아래에서 기존 추천과 동일한 블록 스키마를 복사
            },
            required: ['name', 'category', 'blocks']
          }
        }
      },
      required: ['summary', 'workouts']
    }
  };
  function schema() {
    var base = R() && R().TOOL ? R().TOOL.input_schema.properties.workouts.items.properties.blocks : { type: 'array', items: { type: 'object' } };
    var t = JSON.parse(JSON.stringify(TOOL));
    t.input_schema.properties.workouts.items.properties.blocks = base;
    return t;
  }

  function prompt(o, prof, grade, ifCap, summary) {
    var sys = '당신은 세계 최고 수준의 사이클 파워 트레이닝 코치입니다. 사이클 클럽의 "챌린지 미션"을 설계합니다. ' +
      '미션은 정해진 기간 동안 순서대로 하나씩 수행하는 실내 구조화 워크아웃 N개입니다. 반드시 submit_mission 도구를 정확히 한 번 호출해서만 답하세요(텍스트 답변 금지).\n\n' +
      '[파워존(%FTP)] Z1 <55 / Z2 56~75 / 템포 76~90 / SS 88~94 / 역치 91~105 / VO2max 106~120 / 무산소 121~150.\n\n' +
      '[설계 원칙]\n' +
      '1) 주기화: 미션 전체를 기간·개수에 맞춰 베이스→빌드→(피크)→테이퍼/회복 흐름으로 점진 과부하(회차마다 소폭 증가, 3~4회차마다 회복 회차). 이벤트 날짜가 있으면 마지막 회차가 이벤트 직전 테이퍼가 되도록 역산.\n' +
      '2) 회차 간 간격은 (기간 일수 ÷ 개수)일 정도로 가정 — 간격이 짧으면(≤2일) 고강도 연속 배치 금지, 길면 질적 훈련 비중 확대.\n' +
      '3) 회차마다 하나의 주 자극. 모든 워크아웃은 warmup 으로 시작해 cooldown 으로 끝남(웜업은 ramp 55→75% 등, 쿨다운 60→40%).\n' +
      '4) interval 블록은 reps x (on_minutes@on_percent + off_minutes@off_percent). 모든 강도는 %FTP 정수, 단일 구간 200 초과 금지.\n' +
      '5) 달성 판정 규칙: 점수는 "인터벌 구간(휴식·웜업·쿨다운 제외)의 실제 평균 파워 ÷ 목표 파워"로만 계산되고 90점 이상이어야 통과합니다. 따라서 인터벌 목표는 대상자가 실제로 90% 이상 유지할 수 있는 현실적인 값이어야 하며, 휴식은 반드시 55% 이하로 두세요.\n' +
      '6) 각 워크아웃 총 시간(웜업·쿨다운 포함)은 ' + o.maxMin + '분을 넘기지 말 것. 난이도 선택을 반영: 쉬움=IF 한도의 ~80%, 보통=한도의 ~90%, 도전=한도까지.\n' +
      '7) 강도계수(IF)는 ' + ifCap.toFixed(2) + ' 이하(등급 한도). 워크아웃 이름·구성이 서로 겹치지 않게 다양화.\n' +
      '8) summary 에는 전체 구성(단계별 흐름·타겟과의 연결)을, 각 워크아웃의 why 에는 회차 목적을 한국어로 한 줄.';
    var days = Math.max(1, Math.round((new Date(o.endDate + 'T00:00:00') - new Date(o.startDate + 'T00:00:00')) / 86400000) + 1);
    var u = '[미션]\n- 테마: ' + (o.theme || '(없음)') + '\n- 기간: ' + o.startDate + ' ~ ' + o.endDate + ' (' + days + '일)\n- 개수: 정확히 ' + o.count + '개 (평균 ' + (days / o.count).toFixed(1) + '일에 1회)\n' +
      '- 챌린지 타겟: ' + o.targetText + '\n' +
      '- 난이도: ' + o.difficulty + ' / 1회 최대 시간: ' + o.maxMin + '분\n' +
      (o.focus && o.focus.length ? '- 중점 훈련: ' + o.focus.join(', ') + '\n' : '') +
      (o.note ? '- 추가 요청: ' + o.note + '\n' : '');
    if (o.scope === 'group') {
      u += '[적용 대상] 클럽 그룹 전체 — W/kg ' + o.wkgMin.toFixed(1) + ' ~ ' + o.wkgMax.toFixed(1) + ' 범위의 회원이 모두 90점 이상으로 완주 가능해야 함. 가장 낮은 W/kg(' + o.wkgMin.toFixed(1) + ') 기준 등급 "' + (grade ? grade.name : '') + '" — ' + (grade ? grade.hint : '') + ' (IF 한도 ' + ifCap.toFixed(2) + ')\n';
    } else {
      u += '[적용 대상] 개인 — FTP ' + prof.ftp + 'W / 체중 ' + (prof.weight || '미입력') + 'kg / W/kg ' + (prof.wkg ? prof.wkg.toFixed(2) : '알 수 없음') + ' / 등급 ' + (grade ? grade.name + ' — ' + grade.hint : '알 수 없음(보수적으로)') + ' (IF 한도 ' + ifCap.toFixed(2) + ')\n' +
        '[최근 30일 훈련 요약(ctl/atl/tsb 는 추정치)]\n' + JSON.stringify(summary) + '\n' + (summary && summary.sessions === 0 ? '(최근 기록 없음: 보수적으로 시작)\n' : '');
    }
    return { sys: sys, user: u };
  }

  function validate(input, o, ifCap, relaxed) {
    var r = R(), list = Array.isArray(input.workouts) ? input.workouts : [];
    if (list.length < o.count) return { ok: false, error: '워크아웃이 ' + list.length + '개뿐입니다. 정확히 ' + o.count + '개를 제출하세요.' };
    var out = [], maxSec = o.maxMin * 60;
    for (var i = 0; i < o.count; i++) {
      var wk = list[i], conv = r.blocksToSegments(wk.blocks), t = r.totalSec(conv.segments);
      var nm = '"' + (wk.name || (i + 1) + '회차') + '"';
      if (!conv.segments.length) return { ok: false, error: nm + ' 구성(blocks)이 비어 있습니다.' };
      if (t > maxSec + 60) return { ok: false, error: nm + ' 총 ' + Math.round(t / 60) + '분 — ' + o.maxMin + '분 이내로 줄이세요.' };
      var kinds = (wk.blocks || []).map(function (b) { return b.kind; });
      if (kinds[0] !== 'warmup' || kinds[kinds.length - 1] !== 'cooldown') return { ok: false, error: nm + ' 은(는) warmup 으로 시작해 cooldown 으로 끝나야 합니다.' };
      var IFv = r.calcIF(conv.segments);
      if (!relaxed && IFv > ifCap + 0.005) return { ok: false, error: nm + ' 강도계수(IF) ' + IFv.toFixed(2) + ' — 한도 ' + ifCap.toFixed(2) + ' 이하로 낮추세요.' };
      out.push({ name: String(wk.name || '미션').slice(0, 40), category: String(wk.category || '').slice(0, 30), why: String(wk.why || '').slice(0, 160), segments: conv.segments, flow: conv.flow, seconds: t, tss: r.calcTSS(conv.segments) });
    }
    return { ok: true, data: { summary: String(input.summary || '').slice(0, 400), workouts: out } };
  }

  /**
   * @param {object} o { theme, startDate, endDate, count, targetText, difficulty, maxMin, focus[], note,
   *   scope:'group'|'personal', wkgMin, wkgMax }
   * @returns {Promise<{summary:string, workouts:object[]}>}
   */
  async function generate(o, onStatus) {
    var r = R();
    if (!r) throw new Error('Claude 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    await ready();
    var key = r.getKey();
    if (!key) throw new Error('환경설정에서 Claude API 키를 먼저 저장해 주세요.');
    o = Object.assign({}, o, { count: Math.max(1, Math.min(MAX_STEPS, Math.floor(Number(o.count) || 1))) });
    var prof = myProfile(), grade, summary = null;
    if (o.scope === 'group') {
      grade = r.gradeFor(Math.min(o.wkgMin, o.wkgMax));
    } else {
      if (!(prof.ftp > 0)) throw new Error('내 FTP 가 설정되어 있지 않습니다. 프로필에서 FTP 를 먼저 입력해 주세요.');
      grade = r.gradeFor(prof.wkg);
      if (onStatus) onStatus('최근 30일 라이딩 기록을 분석 중입니다…');
      summary = r.summarizeLogs(await r.fetchLogs30(w.currentUser));
    }
    var ifCap = grade ? grade.ifMax : 0.88;
    var pr = prompt(o, prof, grade, ifCap, summary);
    var messages = [{ role: 'user', content: pr.user }], result = null, lastErr = '';
    for (var attempt = 0; attempt < 2 && !result; attempt++) {
      if (onStatus) onStatus('Claude가 미션 ' + o.count + '개를 설계하는 중입니다…' + (attempt ? ' (보정 중)' : ''));
      var res = await r.callClaude(key, { model: r.MODEL, max_tokens: 16000, output_config: { effort: 'medium' }, system: pr.sys, tools: [schema()], tool_choice: { type: 'auto' }, messages: messages }, 240000);
      var tu = (res.content || []).filter(function (c) { return c.type === 'tool_use' && c.name === 'submit_mission'; })[0];
      if (!tu || !tu.input) { lastErr = res.stop_reason === 'max_tokens' ? '응답이 길어 잘렸습니다. 개수를 줄여 보세요.' : '응답 형식이 올바르지 않습니다.'; continue; }
      var checked = validate(tu.input, o, ifCap, attempt > 0);
      if (checked.ok) { result = checked.data; break; }
      lastErr = checked.error;
      messages = [{ role: 'user', content: pr.user + '\n\n[이전 응답 문제] ' + checked.error + '\n위 문제를 고쳐 다시 submit_mission 으로 제출하세요.' }];
    }
    if (!result) throw new Error('조건에 맞는 미션을 만들지 못했습니다. ' + lastErr);
    return result;
  }

  /** 확정: 각 워크아웃을 클럽 전용 워크아웃으로 저장 → 미션 steps 배열 반환 (실패 시 이미 저장한 것은 삭제 시도) */
  async function saveAsClubWorkouts(groupId, draft, theme, onProgress) {
    var svc = w.openRidingGroupService || {}, uid = w.currentUser && w.currentUser.id;
    if (typeof svc.createClubWorkout !== 'function') throw new Error('워크아웃 저장 기능을 불러오지 못했습니다.');
    var steps = [], made = [];
    try {
      for (var i = 0; i < draft.workouts.length; i++) {
        var wk = draft.workouts[i];
        if (onProgress) onProgress(i + 1, draft.workouts.length);
        var title = ('m' + (i + 1) + '. ' + wk.name).slice(0, 100);
        var res = await svc.createClubWorkout(uid, groupId, {
          title: title, author: wk.category || 'Claude AI',
          description: ('Claude AI 미션' + (theme ? ' · ' + theme : '') + (wk.why ? ' · ' + wk.why : '')).slice(0, 500),
          segments: wk.segments
        });
        if (!res || !res.id) throw new Error('워크아웃 저장 응답이 올바르지 않습니다.');
        made.push(String(res.id));
        steps.push({ workoutId: String(res.id), workoutSource: 'club', title: title, totalSeconds: wk.seconds });
      }
    } catch (e) {
      for (var j = 0; j < made.length; j++) { try { await svc.deleteClubWorkout(uid, groupId, made[j]); } catch (x) {} }
      throw e;
    }
    return steps;
  }

  w.stelvioClubMissionAi = { hasKey: hasKey, ready: ready, myProfile: myProfile, generate: generate, saveAsClubWorkouts: saveAsClubWorkouts, MAX_STEPS: MAX_STEPS };
})(window);
