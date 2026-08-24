-- 구매자 상세화면 "거래내역"에 가상계좌 정보를 지속적으로 보여주기 위해, Toss 발급 시점에만
-- 응답으로 잠깐 내려오던 가상계좌 은행/계좌번호를 주문 레코드에 저장해둔다.
ALTER TABLE public.market_orders
  ADD COLUMN IF NOT EXISTS va_bank_code text,
  ADD COLUMN IF NOT EXISTS va_bank_name text,
  ADD COLUMN IF NOT EXISTS va_account_number text;
