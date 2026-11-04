/**
 * 훈련 참가자 화면(휴대폰) — 속도계 현재 파워 좌우 미니 순위 전광판 (2026-11-04)
 * 데이터: Coach(coachRaceLeaderboard.js)가 sessions/{id}/race 에 게시한 순위를 3초마다 읽음.
 * 좌측 1~4위, 우측 5~8위(내가 9위 밖이면 5~6위 · ⋯ · 내 순위). 항목: 순위 · 아바타+이름 · 점수.
 */
(function () {
  'use strict';
  if (window.__pmbLoaded) return;
  window.__pmbLoaded = true;

  var TARGETS = [
    // 그룹훈련 참석자 훈련 화면 전용(개인훈련 태블릿·모바일 훈련 화면에는 표시하지 않음)
    { screen: 'bluetoothIndividualScreen', box: '.indiv-gauge-container', power: 'indiv-ui-current-power', needle: 'indiv-gauge-needle' }
  ];
  var dbg = {};
  window.__pmbDebug = function () { return { sid: lastSid, uid: myUid(), data: data, seenAgoMs: seenAt ? Date.now() - seenAt : null, dbg: dbg }; };
  var data = null, seenT = null, seenAt = 0, fetching = false, lastFetch = 0, lastSid = '';

  var css = document.createElement('style');
  css.textContent =
    "@font-face{font-family:'DSEG7';font-weight:300;font-display:swap;src:url('https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Light.woff2') format('woff2')}" +
    "@font-face{font-family:'DSEG7';font-weight:700;font-display:swap;src:url('https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2') format('woff2')}" +
    '@keyframes pmbBlink{0%,100%{opacity:1}50%{opacity:.25}}' +
    '.pmb__dot{flex:0 0 11px;width:11px;height:11px;border-radius:50%;box-sizing:border-box}' +
    '.pmb__dot--ok{background:#22c55e;box-shadow:0 0 5px rgba(34,197,94,.7);animation:pmbBlink 1.4s ease-in-out infinite}' +
    '.pmb__dot--low{background:#f97316;box-shadow:0 0 5px rgba(249,115,22,.7);animation:pmbBlink 1.4s ease-in-out infinite}' +
    '.pmb__dot--wait{background:#7dd3fc;box-shadow:0 0 4px rgba(125,211,252,.5)}' +
    '.pmb__row em.pmb__dg{font-family:DSEG7,Orbitron,ui-monospace,monospace;font-weight:300;letter-spacing:.2px;color:rgba(214,218,224,.62);font-size:1em}' +
    '.pmb__int{font-size:1.06em;font-weight:300}.pmb__dec{font-size:.72em;opacity:.9}' +
    '.pmb__nm{font-size:1.06em;font-weight:600;color:#eef0f3}' +
    '.pmb{position:absolute;display:flex;flex-direction:column;gap:1px;pointer-events:none;z-index:3;font-variant-numeric:tabular-nums}' +
    '.pmb__row{flex:0 0 var(--rh,20px);height:var(--rh,20px);font-size:var(--fs,10px)!important;display:flex;align-items:center;gap:2px;padding:0 3px;border-radius:4px;background:rgba(255,255,255,.05);color:#cfd3d8;font-size:10px;line-height:1;overflow:hidden}' +
    '.pmb__row b{flex:0 0 11px;text-align:center;font-weight:700;color:#8a9099}' +
    '.pmb__t1 b{color:#ffd54a}.pmb__t2 b{color:#cfd8dc}.pmb__t3 b{color:#d99a6c}' +
    '.pmb__av{flex:0 0 13px;width:13px;height:13px;border-radius:50%;overflow:hidden;background:#2c3138;display:inline-flex;align-items:center;justify-content:center}' +
    '.pmb__av img{width:100%;height:100%;object-fit:cover;display:block}.pmb__av i{font-style:normal;font-size:8px;color:#aab}' +
    '.pmb__nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pmb__row em{flex:0 0 auto;font-style:normal;font-weight:700;color:#e8eaed}' +
    '.pmb__me{background:rgba(0,212,170,.2);color:#fff}.pmb__me b{color:#00d4aa}' +
    '.pmb__wait{color:#7d838c!important;font-weight:400!important;font-size:9px}' +
    '.pmb__gap{flex:0 0 var(--rh,20px);height:var(--rh,20px);display:flex;align-items:center;justify-content:center;color:#6b717a;font-size:10px;line-height:1}';
  document.head.appendChild(css);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el); // 화면 컨테이너가 position:fixed 라 offsetParent 로는 판별 불가
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function sessionId() {
    var id = window.SESSION_ID || window.currentTrainingRoomId || '';
    if (!id) { try { id = localStorage.getItem('currentTrainingRoomId') || ''; } catch (e) {} }
    if (!id && typeof SESSION_ID !== 'undefined') id = SESSION_ID || '';
    return String(id || '');
  }
  function myUid() {
    var u = window.currentUser || {};
    var fu = (window.authV9 && window.authV9.currentUser) || null;
    return String(u.id != null ? u.id : u.uid != null ? u.uid : fu ? fu.uid : '');
  }
  function dbBase() {
    try {
      var u = window.firebase && firebase.apps && firebase.apps.length && firebase.app().options.databaseURL;
      if (u) return String(u).replace(/\/+$/, '');
    } catch (e) {}
    return 'https://stelvio-ai-default-rtdb.firebaseio.com';
  }
  function token() {
    var u = (window.authV9 && window.authV9.currentUser) || (window.firebase && firebase.auth && firebase.auth().currentUser) || null;
    return u && typeof u.getIdToken === 'function' ? u.getIdToken() : Promise.reject(new Error('NO_AUTH'));
  }
  function poll(sid) {
    if (fetching || Date.now() - lastFetch < 3000) return;
    fetching = true; lastFetch = Date.now();
    token().then(function (t) {
      return fetch(dbBase() + '/sessions/' + encodeURIComponent(sid) + '/race.json?auth=' + encodeURIComponent(t), { cache: 'no-store' });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      if (v && v.rows && v.t !== seenT) { seenT = v.t; seenAt = Date.now(); }
      data = v && v.rows ? v : null;
    }).catch(function (e) { dbg.err = String(e && e.message || e); }).then(function () { fetching = false; });
  }

  // 순위 집계가 아직 없을 때(훈련 시작 전·Coach 미게시): 접속자(sessions/{id}/users)를 가나다 순으로 — 대기 상태
  var waitRows = null, waitFetching = false, waitAt = 0, avCache = {};
  function pollUsers(sid) {
    if (waitFetching || Date.now() - waitAt < 4000) return;
    waitFetching = true; waitAt = Date.now();
    token().then(function (t) {
      return fetch(dbBase() + '/sessions/' + encodeURIComponent(sid) + '/users.json?auth=' + encodeURIComponent(t), { cache: 'no-store' });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      var list = [];
      if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k) {
          var u = v[k];
          if (u && u.userName) list.push({ u: String(u.userId || 'track-' + k), n: String(u.userName), s: 0, a: '', w: 1 });
        });
      }
      list.sort(function (a, b) { return a.n.localeCompare(b.n, 'ko'); });
      list.forEach(function (r) {
        if (avCache[r.u] !== undefined) { r.a = avCache[r.u] || ''; return; }
        avCache[r.u] = '';
        if (typeof window.getUserByUid === 'function' && r.u.indexOf('track-') !== 0) {
          window.getUserByUid(r.u).then(function (p) {
            var url = p && (p.profileImageUrl || p.profile_image_url);
            avCache[r.u] = url ? String(url) : '';
            waitAt = 0;
          }).catch(function () {});
        }
      });
      waitRows = list;
    }).catch(function (e) { dbg.err = String(e && e.message || e); }).then(function () { waitFetching = false; });
  }

  function scoreHtml(v) {
    var t = (Number(v) || 0).toFixed(1).split('.');
    return '<span class="pmb__int">' + t[0] + '</span><span class="pmb__dec">.' + t[1] + '</span>';
  }
  function rowHtml(r, rank, me, waiting, excluded) {
    var nm = String(r.n || '?');
    // 아바타 자리 = 현재 세그먼트 달성도 원: 목표 충족 녹색 깜빡임 · 미달 주황 깜빡임 · 대기/휴식 하늘색
    var l = Number(r.l);
    var kind = waiting || excluded || !(l >= 0) ? 'wait' : l >= 98.5 ? 'ok' : 'low';
    var tip = kind === 'wait' ? '대기' : '구간 달성도 ' + Math.round(l) + '%';
    return '<div class="pmb__row' + (me ? ' pmb__me' : '') + (rank <= 3 ? ' pmb__t' + rank : '') + '"><b>' + rank + '</b><span class="pmb__dot pmb__dot--' + kind + '" title="' + tip + '"></span>' +
      '<span class="pmb__nm">' + esc(nm) + '</span>' + (waiting ? '<em class="pmb__wait">대기</em>' : '<em class="pmb__dg">' + scoreHtml(r.s) + '</em>') + '</div>';
  }
  function boards(box) {
    var L = box.querySelector('.pmb--l'), R = box.querySelector('.pmb--r');
    if (!L) {
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      L = document.createElement('div'); L.className = 'pmb pmb--l';
      R = document.createElement('div'); R.className = 'pmb pmb--r';
      box.appendChild(L); box.appendChild(R);
    }
    return [L, R];
  }
  function hide(box) {
    var L = box.querySelector('.pmb--l'), R = box.querySelector('.pmb--r');
    if (L) L.style.display = 'none';
    if (R) R.style.display = 'none';
  }

  function tick() {
    if (document.hidden) return;
    var act = null;
    TARGETS.forEach(function (t) {
      var scr = document.getElementById(t.screen);
      if (!act && visible(scr)) act = { t: t, scr: scr };
    });
    dbg.screen = act ? act.t.screen : null;
    if (!act) return;
    var sid = sessionId();
    if (sid !== lastSid) { lastSid = sid; data = null; seenT = null; }
    var box = act.scr.querySelector(act.t.box);
    if (!box) return;
    if (!sid) { hide(box); return; }
    poll(sid);
    dbg.rows = data && data.rows ? data.rows.length : 0;
    var fresh = data && data.rows && data.rows.length && Date.now() - seenAt < 40000;
    var src = fresh ? data.rows : null;
    var waiting = false;
    if (fresh) {
      // 아직 아무도 점수가 없으면(훈련 시작 전) 대기 표시
      waiting = !data.rows.some(function (r) { return Number(r.s) > 0; }) && data.state !== 'running' && data.state !== 'paused' && data.state !== 'finished';
    } else {
      pollUsers(sid);
      src = (waitRows || []).map(function (r) { return Object.assign({}, r, { a: avCache[r.u] || r.a }); });
      waiting = true;
    }
    if (!src || !src.length) { hide(box); return; }

    var excl = !!(fresh && data.x);
    var rows = src.map(function (r, i) { return { r: r, rank: i + 1 }; });
    var uid = myUid();
    var me = uid ? rows.find(function (x) { return String(x.r.u) === uid; }) : null;
    // 좌 1~4위. 우: 내가 8위 안(또는 전체 8명 이하)이면 5~8위 / 아니면 5~6위 · 생략(⋯) · 내 순위
    var left = rows.slice(0, 4), right;
    if (rows.length <= 8 || (me && me.rank <= 8)) right = rows.slice(4, 8);
    else right = rows.slice(4, 6).concat(['gap'], me ? [me] : []);

    // 현재 파워 숫자 위치 기준 배치
    var pw = document.getElementById(act.t.power);
    var br = box.getBoundingClientRect();
    var pr = pw && pw.getBoundingClientRect();
    if (!pr || !pr.width || !br.width) return;
    var bs = boards(box);
    // 속도계와 겹치지 않게: 좌우 가장자리·아래쪽(현재 파워 숫자 아래선)에 붙이고 폭은 최소화
    var rh = 23;
    var h = rh * 4 + 3;
    var bottom = pr.bottom - br.top;
    var top = bottom - h;
    // 고정 폭(최소 폭): 3글자 이름 + 순위 + 원 + 점수가 들어가는 최소 폭 = 화면 폭의 29.5%(390px 기준 115px) — 파워 3자리 숫자와 겹치지 않음
    var wBoard = Math.round(br.width * 0.295);
    var sig = JSON.stringify([waiting, excl, left, right, uid, Math.round(wBoard), Math.round(top), Math.round(h)]);
    bs[0].style.display = bs[1].style.display = '';
    if (box.__pmbSig === sig) return;
    box.__pmbSig = sig;
    function place(el, l, w) { el.style.left = l + 'px'; el.style.width = Math.max(40, w) + 'px'; el.style.top = top + 'px'; el.style.height = h + 'px'; el.style.setProperty('--rh', rh + 'px'); el.style.setProperty('--fs', Math.max(9, Math.min(12, rh * 0.5)) + 'px'); }
    place(bs[0], 2, wBoard);
    place(bs[1], br.width - wBoard - 2, wBoard);
    bs[0].innerHTML = left.map(function (x) { return rowHtml(x.r, x.rank, me && me.rank === x.rank, waiting, excl); }).join('');
    bs[1].innerHTML = right.map(function (x) { return x === 'gap' ? '<div class="pmb__gap">⋯</div>' : rowHtml(x.r, x.rank, me && me.rank === x.rank, waiting, excl); }).join('');
  }
  setInterval(tick, 1000);
  window.addEventListener('resize', function () { TARGETS.forEach(function (t) { var b = document.querySelector('#' + t.screen + ' ' + t.box); if (b) b.__pmbSig = ''; }); });
})();
