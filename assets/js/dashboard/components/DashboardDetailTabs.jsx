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
    { id: 'growth', label: '성장 추이' },
    { id: 'wkgGuide', label: 'W/kg · 등급 기준 안내' }
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
    var tabRefs = useRef([]);

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
    var WkgGradeIndicator = window.WkgGradeIndicator;

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
            { title: 'VO₂max 트렌드' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: 'VO₂max 트렌드' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : Vo2MaxTrendChart && React.createElement(Vo2MaxTrendChart, { data: vo2TrendData, userProfile: userProfile }),
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
          ) : GrowthTrendChart && React.createElement(GrowthTrendChart, { data: growthTrendData, userProfile: userProfile }),
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

      if (activeIndex === 3) {
        var wkgVal = stats.wkg != null ? (typeof stats.wkg === 'number' ? stats.wkg.toFixed(2) : stats.wkg) : '-';
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          React.createElement(
            'div',
            { className: 'rounded-xl border border-gray-200 bg-white overflow-hidden' },
            React.createElement('div', { className: 'px-4 pb-4 pt-1 space-y-4 text-xs text-gray-600 border-t-0' },
              React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, 'W/kg 표시 기준'),
                React.createElement('ul', { className: 'space-y-1 pl-4 list-disc' },
                  React.createElement('li', null, React.createElement('strong', null, '계산식'), ': W/kg = FTP(와트) ÷ 체중(kg) — 소수점 둘째자리'),
                  React.createElement('li', null, '대시보드 "파워" 카드에 ', React.createElement('code', { className: 'bg-gray-100 px-1 rounded' }, wkgVal + ' W/kg'), ' 로 표시')
                )
              ),
              React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, 'W/kg 기반 등급 (네온/패널용)'),
                React.createElement('table', { className: 'w-full text-left border-collapse' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className: 'border-b border-gray-200' },
                      React.createElement('th', { className: 'py-1 pr-2' }, '등급'),
                      React.createElement('th', { className: 'py-1' }, 'W/kg 기준'),
                      React.createElement('th', { className: 'py-1 pl-2' }, '표시등')
                    )
                  ),
                  React.createElement('tbody', null,
                    React.createElement('tr', { className: 'border-b border-gray-100' },
                      React.createElement('td', { className: 'py-1 pr-2' }, '엘리트'),
                      React.createElement('td', null, '4.0 이상'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center' }, React.createElement(WkgGradeIndicator, { wkg: 4.5, size: 10 })) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' },
                      React.createElement('td', { className: 'py-1 pr-2' }, '고급'),
                      React.createElement('td', null, '3.5 이상 ~ 4.0 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center' }, React.createElement(WkgGradeIndicator, { wkg: 3.7, size: 10 })) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' },
                      React.createElement('td', { className: 'py-1 pr-2' }, '중급'),
                      React.createElement('td', null, '3.0 이상 ~ 3.5 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center' }, React.createElement(WkgGradeIndicator, { wkg: 3.2, size: 10 })) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' },
                      React.createElement('td', { className: 'py-1 pr-2' }, '입문'),
                      React.createElement('td', null, '2.2 이상 ~ 3.0 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center' }, React.createElement(WkgGradeIndicator, { wkg: 2.5, size: 10 })) : null)
                    ),
                    React.createElement('tr', null,
                      React.createElement('td', { className: 'py-1 pr-2' }, '초급'),
                      React.createElement('td', null, '2.2 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center' }, React.createElement(WkgGradeIndicator, { wkg: 1.8, size: 10 })) : null)
                    )
                  )
                )
              ),
              React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, '훈련 등급(challenge) · 주간 목표 TSS'),
                React.createElement('p', { className: 'mb-2' }, '회원가입/프로필에서 선택. 주간 목표 TSS · RPE 보정 · 목표 조절 범위에 사용'),
                React.createElement('table', { className: 'w-full text-left border-collapse' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className: 'border-b border-gray-200' },
                      React.createElement('th', { className: 'py-1 pr-2' }, '등급'),
                      React.createElement('th', { className: 'py-1' }, '설명'),
                      React.createElement('th', { className: 'py-1' }, '목표 TSS')
                    )
                  ),
                  React.createElement('tbody', null,
                    React.createElement('tr', { className: 'border-b border-gray-100' }, React.createElement('td', { className: 'py-1 pr-2' }, 'Fitness'), React.createElement('td', null, '건강 유지, 기초 체력'), React.createElement('td', null, '225')),
                    React.createElement('tr', { className: 'border-b border-gray-100' }, React.createElement('td', { className: 'py-1 pr-2' }, 'GranFondo'), React.createElement('td', null, '중장거리 완주'), React.createElement('td', null, '400')),
                    React.createElement('tr', { className: 'border-b border-gray-100' }, React.createElement('td', { className: 'py-1 pr-2' }, 'Racing'), React.createElement('td', null, 'MCT/아마 레이스 입상권'), React.createElement('td', null, '600')),
                    React.createElement('tr', { className: 'border-b border-gray-100' }, React.createElement('td', { className: 'py-1 pr-2' }, 'IronMan'), React.createElement('td', null, '극한의 초장거리 지구력 한계 극복 및 철인 완주'), React.createElement('td', null, '700')),
                    React.createElement('tr', { className: 'border-b border-gray-100' }, React.createElement('td', { className: 'py-1 pr-2' }, 'Elite'), React.createElement('td', null, '최상위 동호인, 선수 준비'), React.createElement('td', null, '800')),
                    React.createElement('tr', null, React.createElement('td', { className: 'py-1 pr-2' }, 'PRO'), React.createElement('td', null, '프로 선수'), React.createElement('td', null, '1050'))
                  )
                )
              ),
              React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, '권한 등급(grade)'),
                React.createElement('ul', { className: 'space-y-1 pl-4 list-disc' },
                  React.createElement('li', null, React.createElement('strong', null, '1'), ': 💎 Diamond (관리자)'),
                  React.createElement('li', null, React.createElement('strong', null, '2'), ': ⭐ Member (일반 회원)'),
                  React.createElement('li', null, React.createElement('strong', null, '3'), ': 👑 Admin (코치/관리)')
                )
              )
            )
          )
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
              ref: (function(idx) { return function(el) { if (tabRefs.current) tabRefs.current[idx] = el; }; })(i),
              type: 'button',
              role: 'tab',
              'aria-selected': isActive,
              onClick: function() {
                setActiveIndex(i);
                setTimeout(function() {
                  var refs = tabRefs.current;
                  if (!refs || !Array.isArray(refs)) return;
                  var targetIdx = i <= 1 ? 0 : 3;
                  var el = refs[targetIdx];
                  if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ inline: targetIdx === 0 ? 'start' : 'end', block: 'nearest', behavior: 'smooth' });
                  }
                }, 50);
              },
              className: 'flex-shrink-0 px-5 py-3.5 text-sm font-semibold transition-all duration-200 border-b-2 -mb-0.5 ' + (
                isActive
                  ? 'border-[#667eea]'
                  : 'text-gray-500 hover:text-gray-700 border-transparent'
              ),
              style: isActive ? { color: '#667eea' } : {}
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
