/**
 * RUN Supabase Read — activities(훈련로그·TSS), run_activity_efforts(구간 피크)
 */
(function () {
  'use strict';

  var RUN_EFFORTS_READ_RELAY_DEFAULT =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRunEffortsForRead';
  var RUN_WEEKLY_TSS_READ_RELAY_DEFAULT =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRunWeeklyTssForRead';
  var RUN_ACTIVITIES_READ_RELAY_DEFAULT =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRunActivitiesForRead';

  function getReadRelayUrl() {
    var c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
    return String(c.runEffortsReadUrl || RUN_EFFORTS_READ_RELAY_DEFAULT).trim();
  }

  function getWeeklyTssReadRelayUrl() {
    var c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
    return String(c.runWeeklyTssReadUrl || RUN_WEEKLY_TSS_READ_RELAY_DEFAULT).trim();
  }

  function getActivitiesReadRelayUrl() {
    var c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
    return String(c.runActivitiesReadUrl || RUN_ACTIVITIES_READ_RELAY_DEFAULT).trim();
  }

  async function getFirebaseIdTokenForReadRelay() {
    var user = null;
    if (window.authV9 && window.authV9.currentUser) user = window.authV9.currentUser;
    else if (window.auth && window.auth.currentUser) user = window.auth.currentUser;
    else if (window.firebase && typeof window.firebase.auth === 'function') {
      user = window.firebase.auth().currentUser;
    }
    if (!user || typeof user.getIdToken !== 'function') {
      throw new Error('Firebase 로그인 세션이 없습니다.');
    }
    return user.getIdToken(true);
  }

  function sanitizeRtss(val) {
    var n = Number(val) || 0;
    return n > 0 && n < 1200 ? n : 0;
  }

  /**
   * AI 코치·컨디션 분석용 RUN 로그 정규화 (activities → coach payload)
   * @param {object[]} logs
   * @returns {object[]}
   */
  function buildRunCoachCleanLogs(logs) {
    var out = [];
    (logs || []).forEach(function (log) {
      if (typeof window.isRunTrainingLog === 'function' && !window.isRunTrainingLog(log)) return;
      var ds = log.date ? String(log.date).slice(0, 10) : '';
      if (!ds && log.completed_at) ds = String(log.completed_at).slice(0, 10);
      if (!ds) return;
      var sec = Number(log.duration_sec != null ? log.duration_sec : log.time) || 0;
      if (sec < 60) return;
      var dist = Number(log.distance_km);
      var speed = Number(log.avg_speed_kmh);
      var paceSec = dist > 0 && sec > 0 ? Math.round(sec / dist) : null;
      out.push({
        completed_at: ds + 'T12:00:00.000Z',
        date: ds,
        duration_min: Math.round(sec / 60),
        duration_sec: sec,
        distance_km: dist > 0 ? Math.round(dist * 1000) / 1000 : null,
        avg_speed_kmh: speed > 0 ? Math.round(speed * 100) / 100 : null,
        pace_sec_per_km: paceSec,
        tss: Math.round(sanitizeRtss(log.tss)),
        avg_hr: log.avg_hr != null ? Math.round(Number(log.avg_hr)) : 0,
        max_hr: log.max_hr != null ? Math.round(Number(log.max_hr)) : null,
        activity_type: log.activity_type || 'Run',
        source: String(log.source || 'strava').toLowerCase(),
        title: log.title || '',
        sport_category: 'run',
      });
    });
    out.sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    return out;
  }

  /**
   * @param {string} userId Firebase UID
   * @param {{ limit?: number }} [options]
   * @returns {Promise<object[]>}
   */
  async function getUserRunEfforts(userId, options) {
    options = options || {};
    if (!userId) throw new Error('userId는 필수입니다.');
    var url = new URL(getReadRelayUrl());
    url.searchParams.set('uid', String(userId).trim());
    url.searchParams.set('limit', String(Math.min(1000, Math.max(1, Number(options.limit) || 400))));
    var token = await getFirebaseIdTokenForReadRelay();
    var res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.success) {
      var msg =
        (json.error && (json.error.message || json.error)) ||
        'Run efforts relay HTTP ' + res.status;
      throw new Error(msg);
    }
    return Array.isArray(json.efforts) ? json.efforts : [];
  }

  /**
   * RUN 훈련 로그 — Supabase activities (최근 6개월)
   * @param {string} userId Firebase UID
   * @param {{ limit?: number }} [options]
   * @returns {Promise<object[]>}
   */
  async function getUserRunTrainingLogs(userId, options) {
    options = options || {};
    if (!userId) throw new Error('userId는 필수입니다.');
    var url = new URL(getActivitiesReadRelayUrl());
    url.searchParams.set('uid', String(userId).trim());
    url.searchParams.set('limit', String(Math.min(1000, Math.max(1, Number(options.limit) || 400))));
    var token = await getFirebaseIdTokenForReadRelay();
    var res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.success) {
      var msg =
        (json.error && (json.error.message || json.error)) ||
        'Run activities relay HTTP ' + res.status;
      throw new Error(msg);
    }
    return Array.isArray(json.logs) ? json.logs : [];
  }

  /**
   * 주간 RUN TSS — Supabase activities.tss (오늘 포함 최근 7일)
   * @param {string} userId Firebase UID
   * @returns {Promise<number>}
   */
  async function getUserRunWeeklyTss(userId) {
    if (!userId) throw new Error('userId는 필수입니다.');
    var url = new URL(getWeeklyTssReadRelayUrl());
    url.searchParams.set('uid', String(userId).trim());
    var token = await getFirebaseIdTokenForReadRelay();
    var res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.success) {
      var msg =
        (json.error && (json.error.message || json.error)) ||
        'Run weekly TSS relay HTTP ' + res.status;
      throw new Error(msg);
    }
    return Math.round((Number(json.weeklyTss) || 0) * 10) / 10;
  }

  window.getUserRunEfforts = getUserRunEfforts;
  window.getUserRunTrainingLogs = getUserRunTrainingLogs;
  window.getUserRunWeeklyTss = getUserRunWeeklyTss;
  window.buildRunCoachCleanLogs = buildRunCoachCleanLogs;
})();
