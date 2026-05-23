-- =============================================================================
-- 4a) pg_cron — 랭킹 Materialized View 주기적 CONCURRENTLY refresh
-- rides INSERT 트리거는 user_ranking_metrics를 즉시 갱신하고,
-- MV는 5분마다 fn_refresh_ranking_materialized_views()로 백그라운드 동기화.
-- Firebase 02:50/03:20 등 특정 시각 배치 체인은 모방하지 않음.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $cron_mv$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'stelvio_refresh_ranking_mvs';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'stelvio_refresh_ranking_mvs',
    '*/5 * * * *',
    $cmd$SELECT public.fn_refresh_ranking_materialized_views();$cmd$
  );
END;
$cron_mv$;

COMMENT ON EXTENSION pg_cron IS
  'stelvio_refresh_ranking_mvs: */5 * * * * → fn_refresh_ranking_materialized_views()';
