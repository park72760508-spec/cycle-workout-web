-- 중고랜드 이미지 검색 — CLIP(ViT-B/32) 512차원 임베딩을 market_items에 저장하고, 코사인
-- 유사도로 시각적으로 비슷한 상품을 찾는 RPC를 추가한다. 임베딩 계산 자체(검색 조회 시점)는
-- 클라이언트(브라우저)에서 직접 하므로 이 RPC는 이미 계산된 벡터를 받아 검색만 수행한다
-- (assets/js/market/marketScreen.js의 computeMarketImageEmbeddingFromBlob 참고). 등록 시
-- market_items.embedding 기록은 서버(Firebase Functions indexMarketItemEmbedding, service role)
-- 에서만 하며, 이 RPC는 SELECT만 하므로 별도 쓰기 정책은 필요 없다.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS embedding vector(512),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS market_items_embedding_idx
  ON public.market_items
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_products_by_image(
  p_embedding vector(512),
  p_match_threshold float DEFAULT 0.6,
  p_match_count int DEFAULT 20,
  p_filter_category text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  price integer,
  purchase_price integer,
  category text,
  sub_category text,
  condition text,
  images text[],
  status text,
  view_count integer,
  created_at timestamptz,
  user_id uuid,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    mi.id, mi.title, mi.price, mi.purchase_price, mi.category, mi.sub_category,
    mi.condition, mi.images, mi.status, mi.view_count, mi.created_at, mi.user_id,
    1 - (mi.embedding <=> p_embedding) AS similarity
  FROM public.market_items mi
  WHERE mi.embedding IS NOT NULL
    AND mi.status <> 'HIDDEN'
    AND (p_filter_category IS NULL OR mi.category = p_filter_category)
    AND 1 - (mi.embedding <=> p_embedding) >= p_match_threshold
  ORDER BY mi.embedding <=> p_embedding ASC
  LIMIT p_match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_products_by_image(vector, float, int, text) TO authenticated;
