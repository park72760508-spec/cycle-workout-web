-- 클럽 미션 상세(2026-09-29): 완료한 단계 그래프에 세그먼트별 달성 파워 표시(라이딩 기록 워크아웃 그래프와 동일).
-- 미션 상세 '(9/29 완료)' 표시용 완료일(completedDateKst)도 함께 반환.
-- 본인 완료 기록(club_mission_completions.training_log_id) → rides(activity_id 'stelvio:'||로그ID)의 구간 평균 파워·FTP.
CREATE OR REPLACE FUNCTION public.fn_my_mission_step_actual_power(p_mission_id uuid, p_step_ord int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'success', true,
      'segmentAvgWatts', r.segment_avg_watts_json,
      'ftp', r.ftp_at_time,
      'completedAt', c.completed_at,
      'completedDateKst', to_char(c.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
    FROM club_mission_completions c
    LEFT JOIN rides r ON r.user_id = c.user_id
               AND (r.activity_id = 'stelvio:' || c.training_log_id OR r.activity_id = c.training_log_id)
    WHERE auth.uid() IS NOT NULL
      AND c.user_id = auth.uid()
      AND c.mission_id = p_mission_id
      AND c.step_ord = p_step_ord
    LIMIT 1
  ), jsonb_build_object('success', auth.uid() IS NOT NULL, 'segmentAvgWatts', NULL, 'ftp', NULL, 'completedAt', NULL, 'completedDateKst', NULL));
$$;
REVOKE ALL ON FUNCTION public.fn_my_mission_step_actual_power(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_mission_step_actual_power(uuid, int) TO authenticated;
