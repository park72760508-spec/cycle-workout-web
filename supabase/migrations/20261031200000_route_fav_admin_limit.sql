-- 루트맵 즐겨찾기 개수 제한 (2026-10-31)
-- 관리자 계정이 공개 장소를 200개 등록해 더 이상 저장되지 않던 문제:
--   저장 제한 200개 → 관리자 5000개(일반 사용자는 200개 유지)
--   목록 300개에서 잘림 → 3000개
-- 함수 본문의 나머지는 그대로 두고 해당 부분만 바꾼다.
DO $$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.fn_route_fav_save(jsonb)'::regprocedure);
  d := replace(d, '  v_row route_favorites;', '  v_row route_favorites;' || chr(10) || '  v_max int := CASE WHEN public.fn_is_admin() THEN 5000 ELSE 200 END;');
  d := replace(d,
    'IF (SELECT count(*) FROM route_favorites WHERE user_id = v_uid) >= 200 THEN',
    'IF (SELECT count(*) FROM route_favorites WHERE user_id = v_uid) >= v_max THEN');
  d := replace(d, '''즐겨찾기는 200개까지 저장할 수 있습니다.''', '''즐겨찾기는 '' || v_max || ''개까지 저장할 수 있습니다.''');
  IF position('>= v_max THEN' IN d) = 0 OR position('v_max int' IN d) = 0 THEN RAISE EXCEPTION 'fn_route_fav_save: 제한 문구를 찾지 못함'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.fn_route_fav_list(text)'::regprocedure);
  IF position('LIMIT 300' IN d) = 0 THEN RAISE EXCEPTION 'fn_route_fav_list: LIMIT 300 을 찾지 못함'; END IF;
  d := replace(d, 'LIMIT 300', 'LIMIT 3000');
  EXECUTE d;
END $$;
