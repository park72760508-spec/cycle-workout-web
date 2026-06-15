/**
 * RUN 랭킹보드 — CYCLE Supremo 목록 펼치기/접기·본인 주변 표시 (index.html 동일 규칙)
 */
(function () {
  'use strict';

  var TOP_N = 5;
  var NEIGH = 3;

  function getViewerGrade() {
    if (typeof window.getViewerGrade === 'function') return window.getViewerGrade();
    return null;
  }

  function viewerCanGapControls() {
    var vg = getViewerGrade();
    if (vg == null || vg === '') return false;
    var s = String(vg).trim();
    if (s === '1' || s === '2' || s === '3') return true;
    var n = Number(vg);
    return !Number.isNaN(n) && n >= 1 && n <= 3;
  }

  /** grade 2·3: 펼침 시 상위 100 + 본인 ±20 */
  function isTrafficLimitedGrade() {
    var vg = getViewerGrade();
    if (vg == null || vg === '') return false;
    var s = String(vg).trim();
    if (s === '2' || s === '3') return true;
    var n = Number(vg);
    return !Number.isNaN(n) && (n === 2 || n === 3);
  }

  function rowListRank(item, idx0) {
    if (item && item.rank != null && isFinite(Number(item.rank))) return Number(item.rank);
    return idx0 + 1;
  }

  function buildVisibleIdxPlan(arr, userIdx, myRank1s, topN, neigh) {
    topN = topN != null ? topN : TOP_N;
    neigh = neigh != null ? neigh : NEIGH;
    var lastIdx = arr.length - 1;
    var idxSet = {};
    if (lastIdx < 0) {
      return { runs: [], hasMiddleGap: false, hasTail: false, needsExpandControl: false, lastIdx: -1 };
    }
    var tEnd = Math.min(topN - 1, lastIdx);
    var t;
    for (t = 0; t <= tEnd; t++) idxSet[t] = true;
    if (userIdx >= 0) {
      var w0 = Math.max(0, userIdx - neigh);
      var w1 = Math.min(lastIdx, userIdx + neigh);
      for (var w = w0; w <= w1; w++) idxSet[w] = true;
    } else if (myRank1s > 0) {
      for (var ri = 0; ri <= lastIdx; ri++) {
        if (Math.abs(rowListRank(arr[ri], ri) - myRank1s) <= neigh) idxSet[ri] = true;
      }
    }
    var sortedIdx = Object.keys(idxSet)
      .map(function (x) { return Number(x); })
      .filter(function (n) { return !Number.isNaN(n); })
      .sort(function (a, b) { return a - b; });
    var runs = [];
    if (sortedIdx.length) {
      var rs = sortedIdx[0];
      var re = sortedIdx[0];
      for (var si = 1; si < sortedIdx.length; si++) {
        if (sortedIdx[si] === re + 1) re = sortedIdx[si];
        else {
          runs.push([rs, re]);
          rs = re = sortedIdx[si];
        }
      }
      runs.push([rs, re]);
    }
    var hasMiddleGap = false;
    for (var rg = 1; rg < runs.length; rg++) {
      var mLo = runs[rg - 1][1] + 1;
      var mHi = runs[rg][0] - 1;
      if (mLo <= mHi) {
        hasMiddleGap = true;
        break;
      }
    }
    var tailLoR = runs.length ? runs[runs.length - 1][1] + 1 : 0;
    var hasTail = tailLoR <= lastIdx;
    return {
      runs: runs,
      hasMiddleGap: hasMiddleGap,
      hasTail: hasTail,
      needsExpandControl: hasMiddleGap || hasTail,
      lastIdx: lastIdx
    };
  }

  function findUserIdx(arr, matchFn) {
    if (!arr || !matchFn) return -1;
    for (var i = 0; i < arr.length; i++) {
      if (matchFn(arr[i], i)) return i;
    }
    return -1;
  }

  /**
   * 표시할 인덱스 집합·메타 반환
   * @returns {{ mode: 'all'|'indices'|'top3', indices: number[], needsExpandControl: boolean, expanded: boolean, showExpandRow: boolean, expandCollapsed: boolean }}
   */
  function buildListDisplayPlan(opts) {
    opts = opts || {};
    var arr = opts.arr || [];
    var userIdx = opts.userIdx != null ? opts.userIdx : -1;
    var myRank1s = opts.myRank1s != null ? opts.myRank1s : 0;
    var expanded = !!opts.expanded;
    var skipCollapse = !!opts.skipCollapse;
    var isExpired = !!opts.isExpired;

    if (!arr.length) {
      return { mode: 'all', indices: [], needsExpandControl: false, expanded: expanded, showExpandRow: false, expandCollapsed: true };
    }

    if (isExpired) {
      var expiredIdx = [];
      if (userIdx >= 0 && userIdx >= 3) {
        expiredIdx = [0, 1, 2, userIdx];
      } else {
        for (var e = 0; e < Math.min(3, arr.length); e++) expiredIdx.push(e);
      }
      return { mode: 'top3', indices: expiredIdx, needsExpandControl: false, expanded: false, showExpandRow: false, expandCollapsed: true };
    }

    if (skipCollapse) {
      var allIdx = [];
      for (var ai = 0; ai < arr.length; ai++) allIdx.push(ai);
      return { mode: 'all', indices: allIdx, needsExpandControl: false, expanded: true, showExpandRow: false, expandCollapsed: false };
    }

    var lastIdx = arr.length - 1;
    var canGap = viewerCanGapControls();
    var limited = isTrafficLimitedGrade();

    if (myRank1s <= 0 && userIdx < 0) {
      var topEnd0 = Math.min(TOP_N - 1, lastIdx);
      if (!expanded && lastIdx > topEnd0 && canGap) {
        var collapsed0 = [];
        for (var c0 = 0; c0 <= topEnd0; c0++) collapsed0.push(c0);
        return {
          mode: 'indices',
          indices: collapsed0,
          needsExpandControl: true,
          expanded: false,
          showExpandRow: true,
          expandCollapsed: true,
          limitedExpand: limited
        };
      }
      if (expanded && lastIdx > topEnd0 && canGap) {
        if (limited) {
          var limNz = [];
          var capNz = Math.min(99, lastIdx);
          for (var e0 = 0; e0 <= capNz; e0++) limNz.push(e0);
          return {
            mode: 'indices',
            indices: limNz,
            needsExpandControl: true,
            expanded: true,
            showExpandRow: true,
            expandCollapsed: false,
            limitedExpand: true,
            tailDots: lastIdx > capNz
          };
        }
        var full0 = [];
        for (var f0 = 0; f0 <= lastIdx; f0++) full0.push(f0);
        return {
          mode: 'indices',
          indices: full0,
          needsExpandControl: true,
          expanded: true,
          showExpandRow: true,
          expandCollapsed: false
        };
      }
      var all0 = [];
      for (var a0 = 0; a0 <= lastIdx; a0++) all0.push(a0);
      return { mode: 'all', indices: all0, needsExpandControl: false, expanded: expanded, showExpandRow: false, expandCollapsed: true };
    }

    var plan = buildVisibleIdxPlan(arr, userIdx, myRank1s, TOP_N, NEIGH);
    if (expanded && plan.needsExpandControl && canGap) {
      if (!limited) {
        var full1 = [];
        for (var f1 = 0; f1 <= lastIdx; f1++) full1.push(f1);
        return {
          mode: 'indices',
          indices: full1,
          needsExpandControl: true,
          expanded: true,
          showExpandRow: true,
          expandCollapsed: false
        };
      }
      var idxLim = {};
      var top100End = Math.min(99, lastIdx);
      var ti;
      for (ti = 0; ti <= top100End; ti++) idxLim[ti] = true;
      if (userIdx >= 0) {
        var loNx = Math.max(0, userIdx - 20);
        var hiNx = Math.min(lastIdx, userIdx + 20);
        for (var nix = loNx; nix <= hiNx; nix++) idxLim[nix] = true;
      } else if (myRank1s > 0) {
        for (var nri = 0; nri <= lastIdx; nri++) {
          if (Math.abs(rowListRank(arr[nri], nri) - myRank1s) <= 20) idxLim[nri] = true;
        }
      }
      var limSorted = Object.keys(idxLim).map(Number).sort(function (a, b) { return a - b; });
      return {
        mode: 'indices',
        indices: limSorted,
        needsExpandControl: true,
        expanded: true,
        showExpandRow: true,
        expandCollapsed: false,
        limitedExpand: true,
        runsFromIndices: true
      };
    }

    if (!expanded && plan.needsExpandControl && canGap) {
      var collapsedIdx = [];
      for (var r = 0; r < plan.runs.length; r++) {
        for (var ri2 = plan.runs[r][0]; ri2 <= plan.runs[r][1]; ri2++) collapsedIdx.push(ri2);
      }
      return {
        mode: 'indices',
        indices: collapsedIdx,
        runs: plan.runs,
        needsExpandControl: true,
        expanded: false,
        showExpandRow: true,
        expandCollapsed: true,
        hasTail: plan.hasTail
      };
    }

    if (!plan.needsExpandControl || !canGap) {
      var all1 = [];
      for (var a1 = 0; a1 <= lastIdx; a1++) all1.push(a1);
      return { mode: 'all', indices: all1, needsExpandControl: false, expanded: expanded, showExpandRow: false, expandCollapsed: true };
    }

    var collapsed2 = [];
    for (var r2 = 0; r2 < plan.runs.length; r2++) {
      for (var ri3 = plan.runs[r2][0]; ri3 <= plan.runs[r2][1]; ri3++) collapsed2.push(ri3);
    }
    return {
      mode: 'indices',
      indices: collapsed2,
      runs: plan.runs,
      needsExpandControl: plan.needsExpandControl,
      expanded: false,
      showExpandRow: true,
      expandCollapsed: true,
      hasTail: plan.hasTail
    };
  }

  function gapScopeKey(tabId, category) {
    return String(tabId || 'overall') + ':' + String(category || 'Supremo');
  }

  window.runningRankingListView = {
    TOP_N: TOP_N,
    NEIGH: NEIGH,
    viewerCanGapControls: viewerCanGapControls,
    isTrafficLimitedGrade: isTrafficLimitedGrade,
    rowListRank: rowListRank,
    buildVisibleIdxPlan: buildVisibleIdxPlan,
    findUserIdx: findUserIdx,
    buildListDisplayPlan: buildListDisplayPlan,
    gapScopeKey: gapScopeKey
  };
})();
