-- ranking_build_meta: 집계 버전·타임스탬프만 노출 — Realtime·폴링용 anon SELECT 허용
-- Auth Bridge(setSession) 없이 주간 TSS live sync 가능 (Firebase 미사용)

CREATE POLICY ranking_build_meta_select_anon ON public.ranking_build_meta
  FOR SELECT TO anon
  USING (true);
