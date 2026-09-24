-- GC(헵타곤) 종합 점수: 7축 균등 합(0~700) → 구간별 차등 가중 합(0~100)
--
-- 가중치 (총합 1.00) — 축 순서는 기존과 동일 ['max','1min','5min','10min','20min','40min','60min']
--   max 0.05 · 1min 0.10 · 5min 0.20 · 10min 0.15 · 20min 0.25 · 40min 0.15 · 60min 0.10
--
-- - 축별 점수 S_k 는 기존 fn_position_score_100(rank, n) 재사용: 100·(n−r)/(n−1), 미측정 축 0점
--   (RUN 리더보드도 이 함수를 쓰므로 변경하지 않음)
-- - GC = round(Σ w_k·S_k, 4)  → sum_position_scores 컬럼에 저장(0~100). avg_position_score 도 동일 값
-- - 동점: GC ↓ → 20분 축 점수 ↓ → 5분 축 점수 ↓ → user_id
-- - 기존 fn_compute_p_total_and_tier_heptagon / fn_comprehensive_rank_from_sum_position100 는 그대로 두어
--   롤백 시 fn_rebuild_heptagon_cohort_ranks 만 이전 본문으로 되돌리면 된다.
-- - fn_rebuild_heptagon_cohort_ranks 본문은 운영 DB 배포본(90일 롤링) 기준 — 20260525100100 파일(28일)은 구버전.

CREATE OR REPLACE FUNCTION public.fn_gc_axis_weights()
RETURNS numeric[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[0.05, 0.10, 0.20, 0.15, 0.25, 0.15, 0.10]::numeric[];
$$;

COMMENT ON FUNCTION public.fn_gc_axis_weights() IS
  'GC 7축 가중치 [max,1min,5min,10min,20min,40min,60min] — functions/gcWeights.js, StelvioOctagonRanksCard.jsx 와 동일해야 함';

/** GC 가중 점수(0~100) → 동일 nRef 띠 대응 종합 순위(실수). S=100 → 1위, S=0 → n위 */
CREATE OR REPLACE FUNCTION public.fn_comprehensive_rank_from_gc_score(p_score numeric, p_n_ref integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n integer := p_n_ref;
  s numeric := p_score;
  r numeric;
BEGIN
  IF n IS NULL OR n < 1 THEN
    RETURN 'NaN'::numeric;
  END IF;
  IF s IS NULL OR NOT isfinite(s) THEN
    RETURN 'NaN'::numeric;
  END IF;
  IF s < 0 THEN s := 0; END IF;
  IF s > 100 THEN s := 100; END IF;
  IF n = 1 THEN
    RETURN 1;
  END IF;
  r := 1 + (1 - s / 100.0) * (n - 1);
  IF r < 1 THEN r := 1; END IF;
  IF r > n THEN r := n; END IF;
  RETURN r;
END;
$$;

/**
 * fn_compute_p_total_and_tier_heptagon 과 동일한 반환 형태, 단 sum/avg 는 GC 가중 점수(0~100).
 */
CREATE OR REPLACE FUNCTION public.fn_compute_gc_weighted_heptagon(p_ranks integer[], p_cohort_n integer[])
RETURNS TABLE(
  position_scores100 numeric[],
  sum_position_scores numeric,
  avg_position_score numeric,
  p_tier numeric,
  tier_id text,
  n_ref integer,
  p_comprehensive numeric,
  comprehensive_rank_synthetic numeric
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i integer;
  ni integer;
  n_ref0 integer := 0;
  w numeric[] := public.fn_gc_axis_weights();
  pos_scores numeric[] := ARRAY[]::numeric[];
  gc numeric := 0;
  p_tier0 numeric;
  r_from_score numeric;
BEGIN
  IF p_ranks IS NULL OR p_cohort_n IS NULL
     OR cardinality(p_ranks) <> 7 OR cardinality(p_cohort_n) <> 7 THEN
    RETURN;
  END IF;

  FOR i IN 1..7 LOOP
    ni := GREATEST(COALESCE(p_cohort_n[i], 0), 0);
    IF ni > n_ref0 THEN n_ref0 := ni; END IF;
  END LOOP;
  IF n_ref0 < 1 THEN
    RETURN;
  END IF;

  FOR i IN 1..7 LOOP
    ni := GREATEST(COALESCE(p_cohort_n[i], 0), 0);
    IF ni < 1 THEN ni := n_ref0; END IF;
    pos_scores := pos_scores || public.fn_position_score_100(p_ranks[i], ni);
  END LOOP;

  FOR i IN 1..7 LOOP
    gc := gc + w[i] * pos_scores[i];
  END LOOP;
  gc := round(gc, 4);
  IF NOT isfinite(gc) THEN
    RETURN;
  END IF;

  p_tier0 := 100 - GREATEST(0, LEAST(100, gc));
  r_from_score := public.fn_comprehensive_rank_from_gc_score(gc, n_ref0);
  IF NOT isfinite(r_from_score) THEN
    RETURN;
  END IF;

  position_scores100 := pos_scores;
  sum_position_scores := gc;
  avg_position_score := gc;
  p_tier := p_tier0;
  tier_id := public.fn_tier_id_from_p(p_tier0, public.fn_stelvio_octagon_percent_cutoffs(n_ref0));
  n_ref := n_ref0;
  p_comprehensive := (r_from_score / n_ref0) * 100;
  comprehensive_rank_synthetic := r_from_score;
  RETURN NEXT;
END;
$$;

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
  SELECT * INTO v_range FROM public.fn_seoul_rolling_range(90);

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
    CROSS JOIN LATERAL public.fn_compute_gc_weighted_heptagon(pu.ranks, pu.cohort_n_per_axis) t
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
      'rolling90'::text AS period_mode,
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
      s.is_private,
      /* 동점: GC ↓ → 20분(축5) ↓ → 5분(축3) ↓ → user_id */
      ROW_NUMBER() OVER (
        PARTITION BY s.filter_gender, fc.filter_category
        ORDER BY s.sum_position_scores DESC,
                 s.position_scores100[5] DESC,
                 s.position_scores100[3] DESC,
                 s.user_id
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
          round(public.fn_comprehensive_rank_from_gc_score(b.sum_position_scores, b.cohort_size))::integer
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
    'peakSource', 'user_ranking_metrics_supremo_axis_90d_gc_weighted'
  );
END;
$$;
