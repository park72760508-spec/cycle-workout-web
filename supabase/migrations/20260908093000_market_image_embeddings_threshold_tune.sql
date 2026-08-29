-- match_products_by_image 기본 유사도 임계값을 0.6 → 0.68로 상향.
-- 실제 등록 상품 4건의 CLIP 임베딩으로 측정한 결과, 서로 다른 카테고리 상품(예: 물통케이지 vs
-- 완차)조차 코사인 유사도가 0.51~0.60까지 나오는 반면, 같은 계열 상품(완차 vs 완차, 완차 vs
-- 휠셋)은 0.73~0.78로 나와 0.60~0.73 사이에 뚜렷한 간격이 있었다. 0.6은 이 간격보다 낮아
-- 사실상 무관한 상품까지 전부 걸러지지 않고 나오는 문제가 있었다(중고랜드 이미지 검색으로
-- 물통케이지 사진 검색 시 자전거 완차까지 전부 나오던 문제).
CREATE OR REPLACE FUNCTION public.match_products_by_image(
  p_embedding vector(512),
  p_match_threshold float DEFAULT 0.68,
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
