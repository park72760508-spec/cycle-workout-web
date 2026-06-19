/**
 * getRunningLeaderboard API — fetch + 메모리 캐시 (일 1회 스냅샷)
 */
(function () {
  'use strict';

  var _cache = {
    at: 0,
    rows: null,
    rankMovementByKey: null,
    rankMovementAsOfSeoul: '',
    rankMovementSource: '',
    leaderboardSource: '',
    leaderboardAsOfSeoul: '',
    error: null
  };
  var _inflight = null;

  function getConfig() {
    return window.runningRankingConfig || { API_URL: '', CACHE_TTL_MS: 3600000 };
  }

  function seoulTodayYmd() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    } catch (e) {
      var d = new Date();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
  }

  function isStaleLeaderboardCache(cache) {
    if (!cache || !cache.leaderboardAsOfSeoul) return false;
    var asOf = String(cache.leaderboardAsOfSeoul).trim().slice(0, 10);
    if (!asOf) return false;
    return asOf < seoulTodayYmd();
  }

  /**
   * @returns {Promise<{ success: boolean, rows: object[], error?: string }>}
   */
  function fetchLeaderboard(opts) {
    opts = opts || {};
    var cfg = getConfig();
    var now = Date.now();
    var minScoringVersion = cfg.LEADERBOARD_SCORING_VERSION || cfg.GC_SCORING_VERSION || 2;
    var cacheScoringOk = _cache.rows
      && _cache.rows.length
      && Number(_cache.rows[0].scoring_version) >= minScoringVersion;
    var cacheFresh = !isStaleLeaderboardCache(_cache);
    if (!opts.force && _cache.rows && cacheScoringOk && cacheFresh && now - _cache.at < cfg.CACHE_TTL_MS) {
      return Promise.resolve({
        success: true,
        rows: _cache.rows.slice(),
        rankMovementByKey: _cache.rankMovementByKey || {},
        rankMovementAsOfSeoul: _cache.rankMovementAsOfSeoul || '',
        rankMovementSource: _cache.rankMovementSource || '',
        leaderboardSource: _cache.leaderboardSource || '',
        leaderboardAsOfSeoul: _cache.leaderboardAsOfSeoul || ''
      });
    }
    if (_inflight && !opts.force) return _inflight;

    _inflight = fetch(cfg.API_URL, { method: 'GET', credentials: 'omit' })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.success === false) {
            var err = (body && body.error) || ('HTTP ' + res.status);
            throw new Error(err);
          }
          var raw = body.leaderboard;
          var rows = Array.isArray(raw) ? raw : [];
          if (window.runningRankingData && typeof window.runningRankingData.normalizeLeaderboardRows === 'function') {
            rows = window.runningRankingData.normalizeLeaderboardRows(rows);
          }
          var rankMovementByKey = (body.rankMovementByKey && typeof body.rankMovementByKey === 'object')
            ? body.rankMovementByKey
            : {};
          var rankMovementAsOfSeoul = body.rankMovementAsOfSeoul ? String(body.rankMovementAsOfSeoul) : '';
          var leaderboardSource = body.leaderboardSource ? String(body.leaderboardSource) : '';
          var leaderboardAsOfSeoul = body.leaderboardAsOfSeoul ? String(body.leaderboardAsOfSeoul) : '';
          var rankMovementSource = body.rankMovementSource ? String(body.rankMovementSource) : '';
          _cache = {
            at: Date.now(),
            rows: rows,
            rankMovementByKey: rankMovementByKey,
            rankMovementAsOfSeoul: rankMovementAsOfSeoul,
            rankMovementSource: rankMovementSource,
            leaderboardSource: leaderboardSource,
            leaderboardAsOfSeoul: leaderboardAsOfSeoul,
            error: null
          };
          return {
            success: true,
            rows: rows.slice(),
            rankMovementByKey: rankMovementByKey,
            rankMovementAsOfSeoul: rankMovementAsOfSeoul,
            rankMovementSource: rankMovementSource,
            leaderboardSource: leaderboardSource,
            leaderboardAsOfSeoul: leaderboardAsOfSeoul
          };
        });
      })
      .catch(function (e) {
        var msg = (e && e.message) || '랭킹을 불러오지 못했습니다.';
        if (_cache.rows && _cache.rows.length) {
          return {
            success: true,
            rows: _cache.rows.slice(),
            rankMovementByKey: _cache.rankMovementByKey || {},
            rankMovementAsOfSeoul: _cache.rankMovementAsOfSeoul || '',
            rankMovementSource: _cache.rankMovementSource || '',
            leaderboardSource: _cache.leaderboardSource || '',
            leaderboardAsOfSeoul: _cache.leaderboardAsOfSeoul || '',
            stale: true,
            error: msg
          };
        }
        return { success: false, rows: [], error: msg };
      })
      .finally(function () {
        _inflight = null;
      });

    return _inflight;
  }

  function invalidateCache() {
    _cache = {
      at: 0,
      rows: null,
      rankMovementByKey: null,
      rankMovementAsOfSeoul: '',
      rankMovementSource: '',
      leaderboardSource: '',
      leaderboardAsOfSeoul: '',
      error: null
    };
  }

  function getCachedRows() {
    return _cache.rows && _cache.rows.length ? _cache.rows.slice() : [];
  }

  function getCachedSnapshot() {
    if (!_cache.rows || !_cache.rows.length) return null;
    return {
      rows: _cache.rows.slice(),
      rankMovementByKey: _cache.rankMovementByKey || {},
      rankMovementAsOfSeoul: _cache.rankMovementAsOfSeoul || '',
      rankMovementSource: _cache.rankMovementSource || '',
      leaderboardSource: _cache.leaderboardSource || '',
      leaderboardAsOfSeoul: _cache.leaderboardAsOfSeoul || ''
    };
  }

  window.runningRankingApi = {
    fetchLeaderboard: fetchLeaderboard,
    invalidateCache: invalidateCache,
    getCachedRows: getCachedRows,
    getCachedSnapshot: getCachedSnapshot
  };
})();
