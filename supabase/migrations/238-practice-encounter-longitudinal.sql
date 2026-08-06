-- ============================================================
-- MIGRATION 238: THE ENCOUNTER'S OUTCOME, ITS DECISIONS, AND THE LONGITUDINAL RECORD
-- CPR-ENC-001 / CPR-ENC-002 / CPR-ENC-003
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT WAS ALREADY THERE, so this migration adds only what genuinely has nowhere to go. Six of the
-- specifications' fields map onto stores that have existed since 194:
--
--   Reason for encounter      practice_encounter.reason_for_visit
--   Clinical impression       practice_encounter_note, note_type = 'assessment'
--   Key findings (optional)   practice_encounter_note, note_type = 'objective'
--   Next steps / Plan         practice_encounter_note, note_type = 'plan'
--   Optional concise note     practice_encounter_note, note_type = 'narrative'
--   Working diagnosis         practice_diagnosis, which already names a longitudinal practice_problem
--   Treatment changes         practice_treatment
--   Procedures                practice_procedure + practice_procedure_outcome
--
-- Adding columns for those would have produced a second place to write the same sentence, which
-- CPR-ENC-002 s9's "no duplicate data entry" forbids in the same document that asks for the fields.
--
-- WHAT HAS NO STORE, and is added below:
--   1. the ENCOUNTER's outcome            (procedures and follow-ups have one -- the encounter does not)
--   2. the decisions made in it           (CPR-ENC-001 s3 "Clinical Summary: ... decisions")
--   3. investigations, TYPE ONLY          (CPR-ENC-001 s3 "Requested / reviewed (type only)")
--   4. referrals                          (CPR-ENC-002 s6 "Create referral")
--   5. clinical milestones                (CPR-ENC-003 s6)
--   6. allergies and blood group          (CPR-ENC-003 s3 "Core Patient Record")
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the migration runner splits the file on them and a semicolon inside a
-- comment cuts the statement it sits in half.
-- ============================================================

-- ---- 1. THE ENCOUNTER'S OUTCOME --------------------------------------------------------------------
--
-- WARNING: THE TWO APPROVED SPECIFICATIONS DISAGREE ABOUT THE LIST, and both are included rather than
-- one being chosen quietly. CPR-ENC-001 s3 says "Improved / stable / worsened / resolved / recurring".
-- CPR-ENC-002 s4's screen draws Improved / Stable / Worsened / Resolved / Other. Dropping `recurring`
-- would lose a clinically distinct answer that one document asks for by name. Dropping `other` would
-- leave a practitioner with no way to close an encounter whose outcome is none of the four. So the
-- constraint holds six, and the disagreement is recorded here rather than resolved by whoever typed
-- the constraint.
--
-- NULLABLE, AND THAT IS THE POINT. A draft encounter has no outcome yet, and an encounter closed
-- without one is a real thing that happens -- CPR-ENC-002 s7 asks for a WARNING on a missing outcome,
-- not a refusal. A default of 'stable' would manufacture a clinical claim for every unfinished record
-- in the table.
alter table practice_encounter add column if not exists outcome text;

alter table practice_encounter drop constraint if exists practice_encounter_outcome_allowed;
alter table practice_encounter add constraint practice_encounter_outcome_allowed
  check (outcome is null or outcome in
    ('improved', 'stable', 'worsened', 'resolved', 'recurring', 'other'));

-- An outcome of `other` that says nothing is the get-past-the-field answer, the same shape as CPR-150's
-- refusal of `not_applicable` for laterality. If the four named answers did not fit, the reason is the
-- whole content of the field.
alter table practice_encounter add column if not exists outcome_note text;
alter table practice_encounter drop constraint if exists practice_encounter_outcome_other_needs_note;
alter table practice_encounter add constraint practice_encounter_outcome_other_needs_note
  check (outcome is distinct from 'other' or (outcome_note is not null and char_length(btrim(outcome_note)) > 0));

