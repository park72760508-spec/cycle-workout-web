-- Firebase ranking_aggregates 제거를 위한 Supabase 랭킹 완전 이관 보강.
-- 1) public.users에 Firebase UID 역매핑을 보관해 Functions 랭킹 조회의 Firestore users 전체 스캔을 제거한다.
-- 2) 비-GC 랭킹 등락 스냅샷을 Supabase에서 직접 생성해 Firestore peak_rank_history를 대체한다.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS firebase_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON public.users (firebase_uid)
  WHERE firebase_uid IS NOT NULL AND firebase_uid <> '';

CREATE OR REPLACE VIEW public.v_user_public_profile AS
SELECT
  u.id,
  CASE WHEN u.is_private THEN '비공개'::text ELSE u.name END AS display_name,
  u.profile_image_url,
  u.gender,
  u.challenge,
  u.birth_year,
  public.fn_user_league_category(u) AS league_category,
  public.fn_user_age_category(u) AS age_category,
  u.is_private,
  u.grade,
  u.firebase_uid
FROM public.users u
WHERE u.account_status = 'active';

GRANT SELECT ON public.v_user_public_profile TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_effective_week_start_kst()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('week', timezone('Asia/Seoul', now()))::date;
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_peak_rank_board_snapshot_from_rows(
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
        r->>'firebase_uid' AS firebase_uid,
        COALESCE(NULLIF(r->>'league_category', ''), 'Supremo') AS league_category,
        NULLIF(r->>'score', '')::numeric AS score
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
      WHERE r->>'firebase_uid' IS NOT NULL
        AND btrim(r->>'firebase_uid') <> ''
        AND NULLIF(r->>'score', '')::numeric > 0
    ),
    ranked AS (
      SELECT
        firebase_uid,
        row_number() OVER (ORDER BY score DESC, firebase_uid ASC) AS board_rank
      FROM src
      WHERE cat = 'Supremo'
         OR league_category = cat
    )
    SELECT COALESCE(jsonb_object_agg(firebase_uid, board_rank), '{}'::jsonb)
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
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rebuild_peak_rank_board_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  genders text[] := ARRAY['all', 'M', 'F'];
  g text;
  dur record;
  rows_payload jsonb;
  week_start date := public.fn_effective_week_start_kst();
  week_end date := public.fn_effective_week_start_kst() + 6;
  dist_start date := public.fn_seoul_date_kst() - 29;
  dist_end date := public.fn_seoul_date_kst();
