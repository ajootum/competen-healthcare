-- ============================================================
-- MIGRATION 270: THE PROFESSIONAL RECORD BELONGS TO THE PERSON (CPR-IDENT-SURVEY-001 D1, D2)
--
-- WARNING: THIS MIGRATION SETTLES A CONTRADICTION BETWEEN TWO EARLIER ONES, DELIBERATELY AND BY DECISION.
--
-- Migration 217 scoped the professional portfolio to the WORKSPACE and argued for it in as many
-- words: "One row per person per workspace" (217:47). Migration 218 scoped the practitioner identity
-- to the PERSON and argued the opposite: "if this row were scoped to a workspace, the workspace
-- cascade would delete the identity along with it" (218:12-14). Both are reasoned, both are in the
-- repository, and they cannot both be right about the same person.
--
-- 218'S DOCTRINE WINS. 217'S ARGUMENT IS SUPERSEDED HERE, NAMED RATHER THAN QUIETLY OUTVOTED -- two
-- contradictory headers with no resolution between them is exactly how this came about. Nothing in
-- 217 was wrong about a consultation. It was wrong about a portfolio: a qualification, a publication,
-- a fellowship and a registration number describe the PERSON, and the practice merely hosted the
-- typing.
--
-- THE FAILURE THIS FIXES NEEDED NO DELETE. access.ts refuses entry to an ARCHIVED, SUSPENDED, CLOSING
-- or CLOSED practice and every portfolio read was filtered on workspace_id, so archiving a practice
-- and opening another rendered the portfolio EMPTY AND CORRECT-LOOKING. Nothing was deleted. The
-- record was unreachable by the only person entitled to it.
--
-- WARNING: PRECONDITION, VERIFIED BEFORE THIS WAS WRITTEN: practice_practitioner_profile and
-- practice_portfolio_entry both held ZERO rows on 2026-08-09. Section 4 carries anything that has
-- appeared since onto the identity before the retired table is dropped, so applying this later is not
-- a data loss. Section 4 is the ONE part that is not re-runnable, because the table it reads from is
-- gone once it has run. A second run fails loudly there and undoes nothing.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql.
-- ============================================================

-- ---- 1. The declared entry becomes person-scoped, and the workspace becomes PROVENANCE ------------
--
-- Not "where this may be read" but "where this was entered". NULLABLE, ON DELETE SET NULL: the exact
-- shape migration 218 already uses for primary_workspace_id, so this is this codebase's established
-- pattern rather than a new one. Keeping the pointer is what lets an erasure or subject-access
-- enquiry against the old practice still find an entry that mentions one of its patients. Dropping
-- the column would make the entry portable AND untraceable, which trades one data-protection problem
-- for a worse one.

alter table practice_portfolio_entry drop constraint if exists practice_portfolio_entry_workspace_id_fkey;
alter table practice_portfolio_entry drop constraint if exists practice_portfolio_entry_workspace_provenance_fk;
alter table practice_portfolio_entry alter column workspace_id drop not null;
alter table practice_portfolio_entry add constraint practice_portfolio_entry_workspace_provenance_fk
  foreign key (workspace_id) references practice_workspace(id) on delete set null;

-- The reads are by person now. Both old indexes led with workspace_id, which is no longer the scope
-- of any query in the engine, and a leading column nothing filters on is an index that never opens.

drop index if exists idx_practice_portfolio_entry_user;
drop index if exists idx_practice_portfolio_entry_expiry;
create index if not exists idx_practice_portfolio_entry_person
  on practice_portfolio_entry(user_id, kind, occurred_on desc);
create index if not exists idx_practice_portfolio_entry_person_expiry
  on practice_portfolio_entry(user_id, expires_on) where expires_on is not null;
-- And one for the provenance question, which is asked of the PRACTICE rather than of the person:
-- "which entries were typed here" -- the whole-practice export, and any erasure enquiry.
create index if not exists idx_practice_portfolio_entry_provenance
  on practice_portfolio_entry(workspace_id) where workspace_id is not null;

