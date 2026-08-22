-- 중고랜드(Market Land) — 상품, 관심상품, 안전결제(에스크로) 주문
-- open_rides와 동일한 RLS 컨벤션: authenticated 전체 조회, 소유자만 쓰기, 주문은 service_role만 쓰기.

CREATE TABLE IF NOT EXISTS public.market_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('CYCLE', 'RUN')),
  sub_category text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  condition text NOT NULL CHECK (condition IN ('신상품', '중고 상품')),
  deal_method text[] NOT NULL DEFAULT '{}',
  direct_deal_location text,
  description text NOT NULL DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  image_hashes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ON_SALE' CHECK (status IN ('ON_SALE', 'RESERVED', 'SOLD', 'HIDDEN')),
  bumped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_items_category_idx ON public.market_items (category, sub_category, status, bumped_at DESC);
CREATE INDEX IF NOT EXISTS market_items_user_idx ON public.market_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_items_image_hashes_idx ON public.market_items USING gin (image_hashes);

CREATE TABLE IF NOT EXISTS public.market_favorites (
  user_id uuid NOT NULL REFERENCES public.users(id),
  item_id uuid NOT NULL REFERENCES public.market_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.market_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.market_items(id),
  buyer_id uuid NOT NULL REFERENCES public.users(id),
  seller_id uuid NOT NULL REFERENCES public.users(id),
  toss_order_id text NOT NULL UNIQUE,
  toss_payment_key text,
  toss_virtual_account_secret text,
  item_price integer NOT NULL,
  fee integer NOT NULL DEFAULT 1000,
  amount integer NOT NULL,
  escrow_status text NOT NULL DEFAULT 'PENDING'
    CHECK (escrow_status IN ('PENDING', 'PAID', 'CONFIRMED', 'REFUNDED', 'CANCELLED')),
  settlement_account jsonb,
  settled_at timestamptz,
  paid_at timestamptz,
  settlement_transferred_at timestamptz,
  va_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_orders_buyer_idx ON public.market_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_orders_seller_idx ON public.market_orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_orders_item_idx ON public.market_orders (item_id);
CREATE INDEX IF NOT EXISTS market_orders_pending_due_idx
  ON public.market_orders (escrow_status, va_due_at)
  WHERE escrow_status = 'PENDING';

ALTER TABLE public.market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_orders ENABLE ROW LEVEL SECURITY;

-- market_items: 인증 사용자 전체 조회, 본인만 등록/수정/삭제(관리자는 삭제 가능)
CREATE POLICY market_items_read ON public.market_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY market_items_insert ON public.market_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY market_items_update ON public.market_items
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY market_items_delete ON public.market_items
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.fn_is_admin());

-- market_favorites: 본인 것만 조회/등록/삭제
CREATE POLICY market_favorites_own ON public.market_favorites
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- market_orders: 구매자·판매자만 조회. 결제(Toss 시크릿 키) 처리는 Cloud Functions(service_role)에서만 기록.
CREATE POLICY market_orders_read ON public.market_orders
  FOR SELECT TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid() OR public.fn_is_admin());

GRANT ALL ON public.market_items TO service_role;
GRANT ALL ON public.market_favorites TO service_role;
GRANT ALL ON public.market_orders TO service_role;

-- Storage: 상품 이미지 공개 버킷. 업로드는 본인 uid 폴더 하위에만 허용.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('market-images', 'market-images', true, 5242880)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY market_images_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'market-images');

CREATE POLICY market_images_own_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'market-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY market_images_own_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'market-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
