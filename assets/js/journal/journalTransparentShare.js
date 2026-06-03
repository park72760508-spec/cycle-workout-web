/**
 * 투명 배경 + 순백색 코스/고도/요약 텍스트 PNG보내기 (오프스크린 SVG → Canvas)
 * @global window.journalTransparentShare
 */
(function (global) {
  'use strict';

  var utils = global.stravaPolylineUtils;
  var KOR_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

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

  function logSortKeyForTitle(log) {
    if (!log) return 0;
    var t = log.start_time || log.start_date_local || log.start_date;
    if (t) {
      var ms = Date.parse(String(t));
      if (!isNaN(ms)) return ms;
    }
    var aid = Number(log.activity_id || 0);
    return isFinite(aid) ? aid : 0;
  }

  function stravaRideTitlesFromLogs(logs) {
    if (!logs || !logs.length) return '';
    var sorted = logs.slice().sort(function (a, b) {
      return logSortKeyForTitle(a) - logSortKeyForTitle(b);
    });
    var seen = {};
    var parts = [];
    var i, title;
    for (i = 0; i < sorted.length; i++) {
      title = sorted[i].title != null ? String(sorted[i].title).trim() : '';
      if (!title || seen[title]) continue;
      seen[title] = true;
      parts.push(title);
    }
    return parts.join(' · ');
  }

  /** 예: 2026년 6월 3일(수) · Morning Ride */
  function formatShareImageTitle(log, logs) {
    if (!log) return 'STELVIO Ride';
    var shareLogs = logs || log._logsForShare || null;
    if (!shareLogs || !shareLogs.length) shareLogs = [log];

    var dateKey = log.date ? String(log.date) : '';
    var datePart = '';
    if (dateKey.length >= 10) {
      var p = dateKey.split('-');
      var y = parseInt(p[0], 10);
      var m = parseInt(p[1], 10);
      var d = parseInt(p[2], 10);
      if (isFinite(y) && isFinite(m) && isFinite(d)) {
        var dow = new Date(y, m - 1, d).getDay();
        datePart = y + '년 ' + m + '월 ' + d + '일(' + KOR_WEEKDAY[dow] + ')';
      }
    }

    var titles = stravaRideTitlesFromLogs(shareLogs);
    if (!titles && log.title) titles = String(log.title).trim();
    if (datePart && titles) return datePart + ' · ' + titles;
    if (datePart) return datePart;
    return titles || 'STELVIO Ride';
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
    var logs = opts.logs || log._logsForShare || null;
    var route =
      log._routeProfileMerged ||
      (logs && typeof utils.routeProfileFromLogs === 'function'
        ? utils.routeProfileFromLogs(logs)
        : utils.routeProfileFromLog(log));
    var coursePaths = [];
    var si, segPath;
    if (route.segments && route.segments.length) {
      for (si = 0; si < route.segments.length; si++) {
        segPath = utils.latLngsToSvgPath(route.segments[si], w - 120, 520, 0.12);
        if (segPath.pathD) coursePaths.push(segPath.pathD);
      }
    } else if (route.hasRoute && route.latlngs && route.latlngs.length >= 2) {
      segPath = utils.latLngsToSvgPath(route.latlngs, w - 120, 520, 0.12);
      if (segPath.pathD) coursePaths.push(segPath.pathD);
    }
    var elev = route.hasElevation
      ? utils.elevationToSvgPath(route.elevation, w - 120, 200, 0.1)
      : null;
    var lines = summaryLinesFromLog(log);
    var title = formatShareImageTitle(log, logs).slice(0, 96);
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
    for (si = 0; si < coursePaths.length; si++) {
      shapes +=
        '<g transform="translate(60, ' +
        (h - 780) +
        ')"><path d="' +
        coursePaths[si] +
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

  function isMobileDevice() {
    if (typeof global.isMobile === 'function' && global.isMobile()) return true;
    return /Android|iPhone|iPad|iPod/i.test((global.navigator && global.navigator.userAgent) || '');
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /** iOS/Android 네이티브 WebView 브릿지(있을 때만) */
  function tryNativeSaveImageToGallery(blob, filename) {
    var wh = global.webkit && global.webkit.messageHandlers;
    if (!wh) return Promise.resolve(false);
    var handlers = [
      'saveImageToGallery',
      'saveImage',
      'saveToPhotos',
      'stelvioSaveImage',
    ];
    return blobToDataUrl(blob).then(function (dataUrl) {
      var i, name, h;
      for (i = 0; i < handlers.length; i++) {
        name = handlers[i];
        h = wh[name];
        if (!h || typeof h.postMessage !== 'function') continue;
        try {
          h.postMessage({ dataUrl: dataUrl, filename: filename, mimeType: 'image/png' });
          return true;
        } catch (e1) {
          try {
            h.postMessage(dataUrl);
            return true;
          } catch (e2) {}
        }
      }
      return false;
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

  function notifySaveResult(result) {
    if (typeof global.showToast !== 'function') return;
    if (result === 'native' || result === 'share') {
      global.showToast('사진 보관함에 저장했습니다.', 'success');
    } else if (result === 'download-mobile') {
      global.showToast(
        '이미지가 저장되었습니다. 갤러리·사진 앱에서 확인해 주세요.',
        'success'
      );
    } else if (result === 'download') {
      global.showToast('이미지가 다운로드되었습니다.', 'success');
    }
  }

  /**
   * 모바일: 공유 시트 → 「사진에 저장」 / 갤러리 앱 선택
   * PC: 파일 다운로드
   */
  function savePngBlob(blob, filename) {
    var mobile = isMobileDevice();
    var file =
      typeof File !== 'undefined'
        ? new File([blob], filename, { type: 'image/png' })
        : null;

    if (mobile) {
      return tryNativeSaveImageToGallery(blob, filename).then(function (nativeOk) {
        if (nativeOk) return 'native';

        if (
          file &&
          global.navigator &&
          typeof global.navigator.share === 'function' &&
          typeof global.navigator.canShare === 'function'
        ) {
          try {
            if (global.navigator.canShare({ files: [file] })) {
              return global.navigator
                .share({
                  files: [file],
                  title: 'STELVIO Ride',
                })
                .then(function () {
                  return 'share';
                });
            }
          } catch (shareErr) {
            if (shareErr && shareErr.name === 'AbortError') {
              return Promise.reject(shareErr);
            }
          }
        }

        downloadBlob(blob, filename);
        return 'download-mobile';
      });
    }

    downloadBlob(blob, filename);
    return Promise.resolve('download');
  }

  /**
   * @param {object} log
   * @param {{ filename?: string, logs?: Array }} [opts]
   * @returns {Promise<{ blob: Blob, saveMethod: string }>}
   */
  async function exportTransparentSharePng(log, opts) {
    opts = opts || {};
    if (log && log._logsForShare && !opts.logs) opts.logs = log._logsForShare;
    var svg = buildShareSvgMarkup(log, opts);
    if (!svg) throw new Error('코스 데이터가 없어 공유 이미지를 만들 수 없습니다.');
    var blob = await svgToPngBlob(svg);
    var dateKey = log.date ? String(log.date).replace(/-/g, '') : 'ride';
    var fn = opts.filename || 'stelvio-ride-' + dateKey + '-transparent.png';
    var saveMethod = await savePngBlob(blob, fn);
    notifySaveResult(saveMethod);
    return { blob: blob, saveMethod: saveMethod };
  }

  global.journalTransparentShare = {
    formatShareImageTitle: formatShareImageTitle,
    buildShareSvgMarkup: buildShareSvgMarkup,
    exportTransparentSharePng: exportTransparentSharePng,
  };
})(typeof window !== 'undefined' ? window : global);
