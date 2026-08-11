-- ====================================================================================================
-- MIGRATION 286: ENTERPRISE MEMBERSHIP -- THE THIRD GATE
--
-- ENT-DEC-001 D4, and COMP-ARCH-PSA-001 section 7 applied to a third product line.
-- Sibling of migration 279 (platform_membership) and of practice_membership.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- Today a hospital administrator reaches the tenant administration surfaces through the ESTATE role
-- gate, which means every hospital administrator is a Competen PLATFORM member. That is the collapse
-- COMP-ARCH-PSA-001 exists to prevent, and this file makes the alternative writable.
--
--   platform_membership    Competen staff             gate 1
--   practice_membership    practitioners              gate 2
--   enterprise_membership  hospital tenants           gate 3  <- this file
--
-- ----------------------------------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING.
--
-- NOTHING IN THE APPLICATION READS THIS TABLE YET. The guard module ships beside it and is wired to no
-- route. That is deliberate and it is the lesson of the regression this repository already paid for: the
-- last change to the API caller looked additive, was in fact a new gate, and answered 403 to the only
-- person using the product. A table nothing reads cannot refuse anybody.
--
-- SO THIS FILE CANNOT LOCK ANYBODY OUT. It creates a table, repairs a decayed denormalisation, and
-- writes three rows. No existing access path is changed.
--
-- ----------------------------------------------------------------------------------------------------
-- LIVE STATE READ BACK BEFORE WRITING THIS FILE (probed, not assumed from a migration):
--
--   profiles                              47
--   profiles with a tenant_id             7        (40 null)
--   role histogram                        nurse 36, hospital_admin 4, educator 3, super_admin 2,
--                                         assessor 1, null 1
--   tenants                               6 rows, all active
--   enterprises                           1
--   organisations                         6, ALL 6 carry a tenant_id
--   hospitals                             11, only ONE carries a tenant_id
--   enterprise_membership                 does not exist (PGRST205 on a REAL select -- a head+count
--                                         probe returns count null with no error on a missing table
--                                         and therefore proves nothing)
--   platform_membership                   46
--   practice_membership                   4
--
--   hospital_admin accounts               4, of which
--                                           Elisha        tenant yes
--                                           WAE admin     tenant yes
--                                           Ruth Nabwire  tenant NULL, but her hospital has one
--                                           sema Cast     tenant NULL, no hospital and no organisation
--
-- ----------------------------------------------------------------------------------------------------
-- !! THE FINDING THAT MADE SECTION 2 NECESSARY, AND IT IS A LATENT BUG RATHER THAN A TIDY-UP.
--
-- Migration 041 denormalised tenant_id downward -- organisations to hospitals to profiles -- as a ONE
-- OFF UPDATE. Nothing maintains it. There is no trigger, and no application write path sets it. So every
-- row created since migration 041 carries a null tenant_id regardless of where it actually belongs.
--
-- Measured on this database today:
--     6 of the 10 hospitals with no tenant_id have an organisation that HAS one
--    25 of the 40 profiles with no tenant_id have a hospital that HAS one
--
-- The remaining four hospitals have no organisation at all, so nothing can be inferred for them and this
-- file infers nothing. Their tenant stays null, which is the honest answer.
--
-- !! THIS IS A REPAIR, NOT A FIX. The decay resumes the moment somebody inserts a profile. A trigger is
-- the obvious remedy and is deliberately NOT here: it needs a function body, and the migration runner
-- used on this database splits on semicolons, which is why every deployed language-sql function has a
-- single statement body. The chosen remedy is DETECTION -- scripts/enterprise-membership-harness.ts
-- fails when a profile has a null tenant_id while its hospital has one, so the drift becomes a red
-- assertion instead of a silence.
--
-- ----------------------------------------------------------------------------------------------------
-- THE TRAPS THIS FILE WAS WRITTEN AROUND (migration 279 header, unchanged and still true):
--
--   1. NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT. One inside a
--      comment shredded two sections of migration 238 while still reporting success.
--   2. NO -- SEQUENCE INSIDE A STRING LITERAL.
--   3. NO do-blocks, no plpgsql, no functions. Plain statements only.
--   4. THE UPSERT TARGET IS A FULL UNIQUE INDEX. A partial unique index is an upsert that silently
--      writes nothing, and that has already cost this codebase two silent write failures.
--   5. ASCII ONLY.
--   6. notify pgrst LAST.
-- ====================================================================================================


