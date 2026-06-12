/**
 * RUN 랭킹 — 전일 대비 순위 등락 (로컬 스냅샷, KST 일자 기준)
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

  /**
   * @param {object[]} list — rank 필드가 채워진 목록 (in-place 수정)
   */
  function applyRankMovement(list, tabId, opts) {
    if (!list || !list.length || tabId === 'crew') return list;

    var key = boardKey(tabId, opts);
    var today = seoulToday();
    var stored = loadSnap(key) || {};
    var prevRanks = stored.prevDayRanks || null;

    if (!prevRanks && stored.date && stored.date !== today && stored.ranks) {
      prevRanks = stored.ranks;
    }

    list.forEach(function (item) {
      if (!item || item.isCrew || !item.userId) return;
      item.rankChange = null;
      item.previousBoardRank = null;
      var uid = String(item.userId);
      if (prevRanks && prevRanks[uid] != null) {
        var prev = Math.floor(Number(prevRanks[uid]));
        var curr = Math.floor(Number(item.rank));
        if (prev >= 1 && curr >= 1) {
          item.rankChange = prev - curr;
          item.previousBoardRank = prev;
        }
      }
    });

    var ranks = {};
    list.forEach(function (item) {
      if (item && item.userId && !item.isCrew && item.rank != null) {
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
    applyRankMovement: applyRankMovement
  };
})();
