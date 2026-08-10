-- ====================================================================================================
-- MIGRATION 279: PLATFORM MEMBERSHIP BECOMES A FACT, NOT AN ASSUMPTION
--
-- COMP-ARCH-PSA-001 section 7 (product membership) and section 44 ("shared identity does not grant
-- product membership"). CP-SPLIT-002 stage 1.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- Today every identity on this database is a Competen Platform member BY CONSTRUCTION, because
-- profiles.role is NOT NULL with a default of 'nurse', so there is no way to write down "this person
-- exists but is not on the estate". This file makes that sentence writable.
--
-- ----------------------------------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING. THIS FILE CHANGES WHO MAY ENTER THE ESTATE.
--
-- The dangerous failure here is NOT letting somebody in. It is LOCKING THE OWNERS OUT of the console
-- they would use to undo a mistake. There are two super_admin accounts on this database and nobody
-- above them. So:
--
--   1. THE BACKFILL IS IN THIS FILE, in section 3, in the same transaction-free run as the table.
--      A gate that starts refusing before the rows exist blanks the platform for all 47 people. The
--      table and its rows arrive together or not at all.
--   2. THE APPLICATION GATE NEVER READS THIS TABLE FOR A super_admin. src/lib/platform-membership.ts
--      short-circuits on the owner role BEFORE the read, exactly as src/app/super-admin/layout.tsx
--      already does for HQ. No state of this table -- missing, empty, half-written, or mid-ALTER --
--      can shut the two owner accounts out.
--   3. A FAILED READ OF THIS TABLE IS NOT "NOBODY IS A MEMBER". The guard reports three states, and
--      the unreadable one falls back to the role gate that was there yesterday rather than revoking
--      the estate for everybody. The reasoning is written out in the guard module.
--
-- ----------------------------------------------------------------------------------------------------
-- LIVE STATE READ BACK BEFORE WRITING THIS FILE (not assumed from a migration, which is not evidence):
--
--   profiles                      47 rows
--   profiles with a null role     0
--   role histogram                nurse 37, hospital_admin 4, educator 3, super_admin 2, assessor 1
--   profiles with an empty roles  35 (they fall back to the role scalar, which is why the backfill
--                                     predicate below looks at BOTH columns)
--   platform_membership           does not exist (PGRST205 on a real select -- note that a head+count
--                                                 probe returns count=null with NO error on a missing
--                                                 table, so it proves nothing)
--   practice_membership           4 rows, 2 distinct user_id, ONE of which has a profile row
--   the one real dual-product person  Mullen E., mullen.elisha777@gmail.com, role nurse
--
-- Every value the CHECK constraints below admit was compared against that histogram first. No existing
-- row can violate any constraint in this file, because the only table it constrains is created here and
-- is empty until section 3.
--
-- ----------------------------------------------------------------------------------------------------
-- THE TRAPS THIS FILE WAS WRITTEN AROUND.
--
--   1. NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT. One inside a
--      comment shredded two sections of migration 238 while still reporting success.
--   2. NO -- SEQUENCE INSIDE A STRING LITERAL. The one literal in this file was checked by eye.
--   3. NO do-blocks, no plpgsql, no functions. Plain statements only.
--   4. THE UPSERT TARGET IS A FULL UNIQUE INDEX ON ONE NOT NULL COLUMN. A partial unique index is an
--      upsert that silently writes nothing, and that has already cost this codebase two silent write
--      failures. ux_platform_membership_user has no WHERE clause and never will.
--   5. ASCII ONLY.
--   6. notify pgrst LAST, so PostgREST does not cache a schema that is only half applied.
-- ====================================================================================================


-- ---- 1. THE MEMBERSHIP STORE -----------------------------------------------------------------------
--
-- ONE ROW PER IDENTITY. Section 7 of the architecture writes it plural (platform_memberships) but the
-- thing an identity has more than one of on the estate is a FACILITY membership -- profiles.hospital_id
-- and the organisation columns already carry that, and they are a different question. Belonging to the
-- PRODUCT is a single fact with a single status, so this is one row, enforced by a unique index, and a
-- suspension is a status change rather than a second row. That also makes the gate a single-row read on
-- every request, which matters because it runs in eleven layouts.
--
-- WHAT IS DELIBERATELY ABSENT: there is no role column here, and there must never be one. Adding a
-- platform membership must not add an estate role, and granting an estate role must not add a
-- membership -- they are two independent facts, and a role column here would be the first place
-- somebody derived one from the other. Roles live in profiles.role / profiles.roles, where they
-- already are.
create table if not exists platform_membership (
  id uuid primary key default gen_random_uuid(),

  -- THE IDENTITY, and the foreign key is the point. A membership belonging to nobody is not a fact,
  -- and when an account is deleted its membership must go with it -- otherwise a recycled uuid would
  -- inherit somebody else's product access. profiles is the identity table on this database (it is
  -- itself a foreign key onto auth.users with the same cascade).
  user_id uuid not null references profiles(id) on delete cascade,

  -- TWO STATES A ROW CAN HOLD, THREE THE GUARD REPORTS. 'active' admits. 'suspended' and 'revoked' do
  -- not. "could not be read" is NOT a state a row can hold -- it is what the guard says when this table
  -- does not answer, and it must never be flattened into either of these. See section 30 of the
  -- architecture: product membership suspension affects only the relevant product, so nothing here
  -- touches the identity or the practice.
  status text not null default 'active',

  -- SECTION 7 ASKS FOR MEMBERSHIP, AND THESE THREE COLUMNS ARE WHY IT IS A TABLE AND NOT A NULLABLE
  -- COLUMN ON profiles. A null cannot say when somebody joined the product or who let them in.
  joined_at timestamptz not null default now(),
  granted_by uuid references profiles(id) on delete set null,

  -- HOW THIS ROW CAME TO BE. 'backfill_legacy' is section 3 of this file and means "membership was
  -- implicit before migration 279, and this row is that implicit fact written down" -- it is not
  -- evidence that anybody decided anything. The other three are real provisioning events.
  source text not null default 'explicit_grant',

  suspended_at timestamptz,
  suspended_by uuid references profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,

  -- Free text, optional, never required. A required reason field is a field people type "x" in.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table platform_membership drop constraint if exists platform_membership_status_check;
alter table platform_membership add constraint platform_membership_status_check
  check (status in ('active', 'suspended', 'revoked'));

alter table platform_membership drop constraint if exists platform_membership_source_check;
alter table platform_membership add constraint platform_membership_source_check
  check (source in ('backfill_legacy', 'platform_signup', 'admin_grant', 'explicit_grant'));

-- FULL unique index on one NOT NULL column. This is what the backfill's ON CONFLICT and every
-- application-side upsert target. See trap 4 in the header.
create unique index if not exists ux_platform_membership_user
  on platform_membership(user_id);

create index if not exists idx_platform_membership_status
  on platform_membership(status);

alter table platform_membership enable row level security;

-- ONE POLICY, AND IT IS A READ OF YOUR OWN ROW. Every gate in the application reads this table with the
-- service role, which bypasses RLS entirely, so the product does not need a policy to function. This one
-- exists so that a future product switcher can ask "do I hold Platform?" from the browser without a
-- server round trip, and it discloses nothing the viewer does not already know about themselves.
--
-- THERE IS NO INSERT, UPDATE OR DELETE POLICY. Granting yourself product membership from a browser
-- session is precisely the escalation migration 249 closed on profiles, arriving through a new door.
-- Writes happen with the service role or not at all.
drop policy if exists platform_membership_read_own on platform_membership;
create policy platform_membership_read_own on platform_membership
  for select using (auth.uid() = user_id);

comment on table platform_membership is
  'COMP-ARCH-PSA-001 s7. Explicit membership of the Competen Platform product (gate 1). Absence of a row means no platform access. This is NOT an estate role and carries none. Roles live in profiles.role / profiles.roles. It is also NOT practice_membership, which is gate 2 and is entirely independent: neither table is read to decide anything about the other, and there is no foreign key between them.';

comment on column platform_membership.status is
  'active admits. suspended and revoked do not. "unreadable" is NOT a value here. It is a third state the application guard reports when this table does not answer, and folding it into a refusal would blank the estate for everybody during an outage.';

comment on column platform_membership.source is
  'backfill_legacy means migration 279 wrote down a membership that was implicit before it existed. It is not evidence of a decision by a person.';


-- ---- 2. profiles.role MAY NOW BE NULL --------------------------------------------------------------
--
-- !! THIS IS THE HALF OF THE CHANGE THAT LOOKS SMALLEST AND MATTERS MOST.
--
-- Section 8 of the architecture: "Profession: Nurse is a professional characteristic. It DOES NOT mean
-- Platform Role: Nurse." Section 11 forbids Practice registration from assigning a Platform Nurse role.
-- Practice signup wrote role 'nurse' twice for exactly one reason -- the column is NOT NULL, so it had
-- to write SOMETHING, and the only values the CHECK admits are estate roles.
--
-- After this statement, "no estate role" is expressible. highestRole() already returns null for it.
--
-- WHY THIS IS SAFE ON THE 47 EXISTING ROWS: dropping NOT NULL only PERMITS null. It writes nothing and
-- changes no stored value. Nothing begins producing nulls except the two code paths that are supposed
-- to (Practice signup, and migration 280's single named account).
--
-- WHY THE DATABASE FUNCTIONS SURVIVE IT: current_user_is_super_admin() tests role = 'super_admin'
-- inside an EXISTS, and a null there is simply not a match. profile_authority_unchanged() (migration
-- 249) compares with IS NOT DISTINCT FROM throughout, which was chosen precisely because most of these
-- columns are null on most rows. handle_new_user() always writes a non-null value and is untouched.
alter table profiles alter column role drop not null;

-- The CHECK is restated rather than left alone, because a reader looking at this constraint must be
-- able to see that null is INTENDED and not an oversight. A CHECK already passes on null (null in (...)
-- evaluates to null, and a CHECK fails only on false), so this changes no behaviour -- it changes what
-- the next person reads.
--
-- The value list is migration 008's, unchanged. It was compared against the live histogram above before
-- this drop-then-add was written: every stored value is inside it, so this cannot fail on an existing
-- row.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role is null or role in
    ('nurse', 'assessor', 'educator', 'hospital_admin', 'country_admin', 'group_admin', 'super_admin'));

comment on column profiles.role is
  'The estate (Competen Platform) role, or NULL for an identity that is not on the estate at all. NULL is a legitimate value as of migration 279. A Competen Practice practitioner who has never seen a ward holds one. It is NOT the profession: see profiles.specialization and practice_practitioner_identity.self_declared_profession for that.';


-- ---- 3. THE BACKFILL -- EVERY EXISTING ESTATE IDENTITY GETS AN EXPLICIT ROW ------------------------
--
-- !! THIS RUNS IN THE SAME FILE AS THE TABLE ON PURPOSE. BACKFILL BEFORE ENFORCE.
--
-- The alternative -- ship the table now, populate it later, read absence as "legacy member until
-- touched" -- is an implicit rule that decays, and an implicit rule that decayed is how the product
-- arrived at this problem. Every one of the 47 identities that holds an estate role today gets a row
-- saying so, and from this migration onward absence of a row means exactly what section 7 says it
-- means.
--
-- THE PREDICATE READS BOTH ROLE COLUMNS. 35 of the 47 profiles have an empty roles[] array and are
-- gated on the role scalar alone, while 12 carry the array -- every layout in the product resolves
-- them as (roles?.length ? roles : [role]), and this predicate is the SQL of that same expression. A
-- predicate that looked only at roles[] would have missed 35 people, which is a lockout.
--
-- IT IS NOT "every profile". A row with no role in either column is an identity with no estate
-- standing, and giving it one here would re-issue the very badge this work removes. Today the live
-- count of such rows is zero, so on this database the backfill covers all 47 -- but the predicate is
-- written for what it MEANS, not for what today's data happens to be.
--
-- ON CONFLICT DO NOTHING against the FULL unique index makes this safe to run twice, and safe to run
-- after section 4 of migration 280 has already removed somebody: re-running 279 will NOT resurrect a
-- membership that a later migration deliberately withdrew, because 280 also clears the role columns
-- that this predicate reads. That ordering was checked, not hoped for.
insert into platform_membership (user_id, status, joined_at, granted_by, source, note)
select
  p.id,
  'active',
  coalesce(p.created_at, now()),
  null,
  'backfill_legacy',
  'CP-SPLIT-002 stage 1. Platform membership was implicit for every profile before migration 279. This row records the fact that already existed.'
from profiles p
where coalesce(nullif(trim(p.role), ''), '') <> ''
   or coalesce(array_length(p.roles, 1), 0) > 0
on conflict (user_id) do nothing;


-- ---- 4. TELL PostgREST ------------------------------------------------------------------------------
notify pgrst, 'reload schema';
