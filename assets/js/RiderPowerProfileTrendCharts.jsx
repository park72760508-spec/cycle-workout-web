/**
 * RiderPowerProfileTrendCharts - 파워 매트릭스 분석 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * 6개 그래프: TSPT, RSPT, PCH, CLMB, TTST, ALLR
 * 목표값: STELVIO 랭킹 보드 카테고리별 1등(장기), 나의 바로 앞선 경쟁자(단기)
 * @see useRiderAnalysis.js - getWeeklyMMPFromLogs, aggregateMMPFromLogs
 */

/* global React, Recharts */

const { useState, useEffect } = React;

const RANKING_API = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking';
// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _chartId = 0;
function nextChartId() { return 'pp-' + (++_chartId); }

/**
 * STELVIO 랭킹 API에서 카테고리별 1등(장기목표) 및 나의 바로 앞선 경쟁자(단기목표) 조회
 * W/kg 값을 사용자 체중으로 환산하여 절대 파워(W) 적용
 * 1등일 때: 단기목표만 표시 (본인 파워 * 1.03)
 */
async function fetchRankingGoals(userId, userWeight) {
  var goals = { max: {}, '1min': {}, '5min': {}, '10min': {}, '20min': {}, '40min': {}, '60min': {} };
  var durations = ['max', '1min', '5min', '10min', '20min', '40min', '60min'];
  var params = new URLSearchParams({ period: 'monthly', gender: 'all' });
  if (userId) params.set('uid', userId);
  var w = Number(userWeight) || 70;

  for (var i = 0; i < durations.length; i++) {
    var dur = durations[i];
    params.set('duration', dur === 'max' ? 'max' : dur);
    try {
      var res = await fetch(RANKING_API + '?' + params.toString(), { method: 'GET', mode: 'cors' });
      var data = await res.json().catch(function() { return {}; });
      if (!data.success || !data.byCategory) continue;

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
        if (arr.length > 0 && firstWkg === 0) {
          firstWkg = Number(arr[0].wkg) || 0;
        }
      }
      if (myIdx >= 0) {
        var longTerm = firstWkg > 0 ? Math.round(firstWkg * w) : 0;
        var shortTerm = 0;
        var isFirst = myIdx === 0;
        if (isFirst) {
          shortTerm = Math.round(myWatts * 1.03);
        } else {
          shortTerm = shortTermWkg > 0 ? Math.round(shortTermWkg * w) : Math.round(longTerm * 0.95);
        }
        goals[dur] = { longTerm: isFirst ? null : longTerm, shortTerm: shortTerm, myWatts: myWatts, isFirst: isFirst };
      } else if (firstWkg > 0) {
        goals[dur] = { longTerm: Math.round(firstWkg * w), shortTerm: Math.round(firstWkg * w * 0.95), myWatts: 0, isFirst: false };
      }
    } catch (e) {
      console.warn('[PowerProfileTrend] 랭킹 조회 실패:', dur, e);
    }
  }
  return goals;
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

