/**
 * dashboardAICache.js - 대시보드 AI 분석 결과 캐시
 * - 컨디션 분석, AI 라이딩 인사이트, 추천 워크아웃 결과를 localStorage에 캐시
 * - 캐시 무효화: 날짜 변경, 훈련 로그 업데이트/업로드 시
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

  window.buildLogsSignatureForCache = buildLogsSignature;
  window.buildScoresSignatureForCache = buildScoresSignature;
  window.getTodayStrForCache = getTodayStr;
})();
