-- CYCLE Fitness(CTL) 인구통계 샘플 (Firestore fitness_demographic_samples 대체)
CREATE TABLE IF NOT EXISTS public.fitness_demographic_samples (
  firebase_uid        text PRIMARY KEY,
  user_id             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pmc_model           text NOT NULL DEFAULT 'coggan_ctl',
  latest_ctl          numeric(6, 1) CHECK (latest_ctl IS NULL OR (latest_ctl >= 0 AND latest_ctl <= 200)),
  avg_trend_ctl       numeric(6, 1) CHECK (avg_trend_ctl IS NULL OR (avg_trend_ctl >= 0 AND avg_trend_ctl <= 200)),
  avg_trend_fitness   numeric(6, 1) CHECK (
    avg_trend_fitness IS NULL OR (avg_trend_fitness >= 0 AND avg_trend_fitness <= 200)
  ),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fitness_demographic_samples_pmc_model
  ON public.fitness_demographic_samples (pmc_model);

COMMENT ON TABLE public.fitness_demographic_samples IS
  '사용자별 CYCLE PMC CTL 샘플 — stats_fitness_stelvio_rolling 집계 원천';

ALTER TABLE public.fitness_demographic_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY fitness_demographic_samples_deny_authenticated ON public.fitness_demographic_samples
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY fitness_demographic_samples_deny_anon ON public.fitness_demographic_samples
  FOR ALL TO anon USING (false) WITH CHECK (false);
