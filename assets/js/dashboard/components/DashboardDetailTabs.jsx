/**
 * DashboardDetailTabs - Level 3 탭 구조
 * Tab 1: 나의 성향 (RiderDashboardProfile, RiderPowerProfileTrendCharts)
 * Tab 2: 최근 훈련 (TrainingTrendChart, RiderTimeInZonesCharts, RiderHeartRateProfileTrendCharts)
 * Tab 3: 성장 추이 (Vo2MaxTrendChart, GrowthTrendChart, YearlyPowerPrChart)
 *
 * 번들러 없이 CDN 사용 환경이므로 React.lazy 대신 조건부 마운트(탭 전환 시에만 렌더)로 성능 최적화
 */
/* global React, useState, useEffect, useRef, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[DashboardDetailTabs] React not loaded');
    return;
  }

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;

  var TABS = [
    { id: 'tendency', label: '나의 성향' },
    { id: 'training', label: '최근 훈련' },
    { id: 'growth', label: '성장 추이' }
  ];

  function TabSkeleton() {
    return React.createElement(
      'div',
      { className: 'space-y-4 animate-pulse' },
      [1, 2, 3].map(function(i) {
        return React.createElement(
          'div',
          {
            key: i,
            className: 'bg-white rounded-2xl p-5 shadow-sm border border-gray-100 overflow-hidden'
          },
          React.createElement('div', { className: 'h-4 bg-gray-200 rounded w-1/3 mb-4' }),
          React.createElement('div', { className: 'h-32 bg-gray-100 rounded-lg' })
        );
      })
    );
  }

  function DashboardDetailTabs(props) {
    var p = props || {};
    var userProfile = p.userProfile || null;
    var recentLogs = p.recentLogs || [];
    var fitnessData = p.fitnessData || [];
    var vo2TrendData = p.vo2TrendData || [];
    var growthTrendData = p.growthTrendData || [];
    var yearlyPowerPrData = p.yearlyPowerPrData || [];
    var logsLoading = p.logsLoading;
    var logsLoadError = p.logsLoadError;
    var retryLogsRef = p.retryLogsRef;
    var DashboardCard = p.DashboardCard;
    var stats = p.stats || {};
    var userWeight = stats.weight || (userProfile && userProfile.weight) || 0;

    var _useState = useState(0);
    var activeIndex = _useState[0];
    var setActiveIndex = _useState[1];

    var _useState2 = useState(true);
    var showSkeleton = _useState2[0];
    var setShowSkeleton = _useState2[1];

    var tabReadyTimerRef = useRef(null);

    useEffect(function() {
      setShowSkeleton(true);
      if (tabReadyTimerRef.current) clearTimeout(tabReadyTimerRef.current);
      tabReadyTimerRef.current = setTimeout(function() {
        setShowSkeleton(false);
        tabReadyTimerRef.current = null;
      }, 120);
      return function() {
        if (tabReadyTimerRef.current) clearTimeout(tabReadyTimerRef.current);
      };
    }, [activeIndex]);

    var RiderDashboardProfile = window.RiderDashboardProfile;
    var RiderPowerProfileTrendCharts = window.RiderPowerProfileTrendCharts;
    var TrainingTrendChart = window.TrainingTrendChart;
    var RiderTimeInZonesCharts = window.RiderTimeInZonesCharts;
    var RiderHeartRateProfileTrendCharts = window.RiderHeartRateProfileTrendCharts;
    var Vo2MaxTrendChart = window.Vo2MaxTrendChart;
    var GrowthTrendChart = window.GrowthTrendChart;
    var YearlyPowerPrChart = window.YearlyPowerPrChart;

    function renderTabContent() {
      if (showSkeleton) return React.createElement(TabSkeleton);

      if (activeIndex === 0) {
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          RiderDashboardProfile && React.createElement(RiderDashboardProfile, { userProfile: userProfile }),
          RiderPowerProfileTrendCharts && React.createElement(RiderPowerProfileTrendCharts, {
            DashboardCard: DashboardCard,
            userProfile: userProfile,
            recentLogs: recentLogs
          })
        );
      }

      if (activeIndex === 1) {
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '훈련 트렌드 (최근 1개월)' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: '훈련 트렌드 (최근 1개월)' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6' },
              React.createElement('span', { className: 'text-sm text-red-600 mb-3' }, logsLoadError),
              React.createElement('button', {
                type: 'button',
                onClick: function() { if (retryLogsRef && retryLogsRef.current) retryLogsRef.current(); },
                className: 'px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg'
              }, '다시 시도')
            )
          ) : TrainingTrendChart && React.createElement(TrainingTrendChart, { data: fitnessData }),
          RiderTimeInZonesCharts && React.createElement(RiderTimeInZonesCharts, {
            DashboardCard: DashboardCard,
            userProfile: userProfile,
            recentLogs: recentLogs
          }),
          RiderHeartRateProfileTrendCharts && React.createElement(RiderHeartRateProfileTrendCharts, {
            DashboardCard: DashboardCard,
            userProfile: userProfile,
            recentLogs: recentLogs
          })
        );
      }

      if (activeIndex === 2) {
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          logsLoading ? React.createElement(
            DashboardCard,
            { title: 'VO₂max 트렌드 (6개월)' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: 'VO₂max 트렌드 (6개월)' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : Vo2MaxTrendChart && React.createElement(Vo2MaxTrendChart, { data: vo2TrendData }),
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '나의 성장 트렌드 (6개월)' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: '나의 성장 트렌드 (6개월)' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : GrowthTrendChart && React.createElement(GrowthTrendChart, { data: growthTrendData }),
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '년간 파워PR 그래프' },
            React.createElement('div', { className: 'h-[240px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : YearlyPowerPrChart && React.createElement(YearlyPowerPrChart, {
            data: yearlyPowerPrData,
            userWeight: userWeight
          })
        );
      }

      return null;
    }

    return React.createElement(
      'div',
      { className: 'DashboardDetailTabs' },
      React.createElement(
        'div',
        {
          className: 'sticky top-0 z-10 bg-gray-50 -mx-4 px-4 pb-3 -mt-1 flex gap-1 overflow-x-auto scrollbar-hide',
          style: { scrollbarWidth: 'none', msOverflowStyle: 'none' }
        },
        TABS.map(function(tab, i) {
          var isActive = activeIndex === i;
          return React.createElement(
            'button',
            {
              key: tab.id,
              type: 'button',
              role: 'tab',
              'aria-selected': isActive,
              onClick: function() { setActiveIndex(i); },
              className: 'flex-shrink-0 px-5 py-3.5 text-sm font-semibold transition-all duration-200 border-b-2 -mb-0.5 ' + (
                isActive
                  ? 'text-blue-600 border-blue-500'
                  : 'text-gray-500 hover:text-gray-700 border-transparent'
              )
            },
            tab.label
          );
        })
      ),
      React.createElement(
        'div',
        { className: 'pt-4 min-h-[200px]', role: 'tabpanel' },
        renderTabContent()
      )
    );
  }

  window.DashboardDetailTabs = DashboardDetailTabs;
})();
