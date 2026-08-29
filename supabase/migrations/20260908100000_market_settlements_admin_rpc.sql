-- 중고랜드 관리자 정산 내역 — 안전거래(SAFE_PAYMENT)로 입금 확인(paid_at)된 주문을 정산
-- 대상으로 본다. 환불(REFUNDED)된 건은 판매자에게 지급할 금액이 없으므로 제외한다.
-- market_orders는 이미 거래종료(settled_at)·정산일(settlement_transferred_at)·판매금액
-- (item_price, 수락된 협의가 반영됨)·계좌 스냅샷(settlement_account)을 갖고 있어 새 테이블
-- 없이 조회만 하면 된다. RLS(market_orders_read)가 이미 관리자 전체 조회를 허용하지만,
-- 구매자·판매자 이름은 관리자 우회가 없는 get_market_display_name으로는 못 가져오므로
-- 이 함수에서 별도로 조인해 반환한다.
CREATE OR REPLACE FUNCTION public.get_market_settlements_for_admin()
RETURNS TABLE (
  order_id uuid,
  item_title text,
  paid_at timestamptz,
  settled_at timestamptz,
  buyer_name text,
  seller_name text,
  bank_name text,
  account_number text,
  holder_name text,
  item_price integer,
  settlement_transferred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    mi.title,
    o.paid_at,
    o.settled_at,
    COALESCE(NULLIF(bu.name, ''), NULLIF(bu.display_name, ''), '알 수 없음'),
    COALESCE(NULLIF(su.name, ''), NULLIF(su.display_name, ''), '알 수 없음'),
    o.settlement_account->>'bankName',
    o.settlement_account->>'accountNumber',
    o.settlement_account->>'holderName',
    o.item_price,
    o.settlement_transferred_at
  FROM public.market_orders o
  JOIN public.market_items mi ON mi.id = o.item_id
  LEFT JOIN public.users bu ON bu.id = o.buyer_id
  LEFT JOIN public.users su ON su.id = o.seller_id
  WHERE o.deal_type = 'SAFE_PAYMENT'
    AND o.paid_at IS NOT NULL
    AND o.escrow_status <> 'REFUNDED'
  ORDER BY o.paid_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_market_settlements_for_admin() TO authenticated;
