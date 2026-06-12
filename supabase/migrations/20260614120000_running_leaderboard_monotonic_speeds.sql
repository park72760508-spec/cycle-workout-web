-- RUN 랭킹: 구간별 피크 속도 단조 보정
-- 문제: 30일 내 활동마다 구간 max 를 따로 취하면 pace(1k) > pace(3k) 역전 가능
-- 해결: 점수 산출 전 speed_1k >= speed_3k >= … >= speed_42k (m/s) 강제

CREATE OR REPLACE FUNCTION public.fn_running_enforce_monotonic_speeds(
  p_speed_1k double precision,
  p_speed_3k double precision,
  p_speed_5k double precision,
  p_speed_7k double precision,
  p_speed_10k double precision,
  p_speed_20k double precision,
  p_speed_42k double precision
)
RETURNS TABLE (
  speed_1k double precision,
  speed_3k double precision,
  speed_5k double precision,
  speed_7k double precision,
  speed_10k double precision,
  speed_20k double precision,
  speed_42k double precision
)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH s1 AS (
    SELECT p_speed_1k AS v1
  ),
  s3 AS (
    SELECT
      v1,
      CASE
        WHEN p_speed_3k IS NULL OR p_speed_3k <= 0 THEN NULL
        WHEN v1 IS NOT NULL AND p_speed_3k > v1 THEN v1
        ELSE p_speed_3k
      END AS v3
    FROM s1
  ),
  s5 AS (
    SELECT
      v1,
      v3,
      CASE
        WHEN p_speed_5k IS NULL OR p_speed_5k <= 0 THEN NULL
        WHEN v3 IS NOT NULL AND p_speed_5k > v3 THEN v3
        WHEN v1 IS NOT NULL AND p_speed_5k > v1 THEN v1
        ELSE p_speed_5k
      END AS v5
    FROM s3
  ),
  s7 AS (
    SELECT
      v1,
      v3,
      v5,
      CASE
        WHEN p_speed_7k IS NULL OR p_speed_7k <= 0 THEN NULL
        WHEN v5 IS NOT NULL AND p_speed_7k > v5 THEN v5
        WHEN v3 IS NOT NULL AND p_speed_7k > v3 THEN v3
        WHEN v1 IS NOT NULL AND p_speed_7k > v1 THEN v1
        ELSE p_speed_7k
      END AS v7
    FROM s5
  ),
  s10 AS (
    SELECT
      v1,
      v3,
      v5,
      v7,
      CASE
        WHEN p_speed_10k IS NULL OR p_speed_10k <= 0 THEN NULL
        WHEN v7 IS NOT NULL AND p_speed_10k > v7 THEN v7
        WHEN v5 IS NOT NULL AND p_speed_10k > v5 THEN v5
        WHEN v3 IS NOT NULL AND p_speed_10k > v3 THEN v3
        WHEN v1 IS NOT NULL AND p_speed_10k > v1 THEN v1
        ELSE p_speed_10k
      END AS v10
    FROM s7
  ),
  s20 AS (
    SELECT
      v1,
      v3,
      v5,
      v7,
      v10,
      CASE
        WHEN p_speed_20k IS NULL OR p_speed_20k <= 0 THEN NULL
        WHEN v10 IS NOT NULL AND p_speed_20k > v10 THEN v10
        WHEN v7 IS NOT NULL AND p_speed_20k > v7 THEN v7
        WHEN v5 IS NOT NULL AND p_speed_20k > v5 THEN v5
        WHEN v3 IS NOT NULL AND p_speed_20k > v3 THEN v3
        WHEN v1 IS NOT NULL AND p_speed_20k > v1 THEN v1
        ELSE p_speed_20k
      END AS v20
    FROM s10
  ),
  s42 AS (
    SELECT
      v1,
      v3,
      v5,
      v7,
      v10,
      v20,
      CASE
        WHEN p_speed_42k IS NULL OR p_speed_42k <= 0 THEN NULL
        WHEN v20 IS NOT NULL AND p_speed_42k > v20 THEN v20
        WHEN v10 IS NOT NULL AND p_speed_42k > v10 THEN v10
        WHEN v7 IS NOT NULL AND p_speed_42k > v7 THEN v7
        WHEN v5 IS NOT NULL AND p_speed_42k > v5 THEN v5
        WHEN v3 IS NOT NULL AND p_speed_42k > v3 THEN v3
        WHEN v1 IS NOT NULL AND p_speed_42k > v1 THEN v1
        ELSE p_speed_42k
      END AS v42
    FROM s20
  )
  SELECT v1, v3, v5, v7, v10, v20, v42 FROM s42;
$$;

