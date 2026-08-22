-- 모임 정산(참가비 등 분담금) — Firestore rides/{id}.settlement 미러 컬럼 추가.
-- items[], bankAccount, registeredBy를 그대로 JSON으로 저장(구조가 items 배열 내 참가자별
-- 대상자 선택을 포함해 정규화 테이블보다 문서형이 더 자연스러움).
ALTER TABLE public.open_rides ADD COLUMN IF NOT EXISTS settlement jsonb;
COMMENT ON COLUMN public.open_rides.settlement IS '모임 정산(참가비 등 분담금) — items[], bankAccount, registeredBy. Firestore rides/{id}.settlement 미러.';
