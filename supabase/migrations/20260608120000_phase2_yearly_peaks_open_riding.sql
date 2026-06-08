-- Phase 2: Supabase side-effect 완성 (yearly_peaks + suspicious_power_records + open_ride_strava_reviews)
--
-- 롤백 (Firebase upsertYearlyPeakFromLog 유지):
--   ALTER TABLE public.rides DISABLE TRIGGER trg_rides_yearly_peaks;
--   ALTER TABLE public.rides DISABLE TRIGGER trg_rides_open_ride_strava;
-- 복구:
--   ALTER TABLE public.rides ENABLE TRIGGER trg_rides_yearly_peaks;
--   ALTER TABLE public.rides ENABLE TRIGGER trg_rides_open_ride_strava;

-- -----------------------------------------------------------------------------
-- 1. rides — max_hr_5sec
-- -----------------------------------------------------------------------------
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS max_hr_5sec smallint;

COMMENT ON COLUMN public.rides.max_hr_5sec IS '5초 평균 최대 심박 — yearly_peaks.max_hr 갱신 우선';

-- -----------------------------------------------------------------------------
-- 2. suspicious_power_records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suspicious_power_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  year                  smallint NOT NULL,
  ride_date             date,
  duration_type         text NOT NULL,
  watts                 numeric(8,1) NOT NULL,
  wkg                   numeric(6,2) NOT NULL,
  weight_kg             numeric(5,2) NOT NULL,
  source                public.activity_source,
  activity_id           text,
  ride_id               bigint REFERENCES public.rides(id) ON DELETE SET NULL,
  activity_type         text,
  status                text NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_power_user_year
  ON public.suspicious_power_records (user_id, year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suspicious_power_pending
  ON public.suspicious_power_records (status)
  WHERE status = 'pending';

ALTER TABLE public.suspicious_power_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suspicious_power_admin_read ON public.suspicious_power_records;
CREATE POLICY suspicious_power_admin_read ON public.suspicious_power_records
  FOR SELECT TO authenticated
  USING (public.fn_is_admin() OR public.fn_is_sub_admin());

DROP POLICY IF EXISTS suspicious_power_no_client_write ON public.suspicious_power_records;
CREATE POLICY suspicious_power_no_client_write ON public.suspicious_power_records
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- 3. 의심 기록 저장
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_save_suspicious_power_record(
  p_user_id uuid,
  p_year smallint,
  p_ride_date date,
  p_duration_type text,
  p_watts numeric,
  p_wkg numeric,
  p_weight_kg numeric,
  p_source public.activity_source,
  p_activity_id text,
  p_ride_id bigint,
  p_activity_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.suspicious_power_records (
    user_id, year, ride_date, duration_type, watts, wkg, weight_kg,
    source, activity_id, ride_id, activity_type, status
  ) VALUES (
    p_user_id, p_year, p_ride_date, p_duration_type, p_watts, p_wkg, p_weight_kg,
    p_source, p_activity_id, p_ride_id, p_activity_type, 'pending'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'fn_save_suspicious_power_record failed user=% ride=%: %',
      p_user_id, p_ride_id, SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. 호스트 대표 거리 (Firebase pickHostRepresentativeDistanceKm)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pick_host_representative_distance_km(
  p_planned_km numeric,
  p_distances numeric[]
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_planned numeric := COALESCE(p_planned_km, 0);
  v_max numeric := 0;
  v_pick numeric;
BEGIN
  IF p_distances IS NULL OR array_length(p_distances, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF v_planned <= 0 THEN
    SELECT COALESCE(MAX(d), 0) INTO v_max
    FROM unnest(p_distances) AS d
    WHERE d IS NOT NULL AND d > 0;
    RETURN round(v_max::numeric, 2);
  END IF;

  SELECT d INTO v_pick
  FROM unnest(p_distances) AS d
  WHERE d IS NOT NULL AND d > 0
    AND (
      (d >= v_planned * 0.9 AND d <= v_planned * 1.1)
      OR d > v_planned
    )
  ORDER BY ABS(d - v_planned) ASC
  LIMIT 1;

  RETURN round(COALESCE(v_pick, 0)::numeric, 2);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. 구간 피크 검증·yearly_peaks 필드 반영 (헬퍼)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_yearly_peak_try_duration(
  p_dur text,
  p_watts numeric,
  p_cur_watts numeric,
  p_weight_kg numeric,
  p_ride public.rides,
  p_year smallint,
  p_activity_type text
)
RETURNS TABLE(out_watts numeric, out_wkg numeric, out_changed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_watts numeric;
  v_wkg numeric;
  v_changed boolean := false;
BEGIN
  v_watts := p_cur_watts;

  IF p_watts IS NULL OR p_watts <= 0 THEN
    RETURN QUERY SELECT v_watts, NULL::numeric, false;
    RETURN;
  END IF;

  IF NOT public.fn_validate_peak_power(p_dur, p_watts, p_weight_kg) THEN
    v_wkg := round((p_watts / p_weight_kg)::numeric, 2);
    PERFORM public.fn_save_suspicious_power_record(
      p_ride.user_id, p_year, p_ride.ride_date, p_dur, p_watts, v_wkg, p_weight_kg,
      p_ride.source, p_ride.activity_id, p_ride.id, p_activity_type
    );
    RETURN QUERY SELECT v_watts, NULL::numeric, false;
    RETURN;
  END IF;

  IF p_watts > COALESCE(p_cur_watts, 0) THEN
    v_watts := p_watts;
    v_wkg := round((p_watts / p_weight_kg)::numeric, 2);
    v_changed := true;
  END IF;

  RETURN QUERY SELECT v_watts, v_wkg, v_changed;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. 연간 피크 upsert (Firebase upsertYearlyPeakFromLog)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_upsert_yearly_peak_from_ride(p_ride public.rides)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_kg numeric;
  v_year smallint;
  cur public.yearly_peaks%ROWTYPE;
  v_max_hr smallint;
  v_changed boolean := false;
  v_activity_type text;
  rec record;
  dur_rec record;
BEGIN
  IF p_ride IS NULL THEN RETURN; END IF;
  IF NOT public.fn_is_cycling_ride(p_ride) THEN RETURN; END IF;

  SELECT * INTO u FROM public.users WHERE id = p_ride.user_id;
  IF NOT FOUND THEN RETURN; END IF;

  w_kg := COALESCE(NULLIF(p_ride.weight_at_ride_kg, 0), NULLIF(u.weight_kg, 0));
  IF w_kg IS NULL OR w_kg <= 0 THEN RETURN; END IF;
  w_kg := GREATEST(w_kg, 45);

  v_year := EXTRACT(YEAR FROM p_ride.ride_date)::smallint;
  v_activity_type := COALESCE(
    NULLIF(btrim(p_ride.activity_type), ''),
    CASE WHEN p_ride.source = 'strava' THEN 'Unknown' ELSE 'Stelvio' END
  );

  SELECT * INTO cur FROM public.yearly_peaks
  WHERE user_id = p_ride.user_id AND year = v_year;

  IF NOT FOUND THEN
    cur.user_id := p_ride.user_id;
    cur.year := v_year;
  END IF;

  FOR rec IN
    SELECT * FROM (
      VALUES
        ('1min'::text, p_ride.max_1min_watts, cur.max_1min_watts),
        ('5min', p_ride.max_5min_watts, cur.max_5min_watts),
        ('10min', p_ride.max_10min_watts, cur.max_10min_watts),
        ('20min', p_ride.max_20min_watts, cur.max_20min_watts),
        ('40min', p_ride.max_40min_watts, cur.max_40min_watts),
        ('60min', p_ride.max_60min_watts, cur.max_60min_watts),
        ('max', p_ride.max_watts, cur.max_watts)
    ) AS t(dur, ride_watts, peak_watts)
  LOOP
    SELECT * INTO dur_rec FROM public.fn_yearly_peak_try_duration(
      rec.dur, rec.ride_watts, rec.peak_watts, w_kg, p_ride, v_year, v_activity_type
    );
    IF COALESCE(dur_rec.out_changed, false) THEN
      v_changed := true;
      CASE rec.dur
        WHEN '1min' THEN cur.max_1min_watts := dur_rec.out_watts; cur.max_1min_wkg := dur_rec.out_wkg;
        WHEN '5min' THEN cur.max_5min_watts := dur_rec.out_watts; cur.max_5min_wkg := dur_rec.out_wkg;
        WHEN '10min' THEN cur.max_10min_watts := dur_rec.out_watts; cur.max_10min_wkg := dur_rec.out_wkg;
        WHEN '20min' THEN cur.max_20min_watts := dur_rec.out_watts; cur.max_20min_wkg := dur_rec.out_wkg;
        WHEN '40min' THEN cur.max_40min_watts := dur_rec.out_watts; cur.max_40min_wkg := dur_rec.out_wkg;
        WHEN '60min' THEN cur.max_60min_watts := dur_rec.out_watts; cur.max_60min_wkg := dur_rec.out_wkg;
        WHEN 'max' THEN cur.max_watts := dur_rec.out_watts; cur.max_wkg := dur_rec.out_wkg;
        ELSE NULL;
      END CASE;
    END IF;
  END LOOP;

  v_max_hr := COALESCE(NULLIF(p_ride.max_hr_5sec, 0), NULLIF(p_ride.max_hr, 0), 0)::smallint;
  IF v_max_hr > 0 AND v_max_hr > COALESCE(cur.max_hr, 0) THEN
    cur.max_hr := v_max_hr;
    cur.max_hr_date := p_ride.ride_date;
    v_changed := true;
  END IF;

  IF NOT v_changed THEN RETURN; END IF;

  INSERT INTO public.yearly_peaks (
    user_id, year, weight_kg,
    max_hr, max_hr_date,
    max_1min_watts, max_1min_wkg,
    max_5min_watts, max_5min_wkg,
    max_10min_watts, max_10min_wkg,
    max_20min_watts, max_20min_wkg,
    max_40min_watts, max_40min_wkg,
    max_60min_watts, max_60min_wkg,
    max_watts, max_wkg,
    updated_at
  ) VALUES (
    p_ride.user_id, v_year, w_kg,
    cur.max_hr, cur.max_hr_date,
    cur.max_1min_watts, cur.max_1min_wkg,
    cur.max_5min_watts, cur.max_5min_wkg,
    cur.max_10min_watts, cur.max_10min_wkg,
    cur.max_20min_watts, cur.max_20min_wkg,
    cur.max_40min_watts, cur.max_40min_wkg,
    cur.max_60min_watts, cur.max_60min_wkg,
    cur.max_watts, cur.max_wkg,
    now()
  )
  ON CONFLICT (user_id, year) DO UPDATE SET
    weight_kg = EXCLUDED.weight_kg,
    max_hr = GREATEST(COALESCE(yearly_peaks.max_hr, 0), COALESCE(EXCLUDED.max_hr, 0)),
    max_hr_date = CASE
      WHEN COALESCE(EXCLUDED.max_hr, 0) > COALESCE(yearly_peaks.max_hr, 0) THEN EXCLUDED.max_hr_date
      ELSE yearly_peaks.max_hr_date
    END,
    max_1min_watts = GREATEST(COALESCE(yearly_peaks.max_1min_watts, 0), COALESCE(EXCLUDED.max_1min_watts, 0)),
    max_1min_wkg = CASE WHEN COALESCE(EXCLUDED.max_1min_watts, 0) > COALESCE(yearly_peaks.max_1min_watts, 0)
      THEN EXCLUDED.max_1min_wkg ELSE yearly_peaks.max_1min_wkg END,
    max_5min_watts = GREATEST(COALESCE(yearly_peaks.max_5min_watts, 0), COALESCE(EXCLUDED.max_5min_watts, 0)),
    max_5min_wkg = CASE WHEN COALESCE(EXCLUDED.max_5min_watts, 0) > COALESCE(yearly_peaks.max_5min_watts, 0)
      THEN EXCLUDED.max_5min_wkg ELSE yearly_peaks.max_5min_wkg END,
    max_10min_watts = GREATEST(COALESCE(yearly_peaks.max_10min_watts, 0), COALESCE(EXCLUDED.max_10min_watts, 0)),
    max_10min_wkg = CASE WHEN COALESCE(EXCLUDED.max_10min_watts, 0) > COALESCE(yearly_peaks.max_10min_watts, 0)
      THEN EXCLUDED.max_10min_wkg ELSE yearly_peaks.max_10min_wkg END,
    max_20min_watts = GREATEST(COALESCE(yearly_peaks.max_20min_watts, 0), COALESCE(EXCLUDED.max_20min_watts, 0)),
    max_20min_wkg = CASE WHEN COALESCE(EXCLUDED.max_20min_watts, 0) > COALESCE(yearly_peaks.max_20min_watts, 0)
      THEN EXCLUDED.max_20min_wkg ELSE yearly_peaks.max_20min_wkg END,
    max_40min_watts = GREATEST(COALESCE(yearly_peaks.max_40min_watts, 0), COALESCE(EXCLUDED.max_40min_watts, 0)),
    max_40min_wkg = CASE WHEN COALESCE(EXCLUDED.max_40min_watts, 0) > COALESCE(yearly_peaks.max_40min_watts, 0)
      THEN EXCLUDED.max_40min_wkg ELSE yearly_peaks.max_40min_wkg END,
    max_60min_watts = GREATEST(COALESCE(yearly_peaks.max_60min_watts, 0), COALESCE(EXCLUDED.max_60min_watts, 0)),
    max_60min_wkg = CASE WHEN COALESCE(EXCLUDED.max_60min_watts, 0) > COALESCE(yearly_peaks.max_60min_watts, 0)
      THEN EXCLUDED.max_60min_wkg ELSE yearly_peaks.max_60min_wkg END,
    max_watts = GREATEST(COALESCE(yearly_peaks.max_watts, 0), COALESCE(EXCLUDED.max_watts, 0)),
    max_wkg = CASE WHEN COALESCE(EXCLUDED.max_watts, 0) > COALESCE(yearly_peaks.max_watts, 0)
      THEN EXCLUDED.max_wkg ELSE yearly_peaks.max_wkg END,
    updated_at = now();
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'fn_upsert_yearly_peak_from_ride failed ride=%: %', p_ride.id, SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. 오픈라이딩 Strava 거리 sync (Firebase syncOpenRidingParticipantDistanceByLog)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_open_ride_strava_reviews(
  p_user_id uuid,
  p_ride_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  orow record;
  v_distances numeric[];
  v_dist_km numeric;
  v_sum numeric;
BEGIN
  IF p_user_id IS NULL OR p_ride_date IS NULL THEN RETURN; END IF;

  SELECT COALESCE(array_agg(r.distance_km ORDER BY r.distance_km), ARRAY[]::numeric[])
  INTO v_distances
  FROM public.rides r
  WHERE r.user_id = p_user_id
    AND r.ride_date = p_ride_date
    AND r.source = 'strava'
    AND public.fn_is_cycling_ride(r)
    AND COALESCE(r.distance_km, 0) > 0;

  IF v_distances IS NULL OR array_length(v_distances, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR orow IN
    SELECT o.id AS open_ride_id, o.host_user_id, o.distance_km AS planned_km
    FROM public.open_rides o
    INNER JOIN public.open_ride_participants p
      ON p.ride_id = o.id AND p.user_id = p_user_id
    WHERE o.ride_date = p_ride_date
      AND o.status <> 'cancelled'
  LOOP
    IF orow.host_user_id = p_user_id THEN
      v_dist_km := public.fn_pick_host_representative_distance_km(orow.planned_km, v_distances);
    ELSE
      SELECT round(COALESCE(SUM(d), 0)::numeric, 2) INTO v_sum
      FROM unnest(v_distances) AS d;
      v_dist_km := v_sum;
    END IF;

    IF v_dist_km <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.open_ride_strava_reviews (
      ride_id, user_id, ride_date_ymd, distance_km, source, synced_by, updated_at
    ) VALUES (
      orow.open_ride_id,
      p_user_id,
      to_char(p_ride_date, 'YYYY-MM-DD'),
      v_dist_km,
      'strava',
      'pg_fn_sync_open_ride_strava_reviews',
      now()
    )
    ON CONFLICT (ride_id, user_id) DO UPDATE SET
      ride_date_ymd = EXCLUDED.ride_date_ymd,
      distance_km = EXCLUDED.distance_km,
      source = EXCLUDED.source,
      synced_by = EXCLUDED.synced_by,
      updated_at = now();
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'fn_sync_open_ride_strava_reviews failed user=% date=%: %',
      p_user_id, p_ride_date, SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. 트리거 (trg_rides_refresh_stats 와 분리 — 개별 DISABLE 롤백)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rides_yearly_peaks_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.fn_upsert_yearly_peak_from_ride(NEW);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rides_open_ride_strava_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.source = 'strava' AND public.fn_is_cycling_ride(NEW) THEN
      PERFORM public.fn_sync_open_ride_strava_reviews(NEW.user_id, NEW.ride_date);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_rides_yearly_peaks ON public.rides;
CREATE TRIGGER trg_rides_yearly_peaks
  AFTER INSERT OR UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.fn_rides_yearly_peaks_after_change();

DROP TRIGGER IF EXISTS trg_rides_open_ride_strava ON public.rides;
CREATE TRIGGER trg_rides_open_ride_strava
  AFTER INSERT OR UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.fn_rides_open_ride_strava_after_change();

COMMENT ON FUNCTION public.fn_upsert_yearly_peak_from_ride IS
  'Phase 2 — rides INSERT/UPDATE 시 yearly_peaks upsert (Firebase upsertYearlyPeakFromLog 대응)';

COMMENT ON FUNCTION public.fn_sync_open_ride_strava_reviews IS
  'Phase 2 — 참가자 당일 Strava rides.distance_km 기반 open_ride_strava_reviews 동기화';
