-- Strava 러닝 구간별 피크 속도·심박 (1k~20k)
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
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT run_activity_efforts_user_activity_unique UNIQUE (user_id, activity_id),
  CONSTRAINT run_activity_efforts_activity_fkey
    FOREIGN KEY (user_id, activity_id)
    REFERENCES public.activities(user_id, activity_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.run_activity_efforts IS 'Strava Run 구간 피크 — best_efforts(1k/5k/10k) + streams 슬라이딩(15k/20k)';
COMMENT ON COLUMN public.run_activity_efforts.speed_1k IS '구간 평균 속도 m/s';
COMMENT ON COLUMN public.run_activity_efforts.hr_15k IS '15k/20k 구간 최고 심박(bpm), 1k~10k는 평균 심박';

CREATE INDEX IF NOT EXISTS idx_run_activity_efforts_user
  ON public.run_activity_efforts (user_id, activity_id);
