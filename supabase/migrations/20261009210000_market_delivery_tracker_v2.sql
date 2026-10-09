-- 2026-10-09: 중고랜드 배송 조회 1차 공급자로 Delivery Tracker(tracker.delivery) V2 도입(기존
-- deliveryapi.co.kr은 폴백으로 유지). Edge Function 코드: supabase/functions/_shared/deliveryTracker.ts
--
-- * delivery_provider: 'tracker' | 'deliveryapi' (NULL = 도입 이전 송장 → deliveryapi로 간주)
-- * delivery_events: Tracker 이벤트 타임라인(JSON 배열, 오래된 순) — 기존 화면은 사용하지 않으며
--   향후 타임라인 UI용. delivery_status / delivery_status_text / delivered_at 의미는 기존과 동일.
ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS delivery_provider text,
  ADD COLUMN IF NOT EXISTS delivery_events jsonb,
  ADD COLUMN IF NOT EXISTS return_delivery_provider text,
  ADD COLUMN IF NOT EXISTS return_delivery_events jsonb;

-- Tracker 송장 30분 주기 조회(배달완료 영구 캐시·30분 TTL은 함수 내부에서 처리).
-- Tracker 미설정(Client ID/Secret 없음) 상태에서는 함수가 즉시 no-op으로 끝난다.
SELECT cron.schedule(
  'market-check-delivery-tracker',
  '7,37 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://eacrwhtbdqanaxpicqsm.supabase.co/functions/v1/market-check-delivery-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'market_cron_auth_token' LIMIT 1
      )
    ),
    body := '{"mode":"tracker"}'::jsonb
  );
  $$
);
