-- ============================================================
-- MIGRATION 209: CLINICAL ACTIVITY, PROCEDURE TEAMS, INSTRUMENTS AND TEMPLATES (CPR-150, the other half)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE MODULE IS CALLED "PROCEDURE AND CLINICAL ACTIVITY MANAGEMENT". ONLY THE PROCEDURE HALF WAS BUILT.
--
-- CPR-150 s2 lists "clinical activity logging" beside procedure recording, and the comp gives it its own
-- tab and its own panel: "Log all clinical activities (not just procedures) -- ward rounds,
-- consultations, training, etc." That half was missing entirely, along with procedure templates, team
-- members, instruments, attachments and portfolio evidence. See CPR-AUDIT-001-spec-conformance.md.
--
-- What exists -- procedure recording, the custom catalogue, consent, outcomes, complications and the
-- laterality enforcement that is not even in the specification -- all stays.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- A CLINICAL ACTIVITY IS NOT A PROCEDURE, AND IT IS NOT A TASK. A procedure is done TO a patient and
-- lives in their record. An activity is something a clinician DID -- a ward round, a teaching session, a
-- mortality meeting -- and most of them name no patient at all. Recording a teaching session as a
-- procedure would put a lecture in somebody's clinical record; recording it as a task would say it was
-- work assigned rather than work done.
--
-- SO IT HAS NO patient_id. Deliberately. The one link it may carry is to an ENCOUNTER, for the case
-- where an activity genuinely happened around one consultation -- and even then the activity is about
-- the clinician, not the patient.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Clinical activity ------------------------------------------------------------------------------

create table if not exists practice_clinical_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- WHOSE ACTIVITY IT IS. Not "who typed it": a consultant recording that a registrar led a ward round
  -- would otherwise credit themselves, and the portfolio built on top of it would be wrong.
  performed_by uuid not null,
  kind text not null
    check (kind in ('ward_round', 'clinic_session', 'teaching', 'training', 'meeting',
                    'audit', 'on_call', 'supervision', 'admin', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  detail text,
  occurred_at timestamptz not null,
  duration_minutes integer check (duration_minutes is null or (duration_minutes between 1 and 1440)),
  -- Led / participated / observed / taught. What somebody did matters as much as that they were there,
  -- and a portfolio that could not tell the difference would be worthless as evidence.
  participation text not null default 'participated'
    check (participation in ('led', 'participated', 'observed', 'taught', 'supervised')),
  location_id uuid references practice_location(id) on delete set null,
  encounter_id uuid references practice_encounter(id) on delete set null,
  -- CPD time claimed against this activity, SEPARATE from its duration. A four-hour meeting is not
  -- necessarily four hours of CPD, and conflating them would inflate every portfolio in the practice.
  cpd_minutes integer check (cpd_minutes is null or (cpd_minutes between 0 and 1440)),
  portfolio boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_activity_person
  on practice_clinical_activity(workspace_id, performed_by, occurred_at desc);
create index if not exists idx_practice_activity_kind
  on practice_clinical_activity(workspace_id, kind, occurred_at desc);

-- ---- 2. Who else was there (CPR-150 s6 "Operator", "Assistant") ---------------------------------------
--
-- One row per person per procedure. A free-text name is allowed BESIDE the user id, because a scrub
-- nurse from an agency is a real participant who has no account here -- and a team list that could only
-- name account-holders would be quietly incomplete in exactly the theatres that matter.

create table if not exists practice_procedure_participant (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  procedure_id uuid not null references practice_procedure(id) on delete cascade,
  user_id uuid,
  person_name text,
  role text not null
    check (role in ('operator', 'assistant', 'anaesthetist', 'scrub', 'observer', 'supervisor', 'other')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_participant on practice_procedure_participant(procedure_id);

-- ---- 3. Instruments and consumables (CPR-150 s2, s6 "Equipment") ---------------------------------------
--
-- A CHILD TABLE RATHER THAN A jsonb LIST, because "which procedures used the C-arm" is a real question --
-- for maintenance, for costing, and for the recall that follows a fault. A list inside a jsonb column
-- answers it only with a scan.

create table if not exists practice_procedure_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  procedure_id uuid not null references practice_procedure(id) on delete cascade,
  kind text not null default 'instrument' check (kind in ('instrument', 'consumable', 'implant')),
  label text not null check (char_length(label) between 1 and 160),
  -- An implant's identifier is the one that must be findable years later, when a batch is recalled.
  identifier text,
  quantity integer check (quantity is null or quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_item on practice_procedure_item(procedure_id);
create index if not exists idx_practice_item_label on practice_procedure_item(workspace_id, label);

-- ---- 4. Procedure templates (CPR-150 s2, s3 "specialty-specific templates") ----------------------------
--
-- Defaults for a procedure that is done the same way every time: the category, the approach, the usual
-- instruments, the usual team roles. NOT the findings -- pre-filling what was found would put words in a
-- clinical record that describe an operation nobody has performed yet, which is the same rule CPR-130's
-- template library follows about starting text.

create table if not exists practice_procedure_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 160),
  procedure_type_id uuid references practice_procedure_type(id) on delete set null,
  default_laterality text,
  default_indication text,
  -- Lists of {kind,label} and {role,person_name} to seed the two child tables above.
  default_items jsonb,
  default_roles jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists idx_practice_proc_template_code
  on practice_procedure_template(workspace_id, code);

-- ---- 5. Attachments reach procedures too ---------------------------------------------------------------
--
-- CPR-130 built practice_attachment against encounters and documents; CPR-150 s3 asks for photo and
-- document attachment on a procedure. The same table, one more optional parent -- not a second
-- attachment model, for the reason CPR-330 gives about document models.

alter table practice_attachment add column if not exists procedure_id uuid references practice_procedure(id) on delete set null;
create index if not exists idx_practice_attachment_procedure
  on practice_attachment(procedure_id) where procedure_id is not null;

-- ---- 6. Portfolio evidence on a procedure --------------------------------------------------------------
--
-- CPR-150's headline objective is "build automatic competency evidence". What is buildable HERE is the
-- practitioner's own record of what they did and what it was worth. The link into the wider platform's
-- competency tables is NOT built and is not pretended: a practice tenancy writing into hospital
-- competency records is a cross-tenancy decision with its own specification.

alter table practice_procedure add column if not exists cpd_minutes integer;
alter table practice_procedure add column if not exists portfolio boolean not null default false;

-- ---- 7. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_clinical_activity enable row level security;
alter table practice_procedure_participant enable row level security;
alter table practice_procedure_item enable row level security;
alter table practice_procedure_template enable row level security;

notify pgrst, 'reload schema';
