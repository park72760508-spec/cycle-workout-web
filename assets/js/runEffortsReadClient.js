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

  var RUN_HEXAGON_AXIS_SPEED = {
    '1k': 'speed_1k',
    '3k': 'speed_3k',
    '5k': 'speed_5k',
    '7k': 'speed_7k',
    '10k': 'speed_10k',
    '20k': 'speed_20k',
  };
  var RUN_HEXAGON_AXIS_WINDOW_DAYS = {
    '1k': 90,
    '3k': 90,
    '5k': 90,
    '7k': 90,
    '10k': 90,
    '20k': 180,
  };

  function localYmdFromDate(d) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function formatPeakPaceFromSpeedMps(speedMps) {
    if (speedMps == null || !isFinite(speedMps) || speedMps <= 0) return null;
    var secPerKm = null;
    if (
      window.runningRankingFormat &&
      typeof window.runningRankingFormat.speedToPaceSecPerKm === 'function'
    ) {
      secPerKm = window.runningRankingFormat.speedToPaceSecPerKm(speedMps, true);
    } else {
      secPerKm = 1000 / speedMps;
    }
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return null;
    if (
      window.runningRankingFormat &&
      typeof window.runningRankingFormat.formatPaceMmSs === 'function'
    ) {
      return window.runningRankingFormat.formatPaceMmSs(secPerKm);
    }
    if (window.runDashboardPace && typeof window.runDashboardPace.formatPaceMinPerKm === 'function') {
      return window.runDashboardPace.formatPaceMinPerKm(secPerKm);
    }
    return null;
  }

  /**
   * Supabase run_activity_efforts → 90일(20k는 180일) 구간 최고 속도 기반 peak_performances
   * 랭킹 스냅샷·슬라이딩 페널티와 무관하게 AI·역치 페이스용 보조 데이터
   * @param {object[]} efforts
   * @returns {object}
   */
  function buildPeakPerformancesFromRunEfforts(efforts) {
    var peaks = {};
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = localYmdFromDate(today);

    Object.keys(RUN_HEXAGON_AXIS_SPEED).forEach(function (axis) {
      var speedField = RUN_HEXAGON_AXIS_SPEED[axis];
      var hrField = speedField.replace('speed_', 'hr_');
      var windowDays = RUN_HEXAGON_AXIS_WINDOW_DAYS[axis] || 90;
      var cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - windowDays);
      var cutoffStr = localYmdFromDate(cutoff);
      var bestSpeed = 0;
      var bestHr = null;

      (efforts || []).forEach(function (eff) {
        var ymd = String(eff.activity_date || '').slice(0, 10);
        if (!ymd || ymd < cutoffStr || ymd > todayStr) return;
        var spd = Number(eff[speedField]);
        if (!isFinite(spd) || spd <= 0) return;
        if (spd > bestSpeed) {
          bestSpeed = spd;
          bestHr = eff[hrField] != null ? Number(eff[hrField]) : null;
        }
      });

      var paceStr = formatPeakPaceFromSpeedMps(bestSpeed);
      if (paceStr) {
        peaks[axis] = {
          pace: paceStr,
          calculated_pace: paceStr,
          hr: bestHr,
          is_penalty_applied: false,
        };
      }
    });
    return peaks;
  }

  window.getUserRunEfforts = getUserRunEfforts;
  window.getUserRunTrainingLogs = getUserRunTrainingLogs;
  window.getUserRunWeeklyTss = getUserRunWeeklyTss;
  window.buildRunCoachCleanLogs = buildRunCoachCleanLogs;
  window.buildPeakPerformancesFromRunEfforts = buildPeakPerformancesFromRunEfforts;
  window.runEffortsReadClient = {
    getUserRunEfforts: getUserRunEfforts,
    getUserRunTrainingLogs: getUserRunTrainingLogs,
    getUserRunWeeklyTss: getUserRunWeeklyTss,
    buildRunCoachCleanLogs: buildRunCoachCleanLogs,
    buildPeakPerformancesFromRunEfforts: buildPeakPerformancesFromRunEfforts,
  };
})();
