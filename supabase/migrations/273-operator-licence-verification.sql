-- 273: THE OPERATOR LICENCE DOOR -- the capability, the grant, and the ledger of the act.
--
-- docs/PLAT-OVERSIGHT-SURVEY-001.md D5 (s4.3, s5.2), decided 2026-08-09.
--
-- WHAT WAS ALREADY TRUE. Migration 218 gave practice_practitioner_identity three provenance columns
-- (licence_verified_at, licence_verified_by, licence_reference) and made licence_verified a legal
-- lifecycle state. Nothing has ever written them. The PRACTITIONER-facing door is deliberately nailed
-- shut: src/app/api/v1/practice/identity/route.ts refuses any body naming a lifecycle state, because a
-- self-awarded record that somebody checked a licence is worse than no record at all. The OPERATOR-facing
-- door was never built. This migration supplies the data behind it.
--
-- WARNING: THIS IS A WRITE CAPABILITY AND THE ONLY OPERATOR-SIDE WRITE OVER A PRACTITIONER IDENTITY.
-- Survey s5.2 is explicit that modelling it as a view capability would make the catalogue lie about what
-- it permits, which is why hq.practice.licence.verify is minted here rather than folded into
-- hq.practice.operations.view. It is granted to ONE position, practice_product_director (s5.3).
--
-- WARNING: IT DOES NOT AND MUST NOT BECOME A PATIENT-FACING TICK.
-- scripts/practice-booking-link-harness.ts:109-116 records why: the three columns are a PROVENANCE RECORD
-- held internally, that a named person looked at a licence and when. The comp for CPB-002 shows a blue
-- tick, which is a claim TO A PATIENT that somebody checked. Assertion 5b of that harness proves the trio
-- never reaches the public payload. Nothing here widens the public payload, and the harness stays green.
--
-- WARNING: THE LIFECYCLE STATE IS NOT TOUCHED BY THE DOOR THIS ENABLES. The operator surface writes the
-- three provenance columns and never practice_practitioner_identity.status. transitionIdentity in
-- src/lib/practice/identity-service.ts remains the only writer of the lifecycle, and moving an already
-- active identity backwards to licence_verified would take a practitioner out of the state their booking
-- link resolves from. Provenance and lifecycle are different facts and only one of them is an operator
-- concern.
--
-- WARNING: A COMPANION EDIT IS REQUIRED AND IT IS NOT IN THIS FILE.
-- scripts/hq-guard-harness.ts assertion B1 asserts that the applied hq_capability catalogue is EXACTLY
-- HQ_CAPABILITY_CODES in src/lib/hq/spaces.ts, and B5 asserts the applied grants match the seed rows
-- parsed out of migration 264. Applying this file therefore turns B1 and B5 red until BOTH of these land:
--
--   1. src/lib/hq/spaces.ts, in HQ_CAPABILITIES:
--        { code: "hq.practice.licence.verify",      space: "practice" },
--   2. supabase/migrations/264-hq-positions-and-spaces.sql, so a replay of 264 agrees with this database:
--        the same row in the hq_capability seed block, and
--        ('practice_product_director', 'hq.practice.licence.verify', 'position_default')
--        in the hq_position_capability seed block.
--
-- Both files were outside this task's write scope. They are one line each and they are not optional.
--
-- House rules: plain idempotent statements, ASCII only, no PL/pgSQL do-blocks, drop-then-add for
-- constraints, RLS on every new table, and no semicolon anywhere except ending a statement, including
-- inside comments, which silently shredded two sections of migration 238 while still reporting success.

-- ---- 1. THE CAPABILITY -------------------------------------------------------------------------------
--
-- space = practice, matching the CHECK vocabulary in 264 and the space of the surface it gates. The
-- description says what it PERMITS rather than what it is called, because 266 established that a
-- description outrunning its controls is read by the next engineer as a brief.
insert into hq_capability (code, space, label, description) values
  ('hq.practice.licence.verify', 'practice', 'Practitioner Licence Verification',
   'Record that a named operator checked a practitioner licence against a register. Writes licence_verified_at, licence_verified_by and licence_reference on practice_practitioner_identity and nothing else. Never the lifecycle state, and never anything a patient sees.')
on conflict (code) do nothing;

-- ---- 2. THE GRANT ------------------------------------------------------------------------------------
--
-- ONE position. practice_product_director already holds hq.practice.operations.view (264 s10) and is the
-- position the survey names for this at s5.3. platform_director deliberately does NOT get it: a platform
-- engineer diagnosing a provisioning saga has no business recording that a licence was checked.
--
-- ogs_office_appointments is empty, so this grants no human anything today.
insert into hq_position_capability (position_code, capability_code, source) values
  ('practice_product_director', 'hq.practice.licence.verify', 'position_default')
on conflict (position_code, capability_code) do nothing;

-- ---- 3. THE LEDGER OF THE ACT ------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT JUST THE THREE COLUMNS. The columns on the identity hold CURRENT STATE: one
-- verification overwrites the last, and the record of who checked what, when, against which register is
-- gone. A provenance claim whose own history can be silently replaced is the thing 218 was trying not to
-- build. This table is the append-only record of each act, and the identity columns are its projection.
--
-- Its subject is a practitioner, so it is named practice_*, and it therefore falls under the platform
-- plane data boundary in src/lib/access/plane-boundary.ts. It is declared there FILE-SCOPED, to the one
-- module that operates this door, so the rest of the platform plane still cannot read it.
create table if not exists practice_licence_verification (
  id                uuid primary key default gen_random_uuid(),
  identity_id       uuid not null references practice_practitioner_identity(id) on delete cascade,
  -- Copied at the time of the act, because the identity outlives any one practice and primary_workspace_id
  -- is nullable and can move. Null means the practitioner had no practice at the moment of verification,
  -- which is a real state and not a missing value.
  workspace_id      uuid,
  verified_by       uuid references profiles(id) on delete set null,
  verified_by_name  text,
  licence_reference text not null,
  register          text,
  note              text,
  recorded_at       timestamptz not null default now()
);

alter table practice_licence_verification drop constraint if exists practice_licence_verification_reference_check;
alter table practice_licence_verification add constraint practice_licence_verification_reference_check
  check (btrim(licence_reference) <> '');

create index if not exists idx_practice_licence_verification_identity
  on practice_licence_verification (identity_id, recorded_at desc);
create index if not exists idx_practice_licence_verification_operator
  on practice_licence_verification (verified_by, recorded_at desc);

-- RLS on, no policy: the same posture as every other practice_* table (191:319-332). The service-role
-- client used by the operator surface bypasses RLS. An authenticated practitioner reaches nothing here
-- directly, and sees the act through their own practice_audit_event trail instead.
alter table practice_licence_verification enable row level security;

-- ---- 4. A TICK WITH NOBODY BEHIND IT IS REFUSED BY THE DATABASE --------------------------------------
--
-- 218's own comment beside these columns: not a boolean, because a tick with nobody behind it is the
-- claim CPR-240 refused. That was a comment. This is the constraint.
--
-- WARNING: A CHECK FAILS IF AN EXISTING ROW VIOLATES IT. Queried before writing this file: 45 identity
-- rows exist and ZERO have licence_verified_at set, so nothing existing violates it.
alter table practice_practitioner_identity drop constraint if exists practice_identity_licence_provenance_check;
alter table practice_practitioner_identity add constraint practice_identity_licence_provenance_check
  check (
    licence_verified_at is null
    or (licence_verified_by is not null and btrim(coalesce(licence_reference, '')) <> '')
  );

notify pgrst, 'reload schema';
