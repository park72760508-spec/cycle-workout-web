-- 클럽 전용 워크아웃 — 기존 구글시트(Workouts/WorkoutSegments) 컬럼 구조를 그대로 미러링하고
-- group_id(클럽 스코프)와 감사용 created_by/updated_at만 추가한다. 세그먼트 필드명은
-- assets/js/workoutManager.js의 렌더링 코드가 그대로 소비하는 원본 시트 컬럼명과 100% 동일하게
-- 맞춰 프런트엔드 변환 없이 재사용 가능하게 한다.
CREATE TABLE public.club_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  total_seconds integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT '보이기',
  publish_date date,
  password text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_club_workouts_group_id ON public.club_workouts(group_id);

CREATE TABLE public.club_workout_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES public.club_workouts(id) ON DELETE CASCADE,
  ord integer NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT '',
  segment_type text NOT NULL DEFAULT '',
  duration_sec integer NOT NULL DEFAULT 0,
  target_type text NOT NULL DEFAULT 'ftp_pct',
  target_value text NOT NULL DEFAULT '0',
  ramp text NOT NULL DEFAULT 'none',
  ramp_to_value numeric
);
CREATE INDEX idx_club_workout_segments_workout_id ON public.club_workout_segments(workout_id);

-- 서비스 롤(Cloud Functions)만 이 두 테이블을 쓰므로 클라이언트 직접 접근은 차단.
ALTER TABLE public.club_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_workout_segments ENABLE ROW LEVEL SECURITY;

-- 그룹세션(인도어 훈련 모임) — 기존 open_rides에 최소 필드만 추가해 기존 캘린더 조회
-- 파이프라인(날짜 범위 조회 + groupId 클라이언트 필터)을 그대로 재사용한다.
ALTER TABLE public.open_rides
  ADD COLUMN is_group_session boolean NOT NULL DEFAULT false,
  ADD COLUMN workout_id text,
  ADD COLUMN workout_source text;
