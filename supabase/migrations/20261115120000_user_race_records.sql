-- STELVIO Race 모바일 개인 기록 모니터: 레이스 기록 저장 (2026-11-15)
--  rides(랭킹·TSS·평속 집계)와 분리된 전용 테이블 — 인도어 롤러 속도는 야외 라이딩과 비교 대상이 아니고,
--  포인트·TSS·마일리지에 영향을 주지 않는다. 클라이언트는 RPC 로만 접근(RLS 정책 없음, 본인 auth.uid() 한정).

CREATE TABLE IF NOT EXISTS public.user_race_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id text NOT NULL,                       -- 같은 기록의 재전송(재시도)이 중복 저장되지 않도록 하는 멱등 키
  mode text NOT NULL CHECK (mode IN ('time', 'distance')),
  target_value numeric NOT NULL DEFAULT 0,       -- mode=time: 목표 시간(초), mode=distance: 목표 거리(km)
  completed boolean NOT NULL DEFAULT false,      -- 목표에 도달해 끝났는지(true) / 사용자가 중간에 종료(false)
  elapsed_sec integer NOT NULL DEFAULT 0,
  distance_km numeric(8,3) NOT NULL DEFAULT 0,
  avg_speed_kmh numeric(6,2) NOT NULL DEFAULT 0,
  max_speed_kmh numeric(6,2) NOT NULL DEFAULT 0,
  avg_power_w integer,                           -- 파워미터가 연결된 경우만
  wheel_size text NOT NULL DEFAULT '25-622',
  source text NOT NULL DEFAULT 'mobile',
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_user_race_records_user_time ON public.user_race_records(user_id, started_at DESC);

ALTER TABLE public.user_race_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_save_race_record(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := lower(coalesce(p->>'mode', ''));
  v_cid text := left(coalesce(p->>'client_id', ''), 80);
  v_elapsed integer := coalesce((p->>'elapsed_sec')::numeric, 0)::integer;
  v_dist numeric := coalesce((p->>'distance_km')::numeric, 0);
  v_avg numeric := coalesce((p->>'avg_speed_kmh')::numeric, 0);
  v_max numeric := coalesce((p->>'max_speed_kmh')::numeric, 0);
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  IF v_mode NOT IN ('time', 'distance') OR v_cid = '' THEN RETURN jsonb_build_object('success', false, 'error', 'bad_request'); END IF;
  -- 비정상 값 방지(인도어 롤러 기준 상식 범위)
  IF v_elapsed < 1 OR v_elapsed > 172800 OR v_dist < 0 OR v_dist > 2000 OR v_avg < 0 OR v_avg > 150 OR v_max < 0 OR v_max > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'out_of_range');
  END IF;
  INSERT INTO user_race_records(user_id, client_id, mode, target_value, completed, elapsed_sec, distance_km, avg_speed_kmh, max_speed_kmh, avg_power_w, wheel_size, source, started_at)
  VALUES (v_uid, v_cid, v_mode, greatest(0, coalesce((p->>'target_value')::numeric, 0)), coalesce((p->>'completed')::boolean, false),
          v_elapsed, round(v_dist, 3), round(v_avg, 2), round(v_max, 2), nullif((p->>'avg_power_w')::numeric, 0)::integer,
          left(coalesce(p->>'wheel_size', '25-622'), 12), 'mobile',
          coalesce((p->>'started_at')::timestamptz, now()))
  ON CONFLICT (user_id, client_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM user_race_records WHERE user_id = v_uid AND client_id = v_cid;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'duplicate', true);
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_save_race_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_race_record(jsonb) TO authenticated;
