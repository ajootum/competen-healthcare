-- 275-investigation-catalogue-and-treatment-configuration.sql
--
-- CINV-CAP-001 (Investigation Catalogue and Configuration Engine)
-- CPR-INV-001  (Rapid Investigation Capture and Review Workflow)
-- CPR-TREAT-001 (Rapid Treatment and Medication Capture)
--
-- ====================================================================================================
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- The encounter Treatment and Investigation tabs were one text box each. Every clinical word a
-- practitioner needed had to be typed, every time, and CPR-TREAT-001 s6 freezes the opposite
-- requirement: selectable values, catalogue entries, favourites, templates, sets, labels, ordering and
-- defaults SHALL be configuration driven. This migration supplies the stores those lists live in.
--
-- ====================================================================================================
-- WARNING: NONE OF THIS IS AN ORDER SYSTEM AND NONE OF IT IS A DRUG KNOWLEDGE BASE.
--
-- CPR-INV-001 s14 and CPR-TREAT-001 s16 both restate the boundary migration 238 already drew. An
-- investigation row records that a practitioner ASKED for something and later LOOKED at what came back.
-- Nothing is transmitted to a laboratory. There is still NO RESULT COLUMN, deliberately, and migration
-- 238's reasoning stands: a half populated result column is worse than none, because a clinician reads
-- the blanks as normal.
--
-- practice_medication_catalogue below is a NAME LIST so that somebody can stop typing. It carries no
-- dose range, no interaction, no contraindication and no maximum. Every safety check that needs a coded
-- drug identity is still deferred and still rendered as "not checked" by medication-constants.ts. A
-- catalogue row is not a recommendation and nothing in this schema lets it become one.
--
-- ====================================================================================================
-- THE CONFIGURATION HIERARCHY (CPR-TREAT-001 s7), AND HOW IT IS SPELT IN THIS SCHEMA.
--
--   Platform default        a row with workspace_id IS NULL. Seeded here. Read by every practice.
--   Practice configuration  a STATE row against the platform row (enable, relabel, reorder), or a row
--                           of the practice's own with workspace_id set.
--   Practitioner preference practice_investigation_preference, and a template or set owned by a person.
--   Encounter override      the reason on one encounter investigation, the custom frequency on one
--                           treatment. Held on the encounter row, never written back to configuration.
--
-- A platform update therefore cannot overwrite local activation or a local display name, which is
-- CINV-CAP-001 s5's last bullet: they are different rows in different tables.
--
-- ====================================================================================================
-- THE TRAPS THIS FILE WAS WRITTEN AROUND.
--
--   1. NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT. One in a comment
--      shredded two sections of migration 238 while still reporting success.
--   2. NO plpgsql and NO do blocks. The runner splits on semicolons.
--   3. EVERY CHECK ADDED HERE WAS CHECKED AGAINST LIVE DATA FIRST. practice_treatment holds ZERO rows
--      today and practice_encounter_investigation holds only status = 'requested', so both widened
--      CHECK constraints are supersets of what exists and cannot fail on an existing row.
--   4. EVERY UNIQUE INDEX AN UPSERT WILL AIM AT IS A FULL INDEX ON NOT NULL COLUMNS. PostgREST cannot
--      express a partial index predicate in on_conflict, so a partial unique index is an upsert that
--      silently writes nothing. The seeds below use ON CONFLICT DO NOTHING with no target, which is
--      valid against any constraint and needs no inference at all.
-- ====================================================================================================

-- ---- 1. THE INVESTIGATION CATALOGUE -- CINV-CAP-001 s3 ---------------------------------------------
--
-- ONE TABLE FOR THE MASTER CATALOGUE AND FOR LOCAL CUSTOM ITEMS, separated by workspace_id. s2 draws
-- them as two layers and they ARE two layers, but they are the same SHAPE and the encounter row has to
-- point at exactly one of them. Two tables would mean two nullable foreign keys on every encounter
-- investigation and a CHECK to say exactly one is set, which is a worse way to say the same thing.
--
-- `code` IS THE STABLE IMMUTABLE ID s3 asks for and it is globally unique. A practice custom item gets
-- a generated code, so two practices inventing the same local name never collide, and a full unique
-- index (rather than a partial one over the platform rows) is what keeps every upsert safe.
create table if not exists practice_investigation_catalogue (
  id uuid primary key default gen_random_uuid(),
  -- NULL means platform master. NOT NULL means a custom item belonging to that practice.
  workspace_id uuid references practice_workspace(id) on delete cascade,
  code text not null,
  canonical_name text not null check (char_length(btrim(canonical_name)) between 1 and 200),
  short_name text check (short_name is null or char_length(btrim(short_name)) between 1 and 60),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  subcategory text,
  source_system text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_practice_inv_cat_code
  on practice_investigation_catalogue(code);
create index if not exists idx_practice_inv_cat_scope
  on practice_investigation_catalogue(workspace_id, category, canonical_name);
create index if not exists idx_practice_inv_cat_name
  on practice_investigation_catalogue(lower(canonical_name));

alter table practice_investigation_catalogue enable row level security;

comment on table practice_investigation_catalogue is
  'CINV-CAP-001 s3. Master catalogue when workspace_id is null, practice custom item when it is set. Presence here is not a clinical recommendation.';

-- ---- 2. ALIASES -- CINV-CAP-001 s6 -----------------------------------------------------------------
--
-- A SEPARATE TABLE rather than a text array, because s9 names investigation_alias as an entity and
-- because search wants to know WHICH alias matched in order to rank an exact alias hit above a token
-- hit. An array would make that a scan in application code.
create table if not exists practice_investigation_alias (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references practice_investigation_catalogue(id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 120)
);

create unique index if not exists ux_practice_inv_alias
  on practice_investigation_alias(investigation_id, lower(btrim(alias)));
create index if not exists idx_practice_inv_alias_lookup
  on practice_investigation_alias(lower(btrim(alias)));

alter table practice_investigation_alias enable row level security;

-- ---- 3. PRACTICE ACTIVATION AND LOCAL NAMING -- CINV-CAP-001 s5 ------------------------------------
--
-- WARNING: THE ABSENCE OF A ROW IS NOT "DISABLED". A practice that has never opened Practice Setup has
-- no rows here at all and must still see the whole seeded catalogue, or the product ships empty. The
-- engine therefore treats a missing row as ENABLED, and this table records only the DEPARTURES from
-- that default. It is the same reasoning that made migration 246's activation table explicit, inverted
-- for the opposite starting point: a parameter is collected only where somebody switched it on, an
-- investigation is offerable until somebody switches it off.
create table if not exists practice_investigation_activation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  investigation_id uuid not null references practice_investigation_catalogue(id) on delete cascade,
  enabled boolean not null default true,
  local_display_name text check (local_display_name is null or char_length(btrim(local_display_name)) between 1 and 200),
  sort_order integer,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_inv_activation
  on practice_investigation_activation(workspace_id, investigation_id);

alter table practice_investigation_activation enable row level security;

-- ---- 4. PRACTITIONER PREFERENCES -- CINV-CAP-001 s7 ------------------------------------------------
--
-- favourite is EXPLICIT and usage_count is OBSERVED, and they are separate columns because they answer
-- different questions. CPR-INV-001 s10 forbids labelling either as a suggestion or a recommendation,
-- and the Quick Add endpoint has to be able to say WHICH of the two put an item on screen, so the two
-- facts must survive as two facts.
create table if not exists practice_investigation_preference (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  practitioner_id uuid not null,
  investigation_id uuid not null references practice_investigation_catalogue(id) on delete cascade,
  favourite boolean not null default false,
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz
);

create unique index if not exists ux_practice_inv_pref
  on practice_investigation_preference(workspace_id, practitioner_id, investigation_id);
create index if not exists idx_practice_inv_pref_rank
  on practice_investigation_preference(workspace_id, practitioner_id, favourite, usage_count desc);

alter table practice_investigation_preference enable row level security;

-- ---- 5. INVESTIGATION SETS -- CINV-CAP-001 s8 ------------------------------------------------------
--
-- WARNING: A SET IS A WORKFLOW SHORTCUT AND NOTHING ELSE. s8 says so twice and CPR-INV-001 s5 says it
-- again. 'Routine labs' is a bundle somebody in this practice made. Competen recommends no set.
--
-- EDITING A SET AFFECTS FUTURE USES ONLY. That is not enforced by a trigger, it is enforced by the
-- shape: an encounter investigation copies nothing from the set at all. It points at the catalogue item
-- and snapshots the display name it was recorded under, so a set edited tomorrow cannot reach back into
-- a consultation recorded today.
create table if not exists practice_investigation_set (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  owner_type text not null check (owner_type in ('practice', 'practitioner')),
  -- The practitioner who owns a personal set. Null for a practice shared set, and the constraint below
  -- refuses the two combinations that would make ownership unanswerable.
  owner_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint practice_inv_set_owner_pair
    check ((owner_type = 'practice' and owner_id is null)
           or (owner_type = 'practitioner' and owner_id is not null))
);

create unique index if not exists ux_practice_inv_set_name
  on practice_investigation_set(
    workspace_id, owner_type,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name)));
