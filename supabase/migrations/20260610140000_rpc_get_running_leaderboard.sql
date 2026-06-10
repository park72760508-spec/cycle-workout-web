-- 러닝 랭킹보드: 모든 연산·보간·JSON 조립은 PostgreSQL RPC 내부에서 처리
-- Firebase Functions는 get_running_leaderboard RPC thin wrapper만 호출

-- run_activity_efforts 스키마 보강 (기존 테이블에 updated_at/created_at 없을 수 있음)
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.run_activity_efforts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.run_activity_efforts
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'run_activity_efforts' AND column_name = 'updated_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_run_activity_efforts_updated_at
      ON public.run_activity_efforts (updated_at DESC);
  END IF;
END $$;

/** m/s → sec/km */
CREATE OR REPLACE FUNCTION public.fn_running_pace_sec_per_km(p_speed_mps double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_speed_mps IS NULL OR p_speed_mps <= 0 OR NOT isfinite(p_speed_mps::numeric) THEN NULL
    ELSE 1000.0 / p_speed_mps
  END;
$$;

/** 선형 보간 0~100점: ((초보초 - 유저초) / (초보초 - 엘리트초)) * 100 */
CREATE OR REPLACE FUNCTION public.fn_running_segment_score(
  p_pace_sec double precision,
  p_elite_sec integer,
  p_novice_sec integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_pace_sec IS NULL OR p_pace_sec <= 0 OR NOT isfinite(p_pace_sec::numeric) THEN NULL
    WHEN p_elite_sec IS NULL OR p_novice_sec IS NULL OR p_elite_sec >= p_novice_sec THEN NULL
    ELSE ROUND(
      GREATEST(
        0::numeric,
        LEAST(
          100::numeric,
          ((p_novice_sec - p_pace_sec) / (p_novice_sec - p_elite_sec)::double precision) * 100.0
        )
      ),
      1
    )
  END;
$$;

/** 페이스 초 → M:SS 문자열 */
CREATE OR REPLACE FUNCTION public.fn_format_running_pace_mmss(p_pace_sec double precision)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_pace_sec IS NULL OR p_pace_sec <= 0 OR NOT isfinite(p_pace_sec::numeric) THEN NULL
    ELSE format(
      '%s:%s',
      floor(p_pace_sec / 60.0)::bigint,
      lpad(floor(round(p_pace_sec)::bigint % 60)::text, 2, '0')
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_running_leaderboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT r.*
    FROM public.run_activity_efforts r
    LEFT JOIN public.activities a
      ON a.user_id = r.user_id AND a.activity_id = r.activity_id
    WHERE COALESCE(
      a.activity_date,
      (COALESCE(r.updated_at, r.created_at, now()) AT TIME ZONE 'Asia/Seoul')::date
    ) >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '30 days')::date
  ),
  best_1k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_1k AS speed, f.hr_1k AS hr
    FROM filtered f
    WHERE f.speed_1k IS NOT NULL AND f.speed_1k > 0
    ORDER BY f.user_id, f.speed_1k DESC
  ),
  best_5k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_5k AS speed, f.hr_5k AS hr
    FROM filtered f
    WHERE f.speed_5k IS NOT NULL AND f.speed_5k > 0
    ORDER BY f.user_id, f.speed_5k DESC
  ),
  best_10k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_10k AS speed, f.hr_10k AS hr
    FROM filtered f
    WHERE f.speed_10k IS NOT NULL AND f.speed_10k > 0
    ORDER BY f.user_id, f.speed_10k DESC
  ),
  best_15k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_15k AS speed, f.hr_15k AS hr
    FROM filtered f
    WHERE f.speed_15k IS NOT NULL AND f.speed_15k > 0
    ORDER BY f.user_id, f.speed_15k DESC
  ),
  best_20k AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.activity_id, f.speed_20k AS speed, f.hr_20k AS hr
    FROM filtered f
    WHERE f.speed_20k IS NOT NULL AND f.speed_20k > 0
    ORDER BY f.user_id, f.speed_20k DESC
  ),
  all_users AS (
    SELECT user_id FROM best_1k
    UNION SELECT user_id FROM best_5k
    UNION SELECT user_id FROM best_10k
    UNION SELECT user_id FROM best_15k
    UNION SELECT user_id FROM best_20k
  ),
  scored AS (
    SELECT
      u.user_id,
      b1.speed AS speed_1k, b1.hr AS hr_1k,
      b5.speed AS speed_5k, b5.hr AS hr_5k,
      b10.speed AS speed_10k, b10.hr AS hr_10k,
      b15.speed AS speed_15k, b15.hr AS hr_15k,
      b20.speed AS speed_20k, b20.hr AS hr_20k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b1.speed), 180, 420) AS score_1k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b5.speed), 210, 480) AS score_5k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b10.speed), 240, 510) AS score_10k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b15.speed), 270, 540) AS score_15k,
      public.fn_running_segment_score(public.fn_running_pace_sec_per_km(b20.speed), 300, 570) AS score_20k
    FROM all_users u
    LEFT JOIN best_1k b1 ON b1.user_id = u.user_id
    LEFT JOIN best_5k b5 ON b5.user_id = u.user_id
    LEFT JOIN best_10k b10 ON b10.user_id = u.user_id
    LEFT JOIN best_15k b15 ON b15.user_id = u.user_id
    LEFT JOIN best_20k b20 ON b20.user_id = u.user_id
  ),
  with_total AS (
    SELECT
      s.*,
      ROUND(
        (
          COALESCE(s.score_1k, 0)
          + COALESCE(s.score_5k, 0)
          + COALESCE(s.score_10k, 0)
          + COALESCE(s.score_15k, 0)
          + COALESCE(s.score_20k, 0)
        ) / NULLIF(
          (CASE WHEN s.score_1k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_5k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_10k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_15k IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN s.score_20k IS NOT NULL THEN 1 ELSE 0 END),
          0
        )::numeric,
        1
      ) AS total_score
    FROM scored s
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_info', jsonb_build_object(
          'user_id', w.user_id,
          'display_name', p.display_name,
          'profile_image_url', p.profile_image_url,
          'gender', p.gender::text,
          'league_category', p.league_category::text,
          'age_category', p.age_category::text,
          'is_private', p.is_private
        ),
        'total_score', w.total_score,
        'segment_scores', jsonb_build_object(
          '1k', w.score_1k,
          '5k', w.score_5k,
          '10k', w.score_10k,
          '15k', w.score_15k,
          '20k', w.score_20k
        ),
        'peak_performances', jsonb_build_object(
          '1k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_1k)),
            'hr', w.hr_1k
          ),
          '5k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_5k)),
            'hr', w.hr_5k
          ),
          '10k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_10k)),
            'hr', w.hr_10k
          ),
          '15k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_15k)),
            'hr', w.hr_15k
          ),
          '20k', jsonb_build_object(
            'pace', public.fn_format_running_pace_mmss(public.fn_running_pace_sec_per_km(w.speed_20k)),
            'hr', w.hr_20k
          )
        )
      )
      ORDER BY w.total_score DESC NULLS LAST, w.user_id
    ),
    '[]'::jsonb
  )
  FROM with_total w
  JOIN public.v_user_public_profile p ON p.id = w.user_id
  WHERE p.is_private = false;
$$;

COMMENT ON FUNCTION public.get_running_leaderboard() IS
  '최근 30일 run_activity_efforts 구간별 독립 피크 → 페이스·보간 점수 → JSON 랭킹 (total_score DESC)';

GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_running_leaderboard() TO service_role;
