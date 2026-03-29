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

/** 성장 트렌드 차트와 동일: PR 원·라벨 (파워) */
function growthStylePowerPrDot(R, prIdx, prWatts, lineColor) {
  var smallFill = lineColor || '#3b82f6';
  return function(dotProps) {
    if (!R || !dotProps || dotProps.cx == null || dotProps.cy == null) return null;
    var cx = dotProps.cx;
    var cy = dotProps.cy;
    var idx = dotProps.index;
    if (prIdx < 0 || prWatts <= 0 || idx !== prIdx) {
      return R.createElement('circle', { cx: cx, cy: cy, r: 3, fill: smallFill, stroke: '#fff', strokeWidth: 1 });
    }
    return R.createElement(
      'g',
      null,
      R.createElement('text', { x: cx, y: cy - 20, textAnchor: 'middle', fill: '#1d4ed8', fontSize: 9, fontWeight: 'bold' }, Math.round(prWatts) + ' W'),
      R.createElement('circle', { cx: cx, cy: cy, r: 11, fill: '#3b82f6', stroke: 'rgba(255,255,255,0.95)', strokeWidth: 1.5 }),
      R.createElement('text', { x: cx, y: cy, textAnchor: 'middle', dominantBaseline: 'middle', fill: '#fff', fontSize: 8, fontWeight: 'bold' }, 'PR')
    );
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

// ========== 최근 1개월 파워 그래프 (구간 클릭 시 단일 곡선 + 전체 평균 W/kg×체중 점선) ==========
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
  var cid = nextChartId();
  var data = monthCurveData || [];

  var _selState = useState('1min');
  var selectedApi = _selState[0];
  var setSelectedApi = _selState[1];

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

  /** Y축: FTP/2 ~ (현재 선택 구간의 최대 피크 PR × 1.2) */
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
                onClick={function() { setSelectedApi(it.api); }}
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
      <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 26, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={selColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={selColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" interval={0} tickMargin={6} stroke="#6b7280" tick={(function() { var len = data.length; var fs = 11; return function(props) { var x = props.x, y = props.y, payload = props.payload, index = props.index; var isLast = index === len - 1; return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value); }; })()} />
            <YAxis width={36} tick={{ fontSize: 11 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={[yDomainMin, yDomainMax]} />
            {cohortAvgPower != null && cohortAvgPower > 0 && ReferenceLine ? (
              <ReferenceLine y={cohortAvgPower} stroke="#9ca3af" strokeWidth={2} strokeDasharray="6 4" />
            ) : null}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={selColor}
              fill={'url(#' + fillGradId + ')'}
              strokeWidth={2}
              name={selItem.label + ' 파워'}
              dot={growthStylePowerPrDot(ReactForDot, prIdx, prWatts, selColor)}
              connectNulls
            />
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
    fetchCohort(userId || null, userWeight).then(function(res) {
      if (!mounted) return;
      setGoals((res && res.goals) || {});
      setAvgWkgByDuration((res && res.avgWkgByDuration) || {});
    }).catch(function() {
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
