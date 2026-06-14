/**
 * RunDailyQuickStats - 오늘의 핵심 지표 위젯 카드
 * Card 1: 10k 역치 페이스(90일 peak·유추) & 체중
 * Card 2: 주간 RUN rTSS 목표
 */
/* global React, useState, useEffect, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[RunDailyQuickStats] React not loaded');
    return;
  }

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;

  function CircularWeeklyGoal(props) {
    var targetPct = Math.min(100, Math.max(0, Number(props.value) || 0));
    var size = props.size || 110;
    var strokeWidth = props.strokeWidth || 10;
    var _useState = useState(0);
    var displayPct = _useState[0];
    var setDisplayPct = _useState[1];

    useEffect(function() {
      var timer = requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          setDisplayPct(targetPct);
        });
      });
      return function() { cancelAnimationFrame(timer); };
    }, [targetPct]);

    var radius = (size - strokeWidth) / 2;
    var cx = size / 2;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference - (displayPct / 100) * circumference;

    var color = displayPct >= 80 ? '#059669' : displayPct >= 50 ? '#3b82f6' : displayPct >= 30 ? '#f59e0b' : '#94a3b8';

    return React.createElement(
      'div',
      { className: 'relative inline-flex items-center justify-center', style: { width: size, height: size } },
      React.createElement(
        'svg',
        { width: size, height: size, viewBox: ('0 0 ' + size + ' ' + size), className: 'overflow-visible -rotate-90' },
        React.createElement('circle', {
          cx: cx,
          cy: cx,
          r: radius,
          fill: 'none',
          stroke: '#e5e7eb',
          strokeWidth: strokeWidth,
          strokeLinecap: 'round'
        }),
        React.createElement('circle', {
          cx: cx,
          cy: cx,
          r: radius,
          fill: 'none',
          stroke: color,
          strokeWidth: strokeWidth,
          strokeLinecap: 'round',
          strokeDasharray: circumference,
          strokeDashoffset: offset,
          style: { transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease' }
        })
      ),
      React.createElement(
        'div',
        { className: 'absolute inset-0 flex flex-col items-center justify-center' },
        React.createElement('span', { className: 'text-xl font-bold text-gray-900 tabular-nums leading-none' }, Math.round(displayPct) + '%'),
        React.createElement('span', { className: 'text-[10px] text-gray-500 mt-0.5 font-medium' }, 'rTSS')
      )
    );
  }

  function formatWeeklyTssValue(v) {
    var n = Number(v) || 0;
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function RunDailyQuickStats(props) {
    var p = props || {};
    var stats = p.stats || {
      thresholdPaceDisplay: null,
      thresholdPaceUnavailable: true,
      thresholdPaceInferred: false,
      thresholdPaceInferredFrom: null,
      weight: 0,
      weeklyRtssGoal: 175,
      weeklyRtssProgress: 0
    };
    var logsLoading = p.logsLoading;
    var logsLoadError = p.logsLoadError;
    var retryLogsRef = p.retryLogsRef;

    var paceDisplay = stats.thresholdPaceDisplay;
    var paceUnavailable = stats.thresholdPaceUnavailable !== false && !paceDisplay;
    var paceInferred = !!stats.thresholdPaceInferred;
    var paceInferredFrom = stats.thresholdPaceInferredFrom;
    var weight = Number(stats.weight) || 0;
    var weeklyGoal = Number(stats.weeklyRtssGoal) || 175;
    var weeklyProgress = Math.min(Number(stats.weeklyRtssProgress) || 0, 9999);
    var pct = weeklyGoal > 0 ? Math.min(100, Math.round((weeklyProgress / weeklyGoal) * 100)) : 0;

    var inferredNote = '';
    if (paceInferred && paceInferredFrom === '5k') inferredNote = '5k 페이스 +15초 유추';
    else if (paceInferred && paceInferredFrom === '3k') inferredNote = '3k 페이스 +35초 유추';

    var cardStyle = {
      borderRadius: '16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
      border: '1px solid rgba(0,0,0,0.05)'
    };

    return React.createElement(
      'div',
      { className: 'grid grid-cols-2 gap-4' },
      React.createElement(
        'div',
        {
          className: 'rounded-2xl p-5 bg-white overflow-hidden relative',
          style: cardStyle
        },
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('span', { className: 'text-xs font-semibold text-amber-600 uppercase tracking-wider' }, '역치 페이스 & 체중'),
          React.createElement('span', { className: 'text-amber-500', title: '90일 최고 페이스' },
            React.createElement('svg', { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 10V3L4 14h7v7l9-11h-7z' })
            )
          )
        ),
        logsLoading ? React.createElement(
          'div',
          { className: 'flex flex-col items-center justify-center py-6' },
          React.createElement('div', { className: 'w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mb-2' }),
          React.createElement('span', { className: 'text-xs text-gray-500' }, '로딩 중')
        ) : React.createElement('div', { className: 'space-y-3 pt-1' },
          React.createElement('div', null,
            React.createElement('div', { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1' }, '10k'),
            paceUnavailable
              ? React.createElement('div', { className: 'text-lg font-semibold text-gray-400' }, '산출 불가')
              : React.createElement('div', { className: 'text-2xl font-bold text-gray-900 tabular-nums tracking-tight leading-tight' }, paceDisplay),
            inferredNote
              ? React.createElement('div', { className: 'text-[10px] text-gray-400 mt-1' }, inferredNote)
              : null
          ),
          weight > 0
            ? React.createElement('div', { className: 'text-sm font-medium text-gray-600 pt-1 border-t border-gray-100' },
                React.createElement('span', { className: 'tabular-nums text-base font-bold text-gray-800' }, weight),
                React.createElement('span', { className: 'text-gray-500 ml-0.5' }, 'kg')
              )
            : React.createElement('div', { className: 'text-sm text-gray-400 pt-1 border-t border-gray-100' }, '체중 미등록')
        )
      ),
      React.createElement(
        'div',
        {
          className: 'rounded-2xl p-5 bg-white overflow-hidden',
          style: cardStyle
        },
        React.createElement('div', { className: 'text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1' }, '주간 목표'),
        React.createElement('div', { className: 'text-[10px] text-gray-400 mb-3' }, 'RUN 활동 rTSS'),
        logsLoading ? React.createElement(
          'div',
          { className: 'flex flex-col items-center justify-center py-8' },
          React.createElement('div', { className: 'w-8 h-8 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2' }),
          React.createElement('span', { className: 'text-xs text-gray-500' }, '로딩 중')
        ) : logsLoadError ? React.createElement(
          'div',
          { className: 'flex flex-col items-center justify-center py-6' },
          React.createElement('span', { className: 'text-xs text-red-600 mb-3 text-center' }, logsLoadError),
          React.createElement('button', {
            type: 'button',
            onClick: function() { if (retryLogsRef && retryLogsRef.current) retryLogsRef.current(); },
            className: 'px-3 py-2 bg-blue-500 text-white text-xs font-semibold rounded-lg hover:bg-blue-600 active:scale-[0.98]'
          }, '다시 시도')
        ) : React.createElement(
          'div',
          { className: 'flex flex-col items-center' },
          React.createElement(CircularWeeklyGoal, { value: pct, size: 100, strokeWidth: 10 }),
          React.createElement('div', { className: 'mt-3 text-center' },
            React.createElement('span', { className: 'font-bold text-gray-800 tabular-nums' }, formatWeeklyTssValue(weeklyProgress)),
            React.createElement('span', { className: 'text-gray-500' }, ' / '),
            React.createElement('span', { className: 'text-gray-600 tabular-nums' }, formatWeeklyTssValue(weeklyGoal)),
            React.createElement('span', { className: 'text-gray-500 text-xs ml-0.5' }, ' rTSS')
          )
        )
      )
    );
  }

  window.RunDailyQuickStats = RunDailyQuickStats;
})();
