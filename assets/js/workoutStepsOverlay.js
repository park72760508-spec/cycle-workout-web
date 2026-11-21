/**
 * 모바일 훈련 화면 워크아웃 그래프 클릭 → 구간별 요약표 오버레이 (Race 컨셉: 다크 네이비 + 시안/라임/오렌지 포인트)
 * 표: 구분(WU/INT/RST/CD) | 훈련 내용(% 표기) | 상세 내용(내 FTP 기준 W 표기)
 */
(function () {
  'use strict';
  var CSS = '' +
    '.wso-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,18,.78);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Noto Sans KR","Pretendard",sans-serif;}' +
    '.wso-card{width:100%;max-width:460px;max-height:82vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#0e1424,#0a0f1f);border:1px solid rgba(34,211,238,.45);border-radius:16px;box-shadow:0 0 0 1px rgba(255,255,255,.04),0 12px 40px rgba(0,0,0,.6),0 0 24px rgba(34,211,238,.18);color:#fff;overflow:hidden;}' +
    '.wso-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);}' +
    '.wso-lap{text-align:center;line-height:1.1;min-width:84px;}' +
    '.wso-lap small{display:block;font-size:10px;font-weight:700;letter-spacing:.5px;color:#8fa0c0;}' +
    '.wso-lap b{display:block;margin-top:2px;font:italic 800 22px/1 "Barlow Semi Condensed","Noto Sans KR",sans-serif;font-variant-numeric:tabular-nums;color:#22d3ee;text-shadow:0 0 10px rgba(34,211,238,.35);}' +
    '.wso-lap.wso-lap--off b{color:#64748b;text-shadow:none;}' +
    '.wso-seg{display:block;margin-top:4px;max-width:210px;font-size:11px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.wso-lap.wso-lap--off .wso-seg{color:#64748b;}' +
    '.wso-dur{margin-top:5px;font-size:11.5px;font-weight:700;color:#cbd5e1;text-align:center;font-variant-numeric:tabular-nums;}' +
    '.wso-title{flex:1;min-width:0;}' +
    '.wso-title b{display:block;font-size:15px;font-weight:800;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.wso-title span{display:block;margin-top:2px;font-size:11px;color:#9fb0cc;}' +
    '.wso-close{justify-self:end;flex:0 0 auto;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#cbd5e1;font-size:16px;line-height:1;cursor:pointer;}' +
    '.wso-body{overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 12px 14px;}' +
    '.wso-table{width:100%;border-collapse:separate;border-spacing:0 6px;table-layout:fixed;}' +
    '.wso-table th{font-size:10px;font-weight:700;letter-spacing:.6px;color:#8fa0c0;text-align:left;padding:0 8px 2px;text-transform:uppercase;}' +
    '.wso-table td{background:rgba(255,255,255,.045);padding:9px 8px;font-size:12.5px;line-height:1.45;vertical-align:top;word-break:break-word;font-variant-numeric:tabular-nums;}' +
    '.wso-table td:first-child{text-align:center;border-radius:10px 0 0 10px;border-left:3px solid var(--wso-c,#22d3ee);}' +
    '.wso-table td:last-child{border-radius:0 10px 10px 0;}' +
    '.wso-kind{display:inline-block;min-width:36px;text-align:center;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:800;color:#0a0f1f;background:var(--wso-c,#22d3ee);}' +
    '.wso-detail{color:#a3e635;}' +
    '@keyframes wsoBlink{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--wso-c,#22d3ee);}50%{opacity:.25;box-shadow:0 0 10px 2px var(--wso-c,#22d3ee);}}' +
    '.wso-kind.wso-now{animation:wsoBlink 1s ease-in-out infinite;}' +
    '.wso-empty{padding:24px 8px;text-align:center;color:#9fb0cc;font-size:13px;}' +
    '.wso-note{margin-top:6px;font-size:10.5px;color:#8fa0c0;text-align:right;}';
  var COLORS = { WU: '#22d3ee', INT: '#ff8c00', RST: '#94a3b8', CD: '#a3e635' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ensureCss() {
    if (document.getElementById('wsoStyle')) return;
    var st = document.createElement('style'); st.id = 'wsoStyle'; st.textContent = CSS; document.head.appendChild(st);
  }
  var timer = null, mode = '';
  /* 현재 수행 중인 세그먼트 인덱스 — 시작 전·종료 상태는 -1(깜빡임 없음) */
  function currentSegIndex() {
    try {
      if (mode === 'coach') {
        var cs = window.bluetoothCoachState || {};
        return (cs.trainingState === 'running' || cs.trainingState === 'paused') ? Number(cs.currentSegmentIndex) : -1;
      }
      if (mode === 'mobile') {
        var m = window.mobileTrainingState;
        return m && m.timerId && !(Number(m.totalSec) > 0 && Number(m.elapsedSec) >= Number(m.totalSec)) ? Number(m.segIndex) : -1;
      }
      if (mode === 'indiv') {
        var ci = typeof window.currentSegmentIndex === 'number' ? window.currentSegmentIndex : -1; // 진행 중일 때만 0 이상
        return ci;
      }
    } catch (e) {}
    return -1;
  }

  /* 약식 분초: 270초 → 4'30" */
  function fmtMS(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), r = sec % 60; return m + "'" + (r < 10 ? '0' : '') + r + '"'; }
  function rowSec(workout, r) {
    var segs = (workout && workout.segments) || [], t = 0;
    for (var i = r.segFrom; i >= 0 && i <= r.segTo && i < segs.length; i++) t += Number(segs[i] && (segs[i].duration_sec != null ? segs[i].duration_sec : segs[i].duration)) || 0;
    return t;
  }
  /* 현재 세그먼트 남은시간(LAP) — 각 훈련 화면의 LAP 표시를 그대로 따른다 */
  var LAP_IDS = { coach: ['coachm-ui-lap-time', 'bluetoothCoachLapCountdown'], mobile: ['mobile-ui-lap-time', 'segmentTime'], indiv: ['indiv-ui-lap-time'] };
  function readLap() {
    var ids = LAP_IDS[mode] || [];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      var tx = el && (el.textContent || '').trim();
      if (tx && /^\d{1,3}:\d{2}$/.test(tx)) return tx;
    }
    return '';
  }

  var curWorkout = null, curFtp = 0;
  /* 현재 세그먼트 한 줄 설명: 이름 · 시간 · 목표(% 또는 W) · RPM */
  function segInfo(idx) {
    var sg = curWorkout && curWorkout.segments && curWorkout.segments[idx];
    if (!sg) return '';
    var name = String(sg.label || sg.name || '').trim();
    var dur = Number(sg.duration_sec != null ? sg.duration_sec : sg.duration) || 0;
    var tt = String(sg.target_type || 'ftp_pct'), tv = sg.target_value, pct = '', rpm = '';
    function w(p) { return curFtp > 0 ? Math.round(curFtp * p / 100) + 'W' : ''; }
    if (tt === 'ftp_pctz') {
      var a = String(tv).split(/[\/~]/).map(Number);
      if (a.length >= 2 && a[0] > 0) pct = a[0] + '~' + a[1] + '%' + (curFtp > 0 ? ' (' + w(a[0]) + '~' + w(a[1]) + ')' : '');
    } else if (tt === 'dual') {
      var d = String(tv).split(/[\/~]/).map(Number);
      if (d[0] > 0) pct = d[0] + '%' + (curFtp > 0 ? ' (' + w(d[0]) + ')' : '');
      if (d[1] > 0) rpm = d[1] + 'rpm';
    } else if (tt === 'cadence_rpm') {
      if (Number(tv) > 0) rpm = Number(tv) + 'rpm';
    } else {
      var v = Number(tv);
      if (v > 0) {
        var to = sg.ramp && sg.ramp !== 'none' && Number(sg.ramp_to_value) > 0 ? Number(sg.ramp_to_value) : 0;
        pct = (to && to !== v ? v + '→' + to : String(v)) + '%' + (curFtp > 0 && !to ? ' (' + w(v) + ')' : '');
      }
    }
    return [name, dur > 0 ? fmtMS(dur) : '', pct, rpm].filter(Boolean).join(' · ');
  }
  function refreshNow() {
    var el = document.getElementById('workoutStepsOverlay');
    if (!el) { stopTimer(); return; }
    var idx = currentSegIndex();
    var lapEl = el.querySelector('.wso-lap');
    if (lapEl) {
      var lt = idx >= 0 ? readLap() : '';
      lapEl.classList.toggle('wso-lap--off', !lt);
      var lb = lapEl.querySelector('b'); if (lb) lb.textContent = lt || '--:--';
      var sgEl = lapEl.querySelector('.wso-seg'); if (sgEl) { var si = idx >= 0 ? segInfo(idx) : ''; sgEl.textContent = si || '진행 중인 세그먼트 없음'; sgEl.title = si; }
    }
    var rows = el.querySelectorAll('tr[data-from]');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i], f = Number(tr.getAttribute('data-from')), t = Number(tr.getAttribute('data-to'));
      var on = isFinite(idx) && idx >= 0 && idx >= f && idx <= t;
      var k = tr.querySelector('.wso-kind');
      if (k) k.classList.toggle('wso-now', on);
    }
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function close() { stopTimer(); var el = document.getElementById('workoutStepsOverlay'); if (el) el.remove(); }
  function show(workout, ftpOverride, trackMode) {
    ensureCss(); close();
    mode = trackMode || '';
    curWorkout = workout; curFtp = Number(ftpOverride) > 0 ? Number(ftpOverride) : (Number(window.currentUser && window.currentUser.ftp) || 0);
    var ftp = Number(ftpOverride) > 0 ? Number(ftpOverride) : (Number(window.currentUser && window.currentUser.ftp) || 0);
    var rows = (workout && typeof window.buildWorkoutFlowRows === 'function') ? window.buildWorkoutFlowRows(workout, ftp) : [];
    var totSec = workout ? (Number(workout.total_seconds || workout.totalSeconds) || 0) : 0;
    if (!totSec && workout && Array.isArray(workout.segments)) {
      totSec = workout.segments.reduce(function (a, g) { return a + (Number(g && (g.duration_sec != null ? g.duration_sec : g.duration)) || 0); }, 0);
    }
    var mins = Math.round(totSec / 60);
    var meta = (mins ? mins + '분' : '') + (ftp ? (mins ? ' · ' : '') + '내 FTP ' + ftp + 'W' : '');
    var body = rows.length
      ? '<table class="wso-table"><colgroup><col style="width:17%"><col style="width:43%"><col style="width:40%"></colgroup>' +
        '<thead><tr><th>구분</th><th>훈련 내용</th><th>상세 내용</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr data-from="' + r.segFrom + '" data-to="' + r.segTo + '" style="--wso-c:' + COLORS[r.kind] + '"><td><span class="wso-kind">' + r.kind + '</span>' + (r.kind === 'INT' && rowSec(workout, r) > 0 ? '<div class="wso-dur">' + fmtMS(rowSec(workout, r)) + '</div>' : '') + '</td><td>' + esc(r.content) + '</td><td class="wso-detail">' + (r.detail ? esc(r.detail) : '-') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (ftp ? '' : '<div class="wso-note">FTP 정보가 없어 상세(W) 값을 표시할 수 없습니다</div>')
      : '<div class="wso-empty">표시할 워크아웃 구간 정보가 없습니다</div>';
    var el = document.createElement('div');
    el.id = 'workoutStepsOverlay'; el.className = 'wso-back';
    el.innerHTML = '<div class="wso-card" role="dialog" aria-modal="true"><div class="wso-head"><div class="wso-title"><b>' + esc((workout && workout.title) || '워크아웃') + '</b><span>' + esc(meta || '구간별 요약') + '</span></div>' + (mode ? '<div class="wso-lap wso-lap--off"><small>LAP 남은시간</small><b>--:--</b><span class="wso-seg">진행 중인 세그먼트 없음</span></div>' : '<div></div>') + '<button type="button" class="wso-close" aria-label="닫기">✕</button></div><div class="wso-body">' + body + '</div></div>';
    el.addEventListener('click', function (e) { if (e.target === el || (e.target.classList && e.target.classList.contains('wso-close'))) close(); });
    document.body.appendChild(el);
    if (mode) { refreshNow(); timer = setInterval(refreshNow, 500); }
  }
  window.showWorkoutStepsOverlay = show;
  window.closeWorkoutStepsOverlay = close;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    /* 모바일 개인/그룹 훈련 화면 + 블루투스 개인훈련 통합 화면(그룹훈련 Live Training Room 참가자) 그래프 */
    var sec = t.closest('.mobile-segment-graph-section') || t.closest('.indiv-segment-graph-section');
    if (!sec) return;
    /* 그룹훈련 휴대폰 Coach 모니터 화면 그래프: 코치 화면에 적용된 워크아웃 + 선택한 선수 슬롯의 FTP(없으면 내 FTP) */
    if (sec.querySelector('#coachmSegmentGraph')) {
      if (t.closest('#coachmGraphPlaceholder')) return; // 워크아웃 미설정 안내 영역은 기존 선택 메뉴
      var cw = (window.bluetoothCoachState && window.bluetoothCoachState.currentWorkout) || window.currentWorkout;
      if (!cw || !Array.isArray(cw.segments) || !cw.segments.length) return;
      show(cw, Number(window.__coachmGraphFtp) || 0, 'coach');
      return;
    }
    if (!(sec.querySelector('#mobileIndividualSegmentGraph') || sec.querySelector('#indiv-individualSegmentGraph'))) return;
    var w = window.currentWorkout;
    if (!w) return;
    show(w, 0, sec.querySelector('#mobileIndividualSegmentGraph') ? 'mobile' : 'indiv');
  }, false);
})();
