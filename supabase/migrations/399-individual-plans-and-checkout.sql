-- ====================================================================================================
-- MIGRATION 399: COMPETEN INDIVIDUAL -- PLANS AS DATA, A CHECKOUT, AND A PURCHASED ENTITLEMENT
--
-- COMPETEN P1 Commercial (Holdings subscription and payment capabilities), development authorised,
-- commercial activation ON HOLD. Reserved number 399. Build record:
-- docs/COMPETEN-P1-COMMERCIAL-holdings-foundation.md.
--
-- APPLY ON STAGING FIRST. It creates three new tables, widens one CHECK on individual_membership, adds two
-- nullable columns and two constraints to individual_entitlement, and appends one column to the
-- individual_live_entitlement view. It writes no row, and re-running it is a no-op. Nothing reads it while
-- the individual_commerce flag is OFF, and that flag has no row, so it is OFF.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets a person pay for a period of Competen Scholar or Competen Professional through the same
-- Flutterwave settlement Competen Practice uses (src/lib/commerce/settlement.ts), at a price HQ sets as
-- data, with the payment recorded beside the pilot grant rather than replacing it.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_plan           ONE row per purchasable plan. Each plan buys exactly one experience, so
--                             Scholar and Professional are bought, priced and lapse independently. HQ
--                             edits it through /api/hq/individual/plans, behind the capability migration
--                             400 creates. A plan that is not priced cannot be active.
--
--   individual_checkout       What WE intend to charge, written BEFORE the payer leaves for the gateway.
--                             It copies the price and the period length, so a later price change never
--                             rewrites what somebody already agreed to pay. The settlement engine checks
--                             the verified gateway amount and currency against this row.
--
--   individual_checkout_event One row per webhook delivery. unique (provider, provider_event_id) is the
--                             idempotency guard -- a retried delivery loses the insert, not a code check.
--
-- A settled checkout APPENDS an individual_entitlement row with source payment (370 already allows it),
-- naming the plan and the checkout. It never edits a pilot grant or another period.
--
-- ----------------------------------------------------------------------------------------------------
-- WRONG STATES MADE UNREPRESENTABLE, RATHER THAN REMEMBERED.
--
--   1. A checkout for a plan of the OTHER experience. The (plan_code, experience_code) of a checkout is a
--      foreign key to the (plan_code, experience_code) of the plan, so the experience cannot drift.
--   2. A paid entitlement that does not say what was bought. source payment requires plan_code, and the
--      same composite key ties it to a plan of that experience.
--   3. An active plan with no price. Price, currency and period are all present or all absent, and active
--      requires them present.
--   4. A plan whose experience changes under its checkouts. The composite keys refuse the update.
--
-- D8 IS UNCHANGED. A Scholar entitlement still needs adult_confirmed_at (370). A purchase carries forward
-- the existing HQ confirmation of the person, and the code refuses a Scholar checkout to anybody without one.
-- Whether a buyer may attest their own age is an owner decision this file does not take.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. No partial unique indexes. RLS ON, with NO policy on
--   the three new tables -- they are written and read only with the service role, the posture of
--   practice_checkout in migration 349. notify pgrst last.
--
-- ROLLBACK (staging): docs/COMPETEN-P1-COMMERCIAL-holdings-foundation.md, section Rollback.
-- ====================================================================================================


-- ---- 1. individual_plan -- PLANS AS DATA ------------------------------------------------------------

