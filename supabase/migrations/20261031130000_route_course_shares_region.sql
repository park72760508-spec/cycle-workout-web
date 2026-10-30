-- 즐겨찾기 코스 출발지 지역(시도·구군) — 즐겨찾기 코스 화면의 시도/구군 필터용 (2026-10-31)

ALTER TABLE public.route_course_shares ADD COLUMN IF NOT EXISTS start_sido text, ADD COLUMN IF NOT EXISTS start_sigungu text;

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
      SELECT s.id, s.ride_id, s.gpx_url, s.title, s.description, s.is_public, s.distance_m, s.updated_at, s.start_sido, s.start_sigungu,
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
  v_sido text := left(nullif(btrim(p ->> 'start_sido'), ''), 30);
  v_sgg text := left(nullif(btrim(p ->> 'start_sigungu'), ''), 30);
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
    INSERT INTO route_course_shares (user_id, ride_id, gpx_url, title, description, is_public, distance_m, sig, start_lat, start_lng, end_lat, end_lng, start_sido, start_sigungu)
    VALUES (v_uid, left(nullif(btrim(p ->> 'ride_id'), ''), 80), v_url, v_title, v_desc, v_pub, v_dist, v_sig, v_slat, v_slng, v_elat, v_elng, v_sido, v_sgg)
    RETURNING * INTO v_row;
  ELSE
    UPDATE route_course_shares SET
      title = v_title, description = v_desc, is_public = v_pub,
      ride_id = coalesce(left(nullif(btrim(p ->> 'ride_id'), ''), 80), ride_id),
      distance_m = v_dist, sig = v_sig,
      start_lat = coalesce(v_slat, start_lat), start_lng = coalesce(v_slng, start_lng),
      end_lat = coalesce(v_elat, end_lat), end_lng = coalesce(v_elng, end_lng),
      start_sido = coalesce(v_sido, start_sido), start_sigungu = coalesce(v_sgg, start_sigungu),
      updated_at = now()
    WHERE id = v_old.id
    RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'is_public', v_row.is_public);
END;
$$;

