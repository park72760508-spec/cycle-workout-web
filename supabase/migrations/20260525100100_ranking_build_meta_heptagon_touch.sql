-- fn_rebuild_heptagon_cohort_ranks 완료 시 ranking_build_meta 갱신 (기존 본문 + PERFORM 1줄)
CREATE OR REPLACE FUNCTION public.fn_rebuild_heptagon_cohort_ranks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_key text;
  v_today date;
  v_range record;
  v_wrote bigint := 0;
  v_users int;
BEGIN
  v_month_key := to_char(public.fn_seoul_today(), 'YYYY-MM');
  v_today := public.fn_seoul_today();
  SELECT * INTO v_range FROM public.fn_seoul_rolling_range(28);

  CREATE TEMP TABLE tmp_heptagon_axis ON COMMIT DROP AS
  WITH peaks AS (
    SELECT
      fg.filter_gender,
      d.duration,
      d.ord,
      m.user_id,
      public.fn_heptagon_peak_wkg(m, d.duration) AS wkg,
      COALESCE(NULLIF(btrim(p.display_name), ''), '(이름 없음)') AS display_name,
      p.league_category::text AS age_category,
      p.is_private
    FROM public.user_ranking_metrics m
    INNER JOIN public.v_user_public_profile p ON p.id = m.user_id
    CROSS JOIN (VALUES ('all'), ('M'), ('F')) AS fg(filter_gender)
    CROSS JOIN unnest(ARRAY['max','1min','5min','10min','20min','40min','60min']::text[])
      WITH ORDINALITY AS d(duration, ord)
    WHERE public.fn_heptagon_gender_matches(p.gender, fg.filter_gender)
  ),
  ranked_positive AS (
    SELECT
      *,
      (RANK() OVER (PARTITION BY filter_gender, duration ORDER BY wkg DESC, user_id))::integer AS axis_rank,
      COUNT(*) OVER (PARTITION BY filter_gender, duration)::integer AS axis_n
    FROM peaks
    WHERE wkg > 0
  ),
  axis_counts AS (
    SELECT
      filter_gender,
      duration,
      COUNT(*)::integer AS axis_n
    FROM peaks
    WHERE wkg > 0
    GROUP BY filter_gender, duration
  )
  SELECT
    p.filter_gender,
    p.duration,
    p.ord,
    p.user_id,
    p.wkg,
    p.display_name,
    p.age_category,
    p.is_private,
    rp.axis_rank,
    COALESCE(rp.axis_n, ac.axis_n, 0)::integer AS axis_n
  FROM peaks p
  LEFT JOIN ranked_positive rp
    ON rp.filter_gender = p.filter_gender
   AND rp.duration = p.duration
   AND rp.user_id = p.user_id
  LEFT JOIN axis_counts ac
    ON ac.filter_gender = p.filter_gender
   AND ac.duration = p.duration;

  CREATE TEMP TABLE tmp_heptagon_sup_rows ON COMMIT DROP AS
  WITH per_user AS (
    SELECT
      filter_gender,
      user_id,
      MAX(display_name) AS display_name,
      MAX(age_category) AS age_category,
      bool_or(is_private) AS is_private,
      array_agg(axis_rank ORDER BY ord) AS ranks,
      array_agg(axis_n ORDER BY ord) AS cohort_n_per_axis
    FROM tmp_heptagon_axis
    GROUP BY filter_gender, user_id
    HAVING COUNT(*) = 7
       AND bool_or(axis_rank IS NOT NULL)
  ),
  scored AS (
    SELECT
      pu.*,
      t.position_scores100,
      t.sum_position_scores,
      t.avg_position_score,
      t.p_tier,
      t.tier_id,
      t.n_ref,
      t.p_comprehensive,
      t.comprehensive_rank_synthetic
    FROM per_user pu
    CROSS JOIN LATERAL public.fn_compute_p_total_and_tier_heptagon(pu.ranks, pu.cohort_n_per_axis) t
    WHERE t.sum_position_scores IS NOT NULL
  )
  SELECT * FROM scored;

  SELECT COUNT(DISTINCT user_id)::int INTO v_users FROM tmp_heptagon_sup_rows;
  IF v_users < 1 THEN
    RAISE EXCEPTION 'heptagon_cohort_ranks_zero_writes(users=0 asOf=%)', v_today;
  END IF;

  WITH boards AS (
    SELECT
      v_month_key AS month_key,
      'rolling28'::text AS period_mode,
      v_range.start_date AS range_start,
      v_range.end_date AS range_end,
      v_today AS as_of_seoul,
      s.user_id,
      s.display_name,
      s.age_category,
      fc.filter_category,
      s.filter_gender,
      s.sum_position_scores,
      s.avg_position_score,
      s.position_scores100,
      s.ranks,
      s.cohort_n_per_axis,
      s.p_tier,
      s.tier_id AS axis_tier_id,
      s.n_ref AS axis_n_ref,
      s.p_comprehensive AS axis_p_comprehensive,
      s.comprehensive_rank_synthetic AS axis_cr_synth,
      s.is_private,
      ROW_NUMBER() OVER (
        PARTITION BY s.filter_gender, fc.filter_category
        ORDER BY s.sum_position_scores DESC, s.user_id
      )::integer AS board_rank,
      COUNT(*) OVER (PARTITION BY s.filter_gender, fc.filter_category)::integer AS cohort_size
    FROM tmp_heptagon_sup_rows s
    CROSS JOIN (
      SELECT unnest(ARRAY['Supremo','Assoluto','Bianco','Rosa','Infinito','Leggenda']) AS filter_category
    ) fc
    WHERE public.fn_heptagon_is_in_cohort(fc.filter_category, s.age_category)
  ),
  upserted AS (
    INSERT INTO public.heptagon_cohort_ranks (
      doc_id,
      month_key,
      period_mode,
      range_start,
      range_end,
      as_of_seoul,
      user_id,
      display_name,
      age_category,
      filter_category,
      filter_gender,
      board_rank,
      comprehensive_rank,
      sum_position_scores,
      avg_position_score,
      position_scores100,
      ranks,
      cohort_n_per_axis,
      p_tier,
      tier_id,
      n_ref,
      p_comprehensive,
      comprehensive_rank_synthetic,
      is_private,
      previous_board_rank,
      rank_change,
      yesterday_official_board_rank,
      updated_at,
      rebuilt_at
    )
    SELECT
      replace(
        format('%s_%s_%s_%s', b.month_key, b.filter_category, b.filter_gender, b.user_id),
        '/',
        '_'
      ),
      b.month_key,
      b.period_mode,
      b.range_start,
      b.range_end,
      b.as_of_seoul,
      b.user_id,
      b.display_name,
      b.age_category,
      b.filter_category,
      b.filter_gender,
      b.board_rank,
      b.board_rank,
      b.sum_position_scores,
      b.avg_position_score,
      b.position_scores100,
      b.ranks,
      b.cohort_n_per_axis,
      public.fn_heptagon_level_percent_for_rank_n(b.board_rank, b.cohort_size),
      public.fn_heptagon_cohort_board_tier_id(
        public.fn_heptagon_level_percent_for_rank_n(b.board_rank, b.cohort_size)
      ),
      b.cohort_size,
      public.fn_heptagon_level_percent_for_rank_n(b.board_rank, b.cohort_size),
      GREATEST(
        1,
        LEAST(
          b.cohort_size,
          round(
            public.fn_comprehensive_rank_from_sum_position100(
              b.sum_position_scores,
              b.cohort_size
            )
          )::integer
        )
      ),
      b.is_private,
      NULL,
      NULL,
      NULL,
      now(),
      now()
    FROM boards b
    ON CONFLICT (doc_id) DO UPDATE SET
      month_key = EXCLUDED.month_key,
      period_mode = EXCLUDED.period_mode,
      range_start = EXCLUDED.range_start,
      range_end = EXCLUDED.range_end,
      as_of_seoul = EXCLUDED.as_of_seoul,
      display_name = EXCLUDED.display_name,
      age_category = EXCLUDED.age_category,
      board_rank = EXCLUDED.board_rank,
      comprehensive_rank = EXCLUDED.comprehensive_rank,
      sum_position_scores = EXCLUDED.sum_position_scores,
      avg_position_score = EXCLUDED.avg_position_score,
      position_scores100 = EXCLUDED.position_scores100,
      ranks = EXCLUDED.ranks,
      cohort_n_per_axis = EXCLUDED.cohort_n_per_axis,
      p_tier = EXCLUDED.p_tier,
      tier_id = EXCLUDED.tier_id,
      n_ref = EXCLUDED.n_ref,
      p_comprehensive = EXCLUDED.p_comprehensive,
      comprehensive_rank_synthetic = EXCLUDED.comprehensive_rank_synthetic,
      is_private = EXCLUDED.is_private,
      yesterday_official_board_rank = CASE
        WHEN heptagon_cohort_ranks.as_of_seoul IS DISTINCT FROM EXCLUDED.as_of_seoul
          AND heptagon_cohort_ranks.as_of_seoul IS NOT NULL
        THEN heptagon_cohort_ranks.board_rank
        ELSE heptagon_cohort_ranks.yesterday_official_board_rank
      END,
      previous_board_rank = CASE
        WHEN heptagon_cohort_ranks.as_of_seoul IS DISTINCT FROM EXCLUDED.as_of_seoul
          AND heptagon_cohort_ranks.as_of_seoul IS NOT NULL
        THEN heptagon_cohort_ranks.board_rank
        WHEN heptagon_cohort_ranks.yesterday_official_board_rank IS NOT NULL
        THEN heptagon_cohort_ranks.yesterday_official_board_rank
        ELSE heptagon_cohort_ranks.previous_board_rank
      END,
      rank_change = CASE
        WHEN heptagon_cohort_ranks.as_of_seoul IS DISTINCT FROM EXCLUDED.as_of_seoul
          AND heptagon_cohort_ranks.as_of_seoul IS NOT NULL
          AND heptagon_cohort_ranks.board_rank IS NOT NULL
        THEN heptagon_cohort_ranks.board_rank - EXCLUDED.board_rank
        WHEN heptagon_cohort_ranks.yesterday_official_board_rank IS NOT NULL
        THEN heptagon_cohort_ranks.yesterday_official_board_rank - EXCLUDED.board_rank
        ELSE heptagon_cohort_ranks.rank_change
      END,
      updated_at = now(),
      rebuilt_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::bigint INTO v_wrote FROM upserted;

  IF v_wrote < 1 THEN
    RAISE EXCEPTION 'heptagon_cohort_ranks_zero_writes(users=% asOf=%)', v_users, v_today;
  END IF;

  PERFORM public.fn_touch_ranking_build_meta('heptagon_daily_rebuild', 'complete', NULL);

  RETURN jsonb_build_object(
    'monthKey', v_month_key,
    'startStr', v_range.start_date,
    'endStr', v_range.end_date,
    'wrote', v_wrote,
    'users', v_users,
    'asOfSeoul', v_today,
    'peakSource', 'user_ranking_metrics_supremo_axis'
  );
END;
$$;
