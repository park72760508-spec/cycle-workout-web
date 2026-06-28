-- Firebase scheduledPeak28dRollupBackfillChunk → Supabase pg_cron 이관
-- peak_28d Firestore rollup 청크(80명/회) 대신 user_ranking_metrics 청크 갱신
-- (CYCLE 90일 top2 피크 + 주간 TSS + 30일 거리 + 28일 항속 — fn_refresh_user_ranking_metrics)
-- 스케줄: KST 매시 :12, :42 (30분 간격). UTC 분 필드도 12,42 (KST=UTC+9, 분 불변).

CREATE TABLE IF NOT EXISTS public.ranking_metrics_backfill_state (
  singleton_key          text PRIMARY KEY DEFAULT 'default' CHECK (singleton_key = 'default'),
  window_start           date NOT NULL,
  window_end             date NOT NULL,
  next_index             integer NOT NULL DEFAULT 0,
  total_users            integer NOT NULL DEFAULT 0,
  last_chunk_processed   integer NOT NULL DEFAULT 0,
  last_run_at            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ranking_metrics_backfill_state IS
  'Firebase ranking_meta/peak_28d_backfill 청크 커서 — 90일 창 user_ranking_metrics 백필';

CREATE OR REPLACE FUNCTION public.fn_run_ranking_metrics_backfill_chunk(
  p_chunk_size integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r90 record;
  v_state public.ranking_metrics_backfill_state%ROWTYPE;
  v_chunk integer := GREATEST(COALESCE(p_chunk_size, 80), 1);
  v_processed integer := 0;
  v_rec record;
  v_done boolean := false;
BEGIN
  SELECT * INTO v_r90 FROM public.fn_seoul_rolling_range(90);

  SELECT * INTO v_state
  FROM public.ranking_metrics_backfill_state
  WHERE singleton_key = 'default';

  IF NOT FOUND
     OR v_state.window_end IS DISTINCT FROM v_r90.end_date
     OR v_state.window_start IS DISTINCT FROM v_r90.start_date THEN
    INSERT INTO public.ranking_metrics_backfill_state (
      singleton_key, window_start, window_end, next_index, total_users,
      last_chunk_processed, last_run_at, updated_at
    )
    VALUES (
      'default',
      v_r90.start_date,
      v_r90.end_date,
      0,
      (SELECT COUNT(*)::integer FROM public.users),
      0,
      now(),
      now()
    )
    ON CONFLICT (singleton_key) DO UPDATE SET
      window_start = EXCLUDED.window_start,
      window_end = EXCLUDED.window_end,
      next_index = 0,
      total_users = EXCLUDED.total_users,
      last_chunk_processed = 0,
      last_run_at = now(),
      updated_at = now()
    RETURNING * INTO v_state;
  END IF;

  IF v_state.next_index >= v_state.total_users THEN
    v_done := true;
    PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_backfill_chunk', 'complete', NULL);
    RETURN jsonb_build_object(
      'status', 'done',
      'window_start', v_r90.start_date,
      'window_end', v_r90.end_date,
      'next_index', v_state.next_index,
      'total_users', v_state.total_users,
      'processed', 0
    );
  END IF;

  PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_backfill_chunk', 'running', v_state.next_index);

  FOR v_rec IN
    SELECT u.id
    FROM public.users u
    ORDER BY u.id
    LIMIT v_chunk
    OFFSET v_state.next_index
  LOOP
    PERFORM public.fn_refresh_user_ranking_metrics(v_rec.id);
    v_processed := v_processed + 1;
  END LOOP;

  v_state.next_index := v_state.next_index + v_processed;
  v_done := v_state.next_index >= v_state.total_users;

  UPDATE public.ranking_metrics_backfill_state
  SET
    next_index = v_state.next_index,
    last_chunk_processed = v_processed,
    last_run_at = now(),
    updated_at = now()
  WHERE singleton_key = 'default';

  IF v_done THEN
    PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_backfill_chunk', 'complete', NULL);
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_done THEN 'done' ELSE 'running' END,
    'window_start', v_r90.start_date,
    'window_end', v_r90.end_date,
    'next_index', v_state.next_index,
    'total_users', v_state.total_users,
    'processed', v_processed
  );
END;
$$;

COMMENT ON FUNCTION public.fn_run_ranking_metrics_backfill_chunk(integer) IS
  'Firebase scheduledPeak28dRollupBackfillChunk 대체 — users 청크별 fn_refresh_user_ranking_metrics (기본 80명/회).';

GRANT EXECUTE ON FUNCTION public.fn_run_ranking_metrics_backfill_chunk(integer) TO service_role;

INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
VALUES ('ranking_metrics_backfill_chunk', public.fn_seoul_date_kst(), 'pending', NULL, now() - interval '1 day', now())
ON CONFLICT (meta_key) DO NOTHING;

DO $cron_backfill$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'stelvio_ranking_metrics_backfill_chunk';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'stelvio_ranking_metrics_backfill_chunk',
    '12,42 * * * *',
    $cmd$SELECT public.fn_run_ranking_metrics_backfill_chunk(80);$cmd$
  );
END;
$cron_backfill$;

COMMENT ON EXTENSION pg_cron IS
  'stelvio_ranking_metrics_backfill_chunk: 12,42 * * * * (KST·UTC 동일 분) → fn_run_ranking_metrics_backfill_chunk(80)';
