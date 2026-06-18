/**
 * RunPaceGradeIndicator — 90일 10k 페이스 기준 STELVIO 헥사곤 등급 배지
 */
/* global React, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[RunPaceGradeIndicator] React not loaded');
    return;
  }

  var React = window.React;

  function RunPaceGradeIndicator(props) {
    var p = props || {};
    var size = Number(p.size) || 40;
    var badgeSrc = p.badgeSrc || (p.stats && p.stats.hexagonTierBadgeSrc) || null;
    var levelName = p.levelName || (p.stats && p.stats.hexagonTierLevelName) || '등급';
    var paceDisplay = p.paceDisplay || (p.stats && p.stats.thresholdPaceDisplay) || null;
    var unavailable = p.unavailable != null
      ? p.unavailable
      : !!(p.stats && p.stats.thresholdPaceUnavailable !== false && !paceDisplay);

    if (!badgeSrc) {
      badgeSrc = 'assets/img/G.svg';
    }

    var title = levelName;
    if (paceDisplay) {
      title += ' · 10k ' + paceDisplay + ' min/km (90일)';
    } else if (unavailable) {
      title = '10k 페이스 기록 없음';
    }

    return React.createElement('img', {
      src: badgeSrc,
      alt: levelName,
      title: title,
      className: 'object-contain shrink-0' + (unavailable ? ' opacity-40' : ''),
      width: size,
      height: size,
      loading: 'lazy',
      decoding: 'async',
      draggable: false
    });
  }

  window.RunPaceGradeIndicator = RunPaceGradeIndicator;
})();
