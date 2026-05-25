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

-- 요청 주간을 daily_summaries 원천에서 즉시 산출한다.
-- 새 월요일처럼 user_ranking_metrics가 아직 current week로 롤오버되지 않은 경우에도
-- 주간 TOP10 / TSS 랭킹보드가 전주 확정 순위로 fallback하지 않게 하는 실시간 read path.
CREATE OR REPLACE FUNCTION public.fn_weekly_tss_leaderboard_live(
  p_start date,
  p_end date
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  profile_image_url text,
  gender text,
  league_category text,
  is_private boolean,
  week_start date,
  week_end date,
  weekly_tss numeric,
  weekly_has_cheat_day boolean,
  metrics_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH weekly AS (
    SELECT
      d.user_id,
      COALESCE(SUM(public.fn_effective_day_tss(d)), 0)::numeric AS weekly_tss,
      COALESCE(bool_or(
        (COALESCE(d.tss_strava_sum, 0) > 0 AND d.tss_strava_sum >= 500)
        OR (COALESCE(d.tss_strava_sum, 0) = 0 AND COALESCE(d.tss_stelvio_sum, 0) >= 500)
      ), false) AS weekly_has_cheat_day,
      MAX(d.reconciled_at) AS metrics_updated_at
    FROM public.daily_summaries d
    WHERE d.summary_date BETWEEN p_start AND p_end
    GROUP BY d.user_id
  )
  SELECT
    w.user_id,
    p.display_name,
    p.profile_image_url,
    p.gender,
    p.league_category,
    p.is_private,
    p_start AS week_start,
    p_end AS week_end,
    ROUND(w.weekly_tss::numeric, 2) AS weekly_tss,
    w.weekly_has_cheat_day,
    w.metrics_updated_at
  FROM weekly w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  WHERE w.weekly_tss > 0
    AND w.weekly_has_cheat_day = false
  ORDER BY w.weekly_tss DESC, w.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_weekly_tss_leaderboard_live(date, date) TO authenticated;
