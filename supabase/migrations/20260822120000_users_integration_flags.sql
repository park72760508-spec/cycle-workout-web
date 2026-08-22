-- Strava·Gemini 연결 여부 플래그 — 원본 OAuth 토큰/키는 미러링하지 않고 boolean만 저장
-- (관리자 프로필 목록의 초록/회색 점 표시가 Supabase 경로에서도 동작하도록)
alter table public.users
  add column if not exists has_strava_connected boolean not null default false,
  add column if not exists has_gemini_registered boolean not null default false;
