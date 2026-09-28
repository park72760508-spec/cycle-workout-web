-- 비용 절감(2026-09-28): getTrainingLogsForRead / getYearlyPeaksForRead(Cloud Run relay) 대체.
-- 로그인 사용자 토큰(auth.uid() = users.id = rides.user_id)으로 본인 기록만 직접 조회.
-- 선택 컬럼은 functions/supabaseGroupReader.js RIDE_LOG_SELECT / fetchYearlyPeaksForYear 와 동일,
-- Firestore 호환 매핑은 클라이언트(supabaseRidesReadClient.js mapRideRowToTrainingLog)에서 수행.

/**
 * p_start·p_end 둘 다 있으면 기간(양끝 포함), 없으면 최근 p_limit 건(최대 1000).
 * p_ascending: 기간 조회 정렬(서버 relay: 월 조회 asc, 기간 조회 desc).
 */
CREATE OR REPLACE FUNCTION public.fn_my_ride_logs(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL,
  p_limit int DEFAULT 200,
  p_ascending boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT r.activity_id, r.source, r.activity_type, r.title, r.ride_date, r.workout_id, r.duration_sec,
           r.distance_km, r.elevation_gain_m, r.avg_speed_kmh, r.weight_at_ride_kg, r.ftp_at_time,
           r.avg_cadence, r.avg_hr, r.max_hr, r.max_hr_5sec, r.max_hr_1min, r.max_hr_5min, r.max_hr_10min,
           r.max_hr_20min, r.max_hr_40min, r.max_hr_60min, r.avg_watts, r.weighted_watts, r.max_watts,
           r.max_1min_watts, r.max_5min_watts, r.max_10min_watts, r.max_20min_watts, r.max_30min_watts,
           r.max_40min_watts, r.max_60min_watts, r.tss, r.intensity_factor, r.kilojoules, r.earned_points,
           r.efficiency_factor, r.rpe, r.tss_applied, r.summary_polyline, r.elevation_profile_json,
           r.route_profile_updated_at, r.time_in_zones_json, r.segment_avg_watts_json
    FROM rides r
    WHERE auth.uid() IS NOT NULL
      AND r.user_id = auth.uid()
      AND (p_start IS NULL OR p_end IS NULL OR (r.ride_date >= p_start AND r.ride_date <= p_end))
    ORDER BY
      CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_ascending THEN r.ride_date END ASC,
      r.ride_date DESC
    LIMIT CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL THEN NULL
               ELSE least(1000, greatest(1, coalesce(p_limit, 200))) END
  )
  SELECT jsonb_build_object(
    'success', auth.uid() IS NOT NULL,
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM picked p), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_my_ride_logs(date, date, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_ride_logs(date, date, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_my_yearly_peaks(p_year int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'success', auth.uid() IS NOT NULL,
    'row', (
      SELECT to_jsonb(y) FROM (
        SELECT year, weight_kg, max_hr, max_hr_date, max_1min_watts, max_1min_wkg, max_5min_watts,
               max_5min_wkg, max_10min_watts, max_10min_wkg, max_20min_watts, max_20min_wkg,
               max_40min_watts, max_40min_wkg, max_60min_watts, max_60min_wkg, max_watts, max_wkg, updated_at
        FROM yearly_peaks
        WHERE auth.uid() IS NOT NULL AND user_id = auth.uid() AND year = p_year
        LIMIT 1
      ) y
    )
  );
$$;
REVOKE ALL ON FUNCTION public.fn_my_yearly_peaks(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_yearly_peaks(int) TO authenticated;
