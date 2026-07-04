-- 프로필 동기화(Firestore users → public.users upsert) 500 오류 복구.
--
-- 증상:
--   provisionSupabaseUserAfterProfileHttp 호출 시 PGRST204
--   "Could not find the 'ranking_favorite_user_ids' column of 'users' in the schema cache"
--   → users upsert 전체 실패 → is_private 등 프로필 동기화가 막힘(랭킹보드 비공개 미반영의 한 원인).
--
-- 원인:
--   20260601120000_users_ranking_favorite_user_ids.sql 의 컬럼이 프로덕션에 미적용이거나,
--   컬럼은 있으나 PostgREST 스키마 캐시가 오래되어(재적재 안 됨) 컬럼을 못 찾는 상태.
--
-- 조치:
--   (1) 컬럼을 멱등(IF NOT EXISTS)으로 재보장.
--   (2) PostgREST 스키마 캐시를 즉시 재적재(NOTIFY)하여 캐시 불일치를 해소.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ranking_favorite_user_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.users.ranking_favorite_user_ids IS
  '랭킹보드 관심 표시 대상 Firebase UID 목록 (Firestore users.rankingFavoriteUserIds)';

-- PostgREST 스키마 캐시 재적재 (컬럼 추가/변경 후 즉시 반영)
NOTIFY pgrst, 'reload schema';
