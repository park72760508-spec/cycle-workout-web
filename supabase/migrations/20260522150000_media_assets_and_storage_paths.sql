-- Firebase Storage URL·경로 완전 대응 (아바타, 소모임 커버, GPX, 첨부)
-- public_url = Firebase getDownloadURL / Supabase Storage signed URL

DO $$ BEGIN
  CREATE TYPE public.media_entity_type AS ENUM (
    'user_avatar',
    'group_cover',
    'open_ride_gpx',
    'open_ride_attachment',
    'ranking_notice_attachment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.media_storage_provider AS ENUM ('firebase_storage', 'supabase_storage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.media_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type           public.media_entity_type NOT NULL,
  entity_id             text NOT NULL,
  owner_user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  storage_provider      public.media_storage_provider NOT NULL DEFAULT 'firebase_storage',
  storage_bucket        text,
  storage_path          text NOT NULL,
  public_url            text NOT NULL,
  content_type          text,
  byte_size             bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  firestore_doc_path    text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_entity_path_unique UNIQUE (entity_type, entity_id, storage_path)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'media_assets' AND relnamespace = 'public'::regnamespace
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.media_assets'::regclass
      AND conname = 'media_assets_entity_path_unique'
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_entity_path_unique
      UNIQUE (entity_type, entity_id, storage_path);
  END IF;
END $$;

COMMENT ON TABLE public.media_assets IS
  'Firebase/Supabase Storage 메타 — 아바타·GPX·소모임 커버·첨부. public_url은 UI 표시용.';

CREATE INDEX IF NOT EXISTS idx_media_assets_entity
  ON public.media_assets (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner
  ON public.media_assets (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_public_url
  ON public.media_assets (public_url)
  WHERE public_url IS NOT NULL AND public_url <> '';

-- users: Firebase profileImageUrl 동기화용 (이미 profile_image_url 존재)
COMMENT ON COLUMN public.users.profile_image_url IS
  'Firebase users.profileImageUrl / Storage 아바타 download URL';

-- open_rides: GPX·Storage 경로
ALTER TABLE public.open_rides
  ADD COLUMN IF NOT EXISTS gpx_storage_path text,
  ADD COLUMN IF NOT EXISTS gpx_content_type text DEFAULT 'application/gpx+xml',
  ADD COLUMN IF NOT EXISTS cover_photo_url text;

COMMENT ON COLUMN public.open_rides.gpx_url IS 'Firebase Storage GPX download URL';
COMMENT ON COLUMN public.open_rides.gpx_storage_path IS '예: rides/{rideId}/course.gpx';

-- riding_groups: 커버 이미지 Storage 경로
ALTER TABLE public.riding_groups
  ADD COLUMN IF NOT EXISTS photo_storage_path text,
  ADD COLUMN IF NOT EXISTS cover_content_type text DEFAULT 'image/jpeg';

COMMENT ON COLUMN public.riding_groups.photo_url IS 'Firebase Storage cover download URL';
COMMENT ON COLUMN public.riding_groups.photo_storage_path IS '예: stelvio_riding_groups/{groupId}/cover_*.jpg';

-- 멤버·가입신청 아바타 (Firestore members.profileImageUrl)
COMMENT ON COLUMN public.riding_group_members.profile_image_url IS
  '가입 시점 스냅샷 — Firebase Storage 또는 users.profile_image_url';
COMMENT ON COLUMN public.riding_group_join_requests.profile_image_url IS
  '신청 시점 프로필 이미지 URL';

DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON public.media_assets;
CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_assets_read ON public.media_assets;
CREATE POLICY media_assets_read ON public.media_assets
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS media_assets_write_own ON public.media_assets;
CREATE POLICY media_assets_write_own ON public.media_assets
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() OR public.fn_is_admin());

DROP POLICY IF EXISTS media_assets_update_own ON public.media_assets;
CREATE POLICY media_assets_update_own ON public.media_assets
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() OR public.fn_is_admin())
  WITH CHECK (owner_user_id = auth.uid() OR public.fn_is_admin());
