-- RUN 랭킹 등락 baseline: published 집계일(as_of) 대비 정확히 1일 전(23:00 스냅샷) 순위와 비교
-- 예) 집계일 2026-06-15 → 비교 2026-06-14. 캘린더 '오늘'과 무관하게 published as_of 기준.

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
  target_as_of date;
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

  SELECT s.as_of_seoul
    INTO target_as_of
  FROM public.run_leaderboard_daily_snapshots s
  WHERE s.snapshot_key = 'published';

  IF target_as_of IS NULL THEN
    target_as_of := today;
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
        COALESCE(
          NULLIF(r->'gc_board'->cat->>'total_score', '')::numeric,
          NULLIF(r->>'score', '')::numeric
        ) AS score
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
      WHERE r->>'user_id' IS NOT NULL
        AND btrim(r->>'user_id') <> ''
        AND COALESCE(
          NULLIF(r->'gc_board'->cat->>'total_score', '')::numeric,
          NULLIF(r->>'score', '')::numeric
        ) IS NOT NULL
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

    /* 직전 공식 집계일(prev.as_of = target_as_of - 1) 순위가 baseline */
    IF prev.as_of_seoul IS NOT NULL
       AND prev.as_of_seoul = (target_as_of - 1)
       AND prev_ranks_cat <> '{}'::jsonb THEN
      frozen_prev_day := prev_ranks_cat;
    ELSIF prev.as_of_seoul IS NOT NULL
       AND prev.as_of_seoul = target_as_of
       AND prev_day_in <> '{}'::jsonb THEN
      /* 동일 집계일 재빌드(마이그레이션 등): 저장된 전일 baseline 유지 */
      frozen_prev_day := prev_day_in;
    ELSIF prev_day_in <> '{}'::jsonb THEN
      frozen_prev_day := prev_day_in;
    ELSIF prev_ranks_cat <> '{}'::jsonb THEN
      frozen_prev_day := prev_ranks_cat;
    ELSE
      frozen_prev_day := '{}'::jsonb;
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
    target_as_of,
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
  today date := public.fn_seoul_date_kst();
  published_as_of date;
  genders text[] := ARRAY['all', 'M', 'F'];
  dists text[] := ARRAY['1k', '3k', '5k', '7k', '10k', '20k', '42k'];
BEGIN
  lb := public.get_running_leaderboard();

  SELECT s.as_of_seoul
    INTO published_as_of
  FROM public.run_leaderboard_daily_snapshots s
  WHERE s.snapshot_key = 'published';

  /* KST 23:00 첫 집계: published as_of를 당일로 올림. 당일 재실행은 고정본 유지 */
  IF published_as_of IS NULL OR published_as_of < today THEN
    PERFORM public.fn_persist_run_leaderboard_daily_snapshot(lb);
  ELSE
    SELECT s.leaderboard
      INTO lb
    FROM public.run_leaderboard_daily_snapshots s
    WHERE s.snapshot_key = 'published';
    lb := COALESCE(lb, public.get_running_leaderboard());
  END IF;

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

COMMENT ON FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(text, jsonb) IS
  'RUN 랭킹 등락 스냅샷 — published as_of 기준, 비교 baseline = as_of - 1일(23:00 직전 집계)';

COMMENT ON FUNCTION public.fn_rebuild_run_rank_board_snapshots() IS
  'RUN 랭킹 일 1회(23:00 KST) published·등락 동기화. 당일 재실행 시 published 고정본으로 등락만 재산정';

GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshots() TO service_role;