BEGIN
  FOR g IN SELECT unnest(genders) LOOP
    FOR dur IN
      SELECT * FROM (VALUES
        ('max', 'peak_max_wkg'),
        ('1min', 'peak_1min_wkg'),
        ('5min', 'peak_5min_wkg'),
        ('10min', 'peak_10min_wkg'),
        ('20min', 'peak_20min_wkg'),
        ('40min', 'peak_40min_wkg'),
        ('60min', 'peak_60min_wkg')
      ) AS d(duration_type, score_column)
    LOOP
      EXECUTE format(
        $fmt$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'firebase_uid', u.firebase_uid,
          'league_category', mv.league_category,
          'score', %1$I
        )), '[]'::jsonb)
        FROM public.mv_leaderboard_peak_28d mv
        JOIN public.users u ON u.id = mv.user_id
        WHERE %1$I > 0
          AND u.firebase_uid IS NOT NULL
          AND ($1 = 'all'
            OR ($1 = 'M' AND mv.gender = 'male')
            OR ($1 = 'F' AND mv.gender = 'female'))
        $fmt$,
        dur.score_column
      )
      INTO rows_payload
      USING g;

      PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
        format('peak_%s_monthly_%s', dur.duration_type, g),
        rows_payload
      );
    END LOOP;

    WITH weekly AS (
      SELECT
        d.user_id,
        ROUND(COALESCE(SUM(public.fn_effective_day_tss(d)), 0)::numeric, 2) AS weekly_tss,
        COALESCE(bool_or(
          (COALESCE(d.tss_strava_sum, 0) > 0 AND d.tss_strava_sum >= 500)
          OR (COALESCE(d.tss_strava_sum, 0) = 0 AND COALESCE(d.tss_stelvio_sum, 0) >= 500)
        ), false) AS weekly_has_cheat_day
      FROM public.daily_summaries d
      WHERE d.summary_date BETWEEN week_start AND week_end
      GROUP BY d.user_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', p.firebase_uid,
      'league_category', p.league_category,
      'score', w.weekly_tss
    )), '[]'::jsonb)
      INTO rows_payload
    FROM weekly w
    JOIN public.v_user_public_profile p ON p.id = w.user_id
    WHERE w.weekly_tss > 0
      AND w.weekly_has_cheat_day = false
      AND p.firebase_uid IS NOT NULL
      AND (g = 'all'
        OR (g = 'M' AND p.gender = 'male')
        OR (g = 'F' AND p.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_tss_weekly_%s', g),
      rows_payload
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', u.firebase_uid,
      'league_category', mv.league_category,
      'score', mv.distance_30d_km
    )), '[]'::jsonb)
      INTO rows_payload
    FROM public.mv_leaderboard_distance_30d mv
    JOIN public.users u ON u.id = mv.user_id
    WHERE mv.distance_30d_km > 0
      AND u.firebase_uid IS NOT NULL
      AND (g = 'all'
        OR (g = 'M' AND mv.gender = 'male')
        OR (g = 'F' AND mv.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_personal_dist_rolling30_%s', g),
      rows_payload
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'firebase_uid', u.firebase_uid,
      'league_category', mv.league_category,
      'score', mv.speed_28d_kmh
    )), '[]'::jsonb)
      INTO rows_payload
    FROM public.mv_leaderboard_speed_28d mv
    JOIN public.users u ON u.id = mv.user_id
    WHERE mv.speed_28d_kmh > 0
      AND u.firebase_uid IS NOT NULL
      AND (g = 'all'
        OR (g = 'M' AND mv.gender = 'male')
        OR (g = 'F' AND mv.gender = 'female'));

    PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
      format('peak_personal_speed_rolling28d_%s', g),
      rows_payload
    );
  END LOOP;

  WITH ride_parts AS (
    SELECT
      o.host_user_id,
      p.user_id AS participant_user_id,
      o.ride_date
    FROM public.open_rides o
    JOIN public.open_ride_participants p ON p.ride_id = o.id
    WHERE o.ride_date BETWEEN dist_start AND dist_end
      AND (o.status IS NULL OR o.status <> 'cancelled'::public.open_ride_status)
      AND COALESCE(p.is_waitlist, false) = false
  ),
  host_scores AS (
    SELECT
      rp.host_user_id,
      SUM(CASE
        WHEN COALESCE(ds.km_strava_sum, 0) > 0 THEN COALESCE(ds.km_strava_sum, 0)
        ELSE COALESCE(ds.km_stelvio_sum, 0)
      END)::numeric AS total_km
    FROM ride_parts rp
    JOIN public.daily_summaries ds
      ON ds.user_id = rp.participant_user_id
     AND ds.summary_date = rp.ride_date
    GROUP BY rp.host_user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'firebase_uid', p.firebase_uid,
    'league_category', 'Supremo',
    'score', h.total_km
  )), '[]'::jsonb)
    INTO rows_payload
  FROM host_scores h
  JOIN public.v_user_public_profile p ON p.id = h.host_user_id
  WHERE h.total_km > 0
    AND p.firebase_uid IS NOT NULL;

  PERFORM public.fn_rebuild_peak_rank_board_snapshot_from_rows(
    'peak_group_dist_rolling30_all',
    rows_payload
  );

  PERFORM public.fn_touch_ranking_build_meta('peak_rank_board_snapshots', 'complete', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_peak_reward_leaderboard(
  p_start date,
  p_end date,
  p_duration text,
  p_gender text DEFAULT 'all'
)
RETURNS TABLE (
  user_id uuid,
  firebase_uid text,
  display_name text,
  profile_image_url text,
  gender text,
  league_category text,
  peak_wkg numeric,
  peak_watts numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  watts_col text;
BEGIN
  watts_col := CASE p_duration
    WHEN '1min' THEN 'max_1min_watts'
    WHEN '5min' THEN 'max_5min_watts'
    WHEN '10min' THEN 'max_10min_watts'
    WHEN '20min' THEN 'max_20min_watts'
    WHEN '40min' THEN 'max_40min_watts'
    WHEN '60min' THEN 'max_60min_watts'
    WHEN 'max' THEN 'max_watts'
    ELSE NULL
  END;

  IF watts_col IS NULL THEN
    RAISE EXCEPTION 'invalid duration: %', p_duration;
  END IF;

  RETURN QUERY EXECUTE format(
    $fmt$
    WITH per_day AS (
      SELECT
        d.user_id,
        CASE
          WHEN COALESCE(d.weight_used_kg, 0) > 0 AND COALESCE(d.%1$I, 0) > 0
            THEN ROUND((d.%1$I / d.weight_used_kg)::numeric, 2)
          ELSE 0::numeric
        END AS day_wkg,
        COALESCE(d.%1$I, 0)::numeric AS day_watts
      FROM public.daily_summaries d
      WHERE d.summary_date BETWEEN $1 AND $2
    ),
    ranked_source AS (
      SELECT DISTINCT ON (pd.user_id)
        pd.user_id,
        pd.day_wkg AS peak_wkg,
        pd.day_watts AS peak_watts
      FROM per_day pd
      WHERE pd.day_wkg > 0
      ORDER BY pd.user_id, pd.day_wkg DESC, pd.day_watts DESC
    )
    SELECT
      rs.user_id,
      p.firebase_uid,
      p.display_name,
      p.profile_image_url,
      p.gender::text,
      p.league_category,
      rs.peak_wkg,
      rs.peak_watts
    FROM ranked_source rs
    JOIN public.v_user_public_profile p ON p.id = rs.user_id
    WHERE p.firebase_uid IS NOT NULL
      AND ($3 = 'all'
        OR ($3 = 'M' AND p.gender = 'male')
        OR ($3 = 'F' AND p.gender = 'female'))
    ORDER BY rs.peak_wkg DESC, rs.peak_watts DESC, p.firebase_uid ASC
    $fmt$,
    watts_col
  )
  USING p_start, p_end, COALESCE(NULLIF(p_gender, ''), 'all');
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_rebuild_peak_rank_board_snapshot_from_rows(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_peak_rank_board_snapshots() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_peak_reward_leaderboard(date, date, text, text) TO service_role;

DO $unschedule$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR r IN
      SELECT jobid, jobname FROM cron.job
      WHERE jobname IN ('stelvio_rebuild_rank_snapshots_0335_kst')
    LOOP
      PERFORM cron.unschedule(r.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'stelvio_rebuild_rank_snapshots_0335_kst',
      '35 18 * * *',
      $cmd$SELECT public.fn_rebuild_peak_rank_board_snapshots();$cmd$
    );
  END IF;
END;
$unschedule$;
