-- 278-practice-capability-activation.sql
--
-- CPR-CAP-001 (Practice Configuration and Capability Activation Framework), sections 3, 4, 5, 6 and 8.
--
-- ====================================================================================================
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- A practitioner should be able to buy booking and nothing else, become operational without ever
-- configuring clinical capture, and switch more on later. That requires somewhere to record WHAT THIS
-- PRACTICE HAS SWITCHED ON. There was nowhere. This is it.
--
-- ====================================================================================================
-- WARNING: THIS IS NOT THE OTHER KIND OF CAPABILITY. READ THIS BEFORE TOUCHING EITHER TABLE.
--
-- Competen Practice already has a thing called a capability, in practice_role_assignment.capability_code
-- and practice_role_capabilities. Codes like patient.edit, encounter.edit and practice.settings.manage.
-- Those answer "WHAT MAY THIS USER DO". They are checked by requirePracticeContext and hasCapability.
-- They are SECURITY.
--
-- The CP.* codes in THIS file answer "WHAT HAS THIS PRACTICE SWITCHED ON". They are COMMERCIAL.
--
-- The two are INDEPENDENT and the effective gate on any surface is BOTH of them: the practice has
-- activated the capability AND the user holds the permission.
--
--   * Deactivating CP.ENCOUNTERS must NOT revoke anybody's encounter.edit grant.
--   * Granting encounter.edit must NOT activate CP.ENCOUNTERS.
--
-- Nothing in this migration writes to practice_role_assignment, practice_role_capabilities or
-- practice_membership, and nothing in those tables is read to decide what is here. There is no foreign
-- key between the two planes and there must never be one, because a foreign key is how the first
-- accidental derivation gets written.
--
-- It is also NOT plat_feature_flags, which is TENANT scoped for the hospital estate and is read by
-- /api/platform/tenants. Different plane, different tenancy, different readers.
--
-- ====================================================================================================
-- ABSENCE OF A ROW IS NOT "OFF". IT IS THE REGISTRY DEFAULT.
--
-- Every practice that exists on the day this is applied has zero rows here. If absence meant inactive,
-- all of them would read as having no Calendar and no Patient Register the moment anything started
-- consulting this table, which is the same failure as treating a failed read as a zero, arriving by a
-- different door.
--
-- So the engine resolves a missing row to the s4 default: CP.CALENDAR and CP.PATIENTS are On, CP.BOOKING
-- is on only in the Booking preset, everything else is Optional. This table records the DEPARTURES. It
-- is migration 275 section 3's reasoning, and this migration deliberately SEEDS NOTHING for the same
-- reason: a backfill would turn a default that can be changed later into a decision somebody has to undo.
--
-- ====================================================================================================
-- WHY THERE IS NO APPEND-ONLY TRIGGER ON THE EVENT TABLE, WHICH IS A DELIBERATE DECISION.
--
-- s8 requires every activation and deactivation to be auditable, and the tamper-evident trail for that
-- is practice_audit_event, which migration 247 already made append-only with a trigger that refuses
-- DELETE outright. The engine writes there on every change.
--
-- practice_capability_activation_event below is the QUERYABLE PROJECTION of the same facts, so that
-- "when was Documents switched off, by whom, and what was on before" is one indexed read rather than a
-- scan of a generic jsonb payload. It is NOT given a DELETE-refusing trigger, and the reason is written
-- down in scripts/_cleanup.ts: practice_lifecycle_transition holds the workspace with no on-delete
-- clause AND refuses DELETE, which makes any workspace that has one PERMANENTLY UNDELETABLE. A second
-- table with that shape would strand every harness fixture and every closed practice. This one cascades.
--
-- ====================================================================================================
-- THE TRAPS THIS FILE WAS WRITTEN AROUND.
--
--   1. NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT. One in a comment
--      shredded two sections of migration 238 while still reporting success.
--   2. NO plpgsql, no do blocks, no functions. The runner splits on semicolons.
--   3. NO CHECK CONSTRAINT CAN FAIL ON AN EXISTING ROW, because both tables are created here and both
--      are empty. Probed live before writing: PGRST205, neither table exists.
--   4. THE UNIQUE INDEX THE ENGINE UPSERTS AGAINST IS A FULL INDEX ON TWO NOT NULL COLUMNS. PostgREST
--      cannot express a partial index predicate in on_conflict, so a partial unique index is an upsert
--      that silently writes nothing. That trap has already cost this codebase two silent write failures.
--   5. ASCII ONLY.
-- ====================================================================================================

