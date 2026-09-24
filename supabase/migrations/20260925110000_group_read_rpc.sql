-- 비용 절감 2단계(2): 클럽(소모임) 조회 5종을 Cloud Run 대신 Supabase RPC 로 직접 조회.
--   응답은 functions/groupReadRouter.js · supabaseGroupReader.js · groupResponseAdapter.js 결과와 동일 shape.
--   - getRidingGroupForRead            → fn_riding_group_detail(p_group_id, p_include_join_requests)
--   - getMyRidingGroupsForRead         → fn_my_riding_groups()
--   - getMyGroupMembershipsForRead     → fn_my_group_memberships(p_group_ids)
--   - getMyGroupContactSetForRead      → fn_my_group_contact_set(p_group_ids)
--   - getMyGroupJoinRequestStatusForRead → fn_my_group_join_request_status(p_group_id)
--   "my_*" 는 auth.uid()(세션 사용자) 기준. 모두 authenticated 에만 실행 권한.

/** groupResponseAdapter.tsFromIso — Firestore Timestamp 형태 {seconds, nanoseconds}(ms 정밀도) */
CREATE OR REPLACE FUNCTION public.fn_fs_ts(p_ts timestamptz)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_ts IS NULL THEN NULL ELSE jsonb_build_object(
    'seconds', floor(extract(epoch FROM p_ts))::bigint,
    'nanoseconds', (floor(extract(epoch FROM p_ts) * 1000)::bigint % 1000) * 1000000
  ) END;
$$;

/** groupResponseAdapter.str — trim 후 빈 문자열이면 NULL */
CREATE OR REPLACE FUNCTION public.fn_fs_str(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p), '');
$$;

/** adaptRidingGroupToFirestoreDoc (멤버·가입신청 제외 본문) */
CREATE OR REPLACE FUNCTION public.fn_riding_group_doc(g public.riding_groups)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- rankingNotice 는 notice.text 가 있을 때만 키를 둔다(JS 에서 undefined → 직렬화 시 생략)
  SELECT CASE WHEN jsonb_typeof(g.ranking_notice) = 'object' AND g.ranking_notice ? 'text' AND g.ranking_notice->'text' <> 'null'::jsonb
           THEN jsonb_build_object('rankingNotice', jsonb_build_object(
             'text', COALESCE(g.ranking_notice->>'text', ''),
             'updatedAt', public.fn_fs_ts(NULLIF(g.ranking_notice->>'updatedAt', '')::timestamptz),
             'updatedBy', COALESCE(g.ranking_notice->>'updatedBy', g.ranking_notice->>'updated_by')))
           ELSE '{}'::jsonb END
    || jsonb_build_object(
      'id', g.firestore_doc_id,
      'name', COALESCE(public.fn_fs_str(g.name), ''),
      'regions', COALESCE((SELECT jsonb_agg(btrim(x)) FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(to_jsonb(g.regions)) = 'array' THEN to_jsonb(g.regions) ELSE '[]'::jsonb END) x
                   WHERE btrim(x) <> ''), '[]'::jsonb),
      'intro', COALESCE(public.fn_fs_str(g.intro), ''),
      'isPublic', COALESCE(g.is_public, false),
      'isPaid', COALESCE(g.is_paid, false),
      'liveTrainingRoomCode', COALESCE(public.fn_fs_str(g.live_training_room_code), ''),
      'liveTrainingRoomName', COALESCE(public.fn_fs_str(g.live_training_room_name), ''),
      'joinPassword', COALESCE(public.fn_fs_str(g.join_password), ''),
      'photoUrl', public.fn_fs_str(g.photo_url),
      'category', CASE WHEN upper(COALESCE(public.fn_fs_str(g.category), '')) = 'RUN' THEN 'RUN' ELSE 'CYCLE' END,
      'status', COALESCE(public.fn_fs_str(g.status::text), 'PENDING'),
      'createdBy', COALESCE((SELECT u.firebase_uid FROM users u WHERE u.id = g.created_by), g.created_by::text, ''),
      'memberCount', COALESCE(g.member_count, 0),
      'reviewedAt', public.fn_fs_ts(g.reviewed_at),
      'reviewedBy', COALESCE((SELECT u.firebase_uid FROM users u WHERE u.id = g.reviewed_by), g.reviewed_by::text),
      'createdAt', public.fn_fs_ts(g.created_at),
      'updatedAt', public.fn_fs_ts(g.updated_at),
      'readBackend', 'supabase'
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_riding_group_detail(p_group_id text, p_include_join_requests boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g riding_groups;
  v_members jsonb;
  v_reqs jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT * INTO g FROM riding_groups WHERE firestore_doc_id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', COALESCE(u.firebase_uid, m.user_id::text),
           'joinedAt', public.fn_fs_ts(m.joined_at),
           'displayName', COALESCE(public.fn_fs_str(m.display_name), ''),
           'profileImageUrl', public.fn_fs_str(m.profile_image_url),
           'role', COALESCE(public.fn_fs_str(m.role::text), 'member'),
           'membershipExpiresAt', m.membership_expires_at
         )), '[]'::jsonb)
    INTO v_members
  FROM riding_group_members m LEFT JOIN users u ON u.id = m.user_id
  WHERE m.group_id = g.id;

  IF p_include_join_requests THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', COALESCE(u.firebase_uid, r.user_id::text),
             'requestedAt', public.fn_fs_ts(r.requested_at),
             'displayName', COALESCE(public.fn_fs_str(r.display_name), ''),
             'profileImageUrl', public.fn_fs_str(r.profile_image_url),
             'requestedExpiresAt', r.requested_expires_at,
             'isRenewal', COALESCE(r.is_renewal, false)
           )), '[]'::jsonb)
      INTO v_reqs
    FROM riding_group_join_requests r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.group_id = g.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'group', public.fn_riding_group_doc(g) || jsonb_build_object('_members', v_members, '_joinRequests', v_reqs),
    'readBackend', 'supabase',
    'readSource', 'supabase_rpc'
  );
