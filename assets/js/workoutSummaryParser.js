/* 워크아웃 요약 표현 파서
 * 예) WD 2m@70%/80rpm + 2m@85%/90rpm | 2 X (8m@88% + 3m@50%) + 12m@90% | CD 5m@50%
 *
 * 공개 API (window.WorkoutSummaryParser / module.exports)
 *   parse(text)            → { ok, segments[], error }
 *   toSheetRows(segments, parsed) → [[훈련구분, 훈련내역, 'mm:ss'], ...]
 *   toBuilderSegments(segments)   → 워크아웃 작성 화면 세그먼트 배열
 *
 * 기본 문법은 엄격하지만, 아래처럼 어긋난 표현도 가능한 한 해석한다.
 *   - 전각 문자, 공백 유무, 대소문자, ~ – — 범위 기호, "분/초/min/sec", % · rpm 생략
 *   - 반복: 2X(...) · 2 x (...) · 2×(...) · 2*(...) · 괄호 없는 "3x 3m@88%", 중첩 반복
 *   - 섹션 머리말: WD/워밍업/워밍, 메인/MAIN, CD/쿨다운/쿨 (없으면 위치로 판단)
 */
(function (root) {
  'use strict';

  var SECTION_NAME = { wd: '워밍업', main: '메인', cd: '쿨다운' };

  var SEG_RE = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?(?:(\d+)s)?@(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%?(?:\/(\d+)(?:-(\d+))?(?:rpm)?)?$/;

  /** 비교 전 정규화: 전각→반각, 단위/기호 통일, 공백 제거 */
  function normalize(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
         .replace(/　/g, ' ');
    s = s.toLowerCase()
         .replace(/[~–—−〜]/g, '-')
         .replace(/ftp/g, '')
         .replace(/시간|hours?|hrs?/g, 'h')
         .replace(/minutes?|mins?|분/g, 'm')
         .replace(/seconds?|secs?|초/g, 's')
         .replace(/[\[\]{}]/g, function (c) { return c === '[' || c === '{' ? '(' : ')'; })
         .replace(/[\u00D7\u2715\u2716]/g, 'x')
         .replace(/\s+/g, '');
    return s;
  }

  function fail(msg) { return { ok: false, error: msg, segments: [] }; }

  /** depth 0 에서만 구분자로 자르기 */
  function splitTop(s, delim) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === delim && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parenBalanced(s) {
    var d = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') { d--; if (d < 0) return false; }
    }
    return d === 0;
  }

  function fmtRange(lo, hi, unit) {
    return lo === hi ? lo + unit : lo + '~' + hi + unit;
  }

  /** 구간 문자열(정규화됨) 하나 → 구간 객체 또는 {err} */
  function parseSeg(raw, orig) {
    // 시간 앞의 공백이 지워져도 "2m@70%80rpm" 처럼 / 없는 rpm 도 허용
    var t = raw.replace(/%(\d+(?:-\d+)?rpm)$/, '%/$1');
    var m = SEG_RE.exec(t);
    if (!m) {
      return { err: "'" + orig + "' 형식을 해석할 수 없음 (예: 3m30s@88-95%/85-95rpm)" };
    }
    var hours = m[1] ? parseFloat(m[1]) : 0;
    var mins = m[2] ? parseInt(m[2], 10) : 0;
    var secs = m[3] ? parseInt(m[3], 10) : 0;
    var dur = Math.round(hours * 3600) + mins * 60 + secs;
    if (!(dur > 0)) return { err: "'" + orig + "' 시간이 0초이거나 없음" };

    var pLo = parseFloat(m[4]);
    var pHi = m[5] != null ? parseFloat(m[5]) : pLo;
    if (!(pLo > 0) || !(pHi > 0) || pLo > 200 || pHi > 200) {
      return { err: "'" + orig + "' 파워는 0% 초과 200% 이하여야 함" };
    }
    if (m[5] != null && pLo >= pHi) {
      return { err: "'" + orig + "' 범위 최소값이 최대값보다 " + (pLo > pHi ? '큼' : '같거나 큼') };
    }
    var rLo = null, rHi = null;
    if (m[6] != null) {
      rLo = parseInt(m[6], 10);
      rHi = m[7] != null ? parseInt(m[7], 10) : rLo;
      if (rLo > rHi) return { err: "'" + orig + "' RPM 범위 최소값이 최대값보다 큼" };
      if (rLo <= 0 || rHi > 300) return { err: "'" + orig + "' RPM 값이 올바르지 않음" };
    }
    var target = pLo === pHi ? pLo : Math.round((pLo + pHi) / 2);
    var label = (rLo != null ? fmtRange(rLo, rHi, 'RPM') + ' ' : '') + 'FTP ' + fmtRange(pLo, pHi, '%');
    return {
      seg: {
        type: null,
        durationSec: dur,
        powerLow: pLo,
        powerHigh: pHi,
        powerTarget: target,
        rpmLow: rLo,
        rpmHigh: rHi,
        label: label
      }
    };
  }

  /** 섹션 본문 → 구간 배열 (반복 펼침). 오류 시 {err} */
  function parseItems(body, secName, trail) {
    var parts = splitTop(body, '+');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var where = secName + ' 섹션 ' + trail + (i + 1) + '번째 구간: ';
      if (!p) return { err: secName + ' 섹션 ' + trail + (i + 1) + '번째 구간이 비어 있음 (+ 앞뒤 확인)' };
      var rep = /^(\d+)[x*](.+)$/.exec(p);
      if (rep) {
        var n = parseInt(rep[1], 10);
        var inner = rep[2];
        if (inner[0] === '(' && inner[inner.length - 1] === ')' && parenBalanced(inner.slice(1, -1))) {
          inner = inner.slice(1, -1);
        } else if (inner.indexOf('(') >= 0 || inner.indexOf(')') >= 0) {
          return { err: where + "괄호가 맞지 않음 '" + p + "'" };
        }
        if (!(n >= 1) || n > 100) return { err: where + "반복 횟수는 1~100 이어야 함 '" + p + "'" };
        var sub = parseItems(inner, secName, trail + (i + 1) + '번째 반복의 ');
        if (sub.err) return sub;
        for (var k = 0; k < n; k++) {
          for (var j = 0; j < sub.items.length; j++) out.push(Object.assign({}, sub.items[j]));
        }
        continue;
      }
      if (p.indexOf('(') >= 0 || p.indexOf(')') >= 0) return { err: where + "괄호 사용이 올바르지 않음 '" + p + "'" };
      var r = parseSeg(p, p);
      if (r.err) return { err: secName + ' 섹션 ' + trail + (i + 1) + '번째 구간: ' + r.err };
      out.push(r.seg);
    }
    return { items: out };
  }

  /** 섹션 문자열 → {role, body} (머리말 해석) */
  function sectionHead(raw) {
    var s = String(raw).trim();
    var m = /^(wd|w\.?u\.?|워밍업|워밍|메인|main|cd|c\.?d\.?|쿨다운|쿨)\s*[:：]?\s*(.*)$/i.exec(s);
    if (!m) return { role: null, body: s };
    var h = m[1].toLowerCase().replace(/\./g, '');
    var role = (h === 'wd' || h === 'wu' || h.indexOf('워밍') === 0) ? 'wd'
      : (h === 'cd' || h.indexOf('쿨') === 0) ? 'cd' : 'main';
    return { role: role, body: m[2] };
  }

  function parse(text) {
    var src = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
    if (!src) return fail('워크아웃 요약 표현을 입력해주세요.');
    src = src.replace(/[｜│¦]/g, '|');
    var rawSecs = src.split('|').map(function (x) { return x.trim(); });

    var heads = rawSecs.map(sectionHead);
    var anyLabel = heads.some(function (h) { return h.role; });
    var roles = [];
    if (anyLabel) {
      // 머리말 있는 섹션은 그대로, 없는 섹션은 비어 있는 역할을 순서대로(1개뿐이면 메인)
      var seen = {}, free = [];
      for (var i = 0; i < heads.length; i++) {
        if (!heads[i].role) continue;
        if (seen[heads[i].role]) return fail('같은 종류의 섹션이 중복됨: ' + SECTION_NAME[heads[i].role]);
        seen[heads[i].role] = true;
      }
      ['wd', 'main', 'cd'].forEach(function (r) { if (!seen[r]) free.push(r); });
      var unl = heads.filter(function (h) { return !h.role; }).length;
      if (unl > free.length) return fail('섹션이 너무 많음 (워밍업 | 메인 | 쿨다운 최대 3개)');
      if (unl === 1 && free.indexOf('main') >= 0) free = ['main'];
      var fi = 0;
      for (var j = 0; j < heads.length; j++) roles.push(heads[j].role || free[fi++]);
    } else if (rawSecs.length === 3) {
      roles = ['wd', 'main', 'cd'];
    } else if (rawSecs.length === 1) {
      roles = ['main'];
    } else {
      return fail('섹션은 " | "로 구분한 3개(워밍업 | 메인 | 쿨다운)여야 함 (현재 ' + rawSecs.length + '개)');
    }

    var sections = {};
    for (var s = 0; s < rawSecs.length; s++) {
      var role = roles[s];
      var body = anyLabel ? heads[s].body : rawSecs[s];
      var nb = normalize(body);
      sections[role] = { body: nb, name: SECTION_NAME[role] };
    }

    var segments = [];
    var roleList = ['wd', 'main', 'cd'];
    for (var q = 0; q < roleList.length; q++) {
      var rl = roleList[q];
      var sec = sections[rl];
      if (!sec) continue;
      if (sec.body === '' ) return fail(sec.name + ' 섹션이 비어 있음 (구간이 없으면 "-" 입력)');
      if (sec.body === '-') continue;
      if (!parenBalanced(sec.body)) return fail(sec.name + ' 섹션: 괄호가 맞지 않음');
      var res = parseItems(sec.body, sec.name, '');
      if (res.err) return fail(res.err);
      for (var z = 0; z < res.items.length; z++) {
        var it = res.items[z];
        it.type = rl === 'wd' ? '워밍업' : rl === 'cd' ? '쿨다운' : (it.powerHigh < 60 ? '휴식' : '인터벌');
        segments.push(it);
      }
    }
    if (!segments.length) return fail('변환할 구간이 없음');
    return { ok: true, segments: segments, error: null };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(sec) { return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60); }

  /** [훈련구분, 훈련내역, 시간(mm:ss)] 행. CD 가 "-" 이면 [쿨다운, -, 00:00] 1행 추가 */
  function toSheetRows(segments) {
    var rows = segments.map(function (s) { return [s.type, s.label, mmss(s.durationSec)]; });
    var hasCd = segments.some(function (s) { return s.type === '쿨다운'; });
    if (!hasCd) rows.push(['쿨다운', '-', '00:00']);
    return rows;
  }

  /** 구간 → 워크아웃 작성 화면(workoutSegments) 항목 */
  function toBuilderSegments(segments) {
    var typeMap = { '워밍업': 'warmup', '인터벌': 'interval', '휴식': 'rest', '쿨다운': 'cooldown' };
    var base = Date.now();
    return segments.map(function (s, i) {
      var tt, tv;
      if (s.rpmLow != null) {
        tt = 'dual';
        tv = s.powerTarget + '/' + Math.round((s.rpmLow + s.rpmHigh) / 2);
      } else if (s.powerLow !== s.powerHigh) {
        tt = 'ftp_pctz';
        tv = s.powerLow + '/' + s.powerHigh;
      } else {
        tt = 'ftp_pct';
        tv = s.powerTarget;
      }
      return {
        id: base + i,
        label: s.type,
        segment_type: typeMap[s.type] || 'interval',
        duration_sec: s.durationSec,
        target_type: tt,
        target_value: tv,
        ramp: 'none',
        ramp_to_value: null
      };
    });
  }

  var api = { parse: parse, toSheetRows: toSheetRows, toBuilderSegments: toBuilderSegments, mmss: mmss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WorkoutSummaryParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
