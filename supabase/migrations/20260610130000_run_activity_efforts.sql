-- Strava 러닝 구간별 피크 속도·심박 (1k~20k)
-- ※ 기존 테이블이 있어도 멱등 적용

CREATE TABLE IF NOT EXISTS public.run_activity_efforts (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity_id     text NOT NULL,
  speed_1k        double precision,
  speed_5k        double precision,
  speed_10k       double precision,
  speed_15k       double precision,
  speed_20k       double precision,
  hr_1k           integer,
  hr_5k           integer,
  hr_10k          integer,
  hr_15k          integer,
  hr_20k          integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS speed_1k double precision;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS speed_5k double precision;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS speed_10k double precision;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS speed_15k double precision;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS speed_20k double precision;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS hr_1k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS hr_5k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS hr_10k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS hr_15k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS hr_20k integer;
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.run_activity_efforts
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'run_activity_efforts_user_activity_unique'
      AND conrelid = 'public.run_activity_efforts'::regclass
  ) THEN
    ALTER TABLE public.run_activity_efforts
      ADD CONSTRAINT run_activity_efforts_user_activity_unique UNIQUE (user_id, activity_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'run_activity_efforts_activity_fkey'
      AND conrelid = 'public.run_activity_efforts'::regclass
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'activities'
  ) THEN
    ALTER TABLE public.run_activity_efforts
      ADD CONSTRAINT run_activity_efforts_activity_fkey
      FOREIGN KEY (user_id, activity_id)
      REFERENCES public.activities(user_id, activity_id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.run_activity_efforts IS 'Strava Run 구간 피크 — best_efforts(1k/5k/10k) + streams 슬라이딩(15k/20k)';
COMMENT ON COLUMN public.run_activity_efforts.speed_1k IS '구간 평균 속도 m/s';
COMMENT ON COLUMN public.run_activity_efforts.hr_15k IS '15k/20k 구간 최고 심박(bpm), 1k~10k는 평균 심박';

CREATE INDEX IF NOT EXISTS idx_run_activity_efforts_user
  ON public.run_activity_efforts (user_id, activity_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'run_activity_efforts' AND column_name = 'updated_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_run_activity_efforts_updated_at
      ON public.run_activity_efforts (updated_at DESC);
  END IF;
END $$;
