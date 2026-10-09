-- 2026-10-10: 관리자 "환경" 탭에서 현재 사용 중인 Client ID를 입력칸 기본값으로 보여주기 위해
-- 상태 조회 RPC에 client_id(원문, 관리자 전용)를 추가한다. Client Secret은 여전히 반환하지 않는다.
DROP FUNCTION IF EXISTS public.fn_admin_get_delivery_tracker_status();
CREATE FUNCTION public.fn_admin_get_delivery_tracker_status()
RETURNS TABLE (
  configured boolean, client_id text, client_id_hint text, registered_at timestamptz, expires_at timestamptz,
  last_verified_at timestamptz, last_verify_ok boolean, last_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION '관리자만 조회할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'delivery_tracker_client_secret'),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'delivery_tracker_client_id' LIMIT 1),
    c.client_id_hint, c.registered_at, c.registered_at + interval '21 days',
    c.last_verified_at, c.last_verify_ok, c.last_error
  FROM (SELECT 1) one
  LEFT JOIN public.market_delivery_tracker_config c ON c.id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_get_delivery_tracker_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_delivery_tracker_status() TO authenticated;
