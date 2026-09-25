-- 워크아웃 > 클럽 전용 목록·워크아웃 작성 > 목록: CYCLE 카테고리의 멤버쉽(is_paid) 클럽만.

CREATE OR REPLACE FUNCTION public.fn_my_manageable_clubs()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'groupId', COALESCE(NULLIF(btrim(g.firestore_doc_id), ''), g.id::text),
           'name', g.name,
           'isPaid', g.is_paid,
           'photoUrl', g.photo_url,
           'workoutCount', (SELECT count(*) FROM club_workouts w WHERE w.group_id = g.id))
         ORDER BY g.name), '[]'::jsonb)
  FROM riding_groups g
  WHERE g.status = 'APPROVED'
    AND g.category = 'CYCLE'
    AND g.is_paid = true
    AND public.fn_can_manage_riding_group_for(auth.uid(), g.id);
$$;
REVOKE ALL ON FUNCTION public.fn_my_manageable_clubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_manageable_clubs() TO authenticated;

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
  WHERE g.status = 'APPROVED'
    AND g.category = 'CYCLE'
    AND g.is_paid = true
    AND public.fn_can_manage_riding_group_for(auth.uid(), g.id);
$$;
REVOKE ALL ON FUNCTION public.fn_my_manageable_membership_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_manageable_membership_groups() TO authenticated;
