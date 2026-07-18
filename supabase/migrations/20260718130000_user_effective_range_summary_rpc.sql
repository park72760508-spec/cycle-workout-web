-- 임의 구간(예: 롤링 7일) 사용자 1명의 유효 TSS·KM·치팅데이 여부를 daily_summaries에서 즉시 합산.
-- Firestore users/{uid}/ranking_day_totals 버킷 스캔(functions/rankingDayRollup.js:
-- weeklyTssSumFromDayBuckets/rollingKmSumFromDayBuckets/cheatDayPresentFromBuckets)을
-- 대체하기 위한 Supabase 우선 조회 경로. fn_effective_day_tss/fn_effective_day_km
-- (500 TSS/day 컷오프, Strava 우선)을 그대로 재사용해 Firestore와 동일한 결과를 보장한다.
CREATE OR REPLACE FUNCTION public.fn_user_effective_range_summary(
  p_user_id uuid, p_start date, p_end date
)
RETURNS TABLE(total_tss numeric, total_km numeric, has_cheat_day boolean)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(public.fn_effective_day_tss(d)), 0)::numeric,
    COALESCE(SUM(public.fn_effective_day_km(d)), 0)::numeric,
    BOOL_OR(
      CASE WHEN d.tss_strava_sum > 0 THEN d.tss_strava_sum ELSE d.tss_stelvio_sum END >= 500
    )
  FROM public.daily_summaries d
  WHERE d.user_id = p_user_id AND d.summary_date BETWEEN p_start AND p_end;
$$;

GRANT EXECUTE ON FUNCTION public.fn_user_effective_range_summary(uuid, date, date) TO service_role;
