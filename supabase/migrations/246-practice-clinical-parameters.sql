-- ============================================================
-- MIGRATION 246: THE CLINICAL PARAMETER ENGINE AND ITS LIBRARY
-- CPR-LCP-001 (Configurable Longitudinal Clinical Parameters and Patient Monitoring Engine)
-- CPR-CPL-001 (Clinical Parameter Library and Configurable Specialty Packs Catalogue)
--
-- ----------------------------------------------------------------------------------------------------
-- TWO SPECIFICATIONS, ONE FILE, AND THAT IS NOT A SHORTCUT.
--
-- LCP-001 s6 is the ONLY place in either document that states what a parameter consists of. CPL-001 s1
-- says of itself: "This catalogue defines the initial governed library ... It is a design catalogue, not
-- a mandate to collect all listed data." So LCP owns the engine and the schema, and CPL is content
-- loaded into it PLUS two columns -- s23's risk_class and s2's licensing -- that sit ON the definition
-- table LCP describes.
--
-- Splitting them would mean either a forward reference from CPL's pack table to a definition table that
-- does not exist yet, or a second migration that ALTERs a table written minutes earlier. That is the
-- exact pattern that produced the 231/240 duplication, and it is avoided here by writing both at once.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT WAS ALREADY THERE. Almost nothing, which is why this file is long. Three things do exist and are
-- deliberately NOT rebuilt:
--
--   practice_note_template (195)      the nullable-workspace_id pattern -- NULL means a PLATFORM row
--                                     available to every practice. That is LCP s4's "Platform library"
--                                     tier exactly, and it is reused verbatim below.
--   practice_registration_field (223) the shape of a no-code field definition -- typed, optioned,
--                                     conditioned, ordered, draft/published/retired. Copied, not reused:
--                                     a registration field writes to a patient column, a clinical
--                                     parameter writes to a longitudinal series, and one table cannot be
--                                     both without one of them lying about what it holds.
--   practice_follow_up (196, 206)     .kind already accepts 'monitoring' and the plan table already
--                                     models a multi-step schedule. Due-parameter reminders EMIT into
--                                     that rail. Nothing here is a second scheduler.
--
-- WHAT IS NOT TOUCHED, and the reason, so nobody tidies it up later:
--
--   practice_treatment       NOT ONE COLUMN IS ADDED. Its encounter_id is NOT NULL, so the table
--                            structurally cannot hold a patient-reported medication, and widening it is
--                            the medication engine's problem in its own migration -- not a drive-by here.
--   practice_patient         NO weight_kg AND NO height_cm. A current-weight column is precisely the
--                            "silent rewriting" LCP s3 forbids, and it would make LCP s9's stale-weight
--                            warning uncomputable: a column that is overwritten cannot be old. Weight is
--                            a measurement series and nothing else.
--   practice_configuration   It holds locale, date_format, identifier_policy, feature_flags and no
--                            scope/key/value columns at all. It is one settings row per workspace, not a
--                            hierarchical store, so LCP s4's five levels get their own tables below
--                            rather than being folded into a jsonb blob nobody can query.
--
-- ----------------------------------------------------------------------------------------------------
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the migration runner splits the file on them, and a semicolon inside a
-- comment silently drops the statements around it while still reporting "Success. No rows returned".
-- That happened on migration 238.
-- ============================================================

