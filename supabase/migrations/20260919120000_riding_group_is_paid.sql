-- 클럽(그룹)에 "유료 그룹" 여부 컬럼 추가.
-- 가입 기간(만료일) 기반 콘텐츠 게이팅은 is_paid=true인 클럽에 한해서만 적용된다.
-- 무료(공개) 클럽은 만료일 개념 자체를 쓰지 않는 자유로운 클럽으로 동작한다.
ALTER TABLE public.riding_groups
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;
