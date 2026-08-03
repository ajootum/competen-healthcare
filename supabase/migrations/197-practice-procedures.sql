-- ============================================================
-- MIGRATION 197: PROCEDURE AND CLINICAL ACTIVITY (CPR-150)
--
-- The last of the clinical spine. CPR-BUILD-001 s5: "CPR-130 documentation properly, then CPR-140
-- follow-ups and CPR-150 procedures. These complete the encounter the product already has."
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT practice_treatment, WHICH ALREADY HAS treatment_type = 'procedure'.
--
-- Migration 194 s5 says of that table: "a record of what the practitioner DECIDED, not what a ward
-- gave". It holds INTENTION. `practice_procedure` holds what was actually DONE to a person -- the
-- needle went in, the lesion came off, and there is now a wound that can become infected.
--
-- Those are different facts with different lifetimes and different consequences, and collapsing them
-- loses the one that matters clinically. A treatment row saying "excision of lipoma, planned" is not
-- evidence that anything happened; a procedure row is. So a procedure may LINK BACK to the treatment
-- that planned it (treatment_id), and a plan that was never carried out simply leaves no procedure row.
--
-- This note is here because two tables that both mention procedures look like duplication to anyone who
-- did not read migration 194, and the cheap fix -- merging them -- destroys the distinction.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- A PROCEDURE'S OUTCOME IS LEARNED LATER, AND THAT IS WHY SECTION 3 EXISTS.
--
-- The encounter where a procedure was performed gets signed the same day. Three weeks later the wound is
-- infected. There are only three places that fact can go: into the signed encounter (which breaks the
-- immutability guarantee 194 s6 exists to hold), nowhere (which is what most systems do), or into its
-- own append-only record pointing at the encounter where it was OBSERVED. Section 3 is the third.
--
-- LATERALITY IS ENFORCED, NOT OFFERED. Wrong-site surgery is the canonical never-event. If the catalogue
-- says a procedure has sides, the engine refuses to record it without one -- not a warning, not a
-- default, a refusal. `not_applicable` on a sided procedure is exactly the value somebody picks to get
-- past a required field, so it is rejected too.
--
-- CONSENT DEFAULTS TO not_recorded AND NEVER TO obtained. A consent column that defaults to true
-- manufactures a legal claim about a conversation nobody can evidence. Where the catalogue says consent
-- is required, not_recorded is refused; everywhere else it stands as the honest answer.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 5's trigger function is plpgsql with internal semicolons inside $$ ... $$, as in 194 s6,
-- 195 s7 and 196 s5. scripts/practice-procedures-harness.ts probes it by name.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_procedure_type -- the catalogue ---------------------------------------------------
--
-- Same shape as the note-template library (195 s1): workspace_id NULL means a platform entry available
-- to every practice, and the two partial unique indexes exist because NULL is distinct from NULL in
-- Postgres and one index would let the platform catalogue hold a code twice.

