/**
 * getRunningLeaderboard API — fetch + 메모리 캐시
 */
(function () {
  'use strict';

  var _cache = { at: 0, rows: null, rankMovementByKey: null, rankMovementAsOfSeoul: '', error: null };
  var _inflight = null;

  function getConfig() {
    return window.runningRankingConfig || { API_URL: '', CACHE_TTL_MS: 300000 };
  }

  function getFormat() {
    return window.runningRankingFormat || {};
  }

  /**
   * @returns {Promise<{ success: boolean, rows: object[], error?: string }>}
   */
  function fetchLeaderboard(opts) {
    opts = opts || {};
    var cfg = getConfig();
    var now = Date.now();
    if (!opts.force && _cache.rows && now - _cache.at < cfg.CACHE_TTL_MS) {
      return Promise.resolve({
        success: true,
        rows: _cache.rows.slice(),
        rankMovementByKey: _cache.rankMovementByKey || {},
        rankMovementAsOfSeoul: _cache.rankMovementAsOfSeoul || ''
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
          var rankMovementByKey = (body.rankMovementByKey && typeof body.rankMovementByKey === 'object')
            ? body.rankMovementByKey
            : {};
          var rankMovementAsOfSeoul = body.rankMovementAsOfSeoul ? String(body.rankMovementAsOfSeoul) : '';
          _cache = {
            at: Date.now(),
            rows: rows,
            rankMovementByKey: rankMovementByKey,
            rankMovementAsOfSeoul: rankMovementAsOfSeoul,
            error: null
          };
          return {
            success: true,
            rows: rows.slice(),
            rankMovementByKey: rankMovementByKey,
            rankMovementAsOfSeoul: rankMovementAsOfSeoul
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
    _cache = { at: 0, rows: null, rankMovementByKey: null, rankMovementAsOfSeoul: '', error: null };
  }

  window.runningRankingApi = {
    fetchLeaderboard: fetchLeaderboard,
    invalidateCache: invalidateCache
  };
})();
