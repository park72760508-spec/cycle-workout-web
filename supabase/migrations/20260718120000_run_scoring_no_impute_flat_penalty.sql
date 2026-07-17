-- RUN 랭킹 종합점수 v8: 구간 간 백필(보간) 완전 제거 + 기록 횟수 미달 시 단순 15% 페널티로 교체.
--
-- 변경 전(v7, 20260703120000_run_leaderboard_private_mask.sql):
--   1) fn_running_impute_shorter_speeds — 특정 구간(예: 1k) 기록이 없으면 더 긴 구간(3k→5k→...→42k)
--      페이스를 빌려와 채움. 진짜 안 뛴 구간도 항상 "기록 있음"으로 잡혀 순위/점수에 반영됨.
--   2) 기록 횟수가 기준(1k/3k/5k/7k=3회, 10k=2회) 미달이면 30% 느린 가상기록을 평균에 섞는
--      복잡한 페널티(fn_running_top3_penalty_speed_1record/2records, fn_running_penalty_speed_from_best).
--
-- 변경 후(v8):
--   1) 백필 전면 제거 — 각 구간은 그 구간의 진짜 기록만 사용. 진짜 기록이 전혀 없는 구간은
--      axis_rows에 행 자체가 안 생겨 SUM(pos_score)에서 자동으로 0점 기여(코드 변경 불필요, 기존 NULL 제외 로직 재사용).
--   2) 1k/3k/5k/7k(3회 미만)·10k(2회 미만) 기록 횟수 미달 시: 그 구간 최고 기록 하나의 속도 × 0.85(15% 페널티)만 적용.
--      기준 충족 시(Top3/Top2 평균)는 기존과 동일.
--   3) 20k는 이 페널티 로직 대상에서 제외 — 최고기록 1건만 있어도 페널티 없이 그대로 사용(기존과 동일).
--      단, 더 이상 42k로부터 백필되지 않음(1번 변경의 자연스러운 결과).
--
-- 배포 직후 강제 재발행 포함 — 실행 즉시 전체 RUN 참가자의 점수·순위가 새 로직으로 바뀐다.

