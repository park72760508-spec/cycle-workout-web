/**
 * RunJournalYearlyChart — RUN 연간(1~12월) 월별 막대 그래프
 * 라이딩 파워 영역별 누적시간 차트(PowerTimeInZonesChart) 디자인 참고
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var useState = R.useState;
  var useEffect = R.useEffect;
  var useMemo = R.useMemo;

  var MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  var BAR_COLOR_ACTIVE = 'rgba(124, 58, 237, 0.95)';
  var BAR_COLOR_DIM = 'rgba(167, 139, 250, 0.45)';

  var METRICS = [
    { id: 'duration', label: '시간', dataKey: 'hours' },
    { id: 'distance', label: '거리', dataKey: 'distanceKm' },
    { id: 'tss', label: 'TSS', dataKey: 'tss' },
    { id: 'count', label: '횟수', dataKey: 'runCount' },
  ];

  function sanitizeTss(val) {
    var n = Number(val) || 0;
    return n > 0 && n < 1200 ? n : 0;
  }

  function buildYearlyMonthlyData(trainingLogs, year) {
    var buckets = [];
    var i;
    for (i = 0; i < 12; i++) {
      buckets.push({
        name: MONTH_LABELS[i],
        month: i + 1,
        seconds: 0,
        hours: 0,
        distanceKm: 0,
        tss: 0,
        runCount: 0,
      });
    }
    Object.keys(trainingLogs || {}).forEach(function (dateKey) {
      if (!dateKey || dateKey.slice(0, 4) !== String(year)) return;
      var monthIdx = parseInt(dateKey.slice(5, 7), 10) - 1;
      if (monthIdx < 0 || monthIdx > 11) return;
      var arr = trainingLogs[dateKey];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (log) {
        var sec = Number(log.duration_sec != null ? log.duration_sec : log.time) || 0;
        buckets[monthIdx].seconds += sec;
        buckets[monthIdx].distanceKm += Number(log.distance_km) || 0;
        buckets[monthIdx].tss += sanitizeTss(log.tss);
        buckets[monthIdx].runCount += 1;
      });
    });
    buckets.forEach(function (b) {
      b.hours = b.seconds / 3600;
      b.distanceKm = Math.round(b.distanceKm * 10) / 10;
      b.tss = Math.round(b.tss);
    });
    return buckets;
  }

  function formatHoursForAxis(val) {
    if (!val || val < 0) return '0시간';
    return (val % 1 === 0 ? val : Number(val).toFixed(1)) + '시간';
  }

  function formatDistanceForAxis(val) {
    if (!val || val < 0) return '0km';
    return (val % 1 === 0 ? val : Number(val).toFixed(1)) + 'km';
  }

  function formatTssForAxis(val) {
    if (!val || val < 0) return '0';
    return String(Math.round(val));
  }

  function formatCountForAxis(val) {
    if (!val || val < 0) return '0';
    return String(Math.round(val));
  }

  function formatMetricValue(metricId, row) {
    if (!row) return '—';
    if (metricId === 'duration') {
      var h = Math.floor(row.seconds / 3600);
      var m = Math.round((row.seconds % 3600) / 60);
      if (h > 0 && m > 0) return h + '시간 ' + m + '분';
      if (h > 0) return h + '시간';
      return m + '분';
    }
    if (metricId === 'distance') return row.distanceKm.toFixed(1) + ' km';
    if (metricId === 'count') return row.runCount + '회';
    return String(row.tss);
  }

  function axisFormatter(metricId) {
    if (metricId === 'duration') return formatHoursForAxis;
    if (metricId === 'distance') return formatDistanceForAxis;
    if (metricId === 'count') return formatCountForAxis;
    return formatTssForAxis;
  }

  function RunJournalYearlyChart(props) {
    var trainingLogs = props.trainingLogs || {};
    var year = props.currentYear;
    var monthlyData = useMemo(function () {
      return buildYearlyMonthlyData(trainingLogs, year);
    }, [trainingLogs, year]);

    var _metric = useState('duration');
    var metricId = _metric[0];
    var setMetricId = _metric[1];

    var _sel = useState(null);
    var selectedIndex = _sel[0];
    var setSelectedIndex = _sel[1];

    var metric = METRICS.find(function (m) { return m.id === metricId; }) || METRICS[0];
    var dataKey = metric.dataKey;
    var hasData = monthlyData.some(function (d) { return Number(d[dataKey]) > 0; });

    useEffect(function () {
      if (!hasData) {
        setSelectedIndex(null);
        return;
      }
      var maxIdx = 0;
      var maxVal = 0;
      monthlyData.forEach(function (d, i) {
        if (Number(d[dataKey]) > maxVal) {
          maxVal = Number(d[dataKey]);
          maxIdx = i;
        }
      });
      setSelectedIndex(maxIdx);
    }, [hasData, metricId, monthlyData, dataKey]);

    var Recharts = window.Recharts;
    var BarChart = Recharts && Recharts.BarChart;
    var Bar = Recharts && Recharts.Bar;
    var XAxis = Recharts && Recharts.XAxis;
    var YAxis = Recharts && Recharts.YAxis;
    var CartesianGrid = Recharts && Recharts.CartesianGrid;
    var ResponsiveContainer = Recharts && Recharts.ResponsiveContainer;
    var Cell = Recharts && Recharts.Cell;
    var Tooltip = Recharts && Recharts.Tooltip;

    var selBar = selectedIndex != null ? monthlyData[selectedIndex] : null;
    var selValue = selBar ? formatMetricValue(metricId, selBar) : null;

    function applyPointerState(state) {
      if (!state || state.activeTooltipIndex == null) return;
      var idx = state.activeTooltipIndex;
      if (idx >= 0 && idx < monthlyData.length) setSelectedIndex(idx);
    }

    return R.createElement('div', { className: 'run-journal-yearly-chart' },
      R.createElement('div', { className: 'run-journal-yearly-chart-card' },
        R.createElement('div', { className: 'run-journal-yearly-chart-header' },
          R.createElement('h3', { className: 'run-journal-yearly-chart-title' },
            year + '년 월간 항목별 그래프'
          ),
          R.createElement('div', { className: 'run-journal-metric-pills', role: 'tablist', 'aria-label': '그래프 항목' },
            METRICS.map(function (m) {
              var active = m.id === metricId;
              return R.createElement('button', {
                key: m.id,
                type: 'button',
                role: 'tab',
                className: 'run-journal-metric-pill' + (active ? ' is-active' : ''),
                'aria-selected': active,
                onClick: function () { setMetricId(m.id); },
              }, m.label);
            })
          )
        ),
        !Recharts || !BarChart
          ? R.createElement('div', { className: 'run-journal-yearly-chart-empty' }, '차트를 불러오지 못했습니다.')
          : !hasData
            ? R.createElement('div', { className: 'run-journal-yearly-chart-empty' }, year + '년 RUN 기록이 없습니다.')
            : R.createElement('div', { className: 'run-journal-yearly-chart-canvas-wrap' },
              selBar
                ? R.createElement('div', { className: 'run-journal-yearly-chart-panel' },
                  R.createElement('div', { className: 'run-journal-yearly-chart-panel-inner' },
                    R.createElement('span', { className: 'run-journal-yearly-chart-panel-label' },
                      selBar.name + ' · ' + metric.label
                    ),
                    R.createElement('span', { className: 'run-journal-yearly-chart-panel-value' }, selValue)
                  )
                )
                : null,
              R.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
                R.createElement(BarChart, {
                  data: monthlyData,
                  margin: { top: 44, right: 12, left: 4, bottom: 24 },
                  onMouseMove: applyPointerState,
                },
                  CartesianGrid
                    ? R.createElement(CartesianGrid, { strokeDasharray: '3 3', stroke: '#e5e7eb', vertical: false })
                    : null,
                  XAxis
                    ? R.createElement(XAxis, {
                      type: 'category',
                      dataKey: 'name',
                      stroke: '#6b7280',
                      tickMargin: 10,
                      tick: { fontSize: 11, fill: '#374151' },
                      height: 28,
                    })
                    : null,
                  YAxis
                    ? R.createElement(YAxis, {
                      type: 'number',
                      tickFormatter: axisFormatter(metricId),
                      stroke: '#6b7280',
                      tick: { fontSize: 11 },
                      width: 48,
                    })
                    : null,
                  Tooltip
                    ? R.createElement(Tooltip, {
                      content: function () { return null; },
                      cursor: { fill: 'rgba(124, 58, 237, 0.06)' },
                      isAnimationActive: false,
                    })
                    : null,
                  Bar
                    ? R.createElement(Bar, {
                      dataKey: dataKey,
                      radius: [6, 6, 0, 0],
                      onClick: function (_d, index) {
                        if (index >= 0 && index < monthlyData.length) setSelectedIndex(index);
                      },
                    },
                      monthlyData.map(function (_entry, i) {
                        var fill = i === selectedIndex ? BAR_COLOR_ACTIVE : BAR_COLOR_DIM;
                        return Cell ? R.createElement(Cell, { key: i, fill: fill }) : null;
                      })
                    )
                    : null
                )
              )
            )
      )
    );
  }

  window.RunJournalYearlyChart = RunJournalYearlyChart;
})();
