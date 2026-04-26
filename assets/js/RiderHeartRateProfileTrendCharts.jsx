/**
 * RiderHeartRateProfileTrendCharts - 심박 매트릭스 (Heart Rate Matrix) 분석 그래프
 * 파워 매트릭스와 동일한 형식: 전 구간 심박 커브, 최근 1개월 심박 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * @see useRiderAnalysis.js - aggregateHRFromLogs, getIntervalHRFromLogs
 */

/* global React, Recharts */

var ReactObj = window.React || {};
var useState = ReactObj.useState || null;
var useEffect = ReactObj.useEffect || null;

// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _hrChartId = 0;
function nextHrChartId() { return 'hr-' + (++_hrChartId); }

/** 1·5·10·20·40·60분 → 성장 트렌드 슬롯 인덱스 (getGrowthStelvioReferencePowerHr) */
function monthHrApiToGrowthSlot(api) {
  if (api === '1min') return 1;
  if (api === '5min') return 2;
  if (api === '10min') return 3;
  if (api === '20min') return 4;
  if (api === '40min') return 5;
  if (api === '60min') return 6;
  return 1;
}

/** 최근 1개월 심박: 구간별 색·dataKey (파워 매트릭스와 동일 팔레트) */
var MONTH_HR_CURVE_ITEMS = [
  { api: '1min', dataKey: 'hr1min', label: '1분', color: '#ef4444' },
  { api: '5min', dataKey: 'hr5min', label: '5분', color: '#f97316' },
  { api: '10min', dataKey: 'hr10min', label: '10분', color: '#ca8a04' },
  { api: '20min', dataKey: 'hr20min', label: '20분', color: '#3b82f6' },
  { api: '40min', dataKey: 'hr40min', label: '40분', color: '#a855f7' },
  { api: '60min', dataKey: 'hr60min', label: '60분', color: '#22c55e' }
];

/** PR 큰 점 + bpm — 좌/우/상단 끝 잘림 방지 (최근 1개월 파워와 동일 로직) */
function growthStyleHrPrDot(R, prIdx, prBpm, lineColor, dataLen) {
  var smallFill = lineColor || '#ec4899';
  var len = dataLen == null || dataLen < 1 ? 1 : dataLen;
  return function(dotProps) {
    if (!R || !dotProps || dotProps.cx == null || dotProps.cy == null) return null;
    var cx = dotProps.cx;
    var cy = dotProps.cy;
    var idx = dotProps.index;
    if (prIdx < 0 || prBpm <= 0 || idx !== prIdx) {
      return R.createElement('circle', { cx: cx, cy: cy, r: 3, fill: smallFill, stroke: '#fff', strokeWidth: 1 });
    }
    var wTxt = String(Math.round(prBpm)) + ' bpm';
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
    var tLab = useLabelBelow ? cy + 20 : labelAboveY;
    var tBpm = R.createElement('text', { x: tx, y: tLab, textAnchor: anchor, fill: '#be185d', fontSize: 9, fontWeight: 'bold' }, wTxt);
    var cBig = R.createElement('circle', { cx: cx, cy: cy, r: 11, fill: smallFill, stroke: 'rgba(255,255,255,0.95)', strokeWidth: 1.5 });
    var tPr = R.createElement('text', { x: cx, y: cy, textAnchor: 'middle', dominantBaseline: 'middle', fill: '#fff', fontSize: 8, fontWeight: 'bold' }, 'PR');
    if (useLabelBelow) {
      return R.createElement('g', null, cBig, tPr, tBpm);
    }
    return R.createElement('g', null, tBpm, cBig, tPr);
  };
}

