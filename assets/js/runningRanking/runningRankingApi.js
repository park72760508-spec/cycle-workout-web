/**
 * getRunningLeaderboard API — fetch + 메모리 캐시 (일 1회 스냅샷)
 */
(function () {
  'use strict';

  var _cache = {
    at: 0,
    pv: '',
    rows: null,
    rankMovementByKey: null,
    rankMovementAsOfSeoul: '',
    rankMovementSource: '',
    leaderboardSource: '',
    leaderboardAsOfSeoul: '',
    error: null
  };
  var _inflight = null;

  /* localStorage 영속 캐시 — 페이지/WebView 재로드로 메모리 캐시(_cache)가 사라져도
     최초 진입 시 즉시 표시할 수 있게 한다(CYCLE stelvioRankingPersistentCache와 동일 취지).
     신선도 판정(isStaleLeaderboardCache/CACHE_TTL_MS/pv 비교)은 그대로 유지 — 저장 위치만 추가. */
  var RUN_LB_LS_KEY = 'stelvio_run_leaderboard_cache_v1';

  function persistCacheToLocalStorage() {
    try {
      if (!_cache.rows || !_cache.rows.length) return;
      localStorage.setItem(RUN_LB_LS_KEY, JSON.stringify(_cache));
    } catch (e) {
      /* 용량 부족 등 — 메모리 캐시만으로 계속 동작 */
    }
  }

  function hydrateCacheFromLocalStorage() {
    try {
      var raw = localStorage.getItem(RUN_LB_LS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) {
        _cache = {
          at: Number(parsed.at) || 0,
          pv: parsed.pv || '',
          rows: parsed.rows,
          rankMovementByKey: parsed.rankMovementByKey || null,
          rankMovementAsOfSeoul: parsed.rankMovementAsOfSeoul || '',
          rankMovementSource: parsed.rankMovementSource || '',
          leaderboardSource: parsed.leaderboardSource || '',
          leaderboardAsOfSeoul: parsed.leaderboardAsOfSeoul || '',
          error: null
        };
      }
    } catch (e) {
      /* 손상된 캐시 — 무시하고 네트워크로 진행 */
    }
  }
  hydrateCacheFromLocalStorage();

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

  // 비공개 캐시 버전 (Supabase ranking_build_meta.run_privacy_version). 토글 시 서버가 1 증가.
  // 이 값을 리더보드 요청 URL에 붙여, 비공개 변경 시에만 CDN 캐시를 무효화한다.
  // getRankingBuildMetaPublic(30초 CDN 캐시)을 우선 사용 — Firestore ranking_meta 직접 조회 제거.
  var RUN_PRIVACY_VERSION_URL = 'https://us-central1-stelvio-ai.cloudfunctions.net/getRankingBuildMetaPublic';
  var _pvCache = { at: 0, value: '' };
  var PV_TTL_MS = 30000;

  function resolvePrivacyVersionViaFirestoreFallback() {
    try {
      var fs = (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : null;
      if (!fs) return Promise.resolve(_pvCache.value || '0');
      return fs.collection('ranking_meta').doc('run_privacy_version').get()
        .then(function (snap) {
          var data = snap && snap.exists ? (snap.data() || {}) : {};
          var ver = data.version != null ? String(data.version) : '0';
          _pvCache = { at: Date.now(), value: ver };
          return ver;
        })
        .catch(function () { return _pvCache.value || '0'; });
    } catch (e) {
      return Promise.resolve(_pvCache.value || '0');
    }
  }

  function resolvePrivacyVersion(force) {
    var now = Date.now();
    if (!force && _pvCache.value && now - _pvCache.at < PV_TTL_MS) {
      return Promise.resolve(_pvCache.value);
    }
    return fetch(RUN_PRIVACY_VERSION_URL, { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json || json.success !== true || json.runPrivacyVersion == null) {
          return resolvePrivacyVersionViaFirestoreFallback();
        }
        var ver = String(json.runPrivacyVersion);
        _pvCache = { at: Date.now(), value: ver };
        return ver;
      })
      .catch(function () { return resolvePrivacyVersionViaFirestoreFallback(); });
  }

  /** API_URL 에 일자(d)·비공개버전(pv)·week 쿼리를 붙여 CDN 캐시 키 구성 */
  function buildRequestUrl(base, pv, opts) {
    opts = opts || {};
    var sep = String(base).indexOf('?') >= 0 ? '&' : '?';
    var url = base + sep + 'd=' + encodeURIComponent(seoulTodayYmd()) + '&pv=' + encodeURIComponent(pv || '0');
    if (opts.week === 'prev') url += '&week=prev';
    return url;
  }

  /**
   * @returns {Promise<{ success: boolean, rows: object[], error?: string }>}
   */
  function fetchLeaderboard(opts) {
    opts = opts || {};
    var cfg = getConfig();
    return resolvePrivacyVersion(opts.force).then(function (pv) {
      var now = Date.now();
      var minScoringVersion = cfg.LEADERBOARD_SCORING_VERSION || cfg.GC_SCORING_VERSION || 2;
      var isPrevWeekReq = opts.week === 'prev';
      var cacheScoringOk = _cache.rows
        && _cache.rows.length
        && Number(_cache.rows[0].scoring_version) >= minScoringVersion;
      // 비공개 버전(pv)이 바뀌면 캐시를 신선하지 않은 것으로 보고 즉시 재조회
      var cacheFresh = !isStaleLeaderboardCache(_cache) && String(_cache.pv || '') === String(pv || '');
      if (!opts.force && !isPrevWeekReq && _cache.rows && cacheScoringOk && cacheFresh && now - _cache.at < cfg.CACHE_TTL_MS) {
        return {
          success: true,
          rows: _cache.rows.slice(),
          rankMovementByKey: _cache.rankMovementByKey || {},
          rankMovementAsOfSeoul: _cache.rankMovementAsOfSeoul || '',
          rankMovementSource: _cache.rankMovementSource || '',
          leaderboardSource: _cache.leaderboardSource || '',
          leaderboardAsOfSeoul: _cache.leaderboardAsOfSeoul || ''
        };
      }
      if (_inflight && !opts.force) return _inflight;

      _inflight = fetch(buildRequestUrl(cfg.API_URL, pv, opts), { method: 'GET', credentials: 'omit' })
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
            var result = {
              success: true,
              rows: rows.slice(),
              rankMovementByKey: rankMovementByKey,
              rankMovementAsOfSeoul: rankMovementAsOfSeoul,
              rankMovementSource: rankMovementSource,
              leaderboardSource: leaderboardSource,
              leaderboardAsOfSeoul: leaderboardAsOfSeoul,
              prevWeekFallback: body.prevWeekFallback === true,
              weekStartStr: body.weekStartStr ? String(body.weekStartStr) : '',
              weekEndStr: body.weekEndStr ? String(body.weekEndStr) : ''
            };
            if (!isPrevWeekReq) {
              _cache = {
                at: Date.now(),
                pv: String(pv || ''),
                rows: rows,
                rankMovementByKey: rankMovementByKey,
                rankMovementAsOfSeoul: rankMovementAsOfSeoul,
                rankMovementSource: rankMovementSource,
                leaderboardSource: leaderboardSource,
                leaderboardAsOfSeoul: leaderboardAsOfSeoul,
                error: null
              };
              persistCacheToLocalStorage();
            }
            return result;
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
    });
  }

  function invalidateCache() {
    _cache = {
      at: 0,
      pv: '',
      rows: null,
      rankMovementByKey: null,
      rankMovementAsOfSeoul: '',
      rankMovementSource: '',
      leaderboardSource: '',
      leaderboardAsOfSeoul: '',
      error: null
    };
    _pvCache = { at: 0, value: '' };
    try {
      localStorage.removeItem(RUN_LB_LS_KEY);
    } catch (e) {}
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
