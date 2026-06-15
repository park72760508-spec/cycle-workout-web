/* global React */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var cfg = function () { return window.runningRankingConfig || {}; };
  var social = function () { return window.runningRankingSocial || {}; };
  var zoneColors = function () { return window.runDistanceZoneColors || {}; };

  function medalHtml(rank) {
    if (rank < 1 || rank > 3) return null;
    var src = (cfg().MEDAL_SRC || [])[rank - 1];
    if (!src) return null;
    return React.createElement('img', {
      src: src,
      alt: rank + '위',
      className: 'stelvio-rank-crown-img',
      width: 18,
      height: 18,
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
    var viewerIdentity = props.viewerIdentity || null;
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
    var valueLabel = soc.formatValueLabel
      ? soc.formatValueLabel(item)
      : (item.valueLabel || '—');
    var socialUid = soc.socialUserId ? soc.socialUserId(item) : (item.userId || '');

    var isCrewCurrent = !!(
      item.isCrew &&
      props.myCrewIds &&
      item.crewId &&
      props.myCrewIds.has(String(item.crewId))
    );
    var isCurrent = isCrewCurrent || !!(
      soc.isViewerListItem
        ? soc.isViewerListItem(item, viewerIdentity || currentUserId)
        : (
          currentUserId &&
          item.userId &&
          String(item.userId) === String(currentUserId)
        )
    );
    var isSingleLineRow = !(tabId === 'overall' && props.showSegments);
    var rowClass = 'stelvio-rank-row running-ranking-row' +
      (isCurrent ? ' stelvio-rank-current' : '') +
      (props.extraRowClass || '') +
      (item.isCrew ? ' running-ranking-row--crew' : '') +
      (isSingleLineRow ? ' running-ranking-row--compact' : '');

    var valueClass = 'stelvio-rank-wkg running-ranking-value' +
      (tabId === 'pace' ? ' running-ranking-value--pace' : '');

    var rank = Math.floor(Number(item.rank));
    if (!isFinite(rank) || rank < 1) rank = 0;

    var crownChild = medalHtml(rank)
      ? React.createElement('span', { key: 'crown', className: 'stelvio-rank-crown' }, medalHtml(rank))
      : React.createElement('span', {
          key: 'crown-ph',
          className: 'stelvio-rank-crown stelvio-rank-crown--placeholder',
          'aria-hidden': true
        });

    var rankLead = React.createElement(
      'span',
      { key: 'ranklead', className: 'stelvio-rank-ranklead' },
      crownChild,
      React.createElement('span', { key: 'pos', className: 'stelvio-rank-pos' }, (rank > 0 ? rank : item.rank) + '위')
    );

    var nameChildren = [
      htmlSpan('avatar-' + socialVer, 'stelvio-rank-avatar-slot', avatarHtml),
      React.createElement('span', {
        key: 'name-text',
        className: 'stelvio-rank-name-text',
        title: rawName
      }, displayName),
      htmlSpan('rank-change-' + socialVer, 'stelvio-rank-change-slot', rankChangeHtml),
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
      rankLead,
      React.createElement('span', { key: 'name', className: 'stelvio-rank-name' }, nameChildren),
      React.createElement('span', { key: 'val', className: valueClass }, valueLabel)
    ];

    if (tabId === 'overall' && props.showSegments && Array.isArray(item.segments) && item.segments.length) {
      children.push(
        React.createElement('div', { key: 'seg', className: 'running-ranking-segments', role: 'group', 'aria-label': '거리별 페이스' },
          item.segments.map(function (seg) {
            var paceLabel = seg.pace && String(seg.pace).trim() ? String(seg.pace).trim() : '—';
            var hasPace = paceLabel !== '—' && paceLabel !== '-' && paceLabel.toLowerCase() !== 'null';
            var zc = zoneColors();
            var titlePrefix = zc.segmentTitlePrefix
              ? zc.segmentTitlePrefix(seg.key)
              : seg.label;
            var titleParts = [titlePrefix + ' · 페이스 ' + paceLabel];
            if (seg.score != null) titleParts.push('순위점수 ' + seg.score + 'pt');
            var chipClass = (zc.segmentChipClass
              ? zc.segmentChipClass(seg.key)
              : ('running-ranking-segment-chip running-ranking-segment-chip--' + seg.key)) +
              (hasPace ? '' : ' running-ranking-segment-chip--empty');
            return React.createElement('span', {
              key: seg.key,
              className: chipClass,
              title: titleParts.join(' · ')
            },
              React.createElement('span', { className: 'running-ranking-segment-dist' }, seg.label),
              React.createElement('span', { className: 'running-ranking-segment-pace' }, paceLabel)
            );
          })
        )
      );
    }

    return React.createElement('div', {
      className: rowClass,
      'data-rank': item.rank,
      'data-social-uid': socialUid || undefined,
      'data-board-uid': item.userId || undefined,
      'data-viewer-current': isCurrent ? '1' : undefined
    }, children);
  }

  window.RunningRankingRow = RunningRankingRow;
})();
