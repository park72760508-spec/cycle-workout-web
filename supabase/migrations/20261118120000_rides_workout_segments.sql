-- 2026-11-18: AI(Claude) 추천 워크아웃(claude-ai-*)은 일정 시간 후 서버 목록에서 사라져, 나의 기록에서 워크아웃 그래프·요약을
-- 다시 그릴 수 없었음 → 훈련 저장 시 워크아웃 구간 정의를 기록에 함께 보관한다.
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS workout_segments_json jsonb;
COMMENT ON COLUMN public.rides.workout_segments_json IS 'AI 추천 워크아웃 구간 정의(나의 기록 워크아웃 그래프·요약 재표시용).';

CREATE OR REPLACE FUNCTION public.fn_my_ride_logs(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_limit integer DEFAULT 200, p_ascending boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH picked AS (
    SELECT r.activity_id, r.source, r.activity_type, r.title, r.ride_date, r.workout_id, r.duration_sec,
           r.distance_km, r.elevation_gain_m, r.avg_speed_kmh, r.weight_at_ride_kg, r.ftp_at_time,
           r.avg_cadence, r.avg_hr, r.max_hr, r.max_hr_5sec, r.max_hr_1min, r.max_hr_5min, r.max_hr_10min,
           r.max_hr_20min, r.max_hr_40min, r.max_hr_60min, r.avg_watts, r.weighted_watts, r.max_watts,
           r.max_1min_watts, r.max_5min_watts, r.max_10min_watts, r.max_20min_watts, r.max_30min_watts,
           r.max_40min_watts, r.max_60min_watts, r.tss, r.intensity_factor, r.kilojoules, r.earned_points,
           r.efficiency_factor, r.rpe, r.tss_applied, r.summary_polyline, r.elevation_profile_json,
           r.route_profile_updated_at, r.time_in_zones_json, r.segment_avg_watts_json,
           r.max_speed_kmh, r.moving_time_sec,
           r.max_1min_speed_kmh, r.max_5min_speed_kmh, r.max_10min_speed_kmh,
           r.max_20min_speed_kmh, r.max_40min_speed_kmh, r.max_60min_speed_kmh,
           r.race_speed_series_json, r.workout_segments_json
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
$function$;
