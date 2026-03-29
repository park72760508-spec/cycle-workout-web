/**
 * JournalMonthlyDashboard - 월간 Bento 요약 + 아코디언(상세 차트)
 * Bento 6카드 상시 노출, 아코디언 펼침 시 renderMonthlyAnalysisDashboard 호출
 */
/* global React, useState, useEffect */

(function() {
  'use strict';

  if (!window.React) return;

  var ReactObj = window.React;
  var useState = ReactObj.useState;
  var useEffect = ReactObj.useEffect;

  function parseDurationToMinutes(d) {
    if (d == null) return 0;
    if (typeof d === 'number') return d >= 0 && d < 400 ? d / 60 : d;
    var s = String(d).trim();
    var h = 0, min = 0, sec = 0;
    var mH = s.match(/(\d+)\s*시간/);
    var mM = s.match(/(\d+)\s*분/);
    var mS = s.match(/(\d+)\s*초/);
    if (mH) h = parseInt(mH[1], 10);
    if (mM) min = parseInt(mM[1], 10);
    if (mS) sec = parseInt(mS[1], 10);
    return h * 60 + min + sec / 60;
  }

  function formatDurationHHMM(minutes) {
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    if (h === 0) return m + 'm';
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
  }

  function JournalMonthlyDashboard(props) {
    var trainingLogs = props.trainingLogs || {};
    var currentYear = props.currentYear;
    var currentMonth = props.currentMonth;

    var _useState = useState(false);
    var accordionOpen = _useState[0];
    var setAccordionOpen = _useState[1];

    var buildFn = window.buildMonthlyLogsForDashboard;
    var monthlyLogs = buildFn
      ? buildFn(currentYear, currentMonth + 1, trainingLogs)
      : [];

    var stats = (function() {
      var totalTSS = 0, totalDist = 0, totalMin = 0, sumEF = 0, efN = 0, sumVI = 0, viN = 0;
      for (var i = 0; i < monthlyLogs.length; i++) {
        var log = monthlyLogs[i];
        var dur = parseDurationToMinutes(log.duration);
        totalTSS += Number(log.TSS || log.tss || 0);
        totalDist += Number(log.distance || log.distance_km || 0);
        totalMin += dur;
        var np = Number(log.NP || log.normPower || log.weighted_watts || 0);
        var ap = Number(log.avgPower || log.avg_watts || 0);
        var hr = Number(log.avgHeartRate || log.avg_hr || 0);
        if (ap > 0 && np > 0) { sumVI += np / ap; viN++; }
        if (hr > 0 && np > 0) { sumEF += np / hr; efN++; }
      }
      return {
        totalTSS: Math.round(totalTSS),
        totalDistance: totalDist.toFixed(1),
        totalDurationFormatted: formatDurationHHMM(totalMin),
        avgEF: efN > 0 ? (sumEF / efN).toFixed(2) : '–',
        avgVI: viN > 0 ? (sumVI / viN).toFixed(2) : '–'
      };
    })();

    var vo2Val = (function() {
      var profile = props.userProfile || (function() {
        var u = window.currentUser || (function() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
        return u ? { ftp: u.ftp, weight: u.weight, max_hr: u.max_hr } : {};
      })();
      var toVo2 = function(log) {
        var dm = parseDurationToMinutes(log.duration);
        return {
          date: log.date,
          duration_sec: Math.round(dm * 60),
          duration_min: dm,
          weighted_watts: Number(log.NP || log.normPower || 0),
          avg_watts: Number(log.avgPower || 0),
          avg_hr: Number(log.avgHeartRate || log.avg_hr || 0)
        };
      };
      var arr = monthlyLogs.map(toVo2);
      var prevYear = currentMonth > 0 ? currentYear : currentYear - 1;
      var prevMonth1 = currentMonth > 0 ? currentMonth : 12;
      var prevLogs = buildFn ? buildFn(prevYear, prevMonth1, trainingLogs) : [];
      var prevArr = prevLogs.map(toVo2);
      var calc = window.calculateStelvioVO2Max;
      var cur = calc ? calc(profile, arr) : null;
      if (cur == null) return null;
      if (typeof cur === 'number' && !isNaN(cur)) return cur;
      return (cur.current != null ? cur.current : cur.vo2) || null;
    })();

    useEffect(function() {
      if (!accordionOpen) return;
      var renderFn = window.renderMonthlyAnalysisDashboard;
      if (!renderFn) return;
      var pad = function(n) { return String(n).padStart(2, '0'); };
      var now = new Date();
      var endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 35);
      var startStr = startDate.getFullYear() + '-' + pad(startDate.getMonth() + 1) + '-' + pad(startDate.getDate());
      var endStr = endDate.getFullYear() + '-' + pad(endDate.getMonth() + 1) + '-' + pad(endDate.getDate());
      var allLogs = [];
      Object.keys(trainingLogs).forEach(function(dk) {
        if (dk < startStr || dk > endStr) return;
        var arr = trainingLogs[dk];
        if (!Array.isArray(arr)) return;
        arr.forEach(function(l) {
          var s = Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
          var m = Math.floor(s / 60);
          var ss = s % 60;
          allLogs.push({
            date: dk,
            distance: l.distance_km != null ? Number(l.distance_km) : 0,
            duration: m + '분 ' + ss + '초',
            IF: l.if,
            TSS: l.tss,
            kJ: l.kilojoules,
            avgCadence: l.avg_cadence,
            avgHeartRate: l.avg_hr,
            avgPower: l.avg_watts,
            NP: l.weighted_watts || l.avg_watts,
            normPower: l.weighted_watts || l.avg_watts
          });
        });
      });
      allLogs.sort(function(a, b) { return a.date.localeCompare(b.date); });
      var currentMonthDate = new Date(currentYear, currentMonth, 1);
      var prevMonthDate = currentMonth > 0 ? new Date(currentYear, currentMonth - 1, 1) : new Date(currentYear - 1, 11, 1);
      var prevY = prevMonthDate.getFullYear();
      var prevM = prevMonthDate.getMonth() + 1;
      var prevMonthLogs = buildFn ? buildFn(prevY, prevM, trainingLogs) : [];
      var userProfile = (function() {
        var u = window.currentUser || (function() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
        return u ? { id: u.id, uid: u.uid || u.id, ftp: u.ftp, weight: u.weight, max_hr: u.max_hr, age: u.age } : {};
      })();
      var rawTiz = [];
      Object.keys(trainingLogs).forEach(function(dk) {
        var arr = trainingLogs[dk];
        if (!Array.isArray(arr)) return;
        var y = currentYear;
        var m = currentMonth + 1;
        var pad2 = function(n) { return String(n).padStart(2, '0'); };
        var now2 = new Date();
        var isCur = y === now2.getFullYear() && m === now2.getMonth() + 1;
        var startS, endS;
        if (isCur) {
          var ed = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
          var sd = new Date(y, m - 1, 1);
          startS = sd.getFullYear() + '-' + pad2(sd.getMonth() + 1) + '-' + pad2(sd.getDate());
          endS = ed.getFullYear() + '-' + pad2(ed.getMonth() + 1) + '-' + pad2(ed.getDate());
        } else {
          startS = y + '-' + pad2(m) + '-01';
          endS = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
        }
        if (dk < startS || dk > endS) return;
        arr.forEach(function(l) { rawTiz.push(Object.assign({}, l, { date: l.date || dk })); });
      });
      renderFn(currentMonthDate, monthlyLogs, allLogs, prevMonthLogs, userProfile, rawTiz);
      var root = document.getElementById('monthly-analysis-dashboard-root');
      if (root) root.style.display = 'block';
    }, [accordionOpen, currentYear, currentMonth, trainingLogs]);

    useEffect(function() {
      var root = document.getElementById('monthly-analysis-dashboard-root');
      if (root) root.style.display = accordionOpen ? 'block' : 'none';
    }, [accordionOpen]);

    var monthLabel = currentYear + '년 ' + (currentMonth + 1) + '월';
    var now = new Date();
    var isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth();

    var dashboardClass = 'journal-monthly-dashboard' + (accordionOpen ? ' journal-accordion-expanded' : '');
    return React.createElement('div', { className: dashboardClass },
      React.createElement('div', { className: 'journal-bento-grid' },
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, '총 TSS'),
          React.createElement('span', { className: 'journal-bento-value' }, stats.totalTSS)
        ),
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, '총 거리'),
          React.createElement('span', { className: 'journal-bento-value' }, stats.totalDistance + ' km')
        ),
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, '총 시간'),
          React.createElement('span', { className: 'journal-bento-value' }, stats.totalDurationFormatted)
        ),
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, '평균 EF'),
          React.createElement('span', { className: 'journal-bento-value' }, stats.avgEF)
        ),
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, '평균 VI'),
          React.createElement('span', { className: 'journal-bento-value' }, stats.avgVI)
        ),
        React.createElement('div', { className: 'journal-bento-card' },
          React.createElement('span', { className: 'journal-bento-label' }, 'VO₂max'),
          React.createElement('span', { className: 'journal-bento-value' }, vo2Val != null ? vo2Val + ' ml/kg/min' : '–')
        )
      ),
      isCurrentMonth ? React.createElement('p', { className: 'journal-bento-period-hint', style: { marginTop: 6, marginBottom: 0, fontSize: 12, color: '#9ca3af' } }, '* 오늘 기준 1개월간') : null,
      React.createElement('div', { className: 'journal-accordion' },
        React.createElement('button', {
          type: 'button',
          className: 'journal-accordion-trigger',
          onClick: function() { setAccordionOpen(!accordionOpen); }
        },
          React.createElement('img', {
            src: 'assets/img/data-analytics.png',
            alt: '',
            className: 'journal-accordion-trigger-icon',
            width: 20,
            height: 20,
            decoding: 'async'
          }),
          monthLabel + ' 상세 분석 차트 ' + (accordionOpen ? '접기' : '펼치기')
        ),
        accordionOpen && React.createElement('p', { className: 'journal-accordion-hint' }, '아래로 스크롤하여 상세 차트를 확인하세요.')
      )
    );
  }

  window.JournalMonthlyDashboard = JournalMonthlyDashboard;
})();
