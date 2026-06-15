-- peak_rank_board_snapshots: 탈퇴(account_status <> active) 사용자를 모수·스냅샷에서 제외.
-- 전일 336명(탈퇴 포함) vs 오늘 331명 허위 등락 방지 — 양일 모두 active 만 집계.

CREATE OR REPLACE FUNCTION public.fn_rebuild_peak_rank_board_snapshot_from_rows(
  p_history_key text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today date := public.fn_seoul_date_kst();
  categories text[] := ARRAY['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
  cat text;
  prev record;
  curr_map jsonb;
  prev_ranks_cat jsonb;
  prev_day_in jsonb;
  frozen_prev_day jsonb;
  baseline jsonb;
  ranks_by_cat jsonb := '{}'::jsonb;
  changes_by_cat jsonb := '{}'::jsonb;
  previous_by_cat jsonb := '{}'::jsonb;
  prev_day_by_cat jsonb := '{}'::jsonb;
  uid text;
  curr_rank_text text;
  prev_rank integer;
  change_map jsonb;
  previous_map jsonb;
  survivor_prev jsonb;
BEGIN
  IF p_history_key IS NULL OR btrim(p_history_key) = '' THEN
    RAISE EXCEPTION 'history_key required';
  END IF;

  SELECT *
    INTO prev
  FROM public.peak_rank_board_snapshots
  WHERE history_key = p_history_key;

  FOREACH cat IN ARRAY categories LOOP
    WITH src AS (
      SELECT
        r->>'firebase_uid' AS firebase_uid,
        COALESCE(NULLIF(r->>'league_category', ''), 'Supremo') AS league_category,
        NULLIF(r->>'score', '')::numeric AS score
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
      WHERE r->>'firebase_uid' IS NOT NULL
        AND btrim(r->>'firebase_uid') <> ''
        AND NULLIF(r->>'score', '')::numeric > 0
    ),
    ranked AS (
      SELECT
        firebase_uid,
        row_number() OVER (ORDER BY score DESC, firebase_uid ASC) AS board_rank
      FROM src
      WHERE cat = 'Supremo'
         OR league_category = cat
    )
    SELECT COALESCE(jsonb_object_agg(firebase_uid, board_rank), '{}'::jsonb)
      INTO curr_map
    FROM ranked;

    IF curr_map = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    prev_ranks_cat := COALESCE(prev.ranks_by_category -> cat, '{}'::jsonb);
    prev_day_in := COALESCE(prev.prev_day_ranks_by_category -> cat, '{}'::jsonb);

    IF (prev.as_of_seoul IS NULL OR prev.as_of_seoul < today) AND prev_ranks_cat <> '{}'::jsonb THEN
      frozen_prev_day := prev_ranks_cat;
    ELSE
      frozen_prev_day := prev_day_in;
    END IF;

    IF frozen_prev_day <> '{}'::jsonb THEN
      baseline := frozen_prev_day;
    ELSE
      baseline := prev_ranks_cat;
    END IF;

    /* 생존 코호트: 오늘 목록에 있는 uid만 — 전일 baseline 내 탈퇴·이탈자 순위는 모수에서 제외 */
    survivor_prev := '{}'::jsonb;
    IF baseline <> '{}'::jsonb THEN
      WITH survivors AS (
        SELECT key AS firebase_uid, NULLIF(baseline ->> key, '')::integer AS prev_abs_rank
        FROM jsonb_each_text(baseline) AS b(key, value)
        WHERE curr_map ? key
          AND NULLIF(baseline ->> key, '')::integer >= 1
      ),
      ordered AS (
        SELECT firebase_uid, prev_abs_rank,
               row_number() OVER (ORDER BY prev_abs_rank ASC, firebase_uid ASC) AS survivor_rank
        FROM survivors
      )
      SELECT COALESCE(jsonb_object_agg(firebase_uid, survivor_rank), '{}'::jsonb)
        INTO survivor_prev
      FROM ordered;
    END IF;

    change_map := '{}'::jsonb;
    previous_map := '{}'::jsonb;

    FOR uid, curr_rank_text IN
      SELECT key, value FROM jsonb_each_text(curr_map)
    LOOP
      IF survivor_prev ? uid THEN
        prev_rank := NULLIF(survivor_prev ->> uid, '')::integer;
        IF prev_rank IS NOT NULL AND prev_rank >= 1 THEN
          change_map := change_map || jsonb_build_object(uid, prev_rank - curr_rank_text::integer);
          previous_map := previous_map || jsonb_build_object(uid, prev_rank);
        END IF;
      END IF;
    END LOOP;

    ranks_by_cat := ranks_by_cat || jsonb_build_object(cat, curr_map);
    changes_by_cat := changes_by_cat || jsonb_build_object(cat, change_map);
    previous_by_cat := previous_by_cat || jsonb_build_object(cat, previous_map);
    prev_day_by_cat := prev_day_by_cat || jsonb_build_object(cat, frozen_prev_day);
  END LOOP;

  INSERT INTO public.peak_rank_board_snapshots (
    history_key,
    as_of_seoul,
    ranks_by_category,
    rank_changes_by_category,
    previous_ranks_by_category,
    prev_day_ranks_by_category,
    updated_at
  )
  VALUES (
    p_history_key,
    today,
    ranks_by_cat,
    changes_by_cat,
    previous_by_cat,
    prev_day_by_cat,
    now()
  )
  ON CONFLICT (history_key) DO UPDATE SET
    as_of_seoul = EXCLUDED.as_of_seoul,
    ranks_by_category = EXCLUDED.ranks_by_category,
    rank_changes_by_category = EXCLUDED.rank_changes_by_category,
    previous_ranks_by_category = EXCLUDED.previous_ranks_by_category,
    prev_day_ranks_by_category = EXCLUDED.prev_day_ranks_by_category,
    updated_at = now();
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
  week_start date := public.fn_effective_week_start_kst();
  week_end date := public.fn_effective_week_start_kst() + 6;
  dist_start date := public.fn_seoul_date_kst() - 29;
  dist_end date := public.fn_seoul_date_kst();
BEGIN
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
