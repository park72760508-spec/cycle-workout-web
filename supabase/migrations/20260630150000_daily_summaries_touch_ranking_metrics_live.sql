-- daily_summaries 갱신 시 ranking_metrics_live 터치 — user_ranking_metrics 트리거 누락·지연 대비
-- 주간 TSS live RPC(fn_weekly_tss_leaderboard_live)는 daily_summaries 원천이므로 시그널만 맞추면 클라이언트가 즉시 재조회

CREATE OR REPLACE FUNCTION public.fn_touch_ranking_metrics_live_from_daily_summary()
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

COMMENT ON FUNCTION public.fn_touch_ranking_metrics_live_from_daily_summary IS
  'daily_summaries INSERT/UPDATE 시 ranking_metrics_live — TOP10·TSS 탭 Realtime 갱신';

DROP TRIGGER IF EXISTS trg_daily_summaries_touch_live_meta ON public.daily_summaries;
CREATE TRIGGER trg_daily_summaries_touch_live_meta
  AFTER INSERT OR UPDATE OF
    tss_strava_sum,
    tss_stelvio_sum,
    km_strava_sum,
    km_stelvio_sum,
    reconciled_at
  ON public.daily_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_ranking_metrics_live_from_daily_summary();
