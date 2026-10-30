-- 루트맵 즐겨찾기 코스 공개/설명 (2026-10-31)
--
-- 내 즐겨찾기 코스(내가 만든 모임의 GPX, Cloud Function getMyGpxCoursesForRead)에 사용자가 붙이는 정보:
--   제목(목록 표시용, 모임 제목은 그대로), 경로 설명, 공개 여부.
-- 공개로 두면 '공개 코스' 탭에서 다른 사용자도 코스맵으로 사용할 수 있다.
-- 공개 중복 방지: GPX 경로 모양(sig: 누적거리 기준 균등 50점 [lat,lng]) + 총거리로 비교 —
--   같은 gpx_url 이거나, 총거리 차 ≤ max(50m, 1%) · 시작/끝점 ≤ 30m · 50점 평균 거리 ≤ 50m 이면 같은 코스로 보고 공개 불가.
-- 테이블은 RLS 를 켜고 정책을 두지 않아 직접 접근을 막고, SECURITY DEFINER RPC(auth.uid())로만 읽고 쓴다.

CREATE TABLE IF NOT EXISTS public.route_course_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ride_id text,
  gpx_url text NOT NULL CHECK (char_length(gpx_url) BETWEEN 8 AND 2000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  is_public boolean NOT NULL DEFAULT false,
  distance_m double precision,
  sig jsonb,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gpx_url)
);
CREATE INDEX IF NOT EXISTS route_course_shares_public_idx ON public.route_course_shares (updated_at DESC) WHERE is_public;

ALTER TABLE public.route_course_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_course_shares FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_route_course_hav(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) +
    cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)
  ));
$$;

-- 목록: 'mine' 내가 붙인 정보(제목·설명·공개) | 'public' 공개 코스(최근 순, 작성자 이름 포함)
CREATE OR REPLACE FUNCTION public.fn_route_course_list(p_scope text DEFAULT 'mine')
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
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.updated_at DESC)
    FROM (
      SELECT s.id, s.ride_id, s.gpx_url, s.title, s.description, s.is_public, s.distance_m, s.updated_at,
             (s.user_id = v_uid) AS is_mine,
             CASE WHEN p_scope = 'public' THEN coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(u.name), ''), '라이더') END AS owner_name
      FROM route_course_shares s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE CASE WHEN p_scope = 'public' THEN s.is_public ELSE s.user_id = v_uid END
      ORDER BY s.updated_at DESC
      LIMIT 300
    ) t
  ), '[]'::jsonb));
END;
$$;

