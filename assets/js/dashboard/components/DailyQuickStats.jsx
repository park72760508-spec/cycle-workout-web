/**
 * DailyQuickStats - 오늘의 핵심 지표 위젯 카드
 * Card 1: 파워 & 체중 (FTP, W/kg, lightning icon)
 * Card 2: 주간 훈련 목표 (Activity Ring / 반원형 게이지)
 */
/* global React, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[DailyQuickStats] React not loaded');
    return;
  }

  var React = window.React;

  function SemicircularGauge(props) {
    var value = Math.min(100, Math.max(0, Number(props.value) || 0));
    var size = props.size || 100;
    var strokeWidth = props.strokeWidth || 12;
    var color = props.color || '#059669';
    var radius = (size - strokeWidth) / 2;
    var cx = size / 2;
    var startX = cx - radius;
    var endX = cx + radius;
    var cy = size / 2;
    var arcCircumference = Math.PI * radius;
    var offset = arcCircumference - (value / 100) * arcCircumference;
    var d = 'M ' + startX + ' ' + cy + ' A ' + radius + ' ' + radius + ' 0 0 0 ' + endX + ' ' + cy;

    return React.createElement(
      'div',
      { className: 'relative inline-flex items-center justify-center', style: { width: size, height: size / 2 + 24 } },
      React.createElement(
        'svg',
        { width: size, height: size / 2 + 8, viewBox: ('0 0 ' + size + ' ' + (size / 2 + 8)), className: 'overflow-visible' },
        React.createElement('path', {
          d: d,
          fill: 'none',
          stroke: '#e5e7eb',
          strokeWidth: strokeWidth,
          strokeLinecap: 'round'
        }),
        React.createElement('path', {
          d: d,
          fill: 'none',
          stroke: color,
          strokeWidth: strokeWidth,
          strokeLinecap: 'round',
          strokeDasharray: arcCircumference,
          strokeDashoffset: offset,
          className: 'transition-all duration-700 ease-out'
        })
      ),
      React.createElement(
        'div',
        { className: 'absolute bottom-0 left-1/2 -translate-x-1/2 text-center w-full' },
        React.createElement('span', { className: 'block text-lg font-bold text-gray-900 tabular-nums' }, Math.round(value) + '%')
      )
    );
  }

  function DailyQuickStats(props) {
    var p = props || {};
    var stats = p.stats || { ftp: 0, wkg: 0, weight: 0, weeklyGoal: 225, weeklyProgress: 0 };
    var logsLoading = p.logsLoading;
    var logsLoadError = p.logsLoadError;
    var retryLogsRef = p.retryLogsRef;
    var ftpCalcLoading = p.ftpCalcLoading;
    var setFtpCalcLoading = p.setFtpCalcLoading;
    var ftpModalOpen = p.ftpModalOpen;
    var setFtpModalOpen = p.setFtpModalOpen;
    var ftpCalcResult = p.ftpCalcResult;
    var setFtpCalcResult = p.setFtpCalcResult;
    var userProfile = p.userProfile || {};

    var ftp = Number(stats.ftp) || 0;
    var wkg = stats.wkg != null ? Number(stats.wkg) : (stats.weight > 0 && ftp > 0 ? (ftp / stats.weight) : 0);
    var weight = Number(stats.weight) || 0;
    var weeklyGoal = Number(stats.weeklyGoal) || 225;
    var weeklyProgress = Math.min(Number(stats.weeklyProgress) || 0, 9999);
    var pct = weeklyGoal > 0 ? Math.min(100, Math.round((weeklyProgress / weeklyGoal) * 100)) : 0;

    var gaugeColor = pct >= 100 ? '#059669' : pct >= 70 ? '#3b82f6' : pct >= 40 ? '#f59e0b' : '#94a3b8';

    var cardStyle = {
      borderRadius: '16px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
      border: '1px solid rgba(0,0,0,0.06)'
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
        React.createElement('div', { className: 'flex items-start justify-between mb-2' },
          React.createElement('span', { className: 'text-xs font-semibold text-amber-600 uppercase tracking-wide' }, '파워 & 체중'),
          React.createElement('span', { className: 'text-lg', title: 'FTP·W/kg' }, '⚡')
        ),
        React.createElement('button', {
          type: 'button',
          onClick: async function() {
            if (ftpCalcLoading || !userProfile || !userProfile.id) return;
            if (typeof setFtpCalcLoading === 'function') setFtpCalcLoading(true);
            if (typeof setFtpCalcResult === 'function') setFtpCalcResult(null);
            try {
              var logs = [];
              if (typeof window.getUserTrainingLogs === 'function') {
                logs = await window.getUserTrainingLogs(userProfile.id, { limit: 400 }) || [];
              }
              var result = window.calculateDynamicFtp ? window.calculateDynamicFtp(logs) : { success: false, error: '함수 없음' };
              if (typeof setFtpCalcResult === 'function') setFtpCalcResult(result);
              if (typeof setFtpModalOpen === 'function') setFtpModalOpen(true);
            } catch (e) {
              if (typeof setFtpCalcResult === 'function') setFtpCalcResult({ success: false, error: (e && e.message) || '오류' });
              if (typeof setFtpModalOpen === 'function') setFtpModalOpen(true);
            } finally {
              if (typeof setFtpCalcLoading === 'function') setFtpCalcLoading(false);
            }
          },
          className: 'absolute top-3 right-3 text-[10px] px-2 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium hover:bg-amber-100 active:opacity-80',
          title: '동적 FTP 산출'
        }, ftpCalcLoading ? '...' : 'FTP 산출'),
        React.createElement('div', { className: 'space-y-1' },
          React.createElement('div', { className: 'flex items-baseline gap-1.5' },
            React.createElement('span', { className: 'text-2xl font-bold text-gray-900 tabular-nums' }, ftp),
            React.createElement('span', { className: 'text-base font-semibold text-gray-500' }, 'W')
          ),
          React.createElement('div', { className: 'flex items-baseline gap-1.5' },
            React.createElement('span', { className: 'text-xl font-bold text-gray-800 tabular-nums' }, (typeof wkg === 'number' ? wkg.toFixed(2) : wkg) || '-'),
            React.createElement('span', { className: 'text-sm text-gray-500' }, 'W/kg')
          ),
          weight > 0 && React.createElement('div', { className: 'text-sm text-gray-500 mt-2' }, weight + ' kg')
        )
      ),
      React.createElement(
        'div',
        {
          className: 'rounded-2xl p-5 bg-white overflow-hidden',
          style: cardStyle
        },
        React.createElement('div', { className: 'text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3' }, '주간 목표'),
        logsLoading ? React.createElement(
          'div',
          { className: 'flex flex-col items-center justify-center py-6' },
          React.createElement('div', { className: 'w-8 h-8 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2' }),
          React.createElement('span', { className: 'text-xs text-gray-500' }, '로딩 중')
        ) : logsLoadError ? React.createElement(
          'div',
          { className: 'flex flex-col items-center justify-center py-4' },
          React.createElement('span', { className: 'text-xs text-red-600 mb-3 text-center' }, logsLoadError),
          React.createElement('button', {
            type: 'button',
            onClick: function() { if (retryLogsRef && retryLogsRef.current) retryLogsRef.current(); },
            className: 'px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg'
          }, '다시 시도')
        ) : React.createElement(
          'div',
          { className: 'flex flex-col items-center' },
          React.createElement(SemicircularGauge, {
            value: pct,
            size: 100,
            strokeWidth: 10,
            color: gaugeColor
          }),
          React.createElement('div', { className: 'text-xs text-gray-500 mt-2 text-center' },
            React.createElement('span', { className: 'font-semibold text-gray-700' }, weeklyProgress),
            ' / ',
            React.createElement('span', null, weeklyGoal),
            ' TSS'
          )
        )
      )
    );
  }

  window.DailyQuickStats = DailyQuickStats;
})();
