-- 주간 TSS 랭킹보드(weekly|tss|<gender>)·주간 TOP10(weekly_top10|current) 공용 스냅샷을
-- Cloud Run(getPeakPowerRanking / getWeeklyRanking) 대신 Supabase 안에서 직접 생성 (2026-10-08).
--
-- 기존: 라이딩 저장 등으로 live epoch(ranking_build_meta)가 바뀔 때마다 첫 조회자가 Cloud Run 을 호출해
--       결과를 만들고 ranking_board_snapshots 에 저장(하루 약 280회).
-- 변경: 앱이 스냅샷 miss 시 아래 RPC 를 먼저 호출 — 같은 epoch 면 저장본 반환, 아니면 여기서 계산·저장.
--       순위 등락 baseline(전일 기준 순위)은 하루 동안 바뀌지 않으므로 **같은 날** Cloud Run 이 만든
--       스냅샷의 baseline 을 재사용한다. 오늘자 baseline 이 없으면(하루 첫 계산·월요일 첫 기록 전·전주 대체 표시)
--       NULL 을 반환하고 앱은 기존 Cloud Run 경로를 그대로 쓴다(그 응답이 오늘 baseline 을 채움).
--
-- 결과 JSON 은 functions/ 의 다음 로직과 동일하게 맞췄다:
--   supabaseRankingReader.fetchWeeklyTssRankingCore (fn_weekly_tss_leaderboard_live + 프로필 보강 + weeklyTssRowsToEntries)
--   rankingResponseAdapter.buildByCategoryFromEntries, rankingPeakMovement.computeAbsoluteBoardRankMovementForRows
--   rankingBoardSnapshots.maybeWriteRankingBoardSnapshot(_origRank) / maybeWriteWeeklyTop10Snapshot(allEntriesLite)
--   index.js filterWithdrawnUsersFromRankingPayload(부문별 순위 재부여)

CREATE OR REPLACE FUNCTION public.fn_ranking_live_epoch_kst()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- functions/supabaseRankingReader.js fetchLiveBoardEpochKst 와 같은 문자열
  SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text
    || '@' || coalesce((SELECT floor(extract(epoch FROM completed_at) * 1000)::bigint::text FROM ranking_build_meta WHERE meta_key = 'ranking_metrics_live'), '0')
    || '@' || coalesce((SELECT floor(extract(epoch FROM completed_at) * 1000)::bigint::text FROM ranking_build_meta WHERE meta_key = 'open_rides_live'), '0')
    || '@' || coalesce((SELECT floor(extract(epoch FROM completed_at) * 1000)::bigint::text FROM ranking_build_meta WHERE meta_key = 'master_daily_rebuild'), '0');
$$;

/**
 * 순수 계산(저장 없음) — p_base: 같은 날 같은 보드의 기존 스냅샷 payload(baseline·rankMovement 메타 출처).
 */
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
  v_cmp jsonb := p_base -> 'rankMovementCompareBaselineByCategory' -> 'Supremo';
  v_pd jsonb := p_base -> 'rankMovementPrevDayByCategory' -> 'Supremo';
  v_baseline jsonb;
  v_entries jsonb;
  v_bycat jsonb;
  v_payload jsonb;
BEGIN
  -- recomputePeakRankMovementAfterEligibleFilter: compare baseline 우선, 없으면 prevDay
  IF jsonb_typeof(v_cmp) = 'object' AND v_cmp <> '{}'::jsonb THEN
    v_baseline := v_cmp;
  ELSIF jsonb_typeof(v_pd) = 'object' AND v_pd <> '{}'::jsonb THEN
    v_baseline := v_pd;
  ELSE
    v_baseline := '{}'::jsonb;
  END IF;

  WITH src AS (
    SELECT l.*
    FROM public.fn_weekly_tss_leaderboard_live(v_start, v_today) WITH ORDINALITY AS l(
      user_id, firebase_uid, display_name, profile_image_url, gender, league_category, is_private,
      week_start, week_end, weekly_tss, weekly_has_cheat_day, metrics_updated_at, ord)
  ),
  prof AS (
    -- getPublicProfileMapForSupabaseUsers: 공개 프로필 + users 실명·사진·성별·비공개 덮어쓰기
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
      -- profileImageUrl·metricsUpdatedAt 은 null 이어도 키를 유지(Cloud Run 응답과 동일)
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
    'rankMovementSource', p_base -> 'rankMovementSource',
    'rankMovementHistoryKey', p_base -> 'rankMovementHistoryKey',
    'rankMovementHydrated', p_base -> 'rankMovementHydrated',
    'rankMovementAsOfSeoul', p_base -> 'rankMovementAsOfSeoul',
    'rankMovementPrevDayByCategory', coalesce(p_base -> 'rankMovementPrevDayByCategory', '{}'::jsonb),
    'rankMovementCompareBaselineByCategory', coalesce(p_base -> 'rankMovementCompareBaselineByCategory', '{}'::jsonb)
  );
  IF v_gender <> 'all' THEN
    v_payload := v_payload || jsonb_build_object('filterGenderPrecomputed', true);
  END IF;
  RETURN v_payload;
END;
$$;

