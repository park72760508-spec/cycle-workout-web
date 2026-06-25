-- 주간 TSS live RPC: firebase_uid 포함 → Functions 랭킹 Read 시 Firestore users 조회 제거
-- RETURNS TABLE 컬럼 변경은 CREATE OR REPLACE 불가 → DROP 후 재생성

DROP FUNCTION IF EXISTS public.fn_weekly_tss_leaderboard_live(date, date);

CREATE FUNCTION public.fn_weekly_tss_leaderboard_live(
  p_start date,
  p_end date
)
RETURNS TABLE (
  user_id uuid,
  firebase_uid text,
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
    p.firebase_uid,
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
    AND p.firebase_uid IS NOT NULL
    AND btrim(p.firebase_uid) <> ''
  ORDER BY w.weekly_tss DESC, w.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_weekly_tss_leaderboard_live(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_weekly_tss_leaderboard_live(date, date) IS
  '사이클 주간 TSS 랭킹 live read — daily_summaries 집계, firebase_uid 포함';
