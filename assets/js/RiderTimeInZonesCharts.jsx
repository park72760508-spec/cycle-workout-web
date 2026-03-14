/**
 * RiderTimeInZonesCharts - 파워/심박 존별 누적 시간 그래프 (최근 1개월)
 * '최근 1개월 심박 그래프' 아래에 배치
 * 프로필 선택 화면의 FTP/심박 존 색상 적용 (투명색, 둥근 모서리)
 * @see useRiderAnalysis.js - aggregateTimeInZonesFromLogs
 */

/* global React, Recharts */

// 프로필 선택 화면과 동일한 존 색상 (투명색 적용)
const POWER_ZONE_COLORS = [
  { z: 'Z0', color: 'rgba(156, 163, 175, 0.55)', label: 'Z0', pct: '0W' },
  { z: 'Z1', color: 'rgba(156, 163, 175, 0.55)', label: 'Z1', pct: '55% 미만' },
  { z: 'Z2', color: 'rgba(59, 130, 246, 0.55)', label: 'Z2', pct: '56~75%' },
  { z: 'Z3', color: 'rgba(34, 197, 94, 0.55)', label: 'Z3', pct: '76~90%' },
  { z: 'Z4', color: 'rgba(234, 179, 8, 0.55)', label: 'Z4', pct: '91~105%' },
  { z: 'Z5', color: 'rgba(249, 115, 22, 0.55)', label: 'Z5', pct: '106~120%' },
  { z: 'Z6', color: 'rgba(239, 68, 68, 0.55)', label: 'Z6', pct: '121~150%' },
  { z: 'Z7', color: 'rgba(168, 85, 247, 0.55)', label: 'Z7', pct: '150% 이상' }
];

const HR_ZONE_COLORS = [
  { z: 'Z1', color: 'rgba(156, 163, 175, 0.55)', label: 'Z1', pct: '50~60%' },
  { z: 'Z2', color: 'rgba(59, 130, 246, 0.55)', label: 'Z2', pct: '60~70%' },
  { z: 'Z3', color: 'rgba(34, 197, 94, 0.55)', label: 'Z3', pct: '70~80%' },
  { z: 'Z4', color: 'rgba(249, 115, 22, 0.55)', label: 'Z4', pct: '80~90%' },
  { z: 'Z5', color: 'rgba(239, 68, 68, 0.55)', label: 'Z5', pct: '90~100%' }
];

function getPowerZoneRanges(ftp) {
  const f = Number(ftp) || 0;
  if (f <= 0) {
    return POWER_ZONE_COLORS.map(function(z, i) {
      if (i === 0) return { ...z, range: '0W' };
      return { ...z, range: '-' };
    });
  }
  return [
    { ...POWER_ZONE_COLORS[0], range: '0W' },
    { ...POWER_ZONE_COLORS[1], range: '<' + Math.floor(f * 0.55) + 'W' },
    { ...POWER_ZONE_COLORS[2], range: Math.ceil(f * 0.56) + '~' + Math.floor(f * 0.75) + 'W' },
    { ...POWER_ZONE_COLORS[3], range: Math.ceil(f * 0.76) + '~' + Math.floor(f * 0.90) + 'W' },
    { ...POWER_ZONE_COLORS[4], range: Math.ceil(f * 0.91) + '~' + Math.floor(f * 1.05) + 'W' },
    { ...POWER_ZONE_COLORS[5], range: Math.ceil(f * 1.06) + '~' + Math.floor(f * 1.20) + 'W' },
    { ...POWER_ZONE_COLORS[6], range: Math.ceil(f * 1.21) + '~' + Math.floor(f * 1.50) + 'W' },
    { ...POWER_ZONE_COLORS[7], range: Math.ceil(f * 1.51) + 'W 이상' }
  ];
}