create table if not exists practice_procedure_type (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references practice_workspace(id) on delete cascade,
  code text not null,
  name text not null check (char_length(name) between 1 and 160),
  category text not null default 'other'
    check (category in ('minor_surgery', 'injection', 'wound_care', 'diagnostic', 'obstetric',
                        'dental', 'dressing', 'physical', 'other')),
  -- Does this procedure have a side? Drives the refusal in the engine, so it is a clinical safety
  -- setting and not a display hint.
  sided boolean not null default false,
  consent_required boolean not null default false,
  typical_duration_minutes integer,
  aftercare text,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_proc_type_ws_code
  on practice_procedure_type(workspace_id, code) where workspace_id is not null;
create unique index if not exists ux_practice_proc_type_platform_code
  on practice_procedure_type(code) where workspace_id is null;
create index if not exists idx_practice_proc_type_lookup
  on practice_procedure_type(workspace_id, category, status);

-- ---- 2. practice_procedure -- what was actually done -----------------------------------------------

create table if not exists practice_procedure (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- NOT NULL, deliberately. DM-001 s2: the encounter is the central clinical activity container. A
  -- procedure performed outside one is a consultation that was not recorded, and the fix for that is to
  -- record the consultation, not to let clinical acts float free of it.
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  -- The plan this carries out, where there was one. See the header.
  treatment_id uuid references practice_treatment(id) on delete set null,
  procedure_type_id uuid references practice_procedure_type(id) on delete set null,

  -- DENORMALISED ON PURPOSE. The record must say what was done AT THE TIME. If the catalogue entry is
  -- later renamed or retired, a joined label would silently rewrite history -- a procedure performed in
  -- March would start describing itself in the words of a September edit.
  label text not null check (char_length(label) between 1 and 240),

  site text,
  laterality text not null default 'not_applicable'
    check (laterality in ('left', 'right', 'bilateral', 'not_applicable')),
  indication text,

  consent_status text not null default 'not_recorded'
    check (consent_status in ('obtained', 'not_required', 'refused', 'not_recorded')),
  consent_note text,

  anaesthesia text,
  materials text,
  immediate_outcome text,

  -- PERFORMED or ABANDONED. There is no PLANNED: a plan that was never carried out is the treatment row
  -- and nothing else. ABANDONED means something was started and stopped, which is a thing that happened
  -- to the patient and belongs in the record.
  status text not null default 'PERFORMED' check (status in ('PERFORMED', 'ABANDONED')),
  abandoned_reason text,

  performed_at timestamptz not null default now(),
  performed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_proc_encounter on practice_procedure(encounter_id);
create index if not exists idx_practice_proc_patient on practice_procedure(patient_id, performed_at desc);
create index if not exists idx_practice_proc_ws on practice_procedure(workspace_id, performed_at desc);
-- The activity view: what has this practice done, by type, over time (CPR-150 "clinical activity").
create index if not exists idx_practice_proc_activity on practice_procedure(workspace_id, procedure_type_id, performed_at desc);

-- ---- 3. practice_procedure_outcome -- what was learned afterwards -----------------------------------
--
-- Append-only. See the header: the encounter that performed the procedure is signed and immutable, and
-- a complication discovered three weeks later must land somewhere that is neither a lie about the
-- original record nor a shrug.
--
-- observed_at_encounter_id is the encounter where it was NOTICED, which is a different encounter from
-- the one that performed it -- that link is the whole point, because it is what lets a reader walk from
-- "this wound got infected" back to the day it was made.

create table if not exists practice_procedure_outcome (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  procedure_id uuid not null references practice_procedure(id) on delete cascade,
  observed_at_encounter_id uuid references practice_encounter(id) on delete set null,
  outcome_type text not null default 'note'
    check (outcome_type in ('healing', 'complication', 'failure', 'resolution', 'note')),
  -- Only meaningful for a complication; the engine requires it for one and refuses it elsewhere, so
  -- "severity: none" cannot be used to file a complication that reads as nothing.
  severity text check (severity in ('mild', 'moderate', 'severe')),
  detail text not null check (char_length(detail) between 1 and 2000),
  observed_on date not null default current_date,
  recorded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_proc_outcome on practice_procedure_outcome(procedure_id, observed_on);
create index if not exists idx_practice_proc_outcome_enc on practice_procedure_outcome(observed_at_encounter_id);

-- ---- 4. The starter catalogue (platform-level) -----------------------------------------------------
--
-- Deliberately small and deliberately generic, for the reason 195 s6 gives: a library of forty specialty
-- entries nobody wrote for this product would be invented content wearing a catalogue's clothes. These
-- are the handful whose SIDED and CONSENT_REQUIRED flags do real work, which is what the catalogue is
-- for -- an entry that carries neither is just a word the practitioner could have typed.

insert into practice_procedure_type (code, name, category, sided, consent_required, typical_duration_minutes, status, workspace_id) values
  ('wound_dressing', 'Wound dressing', 'wound_care', false, false, 15, 'published', null),
  ('suturing', 'Suturing of laceration', 'minor_surgery', false, true, 30, 'published', null),
  ('suture_removal', 'Suture removal', 'wound_care', false, false, 10, 'published', null),
  ('abscess_incision', 'Incision and drainage of abscess', 'minor_surgery', true, true, 30, 'published', null),
  ('joint_injection', 'Intra-articular injection', 'injection', true, true, 20, 'published', null),
  ('im_injection', 'Intramuscular injection', 'injection', false, false, 5, 'published', null),
  ('cannulation', 'Peripheral IV cannulation', 'diagnostic', true, false, 10, 'published', null),
  ('urinary_catheter', 'Urinary catheterisation', 'diagnostic', false, true, 20, 'published', null),
  ('lesion_excision', 'Excision of skin lesion', 'minor_surgery', true, true, 45, 'published', null),
  ('nebulisation', 'Nebulised therapy', 'physical', false, false, 20, 'published', null)
on conflict (code) where workspace_id is null do nothing;

-- ---- 5. Outcomes are immutable ---------------------------------------------------------------------
--
-- The same rule as note versions (195 s7) and follow-up events (196 s5), for the same reason: a record
-- of what was learned about a patient is a historical fact, and a history with an editable middle is
-- not a history.

create or replace function practice_procedure_outcome_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'procedure outcome % is part of the clinical record and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_procedure_outcome_immutable on practice_procedure_outcome;
create trigger trg_practice_procedure_outcome_immutable
  before update on practice_procedure_outcome
  for each row execute function practice_procedure_outcome_immutable();

-- ---- 6. Capabilities + backfill --------------------------------------------------------------------
--
-- procedure.record is clinical and stays with the practitioner. procedure.manage is the CATALOGUE,
-- which is practice configuration -- the same boundary template.manage draws in 195 s8, and the same
-- reason practice_owner is given it and nothing else.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'procedure.record'),
  ('practitioner', 'procedure.manage'),
  ('practice_owner', 'procedure.manage')
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

-- ---- 7. RLS: deny-by-default ------------------------------------------------------------------------

alter table practice_procedure_type enable row level security;
alter table practice_procedure enable row level security;
alter table practice_procedure_outcome enable row level security;

notify pgrst, 'reload schema';
