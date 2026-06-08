-- Phase 5: 실내 로그·포인트 — point_history Firestore 필드 정합
ALTER TABLE public.point_history
  ADD COLUMN IF NOT EXISTS points_used_for_subscription integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_threshold integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS extension_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extended_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_date_before date,
  ADD COLUMN IF NOT EXISTS expiry_date_after date,
  ADD COLUMN IF NOT EXISTS firebase_log_id text,
  ADD COLUMN IF NOT EXISTS client_mileage_from_stelvio_log boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_history_user_firebase_log
  ON public.point_history (user_id, firebase_log_id)
  WHERE firebase_log_id IS NOT NULL AND firebase_log_id <> '';
