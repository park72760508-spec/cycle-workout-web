-- 즐겨찾기 공개 대기 표시·관리자 수동 공개(2026-10-25)
--  - public_approved: 관리자가 조건(등록자 3명) 미충족 장소를 수동으로 공개 전환
--  - 공개 장소 목록: 공개된 장소 + 공개 대기 장소(관리자는 전부, 요청한 사용자는 본인 것만, public_status='pending')
ALTER TABLE public.route_favorites ADD COLUMN IF NOT EXISTS public_approved boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_route_fav_list(p_scope text DEFAULT 'mine')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_min int := 3; -- 일반 사용자 장소 공개에 필요한 등록자 수
  v_admin boolean := public.fn_is_admin();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  RETURN jsonb_build_object('success', true, 'endorse_min', v_min, 'items', coalesce((
    WITH base AS (
      SELECT f.*, (u.grade = 'admin') AS by_admin,
             coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(u.name), ''), '라이더') AS owner_nm
        FROM route_favorites f
        LEFT JOIN users u ON u.id = f.user_id
       WHERE CASE WHEN p_scope = 'public' THEN f.is_public ELSE f.user_id = v_uid END
    ), scored AS (
      SELECT b.*,
             (SELECT count(DISTINCT g.user_id) FROM route_favorites g
               WHERE fn_route_fav_same_place(b.lat, b.lng, b.name, g.lat, g.lng, g.name)) AS endorse
        FROM base b
    ), vis AS (
      SELECT s.*, (s.is_public AND (coalesce(s.by_admin, false) OR s.public_approved OR s.endorse >= v_min)) AS shown FROM scored s
    ), pick AS (
      SELECT v.* FROM vis v
       WHERE p_scope <> 'public'
          -- 공개 대기 장소: 관리자는 전부, 요청한 사용자는 본인 것만 공개 장소 목록에 함께 보임
          OR (v.is_public AND NOT v.shown AND (v_admin OR v.user_id = v_uid))
          OR (v.shown AND NOT EXISTS (
                SELECT 1 FROM vis w
                 WHERE w.shown AND w.id <> v.id
                   AND fn_route_fav_same_place(v.lat, v.lng, v.name, w.lat, w.lng, w.name)
                   AND (coalesce(w.by_admin, false), w.like_count, -extract(epoch FROM w.created_at), w.id::text)
                       > (coalesce(v.by_admin, false), v.like_count, -extract(epoch FROM v.created_at), v.id::text)))
    ), t AS (
      SELECT p.id, p.category, p.name, p.sido, p.sigungu, p.address, p.lat, p.lng, p.is_public, p.like_count, p.created_at,
             p.affiliate_id, p.affiliate_name, p.affiliate_discount, p.memo,
             (p.user_id = v_uid) AS is_mine,
             EXISTS (SELECT 1 FROM route_favorite_likes l WHERE l.favorite_id = p.id AND l.user_id = v_uid) AS liked,
             CASE WHEN p_scope = 'public' THEN p.owner_nm END AS owner_name,
             p.endorse AS endorse_count,
             CASE WHEN NOT p.is_public THEN NULL
                  WHEN coalesce(p.by_admin, false) THEN 'admin'
                  WHEN p.public_approved THEN 'manual'
                  WHEN p.endorse >= v_min THEN 'approved'
                  ELSE 'pending' END AS public_status,
             CASE WHEN p_scope = 'public' THEN p.like_count ELSE 0 END AS ord1
        FROM pick p
       ORDER BY ord1 DESC, p.created_at DESC
       LIMIT 300
    )
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.ord1 DESC, t.created_at DESC) FROM t
  ), '[]'::jsonb));
END;
$$;

-- 관리자 수동 공개 전환/해제
CREATE OR REPLACE FUNCTION public.fn_route_fav_admin_approve(p_id uuid, p_on boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', '관리자만 공개 전환할 수 있습니다.');
  END IF;
  UPDATE route_favorites SET public_approved = coalesce(p_on, true), updated_at = now()
   WHERE id = p_id AND is_public;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '공개 신청된 장소가 아닙니다.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_route_fav_admin_approve(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_route_fav_admin_approve(uuid, boolean) TO authenticated;
