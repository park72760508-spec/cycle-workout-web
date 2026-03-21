/**
 * PerformanceDashboard - 리팩터링된 대시보드 최상위 컴포넌트
 * Level 1: AICoachHeroCard (Hero)
 * Level 2: DailyQuickStats (Quick Stats)
 * Level 3: DashboardDetailTabs (탭 구조)
 *
 * @see docs/대시보드_리팩터링_디렉터리_구조.md
 */
/* global React, useState, useLayoutEffect, useEffect, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[PerformanceDashboard] React not loaded');
    return;
  }

  var ReactObj = window.React;
  var useState = ReactObj.useState;
  var useLayoutEffect = ReactObj.useLayoutEffect || ReactObj.useEffect;
  var useEffect = ReactObj.useEffect;

  function formatPoints(points) {
    var num = Math.round(Number(points) || 0);
    if (num >= 1000) {
      var k = num / 1000;
      return k % 1 === 0 ? k + 'k' : k.toFixed(1) + 'k';
    }
    return num.toString();
  }

  function getGradeBadge(grade) {
    if (!grade) return '';
    if (grade === '1') return '관리자';
    if (grade === '2') return '회원';
    return '등급 ' + grade;
  }

  function PerformanceDashboard() {
    var data = typeof window.useDashboardData === 'function' ? window.useDashboardData() : {};

    var userProfile = data.userProfile || null;
    var stats = data.stats || { ftp: 0, wkg: 0, weight: 0, weeklyGoal: 225, weeklyProgress: 0, totalPoints: 0, currentPoints: 0 };
    var coachData = data.coachData || null;
    var loading = data.loading;
    var aiLoading = data.aiLoading;
    var streamingComment = data.streamingComment;
    var runConditionAnalysis = data.runConditionAnalysis;
    var setRunConditionAnalysis = data.setRunConditionAnalysis;
    var logsLoading = data.logsLoading;
    var logsLoadError = data.logsLoadError;
    var retryLogsRef = data.retryLogsRef;
    var fitnessData = data.fitnessData || [];
    var vo2TrendData = data.vo2TrendData || [];
    var growthTrendData = data.growthTrendData || [];
    var yearlyPowerPrData = data.yearlyPowerPrData || [];
    var recentLogs = data.recentLogs || [];
    var ftpCalcLoading = data.ftpCalcLoading;
    var setFtpCalcLoading = data.setFtpCalcLoading;
    var ftpModalOpen = data.ftpModalOpen;
    var setFtpModalOpen = data.setFtpModalOpen;
    var ftpCalcResult = data.ftpCalcResult;
    var setFtpCalcResult = data.setFtpCalcResult;

    // 스크롤 초기화: useLayoutEffect로 DOM 마운트 직후 1회 실행 (기존 setTimeout 4회 폐기)
    useLayoutEffect(function() {
      var container = document.getElementById('performance-dashboard-container');
      if (container) {
        container.scrollTop = 0;
        container.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }, []);

    var AICoachHeroCard = window.AICoachHeroCard;
    var DailyQuickStats = window.DailyQuickStats;
    var DashboardDetailTabs = window.DashboardDetailTabs;
    var CircularProgress = window.DashboardCircularProgress;
    var WkgGradeIndicator = window.WkgGradeIndicator;
    var DashboardCard = window.DashboardCard;
    if (!DashboardCard) {
      DashboardCard = function(p) {
        return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' + (p.className ? ' ' + p.className : '') }, p.title && React.createElement('h3', { className: 'text-sm font-semibold text-gray-600 mb-3' }, p.title), p.children);
      };
    }
    if (!WkgGradeIndicator) {
      WkgGradeIndicator = function(p) {
        return React.createElement('div', { className: 'rounded-full bg-gray-200 flex items-center justify-center', style: { width: p.size || 40, height: p.size || 40 } }, React.createElement('span', { className: 'text-gray-600 font-bold' }, p.letter || '-'));
      };
    }

    if (loading) {
      return (
        <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-sm text-gray-600">사용자 정보를 불러오는 중...</div>
          </div>
        </div>
      );
    }

    if (!userProfile) {
      return (
        <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="text-center text-gray-600">
            <p className="mb-4">로그인이 필요합니다.</p>
            <button
              type="button"
              onClick={function() { if (typeof showScreen === 'function') showScreen('myCareerScreen'); }}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg"
            >
              나의 기록으로 이동
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 scrollbar-hide relative">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all"
              onClick={function() { if (typeof showScreen === 'function') showScreen('myCareerScreen'); }}
              aria-label="뒤로 가기"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-3 flex-1 justify-center">
              {WkgGradeIndicator && React.createElement(WkgGradeIndicator, {
                wkg: stats.wkg,
                size: 40,
                letter: (stats.wkg != null && stats.wkg !== '') ? Number(stats.wkg).toFixed(2) : '-'
              })}
              <div>
                <div className="font-semibold text-gray-900">{userProfile.name || '사용자'}</div>
                <div className="text-xs text-gray-500">{getGradeBadge(userProfile.grade)}</div>
              </div>
            </div>
            <button
              className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all opacity-50 cursor-not-allowed"
              aria-label="프로필 편집 (추후 구현)"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        </header>

        {/* Level 1: Hero - AICoachHeroCard */}
        <section className="px-4 pt-6">
          {AICoachHeroCard ? (
            React.createElement(AICoachHeroCard, {
              coachData: coachData,
              aiLoading: aiLoading,
              streamingComment: streamingComment,
              runConditionAnalysis: runConditionAnalysis,
              setRunConditionAnalysis: setRunConditionAnalysis,
              setRetryCoach: data.setRetryCoach,
              userProfile: userProfile,
              CircularProgress: CircularProgress
            })
          ) : (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="text-center text-gray-500 text-sm">AICoachHeroCard (구현 예정)</div>
              {coachData && (
                <div className="mt-4">
                  <div className="text-lg font-bold text-gray-900">컨디션: {coachData.condition_score}점</div>
                  <p className="text-sm text-gray-700 mt-2">{streamingComment || coachData.coach_comment}</p>
                  <button
                    type="button"
                    onClick={function() {
                      if (typeof window.runDashboardAIWorkoutRecommendation === 'function') {
                        window.runDashboardAIWorkoutRecommendation(userProfile, coachData);
                      }
                    }}
                    className="mt-4 w-full py-3 bg-blue-500 text-white font-semibold rounded-xl"
                  >
                    추천: {coachData.recommended_workout || 'Active Recovery (Z1)'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Level 2: Quick Stats - DailyQuickStats */}
        <section className="px-4 pt-6">
          {DailyQuickStats ? (
            React.createElement(DailyQuickStats, {
              stats: stats,
              logsLoading: logsLoading,
              logsLoadError: logsLoadError,
              retryLogsRef: retryLogsRef,
              userProfile: userProfile,
              ftpCalcLoading: ftpCalcLoading,
              setFtpCalcLoading: setFtpCalcLoading,
              ftpModalOpen: ftpModalOpen,
              setFtpModalOpen: setFtpModalOpen,
              ftpCalcResult: ftpCalcResult,
              setFtpCalcResult: setFtpCalcResult,
              formatPoints: formatPoints,
              DashboardCard: DashboardCard
            })
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">파워</h3>
                <div className="text-2xl font-bold text-gray-900">{stats.ftp}W</div>
                <div className="text-sm text-gray-600">{stats.wkg} W/kg</div>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">주간 목표</h3>
                <div className="text-2xl font-bold text-gray-900">
                  {logsLoading ? '...' : Math.min(Math.round((stats.weeklyProgress / (stats.weeklyGoal || 225)) * 100), 100)}%
                </div>
                <div className="text-sm text-gray-600">{stats.weeklyProgress}/{stats.weeklyGoal || 225} TSS</div>
              </div>
            </div>
          )}
        </section>

        {/* Level 3: Deep Dive - DashboardDetailTabs */}
        <section className="px-4 py-6 pb-32">
          {DashboardDetailTabs ? (
            React.createElement(DashboardDetailTabs, {
              userProfile: userProfile,
              recentLogs: recentLogs,
              fitnessData: fitnessData,
              vo2TrendData: vo2TrendData,
              growthTrendData: growthTrendData,
              yearlyPowerPrData: yearlyPowerPrData,
              stats: stats,
              logsLoading: logsLoading,
              logsLoadError: logsLoadError,
              retryLogsRef: retryLogsRef,
              DashboardCard: DashboardCard
            })
          ) : (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="text-center text-gray-500 text-sm">DashboardDetailTabs (구현 예정)</div>
              <div className="mt-4 text-xs text-gray-400">
                Tab 1: 나의 성향 | Tab 2: 최근 훈련 | Tab 3: 성장 추이
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  window.PerformanceDashboardRefactored = PerformanceDashboard;
  window.PerformanceDashboard = PerformanceDashboard;
  console.log('[Dashboard] 리팩터링된 PerformanceDashboard 로드 완료');
})();
