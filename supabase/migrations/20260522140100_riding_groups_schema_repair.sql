-- riding_groups 스키마 복구 (20260522140000 중단·구버전 테이블 존재 시)
-- Supabase SQL Editor에서 이 파일만 다시 실행해도 됩니다.

DO $$ BEGIN
  CREATE TYPE public.riding_group_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.riding_group_member_role AS ENUM ('owner', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
    SELECT 1 FROM pg_constraint c
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

COMMENT ON TABLE public.riding_groups IS 'Firestore stelvio_riding_groups/{groupId}';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'riding_groups'
ORDER BY ordinal_position;