END;
$$;

/** 내가 멤버인 APPROVED 소모임 — mapAdaptedGroupToMyGroupsListRow, memberCount↓·이름↑ 정렬 */
CREATE OR REPLACE FUNCTION public.fn_my_riding_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY mc DESC, lname COLLATE "C" ASC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT COALESCE((d->>'memberCount')::int, 0) AS mc, lower(COALESCE(d->>'name', '')) AS lname,
           jsonb_build_object(
             'id', d->>'id',
             'groupId', d->>'id',
             'name', COALESCE(NULLIF(d->>'name', ''), '(이름 없음)'),
             'photoUrl', COALESCE(btrim(d->>'photoUrl'), ''),
             'memberCount', (d->'memberCount'),
             'createdBy', COALESCE(d->>'createdBy', ''),
             'category', d->>'category',
             'resolvedCategory', d->>'category',
             'categoryExplicit', true,
             'regions', d->'regions',
             'isPublic', COALESCE((d->>'isPublic')::boolean, true),
             'isPaid', COALESCE((d->>'isPaid')::boolean, false),
             'rankingNotice', d->'rankingNotice',
             'readBackend', 'supabase'
           ) AS row_obj
    FROM (
      SELECT public.fn_riding_group_doc(g) AS d
      FROM riding_groups g
      WHERE g.status = 'APPROVED' AND g.firestore_doc_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM riding_group_members m WHERE m.group_id = g.id AND m.user_id = auth.uid())
    ) s
  ) t;
  RETURN jsonb_build_object('success', true, 'groups', v_rows, 'readBackend', 'supabase', 'readSource', 'supabase_rpc');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_my_group_memberships(p_group_ids text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
  ELSE jsonb_build_object(
    'success', true,
    'memberGroupIds', COALESCE((
      SELECT jsonb_agg(g.firestore_doc_id)
      FROM riding_groups g
      JOIN riding_group_members m ON m.group_id = g.id AND m.user_id = auth.uid()
      WHERE g.firestore_doc_id = ANY (p_group_ids)
    ), '[]'::jsonb),
    'readBackend', 'supabase', 'readSource', 'supabase_rpc') END;
$$;

/** 내 소모임들의 멤버 UID·표시명·사진·역할 맵(전화번호 없음) — fetchMyGroupContactSet */
CREATE OR REPLACE FUNCTION public.fn_my_group_contact_set(p_group_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT COALESCE(jsonb_object_agg(fb, obj), '{}'::jsonb) INTO v_map
  FROM (
    SELECT DISTINCT ON (u.firebase_uid) u.firebase_uid AS fb,
           jsonb_build_object(
             'userId', u.firebase_uid,
             'name', COALESCE(btrim(m.display_name), ''),
             'profileImageUrl', NULLIF(m.profile_image_url, ''),
             'role', COALESCE(m.role::text, 'member')
           ) AS obj
    FROM riding_group_members m
    JOIN riding_groups g ON g.id = m.group_id
    JOIN users u ON u.id = m.user_id AND u.firebase_uid IS NOT NULL
    WHERE g.firestore_doc_id = ANY (p_group_ids) AND g.status = 'APPROVED'
    -- 여러 소모임에 속한 회원은 저장 순서상 첫 행(기존 Cloud Run 구현과 동일)
    ORDER BY u.firebase_uid, m.ctid
  ) s;
  RETURN jsonb_build_object(
    'success', true,
    'uids', COALESCE((SELECT jsonb_agg(k) FROM jsonb_object_keys(v_map) k), '[]'::jsonb),
    'map', v_map,
    'readBackend', 'supabase', 'readSource', 'supabase_rpc');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_my_group_join_request_status(p_group_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('success', false, 'error', 'unauthenticated')
  ELSE jsonb_build_object('success', true, 'row', (
    SELECT jsonb_build_object('userId', u.firebase_uid, 'pending', true, 'requestedAt', r.requested_at)
    FROM riding_groups g
    JOIN riding_group_join_requests r ON r.group_id = g.id AND r.user_id = auth.uid()
    JOIN users u ON u.id = r.user_id
    WHERE g.firestore_doc_id = p_group_id
    LIMIT 1
  )) END;
$$;

REVOKE ALL ON FUNCTION public.fn_riding_group_doc(public.riding_groups) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_riding_group_detail(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_my_riding_groups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_my_group_memberships(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_my_group_contact_set(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_my_group_join_request_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_riding_group_detail(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_riding_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_group_memberships(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_group_contact_set(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_group_join_request_status(text) TO authenticated;
