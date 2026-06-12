/**
 * 러닝 랭킹보드 — 메인 화면 (5탭: 종합·페이스·TSS·거리·크루)
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

  function cfg() { return window.runningRankingConfig || {}; }
  function dataApi() { return window.runningRankingData || {}; }
  function fetchApi() { return window.runningRankingApi || {}; }

  function RunningRankingScreen() {
    var _tab = useState('overall');
    var activeTab = _tab[0];
    var setActiveTab = _tab[1];

    var _paceDist = useState('5k');
    var paceDistance = _paceDist[0];
    var setPaceDistance = _paceDist[1];

    var _gender = useState('all');
    var gender = _gender[0];
    var setGender = _gender[1];

    var _category = useState((cfg().DEFAULT_CATEGORY) || 'Supremo');
    var activeCategory = _category[0];
    var setActiveCategory = _category[1];

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

    var _leaderboardSource = useState('');
    var leaderboardSource = _leaderboardSource[0];
    var setLeaderboardSource = _leaderboardSource[1];

    var _leaderboardAsOf = useState('');
    var leaderboardAsOfSeoul = _leaderboardAsOf[0];
    var setLeaderboardAsOfSeoul = _leaderboardAsOf[1];

    var _socialVer = useState(0);
    var socialVer = _socialVer[0];
    var setSocialVer = _socialVer[1];

    var crewUnsubRef = useRef(null);

    var currentUserId = useMemo(function () {
      return dataApi().getCurrentUserId ? dataApi().getCurrentUserId() : null;
    }, [loading, rawRows.length]);

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
            setCrewGroups(rows && rows.length ? rows.slice() : []);
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
      if (activeTab !== 'crew' || !crewGroups.length) {
        setCrewEnriched([]);
        return;
      }
      var crewMod = window.runningRankingCrew;
      if (!crewMod || typeof crewMod.enrichGroupsWithMemberIds !== 'function') {
        setCrewEnriched(crewGroups);
        return;
      }
      var cancelled = false;
      crewMod.enrichGroupsWithMemberIds(crewGroups).then(function (enriched) {
        if (!cancelled) setCrewEnriched(enriched || []);
      });
      return function () { cancelled = true; };
    }, [activeTab, crewGroups]);

    useEffect(function () {
      loadLeaderboard({});
      subscribeCrewGroups();
      var socialMod = window.runningRankingSocial;
      if (socialMod) {
        if (typeof socialMod.ensureUiListeners === 'function') socialMod.ensureUiListeners();
        if (typeof socialMod.bootstrapSocial === 'function') {
          socialMod.bootstrapSocial().then(function () {
            setSocialVer(function (v) { return v + 1; });
            if (typeof socialMod.refreshStarSlots === 'function') socialMod.refreshStarSlots();
          }).catch(function () {});
        }
      }
      return function () {
        if (crewUnsubRef.current) {
          try { crewUnsubRef.current(); } catch (e) {}
        }
      };
    }, [loadLeaderboard, subscribeCrewGroups]);

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
    }, [gender, activeCategory, activeTab, paceDistance]);

    var rankedList = useMemo(function () {
      var list;
      if (activeTab === 'crew') {
        list = dataApi().buildCrewRankedList
          ? dataApi().buildCrewRankedList(rawRows, crewEnriched.length ? crewEnriched : crewGroups)
          : [];
      } else {
        list = dataApi().buildRankedList
          ? dataApi().buildRankedList(rawRows, activeTab, {
            paceDistance: paceDistance,
            gender: gender,
            category: activeCategory
          })
          : [];
      }
      var moveMod = window.runningRankingMovement;
      if (moveMod && typeof moveMod.applyRankMovement === 'function') {
        moveMod.applyRankMovement(list, activeTab, {
          paceDistance: paceDistance,
          gender: gender,
          category: activeCategory
        }, rankMovementByKey);
      }
      return list;
    }, [rawRows, activeTab, paceDistance, gender, activeCategory, crewGroups, crewEnriched, socialVer, rankMovementByKey]);

    var unitLabel = useMemo(function () {
      var tabs = cfg().TABS || [];
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].id === activeTab) return tabs[i].unit || '';
      }
      return '';
    }, [activeTab]);

    var listCategoryTitle = useMemo(function () {
      var titles = cfg().CATEGORY_TITLES || {};
      var labels = cfg().CATEGORY_LABELS || {};
      return titles[activeCategory]
        || ((labels[activeCategory] || activeCategory) + ' 순위');
    }, [activeCategory]);

    var rowHeight = activeTab === 'overall'
      ? (cfg().LIST_ROW_HEIGHT_OVERALL || 78)
      : (cfg().LIST_ROW_HEIGHT || 56);

    var listKey = activeTab + '-' + paceDistance + '-' + gender + '-' + activeCategory;

    var Skeleton = window.RunningRankingSkeleton;
    var VirtualList = window.RunningRankingVirtualList;

    var tabButtons = (cfg().TABS || []).map(function (t) {
      return React.createElement('button', {
        key: t.id,
        type: 'button',
        className: 'stelvio-duration-tab' + (activeTab === t.id ? ' active' : ''),
        onClick: function () { setActiveTab(t.id); }
      }, t.label);
    });

    var paceChips = activeTab === 'pace'
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

    var genderSelect = activeTab !== 'crew'
      ? React.createElement('div', { className: 'stelvio-gender-dropdown' },
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
        )
      : null;

    var categorySelect = activeTab !== 'crew'
      ? React.createElement('div', { className: 'stelvio-category-dropdown' },
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
        )
      : null;

    var listBody;
    if (loading && !rawRows.length) {
      listBody = Skeleton
        ? React.createElement(Skeleton, { message: '랭킹 불러오는 중...' })
        : React.createElement('p', { className: 'stelvio-ranking-empty' }, '불러오는 중...');
    } else if (error && !rawRows.length) {
      listBody = React.createElement('div', { className: 'running-ranking-error' },
        React.createElement('p', { className: 'stelvio-ranking-empty' }, error),
        React.createElement('button', {
          type: 'button',
          className: 'stelvio-purple-btn running-ranking-retry-btn',
          onClick: function () { loadLeaderboard({ force: true }); }
        }, '다시 시도')
      );
    } else if (activeTab === 'crew' && !currentUserId) {
      listBody = React.createElement('p', { className: 'stelvio-ranking-empty' },
        '로그인 후 나의 크루(소모임) 랭킹을 확인할 수 있습니다.'
      );
    } else if (activeTab === 'crew' && !crewGroups.length) {
      listBody = React.createElement('p', { className: 'stelvio-ranking-empty stelvio-ranking-empty--group' },
        '가입된 승인 소모임이 없습니다.',
        React.createElement('br'),
        '라이딩 모임에서 그룹(소모임)에 가입해 보세요.'
      );
    } else {
      listBody = VirtualList
        ? React.createElement(VirtualList, {
            items: rankedList,
            tabId: activeTab,
            currentUserId: currentUserId,
            rowHeight: rowHeight,
            listKey: listKey,
            socialVer: socialVer,
            emptyMessage: activeTab === 'crew' ? '집계 가능한 크루가 없습니다.' : '해당 조건의 랭킹이 없습니다.'
          })
        : null;
    }

    return React.createElement('div', { className: 'running-ranking-body', id: 'running-ranking-react-root' },
      React.createElement('div', { className: 'stelvio-ranking-sticky running-ranking-sticky' },
        React.createElement('div', { className: 'stelvio-duration-chips-wrap' },
          React.createElement('div', { className: 'stelvio-duration-chips', role: 'tablist' }, tabButtons)
        ),
        paceChips,
        activeTab !== 'crew'
          ? React.createElement('div', { className: 'stelvio-filter-bar-wrap' },
              React.createElement('div', { className: 'stelvio-filter-bar' }, genderSelect, categorySelect)
            )
          : null,
        stale && error
          ? React.createElement('p', { className: 'running-ranking-stale-hint' }, '캐시 표시 · ' + error)
          : null,
        React.createElement('p', { className: 'running-ranking-movement-hint' },
          leaderboardSource === 'live'
            ? '집계 대기 중 · 점수·순위는 실시간 미리보기입니다. 매일 23:00(KST) 집계 후 고정됩니다.'
            : (leaderboardAsOfSeoul
              ? ('점수·순위·등락은 매일 23:00(KST) 집계 기준 · 집계일 ' + leaderboardAsOfSeoul)
              : '점수·순위·등락은 매일 23:00(KST) 집계 후 고정·전일 대비로 표시됩니다.')
        )
      ),
      React.createElement('div', { className: 'stelvio-ranking-content running-ranking-content' },
        React.createElement('div', { className: 'stelvio-category-card stelvio-ranking-list-card running-ranking-list-card' },
          React.createElement('div', { className: 'stelvio-category-header' },
            React.createElement('span', { className: 'stelvio-category-header-title' },
              activeTab === 'crew'
                ? '크루 랭킹'
                : listCategoryTitle
            ),
            React.createElement('span', { className: 'stelvio-category-header-unit' }, unitLabel)
          ),
          React.createElement('div', { className: 'stelvio-category-body running-ranking-list-body' }, listBody)
        )
      )
    );
  }

  window.RunningRankingScreen = RunningRankingScreen;
})();
