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
    /*
     * 스냅샷 == 표시 보드(동일 집계일) → 전일 baseline.
     * 여기서 ownRanks 는 "표시 중인 현재 보드 그 자체"이므로 baseline 으로 쓰면
     * prev === curr 가 되어 전원 (-) 보합으로만 표기되는 퇴행이 발생한다.
     * 따라서 동일 집계일에는 ownRanks 폴백을 쓰지 않고, 전일 baseline 이 없으면
     * null 을 반환해 localStorage(실제 직전일 보드) 폴백으로 넘긴다.
     */
    return nonEmptyMap(prevDay) || nonEmptyMap(previous);
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
        tabId: tabId,
        mode: 'absolute'
      };
    } catch (eDbg) {}
    return { filled: filled, up: up, down: down, flat: flat };
  }

  /**
   * 생존 코호트 재순위 등락 — baseline·현재 보드 양쪽에 있는 공통 사용자만 각각 1..M 로
   * 다시 순위 매겨 비교(CYCLE stelvioComputeSurvivorAwareRankMovementForRows 동형).
   *
   * 왜 종합·구간·거리·크루 탭은 이 방식인가:
   * 절대순위 비교는 신규 진입으로 모집단이 커지면 기존 사용자 순위가 일제히 밀려
   * 상승/보합이 사라지고 하락·미표기만 남는다. 생존 코호트 재순위는 이 편향을 제거해
   * 상승/하락/보합(-)이 균형 있게 나온다.
   * (tss·주간거리처럼 주간 누적으로 모집단이 계속 커지는 지표만 절대순위를 쓴다.)
   *
   * previousBoardRank = 현재 절대순위 + rankChange 로 맞춰 렌더 검증
   * (previousBoardRank - rankChange === 현재순위)을 통과시킨다.
   * @returns {{filled:number, up:number, down:number, flat:number}}
   */
  function applySurvivorAwareMovement(list, baseline, tabId) {
    var up = 0;
    var down = 0;
    var flat = 0;
    var survivors = [];
    var i, item, prev, curr;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      if (!item) continue;
      if (tabId === 'crew') {
        if (!item.crewId) continue;
      } else if (!item.userId && !item.socialUserId && !item.firebaseUid) {
        continue;
      }
      prev = baselinePrevRankForItem(baseline, item, tabId);
      curr = Math.floor(Number(item.rank));
      if (prev == null || !isFinite(curr) || curr < 1) continue; /* 신규 진입 → 미표기 */
      survivors.push({ item: item, prev: prev, curr: curr });
    }
    if (survivors.length) {
      var byPrev = survivors.slice().sort(function (a, b) { return a.prev - b.prev; });
      for (i = 0; i < byPrev.length; i++) byPrev[i].prevAmong = i + 1;
      var byCurr = survivors.slice().sort(function (a, b) { return a.curr - b.curr; });
      for (i = 0; i < byCurr.length; i++) byCurr[i].currAmong = i + 1;
      for (i = 0; i < survivors.length; i++) {
        var s = survivors[i];
        var rc = s.prevAmong - s.currAmong;
        s.item.rankChange = rc;
        s.item.previousBoardRank = s.curr + rc;
        if (rc > 0) up++;
        else if (rc < 0) down++;
        else flat++;
      }
    }
    try {
      window.__runRankMovementDebug = {
        listSize: list.length,
        baselineSize: baseline && typeof baseline === 'object' ? Object.keys(baseline).length : 0,
        filled: survivors.length,
        up: up,
        down: down,
        flat: flat,
        tabId: tabId,
        mode: 'survivor'
      };
    } catch (eDbg) {}
    return { filled: survivors.length, up: up, down: down, flat: flat };
  }

  /*
   * 절대순위 탭 = TSS 보드 · 주간 마일리지 TOP10 모달(weekly_distance).
   *   - 전날 "절대순위" vs 현재 "절대순위"를 직접 비교(rankChange = 전날순위 - 현재순위).
   *   - 전날 보드에 없던 사용자(신규 진입)는 등락 미표기.
   *   - 신규 진입으로 밀려난 하락도 "실제 등락"으로 그대로 표기한다(사용자 요청, 07-06).
   * 종합·구간·크루 = 생존 코호트 재순위(모집단 증가 편향 제거).
   */
  function useAbsoluteMovementForTab(tabId) {
    return tabId === 'tss' || tabId === 'weekly_distance';
  }

  function applyMovementForTab(list, baseline, tabId) {
    return useAbsoluteMovementForTab(tabId)
      ? applyAbsoluteMovement(list, baseline, tabId)
      : applySurvivorAwareMovement(list, baseline, tabId);
  }

  /**
   * 서버가 집계 시 계산해 둔 공식 등락(rankChangesByCategory·previousRanksByCategory)을 그대로 사용.
   * — CYCLE GC(heptagon rank_change 우선)와 동일한 "서버 공식값 우선" 원칙.
   *
   * 왜 클라이언트 재계산보다 이게 우선인가:
   * 라이브 보드(오늘)가 스냅샷 보드(어제 23:00 집계)와 사실상 동일하면, "라이브 vs 어제" 재계산은
   * 전원 보합(-)이 되어버린다. 하지만 서버 공식 등락은 "어제 vs 그제"의 실제 상승/하락/보합을 담고
   * 있어, 사용자가 기대하는 "이전에 잘 나오던" 등락이 그대로 나온다.
   *
   * 여기서 previousBoardRank = 서버 previousRanks(그제 순위), rankChange = 서버 change(어제-그제).
   * 렌더 계층(resolveRankMovementFields)이 현재 표시 순위 기준으로 검증하므로:
   *   - 라이브 순위 == 스냅샷 순위 → 서버 등락 그대로 표기(정확한 공식 등락)
   *   - 어긋나면(당일 재정렬) → 현재 순위 기준으로 안전하게 재계산 (표시 순위 훼손 없음)
   * ※ 이 경로에서는 stelvioNormalizeRankMovementOnRow(순위 훼손 위험)를 호출하지 않는다.
   * @returns {number} 등락이 채워진 사용자 수
   */
  function applyServerComputedMovement(list, snap, cat, tabId) {
    var changes = snap.rankChangesByCategory && snap.rankChangesByCategory[cat];
    var previous = snap.previousRanksByCategory && snap.previousRanksByCategory[cat];
    if (!nonEmptyMap(changes) || !nonEmptyMap(previous)) return 0;
    var filled = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (tabId === 'crew') {
        if (!item.crewId) continue;
      } else if (!item.userId && !item.socialUserId && !item.firebaseUid) {
        continue;
      }
      var prevVal = tabId === 'crew'
        ? lookupSnapVal(previous, String(item.crewId))
        : lookupSnapValForListItem(previous, item);
      var chVal = tabId === 'crew'
        ? lookupSnapVal(changes, String(item.crewId))
        : lookupSnapValForListItem(changes, item);
      if (prevVal == null || chVal == null) continue; /* 신규 진입 → 미표기 */
      var prev = Math.floor(Number(prevVal));
      if (!isFinite(prev) || prev < 1) continue;
      /*
       * rankChange는 서버가 저장해둔 raw 값(chVal) 대신 "서버 previousBoardRank − 오늘 실제 표시 순위"로
       * 다시 계산한다. chVal은 서버 집계 시점의 자체 current-rank로 계산돼 있어, 지금 화면에 표시 중인
       * 라이브 순위(item.rank)와 어긋나면 1위가 (↓N)으로 오표기되는 문제가 있었다(weekly_distance 등
       * 실시간 누적 지표에서 특히 발생). previousBoardRank(prev)는 그대로 서버의 정확한 전일 값을 쓰되,
       * 등락 자체는 항상 "previousBoardRank - 현재 표시 순위"로 맞춰 표시 순위와 100% 일관되게 만든다.
       */
      var liveCurr = Math.floor(Number(item.rank));
      var rc = (isFinite(liveCurr) && liveCurr >= 1) ? (prev - liveCurr) : Math.round(Number(chVal));
      if (!isFinite(rc)) continue;
      item.previousBoardRank = prev;
      item.rankChange = rc;
      filled++;
    }
    try {
      window.__runRankMovementDebug = {
        listSize: list.length,
        filled: filled,
        tabId: tabId,
        mode: 'server'
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

    /* 등락 초기화 */
    list.forEach(function (item) {
      if (!item) return;
      item.rankChange = null;
      item.previousBoardRank = null;
    });

    /*
     * 1순위: 서버 공식 baseline(previousRanksByCategory) 사용 — CYCLE GC 와 동일한 서버 우선 원칙.
     * 라이브 보드가 스냅샷 보드와 같아 클라이언트 재계산이 전원 보합이 되는 상황에서도,
     * 서버가 담아둔 실제 전일 순위를 baseline 으로 상승/하락/보합을 표기한다.
     *
     * weekly_distance(주간 마일리지 TOP10 모달)도 이제 이 경로를 탄다 — 과거엔 "서버 raw 등락값을
     * 그대로 믿으면 라이브 순위와 어긋나 1위가 (↓N)으로 오표기될 수 있다"는 이유로 제외했었지만,
     * applyServerComputedMovement() 가 이제 raw chVal 대신 "서버 previousBoardRank − 오늘 실제
     * 표시 순위(item.rank)"로 등락을 다시 계산하므로 그 문제가 원천 차단된다
     * (previousBoardRank - rankChange === 현재순위 항상 보장 → 1위는 절대 하락으로 표기되지 않음).
     * 이전엔 이 탭만 baseline 자체 재계산(아래 2순위)으로 우회했는데, 그 baseline이 상위권에서
     * "오늘 순위 == 어제 순위"로 자주 일치해(누적 거리 특성상 선두권 순위 변동이 적음) TOP10이
     * 항상 보합(-)으로만 표기되는 문제가 있었다 — 서버의 실제 등락값을 쓰면 해결된다.
     */
    var serverFilled = applyServerComputedMovement(list, snap, cat, tabId);
    if (serverFilled > 0) {
      /* history_key가 있으면 서버 스냅샷이 기준 — 기기별 localStorage로 덮지 않음 */
      return true;
    }

    /* 2순위: 서버 공식 등락이 비면 baseline 재계산(생존 코호트/절대순위) */
    var baseline = resolveBaselineMap(snap, cat, opts);
    if (!baseline) return false; /* baseline 없으면 localStorage 폴백 */

    var mv = applyMovementForTab(list, baseline, tabId);
    if (!mv.filled) return false; /* 공통 사용자 없음 → localStorage 폴백 */

    /*
     * 절대순위 탭(TSS 보드 탭)에서만 자기비교(전원 보합) 퇴행 방어.
     * 서버 baseline 이 현재 보드와 사실상 동일하면 3명 이상이 전원 보합(up=0·down=0)으로만
     * 나오는데, 절대순위 탭에서는 정상 등락이 아니라 baseline 퇴행이므로 localStorage 폴백으로 넘긴다.
     * 생존 코호트 탭은 순서 불변 시 전원 보합(-)이 정상이므로 가드에서 제외한다.
     * (CYCLE stelvioPeakRankMovementIsAllFlat 방어와 동일한 취지)
     */
    if (useAbsoluteMovementForTab(tabId) && mv.filled >= 3 && mv.up === 0 && mv.down === 0) {
      clearRankMovementFields(list);
      return false;
    }

    normalizeListRankMovement(list);
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

    /* 서버 스냅샷과 동일한 탭별 방식(종합·구간·크루=생존 코호트, tss·주간 마일리지=절대순위) */
    if (prevRanks) applyMovementForTab(list, prevRanks, tabId);

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
