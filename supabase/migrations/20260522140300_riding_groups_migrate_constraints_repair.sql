-- migrate:riding-groups ON CONFLICT 오류 복구
-- - riding_groups.id PK (구테이블 CREATE IF NOT EXISTS 스킵 시 누락)
-- - media_assets UNIQUE (CREATE IF NOT EXISTS 시 제약 누락)
-- - riding_group_members / join_requests 복합 PK
-- Supabase SQL Editor 또는 ensureRidingGroupsSchema.ts 로 실행

DO $$ BEGIN
  CREATE TYPE public.riding_group_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.riding_group_member_role AS ENUM ('owner', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.media_entity_type AS ENUM (
    'user_avatar', 'group_cover', 'open_ride_gpx',
    'open_ride_attachment', 'ranking_notice_attachment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.media_storage_provider AS ENUM ('firebase_storage', 'supabase_storage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- riding_groups: 컬럼 + PK
CREATE TABLE IF NOT EXISTS public.riding_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.riding_groups
  ADD COLUMN IF NOT EXISTS firestore_doc_id text,
  ADD COLUMN IF NOT EXISTS name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS regions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intro text DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS join_password text DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_storage_path text,
  ADD COLUMN IF NOT EXISTS cover_content_type text DEFAULT 'image/jpeg',
  ADD COLUMN IF NOT EXISTS member_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ranking_notice jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'riding_groups' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.riding_groups
      ADD COLUMN status public.riding_group_status NOT NULL DEFAULT 'PENDING';
  END IF;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'riding_groups' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.riding_groups
      ADD COLUMN created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'riding_groups' AND c.contype = 'p'
  ) THEN
    ALTER TABLE public.riding_groups ADD PRIMARY KEY (id);
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_riding_groups_firestore_doc_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_riding_groups_firestore_doc_id
  ON public.riding_groups (firestore_doc_id);

-- 구 스키마: created_by → user_profiles. 마이그레이션은 public.users(id) 기준
ALTER TABLE public.riding_groups DROP CONSTRAINT IF EXISTS riding_groups_created_by_fkey;
ALTER TABLE public.riding_groups
  ADD CONSTRAINT riding_groups_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.riding_groups DROP CONSTRAINT IF EXISTS riding_groups_reviewed_by_fkey;
ALTER TABLE public.riding_groups
  ADD CONSTRAINT riding_groups_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- members / join_requests (ON CONFLICT (group_id, user_id))
CREATE TABLE IF NOT EXISTS public.riding_group_members (
  group_id          uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role              public.riding_group_member_role NOT NULL DEFAULT 'member',
  display_name      text NOT NULL DEFAULT '',
  profile_image_url text,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.riding_group_join_requests (
  group_id          uuid NOT NULL REFERENCES public.riding_groups(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name      text NOT NULL DEFAULT '',
  profile_image_url text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'riding_group_members' AND relnamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'riding_group_members' AND c.contype = 'p'
     ) THEN
    ALTER TABLE public.riding_group_members ADD PRIMARY KEY (group_id, user_id);
  END IF;
EXCEPTION WHEN invalid_table_definition OR duplicate_object THEN
  RAISE NOTICE 'riding_group_members PK 수동 확인 필요: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'riding_group_join_requests' AND relnamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'riding_group_join_requests' AND c.contype = 'p'
     ) THEN
    ALTER TABLE public.riding_group_join_requests ADD PRIMARY KEY (group_id, user_id);
  END IF;
EXCEPTION WHEN invalid_table_definition OR duplicate_object THEN
  RAISE NOTICE 'riding_group_join_requests PK 수동 확인 필요: %', SQLERRM;
END $$;

ALTER TABLE public.riding_group_members DROP CONSTRAINT IF EXISTS riding_group_members_user_id_fkey;
ALTER TABLE public.riding_group_members
  ADD CONSTRAINT riding_group_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.riding_group_join_requests DROP CONSTRAINT IF EXISTS riding_group_join_requests_user_id_fkey;
ALTER TABLE public.riding_group_join_requests
  ADD CONSTRAINT riding_group_join_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- media_assets + UNIQUE (ON CONFLICT (entity_type, entity_id, storage_path))
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
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.media_assets'::regclass
      AND conname = 'media_assets_entity_path_unique'
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_entity_path_unique
      UNIQUE (entity_type, entity_id, storage_path);
  END IF;
END $$;

ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_owner_user_id_fkey;
ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- open_rides GPX 컬럼 (rides 이관 UPDATE용)
ALTER TABLE public.open_rides
  ADD COLUMN IF NOT EXISTS gpx_storage_path text,
  ADD COLUMN IF NOT EXISTS firestore_doc_id text;