-- ---- 1. THE ACTIVATION STORE -- s3's practice level, "active capabilities" -------------------------
--
-- ONE ROW PER PRACTICE PER CAPABILITY, holding the CURRENT state and who put it there. The history is
-- next door, so this table can be read cheaply on every request without a window function.
--
-- capability_code is CHECKED against s4's twelve rather than left open. A typo that reaches this table
-- as a thirteenth code would be invisible: the resolver would never ask for it, so it would sit there
-- looking like a product somebody bought. A refused insert is a bug report.
create table if not exists practice_capability_activation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  capability_code text not null,
  -- TWO STATES HERE, THREE IN THE ENGINE. A row says active or inactive. "Could not be read" is not a
  -- state a row can hold, it is what the ENGINE reports when this table does not answer, and it must
  -- never be flattened into either of these.
  state text not null default 'active',
  -- HOW THIS ROW CAME TO BE, which s8 needs and a practitioner deserves. 'explicit' is somebody pressing
  -- the switch. 'dependency' is s6 bullet two, activated in the same flow as the thing that needed it.
  -- 'mode_preset' is s5.
  source text not null default 'explicit',
  -- PROVENANCE ONLY, AND THIS IS THE MOST IMPORTANT COMMENT IN THE FILE.
  --
  -- s5: "Modes are presets only. A practice may activate or deactivate individual capabilities subject
  -- to dependency rules." So there is NO mode column on the workspace and NO practice tier anywhere in
  -- this schema. This column records which preset last wrote THIS ROW, for the audit trail and for the
  -- console to say "Booking Only switched this on for you". The resolver does not read it, nothing
  -- decides availability from it, and a practice that switches a capability by hand overwrites it to
  -- null. A mode cannot override an individual choice because no reader of this schema ever consults a
  -- mode to find out what is active.
  mode_code text,
  activated_at timestamptz,
  activated_by uuid,
  deactivated_at timestamptz,
  deactivated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practice_capability_activation drop constraint if exists practice_capability_activation_code_check;
alter table practice_capability_activation add constraint practice_capability_activation_code_check
  check (capability_code in (
    'CP.BOOKING', 'CP.CALENDAR', 'CP.PATIENTS', 'CP.FOLLOWUPS', 'CP.ENCOUNTERS',
    'CP.INVESTIGATIONS', 'CP.MEDICATIONS', 'CP.PROCEDURES', 'CP.DOCUMENTS',
    'CP.CLOSE_DAY', 'CP.INTELLIGENCE', 'CP.AI_ASSIST'));

alter table practice_capability_activation drop constraint if exists practice_capability_activation_state_check;
alter table practice_capability_activation add constraint practice_capability_activation_state_check
  check (state in ('active', 'inactive'));

alter table practice_capability_activation drop constraint if exists practice_capability_activation_source_check;
alter table practice_capability_activation add constraint practice_capability_activation_source_check
  check (source in ('explicit', 'dependency', 'mode_preset', 'provisioning_default'));

alter table practice_capability_activation drop constraint if exists practice_capability_activation_mode_check;
alter table practice_capability_activation add constraint practice_capability_activation_mode_check
  check (mode_code is null or mode_code in (
    'booking_only', 'organise_practice', 'remember_patients', 'intelligent_practice'));

-- An ACTIVE row records when and by whom. An INACTIVE row records when and by whom it was switched off,
-- and KEEPS the activation stamps, because "switched on in March and off in July" is one fact and losing
-- half of it makes the remaining half misleading.
alter table practice_capability_activation drop constraint if exists practice_capability_activation_stamps;
alter table practice_capability_activation add constraint practice_capability_activation_stamps
  check ((state = 'active' and activated_at is not null)
         or (state = 'inactive' and deactivated_at is not null));

