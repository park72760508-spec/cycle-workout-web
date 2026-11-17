-- STELVIO Race 휴대폰 훈련 기록(2026-11-17): 레이스 속도 그래프(시간/거리 대비 평균 속도) 저장.
-- 워크아웃·코스맵이 없는 Race 인도어 기록의 라이딩 기록 Summary 에서 그대로 다시 그린다.
-- 형식: {"mode":"time"|"distance","target":<초|km>,"pts":[[x,평균속도km/h],...]}  (x = 경과 초 또는 누적 km)
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS race_speed_series_json jsonb;
COMMENT ON COLUMN public.rides.race_speed_series_json IS 'STELVIO Race 휴대폰 속도 그래프 시계열(라이딩 기록 Summary 표시용).';

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
           r.race_speed_series_json
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