-- ---- 1. THE MEMBERSHIP STORE -----------------------------------------------------------------------
--
-- ONE ROW PER IDENTITY PER TENANT, WHICH IS WHERE THIS DIFFERS FROM platform_membership.
--
-- Platform membership is one row per identity: you are on the estate or you are not. Enterprise
-- membership is not that shape. ENT-NAV-001 section 12 requires tenant switching and multi-tenant
-- identity, so a person may belong to more than one hospital tenant -- a consultant working across two
-- groups is the ordinary case, not the exotic one.
--
-- The unique index is therefore on the PAIR. Getting this wrong in the other direction is expensive:
-- retrofitting a second dimension onto a unique index means changing what every upsert targets, and a
-- partial index is the silent-write trap named above.
--
-- WHAT IS DELIBERATELY ABSENT: no role column, for migration 279 reason -- adding a membership must not
-- add a role, and granting a role must not add a membership. They are independent facts. Appointments
-- live in their own tables.
create table if not exists enterprise_membership (
  id uuid primary key default gen_random_uuid(),

  -- THE IDENTITY. Cascade on delete so a recycled uuid cannot inherit somebody else product access.
  user_id uuid not null references profiles(id) on delete cascade,

  -- THE TENANT. Cascade for the same reason in the other direction: a closed tenant leaves no dangling
  -- membership that a later tenant with the same id could inherit.
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- TWO STATES A ROW CAN HOLD, THREE THE GUARD REPORTS. active admits. suspended and revoked do not.
  -- Could not be read is NOT a state a row can hold. It is what the guard says when this table does not
  -- answer, and folding it into a refusal would blank the product for everybody during an outage.
  status text not null default 'active',

  joined_at timestamptz not null default now(),
  granted_by uuid references profiles(id) on delete set null,

  -- HOW THIS ROW CAME TO BE. backfill_legacy means migration 286 wrote down a membership that was
  -- implicit in the estate role gate before this table existed. It is not evidence that anybody decided
  -- anything.
  source text not null default 'explicit_grant',

  suspended_at timestamptz,
  suspended_by uuid references profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,

  -- Free text, optional, never required. A required reason field is a field people type x into.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table enterprise_membership drop constraint if exists enterprise_membership_status_check;
alter table enterprise_membership add constraint enterprise_membership_status_check
  check (status in ('active', 'suspended', 'revoked'));

alter table enterprise_membership drop constraint if exists enterprise_membership_source_check;
alter table enterprise_membership add constraint enterprise_membership_source_check
  check (source in ('backfill_legacy', 'provisioning', 'admin_grant', 'explicit_grant'));

-- FULL unique index on two NOT NULL columns, no WHERE clause, and there never will be one. See trap 4.
create unique index if not exists ux_enterprise_membership_user_tenant
  on enterprise_membership(user_id, tenant_id);

create index if not exists idx_enterprise_membership_tenant
  on enterprise_membership(tenant_id, status);

create index if not exists idx_enterprise_membership_user
  on enterprise_membership(user_id);

alter table enterprise_membership enable row level security;

-- ONE POLICY, AND IT IS A READ OF YOUR OWN ROWS. Every gate in the application reads this table with the
-- service role, which bypasses RLS entirely, so the product does not need a policy to function. This one
-- lets a future tenant switcher ask which tenants do I hold from the browser, and it discloses nothing
-- the viewer does not already know about themselves.
--
-- THERE IS NO INSERT, UPDATE OR DELETE POLICY. Granting yourself product membership from a browser
-- session is the escalation migration 249 closed on profiles, arriving through a new door.
drop policy if exists enterprise_membership_read_own on enterprise_membership;
create policy enterprise_membership_read_own on enterprise_membership
  for select using (auth.uid() = user_id);

comment on table enterprise_membership is
  'ENT-DEC-001 D4. Explicit membership of a Competen Enterprise TENANT (gate 3). Absence of a row means no Enterprise access to that tenant. This is NOT an estate role and carries none, and it is NOT platform_membership (gate 1) or practice_membership (gate 2). None of the three is read to decide anything about another and there is no foreign key between them. One row per user per tenant, because ENT-NAV-001 s12 requires multi-tenant identity.';

comment on column enterprise_membership.status is
  'active admits. suspended and revoked do not. unreadable is NOT a value here. It is a third state the application guard reports when this table does not answer, and folding it into a refusal would blank the product for everybody during an outage.';

comment on column enterprise_membership.source is
  'backfill_legacy means migration 286 wrote down a membership that was implicit in the estate role gate. It is not evidence of a decision by a person.';


-- ---- 2. REPAIR THE DECAYED TENANT DENORMALISATION --------------------------------------------------
--
-- See the header. Migration 041 ran these two updates once and nothing has maintained them since, so
-- every row created after 041 carries a null tenant_id whatever it actually belongs to.
--
-- These are migration 041 own statements, re-run. They are idempotent by construction: the where clause
-- restricts to rows that are still null, so running this file twice changes nothing the second time.
--
-- !! IT INFERS NOTHING IT CANNOT PROVE. A hospital with no organisation gets no tenant. Four of the ten
-- are in that position and stay null, which is the honest answer rather than a guess that would later be
-- read as a fact somebody established.
update hospitals h set tenant_id = o.tenant_id
  from organisations o
  where h.organisation_id = o.id and h.tenant_id is null and o.tenant_id is not null;

-- Profiles inherit from their hospital. Ordered AFTER the hospital repair on purpose so the 25 profiles
-- whose hospital was itself missing a tenant are covered by the same run.
update profiles p set tenant_id = h.tenant_id
  from hospitals h
  where p.hospital_id = h.id and p.tenant_id is null and h.tenant_id is not null;

-- And from their organisation where they carry one directly. On this database that population is
-- currently zero, but the statement is written for what it MEANS rather than for what today data
-- happens to be.
update profiles p set tenant_id = o.tenant_id
  from organisations o
  where p.organisation_id = o.id and p.tenant_id is null and o.tenant_id is not null;


-- ---- 3. SEED THE TENANT ADMINISTRATORS WHO ALREADY ADMINISTER A TENANT -----------------------------
--
-- !! THIS IS NOT A BLANKET BACKFILL, AND THE DIFFERENCE FROM MIGRATION 279 SECTION 3 MATTERS.
--
-- 279 backfilled every estate identity because the estate was a LIVE PRODUCT and a gate that started
-- refusing before the rows existed would have blanked it for 47 people. There is no Enterprise product
-- yet. Nobody can be locked out of a surface that does not exist, so granting membership broadly here
-- would create access nobody decided -- the very badge this work removes, re-issued under a new name.
--
-- What it does write is the small, named population that ALREADY administers a tenant through the estate
-- role gate, so that when the tenant surfaces move behind this gate (ENT-DEC-001 D11) those people are
-- not locked out of work they do today.
--
-- The predicate reads BOTH role columns, which is migration 279 lesson: 35 of the 47 profiles have an
-- empty roles array and are gated on the role scalar alone. A predicate that looked only at the array
-- would miss them.
--
-- It runs AFTER section 2 on purpose. Ruth Nabwire carries no tenant_id of her own but her hospital
-- does, so she is covered only because the repair ran first. sema Cast has no hospital and no
-- organisation, so no tenant can be inferred and none is invented -- she gets no row, and that is the
-- correct outcome rather than an oversight.
--
-- ON CONFLICT DO NOTHING against the FULL unique index makes this safe to run twice.
insert into enterprise_membership (user_id, tenant_id, status, joined_at, granted_by, source, note)
select
  p.id,
  p.tenant_id,
  'active',
  coalesce(p.created_at, now()),
  null,
  'backfill_legacy',
  'ENT-DEC-001 D4. This person administered a tenant through the estate role gate before gate 3 existed. This row records the access that already existed.'
from profiles p
where p.tenant_id is not null
  and (p.role = 'hospital_admin' or 'hospital_admin' = any(coalesce(p.roles, array[]::text[])))
on conflict (user_id, tenant_id) do nothing;


-- ---- 4. TELL PostgREST ------------------------------------------------------------------------------
notify pgrst, 'reload schema';
