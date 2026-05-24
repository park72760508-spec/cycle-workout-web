-- pg_cron 집계 버전 — Firestore ranking_meta 대체 (클라이언트 IndexedDB 무효화용)
CREATE TABLE IF NOT EXISTS public.ranking_build_meta (
  meta_key       text PRIMARY KEY,
  date_kst       date NOT NULL,
  status         text NOT NULL DEFAULT 'complete',
  version        integer,
  completed_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ranking_build_meta IS
  '랭킹 집계 빌드 메타 — fn_refresh_ranking_materialized_views / fn_rebuild_heptagon_cohort_ranks 완료 시 갱신';

CREATE OR REPLACE FUNCTION public.fn_seoul_date_kst()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (timezone('Asia/Seoul', now()))::date;
$$;

CREATE OR REPLACE FUNCTION public.fn_touch_ranking_build_meta(
  p_meta_key text,
  p_status text DEFAULT 'complete',
  p_version integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
  VALUES (
    p_meta_key,
    public.fn_seoul_date_kst(),
    COALESCE(NULLIF(trim(p_status), ''), 'complete'),
    p_version,
    now(),
    now()
  )
  ON CONFLICT (meta_key) DO UPDATE SET
    date_kst = EXCLUDED.date_kst,
    status = EXCLUDED.status,
    version = COALESCE(EXCLUDED.version, public.ranking_build_meta.version),
    completed_at = EXCLUDED.completed_at,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_ranking_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_peak_28d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_distance_30d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_speed_28d;
  PERFORM public.fn_touch_ranking_build_meta('peak_28d_board_refresh', 'complete', NULL);
  PERFORM public.fn_touch_ranking_build_meta('master_daily_rebuild', 'complete', NULL);
END;
$$;

INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
VALUES
  ('personal_speed_logic', public.fn_seoul_date_kst(), 'complete', 12, now(), now()),
  ('peak_28d_board_refresh', public.fn_seoul_date_kst(), 'pending', NULL, now() - interval '1 day', now()),
  ('master_daily_rebuild', public.fn_seoul_date_kst(), 'pending', NULL, now() - interval '1 day', now()),
  ('heptagon_daily_rebuild', public.fn_seoul_date_kst(), 'pending', NULL, now() - interval '1 day', now())
ON CONFLICT (meta_key) DO NOTHING;

ALTER TABLE public.ranking_build_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY ranking_build_meta_select_authenticated ON public.ranking_build_meta
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY ranking_build_meta_service_write ON public.ranking_build_meta
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- heptagon 메타 터치: 20260525100100_ranking_build_meta_heptagon_touch.sql