create table if not exists individual_plan (
  plan_code text primary key,
  experience_code text not null,
  name text not null,
  active boolean not null default false,
  amount_minor bigint,
  currency text,
  interval_days integer,
  ai_hourly_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

alter table individual_plan drop constraint if exists individual_plan_code_shape;
alter table individual_plan add constraint individual_plan_code_shape
  check (plan_code ~ '^[a-z0-9_]{3,64}$');

alter table individual_plan drop constraint if exists individual_plan_experience_check;
alter table individual_plan add constraint individual_plan_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_plan drop constraint if exists individual_plan_name_check;
alter table individual_plan add constraint individual_plan_name_check
  check (length(btrim(name)) between 1 and 120);

-- Price, currency and period: all three or none.
alter table individual_plan drop constraint if exists individual_plan_price_complete;
alter table individual_plan add constraint individual_plan_price_complete check (
  (amount_minor is null and currency is null and interval_days is null)
  or (amount_minor is not null and amount_minor > 0 and currency ~ '^[A-Z]{3}$'
      and interval_days is not null and interval_days between 1 and 366)
);

alter table individual_plan drop constraint if exists individual_plan_active_priced;
alter table individual_plan add constraint individual_plan_active_priced
  check (not active or amount_minor is not null);

-- Null means the plan sets no AI limit of its own. The code clamps any value to the Individual hard limit.
alter table individual_plan drop constraint if exists individual_plan_ai_limit_check;
alter table individual_plan add constraint individual_plan_ai_limit_check
  check (ai_hourly_limit is null or ai_hourly_limit > 0);

-- The target of the composite keys below. Full, not partial.
create unique index if not exists ux_individual_plan_code_experience
  on individual_plan(plan_code, experience_code);

alter table individual_plan enable row level security;

comment on table individual_plan is
  'P1 Commercial. One purchasable Competen Individual plan, buying one experience. HQ-governed data (capability hq.individual.commercial.manage, migration 400). Service role only.';


-- ---- 2. individual_checkout -- WHAT WE INTEND TO CHARGE -----------------------------------------------

create table if not exists individual_checkout (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_code text not null,
  experience_code text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  interval_days integer not null check (interval_days between 1 and 366),
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

alter table individual_checkout drop constraint if exists individual_checkout_plan_fk;
alter table individual_checkout add constraint individual_checkout_plan_fk
  foreign key (plan_code, experience_code) references individual_plan(plan_code, experience_code);

alter table individual_checkout enable row level security;
create index if not exists idx_individual_checkout_user on individual_checkout (user_id, created_at desc);
create index if not exists idx_individual_checkout_status on individual_checkout (status, created_at desc);

comment on table individual_checkout is
  'P1 Commercial. A Competen Individual checkout, written before the payer leaves. The settlement engine checks the verified payment against this row. Service role only.';


-- ---- 3. individual_checkout_event -- ONE ROW PER DELIVERY ---------------------------------------------

create table if not exists individual_checkout_event (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'flutterwave',
  provider_event_id text not null,
  tx_ref text,
  checkout_id uuid references individual_checkout(id) on delete set null,
  verdict text not null check (verdict in ('applied', 'duplicate', 'unverified', 'mismatched', 'unknown_ref', 'not_successful')),
  detail text,
  received_at timestamptz not null default now(),
  constraint ux_individual_checkout_event_once unique (provider, provider_event_id)
);

alter table individual_checkout_event enable row level security;
create index if not exists idx_individual_checkout_event_ref on individual_checkout_event (tx_ref, received_at desc);


-- ---- 4. individual_membership -- A PURCHASE MAY OPEN THE GATE -----------------------------------------
--
-- Widened, not replaced: every value 370 allowed is still allowed.

alter table individual_membership drop constraint if exists individual_membership_source_check;
alter table individual_membership add constraint individual_membership_source_check
  check (source in ('hq_pilot_grant', 'signup', 'hq_grant', 'purchase'));


-- ---- 5. individual_entitlement -- WHAT A PAID PERIOD BOUGHT -------------------------------------------

alter table individual_entitlement add column if not exists plan_code text;
alter table individual_entitlement add column if not exists checkout_id uuid references individual_checkout(id) on delete set null;

alter table individual_entitlement drop constraint if exists individual_entitlement_plan_fk;
alter table individual_entitlement add constraint individual_entitlement_plan_fk
  foreign key (plan_code, experience_code) references individual_plan(plan_code, experience_code);

alter table individual_entitlement drop constraint if exists individual_entitlement_payment_plan;
alter table individual_entitlement add constraint individual_entitlement_payment_plan
  check (source <> 'payment' or plan_code is not null);


-- ---- 6. individual_live_entitlement -- plan_code APPENDED ---------------------------------------------
--
-- Every 370 column, in the order of 370, then plan_code. The AI fair-use rule reads the plan of a live paid
-- period from here, so liveness is still decided by the database clock.

create or replace view individual_live_entitlement
  with (security_invoker = true) as
  select e.id, e.user_id, e.experience_code, e.status, e.starts_at, e.ends_at, e.source, e.operating_entity,
         e.terms_version, e.privacy_version, e.plan_code
    from individual_entitlement e
   where e.status in ('active', 'trial')
     and e.starts_at <= now()
     and (e.ends_at is null or e.ends_at > now());


-- Verification: three new tables with RLS on and no policy, zero rows, the widened membership CHECK, the
-- two new entitlement columns, and plan_code last on the view.
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('individual_plan', 'individual_checkout', 'individual_checkout_event')
 order by c.relname;

select (select count(*) from individual_plan) as plans,
       (select count(*) from individual_checkout) as checkouts,
       (select count(*) from individual_checkout_event) as events;

select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname in ('individual_membership_source_check', 'individual_entitlement_payment_plan',
                   'individual_entitlement_plan_fk', 'individual_checkout_plan_fk')
 order by conname;

select column_name, ordinal_position
  from information_schema.columns
 where table_name = 'individual_live_entitlement'
 order by ordinal_position;

notify pgrst, 'reload schema';
