-- RUN 주간 마일리지 TOP10 등락 유지 (2026-11-10)
--
-- 문제: 다음 날로 넘어갔는데 새 순위 변화가 없으면, 비교 대상(전날 순위)이 오늘 순위와 같아져 등락이 전부 보합(-)으로 지워짐.
-- 요구: 주간 마일리지 TOP10 은 '집계 당시 등락'이므로 날짜가 바뀌어도 마지막 등락을 유지하고, 새 순위 변화가 생기면 그때 갱신.
-- 방식: run_weekly_distance_* 보드에 한해, 새 순위표 == 직전 저장 순위표(같은 주)이면 baseline 으로 직전에 저장된 baseline 을 재사용
--       (등락 = 그 baseline 순위 − 현재 순위 이므로 마지막 순위 변화 때와 같은 값이 계속 표시됨).
--       다른 RUN 보드·CYCLE 은 변경 없음.

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

    /* 2026-11-10 주간 마일리지(run_weekly_distance_*) 전용: 새 집계 순위표가 직전 집계 순위표와 완전히 같으면(순위 변화 없음)
       등락이 전부 보합으로 지워지지 않게 직전에 저장된 baseline(=마지막 순위 변화 때의 비교 대상)을 그대로 유지한다.
       같은 주(월~일) 안에서만 — 새 주는 순위표 자체가 새로 시작. 다른 RUN 보드(overall·tss·distance·pace·crew)는 기존 동작 그대로. */
    IF p_history_key LIKE 'run_weekly_distance\_%' ESCAPE '\'
       AND prev.as_of_seoul IS NOT NULL
       AND prev.as_of_seoul < target_as_of
       AND date_trunc('week', prev.as_of_seoul::timestamp) = date_trunc('week', target_as_of::timestamp)
       AND prev_ranks_cat <> '{}'::jsonb
       AND prev_ranks_cat = curr_map
       AND prev_day_in <> '{}'::jsonb THEN
      frozen_prev_day := prev_day_in;
    /* 직전 공식 집계일(prev.as_of = target_as_of - 1) 순위가 baseline */
    ELSIF prev.as_of_seoul IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(text, jsonb) TO service_role;
