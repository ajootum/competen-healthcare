-- ============================================================
-- MIGRATION 247: THE BRAKES, BUILT BEFORE THE VERB
-- CPR-LIFE-001 s1, s3, s7, s8
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THE DESTRUCTIVE VERB ALREADY WORKS. THIS FILE IS ENTIRELY A SET OF BRAKES ON IT.
--
-- scripts/practice-pilot-gate.ts performs admin.from("practice_workspace").delete() and ONE HUNDRED AND
-- ELEVEN on-delete-cascade foreign keys across 113 tables fire off that row. Nothing in CPR-LIFE-001 is
-- a new capability. Every part of it is a safety on a capability that has worked since migration 191.
--
-- That is why this migration adds no way to delete anything. Build order for a destructor is brakes
-- first, always: a half-built delete pipeline is more dangerous than an unbuilt one, because at every
-- intermediate commit it is a working irreversible destructor missing its safeties.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO, AND WHY -- recorded here so the next person does not read the
-- absence as an oversight and helpfully finish it:
--
--   NO 'PENDING_DELETION' OR 'DELETED' STATUS VALUE. The user scoped CPR-LIFE-001 to its safe subset on
--   2026-08-07. Three questions the specification does not answer have to be answered first:
--
--     1. ANONYMISATION IS UNDEFINED. The design comp prints "Patient data will be anonymised or removed
--        according to privacy laws". CPR-LIFE-001 is 61 lines and NEVER USES THE WORD. It names no law,
--        no fields and no mechanism, and the actual mechanism -- 111 cascades -- contradicts it outright.
--        There is no branch in which anything is anonymised. That sentence must never be rendered.
--     2. AUTHORISATION IS UNNAMED. s3 says only "Only authorized users may" -- no role, no operator, no
--        second person. Read literally, in a managed practice one owner could destroy every other
--        practitioner's and every patient's records alone.
--     3. THE EMAIL CONFIRMATION STEP CANNOT BE BUILT. This product has no delivery channel, which
--        privacyPosture() currently asserts to users as a guarantee.
--
--   A status value with no engine behind it is an invitation. Adding one later is a one-line alter.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and NO SEMICOLON ANYWHERE EXCEPT ENDING A
-- STATEMENT -- including inside comments. The runner splits on them, and a semicolon inside a comment
-- silently drops the statements around it while still reporting success. That happened on migration 238.
-- Function bodies follow migration 194's proven single-statement shape, which the runner carries intact.
-- ============================================================

-- ---- 1. ARCHIVED JOINS THE STATE SET ---------------------------------------------------------------
--
-- Migration 191 wrote ten states and has never been altered since. Live values today are ONBOARDING,
-- PROVISIONING and ACTIVE, all inside the set, so widening cannot strand a row.
--
-- ARCHIVED is the only one added, because archive and restore are the only new transitions with an
-- engine behind them. CPR-LIFE-001 s2 distinguishes it from SUSPENDED by INTENT rather than by effect:
-- suspension is a temporary disablement pending something (payment, an investigation, a licence), and
-- archive is a practice put away while fully preserved. Both hide it and stop bookings. Only archive is
-- offered as an ordinary, reversible, blameless act.
alter table practice_workspace drop constraint if exists practice_workspace_status_check;
alter table practice_workspace add constraint practice_workspace_status_check
  check (status in ('REQUESTED', 'IDENTITY_PENDING', 'PROVISIONING', 'ONBOARDING', 'ACTIVE',
                    'ARCHIVED', 'SUSPENDED', 'MIGRATING', 'CLOSING', 'CLOSED', 'FAILED'));

-- ---- 2. THE TRANSITION LOG -------------------------------------------------------------------------
--
-- s7: "Every lifecycle change is recorded with who, when, from what state, to what state and why."
--
-- APPEND ONLY. There is no updated_at and section 4 forbids UPDATE and DELETE on this table outright. A
-- lifecycle history that can be edited is not a history -- and this one exists precisely to be read back
-- after somebody says they did not do a thing.
--
-- reason is NOT NULL. s7 asks for why, and a nullable reason becomes an empty one within a week. An
-- engine that forgets it will fail on every write, which is the intended behaviour.
--
-- workspace_id has NO on-delete clause. NO ACTION refuses a direct workspace delete while transitions
-- exist -- deliberately, because it is another brake -- while still permitting a full cascade if one is
-- ever built to run in the right order.
create table if not exists practice_lifecycle_transition (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id),

  from_status text not null,
  to_status text not null,

  -- The transition is recorded even when it was refused, because an attempt to archive a practice is
  -- itself a fact somebody may need to see. outcome says which happened.
  outcome text not null default 'applied'
    check (outcome in ('applied', 'refused')),
  refusal_code text,

  reason text not null check (char_length(btrim(reason)) between 1 and 1000),

  actor_user_id uuid,
  actor_membership_id uuid references practice_membership(id),
  -- s3 anticipates an operator acting on a practice they do not belong to. A super-admin has no
  -- membership, so actor_membership_id is null for them and this says so rather than leaving a gap.
  actor_kind text not null default 'member'
    check (actor_kind in ('member', 'operator', 'system')),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_lifecycle_transition_ws
  on practice_lifecycle_transition(workspace_id, occurred_at desc);

