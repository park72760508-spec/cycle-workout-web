-- 2026-10-09: Cloud Functions cancelUnpaidMarketOrdersSchedule(15분마다, Cloud Scheduler+Cloud Run) → pg_cron 이관.
-- 로직 동일: 입금기한(va_due_at) 지난 PENDING 주문 → CANCELLED, RESERVED 상품 → ON_SALE.
create or replace function public.cancel_unpaid_market_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    update public.market_orders
       set escrow_status = 'CANCELLED', updated_at = now()
     where escrow_status = 'PENDING' and va_due_at < now()
    returning id, item_id
  loop
    n := n + 1;
    update public.market_items
       set status = 'ON_SALE', updated_at = now()
     where id = r.item_id and status = 'RESERVED';
  end loop;
  return n;
end;
$$;
revoke all on function public.cancel_unpaid_market_orders() from public, anon, authenticated;

select cron.schedule('market-cancel-unpaid-orders', '*/15 * * * *', $$ SELECT public.cancel_unpaid_market_orders(); $$);
