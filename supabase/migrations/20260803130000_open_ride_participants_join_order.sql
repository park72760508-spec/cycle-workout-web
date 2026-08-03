-- open_ride_participants에 join_order(참가 순번) 컬럼 추가.
-- 정원 목록 조회 시 ORDER BY 절이 없어 Postgres가 행 순서를 보장하지 않았고,
-- upsert가 반복되며 물리적 저장 순서가 바뀌어 "1번=방장, 이후 순차 참가 신청 순서"가
-- 화면에서 뒤섞여 보이던 버그(2026-08). Firestore participants 배열(항상 host가 0번,
-- 이후 참가 순서대로 append)의 인덱스를 그대로 저장해 읽기 쿼리가 이 컬럼으로 정렬하게 한다.
ALTER TABLE public.open_ride_participants
  ADD COLUMN IF NOT EXISTS join_order integer;

CREATE INDEX IF NOT EXISTS idx_open_ride_participants_ride_join_order
  ON public.open_ride_participants (ride_id, join_order);
