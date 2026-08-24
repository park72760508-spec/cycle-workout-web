-- 직거래 요청(안전결제 없이 예약) 지원.
-- market_orders는 원래 안전결제(Toss 가상계좌) 전용으로 설계되어 있었다. deal_type으로 안전결제/
-- 직거래를 구분하고, escrow_status에 RESERVED(직거래 예약 확정, 안전결제의 PENDING/PAID에 대응하는
-- "대면 거래 대기" 상태)를 추가한다. 이후 흐름(구매 확정/취소)은 confirmMarketPurchase/
-- cancelMarketOrder가 RESERVED도 함께 처리하도록 Cloud Functions에서 수정했다.

ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'SAFE_PAYMENT'
    CHECK (deal_type IN ('SAFE_PAYMENT', 'DIRECT_DEAL'));

ALTER TABLE public.market_orders DROP CONSTRAINT IF EXISTS market_orders_escrow_status_check;
ALTER TABLE public.market_orders ADD CONSTRAINT market_orders_escrow_status_check
  CHECK (escrow_status IN ('PENDING', 'RESERVED', 'PAID', 'CONFIRMED', 'REFUNDED', 'CANCELLED'));

-- 구매자 연락처 노출 — 기존에는 입금 확인(PAID) 이후에만 노출했으나, 예약(RESERVED/PENDING)
-- 시점부터 판매자·구매자가 바로 연락을 조율할 수 있도록 앞당긴다.
CREATE OR REPLACE FUNCTION public.get_market_buyer_contact(p_buyer_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(u.phone, ''), NULLIF(u.contact, ''))
  FROM public.users u
  WHERE u.id = p_buyer_id
    AND EXISTS (
      SELECT 1 FROM public.market_orders o
      WHERE o.buyer_id = p_buyer_id
        AND o.seller_id = auth.uid()
        AND o.escrow_status IN ('PENDING', 'RESERVED', 'PAID', 'CONFIRMED')
    )
$$;
GRANT EXECUTE ON FUNCTION public.get_market_buyer_contact(uuid) TO authenticated;
