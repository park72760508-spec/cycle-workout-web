-- 카카오 경로 재사용 강화(2026-10-24): 같은 날(한국 날짜) 같은 목적지·같은 방식으로 저장된 경로가 있으면
-- 출발지가 그 경로 근처(자전거 500m·걷기 250m)일 때 카카오를 다시 부르지 않고 그 경로를 쓴다(앱이 지금 위치 → 경로까지 짧게 연결).
ALTER TABLE public.kakao_route_cache
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS day date,
  ADD COLUMN IF NOT EXISTS sx double precision,
  ADD COLUMN IF NOT EXISTS sy double precision,
  ADD COLUMN IF NOT EXISTS ex double precision,
  ADD COLUMN IF NOT EXISTS ey double precision;
CREATE INDEX IF NOT EXISTS kakao_route_cache_reuse_idx ON public.kakao_route_cache (api, mode, day);
