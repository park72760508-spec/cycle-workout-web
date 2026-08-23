-- 상품 등록 시 판매자가 입력하는 안전거래 정산 계좌(은행/계좌번호/예금주).
-- 구매 시점에 market_orders.settlement_account로 스냅샷(등록 후 계좌를 바꿔도 이미 진행 중인
-- 거래의 정산지가 바뀌지 않도록).
ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS settlement_bank text,
  ADD COLUMN IF NOT EXISTS settlement_account_number text,
  ADD COLUMN IF NOT EXISTS settlement_holder_name text;
