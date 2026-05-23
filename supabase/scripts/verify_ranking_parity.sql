-- =============================================================================
-- 읽기 전환 전 정합성 점검용 SQL (Supabase SQL Editor / psql)
-- Firestore ranking_aggregates·heptagon 과 수동 대조 시 참고.
-- 자동 샘플 대조: scripts/compare-ranking-firestore-supabase.mjs
-- =============================================================================

-- 1) MV 최신성 (metrics_updated_at 분포)
SELECT
  'mv_leaderboard_weekly_tss' AS mv,
  COUNT(*)::bigint AS rows,
  MAX(metrics_updated_at) AS max_metrics_updated_at,
  MIN(metrics_updated_at) AS min_metrics_updated_at
FROM public.mv_leaderboard_weekly_tss
UNION ALL
SELECT
  'mv_leaderboard_peak_28d',
  COUNT(*)::bigint,
  MAX(metrics_updated_at),
  MIN(metrics_updated_at)
FROM public.mv_leaderboard_peak_28d;

-- 2) 주간 TSS TOP 20 (Firestore 키: peakRanking_weekly_tss_v2_all_{week_start}_{today})
SELECT
  user_id,
  display_name,
  weekly_tss,
  week_start,
  week_end
FROM public.mv_leaderboard_weekly_tss
ORDER BY weekly_tss DESC
LIMIT 20;

-- 3) 28일 60분 피크 TOP 20 (Firestore: peakRanking_v2_monthly_60min_all_{start}_{end})
SELECT
  user_id,
  display_name,
  peak_60min_wkg,
  peak_window_start,
  peak_window_end
FROM public.mv_leaderboard_peak_28d
ORDER BY peak_60min_wkg DESC NULLS LAST
LIMIT 20;

-- 4) 헵타곤 Supremo / all / 당월 TOP 20
SELECT
  user_id,
  display_name,
  board_rank,
  sum_position_scores,
  ranks,
  as_of_seoul,
  rebuilt_at
FROM public.heptagon_cohort_ranks
WHERE month_key = to_char(public.fn_seoul_today(), 'YYYY-MM')
  AND filter_category = 'Supremo'
  AND filter_gender = 'all'
ORDER BY board_rank
LIMIT 20;

-- 5) pg_cron 작업 등록 확인
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname IN (
  'stelvio_refresh_ranking_mvs',
  'stelvio_rebuild_heptagon_cohort_ranks'
)
ORDER BY jobname;

-- 6) 특정 Firebase UID(→ uuid v5) 1명 상세 (UUID 치환)
-- SELECT m.* FROM public.user_ranking_metrics m
-- WHERE m.user_id = '00000000-0000-5000-8000-000000000000'::uuid;
