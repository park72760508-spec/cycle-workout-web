-- CYCLE 랭킹보드 '평속' 탭(2026-10-24)
-- 아웃도어 라이딩 1·5·10·20·40·60분 피크 평균속도(km/h). Strava 동기화 때 계산(functions computeSpeedPeaksFromStreams).
--  max_*_speed_kmh  : 기록 그대로(일일 기록용)
--  rank_*_speed_kmh : 순위용(평균 경사 -1.5%보다 내리막 구간·비현실 속도 제외, 전기자전거 제외)
-- 순위: 최근 90일(오늘 포함, 한국 날짜) 순위용 값 상위 2개 평균(기록 1개면 그 값). 리그·성별 분류는 피크 파워 랭킹과 동일.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS max_1min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS max_5min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS max_10min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS max_20min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS max_40min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS max_60min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_1min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_5min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_10min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_20min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_40min_speed_kmh numeric,
  ADD COLUMN IF NOT EXISTS rank_60min_speed_kmh numeric;
CREATE INDEX IF NOT EXISTS rides_speed_rank_date_idx ON public.rides (ride_date) WHERE rank_1min_speed_kmh IS NOT NULL;

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
       WHERE ride_date BETWEEN $1 AND $2 AND %1$I > 0
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
REVOKE ALL ON FUNCTION public.fn_speed_peak_ranking(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_speed_peak_ranking(text, text) TO anon, authenticated;

-- 루트맵(STELVIO 아웃도어 라이딩) 기록의 피크 평속 저장 — 본인 기록만, 값 범위 서버에서 다시 확인
CREATE OR REPLACE FUNCTION public.fn_set_ride_speed_peaks(p_activity_id text, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.'); END IF;
  UPDATE rides SET
    max_1min_speed_kmh  = CASE WHEN (p->>'max_1min_speed_kmh')::numeric  BETWEEN 0.1 AND 100 THEN (p->>'max_1min_speed_kmh')::numeric END,
    max_5min_speed_kmh  = CASE WHEN (p->>'max_5min_speed_kmh')::numeric  BETWEEN 0.1 AND 100 THEN (p->>'max_5min_speed_kmh')::numeric END,
    max_10min_speed_kmh = CASE WHEN (p->>'max_10min_speed_kmh')::numeric BETWEEN 0.1 AND 100 THEN (p->>'max_10min_speed_kmh')::numeric END,
    max_20min_speed_kmh = CASE WHEN (p->>'max_20min_speed_kmh')::numeric BETWEEN 0.1 AND 100 THEN (p->>'max_20min_speed_kmh')::numeric END,
    max_40min_speed_kmh = CASE WHEN (p->>'max_40min_speed_kmh')::numeric BETWEEN 0.1 AND 100 THEN (p->>'max_40min_speed_kmh')::numeric END,
    max_60min_speed_kmh = CASE WHEN (p->>'max_60min_speed_kmh')::numeric BETWEEN 0.1 AND 100 THEN (p->>'max_60min_speed_kmh')::numeric END,
    rank_1min_speed_kmh  = CASE WHEN (p->>'rank_1min_speed_kmh')::numeric  BETWEEN 0.1 AND 75 THEN (p->>'rank_1min_speed_kmh')::numeric END,
    rank_5min_speed_kmh  = CASE WHEN (p->>'rank_5min_speed_kmh')::numeric  BETWEEN 0.1 AND 65 THEN (p->>'rank_5min_speed_kmh')::numeric END,
    rank_10min_speed_kmh = CASE WHEN (p->>'rank_10min_speed_kmh')::numeric BETWEEN 0.1 AND 60 THEN (p->>'rank_10min_speed_kmh')::numeric END,
    rank_20min_speed_kmh = CASE WHEN (p->>'rank_20min_speed_kmh')::numeric BETWEEN 0.1 AND 58 THEN (p->>'rank_20min_speed_kmh')::numeric END,
    rank_40min_speed_kmh = CASE WHEN (p->>'rank_40min_speed_kmh')::numeric BETWEEN 0.1 AND 56 THEN (p->>'rank_40min_speed_kmh')::numeric END,
    rank_60min_speed_kmh = CASE WHEN (p->>'rank_60min_speed_kmh')::numeric BETWEEN 0.1 AND 56 THEN (p->>'rank_60min_speed_kmh')::numeric END
  WHERE user_id = v_uid AND source = 'stelvio' AND activity_id = p_activity_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', v_n > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_ride_speed_peaks(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_ride_speed_peaks(text, jsonb) TO authenticated;
