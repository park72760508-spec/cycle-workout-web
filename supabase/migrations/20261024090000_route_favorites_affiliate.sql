-- ROUTE 즐겨찾기 제휴사 연결 (2026-10-24)
-- 관리자가 즐겨찾기에 제휴사(Firestore affiliates)를 지정하면 지도 핀·팝업에 제휴사 할인율 배지를 표시.
-- 지도를 열 때마다 Firestore 를 읽지 않도록 이름·할인율을 함께 저장(저장 시점 값).
-- 제휴사 값은 관리자(fn_is_admin)만 바꿀 수 있고, 일반 사용자가 수정하면 기존 값을 그대로 둔다.

ALTER TABLE public.route_favorites ADD COLUMN IF NOT EXISTS affiliate_id text;
ALTER TABLE public.route_favorites ADD COLUMN IF NOT EXISTS affiliate_name text;
ALTER TABLE public.route_favorites ADD COLUMN IF NOT EXISTS affiliate_discount integer;

CREATE OR REPLACE FUNCTION public.fn_route_fav_list(p_scope text DEFAULT 'mine')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  RETURN jsonb_build_object('success', true, 'items', coalesce((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.ord1 DESC, t.created_at DESC)
    FROM (
      SELECT f.id, f.category, f.name, f.sido, f.sigungu, f.address, f.lat, f.lng, f.is_public, f.like_count, f.created_at,
             f.affiliate_id, f.affiliate_name, f.affiliate_discount,
             (f.user_id = v_uid) AS is_mine,
             EXISTS (SELECT 1 FROM route_favorite_likes l WHERE l.favorite_id = f.id AND l.user_id = v_uid) AS liked,
             CASE WHEN p_scope = 'public' THEN coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(u.name), ''), '라이더') END AS owner_name,
             CASE WHEN p_scope = 'public' THEN f.like_count ELSE 0 END AS ord1
      FROM route_favorites f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE CASE WHEN p_scope = 'public' THEN f.is_public ELSE f.user_id = v_uid END
      ORDER BY ord1 DESC, f.created_at DESC
      LIMIT 300
    ) t
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_route_fav_save(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_cat text := lower(coalesce(p ->> 'category', 'etc'));
  v_name text := left(btrim(coalesce(p ->> 'name', '')), 40);
  v_lat double precision := nullif(p ->> 'lat', '')::double precision;
  v_lng double precision := nullif(p ->> 'lng', '')::double precision;
  v_pub boolean := coalesce((p ->> 'is_public')::boolean, false);
  v_admin boolean := public.fn_is_admin();
  v_set_aff boolean;
  v_aff_id text := left(nullif(btrim(p ->> 'affiliate_id'), ''), 80);
  v_aff_name text := left(nullif(btrim(p ->> 'affiliate_name'), ''), 60);
  v_aff_disc integer := nullif(p ->> 'affiliate_discount', '')::numeric::integer;
  v_row route_favorites;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  IF v_cat NOT IN ('food', 'cafe', 'spot', 'home', 'etc') THEN v_cat := 'etc'; END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '장소명을 입력해 주세요.');
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', '위치 정보가 올바르지 않습니다.');
  END IF;
  -- 제휴사: 관리자가 affiliate_id 키를 보낸 경우에만 반영(빈 값 = 연결 해제)
  v_set_aff := v_admin AND (p ? 'affiliate_id');
  IF v_aff_id IS NULL THEN v_aff_name := NULL; v_aff_disc := NULL; END IF;
  IF v_aff_disc IS NOT NULL AND (v_aff_disc <= 0 OR v_aff_disc > 100) THEN v_aff_disc := NULL; END IF;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM route_favorites WHERE user_id = v_uid) >= 200 THEN
      RETURN jsonb_build_object('success', false, 'error', '즐겨찾기는 200개까지 저장할 수 있습니다.');
    END IF;
    INSERT INTO route_favorites (user_id, category, name, sido, sigungu, address, lat, lng, is_public,
                                 affiliate_id, affiliate_name, affiliate_discount)
    VALUES (v_uid, v_cat, v_name, left(nullif(btrim(p ->> 'sido'), ''), 30), left(nullif(btrim(p ->> 'sigungu'), ''), 30),
            left(nullif(btrim(p ->> 'address'), ''), 120), v_lat, v_lng, v_pub,
            CASE WHEN v_set_aff THEN v_aff_id END, CASE WHEN v_set_aff THEN v_aff_name END, CASE WHEN v_set_aff THEN v_aff_disc END)
    RETURNING * INTO v_row;
  ELSE
    UPDATE route_favorites SET
      category = v_cat, name = v_name,
      sido = left(nullif(btrim(p ->> 'sido'), ''), 30), sigungu = left(nullif(btrim(p ->> 'sigungu'), ''), 30),
      address = left(nullif(btrim(p ->> 'address'), ''), 120),
      lat = v_lat, lng = v_lng, is_public = v_pub, updated_at = now(),
      affiliate_id = CASE WHEN v_set_aff THEN v_aff_id ELSE affiliate_id END,
      affiliate_name = CASE WHEN v_set_aff THEN v_aff_name ELSE affiliate_name END,
      affiliate_discount = CASE WHEN v_set_aff THEN v_aff_disc ELSE affiliate_discount END
    WHERE id = v_id AND user_id = v_uid
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', '수정할 수 없는 즐겨찾기입니다.');
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;
