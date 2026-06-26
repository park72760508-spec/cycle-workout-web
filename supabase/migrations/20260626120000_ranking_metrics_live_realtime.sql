-- CYCLE 주간 TSS TOP10·랭킹보드 실시간 반영
-- rides → daily_summaries → user_ranking_metrics 갱신 시 ranking_build_meta 터치 → 클라이언트 Realtime 구독
-- Firebase 트래픽 없음 (Supabase 전용 시그널)

INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
VALUES ('ranking_metrics_live', public.fn_seoul_date_kst(), 'complete', 1, now(), now())
ON CONFLICT (meta_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_touch_ranking_metrics_live_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_live', 'complete', NULL);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_touch_ranking_metrics_live_meta IS
  'user_ranking_metrics 갱신 시 ranking_metrics_live 메타 터치 — 클라이언트 Realtime·캐시 무효화용';

DROP TRIGGER IF EXISTS trg_urm_touch_live_meta ON public.user_ranking_metrics;
CREATE TRIGGER trg_urm_touch_live_meta
  AFTER INSERT OR UPDATE OF weekly_tss, week_start, week_end, weekly_has_cheat_day, metrics_updated_at
  ON public.user_ranking_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_ranking_metrics_live_meta();

ALTER TABLE public.ranking_build_meta REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ranking_build_meta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ranking_build_meta;
  END IF;
END $$;
