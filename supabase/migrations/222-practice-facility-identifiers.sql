-- ============================================================
-- MIGRATION 222: FACILITIES AND FACILITY IDENTIFIERS (CPR-PRM-001 s3, s7, s11)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A FREE-TEXT ISSUER CANNOT ENFORCE A PER-FACILITY RULE, AND MIGRATION 193 TRIED TO.
--
-- s11: "Facility-specific identifiers are unique within a facility." 193's index keys on
--   (workspace_id, identifier_type, value_normalised, coalesce(issuer, ''))
-- which uses a TYPED STRING as the facility, and that is wrong in both directions at once:
--
--   TOO LOOSE  "Mulago Hospital", "Mulago hospital" and "Mulago" are three different issuers, so the
--              same MRN can be recorded three times against three different patients and the index will
--              allow every one of them.
--   TOO TIGHT  two patients who genuinely hold MRN 12345 at two DIFFERENT hospitals, both entered with
--              the issuer left blank, collide -- and the second is refused as a duplicate of somebody
--              they have never met.
--
-- So a facility becomes an entity, and uniqueness keys on its id.
--
-- A FACILITY IS NOT A PRACTICE LOCATION. practice_location (migration 191) is somewhere the
-- PRACTITIONER works and controls -- their clinic room. A facility is a hospital whose numbering system
-- the patient carries and which the practitioner does not own. s3 lists both, separately, and merging
-- them would mean a practitioner's own clinic issued the MRN that a national referral hospital issued.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Facilities (s3) ----------------------------------------------------------------------------------

create table if not exists practice_facility (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  -- Normalised so "Mulago Hospital" and "mulago  hospital" cannot both exist and split one hospital's
  -- numbering into two. Generated, not maintained -- the doctrine migration 193 set for patient names.
  name_normalised text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  facility_type text not null default 'hospital'
    check (facility_type in ('hospital', 'clinic', 'health_centre', 'laboratory', 'pharmacy',
                             'imaging_centre', 'insurer', 'other')),
  country text,
  -- The practice's own shorthand for it, not a national code -- there is no national facility registry
  -- in this product and inventing one would be a claim about somebody else's numbering.
  code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_facility_name
  on practice_facility(workspace_id, name_normalised);
create index if not exists idx_practice_facility_ws
  on practice_facility(workspace_id, active);

-- ---- 2. Patient identifiers gain a facility ---------------------------------------------------------------

alter table practice_patient_identifier add column if not exists facility_id uuid references practice_facility(id) on delete restrict;
-- ON DELETE RESTRICT, deliberately, where every other reference here is SET NULL: an identifier whose
-- facility vanished is an MRN belonging to nobody, and silently orphaning it would leave a number in the
-- record that cannot be traced to the system that issued it. Close the facility instead.

create index if not exists idx_practice_identifier_facility
  on practice_patient_identifier(facility_id) where facility_id is not null;

-- s7: "MRN, hospital number, clinic number, outpatient number and custom types."
alter table practice_patient_identifier drop constraint if exists practice_patient_identifier_identifier_type_check;
alter table practice_patient_identifier add constraint practice_patient_identifier_identifier_type_check
  check (identifier_type in ('practice_id', 'national_id', 'passport', 'hospital_mrn', 'hospital_number',
                             'clinic_number', 'outpatient_number', 'inpatient_number', 'insurance',
                             'phone', 'email', 'qr_code', 'custom', 'other'));

-- ---- 3. Uniqueness, keyed on the facility rather than on a string ------------------------------------------
--
-- TWO PARTIAL INDEXES, because NULL is distinct from NULL in Postgres and a single index would let a
-- facility-less identifier repeat without limit. The same trap migrations 193, 195 and 214 each hit.
--
--   WITH a facility     unique per (facility, type, value) -- s11, exactly
--   WITHOUT a facility  unique per (workspace, type, value) -- a national id or a passport is not issued
--                       by a facility at all, and scoping it to one would be wrong

drop index if exists ux_practice_identifier_live;

create unique index if not exists ux_practice_identifier_facility_live
  on practice_patient_identifier(facility_id, identifier_type, value_normalised)
  where valid_to is null and facility_id is not null;

create unique index if not exists ux_practice_identifier_global_live
  on practice_patient_identifier(workspace_id, identifier_type, value_normalised)
  where valid_to is null and facility_id is null;

-- ---- 4. Encounter-level identifiers (s7) -------------------------------------------------------------------
--
-- s7: "Separate patient-level identifiers from encounter-level identifiers." A visit number, an
-- admission number or an episode number belongs to ONE ATTENDANCE, not to the person -- a patient
-- collects a new one every time they walk in, and hanging them off the patient would make their record
-- an ever-growing list of numbers that identify nothing about them.

create table if not exists practice_encounter_identifier (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  facility_id uuid references practice_facility(id) on delete restrict,
  identifier_type text not null default 'visit_number'
    check (identifier_type in ('visit_number', 'admission_number', 'episode_number', 'lab_accession',
                               'claim_number', 'referral_number', 'other')),
  value text not null check (char_length(value) between 1 and 120),
  value_normalised text generated always as (lower(regexp_replace(value, '\s+', '', 'g'))) stored,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_enc_identifier_encounter
  on practice_encounter_identifier(encounter_id);
create index if not exists idx_practice_enc_identifier_value
  on practice_encounter_identifier(workspace_id, value_normalised);

-- One visit number per facility, per type. Same two-index shape and for the same reason.
create unique index if not exists ux_practice_enc_identifier_facility
  on practice_encounter_identifier(facility_id, identifier_type, value_normalised)
  where facility_id is not null;
create unique index if not exists ux_practice_enc_identifier_global
  on practice_encounter_identifier(workspace_id, identifier_type, value_normalised)
  where facility_id is null;

-- ---- 5. Capabilities -------------------------------------------------------------------------------------
--
-- Facilities are practice reference data: practice.locations.manage, which already means "maintain the
-- places this practice works". Patient identifiers stay on patient.edit.

-- ---- 6. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_facility enable row level security;
alter table practice_encounter_identifier enable row level security;

notify pgrst, 'reload schema';
