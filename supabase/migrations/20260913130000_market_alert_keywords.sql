-- 중고랜드 키워드 알림 — 사용자가 등록한 키워드(+선택적 카테고리/서브카테고리/가격대) 조건에
-- 맞는 활성 매물을 조회 시점에 직접 JOIN으로 찾는다(트리거·매칭테이블 없이 가장 단순한 구조).

CREATE TABLE public.market_alert_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  keyword text NOT NULL CHECK (char_length(trim(keyword)) >= 2),
  category text CHECK (category IN ('CYCLE', 'RUN')), -- NULL = 카테고리 무관
  sub_category text, -- NULL/'' = 전체
  price_min integer CHECK (price_min IS NULL OR price_min >= 0),
  price_max integer CHECK (price_max IS NULL OR price_max >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_alert_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_alert_keywords_owner ON public.market_alert_keywords
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_alert_keywords TO authenticated;

-- 내 키워드 조건에 맞는 활성 매물(본인 상품 제외, 판매중만) 조회.
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
   AND mi.title ILIKE '%' || k.keyword || '%'
  WHERE mi.status = 'ON_SALE'
    AND mi.user_id <> auth.uid()
    AND mi.hidden IS NOT TRUE;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_market_alert_matches() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_market_alert_matches() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_market_alert_matches() TO authenticated;
