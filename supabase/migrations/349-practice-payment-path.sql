-- 349 THE PRACTICE PAYMENT PATH (Flutterwave, mobile money first)
--
-- Until this migration Competen Practice could not take money. practice_plans held
-- plan_code, name, trial_days, active and no price, so every workspace sat on the
-- practice_trial entitlement with nothing to convert into. pd-metric-registry says
-- so in its own words: "There is no paid state to convert INTO".
--
-- WHAT THIS ADDS, and why each piece is separate rather than one table:
--
--   practice_plans          gains a price. A plan with no price stays a free plan.
--   practice_checkout       ONE ROW PER ATTEMPT, written BEFORE the practitioner
--                           leaves for the gateway. It records what WE decided to
--                           charge. The webhook later compares the provider answer
--                           against this row rather than believing it.
--   practice_checkout_event EVERY webhook receipt. Its unique constraint IS the
--                           idempotency guard. Gateways retry, and a retry that
--                           extended a subscription twice would be a silent gift.
--   practice_subscription   the durable paid state an entitlement can point at.
--
-- ON NAMING. practice_invoice / practice_payment / practice_billing_* ALREADY EXIST
-- and are the PRACTITIONER BILLING THEIR PATIENTS (the CPR-PAY arc). Nothing here
-- touches them. These are the other direction: Competen billing the practitioner.
-- Two different money flows, deliberately not sharing a table.
--
-- ONE SUBSCRIPTION ROW PER WORKSPACE, enforced by a PLAIN unique index. The first
-- draft used a partial unique index over the live statuses and the house-rules
-- checker refused it: a partial unique index is the silent-write trap recorded on
-- this database. Lifecycle therefore lives in the STATUS COLUMN of a single row,
-- and the audit trail of attempts lives in practice_checkout, where it belongs.

-- 1. Plans can carry a price
alter table practice_plans add column if not exists amount_minor bigint;
alter table practice_plans add column if not exists currency text;
alter table practice_plans add column if not exists interval_unit text;

-- Drop-then-add rather than a DO block: the runner splits on semicolons and this
-- database has no plpgsql. Both statements are safe to re-run.
alter table practice_plans drop constraint if exists practice_plans_price_complete;
alter table practice_plans add constraint practice_plans_price_complete check (
  (amount_minor is null and currency is null and interval_unit is null)
  or (amount_minor is not null and amount_minor > 0 and currency is not null and interval_unit in ('month', 'year'))
);

-- 2. Checkout attempts
create table if not exists practice_checkout (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  initiated_by uuid,
  plan_code text not null references practice_plans(plan_code),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  tx_ref text not null unique,
  provider text not null default 'flutterwave',
  channel text not null default 'unknown' check (channel in ('card', 'mobile_money', 'bank_transfer', 'ussd', 'unknown')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'abandoned', 'mismatched')),
  provider_tx_id text,
  settled_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practice_checkout enable row level security;
create index if not exists idx_practice_checkout_ws on practice_checkout (workspace_id, created_at desc);
create index if not exists idx_practice_checkout_status on practice_checkout (status, created_at desc);

-- 3. Webhook receipts, and the idempotency guard
create table if not exists practice_checkout_event (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'flutterwave',
  provider_event_id text not null,
  tx_ref text,
  checkout_id uuid references practice_checkout(id) on delete set null,
  verdict text not null check (verdict in ('applied', 'unverified', 'mismatched', 'unknown_ref', 'not_successful')),
  detail text,
  received_at timestamptz not null default now(),
  constraint ux_practice_checkout_event_once unique (provider, provider_event_id)
);

alter table practice_checkout_event enable row level security;
create index if not exists idx_practice_checkout_event_ref on practice_checkout_event (tx_ref, received_at desc);

-- 4. Durable paid state
create table if not exists practice_subscription (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  plan_code text not null references practice_plans(plan_code),
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  last_checkout_id uuid references practice_checkout(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practice_subscription enable row level security;
create unique index if not exists ux_practice_subscription_workspace on practice_subscription (workspace_id);
create index if not exists idx_practice_subscription_period on practice_subscription (current_period_end, status);

-- 5. A priced plan to sell
-- UGX 74000 a month is roughly the twenty US dollars the pricing work landed on.
-- UGX HAS ISO EXPONENT 0, so its minor unit IS the shilling and the figure is 74000,
-- not 7400000. This repository has already paid for that distinction once: a money
-- form disagreed major-vs-minor and UGX exponent 0 made every conversion the
-- identity, so the bug was invisible until a two-decimal currency appeared.
-- Deliberately INACTIVE: a price nobody has
-- agreed is not a price to charge, and an active plan here would be reachable the
-- moment the route ships. Flip active to true when the number is decided.
insert into practice_plans (plan_code, name, trial_days, active, amount_minor, currency, interval_unit)
values ('practice_solo_ugx', 'Practice solo practitioner (UGX)', 30, false, 74000, 'UGX', 'month')
on conflict (plan_code) do nothing;

notify pgrst, 'reload schema';
