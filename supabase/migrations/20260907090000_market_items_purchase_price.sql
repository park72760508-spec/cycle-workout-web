-- 중고랜드 상품 등록 시 구입가(원가) 입력 지원 — 판매가만 있던 market_items에 구입가 컬럼을
-- 추가한다. 기존 상품은 구입가가 없으므로 nullable로 두고, 상세 화면은 값이 있을 때만
-- 구입가(취소선)+판매가를 함께 표시한다(marketDetailPlainPriceHtml, marketScreen.js).
ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS purchase_price integer CHECK (purchase_price IS NULL OR purchase_price >= 0);
