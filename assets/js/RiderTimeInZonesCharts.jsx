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

/** Y축용: 분(min) - 데이터가 이미 분 단위로 들어옴 */
function formatMinutesForAxis(val) {
  if (!val || val < 0) return '0분';
  return Math.round(val) + '분';
}

/** Y축용: 시간(h) - 데이터가 이미 시간 단위로 들어옴, 소수점 1자리까지 */
function formatHoursForAxis(val) {
  if (!val || val < 0) return '0시간';
  return (val % 1 === 0 ? val : val.toFixed(1)) + '시간';
}

/** 커스텀 Tooltip: 마우스 오버한 막대의 값만 표시 (Recharts 기본 툴팁이 전체 합계/다른 막대 값을 보여주는 문제 방지) */
function TimeInZonesTooltipContent(props) {
  var active = props.active;
  var payload = props.payload;
  var label = props.label;
  var zoneRanges = props.zoneRanges;
  var data = props.data;
  if (!active || !payload || !payload.length) return null;
  // label과 일치하는 payload 우선 선택 (막대-툴팁 값 일치 보장)
  var item = (label && payload.find(function(p) { return (p.payload && p.payload.name === label) || (p.name === label); })) || payload[0];
  // 막대 높이와 동일한 seconds 사용 (payload.seconds가 차트 data와 동일 소스)
  var value = (item && item.payload && item.payload.seconds != null) ? item.payload.seconds : (item && item.value != null ? item.value : null);
  if (value == null && item && item.payload) value = item.payload.seconds;
  var sec = Number(value);
  if (isNaN(sec) || sec < 0) sec = 0;
  var displayLabel = label || (item && item.payload && item.payload.name) || '';
  var idx = data && data.length ? data.findIndex(function(d) { return d.name === displayLabel; }) : -1;
  var rangeStr = (zoneRanges && idx >= 0 && zoneRanges[idx]) ? zoneRanges[idx].range : '';
  return React.createElement('div', { className: 'bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm' },
    React.createElement('div', { className: 'font-semibold text-gray-800' }, (displayLabel || '') + (rangeStr ? ' ' + rangeStr : '')),
    React.createElement('div', { className: 'text-gray-600' }, '시간: ' + formatSeconds(sec))
  );
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
function PowerTimeInZonesChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var powerData = p.powerData;
  var ftp = p.ftp;
  var isFullWidth = p.isFullWidth;
  var periodLabel = p.periodLabel;
  var hideComment = p.hideComment;
  var titleClassName = p.titleClassName;
  var yAxisUnit = p.yAxisUnit;
  var titleOverride = p.titleOverride;
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

  var powerTitle = titleOverride || '파워 영역별 누적시간';
  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className={(titleClassName || 'text-sm font-semibold text-gray-800') + ' truncate'}>{powerTitle}</h3>
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
      minutes: d.seconds / 60,
      hours: d.seconds / 3600,
      pct: total > 0 ? Math.round((d.seconds / total) * 100) : 0,
      color: range ? range.color : POWER_ZONE_COLORS[i].color
    };
  });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className={(titleClassName || 'text-sm font-semibold text-gray-800') + ' truncate'}>{powerTitle}</h3>
      </div>
      <div className={(isFullWidth ? 'h-[min(220px,55vw)] sm:h-[220px]' : 'h-[min(180px,45vw)] sm:h-[180px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 28, right: 16, left: 8, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tickMargin={12} tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var cat = (payload && (payload.value ?? payload.name ?? (payload.payload && (payload.payload.value ?? payload.payload.name)))) || '';
              var idx = data.findIndex(function(d) { return d.name === cat; });
              var z = zoneRanges[idx] || { label: cat, color: 'rgba(156,163,175,0.55)' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label)
              );
            }} height={20} />
            <YAxis type="number" tickFormatter={yAxisUnit === 'h' ? formatHoursForAxis : formatMinutesForAxis} stroke="#6b7280" tick={{ fontSize: 12 }} width={44} />
            {Tooltip ? React.createElement(Tooltip, { shared: false, content: React.createElement(TimeInZonesTooltipContent, { zoneRanges: zoneRanges, data: data }), contentStyle: { fontSize: 12 } }) : null}
            <Bar dataKey={yAxisUnit === 'h' ? 'hours' : 'minutes'} radius={[6, 6, 0, 0]} label={{ position: 'top', offset: 4, formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 12, fontWeight: 600, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!hideComment && (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{generatePowerZoneAnalysisComment(powerData)}</p>
      </div>
      )}
    </DashboardCard>
  );
}

