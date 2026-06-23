-- 20260623140000 보완: user_ranking_metrics 보정 후 랭킹 API가 읽는 MV·스냅샷 동기화
-- (이미 20260623140000만 적용한 환경에서 20분 W/kg 등이 랭킹보드에 남아 있을 때 실행)

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
