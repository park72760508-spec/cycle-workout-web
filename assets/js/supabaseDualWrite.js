/**
 * Firestore Primary 성공 후 Supabase Secondary (Strangler Fig 1단계).
 * @see docs/DUAL_RUN_REMOTE_CONFIG.md, docs/SUPABASE_AUTH_BRIDGE.md
 */

const REMOTE_CONFIG_KEY_STATUS = 'dual_write_status';
const REMOTE_CONFIG_KEY_SHADOW_UIDS = 'dual_write_shadow_uids';
const REMOTE_CONFIG_KEY_CANARY_PERCENT = 'dual_write_canary_percent';
const REMOTE_CONFIG_KEY_INDOOR_STATUS = 'indoor_write_status';
const REMOTE_CONFIG_KEY_INDOOR_CANARY = 'indoor_write_canary_percent';

const DEFAULT_SHADOW_WHITELIST = ['Ys8GQZYyf3ZoEunSVGKnWNbtSkv2'];
const DEFAULT_CANARY_PERCENT = 10;
const UID_NAMESPACE_DEFAULT = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** @type {{ status: string, shadowUids: string[], canaryPercent: number, lastFetchAt: number }} */
let dualRunCache = {
  status: 'OFF',
  shadowUids: DEFAULT_SHADOW_WHITELIST.slice(),
  canaryPercent: DEFAULT_CANARY_PERCENT,
  lastFetchAt: 0,
};

/** @type {{ status: string, canaryPercent: number, lastFetchAt: number }} */
let indoorWriteCache = {
  status: 'OFF',
  canaryPercent: DEFAULT_CANARY_PERCENT,
  lastFetchAt: 0,
};

let supabaseClientPromise = null;

