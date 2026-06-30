-- CYCLE 주간 TSS·TOP10 마스터 집계 — Firebase rebuildRankingAggregates(03:40)·scheduledWeeklyTop10PeakRefresh(09:00) 대체
-- fn_seoul_week_tss_range(월~오늘) + peak_rank_board_snapshots 등락 + ranking_build_meta Realtime

CREATE OR REPLACE FUNCTION public.fn_master_daily_rebuild_weekly_tss()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_touch_ranking_build_meta('master_daily_rebuild', 'running', NULL);

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;

  PERFORM public.fn_rebuild_peak_rank_board_snapshots();

  PERFORM public.fn_touch_ranking_build_meta('peak_rank_board_snapshots', 'complete', NULL);
  PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_live', 'complete', NULL);
  PERFORM public.fn_touch_ranking_build_meta('master_daily_rebuild', 'complete', NULL);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM public.fn_touch_ranking_build_meta('master_daily_rebuild', 'failed', NULL);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.fn_master_daily_rebuild_weekly_tss() IS
  'KST 03:40 마스터 — 주간 TSS MV·등락 스냅샷·클라이언트 Realtime 메타 (Firebase ranking_aggregates 대체)';

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_daytime_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;
  PERFORM public.fn_rebuild_peak_rank_board_snapshots();
  PERFORM public.fn_touch_ranking_build_meta('peak_rank_board_snapshots', 'complete', NULL);
  PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_live', 'complete', NULL);
END;
$$;

COMMENT ON FUNCTION public.fn_weekly_tss_daytime_refresh() IS
  'KST 09:00 낮 갱신 — scheduledWeeklyTop10PeakRefresh Supabase 대체';

GRANT EXECUTE ON FUNCTION public.fn_master_daily_rebuild_weekly_tss() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_weekly_tss_daytime_refresh() TO service_role;

DO $cron$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skip master_daily_rebuild schedule';
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'stelvio_rebuild_rank_snapshots_0335_kst',
      'stelvio_master_daily_rebuild_0340_kst',
      'stelvio_weekly_tss_daytime_refresh_0900_kst'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  -- KST 03:40 = UTC 18:40 (전일) — 03:35 스냅샷 job 통합
  PERFORM cron.schedule(
    'stelvio_master_daily_rebuild_0340_kst',
    '40 18 * * *',
    $cmd$SELECT public.fn_master_daily_rebuild_weekly_tss();$cmd$
  );

  -- KST 09:00 = UTC 00:00
  PERFORM cron.schedule(
    'stelvio_weekly_tss_daytime_refresh_0900_kst',
    '0 0 * * *',
    $cmd$SELECT public.fn_weekly_tss_daytime_refresh();$cmd$
  );
END;
$cron$;
