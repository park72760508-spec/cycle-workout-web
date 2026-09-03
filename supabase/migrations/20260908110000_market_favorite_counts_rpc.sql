-- 중고랜드 찜(관심상품) 카운트를 "전체 사용자 합산"으로 정확히 조회하기 위한 RPC.
--
-- market_favorites의 RLS 정책(market_favorites_own, FOR ALL USING (user_id = auth.uid()))은
-- 본인 행만 조회 가능하도록 되어 있다 — 이는 "누가 찜했는지" 개인정보 보호 목적으로는 맞지만,
-- 부작용으로 목록/상세 화면의 찜 카운트 조회(item_id로 전체 행을 세는 쿼리)까지 RLS에 걸려
-- 실제로는 "본인이 찜했는지(0 또는 1)"만 세어지는 버그를 유발했다(2026-09 실사례 — 다른
-- 사용자가 찜해도 카운트가 올라가지 않고 항상 0/1로만 보임).
--
-- SECURITY DEFINER 함수로 RLS를 우회해 집계만(개별 user_id는 노출하지 않고 개수만) 반환한다.

CREATE OR REPLACE FUNCTION public.get_market_favorite_counts(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, favorite_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mf.item_id, COUNT(*)::bigint AS favorite_count
  FROM public.market_favorites mf
  WHERE mf.item_id = ANY(p_item_ids)
  GROUP BY mf.item_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_market_favorite_counts(uuid[]) TO authenticated;
