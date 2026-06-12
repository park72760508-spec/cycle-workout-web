-- RUN 랭킹: Walk 제외 — Run / VirtualRun / TrailRun 만 집계

CREATE OR REPLACE FUNCTION public.fn_is_running_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_type, ''))) IN (
    'run', 'virtualrun', 'trailrun'
  );
$$;

COMMENT ON FUNCTION public.fn_is_running_activity_type(text) IS
  'RUN 랭킹·TSS·거리 집계 대상 Strava activity_type (Walk 제외)';

-- get_running_leaderboard: run_activity_efforts 는 activities.type=Run 계열만 사용

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
    INNER JOIN public.activities a
      ON a.user_id = r.user_id AND a.activity_id = r.activity_id
    CROSS JOIN seoul_today st
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
      AND COALESCE(
        a.activity_date,
        (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
      ) >= (st.today - interval '30 days')::date
  ),
  activity_mono AS (
    SELECT
      f.user_id,
      f.activity_id,
      f.hr_1k,
      f.hr_3k,
      f.hr_5k,
      f.hr_7k,
      f.hr_10k,
      f.hr_20k,
      f.hr_42k,
      im.speed_1k,
      im.speed_3k,
      im.speed_5k,
      im.speed_7k,
      im.speed_10k,
      im.speed_20k,
      im.speed_42k
    FROM filtered f
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      f.speed_1k, f.speed_3k, f.speed_5k, f.speed_7k, f.speed_10k, f.speed_20k, f.speed_42k
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
  ranked_activity AS (
    SELECT
      am.*,
      (
        (CASE WHEN am.speed_1k  > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN am.speed_3k  > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN am.speed_5k  > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN am.speed_7k  > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN am.speed_10k > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN am.speed_20k > 0 THEN 1 ELSE 0 END)
      ) AS profile_axes_filled,
      ROW_NUMBER() OVER (
        PARTITION BY am.user_id
        ORDER BY
          (
            (CASE WHEN am.speed_1k  > 0 THEN 1 ELSE 0 END)
            + (CASE WHEN am.speed_3k  > 0 THEN 1 ELSE 0 END)
            + (CASE WHEN am.speed_5k  > 0 THEN 1 ELSE 0 END)
            + (CASE WHEN am.speed_7k  > 0 THEN 1 ELSE 0 END)
            + (CASE WHEN am.speed_10k > 0 THEN 1 ELSE 0 END)
            + (CASE WHEN am.speed_20k > 0 THEN 1 ELSE 0 END)
          ) DESC,
          COALESCE(NULLIF(am.speed_20k, 0), -1) DESC,
          COALESCE(NULLIF(am.speed_10k, 0), -1) DESC,
          COALESCE(NULLIF(am.speed_7k, 0), -1) DESC,
          COALESCE(NULLIF(am.speed_5k, 0), -1) DESC,
          COALESCE(NULLIF(am.speed_3k, 0), -1) DESC,
          COALESCE(NULLIF(am.speed_1k, 0), -1) DESC,
          am.activity_id DESC
      ) AS act_rank
    FROM activity_mono am
  ),
  gc_profile AS (
    SELECT
      user_id,
      speed_1k,
      speed_3k,
      speed_5k,
      speed_7k,
      speed_10k,
      speed_20k,
      speed_42k,
      hr_1k,
      hr_3k,
      hr_5k,
      hr_7k,
      hr_10k,
      hr_20k,
      hr_42k
    FROM ranked_activity
    WHERE act_rank = 1
  ),
  pace_max AS (
    SELECT
      am.user_id,
      MAX(am.speed_1k) FILTER (WHERE am.speed_1k > 0) AS raw_1k,
      MAX(am.hr_1k) FILTER (WHERE am.speed_1k > 0) AS hr_1k,
      MAX(am.speed_3k) FILTER (WHERE am.speed_3k > 0) AS raw_3k,
      MAX(am.hr_3k) FILTER (WHERE am.speed_3k > 0) AS hr_3k,
      MAX(am.speed_5k) FILTER (WHERE am.speed_5k > 0) AS raw_5k,
      MAX(am.hr_5k) FILTER (WHERE am.speed_5k > 0) AS hr_5k,
      MAX(am.speed_7k) FILTER (WHERE am.speed_7k > 0) AS raw_7k,
      MAX(am.hr_7k) FILTER (WHERE am.speed_7k > 0) AS hr_7k,
      MAX(am.speed_10k) FILTER (WHERE am.speed_10k > 0) AS raw_10k,
      MAX(am.hr_10k) FILTER (WHERE am.speed_10k > 0) AS hr_10k,
      MAX(am.speed_20k) FILTER (WHERE am.speed_20k > 0) AS raw_20k,
      MAX(am.hr_20k) FILTER (WHERE am.speed_20k > 0) AS hr_20k,
      MAX(am.speed_42k) FILTER (WHERE am.speed_42k > 0) AS raw_42k,
      MAX(am.hr_42k) FILTER (WHERE am.speed_42k > 0) AS hr_42k
    FROM activity_mono am
    GROUP BY am.user_id
  ),
  pace_peaks AS (
    SELECT
      pm.user_id,
      pm.hr_1k,
      pm.hr_3k,
      pm.hr_5k,
      pm.hr_7k,
      pm.hr_10k,
      pm.hr_20k,
      pm.hr_42k,
      im.speed_1k,
      im.speed_3k,
      im.speed_5k,
      im.speed_7k,
      im.speed_10k,
      im.speed_20k,
      im.speed_42k
    FROM pace_max pm
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      pm.raw_1k, pm.raw_3k, pm.raw_5k, pm.raw_7k, pm.raw_10k, pm.raw_20k, pm.raw_42k
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
        'scoring_version', 2,
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
  'RUN v2: Run/VirtualRun/TrailRun only (Walk 제외) + GC 6축';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;
