-- 독주 90일 전환: peak_personal_speed_rolling90d_* 등락 baseline — rolling28d 스냅샷에서 prev_day 이식

DO $$
DECLARE
  rec record;
  v_new_key text;
  v_old_key text;
  v_today date := public.fn_seoul_date_kst();
BEGIN
  FOR rec IN
    SELECT history_key
    FROM public.peak_rank_board_snapshots
    WHERE history_key LIKE 'peak_personal_speed_rolling28d_%'
  LOOP
    v_old_key := rec.history_key;
    v_new_key := replace(v_old_key, 'rolling28d_', 'rolling90d_');

    INSERT INTO public.peak_rank_board_snapshots (
      history_key,
      as_of_seoul,
      ranks_by_category,
      rank_changes_by_category,
      previous_ranks_by_category,
      prev_day_ranks_by_category,
      updated_at
    )
    SELECT
      v_new_key,
      v_today,
      COALESCE(old.ranks_by_category, '{}'::jsonb),
      '{}'::jsonb,
      '{}'::jsonb,
      CASE
        WHEN old.prev_day_ranks_by_category IS NOT NULL
             AND old.prev_day_ranks_by_category <> '{}'::jsonb
          THEN old.prev_day_ranks_by_category
        WHEN old.as_of_seoul IS NOT NULL
             AND old.as_of_seoul < v_today
             AND old.ranks_by_category IS NOT NULL
             AND old.ranks_by_category <> '{}'::jsonb
          THEN old.ranks_by_category
        ELSE '{}'::jsonb
      END,
      now()
    FROM public.peak_rank_board_snapshots old
    WHERE old.history_key = v_old_key
    ON CONFLICT (history_key) DO UPDATE SET
      prev_day_ranks_by_category = CASE
        WHEN public.peak_rank_board_snapshots.prev_day_ranks_by_category IS NULL
          OR public.peak_rank_board_snapshots.prev_day_ranks_by_category = '{}'::jsonb
        THEN EXCLUDED.prev_day_ranks_by_category
        ELSE public.peak_rank_board_snapshots.prev_day_ranks_by_category
      END,
      updated_at = now()
    WHERE public.peak_rank_board_snapshots.prev_day_ranks_by_category IS NULL
       OR public.peak_rank_board_snapshots.prev_day_ranks_by_category = '{}'::jsonb;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_rebuild_peak_rank_board_snapshots'
  ) THEN
    PERFORM public.fn_rebuild_peak_rank_board_snapshots();
  END IF;
END $$;
