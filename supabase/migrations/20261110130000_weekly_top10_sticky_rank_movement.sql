-- CYCLE 주간 마일리지 TOP10 등락 유지 (2026-11-10)
--
-- 문제: 다음 날로 넘어갔는데 새 순위 변화가 없으면, 비교 대상(어제 최종 순위)이 오늘 순위와 같아져 등락이 전부 보합(-)으로 지워짐.
-- 요구: 날짜가 바뀌어도 마지막 등락을 유지하고, 새 순위 변화가 생기면 그때 갱신. TSS 랭킹보드(weekly|tss|*)·다른 순위는 변경 없음.
-- 방식: 어제 최종 순위가 오늘 순위와 다르면 그것(기존과 동일). 같으면 하루씩 거슬러 올라가 오늘과 달라지는 가장 최근 날의 최종 순위를 비교 대상으로.
--       fn_weekly_top10_snapshot 만 새 비교 대상을 사용(payload.rankMovementBaseline = 'sticky_last_change').
-- 검증: 최근 20일 실제 데이터에서 순위가 바뀐 19일은 기존 baseline 과 동일, 변화 없는 날만 거슬러 올라간 순위표 사용.

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_rank_map(p_gender text, p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender text := CASE upper(coalesce(p_gender, 'all')) WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'all' END;
  v_out jsonb;
BEGIN
  WITH src AS (
    SELECT l.*
    FROM public.fn_weekly_tss_leaderboard_live(p_start, p_end) WITH ORDINALITY AS l(
      user_id, firebase_uid, display_name, profile_image_url, gender, league_category, is_private,
      week_start, week_end, weekly_tss, weekly_has_cheat_day, metrics_updated_at, ord)
  ),
  filt AS (
    SELECT s.firebase_uid, s.ord, round(s.weekly_tss::numeric, 2) AS tss2,
      lower(coalesce(nullif(u.gender::text, ''), s.gender, '')) AS g
    FROM src s
    JOIN public.users u ON u.id = s.user_id AND u.account_status = 'active'
    WHERE round(s.weekly_tss::numeric, 2) > 0
  ),
  ranked AS (
    SELECT btrim(f.firebase_uid) AS uid, row_number() OVER (ORDER BY f.tss2 DESC, f.ord) AS rk
    FROM filt f
    WHERE v_gender = 'all'
       OR (v_gender = 'M' AND f.g IN ('m', 'male', '남', '남성'))
       OR (v_gender = 'F' AND f.g IN ('f', 'female', '여', '여성'))
  )
  SELECT coalesce(jsonb_object_agg(uid, rk), '{}'::jsonb) INTO v_out FROM ranked;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_sticky_baseline(p_gender text DEFAULT 'all', p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender text := CASE upper(coalesce(p_gender, 'all')) WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'all' END;
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_today_map jsonb;
  v_d date;
  v_map jsonb;
  i int;
BEGIN
  v_today_map := public.fn_weekly_tss_rank_map(v_gender, v_today - (extract(isodow FROM v_today)::int - 1), v_today);
  v_d := v_today - 1;
  FOR i IN 1..10 LOOP
    v_map := public.fn_weekly_tss_rank_map(v_gender, v_d - (extract(isodow FROM v_d)::int - 1), v_d);
    IF v_map <> '{}'::jsonb AND v_map <> v_today_map THEN
      RETURN v_map;
    END IF;
    v_d := v_d - 1;
  END LOOP;
  RETURN public.fn_weekly_tss_rank_map(v_gender, (v_today - 1) - (extract(isodow FROM (v_today - 1))::int - 1), v_today - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_weekly_tss_rank_map(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_weekly_tss_sticky_baseline(text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_weekly_top10_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := 'weekly_top10|current';
  v_epoch text := public.fn_ranking_live_epoch_kst();
  v_row record;
  v_board jsonb;
  v_payload jsonb;
  v_sticky jsonb;
BEGIN
  SELECT epoch, payload INTO v_row FROM ranking_board_snapshots WHERE snapshot_key = v_key;
  IF FOUND AND v_row.epoch = v_epoch AND (v_row.payload ->> 'success') = 'true'
     AND (v_row.payload ->> 'rankMovementBaseline') = 'sticky_last_change' THEN RETURN v_row.payload; END IF;

  v_board := public.fn_weekly_tss_board_snapshot('all');
  IF v_board IS NULL OR jsonb_array_length(v_board -> 'entries') = 0 THEN RETURN NULL; END IF;
  IF (v_board ->> 'snapshotEpoch') IS DISTINCT FROM v_epoch THEN RETURN NULL; END IF;

  v_sticky := public.fn_weekly_tss_sticky_baseline('all');

  v_payload := jsonb_build_object(
    'success', true,
    'ranking', (
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'rank', (e ->> 'rank')::int,
          'userId', e -> 'userId',
          'name', e -> 'name',
          'totalTss', e -> 'totalTss',
          'rankChange', CASE WHEN p.pv IS NOT NULL THEN to_jsonb(p.pv - (e ->> 'rank')::int) END,
          'previousBoardRank', CASE WHEN p.pv IS NOT NULL THEN to_jsonb(p.pv) END,
          'is_private', coalesce((e ->> 'is_private')::boolean, false)
        )) || jsonb_build_object('profileImageUrl', e -> 'profileImageUrl') ORDER BY (e ->> 'rank')::int), '[]'::jsonb)
      FROM jsonb_array_elements(v_board -> 'entries') e
      CROSS JOIN LATERAL (SELECT CASE
          WHEN v_sticky <> '{}'::jsonb THEN
            CASE WHEN jsonb_typeof(v_sticky -> btrim(e ->> 'userId')) = 'number'
                  AND floor((v_sticky ->> btrim(e ->> 'userId'))::numeric) >= 1
                 THEN floor((v_sticky ->> btrim(e ->> 'userId'))::numeric)::int END
          ELSE nullif(e ->> 'previousBoardRank', '')::int END AS pv) p
      WHERE (e ->> 'rank')::int <= 10
    ),
    'startStr', v_board -> 'startStr',
    'endStr', v_board -> 'endStr',
    'precomputed', true,
    'liveComputed', false,
    'readSource', 'supabase',
    'readBackend', 'supabase',
    'rankMovementSource', v_board -> 'rankMovementSource',
    'rankMovementHistoryKey', v_board -> 'rankMovementHistoryKey',
    'rankMovementPrevDayByCategory', CASE WHEN v_sticky <> '{}'::jsonb THEN jsonb_build_object('Supremo', v_sticky) ELSE v_board -> 'rankMovementPrevDayByCategory' END,
    'rankMovementCompareBaselineByCategory', CASE WHEN v_sticky <> '{}'::jsonb THEN jsonb_build_object('Supremo', v_sticky) ELSE v_board -> 'rankMovementCompareBaselineByCategory' END,
    'rankMovementBaseline', 'sticky_last_change',
    'rankMovementAsOfSeoul', v_board -> 'rankMovementAsOfSeoul',
    'rankMovementHydrated', (v_sticky <> '{}'::jsonb) OR coalesce((v_board ->> 'rankMovementHydrated')::boolean, false),
    'currentWeekEmpty', false,
    'prevWeekFallback', false,
    'supabaseWeeklyTssSource', v_board -> 'supabaseWeeklyTssSource',
    'allEntriesLite', (
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'userId', e -> 'userId',
          'name', e -> 'name',
          'totalTss', e -> 'totalTss',
          'rankChange', CASE WHEN p.pv IS NOT NULL THEN to_jsonb(p.pv - (e ->> 'rank')::int) END,
          'previousBoardRank', CASE WHEN p.pv IS NOT NULL THEN to_jsonb(p.pv) END,
          'is_private', coalesce((e ->> 'is_private')::boolean, false)
        )) || jsonb_build_object('profileImageUrl', e -> 'profileImageUrl') ORDER BY (e ->> 'rank')::int), '[]'::jsonb)
      FROM jsonb_array_elements(v_board -> 'entries') e
      CROSS JOIN LATERAL (SELECT CASE
          WHEN v_sticky <> '{}'::jsonb THEN
            CASE WHEN jsonb_typeof(v_sticky -> btrim(e ->> 'userId')) = 'number'
                  AND floor((v_sticky ->> btrim(e ->> 'userId'))::numeric) >= 1
                 THEN floor((v_sticky ->> btrim(e ->> 'userId'))::numeric)::int END
          ELSE nullif(e ->> 'previousBoardRank', '')::int END AS pv) p
    ),
    'snapshotEpoch', v_epoch
  );

  INSERT INTO ranking_board_snapshots (snapshot_key, epoch, payload, updated_at)
  VALUES (v_key, v_epoch, v_payload, now())
  ON CONFLICT (snapshot_key) DO UPDATE
    SET epoch = EXCLUDED.epoch, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_weekly_top10_snapshot() TO anon, authenticated;

UPDATE public.ranking_board_snapshots SET epoch = 'invalidated-20261110' WHERE snapshot_key = 'weekly_top10|current';
