-- 중고랜드 상세화면: (1) 조회수 중복 집계 방지 — 동일 사용자가 여러 번 봐도 1건만 카운팅
-- (2) 등록자(판매자) 연락처(전화번호) 노출 — 마켓에서 실제 거래를 위해 필요한 정보이므로
--     전체 공개 프로필 뷰(v_user_public_profile)에는 추가하지 않고, "현재 판매중인 상품이 있는
--     사용자"로 노출 범위를 좁힌 전용 SECURITY DEFINER 함수로 제공한다.

CREATE TABLE IF NOT EXISTS public.market_item_views (
  item_id uuid NOT NULL REFERENCES public.market_items(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, viewer_id)
);
ALTER TABLE public.market_item_views ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_item_views TO service_role;
-- 클라이언트는 이 테이블에 직접 접근하지 않고 아래 SECURITY DEFINER 함수로만 기록/집계한다
-- (RLS 활성화 + 정책 없음 = 기본 전체 거부).

CREATE OR REPLACE FUNCTION public.increment_market_item_view(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_inserted_count int;
BEGIN
  IF v_viewer IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.market_item_views (item_id, viewer_id)
  VALUES (p_item_id, v_viewer)
  ON CONFLICT (item_id, viewer_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count > 0 THEN
    UPDATE public.market_items SET view_count = view_count + 1 WHERE id = p_item_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_market_item_view(uuid) TO authenticated;

-- 판매자 연락처(전화번호) — 대상이 실제로 상품을 등록한 판매자인 경우에만 노출
CREATE OR REPLACE FUNCTION public.get_market_seller_contact(p_seller_id uuid)
RETURNS TABLE(phone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.phone
  FROM public.users u
  WHERE u.id = p_seller_id
    AND EXISTS (SELECT 1 FROM public.market_items mi WHERE mi.user_id = p_seller_id)
$$;
GRANT EXECUTE ON FUNCTION public.get_market_seller_contact(uuid) TO authenticated;
