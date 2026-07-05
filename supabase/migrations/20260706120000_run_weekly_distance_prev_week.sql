-- RUN 주간 마일리지 TOP10 — 전주 확정 순위 폴백 (CYCLE getWeeklyRanking week=prev 와 동일)
CREATE OR REPLACE FUNCTION public.get_running_weekly_distance_leaderboard(
  p_week_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week_ref AS (
    SELECT wr.week_start, wr.week_end
    FROM public.fn_seoul_week_range() wr
  ),
  bounds AS (
    SELECT
      (wr.week_start + (p_week_offset * 7))::date AS week_start,
      (wr.week_start + (p_week_offset * 7) + 6)::date AS week_end,
      CASE
        WHEN p_week_offset >= 0 THEN public.fn_seoul_today()
        ELSE (wr.week_start + (p_week_offset * 7) + 6)::date
      END AS week_sum_as_of
    FROM week_ref wr
  ),
  vol AS (
    SELECT
      a.user_id,
      ROUND(
        COALESCE(
          SUM(a.distance_km) FILTER (
            WHERE public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              >= b.week_start
              AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              <= b.week_sum_as_of
          ),
          0
        )::numeric,
        2
      ) AS weekly_distance_km
    FROM public.activities a
    CROSS JOIN bounds b
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
      AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
          >= b.week_start
      AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
          <= b.week_sum_as_of
    GROUP BY a.user_id, b.week_start, b.week_end, b.week_sum_as_of
    HAVING COALESCE(
      SUM(a.distance_km) FILTER (
        WHERE public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
          >= b.week_start
          AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
          <= b.week_sum_as_of
      ),
      0
    ) > 0
  ),
  ranked AS (
    SELECT
      v.user_id,
      v.weekly_distance_km,
      ROW_NUMBER() OVER (ORDER BY v.weekly_distance_km DESC, v.user_id) AS ranking
    FROM vol v
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'scoring_version', 7,
        'ranking', r.ranking,
        'user_info', jsonb_build_object(
          'user_id', r.user_id,
          'firebase_uid', p.firebase_uid,
          'display_name', p.display_name,
          'profile_image_url', p.profile_image_url,
          'gender', p.gender::text,
          'league_category', p.league_category::text,
          'age_category', p.age_category::text,
          'is_private', p.is_private
        ),
        'weekly_distance_km', r.weekly_distance_km,
        'weekly_tss', 0,
        'distance_30d_km', 0,
        'total_score', 0,
        'volume_window', jsonb_build_object(
          'week_start', b.week_start,
          'week_end', b.week_end,
          'week_sum_as_of', b.week_sum_as_of
        )
      )
      ORDER BY r.ranking
    ),
    '[]'::jsonb
  )
  FROM ranked r
  JOIN public.v_user_public_profile p ON p.id = r.user_id
  CROSS JOIN bounds b;
$$;

COMMENT ON FUNCTION public.get_running_weekly_distance_leaderboard(integer) IS
  'RUN 주간 거리 TOP10 — p_week_offset 0=이번 주(월~오늘), -1=전주(월~일)';

GRANT EXECUTE ON FUNCTION public.get_running_weekly_distance_leaderboard(integer) TO service_role;
