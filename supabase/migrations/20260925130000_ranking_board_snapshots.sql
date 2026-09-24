-- 비용 절감 3단계: 랭킹보드(getPeakPowerRanking) 공용 응답 스냅샷.
--   랭킹은 배치 구간(GC 01:15·03:30 / 피크·독주 01:00·03:15) 동안 모든 사용자에게 같으므로,
--   Cloud Run 이 배치 구간당 1회 계산한 "뷰어 개인화 전" 응답을 여기에 저장하고
--   앱은 Supabase 에서 직접 읽어 본인 행(currentUser 등)만 클라이언트에서 붙인다.
--   - snapshot_key: '<period>|<duration>|<gender>'   epoch: 서버 currentBatchEpochKeyKst 와 동일 문자열
--   - 쓰기는 서비스 롤(Cloud Functions)만. 읽기는 기존 공개 API(getPeakPowerRanking)와 같은 범위라 공개.

CREATE TABLE IF NOT EXISTS public.ranking_board_snapshots (
  snapshot_key text PRIMARY KEY,
  epoch text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ranking_board_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ranking_board_snapshots_public_read ON public.ranking_board_snapshots;
CREATE POLICY ranking_board_snapshots_public_read ON public.ranking_board_snapshots
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.ranking_board_snapshots TO anon, authenticated;

/** GC 뷰어 헵타곤 7축(supabaseRankingReader.attachGcViewerHeptagonAxes 와 동일) — 본인(auth.uid())만 */
CREATE OR REPLACE FUNCTION public.fn_my_gc_heptagon_axis(p_month_key text, p_gender text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
  ELSE jsonb_build_object('success', true, 'axis', (
    SELECT jsonb_build_object(
      'ranks', h.ranks,
      'cohortN', h.cohort_n_per_axis,
      'positionScores100', h.position_scores100,
      'sumPositionScores', h.sum_position_scores,
      'boardRank', h.board_rank)
    FROM heptagon_cohort_ranks h
    WHERE h.month_key = p_month_key
      AND h.filter_gender = CASE WHEN p_gender IN ('M', 'F') THEN p_gender ELSE 'all' END
      AND h.filter_category = 'Supremo'
      AND h.user_id = auth.uid()
    ORDER BY h.as_of_seoul DESC
    LIMIT 1
  )) END;
$$;
REVOKE ALL ON FUNCTION public.fn_my_gc_heptagon_axis(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_gc_heptagon_axis(text, text) TO authenticated;
