-- ====================================================================================================
-- MIGRATION 403: COMPETEN SCHOLAR -- A RECORDED ADULT-AGE DECLARATION FOR SELF-ACTIVATION
--
-- !! APPLY THIS FILE WHOLE. It contains one plpgsql trigger function. A runner that splits on semicolons
-- !! would cut the function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-SCHOLAR-JOIN-01 Stage 1 Join, J1-J3. Owner ruling (AGE): keep 18+. For self-registration, an
-- explicit adult-age DECLARATION, recorded with a timestamp and an eligibility-policy version. It is
-- self-declaration, not verified age. No identity documents, no external age-verification service. Public
-- self-registration stays DISABLED (individual_self_registration, no row, so OFF) pending legal confirmation
-- and a separate production approval. Reserved number 403. Build record:
-- docs/COMPETEN-SCHOLAR-JOIN-01-stage1-join.md.
--
-- APPLY ON STAGING FIRST. It creates one table and one trigger function, and adds one nullable column and
-- one CHECK to individual_entitlement (migration 370). It changes no existing row and no existing
-- constraint, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT CHANGES ABOUT D8, EXACTLY.
--
-- The 370 CHECK individual_entitlement_scholar_adult is UNCHANGED: a Scholar period still cannot be stored without
-- adult_confirmed_at. What changes is what may stand behind that timestamp:
--
--   HQ-confirmed    adult_declaration_id is null. The HQ act as before (grants.ts, invitations.ts), with
--                   adult_confirmed_by naming the administrator while that profile exists.
--   self-declared   adult_declaration_id names the own declaration of the person in individual_age_declaration,
--                   and adult_confirmed_by is null. adult_confirmed_at is the time of the declaration.
--
-- The new CHECK makes the two exclusive: a period is never both HQ-confirmed and self-declared, so which
-- evidence model stands behind any Scholar period is always readable from the row. This is an EVIDENCE-MODEL
-- CHANGE and is recorded as an owner decision in the build record, not treated as settled.
--
-- WHY THE DECLARATION IS ITS OWN TABLE. The declaration is an act of the person, made once, with the words and
-- the policy version they saw. Several entitlement periods (a self-activation, a later renewal) may rest on
-- it. Copying it onto each period would let the copies disagree.
--
-- APPEND-ONLY. An UPDATE is always refused: a declaration is never edited into a different one. DELETE is
-- allowed, so a cascade from profiles and erasure work -- but not while a Scholar period still rests on it
-- (the foreign key below), so the evidence behind live access cannot be removed from under it.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. APPLY-WHOLE banner above (plpgsql).
--   No partial unique indexes. RLS on, own-row SELECT policy only. notify pgrst last.
--
-- ROLLBACK (staging): docs/COMPETEN-SCHOLAR-JOIN-01-stage1-join.md, section Rollback.
-- ====================================================================================================


-- ---- 1. individual_age_declaration -----------------------------------------------------------------

create table if not exists individual_age_declaration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  declared_at timestamptz not null default now(),
  policy_version text not null,
  statement text not null,
  source text not null,
  created_at timestamptz not null default now()
);

alter table individual_age_declaration drop constraint if exists individual_age_declaration_shape;
alter table individual_age_declaration add constraint individual_age_declaration_shape check (
  char_length(btrim(policy_version)) between 1 and 60
  and char_length(btrim(statement)) between 10 and 500
);

-- self_activation: an existing Competen account activating Scholar (J1). self_registration: a new account
-- made through the Scholar join (J2). Both are self-declaration. Neither is verified age.
alter table individual_age_declaration drop constraint if exists individual_age_declaration_source_check;
alter table individual_age_declaration add constraint individual_age_declaration_source_check
  check (source in ('self_activation', 'self_registration'));

create index if not exists idx_individual_age_declaration_user
  on individual_age_declaration(user_id, declared_at desc);

alter table individual_age_declaration enable row level security;

drop policy if exists individual_age_declaration_read_own on individual_age_declaration;
create policy individual_age_declaration_read_own on individual_age_declaration
  for select using (auth.uid() = user_id);

comment on table individual_age_declaration is
  'COMPETEN-SCHOLAR-JOIN-01. A person''s own declaration that they are 18 or over, with the words shown and the eligibility-policy version. Self-declaration, not verified age. Append-only. Service-role write, own-row read.';


-- ---- 2. APPEND-ONLY ----------------------------------------------------------------------------------

create or replace function individual_age_declaration_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'individual_age_declaration is append-only: a declaration cannot be edited';
end
$$;

drop trigger if exists trg_individual_age_declaration_append_only on individual_age_declaration;
create trigger trg_individual_age_declaration_append_only
  before update on individual_age_declaration
  for each row execute function individual_age_declaration_append_only();


-- ---- 3. A SCHOLAR PERIOD NAMES THE DECLARATION IT RESTS ON -------------------------------------------

alter table individual_entitlement add column if not exists adult_declaration_id uuid references individual_age_declaration(id);

alter table individual_entitlement drop constraint if exists individual_entitlement_adult_basis_exclusive;
alter table individual_entitlement add constraint individual_entitlement_adult_basis_exclusive
  check (adult_declaration_id is null or adult_confirmed_by is null);

create index if not exists idx_individual_entitlement_adult_declaration
  on individual_entitlement(adult_declaration_id);


-- Verification: the table with RLS and one policy, the trigger, the new column and CHECK, zero declarations,
-- and zero entitlement rows naming one.
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       (select count(*) from individual_age_declaration) as declarations
  from pg_class c where c.relname = 'individual_age_declaration';

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname = 'individual_entitlement_adult_basis_exclusive';

select count(*) as periods_on_a_declaration from individual_entitlement where adult_declaration_id is not null;

notify pgrst, 'reload schema';
