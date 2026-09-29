-- 라이딩 기록 > 훈련 요약 워크아웃 그래프(2026-09-29): 클럽 전용 워크아웃(club_workouts)으로 훈련한 경우
-- STELVIO 워크아웃 목록에 없어 "워크아웃 세그먼트 정보가 없습니다"로 표시되던 문제.
-- 권한: 그 클럽 회원 · 클럽 관리자 · 그 워크아웃으로 훈련한 기록(rides)이 있는 본인.
CREATE OR REPLACE FUNCTION public.fn_club_workout_detail(p_workout_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (
    SELECT cw.* FROM club_workouts cw
    WHERE cw.id::text = btrim(coalesce(p_workout_id, ''))
    LIMIT 1
  ),
  ok AS (
    SELECT EXISTS (
      SELECT 1 FROM w
      WHERE auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM riding_group_members m WHERE m.group_id = w.group_id AND m.user_id = auth.uid())
        OR public.fn_can_manage_riding_group_for(auth.uid(), w.group_id)
        OR EXISTS (SELECT 1 FROM rides r WHERE r.user_id = auth.uid() AND r.workout_id = w.id::text)
      )
    ) AS allowed
  )
  SELECT CASE
    WHEN NOT (SELECT allowed FROM ok) THEN jsonb_build_object('success', false, 'error', 'not_found')
    ELSE (
      SELECT jsonb_build_object(
        'success', true,
        'item', jsonb_build_object(
          'id', w.id,
          'title', w.title,
          'source', 'club',
          'total_seconds', w.total_seconds,
          'segments', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'ord', s.ord, 'label', coalesce(s.label, ''), 'segment_type', s.segment_type,
                     'duration_sec', s.duration_sec, 'target_type', s.target_type, 'target_value', s.target_value,
                     'ramp', s.ramp, 'ramp_to_value', s.ramp_to_value) ORDER BY s.ord)
            FROM club_workout_segments s WHERE s.workout_id = w.id), '[]'::jsonb)))
      FROM w)
  END;
$$;
REVOKE ALL ON FUNCTION public.fn_club_workout_detail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_workout_detail(text) TO authenticated;
