-- 비용 절감 4단계: 실시간 랭킹(주간 TSS·TOP10·개인 30일 거리·클럽 거리)과 랭킹 설정 조회를 Cloud Run 밖으로.
--
-- 실시간 보드의 집계는 이미 Supabase SQL(fn_weekly_tss_leaderboard_live 등)에서 수행된다.
-- 데이터가 바뀌면 Supabase 트리거가 ranking_build_meta 의 변경 신호를 갱신하므로,
--   epoch = '<오늘 KST>@<ranking_metrics_live>@<open_rides_live>@<master_daily_rebuild>' (ms)
-- 가 같으면 모든 사용자에게 같은 보드다. Cloud Run 은 epoch 당 1회만 계산해 ranking_board_snapshots 에
-- 저장하고(functions/rankingBoardSnapshots.js), 앱은 Supabase 에서 직접 읽는다.
--
-- 1) open_rides / open_ride_participants 변경 → ranking_build_meta.open_rides_live 갱신(클럽 거리 보드 신호)
-- 2) fn_ranking_public_meta(): getRankingReadRoutingPublic·getRankingBuildMetaPublic 대체(공개)
-- 3) fn_my_group_dist_participated_hosts(): 클럽 거리 보드 뷰어 참가 여부(getHostUserIdsForOpenRidesParticipation 과 동일)

CREATE OR REPLACE FUNCTION public.fn_touch_open_rides_live_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_touch_ranking_build_meta('open_rides_live', 'complete', NULL);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_touch_open_rides_live_meta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_open_rides_touch_live_meta ON public.open_rides;
CREATE TRIGGER trg_open_rides_touch_live_meta
  AFTER INSERT OR UPDATE OR DELETE ON public.open_rides
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_open_rides_live_meta();

DROP TRIGGER IF EXISTS trg_open_ride_participants_touch_live_meta ON public.open_ride_participants;
CREATE TRIGGER trg_open_ride_participants_touch_live_meta
  AFTER INSERT OR UPDATE OR DELETE ON public.open_ride_participants
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_open_rides_live_meta();

SELECT public.fn_touch_ranking_build_meta('open_rides_live', 'complete', NULL);

/** 랭킹 Read DB 설정(appConfig/supabase_read_routing 미러) + 빌드 메타 행 — 공개 값만 */
CREATE OR REPLACE FUNCTION public.fn_ranking_public_meta()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'useSupabaseGlobal', COALESCE((SELECT (c.data->>'useSupabaseGlobal')::boolean
                                   FROM app_config c WHERE c.config_key = 'supabase_read_routing'), true),
    'parityFallbackToFirebase', COALESCE((SELECT (c.data->>'parityFallbackToFirebase')::boolean
                                          FROM app_config c WHERE c.config_key = 'supabase_read_routing'), false),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'meta_key', m.meta_key, 'date_kst', m.date_kst, 'status', m.status,
                        'version', m.version, 'completed_at', m.completed_at, 'updated_at', m.updated_at))
                      FROM ranking_build_meta m), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_ranking_public_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ranking_public_meta() TO anon, authenticated;

/** 본인(auth.uid())이 참가(대기 제외)한 기간 내 비취소 오픈 라이딩의 방장 firebase_uid 목록 */
CREATE OR REPLACE FUNCTION public.fn_my_group_dist_participated_hosts(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT btrim(hu.firebase_uid)), '[]'::jsonb)
  FROM open_ride_participants p
  JOIN open_rides r ON r.id = p.ride_id
  JOIN users hu ON hu.id = r.host_user_id
  WHERE auth.uid() IS NOT NULL
    AND p.user_id = auth.uid()
    AND p.is_waitlist = false
    AND r.ride_date >= p_start AND r.ride_date <= p_end
    AND r.status <> 'cancelled'
    AND hu.firebase_uid IS NOT NULL AND btrim(hu.firebase_uid) <> '';
$$;
REVOKE ALL ON FUNCTION public.fn_my_group_dist_participated_hosts(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_group_dist_participated_hosts(date, date) TO authenticated;
