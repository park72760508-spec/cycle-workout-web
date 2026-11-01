/**
 * 그룹훈련 Coach PC 화면 — 실시간 레이스 순위 전광판 (2026-11-02)
 *
 * 점수 규칙
 *  - 워밍업·휴식(회복)·쿨다운 세그먼트와 목표 파워가 없는 세그먼트(케이던스 전용)는 점수 제외
 *  - 세그먼트 점수 = 10점 × 달성률(랩파워 ÷ 목표 파워, 최대 120%) × W/kg 가중치
 *      예) 105% → 10.5점, 98% → 9.8점
 *  - W/kg 가중치(FTP ÷ 체중): 2.0 미만 1.00 · 2.0~ 1.01 · 2.5~ 1.02 · 3.0~ 1.03 · 3.5~ 1.04 · 4.0 이상 1.05
 *  - 진행 중인 세그먼트는 현재 달성률 × 진행 비율만큼 실시간 반영 → 끝나면 확정
 *  - 랩파워는 참가자 화면에 표시되는 LAP(세그먼트 평균 파워)과 같은 값, 세그먼트 시작 5초 이후 값만 사용(이전 세그먼트 값 섞임 방지)
 * 화면
 *  - 오른쪽 가장자리 손잡이로 펼치기/접기(상태 기억)
 *  - 순위·등락·아바타·이름·현재 세그먼트 달성률·누적 점수, 순위가 바뀌면 행이 미끄러지며 이동
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__coachRaceBoardLoaded) return;
  window.__coachRaceBoardLoaded = true;

  var SCREEN_ID = 'bluetoothTrainingCoachScreen';
  var ROW_H = 54;
  var ACH_CAP = 1.2;
  var LAP_GUARD_SEC = 5;
  var MOVE_SHOW_MS = 5000;
  var OPEN_KEY = 'stelvioCoachRaceBoardOpen';

  var S = null; // 집계 상태(세션·워크아웃 단위)
  var avatarCache = {};
  var rowEls = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function isExcludedSegment(seg) {
    if (!seg) return true;
    var t = String((seg.segment_type || '') + ' ' + (seg.label || '') + ' ' + (seg.type || '')).toLowerCase();
    return /warm|cool|rest|recover|워밍|웜업|휴식|회복|쿨다운|쿨링/.test(t);
  }
  function segTarget(seg, ftp, reported) {
    var t = 0;
    if (ftp > 0 && typeof window.bluetoothCoachSegmentTargetPower === 'function') {
      t = num(window.bluetoothCoachSegmentTargetPower(seg, ftp));
    }
    if (!(t > 0)) t = num(reported);
    return t > 0 ? t : 0;
  }
  function wkgWeight(ftp, weight) {
    if (!(ftp > 0) || !(weight > 0)) return 1;
    var w = ftp / weight;
    if (w >= 4.0) return 1.05;
    if (w >= 3.5) return 1.04;
    if (w >= 3.0) return 1.03;
    if (w >= 2.5) return 1.02;
    if (w >= 2.0) return 1.01;
    return 1;
  }
  /** 세그먼트 점수와 달성률 (제외 구간이면 null) */
  function segScore(seg, lapW, u) {
    if (isExcludedSegment(seg)) return null;
    var target = segTarget(seg, u.ftp, u.reportedTarget);
    if (!(target > 0)) return null;
    var ach = Math.max(0, Math.min(ACH_CAP, lapW / target));
    return { ach: ach, pts: 10 * ach * wkgWeight(u.ftp, u.weight) };
  }
  function segDur(seg) { return num(seg && (seg.duration_sec || seg.duration)); }

  function sessionId() {
    try {
      if (typeof window.getBluetoothCoachSessionId === 'function') return String(window.getBluetoothCoachSessionId() || '');
    } catch (e) {}
    return String(window.SESSION_ID || window.currentTrainingRoomId || '');
  }
  function storeKey(k) { return 'stelvioCoachRace:' + k; }
  function freshState(key) {
    return { key: key, seg: null, lastElapsed: 0, final: {}, lap: {}, users: {}, prevRank: {}, moves: {}, done: false };
  }
  function loadState(key) {
    try {
      var raw = sessionStorage.getItem(storeKey(key));
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.key === key) { o.moves = {}; return o; }
      }
    } catch (e) {}
    return freshState(key);
  }
  function saveState() {
    if (!S) return;
    try {
      var copy = Object.assign({}, S, { moves: {} });
      sessionStorage.setItem(storeKey(S.key), JSON.stringify(copy));
    } catch (e) {}
  }

  function finalizeSegment(k, segments) {
    var seg = segments[k];
    if (!seg) return;
    Object.keys(S.lap).forEach(function (uid) {
      var lp = S.lap[uid];
      var u = S.users[uid];
      if (!lp || lp.seg !== k || !u) return;
      var sc = segScore(seg, lp.w, u);
      if (!sc) return;
      if (!S.final[uid]) S.final[uid] = {};
      S.final[uid][k] = Math.round(sc.pts * 100) / 100;
    });
  }

  function fetchAvatar(uid) {
    if (!uid || avatarCache[uid] !== undefined) return;
    avatarCache[uid] = null;
    if (typeof window.getUserByUid !== 'function') return;
    window.getUserByUid(uid).then(function (p) {
      var url = p && (p.profileImageUrl || p.profile_image_url);
      avatarCache[uid] = url ? String(url) : '';
      var el = rowEls[uid];
      if (el) applyAvatar(el, uid, S && S.users[uid] ? S.users[uid].name : '');
    }).catch(function () { avatarCache[uid] = ''; });
  }
  function applyAvatar(row, uid, name) {
    var box = row.querySelector('.crb-row__avatar');
    if (!box) return;
    var url = avatarCache[uid];
    var want = url ? 'img:' + url : 'txt:' + (name || '?').charAt(0);
    if (box.dataset.k === want) return;
    box.dataset.k = want;
    box.innerHTML = url
      ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
      : '<span>' + esc((name || '?').charAt(0)) + '</span>';
  }

  // ---------- 집계 ----------
  function compute() {
    var cs = window.bluetoothCoachState;
    if (!cs) return null;
    var w = cs.currentWorkout;
    var segments = (w && Array.isArray(w.segments)) ? w.segments : [];
    // 휴대폰 Coach: 워크아웃을 고르지 않은 기기는 방의 Firebase 계획·상태 사용
    var ext = null;
    try { ext = typeof window.__coachmRaceSource === 'function' ? window.__coachmRaceSource() : null; } catch (e) { ext = null; }
    var useExt = !segments.length && ext && Array.isArray(ext.plan) && ext.plan.length;
    if (useExt) segments = ext.plan;
    var es = (ext && ext.status) || null;
    var key = sessionId() + '|' + (w && !useExt ? (w.id || w.workoutId || w.title || w.name || '') : 'plan' + segments.length);
    if (!S || S.key !== key) S = loadState(key);

    var st = (useExt && es && es.state) || cs.trainingState;
    var active = st === 'running' || st === 'paused';
    var elapsed = useExt && es && es.elapsedTime != null ? num(es.elapsedTime) : num(cs.totalElapsedTime);
    var idx = (useExt && es && typeof es.segmentIndex === 'number' ? es.segmentIndex : num(cs.currentSegmentIndex)) | 0;
    var segEl = useExt && es && es.segmentElapsedSec != null ? num(es.segmentElapsedSec) : num(cs.segmentElapsedTime);
    var now = Date.now();

    if (active) {
      // 같은 워크아웃을 처음부터 다시 시작 → 새 레이스
      if (S.lastElapsed > 30 && elapsed + 20 < S.lastElapsed) S = freshState(key);
      S.lastElapsed = Math.max(S.lastElapsed, elapsed);
      S.done = false;
      if (S.seg == null) S.seg = idx;
      if (idx !== S.seg) {
        finalizeSegment(S.seg, segments);
        S.seg = idx;
      }
    } else if (st === 'finished' && !S.done && S.seg != null) {
      finalizeSegment(S.seg, segments);
      S.done = true;
    }

    var pms = Array.isArray(cs.powerMeters) ? cs.powerMeters : [];
    var present = [];
    pms.forEach(function (pm) {
      if (!pm || !pm.userName) return;
      var uid = String(pm.userId || ('track-' + pm.id));
      var u = S.users[uid] || (S.users[uid] = {});
      u.name = String(pm.userName);
      u.track = pm.id;
      if (num(pm.userFTP) > 0) u.ftp = num(pm.userFTP);
      if (num(pm.userWeight) > 0) u.weight = num(pm.userWeight);
      if (num(pm.reportedTargetPower) > 0) u.reportedTarget = num(pm.reportedTargetPower);
      var fresh = now - num(pm.lastUpdateTime) <= 10000;
      if (active && segEl >= LAP_GUARD_SEC && fresh && num(pm.segmentPower) > 0) {
        S.lap[uid] = { seg: idx, w: num(pm.segmentPower) };
      }
      if (pm.userId) fetchAvatar(String(pm.userId));
      present.push(uid);
    });

    var seg = segments[idx];
    var curExcluded = !seg || isExcludedSegment(seg);
    var progress = seg && segDur(seg) > 0 ? Math.max(0, Math.min(1, segEl / segDur(seg))) : 0;
    var rows = present.map(function (uid) {
      var u = S.users[uid];
      var f = S.final[uid] || {};
      var total = 0;
      Object.keys(f).forEach(function (k) {
        if (active && Number(k) === idx) return; // 진행 중 구간은 아래 실시간 값으로
        total += num(f[k]);
      });
      var liveAch = null;
      var lp = S.lap[uid];
      if ((active || st === 'finished') && seg && lp && lp.seg === idx) {
        var sc = segScore(seg, lp.w, u);
        if (sc) {
          liveAch = sc.ach;
          if (active) total += sc.pts * progress;
        }
      }
      return { uid: uid, track: u.track, name: u.name, total: total, liveAch: liveAch, wkg: u.ftp > 0 && u.weight > 0 ? u.ftp / u.weight : null };
    });
    rows.sort(function (a, b) {
      return (b.total - a.total) || ((b.liveAch || 0) - (a.liveAch || 0)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    rows.forEach(function (r, i) {
      r.rank = i + 1;
      var prev = S.prevRank[r.uid];
      if (prev && prev !== r.rank && active) S.moves[r.uid] = { d: prev - r.rank, at: now };
      S.prevRank[r.uid] = r.rank;
      var mv = S.moves[r.uid];
      r.move = mv && now - mv.at < MOVE_SHOW_MS ? mv.d : 0;
    });

    var scoredTotal = 0;
    var scoredDone = 0;
    segments.forEach(function (sg, i) {
      if (isExcludedSegment(sg)) return;
      scoredTotal++;
      if (i < idx || (st === 'finished')) scoredDone++;
    });
    saveState();
    return {
      rows: rows, state: st, idx: idx, segCount: segments.length, curExcluded: curExcluded,
      segLabel: seg ? String(seg.label || seg.segment_type || '세그먼트') : '', scoredTotal: scoredTotal, scoredDone: scoredDone,
      hasWorkout: segments.length > 0
    };
  }

  // ---------- 화면 ----------
  function isOpen() {
    try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch (e) { return true; }
  }
  function setOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
    var root = $('coachRaceBoard');
    if (root) root.classList.toggle('crb--open', !!open);
  }
  function ensureRoot() {
    var scr = $(SCREEN_ID);
    if (!scr) return null;
    var root = $('coachRaceBoard');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'coachRaceBoard';
    root.className = 'crb' + (isOpen() ? ' crb--open' : '');
    root.innerHTML =
      '<button type="button" class="crb__handle" aria-label="실시간 순위 전광판 펼치기/접기">' +
        '<span class="crb__handle-trophy" aria-hidden="true">🏆</span><span class="crb__handle-text">LIVE<br>RANK</span>' +
        '<span class="crb__handle-chev" aria-hidden="true"></span>' +
      '</button>' +
      '<section class="crb__panel" aria-label="실시간 레이스 순위">' +
        '<header class="crb__head">' +
          '<div class="crb__title"><span class="crb__live-dot"></span>LIVE RACE RANKING</div>' +
          '<div class="crb__sub" id="coachRaceBoardSub"></div>' +
        '</header>' +
        '<div class="crb__cols"><span>순위</span><span>선수</span><span>현재 구간</span><span>점수</span></div>' +
        '<div class="crb__list" id="coachRaceBoardList"></div>' +
        '<footer class="crb__foot">세그먼트 달성 10점 × 달성률 · W/kg 가산 · 워밍업·휴식·쿨다운 제외</footer>' +
      '</section>';
    scr.appendChild(root);
    root.querySelector('.crb__handle').addEventListener('click', function () { setOpen(!root.classList.contains('crb--open')); });
    return root;
  }

  function achClass(a) {
    if (a == null) return 'crb-ach--none';
    if (a >= 1.05) return 'crb-ach--hot';
    if (a >= 0.985) return 'crb-ach--ok';
    return 'crb-ach--low';
  }

  function render(v) {
    var root = ensureRoot();
    if (!root || !v) return;
    var sub = $('coachRaceBoardSub');
    var list = $('coachRaceBoardList');
    if (!list) return;
    var subText;
    if (!v.hasWorkout) subText = '워크아웃을 선택하면 집계가 시작됩니다';
    else if (v.state === 'idle') subText = v.rows.some(function (r) { return r.total > 0; }) ? '지난 레이스 최종 순위 · 새 훈련 시작 시 초기화' : '훈련 시작 시 실시간 집계 · 점수 구간 ' + v.scoredTotal + '개';
    else if (v.state === 'finished') subText = '최종 순위 · 점수 구간 ' + v.scoredTotal + '개';
    else subText = 'SEG ' + (v.idx + 1) + '/' + v.segCount + ' · ' + v.segLabel + (v.curExcluded ? ' (점수 제외)' : '') + (v.state === 'paused' ? ' · 일시정지' : '');
    if (sub && sub.textContent !== subText) sub.textContent = subText;

    var seen = {};
    v.rows.forEach(function (r) {
      seen[r.uid] = true;
      var row = rowEls[r.uid];
      if (!row) {
        row = document.createElement('div');
        row.className = 'crb-row';
        row.innerHTML =
          '<div class="crb-row__rank"><b></b><i class="crb-row__move"></i></div>' +
          '<div class="crb-row__who"><span class="crb-row__avatar"></span><span class="crb-row__name"></span></div>' +
          '<div class="crb-row__ach"><span class="crb-row__bar"><i></i></span><em></em></div>' +
          '<div class="crb-row__score"></div>';
        list.appendChild(row);
        rowEls[r.uid] = row;
      }
      var cls = 'crb-row' + (r.rank <= 3 ? ' crb-row--top' + r.rank : '') + (r.move > 0 ? ' crb-row--up' : r.move < 0 ? ' crb-row--down' : '');
      if (row.className !== cls) row.className = cls;
      row.style.transform = 'translateY(' + ((r.rank - 1) * ROW_H) + 'px)';
      row.querySelector('.crb-row__rank b').textContent = String(r.rank);
      var mv = row.querySelector('.crb-row__move');
      var mvText = r.move > 0 ? '▲' + r.move : r.move < 0 ? '▼' + (-r.move) : '';
      if (mv.textContent !== mvText) mv.textContent = mvText;
      var nm = row.querySelector('.crb-row__name');
      if (nm.textContent !== r.name) nm.textContent = r.name;
      applyAvatar(row, r.uid.indexOf('track-') === 0 ? '' : r.uid, r.name);
      var a = r.liveAch;
      var achEl = row.querySelector('.crb-row__ach');
      var ac = 'crb-row__ach ' + (v.curExcluded || v.state === 'idle' ? 'crb-ach--none' : achClass(a));
      if (achEl.className !== ac) achEl.className = ac;
      var pct = a == null ? 0 : Math.min(120, a * 100);
      achEl.querySelector('.crb-row__bar i').style.width = (Math.min(100, pct / 1.2)) + '%';
      var at = v.curExcluded ? '제외' : v.state === 'idle' ? '—' : a == null ? '—' : Math.round(a * 100) + '%';
      var em = achEl.querySelector('em');
      if (em.textContent !== at) em.textContent = at;
      var sc = row.querySelector('.crb-row__score');
      var st = r.total.toFixed(1);
      if (sc.textContent !== st) sc.textContent = st;
    });
    Object.keys(rowEls).forEach(function (uid) {
      if (!seen[uid]) { rowEls[uid].remove(); delete rowEls[uid]; }
    });
    list.style.height = Math.max(1, v.rows.length) * ROW_H + 'px';
    var empty = list.querySelector('.crb__empty');
    if (!v.rows.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'crb__empty';
        empty.textContent = '접속한 참가자가 없습니다';
        list.appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  var MOBILE_SCREEN_ID = 'bluetoothCoachMobileScreen';
  window.coachRaceBoardLatest = function () { return window.__coachRaceLatest || null; };
  function tick() {
    if (document.hidden) return;
    var scr = $(SCREEN_ID);
    var pcOn = !!(scr && scr.classList.contains('active'));
    var mob = $(MOBILE_SCREEN_ID);
    var mobOn = !!(mob && (mob.classList.contains('active') || (mob.offsetParent !== null && getComputedStyle(mob).display !== 'none')));
    if (!pcOn && !mobOn) return;
    if (!pcOn) {
      // 휴대폰 Coach: 집계만(연결 메뉴의 순위 목록이 사용)
      try { window.__coachRaceLatest = compute(); } catch (e) {}
      return;
    }
    try {
      window.__coachRaceLatest = compute();
      render(window.__coachRaceLatest);
      // 상단 시간·워크아웃 그래프를 가리지 않도록 속도계 영역 시작 높이에 맞춤
      var grid = $('bluetoothCoachPowerMeterGrid');
      var root = $('coachRaceBoard');
      if (grid && root) {
        var top = Math.max(60, Math.round(grid.getBoundingClientRect().top));
        if (root.dataset.top !== String(top)) {
          root.dataset.top = String(top);
          root.style.top = top + 'px';
          var panel = root.querySelector('.crb__panel');
          if (panel) panel.style.maxHeight = 'calc(100vh - ' + (top + 16) + 'px)';
        }
      }
    } catch (e) { if (window.console) console.warn('[coachRaceBoard]', e); }
  }
  setInterval(tick, 1000);
  window.coachRaceBoardTick = tick;
  window.coachRaceBoardCompute = compute; // 디버그·검증용
})();
