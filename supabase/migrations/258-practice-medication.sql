-- ============================================================
-- MIGRATION 258: THE MEDICATION RECORD AND ITS TIMELINE
-- CPR-MED-001 (Medication Record and Medication Safety Engine), ON THE MIDDLE PATH
--
-- THREE TABLES, AND THE FOUR THE SURVEY PROPOSED THAT ARE DELIBERATELY NOT HERE.
--
-- practice_medication_rule and practice_medication_warning were proposed and are DECLINED. The rule
-- table would be an empty drug knowledge base. An empty rule table makes every safety check return
-- nothing to say, and a screen with no warning on it reads as a screen that found no problem -- the
-- exact failure mode migration 238 named for allergies. The warning table would then store the rows
-- that empty table never produced. Both arrive with a licensed knowledge base or not at all.
--
-- practice_medication_monitoring was proposed and is DECLINED as a table. MED s7 has two halves and
-- both already have homes. "Automatically activate required parameters (e.g. weight)" is
-- practice_patient_monitoring_plan, whose trigger_source column already accepts 'medication' and
-- whose trigger_ref already holds the id of the thing that triggered it -- migration 246 built that
-- column FOR this. "Review intervals" is one integer and one date about one medication, so it is two
-- columns on the medication row rather than a table with a row per medication holding two facts.
--
-- practice_medication_favourite was proposed and is DECLINED. A favourite is derivable from what this
-- practitioner has actually recorded, and a curated list is a second thing to maintain that goes
-- stale in silence. See FAVOURITES_ARE_DERIVED.
--
-- WHAT WAS ALREADY THERE, AND IS NOT REBUILT OR WIDENED:
--
--   practice_treatment (194)   NOT ONE COLUMN IS ADDED. Its encounter_id is NOT NULL, so it cannot
--                              hold a medication a patient reported outside a consultation, and
--                              widening it would produce a second place to write the same sentence,
--                              which CPR-ENC-002 s9's no-duplicate-data-entry forbids. The link runs
--                              the other way, from practice_medication.treatment_id.
--   practice_parameter_*(246)  the weight and height series, their units, plausibility limits and
--                              this patient's monitoring plan. A dose calculation cites a measurement
--                              row by id.
--   practice_follow_up (196)   .kind already accepts 'monitoring'. Review reminders EMIT into it.
--   practice_patient_allergy   (238) free-text substance, by deliberate decision. Displayed, never
--                              matched.
-- ============================================================
--
-- ---- 1. THE MEDICATION RECORD -- MED s2 -----------------------------------------------------------
--
-- WARNING: encounter_id IS NULLABLE AND THAT SINGLE COLUMN IS THE WHOLE REASON THIS TABLE EXISTS.
-- Every clinical row in this product until now hangs off an encounter, a patient identity or a
-- document. A medication a patient walked in already taking has no encounter behind it, and a course
-- started in March outlives the consultation that started it. This is the first longitudinal clinical
-- STATE store in Practice, and its boundary is restated in section 3 below.
--
-- WARNING: treatment_id POINTS AT THE DECISION THAT STARTED IT, WHEN THERE WAS ONE. It is how a legacy
-- treatment row is carried across without being copied twice, and a legacy row that nothing points at
-- is precisely the reconciliation worklist.
create table if not exists practice_medication (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  encounter_id uuid references practice_encounter(id),
  treatment_id uuid references practice_treatment(id),

  -- MED s2 "Generic and brand name". FREE TEXT, and the comment says so where somebody would
  -- otherwise assume otherwise: there is no drug vocabulary in this product. Every safety check that
  -- needs a coded identity is deferred FOR THIS REASON and is rendered as "not checked" rather than
  -- omitted.
  generic_name text not null check (char_length(btrim(generic_name)) between 1 and 200),
  brand_name text check (brand_name is null or char_length(btrim(brand_name)) between 1 and 200),
  formulation text,
  -- "250 mg/5 mL". Held as written, never parsed. A parser that got this wrong would be wrong inside
  -- a dose.
  strength_text text,

  -- MED s2 "Dose, units, route, frequency, duration". dose_text is what a person reads and is
  -- REQUIRED. The numeric pair beside it is optional and exists so a dose calculation can be attached
  -- to a row -- a dose nobody could parse still records perfectly as text, which is better than a row
  -- that refuses to save.
  dose_text text not null check (char_length(btrim(dose_text)) between 1 and 200),
  dose_value numeric,
  dose_unit text,
  route text,
  frequency text,
  -- How many administrations in twenty-four hours, WHEN SOMEBODY STATED IT. Null is "not stated" and
  -- the dose engine withholds the per-dose figure of a mg/kg/day regimen rather than dividing by a
  -- number it guessed.
  frequency_per_day numeric check (frequency_per_day is null or frequency_per_day > 0),
  duration_text text,
  indication text,

  -- MED s2 "Start/stop dates". DATES, NOT TIMESTAMPS. "Started on 1 January" is a day, and rendering
  -- a timezone-shifted instant for it is how a course appears to start the evening before.
  -- WARNING: THESE ARE WHAT MAKES "CURRENT" DERIVABLE, and only for rows in THIS table. The refusal in
  -- patient-workspace-constants.ts stays true for practice_treatment, whose duration is free text
  -- with no computable end, and the two lists are kept apart on screen for that reason.
  started_on date,
  stopped_on date,

  -- MED s2 "Prescriber/source". Free text: the prescriber may be at another hospital entirely, and a
  -- foreign key to a membership would refuse to record exactly the case worth recording.
  prescriber text,
  recorded_source text not null default 'practitioner'
    check (recorded_source in ('practitioner', 'patient_reported', 'imported')),

  -- LCP-001 s9: "Patient-reported medication doses are labelled unverified until reviewed by a
  -- practitioner." The verification is a fact with a person and a time on it, not a boolean.
  verified_at timestamptz,
  verified_by uuid,

  -- MED s2's four, verbatim: "Active, completed, paused and discontinued status."
  -- WARNING: NOT practice_treatment's FOUR. That table's planned/in_progress/completed/cancelled is the
  -- lifecycle of a decision inside one consultation. These are the lifecycle of a course that
  -- outlives it, and folding them together would force one of them to lie.
  status text not null default 'active'
    check (status in ('active', 'completed', 'paused', 'discontinued')),
  discontinued_reason text,

  -- MED s7 "Review intervals". Two columns rather than a table: it is one interval and one date about
  -- one medication. Whether a review is OVERDUE is not stored -- it depends on the clock, and a
  -- boolean written into a row is wrong from the moment the clock moves past it.
  review_interval_days integer check (review_interval_days is null or review_interval_days between 1 and 3650),
  next_review_on date,
  -- MED s7 "Follow-up scheduling" EMITS into the existing rail. No second scheduler.
  review_follow_up_id uuid references practice_follow_up(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  -- A course that stopped before it started is a transcription error, and the arithmetic that reads
  -- these two would happily produce a plausible-looking duration from them.
  constraint practice_medication_stop_after_start
    check (stopped_on is null or started_on is null or stopped_on >= started_on),

  -- DISCONTINUING WITHOUT SAYING WHY leaves the next prescriber unable to tell "the course finished"
  -- from "it made them ill", which is the only thing they need to know. Same shape migration 238 used
  -- for outcome = 'other', and the same shape as the override rule below.
  constraint practice_medication_discontinued_reason
    check (status <> 'discontinued'
           or (discontinued_reason is not null and char_length(btrim(discontinued_reason)) > 0)),

  -- A verification with no person behind it cannot be reviewed, and "verified by somebody at some
  -- point" is not what LCP s9 asks for. Both or neither.
  constraint practice_medication_verified_pair
    check ((verified_at is null and verified_by is null)
           or (verified_at is not null and verified_by is not null))
);
--
-- The patient's own list, newest first. Partial on `active` for the "taking now" read, which is the
-- one a prescriber makes on every visit.
create index if not exists idx_practice_medication_patient
  on practice_medication(patient_id, status, started_on desc);
create index if not exists idx_practice_medication_active
  on practice_medication(workspace_id, patient_id) where status = 'active';
-- The reconciliation worklist: unreviewed rows somebody else supplied. Partial, because the practice
-- opens this list to work through it and the practitioner-recorded rows are not on it.
create index if not exists idx_practice_medication_unverified
  on practice_medication(workspace_id, recorded_source)
  where verified_at is null and recorded_source <> 'practitioner';
-- MED s7's review worklist.
create index if not exists idx_practice_medication_review_due
  on practice_medication(workspace_id, next_review_on) where status in ('active', 'paused');
-- The other half of reconciliation: which legacy treatment decisions have been carried across.
create index if not exists idx_practice_medication_treatment
  on practice_medication(treatment_id) where treatment_id is not null;
-- MED s9 "Search" and "Favourite medications", the second of which is DERIVED from this index rather
-- than from a curated list -- see FAVOURITES_ARE_DERIVED.
create index if not exists idx_practice_medication_name
  on practice_medication(workspace_id, lower(generic_name));

alter table practice_medication enable row level security;
--
-- ---- 2. THE TIMELINE -- MED s6 --------------------------------------------------------------------
--
-- s6 verbatim: "Medication history / Dose changes / Reasons for changes / Adverse drug reactions /
-- Adherence notes / Effectiveness observations."
--
-- WARNING: APPEND-ONLY, AND THE SHAPE IS THE ENFORCEMENT. There is no updated_at and there is no update path
-- in the engine. MED s10: "Historical data never overwritten." A correction is a new row. This is
-- migration 246's rule for practice_parameter_measurement in a second domain, and the medication
-- harness proves it the same way -- a source scan for an UPDATE on this table, with a control that
-- proves the scan can see one.
--
-- WARNING: safety_override IS THE ONE EVENT TYPE THAT IS NOT s6's, AND IT IS WHERE MED s5 LANDS. s5 asks for
-- four warning severities with "practitioner override with justification" and a "full audit trail".
-- Nine of the ten checks those severities would grade are deferred for want of a drug knowledge
-- base. The ONE that runs is LCP s9's weight validation, and prescribing weight-based anyway when the
-- weight is absent or stale is a clinical act that must leave a trace. It leaves it here.
create table if not exists practice_medication_event (
  id uuid primary key default gen_random_uuid(),
  -- DENORMALISED FROM THE PARENT ON PURPOSE, as practice_guidance_section does it: every read scopes
  -- itself in the statement rather than after a prior read. Written on insert and never afterwards.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  medication_id uuid not null references practice_medication(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  encounter_id uuid references practice_encounter(id),

  event_type text not null check (event_type in (
    'started', 'dose_changed', 'paused', 'resumed', 'discontinued', 'completed',
    'adverse_reaction', 'adherence_note', 'effectiveness_note', 'verified', 'safety_override')),

  -- What changed, both sides. Not a diff computed at read time: the row records what the values WERE,
  -- so a later correction to the parent cannot rewrite what this entry says happened.
  previous jsonb not null default '{}'::jsonb,
  next jsonb not null default '{}'::jsonb,

  -- s6 "Reasons for changes". Required for three event types by the constraint below.
  reason text,
  -- s6's adverse reactions, adherence and effectiveness notes, in the practitioner's own words.
  narrative text check (narrative is null or char_length(narrative) <= 4000),

  -- A DATE, because "she stopped it last Tuesday" is a day somebody is recalling, and stamping it
  -- with the instant the form was submitted would put it on the timeline in the wrong place.
  occurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid,

  -- WARNING: THE THREE ACTS THAT ARE MEANINGLESS WITHOUT WORDS. A dose change with no reason cannot be
  -- reviewed, a discontinuation with no reason cannot be told from a completed course, and an
  -- override with no justification is the get-past-the-alert answer -- the reason IS the act. A
  -- DATABASE CONSTRAINT RATHER THAN A CODE CHECK, the same shape migration 238 used for
  -- outcome = 'other' and migration 246 for an overridden alert, because a validation that lives only
  -- in TypeScript is one the next caller does not have.
  constraint practice_medication_event_reason
    check (event_type not in ('dose_changed', 'discontinued', 'safety_override')
           or (reason is not null and char_length(btrim(reason)) > 0))
);
--
create index if not exists idx_practice_medication_event_timeline
  on practice_medication_event(medication_id, occurred_on desc, created_at desc);
create index if not exists idx_practice_medication_event_patient
  on practice_medication_event(patient_id, occurred_on desc);
-- The safety-override register: MED s5's "full audit trail", as a list somebody can open.
create index if not exists idx_practice_medication_event_override
  on practice_medication_event(workspace_id, created_at desc) where event_type = 'safety_override';

alter table practice_medication_event enable row level security;
--
-- ---- 3. THE DOSE CALCULATION -- MED s3, LCP s9 ----------------------------------------------------
--
-- WARNING: IMMUTABLE. NO updated_at, NO update path, EVER.
--
-- LCP-001 s9, both sentences: "the medication record must preserve the exact value and timestamp used
-- for each calculation" and "A LATER WEIGHT UPDATE MUST NOT RECALCULATE OR REWRITE A HISTORICAL
-- PRESCRIPTION." A child weighed again next month must not silently change what was prescribed last
-- month, and the only way to guarantee that against every future caller is a table nothing can update.
--
-- WARNING: THE WEIGHT IS STORED THREE WAYS AND ALL THREE ARE NEEDED. The VALUE is what the arithmetic used.
-- The TIMESTAMP is how a reader judges whether it was reasonable. The MEASUREMENT ID is how they open
-- the row and check. Storing only the id would break the first rule the moment that row was amended.
create table if not exists practice_medication_dose_calculation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- NULLABLE, because a prescriber calculates BEFORE deciding. A calculation with no medication yet is
  -- a working-out somebody did, and discarding it would lose the one artefact that shows what they
  -- were shown at the moment they decided.
  medication_id uuid references practice_medication(id) on delete set null,
  encounter_id uuid references practice_encounter(id),

  -- MED s3's four, verbatim.
  basis text not null check (basis in ('mg_per_kg', 'mg_per_kg_per_day', 'mg_per_m2', 'fixed')),
  -- The rate the prescriber typed: mg/kg, mg/kg/day or mg/m2. Null only for a fixed regimen.
  rate_value numeric,
  dose_unit text not null default 'mg',
  doses_per_day numeric check (doses_per_day is null or doses_per_day > 0),

  -- LCP s9's "exact value and timestamp", plus the row they came from.
  weight_kg numeric,
  weight_measurement_id uuid references practice_parameter_measurement(id),
  weight_effective_at timestamptz,
  height_cm numeric,
  height_measurement_id uuid references practice_parameter_measurement(id),
  bsa_m2 numeric,

  -- The result. per_dose is null for a mg/kg/day regimen with no stated frequency -- dividing a daily
  -- total by a number nobody stated would produce a per-dose figure this product invented.
  per_dose numeric,
  daily_total numeric,

  -- MED s3's sixth bullet: "Transparent calculation display." NOT a rendering preference -- a NOT NULL
  -- column with a non-empty check, because a dose figure with no working beside it is unverifiable by
  -- the person who produced it, six months later, which is the safety property this whole family of
  -- calculators was built around.
  formula text not null check (char_length(btrim(formula)) > 0),
  working text not null check (char_length(btrim(working)) > 0),

  -- The weight verdict AS IT STOOD AT THE MOMENT OF CALCULATION. Frozen deliberately: staleness is
  -- derived from the clock everywhere else in this engine, and a reader looking at a prescription
  -- from March needs to know what the screen said in March, not what it would say today.
  weight_state text not null
    check (weight_state in ('absent', 'implausible', 'stale', 'age_unjudged', 'current', 'unreadable')),

  -- WARNING: THE MOST IMPORTANT COLUMN IN THIS FILE, AND THE CONSTRAINT UNDER IT IS THE REASON.
  -- The keys of the safety checks that DID NOT RUN, frozen on the row. A prescription printed from
  -- this record must be able to say what nobody checked at the time, and the answer must not be
  -- reconstructed later from a constant that has since changed. cardinality >= 1 makes it impossible
  -- to write a row claiming everything was checked, which in this build is never true.
  safety_checks_not_run text[] not null,

  calculated_at timestamptz not null default now(),
  calculated_by uuid
);
--
-- cardinality, NOT array_length. array_length('{}', 1) returns NULL, a check constraint that evaluates
-- to NULL PASSES, and an empty array would sail through the one test written to stop it. Migration 246
-- learned this on practice_parameter_derived.
alter table practice_medication_dose_calculation
  drop constraint if exists practice_medication_dose_checks_named;
alter table practice_medication_dose_calculation
  add constraint practice_medication_dose_checks_named
  check (cardinality(safety_checks_not_run) >= 1);
--
-- A weight-based basis with no weight is not a calculation, it is a guess. The engine refuses first
-- and returns the reason. This refuses second, against every future caller.
alter table practice_medication_dose_calculation
  drop constraint if exists practice_medication_dose_needs_weight;
alter table practice_medication_dose_calculation
  add constraint practice_medication_dose_needs_weight
  check (basis not in ('mg_per_kg', 'mg_per_kg_per_day') or weight_kg is not null);
--
alter table practice_medication_dose_calculation
  drop constraint if exists practice_medication_dose_needs_bsa;
alter table practice_medication_dose_calculation
  add constraint practice_medication_dose_needs_bsa
  check (basis <> 'mg_per_m2' or (bsa_m2 is not null and weight_kg is not null and height_cm is not null));
--
create index if not exists idx_practice_medication_dose_med
  on practice_medication_dose_calculation(medication_id, calculated_at desc);
create index if not exists idx_practice_medication_dose_patient
  on practice_medication_dose_calculation(patient_id, calculated_at desc);

alter table practice_medication_dose_calculation enable row level security;
--
-- ---- 4. CAPABILITIES + BACKFILL -------------------------------------------------------------------
--
-- WARNING: THESE THREE ARE SEEDED HERE, WHICH IS WHY THEY MAY BE USED. A capability code is a string compared
-- against practice_role_capabilities. An invented one compiles perfectly, passes review, and returns
-- 403 for every user INCLUDING the practice owner -- so the feature is simply unreachable and nothing
-- errors anywhere. Six have shipped in this codebase that way, and 47 codes were live and correct when
-- this was written. Migration 246 held these three back deliberately: "seeding them early would put a
-- live permission on a table that does not exist." This is the migration they belong in.
--
-- WARNING: AND THE BACKFILL IS PART OF THE MIGRATION. Migration 239 seeded three codes and omitted this
-- insert..select, and all three were granted to nobody. Capability resolution reads
-- practice_role_assignment per membership, not the catalogue, so a new catalogue row alone never
-- reaches an already-provisioned workspace. Without the second statement below, every pilot practice
-- provisioned before today silently lacks the whole module and no error is raised anywhere.
--
-- THE SPLIT, and each line has a reason:
--   medication.view      practitioner AND assistant. A person booking a review needs to see what the
--                        patient is on. Reading a list is not prescribing.
--   medication.record    practitioner AND assistant. The assistant is who takes down what the patient
--                        walked in taking, and a patient-reported row is labelled unverified until a
--                        practitioner reviews it -- LCP s9. Refusing the assistant this would mean the
--                        commonest source of a medication list has nowhere to go.
--   medication.override  PRACTITIONER ONLY. It is the authority to prescribe weight-based when the
--                        weight is absent or stale, and CPL s24: high-risk decisions "cannot be
--                        altered by unauthorised users".
--
-- practice_owner gets none of the three. Migration 191 withholds clinical access from the business
-- role, 239 declined to undo it, 246 followed it, and a medication list is as clinical as this product
-- gets.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'medication.view'),
  ('practice_assistant', 'medication.view'),
  ('practitioner', 'medication.record'),
  ('practice_assistant', 'medication.record'),
  ('practitioner', 'medication.override')
on conflict (role_code, capability_code) do nothing;
--
insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );
--
-- ---- 5. RLS ---------------------------------------------------------------------------------------
--
-- Deny-by-default with no policies, as everywhere else in the practice tenancy: every reader is a
-- server engine holding the service role and a WorkspaceContext it has already checked. Re-asserted
-- here in one place so a table added to this file later without its own enable line is still covered.
alter table practice_medication enable row level security;
alter table practice_medication_event enable row level security;
alter table practice_medication_dose_calculation enable row level security;

notify pgrst, 'reload schema';