create index if not exists idx_practice_inv_set_scope
  on practice_investigation_set(workspace_id, active);

alter table practice_investigation_set enable row level security;

create table if not exists practice_investigation_set_item (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references practice_investigation_set(id) on delete cascade,
  investigation_id uuid not null references practice_investigation_catalogue(id) on delete cascade,
  sort_order integer not null default 0
);

create unique index if not exists ux_practice_inv_set_item
  on practice_investigation_set_item(set_id, investigation_id);
create index if not exists idx_practice_inv_set_item_order
  on practice_investigation_set_item(set_id, sort_order);

alter table practice_investigation_set_item enable row level security;

-- ---- 6. THE ENCOUNTER INVESTIGATION, WIDENED -- CPR-INV-001 s7 and s8 ------------------------------
--
-- Migration 238 created this table with label, status, summary and two timestamps. CPR-INV-001 s7 names
-- five more fields and s8 names a third status. Everything below is ADDITIVE.
--
-- WARNING: label STAYS AND STAYS REQUIRED. investigation_id is nullable on purpose, because a row
-- recorded before this migration has no catalogue item behind it and because s12's custom fallback must
-- keep working when a practice has no permission to write to the catalogue. The LABEL is what a clinician
-- reads, and it must never depend on a join succeeding.
alter table practice_encounter_investigation
  add column if not exists investigation_id uuid references practice_investigation_catalogue(id) on delete set null;
alter table practice_encounter_investigation
  add column if not exists display_name_snapshot text;
-- s6's clinical question. reason_shared is what the batch was recorded with, reason_override is what
-- this one item says instead. Two columns rather than one, because s6 asks for a shared reason that an
-- individual item may OVERRIDE, and collapsing them would lose which of the two a reader is looking at.
alter table practice_encounter_investigation
  add column if not exists reason_shared text;
alter table practice_encounter_investigation
  add column if not exists reason_override text;
alter table practice_encounter_investigation
  add column if not exists reviewed_by uuid;
-- s7's linked_document_id. THE RESULT LIVES THERE, NOT HERE. A reference, never a copy.
alter table practice_encounter_investigation
  add column if not exists linked_document_id uuid references practice_incoming_document(id) on delete set null;
alter table practice_encounter_investigation
  add column if not exists cancelled_at timestamptz;
alter table practice_encounter_investigation
  add column if not exists cancelled_reason text;
-- s2's single batch confirmation. Every row added by one "Add 4 investigations" press carries the same
-- id, which is what makes the batch auditable as one act after the fact.
alter table practice_encounter_investigation
  add column if not exists batch_id uuid;

create index if not exists idx_practice_investigation_catalogue
  on practice_encounter_investigation(investigation_id);
create index if not exists idx_practice_investigation_batch
  on practice_encounter_investigation(batch_id);

-- s8's THIRD STATUS. "Cancelled / not pursued" means the practitioner did not pursue it. It must not
-- imply a laboratory cancellation transaction, because there is no laboratory at the other end of this.
-- SAFE AGAINST LIVE DATA: every existing row is 'requested'.
alter table practice_encounter_investigation drop constraint if exists practice_encounter_investigation_status_check;
alter table practice_encounter_investigation add constraint practice_encounter_investigation_status_check
  check (status in ('requested', 'reviewed', 'cancelled'));

-- The completeness rule, restated for three states instead of two. A reviewed row has a review time, a
-- cancelled row has a cancellation time, and a requested row has neither.
alter table practice_encounter_investigation drop constraint if exists practice_investigation_reviewed_complete;
alter table practice_encounter_investigation add constraint practice_investigation_reviewed_complete
  check ((status = 'requested' and reviewed_at is null and cancelled_at is null)
         or (status = 'reviewed' and reviewed_at is not null)
         or (status = 'cancelled' and cancelled_at is not null));

