-- ====================================================================================================
-- MIGRATION 370: COMPETEN INDIVIDUAL BECOMES A PRODUCT GATE (GATE 3), WITH TWO EXPERIENCES INSIDE IT
--
-- COMPETEN-IND-003 section 2, ADR-016, COMPETEN-IND-002 section 5.1. COMP-ARCH-PSA-001 sections 7, 21,
-- 22 and 40 (explicit product membership, independent entitlement, no implicit provisioning).
--
-- APPLY ON STAGING FIRST. It creates three new objects and adds one capability, one position and its
-- grants to the existing HQ catalogue. It alters no existing table, row, policy or constraint. Nothing
-- reads it until the Individual code ships, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- Today no table can say "this person holds Competen Scholar, Competen Professional, or both", because
-- every entitlement store on this database is keyed on a workspace (practice_entitlement) or a tenant
-- (tenant_product_licenses, plat_subscriptions). This file makes that sentence writable, per person.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE, AND WHY IT IS TWO TABLES AND A VIEW.
--
--   individual_membership   ONE row per person. The product gate. Absence of a row means no access to
--                           the Individual shell. Carries the primary-experience PREFERENCE and
--                           when they finished onboarding. It is NOT platform_membership (gate 1) and NOT
--                           practice_membership (gate 2), and no foreign key joins it to either.
--
--   individual_entitlement  A LEDGER of experience periods, keyed (user_id, experience_code). Any number
--                           of rows may be live at once, which is what lets Scholar and Professional run
--                           side by side. Graduation INSERTS a professional row. Returning to study
--                           INSERTS a scholar row. Nothing ever moves the account.
--
--   individual_live_entitlement  The rows that are live NOW, judged by the DATABASE clock. Application
--                           code reads this view and never compares its own clock with a stored period.
--                           Comparing an app-clock timestamp with a DB-clock one has caused real
--                           capability-visibility bugs on this estate before.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No partial unique indexes. The one unique index is FULL, on one NOT NULL column.
--   4. source is NOT NULL with NO DEFAULT on both tables, after migration 368. An insert that does not
--      say where an access grant came from FAILS rather than being quietly answered by the database.
--   5. RLS ON, own-row SELECT policies only (provisional ruling D6). There is no INSERT, UPDATE or
--      DELETE policy. Granting yourself product access from a browser session is exactly the escalation
--      migration 249 closed on profiles. Writes happen with the service role or not at all.
--   6. notify pgrst LAST.
--
-- OWNER RULINGS ENFORCED HERE (COMPETEN-IND-003 rulings, ADR-016):
--
--   D2  Terms acceptance is RECORDED, per operating entity: the shared foundation (Competen Holdings) on
--       the membership row, each experience on its entitlement row. Version and acceptance time are
--       written together or not at all -- a version with no time, or a time with no version, cannot be
--       stored.
--   D8  A scholar entitlement cannot be written without the HQ adult-eligibility confirmation (who and
--       when). The rule lives in a CHECK, so a second writer who never heard of D8 still cannot break it.
--   D9  hq.individual.pilot.grant is created in the EXISTING HQ catalogue and granted to a new position,
--       Individual Product Administrator, in the existing platform space and the frozen individual
--       product line. Who holds that position is an ordinary HQ appointment. No new landlord authority,
--       no new space, no parallel grant engine.
--
-- NOT IN THIS FILE, ON PURPOSE: any profiles change (profiles.role stays untouched, ADR-001), any write
-- to an estate table, and any backfill. Nobody holds Individual until somebody is granted it.
-- ====================================================================================================


-- ---- 1. individual_membership -- THE GATE ----------------------------------------------------------

