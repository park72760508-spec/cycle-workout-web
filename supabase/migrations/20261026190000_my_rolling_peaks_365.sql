-- 라이딩 기록 PR 기준: 최근 365일(2026-10-26, RUN 과 같은 기간)
--  yearly_peaks(그해 1/1~) 대신 오늘 포함 최근 365일 rides 에서 바로 계산한다.
--  규칙은 yearly_peaks 갱신(fn_upsert_yearly_peak_from_ride)과 같음:
--   · 사이클 기록만(fn_is_cycling_ride), 몸무게 = 기록 당시 → 프로필, 최소 45kg
--   · 파워는 fn_validate_peak_power 통과 값만, W/kg 는 최고 파워 기록의 값
--   · 심박 = max_hr_5sec → max_hr, 평속 = 구간 평속이 있는 기록의 최고값
--  window_start 이전 기록은 화면에서 PR 대상에서 뺀다(기준 기간 밖).
CREATE OR REPLACE FUNCTION public.fn_my_rolling_peaks()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d_end,
           (now() AT TIME ZONE 'Asia/Seoul')::date - 364 AS d_start
  ), r AS (
    SELECT x.*, greatest(coalesce(nullif(x.weight_at_ride_kg, 0), nullif(u.weight_kg, 0)), 45) AS w
      FROM rides x
      JOIN users u ON u.id = x.user_id
      CROSS JOIN b
     WHERE auth.uid() IS NOT NULL AND x.user_id = auth.uid()
       AND x.ride_date BETWEEN b.d_start AND b.d_end
       AND public.fn_is_cycling_ride(x)
  ), p AS (
    SELECT
      max(max_1min_watts)  FILTER (WHERE w > 0 AND max_1min_watts  > 0 AND fn_validate_peak_power('1min', max_1min_watts::numeric, w::numeric)) AS max_1min_watts,
      (array_agg(round(max_1min_watts / w, 2)  ORDER BY max_1min_watts DESC)  FILTER (WHERE w > 0 AND max_1min_watts  > 0 AND fn_validate_peak_power('1min', max_1min_watts::numeric, w::numeric)))[1] AS max_1min_wkg,
      max(max_5min_watts)  FILTER (WHERE w > 0 AND max_5min_watts  > 0 AND fn_validate_peak_power('5min', max_5min_watts::numeric, w::numeric)) AS max_5min_watts,
      (array_agg(round(max_5min_watts / w, 2)  ORDER BY max_5min_watts DESC)  FILTER (WHERE w > 0 AND max_5min_watts  > 0 AND fn_validate_peak_power('5min', max_5min_watts::numeric, w::numeric)))[1] AS max_5min_wkg,
      max(max_10min_watts) FILTER (WHERE w > 0 AND max_10min_watts > 0 AND fn_validate_peak_power('10min', max_10min_watts::numeric, w::numeric)) AS max_10min_watts,
      (array_agg(round(max_10min_watts / w, 2) ORDER BY max_10min_watts DESC) FILTER (WHERE w > 0 AND max_10min_watts > 0 AND fn_validate_peak_power('10min', max_10min_watts::numeric, w::numeric)))[1] AS max_10min_wkg,
      max(max_20min_watts) FILTER (WHERE w > 0 AND max_20min_watts > 0 AND fn_validate_peak_power('20min', max_20min_watts::numeric, w::numeric)) AS max_20min_watts,
      (array_agg(round(max_20min_watts / w, 2) ORDER BY max_20min_watts DESC) FILTER (WHERE w > 0 AND max_20min_watts > 0 AND fn_validate_peak_power('20min', max_20min_watts::numeric, w::numeric)))[1] AS max_20min_wkg,
      max(max_40min_watts) FILTER (WHERE w > 0 AND max_40min_watts > 0 AND fn_validate_peak_power('40min', max_40min_watts::numeric, w::numeric)) AS max_40min_watts,
      (array_agg(round(max_40min_watts / w, 2) ORDER BY max_40min_watts DESC) FILTER (WHERE w > 0 AND max_40min_watts > 0 AND fn_validate_peak_power('40min', max_40min_watts::numeric, w::numeric)))[1] AS max_40min_wkg,
      max(max_60min_watts) FILTER (WHERE w > 0 AND max_60min_watts > 0 AND fn_validate_peak_power('60min', max_60min_watts::numeric, w::numeric)) AS max_60min_watts,
      (array_agg(round(max_60min_watts / w, 2) ORDER BY max_60min_watts DESC) FILTER (WHERE w > 0 AND max_60min_watts > 0 AND fn_validate_peak_power('60min', max_60min_watts::numeric, w::numeric)))[1] AS max_60min_wkg,
      max(max_watts)       FILTER (WHERE w > 0 AND max_watts       > 0 AND fn_validate_peak_power('max', max_watts::numeric, w::numeric)) AS max_watts,
      (array_agg(round(max_watts / w, 2)       ORDER BY max_watts DESC)       FILTER (WHERE w > 0 AND max_watts       > 0 AND fn_validate_peak_power('max', max_watts::numeric, w::numeric)))[1] AS max_wkg,
      max(coalesce(nullif(max_hr_5sec, 0), nullif(max_hr, 0))) AS max_hr,
      max(max_speed_kmh) FILTER (WHERE max_1min_speed_kmh IS NOT NULL) AS peak_max_speed_kmh,
      max(max_1min_speed_kmh)  AS max_1min_speed_kmh,
      max(max_5min_speed_kmh)  AS max_5min_speed_kmh,
      max(max_10min_speed_kmh) AS max_10min_speed_kmh,
      max(max_20min_speed_kmh) AS max_20min_speed_kmh,
      max(max_40min_speed_kmh) AS max_40min_speed_kmh,
      max(max_60min_speed_kmh) AS max_60min_speed_kmh,
      count(*) AS n
    FROM r
  )
  SELECT jsonb_build_object(
    'success', auth.uid() IS NOT NULL,
    'row', CASE WHEN (SELECT n FROM p) = 0 THEN NULL ELSE
      (SELECT jsonb_strip_nulls(to_jsonb(p) - 'n') FROM p)
      || jsonb_build_object('window_start', (SELECT d_start FROM b)::text, 'window_end', (SELECT d_end FROM b)::text)
    END
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_my_rolling_peaks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_rolling_peaks() TO authenticated;
