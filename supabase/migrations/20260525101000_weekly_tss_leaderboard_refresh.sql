-- 주간 TSS / 주간 TOP10 실시간 조회 보강.
-- mv_leaderboard_weekly_tss 는 refresh 주기에 묶이므로, HTTP Read는 트리거로 즉시 갱신되는
-- user_ranking_metrics(week_start/week_end/weekly_tss)를 직접 읽는다.

CREATE INDEX IF NOT EXISTS idx_urm_weekly_tss_live_window
  ON public.user_ranking_metrics (week_start, week_end, weekly_tss DESC)
  WHERE weekly_tss > 0 AND weekly_has_cheat_day = false;

CREATE OR REPLACE VIEW public.v_leaderboard_weekly_tss_live AS
SELECT
  m.user_id,
  p.display_name,
  p.profile_image_url,
  p.gender,
  p.league_category,
  p.is_private,
  m.week_start,
  m.week_end,
  m.weekly_tss,
  m.weekly_has_cheat_day,
  m.metrics_updated_at
FROM public.user_ranking_metrics m
JOIN public.v_user_public_profile p ON p.id = m.user_id
WHERE m.weekly_tss > 0
  AND m.weekly_has_cheat_day = false;

GRANT SELECT ON public.v_leaderboard_weekly_tss_live TO authenticated;
