-- Phase 2 side-effect 스키마·트리거 확인 (Supabase SQL Editor)
WITH checks AS (
  SELECT 'table' AS kind, 'suspicious_power_records' AS object_name,
    EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'suspicious_power_records'
    ) AS ok
  UNION ALL
  SELECT 'column', 'rides.max_hr_5sec',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'max_hr_5sec'
    )
  UNION ALL
  SELECT 'function', 'fn_upsert_yearly_peak_from_ride',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_upsert_yearly_peak_from_ride')
  UNION ALL
  SELECT 'function', 'fn_sync_open_ride_strava_reviews',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_sync_open_ride_strava_reviews')
  UNION ALL
  SELECT 'trigger', 'trg_rides_yearly_peaks',
    EXISTS (
      SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rides' AND tg.tgname = 'trg_rides_yearly_peaks'
        AND NOT tg.tgisinternal
    )
  UNION ALL
  SELECT 'trigger', 'trg_rides_open_ride_strava',
    EXISTS (
      SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rides' AND tg.tgname = 'trg_rides_open_ride_strava'
        AND NOT tg.tgisinternal
    )
)
SELECT kind, object_name,
  CASE WHEN ok THEN 'OK' ELSE 'MISSING' END AS check_status
FROM checks
ORDER BY kind, object_name;

-- 트리거 활성 상태
SELECT tgname AS trigger_name, tgenabled AS enabled
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
WHERE c.relname = 'rides'
  AND tg.tgname IN ('trg_rides_yearly_peaks', 'trg_rides_open_ride_strava', 'trg_rides_refresh_stats')
  AND NOT tg.tgisinternal;
