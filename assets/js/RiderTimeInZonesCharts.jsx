/**
 * RiderTimeInZonesCharts - 파워/심박 존별 누적 시간 그래프 (최근 1개월)
 * '최근 1개월 심박 그래프' 아래에 배치
 * 프로필 선택 화면의 FTP/심박 존 색상 적용 (투명색, 둥근 모서리)
 * @see useRiderAnalysis.js - aggregateTimeInZonesFromLogs
 */

/* global React, Recharts */

// 프로필 선택 화면과 동일한 존 색상 (투명색 적용) - Z0는 Z1과 구분되도록 흐릿한 회색
const POWER_ZONE_COLORS = [
  { z: 'Z0', color: 'rgba(156, 163, 175, 0.28)', label: 'Z0', pct: '0W' },
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

/** Y축용: 시간(h)만 표시 */
function formatHoursOnly(sec) {
  if (!sec || sec < 0) return '0';
  return String(Math.floor(sec / 3600));
}

/** 파워존 데이터 기반 AI 분석 코멘트 (10줄 이내) + 보완점 */
function generatePowerZoneAnalysisComment(data) {
  if (!data || !data.length) return '';
  var total = data.reduce(function(s, d) { return s + (d.seconds || 0); }, 0);
  if (total <= 0) return '';
  var pcts = data.map(function(d, i) { return { zone: d.zone || 'Z' + i, pct: Math.round((d.seconds / total) * 100) }; });
  var z0 = (pcts[0] && pcts[0].pct) || 0, z1 = (pcts[1] && pcts[1].pct) || 0, z2 = (pcts[2] && pcts[2].pct) || 0;
  var z3 = (pcts[3] && pcts[3].pct) || 0, z4 = (pcts[4] && pcts[4].pct) || 0, z5 = (pcts[5] && pcts[5].pct) || 0;
  var z6 = (pcts[6] && pcts[6].pct) || 0, z7 = (pcts[7] && pcts[7].pct) || 0;
  var endurance = z2 + z3, intensity = z4 + z5 + z6 + z7, recovery = z0 + z1;
  var lines = [];
  if (z0 > 40) lines.push('• 휴식/코스팅(Z0) 비율이 높아 회복이 충분한 편입니다.');
  else if (z0 > 20) lines.push('• Z0 비율이 적정 수준으로, 휴식과 운동이 균형을 이룹니다.');
  if (endurance > 60) lines.push('• 저강도 지구력(Z2~Z3) 비중이 높아 기초 체력 강화에 유리합니다.');
  else if (endurance > 40) lines.push('• Z2~Z3 비율이 적정으로, 지구력 유지에 도움이 됩니다.');
  if (intensity > 30) lines.push('• 고강도 구간(Z4~Z7) 비율이 높아 FTP·VO2max 향상에 기여합니다.');
  else if (intensity > 15) lines.push('• 고강도 구간이 적당히 포함되어 있습니다.');
  if (z7 > 5) lines.push('• Z7(스프린트) 비율이 있어 무산소 능력 훈련이 이루어지고 있습니다.');
  if (recovery > 50 && intensity < 10) lines.push('• 저강도 위주 훈련으로, 고강도 구간 추가를 고려해 보세요.');
  if (lines.length === 0) lines.push('• 존 분포가 고르게 퍼져 있어 다양한 강도로 훈련하고 있습니다.');
  var improvements = [];
  if (z0 > 50) improvements.push('휴식(Z0) 비율을 줄이고 활성 회복(Z1~Z2)으로 전환해 보세요.');
  if (endurance < 30 && intensity < 20) improvements.push('저강도 지구력(Z2~Z3) 훈련을 늘려 기초 체력을 쌓아 보세요.');
  if (intensity < 10 && recovery < 60) improvements.push('고강도 구간(Z4~Z7)을 주 1~2회, 전체의 10~15% 수준으로 추가해 보세요.');
  if (z4 + z5 < 5 && z6 + z7 > 15) improvements.push('FTP 구간(Z4~Z5) 훈련을 늘려 지속 가능한 고강도 능력을 키워 보세요.');
  if (improvements.length > 0) {
    lines.push('');
    lines.push('【보완점】');
    improvements.forEach(function(t) { lines.push('• ' + t); });
  }
  return lines.slice(0, 12).join('\n');
}

/** 심박존 데이터 기반 AI 분석 코멘트 (10줄 이내) + 보완점 */
function generateHRZoneAnalysisComment(data) {
  if (!data || !data.length) return '';
  var total = data.reduce(function(s, d) { return s + (d.seconds || 0); }, 0);
  if (total <= 0) return '';
  var pcts = data.map(function(d, i) { return { zone: d.zone || 'Z' + (i + 1), pct: Math.round((d.seconds / total) * 100) }; });
  var z1 = (pcts[0] && pcts[0].pct) || 0, z2 = (pcts[1] && pcts[1].pct) || 0, z3 = (pcts[2] && pcts[2].pct) || 0;
  var z4 = (pcts[3] && pcts[3].pct) || 0, z5 = (pcts[4] && pcts[4].pct) || 0;
  var low = z1 + z2, mid = z3, high = z4 + z5;
  var lines = [];
  if (z1 > 40) lines.push('• 회복 구간(Z1) 비율이 높아 심박 회복이 양호합니다.');
  if (z2 + z3 > 60) lines.push('• 유산소 구간(Z2~Z3) 비중이 높아 지구력 훈련에 유리합니다.');
  if (z4 > 20) lines.push('• 역치 구간(Z4) 비율이 있어 심박 역치 훈련이 이루어지고 있습니다.');
  if (z5 > 10) lines.push('• 최대 심박 구간(Z5)이 포함되어 고강도 적응에 도움이 됩니다.');
  if (low > 70 && high < 10) lines.push('• 저강도 위주로, 고강도 구간을 점진적으로 늘려 보세요.');
  if (lines.length === 0) lines.push('• 심박 존 분포가 균형적입니다.');
  var improvements = [];
  if (z1 > 60) improvements.push('회복(Z1) 비율을 줄이고 Z2~Z3 유산소 구간을 늘려 보세요.');
  if (z2 + z3 < 30) improvements.push('유산소 구간(Z2~Z3) 훈련을 늘려 지구력 기반을 다져 보세요.');
  if (high < 5 && low > 50) improvements.push('역치·최대 구간(Z4~Z5)을 주 1회 정도 포함해 고강도 적응을 시도해 보세요.');
  if (z5 > 25) improvements.push('Z5 비율이 높습니다. 회복일을 충분히 두고 과훈련을 주의하세요.');
  if (improvements.length > 0) {
    lines.push('');
    lines.push('【보완점】');
    improvements.forEach(function(t) { lines.push('• ' + t); });
  }
  return lines.slice(0, 12).join('\n');
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
          <BarChart data={data} margin={{ top: 28, right: 16, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tickMargin={2} tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var idx = data.findIndex(function(d) { return d.name === payload.value; });
              var z = zoneRanges[idx] || { label: payload.value, color: 'rgba(156,163,175,0.55)' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label)
              );
            }} height={24} />
            <YAxis type="number" tickFormatter={formatHoursOnly} stroke="#6b7280" tick={{ fontSize: 12 }} width={40} />
            {Tooltip ? <Tooltip formatter={function(v) { return formatSeconds(v); }} contentStyle={{ fontSize: 12 }} labelFormatter={function(l) { return l + ' ' + (zoneRanges[data.findIndex(function(d) { return d.name === l; })] || {}).range; }} /> : null}
            <Bar dataKey="seconds" radius={[6, 6, 0, 0]} label={{ position: 'top', offset: 4, formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 12, fontWeight: 600, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{generatePowerZoneAnalysisComment(powerData)}</p>
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
          <BarChart data={data} margin={{ top: 28, right: 16, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tickMargin={2} tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var idx = data.findIndex(function(d) { return d.name === payload.value; });
              var z = zoneRanges[idx] || { label: payload.value, color: 'rgba(156,163,175,0.55)' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label)
              );
            }} height={24} />
            <YAxis type="number" tickFormatter={formatHoursOnly} stroke="#6b7280" tick={{ fontSize: 12 }} width={40} />
            {Tooltip ? <Tooltip formatter={function(v) { return formatSeconds(v); }} contentStyle={{ fontSize: 12 }} labelFormatter={function(l) { return l + ' ' + (zoneRanges[data.findIndex(function(d) { return d.name === l; })] || {}).range; }} /> : null}
            <Bar dataKey="seconds" radius={[6, 6, 0, 0]} label={{ position: 'top', offset: 4, formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 12, fontWeight: 600, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{generateHRZoneAnalysisComment(hrData)}</p>
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