COMMENT ON FUNCTION public.fn_running_enforce_monotonic_speeds IS
  'RUN 구간 피크 m/s 단조: speed_1k >= speed_3k >= … (페이스 min/km 는 1k <= 3k <= …)';

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
  best_3k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_3k AS speed, f.hr_3k AS hr
    FROM filtered f
    WHERE f.speed_3k IS NOT NULL AND f.speed_3k > 0
    ORDER BY f.user_id, f.speed_3k DESC
  ),
  best_5k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_5k AS speed, f.hr_5k AS hr
    FROM filtered f
    WHERE f.speed_5k IS NOT NULL AND f.speed_5k > 0
    ORDER BY f.user_id, f.speed_5k DESC
  ),
  best_7k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_7k AS speed, f.hr_7k AS hr
    FROM filtered f
    WHERE f.speed_7k IS NOT NULL AND f.speed_7k > 0
    ORDER BY f.user_id, f.speed_7k DESC
  ),
  best_10k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_10k AS speed, f.hr_10k AS hr
    FROM filtered f
    WHERE f.speed_10k IS NOT NULL AND f.speed_10k > 0
    ORDER BY f.user_id, f.speed_10k DESC
  ),
  best_20k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_20k AS speed, f.hr_20k AS hr
    FROM filtered f
    WHERE f.speed_20k IS NOT NULL AND f.speed_20k > 0
    ORDER BY f.user_id, f.speed_20k DESC
  ),
  best_42k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_42k AS speed, f.hr_42k AS hr
    FROM filtered f
    WHERE f.speed_42k IS NOT NULL AND f.speed_42k > 0
    ORDER BY f.user_id, f.speed_42k DESC
  ),
  all_users AS (
    SELECT user_id FROM best_1k
    UNION SELECT user_id FROM best_3k
    UNION SELECT user_id FROM best_5k
    UNION SELECT user_id FROM best_7k
    UNION SELECT user_id FROM best_10k
    UNION SELECT user_id FROM best_20k
    UNION SELECT user_id FROM best_42k
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
  raw_speeds AS (
    SELECT
      u.user_id,
      b1.speed AS raw_1k, b1.hr AS hr_1k,
      b3.speed AS raw_3k, b3.hr AS hr_3k,
      b5.speed AS raw_5k, b5.hr AS hr_5k,
      b7.speed AS raw_7k, b7.hr AS hr_7k,
      b10.speed AS raw_10k, b10.hr AS hr_10k,
      b20.speed AS raw_20k, b20.hr AS hr_20k,
      b42.speed AS raw_42k, b42.hr AS hr_42k
    FROM all_users u
    LEFT JOIN best_1k b1 ON b1.user_id = u.user_id
    LEFT JOIN best_3k b3 ON b3.user_id = u.user_id
    LEFT JOIN best_5k b5 ON b5.user_id = u.user_id
    LEFT JOIN best_7k b7 ON b7.user_id = u.user_id
    LEFT JOIN best_10k b10 ON b10.user_id = u.user_id
    LEFT JOIN best_20k b20 ON b20.user_id = u.user_id
    LEFT JOIN best_42k b42 ON b42.user_id = u.user_id
  ),
  adjusted AS (
    SELECT
      rs.user_id,
      rs.hr_1k,
      rs.hr_3k,
      rs.hr_5k,
      rs.hr_7k,
      rs.hr_10k,
      rs.hr_20k,
      rs.hr_42k,
      m.speed_1k,
      m.speed_3k,
      m.speed_5k,
      m.speed_7k,
      m.speed_10k,
      m.speed_20k,
      m.speed_42k
    FROM raw_speeds rs
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      rs.raw_1k, rs.raw_3k, rs.raw_5k, rs.raw_7k, rs.raw_10k, rs.raw_20k, rs.raw_42k
    ) AS m(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
  ),
  scored AS (
    SELECT
      a.user_id,
      a.speed_1k, a.hr_1k,
      a.speed_3k, a.hr_3k,
      a.speed_5k, a.hr_5k,
      a.speed_7k, a.hr_7k,
      a.speed_10k, a.hr_10k,
      a.speed_20k, a.hr_20k,
      a.speed_42k, a.hr_42k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_1k), 180, 420) AS score_1k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_3k), 195, 450) AS score_3k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_5k), 210, 480) AS score_5k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_7k), 225, 495) AS score_7k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_10k), 240, 510) AS score_10k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_20k), 300, 570) AS score_20k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(a.speed_42k), 390, 720) AS score_42k
    FROM adjusted a
  ),
  with_total AS (
    SELECT
      s.*,
      ROUND(
        (
          COALESCE(s.score_1k, 0)
          + COALESCE(s.score_3k, 0)
          + COALESCE(s.score_5k, 0)
          + COALESCE(s.score_7k, 0)
          + COALESCE(s.score_10k, 0)
          + COALESCE(s.score_20k, 0)
          + COALESCE(s.score_42k, 0)
        ) / NULLIF(
          (CASE WHEN s.score_1k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_3k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_5k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_7k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_10k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_20k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_42k IS NOT NULL THEN 1 ELSE 0 END),
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
          '3k', w.score_3k,
          '5k', w.score_5k,
          '7k', w.score_7k,
          '10k', w.score_10k,
          '20k', w.score_20k,
          '42k', w.score_42k
        ),
        'peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_1k)),
            'hr', w.hr_1k
          ),
          '3k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_3k)),
            'hr', w.hr_3k
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_5k)),
            'hr', w.hr_5k
          ),
          '7k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_7k)),
            'hr', w.hr_7k
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_10k)),
            'hr', w.hr_10k
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_20k)),
            'hr', w.hr_20k
          ),
          '42k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_42k)),
            'hr', w.hr_42k
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
  '러닝 랭킹: 30일 구간 피크 → fn_running_enforce_monotonic_speeds → 점수 → total_score DESC';

GRANT EXECUTE ON FUNCTION public.fn_running_enforce_monotonic_speeds(
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;
