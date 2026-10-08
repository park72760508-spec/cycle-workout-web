-- 워크아웃 > 클럽 전용: 관리자(방장·관리자·부관리자)뿐 아니라 멤버쉽 클럽의 일반 회원에게도 표시 (2026-10-09)
-- 멤버쉽 기간: riding_group_members.membership_expires_at (NULL = 무기한, 날짜 = 그날(KST)까지 유효)
-- 기간이 끝난 회원은 클럽 카드는 보이되 워크아웃 목록은 열람 불가(membership_expired).
-- 회원은 읽기 전용 — 수정·삭제는 기존처럼 관리자만(canManage).

CREATE OR REPLACE FUNCTION public.fn_my_workout_clubs()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
  base AS (
    SELECT g.*,
      public.fn_can_manage_riding_group_for((SELECT uid FROM me), g.id) AS can_manage,
      m.user_id IS NOT NULL AS is_member,
      m.membership_expires_at
    FROM riding_groups g
    LEFT JOIN riding_group_members m ON m.group_id = g.id AND m.user_id = (SELECT uid FROM me)
    WHERE (SELECT uid FROM me) IS NOT NULL
      AND g.status = 'APPROVED'
      AND g.category = 'CYCLE'
      AND g.is_paid = true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'groupId', COALESCE(NULLIF(btrim(b.firestore_doc_id), ''), b.id::text),
           'name', b.name,
           'isPaid', b.is_paid,
           'photoUrl', b.photo_url,
           'workoutCount', (SELECT count(*) FROM club_workouts w WHERE w.group_id = b.id),
           'canManage', b.can_manage,
           'membershipActive', b.can_manage OR b.membership_expires_at IS NULL OR b.membership_expires_at >= (SELECT d FROM today),
           'membershipExpiresAt', b.membership_expires_at)
         ORDER BY b.name), '[]'::jsonb)
  FROM base b
  WHERE b.can_manage OR b.is_member;
$$;
REVOKE ALL ON FUNCTION public.fn_my_workout_clubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_workout_clubs() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_club_workouts_for_viewer(p_group_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_gid uuid;
  v_paid boolean;
  v_can_manage boolean;
  v_member record;
  v_res jsonb;
BEGIN
  SELECT id, is_paid INTO v_gid, v_paid FROM riding_groups
  WHERE firestore_doc_id = p_group_id OR id::text = p_group_id
  LIMIT 1;
  IF v_uid IS NULL OR v_gid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_can_manage := public.fn_can_manage_riding_group_for(v_uid, v_gid);
  IF NOT v_can_manage THEN
    SELECT membership_expires_at INTO v_member FROM riding_group_members WHERE group_id = v_gid AND user_id = v_uid;
    IF NOT FOUND OR v_paid IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden');
    END IF;
    IF v_member.membership_expires_at IS NOT NULL
       AND v_member.membership_expires_at < (now() AT TIME ZONE 'Asia/Seoul')::date THEN
      RETURN jsonb_build_object('success', false, 'error', 'membership_expired',
                                'membershipExpiresAt', v_member.membership_expires_at);
    END IF;
  END IF;

  -- 목록 JSON 은 fn_club_workouts_for_manager 와 동일(+ canManage)
  v_res := public.fn_club_workouts_for_manager_items(v_gid, p_group_id);
  RETURN jsonb_build_object('success', true, 'canManage', v_can_manage, 'items', v_res);
END;
$$;

-- fn_club_workouts_for_manager 의 items 부분을 그대로 분리 (권한 확인은 호출부에서)
CREATE OR REPLACE FUNCTION public.fn_club_workouts_for_manager_items(p_gid uuid, p_group_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
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
    FROM club_workouts w WHERE w.group_id = p_gid), '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.fn_club_workouts_for_manager_items(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_club_workouts_for_viewer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_workouts_for_viewer(text) TO authenticated;
