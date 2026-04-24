/**
 * dashboardAICache.js - 대시보드 AI·옥타곤 캐시
 * - 컨디션 분석, AI 인사이트, 추천 워크아웃, **STELVIO 옥타곤(피크 W/kg 7축)**
 * - 옥타곤: local 날짜·사용자·성별·카테고리 단위. 동일 7요청(월간+연간) 재호출 방지
 * - 캐시 무효화: 날짜/필터 변경 시 키가 달라짐(트레이닝 로그는 옥타곤 API와 별개)
 */
(function() {
  'use strict';

  var CACHE_PREFIX = 'stelvio_dashboard_ai_';
  var CACHE_VERSION = '2'; // 2: 로그 시그니처에 30일/7일 TSS 모두 반영(이전 v1 캐시 자동 미사용)

  function getTodayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * 훈련 로그 시그니처 생성 (로그 변경 감지)
   * @param {Array} recentLogs - 최근 30일 로그
   * @param {number} [last7TSS] - 최근 7일 TSS (선택)
   */
  function buildLogsSignature(recentLogs, last7TSS) {
    if (!recentLogs || recentLogs.length === 0) return '0_0_0_0';
    var totalTSS = 0;
    var latestDate = '';
    var parseDate = function(d) {
      if (!d) return null;
      if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
      if (typeof d === 'string') return d.slice(0, 10);
      return null;
    };
    for (var i = 0; i < recentLogs.length; i++) {
      var ds = parseDate(recentLogs[i].date || recentLogs[i].completed_at);
      if (ds && (!latestDate || ds > latestDate)) latestDate = ds;
      totalTSS += Number(recentLogs[i].tss) || 0;
    }
    var t30 = Math.round(totalTSS);
    var t7 = typeof last7TSS === 'number' && !isNaN(last7TSS) ? Math.round(last7TSS) : t30;
    return recentLogs.length + '_' + latestDate + '_7' + t7 + '_30' + t30;
  }

  /**
   * 역량 점수 시그니처 생성 (RSPT, TSPT 등)
   */
  function buildScoresSignature(scores) {
    if (!scores || typeof scores !== 'object') return '';
    var s = scores;
    return [s.RSPT, s.TSPT, s.PCH, s.CLMB, s.TTST, s.ALLR].map(function(v) { return (v != null ? Number(v) : 0).toFixed(1); }).join('_');
  }

  function getCacheKey(type, userId, extra) {
    return CACHE_PREFIX + type + '_v' + CACHE_VERSION + '_' + (userId || '') + (extra ? '_' + extra : '');
  }

  function getCached(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.data) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  function setCache(key, data) {
    try {
      var payload = { data: data, cachedAt: new Date().toISOString() };
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[DashboardAICache] setCache failed:', e && e.message);
      return false;
    }
  }

  /**
   * 컨디션 분석(Coach) 캐시
   */
  window.getDashboardCoachCache = function(userId, todayStr, logsSignature) {
    var key = getCacheKey('coach', userId, todayStr + '_' + (logsSignature || ''));
    return getCached(key);
  };

  window.setDashboardCoachCache = function(userId, todayStr, logsSignature, coachData) {
    var key = getCacheKey('coach', userId, todayStr + '_' + (logsSignature || ''));
    return setCache(key, coachData);
  };

  /**
   * AI 라이딩 인사이트 캐시
   */
  window.getDashboardAIRidingInsightCache = function(userId, todayStr, scoresSignature) {
    var key = getCacheKey('riding', userId, todayStr + '_' + (scoresSignature || ''));
    return getCached(key);
  };

  window.setDashboardAIRidingInsightCache = function(userId, todayStr, scoresSignature, aiComment) {
    var key = getCacheKey('riding', userId, todayStr + '_' + (scoresSignature || ''));
    return setCache(key, { text: aiComment });
  };

  /**
   * 추천 워크아웃 캐시
   */
  window.getDashboardWorkoutRecommendationCache = function(userId, dateStr, logsSignature) {
    var key = getCacheKey('workout', userId, dateStr + '_' + (logsSignature || ''));
    return getCached(key);
  };

  window.setDashboardWorkoutRecommendationCache = function(userId, dateStr, logsSignature, recommendationData, workoutDetails) {
    var key = getCacheKey('workout', userId, dateStr + '_' + (logsSignature || ''));
    return setCache(key, { recommendationData: recommendationData, workoutDetails: workoutDetails });
  };

  /** 3: TSS 제외, 피크 W/kg 7축만(이전 8·7축 캐시 무효) */
  var OCTAGON_CACHE_PAYLOAD_V = 3;

  /**
   * STELVIO 옥타곤 — 7축(피크 W/kg) API 결과만 저장(ranks+코호트). norm은 클라이언트에서 재계산.
   * @returns {{v:number, monthly:{ranks:Array, cohortSizePerAxis:Array}, hof:{ranks:Array}}|null}
   */
  window.getStelvioOctagonRanksCache = function(userId, gender, category, todayStr) {
    if (!userId) return null;
    var g = gender == null || gender === '' ? 'all' : String(gender);
    var c = category == null || category === '' ? 'Supremo' : String(category);
    var d = todayStr || getTodayStr();
    var key = getCacheKey('octagon', userId, g + '_' + c + '_' + d);
    var data = getCached(key);
    if (!data || data.v !== OCTAGON_CACHE_PAYLOAD_V || !data.monthly || !data.hof) return null;
    if (!Array.isArray(data.monthly.ranks) || data.monthly.ranks.length !== 7) return null;
    if (!Array.isArray(data.monthly.cohortSizePerAxis) || data.monthly.cohortSizePerAxis.length !== 7) return null;
    if (!Array.isArray(data.hof.ranks) || data.hof.ranks.length !== 7) return null;
    return data;
  };

  window.setStelvioOctagonRanksCache = function(userId, gender, category, todayStr, monthlyRanks, cohortSizePerAxis, hofRanks) {
    if (!userId) return false;
    var g = gender == null || gender === '' ? 'all' : String(gender);
    var c = category == null || category === '' ? 'Supremo' : String(category);
    var d = todayStr || getTodayStr();
    var key = getCacheKey('octagon', userId, g + '_' + c + '_' + d);
    var payload = {
      v: OCTAGON_CACHE_PAYLOAD_V,
      monthly: { ranks: monthlyRanks, cohortSizePerAxis: cohortSizePerAxis },
      hof: { ranks: hofRanks }
    };
    return setCache(key, payload);
  };

  window.buildLogsSignatureForCache = buildLogsSignature;
  window.buildScoresSignatureForCache = buildScoresSignature;
  window.getTodayStrForCache = getTodayStr;
})();
