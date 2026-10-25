-- 평속 순위 등락 비교 기준 수정(2026-10-26): 어제 마감(어제까지 기록) → 그저께까지 기록으로 낸 순위.
-- 구간 탭은 '오늘 새벽 집계(어제까지) vs 전일 새벽 집계(그저께까지)'라 어제 라이딩 효과가 하루 종일 등락으로 보이는데,
-- 평속은 어제 라이딩이 이미 기준에 들어가 오늘 라이딩만 반영돼 날짜가 바뀐 직후 거의 모두 (-)로 보였다.
-- 이제 등락 = 어제 + 오늘 라이딩으로 바뀐 순위(절대 순위 비교, 새 진입으로 밀린 순위도 반영).
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
  ), prv AS (
    SELECT v.user_id, (ARRAY[v.t1, v.t2, v.t3, v.t4, v.t5, v.t6])[v_idx] AS speed,
           (ARRAY[v.b1, v.b2, v.b3, v.b4, v.b5, v.b6])[v_idx] AS best
      FROM public.fn_speed_peak_user_values(v_end - 2) v -- 비교 기준: 그저께까지 기록(구간 탭의 '전일 새벽 집계'와 같은 시점)
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
$$;
