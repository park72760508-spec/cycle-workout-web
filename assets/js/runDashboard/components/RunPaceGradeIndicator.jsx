/**
 * RunPaceGradeIndicator — 90일 10k 페이스 기준 STELVIO 헥사곤 등급 배지 (A.svg~G.svg)
 */
/* global React, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[RunPaceGradeIndicator] React not loaded');
    return;
  }

  var React = window.React;

  function resolveBadge(props) {
    var p = props || {};
    if (p.badgeSrc) {
      return {
        badgeSrc: p.badgeSrc,
        levelName: p.levelName || '등급',
        unavailable: false
      };
    }
    if (window.runDashboardPace && typeof window.runDashboardPace.resolveRunHexagonTierBadge === 'function') {
      return window.runDashboardPace.resolveRunHexagonTierBadge(p.stats);
    }
    return { badgeSrc: 'assets/img/G.svg', levelName: '등급', unavailable: true };
  }

  function RunPaceGradeIndicator(props) {
    var p = props || {};
    var size = Number(p.size) || 40;
    var badge = resolveBadge(p);
    var paceDisplay = p.paceDisplay || (p.stats && (p.stats.thresholdPaceDisplay || p.stats.thresholdPaceValue)) || null;

    var title = badge.levelName;
    if (paceDisplay) {
      title += ' · 10k ' + paceDisplay + ' min/km (90일)';
    } else if (badge.unavailable) {
      title = '10k 페이스 기록 없음';
    }

    return React.createElement('img', {
      src: badge.badgeSrc,
      alt: badge.levelName,
      title: title,
      className: 'object-contain shrink-0' + (badge.unavailable ? ' opacity-50' : ''),
      style: { width: size + 'px', height: size + 'px' },
      width: size,
      height: size,
      loading: 'lazy',
      decoding: 'async',
      draggable: false
    });
  }

  window.RunPaceGradeIndicator = RunPaceGradeIndicator;
})();
