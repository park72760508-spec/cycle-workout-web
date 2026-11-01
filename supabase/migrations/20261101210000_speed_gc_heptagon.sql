-- 평속 탭 헵타곤(펼쳐보기): GC 헵타곤과 동일 로직을 평속(Max~60분)에 적용
-- - 축 값: fn_speed_peak_user_max / fn_speed_peak_user_values (평속 랭킹과 동일, 최근 90일 일별 top2 평균)
-- - 축 순위: 성별 전체(부문 무관)에서 평속 랭킹 탭과 같은 정렬(속도 desc, best desc, uid)
-- - 축 점수 S_k = fn_position_score_100(rank, n) (미측정 축 0점), n 이 0인 축은 최대 n 사용 — GC 와 동일
-- - 종합 = Σ fn_gc_axis_weights()·S_k (0~100), 순위는 클라이언트가 부문 필터 후 GC 와 같은 타이브레이크로 매김
CREATE OR REPLACE FUNCTION public.fn_speed_gc_ranking(p_gender text DEFAULT 'all')
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH prm AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS v_end,
           extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))::int AS v_year,
           CASE lower(coalesce(p_gender, 'all')) WHEN 'm' THEN 'male' WHEN 'male' THEN 'male'
                WHEN 'f' THEN 'female' WHEN 'female' THEN 'female' ELSE NULL END AS v_g,
           public.fn_gc_axis_weights() AS w
  ), elig AS (
    SELECT us.id, us.firebase_uid, us.name, us.is_private, us.profile_image_url,
           CASE WHEN us.challenge::text IN ('Elite', 'PRO') THEN 'Assoluto'
                WHEN us.birth_year IS NULL THEN NULL
                WHEN prm.v_year - us.birth_year <= 39 THEN 'Bianco'
                WHEN prm.v_year - us.birth_year <= 49 THEN 'Rosa'
                WHEN prm.v_year - us.birth_year <= 59 THEN 'Infinito'
                ELSE 'Leggenda' END AS cat
      FROM users us CROSS JOIN prm
     WHERE us.firebase_uid IS NOT NULL
       AND coalesce(us.is_active, true)
       AND lower(coalesce(us.account_status::text, 'active')) NOT IN ('withdrawn', 'suspended', 'inactive', 'deleted')
       AND lower(coalesce(us.legacy_status::text, '')) NOT IN ('withdrawn', 'inactive', 'deleted')
       AND (prm.v_g IS NULL OR us.gender::text = prm.v_g)
  ), vals AS (
    SELECT m.user_id, 1 AS ax, m.t0 AS speed, m.b0 AS best
      FROM prm, public.fn_speed_peak_user_max(prm.v_end) m
    UNION ALL
    SELECT v.user_id, x.ax, x.speed, x.best
      FROM prm, public.fn_speed_peak_user_values(prm.v_end) v
      CROSS JOIN LATERAL (VALUES (2, v.t1, v.b1), (3, v.t2, v.b2), (4, v.t3, v.b3),
                                 (5, v.t4, v.b4), (6, v.t5, v.b5), (7, v.t6, v.b6)) x(ax, speed, best)
  ), axv AS (
    SELECT e.id AS user_id, e.firebase_uid, e.name, e.is_private, e.profile_image_url, e.cat, vals.ax, vals.speed, vals.best
      FROM vals JOIN elig e ON e.id = vals.user_id
     WHERE vals.speed IS NOT NULL AND vals.speed > 0 AND e.cat IS NOT NULL
  ), axn AS (
    SELECT array_agg(coalesce(c.n, 0) ORDER BY a.ax) AS n_arr
      FROM generate_series(1, 7) a(ax)
      LEFT JOIN (SELECT ax, count(*)::int n FROM axv GROUP BY ax) c ON c.ax = a.ax
  ), rk AS (
    SELECT axv.*, row_number() OVER (PARTITION BY axv.ax ORDER BY axv.speed DESC, axv.best DESC, axv.firebase_uid)::int AS r
      FROM axv
  ), per_user AS (
    SELECT rk.user_id, rk.firebase_uid, rk.name, rk.is_private, rk.profile_image_url, rk.cat,
           jsonb_object_agg(rk.ax::text, jsonb_build_object('r', rk.r, 'v', rk.speed)) AS axmap
      FROM rk GROUP BY rk.user_id, rk.firebase_uid, rk.name, rk.is_private, rk.profile_image_url, rk.cat
  ), scored AS (
    SELECT pu.*,
           (SELECT array_agg(CASE WHEN pu.axmap ? a::text
                                  THEN public.fn_position_score_100((pu.axmap -> a::text ->> 'r')::int,
                                         CASE WHEN axn.n_arr[a] >= 1 THEN axn.n_arr[a]
                                              ELSE greatest((SELECT max(x) FROM unnest(axn.n_arr) x), 1) END)
                                  ELSE 0 END ORDER BY a)
              FROM generate_series(1, 7) a) AS pos
      FROM per_user pu CROSS JOIN axn
  )
  SELECT jsonb_build_object(
           'success', true, 'period', 'rolling90',
           'startStr', (prm.v_end - 89)::text, 'endStr', prm.v_end::text,
           'gender', coalesce(p_gender, 'all'),
           'axisN', (SELECT to_jsonb(n_arr) FROM axn),
           'weights', to_jsonb(prm.w),
           'entries', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'userId', s.firebase_uid,
                      'name', coalesce(nullif(btrim(s.name), ''), '(이름 없음)'),
                      'is_private', coalesce(s.is_private, false),
                      'profileImageUrl', s.profile_image_url,
                      'ageCategory', s.cat,
                      'ranks', (SELECT jsonb_agg(s.axmap -> a::text -> 'r' ORDER BY a) FROM generate_series(1, 7) a),
                      'speeds', (SELECT jsonb_agg(s.axmap -> a::text -> 'v' ORDER BY a) FROM generate_series(1, 7) a),
                      'pos', to_jsonb(s.pos),
                      'gc', round((SELECT sum(prm.w[a] * s.pos[a]) FROM generate_series(1, 7) a), 4)))
               FROM scored s), '[]'::jsonb))
    FROM prm;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_speed_gc_ranking(text) TO anon, authenticated;
