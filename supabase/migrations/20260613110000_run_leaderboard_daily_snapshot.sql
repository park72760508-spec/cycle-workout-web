-- RUN 랭킹 점수·순위 일 1회 고정 — 23:00 KST 집계 후 published 스냅샷만 노출

CREATE TABLE IF NOT EXISTS public.run_leaderboard_daily_snapshots (
  snapshot_key  text PRIMARY KEY DEFAULT 'published',
  as_of_seoul   date NOT NULL,
  leaderboard   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.run_leaderboard_daily_snapshots IS
  'RUN 랭킹 일일 고정본 — fn_rebuild_run_rank_board_snapshots() 가 KST 23:00 에 갱신';

CREATE INDEX IF NOT EXISTS idx_run_leaderboard_daily_snapshots_as_of
  ON public.run_leaderboard_daily_snapshots (as_of_seoul DESC);

ALTER TABLE public.run_leaderboard_daily_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_persist_run_leaderboard_daily_snapshot(p_leaderboard jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.run_leaderboard_daily_snapshots (
    snapshot_key,
    as_of_seoul,
    leaderboard,
    updated_at
  )
  VALUES (
    'published',
    public.fn_seoul_date_kst(),
    COALESCE(p_leaderboard, '[]'::jsonb),
    now()
  )
  ON CONFLICT (snapshot_key) DO UPDATE SET
    as_of_seoul = EXCLUDED.as_of_seoul,
    leaderboard = EXCLUDED.leaderboard,
    updated_at = EXCLUDED.updated_at;

  PERFORM public.fn_touch_ranking_build_meta('run_leaderboard_daily', 'complete', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_running_leaderboard_published()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snap record;
  live_lb jsonb;
BEGIN
  SELECT s.as_of_seoul, s.leaderboard, s.updated_at
    INTO snap
  FROM public.run_leaderboard_daily_snapshots s
  WHERE s.snapshot_key = 'published';

  IF snap.leaderboard IS NOT NULL
     AND jsonb_typeof(snap.leaderboard) = 'array'
     AND jsonb_array_length(snap.leaderboard) > 0 THEN
    RETURN jsonb_build_object(
      'leaderboard', snap.leaderboard,
      'as_of_seoul', snap.as_of_seoul,
      'source', 'snapshot',
      'aggregated_at', snap.updated_at
    );
  END IF;

  live_lb := public.get_running_leaderboard();
  RETURN jsonb_build_object(
    'leaderboard', COALESCE(live_lb, '[]'::jsonb),
    'as_of_seoul', public.fn_seoul_date_kst(),
    'source', 'live',
    'aggregated_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard_published() IS
  'RUN 랭킹 조회 — published 일일 스냅샷 우선, 없으면 live fallback';

CREATE OR REPLACE FUNCTION public.fn_rebuild_run_rank_board_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lb jsonb;
  g text;
  d text;
  genders text[] := ARRAY['all', 'M', 'F'];
  dists text[] := ARRAY['1k', '3k', '5k', '7k', '10k', '20k', '42k'];
BEGIN
  lb := public.get_running_leaderboard();

  PERFORM public.fn_persist_run_leaderboard_daily_snapshot(lb);

  FOREACH g IN ARRAY genders LOOP
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_overall_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'overall', NULL)
    );
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_tss_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'tss', NULL)
    );
    PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
      'run_distance_' || g,
      public.fn_run_leaderboard_score_rows(lb, g, 'distance', NULL)
    );

    FOREACH d IN ARRAY dists LOOP
      PERFORM public.fn_rebuild_run_rank_board_snapshot_from_rows(
        'run_pace_' || d || '_' || g,
        public.fn_run_leaderboard_score_rows(lb, g, 'pace', d)
      );
    END LOOP;
  END LOOP;

  PERFORM public.fn_rebuild_run_crew_rank_board_snapshots(lb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_persist_run_leaderboard_daily_snapshot(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard_published() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_run_rank_board_snapshots() TO service_role;
