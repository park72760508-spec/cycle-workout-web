/**
 * RUN 랭킹보드 — CYCLE 전체(Supremo)와 동일 펼치기/접기·본인 하이라이트 목록
 */
/* global React, useMemo */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var useMemo = React.useMemo;

  function lv() { return window.runningRankingListView || {}; }

  function DotsRow() {
    return React.createElement('div', { className: 'stelvio-rank-row stelvio-rank-dots-row', 'aria-hidden': true },
      React.createElement('span', { className: 'stelvio-rank-ranklead' },
        React.createElement('span', { className: 'stelvio-rank-crown stelvio-rank-crown--placeholder' }),
        React.createElement('span', { className: 'stelvio-rank-pos' })
      ),
      React.createElement('span', { className: 'stelvio-rank-name' },
        React.createElement('span', { className: 'stelvio-rank-name-text' }, '.....')
      ),
      React.createElement('span', { className: 'stelvio-rank-wkg' })
    );
  }

  function ExpandGapRow(props) {
    var collapsed = !!props.collapsed;
    var limited = !!props.limited;
    var onToggle = props.onToggle;
    if (!lv().viewerCanGapControls || !lv().viewerCanGapControls()) return null;

    if (limited) {
      return React.createElement('div', {
        className: 'stelvio-rank-row stelvio-rank-expand-row stelvio-rank-expand-hit',
        role: 'button',
        tabIndex: 0,
        onClick: function () { if (onToggle) onToggle(collapsed); },
        onKeyDown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (onToggle) onToggle(collapsed);
          }
        }
      },
        React.createElement('span', { className: 'stelvio-rank-expand-left' }),
        React.createElement('span', { className: 'stelvio-rank-expand-center' }, collapsed ? '펼쳐보기' : '접어보기'),
        React.createElement('span', {
          className: 'stelvio-rank-expand-right ' + (collapsed ? 'stelvio-rank-expand-plus' : 'stelvio-rank-expand-minus')
        }, collapsed ? '+' : '−')
      );
    }

    return React.createElement('div', {
      className: 'stelvio-rank-row stelvio-rank-expand-row stelvio-rank-expand-row-split',
      role: 'group',
      'aria-label': '전체 랭킹 접기 펼치기'
    },
      React.createElement('span', {
        role: 'button',
        tabIndex: collapsed ? -1 : 0,
        className: 'stelvio-rank-expand-left stelvio-rank-expand-minus' +
          (collapsed ? ' stelvio-rank-expand-muted' : ' stelvio-rank-expand-hit'),
        'aria-label': '접어보기',
        title: '접어보기',
        onClick: collapsed ? undefined : function (e) {
          e.stopPropagation();
          if (onToggle) onToggle(false);
        }
      }, '−'),
      React.createElement('span', { className: 'stelvio-rank-expand-center' }, '전체 랭킹'),
      React.createElement('span', {
        role: 'button',
        tabIndex: collapsed ? 0 : -1,
        className: 'stelvio-rank-expand-right stelvio-rank-expand-plus' +
          (collapsed ? ' stelvio-rank-expand-hit' : ' stelvio-rank-expand-muted'),
        'aria-label': '펼쳐보기',
        title: '펼쳐보기',
        onClick: collapsed ? function (e) {
          e.stopPropagation();
          if (onToggle) onToggle(true);
        } : undefined
      }, '+')
    );
  }

  function RunningRankingCollapsibleList(props) {
    var items = props.items || [];
    var tabId = props.tabId;
    var currentUserId = props.currentUserId;
    var viewerIdentity = props.viewerIdentity || null;
    var myCrewIds = props.myCrewIds || null;
    var listCategory = props.listCategory || 'Supremo';
    var socialVer = props.socialVer || 0;
    var showSegments = !!props.showSegments;
    var skipCollapse = !!props.skipCollapse;
    var expanded = !!props.expanded;
    var onExpandChange = props.onExpandChange;
    var orphanViewerItem = props.orphanViewerItem || null;

    var Row = window.RunningRankingRow;

    var dataApi = window.runningRankingData || {};

    var matchFn = useMemo(function () {
      if (tabId === 'crew') {
        return function (item) {
          return !!(myCrewIds && item && item.crewId && myCrewIds.has(String(item.crewId)));
        };
      }
      return function (item) {
        if (dataApi.listItemMatchesViewer && viewerIdentity) {
          return dataApi.listItemMatchesViewer(item, viewerIdentity);
        }
        return !!(currentUserId && item && item.userId && String(item.userId) === String(currentUserId));
      };
    }, [tabId, currentUserId, viewerIdentity, myCrewIds]);

    var userIdx = useMemo(function () {
      return lv().findUserIdx ? lv().findUserIdx(items, matchFn) : -1;
    }, [items, matchFn]);

    var myRank1s = useMemo(function () {
      if (userIdx >= 0) return userIdx + 1;
      if (orphanViewerItem && orphanViewerItem.rank != null) {
        return Math.floor(Number(orphanViewerItem.rank)) || 0;
      }
      return 0;
    }, [userIdx, orphanViewerItem]);

    var isExpired = useMemo(function () {
      try {
        var cu = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
        return typeof window.isUserExpired === 'function' && cu && window.isUserExpired(cu);
      } catch (e) {
        return false;
      }
    }, []);

    var displayPlan = useMemo(function () {
      if (!lv().buildListDisplayPlan) {
        var all = [];
        for (var i = 0; i < items.length; i++) all.push(i);
        return { mode: 'all', indices: all, showExpandRow: false };
      }
      return lv().buildListDisplayPlan({
        arr: items,
        userIdx: userIdx,
        myRank1s: myRank1s,
        expanded: expanded,
        skipCollapse: skipCollapse,
        isExpired: isExpired
      });
    }, [items, userIdx, myRank1s, expanded, skipCollapse, isExpired]);

    var segments = useMemo(function () {
      var out = [];
      var indices = displayPlan.indices || [];
      var runs = displayPlan.runs;
      var limitedRuns = displayPlan.runsFromIndices;

      if (limitedRuns && indices.length) {
        var sorted = indices.slice().sort(function (a, b) { return a - b; });
        var rs = sorted[0];
        var re = sorted[0];
        for (var si = 1; si < sorted.length; si++) {
          if (sorted[si] === re + 1) re = sorted[si];
          else {
            out.push({ type: 'range', lo: rs, hi: re });
            rs = re = sorted[si];
          }
        }
        out.push({ type: 'range', lo: rs, hi: re });
        if (displayPlan.showExpandRow) {
          out.push({ type: 'expand', collapsed: displayPlan.expandCollapsed });
        }
        if (displayPlan.tailDots) out.push({ type: 'dots' });
        return out;
      }

      if (runs && runs.length && !expanded) {
        for (var r = 0; r < runs.length; r++) {
          if (r > 0) {
            var pLo = runs[r - 1][1] + 1;
            var pHi = runs[r][0] - 1;
            if (pLo <= pHi) out.push({ type: 'dots' });
          }
          out.push({ type: 'range', lo: runs[r][0], hi: runs[r][1] });
        }
        if (displayPlan.showExpandRow) {
          if (displayPlan.hasTail) out.push({ type: 'dots' });
          out.push({ type: 'expand', collapsed: true });
        }
        return out;
      }

      if (displayPlan.mode === 'top3' || (indices.length && !runs)) {
        var prev = -1;
        for (var ii = 0; ii < indices.length; ii++) {
          var idx = indices[ii];
          if (prev >= 0 && idx > prev + 1) out.push({ type: 'dots' });
          out.push({ type: 'row', index: idx });
          prev = idx;
        }
        if (displayPlan.showExpandRow) {
          if (displayPlan.tailDots) out.push({ type: 'dots' });
          out.push({ type: 'expand', collapsed: displayPlan.expandCollapsed });
        }
        return out;
      }

      if (displayPlan.mode === 'all') {
        for (var ai = 0; ai < items.length; ai++) {
          out.push({ type: 'row', index: ai });
        }
        return out;
      }

      return out;
    }, [displayPlan, items.length, expanded]);

    function renderRow(item, extraClass) {
      if (!Row || !item) return null;
      return React.createElement(Row, {
        key: (item.crewId || item.userId || '') + '-' + item.rank + '-' + socialVer + (showSegments ? '-seg' : '') + (extraClass || ''),
        item: item,
        tabId: tabId,
        currentUserId: currentUserId,
        viewerIdentity: viewerIdentity,
        myCrewIds: myCrewIds,
        listCategory: listCategory,
        showSegments: showSegments,
        socialVer: socialVer,
        extraRowClass: extraClass || ''
      });
    }

    var children = [];

    segments.forEach(function (seg, si) {
      if (seg.type === 'dots') {
        children.push(React.createElement(DotsRow, { key: 'dots-' + si }));
        return;
      }
      if (seg.type === 'expand') {
        children.push(React.createElement(ExpandGapRow, {
          key: 'expand-' + si,
          collapsed: seg.collapsed,
          limited: displayPlan.limitedExpand,
          onToggle: function (nextExpanded) {
            if (onExpandChange) onExpandChange(!!nextExpanded);
          }
        }));
        return;
      }
      if (seg.type === 'range') {
        for (var ri = seg.lo; ri <= seg.hi; ri++) {
          if (items[ri]) children.push(renderRow(items[ri]));
        }
        return;
      }
      if (seg.type === 'row' && items[seg.index]) {
        children.push(renderRow(items[seg.index]));
      }
    });

    if (userIdx < 0 && orphanViewerItem) {
      var inList = items.some(function (it) {
        if (tabId === 'crew') {
          return myCrewIds && it.crewId && myCrewIds.has(String(it.crewId)) &&
            String(it.crewId) === String(orphanViewerItem.crewId || '');
        }
        if (dataApi.listItemMatchesViewer && viewerIdentity) {
          return dataApi.listItemMatchesViewer(it, viewerIdentity) &&
            dataApi.listItemMatchesViewer(orphanViewerItem, viewerIdentity);
        }
        return String(it.userId || '') === String(orphanViewerItem.userId || '');
      });
      if (!inList) {
        if (children.length) children.push(React.createElement(DotsRow, { key: 'orphan-dots' }));
        children.push(renderRow(orphanViewerItem, ' stelvio-rank-my-supremo'));
      }
    }

    return React.createElement('div', {
      className: 'running-ranking-plain-list running-ranking-collapsible-list',
      role: 'list',
      'aria-label': '러닝 랭킹 목록'
    }, children);
  }

  window.RunningRankingCollapsibleList = RunningRankingCollapsibleList;
})();
