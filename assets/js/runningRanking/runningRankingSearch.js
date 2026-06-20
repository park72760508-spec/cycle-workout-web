/**
 * RUN 랭킹보드 — 이름 검색 FAB (CYCLE rankingSearchFab와 동일 UX)
 * 종합·구간·TSS·거리 탭에서 「전체 랭킹 ±」 펼침 시 좌측 하단 검색 버튼 활성화
 */
(function (global) {
  'use strict';

  var LIST_BODY_ID = 'runningRankingListBody';
  var FAB_ID = 'runningRankingSearchFab';
  var TOGGLE_ID = 'runningRankingSearchToggleBtn';
  var INPUT_WRAP_ID = 'runningRankingSearchInputWrap';
  var INPUT_ID = 'runningRankingSearchInput';
  var CLEAR_ID = 'runningRankingSearchClearBtn';
  var CTX_KEY = '_runningRankSearchCtx';
  var UI_STATE_KEY = 'runningRankingSearchUiState';

  var _inputOpen = false;
  var _mo = null;
  var _applying = false;
  var _listBody = null;
  var MAX_GHOST = 15;

  function _el(id) {
    return document.getElementById(id);
  }

  function _soc() {
    return global.runningRankingSocial || {};
  }

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _moConnect() {
    _ensureObservedListBody();
    if (!_mo || !_listBody) return;
    try {
      _mo.observe(_listBody, { childList: true, subtree: true });
    } catch (e) {}
  }

  function _moDisconnect() {
    if (!_mo) return;
    try {
      _mo.disconnect();
    } catch (e) {}
  }

  function _ensureObservedListBody() {
    var currentBody = _el(LIST_BODY_ID);
    if (!currentBody || currentBody === _listBody) return;
    _moDisconnect();
    _listBody = currentBody;
  }

  function _screenActive() {
    var screen = _el('runningRankingScreen');
    return !!(screen && screen.classList.contains('active'));
  }

  function _isExpandedDom() {
    var body = _el(LIST_BODY_ID);
    if (!body) return false;
    var expandRows = body.querySelectorAll('.stelvio-rank-expand-row');
    for (var i = 0; i < expandRows.length; i++) {
      var center = expandRows[i].querySelector('.stelvio-rank-expand-center');
      if (center && center.textContent.trim() === '접어보기') return true;
      var minus = expandRows[i].querySelector('.stelvio-rank-expand-left.stelvio-rank-expand-hit');
      if (minus && center && center.textContent.trim() === '전체 랭킹') return true;
    }
    return false;
  }

  function _isExpanded() {
    var ui = global[UI_STATE_KEY];
    if (ui && ui.enabled === false) return false;
    if (ui && ui.expanded === true) return true;
    if (ui && ui.expanded === false) return false;
    return _isExpandedDom();
  }

  function _closeInput() {
    _inputOpen = false;
    var wrap = _el(INPUT_WRAP_ID);
    if (wrap) wrap.classList.add('ranking-search-input-wrap--closed');
    var inp = _el(INPUT_ID);
    if (inp) {
      inp.value = '';
      _applySearch('');
    }
  }

  function _updateFabVisibility() {
    var fab = _el(FAB_ID);
    if (!fab) return;
    _ensureObservedListBody();
    _moConnect();
    var show = _screenActive() && _isExpanded();
    fab.classList.toggle('ranking-search-fab--hidden', !show);
    if (!show) _closeInput();
  }

  function _rowUidSet(row) {
    var set = {};
    var socialUid = row.getAttribute('data-social-uid') || '';
    var boardUid = row.getAttribute('data-board-uid') || '';
    if (socialUid) set[socialUid] = true;
    if (boardUid) set[boardUid] = true;
    var avatarBtn = row.querySelector('[data-stelvio-rank-user-id]');
    if (avatarBtn) {
      var avUid = avatarBtn.getAttribute('data-stelvio-rank-user-id') || '';
      if (avUid) set[avUid] = true;
    }
    return set;
  }

  function _itemUid(item) {
    if (!item) return '';
    if (item.isCrew) return String(item.crewId || '');
    var soc = _soc();
    if (soc.socialUserId) return String(soc.socialUserId(item) || item.userId || '');
    return String(item.userId || item.socialUserId || '');
  }

  function _itemBoardUid(item) {
    if (!item || item.isCrew) return '';
    return item.userId != null ? String(item.userId) : '';
  }

  function _canSeePrivateItem(item, ctx) {
    var uid = _itemUid(item);
    var boardUid = _itemBoardUid(item);
    var isCurrent =
      !!(ctx.currentUserId && (uid === String(ctx.currentUserId) || boardUid === String(ctx.currentUserId)));
    var isFriend = !!(ctx.friendSet && typeof ctx.friendSet.has === 'function' && ctx.friendSet.has(uid));
    if (boardUid && ctx.friendSet && ctx.friendSet.has(boardUid)) isFriend = true;
    var isGroupContact = !!(
      ctx.groupContactSet &&
      typeof ctx.groupContactSet.has === 'function' &&
      (ctx.groupContactSet.has(uid) || (boardUid && ctx.groupContactSet.has(boardUid)))
    );
    return isCurrent || ctx.isAdmin || isFriend || isGroupContact;
  }

  function _resolveItemName(item, ctx) {
    var soc = _soc();
    if (soc.resolveRawName) return soc.resolveRawName(item);
    if (typeof ctx.resolveName === 'function') return ctx.resolveName(item);
    return item && item.name ? String(item.name) : '';
  }

  function _formatItemValue(item, ctx) {
    var soc = _soc();
    if (soc.formatValueLabel) return soc.formatValueLabel(item);
    if (typeof ctx.formatValue === 'function') return ctx.formatValue(item);
    return item && item.valueLabel ? String(item.valueLabel) : '—';
  }

  function _buildGhostRowHtml(item, rankNum, ctx) {
    var rawName = _resolveItemName(item, ctx);
    var uid = _itemUid(item);
    var boardUid = _itemBoardUid(item);
    var isCurrent =
      !!(ctx.currentUserId && (uid === String(ctx.currentUserId) || boardUid === String(ctx.currentUserId)));
    var isPrivate = typeof ctx.isPrivate === 'function' ? ctx.isPrivate(item) : false;
    var canSeeFull = _canSeePrivateItem(item, ctx);
    var name;
    if (isPrivate && !canSeeFull) {
      var maskFn =
        typeof global.stelvioRankingPrivateMaskedDisplayName === 'function'
          ? global.stelvioRankingPrivateMaskedDisplayName
          : null;
      name = maskFn ? maskFn(rawName) : rawName.length >= 2 ? rawName.charAt(0) + '**' : '**';
    } else {
      name = rawName.length > 10 ? rawName.substring(0, 8) + '..' : rawName;
    }
    var valStr = _formatItemValue(item, ctx);
    var safeName = _escapeHtml(name);
    var medals = (global.runningRankingConfig && global.runningRankingConfig.MEDAL_SRC) || [
      'assets/img/1st.svg',
      'assets/img/2nd.svg',
      'assets/img/3rd.svg'
    ];
    var crownHtml =
      rankNum <= 3
        ? '<span class="stelvio-rank-crown"><img class="stelvio-rank-crown-img" src="' +
          medals[rankNum - 1] +
          '" alt="" width="18" height="18" loading="lazy" decoding="async" /></span>'
        : '<span class="stelvio-rank-crown stelvio-rank-crown--placeholder" aria-hidden="true"></span>';

    var html =
      '<div class="stelvio-rank-row running-ranking-row ranking-search-ghost ranking-search-highlight' +
      (isCurrent ? ' stelvio-rank-current' : '') +
      '" data-search-ghost="1">';
    html += '<span class="stelvio-rank-ranklead">' + crownHtml;
    html += '<span class="stelvio-rank-pos">' + rankNum + '위</span></span>';
    html +=
      '<span class="stelvio-rank-name"><span class="stelvio-rank-name-text" title="' +
      safeName +
      '">' +
      safeName +
      '</span><span class="ranking-search-ghost-badge">검색</span></span>';
    html += '<span class="stelvio-rank-wkg running-ranking-value">' + _escapeHtml(valStr) + '</span>';
    html += '</div>';
    return html;
  }

  function _parseRankFromRow(row) {
    var posEl = row.querySelector('.stelvio-rank-pos');
    if (!posEl) return NaN;
    return parseInt(String(posEl.textContent || '').replace('위', '').trim(), 10);
  }

  function _applySearch(query) {
    if (_applying) return;
    _applying = true;
    _moDisconnect();

    try {
      var body = _el(LIST_BODY_ID);
      if (!body) return;

      var oldGhosts = body.querySelectorAll('[data-search-ghost]');
      for (var g = 0; g < oldGhosts.length; g++) {
        try {
          body.removeChild(oldGhosts[g]);
        } catch (e) {}
      }

      var q = query ? String(query).toLowerCase().trim() : '';
      var visibleRows = body.querySelectorAll(
        '.stelvio-rank-row:not(.stelvio-rank-expand-row):not(.stelvio-rank-dots-row):not([data-search-ghost])'
      );
      var firstMatch = null;
      var visibleUidSet = {};
      for (var i = 0; i < visibleRows.length; i++) {
        var row = visibleRows[i];
        var uidMap = _rowUidSet(row);
        Object.keys(uidMap).forEach(function (k) {
          visibleUidSet[k] = true;
        });
        var nameEl = row.querySelector('.stelvio-rank-name-text');
        if (!nameEl) {
          row.classList.remove('ranking-search-highlight');
          continue;
        }
        var rowName = (nameEl.textContent || '').toLowerCase();
        if (q && rowName.indexOf(q) >= 0) {
          row.classList.add('ranking-search-highlight');
          if (!firstMatch) firstMatch = row;
        } else {
          row.classList.remove('ranking-search-highlight');
        }
      }

      if (q.length >= 2) {
        var ctx = global[CTX_KEY];
        if (ctx && Array.isArray(ctx.arr) && ctx.arr.length > 0) {
          var hiddenMatches = [];
          for (var j = 0; j < ctx.arr.length && hiddenMatches.length < MAX_GHOST; j++) {
            var item = ctx.arr[j];
            if (!item || item.isCrew) continue;
            var uid = _itemUid(item);
            var boardUid = _itemBoardUid(item);
            if (visibleUidSet[uid] || (boardUid && visibleUidSet[boardUid])) continue;

            var itmPrivate = typeof ctx.isPrivate === 'function' ? ctx.isPrivate(item) : false;
            if (itmPrivate && !_canSeePrivateItem(item, ctx)) continue;

            var itmName = _resolveItemName(item, ctx).toLowerCase();
            if (itmName.indexOf(q) >= 0) {
              hiddenMatches.push({ item: item, rankNum: j + 1 });
            }
          }

          if (hiddenMatches.length > 0) {
            var rankMap = [];
            var allVis = body.querySelectorAll(
              '.stelvio-rank-row:not(.stelvio-rank-expand-row):not(.stelvio-rank-dots-row):not([data-search-ghost])'
            );
            for (var k = 0; k < allVis.length; k++) {
              var rn = _parseRankFromRow(allVis[k]);
              if (!isNaN(rn)) rankMap.push({ rank: rn, el: allVis[k] });
            }
            rankMap.sort(function (a, b) {
              return a.rank - b.rank;
            });

            hiddenMatches.sort(function (a, b) {
              return a.rankNum - b.rankNum;
            });

            for (var m = 0; m < hiddenMatches.length; m++) {
              var hm = hiddenMatches[m];
              var tmpDiv = document.createElement('div');
              tmpDiv.innerHTML = _buildGhostRowHtml(hm.item, hm.rankNum, ctx);
              var ghostEl = tmpDiv.firstChild;
              if (!ghostEl) continue;

              var insertAfterEl = null;
              for (var r = rankMap.length - 1; r >= 0; r--) {
                if (rankMap[r].rank < hm.rankNum) {
                  insertAfterEl = rankMap[r].el;
                  break;
                }
              }

              if (insertAfterEl) {
                var nextSib = insertAfterEl.nextSibling;
                while (
                  nextSib &&
                  nextSib.nodeType === 1 &&
                  typeof nextSib.getAttribute === 'function' &&
                  nextSib.getAttribute('data-search-ghost') === '1'
                ) {
                  nextSib = nextSib.nextSibling;
                }
                body.insertBefore(ghostEl, nextSib || null);
              } else {
                var firstRow = body.querySelector('.stelvio-rank-row:not([data-search-ghost])');
                body.insertBefore(ghostEl, firstRow || null);
              }

              rankMap.push({ rank: hm.rankNum, el: ghostEl });
              rankMap.sort(function (a, b) {
                return a.rank - b.rank;
              });

              if (!firstMatch) firstMatch = ghostEl;
            }
          }
        }
      }

      if (firstMatch) {
        try {
          firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {}
      }
    } finally {
      _applying = false;
      _moConnect();
    }
  }

  function _init() {
    var toggleBtn = _el(TOGGLE_ID);
    var inp = _el(INPUT_ID);
    var clearBtn = _el(CLEAR_ID);
    if (!toggleBtn || !inp || !clearBtn) return;

    toggleBtn.addEventListener('click', function () {
      _inputOpen = !_inputOpen;
      var wrap = _el(INPUT_WRAP_ID);
      if (wrap) wrap.classList.toggle('ranking-search-input-wrap--closed', !_inputOpen);
      if (_inputOpen) {
        setTimeout(function () {
          inp.focus();
        }, 50);
      } else {
        inp.value = '';
        _applySearch('');
      }
    });

    inp.addEventListener('input', function () {
      _applySearch(inp.value.trim());
    });

    clearBtn.addEventListener('click', function () {
      inp.value = '';
      _applySearch('');
      inp.focus();
    });

    _listBody = _el(LIST_BODY_ID);
    if (_listBody) {
      _mo = new MutationObserver(function () {
        _updateFabVisibility();
        if (_inputOpen && inp.value.trim()) _applySearch(inp.value.trim());
      });
      _moConnect();
    }

    _updateFabVisibility();
  }

  function setSearchContext(ctx) {
    global[CTX_KEY] = ctx || null;
  }

  function setSearchUiState(state) {
    global[UI_STATE_KEY] = state || {};
    _updateFabVisibility();
  }

  global.runningRankingSearchSetContext = setSearchContext;
  global.runningRankingSearchSetUiState = setSearchUiState;
  global._runningRankingSearchFab = {
    update: _updateFabVisibility,
    reconnect: _moConnect,
    applySearch: _applySearch
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})(typeof window !== 'undefined' ? window : global);
