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

  function currentRankForItem(item) {
    if (!item) return null;
    if (item.rank != null && isFinite(Number(item.rank))) {
      return Math.floor(Number(item.rank));
    }
    if (item.boardRank != null && isFinite(Number(item.boardRank))) {
      return Math.floor(Number(item.boardRank));
    }
    return null;
  }

  function resolveRankMovementFields(item) {
    if (!item || item.isCrew) return null;
    if (item.rankChange == null || item.previousBoardRank == null) return null;

    var rcN = Math.round(Number(item.rankChange));
    var prevN = Math.floor(Number(item.previousBoardRank));
    var currN = currentRankForItem(item);
    if (!isFinite(rcN) || !isFinite(prevN) || prevN < 1) return null;

    var matchesFn = callFn('stelvioRankMovementRowMatchesCurrentRank');
    if (matchesFn && currN != null && currN >= 1 && !matchesFn(item, currN)) {
      if (prevN >= 1 && currN >= 1) {
        rcN = prevN - currN;
      } else {
        return null;
      }
    }

    return { rc: rcN, prev: prevN };
  }

  /**
   * applyRankMovement 이후 필드만 사용 — normalize 재호출 시 Android·live에서 필드가 지워지는 것 방지
   */
  function badgeHtmlForListItem(item, listCategoryKey) {
    var mv = resolveRankMovementFields(item);
    if (!mv) return '';
    var badgeFn = callFn('stelvioServerRankChangeBadgeHtml');
    return badgeFn ? (badgeFn(mv.rc, mv.prev) || '') : '';
  }

  function suffixForListItem(item, listCategoryKey) {
    var mv = resolveRankMovementFields(item);
    if (!mv) return null;
    var html = badgeHtmlForListItem(item, listCategoryKey);
    if (mv.rc > 0) {
      return { text: '(↑' + mv.rc + ')', kind: 'up', title: '전날 ' + mv.prev + '위', html: html };
    }
    if (mv.rc < 0) {
      return { text: '(↓' + Math.abs(mv.rc) + ')', kind: 'down', title: '전날 ' + mv.prev + '위', html: html };
    }
    return { text: '(-)', kind: 'flat', title: '전날 ' + mv.prev + '위', html: html };
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

  function removeRankChangeNodes(rootEl) {
    if (!rootEl) return;
    var nodes = rootEl.querySelectorAll('.stelvio-rank-change, .stelvio-rank-change-slot--run-sync');
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  function appendRankChangeHtml(parentEl, rcHtml, insertBefore, locationClass) {
    if (!parentEl || !rcHtml) return;
    var holder = document.createElement('span');
    holder.innerHTML = rcHtml;
    while (holder.firstChild) {
      var node = holder.firstChild;
      if (node.nodeType === 1 && node.classList) {
        node.classList.add('stelvio-rank-change--run-sync');
        if (locationClass) node.classList.add(locationClass);
      }
      if (insertBefore && insertBefore.parentNode === parentEl) {
        parentEl.insertBefore(node, insertBefore);
      } else {
        parentEl.appendChild(node);
      }
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
    appendRankChangeHtml(nameWrap, rcHtml, insertBefore, 'stelvio-rank-change--run-name');
  }

  function insertRankChangeBesidePos(rowEl, rcHtml) {
    if (!rowEl || !rcHtml) return;
    var posEl = rowEl.querySelector('.stelvio-rank-ranklead .stelvio-rank-pos');
    if (!posEl) return;
    appendRankChangeHtml(posEl, rcHtml, null, 'stelvio-rank-change--run-pos');
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

  function syncRowRankChange(rowEl, item, listCat) {
    if (!rowEl || !item) return false;
    var rcHtml = badgeHtmlForListItem(item, listCat);
    var nameWrap = rowEl.querySelector('.stelvio-rank-name');
    if (nameWrap) {
      removeRankChangeNodes(nameWrap);
      if (rcHtml) insertRankChangeAfterName(nameWrap, rcHtml);
    }
    var posEl = rowEl.querySelector('.stelvio-rank-ranklead .stelvio-rank-pos');
    if (posEl) {
      removeRankChangeNodes(posEl);
      if (rcHtml) insertRankChangeBesidePos(rowEl, rcHtml);
    }
    return !!rcHtml;
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
      var rowEl = nameWrap.closest ? nameWrap.closest('.running-ranking-row') : null;
      if (!rowEl) return;
      var key = itemLookupIds(item).join('|');
      if (processed[key]) return;
      processed[key] = true;
      syncRowRankChange(rowEl, item, listCat);
    }

    var rows = rootEl.querySelectorAll('.running-ranking-row, .stelvio-rank-row.running-ranking-row');
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var rowEl = rows[ri];
      var item = resolveItemForRowEl(rowEl, rowByUid);
      if (!item) continue;
      syncRowRankChange(rowEl, item, listCat);
      processed[itemLookupIds(item).join('|')] = true;
    }

    var avatarBtns = rootEl.querySelectorAll('.stelvio-rank-avatar-btn[data-stelvio-rank-user-id]');
    for (ri = 0; ri < avatarBtns.length; ri++) {
      var uid = avatarBtns[ri].getAttribute('data-stelvio-rank-user-id');
      if (!uid || !rowByUid[uid]) continue;
      var wrap = avatarBtns[ri].closest ? avatarBtns[ri].closest('.stelvio-rank-name') : null;
      if (wrap) syncNameWrap(wrap, rowByUid[uid]);
    }

    if (refreshOpts.retryIfMissing && (refreshOpts._retry || 0) < 8) {
      var needRetry = false;
      for (ri = 0; ri < rows.length; ri++) {
        var rowCheck = rows[ri];
        var itCheck = resolveItemForRowEl(rowCheck, rowByUid);
        if (!itCheck || resolveRankMovementFields(itCheck) == null) continue;
        if (!rowCheck.querySelector('.stelvio-rank-change')) {
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
        var delay = nextOpts._retry < 4 ? 0 : (nextOpts._retry < 6 ? 120 : 320);
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
    resolveRankMovementFields: resolveRankMovementFields,
    refreshListRankChangeSlots: refreshListRankChangeSlots
  };
})(typeof window !== 'undefined' ? window : global);