-- ---- 2. DECISIONS MADE -----------------------------------------------------------------------------
--
-- CPR-ENC-001 s1: an encounter "captures only the practitioner's clinical decisions". This is that.
--
-- ITS OWN TABLE RATHER THAN A PARAGRAPH, because CPR-ENC-003 s2 asks for "AI-ready structured data" and
-- a decision is the unit the whole product is organised around -- countable, attributable, and
-- individually referenceable from a timeline. A block of prose in a note segment would be none of those.
create table if not exists practice_encounter_decision (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  -- Denormalised so a patient's decision history is one query rather than a join through every
  -- encounter they have ever had. The same choice migration 197 made for procedures.
  patient_id uuid not null references practice_patient(id) on delete cascade,
  decision text not null check (char_length(btrim(decision)) between 1 and 400),
  -- The order the practitioner put them in. A decision list is read as a sequence.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_decision_encounter on practice_encounter_decision(encounter_id, position);
create index if not exists idx_practice_decision_patient on practice_encounter_decision(patient_id, created_at desc);
alter table practice_encounter_decision enable row level security;

-- ---- 3. INVESTIGATIONS, AND WHAT THIS IS NOT -------------------------------------------------------
--
-- WARNING: THIS IS NOT AN ORDER SYSTEM AND MUST NOT BECOME ONE. CPR-ENC-001 s3 says "Requested /
-- reviewed (TYPE ONLY)" and s5 excludes "laboratory tables" and "imaging reports" outright. This
-- product does not transmit a request to a laboratory, does not receive a structured result, and cannot
-- tell anybody whether a test was actually performed.
--
-- What it records is what the PRACTITIONER decided and what they later saw -- which is exactly what a
-- longitudinal note of a consultation should hold, and no more. The arrived document itself lives in
-- practice_incoming_document (migration 200) and is not duplicated here.
--
-- NO RESULT COLUMN, deliberately. A nullable `result` is how this table would quietly become the lab
-- system it is forbidden to be, and a half-populated result column is worse than none: a clinician
-- would read the blanks as normal.
create table if not exists practice_encounter_investigation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  -- requested: the practitioner asked for it. reviewed: they have since looked at whatever came back.
  -- There is no third state, because this product cannot observe one.
  status text not null default 'requested' check (status in ('requested', 'reviewed')),
  -- A sentence about what they made of it. Free text on purpose: a structured result is the thing this
  -- table refuses to hold.
  summary text check (summary is null or char_length(summary) between 1 and 1000),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_by uuid
);

alter table practice_encounter_investigation drop constraint if exists practice_investigation_reviewed_complete;
alter table practice_encounter_investigation add constraint practice_investigation_reviewed_complete
  check ((status = 'requested' and reviewed_at is null) or (status = 'reviewed' and reviewed_at is not null));

create index if not exists idx_practice_investigation_encounter on practice_encounter_investigation(encounter_id);
create index if not exists idx_practice_investigation_patient on practice_encounter_investigation(patient_id, requested_at desc);
alter table practice_encounter_investigation enable row level security;

