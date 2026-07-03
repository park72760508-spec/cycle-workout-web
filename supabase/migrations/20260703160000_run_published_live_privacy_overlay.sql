-- RUN 랭킹 "비공개 즉시 반영" 보완.
--
-- 문제:
--   RUN 랭킹은 get_running_leaderboard_published() → run_leaderboard_daily_snapshots(published)
--   의 동결된 leaderboard JSONB 를 읽는다. 이 JSON 안의 user_info.is_private / display_name 은
--   스냅샷 생성 시점(일 1회, 23:00 KST) 값으로 고정되어, 사용자가 지금 공개↔비공개를 바꿔도
--   익일 재발행 전까지 랭킹보드에 반영되지 않는다.
--
-- 해결:
--   순위/점수(주간 거리·TSS·30일 거리 등)는 스냅샷 그대로 동결(안정성 유지)하되,
--   "표시 속성"인 is_private 와 실명(display_name)만 조회 시점에 public.users 의 현재값으로
--   실시간 오버레이한다. → 비공개 전환이 재로딩 즉시 반영된다.
--   (마스킹 자체는 CYCLE 과 동일하게 클라이언트가 is_private 로 처리하므로 실명을 함께 전달)
--
-- 순위 자체는 바뀌지 않으므로 등락(rank movement) 스냅샷과도 정합성이 유지된다.

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
  merged jsonb;
BEGIN
  SELECT s.as_of_seoul, s.leaderboard, s.updated_at
    INTO snap
  FROM public.run_leaderboard_daily_snapshots s
  WHERE s.snapshot_key = 'published';

  IF snap.leaderboard IS NOT NULL
     AND jsonb_typeof(snap.leaderboard) = 'array'
     AND jsonb_array_length(snap.leaderboard) > 0 THEN

    -- 순위/점수는 동결, is_private·실명만 public.users 현재값으로 실시간 오버레이
    SELECT jsonb_agg(
             CASE
               WHEN u.id IS NOT NULL THEN
                 jsonb_set(
                   jsonb_set(
                     elem,
                     '{user_info,is_private}',
                     to_jsonb(COALESCE(u.is_private, false)),
                     true
                   ),
                   '{user_info,display_name}',
                   to_jsonb(COALESCE(NULLIF(btrim(u.name), ''), elem->'user_info'->>'display_name')),
                   true
                 )
               ELSE elem
             END
             ORDER BY ord
           )
      INTO merged
    FROM jsonb_array_elements(snap.leaderboard) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN public.users u
      ON u.id = (
        CASE
          WHEN (elem->'user_info'->>'user_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (elem->'user_info'->>'user_id')::uuid
          ELSE NULL
        END
      );

    RETURN jsonb_build_object(
      'leaderboard', COALESCE(merged, snap.leaderboard),
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
  'RUN 랭킹 조회 — published 일일 스냅샷(순위 동결) + is_private/실명 실시간 오버레이(비공개 즉시 반영), 없으면 live fallback';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard_published() TO service_role;
