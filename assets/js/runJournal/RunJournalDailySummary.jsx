/**
 * RunJournalDailySummary — 선택일 RUN 요약
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var pr = function () { return window.runJournalPrUtils; };

  function formatDuration(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (s <= 0) return '—';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + '시간 ' + m + '분';
    return m + '분 ' + r + '초';
  }

  function mergeDay(logs) {
    if (!logs || !logs.length) return null;
    var totalSec = 0, totalDist = 0, totalTss = 0, sumHr = 0, maxHr = 0, sumElev = 0;
    logs.forEach(function (l) {
      var sec = Number(l.duration_sec != null ? l.duration_sec : l.time) || 0;
      totalSec += sec;
      totalDist += Number(l.distance_km) || 0;
      totalTss += Number(l.tss) || 0;
      sumHr += (Number(l.avg_hr) || 0) * sec;
      if (Number(l.max_hr) > maxHr) maxHr = Number(l.max_hr);
      sumElev += Number(l.elevation_gain) || 0;
    });
    var paceSec = totalDist > 0 && totalSec > 0 ? totalSec / totalDist : null;
    return {
      count: logs.length,
      durationSec: totalSec,
      distanceKm: totalDist,
      tss: Math.round(totalTss * 10) / 10,
      avgHr: totalSec > 0 ? Math.round(sumHr / totalSec) : null,
      maxHr: maxHr || null,
      elevationGain: sumElev > 0 ? sumElev : null,
      paceSec: paceSec,
    };
  }

  function formatDateHeading(dateKey, logs) {
    if (!dateKey) return '';
    var p = dateKey.split('-');
    var base = p[0] + '년 ' + parseInt(p[1], 10) + '월 ' + parseInt(p[2], 10) + '일 요약';
    var titles = (logs || []).map(function (l) { return l.title; }).filter(Boolean);
    if (!titles.length) return base;
    return base + ' · ' + titles.join(' · ');
  }

  function RunJournalDailySummary(props) {
    var selectedDate = props.selectedDate;
    var logs = props.logs || [];
    var onShowDetail = props.onShowDetail;
    var MapPreview = window.JournalCourseMapPreview;
    var summary = mergeDay(logs);

    if (!selectedDate) {
      return R.createElement('p', { className: 'journal-empty-hint' }, '달력에서 날짜를 선택하세요.');
    }
    if (!summary) {
      return R.createElement('p', { className: 'journal-empty-hint' }, '이 날짜에 RUN 기록이 없습니다.');
    }

    var hasRoute = logs.some(function (l) { return l.summary_polyline && String(l.summary_polyline).trim(); });
    var paceLabel = summary.paceSec != null ? pr().formatPaceFromSpeed(1000 / summary.paceSec) : '—';

    return R.createElement('div', {
      className: 'journal-daily-summary' + (hasRoute ? ' journal-daily-summary--with-route' : '')
    },
      R.createElement('div', { className: 'journal-daily-summary-header' },
        R.createElement('h3', { className: 'journal-daily-summary-title' }, formatDateHeading(selectedDate, logs))
      ),
      hasRoute && MapPreview
        ? R.createElement('div', { className: 'journal-course-map-wrap journal-daily-summary-map' },
          R.createElement(MapPreview, { logs: logs, dateKey: selectedDate, mapHeight: 180 })
        )
        : null,
      R.createElement('div', { className: 'journal-daily-summary-grid' },
        R.createElement('div', { className: 'journal-summary-item' },
          R.createElement('span', { className: 'journal-summary-label' }, '활동'),
          R.createElement('span', { className: 'journal-summary-value' }, summary.count + '건')
        ),
        R.createElement('div', { className: 'journal-summary-item' },
          R.createElement('span', { className: 'journal-summary-label' }, '거리'),
          R.createElement('span', { className: 'journal-summary-value' }, (Math.round(summary.distanceKm * 100) / 100) + ' km')
        ),
        R.createElement('div', { className: 'journal-summary-item' },
          R.createElement('span', { className: 'journal-summary-label' }, '시간'),
          R.createElement('span', { className: 'journal-summary-value' }, formatDuration(summary.durationSec))
        ),
        R.createElement('div', { className: 'journal-summary-item' },
          R.createElement('span', { className: 'journal-summary-label' }, '평균 페이스'),
          R.createElement('span', { className: 'journal-summary-value' }, paceLabel)
        ),
        R.createElement('div', { className: 'journal-summary-item' },
          R.createElement('span', { className: 'journal-summary-label' }, 'TSS'),
          R.createElement('span', { className: 'journal-summary-value' }, summary.tss)
        ),
        summary.avgHr
          ? R.createElement('div', { className: 'journal-summary-item' },
            R.createElement('span', { className: 'journal-summary-label' }, '평균 심박'),
            R.createElement('span', { className: 'journal-summary-value' }, summary.avgHr + ' bpm')
          )
          : null,
        summary.elevationGain
          ? R.createElement('div', { className: 'journal-summary-item' },
            R.createElement('span', { className: 'journal-summary-label' }, '고도 상승'),
            R.createElement('span', { className: 'journal-summary-value' }, Math.round(summary.elevationGain) + ' m')
          )
          : null
      ),
      R.createElement('div', { className: 'journal-daily-summary-actions' },
        R.createElement('button', {
          type: 'button',
          className: 'stelvio-ranking-board-entry-btn',
          onClick: onShowDetail
        }, '상세 기록 보기')
      )
    );
  }

  window.RunJournalDailySummary = RunJournalDailySummary;
})();
