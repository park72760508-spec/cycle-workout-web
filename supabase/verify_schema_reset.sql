-- =============================================================================
-- STELVIO 스키마 리셋 적용 여부 확인 (Supabase SQL Editor에 붙여넣고 Run)
-- 맨 아래 summary 행: check_status = SUCCESS 이면 적용 완료
-- =============================================================================

WITH checks AS (
  SELECT 'table' AS kind, t.expected AS object_name,
    EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t.expected
    ) AS ok
  FROM (VALUES
    ('users'), ('rides'), ('daily_summaries'), ('user_ranking_metrics'),
    ('strava_connections'), ('yearly_peaks'), ('open_rides'), ('open_ride_participants')
  ) AS t(expected)

  UNION ALL

  SELECT 'materialized_view', v.expected,
    EXISTS (
      SELECT 1 FROM pg_matviews
      WHERE schemaname = 'public' AND matviewname = v.expected
    )
  FROM (VALUES
    ('mv_leaderboard_peak_28d'),
    ('mv_leaderboard_weekly_tss'),
    ('mv_leaderboard_distance_30d'),
    ('mv_leaderboard_speed_28d')
  ) AS v(expected)

  UNION ALL

  SELECT 'trigger', tr.expected,
    EXISTS (
      SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tr.tbl AND tg.tgname = tr.expected
    )
  FROM (VALUES
    ('rides', 'trg_rides_refresh_stats'),
    ('users', 'trg_users_updated_at')
  ) AS tr(tbl, expected)

  UNION ALL

  SELECT 'function', f.expected,
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = f.expected
    )
  FROM (VALUES
    ('fn_reconcile_daily_summary'),
    ('fn_refresh_user_ranking_metrics'),
    ('fn_refresh_ranking_materialized_views'),
    ('fn_rides_after_change'),
    ('fn_handle_new_auth_user')
  ) AS f(expected)

  UNION ALL

  SELECT 'rls_enabled', c.relname::text, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('users', 'rides', 'daily_summaries', 'user_ranking_metrics')
    AND c.relkind = 'r'
),
lines AS (
  SELECT
    1 AS sort_order,
    kind,
    object_name,
    CASE WHEN ok THEN 'OK' ELSE 'MISSING' END AS check_status
  FROM checks

  UNION ALL

  SELECT
    0,
    'summary',
    format(
      '%s passed / %s total',
      COUNT(*) FILTER (WHERE ok),
      COUNT(*)
    ),
    CASE
      WHEN COUNT(*) FILTER (WHERE NOT ok) = 0 THEN 'SUCCESS'
      ELSE 'FAILED'
    END
  FROM checks
)
SELECT kind, object_name, check_status
FROM lines
ORDER BY sort_order, kind, object_name;
