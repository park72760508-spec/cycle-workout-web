/**
 * RunJournalDetailBottomSheet — RUN 상세 (요약 + 지도 + 1k~42k 구간 PR)
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var useState = R.useState;
  var pr = function () { return window.runJournalPrUtils; };

  function formatDuration(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (s <= 0) return '—';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + '시간 ' + m + '분 ' + r + '초';
    return m + '분 ' + r + '초';
  }

  function PrBadge() {
    return R.createElement('span', {
      className: 'run-journal-pr-pill',
      style: { background: pr().PR_BADGE_BG, color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px' }
    }, 'PR');
  }

  function DetailRow(label, value, isPr) {
    return R.createElement('div', { className: 'journal-detail-row' },
      R.createElement('span', { className: 'journal-detail-label' }, label),
      R.createElement('span', { className: 'journal-detail-value-wrap' },
        isPr ? R.createElement(PrBadge) : null,
        R.createElement('span', { className: 'journal-detail-value' }, value != null && value !== '' ? value : '—')
      )
    );
  }

  function paceRowsForLog(log, yearlyBest) {
    return pr().PACE_AXES.map(function (axis) {
      var sp = log['speed_' + axis];
      if (sp == null || Number(sp) <= 0) return null;
      var effort = { activity_id: log.activity_id, speed_1k: log.speed_1k, speed_3k: log.speed_3k, speed_5k: log.speed_5k, speed_7k: log.speed_7k, speed_10k: log.speed_10k, speed_20k: log.speed_20k, speed_42k: log.speed_42k };
      var isPr = pr().isAxisPrForEffort(effort, axis, yearlyBest);
      var hr = log['hr_' + axis];
      var val = pr().formatPaceWithSpeed(sp);
      if (hr != null && Number(hr) > 0) val += ' · ' + Math.round(Number(hr)) + ' bpm';
      return DetailRow(axis + ' 페이스', val, isPr);
    }).filter(Boolean);
  }

  function RunLogCard(log, yearlyBest, MapPreview) {
    var hasRoute = log.summary_polyline && String(log.summary_polyline).trim();
    var dist = log.distance_km != null ? Number(log.distance_km) : null;
    var sec = Number(log.duration_sec != null ? log.duration_sec : log.time) || 0;
    var paceLabel = dist > 0 && sec > 0 ? pr().formatPaceFromSpeed(1000 / (sec / dist)) : '—';

    return R.createElement('div', { key: String(log.activity_id || log.id), className: 'run-journal-log-card' },
      R.createElement('h4', { className: 'run-journal-log-title' }, log.title || 'Run'),
      hasRoute && MapPreview
        ? R.createElement('div', { className: 'journal-course-map-wrap journal-summary-sheet-map' },
          R.createElement(MapPreview, { log: log, mapHeight: 220 })
        )
        : null,
      R.createElement('div', { className: 'run-journal-log-metrics' },
        DetailRow('거리', dist != null ? (Math.round(dist * 100) / 100) + ' km' : '—', false),
        DetailRow('시간', formatDuration(sec), false),
        DetailRow('평균 페이스', paceLabel, false),
        DetailRow('TSS', log.tss != null ? String(Math.round(Number(log.tss) * 10) / 10) : '—', false),
        log.avg_hr != null ? DetailRow('평균 심박', Math.round(Number(log.avg_hr)) + ' bpm', false) : null,
        log.max_hr != null ? DetailRow('최대 심박', Math.round(Number(log.max_hr)) + ' bpm', false) : null,
        log.elevation_gain != null && Number(log.elevation_gain) > 0
          ? DetailRow('고도 상승', Math.round(Number(log.elevation_gain)) + ' m', false)
          : null,
        log.avg_speed_kmh != null && Number(log.avg_speed_kmh) > 0
          ? DetailRow('평균 속도', Math.round(Number(log.avg_speed_kmh) * 100) / 100 + ' km/h', false)
          : null,
        log.activity_type ? DetailRow('유형', String(log.activity_type), false) : null
      ),
      R.createElement('div', { className: 'run-journal-pace-section' },
        R.createElement('p', { className: 'run-journal-pace-heading' }, '구간 페이스 (1k ~ 42k)'),
        paceRowsForLog(log, yearlyBest)
      )
    );
  }

  function RunJournalDetailBottomSheet(props) {
    var open = props.open;
    var onClose = props.onClose;
    var logs = props.logs || [];
    var selectedDate = props.selectedDate;
    var yearlyPacePrByYear = props.yearlyPacePrByYear || {};
    var MapPreview = window.JournalCourseMapPreview;
    var year = selectedDate ? String(selectedDate).slice(0, 4) : String(new Date().getFullYear());
    var yearlyBest = yearlyPacePrByYear[year] || {};
    var showStravaFooter = logs.some(function (log) {
      return String(log && log.source != null ? log.source : 'strava').toLowerCase() === 'strava';
    });

    if (!open) return null;

    return R.createElement('div', { className: 'journal-bottom-sheet-overlay run-journal-detail-overlay', onClick: onClose },
      R.createElement('div', { className: 'journal-bottom-sheet run-journal-detail-panel', onClick: function (e) { e.stopPropagation(); } },
        R.createElement('div', { className: 'journal-bottom-sheet-header' },
          R.createElement('h3', { className: 'journal-bottom-sheet-title' }, 'RUN 상세 기록'),
          R.createElement('button', { type: 'button', className: 'journal-bottom-sheet-close', onClick: onClose, 'aria-label': '닫기' }, '×')
        ),
        R.createElement('div', { className: 'journal-bottom-sheet-body run-journal-detail-body' },
          !logs.length
            ? R.createElement('p', null, '표시할 기록이 없습니다.')
            : logs.map(function (log) {
              return RunLogCard(log, yearlyBest, MapPreview);
            })
        ),
        showStravaFooter
          ? R.createElement('div', { className: 'journal-bottom-sheet-footer run-journal-detail-footer' },
            R.createElement('img', {
              src: 'assets/img/api_strava.png',
              alt: 'Powered by Strava',
              className: 'run-journal-strava-logo'
            })
          )
          : null
      )
    );
  }

  window.RunJournalDetailBottomSheet = RunJournalDetailBottomSheet;
})();