function getConfig() {
  const c =
    (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  return {
    supabaseUrl: String(c.supabaseUrl || '').trim(),
    supabaseAnonKey: String(c.supabaseAnonKey || '').trim(),
    authBridgeUrl: String(c.authBridgeUrl || '').trim(),
    uidNamespace: String(c.uidNamespace || UID_NAMESPACE_DEFAULT).trim(),
  };
}

function parseDualWriteStatus(raw) {
  const n = String(raw || '')
    .trim()
    .toUpperCase();
  if (['OFF', 'SHADOW', 'CANARY', 'FULL'].includes(n)) return n;
  return 'OFF';
}

function parseShadowUidList(raw) {
  if (!raw || !String(raw).trim()) return [];
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch (_) {
      /* comma split */
    }
  }
  return trimmed.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function mergeUidLists() {
  const sets = new Set();
  for (let i = 0; i < arguments.length; i++) {
    const arr = arguments[i];
    if (!arr) continue;
    for (const u of arr) {
      const t = String(u).trim();
      if (t) sets.add(t);
    }
  }
  return Array.from(sets);
}

function isUidInCanaryPercent(firebaseUid, percent) {
  const uid = String(firebaseUid || '').trim();
  if (!uid) return false;
  const clamped = Math.min(100, Math.max(0, Math.trunc(percent)));
  if (clamped <= 0) return false;
  if (clamped >= 100) return true;
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < clamped;
}

/**
 * Secondary **쓰기** 게이트 — @see docs/DUAL_RUN_REMOTE_CONFIG.md
 * SHADOW: whitelist · CANARY: whitelist + hash% · FULL: 전체
 * @param {string|undefined} firebaseUid
 * @returns {{ execute: boolean, status: string, reason: string, userId?: string }}
 */
export function evaluateSupabaseDualWrite(firebaseUid) {
  const override =
    typeof window !== 'undefined' && window.STELVIO_DUAL_WRITE_LOCAL_OVERRIDE;
  const status = override
    ? parseDualWriteStatus(override.status || override)
    : dualRunCache.status;
  const uid = String(firebaseUid || '').trim();

  if (status === 'OFF') {
    return { execute: false, status, reason: 'dual_write_status=OFF' };
  }

  if (status === 'FULL') {
    return {
      execute: true,
      status,
      reason: 'dual_write_status=FULL',
      userId: uid,
    };
  }

  const shadowList = mergeUidLists(
    DEFAULT_SHADOW_WHITELIST,
    dualRunCache.shadowUids,
    override && Array.isArray(override.shadowUids) ? override.shadowUids : []
  );

  if (status === 'SHADOW') {
    if (uid && shadowList.includes(uid)) {
      return {
        execute: true,
        status,
        reason: 'dual_write_status=SHADOW, whitelist',
        userId: uid,
      };
    }
    return {
      execute: false,
      status,
      reason: 'dual_write_status=SHADOW, not in whitelist',
      userId: uid,
    };
  }

  if (status === 'CANARY') {
    if (uid && shadowList.includes(uid)) {
      return {
        execute: true,
        status,
        reason: 'dual_write_status=CANARY, shadow whitelist',
        userId: uid,
      };
    }
    const pct = dualRunCache.canaryPercent;
    if (uid && isUidInCanaryPercent(uid, pct)) {
      return {
        execute: true,
        status,
        reason: 'dual_write_status=CANARY, hash bucket<' + pct,
        userId: uid,
      };
    }
    return {
      execute: false,
      status,
      reason: 'dual_write_status=CANARY, outside bucket',
      userId: uid,
    };
  }

  return {
    execute: false,
    status,
    reason: 'dual_write_status unknown: ' + status,
    userId: uid,
  };
}

export function shouldRunSupabaseDualWrite(firebaseUid) {
  return evaluateSupabaseDualWrite(firebaseUid).execute;
}

/**
 * Phase 3+ — Supabase Primary ingest (서버 evaluateSupabasePrimaryIngest와 동일).
 * FULL 이면 Firestore users/logs 에 쓰지 않고 Supabase rides 만 기록.
 * @param {string|undefined} firebaseUid
 */
export function evaluateSupabasePrimaryIngest(firebaseUid) {
  const override =
    typeof window !== 'undefined' && window.STELVIO_DUAL_WRITE_LOCAL_OVERRIDE;
  const status = override
    ? parseDualWriteStatus(override.status || override)
    : dualRunCache.status;
  const uid = String(firebaseUid || '').trim();

  if (status === 'OFF') {
    return { usePrimary: false, reason: 'dual_write_status=OFF', status };
  }
  if (status === 'FULL') {
    return { usePrimary: true, reason: 'dual_write_status=FULL', status };
  }

  const shadowList = mergeUidLists(
    DEFAULT_SHADOW_WHITELIST,
    dualRunCache.shadowUids,
    override && Array.isArray(override.shadowUids) ? override.shadowUids : []
  );

  if (status === 'SHADOW') {
    const inShadow = uid && shadowList.includes(uid);
    return {
      usePrimary: inShadow,
      reason: inShadow ? 'dual_write_status=SHADOW(uid)' : 'dual_write_status=SHADOW(skip)',
      status,
    };
  }

  if (status === 'CANARY') {
    if (uid && shadowList.includes(uid)) {
      return {
        usePrimary: true,
        reason: 'dual_write_status=CANARY, shadow whitelist',
        status,
      };
    }
    const pct = dualRunCache.canaryPercent;
    if (uid && isUidInCanaryPercent(uid, pct)) {
      return {
        usePrimary: true,
        reason: 'dual_write_status=CANARY, hash bucket<' + pct,
        status,
      };
    }
    return {
      usePrimary: false,
      reason: 'dual_write_status=CANARY, outside bucket',
      status,
    };
  }

  return { usePrimary: false, reason: 'dual_write_status=' + status, status };
}

/** Phase 4 — FULL Primary 성공 시 Firestore shadow 중단 (기본 ON). */
export function isPhase4FirestoreLogShadowStopped() {
  if (
    typeof window !== 'undefined' &&
    window.STELVIO_FIRESTORE_SHADOW_WRITE === true
  ) {
    return false;
  }
  return true;
}

/**
 * Supabase rides 에 Strava activity_id 존재 여부 (Phase 4 중복 확인).
 * @param {string} activityId
 */
export async function fetchStravaRideExists(activityId) {
  await syncSupabaseSessionFromBridge();
  const supabase = await getSupabaseClient();
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session || !sess.session.user) {
    throw new Error('Supabase auth session 없음');
  }
  const actId = String(activityId || '').trim();
  if (!actId) return false;
  const { data, error } = await supabase
    .from('rides')
    .select('activity_id')
    .eq('user_id', sess.session.user.id)
    .eq('source', 'strava')
    .eq('activity_id', actId)
    .maybeSingle();
  if (error) throw error;
  return !!(data && data.activity_id);
}

