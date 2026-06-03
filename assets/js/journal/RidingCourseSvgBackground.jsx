/**
 * Strava polyline + 고도 프로파일 SVG 배경 (지도 타일 없음)
 * displayVariant: 'muted' | 'white'
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var utils = window.stravaPolylineUtils;

  function RidingCourseSvgBackground(props) {
    var log = props.log;
    var opacity = props.opacity != null ? Number(props.opacity) : 0.22;
    var variant = props.variant === 'white' ? 'white' : 'muted';
    var showElevation = props.showElevation !== false;
    var className = props.className || '';

    if (!utils || !log) return null;
    log = utils.normalizeLogRouteFields ? utils.normalizeLogRouteFields(log) : log;
    var route = utils.routeProfileFromLog(log);
    if (!route.hasRoute && !route.hasElevation) return null;

    var stroke = variant === 'white' ? '#FFFFFF' : '#7c3aed';
    var coursePath = route.hasRoute
      ? utils.latLngsToSvgPath(route.latlngs, 400, 160, 0.1)
      : { pathD: '', viewW: 400, viewH: 160 };
    var elevPath =
      showElevation && route.hasElevation
        ? utils.elevationToSvgPath(route.elevation, 400, 56, 0.08)
        : { pathD: '', viewH: 56 };

    return R.createElement(
      'div',
      {
        className: 'journal-route-svg-bg ' + className,
        'aria-hidden': true,
        style: {
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        },
      },
      R.createElement(
        'svg',
        {
          className: 'journal-route-svg-bg__svg',
          viewBox: '0 0 400 220',
          preserveAspectRatio: 'xMidYMid meet',
          style: {
            width: '100%',
            height: '100%',
            opacity: opacity,
          },
        },
        coursePath.pathD
          ? R.createElement('path', {
              d: coursePath.pathD,
              fill: 'none',
              stroke: stroke,
              strokeWidth: variant === 'white' ? 3 : 2.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            })
          : null,
        elevPath.pathD
          ? R.createElement('path', {
              d: elevPath.pathD,
              transform: 'translate(0, 164)',
              fill: 'none',
              stroke: stroke,
              strokeWidth: variant === 'white' ? 2 : 1.5,
              strokeOpacity: 0.85,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            })
          : null
      )
    );
  }

  window.RidingCourseSvgBackground = RidingCourseSvgBackground;
})();
