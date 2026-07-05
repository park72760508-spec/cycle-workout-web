-- VO₂ 연령·성별 인구통계 샘플 (Firestore vo2_demographic_samples 대체)
CREATE TABLE IF NOT EXISTS public.vo2_demographic_samples (
  firebase_uid        text PRIMARY KEY,
  user_id             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  gender_key          text NOT NULL CHECK (gender_key IN ('male', 'female')),
  age_bracket         text NOT NULL CHECK (
    age_bracket IN ('20-29', '30-39', '40-49', '50-59', '60+')
  ),
  avg_six_month_vo2   numeric(5, 1) NOT NULL CHECK (
    avg_six_month_vo2 >= 15 AND avg_six_month_vo2 <= 110
  ),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vo2_demographic_samples_gender_age
  ON public.vo2_demographic_samples (gender_key, age_bracket);

COMMENT ON TABLE public.vo2_demographic_samples IS
  '사용자별 최근 6개월 VO₂ 추정 평균 — stats_vo2_stelvio_rolling 집계 원천';

-- 서버(Cloud Functions service_role) 전용 — 클라이언트 anon/authenticated 직접 접근 차단
ALTER TABLE public.vo2_demographic_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY vo2_demographic_samples_deny_authenticated ON public.vo2_demographic_samples
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY vo2_demographic_samples_deny_anon ON public.vo2_demographic_samples
  FOR ALL TO anon USING (false) WITH CHECK (false);
