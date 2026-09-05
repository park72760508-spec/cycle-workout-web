-- 중고랜드 신고하기(사기/부정거래 신고) 기능
-- 신고 3건 이상(신고자 기준 distinct) 누적 시 계정 자동 차단(신규 등록 금지 + 상품 열람 제한),
-- 철회로 3건 미만이 되면 자동 해제, 관리자는 별도로 강제 해제 가능.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS market_blocked boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.market_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.users(id),
  target_user_id uuid NOT NULL REFERENCES public.users(id),
  item_id uuid REFERENCES public.market_items(id),
  reason text NOT NULL CHECK (reason IN ('FRAUD_SUSPECTED', 'FAKE_ITEM', 'OTHER')),
  detail text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  CHECK (reporter_id <> target_user_id),
  CHECK (reason <> 'OTHER' OR (detail IS NOT NULL AND char_length(detail) BETWEEN 1 AND 30))
);

ALTER TABLE public.market_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_reports_select ON public.market_reports;
CREATE POLICY market_reports_select ON public.market_reports
  FOR SELECT TO authenticated USING (reporter_id = auth.uid() OR public.fn_is_admin());

GRANT SELECT ON public.market_reports TO authenticated;
GRANT ALL ON public.market_reports TO service_role;

-- 목록 배지 표시용: 다른 사용자 필드 노출 없이 차단된 user_id만 공개
DROP VIEW IF EXISTS public.market_blocked_sellers;
CREATE VIEW public.market_blocked_sellers AS
  SELECT id AS user_id FROM public.users WHERE market_blocked = true;

GRANT SELECT ON public.market_blocked_sellers TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_market_report(
  p_target_user_id uuid,
  p_item_id uuid,
  p_reason text,
  p_detail text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF v_uid = p_target_user_id THEN
    RAISE EXCEPTION 'CANNOT_REPORT_SELF';
  END IF;
  IF p_reason NOT IN ('FRAUD_SUSPECTED', 'FAKE_ITEM', 'OTHER') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;
  IF p_reason = 'OTHER' AND (p_detail IS NULL OR char_length(trim(p_detail)) NOT BETWEEN 1 AND 30) THEN
    RAISE EXCEPTION 'INVALID_DETAIL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.market_reports
    WHERE reporter_id = v_uid AND target_user_id = p_target_user_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ALREADY_REPORTED';
  END IF;

  INSERT INTO public.market_reports (reporter_id, target_user_id, item_id, reason, detail)
  VALUES (v_uid, p_target_user_id, p_item_id, p_reason, NULLIF(trim(p_detail), ''));

  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM public.market_reports
  WHERE target_user_id = p_target_user_id AND status = 'ACTIVE';

  IF v_count >= 3 THEN
    UPDATE public.users SET market_blocked = true WHERE id = p_target_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_market_report(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_market_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.market_reports%ROWTYPE;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.market_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND';
  END IF;
  IF v_row.reporter_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_PARTICIPANT';
  END IF;
  IF v_row.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE';
  END IF;

  UPDATE public.market_reports
  SET status = 'WITHDRAWN', withdrawn_at = now()
  WHERE id = p_report_id;

  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM public.market_reports
  WHERE target_user_id = v_row.target_user_id AND status = 'ACTIVE';

  IF v_count < 3 THEN
    UPDATE public.users SET market_blocked = false WHERE id = v_row.target_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_market_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_market_user_penalty(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  UPDATE public.users SET market_blocked = false WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_market_user_penalty(uuid) TO authenticated;

-- 신규 상품 등록 금지(차단된 사용자) — 기존 정책을 market_blocked 체크가 포함되도록 교체
DROP POLICY IF EXISTS market_items_insert ON public.market_items;
CREATE POLICY market_items_insert ON public.market_items
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND market_blocked = true
    )
  );
