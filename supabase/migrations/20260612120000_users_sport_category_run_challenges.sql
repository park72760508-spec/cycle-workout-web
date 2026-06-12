-- 사용자 스포츠 카테고리(CYCLE/RUN) 및 러닝 운동 목적 enum 확장

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sport_category') THEN
    CREATE TYPE public.sport_category AS ENUM ('CYCLE', 'RUN');
  END IF;
END
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sport_category public.sport_category NOT NULL DEFAULT 'CYCLE';

COMMENT ON COLUMN public.users.sport_category IS 'Firestore users.category — CYCLE(사이클) | RUN(러닝)';

-- challenge_goal: 러닝 운동 목적 (PR, MastersRace)
ALTER TYPE public.challenge_goal ADD VALUE IF NOT EXISTS 'PR';
ALTER TYPE public.challenge_goal ADD VALUE IF NOT EXISTS 'MastersRace';
