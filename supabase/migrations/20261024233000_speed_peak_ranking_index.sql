-- 평속 랭킹 조회 속도(2026-10-24): 90일 rides 전체를 훑다 anon 3초 제한에 걸림 → 평속 값이 있는 기록만 색인으로 바로 찾음
DROP INDEX IF EXISTS public.rides_speed_rank_date_idx;
CREATE INDEX IF NOT EXISTS rides_speed_peak_date_idx ON public.rides (ride_date) WHERE max_1min_speed_kmh IS NOT NULL;
CREATE OR REPLACE FUNCTION public.fn_speed_peak_ranking(p_duration text, p_gender text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text := CASE p_duration
    WHEN 'spd_1min' THEN 'rank_1min_speed_kmh' WHEN 'spd_5min' THEN 'rank_5min_speed_kmh'
    WHEN 'spd_10min' THEN 'rank_10min_speed_kmh' WHEN 'spd_20min' THEN 'rank_20min_speed_kmh'
    WHEN 'spd_40min' THEN 'rank_40min_speed_kmh' WHEN 'spd_60min' THEN 'rank_60min_speed_kmh' END;
  v_end date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_start date := (now() AT TIME ZONE 'Asia/Seoul')::date - 89;
  v_year int := extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))::int;
  v_g text := CASE lower(coalesce(p_gender, 'all')) WHEN 'm' THEN 'male' WHEN 'male' THEN 'male' WHEN 'f' THEN 'female' WHEN 'female' THEN 'female' ELSE NULL END;
  v_rows jsonb;
BEGIN
  IF v_col IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown duration');
  END IF;
  EXECUTE format($q$
    WITH r AS (
      SELECT user_id, %1$I::numeric AS v,
             row_number() OVER (PARTITION BY user_id ORDER BY %1$I DESC) AS rn
        FROM rides
       WHERE max_1min_speed_kmh IS NOT NULL AND ride_date BETWEEN $1 AND $2 AND %1$I > 0
    ), a AS (
      SELECT user_id, round(avg(v), 1) AS speed, max(v) AS best, count(*) AS n FROM r WHERE rn <= 2 GROUP BY user_id
    ), u AS (
      SELECT a.*, us.firebase_uid, us.name, us.gender::text AS gender, us.is_private, us.profile_image_url, us.account_status::text AS account_status,
             CASE WHEN us.challenge::text IN ('Elite', 'PRO') THEN 'Assoluto'
                  WHEN us.birth_year IS NULL THEN NULL
                  WHEN $3 - us.birth_year <= 39 THEN 'Bianco'
                  WHEN $3 - us.birth_year <= 49 THEN 'Rosa'
                  WHEN $3 - us.birth_year <= 59 THEN 'Infinito'
                  ELSE 'Leggenda' END AS cat
        FROM a JOIN users us ON us.id = a.user_id
       WHERE us.firebase_uid IS NOT NULL
         AND coalesce(us.is_active, true)
         AND lower(coalesce(us.account_status::text, 'active')) NOT IN ('withdrawn', 'suspended', 'inactive', 'deleted')
         AND lower(coalesce(us.legacy_status::text, '')) NOT IN ('withdrawn', 'inactive', 'deleted')
         AND ($4::text IS NULL OR us.gender::text = $4)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'userId', firebase_uid, 'name', coalesce(nullif(btrim(name), ''), '(이름 없음)'),
             'speedKmh', speed, 'bestSpeedKmh', best, 'rideCount', n,
             'ageCategory', cat, 'gender', coalesce(gender, ''),
             'is_private', coalesce(is_private, false), 'profileImageUrl', profile_image_url,
             'account_status', coalesce(nullif(btrim(account_status), ''), 'active'), 'isWithdrawn', false
           ) ORDER BY speed DESC, best DESC), '[]'::jsonb)
      FROM u WHERE cat IS NOT NULL
  $q$, v_col) INTO v_rows USING v_start, v_end, v_year, v_g;
  RETURN jsonb_build_object('success', true, 'durationType', p_duration, 'period', 'rolling90',
                            'startStr', v_start::text, 'endStr', v_end::text, 'gender', coalesce(p_gender, 'all'),
                            'entries', v_rows);
END;
$$;
