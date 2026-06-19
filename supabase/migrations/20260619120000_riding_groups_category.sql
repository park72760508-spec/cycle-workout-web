-- 클럽(소모임) 카테고리 — CYCLE / RUN (NULL·기존 데이터는 CYCLE)
ALTER TABLE public.riding_groups
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public.riding_groups
SET category = 'CYCLE'
WHERE category IS NULL OR btrim(category) = '';

ALTER TABLE public.riding_groups
  ALTER COLUMN category SET DEFAULT 'CYCLE';

COMMENT ON COLUMN public.riding_groups.category IS 'CYCLE | RUN — Firestore stelvio_riding_groups.category';

CREATE INDEX IF NOT EXISTS idx_riding_groups_category_status_created
  ON public.riding_groups (category, status, created_at DESC);
