/**
 * RUN 랭킹 — 전일 대비 순위 등락 (서버 스냅샷 우선, KST 23:00 일 1회 집계)
 */
(function () {
  'use strict';

  var LS_PREFIX = 'runningRankSnap:v1:';

  function seoulToday() {
    if (typeof getSeoulDateStringYYYYMMDD === 'function') return getSeoulDateStringYYYYMMDD();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    } catch (e) {
      var d = new Date();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
  }

  function boardKey(tabId, opts) {
    opts = opts || {};
    return [
      tabId || 'overall',
      opts.paceDistance || '_',
      opts.gender || 'all',
      opts.category || 'Supremo'
    ].join('|');
  }

  function historyKey(tabId, opts) {
    opts = opts || {};
    var tab = tabId || 'overall';
    var g = opts.gender || 'all';
    if (tab === 'crew') return 'run_crew_' + g;
    if (tab === 'pace') return 'run_pace_' + (opts.paceDistance || '5k') + '_' + g;
    return 'run_' + tab + '_' + g;
  }

  function loadSnap(key) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSnap(key, data) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(data));
    } catch (e) {}
  }

  function applyFromServerSnap(list, tabId, opts, rankMovementByKey) {
    if (!list || !list.length || !rankMovementByKey) return false;

    var hk = historyKey(tabId, opts);
    var snap = rankMovementByKey[hk];
    if (!snap) return false;

    var cat = opts.category || 'Supremo';
    var changes = (snap.rankChangesByCategory && snap.rankChangesByCategory[cat]) || {};
    var previous = (snap.previousRanksByCategory && snap.previousRanksByCategory[cat]) || {};
    var hasAny = false;

    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;

      var id = tabId === 'crew'
        ? (item.crewId != null ? String(item.crewId) : '')
        : (item.userId != null ? String(item.userId) : '');
      if (!id) return;

      if (previous[id] != null) {
        var prev = Math.floor(Number(previous[id]));
        var curr = Math.floor(Number(item.rank));
        if (prev >= 1 && curr >= 1) {
          item.rankChange = prev - curr;
          item.previousBoardRank = prev;
          hasAny = true;
        }
      } else if (changes[id] != null && item.rank != null) {
        var ch = Number(changes[id]);
        var currRank = Math.floor(Number(item.rank));
        if (isFinite(ch) && currRank >= 1) {
          item.rankChange = ch;
          item.previousBoardRank = currRank - ch;
          hasAny = true;
        }
      }
    });

    normalizeListRankMovement(list);

    return hasAny || !!(snap.asOfSeoul);
  }

  function normalizeListRankMovement(list) {
    if (!list || !list.length) return;
    var normalizeFn = typeof window.stelvioNormalizeRankMovementOnRow === 'function'
      ? window.stelvioNormalizeRankMovementOnRow
      : null;
    if (!normalizeFn) return;
    list.forEach(function (item) {
      if (!item || item.rankChange == null) return;
      normalizeFn(item, item.rank);
    });
  }

  /**
   * @param {object[]} list — rank 필드가 채워진 목록 (in-place 수정)
   * @param {object} [rankMovementByKey] — API rankMovementByKey
   */
  function applyRankMovement(list, tabId, opts, rankMovementByKey) {
    if (!list || !list.length) return list;

    if (applyFromServerSnap(list, tabId, opts, rankMovementByKey)) {
      return list;
    }

    var key = boardKey(tabId, opts);
    var today = seoulToday();
    var stored = loadSnap(key) || {};
    var prevRanks = stored.prevDayRanks || null;

    if (!prevRanks && stored.date && stored.date !== today && stored.ranks) {
      prevRanks = stored.ranks;
    }

    list.forEach(function (item) {
      if (!item) return;
      if (tabId !== 'crew' && (item.isCrew || !item.userId)) return;
      if (tabId === 'crew' && !item.crewId) return;

      item.rankChange = null;
      item.previousBoardRank = null;
      var uid = tabId === 'crew' ? String(item.crewId) : String(item.userId);
      if (prevRanks && prevRanks[uid] != null) {
        var prev = Math.floor(Number(prevRanks[uid]));
        var curr = Math.floor(Number(item.rank));
        if (prev >= 1 && curr >= 1) {
          item.rankChange = prev - curr;
          item.previousBoardRank = prev;
        }
      }
    });

    normalizeListRankMovement(list);

    var ranks = {};
    list.forEach(function (item) {
      if (!item || item.rank == null) return;
      if (tabId === 'crew') {
        if (item.crewId) ranks[String(item.crewId)] = Math.floor(Number(item.rank));
      } else if (item.userId && !item.isCrew) {
        ranks[String(item.userId)] = Math.floor(Number(item.rank));
      }
    });

    var next = {
      date: today,
      ranks: ranks,
      prevDayRanks: stored.date === today ? (stored.prevDayRanks || null) : null
    };
    if (stored.date && stored.date !== today) {
      next.prevDayRanks = stored.ranks || stored.prevDayRanks || null;
    } else if (stored.prevDayRanks) {
      next.prevDayRanks = stored.prevDayRanks;
    }

    saveSnap(key, next);
    return list;
  }

  window.runningRankingMovement = {
    applyRankMovement: applyRankMovement,
    historyKey: historyKey
  };
})();
