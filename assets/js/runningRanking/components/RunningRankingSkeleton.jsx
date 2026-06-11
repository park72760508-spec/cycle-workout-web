/* global React */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;

  function RunningRankingSkeleton(props) {
    var count = props.count || 8;
    var items = [];
    for (var i = 0; i < count; i++) {
      items.push(
        React.createElement('div', { key: 'sk-' + i, className: 'running-ranking-skeleton-row', 'aria-hidden': true },
          React.createElement('span', { className: 'running-ranking-skeleton-block running-ranking-skeleton-pos' }),
          React.createElement('span', { className: 'running-ranking-skeleton-block running-ranking-skeleton-avatar' }),
          React.createElement('span', { className: 'running-ranking-skeleton-block running-ranking-skeleton-name' }),
          React.createElement('span', { className: 'running-ranking-skeleton-block running-ranking-skeleton-value' })
        )
      );
    }
    return React.createElement('div', { className: 'running-ranking-skeleton', role: 'status', 'aria-label': '랭킹 불러오는 중' },
      React.createElement('div', { className: 'stelvio-ranking-spinner' }),
      React.createElement('p', { className: 'running-ranking-loading-text' }, props.message || '러닝 랭킹 불러오는 중...'),
      items
    );
  }

  window.RunningRankingSkeleton = RunningRankingSkeleton;
})();
