-- VERIFY 560 (read-only). Expected values in comments.
-- 1. Table with RLS and no policy. Expect: holdings_fx_event | t | 0
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname = 'holdings_fx_event';
-- 2. The four checkout columns. Expect 4 rows.
select column_name from information_schema.columns where table_name = 'individual_checkout'
  and column_name in ('gateway_fee_minor', 'net_settled_minor', 'settlement_currency', 'settlement_recorded_at') order by 1;
-- 3. Append-only trigger. Expect: trg_holdings_fx_event_append_only
select tgname from pg_trigger where tgrelid = 'holdings_fx_event'::regclass and not tgisinternal;
-- 4. Shape constraints. Expect 2 rows: holdings_fx_event_shape, individual_checkout_settlement_shape
select conname from pg_constraint where conname in ('holdings_fx_event_shape', 'individual_checkout_settlement_shape') order by 1;
-- 5. Ledger empty and no checkout carries a settlement yet. Expect: 0 | 0
select (select count(*) from holdings_fx_event) as entries,
       (select count(*) from individual_checkout where gateway_fee_minor is not null or net_settled_minor is not null) as settled;
