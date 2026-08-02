-- open_rides에 category(CYCLE/RUN) 컬럼 추가.
-- 라이딩 모임(CYCLE)/러닝 크루(RUN) 캘린더가 이 값으로 종목을 구분하는데, 지금까지 이 테이블에
-- 해당 컬럼이 없어 Supabase Read 경로에서는 전부 CYCLE 기본값으로 취급되어 RUN 캘린더가
-- 항상 빈 목록으로 보였다(2026-08 회귀 조사). 기존 행은 일단 'CYCLE' 기본값으로 채우고,
-- 실제 RUN 라이딩은 별도 백필 스크립트(supabase/migration/scripts/backfillOpenRideCategory.ts)로
-- Firestore rides.category 원본값을 다시 읽어 보정한다.
ALTER TABLE public.open_rides
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'CYCLE'
  CHECK (category IN ('CYCLE', 'RUN'));

CREATE INDEX IF NOT EXISTS idx_open_rides_category_date
  ON public.open_rides (category, ride_date);
