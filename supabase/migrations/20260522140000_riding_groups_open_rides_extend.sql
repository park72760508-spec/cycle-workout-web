-- 라이딩 모임(Riding Group) + 오픈 라이딩(Firestore rides) Strangler Fig 스키마 확장
-- Firestore: stelvio_riding_groups, rides/{id} → Supabase 1:1 매핑

-- -----------------------------------------------------------------------------
-- 1. ENUM
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.riding_group_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.riding_group_member_role AS ENUM ('owner', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. 소모임 (stelvio_riding_groups)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.riding_groups (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firestore_doc_id      text NOT NULL UNIQUE,
  name                  text NOT NULL,
  regions               text[] NOT NULL DEFAULT '{}',
  intro                 text NOT NULL DEFAULT '',
  is_public             boolean NOT NULL DEFAULT true,
  join_password         text NOT NULL DEFAULT '',
  photo_url             text,
  status                public.riding_group_status NOT NULL DEFAULT 'PENDING',
  created_by            uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  member_count          integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  ranking_notice        jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at           timestamptz,
  reviewed_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.riding_groups IS 'Firestore stelvio_riding_groups/{groupId}';
COMMENT ON COLUMN public.riding_groups.ranking_notice IS '{text, updatedAt, updatedBy} — 게시글/댓글 대신 그룹 공지';

CREATE INDEX IF NOT EXISTS idx_riding_groups_status_created
  ON public.riding_groups (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_riding_groups_created_by
  ON public.riding_groups (created_by);

CREATE TABLE IF NOT EXISTS public.riding_group_members (
  group_id              uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role                  public.riding_group_member_role NOT NULL DEFAULT 'member',
  display_name          text NOT NULL DEFAULT '',
  profile_image_url     text,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_riding_group_members_user
  ON public.riding_group_members (user_id);

CREATE TABLE IF NOT EXISTS public.riding_group_join_requests (
  group_id              uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name          text NOT NULL DEFAULT '',
  profile_image_url     text,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_riding_group_join_requests_group
  ON public.riding_group_join_requests (group_id, requested_at DESC);

-- -----------------------------------------------------------------------------
-- 3. 오픈 라이딩 (Firestore rides) — 누락 컬럼
-- -----------------------------------------------------------------------------
ALTER TABLE public.open_rides
  ADD COLUMN IF NOT EXISTS firestore_doc_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ride_join_password text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invited_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_display_by_phone jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_friend_uid_by_phone jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_joined_uid_by_phone jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_display jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_contact_public jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pack_riding_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS host_point_charge_sp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_point_charged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS host_point_refunded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS participant_join_charge_sp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_public_review_summary jsonb;

CREATE INDEX IF NOT EXISTS idx_open_rides_firestore_doc_id
  ON public.open_rides (firestore_doc_id)
  WHERE firestore_doc_id IS NOT NULL;

ALTER TABLE public.open_ride_participants
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_info text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_contact_public boolean NOT NULL DEFAULT false;

-- Strava 후기 서브컬렉션 (rides/{id}/participantStravaReview/{uid})
CREATE TABLE IF NOT EXISTS public.open_ride_strava_reviews (
  ride_id               uuid NOT NULL REFERENCES public.open_rides(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ride_date_ymd         text NOT NULL,
  distance_km           numeric(10,3) NOT NULL DEFAULT 0,
  source                text NOT NULL DEFAULT 'strava',
  synced_by             text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 4. updated_at 트리거
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_riding_groups_updated_at ON public.riding_groups;
CREATE TRIGGER trg_riding_groups_updated_at
  BEFORE UPDATE ON public.riding_groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.riding_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riding_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riding_group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_ride_strava_reviews ENABLE ROW LEVEL SECURITY;

-- riding_groups: 승인된 그룹은 인증 사용자 조회, 본인 생성·멤버십·관리자
DROP POLICY IF EXISTS riding_groups_read ON public.riding_groups;
CREATE POLICY riding_groups_read ON public.riding_groups
  FOR SELECT TO authenticated
  USING (
    status = 'APPROVED'
    OR created_by = auth.uid()
    OR public.fn_is_admin()
    OR public.fn_is_sub_admin()
    OR EXISTS (
      SELECT 1 FROM public.riding_group_members m
      WHERE m.group_id = id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS riding_groups_insert_own ON public.riding_groups;
CREATE POLICY riding_groups_insert_own ON public.riding_groups
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS riding_groups_update_owner ON public.riding_groups;
CREATE POLICY riding_groups_update_owner ON public.riding_groups
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.fn_is_admin()
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.fn_is_admin()
  );

-- members
DROP POLICY IF EXISTS riding_group_members_read ON public.riding_group_members;
CREATE POLICY riding_group_members_read ON public.riding_group_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.fn_is_admin()
    OR public.fn_is_sub_admin()
    OR EXISTS (
      SELECT 1 FROM public.riding_group_members m2
      WHERE m2.group_id = group_id AND m2.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS riding_group_members_write ON public.riding_group_members;
CREATE POLICY riding_group_members_write ON public.riding_group_members
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.fn_is_admin());

-- join requests
DROP POLICY IF EXISTS riding_group_join_requests_read ON public.riding_group_join_requests;
CREATE POLICY riding_group_join_requests_read ON public.riding_group_join_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.fn_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.riding_groups g
      WHERE g.id = group_id AND g.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS riding_group_join_requests_write ON public.riding_group_join_requests;
CREATE POLICY riding_group_join_requests_write ON public.riding_group_join_requests
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.fn_is_admin());

-- strava reviews
DROP POLICY IF EXISTS open_ride_strava_reviews_read ON public.open_ride_strava_reviews;
CREATE POLICY open_ride_strava_reviews_read ON public.open_ride_strava_reviews
  FOR SELECT TO authenticated
  USING (true);
