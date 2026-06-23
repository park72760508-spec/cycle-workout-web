-- 피크 파워 프로파일 단조성: 검증 탈락 구간 이후 긴 구간 무효화 + 랭킹 W/kg 역전 방지
-- 원인: 5분·10분 이상치 제거 후 20분만 남아 20분 W/kg > 10분 W/kg 표시 (예: 황용희 6.05 vs 3.24)

CREATE OR REPLACE FUNCTION public.fn_sanitize_peak_power_watts(
  p_max_w numeric,
  p_1min numeric,
  p_5min numeric,
  p_10min numeric,
  p_20min numeric,
  p_40min numeric,
  p_60min numeric,
  p_weight_kg numeric
)
RETURNS TABLE(
  max_w numeric,
  max_1min numeric,
  max_5min numeric,
  max_10min numeric,
  max_20min numeric,
  max_40min numeric,
  max_60min numeric
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  w numeric[];
  i integer;
  hit_gap boolean := false;
BEGIN
  w := ARRAY[
    CASE WHEN p_weight_kg > 0 AND p_max_w > 0 AND public.fn_validate_peak_power('max', p_max_w, p_weight_kg) THEN p_max_w ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_1min > 0 AND public.fn_validate_peak_power('1min', p_1min, p_weight_kg) THEN p_1min ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_5min > 0 AND public.fn_validate_peak_power('5min', p_5min, p_weight_kg) THEN p_5min ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_10min > 0 AND public.fn_validate_peak_power('10min', p_10min, p_weight_kg) THEN p_10min ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_20min > 0 AND public.fn_validate_peak_power('20min', p_20min, p_weight_kg) THEN p_20min ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_40min > 0 AND public.fn_validate_peak_power('40min', p_40min, p_weight_kg) THEN p_40min ELSE 0 END,
    CASE WHEN p_weight_kg > 0 AND p_60min > 0 AND public.fn_validate_peak_power('60min', p_60min, p_weight_kg) THEN p_60min ELSE 0 END
  ];

  -- 1분~60분: 앞 구간 0이면 뒤 구간도 0 (동일 활동/일 MMP 프로파일)
  FOR i IN 2..7 LOOP
    IF hit_gap THEN
      w[i] := 0;
    ELSIF w[i] <= 0 THEN
      hit_gap := true;
    END IF;
  END LOOP;

  -- 짧은 구간 ≥ 긴 구간 (W)
  FOR i IN 2..7 LOOP
    IF w[i - 1] > 0 AND w[i] > w[i - 1] THEN
      w[i] := w[i - 1];
    END IF;
  END LOOP;

  max_w := w[1];
  max_1min := w[2];
  max_5min := w[3];
  max_10min := w[4];
  max_20min := w[5];
  max_40min := w[6];
  max_60min := w[7];
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cap_peak_wkg_monotonic(
  p_max numeric,
  p_1min numeric,
  p_5min numeric,
  p_10min numeric,
  p_20min numeric,
  p_40min numeric,
  p_60min numeric
)
RETURNS TABLE(
  peak_max_wkg numeric,
  peak_1min_wkg numeric,
  peak_5min_wkg numeric,
  peak_10min_wkg numeric,
  peak_20min_wkg numeric,
  peak_40min_wkg numeric,
  peak_60min_wkg numeric
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  wkg numeric[];
  i integer;
BEGIN
  wkg := ARRAY[
    COALESCE(p_max, 0),
    COALESCE(p_1min, 0),
    COALESCE(p_5min, 0),
    COALESCE(p_10min, 0),
    COALESCE(p_20min, 0),
    COALESCE(p_40min, 0),
    COALESCE(p_60min, 0)
  ];

  FOR i IN 2..7 LOOP
    IF wkg[i - 1] > 0 AND wkg[i] > wkg[i - 1] THEN
      wkg[i] := wkg[i - 1];
    END IF;
  END LOOP;

  peak_max_wkg := wkg[1];
  peak_1min_wkg := wkg[2];
  peak_5min_wkg := wkg[3];
  peak_10min_wkg := wkg[4];
  peak_20min_wkg := wkg[5];
  peak_40min_wkg := wkg[6];
  peak_60min_wkg := wkg[7];
  RETURN NEXT;
END;
$$;

-- rides → daily_summaries: 라이드별·일별 피크 sanitize 적용
CREATE OR REPLACE FUNCTION public.fn_reconcile_daily_summary(
  p_user_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_used numeric;
  rec record;
  v_strava_tss numeric := 0;
  v_stelvio_tss numeric := 0;
  v_strava_km numeric := 0;
  v_stelvio_km numeric := 0;
  v_has_data boolean := false;
  agg record;
  san record;
  v_max_w numeric := 0;
  v_1min numeric := 0;
  v_5min numeric := 0;
  v_10min numeric := 0;
  v_20min numeric := 0;
  v_40min numeric := 0;
  v_60min numeric := 0;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  w_used := CASE WHEN u.weight_kg > 0 THEN GREATEST(u.weight_kg, 45) ELSE NULL END;

  CREATE TEMP TABLE IF NOT EXISTS tmp_day_rides (
    source public.activity_source,
    tss numeric,
    km numeric,
    max_1min numeric, max_5min numeric, max_10min numeric,
    max_20min numeric, max_40min numeric, max_60min numeric, max_w numeric,
    hr_1min smallint, hr_5min smallint, hr_10min smallint,
    hr_20min smallint, hr_40min smallint, hr_60min smallint
  ) ON COMMIT DROP;
  TRUNCATE tmp_day_rides;

  FOR rec IN
    SELECT r.*
    FROM public.rides r
    WHERE r.user_id = p_user_id
      AND r.ride_date = p_date
      AND public.fn_is_cycling_ride(r)
  LOOP
    SELECT * INTO san FROM public.fn_sanitize_peak_power_watts(
      COALESCE(rec.max_watts, 0),
      COALESCE(rec.max_1min_watts, 0),
      COALESCE(rec.max_5min_watts, 0),
      COALESCE(rec.max_10min_watts, 0),
      COALESCE(rec.max_20min_watts, 0),
      COALESCE(rec.max_40min_watts, 0),
      COALESCE(rec.max_60min_watts, 0),
      w_used
    );
    INSERT INTO tmp_day_rides VALUES (
      rec.source,
      COALESCE(rec.tss, 0),
      COALESCE(rec.distance_km, 0),
      COALESCE(san.max_1min, 0), COALESCE(san.max_5min, 0),
      COALESCE(san.max_10min, 0), COALESCE(san.max_20min, 0),
      COALESCE(san.max_40min, 0), COALESCE(san.max_60min, 0),
      COALESCE(san.max_w, 0),
      COALESCE(rec.max_hr_1min, 0), COALESCE(rec.max_hr_5min, 0),
      COALESCE(rec.max_hr_10min, 0), COALESCE(rec.max_hr_20min, 0),
      COALESCE(rec.max_hr_40min, 0), COALESCE(rec.max_hr_60min, 0)
    );
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM tmp_day_rides) THEN
    DELETE FROM public.daily_summaries
    WHERE user_id = p_user_id AND summary_date = p_date;
    PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava') THEN
    SELECT
      COALESCE(SUM(tss), 0) AS tss_sum,
      COALESCE(SUM(km), 0) AS km_sum,
      COALESCE(MAX(max_1min), 0) AS max_1min,
      COALESCE(MAX(max_5min), 0) AS max_5min,
      COALESCE(MAX(max_10min), 0) AS max_10min,
      COALESCE(MAX(max_20min), 0) AS max_20min,
      COALESCE(MAX(max_40min), 0) AS max_40min,
      COALESCE(MAX(max_60min), 0) AS max_60min,
      COALESCE(MAX(max_w), 0) AS max_w,
      COALESCE(MAX(hr_1min), 0) AS hr_1min,
      COALESCE(MAX(hr_5min), 0) AS hr_5min,
      COALESCE(MAX(hr_10min), 0) AS hr_10min,
      COALESCE(MAX(hr_20min), 0) AS hr_20min,
      COALESCE(MAX(hr_40min), 0) AS hr_40min,
      COALESCE(MAX(hr_60min), 0) AS hr_60min
    INTO agg
    FROM tmp_day_rides
    WHERE source = 'strava';
  ELSE
    SELECT
      COALESCE(SUM(tss), 0) AS tss_sum,
      COALESCE(SUM(km), 0) AS km_sum,
      COALESCE(MAX(max_1min), 0) AS max_1min,
      COALESCE(MAX(max_5min), 0) AS max_5min,
      COALESCE(MAX(max_10min), 0) AS max_10min,
      COALESCE(MAX(max_20min), 0) AS max_20min,
      COALESCE(MAX(max_40min), 0) AS max_40min,
      COALESCE(MAX(max_60min), 0) AS max_60min,
      COALESCE(MAX(max_w), 0) AS max_w,
      COALESCE(MAX(hr_1min), 0) AS hr_1min,
      COALESCE(MAX(hr_5min), 0) AS hr_5min,
      COALESCE(MAX(hr_10min), 0) AS hr_10min,
      COALESCE(MAX(hr_20min), 0) AS hr_20min,
      COALESCE(MAX(hr_40min), 0) AS hr_40min,
      COALESCE(MAX(hr_60min), 0) AS hr_60min
    INTO agg
    FROM tmp_day_rides
    WHERE source <> 'strava';
  END IF;

  SELECT * INTO san FROM public.fn_sanitize_peak_power_watts(
    agg.max_w, agg.max_1min, agg.max_5min, agg.max_10min,
    agg.max_20min, agg.max_40min, agg.max_60min, w_used
  );
  v_max_w := COALESCE(san.max_w, 0);
  v_1min := COALESCE(san.max_1min, 0);
  v_5min := COALESCE(san.max_5min, 0);
  v_10min := COALESCE(san.max_10min, 0);
  v_20min := COALESCE(san.max_20min, 0);
  v_40min := COALESCE(san.max_40min, 0);
  v_60min := COALESCE(san.max_60min, 0);

  v_strava_tss := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava')
    THEN (SELECT COALESCE(SUM(tss), 0) FROM tmp_day_rides WHERE source = 'strava') ELSE 0 END;
  v_stelvio_tss := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'stelvio')
    THEN (SELECT COALESCE(SUM(tss), 0) FROM tmp_day_rides WHERE source = 'stelvio') ELSE 0 END;
  v_strava_km := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava')
    THEN (SELECT COALESCE(SUM(km), 0) FROM tmp_day_rides WHERE source = 'strava') ELSE 0 END;
  v_stelvio_km := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'stelvio')
    THEN (SELECT COALESCE(SUM(km), 0) FROM tmp_day_rides WHERE source = 'stelvio') ELSE 0 END;

  v_has_data := (v_strava_tss + v_stelvio_tss + v_strava_km + v_stelvio_km) > 0
    OR v_1min > 0 OR v_60min > 0 OR v_max_w > 0;

  IF NOT v_has_data THEN
    DELETE FROM public.daily_summaries WHERE user_id = p_user_id AND summary_date = p_date;
    PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
    RETURN;
  END IF;

  INSERT INTO public.daily_summaries (
    user_id, summary_date,
    tss_strava_sum, tss_stelvio_sum, km_strava_sum, km_stelvio_sum, weight_used_kg,
    max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts,
    max_40min_watts, max_60min_watts, max_watts,
    max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min,
    reconciled_at
  ) VALUES (
    p_user_id, p_date,
    round(v_strava_tss::numeric, 2), round(v_stelvio_tss::numeric, 2),
    round(v_strava_km::numeric, 3), round(v_stelvio_km::numeric, 3), w_used,
    v_1min, v_5min, v_10min, v_20min, v_40min, v_60min, v_max_w,
    agg.hr_1min, agg.hr_5min, agg.hr_10min, agg.hr_20min, agg.hr_40min, agg.hr_60min,
    now()
  )
  ON CONFLICT (user_id, summary_date) DO UPDATE SET
    tss_strava_sum = EXCLUDED.tss_strava_sum,
    tss_stelvio_sum = EXCLUDED.tss_stelvio_sum,
    km_strava_sum = EXCLUDED.km_strava_sum,
    km_stelvio_sum = EXCLUDED.km_stelvio_sum,
    weight_used_kg = EXCLUDED.weight_used_kg,
    max_1min_watts = EXCLUDED.max_1min_watts,
    max_5min_watts = EXCLUDED.max_5min_watts,
    max_10min_watts = EXCLUDED.max_10min_watts,
    max_20min_watts = EXCLUDED.max_20min_watts,
    max_40min_watts = EXCLUDED.max_40min_watts,
    max_60min_watts = EXCLUDED.max_60min_watts,
    max_watts = EXCLUDED.max_watts,
    max_hr_1min = EXCLUDED.max_hr_1min,
    max_hr_5min = EXCLUDED.max_hr_5min,
    max_hr_10min = EXCLUDED.max_hr_10min,
    max_hr_20min = EXCLUDED.max_hr_20min,
    max_hr_40min = EXCLUDED.max_hr_40min,
    max_hr_60min = EXCLUDED.max_hr_60min,
    reconciled_at = now();

  PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
