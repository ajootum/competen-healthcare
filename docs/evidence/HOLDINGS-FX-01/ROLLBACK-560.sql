-- ROLLBACK 560 (staging). Refuses while the reserve ledger holds any entry or any checkout carries a recorded settlement.
do $$
begin
  if to_regclass('public.holdings_fx_event') is not null and exists (select 1 from holdings_fx_event) then
    raise exception 'holdings_fx_event has entries: rollback refused';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'individual_checkout' and column_name = 'gateway_fee_minor')
     and exists (select 1 from individual_checkout where gateway_fee_minor is not null or net_settled_minor is not null) then
    raise exception 'individual_checkout carries recorded settlements: rollback refused';
  end if;
end
$$;

drop table if exists holdings_fx_event;
drop function if exists public.holdings_fx_event_append_only();
alter table individual_checkout drop constraint if exists individual_checkout_settlement_shape;
alter table individual_checkout drop column if exists settlement_recorded_at;
alter table individual_checkout drop column if exists settlement_currency;
alter table individual_checkout drop column if exists net_settled_minor;
alter table individual_checkout drop column if exists gateway_fee_minor;

notify pgrst, 'reload schema';