function getHRZoneRanges(maxHr) {
  const m = Number(maxHr) || 0;
  if (m <= 0) {
    return HR_ZONE_COLORS.map(function(z) { return { ...z, range: '-' }; });
  }
  return [
    { ...HR_ZONE_COLORS[0], range: Math.round(m * 0.50) + '~' + Math.round(m * 0.60) + 'bpm' },
    { ...HR_ZONE_COLORS[1], range: Math.round(m * 0.60) + '~' + Math.round(m * 0.70) + 'bpm' },
    { ...HR_ZONE_COLORS[2], range: Math.round(m * 0.70) + '~' + Math.round(m * 0.80) + 'bpm' },
    { ...HR_ZONE_COLORS[3], range: Math.round(m * 0.80) + '~' + Math.round(m * 0.90) + 'bpm' },
    { ...HR_ZONE_COLORS[4], range: Math.round(m * 0.90) + '~' + m + 'bpm' }
  ];
}

function formatSeconds(sec) {
  if (!sec || sec < 0) return '0:00';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

// ========== 파워 존별 누적 시간 막대 그래프 (Y축=시간, X축=Z0~Z7) ==========
function PowerTimeInZonesChart({ DashboardCard, powerData, ftp, isFullWidth }) {
  var Recharts = window.Recharts;
  var BarChart = Recharts && Recharts.BarChart;
  var Bar = Recharts && Recharts.Bar;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var Cell = Recharts && Recharts.Cell;
  var LabelList = Recharts && Recharts.LabelList;
  var Tooltip = Recharts && Recharts.Tooltip;

  var total = (powerData || []).reduce(function(s, d) { return s + (d.seconds || 0); }, 0);
  var hasData = total > 0;
  var zoneRanges = getPowerZoneRanges(ftp);

  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">파워 존별 누적 시간 (최근 1개월)</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(200px,50vw)] sm:h-[200px]' : 'h-[min(160px,40vw)] sm:h-[160px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  var data = (powerData || []).map(function(d, i) {
    var range = zoneRanges[i];
    return {
      name: d.zone,
      seconds: d.seconds,
      pct: total > 0 ? Math.round((d.seconds / total) * 100) : 0,
      color: range ? range.color : POWER_ZONE_COLORS[i].color
    };
  });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">파워 존별 누적 시간 (최근 1개월)</h3>
      </div>
      <div className={(isFullWidth ? 'h-[min(220px,55vw)] sm:h-[220px]' : 'h-[min(180px,45vw)] sm:h-[180px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 28, right: 12, left: 8, bottom: 64 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var idx = data.findIndex(function(d) { return d.name === payload.value; });
              var z = zoneRanges[idx] || { label: payload.value, color: 'rgba(156,163,175,0.55)', range: '' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label),
                React.createElement('text', { x: 0, y: 14, textAnchor: 'middle', fontSize: 9, fill: '#6b7280' }, z.range)
              );
            }} height={48} />
            <YAxis type="number" tickFormatter={function(v) { return formatSeconds(v); }} stroke="#6b7280" tick={{ fontSize: 12 }} width={56} />
            {Tooltip ? <Tooltip formatter={function(v) { return formatSeconds(v); }} contentStyle={{ fontSize: 12 }} labelFormatter={function(l) { return l + ' ' + (zoneRanges[data.findIndex(function(d) { return d.name === l; })] || {}).range; }} /> : null}
            <Bar dataKey="seconds" radius={[6, 6, 0, 0]} label={{ position: 'top', formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 11, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 심박 존별 누적 시간 막대 그래프 (Y축=시간, X축=Z1~Z5) ==========
function HRTimeInZonesChart({ DashboardCard, hrData, maxHr, isFullWidth }) {
  var Recharts = window.Recharts;
  var BarChart = Recharts && Recharts.BarChart;
  var Bar = Recharts && Recharts.Bar;
  var XAxis = Recharts && Recharts.XAxis;
  var YAxis = Recharts && Recharts.YAxis;
  var CartesianGrid = Recharts && Recharts.CartesianGrid;
  var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
  var Cell = Recharts && Recharts.Cell;
  var Tooltip = Recharts && Recharts.Tooltip;

  var total = (hrData || []).reduce(function(s, d) { return s + (d.seconds || 0); }, 0);
  var hasData = total > 0;
  var zoneRanges = getHRZoneRanges(maxHr);

  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">심박 존별 누적 시간 (최근 1개월)</h3>
        </div>
        <div className={(isFullWidth ? 'h-[min(200px,50vw)] sm:h-[200px]' : 'h-[min(160px,40vw)] sm:h-[160px]') + ' flex items-center justify-center text-gray-400 text-sm'}>데이터 없음</div>
      </DashboardCard>
    );
  }

  var data = (hrData || []).map(function(d, i) {
    var range = zoneRanges[i];
    return {
      name: d.zone,
      seconds: d.seconds,
      pct: total > 0 ? Math.round((d.seconds / total) * 100) : 0,
      color: range ? range.color : HR_ZONE_COLORS[i].color
    };
  });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-800 truncate">심박 존별 누적 시간 (최근 1개월)</h3>
      </div>
      <div className={(isFullWidth ? 'h-[min(220px,55vw)] sm:h-[220px]' : 'h-[min(180px,45vw)] sm:h-[180px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 28, right: 12, left: 8, bottom: 64 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var idx = data.findIndex(function(d) { return d.name === payload.value; });
              var z = zoneRanges[idx] || { label: payload.value, color: 'rgba(156,163,175,0.55)', range: '' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label),
                React.createElement('text', { x: 0, y: 14, textAnchor: 'middle', fontSize: 9, fill: '#6b7280' }, z.range)
              );
            }} height={48} />
            <YAxis type="number" tickFormatter={function(v) { return formatSeconds(v); }} stroke="#6b7280" tick={{ fontSize: 12 }} width={56} />
            {Tooltip ? <Tooltip formatter={function(v) { return formatSeconds(v); }} contentStyle={{ fontSize: 12 }} labelFormatter={function(l) { return l + ' ' + (zoneRanges[data.findIndex(function(d) { return d.name === l; })] || {}).range; }} /> : null}
            <Bar dataKey="seconds" radius={[6, 6, 0, 0]} label={{ position: 'top', formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 11, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 메인 컴포넌트 ==========
function RiderTimeInZonesCharts({ DashboardCard, userProfile, recentLogs }) {
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };

  var logs = Array.isArray(recentLogs) ? recentLogs : [];
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  var fromStr = thirtyDaysAgo.getFullYear() + '-' + String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(thirtyDaysAgo.getDate()).padStart(2, '0');
  var toStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  var agg = (typeof window.aggregateTimeInZonesFromLogs === 'function')
    ? window.aggregateTimeInZonesFromLogs(logs, fromStr, toStr)
    : { power: {}, hr: {} };

  var powerZones = agg.power || {};
  var hrZones = agg.hr || {};

  var powerData = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'].map(function(k) {
    return { zone: k.toUpperCase(), seconds: Number(powerZones[k]) || 0 };
  });

  var hrData = ['z1', 'z2', 'z3', 'z4', 'z5'].map(function(k) {
    return { zone: k.toUpperCase(), seconds: Number(hrZones[k]) || 0 };
  });

  var ftp = Number(userProfile && userProfile.ftp) || 0;
  var maxHr = Number(userProfile && userProfile.max_hr) || 0;
  if (!maxHr && typeof window.aggregateHRFromLogs === 'function') {
    var hrAgg = window.aggregateHRFromLogs(logs, fromStr, toStr);
    maxHr = hrAgg.max_hr || 190;
  }
  if (!maxHr) maxHr = 190;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1">존별 누적 시간 (최근 1개월)</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden col-span-2">
          <PowerTimeInZonesChart DashboardCard={Card} powerData={powerData} ftp={ftp} isFullWidth />
        </div>
        <div className="min-w-0 overflow-hidden col-span-2">
          <HRTimeInZonesChart DashboardCard={Card} hrData={hrData} maxHr={maxHr} isFullWidth />
        </div>
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.RiderTimeInZonesCharts = RiderTimeInZonesCharts;
  window.PowerTimeInZonesChart = PowerTimeInZonesChart;
  window.HRTimeInZonesChart = HRTimeInZonesChart;
}
