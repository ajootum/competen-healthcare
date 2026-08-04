-- ============================================================
-- MIGRATION 221: PATIENT RELATIONSHIPS AND CONSENT (CPR-PRM-001 s6, s10, s4)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- WHICH WORKFLOW APPLIES IS DERIVED FROM THE DATE OF BIRTH. IT IS NOT A STORED FLAG.
--
-- s6: "Age <18: Guardian workflow. Age >=18: Next-of-kin workflow." A stored is_minor column is wrong
-- for the reason CPR-140 gave about overdue and CPR-240 about certificate expiry, and it is worse here:
-- a child turns eighteen on a specific morning, and a flag set at registration would still say
-- "guardian required" years later, or -- far worse -- would stop saying it the day a nightly job failed
-- to run in a practice that had not been opened for a week.
--
-- So there is NO is_minor, NO requires_guardian and NO age column. Age comes from birth_date at read
-- time, and which relationships a patient needs is computed from it.
--
-- BOTH KINDS LIVE IN ONE TABLE. A guardian and a next of kin are the same shape -- a named person, a
-- relationship, a contact, an authority -- and splitting them would mean a patient's eighteenth birthday
-- migrated rows between tables. The relationship TYPE is data; which types are expected is derived.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- s10 CAPTURES DATA-PROCESSING CONSENT ONLY. "Treatment/procedure consent excluded and handled within
-- encounters" -- and it already is: practice_procedure.consent_status (CPR-150) defaults to
-- 'not_recorded' and refuses to default to obtained. This migration adds the ADMINISTRATIVE consent
-- s10 asks for and deliberately does not touch the clinical one.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Relationships (s6) -------------------------------------------------------------------------------

create table if not exists practice_patient_relationship (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,

  -- s6: "Relationship types configurable". A CHECK rather than a lookup table, because these are the
  -- kinds of relationship a health record recognises rather than a taxonomy a practice invents -- and a
  -- free-text type would make "mum", "Mum" and "mother" three different relationships in a report.
  relationship_type text not null
    check (relationship_type in ('guardian', 'mother', 'father', 'spouse', 'partner', 'sibling',
                                 'child', 'grandparent', 'emergency_contact', 'interpreter',
                                 'employer', 'insurance_contact', 'carer', 'social_worker', 'other')),

  full_name text not null check (char_length(full_name) between 2 and 160),
  phone text,
  email text,
  address text,
  note text,

  -- THE TWO AUTHORITIES, SEPARATE, because they are separate questions and conflating them is how a
  -- product ends up letting an emergency contact consent to surgery.
  --   is_legal_guardian  may make decisions for a patient who cannot
  --   may_receive_information  may be told clinical information about them
  is_legal_guardian boolean not null default false,
  may_receive_information boolean not null default false,

  -- s6: "Support multiple relationship records" -- and exactly one may be primary.
  is_primary boolean not null default false,

  -- Ended rather than deleted: a guardian who is no longer the guardian is a fact about the record, and
  -- removing the row would erase who was authorised last March.
  effective_from date not null default current_date,
  effective_to date,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_relationship_patient
  on practice_patient_relationship(patient_id, effective_to);
create index if not exists idx_practice_relationship_ws
  on practice_patient_relationship(workspace_id, created_at desc);

-- ONE PRIMARY CONTACT AT A TIME, among the live ones. A partial unique index rather than an engine
-- check, because "who do we ring first" must not depend on which code path wrote the row.
create unique index if not exists ux_practice_relationship_primary
  on practice_patient_relationship(patient_id) where is_primary and effective_to is null;

-- NO is_minor, NO requires_guardian, NO age. See the header.

-- ---- 2. Data-processing consent (s10) ---------------------------------------------------------------------
--
-- ADMINISTRATIVE CONSENT ONLY. Treatment and procedure consent belong to the encounter and already live
-- there; a second consent record covering clinical acts would be a second answer to a question that has
-- one.

create table if not exists practice_patient_consent (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,

  consent_type text not null default 'data_processing'
    check (consent_type in ('data_processing', 'contact_by_practice', 'share_with_referrer')),

  -- THREE STATES, NOT A BOOLEAN. "Not asked" and "asked and declined" are different facts, and a
  -- boolean defaulting to false makes them the same one -- which is how a practice ends up believing
  -- somebody refused when nobody ever asked.
  state text not null default 'not_recorded'
    check (state in ('not_recorded', 'given', 'declined', 'withdrawn')),

  -- WHO GAVE IT. For a child this is the guardian, not the patient, and the record has to say so.
  given_by_relationship_id uuid references practice_patient_relationship(id) on delete set null,
  given_by_name text,

  -- What they were told. A consent record without a version is a claim that somebody agreed to
  -- something nobody can now produce.
  notice_version text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid,
  note text
);

create index if not exists idx_practice_consent_patient
  on practice_patient_consent(patient_id, consent_type, recorded_at desc);

-- ---- 3. Communication preferences and practice tags (s4) --------------------------------------------------
--
-- ON THE PATIENT, not a table each: a preference and a tag are single values about one person, and a
-- row-per-value would be three joins to answer "how does this person want to be contacted".
--
-- NOTE ON PREFERENCES: this product SENDS NOTHING (CPR-320, CPR-340). A preference here records what
-- the patient asked for so a human honours it when they pick up the phone -- it does not route
-- anything, and no code path reads it to decide where to send a message, because there is none.

alter table practice_patient add column if not exists preferred_contact_method text
  check (preferred_contact_method is null or preferred_contact_method in ('phone', 'sms', 'email', 'in_person', 'via_relative', 'none'));
alter table practice_patient add column if not exists preferred_language text;
alter table practice_patient add column if not exists contact_note text;
-- s4 "Practice tags" and "Practice notes". Tags as text[] rather than a join table: they are labels one
-- practice puts on its own patients, not a shared vocabulary.
alter table practice_patient add column if not exists tags text[];
alter table practice_patient add column if not exists practice_note text;

create index if not exists idx_practice_patient_tags on practice_patient using gin (tags);

-- ---- 4. Capabilities -------------------------------------------------------------------------------------
--
-- Relationships and consent are patient administration: patient.view to read, patient.edit to change.
-- Both already exist and both already mean exactly this.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_patient_relationship enable row level security;
alter table practice_patient_consent enable row level security;

notify pgrst, 'reload schema';
