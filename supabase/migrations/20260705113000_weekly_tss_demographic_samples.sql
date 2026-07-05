-- 주간 TSS(30주 창) 인구통계 샘플 (Firestore weekly_tss_demographic_samples 대체)
CREATE TABLE IF NOT EXISTS public.weekly_tss_demographic_samples (
  firebase_uid                text PRIMARY KEY,
  user_id                     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  week_tss_list               numeric(7, 1)[],
  avg_thirty_week_window_tss  numeric(8, 1) CHECK (
    avg_thirty_week_window_tss IS NULL OR (
      avg_thirty_week_window_tss >= 0 AND avg_thirty_week_window_tss <= 20000
    )
  ),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.weekly_tss_demographic_samples IS
  '사용자별 30주 주간 TSS — stats_weekly_tss_stelvio_rolling 집계 원천';

ALTER TABLE public.weekly_tss_demographic_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY weekly_tss_demographic_samples_deny_authenticated
  ON public.weekly_tss_demographic_samples
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY weekly_tss_demographic_samples_deny_anon
  ON public.weekly_tss_demographic_samples
  FOR ALL TO anon USING (false) WITH CHECK (false);
