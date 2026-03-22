/**
 * JournalDailySummary - 선택된 날짜의 핵심 지표 요약 카드
 * 모달 대신 달력 하단에 인라인 표시, "상세 기록 보기" → Bottom Sheet 트리거
 */
/* global React */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[JournalDailySummary] React not loaded');
    return;
  }

  var ReactObj = window.React;

  function formatDuration(sec) {
    if (sec == null || sec === '' || Number.isNaN(Number(sec))) return '-';
    var s = Math.floor(Number(sec));
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    s = s % 60;
    m = m % 60;
    if (h > 0) return h + '시간 ' + m + '분';
    return m + '분 ' + s + '초';
  }

  function mergeLogsForSummary(logs) {
    if (!logs || logs.length === 0) return null;
    if (logs.length === 1) {
      var log = logs[0];
      var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
      return {
        distance: log.distance_km != null ? Number(log.distance_km) : 0,
        durationSec: sec,
        tss: log.tss != null ? Number(log.tss) : 0,
        if: log.if != null ? Number(log.if) : null,
        kj: log.kilojoules != null ? Number(log.kilojoules) : 0,
        avgWatts: log.avg_watts != null ? Number(log.avg_watts) : null,
        np: log.weighted_watts != null ? Number(log.weighted_watts) : (log.avg_watts != null ? Number(log.avg_watts) : null),
        avgHr: log.avg_hr != null ? Number(log.avg_hr) : null,
        maxHr: log.max_hr != null ? Number(log.max_hr) : null
      };
    }
    var totalSec = 0, totalTSS = 0, totalDist = 0, totalKj = 0;
    var sumNpSec = 0, sumApSec = 0, sumHrSec = 0;
    var maxHr = 0;
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
      if (l.max_hr != null && Number(l.max_hr) > maxHr) maxHr = Number(l.max_hr);
    }
    return {
      distance: totalDist,
      durationSec: totalSec,
      tss: totalTSS,
      if: null,
      kj: totalKj,
      avgWatts: totalSec > 0 ? sumApSec / totalSec : null,
      np: totalSec > 0 ? sumNpSec / totalSec : null,
      avgHr: totalSec > 0 ? sumHrSec / totalSec : null,
      maxHr: maxHr || null
    };
  }

  function formatDateKey(key) {
    if (!key || key.length < 10) return key;
    var parts = key.split('-');
    if (parts.length >= 3) return parts[0] + '년 ' + parseInt(parts[1], 10) + '월 ' + parseInt(parts[2], 10) + '일';
    return key;
  }

  function JournalDailySummary(props) {
    var selectedDate = props.selectedDate;
    var logs = props.logs || [];
    var onShowDetail = props.onShowDetail;

    if (!selectedDate || logs.length === 0) {
      return null;
    }

    var summary = mergeLogsForSummary(logs);

    return React.createElement('div', { className: 'card journal-daily-summary' },
      React.createElement('div', { className: 'journal-daily-summary-header' },
        React.createElement('h3', { className: 'journal-daily-summary-title' }, formatDateKey(selectedDate) + ' 요약')
      ),
      React.createElement('div', { className: 'journal-daily-summary-grid' },
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '거리'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.distance != null && summary.distance > 0 ? summary.distance.toFixed(1) + ' km' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '시간'),
          React.createElement('span', { className: 'journal-summary-value' }, formatDuration(summary.durationSec))
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, 'TSS'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.tss != null && summary.tss > 0 ? Math.round(summary.tss) : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '평균 파워'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgWatts != null && summary.avgWatts > 0 ? Math.round(summary.avgWatts) + ' W' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, 'IF'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.if != null && summary.if > 0 ? summary.if.toFixed(2) : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '평균 심박'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgHr != null && summary.avgHr > 0 ? Math.round(summary.avgHr) + ' bpm' : '-')
        )
      ),
      React.createElement('div', { className: 'journal-daily-summary-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'stelvio-ranking-board-entry-btn stelvio-purple-btn',
          onClick: onShowDetail,
          'aria-label': '상세 기록 보기'
        },
          React.createElement('span', { className: 'stelvio-ranking-btn-left' }, '상세 기록'),
          React.createElement('img', {
            src: 'assets/img/stelvio_w.png',
            alt: '',
            className: 'stelvio-ranking-btn-logo',
            style: { height: 28, width: 'auto', margin: 0 }
          }),
          React.createElement('span', { className: 'stelvio-ranking-btn-right' }, '보기')
        )
      )
    );
  }

  window.JournalDailySummary = JournalDailySummary;
})();
