-- Strava 러닝·워킹 활동 (사이클 rides 테이블과 분리)
-- ※ public.activities 가 이미 존재해도 멱등 적용 (CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS public.activities (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source            public.activity_source NOT NULL DEFAULT 'strava',
  activity_id       text NOT NULL,
  activity_type     text NOT NULL DEFAULT '',
  title             text,
  activity_date     date,
  duration_sec      integer NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  distance_km       numeric(10,3),
  elevation_gain_m  numeric(8,1),
  avg_speed_kmh     numeric(6,2),
  avg_hr            smallint,
  max_hr            smallint,
  splits_metric     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 기존 테이블에 ride_date / date 만 있고 activity_date 가 없는 경우 이름 변경
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'ride_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'activity_date'
  ) THEN
    ALTER TABLE public.activities RENAME COLUMN ride_date TO activity_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'activity_date'
  ) THEN
    ALTER TABLE public.activities RENAME COLUMN date TO activity_date;
  END IF;
END $$;

-- 누락 컬럼 보강 (이미 테이블만 있고 컬럼이 부족한 경우)
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS source public.activity_source NOT NULL DEFAULT 'strava';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS activity_id text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS activity_type text NOT NULL DEFAULT '';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS activity_date date;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS duration_sec integer NOT NULL DEFAULT 0;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS distance_km numeric(10,3);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS elevation_gain_m numeric(8,1);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS avg_speed_kmh numeric(6,2);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS avg_hr smallint;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS max_hr smallint;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS splits_metric jsonb;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS tss numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- activity_date 백필 (nullable → 이후 앱에서 채움)
UPDATE public.activities
SET activity_date = (created_at AT TIME ZONE 'Asia/Seoul')::date
WHERE activity_date IS NULL AND created_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_user_activity_unique'
      AND conrelid = 'public.activities'::regclass
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_user_activity_unique UNIQUE (user_id, activity_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.activities IS 'Strava Run/Walk 등 비사이클 활동 — rides·랭킹 트리거와 분리';
COMMENT ON COLUMN public.activities.splits_metric IS 'Strava splits_metric 경량 JSONB (거리·시간·속도·심박)';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'activity_date'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_activities_user_date
      ON public.activities (user_id, activity_date DESC);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activities_activity_id
  ON public.activities (activity_id);
