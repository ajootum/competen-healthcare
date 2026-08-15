-- ====================================================================================================
-- 304  FACILITY SETTLEMENTS, PHASE 2  (CPR-PAY-001 s10/s23, CPR-PAY-002 s20)
-- ====================================================================================================
--
-- >>> APPLY THIS FILE WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 5 contains trigger functions with internal semicolons inside $$ ... $$, the 195/303 shape.
-- Everything before it is plain statements. If section 5 fails to apply, the tables are still correct
-- and the billing harness asserts the guards by name, so an absence is visible.
--
-- WHAT THIS IS
--   The other half of the collected-is-not-received rule. Migration 303's collector column records
--   WHO took the money. These three tables record the journey of the facility-collected part into the
--   practitioner's hands: what share is theirs (entitlement), what the facility actually transferred
--   (settlement), and which collected payments that transfer answers for (reconciliation items).
--
-- THE ENTITLEMENT IS INTEGER BASIS POINTS, NEVER A FLOAT PERCENT. percent_bp 6000 means the
--   practitioner keeps 60 of every 100 collected. Basis points keep the arithmetic exact under s20's
--   no-floating-point rule, and the SHARE somebody agreed with a hospital is an INPUT the practitioner
--   configures -- like a fee -- not a computed rate, so the standing no-rates display rule is not in
--   tension: screens show amounts, and may show the practitioner their own configured term.
--
-- DELIBERATELY ABSENT, AND WHY
--   outstanding_minor            derived: entitlement over unsettled facility-collected payments minus
--                                nothing, computed at read. A stored receivable is the editable-balance
--                                mistake wearing Phase 2 clothes.
--   a settlement-statement table the STATEMENT (PAY-002 s20) is a period summary rendered from these
--                                rows, like the patient statement. The settlement RECEIPT is the
--                                snapshot column on the settlement row, frozen by the guard -- the
--                                303 fold-in pattern, not a fourth document store.
--   a discrepancy column         a discrepancy IS the derived difference between the items' entitlement
--                                and received_minor. The note column carries the flag in words, and
--                                nothing forces the two to agree -- s10's "do not silently force
--                                reconciliation" is satisfied by the difference remaining visible.
--   settlement void/status       a settlement is money that arrived, recorded after the fact. A wrong
--                                one is corrected by a practice_billing_adjustment row (kind
--                                correction), the 303 vocabulary, never by editing or deleting.
--   new capabilities             none. Recording a settlement is recording money that changed hands
--                                (payment.record) and configuring an entitlement is configuring a
--                                commercial term (fee.manage). Seeding a code for a verb an existing
--                                code already describes is how vocabularies bloat (the 247 doctrine).
--   DELETE triggers              the 202/247 lesson still: guards are UPDATE-only so workspace erasure
--                                and harness cleanup keep working.
--
-- ONE PAYMENT SETTLES ONCE. ux_practice_settlement_item_payment is a FULL unique index on payment_id:
--   a collected payment reconciled into one settlement can never be claimed again by another. Partial
--   settlement of a PERIOD is normal (fewer items, more settlements later) but partial settlement of one
--   payment is not a thing this model expresses, deliberately.
--
-- THE COUNTER CHECK IS WIDENED BY ITS LIVE NAME. Settlement acknowledgements are numbered
--   CP-SET-YYYY-NNNNN through 303's allocator, and the doc_kind CHECK named
--   practice_billing_number_counter_doc_kind_check (read off a live refusal, not assumed) gains the
--   third kind.
-- ====================================================================================================

-- ---- 1. THE ENTITLEMENT RULE -- s10 "practitioner share, rule preserved" ------------------------------
--
-- One rule per location. The rule at settlement time is SNAPSHOTTED onto each reconciled item, so
-- editing the rule never rewrites what was already settled.

