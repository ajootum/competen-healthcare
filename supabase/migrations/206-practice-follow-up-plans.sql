-- ============================================================
-- MIGRATION 206: FOLLOW-UP PLANS, TEMPLATES AND OUTCOMES (CPR-140, the structural half)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- CPR-140 IS PATIENT-CENTRIC AND SEQUENTIAL. WHAT WAS BUILT IS A WORKSPACE-WIDE BOARD OF SINGLE
-- OBLIGATIONS.
--
-- The specification and its comp describe a PLAN -- initial consultation, then two weeks, then one
-- month, then three months -- viewed from the patient, with an adherence figure, a recall queue, a fixed
-- outcome taxonomy and reusable templates. What exists is a good board of independent follow-ups with
-- free-text outcomes. Everything on that board stays: derived-overdue, the practice clock, the
-- DB-enforced release on a dead booking, and closing requiring words are all sound and none of them is
-- contradicted by the specification. See CPR-AUDIT-001-spec-conformance.md.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- A PLAN IS A GROUPING, NOT A NEW KIND OF OBLIGATION. Each step is an ordinary practice_follow_up with
-- everything that already implies -- its own due date, its own booking, its own event trail, its own
-- release when a booking dies. A plan that owned its steps would be a second place a commitment can
-- live, and the first question at handover would be which one is real.
--
-- THE PLAN DOES NOT CASCADE ITS STEPS AWAY. Deleting a plan sets plan_id to null and leaves every
-- follow-up standing. Somebody tidying up a mis-created plan must not silently discharge four clinical
-- commitments; they have to close each one and say why, exactly as they would have to otherwise.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Templates: a reusable shape of a plan ---------------------------------------------------------
--
-- Workspace-scoped only. There is no platform template here, unlike the note library: a review schedule
-- is a clinical judgement about a procedure and a population, and shipping a default one would be this
-- product making that judgement on behalf of practices it has never seen.

create table if not exists practice_follow_up_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists idx_practice_fu_template_code
  on practice_follow_up_template(workspace_id, code);

-- One row per step. OFFSET IN DAYS FROM THE START, not from the previous step: "three months after the
-- operation" is what a surgeon means, and chaining offsets makes every later date drift when an earlier
-- step is rescheduled.
create table if not exists practice_follow_up_template_step (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references practice_follow_up_template(id) on delete cascade,
  position integer not null,
  offset_days integer not null check (offset_days >= 0),
  kind text not null default 'review'
    check (kind in ('review', 'investigation_result', 'treatment_response', 'referral_outcome',
                    'monitoring', 'immunisation', 'other')),
  reason text not null check (char_length(reason) between 1 and 400),
  priority text not null default 'routine'
    check (priority in ('routine', 'soon', 'urgent'))
);

create unique index if not exists idx_practice_fu_template_step
  on practice_follow_up_template_step(template_id, position);

-- ---- 2. The plan ---------------------------------------------------------------------------------------

create table if not exists practice_follow_up_plan (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- Where the plan started. CPR-140 s5: every follow-up links to its originating encounter, and a plan
  -- is no exception -- "why is this patient on a three-month schedule" is answered by the consultation
  -- that decided it.
  origin_encounter_id uuid references practice_encounter(id) on delete set null,
  template_id uuid references practice_follow_up_template(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  -- The date every step's offset is measured from. Stored rather than inferred from the earliest step,
  -- so a plan whose first step is rescheduled does not move every other step with it.
  starts_on date not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'COMPLETED', 'DISCONTINUED')),
  discontinued_reason text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_fu_plan_patient
  on practice_follow_up_plan(workspace_id, patient_id, status);

-- ---- 3. A follow-up may belong to a plan --------------------------------------------------------------
--
-- ON DELETE SET NULL, deliberately -- see the header. A follow-up outlives the plan that grouped it.

alter table practice_follow_up add column if not exists plan_id uuid references practice_follow_up_plan(id) on delete set null;
alter table practice_follow_up add column if not exists step_number integer;

create index if not exists idx_practice_fu_plan_member
  on practice_follow_up(plan_id, step_number) where plan_id is not null;

-- ---- 4. The outcome taxonomy ---------------------------------------------------------------------------
--
-- CPR-140's fixed set: improved / no change / worsened / referred / other.
--
-- THE FREE TEXT STAYS AND IS STILL REQUIRED. The code is for counting; the words are for the next person
-- to read the record. A taxonomy that replaced the sentence would turn "much better, discharged to the
-- GP with a note about the rash" into "improved", and the rash would be gone from the record.
--
-- NULLABLE, because every follow-up closed before this migration has no code and inventing one would be
-- putting a clinical judgement into a record on behalf of somebody who never made it.

alter table practice_follow_up add column if not exists outcome_code text;

alter table practice_follow_up drop constraint if exists practice_follow_up_outcome_code_check;
alter table practice_follow_up add constraint practice_follow_up_outcome_code_check
  check (outcome_code is null or outcome_code in ('improved', 'no_change', 'worsened', 'referred', 'other'));

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_follow_up_template enable row level security;
alter table practice_follow_up_template_step enable row level security;
alter table practice_follow_up_plan enable row level security;

notify pgrst, 'reload schema';
