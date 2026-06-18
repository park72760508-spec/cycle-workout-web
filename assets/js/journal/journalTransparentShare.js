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

  function resolveShareMode(log, opts) {
    opts = opts || {};
    if (opts.shareMode === 'run') return 'run';
    if (log && log._shareMode === 'run') return 'run';
    return 'ride';
  }

  function formatRunPaceCell(distKm, durSec) {
    if (!(distKm > 0 && durSec > 0)) return { value: '-', unit: '' };
    var paceSec = durSec / distKm;
    var runUtils = global.runJournalPrUtils;
    if (runUtils && typeof runUtils.formatPaceFromSpeed === 'function') {
      var paceStr = runUtils.formatPaceFromSpeed(1000 / paceSec);
      if (paceStr && paceStr !== '—') {
        var slash = paceStr.indexOf('/');
        if (slash >= 0) {
          return { value: paceStr.slice(0, slash), unit: paceStr.slice(slash + 1) };
        }
        return { value: paceStr, unit: '' };
      }
    }
    var m = Math.floor(paceSec / 60);
    var s = Math.round(paceSec % 60);
    return { value: m + ':' + (s < 10 ? '0' : '') + s, unit: 'km' };
  }

  function shareStatCellsFromLogForRun(log) {
    if (!log) return [];
    var dist = log.distance_km != null ? Number(log.distance_km) : 0;
    var sec =
      Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) || 0;
    var spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
    if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
      spd = Math.round((dist / (sec / 3600)) * 10) / 10;
    }
    var time = formatDurationClock(sec);
    var pace = formatRunPaceCell(dist, sec);
    return [
      {
        label: '거리',
        value: dist > 0 ? dist.toFixed(1) : '-',
        unit: dist > 0 ? 'km' : '',
      },
      { label: '시간', value: time.value, unit: time.unit },
      { label: '평균 페이스', value: pace.value, unit: pace.unit },
      {
        label: '평균 속도',
        value: spd != null && spd > 0 ? spd.toFixed(1) : '-',
        unit: spd != null && spd > 0 ? 'km/h' : '',
      },
    ];
  }

  function resolveShareVisualKind(log, opts) {
    opts = opts || {};
    if (opts.shareVisualKind === 'workout') return 'workout';
    if (log && log._shareVisualKind === 'workout') return 'workout';
    if (opts.shareVisualKind === 'route' || (log && log._shareVisualKind === 'route')) return 'route';
    var route = resolveRouteProfileForShare(log, opts);
    if (route && route.hasRoute) return 'route';
    if (resolveWorkoutIdForShare(log, opts)) return 'workout';
    return 'route';
  }

  function shareStatCellsFromLogForWorkout(log) {
    if (!log) return [];
    var sec =
      Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) || 0;
    var ap = log.avg_watts != null ? Number(log.avg_watts) : null;
    var hr = log.avg_hr != null ? Number(log.avg_hr) : null;
    var tss = log.tss != null ? Number(log.tss) : null;
    var time = formatDurationClock(sec);
    return [
      { label: '시간', value: time.value, unit: time.unit },
      {
        label: '평균 파워',
        value: ap != null && ap > 0 ? String(Math.round(ap)) : '-',
        unit: ap != null && ap > 0 ? 'W' : '',
      },
      {
        label: '평균 심박',
        value: hr != null && hr > 0 ? String(Math.round(hr)) : '-',
        unit: hr != null && hr > 0 ? 'bpm' : '',
      },
      {
        label: 'TSS',
        value: tss != null && tss > 0 ? String(Math.round(tss)) : '-',
        unit: '',
      },
    ];
  }

  /** 맵 하단: 라벨(작게) + 값(크게) + 단위(작게) */
  function shareStatCellsFromLog(log, opts) {
    if (!log) return [];
    if (resolveShareMode(log, opts) === 'run') {
      return shareStatCellsFromLogForRun(log);
    }
    if (resolveShareVisualKind(log, opts) === 'workout') {
      return shareStatCellsFromLogForWorkout(log);
    }
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

  function speedLineTextFromLog(log, opts) {
    var cells = shareStatCellsFromLog(log, opts);
    var i;
    var mode = resolveShareMode(log, opts);
    var visualKind = resolveShareVisualKind(log, opts);
    var refLabel = 'SPEED';
    if (mode === 'run') refLabel = '평균 속도';
    else if (visualKind === 'workout') refLabel = '평균 파워';
    for (i = 0; i < cells.length; i++) {
      if (cells[i].label === refLabel) {
        return cells[i].unit ? cells[i].value + ' ' + cells[i].unit : cells[i].value;
      }
    }
    return '-';
  }

  /** 변경 전과 동일: 속도 요약 줄(36px Bebas) 너비로 로고 가로 크기 */
  function measureShareLogoWidth(log, opts) {
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    if (!ctx) return 200;
    ctx.font = canvasFontForToken('lat', SHARE_LOGO_MEASURE_FONT);
    return ctx.measureText(speedLineTextFromLog(log, opts)).width;
  }

  function shareCourseY() {
    return SHARE_STATS_LABEL_Y - SHARE_COURSE_GAP_ABOVE_STATS - SHARE_COURSE_H;
  }

  function summaryLinesFromLog(log, opts) {
    var cells = shareStatCellsFromLog(log, opts);
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

  function buildShareSvgMarkupFromPaths(coursePaths, opts) {
    opts = opts || {};
    var w = opts.width || 1080;
    if (!coursePaths || !coursePaths.length) return '';
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
      (opts.height || 1350) +
      '" viewBox="0 0 ' +
      w +
      ' ' +
      (opts.height || 1350) +
      '">' +
      shapes +
      '</svg>'
    );
  }

  function resolveWorkoutIdForShare(log, opts) {
    opts = opts || {};
    if (opts.workoutId) return String(opts.workoutId).trim();
    if (log && log._shareWorkoutId) return String(log._shareWorkoutId).trim();
    var graphUtils = global.journalWorkoutGraphUtils;
    if (graphUtils && typeof graphUtils.resolveWorkoutIdFromLogs === 'function') {
      return graphUtils.resolveWorkoutIdFromLogs(log, opts.logs || (log && log._logsForShare) || null);
    }
    return '';
  }

  async function resolveShareCoursePaths(log, opts) {
    opts = opts || {};
    if (!log) return [];
    var route = resolveRouteProfileForShare(log, opts);
    var coursePaths =
      route && typeof coursePathStringsFromRoute === 'function'
        ? coursePathStringsFromRoute(route, SHARE_COURSE_W, SHARE_COURSE_H, 0.1)
        : [];
    if (coursePaths.length) return coursePaths;

    var workoutId = resolveWorkoutIdForShare(log, opts);
    if (!workoutId) return [];

    var loadFn =
      global.journalWorkoutGraphUtils &&
      typeof global.journalWorkoutGraphUtils.loadWorkoutSegmentsForJournal === 'function'
        ? global.journalWorkoutGraphUtils.loadWorkoutSegmentsForJournal
        : null;
    var buildPath =
      typeof global.buildWorkoutProfilePathForShare === 'function'
        ? global.buildWorkoutProfilePathForShare
        : null;
    if (!loadFn || !buildPath) return [];

    var result = await loadFn(workoutId);
    var segs = (result && result.segments) || [];
    if (!segs.length) return [];
    return buildPath(segs, SHARE_COURSE_W, SHARE_COURSE_H, 0.1);
  }

  async function resolveShareSvgMarkup(log, opts) {
    var coursePaths = await resolveShareCoursePaths(log, opts);
    return buildShareSvgMarkupFromPaths(coursePaths, opts);
  }

  function buildShareSvgMarkup(log, opts) {
    opts = opts || {};
    var w = opts.width || 1080;
    var h = opts.height || 1350;
    if (!utils || !log) return '';
    var route = resolveRouteProfileForShare(log, opts);
    if (!route) return '';
    var coursePaths = coursePathStringsFromRoute(route, SHARE_COURSE_W, SHARE_COURSE_H, 0.1);
    return buildShareSvgMarkupFromPaths(coursePaths, { width: w, height: h });
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

  function drawShareHeaderOnCanvas(ctx, log, logs, logoImg, opts) {
    if (!ctx || !log) return;
    var canvasW = ctx.canvas.width || 1080;
    var cx = canvasW / 2;
    var sub = formatShareHeaderSub(log);
    var title = formatShareHeaderTitle(log, logs);
    var logoBottomY = SHARE_LOGO_TOP_Y;
    if (logoImg) logoBottomY = drawShareLogoTop(ctx, log, logoImg, opts);
    var subY = logoBottomY + SHARE_SUB_GAP_BELOW_LOGO;
    var titleY = subY + SHARE_TITLE_GAP_BELOW_SUB;
    if (sub) {
      ctx.globalAlpha = 0.78;
      drawCanvasTextLine(ctx, cx, subY, sub, SHARE_FONT_SUB, 'center');
      ctx.globalAlpha = 1;
    }
    drawCanvasTextLine(ctx, cx, titleY, title, SHARE_FONT_TITLE, 'center');
  }

  function drawShareBottomOnCanvas(ctx, log, logs, svgImg, opts) {
    if (!ctx || !log) return;
    var canvasW = ctx.canvas.width || 1080;
    if (svgImg) {
      ctx.drawImage(svgImg, 0, -SHARE_SPLIT_Y, canvasW, 1350);
    }
    var cells = shareStatCellsFromLog(log, opts);
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
  function drawShareLogoTop(ctx, log, logoImg, opts) {
    if (!ctx || !logoImg || !logoImg.width) return SHARE_LOGO_TOP_Y;
    var logoW = measureShareLogoWidth(log, opts);
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

  /** 흰색 → 다채 색상 → 검정 (슬라이더 0–360과 동일 스톱) */
  var OVERLAY_COLOR_STOPS = [
    { t: 0, color: '#FFFFFF' },
    { t: 0.12, color: '#FF3B30' },
    { t: 0.24, color: '#FF9500' },
    { t: 0.36, color: '#FFCC00' },
    { t: 0.48, color: '#34C759' },
    { t: 0.6, color: '#007AFF' },
    { t: 0.72, color: '#AF52DE' },
    { t: 0.86, color: '#FF2D55' },
    { t: 1, color: '#1A1A1A' },
  ];

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }

  function rgbToHex(r, g, b) {
    function part(v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }
    return '#' + part(r) + part(g) + part(b);
  }

  function lerpHexColor(c1, c2, f) {
    var a = hexToRgb(c1);
    var b = hexToRgb(c2);
    return rgbToHex(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f);
  }

  /** 슬라이더 0 = 흰색, 1–360 = 다채 그라데이션 색상 */
  function overlayColorFromHue(hue) {
    var h = Math.max(0, Math.min(360, Number(hue) || 0));
    if (h === 0) return '#FFFFFF';
    var t = h / 360;
    var i;
    for (i = 1; i < OVERLAY_COLOR_STOPS.length; i++) {
      if (t <= OVERLAY_COLOR_STOPS[i].t) {
        var t0 = OVERLAY_COLOR_STOPS[i - 1].t;
        var t1 = OVERLAY_COLOR_STOPS[i].t;
        var f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        return lerpHexColor(OVERLAY_COLOR_STOPS[i - 1].color, OVERLAY_COLOR_STOPS[i].color, f);
      }
    }
    return OVERLAY_COLOR_STOPS[OVERLAY_COLOR_STOPS.length - 1].color;
  }

  function overlayStrokeColorForFill(fillColor) {
    var c = String(fillColor || '').toLowerCase();
    if (!c || c === '#ffffff' || c === '#fff') return null;
    var rgb = hexToRgb(c);
    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    if (lum < 0.35) return '#F8FAFC';
    return '#0A0A0A';
  }

  function buildTintedSilhouette(img, fillColor) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = fillColor || '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    return canvas;
  }

  function tintImageToColor(img, color) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!(w > 0 && h > 0)) {
      return Promise.reject(new Error('이미지 크기를 알 수 없습니다.'));
    }
    var fillColor = color || '#FFFFFF';
    var strokeColor = overlayStrokeColorForFill(fillColor);
    var fillLayer = buildTintedSilhouette(img, fillColor);
    if (!fillLayer) return Promise.reject(new Error('Canvas 2D unavailable'));

    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    var ctx = out.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));

    if (strokeColor) {
      var strokeLayer = buildTintedSilhouette(img, strokeColor);
      var strokeW = Math.max(2, Math.round(Math.min(w, h) * 0.0028));
      var ring2 = Math.max(strokeW + 1, Math.round(strokeW * 1.55));
      var dirs = [];
      var a;
      for (a = 0; a < 16; a++) {
        var ang = (a / 16) * Math.PI * 2;
        dirs.push([Math.round(Math.cos(ang) * strokeW), Math.round(Math.sin(ang) * strokeW)]);
      }
      for (a = 0; a < 8; a++) {
        var ang2 = (a / 8) * Math.PI * 2 + Math.PI / 8;
        dirs.push([Math.round(Math.cos(ang2) * ring2), Math.round(Math.sin(ang2) * ring2)]);
      }
      var di;
      for (di = 0; di < dirs.length; di++) {
        ctx.drawImage(strokeLayer, dirs[di][0], dirs[di][1]);
      }
    }

    ctx.drawImage(fillLayer, 0, 0);

    if (strokeColor) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.shadowColor = fillColor;
      ctx.shadowBlur = Math.max(3, Math.round(Math.min(w, h) * 0.004));
      ctx.drawImage(fillLayer, 0, 0);
      ctx.restore();
    }

    return canvasToPngBlob(out);
  }

  function tintPngBlob(blob, color) {
    if (!blob) return Promise.reject(new Error('이미지가 없습니다.'));
    var c = String(color || '#FFFFFF').trim();
    if (!c || /^#fff(?:fff)?$/i.test(c)) return Promise.resolve(blob);
    var url = URL.createObjectURL(blob);
    return loadRasterImage(url)
      .then(function (img) {
        URL.revokeObjectURL(url);
        return tintImageToColor(img, c);
      })
      .catch(function (e) {
        try {
          URL.revokeObjectURL(url);
        } catch (eRev) {}
        throw e;
      });
  }

  function renderHeaderOverlayBlob(log, logs, logoImg, opts) {
    var canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = SHARE_SPLIT_Y;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShareHeaderOnCanvas(ctx, log, logs, logoImg, opts);
    return canvasToPngBlob(canvas);
  }

  function renderBottomOverlayBlob(log, logs, svgImg, opts) {
    var canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = SHARE_BOTTOM_CANVAS_H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Canvas 2D unavailable'));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShareBottomOnCanvas(ctx, log, logs, svgImg, opts);
    return canvasToPngBlob(canvas);
  }

  /** 상단(제목) + 하단(맵·통계) 투명 PNG 2장 */
  async function createOverlayPngBlobs(log, opts) {
    opts = opts || {};
    if (log && log._logsForShare && !opts.logs) opts.logs = log._logsForShare;
    if (opts.dailyRouteDoc == null && log && log._dailyRouteDoc) {
      opts.dailyRouteDoc = log._dailyRouteDoc;
    }
    var svg = await resolveShareSvgMarkup(log, opts);
    if (!svg) throw new Error('공유 이미지를 만들 수 없습니다. 코스·워크아웃 데이터를 확인해 주세요.');
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
      renderHeaderOverlayBlob(log, shareLogs, logoImg, opts),
      renderBottomOverlayBlob(log, shareLogs, svgImg, opts),
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
  function svgToPngBlob(svgMarkup, _speedLineText, log, logs, opts) {
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
      drawShareHeaderOnCanvas(ctx, log, logs, logoImg, opts);
      drawShareBottomOnCanvas(ctx, log, logs, svgImg, opts);
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

  /** STELVIO 앱 WebView (ReactNativeWebView / StelvioInApp) */
  function isStelvioAppWebView() {
    return !!(
      global.ReactNativeWebView ||
      global.StelvioInApp ||
      global.StelvioAppChannel === 'webview-native'
    );
  }

  /** Android 네이티브 저장 파일명 — JPEG blob 과 확장자 일치 */
  function ensureAndroidNativeSaveFilename(filename) {
    var base = String(filename || 'stelvio-ride.jpg').replace(/[^\w.-]+/g, '_');
    if (/\.(jpg|jpeg)$/i.test(base)) return base.replace(/\.jpeg$/i, '.jpg');
    if (/\.png$/i.test(base)) return base.replace(/\.png$/i, '.jpg');
    if (/\.[^.]+$/.test(base)) return base.replace(/\.[^.]+$/, '') + '.jpg';
    return base + '.jpg';
  }

  /** 단일 브릿지 탐지 — RN postMessage 우선, 구버전 sync JSInterface 폴백 */
  function getStelvioNativeBridge() {
    if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
      return { kind: 'rn' };
    }
    var candidates = [global.AndroidBridge, global.Android, global.StelvioAndroid];
    var i, b, saveFn;
    for (i = 0; i < candidates.length; i++) {
      b = candidates[i];
      if (!b) continue;
      if (typeof b.saveImage === 'function') saveFn = b.saveImage.bind(b);
      else if (typeof b.saveImageToGallery === 'function') saveFn = b.saveImageToGallery.bind(b);
      else if (typeof b.saveImageToPhotos === 'function') saveFn = b.saveImageToPhotos.bind(b);
      else continue;
      return { kind: 'sync', saveFn: saveFn };
    }
    return null;
  }

  function hasNativeSaveBridge() {
    return !!getStelvioNativeBridge();
  }

  /** WebView·모바일: <a download> 자동 저장은 대부분 실패·무반응 */
  function canUseAnchorDownload() {
    if (isStelvioAppWebView()) return false;
    if (isMobileDevice()) return false;
    return true;
  }

  function blobToShareFile(blob, filename) {
    if (typeof File === 'undefined' || !blob) return null;
    var mime = blob.type || 'image/jpeg';
    if (mime.indexOf('jpeg') < 0 && mime.indexOf('jpg') < 0) mime = 'image/jpeg';
    return new File([blob], filename, { type: mime });
  }

  /** 모바일/WebView 공유·브라우저 전달용 JPEG (항상 재압축) */
  var MOBILE_SHARE_MAX_BLOB_BYTES = 480000;
  /** WebView postMessage(SAVE_IMAGE) — base64 포함 JSON 용량 한도 */
  var NATIVE_SAVE_MAX_BLOB_BYTES = 220000;

  /**
   * @param {Blob} blob
   * @param {number} [maxBytes]
   * @param {boolean} [alwaysReencode] WebView 등에서 JPEG 재인코딩 강제
   */
  function compressBlobForMobileShare(blob, maxBytes, alwaysReencode) {
    maxBytes = maxBytes != null ? maxBytes : MOBILE_SHARE_MAX_BLOB_BYTES;
    if (!alwaysReencode && blob && blob.size <= maxBytes) {
      var t = (blob.type || '').toLowerCase();
      if (t.indexOf('jpeg') >= 0 || t.indexOf('jpg') >= 0) {
        return Promise.resolve(blob);
      }
    }
    if (!blob) return Promise.resolve(blob);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!(w > 0 && h > 0)) {
          resolve(blob);
          return;
        }
        var maxDim = 1080;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(blob);
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        function tryQuality(q) {
          canvas.toBlob(
            function (b) {
              if (!b) {
                resolve(blob);
                return;
              }
              if (b.size <= maxBytes || q <= 0.48) {
                resolve(b);
                return;
              }
              tryQuality(Math.max(0.48, q - 0.07));
            },
            'image/jpeg',
            q
          );
        }
        tryQuality(0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      img.src = url;
    });
  }

  function prepareBlobForMobileShare(blob, forceReencode) {
    return compressBlobForMobileShare(blob, MOBILE_SHARE_MAX_BLOB_BYTES, !!forceReencode);
  }

  /** @deprecated 네이티브 브릿지 — 앱 수정 없이 웹 전용 저장으로 대체됨 */
  var NATIVE_BRIDGE_MAX_BLOB_BYTES = MOBILE_SHARE_MAX_BLOB_BYTES;

  function prepareBlobForNativeBridge(blob) {
    return prepareBlobForMobileShare(blob, true);
  }

  function compressBlobForNativeBridge(blob, maxBytes) {
    return compressBlobForMobileShare(blob, maxBytes, false);
  }

  function resolveJournalShareUid() {
    try {
      if (global.authV9 && global.authV9.currentUser && global.authV9.currentUser.uid) {
        return String(global.authV9.currentUser.uid);
      }
      var cu =
        global.currentUser ||
        (function () {
          try {
            return JSON.parse(global.localStorage.getItem('currentUser') || 'null');
          } catch (eCu) {
            return null;
          }
        })();
      if (cu && (cu.id != null || cu.uid != null)) {
        return String(cu.id != null ? cu.id : cu.uid);
      }
    } catch (eUid) {}
    return 'guest';
  }

  function getJournalShareAuthUser() {
    if (global.authV9 && global.authV9.currentUser) return global.authV9.currentUser;
    if (global.auth && global.auth.currentUser) return global.auth.currentUser;
    return null;
  }

  /** Firebase Storage 업로드 전 로그인 세션 대기 (authV9 + compat auth) */
  function ensureJournalShareAuth() {
    var u = getJournalShareAuthUser();
    if (u) return Promise.resolve(u);
    var waits = [];
    if (global.authV9 && typeof global.authV9.authStateReady === 'function') {
      waits.push(global.authV9.authStateReady().catch(function () {}));
    }
    if (global.auth && typeof global.auth.onAuthStateChanged === 'function') {
      waits.push(
        new Promise(function (resolve) {
          var unsub = global.auth.onAuthStateChanged(function (user) {
            if (typeof unsub === 'function') unsub();
            resolve(user || null);
          });
          setTimeout(function () {
            try {
              if (typeof unsub === 'function') unsub();
            } catch (eUnsub) {}
            resolve(null);
          }, 2500);
        })
      );
    }
    if (!waits.length) {
      return Promise.reject(
        new Error('로그인이 필요합니다. STELVIO에 로그인한 뒤 다시 시도해 주세요.')
      );
    }
    return Promise.all(waits).then(function () {
      var u2 = getJournalShareAuthUser();
      if (u2) return u2;
      return Promise.reject(
        new Error('로그인이 필요합니다. STELVIO에 로그인한 뒤 다시 시도해 주세요.')
      );
    });
  }

  function buildJournalShareStoragePath(filename) {
    var uid = resolveJournalShareUid();
    var safeFn = String(filename || 'stelvio-ride.jpg').replace(/[^\w.-]+/g, '_');
    return (
      'journal_save_temp/' +
      uid +
      '/' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '_' +
      safeFn
    );
  }

  /** compat firebase.storage() 업로드 (profilePhotoUpload.js 와 동일 패턴) */
  function uploadJournalShareViaCompatStorage(blob, path) {
    return new Promise(function (resolve, reject) {
      try {
        if (
          typeof firebase === 'undefined' ||
          !firebase.storage ||
          !global.auth ||
          !global.auth.currentUser
        ) {
          reject(new Error('compat Storage를 사용할 수 없습니다.'));
          return;
        }
        var tokenP =
          typeof global.auth.currentUser.getIdToken === 'function'
            ? global.auth.currentUser.getIdToken(true)
            : Promise.resolve();
        tokenP
          .then(function () {
            var ref = firebase.storage().ref(path);
            var task = ref.put(blob, { contentType: 'image/jpeg' });
            task.on(
              'state_changed',
              function () {},
              function (err) {
                reject(err);
              },
              function () {
                task.snapshot.ref.getDownloadURL().then(resolve).catch(reject);
              }
            );
          })
          .catch(reject);
      } catch (eCompat) {
        reject(eCompat);
      }
    });
  }

  function ensureFirebaseStorageReady() {
    if (global._firebaseStorageModReady) {
      return global._firebaseStorageModReady;
    }
    return import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js')
      .then(function (m) {
        global.firebaseStorageModV9API = m;
        return m;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Stelvio WebView — Firebase Storage 임시 업로드 (공개 read URL)
   * storage.rules: journal_save_temp/* 인증 write · read 허용
   */
  function uploadJournalShareToStorage(blob, filename) {
    var path = buildJournalShareStoragePath(filename);
    return ensureJournalShareAuth().then(function () {
      return uploadJournalShareViaCompatStorage(blob, path).catch(function (eCompat) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[journalShare] compat Storage 실패, authV9 재시도:', eCompat);
        }
        return ensureFirebaseStorageReady().then(function (storageMod) {
          if (!storageMod || !global.firebaseStorageV9) {
            return Promise.reject(new Error('Storage를 사용할 수 없습니다.'));
          }
          var refFn = storageMod.ref;
          var uploadBytesFn = storageMod.uploadBytes;
          var getDownloadURLFn = storageMod.getDownloadURL;
          var tokenPromise = Promise.resolve();
          var authUser = getJournalShareAuthUser();
          if (authUser && typeof authUser.getIdToken === 'function') {
            tokenPromise = authUser.getIdToken(true).catch(function () {});
          }
          return tokenPromise.then(function () {
            var r = refFn(global.firebaseStorageV9, path);
            return uploadBytesFn(r, blob, { contentType: 'image/jpeg' }).then(function () {
              return getDownloadURLFn(r);
            });
          });
        });
      });
    });
  }

  /** Stelvio WebView → 시스템 브라우저 (여러 방법 동시 시도, postMessage 단독 성공 처리 금지) */
  function postOpenExternalUrl(url) {
    if (!url) return false;
    var tried = false;
    try {
      var a = global.document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;z-index:2147483647;';
      global.document.body.appendChild(a);
      if (typeof a.click === 'function') a.click();
      tried = true;
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 500);
    } catch (eA) {}
    try {
      global.open(url, '_blank', 'noopener,noreferrer');
      tried = true;
    } catch (eW) {}
    try {
      if (/Android/i.test((global.navigator && global.navigator.userAgent) || '')) {
        var m = String(url).trim().match(/^(https?):\/\/([\s\S]+)$/i);
        if (m) {
          var rest = m[2].replace(/^\/+/, '');
          var intent =
            'intent://' +
            rest +
            '#Intent;scheme=' +
            m[1].toLowerCase() +
            ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=' +
            encodeURIComponent(url) +
            ';end';
          global.location.href = intent;
          tried = true;
        }
      }
    } catch (eI) {}
    if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
      try {
        global.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'OPEN_EXTERNAL_URL', url: url })
        );
      } catch (eRn) {}
    }
    if (typeof global.openStelvioExternalUrl === 'function') {
      try {
        global.openStelvioExternalUrl(url);
        tried = true;
      } catch (eExt) {}
    }
    return tried;
  }

  /** 앱 SAVE_IMAGE — getStelvioNativeBridge 단일 경로 */
  function postSaveImageToApp(dataUrl, filename, requestId) {
    if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) return false;
    var fn = ensureAndroidNativeSaveFilename(filename);
    var payload = {
      type: 'SAVE_IMAGE',
      dataUrl: dataUrl,
      filename: fn,
    };
    if (requestId) payload.requestId = requestId;
    var bridge = getStelvioNativeBridge();
    if (!bridge) return false;
    if (bridge.kind === 'rn') {
      try {
        global.ReactNativeWebView.postMessage(JSON.stringify(payload));
        return true;
      } catch (eRn) {}
      return false;
    }
    try {
      bridge.saveFn(payload.dataUrl, payload.filename, requestId);
      return true;
    } catch (eSync) {}
    return false;
  }

  function blobToNativeSaveDataUrl(blob) {
    return compressBlobForMobileShare(blob, NATIVE_SAVE_MAX_BLOB_BYTES, true).then(function (small) {
      return blobToDataUrl(small).then(function (dataUrl) {
        if (dataUrl && dataUrl.length > 3800000) {
          return compressBlobForMobileShare(small, 160000, true).then(blobToDataUrl);
        }
        return dataUrl;
      });
    });
  }

  /**
   * WebView 내부 저장 도우미 — Chrome 없이 앱 SAVE_IMAGE 직접 호출
   * @returns {Promise<'inline-save'>}
   */
  function openJournalInlineSaveHelper(blob, filename) {
    return blobToNativeSaveDataUrl(blob).then(function (dataUrl) {
      if (!dataUrl) return Promise.reject(new Error('이미지를 준비하지 못했습니다.'));
      mountJournalInlineSaveHelper(dataUrl, ensureAndroidNativeSaveFilename(filename));
      return 'inline-save';
    });
  }

  function mountJournalInlineSaveHelper(dataUrl, filename) {
    var doc = global.document;
    if (!doc || !doc.body) return;
    var existing = doc.getElementById('journalInlineSaveHelper');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var overlay = doc.createElement('div');
    overlay.id = 'journalInlineSaveHelper';
    overlay.className = 'journal-android-save-sheet journal-inline-save-helper';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var panel = doc.createElement('div');
    panel.className = 'journal-android-save-sheet__panel';

    var title = doc.createElement('p');
    title.className = 'journal-android-save-sheet__title';
    title.textContent = '이미지 저장 도우미';

    var hint = doc.createElement('p');
    hint.className = 'journal-android-save-sheet__hint';
    hint.textContent =
      'Chrome 없이 앱 저장 기능을 사용합니다.\n' +
      '① 「사진첩 저장」→ 갤러리·DCIM 확인\n' +
      '② 안 되면 「Google 포토·갤러리로 공유」→ 공유 창에서 Google 포토 선택';

    var statusLine = doc.createElement('p');
    statusLine.className = 'journal-android-save-sheet__hint journal-android-save-sheet__status';
    statusLine.hidden = true;

    var img = doc.createElement('img');
    img.className = 'journal-android-save-sheet__preview';
    img.src = dataUrl;
    img.alt = '저장할 라이딩 이미지';
    img.draggable = false;

    function setHelperStatus(msg, isError) {
      if (!msg) {
        statusLine.hidden = true;
        return;
      }
      statusLine.hidden = false;
      statusLine.textContent = msg;
      statusLine.style.color = isError ? '#fca5a5' : '#86efac';
    }

    function waitForNativeAck(requestId, maxWaitMs) {
      return new Promise(function (resolve) {
        var settled = false;
        function cleanup() {
          global.removeEventListener('stelvioNativeResponse', onResp);
          if (global.document) {
            global.document.removeEventListener('stelvioNativeResponse', onResp);
          }
        }
        function done(val) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(val);
        }
        function onResp(ev) {
          var d = ev && ev.detail;
          if (!d || d.requestId !== requestId) return;
          done(d.ok === true ? 'ok' : 'fail');
        }
        global.addEventListener('stelvioNativeResponse', onResp);
        if (global.document) global.document.addEventListener('stelvioNativeResponse', onResp);
        var timer = setTimeout(function () {
          done('timeout');
        }, maxWaitMs || 12000);
      });
    }

    function dispatchFromTap(mode) {
      try {
        if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
          global.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PREPARE_SAVE_IMAGE' }));
        }
      } catch (ePrep) {}
      var requestId =
        mode === 'gallery'
          ? 'saveImg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
          : undefined;
      var sent = postSaveImageToApp(dataUrl, filename, requestId);
      if (!sent) {
        setHelperStatus('앱 저장 기능에 연결되지 않았습니다. STELVIO 앱을 업데이트해 주세요.', true);
        return;
      }
      if (mode === 'gallery') {
        setHelperStatus('사진첩에 저장하는 중…', false);
        waitForNativeAck(requestId, 12000).then(function (result) {
          if (result === 'ok') {
            setHelperStatus('사진 보관함에 저장했습니다. 갤러리 → 최근 사진에서 확인하세요.', false);
            if (typeof global.showToast === 'function') {
              global.showToast('사진 보관함에 저장했습니다.', 'success');
            }
            return;
          }
          if (result === 'timeout') {
            setHelperStatus(
              '앱 응답이 없습니다. STELVIO 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.',
              true
            );
            return;
          }
          setHelperStatus(
            '저장에 실패했습니다. 「Google 포토·갤러리로 공유」를 이용해 주세요.',
            true
          );
        });
      } else {
        setHelperStatus(
          '공유·저장 창이 열리면 Google 포토 또는 갤러리를 선택하세요.',
          false
        );
      }
    }

    var galleryBtn = doc.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.className =
      'journal-android-save-sheet__btn journal-android-save-sheet__btn--primary';
    galleryBtn.textContent = '사진첩 저장';
    galleryBtn.addEventListener('click', function () {
      dispatchFromTap('gallery');
    });

    var shareBtn = doc.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className =
      'journal-android-save-sheet__btn journal-android-save-sheet__btn--secondary';
    shareBtn.textContent = 'Google 포토·갤러리로 공유';
    shareBtn.addEventListener('click', function () {
      dispatchFromTap('share');
    });

    var closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'journal-android-save-sheet__btn journal-android-save-sheet__btn--ghost';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    panel.appendChild(title);
    panel.appendChild(hint);
    panel.appendChild(img);
    panel.appendChild(statusLine);
    panel.appendChild(galleryBtn);
    panel.appendChild(shareBtn);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
  }

  function buildJournalSaveBridgeUrl(imageUrl, filename) {
    var origin = 'https://stelvio.ai.kr';
    try {
      if (global.location && global.location.origin) origin = global.location.origin;
    } catch (eOrigin) {}
    return (
      origin +
      '/?journalSave=1&url=' +
      encodeURIComponent(imageUrl) +
      '&name=' +
      encodeURIComponent(filename || 'stelvio-ride.jpg')
    );
  }

  /** @deprecated Chrome 의존 — WebView 저장 도우미 사용 */
  function openJournalSaveBridgePage(imageUrl, filename) {
    var bridgeUrl = buildJournalSaveBridgeUrl(imageUrl, filename);
    postOpenExternalUrl(bridgeUrl);
    return 'external-attempt';
  }

  /** Chrome·Storage 대신 WebView 내부 저장 도우미 */
  function performAndroidChromeBridgeSave(blob, filename) {
    return openJournalInlineSaveHelper(blob, filename);
  }

  function copyTextToClipboard(text) {
    if (!text) return Promise.resolve(false);
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        return global.navigator.clipboard.writeText(text).then(
          function () {
            return true;
          },
          function () {
            return false;
          }
        );
      }
    } catch (eClip) {}
    return Promise.resolve(false);
  }

  /** WebView 내부 `<a download>` 시도 (성공 여부 확인 불가 — 자동 성공 처리하지 않음) */
  function tryAnchorDownloadBlob(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename || 'stelvio-ride.jpg';
      a.rel = 'noopener';
      a.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      global.document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 8000);
      return true;
    } catch (eDl) {
      return false;
    }
  }

  /** data URL Chrome 폴백 — 실패 시 저장 도우미 */
  function openImageInSystemBrowserForSave(blob, filename) {
    return openJournalInlineSaveHelper(blob, filename).catch(function () {
      return null;
    });
  }

  /**
   * Android 모바일 브라우저 — Web Share / 다운로드 (인앱은 performAndroidNativeSave)
   */
  function performAndroidShareOrSave(blob, filename) {
    if (isStelvioAppWebView()) {
      return performAndroidNativeSave(blob, ensureAndroidNativeSaveFilename(filename));
    }
    var fn = ensureAndroidNativeSaveFilename(filename);
    return prepareBlobForMobileShare(blob, false).then(function (smallBlob) {
      var file = blobToShareFile(smallBlob, fn);
      if (!file || !global.navigator || typeof global.navigator.share !== 'function') {
        if (tryAnchorDownloadBlob(smallBlob, fn)) return 'download-android';
        return null;
      }
      return shareFileWithUserPickerWithTimeout(file, {}, 4500).then(function (shared) {
        if (shared === 'share') return 'share-android';
        if (tryAnchorDownloadBlob(smallBlob, fn)) return 'download-android';
        return null;
      });
    });
  }

  /** WebView에서 기본 「이미지 저장」 컨텍스트 메뉴가 막힐 때 대체 길게 누르기 */
  function attachImageLongPressActions(imgEl, onAction) {
    if (!imgEl || typeof onAction !== 'function') return;
    var LONG_MS = 480;
    var timer = null;
    var startX = 0;
    var startY = 0;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    imgEl.addEventListener(
      'touchstart',
      function (ev) {
        if (!ev.touches || !ev.touches[0]) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        clearTimer();
        timer = setTimeout(function () {
          timer = null;
          onAction();
        }, LONG_MS);
      },
      { passive: true }
    );

    imgEl.addEventListener(
      'touchmove',
      function (ev) {
        if (!ev.touches || !ev.touches[0]) return;
        var dx = Math.abs(ev.touches[0].clientX - startX);
        var dy = Math.abs(ev.touches[0].clientY - startY);
        if (dx > 14 || dy > 14) clearTimer();
      },
      { passive: true }
    );

    imgEl.addEventListener('touchend', clearTimer, { passive: true });
    imgEl.addEventListener('touchcancel', clearTimer, { passive: true });

    imgEl.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      onAction();
    });
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

  /** Android: share 호출이 무한 대기할 때 저장 시트로 넘기기 */
  function shareFileWithUserPickerWithTimeout(file, meta, timeoutMs) {
    timeoutMs = timeoutMs != null ? timeoutMs : 2800;
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(err, val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(val);
      }
      var timer = setTimeout(function () {
        finish(null, null);
      }, timeoutMs);
      shareFileWithUserPicker(file, meta)
        .then(function (v) {
          finish(null, v);
        })
        .catch(function (e) {
          finish(e);
        });
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

  /** Android 앱에 주입된 동기 JSInterface (구버전 앱 호환) */
  function hasSyncAndroidSaveBridge() {
    var b = getStelvioNativeBridge();
    return !!(b && b.kind === 'sync');
  }

  /** @deprecated 앱 네이티브 저장 — tryReactNativeSaveImage 사용 */
  function trySyncNativeSaveAndroid() {
    return Promise.resolve(false);
  }

  /**
   * Stelvio WebView → SAVE_IMAGE (앱 MediaStore / DCIM 저장)
   * @returns {Promise<'ok'|'fail'|'timeout'>}
   */
  function tryReactNativeSaveImage(blob, filename, maxWaitMs) {
    if (!hasNativeSaveBridge()) {
      return Promise.resolve('fail');
    }
    maxWaitMs = maxWaitMs != null ? maxWaitMs : 12000;
    filename = ensureAndroidNativeSaveFilename(filename);
    try {
      if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
        global.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PREPARE_SAVE_IMAGE' }));
      }
    } catch (ePrep) {}
    return blobToNativeSaveDataUrl(blob)
      .then(function (dataUrl) {
        if (!dataUrl) return 'fail';
        return new Promise(function (resolve) {
          var requestId =
            'saveImg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
          var settled = false;
          var posted = postSaveImageToApp(dataUrl, filename, requestId);
          if (!posted) {
            resolve('fail');
            return;
          }
          function cleanup() {
            global.removeEventListener('stelvioNativeResponse', onResp);
            if (global.document) {
              global.document.removeEventListener('stelvioNativeResponse', onResp);
            }
          }
          function done(val) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(val);
          }
          function onResp(ev) {
            var d = ev && ev.detail;
            if (!d || d.requestId !== requestId) return;
            done(d.ok === true ? 'ok' : 'fail');
          }
          global.addEventListener('stelvioNativeResponse', onResp);
          if (global.document) global.document.addEventListener('stelvioNativeResponse', onResp);
          var timer = setTimeout(function () {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[journalShare] SAVE_IMAGE ack timeout', requestId);
            }
            done('timeout');
          }, maxWaitMs);
        });
      })
      .catch(function () {
        return 'fail';
      });
  }

  /** Stelvio WebView — 사진첩 저장 (ack 실패 시 호출측에서 폴백 UI) */
  function performAndroidNativeSave(blob, filename) {
    filename = ensureAndroidNativeSaveFilename(filename);
    return tryReactNativeSaveImage(blob, filename, 12000).then(function (rnResult) {
      if (rnResult === 'ok') return 'native-android';
      if (rnResult === 'timeout') return 'native-android-timeout';
      return 'native-android-fail';
    });
  }

  function downloadDataUrl(dataUrl, filename) {
    if (!canUseAnchorDownload()) return false;
    try {
      var a = global.document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.rel = 'noopener';
      a.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
      global.document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 500);
      return true;
    } catch (eDl) {
      return false;
    }
  }

  /** Android WebView·Chrome: data URL 공유 (일부 WebView에서 files 공유 대신 동작) */
  function tryShareDataUrl(dataUrl, filename) {
    if (!global.navigator || typeof global.navigator.share !== 'function') {
      return Promise.resolve(null);
    }
    return global.navigator
      .share({ url: dataUrl, title: filename || 'stelvio-ride.jpg' })
      .then(function () {
        return 'share';
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return Promise.reject(e);
        return null;
      });
  }

  /**
   * Android: 전체 화면 미리보기 + 공유·저장 버튼 (WebView 기본 길게 누르기 대체)
   */
  function openAndroidLongPressView(dataUrl, filename, blob, onShareTap) {
    var doc = global.document;
    if (!doc || !doc.body) return;
    var overlay = doc.createElement('div');
    overlay.className = 'journal-android-save-sheet journal-android-longpress-view';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var hint = doc.createElement('p');
    hint.className = 'journal-android-save-sheet__hint journal-android-longpress-view__hint';
    hint.textContent = isStelvioAppWebView()
      ? '「사진첩 저장」 또는 「Google 포토·갤러리로 저장」을 눌러 주세요.'
      : '「공유·저장」을 누르거나, 아래 이미지를 길게 눌러 갤러리·Google 포토 등으로 저장하세요.';

    var img = doc.createElement('img');
    img.className = 'journal-android-longpress-view__img';
    img.src = dataUrl;
    img.alt = filename || '저장할 라이딩 이미지';
    img.draggable = false;

    function triggerShare() {
      if (typeof onShareTap === 'function') onShareTap();
    }

    attachImageLongPressActions(img, triggerShare);

    var shareBtn = doc.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className =
      'journal-android-save-sheet__btn journal-android-save-sheet__btn--primary';
    shareBtn.textContent = '공유·저장';
    shareBtn.addEventListener('click', triggerShare);

    var backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'journal-android-save-sheet__btn journal-android-save-sheet__btn--ghost';
    backBtn.textContent = '돌아가기';
    backBtn.addEventListener('click', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    overlay.appendChild(hint);
    overlay.appendChild(img);
    overlay.appendChild(shareBtn);
    overlay.appendChild(backBtn);
    doc.body.appendChild(overlay);
  }

  /**
   * Android 저장 화면 — 합성 직후 즉시 표시, 공유는 사용자 탭에서만 (제스처 유지)
   * @param {{ onPresent?: function }} [opts]
   * @returns {Promise<string>}
   */
  function presentAndroidImageSave(blob, filename, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var doc = global.document;
      if (!doc || !doc.body) {
        reject(new Error('저장 화면을 표시할 수 없습니다.'));
        return;
      }
      var previewUrl = URL.createObjectURL(blob);
      var inApp = isStelvioAppWebView();
      if (inApp) filename = ensureAndroidNativeSaveFilename(filename);
      var settled = false;

      function revokePreview() {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch (eRev) {}
      }

      function finish(method) {
        if (settled) return;
        settled = true;
        revokePreview();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(method);
      }

      function finishCancel() {
        if (settled) return;
        settled = true;
        revokePreview();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        reject(Object.assign(new Error('저장 취소'), { name: 'AbortError' }));
      }

      var overlay = doc.createElement('div');
      overlay.className = 'journal-android-save-sheet';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      var panel = doc.createElement('div');
      panel.className = 'journal-android-save-sheet__panel';

      var title = doc.createElement('p');
      title.className = 'journal-android-save-sheet__title';
      title.textContent = '이미지 저장';

      var img = doc.createElement('img');
      img.className = 'journal-android-save-sheet__preview';
      img.src = previewUrl;
      img.alt = '저장할 라이딩 이미지';
      img.draggable = false;

      var hint = doc.createElement('p');
      hint.className = 'journal-android-save-sheet__hint';
      hint.textContent = inApp
        ? '「사진첩 저장」을 누르면 갤러리(DCIM/STELVIO)에 저장됩니다.'
        : '「공유·저장」을 눌러 갤러리·Google 포토·파일 앱 등을 선택하세요.';

      var statusLine = doc.createElement('p');
      statusLine.className = 'journal-android-save-sheet__hint journal-android-save-sheet__status';
      statusLine.hidden = true;

      var googleBtn = null;
      var browserBtn = null;

      function setStatus(msg, isError) {
        if (!msg) {
          statusLine.hidden = true;
          statusLine.textContent = '';
          return;
        }
        statusLine.hidden = false;
        statusLine.textContent = msg;
        statusLine.style.color = isError ? '#fca5a5' : '#86efac';
      }

      function shareBtnLabel() {
        return inApp ? '사진첩 저장' : '공유·저장';
      }

      function revealFallbackButtons() {
        if (googleBtn) googleBtn.hidden = false;
        if (browserBtn) browserBtn.hidden = false;
      }

      function setSaveButtonsDisabled(disabled) {
        shareBtn.disabled = disabled;
        if (googleBtn) googleBtn.disabled = disabled;
        if (browserBtn) browserBtn.disabled = disabled;
      }

      function openBrowserSaveFromTap() {
        if (shareBtn.disabled) return;
        setSaveButtonsDisabled(true);
        setStatus('저장 도우미를 여는 중…', false);
        performAndroidChromeBridgeSave(blob, filename)
          .then(function (method) {
            setSaveButtonsDisabled(false);
            shareBtn.textContent = shareBtnLabel();
            if (method === 'inline-save') {
              setStatus(
                '저장 도우미가 열렸습니다. 「사진첩 저장」 또는 「Google 포토·갤러리로 공유」를 눌러 주세요.',
                false
              );
              return;
            }
            setStatus('저장 도우미를 열 수 없습니다. 다시 시도해 주세요.', true);
          })
          .catch(function (eBridge) {
            setSaveButtonsDisabled(false);
            shareBtn.textContent = shareBtnLabel();
            var msg =
              eBridge && eBridge.message
                ? String(eBridge.message)
                : '저장 도우미를 열 수 없습니다.';
            setStatus(msg, true);
            if (typeof global.showToast === 'function') {
              global.showToast(msg, 'error');
            }
          });
      }

      function shareFromUserTap() {
        if (shareBtn.disabled) return;
        setSaveButtonsDisabled(true);
        shareBtn.textContent = inApp ? '저장 중…' : '저장 중…';
        setStatus(inApp ? '앱 사진첩에 저장하는 중…' : '저장하는 중…', false);

        var savePromise = inApp
          ? performAndroidNativeSave(blob, filename)
          : performAndroidShareOrSave(blob, filename);

        savePromise
          .then(function (method) {
            setSaveButtonsDisabled(false);
            shareBtn.textContent = shareBtnLabel();
            if (method === 'native-android') {
              setStatus('사진 보관함에 저장했습니다. 갤러리 → 최근 사진에서 확인하세요.', false);
              finish('native-android');
              return;
            }
            if (
              method === 'native-android-fail' ||
              method === 'native-android-timeout' ||
              method === 'inline-save'
            ) {
              revealFallbackButtons();
              if (method === 'native-android-timeout') {
                setStatus(
                  '앱에서 저장 응답이 없습니다. STELVIO 앱을 최신 버전으로 업데이트하거나 아래 버튼을 이용해 주세요.',
                  true
                );
              } else if (method === 'native-android-fail') {
                setStatus(
                  '사진첩 저장에 실패했습니다. 아래 「Google 포토·갤러리로 저장」 또는 「저장 도우미 열기」를 이용해 주세요.',
                  true
                );
              } else {
                setStatus(
                  '저장 도우미가 열렸습니다. 「사진첩 저장」 또는 「Google 포토·갤러리로 공유」를 눌러 주세요.',
                  false
                );
              }
              return;
            }
            if (method === 'share-android') {
              finish('share-android');
              return;
            }
            if (inApp) {
              setStatus('저장에 실패했습니다. 아래 버튼으로 다시 시도해 주세요.', true);
              revealFallbackButtons();
              return;
            }
            if (method === 'bridge-open' || method === 'browser-open') {
              setStatus('Chrome에서 저장을 완료해 주세요.', false);
              return;
            }
            setStatus('저장에 실패했습니다. 다시 시도해 주세요.', true);
            if (typeof global.showToast === 'function') {
              global.showToast('공유·저장에 실패했습니다. 다시 시도해 주세요.', 'error');
            }
          })
          .catch(function (eShare) {
            setSaveButtonsDisabled(false);
            shareBtn.textContent = shareBtnLabel();
            if (eShare && eShare.name === 'AbortError') {
              finishCancel();
              return;
            }
            if (typeof global.showToast === 'function') {
              global.showToast('공유·저장에 실패했습니다. 다시 시도해 주세요.', 'error');
            }
          });
      }

      attachImageLongPressActions(img, shareFromUserTap);

      var shareBtn = doc.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className =
        'journal-android-save-sheet__btn journal-android-save-sheet__btn--primary';
      shareBtn.textContent = shareBtnLabel();
      shareBtn.addEventListener('click', shareFromUserTap);

      var longPressBtn = doc.createElement('button');
      longPressBtn.type = 'button';
      longPressBtn.className =
        'journal-android-save-sheet__btn journal-android-save-sheet__btn--secondary';
      longPressBtn.textContent = '크게 보기';
      longPressBtn.addEventListener('click', function () {
        openAndroidLongPressView(previewUrl, filename, blob, shareFromUserTap);
      });

      var closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'journal-android-save-sheet__btn journal-android-save-sheet__btn--ghost';
      closeBtn.textContent = '닫기';
      closeBtn.addEventListener('click', finishCancel);

      panel.appendChild(title);
      panel.appendChild(img);
      panel.appendChild(hint);
      panel.appendChild(statusLine);
      panel.appendChild(shareBtn);
      if (inApp) {
        googleBtn = doc.createElement('button');
        googleBtn.type = 'button';
        googleBtn.className =
          'journal-android-save-sheet__btn journal-android-save-sheet__btn--secondary';
        googleBtn.textContent = 'Google 포토·갤러리로 저장';
        googleBtn.hidden = true;
        googleBtn.addEventListener('click', openBrowserSaveFromTap);
        panel.appendChild(googleBtn);

        browserBtn = doc.createElement('button');
        browserBtn.type = 'button';
        browserBtn.className =
          'journal-android-save-sheet__btn journal-android-save-sheet__btn--secondary';
        browserBtn.textContent = '저장 도우미 열기';
        browserBtn.hidden = true;
        browserBtn.addEventListener('click', openBrowserSaveFromTap);
        panel.appendChild(browserBtn);
        panel.appendChild(longPressBtn);
      }
      panel.appendChild(closeBtn);
      overlay.appendChild(panel);
      doc.body.appendChild(overlay);

      if (typeof opts.onPresent === 'function') {
        try {
          opts.onPresent();
        } catch (ePresent) {}
      }
    });
  }

  /** @deprecated presentAndroidImageSave */
  function openAndroidImageSaveSheet(blob, filename, opts) {
    return presentAndroidImageSave(blob, filename, opts);
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
    if (!canUseAnchorDownload()) return false;
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
    } else if (result === 'native-android') {
      global.showToast(
        '사진 보관함(DCIM/STELVIO)에 저장했습니다. 갤러리 → 최근 사진에서 확인하세요.',
        'success'
      );
    } else if (result === 'native-android-timeout' || result === 'native-android-fail') {
      global.showToast(
        result === 'native-android-timeout'
          ? '앱 저장 응답이 없습니다. 앱 업데이트 후 다시 시도해 주세요.'
          : '사진첩 저장에 실패했습니다. 저장 도우미를 이용해 주세요.',
        'error'
      );
    } else if (result === 'inline-save') {
      global.showToast('저장 도우미에서 「사진첩 저장」 또는 「Google 포토·갤러리로 공유」를 눌러 주세요.', 'info');
    } else if (result === 'share-android') {
      global.showToast('선택한 앱·폴더에 저장되었습니다.', 'success');
    } else if (result === 'bridge-open') {
      global.showToast(
        'Chrome 저장 화면을 열었습니다. 「Google 포토·갤러리로 저장」을 눌러 주세요.',
        'info'
      );
    } else if (result === 'browser-open') {
      global.showToast(
        'Chrome에서 이미지를 열었습니다. ⋮ → 다운로드 또는 길게 눌러 갤러리에 저장하세요.',
        'info'
      );
    } else if (result === 'download-android') {
      global.showToast('다운로드 폴더에 저장했습니다. 갤러리에서 확인해 주세요.', 'info');
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
   * Android / Stelvio WebView — 사진첩 저장 + Chrome Google 포토 경로
   */
  function savePngBlobAndroid(blob, filename, opts) {
    opts = opts || {};
    return presentAndroidImageSave(blob, filename, {
      onPresent: opts.onPresent,
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
    var svg = await resolveShareSvgMarkup(log, opts);
    if (!svg) throw new Error('공유 이미지를 만들 수 없습니다. 코스·워크아웃 데이터를 확인해 주세요.');
    var summaryLines = summaryLinesFromLog(log, opts);
    var speedLineText = summaryLines[summaryLines.length - 1] || '-';
    var shareLogs = opts.logs || log._logsForShare || null;
    return svgToPngBlob(svg, speedLineText, log, shareLogs, opts);
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
    resolveShareSvgMarkup: resolveShareSvgMarkup,
    buildShareSvgMarkup: buildShareSvgMarkup,
    createOverlayPngBlob: createOverlayPngBlob,
    createOverlayPngBlobs: createOverlayPngBlobs,
    compositeShareToBlob: compositeShareToBlob,
    compositeShareDualToBlob: compositeShareDualToBlob,
    overlayColorFromHue: overlayColorFromHue,
    tintPngBlob: tintPngBlob,
    fitContainRect: fitContainRect,
    stickerDragBounds: stageDragBounds,
    requestSaveFileHandle: requestSaveFileHandle,
    writeBlobToSaveHandle: writeBlobToSaveHandle,
    savePngBlob: savePngBlob,
    savePngBlobAndroid: savePngBlobAndroid,
    presentAndroidImageSave: presentAndroidImageSave,
    isAndroidDevice: isAndroidDevice,
    notifySaveResult: notifySaveResult,
    exportTransparentSharePng: exportTransparentSharePng,
    openShareComposer: openShareComposer,
    unmountShareComposer: unmountShareComposer,
  };
})(typeof window !== 'undefined' ? window : global);
