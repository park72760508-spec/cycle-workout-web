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

  function resolveRouteProfile(props) {
    if (!utils) return null;
    if (props.routeProfile) return props.routeProfile;
    if (props.log && props.log._routeProfileMerged) return props.log._routeProfileMerged;
    if (props.logs && props.logs.length && typeof utils.routeProfileFromLogs === 'function') {
      return utils.routeProfileFromLogs(props.logs, props.dailyRouteDoc || null);
    }
    if (props.log) return utils.routeProfileFromLog(utils.normalizeLogRouteFields(props.log));
    return null;
  }

  function RidingCourseSvgBackground(props) {
    var opacity = props.opacity != null ? Number(props.opacity) : 0.22;
    var variant = props.variant === 'white' ? 'white' : 'muted';
    var showElevation = props.showElevation !== false;
    var className = props.className || '';

    var route = resolveRouteProfile(props);
    if (!route || (!route.hasRoute && !route.hasElevation)) return null;

    var stroke = variant === 'white' ? '#FFFFFF' : '#7c3aed';
    var coursePaths = [];
    var si, segPath, segList;

    if (route.segments && route.segments.length && typeof utils.latLngSegmentsToSvgPaths === 'function') {
      var drawn = utils.latLngSegmentsToSvgPaths(route.segments, 400, 160, 0.1);
      for (si = 0; si < drawn.length; si++) {
        if (drawn[si].pathD) coursePaths.push(drawn[si].pathD);
      }
    } else if (route.segments && route.segments.length) {
      for (si = 0; si < route.segments.length; si++) {
        segPath = utils.latLngsToSvgPath(route.segments[si], 400, 160, 0.1);
        if (segPath.pathD) coursePaths.push(segPath.pathD);
      }
    } else if (
      (route.segmentCount || 0) <= 1 &&
      route.hasRoute &&
      route.latlngs &&
      route.latlngs.length >= 2
    ) {
      segPath = utils.latLngsToSvgPath(route.latlngs, 400, 160, 0.1);
      if (segPath.pathD) coursePaths.push(segPath.pathD);
    }

    var elevPath =
      showElevation && route.hasElevation
        ? utils.elevationToSvgPath(route.elevation, 400, 56, 0.08)
        : { pathD: '', viewH: 56 };

    segList = [];
    for (si = 0; si < coursePaths.length; si++) {
      segList.push(
        R.createElement('path', {
          key: 'course-' + si,
          d: coursePaths[si],
          fill: 'none',
          stroke: stroke,
          strokeWidth: variant === 'white' ? 3 : 2.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })
      );
    }

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
        segList,
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
