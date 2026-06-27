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
    if (isCurrentMonth) {
      var endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 29);
      return {
        startStr:
          startDate.getFullYear() +
          '-' +
          pad2(startDate.getMonth() + 1) +
          '-' +
          pad2(startDate.getDate()),
        endStr:
          endDate.getFullYear() +
          '-' +
          pad2(endDate.getMonth() + 1) +
          '-' +
          pad2(endDate.getDate()),
        isCurrentMonth: true,
      };
    }
    var lastDay = new Date(year, month, 0).getDate();
    return {
      startStr: year + '-' + pad2(month) + '-01',
      endStr: year + '-' + pad2(month) + '-' + pad2(lastDay),
      isCurrentMonth: false,
    };
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
      isCurrentMonth: range.isCurrentMonth,
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
      stats.isCurrentMonth
        ? R.createElement('p', { className: 'journal-bento-period-hint' }, '* 오늘 기준 1개월간')
        : null
    );
  }

  window.RunJournalMonthlySummary = RunJournalMonthlySummary;
})();
