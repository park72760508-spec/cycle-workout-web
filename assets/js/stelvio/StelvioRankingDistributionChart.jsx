/**
 * STELVIO 랭킹 보드 — 코호트 분포 Area Chart (Recharts + Tailwind 클래스)
 * window.StelvioRankingDistributionChart, window.refreshStelvioDistributionChart
 */
/* global React, ReactDOM, Recharts */

(function (global) {
  var ReactObj = global.React;
  if (!ReactObj) return;

  var useMemo = ReactObj.useMemo;
  var useRef = ReactObj.useRef;
  var useState = ReactObj.useState;
  var useLayoutEffect = ReactObj.useLayoutEffect || ReactObj.useEffect;

  var BADGE_HALF_W = 52;
  var BADGE_EDGE_PAD = 6;

  var BRONZE = '#b87333';
  var BRONZE_MUTED = 'rgba(184, 115, 51, 0.35)';
  var ACCENT_START = '#6366f1';
  var ACCENT_END = '#8b5cf6';
  var REF_LINE = '#7c3aed';

  var STELVIO_DURATION_LABELS = {
    tss: 'TSS',
    personal_dist: '거리 30일',
    group_dist: '그룹 30일',
    gc: 'GC',
    '1min': '1분',
    '5min': '5분',
    '10min': '10분',
    '20min': '20분',
    '40min': '40분',
    '60min': '60분',
    max: 'Max',
  };
  var STELVIO_CATEGORY_LABELS = {
    Supremo: '전체',
    Assoluto: '선수부',
    Bianco: '30대 이하',
    Rosa: '40대',
    Infinito: '50대',
    Leggenda: '60대 이상',
  };

  var _gid = 0;
  function nextGradientId() {
    return 'stelvio-dist-' + (++_gid);
  }

  /** 맞춤 필터 분포: X축 W/kg + 체중 기준 평지 항속(km/h) 보조 눈금 */
  function OpenRidingWkgSpeedTick(props) {
    var x = props.x;
    var y = props.y;
    var payload = props.payload;
    var wKg = props.openRidingTierBandWeightKg;
    var isTs = props.isTssMode;
    if (isTs || !payload || payload.value == null || !isFinite(Number(payload.value))) {
      var disp = payload && payload.value != null ? payload.value : '';
      return (
        <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={10}>
          {isTs ? String(Number(disp).toFixed(0)) : Number(disp).toFixed(1)}
        </text>
      );
    }
    var wkgVal = Number(payload.value);
    var spd = null;
    var calc = global.calculateSpeedOnFlat;
    if (wKg > 0 && typeof calc === 'function') {
      spd = Math.round(calc(wkgVal * wKg, wKg) * 10) / 10;
    }
    if (!(wKg > 0)) {
      return (
        <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={10}>
          {wkgVal.toFixed(1)}
        </text>
      );
    }
    return (
      <g transform={'translate(' + x + ',' + y + ')'}>
        <text x={0} y={0} dy={12} textAnchor="middle" fill="#64748b" fontSize={10}>
          {wkgVal.toFixed(1)}
        </text>
        {spd != null ? (
          <text x={0} y={0} dy={26} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            {'~' + spd + ' km/h'}
          </text>
        ) : null}
      </g>
    );
  }

  /** 과거 차트 배지용 (다른 카테고리 조회 시에만 순위 표기에 적용) */
  function rankDisplayForChart(n) {
    var r = Number(n);
    if (r !== 2) return r;
    return 3;
  }

  function safeFloorRank(n) {
    var r = Number(n);
    return isFinite(r) && r >= 1 ? Math.floor(r) : null;
  }

  /**
   * 선택 카테고리 배열에서 내 W/kg·TSS가 몇 위인지 (동점은 표준 경기 순위: 더 큰 값만 선행)
   */
  function rowMetricValue(row, duration) {
    if (!row) return NaN;
    if (duration === 'tss') return Number(row.totalTss);
    if (duration === 'personal_dist' || duration === 'group_dist') return Number(row.totalKm);
    if (duration === 'gc') return Number(row.gcScore);
    return Number(row.wkg);
  }

  function rankInCategoryByValue(categoryRows, myVal, duration) {
    if (!categoryRows || !categoryRows.length || myVal == null || isNaN(myVal) || !isFinite(myVal)) return null;
    var eps = duration === 'tss' || duration === 'personal_dist' || duration === 'group_dist' || duration === 'gc' ? 1e-6 : 1e-9;
    var strictlyGreater = 0;
    for (var i = 0; i < categoryRows.length; i++) {
      var row = categoryRows[i];
      if (!row) continue;
      var v = rowMetricValue(row, duration);
      if (isFinite(v) && v > myVal + eps) strictlyGreater++;
    }
    return strictlyGreater + 1;
  }

  function mergeEntriesFromByCategory(bc) {
    if (!bc) return [];
    var m = {};
    ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'].forEach(function (c) {
      (bc[c] || []).forEach(function (e) {
        if (e && e.userId) m[e.userId] = e;
      });
    });
    return Object.keys(m).map(function (k) {
      return m[k];
    });
  }

  function getCohortEntries(entries, byCategory, activeCategory) {
    var list =
      entries && entries.length
        ? entries.slice()
        : mergeEntriesFromByCategory(byCategory);
    if (!list.length) return [];
    if (activeCategory === 'Supremo') return list;
    return list.filter(function (e) {
      return e.ageCategory === activeCategory;
    });
  }

  function buildBins(rawValues, isTss) {
    var values = rawValues.filter(function (v) {
      return v != null && !isNaN(v) && isFinite(v) && v >= 0;
    });
    if (!values.length) {
      return { rows: [], xMin: 0, xMax: 1, maxY: 1 };
    }
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var xMin = isTss ? 0 : minV;
    var xMax = maxV;
    if (xMax <= xMin) {
      xMax = xMin + (isTss ? Math.max(1, xMin * 0.05) : 0.05);
    }
    var bins = Math.min(22, Math.max(12, Math.round(Math.sqrt(values.length))));
    var step = (xMax - xMin) / bins;
    var counts = new Array(bins).fill(0);
    values.forEach(function (v) {
      var i = Math.floor((v - xMin) / step);
      if (i < 0) i = 0;
      if (i >= bins) i = bins - 1;
      counts[i]++;
    });
    var rows = [];
    var maxY = 0;
    for (var i = 0; i < bins; i++) {
      var x0 = xMin + i * step;
      var x1 = xMin + (i + 1) * step;
      var cx = (x0 + x1) / 2;
      var cnt = counts[i];
      if (cnt > maxY) maxY = cnt;
      rows.push({ x: cx, count: cnt, x0: x0, x1: x1 });
    }
    if (maxY < 1) maxY = 1;
    var head = { x: xMin, count: 0, x0: xMin, x1: xMin };
    var tail = { x: xMax, count: 0, x0: xMax, x1: xMax };
    return { rows: [head].concat(rows).concat([tail]), xMin: xMin, xMax: xMax, maxY: maxY };
  }

  function StelvioRankingDistributionChart(props) {
    var p = props || {};
    var entries = p.entries;
    var byCategory = p.byCategory;
    var activeCategory = p.activeCategory || 'Supremo';
    var duration = p.duration || '5min';
    var currentUserId = p.currentUserId;
    var currentUser = p.currentUser;
    var myRankSupremo = p.myRankSupremo;
    var titleOverride = p.titleOverride;
    var pillLabelOverride = p.pillLabelOverride;
    var chartSubNoteOverride = p.chartSubNoteOverride;

    var isTss = duration === 'tss';
    var isKmMode = duration === 'personal_dist' || duration === 'group_dist';
    var isGcMode = duration === 'gc';
    var isHistLike = isTss || isKmMode || isGcMode;
    var durLabel = isTss
      ? '주간 TSS'
      : isKmMode
        ? (duration === 'group_dist' ? '그룹 30일 거리' : '거리 30일')
        : isGcMode
          ? 'GC 환산 점수'
          : STELVIO_DURATION_LABELS[duration] || duration;
    /** 오픈 라이딩 등: 랭킹 행과 무관하게 프로필 FTP 기준 W/kg으로 세로 기준선만 고정 */
    var overrideMyWkg =
      !isTss && !isKmMode && !isGcMode && p.overrideMyWkg != null ? Number(p.overrideMyWkg) : null;
    if (overrideMyWkg != null && (isNaN(overrideMyWkg) || !isFinite(overrideMyWkg))) overrideMyWkg = null;

    var chartWrapRef = useRef(null);
    var _cw = useState(0);
    var chartContainerW = _cw[0];
    var setChartContainerW = _cw[1];
    useLayoutEffect(
      function () {
        var el = chartWrapRef.current;
        if (!el) return;
        function measure() {
          try {
            var r = el.getBoundingClientRect();
            if (r && r.width) setChartContainerW(Math.max(0, Math.floor(r.width)));
          } catch (e) {}
        }
        measure();
        var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (ro) ro.observe(el);
        window.addEventListener('resize', measure);
        return function () {
          if (ro) ro.disconnect();
          window.removeEventListener('resize', measure);
        };
      },
      []
    );

    var cohort = useMemo(
      function () {
        return getCohortEntries(entries, byCategory, activeCategory);
      },
      [entries, byCategory, activeCategory]
    );

    var values = useMemo(
      function () {
        return cohort.map(function (e) {
          if (isTss) return Number(e.totalTss);
          if (isKmMode) return Number(e.totalKm);
          if (isGcMode) return Number(e.gcScore);
          return Number(e.wkg);
        });
      },
      [cohort, isTss, isKmMode, isGcMode]
    );

    var binPack = useMemo(
      function () {
        return buildBins(values, isHistLike);
      },
      [values, isHistLike]
    );

    var gid = useMemo(
      function () {
        return nextGradientId();
      },
      [activeCategory, duration, cohort.length]
    );

    var chartRows = binPack.rows;
    var xMin = binPack.xMin;
    var xMax = binPack.xMax;

    var openRidingTierBandWeightKg =
      !isTss &&
      !isKmMode &&
      !isGcMode &&
      p.openRidingTierBandWeightKg != null &&
      isFinite(Number(p.openRidingTierBandWeightKg)) &&
      Number(p.openRidingTierBandWeightKg) > 0
        ? Number(p.openRidingTierBandWeightKg)
        : null;

    var openRidingTierBandSegments = useMemo(
      function () {
        if (!openRidingTierBandWeightKg || isTss) return [];
        var wFn = typeof global.wkgForOpenRidingSoloSpeedKmH === 'function' ? global.wkgForOpenRidingSoloSpeedKmH : null;
        if (!wFn) return [];
        var w = openRidingTierBandWeightKg;
        var b1 = wFn(25, w);
        var b2 = wFn(28, w);
        var b3 = wFn(32, w);
        var b4 = wFn(35, w);
        if (b1 == null || b2 == null || b3 == null || b4 == null) return [];
        return [
          { x0: xMin, x1: b1, label: '입문', speedHint: '~25km/h', color: 'rgba(253, 224, 71, 0.72)' },
          { x0: b1, x1: b2, label: '초급', speedHint: '~28 km/h', color: 'rgba(190, 242, 100, 0.46)' },
          { x0: b2, x1: b3, label: '중급', speedHint: '~32 km/h', color: 'rgba(168, 85, 247, 0.4)' },
          { x0: b3, x1: b4, label: '중상급', speedHint: '~35 km/h', color: 'rgba(249, 115, 22, 0.42)' },
          { x0: b4, x1: xMax, label: '상급', speedHint: '35+ km/h', color: 'rgba(239, 68, 68, 0.42)' },
        ];
      },
      [openRidingTierBandWeightKg, isTss, isKmMode, xMin, xMax]
    );

    var chartXAxisBottomMargin = openRidingTierBandWeightKg ? 33 : 8;
    var openRidingTierStripOverlapPx = openRidingTierBandWeightKg && openRidingTierBandSegments.length > 0 ? 15 : 0;

    var myRaw = null;
    if (overrideMyWkg != null && !isTss && !isKmMode && !isGcMode) {
      myRaw = overrideMyWkg;
    }
    if (myRaw == null && currentUserId && cohort.length) {
      var mine = cohort.filter(function (e) {
        if (duration === 'group_dist') {
          return e.userId === currentUserId || e.currentUserParticipated === true;
        }
        return e.userId === currentUserId;
      })[0];
      if (mine) {
        myRaw = isTss ? Number(mine.totalTss) : isKmMode ? Number(mine.totalKm) : isGcMode ? Number(mine.gcScore) : Number(mine.wkg);
      }
    }
    if ((myRaw == null || isNaN(myRaw)) && currentUserId && myRankSupremo && myRankSupremo.userId === currentUserId) {
      myRaw = isTss
        ? Number(myRankSupremo.totalTss)
        : isKmMode
          ? Number(myRankSupremo.totalKm)
          : isGcMode
            ? Number(myRankSupremo.gcScore)
            : Number(myRankSupremo.wkg);
    }
    if ((myRaw == null || isNaN(myRaw)) && currentUser && currentUser.userId === currentUserId) {
      myRaw = isTss
        ? Number(currentUser.totalTss)
        : isKmMode
          ? Number(currentUser.totalKm)
          : isGcMode
            ? Number(currentUser.gcScore)
            : Number(currentUser.wkg);
    }
    if (
      (myRaw == null || isNaN(myRaw)) &&
      isKmMode &&
      currentUserId &&
      currentUser &&
      (currentUser.totalKm != null || currentUser.totalTss != null)
    ) {
      myRaw = Number(currentUser.totalKm != null ? currentUser.totalKm : currentUser.totalTss);
    }

    var myX = myRaw != null && !isNaN(myRaw) ? Math.min(xMax, Math.max(xMin, myRaw)) : null;

    var userAgeCat = currentUser && currentUser.ageCategory;
    var displayRank = null;

    if (overrideMyWkg != null && !isTss && !isGcMode) {
      displayRank = null;
    } else if (activeCategory === 'Supremo') {
      var globalR =
        currentUser && currentUser.rank != null
          ? currentUser.rank
          : myRankSupremo && myRankSupremo.rank != null
          ? myRankSupremo.rank
          : null;
      displayRank = safeFloorRank(globalR);
    } else if (userAgeCat && activeCategory === userAgeCat) {
      var heroArr = byCategory && byCategory[activeCategory] ? byCategory[activeCategory] : [];
      var heroIdx = currentUserId
        ? heroArr.findIndex(function (e) {
            if (duration === 'group_dist') {
              return e.userId === currentUserId || e.currentUserParticipated === true;
            }
            return e.userId === currentUserId;
          })
        : -1;
      if (heroIdx >= 0) displayRank = heroIdx + 1;
    } else {
      var compareArr = byCategory && byCategory[activeCategory] ? byCategory[activeCategory] : [];
      var rawRank = rankInCategoryByValue(compareArr, myRaw, duration);
      if (rawRank != null) displayRank = rankDisplayForChart(rawRank);
    }

    var valueFmt =
      myRaw != null && !isNaN(myRaw)
        ? isTss
          ? myRaw.toFixed(1) + ' TSS'
          : isKmMode
            ? myRaw.toFixed(1) + ' km'
            : isGcMode
              ? myRaw.toFixed(1) + ' 점'
              : myRaw.toFixed(2) + ' W/kg'
        : '';

    var refBadgeTitle = typeof p.overrideReferenceBadgeTitle === 'string' && p.overrideReferenceBadgeTitle.trim()
      ? p.overrideReferenceBadgeTitle.trim()
      : '나의 FTP';
    var refValueNote =
      typeof p.overrideReferenceValueNote === 'string' ? p.overrideReferenceValueNote : ' (프로필)';
    var badgeMain = overrideMyWkg != null && !isTss && !isKmMode && !isGcMode ? refBadgeTitle : '나의 위치';
    var badgeSub =
      overrideMyWkg != null && !isTss && !isKmMode && !isGcMode && valueFmt
        ? '· ' + valueFmt + (refValueNote || '')
        : displayRank != null && valueFmt
        ? '· ' + displayRank + '위 · ' + valueFmt
        : valueFmt
        ? '· ' + valueFmt
        : displayRank != null
        ? '· ' + displayRank + '위'
        : '';

    var catTitle = STELVIO_CATEGORY_LABELS[activeCategory] || activeCategory || '전체';
    var cardTitleText = typeof titleOverride === 'string' && titleOverride.trim() ? titleOverride.trim() : '참가자 분포';
    var pillText =
      typeof pillLabelOverride === 'string' && pillLabelOverride.trim()
        ? pillLabelOverride.trim()
        : catTitle + ' · ' + durLabel;

    var RechartsLib = global.Recharts;
    var AreaChart = RechartsLib && RechartsLib.AreaChart;
    var Area = RechartsLib && RechartsLib.Area;
    var XAxis = RechartsLib && RechartsLib.XAxis;
    var YAxis = RechartsLib && RechartsLib.YAxis;
    var CartesianGrid = RechartsLib && RechartsLib.CartesianGrid;
    var Tooltip = RechartsLib && RechartsLib.Tooltip;
    var ResponsiveContainer = RechartsLib && RechartsLib.ResponsiveContainer;
    var ReferenceLine = RechartsLib && RechartsLib.ReferenceLine;

    function DistTooltip(tp) {
      var active = tp.active;
      var payload = tp.payload;
      if (!active || !payload || !payload.length) return null;
      var pl = payload[0].payload;
      if (!pl || pl.count == null) return null;
      var x0 = pl.x0;
      var x1 = pl.x1;
      var rng = isTss
        ? x0.toFixed(1) + ' ~ ' + x1.toFixed(1) + ' TSS'
        : isKmMode
        ? x0.toFixed(1) + ' ~ ' + x1.toFixed(1) + ' km'
        : x0.toFixed(2) + ' ~ ' + x1.toFixed(2) + ' W/kg';
      return (
        <div className="rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 shadow-lg shadow-indigo-500/10 text-xs z-50">
          <div className="font-semibold text-slate-700 mb-0.5">{rng}</div>
          <div className="text-slate-500">
            <span style={{ color: BRONZE }} className="font-medium">
              {pl.count}
            </span>
            명
          </div>
        </div>
      );
    }

    function MeBadge(lprops) {
      var viewBox = lprops.viewBox;
      if (!viewBox) return null;
      var lineX = viewBox.x;
      var half = BADGE_HALF_W;
      var edge = BADGE_EDGE_PAD;
      var cx = lineX;
      var pv = lprops.parentViewBox;
      var areaLeft;
      var areaW;
      if (pv && typeof pv.width === 'number' && pv.width > 0 && typeof pv.x === 'number') {
        areaLeft = pv.x;
        areaW = pv.width;
      } else {
        var yAxisW = 28;
        var marginR = 8;
        areaLeft = yAxisW;
        areaW = Math.max(0, chartContainerW - yAxisW - marginR);
      }
      var minCenter = areaLeft + half + edge;
      var maxCenter = areaLeft + areaW - half - edge;
      if (areaW > 0 && maxCenter > minCenter) {
        cx = Math.min(maxCenter, Math.max(minCenter, lineX));
      }
      return (
        <g>
          <rect
            x={cx - half}
            y={6}
            rx="10"
            ry="10"
            width={half * 2}
            height="36"
            fill="white"
            stroke={REF_LINE}
            strokeWidth="1.5"
            filter="url(#stelvio-dist-badge-shadow)"
          />
          <text x={cx} y={22} textAnchor="middle" fill={REF_LINE} fontSize="10" fontWeight="700">
            {badgeMain}
          </text>
          {badgeSub ? (
            <text x={cx} y={34} textAnchor="middle" fill="#64748b" fontSize="9">
              {badgeSub.length > 22 ? badgeSub.slice(0, 20) + '…' : badgeSub}
            </text>
          ) : null}
        </g>
      );
    }

    if (!RechartsLib || !AreaChart || !cohort.length || chartRows.length < 2) {
      return (
        <div className="stelvio-dist-card rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-sm px-4 py-4 mt-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-slate-800">{cardTitleText}</h3>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100"
              style={{ color: BRONZE }}
            >
              {pillText}
            </span>
          </div>
          <p className="text-xs text-slate-500 py-8 text-center">표시할 분포 데이터가 없습니다.</p>
        </div>
      );
    }

    return (
      <div className="stelvio-dist-card rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-sm px-3 sm:px-4 py-4 mt-4">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{cardTitleText}</h3>
          <span
            className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border"
            style={{ borderColor: BRONZE_MUTED, color: BRONZE, background: 'rgba(184, 115, 51, 0.08)' }}
          >
            {pillText}
          </span>
        </div>
        <div className="flex flex-col gap-0 w-full">
          <div
            ref={chartWrapRef}
            className="relative z-[1] h-[min(240px,52vw)] w-full min-h-[200px] shrink-0 leading-[0] [&_.recharts-responsive-container]:leading-[0] [&_svg]:block"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartRows}
                margin={{ top: 42, right: 8, left: 0, bottom: chartXAxisBottomMargin }}
              >
                <defs>
                  <linearGradient id={gid + '-area'} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT_START} stopOpacity={0.45} />
                    <stop offset="55%" stopColor={ACCENT_END} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={ACCENT_END} stopOpacity={0} />
                  </linearGradient>
                  <filter id="stelvio-dist-badge-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[xMin, xMax]}
                  tickMargin={openRidingTierBandWeightKg ? 3 : undefined}
                  tick={
                    openRidingTierBandWeightKg
                      ? function (tp) {
                          return (
                            <OpenRidingWkgSpeedTick
                              {...tp}
                              openRidingTierBandWeightKg={openRidingTierBandWeightKg}
                              isTssMode={isTss}
                            />
                          );
                        }
                      : { fontSize: 10, fill: '#64748b' }
                  }
                  tickFormatter={
                    openRidingTierBandWeightKg
                      ? undefined
                      : function (v) {
                          return isTss ? String(Number(v).toFixed(0)) : Number(v).toFixed(1);
                        }
                  }
                  stroke="#cbd5e1"
                />
                <YAxis
                  width={28}
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  stroke="#cbd5e1"
                  domain={[
                    0,
                    function (dataMax) {
                      return Math.ceil(dataMax * 1.12) || 1;
                    },
                  ]}
                />
                <Tooltip content={<DistTooltip />} cursor={{ stroke: BRONZE, strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area
                  type="natural"
                  dataKey="count"
                  stroke={ACCENT_START}
                  strokeWidth={2.2}
                  fill={'url(#' + gid + '-area)'}
                  dot={false}
                  activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2, fill: ACCENT_END }}
                  animationDuration={1100}
                  animationEasing="ease-out"
                  isAnimationActive={true}
                />
                {myX != null ? (
                  <ReferenceLine
                    x={myX}
                    stroke={REF_LINE}
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    label={<MeBadge />}
                  />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {openRidingTierBandSegments.length > 0 ? (
            <div
              className="relative z-0 h-[30px] w-full overflow-hidden border border-slate-200/90 box-border rounded-b-md leading-normal mt-0 shrink-0"
              style={{
                marginLeft: 28,
                marginRight: 8,
                width: 'calc(100% - 36px)',
                marginTop: openRidingTierStripOverlapPx ? -openRidingTierStripOverlapPx + 'px' : 0,
              }}
            >
              {openRidingTierBandSegments.map(function (seg, si) {
                var span = xMax - xMin;
                if (!(span > 0)) return null;
                var xa = Math.max(xMin, Math.min(xMax, seg.x0));
                var xb = Math.max(xMin, Math.min(xMax, seg.x1));
                if (xb <= xa) return null;
                var leftPct = ((xa - xMin) / span) * 100;
                var wPct = Math.max(0.5, ((xb - xa) / span) * 100);
                var isBeginnerBand = si === 0;
                return (
                  <div
                    key={'open-tier-' + si}
                    title={seg.label + ' ' + seg.speedHint}
                    className="absolute inset-y-0 flex flex-col items-center justify-center text-center px-0.5 box-border py-0.5"
                    style={{
                      left: leftPct + '%',
                      width: wPct + '%',
                      background: seg.color,
                      borderRight: '1px solid rgba(255,255,255,0.5)',
                    }}
                  >
                    <span
                      className={
                        'leading-tight ' +
                        (isBeginnerBand
                          ? 'text-[10px] font-bold text-amber-950/95'
                          : 'text-[9px] font-bold text-slate-900/95')
                      }
                    >
                      {seg.label}
                    </span>
                    <span
                      className={
                        'leading-tight ' +
                        (isBeginnerBand
                          ? 'text-[9px] font-semibold text-amber-900/95'
                          : 'text-[8px] font-semibold text-slate-800/95')
                      }
                    >
                      {seg.speedHint}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {openRidingTierBandSegments.length > 0 ? (
            <p className="text-[10px] text-slate-500 text-center m-0 mt-1.5 px-1">
              본인 체중({openRidingTierBandWeightKg}kg) 기준 평지 항속 상한 — W/kg 축과 동일 스케일
            </p>
          ) : null}
        </div>
        {chartSubNoteOverride !== false ? (
          <p className="text-[11px] text-slate-500 text-center leading-snug mt-1.5 px-1">
            {typeof chartSubNoteOverride === 'string' && chartSubNoteOverride.trim()
              ? chartSubNoteOverride.trim()
              : '구간별 참가자 수(밀도). 곡선 아래 면적은 동일 스케일에서의 상대 분포를 나타냅니다.'}
          </p>
        ) : null}
      </div>
    );
  }

  global.StelvioRankingDistributionChart = StelvioRankingDistributionChart;

  var _distRoot = null;
  global.refreshStelvioDistributionChart = function (chartProps) {
    var el = document.getElementById('stelvio-distribution-chart-root');
    if (!el || !global.React || !global.ReactDOM || !global.StelvioRankingDistributionChart) return;
    var p = chartProps || {};
    var elem = global.React.createElement(global.StelvioRankingDistributionChart, p);
    if (global.ReactDOM.createRoot) {
      if (!_distRoot) _distRoot = global.ReactDOM.createRoot(el);
      _distRoot.render(elem);
    } else if (typeof global.ReactDOM.render === 'function') {
      global.ReactDOM.render(elem, el);
    }
  };
})(typeof window !== 'undefined' ? window : this);

/**
 * 독립 테스트용 더미 엔트리 (콘솔·스토리북에서 복사해 props.entries 로 전달 가능)
 */
window.STELVIO_DIST_DUMMY_ENTRIES = (function () {
  var rows = [];
  var i;
  for (i = 0; i < 80; i++) {
    rows.push({
      userId: 'u' + i,
      name: 'Rider ' + i,
      wkg: 2.5 + Math.random() * 3.2,
      totalTss: 50 + Math.random() * 420,
      ageCategory: ['Bianco', 'Rosa', 'Infinito', 'Leggenda'][i % 4],
    });
  }
  return rows;
})();
