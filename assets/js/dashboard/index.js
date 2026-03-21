/**
 * Dashboard 모듈 진입점
 * useDashboardData, PerformanceDashboard (리팩터링 버전) 로드 후
 * window.PerformanceDashboard를 리팩터링 버전으로 설정합니다.
 *
 * 스크립트 로드 순서 (index.html에 추가):
 * 1. conditionScoreModule.js
 * 2. dashboardCoach.js
 * 3. assets/js/dashboard/useDashboardData.js
 * 4. assets/js/dashboard/PerformanceDashboard.jsx (type="text/babel")
 *
 * initPerformanceDashboard는 기존대로 React.createElement(PerformanceDashboard, null)을 사용하며,
 * 이 스크립트 로드 후 PerformanceDashboard는 리팩터링 버전을 가리킵니다.
 */
(function() {
  'use strict';
  if (typeof window.PerformanceDashboardRefactored !== 'undefined') {
    window.PerformanceDashboard = window.PerformanceDashboardRefactored;
  }
})();
