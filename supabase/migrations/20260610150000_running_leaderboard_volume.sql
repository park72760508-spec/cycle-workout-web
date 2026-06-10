-- 러닝 랭킹보드: 주간 TSS · 최근 30일 거리 (PostgreSQL RPC 내부 산출)
-- Firebase Functions 연산 없음 — get_running_leaderboard() 확장

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS tss numeric(8,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.activities.tss IS '러닝 TSS — Strava suffer_score 우선, 없으면 HR·시간 기반 추정';

CREATE INDEX IF NOT EXISTS idx_activities_user_date_running
  ON public.activities (user_id, activity_date DESC)
  WHERE source = 'strava';

-- Run / VirtualRun / TrailRun / Walk
CREATE OR REPLACE FUNCTION public.fn_is_running_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_type, ''))) IN (
    'run', 'virtualrun', 'trailrun', 'walk'
  );
$$;

-- 러닝 TSS 추정 (ingest·백필 공통)
-- 1) Strava suffer_score(Relative Effort)
-- 2) hrTSS proxy: (duration_h) * (avg_hr/180)^2 * 100
CREATE OR REPLACE FUNCTION public.fn_running_activity_tss(
  p_duration_sec integer,
  p_avg_hr smallint,
  p_suffer_score double precision
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_suffer_score IS NOT NULL AND p_suffer_score > 0 THEN
      ROUND(p_suffer_score::numeric, 1)
    WHEN COALESCE(p_duration_sec, 0) > 0 AND COALESCE(p_avg_hr, 0) > 0 THEN
      ROUND(
        (
          (GREATEST(p_duration_sec, 0)::numeric / 3600)
          * power(GREATEST(p_avg_hr, 0)::numeric / 180, 2)
          * 100
        ),
        1
      )
    ELSE 0::numeric
  END;
$$;

-- 기존 행 TSS 백필
UPDATE public.activities a
SET tss = public.fn_running_activity_tss(a.duration_sec, a.avg_hr, NULL)
WHERE COALESCE(a.tss, 0) = 0
  AND public.fn_is_running_activity_type(a.activity_type);

CREATE OR REPLACE FUNCTION public.get_running_leaderboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week_bounds AS (
    SELECT wr.week_start, wr.week_end
    FROM public.fn_seoul_week_range() wr
  ),
  seoul_today AS (
    SELECT public.fn_seoul_today() AS today
  ),
  filtered AS (
    SELECT r.*
    FROM public.run_activity_efforts r
    LEFT JOIN public.activities a
      ON a.user_id = r.user_id AND a.activity_id = r.activity_id
    CROSS JOIN seoul_today st
    WHERE COALESCE(
      a.activity_date,
      (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
    ) >= (st.today - interval '30 days')::date
  ),
  best_1k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_1k AS speed, f.hr_1k AS hr
    FROM filtered f
    WHERE f.speed_1k IS NOT NULL AND f.speed_1k > 0
    ORDER BY f.user_id, f.speed_1k DESC
  ),
  best_5k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_5k AS speed, f.hr_5k AS hr
    FROM filtered f
    WHERE f.speed_5k IS NOT NULL AND f.speed_5k > 0
    ORDER BY f.user_id, f.speed_5k DESC
  ),
  best_10k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_10k AS speed, f.hr_10k AS hr
    FROM filtered f
    WHERE f.speed_10k IS NOT NULL AND f.speed_10k > 0
    ORDER BY f.user_id, f.speed_10k DESC
  ),
  best_15k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_15k AS speed, f.hr_15k AS hr
    FROM filtered f
    WHERE f.speed_15k IS NOT NULL AND f.speed_15k > 0
    ORDER BY f.user_id, f.speed_15k DESC
  ),
  best_20k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_20k AS speed, f.hr_20k AS hr
    FROM filtered f
    WHERE f.speed_20k IS NOT NULL AND f.speed_20k > 0
    ORDER BY f.user_id, f.speed_20k DESC
  ),
  all_users AS (
    SELECT user_id FROM best_1k
    UNION SELECT user_id FROM best_5k
    UNION SELECT user_id FROM best_10k
    UNION SELECT user_id FROM best_15k
    UNION SELECT user_id FROM best_20k
  ),
  running_volume AS (
    SELECT
      a.user_id,
      ROUND(
        COALESCE(
          SUM(a.tss) FILTER (
            WHERE a.activity_date >= wb.week_start
              AND a.activity_date <= wb.week_end
          ),
          0
        )::numeric,
        1
      ) AS weekly_tss,
      ROUND(
        COALESCE(
          SUM(a.distance_km) FILTER (
            WHERE a.activity_date >= (st.today - interval '30 days')::date
              AND a.activity_date <= st.today
          ),
          0
        )::numeric,
        2
      ) AS distance_30d_km
    FROM public.activities a
    CROSS JOIN week_bounds wb
    CROSS JOIN seoul_today st
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
      AND a.activity_date >= (st.today - interval '30 days')::date
      AND a.activity_date <= st.today
    GROUP BY a.user_id
  ),
  scored AS (
    SELECT
      u.user_id,
      b1.speed AS speed_1k, b1.hr AS hr_1k,
      b5.speed AS speed_5k, b5.hr AS hr_5k,
      b10.speed AS speed_10k, b10.hr AS hr_10k,
      b15.speed AS speed_15k, b15.hr AS hr_15k,
      b20.speed AS speed_20k, b20.hr AS hr_20k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b1.speed), 180, 420) AS score_1k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b5.speed), 210, 480) AS score_5k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b10.speed), 240, 510) AS score_10k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b15.speed), 270, 540) AS score_15k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b20.speed), 300, 570) AS score_20k
    FROM all_users u
    LEFT JOIN best_1k b1 ON b1.user_id = u.user_id
    LEFT JOIN best_5k b5 ON b5.user_id = u.user_id
    LEFT JOIN best_10k b10 ON b10.user_id = u.user_id
    LEFT JOIN best_15k b15 ON b15.user_id = u.user_id
    LEFT JOIN best_20k b20 ON b20.user_id = u.user_id
  ),
  with_total AS (
    SELECT
      s.*,
      ROUND(
        (
          COALESCE(s.score_1k, 0)
          + COALESCE(s.score_5k, 0)
          + COALESCE(s.score_10k, 0)
          + COALESCE(s.score_15k, 0)
          + COALESCE(s.score_20k, 0)
        ) / NULLIF(
          (CASE WHEN s.score_1k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_5k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_10k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_15k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_20k IS NOT NULL THEN 1 ELSE 0 END),
          0
        )::numeric,
        1
      ) AS total_score
    FROM scored s
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_info', jsonb_build_object(
          'user_id', w.user_id,
          'display_name', p.display_name,
          'profile_image_url', p.profile_image_url,
          'gender', p.gender::text,
          'league_category', p.league_category::text,
          'age_category', p.age_category::text,
          'is_private', p.is_private
        ),
        'total_score', w.total_score,
        'weekly_tss', COALESCE(rv.weekly_tss, 0),
        'distance_30d_km', COALESCE(rv.distance_30d_km, 0),
        'volume_window', jsonb_build_object(
          'week_start', wb.week_start,
          'week_end', wb.week_end,
          'distance_from', (st.today - interval '30 days')::date,
          'distance_to', st.today
        ),
        'segment_scores', jsonb_build_object(
          '1k', w.score_1k,
          '5k', w.score_5k,
          '10k', w.score_10k,
          '15k', w.score_15k,
          '20k', w.score_20k
        ),
        'peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_1k)),
            'hr', w.hr_1k
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_5k)),
            'hr', w.hr_5k
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_10k)),
            'hr', w.hr_10k
          ),
          '15k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_15k)),
            'hr', w.hr_15k
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_20k)),
            'hr', w.hr_20k
          )
        )
      )
      ORDER BY w.total_score DESC NULLS LAST, w.user_id
    ),
    '[]'::jsonb
  )
  FROM with_total w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  LEFT JOIN running_volume rv ON rv.user_id = w.user_id
  CROSS JOIN week_bounds wb
  CROSS JOIN seoul_today st
  WHERE p.is_private = false;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard() IS
  '러닝 랭킹: 30일 구간 피크 점수 + 주간 TSS(activities) + 30일 거리(km) — total_score DESC';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;
