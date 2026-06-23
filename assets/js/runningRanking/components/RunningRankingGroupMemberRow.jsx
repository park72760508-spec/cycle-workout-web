/**
 * RUN 크루 탭 멤버 행 — CYCLE 클럽 탭 stelvio-group-member-row 와 동일 DOM·클래스
 */
/* global React */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var cfg = function () { return window.runningRankingConfig || {}; };
  var soc = function () { return window.runningRankingSocial || {}; };
  var zoneColors = function () { return window.runDistanceZoneColors || {}; };

  function htmlSpan(key, className, html) {
    if (!html) return null;
    return React.createElement('span', {
      key: key,
      className: className,
      dangerouslySetInnerHTML: { __html: html }
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function medalImg(rank) {
    if (rank < 1 || rank > 3) return null;
    var src = (cfg().MEDAL_SRC || [])[rank - 1];
    if (!src) return null;
    return React.createElement('img', {
      src: src,
      alt: rank + '위',
      width: 24,
      height: 24,
      decoding: 'async',
      fetchPriority: 'low'
    });
  }

  function RunningRankingGroupMemberRow(props) {
    var item = props.item;
    var tabId = props.tabId;
    var currentUserId = props.currentUserId;
    var viewerIdentity = props.viewerIdentity;
    var listCategory = props.listCategory || 'Supremo';
    var rankMetaHtml = props.rankMetaHtml || '';
    var groupRole = props.groupRole;
    if (!item) return null;

    var s = soc();
    var rawName = s.resolveRawName ? s.resolveRawName(item) : (item.name || '');
    var displayName = s.resolveDisplayName ? s.resolveDisplayName(item, currentUserId) : (item.name || '');
    var avatarHtml = s.getAvatarHtml ? s.getAvatarHtml(item, displayName, currentUserId) : '';
    var starHtml = '';
    if (s.getStarHtml) {
      starHtml = s.getStarHtml(item);
    }
    var starFn = typeof window.stelvioRankingStarButtonHtml === 'function'
      ? window.stelvioRankingStarButtonHtml
      : null;
    if (starFn && item.userId != null) {
      var su = s.socialUserId ? s.socialUserId(item) : String(item.userId);
      var bu = item.userId != null ? String(item.userId) : '';
      var starOpts = { omitGroupMember: true };
      if (su && bu && su !== bu) starOpts.altUid = bu;
      starHtml = starFn(su || bu, starOpts);
    }
    var privateBadgeHtml = s.getPrivateBadgeHtml ? s.getPrivateBadgeHtml(item, currentUserId) : '';

    var listRank = Math.floor(Number(item._crewRank));
    if (!isFinite(listRank) || listRank < 1) listRank = 0;

    var isCurrent = !!(
      s.isViewerListItem
        ? s.isViewerListItem(item, viewerIdentity || currentUserId)
        : (currentUserId && item.userId && String(item.userId) === String(currentUserId))
    );

    var isSingleLineRow = !(tabId === 'overall' && props.showSegments);
    var rowClass =
      'stelvio-rank-row stelvio-rank-row--group-member stelvio-group-member-row running-ranking-row' +
      (isCurrent ? ' stelvio-rank-current' : '') +
      (isSingleLineRow ? ' running-ranking-row--compact' : '');

    var crownChild = listRank >= 1 && listRank <= 3 && medalImg(listRank)
      ? React.createElement('span', { key: 'crown', className: 'stelvio-rank-crown' }, medalImg(listRank))
      : React.createElement('span', {
          key: 'crown-ph',
          className: 'stelvio-rank-crown stelvio-rank-crown--placeholder',
          'aria-hidden': true
        });

    var nameChildren = [
      htmlSpan('avatar', null, avatarHtml),
      rankMetaHtml
        ? React.createElement('span', {
            key: 'name-text',
            className: 'stelvio-rank-name-text',
            title: rawName,
            dangerouslySetInnerHTML: { __html: escapeHtml(displayName) + rankMetaHtml }
          })
        : React.createElement('span', {
            key: 'name-text',
            className: 'stelvio-rank-name-text',
            title: rawName
          }, displayName),
      htmlSpan('star', 'stelvio-rank-star-slot', starHtml),
      htmlSpan('private', null, privateBadgeHtml),
      groupRole === 'owner'
        ? React.createElement('span', {
            key: 'owner',
            className: 'stelvio-rank-owner-badge',
            title: '방장'
          }, '방장')
        : null
    ].filter(Boolean);

    var socialUid = s.socialUserId ? s.socialUserId(item) : (item.userId || '');
    var boardUid = item.userId != null ? String(item.userId) : '';

    var children = [
      React.createElement('span', { key: 'ranklead', className: 'stelvio-rank-ranklead' },
        crownChild,
        React.createElement('span', { className: 'stelvio-rank-pos' }, listRank > 0 ? (listRank + '위') : '—')
      ),
      React.createElement('span', { key: 'name', className: 'stelvio-rank-name' }, nameChildren),
      React.createElement('span', { key: 'val', className: 'stelvio-rank-wkg running-ranking-value' }, item.valueLabel || '—')
    ];

    if (tabId === 'overall' && props.showSegments && Array.isArray(item.segments) && item.segments.length) {
      children.push(
        React.createElement('div', {
          key: 'seg',
          className: 'running-ranking-segments',
          role: 'group',
          'aria-label': '거리별 페이스'
        },
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
      'data-stelvio-member-uid': boardUid || undefined,
      'data-social-uid': socialUid || undefined,
      'data-board-uid': boardUid || undefined,
      'data-viewer-current': isCurrent ? '1' : undefined
    }, children);
  }

  window.RunningRankingGroupMemberRow = RunningRankingGroupMemberRow;
})();
