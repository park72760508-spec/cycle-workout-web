/**
 * RunJournalCalendarWidget — RUN 기록 날짜별 달력
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var pr = function () { return window.runJournalPrUtils; };

  function getDateKey(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function isOutdoorLog(log) {
    var eg = log && log.elevation_gain;
    return eg != null && eg !== '' && !Number.isNaN(Number(eg)) && Number(eg) > 0;
  }

  function hasOutdoor(logs) {
    for (var i = 0; i < logs.length; i++) {
      if (isOutdoorLog(logs[i])) return true;
    }
    return false;
  }

  function hasIndoor(logs) {
    for (var i = 0; i < logs.length; i++) {
      if (!isOutdoorLog(logs[i])) return true;
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

    var firstDay = new Date(currentYear, currentMonth, 1);
    var startDow = firstDay.getDay();
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    var todayKey = getDateKey(new Date());
    var cells = [];
    var i, day, key, logs, hasPr, hasI, hasO;

    for (i = 0; i < startDow; i++) {
      cells.push(R.createElement('div', { key: 'e' + i, className: 'mini-calendar-day empty' }));
    }
    for (day = 1; day <= daysInMonth; day++) {
      key = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      logs = trainingLogs[key] || [];
      hasPr = logs.length > 0 && pr().logsHaveAnyPr(logs, props.effortsByActivityId, yearlyPacePrByYear);
      hasI = logs.length > 0 && hasIndoor(logs);
      hasO = logs.length > 0 && hasOutdoor(logs);
      cells.push(R.createElement('button', {
        key: key,
        type: 'button',
        className: 'mini-calendar-day run-journal-day' +
          (logs.length ? ' has-training' : '') +
          (key === todayKey ? ' today' : '') +
          (selectedDate === key ? ' selected' : '') +
          (hasPr ? ' has-pr' : ''),
        onClick: function (dk) { return function () { if (onDateSelect) onDateSelect(dk); }; }(key),
        'aria-label': key + (logs.length ? ' RUN ' + logs.length + '건' : '') + (key === todayKey ? ' 오늘' : '')
      },
        R.createElement('span', { className: 'run-journal-day-inner' },
          hasO ? R.createElement('span', { className: 'mini-calendar-dot run-dot run-dot-outdoor', 'aria-hidden': true }) : null,
          hasI ? R.createElement('span', { className: 'mini-calendar-dot run-dot run-dot-indoor', 'aria-hidden': true }) : null,
          R.createElement('span', { className: 'mini-calendar-day-num' }, day)
        ),
        hasPr ? R.createElement('span', { className: 'mini-calendar-pr-badge', title: 'PR' }, 'PR') : null
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
      R.createElement('div', { className: 'mini-calendar-grid' }, cells),
      R.createElement('div', { className: 'journal-strava-legend-row run-journal-legend' },
        R.createElement('div', { className: 'journal-legend' },
          R.createElement('span', { className: 'legend-row' },
            R.createElement('span', { className: 'legend-dot run-legend-dot run-legend-dot-outdoor' }),
            R.createElement('span', null, 'Outdoor')
          ),
          R.createElement('span', { className: 'legend-row' },
            R.createElement('span', { className: 'legend-dot run-legend-dot run-legend-dot-indoor' }),
            R.createElement('span', null, 'Indoor')
          )
        )
      )
    );
  }

  window.RunJournalCalendarWidget = RunJournalCalendarWidget;
})();
