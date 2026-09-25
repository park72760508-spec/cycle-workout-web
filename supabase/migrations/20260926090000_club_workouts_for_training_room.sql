-- Live Training Room(Coach, 휴대폰) > 워크아웃 선택 > 그룹 전용:
-- 이 Training Room 과 연결된 클럽(riding_groups.live_training_room_code = 방 ID)의 클럽 전용 워크아웃.
-- 항목 모양은 fn_club_workouts_for_manager / getClubWorkoutsForRead 와 동일(+ groupName).

CREATE OR REPLACE FUNCTION public.fn_club_workouts_for_training_room(p_room_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR coalesce(btrim(p_room_code), '') = ''
    THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
  ELSE jsonb_build_object('success', true, 'items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', w.id,
             'title', w.title,
             'description', COALESCE(w.description, ''),
             'author', COALESCE(w.author, ''),
             'status', w.status,
             'total_seconds', w.total_seconds,
             'source', 'club',
             'groupId', COALESCE(NULLIF(btrim(g.firestore_doc_id), ''), g.id::text),
             'groupName', g.name,
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
           ORDER BY g.name, w.created_at DESC)
    FROM riding_groups g
    JOIN club_workouts w ON w.group_id = g.id
    WHERE g.status = 'APPROVED'
      AND btrim(g.live_training_room_code) = btrim(p_room_code)), '[]'::jsonb))
  END;
$$;
REVOKE ALL ON FUNCTION public.fn_club_workouts_for_training_room(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_workouts_for_training_room(text) TO authenticated;
