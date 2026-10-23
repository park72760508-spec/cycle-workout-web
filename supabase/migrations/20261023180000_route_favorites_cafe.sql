-- ROUTE 즐겨찾기 카테고리 변경 (2026-10-23): '카페(cafe)' 추가, '회사(work)' 제거
-- 회사로 등록된 항목은 0개(적용 전 확인). 저장 함수의 카테고리 검사 목록도 같이 바꾼다.

ALTER TABLE public.route_favorites DROP CONSTRAINT IF EXISTS route_favorites_category_check;
ALTER TABLE public.route_favorites ADD CONSTRAINT route_favorites_category_check
  CHECK (category IN ('food', 'cafe', 'spot', 'home', 'etc'));

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
  IF v_cat NOT IN ('food', 'cafe', 'spot', 'home', 'etc') THEN v_cat := 'etc'; END IF;
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
