-- Claude AI 맞춤 워크아웃: 하루 1회 생성 + "나의 훈련 목록" 저장 (2026-11-11)
--   user_ai_workout_days : 사용자·날짜별 생성 기록(하루 1회 보장, 추천 요약·조건 meta)
--   user_ai_workouts     : 그날 생성된 워크아웃(1~3순위, 세그먼트 포함) — 삭제해도 day 기록은 남아 재생성 불가
-- 클라이언트는 RPC 로만 접근(RLS 정책 없음, 본인 auth.uid() 한정).

CREATE TABLE IF NOT EXISTS public.user_ai_workout_days (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workout_date date NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workout_date)
);

CREATE TABLE IF NOT EXISTS public.user_ai_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workout_date date NOT NULL,
  rank integer NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  flow text NOT NULL DEFAULT '',
  total_seconds integer NOT NULL DEFAULT 0,
  tss integer NOT NULL DEFAULT 0,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workout_date, rank)
);
CREATE INDEX IF NOT EXISTS idx_user_ai_workouts_user_date ON public.user_ai_workouts(user_id, workout_date DESC, rank);

ALTER TABLE public.user_ai_workout_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_workouts ENABLE ROW LEVEL SECURITY;

/** 오늘(또는 지정일) 생성된 워크아웃 + 요약 */
CREATE OR REPLACE FUNCTION public.fn_ai_workout_day_get(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  SELECT * INTO v_day FROM user_ai_workout_days WHERE user_id = v_uid AND workout_date = p_date;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', true, 'exists', false, 'items', '[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'success', true, 'exists', true, 'meta', v_day.meta, 'created_at', v_day.created_at,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', w.id, 'rank', w.rank, 'title', w.title, 'category', w.category, 'why', w.why, 'flow', w.flow,
        'total_seconds', w.total_seconds, 'tss', w.tss, 'segments', w.segments, 'workout_date', w.workout_date) ORDER BY w.rank)
      FROM user_ai_workouts w WHERE w.user_id = v_uid AND w.workout_date = p_date), '[]'::jsonb));
END;
$$;

/** 하루 1회: 이미 있으면 기존 것을 돌려주고(existed=true) 새로 저장하지 않음 */
CREATE OR REPLACE FUNCTION public.fn_ai_workout_day_save(p_date date, p_meta jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ins integer;
  v_it jsonb;
  v_n integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_items');
  END IF;
  INSERT INTO user_ai_workout_days(user_id, workout_date, meta)
  VALUES (v_uid, p_date, COALESCE(p_meta, '{}'::jsonb))
  ON CONFLICT (user_id, workout_date) DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  IF v_ins = 0 THEN
    RETURN public.fn_ai_workout_day_get(p_date) || jsonb_build_object('existed', true);
  END IF;
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    EXIT WHEN v_n >= 3;
    v_n := v_n + 1;
    INSERT INTO user_ai_workouts(user_id, workout_date, rank, title, category, why, flow, total_seconds, tss, segments)
    VALUES (v_uid, p_date, v_n,
      left(COALESCE(v_it->>'title', ''), 80), left(COALESCE(v_it->>'category', ''), 40), left(COALESCE(v_it->>'why', ''), 200),
      left(COALESCE(v_it->>'flow', ''), 600),
      GREATEST(0, LEAST(COALESCE((v_it->>'total_seconds')::integer, 0), 43200)),
      GREATEST(0, LEAST(COALESCE((v_it->>'tss')::integer, 0), 1000)),
      CASE WHEN jsonb_typeof(v_it->'segments') = 'array' THEN v_it->'segments' ELSE '[]'::jsonb END)
    ON CONFLICT (user_id, workout_date, rank) DO NOTHING;
  END LOOP;
  RETURN public.fn_ai_workout_day_get(p_date) || jsonb_build_object('existed', false);
END;
$$;

/** 나의 훈련 목록(저장된 Claude 워크아웃) — 최신순 */
CREATE OR REPLACE FUNCTION public.fn_ai_workout_list(p_limit integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  RETURN jsonb_build_object('success', true, 'items', COALESCE((
    SELECT jsonb_agg(x ORDER BY x_date DESC, x_rank) FROM (
      SELECT jsonb_build_object('id', w.id, 'rank', w.rank, 'title', w.title, 'category', w.category, 'why', w.why, 'flow', w.flow,
        'total_seconds', w.total_seconds, 'tss', w.tss, 'segments', w.segments, 'workout_date', w.workout_date) AS x,
        w.workout_date AS x_date, w.rank AS x_rank
      FROM user_ai_workouts w WHERE w.user_id = v_uid
      ORDER BY w.workout_date DESC, w.rank
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 200))) t), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_ai_workout_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  DELETE FROM user_ai_workouts WHERE id = p_id AND user_id = v_uid;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ai_workout_day_get(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ai_workout_day_save(date, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ai_workout_list(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ai_workout_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_workout_day_get(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_workout_day_save(date, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_workout_list(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_workout_delete(uuid) TO authenticated;
