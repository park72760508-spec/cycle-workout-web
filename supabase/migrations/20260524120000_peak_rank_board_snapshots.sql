-- 랭킹보드 순위 등락(↑↓) 스냅샷 — Firestore peak_rank_history 대체
CREATE TABLE IF NOT EXISTS public.peak_rank_board_snapshots (
  history_key                 text PRIMARY KEY,
  as_of_seoul                   date NOT NULL,
  ranks_by_category             jsonb NOT NULL DEFAULT '{}'::jsonb,
  rank_changes_by_category      jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_ranks_by_category    jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_day_ranks_by_category    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.peak_rank_board_snapshots IS
  '랭킹 탭별 부문 순위 스냅샷 — 전일 대비 등락(peak_{duration}_{period}_{gender})';

CREATE INDEX IF NOT EXISTS idx_peak_rank_board_snapshots_as_of
  ON public.peak_rank_board_snapshots (as_of_seoul DESC);

ALTER TABLE public.peak_rank_board_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY peak_rank_board_snapshots_service_only ON public.peak_rank_board_snapshots
  FOR ALL
  USING (false)
  WITH CHECK (false);