-- ---- 7. THE MEDICATION NAME LIST -- CPR-TREAT-001 s4 -----------------------------------------------
--
-- WARNING: READ THE HEADER AGAIN. This is a list of NAMES so that a prescriber can tap instead of type.
-- It holds no dose range, no maximum, no interaction and no contraindication, and adding one to it later
-- would be a clinical safety change requiring its own governance, not a column.
--
-- The identity a prescription actually carries is still the free text generic_name on
-- practice_medication, exactly as migration 258 left it. medication_ref is a convenience that records
-- which catalogue row was tapped, and a prescription written without one is complete.
create table if not exists practice_medication_catalogue (
  id uuid primary key default gen_random_uuid(),
  -- NULL means platform seed. NOT NULL means an item this practice added.
  workspace_id uuid references practice_workspace(id) on delete cascade,
  code text not null,
  generic_name text not null check (char_length(btrim(generic_name)) between 1 and 200),
  brand_name text,
  default_formulation text,
  default_strength text,
  aliases text[] not null default '{}',
  active boolean not null default true,
  source_system text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_med_cat_code
  on practice_medication_catalogue(code);
create index if not exists idx_practice_med_cat_name
  on practice_medication_catalogue(lower(generic_name));
create index if not exists idx_practice_med_cat_scope
  on practice_medication_catalogue(workspace_id, active);

alter table practice_medication_catalogue enable row level security;

comment on table practice_medication_catalogue is
  'CPR-TREAT-001 s4. A name list for fast selection. NOT a drug knowledge base: no dose ranges, no interactions, no contraindications. Presence here is not a recommendation.';

-- ---- 8. CONFIGURABLE TREATMENT OPTION LISTS -- CPR-TREAT-001 s5, s6, s13 ---------------------------
--
-- ONE TABLE FOR EVERY SELECTABLE LIST, keyed by field_key. Seven separate tables holding a code, a
-- label and a sort order would be seven copies of the same engine, and CPR-TREAT-001 s6 asks for the
-- lists to grow without a deployment, which means the SHAPE has to be generic even where today's
-- content is not.
--
-- numeric_value is the one field that is not decoration. A frequency knows how many doses a day it
-- means and a duration knows how many days it means, and the medication engine needs both as numbers
-- (practice_medication.frequency_per_day). Null is "not stated", and migration 258 already refuses to
-- divide a daily total by a number it guessed.
create table if not exists practice_treatment_option (
  id uuid primary key default gen_random_uuid(),
  -- NULL means platform default. NOT NULL means this practice added it.
  workspace_id uuid references practice_workspace(id) on delete cascade,
  field_key text not null check (field_key in (
    'treatment_type', 'formulation', 'dose_unit', 'route', 'frequency', 'duration', 'non_drug_category')),
  code text not null check (char_length(btrim(code)) between 1 and 60),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  sort_order integer not null default 0,
  numeric_value numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- A FULL unique index over an expression, not a partial one. coalesce collapses the platform scope onto
-- a fixed uuid so that a platform row and a practice row with the same code coexist while two rows in
-- the same scope cannot.
create unique index if not exists ux_practice_treat_option
  on practice_treatment_option(
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), field_key, code);
create index if not exists idx_practice_treat_option_scope
  on practice_treatment_option(workspace_id, field_key, sort_order);

alter table practice_treatment_option enable row level security;

-- The practice's DEPARTURES from the platform defaults: hide it, rename it, move it. Same reasoning as
-- the investigation activation table -- absence of a row means the platform default stands, so a
-- practice that has configured nothing still gets a working screen.
create table if not exists practice_treatment_option_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  option_id uuid not null references practice_treatment_option(id) on delete cascade,
  enabled boolean not null default true,
  label_override text check (label_override is null or char_length(btrim(label_override)) between 1 and 120),
  sort_order_override integer,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_treat_option_state
  on practice_treatment_option_state(workspace_id, option_id);

alter table practice_treatment_option_state enable row level security;

-- ---- 9. PRESCRIPTION TEMPLATES -- CPR-TREAT-001 s12 ------------------------------------------------
--
-- WARNING: A TEMPLATE NEVER BYPASSES A SAFETY CHECK. s11 and s12 both say it. The shape enforces it by
-- holding no evaluation of any kind: a template is a set of FIELD VALUES, it is applied into the pending
-- plan as if typed, and every check runs against the patient in front of the practitioner at the moment
-- of recording. There is nowhere here for a stale verdict to live.
--
-- version exists so that a reader can tell that a template changed. It is bumped on edit and it does not
-- reach into anything already recorded, for the same reason a set does not.
create table if not exists practice_treatment_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  owner_type text not null check (owner_type in ('practice', 'practitioner')),
  owner_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  constraint practice_treat_template_owner_pair
    check ((owner_type = 'practice' and owner_id is null)
           or (owner_type = 'practitioner' and owner_id is not null))
);

create unique index if not exists ux_practice_treat_template_name
  on practice_treatment_template(
    workspace_id, owner_type,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name)));
create index if not exists idx_practice_treat_template_scope
  on practice_treatment_template(workspace_id, active);

alter table practice_treatment_template enable row level security;

create table if not exists practice_treatment_template_item (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references practice_treatment_template(id) on delete cascade,
  sort_order integer not null default 0,
  treatment_type text not null,
  label text not null check (char_length(btrim(label)) between 1 and 240),
  medication_ref uuid references practice_medication_catalogue(id) on delete set null,
  formulation text,
  dose_text text,
  dose_unit text,
  route text,
  -- BOTH, for the same reason the encounter row carries both. frequency_code is the configured option
  -- that was chosen. frequency_text is the wording, and when somebody chose Other it is THEIR wording.
  frequency_code text,
  frequency_text text,
  duration_text text,
  reason text
);

create index if not exists idx_practice_treat_template_item
  on practice_treatment_template_item(template_id, sort_order);

alter table practice_treatment_template_item enable row level security;

-- ---- 10. THE TREATMENT ROW, WIDENED -- CPR-TREAT-001 s3, s5, s9 ------------------------------------
--
-- WARNING: STILL WHAT WAS PRESCRIBED, NOT WHAT WAS ADMINISTERED. Migration 194 said it and s16 says it
-- again. There is no administration column here, there is no inpatient chart in this product, and no
-- column added below could be read as one.
--
-- WARNING: frequency ALREADY EXISTS AND IS FREE TEXT, WHICH IS WHY THE CUSTOM WORDING SURVIVES. s5 requires
-- that a practitioner who selects Other and types their own frequency has THE EXACT ENTERED WORDING
-- preserved in the encounter record. It lands in `frequency`, unparsed, and frequency_code stays null so
-- that a reader can tell a typed frequency from a chosen one.
alter table practice_treatment add column if not exists formulation text;
alter table practice_treatment add column if not exists frequency_code text;
alter table practice_treatment add column if not exists dose_unit text;
alter table practice_treatment add column if not exists medication_ref uuid
  references practice_medication_catalogue(id) on delete set null;
