-- 루트맵 카카오 도보·자전거 길찾기(2026-10-24)
-- 카카오 REST 키는 Vault('kakao_rest_api_key')에만 있고, Edge Function(kakao-route)이 service_role 로 읽는다.
-- 무료 한도(API별 하루 1,000건)를 넘지 않게 우리 쪽에서 호출 수를 세고(한국 날짜 기준),
-- 같은 출발지 근처 → 같은 목적지 결과는 7일간 저장해 다시 쓴다(호출 수 절약).

CREATE TABLE IF NOT EXISTS public.kakao_route_usage (
  day date NOT NULL,
  api text NOT NULL CHECK (api IN ('bicycle', 'walk')),
  calls integer NOT NULL DEFAULT 0,
  cache_hits integer NOT NULL DEFAULT 0,
  exhausted boolean NOT NULL DEFAULT false, -- 카카오가 한도 초과로 거절한 날
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, api)
);
CREATE TABLE IF NOT EXISTS public.kakao_route_cache (
  key text PRIMARY KEY,
  api text NOT NULL,
  route jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kakao_route_cache_created_idx ON public.kakao_route_cache (created_at);
ALTER TABLE public.kakao_route_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kakao_route_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kakao_route_usage FROM anon, authenticated;
REVOKE ALL ON public.kakao_route_cache FROM anon, authenticated;

-- Edge Function 전용: 키
CREATE OR REPLACE FUNCTION public.get_kakao_rest_api_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kakao_rest_api_key' LIMIT 1;
$$;

-- Edge Function 전용: 호출 1건 예약(한도 안이면 새 호출 수, 넘으면 -1)
CREATE OR REPLACE FUNCTION public.kakao_route_take(p_api text, p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_n integer;
BEGIN
  INSERT INTO kakao_route_usage (day, api) VALUES (v_day, p_api) ON CONFLICT DO NOTHING;
  UPDATE kakao_route_usage SET calls = calls + 1, updated_at = now()
   WHERE day = v_day AND api = p_api AND calls < p_limit AND NOT exhausted
   RETURNING calls INTO v_n;
  RETURN coalesce(v_n, -1);
END;
$$;

-- Edge Function 전용: 저장된 결과 사용 기록 / 카카오 한도 초과 표시
CREATE OR REPLACE FUNCTION public.kakao_route_mark(p_api text, p_cache_hit boolean, p_exhausted boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  INSERT INTO kakao_route_usage (day, api) VALUES (v_day, p_api) ON CONFLICT DO NOTHING;
  UPDATE kakao_route_usage
     SET cache_hits = cache_hits + CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
         exhausted = exhausted OR p_exhausted,
         updated_at = now()
   WHERE day = v_day AND api = p_api;
  -- 오래된 저장 결과 정리(가끔)
  IF random() < 0.02 THEN
    DELETE FROM kakao_route_cache WHERE created_at < now() - interval '7 days';
  END IF;
END;
$$;

-- 앱 화면용: 오늘 사용량(로그인 사용자)
CREATE OR REPLACE FUNCTION public.fn_kakao_route_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  RETURN jsonb_build_object(
    'success', true, 'day', v_day, 'limit', 1000,
    'bicycle', coalesce((SELECT calls FROM kakao_route_usage WHERE day = v_day AND api = 'bicycle'), 0),
    'walk', coalesce((SELECT calls FROM kakao_route_usage WHERE day = v_day AND api = 'walk'), 0),
    'bicycle_exhausted', coalesce((SELECT exhausted FROM kakao_route_usage WHERE day = v_day AND api = 'bicycle'), false),
    'walk_exhausted', coalesce((SELECT exhausted FROM kakao_route_usage WHERE day = v_day AND api = 'walk'), false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_kakao_rest_api_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kakao_route_take(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kakao_route_mark(text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_kakao_rest_api_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.kakao_route_take(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.kakao_route_mark(text, boolean, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fn_kakao_route_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_kakao_route_usage() TO authenticated;
