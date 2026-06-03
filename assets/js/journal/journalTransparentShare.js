/**
 * 투명 배경 + 순백색 코스/고도/요약 텍스트 PNG보내기 (오프스크린 SVG → Canvas)
 * @global window.journalTransparentShare
 */
(function (global) {
  'use strict';

  var utils = global.stravaPolylineUtils;

  function escapeXml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(sec) {
    if (sec == null || !isFinite(Number(sec))) return '-';
    var s = Math.floor(Number(sec));
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    s = s % 60;
    m = m % 60;
    if (h > 0) return h + '시간 ' + m + '분';
    return m + '분';
  }

  function summaryLinesFromLog(log) {
    if (!log) return [];
    var dist = log.distance_km != null ? Number(log.distance_km) : 0;
    var sec =
      Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) || 0;
    var elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
    var watts = log.avg_watts != null ? Number(log.avg_watts) : null;
    var spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
    if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
      spd = Math.round((dist / (sec / 3600)) * 10) / 10;
    }
    return [
      dist > 0 ? dist.toFixed(1) + ' km' : '-',
      formatDuration(sec),
      elev != null && elev > 0 ? Math.round(elev) + ' m ↑' : '-',
      watts != null && watts > 0 ? Math.round(watts) + ' W' : '-',
      spd != null && spd > 0 ? spd.toFixed(1) + ' km/h' : '-',
    ];
  }

  function buildShareSvgMarkup(log, opts) {
    opts = opts || {};
    var w = opts.width || 1080;
    var h = opts.height || 1350;
    if (!utils || !log) return '';
    var route = utils.routeProfileFromLog(log);
    var course = route.hasRoute ? utils.latLngsToSvgPath(route.latlngs, w - 120, 520, 0.12) : null;
    var elev = route.hasElevation
      ? utils.elevationToSvgPath(route.elevation, w - 120, 200, 0.1)
      : null;
    var lines = summaryLinesFromLog(log);
    var title = log.title ? String(log.title).slice(0, 48) : 'STELVIO Ride';
    var yText = 80;
    var textBlock = '';
    textBlock +=
      '<text x="60" y="' +
      yText +
      '" fill="#FFFFFF" font-size="42" font-weight="700" font-family="system-ui,sans-serif">' +
      escapeXml(title) +
      '</text>';
    var li;
    for (li = 0; li < lines.length; li++) {
      yText += 52;
      textBlock +=
        '<text x="60" y="' +
        yText +
        '" fill="#FFFFFF" font-size="36" font-weight="600" font-family="system-ui,sans-serif">' +
        escapeXml(lines[li]) +
        '</text>';
    }
    var shapes = '';
    if (course && course.pathD) {
      shapes +=
        '<g transform="translate(60, ' +
        (h - 780) +
        ')"><path d="' +
        course.pathD +
        '" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>';
    }
    if (elev && elev.pathD) {
      shapes +=
        '<g transform="translate(60, ' +
        (h - 240) +
        ')"><path d="' +
        elev.pathD +
        '" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>';
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      w +
      '" height="' +
      h +
      '" viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '">' +
      shapes +
      textBlock +
      '</svg>'
    );
  }

  function svgToPngBlob(svgMarkup) {
    return new Promise(function (resolve, reject) {
      var svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.width || 1080;
          canvas.height = img.height || 1350;
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D unavailable');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            function (blob) {
              URL.revokeObjectURL(url);
              if (blob) resolve(blob);
              else reject(new Error('PNG 변환 실패'));
            },
            'image/png',
            1
          );
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('SVG 이미지 로드 실패'));
      };
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 400);
  }

  /**
   * @param {object} log
   * @param {{ filename?: string }} [opts]
   */
  async function exportTransparentSharePng(log, opts) {
    opts = opts || {};
    var svg = buildShareSvgMarkup(log, opts);
    if (!svg) throw new Error('코스 데이터가 없어 공유 이미지를 만들 수 없습니다.');
    var blob = await svgToPngBlob(svg);
    var dateKey = log.date ? String(log.date).replace(/-/g, '') : 'ride';
    var fn = opts.filename || 'stelvio-ride-' + dateKey + '-transparent.png';
    downloadBlob(blob, fn);
    return blob;
  }

  global.journalTransparentShare = {
    buildShareSvgMarkup: buildShareSvgMarkup,
    exportTransparentSharePng: exportTransparentSharePng,
  };
})(typeof window !== 'undefined' ? window : global);
