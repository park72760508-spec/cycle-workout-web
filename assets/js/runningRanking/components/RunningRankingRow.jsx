/* global React */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var cfg = function () { return window.runningRankingConfig || {}; };

  function medalHtml(rank) {
    if (rank < 1 || rank > 3) return null;
    var src = (cfg().MEDAL_SRC || [])[rank - 1];
    if (!src) return null;
    return React.createElement('img', {
      src: src,
      alt: rank + '위',
      className: 'stelvio-rank-crown-img',
      width: 28,
      height: 28,
      decoding: 'async'
    });
  }

  function avatarEl(url, name) {
    if (url) {
      return React.createElement('img', {
        src: url,
        alt: '',
        className: 'stelvio-rank-avatar',
        width: 32,
        height: 32,
        decoding: 'async',
        loading: 'lazy'
      });
    }
    var initial = (name && name.charAt(0)) || '?';
    return React.createElement('span', { className: 'stelvio-rank-avatar stelvio-rank-avatar--placeholder', 'aria-hidden': true }, initial);
  }

  function RunningRankingRow(props) {
    var item = props.item;
    var currentUserId = props.currentUserId;
    var tabId = props.tabId;
    if (!item) return null;

    var isCurrent = !!(currentUserId && item.userId && String(item.userId) === String(currentUserId));
    var rowClass = 'stelvio-rank-row running-ranking-row' +
      (isCurrent ? ' stelvio-rank-current' : '') +
      (item.isCrew ? ' running-ranking-row--crew' : '');

    var valueClass = 'stelvio-rank-wkg running-ranking-value' +
      (tabId === 'pace' ? ' running-ranking-value--pace' : '');

    var children = [
      React.createElement('span', { key: 'crown', className: 'stelvio-rank-crown' }, medalHtml(item.rank)),
      React.createElement('span', { key: 'pos', className: 'stelvio-rank-pos' }, item.rank + '위'),
      React.createElement('span', { key: 'name', className: 'stelvio-rank-name' },
        avatarEl(item.profileUrl, item.name),
        React.createElement('span', { className: 'stelvio-rank-name-text', title: item.name }, item.name),
        item.isCrew && item.scoredCount != null
          ? React.createElement('span', { className: 'running-ranking-crew-meta' }, ' · ' + item.scoredCount + '명')
          : null
      ),
      React.createElement('span', { key: 'val', className: valueClass }, item.valueLabel)
    ];

    if (tabId === 'overall' && Array.isArray(item.segments) && item.segments.length) {
      children.push(
        React.createElement('div', { key: 'seg', className: 'running-ranking-segments' },
          item.segments.map(function (seg) {
            return React.createElement('span', { key: seg.key, className: 'running-ranking-segment-chip', title: seg.label + ' 페이스 ' + seg.pace },
              React.createElement('span', { className: 'running-ranking-segment-label' }, seg.label),
              React.createElement('span', { className: 'running-ranking-segment-score' }, seg.score != null ? seg.score : '—')
            );
          })
        )
      );
    }

    return React.createElement('div', { className: rowClass, 'data-rank': item.rank }, children);
  }

  window.RunningRankingRow = RunningRankingRow;
})();
