/**
 * 라이딩 기록 — 코스 없음 + 인도어(Stelvio workout_id) 시 워크아웃 그래프 표시 판별
 * workout_id 출처: Firebase users/{uid}/logs 중 activity_type === "Stelvio" 인 로그
 */
(function () {
  'use strict';

  /**
   * Firebase users/logs — activity_type "Stelvio" (대소문자 무시).
   * 레거시·Supabase: source === "stelvio" 도 동일 인도어 기록으로 취급.
   */
  function isStelvioActivityLog(log) {
    if (!log) return false;
    if (String(log.activity_type || '').trim().toLowerCase() === 'stelvio') return true;
    return String(log.source || '').trim().toLowerCase() === 'stelvio';
  }

  /**
   * buildLogsByDateFromLogs 가 Strava 우선 시 제거한 Stelvio 동반 로그를 배열에 합침.
   */
  function expandLogsWithStelvioCompanions(logs) {
    if (!logs || !logs.length) return logs || [];
    var extra = logs._companionStelvioLogs;
    if (!extra || !extra.length) return logs;
    return logs.concat(extra);
  }

  /**
   * Stelvio 인도어 로그에서만 workout_id 추출 (Strava·기타 로그의 workout_id 무시)
   */
  function resolveWorkoutIdFromLogs(log, logs) {
    var base = logs || (log && log._logsForShare) || (log ? [log] : []);
    var arr = expandLogsWithStelvioCompanions(base);
    if (log && isStelvioActivityLog(log)) {
      var w0 = log.workout_id;
      if (w0 != null && String(w0).trim() !== '') return String(w0).trim();
    }
    for (var i = 0; i < arr.length; i++) {
      var l = arr[i];
      if (!isStelvioActivityLog(l)) continue;
      var w = l && l.workout_id;
      if (w != null && String(w).trim() !== '') return String(w).trim();
    }
    return '';
  }

  function shouldShowWorkoutGraphInsteadOfMap(routeInfo, log, logs) {
    if (routeInfo && routeInfo.hasRoute) return false;
    return !!resolveWorkoutIdFromLogs(log, logs);
  }

  function parseLogDateKey(dateVal) {
    if (!dateVal) return '';
    if (dateVal.toDate && typeof dateVal.toDate === 'function') {
      var d = dateVal.toDate();
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    }
    if (typeof dateVal === 'string') return dateVal.slice(0, 10);
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      return (
        dateVal.getFullYear() +
        '-' +
        String(dateVal.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(dateVal.getDate()).padStart(2, '0')
      );
    }
    return '';
  }

  async function fetchFirestoreLogsForDate(userId, dateKey) {
    if (!userId || !dateKey) return [];
    var db = window.firestoreV9;
    var fns = window._firebaseFirestoreFns;
    if (!db || !fns || typeof fns.collection !== 'function' || typeof fns.getDocs !== 'function') {
      return [];
    }
    try {
      var ref = fns.collection(db, 'users', String(userId), 'logs');
      var q = fns.query(ref, fns.orderBy('date', 'desc'), fns.limit(300));
      var snap = await fns.getDocs(q);
      var out = [];
      snap.forEach(function (docSnap) {
        var d = docSnap.data() || {};
        var dk = parseLogDateKey(d.date);
        if (dk !== dateKey) return;
        var o = { id: docSnap.id };
        var k;
        for (k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
        }
        out.push(o);
      });
      return out;
    } catch (e) {
      console.warn('[journalWorkoutGraph] Firestore 날짜 로그 조회 실패:', e && e.message);
      return [];
    }
  }

  /**
   * Supabase Read·Strava 우선 필터 후 Stelvio workout_id 누락 시 Firestore users/logs 에서 보강.
   */
  async function enrichLogsWithStelvioWorkoutFromFirestore(userId, logs, dateKey) {
    if (!userId || !logs || !logs.length) return logs || [];
    var dk = dateKey || parseLogDateKey(logs[0] && logs[0].date);
    if (!dk) return logs;
    if (resolveWorkoutIdFromLogs(null, expandLogsWithStelvioCompanions(logs))) return logs;

    var fsLogs = await fetchFirestoreLogsForDate(userId, dk);
    var companions = [];
    for (var i = 0; i < fsLogs.length; i++) {
      var l = fsLogs[i];
      if (!isStelvioActivityLog(l)) continue;
      if (l.workout_id == null || String(l.workout_id).trim() === '') continue;
      companions.push(l);
    }
    if (!companions.length) return logs;

    var out = logs.slice();
    var prev = out._companionStelvioLogs || [];
    out._companionStelvioLogs = prev.concat(companions);
    return out;
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
      isStelvioActivityLog: isStelvioActivityLog,
      expandLogsWithStelvioCompanions: expandLogsWithStelvioCompanions,
      resolveWorkoutIdFromLogs: resolveWorkoutIdFromLogs,
      shouldShowWorkoutGraphInsteadOfMap: shouldShowWorkoutGraphInsteadOfMap,
      enrichLogsWithStelvioWorkoutFromFirestore: enrichLogsWithStelvioWorkoutFromFirestore,
      loadWorkoutSegmentsForJournal: loadWorkoutSegmentsForJournal
    };
  }
})();
