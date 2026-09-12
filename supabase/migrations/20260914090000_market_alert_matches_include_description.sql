-- 키워드 알림 매칭 시 상품명(title)뿐 아니라 상품 설명(description)에서도 검색되도록 확장.
-- 카테고리·서브카테고리·가격 조건은 그대로 AND로 동시 만족해야 한다(기존과 동일).

CREATE OR REPLACE FUNCTION public.get_my_market_alert_matches()
RETURNS SETOF public.market_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT mi.*
  FROM public.market_items mi
  JOIN public.market_alert_keywords k
    ON k.user_id = auth.uid()
   AND (k.category IS NULL OR mi.category = k.category)
   AND (k.sub_category IS NULL OR k.sub_category = '' OR mi.sub_category = k.sub_category)
   AND (k.price_min IS NULL OR mi.price >= k.price_min)
   AND (k.price_max IS NULL OR mi.price <= k.price_max)
   AND (mi.title ILIKE '%' || k.keyword || '%' OR mi.description ILIKE '%' || k.keyword || '%')
  WHERE mi.status = 'ON_SALE'
    AND mi.user_id <> auth.uid()
    AND mi.hidden IS NOT TRUE;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_market_alert_matches() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_market_alert_matches() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_market_alert_matches() TO authenticated;
