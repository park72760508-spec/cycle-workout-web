-- CYCLE 주간 TSS 랭킹보드 탭도 등락 유지 (2026-11-10)
--
-- 주간 마일리지 TOP10(20261110130000)과 같은 방식: 어제 최종 순위가 오늘 순위와 같으면(새 순위 변화 없음)
-- 마지막 순위 변화 때의 순위표를 비교 대상으로 사용(fn_weekly_tss_sticky_baseline). 순위 변화가 있으면 기존과 동일(어제 최종).
-- 바뀐 곳: 보드 생성(fn_weekly_tss_board_build)·공용 스냅샷 캐시 판정 표식(fn_weekly_tss_board_snapshot)·09:00 이력 교정(fn_fix_weekly_tss_history_prev_day).

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
  -- 2026-11-10: 어제 최종 순위가 오늘과 같으면(새 순위 변화 없음) 마지막 순위 변화 때의 순위표를 비교 대상으로(fn_weekly_tss_sticky_baseline)
  v_baseline jsonb := public.fn_weekly_tss_sticky_baseline(v_gender);
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
    'rankMovementBaseline', 'sticky_last_change',
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
     AND (v_row.payload ->> 'rankMovementBaseline') = 'sticky_last_change' THEN
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
    v_base := public.fn_weekly_tss_sticky_baseline(g);
    IF v_base = '{}'::jsonb THEN CONTINUE; END IF;
    UPDATE public.peak_rank_board_snapshots
       SET prev_day_ranks_by_category = coalesce(prev_day_ranks_by_category, '{}'::jsonb) || jsonb_build_object('Supremo', v_base)
     WHERE history_key = 'peak_tss_weekly_' || g;
  END LOOP;
END;
$$;


-- 이전 방식('prev_day_final')으로 저장된 공용 스냅샷 무효화(다음 조회 때 새 기준으로 재계산)
UPDATE public.ranking_board_snapshots SET epoch = 'invalidated-20261110b'
 WHERE snapshot_key IN ('weekly|tss|all', 'weekly|tss|M', 'weekly|tss|F', 'weekly_top10|current');
