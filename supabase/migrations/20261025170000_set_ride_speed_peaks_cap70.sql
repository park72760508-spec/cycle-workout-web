-- 루트맵 평속 저장: 구간별 순위 상한을 모두 70 km/h 로(2026-10-25, 기록 전체 평균 60 km/h 인정 기준과 맞춤)
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
    rank_1min_speed_kmh  = CASE WHEN (p->>'rank_1min_speed_kmh')::numeric  BETWEEN 0.1 AND 70 THEN (p->>'rank_1min_speed_kmh')::numeric END,
    rank_5min_speed_kmh  = CASE WHEN (p->>'rank_5min_speed_kmh')::numeric  BETWEEN 0.1 AND 70 THEN (p->>'rank_5min_speed_kmh')::numeric END,
    rank_10min_speed_kmh = CASE WHEN (p->>'rank_10min_speed_kmh')::numeric BETWEEN 0.1 AND 70 THEN (p->>'rank_10min_speed_kmh')::numeric END,
    rank_20min_speed_kmh = CASE WHEN (p->>'rank_20min_speed_kmh')::numeric BETWEEN 0.1 AND 70 THEN (p->>'rank_20min_speed_kmh')::numeric END,
    rank_40min_speed_kmh = CASE WHEN (p->>'rank_40min_speed_kmh')::numeric BETWEEN 0.1 AND 70 THEN (p->>'rank_40min_speed_kmh')::numeric END,
    rank_60min_speed_kmh = CASE WHEN (p->>'rank_60min_speed_kmh')::numeric BETWEEN 0.1 AND 70 THEN (p->>'rank_60min_speed_kmh')::numeric END
  WHERE user_id = v_uid AND source = 'stelvio' AND activity_id = p_activity_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', v_n > 0);
END;
$$;
