/**
 * Strava summary_polyline → Leaflet + OSM 배경 + 코스 라인 (라이딩 모임 GPX 지도와 동일 스택)
 */
/* global React */

(function () {
  'use strict';

  if (!window.React) {
    console.warn('[JournalCourseMapPreview] React not loaded');
    return;
  }

  var R = window.React;
  var useRef = R.useRef;
  var useEffect = R.useEffect;

  function downsampleForMap(latlngs, maxPts) {
    var utils = window.stravaPolylineUtils;
    if (utils && typeof utils.downsampleLatLngs === 'function') {
      return utils.downsampleLatLngs(latlngs, maxPts || 800);
    }
    if (!latlngs || latlngs.length <= (maxPts || 800)) return latlngs || [];
    var step = Math.ceil(latlngs.length / (maxPts || 800));
    var out = [];
    var i;
    for (i = 0; i < latlngs.length; i += step) out.push(latlngs[i]);
    if (out[out.length - 1] !== latlngs[latlngs.length - 1]) {
      out.push(latlngs[latlngs.length - 1]);
    }
    return out;
  }

  function latLngsFromLog(log) {
    var utils = window.stravaPolylineUtils;
    if (!utils || !log) return [];
    var norm = utils.normalizeLogRouteFields ? utils.normalizeLogRouteFields(log) : log;
    var route = utils.routeProfileFromLog(norm);
    return route && route.hasRoute && route.latlngs ? route.latlngs : [];
  }

  function JournalCourseMapPreview(props) {
    var log = props.log;
    var className = props.className || '';
    var mapHeight = props.mapHeight != null ? Number(props.mapHeight) : 200;
    var mapRef = useRef(null);
    var mapInstRef = useRef(null);
    var routeKey =
      log && log.activity_id
        ? String(log.activity_id)
        : log && log.summary_polyline
          ? String(log.summary_polyline).slice(0, 32)
          : '';

    useEffect(
      function () {
        var latlngs = latLngsFromLog(log);
        if (latlngs.length < 2) {
          if (mapInstRef.current) {
            try {
              mapInstRef.current.remove();
            } catch (e0) {}
            mapInstRef.current = null;
          }
          return;
        }

        var L = typeof window !== 'undefined' ? window.L : null;
        if (!L || !mapRef.current) return;

        try {
          if (mapInstRef.current) {
            try {
              mapInstRef.current.remove();
            } catch (e1) {}
            mapInstRef.current = null;
          }

          var latlngsDraw = downsampleForMap(latlngs, 900);
          var map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: true,
            fadeAnimation: false,
            zoomAnimation: false,
            dragging: false,
            touchZoom: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            maxZoom: 17,
          });

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            maxNativeZoom: 19,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          }).addTo(map);

          var poly = L.polyline(latlngsDraw, {
            color: '#7c3aed',
            weight: 4,
            opacity: 0.92,
            smoothFactor: 1.5,
          }).addTo(map);
          map.fitBounds(poly.getBounds(), { padding: [14, 14], maxZoom: 15 });
          mapInstRef.current = map;

          var t0 = setTimeout(function () {
            try {
              map.invalidateSize();
            } catch (e2) {}
          }, 280);
          var t1 = setTimeout(function () {
            try {
              map.invalidateSize();
            } catch (e3) {}
          }, 800);

          return function () {
            clearTimeout(t0);
            clearTimeout(t1);
            try {
              if (mapInstRef.current) {
                mapInstRef.current.remove();
                mapInstRef.current = null;
              }
            } catch (e4) {}
          };
        } catch (e5) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[JournalCourseMapPreview] map init', e5);
          }
        }
      },
      [routeKey, mapHeight]
    );

    var latlngsCheck = latLngsFromLog(log);
    if (latlngsCheck.length < 2) return null;

    return R.createElement(
      'div',
      {
        className:
          'journal-course-map-wrap open-riding-gpx-map-wrap w-full max-w-full ' + className,
        'aria-hidden': true,
      },
      R.createElement('div', {
        ref: mapRef,
        className: 'journal-course-map-inner open-riding-gpx-map-inner w-full h-full',
        style: { height: mapHeight + 'px', minHeight: mapHeight + 'px' },
      })
    );
  }

  window.JournalCourseMapPreview = JournalCourseMapPreview;
})();
