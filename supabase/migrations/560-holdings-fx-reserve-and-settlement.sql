-- ====================================================================================================
-- MIGRATION 560: COMPETEN HOLDINGS -- FX RESERVE LEDGER AND NET SETTLEMENT ON INDIVIDUAL CHECKOUTS
--
-- !! APPLY THIS FILE WHOLE. It contains a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- HOLDINGS-FX-01, owner direction 26 Oct 2026 (FX exposure and margin control, initially Scholar).
-- Production only on separate owner GO.
--
-- DEPENDS ON 399 (individual_checkout). It reads nothing else.
--
-- ----------------------------------------------------------------------------------------------------
-- TWO GAPS ONLY. Everything else the Unit Economics page needs already exists: the official reference rate
-- (ai_fx_rate, 410/412), provider prices and per-person AI cost (ai_price, ai_usage_ledger, plat_ai_requests),
-- plan prices and paid checkouts (individual_plan, individual_checkout, 399), and versioned configuration
-- (workspace_config_*, 076). This file adds what nothing records today:
--
--   1. On individual_checkout, the gateway fee and the net amount actually settled, as Flutterwave reports
--      them when a payment is verified. Nullable. A row without them was settled before capture existed,
--      and the page says "not recorded" for it rather than inventing a fee.
--   2. holdings_fx_event -- an APPEND-ONLY record of what Holdings really did with foreign currency:
--      an opening balance, a conversion (for example UGX sold and USD bought, which gives the ACTUAL
--      executed rate), a payment to a provider out of the reserve, or a void of an earlier entry. A mistake
--      is corrected by voiding the entry and recording the right one. Nothing here moves money. A person
--      records what the bank statement already shows.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. RLS on with no policy (service role only, HQ-plane data). Append-only trail keeps the cascade
-- path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/HOLDINGS-FX-01/ROLLBACK-560.sql
-- ====================================================================================================


-- ---- 1. NET SETTLEMENT ON INDIVIDUAL CHECKOUTS --------------------------------------------------------

alter table individual_checkout add column if not exists gateway_fee_minor bigint;
alter table individual_checkout add column if not exists net_settled_minor bigint;
alter table individual_checkout add column if not exists settlement_currency text;
alter table individual_checkout add column if not exists settlement_recorded_at timestamptz;

alter table individual_checkout drop constraint if exists individual_checkout_settlement_shape;
alter table individual_checkout add constraint individual_checkout_settlement_shape check (
  (gateway_fee_minor is null or gateway_fee_minor >= 0)
  and (net_settled_minor is null or net_settled_minor >= 0)
  and (settlement_currency is null or settlement_currency ~ '^[A-Z]{3}$')
  and ((gateway_fee_minor is null and net_settled_minor is null) or settlement_recorded_at is not null)
);

comment on column individual_checkout.gateway_fee_minor is
  'HOLDINGS-FX-01. The gateway fee Flutterwave reported at verification, in the minor unit of settlement_currency. Null = not recorded.';
comment on column individual_checkout.net_settled_minor is
  'HOLDINGS-FX-01. The amount Flutterwave reported as settled to Holdings after its fee. Null = not recorded.';


-- ---- 2. ONE REFUSAL FOR THE RESERVE LEDGER ------------------------------------------------------------

create or replace function public.holdings_fx_event_append_only() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception '% is append-only: void the entry and record a new one instead', tg_table_name;
end
$$;


-- ---- 3. THE RESERVE LEDGER ----------------------------------------------------------------------------

create table if not exists holdings_fx_event (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  kind text not null check (kind in ('opening_balance', 'conversion', 'provider_payment', 'void')),
  cost_pool text not null default 'scholar' check (cost_pool in ('scholar', 'professional', 'shared')),
  from_currency text check (from_currency ~ '^[A-Z]{3}$'),
  from_amount_minor bigint check (from_amount_minor > 0),
  to_currency text check (to_currency ~ '^[A-Z]{3}$'),
  to_amount_minor bigint check (to_amount_minor > 0),
  counterparty text,
  source_ref text not null check (length(btrim(source_ref)) >= 4),
  note text,
  voids_id uuid references holdings_fx_event(id) on delete cascade,
  recorded_by uuid not null,
  created_at timestamptz not null default now()
);

alter table holdings_fx_event drop constraint if exists holdings_fx_event_shape;
alter table holdings_fx_event add constraint holdings_fx_event_shape check (
  case kind
    when 'opening_balance' then from_currency is null and from_amount_minor is null
      and to_currency is not null and to_amount_minor is not null and voids_id is null
    when 'conversion' then from_currency is not null and from_amount_minor is not null
      and to_currency is not null and to_amount_minor is not null and from_currency <> to_currency and voids_id is null
    when 'provider_payment' then from_currency is not null and from_amount_minor is not null
      and to_currency is null and to_amount_minor is null and counterparty is not null and voids_id is null
    when 'void' then voids_id is not null and from_currency is null and from_amount_minor is null
      and to_currency is null and to_amount_minor is null
    else false
  end
);

-- One void per entry. A full unique index: rows that void nothing carry null, and nulls do not collide.
create unique index if not exists ux_holdings_fx_event_voids on holdings_fx_event(voids_id);
create index if not exists idx_holdings_fx_event_occurred on holdings_fx_event(occurred_at desc);

alter table holdings_fx_event enable row level security;

drop trigger if exists trg_holdings_fx_event_append_only on holdings_fx_event;
create trigger trg_holdings_fx_event_append_only
  before update or delete on holdings_fx_event
  for each row execute function public.holdings_fx_event_append_only();

comment on table holdings_fx_event is
  'HOLDINGS-FX-01. Append-only record of Holdings foreign-currency activity: opening balance, conversion (gives the actual executed rate), provider payment from reserve, void. Recorded by a person from the bank statement. Nothing here moves money. Service role only.';


notify pgrst, 'reload schema';
