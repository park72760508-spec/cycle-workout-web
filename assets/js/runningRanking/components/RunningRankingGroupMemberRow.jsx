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

    var rowClass =
      'stelvio-rank-row stelvio-rank-row--group-member stelvio-group-member-row' +
      (isCurrent ? ' stelvio-rank-current' : '');

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

    return React.createElement('div', {
      className: rowClass,
      'data-stelvio-member-uid': boardUid || undefined,
      'data-social-uid': socialUid || undefined,
      'data-board-uid': boardUid || undefined,
      'data-viewer-current': isCurrent ? '1' : undefined
    },
      React.createElement('span', { className: 'stelvio-rank-ranklead' },
        crownChild,
        React.createElement('span', { className: 'stelvio-rank-pos' }, listRank > 0 ? (listRank + '위') : '—')
      ),
      React.createElement('span', { className: 'stelvio-rank-name' }, nameChildren),
      React.createElement('span', { className: 'stelvio-rank-wkg' }, item.valueLabel || '—')
    );
  }

  window.RunningRankingGroupMemberRow = RunningRankingGroupMemberRow;
})();