-- ---- 1. THE PARAMETER DEFINITION -- LCP s6 ---------------------------------------------------------
--
-- workspace_id IS NULLABLE AND NULL MEANS PLATFORM. That single choice is LCP s4's top tier: "Platform
-- library | Defines available parameter definitions and governed templates." The alternative was copying
-- a starter set into every workspace at provisioning, which makes a correction to the definition of
-- blood pressure reach only practices provisioned after it. 195 established the pattern and the read
-- filter that goes with it -- `workspace_id is null or workspace_id = $me` -- and the engine must refuse
-- a workspace write to a platform row.
--
-- RETIREMENT IS A STATUS, NOT A DELETE. CPL s2: "Historical measurements remain available after a pack
-- or parameter is retired." LCP s13: "Deactivating a parameter never removes historical measurements."
-- Every table below that names a definition does so with NO on-delete clause, which refuses the delete
-- while any measurement survives. A retired parameter stops being offered and keeps its history.
create table if not exists practice_parameter_definition (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references practice_workspace(id) on delete cascade,

  -- LCP s6 Identity. The code is what a pack item, a plan and a formula refer to, so it is machine
  -- shaped and the display name carries the human wording.
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  short_name text check (short_name is null or char_length(btrim(short_name)) between 1 and 40),
  -- LCP s6 "synonyms". CPL names the same measurement several ways across specialties (length, height,
  -- recumbent length) and a search that only matches the display name finds none of them.
  synonyms text[] not null default '{}',

  -- LCP s6 Category, verbatim: "Anthropometric, vital sign, specialty, score, calculated or custom."
  category text not null
    check (category in ('anthropometric', 'vital_sign', 'specialty', 'score', 'calculated', 'custom')),

  -- LCP s6 Data type, verbatim: "Decimal, integer, Boolean, date, text, single choice, multiple choice
  -- or calculated." CPL s22 asks the custom builder for the same eight plus 'score', which is a category
  -- here rather than a type -- a score is an integer or a choice with governance on it, and giving it
  -- its own data type would mean two columns disagreeing about how to store one number.
  data_type text not null
    check (data_type in ('decimal', 'integer', 'boolean', 'date', 'text',
                         'single_choice', 'multi_choice', 'calculated')),

  -- LCP s6 Units: "Permitted units, canonical internal unit and conversion rules." LCP s12: "Canonical
  -- units and deterministic unit conversion." The canonical unit is what a series is stored in and
  -- compared in. permitted_units is what a form may offer.
  canonical_unit text,
  permitted_units text[] not null default '{}',
  -- { "lb": 0.45359237, "g": 0.001 } -- multiply by this to reach the canonical unit. Data, not code,
  -- because a conversion table in TypeScript and a conversion table in SQL would eventually disagree and
  -- the disagreement would be a wrong dose.
  unit_conversions jsonb not null default '{}'::jsonb,

  -- For single_choice and multi_choice. [{ "value": "...", "label": "...", "score": 0 }] -- 223's shape.
  options jsonb not null default '[]'::jsonb,

  -- CPL s22: "Define canonical and display units, precision, minimum/maximum plausible values."
  -- NAMED value_precision, NOT precision. PRECISION is a PostgreSQL keyword and this file gets applied
  -- exactly once with no rollback, so a column name that needs quoting is not worth the two characters.
  value_precision integer check (value_precision is null or value_precision between 0 and 6),

  -- LCP s6 Validation: "Plausibility limits". These do NOT refuse a value. LCP s8 step 3 says the engine
  -- "checks plausibility" and step 7 raises an alert -- a refused measurement is a measurement nobody
  -- records, and a 3 kg adult is a typing error worth a warning, not a locked form.
  min_plausible numeric,
  max_plausible numeric,

  -- LCP s6 Applicability: "Age, sex, pregnancy, diagnosis, medication, clinic or other conditions."
  -- jsonb because the condition set is open-ended and 223's `condition` column proved the shape works.
  -- { "sex": ["female"], "age_max_months": 60, "diagnosis_any": ["hydrocephalus"] }
  applicability jsonb not null default '{}'::jsonb,

  -- LCP s6 Collection rule, verbatim: "First visit, every visit, scheduled, annual, on request or
  -- conditionally required." 'every_follow_up' is added from s7.1's schedule list, because a default of
  -- "every follow-up" is the commonest clinic answer and s7.1 names it while s6's prose does not.
  default_collection_rule text not null default 'on_request'
    check (default_collection_rule in ('first_visit', 'every_visit', 'every_follow_up', 'scheduled',
                                       'annual', 'on_request', 'conditionally_required')),

  -- LCP s6 Presentation: "Form location, graph, table, patient header, dashboard or reports." This
  -- describes where a VALUE renders. It is not a navigation entry and must never become one.
  presentation jsonb not null default '{}'::jsonb,

  -- For data_type = 'calculated'. A named published formula in text, the convention
  -- src/lib/practice/clinical-calculators.ts already holds itself to: BMI and BSA compute correctly
  -- there today and need a store to read from, not new arithmetic.
  formula text,

  -- CPL s23's four classes, verbatim from the table. The control column of s23 is enforced partly here
  -- (the two constraints below) and partly by the capability gate in section 11.
  risk_class text not null default 'low'
    check (risk_class in ('low', 'moderate', 'high', 'licensed')),

  -- CPL s2: "Validated proprietary scores require licensing and version governance before production
  -- activation." CPL s23: "Activation only after licensing and version approval." The catalogue names
  -- PHQ-9, GAD-7, GMFCS, Barthel, FIM, Child-Pugh, MELD, DMFT, NYHA and Apgar among others, and several
  -- of those are copyrighted.
  licence_required boolean not null default false,
  licence_reference text,

  -- LCP s6 Governance: "Source, owner, version, effective date, review date and retirement status."
  source text,
  owner text,
  version integer not null default 1,
  effective_from timestamptz,
  review_on date,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),

  -- CPL s22: "Clone an existing governed parameter while preserving source attribution." CPL s24: "The
  -- system can identify which practice, pack and version caused a parameter to appear." A clone that
  -- forgot its origin makes both of those unanswerable.
  cloned_from_id uuid references practice_parameter_definition(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- TWO PARTIAL UNIQUE INDEXES, NOT ONE ON (workspace_id, code). In Postgres NULL is distinct from NULL,
-- so a single index would let the platform library hold the same code twice and an upsert targeting it
-- would fail silently rather than loudly. This is 195's device and it is here for 195's reason.
create unique index if not exists ux_practice_param_def_ws_code
  on practice_parameter_definition(workspace_id, code) where workspace_id is not null;
create unique index if not exists ux_practice_param_def_platform_code
  on practice_parameter_definition(code) where workspace_id is null;

create index if not exists idx_practice_param_def_lookup
  on practice_parameter_definition(workspace_id, category, status);

-- LICENSING HAS TEETH OR IT IS DECORATION. A definition may sit in draft with a licence outstanding.
-- It may not go ACTIVE without a recorded licence reference. Without this the default is an unlicensed
-- clinical instrument in production, and the practice finds out from a solicitor.
alter table practice_parameter_definition drop constraint if exists practice_param_def_licence_gate;
alter table practice_parameter_definition add constraint practice_param_def_licence_gate
  check (status is distinct from 'active'
         or licence_required = false
         or (licence_reference is not null and char_length(btrim(licence_reference)) > 0));

-- And a definition classified as licensed cannot claim it needs no licence. CPL s23 puts the two in the
-- same row of the same table, so the schema keeps them in the same row too.
alter table practice_parameter_definition drop constraint if exists practice_param_def_licensed_class;
alter table practice_parameter_definition add constraint practice_param_def_licensed_class
  check (risk_class is distinct from 'licensed' or licence_required = true);

-- A plausibility window that is the wrong way round would silently flag every value ever recorded.
alter table practice_parameter_definition drop constraint if exists practice_param_def_plausible_order;
alter table practice_parameter_definition add constraint practice_param_def_plausible_order
  check (min_plausible is null or max_plausible is null or min_plausible <= max_plausible);

alter table practice_parameter_definition enable row level security;

-- ---- 2. THE DEFINITION'S VERSIONS ------------------------------------------------------------------
--
-- LCP s3: "No silent rewriting: historical values, calculations and parameter definitions remain
-- versioned." CPL s22: "Version changes so that historical values retain their original definition."
-- LCP s11: "All calculations and alerts store the parameter-definition and rule versions used."
--
-- A SNAPSHOT, NOT A DIFF. The point of this table is that a measurement taken in March can still be read
-- against the definition that was in force in March -- the unit it was collected in, the plausibility
-- window it passed, the options it was chosen from. A diff would require replaying every version in
-- order to answer that, and a single missing row would give a confidently wrong answer.
create table if not exists practice_parameter_definition_version (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references practice_parameter_definition(id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  effective_from timestamptz not null default now(),
  -- Why it changed. CPL s22 governs the change and a version with no note is a change nobody can review.
  change_note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_param_def_version
  on practice_parameter_definition_version(definition_id, version);
create index if not exists idx_practice_param_def_version_time
  on practice_parameter_definition_version(definition_id, effective_from desc);

alter table practice_parameter_definition_version enable row level security;

-- ---- 3. PACKS -- CPL s1, s2, s24 -------------------------------------------------------------------
--
-- CPL s1: "A specialty pack is a configurable collection of reusable parameters, calculated values,
-- scores, schedules and display rules -- not a hard-coded clinical form."
--
-- workspace_id nullable for the same reason as section 1: the curated library ships as platform rows,
-- and CPL s24's "Every installed parameter can be independently configured without changing the platform
-- master" is what section 5 exists for. A practice never edits a platform pack. It installs one and
-- overrides the installation.
create table if not exists practice_parameter_pack (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references practice_workspace(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  -- CPL s4 to s21 are the specialty groupings and s21 the condition-specific packs. Free text rather
  -- than a closed list: the catalogue is explicitly a starting set, and a practice that invents
  -- "paediatric epilepsy transition" should not have to wait for a migration.
  specialty text,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  version integer not null default 1,
  -- CPL s2: "Patient-specific additions and overrides do not change the practitioner template." Cloning
  -- a governed pack is how a practice makes it theirs without touching the master.
  cloned_from_id uuid references practice_parameter_pack(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_param_pack_ws_code
  on practice_parameter_pack(workspace_id, code) where workspace_id is not null;
create unique index if not exists ux_practice_param_pack_platform_code
  on practice_parameter_pack(code) where workspace_id is null;
create index if not exists idx_practice_param_pack_lookup
  on practice_parameter_pack(workspace_id, specialty, status);

alter table practice_parameter_pack enable row level security;

-- ---- 4. WHAT IS IN A PACK --------------------------------------------------------------------------
--
-- CPL s2: "Every parameter can be individually enabled, disabled, renamed locally or assigned a
-- different frequency." All four of those live here, on the ITEM, so that renaming head circumference to
-- "OFC" inside one pack does not rename it for the whole platform.
create table if not exists practice_parameter_pack_item (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references practice_parameter_pack(id) on delete cascade,
  -- No on-delete clause: a definition that a pack still names cannot be deleted, only retired. CPL s24:
  -- "Retiring a pack preserves all previous patient data and definitions."
  definition_id uuid not null references practice_parameter_definition(id),
  local_label text check (local_label is null or char_length(btrim(local_label)) between 1 and 160),
  collection_rule text
    check (collection_rule is null or collection_rule in
      ('first_visit', 'every_visit', 'every_follow_up', 'scheduled',
       'annual', 'on_request', 'conditionally_required')),
  position integer not null default 0,
  enabled boolean not null default true
);

-- A parameter appears in a pack once. Both columns are NOT NULL, so this is a plain unique index and a
-- usable on-conflict target -- unlike a partial index, which cannot be one and whose upsert failure is
-- returned as an error that fail-soft callers discard.
create unique index if not exists ux_practice_param_pack_item
  on practice_parameter_pack_item(pack_id, definition_id);
create index if not exists idx_practice_param_pack_item_order
  on practice_parameter_pack_item(pack_id, position);

alter table practice_parameter_pack_item enable row level security;

-- ---- 5. ACTIVATION -- LCP s4's HIERARCHY BELOW THE PLATFORM LIBRARY --------------------------------
--
-- LCP s4 names five levels and one precedence order: "Encounter override -> Patient Monitoring Plan ->
-- Clinic/session configuration -> Practitioner defaults -> Platform library."
--
--   Platform library         section 1 and section 3, workspace_id IS NULL
--   Practitioner defaults    HERE, scope 'practice' or 'practitioner'
--   Clinic / session         HERE, scope 'clinic' or 'session'
--   Patient Monitoring Plan  section 6, which needs states, schedules and targets of its own
--   Encounter override       HERE, scope 'encounter'
--
-- The scope list holds all five of s4's sub-platform granularities rather than the three that were
-- obviously needed on day one, because the alternative is a later migration that drops and re-adds this
-- check constraint -- and every row written in between would have had nowhere to go.
--
-- WARNING: THE scope_id SENTINEL IS LOAD BEARING AND IS NOT TIDINESS.
--
-- `unique (workspace_id, definition_id, scope, scope_id)` looks correct with a nullable scope_id and is
-- not: in an index NULL is distinct from NULL, so two practice-wide activations of weight would both be
-- accepted, "most specific wins" would be decided by row order, and an upsert naming that constraint as
-- its conflict target would never fire -- it would INSERT a duplicate instead of updating, and return no
-- error at all. Two silent write failures in this codebase came from exactly that shape. So scope_id is
-- NOT NULL with a zero-UUID sentinel meaning "the scope needs no id", which is 245's coalesce device
-- moved into the column so that every writer gets it right without remembering to.
create table if not exists practice_parameter_activation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  definition_id uuid not null references practice_parameter_definition(id),
  -- Which pack put it here, when a pack did. CPL s24: "The system can identify which practice, pack and
  -- version caused a parameter to appear." Nullable because a practitioner may activate one parameter
  -- with no pack involved at all.
  pack_id uuid references practice_parameter_pack(id) on delete set null,
  pack_version integer,

  scope text not null default 'practice'
    check (scope in ('practice', 'practitioner', 'clinic', 'session', 'encounter')),
  -- A membership, a location, a session template or an encounter depending on scope, and the zero UUID
  -- for a practice-wide row. NO FOREIGN KEY, because the target table differs per scope -- 192 set the
  -- precedent for a documented FK-less uuid and it is better than a fake constraint to one of four.
  scope_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,

  -- CPL s2: "Each pack is inactive until selected by a practitioner." An inactive row is a deliberate
  -- switch-off that must survive a pack reinstall, which is why deactivation is a state and not a delete.
  state text not null default 'active' check (state in ('active', 'inactive')),
  collection_rule text
    check (collection_rule is null or collection_rule in
      ('first_visit', 'every_visit', 'every_follow_up', 'scheduled',
       'annual', 'on_request', 'conditionally_required')),
  local_label text check (local_label is null or char_length(btrim(local_label)) between 1 and 160),
  -- CPL s2: "Sensitive parameters should use role-based visibility and explicit purpose." Two values,
  -- because that is the boundary the capability catalogue already draws -- an assistant records a weight
  -- and a practitioner reads a mood screen. CPL s2 asks for role-based visibility without naming the
  -- roles, and inventing five would be a taxonomy no document supports.
  visibility text not null default 'team' check (visibility in ('team', 'practitioner_only')),
  -- LCP s6 Alerts at this level: "Reference thresholds, patient targets, change-from-baseline and
  -- rate-of-change rules." A practice-wide override of the platform threshold.
  threshold_override jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- The whole reason the sentinel exists. Every column in it is NOT NULL, so this is a plain unique index,
-- a valid on-conflict target, and a real refusal of the ambiguous case.
create unique index if not exists ux_practice_param_activation_scope
  on practice_parameter_activation(workspace_id, definition_id, scope, scope_id);
create index if not exists idx_practice_param_activation_lookup
  on practice_parameter_activation(workspace_id, scope, state);
create index if not exists idx_practice_param_activation_pack
  on practice_parameter_activation(pack_id);

-- The sentinel means "no id required", so it must appear only where that is true. Without this a clinic
-- row could carry the sentinel, collide with the practice-wide row, and the collision would read as a
-- duplicate-key bug rather than as the mistake it is.
alter table practice_parameter_activation drop constraint if exists practice_param_activation_scope_id;
alter table practice_parameter_activation add constraint practice_param_activation_scope_id
  check ((scope = 'practice' and scope_id = '00000000-0000-0000-0000-000000000000'::uuid)
         or (scope <> 'practice' and scope_id <> '00000000-0000-0000-0000-000000000000'::uuid));

alter table practice_parameter_activation enable row level security;

-- ---- 6. THE PATIENT MONITORING PLAN -- LCP s7 ------------------------------------------------------
--
-- LCP s13: "A parameter can be added to one patient without affecting any other patient." This table is
-- that sentence. It inherits from section 5 and overrides it for one person.
--
-- The eight states are s7's table verbatim and the fourteen schedules are s7.1's list verbatim. Neither
-- was shortened: 'inherited' and 'active' look redundant until a practitioner turns a practice default
-- OFF for one patient and back to inherited later, and 'resolved' and 'hidden' differ in whether the
-- parameter is finished or merely out of the way.
--
-- WARNING: HIDING AND SAFETY ARE TWO SEPARATE FIELDS AND MUST STAY THAT WAY.
--
-- LCP s9: "Patient-level hiding of weight must not suppress a medication-triggered safety requirement."
-- If `hidden` were the only flag, the sentence would be unenforceable -- there would be nothing left to
-- say "and yet this one is still required". So safety_required is its own boolean, set by the trigger
-- that needs the parameter, and it is NOT collapsed into the state column. A hidden row with
-- safety_required true is a legal and meaningful arrangement: routine views stop offering it, and the
-- dose path still demands it.
--
-- LCP s11: "Safety-related parameters require an authorised override and reason when deactivated or
-- bypassed." That is the constraint below, in the shape migration 238 used for outcome = 'other' -- the
-- database refuses the bypass rather than trusting every future caller to remember it.
create table if not exists practice_patient_monitoring_plan (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  definition_id uuid not null references practice_parameter_definition(id),

  state text not null default 'inherited'
    check (state in ('inherited', 'active', 'required', 'optional',
                     'paused', 'resolved', 'hidden', 'conditionally_required')),

  schedule text
    check (schedule is null or schedule in
      ('every_encounter', 'first_visit_only', 'every_follow_up',
       'daily', 'weekly', 'monthly', 'quarterly', 'six_monthly', 'annually',
       'next_visit', 'until_date', 'for_n_encounters', 'until_resolved', 'on_request')),
  until_date date,
  encounters_remaining integer,
  -- s7: "Paused | Temporarily excluded until a date or review." NULL is legal and means "until review".
  paused_until date,

  -- s7.2's practitioner-defined patient target, and the baseline the change alerts measure from.
  target_low numeric,
  target_high numeric,
  baseline_value numeric,
  baseline_measured_at timestamptz,
  -- { "type": "percentage_change", "percent": 10, "direction": "down", "window_days": 90 }
  change_rule jsonb not null default '{}'::jsonb,

  next_due_on date,
  last_measured_at timestamptz,

  -- s7: "Conditionally required | Automatically requested when triggered by medication, diagnosis or
  -- protocol." Which of the three, and which one.
  trigger_source text not null default 'practitioner'
    check (trigger_source in ('practitioner', 'medication', 'diagnosis', 'protocol')),
  trigger_ref uuid,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),

  -- The half of LCP s9 that `hidden` cannot express on its own.
  safety_required boolean not null default false,
  safety_required_reason text,
  safety_override_reason text,
  safety_overridden_at timestamptz,
  safety_overridden_by uuid,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- One plan row per patient per parameter. Both columns NOT NULL, so a plain unique index and a valid
-- on-conflict target for the customise-for-this-patient write.
create unique index if not exists ux_practice_monitoring_plan
  on practice_patient_monitoring_plan(patient_id, definition_id);
create index if not exists idx_practice_monitoring_plan_due
  on practice_patient_monitoring_plan(workspace_id, next_due_on);
create index if not exists idx_practice_monitoring_plan_patient
  on practice_patient_monitoring_plan(patient_id, state);
-- The dose path's query: which of this patient's parameters may not be quietly skipped.
create index if not exists idx_practice_monitoring_plan_safety
  on practice_patient_monitoring_plan(patient_id) where safety_required;

-- s7.1: "Until a specified date" and "For a defined number of encounters" are schedules that mean
-- nothing without the date or the number. A schedule that cannot be evaluated produces a parameter that
-- is never due, which on a monitoring screen is indistinguishable from a parameter that is up to date.
alter table practice_patient_monitoring_plan drop constraint if exists practice_monitoring_until_date;
alter table practice_patient_monitoring_plan add constraint practice_monitoring_until_date
  check (schedule is distinct from 'until_date' or until_date is not null);

alter table practice_patient_monitoring_plan drop constraint if exists practice_monitoring_encounter_count;
alter table practice_patient_monitoring_plan add constraint practice_monitoring_encounter_count
  check (schedule is distinct from 'for_n_encounters'
         or (encounters_remaining is not null and encounters_remaining > 0));

alter table practice_patient_monitoring_plan drop constraint if exists practice_monitoring_target_order;
alter table practice_patient_monitoring_plan add constraint practice_monitoring_target_order
  check (target_low is null or target_high is null or target_low <= target_high);

-- A safety requirement that says nothing is a safety requirement nobody can review or lift.
alter table practice_patient_monitoring_plan drop constraint if exists practice_monitoring_safety_reason;
alter table practice_patient_monitoring_plan add constraint practice_monitoring_safety_reason
  check (safety_required = false
         or (safety_required_reason is not null and char_length(btrim(safety_required_reason)) > 0));

-- LCP s9 AND s11, ENFORCED RATHER THAN DOCUMENTED. A safety-required parameter may still be paused,
-- hidden or resolved -- clinicians have reasons and the specification allows for them -- but only with a
-- named person and a written reason on the row. This is what stops "hide weight" from quietly disabling
-- the dose check that asked for it.
alter table practice_patient_monitoring_plan drop constraint if exists practice_monitoring_safety_override;
alter table practice_patient_monitoring_plan add constraint practice_monitoring_safety_override
  check (safety_required = false
         or state not in ('paused', 'resolved', 'hidden')
         or (safety_override_reason is not null
             and char_length(btrim(safety_override_reason)) > 0
             and safety_overridden_by is not null));

alter table practice_patient_monitoring_plan enable row level security;

-- ---- 7. WHAT CHANGED ON A PLAN, AND WHO CHANGED IT -------------------------------------------------
--
-- LCP s11: "Patient-specific configuration changes record user, date, previous value, new value and
-- reason." All five, named as the specification names them.
--
-- APPEND ONLY. No updated_at and nothing may UPDATE it -- an audit row that can be edited audits
-- nothing. `field` names what changed rather than drawing from a closed vocabulary, because the plan's
-- own eight states and fourteen schedules are already the taxonomy and a second one beside them would
-- drift out of step with the first.
create table if not exists practice_patient_monitoring_plan_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  plan_id uuid not null references practice_patient_monitoring_plan(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  field text not null check (char_length(btrim(field)) between 1 and 80),
  previous_value jsonb,
  new_value jsonb,
  -- NOT NULL, and s11 offers no exception. A nullable reason column fills with nulls within a month and
  -- the audit trail becomes a list of timestamps.
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_monitoring_event_plan
  on practice_patient_monitoring_plan_event(plan_id, occurred_at desc);
create index if not exists idx_practice_monitoring_event_patient
  on practice_patient_monitoring_plan_event(patient_id, occurred_at desc);

alter table practice_patient_monitoring_plan_event enable row level security;

-- ---- 8. THE MEASUREMENT -- LCP s8, s12 -------------------------------------------------------------
--
-- LCP s3: "Patient-centred rather than encounter-centred: measurements belong to the longitudinal
-- patient profile." So encounter_id is NULLABLE. A weight taken at the desk, a home blood pressure a
-- patient telephones in, and a value imported from a device are all real and none of them has an
-- encounter. A NOT NULL encounter_id is precisely what stops practice_treatment holding a
-- patient-reported medication, and that mistake is not repeated here.
--
-- WARNING: THIS TABLE IS INSERT ONLY. NO updated_at, AND NOTHING MAY UPDATE IT.
--
-- LCP s9: "A later weight update must not recalculate or rewrite a historical prescription." LCP s12:
-- "Immutable measurement record IDs with correction/amendment support rather than destructive editing."
-- LCP s3: "No silent rewriting."
--
-- Those three are enforced by SHAPE rather than by asking every future caller to behave. A correction is
-- a NEW ROW naming the one it corrects in amends_measurement_id. The old row is never touched, so a dose
-- calculated from it in March still cites a value that still exists and still reads the same.
--
-- WHICH IS WHY 'amended' IS NOT A STATUS VALUE. It would have to be written onto the old row by an
-- UPDATE, and the whole point is that no UPDATE happens. A row is amended when a later row names it --
-- that is a read, and it cannot go stale. The two statuses that ARE stored describe the row itself at
-- the moment it was written: an observation, or a retraction of one.
create table if not exists practice_parameter_measurement (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  definition_id uuid not null references practice_parameter_definition(id),
  -- Which definition was in force when this was collected. NULLABLE on purpose: NOT NULL would make a
  -- weight unrecordable whenever the version row was missing, and a refused weight is worse than an
  -- unversioned one. The engine fills it -- CPL s22's "historical values retain their original
  -- definition" depends on it being filled, and a harness is the right place to prove that it is.
  definition_version_id uuid references practice_parameter_definition_version(id),
  encounter_id uuid references practice_encounter(id) on delete set null,

  -- One column per data type rather than one text column holding everything. A numeric series has to be
  -- ordered, averaged and charted, and a chart over text that happens to look like numbers is how a
  -- transposed digit becomes a trend.
  value_numeric numeric,
  value_text text,
  value_boolean boolean,
  value_date date,
  value_choice text[],

  -- LCP s8 step 2: "The user records a value with date, time, unit, method, source and optional note."
  -- Unit is nullable because a Boolean "seizure today" and a single-choice NYHA class have no unit, and
  -- a NOT NULL column would be satisfied with a placeholder string that means nothing. What is enforced
  -- instead is the case that matters -- see the constraint below.
  unit text,
  -- LCP s12: "Canonical units and deterministic unit conversion." The value converted once, at write
  -- time, so a series recorded in pounds and kilograms can be charted without every reader repeating the
  -- arithmetic and one of them getting it wrong.
  canonical_value numeric,
  canonical_unit text,
  method text,

  -- LCP s12's five sources, verbatim: "practitioner-entered, team-entered, patient-reported, imported or
  -- device-generated." LCP s10.3 requires a "clear distinction between measured, patient-reported,
  -- imported and calculated values" on screen, which is only possible if it is recorded here.
  source text not null default 'practitioner'
    check (source in ('practitioner', 'team', 'patient_reported', 'imported', 'device')),

  -- LCP s12: "Effective and recorded timestamps." effective_at is when the observation was true of the
  -- patient. recorded_at is when somebody typed it. A home blood pressure entered a week later has two
  -- genuinely different dates and a chart that plots the wrong one is wrong about the patient.
  effective_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  note text check (note is null or char_length(note) between 1 and 1000),

  status text not null default 'active' check (status in ('active', 'entered_in_error')),
  amends_measurement_id uuid references practice_parameter_measurement(id),
  amendment_reason text,

  created_at timestamptz not null default now(),
  created_by uuid
);

-- NO percentile COLUMN, AND THIS IS THE PLACE THAT SAYS WHY.
--
-- CPL s5.2 asks for "Growth percentiles and z-scores" and "Weight-for-age, height-for-age,
-- weight-for-height and BMI-for-age". Every one of those is a number against a NAMED reference
-- population -- WHO 2006, CDC 2000, or another -- fitted as L, M and S coefficients per age and sex.
-- No such table exists in this product and NEITHER SPECIFICATION SUPPLIES ONE.
--
-- A percentile computed against an unnamed population is not an approximation. It is a fabricated
-- clinical figure that looks exactly like a real one, and it would be read by a clinician deciding
-- whether a child is failing to thrive. So the raw measurement is stored and the percentile is not.
-- When a reference population arrives -- as its own table, named, versioned and citable -- the
-- percentile becomes a derived value in section 9 with its source and its formula on the row.
-- Adding a percentile column before then is not a shortcut. It is the fabrication.

create index if not exists idx_practice_param_measurement_series
  on practice_parameter_measurement(patient_id, definition_id, effective_at desc);
create index if not exists idx_practice_param_measurement_ws
  on practice_parameter_measurement(workspace_id, definition_id, effective_at desc);
create index if not exists idx_practice_param_measurement_encounter
  on practice_parameter_measurement(encounter_id);
create index if not exists idx_practice_param_measurement_amends
  on practice_parameter_measurement(amends_measurement_id) where amends_measurement_id is not null;

-- A live measurement has to hold a value in one of the five columns. Without this an empty row is a
-- legal row, and an empty row on a chart is a gap that looks like a missed visit.
alter table practice_parameter_measurement drop constraint if exists practice_param_measurement_has_value;
alter table practice_parameter_measurement add constraint practice_param_measurement_has_value
  check (status <> 'active'
         or value_numeric is not null
         or value_text is not null
         or value_boolean is not null
         or value_date is not null
         or (value_choice is not null and cardinality(value_choice) >= 1));

-- A NUMBER WITH NO UNIT IS THE ONE THAT KILLS SOMEBODY. 70 is a reasonable weight in kilograms and a
-- reasonable weight in pounds, and a dose calculated from the wrong one is out by a factor of two. So
-- the unit is demanded exactly where it carries meaning, and not demanded where it does not.
alter table practice_parameter_measurement drop constraint if exists practice_param_measurement_unit;
alter table practice_parameter_measurement add constraint practice_param_measurement_unit
  check (value_numeric is null or (unit is not null and char_length(btrim(unit)) > 0));

-- The converted value and the unit it was converted into travel together or neither is interpretable.
alter table practice_parameter_measurement drop constraint if exists practice_param_measurement_canonical;
alter table practice_parameter_measurement add constraint practice_param_measurement_canonical
  check (canonical_value is null or (canonical_unit is not null and char_length(btrim(canonical_unit)) > 0));

-- LCP s12: "correction/amendment support rather than destructive editing." A correction names what it
-- corrects and says why. A retraction is the same act with no replacement value, so it names a row too.
alter table practice_parameter_measurement drop constraint if exists practice_param_measurement_amendment;
alter table practice_parameter_measurement add constraint practice_param_measurement_amendment
  check (amends_measurement_id is null
         or (amendment_reason is not null and char_length(btrim(amendment_reason)) > 0));

alter table practice_parameter_measurement drop constraint if exists practice_param_measurement_error_row;
alter table practice_parameter_measurement add constraint practice_param_measurement_error_row
  check (status <> 'entered_in_error' or amends_measurement_id is not null);

alter table practice_parameter_measurement enable row level security;

-- ---- 9. DERIVED VALUES -- LCP s5.2, s13 ------------------------------------------------------------
--
-- LCP s13: "Derived values display their source measurements and calculation timestamp." LCP s9: "the
-- medication record must preserve the exact value and timestamp used for each calculation."
--
-- PERSISTED, NOT COMPUTED ON READ, and the two sentences above are why. A body surface area recomputed
-- every time the page loads would silently change the moment a height was corrected -- including on the
-- prescription that was written from the old one. Storing it costs a second write per measurement and
-- buys the only thing that matters here: the number a clinician saw is the number that is still there.
--
-- APPEND ONLY, LIKE SECTION 8, AND FOR THE SAME SENTENCE. LCP s9: "A later weight update must not
-- recalculate or rewrite a historical prescription." There is no updated_at on this table and nothing
-- may UPDATE it. A new weight produces a NEW derived row. The old one stands, with the measurement ids
-- it was calculated from still attached to it.
create table if not exists practice_parameter_derived (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  definition_id uuid not null references practice_parameter_definition(id),
  definition_version_id uuid references practice_parameter_definition_version(id),

  value numeric not null,
  unit text,

  -- The published formula, named, in text. src/lib/practice/clinical-calculators.ts already holds itself
  -- to this and the reason it gives is the right one: arithmetic whose provenance is not on the row is
  -- arithmetic nobody can check.
  formula text not null check (char_length(btrim(formula)) between 1 and 200),
  -- LCP s13: "display their source measurements". The ids, not a copy of the values -- a copy would be a
  -- second place the same number lives, and the two would eventually disagree.
  source_measurement_ids uuid[] not null,

  calculated_at timestamptz not null default now(),
  calculated_by uuid
);

-- cardinality, NOT array_length. array_length('{}', 1) returns NULL, a check constraint that evaluates
-- to NULL PASSES, and the empty array would sail through the one test written to stop it.
alter table practice_parameter_derived drop constraint if exists practice_param_derived_has_sources;
alter table practice_parameter_derived add constraint practice_param_derived_has_sources
  check (cardinality(source_measurement_ids) >= 1);

create index if not exists idx_practice_param_derived_series
  on practice_parameter_derived(patient_id, definition_id, calculated_at desc);
create index if not exists idx_practice_param_derived_ws
  on practice_parameter_derived(workspace_id, definition_id, calculated_at desc);

alter table practice_parameter_derived enable row level security;

-- ---- 10. ALERTS -- LCP s7.2, s8, s11 ---------------------------------------------------------------
--
-- LCP s8 step 7: "Alerts are displayed with severity, rationale and recommended review action." Step 8:
-- "The responsible practitioner acknowledges, acts on or documents an override where required."
--
-- The seven alert types are s7.2's list verbatim.
--
-- SEVERITY IS THE FOUR-LEVEL PLATFORM SCALE, AND THE CHOICE WAS MADE DELIBERATELY.
--
-- LCP-001 asks for a severity and never says what the values are. The two documents in this family that
-- DO name them disagreed on the third of four: CPR-MED-001 s5 said "Informational / Advisory /
-- Significant / Critical" and CPR-PIE-001 s7 said "Informational / Advisory / Action required /
-- Critical". The user settled it on 2026-08-07 in favour of PIE s7 -- "action_required" says what to do
-- rather than how bad it is, and PIE s7 is the platform-wide alert framework where MED s5 governs only
-- medication. One taxonomy everywhere.
--
-- A THIRD SCALE IS ALREADY LIVE AND IS NOT THIS ONE. The operational critical/warning/normal on the
-- dashboard tiles answers "does this need you today". This answers "how dangerous is this reading".
-- They are different questions and must not be merged by whoever next sees two enums that look alike.
--
-- NULL IS STILL PERMITTED AND STILL MEANS SOMETHING. An alert raised by a rule that carries no severity
-- is "not classified", and must render as those words -- never as low, and never as a blank cell. The
-- constraint below constrains the VALUES, not the presence.
--
-- WHAT THE SCHEMA DOES DEMAND INSTEAD IS THE RATIONALE, NOT NULL. LCP s3: "Transparent intelligence:
-- calculated values and alerts must show the data, formula or rule used." An alert that cannot say why
-- it fired is a red mark a clinician has to guess at, and severity without rationale is exactly that.
-- A NULL severity must render as "not classified" and never as low.
create table if not exists practice_parameter_alert (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  definition_id uuid not null references practice_parameter_definition(id),
  -- The measurement that triggered it, when one did. NULL for the missing-and-overdue type, whose whole
  -- subject is a measurement that does not exist.
  measurement_id uuid references practice_parameter_measurement(id),

  alert_type text not null
    check (alert_type in ('reference_range', 'patient_target', 'change_from_baseline',
                          'percentage_change', 'rate_of_change', 'missing_overdue',
                          'trend_deviation')),
  severity text
    check (severity is null or severity in ('informational', 'advisory', 'action_required', 'critical')),

  rationale text not null check (char_length(btrim(rationale)) between 1 and 1000),
  recommended_action text check (recommended_action is null or char_length(recommended_action) between 1 and 500),

  -- LCP s11: "All calculations and alerts store the parameter-definition and rule versions used." Both,
  -- because the specification names both and an alert that cites only one cannot be reproduced.
  definition_version_id uuid references practice_parameter_definition_version(id),
  rule_version text,

  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'actioned', 'overridden')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  override_reason text,

  raised_at timestamptz not null default now(),
  created_by uuid
);

-- LCP s11: "Safety-related parameters require an authorised override and reason when deactivated or
-- bypassed." A DB constraint rather than a code check, the same shape migration 238 used for
-- outcome = 'other': an override with no justification is the get-past-the-alert answer, and the reason
-- is the entire content of the act.
alter table practice_parameter_alert drop constraint if exists practice_param_alert_override_reason;
alter table practice_parameter_alert add constraint practice_param_alert_override_reason
  check (status is distinct from 'overridden'
         or (override_reason is not null and char_length(btrim(override_reason)) > 0));

-- An acknowledgement with no timestamp cannot be put on a timeline, and "acknowledged at some point" is
-- not what s8 step 8 asks for.
alter table practice_parameter_alert drop constraint if exists practice_param_alert_acknowledged_at;
alter table practice_parameter_alert add constraint practice_param_alert_acknowledged_at
  check (status = 'open' or acknowledged_at is not null);

create index if not exists idx_practice_param_alert_open
  on practice_parameter_alert(workspace_id, status, raised_at desc);
create index if not exists idx_practice_param_alert_patient
  on practice_parameter_alert(patient_id, raised_at desc);
create index if not exists idx_practice_param_alert_measurement
  on practice_parameter_alert(measurement_id);

alter table practice_parameter_alert enable row level security;

-- ---- 11. CAPABILITIES + BACKFILL -------------------------------------------------------------------
--
-- WARNING: THESE FOUR ARE SEEDED HERE, WHICH IS WHY THEY MAY BE USED. A capability code is a string
-- compared against practice_role_capabilities. An invented one compiles perfectly, passes review, and
-- returns 403 for every user INCLUDING the practice owner -- so the feature is simply unreachable and
-- nothing errors anywhere. Six have shipped in this codebase that way.
--
-- AND THE BACKFILL IS PART OF THE MIGRATION, for the reason 192 stated when it established the pattern:
-- capability resolution reads practice_role_assignment per membership, not the catalog, so a new catalog
-- row alone never reaches an already-provisioned workspace. Without the insert..select below, every
-- pilot practice provisioned before today would silently lack the whole module.
--
-- THE SPLIT IS LCP s11's, WORD FOR WORD:
--
--   "Authorised team members may collect values but cannot necessarily change definitions or
--   thresholds."   -> parameter.record goes to the assistant as well as the practitioner. Weighing a
--                     child at the desk is the assistant's morning and always has been.
--   "Practitioners may activate packs and define their practice defaults."
--                  -> parameter.configure and pack.install are PRACTITIONER ONLY. A threshold is a
--                     clinical judgement and CPL s24 says high-risk calculations "cannot be altered by
--                     unauthorised users".
--
-- practice_owner gets none of the four. Migration 191 withholds clinical access from the business role
-- and 239 declined to undo it, and a parameter series is as clinical as this product gets.
--
-- THE THREE MEDICATION CODES ARE NOT SEEDED HERE. CPR-MED-001 has its own migration and its codes belong
-- in it -- seeding them early would put a live permission on a table that does not exist.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'parameter.view'),
  ('practice_assistant', 'parameter.view'),
  ('practitioner', 'parameter.record'),
  ('practice_assistant', 'parameter.record'),
  ('practitioner', 'parameter.configure'),
  ('practitioner', 'pack.install')
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

-- ---- 12. RLS -----------------------------------------------------------------------------------------
--
-- Deny-by-default with no policies, as everywhere else in the practice tenancy: every reader is a server
-- engine holding the service role and a WorkspaceContext it has already checked. Re-asserted here in one
-- place so that a table added to this file later without its own enable line is still covered.
alter table practice_parameter_definition enable row level security;
alter table practice_parameter_definition_version enable row level security;
alter table practice_parameter_pack enable row level security;
alter table practice_parameter_pack_item enable row level security;
alter table practice_parameter_activation enable row level security;
alter table practice_patient_monitoring_plan enable row level security;
alter table practice_patient_monitoring_plan_event enable row level security;
alter table practice_parameter_measurement enable row level security;
alter table practice_parameter_derived enable row level security;
alter table practice_parameter_alert enable row level security;

notify pgrst, 'reload schema';
