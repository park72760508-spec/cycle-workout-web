-- users.phone 컬럼은 Firestore→Supabase 동기화 시 채워지지 않는다(실제 연락처는 Firestore의
-- "contact" 필드로 저장돼 users.contact 컬럼으로만 동기화됨 — functions/supabaseUserProvision.js
-- mapFirestoreUserToRow 참고). phone 컬럼은 사실상 항상 비어 있었으므로, 실제 값이 있는
-- contact 컬럼을 폴백으로 사용하도록 수정한다.
CREATE OR REPLACE FUNCTION public.get_market_seller_contact(p_seller_id uuid)
RETURNS TABLE(phone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(u.phone, ''), NULLIF(u.contact, ''))
  FROM public.users u
  WHERE u.id = p_seller_id
    AND EXISTS (SELECT 1 FROM public.market_items mi WHERE mi.user_id = p_seller_id)
$$;
GRANT EXECUTE ON FUNCTION public.get_market_seller_contact(uuid) TO authenticated;
