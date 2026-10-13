-- 2026-10-14: 클럽 미션 통과 기준 90점 — 90점 미만(미달성) 단계는 완료로 보지 않아 같은 단계를 다시 수행하면
-- 자동 완료(재채점) 대상이 되도록 fn_my_mission_step_for_workout 의 '다음 단계' 판정을 바꾼다.
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
                          WHERE cc.mission_id = c.mission_id AND cc.user_id = me.uid AND cc.step_ord = (s->>'ord')::int
                            AND (cc.step_score IS NULL OR cc.step_score >= 90))
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
