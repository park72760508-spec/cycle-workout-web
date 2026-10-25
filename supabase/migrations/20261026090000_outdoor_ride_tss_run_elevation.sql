-- 루트맵 저장 보완(2026-10-26)
--  1) 라이딩: GPS 속도·경사·체중으로 추정한 TSS·IF·당시 FTP 저장(파워 값 자체는 저장하지 않음 — 파워 랭킹·피크 파워 미반영)
--     범위 확인: TSS 0~500, IF 0~1.5
--  2) 러닝·걷기: 고도 프로필(elevation_profile_json) 저장
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS elevation_profile_json jsonb;

CREATE OR REPLACE FUNCTION public.fn_save_outdoor_activity(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := lower(coalesce(p ->> 'kind', ''));
  v_aid text := btrim(coalesce(p ->> 'activity_id', ''));
  v_date date := nullif(p ->> 'date', '')::date;
  v_start timestamptz := coalesce(nullif(p ->> 'start_time', '')::timestamptz, now());
  v_title text := left(coalesce(nullif(btrim(p ->> 'title'), ''), '아웃도어'), 120);
  v_dur int := greatest(0, coalesce((p ->> 'duration_sec')::numeric, 0)::int);
  v_moving int := greatest(0, coalesce((p ->> 'moving_time_sec')::numeric, 0)::int);
  v_km numeric := greatest(0, coalesce((p ->> 'distance_km')::numeric, 0));
  v_elev numeric := nullif(p ->> 'elevation_gain_m', '')::numeric;
  v_avg numeric := nullif(p ->> 'avg_speed_kmh', '')::numeric;
  v_max numeric := nullif(p ->> 'max_speed_kmh', '')::numeric;
  v_poly text := nullif(p ->> 'summary_polyline', '');
  v_prof jsonb := CASE WHEN jsonb_typeof(p -> 'elevation_profile') = 'array' THEN p -> 'elevation_profile' END;
  v_tss numeric := CASE WHEN nullif(p ->> 'tss', '')::numeric BETWEEN 0 AND 500 THEN round(nullif(p ->> 'tss', '')::numeric, 1) ELSE 0 END;
  v_if numeric := CASE WHEN nullif(p ->> 'intensity_factor', '')::numeric > 0 AND nullif(p ->> 'intensity_factor', '')::numeric <= 1.5 THEN round(nullif(p ->> 'intensity_factor', '')::numeric, 3) END;
  v_ftp numeric := CASE WHEN nullif(p ->> 'ftp_at_time', '')::numeric BETWEEN 50 AND 600 THEN nullif(p ->> 'ftp_at_time', '')::numeric END;
  v_type text;
  v_id bigint;
  v_eff jsonb := p -> 'efforts';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  IF v_aid = '' OR v_aid !~ '^outdoor_' THEN
    RETURN jsonb_build_object('success', false, 'error', 'activity_id 형식 오류');
  END IF;
  IF v_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'date 필요');
  END IF;
  IF v_km > 1000 OR v_dur > 86400 * 2 OR coalesce(v_avg, 0) > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', '비정상 기록 값');
  END IF;

  IF v_kind = 'ride' THEN
    INSERT INTO public.rides (
      user_id, source, activity_id, activity_type, title, ride_date, duration_sec, distance_km,
      elevation_gain_m, avg_speed_kmh, max_speed_kmh, moving_time_sec, weight_at_ride_kg, tss,
      intensity_factor, ftp_at_time, summary_polyline, elevation_profile_json, updated_at
    ) VALUES (
      v_uid, 'stelvio', v_aid, 'Ride', v_title, v_date, v_dur, v_km,
      v_elev, v_avg, v_max, nullif(v_moving, 0), nullif(p ->> 'weight', '')::numeric, v_tss,
      v_if, v_ftp, v_poly, v_prof, now()
    )
    ON CONFLICT (user_id, activity_id) DO UPDATE SET
      title = EXCLUDED.title, duration_sec = EXCLUDED.duration_sec, distance_km = EXCLUDED.distance_km,
      elevation_gain_m = EXCLUDED.elevation_gain_m, avg_speed_kmh = EXCLUDED.avg_speed_kmh,
      max_speed_kmh = EXCLUDED.max_speed_kmh, moving_time_sec = EXCLUDED.moving_time_sec,
      tss = EXCLUDED.tss, intensity_factor = EXCLUDED.intensity_factor, ftp_at_time = EXCLUDED.ftp_at_time,
      summary_polyline = EXCLUDED.summary_polyline, elevation_profile_json = EXCLUDED.elevation_profile_json,
      updated_at = now();
    RETURN jsonb_build_object('success', true, 'kind', 'ride', 'activity_id', v_aid);
  END IF;

  IF v_kind NOT IN ('run', 'walk') THEN
    RETURN jsonb_build_object('success', false, 'error', 'kind 는 ride|run|walk');
  END IF;
  v_type := CASE v_kind WHEN 'run' THEN 'Run' ELSE 'Walk' END;

  PERFORM pg_advisory_xact_lock(hashtext('public.activities.id'));

  SELECT id INTO v_id FROM public.activities WHERE user_id = v_uid AND activity_id = v_aid;
  IF v_id IS NULL THEN
    SELECT coalesce(max(id), 0) + 1 INTO v_id FROM public.activities;
    INSERT INTO public.activities (
      id, user_id, source, activity_id, activity_type, title, name, activity_date, start_date,
      duration_sec, moving_time, elapsed_time, distance, distance_km, elevation_gain_m, total_elevation_gain,
      avg_speed_kmh, tss, splits_metric, summary_polyline, elevation_profile_json, performance_metrics, device_name, updated_at
    ) VALUES (
      v_id, v_uid, 'stelvio', v_aid, v_type, v_title, v_title, v_date, v_start,
      coalesce(nullif(v_moving, 0), v_dur), coalesce(nullif(v_moving, 0), v_dur), v_dur, v_km, nullif(v_km, 0),
      v_elev, coalesce(v_elev, 0), v_avg, 0,
      CASE WHEN jsonb_typeof(p -> 'splits_metric') = 'array' THEN p -> 'splits_metric' ELSE '[]'::jsonb END,
      v_poly, v_prof,
      coalesce(p -> 'performance_metrics', '{}'::jsonb) || jsonb_build_object('max_speed_kmh', v_max, 'recorded_by', 'stelvio_outdoor_gps'),
      'STELVIO 아웃도어(GPS)', now()
    );
  ELSE
    UPDATE public.activities SET
      activity_type = v_type, title = v_title, name = v_title,
      duration_sec = coalesce(nullif(v_moving, 0), v_dur), moving_time = coalesce(nullif(v_moving, 0), v_dur),
      elapsed_time = v_dur, distance = v_km, distance_km = nullif(v_km, 0),
      elevation_gain_m = v_elev, total_elevation_gain = coalesce(v_elev, 0), avg_speed_kmh = v_avg,
      splits_metric = CASE WHEN jsonb_typeof(p -> 'splits_metric') = 'array' THEN p -> 'splits_metric' ELSE splits_metric END,
      summary_polyline = v_poly, elevation_profile_json = coalesce(v_prof, elevation_profile_json),
      performance_metrics = coalesce(p -> 'performance_metrics', '{}'::jsonb) || jsonb_build_object('max_speed_kmh', v_max, 'recorded_by', 'stelvio_outdoor_gps'),
      updated_at = now()
    WHERE id = v_id;
  END IF;

  IF v_kind = 'run' AND jsonb_typeof(v_eff) = 'object' THEN
    INSERT INTO public.run_activity_efforts (
      user_id, activity_id, activity_date,
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k, updated_at
    ) VALUES (
      v_uid, v_aid, v_start,
      CASE WHEN (v_eff ->> 'speed_1k')::float8 BETWEEN 0.5 AND 8.3 THEN (v_eff ->> 'speed_1k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_3k')::float8 BETWEEN 0.5 AND 7.5 THEN (v_eff ->> 'speed_3k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_5k')::float8 BETWEEN 0.5 AND 7.2 THEN (v_eff ->> 'speed_5k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_7k')::float8 BETWEEN 0.5 AND 7.0 THEN (v_eff ->> 'speed_7k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_10k')::float8 BETWEEN 0.5 AND 6.9 THEN (v_eff ->> 'speed_10k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_20k')::float8 BETWEEN 0.5 AND 6.5 THEN (v_eff ->> 'speed_20k')::float8 END,
      CASE WHEN (v_eff ->> 'speed_42k')::float8 BETWEEN 0.5 AND 6.3 THEN (v_eff ->> 'speed_42k')::float8 END,
      now()
    )
    ON CONFLICT (user_id, activity_id) DO UPDATE SET
      speed_1k = EXCLUDED.speed_1k, speed_3k = EXCLUDED.speed_3k, speed_5k = EXCLUDED.speed_5k,
      speed_7k = EXCLUDED.speed_7k, speed_10k = EXCLUDED.speed_10k, speed_20k = EXCLUDED.speed_20k,
      speed_42k = EXCLUDED.speed_42k, updated_at = now();
  ELSIF v_kind = 'walk' THEN
    DELETE FROM public.run_activity_efforts WHERE user_id = v_uid AND activity_id = v_aid;
  END IF;

  RETURN jsonb_build_object('success', true, 'kind', v_kind, 'activity_id', v_aid);
END;
$function$;
