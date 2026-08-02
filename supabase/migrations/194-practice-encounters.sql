-- ============================================================
-- MIGRATION 194: CLINICAL ENCOUNTERS (CPR-DM-001 s8/s9/s10, PEN-003, CPR-006 V3)
--
-- Phase 3 of CPR-BUILD-000, and the phase that makes Competen Practice a clinical record rather than a
-- diary with names in it. DM-001 s2: "an encounter is the central clinical activity container and is
-- never replaced by a note document" -- so the encounter is its own row, and notes hang off it.
--
-- SIGNED ENCOUNTERS ARE IMMUTABLE, ENFORCED BY THE DATABASE. DM-001 s16 says sign/finalise LOCKS the
-- source version and amendments create new linked versions; s8.1 gives AMENDED and ENTERED_IN_ERROR as
-- the only post-SIGNED states. A trigger is the honest place for that rule: an application check can be
-- bypassed by any future route, a background job or a console session, and "the record cannot be
-- rewritten after signing" is precisely the guarantee that must not depend on remembering.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 6's trigger function is the FIRST plpgsql body in this project: unlike the language-sql
-- functions in migrations 169/172/187, whose bodies are single statements, this one contains internal
-- semicolons inside $$ ... $$. A naive splitter would cut it into fragments. Everything else in this
-- file is a plain statement and would survive either way; only section 6 has this requirement. If
-- section 6 fails to apply, the encounter tables are still correct and the engine still refuses
-- post-signature edits -- what is lost is the guarantee that holds when the engine is bypassed, and
-- scripts/practice-encounters-harness.ts asserts that guarantee explicitly so its absence is visible
-- rather than assumed.
--
-- ENCOUNTER STATES are DM-001 s8.1's eight, verbatim, in a CHECK. Transition legality lives in
-- src/lib/practice/encounters.ts; the CHECK makes illegal VALUES unwritable, the trigger makes illegal
-- POST-SIGNATURE EDITS unwritable, and the engine makes illegal MOVES refusable with a reason.
--
-- PROBLEM vs DIAGNOSIS (s9): a Problem is longitudinal and may span many encounters; a Diagnosis is
-- recorded AT an encounter and may link to a Problem. Both exist here because collapsing them would
-- destroy the longitudinal view Phase 5's intelligence is built on -- and re-separating them later, after
-- data exists, is a migration nobody wants.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_encounter -------------------------------------------------------------------------

create table if not exists practice_encounter (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  appointment_id uuid references practice_appointment(id) on delete set null,
  location_id uuid references practice_location(id) on delete set null,
  previous_encounter_id uuid references practice_encounter(id) on delete set null,
  encounter_mode text not null default 'in_person'
    check (encounter_mode in ('in_person', 'teleconsultation', 'outreach', 'home_visit', 'hospital')),
  entry_pathway text not null default 'booked'
    check (entry_pathway in ('booked', 'new_walk_in', 'walk_in_followup', 'scheduled_followup')),
  reason_for_visit text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'SIGNED', 'AMENDED',
                      'CANCELLED', 'ENTERED_IN_ERROR')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  signed_at timestamptz,
  signed_by uuid,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_enc_patient on practice_encounter(patient_id, started_at desc);
create index if not exists idx_practice_enc_ws_status on practice_encounter(workspace_id, status, started_at desc);
create index if not exists idx_practice_enc_appt on practice_encounter(appointment_id);

-- ONE LIVE ENCOUNTER PER PATIENT (PEN-001 "always create one active encounter per selected visit",
-- FLOW-001 "resume unfinished encounter where appropriate"). Without this, a second click of New
-- Encounter silently forks the visit into two records that each hold half the consultation.
create unique index if not exists ux_practice_encounter_live
  on practice_encounter(patient_id) where status in ('DRAFT', 'ACTIVE', 'PAUSED');

-- ---- 2. practice_encounter_note (typed, versioned segments -- DM-001 s8 ClinicalNote) ---------------

