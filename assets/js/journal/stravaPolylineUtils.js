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

  function routeProfileFromLog(log) {
    if (!log) return { latlngs: [], elevation: [], hasRoute: false };
    var poly =
      log.summary_polyline != null
        ? String(log.summary_polyline).trim()
        : '';
    var elev = log.elevation_profile != null ? log.elevation_profile : log.elevation_profile_json;
    var latlngs = poly ? downsampleLatLngs(decodePolyline(poly), 220) : [];
    var elevation = downsampleElevation(elev, 120);
    return {
      latlngs: latlngs,
      elevation: elevation,
      hasRoute: latlngs.length >= 2,
      hasElevation: elevation.length >= 2,
    };
  }

  global.stravaPolylineUtils = {
    decodePolyline: decodePolyline,
    downsampleLatLngs: downsampleLatLngs,
    normalizeElevationProfile: normalizeElevationProfile,
    downsampleElevation: downsampleElevation,
    latLngsToSvgPath: latLngsToSvgPath,
    elevationToSvgPath: elevationToSvgPath,
    routeProfileFromLog: routeProfileFromLog,
  };
})(typeof window !== 'undefined' ? window : global);
