/**
 * RUN 랭킹 — CYCLE 랭킹보드 소셜 UI(아바타·친구·관심·등락·비공개) 브릿지
 */
(function () {
  'use strict';

  function callFn(name) {
    return typeof window[name] === 'function' ? window[name] : null;
  }

  function getRunningRoot() {
    return document.getElementById('running-ranking-react-root');
  }

  function bootstrapSocial(opts) {
    var boot = callFn('stelvioBootstrapRankingSocialSets');
    if (!boot) return Promise.resolve();
    return boot(Object.assign({ forceFirestore: true, subscribeGroups: true }, opts || {}));
  }

  function refreshStarSlots() {
    var root = getRunningRoot();
    var refresh = callFn('stelvioRankingRefreshListStarSlots');
    if (root && refresh) refresh(root);
  }

  function bindRunningRankingUiListeners() {
    var root = getRunningRoot();
    if (!root || root._runningRankUiBound) return;
    root._runningRankUiBound = true;

    var starHandler = callFn('stelvioRankingListBodyStarClickHandler');
    if (starHandler) {
      root.addEventListener('click', starHandler, true);
    }

    var avatarHandler = callFn('runningRankingAvatarZoomHandler');
    if (avatarHandler) {
      root.addEventListener('click', avatarHandler);
    }
  }

  function ensureUiListeners() {
    var ensure = callFn('stelvioEnsureRankingFavoriteUiListeners');
    if (ensure) ensure();
    bindRunningRankingUiListeners();
  }

  function resolveRawName(item) {
    if (!item) return '(이름 없음)';
    var resolve = callFn('stelvioRankingResolveRowRawName');
    if (resolve) {
      return resolve({
        name: item.name,
        displayName: item.name,
        actualName: item.name
      });
    }
    return item.name ? String(item.name).trim() : '(이름 없음)';
  }

  function canSeeFull(item, currentUserId) {
    if (!item || item.isCrew) return true;
    var uid = item.userId != null ? String(item.userId) : '';
    if (!uid) return false;
    if (currentUserId && uid === String(currentUserId)) return true;
    var canSee = callFn('stelvioRankingCanViewerSeeUserFull');
    if (canSee) return canSee(uid);
    if (callFn('stelvioRankingViewerCanSeePrivateNames') && window.stelvioRankingViewerCanSeePrivateNames()) {
      return true;
    }
    return !item.isPrivate;
  }

  function resolveDisplayName(item, currentUserId) {
    var raw = resolveRawName(item);
    if (item.isCrew) return item.name || '크루';
    var isPrivate = item.isPrivate;
    if (typeof isPrivate !== 'boolean') {
      var isPrivFn = callFn('stelvioRankingIsPrivateRow');
      isPrivate = isPrivFn ? isPrivFn({ is_private: item.isPrivate }) : !!item.isPrivate;
    }
    if (!isPrivate) return raw;
    if (canSeeFull(item, currentUserId)) return raw;
    var mask = callFn('stelvioRankingPrivateMaskedDisplayName');
    return mask ? mask(raw) : (raw.length >= 2 ? raw.charAt(0) + '**' : '**');
  }

  function getAvatarHtml(item, displayName, currentUserId) {
    if (item.isCrew) {
      var url = item.profileUrl || '';
      if (url) {
        return (
          '<span class="stelvio-rank-avatar" aria-hidden="true">' +
          '<img class="stelvio-rank-avatar-img" src="' + url.replace(/"/g, '&quot;') + '" alt="" width="30" height="30" decoding="async" loading="lazy" />' +
          '</span>'
        );
      }
      var initial = (displayName && displayName.charAt(0)) || '?';
      return '<span class="stelvio-rank-avatar stelvio-rank-avatar--placeholder" aria-hidden="true">' + initial + '</span>';
    }

    var avatarFn = callFn('stelvioRankingAvatarHtml');
    var profFn = callFn('stelvioRankingProfileImageUrlForDisplay');
    var profUrl = profFn
      ? profFn({ profileImageUrl: item.profileUrl })
      : (item.profileUrl || null);

    if (avatarFn) {
      return avatarFn(profUrl, {
        userId: item.userId,
        overlayName: displayName,
        ageCategory: item.ageCategory || ''
      }, { fastPaint: false });
    }

    if (profUrl) {
      return (
        '<button type="button" class="stelvio-rank-avatar-btn" data-stelvio-rank-zoom-src="' +
        String(profUrl).replace(/"/g, '&quot;') +
        '" title="프로필 사진 크게 보기" aria-label="프로필 사진 크게 보기">' +
        '<span class="stelvio-rank-avatar" aria-hidden="true">' +
        '<img class="stelvio-rank-avatar-img" src="' + String(profUrl).replace(/"/g, '&quot;') +
        '" alt="" width="30" height="30" decoding="async" loading="lazy" />' +
        '</span></button>'
      );
    }
    var ch = (displayName && displayName.charAt(0)) || '?';
    return '<span class="stelvio-rank-avatar stelvio-rank-avatar--placeholder" aria-hidden="true">' + ch + '</span>';
  }

  function getStarHtml(item) {
    if (!item || item.isCrew || !item.userId) return '';
    var starFn = callFn('stelvioRankingStarButtonHtml');
    return starFn ? starFn(String(item.userId)) : '';
  }

  function getRankChangeHtml(item, listCategoryKey) {
    if (!item || item.isCrew) return '';
    var cat = listCategoryKey || 'Supremo';
    var normalizeFn = callFn('stelvioNormalizeRankMovementOnRow');
    if (normalizeFn && item.rank != null) {
      normalizeFn(item, item.rank);
    }
    var badgeFn = callFn('stelvioServerRankChangeBadgeHtml');
    if (badgeFn && item.rankChange != null && item.previousBoardRank != null) {
      var directHtml = badgeFn(item.rankChange, item.previousBoardRank);
      if (directHtml) return directHtml;
    }
    var listItemFn = callFn('stelvioRankChangeBadgeHtmlForListItem');
    if (listItemFn) {
      return listItemFn(item, cat);
    }
    return badgeFn ? badgeFn(item.rankChange, item.previousBoardRank) : '';
  }

  function getPrivateBadgeHtml(item, currentUserId) {
    if (!item || item.isCrew || !item.isPrivate) return '';
    if (!canSeeFull(item, currentUserId)) return '';
    return '<span class="ranking-private-badge ranking-private-badge-admin" title="비공개">비</span>';
  }

  function resolveViewerUserId() {
    var fn = callFn('stelvioResolveRankingViewerUserId');
    if (fn) return fn();
    var u = window.currentUser;
    if (u && (u.id || u.uid)) return String(u.id || u.uid);
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return ls && (ls.id || ls.uid) ? String(ls.id || ls.uid) : '';
    } catch (e) {
      return '';
    }
  }

  /** CYCLE 랭킹보드 관심 필터와 동일: 관심·친구·그룹멤버·본인 */
  function filterRowsByListInterest(items, listFilter, currentUserId) {
    if (listFilter !== 'interest') return (items || []).slice();
    var myId = currentUserId ? String(currentUserId) : resolveViewerUserId();
    var favSet = window.stelvioRankingFavoriteUserSet;
    var friendSet = window.stelvioRankingFriendUserSet;
    var groupSet = window.stelvioRankingGroupContactSet;
    return (items || []).filter(function (item) {
      if (!item || !item.userId) return false;
      var uid = String(item.userId);
      if (myId && uid === myId) return true;
      if (favSet && typeof favSet.has === 'function' && favSet.has(uid)) return true;
      if (friendSet && typeof friendSet.has === 'function' && friendSet.has(uid)) return true;
      if (groupSet && typeof groupSet.has === 'function' && groupSet.has(uid)) return true;
      return false;
    });
  }

  function bindStarChangeListener(onChange) {
    var root = getRunningRoot();
    if (!root || root._runningRankStarChangeBound) return;
    root._runningRankStarChangeBound = true;
    var closest = callFn('stelvioClosestRankStarButton');
    root.addEventListener('click', function (ev) {
      var btn = closest ? closest(ev.target) : null;
      if (!btn) return;
      if (typeof onChange === 'function') {
        setTimeout(onChange, 0);
        setTimeout(onChange, 120);
      }
    }, true);
  }

  window.runningRankingSocial = {
    bootstrapSocial: bootstrapSocial,
    ensureUiListeners: ensureUiListeners,
    refreshStarSlots: refreshStarSlots,
    bindStarChangeListener: bindStarChangeListener,
    filterRowsByListInterest: filterRowsByListInterest,
    resolveDisplayName: resolveDisplayName,
    resolveRawName: resolveRawName,
    getAvatarHtml: getAvatarHtml,
    getStarHtml: getStarHtml,
    getRankChangeHtml: getRankChangeHtml,
    getPrivateBadgeHtml: getPrivateBadgeHtml,
    canSeeFull: canSeeFull
  };
})();
