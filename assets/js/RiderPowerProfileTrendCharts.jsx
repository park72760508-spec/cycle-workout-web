/**
 * RiderPowerProfileTrendCharts - 파워 매트릭스 분석 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * 6개 그래프: TSPT, RSPT, PCH, CLMB, TTST, ALLR
 * 목표값: STELVIO 랭킹 보드 카테고리별 1등(장기), 나의 바로 앞선 경쟁자(단기)
 * @see useRiderAnalysis.js - getIntervalMMPFromLogs, aggregateMMPFromLogs
 */

/* global React, Recharts */

if (!window.React) {
  console.warn("React is not loaded yet.");
}
var ReactObj = window.React || {};
var useState = ReactObj.useState || null;
var useEffect = ReactObj.useEffect || null;
var useRef = ReactObj.useRef || null;

// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _chartId = 0;
function nextChartId() { return 'pp-' + (++_chartId); }

/** 파워 커브 X축 순서 */
var CURVE_DURATIONS = [
  { key: '5s', apiKey: 'max' },
  { key: '1분', apiKey: '1min' },
  { key: '5분', apiKey: '5min' },
  { key: '10분', apiKey: '10min' },
  { key: '20분', apiKey: '20min' },
  { key: '40분', apiKey: '40min' },
  { key: '60분', apiKey: '60min' }
];

/**
 * 로그에서 파워 커브 데이터 생성 (최근 1개월 전체 MMP)
 * goals에서 카테고리 1등(ALLR 최고) 파워 커브를 targetPower로 병합
 */
function buildPowerCurveData(logs, goals) {
  var agg = (logs && logs.length > 0 && window.aggregateMMPFromLogs)
    ? window.aggregateMMPFromLogs(logs, getDateStr(-30), getDateStr(0))
    : {};
  var m60 = agg.max_60min_watts || 0;
  var m20 = agg.max_20min_watts || 0;
  var fieldMap = { max: 'max_watts', '1min': 'max_1min_watts', '5min': 'max_5min_watts', '10min': 'max_10min_watts', '20min': 'max_20min_watts', '40min': 'max_40min_watts', '60min': 'max_60min_watts' };

  return CURVE_DURATIONS.map(function(d) {
    var myPower = Number(agg[fieldMap[d.apiKey]]) || 0;
    if (d.apiKey === '60min' && !myPower && m20 > 0) myPower = Math.round(m20 * 0.95);
    var g = goals[d.apiKey] || {};
    var targetPower = 0;
    if (g.isFirst && myPower > 0) {
      targetPower = Math.round(myPower * 1.03);
    } else {
      targetPower = g.longTerm || 0;
      if (!targetPower && (d.apiKey === '10min' || d.apiKey === '40min')) {
        var g5 = goals['5min'] || {};
        var g20 = goals['20min'] || {};
        var g40 = goals['40min'] || {};
        var g60 = goals['60min'] || {};
        if (d.apiKey === '10min') targetPower = Math.round(((g5.longTerm || 0) + (g20.longTerm || 0)) / 2);
        if (d.apiKey === '40min') targetPower = Math.round(((g20.longTerm || 0) + (g60.longTerm || 0)) / 2);
      }
    }
    return { duration: d.key, name: d.key, power: Math.round(myPower), targetPower: targetPower };
  }).filter(function(r) { return r.power > 0 || r.targetPower > 0; });
}

