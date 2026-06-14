/**
 * RUN 전용 Performance Dashboard — CYCLE assets/js/dashboard/ 복제본
 *
 * Step 1: 레이아웃·상태·UI 아키텍처 복사 + 1차 네이밍 치환
 * Step 2 (예정): RUN Supabase 랭킹 엔진(calculated_pace, is_penalty_applied 등) 데이터 바인딩
 *
 * 로드 순서 (index.html 연동 시):
 * 1. runDashboardAICache.js
 * 2. useRunDashboardData.js
 * 3. components/RunAICoachHeroCard.jsx
 * 4. components/RunDailyQuickStats.jsx
 * 5. components/StelvioHexagonRanksCard.jsx
 * 6. components/RunDashboardDetailTabs.jsx
 * 7. stelvioHexagonRankLog.js
 * 8. RunDashboard.jsx
 *
 * 마운트: initRunDashboard() → #run-dashboard-root (Phase 2)
 */
(function () {
  'use strict';
  window.RUN_DASHBOARD_MODULE = {
    root: 'RunDashboard',
    hook: 'useRunDashboardData',
    components: {
      hero: 'RunAICoachHeroCard',
      quickStats: 'RunDailyQuickStats',
      detailTabs: 'RunDashboardDetailTabs',
      hexagon: 'StelvioHexagonRanksCard'
    },
    cache: 'runDashboardAICache',
    hexagonLog: 'stelvioHexagonRankLog'
  };
})();
