-- 일요일 21:00 주간 TSS 랭킹 1~3등 포인트 지급 이력 (functions/index.js finalizeWeeklyRanking, 2026-10-08)
-- (week_start, rank) 유일 — 같은 주 재실행·스케줄러 재시도 시 중복 지급 방지.
-- 지급 직전에 기록(최대 1회 지급). 기록 후 Firestore 갱신이 실패하면 status='failed' 로 남겨 수동 확인.
CREATE TABLE IF NOT EXISTS public.weekly_ranking_awards (
  week_start   date        NOT NULL,
  week_end     date        NOT NULL,
  rank         smallint    NOT NULL CHECK (rank BETWEEN 1 AND 3),
  firebase_uid text        NOT NULL,
  user_name    text,
  total_tss    numeric,
  points       integer     NOT NULL,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz,
  PRIMARY KEY (week_start, rank)
);

ALTER TABLE public.weekly_ranking_awards ENABLE ROW LEVEL SECURITY;
-- 정책 없음: service_role(Cloud Functions)만 접근
REVOKE ALL ON public.weekly_ranking_awards FROM anon, authenticated;
