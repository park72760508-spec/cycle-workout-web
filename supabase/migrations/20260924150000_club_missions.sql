-- 클럽 챌린지 미션 — 클럽 상세 > 라이딩 모임 캘린더 카드의 "미션" 탭.
-- 클럽당 진행 중 미션 1개(is_active), 미션은 순서가 있는 워크아웃 목록(steps)으로 구성된다.
-- 회원은 순서대로 수행하며, 해당 워크아웃 훈련이 저장되면(Cloud Functions가 훈련 로그 검증)
-- club_mission_completions 에 단계별 완료가 기록된다.
--
-- steps(jsonb) 원소: { "ord": 1, "workoutId": "...", "workoutSource": "gas"|"club",
--                      "title": "...", "totalSeconds": 3600 }

CREATE TABLE public.club_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_missions_date_range CHECK (end_date >= start_date)
);
-- 클럽당 진행 중(is_active) 미션은 1개
CREATE UNIQUE INDEX uq_club_missions_active_per_group
  ON public.club_missions(group_id) WHERE is_active;

CREATE TABLE public.club_mission_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.club_missions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step_ord integer NOT NULL,
  workout_id text NOT NULL,
  training_log_id text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_club_mission_completion UNIQUE (mission_id, user_id, step_ord)
);
CREATE INDEX idx_club_mission_completions_mission_user
  ON public.club_mission_completions(mission_id, user_id);

-- 서비스 롤(Cloud Functions)만 쓰고 읽는다 — 클라이언트 직접 접근 차단.
ALTER TABLE public.club_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_mission_completions ENABLE ROW LEVEL SECURITY;
