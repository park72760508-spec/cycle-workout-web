-- 워크아웃 작성 > 목록: 클럽 전용 워크아웃을 저장할 수 있는 멤버쉽(유료) 클럽 목록 — 본인(auth.uid()) 기준.
-- functions/clubWorkoutWrites.js assertGroupWriteAuthority 와 같은 규칙:
--   방장(created_by) · 사이트 관리자(grade admin=1) · 그 클럽 멤버인 부관리자(grade sub_admin=3)
-- groupId 는 createClubWorkoutSupabase 가 받는 Firestore 문서 ID(없으면 uuid).

CREATE OR REPLACE FUNCTION public.fn_my_manageable_membership_groups()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'groupId', COALESCE(NULLIF(btrim(g.firestore_doc_id), ''), g.id::text),
           'name', g.name) ORDER BY g.name), '[]'::jsonb)
  FROM riding_groups g
  LEFT JOIN users me ON me.id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND g.is_paid = true
    AND g.status = 'APPROVED'
    AND (
      g.created_by = auth.uid()
      OR me.grade = 'admin'
      OR (me.grade = 'sub_admin' AND EXISTS (
            SELECT 1 FROM riding_group_members m WHERE m.group_id = g.id AND m.user_id = auth.uid()))
    );
$$;
REVOKE ALL ON FUNCTION public.fn_my_manageable_membership_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_manageable_membership_groups() TO authenticated;
