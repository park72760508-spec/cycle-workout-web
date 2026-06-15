/**
 * RUN 구간 피크 Read — getRunEffortsForRead relay (Service Role).
 */
(function () {
  'use strict';

  var RUN_EFFORTS_READ_RELAY_DEFAULT =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRunEffortsForRead';
  var RUN_WEEKLY_TSS_READ_RELAY_DEFAULT =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRunWeeklyTssForRead';

  function getReadRelayUrl() {
    var c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
    return String(c.runEffortsReadUrl || RUN_EFFORTS_READ_RELAY_DEFAULT).trim();
  }

  function getWeeklyTssReadRelayUrl() {
    var c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
    return String(c.runWeeklyTssReadUrl || RUN_WEEKLY_TSS_READ_RELAY_DEFAULT).trim();
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
  window.getUserRunWeeklyTss = getUserRunWeeklyTss;
})();