/**
 * 오픈라이딩·소모임·Functions ingest — SHADOW/CANARY/FULL이면 Secondary ON (서버와 동일).
 * 훈련 저장은 evaluateSupabaseDualWrite(SHADOW 화이트리스트) 사용.
 */
export function evaluateSecondaryIngestWrite(firebaseUid) {
  const override =
    typeof window !== 'undefined' && window.STELVIO_DUAL_WRITE_LOCAL_OVERRIDE;
  const status = override
    ? parseDualWriteStatus(override.status || override)
    : dualRunCache.status;
  const uid = String(firebaseUid || '').trim();

  if (status === 'OFF') {
    return { execute: false, status, reason: 'dual_write_status=OFF', userId: uid };
  }
  return {
    execute: true,
    status,
    reason: 'dual_write_status=' + status + ', ingest=all_users',
    userId: uid,
  };
}

export async function refreshDualRunFromRemoteConfig(force = false) {
  const override =
    typeof window !== 'undefined' && window.STELVIO_DUAL_WRITE_LOCAL_OVERRIDE;
  if (override) {
    dualRunCache.status = parseDualWriteStatus(
      override.status || override
    );
    if (Array.isArray(override.shadowUids)) {
      dualRunCache.shadowUids = mergeUidLists(
        DEFAULT_SHADOW_WHITELIST,
        override.shadowUids
      );
    }
    return dualRunCache;
  }

  const minInterval = 5 * 60 * 1000;
  const now = Date.now();
  if (!force && now - dualRunCache.lastFetchAt < minInterval) {
    return dualRunCache;
  }

  try {
    const appMod = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'
    );
    const rcMod = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-remote-config.js'
    );
    const getApp = appMod.getApp;
    const getRemoteConfig = rcMod.getRemoteConfig;
    const fetchAndActivate = rcMod.fetchAndActivate;
    const getValue = rcMod.getValue;

    let app;
    try {
      app = getApp('authV9');
    } catch (_) {
      const apps = appMod.getApps && appMod.getApps();
      app = apps && apps[0];
    }
    if (!app) {
      console.warn('[supabaseDualWrite] Firebase app 없음 — RC 스킵');
      return dualRunCache;
    }

    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = force ? 0 : 300000;
    await fetchAndActivate(rc);

    const status = parseDualWriteStatus(
      getValue(rc, REMOTE_CONFIG_KEY_STATUS).asString()
    );
    const rcShadow = parseShadowUidList(
      getValue(rc, REMOTE_CONFIG_KEY_SHADOW_UIDS).asString()
    );
    let canaryPercent = getValue(rc, REMOTE_CONFIG_KEY_CANARY_PERCENT).asNumber();
    if (!Number.isFinite(canaryPercent) || canaryPercent <= 0) {
      canaryPercent = DEFAULT_CANARY_PERCENT;
    }

    dualRunCache = {
      status,
      shadowUids: mergeUidLists(DEFAULT_SHADOW_WHITELIST, rcShadow),
      canaryPercent: Math.min(100, Math.max(0, Math.trunc(canaryPercent))),
      lastFetchAt: now,
    };
    console.log('[supabaseDualWrite] Remote Config', {
      status: dualRunCache.status,
      shadowCount: dualRunCache.shadowUids.length,
      canaryPercent: dualRunCache.canaryPercent,
      channel:
        typeof window !== 'undefined' && window.StelvioAppChannel
          ? window.StelvioAppChannel
          : 'web',
    });
  } catch (err) {
    console.warn('[supabaseDualWrite] Remote Config fetch 실패:', err);
  }
  return dualRunCache;
}

