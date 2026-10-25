-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 463: COMPETEN LEARNING -- COURSE PRICES, THE COURSE ENTITLEMENT LEDGER, AND COURSE CHECKOUTS
--
-- COMPETEN-LEARNING-01 Phase 2 S3 (owner GO 2026-10-25, D2 option E2, D3, D7, D8). "A sibling course-entitlement
-- ledger using the existing Holdings Commercial Engine. Preserve Scholar and Professional experience entitlements
-- unchanged. Do not widen the experience entitlement ledger to represent courses." Product definition s9.
--
-- APPLY ON STAGING FIRST, AFTER 399, 460, 461 AND 462. ADDITIVE OR WIDENING. Two new tables, one view, five new
-- columns on individual_checkout with three of its NOT NULLs relaxed under one exactly-one-subject CHECK (every
-- existing row is an experience checkout and keeps every value), one new FK and guard on learning_record, and two
-- functions. individual_entitlement, individual_plan and individual_live_entitlement are NOT touched. Re-running it is
-- a no-op. OPS-001 s8: proposed Medium (a widened commerce table), with a rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets one Individual identity buy access to one course through the SAME checkout table, the same three-check
-- settlement and the same idempotent delivery log Scholar and Professional periods use, without a subscription and
-- without the course ever appearing in the experience ledger gate 3 reads.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   learning_offering_price    a course price as DATA: currency, amount, access days (null = for as long as the
--                              terms allow), terms version, operating entity. Append-only in its terms. proposed, then
--                              approved or rejected by a DIFFERENT person who holds hq.learning.price.approve (the
--                              database checks both), then retired. Approving a price retires the previous approved
--                              price of the same offering and currency, so one price is current per currency.
--   individual_course_entitlement  the sibling ledger. A course, not an experience. source payment (a settled
--                              checkout, the only source with billing authority) or hq_grant. Rows are never deleted,
--                              ending is a status. One entitlement per checkout, by a unique index.
--   individual_live_course_entitlement  the database clock decides liveness, as individual_live_entitlement does.
--   individual_checkout        + item_kind (experience or course), offering_id, offering_price_id, terms_version,
--                              operating_entity. An experience checkout is exactly what 399 wrote. A course checkout
--                              names a price and copies its amount, currency, access days and terms before the payer
--                              leaves. interval_days is the access period and may be null (no end under the terms).
--   learning_record            + the course entitlement FK, and a guard: an entitlement enrolment names a live
--                              entitlement of the same person and offering, and progress stops when access ends while
--                              the record and its completion stay.
--
-- Actor ids on a price (proposer, decider) are plain ids, as the case library keeps its authors: the price record
-- outlives an account, and never blocks deleting one.
--
-- RLS: on for the two new tables. Read-own on the entitlement. No policy on prices. Every write is the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-463.sql. It refuses once a course checkout or a course entitlement exists.
-- ====================================================================================================


-- ---- 1. learning_offering_price -- PRICES AS GOVERNED DATA ------------------------------------------------

create table if not exists learning_offering_price (
  id                uuid primary key default gen_random_uuid(),
  offering_id       uuid not null references learning_offering(id),
  currency          text not null,
  amount_minor      bigint not null,
  access_days       integer,
  terms_version     text not null,
  operating_entity  text not null default 'competen_holdings',
  state             text not null default 'proposed',
  proposed_by       uuid not null,
  proposed_at       timestamptz not null default now(),
  proposal_note     text,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text,
  retired_at        timestamptz,
  created_at        timestamptz not null default now()
);
alter table learning_offering_price drop constraint if exists learning_offering_price_check;
alter table learning_offering_price add constraint learning_offering_price_check
  check (currency ~ '^[A-Z]{3}$' and amount_minor > 0 and amount_minor <= 100000000000
     and (access_days is null or access_days between 1 and 3660)
     and terms_version ~ '^learning-terms/[0-9]{1,3}$' and operating_entity ~ '^[a-z][a-z_]{2,40}$'
     and state in ('proposed', 'approved', 'rejected', 'retired')
     and (state = 'proposed') = (decided_at is null)
     and (decided_at is null) = (decided_by is null)
     and (decided_by is null or decided_by <> proposed_by)
     and (state <> 'rejected' or char_length(btrim(coalesce(decision_note, ''))) between 3 and 1000)
     and (state = 'retired') = (retired_at is not null)
     and char_length(coalesce(proposal_note, '')) <= 1000 and char_length(coalesce(decision_note, '')) <= 1000);
