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

  var CYCLE_CHALLENGE_GUIDE_ROWS = [
    { key: 'Fitness', label: 'Fitness', desc: '건강 유지, 기초 체력', goalRange: '225' },
    { key: 'GranFondo', label: 'GranFondo', desc: '중장거리 완주', goalRange: '400' },
    { key: 'Racing', label: 'Racing', desc: 'MCT/아마 레이스 입상권', goalRange: '600' },
    { key: 'IronMan', label: 'IronMan', desc: '극한의 초장거리 지구력 한계 극복 및 철인 완주', goalRange: '700' },
    { key: 'Elite', label: 'Elite', desc: '최상위 동호인, 선수 준비', goalRange: '800' },
    { key: 'PRO', label: 'PRO', desc: '프로 선수', goalRange: '1050' }
  ];

  /** RUN 훈련 등급(challenge) · 주간 목표 rTSS (trainingManager.RUN_TRAINING_LEVELS와 동일) */
  var RUN_CHALLENGE_GUIDE_ROWS = [
    { key: 'Fitness', label: 'Fitness', desc: '기초 체력 형성(5~10k 완주)', goalRange: '150 ~ 200' },
    { key: 'CityRunner', label: 'City Runner', desc: '10k 페이스 단축 및 하프 마라톤(20k) 완주 목표', goalRange: '300 ~ 350' },
    { key: 'Challenger', label: 'Challenger', desc: '풀마라톤(42k) Sub-4(4시간 이내) 달성', goalRange: '450 ~ 550' },
    { key: 'Sub3Club', label: 'Sub-3 Club', desc: "마라톤 꿈의 기록 'Sub-3' 달성 및 최상위 동호인 (마스터즈 입상권)", goalRange: '600 ~ 700' },
    { key: 'Elite', label: 'Elite', desc: '대학/실업 육상 선수 및 전문 엘리트 러너 수준', goalRange: '750 ~ 850' },
    { key: 'PRO', label: 'PRO', desc: '프로 마라토너 및 국가대표 수준', goalRange: '900 +' }
  ];

  function resolveDashboardSportCategory(props, userProfile) {
    var explicit = props && props.sportCategory;
    if (explicit) {
      var s = String(explicit).trim().toLowerCase();
      if (s === 'run') return 'run';
      if (s === 'cycle') return 'cycle';
    }
    var cat = userProfile && (userProfile.category || userProfile.sport_category);
    var normalized = typeof window.normalizeUserSportCategory === 'function'
      ? window.normalizeUserSportCategory(cat)
      : String(cat || '').trim().toUpperCase();
    if (normalized === 'CYCLE+RUN') {
      if (typeof window.sportCategoryRoutes !== 'undefined' && typeof window.sportCategoryRoutes.getActiveSport === 'function') {
        return window.sportCategoryRoutes.getActiveSport() === 'run' ? 'run' : 'cycle';
      }
      return 'cycle';
    }
    if (cat && String(cat).trim().toUpperCase() === 'RUN') return 'run';
    return 'cycle';
  }

  function getDashboardTabs(isRun) {
    return [
      { id: 'tendency', label: '나의 성향' },
      { id: 'training', label: '최근 훈련' },
      { id: 'growth', label: '성장 추이' },
      { id: 'wkgGuide', label: isRun ? '러닝 지표' : '라이딩 지표' }
    ];
  }

  /** STELVIO 헵타곤(랭킹 상대%) — 등급은 7축 **포지션 점수**(1등=100…꼴등=0) 평균 → pTier(100-평균) + 아래. N≥100. N<100은 K·모수(코드: `stelvioOctagonPercentCutoffs`) */
  var STELVIO_OCTAGON_TIER_GUIDE_ROWS = [
    { key: 'hc', label: '레벨A', range: '5% 이하', src: 'assets/img/A.svg' },
    { key: 'c1', label: '레벨B', range: '5% 초과 ~ 10% 이하', src: 'assets/img/B.svg' },
    { key: 'c2', label: '레벨C', range: '10% 초과 ~ 20% 이하', src: 'assets/img/C.svg' },
    { key: 'c3', label: '레벨D', range: '20% 초과 ~ 40% 이하', src: 'assets/img/D.svg' },
    { key: 'c4', label: '레벨E', range: '40% 초과 ~ 60% 이하', src: 'assets/img/E.svg' },
    { key: 'c5', label: '레벨F', range: '60% 초과 ~ 80% 이하', src: 'assets/img/F.svg' },
    { key: 'c6', label: '레벨G', range: '80% 초과', src: 'assets/img/G.svg' }
  ];

  /** STELVIO 헥사곤(RUN) — 10km 완주 기록·평균 페이스(min/km) 기준 7단계 */
  var STELVIO_HEXAGON_TIER_GUIDE_ROWS = [
    { key: 'hc', label: '레벨A', range: '4분00초 이내 / ~ 40분', src: 'assets/img/A.svg' },
    { key: 'c1', label: '레벨B', range: '4분30초 이내 / ~ 45분', src: 'assets/img/B.svg' },
    { key: 'c2', label: '레벨C', range: '5분00초 이내 / ~ 50분', src: 'assets/img/C.svg' },
    { key: 'c3', label: '레벨D', range: '6분00초 이내 / ~ 60분', src: 'assets/img/D.svg' },
    { key: 'c4', label: '레벨E', range: '7분00초 이내 / ~ 70분', src: 'assets/img/E.svg' },
    { key: 'c5', label: '레벨F', range: '8분00초 이내 / ~ 80분', src: 'assets/img/F.svg' },
    { key: 'c6', label: '레벨G', range: '9분00초 초과 / 90분 ~', src: 'assets/img/G.svg' }
  ];

  /** 프로필 카드 FTP/TP·심박 존 테이블 — 대시보드「라이딩/러닝 지표」탭 상단 */
  function MetricsZoneTables(props) {
    var userProfile = props.userProfile;
    var stats = props.stats || {};
    var standalone = !!props.standalone;
    var isRun = !!props.isRun;
    var _hr = useState(undefined);
    var hrPeak = _hr[0];
    var setHrPeak = _hr[1];

    useEffect(
      function () {
        if (!userProfile || !userProfile.id) {
          setHrPeak(null);
          return;
        }
        setHrPeak(undefined);
        if (isRun) {
          var fetchRunPeak =
            typeof window.fetchRunPeakMaxHrFromLogs === 'function'
              ? window.fetchRunPeakMaxHrFromLogs
              : window.runEffortsReadClient && window.runEffortsReadClient.fetchRunPeakMaxHrFromLogs;
          if (typeof fetchRunPeak === 'function') {
            fetchRunPeak(userProfile.id).then(function (res) {
              setHrPeak(res != null ? res : { maxHr: 0 });
            }).catch(function () {
              setHrPeak({ maxHr: 0 });
            });
          } else {
            setHrPeak({ maxHr: 0 });
          }
          return;
        }
        var ph = Number(userProfile.max_hr);
        if (ph >= 50 && ph <= 230) {
          setHrPeak({ maxHr: ph, maxHrDate: null });
          return;
        }
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
      [userProfile, isRun]
    );

    var ftp = isRun
      ? 0
      : (Number(stats.ftp) || (userProfile && Number(userProfile.ftp)) || 0);
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
    if (!isRun && ftpHtml) html += ftpHtml;
    html += hrHtml;
    if (!html) return null;
    var wrapClass =
      (isRun ? 'dashboard-running-metrics-zones' : 'dashboard-riding-metrics-zones') +
      ' profile-zone-tables-wrap' +
      (standalone ? (isRun ? ' dashboard-running-metrics-zones-standalone' : ' dashboard-riding-metrics-zones-standalone') : '');
    return React.createElement('div', {
      className: wrapClass,
      dangerouslySetInnerHTML: { __html: html }
    });
  }

  /** 프로필 challenge → 표 시 행 키 */
  function normalizeDashboardChallengeKey(challenge, isRun) {
    if (isRun) {
      var runKeys = ['Fitness', 'CityRunner', 'Challenger', 'Sub3Club', 'Elite', 'PRO'];
      var legacyMap = {
        GranFondo: 'CityRunner',
        Racing: 'Challenger',
        IronMan: 'Sub3Club',
        PR: 'Fitness',
        MastersRace: 'Challenger'
      };
      var chRun = String(challenge || 'Fitness').trim();
      for (var r = 0; r < runKeys.length; r++) {
        if (runKeys[r].toLowerCase() === chRun.toLowerCase()) return runKeys[r];
      }
      if (legacyMap[chRun]) return legacyMap[chRun];
      return 'Fitness';
    }
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
    var growthYearlyPr = p.growthYearlyPr || null;
    var yearlyPowerPrData = p.yearlyPowerPrData || [];
    var logsLoading = p.logsLoading;
    var logsLoadError = p.logsLoadError;
    var retryLogsRef = p.retryLogsRef;
    var DashboardCard = p.DashboardCard;
    var stats = p.stats || {};
    var userWeight = stats.weight || (userProfile && userProfile.weight) || 0;
    var isRun = resolveDashboardSportCategory(p, userProfile) === 'run';
    var tabs = getDashboardTabs(isRun);
    var loadLabel = isRun ? 'rTSS' : 'TSS';
    var defaultWeeklyGoal = isRun ? 175 : 225;
    var weeklyGoalValue = isRun
      ? (Number(stats.weeklyRtssGoal) > 0 ? Number(stats.weeklyRtssGoal) : defaultWeeklyGoal)
      : (Number(stats.weeklyGoal) > 0 ? Number(stats.weeklyGoal) : defaultWeeklyGoal);

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
    var StelvioHexagonRanksCard = window.StelvioHexagonRanksCard;
    var RunHexagonTendencyCard = window.RunHexagonTendencyCard;
    var RankPolygonCard = isRun ? StelvioHexagonRanksCard : StelvioOctagonRanksCard;

    function renderTabContent() {
      if (showSkeleton) return React.createElement(TabSkeleton);

      if (activeIndex === 0) {
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          isRun && RunHexagonTendencyCard && React.createElement(RunHexagonTendencyCard, {
            hexagonContext: p.hexagonCoachContext,
            userProfile: userProfile,
            stats: stats,
            DashboardCard: DashboardCard
          }),
          !isRun && RiderDashboardProfile && React.createElement(RiderDashboardProfile, { userProfile: userProfile }),
          !isRun && RiderPowerProfileTrendCharts && React.createElement(RiderPowerProfileTrendCharts, {
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
          /* 훈련 부하 트렌드 (TSS) — 최근 훈련 탭 최상단 */
          logsLoading ? React.createElement(
            DashboardCard,
            { title: '훈련 부하 트렌드 (' + loadLabel + ')' },
            React.createElement('div', { className: 'h-[200px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : logsLoadError ? React.createElement(
            DashboardCard,
            { title: '훈련 부하 트렌드 (' + loadLabel + ')' },
            React.createElement('div', { className: 'flex flex-col items-center justify-center py-6 text-gray-500 text-sm' }, '로그 로드 실패')
          ) : TrainingLoadTssTrendChart && React.createElement(TrainingLoadTssTrendChart, {
            data: weeklyTssTrendData,
            weeklyGoalTss: weeklyGoalValue
          }),
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
          ) : TrainingTrendChart && React.createElement(TrainingTrendChart, { data: fitnessData, isRun: isRun }),
          !isRun && RiderHeartRateProfileTrendCharts && React.createElement(RiderHeartRateProfileTrendCharts, {
            DashboardCard: DashboardCard,
            userProfile: userProfile,
            recentLogs: recentLogs
          }),
          !isRun && RiderTimeInZonesCharts && React.createElement(RiderTimeInZonesCharts, {
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
          RankPolygonCard &&
            React.createElement(RankPolygonCard, {
              userProfile: userProfile,
              DashboardCard: DashboardCard,
              stats: isRun ? stats : undefined
            }),
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
          ) : GrowthTrendChart && React.createElement(GrowthTrendChart, { data: growthTrendData, yearlyGrowthPr: growthYearlyPr, userProfile: userProfile, isRun: isRun }),
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
          !isRun && logsLoading ? React.createElement(
            DashboardCard,
            { title: '년간 파워PR 그래프' },
            React.createElement('div', { className: 'h-[240px] flex flex-col items-center justify-center' },
              React.createElement('div', { className: 'w-10 h-10 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-3' }),
              React.createElement('span', { className: 'text-sm text-gray-500' }, '로딩 중...')
            )
          ) : !isRun && YearlyPowerPrChart && React.createElement(YearlyPowerPrChart, {
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
        var activeChallenge = (typeof window.resolveChallengeForSport === 'function')
          ? window.resolveChallengeForSport(userProfile, isRun ? 'run' : 'cycle')
          : (userProfile && userProfile.challenge);
        var myChallengeKey = normalizeDashboardChallengeKey(activeChallenge, isRun);
        var challengeGuideRows = isRun ? RUN_CHALLENGE_GUIDE_ROWS : CYCLE_CHALLENGE_GUIDE_ROWS;
        var challengeGoalHeader = isRun ? '주간 목표 rTSS' : '목표 TSS';
        var challengeSectionTitle = isRun ? '훈련 등급(challenge) · 주간 목표 rTSS' : '훈련 등급(challenge) · 주간 목표 TSS';
        var challengeSectionDesc = isRun
          ? '회원가입/프로필에서 선택. 주간 목표 rTSS · RPE 보정 · 목표 조절 범위에 사용'
          : '회원가입/프로필에서 선택. 주간 목표 TSS · RPE 보정 · 목표 조절 범위에 사용';
        var polygonTierTitle = isRun ? 'STELVIO 헥사곤 등급표' : 'STELVIO 헵타곤 등급표';
        var polygonTierDesc = '성장 추이 헵타곤: 지표는 항목별 (n−순위)/(n−1)×100(1등=100)의 **평균**을 100에서 뺀 pTier%로 등급합니다. n≥100이면 5/10/20/40/60/80% 컷, n<100이면 K·상한 보정. 종합 순위표는 heptagon_rank_log(성별·부문·avgPositionScore)로 쿼리하세요.';
        var polygonTierGuideRows = isRun ? STELVIO_HEXAGON_TIER_GUIDE_ROWS : STELVIO_OCTAGON_TIER_GUIDE_ROWS;
        var polygonTierRangeHeader = isRun ? '10k 페이스 / 기록' : '범위(%)';
        return React.createElement(
          'div',
          { className: 'space-y-6' },
          React.createElement(MetricsZoneTables, {
            userProfile: userProfile,
            stats: stats,
            standalone: true,
            isRun: isRun
          }),
          React.createElement(
            'div',
            { className: 'rounded-xl border border-gray-200 bg-white overflow-hidden' },
            React.createElement('div', { className: 'px-4 pb-4 pt-1 space-y-4 text-xs text-gray-600 border-t-0' },
              !isRun ? React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, 'W/kg 표시 기준'),
                React.createElement('ul', { className: 'space-y-1 pl-4 list-disc' },
                  React.createElement('li', null, React.createElement('strong', null, '계산식'), ': W/kg = FTP(와트) ÷ 체중(kg) — 소수점 둘째자리'),
                  React.createElement('li', null, '대시보드 "파워" 카드에 ', React.createElement('code', { className: 'bg-gray-100 px-1 rounded' }, wkgVal + ' W/kg'), ' 로 표시')
                )
              ) : null,
              !isRun ? React.createElement('section', null,
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
              ) : null,
              React.createElement('section', null,
                React.createElement('div', { className: 'font-semibold text-gray-800 mb-2' }, challengeSectionTitle),
                React.createElement('p', { className: 'mb-2' }, challengeSectionDesc),
                React.createElement('table', { className: 'w-full text-left border-collapse' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className: 'border-b border-gray-200' },
                      React.createElement('th', { className: 'py-1 pr-2' }, '등급'),
                      React.createElement('th', { className: 'py-1' }, '설명'),
                      React.createElement('th', { className: 'py-1' }, challengeGoalHeader)
                    )
                  ),
                  React.createElement('tbody', null,
                    challengeGuideRows.map(function(row, idx) {
                      var rowClass = (idx < challengeGuideRows.length - 1 ? 'border-b border-gray-100' : '') +
                        (myChallengeKey === row.key ? ' stelvio-dashboard-current-grade' : '');
                      return React.createElement(
                        'tr',
                        { key: 'challenge-guide-' + row.key, className: rowClass },
                        React.createElement('td', { className: 'py-1 pr-2' }, row.label),
                        React.createElement('td', null, row.desc),
                        React.createElement('td', null, row.goalRange)
                      );
                    })
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
              React.createElement('div', { className: 'font-semibold text-gray-800 mb-1' }, polygonTierTitle),
              isRun
                ? React.createElement(
                    'div',
                    { className: 'text-gray-500 mb-2 text-[11px] leading-relaxed space-y-1' },
                    React.createElement('p', { className: 'm-0' }, '러닝 등급은 10km 완주 기록과 평균 페이스(min/km)를 기준으로 입문부터 프로까지 총 7단계로 세분화되었습니다.'),
                    React.createElement('p', { className: 'm-0' }, '자신의 10km 기록을 바탕으로 현재 속한 레벨을 직접 확인하고, 앞으로의 러닝 목표를 세워보세요!')
                  )
                : React.createElement(
                    'p',
                    { className: 'text-gray-500 mb-2 text-[11px] leading-relaxed' },
                    polygonTierDesc
                  ),
              React.createElement('table', { className: 'w-full text-left border-collapse' },
                React.createElement('thead', null,
                  React.createElement('tr', { className: 'border-b border-gray-200' },
                    React.createElement('th', { className: 'py-1.5 pr-2 w-[22%]' }, '구분'),
                    React.createElement('th', { className: 'py-1.5' }, polygonTierRangeHeader),
                    React.createElement('th', { className: 'py-1.5 pl-2 w-[88px]' }, '표시')
                  )
                ),
                React.createElement(
                  'tbody',
                  null,
                  polygonTierGuideRows.map(function(row) {
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
        tabs.map(function(tab, i) {
          var isActive = activeIndex === i;
          return React.createElement(
            'button',
            {
              key: tab.id,
              ref: (function(idx) { return function(el) { if (tabRefs.current) tabRefs.current[idx] = el; }; })(i),
              type: 'button',
              role: 'tab',
              'aria-selected': isActive,
              onClick: (function(clickedI) {
                return function() {
                  setActiveIndex(clickedI);
                  setTimeout(function() {
                    /* 탭 버튼 가로 스크롤 */
                    var refs = tabRefs.current;
                    if (refs && Array.isArray(refs)) {
                      var targetIdx = clickedI <= 1 ? 0 : 3;
                      var el = refs[targetIdx];
                      if (el && typeof el.scrollIntoView === 'function') {
                        try {
                          el.scrollIntoView({ inline: targetIdx === 0 ? 'start' : 'end', block: 'nearest', behavior: 'smooth' });
                        } catch (e) { el.scrollIntoView(false); }
                      }
                    }
                    /* 세로 스크롤: 탭 컨테이너 상단 — iOS/Android 호환 */
                    var container = containerRef.current;
                    if (!container) return;
                    /* 1순위: scrollIntoView — iOS Safari 포함 모든 모바일 지원 */
                    if (typeof container.scrollIntoView === 'function') {
                      try {
                        container.scrollIntoView({ block: 'start', behavior: 'smooth' });
                        return;
                      } catch (e1) {
                        try { container.scrollIntoView(true); return; } catch (e2) {}
                      }
                    }
                    /* 2순위: window.scrollTo — iOS 구형은 options 미지원 → 수동 fallback */
                    var scrollTop = window.pageYOffset
                      || (document.documentElement ? document.documentElement.scrollTop : 0)
                      || (document.body ? document.body.scrollTop : 0)
                      || 0;
                    var rect = container.getBoundingClientRect();
                    var targetY = Math.max(0, scrollTop + rect.top - 8);
                    try {
                      window.scrollTo({ top: targetY, behavior: 'smooth' });
                    } catch (e3) {
                      window.scrollTo(0, targetY);
                      try { document.documentElement.scrollTop = targetY; } catch (e4) {}
                      try { document.body.scrollTop = targetY; } catch (e5) {}
                    }
                  }, 80);
                };
              })(i),
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
