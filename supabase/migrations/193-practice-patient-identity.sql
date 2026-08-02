-- ============================================================
-- MIGRATION 193: PRACTICE PATIENT IDENTITY (CPR-DM-001 section 6, PEN-002, CPR-004/005 V3)
--
-- Phase 2 of CPR-BUILD-000. The patient becomes a real entity: practice_patient plus identifiers,
-- contacts and the merge record, with DM-001 s6.1's duplicate doctrine encoded where the database can
-- hold it and the engine holding the rest.
--
-- WHAT THE DATABASE ENFORCES HERE:
--   * IDENTIFIER UNIQUENESS "DEPENDS ON ISSUER AND TYPE" (s6.1) -- the partial unique index is on
--     (workspace, type, normalised value, issuer) for LIVE identifiers only, so the same national id
--     cannot be attached to two patients, while the same MRN number from two DIFFERENT hospitals can.
--   * NO SINGLE DEMOGRAPHIC FIELD IS UNIQUE (s6.1) -- there is deliberately NO unique index on name,
--     birth date or phone. Two patients may share all three; duplicate detection SUGGESTS, the engine
--     refuses only exact identifier collisions, and merging is a human decision.
--   * SEARCH IS INDEXED THE WAY IT IS QUERIED (s18): normalised name, normalised contact value and
--     normalised identifier value are GENERATED columns -- computed by Postgres, impossible to drift
--     from the source text -- each carrying the workspace-scoped index patient search actually hits.
--   * THE PHASE-1 PROMISE LANDS: practice_appointment.patient_id gains its real foreign key now that
--     the table it references exists. Existing rows carry NULL, which passes FK validation; the
--     drop-then-add pair keeps the statement idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
--
-- Merged patients keep their rows (status = 'merged' + merged_into_patient_id): s6.1 requires merge to
-- preserve all source identifiers, encounters and provenance, and unmerge to be possible under
-- governance -- deletion would make both impossible.
--
-- PatientRelationship (guardian/next-of-kin) and consent capture are CPR-005 functions deferred to the
-- registration-completion pass, recorded here rather than silently missing.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_patient ---------------------------------------------------------------------------

create table if not exists practice_patient (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 160),
  name_normalised text generated always as (lower(regexp_replace(display_name, '\s+', ' ', 'g'))) stored,
  sex text not null default 'unspecified'
    check (sex in ('female', 'male', 'other', 'unknown', 'unspecified')),
  birth_date date,
  age_estimate_years integer check (age_estimate_years between 0 and 130),
  status text not null default 'active'
    check (status in ('active', 'archived', 'merged')),
  merged_into_patient_id uuid references practice_patient(id) on delete set null,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_patient_name on practice_patient(workspace_id, name_normalised);
create index if not exists idx_practice_patient_dob on practice_patient(workspace_id, birth_date);
create index if not exists idx_practice_patient_status on practice_patient(workspace_id, status);

-- ---- 2. practice_patient_identifier ----------------------------------------------------------------

create table if not exists practice_patient_identifier (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  identifier_type text not null
    check (identifier_type in ('practice_id', 'national_id', 'passport', 'hospital_mrn', 'phone',
                               'email', 'insurance', 'qr_code', 'other')),
  value text not null check (char_length(value) between 1 and 120),
  value_normalised text generated always as (lower(regexp_replace(value, '\s+', '', 'g'))) stored,
  issuer text,
  location_id uuid references practice_location(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- s6.1: exact identifier matches from the same issuer carry the highest confidence -- and are the one
-- thing two patients may never share while both identifiers are live.
create unique index if not exists ux_practice_identifier_live
  on practice_patient_identifier(workspace_id, identifier_type, value_normalised, coalesce(issuer, ''))
  where valid_to is null;
create index if not exists idx_practice_identifier_value
  on practice_patient_identifier(workspace_id, value_normalised);
create index if not exists idx_practice_identifier_patient
  on practice_patient_identifier(patient_id);

-- ---- 3. practice_patient_contact -------------------------------------------------------------------

create table if not exists practice_patient_contact (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  contact_type text not null check (contact_type in ('phone', 'email', 'address')),
  value text not null check (char_length(value) between 1 and 240),
  value_normalised text generated always as (lower(regexp_replace(value, '\s+', '', 'g'))) stored,
  preferred boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_contact_lookup
  on practice_patient_contact(workspace_id, contact_type, value_normalised);
create index if not exists idx_practice_contact_patient
  on practice_patient_contact(patient_id);

-- ---- 4. practice_patient_merge (append-only; unmerge stays possible under governance) --------------

create table if not exists practice_patient_merge (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  surviving_patient_id uuid not null references practice_patient(id) on delete cascade,
  merged_patient_id uuid not null references practice_patient(id) on delete cascade,
  reason text,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_merge_ws on practice_patient_merge(workspace_id, occurred_at desc);

-- ---- 5. The Phase-1 promise: appointments gain their patient foreign key ---------------------------

alter table practice_appointment drop constraint if exists practice_appointment_patient_fk;
alter table practice_appointment
  add constraint practice_appointment_patient_fk
  foreign key (patient_id) references practice_patient(id) on delete set null;

-- ---- 6. Capability catalog additions + BACKFILL (the migration-192 lesson, applied again) ----------

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'patient.edit'),
  ('practitioner', 'patient.merge'),
  ('practice_assistant', 'patient.view'),
  ('practice_assistant', 'patient.edit')
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

-- ---- 7. RLS: deny-by-default, same doctrine as 191/192 ---------------------------------------------

alter table practice_patient enable row level security;
alter table practice_patient_identifier enable row level security;
alter table practice_patient_contact enable row level security;
alter table practice_patient_merge enable row level security;

notify pgrst, 'reload schema';