function getDateStr(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 심박 커브 X축 순서 (파워 커브와 동일) */
var HR_CURVE_DURATIONS = [
  { key: '5초', apiKey: 'max_hr_5sec' },
  { key: '1분', apiKey: 'max_hr_1min' },
  { key: '5분', apiKey: 'max_hr_5min' },
  { key: '10분', apiKey: 'max_hr_10min' },
  { key: '20분', apiKey: 'max_hr_20min' },
  { key: '40분', apiKey: 'max_hr_40min' },
  { key: '60분', apiKey: 'max_hr_60min' }
];

/** 로그에서 전 구간 심박 커브 데이터 생성 (최근 30일) */
function buildHeartRateCurveData(logs) {
  var agg = (logs && logs.length > 0 && window.aggregateHRFromLogs)
    ? window.aggregateHRFromLogs(logs, getDateStr(-30), getDateStr(0))
    : {};
  var m60 = agg.max_hr_60min || 0;
  var m20 = agg.max_hr_20min || 0;

  return HR_CURVE_DURATIONS.map(function(d) {
    var myHr = Number(agg[d.apiKey]) || 0;
    if (d.apiKey === 'max_hr_60min' && !myHr && m20 > 0) myHr = Math.round(m20 * 0.95);
    return { duration: d.key, name: d.key, hr: Math.round(myHr) };
  }).filter(function(r) { return r.hr > 0; });
}

/** 최근 1개월 구간별 심박 데이터 (1·5·10·20·40·60분) — 구간 내 로그별 피크의 최댓값 */
function buildMonthHeartRateCurveData(intervalHR) {
  return (intervalHR || []).map(function(row) {
    return {
      name: row.name,
      endStr: row.endStr != null && String(row.endStr).length ? String(row.endStr) : null,
      hr1min: Number(row.max_hr_1min) || 0,
      hr5min: Number(row.max_hr_5min) || 0,
      hr10min: Number(row.max_hr_10min) || 0,
      hr20min: Number(row.max_hr_20min) || 0,
      hr40min: Number(row.max_hr_40min) || 0,
      hr60min: Number(row.max_hr_60min) || 0
    };
  });
}

// ——— 최근 1개월 심박: 클릭 가이드 + 프로스티드 배지 (RiderPowerProfileTrendCharts PowerProfileMonthCurveChart와 동일 토큰) ———
var HR_PP_REF_LINE = '#7c3aed';
var HR_PP_REF_STROKE_W = 3;
var HR_PP_REF_DASH = '6 4';
var HR_MONTH_PLOT_M_TOP = 52;
var HR_MONTH_PLOT_M_R = 12;
var HR_PP_TINT_A_BG = 0.28;
var HR_PP_TINT_A_BORDER = 0.58;
var HR_PP_FROST = 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 100%)';
var HR_PP_BLUR = 'saturate(1.2) blur(16px)';

