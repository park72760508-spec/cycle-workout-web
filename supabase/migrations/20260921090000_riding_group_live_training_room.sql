-- 클럽에 연결된 Live Training Room(그룹 훈련 시스템의 방 코드) — 그룹세션 상세에서
-- 워크아웃 그래프를 클릭하면 이 방으로 바로 입장한다.
ALTER TABLE public.riding_groups
  ADD COLUMN IF NOT EXISTS live_training_room_code text,
  ADD COLUMN IF NOT EXISTS live_training_room_name text;
