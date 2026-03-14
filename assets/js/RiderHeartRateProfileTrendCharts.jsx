/**
 * RiderHeartRateProfileTrendCharts - 심박 매트릭스 (Heart Rate Matrix) 분석 그래프
 * 파워 매트릭스와 동일한 형식: 전 구간 심박 커브, 최근 1개월 심박 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * @see useRiderAnalysis.js - aggregateHRFromLogs, getIntervalHRFromLogs
 */

/* global React, Recharts */

// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _hrChartId = 0;
function nextHrChartId() { return 'hr-' + (++_hrChartId); }

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

/** 최근 1개월 구간별 심박 데이터 (1분/5분/20분/60분 4선) */
function buildMonthHeartRateCurveData(intervalHR) {
  return (intervalHR || []).map(function(row) {
    return {
      name: row.name,
      hr1min: Number(row.max_hr_1min) || 0,
      hr5min: Number(row.max_hr_5min) || 0,
      hr20min: Number(row.max_hr_20min) || 0,
      hr60min: Number(row.max_hr_60min) || 0
    };
  });
}

// ========== 전 구간 심박 커브 차트 ==========
function HeartRateProfileCurveChart({ DashboardCard, heartRateCurveData, isFullWidth }) {
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
          <h3 className="font-semibold text-gray-800 truncate" style={{ fontSize: 'clamp(9px, 2.2vw, 13px)' }}>전 구간 심박 커브</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="font-semibold text-gray-800 truncate" style={{ fontSize: 'clamp(9px, 2.2vw, 13px)' }}>전 구간 심박 커브</h3>
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

// ========== 최근 1개월 심박 그래프 (1분/5분/20분/60분 4선) ==========
function HeartRateProfileMonthCurveChart({ DashboardCard, monthCurveData, isFullWidth }) {
  var Recharts = window.Recharts;
  var AreaChart = Recharts && Recharts.AreaChart;
  var Area = Recharts && Recharts.Area;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var Tooltip = Recharts && Recharts.Tooltip;
  var cid = nextHrChartId();
  var data = monthCurveData || [];
  var hasData = data.length > 0 && data.some(function(r) { return (r.hr1min || r.hr5min || r.hr20min || r.hr60min) > 0; });

  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="font-semibold text-gray-800 truncate" style={{ fontSize: 'clamp(9px, 2.2vw, 13px)' }}>최근 1개월 심박 그래프</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(180px,45vw)] sm:h-[180px]' : 'h-[min(140px,31.5vw)] sm:h-[140px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="font-semibold text-gray-800 truncate" style={{ fontSize: 'clamp(9px, 2.2vw, 13px)' }}>최근 1개월 심박 그래프</h3>
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
            {Tooltip ? <Tooltip formatter={function(v) { return v + ' bpm'; }} contentStyle={{ fontSize: 12 }} labelFormatter={function(label) { return label; }} /> : null}
            <Area type="monotone" dataKey="hr1min" stroke="#ef4444" fill={'url(#' + cid + '-fill1min)'} strokeWidth={2} name="1분 심박" dot={{ r: 3, fill: '#ef4444', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="hr5min" stroke="#f97316" fill={'url(#' + cid + '-fill5min)'} strokeWidth={2} name="5분 심박" dot={{ r: 3, fill: '#f97316', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="hr20min" stroke="#3b82f6" fill={'url(#' + cid + '-fill20min)'} strokeWidth={2} name="20분 심박" dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 1 }} connectNulls />
            <Area type="monotone" dataKey="hr60min" stroke="#22c55e" fill={'url(#' + cid + '-fill60min)'} strokeWidth={2} name="60분 심박" dot={{ r: 3, fill: '#22c55e', stroke: '#fff', strokeWidth: 1 }} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 메인 컴포넌트 ==========
function RiderHeartRateProfileTrendCharts({ DashboardCard, userProfile, recentLogs }) {
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };

  var logs = Array.isArray(recentLogs) ? recentLogs : [];
  var getIntervalHR = window.getIntervalHRFromLogs;
  var intervalHR = getIntervalHR ? getIntervalHR(logs, 30, 7) : [];
  var heartRateCurveData = buildHeartRateCurveData(logs);
  var monthCurveData = buildMonthHeartRateCurveData(intervalHR);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1">심박 매트릭스 (Heart Rate Matrix)</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden col-span-2">
          <HeartRateProfileCurveChart DashboardCard={Card} heartRateCurveData={heartRateCurveData} isFullWidth />
        </div>
        <div className="min-w-0 overflow-hidden col-span-2">
          <HeartRateProfileMonthCurveChart DashboardCard={Card} monthCurveData={monthCurveData} isFullWidth />
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
