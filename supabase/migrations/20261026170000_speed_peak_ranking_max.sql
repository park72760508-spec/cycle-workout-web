-- 평속 랭킹 Max 탭(2026-10-26): duration = 'spd_max'
--  1~60분 탭과 같은 규칙: 최근 90일, 하루 최고값 기준 상위 2개 평균, 70 km/h 초과 값 제외(GPS 튐),
--  짧은 구간이 긴 구간보다 낮지 않게(Max ≥ 1분 순위값), 등락 = 그저께까지 기록 순위 − 오늘 순위.
--  Max 는 rides.max_speed_kmh(기록 최고 속도) 사용 — 1~60분처럼 긴 내리막 제외 값은 따로 없다.

CREATE OR REPLACE FUNCTION public.fn_speed_peak_user_max(p_end date)
 RETURNS TABLE(user_id uuid, t0 numeric, b0 numeric, k0 bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dly AS (
    SELECT r.user_id, r.ride_date,
           max(CASE WHEN r.max_speed_kmh BETWEEN 0.1 AND 70 THEN r.max_speed_kmh END) d0,
           max(r.rank_1min_speed_kmh) d1
      FROM rides r
     WHERE r.max_1min_speed_kmh IS NOT NULL AND r.ride_date BETWEEN p_end - 89 AND p_end
     GROUP BY r.user_id, r.ride_date
  ), rr AS (
    SELECT dly.user_id,
           d0 c0, row_number() OVER (PARTITION BY dly.user_id ORDER BY d0 DESC NULLS LAST) n0,
           d1 c1, row_number() OVER (PARTITION BY dly.user_id ORDER BY d1 DESC NULLS LAST) n1
      FROM dly
  ), a AS (
    SELECT rr.user_id,
           round(avg(c0) FILTER (WHERE n0 <= 2 AND c0 > 0), 1) s0, max(c0) xb0, count(*) FILTER (WHERE c0 > 0) xk0,
           round(avg(c1) FILTER (WHERE n1 <= 2 AND c1 > 0), 1) s1
      FROM rr GROUP BY rr.user_id
  )
  SELECT a.user_id, CASE WHEN s0 IS NULL THEN NULL ELSE greatest(s0, coalesce(s1, 0)) END, xb0, xk0 FROM a;
$function$;

REVOKE ALL ON FUNCTION public.fn_speed_peak_user_max(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_speed_peak_ranking(p_duration text, p_gender text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_idx int := CASE p_duration WHEN 'spd_max' THEN 0 WHEN 'spd_1min' THEN 1 WHEN 'spd_5min' THEN 2 WHEN 'spd_10min' THEN 3
                               WHEN 'spd_20min' THEN 4 WHEN 'spd_40min' THEN 5 WHEN 'spd_60min' THEN 6 END;
  v_end date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_year int := extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))::int;
  v_g text := CASE lower(coalesce(p_gender, 'all')) WHEN 'm' THEN 'male' WHEN 'male' THEN 'male' WHEN 'f' THEN 'female' WHEN 'female' THEN 'female' ELSE NULL END;
  v_rows jsonb;
BEGIN
  IF v_idx IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown duration');
  END IF;
  WITH elig AS (
    SELECT us.id, us.firebase_uid, us.name, us.gender::text AS gender, us.is_private, us.profile_image_url, us.account_status::text AS account_status,
           CASE WHEN us.challenge::text IN ('Elite', 'PRO') THEN 'Assoluto'
                WHEN us.birth_year IS NULL THEN NULL
                WHEN v_year - us.birth_year <= 39 THEN 'Bianco'
                WHEN v_year - us.birth_year <= 49 THEN 'Rosa'
                WHEN v_year - us.birth_year <= 59 THEN 'Infinito'
                ELSE 'Leggenda' END AS cat
      FROM users us
     WHERE us.firebase_uid IS NOT NULL
       AND coalesce(us.is_active, true)
       AND lower(coalesce(us.account_status::text, 'active')) NOT IN ('withdrawn', 'suspended', 'inactive', 'deleted')
       AND lower(coalesce(us.legacy_status::text, '')) NOT IN ('withdrawn', 'inactive', 'deleted')
       AND (v_g IS NULL OR us.gender::text = v_g)
  ), cur AS (
    SELECT v.user_id, (ARRAY[v.t1, v.t2, v.t3, v.t4, v.t5, v.t6])[v_idx] AS speed,
           (ARRAY[v.b1, v.b2, v.b3, v.b4, v.b5, v.b6])[v_idx] AS best,
           (ARRAY[v.k1, v.k2, v.k3, v.k4, v.k5, v.k6])[v_idx] AS n
      FROM public.fn_speed_peak_user_values(v_end) v
     WHERE v_idx > 0
    UNION ALL
    SELECT m.user_id, m.t0, m.b0, m.k0 FROM public.fn_speed_peak_user_max(v_end) m WHERE v_idx = 0
  ), prv AS (
    SELECT v.user_id, (ARRAY[v.t1, v.t2, v.t3, v.t4, v.t5, v.t6])[v_idx] AS speed,
           (ARRAY[v.b1, v.b2, v.b3, v.b4, v.b5, v.b6])[v_idx] AS best
      FROM public.fn_speed_peak_user_values(v_end - 2) v
     WHERE v_idx > 0
    UNION ALL
    SELECT m.user_id, m.t0, m.b0 FROM public.fn_speed_peak_user_max(v_end - 2) m WHERE v_idx = 0
  ), cr AS (
    SELECT cur.*, e.firebase_uid, e.name, e.gender, e.is_private, e.profile_image_url, e.account_status, e.cat,
           row_number() OVER (ORDER BY cur.speed DESC, cur.best DESC, e.firebase_uid) AS gr,
           row_number() OVER (PARTITION BY e.cat ORDER BY cur.speed DESC, cur.best DESC, e.firebase_uid) AS kr
      FROM cur JOIN elig e ON e.id = cur.user_id
     WHERE cur.speed IS NOT NULL AND e.cat IS NOT NULL
  ), pr AS (
    SELECT prv.user_id,
           row_number() OVER (ORDER BY prv.speed DESC, prv.best DESC, e.firebase_uid) AS pgr,
           row_number() OVER (PARTITION BY e.cat ORDER BY prv.speed DESC, prv.best DESC, e.firebase_uid) AS pkr
      FROM prv JOIN elig e ON e.id = prv.user_id
     WHERE prv.speed IS NOT NULL AND e.cat IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'userId', cr.firebase_uid, 'name', coalesce(nullif(btrim(cr.name), ''), '(이름 없음)'),
           'speedKmh', cr.speed, 'bestSpeedKmh', cr.best, 'rideCount', cr.n,
           'ageCategory', cr.cat, 'gender', coalesce(cr.gender, ''),
           'is_private', coalesce(cr.is_private, false), 'profileImageUrl', cr.profile_image_url,
           'account_status', coalesce(nullif(btrim(cr.account_status), ''), 'active'), 'isWithdrawn', false,
           'mvAll', CASE WHEN pr.pgr IS NULL THEN NULL ELSE jsonb_build_object('rankChange', pr.pgr - cr.gr, 'previousBoardRank', pr.pgr) END,
           'mvCat', CASE WHEN pr.pkr IS NULL THEN NULL ELSE jsonb_build_object('rankChange', pr.pkr - cr.kr, 'previousBoardRank', pr.pkr) END
         ) ORDER BY cr.gr), '[]'::jsonb)
    INTO v_rows
    FROM cr LEFT JOIN pr ON pr.user_id = cr.user_id;
  RETURN jsonb_build_object('success', true, 'durationType', p_duration, 'period', 'rolling90',
                            'startStr', (v_end - 89)::text, 'endStr', v_end::text, 'gender', coalesce(p_gender, 'all'),
                            'rankMovementBaseline', (v_end - 2)::text, 'entries', v_rows);
END;
$function$;
