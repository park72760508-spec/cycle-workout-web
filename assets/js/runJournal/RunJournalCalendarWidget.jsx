/**
 * RunJournalCalendarWidget — RUN 기록 날짜별 달력
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var useMemo = R.useMemo;
  var pr = function () { return window.runJournalPrUtils; };

  function getDateKey(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function isHoliday(year, month, day) {
    var date = new Date(year, month, day);
    if (date.getDay() === 0) return false;
    var fixed = [
      { month: 0, day: 1 }, { month: 2, day: 1 }, { month: 4, day: 5 },
      { month: 5, day: 6 }, { month: 7, day: 15 }, { month: 9, day: 3 },
      { month: 9, day: 9 }, { month: 11, day: 25 }
    ];
    if (month === 4 && day === 15) return true;
    for (var i = 0; i < fixed.length; i++) {
      if (month === fixed[i].month && day === fixed[i].day) return true;
    }
    return false;
  }

  function RunJournalCalendarWidget(props) {
    var trainingLogs = props.trainingLogs || {};
    var currentYear = props.currentYear;
    var currentMonth = props.currentMonth;
    var onNavigate = props.onNavigate;
    var onDateSelect = props.onDateSelect;
    var selectedDate = props.selectedDate;
    var yearlyPacePrByYear = props.yearlyPacePrByYear || {};
    var effortsByActivityId = props.effortsByActivityId || {};

    var prByDateKey = useMemo(function () {
      var out = {};
      var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      var day;
      for (day = 1; day <= daysInMonth; day++) {
        var key = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        var logs = trainingLogs[key] || [];
        out[key] = logs.length > 0 && pr().logsHaveAnyPr(logs, effortsByActivityId, yearlyPacePrByYear);
      }
      return out;
    }, [trainingLogs, effortsByActivityId, yearlyPacePrByYear, currentYear, currentMonth]);

    var firstDay = new Date(currentYear, currentMonth, 1);
    var startDow = firstDay.getDay();
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    var todayKey = getDateKey(new Date());
    var cells = [];
    var i, day, key, logs, hasPr, d, dow, dayCls;

    for (i = 0; i < startDow; i++) {
      cells.push(R.createElement('div', { key: 'e' + i, className: 'mini-calendar-day empty' }));
    }
    for (day = 1; day <= daysInMonth; day++) {
      key = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      logs = trainingLogs[key] || [];
      hasPr = !!prByDateKey[key];
      d = new Date(currentYear, currentMonth, day);
      dow = d.getDay();
      dayCls = '';
      if (dow === 0) dayCls = ' sunday';
      else if (isHoliday(currentYear, currentMonth, day)) dayCls = ' holiday';
      else if (dow === 6) dayCls = ' saturday';
      cells.push(R.createElement('button', {
        key: key,
        type: 'button',
        className: 'mini-calendar-day run-journal-day' + dayCls +
          (logs.length ? ' has-training' : '') +
          (key === todayKey ? ' today' : '') +
          (selectedDate === key ? ' selected' : '') +
          (hasPr ? ' journal-has-pr' : ''),
        onClick: function (dk) { return function () { if (onDateSelect) onDateSelect(dk); }; }(key),
        'aria-label': key + (logs.length ? ' RUN ' + logs.length + '건' : '') + (hasPr ? ' PR' : '') + (key === todayKey ? ' 오늘' : '')
      },
        hasPr
          ? R.createElement(
              'span',
              { className: 'day-number-wrap' },
              R.createElement('span', { className: 'day-number' }, day),
              R.createElement('span', { className: 'journal-pr-corner-badge', 'aria-label': 'PR' }, 'PR')
            )
          : R.createElement('span', { className: 'day-number' }, day)
      ));
    }

    return R.createElement('div', { className: 'journal-calendar-widget card' },
      R.createElement('div', { className: 'mini-calendar-header' },
        R.createElement('button', {
          type: 'button',
          className: 'mini-calendar-nav-btn',
          onClick: function () { if (onNavigate) onNavigate('prev'); },
          'aria-label': '이전 달'
        }, '‹'),
        R.createElement('span', { className: 'mini-calendar-month-year' },
          currentYear + '년 ' + (currentMonth + 1) + '월'
        ),
        R.createElement('button', {
          type: 'button',
          className: 'mini-calendar-nav-btn',
          onClick: function () { if (onNavigate) onNavigate('next'); },
          'aria-label': '다음 달'
        }, '›')
      ),
      R.createElement('div', { className: 'mini-calendar-weekdays' },
        ['일', '월', '화', '수', '목', '금', '토'].map(function (w) {
          return R.createElement('div', { key: w, className: 'mini-calendar-weekday' }, w);
        })
      ),
      R.createElement('div', { className: 'mini-calendar-grid' }, cells)
    );
  }

  window.RunJournalCalendarWidget = RunJournalCalendarWidget;
})();
