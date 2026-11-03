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
    { screen: 'bluetoothIndividualScreen', box: '.indiv-gauge-container', power: 'indiv-ui-current-power', needle: 'indiv-gauge-needle' },
    { screen: 'mobileDashboardScreen', box: '.mobile-gauge-container', power: 'mobile-ui-current-power', needle: 'mobile-gauge-needle' }
  ];
  var dbg = {};
  window.__pmbDebug = function () { return { sid: lastSid, uid: myUid(), data: data, seenAgoMs: seenAt ? Date.now() - seenAt : null, dbg: dbg }; };
  var data = null, seenT = null, seenAt = 0, fetching = false, lastFetch = 0, lastSid = '';

  var css = document.createElement('style');
  css.textContent =
    '.pmb{position:absolute;display:flex;flex-direction:column;gap:1px;pointer-events:none;z-index:3;font-variant-numeric:tabular-nums}' +
    '.pmb__row{flex:0 0 var(--rh,20px);height:var(--rh,20px);font-size:var(--fs,10px)!important;display:flex;align-items:center;gap:3px;padding:0 4px;border-radius:4px;background:rgba(255,255,255,.05);color:#cfd3d8;font-size:10px;line-height:1;overflow:hidden}' +
    '.pmb__row b{flex:0 0 13px;text-align:center;font-weight:700;color:#8a9099}' +
    '.pmb__t1 b{color:#ffd54a}.pmb__t2 b{color:#cfd8dc}.pmb__t3 b{color:#d99a6c}' +
    '.pmb__av{flex:0 0 13px;width:13px;height:13px;border-radius:50%;overflow:hidden;background:#2c3138;display:inline-flex;align-items:center;justify-content:center}' +
    '.pmb__av img{width:100%;height:100%;object-fit:cover;display:block}.pmb__av i{font-style:normal;font-size:8px;color:#aab}' +
    '.pmb__nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pmb__row em{flex:0 0 auto;font-style:normal;font-weight:700;color:#e8eaed}' +
    '.pmb__me{background:rgba(0,212,170,.2);box-shadow:inset 0 0 0 1px rgba(0,212,170,.7);color:#fff}.pmb__me b{color:#00d4aa}' +
    '.pmb__wait{color:#7d838c!important;font-weight:400!important;font-size:9px}' +
    '.pmb__gap{flex:1 1 0;display:flex;align-items:center;justify-content:center;color:#6b717a;font-size:10px;line-height:1}';
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

  function rowHtml(r, rank, me, waiting) {
    var nm = String(r.n || '?');
    var av = r.a ? '<img src="' + esc(r.a) + '" alt="" decoding="async" onerror="this.remove()">' : '<i>' + esc(nm.charAt(0)) + '</i>';
    return '<div class="pmb__row' + (me ? ' pmb__me' : '') + (rank <= 3 ? ' pmb__t' + rank : '') + '"><b>' + rank + '</b><span class="pmb__av">' + av +
      '</span><span class="pmb__nm">' + esc(nm) + '</span>' + (waiting ? '<em class="pmb__wait">대기</em>' : '<em>' + Math.round(Number(r.s) || 0) + '</em>') + '</div>';
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

    var rows = src.map(function (r, i) { return { r: r, rank: i + 1 }; });
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
    // 바늘 축(원) 아래 ~ 현재 파워 숫자 아래 사이를 5줄로 균등 분할(바늘·눈금과 겹치지 않게)
    var nd = document.getElementById(act.t.needle);
    var hub = nd && nd.querySelector('circle');
    var hr = hub && hub.getBoundingClientRect();
    var bottom = pr.bottom - br.top;
    var top = hr && hr.height ? hr.bottom - br.top + 3 : bottom - pr.height * 0.9;
    var h = Math.max(60, bottom - top);
    var rh = Math.floor((h - 4) / 5);
    var gapPx = Math.max(4, pr.width * 0.06);
    var wL = pr.left - br.left - gapPx - 2;
    var wR = br.right - pr.right - gapPx - 2;
    var sig = JSON.stringify([waiting, left, right, uid, Math.round(wL), Math.round(wR), Math.round(top), Math.round(h)]);
    bs[0].style.display = bs[1].style.display = '';
    if (box.__pmbSig === sig) return;
    box.__pmbSig = sig;
    function place(el, l, w) { el.style.left = l + 'px'; el.style.width = Math.max(40, w) + 'px'; el.style.top = top + 'px'; el.style.height = h + 'px'; el.style.setProperty('--rh', rh + 'px'); el.style.setProperty('--fs', Math.max(8, Math.min(11, rh * 0.42)) + 'px'); }
    place(bs[0], 2, wL);
    place(bs[1], pr.right - br.left + gapPx, wR);
    bs[0].innerHTML = left.map(function (x) { return rowHtml(x.r, x.rank, me && me.rank === x.rank, waiting); }).join('');
    bs[1].innerHTML = right.map(function (x) { return x === 'gap' ? '<div class="pmb__gap">⋯</div>' : rowHtml(x.r, x.rank, me && me.rank === x.rank, waiting); }).join('');
  }
  setInterval(tick, 1000);
  window.addEventListener('resize', function () { TARGETS.forEach(function (t) { var b = document.querySelector('#' + t.screen + ' ' + t.box); if (b) b.__pmbSig = ''; }); });
})();
