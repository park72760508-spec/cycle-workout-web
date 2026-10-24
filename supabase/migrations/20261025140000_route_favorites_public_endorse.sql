-- ROUTE 즐겨찾기 공개 규칙(2026-10-25)
--  - 관리자(users.grade='admin')가 공개로 저장한 장소: 바로 '공개 장소'에 표시
--  - 일반 사용자가 공개로 저장한 장소: 같은 장소를 즐겨찾기에 등록한 사용자가 3명 이상(본인 포함)일 때만 표시
--    (무분별한 등록 차단 — 여러 사람이 실제로 찾는 장소만 공개)
--  - 같은 장소 판단: 30m 이내, 또는 150m 이내이면서 장소명이 같음(공백·기호 무시)
--  - 같은 장소에 공개 항목이 여러 개면 1개만(관리자 등록 > 좋아요 많은 순 > 먼저 등록)
--  - 내 즐겨찾기 목록에는 공개 상태(public_status: admin | approved | pending)와 등록자 수(endorse_count)를 함께 돌려줌

CREATE OR REPLACE FUNCTION public.fn_route_fav_name_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(regexp_replace(coalesce(p, ''), '[[:space:][:punct:]·]+', '', 'g')) $$;

CREATE OR REPLACE FUNCTION public.fn_route_fav_same_place(lat1 double precision, lng1 double precision, n1 text,
                                                         lat2 double precision, lng2 double precision, n2 text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH d AS (
    SELECT sqrt(power((lat2 - lat1) * 111320, 2) + power((lng2 - lng1) * 111320 * cos(radians(lat1)), 2)) AS m
  )
  SELECT (SELECT m FROM d) <= 30
      OR ((SELECT m FROM d) <= 150 AND public.fn_route_fav_name_key(n1) <> '' AND public.fn_route_fav_name_key(n1) = public.fn_route_fav_name_key(n2))
$$;

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
      SELECT s.*, (s.is_public AND (coalesce(s.by_admin, false) OR s.endorse >= v_min)) AS shown FROM scored s
    ), pick AS (
      SELECT v.* FROM vis v
       WHERE p_scope <> 'public'
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