/**
 * 주간 TSS 보드 스냅샷 — 같은 epoch 저장본이 있으면 그대로, 없으면 계산·저장 후 반환.
 * 오늘자 baseline 출처가 없으면 NULL(앱은 Cloud Run 사용).
 */
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
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_start date := v_today - (extract(isodow FROM v_today)::int - 1);
  v_epoch text := public.fn_ranking_live_epoch_kst();
  v_row record;
  v_payload jsonb;
BEGIN
  SELECT epoch, payload INTO v_row FROM ranking_board_snapshots WHERE snapshot_key = v_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.epoch = v_epoch AND (v_row.payload ->> 'success') = 'true' THEN RETURN v_row.payload; END IF;
  -- 같은 날·같은 주·정상 보드의 baseline 만 재사용 (전주 대체 표시본·다른 날짜면 Cloud Run 에 맡김)
  IF (v_row.payload ->> 'success') IS DISTINCT FROM 'true'
     OR (v_row.payload ->> 'rankMovementAsOfSeoul') IS DISTINCT FROM v_today::text
     OR (v_row.payload ->> 'startStr') IS DISTINCT FROM v_start::text
     OR coalesce((v_row.payload ->> 'prevWeekFallback')::boolean, false) THEN
    RETURN NULL;
  END IF;

  v_payload := public.fn_weekly_tss_board_build(v_gender, v_row.payload);
  IF jsonb_array_length(v_payload -> 'entries') = 0 THEN RETURN NULL; END IF;
  v_payload := v_payload || jsonb_build_object('snapshotEpoch', v_epoch);

  INSERT INTO ranking_board_snapshots (snapshot_key, epoch, payload, updated_at)
  VALUES (v_key, v_epoch, v_payload, now())
  ON CONFLICT (snapshot_key) DO UPDATE
    SET epoch = EXCLUDED.epoch, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  RETURN v_payload;
END;
$$;

/**
 * 주간 TOP10 스냅샷(weekly_top10|current) — 보드(all) 스냅샷에서 파생. 개인화(myRank)는 앱이 allEntriesLite 로 계산.
 */
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
BEGIN
  SELECT epoch, payload INTO v_row FROM ranking_board_snapshots WHERE snapshot_key = v_key;
  IF FOUND AND v_row.epoch = v_epoch AND (v_row.payload ->> 'success') = 'true' THEN RETURN v_row.payload; END IF;

  v_board := public.fn_weekly_tss_board_snapshot('all');
  IF v_board IS NULL OR jsonb_array_length(v_board -> 'entries') = 0 THEN RETURN NULL; END IF;
  -- 보드가 이번 호출 사이에 다른 epoch 로 바뀌었으면(동시 갱신) 다음 조회에 맡긴다
  IF (v_board ->> 'snapshotEpoch') IS DISTINCT FROM v_epoch THEN RETURN NULL; END IF;

  v_payload := jsonb_build_object(
    'success', true,
    'ranking', (
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'rank', (e ->> 'rank')::int,
          'userId', e -> 'userId',
          'name', e -> 'name',
          'totalTss', e -> 'totalTss',
          'rankChange', e -> 'rankChange',
          'previousBoardRank', e -> 'previousBoardRank',
          'is_private', coalesce((e ->> 'is_private')::boolean, false)
        )) || jsonb_build_object('profileImageUrl', e -> 'profileImageUrl') ORDER BY (e ->> 'rank')::int), '[]'::jsonb)
      FROM jsonb_array_elements(v_board -> 'entries') e
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
    'rankMovementPrevDayByCategory', v_board -> 'rankMovementPrevDayByCategory',
    'rankMovementCompareBaselineByCategory', v_board -> 'rankMovementCompareBaselineByCategory',
    'rankMovementAsOfSeoul', v_board -> 'rankMovementAsOfSeoul',
    'rankMovementHydrated', coalesce((v_board ->> 'rankMovementHydrated')::boolean, false),
    'currentWeekEmpty', false,
    'prevWeekFallback', false,
    'supabaseWeeklyTssSource', v_board -> 'supabaseWeeklyTssSource',
    'allEntriesLite', (
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'userId', e -> 'userId',
          'name', e -> 'name',
          'totalTss', e -> 'totalTss',
          'rankChange', e -> 'rankChange',
          'previousBoardRank', e -> 'previousBoardRank',
          'is_private', coalesce((e ->> 'is_private')::boolean, false)
        )) || jsonb_build_object('profileImageUrl', e -> 'profileImageUrl') ORDER BY (e ->> 'rank')::int), '[]'::jsonb)
      FROM jsonb_array_elements(v_board -> 'entries') e
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

REVOKE ALL ON FUNCTION public.fn_ranking_live_epoch_kst() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_weekly_tss_board_build(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_weekly_tss_board_snapshot(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_weekly_top10_snapshot() FROM PUBLIC;
-- 스냅샷 테이블 자체가 공개 읽기이므로 같은 데이터를 만드는 RPC 도 anon 허용
GRANT EXECUTE ON FUNCTION public.fn_ranking_live_epoch_kst() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_weekly_tss_board_snapshot(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_weekly_top10_snapshot() TO anon, authenticated;