create index if not exists idx_learning_offering_price_offering on learning_offering_price(offering_id, currency, state);
alter table learning_offering_price enable row level security;

create or replace function public.learning_offering_price_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_offering_price: a price is the record of what was offered. Retire it instead';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'proposed' then raise exception 'learning_offering_price: a price starts as a proposal'; end if;
    new.proposed_at := now();
    new.created_at := now();
    return new;
  end if;
  if new.offering_id is distinct from old.offering_id or new.currency is distinct from old.currency or new.amount_minor is distinct from old.amount_minor
     or new.access_days is distinct from old.access_days or new.terms_version is distinct from old.terms_version
     or new.operating_entity is distinct from old.operating_entity or new.proposed_by is distinct from old.proposed_by
     or new.proposed_at is distinct from old.proposed_at or new.proposal_note is distinct from old.proposal_note then
    raise exception 'learning_offering_price: a price cannot be rewritten. Propose a new one';
  end if;
  if coalesce(current_setting('competen.learning_price', true), '') <> 'on' then
    raise exception 'learning_offering_price: a price is decided and retired only through its functions';
  end if;
  return new;
end;
$$;
drop trigger if exists learning_offering_price_guard on learning_offering_price;
create trigger learning_offering_price_guard before insert or update or delete on learning_offering_price for each row execute function public.learning_offering_price_guard();

