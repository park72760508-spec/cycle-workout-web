-- 가격 조정 수락 후 변심 등의 사유로 구매자·판매자 누구든 취소할 수 있게 한다.
-- 기존 decide_market_nego_request는 PENDING 상태의 요청을 판매자만 수락/거절할 수 있었고,
-- ACCEPTED 이후 되돌릴 방법이 없었다. 아래 함수는 ACCEPTED 상태에서만, 그 거래의 구매자
-- 또는 판매자 본인만 취소할 수 있게 하고, 이미 그 협상가로 실제 주문(진행 중)이 생성된
-- 경우엔 결제/거래 상태와 어긋나지 않도록 취소를 막는다(그 경우엔 주문 자체를 취소해야 함).

ALTER TABLE public.market_nego_requests
  DROP CONSTRAINT market_nego_requests_status_check;
ALTER TABLE public.market_nego_requests
  ADD CONSTRAINT market_nego_requests_status_check
  CHECK (status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'CANCELLED'::text]));

CREATE OR REPLACE FUNCTION public.cancel_market_nego_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.market_nego_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.market_nego_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF v_row.buyer_id <> v_uid AND v_row.seller_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_PARTICIPANT';
  END IF;
  IF v_row.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.market_orders o
    WHERE o.item_id = v_row.item_id
      AND o.buyer_id = v_row.buyer_id
      AND o.escrow_status NOT IN ('CANCELLED', 'REFUNDED')
      AND o.created_at >= v_row.decided_at
  ) THEN
    RAISE EXCEPTION 'ORDER_ALREADY_IN_PROGRESS';
  END IF;
  UPDATE public.market_nego_requests
  SET status = 'CANCELLED', decided_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_market_nego_request(uuid) TO authenticated;