/* UUID v5 (Firebase UID → Supabase user id) */
function parseUuidBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes) {
  const hex = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push((bytes[i] + 0x100).toString(16).slice(1));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

function uuidv5(name, namespaceUuid) {
  const namespace = parseUuidBytes(namespaceUuid);
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(String(name));
  const data = new Uint8Array(namespace.length + nameBytes.length);
  data.set(namespace);
  data.set(nameBytes, namespace.length);

  return crypto.subtle.digest('SHA-1', data).then(function (hash) {
    const h = new Uint8Array(hash);
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    return bytesToUuid(h.slice(0, 16));
  });
}

function resolveUserUuid(firebaseUid, uidNamespace) {
  const raw = String(firebaseUid || '').trim();
  if (!raw) return null;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw
    )
  ) {
    return raw.toLowerCase();
  }
  return uuidv5(raw, uidNamespace);
}

function num(v, fallback = null) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = 0) {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function toRideDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    }
    return null;
  }
  if (typeof raw === 'object' && raw !== null && typeof raw.toDate === 'function') {
    return raw.toDate().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }
  return null;
}

function buildStelvioActivityId(logDocId) {
  return 'stelvio:' + logDocId;
}

/**
 * @param {string} firebaseUid
 * @param {string} logDocId
 * @param {object} log
 * @param {string} uidNamespace
 */
async function mapTrainingLogToRideRow(firebaseUid, logDocId, log, uidNamespace) {
  const userId = await resolveUserUuid(firebaseUid, uidNamespace);
  const rideDate = toRideDate(log.date);
  if (!userId || !rideDate) return null;

  const duration =
    int(log.duration_sec) || int(log.time) || 0;
  const source = str(log.source)?.toLowerCase() === 'strava' ? 'strava' : 'stelvio';
  let activityId = str(log.activity_id);
  if (!activityId) {
    activityId =
      source === 'strava' ? logDocId : buildStelvioActivityId(logDocId);
  }

  return {
    user_id: userId,
    source,
    activity_id: activityId,
    activity_type: str(log.activity_type),
    title: str(log.title),
    ride_date: rideDate,
    workout_id: str(log.workout_id),
    duration_sec: duration,
    distance_km: num(log.distance_km),
    elevation_gain_m: num(log.elevation_gain),
    avg_speed_kmh: num(log.avg_speed_kmh),
    weight_at_ride_kg: num(log.weight),
    ftp_at_time: num(log.ftp_at_time),
    avg_watts: num(log.avg_watts),
    weighted_watts: num(log.weighted_watts),
    max_watts: num(log.max_watts),
    tss: num(log.tss) ?? 0,
    intensity_factor: num(log.if),
    kilojoules: num(log.kilojoules),
    earned_points: int(log.earned_points, 0),
    avg_hr: int(log.avg_hr, 0) || null,
    max_hr: int(log.max_hr, 0) || null,
    max_hr_5sec: int(log.max_hr_5sec, 0) || null,
    max_hr_1min: int(log.max_hr_1min, 0) || null,
    max_hr_5min: int(log.max_hr_5min, 0) || null,
    max_hr_10min: int(log.max_hr_10min, 0) || null,
    max_hr_20min: int(log.max_hr_20min, 0) || null,
    max_hr_40min: int(log.max_hr_40min, 0) || null,
    max_hr_60min: int(log.max_hr_60min, 0) || null,
    avg_cadence: int(log.avg_cadence, 0) || null,
    efficiency_factor: num(log.efficiency_factor),
    rpe: int(log.rpe, 0) || null,
    max_1min_watts: num(log.max_1min_watts),
    max_5min_watts: num(log.max_5min_watts),
    max_10min_watts: num(log.max_10min_watts),
    max_20min_watts: num(log.max_20min_watts),
    max_30min_watts: num(log.max_30min_watts),
    max_40min_watts: num(log.max_40min_watts),
    max_60min_watts: num(log.max_60min_watts),
    tss_applied: Boolean(log.tss_applied),
    summary_polyline: str(log.summary_polyline),
    elevation_profile_json:
      log.elevation_profile != null
        ? log.elevation_profile
        : log.elevation_profile_json != null
          ? log.elevation_profile_json
          : null,
    route_profile_updated_at: log.route_profile_updated_at || null,
    time_in_zones_json:
      log.time_in_zones && typeof log.time_in_zones === 'object'
        ? log.time_in_zones
        : null,
  };
}

