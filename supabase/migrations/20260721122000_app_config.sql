-- Firestore appConfig 대체 — 설정 저장소 미러. Firestore는 계속 admin 쓰기 원본(source of truth)으로
-- 남고, onAppConfigWritten 트리거가 문서 변경분을 이 테이블로 미러링한다. 읽기는 이 테이블 우선.

CREATE TABLE IF NOT EXISTS public.app_config (
  config_key   text PRIMARY KEY,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

COMMENT ON TABLE public.app_config IS
  'Firestore appConfig 미러 — strava / sync / supabase_read_routing / supabase_groups_read_routing / ranking_aggregation_control 등';

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- strava 클라이언트 설정 등은 클라이언트에서 직접 읽으므로 anon+authenticated SELECT 허용.
-- (Strava Client Secret은 이 테이블에 저장하지 않음 — Secret Manager 그대로 사용)
CREATE POLICY app_config_select_anon ON public.app_config
  FOR SELECT TO anon
  USING (true);

CREATE POLICY app_config_select_authenticated ON public.app_config
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY app_config_service_write ON public.app_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
