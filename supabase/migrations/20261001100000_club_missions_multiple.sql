-- 2026-10-01 클럽 미션 여러 개(이전·진행 중·예정) — 클럽당 활성 미션 1개 제한 해제.
-- is_active = 삭제되지 않은 미션. 기간 겹침 방지는 서버(functions/clubMissions.js handleSaveClubMission)가 검증.
DROP INDEX IF EXISTS public.uq_club_missions_active_per_group;
CREATE INDEX IF NOT EXISTS idx_club_missions_group_start ON public.club_missions (group_id, start_date) WHERE is_active;