async function getFirebaseIdToken() {
  let user = null;
  if (typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser) {
    user = window.authV9.currentUser;
  } else if (typeof window !== 'undefined' && window.auth && window.auth.currentUser) {
    user = window.auth.currentUser;
  }
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('Firebase 로그인 세션이 없습니다.');
  }
  return user.getIdToken(true);
}

export async function fetchSupabaseSessionFromBridge(authBridgeUrl, firebaseIdToken) {
  const url = authBridgeUrl.replace(/\/+$/, '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + firebaseIdToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    body = {};
  }
  if (!res.ok) {
    const msg =
      (body.error && body.error.message) ||
      'Auth bridge HTTP ' + res.status;
    throw new Error(msg);
  }
  if (!body.success || !body.session || !body.session.access_token) {
    throw new Error('Auth bridge 응답에 session.access_token이 없습니다.');
  }
  return body.session;
}

export async function getSupabaseClient() {
  const cfg = getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error(
      'STELVIO_SUPABASE_CONFIG: supabaseAnonKey가 비어 있습니다. stelvioSupabaseConfig.js 또는 window.__STELVIO_SUPABASE__ 설정'
    );
  }
  if (!supabaseClientPromise) {
    supabaseClientPromise = (async function () {
      const { createClient } = await import(
        'https://esm.sh/@supabase/supabase-js@2.49.1'
      );
      return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        },
      });
    })();
  }
  return supabaseClientPromise;
}

export async function syncSupabaseSessionFromBridge() {
  const cfg = getConfig();
  if (!cfg.authBridgeUrl) {
    throw new Error('authBridgeUrl 미설정');
  }
  const supabase = await getSupabaseClient();
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session && existing.session.expires_at) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (existing.session.expires_at > nowSec + 120) {
      return existing.session;
    }
  }
  const idToken = await getFirebaseIdToken();
  const minted = await fetchSupabaseSessionFromBridge(
    cfg.authBridgeUrl,
    idToken
  );
  const { data, error } = await supabase.auth.setSession({
    access_token: minted.access_token,
    refresh_token: minted.refresh_token,
  });
  if (error) throw error;
  if (!data.session) throw new Error('Supabase setSession 실패');
  return data.session;
}

export async function writeRideToSupabase(rideRow) {
  const supabase = await getSupabaseClient();
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session || !sess.session.user) {
    throw new Error('Supabase auth session 없음');
  }
  if (rideRow.user_id !== sess.session.user.id) {
    throw new Error('RLS user_id 불일치');
  }
  const { error } = await supabase.from('rides').upsert(rideRow, {
    onConflict: 'user_id,activity_id',
    ignoreDuplicates: false,
  });
  if (error) {
    if (error.code === '23505') return;
    throw error;
  }
}

/**
 * Firestore log → Supabase rides upsert (training·Strava 공통).
 * @param {string} userId Firebase UID
 * @param {string} logDocId Firestore logs 문서 ID
 * @param {object} log 저장된 log 필드
 * @param {'training'|'strava'} label 로그 구분
 */
