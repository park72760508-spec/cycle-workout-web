-- 평속 랭킹 사용자 단위 단조 규칙(2026-10-25): 1분 ≥ 5분 ≥ 10분 ≥ 20분 ≥ 40분 ≥ 60분
-- 기록마다 순서는 맞아도, '상위 2개 평균(기록 1개면 그 값)' 단계에서 긴 구간 기록 수가 적으면(예: 40분 이상 기록 1개)
-- 긴 구간 값이 짧은 구간 평균보다 커질 수 있었다(20분 30.0 < 40분 32.4).
-- → 사용자별 6개 구간 값을 한 번에 구한 뒤, 긴 구간은 바로 앞 구간 값을 넘지 않게 맞추고(앞 구간이 없으면 비움) 요청 구간만 돌려준다.
CREATE OR REPLACE FUNCTION public.fn_speed_peak_ranking(p_duration text, p_gender text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idx int := CASE p_duration WHEN 'spd_1min' THEN 1 WHEN 'spd_5min' THEN 2 WHEN 'spd_10min' THEN 3
                               WHEN 'spd_20min' THEN 4 WHEN 'spd_40min' THEN 5 WHEN 'spd_60min' THEN 6 END;
  v_end date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_start date := (now() AT TIME ZONE 'Asia/Seoul')::date - 89;
  v_year int := extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))::int;
  v_g text := CASE lower(coalesce(p_gender, 'all')) WHEN 'm' THEN 'male' WHEN 'male' THEN 'male' WHEN 'f' THEN 'female' WHEN 'female' THEN 'female' ELSE NULL END;
  v_rows jsonb;
BEGIN
  IF v_idx IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown duration');
  END IF;
  WITH r AS (
    SELECT user_id,
           rank_1min_speed_kmh c1, row_number() OVER (PARTITION BY user_id ORDER BY rank_1min_speed_kmh DESC NULLS LAST) n1,
           rank_5min_speed_kmh c2, row_number() OVER (PARTITION BY user_id ORDER BY rank_5min_speed_kmh DESC NULLS LAST) n2,
           rank_10min_speed_kmh c3, row_number() OVER (PARTITION BY user_id ORDER BY rank_10min_speed_kmh DESC NULLS LAST) n3,
           rank_20min_speed_kmh c4, row_number() OVER (PARTITION BY user_id ORDER BY rank_20min_speed_kmh DESC NULLS LAST) n4,
           rank_40min_speed_kmh c5, row_number() OVER (PARTITION BY user_id ORDER BY rank_40min_speed_kmh DESC NULLS LAST) n5,
           rank_60min_speed_kmh c6, row_number() OVER (PARTITION BY user_id ORDER BY rank_60min_speed_kmh DESC NULLS LAST) n6
      FROM rides
     WHERE max_1min_speed_kmh IS NOT NULL AND ride_date BETWEEN v_start AND v_end
  ), a AS (
    SELECT user_id,
           round(avg(c1) FILTER (WHERE n1 <= 2 AND c1 > 0), 1) s1, max(c1) b1, count(*) FILTER (WHERE c1 > 0) k1,
           round(avg(c2) FILTER (WHERE n2 <= 2 AND c2 > 0), 1) s2, max(c2) b2, count(*) FILTER (WHERE c2 > 0) k2,
           round(avg(c3) FILTER (WHERE n3 <= 2 AND c3 > 0), 1) s3, max(c3) b3, count(*) FILTER (WHERE c3 > 0) k3,
           round(avg(c4) FILTER (WHERE n4 <= 2 AND c4 > 0), 1) s4, max(c4) b4, count(*) FILTER (WHERE c4 > 0) k4,
           round(avg(c5) FILTER (WHERE n5 <= 2 AND c5 > 0), 1) s5, max(c5) b5, count(*) FILTER (WHERE c5 > 0) k5,
           round(avg(c6) FILTER (WHERE n6 <= 2 AND c6 > 0), 1) s6, max(c6) b6, count(*) FILTER (WHERE c6 > 0) k6
      FROM r GROUP BY user_id
  ), m1 AS (SELECT a.*, s1 t1, CASE WHEN s1 IS NULL OR s2 IS NULL THEN NULL ELSE least(s2, s1) END t2 FROM a
  ), m2 AS (SELECT m1.*, CASE WHEN t2 IS NULL OR s3 IS NULL THEN NULL ELSE least(s3, t2) END t3 FROM m1
  ), m3 AS (SELECT m2.*, CASE WHEN t3 IS NULL OR s4 IS NULL THEN NULL ELSE least(s4, t3) END t4 FROM m2
  ), m4 AS (SELECT m3.*, CASE WHEN t4 IS NULL OR s5 IS NULL THEN NULL ELSE least(s5, t4) END t5 FROM m3
  ), m5 AS (SELECT m4.*, CASE WHEN t5 IS NULL OR s6 IS NULL THEN NULL ELSE least(s6, t5) END t6 FROM m4
  ), pick AS (
    SELECT user_id,
           (ARRAY[t1, t2, t3, t4, t5, t6])[v_idx] AS speed,
           (ARRAY[b1, b2, b3, b4, b5, b6])[v_idx] AS best,
           (ARRAY[k1, k2, k3, k4, k5, k6])[v_idx] AS n
      FROM m5
  ), u AS (
    SELECT pick.*, us.firebase_uid, us.name, us.gender::text AS gender, us.is_private, us.profile_image_url, us.account_status::text AS account_status,
           CASE WHEN us.challenge::text IN ('Elite', 'PRO') THEN 'Assoluto'
                WHEN us.birth_year IS NULL THEN NULL
                WHEN v_year - us.birth_year <= 39 THEN 'Bianco'
                WHEN v_year - us.birth_year <= 49 THEN 'Rosa'
                WHEN v_year - us.birth_year <= 59 THEN 'Infinito'
                ELSE 'Leggenda' END AS cat
      FROM pick JOIN users us ON us.id = pick.user_id
     WHERE pick.speed IS NOT NULL
       AND us.firebase_uid IS NOT NULL
       AND coalesce(us.is_active, true)
       AND lower(coalesce(us.account_status::text, 'active')) NOT IN ('withdrawn', 'suspended', 'inactive', 'deleted')
       AND lower(coalesce(us.legacy_status::text, '')) NOT IN ('withdrawn', 'inactive', 'deleted')
       AND (v_g IS NULL OR us.gender::text = v_g)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'userId', firebase_uid, 'name', coalesce(nullif(btrim(name), ''), '(이름 없음)'),
           'speedKmh', speed, 'bestSpeedKmh', best, 'rideCount', n,
           'ageCategory', cat, 'gender', coalesce(gender, ''),
           'is_private', coalesce(is_private, false), 'profileImageUrl', profile_image_url,
           'account_status', coalesce(nullif(btrim(account_status), ''), 'active'), 'isWithdrawn', false
         ) ORDER BY speed DESC, best DESC), '[]'::jsonb)
    INTO v_rows
    FROM u WHERE cat IS NOT NULL;
  RETURN jsonb_build_object('success', true, 'durationType', p_duration, 'period', 'rolling90',
                            'startStr', v_start::text, 'endStr', v_end::text, 'gender', coalesce(p_gender, 'all'),
                            'entries', v_rows);
END;
$$;
