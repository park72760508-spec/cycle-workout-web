-- 중고랜드 상세화면: 조회수, 판매자 만족도(별점) — 제휴사 만족도 로직(ratingSum/ratingCount 집계,
-- 2점 이상만 평균에 반영)을 그대로 계승하되, Postgres에서는 증분 카운터 없이 직접 집계 쿼리로
-- 단순화(Firestore와 달리 집계 쿼리 비용이 낮아 sum/count 드리프트 위험을 아예 없앨 수 있음).

ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

-- 조회수 증가: RLS를 우회하는 SECURITY DEFINER 함수로만 허용(누구나 자기 것 아닌 상품도 볼 수 있어야 하므로
-- market_items_update 정책의 소유자 제한과는 별도 경로가 필요).
CREATE OR REPLACE FUNCTION public.increment_market_item_view(p_item_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.market_items SET view_count = view_count + 1 WHERE id = p_item_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_market_item_view(uuid) TO authenticated;

-- 판매자 만족도(별점) — 완료된 거래(market_orders.escrow_status = 'CONFIRMED') 1건당 구매자가
-- 판매자를 1~5점으로 평가. 같은 주문에 재평가 시 upsert(order_id UNIQUE).
CREATE TABLE IF NOT EXISTS public.market_seller_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.market_orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.users(id),
  buyer_id uuid NOT NULL REFERENCES public.users(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_seller_ratings_seller_idx ON public.market_seller_ratings (seller_id);

ALTER TABLE public.market_seller_ratings ENABLE ROW LEVEL SECURITY;

-- 평균 표시를 위해 조회는 인증 사용자 전체 허용(개별 점수 자체는 민감정보 아님 — 제휴사 만족도와 동일 원칙)
CREATE POLICY market_seller_ratings_read ON public.market_seller_ratings
  FOR SELECT TO authenticated USING (true);

-- 등록/수정/삭제는 본인 구매 건이 실제로 구매확정(CONFIRMED) 상태일 때만 — DB 레벨에서 이중 검증
CREATE POLICY market_seller_ratings_write ON public.market_seller_ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.market_orders o
      WHERE o.id = order_id AND o.buyer_id = auth.uid() AND o.escrow_status = 'CONFIRMED'
    )
  );

CREATE POLICY market_seller_ratings_update ON public.market_seller_ratings
  FOR UPDATE TO authenticated
  USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY market_seller_ratings_delete ON public.market_seller_ratings
  FOR DELETE TO authenticated USING (buyer_id = auth.uid());

GRANT ALL ON public.market_seller_ratings TO service_role;
