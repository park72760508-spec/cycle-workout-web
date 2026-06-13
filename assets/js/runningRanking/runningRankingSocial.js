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

  function rowFirebaseUid(row) {
    var ui = row && row.user_info;
    var fb = ui && (ui.firebase_uid != null ? ui.firebase_uid : ui.firebaseUid);
    return fb != null && String(fb).trim() ? String(fb).trim() : '';
  }

  function socialUserId(item) {
    if (!item) return '';
    if (item.socialUserId) return String(item.socialUserId);
    if (item.firebaseUid) return String(item.firebaseUid);
    if (item.userId != null) return String(item.userId);
    return '';
  }

  function toSocialRow(item) {
    if (!item) return null;
    var sid = socialUserId(item);
    return {
      userId: sid,
      is_private: item.isPrivate,
      name: item.name,
      displayName: item.name,
      actualName: item.name,
      actual_name: item.name,
      profileImageUrl: item.profileUrl
    };
  }

  function isPrivateItem(item) {
    if (!item) return false;
    var fn = callFn('stelvioRankingIsPrivateRow');
    if (fn) return fn(toSocialRow(item));
    return !!item.isPrivate;
  }

  function bootstrapSocial(opts) {
    var boot = callFn('stelvioBootstrapRankingSocialSets');
    if (!boot) return Promise.resolve();
    return boot(Object.assign({ forceFirestore: true, subscribeGroups: true }, opts || {}));
  }

  function starButtonOptsForRow(socialUid, boardUid) {
    var opts = {};
    if (socialUid && boardUid && socialUid !== boardUid) opts.altUid = boardUid;
    return opts;
  }

  function updateRowStarSlot(rowEl, starHtml) {
    if (!rowEl) return;
    var slot = rowEl.querySelector('.stelvio-rank-star-slot');
    if (slot) {
      slot.innerHTML = starHtml || '';
      return;
    }
    var nameWrap = rowEl.querySelector('.stelvio-rank-name');
    if (!nameWrap || !starHtml) return;
    var oldStars = nameWrap.querySelectorAll('.stelvio-rank-stars-wrap');
    var oi;
    for (oi = 0; oi < oldStars.length; oi++) {
      if (oldStars[oi].parentNode) oldStars[oi].parentNode.removeChild(oldStars[oi]);
    }
    var insertBefore =
      nameWrap.querySelector('.ranking-private-badge') ||
      nameWrap.querySelector('.stelvio-rank-owner-badge');
    var holder = document.createElement('span');
    holder.innerHTML = starHtml;
    while (holder.firstChild) {
      if (insertBefore) nameWrap.insertBefore(holder.firstChild, insertBefore);
      else nameWrap.appendChild(holder.firstChild);
    }
  }

  function refreshStarSlots() {
    var root = getRunningRoot();
    if (!root) return;
    var starFn = callFn('stelvioRankingStarButtonHtml');
    if (!starFn) return;

    var rows = root.querySelectorAll('.running-ranking-row[data-social-uid], .running-ranking-row[data-board-uid]');
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var rowEl = rows[ri];
      var socialUid = rowEl.getAttribute('data-social-uid') || '';
      var boardUid = rowEl.getAttribute('data-board-uid') || '';
      var primaryUid = socialUid || boardUid;
      if (!primaryUid) continue;
      updateRowStarSlot(
        rowEl,
        starFn(primaryUid, starButtonOptsForRow(socialUid, boardUid))
      );
    }

    var refresh = callFn('stelvioRankingRefreshListStarSlots');
    if (refresh) refresh(root);
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
      return resolve(toSocialRow(item));
    }
    return item.name ? String(item.name).trim() : '(이름 없음)';
  }

  function canSeeFull(item, currentUserId) {
    if (!item || item.isCrew) return true;
    var sid = socialUserId(item);
    var boardUid = item.userId != null ? String(item.userId) : '';
    if (!sid && !boardUid) return false;
    if (currentUserId) {
      if (sid && sid === String(currentUserId)) return true;
      if (boardUid && boardUid === String(currentUserId)) return true;
    }
    var canSee = callFn('stelvioRankingCanViewerSeeUserFull');
    if (canSee) {
      if (sid && canSee(sid)) return true;
      if (boardUid && boardUid !== sid && canSee(boardUid)) return true;
    }
    if (callFn('stelvioRankingViewerCanSeePrivateNames') && window.stelvioRankingViewerCanSeePrivateNames()) {
      return true;
    }
    return !isPrivateItem(item);
  }

  function resolveDisplayName(item, currentUserId) {
    var raw = resolveRawName(item);
    if (item.isCrew) return item.name || '크루';
    if (!isPrivateItem(item)) return raw;
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
      ? profFn(toSocialRow(item))
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
        '" data-stelvio-rank-user-id="' + String(item.userId || '').replace(/"/g, '&quot;') +
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
    if (!item || item.isCrew) return '';
    var socialUid = socialUserId(item);
    var boardUid = item.userId != null ? String(item.userId) : '';
    if (!socialUid && !boardUid) return '';
    var starFn = callFn('stelvioRankingStarButtonHtml');
    if (!starFn) return '';
    return starFn(
      socialUid || boardUid,
      starButtonOptsForRow(socialUid, boardUid)
    );
  }

  function getRankChangeHtml(item, listCategoryKey) {
    if (!item || item.isCrew) return '';
    var boardRank = item.boardRank != null && isFinite(Number(item.boardRank))
      ? Math.floor(Number(item.boardRank))
      : (item.rank != null && isFinite(Number(item.rank)) ? Math.floor(Number(item.rank)) : null);
    var matchesFn = callFn('stelvioRankMovementRowMatchesCurrentRank');
    if (matchesFn && boardRank != null && boardRank >= 1) {
      if (!matchesFn(item, boardRank)) return '';
    }
    var badgeFn = callFn('stelvioServerRankChangeBadgeHtml');
    if (badgeFn && item.rankChange != null && item.previousBoardRank != null) {
      var directHtml = badgeFn(item.rankChange, item.previousBoardRank);
      if (directHtml) return directHtml;
    }
    return '';
  }

  function getPrivateBadgeHtml(item, currentUserId) {
    if (!item || item.isCrew || !isPrivateItem(item)) return '';
    if (!canSeeFull(item, currentUserId)) return '';
    return '<span class="ranking-private-badge ranking-private-badge-admin" title="비공개">비</span>';
  }

  function formatValueLabel(item) {
    if (!item) return '—';
    return item.valueLabel != null ? String(item.valueLabel) : '—';
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

  function filterRowsByListInterest(items, listFilter, currentUserId) {
    if (listFilter !== 'interest') return (items || []).slice();
    var myId = currentUserId ? String(currentUserId) : resolveViewerUserId();
    var favSet = window.stelvioRankingFavoriteUserSet;
    var friendSet = window.stelvioRankingFriendUserSet;
    var groupSet = window.stelvioRankingGroupContactSet;
    return (items || []).filter(function (item) {
      if (!item || !item.userId) return false;
      var sid = socialUserId(item);
      var boardUid = String(item.userId);
      if (myId && (sid === myId || boardUid === myId)) return true;
      if (favSet && typeof favSet.has === 'function') {
        if (sid && favSet.has(sid)) return true;
        if (favSet.has(boardUid)) return true;
      }
      if (friendSet && typeof friendSet.has === 'function') {
        if (sid && friendSet.has(sid)) return true;
        if (friendSet.has(boardUid)) return true;
      }
      if (groupSet && typeof groupSet.has === 'function') {
        if (sid && groupSet.has(sid)) return true;
        if (groupSet.has(boardUid)) return true;
      }
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

  function hookSocialStarUiRefresh(onChange) {
    var orig = callFn('stelvioRankingApplySocialStarUi');
    if (!orig || window._runningRankSocialStarHooked) {
      return;
    }
    window._runningRankSocialStarHooked = true;
    window.stelvioRankingApplySocialStarUi = function () {
      orig();
      refreshStarSlots();
      if (typeof onChange === 'function') onChange();
    };
  }

  window.runningRankingSocial = {
    bootstrapSocial: bootstrapSocial,
    ensureUiListeners: ensureUiListeners,
    refreshStarSlots: refreshStarSlots,
    hookSocialStarUiRefresh: hookSocialStarUiRefresh,
    bindStarChangeListener: bindStarChangeListener,
    filterRowsByListInterest: filterRowsByListInterest,
    resolveDisplayName: resolveDisplayName,
    resolveRawName: resolveRawName,
    getAvatarHtml: getAvatarHtml,
    getStarHtml: getStarHtml,
    getRankChangeHtml: getRankChangeHtml,
    getPrivateBadgeHtml: getPrivateBadgeHtml,
    formatValueLabel: formatValueLabel,
    canSeeFull: canSeeFull,
    socialUserId: socialUserId,
    rowFirebaseUid: rowFirebaseUid
  };
})();