function hrPpHexToRgbParts(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6) return { r: 100, g: 116, b: 139 };
  var n = parseInt(h, 16);
  if (isNaN(n)) return { r: 100, g: 116, b: 139 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hrPpHexToRgba(hex, a) {
  var c = hrPpHexToRgbParts(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

function hrPpBadgeTextStyle(hex) {
  var c = hrPpHexToRgbParts(hex);
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

function monthHrChartMmDd(row) {
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

// ========== 전 구간 심박 커브 차트 ==========
function HeartRateProfileCurveChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var heartRateCurveData = p.heartRateCurveData;
  var isFullWidth = p.isFullWidth;
  var Recharts = window.Recharts;
  var AreaChart = Recharts && Recharts.AreaChart;
  var Area = Recharts && Recharts.Area;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var LabelList = Recharts && Recharts.LabelList;
  var cid = nextHrChartId();
  var data = heartRateCurveData || [];
  var labelFontSize = 10;

  if (!Recharts || !data.length) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">전 구간 심박 커브</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">전 구간 심박 커브</h3>
      </div>
      <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={cid + '-fillCurve'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="duration" interval={0} tickMargin={8} stroke="#6b7280" tick={(function() { var len = data.length; var fs = 12; return function(props) { var x = props.x, y = props.y, payload = props.payload, index = props.index; var isLast = index === len - 1; return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value); }; })()} />
            <YAxis width={32} tick={{ fontSize: 12 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={['auto', 'auto']} />
            <Area type="monotone" dataKey="hr" stroke="#ec4899" fill={'url(#' + cid + '-fillCurve)'} strokeWidth={2.5} name="나의 심박" dot={{ r: 4, fill: '#ec4899', stroke: '#fff', strokeWidth: 1 }} activeDot={{ r: 5, fill: '#ec4899', stroke: '#fff', strokeWidth: 2 }} connectNulls>{LabelList ? <LabelList dataKey="hr" position="top" fill="rgba(236,72,153,0.7)" fontSize={labelFontSize} /> : null}</Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 최근 1개월 심박 그래프 (구간 선택·코호트 평균 심박·PR) ==========
function HeartRateProfileMonthCurveChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var monthCurveData = p.monthCurveData;
  var userProfile = p.userProfile || null;
  var avgHrByDuration = p.avgHrByDuration || {};
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
  var cid = nextHrChartId();
  var data = monthCurveData || [];

  var _selState = useState('1min');
  var selectedApi = _selState[0];
  var setSelectedApi = _selState[1];
  var _xPick = useState(null);
  var selectedXIndex = _xPick[0];
  var setSelectedXIndex = _xPick[1];

  var selItem = MONTH_HR_CURVE_ITEMS[0];
  for (var _si = 0; _si < MONTH_HR_CURVE_ITEMS.length; _si++) {
    if (MONTH_HR_CURVE_ITEMS[_si].api === selectedApi) {
      selItem = MONTH_HR_CURVE_ITEMS[_si];
      break;
    }
  }
  var dataKey = selItem.dataKey;
  var selColor = selItem.color;

  var hasData = data.length > 0 && data.some(function(r) { return (r.hr1min || r.hr5min || r.hr10min || r.hr20min || r.hr40min || r.hr60min) > 0; });

  var hrFromApi = avgHrByDuration[selectedApi];
  var cohortAvgHrFromRolling = hrFromApi != null && !isNaN(Number(hrFromApi)) ? Math.round(Number(hrFromApi)) : null;
  var growthRef = typeof window.getGrowthStelvioReferencePowerHr === 'function'
    ? window.getGrowthStelvioReferencePowerHr(monthHrApiToGrowthSlot(selectedApi), userProfile)
    : null;
  var cohortAvgHr = cohortAvgHrFromRolling != null && cohortAvgHrFromRolling > 0
    ? cohortAvgHrFromRolling
    : (growthRef && growthRef.hr != null && growthRef.hr > 0 ? Math.round(growthRef.hr) : null);

  var prIdx = -1;
  var prBpm = 0;
  for (var _pi = 0; _pi < data.length; _pi++) {
    var _pv = Number(data[_pi][dataKey]) || 0;
    if (_pv > prBpm) {
      prBpm = _pv;
      prIdx = _pi;
    }
  }

  var yMax = 1;
  data.forEach(function(r) {
    var v = Number(r[dataKey]) || 0;
    if (v > yMax) yMax = v;
  });
  if (cohortAvgHr != null && cohortAvgHr > yMax) yMax = cohortAvgHr;
  yMax = Math.max(80, Math.ceil(yMax * 1.08 / 5) * 5);

  /** Y축: 100 ~ (현재 선택 구간의 최대 피크 PR × 1.2) */
  var yDomainMin = 100;
  var yDomainMax = prBpm > 0 ? Math.ceil(prBpm * 1.2) : yMax;
  if (yDomainMax <= yDomainMin) {
    yDomainMax = yDomainMin + 20;
  }
  var ReactForDot = window.React;

  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">최근 1개월 심박 그래프</h3>
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

  /** 호버 전용 — 프로스티 판넬(선택 고정)과 룩을 같게 하면 Recharts 툴팁이 ‘점선 따라다니는 배지’로 보임 */
  function monthHrChartHoverTip(tipProps) {
    var active = tipProps.active;
    var payload = tipProps.payload;
    if (!active || !payload || !payload.length) return null;
    var pl = payload[0].payload;
    if (!pl) return null;
    var b = Math.round(Number(pl[dataKey]) || 0);
    var mmdd2 = monthHrChartMmDd(pl);
    return (
      <div
        style={{
          padding: '6px 10px',
          fontSize: 12,
          lineHeight: 1.3,
          color: '#334155',
          background: 'rgba(255,255,255,0.96)',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          textAlign: 'center',
        }}
      >
        {b} bpm · {selItem.label} · {mmdd2}
      </div>
    );
  }

  var monthHrFixedSelectBadge = null;
  if (refXVal != null && selectedXIndex != null && data[selectedXIndex]) {
    var _mhRow = data[selectedXIndex];
    var _mhbv = Math.round(Number(_mhRow[dataKey]) || 0);
    var _mhMm = monthHrChartMmDd(_mhRow);
    var _mhBg = hrPpHexToRgba(selColor, HR_PP_TINT_A_BG);
    var _mhBd = hrPpHexToRgba(selColor, HR_PP_TINT_A_BORDER);
    var _mhTx = hrPpBadgeTextStyle(selColor);
    monthHrFixedSelectBadge = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          zIndex: 50,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            minHeight: 40,
            width: '100%',
            maxWidth: 'min(10.5rem, 95%)',
            padding: '0 6px',
            boxSizing: 'border-box',
            borderRadius: 10,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            border: '1.5px solid ' + _mhBd,
            background: HR_PP_FROST + ', ' + _mhBg,
            backdropFilter: HR_PP_BLUR,
            WebkitBackdropFilter: HR_PP_BLUR,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.45)',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              fontFeatureSettings: '"tnum"',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: _mhTx.color,
              textShadow: _mhTx.textShadow,
              WebkitFontSmoothing: 'antialiased',
            }}
          >
            {_mhbv} bpm
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 9,
              fontWeight: 500,
              lineHeight: 1.2,
              color: _mhTx.color,
              textShadow: _mhTx.textShadow,
              WebkitFontSmoothing: 'antialiased',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 8,
                flexShrink: 0,
                backgroundColor: selColor,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.85), 0 1px 2px rgba(0,0,0,0.25)',
              }}
              aria-hidden
            />
            <span>
              {selItem.label} | {_mhMm}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">최근 1개월 심박 그래프</h3>
        <div className="flex flex-wrap justify-center gap-1.5 mt-2 px-1">
          {MONTH_HR_CURVE_ITEMS.map(function(it) {
            var active = selectedApi === it.api;
            return (
              <button
                key={it.api}
                type="button"
                onClick={function() { setSelectedApi(it.api); setSelectedXIndex(null); }}
                className={
                  'relative flex items-center justify-center rounded-full min-w-[1.75rem] h-7 px-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow-sm border transition ' +
                  (active ? activeRing : 'border-white/30 hover:brightness-95')
                }
                style={{ backgroundColor: it.color }}
                title={it.label + ' 최대 심박'}
              >
                {it.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-2 border-dashed border-gray-400" style={{ verticalAlign: 'middle' }} />
            전체 사용자 평균 심박(최근 30일)
            {cohortAvgHr != null && cohortAvgHr > 0 ? (
              <span className="text-gray-500 tabular-nums">({cohortAvgHr}bpm)</span>
            ) : null}
          </span>
        </div>
      </div>
      <div
        className={
          (isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') +
          ' relative -mx-2 min-h-0 w-full [&_.recharts-responsive-container]:leading-[0] [&_svg]:block'
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: HR_MONTH_PLOT_M_TOP, right: HR_MONTH_PLOT_M_R, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={selColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={selColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              type="category"
              allowDuplicatedCategory={false}
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
            {cohortAvgHr != null && cohortAvgHr > 0 && ReferenceLine ? (
              <ReferenceLine y={cohortAvgHr} stroke="#9ca3af" strokeWidth={2} strokeDasharray="6 4" />
            ) : null}
            {Tooltip ? (
              <Tooltip content={monthHrChartHoverTip} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 3' }} />
            ) : null}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={selColor}
              fill={'url(#' + fillGradId + ')'}
              strokeWidth={2}
              name={selItem.label + ' 심박'}
              dot={growthStyleHrPrDot(ReactForDot, prIdx, prBpm, selColor, data.length)}
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
                stroke={HR_PP_REF_LINE}
                strokeWidth={HR_PP_REF_STROKE_W}
                strokeOpacity={1}
                strokeDasharray={HR_PP_REF_DASH}
                isFront={true}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
        {monthHrFixedSelectBadge}
      </div>
    </DashboardCard>
  );
}

// ========== 메인 컴포넌트 ==========
function RiderHeartRateProfileTrendCharts(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var userProfile = p.userProfile;
  var recentLogs = p.recentLogs;
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };

  var userId = userProfile && userProfile.id;
  var userWeight = userProfile && Number(userProfile.weight);
  var _hrAvgState = useState({});
  var avgHrByDuration = _hrAvgState[0];
  var setAvgHrByDuration = _hrAvgState[1];
  useEffect(function() {
    var mounted = true;
    var fetchCohort = window.fetchDashboardPeakRankingCohort;
    if (typeof fetchCohort !== 'function') {
      return function() { mounted = false; };
    }
    fetchCohort(userId || null, userWeight).then(function(res) {
      if (!mounted) return;
      setAvgHrByDuration((res && res.avgHrByDuration) || {});
    }).catch(function() {
      if (!mounted) return;
      setAvgHrByDuration({});
    });
    return function() { mounted = false; };
  }, [userId, userWeight]);

  var logs = Array.isArray(recentLogs) ? recentLogs : [];
  var getIntervalHR = window.getIntervalHRFromLogs;
  var intervalHR = getIntervalHR ? getIntervalHR(logs, 30, 6) : [];
  var heartRateCurveData = buildHeartRateCurveData(logs);
  var monthCurveData = buildMonthHeartRateCurveData(intervalHR);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1 flex items-center gap-2">
      <span className="inline-flex w-5 h-5 rounded-md flex-shrink-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} aria-hidden />
      심박 매트릭스
    </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden col-span-2">
          <HeartRateProfileCurveChart DashboardCard={Card} heartRateCurveData={heartRateCurveData} isFullWidth />
        </div>
        <div className="min-w-0 overflow-hidden col-span-2">
          <HeartRateProfileMonthCurveChart DashboardCard={Card} monthCurveData={monthCurveData} userProfile={userProfile} avgHrByDuration={avgHrByDuration} isFullWidth />
        </div>
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.RiderHeartRateProfileTrendCharts = RiderHeartRateProfileTrendCharts;
  window.HeartRateProfileCurveChart = HeartRateProfileCurveChart;
  window.HeartRateProfileMonthCurveChart = HeartRateProfileMonthCurveChart;
}
