/**
 * 러닝 랭킹보드 — 탭·API·라우트 설정 (추후 메뉴 연결 변경 시 이 파일만 수정)
 */
(function () {
  'use strict';

  var API_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net/getRunningLeaderboard';

  /** @typedef {'overall'|'pace'|'tss'|'distance'|'crew'} RunningRankingTabId */

  var TABS = [
    { id: 'overall', label: '종합', unit: 'pt', sortKey: 'total_score', sortDir: 'desc' },
    { id: 'pace', label: '구간', unit: 'min/km', sortKey: 'pace', sortDir: 'asc' },
    { id: 'tss', label: 'TSS', unit: 'TSS', sortKey: 'weekly_tss', sortDir: 'desc' },
    { id: 'distance', label: '거리', unit: 'km', sortKey: 'distance_30d_km', sortDir: 'desc' },
    { id: 'crew', label: '크루', unit: 'pt', sortKey: 'crew_score', sortDir: 'desc' }
  ];

  /** 종합 탭 구간 (1k~20k) — runDistanceZoneColors.ZONES 와 키 동기화 */
  var OVERALL_SEGMENTS = [
    { key: '1k', label: '1k', zone: 'Z7' },
    { key: '3k', label: '3k', zone: 'Z6' },
    { key: '5k', label: '5k', zone: 'Z5' },
    { key: '7k', label: '7k', zone: 'Z4' },
    { key: '10k', label: '10k', zone: 'Z3' },
    { key: '20k', label: '20k', zone: 'Z2' }
  ];

  /** 페이스 탭 거리 선택 (42k = Z1) */
  var PACE_DISTANCES = [
    { key: '1k', label: '1k', zone: 'Z7' },
    { key: '3k', label: '3k', zone: 'Z6' },
    { key: '5k', label: '5k', zone: 'Z5' },
    { key: '7k', label: '7k', zone: 'Z4' },
    { key: '10k', label: '10k', zone: 'Z3' },
    { key: '20k', label: '20k', zone: 'Z2' },
    { key: '42k', label: '42k', zone: 'Z1' }
  ];

  var GENDER_OPTIONS = [
    { value: 'all', label: '전체' },
    { value: 'M', label: '남성' },
    { value: 'F', label: '여성' }
  ];

  /** CYCLE 랭킹보드와 동일 카테고리 */
  var CATEGORY_LABELS = {
    Supremo: '전체',
    Assoluto: '선수부',
    Bianco: '30대 이하',
    Rosa: '40대',
    Infinito: '50대',
    Leggenda: '60대 이상'
  };

  var CATEGORY_TITLES = {
    Supremo: 'Supremo (전체)',
    Assoluto: 'Assoluto (Elite/Pro선수)',
    Bianco: 'Bianco (30대 이하)',
    Rosa: 'Rosa (40대)',
    Infinito: 'Infinito (50대)',
    Leggenda: 'Leggenda (60대 이상)'
  };

  var CATEGORY_OPTIONS = [
    { value: 'Supremo', label: '전체' },
    { value: 'Assoluto', label: '선수부' },
    { value: 'Bianco', label: '30대 이하' },
    { value: 'Rosa', label: '40대' },
    { value: 'Infinito', label: '50대' },
    { value: 'Leggenda', label: '60대 이상' }
  ];

  /** 크루 탭 항목 — CYCLE 클럽 탭 GC·TSS·거리·독주와 동일 역할 */
  var CREW_METRIC_OPTIONS = [
    { value: 'overall', label: '종합' },
    { value: 'pace', label: '구간' },
    { value: 'tss', label: 'TSS' },
    { value: 'distance', label: '거리' }
  ];

  var SCREEN_ID = 'runningRankingScreen';

  /** 진입점 — RUN 베이스캠프 랭킹보드 버튼 */
  var ROUTE_ENTRIES = {
    runBasecamp: { screenId: SCREEN_ID, buttonId: 'btnRunBasecampRanking' }
  };

  window.runningRankingConfig = {
    API_URL: API_BASE,
    TABS: TABS,
    OVERALL_SEGMENTS: OVERALL_SEGMENTS,
    PACE_DISTANCES: PACE_DISTANCES,
    GENDER_OPTIONS: GENDER_OPTIONS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    CATEGORY_TITLES: CATEGORY_TITLES,
    CATEGORY_OPTIONS: CATEGORY_OPTIONS,
    CREW_METRIC_OPTIONS: CREW_METRIC_OPTIONS,
    DEFAULT_CATEGORY: 'Supremo',
    SCREEN_ID: SCREEN_ID,
    ROUTE_ENTRIES: ROUTE_ENTRIES,
    CACHE_TTL_MS: 60 * 60 * 1000,
    GC_SCORING_VERSION: 2,
    LEADERBOARD_SCORING_VERSION: 7,
    LIST_ROW_HEIGHT: 48,
    LIST_ROW_HEIGHT_OVERALL: 48,
    MEDAL_SRC: ['assets/img/1st.svg', 'assets/img/2nd.svg', 'assets/img/3rd.svg'],
    DISTANCE_ZONE_COLORS: typeof window.runDistanceZoneColors !== 'undefined'
      ? window.runDistanceZoneColors
      : null
  };
})();
