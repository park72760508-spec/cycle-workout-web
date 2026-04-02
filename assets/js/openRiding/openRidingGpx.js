/**
 * 오픈 라이딩 GPX: XML 파싱, 누적 거리(Haversine), 포인트 다운샘플.
 * @global window.openRidingGpx
 */
(function (global) {
  'use strict';

  var MAX_POINTS = 4000;

  function haversineMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var p1 = (lat1 * Math.PI) / 180;
    var p2 = (lat2 * Math.PI) / 180;
    var dp = ((lat2 - lat1) * Math.PI) / 180;
    var dl = ((lon2 - lon1) * Math.PI) / 180;
    var a =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function pickIndices(n, maxN) {
    if (n <= maxN) return null;
    var step = Math.ceil(n / maxN);
    var out = [];
    var i;
    for (i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  }

  /**
   * @param {string} xmlText
   * @returns {{ latlngs: [number,number][], distancesKm: number[], elevs: number[], pointCount: number }}
   */
  function parseGpxToTrack(xmlText) {
    var text = String(xmlText || '');
    if (!text.trim()) throw new Error('GPX 내용이 비어 있습니다.');

    var parser = new DOMParser();
    var doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX XML 형식이 올바르지 않습니다.');

    var nodes = doc.querySelectorAll('trkpt, rtept');
    if (!nodes.length) throw new Error('트랙 포인트(trkpt/rtept)가 없습니다.');

    var raw = [];
    var ni;
    for (ni = 0; ni < nodes.length; ni++) {
      var el = nodes[ni];
      var lat = parseFloat(el.getAttribute('lat'));
      var lon = parseFloat(el.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      var eleNode = el.getElementsByTagName('ele')[0];
      var elev = eleNode && eleNode.textContent != null ? parseFloat(eleNode.textContent) : NaN;
      if (isNaN(elev)) elev = 0;
      raw.push({ lat: lat, lon: lon, ele: elev });
    }
    if (raw.length < 2) throw new Error('유효한 좌표가 2개 미만입니다.');

    var idxs = pickIndices(raw.length, MAX_POINTS);
    var pts = [];
    if (!idxs) {
      pts = raw;
    } else {
      var j;
      for (j = 0; j < idxs.length; j++) pts.push(raw[idxs[j]]);
    }

    var latlngs = [];
    var distancesKm = [];
    var elevs = [];
    var cumKm = 0;
    var pi;
    distancesKm.push(0);
    latlngs.push([pts[0].lat, pts[0].lon]);
    elevs.push(pts[0].ele);
    for (pi = 1; pi < pts.length; pi++) {
      cumKm += haversineMeters(pts[pi - 1].lat, pts[pi - 1].lon, pts[pi].lat, pts[pi].lon) / 1000;
      latlngs.push([pts[pi].lat, pts[pi].lon]);
      distancesKm.push(cumKm);
      elevs.push(pts[pi].ele);
    }

    return {
      latlngs: latlngs,
      distancesKm: distancesKm,
      elevs: elevs,
      pointCount: raw.length
    };
  }

  global.openRidingGpx = {
    parseGpxToTrack: parseGpxToTrack,
    MAX_POINTS: MAX_POINTS
  };
})(typeof window !== 'undefined' ? window : this);
