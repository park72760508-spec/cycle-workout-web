/**
 * 훈련 참가자 화면(휴대폰) — 속도계 현재 파워 좌우 미니 순위 전광판 (2026-11-04)
 * 데이터: Coach(coachRaceLeaderboard.js)가 sessions/{id}/race 에 게시한 순위를 3초마다 읽음.
 * 좌측 1~5위, 우측 6~8위 … 나의 순위(10위 안이면 10위까지). 항목: 순위 · 아바타+이름 · 점수.
 */
(function () {
  'use strict';
  if (window.__pmbLoaded) return;
  window.__pmbLoaded = true;

  var TARGETS = [
    { screen: 'bluetoothIndividualScreen', box: '.indiv-gauge-container', power: 'indiv-ui-current-power' },
    { screen: 'mobileDashboardScreen', box: '.mobile-gauge-container', power: 'mobile-ui-current-power' }
  ];
  var dbg = {};
  window.__pmbDebug = function () { return { sid: lastSid, uid: myUid(), data: data, seenAgoMs: seenAt ? Date.now() - seenAt : null, dbg: dbg }; };
  var data = null, seenT = null, seenAt = 0, fetching = false, lastFetch = 0, lastSid = '';

  var css = document.createElement('style');
  css.textContent =
    '.pmb{position:absolute;display:flex;flex-direction:column;gap:1px;pointer-events:none;z-index:3;font-variant-numeric:tabular-nums}' +
    '.pmb__row{flex:1 1 0;min-height:0;display:flex;align-items:center;gap:3px;padding:0 4px;border-radius:4px;background:rgba(255,255,255,.05);color:#cfd3d8;font-size:10px;line-height:1;overflow:hidden}' +
    '.pmb__row b{flex:0 0 13px;text-align:center;font-weight:700;color:#8a9099}' +
    '.pmb__t1 b{color:#ffd54a}.pmb__t2 b{color:#cfd8dc}.pmb__t3 b{color:#d99a6c}' +
    '.pmb__av{flex:0 0 13px;width:13px;height:13px;border-radius:50%;overflow:hidden;background:#2c3138;display:inline-flex;align-items:center;justify-content:center}' +
    '.pmb__av img{width:100%;height:100%;object-fit:cover;display:block}.pmb__av i{font-style:normal;font-size:8px;color:#aab}' +
    '.pmb__nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pmb__row em{flex:0 0 auto;font-style:normal;font-weight:700;color:#e8eaed}' +
    '.pmb__me{background:rgba(0,212,170,.2);box-shadow:inset 0 0 0 1px rgba(0,212,170,.7);color:#fff}.pmb__me b{color:#00d4aa}' +
    '.pmb__gap{flex:1 1 0;display:flex;align-items:center;justify-content:center;color:#6b717a;font-size:10px;line-height:1}';
  document.head.appendChild(css);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function visible(el) { return !!(el && el.offsetParent !== null && getComputedStyle(el).display !== 'none'); }
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

  function rowHtml(r, rank, me) {
    var nm = String(r.n || '?');
    var av = r.a ? '<img src="' + esc(r.a) + '" alt="" decoding="async" onerror="this.remove()">' : '<i>' + esc(nm.charAt(0)) + '</i>';
    return '<div class="pmb__row' + (me ? ' pmb__me' : '') + (rank <= 3 ? ' pmb__t' + rank : '') + '"><b>' + rank + '</b><span class="pmb__av">' + av +
      '</span><span class="pmb__nm">' + esc(nm) + '</span><em>' + Math.round(Number(r.s) || 0) + '</em></div>';
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
    if (!fresh) { hide(box); return; }

    var rows = data.rows.map(function (r, i) { return { r: r, rank: i + 1 }; });
    var uid = myUid();
    var me = uid ? rows.find(function (x) { return String(x.r.u) === uid; }) : null;
    var left = rows.slice(0, 5), right;
    if (rows.length <= 10 || (me && me.rank <= 10)) right = rows.slice(5, 10);
    else right = rows.slice(5, 8).concat(['gap'], me ? [me] : []);

    // 현재 파워 숫자 위치 기준 배치
    var pw = document.getElementById(act.t.power);
    var br = box.getBoundingClientRect();
    var pr = pw && pw.getBoundingClientRect();
    if (!pr || !pr.width || !br.width) return;
    var bs = boards(box);
    var h = pr.height * 1.25;
    var bottom = pr.bottom - br.top + pr.height * 0.05;
    var top = bottom - h;
    var gapPx = Math.max(4, pr.width * 0.06);
    var wL = pr.left - br.left - gapPx - 2;
    var wR = br.right - pr.right - gapPx - 2;
    var sig = JSON.stringify([left, right, uid, Math.round(wL), Math.round(wR), Math.round(top), Math.round(h)]);
    bs[0].style.display = bs[1].style.display = '';
    if (box.__pmbSig === sig) return;
    box.__pmbSig = sig;
    function place(el, l, w) { el.style.left = l + 'px'; el.style.width = Math.max(40, w) + 'px'; el.style.top = top + 'px'; el.style.height = h + 'px'; }
    place(bs[0], 2, wL);
    place(bs[1], pr.right - br.left + gapPx, wR);
    bs[0].innerHTML = left.map(function (x) { return rowHtml(x.r, x.rank, me && me.rank === x.rank); }).join('');
    bs[1].innerHTML = right.map(function (x) { return x === 'gap' ? '<div class="pmb__gap">⋯</div>' : rowHtml(x.r, x.rank, me && me.rank === x.rank); }).join('');
  }
  setInterval(tick, 1000);
  window.addEventListener('resize', function () { TARGETS.forEach(function (t) { var b = document.querySelector('#' + t.screen + ' ' + t.box); if (b) b.__pmbSig = ''; }); });
})();
