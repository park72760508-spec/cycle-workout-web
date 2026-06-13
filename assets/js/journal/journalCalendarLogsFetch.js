/**
 * 라이딩 일지 달력용 로그 조회 (React useJournalData).
 * index.html 인라인 fetchTrainingLogsForCalendarJournal 과 동일 규칙.
 */
(function () {
  'use strict';

  var MIN_DURATION_SEC = 600;

  function getDateKey(date) {
    if (!date) return null;
    if (date.toDate && typeof date.toDate === 'function') {
      var d = date.toDate();
      if (!(d instanceof Date) || isNaN(d.getTime())) return null;
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    }
    if (typeof date === 'string') return date.slice(0, 10);
    if (date instanceof Date && !isNaN(date.getTime())) {
      return (
        date.getFullYear() +
        '-' +
        String(date.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(date.getDate()).padStart(2, '0')
      );
    }
    return null;
  }

  function isStelvioCompanionLog(log) {
    if (!log) return false;
    if (String(log.activity_type || '').trim().toLowerCase() === 'stelvio') return true;
    return String(log.source || '').trim().toLowerCase() === 'stelvio';
  }

  function buildLogsByDateFromLogs(logs) {
    var logsByDate = {};
    (logs || []).forEach(function (log) {
      var sec =
        Number(
          log.duration_sec != null
            ? log.duration_sec
            : log.time != null
              ? log.time
              : log.duration
        ) || 0;
      if (sec < MIN_DURATION_SEC) return;
      var dateKey = getDateKey(log.date);
      if (!dateKey) return;
      if (!logsByDate[dateKey]) logsByDate[dateKey] = [];
      logsByDate[dateKey].push(log);
    });

    Object.keys(logsByDate).forEach(function (dateKey) {
      var arr = logsByDate[dateKey];
      var stravaLogs = arr.filter(function (l) {
        return String(l.source || '').toLowerCase() === 'strava';
      });
      if (stravaLogs.length === 0) return;
      var stravaTssSum = stravaLogs.reduce(function (s, l) {
        return s + (Number(l.tss) || 0);
      }, 0);
      if (stravaTssSum <= 0) return;
      var stelvioCompanions = arr.filter(isStelvioCompanionLog);
      var kept = stravaLogs.slice();
      if (stelvioCompanions.length > 0) {
        kept._companionStelvioLogs = stelvioCompanions;
      }
      logsByDate[dateKey] = kept;
    });
    return logsByDate;
  }

  async function fetchTrainingLogsForCalendarJournal(userId, options) {
    options = options || {};
    if (!userId) return {};
    if (options.force === true && typeof window !== 'undefined') {
      window.__journalFetchInProgress = false;
      window.__journalEmptyRetryDone = false;
    }

    if (typeof window.getUserTrainingLogs !== 'function') {
      throw new Error('getUserTrainingLogs 모듈이 로드되지 않았습니다.');
    }

    var logs = await window.getUserTrainingLogs(userId, { limit: 200 });
    if (!logs || !logs.length) return {};
    return buildLogsByDateFromLogs(logs);
  }

  if (typeof window !== 'undefined') {
    window.buildLogsByDateFromLogsJournal = buildLogsByDateFromLogs;
    window.fetchTrainingLogsForCalendarJournal = fetchTrainingLogsForCalendarJournal;
  }
})();
