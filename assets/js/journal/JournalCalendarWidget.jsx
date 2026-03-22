/**
 * JournalCalendarWidget - 라이딩 일지 미니 달력
 * 실내/실외 구분, PR 표시 등 기존 로직 유지, Progressive Disclosure 적용
 */
/* global React */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[JournalCalendarWidget] React not loaded');
    return;
  }

  var ReactObj = window.React;

  function getDateKey(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
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

  function hasIndoor(logs) {
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      var isStrava = String(log.source || '') === 'strava';
      var eg = log.elevation_gain;
      var hasElevation = eg != null && eg !== '' && !Number.isNaN(Number(eg)) && Number(eg) > 0;
      if (!(isStrava && hasElevation)) return true;
    }
    return false;
  }

  function hasOutdoor(logs) {
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      var isStrava = String(log.source || '') === 'strava';
      var eg = log.elevation_gain;
      var hasElevation = eg != null && eg !== '' && !Number.isNaN(Number(eg)) && Number(eg) > 0;
      if (isStrava && hasElevation) return true;
    }
    return false;
  }

  function hasAnyPr(logs, year, yearlyPeaksByYear, userWeight) {
    if (!logs || logs.length === 0 || !yearlyPeaksByYear || typeof window.logHasAnyPr !== 'function') return false;
    var peaks = yearlyPeaksByYear[year];
    if (!peaks) return false;
    for (var i = 0; i < logs.length; i++) {
      if (window.logHasAnyPr(logs[i], peaks, userWeight)) return true;
    }
    return false;
  }

  function JournalCalendarWidget(props) {
    var trainingLogs = props.trainingLogs || {};
    var currentYear = props.currentYear;
    var currentMonth = props.currentMonth;
    var onNavigate = props.onNavigate;
    var onDateSelect = props.onDateSelect;
    var selectedDate = props.selectedDate;
    var yearlyPeaksByYear = props.yearlyPeaksByYear || {};
    var userWeightForPr = props.userWeightForPr || 0;

    var year = currentYear;
    var month = currentMonth;
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var firstDayOfWeek = firstDay.getDay();
    var daysInMonth = lastDay.getDate();
    var prevMonthLastDay = new Date(year, month, 0).getDate();
    var today = new Date();
    var todayKey = getDateKey(today);

    var cells = [];
    var dayNum;

    // 이전 달
    for (dayNum = firstDayOfWeek - 1; dayNum >= 0; dayNum--) {
      var prevDay = prevMonthLastDay - dayNum;
      var prevDate = new Date(year, month - 1, prevDay);
      var prevKey = getDateKey(prevDate);
      var prevLogs = trainingLogs[prevKey] || [];
      var hasTrain = prevLogs.length > 0;
      var hi = hasIndoor(prevLogs);
      var ho = hasOutdoor(prevLogs);
      var dow = prevDate.getDay();
      var sunOrHol = dow === 0 || isHoliday(year, month - 1, prevDay);
      var cls = 'other-month';
      if (hasTrain) {
        if (hi) cls += ' has-training has-indoor' + (sunOrHol ? ' indoor-holiday' : ' indoor-weekday');
        if (ho) cls += ' has-training has-outdoor' + (sunOrHol ? ' outdoor-holiday' : ' outdoor-weekday');
        var prevYear = parseInt(prevKey.substring(0, 4), 10);
        if (hasAnyPr(prevLogs, prevYear, yearlyPeaksByYear, userWeightForPr)) cls += ' journal-has-pr';
      }
      cells.push({
        key: 'prev-' + prevKey,
        day: prevDay,
        dateKey: prevKey,
        className: cls,
        isOtherMonth: true
      });
    }

    // 현재 달
    for (dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      var d = new Date(year, month, dayNum);
      var dateKey = getDateKey(d);
      var logs = trainingLogs[dateKey] || [];
      var hasTraining = logs.length > 0;
      var hasI = hasIndoor(logs);
      var hasO = hasOutdoor(logs);
      dow = d.getDay();
      sunOrHol = dow === 0 || isHoliday(year, month, dayNum);
      cls = '';
      if (sunOrHol) cls = 'holiday';
      else if (dow === 0) cls = 'sunday';
      else if (dow === 6) cls = 'saturday';
      else cls = 'weekday';
      if (hasTraining) {
        if (hasI) cls += ' has-training has-indoor' + (sunOrHol ? ' indoor-holiday' : ' indoor-weekday');
        if (hasO) cls += ' has-training has-outdoor' + (sunOrHol ? ' outdoor-holiday' : ' outdoor-weekday');
        var cellYear = parseInt(dateKey.substring(0, 4), 10);
        if (hasAnyPr(logs, cellYear, yearlyPeaksByYear, userWeightForPr)) cls += ' journal-has-pr';
      }
      if (dateKey === todayKey) cls += ' today';
      if (dateKey === selectedDate) cls += ' selected';
      cells.push({
        key: dateKey,
        day: dayNum,
        dateKey: dateKey,
        className: cls,
        isOtherMonth: false,
        hasTraining: hasTraining
      });
    }

    // 다음 달
    var remaining = 42 - cells.length;
    for (dayNum = 1; dayNum <= remaining; dayNum++) {
      var nextDate = new Date(year, month + 1, dayNum);
      var nextKey = getDateKey(nextDate);
      var nextLogs = trainingLogs[nextKey] || [];
      hasTrain = nextLogs.length > 0;
      hi = hasIndoor(nextLogs);
      ho = hasOutdoor(nextLogs);
      dow = nextDate.getDay();
      sunOrHol = dow === 0 || isHoliday(year, month + 1, dayNum);
      cls = 'other-month';
      if (hasTrain) {
        if (hi) cls += ' has-training has-indoor' + (sunOrHol ? ' indoor-holiday' : ' indoor-weekday');
        if (ho) cls += ' has-training has-outdoor' + (sunOrHol ? ' outdoor-holiday' : ' outdoor-weekday');
        var nextYear = parseInt(nextKey.substring(0, 4), 10);
        if (hasAnyPr(nextLogs, nextYear, yearlyPeaksByYear, userWeightForPr)) cls += ' journal-has-pr';
      }
      cells.push({
        key: 'next-' + nextKey,
        day: dayNum,
        dateKey: nextKey,
        className: cls,
        isOtherMonth: true
      });
    }

    function handleCellClick(cell) {
      if (cell.hasTraining || cell.isOtherMonth) {
        if (typeof onDateSelect === 'function') onDateSelect(cell.dateKey);
      }
    }

    function openStravaOrSettings() {
      try {
        var user = window.currentUser || (function(){ try { return JSON.parse(localStorage.getItem('currentUser')||'null'); } catch(e){ return null; } })();
        var connected = user && (user.strava_refresh_token || user.strava_access_token);
        if (connected) {
          if (typeof window.openStravaSyncModal === 'function') window.openStravaSyncModal();
          else {
            var modal = document.getElementById('stravaSyncModal');
            if (modal) { modal.style.display='flex'; modal.classList.remove('hidden'); }
            else if (typeof showScreen === 'function') showScreen('stravaSyncScreen');
          }
        } else {
          if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
          else {
            var sm = document.getElementById('settingsModal');
            if (sm) { sm.style.display='block'; sm.classList.remove('hidden'); }
          }
        }
      } catch (e) { console.error(e); }
    }

    return React.createElement('div', { className: 'card journal-calendar-widget' },
      React.createElement('div', { className: 'mini-calendar-container' },
        React.createElement('div', { className: 'mini-calendar-header journal-header-with-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'mini-calendar-nav-btn',
            'aria-label': '이전 달',
            onClick: function() { if (onNavigate) onNavigate('prev'); }
          }, React.createElement('svg', { width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15 19l-7-7 7-7' }))),
          React.createElement('span', { className: 'mini-calendar-month-year' }, year + '년 ' + (month + 1) + '월'),
          React.createElement('button', {
            type: 'button',
            className: 'mini-calendar-nav-btn',
            'aria-label': '다음 달',
            onClick: function() { if (onNavigate) onNavigate('next'); }
          }, React.createElement('svg', { width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M9 5l7 7-7 7' })))
        ),
        React.createElement('div', { className: 'mini-calendar-weekdays' },
          ['일', '월', '화', '수', '목', '금', '토'].map(function(w) {
            return React.createElement('div', { key: w, className: 'mini-calendar-weekday' }, w);
          })
        ),
        React.createElement('div', { className: 'mini-calendar-grid journal-calendar-grid' },
          cells.map(function(cell) {
            return React.createElement('div', {
              key: cell.key,
              className: 'mini-calendar-day ' + cell.className,
              style: (cell.hasTraining || cell.isOtherMonth) ? { cursor: 'pointer' } : {},
              onClick: function() { handleCellClick(cell); },
              role: cell.hasTraining ? 'button' : undefined
            }, React.createElement('span', { className: 'day-number' }, cell.day));
          })
        ),
        React.createElement('div', {
          className: 'journal-strava-legend-row',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 10, position: 'relative' }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 } },
            React.createElement('button', {
              type: 'button',
              style: { background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: 4, cursor: 'pointer', display: 'inline-block', lineHeight: 0, boxSizing: 'border-box' },
              onClick: openStravaOrSettings,
              'aria-label': 'Strava 동기화',
              title: 'Strava 동기화'
            }, React.createElement('img', {
              src: 'assets/img/download%20STRAVA.png',
              alt: 'Connect with Strava',
              style: { height: 30, width: 'auto', maxWidth: 160, display: 'block' }
            }))
          ),
          React.createElement('div', {
            className: 'journal-legend',
            style: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2, color: '#6b7280' }
          },
            React.createElement('span', { className: 'legend-row' }, React.createElement('span', { className: 'legend-dot outdoor' }), React.createElement('span', null, 'Outdoor')),
            React.createElement('span', { className: 'legend-row' }, React.createElement('span', { className: 'legend-dot indoor' }), React.createElement('span', null, 'Indoor')),
            React.createElement('span', { className: 'legend-row' }, React.createElement('span', { className: 'legend-dot pr' }), React.createElement('span', null, 'PR'))
          )
        )
      )
    );
  }

  window.JournalCalendarWidget = JournalCalendarWidget;
})();
