/* 워크아웃 데이터 → 카테고리 분류 + 한 줄 요약 표현
 * 입력(스텝: 워밍업/인터벌/휴식/반복/쿨다운 + [RPM] + FTP % + mm:ss):
 *   워밍업 80RPM FTP 70% 05:00 인터벌 FTP 120% 00:20 휴식 FTP 55% 00:40 반복 2회 01:00 ... 쿨다운 FTP 50% 05:00
 * "반복 N회 mm:ss" = 바로 앞 스텝들(거꾸로 더해 mm:ss 가 되는 만큼)을 N번 반복. 중첩 가능.
 * 출력: WU | 메인 | CD 요약 표현(workoutSummaryParser 가 그대로 읽을 수 있는 형식) + 카테고리 + 설명.
 *
 * 공개 API (window.WorkoutDataSummarizer / module.exports): summarize(text) → { ok, error, category, summary, totalSec, notes[], text }
 * 화면: window.stelvioSummarizeWorkoutData() — #wbRawInput 읽어 #wbRawResult 에 출력, #wbSummaryInput 에 요약 표현 채움.
 */
(function (root) {
  'use strict';

  var KIND = { '워밍업': 'wu', '인터벌': 'int', '휴식': 'rest', '쿨다운': 'cd', '반복': 'rep' };
  var CATS = [ // [이름, 상한(미포함), 표시 범위]
    ['Endurance', 76, '56~75'], ['Tempo', 88, '76~87'], ['Sweet Spot', 95, '88~94'], ['Threshold', 106, '95~105'], ['VO2 Max', Infinity, '106 이상']
  ];
  var OPENER_MAX_STEP_SEC = 60, OPENER_MAX_REP = 3, OPENER_MAX_WORK_SEC = 180;

  function toSec(m) { return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]); }
  function fmtTime(sec) {
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    return s ? m + 'm' + s + 's' : m + 'm';
  }
  function fmtKo(sec) { return fmtTime(sec).replace('m', '분').replace('s', '초'); }
  function catOf(p) { for (var i = 0; i < CATS.length; i++) if (p < CATS[i][1]) return CATS[i]; return CATS[CATS.length - 1]; }

  /** 텍스트 → 스텝 배열. 오류 시 {err} */
  function tokenize(text) {
    var src = String(text == null ? '' : text).replace(/[　]/g, ' ');
    var chunks = src.split(/(?=워밍업|인터벌|휴식|반복|쿨다운)/);
    var steps = [];
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i].trim();
      var km = /^(워밍업|인터벌|휴식|반복|쿨다운)/.exec(c);
      if (!km) continue; // 머리글 등 무시
      var kind = KIND[km[1]], rest = c.slice(km[1].length);
      var tm = /(\d{1,3}):(\d{2})(?::(\d{2}))?\s*$/.exec(rest);
      if (!tm) return { err: "'" + c + "' 에서 시간(mm:ss)을 찾을 수 없음" };
      var sec = toSec(tm);
      if (!(sec > 0)) return { err: "'" + c + "' 시간이 0초" };
      if (kind === 'rep') {
        var rm = /(\d+)\s*회/.exec(rest);
        if (!rm || +rm[1] < 1 || +rm[1] > 100) return { err: "'" + c + "' 반복 횟수(N회)를 찾을 수 없음" };
        steps.push({ kind: 'rep', n: +rm[1], sec: sec });
        continue;
      }
      var pm = /(\d+(?:\.\d+)?)(?:\s*[-~–]\s*(\d+(?:\.\d+)?))?\s*%/.exec(rest);
      if (!pm) return { err: "'" + c + "' 에서 FTP 강도(%)를 찾을 수 없음" };
      var lo = +pm[1], hi = pm[2] != null ? +pm[2] : lo;
      steps.push({ kind: kind, sec: sec, lo: lo, hi: hi, avg: (lo + hi) / 2 });
    }
    if (!steps.length) return { err: '워크아웃 스텝(워밍업·인터벌·휴식·반복·쿨다운)을 찾을 수 없음' };
    return { steps: steps };
  }

  /** 노드 1회 길이(초) */
  function len(n) { return n.group ? n.n * n.items.reduce(function (a, x) { return a + len(x); }, 0) : n.sec; }

  /** 반복 스텝 → 앞 노드들을 묶는다. 합이 정확히 맞는 가장 짧은 접미 구간, 없으면 가장 가까운 구간(notes 기록) */
  function build(steps, notes) {
    var nodes = [];
    steps.forEach(function (s) {
      if (s.kind !== 'rep') { nodes.push(s); return; }
      var sum = 0, best = null, bestDiff = Infinity;
      for (var k = nodes.length - 1; k >= 0; k--) {
        sum += len(nodes[k]);
        var diff = Math.abs(sum - s.sec);
        if (diff < bestDiff) { bestDiff = diff; best = k; }
        if (sum >= s.sec) break; // 합이 이미 넘으면 더 앞으로 가도 멀어짐
      }
      if (best === null) { notes.push('반복 ' + s.n + '회 ' + fmtTime(s.sec) + ': 묶을 앞 스텝이 없어 무시했어요.'); return; }
      if (bestDiff > 0) notes.push('반복 ' + s.n + '회 ' + fmtTime(s.sec) + ': 합이 정확히 맞는 조합이 없어 가장 가까운 앞 ' + (nodes.length - best) + '개 스텝(' + fmtTime(len({ group: true, n: 1, items: nodes.slice(best) })) + ')을 묶었어요.');
      nodes.push({ group: true, n: s.n, items: nodes.splice(best) });
    });
    return nodes;
  }

  function pctText(s) { return (s.lo === s.hi ? s.lo : s.lo + '-' + s.hi) + '%'; }
  function text(n) {
    if (!n.group) return fmtTime(n.sec) + '@' + pctText(n);
    var inner = n.items.map(text).join(' + ');
    var nested = n.items.some(function (x) { return x.group; });
    return n.n + ' X ' + (nested ? '[' + inner + ']' : '(' + inner + ')');
  }

  /** 노드를 펼친 스텝 배열 (반복 횟수 반영) */
  function flat(n, out) {
    out = out || [];
    if (!n.group) { out.push(n); return out; }
    for (var i = 0; i < n.n; i++) n.items.forEach(function (x) { flat(x, out); });
    return out;
  }
  function workSec(n) { return flat(n).reduce(function (a, s) { return s.kind === 'int' ? a + s.sec : a; }, 0); }

  function summarize(raw) {
    var tk = tokenize(raw);
    if (tk.err) return { ok: false, error: tk.err };
    var notes = [];
    var nodes = build(tk.steps, notes);

    // 구역 나누기: 앞쪽 워밍업 = WU, 뒤쪽 쿨다운 = CD, 나머지 = 메인
    var a = 0, b = nodes.length;
    while (a < b && !nodes[a].group && nodes[a].kind === 'wu') a++;
    while (b > a && !nodes[b - 1].group && nodes[b - 1].kind === 'cd') b--;
    var wu = nodes.slice(0, a), main = nodes.slice(a, b), cd = nodes.slice(b);
    var join = function (arr) { return arr.length ? arr.map(text).join(' + ') : '-'; };
    var summary = 'WU ' + join(wu) + ' | ' + join(main) + ' | CD ' + join(cd);
    var totalSec = nodes.reduce(function (x, n) { return x + len(n); }, 0);

    // 오프너: 메인 앞쪽의 짧은 고강도(스텝 ≤60초, 반복 ≤3회, 총 일량 ≤3분)이고 뒤에 더 큰 인터벌이 있을 때
    var opener = [];
    while (opener.length < main.length - 1) {
      var n = main[opener.length];
      var steps = flat(n), work = steps.filter(function (s) { return s.kind === 'int'; });
      var ok = work.length > 0 && workSec(n) <= OPENER_MAX_WORK_SEC && (!n.group || n.n <= OPENER_MAX_REP) &&
        work.every(function (s) { return s.sec <= OPENER_MAX_STEP_SEC; }) &&
        main.slice(opener.length + 1).some(function (x) { return workSec(x) > workSec(n); });
      if (!ok) break;
      opener.push(n);
    }
    var core = main.slice(opener.length);

    // 분류: 오프너 제외한 인터벌을 카테고리별 시간으로 합산해 가장 긴 것 (인터벌이 없으면 휴식 제외 전체)
    var pool = flat({ group: true, n: 1, items: core }).filter(function (s) { return s.kind === 'int'; });
    if (!pool.length) pool = flat({ group: true, n: 1, items: core }).filter(function (s) { return s.kind !== 'rest'; });
    var byCat = {};
    pool.forEach(function (s) { var c = catOf(s.avg)[0]; byCat[c] = (byCat[c] || 0) + s.sec; });
    var cat = CATS[0];
    var bestT = -1;
    CATS.forEach(function (c) { if ((byCat[c[0]] || 0) > bestT) { bestT = byCat[c[0]] || 0; cat = c; } });

    // 설명: 분류 구간에서 일량이 가장 큰 최상위 블록
    var blockOf = function (n) { return flat(n).filter(function (s) { return s.kind === 'int' && catOf(s.avg)[0] === cat[0]; }).reduce(function (x, s) { return x + s.sec; }, 0); };
    var top = core.slice().sort(function (x, y) { return blockOf(y) - blockOf(x); })[0];
    var lines = ['총 시간은 약 ' + Math.round(totalSec / 60) + '분입니다.'];
    var desc;
    var topInts = top ? flat(top).filter(function (s) { return s.kind === 'int'; }) : [];
    var simple = top && topInts.length && topInts.every(function (s) { return s.sec === topInts[0].sec && s.avg === topInts[0].avg; });
    if (simple && top.group && !top.items.some(function (x) { return x.group; }) && top.items.filter(function (x) { return x.kind === 'int'; }).length === 1) {
      desc = '메인 세트는 FTP ' + pctText(topInts[0]) + '로 ' + fmtKo(topInts[0].sec) + '씩 ' + top.n + '번 타는 구성입니다.';
    } else if (simple && !top.group) {
      desc = '메인 세트는 FTP ' + pctText(top) + '로 ' + fmtKo(top.sec) + ' 한 번 타는 구성입니다.';
    } else if (top) {
      desc = '메인 세트의 주 훈련 블록은 ' + text(top) + ' 구성입니다.';
    } else {
      desc = '메인 세트가 없습니다.';
    }
    var ref = topInts[0] || pool[0];
    var why = ref ? ' ' + pctText(ref) + (topInts.length > 1 && !simple ? ' 안팎의 강도가 ' : '는 ') + cat[0] + ' 구간(FTP 약 ' + cat[2] + '%)이라 이렇게 분류했어요.' : '';
    lines.push(desc + why + (opener.length ? ' 앞의 ' + opener.map(text).join(' + ') + '는 오프너입니다.' : ''));
    notes.forEach(function (x) { lines.push(x); });

    var out = '카테고리: ' + cat[0] + '\n요약 표현:\n' + summary + '\n\n' + lines.map(function (l) { return '* ' + l; }).join('\n');
    return { ok: true, category: cat[0], summary: summary, totalSec: totalSec, notes: notes, text: out };
  }

  /** 화면 연결: 입력 → 결과 출력, 요약 표현은 아래 "워크아웃 요약 표현" 입력창에도 채운다 */
  function run() {
    var $ = function (id) { return document.getElementById(id); };
    var inp = $('wbRawInput'), box = $('wbRawResult'), err = $('wbRawError');
    if (!inp || !box) return;
    var res = summarize(inp.value);
    if (err) { err.textContent = res.ok ? '' : res.error; err.style.display = res.ok ? 'none' : 'block'; }
    if (!res.ok) { box.style.display = 'none'; return; }
    box.textContent = res.text;
    box.style.display = 'block';
    var target = $('wbSummaryInput');
    if (target) target.value = res.summary;
  }

  var api = { summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WorkoutDataSummarizer = api;
  root.stelvioSummarizeWorkoutData = run;
})(typeof window !== 'undefined' ? window : globalThis);
