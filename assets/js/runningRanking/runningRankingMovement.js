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
      if (ch && Object.keys(ch).length) return true;
      if (pr && Object.keys(pr).length) return true;
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
    if (item.userId != null && String(item.userId).trim()) ids.push(String(item.userId).trim());
    if (item.socialUserId != null && String(item.socialUserId).trim()) ids.push(String(item.socialUserId).trim());
    if (item.firebaseUid != null && String(item.firebaseUid).trim()) ids.push(String(item.firebaseUid).trim());
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

  /**
   * 전일 전체 baseline 맵 — CYCLE rankMovementPrevDayByCategory 동형.
   * prevDayRanksByCategory(집계 baseline 전체) 우선, 없으면 previousRanksByCategory(공식보드 교집합) 폴백.
   */
  function resolveBaselineMap(snap, cat) {
    var prevDay = snap.prevDayRanksByCategory && snap.prevDayRanksByCategory[cat];
    if (prevDay && Object.keys(prevDay).length) return prevDay;
    var previous = snap.previousRanksByCategory && snap.previousRanksByCategory[cat];
    if (previous && Object.keys(previous).length) return previous;
    return null;
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
   * 생존 코호트(전일·현재 공통 사용자) 재순위 기반 등락 — CYCLE
   * stelvioComputeSurvivorAwareRankMovementForRows 와 동일 개념.
   *
   * 왜 절대순위(prev - curr)가 아니라 생존 코호트인가:
   * 주간 누적 TSS·30일 거리 등은 시간이 지날수록 참가자(모집단)가 늘어, 전일 baseline 에 있던
   * 사용자들의 "현재 절대 순위 숫자"가 신규 진입자 때문에 일괄적으로 커진다(=전부 하락처럼 보임).
   * 양일 공통 사용자만으로 양쪽을 다시 1..M 로 재순위하면 이 모집단 증가 편향이 제거돼
   * 상승·보합·하락이 균형 있게 나타난다.
   *
   * 렌더 경로(stelvioRankMovementRowMatchesCurrentRank / stelvioNormalizeRankMovementOnRow)는
   * previousBoardRank - rankChange === 현재(절대)rank 일치를 요구하므로,
   * previousBoardRank 는 (현재 절대 rank + rankChange) 로 맞춘다.
   * @returns {number} 등락이 채워진 생존자 수 (0 이면 미적용)
   */
  function applySurvivorAwareMovement(list, baseline, tabId) {
    var survivors = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (tabId === 'crew') {
        if (!item.crewId) continue;
      } else if (!item.userId && !item.socialUserId && !item.firebaseUid) {
        continue;
      }
      var prev = baselinePrevRankForItem(baseline, item, tabId);
      var currAbs = Math.floor(Number(item.rank));
      if (prev == null || !isFinite(currAbs) || currAbs < 1) continue;
      survivors.push({ item: item, prev: prev, order: i });
    }
    if (!survivors.length) return 0;

    var byPrev = survivors.slice().sort(function (a, b) {
      if (a.prev !== b.prev) return a.prev - b.prev;
      return a.order - b.order;
    });
    var p;
    for (p = 0; p < byPrev.length; p++) byPrev[p].prevAmong = p + 1;
    /* list 는 이미 현재 순위 오름차순 정렬 — order 가 곧 현재 순위 */
    var byCurr = survivors.slice().sort(function (a, b) {
      return a.order - b.order;
    });
    var c;
    for (c = 0; c < byCurr.length; c++) byCurr[c].currAmong = c + 1;

    var up = 0;
    var down = 0;
    var flat = 0;
    for (var s = 0; s < survivors.length; s++) {
      var sv = survivors[s];
      var rc = sv.prevAmong - sv.currAmong;
      var currAbs2 = Math.floor(Number(sv.item.rank));
      sv.item.rankChange = rc;
      /* prev - rc === currAbs 유지 → 렌더 일치 검증 통과 */
      sv.item.previousBoardRank = currAbs2 + rc;
      if (rc > 0) up++;
      else if (rc < 0) down++;
      else flat++;
    }
    try {
      window.__runRankMovementDebug = {
        listSize: list.length,
        survivors: survivors.length,
        up: up,
        down: down,
        flat: flat,
        tabId: tabId
      };
    } catch (eDbg) {}
    return survivors.length;
  }

  function applyFromServerSnap(list, tabId, opts, rankMovementByKey) {
    if (!list || !list.length || !rankMovementByKey) return false;

    var hk = historyKey(tabId, opts);
    var snap = rankMovementByKey[hk];
    if (!snap) return false;
    if (!serverSnapUsableForMovement(snap, opts)) return false;

    var cat = opts.category || 'Supremo';
    var baseline = resolveBaselineMap(snap, cat);
    if (!baseline) return false; /* baseline 없으면 localStorage 폴백 */

    /* 등락 초기화 후 생존 코호트 재순위로 상승/보합/하락 채움 */
    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;
    });

    var filled = applySurvivorAwareMovement(list, baseline, tabId);
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

    /* 서버 스냅샷과 동일하게 생존 코호트 재순위(모집단 증가 하락 편향 제거) */
    if (prevRanks) applySurvivorAwareMovement(list, prevRanks, tabId);

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
