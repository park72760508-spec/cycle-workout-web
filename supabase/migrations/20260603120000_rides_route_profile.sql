-- Strava summary_polyline + 고도 프로파일(다운샘플 배열) — 라이딩 일지 SVG·투명 공유 이미지용
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS summary_polyline text,
  ADD COLUMN IF NOT EXISTS elevation_profile_json jsonb,
  ADD COLUMN IF NOT EXISTS route_profile_updated_at timestamptz;

COMMENT ON COLUMN public.rides.summary_polyline IS 'Strava map.summary_polyline (encoded polyline)';
COMMENT ON COLUMN public.rides.elevation_profile_json IS '다운샘플 고도(m) 배열 JSON — Strava altitude stream';
COMMENT ON COLUMN public.rides.route_profile_updated_at IS '코스/고도 프로파일 마지막 수집 시각';
