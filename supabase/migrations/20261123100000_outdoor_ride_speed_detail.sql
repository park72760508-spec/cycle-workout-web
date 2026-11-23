-- 루트맵 자전거(라이딩) 기록 저장 보강(2026-11-23)
--  1) 비정상 평속(>120km/h)이면 기록 전체를 거부하던 것을 → 해당 값만 비우고 기록은 저장
--  2) 구간별 평속(Max·1·5·10·20·40·60분)을 같은 호출(speed_peaks)로 함께 저장 + 구간 거리·시간 상세(speed_detail_json) 저장
-- 함수 본문은 DB 에 배포된 현재 정의를 읽어 필요한 부분만 치환한다(다른 변경분 되돌림 방지).
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS speed_detail_json jsonb;
COMMENT ON COLUMN public.rides.speed_detail_json IS '구간별 최고 평속 기록 상세 {max:{kmh},1:{kmh,km,sec},5:{...},...} — 속도·이동거리 기반(파워 제외), 루트맵 GPS 기록';

DO $mig$
DECLARE
  d text;
  n text;
  pairs text[][] := ARRAY[
    ARRAY['v_avg numeric := nullif(p ->> ''avg_speed_kmh'', '''')::numeric;',
          'v_avg numeric := CASE WHEN nullif(p ->> ''avg_speed_kmh'', '''')::numeric BETWEEN 0 AND 120 THEN nullif(p ->> ''avg_speed_kmh'', '''')::numeric END;'],
    ARRAY['v_max numeric := nullif(p ->> ''max_speed_kmh'', '''')::numeric;',
          'v_max numeric := CASE WHEN nullif(p ->> ''max_speed_kmh'', '''')::numeric BETWEEN 0 AND 150 THEN nullif(p ->> ''max_speed_kmh'', '''')::numeric END;'],
    ARRAY['v_eff jsonb := p -> ''efforts'';' || E'\nBEGIN',
          'v_eff jsonb := p -> ''efforts'';' || E'\n  v_detail jsonb := CASE WHEN jsonb_typeof(p -> ''speed_detail'') = ''object'' THEN p -> ''speed_detail'' END;' || E'\nBEGIN'],
    ARRAY['IF v_km > 1000 OR v_dur > 86400 * 2 OR coalesce(v_avg, 0) > 120 THEN',
          'IF v_km > 1000 OR v_dur > 86400 * 2 THEN'],
    ARRAY['intensity_factor, ftp_at_time, summary_polyline, elevation_profile_json, updated_at',
          'intensity_factor, ftp_at_time, summary_polyline, elevation_profile_json, speed_detail_json, updated_at'],
    ARRAY['v_if, v_ftp, v_poly, v_prof, now()',
          'v_if, v_ftp, v_poly, v_prof, v_detail, now()'],
    ARRAY['summary_polyline = EXCLUDED.summary_polyline, elevation_profile_json = EXCLUDED.elevation_profile_json,' || E'\n      updated_at = now();' || E'\n    RETURN jsonb_build_object(''success'', true, ''kind'', ''ride'', ''activity_id'', v_aid);',
          'summary_polyline = EXCLUDED.summary_polyline, elevation_profile_json = EXCLUDED.elevation_profile_json,' || E'\n      speed_detail_json = coalesce(EXCLUDED.speed_detail_json, rides.speed_detail_json),' || E'\n      updated_at = now();' || E'\n    IF jsonb_typeof(p -> ''speed_peaks'') = ''object'' THEN' || E'\n      BEGIN' || E'\n        PERFORM public.fn_set_ride_speed_peaks(v_aid, p -> ''speed_peaks'');' || E'\n      EXCEPTION WHEN OTHERS THEN' || E'\n        NULL;' || E'\n      END;' || E'\n    END IF;' || E'\n    RETURN jsonb_build_object(''success'', true, ''kind'', ''ride'', ''activity_id'', v_aid);']
  ];
  i int;
BEGIN
  d := pg_get_functiondef('public.fn_save_outdoor_activity'::regproc);
  FOR i IN 1..array_length(pairs, 1) LOOP
    n := replace(d, pairs[i][1], pairs[i][2]);
    IF n = d THEN RAISE EXCEPTION 'fn_save_outdoor_activity 치환 실패 #%', i; END IF;
    d := n;
  END LOOP;
  EXECUTE d;

  d := pg_get_functiondef('public.fn_my_ride_logs'::regproc);
  n := replace(d, 'r.workout_segments_json', 'r.workout_segments_json, r.speed_detail_json');
  IF n = d THEN RAISE EXCEPTION 'fn_my_ride_logs 치환 실패'; END IF;
  EXECUTE n;
END
$mig$;