create table if not exists practice_facility_entitlement (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid not null references practice_location(id) on delete cascade,
  kind text not null default 'percent',
  percent_bp integer,
  fixed_minor bigint,
  currency text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_facility_entitlement drop constraint if exists practice_fac_ent_kind_check;
alter table practice_facility_entitlement add constraint practice_fac_ent_kind_check
  check (kind in ('percent', 'fixed_per_payment', 'manual'));
alter table practice_facility_entitlement drop constraint if exists practice_fac_ent_percent_check;
alter table practice_facility_entitlement add constraint practice_fac_ent_percent_check
  check (percent_bp is null or (percent_bp >= 0 and percent_bp <= 10000));
alter table practice_facility_entitlement drop constraint if exists practice_fac_ent_fixed_check;
alter table practice_facility_entitlement add constraint practice_fac_ent_fixed_check
  check (fixed_minor is null or fixed_minor >= 0);
alter table practice_facility_entitlement drop constraint if exists practice_fac_ent_currency_check;
alter table practice_facility_entitlement add constraint practice_fac_ent_currency_check
  check (currency is null or currency ~ '^[A-Z]{3}$');
-- The kind names which figure it needs.
alter table practice_facility_entitlement drop constraint if exists practice_fac_ent_shape_check;
alter table practice_facility_entitlement add constraint practice_fac_ent_shape_check
  check (
    (kind = 'percent' and percent_bp is not null)
    or (kind = 'fixed_per_payment' and fixed_minor is not null)
    or (kind = 'manual')
  );

create unique index if not exists ux_practice_fac_ent_location
  on practice_facility_entitlement (workspace_id, location_id);

alter table practice_facility_entitlement enable row level security;

-- ---- 2. THE SETTLEMENT -- money that actually arrived from a facility --------------------------------

create table if not exists practice_settlement (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid not null references practice_location(id) on delete cascade,
  settlement_number text not null,
  period_from date not null,
  period_to date not null,
  currency text not null,
  received_minor bigint not null,
  received_on date not null,
  method text,
  reference text,
  note text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_settlement drop constraint if exists practice_settlement_number_check;
alter table practice_settlement add constraint practice_settlement_number_check
  check (settlement_number ~ '^CP-SET-[0-9]{4}-[0-9]{5,7}$');
alter table practice_settlement drop constraint if exists practice_settlement_period_check;
alter table practice_settlement add constraint practice_settlement_period_check
  check (period_to >= period_from);
alter table practice_settlement drop constraint if exists practice_settlement_amount_check;
alter table practice_settlement add constraint practice_settlement_amount_check
  check (received_minor > 0);
alter table practice_settlement drop constraint if exists practice_settlement_currency_check;
alter table practice_settlement add constraint practice_settlement_currency_check
  check (currency ~ '^[A-Z]{3}$');
alter table practice_settlement drop constraint if exists practice_settlement_method_check;
alter table practice_settlement add constraint practice_settlement_method_check
  check (method is null or method in ('cash', 'mobile_money', 'card', 'bank_transfer', 'other'));

create unique index if not exists ux_practice_settlement_number
  on practice_settlement (workspace_id, settlement_number);
create index if not exists idx_practice_settlement_location
  on practice_settlement (workspace_id, location_id, received_on desc);

alter table practice_settlement enable row level security;

-- ---- 3. RECONCILIATION ITEMS -- which collected payments this settlement answers for ------------------

create table if not exists practice_settlement_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  settlement_id uuid not null references practice_settlement(id) on delete cascade,
  payment_id uuid not null references practice_payment(id) on delete cascade,
  collected_minor bigint not null,
  entitlement_minor bigint not null,
  entitlement_rule_snapshot jsonb,
  created_at timestamptz not null default now()
);

alter table practice_settlement_item drop constraint if exists practice_settlement_item_amounts_check;
alter table practice_settlement_item add constraint practice_settlement_item_amounts_check
  check (collected_minor > 0 and entitlement_minor >= 0 and entitlement_minor <= collected_minor);

create unique index if not exists ux_practice_settlement_item_payment
  on practice_settlement_item (payment_id);
create index if not exists idx_practice_settlement_item_settlement
  on practice_settlement_item (settlement_id);

alter table practice_settlement_item enable row level security;

-- ---- 4. THE COUNTER LEARNS THE THIRD KIND -------------------------------------------------------------

alter table practice_billing_number_counter drop constraint if exists practice_billing_number_counter_doc_kind_check;
alter table practice_billing_number_counter add constraint practice_billing_number_counter_doc_kind_check
  check (doc_kind in ('invoice', 'receipt', 'settlement'));

-- ---- 5. THE UPDATE GUARDS (plpgsql -- the reason for the banner) --------------------------------------

create or replace function practice_settlement_frozen_guard()
returns trigger
language plpgsql
as $$
begin
  if new.settlement_number is distinct from old.settlement_number
    or new.location_id is distinct from old.location_id
    or new.period_from is distinct from old.period_from
    or new.period_to is distinct from old.period_to
    or new.currency is distinct from old.currency
    or new.received_minor is distinct from old.received_minor
    or new.received_on is distinct from old.received_on
    or new.method is distinct from old.method
    or new.reference is distinct from old.reference
    or new.snapshot is distinct from old.snapshot
  then
    raise exception 'settlement % records money that arrived; corrections are adjustment rows, never edits', old.settlement_number;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_practice_settlement_frozen on practice_settlement;
create trigger trg_practice_settlement_frozen
  before update on practice_settlement
  for each row execute function practice_settlement_frozen_guard();

create or replace function practice_settlement_item_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'settlement reconciliation is a recorded fact; unpicking it needs a correction, not an edit';
end;
$$;
drop trigger if exists trg_practice_settlement_item_immutable on practice_settlement_item;
create trigger trg_practice_settlement_item_immutable
  before update on practice_settlement_item
  for each row execute function practice_settlement_item_immutable();

notify pgrst, 'reload schema';
