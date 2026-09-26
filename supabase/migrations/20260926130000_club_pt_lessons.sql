-- 클럽 개인레슨(PT) — 클럽 상세 > 캘린더 블럭 "개인레슨(pt.svg)" 탭.
--   club_pt_coupons: 클럽 멤버별 개인PT 쿠폰 수(방장·관리자·부관리자가 멤버 팝업에서 입력)
--   club_pt_lessons: 관리자가 멤버에게 지정한 개인레슨 훈련 일정(워크아웃 + 날짜/시간)
-- 레슨 훈련을 완료(훈련 저장)하면 쿠폰 1개 차감. 클라이언트는 RPC 로만 접근(RLS: 정책 없음).
-- 멤버 목록(riding_group_members)은 Firestore 에서 동기화되는 테이블이라 쿠폰은 별도 테이블에 둔다.

CREATE TABLE IF NOT EXISTS public.club_pt_coupons (
  group_id uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  coupons integer NOT NULL DEFAULT 0 CHECK (coupons >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.club_pt_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ord integer NOT NULL DEFAULT 1,
  workout_id text NOT NULL,
  workout_source text NOT NULL DEFAULT 'gas' CHECK (workout_source IN ('gas', 'club')),
  title text NOT NULL DEFAULT '',
  total_seconds integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  training_log_id text
);
CREATE INDEX IF NOT EXISTS idx_club_pt_lessons_group_time ON public.club_pt_lessons(group_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_club_pt_lessons_user ON public.club_pt_lessons(user_id, scheduled_at);

ALTER TABLE public.club_pt_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_pt_lessons ENABLE ROW LEVEL SECURITY;

/** firestore 문서 ID 또는 uuid → riding_groups.id */
CREATE OR REPLACE FUNCTION public.fn_resolve_riding_group_id(p_group_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM riding_groups WHERE firestore_doc_id = p_group_id OR id::text = p_group_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_resolve_riding_group_id(text) FROM PUBLIC, anon, authenticated;

/** 관리자: 클럽 멤버별 쿠폰 수(이름 포함) — 쿠폰 행이 없으면 0 */
CREATE OR REPLACE FUNCTION public.fn_club_pt_coupons(p_group_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
BEGIN
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '권한이 없습니다.');
  END IF;
  RETURN jsonb_build_object('success', true, 'members', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'userId', u.firebase_uid,
             'name', COALESCE(NULLIF(btrim(u.name), ''), NULLIF(btrim(m.display_name), ''), NULLIF(btrim(u.display_name), ''), '(이름 없음)'),
             'coupons', COALESCE(c.coupons, 0)) ORDER BY COALESCE(NULLIF(btrim(u.name), ''), m.display_name))
    FROM riding_group_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN club_pt_coupons c ON c.group_id = m.group_id AND c.user_id = m.user_id
    WHERE m.group_id = v_group AND u.firebase_uid IS NOT NULL), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_club_pt_coupons(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_pt_coupons(text) TO authenticated;

/** 관리자: 멤버 쿠폰 수 설정(0 이상) */
CREATE OR REPLACE FUNCTION public.fn_set_club_pt_coupons(p_group_id text, p_user_uid text, p_coupons integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
  v_user uuid;
BEGIN
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '권한이 없습니다.');
  END IF;
  SELECT u.id INTO v_user FROM users u
  JOIN riding_group_members m ON m.user_id = u.id AND m.group_id = v_group
  WHERE u.firebase_uid = p_user_uid LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '클럽 멤버가 아닙니다.');
  END IF;
  INSERT INTO club_pt_coupons (group_id, user_id, coupons, updated_by, updated_at)
  VALUES (v_group, v_user, greatest(0, least(coalesce(p_coupons, 0), 9999)), auth.uid(), now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET coupons = EXCLUDED.coupons, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('success', true, 'coupons', greatest(0, least(coalesce(p_coupons, 0), 9999)));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_club_pt_coupons(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_club_pt_coupons(text, text, integer) TO authenticated;

/**
 * 관리자: 개인레슨 일정 저장 — p_lessons: [{ workoutId, workoutSource, title, totalSeconds, scheduledAt }]
 * 일정 개수는 멤버의 보유 쿠폰 수 이하.
 */
CREATE OR REPLACE FUNCTION public.fn_save_club_pt_lessons(p_group_id text, p_user_uid text, p_lessons jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
  v_user uuid;
  v_coupons int;
  v_count int := CASE WHEN jsonb_typeof(p_lessons) = 'array' THEN jsonb_array_length(p_lessons) ELSE 0 END;
  v_base int;
BEGIN
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '권한이 없습니다.');
  END IF;
  SELECT u.id INTO v_user FROM users u
  JOIN riding_group_members m ON m.user_id = u.id AND m.group_id = v_group
  WHERE u.firebase_uid = p_user_uid LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '클럽 멤버가 아닙니다.');
  END IF;
  SELECT coupons INTO v_coupons FROM club_pt_coupons WHERE group_id = v_group AND user_id = v_user;
  IF coalesce(v_coupons, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '개인PT 쿠폰이 없는 멤버입니다.');
  END IF;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '일정을 1개 이상 입력해 주세요.');
  END IF;
  IF v_count > v_coupons THEN
    RETURN jsonb_build_object('success', false, 'error', '일정 개수가 보유 쿠폰(' || v_coupons || '개)보다 많습니다.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lessons) e(x)
    WHERE coalesce(btrim(x->>'workoutId'), '') = '' OR coalesce(btrim(x->>'scheduledAt'), '') = ''
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '모든 일정의 워크아웃과 날짜/시간을 선택해 주세요.');
  END IF;
  SELECT coalesce(max(ord), 0) INTO v_base FROM club_pt_lessons WHERE group_id = v_group AND user_id = v_user;
  INSERT INTO club_pt_lessons (group_id, user_id, ord, workout_id, workout_source, title, total_seconds, scheduled_at, created_by)
  SELECT v_group, v_user, v_base + e.i::int,
         btrim(e.x->>'workoutId'),
         CASE WHEN e.x->>'workoutSource' = 'club' THEN 'club' ELSE 'gas' END,
         left(coalesce(e.x->>'title', ''), 200),
         greatest(0, coalesce(nullif(e.x->>'totalSeconds', '')::numeric, 0))::int,
         (e.x->>'scheduledAt')::timestamptz,
         auth.uid()
  FROM jsonb_array_elements(p_lessons) WITH ORDINALITY AS e(x, i);
  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_save_club_pt_lessons(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_club_pt_lessons(text, text, jsonb) TO authenticated;

/** 기간 내 개인레슨 — 관리자는 클럽 전체, 그 외 멤버는 본인 것만 */
CREATE OR REPLACE FUNCTION public.fn_club_pt_lessons(p_group_id text, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
  v_manage boolean;
BEGIN
  IF v_group IS NULL OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  v_manage := public.fn_can_manage_riding_group_for(auth.uid(), v_group);
  RETURN jsonb_build_object('success', true, 'canManage', v_manage, 'lessons', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', l.id,
             'userId', u.firebase_uid,
             'name', COALESCE(NULLIF(btrim(u.name), ''), NULLIF(btrim(u.display_name), ''), '(이름 없음)'),
             'ord', l.ord,
             'workoutId', l.workout_id,
             'workoutSource', l.workout_source,
             'title', l.title,
             'totalSeconds', l.total_seconds,
             'scheduledAt', l.scheduled_at,
             'completedAt', l.completed_at) ORDER BY l.scheduled_at)
    FROM club_pt_lessons l
    JOIN users u ON u.id = l.user_id
    WHERE l.group_id = v_group
      AND l.scheduled_at >= p_from AND l.scheduled_at < p_to
      AND (v_manage OR l.user_id = auth.uid())), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_club_pt_lessons(text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_pt_lessons(text, timestamptz, timestamptz) TO authenticated;

/** 관리자: 개인레슨 일정 삭제(완료된 레슨은 삭제 불가 — 쿠폰 차감 기록 보존) */
CREATE OR REPLACE FUNCTION public.fn_delete_club_pt_lesson(p_group_id text, p_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := public.fn_resolve_riding_group_id(p_group_id);
  v_deleted int;
BEGIN
  IF v_group IS NULL OR NOT public.fn_can_manage_riding_group_for(auth.uid(), v_group) THEN
    RETURN jsonb_build_object('success', false, 'error', '권한이 없습니다.');
  END IF;
  DELETE FROM club_pt_lessons WHERE id = p_lesson_id AND group_id = v_group AND completed_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '삭제할 수 없는 레슨입니다(완료되었거나 없음).');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_delete_club_pt_lesson(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_club_pt_lesson(text, uuid) TO authenticated;

/**
 * 본인: 레슨 훈련 완료(훈련 저장 직후) — 레슨 완료 표시 + 쿠폰 1개 차감(0 미만 불가).
 * 훈련 시간이 레슨 워크아웃 시간의 50% 미만이면 완료로 인정하지 않는다.
 */
CREATE OR REPLACE FUNCTION public.fn_complete_club_pt_lesson(p_lesson_id uuid, p_training_log_id text, p_duration_sec integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lesson club_pt_lessons%ROWTYPE;
  v_left int;
BEGIN
  SELECT * INTO v_lesson FROM club_pt_lessons WHERE id = p_lesson_id FOR UPDATE;
  IF v_lesson.id IS NULL OR v_lesson.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', '레슨을 찾을 수 없습니다.');
  END IF;
  IF v_lesson.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'completed', false, 'reason', 'already_completed');
  END IF;
  IF v_lesson.total_seconds > 0 AND coalesce(p_duration_sec, 0) < v_lesson.total_seconds * 0.5 THEN
    RETURN jsonb_build_object('success', true, 'completed', false, 'reason', 'too_short');
  END IF;
  UPDATE club_pt_lessons SET completed_at = now(), training_log_id = left(coalesce(p_training_log_id, ''), 200)
  WHERE id = v_lesson.id;
  UPDATE club_pt_coupons SET coupons = greatest(coupons - 1, 0), updated_at = now()
  WHERE group_id = v_lesson.group_id AND user_id = v_lesson.user_id
  RETURNING coupons INTO v_left;
  RETURN jsonb_build_object('success', true, 'completed', true, 'couponsLeft', coalesce(v_left, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_complete_club_pt_lesson(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_complete_club_pt_lesson(uuid, text, integer) TO authenticated;
