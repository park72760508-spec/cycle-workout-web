-- =============================================================================
-- STELVIO Supabase Schema Reset (100k+ users)
-- Firestore 1:1 변환 폐기 · RDBMS 정규화 + Trigger 집계 + Materialized View 랭킹
-- Supabase SQL Editor에 전체 복사 후 1회 실행
-- Timezone: Asia/Seoul (KST)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. CLEAN-UP (역의존 순서)
-- ※ DROP TRIGGER ON 테이블 / DROP FUNCTION(...table_row_type) 은
--    테이블이 없을 때(최초 실행) 42P01 오류 → 테이블 CASCADE 삭제로 대체
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.mv_leaderboard_speed_28d CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_leaderboard_distance_30d CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_leaderboard_weekly_tss CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_leaderboard_peak_28d CASCADE;

DROP VIEW IF EXISTS public.v_user_public_profile CASCADE;

-- auth.users 는 Supabase에 항상 존재
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 테이블 CASCADE: 트리거·행 타입 의존 함수 함께 제거
DROP TABLE IF EXISTS public.open_ride_participants CASCADE;
DROP TABLE IF EXISTS public.open_rides CASCADE;
DROP TABLE IF EXISTS public.point_history CASCADE;
DROP TABLE IF EXISTS public.processed_orders CASCADE;
DROP TABLE IF EXISTS public.user_orders CASCADE;
DROP TABLE IF EXISTS public.user_friends CASCADE;
DROP TABLE IF EXISTS public.yearly_peaks CASCADE;
DROP TABLE IF EXISTS public.user_ranking_metrics CASCADE;
DROP TABLE IF EXISTS public.daily_summaries CASCADE;
DROP TABLE IF EXISTS public.rides CASCADE;
DROP TABLE IF EXISTS public.strava_connections CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- 잔여 함수 (테이블 행 타입 인자 없음 — 최초 실행에서도 안전)
DROP FUNCTION IF EXISTS public.fn_handle_new_auth_user() CASCADE;
DROP FUNCTION IF EXISTS public.fn_rides_after_change() CASCADE;
DROP FUNCTION IF EXISTS public.fn_refresh_user_ranking_metrics(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_reconcile_daily_summary(uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.fn_refresh_ranking_materialized_views() CASCADE;
DROP FUNCTION IF EXISTS public.fn_seoul_today() CASCADE;
DROP FUNCTION IF EXISTS public.fn_seoul_week_range() CASCADE;
DROP FUNCTION IF EXISTS public.fn_seoul_rolling_range(integer) CASCADE;
DROP FUNCTION IF EXISTS public.fn_calculate_speed_on_flat(numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.fn_validate_peak_power(text, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.fn_normalize_gender(text) CASCADE;
DROP FUNCTION IF EXISTS public.fn_touch_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.fn_is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.fn_is_sub_admin() CASCADE;

DROP TYPE IF EXISTS public.activity_source CASCADE;
DROP TYPE IF EXISTS public.user_grade CASCADE;
DROP TYPE IF EXISTS public.account_status CASCADE;
DROP TYPE IF EXISTS public.gender_code CASCADE;
DROP TYPE IF EXISTS public.challenge_goal CASCADE;
DROP TYPE IF EXISTS public.league_category CASCADE;
DROP TYPE IF EXISTS public.age_category CASCADE;
DROP TYPE IF EXISTS public.open_ride_status CASCADE;

-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS & ENUMS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.activity_source AS ENUM ('strava', 'stelvio', 'other');
CREATE TYPE public.user_grade AS ENUM ('admin', 'member', 'sub_admin');
CREATE TYPE public.account_status AS ENUM ('active', 'withdrawn', 'suspended');
CREATE TYPE public.gender_code AS ENUM ('male', 'female', 'unknown');
CREATE TYPE public.challenge_goal AS ENUM ('Fitness', 'GranFondo', 'Racing', 'Elite', 'PRO', 'other');
CREATE TYPE public.league_category AS ENUM ('Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda', 'unknown');
CREATE TYPE public.age_category AS ENUM ('Bianco', 'Rosa', 'Infinito', 'Leggenda', 'unknown');
CREATE TYPE public.open_ride_status AS ENUM ('active', 'cancelled', 'completed');

-- -----------------------------------------------------------------------------
-- 2. CORE TABLES (정규화)
-- -----------------------------------------------------------------------------

-- auth.users.id 와 1:1 (Supabase Auth)
CREATE TABLE public.users (
  id                    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  text NOT NULL DEFAULT '',
  display_name          text,
  contact               text,
  phone                 text,
  email                 text,

  ftp                   numeric(6,1) NOT NULL DEFAULT 0,
  ftp_updated_at        timestamptz,
  weight_kg             numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  birth_year            smallint CHECK (birth_year IS NULL OR birth_year BETWEEN 1920 AND 2100),
  gender                public.gender_code NOT NULL DEFAULT 'unknown',
  challenge             public.challenge_goal NOT NULL DEFAULT 'Fitness',

  grade                 public.user_grade NOT NULL DEFAULT 'member',
  account_status        public.account_status NOT NULL DEFAULT 'active',

  expiry_date           date,
  acc_points            integer NOT NULL DEFAULT 0 CHECK (acc_points >= 0),
  rem_points            integer NOT NULL DEFAULT 0 CHECK (rem_points >= 0),
  last_training_date    date,

  is_private            boolean NOT NULL DEFAULT false,
  profile_image_url     text,
  max_hr                smallint CHECK (max_hr IS NULL OR max_hr BETWEEN 80 AND 250),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.users IS 'Firestore users/{uid} — 프로필·구독·랭킹 분류 메타';

CREATE TABLE public.strava_connections (
  user_id               uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  strava_athlete_id     bigint,
  access_token          text NOT NULL,
  refresh_token         text NOT NULL,
  expires_at            timestamptz NOT NULL,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.strava_connections IS 'Strava OAuth 토큰 — users 문서에서 분리 (RLS 강화)';

-- Strava / Stelvio 활동 로그 (Firestore users/{uid}/logs)
CREATE TABLE public.rides (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source                public.activity_source NOT NULL DEFAULT 'stelvio',
  activity_id           text,
  activity_type         text,

  title                 text,
  ride_date             date NOT NULL,
  workout_id            text,

  duration_sec          integer NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  distance_km           numeric(10,3),
  elevation_gain_m      numeric(8,1),
  avg_speed_kmh         numeric(6,2),

  weight_at_ride_kg     numeric(5,2),
  ftp_at_time           numeric(6,1),
  avg_watts             numeric(8,1),
  weighted_watts        numeric(8,1),
  max_watts             numeric(8,1),
  tss                   numeric(8,2) NOT NULL DEFAULT 0,
  intensity_factor      numeric(6,4),
  kilojoules            numeric(10,2),
  earned_points         integer NOT NULL DEFAULT 0,

  avg_hr                smallint,
  max_hr                smallint,
  avg_cadence           smallint,
  efficiency_factor     numeric(8,4),
  rpe                   smallint,

  max_1min_watts        numeric(8,1),
  max_5min_watts        numeric(8,1),
  max_10min_watts       numeric(8,1),
  max_20min_watts       numeric(8,1),
  max_30min_watts       numeric(8,1),
  max_40min_watts       numeric(8,1),
  max_60min_watts       numeric(8,1),

  max_hr_1min           smallint,
  max_hr_5min           smallint,
  max_hr_10min          smallint,
  max_hr_20min          smallint,
  max_hr_40min          smallint,
  max_hr_60min          smallint,

  tss_applied           boolean NOT NULL DEFAULT false,
  tss_applied_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rides_user_activity_unique UNIQUE (user_id, activity_id),
  CONSTRAINT rides_user_date_source_chk CHECK (ride_date IS NOT NULL)
);

COMMENT ON TABLE public.rides IS '훈련·Strava 활동 — INSERT 시 daily_summaries·user_ranking_metrics 자동 갱신';

CREATE INDEX idx_rides_user_date ON public.rides (user_id, ride_date DESC);
CREATE INDEX idx_rides_user_source_date ON public.rides (user_id, source, ride_date DESC);
CREATE INDEX idx_rides_activity_id ON public.rides (activity_id) WHERE activity_id IS NOT NULL;

-- 일별 집계 (Firestore ranking_day_totals)
CREATE TABLE public.daily_summaries (
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  summary_date          date NOT NULL,

  tss_strava_sum        numeric(10,2) NOT NULL DEFAULT 0,
  tss_stelvio_sum       numeric(10,2) NOT NULL DEFAULT 0,
  km_strava_sum         numeric(10,3) NOT NULL DEFAULT 0,
  km_stelvio_sum        numeric(10,3) NOT NULL DEFAULT 0,
  weight_used_kg        numeric(5,2),

  max_1min_watts        numeric(8,1) NOT NULL DEFAULT 0,
  max_5min_watts        numeric(8,1) NOT NULL DEFAULT 0,
  max_10min_watts       numeric(8,1) NOT NULL DEFAULT 0,
  max_20min_watts       numeric(8,1) NOT NULL DEFAULT 0,
  max_40min_watts       numeric(8,1) NOT NULL DEFAULT 0,
  max_60min_watts       numeric(8,1) NOT NULL DEFAULT 0,
  max_watts             numeric(8,1) NOT NULL DEFAULT 0,

  max_hr_1min           smallint NOT NULL DEFAULT 0,
  max_hr_5min           smallint NOT NULL DEFAULT 0,
  max_hr_10min          smallint NOT NULL DEFAULT 0,
  max_hr_20min          smallint NOT NULL DEFAULT 0,
  max_hr_40min          smallint NOT NULL DEFAULT 0,
  max_hr_60min          smallint NOT NULL DEFAULT 0,

  reconciled_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, summary_date)
);

COMMENT ON TABLE public.daily_summaries IS '일별 TSS·거리·MMP — rides 변경 시 트리거로 재합산';

CREATE INDEX idx_daily_summaries_date ON public.daily_summaries (summary_date);
CREATE INDEX idx_daily_summaries_user_date_range ON public.daily_summaries (user_id, summary_date DESC);

-- 사용자별 롤링 랭킹 스냅샷 (Firestore ranking_rollups 대체, 트리거 유지)
CREATE TABLE public.user_ranking_metrics (
  user_id               uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  peak_window_start     date,
  peak_window_end       date,
  peak_1min_wkg         numeric(6,2) NOT NULL DEFAULT 0,
  peak_5min_wkg         numeric(6,2) NOT NULL DEFAULT 0,
  peak_10min_wkg        numeric(6,2) NOT NULL DEFAULT 0,
  peak_20min_wkg        numeric(6,2) NOT NULL DEFAULT 0,
  peak_40min_wkg        numeric(6,2) NOT NULL DEFAULT 0,
  peak_60min_wkg        numeric(6,2) NOT NULL DEFAULT 0,
  peak_max_wkg          numeric(6,2) NOT NULL DEFAULT 0,
  peak_method           text NOT NULL DEFAULT 'four_week_one_peak',

  weekly_tss            numeric(10,2) NOT NULL DEFAULT 0,
  week_start            date,
  week_end              date,
  weekly_has_cheat_day  boolean NOT NULL DEFAULT false,

  distance_30d_km       numeric(12,3) NOT NULL DEFAULT 0,
  dist_window_start     date,
  dist_window_end       date,

  speed_28d_kmh         numeric(6,2) NOT NULL DEFAULT 0,
  speed_peak60_watts    numeric(8,1) NOT NULL DEFAULT 0,
  speed_peak60_date     date,
  speed_window_start    date,
  speed_window_end      date,

  metrics_updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_ranking_metrics IS '28일 피크·주간 TSS·30일 거리·28일 항속 — rides/daily_summaries 트리거로 즉시 갱신';

CREATE INDEX idx_urm_peak_60min_wkg ON public.user_ranking_metrics (peak_60min_wkg DESC) WHERE peak_60min_wkg > 0;
CREATE INDEX idx_urm_peak_max_wkg ON public.user_ranking_metrics (peak_max_wkg DESC) WHERE peak_max_wkg > 0;
CREATE INDEX idx_urm_weekly_tss ON public.user_ranking_metrics (weekly_tss DESC) WHERE weekly_tss > 0;
CREATE INDEX idx_urm_distance_30d ON public.user_ranking_metrics (distance_30d_km DESC) WHERE distance_30d_km > 0;
CREATE INDEX idx_urm_speed_28d ON public.user_ranking_metrics (speed_28d_kmh DESC) WHERE speed_28d_kmh > 0;

CREATE TABLE public.yearly_peaks (
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  year                  smallint NOT NULL,
  weight_kg             numeric(5,2),
  max_hr                smallint,
  max_hr_date           date,
  max_1min_watts        numeric(8,1),
  max_1min_wkg          numeric(6,2),
  max_5min_watts        numeric(8,1),
  max_5min_wkg          numeric(6,2),
  max_10min_watts       numeric(8,1),
  max_10min_wkg         numeric(6,2),
  max_20min_watts       numeric(8,1),
  max_20min_wkg         numeric(6,2),
  max_40min_watts       numeric(8,1),
  max_40min_wkg         numeric(6,2),
  max_60min_watts       numeric(8,1),
  max_60min_wkg         numeric(6,2),
  max_watts             numeric(8,1),
  max_wkg               numeric(6,2),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);

CREATE TABLE public.user_friends (
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name          text,
  contact               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_user_id),
  CONSTRAINT user_friends_no_self CHECK (user_id <> friend_user_id)
);

CREATE TABLE public.user_orders (
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_order_id      text NOT NULL,
  product_name          text,
  product_option        text,
  quantity              integer,
  payment_date          timestamptz,
  status                text NOT NULL DEFAULT 'PAYED',
  claim_date            timestamptz,
  claim_reason          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_order_id)
);

CREATE TABLE public.processed_orders (
  product_order_id      text PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_days            integer NOT NULL DEFAULT 0,
  order_type            text NOT NULL DEFAULT 'PAYED',
  processed_at          timestamptz NOT NULL DEFAULT now(),
  revoked               boolean NOT NULL DEFAULT false,
  revoked_at            timestamptz
);

CREATE TABLE public.point_history (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source                public.activity_source,
  is_strava             boolean NOT NULL DEFAULT false,
  tss                   numeric(8,2) NOT NULL DEFAULT 0,
  earned_points         integer NOT NULL DEFAULT 0,
  points_before         integer NOT NULL DEFAULT 0,
  points_after          integer NOT NULL DEFAULT 0,
  ride_id               bigint REFERENCES public.rides(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_point_history_user_created ON public.point_history (user_id, created_at DESC);

-- 오픈 라이딩 (Firestore rides/{rideId} — 활동 로그와 구분)
CREATE TABLE public.open_rides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  ride_date             date NOT NULL,
  departure_time        time NOT NULL,
  departure_location    text NOT NULL DEFAULT '',
  distance_km           numeric(8,2) NOT NULL DEFAULT 0,
  course                text NOT NULL DEFAULT '',
  level                 text NOT NULL DEFAULT '',
  max_participants      integer NOT NULL DEFAULT 0,
  host_name             text NOT NULL DEFAULT '',
  contact_info          text NOT NULL DEFAULT '',
  is_contact_public     boolean NOT NULL DEFAULT false,
  gpx_url               text,
  region                text NOT NULL DEFAULT '',
  status                public.open_ride_status NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.open_ride_participants (
  ride_id               uuid NOT NULL REFERENCES public.open_rides(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_waitlist           boolean NOT NULL DEFAULT false,
  waitlist_position     integer,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id)
);

CREATE INDEX idx_open_rides_date ON public.open_rides (ride_date DESC);
CREATE INDEX idx_open_ride_participants_user ON public.open_ride_participants (user_id);

-- users.updated_at 자동
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

CREATE TRIGGER trg_rides_updated_at
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. DOMAIN FUNCTIONS (Seoul · TSS · 피크 · 항속)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seoul_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (timezone('Asia/Seoul', now()))::date;
$$;

CREATE OR REPLACE FUNCTION public.fn_seoul_rolling_range(p_days integer)
RETURNS TABLE (start_date date, end_date date)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (public.fn_seoul_today() - (GREATEST(p_days, 1) - 1))::date,
    public.fn_seoul_today();
$$;

-- 이번 주 월요일 ~ 오늘 (주간 TSS)
CREATE OR REPLACE FUNCTION public.fn_seoul_week_range()
RETURNS TABLE (week_start date, week_end date)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today date := public.fn_seoul_today();
  v_dow   integer;
  v_mon   date;
BEGIN
  v_dow := EXTRACT(ISODOW FROM v_today)::integer;
  IF v_dow = 7 THEN
    v_mon := v_today - 6;
  ELSE
    v_mon := v_today - (v_dow - 1);
  END IF;
  week_start := v_mon;
  week_end := v_today;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_normalize_gender(p text)
RETURNS public.gender_code
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN 'unknown'::public.gender_code
    WHEN lower(p) IN ('m', 'male', '남', '남성') THEN 'male'::public.gender_code
    WHEN lower(p) IN ('f', 'female', '여', '여성') THEN 'female'::public.gender_code
    ELSE 'unknown'::public.gender_code
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_age_category(u public.users)
RETURNS public.age_category
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN u.birth_year IS NULL THEN 'unknown'::public.age_category
    WHEN (EXTRACT(YEAR FROM public.fn_seoul_today())::int - u.birth_year) <= 39 THEN 'Bianco'::public.age_category
    WHEN (EXTRACT(YEAR FROM public.fn_seoul_today())::int - u.birth_year) <= 49 THEN 'Rosa'::public.age_category
    WHEN (EXTRACT(YEAR FROM public.fn_seoul_today())::int - u.birth_year) <= 59 THEN 'Infinito'::public.age_category
    ELSE 'Leggenda'::public.age_category
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_league_category(u public.users)
RETURNS public.league_category
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN u.challenge IN ('Elite', 'PRO') THEN 'Assoluto'::public.league_category
    ELSE public.fn_user_age_category(u)::text::public.league_category
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_is_cycling_ride(r public.rides)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN r.source <> 'strava' THEN true
    WHEN r.activity_type IS NULL OR btrim(r.activity_type) = '' THEN true
    ELSE lower(r.activity_type) NOT IN (
      'run', 'swim', 'walk', 'trailrun', 'weighttraining'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_effective_day_tss(d public.daily_summaries)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(d.tss_strava_sum, 0) > 0 THEN
      CASE WHEN d.tss_strava_sum >= 500 THEN 0::numeric ELSE d.tss_strava_sum END
    ELSE
      CASE WHEN COALESCE(d.tss_stelvio_sum, 0) >= 500 THEN 0::numeric ELSE COALESCE(d.tss_stelvio_sum, 0) END
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_effective_day_km(d public.daily_summaries)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(d.km_strava_sum, 0) > 0 THEN d.km_strava_sum
    ELSE COALESCE(d.km_stelvio_sum, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_peak_power(
  p_duration text,
  p_watts numeric,
  p_weight_kg numeric
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  wkg numeric;
  lim_wkg numeric;
  lim_watts numeric;
BEGIN
  IF p_weight_kg IS NULL OR p_weight_kg <= 0 OR p_watts IS NULL OR p_watts <= 0 THEN
    RETURN true;
  END IF;
  wkg := p_watts / p_weight_kg;
  CASE p_duration
    WHEN 'max'    THEN lim_wkg := 25.0; lim_watts := 2200;
    WHEN '1min'  THEN lim_wkg := 12.0; lim_watts := 900;
    WHEN '5min'  THEN lim_wkg := 8.0;  lim_watts := 700;
    WHEN '10min' THEN lim_wkg := 7.0;  lim_watts := 600;
    WHEN '20min' THEN lim_wkg := 6.5;  lim_watts := 550;
    WHEN '40min' THEN lim_wkg := 6.0;  lim_watts := 500;
    WHEN '60min' THEN lim_wkg := 5.8;  lim_watts := 450;
    ELSE RETURN true;
  END CASE;
  RETURN wkg <= lim_wkg AND p_watts <= lim_watts;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_calculate_speed_on_flat(p_power numeric, p_weight_kg numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rho constant numeric := 1.225;
  g constant numeric := 9.81;
  crr constant numeric := 0.0045;
  cda numeric;
  lo numeric := 0.1;
  hi numeric := 40;
  mid numeric;
  i integer;
  v_ms numeric;
  power_at_v numeric;
BEGIN
  IF p_power IS NULL OR p_power <= 0 OR p_weight_kg IS NULL OR p_weight_kg <= 0 THEN
    RETURN 0;
  END IF;
  cda := 0.328 + (p_weight_kg - 70) * 0.0012;
  cda := GREATEST(0.22, LEAST(0.42, cda));
  FOR i IN 1..55 LOOP
    mid := (lo + hi) / 2;
    v_ms := mid;
    power_at_v := 0.5 * rho * cda * v_ms * v_ms * v_ms + crr * p_weight_kg * g * v_ms;
    IF power_at_v < p_power THEN lo := mid; ELSE hi := mid; END IF;
  END LOOP;
  RETURN round((((lo + hi) / 2) * 3.6)::numeric, 1);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. daily_summaries 재합산 + user_ranking_metrics 갱신
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reconcile_daily_summary(
  p_user_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_used numeric;
  rec record;
  v_strava_tss numeric := 0;
  v_stelvio_tss numeric := 0;
  v_strava_km numeric := 0;
  v_stelvio_km numeric := 0;
  v_has_data boolean := false;
  agg record;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  w_used := CASE WHEN u.weight_kg > 0 THEN GREATEST(u.weight_kg, 45) ELSE NULL END;

  CREATE TEMP TABLE IF NOT EXISTS tmp_day_rides (
    source public.activity_source,
    tss numeric,
    km numeric,
    max_1min numeric, max_5min numeric, max_10min numeric,
    max_20min numeric, max_40min numeric, max_60min numeric, max_w numeric,
    hr_1min smallint, hr_5min smallint, hr_10min smallint,
    hr_20min smallint, hr_40min smallint, hr_60min smallint
  ) ON COMMIT DROP;
  TRUNCATE tmp_day_rides;

  FOR rec IN
    SELECT r.*
    FROM public.rides r
    WHERE r.user_id = p_user_id
      AND r.ride_date = p_date
      AND public.fn_is_cycling_ride(r)
  LOOP
    INSERT INTO tmp_day_rides VALUES (
      rec.source,
      COALESCE(rec.tss, 0),
      COALESCE(rec.distance_km, 0),
      COALESCE(rec.max_1min_watts, 0), COALESCE(rec.max_5min_watts, 0),
      COALESCE(rec.max_10min_watts, 0), COALESCE(rec.max_20min_watts, 0),
      COALESCE(rec.max_40min_watts, 0), COALESCE(rec.max_60min_watts, 0),
      COALESCE(rec.max_watts, 0),
      COALESCE(rec.max_hr_1min, 0), COALESCE(rec.max_hr_5min, 0),
      COALESCE(rec.max_hr_10min, 0), COALESCE(rec.max_hr_20min, 0),
      COALESCE(rec.max_hr_40min, 0), COALESCE(rec.max_hr_60min, 0)
    );
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM tmp_day_rides) THEN
    DELETE FROM public.daily_summaries
    WHERE user_id = p_user_id AND summary_date = p_date;
    PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
    RETURN;
  END IF;

  -- Strava 우선 일별 dedupe (동일 일자 strava 있으면 strava만)
  IF EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava') THEN
    SELECT
      COALESCE(SUM(tss), 0), COALESCE(SUM(km), 0),
      COALESCE(MAX(max_1min), 0), COALESCE(MAX(max_5min), 0),
      COALESCE(MAX(max_10min), 0), COALESCE(MAX(max_20min), 0),
      COALESCE(MAX(max_40min), 0), COALESCE(MAX(max_60min), 0),
      COALESCE(MAX(max_w), 0),
      COALESCE(MAX(hr_1min), 0), COALESCE(MAX(hr_5min), 0),
      COALESCE(MAX(hr_10min), 0), COALESCE(MAX(hr_20min), 0),
      COALESCE(MAX(hr_40min), 0), COALESCE(MAX(hr_60min), 0)
    INTO agg
    FROM tmp_day_rides WHERE source = 'strava';
  ELSE
    SELECT
      COALESCE(SUM(tss), 0), COALESCE(SUM(km), 0),
      COALESCE(MAX(max_1min), 0), COALESCE(MAX(max_5min), 0),
      COALESCE(MAX(max_10min), 0), COALESCE(MAX(max_20min), 0),
      COALESCE(MAX(max_40min), 0), COALESCE(MAX(max_60min), 0),
      COALESCE(MAX(max_w), 0),
      COALESCE(MAX(hr_1min), 0), COALESCE(MAX(hr_5min), 0),
      COALESCE(MAX(hr_10min), 0), COALESCE(MAX(hr_20min), 0),
      COALESCE(MAX(hr_40min), 0), COALESCE(MAX(hr_60min), 0)
    INTO agg
    FROM tmp_day_rides WHERE source <> 'strava';
  END IF;

  v_strava_tss := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava')
    THEN (SELECT COALESCE(SUM(tss), 0) FROM tmp_day_rides WHERE source = 'strava') ELSE 0 END;
  v_stelvio_tss := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'stelvio')
    THEN (SELECT COALESCE(SUM(tss), 0) FROM tmp_day_rides WHERE source = 'stelvio') ELSE 0 END;
  v_strava_km := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'strava')
    THEN (SELECT COALESCE(SUM(km), 0) FROM tmp_day_rides WHERE source = 'strava') ELSE 0 END;
  v_stelvio_km := CASE WHEN EXISTS (SELECT 1 FROM tmp_day_rides WHERE source = 'stelvio')
    THEN (SELECT COALESCE(SUM(km), 0) FROM tmp_day_rides WHERE source = 'stelvio') ELSE 0 END;

  v_has_data := (v_strava_tss + v_stelvio_tss + v_strava_km + v_stelvio_km) > 0
    OR agg.max_1min > 0 OR agg.max_60min > 0 OR agg.max_w > 0;

  IF NOT v_has_data THEN
    DELETE FROM public.daily_summaries WHERE user_id = p_user_id AND summary_date = p_date;
    PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
    RETURN;
  END IF;

  INSERT INTO public.daily_summaries (
    user_id, summary_date,
    tss_strava_sum, tss_stelvio_sum, km_strava_sum, km_stelvio_sum, weight_used_kg,
    max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts,
    max_40min_watts, max_60min_watts, max_watts,
    max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min,
    reconciled_at
  ) VALUES (
    p_user_id, p_date,
    round(v_strava_tss::numeric, 2), round(v_stelvio_tss::numeric, 2),
    round(v_strava_km::numeric, 3), round(v_stelvio_km::numeric, 3), w_used,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('1min', agg.max_1min, w_used) THEN agg.max_1min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('5min', agg.max_5min, w_used) THEN agg.max_5min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('10min', agg.max_10min, w_used) THEN agg.max_10min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('20min', agg.max_20min, w_used) THEN agg.max_20min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('40min', agg.max_40min, w_used) THEN agg.max_40min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('60min', agg.max_60min, w_used) THEN agg.max_60min ELSE 0 END,
    CASE WHEN w_used IS NOT NULL AND public.fn_validate_peak_power('max', agg.max_w, w_used) THEN agg.max_w ELSE 0 END,
    agg.hr_1min, agg.hr_5min, agg.hr_10min, agg.hr_20min, agg.hr_40min, agg.hr_60min,
    now()
  )
  ON CONFLICT (user_id, summary_date) DO UPDATE SET
    tss_strava_sum = EXCLUDED.tss_strava_sum,
    tss_stelvio_sum = EXCLUDED.tss_stelvio_sum,
    km_strava_sum = EXCLUDED.km_strava_sum,
    km_stelvio_sum = EXCLUDED.km_stelvio_sum,
    weight_used_kg = EXCLUDED.weight_used_kg,
    max_1min_watts = EXCLUDED.max_1min_watts,
    max_5min_watts = EXCLUDED.max_5min_watts,
    max_10min_watts = EXCLUDED.max_10min_watts,
    max_20min_watts = EXCLUDED.max_20min_watts,
    max_40min_watts = EXCLUDED.max_40min_watts,
    max_60min_watts = EXCLUDED.max_60min_watts,
    max_watts = EXCLUDED.max_watts,
    max_hr_1min = EXCLUDED.max_hr_1min,
    max_hr_5min = EXCLUDED.max_hr_5min,
    max_hr_10min = EXCLUDED.max_hr_10min,
    max_hr_20min = EXCLUDED.max_hr_20min,
    max_hr_40min = EXCLUDED.max_hr_40min,
    max_hr_60min = EXCLUDED.max_hr_60min,
    reconciled_at = now();

  PERFORM public.fn_refresh_user_ranking_metrics(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_user_ranking_metrics(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u public.users%ROWTYPE;
  w_kg numeric;
  r28 record;
  r30 record;
  rw record;
  v_weekly_tss numeric := 0;
  v_weekly_cheat boolean := false;
  v_dist_30 numeric := 0;
  v_peak60 numeric := 0;
  v_peak60_date date;
  v_speed numeric := 0;
  dur text;
  week_ranges date[];
  w_idx integer;
  w_start date;
  w_end date;
  week_max numeric;
  best_watts numeric;
  best_wkg numeric;
  v_1min numeric := 0; v_5min numeric := 0; v_10min numeric := 0;
  v_20min numeric := 0; v_40min numeric := 0; v_60min numeric := 0; v_max numeric := 0;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    DELETE FROM public.user_ranking_metrics WHERE user_id = p_user_id;
    RETURN;
  END IF;

  w_kg := CASE WHEN u.weight_kg > 0 THEN GREATEST(u.weight_kg, 45) ELSE NULL END;

  SELECT * INTO r28 FROM public.fn_seoul_rolling_range(28);
  SELECT * INTO r30 FROM public.fn_seoul_rolling_range(30);
  SELECT * INTO rw FROM public.fn_seoul_week_range();

  -- 주간 TSS
  SELECT
    COALESCE(SUM(public.fn_effective_day_tss(d)), 0),
    COALESCE(bool_or(
      (COALESCE(d.tss_strava_sum, 0) > 0 AND d.tss_strava_sum >= 500)
      OR (COALESCE(d.tss_strava_sum, 0) = 0 AND COALESCE(d.tss_stelvio_sum, 0) >= 500)
    ), false)
  INTO v_weekly_tss, v_weekly_cheat
  FROM public.daily_summaries d
  WHERE d.user_id = p_user_id
    AND d.summary_date BETWEEN rw.week_start AND rw.week_end;

  -- 30일 거리
  SELECT COALESCE(SUM(public.fn_effective_day_km(d)), 0)
  INTO v_dist_30
  FROM public.daily_summaries d
  WHERE d.user_id = p_user_id
    AND d.summary_date BETWEEN r30.start_date AND r30.end_date;

  -- 28일 4주×1피크 (피크 파워 W/kg)
  IF w_kg IS NOT NULL THEN
    week_ranges := ARRAY[
      r28.start_date,
      r28.start_date + 6,
      r28.start_date + 7,
      r28.start_date + 13,
      r28.start_date + 14,
      r28.start_date + 20,
      r28.start_date + 21,
      r28.end_date
    ];

    FOR dur IN SELECT unnest(ARRAY['1min','5min','10min','20min','40min','60min','max']) LOOP
      best_watts := 0;
      best_wkg := 0;
      FOR w_idx IN 0..3 LOOP
        w_start := week_ranges[w_idx * 2 + 1];
        w_end := week_ranges[w_idx * 2 + 2];
        week_max := 0;
        SELECT COALESCE(MAX(
          CASE dur
            WHEN '1min' THEN d.max_1min_watts
            WHEN '5min' THEN d.max_5min_watts
            WHEN '10min' THEN d.max_10min_watts
            WHEN '20min' THEN d.max_20min_watts
            WHEN '40min' THEN d.max_40min_watts
            WHEN '60min' THEN d.max_60min_watts
            WHEN 'max' THEN d.max_watts
          END
        ), 0)
        INTO week_max
        FROM public.daily_summaries d
        WHERE d.user_id = p_user_id
          AND d.summary_date BETWEEN w_start AND w_end
          AND public.fn_validate_peak_power(dur, CASE dur
            WHEN '1min' THEN d.max_1min_watts
            WHEN '5min' THEN d.max_5min_watts
            WHEN '10min' THEN d.max_10min_watts
            WHEN '20min' THEN d.max_20min_watts
            WHEN '40min' THEN d.max_40min_watts
            WHEN '60min' THEN d.max_60min_watts
            WHEN 'max' THEN d.max_watts
          END, w_kg);

        IF week_max > best_watts THEN
          best_watts := week_max;
          best_wkg := round((week_max / w_kg)::numeric, 2);
        END IF;
      END LOOP;

      CASE dur
        WHEN '1min' THEN v_1min := best_wkg;
        WHEN '5min' THEN v_5min := best_wkg;
        WHEN '10min' THEN v_10min := best_wkg;
        WHEN '20min' THEN v_20min := best_wkg;
        WHEN '40min' THEN v_40min := best_wkg;
        WHEN '60min' THEN v_60min := best_wkg;
        WHEN 'max' THEN v_max := best_wkg;
      END CASE;
    END LOOP;
  END IF;

  -- 28일 항속 (max_60min_watts 기반)
  IF w_kg IS NOT NULL AND u.weight_kg > 0 THEN
    SELECT d.max_60min_watts, d.summary_date
    INTO v_peak60, v_peak60_date
    FROM public.daily_summaries d
    WHERE d.user_id = p_user_id
      AND d.summary_date BETWEEN r28.start_date AND r28.end_date
      AND d.max_60min_watts > 0
      AND public.fn_validate_peak_power('60min', d.max_60min_watts, w_kg)
    ORDER BY d.max_60min_watts DESC, d.summary_date DESC
    LIMIT 1;

    IF v_peak60 > 0 THEN
      v_speed := public.fn_calculate_speed_on_flat(v_peak60, u.weight_kg);
    END IF;
  END IF;

  INSERT INTO public.user_ranking_metrics (
    user_id,
    peak_window_start, peak_window_end,
    peak_1min_wkg, peak_5min_wkg, peak_10min_wkg, peak_20min_wkg,
    peak_40min_wkg, peak_60min_wkg, peak_max_wkg,
    weekly_tss, week_start, week_end, weekly_has_cheat_day,
    distance_30d_km, dist_window_start, dist_window_end,
    speed_28d_kmh, speed_peak60_watts, speed_peak60_date,
    speed_window_start, speed_window_end,
    metrics_updated_at
  ) VALUES (
    p_user_id,
    r28.start_date, r28.end_date,
    v_1min, v_5min, v_10min, v_20min, v_40min, v_60min, v_max,
    round(v_weekly_tss::numeric, 2), rw.week_start, rw.week_end, v_weekly_cheat,
    round(v_dist_30::numeric, 3), r30.start_date, r30.end_date,
    v_speed, COALESCE(v_peak60, 0), v_peak60_date,
    r28.start_date, r28.end_date,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    peak_window_start = EXCLUDED.peak_window_start,
    peak_window_end = EXCLUDED.peak_window_end,
    peak_1min_wkg = EXCLUDED.peak_1min_wkg,
    peak_5min_wkg = EXCLUDED.peak_5min_wkg,
    peak_10min_wkg = EXCLUDED.peak_10min_wkg,
    peak_20min_wkg = EXCLUDED.peak_20min_wkg,
    peak_40min_wkg = EXCLUDED.peak_40min_wkg,
    peak_60min_wkg = EXCLUDED.peak_60min_wkg,
    peak_max_wkg = EXCLUDED.peak_max_wkg,
    weekly_tss = EXCLUDED.weekly_tss,
    week_start = EXCLUDED.week_start,
    week_end = EXCLUDED.week_end,
    weekly_has_cheat_day = EXCLUDED.weekly_has_cheat_day,
    distance_30d_km = EXCLUDED.distance_30d_km,
    dist_window_start = EXCLUDED.dist_window_start,
    dist_window_end = EXCLUDED.dist_window_end,
    speed_28d_kmh = EXCLUDED.speed_28d_kmh,
    speed_peak60_watts = EXCLUDED.speed_peak60_watts,
    speed_peak60_date = EXCLUDED.speed_peak60_date,
    speed_window_start = EXCLUDED.speed_window_start,
    speed_window_end = EXCLUDED.speed_window_end,
    metrics_updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rides_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date;
  dates date[] := ARRAY[]::date[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    dates := array_append(dates, OLD.ride_date);
  ELSE
    dates := array_append(dates, NEW.ride_date);
    IF TG_OP = 'UPDATE' AND OLD.ride_date IS DISTINCT FROM NEW.ride_date THEN
      dates := array_append(dates, OLD.ride_date);
    END IF;
  END IF;

  FOREACH d IN ARRAY dates LOOP
    PERFORM public.fn_reconcile_daily_summary(
      COALESCE(NEW.user_id, OLD.user_id),
      d
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rides_refresh_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.fn_rides_after_change();

-- -----------------------------------------------------------------------------
-- 5. MATERIALIZED VIEWS (랭킹·대시보드 <1s 조회)
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_user_public_profile AS
SELECT
  u.id,
  CASE WHEN u.is_private THEN '비공개'::text ELSE u.name END AS display_name,
  u.profile_image_url,
  u.gender,
  u.challenge,
  u.birth_year,
  public.fn_user_league_category(u) AS league_category,
  public.fn_user_age_category(u) AS age_category,
  u.is_private,
  u.grade
FROM public.users u
WHERE u.account_status = 'active';

CREATE MATERIALIZED VIEW public.mv_leaderboard_peak_28d AS
SELECT
  m.user_id,
  p.display_name,
  p.profile_image_url,
  p.gender,
  p.league_category,
  p.age_category,
  m.peak_window_start,
  m.peak_window_end,
  m.peak_1min_wkg,
  m.peak_5min_wkg,
  m.peak_10min_wkg,
  m.peak_20min_wkg,
  m.peak_40min_wkg,
  m.peak_60min_wkg,
  m.peak_max_wkg,
  m.metrics_updated_at
FROM public.user_ranking_metrics m
JOIN public.v_user_public_profile p ON p.id = m.user_id
WHERE (m.peak_60min_wkg > 0 OR m.peak_max_wkg > 0)
  AND p.is_private = false;

CREATE UNIQUE INDEX idx_mv_peak_28d_user ON public.mv_leaderboard_peak_28d (user_id);
CREATE INDEX idx_mv_peak_28d_60min ON public.mv_leaderboard_peak_28d (peak_60min_wkg DESC);
CREATE INDEX idx_mv_peak_28d_max ON public.mv_leaderboard_peak_28d (peak_max_wkg DESC);
CREATE INDEX idx_mv_peak_28d_gender_60 ON public.mv_leaderboard_peak_28d (gender, peak_60min_wkg DESC);
CREATE INDEX idx_mv_peak_28d_league_60 ON public.mv_leaderboard_peak_28d (league_category, peak_60min_wkg DESC);
CREATE INDEX idx_mv_peak_28d_gender_league_60 ON public.mv_leaderboard_peak_28d (gender, league_category, peak_60min_wkg DESC);

CREATE MATERIALIZED VIEW public.mv_leaderboard_weekly_tss AS
SELECT
  m.user_id,
  p.display_name,
  p.profile_image_url,
  p.gender,
  p.league_category,
  m.week_start,
  m.week_end,
  m.weekly_tss,
  m.weekly_has_cheat_day,
  m.metrics_updated_at
FROM public.user_ranking_metrics m
JOIN public.v_user_public_profile p ON p.id = m.user_id
WHERE m.weekly_tss > 0
  AND m.weekly_has_cheat_day = false
  AND p.is_private = false;

CREATE UNIQUE INDEX idx_mv_weekly_tss_user ON public.mv_leaderboard_weekly_tss (user_id);
CREATE INDEX idx_mv_weekly_tss_rank ON public.mv_leaderboard_weekly_tss (weekly_tss DESC);
CREATE INDEX idx_mv_weekly_tss_gender ON public.mv_leaderboard_weekly_tss (gender, weekly_tss DESC);

CREATE MATERIALIZED VIEW public.mv_leaderboard_distance_30d AS
SELECT
  m.user_id,
  p.display_name,
  p.profile_image_url,
  p.gender,
  p.league_category,
  m.dist_window_start,
  m.dist_window_end,
  m.distance_30d_km,
  m.metrics_updated_at
FROM public.user_ranking_metrics m
JOIN public.v_user_public_profile p ON p.id = m.user_id
WHERE m.distance_30d_km > 0
  AND p.is_private = false;

CREATE UNIQUE INDEX idx_mv_distance_30d_user ON public.mv_leaderboard_distance_30d (user_id);
CREATE INDEX idx_mv_distance_30d_rank ON public.mv_leaderboard_distance_30d (distance_30d_km DESC);
CREATE INDEX idx_mv_distance_30d_gender ON public.mv_leaderboard_distance_30d (gender, distance_30d_km DESC);

CREATE MATERIALIZED VIEW public.mv_leaderboard_speed_28d AS
SELECT
  m.user_id,
  p.display_name,
  p.profile_image_url,
  p.gender,
  p.league_category,
  m.speed_window_start,
  m.speed_window_end,
  m.speed_28d_kmh,
  m.speed_peak60_watts,
  m.speed_peak60_date,
  m.metrics_updated_at
FROM public.user_ranking_metrics m
JOIN public.v_user_public_profile p ON p.id = m.user_id
WHERE m.speed_28d_kmh > 0
  AND p.is_private = false;

CREATE UNIQUE INDEX idx_mv_speed_28d_user ON public.mv_leaderboard_speed_28d (user_id);
CREATE INDEX idx_mv_speed_28d_rank ON public.mv_leaderboard_speed_28d (speed_28d_kmh DESC);
CREATE INDEX idx_mv_speed_28d_gender ON public.mv_leaderboard_speed_28d (gender, speed_28d_kmh DESC);

CREATE OR REPLACE FUNCTION public.fn_refresh_ranking_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_peak_28d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_weekly_tss;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_distance_30d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_speed_28d;
END;
$$;

COMMENT ON FUNCTION public.fn_refresh_ranking_materialized_views IS
  'pg_cron 권장: */5 * * * * — rides 트리거는 user_ranking_metrics를 즉시 갱신, MV는 주기적 CONCURRENTLY refresh';

-- Auth 가입 시 public.users 프로필 행 자동 생성
CREATE OR REPLACE FUNCTION public.fn_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'display_name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ranking_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yearly_peaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_ride_participants ENABLE ROW LEVEL SECURITY;

-- 관리자 판별 (grade admin = Firestore '1')
CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND grade = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_is_sub_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND grade = 'sub_admin'
  );
$$;

-- users
CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.fn_is_admin() OR public.fn_is_sub_admin());

CREATE POLICY users_insert_own ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (id = auth.uid() OR public.fn_is_admin());

CREATE POLICY users_delete_admin ON public.users
  FOR DELETE TO authenticated
  USING (public.fn_is_admin());

-- strava_connections: 본인만
CREATE POLICY strava_select_own ON public.strava_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.fn_is_admin());

CREATE POLICY strava_write_own ON public.strava_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.fn_is_admin());

-- rides
CREATE POLICY rides_select_own ON public.rides
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin() OR public.fn_is_sub_admin());

CREATE POLICY rides_insert_own ON public.rides
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY rides_update_own ON public.rides
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.fn_is_admin());

CREATE POLICY rides_delete_own ON public.rides
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin());

-- daily_summaries
CREATE POLICY daily_summaries_select_own ON public.daily_summaries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin() OR public.fn_is_sub_admin());

CREATE POLICY daily_summaries_no_client_insert ON public.daily_summaries
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY daily_summaries_no_client_update ON public.daily_summaries
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY daily_summaries_no_client_delete ON public.daily_summaries
  FOR DELETE TO authenticated USING (false);

-- user_ranking_metrics: 랭킹용 공개 읽기, 클라이언트 직접 쓰기 금지(트리거만)
CREATE POLICY urm_select_authenticated ON public.user_ranking_metrics
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY urm_no_client_insert ON public.user_ranking_metrics
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY urm_no_client_update ON public.user_ranking_metrics
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY urm_no_client_delete ON public.user_ranking_metrics
  FOR DELETE TO authenticated USING (false);

-- yearly_peaks, point_history, user_orders
CREATE POLICY yearly_peaks_own ON public.yearly_peaks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin() OR public.fn_is_sub_admin());

CREATE POLICY yearly_peaks_no_write ON public.yearly_peaks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY point_history_own ON public.point_history
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin() OR public.fn_is_sub_admin());

CREATE POLICY point_history_insert_own ON public.point_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY user_orders_own ON public.user_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.fn_is_admin());

CREATE POLICY user_friends_own ON public.user_friends
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- processed_orders: 서버(service_role) 전용 — 클라이언트 차단
CREATE POLICY processed_orders_deny ON public.processed_orders
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- open_rides: 호스트 쓰기, 인증 사용자 읽기(상세 규칙은 앱에서 필터)
CREATE POLICY open_rides_read ON public.open_rides
  FOR SELECT TO authenticated USING (true);

CREATE POLICY open_rides_host_write ON public.open_rides
  FOR INSERT TO authenticated WITH CHECK (host_user_id = auth.uid());

CREATE POLICY open_rides_host_update ON public.open_rides
  FOR UPDATE TO authenticated
  USING (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

CREATE POLICY open_ride_participants_own ON public.open_ride_participants
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Materialized Views: 인증 사용자 전체 읽기 (민감정보 없음)
GRANT SELECT ON public.mv_leaderboard_peak_28d TO authenticated;
GRANT SELECT ON public.mv_leaderboard_weekly_tss TO authenticated;
GRANT SELECT ON public.mv_leaderboard_distance_30d TO authenticated;
GRANT SELECT ON public.mv_leaderboard_speed_28d TO authenticated;
GRANT SELECT ON public.v_user_public_profile TO authenticated;

-- service_role은 RLS 우회 (Edge Functions·Strava 동기화)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- -----------------------------------------------------------------------------
-- 7. 초기 MV 적재 (빈 DB에서도 구조 확정)
-- -----------------------------------------------------------------------------
SELECT public.fn_refresh_ranking_materialized_views();

-- =============================================================================
-- 운영 체크리스트
-- 1) Auth 가입 시: INSERT INTO users (id, name, ...) VALUES (auth.uid(), ...)
-- 2) Strava 동기화: service_role로 rides UPSERT → 트리거가 집계 자동 반영
-- 3) pg_cron (5분): SELECT public.fn_refresh_ranking_materialized_views();
-- 4) 랭킹 조회 예:
--    SELECT * FROM mv_leaderboard_weekly_tss ORDER BY weekly_tss DESC LIMIT 10;
--    SELECT * FROM mv_leaderboard_peak_28d
--      WHERE gender = 'male' AND league_category = 'Bianco'
--      ORDER BY peak_60min_wkg DESC LIMIT 50;
-- =============================================================================
