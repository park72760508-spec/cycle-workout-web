-- Firestore strava_webhook_retries 대체 — Strava Webhook 처리 실패 재시도 큐(백엔드 전용, 클라이언트 미접근).
-- docId 규칙(webhookRetryDocId: `${ownerId}_${objectId}`)을 그대로 id(PK)로 사용.

CREATE TABLE IF NOT EXISTS public.strava_webhook_retries (
  id             text PRIMARY KEY,
  owner_id       bigint,
  object_id      bigint,
  user_id        text,
  reason         text,
  status         integer,
  status_queue   text NOT NULL DEFAULT 'pending',
  error          text,
  failed_at      timestamptz,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.strava_webhook_retries IS
  'Firestore strava_webhook_retries 대체 — Strava Webhook 처리 실패 재시도 큐';

CREATE INDEX IF NOT EXISTS idx_strava_webhook_retries_status_queue
  ON public.strava_webhook_retries (status_queue);

CREATE INDEX IF NOT EXISTS idx_strava_webhook_retries_processed_at
  ON public.strava_webhook_retries (processed_at)
  WHERE status_queue = 'done';

ALTER TABLE public.strava_webhook_retries ENABLE ROW LEVEL SECURITY;

-- 클라이언트(anon/authenticated) 접근 없음 — service_role(Cloud Functions)만 전체 권한.
CREATE POLICY strava_webhook_retries_service_all ON public.strava_webhook_retries
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
