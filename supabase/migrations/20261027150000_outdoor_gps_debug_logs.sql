-- 루트맵 원본 GPS 기록(관리자 전용, 2026-10-27)
--  속도 표시 로직을 실제 걷기·라이딩 데이터로 맞추기 위해 GPS 원본(위치·정확도·도플러 속도)과
--  걸음 감지 상태, 화면에 표시한 속도를 1초 단위로 모은다. 관리자(fn_is_admin)만 저장 가능.
CREATE TABLE IF NOT EXISTS public.outdoor_gps_debug_logs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  started_at timestamptz,
  device text,
  n_fixes integer NOT NULL DEFAULT 0,
  fixes jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_id)
);
ALTER TABLE public.outdoor_gps_debug_logs ENABLE ROW LEVEL SECURITY; -- 정책 없음: 아래 함수로만 접근

-- p: { session_id, started_at, device, fixes: [...추가분], steps: [...추가분], meta }
CREATE OR REPLACE FUNCTION public.fn_save_outdoor_gps_debug(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid text := left(btrim(coalesce(p ->> 'session_id', '')), 80);
  v_fixes jsonb := CASE WHEN jsonb_typeof(p -> 'fixes') = 'array' THEN p -> 'fixes' ELSE '[]'::jsonb END;
  v_steps jsonb := CASE WHEN jsonb_typeof(p -> 'steps') = 'array' THEN p -> 'steps' ELSE '[]'::jsonb END;
BEGIN
  IF v_uid IS NULL OR NOT public.fn_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin only');
  END IF;
  IF v_sid = '' THEN RETURN jsonb_build_object('success', false, 'error', 'session_id'); END IF;
  IF jsonb_array_length(v_fixes) > 2000 OR jsonb_array_length(v_steps) > 20000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'chunk too large');
  END IF;
  INSERT INTO outdoor_gps_debug_logs (user_id, session_id, started_at, device, n_fixes, fixes, steps, meta)
  VALUES (v_uid, v_sid, nullif(p ->> 'started_at', '')::timestamptz, left(p ->> 'device', 200),
          jsonb_array_length(v_fixes), v_fixes, v_steps, p -> 'meta')
  ON CONFLICT (user_id, session_id) DO UPDATE SET
    fixes = outdoor_gps_debug_logs.fixes || EXCLUDED.fixes,
    steps = outdoor_gps_debug_logs.steps || EXCLUDED.steps,
    n_fixes = outdoor_gps_debug_logs.n_fixes + EXCLUDED.n_fixes,
    meta = coalesce(EXCLUDED.meta, outdoor_gps_debug_logs.meta),
    updated_at = now();
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_save_outdoor_gps_debug(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_outdoor_gps_debug(jsonb) TO authenticated;