-- Decide a proposal: a different person, holding hq.learning.price.approve now. Approval retires the previous approved
-- price of the same offering and currency.
create or replace function public.learning_offering_price_decide(p_price uuid, p_decider uuid, p_approve boolean, p_note text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  p learning_offering_price%rowtype;
begin
  select * into p from learning_offering_price where id = p_price for update;
  if not found then raise exception 'learning_offering_price_decide: unknown price'; end if;
  if p.state <> 'proposed' then raise exception 'learning_offering_price_decide: only a proposal is decided (this one is %)', p.state; end if;
  if p_decider is null or p_decider = p.proposed_by then
    raise exception 'learning_offering_price_decide: not independent. The proposer cannot decide their own price';
  end if;
  if not learning_holds_capability(p_decider, 'hq.learning.price.approve') then
    raise exception 'learning_offering_price_decide: not authorised. It needs an active appointment holding hq.learning.price.approve';
  end if;
  perform set_config('competen.learning_price', 'on', true);
  if p_approve then
    update learning_offering_price set state = 'retired', retired_at = now()
     where offering_id = p.offering_id and currency = p.currency and state = 'approved' and id <> p.id;
  end if;
  update learning_offering_price set state = case when p_approve then 'approved' else 'rejected' end,
         decided_by = p_decider, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p.id;
  perform set_config('competen.learning_price', 'off', true);
end;
$$;

-- Retire an approved price: no new checkout may name it. What was bought under it keeps its own copy (the checkout
-- row). A proposal is decided, never retired.
create or replace function public.learning_offering_price_retire(p_price uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  p learning_offering_price%rowtype;
begin
  select * into p from learning_offering_price where id = p_price for update;
  if not found then raise exception 'learning_offering_price_retire: unknown price'; end if;
  if p.state = 'retired' then return; end if;
  if p.state <> 'approved' then raise exception 'learning_offering_price_retire: only an approved price is retired (this one is %)', p.state; end if;
  perform set_config('competen.learning_price', 'on', true);
  update learning_offering_price set state = 'retired', retired_at = now() where id = p.id;
  perform set_config('competen.learning_price', 'off', true);
end;
$$;

revoke all on function public.learning_offering_price_decide(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.learning_offering_price_retire(uuid) from public, anon, authenticated;
grant execute on function public.learning_offering_price_decide(uuid, uuid, boolean, text) to service_role;
grant execute on function public.learning_offering_price_retire(uuid) to service_role;


-- ---- 2. individual_checkout -- ONE CHECKOUT TABLE, TWO KINDS OF THING BOUGHT ------------------------------
--
-- Widened, not replaced: every 399 row is an experience checkout and keeps every value. The settlement engine
-- (src/lib/commerce/settlement.ts) reads the same columns for both kinds.

alter table individual_checkout add column if not exists item_kind text not null default 'experience';
alter table individual_checkout add column if not exists offering_id uuid references learning_offering(id);
alter table individual_checkout add column if not exists offering_price_id uuid references learning_offering_price(id);
alter table individual_checkout add column if not exists terms_version text;
alter table individual_checkout add column if not exists operating_entity text;
alter table individual_checkout alter column plan_code drop not null;
alter table individual_checkout alter column experience_code drop not null;
alter table individual_checkout alter column interval_days drop not null;

alter table individual_checkout drop constraint if exists individual_checkout_interval_days_check;
alter table individual_checkout add constraint individual_checkout_interval_days_check
  check (interval_days is null or interval_days between 1 and 3660);

alter table individual_checkout drop constraint if exists individual_checkout_subject_check;
alter table individual_checkout add constraint individual_checkout_subject_check
  check ((item_kind = 'experience' and plan_code is not null and experience_code is not null
          and interval_days is not null and interval_days between 1 and 366
          and offering_id is null and offering_price_id is null)
      or (item_kind = 'course' and offering_id is not null and offering_price_id is not null and plan_code is null and experience_code is null
          and terms_version is not null and terms_version ~ '^learning-terms/[0-9]{1,3}$'
          and operating_entity is not null and operating_entity ~ '^[a-z][a-z_]{2,40}$'));

-- A course checkout copies the APPROVED price it names, exactly, before the payer leaves.
create or replace function public.individual_checkout_course_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  p learning_offering_price%rowtype;
begin
  if new.item_kind <> 'course' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.item_kind is distinct from old.item_kind or new.offering_id is distinct from old.offering_id or new.offering_price_id is distinct from old.offering_price_id
       or new.amount_minor is distinct from old.amount_minor or new.currency is distinct from old.currency or new.interval_days is distinct from old.interval_days
       or new.terms_version is distinct from old.terms_version or new.operating_entity is distinct from old.operating_entity or new.user_id is distinct from old.user_id then
      raise exception 'individual_checkout: what a course checkout bought, and for how much, cannot be rewritten';
    end if;
    return new;
  end if;
  select * into p from learning_offering_price where id = new.offering_price_id;
  if p.id is null or p.state <> 'approved' or p.offering_id <> new.offering_id then
    raise exception 'individual_checkout: a course checkout names an approved price of that course';
  end if;
  if new.amount_minor <> p.amount_minor or new.currency <> p.currency or new.interval_days is distinct from p.access_days
     or new.terms_version <> p.terms_version or new.operating_entity <> p.operating_entity then
    raise exception 'individual_checkout: a course checkout copies its approved price exactly';
  end if;
  return new;
end;
$$;
drop trigger if exists individual_checkout_course_guard on individual_checkout;
create trigger individual_checkout_course_guard before insert or update on individual_checkout for each row execute function public.individual_checkout_course_guard();


-- ---- 3. individual_course_entitlement -- THE SIBLING LEDGER ------------------------------------------------

create table if not exists individual_course_entitlement (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  offering_id       uuid not null references learning_offering(id),
  price_id          uuid references learning_offering_price(id),
  checkout_id       uuid references individual_checkout(id) on delete set null,
  source            text not null,
  status            text not null default 'active',
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  terms_version     text,
  operating_entity  text not null default 'competen_holdings',
  granted_by        uuid references profiles(id) on delete set null,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table individual_course_entitlement drop constraint if exists individual_course_entitlement_check;
alter table individual_course_entitlement add constraint individual_course_entitlement_check
  check (source in ('payment', 'hq_grant') and status in ('active', 'suspended', 'expired', 'cancelled')
     and (ends_at is null or ends_at > starts_at)
     and (source <> 'payment' or (checkout_id is not null and price_id is not null and terms_version is not null))
     and (source <> 'hq_grant' or granted_by is not null)
     and (terms_version is null or terms_version ~ '^learning-terms/[0-9]{1,3}$')
     and operating_entity ~ '^[a-z][a-z_]{2,40}$' and char_length(coalesce(note, '')) <= 500);
create unique index if not exists ux_individual_course_entitlement_checkout on individual_course_entitlement(checkout_id);
create index if not exists idx_individual_course_entitlement_user on individual_course_entitlement(user_id, offering_id);
alter table individual_course_entitlement enable row level security;
drop policy if exists individual_course_entitlement_read_own on individual_course_entitlement;
create policy individual_course_entitlement_read_own on individual_course_entitlement for select using (auth.uid() = user_id);

create or replace function public.individual_course_entitlement_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'individual_course_entitlement: an entitlement is the record. End it with a status instead';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.offering_id is distinct from old.offering_id or new.price_id is distinct from old.price_id
     or new.checkout_id is distinct from old.checkout_id or new.source is distinct from old.source or new.starts_at is distinct from old.starts_at
     or new.terms_version is distinct from old.terms_version or new.operating_entity is distinct from old.operating_entity or new.created_at is distinct from old.created_at then
    raise exception 'individual_course_entitlement: what an entitlement is cannot be rewritten. Only its status and end change';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'individual_course_entitlement: a cancelled entitlement stays cancelled. Grant a new one';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists individual_course_entitlement_guard on individual_course_entitlement;
create trigger individual_course_entitlement_guard before insert or update or delete on individual_course_entitlement for each row execute function public.individual_course_entitlement_guard();

create or replace view individual_live_course_entitlement
  with (security_invoker = true) as
  select e.id, e.user_id, e.offering_id, e.status, e.starts_at, e.ends_at, e.source, e.operating_entity, e.terms_version, e.price_id
    from individual_course_entitlement e
   where e.status = 'active'
     and e.starts_at <= now()
     and (e.ends_at is null or e.ends_at > now());


-- ---- 4. learning_record -- THE ENTITLEMENT REFERENCE ------------------------------------------------------

alter table learning_record drop constraint if exists learning_record_entitlement_fk;
alter table learning_record add constraint learning_record_entitlement_fk
  foreign key (course_entitlement_id) references individual_course_entitlement(id);

-- An entitlement enrolment names a LIVE entitlement of the same person and offering. Ending access never touches
-- the record: it stays, with whatever it completed.
create or replace function public.learning_record_entitlement_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.access_kind <> 'entitlement' then return new; end if;
  if tg_op = 'UPDATE' and new.course_entitlement_id is not distinct from old.course_entitlement_id then return new; end if;
  if not exists (select 1 from individual_live_course_entitlement e
                  where e.id = new.course_entitlement_id and e.user_id = new.user_id and e.offering_id = new.offering_id) then
    raise exception 'learning_record: the enrolment needs a live course entitlement of this person for this course';
  end if;
  return new;
end;
$$;
drop trigger if exists learning_record_entitlement_guard on learning_record;
create trigger learning_record_entitlement_guard before insert or update on learning_record for each row execute function public.learning_record_entitlement_guard();

-- Progress needs live access: an entitlement record whose access ended takes no more lessons or checks. 462 logic
-- unchanged, the access line added.
create or replace function public.learning_record_activity_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_delivery text;
  v_access text;
  v_ent uuid;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_record_activity: progress is part of the record';
  end if;
  select status, delivery, access_kind, course_entitlement_id into v_status, v_delivery, v_access, v_ent from learning_record where id = new.record_id;
  if v_delivery is distinct from 'hosted' then raise exception 'learning_record_activity: progress is recorded for hosted learning only'; end if;
  if v_status not in ('enrolled', 'in_progress') then raise exception 'learning_record_activity: the record is % and takes no more progress', v_status; end if;
  if v_access = 'entitlement' and not exists (select 1 from individual_live_course_entitlement e where e.id = v_ent) then
    raise exception 'learning_record_activity: access to this course has ended. The record and its progress are kept';
  end if;
  if tg_op = 'UPDATE' and (new.record_id is distinct from old.record_id or new.user_id is distinct from old.user_id
     or new.activity_key is distinct from old.activity_key or new.kind is distinct from old.kind) then
    raise exception 'learning_record_activity: an activity cannot be moved';
  end if;
  return new;
end;
$$;


-- Verification: the two new tables with RLS on, the widened checkout columns, the subject CHECK, and no course rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('learning_offering_price', 'individual_course_entitlement')
 order by c.relname;

select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_checkout'
   and column_name in ('item_kind', 'offering_id', 'offering_price_id', 'terms_version', 'operating_entity', 'plan_code', 'experience_code', 'interval_days')
 order by 1;

select item_kind, count(*) from individual_checkout group by item_kind order by item_kind;

notify pgrst, 'reload schema';
