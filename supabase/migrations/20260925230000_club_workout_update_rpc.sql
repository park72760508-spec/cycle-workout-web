-- 워크아웃 > 클럽 전용 > 카드 "수정": 클럽 전용 워크아웃 제목·설명·카테고리·세그먼트 교체.
-- 권한: fn_can_manage_riding_group_for(방장·사이트 관리자·그 클럽 멤버인 부관리자) — createClubWorkoutSupabase 와 동일.
-- 세그먼트 정리 규칙은 functions/clubWorkoutWrites.js sanitizeSegments 와 동일(최대 200개, 문자열 길이 제한).

CREATE OR REPLACE FUNCTION public.fn_update_club_workout(
  p_group_id text,
  p_workout_id uuid,
  p_title text,
  p_description text,
  p_author text,
  p_segments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_title text := left(btrim(coalesce(p_title, '')), 100);
  v_count int := CASE WHEN jsonb_typeof(p_segments) = 'array' THEN jsonb_array_length(p_segments) ELSE 0 END;
  v_total int;
BEGIN
  SELECT id INTO v_group FROM riding_groups
  WHERE firestore_doc_id = p_group_id OR id::text = p_group_id
  LIMIT 1;
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '이 작업을 수행할 권한이 없습니다.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM club_workouts WHERE id = p_workout_id AND group_id = v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '워크아웃을 찾을 수 없습니다.');
  END IF;
  IF v_title = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '제목을 입력해주세요.');
  END IF;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '세그먼트를 1개 이상 추가해 주세요.');
  END IF;
  IF v_count > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', '세그먼트가 너무 많습니다.');
  END IF;

  DELETE FROM club_workout_segments WHERE workout_id = p_workout_id;
  INSERT INTO club_workout_segments (workout_id, ord, label, segment_type, duration_sec, target_type, target_value, ramp, ramp_to_value)
  SELECT p_workout_id,
         (e.ord - 1)::int,
         left(coalesce(e.seg->>'label', ''), 100),
         left(coalesce(nullif(e.seg->>'segment_type', ''), 'steady'), 50),
         greatest(0, floor(coalesce(nullif(e.seg->>'duration_sec', '')::numeric, 0)))::int,
         left(coalesce(nullif(e.seg->>'target_type', ''), 'ftp_pct'), 30),
         left(coalesce(e.seg->>'target_value', '0'), 30),
         CASE WHEN e.seg->>'ramp' = 'linear' THEN 'linear' ELSE 'none' END,
         CASE WHEN e.seg->>'ramp' = 'linear' THEN nullif(e.seg->>'ramp_to_value', '')::numeric ELSE NULL END
  FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS e(seg, ord);

  SELECT coalesce(sum(duration_sec), 0) INTO v_total FROM club_workout_segments WHERE workout_id = p_workout_id;
  UPDATE club_workouts
  SET title = v_title,
      description = left(coalesce(p_description, ''), 500),
      author = left(coalesce(p_author, ''), 50),
      total_seconds = v_total,
      updated_at = now()
  WHERE id = p_workout_id;

  RETURN jsonb_build_object('success', true, 'id', p_workout_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_update_club_workout(text, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_club_workout(text, uuid, text, text, text, jsonb) TO authenticated;