-- 저장(내 코스 gpx_url 기준 upsert): 제목·설명·공개 여부. 공개로 바꿀 때는 sig 가 필요하고 중복 검사.
CREATE OR REPLACE FUNCTION public.fn_route_course_save(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_url text := btrim(coalesce(p ->> 'gpx_url', ''));
  v_title text := left(btrim(coalesce(p ->> 'title', '')), 40);
  v_desc text := nullif(left(btrim(coalesce(p ->> 'description', '')), 300), '');
  v_pub boolean := coalesce((p ->> 'is_public')::boolean, false);
  v_sig jsonb := CASE WHEN jsonb_typeof(p -> 'sig') = 'array' THEN p -> 'sig' END;
  v_dist double precision := nullif(p ->> 'distance_m', '')::double precision;
  v_old route_course_shares;
  v_row route_course_shares;
  v_n int;
  v_slat double precision; v_slng double precision; v_elat double precision; v_elng double precision;
  c record;
  v_sum double precision;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;
  IF char_length(v_url) < 8 OR v_url !~* '^https://' THEN
    RETURN jsonb_build_object('success', false, 'error', '코스 GPX 주소가 올바르지 않습니다.');
  END IF;
  IF v_title = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '제목을 입력해 주세요.');
  END IF;

  SELECT * INTO v_old FROM route_course_shares WHERE user_id = v_uid AND gpx_url = v_url;
  IF v_sig IS NULL AND v_old.id IS NOT NULL THEN v_sig := v_old.sig; END IF;
  IF v_dist IS NULL AND v_old.id IS NOT NULL THEN v_dist := v_old.distance_m; END IF;

  IF v_sig IS NOT NULL THEN
    v_n := jsonb_array_length(v_sig);
    IF v_n <> 50 THEN
      RETURN jsonb_build_object('success', false, 'error', '코스 경로 정보가 올바르지 않습니다.');
    END IF;
    v_slat := (v_sig -> 0 ->> 0)::double precision; v_slng := (v_sig -> 0 ->> 1)::double precision;
    v_elat := (v_sig -> 49 ->> 0)::double precision; v_elng := (v_sig -> 49 ->> 1)::double precision;
  END IF;

  IF v_pub THEN
    IF v_sig IS NULL OR v_dist IS NULL OR v_dist <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '코스 경로를 읽지 못해 공개할 수 없습니다.');
    END IF;
    -- 같은 GPX 파일이 이미 다른 사람 이름으로 공개되어 있음
    IF EXISTS (SELECT 1 FROM route_course_shares s WHERE s.is_public AND s.gpx_url = v_url AND s.user_id <> v_uid) THEN
      RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE', 'error', '같은 코스가 이미 공개 코스에 등록되어 있습니다.');
    END IF;
    -- GPX 경로 모양 비교
    FOR c IN
      SELECT s.id, s.title, s.sig FROM route_course_shares s
      WHERE s.is_public AND s.sig IS NOT NULL AND NOT (s.user_id = v_uid AND s.gpx_url = v_url)
        AND abs(s.distance_m - v_dist) <= greatest(50, v_dist * 0.01)
        AND fn_route_course_hav(s.start_lat, s.start_lng, v_slat, v_slng) <= 30
        AND fn_route_course_hav(s.end_lat, s.end_lng, v_elat, v_elng) <= 30
    LOOP
      v_sum := 0;
      FOR i IN 0..49 LOOP
        v_sum := v_sum + fn_route_course_hav(
          (c.sig -> i ->> 0)::double precision, (c.sig -> i ->> 1)::double precision,
          (v_sig -> i ->> 0)::double precision, (v_sig -> i ->> 1)::double precision);
      END LOOP;
      IF v_sum / 50 <= 50 THEN
        RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE',
          'error', '같은 경로의 코스가 이미 공개되어 있습니다: ' || c.title);
      END IF;
    END LOOP;
  END IF;

  IF v_old.id IS NULL THEN
    IF (SELECT count(*) FROM route_course_shares WHERE user_id = v_uid) >= 300 THEN
      RETURN jsonb_build_object('success', false, 'error', '코스는 300개까지 저장할 수 있습니다.');
    END IF;
    INSERT INTO route_course_shares (user_id, ride_id, gpx_url, title, description, is_public, distance_m, sig, start_lat, start_lng, end_lat, end_lng)
    VALUES (v_uid, left(nullif(btrim(p ->> 'ride_id'), ''), 80), v_url, v_title, v_desc, v_pub, v_dist, v_sig, v_slat, v_slng, v_elat, v_elng)
    RETURNING * INTO v_row;
  ELSE
    UPDATE route_course_shares SET
      title = v_title, description = v_desc, is_public = v_pub,
      ride_id = coalesce(left(nullif(btrim(p ->> 'ride_id'), ''), 80), ride_id),
      distance_m = v_dist, sig = v_sig,
      start_lat = coalesce(v_slat, start_lat), start_lng = coalesce(v_slng, start_lng),
      end_lat = coalesce(v_elat, end_lat), end_lng = coalesce(v_elng, end_lng),
      updated_at = now()
    WHERE id = v_old.id
    RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'is_public', v_row.is_public);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_route_course_list(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_route_course_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_route_course_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_route_course_save(jsonb) TO authenticated;
