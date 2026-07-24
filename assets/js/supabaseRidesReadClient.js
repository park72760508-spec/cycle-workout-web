/**
 * Phase 6 — 훈련 로그 Read (Supabase public.rides → Firestore logs 호환 형태).
 * 기본: Firebase ID 토큰 + getTrainingLogsForRead relay (Service Role, Auth Bridge 불필요).
 * 보조: 이미 유효한 Supabase 클라이언트 세션이 있을 때만 direct RLS 조회 (Bridge setSession 호출 안 함).
 * @see functions/supabaseGroupReader.js fetchUserRideLogsRecent
 */
import { getSupabaseClient } from './supabaseDualWrite.js';

const TRAINING_LOGS_READ_RELAY_DEFAULT =
  'https://us-central1-stelvio-ai.cloudfunctions.net/getTrainingLogsForRead';

const YEARLY_PEAKS_READ_RELAY_DEFAULT =
  'https://us-central1-stelvio-ai.cloudfunctions.net/getYearlyPeaksForRead';

function getReadRelayUrl() {
  const c =
    (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  return String(c.trainingLogsReadUrl || TRAINING_LOGS_READ_RELAY_DEFAULT).trim();
}

function getYearlyPeaksReadRelayUrl() {
  const c =
    (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  return String(c.yearlyPeaksReadUrl || YEARLY_PEAKS_READ_RELAY_DEFAULT).trim();
}

async function getFirebaseIdTokenForReadRelay() {
  let user = null;
  if (typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser) {
    user = window.authV9.currentUser;
  } else if (typeof window !== 'undefined' && window.auth && window.auth.currentUser) {
    user = window.auth.currentUser;
  } else if (
    typeof window !== 'undefined' &&
    window.firebase &&
    typeof window.firebase.auth === 'function'
  ) {
    user = window.firebase.auth().currentUser;
  }
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('Firebase 로그인 세션이 없습니다.');
  }
  return user.getIdToken(true);
}

async function fetchTrainingLogsViaReadRelay(userId, query) {
  const url = new URL(getReadRelayUrl());
  url.searchParams.set('uid', String(userId).trim());
  if (query && query.limit != null) {
    url.searchParams.set('limit', String(query.limit));
  }
  if (query && query.year != null && query.month != null) {
    url.searchParams.set('year', String(query.year));
    url.searchParams.set('month', String(query.month));
  }
  if (query && query.start && query.end) {
    url.searchParams.set('start', String(query.start));
    url.searchParams.set('end', String(query.end));
  }
  const token = await getFirebaseIdTokenForReadRelay();
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const json = await res.json().catch(function () {
    return {};
  });
  if (!res.ok || !json.success) {
    const msg =
      (json.error && (json.error.message || json.error)) ||
      'Read relay HTTP ' + res.status;
    throw new Error(msg);
  }
  const logs = Array.isArray(json.logs) ? json.logs : [];
  console.log('[supabaseRidesRead] relay OK', {
    userId,
    count: logs.length,
    via: json.via || 'service_role_relay',
  });
  return logs;
}

const STRAVA_EXCLUDED = new Set(['run', 'swim', 'walk', 'trailrun', 'weighttraining']);

/** Supabase rides.time_in_zones_json → Firestore time_in_zones 호환 객체 */
function parseTimeInZonesFromRideRow(row) {
  if (!row) return null;
  const raw = row.time_in_zones_json;
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const power = parsed.power;
  const hr = parsed.hr;
  if ((!power || typeof power !== 'object') && (!hr || typeof hr !== 'object')) return null;
  return { power: power || {}, hr: hr || {} };
}

function isRidingRideRow(row) {
  const src = String(row.source || '').toLowerCase();
  if (src !== 'strava') return true;
  const act = String(row.activity_type || '').trim().toLowerCase();
  if (!act) return true;
  return !STRAVA_EXCLUDED.has(act);
}

export function mapRideRowToTrainingLog(row) {
  const activityId = row.activity_id ? String(row.activity_id) : '';
  const logId =
    activityId ||
    `${row.source || 'ride'}:${row.ride_date || ''}`;
  return {
    id: logId,
    activity_id: activityId || null,
    source: row.source || 'strava',
    activity_type: row.activity_type || null,
    title: row.title || '',
    date: row.ride_date || '',
    workout_id: row.workout_id || null,
    duration_sec: Number(row.duration_sec) || 0,
    time: Number(row.duration_sec) || 0,
    distance_km: row.distance_km != null ? Number(row.distance_km) : null,
    elevation_gain:
      row.elevation_gain_m != null
        ? Number(row.elevation_gain_m)
        : row.elevation_gain != null
          ? Number(row.elevation_gain)
          : null,
    avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    weight:
      row.weight_at_ride_kg != null
        ? Number(row.weight_at_ride_kg)
        : row.weight != null
          ? Number(row.weight)
          : null,
    ftp_at_time: row.ftp_at_time != null ? Number(row.ftp_at_time) : null,
    avg_cadence: row.avg_cadence != null ? Number(row.avg_cadence) : null,
    avg_hr: row.avg_hr != null ? Number(row.avg_hr) : null,
    max_hr: row.max_hr != null ? Number(row.max_hr) : null,
    max_hr_5sec: (function () {
      const v5 = row.max_hr_5sec != null ? Number(row.max_hr_5sec) : 0;
      if (v5 > 0) return v5;
      const mh = row.max_hr != null ? Number(row.max_hr) : 0;
      return mh > 0 ? mh : null;
    })(),
    max_hr_1min: row.max_hr_1min != null ? Number(row.max_hr_1min) : null,
    max_hr_5min: row.max_hr_5min != null ? Number(row.max_hr_5min) : null,
    max_hr_10min: row.max_hr_10min != null ? Number(row.max_hr_10min) : null,
    max_hr_20min: row.max_hr_20min != null ? Number(row.max_hr_20min) : null,
    max_hr_40min: row.max_hr_40min != null ? Number(row.max_hr_40min) : null,
    max_hr_60min: row.max_hr_60min != null ? Number(row.max_hr_60min) : null,
    avg_watts: row.avg_watts != null ? Number(row.avg_watts) : null,
    weighted_watts: row.weighted_watts != null ? Number(row.weighted_watts) : null,
    max_watts: row.max_watts != null ? Number(row.max_watts) : null,
    tss: row.tss != null ? Number(row.tss) : null,
    if: row.intensity_factor != null ? Number(row.intensity_factor) : null,
    kilojoules: row.kilojoules != null ? Number(row.kilojoules) : null,
    earned_points: row.earned_points != null ? Number(row.earned_points) : null,
    efficiency_factor:
      row.efficiency_factor != null ? Number(row.efficiency_factor) : null,
    rpe: row.rpe != null ? Number(row.rpe) : null,
    tss_applied: row.tss_applied === true,
    max_1min_watts: row.max_1min_watts != null ? Number(row.max_1min_watts) : null,
    max_5min_watts: row.max_5min_watts != null ? Number(row.max_5min_watts) : null,
    max_10min_watts: row.max_10min_watts != null ? Number(row.max_10min_watts) : null,
    max_20min_watts: row.max_20min_watts != null ? Number(row.max_20min_watts) : null,
    max_30min_watts: row.max_30min_watts != null ? Number(row.max_30min_watts) : null,
    max_40min_watts: row.max_40min_watts != null ? Number(row.max_40min_watts) : null,
    max_60min_watts: row.max_60min_watts != null ? Number(row.max_60min_watts) : null,
    summary_polyline: row.summary_polyline || null,
    elevation_profile: row.elevation_profile_json || row.elevation_profile || null,
    route_profile_updated_at: row.route_profile_updated_at || null,
    time_in_zones: parseTimeInZonesFromRideRow(row),
    readBackend: 'supabase',
  };
}

/** Firestore users/logs 호환 — JournalDetail Heart Rate·Power Profile 필드 포함 */
const RIDE_SELECT =
  'activity_id, source, activity_type, title, ride_date, workout_id, duration_sec, distance_km, elevation_gain_m, avg_speed_kmh, weight_at_ride_kg, ftp_at_time, avg_cadence, avg_hr, max_hr, max_hr_5sec, max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min, avg_watts, weighted_watts, max_watts, max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts, max_30min_watts, max_40min_watts, max_60min_watts, tss, intensity_factor, kilojoules, earned_points, efficiency_factor, rpe, tss_applied, summary_polyline, elevation_profile_json, route_profile_updated_at, time_in_zones_json';

/** localStorage에 남은 만료/무효 세션으로 /auth/v1/user 403이 반복되지 않도록 검사 */
function hasFreshSupabaseClientSession(session) {
  if (!session || !session.user || !session.user.id) return false;
  if (!session.expires_at) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at > nowSec + 120;
}

function rowsToTrainingLogs(rows) {
  const logs = [];
  for (const row of rows || []) {
    if (!isRidingRideRow(row)) continue;
    logs.push(mapRideRowToTrainingLog(row));
  }
  return logs;
}

/** Auth Bridge(setSession) 없이 — 기존 유효 세션만 사용 */
async function tryDirectRidesRead(queryBuilder) {
  try {
    const supabase = await getSupabaseClient();
    const { data: sess } = await supabase.auth.getSession();
    if (!hasFreshSupabaseClientSession(sess.session)) return null;
    const userUuid = sess.session.user.id;
    const { data, error } = await queryBuilder(supabase, userUuid);
    if (error) throw error;
    return rowsToTrainingLogs(data);
  } catch (e) {
    return null;
  }
}

export async function getUserTrainingLogsFromSupabase(userId, options = {}) {
  if (!userId) throw new Error('userId는 필수입니다.');
  const limitValue = Math.min(1000, Math.max(1, Number(options.limit) || 50));

  const direct = await tryDirectRidesRead(function (supabase, userUuid) {
    return supabase
      .from('rides')
      .select(RIDE_SELECT)
      .eq('user_id', userUuid)
      .order('ride_date', { ascending: false })
      .limit(limitValue);
  });
  if (direct) {
    console.log('[supabaseRidesRead] getUserTrainingLogs (direct)', { userId, count: direct.length });
    return direct;
  }

  return fetchTrainingLogsViaReadRelay(userId, { limit: limitValue });
}

export async function getTrainingLogsByDateRangeFromSupabase(userId, year, month) {
  if (!userId) throw new Error('userId는 필수입니다.');

  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(year, month + 1, 0);
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const direct = await tryDirectRidesRead(function (supabase, userUuid) {
    return supabase
      .from('rides')
      .select(RIDE_SELECT)
      .eq('user_id', userUuid)
      .gte('ride_date', startStr)
      .lte('ride_date', endStr)
      .order('ride_date', { ascending: true });
  });
  if (direct) {
    console.log('[supabaseRidesRead] getTrainingLogsByDateRange (direct)', {
      userId,
      year,
      month: month + 1,
      count: direct.length,
    });
    return direct;
  }

  return fetchTrainingLogsViaReadRelay(userId, { year, month });
}

/**
 * 임의 날짜 범위(YYYY-MM-DD, 양끝 포함) 훈련 로그 — rolling N일 통계(예: 최근 365일 Max HR)용.
 * Firestore `users/{uid}/logs where date >= start AND date <= end` 대체.
 * @param {string} userId
 * @param {string} startStr YYYY-MM-DD
 * @param {string} endStr YYYY-MM-DD
 */
export async function getTrainingLogsInRangeFromSupabase(userId, startStr, endStr) {
  if (!userId) throw new Error('userId는 필수입니다.');
  if (!startStr || !endStr) throw new Error('startStr/endStr은 필수입니다.');

  const direct = await tryDirectRidesRead(function (supabase, userUuid) {
    return supabase
      .from('rides')
      .select(RIDE_SELECT)
      .eq('user_id', userUuid)
      .gte('ride_date', startStr)
      .lte('ride_date', endStr)
      .order('ride_date', { ascending: true });
  });
  if (direct) {
    console.log('[supabaseRidesRead] getTrainingLogsInRange (direct)', {
      userId,
      startStr,
      endStr,
      count: direct.length,
    });
    return direct;
  }

  return fetchTrainingLogsViaReadRelay(userId, { start: startStr, end: endStr });
}

/** PR 표시 — Supabase yearly_peaks relay (Auth Bridge 불필요) */
export async function fetchYearlyPeaksForYearFromSupabase(userId, year) {
  if (!userId || year == null) return null;
  const url = new URL(getYearlyPeaksReadRelayUrl());
  url.searchParams.set('uid', String(userId).trim());
  url.searchParams.set('year', String(year));
  const token = await getFirebaseIdTokenForReadRelay();
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const json = await res.json().catch(function () {
    return {};
  });
  if (!res.ok || !json.success) {
    const msg =
      (json.error && (json.error.message || json.error)) ||
      'Yearly peaks relay HTTP ' + res.status;
    throw new Error(msg);
  }
  return json.peaks || null;
}
