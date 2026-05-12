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

  function avgSpeedKmhFromDistanceTime(distanceKm, durationSec) {
    var d = Number(distanceKm) || 0;
    var t = Number(durationSec) || 0;
    if (d <= 0 || t <= 0) return null;
    return Math.round((d / (t / 3600)) * 100) / 100;
  }

  function mergeLogsForSummary(logs, userProfile) {
    if (!logs || logs.length === 0) return null;
    if (logs.length === 1) {
      var log = logs[0];
      var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
      var dist = log.distance_km != null ? Number(log.distance_km) : 0;
      var speedStored = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
      var speed = speedStored != null && speedStored > 0 ? speedStored : avgSpeedKmhFromDistanceTime(dist, sec);
      var elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
      var cad = log.avg_cadence != null ? Number(log.avg_cadence) : null;
      return {
        distance: dist,
        durationSec: sec,
        tss: getEffectiveTss(log, userProfile),
        if: log.if != null ? Number(log.if) : null,
        kj: log.kilojoules != null ? Number(log.kilojoules) : 0,
        avgWatts: log.avg_watts != null ? Number(log.avg_watts) : null,
        np: log.weighted_watts != null ? Number(log.weighted_watts) : (log.avg_watts != null ? Number(log.avg_watts) : null),
        avgHr: log.avg_hr != null ? Number(log.avg_hr) : null,
        maxHr: log.max_hr != null ? Number(log.max_hr) : null,
        avgSpeedKmh: speed,
        avgCadence: cad != null && cad > 0 ? cad : null,
        elevationGain: elev != null && elev > 0 ? elev : null
      };
    }
    var totalSec = 0, totalTSS = 0, totalDist = 0, totalKj = 0;
    var sumNpSec = 0, sumApSec = 0, sumHrSec = 0;
    var sumCadSec = 0, cadDur = 0;
    var sumElev = 0;
    var maxHr = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      var s = Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
      totalSec += s;
      totalTSS += getEffectiveTss(l, userProfile);
      totalDist += Number(l.distance_km || 0);
      totalKj += Number(l.kilojoules || 0);
      sumElev += Number(l.elevation_gain || 0);
      var np = l.weighted_watts != null ? Number(l.weighted_watts) : (l.avg_watts != null ? Number(l.avg_watts) : 0);
      var ap = l.avg_watts != null ? Number(l.avg_watts) : 0;
      var hr = l.avg_hr != null ? Number(l.avg_hr) : 0;
      sumNpSec += np * s;
      sumApSec += ap * s;
      sumHrSec += hr * s;
      var c = l.avg_cadence != null ? Number(l.avg_cadence) : 0;
      if (c > 0 && s > 0) {
        sumCadSec += c * s;
        cadDur += s;
      }
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
      maxHr: maxHr || null,
      avgSpeedKmh: avgSpeedKmhFromDistanceTime(totalDist, totalSec),
      avgCadence: cadDur > 0 ? sumCadSec / cadDur : null,
      elevationGain: sumElev > 0 ? sumElev : null
    };
  }

  /**
   * 저장된 TSS가 유효 범위(0 < tss <= 500)면 그대로 사용.
   * 구버전 계산 버그로 인해 500 초과 값이 저장된 경우 calculateStelvioRevisedTSS로 재계산.
   * 재계산 불가 시 _saniTss(< 1200)로 폴백.
   */
  function getEffectiveTss(log, userProfile) {
    var rawTss = log.tss != null ? Number(log.tss) : 0;
    if (rawTss > 0 && rawTss <= 500) return rawTss;

    // 500 초과: 구버전 버그값 → calculateStelvioRevisedTSS로 재계산 시도
    if (typeof window.calculateStelvioRevisedTSS === 'function') {
      var prof = userProfile;
      if (!prof) {
        var cu = window.currentUser || (function() {
          try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e) { return null; }
        })();
        if (cu) prof = { ftp: Number(cu.ftp || 0), weight: Number(cu.weight || cu.weightKg || 0) };
      }
      var ftp    = prof ? Number(prof.ftp    || 0) : 0;
      var weight = prof ? Number(prof.weight || 0) : 0;
      var sec    = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
      var ap     = Number(log.avg_watts    || 0);
      var np     = Number(log.weighted_watts || log.avg_watts || 0);
      if (ftp > 0 && weight > 0 && sec > 0 && ap > 0) {
        return window.calculateStelvioRevisedTSS(sec, ap, np, ftp, weight);
      }
    }

    // 재계산 불가: 월간 로직(_saniTss)과 동일하게 0 < tss < 1200 범위만 허용
    return (rawTss > 0 && rawTss < 1200) ? rawTss : 0;
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
    var userProfile = props.userProfile || null;

    if (!selectedDate || logs.length === 0) {
      return null;
    }

    var summary = mergeLogsForSummary(logs, userProfile);

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
          React.createElement('span', { className: 'journal-summary-label' }, '평균 속도'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgSpeedKmh != null && summary.avgSpeedKmh > 0 ? summary.avgSpeedKmh.toFixed(1) + ' km/h' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '평균 케이던스'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgCadence != null && summary.avgCadence > 0 ? Math.round(summary.avgCadence) + ' rpm' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item journal-summary-item-full' },
          React.createElement('span', { className: 'journal-summary-label' }, '상승고도'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.elevationGain != null && summary.elevationGain > 0 ? Math.round(summary.elevationGain) + ' m' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '평균 파워'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgWatts != null && summary.avgWatts > 0 ? Math.round(summary.avgWatts) + ' W' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, '평균 심박'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.avgHr != null && summary.avgHr > 0 ? Math.round(summary.avgHr) + ' bpm' : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, 'TSS'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.tss != null && summary.tss > 0 ? Math.round(summary.tss) : '-')
        ),
        React.createElement('div', { className: 'journal-summary-item' },
          React.createElement('span', { className: 'journal-summary-label' }, 'IF'),
          React.createElement('span', { className: 'journal-summary-value' }, summary.if != null && summary.if > 0 ? summary.if.toFixed(2) : '-')
        )
      ),
      React.createElement('div', { className: 'journal-daily-summary-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'stelvio-ranking-board-entry-btn stelvio-purple-btn',
          onClick: onShowDetail,
          'aria-label': '상세 기록 보기'
        }, '상세 기록 보기')
      )
    );
  }

  window.JournalDailySummary = JournalDailySummary;
})();
