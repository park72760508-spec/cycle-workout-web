-- 2026-11-03 외부 API 인증키 관리(관리자): 교통카드 빅데이터(STCIS)·공공데이터포털 등
-- 키 원문은 Supabase Vault(apikey_<name>)에만 저장, 표에는 앞뒤 일부(hint)·등록일·만료일만.
-- 루트맵 메뉴 'API 인증키'(관리자만 보임)에서 새 키를 넣고 저장하면 갱신된다.

CREATE TABLE IF NOT EXISTS public.api_key_registry (
  name text PRIMARY KEY,
  label text NOT NULL,
  key_hint text,
  registered_at timestamptz,
  expires_on date,
  updated_by uuid
);
ALTER TABLE public.api_key_registry ENABLE ROW LEVEL SECURITY; -- 직접 접근 없음(아래 함수로만)

INSERT INTO public.api_key_registry (name, label) VALUES
  ('stcis', '교통카드 빅데이터 통합정보시스템'),
  ('data_go_kr', '공공데이터포털(버스 노선·정류소)')
ON CONFLICT (name) DO NOTHING;

-- 관리자: 키 상태 목록(원문 없음)
CREATE OR REPLACE FUNCTION public.fn_admin_api_keys_status()
RETURNS TABLE (name text, label text, configured boolean, key_hint text, registered_at timestamptz, expires_on date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION '관리자만 조회할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.name, r.label,
         EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'apikey_' || r.name),
         r.key_hint, r.registered_at, r.expires_on
  FROM public.api_key_registry r
  ORDER BY r.name DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_api_keys_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_api_keys_status() TO authenticated;

-- 관리자: 새 키 저장(있으면 교체) + 만료일
CREATE OR REPLACE FUNCTION public.fn_admin_set_api_key(p_name text, p_key text, p_expires_on date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text := btrim(coalesce(p_key, ''));
  v_label text;
  v_id uuid;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION '관리자만 변경할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  SELECT label INTO v_label FROM public.api_key_registry WHERE name = p_name;
  IF v_label IS NULL THEN
    RAISE EXCEPTION '알 수 없는 키 종류입니다.';
  END IF;
  IF length(v_key) < 8 OR v_key ~ '\s' THEN
    RAISE EXCEPTION '인증키 형식이 올바르지 않습니다.';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'apikey_' || p_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_key, 'apikey_' || p_name, v_label || ' API 인증키');
  ELSE
    PERFORM vault.update_secret(v_id, v_key);
  END IF;

  UPDATE public.api_key_registry
     SET key_hint = left(v_key, 4) || '…' || right(v_key, 4),
         registered_at = now(),
         expires_on = p_expires_on,
         updated_by = auth.uid()
   WHERE name = p_name;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_set_api_key(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_api_key(text, text, date) TO authenticated;

-- 서버 작업(데이터 생성 스크립트·Edge Function)용: service_role 만 키 원문 조회
CREATE OR REPLACE FUNCTION public.fn_service_get_api_key(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apikey_' || p_name LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_service_get_api_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_service_get_api_key(text) TO service_role;
