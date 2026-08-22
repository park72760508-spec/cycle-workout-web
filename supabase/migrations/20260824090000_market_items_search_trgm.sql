-- 중고랜드 검색(상품명·상품 설명 포함 검색) — ILIKE substring 검색 성능을 위한 trigram GIN 인덱스
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS market_items_title_trgm_idx
  ON public.market_items USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS market_items_description_trgm_idx
  ON public.market_items USING gin (description gin_trgm_ops);
