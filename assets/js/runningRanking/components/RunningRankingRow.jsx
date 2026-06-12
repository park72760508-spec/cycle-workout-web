/* global React */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var cfg = function () { return window.runningRankingConfig || {}; };
  var social = function () { return window.runningRankingSocial || {}; };

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

  function htmlSpan(key, className, html) {
    if (!html) return null;
    return React.createElement('span', {
      key: key,
      className: className,
      dangerouslySetInnerHTML: { __html: html }
    });
  }

  function RunningRankingRow(props) {
    var item = props.item;
    var currentUserId = props.currentUserId;
    var tabId = props.tabId;
    var socialVer = props.socialVer;
    if (!item) return null;

    var soc = social();
    var rawName = soc.resolveRawName ? soc.resolveRawName(item) : (item.name || '');
    var displayName = soc.resolveDisplayName ? soc.resolveDisplayName(item, currentUserId) : (item.name || '');
    var avatarHtml = soc.getAvatarHtml ? soc.getAvatarHtml(item, displayName, currentUserId) : '';
    var starHtml = soc.getStarHtml ? soc.getStarHtml(item) : '';
    var rankChangeHtml = soc.getRankChangeHtml
      ? soc.getRankChangeHtml(item, props.listCategory || 'Supremo')
      : '';
    var privateBadgeHtml = soc.getPrivateBadgeHtml ? soc.getPrivateBadgeHtml(item, currentUserId) : '';

    var isCurrent = !!(currentUserId && item.userId && String(item.userId) === String(currentUserId));
    var rowClass = 'stelvio-rank-row running-ranking-row' +
      (isCurrent ? ' stelvio-rank-current' : '') +
      (item.isCrew ? ' running-ranking-row--crew' : '') +
      (tabId === 'overall' && !props.showSegments ? ' running-ranking-row--compact' : '');

    var valueClass = 'stelvio-rank-wkg running-ranking-value' +
      (tabId === 'pace' ? ' running-ranking-value--pace' : '');

    var nameChildren = [
      htmlSpan('avatar-' + socialVer, 'stelvio-rank-avatar-slot', avatarHtml),
      React.createElement('span', {
        key: 'name-text',
        className: 'stelvio-rank-name-text',
        title: rawName
      }, displayName),
      htmlSpan('rank-change-' + socialVer, null, rankChangeHtml),
      htmlSpan('star-' + socialVer, 'stelvio-rank-star-slot', starHtml),
      htmlSpan('private-' + socialVer, null, privateBadgeHtml)
    ].filter(Boolean);

    if (item.isCrew && item.scoredCount != null) {
      nameChildren.push(
        React.createElement('span', { key: 'crew-meta', className: 'running-ranking-crew-meta' },
          ' · ' + item.scoredCount + '명'
        )
      );
    }

    var children = [
      React.createElement('span', { key: 'crown', className: 'stelvio-rank-crown' }, medalHtml(item.rank)),
      React.createElement('span', { key: 'pos', className: 'stelvio-rank-pos' }, item.rank + '위'),
      React.createElement('span', { key: 'name', className: 'stelvio-rank-name' }, nameChildren),
      React.createElement('span', { key: 'val', className: valueClass }, item.valueLabel)
    ];

    if (tabId === 'overall' && props.showSegments && Array.isArray(item.segments) && item.segments.length) {
      children.push(
        React.createElement('div', { key: 'seg', className: 'running-ranking-segments' },
          item.segments.map(function (seg) {
            var paceLabel = seg.pace && seg.pace !== '—' ? seg.pace : '—';
            var titleParts = [seg.label + ' 페이스 ' + paceLabel];
            if (seg.score != null) titleParts.push('순위점수 ' + seg.score + 'pt');
            return React.createElement('span', {
              key: seg.key,
              className: 'running-ranking-segment-chip',
              title: titleParts.join(' · ')
            },
              React.createElement('span', { className: 'running-ranking-segment-label' }, seg.label),
              React.createElement('span', { className: 'running-ranking-segment-score running-ranking-segment-pace' },
                paceLabel
              )
            );
          })
        )
      );
    }

    return React.createElement('div', { className: rowClass, 'data-rank': item.rank }, children);
  }

  window.RunningRankingRow = RunningRankingRow;
})();
