/**
 * Strava summary_polyline 디코딩 · SVG viewBox fit · 고도 프로파일 정규화
 * @global window.stravaPolylineUtils
 */
(function (global) {
  'use strict';

  var DEFAULT_PRECISION = 5;

  function decodePolyline(encoded, precision) {
    var enc = String(encoded || '').trim();
    if (!enc) return [];
    var p = precision != null ? precision : DEFAULT_PRECISION;
    var factor = Math.pow(10, p);
    var index = 0;
    var lat = 0;
    var lng = 0;
    var out = [];
    while (index < enc.length) {
      var b;
      var shift = 0;
      var result = 0;
      do {
        b = enc.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      var dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = enc.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      var dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;
      out.push([lat / factor, lng / factor]);
    }
    return out;
  }

  function pickIndices(n, maxN) {
    if (n <= maxN) return null;
    var step = Math.ceil(n / maxN);
    var idx = [];
    var i;
    for (i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    return idx;
  }

  function downsampleLatLngs(latlngs, maxPts) {
    if (!latlngs || latlngs.length <= maxPts) return latlngs || [];
    var idxs = pickIndices(latlngs.length, maxPts);
    if (!idxs) return latlngs;
    var out = [];
    var j;
    for (j = 0; j < idxs.length; j++) out.push(latlngs[idxs[j]]);
    return out;
  }

  function normalizeElevationProfile(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(function (v) {
        return Number(v);
      }).filter(function (v) {
        return isFinite(v);
      });
    }
    if (typeof raw === 'string') {
      try {
        var parsed = JSON.parse(raw);
        return normalizeElevationProfile(parsed);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  function downsampleElevation(elev, maxPts) {
    var arr = normalizeElevationProfile(elev);
    if (!arr.length) return [];
    if (arr.length <= maxPts) return arr;
    var idxs = pickIndices(arr.length, maxPts);
    var out = [];
    var j;
    for (j = 0; j < idxs.length; j++) out.push(arr[idxs[j]]);
    return out;
  }

  /**
   * lat/lng 배열 → SVG path (viewBox 0 0 width height, padding 포함)
   * @returns {{ pathD: string, viewW: number, viewH: number, bounds: object }}
   */
  function latLngsToSvgPath(latlngs, viewW, viewH, padRatio) {
    viewW = viewW || 400;
    viewH = viewH || 200;
    padRatio = padRatio != null ? padRatio : 0.08;
    if (!latlngs || latlngs.length < 2) {
      return { pathD: '', viewW: viewW, viewH: viewH, bounds: null };
    }
    var minLat = latlngs[0][0];
    var maxLat = latlngs[0][0];
    var minLng = latlngs[0][1];
    var maxLng = latlngs[0][1];
    var i;
    for (i = 1; i < latlngs.length; i++) {
      minLat = Math.min(minLat, latlngs[i][0]);
      maxLat = Math.max(maxLat, latlngs[i][0]);
      minLng = Math.min(minLng, latlngs[i][1]);
      maxLng = Math.max(maxLng, latlngs[i][1]);
    }
    var latSpan = maxLat - minLat || 1e-6;
    var lngSpan = maxLng - minLng || 1e-6;
    var padX = viewW * padRatio;
    var padY = viewH * padRatio;
    var innerW = viewW - padX * 2;
    var innerH = viewH - padY * 2;
    var scale = Math.min(innerW / lngSpan, innerH / latSpan);
    var usedW = lngSpan * scale;
    var usedH = latSpan * scale;
    var offX = padX + (innerW - usedW) / 2;
    var offY = padY + (innerH - usedH) / 2;

    function project(pt) {
      var x = offX + (pt[1] - minLng) * scale;
      var y = offY + (maxLat - pt[0]) * scale;
      return [x, y];
    }

    var p0 = project(latlngs[0]);
    var d = 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2);
    for (i = 1; i < latlngs.length; i++) {
      var pi = project(latlngs[i]);
      d += ' L ' + pi[0].toFixed(2) + ' ' + pi[1].toFixed(2);
    }
    return {
      pathD: d,
      viewW: viewW,
      viewH: viewH,
      bounds: { minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng },
    };
  }

  /**
   * 여러 구간 polyline → SVG path 배열 (전 구간 공통 bounds — Leaflet fitBounds와 동일, 활동 사이 직선 없음)
   */
  function latLngSegmentsToSvgPaths(segments, viewW, viewH, padRatio) {
    viewW = viewW || 400;
    viewH = viewH || 200;
    padRatio = padRatio != null ? padRatio : 0.08;
    var validSegs = [];
    var si, seg;
    for (si = 0; si < (segments || []).length; si++) {
      seg = segments[si];
      if (seg && seg.length >= 2) validSegs.push(seg);
    }
    if (validSegs.length === 0) return [];
    if (validSegs.length === 1) {
      return [latLngsToSvgPath(validSegs[0], viewW, viewH, padRatio)];
    }

    var minLat = validSegs[0][0][0];
    var maxLat = validSegs[0][0][0];
    var minLng = validSegs[0][0][1];
    var maxLng = validSegs[0][0][1];
    var i, j, pt;
    for (si = 0; si < validSegs.length; si++) {
      for (j = 0; j < validSegs[si].length; j++) {
        pt = validSegs[si][j];
        minLat = Math.min(minLat, pt[0]);
        maxLat = Math.max(maxLat, pt[0]);
        minLng = Math.min(minLng, pt[1]);
        maxLng = Math.max(maxLng, pt[1]);
      }
    }
    var latSpan = maxLat - minLat || 1e-6;
    var lngSpan = maxLng - minLng || 1e-6;
    var padX = viewW * padRatio;
    var padY = viewH * padRatio;
    var innerW = viewW - padX * 2;
    var innerH = viewH - padY * 2;
    var scale = Math.min(innerW / lngSpan, innerH / latSpan);
    var usedW = lngSpan * scale;
    var usedH = latSpan * scale;
    var offX = padX + (innerW - usedW) / 2;
    var offY = padY + (innerH - usedH) / 2;

    function project(pt) {
      var x = offX + (pt[1] - minLng) * scale;
      var y = offY + (maxLat - pt[0]) * scale;
      return [x, y];
    }

    var out = [];
    for (si = 0; si < validSegs.length; si++) {
      seg = validSegs[si];
      var p0 = project(seg[0]);
      var d = 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2);
      for (i = 1; i < seg.length; i++) {
        var pi = project(seg[i]);
        d += ' L ' + pi[0].toFixed(2) + ' ' + pi[1].toFixed(2);
      }
      out.push({
        pathD: d,
        viewW: viewW,
        viewH: viewH,
        bounds: { minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng },
      });
    }
    return out;
  }

  function elevationToSvgPath(elev, viewW, viewH, padRatio) {
    viewW = viewW || 400;
    viewH = viewH || 80;
    padRatio = padRatio != null ? padRatio : 0.06;
    var arr = downsampleElevation(elev, 120);
    if (arr.length < 2) return { pathD: '', viewW: viewW, viewH: viewH };
    var minE = arr[0];
    var maxE = arr[0];
    var i;
    for (i = 1; i < arr.length; i++) {
      minE = Math.min(minE, arr[i]);
      maxE = Math.max(maxE, arr[i]);
    }
    var span = maxE - minE || 1;
    var padX = viewW * padRatio;
    var padY = viewH * padRatio;
    var innerW = viewW - padX * 2;
    var innerH = viewH - padY * 2;
    var n = arr.length - 1;
    var d = '';
    for (i = 0; i < arr.length; i++) {
      var x = padX + (n > 0 ? (i / n) * innerW : 0);
      var y = padY + innerH - ((arr[i] - minE) / span) * innerH;
      d += (i === 0 ? 'M ' : ' L ') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    return { pathD: d, viewW: viewW, viewH: viewH, minE: minE, maxE: maxE };
  }

  /** Firestore·Supabase 필드명 통일 */
  function normalizeLogRouteFields(log) {
    if (!log || typeof log !== 'object') return log;
    var poly =
      log.summary_polyline != null ? String(log.summary_polyline).trim() : '';
    var elev = log.elevation_profile != null ? log.elevation_profile : log.elevation_profile_json;
    if (!poly && elev == null) return log;
    var next = log;
    if (log.elevation_profile == null && log.elevation_profile_json != null) {
      next = Object.assign({}, log, { elevation_profile: log.elevation_profile_json });
    }
    return next;
  }

  function logSortKeyForRouteMerge(log) {
    if (!log) return 0;
    var t = log.start_time || log.start_date_local || log.start_date;
    if (t) {
      var ms = Date.parse(String(t));
      if (!isNaN(ms)) return ms;
    }
    var aid = Number(log.activity_id || 0);
    return isFinite(aid) ? aid : 0;
  }

  function flattenRouteSegments(segments) {
    var out = [];
    var i, j;
    if (!segments || !segments.length) return out;
    for (i = 0; i < segments.length; i++) {
      if (!segments[i] || segments[i].length < 2) continue;
      for (j = 0; j < segments[i].length; j++) out.push(segments[i][j]);
    }
    return out;
  }

  /**
   * 같은 날 Strava 로그 여러 건 → 구간별 코스(활동 사이 직선 연결 없음) + 고도 연결
   * @param {Array<object>} logs
   * @param {object} [dailyDoc] users/{uid}/daily_route_profiles/{date} 문서 (있으면 우선)
   */
  function routeProfileFromLogs(logs, dailyDoc) {
    if (dailyDoc && (dailyDoc.route_segments || dailyDoc.merged_elevation_profile)) {
      var segs = Array.isArray(dailyDoc.route_segments) ? dailyDoc.route_segments : [];
      var elevDaily = downsampleElevation(dailyDoc.merged_elevation_profile, 200);
      return {
        segments: segs,
        latlngs: downsampleLatLngs(flattenRouteSegments(segs), 900),
        elevation: elevDaily,
        hasRoute: segs.length > 0,
        hasElevation: elevDaily.length >= 2,
        activity_ids: dailyDoc.activity_ids || [],
        segmentCount: segs.length,
      };
    }
    if (!logs || !logs.length) {
      return {
        segments: [],
        latlngs: [],
        elevation: [],
        hasRoute: false,
        hasElevation: false,
        activity_ids: [],
        segmentCount: 0,
      };
    }
    var sorted = logs.slice().sort(function (a, b) {
      return logSortKeyForRouteMerge(a) - logSortKeyForRouteMerge(b);
    });
    var segments = [];
    var activityIds = [];
    var mergedElev = [];
    var i, l, poly, pts, elevRaw, elevArr;
    for (i = 0; i < sorted.length; i++) {
      l = normalizeLogRouteFields(sorted[i]);
      if (!l) continue;
      poly = l.summary_polyline != null ? String(l.summary_polyline).trim() : '';
      if (poly) {
        pts = downsampleLatLngs(decodePolyline(poly), 320);
        if (pts.length >= 2) {
          segments.push(pts);
          if (l.activity_id) activityIds.push(String(l.activity_id));
        }
      }
      elevRaw = l.elevation_profile != null ? l.elevation_profile : l.elevation_profile_json;
      elevArr = normalizeElevationProfile(elevRaw);
      if (elevArr.length) mergedElev = mergedElev.concat(elevArr);
    }
    if (segments.length > 8) segments = segments.slice(0, 8);
    mergedElev = downsampleElevation(mergedElev, 200);
    return {
      segments: segments,
      latlngs: downsampleLatLngs(flattenRouteSegments(segments), 900),
      elevation: mergedElev,
      hasRoute: segments.length > 0,
      hasElevation: mergedElev.length >= 2,
      activity_ids: activityIds,
      segmentCount: segments.length,
    };
  }

  /** @deprecated 단일 로그 — 다중 활동일 때 routeProfileFromLogs 사용 */
  function pickRouteLogFromLogs(logs) {
    if (!logs || !logs.length) return null;
    var merged = routeProfileFromLogs(logs);
    if (!merged.hasRoute && !merged.hasElevation) return normalizeLogRouteFields(logs[0]);
    return {
      date: logs[0].date,
      title:
        merged.segmentCount > 1
          ? logs[0].date + ' 라이딩 ' + merged.segmentCount + '회'
          : logs[0].title || 'STELVIO Ride',
      summary_polyline: logs[0].summary_polyline,
      elevation_profile: merged.elevation,
      _routeProfileMerged: merged,
      activity_ids: merged.activity_ids,
    };
  }

  function routeProfileFromLog(log) {
    if (!log) return { latlngs: [], elevation: [], hasRoute: false, hasElevation: false };
    log = normalizeLogRouteFields(log);
    var poly =
      log.summary_polyline != null
        ? String(log.summary_polyline).trim()
        : '';
    var elev = log.elevation_profile != null ? log.elevation_profile : log.elevation_profile_json;
    var latlngs = poly ? downsampleLatLngs(decodePolyline(poly), 220) : [];
    var elevation = downsampleElevation(elev, 120);
    var segs = latlngs.length >= 2 ? [latlngs] : [];
    return {
      segments: segs,
      latlngs: latlngs,
      elevation: elevation,
      hasRoute: latlngs.length >= 2,
      hasElevation: elevation.length >= 2,
      segmentCount: segs.length,
    };
  }

  global.stravaPolylineUtils = {
    decodePolyline: decodePolyline,
    downsampleLatLngs: downsampleLatLngs,
    normalizeElevationProfile: normalizeElevationProfile,
    downsampleElevation: downsampleElevation,
    latLngsToSvgPath: latLngsToSvgPath,
    latLngSegmentsToSvgPaths: latLngSegmentsToSvgPaths,
    elevationToSvgPath: elevationToSvgPath,
    normalizeLogRouteFields: normalizeLogRouteFields,
    pickRouteLogFromLogs: pickRouteLogFromLogs,
    routeProfileFromLogs: routeProfileFromLogs,
    routeProfileFromLog: routeProfileFromLog,
    flattenRouteSegments: flattenRouteSegments,
  };
})(typeof window !== 'undefined' ? window : global);
