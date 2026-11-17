/**
 * 모바일 훈련 화면 워크아웃 그래프 클릭 → 구간별 요약표 오버레이 (Race 컨셉: 다크 네이비 + 시안/라임/오렌지 포인트)
 * 표: 구분(WU/INT/CD) | 훈련 내용(% 표기) | 상세 내용(내 FTP 기준 W 표기)
 */
(function () {
  'use strict';
  var CSS = '' +
    '.wso-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,18,.78);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Noto Sans KR","Pretendard",sans-serif;}' +
    '.wso-card{width:100%;max-width:460px;max-height:82vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#0e1424,#0a0f1f);border:1px solid rgba(34,211,238,.45);border-radius:16px;box-shadow:0 0 0 1px rgba(255,255,255,.04),0 12px 40px rgba(0,0,0,.6),0 0 24px rgba(34,211,238,.18);color:#fff;overflow:hidden;}' +
    '.wso-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);}' +
    '.wso-title{flex:1;min-width:0;}' +
    '.wso-title b{display:block;font-size:15px;font-weight:800;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.wso-title span{display:block;margin-top:2px;font-size:11px;color:#9fb0cc;}' +
    '.wso-close{flex:0 0 auto;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#cbd5e1;font-size:16px;line-height:1;cursor:pointer;}' +
    '.wso-body{overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 12px 14px;}' +
    '.wso-table{width:100%;border-collapse:separate;border-spacing:0 6px;table-layout:fixed;}' +
    '.wso-table th{font-size:10px;font-weight:700;letter-spacing:.6px;color:#8fa0c0;text-align:left;padding:0 8px 2px;text-transform:uppercase;}' +
    '.wso-table td{background:rgba(255,255,255,.045);padding:9px 8px;font-size:12.5px;line-height:1.45;vertical-align:top;word-break:break-word;font-variant-numeric:tabular-nums;}' +
    '.wso-table td:first-child{border-radius:10px 0 0 10px;border-left:3px solid var(--wso-c,#22d3ee);}' +
    '.wso-table td:last-child{border-radius:0 10px 10px 0;}' +
    '.wso-kind{display:inline-block;min-width:36px;text-align:center;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:800;color:#0a0f1f;background:var(--wso-c,#22d3ee);}' +
    '.wso-detail{color:#a3e635;}' +
    '.wso-empty{padding:24px 8px;text-align:center;color:#9fb0cc;font-size:13px;}' +
    '.wso-note{margin-top:6px;font-size:10.5px;color:#8fa0c0;text-align:right;}';
  var COLORS = { WU: '#22d3ee', INT: '#ff8c00', CD: '#a3e635' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ensureCss() {
    if (document.getElementById('wsoStyle')) return;
    var st = document.createElement('style'); st.id = 'wsoStyle'; st.textContent = CSS; document.head.appendChild(st);
  }
  function close() { var el = document.getElementById('workoutStepsOverlay'); if (el) el.remove(); }
  function show(workout) {
    ensureCss(); close();
    var ftp = Number(window.currentUser && window.currentUser.ftp) || 0;
    var rows = (workout && typeof window.buildWorkoutFlowRows === 'function') ? window.buildWorkoutFlowRows(workout, ftp) : [];
    var mins = workout ? Math.round((Number(workout.total_seconds || workout.totalSeconds) || 0) / 60) : 0;
    var meta = (mins ? mins + '분' : '') + (ftp ? (mins ? ' · ' : '') + '내 FTP ' + ftp + 'W' : '');
    var body = rows.length
      ? '<table class="wso-table"><colgroup><col style="width:17%"><col style="width:43%"><col style="width:40%"></colgroup>' +
        '<thead><tr><th>구분</th><th>훈련 내용</th><th>상세 내용</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr style="--wso-c:' + COLORS[r.kind] + '"><td><span class="wso-kind">' + r.kind + '</span></td><td>' + esc(r.content) + '</td><td class="wso-detail">' + (r.detail ? esc(r.detail) : '-') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (ftp ? '' : '<div class="wso-note">FTP 정보가 없어 상세(W) 값을 표시할 수 없습니다</div>')
      : '<div class="wso-empty">표시할 워크아웃 구간 정보가 없습니다</div>';
    var el = document.createElement('div');
    el.id = 'workoutStepsOverlay'; el.className = 'wso-back';
    el.innerHTML = '<div class="wso-card" role="dialog" aria-modal="true"><div class="wso-head"><div class="wso-title"><b>' + esc((workout && workout.title) || '워크아웃') + '</b><span>' + esc(meta || '구간별 요약') + '</span></div><button type="button" class="wso-close" aria-label="닫기">✕</button></div><div class="wso-body">' + body + '</div></div>';
    el.addEventListener('click', function (e) { if (e.target === el || (e.target.classList && e.target.classList.contains('wso-close'))) close(); });
    document.body.appendChild(el);
  }
  window.showWorkoutStepsOverlay = show;
  window.closeWorkoutStepsOverlay = close;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var sec = t.closest('.mobile-segment-graph-section');
    if (!sec || !sec.querySelector('#mobileIndividualSegmentGraph')) return;
    var w = window.currentWorkout;
    if (!w) return;
    show(w);
  }, false);
})();
