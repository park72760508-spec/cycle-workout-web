/**
 * 투명 배경 + 순백색 코스/고도/요약 텍스트 PNG보내기 (오프스크린 SVG → Canvas)
 * @global window.journalTransparentShare
 */
(function (global) {
  'use strict';

  var utils = global.stravaPolylineUtils;
  var KOR_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

  /** 오버레이 레이아웃 (1080×1350) — 상단 로고·제목, 하단 맵·통계 */
  var SHARE_PAD_X = 48;
  var SHARE_LOGO_TOP_Y = 24;
  var SHARE_LOGO_MEASURE_FONT = 36;
  var SHARE_SUB_GAP_BELOW_LOGO = 14;
  var SHARE_TITLE_GAP_BELOW_SUB = 44;
  var SHARE_COURSE_W = 984;
  var SHARE_COURSE_H = 480;
  var SHARE_COURSE_GAP_ABOVE_STATS = 36;
  var SHARE_STATS_LABEL_Y = 1070;
  var SHARE_STATS_VALUE_Y = 1130;
  /** 상단(제목) / 하단(맵+통계) 분리선 */
  var SHARE_SPLIT_Y = 520;
  var SHARE_BOTTOM_CANVAS_H = 1350 - SHARE_SPLIT_Y;
  var SHARE_FONT_SUB = 28;
  var SHARE_FONT_TITLE = 48;
  var SHARE_FONT_LABEL = 26;
  var SHARE_FONT_VALUE = 68;
  var SHARE_FONT_UNIT = 26;
  var STELVIO_LOGO_ASSET = 'assets/img/stelvio_w.png';
  /* Druk Wide: assets/fonts/DrukWide-Bold.woff2 배포 후 @font-face 추가 시 스택 맨 앞에 "Druk Wide" 삽입 */
  var FONT_LATIN_STACK = '"Bebas Neue", sans-serif';
  var FONT_KOREAN_STACK = 'Pretendard, "Noto Sans KR", sans-serif';

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

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** TIME 표시: 시:분 만 (예: 3:41, 0:52) */
  function formatDurationClock(sec) {
    if (sec == null || !isFinite(Number(sec)) || Number(sec) <= 0) {
      return { value: '-', unit: '' };
    }
    var s = Math.floor(Number(sec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return { value: h + ':' + pad2(m), unit: '' };
  }

  function formatShareHeaderSub(log) {
    var dateKey = log.date ? String(log.date) : '';
    if (dateKey.length >= 10) {
      var p = dateKey.split('-');
      var y = parseInt(p[0], 10);
      var mo = parseInt(p[1], 10);
      var d = parseInt(p[2], 10);
      if (isFinite(y) && isFinite(mo) && isFinite(d)) {
        var dow = new Date(y, mo - 1, d).getDay();
        return (
          y +
          '. ' +
          (mo < 10 ? '0' : '') +
          mo +
          '. ' +
          (d < 10 ? '0' : '') +
          d +
          ' (' +
          KOR_WEEKDAY[dow] +
          ')'
        );
      }
    }
    return '';
  }

  function formatShareHeaderTitle(log, logs) {
    var shareLogs = logs && logs.length ? logs : log._logsForShare || [log];
    var titles = stravaRideTitlesFromLogs(shareLogs);
    if (!titles && log.title) titles = String(log.title).trim();
    return (titles || 'STELVIO RIDE').slice(0, 64);
  }

  /** 맵 하단: 라벨(작게) + 값(크게) + 단위(작게) */
  function shareStatCellsFromLog(log) {
    if (!log) return [];
    var dist = log.distance_km != null ? Number(log.distance_km) : 0;
    var sec =
      Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) || 0;
    var elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
    var spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
    if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
      spd = Math.round((dist / (sec / 3600)) * 10) / 10;
    }
    var time = formatDurationClock(sec);
    return [
      {
        label: 'DISTANCE',
        value: dist > 0 ? dist.toFixed(1) : '-',
        unit: dist > 0 ? 'km' : '',
      },
      { label: 'TIME', value: time.value, unit: time.unit },
      {
        label: 'SPEED',
        value: spd != null && spd > 0 ? spd.toFixed(1) : '-',
        unit: spd != null && spd > 0 ? 'km/h' : '',
      },
      {
        label: 'ELEVATION',
        value: elev != null && elev > 0 ? String(Math.round(elev)) : '-',
        unit: elev != null && elev > 0 ? 'm' : '',
      },
    ];
  }

  function speedLineTextFromLog(log) {
    var cells = shareStatCellsFromLog(log);
    var i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i].label === 'SPEED') {
        return cells[i].unit ? cells[i].value + ' ' + cells[i].unit : cells[i].value;
      }
    }
    return '-';
  }

  /** 변경 전과 동일: 속도 요약 줄(36px Bebas) 너비로 로고 가로 크기 */
  function measureShareLogoWidth(log) {
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    if (!ctx) return 200;
    ctx.font = canvasFontForToken('lat', SHARE_LOGO_MEASURE_FONT);
    return ctx.measureText(speedLineTextFromLog(log)).width;
  }

  function shareCourseY() {
    return SHARE_STATS_LABEL_Y - SHARE_COURSE_GAP_ABOVE_STATS - SHARE_COURSE_H;
  }

  function summaryLinesFromLog(log) {
    var cells = shareStatCellsFromLog(log);
    var out = [];
    var i;
    for (i = 0; i < cells.length; i++) {
      out.push(
        cells[i].unit ? cells[i].value + ' ' + cells[i].unit : cells[i].value
      );
    }
    return out;
  }

  /** 요약 지도와 동일 소스(logs + daily_route_profiles)로 코스 프로파일 계산 */
  function resolveRouteProfileForShare(log, opts) {
    opts = opts || {};
    if (!utils || !log) return null;
    var logs = opts.logs || log._logsForShare || null;
    var dailyDoc = opts.dailyRouteDoc || null;
    if (logs && logs.length && typeof utils.routeProfileFromLogs === 'function') {
      return utils.routeProfileFromLogs(logs, dailyDoc);
    }
    if (log._routeProfileMerged && log._routeProfileMerged.segments && log._routeProfileMerged.segments.length) {
      return log._routeProfileMerged;
    }
    return utils.routeProfileFromLog(utils.normalizeLogRouteFields(log));
  }

  /** 다구간 시 flatten latlngs(활동 사이 직선) 사용 금지 */
  function coursePathStringsFromRoute(route, viewW, viewH, padRatio) {
    if (!utils || !route) return [];
    var segs = route.segments;
    var out = [];
    var si, drawn;
    if (segs && segs.length > 0 && typeof utils.latLngSegmentsToSvgPaths === 'function') {
      drawn = utils.latLngSegmentsToSvgPaths(segs, viewW, viewH, padRatio);
      for (si = 0; si < drawn.length; si++) {
        if (drawn[si].pathD) out.push(drawn[si].pathD);
      }
      return out;
    }
    if (segs && segs.length > 0) {
      for (si = 0; si < segs.length; si++) {
        drawn = utils.latLngsToSvgPath(segs[si], viewW, viewH, padRatio);
        if (drawn.pathD) out.push(drawn.pathD);
      }
      return out;
    }
    if ((route.segmentCount || 0) > 1) return [];
    if (route.hasRoute && route.latlngs && route.latlngs.length >= 2) {
      drawn = utils.latLngsToSvgPath(route.latlngs, viewW, viewH, padRatio);
      if (drawn.pathD) out.push(drawn.pathD);
    }
    return out;
  }

  function buildShareSvgMarkup(log, opts) {
    opts = opts || {};
    var w = opts.width || 1080;
    var h = opts.height || 1350;
    if (!utils || !log) return '';
    var route = resolveRouteProfileForShare(log, opts);
    if (!route) return '';
    var coursePaths = coursePathStringsFromRoute(route, SHARE_COURSE_W, SHARE_COURSE_H, 0.1);
    var courseX = (w - SHARE_COURSE_W) / 2;
    var si;
    var shapes =
      '<defs><filter id="stelvioRouteShadow" x="-25%" y="-25%" width="150%" height="150%">' +
      '<feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#000000" flood-opacity="0.5"/></filter></defs>';
    for (si = 0; si < coursePaths.length; si++) {
      shapes +=
        '<g transform="translate(' +
        courseX +
        ', ' +
        shareCourseY() +
        ')" filter="url(#stelvioRouteShadow)"><path d="' +
        coursePaths[si] +
        '" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>';
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
      '</svg>'
    );
  }

  function isKoreanChar(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e);
  }

  function isLatinOrDigitChar(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  }

  function tokenizeShareText(text) {
    var s = String(text || '');
    var tokens = [];
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (isLatinOrDigitChar(ch)) {
        var j = i + 1;
        while (j < s.length) {
          var cj = s.charAt(j);
          if (
            isLatinOrDigitChar(cj) ||
            cj === '.' ||
            cj === ',' ||
            cj === '/' ||
            cj === '-' ||
            cj === '+' ||
            cj === ':'
          ) {
            j++;
          } else break;
        }
        tokens.push({ kind: 'lat', text: s.slice(i, j) });
        i = j;
      } else if (isKoreanChar(ch)) {
        var jk = i + 1;
        while (jk < s.length && isKoreanChar(s.charAt(jk))) jk++;
        tokens.push({ kind: 'ko', text: s.slice(i, jk) });
        i = jk;
      } else {
        tokens.push({ kind: 'ko', text: ch });
        i++;
      }
    }
    return tokens;
  }

  function canvasFontForToken(kind, fontSize) {
    var weight = kind === 'lat' ? '700' : '600';
    var stack = kind === 'lat' ? FONT_LATIN_STACK : FONT_KOREAN_STACK;
    return weight + ' ' + fontSize + 'px ' + stack;
  }

  function applyTextShadow(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#FFFFFF';
  }

  function clearTextShadow(ctx) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawCanvasTextLine(ctx, x, y, text, fontSize, align) {
    var tokens = tokenizeShareText(text);
    var ti;
    var totalW = 0;
    var parts = [];
    ctx.textBaseline = 'alphabetic';
    applyTextShadow(ctx);
    for (ti = 0; ti < tokens.length; ti++) {
      ctx.font = canvasFontForToken(tokens[ti].kind, fontSize);
      parts.push({
        text: tokens[ti].text,
        w: ctx.measureText(tokens[ti].text).width,
        kind: tokens[ti].kind,
      });
      totalW += parts[parts.length - 1].w;
    }
    var cx = align === 'center' ? x - totalW / 2 : x;
    for (ti = 0; ti < parts.length; ti++) {
      ctx.font = canvasFontForToken(parts[ti].kind, fontSize);
      ctx.fillText(parts[ti].text, cx, y);
      cx += parts[ti].w;
    }
    clearTextShadow(ctx);
  }

  function drawValueUnitCentered(ctx, cx, y, value, unit) {
    applyTextShadow(ctx);
    ctx.textBaseline = 'alphabetic';
    ctx.font = canvasFontForToken('lat', SHARE_FONT_VALUE);
    var valueW = ctx.measureText(String(value || '-')).width;
    var unitW = 0;
    if (unit) {
      ctx.font = canvasFontForToken('lat', SHARE_FONT_UNIT);
      unitW = ctx.measureText(unit).width;
    }
    var gap = unit ? 5 : 0;
    var totalW = valueW + gap + unitW;
    var startX = cx - totalW / 2;
    ctx.font = canvasFontForToken('lat', SHARE_FONT_VALUE);
    ctx.fillText(String(value || '-'), startX, y);
    if (unit) {
      ctx.font = canvasFontForToken('lat', SHARE_FONT_UNIT);
      ctx.fillText(unit, startX + valueW + gap, y - 8);
    }
    clearTextShadow(ctx);
  }

  function drawStatCellCentered(ctx, cx, cell, yOffset) {
    yOffset = yOffset || 0;
    ctx.globalAlpha = 0.72;
    drawCanvasTextLine(
      ctx,
      cx,
      SHARE_STATS_LABEL_Y - yOffset,
      cell.label,
      SHARE_FONT_LABEL,
      'center'
    );
    ctx.globalAlpha = 1;
    drawValueUnitCentered(ctx, cx, SHARE_STATS_VALUE_Y - yOffset, cell.value, cell.unit);
  }

  function drawShareHeaderOnCanvas(ctx, log, logs, logoImg) {
    if (!ctx || !log) return;
    var canvasW = ctx.canvas.width || 1080;
    var cx = canvasW / 2;
    var sub = formatShareHeaderSub(log);
    var title = formatShareHeaderTitle(log, logs);
    var logoBottomY = SHARE_LOGO_TOP_Y;
    if (logoImg) logoBottomY = drawShareLogoTop(ctx, log, logoImg);
    var subY = logoBottomY + SHARE_SUB_GAP_BELOW_LOGO;
    var titleY = subY + SHARE_TITLE_GAP_BELOW_SUB;
    if (sub) {
      ctx.globalAlpha = 0.78;
      drawCanvasTextLine(ctx, cx, subY, sub, SHARE_FONT_SUB, 'center');
      ctx.globalAlpha = 1;
    }
    drawCanvasTextLine(ctx, cx, titleY, title, SHARE_FONT_TITLE, 'center');
  }

  function drawShareBottomOnCanvas(ctx, log, logs, svgImg) {
    if (!ctx || !log) return;
    var canvasW = ctx.canvas.width || 1080;
    if (svgImg) {
      ctx.drawImage(svgImg, 0, -SHARE_SPLIT_Y, canvasW, 1350);
    }
    var cells = shareStatCellsFromLog(log);
    var cols = cells.length;
    var totalW = canvasW - SHARE_PAD_X * 2;
    var colW = totalW / cols;
    var i;
    for (i = 0; i < cols; i++) {
      drawStatCellCentered(ctx, SHARE_PAD_X + colW * i + colW / 2, cells[i], SHARE_SPLIT_Y);
    }
  }

  function drawShareTextOnCanvas(ctx, log, logs, logoBottomY) {
    if (!ctx || !log) return;
    drawShareHeaderOnCanvas(ctx, log, logs, null);
    if (logoBottomY != null) {
      /* full 캔버스 합본용 — 로고는 drawShareLogoTop 별도 호출 */
    }
  }

  function ensureShareFontsLoaded() {
    if (!global.document || !global.document.fonts || typeof global.document.fonts.load !== 'function') {
      return Promise.resolve();
    }
    return Promise.all([
      global.document.fonts.load('700 ' + SHARE_FONT_VALUE + 'px ' + FONT_LATIN_STACK),
      global.document.fonts.load('700 ' + SHARE_FONT_UNIT + 'px ' + FONT_LATIN_STACK),
      global.document.fonts.load('600 ' + SHARE_FONT_TITLE + 'px ' + FONT_KOREAN_STACK),
      global.document.fonts.load('600 ' + SHARE_FONT_SUB + 'px ' + FONT_KOREAN_STACK),
    ]).catch(function () {});
  }

  function resolveStelvioLogoAssetUrl() {
    if (global.STELVIO_SHARE_LOGO_URL) return String(global.STELVIO_SHARE_LOGO_URL);
    try {
      return new URL(STELVIO_LOGO_ASSET, global.location.href).href;
    } catch (e) {
      return STELVIO_LOGO_ASSET;
    }
  }

  function loadRasterImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      var u = String(src || '');
      if (u.indexOf('blob:') !== 0 && u.indexOf('data:') !== 0) {
        im.crossOrigin = 'anonymous';
      }
      im.onload = function () {
        resolve(im);
      };
      im.onerror = function () {
        reject(new Error('로고 이미지 로드 실패'));
      };
      im.src = src;
    });
  }

  function loadSvgMarkupAsImage(svgMarkup) {
    return new Promise(function (resolve, reject) {
      var svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('SVG 이미지 로드 실패'));
      };
      img.src = url;
    });
  }

  /** 상단: 날짜 바로 위, 속도 줄 너비와 동일한 로고 크기 */
  function drawShareLogoTop(ctx, log, logoImg) {
    if (!ctx || !logoImg || !logoImg.width) return SHARE_LOGO_TOP_Y;
    var logoW = measureShareLogoWidth(log);
    if (!(logoW > 0)) logoW = 200;
    var logoH = (logoImg.height / logoImg.width) * logoW;
    var canvasW = ctx.canvas.width || 1080;
    var logoX = (canvasW - logoW) / 2;
    ctx.drawImage(logoImg, logoX, SHARE_LOGO_TOP_Y, logoW, logoH);
    return SHARE_LOGO_TOP_Y + logoH;
  }

  function canvasToPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('PNG 변환 실패'));
        },
        'image/png',
        1
      );
    });
  }

  function renderHeaderOverlayBlob(log, logs, logoImg) {
    var canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = SHARE_SPLIT_Y;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShareHeaderOnCanvas(ctx, log, logs, logoImg);
    return canvasToPngBlob(canvas);
  }

  function renderBottomOverlayBlob(log, logs, svgImg) {
    var canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = SHARE_BOTTOM_CANVAS_H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShareBottomOnCanvas(ctx, log, logs, svgImg);
    return canvasToPngBlob(canvas);
  }

  /** 상단(제목) + 하단(맵·통계) 투명 PNG 2장 */
  async function createOverlayPngBlobs(log, opts) {
    opts = opts || {};
    if (log && log._logsForShare && !opts.logs) opts.logs = log._logsForShare;
    if (opts.dailyRouteDoc == null && log && log._dailyRouteDoc) {
      opts.dailyRouteDoc = log._dailyRouteDoc;
    }
    var svg = buildShareSvgMarkup(log, opts);
    if (!svg) throw new Error('코스 데이터가 없어 공유 이미지를 만들 수 없습니다.');
    var shareLogs = opts.logs || log._logsForShare || null;
    var logoUrl = resolveStelvioLogoAssetUrl();
    await ensureShareFontsLoaded();
    var parts = await Promise.all([
      loadSvgMarkupAsImage(svg),
      loadRasterImage(logoUrl).catch(function () {
        return null;
      }),
    ]);
    var svgImg = parts[0];
    var logoImg = parts[1];
    var blobs = await Promise.all([
      renderHeaderOverlayBlob(log, shareLogs, logoImg),
      renderBottomOverlayBlob(log, shareLogs, svgImg),
    ]);
    return {
      headerBlob: blobs[0],
      bottomBlob: blobs[1],
      splitMeta: {
        fullW: 1080,
        headerH: SHARE_SPLIT_Y,
        bottomH: SHARE_BOTTOM_CANVAS_H,
      },
    };
  }

  /** SVG(코스) + Canvas 텍스트·로고 → PNG (단일, export용) */
  function svgToPngBlob(svgMarkup, _speedLineText, log, logs) {
    var logoUrl = resolveStelvioLogoAssetUrl();
    return ensureShareFontsLoaded().then(function () {
      return Promise.all([
        loadSvgMarkupAsImage(svgMarkup),
        loadRasterImage(logoUrl).catch(function () {
          return null;
        }),
      ]);
    }).then(function (parts) {
      var svgImg = parts[0];
      var logoImg = parts[1];
      var canvas = document.createElement('canvas');
      canvas.width = svgImg.width || 1080;
      canvas.height = svgImg.height || 1350;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(svgImg, 0, 0);
      drawShareHeaderOnCanvas(ctx, log, logs, logoImg);
      drawShareBottomOnCanvas(ctx, log, logs, svgImg);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('PNG 변환 실패'));
          },
          'image/png',
          1
        );
      });
    });
  }

  function isMobileDevice() {
    if (typeof global.isMobile === 'function' && global.isMobile()) return true;
    return /Android|iPhone|iPad|iPod/i.test((global.navigator && global.navigator.userAgent) || '');
  }

  function isIOSDevice() {
    var ua = (global.navigator && global.navigator.userAgent) || '';
    return (
      /iPad|iPhone|iPod/i.test(ua) ||
      ((global.navigator && global.navigator.platform === 'MacIntel') &&
        (global.navigator.maxTouchPoints || 0) > 1)
    );
  }

  function isAndroidDevice() {
    return /Android/i.test((global.navigator && global.navigator.userAgent) || '');
  }

  function canShareFiles(file) {
    if (!file || !global.navigator || typeof global.navigator.canShare !== 'function') {
      return false;
    }
    try {
      return global.navigator.canShare({ files: [file] });
    } catch (eCan) {
      return false;
    }
  }

  /**
   * Android / iOS: 공유 시트 (파일만 — text 포함 시 일부 기기에서 무반응)
   * @returns {Promise<'share'|null>}
   */
  function shareFileWithUserPicker(file, meta) {
    meta = meta || {};
    if (!file || !global.navigator || typeof global.navigator.share !== 'function') {
      return Promise.resolve(null);
    }
    var payload = { files: [file] };
    if (
      global.navigator.canShare &&
      typeof global.navigator.canShare === 'function' &&
      !canShareFiles(file) &&
      !isAndroidDevice()
    ) {
      return Promise.resolve(null);
    }
    return global.navigator
      .share(payload)
      .then(function () {
        return 'share';
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return Promise.reject(e);
        return null;
      });
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

  /** Android WebView: AndroidBridge / ReactNativeWebView (동기 호출 가능한 경우만) */
  function tryNativeSaveImageAndroid(blob, filename) {
    return blobToDataUrl(blob).then(function (dataUrl) {
      try {
        var and = global.AndroidBridge || global.Android || global.StelvioAndroid;
        if (and && typeof and.saveImageToGallery === 'function') {
          and.saveImageToGallery(dataUrl, filename);
          return true;
        }
        if (and && typeof and.saveImage === 'function') {
          and.saveImage(dataUrl, filename);
          return true;
        }
        if (and && typeof and.saveImageToPhotos === 'function') {
          and.saveImageToPhotos(dataUrl, filename);
          return true;
        }
      } catch (eAnd) {}

      if (
        global.ReactNativeWebView &&
        typeof global.ReactNativeWebView.postMessage === 'function'
      ) {
        try {
          global.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: 'SAVE_IMAGE',
              dataUrl: dataUrl,
              filename: filename,
              mimeType: (blob && blob.type) || 'image/jpeg',
            })
          );
        } catch (eRn) {}
      }
      return false;
    });
  }

  /**
   * Android: 공유 API 실패 시 — 미리보기 + 「공유·저장」버튼(사용자 탭 = 새 제스처)
   * @returns {Promise<'share-android'|'android-open'>}
   */
  function openAndroidImageSaveSheet(blob, filename) {
    return new Promise(function (resolve, reject) {
      var doc = global.document;
      if (!doc || !doc.body) {
        reject(new Error('저장 화면을 표시할 수 없습니다.'));
        return;
      }
      var url = URL.createObjectURL(blob);
      var overlay = doc.createElement('div');
      overlay.className = 'journal-android-save-sheet';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      var panel = doc.createElement('div');
      panel.className = 'journal-android-save-sheet__panel';

      var title = doc.createElement('p');
      title.className = 'journal-android-save-sheet__title';
      title.textContent = '이미지 저장·공유';

      var img = doc.createElement('img');
      img.className = 'journal-android-save-sheet__preview';
      img.src = url;
      img.alt = '저장할 라이딩 이미지';

      var hint = doc.createElement('p');
      hint.className = 'journal-android-save-sheet__hint';
      hint.textContent =
        '「공유·저장」을 누른 뒤 갤러리·파일·드라이브 등 원하는 앱을 선택하세요.';

      function cleanup() {
        URL.revokeObjectURL(url);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      function shareFromUserTap() {
        var mime = (blob && blob.type) || 'image/jpeg';
        var file =
          typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : null;
        if (file && global.navigator && typeof global.navigator.share === 'function') {
          global.navigator
            .share({ files: [file] })
            .then(function () {
              cleanup();
              resolve('share-android');
            })
            .catch(function (eShare) {
              if (eShare && eShare.name === 'AbortError') return;
              openBlobForAndroidView(url, filename);
              cleanup();
              resolve('android-open');
            });
          return;
        }
        openBlobForAndroidView(url, filename);
        cleanup();
        resolve('android-open');
      }

      var shareBtn = doc.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'journal-android-save-sheet__btn journal-android-save-sheet__btn--primary';
      shareBtn.textContent = '공유·저장';
      shareBtn.addEventListener('click', shareFromUserTap);

      var closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'journal-android-save-sheet__btn journal-android-save-sheet__btn--ghost';
      closeBtn.textContent = '닫기';
      closeBtn.addEventListener('click', function () {
        cleanup();
        reject(Object.assign(new Error('저장 취소'), { name: 'AbortError' }));
      });

      panel.appendChild(title);
      panel.appendChild(img);
      panel.appendChild(hint);
      panel.appendChild(shareBtn);
      panel.appendChild(closeBtn);
      overlay.appendChild(panel);
      doc.body.appendChild(overlay);
    });
  }

  function openBlobForAndroidView(blobUrl, filename) {
    try {
      var a = global.document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
      global.document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 500);
    } catch (eOpen) {
      try {
        global.open(blobUrl, '_blank');
      } catch (e2) {}
    }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 15000);
  }

  /** PC·Android Chrome: 저장 위치·파일명 선택 (클릭 직후 호출) */
  function requestSaveFileHandle(filename) {
    if (!global.window || typeof global.window.showSaveFilePicker !== 'function') {
      return Promise.resolve(null);
    }
    if (isIOSDevice()) return Promise.resolve(null);
    return global.window
      .showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'JPEG image',
            accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
          },
        ],
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return Promise.reject(e);
        return null;
      });
  }

  function writeBlobToSaveHandle(handle, blob) {
    if (!handle) return Promise.reject(new Error('저장 위치가 선택되지 않았습니다.'));
    return handle.createWritable().then(function (writable) {
      return writable.write(blob).then(function () {
        return writable.close();
      });
    });
  }

  /** @deprecated 내부 호환 — requestSaveFileHandle + writeBlobToSaveHandle 사용 */
  function saveBlobWithFilePicker(blob, filename) {
    return requestSaveFileHandle(filename).then(function (handle) {
      if (!handle) return null;
      return writeBlobToSaveHandle(handle, blob).then(function () {
        return 'save-picker';
      });
    });
  }

  function notifySaveResult(result) {
    if (typeof global.showToast !== 'function') return;
    if (result === 'native' || result === 'share') {
      global.showToast('사진 보관함에 저장했습니다.', 'success');
    } else if (result === 'share-android' || result === 'native-android') {
      global.showToast('선택한 앱·폴더에 저장되었습니다.', 'success');
    } else if (result === 'android-open') {
      global.showToast('이미지를 열었습니다. 갤러리·파일 앱으로 저장해 주세요.', 'info');
    } else if (result === 'save-picker') {
      global.showToast('선택한 위치에 저장했습니다.', 'success');
    } else if (result === 'download-mobile') {
      global.showToast('이미지가 저장되었습니다. 사진 앱에서 확인해 주세요.', 'success');
    } else if (result === 'download') {
      global.showToast('이미지가 다운로드되었습니다.', 'success');
    }
  }

  /** iOS: 네이티브 저장 → 공유 시트 → 다운로드 (기존 동작 유지) */
  function savePngBlobIOS(blob, filename, file) {
    return tryNativeSaveImageToGallery(blob, filename).then(function (nativeOk) {
      if (nativeOk) return 'native';

      if (file) {
        return shareFileWithUserPicker(file, { title: 'STELVIO Ride' }).then(function (shared) {
          if (shared === 'share') return 'share';
          downloadBlob(blob, filename);
          return 'download-mobile';
        });
      }

      downloadBlob(blob, filename);
      return 'download-mobile';
    });
  }

  /**
   * Android 전용: 네이티브 → Web Share → 저장 시트(미리보기+공유 버튼)
   * iOS·PC는 savePngBlob 사용
   */
  function savePngBlobAndroid(blob, filename) {
    var mime = (blob && blob.type) || 'image/jpeg';
    if (mime.indexOf('jpeg') < 0 && mime.indexOf('jpg') < 0) {
      mime = 'image/jpeg';
    }
    var file =
      typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : null;

    return tryNativeSaveImageAndroid(blob, filename).then(function (nativeOk) {
      if (nativeOk) return 'native-android';

      if (file && global.navigator && typeof global.navigator.share === 'function') {
        return shareFileWithUserPicker(file, {}).then(function (shared) {
          if (shared === 'share') return 'share-android';
          return openAndroidImageSaveSheet(blob, filename);
        });
      }

      return openAndroidImageSaveSheet(blob, filename);
    });
  }

  /**
   * iOS: savePngBlobIOS
   * Android: savePngBlobAndroid
   * PC: download (저장 위치는 Composer에서 requestSaveFileHandle 선행)
   */
  function savePngBlob(blob, filename) {
    var mime = (blob && blob.type) || 'image/jpeg';
    if (mime.indexOf('jpeg') < 0 && mime.indexOf('jpg') < 0) {
      mime = 'image/jpeg';
    }
    var file =
      typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : null;

    if (isIOSDevice()) {
      return savePngBlobIOS(blob, filename, file);
    }

    if (isAndroidDevice()) {
      return savePngBlobAndroid(blob, filename);
    }

    if (isMobileDevice() && file) {
      return shareFileWithUserPicker(file, {}).then(function (shared) {
        if (shared === 'share') return 'share';
        return Promise.reject(new Error('공유·저장 창을 열 수 없습니다.'));
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
  async function createOverlayPngBlob(log, opts) {
    opts = opts || {};
    if (log && log._logsForShare && !opts.logs) opts.logs = log._logsForShare;
    if (opts.dailyRouteDoc == null && log && log._dailyRouteDoc) opts.dailyRouteDoc = log._dailyRouteDoc;
    var svg = buildShareSvgMarkup(log, opts);
    if (!svg) throw new Error('코스 데이터가 없어 공유 이미지를 만들 수 없습니다.');
    var summaryLines = summaryLinesFromLog(log);
    var speedLineText = summaryLines[summaryLines.length - 1] || '-';
    var shareLogs = opts.logs || log._logsForShare || null;
    return svgToPngBlob(svg, speedLineText, log, shareLogs);
  }

  function fitContainRect(imgW, imgH, boxW, boxH) {
    if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) {
      return { x: 0, y: 0, width: boxW, height: boxH };
    }
    var s = Math.min(boxW / imgW, boxH / imgH);
    var w = imgW * s;
    var h = imgH * s;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, width: w, height: h };
  }

  /**
   * @param {HTMLImageElement} bgImg
   * @param {HTMLImageElement} overlayImg
   * @param {{ stageW:number, stageH:number, overlayLeft:number, overlayTop:number, overlayW:number, overlayH:number }} layout
   */
  /**
   * 배경 + 상·하단 오버레이 2장 합성
   */
  function compositeShareDualToBlob(bgImg, headerImg, bottomImg, layout) {
    var MAX_OUT = 2048;
    var nw = bgImg.naturalWidth || bgImg.width;
    var nh = bgImg.naturalHeight || bgImg.height;
    var shrink = Math.min(1, MAX_OUT / Math.max(nw, nh, 1));
    var outW = Math.max(1, Math.round(nw * shrink));
    var outH = Math.max(1, Math.round(nh * shrink));

    var stageW = layout.stageW;
    var stageH = layout.stageH;
    var contain = fitContainRect(nw, nh, stageW, stageH);

    function mapRect(left, top, w, h) {
      var relL = (left - contain.x) / contain.width;
      var relT = (top - contain.y) / contain.height;
      var relW = w / contain.width;
      var relH = h / contain.height;
      return {
        x: relL * outW,
        y: relT * outH,
        w: relW * outW,
        h: relH * outH,
      };
    }

    var header = mapRect(
      layout.headerLeft,
      layout.headerTop,
      layout.headerW,
      layout.headerH
    );
    var bottom = mapRect(
      layout.bottomLeft,
      layout.bottomTop,
      layout.bottomW,
      layout.bottomH
    );

    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.drawImage(bgImg, 0, 0, outW, outH);
    if (headerImg && header.w > 0 && header.h > 0) {
      ctx.drawImage(headerImg, header.x, header.y, header.w, header.h);
    }
    if (bottomImg && bottom.w > 0 && bottom.h > 0) {
      ctx.drawImage(bottomImg, bottom.x, bottom.y, bottom.w, bottom.h);
    }

    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('합성 PNG 변환 실패'));
        },
        'image/jpeg',
        0.92
      );
    });
  }

  function compositeShareToBlob(bgImg, overlayImg, layout) {
    var MAX_OUT = 2048;
    var nw = bgImg.naturalWidth || bgImg.width;
    var nh = bgImg.naturalHeight || bgImg.height;
    var shrink = Math.min(1, MAX_OUT / Math.max(nw, nh, 1));
    var outW = Math.max(1, Math.round(nw * shrink));
    var outH = Math.max(1, Math.round(nh * shrink));

    var stageW = layout.stageW;
    var stageH = layout.stageH;
    var contain = fitContainRect(nw, nh, stageW, stageH);

    var relL = (layout.overlayLeft - contain.x) / contain.width;
    var relT = (layout.overlayTop - contain.y) / contain.height;
    var relW = layout.overlayW / contain.width;
    var relH = layout.overlayH / contain.height;

    var drawX = relL * outW;
    var drawY = relT * outH;
    var drawW = relW * outW;
    var drawH = relH * outH;

    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.drawImage(bgImg, 0, 0, outW, outH);
    if (overlayImg && drawW > 0 && drawH > 0) {
      ctx.drawImage(overlayImg, drawX, drawY, drawW, drawH);
    }

    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('합성 PNG 변환 실패'));
        },
        'image/jpeg',
        0.92
      );
    });
  }

  async function exportTransparentSharePng(log, opts) {
    opts = opts || {};
    var dateKey = log.date ? String(log.date).replace(/-/g, '') : 'ride';
    var fn = opts.filename || 'stelvio-ride-' + dateKey + '-transparent.png';
    var saveHandle = null;
    try {
      saveHandle = await requestSaveFileHandle(fn);
    } catch (ePick) {
      if (ePick && ePick.name === 'AbortError') throw ePick;
    }
    var blob = await createOverlayPngBlob(log, opts);
    if (saveHandle) {
      await writeBlobToSaveHandle(saveHandle, blob);
      notifySaveResult('save-picker');
      return { blob: blob, saveMethod: 'save-picker' };
    }
    var saveMethod = await savePngBlob(blob, fn);
    notifySaveResult(saveMethod);
    return { blob: blob, saveMethod: saveMethod };
  }

  var composerRootEl = null;
  var composerRootInstance = null;

  function unmountShareComposer() {
    if (global.document && global.document.documentElement) {
      global.document.documentElement.classList.remove('journal-share-composer-open');
    }
    if (!composerRootEl) return;
    try {
      if (composerRootInstance && composerRootInstance.unmount) composerRootInstance.unmount();
      else if (global.ReactDOM && typeof global.ReactDOM.unmountComponentAtNode === 'function') {
        global.ReactDOM.unmountComponentAtNode(composerRootEl);
      }
    } catch (eUnmount) {}
    composerRootInstance = null;
  }

  function openShareComposer(log, opts) {
    opts = opts || {};
    var React = global.React;
    var ReactDOM = global.ReactDOM;
    var Composer = global.JournalTransparentShareComposer;
    if (!log || !React || !ReactDOM || !Composer) {
      return exportTransparentSharePng(log, opts);
    }
    return new Promise(function (resolve, reject) {
      if (!composerRootEl) {
        composerRootEl = document.createElement('div');
        composerRootEl.id = 'journal-transparent-share-portal';
        document.body.appendChild(composerRootEl);
      }
      function handleClose(result) {
        unmountShareComposer();
        if (result && result.error) reject(result.error);
        else resolve(result || { cancelled: true });
      }
      var el = React.createElement(Composer, {
        log: log,
        opts: opts,
        onClose: handleClose,
      });
      if (ReactDOM.createRoot) {
        if (!composerRootInstance) composerRootInstance = ReactDOM.createRoot(composerRootEl);
        composerRootInstance.render(el);
      } else if (typeof ReactDOM.render === 'function') {
        ReactDOM.render(el, composerRootEl);
      } else {
        reject(new Error('ReactDOM을 사용할 수 없습니다.'));
      }
    });
  }

  function stageDragBounds(stageW, stageH, stickerW, stickerH) {
    var pad = Math.max(stageW, stageH, 480);
    return {
      minX: -pad,
      maxX: stageW - stickerW + pad,
      minY: -pad,
      maxY: stageH - stickerH + pad,
    };
  }

  global.journalTransparentShare = {
    formatShareImageTitle: formatShareImageTitle,
    buildShareSvgMarkup: buildShareSvgMarkup,
    createOverlayPngBlob: createOverlayPngBlob,
    createOverlayPngBlobs: createOverlayPngBlobs,
    compositeShareToBlob: compositeShareToBlob,
    compositeShareDualToBlob: compositeShareDualToBlob,
    fitContainRect: fitContainRect,
    stickerDragBounds: stageDragBounds,
    requestSaveFileHandle: requestSaveFileHandle,
    writeBlobToSaveHandle: writeBlobToSaveHandle,
    savePngBlob: savePngBlob,
    savePngBlobAndroid: savePngBlobAndroid,
    isAndroidDevice: isAndroidDevice,
    notifySaveResult: notifySaveResult,
    exportTransparentSharePng: exportTransparentSharePng,
    openShareComposer: openShareComposer,
    unmountShareComposer: unmountShareComposer,
  };
})(typeof window !== 'undefined' ? window : global);
