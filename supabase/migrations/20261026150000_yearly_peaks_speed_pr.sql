-- 라이딩 상세 Summary '구간별 평속' PR(2026-10-26)
--  fn_my_yearly_peaks 결과에 그해 rides 의 구간별 최고 평속(최고 속도·1·5·10·20·40·60분)을 함께 돌려준다.
--  파워·심박 PR 과 같이 "그해 최고값과 같거나 높으면 PR" 로 화면에서 판정한다.
--  yearly_peaks 행이 없어도(파워 기록 없음) 평속 값만 담아 돌려준다.
CREATE OR REPLACE FUNCTION public.fn_my_yearly_peaks(p_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH y AS (
    SELECT year, weight_kg, max_hr, max_hr_date, max_1min_watts, max_1min_wkg, max_5min_watts,
           max_5min_wkg, max_10min_watts, max_10min_wkg, max_20min_watts, max_20min_wkg,
           max_40min_watts, max_40min_wkg, max_60min_watts, max_60min_wkg, max_watts, max_wkg, updated_at
    FROM yearly_peaks
    WHERE auth.uid() IS NOT NULL AND user_id = auth.uid() AND year = p_year
    LIMIT 1
  ),
  s AS (
    SELECT max(max_speed_kmh) FILTER (WHERE max_1min_speed_kmh IS NOT NULL) AS peak_max_speed_kmh,
           max(max_1min_speed_kmh)  AS max_1min_speed_kmh,
           max(max_5min_speed_kmh)  AS max_5min_speed_kmh,
           max(max_10min_speed_kmh) AS max_10min_speed_kmh,
           max(max_20min_speed_kmh) AS max_20min_speed_kmh,
           max(max_40min_speed_kmh) AS max_40min_speed_kmh,
           max(max_60min_speed_kmh) AS max_60min_speed_kmh
    FROM rides
    WHERE auth.uid() IS NOT NULL AND user_id = auth.uid()
      AND ride_date >= make_date(p_year, 1, 1) AND ride_date < make_date(p_year + 1, 1, 1)
      AND max_1min_speed_kmh IS NOT NULL
  )
  SELECT jsonb_build_object(
    'success', auth.uid() IS NOT NULL,
    'row', CASE
      WHEN (SELECT count(*) FROM y) = 0 AND (SELECT max_1min_speed_kmh FROM s) IS NULL THEN NULL
      ELSE coalesce((SELECT to_jsonb(y) FROM y), jsonb_build_object('year', p_year))
           || coalesce((SELECT jsonb_strip_nulls(to_jsonb(s)) FROM s), '{}'::jsonb)
    END
  );
$function$;
