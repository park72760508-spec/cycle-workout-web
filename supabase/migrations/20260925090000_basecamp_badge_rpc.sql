-- 비용 절감 2단계(1): 배지 개수·관리 모임 가입신청 건수를 Cloud Run 대신 Supabase RPC 로 직접 조회.
--   getBasecampBadgeCountsForRead / getManagedGroupsPendingJoinRequestCountForRead 와 같은 결과를 반환한다.
--   - 호출자는 mintSupabaseSessionHttp 로 받은 세션의 auth.uid()(= users.id) 로만 식별(파라미터 신뢰 안 함)
--   - 친구 요청(friendRequests)은 Supabase 미러가 없어 클라이언트가 Firestore count 로 따로 조회
--   - *_for(p_user) 내부 함수는 검증용으로만 쓰고 authenticated/anon 에 실행 권한을 주지 않는다

CREATE OR REPLACE FUNCTION public.fn_managed_groups_pending_join_counts_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH owned AS (
    SELECT g.id, g.firestore_doc_id
    FROM riding_groups g
    WHERE g.created_by = p_user AND g.status = 'APPROVED' AND g.firestore_doc_id IS NOT NULL
  ),
  per_group AS (
    SELECT o.firestore_doc_id AS doc_id, count(*)::int AS n
    FROM owned o
    JOIN riding_group_join_requests r ON r.group_id = o.id
    GROUP BY o.firestore_doc_id
  )
  SELECT jsonb_build_object(
    'success', true,
    'total', COALESCE((SELECT sum(n) FROM per_group), 0)::int,
    'countMap', COALESCE((SELECT jsonb_object_agg(doc_id, n) FROM per_group), '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_basecamp_badge_counts_for(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_fb_uid text;
  v_phone text;
  v_inv jsonb;
  v_host jsonb;
  v_sett jsonb;
  v_groups int;
  v_strava record;
BEGIN
  SELECT u.firebase_uid,
         regexp_replace(COALESCE(NULLIF(u.contact, ''), u.phone, ''), '\D', '', 'g')
    INTO v_fb_uid, v_phone
  FROM users u WHERE u.id = p_user;
  -- 국가번호(82) 표기 → 0 (functions normalizePhoneDigitsForBadge 와 동일)
  IF left(v_phone, 2) = '82' AND length(v_phone) >= 10 THEN
    v_phone := '0' || substr(v_phone, 3);
  END IF;
  v_phone := left(COALESCE(v_phone, ''), 15);

  -- 초대(오늘 이후, 이미 확정 참가자면 제외) — 크루 모임(group) 초대는 크루 배지로 분리
  WITH inv AS (
    SELECT upper(COALESCE(btrim(r.category), '')) = 'RUN' AS is_run,
           NULLIF(btrim(COALESCE(r.group_firestore_doc_id, '')), '') AS gid
    FROM open_rides r
    WHERE length(v_phone) >= 8
      AND r.invited_list ? v_phone
      AND r.ride_date >= v_today
      AND NOT EXISTS (
        SELECT 1 FROM open_ride_participants p
        WHERE p.ride_id = r.id AND p.user_id = p_user AND NOT COALESCE(p.is_waitlist, false)
      )
  )
  SELECT jsonb_build_object(
    'ridesCycle', count(*) FILTER (WHERE NOT is_run AND gid IS NULL),
    'ridesRun', count(*) FILTER (WHERE is_run AND gid IS NULL),
    'crewInviteCycle', count(*) FILTER (WHERE NOT is_run AND gid IS NOT NULL),
    'crewInviteRun', count(*) FILTER (WHERE is_run AND gid IS NOT NULL),
    'crewInviteMapCycle', COALESCE((SELECT jsonb_object_agg(gid, n) FROM (SELECT gid, count(*) n FROM inv WHERE NOT is_run AND gid IS NOT NULL GROUP BY gid) a), '{}'::jsonb),
    'crewInviteMapRun', COALESCE((SELECT jsonb_object_agg(gid, n) FROM (SELECT gid, count(*) n FROM inv WHERE is_run AND gid IS NOT NULL GROUP BY gid) b), '{}'::jsonb)
  ) INTO v_inv FROM inv;

  -- 내가 주최한 모임(오늘 이후, 취소 제외) + 크루별
  WITH h AS (
    SELECT upper(COALESCE(btrim(r.category), '')) = 'RUN' AS is_run,
           NULLIF(btrim(COALESCE(r.group_firestore_doc_id, '')), '') AS gid
    FROM open_rides r
    WHERE r.host_user_id = p_user AND r.ride_date >= v_today AND r.status <> 'cancelled'
  )
  SELECT jsonb_build_object(
    'hostedCycle', count(*) FILTER (WHERE NOT is_run),
    'hostedRun', count(*) FILTER (WHERE is_run),
    'hostedInCrewMapCycle', COALESCE((SELECT jsonb_object_agg(gid, n) FROM (SELECT gid, count(*) n FROM h WHERE NOT is_run AND gid IS NOT NULL GROUP BY gid) a), '{}'::jsonb),
    'hostedInCrewMapRun', COALESCE((SELECT jsonb_object_agg(gid, n) FROM (SELECT gid, count(*) n FROM h WHERE is_run AND gid IS NOT NULL GROUP BY gid) b), '{}'::jsonb)
  ) INTO v_host FROM h;

  -- 미입금 정산: 내가 확정 참가자인 모임(날짜 제한 없음, 취소 제외) 중 내 분담액 > 0 이고 paidUids 에 없음
  --   정산 항목의 participantUids·paidUids 는 Firebase uid 로 저장돼 있다
  WITH mine AS (
    SELECT r.category, r.settlement
    FROM open_rides r
    JOIN open_ride_participants p ON p.ride_id = r.id AND p.user_id = p_user AND NOT COALESCE(p.is_waitlist, false)
    WHERE r.status <> 'cancelled'
      AND r.settlement IS NOT NULL AND jsonb_typeof(r.settlement) = 'object'
  ),
  owed AS (
    SELECT m.category,
           COALESCE((
             SELECT sum(ceil((it->>'amount')::numeric / jsonb_array_length(it->'participantUids') / 10) * 10)
             FROM jsonb_array_elements(COALESCE(m.settlement->'items', '[]'::jsonb)) it
             WHERE jsonb_typeof(it->'participantUids') = 'array'
               AND jsonb_array_length(it->'participantUids') > 0
               AND COALESCE((it->>'amount')::numeric, 0) > 0
               AND it->'participantUids' ? v_fb_uid
           ), 0) AS amt,
           COALESCE(m.settlement->'paidUids', '[]'::jsonb) ? v_fb_uid AS paid
    FROM mine m
  )
  SELECT jsonb_build_object(
    'settlementUnpaidCycle', count(*) FILTER (WHERE amt > 0 AND NOT paid AND upper(COALESCE(btrim(category), '')) <> 'RUN'),
    'settlementUnpaidRun', count(*) FILTER (WHERE amt > 0 AND NOT paid AND upper(COALESCE(btrim(category), '')) = 'RUN')
  ) INTO v_sett FROM owed;

  v_groups := COALESCE((public.fn_managed_groups_pending_join_counts_for(p_user) ->> 'total')::int, 0);

  -- 오늘 Strava 활동 여부(사이클/러닝) — fetchStravaActivityPresenceForDate 와 동일 분류
  SELECT bool_or(lower(COALESCE(activity_type, '')) NOT IN ('run', 'trailrun', 'swim', 'walk', 'weighttraining')) AS has_cycle,
         bool_or(lower(COALESCE(activity_type, '')) IN ('run', 'trailrun')) AS has_run
    INTO v_strava
  FROM rides
  WHERE user_id = p_user AND source = 'strava' AND ride_date = v_today;

  RETURN jsonb_build_object('success', true, 'groups', v_groups,
                            'stravaTodayCycle', COALESCE(v_strava.has_cycle, false),
                            'stravaTodayRun', COALESCE(v_strava.has_run, false),
                            'readSource', 'supabase_rpc')
         || v_inv || v_host || v_sett;
END;
$$;

-- 앱(세션 사용자) 호출용 — 본인 것만
CREATE OR REPLACE FUNCTION public.fn_my_managed_groups_pending_join_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL
              THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
              ELSE public.fn_managed_groups_pending_join_counts_for(auth.uid()) END;
$$;

CREATE OR REPLACE FUNCTION public.fn_my_basecamp_badge_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL
              THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
              ELSE public.fn_basecamp_badge_counts_for(auth.uid()) END;
$$;

REVOKE ALL ON FUNCTION public.fn_managed_groups_pending_join_counts_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_basecamp_badge_counts_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_my_managed_groups_pending_join_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_my_basecamp_badge_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_managed_groups_pending_join_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_basecamp_badge_counts() TO authenticated;
