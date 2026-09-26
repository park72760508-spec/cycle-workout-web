-- 클럽 개인레슨 수정(방장·관리자·부관리자) — 완료 전 레슨의 워크아웃·날짜/시간 변경.
CREATE OR REPLACE FUNCTION public.fn_update_club_pt_lesson(
  p_group_id text,
  p_lesson_id uuid,
  p_workout_id text,
  p_workout_source text,
  p_title text,
  p_total_seconds integer,
  p_scheduled_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
  v_updated int;
BEGIN
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '권한이 없습니다.');
  END IF;
  IF coalesce(btrim(p_workout_id), '') = '' OR p_scheduled_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '워크아웃과 날짜/시간을 선택해 주세요.');
  END IF;
  UPDATE club_pt_lessons
  SET workout_id = btrim(p_workout_id),
      workout_source = CASE WHEN p_workout_source = 'club' THEN 'club' ELSE 'gas' END,
      title = left(coalesce(p_title, ''), 200),
      total_seconds = greatest(0, coalesce(p_total_seconds, 0)),
      scheduled_at = p_scheduled_at
  WHERE id = p_lesson_id AND group_id = v_group AND completed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '수정할 수 없는 레슨입니다(완료되었거나 없음).');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_update_club_pt_lesson(text, uuid, text, text, text, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_club_pt_lesson(text, uuid, text, text, text, integer, timestamptz) TO authenticated;
