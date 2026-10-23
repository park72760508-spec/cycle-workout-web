-- ROUTE(아웃도어 길찾기) 즐겨찾기 장소 (2026-10-23)
--
-- 지도에서 깃발로 찍은 위치(위도·경도, 시도·구군)를 카테고리·장소명과 함께 저장 → 목록에서 눌러 바로 길찾기.
-- 공개(is_public)로 저장하면 '공개 장소' 목록에 보이고 다른 사용자가 좋아요를 누를 수 있다. 비공개는 본인 목록에만.
-- 테이블은 RLS 를 켜고 정책을 두지 않아 직접 접근을 막고, 아래 SECURITY DEFINER RPC(auth.uid() 본인 확인)로만 읽고 쓴다.

CREATE TABLE IF NOT EXISTS public.route_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('food', 'spot', 'home', 'work', 'etc')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  sido text,
  sigungu text,
  address text,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  is_public boolean NOT NULL DEFAULT false,
  like_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_favorites_user_idx ON public.route_favorites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS route_favorites_public_idx ON public.route_favorites (like_count DESC, created_at DESC) WHERE is_public;

CREATE TABLE IF NOT EXISTS public.route_favorite_likes (
  favorite_id uuid NOT NULL REFERENCES public.route_favorites (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (favorite_id, user_id)
);

ALTER TABLE public.route_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_favorite_likes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_favorites FROM anon, authenticated;
REVOKE ALL ON public.route_favorite_likes FROM anon, authenticated;

-- 목록: p_scope 'mine'(내 즐겨찾기 전체) | 'public'(공개 장소, 좋아요 많은 순)
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

-- 저장(새로 만들기) / 수정(p.id 가 본인 것일 때)
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
  v_row route_favorites;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  IF v_cat NOT IN ('food', 'spot', 'home', 'work', 'etc') THEN v_cat := 'etc'; END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '장소명을 입력해 주세요.');
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', '위치 정보가 올바르지 않습니다.');
  END IF;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM route_favorites WHERE user_id = v_uid) >= 200 THEN
      RETURN jsonb_build_object('success', false, 'error', '즐겨찾기는 200개까지 저장할 수 있습니다.');
    END IF;
    INSERT INTO route_favorites (user_id, category, name, sido, sigungu, address, lat, lng, is_public)
    VALUES (v_uid, v_cat, v_name, left(nullif(btrim(p ->> 'sido'), ''), 30), left(nullif(btrim(p ->> 'sigungu'), ''), 30),
            left(nullif(btrim(p ->> 'address'), ''), 120), v_lat, v_lng, v_pub)
    RETURNING * INTO v_row;
  ELSE
    UPDATE route_favorites SET
      category = v_cat, name = v_name,
      sido = left(nullif(btrim(p ->> 'sido'), ''), 30), sigungu = left(nullif(btrim(p ->> 'sigungu'), ''), 30),
      address = left(nullif(btrim(p ->> 'address'), ''), 120),
      lat = v_lat, lng = v_lng, is_public = v_pub, updated_at = now()
    WHERE id = v_id AND user_id = v_uid
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', '수정할 수 없는 즐겨찾기입니다.');
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_route_fav_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  DELETE FROM route_favorites WHERE id = p_id AND user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', v_n > 0);
END;
$$;

-- 좋아요 누르기/취소 — 공개 장소만, 본인 장소는 제외
CREATE OR REPLACE FUNCTION public.fn_route_fav_toggle_like(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fav route_favorites;
  v_liked boolean;
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  SELECT * INTO v_fav FROM route_favorites WHERE id = p_id FOR UPDATE;
  IF v_fav.id IS NULL OR NOT v_fav.is_public THEN
    RETURN jsonb_build_object('success', false, 'error', '공개된 장소가 아닙니다.');
  END IF;
  IF v_fav.user_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', '내 장소에는 좋아요를 누를 수 없습니다.');
  END IF;
  DELETE FROM route_favorite_likes WHERE favorite_id = p_id AND user_id = v_uid;
  IF FOUND THEN
    v_liked := false;
  ELSE
    INSERT INTO route_favorite_likes (favorite_id, user_id) VALUES (p_id, v_uid);
    v_liked := true;
  END IF;
  SELECT count(*) INTO v_count FROM route_favorite_likes WHERE favorite_id = p_id;
  UPDATE route_favorites SET like_count = v_count WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'liked', v_liked, 'like_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_route_fav_list(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_route_fav_save(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_route_fav_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_route_fav_toggle_like(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_route_fav_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_route_fav_save(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_route_fav_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_route_fav_toggle_like(uuid) TO authenticated;
