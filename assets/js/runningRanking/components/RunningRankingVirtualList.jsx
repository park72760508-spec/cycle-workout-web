/**
 * FlatList 유사 가상 스크롤 리스트 (고정 행 높이 + overscan)
 */
/* global React, useState, useEffect, useRef, useMemo, useCallback */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;

  var OVERSCAN = 6;

  function RunningRankingVirtualList(props) {
    var items = props.items || [];
    var rowHeight = props.rowHeight || 56;
    var tabId = props.tabId;
    var currentUserId = props.currentUserId;
    var emptyMessage = props.emptyMessage || '랭킹 데이터가 없습니다.';
    var Row = window.RunningRankingRow;

    var containerRef = useRef(null);
    var _scroll = useState(0);
    var scrollTop = _scroll[0];
    var setScrollTop = _scroll[1];
    var _vh = useState(400);
    var viewportH = _vh[0];
    var setViewportH = _vh[1];

    var onScroll = useCallback(function (e) {
      setScrollTop(e.target.scrollTop || 0);
    }, []);

    useEffect(function () {
      var el = containerRef.current;
      if (!el) return;
      function measure() {
        setViewportH(el.clientHeight || 400);
      }
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(measure);
        ro.observe(el);
        return function () { ro.disconnect(); };
      }
      window.addEventListener('resize', measure);
      return function () { window.removeEventListener('resize', measure); };
    }, []);

    useEffect(function () {
      var el = containerRef.current;
      if (el) el.scrollTop = 0;
      setScrollTop(0);
    }, [tabId, props.listKey]);

    var layout = useMemo(function () {
      var total = items.length;
      var totalH = total * rowHeight;
      var start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
      var visibleCount = Math.ceil(viewportH / rowHeight) + OVERSCAN * 2;
      var end = Math.min(total, start + visibleCount);
      return { totalH: totalH, start: start, end: end };
    }, [items.length, rowHeight, scrollTop, viewportH]);

    if (!items.length) {
      return React.createElement('p', { className: 'stelvio-ranking-empty' }, emptyMessage);
    }

    var slice = items.slice(layout.start, layout.end);
    var offsetY = layout.start * rowHeight;

    return React.createElement('div', {
      ref: containerRef,
      className: 'running-ranking-virtual-list',
      onScroll: onScroll,
      role: 'list',
      'aria-label': '러닝 랭킹 목록'
    },
      React.createElement('div', {
        className: 'running-ranking-virtual-spacer',
        style: { height: layout.totalH + 'px', position: 'relative' }
      },
        React.createElement('div', {
          className: 'running-ranking-virtual-window',
          style: { transform: 'translateY(' + offsetY + 'px)' }
        },
          slice.map(function (item) {
            return Row
              ? React.createElement(Row, {
                  key: (item.crewId || item.userId || '') + '-' + item.rank,
                  item: item,
                  tabId: tabId,
                  currentUserId: currentUserId
                })
              : null;
          })
        )
      )
    );
  }

  window.RunningRankingVirtualList = RunningRankingVirtualList;
})();
