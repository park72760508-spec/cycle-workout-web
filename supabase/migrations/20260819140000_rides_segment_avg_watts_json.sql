-- 워크아웃 세그먼트별 실제 평균 파워(W) — 라이딩 기록 워크아웃 그래프 "실제 파워" 오버레이용.
-- Firestore를 거치지 않고 Supabase rides에 직접 저장/조회하기 위해 elevation_profile_json,
-- time_in_zones_json과 동일한 규칙(_json 접미사, dual-write 시 upsert)으로 추가한다.
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS segment_avg_watts_json jsonb;

COMMENT ON COLUMN public.rides.segment_avg_watts_json IS '워크아웃 세그먼트별 실제 평균 파워(W) 배열 — 인도어 구조화 워크아웃에서만 존재. 라이딩 기록 워크아웃 그래프 오버레이용.';
