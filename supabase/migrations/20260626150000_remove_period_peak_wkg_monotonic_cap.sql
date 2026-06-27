-- 28일 창 기간 합산(4주×duration별 최고) 후 cross-duration W/kg monotonic cap 제거.
-- 라이드·일별 fn_sanitize_peak_power_watts 는 유지 (동일 활동 MMP 프로파일 보정).
-- fn_cap_peak_wkg_monotonic 함수는 남겨두되 랭킹 metrics 집계에서는 호출하지 않음.

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
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    DELETE FROM public.user_ranking_metrics WHERE user_id = p_user_id;
    RETURN;
  END IF;

  w_kg := CASE WHEN u.weight_kg > 0 THEN GREATEST(u.weight_kg, 45) ELSE NULL END;

  SELECT * INTO r28 FROM public.fn_seoul_rolling_range(28);
  SELECT * INTO r30 FROM public.fn_seoul_rolling_range(30);
  SELECT * INTO rw FROM public.fn_seoul_week_tss_range();

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

COMMENT ON FUNCTION public.fn_refresh_user_ranking_metrics(uuid) IS
  '28일 4주×duration 피크 W/kg 집계. 기간 합산 후 cross-duration cap 없음(라이드/일별 sanitize만).';