async function runSecondaryRideUpsert(userId, logDocId, log, label, options = {}) {
  await refreshDualRunFromRemoteConfig(true);
  let decision = evaluateSecondaryIngestWrite(userId);
  const forceRankingSync = options.force === true;
  if (!decision.execute && forceRankingSync) {
    decision = {
      execute: true,
      status: 'FORCED',
      reason: 'ranking_rides_sync_forced',
      userId,
    };
  }
  if (!decision.execute) {
    console.log('[supabaseDualWrite] ' + label + ' secondary 스킵:', decision.reason);
    return { skipped: true, reason: decision.reason };
  }

  const cfg = getConfig();
  if (!logDocId || !log) {
    console.warn('[supabaseDualWrite] ' + label + ' logDocId/log 없음');
    return { skipped: true, reason: 'missing log payload' };
  }

  const session = await syncSupabaseSessionFromBridge();
  const row = await mapTrainingLogToRideRow(
    userId,
    logDocId,
    log,
    cfg.uidNamespace
  );
  if (!row) {
    console.warn('[supabaseDualWrite] ' + label + ' ride row 매핑 실패');
    return { skipped: true, reason: 'map failed' };
  }
  if (session && session.user && session.user.id) {
    row.user_id = session.user.id;
  }

  await writeRideToSupabase(row);
  console.log('[supabaseDualWrite] ' + label + ' rides upsert OK', {
    userId,
    activity_id: row.activity_id,
    ride_date: row.ride_date,
    source: row.source,
    status: decision.status,
  });
  return { skipped: false, activity_id: row.activity_id };
}

/**
 * saveTrainingSession Firestore 성공 후 호출.
 * @param {string} userId Firebase UID
 * @param {object} trainingData 입력
 * @param {object} txResult runTransaction 반환값
 */
export async function runSecondaryAfterTrainingSave(
  userId,
  trainingData,
  txResult
) {
  const logDocId = txResult && txResult.trainingLogId;
  const log =
    (txResult && txResult.trainingLogData) ||
    buildFallbackLogFromTrainingData(trainingData, txResult);
  return runSecondaryRideUpsert(userId, logDocId, log, 'training', { force: true });
}

/**
 * saveStravaActivityToFirebase Firestore 성공(또는 기존 log backfill) 후 호출.
 * @param {string} userId Firebase UID
 * @param {string} logDocId Firestore logs 문서 ID
 * @param {object} trainingLog 저장·조회된 log 필드
 */
export async function runSecondaryAfterStravaSave(userId, logDocId, trainingLog) {
  return runSecondaryRideUpsert(userId, logDocId, trainingLog, 'strava', { force: true });
}

export function evaluateIndoorPrimaryWrite(firebaseUid) {
  const status = indoorWriteCache.status;
  const uid = String(firebaseUid || '').trim();
  if (status === 'OFF') {
    return { usePrimary: false, reason: 'indoor_write_status=OFF' };
  }
  if (status === 'FULL') {
    return { usePrimary: true, reason: 'indoor_write_status=FULL', status };
  }
  if (status === 'CANARY') {
    const inCanary = isUidInCanaryPercent(uid, indoorWriteCache.canaryPercent);
    return {
      usePrimary: inCanary,
      reason: inCanary
        ? 'indoor_write_status=CANARY(' + indoorWriteCache.canaryPercent + '%)'
        : 'indoor_write_status=CANARY(skip)',
      status,
    };
  }
  return { usePrimary: false, reason: 'indoor_write_status=' + status };
}

