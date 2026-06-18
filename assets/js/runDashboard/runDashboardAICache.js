/**
 * runDashboardAICache.js - RUN 대시보드 AI·헥사곤(6축) 캐시
 * - 컨디션 분석, AI 인사이트, 추천 워크아웃, **STELVIO 헥사곤(피크 W/kg 6축)**
 * - 헥사곤: local 날짜·사용자·성별·카테고리 단위. 동일 7요청(월간+연간) 재호출 방지
 * - 캐시 무효화: 날짜/필터 변경 시 키가 달라짐(트레이닝 로그는 랭킹 API와 별개)
 */
(function() {
  'use strict';

  var CACHE_PREFIX = 'stelvio_run_dashboard_ai_';
  var CACHE_VERSION = '3'; // 3: RUN 추천 워크아웃 규칙 엔진 단일 확정(recommendedWorkout)

  /**
   * 로그 날짜 → 로컬 YYYY-MM-DD (useDashboardData / 코치와 동일 기준)
   * iOS에서 Firestore toDate()를 toISOString(UTC)로만 쓰면 'latestDate'가 PC와 야간대에 달라져 시그니처·캐시 키가 어긋날 수 있음
   */
  function parseLogDateToLocalYMD(d) {
    if (!d) return null;
    var v = d;
    if (v && typeof v.toDate === 'function') v = v.toDate();
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    }
    if (typeof d === 'string') return (d.split('T')[0] || '').trim().slice(0, 10) || null;
    return null;
  }

  /** localStorage 쓰기 실패·ITP(미사용 삭제) 대비: 같은 탭·세션 내 조회/복구용 */
  var _readThroughMemory = Object.create(null);

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
    for (var i = 0; i < recentLogs.length; i++) {
      var logEntry = recentLogs[i];
      var raw = logEntry && (logEntry.date != null ? logEntry.date : logEntry.completed_at);
      var ds = parseLogDateToLocalYMD(raw);
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
    if (!key) return null;
    try {
      if (_readThroughMemory[key] != null) {
        return _readThroughMemory[key].data;
      }
    } catch (e) {}
    var parsed = null;
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        parsed = JSON.parse(raw);
        if (parsed && parsed.data != null) {
          _readThroughMemory[key] = parsed;
          return parsed.data;
        }
      }
    } catch (e) {}
    try {
      var rawS = sessionStorage.getItem(key);
      if (rawS) {
        parsed = JSON.parse(rawS);
        if (parsed && parsed.data != null) {
          _readThroughMemory[key] = parsed;
          return parsed.data;
        }
      }
    } catch (e) {}
    return null;
  }

  function setCache(key, data) {
    if (!key) return false;
    var payload = { data: data, cachedAt: new Date().toISOString() };
    var str = null;
    try {
      str = JSON.stringify(payload);
    } catch (e) {
      return false;
    }
    _readThroughMemory[key] = payload;
    var localOk = false;
    try {
      localStorage.setItem(key, str);
      localOk = true;
    } catch (e) {
      try {
        console.warn('[RunDashboardAICache] localStorage setItem failed (iOS quota / private / ITP):', e && e.message);
      } catch (w) {}
    }
    try {
      sessionStorage.setItem(key, str);
    } catch (e) {
      if (!localOk) {
        try {
          console.warn('[RunDashboardAICache] sessionStorage also failed; cache only in memory for this tab.', e && e.message);
        } catch (w) {}
      }
    }
    return true;
  }

  function removeCached(key) {
    if (!key) return;
    try {
      delete _readThroughMemory[key];
    } catch (e) {}
    try {
      localStorage.removeItem(key);
    } catch (e) {}
    try {
      sessionStorage.removeItem(key);
    } catch (e) {}
  }

  /**
   * 컨디션 분석(Coach) 캐시 — 로그 시그니처별(동일 데이터 재호출 방지)
   */
  window.getDashboardCoachCache = function(userId, todayStr, logsSignature) {
    var key = getCacheKey('coach', userId, todayStr + '_' + (logsSignature || ''));
    return getCached(key);
  };

  window.setDashboardCoachCache = function(userId, todayStr, logsSignature, coachData) {
    var key = getCacheKey('coach', userId, todayStr + '_' + (logsSignature || ''));
    var ok = setCache(key, coachData);
    if (coachData && todayStr) {
      setCache(getCacheKey('coach_daily', userId, todayStr), coachData);
    }
    return ok;
  };

  /** 오늘(local) 날짜 기준 일별 컨디션 캐시 — 프로그램 재구동 시 수동 분석 없이 복원 */
  window.getDashboardCoachDailyCache = function(userId, todayStr) {
    if (!userId || !todayStr) return null;
    var daily = getCached(getCacheKey('coach_daily', userId, todayStr));
    if (daily && daily.condition_score != null && !daily.error_reason) return daily;
    return findLatestCoachCacheForDate(userId, todayStr);
  };

  /** coach_daily 도입 전 저장된 시그니처 캐시 중 오늘 날짜 항목 폴백 */
  function findLatestCoachCacheForDate(userId, todayStr) {
    var uid = String(userId || '');
    if (!uid || !todayStr) return null;
    var dateMarker = '_' + uid + '_' + todayStr + '_';
    var best = null;
    var bestAt = '';
    function considerKey(key) {
      if (!key || key.indexOf(CACHE_PREFIX + 'coach') !== 0) return;
      if (key.indexOf('coach_daily') !== -1) return;
      if (key.indexOf(dateMarker) === -1) return;
      var payload = null;
      try {
        if (_readThroughMemory[key]) payload = _readThroughMemory[key];
      } catch (e) {}
      if (!payload) {
        try {
          var raw = localStorage.getItem(key);
          if (raw) payload = JSON.parse(raw);
        } catch (e2) {}
      }
      if (!payload || !payload.data || payload.data.condition_score == null || payload.data.error_reason) return;
      var at = payload.cachedAt || '';
      if (!best || at >= bestAt) {
        best = payload.data;
        bestAt = at;
      }
    }
    try {
      Object.keys(_readThroughMemory).forEach(considerKey);
    } catch (e) {}
    try {
      Object.keys(localStorage).forEach(considerKey);
    } catch (e2) {}
    try {
      Object.keys(sessionStorage).forEach(considerKey);
    } catch (e3) {}
    if (best) {
      setCache(getCacheKey('coach_daily', userId, todayStr), best);
    }
    return best;
  }

  window.setDashboardCoachDailyCache = function(userId, todayStr, coachData) {
    if (!userId || !todayStr) return false;
    return setCache(getCacheKey('coach_daily', userId, todayStr), coachData);
  };

  /** 수동 재분석 시 해당 사용자 RUN 컨디션 캐시 전체 삭제 */
  window.clearDashboardCoachCacheForUser = function(userId) {
    if (!userId) return;
    var uid = String(userId);
    var marker = '_' + uid + '_';
    var memKeys = Object.keys(_readThroughMemory);
    for (var mi = 0; mi < memKeys.length; mi++) {
      var mk = memKeys[mi];
      if (mk.indexOf(CACHE_PREFIX + 'coach') === 0 && mk.indexOf(marker) !== -1) {
        removeCached(mk);
      }
    }
    try {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_PREFIX + 'coach') === 0 && k.indexOf(marker) !== -1) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
    try {
      Object.keys(sessionStorage).forEach(function(k) {
        if (k.indexOf(CACHE_PREFIX + 'coach') === 0 && k.indexOf(marker) !== -1) {
          sessionStorage.removeItem(k);
        }
      });
    } catch (e) {}
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

  /** 3: TSS 제외 / 9: 기본 전체 / 10: 부문별 baseline 등락·카테고리 즉시 재계산 */
  var OCTAGON_CACHE_PAYLOAD_V = 10;

  /**
   * STELVIO 헥사곤 — 6축 ranks+코호트 + (v4) monthly/hof 6축 W/kg. norm은 클라이언트에서 hexagonRadarDisplayNorms로 재계산.
   * @returns {{v:number, monthly:{ranks:Array, cohortSizePerAxis:Array, wkgs:Array}, hof:{ranks:Array, wkgs:Array}}|null}
   */
  window.getStelvioHexagonRanksCache = function(userId, gender, category, todayStr) {
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
    if (!Array.isArray(data.monthly.wkgs) || data.monthly.wkgs.length !== 7) return null;
    if (!Array.isArray(data.hof.wkgs) || data.hof.wkgs.length !== 7) return null;
    return data;
  };

  /**
   * @param {Array} monthlyWkgs - 6축 월간 currentUser w/kg (null 허용)
   * @param {Array} hofWkgs - 6축 연간 currentUser w/kg (null 허용)
   */
  function pad7Wkgs(arr) {
    var out = [];
    var i;
    for (i = 0; i < 7; i++) {
      if (arr && arr[i] != null && isFinite(Number(arr[i]))) {
        out.push(Number(arr[i]));
      } else {
        out.push(null);
      }
    }
    return out;
  }

  function pad7OptionalInts(arr) {
    var out = [];
    var i;
    for (i = 0; i < 7; i++) {
      if (arr && arr[i] != null && isFinite(Number(arr[i]))) {
        out.push(Math.round(Number(arr[i])));
      } else {
        out.push(null);
      }
    }
    return out;
  }

  window.setStelvioHexagonRanksCache = function(
    userId,
    gender,
    category,
    todayStr,
    monthlyRanks,
    cohortSizePerAxis,
    hofRanks,
    monthlyWkgs,
    hofWkgs,
    monthlyRankChanges,
    monthlyPreviousBoardRanks
  ) {
    if (!userId) return false;
    var g = gender == null || gender === '' ? 'all' : String(gender);
    var c = category == null || category === '' ? 'Supremo' : String(category);
    var d = todayStr || getTodayStr();
    var key = getCacheKey('octagon', userId, g + '_' + c + '_' + d);
    var payload = {
      v: OCTAGON_CACHE_PAYLOAD_V,
      monthly: {
        ranks: monthlyRanks,
        cohortSizePerAxis: cohortSizePerAxis,
        wkgs: pad7Wkgs(Array.isArray(monthlyWkgs) ? monthlyWkgs : null),
        rankChanges: pad7OptionalInts(Array.isArray(monthlyRankChanges) ? monthlyRankChanges : null),
        previousBoardRanks: pad7OptionalInts(Array.isArray(monthlyPreviousBoardRanks) ? monthlyPreviousBoardRanks : null)
      },
      hof: {
        ranks: hofRanks,
        wkgs: pad7Wkgs(Array.isArray(hofWkgs) ? hofWkgs : null)
      }
    };
    return setCache(key, payload);
  };

  window.buildLogsSignatureForCache = buildLogsSignature;
  window.buildScoresSignatureForCache = buildScoresSignature;
  window.getTodayStrForCache = getTodayStr;
})();
