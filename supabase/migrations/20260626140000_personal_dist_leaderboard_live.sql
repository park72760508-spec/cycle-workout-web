-- CYCLE 개인 거리(30일) 랭킹보드 실시간 조회
-- mv_leaderboard_distance_30d(5분 cron) 대신 daily_summaries 원천 RPC로 즉시 반영

CREATE INDEX IF NOT EXISTS idx_urm_personal_dist_live_window
  ON public.user_ranking_metrics (dist_window_start, dist_window_end, distance_30d_km DESC)
  WHERE distance_30d_km > 0;

CREATE OR REPLACE FUNCTION public.fn_personal_dist_leaderboard_live(
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
  dist_window_start date,
  dist_window_end date,
  distance_30d_km numeric,
  metrics_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dist30 AS (
    SELECT
      d.user_id,
      COALESCE(SUM(public.fn_effective_day_km(d)), 0)::numeric AS distance_30d_km,
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
    p_start AS dist_window_start,
    p_end AS dist_window_end,
    ROUND(w.distance_30d_km::numeric, 2) AS distance_30d_km,
    w.metrics_updated_at
  FROM dist30 w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  WHERE w.distance_30d_km > 0
  ORDER BY w.distance_30d_km DESC, w.user_id;
$$;

COMMENT ON FUNCTION public.fn_personal_dist_leaderboard_live IS
  '30일 거리 랭킹 — daily_summaries 원천 즉시 집계(MV refresh 대기 없음)';

GRANT EXECUTE ON FUNCTION public.fn_personal_dist_leaderboard_live(date, date) TO authenticated;

-- 거리 갱신 시에도 ranking_metrics_live 메타 터치 (Realtime 시그널)
DROP TRIGGER IF EXISTS trg_urm_touch_live_meta ON public.user_ranking_metrics;
CREATE TRIGGER trg_urm_touch_live_meta
  AFTER INSERT OR UPDATE OF weekly_tss, week_start, week_end, weekly_has_cheat_day,
    distance_30d_km, dist_window_start, dist_window_end, metrics_updated_at
  ON public.user_ranking_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_ranking_metrics_live_meta();