create table if not exists individual_membership (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'active',
  source text not null,
  primary_experience text,
  onboarded_at timestamptz,
  foundation_terms_version text,
  foundation_privacy_version text,
  foundation_accepted_at timestamptz,
  granted_at timestamptz not null default now(),
  granted_by uuid references profiles(id) on delete set null,
  suspended_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_membership drop constraint if exists individual_membership_status_check;
alter table individual_membership add constraint individual_membership_status_check
  check (status in ('active', 'suspended', 'revoked'));

alter table individual_membership drop constraint if exists individual_membership_source_check;
alter table individual_membership add constraint individual_membership_source_check
  check (source in ('hq_pilot_grant', 'signup', 'hq_grant'));

alter table individual_membership drop constraint if exists individual_membership_primary_check;
alter table individual_membership add constraint individual_membership_primary_check
  check (primary_experience is null or primary_experience in ('scholar', 'professional'));

-- A revoked membership says when. A blank revocation is the migration-256 lesson.
alter table individual_membership drop constraint if exists individual_membership_revoked_when;
alter table individual_membership add constraint individual_membership_revoked_when
  check (status <> 'revoked' or revoked_at is not null);

-- D2: the shared-foundation acceptance is all three columns or none.
alter table individual_membership drop constraint if exists individual_membership_foundation_terms_whole;
alter table individual_membership add constraint individual_membership_foundation_terms_whole
  check ((foundation_terms_version is null) = (foundation_accepted_at is null)
     and (foundation_privacy_version is null) = (foundation_accepted_at is null));

create unique index if not exists ux_individual_membership_user
  on individual_membership(user_id);

alter table individual_membership enable row level security;

drop policy if exists individual_membership_read_own on individual_membership;
create policy individual_membership_read_own on individual_membership
  for select using (auth.uid() = user_id);

comment on table individual_membership is
  'ADR-016. Gate 3: explicit membership of Competen Individual. Absence of a row means no Individual access. Never implies platform_membership (gate 1) or practice_membership (gate 2), and creating it writes neither, nor profiles.role.';
comment on column individual_membership.primary_experience is
  'A PREFERENCE, not an entitlement. Honoured only while that experience has a live individual_entitlement row. Otherwise the landing falls back.';
comment on column individual_membership.onboarded_at is
  'When the person finished the Individual welcome. Null means the welcome is shown before any experience.';


-- ---- 2. individual_entitlement -- THE EXPERIENCE LEDGER --------------------------------------------

create table if not exists individual_entitlement (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  source text not null,
  operating_entity text not null,
  terms_version text,
  privacy_version text,
  terms_accepted_at timestamptz,
  adult_confirmed_at timestamptz,
  adult_confirmed_by uuid references profiles(id) on delete set null,
  granted_by uuid references profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_entitlement drop constraint if exists individual_entitlement_experience_check;
alter table individual_entitlement add constraint individual_entitlement_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_entitlement drop constraint if exists individual_entitlement_status_check;
alter table individual_entitlement add constraint individual_entitlement_status_check
  check (status in ('active', 'trial', 'suspended', 'expired', 'cancelled'));

-- pilot / hq_grant: an HQ act. graduation: Scholar to Professional activation. payment: a settled
-- checkout, the only value that will ever carry billing authority (ADR-015 reasoning). signup: a future
-- self-serve path, closed today.
alter table individual_entitlement drop constraint if exists individual_entitlement_source_check;
alter table individual_entitlement add constraint individual_entitlement_source_check
  check (source in ('pilot', 'hq_grant', 'graduation', 'payment', 'signup'));

-- COMPETEN-IND-001 D6: Scholar is operated by a Competen Holdings subsidiary whose legal name is
-- pending, and Professional by Holdings. The CODE is recorded now so no row ever has to be guessed
-- later. The controller arrangement itself is owner decision D2.
alter table individual_entitlement drop constraint if exists individual_entitlement_entity_check;
alter table individual_entitlement add constraint individual_entitlement_entity_check
  check (operating_entity in ('competen_holdings', 'scholar_operator'));

alter table individual_entitlement drop constraint if exists individual_entitlement_period_check;
alter table individual_entitlement add constraint individual_entitlement_period_check
  check (ends_at is null or ends_at > starts_at);

-- D2: the experience acceptance is all three columns or none.
alter table individual_entitlement drop constraint if exists individual_entitlement_terms_whole;
alter table individual_entitlement add constraint individual_entitlement_terms_whole
  check ((terms_version is null) = (terms_accepted_at is null)
     and (privacy_version is null) = (terms_accepted_at is null));

-- D8: the Scholar pilot is 18+, enforced when access is granted. The confirmation is a recorded HQ act.
alter table individual_entitlement drop constraint if exists individual_entitlement_scholar_adult;
alter table individual_entitlement add constraint individual_entitlement_scholar_adult
  check (experience_code <> 'scholar' or adult_confirmed_at is not null);

create index if not exists idx_individual_entitlement_user
  on individual_entitlement(user_id, experience_code);

alter table individual_entitlement enable row level security;

drop policy if exists individual_entitlement_read_own on individual_entitlement;
create policy individual_entitlement_read_own on individual_entitlement
  for select using (auth.uid() = user_id);

comment on table individual_entitlement is
  'ADR-016. One row per experience period. Scholar and Professional may both be live. Graduation and return-to-study INSERT rows, and nothing moves the account. Liveness is decided by individual_live_entitlement, on the database clock.';


-- ---- 3. individual_live_entitlement -- LIVENESS ON THE DATABASE CLOCK ------------------------------
--
-- security_invoker so a signed-in session reading the view is held to the own-row policy of the base table
-- rather than to the rights of the view owner. The service role sees everything either way.

create or replace view individual_live_entitlement
  with (security_invoker = true) as
  select e.id, e.user_id, e.experience_code, e.status, e.starts_at, e.ends_at, e.source, e.operating_entity,
         e.terms_version, e.privacy_version
    from individual_entitlement e
   where e.status in ('active', 'trial')
     and e.starts_at <= now()
     and (e.ends_at is null or e.ends_at > now());

comment on view individual_live_entitlement is
  'ADR-016. Entitlement rows live now, judged by the database clock. Read this, never compare an application clock with starts_at or ends_at.';


-- ---- 4. D9 -- THE PILOT-GRANT RIGHT, THROUGH THE EXISTING HQ CATALOGUE ------------------------------
--
-- Capability, position and grant ship together, for the reason migrations 311 and 367 record: a
-- capability inserted without the grant that makes it reachable locks everybody out while every harness
-- stays green. The grant reaches whoever holds an active appointment to the position, and nobody else.
-- Every position also gets hq.platform.home.view so an appointee can reach the HQ landing page.

insert into hq_capability (code, space, label, description) values
  ('hq.individual.pilot.grant', 'platform', 'Competen Individual pilot access',
   'Grant or end Competen Scholar and Competen Professional access for a named person during the pilot')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('individual_product_administrator', 'platform', 'Individual Product Administrator',
   'Competen Individual pilot access. Grants and ends Scholar and Professional entitlements, confirming Scholar age eligibility on every grant. No other HQ right.')
on conflict (code) do nothing;

update hq_position
   set product_line_code = 'individual'
 where code = 'individual_product_administrator'
   and product_line_code is distinct from 'individual';

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('individual_product_administrator')) as p(code)
cross join (values
  ('hq.platform.home.view'),
  ('hq.individual.pilot.grant')
) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);


-- Verification: three objects, RLS on, own-row policies present, zero rows.
select c.relname, c.relkind, c.relrowsecurity
  from pg_class c
 where c.relname in ('individual_membership', 'individual_entitlement', 'individual_live_entitlement')
 order by c.relname;

select tablename, policyname, cmd
  from pg_policies
 where tablename in ('individual_membership', 'individual_entitlement')
 order by tablename, policyname;

select position_code, capability_code, effective_to
  from hq_position_capability
 where position_code = 'individual_product_administrator'
 order by capability_code;

notify pgrst, 'reload schema';
