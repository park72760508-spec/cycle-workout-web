-- 워크아웃 화면 > "클럽 전용" 카드: 클럽 관리자(방장·사이트 관리자·그 클럽 멤버인 부관리자)가
-- 관리하는 클럽 목록과 그 클럽의 전용 워크아웃(그룹세션 club_workouts)을 Supabase 에서 직접 읽는다.
-- 권한 규칙은 functions/clubWorkoutWrites.js assertGroupWriteAuthority 와 동일.

CREATE OR REPLACE FUNCTION public.fn_can_manage_riding_group_for(p_user uuid, p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
    FROM riding_groups g
    LEFT JOIN users me ON me.id = p_user
    WHERE g.id = p_group_id
      AND (
        g.created_by = p_user
        OR me.grade = 'admin'
        OR (me.grade = 'sub_admin' AND EXISTS (
              SELECT 1 FROM riding_group_members m WHERE m.group_id = g.id AND m.user_id = p_user))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.fn_can_manage_riding_group_for(uuid, uuid) FROM PUBLIC, anon, authenticated;

/** 내가 관리하는 승인된 클럽 — groupId 는 Firestore 문서 ID(없으면 uuid), workoutCount 포함 */
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
    AND public.fn_can_manage_riding_group_for(auth.uid(), g.id);
$$;
REVOKE ALL ON FUNCTION public.fn_my_manageable_clubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_manageable_clubs() TO authenticated;

/** 클럽 전용 워크아웃 목록 — getClubWorkoutsForRead(fetchClubWorkoutsForRead) 와 같은 항목 모양 */
CREATE OR REPLACE FUNCTION public.fn_club_workouts_for_manager(p_group_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH g AS (
    SELECT id FROM riding_groups
    WHERE firestore_doc_id = p_group_id OR id::text = p_group_id
    LIMIT 1
  )
  SELECT CASE
    WHEN NOT public.fn_can_manage_riding_group_for(auth.uid(), (SELECT id FROM g))
      THEN jsonb_build_object('success', false, 'error', 'forbidden')
    ELSE jsonb_build_object('success', true, 'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', w.id,
               'title', w.title,
               'description', COALESCE(w.description, ''),
               'author', COALESCE(w.author, ''),
               'status', w.status,
               'total_seconds', w.total_seconds,
               'publish_date', w.publish_date,
               'source', 'club',
               'groupId', p_group_id,
               'segments', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'ord', s.ord,
                          'label', COALESCE(s.label, ''),
                          'segment_type', s.segment_type,
                          'duration_sec', s.duration_sec,
                          'target_type', s.target_type,
                          'target_value', s.target_value,
                          'ramp', s.ramp,
                          'ramp_to_value', s.ramp_to_value) ORDER BY s.ord)
                 FROM club_workout_segments s WHERE s.workout_id = w.id), '[]'::jsonb))
             ORDER BY w.created_at DESC)
      FROM club_workouts w WHERE w.group_id = (SELECT id FROM g)), '[]'::jsonb))
  END;
$$;
REVOKE ALL ON FUNCTION public.fn_club_workouts_for_manager(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_workouts_for_manager(text) TO authenticated;
