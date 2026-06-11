/**
 * 러닝 랭킹보드 — 탭·API·라우트 설정 (추후 메뉴 연결 변경 시 이 파일만 수정)
 */
(function () {
  'use strict';

  var API_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net/getRunningLeaderboard';

  /** @typedef {'overall'|'pace'|'tss'|'distance'|'crew'} RunningRankingTabId */

  var TABS = [
    { id: 'overall', label: '종합', unit: 'pt', sortKey: 'total_score', sortDir: 'desc' },
    { id: 'pace', label: '페이스', unit: '/km', sortKey: 'pace', sortDir: 'asc' },
    { id: 'tss', label: 'TSS', unit: 'TSS', sortKey: 'weekly_tss', sortDir: 'desc' },
    { id: 'distance', label: '거리', unit: 'km', sortKey: 'distance_30d_km', sortDir: 'desc' },
    { id: 'crew', label: '크루', unit: 'pt', sortKey: 'crew_score', sortDir: 'desc' }
  ];

  /** 종합 탭 구간 (1k~20k) */
  var OVERALL_SEGMENTS = [
    { key: '1k', label: '1K' },
    { key: '3k', label: '3K' },
    { key: '5k', label: '5K' },
    { key: '7k', label: '7K' },
    { key: '10k', label: '10K' },
    { key: '20k', label: '20K' }
  ];

  /** 페이스 탭 거리 선택 */
  var PACE_DISTANCES = [
    { key: '1k', label: '1K' },
    { key: '3k', label: '3K' },
    { key: '5k', label: '5K' },
    { key: '7k', label: '7K' },
    { key: '10k', label: '10K' },
    { key: '20k', label: '하프' },
    { key: '42k', label: '풀' }
  ];

  var GENDER_OPTIONS = [
    { value: 'all', label: '전체' },
    { value: 'M', label: '남성' },
    { value: 'F', label: '여성' }
  ];

  var SCREEN_ID = 'runningRankingScreen';

  /** 진입점 — 라우트 키별 액션 (허브·베이스캠프·프로그램 호출) */
  var ROUTE_ENTRIES = {
    hub: { screenId: SCREEN_ID, hubNavKey: 'running' },
    basecamp: { screenId: SCREEN_ID, buttonId: 'btnBasecampRunningRanking' },
    career: { screenId: SCREEN_ID, buttonId: 'btnCareerRunningRanking' }
  };

  window.runningRankingConfig = {
    API_URL: API_BASE,
    TABS: TABS,
    OVERALL_SEGMENTS: OVERALL_SEGMENTS,
    PACE_DISTANCES: PACE_DISTANCES,
    GENDER_OPTIONS: GENDER_OPTIONS,
    SCREEN_ID: SCREEN_ID,
    ROUTE_ENTRIES: ROUTE_ENTRIES,
    CACHE_TTL_MS: 5 * 60 * 1000,
    LIST_ROW_HEIGHT: 56,
    LIST_ROW_HEIGHT_OVERALL: 78,
    MEDAL_SRC: ['assets/img/1st.svg', 'assets/img/2nd.svg', 'assets/img/3rd.svg']
  };
})();
