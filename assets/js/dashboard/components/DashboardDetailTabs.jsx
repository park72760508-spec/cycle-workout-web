/**
 * DashboardDetailTabs - Level 3 탭 구조
 * Tab 1: 나의 성향 (RiderDashboardProfile, RiderPowerProfileTrendCharts)
 * Tab 2: 최근 훈련 (TrainingTrendChart, RiderTimeInZonesCharts, RiderHeartRateProfileTrendCharts)
 * Tab 3: 성장 추이 (STELVIO 헵타곤(레벨) → 나의 성장 트렌드 → 훈련 부하 TSS → VO₂max 트렌드 → 년간 파워PR)
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
    { id: 'wkgGuide', label: '라이딩 지표' }
  ];

  /** STELVIO 헵타곤(랭킹 상대%) — 등급은 7축 **포지션 점수**(1등=100…꼴등=0) 평균 → pTier(100-평균) + 아래. N≥100. N<100은 K·모수(코드: `stelvioOctagonPercentCutoffs`) */
  var STELVIO_OCTAGON_TIER_GUIDE_ROWS = [
    { key: 'hc', label: '레벨1', range: '5% 이하', src: 'assets/img/hc.png' },
    { key: 'c1', label: '레벨2', range: '5% 초과 ~ 10% 이하', src: 'assets/img/c1.png' },
    { key: 'c2', label: '레벨3', range: '10% 초과 ~ 20% 이하', src: 'assets/img/c2.png' },
    { key: 'c3', label: '레벨4', range: '20% 초과 ~ 40% 이하', src: 'assets/img/c3.png' },
    { key: 'c4', label: '레벨5', range: '40% 초과 ~ 60% 이하', src: 'assets/img/c4.png' },
    { key: 'c5', label: '레벨6', range: '60% 초과 ~ 80% 이하', src: 'assets/img/c5.png' },
    { key: 'c6', label: '레벨7', range: '80% 초과', src: 'assets/img/c6.png' }
  ];

  /** 프로필 카드에 있던 FTP/심박 존 테이블 — 대시보드「라이딩 지표」탭 상단 */
  function RidingMetricsZoneTables(props) {
    var userProfile = props.userProfile;
    var stats = props.stats || {};
    var standalone = !!props.standalone;
    var _hr = useState(undefined);
    var hrPeak = _hr[0];
    var setHrPeak = _hr[1];

    useEffect(
      function () {
        if (!userProfile || !userProfile.id) {
          setHrPeak(null);
          return;
        }
        var ph = Number(userProfile.max_hr);
        if (ph >= 50 && ph <= 230) {
          setHrPeak({ maxHr: ph, maxHrDate: null });
          return;
        }
        setHrPeak(undefined);
        if (typeof window.fetchMaxHrFromYearlyPeaks === 'function') {
          window.fetchMaxHrFromYearlyPeaks(userProfile.id).then(function (res) {
            setHrPeak(res != null ? res : { maxHr: 0 });
          }).catch(function () {
            setHrPeak({ maxHr: 0 });
          });
        } else {
          setHrPeak({ maxHr: 0 });
        }
      },
      [userProfile]
    );

    var ftp = Number(stats.ftp) || (userProfile && Number(userProfile.ftp)) || 0;
    var build = typeof window.buildProfileZoneTableHtml === 'function' ? window.buildProfileZoneTableHtml : null;
    if (!build) return null;

    var maxHrNum = 0;
    var maxHrDate = undefined;
    if (hrPeak && typeof hrPeak === 'object' && hrPeak.maxHr != null) {
      maxHrNum = Number(hrPeak.maxHr) || 0;
      maxHrDate = hrPeak.maxHrDate;
    }
    var z = build(ftp, hrPeak === undefined ? 0 : maxHrNum, { compact: false, maxHrDate: maxHrDate });
    var ftpHtml = z && z.ftpHtml ? z.ftpHtml : '';
    var hrHtml = '';
    if (hrPeak === undefined) {
      hrHtml =
        '<div class="profile-zone-table-block profile-zone-table-in-card"><div class="profile-zone-table-header">심박 영역</div><div class="profile-hr-loading" style="padding:12px 14px;text-align:center;color:#6b7280">최대 심박을 불러오는 중...</div></div>';
    } else {
      hrHtml = z && z.hrHtml ? z.hrHtml : '';
    }
    var html = '';
    if (ftpHtml) html += ftpHtml;
    html += hrHtml;
    if (!html) return null;
    var wrapClass =
      'dashboard-riding-metrics-zones profile-zone-tables-wrap' +
      (standalone ? ' dashboard-riding-metrics-zones-standalone' : '');
    return React.createElement('div', {
      className: wrapClass,
      dangerouslySetInnerHTML: { __html: html }
    });
  }

  /** 프로필 challenge → 표 시 행 키 (trainingManager.getWeeklyTargetTSS 키와 동일 계열) */
  function normalizeDashboardChallengeKey(challenge) {
    var keys = ['Fitness', 'GranFondo', 'Racing', 'IronMan', 'Elite', 'PRO'];
    var ch = String(challenge || 'Fitness').trim();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === ch.toLowerCase()) return keys[i];
    }
    return 'Fitness';
  }

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
    var weeklyTssTrendData = p.weeklyTssTrendData || [];
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
    var containerRef = useRef(null);

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
    var TrainingLoadTssTrendChart = window.TrainingLoadTssTrendChart;
    var GrowthTrendChart = window.GrowthTrendChart;
    var YearlyPowerPrChart = window.YearlyPowerPrChart;
    var WkgGradeIndicator = window.WkgGradeIndicator;
    var StelvioOctagonRanksCard = window.StelvioOctagonRanksCard;

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
          StelvioOctagonRanksCard &&
            React.createElement(StelvioOctagonRanksCard, { userProfile: userProfile, DashboardCard: DashboardCard }),
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '나의 성장 트렌드' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: '나의 성장 트렌드' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : GrowthTrendChart && React.createElement(GrowthTrendChart, { data: growthTrendData, userProfile: userProfile }),
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '훈련 부하 트렌드 (TSS)' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: '훈련 부하 트렌드 (TSS)' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : TrainingLoadTssTrendChart && React.createElement(TrainingLoadTssTrendChart, {
            data: weeklyTssTrendData,
            weeklyGoalTss: Number(stats.weeklyGoal) > 0 ? Number(stats.weeklyGoal) : 225
          }),
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
        var userWkgTier =
          typeof window.getWkgGradeInfo === 'function'
            ? window.getWkgGradeInfo(stats.wkg).grade
            : 'novice';
        var myChallengeKey = normalizeDashboardChallengeKey(userProfile && userProfile.challenge);
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          React.createElement(RidingMetricsZoneTables, {
            userProfile: userProfile,
            stats: stats,
            standalone: true
          }),
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
                    React.createElement('tr', { className: 'border-b border-gray-100' + (userWkgTier === 'pro' ? ' stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, 'PRO'),
                      React.createElement('td', null, '5.0 이상'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 5.2, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '블랙/골드')
                      ) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (userWkgTier === 'elite' ? ' stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, '엘리트'),
                      React.createElement('td', null, '4.2 이상 ~ 5.0 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 4.5, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '빨강 (Red)')
                      ) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (userWkgTier === 'advanced' ? ' stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, '상급'),
                      React.createElement('td', null, '3.7 이상 ~ 4.2 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 3.95, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '주황 (Orange)')
                      ) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (userWkgTier === 'intermediate' ? ' stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, '중급'),
                      React.createElement('td', null, '3.2 이상 ~ 3.7 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 3.45, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '보라 (Purple)')
                      ) : null)
                    ),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (userWkgTier === 'beginner' ? ' stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, '초급'),
                      React.createElement('td', null, '2.5 이상 ~ 3.2 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 2.85, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '초록 (Green)')
                      ) : null)
                    ),
                    React.createElement('tr', { className: (userWkgTier === 'novice' ? 'stelvio-dashboard-current-grade' : '') },
                      React.createElement('td', { className: 'py-1 pr-2' }, '입문'),
                      React.createElement('td', null, '2.5 미만'),
                      React.createElement('td', { className: 'py-1 pl-2' }, WkgGradeIndicator ? React.createElement('div', { className: 'inline-flex items-center gap-1.5 flex-wrap' },
                        React.createElement(WkgGradeIndicator, { wkg: 2.0, size: 10 }),
                        React.createElement('span', { className: 'text-gray-500' }, '노랑 (Yellow)')
                      ) : null)
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
                    React.createElement('tr', { className: 'border-b border-gray-100' + (myChallengeKey === 'Fitness' ? ' stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'Fitness'), React.createElement('td', null, '건강 유지, 기초 체력'), React.createElement('td', null, '225')),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (myChallengeKey === 'GranFondo' ? ' stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'GranFondo'), React.createElement('td', null, '중장거리 완주'), React.createElement('td', null, '400')),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (myChallengeKey === 'Racing' ? ' stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'Racing'), React.createElement('td', null, 'MCT/아마 레이스 입상권'), React.createElement('td', null, '600')),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (myChallengeKey === 'IronMan' ? ' stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'IronMan'), React.createElement('td', null, '극한의 초장거리 지구력 한계 극복 및 철인 완주'), React.createElement('td', null, '700')),
                    React.createElement('tr', { className: 'border-b border-gray-100' + (myChallengeKey === 'Elite' ? ' stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'Elite'), React.createElement('td', null, '최상위 동호인, 선수 준비'), React.createElement('td', null, '800')),
                    React.createElement('tr', { className: (myChallengeKey === 'PRO' ? 'stelvio-dashboard-current-grade' : '') }, React.createElement('td', { className: 'py-1 pr-2' }, 'PRO'), React.createElement('td', null, '프로 선수'), React.createElement('td', null, '1050'))
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
          ),
          React.createElement(
            'div',
            {
              className: 'rounded-xl border border-gray-200 bg-white overflow-hidden'
            },
            React.createElement('div', { className: 'px-4 py-3 text-xs text-gray-600' },
              React.createElement('div', { className: 'font-semibold text-gray-800 mb-1' }, 'STELVIO 헵타곤 등급표'),
              React.createElement(
                'p',
                { className: 'text-gray-500 mb-2 text-[11px] leading-relaxed' },
                '성장 추이 헵타곤: 지표는 항목별 (n−순위)/(n−1)×100(1등=100)의 **평균**을 100에서 뺀 pTier%로 등급합니다. n≥100이면 5/10/20/40/60/80% 컷, n<100이면 K·상한 보정. 종합 순위표는 heptagon_rank_log(성별·부문·avgPositionScore)로 쿼리하세요.'
              ),
              React.createElement('table', { className: 'w-full text-left border-collapse' },
                React.createElement('thead', null,
                  React.createElement('tr', { className: 'border-b border-gray-200' },
                    React.createElement('th', { className: 'py-1.5 pr-2 w-[22%]' }, '구분'),
                    React.createElement('th', { className: 'py-1.5' }, '범위(%)'),
                    React.createElement('th', { className: 'py-1.5 pl-2 w-[88px]' }, '표시')
                  )
                ),
                React.createElement(
                  'tbody',
                  null,
                  STELVIO_OCTAGON_TIER_GUIDE_ROWS.map(function(row) {
                    return React.createElement(
                      'tr',
                      { key: 'stelvio-octagon-tier-card-' + row.key, className: 'border-b border-gray-100' },
                      React.createElement('td', { className: 'py-1.5 pr-2 font-medium text-gray-800' }, row.label),
                      React.createElement('td', { className: 'py-1.5 text-gray-600' }, row.range),
                      React.createElement(
                        'td',
                        { className: 'py-1.5 pl-2 align-middle' },
                        React.createElement('img', {
                          src: row.src,
                          alt: row.label,
                          className: 'h-9 w-9 object-contain',
                          loading: 'lazy',
                          decoding: 'async',
                          draggable: false
                        })
                      )
                    );
                  })
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
      { className: 'DashboardDetailTabs', ref: containerRef },
      React.createElement(
        'div',
        {
          className: 'sticky top-0 z-10 bg-gray-50 -mx-4 px-4 pb-3 -mt-1 flex gap-2 overflow-x-auto scrollbar-hide items-center',
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
                  /* 탭 버튼 가로 스크롤 */
                  var refs = tabRefs.current;
                  if (refs && Array.isArray(refs)) {
                    var targetIdx = i <= 1 ? 0 : 3;
                    var el = refs[targetIdx];
                    if (el && typeof el.scrollIntoView === 'function') {
                      el.scrollIntoView({ inline: targetIdx === 0 ? 'start' : 'end', block: 'nearest', behavior: 'smooth' });
                    }
                  }
                  /* 탭 컨테이너 최상단으로 세로 스크롤 */
                  var container = containerRef.current;
                  if (container) {
                    var rect = container.getBoundingClientRect();
                    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
                    var targetY = scrollTop + rect.top - 8;
                    if (targetY < scrollTop) targetY = scrollTop;
                    window.scrollTo({ top: targetY, behavior: 'smooth' });
                  }
                }, 50);
              },
              className:
                'flex-shrink-0 px-4 py-2.5 text-sm transition-all duration-200 rounded-[10px] ' +
                (isActive
                  ? 'font-bold bg-white text-[#7c3aed] border-[1.5px] border-[#7c3aed] shadow-[0_2px_8px_rgba(124,58,237,0.14)]'
                  : 'font-semibold text-gray-700 bg-gray-200 border-0 shadow-none hover:bg-gray-300 hover:text-gray-900')
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
