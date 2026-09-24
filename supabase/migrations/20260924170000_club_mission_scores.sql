-- 클럽 챌린지 미션 달성 점수 — 단계 완료 시 서버가 산출해 저장(functions/clubMissionScoring.js).
--   step_score           : 단계 달성 점수 0~100 = 인터벌 달성률 × W/kg 가중치
--   interval_achievement : 인터벌(워밍업·쿨다운·휴식 제외) 목표 대비 달성률 % (세그먼트별 100% 상한, 시간 가중)
--   wkg / wkg_factor     : 인터벌 평균 W/kg, 가중치 0.80(≤2.0) ~ 1.00(≥4.0)
--   score_method         : 'segments'(구간별 파워) | 'overall'(구간 파워 없을 때 전체 평균 파워로 대체)
ALTER TABLE public.club_mission_completions
  ADD COLUMN step_score numeric,
  ADD COLUMN interval_achievement numeric,
  ADD COLUMN wkg numeric,
  ADD COLUMN wkg_factor numeric,
  ADD COLUMN score_method text;