// ========== 파워 커브 차트 (ALLR - Duration 기반) ==========
function PowerProfileCurveChart({ DashboardCard, powerCurveData, isFullWidth }) {
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
          <h3 className="text-xs font-semibold text-gray-800 truncate">전 구간 파워 커브(ALLR)</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  var hasTarget = data.some(function(r) { return (r.targetPower || 0) > 0; });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-xs font-semibold text-gray-800 truncate">전 구간 파워 커브(ALLR)</h3>
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

// ========== 최근 1개월 파워 그래프 (1분/5분/20분/60분 4선) ==========
function PowerProfileMonthCurveChart({ DashboardCard, monthCurveData, isFullWidth }) {
  var Recharts = window.Recharts;
  var AreaChart = Recharts && Recharts.AreaChart;
  var Area = Recharts && Recharts.Area;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var Tooltip = Recharts && Recharts.Tooltip;
  var cid = nextChartId();
  var data = monthCurveData || [];
  var hasData = data.length > 0 && data.some(function(r) { return (r.power1min || r.power5min || r.power20min || r.power60min) > 0; });

  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-xs font-semibold text-gray-800 truncate">최근 1개월 파워 그래프</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-xs font-semibold text-gray-800 truncate">최근 1개월 파워 그래프</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />1분</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f97316' }} />5분</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#3b82f6' }} />20분</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />60분</span>
        </div>
      </div>
      <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={cid + '-fill1min'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fill5min'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fill20min'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fill60min'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" interval={0} tickMargin={8} stroke="#6b7280" tick={(function() { var len = data.length; var fs = 12; return function(props) { var x = props.x, y = props.y, payload = props.payload, index = props.index; var isLast = index === len - 1; return React.createElement('text', { x: x, y: y, dy: 4, textAnchor: isLast ? 'end' : 'middle', fill: '#6b7280', fontSize: fs }, payload && payload.value); }; })()} />
            <YAxis width={32} tick={{ fontSize: 12 }} stroke="#6b7280" tickFormatter={function(v) { return String(v); }} domain={['auto', 'auto']} />
            {Tooltip ? <Tooltip formatter={function(v) { return v + ' W'; }} contentStyle={{ fontSize: 12 }} labelFormatter={function(label) { return label; }} /> : null}
            <Area type="monotone" dataKey="power1min" stroke="#ef4444" fill={'url(#' + cid + '-fill1min)'} strokeWidth={2} name="1분 파워" dot={{ r: 3, fill: '#ef4444', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="power5min" stroke="#f97316" fill={'url(#' + cid + '-fill5min)'} strokeWidth={2} name="5분 파워" dot={{ r: 3, fill: '#f97316', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="power20min" stroke="#3b82f6" fill={'url(#' + cid + '-fill20min)'} strokeWidth={2} name="20분 파워" dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="power60min" stroke="#22c55e" fill={'url(#' + cid + '-fill60min)'} strokeWidth={2} name="60분 파워" dot={{ r: 3, fill: '#22c55e', stroke: '#fff', strokeWidth: 1 }} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 메인 컴포넌트 ==========
function RiderPowerProfileTrendCharts({ DashboardCard, userProfile, recentLogs }) {
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };
  var userWeight = userProfile && Number(userProfile.weight);
  var userId = userProfile && userProfile.id;

  var [goals, setGoals] = useState({});
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    if (!userId) {
      setLoading(false);
      return;
    }
    var mounted = true;
    setLoading(true);
    fetchRankingGoals(userId, userWeight).then(function(g) {
      if (mounted) setGoals(g);
    }).catch(function() {
      if (mounted) setGoals({});
    }).finally(function() {
      if (mounted) setLoading(false);
    });
    return function() { mounted = false; };
  }, [userId, userWeight]);

  var logs = Array.isArray(recentLogs) ? recentLogs : [];
  var powerCurveData = buildPowerCurveData(logs, goals);
  var getIntervalMMP = window.getIntervalMMPFromLogs;
  var intervalMMP = getIntervalMMP ? getIntervalMMP(logs, 30, 7) : [];
  var monthCurveData = buildMonthPowerCurveData(intervalMMP);

  if (loading && Object.keys(goals).length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-gray-800 px-1">파워 매트릭스</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 items-center px-1 mb-2 text-xs text-gray-600">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm bg-[#3B82F6]" />나의 달성도</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm border-2 border-red-500 border-dashed" style={{ backgroundColor: 'transparent', opacity: 0.7 }} />타겟 목표</span>
        </div>
        <div className="space-y-4">
          <Card><div className="h-[min(180px,45vw)] sm:h-[180px] flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div></Card>
          <Card><div className="h-[min(180px,45vw)] sm:h-[180px] flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1">
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
          <PowerProfileMonthCurveChart DashboardCard={Card} monthCurveData={monthCurveData} isFullWidth />
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
