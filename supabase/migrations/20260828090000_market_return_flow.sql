-- 중고랜드 반품(return) 플로우 — 배송완료 후 구매자가 반품 신청 시 별도 상태 머신으로 진행.
-- escrow_status는 반품 처리 완료 시점(REFUNDED)까지 PAID로 유지하고, 반품 자체의 진행
-- 상태는 return_* 컬럼으로 독립적으로 추적한다(기존 delivery_* 컬럼 패턴과 동일한 설계).
-- 반품 배송(반품 택배)은 원 배송과 별개 방향(구매자→판매자)이라 courier/tracking 등을
-- return_ 접두사로 완전히 분리해, 원 배송 정보를 덮어쓰지 않는다.

ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS return_status text,
  ADD COLUMN IF NOT EXISTS return_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_refund_account jsonb,
  ADD COLUMN IF NOT EXISTS return_address_zip text,
  ADD COLUMN IF NOT EXISTS return_address1 text,
  ADD COLUMN IF NOT EXISTS return_address2 text,
  ADD COLUMN IF NOT EXISTS return_address_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_courier_code text,
  ADD COLUMN IF NOT EXISTS return_courier_name text,
  ADD COLUMN IF NOT EXISTS return_tracking_number text,
  ADD COLUMN IF NOT EXISTS return_shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_delivery_status text,
  ADD COLUMN IF NOT EXISTS return_delivery_status_text text,
  ADD COLUMN IF NOT EXISTS return_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_delivery_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_webhook_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_webhook_registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_delivery_request_id text,
  ADD COLUMN IF NOT EXISTS return_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_dispute_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_dispute_agreed_by_buyer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_dispute_agreed_by_seller boolean NOT NULL DEFAULT false;

ALTER TABLE public.market_orders
  DROP CONSTRAINT IF EXISTS market_orders_return_status_check;
ALTER TABLE public.market_orders
  ADD CONSTRAINT market_orders_return_status_check
  CHECK (return_status IS NULL OR return_status = ANY (ARRAY[
    'REQUESTED', 'ADDRESS_SET', 'DELIVERED', 'DISPUTED', 'COMPLETED'
  ]));

CREATE INDEX IF NOT EXISTS market_orders_return_tracking_idx
  ON public.market_orders (return_tracking_number)
  WHERE return_tracking_number IS NOT NULL AND return_delivery_status IS DISTINCT FROM 'DELIVERED';

-- 반품 배송완료 후 72시간 무응답 시 자동 반품완료 처리 대상 조회용.
CREATE INDEX IF NOT EXISTS market_orders_return_delivered_idx
  ON public.market_orders (return_delivered_at)
  WHERE return_status = 'DELIVERED';