alter table practice_treatment add column if not exists template_id uuid
  references practice_treatment_template(id) on delete set null;
-- s9's "Record N treatments as one logical UI action". One id per press.
alter table practice_treatment add column if not exists batch_id uuid;
-- s3's non-drug treatments. The category is a configured option code, and 'other' carries its own words
-- in `label`, which is already required.
alter table practice_treatment add column if not exists non_drug_category text;

create index if not exists idx_practice_treat_batch on practice_treatment(batch_id);

-- s3's SIX TREATMENT TYPES, added to migration 194's six. SAFE AGAINST LIVE DATA: practice_treatment
-- holds zero rows today, so nothing can violate the widened set.
--
-- WARNING: AND THIS IS THE ONE LIST THAT IS NOT FULLY EXTENSIBLE WITHOUT A MIGRATION, WHICH IS SAID PLAINLY
-- RATHER THAN PAPERED OVER. A practice may relabel, reorder and deactivate these through
-- practice_treatment_option, but adding a genuinely new type code means changing this CHECK. s3's own
-- answer to that is 'other', which is seeded active and carries the practitioner's own words.
alter table practice_treatment drop constraint if exists practice_treatment_treatment_type_check;
alter table practice_treatment add constraint practice_treatment_treatment_type_check
  check (treatment_type in (
    'medication', 'procedure', 'investigation', 'advice', 'referral', 'monitoring',
    'stop_medication', 'change_medication', 'non_drug', 'no_change', 'other'));