export async function refreshIndoorWriteFromRemoteConfig(force = false) {
  const minInterval = 5 * 60 * 1000;
  const now = Date.now();
  if (!force && now - indoorWriteCache.lastFetchAt < minInterval) {
    return indoorWriteCache;
  }
  try {
    const appMod = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'
    );
    const rcMod = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-remote-config.js'
    );
    const getApp = appMod.getApp;
    const getRemoteConfig = rcMod.getRemoteConfig;
    const fetchAndActivate = rcMod.fetchAndActivate;
    const getValue = rcMod.getValue;
    let app;
    try {
      app = getApp('authV9');
    } catch (_) {
      const apps = appMod.getApps && appMod.getApps();
      app = apps && apps[0];
    }
    if (!app) return indoorWriteCache;
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = force ? 0 : 300000;
    await fetchAndActivate(rc);
    const status = parseDualWriteStatus(
      getValue(rc, REMOTE_CONFIG_KEY_INDOOR_STATUS).asString()
    );
    let canaryPercent = getValue(rc, REMOTE_CONFIG_KEY_INDOOR_CANARY).asNumber();
    if (!Number.isFinite(canaryPercent) || canaryPercent <= 0) {
      canaryPercent = DEFAULT_CANARY_PERCENT;
    }
    indoorWriteCache = {
      status,
      canaryPercent: Math.min(100, Math.max(0, Math.trunc(canaryPercent))),
      lastFetchAt: now,
    };
    console.log('[supabaseDualWrite] indoor Remote Config', indoorWriteCache);
  } catch (err) {
    console.warn('[supabaseDualWrite] indoor Remote Config fetch 실패:', err);
  }
  return indoorWriteCache;
}

/**
 * Phase 5 — 실내 훈련 Supabase Primary (rides + users.points).
 * point_history는 onIndoorLogCreatedReward → PointRewardService가 기록.
 */
export async function runPrimaryIndoorTrainingSave(userId, trainingData, txResult) {
  const decision = evaluateIndoorPrimaryWrite(userId);
  if (!decision.usePrimary) {
    return { skipped: true, reason: decision.reason };
  }
  const logDocId = txResult && txResult.trainingLogId;
  const log =
    (txResult && txResult.trainingLogData) ||
    buildFallbackLogFromTrainingData(trainingData, txResult);
  await syncSupabaseSessionFromBridge();
  const cfg = getConfig();
  const row = await mapTrainingLogToRideRow(userId, logDocId, log, cfg.uidNamespace);
  if (!row) {
    return { skipped: true, reason: 'map failed' };
  }
  await writeRideToSupabase(row);

  const supabase = await getSupabaseClient();
  const userUuid = await resolveUserUuid(userId, cfg.uidNamespace);
  const patch = {
    rem_points: txResult.userUpdateData && txResult.userUpdateData.rem_points,
    acc_points: txResult.userUpdateData && txResult.userUpdateData.acc_points,
    expiry_date:
      txResult.userUpdateData && txResult.userUpdateData.expiry_date
        ? String(txResult.userUpdateData.expiry_date).slice(0, 10)
        : null,
    last_training_date: log && log.date ? String(log.date).slice(0, 10) : null,
  };
  const { error } = await supabase.from('users').update(patch).eq('id', userUuid);
  if (error) throw error;
  console.log('[supabaseDualWrite] indoor primary OK', {
    userId,
    userUuid,
    activity_id: row.activity_id,
    reason: decision.reason,
  });
  return { skipped: false, reason: decision.reason, activity_id: row.activity_id };
}

function buildFallbackLogFromTrainingData(trainingData, txResult) {
  const td = trainingData || {};
  const now = new Date();
  const dateStr =
    td.date ||
    now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');
  return {
    source: 'stelvio',
    date: dateStr,
    duration_sec: Number(td.duration) || 0,
    distance_km: td.distance_km,
    elevation_gain: td.elevation_gain,
    weighted_watts: td.weighted_watts,
    avg_watts: td.avg_watts,
    workout_id: td.workout_id,
    title: td.title,
    tss: txResult && txResult.earnedPoints,
    earned_points: txResult && txResult.earnedPoints,
    activity_id: buildStelvioActivityId(
      txResult && txResult.trainingLogId
    ),
    tss_applied: false,
  };
}

if (typeof window !== 'undefined') {
  window.refreshDualRunFromRemoteConfig = refreshDualRunFromRemoteConfig;
  window.shouldRunSupabaseDualWrite = shouldRunSupabaseDualWrite;
  window.syncSupabaseSessionFromBridge = syncSupabaseSessionFromBridge;
}
