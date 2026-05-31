/**
 * GC·헵타곤 표시 창 — 03:20 KST 집계 완료 전까지 전날 스냅샷 유지 (랭킹보드·Octagon·분포 차트 공용)
 */
(function () {
  'use strict';

  function stelvioSeoulYmdFromTs(ts) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ts));
    } catch (eYmd) {
      return '';
    }
  }

  function stelvioSeoulYmdAddDays(ymd, deltaDays) {
    if (!ymd || !deltaDays) return ymd || '';
    try {
      var p = String(ymd).trim().slice(0, 10).split('-');
      if (p.length < 3) return ymd;
      var dt = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      dt.setDate(dt.getDate() + (deltaDays | 0));
      var pad = function (n) {
        return String(n).padStart(2, '0');
      };
      return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    } catch (eAdd) {
      return ymd;
    }
  }

  function stelvioGetLastHeptagonRolloverTs() {
    var now = Date.now();
    var kstNow = new Date(now + 9 * 3600000);
    var todayHept = Date.UTC(
      kstNow.getUTCFullYear(),
      kstNow.getUTCMonth(),
      kstNow.getUTCDate(),
      18,
      20,
      0
    );
    return todayHept <= now ? todayHept : todayHept - 86400000;
  }

  function stelvioGcMinAcceptableSnapshotYmd() {
    var lastHept = stelvioGetLastHeptagonRolloverTs();
    if (!lastHept) return '';
    return stelvioSeoulYmdFromTs(lastHept);
  }

  function stelvioGcIsHeptagonBatchCompleteForMinYmd(data, minYmd) {
    if (!data || !minYmd) return false;
    var asOf = data.gcSnapshotAsOf != null ? String(data.gcSnapshotAsOf).trim().slice(0, 10) : '';
    var metaDate =
      data.gcHeptagonRebuildDateKst != null ? String(data.gcHeptagonRebuildDateKst).trim().slice(0, 10) : '';
    if (!asOf || !metaDate || data.gcHeptagonRebuildStatus !== 'complete') return false;
    if (metaDate < minYmd || asOf < minYmd) return false;
    if (data.gcSnapshotStale === true) return false;
    if (metaDate > asOf) return false;
    return true;
  }

  function stelvioGcDisplayWindowMinAsOfYmd() {
    var minYmd = stelvioGcMinAcceptableSnapshotYmd();
    if (!minYmd) return '';
    return stelvioSeoulYmdAddDays(minYmd, -1);
  }

  function stelvioGcRankingPayloadHasVisibleRows(data) {
    if (!data || !data.byCategory) return false;
    var cats = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
    for (var i = 0; i < cats.length; i++) {
      var rows = data.byCategory[cats[i]];
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    return false;
  }

  function stelvioGcPayloadMatchesDisplayWindow(data) {
    if (!data || data.durationType !== 'gc') return true;
    var asOf = data.gcSnapshotAsOf != null ? String(data.gcSnapshotAsOf).trim().slice(0, 10) : '';
    if (!asOf) return false;
    var minFloor = stelvioGcDisplayWindowMinAsOfYmd();
    if (minFloor && asOf < minFloor) return false;
    var minYmd = stelvioGcMinAcceptableSnapshotYmd();
    if (stelvioGcIsHeptagonBatchCompleteForMinYmd(data, minYmd)) return true;
    if (data.gcMonthKey) {
      var asOfMonth = asOf.slice(0, 7);
      var payloadMonth = String(data.gcMonthKey);
      if (payloadMonth !== asOfMonth && asOf.length >= 7) {
        var expMonth = asOf.slice(0, 7);
        if (payloadMonth !== expMonth) return false;
      }
    }
    var metaDate =
      data.gcHeptagonRebuildDateKst != null ? String(data.gcHeptagonRebuildDateKst).trim().slice(0, 10) : '';
    if (
      metaDate &&
      minYmd &&
      data.gcHeptagonRebuildStatus === 'complete' &&
      metaDate >= minYmd &&
      metaDate > asOf
    ) {
      return false;
    }
    return true;
  }

  function stelvioGcPayloadUsableForHeptagonGraph(data) {
    if (!data || !data.success || !data.byCategory) return false;
    if (!stelvioGcRankingPayloadHasVisibleRows(data)) return false;
    return stelvioGcPayloadMatchesDisplayWindow(data);
  }

  function stelvioResolveGcRankingSeedFromRankingBoard(uid, gender) {
    gender = gender === 'M' || gender === 'F' ? gender : 'all';
    var pinned = typeof window !== 'undefined' ? window.stelvioGcPinnedRankingPayload : null;
    if (
      pinned &&
      pinned.success &&
      pinned.byCategory &&
      stelvioGcPayloadUsableForHeptagonGraph(pinned)
    ) {
      var pg = pinned.gender != null ? String(pinned.gender) : 'all';
      if (gender === 'all' || pg === 'all' || pg === gender) {
        return pinned;
      }
    }
    if (
      typeof window !== 'undefined' &&
      window.stelvioRankingByCategory &&
      typeof window.stelvioIsGcRankingMode === 'function' &&
      window.stelvioIsGcRankingMode()
    ) {
      var live = {
        success: true,
        byCategory: window.stelvioRankingByCategory,
        entries: window.stelvioRankingFullEntries,
        durationType: 'gc',
        startStr: window.stelvioRankingApiStartStr,
        endStr: window.stelvioRankingApiEndStr,
        gcSnapshotAsOf: window.stelvioLastGcSnapshotAsOf,
        gcMonthKey: window.stelvioLastGcMonthKey,
      };
      if (stelvioGcPayloadUsableForHeptagonGraph(live)) {
        return live;
      }
    }
    return null;
  }

  window.stelvioGcMinAcceptableSnapshotYmd = stelvioGcMinAcceptableSnapshotYmd;
  window.stelvioGcDisplayWindowMinAsOfYmd = stelvioGcDisplayWindowMinAsOfYmd;
  window.stelvioGcIsHeptagonBatchCompleteForMinYmd = stelvioGcIsHeptagonBatchCompleteForMinYmd;
  window.stelvioGcPayloadMatchesDisplayWindow = stelvioGcPayloadMatchesDisplayWindow;
  window.stelvioGcRankingPayloadHasVisibleRows = stelvioGcRankingPayloadHasVisibleRows;
  window.stelvioGcPayloadUsableForHeptagonGraph = stelvioGcPayloadUsableForHeptagonGraph;
  window.stelvioResolveGcRankingSeedFromRankingBoard = stelvioResolveGcRankingSeedFromRankingBoard;
})();
