-- 루트맵 즐겨찾기 카테고리 '매장(store)' 추가 (2026-10-27)
--  + 메모 30자 바로잡기: 20261024200000_route_favorites_memo30 이후 다른 재정의로 운영 함수가 다시 20자로 자르고 있었음
ALTER TABLE public.route_favorites DROP CONSTRAINT IF EXISTS route_favorites_category_check;
ALTER TABLE public.route_favorites ADD CONSTRAINT route_favorites_category_check
  CHECK (category IN ('food', 'cafe', 'spot', 'store', 'home', 'etc'));

DO $do$
DECLARE d text; d2 text;
BEGIN
  d := pg_get_functiondef('public.fn_route_fav_save(jsonb)'::regprocedure);
  d2 := replace(d, $a$IF v_cat NOT IN ('food', 'cafe', 'spot', 'home', 'etc') THEN$a$,
                   $b$IF v_cat NOT IN ('food', 'cafe', 'spot', 'store', 'home', 'etc') THEN$b$);
  d2 := replace(d2, $a$left(nullif(btrim(p ->> 'memo'), ''), 20)$a$, $b$left(nullif(btrim(p ->> 'memo'), ''), 30)$b$);
  IF position($c$'store'$c$ in d2) = 0 OR position($c$'memo'), ''), 20)$c$ in d2) > 0 THEN
    RAISE EXCEPTION 'fn_route_fav_save body did not match expected text';
  END IF;
  EXECUTE d2;
END
$do$;