create table if not exists practice_encounter_note (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  note_type text not null default 'subjective'
    check (note_type in ('subjective', 'objective', 'assessment', 'plan', 'narrative')),
  body text not null default '',
  authored_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live segment per type per encounter: SOAP is four boxes, not an append-only log of drafts.
create unique index if not exists ux_practice_note_segment
  on practice_encounter_note(encounter_id, note_type);

-- ---- 3. practice_encounter_status_history (immutable transition log -- DM-001 s8) ------------------

create table if not exists practice_encounter_status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_enc_hist on practice_encounter_status_history(encounter_id, occurred_at);

-- ---- 4. practice_problem (longitudinal) and practice_diagnosis (per encounter) -- DM-001 s9 --------

create table if not exists practice_problem (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 240),
  status text not null default 'active'
    check (status in ('active', 'resolved', 'inactive', 'entered_in_error')),
  onset_date date,
  resolved_date date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_problem_patient on practice_problem(patient_id, status);

create table if not exists practice_diagnosis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  problem_id uuid references practice_problem(id) on delete set null,
  label text not null check (char_length(label) between 1 and 240),
  code text,
  code_system text,
  certainty text not null default 'provisional'
    check (certainty in ('suspected', 'provisional', 'confirmed', 'ruled_out')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_diag_enc on practice_diagnosis(encounter_id);
create index if not exists idx_practice_diag_patient on practice_diagnosis(patient_id, created_at desc);
-- Diagnosis cohort search (DM-001 s18 access pattern).
create index if not exists idx_practice_diag_cohort on practice_diagnosis(workspace_id, code, created_at desc);

-- ---- 5. practice_treatment (medication / procedure / advice / referral) -- DM-001 s10 --------------

create table if not exists practice_treatment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  diagnosis_id uuid references practice_diagnosis(id) on delete set null,
  treatment_type text not null
    check (treatment_type in ('medication', 'procedure', 'investigation', 'advice', 'referral', 'monitoring')),
  label text not null check (char_length(label) between 1 and 240),
  -- Medication intention (DM-001 s10 MedicationPlan). NOT an administration chart: ADR-01 keeps this a
  -- record of what the practitioner decided, not what a ward gave.
  dose text,
  route text,
  frequency text,
  duration text,
  notes text,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_treat_enc on practice_treatment(encounter_id);
create index if not exists idx_practice_treat_patient on practice_treatment(patient_id, created_at desc);

-- ---- 6. Immutability after signature (DM-001 s16) --------------------------------------------------
--
-- Single-statement function body, so the semicolon-splitting runner carries it intact. Allows only the
-- governed post-signature transitions and the columns that record them; anything else raises.

create or replace function practice_encounter_signed_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('SIGNED', 'AMENDED', 'ENTERED_IN_ERROR')
     and (new.status not in ('AMENDED', 'ENTERED_IN_ERROR')
          or new.patient_id is distinct from old.patient_id
          or new.reason_for_visit is distinct from old.reason_for_visit
          or new.encounter_mode is distinct from old.encounter_mode
          or new.started_at is distinct from old.started_at
          or new.signed_at is distinct from old.signed_at
          or new.signed_by is distinct from old.signed_by)
  then
    raise exception 'encounter % is signed; only a governed amendment or error correction may change it', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_encounter_signed_guard on practice_encounter;
create trigger trg_practice_encounter_signed_guard
  before update on practice_encounter
  for each row execute function practice_encounter_signed_guard();

-- ---- 7. Capabilities + backfill (the pattern established in 192, applied again) ---------------------

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'encounter.sign'),
  ('practitioner', 'diagnosis.record'),
  ('practitioner', 'treatment.record'),
  ('practice_assistant', 'encounter.list')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 8. RLS: deny-by-default ------------------------------------------------------------------------

alter table practice_encounter enable row level security;
alter table practice_encounter_note enable row level security;
alter table practice_encounter_status_history enable row level security;
alter table practice_problem enable row level security;
alter table practice_diagnosis enable row level security;
alter table practice_treatment enable row level security;

notify pgrst, 'reload schema';
