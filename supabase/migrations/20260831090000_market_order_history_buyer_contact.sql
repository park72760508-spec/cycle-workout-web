-- 중고랜드 판매자 상세화면 "거래내역" — 입금 확인(PAID) 이후에만 구매자 연락처를 노출하는
-- 전용 함수. get_market_seller_contact(판매자용)와 대칭되는 구매자용 함수.
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
        AND o.escrow_status IN ('PAID', 'CONFIRMED')
    )
$$;
GRANT EXECUTE ON FUNCTION public.get_market_buyer_contact(uuid) TO authenticated;
