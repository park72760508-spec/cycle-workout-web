-- =============================================================================
-- Supabase 랭킹 집계 스케줄 (KST 기준) — Firebase 02:50/03:20 Node 배치와 분리
--
-- pg_cron 기본 타임존이 UTC인 경우가 많아, 아래는 **KST 시각 → UTC cron** 변환값입니다 (KST = UTC+9).
--   01:00 KST → 16:00 UTC (전일)  — 기준선 MV
--   01:15 KST → 16:15 UTC (전일)  — 헵타곤
--   03:15 KST → 18:15 UTC (전일)  — Strava 02:00 ingest 후 MV
--   03:30 KST → 18:30 UTC (전일)  — Strava ingest 후 헵타곤
--
-- Supabase SQL Editor에서 DB timezone 확인:
--   SHOW timezone;
-- Asia/Seoul 이면 '0 1 * * *' 형태로 01:00 KST 직접 사용 가능(아래 주석 블록 참고).
-- =============================================================================

DO $unschedule$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'stelvio_refresh_ranking_mvs',
      'stelvio_rebuild_heptagon_cohort_ranks',
      'stelvio_refresh_ranking_mvs_0100_kst',
      'stelvio_rebuild_heptagon_0115_kst',
      'stelvio_refresh_ranking_mvs_0315_kst',
      'stelvio_rebuild_heptagon_0330_kst'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$unschedule$;

-- UTC cron (KST 01:00 / 01:15 / 03:15 / 03:30)
SELECT cron.schedule(
  'stelvio_refresh_ranking_mvs_0100_kst',
  '0 16 * * *',
  $cmd$SELECT public.fn_refresh_ranking_materialized_views();$cmd$
);

SELECT cron.schedule(
  'stelvio_rebuild_heptagon_0115_kst',
  '15 16 * * *',
  $cmd$SELECT public.fn_rebuild_heptagon_cohort_ranks();$cmd$
);

SELECT cron.schedule(
  'stelvio_refresh_ranking_mvs_0315_kst',
  '15 18 * * *',
  $cmd$SELECT public.fn_refresh_ranking_materialized_views();$cmd$
);

SELECT cron.schedule(
  'stelvio_rebuild_heptagon_0330_kst',
  '30 18 * * *',
  $cmd$SELECT public.fn_rebuild_heptagon_cohort_ranks();$cmd$
);

-- DB timezone 이 Asia/Seoul 인 경우 위 job 대신 아래 사용 가능:
-- SELECT cron.schedule('stelvio_refresh_ranking_mvs_0100_kst', '0 1 * * *', ...);
-- SELECT cron.schedule('stelvio_rebuild_heptagon_0115_kst', '15 1 * * *', ...);
-- SELECT cron.schedule('stelvio_refresh_ranking_mvs_0315_kst', '15 3 * * *', ...);
-- SELECT cron.schedule('stelvio_rebuild_heptagon_0330_kst', '30 3 * * *', ...);
