-- 2026-10-09: Delivery Tracker 무료 플랜 키(21일마다 콘솔 수동 재발급)를 관리자가 중고랜드
-- 마이페이지 "환경" 탭에서 붙여넣어 교체할 수 있도록 Vault 저장 + 관리자 RPC를 둔다.
-- Edge Function은 get_delivery_tracker_credentials()(service_role 전용)로 읽고, 없으면 Edge 환경변수
-- (DELIVERY_TRACKER_CLIENT_ID/SECRET)로 폴백한다. 키 원문은 Vault에만 있고 이 테이블에는 없다.

CREATE TABLE IF NOT EXISTS public.market_delivery_tracker_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  client_id_hint text,               -- 앞 4자리 + 마스킹(화면 표시용)
  registered_at timestamptz,
  registered_by uuid,
  last_verified_at timestamptz,
  last_verify_ok boolean,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_delivery_tracker_config ENABLE ROW LEVEL SECURITY;
-- 직접 접근 정책 없음 — 아래 SECURITY DEFINER RPC로만 읽고 쓴다.

-- Edge Function 전용: Vault 원문 반환
CREATE OR REPLACE FUNCTION public.get_delivery_tracker_credentials()
RETURNS TABLE (client_id text, client_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'delivery_tracker_client_id' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'delivery_tracker_client_secret' LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.get_delivery_tracker_credentials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_tracker_credentials() TO service_role;

-- Edge Function 전용: 실제 호출 결과 기록(인증 만료 감지용)
CREATE OR REPLACE FUNCTION public.mark_delivery_tracker_verify(p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.market_delivery_tracker_config (id, last_verified_at, last_verify_ok, last_error, updated_at)
  VALUES (1, now(), p_ok, left(p_error, 300), now())
  ON CONFLICT (id) DO UPDATE
    SET last_verified_at = now(), last_verify_ok = p_ok, last_error = left(p_error, 300), updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.mark_delivery_tracker_verify(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivery_tracker_verify(boolean, text) TO service_role;

-- 관리자: 새 키 저장(화면에서 브라우저가 먼저 실제 API로 검증한 뒤 호출)
CREATE OR REPLACE FUNCTION public.fn_admin_set_delivery_tracker_credentials(p_client_id text, p_client_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid; v_secret_id uuid;
  v_cid text := btrim(coalesce(p_client_id, ''));
  v_sec text := btrim(coalesce(p_client_secret, ''));
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION '관리자만 변경할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  IF length(v_cid) < 8 OR length(v_sec) < 8 THEN
    RAISE EXCEPTION 'Client ID / Secret 형식이 올바르지 않습니다.';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'delivery_tracker_client_id' LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_cid, 'delivery_tracker_client_id', 'Delivery Tracker Client ID (중고랜드 배송조회)');
  ELSE
    PERFORM vault.update_secret(v_id, v_cid);
  END IF;
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'delivery_tracker_client_secret' LIMIT 1;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(v_sec, 'delivery_tracker_client_secret', 'Delivery Tracker Client Secret (중고랜드 배송조회)');
  ELSE
    PERFORM vault.update_secret(v_secret_id, v_sec);
  END IF;

  INSERT INTO public.market_delivery_tracker_config (id, client_id_hint, registered_at, registered_by, last_verified_at, last_verify_ok, last_error, updated_at)
  VALUES (1, left(v_cid, 4) || '••••', now(), auth.uid(), now(), true, NULL, now())
  ON CONFLICT (id) DO UPDATE
    SET client_id_hint = EXCLUDED.client_id_hint, registered_at = now(), registered_by = auth.uid(),
        last_verified_at = now(), last_verify_ok = true, last_error = NULL, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_set_delivery_tracker_credentials(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_delivery_tracker_credentials(text, text) TO authenticated;

-- 관리자: 상태 조회(키 원문 없음). 만료 예정 = 등록 + 21일.
CREATE OR REPLACE FUNCTION public.fn_admin_get_delivery_tracker_status()
RETURNS TABLE (
  configured boolean, client_id_hint text, registered_at timestamptz, expires_at timestamptz,
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
    c.client_id_hint, c.registered_at, c.registered_at + interval '21 days',
    c.last_verified_at, c.last_verify_ok, c.last_error
  FROM (SELECT 1) one
  LEFT JOIN public.market_delivery_tracker_config c ON c.id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_get_delivery_tracker_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_delivery_tracker_status() TO authenticated;
