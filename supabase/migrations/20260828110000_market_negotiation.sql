-- 중고랜드 가격 네고(협상) 기능
-- 판매자가 등록 시 "네고 가능"으로 표시한 상품에 한해, 구매자가 조정 희망가를 제안할 수 있고
-- 판매자가 수락/거절할 수 있다. 상태 전이(PENDING→ACCEPTED/REJECTED)는 판매자만 할 수 있어야
-- 하므로 테이블에는 SELECT 정책만 두고, 모든 쓰기는 아래 SECURITY DEFINER 함수로만 허용한다.

ALTER TABLE public.market_items
  ADD COLUMN IF NOT EXISTS negotiable boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.market_nego_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.market_items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.users(id),
  seller_id uuid NOT NULL REFERENCES public.users(id),
  requested_price integer NOT NULL CHECK (requested_price > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (item_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS market_nego_requests_item_idx ON public.market_nego_requests (item_id, status);

ALTER TABLE public.market_nego_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_nego_requests TO service_role;

-- 구매자는 자신이 보낸 제안을, 판매자는 자기 상품에 들어온 제안을 볼 수 있다
CREATE POLICY market_nego_requests_select ON public.market_nego_requests
  FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- 구매자가 가격 조정을 제안(재제안 시 upsert, 상태는 항상 PENDING으로 리셋)
CREATE OR REPLACE FUNCTION public.submit_market_nego_request(p_item_id uuid, p_price integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_item record;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_item FROM public.market_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;
  IF v_item.user_id = v_buyer THEN
    RAISE EXCEPTION 'CANNOT_NEGO_OWN_ITEM';
  END IF;
  IF NOT v_item.negotiable THEN
    RAISE EXCEPTION 'ITEM_NOT_NEGOTIABLE';
  END IF;
  IF v_item.status <> 'ON_SALE' THEN
    RAISE EXCEPTION 'ITEM_NOT_ON_SALE';
  END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price >= v_item.price THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;

  INSERT INTO public.market_nego_requests (item_id, buyer_id, seller_id, requested_price, status, decided_at)
  VALUES (p_item_id, v_buyer, v_item.user_id, p_price, 'PENDING', NULL)
  ON CONFLICT (item_id, buyer_id) DO UPDATE
    SET requested_price = EXCLUDED.requested_price,
        status = 'PENDING',
        decided_at = NULL,
        created_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_market_nego_request(uuid, integer) TO authenticated;

-- 판매자가 수락/거절 결정 (자기 상품에 들어온 PENDING 제안만 가능)
CREATE OR REPLACE FUNCTION public.decide_market_nego_request(p_request_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid := auth.uid();
  v_row public.market_nego_requests%ROWTYPE;
BEGIN
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.market_nego_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF v_row.seller_id <> v_seller THEN
    RAISE EXCEPTION 'NOT_YOUR_ITEM';
  END IF;
  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED';
  END IF;
  UPDATE public.market_nego_requests
  SET status = CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END,
      decided_at = now()
  WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_market_nego_request(uuid, boolean) TO authenticated;
