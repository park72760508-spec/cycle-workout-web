/**
 * 랭킹보드(CYCLE GC / RUN 종합) "전체 랭킹 + 펼쳐보기" 표시 설정 — 관리자가 조정하는
 * 기본순위 보기(top N) / 내 순위 기준 위아래(neigh) 값을 Firestore appConfig에서
 * 로드·저장·캐시한다. CYCLE, RUN은 서로 독립된 설정값을 가진다.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    cycle: { topN: 100, neigh: 50 },
    run: { topN: 100, neigh: 50 }
  };

  var cache = {
    cycle: { topN: DEFAULTS.cycle.topN, neigh: DEFAULTS.cycle.neigh },
    run: { topN: DEFAULTS.run.topN, neigh: DEFAULTS.run.neigh }
  };

  var loaded = false;
  var loadingPromise = null;

  function fbFns() {
    return (typeof window !== 'undefined' && window._firebaseFirestoreFns) || {};
  }

  function normalize(raw, fallback) {
    var topN = Number(raw && raw.topN);
    var neigh = Number(raw && raw.neigh);
    return {
      topN: isFinite(topN) && topN > 0 ? Math.floor(topN) : fallback.topN,
      neigh: isFinite(neigh) && neigh >= 0 ? Math.floor(neigh) : fallback.neigh
    };
  }

  function applyDocData(data) {
    if (data && data.cycle) cache.cycle = normalize(data.cycle, DEFAULTS.cycle);
    if (data && data.run) cache.run = normalize(data.run, DEFAULTS.run);
  }

  window.stelvioLoadRankingDisplaySettings = function () {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (function () {
      return Promise.resolve().then(function () {
        var f = fbFns();
        if (!window.firestoreV9 || typeof f.doc !== 'function' || typeof f.getDoc !== 'function') {
          return cache;
        }
        var ref = f.doc(window.firestoreV9, 'appConfig', 'ranking_display_settings');
        return f.getDoc(ref).then(function (snap) {
          var exists = snap && (typeof snap.exists === 'function' ? snap.exists() : !!snap.exists);
          if (exists) applyDocData(snap.data ? snap.data() : null);
          loaded = true;
          return cache;
        });
      }).catch(function (e) {
        loaded = true;
        console.warn('[RankingDisplaySettings] 로드 실패:', e && e.message);
        return cache;
      });
    })();
    return loadingPromise;
  };

  /** @returns {{topN:number, neigh:number}} 캐시된 설정(미로드 시 기본값 100/50) */
  window.stelvioGetRankingDisplaySettings = function (platform) {
    var p = platform === 'run' ? 'run' : 'cycle';
    return { topN: cache[p].topN, neigh: cache[p].neigh };
  };

  window.stelvioRankingDisplaySettingsReady = function () {
    return loaded;
  };

  /** 관리자 전용 — Firestore 쓰기 규칙(grade='1')이 실제 권한을 강제한다. */
  window.stelvioSaveRankingDisplaySettings = function (platform, topN, neigh) {
    var p = platform === 'run' ? 'run' : 'cycle';
    var f = fbFns();
    if (!window.firestoreV9 || typeof f.doc !== 'function' || typeof f.setDoc !== 'function') {
      return Promise.reject(new Error('Firestore가 초기화되지 않았습니다.'));
    }
    var val = normalize({ topN: topN, neigh: neigh }, DEFAULTS[p]);
    var ref = f.doc(window.firestoreV9, 'appConfig', 'ranking_display_settings');
    var payload = {};
    payload[p] = val;
    return f.setDoc(ref, payload, { merge: true }).then(function () {
      cache[p] = val;
      return val;
    });
  };
})();
