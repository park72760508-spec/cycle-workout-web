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

  /**
   * Heart Rate 막대 PR: 구간 필드 PR 또는
   * 최대심박(max_hr) PR인데 5초 값이 최대심박과 동일한 경우 5초 막대에 PR 표시
   */
  function hrPeakBarIsPr(row, log, prFn) {
    if (!row || !log || typeof prFn !== 'function') return false;
    if (prFn(row.field)) return true;
    if (row.field !== 'max_hr_5sec' || !(row.val > 0)) return false;
    var maxHr = Number(log.max_hr) || 0;
    var hr5 = Number(log.max_hr_5sec) || 0;
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
      });
    }
    var pk = peakParts.join(',');
    return [
      userWeight,
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
      peakParts.join(','),
      log.avg_hr,
      log.max_hr,
      log.max_hr_5sec,
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
        { label: '5초', shortLabel: '5초', field: 'max_hr_5sec', val: Number(log.max_hr_5sec) || 0 },
        { label: '1분', shortLabel: '1분', field: 'max_hr_1min', val: Number(log.max_hr_1min) || 0 },
        { label: '5분', shortLabel: '5분', field: 'max_hr_5min', val: Number(log.max_hr_5min) || 0 },
        { label: '10분', shortLabel: '10', field: 'max_hr_10min', val: Number(log.max_hr_10min) || 0 },
        { label: '20분', shortLabel: '20', field: 'max_hr_20min', val: Number(log.max_hr_20min) || 0 },
        { label: '40분', shortLabel: '40', field: 'max_hr_40min', val: Number(log.max_hr_40min) || 0 },
        { label: '60분', shortLabel: '60', field: 'max_hr_60min', val: Number(log.max_hr_60min) || 0 }
      ];
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
      Number(log.max_hr_5sec) || 0,
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

  /** 0~100 구간은 %로 표시 (Strava/가민 스타일 대비) */
  function formatPedalMetric(v) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '-';
    var n = Number(v);
    if (n >= 0 && n <= 100) return n.toFixed(1) + '%';
    return String(Math.round(n * 10) / 10);
  }

  function mergeLogsForDetail(logs) {
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
        if: log.if,
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
        max_hr_5sec: log.max_hr_5sec,
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
        time_in_zones: log.time_in_zones,
        source: log.source
      };
    }
    var totalSec = 0, totalTSS = 0, totalDist = 0, totalKj = 0;
    var sumElev = 0;
    var sumCadSec = 0, cadDur = 0;
    var sumNpSec = 0, sumApSec = 0, sumHrSec = 0;
    var maxHr = 0, maxHr5 = 0, maxHr1 = 0, maxHr5m = 0, maxHr10 = 0, maxHr20 = 0, maxHr40 = 0, maxHr60 = 0;
    var max1w = 0, max5w = 0, max10w = 0, max20w = 0, max30w = 0, max40w = 0, max60w = 0, maxW = 0;
    var aggPower = {}, aggHr = {};
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
      maxHr5 = Math.max(maxHr5, Number(l.max_hr_5sec || 0));
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
    return {
      date: logs[0].date,
      distance_km: totalDist,
      duration_sec: totalSec,
      tss: totalTSS,
      if: null,
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
      time_in_zones: mergedTiz,
      source: logs[0].source
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
    var userProfile = props.userProfile || {};
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var DailyCharts = window.DailyTimeInZonesCharts;
    var up = { id: userProfile.id || userProfile.uid, uid: userProfile.uid || userProfile.id, ftp: Number(userProfile.ftp) || 200, max_hr: Number(userProfile.max_hr) || 190 };
    var spd = log.avg_speed_kmh != null && Number(log.avg_speed_kmh) > 0
      ? Number(log.avg_speed_kmh)
      : avgSpeedKmhFromDistanceTime(log.distance_km, log.duration_sec);
    var rows = [
      DetailRow({ label: '거리', value: log.distance_km != null && log.distance_km > 0 ? log.distance_km.toFixed(1) + ' km' : '-', isPr: false }),
      DetailRow({ label: '라이딩 시간', value: formatDuration(log.duration_sec), isPr: false }),
      DetailRow({ label: '평균 속도', value: formatSpeedKmh(spd), isPr: false }),
      DetailRow({ label: '상승고도', value: formatElevationM(log.elevation_gain), isPr: false }),
      DetailRow({ label: '평균 케이던스', value: formatCadenceRpm(log.avg_cadence), isPr: false }),
      DetailRow({ label: 'TSS', value: log.tss != null && log.tss > 0 ? Math.round(log.tss) : '-', isPr: false }),
      DetailRow({ label: 'IF', value: log.if != null && log.if > 0 ? log.if.toFixed(2) : '-', isPr: false }),
      DetailRow({ label: 'KJ', value: log.kilojoules != null && log.kilojoules > 0 ? Math.round(log.kilojoules) + ' KJ' : '-', isPr: false })
    ];
    var tizEl = log.time_in_zones && DailyCharts
      ? React.createElement('div', { className: 'journal-detail-time-in-zones-wrap' },
          React.createElement(DailyCharts, { log: log, userProfile: up })
        )
      : null;
    return React.createElement('div', { className: 'journal-tab-content' },
      rows.concat(tizEl ? [tizEl] : [])
    );
  }

  function TabPower(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeight = props.userWeight || 0;
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var pr = function(field) { return isPr(log, yearlyPeaks, field, userWeight); };
    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '평균 파워', value: log.avg_watts != null && log.avg_watts > 0 ? Math.round(log.avg_watts) + ' W' : '-', isPr: false }),
      DetailRow({ label: 'NP', value: log.weighted_watts != null && log.weighted_watts > 0 ? Math.round(log.weighted_watts) + ' W' : '-', isPr: false }),
      DetailRow({ label: '최대 파워', value: log.max_watts != null && log.max_watts > 0 ? Math.round(log.max_watts) + ' W' : '-', isPr: pr('max_watts') }),
      DetailRow({ label: '좌/우 밸런스', value: formatPedalMetric(log.left_right_balance), isPr: false }),
      DetailRow({ label: '좌측 페달 평활도', value: formatPedalMetric(log.pedal_smoothness_left), isPr: false }),
      DetailRow({ label: '우측 페달 평활도', value: formatPedalMetric(log.pedal_smoothness_right), isPr: false }),
      DetailRow({ label: '좌측 토크 유효성', value: formatPedalMetric(log.torque_effectiveness_left), isPr: false }),
      DetailRow({ label: '우측 토크 유효성', value: formatPedalMetric(log.torque_effectiveness_right), isPr: false }),
      React.createElement('div', { className: 'journal-peak-chart-section' },
        React.createElement('div', { className: 'journal-peak-chart-title' }, '구간별 피크 파워'),
        React.createElement(JournalSessionPowerPeakChart, {
          log: log,
          userWeight: userWeight,
          yearlyPeaks: yearlyPeaks
        })
      )
    );
  }

  function TabHeartRate(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeightForPr = props.userWeight || 0;
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var pr = function(field) { return isPr(log, yearlyPeaks, field, userWeightForPr); };
    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '평균 심박', value: log.avg_hr != null && log.avg_hr > 0 ? Math.round(log.avg_hr) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박', value: log.max_hr != null && log.max_hr > 0 ? Math.round(log.max_hr) + ' bpm' : '-', isPr: pr('max_hr') }),
      React.createElement('div', { className: 'journal-peak-chart-section' },
        React.createElement('div', { className: 'journal-peak-chart-title' }, '구간별 최대 심박'),
        React.createElement(JournalSessionHrPeakChart, {
          log: log,
          yearlyPeaks: yearlyPeaks,
          userWeight: userWeightForPr
        })
      )
    );
  }

  function JournalDetailBottomSheet(props) {
    var open = props.open;
    var onClose = props.onClose;
    var logs = props.logs || [];
    var selectedDate = props.selectedDate;
    var yearlyPeaksByYear = props.yearlyPeaksByYear || {};
    var userWeightForPr = props.userWeightForPr || 0;

    var _useState = useState('summary');
    var activeTab = _useState[0];
    var setActiveTab = _useState[1];

    if (!open) return null;

    var merged = mergeLogsForDetail(logs);
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
            var p = t.id === 'summary'
              ? { log: merged, userProfile: props.userProfile || {} }
              : { log: merged, yearlyPeaks: yearlyPeaks, userWeight: userWeightForPr };
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
