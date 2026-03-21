/**
 * DailyQuickStats - 오늘의 핵심 지표 위젯 카드 (Strava/Garmin 수준 프리미엄 UI)
 * Card 1: 파워 & 체중 (FTP, W/kg, 번개 아이콘, 타이포그래피 계층)
 * Card 2: 주간 훈련 목표 (원형 프로그레스/도넛, 애니메이션, 동적 색상)
 *
 * FTP 산출: 기존 window.calculateDynamicFtp(logs) + setFtpModalOpen(true) 연동
 */
/* global React, useState, useEffect, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[DailyQuickStats] React not loaded');
    return;
  }

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;

  /**
   * 주간 목표 원형 프로그레스 (Donut Chart)
   * - 마운트 시 0% → 목표% 부드러운 애니메이션
   * - 진행률별 동적 색상: 50% 미만 주황, 50~80% 파랑, 80% 이상 녹색
   */
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
        React.createElement('span', { className: 'text-[10px] text-gray-500 mt-0.5 font-medium' }, 'TSS')
      )
    );
  }

  function DailyQuickStats(props) {
    var p = props || {};
    var stats = p.stats || { ftp: 0, wkg: 0, weight: 0, weeklyGoal: 225, weeklyProgress: 0 };
    var logsLoading = p.logsLoading;
    var logsLoadError = p.logsLoadError;
    var retryLogsRef = p.retryLogsRef;

    var ftp = Number(stats.ftp) || 0;
    var wkg = stats.wkg != null ? Number(stats.wkg) : (stats.weight > 0 && ftp > 0 ? (ftp / stats.weight) : 0);
    var weight = Number(stats.weight) || 0;
    var weeklyGoal = Number(stats.weeklyGoal) || 225;
    var weeklyProgress = Math.min(Number(stats.weeklyProgress) || 0, 9999);
    var pct = weeklyGoal > 0 ? Math.min(100, Math.round((weeklyProgress / weeklyGoal) * 100)) : 0;

    var cardStyle = {
      borderRadius: '16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
      border: '1px solid rgba(0,0,0,0.05)'
    };

    function handleFtpCalc() {
      if (ftpCalcLoading || !userProfile || !userProfile.id) return;
      if (typeof setFtpCalcLoading === 'function') setFtpCalcLoading(true);
      if (typeof setFtpCalcResult === 'function') setFtpCalcResult(null);
      (async function() {
        try {
          var logs = [];
          if (typeof window.getUserTrainingLogs === 'function') {
            logs = await window.getUserTrainingLogs(userProfile.id, { limit: 400 }) || [];
          }
          var result = window.calculateDynamicFtp ? window.calculateDynamicFtp(logs) : { success: false, error: 'FTP 산출 함수를 불러올 수 없습니다.' };
          if (typeof setFtpCalcResult === 'function') setFtpCalcResult(result);
          if (typeof setFtpModalOpen === 'function') setFtpModalOpen(true);
        } catch (e) {
          if (typeof setFtpCalcResult === 'function') setFtpCalcResult({ success: false, error: (e && e.message) || '오류가 발생했습니다.' });
          if (typeof setFtpModalOpen === 'function') setFtpModalOpen(true);
        } finally {
          if (typeof setFtpCalcLoading === 'function') setFtpCalcLoading(false);
        }
      })();
    }

    return React.createElement(
      'div',
      { className: 'grid grid-cols-2 gap-4' },
      // Card 1: 파워 & 체중
      React.createElement(
        'div',
        {
          className: 'rounded-2xl p-5 bg-white overflow-hidden relative',
          style: cardStyle
        },
        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
          React.createElement('span', { className: 'text-xs font-semibold text-amber-600 uppercase tracking-wider' }, '파워 & 체중'),
          React.createElement('span', { className: 'text-amber-500', title: 'FTP·W/kg' },
            React.createElement('svg', { className: 'w-5 h-5', fill: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', { d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' })
            )
          )
        ),
        React.createElement('div', { className: 'space-y-3 pt-1' },
          React.createElement('div', { className: 'flex items-baseline gap-1' },
            React.createElement('span', { className: 'text-3xl font-bold text-gray-900 tabular-nums tracking-tight' }, ftp),
            React.createElement('span', { className: 'text-base font-medium text-gray-400 align-baseline' }, 'W')
          ),
          React.createElement('div', { className: 'flex items-baseline gap-1' },
            React.createElement('span', { className: 'text-2xl font-bold text-gray-800 tabular-nums' }, (typeof wkg === 'number' ? wkg.toFixed(2) : wkg) || '-'),
            React.createElement('span', { className: 'text-sm font-medium text-gray-400' }, 'W/kg')
          ),
          weight > 0 && React.createElement('div', { className: 'text-sm font-medium text-gray-500' },
            React.createElement('span', { className: 'tabular-nums' }, weight),
            React.createElement('span', { className: 'text-gray-400 ml-0.5' }, 'kg')
          )
        )
      ),
      // Card 2: 주간 목표
      React.createElement(
        'div',
        {
          className: 'rounded-2xl p-5 bg-white overflow-hidden',
          style: cardStyle
        },
        React.createElement('div', { className: 'text-xs font-semibold text-blue-600 uppercase tracking-wider mb-4' }, '주간 목표'),
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
            React.createElement('span', { className: 'font-bold text-gray-800 tabular-nums' }, weeklyProgress),
            React.createElement('span', { className: 'text-gray-500' }, ' / '),
            React.createElement('span', { className: 'text-gray-600' }, weeklyGoal),
            React.createElement('span', { className: 'text-gray-500 text-xs ml-0.5' }, ' TSS')
          )
        )
      )
    );
  }

  window.DailyQuickStats = DailyQuickStats;
})();
