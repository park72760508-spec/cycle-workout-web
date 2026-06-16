-- CYCLE+RUN 듀얼 카테고리 및 RUN 전용 운동 목적

ALTER TYPE public.sport_category ADD VALUE IF NOT EXISTS 'CYCLE_RUN';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS run_challenge public.challenge_goal;

COMMENT ON COLUMN public.users.run_challenge IS 'RUN 운동 목적 — CYCLE+RUN·RUN 사용자 (challenge=CYCLE 목적)';
