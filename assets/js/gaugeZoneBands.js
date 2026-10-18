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
      p.setAttribute('stroke-width', '12');
      // 양 끝만 둥글게(회색 배경과 같은 모양), 존 경계는 맞닿게
      p.setAttribute('stroke-linecap', i === 0 || i === ZONES.length - 1 ? 'round' : 'butt');
      g.appendChild(p);
    });
    return g;
  }

  function isGaugeBg(path) {
    var stroke = String(path.getAttribute('stroke') || '').toLowerCase();
    return path.getAttribute('d') === BG_D && (stroke === '#333' || stroke === '#333333') && String(path.getAttribute('stroke-width')) === '12';
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
      var bands = buildBands(bg.namespaceURI || 'http://www.w3.org/2000/svg');
      bg.parentNode.insertBefore(bands, bg.nextSibling);
    }
  }

  window.stelvioRenderGaugeZoneBands = render;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(); });
  } else {
    render();
  }
})();