// ========== 심박 존별 누적 시간 막대 그래프 (Y축=시간, X축=Z1~Z5) ==========
function HRTimeInZonesChart(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var hrData = p.hrData;
  var maxHr = p.maxHr;
  var maxHrSourceCaption = p.maxHrSourceCaption;
  var isFullWidth = p.isFullWidth;
  var periodLabel = p.periodLabel;
  var hideComment = p.hideComment;
  var titleClassName = p.titleClassName;
  var yAxisUnit = p.yAxisUnit;
  var titleOverride = p.titleOverride;
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

  var hrTitle = titleOverride || '심박 영역별 누적시간';
  if (!Recharts || !hasData) {
    return (
      <DashboardCard>
        <div className="mb-1 min-w-0">
          <h3 className={(titleClassName || 'text-sm font-semibold text-gray-800') + ' truncate'}>{hrTitle}</h3>
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
      minutes: d.seconds / 60,
      hours: d.seconds / 3600,
      pct: total > 0 ? Math.round((d.seconds / total) * 100) : 0,
      color: range ? range.color : HR_ZONE_COLORS[i].color
    };
  });

  return (
    <DashboardCard>
      <div className="mb-1 min-w-0">
        <h3 className={(titleClassName || 'text-sm font-semibold text-gray-800') + ' truncate'}>{hrTitle}</h3>
        {maxHrSourceCaption ? React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, maxHrSourceCaption) : null}
      </div>
      <div className={(isFullWidth ? 'h-[min(220px,55vw)] sm:h-[220px]' : 'h-[min(180px,45vw)] sm:h-[180px]') + ' -mx-2'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 28, right: 16, left: 8, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis type="category" dataKey="name" stroke="#6b7280" tickMargin={12} tick={function(props) {
              var x = props.x, y = props.y, payload = props.payload;
              var cat = (payload && (payload.value ?? payload.name ?? (payload.payload && (payload.payload.value ?? payload.payload.name)))) || '';
              var idx = data.findIndex(function(d) { return d.name === cat; });
              var z = zoneRanges[idx] || { label: cat, color: 'rgba(156,163,175,0.55)' };
              return React.createElement('g', { transform: 'translate(' + x + ',' + y + ')' },
                React.createElement('circle', { cx: 0, cy: 0, r: 10, fill: z.color, stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }),
                React.createElement('text', { x: 0, y: 0, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 10, fontWeight: 600, fill: '#1f2937' }, z.label)
              );
            }} height={20} />
            <YAxis type="number" tickFormatter={yAxisUnit === 'h' ? formatHoursForAxis : formatMinutesForAxis} stroke="#6b7280" tick={{ fontSize: 12 }} width={44} />
            {Tooltip ? React.createElement(Tooltip, { shared: false, content: React.createElement(TimeInZonesTooltipContent, { zoneRanges: zoneRanges, data: data }), contentStyle: { fontSize: 12 } }) : null}
            <Bar dataKey={yAxisUnit === 'h' ? 'hours' : 'minutes'} radius={[6, 6, 0, 0]} label={{ position: 'top', offset: 4, formatter: function(v, n, p) { var e = p && p.payload; return e && e.pct != null ? e.pct + '%' : ''; }, fontSize: 12, fontWeight: 600, fill: '#374151' }}>
              {data.map(function(entry, i) {
                return <Cell key={i} fill={entry.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!hideComment && (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{generateHRZoneAnalysisComment(hrData)}</p>
      </div>
      )}
    </DashboardCard>
  );
}

/** log.date에서 연도 추출 (Timestamp/문자열/Date 지원) */
function getYearFromLogDate(dateVal) {
  if (!dateVal) return new Date().getFullYear();
  if (dateVal.toDate && typeof dateVal.toDate === 'function') return dateVal.toDate().getFullYear();
  if (dateVal instanceof Date) return dateVal.getFullYear();
  if (typeof dateVal === 'string') return parseInt(dateVal.slice(0, 4), 10) || new Date().getFullYear();
  return new Date().getFullYear();
}

// ========== 메인 컴포넌트 ==========
function RiderTimeInZonesCharts(props) {
  var p = props || {};
  var DashboardCard = p.DashboardCard;
  var userProfile = p.userProfile;
  var recentLogs = p.recentLogs;
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
  var fallbackMaxHr = Number(userProfile && userProfile.max_hr) || 0;
  if (!fallbackMaxHr && typeof window.aggregateHRFromLogs === 'function') {
    var hrAgg = window.aggregateHRFromLogs(logs, fromStr, toStr);
    fallbackMaxHr = hrAgg.max_hr || 190;
  }
  if (!fallbackMaxHr) fallbackMaxHr = 190;

  var _useState = React.useState(fallbackMaxHr);
  var maxHr = _useState[0];
  var setMaxHr = _useState[1];
  React.useEffect(function() {
    var userId = userProfile && (userProfile.id || userProfile.uid);
    var year = today.getFullYear();
    if (!userId || typeof window.fetchMaxHrForYear !== 'function') return;
    window.fetchMaxHrForYear(userId, year).then(function(hr) {
      if (hr != null && hr > 0) setMaxHr(hr);
    }).catch(function() {});
  }, [userProfile && (userProfile.id || userProfile.uid)]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1 flex items-center gap-2">
      <span className="inline-flex w-5 h-5 rounded-md flex-shrink-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} aria-hidden />
      영역별 누적시간(최근 1개월)
    </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden col-span-2">
          <PowerTimeInZonesChart DashboardCard={Card} powerData={powerData} ftp={ftp} isFullWidth yAxisUnit="h" />
        </div>
        <div className="min-w-0 overflow-hidden col-span-2">
          <HRTimeInZonesChart DashboardCard={Card} hrData={hrData} maxHr={maxHr} isFullWidth yAxisUnit="h" />
        </div>
      </div>
    </div>
  );
}

/** 일일(당일) 존별 누적 시간 - 단일 로그용 (라이딩 상세 정보 모달) */
function DailyTimeInZonesCharts(props) {
  var p = props || {};
  var log = p.log;
  var userProfile = p.userProfile;
  var DashboardCard = p.DashboardCard;
  var Card = DashboardCard || function(props) { return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' }, props.children); };
  var tiz = log && log.time_in_zones;
  var powerZones = (tiz && tiz.power) || {};
  var hrZones = (tiz && tiz.hr) || {};
  var powerData = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'].map(function(k) {
    return { zone: k.toUpperCase(), seconds: Number(powerZones[k]) || 0 };
  });
  var hrData = ['z1', 'z2', 'z3', 'z4', 'z5'].map(function(k) {
    return { zone: k.toUpperCase(), seconds: Number(hrZones[k]) || 0 };
  });
  var ftp = Number(userProfile && userProfile.ftp) || 0;
  var fallbackMaxHr = Number(userProfile && userProfile.max_hr) || 190;
  var _useState = React.useState(fallbackMaxHr);
  var maxHr = _useState[0];
  var setMaxHr = _useState[1];
  var logYear = getYearFromLogDate(log && log.date);
  React.useEffect(function() {
    var userId = (userProfile && (userProfile.id || userProfile.uid)) || (log && (log.user_id || log.userId));
    if (!userId || !logYear || typeof window.fetchMaxHrForYear !== 'function') return;
    window.fetchMaxHrForYear(userId, logYear).then(function(hr) {
      if (hr != null && hr > 0) setMaxHr(hr);
    }).catch(function() {});
  }, [userProfile && (userProfile.id || userProfile.uid), log && (log.user_id || log.userId), logYear]);
  var hasPower = powerData.some(function(d) { return d.seconds > 0; });
  var hasHr = hrData.some(function(d) { return d.seconds > 0; });
  if (!hasPower && !hasHr) return null;
  var hrSourceCaption = (maxHr > 0 && logYear) ? '영역 기준: yearly_peaks/' + logYear + ' max_hr ' + maxHr + 'bpm' : null;
  return React.createElement('div', { className: 'training-detail-time-in-zones space-y-4' },
    React.createElement('h3', { className: 'text-sm font-semibold text-gray-800 mb-2' }, '영역별 누적 시간'),
    hasPower ? React.createElement(PowerTimeInZonesChart, { DashboardCard: Card, powerData: powerData, ftp: ftp, isFullWidth: true, yAxisUnit: 'm', titleOverride: '파워 영역 누적 시간' }) : null,
    hasHr ? React.createElement(HRTimeInZonesChart, { DashboardCard: Card, hrData: hrData, maxHr: maxHr, maxHrSourceCaption: hrSourceCaption, isFullWidth: true, yAxisUnit: 'm', titleOverride: '심박 영역 누적 시간' }) : null
  );
}

/** 모달용: DOM 컨테이너에 일일 존별 그래프 렌더링 */
function RenderDailyTimeInZonesCharts(container, log, userProfile) {
  var ReactDOM = window.ReactDOM;
  if (!container || !log || !window.React || !ReactDOM) return;
  var DashboardCard = function(props) { return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' }, props.children); };
  ReactDOM.render(
    React.createElement(DailyTimeInZonesCharts, { log: log, userProfile: userProfile || {}, DashboardCard: DashboardCard }),
    container
  );
}

/** 라이딩 일지용: 월별 누적 존별 시간 (코멘트 제거, 제목 폰트=Weekly TSS Load) */
function JournalTimeInZonesCharts(props) {
  var p = props || {};
  var currentMonth = p.currentMonth;
  var rawLogs = p.rawLogs;
  var userProfile = p.userProfile;
  var DashboardCard = p.DashboardCard;
  var Card = DashboardCard || function(props) { return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' }, props.children); };
  var logs = Array.isArray(rawLogs) ? rawLogs : [];
  var dateObj = currentMonth instanceof Date ? currentMonth : new Date(currentMonth);
  var year = dateObj.getFullYear();
  var monthNum = dateObj.getMonth() + 1;
  var now = new Date();
  var isCurrentMonth = (year === now.getFullYear() && monthNum === now.getMonth() + 1);
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var startStr, endStr, periodLabel, dateRangeShort;
  if (isCurrentMonth) {
    var endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = new Date(year, monthNum - 1, 1);
    startStr = startDate.getFullYear() + '-' + pad(startDate.getMonth() + 1) + '-' + pad(startDate.getDate());
    endStr = endDate.getFullYear() + '-' + pad(endDate.getMonth() + 1) + '-' + pad(endDate.getDate());
    periodLabel = year + '년 ' + monthNum + '월 (누적)';
    dateRangeShort = (startDate.getMonth() + 1) + '/' + startDate.getDate() + '~ ' + (endDate.getMonth() + 1) + '/' + endDate.getDate();
  } else {
    startStr = year + '-' + pad(monthNum) + '-01';
    var lastDay = new Date(year, monthNum, 0).getDate();
    endStr = year + '-' + pad(monthNum) + '-' + pad(lastDay);
    periodLabel = year + '년 ' + monthNum + '월';
    dateRangeShort = monthNum + '/1~ ' + monthNum + '/' + lastDay;
  }
  var agg = (typeof window.aggregateTimeInZonesFromLogs === 'function')
    ? window.aggregateTimeInZonesFromLogs(logs, startStr, endStr)
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
  var fallbackMaxHr = Number(userProfile && userProfile.max_hr) || 190;
  var _useState = React.useState(fallbackMaxHr);
  var maxHr = _useState[0];
  var setMaxHr = _useState[1];
  React.useEffect(function() {
    var userId = userProfile && (userProfile.id || userProfile.uid);
    if (!userId || typeof window.fetchMaxHrForYear !== 'function') return;
    window.fetchMaxHrForYear(userId, year).then(function(hr) {
      if (hr != null && hr > 0) setMaxHr(hr);
    }).catch(function() {});
  }, [userProfile && (userProfile.id || userProfile.uid), year]);
  var titleClass = 'text-sm font-semibold text-gray-700 mb-2';
  var hasAny = powerData.some(function(d) { return d.seconds > 0; }) || hrData.some(function(d) { return d.seconds > 0; });
  if (!hasAny) return null;
  var hrSourceCaption = (maxHr > 0 && year) ? '영역 기준: yearly_peaks/' + year + ' max_hr ' + maxHr + 'bpm' : null;
  return React.createElement('div', { className: 'space-y-4 mb-4' },
    React.createElement('h4', { className: titleClass }, '영역별 누적시간(' + dateRangeShort + ')'),
    React.createElement('div', { className: 'grid grid-cols-1 gap-3' },
      React.createElement(PowerTimeInZonesChart, { DashboardCard: Card, powerData: powerData, ftp: ftp, isFullWidth: true, hideComment: true, titleClassName: titleClass, yAxisUnit: 'h', titleOverride: '파워 영역별 누적시간' }),
      React.createElement(HRTimeInZonesChart, { DashboardCard: Card, hrData: hrData, maxHr: maxHr, maxHrSourceCaption: hrSourceCaption, isFullWidth: true, hideComment: true, titleClassName: titleClass, yAxisUnit: 'h', titleOverride: '심박 영역별 누적시간' })
    )
  );
}

if (typeof window !== 'undefined') {
  window.RiderTimeInZonesCharts = RiderTimeInZonesCharts;
  window.PowerTimeInZonesChart = PowerTimeInZonesChart;
  window.HRTimeInZonesChart = HRTimeInZonesChart;
  window.DailyTimeInZonesCharts = DailyTimeInZonesCharts;
  window.RenderDailyTimeInZonesCharts = RenderDailyTimeInZonesCharts;
  window.JournalTimeInZonesCharts = JournalTimeInZonesCharts;
}
