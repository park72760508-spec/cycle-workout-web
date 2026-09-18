-- 클럽(라이딩 그룹) 가입 기간(만료일) — grade=1/3 관리자가 가입 승인 시 함께 지정하는
-- 단일 만료일. 만료된 회원은 클럽 콘텐츠(모임 생성/조회 등) 이용이 제한되고, "연장하기"로
-- 갱신 신청(riding_group_join_requests에 is_renewal=true row)을 다시 만든다.

ALTER TABLE public.riding_group_members
  ADD COLUMN IF NOT EXISTS membership_expires_at date;

COMMENT ON COLUMN public.riding_group_members.membership_expires_at IS
  '가입 유효 기간 만료일(단일 날짜, 그 날짜까지 유효). NULL = 무기한(기존 회원·미설정).';

ALTER TABLE public.riding_group_join_requests
  ADD COLUMN IF NOT EXISTS requested_expires_at date,
  ADD COLUMN IF NOT EXISTS is_renewal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.riding_group_join_requests.requested_expires_at IS
  '관리자/부관리자가 "기간" 버튼으로 미리 지정한 만료일(수락 시 members.membership_expires_at으로 복사됨). NULL이면 수락 버튼 비활성.';
COMMENT ON COLUMN public.riding_group_join_requests.is_renewal IS
  '기존 회원이 만료 후 "연장하기"로 다시 만든 갱신 신청인지 여부(신규 가입 신청과 UI 문구 구분용).';
