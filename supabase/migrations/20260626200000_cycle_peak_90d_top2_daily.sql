-- CYCLE 피크: 28일 4주×1피크 → 90일 창 + 일별 최고 W/kg 상위 2일 평균 (1일만 있으면 30% 페널티).
-- RUN 랭킹 SQL/로직은 변경 없음. speed_28d_kmh(60분 MMP) 창은 28일 유지.

CREATE OR REPLACE FUNCTION public.fn_cycle_peak_wkg_from_top2_daily(
  p_best_wkg numeric,
  p_second_wkg numeric,
  p_day_count integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_day_count IS NULL OR p_day_count <= 0 OR p_best_wkg IS NULL OR p_best_wkg <= 0 THEN NULL
    WHEN p_day_count = 1 THEN
      round(((p_best_wkg + p_best_wkg * 0.70) / 2.0)::numeric, 2)
    WHEN p_day_count >= 2 THEN
      round((
        (p_best_wkg + COALESCE(NULLIF(p_second_wkg, 0), p_best_wkg * 0.70)) / 2.0
      )::numeric, 2)
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.fn_cycle_peak_wkg_from_top2_daily(numeric, numeric, integer) IS
  'CYCLE 90일 피크: 일별 최고 W/kg 상위 2일 평균. 1일만 있으면 (best + best×0.70)/2 (RUN 10k 30% 페널티 대칭).';

CREATE OR REPLACE FUNCTION public.fn_cycle_peak_wkg_top2_daily_for_duration(
  p_user_id uuid,
  p_duration text,
  p_w_kg numeric,
  p_start date,
  p_end date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_best_wkg numeric;
  v_second_wkg numeric;
  v_day_count integer;
BEGIN
  IF p_w_kg IS NULL OR p_w_kg <= 0 THEN
    RETURN 0;
  END IF;

  WITH daily_raw AS (
    SELECT
      d.summary_date,
      CASE p_duration
        WHEN '1min' THEN d.max_1min_watts
        WHEN '5min' THEN d.max_5min_watts
        WHEN '10min' THEN d.max_10min_watts
        WHEN '20min' THEN d.max_20min_watts
        WHEN '40min' THEN d.max_40min_watts
        WHEN '60min' THEN d.max_60min_watts
        WHEN 'max' THEN d.max_watts
        ELSE 0::numeric
      END AS peak_watts
    FROM public.daily_summaries d
    WHERE d.user_id = p_user_id
      AND d.summary_date BETWEEN p_start AND p_end
  ),
  daily_best AS (
    SELECT summary_date, MAX(peak_watts) AS peak_watts
    FROM daily_raw
    WHERE peak_watts > 0
    GROUP BY summary_date
  ),
  validated AS (
    SELECT summary_date, peak_watts
    FROM daily_best
    WHERE public.fn_validate_peak_power(p_duration, peak_watts, p_w_kg)
  ),
  ranked AS (
    SELECT
      round((peak_watts / p_w_kg)::numeric, 2) AS wkg,
      ROW_NUMBER() OVER (ORDER BY peak_watts DESC, summary_date DESC) AS rn,
      COUNT(*) OVER ()::integer AS day_count
    FROM validated
  )
  SELECT
    MAX(wkg) FILTER (WHERE rn = 1),
    MAX(wkg) FILTER (WHERE rn = 2),
    MAX(day_count)
  INTO v_best_wkg, v_second_wkg, v_day_count
  FROM ranked;

  RETURN COALESCE(
    public.fn_cycle_peak_wkg_from_top2_daily(v_best_wkg, v_second_wkg, v_day_count),
    0
  );
END;
$$;

COMMENT ON FUNCTION public.fn_cycle_peak_wkg_top2_daily_for_duration(uuid, text, numeric, date, date) IS
  'CYCLE 90일 창: duration별 일별 최고 W/kg → 상위 2일 평균(또는 1일 30% 페널티).';

CREATE OR REPLACE FUNCTION public.fn_refresh_user_ranking_metrics(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_kg numeric;
  r90 record;
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

  SELECT * INTO r90 FROM public.fn_seoul_rolling_range(90);
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
    FOR dur IN SELECT unnest(ARRAY['1min','5min','10min','20min','40min','60min','max']) LOOP
      best_wkg := public.fn_cycle_peak_wkg_top2_daily_for_duration(
        p_user_id, dur, w_kg, r90.start_date, r90.end_date
      );
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
    r90.start_date, r90.end_date,
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
  'CYCLE 90일 일별 top2 W/kg 집계(1일 30% 페널티). speed_28d는 28일 60분 MMP 유지. RUN 미사용.';

GRANT EXECUTE ON FUNCTION public.fn_cycle_peak_wkg_from_top2_daily(numeric, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cycle_peak_wkg_from_top2_daily(numeric, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_cycle_peak_wkg_top2_daily_for_duration(uuid, text, numeric, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cycle_peak_wkg_top2_daily_for_duration(uuid, text, numeric, date, date) TO service_role;

-- 전 사용자 metrics 재집계 + MV·헵타곤 스냅샷
DO $$
DECLARE
  rec record;
  r90 record;
  n integer := 0;
BEGIN
  SELECT * INTO r90 FROM public.fn_seoul_rolling_range(90);

  FOR rec IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT m.user_id FROM public.user_ranking_metrics m
      UNION
      SELECT d.user_id
      FROM public.daily_summaries d
      WHERE d.summary_date BETWEEN r90.start_date AND r90.end_date
    ) u
    JOIN public.users usr ON usr.id = u.user_id
    WHERE usr.weight_kg > 0
  LOOP
    PERFORM public.fn_refresh_user_ranking_metrics(rec.user_id);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'cycle_peak_90d_top2_daily backfill: refreshed % users', n;
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
