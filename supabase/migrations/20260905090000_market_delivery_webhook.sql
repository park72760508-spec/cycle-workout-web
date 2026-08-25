-- 중고랜드 택배 조회 API 트래픽 최소화 — deliveryapi.co.kr의 "웹훅 등록 1건만 차감, 이후 상태
-- 변경은 무료 푸시" 정책을 활용한다. 송장 등록 시 웹훅을 함께 등록해두면(market-set-tracking),
-- 이후 배송 상태 변경은 market-delivery-webhook이 무료로 수신하고, 정기 폴링(market-check-
-- delivery-status)은 웹훅 등록에 실패한 건에 한해서만(안전망) 동작하며 주기도 30분→6시간으로
-- 크게 늘려 API 호출량을 최소화한다.

ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS webhook_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_registered_at timestamptz;

-- 폴링 대상 인덱스를 웹훅 미등록 건으로 좁힌다(웹훅 등록된 건은 폴링 스캔에서 완전히 제외).
DROP INDEX IF EXISTS market_orders_delivery_poll_idx;
CREATE INDEX IF NOT EXISTS market_orders_delivery_poll_idx
  ON public.market_orders (delivery_status)
  WHERE tracking_number IS NOT NULL
    AND delivery_status IS DISTINCT FROM 'DELIVERED'
    AND webhook_registered = false;

-- 폴링 스케줄을 30분 → 6시간으로 완화(웹훅이 주 채널, 폴링은 등록 실패 건만 처리하는 안전망).
SELECT cron.unschedule('market-check-delivery-status');
SELECT cron.schedule(
  'market-check-delivery-status',
  '0 */6 * * *',
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
