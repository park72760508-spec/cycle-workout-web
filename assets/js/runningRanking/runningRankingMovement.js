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

  /** RUN 23:00 집계일 — 캘린더 오늘이 아닌 published leaderboard as_of */
  function resolveLeaderboardAsOfDate(opts) {
    opts = opts || {};
    var lb = opts.leaderboardAsOfSeoul != null ? String(opts.leaderboardAsOfSeoul).trim().slice(0, 10) : '';
    if (lb) return lb;
    var mv = opts.rankMovementAsOfSeoul != null ? String(opts.rankMovementAsOfSeoul).trim().slice(0, 10) : '';
    if (mv) return mv;
    return seoulToday();
  }

  function ymdAddDays(ymd, delta) {
    if (!ymd || !delta) return '';
    try {
      var p = String(ymd).trim().slice(0, 10).split('-');
      if (p.length !== 3) return '';
      var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
      dt.setUTCDate(dt.getUTCDate() + delta);
      return dt.toISOString().slice(0, 10);
    } catch (eYmd) {
      return '';
    }
  }

  function snapHasMovementPayload(snap) {
    if (!snap) return false;
    var cats = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
    var i;
    for (i = 0; i < cats.length; i++) {
      var ch = snap.rankChangesByCategory && snap.rankChangesByCategory[cats[i]];
      var pr = snap.previousRanksByCategory && snap.previousRanksByCategory[cats[i]];
      var pd = snap.prevDayRanksByCategory && snap.prevDayRanksByCategory[cats[i]];
      var rk = snap.ranksByCategory && snap.ranksByCategory[cats[i]];
      if (ch && Object.keys(ch).length) return true;
      if (pr && Object.keys(pr).length) return true;
      if (pd && Object.keys(pd).length) return true;
      if (rk && Object.keys(rk).length) return true;
    }
    return false;
  }

  /**
   * live 미리보기(오늘) + Supabase 스냅샷(전일 23:00 집계) 날짜가 달라도 등락 적용
   * — CYCLE stelvioApplyClientPeakRankMovementFromSnapshot 과 동일하게 공식 스냅샷 우선
   */
  function serverSnapUsableForMovement(snap, opts) {
    if (!snap || !snapHasMovementPayload(snap)) return false;
    opts = opts || {};
    var snapAsOf = snap.asOfSeoul != null ? String(snap.asOfSeoul).trim().slice(0, 10) : '';
    if (!snapAsOf) return false;
    if (opts.rankMovementSource === 'supabase') return true;
    var lb = resolveLeaderboardAsOfDate(opts);
    if (!lb) return true;
    if (snapAsOf === lb) return true;
    if (opts.leaderboardSource === 'live') {
      var yesterday = ymdAddDays(lb, -1);
      return snapAsOf === yesterday || snapAsOf <= lb;
    }
    return snapAsOf <= lb;
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

  function lookupSnapVal(map, id) {
    if (!map || id == null) return null;
    var s = String(id).trim();
    if (!s) return null;
    if (map[s] != null) return map[s];
    var lower = s.toLowerCase();
    var keys = Object.keys(map);
    var i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return map[keys[i]];
    }
    return null;
  }

  /** 보드 UUID · Firebase UID 등 목록 행 식별자로 스냅샷 조회 */
  function lookupSnapValForListItem(map, item) {
    if (!map || !item) return null;
    var ids = [];
    if (item.boardUserId != null && String(item.boardUserId).trim()) {
      ids.push(String(item.boardUserId).trim());
    }
    if (item.userId != null && String(item.userId).trim()) ids.push(String(item.userId).trim());
    if (item.socialUserId != null && String(item.socialUserId).trim()) {
      ids.push(String(item.socialUserId).trim());
    }
    if (item.firebaseUid != null && String(item.firebaseUid).trim()) {
      ids.push(String(item.firebaseUid).trim());
    }
    var i;
    for (i = 0; i < ids.length; i++) {
      var v = lookupSnapVal(map, ids[i]);
      if (v != null) return v;
    }
    return null;
  }

  function stampBoardRanks(list) {
    if (!list || !list.length) return;
    list.forEach(function (item) {
      if (!item || item.rank == null) return;
      item.boardRank = Math.floor(Number(item.rank));
    });
  }

  function clearRankMovementFields(list) {
    if (!list || !list.length) return;
    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;
    });
  }

  function hasServerRankMovementPayload(rankMovementByKey, opts) {
    opts = opts || {};
    if (opts.rankMovementSource === 'supabase') return true;
    if (!rankMovementByKey || typeof rankMovementByKey !== 'object') return false;
    return Object.keys(rankMovementByKey).length > 0;
  }

  function nonEmptyMap(m) {
    return m && typeof m === 'object' && Object.keys(m).length ? m : null;
  }

  /**
   * 등락 비교 baseline = "현재 표시 보드 직전의 공식(집계) 보드" 전체 순위맵.
   *
   * 핵심: 표시 보드가 라이브(오늘)이고 스냅샷 as_of 가 더 과거(어제)면,
   *   스냅샷 자신의 보드(ranksByCategory = 어제 23:00 전체 보드)가 곧 직전일 baseline 이다.
   *   (prevDayRanksByCategory 는 그제 보드라 하루 더 오래되고 희소 → 생존자 적고 보합/하락 편향)
   * 표시 보드가 스냅샷과 동일 집계일이면 prevDayRanksByCategory(전일)가 baseline.
   */
  function resolveBaselineMap(snap, cat, opts) {
    var snapAsOf = snap && snap.asOfSeoul != null ? String(snap.asOfSeoul).trim().slice(0, 10) : '';
    var lbAsOf = resolveLeaderboardAsOfDate(opts);
    var ownRanks = snap.ranksByCategory && snap.ranksByCategory[cat];
    var prevDay = snap.prevDayRanksByCategory && snap.prevDayRanksByCategory[cat];
    var previous = snap.previousRanksByCategory && snap.previousRanksByCategory[cat];

    /* 라이브(표시 보드가 스냅샷보다 최신) → 스냅샷 자신의 보드가 직전일 baseline */
    if (snapAsOf && lbAsOf && snapAsOf < lbAsOf) {
      return nonEmptyMap(ownRanks) || nonEmptyMap(prevDay) || nonEmptyMap(previous);
    }
    /* 스냅샷 == 표시 보드(동일 집계일) → 전일 baseline */
    return nonEmptyMap(prevDay) || nonEmptyMap(previous) || nonEmptyMap(ownRanks);
  }

  function baselinePrevRankForItem(baseline, item, tabId) {
    var prevVal = tabId === 'crew'
      ? lookupSnapVal(baseline, String(item.crewId))
      : lookupSnapValForListItem(baseline, item);
    if (prevVal == null) return null;
    var prev = Math.floor(Number(prevVal));
    return isFinite(prev) && prev >= 1 ? prev : null;
  }

  /**
   * 절대순위 등락 — 직전 공식 보드(baseline)의 절대 순위와 현재 절대 순위를 직접 비교.
   * rankChange = 전일 절대순위 - 현재 절대순위.
   *
   * 왜 절대순위인가(생존 코호트 재순위가 아니라):
   * 리더보드 등락의 자연스러운 의미는 "내 절대 순위가 몇 칸 올랐/내렸나"이다.
   * 신규 진입자가 내 위로 들어오면 나는 실제로 한 칸 밀린 것이므로 '하락'이 맞다.
   * 생존 코호트 재순위는 이런 신규 진입에 의한 정당한 하락을 "상대순서 동일"로 지워버려
   * 전부 보합(-)으로 표기되는 문제가 있었다(주간 누적 TSS 에서 특히 두드러짐).
   *
   * baseline 에 없는 사용자(신규 진입)는 등락 미표기.
   * 렌더 검증(previousBoardRank - rankChange === 현재 rank)을 위해 previousBoardRank = 전일 절대순위.
   * @returns {number} 등락이 채워진 사용자 수 (0 이면 미적용)
   */
  function applyAbsoluteMovement(list, baseline, tabId) {
    var up = 0;
    var down = 0;
    var flat = 0;
    var filled = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (tabId === 'crew') {
        if (!item.crewId) continue;
      } else if (!item.userId && !item.socialUserId && !item.firebaseUid) {
        continue;
      }
      var prev = baselinePrevRankForItem(baseline, item, tabId);
      var curr = Math.floor(Number(item.rank));
      if (prev == null || !isFinite(curr) || curr < 1) continue; /* 신규 진입 → 미표기 */
      var rc = prev - curr;
      item.rankChange = rc;
      item.previousBoardRank = prev;
      if (rc > 0) up++;
      else if (rc < 0) down++;
      else flat++;
      filled++;
    }
    try {
      window.__runRankMovementDebug = {
        listSize: list.length,
        baselineSize: baseline && typeof baseline === 'object' ? Object.keys(baseline).length : 0,
        filled: filled,
        up: up,
        down: down,
        flat: flat,
        tabId: tabId
      };
    } catch (eDbg) {}
    return filled;
  }

  function applyFromServerSnap(list, tabId, opts, rankMovementByKey) {
    if (!list || !list.length || !rankMovementByKey) return false;

    var hk = historyKey(tabId, opts);
    var snap = rankMovementByKey[hk];
    if (!snap) return false;
    if (!serverSnapUsableForMovement(snap, opts)) return false;

    var cat = opts.category || 'Supremo';
    var baseline = resolveBaselineMap(snap, cat, opts);
    if (!baseline) return false; /* baseline 없으면 localStorage 폴백 */

    /* 등락 초기화 후 생존 코호트 재순위로 상승/보합/하락 채움 */
    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;
    });

    var filled = applyAbsoluteMovement(list, baseline, tabId);
    if (!filled) return false; /* 공통 사용자 없음 → localStorage 폴백 */

    normalizeListRankMovement(list);
    /* history_key가 있으면 서버 스냅샷이 기준 — 기기별 localStorage로 덮지 않음 */
    return true;
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
      if (item.rankChange == null || item.previousBoardRank == null) return;
      if (item.previousBoardRank - item.rankChange !== item.rank) {
        item.rankChange = item.previousBoardRank - item.rank;
      }
    });
  }

  /**
   * @param {object[]} list — rank 필드가 채워진 목록 (in-place 수정)
   * @param {object} [rankMovementByKey] — API rankMovementByKey
   */
  function applyRankMovement(list, tabId, opts, rankMovementByKey) {
    opts = opts || {};
    if (!list || !list.length) return list;

    if (hasServerRankMovementPayload(rankMovementByKey, opts)) {
      if (applyFromServerSnap(list, tabId, opts, rankMovementByKey)) {
        stampBoardRanks(list);
        return list;
      }
    }

    var key = boardKey(tabId, opts);
    var leaderboardDate = resolveLeaderboardAsOfDate(opts);
    var compareDate = ymdAddDays(leaderboardDate, -1);
    var stored = loadSnap(key) || {};
    var prevRanks = null;

    if (stored.date === leaderboardDate && stored.prevDayRanks) {
      prevRanks = stored.prevDayRanks;
    } else if (stored.date === compareDate && stored.ranks) {
      prevRanks = stored.ranks;
    } else if (!prevRanks && stored.date && stored.date !== leaderboardDate && stored.ranks) {
      prevRanks = stored.ranks;
    }

    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;
    });

    /* 서버 스냅샷과 동일하게 절대순위 비교 */
    if (prevRanks) applyAbsoluteMovement(list, prevRanks, tabId);

    normalizeListRankMovement(list);

    var ranks = {};
    list.forEach(function (item) {
      if (!item || item.rank == null) return;
      var rankVal = Math.floor(Number(item.rank));
      if (tabId === 'crew') {
        if (item.crewId) ranks[String(item.crewId)] = rankVal;
      } else {
        var snapId = item.boardUserId || item.userId;
        if (snapId && !item.isCrew) ranks[String(snapId)] = rankVal;
      }
    });

    var next = {
      date: leaderboardDate,
      ranks: ranks,
      prevDayRanks: null,
      compareDate: compareDate
    };
    if (stored.date === leaderboardDate && stored.prevDayRanks) {
      next.prevDayRanks = stored.prevDayRanks;
    } else if (stored.date === compareDate && stored.ranks) {
      next.prevDayRanks = stored.ranks;
    } else if (stored.date && stored.date !== leaderboardDate) {
      next.prevDayRanks = stored.ranks || stored.prevDayRanks || null;
    }

    saveSnap(key, next);
    stampBoardRanks(list);
    return list;
  }

  window.runningRankingMovement = {
    applyRankMovement: applyRankMovement,
    historyKey: historyKey
  };
})();
