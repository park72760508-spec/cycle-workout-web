-- 클럽 미션 자동 완료 보강(2026-09-29): 미션 상세 START 대기 정보(localStorage)가 없어도
-- 훈련 저장 직후 "이 워크아웃이 내가 속한 클럽의 진행 중 미션 다음 단계인가"를 찾아 완료 요청할 수 있게 한다.
-- 실제 완료·점수 산출·검증은 기존 completeClubMissionStep(functions/clubMissions.js)이 그대로 수행.
CREATE OR REPLACE FUNCTION public.fn_my_mission_step_for_workout(p_workout_id text, p_ride_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  d AS (SELECT coalesce(p_ride_date, (now() AT TIME ZONE 'Asia/Seoul')::date) AS day),
  cand AS (
    SELECT g.firestore_doc_id AS group_id, m.id AS mission_id, m.steps
    FROM me
    JOIN riding_group_members gm ON gm.user_id = me.uid
    JOIN riding_groups g ON g.id = gm.group_id
    JOIN club_missions m ON m.group_id = g.id AND m.is_active
    CROSS JOIN d
    WHERE me.uid IS NOT NULL
      AND nullif(btrim(g.firestore_doc_id), '') IS NOT NULL
      AND (gm.membership_expires_at IS NULL OR gm.membership_expires_at::date >= d.day)
      AND d.day BETWEEN m.start_date AND m.end_date
  ),
  nxt AS (
    SELECT c.group_id, c.mission_id,
      (SELECT (s->>'ord')::int FROM jsonb_array_elements(c.steps) s
        WHERE NOT EXISTS (SELECT 1 FROM club_mission_completions cc, me
                          WHERE cc.mission_id = c.mission_id AND cc.user_id = me.uid AND cc.step_ord = (s->>'ord')::int)
        ORDER BY (s->>'ord')::int LIMIT 1) AS next_ord,
      c.steps
    FROM cand c
  )
  SELECT jsonb_build_object(
    'success', (SELECT uid FROM me) IS NOT NULL,
    'matches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('groupId', n.group_id, 'missionId', n.mission_id, 'stepOrd', n.next_ord))
      FROM nxt n
      WHERE n.next_ord IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(n.steps) s
                    WHERE (s->>'ord')::int = n.next_ord AND s->>'workoutId' = p_workout_id)
    ), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_my_mission_step_for_workout(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_mission_step_for_workout(text, date) TO authenticated;
