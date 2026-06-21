/**
 * 러닝 랭킹보드 — 메인 화면 (5탭: 종합·구간·TSS·거리·크루)
 * 종합 탭: CYCLE 랭킹보드 GC 탭과 동일 UI (히어로·전체/관심·범례·분포도)
 */
/* global React, useState, useEffect, useMemo, useCallback, useRef */
(function () {
  'use strict';
  if (!window.React) {
    console.warn('[RunningRankingScreen] React not loaded');
    return;
  }

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;
  var useRef = React.useRef;

  var STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

  function cfg() { return window.runningRankingConfig || {}; }
  function dataApi() { return window.runningRankingData || {}; }
  function fetchApi() { return window.runningRankingApi || {}; }
  function socialApi() { return window.runningRankingSocial || {}; }

  function legendStarSvg(className) {
    return React.createElement('span', { className: className, 'aria-hidden': true },
      React.createElement('svg', {
        className: 'stelvio-legend-star-svg',
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 20 20',
        width: '1.05em',
        height: '1.05em'
      },
        React.createElement('path', { fill: 'currentColor', d: STAR_PATH })
      )
    );
  }

  function RunningRankingStarLegend() {
    return React.createElement('div', {
      className: 'stelvio-ranking-star-legend',
      role: 'note',
      'aria-label': '순위 목록 별 표시 설명'
    },
      React.createElement('span', { className: 'stelvio-ranking-star-legend-item' },
        legendStarSvg('stelvio-legend-star stelvio-legend-star--friend'),
        React.createElement('span', null, '친구')
      ),
      React.createElement('span', { className: 'stelvio-ranking-star-legend-item' },
        legendStarSvg('stelvio-legend-star stelvio-legend-star--group'),
        React.createElement('span', null, '그룹멤버')
      ),
      React.createElement('span', { className: 'stelvio-ranking-star-legend-item' },
        legendStarSvg('stelvio-legend-star stelvio-legend-star--interest'),
        React.createElement('span', null, '관심')
      )
    );
  }

  function RunningRankingScreen() {
    var _tab = useState('overall');
    var activeTab = _tab[0];
    var setActiveTab = _tab[1];

    var _paceDist = useState('1k');
    var paceDistance = _paceDist[0];
    var setPaceDistance = _paceDist[1];

    var _gender = useState('all');
    var gender = _gender[0];
    var setGender = _gender[1];

    var _category = useState((cfg().DEFAULT_CATEGORY) || 'Supremo');
    var activeCategory = _category[0];
    var setActiveCategory = _category[1];

    var _crewMetric = useState('overall');
    var crewMetric = _crewMetric[0];
    var setCrewMetric = _crewMetric[1];

    var _listFilter = useState('all');
    var listFilter = _listFilter[0];
    var setListFilter = _listFilter[1];

    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];

    var _error = useState(null);
    var error = _error[0];
    var setError = _error[1];

    var _rows = useState([]);
    var rawRows = _rows[0];
    var setRawRows = _rows[1];

    var _crewGroups = useState([]);
    var crewGroups = _crewGroups[0];
    var setCrewGroups = _crewGroups[1];

    var _crewEnriched = useState([]);
    var crewEnriched = _crewEnriched[0];
    var setCrewEnriched = _crewEnriched[1];

    var _stale = useState(false);
    var stale = _stale[0];
    var setStale = _stale[1];

    var _rankMovement = useState({});
    var rankMovementByKey = _rankMovement[0];
    var setRankMovementByKey = _rankMovement[1];

    var _rankMovementAsOf = useState('');
    var rankMovementAsOfSeoul = _rankMovementAsOf[0];
    var setRankMovementAsOfSeoul = _rankMovementAsOf[1];

    var _rankMovementSource = useState('');
    var rankMovementSource = _rankMovementSource[0];
    var setRankMovementSource = _rankMovementSource[1];

    var _leaderboardSource = useState('');
    var leaderboardSource = _leaderboardSource[0];
    var setLeaderboardSource = _leaderboardSource[1];

    var _leaderboardAsOf = useState('');
    var leaderboardAsOfSeoul = _leaderboardAsOf[0];
    var setLeaderboardAsOfSeoul = _leaderboardAsOf[1];

    var _socialVer = useState(0);
    var socialVer = _socialVer[0];
    var setSocialVer = _socialVer[1];

    var _showOverallSegments = useState(false);
    var showOverallSegments = _showOverallSegments[0];
    var setShowOverallSegments = _showOverallSegments[1];

    var _heroExpanded = useState(false);
    var heroExpanded = _heroExpanded[0];
    var setHeroExpanded = _heroExpanded[1];

    var heroOpts = useMemo(function () {
      return {
        gender: gender,
        category: activeCategory,
        paceDistance: paceDistance,
        rankMovementByKey: rankMovementByKey,
        rankMovementSource: rankMovementSource,
        leaderboardAsOfSeoul: leaderboardAsOfSeoul,
        rankMovementAsOfSeoul: rankMovementAsOfSeoul
      };
    }, [gender, activeCategory, paceDistance, rankMovementByKey, rankMovementSource, leaderboardAsOfSeoul, rankMovementAsOfSeoul]);

    var _gapState = useState({});
    var gapState = _gapState[0];
    var setGapState = _gapState[1];

    var crewUnsubRef = useRef(null);
    var starRefreshTimerRef = useRef(null);
    var isOverallTab = activeTab === 'overall';
    var isPaceTab = activeTab === 'pace';
    var isTssTab = activeTab === 'tss';
    var isDistanceTab = activeTab === 'distance';
    var isCrewTab = activeTab === 'crew';
    var hasDistributionChart = isOverallTab || isPaceTab || isTssTab || isDistanceTab;

    var RUN_DIST_CHART_ROOTS = {
      overall: 'running-ranking-distribution-chart-root',
      pace: 'running-ranking-pace-distribution-chart-root',
      tss: 'running-ranking-tss-distribution-chart-root',
      distance: 'running-ranking-distance-distribution-chart-root'
    };

    var currentUserId = useMemo(function () {
      return dataApi().getCurrentUserId ? dataApi().getCurrentUserId() : null;
    }, [loading, rawRows.length]);

    var filteredCrewGroups = useMemo(function () {
      var mod = window.runningRankingCrewTab;
      if (mod && typeof mod.filterRunCrewGroups === 'function') {
        return mod.filterRunCrewGroups(crewGroups);
      }
      return crewGroups;
    }, [crewGroups]);

    var viewerIdentity = useMemo(function () {
      return dataApi().getViewerIdentity
        ? dataApi().getViewerIdentity(rawRows)
        : { firebaseId: currentUserId, boardUserId: null };
    }, [rawRows, currentUserId, loading]);

    var loadLeaderboard = useCallback(function (opts) {
      setLoading(true);
      setError(null);
      var p = fetchApi().fetchLeaderboard ? fetchApi().fetchLeaderboard(opts || {}) : Promise.resolve({ success: false, rows: [] });
      return p.then(function (res) {
        if (!res.success) {
          setError(res.error || '불러오기 실패');
          setRawRows([]);
        } else {
          setRawRows(res.rows || []);
          setRankMovementByKey(res.rankMovementByKey || {});
          setRankMovementAsOfSeoul(res.rankMovementAsOfSeoul || '');
          setRankMovementSource(res.rankMovementSource || '');
          setLeaderboardSource(res.leaderboardSource || '');
          setLeaderboardAsOfSeoul(res.leaderboardAsOfSeoul || '');
          setStale(!!res.stale);
          if (res.stale && res.error) setError(res.error);
        }
      }).finally(function () {
        setLoading(false);
      });
    }, []);

    var subscribeCrewGroups = useCallback(function () {
      var uid = dataApi().getCurrentUserId ? dataApi().getCurrentUserId() : null;
      if (!uid) {
        setCrewGroups([]);
        return;
      }
      if (crewUnsubRef.current) {
        try { crewUnsubRef.current(); } catch (e) {}
        crewUnsubRef.current = null;
      }
      function attach(svc) {
        if (!svc || typeof svc.subscribeMyRidingGroupsAsMember !== 'function') return;
        if (!window.firestoreV9) return;
        try {
          crewUnsubRef.current = svc.subscribeMyRidingGroupsAsMember(window.firestoreV9, uid, function (rows) {
            var list = rows && rows.length ? rows.slice() : [];
            var enrich =
              window.ridingGroupCategory &&
              typeof window.ridingGroupCategory.enrichRidingGroupsWithOwnerCategory === 'function'
                ? window.ridingGroupCategory.enrichRidingGroupsWithOwnerCategory
                : null;
            if (!enrich) {
              setCrewGroups(list);
              return;
            }
            enrich(list)
              .then(function (enriched) {
                setCrewGroups(enriched && enriched.length ? enriched : list);
              })
              .catch(function () {
                setCrewGroups(list);
              });
          });
        } catch (e) {}
      }
      if (window.openRidingGroupService) {
        attach(window.openRidingGroupService);
      } else {
        import('./assets/js/openRiding/openRidingGroupService.js')
          .then(function () { attach(window.openRidingGroupService); })
          .catch(function () { setCrewGroups([]); });
      }
    }, []);

    useEffect(function () {
      if (activeTab !== 'crew' || !filteredCrewGroups.length) {
        setCrewEnriched([]);
        return;
      }
      var crewMod = window.runningRankingCrew;
      if (!crewMod || typeof crewMod.enrichGroupsWithMemberIds !== 'function') {
        setCrewEnriched(filteredCrewGroups);
        return;
      }
      var cancelled = false;
      crewMod.enrichGroupsWithMemberIds(filteredCrewGroups).then(function (enriched) {
        if (!cancelled) setCrewEnriched(enriched || []);
      });
      return function () { cancelled = true; };
    }, [activeTab, filteredCrewGroups]);

    useEffect(function () {
      window.runningRankingLeaderboardRows = rawRows && rawRows.length ? rawRows.slice() : [];
      window.runningRankingUiState = {
        gender: gender,
        activeCategory: activeCategory,
        activeTab: activeTab
      };
    }, [rawRows, gender, activeCategory, activeTab]);

    useEffect(function () {
      loadLeaderboard({});
      var socialMod = socialApi();
      if (socialMod) {
        if (typeof socialMod.ensureUiListeners === 'function') socialMod.ensureUiListeners();
        if (typeof socialMod.bootstrapSocial === 'function') {
          socialMod.bootstrapSocial().then(function () {
            setSocialVer(function (v) { return v + 1; });
          }).catch(function () {});
        }
        if (typeof socialMod.bindStarChangeListener === 'function') {
          socialMod.bindStarChangeListener(function () {
            setSocialVer(function (v) { return v + 1; });
          });
        }
        if (typeof socialMod.hookSocialStarUiRefresh === 'function') {
          socialMod.hookSocialStarUiRefresh(function () {
            setSocialVer(function (v) { return v + 1; });
          });
        }
      }
      return function () {
        if (crewUnsubRef.current) {
          try { crewUnsubRef.current(); } catch (e) {}
          crewUnsubRef.current = null;
        }
      };
    }, [loadLeaderboard]);

    useEffect(function () {
      if (activeTab !== 'crew') {
        if (crewUnsubRef.current) {
          try { crewUnsubRef.current(); } catch (e) {}
          crewUnsubRef.current = null;
        }
        return;
      }
      subscribeCrewGroups();
      return function () {
        if (crewUnsubRef.current) {
          try { crewUnsubRef.current(); } catch (e) {}
          crewUnsubRef.current = null;
        }
      };
    }, [activeTab, subscribeCrewGroups]);

    function scrollRankingToTop() {
      var scrollEl = document.getElementById('runningRankingScrollArea');
      if (!scrollEl) return;
      try {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        scrollEl.scrollTop = 0;
      }
    }

    useEffect(function () {
      if (activeTab === 'crew') return;
      scrollRankingToTop();
      setHeroExpanded(false);
    }, [gender, activeCategory, activeTab, paceDistance, listFilter, crewMetric]);

    var baseRankedList = useMemo(function () {
      if (activeTab === 'crew') return [];
      return dataApi().buildRankedList
        ? dataApi().buildRankedList(rawRows, activeTab, {
          paceDistance: paceDistance,
          gender: gender,
          category: activeCategory
        })
        : [];
    }, [rawRows, activeTab, paceDistance, gender, activeCategory]);

    var rankedList = useMemo(function () {
      var list = baseRankedList.slice();
      var moveMod = window.runningRankingMovement;
      if (moveMod && typeof moveMod.applyRankMovement === 'function') {
        moveMod.applyRankMovement(list, activeTab, {
          paceDistance: paceDistance,
          gender: gender,
          category: activeCategory,
          rankMovementSource: rankMovementSource,
          leaderboardSource: leaderboardSource,
          leaderboardAsOfSeoul: leaderboardAsOfSeoul,
          rankMovementAsOfSeoul: rankMovementAsOfSeoul
        }, rankMovementByKey);
      }
      if (isOverallTab && listFilter === 'interest') {
        var soc = socialApi();
        if (soc && typeof soc.filterRowsByListInterest === 'function') {
          list = soc.filterRowsByListInterest(list, listFilter, currentUserId);
        }
      }
      if (isOverallTab && listFilter === 'interest') {
        list = list.map(function (item, idx) {
          var r = idx + 1;
          return Object.assign({}, item, { rank: r, boardRank: r });
        });
      }
      return list;
    }, [baseRankedList, isOverallTab, listFilter, currentUserId, activeTab, paceDistance, gender, activeCategory, rankMovementByKey, rankMovementSource, leaderboardSource, leaderboardAsOfSeoul, rankMovementAsOfSeoul, socialVer]);

    var myCrewIds = useMemo(function () {
      var set = new Set();
      (filteredCrewGroups || []).forEach(function (gr) {
        var gid = gr && (gr.groupId || gr.id) ? String(gr.groupId || gr.id) : '';
        if (gid) set.add(gid);
      });
      return set;
    }, [filteredCrewGroups]);

    var myViewerItem = useMemo(function () {
      if (activeTab === 'crew') return null;
      if (!currentUserId && !viewerIdentity.boardUserId) return null;
      var match = dataApi().listItemMatchesViewer;
      var i;
      for (i = 0; i < rankedList.length; i++) {
        if (rankedList[i] && match && match(rankedList[i], viewerIdentity)) {
          return rankedList[i];
        }
        if (
          rankedList[i] &&
          viewerIdentity.boardUserId &&
          String(rankedList[i].userId) === String(viewerIdentity.boardUserId)
        ) {
          return rankedList[i];
        }
      }
      return null;
    }, [rankedList, currentUserId, viewerIdentity, activeTab]);

    var orphanViewerItem = useMemo(function () {
      if ((!currentUserId && !viewerIdentity.boardUserId) || activeTab === 'crew') return null;
      if (myViewerItem) return null;
      var match = dataApi().listItemMatchesViewer;
      var i;
      for (i = 0; i < baseRankedList.length; i++) {
        if (baseRankedList[i] && match && match(baseRankedList[i], viewerIdentity)) {
          return baseRankedList[i];
        }
      }
      return null;
    }, [baseRankedList, currentUserId, viewerIdentity, myViewerItem, activeTab]);

    var tabHeroPayload = useMemo(function () {
      var api = dataApi();
      if (activeTab === 'crew' || !api.buildTabHeroPayload) return null;
      if (activeTab === 'overall' || activeTab === 'pace' || activeTab === 'tss' || activeTab === 'distance') {
        return api.buildTabHeroPayload(rawRows, activeTab, Object.assign({}, heroOpts, {
          viewerItem: myViewerItem
        }));
      }
      return null;
    }, [activeTab, rawRows, heroOpts, myViewerItem]);

    var heroUserProfile = useMemo(function () {
      var u = window.currentUser;
      if (!u) {
        try { u = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { u = null; }
      }
      return u;
    }, [currentUserId, loading]);

    var chartPayloadBase = useMemo(function () {
      var api = dataApi();
      var chartOpts = { gender: gender, category: activeCategory };
      if (activeTab === 'overall' && api.buildDistributionPayload) {
        return api.buildDistributionPayload(rawRows, chartOpts);
      }
      if (activeTab === 'pace' && api.buildPaceDistributionPayload) {
        return api.buildPaceDistributionPayload(rawRows, Object.assign({}, chartOpts, {
          paceDistance: paceDistance
        }));
      }
      if (activeTab === 'tss' && api.buildTssDistributionPayload) {
        return api.buildTssDistributionPayload(rawRows, chartOpts);
      }
      if (activeTab === 'distance' && api.buildDistanceDistributionPayload) {
        return api.buildDistanceDistributionPayload(rawRows, chartOpts);
      }
      return null;
    }, [activeTab, rawRows, gender, activeCategory, paceDistance]);

    useEffect(function () {
      var dispose = window.disposeStelvioDistributionChart;
      if (!hasDistributionChart) {
        if (typeof dispose === 'function') {
          Object.keys(RUN_DIST_CHART_ROOTS).forEach(function (tabKey) {
            dispose(RUN_DIST_CHART_ROOTS[tabKey]);
          });
        }
        return;
      }
      if (loading) return;
      if (typeof window.refreshStelvioDistributionChart !== 'function') return;

      Object.keys(RUN_DIST_CHART_ROOTS).forEach(function (tabKey) {
        if (tabKey !== activeTab && typeof dispose === 'function') {
          dispose(RUN_DIST_CHART_ROOTS[tabKey]);
        }
      });

      var mountId = RUN_DIST_CHART_ROOTS[activeTab];
      if (!mountId || !chartPayloadBase) return;

      var api = dataApi();
      var payload = chartPayloadBase;
      if (typeof structuredClone === 'function') {
        try { payload = structuredClone(chartPayloadBase); } catch (eClone) { payload = chartPayloadBase; }
      }
      if (myViewerItem && api.enrichChartPayloadWithViewerItem) {
        payload = api.enrichChartPayloadWithViewerItem(payload, myViewerItem, rawRows);
      }

      if (isOverallTab && listFilter === 'interest') {
        var soc = socialApi();
        if (soc && typeof soc.filterRowsByListInterest === 'function') {
          var filt = function (rows) {
            return soc.filterRowsByListInterest(rows, 'interest', currentUserId);
          };
          if (payload.byCategory) {
            var bc = {};
            Object.keys(payload.byCategory).forEach(function (k) {
              bc[k] = filt(payload.byCategory[k]);
            });
            payload.byCategory = bc;
          }
          if (Array.isArray(payload.entries)) payload.entries = filt(payload.entries);
        }
      }

      var rafId = requestAnimationFrame(function () {
        var el = document.getElementById(mountId);
        if (!el) return;
        window.refreshStelvioDistributionChart(payload, mountId);
      });
      return function () {
        cancelAnimationFrame(rafId);
      };
    }, [
      hasDistributionChart,
      activeTab,
      chartPayloadBase,
      listFilter,
      currentUserId,
      loading,
      socialVer,
      isOverallTab,
      myViewerItem,
      rawRows
    ]);

    useEffect(function () {
      if (loading) return;
      var soc = socialApi();
      if (!soc || typeof soc.refreshStarSlots !== 'function') return;
      if (starRefreshTimerRef.current) clearTimeout(starRefreshTimerRef.current);
      starRefreshTimerRef.current = setTimeout(function () {
        starRefreshTimerRef.current = null;
        requestAnimationFrame(function () {
          soc.refreshStarSlots();
        });
      }, 80);
      return function () {
        if (starRefreshTimerRef.current) {
          clearTimeout(starRefreshTimerRef.current);
          starRefreshTimerRef.current = null;
        }
      };
    }, [rankedList.length, socialVer, loading, activeTab, listFilter, showOverallSegments]);

    var unitLabel = useMemo(function () {
      if (isCrewTab) {
        var ct = window.runningRankingCrewTab;
        return ct && ct.crewMetricUnit ? ct.crewMetricUnit(crewMetric) : 'pt';
      }
      var tabs = cfg().TABS || [];
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].id === activeTab) return tabs[i].unit || '';
      }
      return '';
    }, [activeTab, isCrewTab, crewMetric]);

    var listCategoryTitle = useMemo(function () {
      var titles = cfg().CATEGORY_TITLES || {};
      var labels = cfg().CATEGORY_LABELS || {};
      return titles[activeCategory]
        || ((labels[activeCategory] || activeCategory) + ' 순위');
    }, [activeCategory]);

    var initialLoading = loading && !rawRows.length;

    var CollapsibleList = window.RunningRankingCollapsibleList;
    var Row = window.RunningRankingRow;
    var listView = window.runningRankingListView || {};
    var skipListCollapse = isOverallTab && listFilter === 'interest';
    var gapScopeKey = listView.gapScopeKey
      ? listView.gapScopeKey(activeTab, activeCategory)
      : (activeTab + ':' + activeCategory);
    var listExpanded = !!(gapState[gapScopeKey] && gapState[gapScopeKey].expanded);

    function handleListExpandChange(nextExpanded) {
      setGapState(function (prev) {
        var next = Object.assign({}, prev);
        next[gapScopeKey] = Object.assign({}, prev[gapScopeKey] || {}, { expanded: !!nextExpanded });
        return next;
      });
    }

    var searchExpanded = skipListCollapse || listExpanded;

    useEffect(function () {
      if (loading) return;
      var rc = window.runningRankingRankChange;
      if (!rc || typeof rc.refreshListRankChangeSlots !== 'function') return;
      var bodyEl = document.getElementById('runningRankingListBody');
      if (!bodyEl || !rankedList.length) return;
      var cancelled = false;
      function runRefresh() {
        if (cancelled) return;
        rc.refreshListRankChangeSlots(bodyEl, rankedList, activeCategory, { retryIfMissing: true });
      }
      var t1 = setTimeout(function () {
        requestAnimationFrame(runRefresh);
      }, 80);
      var t2 = setTimeout(runRefresh, 280);
      var t3 = setTimeout(runRefresh, 720);
      return function () {
        cancelled = true;
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }, [rankedList, activeCategory, activeTab, socialVer, loading, listFilter, showOverallSegments, listExpanded]);

    useEffect(function () {
      if (typeof window.runningRankingSearchSetContext !== 'function') return;
      if (activeTab === 'crew') {
        window.runningRankingSearchSetContext(null);
        return;
      }
      var soc = socialApi();
      var api = dataApi();
      window.runningRankingSearchSetContext({
        arr: rankedList,
        currentUserId: currentUserId,
        isAdmin:
          typeof window.stelvioRankingViewerCanSeePrivateNames === 'function'
            ? window.stelvioRankingViewerCanSeePrivateNames()
            : typeof window.stelvioRankingLoginIsAdmin === 'function' && window.stelvioRankingLoginIsAdmin(),
        formatValue: soc.formatValueLabel
          ? function (item) { return soc.formatValueLabel(item); }
          : undefined,
        isPrivate: function (item) {
          if (item && item.isPrivate != null) return !!item.isPrivate;
          return api.isPrivateRow ? api.isPrivateRow(item) : false;
        },
        friendSet: typeof window.stelvioRankingFriendUserSet !== 'undefined' ? window.stelvioRankingFriendUserSet : null,
        groupContactSet:
          typeof window.stelvioRankingGroupContactSet !== 'undefined' ? window.stelvioRankingGroupContactSet : null
      });
    }, [rankedList, activeTab, currentUserId, socialVer]);

    useEffect(function () {
      if (typeof window.runningRankingSearchSetUiState !== 'function') return;
      var searchableTab = activeTab === 'overall' || activeTab === 'pace' || activeTab === 'tss' || activeTab === 'distance';
      window.runningRankingSearchSetUiState({
        enabled: searchableTab && rankedList.length > 0,
        expanded: searchableTab && searchExpanded && rankedList.length > 0,
        tab: activeTab
      });
      if (window._runningRankingSearchFab && typeof window._runningRankingSearchFab.update === 'function') {
        window._runningRankingSearchFab.update();
      }
    }, [searchExpanded, activeTab, rankedList.length, skipListCollapse, listExpanded]);

    var tabButtons = (cfg().TABS || []).map(function (t) {
      return React.createElement('button', {
        key: t.id,
        type: 'button',
        className: 'stelvio-duration-tab' + (activeTab === t.id ? ' active' : ''),
        onClick: function () {
          setActiveTab(t.id);
          if (t.id !== 'overall' && t.id !== 'crew') setListFilter('all');
        }
      }, t.label);
    });

    var paceChips = (activeTab === 'pace' || (isCrewTab && crewMetric === 'pace'))
      ? React.createElement('div', { className: 'stelvio-group-metric-filter running-ranking-pace-filter' },
          React.createElement('div', { className: 'stelvio-group-metric-chips' },
            (cfg().PACE_DISTANCES || []).map(function (d) {
              return React.createElement('button', {
                key: d.key,
                type: 'button',
                className: 'stelvio-group-metric-chip' + (paceDistance === d.key ? ' active' : ''),
                onClick: function () { setPaceDistance(d.key); }
              }, d.label);
            })
          )
        )
      : null;

    function findOptionLabel(options, value, fallback) {
      for (var i = 0; i < options.length; i++) {
        if (options[i].value === value) return options[i].label;
      }
      return fallback || '';
    }

    var genderSelect = React.createElement('div', { className: 'stelvio-gender-dropdown' },
          React.createElement('span', { className: 'stelvio-dropdown-caption' }, '성별'),
          React.createElement('span', { className: 'stelvio-dropdown-label' },
            findOptionLabel(cfg().GENDER_OPTIONS || [], gender, '전체')
          ),
          React.createElement('span', { className: 'stelvio-dropdown-chevron' }, '▾'),
          React.createElement('select', {
            className: 'stelvio-dropdown-select',
            value: gender,
            'aria-label': '성별 필터',
            onChange: function (e) { setGender(e.target.value); }
          },
            (cfg().GENDER_OPTIONS || []).map(function (g) {
              return React.createElement('option', { key: g.value, value: g.value }, g.label);
            })
          )
        );

    var categorySelect = React.createElement('div', { className: 'stelvio-category-dropdown' },
          React.createElement('span', { className: 'stelvio-dropdown-caption' }, '카테고리'),
          React.createElement('span', { className: 'stelvio-dropdown-label' },
            findOptionLabel(cfg().CATEGORY_OPTIONS || [], activeCategory, '전체')
          ),
          React.createElement('span', { className: 'stelvio-dropdown-chevron' }, '▾'),
          React.createElement('select', {
            className: 'stelvio-dropdown-select',
            value: activeCategory,
            'aria-label': '카테고리 필터',
            onChange: function (e) { setActiveCategory(e.target.value); }
          },
            (cfg().CATEGORY_OPTIONS || []).map(function (c) {
              return React.createElement('option', { key: c.value, value: c.value }, c.label);
            })
          )
        );

    var crewMetricSelect = isCrewTab
      ? React.createElement('div', { className: 'stelvio-metric-dropdown' },
          React.createElement('span', { className: 'stelvio-dropdown-caption' }, '항목'),
          React.createElement('span', { className: 'stelvio-dropdown-label' },
            findOptionLabel(cfg().CREW_METRIC_OPTIONS || [], crewMetric, '종합')
          ),
          React.createElement('span', { className: 'stelvio-dropdown-chevron' }, '▾'),
          React.createElement('select', {
            className: 'stelvio-dropdown-select',
            value: crewMetric,
            'aria-label': '크루 탭 항목 필터',
            onChange: function (e) { setCrewMetric(e.target.value); }
          },
            (cfg().CREW_METRIC_OPTIONS || []).map(function (m) {
              return React.createElement('option', { key: m.value, value: m.value }, m.label);
            })
          )
        )
      : null;

    var segmentToggle = isOverallTab
      ? React.createElement('button', {
          type: 'button',
          className: 'running-ranking-segment-toggle-btn',
          'aria-pressed': showOverallSegments,
          'aria-label': showOverallSegments ? '구간 페이스 접기' : '구간 페이스 펼치기',
          title: showOverallSegments ? '구간 페이스 접기' : '구간 페이스 펼치기',
          onClick: function () { setShowOverallSegments(function (prev) { return !prev; }); }
        }, showOverallSegments ? '▲' : '▼')
      : null;

    var listFilterToggle = (isOverallTab || isCrewTab)
      ? React.createElement('div', {
          className: 'stelvio-ranking-list-filter-toggle',
          role: 'group',
          'aria-label': '순위 목록 보기'
        },
          React.createElement('button', {
            type: 'button',
            className: 'stelvio-ranking-filter-chip' + (listFilter === 'all' ? ' stelvio-ranking-filter-chip--active' : ''),
            'aria-pressed': listFilter === 'all',
            onClick: function () { setListFilter('all'); }
          }, '전체'),
          React.createElement('button', {
            type: 'button',
            className: 'stelvio-ranking-filter-chip running-ranking-filter-chip--interest' +
              (listFilter === 'interest' ? ' stelvio-ranking-filter-chip--active' : ''),
            'aria-pressed': listFilter === 'interest',
            onClick: function () { setListFilter('interest'); }
          },
            '관심',
            React.createElement('span', { className: 'running-ranking-filter-star', 'aria-hidden': true }, '☆')
          )
        )
      : null;

    var listBody;
    if (initialLoading) {
      listBody = null;
    } else if (error && !rawRows.length) {
      listBody = React.createElement('div', { className: 'running-ranking-error' },
        React.createElement('p', { className: 'stelvio-ranking-empty' }, error),
        React.createElement('button', {
          type: 'button',
          className: 'stelvio-purple-btn running-ranking-retry-btn',
          onClick: function () { loadLeaderboard({ force: true }); }
        }, '다시 시도')
      );
    } else if (isCrewTab && !currentUserId) {
      listBody = React.createElement('p', { className: 'stelvio-ranking-empty' },
        '로그인 후 나의 크루(소모임) 랭킹을 확인할 수 있습니다.'
      );
    } else if (isCrewTab && window.RunningRankingCrewTab) {
      listBody = React.createElement(window.RunningRankingCrewTab, {
        groups: filteredCrewGroups,
        leaderboardRows: rawRows,
        currentUserId: currentUserId,
        viewerIdentity: viewerIdentity,
        gender: gender,
        category: activeCategory,
        crewMetric: crewMetric,
        paceDistance: paceDistance,
        listFilter: listFilter,
        socialVer: socialVer
      });
    } else if (isCrewTab) {
      listBody = React.createElement('p', { className: 'stelvio-ranking-empty' },
        '크루 목록을 불러올 수 없습니다.'
      );
    } else if (!rankedList.length) {
      listBody = React.createElement('p', { className: 'stelvio-ranking-empty' },
        listFilter === 'interest'
          ? '관심·친구·그룹멤버에 해당하는 랭킹이 없습니다.'
          : (activeTab === 'crew' ? '집계 가능한 크루가 없습니다.' : '해당 조건의 랭킹이 없습니다.')
      );
    } else if (CollapsibleList) {
      listBody = React.createElement(CollapsibleList, {
        items: rankedList,
        tabId: activeTab,
        currentUserId: currentUserId,
        viewerIdentity: viewerIdentity,
        myCrewIds: activeTab === 'crew' ? myCrewIds : null,
        listCategory: activeCategory,
        socialVer: socialVer,
        showSegments: showOverallSegments,
        skipCollapse: skipListCollapse,
        expanded: listExpanded,
        onExpandChange: handleListExpandChange,
        orphanViewerItem: orphanViewerItem
      });
    } else if (Row) {
      listBody = React.createElement('div', {
        className: 'running-ranking-plain-list',
        role: 'list',
        'aria-label': '러닝 랭킹 목록'
      },
        rankedList.map(function (item) {
          return React.createElement(Row, {
            key: (item.crewId || item.userId || '') + '-' + item.rank + '-' + socialVer + (showOverallSegments ? '-seg' : ''),
            item: item,
            tabId: activeTab,
            currentUserId: currentUserId,
            viewerIdentity: viewerIdentity,
            myCrewIds: activeTab === 'crew' ? myCrewIds : null,
            listCategory: activeCategory,
            showSegments: showOverallSegments,
            socialVer: socialVer
          });
        })
      );
    } else {
      listBody = null;
    }

    var movementHintText = leaderboardSource === 'live'
      ? '집계 대기 중 · 점수·순위는 실시간 미리보기입니다. 매일 23:00(KST) 집계 후 고정됩니다.'
      : (leaderboardAsOfSeoul
        ? ('점수·순위·등락은 매일 23:00(KST) 집계 기준 · 집계일 ' + leaderboardAsOfSeoul)
        : '점수·순위·등락은 매일 23:00(KST) 집계 후 고정·전일 대비로 표시됩니다.');

    var rootClass = 'running-ranking-body' +
      (isOverallTab ? ' running-ranking-body--overall' : '') +
      (isPaceTab ? ' running-ranking-body--pace' : '') +
      (isTssTab ? ' running-ranking-body--tss' : '') +
      (isDistanceTab ? ' running-ranking-body--distance' : '') +
      (initialLoading ? ' running-ranking-body--loading' : '');

    return React.createElement('div', { className: rootClass, id: 'running-ranking-react-root' },
      React.createElement('div', { className: 'stelvio-ranking-sticky running-ranking-sticky' },
        React.createElement('div', { className: 'stelvio-duration-chips-wrap' },
          React.createElement('div', { className: 'stelvio-duration-chips', role: 'tablist' }, tabButtons)
        ),
        paceChips,
        React.createElement('div', { className: 'stelvio-filter-bar-wrap running-ranking-filter-wrap' },
          React.createElement('div', { className: 'stelvio-filter-bar' },
            crewMetricSelect,
            genderSelect,
            categorySelect
          )
        ),
        stale && error
          ? React.createElement('p', { className: 'running-ranking-stale-hint' }, '캐시 표시 · ' + error)
          : null
      ),
      initialLoading
        ? React.createElement('div', {
            className: 'stelvio-ranking-loading running-ranking-entry-loading',
            role: 'status',
            'aria-live': 'polite',
            'aria-label': '랭킹 불러오는 중'
          },
            React.createElement('div', { className: 'stelvio-ranking-spinner' }),
            React.createElement('p', null, '랭킹 불러오는 중...')
          )
        : null,
      React.createElement('div', {
        className: 'stelvio-ranking-content running-ranking-content',
        style: initialLoading ? { opacity: 0.5 } : undefined
      },
        tabHeroPayload
          ? React.createElement('div', {
              className: 'stelvio-hero-card running-ranking-hero-card running-ranking-hero-card--list-top'
            },
              React.createElement('p', {
                className: 'stelvio-hero-text',
                dangerouslySetInnerHTML: { __html: tabHeroPayload.html }
              }),
              isOverallTab
                ? React.createElement('div', { className: 'stelvio-hero-expand-toggle-row' },
                    React.createElement('button', {
                      type: 'button',
                      className: 'stelvio-hero-expand-btn',
                      'aria-expanded': heroExpanded,
                      onClick: function () { setHeroExpanded(function (prev) { return !prev; }); }
                    },
                      React.createElement('span', { className: 'stelvio-hero-expand-btn-icon' }, heroExpanded ? '−' : '+'),
                      React.createElement('span', null, heroExpanded ? '접어보기' : '펼쳐보기')
                    )
                  )
                : null,
              isOverallTab
                ? React.createElement('div', {
                    className: 'stelvio-hero-expand-area' + (heroExpanded ? ' stelvio-hero-expand-area--open' : '')
                  },
                    heroExpanded && window.StelvioHexagonRanksCard
                      ? React.createElement(window.StelvioHexagonRanksCard, {
                          userProfile: heroUserProfile,
                          stats: (window.runDashboardData && window.runDashboardData.stats) || {},
                          leaderboardRows: rawRows,
                          initialGender: gender,
                          initialCategory: activeCategory,
                          embedded: true
                        })
                      : (heroExpanded && window.RunningHexagonRanksCard
                        ? React.createElement(window.RunningHexagonRanksCard, {
                            rows: rawRows,
                            gender: gender,
                            category: activeCategory
                          })
                        : null)
                  )
                : null
            )
          : null,
        React.createElement('div', {
          className: 'stelvio-category-card stelvio-ranking-list-card running-ranking-list-card' +
            (isOverallTab ? ' running-ranking-list-card--overall' : '')
        },
          React.createElement('div', { className: 'stelvio-category-header' },
            React.createElement('span', { className: 'stelvio-category-header-title' },
              isCrewTab ? '나의 크루' : listCategoryTitle,
              segmentToggle
            ),
            listFilterToggle,
            React.createElement('span', { className: 'stelvio-category-header-unit' }, unitLabel)
          ),
          React.createElement('div', {
            id: 'runningRankingListBody',
            className: 'stelvio-category-body running-ranking-list-body running-ranking-list-body--avatar-align running-ranking-list-body--overall' +
              (activeTab === 'distance' ? ' running-ranking-list-body--distance' : '') +
              (isOverallTab && showOverallSegments ? ' running-ranking-list-body--segments-on' : ' running-ranking-list-body--segments-off')
          }, listBody)
        ),
        isOverallTab ? React.createElement(RunningRankingStarLegend) : null,
        isOverallTab
          ? React.createElement('div', {
              id: RUN_DIST_CHART_ROOTS.overall,
              className: 'stelvio-distribution-chart-root running-ranking-distribution-chart-root',
              'aria-live': 'polite'
            })
          : null,
        isPaceTab
          ? React.createElement('div', {
              id: RUN_DIST_CHART_ROOTS.pace,
              className: 'stelvio-distribution-chart-root running-ranking-distribution-chart-root',
              'aria-live': 'polite'
            })
          : null,
        isTssTab
          ? React.createElement('div', {
              id: RUN_DIST_CHART_ROOTS.tss,
              className: 'stelvio-distribution-chart-root running-ranking-distribution-chart-root',
              'aria-live': 'polite'
            })
          : null,
        isDistanceTab
          ? React.createElement('div', {
              id: RUN_DIST_CHART_ROOTS.distance,
              className: 'stelvio-distribution-chart-root running-ranking-distribution-chart-root',
              'aria-live': 'polite'
            })
          : null,
        React.createElement('p', {
          className: 'running-ranking-movement-hint running-ranking-movement-hint--footer'
        }, movementHintText)
      )
    );
  }

  window.RunningRankingScreen = RunningRankingScreen;
})();
