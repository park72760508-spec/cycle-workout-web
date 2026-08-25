-- deliveryapi.co.kr 실제 웹훅 API 문서를 반영해 중고랜드 택배 추적을 재구현한다(이전 마이그레이션의
-- POST /v1/webhooks/endpoints 매 송장 등록 방식은 실제로는 "엔드포인트(콜백 URL) 1회 등록" API였고,
-- 송장별 구독은 별도의 POST /v1/webhooks/register로 하는 것이 맞다). 엔드포인트는 이미
-- market-delivery-webhook-setup으로 1회 등록·시크릿 발급을 완료하고 Vault에 저장했다
-- (delivery_webhook_endpoint_id, delivery_webhook_secret — 이 파일에는 값이 없다).

ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS delivery_request_id text;

-- Edge Function 전용 — 웹훅 엔드포인트 설정(endpointId/webhookSecret)을 Vault에서 꺼내온다.
CREATE OR REPLACE FUNCTION public.get_delivery_webhook_config()
RETURNS TABLE(endpoint_id text, webhook_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'delivery_webhook_endpoint_id' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'delivery_webhook_secret' LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.get_delivery_webhook_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_webhook_config() TO service_role;

-- 폴링은 구독형 웹훅(14일간 자동, 배달완료 시 자동종료)의 안전망일 뿐이므로 훨씬 드물게(하루 1회)
-- 실행하고, 여러 건을 배치 API(POST /v1/webhooks/results)로 한 번에 조회하도록 바꿔 호출 자체를
-- 최소화한다.
SELECT cron.unschedule('market-check-delivery-status');
SELECT cron.schedule(
  'market-check-delivery-status',
  '0 9 * * *',
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