END;
$$;

-- 28일 피크 W/kg 집계 후 단조 보정
CREATE OR REPLACE FUNCTION public.fn_refresh_user_ranking_metrics(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_kg numeric;
  r28 record;
  r30 record;
  rw record;
  v_weekly_tss numeric := 0;
  v_weekly_cheat boolean := false;
  v_dist_30 numeric := 0;
  v_peak60 numeric := 0;
  v_peak60_date date;
  v_speed numeric := 0;
  dur text;
  week_ranges date[];
  w_idx integer;
  w_start date;
  w_end date;
  week_max numeric;
  best_watts numeric;
  best_wkg numeric;
  v_1min numeric := 0; v_5min numeric := 0; v_10min numeric := 0;
  v_20min numeric := 0; v_40min numeric := 0; v_60min numeric := 0; v_max numeric := 0;
  cap record;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    DELETE FROM public.user_ranking_metrics WHERE user_id = p_user_id;
    RETURN;
  END IF;

  w_kg := CASE WHEN u.weight_kg > 0 THEN GREATEST(u.weight_kg, 45) ELSE NULL END;

  SELECT * INTO r28 FROM public.fn_seoul_rolling_range(28);
  SELECT * INTO r30 FROM public.fn_seoul_rolling_range(30);
  SELECT * INTO rw FROM public.fn_seoul_week_range();

  SELECT
    COALESCE(SUM(public.fn_effective_day_tss(d)), 0),
    COALESCE(bool_or(
      (COALESCE(d.tss_strava_sum, 0) > 0 AND d.tss_strava_sum >= 500)
      OR (COALESCE(d.tss_strava_sum, 0) = 0 AND COALESCE(d.tss_stelvio_sum, 0) >= 500)
    ), false)
  INTO v_weekly_tss, v_weekly_cheat
  FROM public.daily_summaries d
  WHERE d.user_id = p_user_id
    AND d.summary_date BETWEEN rw.week_start AND rw.week_end;

  SELECT COALESCE(SUM(public.fn_effective_day_km(d)), 0)
  INTO v_dist_30
  FROM public.daily_summaries d
  WHERE d.user_id = p_user_id
    AND d.summary_date BETWEEN r30.start_date AND r30.end_date;

  IF w_kg IS NOT NULL THEN
    week_ranges := ARRAY[
      r28.start_date,
      r28.start_date + 6,
      r28.start_date + 7,
      r28.start_date + 13,
      r28.start_date + 14,
      r28.start_date + 20,
      r28.start_date + 21,
      r28.end_date
    ];

    FOR dur IN SELECT unnest(ARRAY['1min','5min','10min','20min','40min','60min','max']) LOOP
      best_watts := 0;
      best_wkg := 0;
      FOR w_idx IN 0..3 LOOP
        w_start := week_ranges[w_idx * 2 + 1];
        w_end := week_ranges[w_idx * 2 + 2];
        week_max := 0;
        SELECT COALESCE(MAX(
          CASE dur
            WHEN '1min' THEN d.max_1min_watts
            WHEN '5min' THEN d.max_5min_watts
            WHEN '10min' THEN d.max_10min_watts
            WHEN '20min' THEN d.max_20min_watts
            WHEN '40min' THEN d.max_40min_watts
            WHEN '60min' THEN d.max_60min_watts
            WHEN 'max' THEN d.max_watts
          END
        ), 0)
        INTO week_max
        FROM public.daily_summaries d
        WHERE d.user_id = p_user_id
          AND d.summary_date BETWEEN w_start AND w_end;

        IF week_max > best_watts THEN
          best_watts := week_max;
          best_wkg := round((week_max / w_kg)::numeric, 2);
        END IF;
      END LOOP;

      CASE dur
        WHEN '1min' THEN v_1min := best_wkg;
        WHEN '5min' THEN v_5min := best_wkg;
        WHEN '10min' THEN v_10min := best_wkg;
        WHEN '20min' THEN v_20min := best_wkg;
        WHEN '40min' THEN v_40min := best_wkg;
        WHEN '60min' THEN v_60min := best_wkg;
        WHEN 'max' THEN v_max := best_wkg;
      END CASE;
    END LOOP;

    SELECT * INTO cap FROM public.fn_cap_peak_wkg_monotonic(
      v_max, v_1min, v_5min, v_10min, v_20min, v_40min, v_60min
    );
    v_max := cap.peak_max_wkg;
    v_1min := cap.peak_1min_wkg;
    v_5min := cap.peak_5min_wkg;
    v_10min := cap.peak_10min_wkg;
    v_20min := cap.peak_20min_wkg;
    v_40min := cap.peak_40min_wkg;
    v_60min := cap.peak_60min_wkg;
  END IF;

  IF w_kg IS NOT NULL AND u.weight_kg > 0 THEN
    SELECT d.max_60min_watts, d.summary_date
    INTO v_peak60, v_peak60_date
    FROM public.daily_summaries d
    WHERE d.user_id = p_user_id
      AND d.summary_date BETWEEN r28.start_date AND r28.end_date
      AND d.max_60min_watts > 0
      AND public.fn_validate_peak_power('60min', d.max_60min_watts, w_kg)
    ORDER BY d.max_60min_watts DESC, d.summary_date DESC
    LIMIT 1;

    IF v_peak60 > 0 THEN
      v_speed := public.fn_calculate_speed_on_flat(v_peak60, u.weight_kg);
    END IF;
  END IF;

  INSERT INTO public.user_ranking_metrics (
    user_id,
    peak_window_start, peak_window_end,
    peak_1min_wkg, peak_5min_wkg, peak_10min_wkg, peak_20min_wkg,
    peak_40min_wkg, peak_60min_wkg, peak_max_wkg,
    weekly_tss, week_start, week_end, weekly_has_cheat_day,
    distance_30d_km, dist_window_start, dist_window_end,
    speed_28d_kmh, speed_peak60_watts, speed_peak60_date,
    speed_window_start, speed_window_end,
    metrics_updated_at
  ) VALUES (
    p_user_id,
    r28.start_date, r28.end_date,
    v_1min, v_5min, v_10min, v_20min, v_40min, v_60min, v_max,
    round(v_weekly_tss::numeric, 2), rw.week_start, rw.week_end, v_weekly_cheat,
    round(v_dist_30::numeric, 3), r30.start_date, r30.end_date,
    v_speed, COALESCE(v_peak60, 0), v_peak60_date,
    r28.start_date, r28.end_date,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    peak_window_start = EXCLUDED.peak_window_start,
    peak_window_end = EXCLUDED.peak_window_end,
    peak_1min_wkg = EXCLUDED.peak_1min_wkg,
    peak_5min_wkg = EXCLUDED.peak_5min_wkg,
    peak_10min_wkg = EXCLUDED.peak_10min_wkg,
    peak_20min_wkg = EXCLUDED.peak_20min_wkg,
    peak_40min_wkg = EXCLUDED.peak_40min_wkg,
    peak_60min_wkg = EXCLUDED.peak_60min_wkg,
    peak_max_wkg = EXCLUDED.peak_max_wkg,
    weekly_tss = EXCLUDED.weekly_tss,
    week_start = EXCLUDED.week_start,
    week_end = EXCLUDED.week_end,
    weekly_has_cheat_day = EXCLUDED.weekly_has_cheat_day,
    distance_30d_km = EXCLUDED.distance_30d_km,
    dist_window_start = EXCLUDED.dist_window_start,
    dist_window_end = EXCLUDED.dist_window_end,
    speed_28d_kmh = EXCLUDED.speed_28d_kmh,
    speed_peak60_watts = EXCLUDED.speed_peak60_watts,
    speed_peak60_date = EXCLUDED.speed_peak60_date,
    speed_window_start = EXCLUDED.speed_window_start,
    speed_window_end = EXCLUDED.speed_window_end,
    metrics_updated_at = EXCLUDED.metrics_updated_at;

END;
$$;

COMMENT ON FUNCTION public.fn_sanitize_peak_power_watts IS
  '피크 파워 W: 구간별 검증 + 1분~60분 cascade + 짧은 구간≥긴 구간 단조 보정';

-- 기존 데이터 보정: 최근 90일 일별 재합산 + MV 스냅샷 재빌드
DO $$
DECLARE
  rec record;
  r28 record;
BEGIN
  SELECT * INTO r28 FROM public.fn_seoul_rolling_range(90);
  FOR rec IN
    SELECT DISTINCT rd.user_id, rd.ride_date AS summary_date
    FROM public.rides rd
    WHERE rd.ride_date BETWEEN r28.start_date AND r28.end_date
      AND public.fn_is_cycling_ride(rd)
  LOOP
    PERFORM public.fn_reconcile_daily_summary(rec.user_id, rec.summary_date);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_refresh_ranking_materialized_views'
  ) THEN
    PERFORM public.fn_refresh_ranking_materialized_views();
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_rebuild_peak_rank_board_snapshots'
  ) THEN
    PERFORM public.fn_rebuild_peak_rank_board_snapshots();
  END IF;
END $$;
