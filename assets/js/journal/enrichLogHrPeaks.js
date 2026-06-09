/**
 * Supabase Read 시 누락된 HR 피크(특히 max_hr_5sec)를 Firestore shadow에서 보강.
 * Phase 2 이전 마이그레이션·Dual-Write 초기 데이터 대응.
 */
(function () {
  'use strict';

  var HR_PEAK_FIELDS = [
    'max_hr_5sec',
    'max_hr_1min',
    'max_hr_5min',
    'max_hr_10min',
    'max_hr_20min',
    'max_hr_40min',
    'max_hr_60min',
  ];

  function resolveMaxHr5Sec(log) {
    if (!log) return 0;
    var v5 = Number(log.max_hr_5sec) || 0;
    if (v5 > 0) return v5;
    return Number(log.max_hr || log.max_heartrate) || 0;
  }

  function applyHr5FallbackToLog(log) {
    if (!log) return log;
    if (Number(log.max_hr_5sec) > 0) return log;
    var fb = resolveMaxHr5Sec(log);
    if (fb > 0) return Object.assign({}, log, { max_hr_5sec: fb });
    return log;
  }

  function mergeHrPeaksFromFirestore(supabaseLog, firestoreLog) {
    var out = Object.assign({}, supabaseLog);
    var i;
    for (i = 0; i < HR_PEAK_FIELDS.length; i++) {
      var f = HR_PEAK_FIELDS[i];
      if (Number(out[f]) > 0) continue;
      var fv = Number(firestoreLog[f]) || 0;
      if (fv > 0) out[f] = fv;
    }
    if (!(Number(out.max_hr) > 0)) {
      var mh = Number(firestoreLog.max_hr || firestoreLog.max_heartrate) || 0;
      if (mh > 0) out.max_hr = mh;
    }
    return applyHr5FallbackToLog(out);
  }

  async function fetchFirestoreLogDoc(userId, docId) {
    var db = window.firestoreV9;
    var fns = window._firebaseFirestoreFns;
    if (db && fns && typeof fns.doc === 'function' && typeof fns.getDoc === 'function') {
      var ref = fns.doc(db, 'users', String(userId), 'logs', String(docId));
      var snap = await fns.getDoc(ref);
      var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
      if (!exists) return null;
      return typeof snap.data === 'function' ? snap.data() : null;
    }
    if (window.firestore && typeof window.firestore.collection === 'function') {
      var snap2 = await window.firestore
        .collection('users')
        .doc(String(userId))
        .collection('logs')
        .doc(String(docId))
        .get();
      return snap2 && snap2.exists ? snap2.data() : null;
    }
    return null;
  }

  /**
   * @param {string} userId
   * @param {Array<object>} logs
   * @returns {Promise<Array<object>>}
   */
  async function enrichLogsHrPeaksFromFirestore(userId, logs) {
    if (!userId || !logs || !logs.length) return logs || [];
    var needsFirestore = false;
    var i;
    for (i = 0; i < logs.length; i++) {
      if (!(Number(logs[i].max_hr_5sec) > 0) && (logs[i].activity_id || logs[i].id)) {
        needsFirestore = true;
        break;
      }
    }
    if (!needsFirestore) {
      return logs.map(applyHr5FallbackToLog);
    }

    var out = [];
    for (i = 0; i < logs.length; i++) {
      var log = logs[i];
      if (Number(log.max_hr_5sec) > 0) {
        out.push(log);
        continue;
      }
      var docId = String(log.activity_id || log.id || '').trim();
      if (!docId) {
        out.push(applyHr5FallbackToLog(log));
        continue;
      }
      try {
        var fs = await fetchFirestoreLogDoc(userId, docId);
        if (fs) out.push(mergeHrPeaksFromFirestore(log, fs));
        else out.push(applyHr5FallbackToLog(log));
      } catch (_e) {
        out.push(applyHr5FallbackToLog(log));
      }
    }
    return out;
  }

  window.resolveMaxHr5Sec = resolveMaxHr5Sec;
  window.enrichLogsHrPeaksFromFirestore = enrichLogsHrPeaksFromFirestore;
})();
