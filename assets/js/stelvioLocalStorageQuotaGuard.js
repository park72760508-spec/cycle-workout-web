/**
 * localStorage 용량 초과(QuotaExceededError) 방지.
 * Firebase SDK(firebase:previous_websocket_failure 등)는 userManager보다 먼저 실행되므로 head에서 선로드.
 */
(function (w) {
  'use strict';

  var PROTECTED_EXACT = {
    currentUser: 1,
    authUser: 1,
    geminiApiKey: 1,
    geminiModelName: 1,
    geminiApiVersion: 1
  };

  var PROTECTED_PREFIXES = [
    'firebase:authUser:',
    'stelvio_rank_favorites:',
    'stelvio_rank_favorites_ss:',
    'stelvioRankingFavorites:'
  ];

  function isProtectedKey(key) {
    if (!key) return true;
    if (PROTECTED_EXACT[key]) return true;
    for (var i = 0; i < PROTECTED_PREFIXES.length; i++) {
      if (key.indexOf(PROTECTED_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function shouldPruneKey(key, opts) {
    if (!key || isProtectedKey(key)) return false;
    opts = opts || {};

    if (key.indexOf('stelvioRC:') === 0) return true;
    if (key.indexOf('stelvio_rank_prev') === 0) return true;
    if (key.indexOf('stelvioPeakRanking') === 0) return true;
    if (key.indexOf('stelvio_peak_rank_snap') === 0) return true;
    if (key.indexOf('stelvio_peak_rank_mv') === 0) return true;
    if (
      key.indexOf('stelvioRanking') === 0 &&
      key.indexOf('stelvioRankingFavorites:') !== 0
    ) {
      return true;
    }
    if (key.indexOf('stelvio_dashboard_ai_') === 0) return true;
    if (key.indexOf('stelvio_run_dashboard_ai_') === 0) return true;
    if (key === 'stelvio_workouts_cache') return true;
    if (key === 'stelvio_workouts_cache_timestamp') return true;
    if (key === 'stelvio_workouts_cache_count') return true;
    if (key === 'stelvio_workouts_segments_cache') return true;
    if (key.indexOf('firebase:previous_websocket_failure') === 0) return true;
    if (key.indexOf('firebase:host:') === 0 && key.indexOf('authUser') < 0) return true;

    if (opts.aggressive) {
      if (key.indexOf('stelvio_workout') === 0) return true;
      if (key.indexOf('workoutPlans') === 0) return true;
    }
    return false;
  }

  function estimateLocalStorageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var v = localStorage.getItem(k);
        total += (k.length + (v ? v.length : 0)) * 2;
      }
    } catch (_e) {}
    return total;
  }

  function pruneStelvioLocalStorageForQuota(opts) {
    var removed = 0;
    var freedEstimate = 0;
    try {
      var keys = [];
      var i;
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) keys.push(k);
      }
      keys.forEach(function (key) {
        if (!shouldPruneKey(key, opts)) return;
        try {
          var val = localStorage.getItem(key);
          if (val) freedEstimate += (key.length + val.length) * 2;
          localStorage.removeItem(key);
          removed += 1;
        } catch (_rm) {}
      });
    } catch (_e) {}
    if (removed > 0) {
      try {
        console.warn(
          '[Storage] localStorage 용량 정리: ' +
            removed +
            '건 삭제 (~' +
            Math.round(freedEstimate / 1024) +
            'KB)'
        );
      } catch (_log) {}
    }
    return { removed: removed, freedEstimate: freedEstimate };
  }

  pruneStelvioLocalStorageForQuota.__stelvioQuotaGuard = true;
  w.pruneStelvioLocalStorageForQuota = pruneStelvioLocalStorageForQuota;

  function maybeProactivePrune() {
    try {
      var probeKey = '__stelvio_ls_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      if (estimateLocalStorageBytes() > 4 * 1024 * 1024) {
        pruneStelvioLocalStorageForQuota();
      }
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        pruneStelvioLocalStorageForQuota({ aggressive: true });
      }
    }
  }

  function installSetItemGuard() {
    if (w.__STELVIO_LS_SETITEM_GUARD__) return;
    w.__STELVIO_LS_SETITEM_GUARD__ = true;
    var orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        return orig.call(this, key, value);
      } catch (e) {
        if (
          this === localStorage &&
          e &&
          (e.name === 'QuotaExceededError' || e.code === 22) &&
          typeof w.pruneStelvioLocalStorageForQuota === 'function'
        ) {
          w.pruneStelvioLocalStorageForQuota({ aggressive: true });
          return orig.call(this, key, value);
        }
        throw e;
      }
    };
  }

  maybeProactivePrune();
  installSetItemGuard();
})(typeof window !== 'undefined' ? window : {});
