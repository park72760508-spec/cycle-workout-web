-- 회원가입 전화번호 문자(SMS) 인증 결과 미러 — 신규 가입자만 true로 기록되며,
-- 그 이전 가입자는 기본값 false로 남는다(소급 재인증 요구 없음).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
