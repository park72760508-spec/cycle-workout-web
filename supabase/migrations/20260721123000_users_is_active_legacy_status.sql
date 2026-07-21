-- 배치 집계 잡(heptagonCohortRanks 등)이 Firestore users 전체 스캔 대신 Supabase public.users를
-- 조회하도록 이관하기 위해, Firestore의 탈퇴/비활성 판정에 쓰이는 원본 필드(is_active, 레거시 status)를
-- 추가로 미러링한다. account_status(enum)만으로는 rankingEligibility.isRankingEligibleUserData()의
-- 판정(is_active===false / status in withdrawn|inactive|deleted)을 완전히 재현할 수 없어 필요.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_status text;

COMMENT ON COLUMN public.users.is_active IS 'Firestore users.is_active 원본 미러 — false면 랭킹 집계 제외';
COMMENT ON COLUMN public.users.legacy_status IS 'Firestore users.status(레거시) 원본 미러 — withdrawn/inactive/deleted면 랭킹 집계 제외';
