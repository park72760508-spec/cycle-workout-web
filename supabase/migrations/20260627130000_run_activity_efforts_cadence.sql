-- Strava Run 구간별 평균 케이던스 (streams cadence, spm → UI rpm 표기)
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_1k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_3k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_5k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_7k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_10k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_20k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS cadence_42k integer;

COMMENT ON COLUMN public.run_activity_efforts.cadence_1k IS
  '구간 평균 케이던스 (Strava run cadence stream, spm — UI에서 rpm 표기)';