CREATE OR REPLACE FUNCTION public.get_running_leaderboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week_bounds AS (
    SELECT wr.week_start, wr.week_end, public.fn_seoul_today() AS week_sum_as_of
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
    CROSS JOIN seoul_today st
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
      AND COALESCE(
        a.activity_date,
        (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
      ) >= (st.today - interval '180 days')::date
      AND COALESCE(
        a.activity_date,
        (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
      ) <= st.today
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
      mono.speed_1k,
      mono.speed_3k,
      mono.speed_5k,
      mono.speed_7k,
      mono.speed_10k,
      mono.speed_20k,
      mono.speed_42k
    FROM efforts_joined ej
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      ej.speed_1k, ej.speed_3k, ej.speed_5k, ej.speed_7k, ej.speed_10k, ej.speed_20k, ej.speed_42k
    ) AS mono(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
    WHERE COALESCE(mono.speed_1k, 0) > 0
       OR COALESCE(mono.speed_3k, 0) > 0
       OR COALESCE(mono.speed_5k, 0) > 0
       OR COALESCE(mono.speed_7k, 0) > 0
       OR COALESCE(mono.speed_10k, 0) > 0
       OR COALESCE(mono.speed_20k, 0) > 0
       OR COALESCE(mono.speed_42k, 0) > 0
  ),
  axis_activity_peaks AS (
    SELECT
      am.user_id,
      am.activity_id,
      am.act_date,
      v.axis,
      v.speed,
      v.hr
    FROM activity_mono am
    CROSS JOIN seoul_today st
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
      AND am.act_date <= st.today
      AND (
        (v.axis IN ('1k', '3k', '5k', '7k', '10k')
          AND am.act_date >= (st.today - interval '90 days')::date)
        OR (v.axis IN ('20k', '42k')
          AND am.act_date >= (st.today - interval '180 days')::date)
      )
  ),
  axis_daily_best AS (
    SELECT
      ap.user_id,
      ap.axis,
      ap.act_date,
      MAX(ap.speed) AS day_speed,
      (array_agg(ap.hr ORDER BY ap.speed DESC, ap.activity_id))[1] AS day_hr
    FROM axis_activity_peaks ap
    GROUP BY ap.user_id, ap.axis, ap.act_date
  ),
  axis_daily_ranked AS (
    SELECT
      adb.user_id,
      adb.axis,
      adb.act_date,
      adb.day_speed,
      adb.day_hr,
      ROW_NUMBER() OVER (
        PARTITION BY adb.user_id, adb.axis
        ORDER BY adb.day_speed DESC, adb.act_date DESC
      ) AS day_rank,
      COUNT(*) OVER (
        PARTITION BY adb.user_id, adb.axis
      )::integer AS day_count
    FROM axis_daily_best adb
  ),
  short_sliding AS (
    SELECT
      adr.user_id,
      adr.axis,
      CASE
        WHEN MAX(adr.day_count) >= 3 THEN
          public.fn_running_speed_from_avg_paces_3(
            public.fn_running_pace_sec_per_km(MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 1)),
            public.fn_running_pace_sec_per_km(MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 2)),
            public.fn_running_pace_sec_per_km(MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 3))
          )
        ELSE
          MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 1) * 0.85
      END AS agg_speed,
      (array_agg(adr.day_hr ORDER BY adr.day_rank))[1] AS best_hr,
      (MAX(adr.day_count) < 3) AS is_penalty_applied
    FROM axis_daily_ranked adr
    WHERE adr.axis IN ('1k', '3k', '5k', '7k')
    GROUP BY adr.user_id, adr.axis
    HAVING MAX(adr.day_count) >= 1
  ),
  long_sliding AS (
    SELECT
      adr.user_id,
      adr.axis,
      CASE
        WHEN MAX(adr.day_count) >= 2 THEN
          public.fn_running_speed_from_avg_paces(
            public.fn_running_pace_sec_per_km(MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 1)),
            public.fn_running_pace_sec_per_km(MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 2))
          )
        ELSE
          MAX(adr.day_speed) FILTER (WHERE adr.day_rank = 1) * 0.85
      END AS agg_speed,
      (array_agg(adr.day_hr ORDER BY adr.day_rank))[1] AS best_hr,
      (MAX(adr.day_count) = 1) AS is_penalty_applied
    FROM axis_daily_ranked adr
    WHERE adr.axis = '10k'
    GROUP BY adr.user_id, adr.axis
    HAVING MAX(adr.day_count) >= 1
  ),
  ultra_best_sliding AS (
    SELECT
      adb.user_id,
      adb.axis,
      MAX(adb.day_speed) AS agg_speed,
      (array_agg(adb.day_hr ORDER BY adb.day_speed DESC, adb.act_date DESC))[1] AS best_hr,
      false AS is_penalty_applied
    FROM axis_daily_best adb
    WHERE adb.axis IN ('20k', '42k')
    GROUP BY adb.user_id, adb.axis
    HAVING MAX(adb.day_speed) > 0
  ),
  sliding_peaks AS (
    SELECT user_id, axis, agg_speed, best_hr, is_penalty_applied FROM short_sliding
    UNION ALL
    SELECT user_id, axis, agg_speed, best_hr, is_penalty_applied FROM long_sliding
    UNION ALL
    SELECT user_id, axis, agg_speed, best_hr, is_penalty_applied FROM ultra_best_sliding
  ),
  sliding_pivot AS (
    SELECT
      sp.user_id,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '1k') AS raw_1k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '1k') AS hr_1k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '1k') AS penalty_1k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '3k') AS raw_3k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '3k') AS hr_3k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '3k') AS penalty_3k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '5k') AS raw_5k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '5k') AS hr_5k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '5k') AS penalty_5k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '7k') AS raw_7k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '7k') AS hr_7k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '7k') AS penalty_7k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '10k') AS raw_10k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '10k') AS hr_10k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '10k') AS penalty_10k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '20k') AS raw_20k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '20k') AS hr_20k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '20k') AS penalty_20k,
      MAX(sp.agg_speed) FILTER (WHERE sp.axis = '42k') AS raw_42k,
      MAX(sp.best_hr) FILTER (WHERE sp.axis = '42k') AS hr_42k,
      BOOL_OR(sp.is_penalty_applied) FILTER (WHERE sp.axis = '42k') AS penalty_42k
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
      sp.penalty_1k,
      sp.penalty_3k,
      sp.penalty_5k,
      sp.penalty_7k,
      sp.penalty_10k,
      sp.penalty_20k,
      sp.penalty_42k,
      mono.speed_1k,
      mono.speed_3k,
      mono.speed_5k,
      mono.speed_7k,
      mono.speed_10k,
      mono.speed_20k,
      mono.speed_42k
    FROM sliding_pivot sp
    CROSS JOIN LATERAL public.fn_running_enforce_monotonic_speeds(
      sp.raw_1k, sp.raw_3k, sp.raw_5k, sp.raw_7k, sp.raw_10k, sp.raw_20k, sp.raw_42k
    ) AS mono(
      speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k
    )
  ),
  gc_profile AS (
    SELECT * FROM sliding_mono
  ),
  pace_peaks AS (
    SELECT * FROM sliding_mono
  ),
  running_volume AS (
    SELECT
      a.user_id,
      ROUND(
        COALESCE(
          SUM(COALESCE(a.tss, 0)) FILTER (
            WHERE public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              >= wb.week_start
              AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              <= wb.week_sum_as_of
          ),
          0
        )::numeric,
        1
      ) AS weekly_tss,
      ROUND(
        COALESCE(
          SUM(a.distance_km) FILTER (
            WHERE public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              >= (st.today - interval '30 days')::date
              AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              <= st.today
          ),
          0
        )::numeric,
        2
      ) AS distance_30d_km,
      ROUND(
        COALESCE(
          SUM(a.distance_km) FILTER (
            WHERE public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              >= wb.week_start
              AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
              <= wb.week_sum_as_of
          ),
          0
        )::numeric,
        2
      ) AS weekly_distance_km
    FROM public.activities a
    CROSS JOIN week_bounds wb
    CROSS JOIN seoul_today st
    WHERE a.source = 'strava'
      AND public.fn_is_running_activity_type(a.activity_type)
      AND (
        (
          public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
            >= wb.week_start
          AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
            <= wb.week_sum_as_of
        )
        OR (
          public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
            >= (st.today - interval '30 days')::date
          AND public.fn_activity_seoul_date(a.activity_date, a.updated_at, a.created_at)
            <= st.today
        )
      )
    GROUP BY a.user_id
  ),
  all_users AS (
    SELECT user_id FROM gc_profile
    UNION
    SELECT user_id FROM pace_peaks
    UNION
    SELECT user_id FROM running_volume
    WHERE weekly_tss > 0 OR distance_30d_km > 0 OR weekly_distance_km > 0
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
      gp.penalty_1k,
      gp.penalty_3k,
      gp.penalty_5k,
      gp.penalty_7k,
      gp.penalty_10k,
      gp.penalty_20k,
      gp.penalty_42k,
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
      pp.hr_42k AS pace_hr_42k,
      pp.penalty_1k AS pace_penalty_1k,
      pp.penalty_3k AS pace_penalty_3k,
      pp.penalty_5k AS pace_penalty_5k,
      pp.penalty_7k AS pace_penalty_7k,
      pp.penalty_10k AS pace_penalty_10k,
      pp.penalty_20k AS pace_penalty_20k,
      pp.penalty_42k AS pace_penalty_42k
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
    WHERE (
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
  ),
  ranked_rows AS (
    SELECT
      w.*,
      ROW_NUMBER() OVER (
        ORDER BY w.total_score DESC NULLS LAST, w.user_id
      )::integer AS ranking
    FROM with_gc w
    JOIN public.v_user_public_profile p ON p.id = w.user_id
    LEFT JOIN running_volume rv ON rv.user_id = w.user_id
    WHERE (
        COALESCE(w.total_score, 0) > 0
        OR COALESCE(rv.weekly_tss, 0) > 0
        OR COALESCE(rv.distance_30d_km, 0) > 0
        OR COALESCE(rv.weekly_distance_km, 0) > 0
      )
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'scoring_version', 8,
        'ranking', w.ranking,
        'user_info', jsonb_build_object(
          'user_id', w.user_id,
          'firebase_uid', p.firebase_uid,
          'display_name', COALESCE(NULLIF(btrim(u.name), ''), p.display_name),
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
        'weekly_distance_km', COALESCE(rv.weekly_distance_km, 0),
        'volume_window', jsonb_build_object(
          'week_start', wb.week_start,
          'week_end', wb.week_end,
          'week_sum_as_of', wb.week_sum_as_of,
          'distance_from', (st.today - interval '30 days')::date,
          'distance_to', st.today,
          'analysis_from', (st.today - interval '90 days')::date,
          'analysis_to', st.today,
          'ultra_from', (st.today - interval '180 days')::date,
          'ultra_to', st.today,
          'ultra_axes', jsonb_build_array('20k', '42k')
        ),
        'segment_scores', w.segment_scores,
        'segment_penalties', jsonb_build_object(
          '1k', COALESCE(w.penalty_1k, false),
          '3k', COALESCE(w.penalty_3k, false),
          '5k', COALESCE(w.penalty_5k, false),
          '7k', COALESCE(w.penalty_7k, false),
          '10k', COALESCE(w.penalty_10k, false),
          '20k', COALESCE(w.penalty_20k, false),
          '42k', COALESCE(w.penalty_42k, false)
        ),
        'profile_peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_1k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_1k)),
            'hr', w.hr_1k,
            'is_penalty_applied', COALESCE(w.penalty_1k, false)
          ),
          '3k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_3k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_3k)),
            'hr', w.hr_3k,
            'is_penalty_applied', COALESCE(w.penalty_3k, false)
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_5k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_5k)),
            'hr', w.hr_5k,
            'is_penalty_applied', COALESCE(w.penalty_5k, false)
          ),
          '7k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_7k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_7k)),
            'hr', w.hr_7k,
            'is_penalty_applied', COALESCE(w.penalty_7k, false)
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_10k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_10k)),
            'hr', w.hr_10k,
            'is_penalty_applied', COALESCE(w.penalty_10k, false)
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_20k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_20k)),
            'hr', w.hr_20k,
            'is_penalty_applied', COALESCE(w.penalty_20k, false)
          ),
          '42k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_42k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_42k)),
            'hr', w.hr_42k,
            'is_penalty_applied', COALESCE(w.penalty_42k, false)
          )
        ),
        'peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_1k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_1k)),
            'hr', w.pace_hr_1k,
            'is_penalty_applied', COALESCE(w.pace_penalty_1k, false)
          ),
          '3k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_3k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_3k)),
            'hr', w.pace_hr_3k,
            'is_penalty_applied', COALESCE(w.pace_penalty_3k, false)
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_5k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_5k)),
            'hr', w.pace_hr_5k,
            'is_penalty_applied', COALESCE(w.pace_penalty_5k, false)
          ),
          '7k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_7k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_7k)),
            'hr', w.pace_hr_7k,
            'is_penalty_applied', COALESCE(w.pace_penalty_7k, false)
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_10k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_10k)),
            'hr', w.pace_hr_10k,
            'is_penalty_applied', COALESCE(w.pace_penalty_10k, false)
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_20k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_20k)),
            'hr', w.pace_hr_20k,
            'is_penalty_applied', COALESCE(w.pace_penalty_20k, false)
          ),
          '42k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_42k)),
            'calculated_pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.pace_speed_42k)),
            'hr', w.pace_hr_42k,
            'is_penalty_applied', COALESCE(w.pace_penalty_42k, false)
          )
        )
      )
      ORDER BY w.ranking
    ),
    '[]'::jsonb
  )
  FROM ranked_rows w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  LEFT JOIN public.users u ON u.id = w.user_id
  LEFT JOIN running_volume rv ON rv.user_id = w.user_id
  CROSS JOIN week_bounds wb
  CROSS JOIN seoul_today st;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard() IS
  'RUN v8: 구간 간 백필(보간) 제거 — 진짜 기록만 사용, 없으면 0점. 기록 횟수 미달(1k/3k/5k/7k<3회, 10k<2회) 시 최고기록×0.85(15% 페널티). 20k는 페널티 대상 제외. 주간 TSS + 주간 거리 + 30일 거리. 비공개 사용자 포함(is_private 플래그·실명 전달, 클라 마스킹).';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;

-- 배포 직후: 새 로직(백필 제거·미달시 15% 단일기록 페널티)으로 published 스냅샷 강제 재발행 후 등락 재집계.
SELECT public.fn_persist_run_leaderboard_daily_snapshot(public.get_running_leaderboard());
SELECT public.fn_rebuild_run_rank_board_snapshots();
