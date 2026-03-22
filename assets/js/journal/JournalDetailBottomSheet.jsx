/**
 * JournalDetailBottomSheet - 라이딩 상세 3탭 (Summary / Power Profile / Heart Rate)
 * 모바일 친화적 Bottom Sheet, 27개 항목 그룹화
 */
/* global React, useState */

(function() {
  'use strict';

  if (!window.React) return;

  var ReactObj = window.React;
  var useState = ReactObj.useState;

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

  function mergeLogsForDetail(logs) {
    if (!logs || logs.length === 0) return null;
    var log = logs[0];
    if (logs.length === 1) {
      var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
      return {
        date: log.date,
        distance_km: log.distance_km,
        duration_sec: sec,
        tss: log.tss,
        if: log.if,
        kilojoules: log.kilojoules,
        avg_cadence: log.avg_cadence,
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
    var sumNpSec = 0, sumApSec = 0, sumHrSec = 0;
    var maxHr = 0, maxHr5 = 0, maxHr1 = 0, maxHr5m = 0, maxHr10 = 0, maxHr20 = 0, maxHr40 = 0, maxHr60 = 0;
    var max1w = 0, max5w = 0, max10w = 0, max20w = 0, max30w = 0, max40w = 0, max60w = 0, maxW = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      var s = Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
      totalSec += s;
      totalTSS += Number(l.tss || 0);
      totalDist += Number(l.distance_km || 0);
      totalKj += Number(l.kilojoules || 0);
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
    }
    return {
      date: logs[0].date,
      distance_km: totalDist,
      duration_sec: totalSec,
      tss: totalTSS,
      if: null,
      kilojoules: totalKj,
      avg_cadence: null,
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
      time_in_zones: logs[0].time_in_zones,
      source: logs[0].source
    };
  }

  function DetailRow(props) {
    return React.createElement('div', { className: 'journal-detail-row' },
      React.createElement('span', { className: 'journal-detail-label' }, props.label),
      React.createElement('span', { className: 'journal-detail-value-wrap' },
        React.createElement('span', { className: 'journal-detail-value' }, props.value),
        props.isPr ? React.createElement('span', { className: 'training-detail-pr-badge' }, 'PR') : null
      )
    );
  }

  function isPr(log, yearlyPeaks, field, userWeight) {
    if (!log || !yearlyPeaks || typeof window.isPrField !== 'function') return false;
    return window.isPrField(log, yearlyPeaks, field, userWeight);
  }

  function TabSummary(props) {
    var log = props.log;
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '거리', value: log.distance_km != null && log.distance_km > 0 ? log.distance_km.toFixed(1) + ' km' : '-', isPr: false }),
      DetailRow({ label: '훈련시간', value: formatDuration(log.duration_sec), isPr: false }),
      DetailRow({ label: 'KJ', value: log.kilojoules != null && log.kilojoules > 0 ? Math.round(log.kilojoules) + ' KJ' : '-', isPr: false }),
      DetailRow({ label: 'TSS', value: log.tss != null && log.tss > 0 ? Math.round(log.tss) : '-', isPr: false }),
      DetailRow({ label: 'IF', value: log.if != null && log.if > 0 ? log.if.toFixed(2) : '-', isPr: false })
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
      DetailRow({ label: '피크 파워(1분)', value: log.max_1min_watts != null && log.max_1min_watts > 0 ? Math.round(log.max_1min_watts) + ' W' : '-', isPr: pr('max_1min_watts') }),
      DetailRow({ label: '피크 파워(5분)', value: log.max_5min_watts != null && log.max_5min_watts > 0 ? Math.round(log.max_5min_watts) + ' W' : '-', isPr: pr('max_5min_watts') }),
      DetailRow({ label: '피크 파워(10분)', value: log.max_10min_watts != null && log.max_10min_watts > 0 ? Math.round(log.max_10min_watts) + ' W' : '-', isPr: pr('max_10min_watts') }),
      DetailRow({ label: '피크 파워(20분)', value: log.max_20min_watts != null && log.max_20min_watts > 0 ? Math.round(log.max_20min_watts) + ' W' : '-', isPr: pr('max_20min_watts') }),
      DetailRow({ label: '피크 파워(30분)', value: log.max_30min_watts != null && log.max_30min_watts > 0 ? Math.round(log.max_30min_watts) + ' W' : '-', isPr: pr('max_30min_watts') }),
      DetailRow({ label: '피크 파워(40분)', value: log.max_40min_watts != null && log.max_40min_watts > 0 ? Math.round(log.max_40min_watts) + ' W' : '-', isPr: pr('max_40min_watts') }),
      DetailRow({ label: '피크 파워(60분)', value: log.max_60min_watts != null && log.max_60min_watts > 0 ? Math.round(log.max_60min_watts) + ' W' : '-', isPr: pr('max_60min_watts') }),
      DetailRow({ label: '최대 파워', value: log.max_watts != null && log.max_watts > 0 ? Math.round(log.max_watts) + ' W' : '-', isPr: pr('max_watts') })
    );
  }

  function TabHeartRate(props) {
    var log = props.log;
    var yearlyPeaks = props.yearlyPeaks;
    var userWeight = props.userWeight || 0;
    if (!log) return React.createElement('div', { className: 'journal-tab-empty' }, '데이터 없음');
    var pr = function(field) { return isPr(log, yearlyPeaks, field, userWeight); };
    return React.createElement('div', { className: 'journal-tab-content' },
      DetailRow({ label: '평균 심박', value: log.avg_hr != null && log.avg_hr > 0 ? Math.round(log.avg_hr) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박', value: log.max_hr != null && log.max_hr > 0 ? Math.round(log.max_hr) + ' bpm' : '-', isPr: pr('max_hr') }),
      DetailRow({ label: '최대 심박(5초)', value: log.max_hr_5sec != null && log.max_hr_5sec > 0 ? Math.round(log.max_hr_5sec) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(1분)', value: log.max_hr_1min != null && log.max_hr_1min > 0 ? Math.round(log.max_hr_1min) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(5분)', value: log.max_hr_5min != null && log.max_hr_5min > 0 ? Math.round(log.max_hr_5min) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(10분)', value: log.max_hr_10min != null && log.max_hr_10min > 0 ? Math.round(log.max_hr_10min) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(20분)', value: log.max_hr_20min != null && log.max_hr_20min > 0 ? Math.round(log.max_hr_20min) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(40분)', value: log.max_hr_40min != null && log.max_hr_40min > 0 ? Math.round(log.max_hr_40min) + ' bpm' : '-', isPr: false }),
      DetailRow({ label: '최대 심박(60분)', value: log.max_hr_60min != null && log.max_hr_60min > 0 ? Math.round(log.max_hr_60min) + ' bpm' : '-', isPr: false })
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
            var p = t.id === 'summary' ? { log: merged } : { log: merged, yearlyPeaks: yearlyPeaks, userWeight: userWeightForPr };
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
