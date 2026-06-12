-- RUN 랭킹보드 일 1회(23:00 KST) 스냅샷 집계 — 전일 순위 대비 등락
-- peak_rank_board_snapshots 테이블 재사용 (history_key 접두사 run_)

CREATE OR REPLACE FUNCTION public.fn_parse_running_pace_mmss(p_pace text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_pace IS NULL OR btrim(p_pace) IN ('', '—', '-', '–') THEN NULL
    WHEN position(':' IN p_pace) > 0 THEN
      (NULLIF(split_part(p_pace, ':', 1), '')::numeric * 60)
      + NULLIF(split_part(p_pace, ':', 2), '')::numeric
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.fn_parse_running_pace_mmss(text) IS
  '러닝 페이스 문자열(M:SS) → 초/km. 없으면 NULL.';

CREATE OR REPLACE FUNCTION public.fn_run_leaderboard_score_rows(
  p_leaderboard jsonb,
  p_gender text,
  p_metric text,
  p_pace_dist text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', sub.user_id,
        'age_category', sub.age_category,
        'league_category', sub.league_category,
        'score', sub.score_val
      )
      ORDER BY sub.score_val DESC, sub.user_id ASC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      r->'user_info'->>'user_id' AS user_id,
      COALESCE(NULLIF(btrim(r->'user_info'->>'age_category'), ''), 'Supremo') AS age_category,
      COALESCE(NULLIF(btrim(r->'user_info'->>'league_category'), ''), 'Supremo') AS league_category,
      CASE p_metric
        WHEN 'overall' THEN NULLIF(r->>'total_score', '')::numeric
        WHEN 'tss' THEN NULLIF(r->>'weekly_tss', '')::numeric
        WHEN 'distance' THEN NULLIF(r->>'distance_30d_km', '')::numeric
        WHEN 'pace' THEN
          CASE
            WHEN public.fn_parse_running_pace_mmss(r->'peak_performances'->p_pace_dist->>'pace') IS NOT NULL THEN
              -public.fn_parse_running_pace_mmss(r->'peak_performances'->p_pace_dist->>'pace')
            ELSE NULL
          END
        ELSE NULL
      END AS score_val
    FROM jsonb_array_elements(COALESCE(p_leaderboard, '[]'::jsonb)) AS r
    WHERE COALESCE((r->'user_info'->>'is_private')::boolean, false) = false
      AND r->'user_info'->>'user_id' IS NOT NULL
      AND btrim(r->'user_info'->>'user_id') <> ''
      AND (
        COALESCE(NULLIF(btrim(p_gender), ''), 'all') = 'all'
        OR (p_gender = 'M' AND r->'user_info'->>'gender' = 'male')
        OR (p_gender = 'F' AND r->'user_info'->>'gender' = 'female')
      )
  ) sub
  WHERE sub.score_val IS NOT NULL
    AND (
      (p_metric = 'pace' AND sub.score_val < 0)
      OR (p_metric <> 'pace' AND sub.score_val > 0)
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(
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
        r->>'user_id' AS user_id,
        COALESCE(NULLIF(btrim(r->>'age_category'), ''), 'Supremo') AS age_category,
        NULLIF(r->>'score', '')::numeric AS score
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
      WHERE r->>'user_id' IS NOT NULL
        AND btrim(r->>'user_id') <> ''
        AND NULLIF(r->>'score', '')::numeric IS NOT NULL
    ),
    ranked AS (
      SELECT
        user_id,
        row_number() OVER (ORDER BY score DESC, user_id ASC) AS board_rank
      FROM src
      WHERE cat = 'Supremo'
         OR age_category = cat
    )
    SELECT COALESCE(jsonb_object_agg(user_id, board_rank), '{}'::jsonb)
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

    change_map := '{}'::jsonb;
    previous_map := '{}'::jsonb;

    FOR uid, curr_rank_text IN
      SELECT key, value FROM jsonb_each_text(curr_map)
    LOOP
      IF baseline ? uid THEN
        prev_rank := NULLIF(baseline ->> uid, '')::integer;
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
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_run_crew_rank_board_snapshots(p_leaderboard jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  crew_rows jsonb;
BEGIN
  WITH scores AS (
    SELECT
      (r->'user_info'->>'user_id')::uuid AS user_id,
      NULLIF(r->>'total_score', '')::numeric AS total_score
    FROM jsonb_array_elements(COALESCE(p_leaderboard, '[]'::jsonb)) AS r
    WHERE COALESCE((r->'user_info'->>'is_private')::boolean, false) = false
      AND NULLIF(r->>'total_score', '')::numeric > 0
  ),
  crew_avg AS (
    SELECT
      COALESCE(NULLIF(btrim(g.firestore_doc_id), ''), g.id::text) AS crew_key,
      AVG(s.total_score)::numeric AS avg_score
    FROM public.riding_groups g
    JOIN public.riding_group_members m ON m.group_id = g.id
    JOIN scores s ON s.user_id = m.user_id
    WHERE g.status = 'APPROVED'
    GROUP BY g.id, g.firestore_doc_id
    HAVING AVG(s.total_score) > 0
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', crew_key,
        'age_category', 'Supremo',
        'league_category', 'Supremo',
        'score', avg_score
      )
      ORDER BY avg_score DESC, crew_key ASC
    ),
    '[]'::jsonb
  )
  INTO crew_rows
  FROM crew_avg;

  PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows('run_crew_all', crew_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_run_rank_board_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lb jsonb;
  g text;
  d text;
  genders text[] := ARRAY['all', 'M', 'F'];
  dists text[] := ARRAY['1k', '3k', '5k', '7k', '10k', '20k', '42k'];
BEGIN
  lb := public.get_running_leaderboard();

  FOREACH g IN ARRAY genders LOOP
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_overall_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'overall', NULL)
    );
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_tss_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'tss', NULL)
    );
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_distance_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'distance', NULL)
    );

    FOREACH d IN ARRAY dists LOOP
      PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
        'run_pace_' || d || '_' || g,
        public.fn_run_leaderboard_score_rows(lb, g, 'pace', d)
      );
    END LOOP;
  END LOOP;

  PERFORM public.fn_rebuild_run_crew_rank_board_snapshots(lb);
END;
$$;

COMMENT ON FUNCTION public.fn_rebuild_run_rank_board_snapshots() IS
  'RUN 랭킹(종합·페이스·TSS·거리·크루) 일 1회 스냅샷 — KST 23:00 pg_cron 호출';

GRANT EXECUTE ON FUNCTION public.fn_parse_running_pace_mmss(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_run_leaderboard_score_rows(jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_crew_rank_board_snapshots(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshots() TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stelvio_rebuild_run_rank_snapshots_2300_kst') THEN
      PERFORM cron.unschedule(
        (SELECT jobid FROM cron.job WHERE jobname = 'stelvio_rebuild_run_rank_snapshots_2300_kst' LIMIT 1)
      );
    END IF;

    -- KST 23:00 = UTC 14:00 (pg_cron UTC 기준)
    PERFORM cron.schedule(
      'stelvio_rebuild_run_rank_snapshots_2300_kst',
      '0 14 * * *',
      $cmd$SELECT public.fn_rebuild_run_rank_board_snapshots();$cmd$
    );
  END IF;
END;
$schedule$;
