-- RUN 랭킹보드에 루트맵 기록·걷기 반영 (2026-10-27)
--  1) 루트맵(source='stelvio', activity_id 'outdoor_*') 달리기·걷기도 집계. 같은 사람의 Strava 기록이
--     시작 시각 ±60분 안에 있으면 같은 운동으로 보고 루트맵 쪽은 제외(중복 집계 방지).
--  2) 걷기(Walk): TSS·거리(종합·TSS·크루·주간 거리)에 포함. 구간 페이스 순위는 달리기만.
--  3) 루트맵 달리기·걷기 TSS: 페이스 기반 rTSS = 이동시간(h) × IF² × 100,
--     IF = 평균 속도 ÷ 기준 속도(최근 180일 10k 최고 속도 × 0.95, 없으면 3.0m/s ≈ 10.8km/h), IF ≤ 1.2, TSS ≤ 400.

CREATE OR REPLACE FUNCTION public.fn_run_rank_source_ok(a public.activities)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.source = 'strava'
      OR (a.source = 'stelvio' AND a.activity_id LIKE 'outdoor\_%'
          AND NOT EXISTS (
            SELECT 1 FROM public.activities s
             WHERE s.user_id = a.user_id AND s.source = 'strava'
               AND s.start_date IS NOT NULL AND a.start_date IS NOT NULL
               AND s.start_date BETWEEN a.start_date - interval '60 minutes' AND a.start_date + interval '60 minutes'));
$$;

CREATE OR REPLACE FUNCTION public.fn_outdoor_run_tss(p_uid uuid, p_date date, p_km numeric, p_sec integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH thr AS (
    SELECT least(6.0, greatest(2.2, coalesce((
      SELECT max(r.speed_10k) * 0.95
        FROM public.run_activity_efforts r
        JOIN public.activities a ON a.user_id = r.user_id AND a.activity_id = r.activity_id
       WHERE r.user_id = p_uid AND public.fn_is_running_activity_type(a.activity_type)
         AND a.activity_date BETWEEN coalesce(p_date, current_date) - 180 AND coalesce(p_date, current_date)
         AND r.speed_10k > 0), 3.0))) AS v
  )
  SELECT CASE WHEN coalesce(p_sec, 0) <= 0 OR coalesce(p_km, 0) <= 0 THEN 0
    ELSE least(400, round(((p_sec / 3600.0) * power(least(1.2, (p_km * 1000.0 / p_sec) / (SELECT v FROM thr)), 2) * 100)::numeric, 1)) END;
$$;

DO $do$
DECLARE d text; d2 text; n int;
BEGIN
  -- get_running_leaderboard: 구간(달리기만) · 주간 TSS/거리(걷기 포함)
  d := pg_get_functiondef('public.get_running_leaderboard()'::regprocedure);
  n := (length(d) - length(replace(d, $a$WHERE a.source = 'strava'$a$, ''))) / length($a$WHERE a.source = 'strava'$a$);
  IF n <> 2 THEN RAISE EXCEPTION 'get_running_leaderboard: expected 2 strava filters, got %', n; END IF;
  d2 := replace(d, $a$WHERE a.source = 'strava'$a$, $b$WHERE public.fn_run_rank_source_ok(a)$b$);
  IF position($a$public.fn_is_running_activity_type(a.activity_type)
      AND (
$a$ in d2) = 0 THEN RAISE EXCEPTION 'get_running_leaderboard: volume type filter not found'; END IF;
  d2 := replace(d2, $a$public.fn_is_running_activity_type(a.activity_type)
      AND (
$a$, $b$(public.fn_is_running_activity_type(a.activity_type) OR lower(btrim(coalesce(a.activity_type, ''))) = 'walk')
      AND (
$b$);
  EXECUTE d2;

  -- get_running_weekly_distance_leaderboard: 걷기 포함
  d := pg_get_functiondef('public.get_running_weekly_distance_leaderboard(integer)'::regprocedure);
  IF position($a$a.source = 'strava'$a$ in d) = 0 THEN RAISE EXCEPTION 'weekly distance: strava filter not found'; END IF;
  d2 := replace(d, $a$a.source = 'strava'$a$, $b$public.fn_run_rank_source_ok(a)$b$);
  d2 := replace(d2, $a$public.fn_is_running_activity_type(a.activity_type)$a$, $b$(public.fn_is_running_activity_type(a.activity_type) OR lower(btrim(coalesce(a.activity_type, ''))) = 'walk')$b$);
  EXECUTE d2;

  -- fn_save_outdoor_activity: 달리기·걷기 TSS 계산해 저장
  d := pg_get_functiondef('public.fn_save_outdoor_activity(jsonb)'::regprocedure);
  IF position($a$v_elev, coalesce(v_elev, 0), v_avg, 0,$a$ in d) = 0
     OR position($a$total_elevation_gain = coalesce(v_elev, 0), avg_speed_kmh = v_avg,$a$ in d) = 0 THEN
    RAISE EXCEPTION 'fn_save_outdoor_activity: expected text not found';
  END IF;
  d2 := replace(d, $a$v_elev, coalesce(v_elev, 0), v_avg, 0,$a$,
                   $b$v_elev, coalesce(v_elev, 0), v_avg, public.fn_outdoor_run_tss(v_uid, v_date, v_km, coalesce(nullif(v_moving, 0), v_dur)),$b$);
  d2 := replace(d2, $a$total_elevation_gain = coalesce(v_elev, 0), avg_speed_kmh = v_avg,$a$,
                    $b$total_elevation_gain = coalesce(v_elev, 0), avg_speed_kmh = v_avg,
      tss = public.fn_outdoor_run_tss(v_uid, v_date, v_km, coalesce(nullif(v_moving, 0), v_dur)),$b$);
  EXECUTE d2;
END
$do$;

-- 기존 루트맵 달리기·걷기 TSS 채우기
UPDATE public.activities a
   SET tss = public.fn_outdoor_run_tss(a.user_id, a.activity_date, a.distance_km, coalesce(nullif(a.moving_time, 0), a.duration_sec)),
       updated_at = now()
 WHERE a.source = 'stelvio' AND a.activity_id LIKE 'outdoor\_%' AND coalesce(a.tss, 0) = 0;