alter table practice_lifecycle_transition enable row level security;

-- ---- 3. THE AUDIT TABLE IS NOT APPEND ONLY, AND s7 ASSUMES IT IS ------------------------------------
--
-- WARNING: READ THIS BEFORE APPLYING. IT CHANGES THE BEHAVIOUR OF A TOOL THAT WORKS TODAY.
--
-- practice_audit_event holds 178 rows across 41 event types. ELEVEN immutability guards are deployed in
-- this codebase -- migrations 027, 034, 051, 067, 084, 085, 091, 092, 093, 096, 107 and others -- and
-- NONE OF THEM IS ON THIS TABLE. Nothing in src/ updates it, so the UPDATE half below costs nothing and
-- closes a hole that is open only by omission.
--
-- The DELETE half is not free and is not an oversight. s7 requires that "deletion events are never
-- removable", and that is FALSE TODAY: the pilot gate's workspace delete cascades straight through this
-- table, so the record of a destruction is destroyed by the destruction it records. Blocking DELETE is
-- the only thing that makes s7's sentence true.
--
-- THE CONSEQUENCE, STATED PLAINLY: after this migration, scripts/practice-pilot-gate.ts can no longer
-- delete a workspace that has audit events. The cascade will reach this table and raise. That is the
-- brake working as intended and it is the whole point of the file -- but it is a live operator tool
-- changing behaviour, so it is called out here rather than discovered later. The follow-up is to route
-- the pilot gate through a decommissioning saga that archives the audit trail before it removes the
-- practice, modelled on the resumable provisioning saga in migrations 191 to 203.
create or replace function practice_audit_event_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'practice_audit_event is append only. % refused on audit row %', tg_op, old.id;
end;
$$;

drop trigger if exists trg_practice_audit_event_immutable on practice_audit_event;
create trigger trg_practice_audit_event_immutable
  before update or delete on practice_audit_event
  for each row execute function practice_audit_event_immutable();

-- ---- 4. THE TRANSITION LOG IS APPEND ONLY TOO -------------------------------------------------------
--
-- Same guard, its own function, because a shared one would name the wrong table in its message and an
-- error that names the wrong table costs an hour.
create or replace function practice_lifecycle_transition_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'practice_lifecycle_transition is append only. % refused on transition %', tg_op, old.id;
end;
$$;

drop trigger if exists trg_practice_lifecycle_transition_immutable on practice_lifecycle_transition;
create trigger trg_practice_lifecycle_transition_immutable
  before update or delete on practice_lifecycle_transition
  for each row execute function practice_lifecycle_transition_immutable();

-- ---- 5. CAPABILITIES -------------------------------------------------------------------------------
--
-- Four new codes. NONE OF THEM IS practice.delete -- there is no delete in this migration, and seeding a
-- capability for a verb that does not exist is how a screen ends up with a button behind it.
--
-- 43 codes were seeded before this file and every one was verified live. Six invented capability codes
-- have shipped on this product historically, which is why these four are seeded here in the same
-- statement that grants them rather than assumed to exist.
--
-- practice_owner, not practitioner. s3's "authorized users" names no role, but archiving a practice is
-- an act on the PRACTICE rather than on care, and practice_owner is the role migration 191 created for
-- exactly that boundary. A practitioner who is not an owner may see the state and not change it.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_owner', 'practice.lifecycle.view'),
  ('practitioner',   'practice.lifecycle.view'),
  ('practice_owner', 'practice.archive'),
  ('practice_owner', 'practice.suspend'),
  ('practice_owner', 'practice.restore')
on conflict (role_code, capability_code) do nothing;

-- WHOLE-PRACTICE EXPORT. data.export already exists and is held by practitioner alone -- verified live
-- against practice_role_capabilities before this line was written. s5 makes export a precondition of
-- every closure path, and an owner who cannot export cannot satisfy the checklist they are shown. This
-- grants the EXISTING code to the owner rather than inventing a second export capability, because two
-- codes for one act is how a permission check ends up asking the wrong question.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_owner', 'data.export')
on conflict (role_code, capability_code) do nothing;

-- The backfill into practice_role_assignment, following the complete pattern from migration 197. This is
-- the half migration 239 omitted, which left pathway.design, pathway.assign and pathway.view catalogued
-- but granted to nobody -- unreachable in every workspace provisioned before it. Capability resolution
-- reads assignments, not the catalogue, so the catalogue insert above grants nothing on its own.
insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and c.capability_code in ('practice.lifecycle.view', 'practice.archive', 'practice.suspend',
                            'practice.restore', 'data.export')
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code
  );

alter table practice_workspace enable row level security;

notify pgrst, 'reload schema';
