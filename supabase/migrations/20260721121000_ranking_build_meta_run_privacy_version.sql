-- Firestore ranking_meta/run_privacy_version 대체 — 러닝 랭킹 비공개 캐시 버전 카운터를
-- 기존 ranking_build_meta 테이블에 한 행(meta_key='run_privacy_version')으로 추가.
-- 읽기는 기존 ranking_build_meta_select_anon 정책(테이블 전체 anon SELECT)으로 이미 커버된다.

INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
VALUES ('run_privacy_version', public.fn_seoul_date_kst(), 'complete', 0, now(), now())
ON CONFLICT (meta_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_bump_run_privacy_version()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_version integer;
BEGIN
  INSERT INTO public.ranking_build_meta (meta_key, date_kst, status, version, completed_at, updated_at)
  VALUES ('run_privacy_version', public.fn_seoul_date_kst(), 'complete', 1, now(), now())
  ON CONFLICT (meta_key) DO UPDATE SET
    version = COALESCE(public.ranking_build_meta.version, 0) + 1,
    date_kst = EXCLUDED.date_kst,
    completed_at = now(),
    updated_at = now()
  RETURNING version INTO new_version;
  RETURN new_version;
END;
$$;
