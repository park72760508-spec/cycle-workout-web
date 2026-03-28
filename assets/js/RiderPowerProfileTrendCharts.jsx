/**
 * RiderPowerProfileTrendCharts - 파워 매트릭스 분석 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * 6개 그래프: TSPT, RSPT, PCH, CLMB, TTST, ALLR
 * 목표값: STELVIO 랭킹 보드 카테고리별 1등(장기), 나의 바로 앞선 경쟁자(단기)
 * @see useRiderAnalysis.js - getWeeklyMMPFromLogs, aggregateMMPFromLogs
 */

/* global React, Recharts */

if (!window.React) {
  console.warn("React is not loaded yet.");
}
var ReactObj = window.React || {};
var useState = ReactObj.useState || null;
var useEffect = ReactObj.useEffect || null;

const RANKING_API = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking';
// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _chartId = 0;
function nextChartId() { return 'pp-' + (++_chartId); }

/** 랭킹 byCategory 전체에서 사용자별 1회만 집계한 평균 W/kg (전 구간 동일 규칙) */
function computeAvgWkgFromRankingByCategory(data) {
  if (!data || !data.success || !data.byCategory) return null;
  var cats = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
  var seen = Object.create(null);
  var sum = 0;
  var n = 0;
  for (var c = 0; c < cats.length; c++) {
    var arr = data.byCategory[cats[c]] || [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (!e || !e.userId) continue;
      if (seen[e.userId]) continue;
      seen[e.userId] = true;
      var wkg = Number(e.wkg);
      if (wkg > 0) {
        sum += wkg;
        n++;
      }
    }
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * 단일 duration에 대한 랭킹 API 조회 (병렬 호출용)
 */
function fetchRankingForDuration(dur, userId, w) {
  var params = new URLSearchParams({ period: 'monthly', gender: 'all' });
  if (userId) params.set('uid', userId);
  params.set('duration', dur === 'max' ? 'max' : dur);
  return fetch(RANKING_API + '?' + params.toString(), { method: 'GET', mode: 'cors' })
    .then(function(res) { return res.json().catch(function() { return {}; }); })
    .then(function(data) {
      var avgWkg = computeAvgWkgFromRankingByCategory(data);
      if (!data.success || !data.byCategory) return { dur: dur, goals: null, avgWkg: avgWkg };
      var cats = ['Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
      var firstWkg = 0;
      var shortTermWkg = 0;
      var myIdx = -1;
      var myWatts = 0;
      for (var c = 0; c < cats.length; c++) {
        var arr = data.byCategory[cats[c]] || [];
        if (arr.length === 0) continue;
        var idx = userId ? arr.findIndex(function(e) { return e.userId === userId; }) : -1;
        if (idx >= 0) {
          myIdx = idx;
          myWatts = Number(arr[idx].watts) || 0;
          firstWkg = Number(arr[0].wkg) || 0;
          shortTermWkg = idx > 0 ? (Number(arr[idx - 1].wkg) || 0) : 0;
          break;
        }
        if (arr.length > 0 && firstWkg === 0) firstWkg = Number(arr[0].wkg) || 0;
      }
      var g = null;
      if (myIdx >= 0) {
        var longTerm = firstWkg > 0 ? Math.round(firstWkg * w) : 0;
        var shortTerm = 0;
        var isFirst = myIdx === 0;
        if (isFirst) shortTerm = Math.round(myWatts * 1.03);
        else shortTerm = shortTermWkg > 0 ? Math.round(shortTermWkg * w) : Math.round(longTerm * 0.95);
        g = { longTerm: isFirst ? null : longTerm, shortTerm: shortTerm, myWatts: myWatts, isFirst: isFirst };
      } else if (firstWkg > 0) {
        g = { longTerm: Math.round(firstWkg * w), shortTerm: Math.round(firstWkg * w * 0.95), myWatts: 0, isFirst: false };
      }
      return { dur: dur, goals: g, avgWkg: avgWkg };
    })
    .catch(function(e) {
      console.warn('[PowerProfileTrend] 랭킹 조회 실패:', dur, e);
      return { dur: dur, goals: null, avgWkg: null };
    });
}

/**
 * STELVIO 랭킹 API에서 카테고리별 1등(장기목표) 및 나의 바로 앞선 경쟁자(단기목표) 조회
 * 7개 duration을 병렬로 조회하여 로딩 시간 최소화 (심박 매트릭스와 동일하게 즉시 렌더)
 */
function fetchRankingGoals(userId, userWeight) {
  var durations = ['max', '1min', '5min', '10min', '20min', '40min', '60min'];
  var w = Number(userWeight) || 70;
  var uid = userId || null;
  var promises = durations.map(function(dur) { return fetchRankingForDuration(dur, uid, w); });
  return Promise.all(promises).then(function(results) {
    var goals = { max: {}, '1min': {}, '5min': {}, '10min': {}, '20min': {}, '40min': {}, '60min': {} };
    var avgWkgByDuration = {};
    results.forEach(function(r) {
      if (r && r.goals) goals[r.dur] = r.goals;
      if (r && r.avgWkg != null && !isNaN(r.avgWkg)) avgWkgByDuration[r.dur] = r.avgWkg;
    });
    return { goals: goals, avgWkgByDuration: avgWkgByDuration };
  });
}

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

/** 최근 1개월 주별 파워 데이터 (1분/5분/20분/60분) - 4선 그래프용 */
function buildMonthPowerCurveData(weeklyMMP) {
  return (weeklyMMP || []).map(function(row) {
    return {
      name: row.name,
      power1min: Number(row.max_1min_watts) || 0,
      power5min: Number(row.max_5min_watts) || 0,
      power20min: Number(row.max_20min_watts) || 0,
      power60min: Number(row.max_60min_watts) || 0
    };
  });
}

/** 최근 1개월 파워 그래프: 구간별 색·API키·dataKey */
var MONTH_POWER_CURVE_ITEMS = [
  { api: '1min', dataKey: 'power1min', label: '1분', color: '#ef4444' },
  { api: '5min', dataKey: 'power5min', label: '5분', color: '#f97316' },
  { api: '20min', dataKey: 'power20min', label: '20분', color: '#3b82f6' },
  { api: '60min', dataKey: 'power60min', label: '60분', color: '#22c55e' }
];

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
    return (r.power1min || r.power5min || r.power20min || r.power60min) > 0;
  });

  var avgWkgSel = avgWkgByDuration[selectedApi];
  var cohortAvgPower =
    userWeight > 0 && avgWkgSel != null && !isNaN(avgWkgSel)
      ? Math.round(avgWkgSel * userWeight)
      : null;

  var yMax = 1;
  data.forEach(function(r) {
    var v = Number(r[dataKey]) || 0;
    if (v > yMax) yMax = v;
  });
  if (cohortAvgPower != null && cohortAvgPower > yMax) yMax = cohortAvgPower;
  yMax = Math.max(10, Math.ceil(yMax * 1.12 / 10) * 10);

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
                  'relative flex items-center justify-center rounded-full min-w-[1.9rem] h-7 px-1 text-[10px] font-bold text-white shadow-sm border transition ' +
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
            전체 사용자 평균 파워
            {cohortAvgPower != null && cohortAvgPower > 0 ? (
              <span className="text-gray-500 tabular-nums">({cohortAvgPower}W)</span>
            ) : null}
          </span>
        </div>
      </div>
      <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={selColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={selColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" interval={0} tickMargin={8} stroke="#6b7280" tick={(function() { var len = data.length; var fs = 12; return function(props) { var x = props.x, y = props.y, payload = props.payload, index = props.index; var isLast = index === len - 1; return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value); }; })()} />
            <YAxis width={36} tick={{ fontSize: 11 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={[0, yMax]} />
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
              dot={{ r: 3, fill: selColor, stroke: '#fff', strokeWidth: 1 }}
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
    fetchRankingGoals(userId || null, userWeight).then(function(res) {
      if (!mounted) return;
      setGoals(res.goals || {});
      setAvgWkgByDuration(res.avgWkgByDuration || {});
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
  var intervalMMP = getIntervalMMP ? getIntervalMMP(logs, 30, 7) : [];
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
