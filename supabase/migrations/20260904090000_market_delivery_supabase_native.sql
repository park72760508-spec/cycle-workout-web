-- 중고랜드 택배 배송 추적을 Firebase Cloud Functions에서 Supabase 네이티브(Edge Functions +
-- pg_cron + pg_net + Vault)로 전면 이전한다. 비밀값(deliveryapi.co.kr 키, cron→edge function
-- 인증 토큰)은 이 마이그레이션 파일에 직접 담지 않고 Vault에 별도로 저장한다(git에 평문 노출 방지).

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Edge Function 전용 — deliveryapi.co.kr Bearer 토큰을 Vault에서 꺼내온다. service_role만 실행 가능.
CREATE OR REPLACE FUNCTION public.get_delivery_api_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'delivery_api_key' LIMIT 1;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.get_delivery_api_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_api_key() TO service_role;

-- 배송완료(delivered_at) 후 72시간 경과 시 자동 구매확정 — 순수 SQL 로직이라 Edge Function 없이
-- pg_cron이 직접 호출한다. confirmMarketPurchase(구매자가 직접 누르는 것)와 동일한 효과.
-- 실제 계좌 이체는 여전히 관리자가 수동 처리(adminMarkMarketOrderSettled) — Toss에는 제3자
-- 자동 지급대행 API가 없어 "자동 정산 입금"까지는 지원하지 않는다.
CREATE OR REPLACE FUNCTION public.auto_confirm_delivered_market_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, item_id FROM public.market_orders
    WHERE escrow_status = 'PAID'
      AND delivered_at IS NOT NULL
      AND delivered_at <= now() - interval '72 hours'
  LOOP
    UPDATE public.market_orders
    SET escrow_status = 'CONFIRMED', settled_at = now(), updated_at = now()
    WHERE id = r.id AND escrow_status = 'PAID';
    IF FOUND THEN
      UPDATE public.market_items SET status = 'SOLD', updated_at = now() WHERE id = r.item_id;
    END IF;
  END LOOP;
END;
$$;

-- market_cron_auth_token 조회 wrapper — service_role 전용(별도 마이그레이션에서 REVOKE/GRANT까지 처리).
CREATE OR REPLACE FUNCTION public.get_market_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'market_cron_auth_token' LIMIT 1;
  RETURN v_secret;
END;
$$;
REVOKE ALL ON FUNCTION public.get_market_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_market_cron_secret() TO service_role;

-- 스케줄 1: 송장 등록된 미배송완료 주문의 배송 상태를 30분마다 Edge Function(market-check-delivery-status)을
-- 호출해 조회한다. 인증은 Supabase JWT가 아니라 무작위 생성한 저권한 공유 비밀(x-cron-secret)로
-- 처리 — DB 전체를 여는 service_role 키를 pg_cron SQL에 노출시키지 않기 위함. 값은 vault에서만
-- 조회하며 이 파일에는 값이 없다.
SELECT cron.schedule(
  'market-check-delivery-status',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://eacrwhtbdqanaxpicqsm.supabase.co/functions/v1/market-check-delivery-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'market_cron_auth_token' LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- 스케줄 2: 자동 구매확정 — 순수 SQL 함수라 Edge Function 경유 없이 매시 정각 직접 실행.
SELECT cron.schedule(
  'market-auto-confirm-delivered',
  '0 * * * *',
  $cron$ SELECT public.auto_confirm_delivered_market_orders(); $cron$
);
