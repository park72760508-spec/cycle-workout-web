-- RUN 종합 탭: CYCLE GC와 동일한 포지션 점수(1위=100) × 6축(1k~20k) 합산
-- 코호트(성별×연령카테고리)별 페이스(speed DESC) 순위 → fn_position_score_100 → total_score

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
  FROM with_gc w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  LEFT JOIN running_volume rv ON rv.user_id = w.user_id
  CROSS JOIN week_bounds wb
  CROSS JOIN seoul_today st
  WHERE p.is_private = false
    AND w.total_score > 0;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard() IS
  'RUN 랭킹: 30일 피크 → 단조 보정 → 6축(1k~20k) 코호트별 포지션 점수 합산(CYCLE GC 방식)';

-- 스냅샷: 코호트별 gc_scores 사용
CREATE OR REPLACE FUNCTION public.fn_run_leaderboard_score_rows(
  p_leaderboard jsonb,
  p_gender text,
  p_metric text,
  p_pace_dist text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', sub.user_id,
        'age_category', sub.age_category,
        'league_category', sub.league_category,
        'score', sub.score_val,
        'gc_board', sub.gc_board
      )
      ORDER BY sub.score_val DESC NULLS LAST, sub.user_id ASC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      r->'user_info'->>'user_id' AS user_id,
      COALESCE(NULLIF(btrim(r->'user_info'->>'age_category'), ''), 'Supremo') AS age_category,
      COALESCE(NULLIF(btrim(r->'user_info'->>'league_category'), ''), 'Supremo') AS league_category,
      CASE p_metric
        WHEN 'overall' THEN NULL
        WHEN 'tss' THEN NULLIF(r->>'weekly_tss', '')::numeric
        WHEN 'distance' THEN NULLIF(r->>'distance_30d_km', '')::numeric
        WHEN 'pace' THEN
          CASE
            WHEN public.fn_parse_running_pace_mmss(r->'peak_performances'->p_pace_dist->>'pace') IS NOT NULL THEN
              -public.fn_parse_running_pace_mmss(r->'peak_performances'->p_pace_dist->>'pace')
            ELSE NULL
          END
        ELSE NULL
      END AS score_val,
      CASE p_metric
        WHEN 'overall' THEN COALESCE(r->'gc_scores'->COALESCE(NULLIF(btrim(p_gender), ''), 'all'), '{}'::jsonb)
        ELSE NULL
      END AS gc_board
    FROM jsonb_array_elements(COALESCE(p_leaderboard, '[]'::jsonb)) AS r
    WHERE COALESCE((r->'user_info'->>'is_private')::boolean, false) = false
      AND r->'user_info'->>'user_id' IS NOT NULL
      AND btrim(r->'user_info'->>'user_id') <> ''
      AND (
        COALESCE(NULLIF(btrim(p_gender), ''), 'all') = 'all'
        OR (p_gender = 'M' AND r->'user_info'->>'gender' = 'male')
        OR (p_gender = 'F' AND r->'user_info'->>'gender' = 'female')
      )
  ) sub
  WHERE (
    p_metric = 'overall'
    AND sub.gc_board IS NOT NULL
    AND sub.gc_board <> '{}'::jsonb
  ) OR (
    p_metric <> 'overall'
    AND sub.score_val IS NOT NULL
    AND (
      (p_metric = 'pace' AND sub.score_val < 0)
      OR (p_metric <> 'pace' AND sub.score_val > 0)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_run_rank_board_snapshot_from_rows(
  p_history_key text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today date := public.fn_seoul_date_kst();
  categories text[] := ARRAY['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
  cat text;
  prev record;
  curr_map jsonb;
  prev_ranks_cat jsonb;
  prev_day_in jsonb;
  frozen_prev_day jsonb;
  baseline jsonb;
  ranks_by_cat jsonb := '{}'::jsonb;
  changes_by_cat jsonb := '{}'::jsonb;
  previous_by_cat jsonb := '{}'::jsonb;
  prev_day_by_cat jsonb := '{}'::jsonb;
  uid text;
  curr_rank_text text;
  prev_rank integer;
  change_map jsonb;
  previous_map jsonb;
BEGIN
  IF p_history_key IS NULL OR btrim(p_history_key) = '' THEN
    RAISE EXCEPTION 'history_key required';
  END IF;

  SELECT *
    INTO prev
  FROM public.peak_rank_board_snapshots
  WHERE history_key = p_history_key;

  FOREACH cat IN ARRAY categories LOOP
    WITH src AS (
      SELECT
        r->>'user_id' AS user_id,
        COALESCE(NULLIF(btrim(r->>'age_category'), ''), 'Supremo') AS age_category,
        COALESCE(
          NULLIF(r->'gc_board'->cat->>'total_score', '')::numeric,
          NULLIF(r->>'score', '')::numeric
        ) AS score
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
      WHERE r->>'user_id' IS NOT NULL
        AND btrim(r->>'user_id') <> ''
        AND COALESCE(
          NULLIF(r->'gc_board'->cat->>'total_score', '')::numeric,
          NULLIF(r->>'score', '')::numeric
        ) IS NOT NULL
    ),
    ranked AS (
      SELECT
        user_id,
        row_number() OVER (ORDER BY score DESC, user_id ASC) AS board_rank
      FROM src
      WHERE cat = 'Supremo'
         OR age_category = cat
    )
    SELECT COALESCE(jsonb_object_agg(user_id, board_rank), '{}'::jsonb)
      INTO curr_map
    FROM ranked;

    IF curr_map = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    prev_ranks_cat := COALESCE(prev.ranks_by_category -> cat, '{}'::jsonb);
    prev_day_in := COALESCE(prev.prev_day_ranks_by_category -> cat, '{}'::jsonb);

    IF (prev.as_of_seoul IS NULL OR prev.as_of_seoul < today) AND prev_ranks_cat <> '{}'::jsonb THEN
      frozen_prev_day := prev_ranks_cat;
    ELSE
      frozen_prev_day := prev_day_in;
    END IF;

    IF frozen_prev_day <> '{}'::jsonb THEN
      baseline := frozen_prev_day;
    ELSE
      baseline := prev_ranks_cat;
    END IF;

    change_map := '{}'::jsonb;
    previous_map := '{}'::jsonb;

    FOR uid, curr_rank_text IN
      SELECT key, value FROM jsonb_each_text(curr_map)
    LOOP
      IF baseline ? uid THEN
        prev_rank := NULLIF(baseline ->> uid, '')::integer;
        IF prev_rank IS NOT NULL AND prev_rank >= 1 THEN
          change_map := change_map || jsonb_build_object(uid, prev_rank - curr_rank_text::integer);
          previous_map := previous_map || jsonb_build_object(uid, prev_rank);
        END IF;
      END IF;
    END LOOP;

    ranks_by_cat := ranks_by_cat || jsonb_build_object(cat, curr_map);
    changes_by_cat := changes_by_cat || jsonb_build_object(cat, change_map);
    previous_by_cat := previous_by_cat || jsonb_build_object(cat, previous_map);
    prev_day_by_cat := prev_day_by_cat || jsonb_build_object(cat, frozen_prev_day);
  END LOOP;

  INSERT INTO public.peak_rank_board_snapshots (
    history_key,
    as_of_seoul,
    ranks_by_category,
    rank_changes_by_category,
    previous_ranks_by_category,
    prev_day_ranks_by_category,
    updated_at
  )
  VALUES (
    p_history_key,
    today,
    ranks_by_cat,
    changes_by_cat,
    previous_by_cat,
    prev_day_by_cat,
    now()
  )
  ON CONFLICT (history_key) DO UPDATE SET
    as_of_seoul = EXCLUDED.as_of_seoul,
    ranks_by_category = EXCLUDED.ranks_by_category,
    rank_changes_by_category = EXCLUDED.rank_changes_by_category,
    previous_ranks_by_category = EXCLUDED.previous_ranks_by_category,
    prev_day_ranks_by_category = EXCLUDED.prev_day_ranks_by_category,
    updated_at = EXCLUDED.updated_at;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;
