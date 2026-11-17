/** 워크아웃 요약 문자열 공용(워크아웃 화면 카드·그룹세션 상세 공용) — 예: WU 10m(55→70%) | 12m@68% | 3 X (6m@80% + 3m@60%) | CD 6m(60→40%)
 * ftp > 0 이면 % 값을 W 로 환산, 1분 미만은 초(s) 표기. */
(function () {
window.buildWorkoutFlowSummary = function(workout, ftp) {
  var segs = (workout && workout.segments) || [];
  var useW = Number(ftp) > 0;
  function dur(sg) {
    var d = typeof sg.duration_sec === 'number' ? sg.duration_sec : typeof sg.duration === 'number' ? sg.duration : 0;
    return Math.max(0, Math.round(d));
  }
  function pctOf(v) {
    if (typeof v === 'string') v = v.split(/[~/]/)[0];
    else if (Array.isArray(v)) v = v[0];
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function fmtT(sec) {
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), r = sec % 60;
    return r ? m + 'm' + r + 's' : m + 'm';
  }
  function fmtV(p) { return useW ? Math.round((p * Number(ftp)) / 100) : Math.round(p); }
  var unit = useW ? 'W' : '%';
  function norm(sg) {
    var t = sg.target_type || 'ftp_pct';
    var f = 0, rpm = 0;
    if (t === 'ftp_pct' || t === 'dual') f = pctOf(sg.target_value);
    else if (t === 'ftp_pctz') {
      /* "56~75" 형식(하한~상한) — 평균값 */
      var pv = String(sg.target_value == null ? '' : sg.target_value).split(/[~/]/).map(Number).filter(function (x) { return isFinite(x) && x > 0; });
      if (pv.length) f = Math.round(pv.reduce(function (a2, b2) { return a2 + b2; }, 0) / pv.length);
    } else if (t === 'cadence_rpm') {
      rpm = Number(sg.target_value) || 0;
    }
    var to = f && sg.ramp && sg.ramp !== 'none' && sg.ramp_to_value != null ? pctOf(sg.ramp_to_value) : 0;
    return { sec: dur(sg), f: f, to: to && to !== f ? to : 0, rpm: rpm, type: String(sg.segment_type || '') };
  }
  function desc(n) {
    if (!n.f) return n.rpm ? fmtT(n.sec) + '@' + Math.round(n.rpm) + 'rpm' : fmtT(n.sec);
    return n.to ? fmtT(n.sec) + '(' + fmtV(n.f) + '→' + fmtV(n.to) + unit + ')' : fmtT(n.sec) + '@' + fmtV(n.f) + unit;
  }
  function sig(n) { return n.sec + '|' + n.f + '|' + n.to + '|' + n.rpm; }
  function isEdge(n) { return n.type === 'warmup' || n.type === 'cooldown'; }
  /* 반복 블록 탐지: arr[i..] 에서 길이 L(1~8) 블록이 연속 2회 이상 반복되면 {L,k,cover} — 가장 많이 덮는 L 우선(동률이면 짧은 L) */
  function findRepeat(arr, i, allowEdge) {
    var best = { L: 0, k: 1, cover: 0 };
    for (var L = 1; L <= 8; L++) {
      if (i + L > arr.length) break;
      var okBlock = true;
      for (var z = 0; z < L; z++) { if (!allowEdge && isEdge(arr[i + z])) { okBlock = false; break; } }
      if (!okBlock) break;
      var k = 1;
      while (i + (k + 1) * L <= arr.length) {
        var same = true;
        for (var y = 0; y < L; y++) {
          var cand = arr[i + k * L + y];
          if ((!allowEdge && isEdge(cand)) || sig(cand) !== sig(arr[i + y])) { same = false; break; }
        }
        if (!same) break;
        k++;
      }
      if (k >= 2 && k * L > best.cover) best = { L: L, k: k, cover: k * L };
    }
    return best;
  }
  /* 구간 배열을 "a + k X (b + c) + ..." 로 압축 */
  function compress(arr) {
    var parts = [], i = 0, rep = false;
    while (i < arr.length) {
      var r = findRepeat(arr, i, true);
      if (r.L > 0) {
        var ps = [];
        for (var w = 0; w < r.L; w++) ps.push(desc(arr[i + w]));
        parts.push(r.k + ' X (' + ps.join(' + ') + ')');
        i += r.cover; rep = true;
      } else { parts.push(desc(arr[i])); i++; }
    }
    return { text: parts.join(' + '), repeated: rep };
  }
  var ns = segs.map(norm).filter(function (n) { return n.sec > 0; });
  var out = [], i = 0;
  while (i < ns.length) {
    var n = ns[i];
    if (n.type === 'warmup') {
      /* 웜업 구간에 반복(예: 10s@120% + 50s@60% 4회)이 섞여 있으면 첫~마지막 웜업 구간을 압축:
       * "WU 12m@60% + 4 X (10s@120% + 50s@60%)" — 마지막 웜업 바로 뒤 비웜업 1구간이 반복 블록의 짝이면 포함 */
      var lastW = i;
      for (var u = i; u < ns.length; u++) if (ns[u].type === 'warmup') lastW = u;
      var region = ns.slice(i, lastW + 1);
      var ext = lastW + 1 < ns.length && !isEdge(ns[lastW + 1]) ? region.concat([ns[lastW + 1]]) : null;
      var cr = compress(region), usedLen = region.length;
      if (ext) {
        var cx = compress(ext);
        if (cx.repeated && /\)$/.test(cx.text)) { cr = cx; usedLen = ext.length; }
      }
      if (cr.repeated) {
        out.push('WU ' + cr.text);
        i += usedLen;
        continue;
      }
    }
    if (isEdge(n)) {
      /* 같은 종류(웜업/쿨다운)가 연속이면 하나로 합쳐 표기 */
      var j = i, tot = 0;
      while (j < ns.length && ns[j].type === n.type) { tot += ns[j].sec; j++; }
      var first = ns[i], last = ns[j - 1];
      var f = first.f, to = last.to || last.f, lab = (n.type === 'warmup' ? 'WU ' : 'CD ') + fmtT(tot);
      if (j - i > 1) {
        /* 계단식(오프너 포함 등) 여러 구간이면 최소~최대 범위로 표기 */
        var lo = Infinity, hi = 0;
        for (var q = i; q < j; q++) {
          [ns[q].f, ns[q].to].forEach(function (v) { if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
        }
        out.push(lab + (hi > 0 ? (lo === hi ? '@' + fmtV(lo) + unit : '(' + fmtV(lo) + '~' + fmtV(hi) + unit + ')') : ''));
      } else {
        out.push(lab + (f && to && f !== to ? '(' + fmtV(f) + '→' + fmtV(to) + unit + ')' : f ? '@' + fmtV(f) + unit : ''));
      }
      i = j;
      continue;
    }
    var rb = findRepeat(ns, i, false);
    if (rb.L > 0) {
      var parts = [];
      for (var w = 0; w < rb.L; w++) parts.push(desc(ns[i + w]));
      out.push(rb.k + ' X (' + parts.join(' + ') + ')');
      i += rb.cover;
      continue;
    }
    out.push(desc(n));
    i++;
  }
  return out.join(' | ');
};
})();