function getDateStr(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 최근 1개월 구간별 파워 데이터 (1·5·10·20·40·60분) — 구간 내 로그별 피크의 최댓값 */
function buildMonthPowerCurveData(intervalMMP) {
  return (intervalMMP || []).map(function(row) {
    return {
      name: row.name,
      endStr: row.endStr != null && String(row.endStr).length ? String(row.endStr) : null,
      power1min: Number(row.max_1min_watts) || 0,
      power5min: Number(row.max_5min_watts) || 0,
      power10min: Number(row.max_10min_watts) || 0,
      power20min: Number(row.max_20min_watts) || 0,
      power40min: Number(row.max_40min_watts) || 0,
      power60min: Number(row.max_60min_watts) || 0
    };
  });
}

/** 최근 1개월 파워 그래프: 구간별 색·API키·dataKey (랭킹 평균 W/kg은 동일 api 키 사용) */
var MONTH_POWER_CURVE_ITEMS = [
  { api: '1min', dataKey: 'power1min', label: '1분', color: '#ef4444' },
  { api: '5min', dataKey: 'power5min', label: '5분', color: '#f97316' },
  { api: '10min', dataKey: 'power10min', label: '10분', color: '#ca8a04' },
  { api: '20min', dataKey: 'power20min', label: '20분', color: '#3b82f6' },
  { api: '40min', dataKey: 'power40min', label: '40분', color: '#a855f7' },
  { api: '60min', dataKey: 'power60min', label: '60분', color: '#22c55e' }
];

/**
 * PR 큰 점 + 상단 파워(W) — 좌/우/상단 끝에서 잘리지 않도록 앵커·Y 보정
 * @param {number} dataLen - data.length (첫/끝 주차 PR 시 좌우 정렬)
 */
function growthStylePowerPrDot(R, prIdx, prWatts, lineColor, dataLen) {
  var smallFill = lineColor || '#3b82f6';
  var len = dataLen == null || dataLen < 1 ? 1 : dataLen;
  return function(dotProps) {
    if (!R || !dotProps || dotProps.cx == null || dotProps.cy == null) return null;
    var cx = dotProps.cx;
    var cy = dotProps.cy;
    var idx = dotProps.index;
    if (prIdx < 0 || prWatts <= 0 || idx !== prIdx) {
      return R.createElement('circle', { cx: cx, cy: cy, r: 3, fill: smallFill, stroke: '#fff', strokeWidth: 1 });
    }
    var wTxt = String(Math.round(prWatts)) + ' W';
    var isFirst = prIdx === 0;
    var isLast = prIdx === len - 1 && len > 1;
    var anchor = 'middle';
    var tx = cx;
    if (isFirst) {
      anchor = 'start';
      tx = cx + 8;
    } else if (isLast) {
      anchor = 'end';
      tx = cx - 8;
    }
    var labelAboveY = cy - 18;
    var useLabelBelow = labelAboveY < 12;
    var powerY = useLabelBelow ? cy + 20 : labelAboveY;
    var tPower = R.createElement('text', { x: tx, y: powerY, textAnchor: anchor, fill: '#1d4ed8', fontSize: 9, fontWeight: 'bold' }, wTxt);
    var cBig = R.createElement('circle', { cx: cx, cy: cy, r: 11, fill: smallFill, stroke: 'rgba(255,255,255,0.95)', strokeWidth: 1.5 });
    var tPr = R.createElement('text', { x: cx, y: cy, textAnchor: 'middle', dominantBaseline: 'middle', fill: '#fff', fontSize: 8, fontWeight: 'bold' }, 'PR');
    if (useLabelBelow) {
      return R.createElement('g', null, cBig, tPr, tPower);
    }
    return R.createElement('g', null, tPower, cBig, tPr);
  };
}

// ========== 파워 커브 차트 (ALLR - Duration 기반) ==========
function PowerProfileCurveChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var powerCurveData = p.powerCurveData;
  var isFullWidth = p.isFullWidth;
  var Recharts = window.Recharts;
  var AreaChart = Recharts && Recharts.AreaChart;
  var Area = Recharts && Recharts.Area;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var LabelList = Recharts && Recharts.LabelList;
  var cid = nextChartId();
  var data = powerCurveData || [];
  var labelFontSize = 10;

  if (!Recharts || !data.length) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">전 구간 파워 커브</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  var hasTarget = data.some(function(r) { return (r.targetPower || 0) > 0; });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">전 구간 파워 커브</h3>
      </div>
      <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={cid + '-fillCurve'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fillTarget'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="duration" interval={0} tickMargin={8} stroke="#6b7280" tick={(function() { var len = data.length; var fs = 12; return function(props) { var x = props.x, y = props.y, payload = props.payload, index = props.index; var isLast = index === len - 1; return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value); }; })()} />
            <YAxis width={32} tick={{ fontSize: 12 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={['auto', 'auto']} />
            {hasTarget && (
              <Area type="monotone" dataKey="targetPower" stroke="rgba(239,68,68,0.5)" strokeDasharray="5 5" fill={'url(#' + cid + '-fillTarget)'} strokeWidth={2} name="목표 (ALLR 최고)" dot={false} connectNulls />
            )}
            <Area type="monotone" dataKey="power" stroke="#3B82F6" fill={'url(#' + cid + '-fillCurve)'} strokeWidth={2.5} name="나의 파워" dot={{ r: 4, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1 }} activeDot={{ r: 5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }} connectNulls>{LabelList ? <LabelList dataKey="power" position="top" fill="rgba(59,130,246,0.7)" fontSize={labelFontSize} /> : null}</Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 최근 1개월 파워 그래프 (랭킹보드 참가자 분포와 동일: 클릭 → 세로 점선 + Stelvio식 배지; 호버 → DistTooltip) ==========
var PP_SEL_BADGE_HALF = 70;
var PP_SEL_BADGE_EDGE = 6;
var PP_REF_LINE = '#7c3aed';
/** 배지/툴팁: 구간색 투명 + 강한 블러로 곡선이 흐릿히 비침( 본문 대비는 ppBadgeTextStyle·서리 그라데이션으로 유지) */
var PP_TINT_A_BG = 0.28;
var PP_TINT_A_BORDER = 0.58;
var PP_FROST = 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 100%)';
var PP_BLUR = 'saturate(1.2) blur(16px)';

function ppHexToRgbParts(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6) return { r: 100, g: 116, b: 139 };
  var n = parseInt(h, 16);
  if (isNaN(n)) return { r: 100, g: 116, b: 139 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function ppHexToRgba(hex, a) {
  var c = ppHexToRgbParts(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

/** 구간 색에 따른 본문 색 + 다층 그림자(흐릿한 배경에서도 시인성 유지) */
function ppBadgeTextStyle(hex) {
  var c = ppHexToRgbParts(hex);
  var r = c.r / 255;
  var g = c.g / 255;
  var b = c.b / 255;
  var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L > 0.55) {
    return {
      color: '#0a0f1a',
      textShadow:
        '0 0 6px #fff, 0 0 10px #fff, 0 0 1px #fff, 0 1px 2px rgba(255,255,255,0.95), 0 1px 3px rgba(0,0,0,0.15)',
    };
  }
  return {
    color: '#fff',
    textShadow:
      '0 0 1px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.45), 0 0 12px rgba(0,0,0,0.35)',
  };
}

/** endStr(YYYY-MM-DD) 또는 ~M/D → MM-DD */
function monthPowerBadgeMmDd(row) {
  if (!row) return '—';
  var es = row.endStr;
  if (es && String(es).length >= 8) {
    var p = String(es).split('-');
    if (p.length >= 3) {
      return String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
    }
  }
  var nm = row.name;
  if (nm) {
    var s = String(nm).replace(/^\s*~\s*/, '');
    var m = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) {
      return String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
    }
  }
  return '—';
}

function PowerProfileMonthCurveChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var monthCurveData = p.monthCurveData;
  var avgWkgByDuration = p.avgWkgByDuration || {};
  var userWeight = Number(p.userWeight) || 0;
  var userProfile = p.userProfile || null;
  var ftpFromProfile = userProfile != null ? Number(userProfile.ftp != null && userProfile.ftp !== '' ? userProfile.ftp : userProfile.ftpWatts) : NaN;
  var ftpVal = !isNaN(ftpFromProfile) && ftpFromProfile > 0 ? ftpFromProfile : 0;
  var isFullWidth = p.isFullWidth;
  var Recharts = window.Recharts;
  var AreaChart = Recharts && Recharts.AreaChart;
  var Area = Recharts && Recharts.Area;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var ReferenceLine = Recharts && Recharts.ReferenceLine;
  var Tooltip = Recharts && Recharts.Tooltip;
  var cid = nextChartId();
  var data = monthCurveData || [];

  var _selState = useState('1min');
  var selectedApi = _selState[0];
  var setSelectedApi = _selState[1];
  var _xPick = useState(null);
  var selectedXIndex = _xPick[0];
  var setSelectedXIndex = _xPick[1];

  var chartWrapRef = useRef ? useRef(null) : { current: null };
  var _cw = useState(0);
  var chartContainerW = _cw[0];
  var setChartContainerW = _cw[1];
  useEffect(
    function() {
      var el = chartWrapRef && chartWrapRef.current;
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
      return function() {
        if (ro) ro.disconnect();
        window.removeEventListener('resize', measure);
      };
    },
    []
  );

  var selItem = MONTH_POWER_CURVE_ITEMS[0];
  for (var _si = 0; _si < MONTH_POWER_CURVE_ITEMS.length; _si++) {
    if (MONTH_POWER_CURVE_ITEMS[_si].api === selectedApi) {
      selItem = MONTH_POWER_CURVE_ITEMS[_si];
      break;
    }
  }
  var dataKey = selItem.dataKey;
  var selColor = selItem.color;

  var hasAnyWeek = data.length > 0 && data.some(function(r) {
    return (r.power1min || r.power5min || r.power10min || r.power20min || r.power40min || r.power60min) > 0;
  });

  var avgWkgSel = avgWkgByDuration[selectedApi];
  var cohortAvgPower =
    userWeight > 0 && avgWkgSel != null && !isNaN(avgWkgSel)
      ? Math.round(avgWkgSel * userWeight)
      : null;

  var prIdx = -1;
  var prWatts = 0;
  for (var _pi = 0; _pi < data.length; _pi++) {
    var _pv = Number(data[_pi][dataKey]) || 0;
    if (_pv > prWatts) {
      prWatts = _pv;
      prIdx = _pi;
    }
  }

  var yMax = 1;
  data.forEach(function(r) {
    var v = Number(r[dataKey]) || 0;
    if (v > yMax) yMax = v;
  });
  if (cohortAvgPower != null && cohortAvgPower > yMax) yMax = cohortAvgPower;
  yMax = Math.max(10, Math.ceil(yMax * 1.12 / 10) * 10);

  var yDomainMin = 0;
  var yDomainMax = yMax;
  if (ftpVal > 0) {
    yDomainMin = Math.round(ftpVal / 2);
    yDomainMax = prWatts > 0 ? Math.ceil(prWatts * 1.2) : Math.round(ftpVal * 2);
  } else {
    yDomainMin = 0;
    yDomainMax = prWatts > 0 ? Math.ceil(prWatts * 1.2) : yMax;
  }
  if (yDomainMax <= yDomainMin) {
    yDomainMax = yDomainMin + 20;
  }

  var ReactForDot = window.React;

  if (!Recharts || !hasAnyWeek) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">최근 1개월 파워 그래프</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  var fillGradId = cid + '-fillSel';
  var activeRing = 'ring-2 ring-blue-600 ring-offset-1 border-blue-500';
  var refXVal =
    selectedXIndex != null && data[selectedXIndex] && data[selectedXIndex].name != null
      ? data[selectedXIndex].name
      : null;

  function monthPowerDistTooltip(tipProps) {
    var active = tipProps.active;
    var payload = tipProps.payload;
    if (!active || !payload || !payload.length) return null;
    var pl = payload[0].payload;
    if (!pl) return null;
    var w = Math.round(Number(pl[dataKey]) || 0);
    var mmdd2 = monthPowerBadgeMmDd(pl);
    var tB = ppHexToRgba(selColor, PP_TINT_A_BG);
    var tBr = ppHexToRgba(selColor, PP_TINT_A_BORDER);
    var tP = ppBadgeTextStyle(selColor);
    return (
      <div
        className="rounded-xl px-3 py-2 text-xs z-50 text-center"
        style={{
          border: '1px solid ' + tBr,
          background: PP_FROST + ', ' + tB,
          backdropFilter: PP_BLUR,
          WebkitBackdropFilter: PP_BLUR,
          boxShadow: '0 8px 24px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.4)',
        }}
      >
        <div
          className="font-bold tabular-nums text-[13px] leading-tight"
          style={{ color: tP.color, textShadow: tP.textShadow, WebkitFontSmoothing: 'antialiased' }}
        >
          {w} W
        </div>
        <div
          className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium"
          style={{ color: tP.color, textShadow: tP.textShadow, WebkitFontSmoothing: 'antialiased' }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: selColor,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.25)',
            }}
            aria-hidden
          />
          <span>
            {selItem.label} | {mmdd2}
          </span>
        </div>
      </div>
    );
  }

  function ClickVerticalBadge(lbProps) {
    var viewBox = lbProps.viewBox;
    if (!viewBox) return null;
    var lineX = viewBox.x;
    var half = PP_SEL_BADGE_HALF;
    var edge = PP_SEL_BADGE_EDGE;
    var cx = lineX;
    var pv = lbProps.parentViewBox;
    var areaLeft;
    var areaW;
    if (pv && typeof pv.width === 'number' && pv.width > 0 && typeof pv.x === 'number') {
      areaLeft = pv.x;
      areaW = pv.width;
    } else {
      var yAxisW = 36;
      var marginR = 12;
      areaLeft = yAxisW;
      areaW = Math.max(0, chartContainerW - yAxisW - marginR);
    }
    var minCenter = areaLeft + half + edge;
    var maxCenter = areaLeft + areaW - half - edge;
    if (areaW > 0 && maxCenter > minCenter) {
      cx = Math.min(maxCenter, Math.max(minCenter, lineX));
    }
    var row = selectedXIndex != null && data[selectedXIndex] ? data[selectedXIndex] : null;
    if (!row) return null;
    var wv = Math.round(Number(row[dataKey]) || 0);
    var mmdd = monthPowerBadgeMmDd(row);
    var lab = selItem.label;
    var tintBg = ppHexToRgba(selColor, PP_TINT_A_BG);
    var tintBd = ppHexToRgba(selColor, PP_TINT_A_BORDER);
    var txP = ppBadgeTextStyle(selColor);
    return (
      <g filter={'url(#' + cid + '-pp-sel-shadow)'}>
        <foreignObject x={cx - half} y={6} width={half * 2} height="40" style={{ overflow: 'visible' }}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            className="flex h-[40px] w-full flex-col items-center justify-center gap-0.5 px-1.5 box-border"
            style={{
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              borderRadius: 10,
              border: '1.5px solid ' + tintBd,
              background: PP_FROST + ', ' + tintBg,
              backdropFilter: PP_BLUR,
              WebkitBackdropFilter: PP_BLUR,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
            }}
          >
            <div
              className="font-bold text-[12px] tabular-nums leading-none tracking-tight"
              style={{ color: txP.color, textShadow: txP.textShadow, WebkitFontSmoothing: 'antialiased' }}
            >
              {wv} W
            </div>
            <div
              className="flex items-center justify-center gap-1 text-[9px] font-medium leading-tight"
              style={{ color: txP.color, textShadow: txP.textShadow, WebkitFontSmoothing: 'antialiased' }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: selColor,
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.85), 0 1px 2px rgba(0,0,0,0.25)',
                }}
                aria-hidden
              />
              <span>
                {lab} | {mmdd}
              </span>
            </div>
          </div>
        </foreignObject>
      </g>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">최근 1개월 파워 그래프</h3>
        <div className="flex flex-wrap justify-center gap-1.5 mt-2 px-1">
          {MONTH_POWER_CURVE_ITEMS.map(function(it) {
            var active = selectedApi === it.api;
            var bg = it.color;
            return (
              <button
                key={it.api}
                type="button"
                onClick={function() { setSelectedApi(it.api); setSelectedXIndex(null); }}
                className={
                  'relative flex items-center justify-center rounded-full min-w-[1.75rem] h-7 px-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow-sm border transition ' +
                  (active ? activeRing : 'border-white/30 hover:brightness-95')
                }
                style={{ backgroundColor: bg }}
                title={it.label + ' 최대 파워'}
              >
                {it.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-2 border-dashed border-gray-400" style={{ verticalAlign: 'middle' }} />
            전체 사용자 평균 파워(최근 30일)
            {cohortAvgPower != null && cohortAvgPower > 0 ? (
              <span className="text-gray-500 tabular-nums">({cohortAvgPower}W)</span>
            ) : null}
          </span>
        </div>
      </div>
      <div
        ref={chartWrapRef}
        className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2 min-h-0 w-full [&_.recharts-responsive-container]:leading-[0] [&_svg]:block'}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 52, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={selColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={selColor} stopOpacity={0} />
              </linearGradient>
              <filter id={cid + '-pp-sel-shadow'} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              interval={0}
              tickMargin={6}
              stroke="#6b7280"
              tick={(function() {
                var len = data.length;
                var fs = 11;
                return function(tickProps) {
                  var x = tickProps.x;
                  var y = tickProps.y;
                  var payload = tickProps.payload;
                  var index = tickProps.index;
                  var isLast = index === len - 1;
                  return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value);
                };
              })()}
            />
            <YAxis width={36} tick={{ fontSize: 11 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={[yDomainMin, yDomainMax]} />
            {cohortAvgPower != null && cohortAvgPower > 0 && ReferenceLine ? (
              <ReferenceLine y={cohortAvgPower} stroke="#9ca3af" strokeWidth={2} strokeDasharray="6 4" />
            ) : null}
            {Tooltip ? (
              <Tooltip content={monthPowerDistTooltip} cursor={{ stroke: PP_REF_LINE, strokeWidth: 1, strokeDasharray: '4 4' }} />
            ) : null}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={selColor}
              fill={'url(#' + fillGradId + ')'}
              strokeWidth={2}
              name={selItem.label + ' 파워'}
              dot={growthStylePowerPrDot(ReactForDot, prIdx, prWatts, selColor, data.length)}
              connectNulls
              onClick={function(_d, i) {
                if (i == null || !data[i]) return;
                setSelectedXIndex(function(prev) {
                  return prev === i ? null : i;
                });
              }}
            />
            {refXVal != null && ReferenceLine ? (
              <ReferenceLine
                x={refXVal}
                stroke={PP_REF_LINE}
                strokeWidth={3}
                strokeDasharray="6 4"
                isFront={true}
                label={function(lp) { return React.createElement(ClickVerticalBadge, lp); }}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 메인 컴포넌트 ==========
// 심박 매트릭스와 동일: recentLogs 기반으로 즉시 렌더, goals는 비동기 로드 후 갱신
function RiderPowerProfileTrendCharts(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var userProfile = p.userProfile;
  var recentLogs = p.recentLogs;
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };
  var userWeight = userProfile && Number(userProfile.weight);
  var userId = userProfile && userProfile.id;

  var [goals, setGoals] = useState({});
  var [avgWkgByDuration, setAvgWkgByDuration] = useState({});

  useEffect(function() {
    var mounted = true;
    var fetchCohort = window.fetchDashboardPeakRankingCohort;
    if (typeof fetchCohort !== 'function') {
      setGoals({});
      setAvgWkgByDuration({});
      return function() { mounted = false; };
    }
    fetchCohort(userId || null, userWeight)
      .then(function(res) {
        if (!mounted) return;
        setGoals((res && res.goals) || {});
        setAvgWkgByDuration((res && res.avgWkgByDuration) || {});
      })
      .catch(function() {
        if (!mounted) return;
        setGoals({});
        setAvgWkgByDuration({});
      });
    return function() { mounted = false; };
  }, [userId, userWeight]);

  var logs = Array.isArray(recentLogs) ? recentLogs : [];
  var powerCurveData = buildPowerCurveData(logs, goals);
  var getIntervalMMP = window.getIntervalMMPFromLogs;
  var intervalMMP = getIntervalMMP ? getIntervalMMP(logs, 30, 6) : [];
  var monthCurveData = buildMonthPowerCurveData(intervalMMP);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1 flex items-center gap-2">
        <span className="inline-flex w-5 h-5 rounded-md flex-shrink-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} aria-hidden />
        파워 매트릭스
        {userWeight > 0 ? <span className="text-xs font-normal text-gray-500 ml-2">(체중 {userWeight}kg 기준)</span> : null}
      </h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-center px-1 mb-2 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm bg-[#3B82F6]" />나의 달성도</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm border-2 border-red-500 border-dashed" style={{ backgroundColor: 'transparent', opacity: 0.7 }} />타겟 목표</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden col-span-2">
          <PowerProfileCurveChart DashboardCard={Card} powerCurveData={powerCurveData} isFullWidth />
        </div>
        <div className="min-w-0 overflow-hidden col-span-2">
          <PowerProfileMonthCurveChart
            DashboardCard={Card}
            monthCurveData={monthCurveData}
            avgWkgByDuration={avgWkgByDuration}
            userWeight={userWeight}
            userProfile={userProfile}
            isFullWidth
          />
        </div>
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.RiderPowerProfileTrendCharts = RiderPowerProfileTrendCharts;
  window.PowerProfileCurveChart = PowerProfileCurveChart;
  window.PowerProfileMonthCurveChart = PowerProfileMonthCurveChart;
}
