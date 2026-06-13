-- RUN 랭킹 v3: 거리별 슬라이딩 윈도우 + 중·장거리 30% 페널티(기록 1건)
-- 기존 테이블 ALTER 없음 — 헬퍼 함수·get_running_leaderboard() 교체만

-- 슬라이딩 윈도우 조회 성능 (user_id + 활동일/갱신일)
CREATE INDEX IF NOT EXISTS idx_run_activity_efforts_user_updated_at
  ON public.run_activity_efforts (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.fn_running_sliding_window_days(p_axis text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_axis, '')))
    WHEN '1k' THEN 30
    WHEN '3k' THEN 30
    WHEN '5k' THEN 60
    WHEN '7k' THEN 60
    WHEN '10k' THEN 90
    WHEN '20k' THEN 90
    WHEN '42k' THEN 90
    ELSE 30
  END;
$$;

COMMENT ON FUNCTION public.fn_running_sliding_window_days(text) IS
  'RUN 슬라이딩 윈도우 일수: 1k/3k=30, 5k/7k=60, 10k/20k/42k=90';

-- 페이스(sec/km) 산술 평균 → 대표 속도(m/s)
CREATE OR REPLACE FUNCTION public.fn_running_speed_from_avg_paces(
  p_pace1_sec double precision,
  p_pace2_sec double precision DEFAULT NULL
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_pace1_sec IS NULL OR p_pace1_sec <= 0 OR NOT isfinite(p_pace1_sec::numeric) THEN NULL
    WHEN p_pace2_sec IS NULL OR p_pace2_sec <= 0 OR NOT isfinite(p_pace2_sec::numeric)
      THEN 1000.0 / p_pace1_sec
    ELSE 1000.0 / ((p_pace1_sec + p_pace2_sec) / 2.0)
  END;
$$;

COMMENT ON FUNCTION public.fn_running_speed_from_avg_paces(double precision, double precision) IS
  '두 페이스(sec/km)의 산술 평균에 해당하는 속도(m/s). p_pace2 NULL이면 p_pace1만 사용';

-- 구간별 슬라이딩 피크 집계 (단거리=최고 1개, 중·장거리=top2 평균 또는 1건 30% 페널티)
CREATE OR REPLACE FUNCTION public.fn_running_sliding_axis_speed(
  p_axis text,
  p_best_speed double precision,
  p_second_speed double precision,
  p_peak_count integer
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_peak_count IS NULL OR p_peak_count <= 0 THEN NULL
    WHEN p_peak_count = 1
      AND lower(btrim(COALESCE(p_axis, ''))) IN ('5k', '7k', '10k', '20k', '42k') THEN
      public.fn_running_speed_from_avg_paces(
        public.fn_running_pace_sec_per_km(p_best_speed),
        public.fn_running_pace_sec_per_km(p_best_speed) * 1.30
      )
    WHEN p_peak_count >= 2
      AND lower(btrim(COALESCE(p_axis, ''))) IN ('5k', '7k', '10k', '20k', '42k') THEN
      public.fn_running_speed_from_avg_paces(
        public.fn_running_pace_sec_per_km(p_best_speed),
        public.fn_running_pace_sec_per_km(p_second_speed)
      )
    ELSE p_best_speed
  END;
$$;

COMMENT ON FUNCTION public.fn_running_sliding_axis_speed(text, double precision, double precision, integer) IS
  '슬라이딩 윈도우 구간 피크: 단거리 MAX(speed), 중·장거리 top2 페이스 평균, 1건 시 페이스×1.30 가상기록 반영';

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
  efforts_joined AS (
    SELECT
      r.*,
      COALESCE(
        a.activity_date,
        (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
      ) AS act_date
    FROM public.run_activity_efforts r
    INNER JOIN public.activities a
      ON a.user_id = r.user_id AND a.activity_id = r.activity_id
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
  ),
  activity_mono AS (
    SELECT
      ej.user_id,
      ej.activity_id,
      ej.act_date,
      ej.hr_1k,
      ej.hr_3k,
      ej.hr_5k,
      ej.hr_7k,
      ej.hr_10k,
      ej.hr_20k,
      ej.hr_42k,
      im.speed_1k,
      im.speed_3k,
      im.speed_5k,
      im.speed_7k,
      im.speed_10k,
      im.speed_20k,
      im.speed_42k
    FROM efforts_joined ej
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      ej.speed_1k, ej.speed_3k, ej.speed_5k, ej.speed_7k, ej.speed_10k, ej.speed_20k, ej.speed_42k
    ) AS mono(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
    CROSS JOIN LATERAL public.fn_running_impute_shorter_speeds(
      mono.speed_1k, mono.speed_3k, mono.speed_5k, mono.speed_7k,
      mono.speed_10k, mono.speed_20k, mono.speed_42k
    ) AS im(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
    WHERE COALESCE(im.speed_1k, 0) > 0
       OR COALESCE(im.speed_3k, 0) > 0
       OR COALESCE(im.speed_5k, 0) > 0
       OR COALESCE(im.speed_7k, 0) > 0
       OR COALESCE(im.speed_10k, 0) > 0
       OR COALESCE(im.speed_20k, 0) > 0
       OR COALESCE(im.speed_42k, 0) > 0
  ),
  axis_activity_peaks AS (
    SELECT
      am.user_id,
      am.activity_id,
      am.act_date,
      v.axis,
      v.speed,
      v.hr,
      public.fn_running_sliding_window_days(v.axis) AS window_days
    FROM activity_mono am
    CROSS JOIN LATERAL (
      VALUES
        ('1k', am.speed_1k, am.hr_1k),
        ('3k', am.speed_3k, am.hr_3k),
        ('5k', am.speed_5k, am.hr_5k),
        ('7k', am.speed_7k, am.hr_7k),
        ('10k', am.speed_10k, am.hr_10k),
        ('20k', am.speed_20k, am.hr_20k),
        ('42k', am.speed_42k, am.hr_42k)
    ) AS v(axis, speed, hr)
    WHERE v.speed IS NOT NULL AND v.speed > 0
  ),
  axis_in_window AS (
    SELECT ap.*
    FROM axis_activity_peaks ap
    CROSS JOIN seoul_today st
    WHERE ap.act_date >= (st.today - (ap.window_days || ' days')::interval)::date
      AND ap.act_date <= st.today
  ),
  ranked_axis_peaks AS (
    SELECT
      aiw.*,
      ROW_NUMBER() OVER (
        PARTITION BY aiw.user_id, aiw.axis
        ORDER BY aiw.speed DESC, aiw.activity_id
      ) AS rn
    FROM axis_in_window aiw
  ),
  axis_best AS (
    SELECT
      rap.user_id,
      rap.axis,
      COUNT(*)::integer AS peak_cnt,
      MAX(rap.speed) FILTER (WHERE rap.rn = 1) AS best_speed,
      MAX(rap.speed) FILTER (WHERE rap.rn = 2) AS second_speed,
      MAX(rap.hr) FILTER (WHERE rap.rn = 1) AS best_hr
    FROM ranked_axis_peaks rap
    GROUP BY rap.user_id, rap.axis
  ),
  sliding_peaks AS (
    SELECT
      ab.user_id,
      ab.axis,
      ab.best_hr,
      public.fn_running_sliding_axis_speed(
        ab.axis,
        ab.best_speed,
        ab.second_speed,
        ab.peak_cnt
      ) AS agg_speed
    FROM axis_best ab
    WHERE ab.peak_cnt > 0
  ),
  sliding_pivot AS (
    SELECT
      sp.user_id,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '1k') AS raw_1k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '1k') AS hr_1k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '3k') AS raw_3k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '3k') AS hr_3k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '5k') AS raw_5k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '5k') AS hr_5k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '7k') AS raw_7k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '7k') AS hr_7k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '10k') AS raw_10k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '10k') AS hr_10k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '20k') AS raw_20k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '20k') AS hr_20k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '42k') AS raw_42k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '42k') AS hr_42k
    FROM sliding_peaks sp
    GROUP BY sp.user_id
  ),
  sliding_mono AS (
    SELECT
      sp.user_id,
      sp.hr_1k,
      sp.hr_3k,
      sp.hr_5k,
      sp.hr_7k,
      sp.hr_10k,
      sp.hr_20k,
      sp.hr_42k,
      im.speed_1k,
      im.speed_3k,
      im.speed_5k,
      im.speed_7k,
      im.speed_10k,
      im.speed_20k,
      im.speed_42k
    FROM sliding_pivot sp
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      sp.raw_1k, sp.raw_3k, sp.raw_5k, sp.raw_7k, sp.raw_10k, sp.raw_20k, sp.raw_42k
    ) AS mono(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
    CROSS JOIN LATERAL public.fn_running_impute_shorter_speeds(
      mono.speed_1k, mono.speed_3k, mono.speed_5k, mono.speed_7k,
      mono.speed_10k, mono.speed_20k, mono.speed_42k
    ) AS im(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
  ),
  gc_profile AS (
    SELECT * FROM sliding_mono
  ),
  pace_peaks AS (
    SELECT * FROM sliding_mono
  ),
  all_users AS (
    SELECT user_id FROM gc_profile
    UNION
    SELECT user_id FROM pace_peaks
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
  adjusted AS (
    SELECT
      u.user_id,
      gp.speed_1k,
      gp.speed_3k,
      gp.speed_5k,
      gp.speed_7k,
      gp.speed_10k,
      gp.speed_20k,
      gp.speed_42k,
      gp.hr_1k,
      gp.hr_3k,
      gp.hr_5k,
      gp.hr_7k,
      gp.hr_10k,
      gp.hr_20k,
      gp.hr_42k,
      pp.speed_1k AS pace_speed_1k,
      pp.speed_3k AS pace_speed_3k,
      pp.speed_5k AS pace_speed_5k,
      pp.speed_7k AS pace_speed_7k,
      pp.speed_10k AS pace_speed_10k,
      pp.speed_20k AS pace_speed_20k,
      pp.speed_42k AS pace_speed_42k,
      pp.hr_1k AS pace_hr_1k,
      pp.hr_3k AS pace_hr_3k,
      pp.hr_5k AS pace_hr_5k,
      pp.hr_7k AS pace_hr_7k,
      pp.hr_10k AS pace_hr_10k,
      pp.hr_20k AS pace_hr_20k,
      pp.hr_42k AS pace_hr_42k
    FROM all_users u
    LEFT JOIN gc_profile gp ON gp.user_id = u.user_id
    LEFT JOIN pace_peaks pp ON pp.user_id = u.user_id
  ),
  board_dims AS (
    SELECT g AS filter_gender, c AS filter_category
    FROM (VALUES ('all'), ('M'), ('F')) AS g(g)
    CROSS JOIN (
      VALUES
        ('Supremo'),
        ('Assoluto'),
        ('Bianco'),
        ('Rosa'),
        ('Infinito'),
        ('Leggenda')
    ) AS c(c)
  ),
  board_users AS (
    SELECT
      bd.filter_gender,
      bd.filter_category,
      a.user_id,
      a.speed_1k,
      a.speed_3k,
      a.speed_5k,
      a.speed_7k,
      a.speed_10k,
      a.speed_20k
    FROM adjusted a
    JOIN public.v_user_public_profile p ON p.id = a.user_id
    CROSS JOIN board_dims bd
    WHERE p.is_private = false
      AND (
        bd.filter_gender = 'all'
        OR (bd.filter_gender = 'M' AND p.gender::text = 'male')
        OR (bd.filter_gender = 'F' AND p.gender::text = 'female')
      )
      AND (
        bd.filter_category = 'Supremo'
        OR p.age_category::text = bd.filter_category
      )
  ),
  axis_rows AS (
    SELECT
      bu.filter_gender,
      bu.filter_category,
      bu.user_id,
      ax.axis,
      ax.speed
    FROM board_users bu
    CROSS JOIN LATERAL (
      VALUES
        ('1k', bu.speed_1k),
        ('3k', bu.speed_3k),
        ('5k', bu.speed_5k),
        ('7k', bu.speed_7k),
        ('10k', bu.speed_10k),
        ('20k', bu.speed_20k)
    ) AS ax(axis, speed)
    WHERE ax.speed IS NOT NULL AND ax.speed > 0
  ),
  axis_ranks AS (
    SELECT
      filter_gender,
      filter_category,
      user_id,
      axis,
      ROW_NUMBER() OVER (
        PARTITION BY filter_gender, filter_category, axis
        ORDER BY speed DESC, user_id ASC
      )::integer AS axis_rank,
      COUNT(*) OVER (
        PARTITION BY filter_gender, filter_category, axis
      )::integer AS axis_n
    FROM axis_rows
  ),
  axis_scores AS (
    SELECT
      filter_gender,
      filter_category,
      user_id,
      axis,
      ROUND(public.fn_position_score_100(axis_rank, axis_n), 1) AS pos_score
    FROM axis_ranks
  ),
  board_scores AS (
    SELECT
      filter_gender,
      filter_category,
      user_id,
      MAX(CASE WHEN axis = '1k' THEN pos_score END) AS score_1k,
      MAX(CASE WHEN axis = '3k' THEN pos_score END) AS score_3k,
      MAX(CASE WHEN axis = '5k' THEN pos_score END) AS score_5k,
      MAX(CASE WHEN axis = '7k' THEN pos_score END) AS score_7k,
      MAX(CASE WHEN axis = '10k' THEN pos_score END) AS score_10k,
      MAX(CASE WHEN axis = '20k' THEN pos_score END) AS score_20k,
      ROUND(COALESCE(SUM(pos_score), 0), 1) AS total_score
    FROM axis_scores
    GROUP BY filter_gender, filter_category, user_id
  ),
  gc_by_gender AS (
    SELECT
      user_id,
      filter_gender,
      jsonb_object_agg(
        filter_category,
        jsonb_build_object(
          'total_score', total_score,
          'segment_scores', jsonb_build_object(
            '1k', score_1k,
            '3k', score_3k,
            '5k', score_5k,
            '7k', score_7k,
            '10k', score_10k,
            '20k', score_20k
          )
        )
      ) AS category_scores
    FROM board_scores
    WHERE total_score > 0
    GROUP BY user_id, filter_gender
  ),
  gc_scores AS (
    SELECT
      user_id,
      jsonb_object_agg(filter_gender, category_scores) AS gc_scores
    FROM gc_by_gender
    GROUP BY user_id
  ),
  with_gc AS (
    SELECT
      a.*,
      g.gc_scores,
      COALESCE(
        (g.gc_scores -> 'all' -> 'Supremo' ->> 'total_score')::numeric,
        0
      ) AS total_score,
      COALESCE(
        g.gc_scores -> 'all' -> 'Supremo' -> 'segment_scores',
        '{}'::jsonb
      ) AS segment_scores
    FROM adjusted a
    LEFT JOIN gc_scores g ON g.user_id = a.user_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'scoring_version', 3,
        'user_info', jsonb_build_object(
          'user_id', w.user_id,
          'firebase_uid', p.firebase_uid,
          'display_name', p.display_name,
          'profile_image_url', p.profile_image_url,
          'gender', p.gender::text,
          'league_category', p.league_category::text,
          'age_category', p.age_category::text,
          'is_private', p.is_private
        ),
        'total_score', w.total_score,
        'gc_scores', COALESCE(w.gc_scores, '{}'::jsonb),
        'weekly_tss', COALESCE(rv.weekly_tss, 0),
        'distance_30d_km', COALESCE(rv.distance_30d_km, 0),
        'volume_window', jsonb_build_object(
          'week_start', wb.week_start,
          'week_end', wb.week_end,
          'distance_from', (st.today - interval '30 days')::date,
          'distance_to', st.today
        ),
        'segment_scores', w.segment_scores,
        'profile_peak_performances', jsonb_build_object(
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
        ),
        'peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_1k)),
            'hr', w.pace_hr_1k
          ),
          '3k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_3k)),
            'hr', w.pace_hr_3k
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_5k)),
            'hr', w.pace_hr_5k
          ),
          '7k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_7k)),
            'hr', w.pace_hr_7k
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_10k)),
            'hr', w.pace_hr_10k
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_20k)),
            'hr', w.pace_hr_20k
          ),
          '42k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_42k)),
            'hr', w.pace_hr_42k
          )
        )
      )
      ORDER BY w.total_score DESC NULLS LAST, w.user_id
    ),
    '[]'::jsonb
  )
  FROM with_gc w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  LEFT JOIN running_volume rv ON rv.user_id = w.user_id
  CROSS JOIN week_bounds wb
  CROSS JOIN seoul_today st
  WHERE p.is_private = false
    AND w.total_score > 0;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard() IS
  'RUN v3: 슬라이딩 윈도우(1k/3k=30d, 5k/7k=60d, 10k/20k=90d) + 중·장거리 1건 30% 페널티 + GC 6축';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;

GRANT EXECUTE ON FUNCTION public.fn_running_sliding_window_days(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_running_sliding_window_days(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_running_speed_from_avg_paces(double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_running_speed_from_avg_paces(double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_running_sliding_axis_speed(text, double precision, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_running_sliding_axis_speed(text, double precision, double precision, integer) TO service_role;
