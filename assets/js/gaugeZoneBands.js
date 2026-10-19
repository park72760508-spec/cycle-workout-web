/**
 * 훈련 계기판 파워 존 띠 (2026-10-18)
 *
 * 속도계(파워) 계기판 반원(0 ~ FTP×2.0) 회색띠 위에 FTP 존 영역을 반투명 색상 띠로 표시한다.
 * 색상·경계는 분석 > 라이딩 지표 > 사용자 FTP 표(userManager.js ftpZones)와 동일.
 * 계기판 범위가 항상 0 ~ FTP×2 이고 존 경계도 FTP 비율이라 FTP 값과 무관하게 위치가 고정된다.
 *
 * 대상: 회색 배경 원호 path[d="M 20 140 A 80 80 0 0 1 180 140"](stroke #333, 두께 12)를 가진 계기판
 *       — 모바일 대시보드, 노트북/태블릿, 그룹훈련 Player(indiv-), 코치 모바일(coachm-), bluetoothIndividual.html
 * 띠는 회색 배경 바로 뒤에 넣어, 이후 그려지는 목표값 원호(반투명)가 존 띠 위에 겹쳐 보이게 한다.
 */
(function () {
  'use strict';

  var CX = 100;
  var CY = 140;
  var R = 80;
  var BAND_OPACITY = 0.45;
  var ZONE_BAND_WIDTH = 12; // 존 띠 두께(고정)
  var TARGET_ARC_WIDTH = ZONE_BAND_WIDTH * 0.6; // 목표값·존 상한 원호 두께 = 존 띠의 60%(7.2) — 바깥·안쪽 2.4씩 존 색상 노출(2026-10-18)
  var TARGET_UNDERLAY_COLOR = '#333'; // 목표 원호 아래 바탕(회색 배경과 동일) — 존 색과 섞이지 않게
  var BG_D = 'M 20 140 A 80 80 0 0 1 180 140';

  /** [시작 FTP 비율, 끝 FTP 비율, 색상] — 계기판 끝은 FTP×2.0 */
  var ZONES = [
    [0, 0.55, '#9ca3af'], // Z1 리커버리
    [0.55, 0.75, '#3b82f6'], // Z2 지구력
    [0.75, 0.9, '#22c55e'], // Z3 템포
    [0.9, 1.05, '#eab308'], // Z4 역치
    [1.05, 1.2, '#f97316'], // Z5 VO2max
    [1.2, 1.5, '#ef4444'], // Z6 무산소
    [1.5, 2.0, '#a855f7'] // Z7 신경근
  ];

  function pointAt(ftpRatio) {
    var r = Math.min(Math.max(ftpRatio / 2, 0), 1); // 계기판 비율(0~1)
    var rad = Math.PI + r * Math.PI;
    return { x: +(CX + R * Math.cos(rad)).toFixed(3), y: +(CY + R * Math.sin(rad)).toFixed(3) };
  }

  function buildBands(svgNs) {
    var g = document.createElementNS(svgNs, 'g');
    g.setAttribute('class', 'stelvio-gauge-zone-bands');
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('pointer-events', 'none');
    ZONES.forEach(function (z, i) {
      var a = pointAt(z[0]);
      var b = pointAt(z[1]);
      var p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' A ' + R + ' ' + R + ' 0 0 1 ' + b.x + ' ' + b.y);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', z[2]);
      p.setAttribute('stroke-opacity', String(BAND_OPACITY));
      p.setAttribute('stroke-width', String(ZONE_BAND_WIDTH));
      // 존 경계는 모두 직선(butt) — 2026-10-18: Z1·Z7 에 round 캡을 주면 안쪽 끝(Z1|Z2, Z6|Z7 경계)에도 둥근 돌출이 생겼다
      p.setAttribute('stroke-linecap', 'butt');
      p.setAttribute('data-zone', String(i));
      g.appendChild(p);
    });
    // 계기판 바깥쪽 양 끝만 둥글게(회색 배경의 round 캡과 같은 모양): 끝점 아래쪽 반원을 채워 그린다
    [[0, ZONES[0][2], 0], [2, ZONES[ZONES.length - 1][2], ZONES.length - 1]].forEach(function (end) {
      var c = pointAt(end[0]);
      var half = ZONE_BAND_WIDTH / 2;
      var cap = document.createElementNS(svgNs, 'path');
      cap.setAttribute('d', 'M ' + (c.x - half) + ' ' + c.y + ' A ' + half + ' ' + half + ' 0 0 0 ' + (c.x + half) + ' ' + c.y + ' Z');
      cap.setAttribute('fill', end[1]);
      cap.setAttribute('fill-opacity', String(BAND_OPACITY));
      cap.setAttribute('stroke', 'none');
      cap.setAttribute('data-zone', String(end[2]));
      g.appendChild(cap);
    });
    return g;
  }

  function isGaugeBg(path) {
    var stroke = String(path.getAttribute('stroke') || '').toLowerCase();
    return path.getAttribute('d') === BG_D && (stroke === '#333' || stroke === '#333333') && String(path.getAttribute('stroke-width')) === '12';
  }

  /* ---------- 목표 원호 바탕(underlay) ----------
   * 목표 원호는 반투명이라 존 띠 위에 그리면 존 색과 섞여 보인다 → 목표 원호 바로 아래에 같은 모양·두께의
   * 회색(#333) 바탕을 깔아, 목표 원호 자리에서는 존 색이 보이지 않고 목표 원호만 보이게 한다(2026-10-18).
   * 목표 원호는 화면별 코드가 수시로 d·display 를 바꾸므로 MutationObserver 로 따라간다. */
  var ARC_SELECTOR = 'path[id$="gauge-target-arc"], path[id$="gauge-max-arc"]';
  var UNDERLAY_CLASS = 'stelvio-gauge-target-underlay';

  /** 목표값 원호 색 = 계기판 목표값 숫자 색(#ff8c00 주황 / #00d4aa 민트)과 같은 불투명 톤(2026-10-18).
   *  화면별 코드가 rgba(…, 0.5) 반투명으로 칠하므로 알파만 떼어 같은 RGB 불투명으로 맞춘다(달성 시 민트 전환은 그대로). */
  function solidifyTargetArcColor(arc) {
    if (!/gauge-target-arc$/.test(arc.id || '')) return; // 존 상한 원호(gauge-max-arc)는 범위 표시라 반투명 유지
    var c = arc.getAttribute('stroke') || '';
    var m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/i.exec(c);
    if (m) arc.setAttribute('stroke', 'rgb(' + m[1] + ', ' + m[2] + ', ' + m[3] + ')');
  }

  function syncUnderlay(arc) {
    var parent = arc.parentNode;
    if (!parent) return;
    solidifyTargetArcColor(arc);
    var ul = arc.previousSibling;
    if (!ul || ul.nodeType !== 1 || !ul.classList || !ul.classList.contains(UNDERLAY_CLASS)) {
      ul = document.createElementNS(arc.namespaceURI || 'http://www.w3.org/2000/svg', 'path');
      ul.setAttribute('class', UNDERLAY_CLASS);
      ul.setAttribute('fill', 'none');
      ul.setAttribute('stroke', TARGET_UNDERLAY_COLOR);
      ul.setAttribute('stroke-linecap', arc.getAttribute('stroke-linecap') || 'round');
      ul.setAttribute('aria-hidden', 'true');
      ul.setAttribute('pointer-events', 'none');
      parent.insertBefore(ul, arc);
    }
    var d = arc.getAttribute('d') || '';
    if (ul.getAttribute('d') !== d) {
      if (d) ul.setAttribute('d', d);
      else ul.removeAttribute('d');
    }
    var hidden = !d || arc.style.display === 'none' || arc.getAttribute('display') === 'none';
    var disp = hidden ? 'none' : '';
    if (ul.style.display !== disp) ul.style.display = disp;
  }

  function syncSvgUnderlays(svg) {
    var arcs = svg.querySelectorAll(ARC_SELECTOR);
    for (var i = 0; i < arcs.length; i++) syncUnderlay(arcs[i]);
  }

  function watchSvg(svg) {
    if (!svg || svg.__stelvioZoneUnderlayWatched || typeof MutationObserver !== 'function') return;
    svg.__stelvioZoneUnderlayWatched = true;
    syncSvgUnderlays(svg);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.classList && t.classList.contains(UNDERLAY_CLASS)) continue; // 바탕 자체 변경은 무시(무한 루프 방지)
        syncSvgUnderlays(svg);
        return;
      }
    });
    mo.observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ['d', 'style', 'display', 'stroke'] });
  }

  /* ---------- 현재 파워 존 강조 ----------
   * 현재 파워가 속한 존 띠만 반투명을 없앤 원색으로, 나머지는 반투명(2026-10-18).
   * 화면마다 파워·FTP 를 따로 받지 않고 계기판 바늘 각도(= -90 + 파워/(FTP×2) × 180, 모든 화면 공통 공식)로
   * 현재 FTP 비율을 구한다 → 바늘이 가리키는 존 = 강조 존. 바늘이 0(파워 없음)이면 강조 없음. */
  function zoneIndexForFtpRatio(ftpRatio) {
    if (!(ftpRatio > 0.005)) return -1;
    for (var i = 0; i < ZONES.length; i++) {
      if (ftpRatio < ZONES[i][1] || i === ZONES.length - 1) return i;
    }
    return -1;
  }

  function highlightZone(bands, idx) {
    if (bands.__activeZone === idx) return;
    bands.__activeZone = idx;
    var kids = bands.children;
    for (var i = 0; i < kids.length; i++) {
      var z = Number(kids[i].getAttribute('data-zone'));
      var op = String(z === idx ? 1 : BAND_OPACITY);
      kids[i].setAttribute(kids[i].getAttribute('fill') === 'none' ? 'stroke-opacity' : 'fill-opacity', op);
    }
  }

  function watchNeedle(svg, bands) {
    var needle = svg.querySelector('[id$="gauge-needle"]');
    if (!needle || needle.__stelvioZoneWatched || typeof MutationObserver !== 'function') return;
    needle.__stelvioZoneWatched = true;
    /* 바늘 중심 흰 원 안에 현재 파워 존(Z1~Z7) 표시(2026-10-19) — 원은 반지름 6 → 8 로 키워 글자가 읽히게.
       글자는 회전하는 바늘 그룹 밖(중심 100,140)에 두고 바늘 위에 그린다. */
    var hub = needle.querySelector('circle');
    if (hub) hub.setAttribute('r', '8');
    var ns = svg.namespaceURI || 'http://www.w3.org/2000/svg';
    var zoneText = document.createElementNS(ns, 'text');
    zoneText.setAttribute('class', 'stelvio-gauge-zone-label');
    zoneText.setAttribute('x', String(CX));
    zoneText.setAttribute('y', String(CY));
    zoneText.setAttribute('text-anchor', 'middle');
    zoneText.setAttribute('dominant-baseline', 'central');
    zoneText.setAttribute('font-size', '7');
    zoneText.setAttribute('font-weight', '800');
    zoneText.setAttribute('fill', '#111827');
    zoneText.setAttribute('pointer-events', 'none');
    if (needle.nextSibling) needle.parentNode.insertBefore(zoneText, needle.nextSibling);
    else needle.parentNode.appendChild(zoneText);
    var lastLabel = null;
    function update() {
      var m = /rotate\(\s*(-?[\d.]+)/.exec(needle.getAttribute('transform') || '');
      var angle = m ? Number(m[1]) : -90;
      var ftpRatio = ((angle + 90) / 180) * 2;
      var idx = zoneIndexForFtpRatio(ftpRatio);
      highlightZone(bands, idx);
      var label = idx >= 0 ? 'Z' + (idx + 1) : '';
      if (label !== lastLabel) {
        lastLabel = label;
        zoneText.textContent = label;
      }
    }
    update();
    new MutationObserver(update).observe(needle, { attributes: true, attributeFilter: ['transform'] });
  }

  /* ---------- LAP AVG ▼ 표시 ----------
   * 존 띠 바깥 가장자리(반지름 86)와 눈금 숫자(반지름 98, 글자 10) 사이 공간에 현재 LAP AVG 파워 위치를
   * 주황 ▼ 로 표시(2026-10-18). 높이 6 — 공간(약 7)보다 작게. 끝이 띠 바깥 가장자리를 가리킨다.
   * LAP AVG 값: 바늘 id 접두사(mobile-/indiv-/coachm-/없음) + 'ui-lap-power' 요소 텍스트.
   * 계기판 끝 값(FTP×2)은 눈금 숫자 중 최댓값에서 읽는다(화면마다 FTP 를 따로 받지 않음). */
  var LAP_TRI_TIP_R = R + ZONE_BAND_WIDTH / 2 + 0.5; // 86.5
  var LAP_TRI_H = 6;
  var LAP_TRI_HALF_W = 3.6;
  var LAP_TRI_COLOR = '#ff8c00';

  function parseWatts(text) {
    var n = Number(String(text || '').replace(/[^\d.]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function gaugeMaxPower(svg) {
    var labels = svg.querySelector('[id$="gauge-labels"]');
    if (!labels) return 0;
    var max = 0;
    var texts = labels.querySelectorAll('text');
    for (var i = 0; i < texts.length; i++) {
      var v = parseWatts(texts[i].textContent);
      if (v > max) max = v;
    }
    return max;
  }

  function watchLapMarker(svg) {
    var needle = svg.querySelector('[id$="gauge-needle"]');
    if (!needle || svg.__stelvioLapMarker || typeof MutationObserver !== 'function') return;
    var prefix = String(needle.id).replace(/gauge-needle$/, '');
    var lapEl = document.getElementById(prefix + 'ui-lap-power');
    if (!lapEl) return; // LAP AVG 표시가 없는 계기판(노트북 등)은 생략
    var ns = svg.namespaceURI || 'http://www.w3.org/2000/svg';
    var tri = document.createElementNS(ns, 'path');
    tri.setAttribute('class', 'stelvio-gauge-lap-marker');
    tri.setAttribute('d', 'M 0 0 L ' + (-LAP_TRI_HALF_W) + ' ' + (-LAP_TRI_H) + ' L ' + LAP_TRI_HALF_W + ' ' + (-LAP_TRI_H) + ' Z');
    tri.setAttribute('fill', LAP_TRI_COLOR);
    tri.setAttribute('aria-hidden', 'true');
    tri.setAttribute('pointer-events', 'none');
    tri.style.display = 'none';
    svg.appendChild(tri);
    svg.__stelvioLapMarker = tri;
    var last = '';
    function update() {
      var lap = parseWatts(lapEl.textContent);
      var maxP = gaugeMaxPower(svg);
      if (!(lap > 0) || !(maxP > 0)) {
        if (last !== 'hidden') { tri.style.display = 'none'; last = 'hidden'; }
        return;
      }
      var ratio = Math.min(Math.max(lap / maxP, 0), 1);
      var deg = (-90 + ratio * 180).toFixed(2);
      if (deg === last) return;
      last = deg;
      // 바늘과 같은 회전 기준: 중심(100,140)에서 deg 만큼 돌린 뒤 반지름 방향으로 띠 바깥 가장자리까지 이동
      tri.setAttribute('transform', 'translate(' + CX + ', ' + CY + ') rotate(' + deg + ') translate(0, ' + (-LAP_TRI_TIP_R) + ')');
      tri.style.display = '';
    }
    update();
    new MutationObserver(update).observe(lapEl, { childList: true, characterData: true, subtree: true });
    var labels = svg.querySelector('[id$="gauge-labels"]');
    if (labels) new MutationObserver(update).observe(labels, { childList: true, characterData: true, subtree: true });
  }

  /** 문서(또는 root) 안 계기판에 존 띠를 1회 추가 */
  function render(root) {
    var scope = root || document;
    var paths = scope.querySelectorAll('path[d="' + BG_D + '"]');
    for (var i = 0; i < paths.length; i++) {
      var bg = paths[i];
      if (!isGaugeBg(bg)) continue;
      var svg = bg.ownerSVGElement || bg.parentNode;
      if (!svg || (svg.querySelector && svg.querySelector('.stelvio-gauge-zone-bands'))) continue;
      if (svg.getAttribute && svg.getAttribute('data-no-zone-bands')) continue; // 속도계(아웃도어 라이딩) 등 파워 존이 아닌 계기판
      var bands = buildBands(bg.namespaceURI || 'http://www.w3.org/2000/svg');
      bg.parentNode.insertBefore(bands, bg.nextSibling);
      if (svg.ownerSVGElement == null) {
        watchSvg(svg);
        watchNeedle(svg, bands);
        watchLapMarker(svg);
      }
    }
  }

  window.stelvioRenderGaugeZoneBands = render;

  /* 목표값 원호(및 존 상한 원호)는 두께 = 존 띠의 60%(7.2) — 바깥·안쪽 2.4씩 존 색상이 보여
     존 영역과 목표 원호가 함께 구분돼 보인다(2026-10-18). 화면마다 원호를 따로 만들므로 CSS 로 일괄 적용
     (CSS stroke-width 가 SVG 속성 stroke-width="12" 보다 우선). id 끝이 gauge-target-arc / gauge-max-arc 인 원호 대상
     (laptop-, mobile-, indiv-, coachm-, bluetoothIndividual.html 의 접두사 없는 id). */
  (function injectTargetArcStyle() {
    if (document.getElementById('stelvio-gauge-zone-style')) return;
    var st = document.createElement('style');
    st.id = 'stelvio-gauge-zone-style';
    st.textContent =
      'path[id$="gauge-target-arc"], path[id$="gauge-max-arc"], path.' + UNDERLAY_CLASS + ' { stroke-width: ' + TARGET_ARC_WIDTH + 'px; }';
    (document.head || document.documentElement).appendChild(st);
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(); });
  } else {
    render();
  }
})();
