/**
 * JournalDetailBottomSheet - 라이딩 상세 3탭 (Summary / Power Profile / Heart Rate)
 * 모바일 친화적 Bottom Sheet, 27개 항목 그룹화
 * Power/HR 피크 막대: 대시보드 년간 파워PR 그래프(YearlyPowerPrChart) 색상·레이아웃 패턴
 */
/* global React, useState, useRef, useEffect, Chart */

(function() {
  'use strict';

  if (!window.React) return;

  var ReactObj = window.React;
  var useState = ReactObj.useState;
  var useRef = ReactObj.useRef;
  var useEffect = ReactObj.useEffect;

  /** YearlyPowerPrChart와 동일 존 색상 (막대 7개) */
  var JOURNAL_PEAK_ZONE_COLORS = [
    'rgba(156, 163, 175, 0.7)',
    'rgba(59, 130, 246, 0.7)',
    'rgba(34, 197, 94, 0.7)',
    'rgba(234, 179, 8, 0.7)',
    'rgba(249, 115, 22, 0.7)',
    'rgba(239, 68, 68, 0.7)',
    'rgba(168, 85, 247, 0.7)'
  ];

  var AVG_GUIDE_LINE = 'rgba(249, 115, 22, 0.45)';

  /** 짧은 구간 ≥ 긴 구간(파워·심박 공통 원칙) — 저장 단계에서 이미 보정되지만, 서로 다른 시점/
   * 소스에서 채워진 값이 섞여 들어올 수 있어 화면에 그리기 직전 한 번 더 눌러준다(2026-08).
   * rows는 이미 짧은→긴 구간 순서로 정렬돼 있다고 가정한다. */
  function capPeakRowsMonotonicDesc(rows) {
    for (var i = 1; i < rows.length; i++) {
      if (rows[i - 1].val > 0 && rows[i].val > rows[i - 1].val) {
        rows[i] = Object.assign({}, rows[i], { val: rows[i - 1].val });
      }
    }
    return rows;
  }

  /** journal-detail-value와 동일: 14px, font-weight 600 */
  var JOURNAL_PEAK_BAR_VALUE_FONT = '600 14px sans-serif';

  /** Summary 파워 존 그래프(PowerTimeInZonesCharts) X축 Z0~Z7: fontSize 10, fontWeight 600, 원 r=10 */
  var JOURNAL_PEAK_AXIS_LABEL_FONT = '600 10px sans-serif';
  var JOURNAL_PEAK_AXIS_CIRCLE_R = 10;

  var PR_BADGE_BG = '#dc2626';
  var PR_BADGE_TEXT = '#ffffff';

  function fillRoundRect(ctx, x, y, w, h, r, fillStyle) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  /** 막대 상단: PR이면 빨간 둥근 배경 + 흰 글자, 아니면 회색 글자 */
  function drawPeakBarTopValue(ctx, text, x, yMid, isPr) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = JOURNAL_PEAK_BAR_VALUE_FONT;
    if (!isPr) {
      ctx.fillStyle = '#374151';
      ctx.fillText(text, x, yMid);
      return;
    }
    var padX = 6;
    var padY = 4;
    var m = ctx.measureText(text);
    var pillW = m.width + padX * 2;
    var pillH = 20;
    var r = 4;
    fillRoundRect(ctx, x - pillW / 2, yMid - pillH / 2, pillW, pillH, r, PR_BADGE_BG);
    ctx.fillStyle = PR_BADGE_TEXT;
    ctx.fillText(text, x, yMid);
  }

  /**
   * 단위(W|bpm) + PR 범례 — 차트 가로를 3등분: 가운데 1/3 중앙에 단위, 오른쪽 1/3 안에서 PR 우측 정렬
   */
  function drawUnitRowWithOptionalPrLegend(ctx, chartArea, unitStr, showPrLegend) {
    var left = chartArea.left;
    var w = chartArea.right - chartArea.left;
    var third = w / 3;
    var unitCenterX = left + third + third / 2;
    var yRow = chartArea.top - 10;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText(unitStr, unitCenterX, yRow);
    if (showPrLegend) {
      ctx.font = 'bold 11px sans-serif';
      var prW = ctx.measureText('PR').width + 12;
      var badgeH = 14;
      var bx = chartArea.right - prW;
      fillRoundRect(ctx, bx, yRow - badgeH / 2, prW, badgeH, 4, PR_BADGE_BG);
      ctx.fillStyle = PR_BADGE_TEXT;
      ctx.textAlign = 'center';
      ctx.fillText('PR', bx + prW / 2, yRow);
    }
    ctx.restore();
  }

  function borderRgbFromZone(i) {
    var c = JOURNAL_PEAK_ZONE_COLORS[i] || 'rgba(156,163,175,0.7)';
    return c.replace('0.7)', '1)').replace('0.55)', '1)');
  }

  /** max_hr_5sec 누락(Supabase 이전 데이터) 시 max_hr 폴백 */
  function resolveMaxHr5Sec(log) {
    if (typeof window.resolveMaxHr5Sec === 'function') {
      return window.resolveMaxHr5Sec(log);
    }
    if (!log) return 0;
    var v5 = Number(log.max_hr_5sec) || 0;
    if (v5 > 0) return v5;
    return Number(log.max_hr || log.max_heartrate) || 0;
  }

  /**
   * Heart Rate 막대 PR: 구간 필드 PR 또는
   * 최대심박(max_hr) PR인데 5초 값이 최대심박과 동일한 경우 5초 막대에 PR 표시
   */
  function hrPeakBarIsPr(row, log, prFn) {
    if (!row || !log || typeof prFn !== 'function') return false;
    if (prFn(row.field)) return true;
    if (row.field !== 'max_hr_5sec' || !(row.val > 0)) return false;
    var maxHr = Number(log.max_hr) || 0;
    var hr5 = resolveMaxHr5Sec(log);
    if (maxHr <= 0 || hr5 <= 0) return false;
    if (Math.round(maxHr) !== Math.round(hr5)) return false;
    return prFn('max_hr');
  }

  function sessionPowerChartKey(log, yearlyPeaks, userWeight) {
    if (!log) return '';
    var peakParts = [];
    if (yearlyPeaks) {
      ['max_watts', 'max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_40min_watts', 'max_60min_watts'].forEach(function(f) {
        peakParts.push(yearlyPeaks[f]);
        // W/kg 저장 필드도 키에 포함 (사전 계산된 _wkg 값 변경 시 차트 재생성)
        var wkgKey = f.replace('_watts', '_wkg');
        if (yearlyPeaks[wkgKey] != null) peakParts.push(yearlyPeaks[wkgKey]);
      });
    }
    var pk = peakParts.join(',');
    return [
      userWeight,
      log.weight || 0,
      pk,
      log.avg_watts,
      log.max_watts,
      log.max_1min_watts,
      log.max_5min_watts,
      log.max_10min_watts,
      log.max_20min_watts,
      log.max_40min_watts,
      log.max_60min_watts
    ].join('|');
  }

  function sessionHrChartKey(log, yearlyPeaks, userWeight) {
    if (!log) return '';
    var peakParts = [];
    if (yearlyPeaks) {
      peakParts.push(yearlyPeaks.max_hr);
      ['max_hr_5sec', 'max_hr_1min', 'max_hr_5min', 'max_hr_10min', 'max_hr_20min', 'max_hr_40min', 'max_hr_60min'].forEach(function(f) {
        peakParts.push(yearlyPeaks[f]);
      });
    }
    return [
      userWeight,
      log.weight || 0,
      peakParts.join(','),
      log.avg_hr,
      log.max_hr,
      resolveMaxHr5Sec(log),
      log.max_hr_1min,
      log.max_hr_5min,
      log.max_hr_10min,
      log.max_hr_20min,
      log.max_hr_40min,
      log.max_hr_60min
    ].join('|');
  }

  /**
   * 세션 파워 피크 막대 + 평균 파워 가이드(주황 실선)
   */
  function JournalSessionPowerPeakChart(props) {
    var log = props.log;
    var userWeight = Number(props.userWeight) || 0;
    var yearlyPeaks = props.yearlyPeaks;
    var chartRef = useRef(null);
    var chartInst = useRef(null);
    var depKey = sessionPowerChartKey(log, yearlyPeaks, userWeight);

    useEffect(function() {
      if (chartInst.current) {
        chartInst.current.destroy();
        chartInst.current = null;
      }
      if (!log || typeof Chart === 'undefined') return;
      var ctx = chartRef.current && chartRef.current.getContext('2d');
      if (!ctx) return;
      var rows = [
        { label: '최대 파워', shortLabel: 'Max', field: 'max_watts', val: Number(log.max_watts) || 0 },
        { label: '1분', shortLabel: '1분', field: 'max_1min_watts', val: Number(log.max_1min_watts) || 0 },
        { label: '5분', shortLabel: '5분', field: 'max_5min_watts', val: Number(log.max_5min_watts) || 0 },
        { label: '10분', shortLabel: '10', field: 'max_10min_watts', val: Number(log.max_10min_watts) || 0 },
        { label: '20분', shortLabel: '20', field: 'max_20min_watts', val: Number(log.max_20min_watts) || 0 },
        { label: '40분', shortLabel: '40', field: 'max_40min_watts', val: Number(log.max_40min_watts) || 0 },
        { label: '60분', shortLabel: '60', field: 'max_60min_watts', val: Number(log.max_60min_watts) || 0 }
      ];
      capPeakRowsMonotonicDesc(rows);
      var wattsValues = rows.map(function(r) { return r.val; });
      var avgGuide = Number(log.avg_watts) > 0 ? Number(log.avg_watts) : 0;
      var hasAnyBar = wattsValues.some(function(w) { return w > 0; });
      if (!hasAnyBar) return;

      var wKg = userWeight > 0 ? Math.max(userWeight, 45) : 0;
      var numsForMax = wattsValues.slice();
      if (avgGuide > 0) numsForMax.push(avgGuide);
      var maxW = Math.max.apply(null, numsForMax.filter(function(n) { return n > 0; }));
      var yMax = Math.ceil(maxW * 1.15 / 50) * 50 || 350;

      var prFn = typeof window.isPrField === 'function'
        ? function(field) { return window.isPrField(log, yearlyPeaks, field, userWeight); }
        : function() { return false; };

      var hasChartPr = rows.some(function(r) { return r.val > 0 && prFn(r.field); });
      var barBorderColors = rows.map(function(r, i) {
        return borderRgbFromZone(i);
      });
      var barBorderWidths = rows.map(function() { return 1; });

      var labels = rows.map(function(r) { return r.label; });
      var plugin = {
        id: 'journalPowerPeakLabels',
        afterDatasetsDraw: function(chart) {
          var meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data || meta.data.length === 0) return;
          var chartArea = chart.chartArea;
          var bottom = chartArea.bottom;
          var radius = JOURNAL_PEAK_AXIS_CIRCLE_R;
          var circleY = bottom + radius + 4;
          chart.ctx.save();
          meta.data.forEach(function(bar, i) {
            if (!bar || bar.x == null || bar.y == null) return;
            var row = rows[i];
            if (row.val > 0) {
              drawPeakBarTopValue(
                chart.ctx,
                String(Math.round(row.val)),
                bar.x,
                bar.y - 12,
                prFn(row.field)
              );
            }
            var color = JOURNAL_PEAK_ZONE_COLORS[i] || 'rgba(156,163,175,0.7)';
            chart.ctx.beginPath();
            chart.ctx.arc(bar.x, circleY, radius, 0, Math.PI * 2);
            chart.ctx.fillStyle = color;
            chart.ctx.fill();
            chart.ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            chart.ctx.lineWidth = 1;
            chart.ctx.stroke();
            chart.ctx.fillStyle = '#1f2937';
            chart.ctx.font = JOURNAL_PEAK_AXIS_LABEL_FONT;
            chart.ctx.textAlign = 'center';
            chart.ctx.textBaseline = 'middle';
            chart.ctx.fillText(row.shortLabel, bar.x, circleY);
          });
          if (chartArea) {
            drawUnitRowWithOptionalPrLegend(chart.ctx, chartArea, 'W', hasChartPr);
          }
          chart.ctx.restore();
        }
      };

      var datasets = [
        {
          type: 'bar',
          label: '파워 (W)',
          data: wattsValues,
          backgroundColor: rows.map(function(d, i) { return JOURNAL_PEAK_ZONE_COLORS[i]; }),
          borderColor: barBorderColors,
          borderWidth: barBorderWidths,
          borderRadius: { topLeft: 6, topRight: 6 },
          order: 0
        }
      ];
      if (avgGuide > 0) {
        datasets.push({
          type: 'line',
          label: '평균 파워',
          data: labels.map(function() { return avgGuide; }),
          borderColor: AVG_GUIDE_LINE,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          hitRadius: 0,
          fill: false,
          order: 1,
          tension: 0
        });
      }

      chartInst.current = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 40, bottom: 48 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  var i = ctx.dataIndex;
                  if (ctx.datasetIndex === 1) return '평균 파워: ' + Math.round(avgGuide) + ' W';
                  if (rows[i] && rows[i].val > 0) {
                    var parts = [rows[i].label + ': ' + Math.round(rows[i].val) + ' W'];
                    if (prFn(rows[i].field)) parts.push('PR');
                    if (wKg > 0) parts.push('W/kg: ' + (Math.round((rows[i].val / wKg) * 100) / 100).toFixed(2));
                    return parts;
                  }
                  return rows[i] ? rows[i].label + ': —' : '';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false }
            },
            y: {
              beginAtZero: true,
              max: yMax,
              grid: { color: '#e5e7eb' },
              ticks: {
                font: { size: 11 },
                color: '#6b7280',
                callback: function(v) {
                  return v === 0 ? '0W' : String(v);
                }
              }
            }
          }
        },
        plugins: [plugin]
      });

      return function cleanup() {
        if (chartInst.current) {
          chartInst.current.destroy();
          chartInst.current = null;
        }
      };
    }, [depKey]);

    if (!log) return null;
    var wv = [
      Number(log.max_watts) || 0,
      Number(log.max_1min_watts) || 0,
      Number(log.max_5min_watts) || 0,
      Number(log.max_10min_watts) || 0,
      Number(log.max_20min_watts) || 0,
      Number(log.max_40min_watts) || 0,
      Number(log.max_60min_watts) || 0
    ];
    if (!wv.some(function(x) { return x > 0; })) {
      return React.createElement('div', { className: 'journal-peak-chart-empty' }, '피크 파워 데이터가 없습니다.');
    }

    return React.createElement('div', { className: 'journal-peak-chart-wrap' },
      React.createElement('canvas', { ref: chartRef })
    );
  }

  /**
   * 세션 구간별 피크 평속 막대 + 평균 속도 가이드(주황 실선) — 2026-10-25, Summary 탭.
   * 구간별 피크 파워 그래프(JournalSessionPowerPeakChart)와 같은 디자인, 값만 km/h. Max = 라이딩 중 최고 속도.
   */
  var SPEED_PEAK_FIELDS = ['max_1min_speed_kmh', 'max_5min_speed_kmh', 'max_10min_speed_kmh', 'max_20min_speed_kmh', 'max_40min_speed_kmh', 'max_60min_speed_kmh'];
  /**
   * 구간별 평속 PR — 그해 최고 평속(yearlyPeaks.max_*_speed_kmh, fn_my_yearly_peaks)과 같거나 높으면 PR.
   * 파워·심박 PR(isPrField)과 같은 방식이되, 평속은 소수 1자리까지 비교한다.
   */
  function isSpeedPrField(log, yearlyPeaks, field) {
    if (!log || !yearlyPeaks || !field) return false;
    var peak = Number(yearlyPeaks[field]);
    var v = Number(log[field]);
    if (!(peak > 0) || !(v > 0)) return false;
    return Math.round(v * 10) >= Math.round(peak * 10);
  }
  function journalLogHasSpeedPeaks(log) {
    if (!log) return false;
    return SPEED_PEAK_FIELDS.some(function(f) { return Number(log[f]) > 0; });
  }
  function JournalSessionSpeedPeakChart(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks || null;
    var chartRef = useRef(null);
    var chartInst = useRef(null);
    var depKey = log
      ? [log.max_speed_kmh, log.avg_speed_kmh].concat(SPEED_PEAK_FIELDS.map(function(f) { return log[f]; }))
        .concat(['max_speed_kmh'].concat(SPEED_PEAK_FIELDS).map(function(f) { return yearlyPeaks ? yearlyPeaks[f] : ''; })).join('|')
      : '';

    useEffect(function() {
      if (chartInst.current) {
        chartInst.current.destroy();
        chartInst.current = null;
      }
      if (!log || typeof Chart === 'undefined') return;
      var ctx = chartRef.current && chartRef.current.getContext('2d');
      if (!ctx) return;
      var rows = [
        { label: '최고 속도', shortLabel: 'Max', field: 'max_speed_kmh', val: Number(log.max_speed_kmh) || 0 },
        { label: '1분', shortLabel: '1분', field: 'max_1min_speed_kmh', val: Number(log.max_1min_speed_kmh) || 0 },
        { label: '5분', shortLabel: '5분', field: 'max_5min_speed_kmh', val: Number(log.max_5min_speed_kmh) || 0 },
        { label: '10분', shortLabel: '10', field: 'max_10min_speed_kmh', val: Number(log.max_10min_speed_kmh) || 0 },
        { label: '20분', shortLabel: '20', field: 'max_20min_speed_kmh', val: Number(log.max_20min_speed_kmh) || 0 },
        { label: '40분', shortLabel: '40', field: 'max_40min_speed_kmh', val: Number(log.max_40min_speed_kmh) || 0 },
        { label: '60분', shortLabel: '60', field: 'max_60min_speed_kmh', val: Number(log.max_60min_speed_kmh) || 0 }
      ];
      capPeakRowsMonotonicDesc(rows);
      var prFn = function(field) { return isSpeedPrField(log, yearlyPeaks, field); };
      var hasChartPr = rows.some(function(r) { return r.val > 0 && prFn(r.field); });
      var values = rows.map(function(r) { return r.val; });
      var avgGuide = Number(log.avg_speed_kmh) > 0
        ? Number(log.avg_speed_kmh)
        : avgSpeedKmhFromDistanceTime(log.distance_km, log.duration_sec) || 0;
      if (!values.some(function(v) { return v > 0; })) return;
      var numsForMax = values.filter(function(n) { return n > 0; });
      if (avgGuide > 0) numsForMax.push(avgGuide);
      var maxV = Math.max.apply(null, numsForMax);
      var yMax = Math.ceil(maxV * 1.15 / 10) * 10 || 50;
      var labels = rows.map(function(r) { return r.label; });
      var plugin = {
        id: 'journalSpeedPeakLabels',
        afterDatasetsDraw: function(chart) {
          var meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data || meta.data.length === 0) return;
          var chartArea = chart.chartArea;
          var radius = JOURNAL_PEAK_AXIS_CIRCLE_R;
          var circleY = chartArea.bottom + radius + 4;
          chart.ctx.save();
          meta.data.forEach(function(bar, i) {
            if (!bar || bar.x == null || bar.y == null) return;
            var row = rows[i];
            if (row.val > 0) drawPeakBarTopValue(chart.ctx, row.val.toFixed(1), bar.x, bar.y - 12, prFn(row.field));
            chart.ctx.beginPath();
            chart.ctx.arc(bar.x, circleY, radius, 0, Math.PI * 2);
            chart.ctx.fillStyle = JOURNAL_PEAK_ZONE_COLORS[i] || 'rgba(156,163,175,0.7)';
            chart.ctx.fill();
            chart.ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            chart.ctx.lineWidth = 1;
            chart.ctx.stroke();
            chart.ctx.fillStyle = '#1f2937';
            chart.ctx.font = JOURNAL_PEAK_AXIS_LABEL_FONT;
            chart.ctx.textAlign = 'center';
            chart.ctx.textBaseline = 'middle';
            chart.ctx.fillText(row.shortLabel, bar.x, circleY);
          });
          if (chartArea) drawUnitRowWithOptionalPrLegend(chart.ctx, chartArea, 'km/h', hasChartPr);
          chart.ctx.restore();
        }
      };
      var datasets = [{
        type: 'bar',
        label: '평속 (km/h)',
        data: values,
        backgroundColor: rows.map(function(d, i) { return JOURNAL_PEAK_ZONE_COLORS[i]; }),
        borderColor: rows.map(function(r, i) { return borderRgbFromZone(i); }),
        borderWidth: rows.map(function() { return 1; }),
        borderRadius: { topLeft: 6, topRight: 6 },
        order: 0
      }];
      if (avgGuide > 0) {
        datasets.push({
          type: 'line',
          label: '평균 속도',
          data: labels.map(function() { return avgGuide; }),
          borderColor: AVG_GUIDE_LINE,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          hitRadius: 0,
          fill: false,
          order: 1,
          tension: 0
        });
      }
      chartInst.current = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 40, bottom: 48 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(c) {
                  var i = c.dataIndex;
                  if (c.datasetIndex === 1) return '평균 속도: ' + avgGuide.toFixed(1) + ' km/h';
                  if (rows[i] && rows[i].val > 0) {
                    var line = rows[i].label + ': ' + rows[i].val.toFixed(1) + ' km/h';
                    return prFn(rows[i].field) ? [line, 'PR'] : line;
                  }
                  return rows[i] ? rows[i].label + ': —' : '';
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { display: false } },
            y: {
              beginAtZero: true,
              max: yMax,
              grid: { color: '#e5e7eb' },
              ticks: {
                font: { size: 11 },
                color: '#6b7280',
                callback: function(v) { return v === 0 ? '0km/h' : String(v); }
              }
            }
          }
        },
        plugins: [plugin]
      });
      return function cleanup() {
        if (chartInst.current) {
          chartInst.current.destroy();
          chartInst.current = null;
        }
      };
    }, [depKey]);

    if (!log || !journalLogHasSpeedPeaks(log)) return null;
    return React.createElement('div', { className: 'journal-peak-chart-wrap' },
      React.createElement('canvas', { ref: chartRef })
    );
  }

  /**
   * 세션 심박 피크 막대 + 평균 심박 가이드(주황 실선)
   */
  function JournalSessionHrPeakChart(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeight = Number(props.userWeight) || 0;
    var chartRef = useRef(null);
    var chartInst = useRef(null);
    var depKey = sessionHrChartKey(log, yearlyPeaks, userWeight);

    useEffect(function() {
      if (chartInst.current) {
        chartInst.current.destroy();
        chartInst.current = null;
      }
      if (!log || typeof Chart === 'undefined') return;
      var ctx = chartRef.current && chartRef.current.getContext('2d');
      if (!ctx) return;
      var rows = [
        { label: '5초', shortLabel: '5초', field: 'max_hr_5sec', val: resolveMaxHr5Sec(log) },
        { label: '1분', shortLabel: '1분', field: 'max_hr_1min', val: Number(log.max_hr_1min) || 0 },
        { label: '5분', shortLabel: '5분', field: 'max_hr_5min', val: Number(log.max_hr_5min) || 0 },
        { label: '10분', shortLabel: '10', field: 'max_hr_10min', val: Number(log.max_hr_10min) || 0 },
        { label: '20분', shortLabel: '20', field: 'max_hr_20min', val: Number(log.max_hr_20min) || 0 },
        { label: '40분', shortLabel: '40', field: 'max_hr_40min', val: Number(log.max_hr_40min) || 0 },
        { label: '60분', shortLabel: '60', field: 'max_hr_60min', val: Number(log.max_hr_60min) || 0 }
      ];
      capPeakRowsMonotonicDesc(rows);
      var values = rows.map(function(r) { return r.val; });
      var avgGuide = Number(log.avg_hr) > 0 ? Number(log.avg_hr) : 0;
      var hasAnyBar = values.some(function(w) { return w > 0; });
      if (!hasAnyBar) return;

      var prFn = typeof window.isPrField === 'function'
        ? function(field) { return window.isPrField(log, yearlyPeaks, field, userWeight); }
        : function() { return false; };
      var hrPeakPr = function(row) { return hrPeakBarIsPr(row, log, prFn); };
      var hasChartPr = rows.some(function(r) { return r.val > 0 && hrPeakPr(r); });

      var numsForMax = values.slice();
      if (avgGuide > 0) numsForMax.push(avgGuide);
      var maxH = Math.max.apply(null, numsForMax.filter(function(n) { return n > 0; }));
      var yMax = Math.ceil(maxH * 1.12 / 5) * 5 || 200;

      var labels = rows.map(function(r) { return r.label; });
      var plugin = {
        id: 'journalHrPeakLabels',
        afterDatasetsDraw: function(chart) {
          var meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data || meta.data.length === 0) return;
          var chartArea = chart.chartArea;
          var bottom = chartArea.bottom;
          var radius = JOURNAL_PEAK_AXIS_CIRCLE_R;
          var circleY = bottom + radius + 4;
          chart.ctx.save();
          meta.data.forEach(function(bar, i) {
            if (!bar || bar.x == null || bar.y == null) return;
            var row = rows[i];
            if (row.val > 0) {
              drawPeakBarTopValue(
                chart.ctx,
                String(Math.round(row.val)),
                bar.x,
                bar.y - 12,
                hrPeakPr(row)
              );
            }
            var color = JOURNAL_PEAK_ZONE_COLORS[i] || 'rgba(156,163,175,0.7)';
            chart.ctx.beginPath();
            chart.ctx.arc(bar.x, circleY, radius, 0, Math.PI * 2);
            chart.ctx.fillStyle = color;
            chart.ctx.fill();
            chart.ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            chart.ctx.lineWidth = 1;
            chart.ctx.stroke();
            chart.ctx.fillStyle = '#1f2937';
            chart.ctx.font = JOURNAL_PEAK_AXIS_LABEL_FONT;
            chart.ctx.textAlign = 'center';
            chart.ctx.textBaseline = 'middle';
            chart.ctx.fillText(row.shortLabel, bar.x, circleY);
          });
          if (chartArea) {
            drawUnitRowWithOptionalPrLegend(chart.ctx, chartArea, 'bpm', hasChartPr);
          }
          chart.ctx.restore();
        }
      };

      var datasets = [
        {
          type: 'bar',
          label: '심박 (bpm)',
          data: values,
          backgroundColor: rows.map(function(d, i) { return JOURNAL_PEAK_ZONE_COLORS[i]; }),
          borderColor: rows.map(function(d, i) { return borderRgbFromZone(i); }),
          borderWidth: 1,
          borderRadius: { topLeft: 6, topRight: 6 },
          order: 0
        }
      ];
      if (avgGuide > 0) {
        datasets.push({
          type: 'line',
          label: '평균 심박',
          data: labels.map(function() { return avgGuide; }),
          borderColor: AVG_GUIDE_LINE,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          hitRadius: 0,
          fill: false,
          order: 1,
          tension: 0
        });
      }

      chartInst.current = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 40, bottom: 48 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  if (ctx.datasetIndex === 1) return '평균 심박: ' + Math.round(avgGuide) + ' bpm';
                  var i = ctx.dataIndex;
                  if (rows[i] && rows[i].val > 0) {
                    var line = rows[i].label + ': ' + Math.round(rows[i].val) + ' bpm';
                    return hrPeakPr(rows[i]) ? [line, 'PR'] : line;
                  }
                  return rows[i] ? rows[i].label + ': —' : '';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false }
            },
            y: {
              beginAtZero: true,
              max: yMax,
              grid: { color: '#e5e7eb' },
              ticks: {
                font: { size: 11 },
                color: '#6b7280',
                callback: function(v) {
                  return String(v);
                }
              }
            }
          }
        },
        plugins: [plugin]
      });

      return function cleanup() {
        if (chartInst.current) {
          chartInst.current.destroy();
          chartInst.current = null;
        }
      };
    }, [depKey]);

    if (!log) return null;
    var hv = [
      resolveMaxHr5Sec(log),
      Number(log.max_hr_1min) || 0,
      Number(log.max_hr_5min) || 0,
      Number(log.max_hr_10min) || 0,
      Number(log.max_hr_20min) || 0,
      Number(log.max_hr_40min) || 0,
      Number(log.max_hr_60min) || 0
    ];
    if (!hv.some(function(x) { return x > 0; })) {
      return React.createElement('div', { className: 'journal-peak-chart-empty' }, '구간별 심박 데이터가 없습니다.');
    }

    return React.createElement('div', { className: 'journal-peak-chart-wrap' },
      React.createElement('canvas', { ref: chartRef })
    );
  }

  function formatDuration(sec) {
    if (sec == null || sec === '' || Number.isNaN(Number(sec))) return '-';
    var s = Math.floor(Number(sec));
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    s = s % 60;
    m = m % 60;
    if (h > 0) return h + '시간 ' + m + '분 ' + s + '초';
    return m + '분 ' + s + '초';
  }

  /*
   * IF(강도 지수) 산정(2026-10-26): 저장값 → 정규화 파워(NP)÷FTP → TSS·시간 역산(TSS = 시간(초)×IF²÷36).
   * 하루 여러 건은 시간 가중(√(Σ IF²×시간 ÷ Σ 시간)) — TSS 합산과 같은 기준.
   */
  function journalLogDurationSec(l) {
    return Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
  }
  function journalResolveIf(l, ftpFallback) {
    if (!l) return null;
    var v = Number(l.if != null ? l.if : l.intensity_factor);
    if (v > 0 && v < 3) return v;
    var np = Number(l.weighted_watts || l.avg_watts || 0);
    var ftp = Number(l.ftp_at_time || ftpFallback || 0);
    if (np > 0 && ftp > 0) {
      var r = np / ftp;
      if (r > 0 && r < 3) return Math.round(r * 100) / 100;
    }
    var tss = Number(l.tss || 0), sec = journalLogDurationSec(l);
    if (tss > 0 && sec > 0) {
      var r2 = Math.sqrt((36 * tss) / sec);
      if (r2 > 0 && r2 < 3) return Math.round(r2 * 100) / 100;
    }
    return null;
  }
  function journalCombinedIf(logs, ftpFallback) {
    var num = 0, den = 0;
    (logs || []).forEach(function (l) {
      var v = journalResolveIf(l, ftpFallback), s = journalLogDurationSec(l);
      if (v > 0 && s > 0) { num += v * v * s; den += s; }
    });
    return den > 0 ? Math.round(Math.sqrt(num / den) * 100) / 100 : null;
  }
  function journalUserFtp() {
    try {
      var cu = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      return cu ? Number(cu.ftp || 0) : 0;
    } catch (e) { return 0; }
  }
  function avgSpeedKmhFromDistanceTime(distanceKm, durationSec) {
    var d = Number(distanceKm) || 0;
    var t = Number(durationSec) || 0;
    if (d <= 0 || t <= 0) return null;
    return Math.round((d / (t / 3600)) * 100) / 100;
  }

  function formatSpeedKmh(v) {
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
    return Number(v).toFixed(1) + ' km/h';
  }

  function formatElevationM(v) {
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
    return Math.round(Number(v)) + ' m';
  }

  function formatCadenceRpm(v) {
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
    return Math.round(Number(v)) + ' rpm';
  }

  function mergeLogsForDetail(logs, dailyRouteDoc) {
    if (!logs || logs.length === 0) return null;
    var log = logs[0];
    if (logs.length === 1) {
      var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
      var dist0 = log.distance_km != null ? Number(log.distance_km) : 0;
      var spdStored0 = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
      var spd0 = spdStored0 != null && spdStored0 > 0 ? spdStored0 : avgSpeedKmhFromDistanceTime(dist0, sec);
      return {
        date: log.date,
        distance_km: log.distance_km,
        duration_sec: sec,
        tss: log.tss,
        if: journalResolveIf(log, journalUserFtp()),
        ftp_at_time: log.ftp_at_time,
        kilojoules: log.kilojoules,
        elevation_gain: log.elevation_gain != null ? Number(log.elevation_gain) : null,
        avg_speed_kmh: spd0,
        avg_cadence: log.avg_cadence,
        left_right_balance: log.left_right_balance,
        pedal_smoothness_left: log.pedal_smoothness_left,
        pedal_smoothness_right: log.pedal_smoothness_right,
        torque_effectiveness_left: log.torque_effectiveness_left,
        torque_effectiveness_right: log.torque_effectiveness_right,
        avg_hr: log.avg_hr,
        max_hr: log.max_hr,
        max_heartrate: log.max_heartrate,
        max_hr_5sec: resolveMaxHr5Sec(log) || log.max_hr_5sec,
        max_hr_1min: log.max_hr_1min,
        max_hr_5min: log.max_hr_5min,
        max_hr_10min: log.max_hr_10min,
        max_hr_20min: log.max_hr_20min,
        max_hr_40min: log.max_hr_40min,
        max_hr_60min: log.max_hr_60min,
        avg_watts: log.avg_watts,
        weighted_watts: log.weighted_watts,
        max_1min_watts: log.max_1min_watts,
        max_5min_watts: log.max_5min_watts,
        max_10min_watts: log.max_10min_watts,
        max_20min_watts: log.max_20min_watts,
        max_30min_watts: log.max_30min_watts,
        max_40min_watts: log.max_40min_watts,
        max_60min_watts: log.max_60min_watts,
        max_watts: log.max_watts,
        // 2026-10-25: 최고 속도·이동 시간·구간별 피크 평속(Summary 그래프)
        max_speed_kmh: log.max_speed_kmh,
        moving_time_sec: log.moving_time_sec,
        max_1min_speed_kmh: log.max_1min_speed_kmh,
        max_5min_speed_kmh: log.max_5min_speed_kmh,
        max_10min_speed_kmh: log.max_10min_speed_kmh,
        max_20min_speed_kmh: log.max_20min_speed_kmh,
        max_40min_speed_kmh: log.max_40min_speed_kmh,
        max_60min_speed_kmh: log.max_60min_speed_kmh,
        weight: log.weight,
        time_in_zones: log.time_in_zones,
        source: log.source,
        activity_type: log.activity_type || null,
        workout_id: (function () {
        var isSt =
          window.journalWorkoutGraphUtils &&
          typeof window.journalWorkoutGraphUtils.isStelvioActivityLog === 'function'
            ? window.journalWorkoutGraphUtils.isStelvioActivityLog(log)
            : String(log.activity_type || '').trim().toLowerCase() === 'stelvio' ||
              String(log.source || '').trim().toLowerCase() === 'stelvio';
        if (!isSt || log.workout_id == null) return null;
        return String(log.workout_id).trim() || null;
      })(),
        summary_polyline: log.summary_polyline,
        elevation_profile: log.elevation_profile,
        title: log.title
      };
    }
    var totalSec = 0, totalTSS = 0, totalDist = 0, totalKj = 0;
    var sumElev = 0;
    var sumCadSec = 0, cadDur = 0;
    var sumNpSec = 0, sumApSec = 0, sumHrSec = 0;
    var maxHr = 0, maxHr5 = 0, maxHr1 = 0, maxHr5m = 0, maxHr10 = 0, maxHr20 = 0, maxHr40 = 0, maxHr60 = 0;
    var max1w = 0, max5w = 0, max10w = 0, max20w = 0, max30w = 0, max40w = 0, max60w = 0, maxW = 0;
    var aggPower = {}, aggHr = {};
    var spdMax = {}, maxSpd = 0, movingSum = 0; // 하루 여러 건: 구간별 피크 평속·최고 속도는 그날 최고값
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      var s = Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
      totalSec += s;
      totalTSS += Number(l.tss || 0);
      totalDist += Number(l.distance_km || 0);
      totalKj += Number(l.kilojoules || 0);
      sumElev += Number(l.elevation_gain || 0);
      var c0 = l.avg_cadence != null ? Number(l.avg_cadence) : 0;
      if (c0 > 0 && s > 0) {
        sumCadSec += c0 * s;
        cadDur += s;
      }
      var np = l.weighted_watts != null ? Number(l.weighted_watts) : (l.avg_watts != null ? Number(l.avg_watts) : 0);
      var ap = l.avg_watts != null ? Number(l.avg_watts) : 0;
      var hr = l.avg_hr != null ? Number(l.avg_hr) : 0;
      sumNpSec += np * s;
      sumApSec += ap * s;
      sumHrSec += hr * s;
      maxHr = Math.max(maxHr, Number(l.max_hr || 0));
      maxHr5 = Math.max(maxHr5, resolveMaxHr5Sec(l));
      maxHr1 = Math.max(maxHr1, Number(l.max_hr_1min || 0));
      maxHr5m = Math.max(maxHr5m, Number(l.max_hr_5min || 0));
      maxHr10 = Math.max(maxHr10, Number(l.max_hr_10min || 0));
      maxHr20 = Math.max(maxHr20, Number(l.max_hr_20min || 0));
      maxHr40 = Math.max(maxHr40, Number(l.max_hr_40min || 0));
      maxHr60 = Math.max(maxHr60, Number(l.max_hr_60min || 0));
      max1w = Math.max(max1w, Number(l.max_1min_watts || 0));
      max5w = Math.max(max5w, Number(l.max_5min_watts || 0));
      max10w = Math.max(max10w, Number(l.max_10min_watts || 0));
      max20w = Math.max(max20w, Number(l.max_20min_watts || 0));
      max30w = Math.max(max30w, Number(l.max_30min_watts || 0));
      max40w = Math.max(max40w, Number(l.max_40min_watts || 0));
      max60w = Math.max(max60w, Number(l.max_60min_watts || 0));
      maxW = Math.max(maxW, Number(l.max_watts || 0));
      SPEED_PEAK_FIELDS.forEach(function(f) { spdMax[f] = Math.max(spdMax[f] || 0, Number(l[f] || 0)); });
      maxSpd = Math.max(maxSpd, Number(l.max_speed_kmh || 0));
      movingSum += Number(l.moving_time_sec || 0);
      var tiz = l.time_in_zones;
      if (tiz && tiz.power) {
        ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'].forEach(function(k) { aggPower[k] = (aggPower[k] || 0) + (Number(tiz.power[k]) || 0); });
      }
      if (tiz && tiz.hr) {
        ['z1', 'z2', 'z3', 'z4', 'z5'].forEach(function(k) { aggHr[k] = (aggHr[k] || 0) + (Number(tiz.hr[k]) || 0); });
      }
    }
    var mergedTiz = null;
    if (Object.keys(aggPower).length > 0 || Object.keys(aggHr).length > 0) {
      mergedTiz = { power: aggPower, hr: aggHr };
    } else if (logs[0].time_in_zones) {
      mergedTiz = logs[0].time_in_zones;
    }
    var routeMerged =
      window.stravaPolylineUtils && typeof window.stravaPolylineUtils.routeProfileFromLogs === 'function'
        ? window.stravaPolylineUtils.routeProfileFromLogs(logs, dailyRouteDoc || null)
        : null;
    return {
      date: logs[0].date,
      distance_km: totalDist,
      duration_sec: totalSec,
      tss: totalTSS,
      if: journalCombinedIf(logs, journalUserFtp()),
      kilojoules: totalKj,
      elevation_gain: sumElev > 0 ? sumElev : null,
      avg_speed_kmh: avgSpeedKmhFromDistanceTime(totalDist, totalSec),
      avg_cadence: cadDur > 0 ? sumCadSec / cadDur : null,
      left_right_balance: null,
      pedal_smoothness_left: null,
      pedal_smoothness_right: null,
      torque_effectiveness_left: null,
      torque_effectiveness_right: null,
      avg_hr: totalSec > 0 ? sumHrSec / totalSec : null,
      max_hr: maxHr || null,
      max_heartrate: maxHr || null,
      max_hr_5sec: maxHr5 || null,
      max_hr_1min: maxHr1 || null,
      max_hr_5min: maxHr5m || null,
      max_hr_10min: maxHr10 || null,
      max_hr_20min: maxHr20 || null,
      max_hr_40min: maxHr40 || null,
      max_hr_60min: maxHr60 || null,
      avg_watts: totalSec > 0 ? sumApSec / totalSec : null,
      weighted_watts: totalSec > 0 ? sumNpSec / totalSec : null,
      max_1min_watts: max1w || null,
      max_5min_watts: max5w || null,
      max_10min_watts: max10w || null,
      max_20min_watts: max20w || null,
      max_30min_watts: max30w || null,
      max_40min_watts: max40w || null,
      max_60min_watts: max60w || null,
      max_watts: maxW || null,
      max_speed_kmh: maxSpd || null,
      moving_time_sec: movingSum || null,
      max_1min_speed_kmh: spdMax.max_1min_speed_kmh || null,
      max_5min_speed_kmh: spdMax.max_5min_speed_kmh || null,
      max_10min_speed_kmh: spdMax.max_10min_speed_kmh || null,
      max_20min_speed_kmh: spdMax.max_20min_speed_kmh || null,
      max_40min_speed_kmh: spdMax.max_40min_speed_kmh || null,
      max_60min_speed_kmh: spdMax.max_60min_speed_kmh || null,
      weight: logs[0].weight,
      time_in_zones: mergedTiz,
      source: logs[0].source,
      activity_type: (function () {
        for (var ai = 0; ai < logs.length; ai++) {
          var a0 = logs[ai] && logs[ai].activity_type;
          if (String(a0 || '').trim().toLowerCase() === 'stelvio') return a0;
        }
        return logs[0].activity_type || null;
      })(),
      workout_id: (function () {
        var isStelvio =
          window.journalWorkoutGraphUtils &&
          typeof window.journalWorkoutGraphUtils.isStelvioActivityLog === 'function'
            ? window.journalWorkoutGraphUtils.isStelvioActivityLog
            : function (l) {
                return String(l && l.activity_type || '').trim().toLowerCase() === 'stelvio';
              };
        for (var wi = 0; wi < logs.length; wi++) {
          var lw = logs[wi];
          if (!isStelvio(lw)) continue;
          var w0 = lw && lw.workout_id;
          if (w0 != null && String(w0).trim() !== '') return String(w0).trim();
        }
        return null;
      })(),
      summary_polyline: logs.length === 1 && logs[0].summary_polyline ? logs[0].summary_polyline : null,
      elevation_profile: routeMerged && routeMerged.hasElevation ? routeMerged.elevation : null,
      title:
        routeMerged && routeMerged.segmentCount > 1
          ? (logs[0].date || '') + ' 라이딩 ' + routeMerged.segmentCount + '회'
          : logs[0].title,
      _routeProfileMerged: routeMerged,
      _logsForShare: logs,
      _dailyRouteDoc: dailyRouteDoc || null
    };
  }

  function DetailRow(props) {
    return React.createElement('div', { className: 'journal-detail-row' },
      React.createElement('span', { className: 'journal-detail-label' },
        props.label,
        props.isPr ? React.createElement('span', { className: 'training-detail-pr-badge', style: { marginLeft: 4 } }, 'PR') : null
      ),
      React.createElement('span', { className: 'journal-detail-value-wrap' },
        React.createElement('span', { className: 'journal-detail-value' }, props.value)
      )
    );
  }

  function isPr(log, yearlyPeaks, field, userWeight) {
    if (!log || !yearlyPeaks || typeof window.isPrField !== 'function') return false;
    return window.isPrField(log, yearlyPeaks, field, userWeight);
  }

  function TabSummary(props) {
    var log = props.log;
    var dailyRouteDoc = props.dailyRouteDoc || null;
    if (!log) {
      return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    }
    var CourseMap = window.JournalCourseMapPreview;
    var WorkoutGraph = window.JournalWorkoutGraphPreview;
    var graphUtils = window.journalWorkoutGraphUtils;
    var utils = window.stravaPolylineUtils;
    var logsForRouteRaw = log && log._logsForShare ? log._logsForShare : null;
    var logsForRoute =
      graphUtils && typeof graphUtils.expandLogsWithStelvioCompanions === 'function'
        ? graphUtils.expandLogsWithStelvioCompanions(logsForRouteRaw || [])
        : logsForRouteRaw;
    var routeInfo =
      log && log._routeProfileMerged
        ? log._routeProfileMerged
        : utils && logsForRoute && typeof utils.routeProfileFromLogs === 'function'
          ? utils.routeProfileFromLogs(logsForRoute, dailyRouteDoc)
          : utils && log && typeof utils.routeProfileFromLog === 'function'
            ? utils.routeProfileFromLog(log)
            : { hasRoute: false, hasElevation: false, segmentCount: 0 };
    var workoutId =
      graphUtils && typeof graphUtils.resolveWorkoutIdFromLogs === 'function'
        ? graphUtils.resolveWorkoutIdFromLogs(log, logsForRoute)
        : (log.workout_id != null ? String(log.workout_id).trim() : '');
    var showWorkoutGraph =
      !routeInfo.hasRoute && !!workoutId && WorkoutGraph;
    var actualPowerLog =
      graphUtils && typeof graphUtils.resolveStelvioLogWithActualPower === 'function'
        ? graphUtils.resolveStelvioLogWithActualPower(log, logsForRoute)
        : null;
    var spd = log.avg_speed_kmh != null && Number(log.avg_speed_kmh) > 0
      ? Number(log.avg_speed_kmh)
      : avgSpeedKmhFromDistanceTime(log.distance_km, log.duration_sec);
    var rows = [
      DetailRow({ label: '거리', value: log.distance_km != null && log.distance_km > 0 ? log.distance_km.toFixed(1) + ' km' : '-', isPr: false }),
      DetailRow({ label: '라이딩 시간', value: formatDuration(log.duration_sec), isPr: false }),
      DetailRow({ label: '평균 속도', value: formatSpeedKmh(spd), isPr: false }),
      DetailRow({ label: '상승고도', value: formatElevationM(log.elevation_gain), isPr: false }),
      // 2026-10-20: 아웃도어 라이딩(GPS) 기록 — 이동 시간(멈춘 시간 제외)·최고 속도가 있을 때만
      log.moving_time_sec != null && Number(log.moving_time_sec) > 0
        ? DetailRow({ label: '이동 시간', value: formatDuration(Number(log.moving_time_sec)), isPr: false })
        : null,
      log.max_speed_kmh != null && Number(log.max_speed_kmh) > 0
        ? DetailRow({ label: '최고 속도', value: formatSpeedKmh(Number(log.max_speed_kmh)), isPr: false })
        : null,
      // 2026-10-25: 구간별 평속 그래프(평속 기록이 있을 때만) — 최고 속도 항목 바로 아래
      journalLogHasSpeedPeaks(log)
        ? React.createElement('div', { key: 'spd-peak', className: 'journal-summary-speed-peak' },
            React.createElement('div', { className: 'journal-summary-speed-peak-title' }, '구간별 평속'),
            React.createElement(JournalSessionSpeedPeakChart, { log: log, yearlyPeaks: props.yearlyPeaks || null }))
        : null,
      DetailRow({ label: '평균 케이던스', value: formatCadenceRpm(log.avg_cadence), isPr: false }),
      DetailRow({ label: 'TSS', value: log.tss != null && log.tss > 0 ? Math.round(log.tss) : '-', isPr: false }),
      DetailRow({ label: 'IF', value: log.if != null && log.if > 0 ? log.if.toFixed(2) : '-', isPr: false }),
      DetailRow({ label: 'KJ', value: log.kilojoules != null && log.kilojoules > 0 ? Math.round(log.kilojoules) + ' KJ' : '-', isPr: false })
    ];
    /* 영역별 누적 시간 그래프는 Power Profile / Heart Rate 탭으로 이동됨 */
    return React.createElement(
      'div',
      {
        className:
          'journal-tab-content journal-tab-content--summary-route' +
          (showWorkoutGraph ? ' journal-tab-content--summary-workout' : '')
      },
      /* 2026-10-25: Summary 탭 경로 지도 제거(요청) — 실내 워크아웃 그래프는 유지 */
      showWorkoutGraph
          ? React.createElement(WorkoutGraph, {
              key: 'wo-' + workoutId + '-' + (log.date || ''),
              workoutId: workoutId,
              maxHeight: 200,
              className: 'journal-summary-sheet-workout-graph',
              actualSegmentAvgWatts: actualPowerLog ? actualPowerLog.segment_avg_watts : null,
              actualFtp: actualPowerLog ? actualPowerLog.ftp_at_time : null
            })
          : null,
      React.createElement('div', { className: 'journal-tab-content-inner' }, rows)
    );
  }

  function TabPower(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeight = props.userWeight || 0;
    var userProfile = props.userProfile || {};
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var pr = function(field) { return isPr(log, yearlyPeaks, field, userWeight); };

    /* 파워 영역별 누적 시간 차트 — DailyTimeInZonesCharts에 power 존만 담은 log 전달 */
    var DailyChartsPow = window.DailyTimeInZonesCharts;
    var rawPowerZones = log.time_in_zones && log.time_in_zones.power;
    var hasPowerTiz = rawPowerZones && Object.keys(rawPowerZones).some(function(k) {
      return Number(rawPowerZones[k]) > 0;
    });
    var powerOnlyLog = hasPowerTiz
      ? Object.assign({}, log, { time_in_zones: { power: rawPowerZones, hr: {} } })
      : null;
    var up = { id: userProfile.id || userProfile.uid, uid: userProfile.uid || userProfile.id, ftp: Number(userProfile.ftp) || 200, max_hr: Number(userProfile.max_hr) || 190 };
    var powerTizEl = powerOnlyLog && DailyChartsPow
      ? React.createElement('div', { className: 'journal-detail-time-in-zones-wrap' },
          React.createElement(DailyChartsPow, { log: powerOnlyLog, userProfile: up })
        )
      : null;

    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '평균 파워', value: log.avg_watts != null && log.avg_watts > 0 ? Math.round(log.avg_watts) + ' W' : '-', isPr: false }),
      DetailRow({ label: 'NP', value: log.weighted_watts != null && log.weighted_watts > 0 ? Math.round(log.weighted_watts) + ' W' : '-', isPr: false }),
      DetailRow({ label: '최대 파워', value: log.max_watts != null && log.max_watts > 0 ? Math.round(log.max_watts) + ' W' : '-', isPr: pr('max_watts') }),
      React.createElement('div', { className: 'journal-peak-chart-section' },
        React.createElement('div', { className: 'journal-peak-chart-title' }, '구간별 피크 파워'),
        React.createElement('div', { className: 'journal-peak-chart-legend', 'aria-label': '차트 범례' },
          React.createElement('span', { className: 'journal-peak-chart-legend-line', 'aria-hidden': 'true' }),
          React.createElement('span', null, '평균 파워')
        ),
        React.createElement(JournalSessionPowerPeakChart, {
          log: log,
          userWeight: userWeight,
          yearlyPeaks: yearlyPeaks
        })
      ),
      powerTizEl
    );
  }

  function TabHeartRate(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeightForPr = props.userWeight || 0;
    var userProfile = props.userProfile || {};
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var pr = function(field) { return isPr(log, yearlyPeaks, field, userWeightForPr); };

    /* 심박 영역별 누적 시간 차트 — DailyTimeInZonesCharts에 hr 존만 담은 log 전달 */
    var DailyChartsHr = window.DailyTimeInZonesCharts;
    var rawHrZones = log.time_in_zones && log.time_in_zones.hr;
    var hasHrTiz = rawHrZones && Object.keys(rawHrZones).some(function(k) {
      return Number(rawHrZones[k]) > 0;
    });
    var hrOnlyLog = hasHrTiz
      ? Object.assign({}, log, {
          time_in_zones: { power: {}, hr: rawHrZones },
          zone_ref_max_hr: Number(log.max_hr) > 0 ? Number(log.max_hr) : (Number(userProfile.max_hr) > 0 ? Number(userProfile.max_hr) : 0)
        })
      : null;
    var upHr = { id: userProfile.id || userProfile.uid, uid: userProfile.uid || userProfile.id, ftp: Number(userProfile.ftp) || 200, max_hr: Number(userProfile.max_hr) || 190 };
    var hrTizEl = hrOnlyLog && DailyChartsHr
      ? React.createElement('div', { className: 'journal-detail-time-in-zones-wrap' },
          React.createElement(DailyChartsHr, { log: hrOnlyLog, userProfile: upHr })
        )
      : null;

    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '평균 심박', value: log.avg_hr != null && log.avg_hr > 0 ? Math.round(log.avg_hr) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박', value: log.max_hr != null && log.max_hr > 0 ? Math.round(log.max_hr) + ' bpm' : '-', isPr: pr('max_hr') }),
      React.createElement('div', { className: 'journal-peak-chart-section' },
        React.createElement('div', { className: 'journal-peak-chart-title' }, '구간별 최대 심박'),
        React.createElement('div', { className: 'journal-peak-chart-legend', 'aria-label': '차트 범례' },
          React.createElement('span', { className: 'journal-peak-chart-legend-line', 'aria-hidden': 'true' }),
          React.createElement('span', null, '평균 심박')
        ),
        React.createElement(JournalSessionHrPeakChart, {
          log: log,
          yearlyPeaks: yearlyPeaks,
          userWeight: userWeightForPr
        })
      ),
      hrTizEl
    );
  }

  function JournalDetailBottomSheet(props) {
    var open = props.open;
    var onClose = props.onClose;
    var logs = props.logs || [];
    var selectedDate = props.selectedDate;
    var yearlyPeaksByYear = props.yearlyPeaksByYear || {};
    var userWeightForPr = props.userWeightForPr || 0;
    var dailyRouteDoc = props.dailyRouteDoc || null;

    var _useState = useState('summary');
    var activeTab = _useState[0];
    var setActiveTab = _useState[1];

    /* 2026-10-13: 시트가 열린 동안 뒤쪽 라이딩 기록 화면(#trainingJournalScreen) 스크롤 잠금 + 맨 위로(Top) 버튼 숨김 */
    useEffect(function() {
      if (!open || typeof document === 'undefined') return undefined;
      if (!document.getElementById('journal-sheet-open-style')) {
        var st = document.createElement('style');
        st.id = 'journal-sheet-open-style';
        st.textContent =
          'body.journal-sheet-open .global-back-to-top-btn,body.journal-sheet-open .stelvio-back-to-top-btn,' +
          'body.journal-sheet-open [class*="back-to-top"]{display:none!important}' +
          '#trainingJournalScreen .journal-bottom-sheet-body{overscroll-behavior:contain}';
        document.head.appendChild(st);
      }
      var scr = document.getElementById('trainingJournalScreen');
      var prevOverflow = scr ? scr.style.overflowY : '';
      if (scr) scr.style.overflowY = 'hidden';
      document.body.classList.add('journal-sheet-open');
      return function() {
        if (scr) scr.style.overflowY = prevOverflow;
        document.body.classList.remove('journal-sheet-open');
      };
    }, [open]);

    if (!open) return null;

    var merged = mergeLogsForDetail(logs, dailyRouteDoc);
    var yearForPeaks = selectedDate && selectedDate.length >= 4 ? parseInt(selectedDate.substring(0, 4), 10) : new Date().getFullYear();
    var yearlyPeaks = yearlyPeaksByYear[yearForPeaks] || null;
    var tabs = [
      { id: 'summary', label: 'Summary', C: TabSummary },
      { id: 'power', label: 'Power Profile', C: TabPower },
      { id: 'hr', label: 'Heart Rate', C: TabHeartRate }
    ];

    return React.createElement('div', {
      className: 'journal-bottom-sheet-overlay',
      onClick: function(e) { if (e.target === e.currentTarget) onClose(); }
    },
      React.createElement('div', { className: 'journal-bottom-sheet', onClick: function(e) { e.stopPropagation(); } },
        React.createElement('div', { className: 'journal-bottom-sheet-handle' }),
        React.createElement('div', { className: 'journal-bottom-sheet-header' },
          React.createElement('h3', { className: 'journal-bottom-sheet-title' }, selectedDate ? selectedDate.replace(/-/g, '.') + ' 상세' : '라이딩 상세'),
          React.createElement('button', {
            type: 'button',
            className: 'journal-bottom-sheet-close',
            'aria-label': '닫기',
            onClick: onClose
          }, '\u00D7')
        ),
        React.createElement('div', { className: 'journal-bottom-sheet-tabs' },
          tabs.map(function(t) {
            return React.createElement('button', {
              key: t.id,
              type: 'button',
              className: 'journal-bottom-sheet-tab' + (activeTab === t.id ? ' active' : ''),
              onClick: function() { setActiveTab(t.id); }
            }, t.label);
          })
        ),
        React.createElement('div', { className: 'journal-bottom-sheet-body' },
          tabs.map(function(t) {
            if (activeTab !== t.id) return null;
            var routeMergedTab =
              window.stravaPolylineUtils && typeof window.stravaPolylineUtils.routeProfileFromLogs === 'function'
                ? window.stravaPolylineUtils.routeProfileFromLogs(logs, dailyRouteDoc)
                : null;
            var summaryLog = merged
              ? Object.assign({}, merged, {
                  _routeProfileMerged: routeMergedTab || merged._routeProfileMerged,
                  _logsForShare: logs,
                  _dailyRouteDoc: dailyRouteDoc || null
                })
              : logs[0] || null;
            var p = t.id === 'summary'
              ? { log: summaryLog, logs: logs, dailyRouteDoc: dailyRouteDoc, yearlyPeaks: yearlyPeaks, userProfile: props.userProfile || {} }
              : { log: merged, yearlyPeaks: yearlyPeaks, userWeight: userWeightForPr, userProfile: props.userProfile || {} };
            return React.createElement(t.C, Object.assign({ key: t.id }, p));
          })
        ),
        merged && String(merged.source || '').toLowerCase() === 'strava'
          ? React.createElement('div', { className: 'journal-bottom-sheet-footer' },
              React.createElement('img', { src: 'assets/img/api_strava.png', alt: 'Powered by Strava', style: { height: 12 } })
            )
          : null
      )
    );
  }

  window.JournalDetailBottomSheet = JournalDetailBottomSheet;
})();
