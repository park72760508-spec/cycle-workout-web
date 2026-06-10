-- 파워/심박 존별 누적 시간 (Firestore time_in_zones 호환 JSON)
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS time_in_zones_json jsonb;

COMMENT ON COLUMN public.rides.time_in_zones_json IS
  '파워 Z0~Z7·심박 Z1~Z5 누적 시간(초). Firestore logs.time_in_zones 와 동일 구조.';