-- ---- 2. The self-declared professional facts move onto the identity ------------------------------
--
-- WARNING: THE PROVENANCE TRAVELS IN THE COLUMN NAME, AND THAT IS THE WHOLE POINT OF THIS SECTION.
--
-- practice_practitioner_identity already carries licence_verified_at, licence_verified_by and
-- licence_reference: a state that is true because a NAMED PERSON recorded that they looked. A
-- registration number is a string somebody typed about themselves. Putting the second beside the
-- first under a bare name like registration_number would manufacture exactly the assurance 217 and
-- 218 both refuse, because a reader of select *, of an export, or of a JSON key sees a licence
-- reference and a registration number side by side and reads both as checked.
--
-- So the name carries it. self_declared_registration_number is self-declared in every select, every
-- export, every log line and every payload key, and there is no way to render it that drops the word.
-- A comment can be deleted in a refactor. A column name cannot be, silently.
--
-- WARNING: AND NOT A PROVENANCE COLUMN, DELIBERATELY. 217:116-117 refused one for this table and the reason
-- holds here: "a column that is always the same value invites somebody to set it to the other one".

alter table practice_practitioner_identity add column if not exists self_declared_profession text;
alter table practice_practitioner_identity add column if not exists self_declared_registration_number text;
alter table practice_practitioner_identity add column if not exists self_declared_registration_body text;
alter table practice_practitioner_identity add column if not exists self_declared_registration_expires_on date;
alter table practice_practitioner_identity add column if not exists self_declared_practising_since date;

-- ---- 3. A LICENCE CANNOT HAVE BEEN CHECKED BY NOBODY ----------------------------------------------
--
-- The other half of keeping the two apart, and this half is enforced by the database rather than
-- named. 218:79-80 says a tick with nobody behind it is the claim CPR-240 refused, but nothing
-- stopped a row carrying licence_verified_at with a null licence_verified_by, which IS that tick. Now
-- the state cannot exist without the id of the person who recorded that they looked. All 43 live
-- identities hold null in both columns and pass unchanged.

alter table practice_practitioner_identity drop constraint if exists practice_identity_licence_has_a_verifier;
alter table practice_practitioner_identity add constraint practice_identity_licence_has_a_verifier
  check ((licence_verified_at is null and licence_verified_by is null)
      or (licence_verified_at is not null and licence_verified_by is not null));

-- ---- 4. Carry the retired table forward, then retire it -------------------------------------------
--
-- WARNING: THE ONE NON-RE-RUNNABLE SECTION. See the precondition in the header.
--
-- Two person-scoped tables describing one person is the duplication the survey found, preserved under
-- a new name, so the profile is RETIRED rather than re-keyed. coalesce() throughout: the identity is
-- the surviving record and nothing already on it is overwritten by a copy from the table being
-- dropped. distinct on picks the most recently updated profile row for anybody who has more than one.

update practice_practitioner_identity i set
  self_declared_profession = coalesce(i.self_declared_profession, p.profession),
  self_declared_registration_number = coalesce(i.self_declared_registration_number, p.registration_number),
  self_declared_registration_body = coalesce(i.self_declared_registration_body, p.registration_body),
  self_declared_registration_expires_on = coalesce(i.self_declared_registration_expires_on, p.registration_expires_on),
  self_declared_practising_since = coalesce(i.self_declared_practising_since, p.practising_since),
  specialties = coalesce(i.specialties, nullif(btrim(concat_ws(', ', p.specialty, p.sub_specialty)), '')),
  biography = coalesce(i.biography, nullif(btrim(p.summary), '')),
  display_name = case
    when char_length(btrim(coalesce(p.full_name, ''))) between 2 and 120 then btrim(p.full_name)
    else i.display_name end,
  updated_at = now()
from (select distinct on (user_id) * from practice_practitioner_profile order by user_id, updated_at desc) p
where p.user_id = i.user_id;

drop table if exists practice_practitioner_profile;

-- ---- 5. RLS: deny-by-default, unchanged -----------------------------------------------------------

alter table practice_portfolio_entry enable row level security;
alter table practice_practitioner_identity enable row level security;

notify pgrst, 'reload schema';
