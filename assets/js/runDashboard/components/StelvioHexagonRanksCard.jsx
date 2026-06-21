/**
 * STELVIO 헥사곤(6축 레벨 포지션) — RUN 대시보드 성장 추이
 * 축: 1k · 3k · 5k · 7k · 10k · 20k
 * 순위·등락: 랭킹보드 구간·종합 탭과 동일 (최근 90일 peak + 집계 스냅샷)
 */
/* global React, useState, useEffect, useMemo, window */
(function() {
  'use strict';
  if (!window.React) return;
  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  var RUN_AXES = [
    { key: '1k', label: '1k' },
    { key: '3k', label: '3k' },
    { key: '5k', label: '5k' },
    { key: '7k', label: '7k' },
    { key: '10k', label: '10k' },
    { key: '20k', label: '20k' }
  ];
  var N_AXES = RUN_AXES.length;

  var GENDER_OPTIONS = [
    { value: 'all', label: '전체' },
    { value: 'M', label: '남성' },
    { value: 'F', label: '여성' }
  ];
  var CATEGORY_OPTIONS = [
    { value: 'Supremo', label: '전체' },
    { value: 'Assoluto', label: '선수부' },
    { value: 'Bianco', label: '30대 이하' },
    { value: 'Rosa', label: '40대' },
    { value: 'Infinito', label: '50대' },
    { value: 'Leggenda', label: '60대 이상' }
  ];

  var HEPTAGON_TIER_FACE_HEX = {
    HC: '#8B5CF6',
    C1: '#EF4444',
    C2: '#F97316',
    C3: '#EAB308',
    C4: '#22C55E',
    C5: '#3B82F6',
    C6: '#9CA3AF'
  };
  var HEPTAGON_CARD_TIER_LEGEND_IDS = ['HC', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

  function labelForGender(v) {
    for (var i = 0; i < GENDER_OPTIONS.length; i++) {
      if (GENDER_OPTIONS[i].value === v) return GENDER_OPTIONS[i].label;
    }
    return '전체';
  }
  function labelForCategory(v) {
    for (var j = 0; j < CATEGORY_OPTIONS.length; j++) {
      if (CATEGORY_OPTIONS[j].value === v) return CATEGORY_OPTIONS[j].label;
    }
    return '전체';
  }

  function categoryValueMatchingUserAge(userProfile) {
    if (!userProfile || userProfile.ageCategory == null) return null;
    var ac = String(userProfile.ageCategory).trim();
    if (!ac) return null;
    for (var ci = 0; ci < CATEGORY_OPTIONS.length; ci++) {
      if (CATEGORY_OPTIONS[ci].value === ac) return ac;
    }
    return null;
  }

  function axisAngle(i, n) {
    return -Math.PI / 2 + (i * 2 * Math.PI) / n;
  }

  function radarPolygonPoints(ratioArr, cx, cy, rMax) {
    var n = ratioArr && ratioArr.length ? ratioArr.length : 0;
    var pts = [];
    var i;
    for (i = 0; i < n; i++) {
      var t = axisAngle(i, n);
      var ri = (ratioArr[i] != null ? ratioArr[i] : 0.1) * rMax;
      pts.push([cx + ri * Math.cos(t), cy + ri * Math.sin(t)]);
    }
    return pts;
  }

  function pathFromPoints(pts) {
    if (!pts.length) return '';
    var s = 'M ' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    var j;
    for (j = 1; j < pts.length; j++) {
      s += ' L ' + pts[j][0].toFixed(2) + ' ' + pts[j][1].toFixed(2);
    }
    return s + ' Z';
  }

  function rankToNorm(rank, nRef) {
    if (rank == null || !isFinite(rank) || rank < 1) return 0.08;
    var rr = Math.floor(Number(rank));
    if (rr < 1) rr = 1;
    if (rr > nRef) rr = nRef;
    var norm = (nRef - rr + 1) / nRef;
    if (norm > 0.99) norm = 0.99;
    if (norm < 0.08) norm = 0.08;
    return norm;
  }

  /** 종합 순위 ÷ n × 100 (1위/42 → 2.38%) — 랭킹보드 rankToTopSharePercent와 동일 */
  function formatRankTopSharePercent(overallRank, nCohort) {
    if (overallRank == null || !isFinite(overallRank)) return null;
    var nn = nCohort != null ? Math.floor(Number(nCohort)) : 0;
    if (nn < 1) return null;
    var dataApi = window.runningRankingData;
    if (dataApi && typeof dataApi.rankToTopSharePercent === 'function') {
      return dataApi.rankToTopSharePercent(overallRank, nn);
    }
    var r = Math.max(1, Math.min(nn, Math.floor(Number(overallRank))));
    return Math.round((r / nn) * 10000) / 100;
  }

  function heptagonCardTierLegendCaption(tierId) {
    var m = { HC: '~5%', C1: '~10%', C2: '~20%', C3: '~40%', C4: '~60%', C5: '~80%', C6: '~100%' };
    return m[tierId] || m.C6;
  }

  function resolveTierBadge(stats) {
    if (window.runDashboardPace && typeof window.runDashboardPace.resolveRunHexagonTierBadge === 'function') {
      return window.runDashboardPace.resolveRunHexagonTierBadge(stats);
    }
    return { badgeSrc: 'assets/img/G.svg', levelName: '등급', unavailable: true };
  }

  /** 랭킹보드 펼쳐보기 — 대시보드와 동일하게 peak_performances에서 역치·등급 배지 산출 */
  function resolveHexagonStatsFromLeaderboard(rows, userProfile, baseStats) {
    var pace = window.runDashboardPace;
    if (!pace || !rows || !rows.length || typeof pace.computeThresholdPaceFromPeaks !== 'function') {
      return baseStats || {};
    }
    var row = null;
    if (userProfile && userProfile.id != null && typeof pace.findLeaderboardRowForUser === 'function') {
      row = pace.findLeaderboardRowForUser(rows, userProfile.id);
    }
    if (!row) {
      var dataApi = window.runningRankingData;
      if (dataApi && typeof dataApi.getViewerIdentity === 'function' && typeof dataApi.rowUserId === 'function') {
        var identity = dataApi.getViewerIdentity(rows);
        var i;
        for (i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (identity.boardUserId && String(dataApi.rowUserId(r)) === String(identity.boardUserId)) {
            row = r;
            break;
          }
        }
      }
    }
    if (!row) return baseStats || {};

    var thresholdPace = pace.computeThresholdPaceFromPeaks(row.peak_performances);
    if (row.profile_peak_performances) {
      var profilePace = pace.computeThresholdPaceFromPeaks(row.profile_peak_performances);
      if (
        profilePace &&
        profilePace.secPerKm != null &&
        (thresholdPace.secPerKm == null || profilePace.secPerKm < thresholdPace.secPerKm)
      ) {
        thresholdPace = profilePace;
      }
    }
    var tier = thresholdPace.hexagonTier;
    return Object.assign({}, baseStats || {}, {
      thresholdPaceSec: thresholdPace.secPerKm,
      thresholdPaceDisplay: thresholdPace.display || thresholdPace.paceValue,
      thresholdPaceValue: thresholdPace.paceValue,
      thresholdPaceUnavailable: thresholdPace.unavailable,
      hexagonTierId: tier ? tier.tierId : null,
      hexagonTierLevelName: tier ? tier.levelName : null,
      hexagonTierBadgeSrc: tier ? tier.badgeSrc : null
    });
  }

  function tierLevelDisplayName(tierId) {
    var m = { HC: '레벨A', C1: '레벨B', C2: '레벨C', C3: '레벨D', C4: '레벨E', C5: '레벨F', C6: '레벨G' };
    return m[tierId] || '레벨G';
  }

  function levelBarFadedEmptyBackground(tierBgCss) {
    var s = tierBgCss != null ? String(tierBgCss).replace(/\s/g, '') : '';
    var m =
      /^rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)$/i.exec(s) ||
      /^rgb\(([\d.]+),([\d.]+),([\d.]+)\)$/i.exec(s);
    if (m) {
      var aa = m[4] != null ? parseFloat(m[4]) : 1;
      if (!isFinite(aa)) aa = 1;
      aa = Math.min(1, Math.max(0, aa * 0.5));
      return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + aa.toFixed(3) + ')';
    }
    return tierBgCss;
  }

  var HEXAGON_AXIS_RANK_CHANGE_FILL = {
    up: '#c97070',
    down: '#7a9fbf',
    flat: '#9ca3af'
  };

  function RankChangeInline(props) {
    var suffix = props.suffix;
    if (!suffix || !suffix.text) return null;
    return (
      <span
        className={'stelvio-rank-change stelvio-rank-change--' + suffix.kind}
        style={{ fontSize: 'inherit', fontWeight: 600 }}
        title={suffix.title}
      >
        {suffix.text}
      </span>
    );
  }

  function RunHexagonCenterOverlay(props) {
    var badge = props.badge || {};
    var hexState = props.hexState || {};
    var showPct = props.showPct === true;
    var filterGenderLabel = props.filterGenderLabel || '';
    var filterCategoryLabel = props.filterCategoryLabel || '';
    var overallRank = hexState.overallRank;
    var overallSuffix = hexState.overallRankChangeSuffix;
    var nCohort = hexState.overallCohortN;
    var rankSharePct = formatRankTopSharePercent(overallRank, nCohort);
    var _imgErr = useState(false);
    var imgError = _imgErr[0];
    var setImgError = _imgErr[1];

    useEffect(function() {
      setImgError(false);
    }, [badge.badgeSrc]);

    var filterContext =
      filterGenderLabel && filterCategoryLabel
        ? '성별: ' + filterGenderLabel + ', 부문: ' + filterCategoryLabel + ' — '
        : '';

    return (
      <div className="stelvio-octagon-tier-wrap" aria-hidden={false}>
        <div className="stelvio-octagon-tier-inner stelvio-octagon-tier-inner--img">
          <div className="stelvio-octagon-tier-btn-stack">
            <div className="stelvio-octagon-tier-btn stelvio-octagon-tier-btn--image">
              {!imgError ? (
                <img
                  src={badge.badgeSrc}
                  alt={badge.levelName || '등급'}
                  className={'stelvio-octagon-tier-badge-img' + (badge.unavailable ? ' opacity-50' : '')}
                  onError={function() { setImgError(true); }}
                  decoding="async"
                  draggable={false}
                />
              ) : (
                <span className="stelvio-octagon-tier-fallback stelvio-octagon-tier-btn--c6">G</span>
              )}
            </div>
          </div>
          <div className="stelvio-octagon-tier-gc" aria-label={'종합 순위 ' + (overallRank != null ? overallRank + '위' : '없음')}>
            <span className="stelvio-octagon-tier-gc__pill inline-flex items-baseline gap-1 rounded-full border border-slate-200/90 bg-white/90 px-2 py-0.5 text-[10px] text-slate-700 shadow-sm whitespace-nowrap">
              <span className="font-bold tracking-tight text-violet-800">종합</span>
              <span className="tabular-nums text-slate-600">
                {overallRank != null ? overallRank + '위' : '—'}
                <RankChangeInline suffix={overallSuffix} />
              </span>
            </span>
          </div>
          <div
            className={
              'stelvio-octagon-tier-hint ' +
              (overallRank != null ? 'stelvio-octagon-tier-hint--split ' : '') +
              (showPct ? 'stelvio-octagon-tier-hint--visible' : '')
            }
            role="status"
          >
            {overallRank != null ? (
              <span className="stelvio-octagon-tier-hint-split stelvio-octagon-tier-hint-split--cohort" title={filterContext + '종합 랭킹 집계 모수 n'}>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-rank">
                  {String(overallRank) + '위'}
                  <RankChangeInline suffix={overallSuffix} />
                </span>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-nref">
                  n={nCohort != null && nCohort > 0 ? String(nCohort) : '—'}
                </span>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-pct">
                  {rankSharePct != null && isFinite(rankSharePct) ? Number(rankSharePct).toFixed(2) : '—'}%
                </span>
              </span>
            ) : (
              <span className="stelvio-octagon-tier-hint-pending" title="종합 랭킹 데이터 없음">
                — · — · —
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function RunHexagonLevelPillSidebar(props) {
    var bar = props.bar || {};
    var hexState = props.hexState || {};
    var showPct = props.showPct;
    var setShowPct = props.setShowPct;
    var filterGenderLabel = props.filterGenderLabel || '';
    var filterCategoryLabel = props.filterCategoryLabel || '';
    var levelName = bar.levelName || tierLevelDisplayName(bar.tierId || 'C6');
    var overallRank = hexState.overallRank;
    var nCohort = hexState.overallCohortN;
    var rankSharePct = formatRankTopSharePercent(overallRank, nCohort);
    var filterContext =
      filterGenderLabel && filterCategoryLabel
        ? '성별: ' + filterGenderLabel + ', 부문: ' + filterCategoryLabel + ' — '
        : '';

    return (
      <button
        type="button"
        className="stelvio-octagon-tier-btn stelvio-octagon-tier-btn--leveltag stelvio-octagon-tier-btn--leveltag-sidebar"
        aria-pressed={showPct}
        aria-label={
          filterContext +
          (overallRank != null
            ? levelName + ', 종합 ' + String(overallRank) + '위, n=' + (nCohort || '—') + ', ' + (rankSharePct != null && isFinite(rankSharePct) ? Number(rankSharePct).toFixed(2) : '—') + '%. '
            : levelName + ', 종합 순위 로딩 후 표시. ') + '클릭: 툴팁'
        }
        title={filterContext + '종합 순위·n·순위/n×100% — 클릭: 힌트'}
        onClick={function(e) {
          e.stopPropagation();
          setShowPct(!showPct);
        }}
      >
        <span className="stelvio-octagon-tier-level-name stelvio-octagon-tier-level-name--sidebar-neon">{levelName}</span>
      </button>
    );
  }

  function RunPaceLevelProgressBar(props) {
    var bar = props.bar || {};
    var stepTarget = bar.step != null ? (bar.step | 0) : 0;
    var color = bar.color || HEPTAGON_TIER_FACE_HEX.C6;
    var bg = bar.bg || 'rgba(156,163,175,0.25)';
    var tierId = bar.tierId || 'C6';

    var _animF = useState(0);
    var animFilled = _animF[0];
    var setAnimFilled = _animF[1];
    var _blinkBi = useState(null);
    var blinkBi = _blinkBi[0];
    var setBlinkBi = _blinkBi[1];
    var barAnimTimerRef = React.useRef(null);
    var barBlinkClearRef = React.useRef(null);

    useEffect(function() {
      if (barAnimTimerRef.current != null) {
        clearInterval(barAnimTimerRef.current);
        barAnimTimerRef.current = null;
      }
      if (barBlinkClearRef.current != null) {
        clearTimeout(barBlinkClearRef.current);
        barBlinkClearRef.current = null;
      }
      setBlinkBi(null);
      var targetStep = stepTarget | 0;
      setAnimFilled(0);
      if (targetStep < 1) return undefined;
      var tick = 0;
      barAnimTimerRef.current = window.setInterval(function() {
        tick += 1;
        if (tick <= targetStep) setAnimFilled(tick);
        if (tick >= targetStep) {
          if (barAnimTimerRef.current != null) {
            clearInterval(barAnimTimerRef.current);
            barAnimTimerRef.current = null;
          }
          var topBiLast = 10 - targetStep;
          setBlinkBi(topBiLast);
          barBlinkClearRef.current = window.setTimeout(function() {
            setBlinkBi(null);
            barBlinkClearRef.current = null;
          }, 1580);
        }
      }, 220);
      return function() {
        if (barAnimTimerRef.current != null) clearInterval(barAnimTimerRef.current);
        if (barBlinkClearRef.current != null) clearTimeout(barBlinkClearRef.current);
      };
    }, [stepTarget, tierId]);

    var blocks = [];
    var bi;
    for (bi = 0; bi < 10; bi++) {
      /* bi=0 최상단, bi=9 최하단 — 아래부터 채움 */
      var filled = bi >= (10 - animFilled);
      var blockOpacity = filled ? (0.5 + ((9 - bi) / 9) * 0.5) : 1;
      var blinkOn = blinkBi === bi && filled;
      var fillDelay = filled ? String((9 - bi) * 28) + 'ms' : '0s';
      blocks.push(
        <div
          key={'lv-' + bi}
          className={blinkOn ? 'stelvio-level-bar-cell stelvio-level-bar-cell--blink' : 'stelvio-level-bar-cell'}
          style={{
            width: '28px',
            height: '18px',
            borderRadius: '4px',
            background: filled ? color : levelBarFadedEmptyBackground(bg),
            border: filled ? '1px solid ' + color : '1px solid rgba(148,163,184,0.19)',
            opacity: blockOpacity,
            transition: blinkOn ? 'none' : 'background 0.28s ease, border-color 0.28s ease, opacity 0.28s ease',
            transitionDelay: blinkOn ? '0s' : fillDelay
          }}
        />
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '38px', minHeight: '260px', paddingTop: '4px', paddingBottom: '4px', gap: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, justifyContent: 'center' }}>
          {blocks}
        </div>
        <div style={{ fontSize: '9px', color: '#334155', marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
          {animFilled}<span style={{ opacity: 0.6 }}>/10</span>
        </div>
      </div>
    );
  }

  function RunHexagonHorizontalBar(props) {
    var topShare = props.topSharePercent != null && isFinite(props.topSharePercent) ? Number(props.topSharePercent) : 0;
    var tierId = props.tierId || 'C6';
    var tierHex = HEPTAGON_TIER_FACE_HEX[tierId] || HEPTAGON_TIER_FACE_HEX.C6;
    /* 좌측 topShare% 비움 · 나머지 우측 끝까지 채움 (1위/39 → 좌 2.56% + 채움 97.44%) */
    var emptyLeftPct = Math.max(0, Math.min(100, topShare));
    var fillWidthPct = Math.max(0, 100 - emptyLeftPct);
    var gradient = 'linear-gradient(to right, ' + tierHex + ' 0%, #ffffff 100%)';

    return (
      <div
        className="stelvio-heptagon-tier-hbar mx-auto mt-1 w-full max-w-xl px-1"
        role="img"
        aria-label={'종합 상위 ' + emptyLeftPct.toFixed(2) + '% · 채움 ' + fillWidthPct.toFixed(2) + '%'}
      >
        <div className="relative w-full overflow-hidden rounded-md border border-slate-200/85 shadow-inner h-[2.125rem] sm:h-[2.25rem]">
          <div className="pointer-events-none absolute inset-0 bg-slate-100/90 z-0" aria-hidden />
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-[1] rounded-r-sm transition-[left,width] duration-500 ease-out"
            style={{
              left: String(emptyLeftPct) + '%',
              width: String(fillWidthPct) + '%',
              background: gradient
            }}
          />
          <div className="relative z-[2] flex h-full w-full min-h-0">
            {HEPTAGON_CARD_TIER_LEGEND_IDS.map(function(tidCap) {
              return (
                <div
                  key={'hbar-seg-' + tidCap}
                  className="flex min-w-0 flex-1 items-center justify-end border-r border-slate-400/55 pl-0.5 pr-0.5 sm:pr-1 last:border-r-0"
                >
                  <span className="tabular-nums text-[9.6px] sm:text-[10.8px] font-medium leading-none text-slate-800 [text-shadow:0_0_6px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.9)]">
                    {heptagonCardTierLegendCaption(tidCap)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function StelvioHexagonRanksCard(props) {
    var p = props || {};
    var userProfile = p.userProfile;
    var stats = p.stats || {};
    var seedLeaderboardRows = Array.isArray(p.leaderboardRows) ? p.leaderboardRows : null;
    var DashboardCard = p.DashboardCard;
    var embedded = !!p.embedded;
    var uid = userProfile && userProfile.id != null ? String(userProfile.id) : null;
    var hexSvgInstanceRef = useRef(null);
    if (!hexSvgInstanceRef.current) {
      hexSvgInstanceRef.current =
        'hx' + String(Date.now().toString(36)) + Math.random().toString(36).slice(2, 8);
    }

    var _g = useState(p.initialGender || 'all');
    var gender = _g[0];
    var setGender = _g[1];
    var _c = useState(p.initialCategory || 'Supremo');
    var category = _c[0];
    var setCategory = _c[1];

    useEffect(function () {
      if (p.initialGender) setGender(p.initialGender);
    }, [p.initialGender]);

    useEffect(function () {
      if (p.initialCategory) setCategory(p.initialCategory);
    }, [p.initialCategory]);

    var _tierPctHint = useState(false);
    var tierPctHintOpen = _tierPctHint[0];
    var setTierPctHintOpen = _tierPctHint[1];

    var _lb = useState({ loading: true, err: null, rows: [], rankMovementByKey: {}, rankMovementSource: '', leaderboardAsOfSeoul: '', rankMovementAsOfSeoul: '' });
    var lbState = _lb[0];
    var setLbState = _lb[1];

    useEffect(function() {
      var api = window.runningRankingApi;
      if (!api) {
        setLbState({ loading: false, err: 'api', rows: [], rankMovementByKey: {}, rankMovementSource: '', leaderboardAsOfSeoul: '', rankMovementAsOfSeoul: '' });
        return;
      }
      var cancelled = false;
      function applyRes(res) {
        if (cancelled) return;
        if (!res || !res.success) {
          setLbState({
            loading: false,
            err: (res && res.error) || 'fetch',
            rows: [],
            rankMovementByKey: {},
            rankMovementSource: '',
            leaderboardAsOfSeoul: '',
            rankMovementAsOfSeoul: ''
          });
          return;
        }
        setLbState({
          loading: false,
          err: null,
          rows: res.rows || [],
          rankMovementByKey: res.rankMovementByKey || {},
          rankMovementSource: res.rankMovementSource || '',
          leaderboardAsOfSeoul: res.leaderboardAsOfSeoul || '',
          rankMovementAsOfSeoul: res.rankMovementAsOfSeoul || ''
        });
      }
      var cachedSnap = typeof api.getCachedSnapshot === 'function' ? api.getCachedSnapshot() : null;
      var cached = seedLeaderboardRows && seedLeaderboardRows.length
        ? {
            rows: seedLeaderboardRows,
            rankMovementByKey: (cachedSnap && cachedSnap.rankMovementByKey) || {},
            rankMovementSource: (cachedSnap && cachedSnap.rankMovementSource) || '',
            leaderboardAsOfSeoul: (cachedSnap && cachedSnap.leaderboardAsOfSeoul) || '',
            rankMovementAsOfSeoul: (cachedSnap && cachedSnap.rankMovementAsOfSeoul) || ''
          }
        : (cachedSnap && cachedSnap.rows && cachedSnap.rows.length
          ? cachedSnap
          : (typeof api.getCachedRows === 'function' && api.getCachedRows().length
            ? { rows: api.getCachedRows(), rankMovementByKey: {}, rankMovementSource: '', leaderboardAsOfSeoul: '', rankMovementAsOfSeoul: '' }
            : null));
      if (cached && cached.rows && cached.rows.length) {
        setLbState({
          loading: true,
          err: null,
          rows: cached.rows,
          rankMovementByKey: cached.rankMovementByKey || {},
          rankMovementSource: cached.rankMovementSource || '',
          leaderboardAsOfSeoul: cached.leaderboardAsOfSeoul || '',
          rankMovementAsOfSeoul: cached.rankMovementAsOfSeoul || ''
        });
      } else {
        setLbState(function(prev) {
          return Object.assign({}, prev, { loading: true, err: null });
        });
      }
      var fetchP = typeof api.fetchLeaderboard === 'function' ? api.fetchLeaderboard({}) : Promise.resolve({ success: false });
      fetchP.then(applyRes).catch(function() {
        if (!cancelled) {
          setLbState(function(prev) {
            return Object.assign({}, prev, { loading: false, err: 'fetch' });
          });
        }
      });
      return function() { cancelled = true; };
    }, [gender, category, seedLeaderboardRows]);

    var effectiveStats = useMemo(function() {
      if (stats && stats.hexagonTierBadgeSrc) return stats;
      if (stats && stats.thresholdPaceSec != null && Number(stats.thresholdPaceSec) > 0) return stats;
      var rows = (lbState.rows && lbState.rows.length)
        ? lbState.rows
        : (seedLeaderboardRows && seedLeaderboardRows.length ? seedLeaderboardRows : []);
      return resolveHexagonStatsFromLeaderboard(rows, userProfile, stats);
    }, [stats, lbState.rows, seedLeaderboardRows, userProfile]);

    var hexState = useMemo(function() {
      var dataApi = window.runningRankingData;
      if (!dataApi || typeof dataApi.buildRunDashboardHexagonState !== 'function') return null;
      if (!lbState.rows || !lbState.rows.length) return null;
      return dataApi.buildRunDashboardHexagonState(lbState.rows, {
        gender: gender,
        category: category,
        rankMovementByKey: lbState.rankMovementByKey,
        rankMovementSource: lbState.rankMovementSource,
        leaderboardAsOfSeoul: lbState.leaderboardAsOfSeoul,
        rankMovementAsOfSeoul: lbState.rankMovementAsOfSeoul
      });
    }, [lbState.rows, lbState.rankMovementByKey, lbState.rankMovementSource, lbState.leaderboardAsOfSeoul, lbState.rankMovementAsOfSeoul, gender, category]);

    var tierBadge = useMemo(function() {
      return resolveTierBadge(effectiveStats);
    }, [effectiveStats]);

    var paceLevelBar = useMemo(function() {
      var sec = effectiveStats.thresholdPaceSec != null ? Number(effectiveStats.thresholdPaceSec) : null;
      if (window.runDashboardPace && typeof window.runDashboardPace.computeRunPaceLevelBarStep === 'function') {
        return window.runDashboardPace.computeRunPaceLevelBarStep(sec);
      }
      return { tierId: 'C6', step: 0, color: HEPTAGON_TIER_FACE_HEX.C6, bg: 'rgba(156,163,175,0.25)' };
    }, [effectiveStats.thresholdPaceSec]);

    var svg = useMemo(function() {
      if (!hexState || !hexState.axes || !hexState.axes.length) return null;
      var cx = 100;
      var cy = 100;
      var rLabel = 88;
      var rMax = 70;
      var nRef = hexState.nRef < 1 ? 1 : hexState.nRef;
      var rankNorms = [];
      var i;
      for (i = 0; i < N_AXES; i++) {
        var ax = hexState.axes[i];
        rankNorms.push(rankToNorm(ax && ax.rank, nRef));
      }
      var mPts = pathFromPoints(radarPolygonPoints(rankNorms, cx, cy, rMax));
      var grid = [0.25, 0.5, 0.75, 1].map(function(g) {
        var gr = [];
        var gi;
        for (gi = 0; gi < N_AXES; gi++) gr.push(g);
        return pathFromPoints(radarPolygonPoints(gr, cx, cy, rMax));
      });
      var uidSafe = String(hexState.userId || 'run').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      var fillGradId =
        'run-hex-fill-rad-' + (uidSafe || 'def') + '-' + String(hexSvgInstanceRef.current || 'inst');

      return (
        <svg
          viewBox="0 0 200 200"
          className="w-full h-[260px] touch-manipulation stelvio-run-hexagon-radar-svg"
          role="img"
          aria-label="RUN 구간별 페이스 6축 헥사곤"
        >
          <defs>
            <radialGradient
              id={fillGradId}
              gradientUnits="userSpaceOnUse"
              cx={cx}
              cy={cy}
              r={rMax * 1.02}
              fx={cx}
              fy={cy}
            >
              <stop offset="0%" stopColor="rgb(245, 243, 255)" stopOpacity={0.95} />
              <stop offset="38%" stopColor="rgb(196, 181, 253)" stopOpacity={0.72} />
              <stop offset="72%" stopColor="rgb(139, 92, 246)" stopOpacity={0.62} />
              <stop offset="100%" stopColor="rgb(91, 33, 182)" stopOpacity={0.78} />
            </radialGradient>
          </defs>
          {grid.map(function(d, idx) {
            return <path key={'grid-' + idx} d={d} fill="none" stroke="rgba(148, 163, 184, 0.35)" strokeWidth="0.6" />;
          })}
          {hexState.axes.map(function(ax, ai) {
            var t = axisAngle(ai, N_AXES);
            return (
              <line
                key={ax.key + '-spoke'}
                x1={cx}
                y1={cy}
                x2={cx + rLabel * 1.05 * Math.cos(t)}
                y2={cy + rLabel * 1.05 * Math.sin(t)}
                stroke="rgba(148, 163, 184, 0.45)"
                strokeWidth="0.5"
              />
            );
          })}
          <path
            d={mPts}
            className="stelvio-run-hexagon-radar-fill"
            fill={'url(#' + fillGradId + ')'}
            stroke="rgb(109, 40, 217)"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {hexState.axes.map(function(ax, ai) {
            var t = axisAngle(ai, N_AXES);
            var lx = cx + rLabel * Math.cos(t);
            var ly = cy + rLabel * Math.sin(t);
            var changeSuffix = ax.rankChangeSuffix;
            return (
              <text
                key={ax.key + '-lbl'}
                x={lx}
                y={ly}
                textAnchor="middle"
                className="fill-slate-800"
              >
                {changeSuffix ? <title>{changeSuffix.title}</title> : null}
                <tspan x={lx} dy="0" style={{ fontSize: '9.5px', fontWeight: 600 }}>{ax.label}</tspan>
                <tspan x={lx} dy="11" style={{ fontSize: '7.5px', fill: '#64748b' }}>
                  {ax.rank != null ? Math.floor(Number(ax.rank)) + '위' : '—'}
                  {changeSuffix ? (
                    <tspan
                      fill={HEXAGON_AXIS_RANK_CHANGE_FILL[changeSuffix.kind]}
                      style={{ fontSize: '7px', fontWeight: 600 }}
                    >
                      {changeSuffix.text}
                    </tspan>
                  ) : null}
                </tspan>
              </text>
            );
          })}
        </svg>
      );
    }, [hexState]);

    var filterRow = null;
    if (uid) {
      filterRow = (
        <div className="stelvio-octagon-filters" role="group" aria-label="랭킹 기준(성별·부문) 선택">
          <div className="stelvio-octagon-filter-joined">
            <div className="stelvio-octagon-filter-cell stelvio-octagon-gender">
              <span className="stelvio-octagon-filter-cap">성별</span>
              <span className="stelvio-octagon-filter-val">{labelForGender(gender)}</span>
              <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
              <select className="stelvio-octagon-filter-select" value={gender} onChange={function(e) { setGender(e.target.value); }} aria-label="성별">
                {GENDER_OPTIONS.map(function(o) {
                  return <option key={o.value} value={o.value}>{o.label}</option>;
                })}
              </select>
            </div>
            <div className="stelvio-octagon-filter-cell stelvio-octagon-category">
              <span className="stelvio-octagon-filter-cap">카테고리</span>
              <span className="stelvio-octagon-filter-val">{labelForCategory(category)}</span>
              <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
              <select className="stelvio-octagon-filter-select" value={category} onChange={function(e) { setCategory(e.target.value); }} aria-label="카테고리">
                {CATEGORY_OPTIONS.map(function(o) {
                  return <option key={o.value} value={o.value}>{o.label}</option>;
                })}
              </select>
            </div>
          </div>
          {(() => {
            var myCat = categoryValueMatchingUserAge(userProfile);
            if (!myCat) return null;
            return (
              <div className="stelvio-octagon-filter-verify mt-1.5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-600">
                {category !== myCat ? (
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50/90 text-violet-900 font-medium hover:bg-violet-100 shadow-sm"
                    onClick={function() { setCategory(myCat); }}
                  >
                    나의 부문(검증): {labelForCategory(myCat)}
                  </button>
                ) : (
                  <span className="px-1 text-center leading-snug">
                    동일 조건 순위: <strong>나의 부문</strong>({labelForCategory(myCat)}) — 랭킹보드와 동기
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      );
    }

    var body = null;
    if (!uid) {
      body = (
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm text-center px-2">
          사용자 ID가 없으면 순위를 불러올 수 없습니다.
        </div>
      );
    } else if (lbState.loading && !hexState) {
      body = (
        <div className="h-[220px] flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-3" />
          <span className="text-sm text-gray-500">헥사곤 로딩…</span>
        </div>
      );
    } else if (lbState.err && !hexState) {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">랭킹을 불러오지 못했습니다. 네트워크를 확인해 주세요.</div>
      );
    } else if (!hexState) {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm text-center px-2">랭킹 데이터가 없습니다.</div>
      );
    } else {
      body = (
        <div>
          <div className="flex items-center justify-center gap-1 w-full max-w-[420px] mx-auto">
            <div className="stelvio-octagon-chart-shell relative flex-1 h-[260px]">
              {svg}
              <RunHexagonCenterOverlay
                badge={tierBadge}
                hexState={hexState}
                showPct={tierPctHintOpen}
                filterGenderLabel={labelForGender(gender)}
                filterCategoryLabel={labelForCategory(category)}
              />
            </div>
            <div className="stelvio-octagon-sidebar-col">
              <RunHexagonLevelPillSidebar
                bar={paceLevelBar}
                hexState={hexState}
                showPct={tierPctHintOpen}
                setShowPct={setTierPctHintOpen}
                filterGenderLabel={labelForGender(gender)}
                filterCategoryLabel={labelForCategory(category)}
              />
              <RunPaceLevelProgressBar bar={paceLevelBar} />
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-1 mb-0 px-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }} />
              <span>최근 90일 최고 기록 및 횟수 평균 적용</span>
            </div>
          </div>
          <div className="stelvio-heptagon-tier-legend mt-2 mb-1 px-1 w-full max-w-xl mx-auto" role="group" aria-label="종합 순위 상위 % 범례">
            <RunHexagonHorizontalBar
              topSharePercent={hexState.topSharePercent}
              tierId={hexState.tierIdFromRank}
            />
          </div>
        </div>
      );
    }

    if (DashboardCard) {
      return (
        <DashboardCard title="STELVIO 헥사곤 (레벨 포지션)">
          {filterRow}
          {body}
        </DashboardCard>
      );
    }
    if (embedded) {
      return (
        <div className="stelvio-hexagon-ranks-embed">
          {filterRow}
          {body}
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">STELVIO 헥사곤 (레벨 포지션)</h3>
        {filterRow}
        {body}
      </div>
    );
  }

  window.StelvioHexagonRanksCard = StelvioHexagonRanksCard;
})();
