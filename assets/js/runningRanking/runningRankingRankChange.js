/**
 * RUN 랭킹 — CYCLE stelvioRankChangeBadgeHtmlForListItem · stelvioRankingRefreshListRankChangeSlots 동형
 */
(function (global) {
  'use strict';

  function callFn(name) {
    return typeof global[name] === 'function' ? global[name] : null;
  }

  function itemLookupIds(item) {
    var ids = [];
    if (!item) return ids;
    if (item.userId != null && String(item.userId).trim()) ids.push(String(item.userId).trim());
    if (item.socialUserId != null && String(item.socialUserId).trim()) {
      ids.push(String(item.socialUserId).trim());
    }
    if (item.firebaseUid != null && String(item.firebaseUid).trim()) {
      ids.push(String(item.firebaseUid).trim());
    }
    return ids;
  }

  function listCategoryRankForItem(item) {
    if (!item) return null;
    if (item.boardRank != null && isFinite(Number(item.boardRank))) {
      return Math.floor(Number(item.boardRank));
    }
    if (item.rank != null && isFinite(Number(item.rank))) {
      return Math.floor(Number(item.rank));
    }
    return null;
  }

  /**
   * CYCLE stelvioRankChangeBadgeHtmlForListItem — normalize 후 badge HTML
   */
  function badgeHtmlForListItem(item, listCategoryKey) {
    if (!item || item.isCrew) return '';
    var listCatRank = listCategoryRankForItem(item);
    var normalizeFn = callFn('stelvioNormalizeRankMovementOnRow');
    if (normalizeFn) normalizeFn(item, listCatRank);

    var badgeFn = callFn('stelvioServerRankChangeBadgeHtml');
    if (!badgeFn) return '';

    if (item.rankChange != null && item.previousBoardRank != null) {
      var matchesFn = callFn('stelvioRankMovementRowMatchesCurrentRank');
      if (listCatRank == null || !matchesFn || matchesFn(item, listCatRank)) {
        var html = badgeFn(item.rankChange, item.previousBoardRank);
        if (html) return html;
      }
    }
    return '';
  }

  function suffixForListItem(item, listCategoryKey) {
    var html = badgeHtmlForListItem(item, listCategoryKey);
    if (!html) return null;
    var rcN = Number(item.rankChange);
    var prevN = Math.floor(Number(item.previousBoardRank));
    if (!isFinite(rcN) || !isFinite(prevN) || prevN < 1) return null;
    if (rcN > 0) {
      return { text: '(↑' + rcN + ')', kind: 'up', title: '전날 ' + prevN + '위', html: html };
    }
    if (rcN < 0) {
      return { text: '(↓' + Math.abs(rcN) + ')', kind: 'down', title: '전날 ' + prevN + '위', html: html };
    }
    return { text: '(-)', kind: 'flat', title: '전날 ' + prevN + '위', html: html };
  }

  function buildRowLookup(rankedList) {
    var rowByUid = {};
    (rankedList || []).forEach(function (item) {
      if (!item) return;
      itemLookupIds(item).forEach(function (id) {
        rowByUid[id] = item;
      });
    });
    return rowByUid;
  }

  function removeRankChangeNodes(nameWrap) {
    if (!nameWrap) return;
    var nodes = nameWrap.querySelectorAll('.stelvio-rank-change, .stelvio-rank-change-slot');
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      if (node.parentNode === nameWrap) node.parentNode.removeChild(node);
    }
  }

  function insertRankChangeAfterName(nameWrap, rcHtml) {
    if (!nameWrap || !rcHtml) return;
    var nameText = nameWrap.querySelector('.stelvio-rank-name-text');
    var insertBefore = null;
    if (nameText) {
      var sib = nameText.nextSibling;
      while (sib) {
        if (
          sib.nodeType === 1 &&
          sib.classList &&
          (sib.classList.contains('stelvio-rank-star-slot') ||
            sib.classList.contains('stelvio-rank-stars-wrap') ||
            sib.classList.contains('ranking-private-badge'))
        ) {
          insertBefore = sib;
          break;
        }
        sib = sib.nextSibling;
      }
    }
    var holder = document.createElement('span');
    holder.innerHTML = rcHtml;
    while (holder.firstChild) {
      if (insertBefore) {
        nameWrap.insertBefore(holder.firstChild, insertBefore);
      } else if (nameText && nameText.nextSibling) {
        nameWrap.insertBefore(holder.firstChild, nameText.nextSibling);
      } else if (nameText) {
        nameWrap.appendChild(holder.firstChild);
      } else {
        nameWrap.appendChild(holder.firstChild);
      }
    }
  }

  function resolveItemForRowEl(rowEl, rowByUid) {
    if (!rowEl || !rowByUid) return null;
    var ids = [
      rowEl.getAttribute('data-board-uid'),
      rowEl.getAttribute('data-social-uid')
    ];
    var i;
    for (i = 0; i < ids.length; i++) {
      if (ids[i] && rowByUid[ids[i]]) return rowByUid[ids[i]];
    }
    var avBtn = rowEl.querySelector('.stelvio-rank-avatar-btn[data-stelvio-rank-user-id]');
    if (avBtn) {
      var avUid = avBtn.getAttribute('data-stelvio-rank-user-id');
      if (avUid && rowByUid[avUid]) return rowByUid[avUid];
    }
    return null;
  }

  /**
   * CYCLE stelvioRankingRefreshListRankChangeSlots — React 목록·캐시 복원 후 등락 DOM 동기화
   */
  function refreshListRankChangeSlots(rootEl, rankedList, listCategoryKey, refreshOpts) {
    refreshOpts = refreshOpts || {};
    if (!rootEl || !Array.isArray(rankedList) || !rankedList.length) return;
    if (!callFn('stelvioServerRankChangeBadgeHtml')) return;

    var rowByUid = buildRowLookup(rankedList);
    var listCat = listCategoryKey || 'Supremo';
    var processed = {};

    function syncNameWrap(nameWrap, item) {
      if (!nameWrap || !item) return;
      var key = itemLookupIds(item).join('|');
      if (processed[key]) return;
      processed[key] = true;

      var rcHtml = badgeHtmlForListItem(item, listCat);
      removeRankChangeNodes(nameWrap);
      if (!rcHtml) return;

      insertRankChangeAfterName(nameWrap, rcHtml);
    }

    var rows = rootEl.querySelectorAll('.running-ranking-row, .stelvio-rank-row.running-ranking-row');
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var rowEl = rows[ri];
      var item = resolveItemForRowEl(rowEl, rowByUid);
      if (!item) continue;
      syncNameWrap(rowEl.querySelector('.stelvio-rank-name'), item);
    }

    var avatarBtns = rootEl.querySelectorAll('.stelvio-rank-avatar-btn[data-stelvio-rank-user-id]');
    for (ri = 0; ri < avatarBtns.length; ri++) {
      var uid = avatarBtns[ri].getAttribute('data-stelvio-rank-user-id');
      if (!uid || !rowByUid[uid]) continue;
      var wrap = avatarBtns[ri].closest ? avatarBtns[ri].closest('.stelvio-rank-name') : null;
      if (wrap) syncNameWrap(wrap, rowByUid[uid]);
    }

    if (refreshOpts.retryIfMissing && (refreshOpts._retry || 0) < 4) {
      var missing = rootEl.querySelectorAll('.stelvio-rank-name');
      var needRetry = false;
      for (ri = 0; ri < missing.length; ri++) {
        var wrap2 = missing[ri];
        var row2 = wrap2.closest ? wrap2.closest('.running-ranking-row') : null;
        var it2 = resolveItemForRowEl(row2, rowByUid);
        if (!it2 || it2.rankChange == null) continue;
        if (!wrap2.querySelector('.stelvio-rank-change')) {
          needRetry = true;
          break;
        }
      }
      if (needRetry) {
        var nextOpts = {};
        var k;
        for (k in refreshOpts) {
          if (Object.prototype.hasOwnProperty.call(refreshOpts, k)) nextOpts[k] = refreshOpts[k];
        }
        nextOpts._retry = (refreshOpts._retry || 0) + 1;
        nextOpts.retryIfMissing = true;
        var delay = nextOpts._retry < 3 ? 0 : 120;
        if (delay) {
          setTimeout(function () {
            refreshListRankChangeSlots(rootEl, rankedList, listCategoryKey, nextOpts);
          }, delay);
        } else {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              refreshListRankChangeSlots(rootEl, rankedList, listCategoryKey, nextOpts);
            });
          });
        }
      }
    }
  }

  global.runningRankingRankChange = {
    badgeHtmlForListItem: badgeHtmlForListItem,
    suffixForListItem: suffixForListItem,
    refreshListRankChangeSlots: refreshListRankChangeSlots
  };
})(typeof window !== 'undefined' ? window : global);
