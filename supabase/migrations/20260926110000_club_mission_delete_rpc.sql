-- 클럽 상세 > 클럽 미션 블럭 "삭제": 방장·사이트 관리자·그 클럽 멤버인 부관리자만(fn_can_manage_riding_group_for).
-- 미션 행을 지우면 club_mission_completions 는 ON DELETE CASCADE 로 함께 삭제된다.

CREATE OR REPLACE FUNCTION public.fn_delete_club_mission(p_group_id text, p_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_deleted int;
BEGIN
  SELECT id INTO v_group FROM riding_groups
  WHERE firestore_doc_id = p_group_id OR id::text = p_group_id
  LIMIT 1;
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '미션을 관리할 권한이 없습니다.');
  END IF;
  DELETE FROM club_missions WHERE id = p_mission_id AND group_id = v_group;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '미션을 찾을 수 없습니다.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_delete_club_mission(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_club_mission(text, uuid) TO authenticated;
