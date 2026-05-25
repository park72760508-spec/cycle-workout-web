-- 주간 TSS / 주간 TOP10 표시용 MV 단독 refresh.
-- HTTP Read 경로에서 과도한 전체 MV refresh 없이 주간 랭킹만 최신화할 때 사용한다.
CREATE OR REPLACE FUNCTION public.fn_refresh_weekly_tss_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;

  IF to_regprocedure('public.fn_touch_ranking_build_meta(text,text,integer)') IS NOT NULL THEN
    PERFORM public.fn_touch_ranking_build_meta('weekly_tss_board_refresh', 'complete', NULL);
    PERFORM public.fn_touch_ranking_build_meta('master_daily_rebuild', 'complete', NULL);
  END IF;
END;
$$;
