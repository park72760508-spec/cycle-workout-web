-- =============================================================================
-- 4b) 헵타곤(GC) 코호트 랭킹 — Firestore heptagon_cohort_ranks + runRebuildHeptagonCohortRanks 대체
-- 7축 sumPositionScores는 항상 Supremo 보드(28일 롤링 피크 W/kg) 기준.
-- pg_cron으로 주기 갱신(15분) — Firebase 03:20 스냅샷 시각은 모방하지 않음.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 테이블 (Firestore heptagon_cohort_ranks 문서 필드 대응)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.heptagon_cohort_ranks (
  doc_id                          text PRIMARY KEY,
  month_key                       text NOT NULL,
  period_mode                     text NOT NULL DEFAULT 'rolling28',
  range_start                     date NOT NULL,
  range_end                       date NOT NULL,
  as_of_seoul                     date NOT NULL,
  user_id                         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name                    text NOT NULL DEFAULT '',
  age_category                    text NOT NULL,
  filter_category                 text NOT NULL,
  filter_gender                   text NOT NULL CHECK (filter_gender IN ('all', 'M', 'F')),
  board_rank                      integer NOT NULL CHECK (board_rank >= 1),
  comprehensive_rank              integer NOT NULL CHECK (comprehensive_rank >= 1),
  sum_position_scores             numeric(10,4) NOT NULL,
  avg_position_score              numeric(10,4) NOT NULL,
  position_scores100              numeric(10,4)[] NOT NULL CHECK (cardinality(position_scores100) = 7),
  ranks                           integer[] NOT NULL CHECK (cardinality(ranks) = 7),
  cohort_n_per_axis               integer[] NOT NULL CHECK (cardinality(cohort_n_per_axis) = 7),
  p_tier                          numeric(10,4) NOT NULL,
  tier_id                         text NOT NULL,
  n_ref                           integer NOT NULL CHECK (n_ref >= 1),
  p_comprehensive                 numeric(10,4) NOT NULL,
  comprehensive_rank_synthetic    integer,
  is_private                      boolean NOT NULL DEFAULT false,
  previous_board_rank             integer,
  rank_change                     integer,
  yesterday_official_board_rank   integer,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  rebuilt_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heptagon_cohort_month_cat_gender_rank
  ON public.heptagon_cohort_ranks (month_key, filter_category, filter_gender, board_rank);

CREATE INDEX IF NOT EXISTS idx_heptagon_cohort_user_month
  ON public.heptagon_cohort_ranks (user_id, month_key);

COMMENT ON TABLE public.heptagon_cohort_ranks IS
  'Firestore heptagon_cohort_ranks — 월·부문·성별 코호트 헵타곤 보드 (Dual-Write 후 읽기 전환 대상)';

-- -----------------------------------------------------------------------------
-- 2. 헬퍼 (functions/heptagonCohortRanks.js 동일 수식)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.isfinite(p_value numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_value IS NOT NULL
    AND p_value::text NOT IN ('NaN', 'Infinity', '-Infinity');
$$;

CREATE OR REPLACE FUNCTION public.fn_heptagon_peak_wkg(
  m public.user_ranking_metrics,
  p_duration text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_duration
    WHEN 'max' THEN COALESCE(m.peak_max_wkg, 0)
    WHEN '1min' THEN COALESCE(m.peak_1min_wkg, 0)
    WHEN '5min' THEN COALESCE(m.peak_5min_wkg, 0)
    WHEN '10min' THEN COALESCE(m.peak_10min_wkg, 0)
    WHEN '20min' THEN COALESCE(m.peak_20min_wkg, 0)
    WHEN '40min' THEN COALESCE(m.peak_40min_wkg, 0)
    WHEN '60min' THEN COALESCE(m.peak_60min_wkg, 0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_heptagon_gender_matches(
  p_gender public.gender_code,
  p_filter text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_filter IS NULL OR p_filter = 'all' THEN true
    WHEN p_filter = 'M' THEN p_gender = 'male'::public.gender_code
    WHEN p_filter = 'F' THEN p_gender = 'female'::public.gender_code
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_heptagon_is_in_cohort(
  p_filter_category text,
  p_league_category text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_filter_category = 'Supremo' THEN true
    WHEN p_filter_category = 'Assoluto' THEN p_league_category = 'Assoluto'
    WHEN p_league_category IS NULL OR btrim(p_league_category) = '' THEN false
    ELSE p_league_category = p_filter_category
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_position_score_100(p_rank integer, p_n integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ni integer := p_n;
  r integer;
BEGIN
  IF ni < 1 THEN
    RETURN 0;
  END IF;
  IF p_rank IS NULL OR p_rank < 1 THEN
    RETURN 0;
  END IF;
  r := floor(p_rank::numeric)::integer;
  IF r < 1 THEN r := 1; END IF;
  IF r > ni THEN r := ni; END IF;
  IF ni = 1 THEN
    RETURN 100;
  END IF;
  RETURN (100.0 * (ni - r)) / (ni - 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_effective_rank_for_average(p_rank integer, p_n integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  nn integer := p_n;
  r integer;
BEGIN
  IF nn < 1 THEN
    RETURN NULL;
  END IF;
  IF p_rank IS NULL OR p_rank < 1 THEN
    RETURN nn;
  END IF;
  r := floor(p_rank::numeric)::integer;
  IF r < 1 THEN r := 1; END IF;
  IF r > nn THEN r := nn; END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_stelvio_octagon_small_group_k(p_n integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n integer := GREATEST(p_n, 1);
BEGIN
  IF n >= 100 THEN
    RETURN 1;
  END IF;
  RETURN 1 + (100.0 - n) / (100.0 + n);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_stelvio_octagon_percent_cutoffs(p_n_ref integer)
RETURNS numeric[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n integer := GREATEST(p_n_ref, 1);
  k numeric;
  bases numeric[] := ARRAY[5, 10, 20, 40, 60, 80];
  cut numeric[] := ARRAY[]::numeric[];
  i integer;
  b numeric;
  sc numeric;
  fl numeric;
  v numeric;
BEGIN
  IF n >= 100 THEN
    RETURN ARRAY[5, 10, 20, 40, 60, 80];
  END IF;
  k := public.fn_stelvio_octagon_small_group_k(n);
  FOR i IN 1..6 LOOP
    b := bases[i];
    sc := b * k;
    IF sc > 100 THEN sc := 100; END IF;
    fl := (b / 5.0) * (100.0 / n);
    v := GREATEST(sc, fl);
    IF v > 100 THEN v := 100; END IF;
    IF i > 1 AND v <= cut[i - 1] THEN
      v := cut[i - 1] + 0.0001;
      IF v > 100 THEN v := 100; END IF;
      IF v <= cut[i - 1] THEN v := 100; END IF;
    END IF;
    cut := cut || v;
  END LOOP;
  RETURN cut;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tier_id_from_p(p_total numeric, p_cutoffs numeric[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_total <= p_cutoffs[1] THEN 'HC'
    WHEN p_total <= p_cutoffs[2] THEN 'C1'
    WHEN p_total <= p_cutoffs[3] THEN 'C2'
    WHEN p_total <= p_cutoffs[4] THEN 'C3'
    WHEN p_total <= p_cutoffs[5] THEN 'C4'
    WHEN p_total <= p_cutoffs[6] THEN 'C5'
    ELSE 'C6'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_heptagon_level_percent_for_rank_n(
  p_board_rank integer,
  p_n_cohort integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  nc integer := GREATEST(p_n_cohort, 1);
  r integer;
  n2 numeric;
BEGIN
  r := COALESCE(floor(p_board_rank::numeric)::integer, 1);
  IF r < 1 THEN r := 1; END IF;
  IF r > nc THEN r := nc; END IF;
  IF nc >= 100 THEN
    RETURN (r::numeric / nc) * 100;
  END IF;
  n2 := 100.0 / nc;
  RETURN ((r::numeric / nc) / n2) * 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_heptagon_cohort_board_tier_id(p_level numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_level IS NULL OR NOT public.isfinite(p_level) THEN 'C6'
    WHEN p_level <= 3 THEN 'HC'
    WHEN p_level <= 7 THEN 'C1'
    WHEN p_level <= 20 THEN 'C2'
    WHEN p_level <= 40 THEN 'C3'
    WHEN p_level <= 60 THEN 'C4'
    WHEN p_level <= 90 THEN 'C5'
    ELSE 'C6'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_comprehensive_rank_from_sum_position100(
  p_sum0to700 numeric,
  p_n_ref integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n integer := p_n_ref;
  s numeric;
  r numeric;
BEGIN
  IF n < 1 THEN
    RETURN 'NaN'::numeric;
  END IF;
  s := p_sum0to700;
  IF s IS NULL OR NOT public.isfinite(s) THEN
    RETURN 'NaN'::numeric;
  END IF;
  IF s < 0 THEN s := 0; END IF;
  IF s > 700 THEN s := 700; END IF;
  IF n = 1 THEN
    RETURN 1;
  END IF;
  r := 1 + (1 - s / 700.0) * (n - 1);
  IF r < 1 THEN r := 1; END IF;
  IF r > n THEN r := n; END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_compute_p_total_and_tier_heptagon(
  p_ranks integer[],
  p_cohort_n integer[]
)
RETURNS TABLE (
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
  pos_scores numeric[] := ARRAY[]::numeric[];
  sum_pos numeric := 0;
  avg_pos numeric;
  p_tier0 numeric;
  cutoffs numeric[];
  tier0 text;
  r_from_sum numeric;
BEGIN
  IF p_ranks IS NULL OR p_cohort_n IS NULL
     OR cardinality(p_ranks) <> 7 OR cardinality(p_cohort_n) <> 7 THEN
    RETURN;
  END IF;

  FOR i IN 1..7 LOOP
    ni := GREATEST(p_cohort_n[i], 0);
    IF ni > n_ref0 THEN n_ref0 := ni; END IF;
  END LOOP;
  IF n_ref0 < 1 THEN
    RETURN;
  END IF;

  FOR i IN 1..7 LOOP
    ni := GREATEST(p_cohort_n[i], 0);
    IF ni < 1 THEN ni := n_ref0; END IF;
    IF public.fn_effective_rank_for_average(p_ranks[i], ni) IS NULL THEN
      RETURN;
    END IF;
    pos_scores := pos_scores || public.fn_position_score_100(p_ranks[i], ni);
  END LOOP;

  FOR i IN 1..7 LOOP
    sum_pos := sum_pos + pos_scores[i];
  END LOOP;
  avg_pos := sum_pos / 7.0;
  IF NOT public.isfinite(avg_pos) THEN
    RETURN;
  END IF;

  p_tier0 := 100 - GREATEST(0, LEAST(100, avg_pos));
  cutoffs := public.fn_stelvio_octagon_percent_cutoffs(n_ref0);
  tier0 := public.fn_tier_id_from_p(p_tier0, cutoffs);
  r_from_sum := public.fn_comprehensive_rank_from_sum_position100(sum_pos, n_ref0);
  IF NOT public.isfinite(r_from_sum) THEN
    RETURN;
  END IF;

  position_scores100 := pos_scores;
  sum_position_scores := sum_pos;
  avg_position_score := avg_pos;
  p_tier := p_tier0;
  tier_id := tier0;
  n_ref := n_ref0;
  p_comprehensive := CASE WHEN n_ref0 >= 1 THEN (r_from_sum / n_ref0) * 100 ELSE p_tier0 END;
  comprehensive_rank_synthetic := r_from_sum;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. 전체 재집계 (SECURITY DEFINER — pg_cron·service_role)
-- -----------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.fn_rebuild_heptagon_cohort_ranks IS
  '28일 롤링 피크(user_ranking_metrics) → heptagon_cohort_ranks 전량 UPSERT. pg_cron 15분 권장.';

GRANT SELECT ON public.heptagon_cohort_ranks TO authenticated;
GRANT ALL ON public.heptagon_cohort_ranks TO service_role;

ALTER TABLE public.heptagon_cohort_ranks ENABLE ROW LEVEL SECURITY;

CREATE POLICY heptagon_cohort_ranks_select_authenticated ON public.heptagon_cohort_ranks
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY heptagon_cohort_ranks_no_client_write ON public.heptagon_cohort_ranks
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- 4. pg_cron — 헵타곤 재집계 (15분, 특정 야간 시각 미모방)
-- -----------------------------------------------------------------------------
DO $cron_hept$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'stelvio_rebuild_heptagon_cohort_ranks';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'stelvio_rebuild_heptagon_cohort_ranks',
    '*/15 * * * *',
    $cmd$SELECT public.fn_rebuild_heptagon_cohort_ranks();$cmd$
  );
END;
$cron_hept$;

-- 초기 1회 적재 (빈 테이블 방지 — rides·metrics 데이터가 있을 때만 성공)
DO $init_hept$
BEGIN
  PERFORM public.fn_rebuild_heptagon_cohort_ranks();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'heptagon initial rebuild skipped: %', SQLERRM;
END;
$init_hept$;
