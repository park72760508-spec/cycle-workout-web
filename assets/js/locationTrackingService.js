/**
 * STELVIO GPS 위치 추적 — 배치 저장 + Supabase/Firestore 스위치 + Fallback.
 *
 * - GPS 업데이트마다 DB write 하지 않고 메모리 버퍼에 적재
 * - batchIntervalMs(기본 45초)마다 한 번에 전송
 * - USE_SUPABASE_FOR_TRACKING=true → Supabase, 실패 시 Firebase Fallback
 *
 * @see assets/js/firebaseConfig.js (STELVIO_TRACKING_CONFIG)
 */
(function (global) {
  'use strict';

  var LOG_PREFIX = '[locationTracking]';
  var supabaseClientPromise = null;

  function getTrackingConfig() {
    var cfg =
      (typeof global !== 'undefined' && global.STELVIO_TRACKING_CONFIG) || {};
    var useSupabase = false;
    if (typeof global.stelvioParseTrackingBool === 'function') {
      useSupabase = global.stelvioParseTrackingBool(
        cfg.useSupabaseForTracking,
        false
      );
    } else {
      useSupabase = !!cfg.useSupabaseForTracking;
    }
    return {
      useSupabaseForTracking: useSupabase,
      batchIntervalMs: Math.max(
        15000,
        Number(cfg.batchIntervalMs) || 45000
      ),
      maxBufferSize: Math.max(10, Number(cfg.maxBufferSize) || 120),
      geolocationOptions:
        cfg.geolocationOptions && typeof cfg.geolocationOptions === 'object'
          ? cfg.geolocationOptions
          : { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      supabaseRequestTimeoutMs: Math.max(
        5000,
        Number(cfg.supabaseRequestTimeoutMs) || 20000
      ),
    };
  }

  function getSupabaseConfig() {
    var c =
      (typeof global !== 'undefined' && global.STELVIO_SUPABASE_CONFIG) || {};
    return {
      supabaseUrl: String(c.supabaseUrl || '').trim(),
      supabaseAnonKey: String(c.supabaseAnonKey || '').trim(),
      authBridgeUrl: String(c.authBridgeUrl || '').trim(),
      uidNamespace: String(
        c.uidNamespace || '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
      ).trim(),
    };
  }

  function getFirebaseUid() {
    if (global.authV9 && global.authV9.currentUser) {
      return global.authV9.currentUser.uid;
    }
    if (global.auth && global.auth.currentUser) {
      return global.auth.currentUser.uid;
    }
    if (global.firebase && global.firebase.auth) {
      var u = global.firebase.auth().currentUser;
      if (u) return u.uid;
    }
    return null;
  }

  function newBatchId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return (
      'batch_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function normalizePoint(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var lat =
      raw.latitude != null
        ? Number(raw.latitude)
        : raw.lat != null
          ? Number(raw.lat)
          : NaN;
    var lng =
      raw.longitude != null
        ? Number(raw.longitude)
        : raw.lng != null
          ? Number(raw.lng)
          : raw.lon != null
            ? Number(raw.lon)
            : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    var recordedAt =
      raw.recordedAt ||
      raw.timestamp ||
      (raw.recorded_at ? raw.recorded_at : null);
    var recordedMs = recordedAt ? Date.parse(recordedAt) : Date.now();
    if (!Number.isFinite(recordedMs)) recordedMs = Date.now();

    return {
      latitude: lat,
      longitude: lng,
      altitude_m:
        raw.altitude != null
          ? Number(raw.altitude)
          : raw.altitude_m != null
            ? Number(raw.altitude_m)
            : null,
      accuracy_m:
        raw.accuracy != null
          ? Number(raw.accuracy)
          : raw.accuracy_m != null
            ? Number(raw.accuracy_m)
            : null,
      speed_mps:
        raw.speed_mps != null
          ? Number(raw.speed_mps)
          : raw.speed != null
            ? Number(raw.speed)
            : null,
      heading_deg:
        raw.heading != null
          ? Number(raw.heading)
          : raw.heading_deg != null
            ? Number(raw.heading_deg)
            : null,
      recorded_at: new Date(recordedMs).toISOString(),
      source: String(raw.source || 'gps'),
    };
  }

  /** @type {{ active: boolean, sessionId: string|null, userId: string|null, buffer: object[], flushTimer: number|null, watchId: number|null, flushing: boolean }} */
  var state = {
    active: false,
    sessionId: null,
    userId: null,
    buffer: [],
    flushTimer: null,
    watchId: null,
    flushing: false,
  };

  async function getSupabaseClient() {
    var cfg = getSupabaseConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('STELVIO_SUPABASE_CONFIG 미설정');
    }
    if (!supabaseClientPromise) {
      supabaseClientPromise = (async function () {
        var mod = await import(
          'https://esm.sh/@supabase/supabase-js@2.49.1'
        );
        return mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            storage:
              typeof global !== 'undefined' ? global.localStorage : undefined,
          },
        });
      })();
    }
    return supabaseClientPromise;
  }

  async function getFirebaseIdToken() {
    var user = null;
    if (global.authV9 && global.authV9.currentUser) {
      user = global.authV9.currentUser;
    } else if (global.auth && global.auth.currentUser) {
      user = global.auth.currentUser;
    }
    if (!user || typeof user.getIdToken !== 'function') {
      throw new Error('Firebase 로그인 세션이 없습니다.');
    }
    return user.getIdToken(true);
  }

  async function ensureSupabaseSession() {
    var sbCfg = getSupabaseConfig();
    if (!sbCfg.authBridgeUrl) {
      throw new Error('authBridgeUrl 미설정');
    }
    var supabase = await getSupabaseClient();
    var existing = await supabase.auth.getSession();
    if (
      existing.data.session &&
      existing.data.session.expires_at &&
      existing.data.session.expires_at > Math.floor(Date.now() / 1000) + 120
    ) {
      return supabase;
    }

    var bridgeUrl = sbCfg.authBridgeUrl.replace(/\/+$/, '');
    var idToken = await getFirebaseIdToken();
    var res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({}),
    });
    var body = {};
    try {
      body = await res.json();
    } catch (_) {
      body = {};
    }
    if (!res.ok || !body.success || !body.session || !body.session.access_token) {
      throw new Error(
        (body.error && body.error.message) ||
          'Auth bridge HTTP ' + res.status
      );
    }
    var setResult = await supabase.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    });
    if (setResult.error || !setResult.data.session) {
      throw new Error('Supabase setSession 실패');
    }
    return supabase;
  }

  function mapPointsToSupabaseRows(userId, sessionId, batchId, points) {
    return points.map(function (pt, idx) {
      return {
        user_id: userId,
        session_id: sessionId,
        batch_id: batchId,
        seq_in_batch: idx,
        latitude: pt.latitude,
        longitude: pt.longitude,
        altitude_m: Number.isFinite(pt.altitude_m) ? pt.altitude_m : null,
        accuracy_m: Number.isFinite(pt.accuracy_m) ? pt.accuracy_m : null,
        speed_mps: Number.isFinite(pt.speed_mps) ? pt.speed_mps : null,
        heading_deg: Number.isFinite(pt.heading_deg) ? pt.heading_deg : null,
        recorded_at: pt.recorded_at,
        source: pt.source || 'gps',
      };
    });
  }

  async function writeBatchToSupabase(userId, sessionId, batchId, points) {
    var trackCfg = getTrackingConfig();
    var supabase = await ensureSupabaseSession();
    var sess = await supabase.auth.getSession();
    if (!sess.data.session || !sess.data.session.user) {
      throw new Error('Supabase auth session 없음');
    }
    var sbUserId = sess.data.session.user.id;
    var rows = mapPointsToSupabaseRows(sbUserId, sessionId, batchId, points);

    var controller =
      typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
    var timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(function () {
        controller.abort();
      }, trackCfg.supabaseRequestTimeoutMs);
    }

    try {
      var query = supabase.from('ride_location_points').insert(rows);
      if (controller) {
        query = query.abortSignal(controller.signal);
      }
      var result = await query;
      if (result.error) throw result.error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    console.log(
      LOG_PREFIX,
      'Supabase batch 저장 완료:',
      batchId,
      '(' + points.length + ' pts)'
    );
  }

  async function writeBatchToFirebase(userId, sessionId, batchId, points) {
    if (!global.firestore) {
      throw new Error('Firestore가 초기화되지 않았습니다.');
    }
    var docRef = global.firestore
      .collection('users')
      .doc(userId)
      .collection('location_batches')
      .doc(batchId);

    await docRef.set({
      session_id: sessionId,
      batch_id: batchId,
      point_count: points.length,
      points: points.map(function (pt) {
        return {
          lat: pt.latitude,
          lng: pt.longitude,
          altitude_m: pt.altitude_m,
          accuracy_m: pt.accuracy_m,
          speed_mps: pt.speed_mps,
          heading_deg: pt.heading_deg,
          recorded_at: pt.recorded_at,
          source: pt.source || 'gps',
        };
      }),
      storage_backend: 'firebase',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      LOG_PREFIX,
      'Firebase batch 저장 완료:',
      batchId,
      '(' + points.length + ' pts)'
    );
  }

  async function persistBatch(points) {
    if (!points || !points.length) return { ok: true, skipped: true };

    var userId = state.userId || getFirebaseUid();
    var sessionId =
      state.sessionId ||
      (typeof global !== 'undefined' && global.SESSION_ID) ||
      'unknown_session';
    if (!userId) {
      console.warn(LOG_PREFIX, 'persistBatch 스킵 — 로그인 사용자 없음');
      return { ok: false, reason: 'no_user' };
    }

    var batchId = newBatchId();
    var trackCfg = getTrackingConfig();

    if (trackCfg.useSupabaseForTracking) {
      try {
        await writeBatchToSupabase(userId, sessionId, batchId, points);
        return { ok: true, backend: 'supabase', batchId: batchId };
      } catch (supaErr) {
        console.error(
          LOG_PREFIX,
          'Supabase batch 저장 실패 → Firebase Fallback:',
          supaErr && (supaErr.message || supaErr)
        );
        if (supaErr && supaErr.stack) {
          console.error(LOG_PREFIX, 'Supabase error stack:', supaErr.stack);
        }
        try {
          await writeBatchToFirebase(userId, sessionId, batchId, points);
          return {
            ok: true,
            backend: 'firebase_fallback',
            batchId: batchId,
            supabaseError: supaErr && supaErr.message,
          };
        } catch (fbErr) {
          console.error(
            LOG_PREFIX,
            'Firebase Fallback도 실패:',
            fbErr && (fbErr.message || fbErr)
          );
          return { ok: false, backend: 'failed', error: fbErr };
        }
      }
    }

    try {
      await writeBatchToFirebase(userId, sessionId, batchId, points);
      return { ok: true, backend: 'firebase', batchId: batchId };
    } catch (fbErr) {
      console.error(
        LOG_PREFIX,
        'Firebase batch 저장 실패:',
        fbErr && (fbErr.message || fbErr)
      );
      return { ok: false, backend: 'firebase', error: fbErr };
    }
  }

  async function flushBuffer(reason) {
    if (state.flushing) return;
    if (!state.buffer.length) return;

    state.flushing = true;
    var batch = state.buffer.slice();
    state.buffer = [];

    try {
      await persistBatch(batch);
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'flushBuffer 예외 (' + (reason || 'unknown') + '):',
        err && (err.message || err)
      );
      state.buffer = batch.concat(state.buffer);
    } finally {
      state.flushing = false;
    }
  }

  function scheduleFlushTimer() {
    if (state.flushTimer != null) return;
    var trackCfg = getTrackingConfig();
    state.flushTimer = setInterval(function () {
      flushBuffer('interval');
    }, trackCfg.batchIntervalMs);
  }

  function clearFlushTimer() {
    if (state.flushTimer != null) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }
  }

  function enqueuePoint(rawPoint) {
    if (!state.active) return false;
    var pt = normalizePoint(rawPoint);
    if (!pt) return false;

    state.buffer.push(pt);
    var trackCfg = getTrackingConfig();
    if (state.buffer.length >= trackCfg.maxBufferSize) {
      flushBuffer('max_buffer');
    }
    return true;
  }

  function onGeolocationPosition(pos) {
    if (!pos || !pos.coords) return;
    enqueuePoint({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitude: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      heading: pos.coords.heading,
      recordedAt: pos.timestamp ? new Date(pos.timestamp).toISOString() : null,
      source: 'geolocation',
    });
  }

  function onGeolocationError(err) {
    console.warn(
      LOG_PREFIX,
      'watchPosition 오류:',
      err && (err.message || err.code)
    );
  }

  function startWebGeolocationWatch() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      typeof navigator.geolocation.watchPosition !== 'function'
    ) {
      return;
    }
    if (state.watchId != null) return;
    var trackCfg = getTrackingConfig();
    state.watchId = navigator.geolocation.watchPosition(
      onGeolocationPosition,
      onGeolocationError,
      trackCfg.geolocationOptions
    );
    console.log(LOG_PREFIX, 'watchPosition 시작 (id=' + state.watchId + ')');
  }

  function stopWebGeolocationWatch() {
    if (
      state.watchId == null ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      state.watchId = null;
      return;
    }
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  function onLocationDataEvent(e) {
    var detail = e && e.detail;
    if (!detail || typeof detail !== 'object') return;
    enqueuePoint(detail);
  }

  var locationListenerBound = false;

  function bindLocationBridgeEvents() {
    if (locationListenerBound || typeof global.addEventListener !== 'function') {
      return;
    }
    locationListenerBound = true;
    global.addEventListener('locationData', onLocationDataEvent);
    global.addEventListener('gpsUpdate', onLocationDataEvent);
    global.addEventListener('gpsData', onLocationDataEvent);
  }

  function unbindLocationBridgeEvents() {
    if (!locationListenerBound || typeof global.removeEventListener !== 'function') {
      return;
    }
    global.removeEventListener('locationData', onLocationDataEvent);
    global.removeEventListener('gpsUpdate', onLocationDataEvent);
    global.removeEventListener('gpsData', onLocationDataEvent);
    locationListenerBound = false;
  }

  /**
   * @param {{ sessionId?: string, userId?: string, enableWebGeolocation?: boolean }} [opts]
   */
  function start(opts) {
    opts = opts || {};
    if (state.active) {
      console.warn(LOG_PREFIX, '이미 추적 중 — sessionId=', state.sessionId);
      return { ok: true, alreadyActive: true };
    }

    var userId = opts.userId || getFirebaseUid();
    if (!userId) {
      console.warn(LOG_PREFIX, 'start 실패 — 로그인 필요');
      return { ok: false, reason: 'no_user' };
    }

    state.active = true;
    state.userId = userId;
    state.sessionId =
      opts.sessionId ||
      (typeof global !== 'undefined' && global.SESSION_ID) ||
      'session_' + Date.now();
    state.buffer = [];

    bindLocationBridgeEvents();
    scheduleFlushTimer();

    var enableGeo = opts.enableWebGeolocation !== false;
    if (enableGeo) startWebGeolocationWatch();

    var cfg = getTrackingConfig();
    console.log(
      LOG_PREFIX,
      '추적 시작 session=' +
        state.sessionId +
        ' backend=' +
        (cfg.useSupabaseForTracking ? 'supabase' : 'firebase') +
        ' intervalMs=' +
        cfg.batchIntervalMs
    );
    return { ok: true, sessionId: state.sessionId };
  }

  async function stop(opts) {
    opts = opts || {};
    if (!state.active) return { ok: true, alreadyStopped: true };

    state.active = false;
    clearFlushTimer();
    stopWebGeolocationWatch();

    if (opts.unbindBridge !== false) {
      unbindLocationBridgeEvents();
    }

    await flushBuffer('stop');

    var endedSession = state.sessionId;
    state.sessionId = null;
    state.userId = null;
    state.buffer = [];

    console.log(LOG_PREFIX, '추적 종료 session=' + endedSession);
    return { ok: true, sessionId: endedSession };
  }

  function getStatus() {
    var cfg = getTrackingConfig();
    return {
      active: state.active,
      sessionId: state.sessionId,
      userId: state.userId,
      bufferedCount: state.buffer.length,
      useSupabaseForTracking: cfg.useSupabaseForTracking,
      batchIntervalMs: cfg.batchIntervalMs,
      watchId: state.watchId,
    };
  }

  /** 페이지 이탈 시 남은 버퍼 flush (best-effort) */
  function bindPageUnloadFlush() {
    if (typeof global.addEventListener !== 'function') return;
    global.addEventListener('pagehide', function () {
      if (state.buffer.length) {
        flushBuffer('pagehide');
      }
    });
  }

  bindPageUnloadFlush();

  global.StelvioLocationTracking = {
    start: start,
    stop: stop,
    enqueuePoint: enqueuePoint,
    flushNow: function () {
      return flushBuffer('manual');
    },
    getStatus: getStatus,
    /** 테스트·디버그용 */
    _persistBatch: persistBatch,
    _normalizePoint: normalizePoint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
