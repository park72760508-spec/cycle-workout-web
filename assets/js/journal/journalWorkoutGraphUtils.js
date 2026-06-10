/**
 * 라이딩 기록 — 코스 없음 + 인도어(workout_id) 시 워크아웃 그래프 표시 판별
 */
(function () {
  'use strict';

  function resolveWorkoutIdFromLogs(log, logs) {
    var arr = logs || (log && log._logsForShare) || (log ? [log] : []);
    if (log && log.workout_id != null && String(log.workout_id).trim() !== '') {
      return String(log.workout_id).trim();
    }
    for (var i = 0; i < arr.length; i++) {
      var w = arr[i] && arr[i].workout_id;
      if (w != null && String(w).trim() !== '') return String(w).trim();
    }
    return '';
  }

  function shouldShowWorkoutGraphInsteadOfMap(routeInfo, log, logs) {
    if (routeInfo && routeInfo.hasRoute) return false;
    return !!resolveWorkoutIdFromLogs(log, logs);
  }

  async function loadWorkoutSegmentsForJournal(workoutId) {
    if (!workoutId) return { segments: [], title: '' };
    var wid = String(workoutId).trim();

    if (typeof window.getWorkoutCache === 'function') {
      try {
        var cache = window.getWorkoutCache();
        if (cache && cache.workouts && Array.isArray(cache.workouts)) {
          var cached = cache.workouts.find(function (w) {
            return String(w.id) === wid || String(w.workout_id) === wid;
          });
          if (cached && cached.segments && cached.segments.length) {
            return {
              segments: cached.segments,
              title: String(cached.title || cached.name || '').trim()
            };
          }
        }
      } catch (e) { /* cache miss */ }
    }

    if (typeof window.apiGetWorkout === 'function') {
      try {
        var res = await window.apiGetWorkout(wid);
        if (res && res.success) {
          var item = res.item || res.workout || res;
          var segs = item && item.segments;
          return {
            segments: Array.isArray(segs) ? segs : [],
            title: String((item && (item.title || item.name)) || '').trim()
          };
        }
      } catch (e) {
        console.warn('[journalWorkoutGraph] apiGetWorkout 실패:', wid, e && e.message);
      }
    }

    return { segments: [], title: '' };
  }

  if (typeof window !== 'undefined') {
    window.journalWorkoutGraphUtils = {
      resolveWorkoutIdFromLogs: resolveWorkoutIdFromLogs,
      shouldShowWorkoutGraphInsteadOfMap: shouldShowWorkoutGraphInsteadOfMap,
      loadWorkoutSegmentsForJournal: loadWorkoutSegmentsForJournal
    };
  }
})();
