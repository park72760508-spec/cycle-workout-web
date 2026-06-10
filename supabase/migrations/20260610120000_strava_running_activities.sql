-- Strava 러닝·워킹 활동 (사이클 rides 테이블과 분리)
CREATE TABLE IF NOT EXISTS public.activities (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source            public.activity_source NOT NULL DEFAULT 'strava',
  activity_id       text NOT NULL,
  activity_type     text NOT NULL,

  title             text,
  activity_date     date NOT NULL,
  duration_sec      integer NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  distance_km       numeric(10,3),
  elevation_gain_m  numeric(8,1),
  avg_speed_kmh     numeric(6,2),
  avg_hr            smallint,
  max_hr            smallint,
  splits_metric     jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activities_user_activity_unique UNIQUE (user_id, activity_id)
);

COMMENT ON TABLE public.activities IS 'Strava Run/Walk 등 비사이클 활동 — rides·랭킹 트리거와 분리';
COMMENT ON COLUMN public.activities.splits_metric IS 'Strava splits_metric 경량 JSONB (거리·시간·속도·심박)';

CREATE INDEX IF NOT EXISTS idx_activities_user_date
  ON public.activities (user_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_activities_activity_id
  ON public.activities (activity_id);
