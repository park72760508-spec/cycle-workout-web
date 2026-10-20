-- 주간 TSS 랭킹보드·주간 마일리지 TOP10 순위 등락(↑↓) 누락 수정 (2026-10-20).
--
-- 원인:
--  1) 등락 기준(전일 순위) baseline 이 "전날 최종 순위"가 아니라 "전날 09:00(KST) 순위"였다.
--     cron 09:00 fn_weekly_tss_daytime_refresh → fn_rebuild_peak_rank_board_snapshot_from_rows 가
--     하루 한 번 저장한 ranks_by_category 를 다음 날 prev_day 로 얼려 쓰기 때문.
--     → 화요일 baseline = 월요일 09:00 보드(9명)라, 오늘 보드 182명 중 대부분이 baseline 에 없어 등락 미표시.
--  2) 공용 스냅샷 RPC(fn_weekly_tss_board_snapshot)는 "같은 날 처음 저장된 스냅샷"의 baseline 을 하루 종일 재사용 →
--     부실한 baseline 이 한 번 들어가면 그날 내내 모든 사용자에게 같은 결과.
--
-- 수정:
--  - fn_weekly_tss_prev_day_baseline(gender): 어제까지의 주간 TSS 최종 순위(월요일이면 지난주 최종)를
--    보드와 같은 규칙(활성 계정·치팅 데이 제외·성별·동점 순서)으로 직접 계산.
--  - fn_weekly_tss_board_build: 저장본 baseline 대신 위 함수로 매번 정확한 baseline 사용.
--  - fn_weekly_tss_board_snapshot: 같은 날 저장본이 없어도 직접 계산(Cloud Run 대기 없이).
--  - 09:00 cron 후 peak_tss_weekly_* 이력의 prev_day(Supremo)도 정확한 값으로 교정(Cloud Run 경로 일치).

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_prev_day_baseline(p_gender text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender text := CASE upper(coalesce(p_gender, 'all')) WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'all' END;
  v_yday date := (now() AT TIME ZONE 'Asia/Seoul')::date - 1;
  v_start date := v_yday - (extract(isodow FROM v_yday)::int - 1);
  v_out jsonb;
BEGIN
  WITH src AS (
    SELECT l.*
    FROM public.fn_weekly_tss_leaderboard_live(v_start, v_yday) WITH ORDINALITY AS l(
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

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_board_build(p_gender text, p_base jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender text := CASE upper(coalesce(p_gender, 'all')) WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'all' END;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_start date := v_today - (extract(isodow FROM v_today)::int - 1);
  -- 2026-10-20: 저장본(p_base) baseline 대신 "어제 최종 순위"를 매번 직접 계산
  v_baseline jsonb := public.fn_weekly_tss_prev_day_baseline(v_gender);
  v_base_meta jsonb;
  v_entries jsonb;
  v_bycat jsonb;
  v_payload jsonb;
BEGIN
  v_base_meta := CASE WHEN v_baseline <> '{}'::jsonb THEN jsonb_build_object('Supremo', v_baseline) ELSE '{}'::jsonb END;

  WITH src AS (
    SELECT l.*
    FROM public.fn_weekly_tss_leaderboard_live(v_start, v_today) WITH ORDINALITY AS l(
      user_id, firebase_uid, display_name, profile_image_url, gender, league_category, is_private,
      week_start, week_end, weekly_tss, weekly_has_cheat_day, metrics_updated_at, ord)
  ),
  prof AS (
    SELECT
      s.*,
      coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.display_name), ''), nullif(btrim(s.display_name), '')) AS actual_name,
      coalesce(nullif(u.profile_image_url, ''), nullif(s.profile_image_url, '')) AS img,
      lower(coalesce(nullif(u.gender::text, ''), s.gender, '')) AS g,
      (coalesce(u.is_private, false) OR coalesce(s.is_private, false)) AS priv
    FROM src s
    JOIN public.users u ON u.id = s.user_id AND u.account_status = 'active'
  ),
  filt AS (
    SELECT p.*,
      round(p.weekly_tss::numeric, 2) AS tss2
    FROM prof p
    WHERE round(p.weekly_tss::numeric, 2) > 0
      AND (
        v_gender = 'all'
        OR (v_gender = 'M' AND p.g IN ('m', 'male', '남', '남성'))
        OR (v_gender = 'F' AND p.g IN ('f', 'female', '여', '여성'))
      )
  ),
  ranked AS (
    SELECT f.*,
      row_number() OVER (ORDER BY f.tss2 DESC, f.ord) AS grank,
      coalesce(nullif(f.league_category, ''), 'unknown') AS cat,
      CASE
        WHEN f.actual_name IS NOT NULL THEN f.actual_name
        WHEN nullif(btrim(f.display_name), '') IS NOT NULL AND btrim(f.display_name) <> '비공개' THEN btrim(f.display_name)
        ELSE '(이름 없음)'
      END AS nm
    FROM filt f
  ),
  mv AS (
    SELECT r.*,
      CASE WHEN jsonb_typeof(v_baseline -> btrim(r.firebase_uid)) = 'number'
             AND floor((v_baseline ->> btrim(r.firebase_uid))::numeric) >= 1
           THEN floor((v_baseline ->> btrim(r.firebase_uid))::numeric)::int END AS prev_rank
    FROM ranked r
  ),
  rows_json AS (
    SELECT m.grank, m.cat,
      jsonb_strip_nulls(jsonb_build_object(
        'userId', btrim(m.firebase_uid),
        'name', m.nm,
        'ageCategory', m.cat,
        'gender', m.g,
        'is_private', m.priv,
        'totalTss', m.tss2::float8,
        'weekStart', m.week_start::text,
        'weekEnd', m.week_end::text,
        'metricsUpdatedAt', m.metrics_updated_at,
        'rankChange', CASE WHEN m.prev_rank IS NOT NULL THEN m.prev_rank - m.grank END,
        'previousBoardRank', m.prev_rank
      ))
      || jsonb_build_object('profileImageUrl', m.img, 'metricsUpdatedAt', m.metrics_updated_at) AS j
    FROM mv m
  )
  SELECT
    coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', grank) ORDER BY grank) FROM rows_json), '[]'::jsonb),
    jsonb_build_object(
      'Supremo', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', grank, '_origRank', grank) ORDER BY grank) FROM rows_json), '[]'::jsonb),
      'Assoluto', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', rn, '_origRank', grank) ORDER BY grank)
                             FROM (SELECT j, grank, row_number() OVER (ORDER BY grank) rn FROM rows_json WHERE cat = 'Assoluto') x), '[]'::jsonb),
      'Bianco', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', rn, '_origRank', grank) ORDER BY grank)
                           FROM (SELECT j, grank, row_number() OVER (ORDER BY grank) rn FROM rows_json WHERE cat = 'Bianco') x), '[]'::jsonb),
      'Rosa', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', rn, '_origRank', grank) ORDER BY grank)
                         FROM (SELECT j, grank, row_number() OVER (ORDER BY grank) rn FROM rows_json WHERE cat = 'Rosa') x), '[]'::jsonb),
      'Infinito', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', rn, '_origRank', grank) ORDER BY grank)
                             FROM (SELECT j, grank, row_number() OVER (ORDER BY grank) rn FROM rows_json WHERE cat = 'Infinito') x), '[]'::jsonb),
      'Leggenda', coalesce((SELECT jsonb_agg(j || jsonb_build_object('rank', rn, '_origRank', grank) ORDER BY grank)
                             FROM (SELECT j, grank, row_number() OVER (ORDER BY grank) rn FROM rows_json WHERE cat = 'Leggenda') x), '[]'::jsonb)
    )
  INTO v_entries, v_bycat;

  v_payload := jsonb_build_object(
    'success', true,
    'byCategory', v_bycat,
    'entries', v_entries,
    'startStr', v_start::text,
    'endStr', v_today::text,
    'period', 'weekly',
    'durationType', 'tss',
    'gender', v_gender,
    'precomputed', true,
    'liveComputed', false,
    'readSource', 'supabase',
    'readBackend', 'supabase',
    'supabaseWeeklyTssSource', 'daily_summaries_live_rpc',
    'rankMovementSource', 'supabase',
    'rankMovementHistoryKey', 'peak_tss_weekly_' || v_gender,
    'rankMovementHydrated', v_baseline <> '{}'::jsonb,
    'rankMovementAsOfSeoul', v_today::text,
    'rankMovementBaseline', 'prev_day_final',
    'rankMovementPrevDayByCategory', v_base_meta,
    'rankMovementCompareBaselineByCategory', v_base_meta
  );
  IF v_gender <> 'all' THEN
    v_payload := v_payload || jsonb_build_object('filterGenderPrecomputed', true);
  END IF;
  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_board_snapshot(p_gender text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender text := CASE upper(coalesce(p_gender, 'all')) WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'all' END;
  v_key text := 'weekly|tss|' || v_gender;
  v_epoch text := public.fn_ranking_live_epoch_kst();
  v_row record;
  v_payload jsonb;
BEGIN
  SELECT epoch, payload INTO v_row FROM ranking_board_snapshots WHERE snapshot_key = v_key;
  IF FOUND AND v_row.epoch = v_epoch AND (v_row.payload ->> 'success') = 'true'
     AND (v_row.payload ->> 'rankMovementBaseline') = 'prev_day_final' THEN
    RETURN v_row.payload;
  END IF;

  -- 이번 주 기록이 아직 없으면(월요일 새벽) Cloud Run 의 전주 대체 표시 경로에 맡긴다
  v_payload := public.fn_weekly_tss_board_build(v_gender, NULL);
  IF jsonb_array_length(v_payload -> 'entries') = 0 THEN RETURN NULL; END IF;
  v_payload := v_payload || jsonb_build_object('snapshotEpoch', v_epoch);

  INSERT INTO ranking_board_snapshots (snapshot_key, epoch, payload, updated_at)
  VALUES (v_key, v_epoch, v_payload, now())
  ON CONFLICT (snapshot_key) DO UPDATE
    SET epoch = EXCLUDED.epoch, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  RETURN v_payload;
END;
$$;

/** 09:00 cron 이 얼린 prev_day(=전날 09:00 순위)를 전날 최종 순위로 교정 — Cloud Run 경로도 같은 baseline */
CREATE OR REPLACE FUNCTION public.fn_fix_weekly_tss_history_prev_day()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g text;
  v_base jsonb;
BEGIN
  FOREACH g IN ARRAY ARRAY['all', 'M', 'F'] LOOP
    v_base := public.fn_weekly_tss_prev_day_baseline(g);
    IF v_base = '{}'::jsonb THEN CONTINUE; END IF;
    UPDATE public.peak_rank_board_snapshots
       SET prev_day_ranks_by_category = coalesce(prev_day_ranks_by_category, '{}'::jsonb) || jsonb_build_object('Supremo', v_base)
     WHERE history_key = 'peak_tss_weekly_' || g;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_weekly_tss_daytime_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;
  PERFORM public.fn_rebuild_peak_rank_board_snapshots();
  PERFORM public.fn_fix_weekly_tss_history_prev_day();
  PERFORM public.fn_touch_ranking_build_meta('peak_rank_board_snapshots', 'complete', NULL);
  PERFORM public.fn_touch_ranking_build_meta('ranking_metrics_live', 'complete', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_weekly_tss_prev_day_baseline(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_fix_weekly_tss_history_prev_day() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_weekly_tss_board_build(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_weekly_tss_board_snapshot(text) TO anon, authenticated;

-- 오늘 이력 교정 + 잘못된 baseline 이 든 공용 스냅샷 무효화(다음 조회 때 재계산)
SELECT public.fn_fix_weekly_tss_history_prev_day();
UPDATE public.ranking_board_snapshots SET epoch = 'invalidated-20261020'
 WHERE snapshot_key IN ('weekly|tss|all', 'weekly|tss|M', 'weekly|tss|F', 'weekly_top10|current');
