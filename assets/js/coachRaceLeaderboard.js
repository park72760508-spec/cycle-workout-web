/**
 * 그룹훈련 Coach PC 화면 — 실시간 레이스 순위 전광판 (2026-11-02)
 *
 * 점수 규칙
 *  - 워밍업·휴식(회복)·쿨다운 세그먼트와 목표 파워가 없는 세그먼트(케이던스 전용)는 점수 제외
 *  - 2026-11-02 개정: 세그먼트 점수 = 구간 길이(분) × 1점 × 수행도 × W/kg 가중치
 *      · 시간 가중: 30초 구간과 20분 구간이 같은 점수가 아니라 길이에 비례(긴 구간을 끝까지 지켜야 순위 상승)
 *      · 수행도 = 목표 근접도 50% + 목표 구간 유지 시간 50%
 *        - 목표 근접도(랩 평균 ÷ 목표): 100% = 1.0, 초과는 115%까지 절반만 가산(105% → 1.025, 115% 이상 1.075 동결),
 *          미달은 그대로 감점(90% → 0.9), 50% 이하 0 → 한 구간 몰아치기·구간 건너뛰기 둘 다 불리
 *        - 목표 구간 유지: 1초마다 현재 파워가 목표 ±5% 안이면 1, ±5~10%면 0.5, 그 밖(또는 데이터 없음) 0 → 평균
 *          (초반 과속 후 처짐·들쭉날쭉한 수행보다 고르게 지킨 수행이 유리)
 *  - W/kg 가중치(FTP ÷ 체중): 2.0 미만 1.00 · 2.0~ 1.01 · 2.5~ 1.02 · 3.0~ 1.03 · 3.5~ 1.04 · 4.0 이상 1.05
 *  - 진행 중인 세그먼트는 지금까지의 수행도 × 경과 시간(분)으로 실시간 반영 → 끝나면 구간 전체 길이로 확정
 *  - 랩파워는 참가자 화면에 표시되는 LAP(세그먼트 평균 파워)과 같은 값, 세그먼트 시작 5초 이후 값만 사용(이전 세그먼트 값 섞임 방지)
 *  - 2026-11-04 짧은 인터벌 보완: 제외 시간 = min(5초, 구간 길이 20%, 최소 2초) — 15초 구간 3초,
 *    30초 미만 구간은 수행도 = 근접도 70% + 유지 30%
 * 화면
 *  - 오른쪽 가장자리 손잡이로 펼치기/접기(상태 기억)
 *  - 순위·등락·아바타·이름·현재 세그먼트 달성률·누적 점수, 순위가 바뀌면 행이 미끄러지며 이동
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__coachRaceBoardLoaded) return;
  window.__coachRaceBoardLoaded = true;

  var SCREEN_ID = 'bluetoothTrainingCoachScreen';
  var ROW_H = 78; // 2026-11-03 멀리서도 보이게 확대(전 순위 같은 높이·글자 크기)
  var PROX_CAP = 1.15;   // 목표 근접도: 초과 달성 인정 상한
  var PROX_FLOOR = 0.5;  // 이 이하 달성은 0
  var ZONE_FULL = 0.05;  // 목표 ±5%: 유지 1초 인정
  var ZONE_HALF = 0.10;  // 목표 ±10%: 0.5초 인정
  var LAP_GUARD_SEC = 5;  // 기본 제외 시간(구간 길이 25초 이상)
  var SHORT_SEG_SEC = 30; // 이보다 짧은 구간은 랩 평균 비중을 높임
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
  /** 목표 근접도 0~1.075 */
  function proximity(ach) {
    if (!(ach > PROX_FLOOR)) return 0;
    if (ach < 1) return ach;
    return 1 + (Math.min(ach, PROX_CAP) - 1) * 0.5;
  }
  /**
   * 세그먼트 점수 (제외 구간이면 null)
   * @param minutes 점수에 반영할 시간(분) — 확정 시 구간 전체 길이, 진행 중이면 경과 시간
   * @param tiz 목표 구간 유지 집계 { n: 샘플 수, z: 인정 합 }
   */
  function segScore(seg, lapW, u, tiz, minutes) {
    if (isExcludedSegment(seg)) return null;
    var target = segTarget(seg, u.ftp, u.reportedTarget);
    if (!(target > 0)) return null;
    var ach = Math.max(0, lapW / target);
    var prox = proximity(ach);
    var keep = tiz && tiz.n > 0 ? Math.max(0, Math.min(1, tiz.z / tiz.n)) : Math.min(1, prox);
    // 30초 미만 구간: 유지 시간 표본이 적고 지연 영향이 커서 랩 평균(근접도) 70% · 유지 30%
    var wProx = segDur(seg) > 0 && segDur(seg) < SHORT_SEG_SEC ? 0.7 : 0.5;
    var quality = wProx * prox + (1 - wProx) * keep;
    return { ach: ach, quality: quality, pts: Math.max(0, minutes) * quality * wkgWeight(u.ftp, u.weight) };
  }
  function segDur(seg) { return num(seg && (seg.duration_sec || seg.duration)); }
  /** 구간 시작 후 측정 제외 시간: 기본 5초, 짧은 구간은 길이의 20%(15초 → 3초, 최소 2초) */
  function lapGuard(seg) {
    var d = segDur(seg);
    if (!(d > 0)) return LAP_GUARD_SEC;
    return Math.min(LAP_GUARD_SEC, Math.max(2, Math.round(d * 0.2)));
  }

  function sessionId() {
    try {
      if (typeof window.getBluetoothCoachSessionId === 'function') return String(window.getBluetoothCoachSessionId() || '');
    } catch (e) {}
    return String(window.SESSION_ID || window.currentTrainingRoomId || '');
  }
  function storeKey(k) { return 'stelvioCoachRace:' + k; }
  function freshState(key) {
    return { key: key, seg: null, lastElapsed: 0, final: {}, lap: {}, tiz: {}, users: {}, prevRank: {}, moves: {}, done: false };
  }
  function loadState(key) {
    try {
      var raw = sessionStorage.getItem(storeKey(key));
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.key === key) { o.moves = {}; o.tiz = o.tiz || {}; return o; }
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
      var tz = S.tiz[uid] && S.tiz[uid].seg === k ? S.tiz[uid] : null;
      var sc = segScore(seg, lp.w, u, tz, segDur(seg) / 60);
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
      S.ceremony = true; // 모든 세그먼트 종료 → PC 화면에서 1등 축하 세리머니
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
      var segNow = segments[idx];
      var guard = lapGuard(segNow);
      if (active && segEl >= guard && fresh && num(pm.segmentPower) > 0) {
        S.lap[uid] = { seg: idx, w: num(pm.segmentPower) };
      }
      // 목표 구간 유지 시간: 진행 중(일시정지 제외)·점수 구간에서 1초마다 현재 파워를 목표와 비교
      if (st === 'running' && segEl >= guard && segNow && !isExcludedSegment(segNow)) {
        var tgt = segTarget(segNow, u.ftp, u.reportedTarget);
        if (tgt > 0) {
          var tz = S.tiz[uid];
          if (!tz || tz.seg !== idx) tz = S.tiz[uid] = { seg: idx, n: 0, z: 0, at: 0 };
          if (now - tz.at >= 900) {
            tz.at = now;
            var dev = Math.abs((fresh ? num(pm.currentPower) : 0) / tgt - 1);
            tz.n += 1;
            tz.z += dev <= ZONE_FULL + 1e-9 ? 1 : dev <= ZONE_HALF + 1e-9 ? 0.5 : 0; // 소수 오차(1.05/1−1=0.0500…04) 보정
          }
        }
      }
      if (pm.userId) fetchAvatar(String(pm.userId));
      present.push(uid);
    });

    var seg = segments[idx];
    var curExcluded = !seg || isExcludedSegment(seg);
    var liveMin = seg ? Math.max(0, Math.min(segDur(seg) || segEl, segEl)) / 60 : 0;
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
        var tzL = S.tiz[uid] && S.tiz[uid].seg === idx ? S.tiz[uid] : null;
        var sc = segScore(seg, lp.w, u, tzL, liveMin);
        if (sc) {
          liveAch = sc.ach;
          if (active) total += sc.pts;
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
    var scr0 = $(SCREEN_ID);
    if (scr0) scr0.classList.toggle('crb-board-open', !!open);
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
        '<div class="crb__top" id="coachRaceBoardTop"></div>' +
        '<div class="crb__list" id="coachRaceBoardList"></div>' +
        '<footer class="crb__foot">구간 1분당 1점 × 수행도(목표 근접 50% + 목표 ±5% 유지 50%) · W/kg 가산 · 워밍업·휴식·쿨다운 제외</footer>' +
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
    var top = $('coachRaceBoardTop');
    if (!list || !top) return;
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
        rowEls[r.uid] = row;
      }
      // 2026-11-03 1~3위는 고정 영역, 4위부터 스크롤 영역
      var box = r.rank <= 3 ? top : list;
      if (row.parentNode !== box) box.appendChild(row);
      var cls = 'crb-row' + (r.rank <= 3 ? ' crb-row--top' + r.rank : '') + (r.move > 0 ? ' crb-row--up' : r.move < 0 ? ' crb-row--down' : '');
      if (row.className !== cls) row.className = cls;
      row.style.transform = 'translateY(' + ((r.rank <= 3 ? r.rank - 1 : r.rank - 4) * ROW_H) + 'px)';
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
    top.style.height = Math.max(1, Math.min(3, v.rows.length)) * ROW_H + 'px';
    var inner = list.querySelector('.crb__list-in');
    if (!inner) { inner = document.createElement('div'); inner.className = 'crb__list-in'; list.appendChild(inner); }
    inner.style.height = Math.max(0, v.rows.length - 3) * ROW_H + 'px';
    root.classList.toggle('crb--norest', v.rows.length <= 3);
    var empty = top.querySelector('.crb__empty');
    if (!v.rows.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'crb__empty';
        empty.textContent = '접속한 참가자가 없습니다';
        top.appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  // ---------- 1등 축하 세리머니(2026-11-03) ----------
  // 모든 세그먼트 종료 시 화면 전체 오버레이: 트로피 + 1등 이름·점수 + 2·3위, 폭죽·불꽃·꽃가루 애니메이션.
  // 화면을 클릭(터치)하기 전까지 계속 유지.
  function showCeremony(rows) {
    var old = $('coachRaceCeremony');
    if (old && old.__stop) old.__stop();
    var w1 = rows[0];
    var el = document.createElement('div');
    el.id = 'coachRaceCeremony';
    el.className = 'crc';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '1등 축하');
    var pod = rows.slice(1, 3).map(function (r) {
      return '<span class="crc__pod crc__pod--' + r.rank + '"><b>' + r.rank + '위</b>' + esc(r.name) + ' <em>' + r.total.toFixed(1) + '</em></span>';
    }).join('');
    var av = avatarCache[w1.uid];
    el.innerHTML =
      '<canvas class="crc__fx"></canvas>' +
      '<div class="crc__stage">' +
        '<div class="crc__rays" aria-hidden="true"></div>' +
        '<div class="crc__trophy" aria-hidden="true">🏆</div>' +
        '<div class="crc__label">WINNER</div>' +
        '<div class="crc__name">' + (av ? '<img class="crc__avatar" src="' + esc(av) + '" alt="" onerror="this.remove()">' : '') + '<span>' + esc(w1.name) + '</span></div>' +
        '<div class="crc__score"><b>' + w1.total.toFixed(1) + '</b> 점</div>' +
        (pod ? '<div class="crc__pods">' + pod + '</div>' : '') +
        '<div class="crc__hint">화면을 클릭하면 닫힙니다</div>' +
      '</div>';
    document.body.appendChild(el);

    var cv = el.querySelector('.crc__fx');
    var ctx = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = 0, H = 0;
    function size() { W = window.innerWidth; H = window.innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    window.addEventListener('resize', size);
    var COLORS = ['#facc15', '#fde047', '#f97316', '#ef4444', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6', '#ffffff'];
    var rockets = [], sparks = [], confetti = [];
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    function launch() {
      rockets.push({ x: rnd(W * 0.1, W * 0.9), y: H + 10, vx: rnd(-1.2, 1.2), vy: rnd(-15, -11), c: COLORS[(Math.random() * COLORS.length) | 0], ty: rnd(H * 0.12, H * 0.45) });
    }
    function burst(x, y, c) {
      var n = 90 + ((Math.random() * 60) | 0), ring = Math.random() < 0.35;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05);
        var sp = ring ? 6.5 : rnd(1.5, 8);
        sparks.push({ x: x, y: y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(55, 90), age: 0, c: Math.random() < 0.25 ? '#ffffff' : c, tw: Math.random() < 0.4 });
      }
    }
    for (var k = 0; k < 160; k++) confetti.push(newConfetti(true));
    function newConfetti(any) {
      return { x: rnd(0, W), y: any ? rnd(-H, H) : rnd(-60, -10), w: rnd(6, 12), h: rnd(10, 18), vy: rnd(1.5, 3.8), vx: rnd(-0.8, 0.8), r: rnd(0, 6.28), vr: rnd(-0.15, 0.15), c: COLORS[(Math.random() * COLORS.length) | 0] };
    }
    var t0 = performance.now(), lastLaunch = 0, raf = 0;
    // 시작하자마자 한꺼번에 터뜨림
    for (var q = 0; q < 5; q++) burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.15, H * 0.45), COLORS[(Math.random() * COLORS.length) | 0]);
    function frame(now) {
      raf = requestAnimationFrame(frame);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      if (now - lastLaunch > rnd(260, 620)) { lastLaunch = now; launch(); if (Math.random() < 0.35) launch(); }
      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i];
        r.x += r.vx; r.y += r.vy; r.vy += 0.16;
        ctx.fillStyle = r.c; ctx.beginPath(); ctx.arc(r.x, r.y, 2.6, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,150,0.5)'; ctx.beginPath(); ctx.arc(r.x - r.vx * 2, r.y - r.vy * 2, 1.6, 0, 6.283); ctx.fill();
        if (r.y <= r.ty || r.vy >= -1) { burst(r.x, r.y, r.c); rockets.splice(i, 1); }
      }
      for (var j = sparks.length - 1; j >= 0; j--) {
        var p = sparks[j];
        p.px = p.x; p.py = p.y;
        p.vx *= 0.975; p.vy = p.vy * 0.975 + 0.07;
        p.x += p.vx; p.y += p.vy; p.age++;
        var al = 1 - p.age / p.life;
        if (al <= 0) { sparks.splice(j, 1); continue; }
        if (p.tw && Math.random() < 0.3) al *= 0.3;
        ctx.strokeStyle = p.c; ctx.globalAlpha = al; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (var m = 0; m < confetti.length; m++) {
        var f = confetti[m];
        f.x += f.vx + Math.sin((now - t0) / 600 + m) * 0.6; f.y += f.vy; f.r += f.vr;
        if (f.y > H + 20) confetti[m] = newConfetti(false);
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r);
        ctx.fillStyle = f.c; ctx.fillRect(-f.w / 2, -f.h / 2 * Math.abs(Math.cos(f.r * 2)), f.w, f.h * Math.abs(Math.cos(f.r * 2)) + 1);
        ctx.restore();
      }
      if (sparks.length > 4000) sparks.splice(0, sparks.length - 4000);
    }
    raf = requestAnimationFrame(frame);
    el.__stop = function () {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    el.addEventListener('click', function () {
      el.classList.add('crc--out');
      setTimeout(el.__stop, 350);
    });
  }
  window.coachRaceShowCeremony = function () { // 확인용: 현재 순위로 세리머니 표시
    var v = window.__coachRaceLatest;
    if (v && v.rows && v.rows.length) showCeremony(v.rows);
  };

  var MOBILE_SCREEN_ID = 'bluetoothCoachMobileScreen';
  window.coachRaceAvatarUrl = function (uid) { return avatarCache[uid] || ''; };
  window.coachRaceBoardLatest = function () { return window.__coachRaceLatest || null; };
  /* 2026-11-04 참가자 화면 미니 순위 전광판용: 집계 결과를 sessions/{id}/race 에 게시(변경 시 2초 간격, 변화 없어도 10초마다) */
  var pubSig = '', pubAt = 0;
  function publishRace(v) {
    try {
      if (!v || !v.rows || !v.rows.length || typeof window.bluetoothCoachRtdbSet !== 'function') return;
      var sid = sessionId();
      if (!sid) return;
      var now = Date.now();
      var rows = v.rows.slice(0, 40).map(function (r) {
        return { u: r.uid, n: r.name, s: Math.round(r.total * 10) / 10, a: avatarCache[r.uid] || '', l: r.liveAch == null ? -1 : Math.round(r.liveAch * 100) };
      });
      var sig = JSON.stringify(rows);
      if (sig === pubSig ? now - pubAt < 10000 : now - pubAt < 2000) return;
      pubSig = sig; pubAt = now;
      window.bluetoothCoachRtdbSet('sessions/' + sid + '/race', { t: now, state: v.state || '', x: v.curExcluded ? 1 : 0, rows: rows }).catch(function (e) { if (window.console) console.warn('[coachRace] 순위 게시 실패', e && e.message); });
    } catch (e) {}
  }
  function tick() {
    if (document.hidden) return;
    var scr = $(SCREEN_ID);
    var pcOn = !!(scr && scr.classList.contains('active'));
    var mob = $(MOBILE_SCREEN_ID);
    var mobOn = !!(mob && (mob.classList.contains('active') || (mob.offsetParent !== null && getComputedStyle(mob).display !== 'none')));
    if (!pcOn && !mobOn) return;
    if (!pcOn) {
      // 휴대폰 Coach: 집계만(연결 메뉴의 순위 목록이 사용)
      try { window.__coachRaceLatest = compute(); publishRace(window.__coachRaceLatest); } catch (e) {}
      return;
    }
    try {
      window.__coachRaceLatest = compute();
      publishRace(window.__coachRaceLatest);
      render(window.__coachRaceLatest);
      var lv = window.__coachRaceLatest;
      if (S && S.ceremony) {
        S.ceremony = false;
        saveState();
        if (lv && lv.rows.length && lv.rows[0].total > 0) showCeremony(lv.rows);
      }
      // 2026-11-03 위치: 위 = 워크아웃 그래프 블록 상단(그래프를 덮음), 왼쪽 = 그래프 Y축 선, 아래 = 화면 바닥
      var root = $('coachRaceBoard');
      var sb = document.querySelector('#' + SCREEN_ID + ' .scoreboard-display');
      if (root && sb) {
        var sbr = sb.getBoundingClientRect();
        var left = Math.round(window.innerWidth * 0.62);
        var cv = $('bluetoothCoachSegmentGraphCanvas');
        if (cv && cv.width > 0) {
          var cr = cv.getBoundingClientRect();
          if (cr.width > 0) left = Math.round(cr.left + 35 * (cr.width / cv.width)); // 그래프 padding.left
        }
        // 펼치면 속도계는 1줄 7개(블록 최소 176px) — 보드는 7번째 블록 바로 옆(여백 4px)부터 오른쪽 끝까지, 가능한 한 넓게
        var grid = $('bluetoothCoachPowerMeterGrid');
        if (grid) {
          var gr = grid.getBoundingClientRect();
          left = Math.min(left, Math.round(gr.left + 7 * 176 + 6 * 3 + 4));
        }
        left = Math.max(Math.round(window.innerWidth * 0.45), Math.min(left, window.innerWidth - 500));
        var topY = Math.max(0, Math.round(sbr.top));
        scr.classList.toggle('crb-board-open', root.classList.contains('crb--open'));
        var key = left + '|' + topY + '|' + window.innerWidth + '|' + window.innerHeight;
        if (root.dataset.k !== key) {
          root.dataset.k = key;
          root.style.top = topY + 'px';
          var panel = root.querySelector('.crb__panel');
          scr.style.setProperty('--crb-w', (window.innerWidth - left) + 'px');
          if (panel) {
            panel.style.width = (window.innerWidth - left) + 'px';
            panel.style.height = (window.innerHeight - topY - 8) + 'px';
          }
        }
      }
    } catch (e) { if (window.console) console.warn('[coachRaceBoard]', e); }
  }
  setInterval(tick, 1000);
  window.addEventListener('resize', function () { var r = $('coachRaceBoard'); if (r) r.dataset.k = ''; });
  window.coachRaceBoardTick = tick;
  window.coachRaceBoardCompute = compute; // 디버그·검증용
})();