-- ---- 4. REFERRALS ----------------------------------------------------------------------------------
--
-- WARNING: RECORDED, NOT SENT. CPR-320 and CPR-340 both established that this product has no email, no
-- SMS and no messaging of any kind, and the tables were shaped so that nothing could ever claim to have
-- transmitted anything -- no channel column, no sent_at. The same applies here and for the same reason:
-- a referral row is a note that the practitioner decided to refer, and the letter that actually goes
-- anywhere is a practice_clinical_document with its own release register (migration 195).
create table if not exists practice_referral (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid references practice_encounter(id) on delete set null,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- Free text: the person or service referred to may be at an institution this product has never heard
  -- of, and a foreign key to a facility list would make the common case unrecordable.
  referred_to text not null check (char_length(btrim(referred_to)) between 1 and 200),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  -- What the practitioner knows, which is not the same as what happened. `accepted` and `declined` are
  -- recorded only when somebody told them.
  status text not null default 'made' check (status in ('made', 'accepted', 'declined', 'withdrawn')),
  referred_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_referral_patient on practice_referral(patient_id, referred_on desc);
create index if not exists idx_practice_referral_encounter on practice_referral(encounter_id);
alter table practice_referral enable row level security;

-- ---- 5. CLINICAL MILESTONES ------------------------------------------------------------------------
--
-- CPR-ENC-003 s6's eight examples, as a closed list plus `other`. Migration 237's lesson applies: a
-- closed list is what lets a screen know how to draw a milestone and a report know how to group one,
-- and widening it is a decision with a document behind it.
--
-- WARNING: A MILESTONE IS RECORDED BY A PRACTITIONER, NEVER DERIVED. `significant_improvement` and
-- `relapse` are clinical judgements. That is precisely why they belong in a table with an author and a
-- date on them, and precisely why nothing may compute one: the difference between this and the
-- "Stable / Improving / Monitor" chip refused on the Patients screen is that somebody put their name to
-- this. Nothing in this product may infer a milestone from the timeline and write it here.
create table if not exists practice_patient_milestone (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- The encounter it was recognised in, when there was one. Nullable: "transitioned to adult care" is
  -- a fact about a person that may be recorded outside any consultation.
  encounter_id uuid references practice_encounter(id) on delete set null,
  kind text not null check (kind in (
    'first_consultation', 'diagnosis_confirmed', 'surgery_performed',
    'long_term_treatment_started', 'significant_improvement', 'relapse',
    'transition_to_adult_care', 'discharged_from_follow_up', 'other')),
  -- The label carries the whole meaning for `other`, and adds specifics to the rest ("VP shunt
  -- inserted" against surgery_performed).
  label text not null check (char_length(btrim(label)) between 1 and 200),
  occurred_on date not null,
  note text check (note is null or char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_milestone_patient on practice_patient_milestone(patient_id, occurred_on desc);
alter table practice_patient_milestone enable row level security;

-- ---- 6. ALLERGIES, AND THE MOST IMPORTANT THREE-STATE IN THIS FILE ---------------------------------
--
-- WARNING: "NO KNOWN ALLERGIES" AND "NOBODY HAS ASKED" ARE DIFFERENT ANSWERS, AND THE DIFFERENCE CAN
-- KILL SOMEBODY. The design comp prints "No known allergies" under a heading. If that sentence were
-- rendered whenever the allergy table happened to be empty, then every patient nobody had asked would
-- read as safe to prescribe for -- and the screen would say so most confidently for the newest records,
-- which are exactly the patients whose history is least known.
--
-- So the STATUS is a column on the patient and its default is `not_recorded`. A screen may print "No
-- known allergies" only when somebody has explicitly said so. An empty list is not consent to prescribe.
alter table practice_patient add column if not exists allergy_status text not null default 'not_recorded';

alter table practice_patient drop constraint if exists practice_patient_allergy_status_allowed;
alter table practice_patient add constraint practice_patient_allergy_status_allowed
  check (allergy_status in ('not_recorded', 'none_known', 'recorded'));

-- Who said so and when. An allergy history is only as good as its provenance, and "reviewed in March"
-- is a different fact from "reviewed this morning".
alter table practice_patient add column if not exists allergy_reviewed_at timestamptz;
alter table practice_patient add column if not exists allergy_reviewed_by uuid;

create table if not exists practice_patient_allergy (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  substance text not null check (char_length(btrim(substance)) between 1 and 200),
  -- What happens, in the practitioner's words. Not coded: a coding nobody performed is CPR-330's rule.
  reaction text check (reaction is null or char_length(reaction) between 1 and 400),
  severity text check (severity is null or severity in ('mild', 'moderate', 'severe', 'anaphylaxis')),
  -- How sure anybody is. `suspected` is the honest default for something a patient reported.
  certainty text not null default 'suspected' check (certainty in ('suspected', 'confirmed', 'refuted')),
  noted_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_allergy_patient on practice_patient_allergy(patient_id);
alter table practice_patient_allergy enable row level security;

-- Blood group. Nullable with no default, for the same reason as allergy_status: an unknown blood group
-- must never render as a known one.
alter table practice_patient add column if not exists blood_group text;
alter table practice_patient drop constraint if exists practice_patient_blood_group_allowed;
alter table practice_patient add constraint practice_patient_blood_group_allowed
  check (blood_group is null or blood_group in
    ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'));

-- ---- 7. RLS ----------------------------------------------------------------------------------------
--
-- Re-asserted on the tables this migration touches but does not create. Deny-by-default with no
-- policies: every reader is a server engine holding the service role and a WorkspaceContext it has
-- already checked.
alter table practice_encounter enable row level security;
alter table practice_patient enable row level security;

notify pgrst, 'reload schema';
