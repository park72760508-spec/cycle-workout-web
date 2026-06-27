-- cap 제거(20260626150000) 후 전 사용자 user_ranking_metrics 재집계 + MV·헵타곤 스냅샷 동기화
-- daily_summaries 원본은 변경 없음 — fn_refresh_user_ranking_metrics 만 cap 없이 재실행

DO $$
DECLARE
  rec record;
  r28 record;
  n integer := 0;
BEGIN
  SELECT * INTO r28 FROM public.fn_seoul_rolling_range(28);

  FOR rec IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT m.user_id FROM public.user_ranking_metrics m
      UNION
      SELECT d.user_id
      FROM public.daily_summaries d
      WHERE d.summary_date BETWEEN r28.start_date AND r28.end_date
    ) u
    JOIN public.users usr ON usr.id = u.user_id
    WHERE usr.weight_kg > 0
  LOOP
    PERFORM public.fn_refresh_user_ranking_metrics(rec.user_id);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'cap_uncap backfill: refreshed % users', n;
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
