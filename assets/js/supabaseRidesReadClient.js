/**
 * Phase 6 — 훈련 로그 Read (Supabase public.rides → Firestore logs 호환 형태).
 * @see functions/supabaseGroupReader.js fetchUserRideLogsForMonth
 */
import { syncSupabaseSessionFromBridge, getSupabaseClient } from './supabaseDualWrite.js';

const STRAVA_EXCLUDED = new Set(['run', 'swim', 'walk', 'trailrun', 'weighttraining']);

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
    duration_sec: Number(row.duration_sec) || 0,
    distance_km: row.distance_km != null ? Number(row.distance_km) : null,
    elevation_gain:
      row.elevation_gain_m != null
        ? Number(row.elevation_gain_m)
        : row.elevation_gain != null
          ? Number(row.elevation_gain)
          : null,
    avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    avg_cadence: row.avg_cadence != null ? Number(row.avg_cadence) : null,
    avg_hr: row.avg_hr != null ? Number(row.avg_hr) : null,
    max_hr: row.max_hr != null ? Number(row.max_hr) : null,
    avg_watts: row.avg_watts != null ? Number(row.avg_watts) : null,
    weighted_watts: row.weighted_watts != null ? Number(row.weighted_watts) : null,
    max_watts: row.max_watts != null ? Number(row.max_watts) : null,
    tss: row.tss != null ? Number(row.tss) : null,
    if: row.intensity_factor != null ? Number(row.intensity_factor) : null,
    kilojoules: row.kilojoules != null ? Number(row.kilojoules) : null,
    earned_points: row.earned_points != null ? Number(row.earned_points) : null,
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
    readBackend: 'supabase',
  };
}

const RIDE_SELECT =
  'activity_id, source, activity_type, title, ride_date, duration_sec, distance_km, elevation_gain_m, avg_speed_kmh, avg_cadence, avg_hr, max_hr, avg_watts, weighted_watts, max_watts, tss, intensity_factor, kilojoules, earned_points, max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts, max_30min_watts, max_40min_watts, max_60min_watts, summary_polyline, elevation_profile_json, route_profile_updated_at';

export async function getUserTrainingLogsFromSupabase(userId, options = {}) {
  if (!userId) throw new Error('userId는 필수입니다.');
  const limitValue = Math.min(1000, Math.max(1, Number(options.limit) || 50));
  await syncSupabaseSessionFromBridge();
  const supabase = await getSupabaseClient();
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user?.id) {
    throw new Error('Supabase auth session 없음');
  }

  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('user_id', sess.session.user.id)
    .order('ride_date', { ascending: false })
    .limit(limitValue);
  if (error) throw error;

  const logs = [];
  for (const row of data || []) {
    if (!isRidingRideRow(row)) continue;
    logs.push(mapRideRowToTrainingLog(row));
  }
  console.log('[supabaseRidesRead] getUserTrainingLogs', { userId, count: logs.length });
  return logs;
}

export async function getTrainingLogsByDateRangeFromSupabase(userId, year, month) {
  if (!userId) throw new Error('userId는 필수입니다.');
  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(year, month + 1, 0);
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  await syncSupabaseSessionFromBridge();
  const supabase = await getSupabaseClient();
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user?.id) {
    throw new Error('Supabase auth session 없음');
  }

  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('user_id', sess.session.user.id)
    .gte('ride_date', startStr)
    .lte('ride_date', endStr)
    .order('ride_date', { ascending: true });
  if (error) throw error;

  const logs = [];
  for (const row of data || []) {
    if (!isRidingRideRow(row)) continue;
    logs.push(mapRideRowToTrainingLog(row));
  }
  console.log('[supabaseRidesRead] getTrainingLogsByDateRange', {
    userId,
    year,
    month: month + 1,
    count: logs.length,
  });
  return logs;
}