-- ---- 10b. THE FOUR WORKFLOW SETTINGS THE SPECS MAKE CONFIGURABLE -----------------------------------
--
-- CPR-INV-001 s6 "Reason remains optional UNLESS THE PRACTICE CONFIGURES IT AS REQUIRED".
-- CPR-INV-001 s11 "warn or prevent duplicate addition ACCORDING TO CONFIGURATION".
-- CPR-TREAT-001 s5 "Reason / notes: optional concise text UNLESS LOCALLY REQUIRED".
--
-- Three sentences in two specs, and none of them has anywhere to live. A boolean per behaviour bolted
-- onto practice_configuration would need that module widened, and it is owned elsewhere. A narrow key
-- value table for THIS capture domain is the smaller change and it is honest about its scope: the keys
-- are enumerated in the CHECK, so a typo is refused rather than silently ignored, and a key nobody has
-- written falls back to the engine default.
--
-- WARNING: THIS IS WORKFLOW CONFIGURATION, NOT CLINICAL CONFIGURATION. CPR-TREAT-001 s7 splits the two
-- and puts dose ranges, safety thresholds and medication rules in the restricted class. Nothing in this
-- table can weaken a safety check, because there is no safety check here to weaken.
create table if not exists practice_capture_setting (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  setting_key text not null check (setting_key in (
    'investigation_duplicate_rule', 'investigation_reason_required',
    'treatment_reason_required', 'quick_add_limit')),
  value_text text not null check (char_length(btrim(value_text)) between 1 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_capture_setting
  on practice_capture_setting(workspace_id, setting_key);

alter table practice_capture_setting enable row level security;

-- ---- 11. CAPABILITIES -- CPR-TREAT-001 s6's "permission controlled" --------------------------------
--
-- Two new codes, and they are CONFIGURATION capabilities, not recording ones. Recording an investigation
-- stays behind encounter.edit and recording a treatment stays behind treatment.record, both of which
-- already exist and are already granted. What is new is the right to CHANGE what everybody else can
-- select from, which is exactly the safety critical configuration s6 asks to be permission controlled.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'investigation.configure'),
  ('practice_owner', 'investigation.configure'),
  ('practitioner', 'treatment.configure'),
  ('practice_owner', 'treatment.configure')
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

-- ====================================================================================================
-- 12. PLATFORM SEED CONFIGURATION -- CPR-TREAT-001 s6 and CINV-CAP-001 s4
--
-- WARNING: A SEED IS A STARTING POINT, NOT A CLINICAL STATEMENT. CINV-CAP-001 s4 asks for a catalogue
-- broad enough for launch that never blocks a local custom item, and s10 forbids reading catalogue
-- presence as a recommendation. Nothing below says a test is indicated. It says the words exist so that
-- somebody can stop spelling them.
--
-- Every insert uses ON CONFLICT DO NOTHING with no target, so a re-run changes nothing and a practice
-- that has already renamed or disabled an item keeps its own state, which lives in another table.
-- ====================================================================================================

insert into practice_investigation_catalogue (code, canonical_name, short_name, category, subcategory, source_system) values
  ('LAB-HAEM-001', 'Full Blood Count', 'FBC', 'Laboratory', 'Haematology', 'Competen Seed'),
  ('LAB-HAEM-002', 'Haemoglobin', 'Hb', 'Laboratory', 'Haematology', 'Competen Seed'),
  ('LAB-HAEM-003', 'Peripheral Blood Film', 'PBF', 'Laboratory', 'Haematology', 'Competen Seed'),
  ('LAB-HAEM-004', 'Erythrocyte Sedimentation Rate', 'ESR', 'Laboratory', 'Haematology', 'Competen Seed'),
  ('LAB-HAEM-005', 'Reticulocyte Count', 'Retics', 'Laboratory', 'Haematology', 'Competen Seed'),
  ('LAB-COAG-001', 'Prothrombin Time and INR', 'PT/INR', 'Laboratory', 'Coagulation', 'Competen Seed'),
  ('LAB-COAG-002', 'Activated Partial Thromboplastin Time', 'APTT', 'Laboratory', 'Coagulation', 'Competen Seed'),
  ('LAB-COAG-003', 'D-dimer', 'D-dimer', 'Laboratory', 'Coagulation', 'Competen Seed'),
  ('LAB-CHEM-001', 'Urea and Electrolytes', 'U&E', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-002', 'Liver Function Tests', 'LFT', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-003', 'Random Blood Sugar', 'RBS', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-004', 'Fasting Blood Sugar', 'FBS', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-005', 'Glycated Haemoglobin', 'HbA1c', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-006', 'C-Reactive Protein', 'CRP', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-007', 'Serum Creatinine', 'Creatinine', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-008', 'Lipid Profile', 'Lipids', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-009', 'Serum Calcium', 'Calcium', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-010', 'Serum Magnesium', 'Magnesium', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-011', 'Serum Amylase', 'Amylase', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-012', 'Serum Uric Acid', 'Uric acid', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-CHEM-013', 'Arterial Blood Gas', 'ABG', 'Laboratory', 'Chemistry', 'Competen Seed'),
  ('LAB-MICRO-001', 'Urine Microscopy, Culture and Sensitivity', 'Urine MC&S', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-002', 'Blood Culture', 'Blood C&S', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-003', 'Stool Microscopy, Culture and Sensitivity', 'Stool MC&S', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-004', 'Malaria Rapid Diagnostic Test', 'mRDT', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-005', 'Sputum GeneXpert for Tuberculosis', 'GeneXpert', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-006', 'Wound Swab Culture', 'Wound swab', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-MICRO-007', 'Cerebrospinal Fluid Analysis', 'CSF analysis', 'Laboratory', 'Microbiology', 'Competen Seed'),
  ('LAB-SERO-001', 'HIV Test', 'HIV', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-SERO-002', 'Hepatitis B Surface Antigen', 'HBsAg', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-SERO-003', 'Hepatitis C Antibody', 'Anti-HCV', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-SERO-004', 'Syphilis Serology', 'VDRL', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-SERO-005', 'Rheumatoid Factor', 'RF', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-SERO-006', 'Widal Test', 'Widal', 'Laboratory', 'Serology and immunology', 'Competen Seed'),
  ('LAB-ENDO-001', 'Thyroid Function Tests', 'TFT', 'Laboratory', 'Endocrine', 'Competen Seed'),
  ('LAB-ENDO-002', 'Serum Cortisol', 'Cortisol', 'Laboratory', 'Endocrine', 'Competen Seed'),
  ('LAB-ENDO-003', 'Beta hCG', 'Beta hCG', 'Laboratory', 'Endocrine', 'Competen Seed'),
  ('LAB-BB-001', 'Blood Group and Rhesus', 'Group and Rh', 'Laboratory', 'Blood bank', 'Competen Seed'),
  ('LAB-BB-002', 'Group and Crossmatch', 'Crossmatch', 'Laboratory', 'Blood bank', 'Competen Seed'),
  ('LAB-PATH-001', 'Histopathology', 'Histology', 'Laboratory', 'Pathology', 'Competen Seed'),
  ('LAB-PATH-002', 'Cytology', 'Cytology', 'Laboratory', 'Pathology', 'Competen Seed'),
  ('LAB-PATH-003', 'Cervical Smear', 'Pap smear', 'Laboratory', 'Pathology', 'Competen Seed'),
  ('RAD-XR-001', 'Chest X-ray', 'CXR', 'Radiology', 'Plain X-ray', 'Competen Seed'),
  ('RAD-XR-002', 'Abdominal X-ray', 'AXR', 'Radiology', 'Plain X-ray', 'Competen Seed'),
  ('RAD-XR-003', 'Skull X-ray', 'Skull XR', 'Radiology', 'Plain X-ray', 'Competen Seed'),
  ('RAD-XR-004', 'Limb X-ray', 'Limb XR', 'Radiology', 'Plain X-ray', 'Competen Seed'),
  ('RAD-XR-005', 'Spine X-ray', 'Spine XR', 'Radiology', 'Plain X-ray', 'Competen Seed'),
  ('RAD-US-001', 'Abdominal Ultrasound', 'Abdominal USS', 'Radiology', 'Ultrasound', 'Competen Seed'),
  ('RAD-US-002', 'Obstetric Ultrasound', 'Obstetric USS', 'Radiology', 'Ultrasound', 'Competen Seed'),
  ('RAD-US-003', 'Pelvic Ultrasound', 'Pelvic USS', 'Radiology', 'Ultrasound', 'Competen Seed'),
  ('RAD-US-004', 'Doppler Ultrasound', 'Doppler', 'Radiology', 'Ultrasound', 'Competen Seed'),
  ('RAD-CT-001', 'CT Brain', 'CT Brain', 'Radiology', 'CT', 'Competen Seed'),
  ('RAD-CT-002', 'CT Chest', 'CT Chest', 'Radiology', 'CT', 'Competen Seed'),
  ('RAD-CT-003', 'CT Abdomen and Pelvis', 'CT Abdo/Pelvis', 'Radiology', 'CT', 'Competen Seed'),
  ('RAD-CT-004', 'CT Angiogram', 'CTA', 'Radiology', 'CT', 'Competen Seed'),
  ('RAD-MR-001', 'MRI Brain', 'MRI Brain', 'Radiology', 'MRI', 'Competen Seed'),
  ('RAD-MR-002', 'MRI Spine', 'MRI Spine', 'Radiology', 'MRI', 'Competen Seed'),
  ('RAD-MR-003', 'MRI Knee', 'MRI Knee', 'Radiology', 'MRI', 'Competen Seed'),
  ('RAD-FL-001', 'Barium Swallow', 'Barium swallow', 'Radiology', 'Fluoroscopy', 'Competen Seed'),
  ('RAD-FL-002', 'Hysterosalpingogram', 'HSG', 'Radiology', 'Fluoroscopy', 'Competen Seed'),
  ('RAD-NM-001', 'Bone Scan', 'Bone scan', 'Radiology', 'Nuclear imaging', 'Competen Seed'),
  ('CAR-001', 'Electrocardiogram', 'ECG', 'Cardiology', 'Electrophysiology', 'Competen Seed'),
  ('CAR-002', 'Echocardiogram', 'ECHO', 'Cardiology', 'Imaging', 'Competen Seed'),
  ('CAR-003', 'Holter Monitor', 'Holter', 'Cardiology', 'Ambulatory monitoring', 'Competen Seed'),
  ('CAR-004', 'Exercise Tolerance Test', 'ETT', 'Cardiology', 'Functional', 'Competen Seed'),
  ('CAR-005', 'Ambulatory Blood Pressure Monitoring', 'ABPM', 'Cardiology', 'Ambulatory monitoring', 'Competen Seed'),
  ('NEU-001', 'Electroencephalogram', 'EEG', 'Neurophysiology', 'EEG', 'Competen Seed'),
  ('NEU-002', 'Electromyography', 'EMG', 'Neurophysiology', 'EMG', 'Competen Seed'),
  ('NEU-003', 'Nerve Conduction Studies', 'NCS', 'Neurophysiology', 'Nerve conduction', 'Competen Seed'),
  ('NEU-004', 'Video EEG Telemetry', 'Video EEG', 'Neurophysiology', 'EEG', 'Competen Seed'),
  ('NEU-005', 'Visual Evoked Potentials', 'VEP', 'Neurophysiology', 'Evoked potentials', 'Competen Seed'),
  ('RESP-001', 'Spirometry', 'Spirometry', 'Respiratory and physiology', 'Lung function', 'Competen Seed'),
  ('RESP-002', 'Peak Expiratory Flow Rate', 'PEFR', 'Respiratory and physiology', 'Lung function', 'Competen Seed'),
  ('RESP-003', 'Pulse Oximetry', 'SpO2', 'Respiratory and physiology', 'Bedside physiology', 'Competen Seed'),
  ('RESP-004', 'Sleep Study', 'Sleep study', 'Respiratory and physiology', 'Sleep', 'Competen Seed'),
  ('OTH-001', 'Urinalysis by dipstick', 'Urine dipstick', 'Other diagnostics', 'Bedside testing', 'Competen Seed'),
  ('OTH-002', 'Upper Gastrointestinal Endoscopy', 'OGD', 'Other diagnostics', 'Endoscopy', 'Competen Seed'),
  ('OTH-003', 'Colonoscopy', 'Colonoscopy', 'Other diagnostics', 'Endoscopy', 'Competen Seed'),
  ('OTH-004', 'Audiometry', 'Audiometry', 'Other diagnostics', 'Audiology', 'Competen Seed'),
  ('OTH-005', 'Visual Acuity Assessment', 'Visual acuity', 'Other diagnostics', 'Ophthalmology', 'Competen Seed'),
  ('OTH-006', 'Skin Prick Allergy Test', 'Skin prick test', 'Other diagnostics', 'Allergy', 'Competen Seed')
on conflict do nothing;

-- CINV-CAP-001 s6's worked examples are in here verbatim: FBC and CBC both reach Full Blood Count, and
-- "CT head" reaches CT Brain.
insert into practice_investigation_alias (investigation_id, alias)
select c.id, v.alias
from practice_investigation_catalogue c
join (values
  ('LAB-HAEM-001', 'CBC'),
  ('LAB-HAEM-001', 'Complete Blood Count'),
  ('LAB-HAEM-001', 'Full Haemogram'),
  ('LAB-HAEM-001', 'Haemogram'),
  ('LAB-HAEM-002', 'HB'),
  ('LAB-HAEM-003', 'Blood smear'),
  ('LAB-HAEM-003', 'Blood film'),
  ('LAB-COAG-001', 'INR'),
  ('LAB-COAG-001', 'PT'),
  ('LAB-COAG-002', 'PTT'),
  ('LAB-CHEM-001', 'UEC'),
  ('LAB-CHEM-001', 'Renal function'),
  ('LAB-CHEM-001', 'RFT'),
  ('LAB-CHEM-001', 'Electrolytes'),
  ('LAB-CHEM-002', 'LFTs'),
  ('LAB-CHEM-002', 'Liver enzymes'),
  ('LAB-CHEM-003', 'Blood glucose'),
  ('LAB-CHEM-003', 'RBG'),
  ('LAB-CHEM-005', 'A1c'),
  ('LAB-CHEM-008', 'Cholesterol'),
  ('LAB-CHEM-013', 'Blood gas'),
  ('LAB-MICRO-001', 'Urine culture'),
  ('LAB-MICRO-001', 'Urine M/C/S'),
  ('LAB-MICRO-002', 'Blood cultures'),
  ('LAB-MICRO-003', 'Stool ova and cysts'),
  ('LAB-MICRO-004', 'Malaria RDT'),
  ('LAB-MICRO-004', 'MPS'),
  ('LAB-MICRO-004', 'Blood slide for malaria'),
  ('LAB-MICRO-005', 'Xpert'),
  ('LAB-MICRO-005', 'TB test'),
  ('LAB-MICRO-007', 'Lumbar puncture analysis'),
  ('LAB-SERO-001', 'HIV serology'),
  ('LAB-SERO-001', 'HIV rapid test'),
  ('LAB-SERO-004', 'RPR'),
  ('LAB-SERO-004', 'TPHA'),
  ('LAB-ENDO-001', 'TSH'),
  ('LAB-ENDO-003', 'Pregnancy test'),
  ('LAB-ENDO-003', 'UPT'),
  ('LAB-ENDO-003', 'hCG'),
  ('LAB-BB-001', 'Blood grouping'),
  ('LAB-PATH-002', 'FNAC'),
  ('LAB-PATH-003', 'Smear'),
  ('RAD-XR-001', 'Chest radiograph'),
  ('RAD-XR-001', 'Chest film'),
  ('RAD-US-001', 'USS abdomen'),
  ('RAD-US-001', 'Abdominal scan'),
  ('RAD-US-002', 'Pregnancy scan'),
  ('RAD-CT-001', 'CT head'),
  ('RAD-CT-001', 'Head CT'),
  ('RAD-CT-001', 'Brain CT'),
  ('RAD-CT-003', 'CT abdo pelvis'),
  ('RAD-MR-001', 'MRI head'),
  ('RAD-MR-001', 'Brain MRI'),
  ('CAR-001', 'EKG'),
  ('CAR-001', '12 lead ECG'),
  ('CAR-002', 'Cardiac echo'),
  ('CAR-003', '24 hour ECG'),
  ('CAR-004', 'Stress test'),
  ('NEU-001', 'Brain wave test'),
  ('NEU-003', 'NCV'),
  ('RESP-001', 'Lung function test'),
  ('RESP-001', 'PFT'),
  ('RESP-004', 'Polysomnography'),
  ('OTH-001', 'Urinalysis'),
  ('OTH-002', 'Gastroscopy'),
  ('OTH-004', 'Hearing test')
) as v(code, alias) on v.code = c.code
where c.workspace_id is null
on conflict do nothing;

-- ---- Treatment option defaults ---------------------------------------------------------------------
--
-- treatment_type: CPR-TREAT-001 s3's six are seeded ACTIVE. The four types migration 194 already
-- allowed which have their own dedicated tab in the encounter -- procedure, investigation and referral
-- -- are seeded INACTIVE, so the Treatment tab does not offer a second door to a form that lives
-- elsewhere. A practice that wants them back switches them on. That is configuration doing real work.
insert into practice_treatment_option (field_key, code, label, sort_order, active) values
  ('treatment_type', 'medication', 'Medication', 10, true),
  ('treatment_type', 'change_medication', 'Change medication', 20, true),
  ('treatment_type', 'stop_medication', 'Stop medication', 30, true),
  ('treatment_type', 'non_drug', 'Non-drug treatment', 40, true),
  ('treatment_type', 'advice', 'Advice', 50, true),
  ('treatment_type', 'monitoring', 'Monitoring', 60, true),
  ('treatment_type', 'no_change', 'No treatment change', 70, true),
  ('treatment_type', 'other', 'Other', 80, true),
  ('treatment_type', 'procedure', 'Procedure', 90, false),
  ('treatment_type', 'investigation', 'Investigation', 100, false),
  ('treatment_type', 'referral', 'Referral', 110, false)
on conflict do nothing;

insert into practice_treatment_option (field_key, code, label, sort_order, active) values
  ('formulation', 'tablet', 'Tablet', 10, true),
  ('formulation', 'capsule', 'Capsule', 20, true),
  ('formulation', 'suspension', 'Suspension', 30, true),
  ('formulation', 'syrup', 'Syrup', 40, true),
  ('formulation', 'injection', 'Injection', 50, true),
  ('formulation', 'infusion', 'Infusion', 60, true),
  ('formulation', 'cream', 'Cream', 70, true),
  ('formulation', 'ointment', 'Ointment', 80, true),
  ('formulation', 'drops', 'Drops', 90, true),
  ('formulation', 'inhaler', 'Inhaler', 100, true),
  ('formulation', 'suppository', 'Suppository', 110, true),
  ('formulation', 'patch', 'Patch', 120, true),
  ('formulation', 'powder', 'Powder', 130, true),
  ('formulation', 'gel', 'Gel', 140, true)
on conflict do nothing;

insert into practice_treatment_option (field_key, code, label, sort_order, active) values
  ('route', 'oral', 'Oral', 10, true),
  ('route', 'sublingual', 'Sublingual', 20, true),
  ('route', 'topical', 'Topical', 30, true),
  ('route', 'intramuscular', 'Intramuscular', 40, true),
  ('route', 'intravenous', 'Intravenous', 50, true),
  ('route', 'subcutaneous', 'Subcutaneous', 60, true),
  ('route', 'inhaled', 'Inhaled', 70, true),
  ('route', 'nebulised', 'Nebulised', 80, true),
  ('route', 'rectal', 'Rectal', 90, true),
  ('route', 'intranasal', 'Intranasal', 100, true),
  ('route', 'ophthalmic', 'Into the eye', 110, true),
  ('route', 'otic', 'Into the ear', 120, true),
  ('route', 'vaginal', 'Vaginal', 130, true),
  ('route', 'transdermal', 'Transdermal', 140, true)
on conflict do nothing;

-- numeric_value here is DOSES PER DAY, and it is null wherever nobody can state one. PRN has no number
-- and migration 258 refuses to divide a daily total by a number it guessed, so null is the honest value.
insert into practice_treatment_option (field_key, code, label, sort_order, numeric_value, active) values
  ('frequency', 'once', 'Once only', 10, null, true),
  ('frequency', 'od', 'Once a day (OD)', 20, 1, true),
  ('frequency', 'bd', 'Twice a day (BD)', 30, 2, true),
  ('frequency', 'tds', 'Three times a day (TDS)', 40, 3, true),
  ('frequency', 'qid', 'Four times a day (QID)', 50, 4, true),
  ('frequency', 'nocte', 'At night', 60, 1, true),
  ('frequency', 'mane', 'In the morning', 70, 1, true),
  ('frequency', 'prn', 'As required (PRN)', 80, null, true),
  ('frequency', 'weekly', 'Once a week', 90, null, true),
  ('frequency', 'other', 'Other frequency', 999, null, true)
on conflict do nothing;

-- numeric_value here is DAYS. 'until_review' and 'ongoing' have no number, deliberately.
insert into practice_treatment_option (field_key, code, label, sort_order, numeric_value, active) values
  ('duration', 'single', 'Single dose', 10, null, true),
  ('duration', 'd3', '3 days', 20, 3, true),
  ('duration', 'd5', '5 days', 30, 5, true),
  ('duration', 'd7', '7 days', 40, 7, true),
  ('duration', 'd10', '10 days', 50, 10, true),
  ('duration', 'd14', '14 days', 60, 14, true),
  ('duration', 'm1', '1 month', 70, 30, true),
  ('duration', 'm3', '3 months', 80, 90, true),
  ('duration', 'until_review', 'Until review', 90, null, true),
  ('duration', 'ongoing', 'Ongoing', 100, null, true),
  ('duration', 'other', 'Other duration', 999, null, true)
on conflict do nothing;

insert into practice_treatment_option (field_key, code, label, sort_order, active) values
  ('dose_unit', 'mg', 'mg', 10, true),
  ('dose_unit', 'g', 'g', 20, true),
  ('dose_unit', 'mcg', 'mcg', 30, true),
  ('dose_unit', 'ml', 'mL', 40, true),
  ('dose_unit', 'iu', 'IU', 50, true),
  ('dose_unit', 'unit', 'units', 60, true),
  ('dose_unit', 'tablet', 'tablets', 70, true),
  ('dose_unit', 'drop', 'drops', 80, true),
  ('dose_unit', 'puff', 'puffs', 90, true),
  ('dose_unit', 'sachet', 'sachets', 100, true)
on conflict do nothing;

-- CPR-TREAT-001 s13. The spec's own four examples plus the ones a general practice reaches for, and it
-- is a configured list precisely because that sentence in the spec ends "but the list is configuration
-- driven".
insert into practice_treatment_option (field_key, code, label, sort_order, active) values
  ('non_drug_category', 'physiotherapy', 'Physiotherapy', 10, true),
  ('non_drug_category', 'wound_care', 'Wound care', 20, true),
  ('non_drug_category', 'dietary', 'Dietary intervention', 30, true),
  ('non_drug_category', 'observation', 'Observation', 40, true),
  ('non_drug_category', 'rehydration', 'Rehydration', 50, true),
  ('non_drug_category', 'immobilisation', 'Splinting or immobilisation', 60, true),
  ('non_drug_category', 'counselling', 'Counselling', 70, true),
  ('non_drug_category', 'education', 'Patient education', 80, true),
  ('non_drug_category', 'other', 'Other', 999, true)
on conflict do nothing;

-- ---- The medication name list. READ SECTION 7 AGAIN BEFORE ADDING A COLUMN TO THIS. -----------------
insert into practice_medication_catalogue (code, generic_name, default_formulation, aliases, source_system) values
  ('MED-001', 'Paracetamol', 'tablet', array['Acetaminophen', 'Panadol'], 'Competen Seed'),
  ('MED-002', 'Ibuprofen', 'tablet', array['Brufen'], 'Competen Seed'),
  ('MED-003', 'Diclofenac', 'tablet', array['Voltaren'], 'Competen Seed'),
  ('MED-004', 'Amoxicillin', 'capsule', array['Amoxil'], 'Competen Seed'),
  ('MED-005', 'Amoxicillin with Clavulanic Acid', 'tablet', array['Co-amoxiclav', 'Augmentin'], 'Competen Seed'),
  ('MED-006', 'Azithromycin', 'tablet', array['Zithromax'], 'Competen Seed'),
  ('MED-007', 'Ceftriaxone', 'injection', array['Rocephin'], 'Competen Seed'),
  ('MED-008', 'Ciprofloxacin', 'tablet', array['Cipro'], 'Competen Seed'),
  ('MED-009', 'Doxycycline', 'capsule', array[]::text[], 'Competen Seed'),
  ('MED-010', 'Metronidazole', 'tablet', array['Flagyl'], 'Competen Seed'),
  ('MED-011', 'Cotrimoxazole', 'tablet', array['Septrin', 'Trimethoprim with sulfamethoxazole'], 'Competen Seed'),
  ('MED-012', 'Gentamicin', 'injection', array[]::text[], 'Competen Seed'),
  ('MED-013', 'Benzylpenicillin', 'injection', array['Penicillin G'], 'Competen Seed'),
  ('MED-014', 'Flucloxacillin', 'capsule', array[]::text[], 'Competen Seed'),
  ('MED-015', 'Nitrofurantoin', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-016', 'Artemether with Lumefantrine', 'tablet', array['Coartem', 'AL'], 'Competen Seed'),
  ('MED-017', 'Artesunate', 'injection', array[]::text[], 'Competen Seed'),
  ('MED-018', 'Albendazole', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-019', 'Praziquantel', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-020', 'Fluconazole', 'capsule', array['Diflucan'], 'Competen Seed'),
  ('MED-021', 'Aciclovir', 'tablet', array['Acyclovir'], 'Competen Seed'),
  ('MED-022', 'Omeprazole', 'capsule', array['Losec'], 'Competen Seed'),
  ('MED-023', 'Ranitidine', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-024', 'Ondansetron', 'tablet', array['Zofran'], 'Competen Seed'),
  ('MED-025', 'Metoclopramide', 'tablet', array['Maxolon'], 'Competen Seed'),
  ('MED-026', 'Oral Rehydration Salts', 'powder', array['ORS'], 'Competen Seed'),
  ('MED-027', 'Zinc Sulphate', 'tablet', array['Zinc'], 'Competen Seed'),
  ('MED-028', 'Salbutamol', 'inhaler', array['Ventolin', 'Albuterol'], 'Competen Seed'),
  ('MED-029', 'Beclometasone', 'inhaler', array[]::text[], 'Competen Seed'),
  ('MED-030', 'Prednisolone', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-031', 'Hydrocortisone', 'injection', array[]::text[], 'Competen Seed'),
  ('MED-032', 'Dexamethasone', 'injection', array[]::text[], 'Competen Seed'),
  ('MED-033', 'Cetirizine', 'tablet', array['Zyrtec'], 'Competen Seed'),
  ('MED-034', 'Chlorphenamine', 'tablet', array['Piriton'], 'Competen Seed'),
  ('MED-035', 'Adrenaline', 'injection', array['Epinephrine'], 'Competen Seed'),
  ('MED-036', 'Amlodipine', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-037', 'Nifedipine', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-038', 'Enalapril', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-039', 'Losartan', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-040', 'Atenolol', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-041', 'Bisoprolol', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-042', 'Hydrochlorothiazide', 'tablet', array['HCTZ'], 'Competen Seed'),
  ('MED-043', 'Furosemide', 'tablet', array['Frusemide', 'Lasix'], 'Competen Seed'),
  ('MED-044', 'Spironolactone', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-045', 'Atorvastatin', 'tablet', array['Lipitor'], 'Competen Seed'),
  ('MED-046', 'Simvastatin', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-047', 'Aspirin', 'tablet', array['Acetylsalicylic acid'], 'Competen Seed'),
  ('MED-048', 'Clopidogrel', 'tablet', array['Plavix'], 'Competen Seed'),
  ('MED-049', 'Warfarin', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-050', 'Metformin', 'tablet', array['Glucophage'], 'Competen Seed'),
  ('MED-051', 'Glibenclamide', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-052', 'Insulin (soluble)', 'injection', array['Actrapid'], 'Competen Seed'),
  ('MED-053', 'Levothyroxine', 'tablet', array['Thyroxine'], 'Competen Seed'),
  ('MED-054', 'Carbamazepine', 'tablet', array['Tegretol'], 'Competen Seed'),
  ('MED-055', 'Sodium Valproate', 'tablet', array['Epilim', 'Valproate'], 'Competen Seed'),
  ('MED-056', 'Phenytoin', 'capsule', array[]::text[], 'Competen Seed'),
  ('MED-057', 'Levetiracetam', 'tablet', array['Keppra'], 'Competen Seed'),
  ('MED-058', 'Phenobarbitone', 'tablet', array['Phenobarbital'], 'Competen Seed'),
  ('MED-059', 'Diazepam', 'tablet', array['Valium'], 'Competen Seed'),
  ('MED-060', 'Amitriptyline', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-061', 'Fluoxetine', 'capsule', array['Prozac'], 'Competen Seed'),
  ('MED-062', 'Ferrous Sulphate', 'tablet', array['Iron'], 'Competen Seed'),
  ('MED-063', 'Folic Acid', 'tablet', array[]::text[], 'Competen Seed'),
  ('MED-064', 'Vitamin A', 'capsule', array['Retinol'], 'Competen Seed'),
  ('MED-065', 'Tramadol', 'capsule', array[]::text[], 'Competen Seed'),
  ('MED-066', 'Morphine', 'injection', array[]::text[], 'Competen Seed'),
  ('MED-067', 'Tetanus Toxoid', 'injection', array['TT'], 'Competen Seed'),
  ('MED-068', 'Chlorhexidine', 'gel', array[]::text[], 'Competen Seed'),
  ('MED-069', 'Silver Sulfadiazine', 'cream', array[]::text[], 'Competen Seed'),
  ('MED-070', 'Hydrocortisone', 'cream', array[]::text[], 'Competen Seed')
on conflict do nothing;

notify pgrst, 'reload schema';