-- FULL unique index on two NOT NULL columns -- see trap 4 in the header. This is what the engine's
-- upsert targets, and it is what makes concurrent activation of a shared dependency safe.
create unique index if not exists ux_practice_capability_activation
  on practice_capability_activation(workspace_id, capability_code);
create index if not exists idx_practice_capability_activation_state
  on practice_capability_activation(workspace_id, state);

alter table practice_capability_activation enable row level security;

comment on table practice_capability_activation is
  'CPR-CAP-001 s4. What a PRACTICE has switched on (commercial activation). This is NOT practice_role_assignment, which is what a USER may do (security permission). The two are independent and both must hold for a surface to be available. Absence of a row means the s4 registry default, not off.';

comment on column practice_capability_activation.mode_code is
  'Provenance only. Which s5 preset last wrote this row. NOT a stored tier: nothing reads a mode to decide what is active, so an individual choice always wins.';

-- ---- 2. THE ACTIVATION HISTORY -- s8 "Every activation/deactivation is auditable" ------------------
--
-- WARNING: DEACTIVATION IS A VISIBILITY DECISION AND NEVER A DELETE. s6: "Deactivation hides workflow
-- surfaces but must not delete historical patient or audit data." Nothing in this migration deletes
-- anything, no engine verb built on it deletes anything, and there is no cascade from an activation row
-- to a clinical one -- the two schemas do not reference each other at all, which is the strongest form
-- of that guarantee available: there is no path along which a switch could reach a patient record.
create table if not exists practice_capability_activation_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  capability_code text not null,
  action text not null,
  -- BOTH SIDES OF THE CHANGE. "Switched off" is a different fact from "switched off, having been on
  -- since March", and a trail that records only the new value cannot tell the two apart. state_before
  -- is null exactly once per capability per practice: the first time it is ever written.
  state_before text,
  state_after text not null,
  source text not null,
  mode_code text,
  actor_id uuid,
  correlation_id text,
  -- Free text. Optional. Never required, because a required reason field is a field people type "x" in.
  reason text,
  occurred_at timestamptz not null default now()
);

alter table practice_capability_activation_event drop constraint if exists practice_capability_activation_event_action_check;
alter table practice_capability_activation_event add constraint practice_capability_activation_event_action_check
  check (action in ('activate', 'deactivate'));

alter table practice_capability_activation_event drop constraint if exists practice_capability_activation_event_state_check;
alter table practice_capability_activation_event add constraint practice_capability_activation_event_state_check
  check (state_after in ('active', 'inactive')
         and (state_before is null or state_before in ('active', 'inactive')));

alter table practice_capability_activation_event drop constraint if exists practice_capability_activation_event_code_check;
alter table practice_capability_activation_event add constraint practice_capability_activation_event_code_check
  check (capability_code in (
    'CP.BOOKING', 'CP.CALENDAR', 'CP.PATIENTS', 'CP.FOLLOWUPS', 'CP.ENCOUNTERS',
    'CP.INVESTIGATIONS', 'CP.MEDICATIONS', 'CP.PROCEDURES', 'CP.DOCUMENTS',
    'CP.CLOSE_DAY', 'CP.INTELLIGENCE', 'CP.AI_ASSIST'));

alter table practice_capability_activation_event drop constraint if exists practice_capability_activation_event_reason_check;
alter table practice_capability_activation_event add constraint practice_capability_activation_event_reason_check
  check (reason is null or btrim(reason) <> '');

create index if not exists idx_practice_capability_event_scope
  on practice_capability_activation_event(workspace_id, capability_code, occurred_at desc);
create index if not exists idx_practice_capability_event_correlation
  on practice_capability_activation_event(correlation_id);

alter table practice_capability_activation_event enable row level security;

comment on table practice_capability_activation_event is
  'CPR-CAP-001 s8. Queryable history of every activation and deactivation. The tamper-evident trail is practice_audit_event, which migration 247 made append-only. This table cascades with its workspace on purpose: a DELETE-refusing child makes a workspace permanently undeletable, as practice_lifecycle_transition already does.';

notify pgrst, 'reload schema';
