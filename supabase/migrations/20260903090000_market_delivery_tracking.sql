-- 중고랜드 택배 배송 추적 — 판매자가 입금완료(PAID) 주문에 택배사/송장번호를 등록하면
-- deliveryapi.co.kr로 주기적으로 배송 상태를 조회하고, 배송완료(DELIVERED) 확인 후 72시간이
-- 지나면 구매자가 별도 조치하지 않아도 자동으로 구매확정(CONFIRMED) 처리한다.
-- (실제 계좌 이체는 기존과 동일하게 관리자가 수동으로 처리 — Toss에는 제3자 자동 지급대행
-- API가 없어 "자동 정산 입금"은 지원 대상에서 제외했다.)
ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS courier_code text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_status_text text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS market_orders_delivery_poll_idx
  ON public.market_orders (delivery_status)
  WHERE tracking_number IS NOT NULL AND delivery_status IS DISTINCT FROM 'DELIVERED';

CREATE INDEX IF NOT EXISTS market_orders_delivered_confirm_idx
  ON public.market_orders (delivered_at)
  WHERE escrow_status = 'PAID' AND delivered_at IS NOT NULL;
