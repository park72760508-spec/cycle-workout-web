-- 2026-10-30 루트맵 오토바이 길찾기: 카카오모빌리티 자동차 길찾기(이륜차 + 자동차전용도로 회피) 사용량도 함께 집계
ALTER TABLE public.kakao_route_usage DROP CONSTRAINT IF EXISTS kakao_route_usage_api_check;
ALTER TABLE public.kakao_route_usage ADD CONSTRAINT kakao_route_usage_api_check CHECK (api = ANY (ARRAY['bicycle'::text, 'walk'::text, 'car'::text]));

CREATE OR REPLACE FUNCTION public.fn_kakao_route_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'car', coalesce((SELECT calls FROM kakao_route_usage WHERE day = v_day AND api = 'car'), 0),
    'bicycle_exhausted', coalesce((SELECT exhausted FROM kakao_route_usage WHERE day = v_day AND api = 'bicycle'), false),
    'walk_exhausted', coalesce((SELECT exhausted FROM kakao_route_usage WHERE day = v_day AND api = 'walk'), false),
    'car_exhausted', coalesce((SELECT exhausted FROM kakao_route_usage WHERE day = v_day AND api = 'car'), false)
  );
END;
$function$;
