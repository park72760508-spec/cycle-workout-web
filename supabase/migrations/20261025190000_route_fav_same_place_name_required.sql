-- 즐겨찾기 '같은 장소' 판단 수정(2026-10-25): 거리만으로(30m) 같은 장소로 보던 규칙 제거.
-- 도심에서는 30m 안에 다른 가게가 흔해, 이름이 다른 장소(예: '왕짬뽕'과 17m 옆 '40192')가 같은 장소로 묶여
-- 공개 장소 목록에서 하나가 가려졌다. → 이름이 같으면 150m 이내, 이름이 서로 포함되면(본점·지점 표기 차이) 50m 이내만 같은 장소.
CREATE OR REPLACE FUNCTION public.fn_route_fav_same_place(lat1 double precision, lng1 double precision, n1 text,
                                                         lat2 double precision, lng2 double precision, n2 text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH k AS (
    SELECT public.fn_route_fav_name_key(n1) AS a, public.fn_route_fav_name_key(n2) AS b,
           sqrt(power((lat2 - lat1) * 111320, 2) + power((lng2 - lng1) * 111320 * cos(radians(lat1)), 2)) AS m
  )
  SELECT CASE
    WHEN k.a = '' OR k.b = '' THEN false
    WHEN k.a = k.b THEN k.m <= 150
    WHEN least(length(k.a), length(k.b)) >= 2 AND (strpos(k.a, k.b) > 0 OR strpos(k.b, k.a) > 0) THEN k.m <= 50
    ELSE false END
  FROM k
$$;
