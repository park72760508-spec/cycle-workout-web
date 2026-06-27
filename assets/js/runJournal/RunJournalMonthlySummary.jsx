/**
 * RunJournalMonthlySummary — RUN 월간 누적 (라이딩 journal-bento 디자인)
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function getMonthDateRange(year, monthIndex) {
    var month = monthIndex + 1;
    var now = new Date();
    var isCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
    var startStr = year + '-' + pad2(month) + '-01';
    var endStr;
    if (isCurrentMonth) {
      endStr =
        now.getFullYear() +
        '-' +
        pad2(now.getMonth() + 1) +
        '-' +
        pad2(now.getDate());
    } else {
      var lastDay = new Date(year, month, 0).getDate();
      endStr = year + '-' + pad2(month) + '-' + pad2(lastDay);
    }
    return {
      startStr: startStr,
      endStr: endStr,
    };
  }

  function formatPeriodHint(startStr, endStr) {
    if (!startStr || !endStr) return '';
    var s = startStr.split('-');
    var e = endStr.split('-');
    if (s.length < 3 || e.length < 3) return '';
    return (
      '* ' +
      parseInt(s[1], 10) +
      '/' +
      parseInt(s[2], 10) +
      ' ~ ' +
      parseInt(e[1], 10) +
      '/' +
      parseInt(e[2], 10) +
      ' 누적'
    );
  }

  function sanitizeTss(val) {
    var n = Number(val) || 0;
    return n > 0 && n < 1200 ? n : 0;
  }

  function formatDurationHHMM(totalSec) {
    var minutes = Math.round(Number(totalSec) / 60);
    if (!minutes || minutes <= 0) return '0m';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h === 0) return m + 'm';
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
  }

  function buildMonthlyRunStats(trainingLogs, year, monthIndex) {
    var range = getMonthDateRange(year, monthIndex);
    var totalSec = 0;
    var totalDist = 0;
    var totalTss = 0;
    var runCount = 0;
    Object.keys(trainingLogs || {}).forEach(function (dateKey) {
      if (dateKey < range.startStr || dateKey > range.endStr) return;
      var arr = trainingLogs[dateKey];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (log) {
        var sec = Number(log.duration_sec != null ? log.duration_sec : log.time) || 0;
        totalSec += sec;
        totalDist += Number(log.distance_km) || 0;
        totalTss += sanitizeTss(log.tss);
        runCount += 1;
      });
    });
    return {
      totalDurationFormatted: formatDurationHHMM(totalSec),
      totalDistance: totalDist.toFixed(1),
      totalTSS: Math.round(totalTss),
      runCount: runCount,
      periodHint: formatPeriodHint(range.startStr, range.endStr),
    };
  }

  function BentoCard(label, value) {
    return R.createElement('div', { className: 'journal-bento-card' },
      R.createElement('span', { className: 'journal-bento-label' }, label),
      R.createElement('span', { className: 'journal-bento-value' }, value)
    );
  }

  function RunJournalMonthlySummary(props) {
    var trainingLogs = props.trainingLogs || {};
    var currentYear = props.currentYear;
    var currentMonth = props.currentMonth;
    var stats = buildMonthlyRunStats(trainingLogs, currentYear, currentMonth);

    return R.createElement('div', { className: 'run-journal-monthly-summary' },
      R.createElement('div', { className: 'journal-bento-grid' },
        BentoCard('총 시간', stats.totalDurationFormatted),
        BentoCard('총 거리', stats.totalDistance + ' km'),
        BentoCard('총 TSS', String(stats.totalTSS)),
        BentoCard('러닝 횟수', stats.runCount + '회')
      ),
      stats.periodHint
        ? R.createElement('p', { className: 'journal-bento-period-hint' }, stats.periodHint)
        : null
    );
  }

  window.RunJournalMonthlySummary = RunJournalMonthlySummary;
})();
