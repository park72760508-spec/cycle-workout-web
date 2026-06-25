-- 사이클 주간 TSS: ISO 주 월요일 ~ 오늘(진행 중 주) — RUN fn_seoul_week_range(월~일)와 분리
-- Stelvio 로그 Supabase 동기화·ride_date 보정 후 daily_summaries 재집계용

CREATE OR REPLACE FUNCTION public.fn_seoul_week_tss_range()
RETURNS TABLE (week_start date, week_end date)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today date := public.fn_seoul_today();
  v_dow   integer;
  v_mon   date;
BEGIN
  v_dow := EXTRACT(ISODOW FROM v_today)::integer;
  IF v_dow = 7 THEN
    v_mon := v_today - 6;
  ELSE
    v_mon := v_today - (v_dow - 1);
  END IF;
  week_start := v_mon;
  week_end := LEAST(v_mon + 6, v_today);
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_seoul_week_tss_range() IS
  '사이클 주간 TSS 랭킹·TOP10: 월요일~오늘. RUN 주간 TSS는 fn_seoul_week_range + week_sum_as_of';

GRANT EXECUTE ON FUNCTION public.fn_seoul_week_tss_range() TO authenticated, service_role;

-- fn_refresh_user_ranking_metrics: 주간 TSS만 TSS 범위(월~오늘) 사용
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

CREATE OR REPLACE FUNCTION public.fn_rebuild_peak_rank_board_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  genders text[] := ARRAY['all', 'M', 'F'];
  g text;
  dur record;
  rows_payload jsonb;
  rw record;
  week_start date;
  week_end date;
  dist_start date := public.fn_seoul_date_kst() - 29;
  dist_end date := public.fn_seoul_date_kst();
BEGIN
  SELECT * INTO rw FROM public.fn_seoul_week_tss_range();
  week_start := rw.week_start;
  week_end := rw.week_end;

  FOR g IN SELECT unnest(genders) LOOP
    FOR dur IN
      SELECT * FROM (VALUES
        ('max', 'peak_max_wkg'),
        ('1min', 'peak_1min_wkg'),
        ('5min', 'peak_5min_wkg'),
        ('10min', 'peak_10min_wkg'),
        ('20min', 'peak_20min_wkg'),
        ('40min', 'peak_40min_wkg'),
        ('60min', 'peak_60min_wkg')
      ) AS d(duration_type, score_column)
    LOOP
      EXECUTE format(
        $fmt$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'firebase_uid', u.firebase_uid,
          'league_category', mv.league_category,
          'score', %1$I
        )), '[]'::jsonb)
        FROM public.mv_leaderboard_peak_28d mv
        JOIN public.users u ON u.id = mv.user_id
        WHERE %1$I > 0
          AND u.firebase_uid IS NOT NULL
          AND u.account_status = 'active'
          AND ($1 = 'all'
            OR ($1 = 'M' AND mv.gender = 'male')
            OR ($1 = 'F' AND mv.gender = 'female'))
        $fmt$,
        dur.score_column
      )
      INTO rows_payload
      USING g;

      PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
        format('peak_%s_monthly_%s', dur.duration_type, g),
        rows_payload
      );
    END LOOP;

    WITH weekly AS (
      SELECT
        d.user_id,
        ROUND(COALESCE(SUM(public.fn_effective_day_tss(d)), 0)::numeric, 2) AS weekly_tss,
        COALESCE(bool_or(
          (COALESCE(d.tss_strava_sum, 0) > 0 AND d.tss_strava_sum >= 500)
          OR (COALESCE(d.tss_strava_sum, 0) = 0 AND COALESCE(d.tss_stelvio_sum, 0) >= 500)
        ), false) AS weekly_has_cheat_day
      FROM public.daily_summaries d
      WHERE d.summary_date BETWEEN week_start AND week_end
      GROUP BY d.user_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', p.firebase_uid,
      'league_category', p.league_category,
      'score', w.weekly_tss
    )), '[]'::jsonb)
      INTO rows_payload
    FROM weekly w
    JOIN public.v_user_public_profile p ON p.id = w.user_id
    WHERE w.weekly_tss > 0
      AND w.weekly_has_cheat_day = false
      AND p.firebase_uid IS NOT NULL
      AND (g = 'all'
        OR (g = 'M' AND p.gender = 'male')
        OR (g = 'F' AND p.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_tss_weekly_%s', g),
      rows_payload
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', u.firebase_uid,
      'league_category', mv.league_category,
      'score', mv.distance_30d_km
    )), '[]'::jsonb)
      INTO rows_payload
    FROM public.mv_leaderboard_distance_30d mv
    JOIN public.users u ON u.id = mv.user_id
    WHERE mv.distance_30d_km > 0
      AND u.firebase_uid IS NOT NULL
      AND u.account_status = 'active'
      AND (g = 'all'
        OR (g = 'M' AND mv.gender = 'male')
        OR (g = 'F' AND mv.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_personal_dist_rolling30_%s', g),
      rows_payload
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', u.firebase_uid,
      'league_category', mv.league_category,
      'score', mv.speed_28d_kmh
    )), '[]'::jsonb)
      INTO rows_payload
    FROM public.mv_leaderboard_speed_28d mv
    JOIN public.users u ON u.id = mv.user_id
    WHERE mv.speed_28d_kmh > 0
      AND u.firebase_uid IS NOT NULL
      AND u.account_status = 'active'
      AND (g = 'all'
        OR (g = 'M' AND mv.gender = 'male')
        OR (g = 'F' AND mv.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_personal_speed_rolling28d_%s', g),
      rows_payload
    );
  END LOOP;
END;
$$;

-- 배포 직후 MV·TSS 스냅샷 재집계
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
