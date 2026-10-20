-- 아웃도어 라이딩 화면(GPS) 기록 저장 RPC (2026-10-21)
--
-- 문제: 아웃도어 저장이 saveStravaActivityToFirebase → supabase.auth.setSession(커스텀 JWT) 경로를 타는데,
--       GoTrue 가 커스텀 JWT 를 /auth/v1/user 에서 거부해 "Auth session missing!" 으로 저장 실패.
-- 해결: 랭킹 RPC 와 같은 "accessToken 콜백" 클라이언트(callSupabaseRpcAsUser)로 이 함수를 부른다.
--       auth.uid() 본인 기록만 저장(SECURITY DEFINER).
--
-- p.kind:
--   'ride'        → public.rides (source stelvio, activity_type Ride) — 기존 훈련 일지·주간 TSS·랭킹 트리거 그대로
--   'run'|'walk'  → public.activities (source stelvio, activity_type Run|Walk) — RUN 일지·대시보드
--                   'run' 이고 p.efforts 가 있으면 public.run_activity_efforts 도 저장(구간 최고 속도 m/s)

CREATE OR REPLACE FUNCTION public.fn_save_outdoor_activity(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- 비정상 값 방어(사람·자전거가 낼 수 없는 값)
  IF v_km > 1000 OR v_dur > 86400 * 2 OR coalesce(v_avg, 0) > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', '비정상 기록 값');
  END IF;

  IF v_kind = 'ride' THEN
    INSERT INTO public.rides (
      user_id, source, activity_id, activity_type, title, ride_date, duration_sec, distance_km,
      elevation_gain_m, avg_speed_kmh, max_speed_kmh, moving_time_sec, weight_at_ride_kg, tss,
      summary_polyline, elevation_profile_json, updated_at
    ) VALUES (
      v_uid, 'stelvio', v_aid, 'Ride', v_title, v_date, v_dur, v_km,
      v_elev, v_avg, v_max, nullif(v_moving, 0), nullif(p ->> 'weight', '')::numeric, 0,
      v_poly, CASE WHEN jsonb_typeof(p -> 'elevation_profile') = 'array' THEN p -> 'elevation_profile' END, now()
    )
    ON CONFLICT (user_id, activity_id) DO UPDATE SET
      title = EXCLUDED.title, duration_sec = EXCLUDED.duration_sec, distance_km = EXCLUDED.distance_km,
      elevation_gain_m = EXCLUDED.elevation_gain_m, avg_speed_kmh = EXCLUDED.avg_speed_kmh,
      max_speed_kmh = EXCLUDED.max_speed_kmh, moving_time_sec = EXCLUDED.moving_time_sec,
      summary_polyline = EXCLUDED.summary_polyline, elevation_profile_json = EXCLUDED.elevation_profile_json,
      updated_at = now();
    RETURN jsonb_build_object('success', true, 'kind', 'ride', 'activity_id', v_aid);
  END IF;

  IF v_kind NOT IN ('run', 'walk') THEN
    RETURN jsonb_build_object('success', false, 'error', 'kind 는 ride|run|walk');
  END IF;
  v_type := CASE v_kind WHEN 'run' THEN 'Run' ELSE 'Walk' END;

  -- activities.id 는 기본값이 없어 서버(processRunningActivity)와 같이 max+1 — 동시 저장 대비 잠금
  PERFORM pg_advisory_xact_lock(hashtext('public.activities.id'));

  SELECT id INTO v_id FROM public.activities WHERE user_id = v_uid AND activity_id = v_aid;
  IF v_id IS NULL THEN
    SELECT coalesce(max(id), 0) + 1 INTO v_id FROM public.activities;
    INSERT INTO public.activities (
      id, user_id, source, activity_id, activity_type, title, name, activity_date, start_date,
      duration_sec, moving_time, elapsed_time, distance, distance_km, elevation_gain_m, total_elevation_gain,
      avg_speed_kmh, tss, splits_metric, summary_polyline, performance_metrics, device_name, updated_at
    ) VALUES (
      v_id, v_uid, 'stelvio', v_aid, v_type, v_title, v_title, v_date, v_start,
      coalesce(nullif(v_moving, 0), v_dur), coalesce(nullif(v_moving, 0), v_dur), v_dur, v_km, nullif(v_km, 0),
      v_elev, coalesce(v_elev, 0), v_avg, 0,
      CASE WHEN jsonb_typeof(p -> 'splits_metric') = 'array' THEN p -> 'splits_metric' ELSE '[]'::jsonb END,
      v_poly,
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
      summary_polyline = v_poly,
      performance_metrics = coalesce(p -> 'performance_metrics', '{}'::jsonb) || jsonb_build_object('max_speed_kmh', v_max, 'recorded_by', 'stelvio_outdoor_gps'),
      updated_at = now()
    WHERE id = v_id;
  END IF;

  -- 러닝만 구간 최고 기록(랭킹·대시보드 피크 페이스). 걷기는 RUN 랭킹 제외 정책(20260618)과 동일하게 저장 안 함
  IF v_kind = 'run' AND jsonb_typeof(v_eff) = 'object' THEN
    -- run_activity_efforts.id 는 IDENTITY(ALWAYS) — 지정하지 않는다
    INSERT INTO public.run_activity_efforts (
      user_id, activity_id, activity_date,
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k, updated_at
    ) VALUES (
      v_uid, v_aid, v_start,
      -- 사람 한계(calculateAndSaveRunEfforts RUN_EFFORT_MAX_PLAUSIBLE_SPEED_MPS) 초과는 GPS 오류로 버림
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
$$;

REVOKE ALL ON FUNCTION public.fn_save_outdoor_activity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_outdoor_activity(jsonb) TO authenticated;
