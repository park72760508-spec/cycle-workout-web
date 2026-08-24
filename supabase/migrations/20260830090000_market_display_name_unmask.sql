-- v_user_public_profile.display_name은 is_private=true인 사용자를 '비공개' 문자열로
-- 대체해서 내려준다(랭킹보드 등 전반에 적용되는 정책). 중고랜드는 실거래 상대를 식별해야
-- 하므로, 정당한 거래 관계(판매자로 등록했거나 / 내 상품에 네고를 제안한 구매자)에 한해
-- 실명을 조회할 수 있는 전용 함수를 둔다.
CREATE OR REPLACE FUNCTION public.get_market_display_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.name
  FROM public.users u
  WHERE u.id = p_user_id
    AND (
      EXISTS (SELECT 1 FROM public.market_items mi WHERE mi.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.market_nego_requests nr
        WHERE nr.buyer_id = p_user_id AND nr.seller_id = auth.uid()
      )
    )
$$;
GRANT EXECUTE ON FUNCTION public.get_market_display_name(uuid) TO authenticated;
