import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { type EngineResult } from "@/lib/practice/encounters";
import { createFollowUp } from "@/lib/practice/follow-ups";
import { doseArithmetic, type DoseBasis } from "@/lib/practice/clinical-calculators";
import { plausibilityLine, dueLine } from "@/lib/practice/parameters-constants";
import {
  CAP_MED_VIEW, CAP_MED_RECORD, CAP_MED_OVERRIDE,
  MEDICATION_STATUS_CODES, MEDICATION_SOURCE_CODES, MEDICATION_EVENT_TYPE_CODES,
  DOSE_BASIS_CODES, DOSE_BASIS_LABEL, BASES_NEEDING_WEIGHT, BASES_NEEDING_HEIGHT,
  SOURCES_NEEDING_VERIFICATION,
  WEIGHT_STATES_NEEDING_DECISION, weightDecisionPrompt, BSA_NEEDS_MEASUREMENTS,
  WEIGHT_DECISION_NOT_APPLICABLE, ageLine, ADULT_NO_WEIGHT_REFUSED, type AgeVerdict,
  WEIGHT_PARAMETER_CODE, HEIGHT_PARAMETER_CODE,
  DEFERRED_SAFETY_CHECKS, DEFERRED_CHECK_KEYS, MEDICATION_REFUSALS,
  MEDICATION_LIST_BOUNDARY, LEGACY_TREATMENT_REASON, TIMELINE_BOUNDARY,
  doseSafetyNotice, allergyDisplayNotice, doseWithUnit,
  currentLine, verificationLine, weightLine, reviewLine, reconciliationLine,
  type CurrentVerdict, type VerificationVerdict, type WeightVerdict, type ReviewVerdict,
  type ReconciliationVerdict,
} from "@/lib/practice/medication-constants";

// CPR-MED-001 -- the medication record and the medication-safety engine, ON THE MIDDLE PATH.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS BUILD IS, AND THE SCOPE DECISION BEHIND IT (the user's, 2026-08-07)
//
// BUILT:    s2 the medication record  ·  s6 the longitudinal timeline  ·  s7 patient-specific
//           monitoring  ·  s9 the practitioner experience  ·  reconciliation (LCP s9's "patient-reported
//           doses are labelled unverified until reviewed")  ·  s3's mg/kg, mg/kg/day and mg/m2
//           arithmetic SHOWING ITS FULL WORKING.
//
// DEFERRED: s4's maximum single and daily dose checks, underdose and overdose detection, age
//           validation, duplicate therapy, allergy checking and drug interactions. Every one of them
//           needs a licensed drug knowledge base this product does not have and has not bought.
//
// ⚠ AND A CHECK THAT CANNOT RUN SAYS "NOT CHECKED". IT NEVER FALLS SILENT.
//
//   An unwarned screen reads as a cleared screen. This is migration 238's allergy lesson, written in its
//   own comment: "NO KNOWN ALLERGIES and NOBODY HAS ASKED are different answers." So all nine deferred
//   checks are in DEFERRED_SAFETY_CHECKS, they travel in every prescribing payload this file returns,
//   and the surface prints them by name. The dose calculator shows its arithmetic and MAKES NO SAFETY
//   CLAIM -- doseSafetyNotice() is beside every figure, in the payload, not left to a screen to remember.
//
// ---- THE ONE CHECK THAT DOES RUN --------------------------------------------------------------------
//
// LCP-001 s9: "CP warns when the current weight is stale, implausible or absent." That is computable
// from data this product genuinely holds, because CPR-LCP-001 shipped on migration 246 and a weight is
// now a timestamped measurement in a series. weightLine() is the verdict, and it REFUSES TO INVENT A
// STALENESS THRESHOLD: a weight is stale when this patient's own monitoring plan says another was due.
// With no plan, the age is shown and nothing is called current -- the `not_checked` shape in a third
// domain.
//
// ---- FIVE THINGS THAT ARE STRUCTURAL HERE AND ARE NOT NEGOTIABLE ------------------------------------
//
//  1. A FAILED READ IS NEVER A ZERO. Every list is a Panel with three states: not permitted, could not
//     be read, nothing there. An empty medication list means "nobody has been asked", which is a
//     different clinical situation from "we could not read the record", and the next action differs.
//
//  2. NOTHING IS EVER UPDATED IN practice_medication_event OR practice_medication_dose_calculation.
//     Neither table has an updated_at. LCP-001 s9: "A later weight update must not recalculate or
//     rewrite a historical prescription", and MED-001 s10: "Historical data never overwritten." A
//     correction is a new row. The harness source-scans for an UPDATE on either table and runs a control
//     that proves the scan can see one.
//
//  3. THE DOSE CALCULATION CITES ITS WEIGHT BY MEASUREMENT ID, NOT BY VALUE ALONE. LCP-001 s9: "the
//     medication record must preserve the exact value and timestamp used for each calculation." Both are
//     stored, plus the id of the row they came from, so a reader can open the measurement.
//
//  4. NOT ONE COLUMN IS ADDED TO practice_treatment. Its encounter_id is NOT NULL, so it structurally
//     cannot hold a medication a patient reported outside a consultation. practice_medication.
//     treatment_id points AT it instead, which is also what makes reconciliation possible: a legacy
//     treatment row with no medication row pointing at it is an uncarried decision, and that is a
//     length you can open.
//
//  5. NO WARNING TABLE AND NO DRUG RULE TABLE. See NO_WARNING_STORE. An empty rule table makes every
//     check return nothing to say, which a clinician reads as safe.
//
// ---- WHAT IS REUSED RATHER THAN REBUILT -------------------------------------------------------------
//
//   clinical-calculators.ts   doseArithmetic() does the multiplication and returns the working. Its
//                             header was REWRITTEN rather than deleted -- the four preconditions its old
//                             refusal named are all still unmet, and the paragraph says which half of
//                             the sentence survived.
//   parameters.ts / mig 246   the weight and height series, their plausibility limits, their canonical
//                             units and this patient's monitoring plan. Nothing here re-implements a
//                             measurement, and requireForSafety() is what MED s7's "automatically
//                             activate required parameters" calls.
//   practice_follow_up        MED s7's "follow-up scheduling" EMITS into the existing rail via
//                             createFollowUp with kind 'monitoring'. Nothing here is a second scheduler.
//   practice_patient_allergy  DISPLAYED beside prescribing, never matched. See DEFERRED_SAFETY_CHECKS.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE MIGRATION BELOW HAS SINCE BEEN APPLIED, AND TWO OF ITS CONSTRAINTS HAVE SINCE BEEN REPLACED.
// DO NOT PASTE THIS BLOCK INTO A DATABASE AS IT STANDS -- it would re-add the older constraints.
//
//   258-practice-medication.sql   applied. It is the DDL below, verbatim.
//   259-dose-weight-decision.sql  applied. ADDS practice_medication_dose_calculation.weight_decision and
//                                 requires it when a weight-based basis meets an absent or unreadable
//                                 weight.
//   265-dose-decision-reachable.sql  applied. REPLACES practice_medication_dose_needs_weight and
//                                 practice_medication_dose_needs_bsa, both quoted below in their 258
//                                 form with a warning beside them. 258 and 259 contradicted each other:
//                                 258 refused the very rows 259 required a decision for, so the column
//                                 was unreachable from the day it was added.
//
// WHEN IT WAS UNAPPLIED, this header said so and no code changed when it landed, because
// medicationStorePresence() ASKS THE DATABASE rather than assuming: every read reports `state: "absent"`
// with the migration named and every write returns STORE_ABSENT with a 503. That is knowledge.ts's
// pattern, which is patient-access.ts's ACCESS_PROFILE_STORE_ABSENT pattern before it, and it is still
// live -- which is the only reason this paragraph could be corrected without touching an engine.
//
// House rules obeyed below, each one paid for: ASCII only, plain idempotent statements, no plpgsql, no
// do-blocks, RLS on every table, `notify pgrst, 'reload schema'` last, and NO SEMICOLON ANYWHERE EXCEPT
// AT THE END OF A STATEMENT -- INCLUDING INSIDE A COMMENT. The runner splits the file on semicolons, and
// one inside a comment silently drops the statements around it while still reporting "Success. No rows
// returned". That happened on migration 238.
//
// ----------------------------------------------------------------------------------------------------
// -- ============================================================
// -- MIGRATION 258: THE MEDICATION RECORD AND ITS TIMELINE
// -- CPR-MED-001 (Medication Record and Medication Safety Engine), ON THE MIDDLE PATH
// --
// -- THREE TABLES, AND THE FOUR THE SURVEY PROPOSED THAT ARE DELIBERATELY NOT HERE.
// --
// -- practice_medication_rule and practice_medication_warning were proposed and are DECLINED. The rule
// -- table would be an empty drug knowledge base. An empty rule table makes every safety check return
// -- nothing to say, and a screen with no warning on it reads as a screen that found no problem -- the
// -- exact failure mode migration 238 named for allergies. The warning table would then store the rows
// -- that empty table never produced. Both arrive with a licensed knowledge base or not at all.
// --
// -- practice_medication_monitoring was proposed and is DECLINED as a table. MED s7 has two halves and
// -- both already have homes. "Automatically activate required parameters (e.g. weight)" is
// -- practice_patient_monitoring_plan, whose trigger_source column already accepts 'medication' and
// -- whose trigger_ref already holds the id of the thing that triggered it -- migration 246 built that
// -- column FOR this. "Review intervals" is one integer and one date about one medication, so it is two
// -- columns on the medication row rather than a table with a row per medication holding two facts.
// --
// -- practice_medication_favourite was proposed and is DECLINED. A favourite is derivable from what this
// -- practitioner has actually recorded, and a curated list is a second thing to maintain that goes
// -- stale in silence. See FAVOURITES_ARE_DERIVED.
// --
// -- WHAT WAS ALREADY THERE, AND IS NOT REBUILT OR WIDENED:
// --
// --   practice_treatment (194)   NOT ONE COLUMN IS ADDED. Its encounter_id is NOT NULL, so it cannot
// --                              hold a medication a patient reported outside a consultation, and
// --                              widening it would produce a second place to write the same sentence,
// --                              which CPR-ENC-002 s9's no-duplicate-data-entry forbids. The link runs
// --                              the other way, from practice_medication.treatment_id.
// --   practice_parameter_*(246)  the weight and height series, their units, plausibility limits and
// --                              this patient's monitoring plan. A dose calculation cites a measurement
// --                              row by id.
// --   practice_follow_up (196)   .kind already accepts 'monitoring'. Review reminders EMIT into it.
// --   practice_patient_allergy   (238) free-text substance, by deliberate decision. Displayed, never
// --                              matched.
// -- ============================================================
// --
// -- ---- 1. THE MEDICATION RECORD -- MED s2 -----------------------------------------------------------
// --
// -- WARNING: encounter_id IS NULLABLE AND THAT SINGLE COLUMN IS THE WHOLE REASON THIS TABLE EXISTS.
// -- Every clinical row in this product until now hangs off an encounter, a patient identity or a
// -- document. A medication a patient walked in already taking has no encounter behind it, and a course
// -- started in March outlives the consultation that started it. This is the first longitudinal clinical
// -- STATE store in Practice, and its boundary is restated in section 3 below.
// --
// -- WARNING: treatment_id POINTS AT THE DECISION THAT STARTED IT, WHEN THERE WAS ONE. It is how a legacy
// -- treatment row is carried across without being copied twice, and a legacy row that nothing points at
// -- is precisely the reconciliation worklist.
// create table if not exists practice_medication (
//   id uuid primary key default gen_random_uuid(),
//   workspace_id uuid not null references practice_workspace(id) on delete cascade,
//   patient_id uuid not null references practice_patient(id) on delete cascade,
//   encounter_id uuid references practice_encounter(id),
//   treatment_id uuid references practice_treatment(id),
//
//   -- MED s2 "Generic and brand name". FREE TEXT, and the comment says so where somebody would
//   -- otherwise assume otherwise: there is no drug vocabulary in this product. Every safety check that
//   -- needs a coded identity is deferred FOR THIS REASON and is rendered as "not checked" rather than
//   -- omitted.
//   generic_name text not null check (char_length(btrim(generic_name)) between 1 and 200),
//   brand_name text check (brand_name is null or char_length(btrim(brand_name)) between 1 and 200),
//   formulation text,
//   -- "250 mg/5 mL". Held as written, never parsed. A parser that got this wrong would be wrong inside
//   -- a dose.
//   strength_text text,
//
//   -- MED s2 "Dose, units, route, frequency, duration". dose_text is what a person reads and is
//   -- REQUIRED. The numeric pair beside it is optional and exists so a dose calculation can be attached
//   -- to a row -- a dose nobody could parse still records perfectly as text, which is better than a row
//   -- that refuses to save.
//   dose_text text not null check (char_length(btrim(dose_text)) between 1 and 200),
//   dose_value numeric,
//   dose_unit text,
//   route text,
//   frequency text,
//   -- How many administrations in twenty-four hours, WHEN SOMEBODY STATED IT. Null is "not stated" and
//   -- the dose engine withholds the per-dose figure of a mg/kg/day regimen rather than dividing by a
//   -- number it guessed.
//   frequency_per_day numeric check (frequency_per_day is null or frequency_per_day > 0),
//   duration_text text,
//   indication text,
//
//   -- MED s2 "Start/stop dates". DATES, NOT TIMESTAMPS. "Started on 1 January" is a day, and rendering
//   -- a timezone-shifted instant for it is how a course appears to start the evening before.
//   -- WARNING: THESE ARE WHAT MAKES "CURRENT" DERIVABLE, and only for rows in THIS table. The refusal in
//   -- patient-workspace-constants.ts stays true for practice_treatment, whose duration is free text
//   -- with no computable end, and the two lists are kept apart on screen for that reason.
//   started_on date,
//   stopped_on date,
//
//   -- MED s2 "Prescriber/source". Free text: the prescriber may be at another hospital entirely, and a
//   -- foreign key to a membership would refuse to record exactly the case worth recording.
//   prescriber text,
//   recorded_source text not null default 'practitioner'
//     check (recorded_source in ('practitioner', 'patient_reported', 'imported')),
//
//   -- LCP-001 s9: "Patient-reported medication doses are labelled unverified until reviewed by a
//   -- practitioner." The verification is a fact with a person and a time on it, not a boolean.
//   verified_at timestamptz,
//   verified_by uuid,
//
//   -- MED s2's four, verbatim: "Active, completed, paused and discontinued status."
//   -- WARNING: NOT practice_treatment's FOUR. That table's planned/in_progress/completed/cancelled is the
//   -- lifecycle of a decision inside one consultation. These are the lifecycle of a course that
//   -- outlives it, and folding them together would force one of them to lie.
//   status text not null default 'active'
//     check (status in ('active', 'completed', 'paused', 'discontinued')),
//   discontinued_reason text,
//
//   -- MED s7 "Review intervals". Two columns rather than a table: it is one interval and one date about
//   -- one medication. Whether a review is OVERDUE is not stored -- it depends on the clock, and a
//   -- boolean written into a row is wrong from the moment the clock moves past it.
//   review_interval_days integer check (review_interval_days is null or review_interval_days between 1 and 3650),
//   next_review_on date,
//   -- MED s7 "Follow-up scheduling" EMITS into the existing rail. No second scheduler.
//   review_follow_up_id uuid references practice_follow_up(id) on delete set null,
//
//   created_at timestamptz not null default now(),
//   created_by uuid,
//   updated_at timestamptz not null default now(),
//   updated_by uuid,
//
//   -- A course that stopped before it started is a transcription error, and the arithmetic that reads
//   -- these two would happily produce a plausible-looking duration from them.
//   constraint practice_medication_stop_after_start
//     check (stopped_on is null or started_on is null or stopped_on >= started_on),
//
//   -- DISCONTINUING WITHOUT SAYING WHY leaves the next prescriber unable to tell "the course finished"
//   -- from "it made them ill", which is the only thing they need to know. Same shape migration 238 used
//   -- for outcome = 'other', and the same shape as the override rule below.
//   constraint practice_medication_discontinued_reason
//     check (status <> 'discontinued'
//            or (discontinued_reason is not null and char_length(btrim(discontinued_reason)) > 0)),
//
//   -- A verification with no person behind it cannot be reviewed, and "verified by somebody at some
//   -- point" is not what LCP s9 asks for. Both or neither.
//   constraint practice_medication_verified_pair
//     check ((verified_at is null and verified_by is null)
//            or (verified_at is not null and verified_by is not null))
// );
// --
// -- The patient's own list, newest first. Partial on `active` for the "taking now" read, which is the
// -- one a prescriber makes on every visit.
// create index if not exists idx_practice_medication_patient
//   on practice_medication(patient_id, status, started_on desc);
// create index if not exists idx_practice_medication_active
//   on practice_medication(workspace_id, patient_id) where status = 'active';
// -- The reconciliation worklist: unreviewed rows somebody else supplied. Partial, because the practice
// -- opens this list to work through it and the practitioner-recorded rows are not on it.
// create index if not exists idx_practice_medication_unverified
//   on practice_medication(workspace_id, recorded_source)
//   where verified_at is null and recorded_source <> 'practitioner';
// -- MED s7's review worklist.
// create index if not exists idx_practice_medication_review_due
//   on practice_medication(workspace_id, next_review_on) where status in ('active', 'paused');
// -- The other half of reconciliation: which legacy treatment decisions have been carried across.
// create index if not exists idx_practice_medication_treatment
//   on practice_medication(treatment_id) where treatment_id is not null;
// -- MED s9 "Search" and "Favourite medications", the second of which is DERIVED from this index rather
// -- than from a curated list -- see FAVOURITES_ARE_DERIVED.
// create index if not exists idx_practice_medication_name
//   on practice_medication(workspace_id, lower(generic_name));
//
// alter table practice_medication enable row level security;
// --
// -- ---- 2. THE TIMELINE -- MED s6 --------------------------------------------------------------------
// --
// -- s6 verbatim: "Medication history / Dose changes / Reasons for changes / Adverse drug reactions /
// -- Adherence notes / Effectiveness observations."
// --
// -- WARNING: APPEND-ONLY, AND THE SHAPE IS THE ENFORCEMENT. There is no updated_at and there is no update path
// -- in the engine. MED s10: "Historical data never overwritten." A correction is a new row. This is
// -- migration 246's rule for practice_parameter_measurement in a second domain, and the medication
// -- harness proves it the same way -- a source scan for an UPDATE on this table, with a control that
// -- proves the scan can see one.
// --
// -- WARNING: safety_override IS THE ONE EVENT TYPE THAT IS NOT s6's, AND IT IS WHERE MED s5 LANDS. s5 asks for
// -- four warning severities with "practitioner override with justification" and a "full audit trail".
// -- Nine of the ten checks those severities would grade are deferred for want of a drug knowledge
// -- base. The ONE that runs is LCP s9's weight validation, and prescribing weight-based anyway when the
// -- weight is absent or stale is a clinical act that must leave a trace. It leaves it here.
// create table if not exists practice_medication_event (
//   id uuid primary key default gen_random_uuid(),
//   -- DENORMALISED FROM THE PARENT ON PURPOSE, as practice_guidance_section does it: every read scopes
//   -- itself in the statement rather than after a prior read. Written on insert and never afterwards.
//   workspace_id uuid not null references practice_workspace(id) on delete cascade,
//   medication_id uuid not null references practice_medication(id) on delete cascade,
//   patient_id uuid not null references practice_patient(id) on delete cascade,
//   encounter_id uuid references practice_encounter(id),
//
//   event_type text not null check (event_type in (
//     'started', 'dose_changed', 'paused', 'resumed', 'discontinued', 'completed',
//     'adverse_reaction', 'adherence_note', 'effectiveness_note', 'verified', 'safety_override')),
//
//   -- What changed, both sides. Not a diff computed at read time: the row records what the values WERE,
//   -- so a later correction to the parent cannot rewrite what this entry says happened.
//   previous jsonb not null default '{}'::jsonb,
//   next jsonb not null default '{}'::jsonb,
//
//   -- s6 "Reasons for changes". Required for three event types by the constraint below.
//   reason text,
//   -- s6's adverse reactions, adherence and effectiveness notes, in the practitioner's own words.
//   narrative text check (narrative is null or char_length(narrative) <= 4000),
//
//   -- A DATE, because "she stopped it last Tuesday" is a day somebody is recalling, and stamping it
//   -- with the instant the form was submitted would put it on the timeline in the wrong place.
//   occurred_on date not null default current_date,
//   created_at timestamptz not null default now(),
//   created_by uuid,
//
//   -- WARNING: THE THREE ACTS THAT ARE MEANINGLESS WITHOUT WORDS. A dose change with no reason cannot be
//   -- reviewed, a discontinuation with no reason cannot be told from a completed course, and an
//   -- override with no justification is the get-past-the-alert answer -- the reason IS the act. A
//   -- DATABASE CONSTRAINT RATHER THAN A CODE CHECK, the same shape migration 238 used for
//   -- outcome = 'other' and migration 246 for an overridden alert, because a validation that lives only
//   -- in TypeScript is one the next caller does not have.
//   constraint practice_medication_event_reason
//     check (event_type not in ('dose_changed', 'discontinued', 'safety_override')
//            or (reason is not null and char_length(btrim(reason)) > 0))
// );
// --
// create index if not exists idx_practice_medication_event_timeline
//   on practice_medication_event(medication_id, occurred_on desc, created_at desc);
// create index if not exists idx_practice_medication_event_patient
//   on practice_medication_event(patient_id, occurred_on desc);
// -- The safety-override register: MED s5's "full audit trail", as a list somebody can open.
// create index if not exists idx_practice_medication_event_override
//   on practice_medication_event(workspace_id, created_at desc) where event_type = 'safety_override';
//
// alter table practice_medication_event enable row level security;
// --
// -- ---- 3. THE DOSE CALCULATION -- MED s3, LCP s9 ----------------------------------------------------
// --
// -- WARNING: IMMUTABLE. NO updated_at, NO update path, EVER.
// --
// -- LCP-001 s9, both sentences: "the medication record must preserve the exact value and timestamp used
// -- for each calculation" and "A LATER WEIGHT UPDATE MUST NOT RECALCULATE OR REWRITE A HISTORICAL
// -- PRESCRIPTION." A child weighed again next month must not silently change what was prescribed last
// -- month, and the only way to guarantee that against every future caller is a table nothing can update.
// --
// -- WARNING: THE WEIGHT IS STORED THREE WAYS AND ALL THREE ARE NEEDED. The VALUE is what the arithmetic used.
// -- The TIMESTAMP is how a reader judges whether it was reasonable. The MEASUREMENT ID is how they open
// -- the row and check. Storing only the id would break the first rule the moment that row was amended.
// create table if not exists practice_medication_dose_calculation (
//   id uuid primary key default gen_random_uuid(),
//   workspace_id uuid not null references practice_workspace(id) on delete cascade,
//   patient_id uuid not null references practice_patient(id) on delete cascade,
//   -- NULLABLE, because a prescriber calculates BEFORE deciding. A calculation with no medication yet is
//   -- a working-out somebody did, and discarding it would lose the one artefact that shows what they
//   -- were shown at the moment they decided.
//   medication_id uuid references practice_medication(id) on delete set null,
//   encounter_id uuid references practice_encounter(id),
//
//   -- MED s3's four, verbatim.
//   basis text not null check (basis in ('mg_per_kg', 'mg_per_kg_per_day', 'mg_per_m2', 'fixed')),
//   -- The rate the prescriber typed: mg/kg, mg/kg/day or mg/m2. Null only for a fixed regimen.
//   rate_value numeric,
//   dose_unit text not null default 'mg',
//   doses_per_day numeric check (doses_per_day is null or doses_per_day > 0),
//
//   -- LCP s9's "exact value and timestamp", plus the row they came from.
//   weight_kg numeric,
//   weight_measurement_id uuid references practice_parameter_measurement(id),
//   weight_effective_at timestamptz,
//   height_cm numeric,
//   height_measurement_id uuid references practice_parameter_measurement(id),
//   bsa_m2 numeric,
//
//   -- The result. per_dose is null for a mg/kg/day regimen with no stated frequency -- dividing a daily
//   -- total by a number nobody stated would produce a per-dose figure this product invented.
//   per_dose numeric,
//   daily_total numeric,
//
//   -- MED s3's sixth bullet: "Transparent calculation display." NOT a rendering preference -- a NOT NULL
//   -- column with a non-empty check, because a dose figure with no working beside it is unverifiable by
//   -- the person who produced it, six months later, which is the safety property this whole family of
//   -- calculators was built around.
//   formula text not null check (char_length(btrim(formula)) > 0),
//   working text not null check (char_length(btrim(working)) > 0),
//
//   -- The weight verdict AS IT STOOD AT THE MOMENT OF CALCULATION. Frozen deliberately: staleness is
//   -- derived from the clock everywhere else in this engine, and a reader looking at a prescription
//   -- from March needs to know what the screen said in March, not what it would say today.
//   weight_state text not null
//     check (weight_state in ('absent', 'implausible', 'stale', 'age_unjudged', 'current', 'unreadable')),
//
//   -- WARNING: THE MOST IMPORTANT COLUMN IN THIS FILE, AND THE CONSTRAINT UNDER IT IS THE REASON.
//   -- The keys of the safety checks that DID NOT RUN, frozen on the row. A prescription printed from
//   -- this record must be able to say what nobody checked at the time, and the answer must not be
//   -- reconstructed later from a constant that has since changed. cardinality >= 1 makes it impossible
//   -- to write a row claiming everything was checked, which in this build is never true.
//   safety_checks_not_run text[] not null,
//
//   calculated_at timestamptz not null default now(),
//   calculated_by uuid
// );
// --
// -- cardinality, NOT array_length. array_length('{}', 1) returns NULL, a check constraint that evaluates
// -- to NULL PASSES, and an empty array would sail through the one test written to stop it. Migration 246
// -- learned this on practice_parameter_derived.
// alter table practice_medication_dose_calculation
//   drop constraint if exists practice_medication_dose_checks_named;
// alter table practice_medication_dose_calculation
//   add constraint practice_medication_dose_checks_named
//   check (cardinality(safety_checks_not_run) >= 1);
// --
// -- A weight-based basis with no weight is not a calculation, it is a guess. The engine refuses first
// -- and returns the reason. This refuses second, against every future caller.
// --
// -- WARNING: BOTH CONSTRAINTS BELOW WERE REPLACED BY MIGRATION 265 AND ARE KEPT HERE AS WRITTEN RATHER
// -- THAN EDITED IN PLACE, because this block is the record of what 258 applied. The live rules are 265's
// -- and each carries a third disjunct. In one sentence each:
// --
// --   needs_weight  now also permits a row with NO weight_kg when weight_decision is present and
// --                 non-blank by btrim. That is the user's ruling of 2026-08-08. The engine still
// --                 computes NOTHING in that case -- there is nothing to multiply -- so the row carries
// --                 the decision, the reasoning and no figure.
// --   needs_bsa     now also permits bsa_m2 with a decision and no weight_kg or height_cm, and bsa_m2
// --                 ITSELF REMAINS REQUIRED. A decision stands in for a missing MEASUREMENT, never for
// --                 the arithmetic. calculateDose refuses mg_per_m2 with no weight BEFORE asking for a
// --                 decision, so nobody is asked to write words that would change nothing.
// --
// alter table practice_medication_dose_calculation
//   drop constraint if exists practice_medication_dose_needs_weight;
// alter table practice_medication_dose_calculation
//   add constraint practice_medication_dose_needs_weight
//   check (basis not in ('mg_per_kg', 'mg_per_kg_per_day') or weight_kg is not null);
// --
// alter table practice_medication_dose_calculation
//   drop constraint if exists practice_medication_dose_needs_bsa;
// alter table practice_medication_dose_calculation
//   add constraint practice_medication_dose_needs_bsa
//   check (basis <> 'mg_per_m2' or (bsa_m2 is not null and weight_kg is not null and height_cm is not null));
// --
// create index if not exists idx_practice_medication_dose_med
//   on practice_medication_dose_calculation(medication_id, calculated_at desc);
// create index if not exists idx_practice_medication_dose_patient
//   on practice_medication_dose_calculation(patient_id, calculated_at desc);
//
// alter table practice_medication_dose_calculation enable row level security;
// --
// -- ---- 4. CAPABILITIES + BACKFILL -------------------------------------------------------------------
// --
// -- WARNING: THESE THREE ARE SEEDED HERE, WHICH IS WHY THEY MAY BE USED. A capability code is a string compared
// -- against practice_role_capabilities. An invented one compiles perfectly, passes review, and returns
// -- 403 for every user INCLUDING the practice owner -- so the feature is simply unreachable and nothing
// -- errors anywhere. Six have shipped in this codebase that way, and 47 codes were live and correct when
// -- this was written. Migration 246 held these three back deliberately: "seeding them early would put a
// -- live permission on a table that does not exist." This is the migration they belong in.
// --
// -- WARNING: AND THE BACKFILL IS PART OF THE MIGRATION. Migration 239 seeded three codes and omitted this
// -- insert..select, and all three were granted to nobody. Capability resolution reads
// -- practice_role_assignment per membership, not the catalogue, so a new catalogue row alone never
// -- reaches an already-provisioned workspace. Without the second statement below, every pilot practice
// -- provisioned before today silently lacks the whole module and no error is raised anywhere.
// --
// -- THE SPLIT, and each line has a reason:
// --   medication.view      practitioner AND assistant. A person booking a review needs to see what the
// --                        patient is on. Reading a list is not prescribing.
// --   medication.record    practitioner AND assistant. The assistant is who takes down what the patient
// --                        walked in taking, and a patient-reported row is labelled unverified until a
// --                        practitioner reviews it -- LCP s9. Refusing the assistant this would mean the
// --                        commonest source of a medication list has nowhere to go.
// --   medication.override  PRACTITIONER ONLY. It is the authority to prescribe weight-based when the
// --                        weight is absent or stale, and CPL s24: high-risk decisions "cannot be
// --                        altered by unauthorised users".
// --
// -- practice_owner gets none of the three. Migration 191 withholds clinical access from the business
// -- role, 239 declined to undo it, 246 followed it, and a medication list is as clinical as this product
// -- gets.
// insert into practice_role_capabilities (role_code, capability_code) values
//   ('practitioner', 'medication.view'),
//   ('practice_assistant', 'medication.view'),
//   ('practitioner', 'medication.record'),
//   ('practice_assistant', 'medication.record'),
//   ('practitioner', 'medication.override')
// on conflict (role_code, capability_code) do nothing;
// --
// insert into practice_role_assignment (membership_id, capability_code, source)
// select m.id, c.capability_code, 'role_default'
// from practice_membership m
// join practice_role_capabilities c on c.role_code = m.role_code
// where m.status = 'active'
//   and not exists (
//     select 1 from practice_role_assignment a
//     where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
//   );
// --
// -- ---- 5. RLS ---------------------------------------------------------------------------------------
// --
// -- Deny-by-default with no policies, as everywhere else in the practice tenancy: every reader is a
// -- server engine holding the service role and a WorkspaceContext it has already checked. Re-asserted
// -- here in one place so a table added to this file later without its own enable line is still covered.
// alter table practice_medication enable row level security;
// alter table practice_medication_event enable row level security;
// alter table practice_medication_dose_calculation enable row level security;
//
// notify pgrst, 'reload schema';
// ----------------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MEDICATION_TABLE = "practice_medication";
export const MEDICATION_EVENT_TABLE = "practice_medication_event";
export const MEDICATION_DOSE_TABLE = "practice_medication_dose_calculation";

/** Named in the absent-store message so nobody has to guess which migration is missing. */
export const MEDICATION_MIGRATION =
  "258-practice-medication (practice_medication + practice_medication_event + practice_medication_dose_calculation)";
export const MEDICATION_MODULE_NAME = "The medication record";

// ── THE THREE-STATE PANEL, the shape longitudinal.ts established and parameters.ts follows ────────────

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };

const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });

const trim = (v: unknown): string => String(v ?? "").trim();
const nowIso = () => new Date().toISOString();
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** PostgREST's schema-cache miss and Postgres's undefined-table, which mean the same thing here. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);
const isMissingTable = (error: any) =>
  !!error && (MISSING_TABLE_CODES.has(String(error.code))
    || /could not find the table/i.test(String(error.message ?? "")));

const storeAbsent = <T>(): EngineResult<T> => ({
  ok: false, status: 503, code: "STORE_ABSENT",
  message: `${MEDICATION_MODULE_NAME} has no store in this deployment yet. Migration "${MEDICATION_MIGRATION}" has not been applied, so there is nowhere for a medication to go.`,
});

/** The sentence a SURFACE prints when the store is absent. Never "no medications recorded". */
export const STORE_ABSENT_NOTICE =
  `The medication record has no store in this deployment. Migration "${MEDICATION_MIGRATION}" has not been `
  + `applied, so nothing can be recorded and nothing can be read. This is NOT an empty medication list — `
  + `do not conclude that these patients are taking nothing.`;

// ── IS THE STORE THERE? ──────────────────────────────────────────────────────────────────────────────

export type MedicationStorePresence = {
  present: boolean;
  /** ⚠ Three outcomes, not two. A read that FAILED is not a table that is missing. */
  state: "present" | "absent" | "failed";
  tables: { table: string; present: boolean }[];
  detail: string | null;
  /** Named so a screen does not have to hard-code it. */
  migration: string;
};

/**
 * Ask the database, one `select ... limit 1` per table.
 *
 * ⚠ NOT head+count. A missing table and an empty table BOTH return `count === null`, and reading that as
 * "missing" is the trap that produced four wrong answers in the survey this build follows. The error
 * CODE is the only thing that distinguishes them.
 */
export async function medicationStorePresence(admin: any): Promise<MedicationStorePresence> {
  const results: { table: string; present: boolean }[] = [];
  let failure: string | null = null;

  for (const table of [MEDICATION_TABLE, MEDICATION_EVENT_TABLE, MEDICATION_DOSE_TABLE]) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (!error) { results.push({ table, present: true }); continue; }
    if (isMissingTable(error)) { results.push({ table, present: false }); continue; }
    // Something else went wrong. That is not "absent" and it must not be reported as one.
    results.push({ table, present: false });
    failure = failure ?? `${table}: ${error.message}`;
  }

  if (failure) return { present: false, state: "failed", tables: results, detail: failure, migration: MEDICATION_MIGRATION };
  const present = results.every(r => r.present);
  return {
    present, state: present ? "present" : "absent", tables: results,
    detail: present ? null : STORE_ABSENT_NOTICE, migration: MEDICATION_MIGRATION,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DOSING WEIGHT -- read out of CPR-LCP-001, never out of a column on the patient
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type DosingMeasurement = {
  value: number | null;
  unit: string | null;
  measurementId: string | null;
  effectiveAt: string | null;
  definitionId: string | null;
  plausibility: "no_limits" | "plausible" | "implausible" | null;
  unavailable: boolean;
};

/**
 * The latest ACTIVE measurement of one core parameter for this patient, with its plausibility verdict.
 *
 * ⚠ THE CODE IS MATCHED, NOT THE DISPLAY NAME. A display name is edited; a code is what a formula refers
 * to. If a practice has never activated `weight`, this returns nothing and the dose engine says the
 * weight is absent -- it does not go hunting for a parameter that resembles a weight, because the one it
 * found might be a birth weight, a target weight or a dry weight.
 *
 * ⚠ AND IT READS canonical_value, NOT value_numeric. Migration 246 converts on write from a stored
 * multiplier table. A pound reaching a mg/kg multiplication would be wrong by a factor of 2.2 and would
 * look entirely plausible.
 */
export async function dosingMeasurement(
  admin: any, ctx: WorkspaceContext, patientId: string, code: string,
): Promise<DosingMeasurement> {
  const blank: DosingMeasurement = {
    value: null, unit: null, measurementId: null, effectiveAt: null,
    definitionId: null, plausibility: null, unavailable: false,
  };

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, code, canonical_unit, min_plausible, max_plausible, workspace_id")
    .eq("code", code).or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
    .order("workspace_id", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (dErr) return { ...blank, unavailable: true };
  if (!def) return blank;

  const { data: rows, error: mErr } = await admin.from("practice_parameter_measurement")
    .select("id, canonical_value, value_numeric, canonical_unit, unit, effective_at, status")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("definition_id", def.id)
    .eq("status", "active")
    .order("effective_at", { ascending: false }).limit(1);
  if (mErr) return { ...blank, definitionId: def.id, unavailable: true };

  const row = (rows ?? [])[0] as any;
  if (!row) return { ...blank, definitionId: def.id };

  const value = (row.canonical_value ?? row.value_numeric) as number | null;
  const unit = (row.canonical_unit ?? row.unit ?? def.canonical_unit ?? null) as string | null;
  return {
    value, unit, measurementId: row.id, effectiveAt: row.effective_at, definitionId: def.id,
    plausibility: plausibilityLine({
      value, unit, min: def.min_plausible ?? null, max: def.max_plausible ?? null,
    }).state,
    unavailable: false,
  };
}

/**
 * LCP s9's weight verdict for one patient: the value, its age, and whether anything says it is stale.
 *
 * ⚠ THE STALENESS COMES FROM THE PATIENT'S OWN MONITORING PLAN AND FROM NOWHERE ELSE. See weightLine's
 * header: a hard-coded number here would be a clinical judgement about every patient at once.
 */
export async function dosingWeight(
  admin: any, ctx: WorkspaceContext, patientId: string, today = todayIso(),
): Promise<{ verdict: WeightVerdict; measurement: DosingMeasurement }> {
  const measurement = await dosingMeasurement(admin, ctx, patientId, WEIGHT_PARAMETER_CODE);
  if (measurement.unavailable)
    return {
      measurement,
      verdict: weightLine({
        valueKg: null, effectiveAt: null, plausibility: null, due: null, daysOverdue: null,
        today, unavailable: true,
      }),
    };

  let due: Parameters<typeof weightLine>[0]["due"] = null;
  let daysOverdue: number | null = null;
  if (measurement.definitionId) {
    const { data: plan, error } = await admin.from("practice_patient_monitoring_plan")
      .select("schedule, next_due_on")
      .eq("patient_id", patientId).eq("definition_id", measurement.definitionId).maybeSingle();
    // ⚠ A PLAN THAT COULD NOT BE READ IS NOT A PLAN THAT SAYS NOTHING IS DUE. dueLine's `unreadable`
    // state carries through and weightLine turns it into age_unjudged rather than into a tick.
    const verdict = dueLine({
      schedule: plan?.schedule ?? null, nextDueOn: plan?.next_due_on ?? null,
      today, unavailable: !!error,
    });
    due = verdict.state;
    daysOverdue = verdict.daysOverdue;
  }

  return {
    measurement,
    verdict: weightLine({
      valueKg: measurement.value, effectiveAt: measurement.effectiveAt,
      plausibility: measurement.plausibility, due, daysOverdue, today, unavailable: false,
    }),
  };
}

/**
 * Is this patient a child, for the user's narrowing of 2026-08-08 ("only a child <18 years")?
 *
 * ⚠ DERIVED HERE, AT THE MOMENT OF THE CALCULATION, AND NEVER STORED. `today` is a parameter so the
 * harness can stand on either side of a birthday without waiting a year for one.
 *
 * ⚠ AND A FAILED READ RETURNS `unknown`, WHICH OFFERS THE DECISION PATH. Three states, as everywhere
 * else in this engine: a child, an adult, and a patient nothing here can age. Reading the third as an
 * adult would refuse the prescriber outright on the strength of a query that did not run, and they would
 * do the sum on paper -- which is the harm the whole feature exists to prevent.
 *
 * ⚠ age_estimate_years IS READ AS WELL AS birth_date, and that is one column beyond the ruling's words.
 * Practices register patients who do not know a date, and the estimate is the age this record holds for
 * them. Using it can only ever turn an `unknown` into a `child` or an `adult` -- it cannot turn a child
 * into an adult, because a birth date, when there is one, always wins.
 */
export async function dosingAge(
  admin: any, ctx: WorkspaceContext, patientId: string, today = todayIso(),
): Promise<AgeVerdict> {
  const { data, error } = await admin.from("practice_patient")
    .select("id, birth_date, age_estimate_years")
    .eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  // ⚠ A PATIENT WHO IS NOT THERE IS NOT AN ADULT EITHER. Both branches land on `unknown`.
  if (error || !data)
    return ageLine({ birthDate: null, ageEstimateYears: null, today, unavailable: true });
  return ageLine({
    birthDate: (data.birth_date as string | null) ?? null,
    ageEstimateYears: (data.age_estimate_years as number | null) ?? null,
    today, unavailable: false,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MED s2 + s6 + RECONCILIATION -- ONE PATIENT'S RECORD
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MedicationRow = {
  id: string;
  genericName: string;
  brandName: string | null;
  formulation: string | null;
  strengthText: string | null;
  doseText: string;
  route: string | null;
  frequency: string | null;
  frequencyPerDay: number | null;
  durationText: string | null;
  indication: string | null;
  startedOn: string | null;
  stoppedOn: string | null;
  prescriber: string | null;
  source: string;
  status: string;
  discontinuedReason: string | null;
  encounterId: string | null;
  treatmentId: string | null;
  reviewIntervalDays: number | null;
  /** Derived, never stored. Doctrine 8. */
  current: CurrentVerdict;
  verification: VerificationVerdict;
  review: ReviewVerdict;
  recordedAt: string;
};

/**
 * A legacy `practice_treatment` medication decision that no medication row points at.
 *
 * ⚠ IT IS NOT SHOWN AS A MEDICATION AND IT IS NOT COUNTED AS ONE. It is a decision taken inside a
 * consultation, with a free-text duration and no computable end -- REFUSES.current_medications is still
 * exactly right about it. It appears under its own heading, with the offer to carry it across, which is
 * the one act that can make it current.
 */
export type LegacyTreatment = {
  id: string;
  label: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  status: string;
  encounterId: string;
  decidedAt: string | null;
};

export type PatientMedications = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  /** ⚠ Absent is its own state and is NOT an empty list. */
  storeState: "present" | "absent" | "failed";
  storeNotice: string | null;
  /** In use now, as recorded HERE. See MEDICATION_LIST_BOUNDARY for what that excludes. */
  active: MedicationRow[];
  /** Completed, paused and discontinued, newest first. MED s6's "Medication history". */
  past: MedicationRow[];
  /** Not carried across from an earlier consultation. */
  legacy: Panel<LegacyTreatment>;
  reconciliation: ReconciliationVerdict;
  /** LCP s9's weight verdict, on the patient rather than on one prescription. */
  weight: WeightVerdict;
  /**
   * ⚠ THE SAME VERDICT THE DOSE GATE USES, SO THE SCREEN CANNOT OFFER A DOOR THE ENGINE WILL REFUSE.
   * The user's narrowing of 2026-08-08: the recorded-decision path is for children only.
   */
  age: AgeVerdict;
  /** Displayed, never matched. See DEFERRED_SAFETY_CHECKS.allergy. */
  allergies: Panel<{ id: string; substance: string; severity: string | null; reaction: string | null }>;
  allergyNotice: string;
  boundary: string;
  legacyReason: string;
  /** ⚠ TRAVELS WITH EVERY PAYLOAD. A screen must print these, not omit them. */
  notChecked: typeof DEFERRED_SAFETY_CHECKS;
  refusals: typeof MEDICATION_REFUSALS;
};

const readRow = (r: any, today: string): MedicationRow => ({
  id: r.id,
  genericName: r.generic_name,
  brandName: r.brand_name ?? null,
  formulation: r.formulation ?? null,
  strengthText: r.strength_text ?? null,
  doseText: r.dose_text,
  route: r.route ?? null,
  frequency: r.frequency ?? null,
  frequencyPerDay: r.frequency_per_day ?? null,
  durationText: r.duration_text ?? null,
  indication: r.indication ?? null,
  startedOn: r.started_on ?? null,
  stoppedOn: r.stopped_on ?? null,
  prescriber: r.prescriber ?? null,
  source: r.recorded_source,
  status: r.status,
  discontinuedReason: r.discontinued_reason ?? null,
  encounterId: r.encounter_id ?? null,
  treatmentId: r.treatment_id ?? null,
  reviewIntervalDays: r.review_interval_days ?? null,
  current: currentLine({
    status: r.status, startedOn: r.started_on ?? null, stoppedOn: r.stopped_on ?? null,
    today, unavailable: false,
  }),
  verification: verificationLine({
    source: r.recorded_source, verifiedAt: r.verified_at ?? null, unavailable: false,
  }),
  review: reviewLine({
    nextReviewOn: r.next_review_on ?? null, reviewIntervalDays: r.review_interval_days ?? null,
    status: r.status, today, unavailable: false,
  }),
  recordedAt: r.created_at,
});

export async function patientMedications(
  admin: any, ctx: WorkspaceContext, patientId: string, today = todayIso(),
): Promise<PatientMedications> {
  const base = {
    active: [] as MedicationRow[], past: [] as MedicationRow[],
    legacy: loaded<LegacyTreatment>([]),
    weight: weightLine({ valueKg: null, effectiveAt: null, plausibility: null, due: null, daysOverdue: null, today, unavailable: true }),
    // ⚠ THE BASE PAYLOAD'S AGE IS `unknown`, NOT `adult`. A caller who never got past a permission check
    // must not be handed a verdict that reads as a decided fact about the patient.
    age: ageLine({ birthDate: null, ageEstimateYears: null, today, unavailable: true }),
    allergies: loaded<{ id: string; substance: string; severity: string | null; reaction: string | null }>([]),
    allergyNotice: allergyDisplayNotice(),
    boundary: MEDICATION_LIST_BOUNDARY,
    legacyReason: LEGACY_TREATMENT_REASON,
    notChecked: DEFERRED_SAFETY_CHECKS,
    refusals: MEDICATION_REFUSALS,
    storeNotice: null as string | null,
  };

  if (!hasCapability(ctx, CAP_MED_VIEW))
    return {
      ...base, permitted: false, unavailable: false, detail: null, storeState: "present",
      reconciliation: reconciliationLine({ unverified: 0, legacyOnly: 0, total: 0, everReviewed: false, unavailable: true }),
    };

  // ⚠ THE LEGACY HALF, THE ALLERGIES AND THE WEIGHT ARE READ EVEN WHEN THE MEDICATION STORE IS ABSENT.
  // They live in tables that DO exist, they are the honest content of the screen until the migration
  // lands, and hiding them would make a half-built module look like an empty patient.
  const [legacyRes, allergyRes, weightRes, ageRes] = await Promise.all([
    admin.from("practice_treatment")
      .select("id, label, dose, dose_unit, route, frequency, duration, status, encounter_id, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("treatment_type", "medication")
      .order("created_at", { ascending: false }).limit(100),
    admin.from("practice_patient_allergy")
      .select("id, substance, severity, reaction")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).limit(50),
    dosingWeight(admin, ctx, patientId, today),
    dosingAge(admin, ctx, patientId, today),
  ]);

  const legacyRows = (legacyRes.error ? [] : (legacyRes.data ?? [])) as any[];
  const legacy: Panel<LegacyTreatment> = legacyRes.error
    ? failed<LegacyTreatment>(`earlier treatment decisions could not be read: ${legacyRes.error.message}`)
    : loaded(legacyRows.map(t => ({
      // ⚠ COMPOSED AT THE ENGINE so the screens reading this cannot forget the unit -- there were
      // three of them, each joining its own string. One mapping, one answer.
      id: t.id, label: t.label, dose: doseWithUnit(t.dose, t.dose_unit) || null, route: t.route ?? null,
      frequency: t.frequency ?? null, duration: t.duration ?? null, status: t.status,
      encounterId: t.encounter_id, decidedAt: t.created_at ?? null,
    })));
  const allergies: Panel<{ id: string; substance: string; severity: string | null; reaction: string | null }> =
    allergyRes.error
      ? failed(`allergies could not be read: ${allergyRes.error.message}`)
      : loaded(((allergyRes.data ?? []) as any[]).map(a => ({
        id: a.id, substance: a.substance, severity: a.severity ?? null, reaction: a.reaction ?? null,
      })));

  const { data, error } = await admin.from(MEDICATION_TABLE)
    .select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("started_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
    .limit(200);

  if (error && isMissingTable(error)) {
    return {
      ...base, permitted: true, unavailable: false, detail: null,
      storeState: "absent", storeNotice: STORE_ABSENT_NOTICE,
      legacy, allergies, weight: weightRes.verdict, age: ageRes,
      // ⚠ NOT "reconciled". With no store there is nothing to reconcile INTO, and every legacy row is
      // uncarried by definition. reconciliationLine is given the true numbers and answers accordingly.
      reconciliation: reconciliationLine({
        unverified: 0, legacyOnly: legacy.unavailable ? 0 : legacy.items.length,
        total: 0, everReviewed: false, unavailable: legacy.unavailable,
      }),
    };
  }
  if (error) {
    return {
      ...base, permitted: true, unavailable: true,
      detail: `the medication record could not be read: ${error.message}`,
      storeState: "failed", legacy, allergies, weight: weightRes.verdict, age: ageRes,
      reconciliation: reconciliationLine({ unverified: 0, legacyOnly: 0, total: 0, everReviewed: false, unavailable: true }),
    };
  }

  const rows = (data ?? []) as any[];
  const mapped = rows.map(r => readRow(r, today));
  const carried = new Set(rows.map(r => r.treatment_id).filter(Boolean) as string[]);
  const legacyUncarried = legacy.unavailable ? legacy : loaded(legacy.items.filter(t => !carried.has(t.id)));
  const unverified = rows.filter(r =>
    (SOURCES_NEEDING_VERIFICATION as readonly string[]).includes(r.recorded_source) && !r.verified_at).length;

  return {
    ...base,
    permitted: true, unavailable: false, detail: null, storeState: "present",
    active: mapped.filter(m => m.current.inUse),
    past: mapped.filter(m => !m.current.inUse),
    legacy: legacyUncarried,
    allergies, weight: weightRes.verdict, age: ageRes,
    reconciliation: reconciliationLine({
      unverified,
      legacyOnly: legacyUncarried.unavailable ? 0 : legacyUncarried.items.length,
      total: rows.length,
      everReviewed: rows.some(r => !!r.verified_at),
      unavailable: legacyUncarried.unavailable,
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MED s6 -- THE TIMELINE
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type TimelineEntry = {
  id: string;
  eventType: string;
  reason: string | null;
  narrative: string | null;
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
  occurredOn: string;
  recordedAt: string;
  encounterId: string | null;
};

export type MedicationTimeline = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  storeState: "present" | "absent" | "failed";
  storeNotice: string | null;
  medication: MedicationRow | null;
  entries: TimelineEntry[];
  /** The calculations attached to this medication, newest first. Immutable rows. */
  calculations: DoseCalculationRow[];
  boundary: string;
  notChecked: typeof DEFERRED_SAFETY_CHECKS;
};

export type DoseCalculationRow = {
  id: string;
  basis: string;
  rateValue: number | null;
  doseUnit: string;
  dosesPerDay: number | null;
  weightKg: number | null;
  weightMeasurementId: string | null;
  weightEffectiveAt: string | null;
  heightCm: number | null;
  bsaM2: number | null;
  perDose: number | null;
  dailyTotal: number | null;
  formula: string;
  /** ⚠ EVERY STEP, AS IT WAS SHOWN AT THE TIME. Never recomputed. */
  working: string[];
  weightState: string;
  /**
   * ⚠ THE PRESCRIBER'S OWN WORDS WHEN THERE WAS NO WEIGHT, AND IT IS PRINTED WHEREVER THE FIGURE IS.
   * Migration 259: "a dose printed without the reasoning that produced it is exactly what this column
   * prevents." A reader who can see perDose is null must be able to see, in the same place, that a
   * judgement was recorded rather than a step being skipped.
   */
  weightDecision: string | null;
  /** ⚠ FROZEN ON THE ROW. What nobody checked, at the moment this dose was decided. */
  safetyChecksNotRun: string[];
  calculatedAt: string;
};

const readCalculation = (c: any): DoseCalculationRow => ({
  id: c.id, basis: c.basis, rateValue: c.rate_value ?? null, doseUnit: c.dose_unit,
  dosesPerDay: c.doses_per_day ?? null,
  weightKg: c.weight_kg ?? null, weightMeasurementId: c.weight_measurement_id ?? null,
  weightEffectiveAt: c.weight_effective_at ?? null, heightCm: c.height_cm ?? null,
  bsaM2: c.bsa_m2 ?? null, perDose: c.per_dose ?? null, dailyTotal: c.daily_total ?? null,
  formula: c.formula,
  working: String(c.working ?? "").split("\n").filter(Boolean),
  weightState: c.weight_state,
  // ⚠ btrim ON READ TOO. 259's constraint uses btrim, so a blank cannot be stored -- but a row written
  // before that constraint, or by a future caller with the constraint dropped, must not render as an
  // empty quotation mark that looks like a decision nobody can read.
  weightDecision: String(c.weight_decision ?? "").trim() || null,
  safetyChecksNotRun: (c.safety_checks_not_run ?? []) as string[],
  calculatedAt: c.calculated_at,
});

export async function medicationTimeline(
  admin: any, ctx: WorkspaceContext, medicationId: string, today = todayIso(),
): Promise<MedicationTimeline> {
  const base = {
    medication: null as MedicationRow | null, entries: [] as TimelineEntry[],
    calculations: [] as DoseCalculationRow[],
    boundary: TIMELINE_BOUNDARY, notChecked: DEFERRED_SAFETY_CHECKS, storeNotice: null as string | null,
  };
  if (!hasCapability(ctx, CAP_MED_VIEW))
    return { ...base, permitted: false, unavailable: false, detail: null, storeState: "present" };

  const { data: med, error: mErr } = await admin.from(MEDICATION_TABLE)
    .select("*").eq("id", medicationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (mErr && isMissingTable(mErr))
    return { ...base, permitted: true, unavailable: false, detail: null, storeState: "absent", storeNotice: STORE_ABSENT_NOTICE };
  if (mErr)
    return { ...base, permitted: true, unavailable: true, detail: `the medication could not be read: ${mErr.message}`, storeState: "failed" };
  if (!med)
    return { ...base, permitted: true, unavailable: false, detail: "no such medication", storeState: "present" };

  const [evRes, calcRes] = await Promise.all([
    admin.from(MEDICATION_EVENT_TABLE)
      .select("id, event_type, reason, narrative, previous, next, occurred_on, created_at, encounter_id")
      .eq("workspace_id", ctx.workspaceId).eq("medication_id", medicationId)
      .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    admin.from(MEDICATION_DOSE_TABLE)
      .select("*").eq("workspace_id", ctx.workspaceId).eq("medication_id", medicationId)
      .order("calculated_at", { ascending: false }).limit(50),
  ]);

  if (evRes.error)
    return {
      ...base, permitted: true, unavailable: true, storeState: "failed",
      medication: readRow(med, today),
      detail: `the timeline could not be read: ${evRes.error.message}`,
    };

  return {
    ...base, permitted: true, unavailable: false, detail: null, storeState: "present",
    medication: readRow(med, today),
    entries: ((evRes.data ?? []) as any[]).map(e => ({
      id: e.id, eventType: e.event_type, reason: e.reason ?? null, narrative: e.narrative ?? null,
      previous: (e.previous ?? {}) as Record<string, unknown>,
      next: (e.next ?? {}) as Record<string, unknown>,
      occurredOn: e.occurred_on, recordedAt: e.created_at, encounterId: e.encounter_id ?? null,
    })),
    calculations: calcRes.error ? [] : ((calcRes.data ?? []) as any[]).map(readCalculation),
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MED s9 -- THE PRACTICE WORKLIST AND THE DERIVED FAVOURITES
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MedicationWorklist = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  storeState: "present" | "absent" | "failed";
  storeNotice: string | null;
  /** MED s7. Reviews whose date has passed. Every figure is the length of a list you can open. */
  reviewsOverdue: Panel<{ id: string; patientId: string; genericName: string; nextReviewOn: string; daysOverdue: number }>;
  /** LCP s9. Rows somebody else supplied that no practitioner has reviewed. */
  awaitingVerification: Panel<{ id: string; patientId: string; genericName: string; source: string; recordedAt: string }>;
  /** MED s5's "full audit trail", as a register. */
  overrides: Panel<{ id: string; medicationId: string; patientId: string; reason: string; recordedAt: string }>;
  /** MED s9 "Favourite medications", DERIVED. See FAVOURITES_ARE_DERIVED. */
  favourites: Panel<{ genericName: string; timesRecorded: number }>;
  notChecked: typeof DEFERRED_SAFETY_CHECKS;
  refusals: typeof MEDICATION_REFUSALS;
  boundary: string;
};

export async function medicationWorklist(
  admin: any, ctx: WorkspaceContext, today = todayIso(),
): Promise<MedicationWorklist> {
  const base = {
    reviewsOverdue: loaded<{ id: string; patientId: string; genericName: string; nextReviewOn: string; daysOverdue: number }>([]),
    awaitingVerification: loaded<{ id: string; patientId: string; genericName: string; source: string; recordedAt: string }>([]),
    overrides: loaded<{ id: string; medicationId: string; patientId: string; reason: string; recordedAt: string }>([]),
    favourites: loaded<{ genericName: string; timesRecorded: number }>([]),
    notChecked: DEFERRED_SAFETY_CHECKS, refusals: MEDICATION_REFUSALS,
    boundary: MEDICATION_LIST_BOUNDARY, storeNotice: null as string | null,
  };
  if (!hasCapability(ctx, CAP_MED_VIEW))
    return {
      ...base, permitted: false, unavailable: false, detail: null, storeState: "present",
      reviewsOverdue: denied(), awaitingVerification: denied(), overrides: denied(), favourites: denied(),
    };

  const [reviewRes, verifyRes, overrideRes, nameRes] = await Promise.all([
    admin.from(MEDICATION_TABLE)
      .select("id, patient_id, generic_name, next_review_on")
      .eq("workspace_id", ctx.workspaceId).in("status", ["active", "paused"])
      .not("next_review_on", "is", null).lte("next_review_on", today)
      .order("next_review_on", { ascending: true }).limit(200),
    admin.from(MEDICATION_TABLE)
      .select("id, patient_id, generic_name, recorded_source, created_at")
      .eq("workspace_id", ctx.workspaceId).is("verified_at", null)
      .in("recorded_source", ["patient_reported", "imported"])
      .order("created_at", { ascending: false }).limit(200),
    admin.from(MEDICATION_EVENT_TABLE)
      .select("id, medication_id, patient_id, reason, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("event_type", "safety_override")
      .order("created_at", { ascending: false }).limit(100),
    admin.from(MEDICATION_TABLE)
      .select("generic_name").eq("workspace_id", ctx.workspaceId).limit(1000),
  ]);

  if (reviewRes.error && isMissingTable(reviewRes.error))
    return { ...base, permitted: true, unavailable: false, detail: null, storeState: "absent", storeNotice: STORE_ABSENT_NOTICE };
  if (reviewRes.error)
    return {
      ...base, permitted: true, unavailable: true, storeState: "failed",
      detail: `the medication worklist could not be read: ${reviewRes.error.message}`,
      reviewsOverdue: failed(reviewRes.error.message),
    };

  const dayDiff = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

  // ⚠ DERIVED, NOT CURATED. The distinct generic names this workspace has actually recorded, most-used
  // first. PostgREST caps an unbounded select at 1000 rows and the limit above is explicit for that
  // reason -- a cap that is not stated is one that silently turns "we could not see far enough" into
  // "there is nothing there".
  const counts = new Map<string, number>();
  for (const r of ((nameRes.data ?? []) as any[])) {
    const key = String(r.generic_name ?? "").trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const favourites = [...counts.entries()]
    .map(([genericName, timesRecorded]) => ({ genericName, timesRecorded }))
    .sort((a, b) => b.timesRecorded - a.timesRecorded || a.genericName.localeCompare(b.genericName))
    .slice(0, 12);

  return {
    ...base, permitted: true, unavailable: false, detail: null, storeState: "present",
    reviewsOverdue: loaded(((reviewRes.data ?? []) as any[]).map(r => ({
      id: r.id, patientId: r.patient_id, genericName: r.generic_name,
      nextReviewOn: r.next_review_on, daysOverdue: dayDiff(r.next_review_on, today),
    }))),
    awaitingVerification: verifyRes.error
      ? failed(`the unreviewed list could not be read: ${verifyRes.error.message}`)
      : loaded(((verifyRes.data ?? []) as any[]).map(r => ({
        id: r.id, patientId: r.patient_id, genericName: r.generic_name,
        source: r.recorded_source, recordedAt: r.created_at,
      }))),
    overrides: overrideRes.error
      ? failed(`the override register could not be read: ${overrideRes.error.message}`)
      : loaded(((overrideRes.data ?? []) as any[]).map(r => ({
        id: r.id, medicationId: r.medication_id, patientId: r.patient_id,
        reason: r.reason ?? "", recordedAt: r.created_at,
      }))),
    favourites: nameRes.error ? failed(`favourites could not be computed: ${nameRes.error.message}`) : loaded(favourites),
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WRITES
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MedicationInput = {
  patientId: string;
  encounterId?: string | null;
  treatmentId?: string | null;
  genericName: string;
  brandName?: string | null;
  formulation?: string | null;
  strengthText?: string | null;
  doseText: string;
  doseValue?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  frequency?: string | null;
  frequencyPerDay?: number | null;
  durationText?: string | null;
  indication?: string | null;
  startedOn?: string | null;
  prescriber?: string | null;
  source?: string;
  reviewIntervalDays?: number | null;
  actorId: string;
  correlationId: string;
};

/** MED s2. Records a medication and opens its timeline with a `started` entry in the same act. */
export async function recordMedication(
  admin: any, ctx: WorkspaceContext, input: MedicationInput,
): Promise<EngineResult<{ id: string; status: string; source: string; verificationRequired: boolean }>> {
  if (!hasCapability(ctx, CAP_MED_RECORD))
    return fail(403, "FORBIDDEN", "recording a medication needs medication.record");

  const genericName = trim(input.genericName);
  const doseText = trim(input.doseText);
  if (!genericName) return fail(422, "VALIDATION_ERROR", "a medication needs a name");
  if (!doseText) return fail(422, "VALIDATION_ERROR", "a medication needs a dose, in words if not in numbers -- a row with no dose is not a medication record");
  const source = input.source ?? "practitioner";
  if (!MEDICATION_SOURCE_CODES.includes(source))
    return fail(422, "VALIDATION_ERROR", `unknown source "${source}"`);

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id, status").eq("id", input.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return fail(503, "UNAVAILABLE", `the patient could not be read: ${pErr.message}`);
  if (!patient) return fail(404, "NOT_FOUND", "no such patient");
  if (patient.status !== "active") return fail(422, "PATIENT_NOT_ACTIVE", "this patient record is not active");

  // ⚠ A NAMED TREATMENT MUST BELONG TO THIS WORKSPACE AND THIS PATIENT. A medication carried across from
  // somebody else's consultation would put one person's drug on another's list.
  if (input.treatmentId) {
    const { data: t } = await admin.from("practice_treatment")
      .select("id").eq("id", input.treatmentId).eq("workspace_id", ctx.workspaceId)
      .eq("patient_id", input.patientId).maybeSingle();
    if (!t) return fail(404, "NOT_FOUND", "no such treatment for this patient");
  }

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, patient_id: input.patientId,
    encounter_id: input.encounterId ?? null, treatment_id: input.treatmentId ?? null,
    generic_name: genericName, brand_name: trim(input.brandName) || null,
    formulation: trim(input.formulation) || null, strength_text: trim(input.strengthText) || null,
    dose_text: doseText, dose_value: input.doseValue ?? null, dose_unit: trim(input.doseUnit) || null,
    route: trim(input.route) || null, frequency: trim(input.frequency) || null,
    frequency_per_day: input.frequencyPerDay ?? null,
    duration_text: trim(input.durationText) || null, indication: trim(input.indication) || null,
    started_on: input.startedOn ?? todayIso(), prescriber: trim(input.prescriber) || null,
    recorded_source: source, status: "active",
    review_interval_days: input.reviewIntervalDays ?? null,
    created_by: input.actorId, updated_by: input.actorId,
  };
  if (input.reviewIntervalDays && input.reviewIntervalDays > 0)
    row.next_review_on = addDays(String(row.started_on), input.reviewIntervalDays);

  const { data, error } = await admin.from(MEDICATION_TABLE).insert(row).select("id, status, recorded_source").single();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return fail(500, "WRITE_FAILED", `the medication could not be saved: ${error.message}`);

  // ⚠ THE TIMELINE OPENS WITH THE ROW. A medication whose first event is its first CHANGE has a history
  // that starts in the middle, and MED s6's "medication history" would begin with an edit.
  const { error: evErr } = await admin.from(MEDICATION_EVENT_TABLE).insert({
    workspace_id: ctx.workspaceId, medication_id: data.id, patient_id: input.patientId,
    encounter_id: input.encounterId ?? null, event_type: "started",
    next: { genericName, doseText, route: row.route, frequency: row.frequency, source },
    occurred_on: row.started_on, created_by: input.actorId,
  });
  if (evErr) return fail(500, "AUDIT_FAILED", `the medication was saved without its timeline entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.medication.recorded",
    payload: { medicationId: data.id, patientId: input.patientId, genericName, source },
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    data: {
      id: data.id, status: data.status, source: data.recorded_source,
      verificationRequired: (SOURCES_NEEDING_VERIFICATION as readonly string[]).includes(source),
    },
  };
}

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * MED s6. A change to a medication, with its reason, as an append-only timeline entry AND the
 * corresponding parent update.
 *
 * ⚠ THE PARENT IS UPDATED AND THE TIMELINE IS NOT. This is the one place those two rules meet, and the
 * split is deliberate: the medication row is the CURRENT state and must be able to change, the event row
 * is what HAPPENED and must never. The event carries `previous`, read before the write, so the history
 * survives even though the parent moved.
 */
export async function changeMedication(
  admin: any, ctx: WorkspaceContext,
  input: {
    medicationId: string;
    eventType: string;
    doseText?: string | null;
    doseValue?: number | null;
    frequency?: string | null;
    frequencyPerDay?: number | null;
    reason?: string | null;
    narrative?: string | null;
    occurredOn?: string | null;
    encounterId?: string | null;
    actorId: string; correlationId: string;
  },
): Promise<EngineResult<{ id: string; status: string; eventId: string }>> {
  if (!hasCapability(ctx, CAP_MED_RECORD))
    return fail(403, "FORBIDDEN", "changing a medication needs medication.record");
  if (!MEDICATION_EVENT_TYPE_CODES.includes(input.eventType))
    return fail(422, "VALIDATION_ERROR", `unknown event type "${input.eventType}"`);
  // ⚠ safety_override AND verified ARE NOT WRITTEN THROUGH THIS FUNCTION. Each is its own act with its
  // own capability, and letting a generic change endpoint emit them would put the override behind
  // medication.record instead of medication.override.
  if (input.eventType === "safety_override" || input.eventType === "verified" || input.eventType === "started")
    return fail(422, "VALIDATION_ERROR", `"${input.eventType}" is recorded by its own action, not by a change`);

  const reason = trim(input.reason);
  if (["dose_changed", "discontinued"].includes(input.eventType) && !reason)
    return fail(422, "VALIDATION_ERROR", "a dose change or a discontinuation must say why -- the reason is the only thing the next prescriber needs");

  const { data: med, error: rErr } = await admin.from(MEDICATION_TABLE)
    .select("*").eq("id", input.medicationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (rErr) return fail(503, "UNAVAILABLE", `the medication could not be read: ${rErr.message}`);
  if (!med) return fail(404, "NOT_FOUND", "no such medication");

  const occurredOn = input.occurredOn ?? todayIso();
  const patch: Record<string, unknown> = { updated_at: nowIso(), updated_by: input.actorId };
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  if (input.eventType === "dose_changed") {
    const doseText = trim(input.doseText);
    if (!doseText) return fail(422, "VALIDATION_ERROR", "a dose change needs the new dose");
    previous.doseText = med.dose_text; next.doseText = doseText;
    patch.dose_text = doseText;
    if (input.doseValue !== undefined) { previous.doseValue = med.dose_value; next.doseValue = input.doseValue; patch.dose_value = input.doseValue; }
    if (input.frequency !== undefined) { previous.frequency = med.frequency; next.frequency = trim(input.frequency) || null; patch.frequency = trim(input.frequency) || null; }
    if (input.frequencyPerDay !== undefined) { previous.frequencyPerDay = med.frequency_per_day; next.frequencyPerDay = input.frequencyPerDay; patch.frequency_per_day = input.frequencyPerDay; }
  } else if (input.eventType === "paused" || input.eventType === "resumed"
    || input.eventType === "discontinued" || input.eventType === "completed") {
    const status = input.eventType === "resumed" ? "active"
      : input.eventType === "paused" ? "paused"
        : input.eventType === "discontinued" ? "discontinued" : "completed";
    previous.status = med.status; next.status = status;
    patch.status = status;
    if (status === "discontinued") { patch.discontinued_reason = reason; patch.stopped_on = occurredOn; }
    if (status === "completed") patch.stopped_on = med.stopped_on ?? occurredOn;
    if (status === "active") patch.stopped_on = null;
  }
  // adverse_reaction, adherence_note and effectiveness_note change nothing on the parent. They are
  // observations about a medication, not changes to it, and writing them onto the row would make the
  // record say the prescription changed when it did not.

  if (Object.keys(patch).length > 2) {
    const { error: uErr } = await admin.from(MEDICATION_TABLE)
      .update(patch).eq("id", input.medicationId).eq("workspace_id", ctx.workspaceId);
    if (uErr) return fail(500, "WRITE_FAILED", `the medication could not be updated: ${uErr.message}`);
  }

  const { data: ev, error: evErr } = await admin.from(MEDICATION_EVENT_TABLE).insert({
    workspace_id: ctx.workspaceId, medication_id: input.medicationId, patient_id: med.patient_id,
    encounter_id: input.encounterId ?? null, event_type: input.eventType,
    previous, next, reason: reason || null, narrative: trim(input.narrative) || null,
    occurred_on: occurredOn, created_by: input.actorId,
  }).select("id").single();
  if (evErr) return fail(500, "AUDIT_FAILED", `the change was applied without its timeline entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: `practice.medication.${input.eventType}`,
    payload: { medicationId: input.medicationId, patientId: med.patient_id, previous, next, reason },
    correlationId: input.correlationId,
  });

  return { ok: true, data: { id: input.medicationId, status: String(patch.status ?? med.status), eventId: ev.id } };
}

/**
 * LCP s9's reconciliation act: a practitioner reviews a row somebody else supplied.
 *
 * ⚠ IT IS THE PRACTITIONER CAPABILITY, NOT THE RECORDING ONE. An assistant may write down what the
 * patient said -- that is the point of granting them medication.record -- and confirming it is a
 * clinical judgement.
 */
export async function verifyMedication(
  admin: any, ctx: WorkspaceContext,
  input: { medicationId: string; note?: string | null; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; verifiedAt: string }>> {
  if (!hasCapability(ctx, CAP_MED_OVERRIDE))
    return fail(403, "FORBIDDEN", "confirming a patient-reported medication needs medication.override -- it is a practitioner's judgement, not a transcription");

  const { data: med, error: rErr } = await admin.from(MEDICATION_TABLE)
    .select("id, patient_id, recorded_source, verified_at").eq("id", input.medicationId)
    .eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (rErr) return fail(503, "UNAVAILABLE", `the medication could not be read: ${rErr.message}`);
  if (!med) return fail(404, "NOT_FOUND", "no such medication");
  if (med.verified_at) return fail(409, "ALREADY_VERIFIED", "this medication has already been reviewed");

  const verifiedAt = nowIso();
  const { error: uErr } = await admin.from(MEDICATION_TABLE)
    .update({ verified_at: verifiedAt, verified_by: input.actorId, updated_at: verifiedAt, updated_by: input.actorId })
    .eq("id", input.medicationId).eq("workspace_id", ctx.workspaceId);
  if (uErr) return fail(500, "WRITE_FAILED", `the review could not be saved: ${uErr.message}`);

  const { error: evErr } = await admin.from(MEDICATION_EVENT_TABLE).insert({
    workspace_id: ctx.workspaceId, medication_id: input.medicationId, patient_id: med.patient_id,
    event_type: "verified", previous: { verifiedAt: null }, next: { verifiedAt },
    narrative: trim(input.note) || null, created_by: input.actorId,
  });
  if (evErr) return fail(500, "AUDIT_FAILED", `the review was saved without its timeline entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.medication.verified",
    payload: { medicationId: input.medicationId, patientId: med.patient_id, source: med.recorded_source },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: input.medicationId, verifiedAt } };
}

/**
 * Reconciliation, the other half: carry a legacy `practice_treatment` decision into the record.
 *
 * ⚠ IT COPIES, IT DOES NOT MOVE, AND THE TREATMENT ROW IS UNTOUCHED. The treatment is the historical
 * fact that somebody decided this in that consultation, and rewriting it would rewrite a consultation.
 * The link is treatment_id, which is also what takes the row off the uncarried list.
 */
export async function carryForwardTreatment(
  admin: any, ctx: WorkspaceContext,
  input: {
    treatmentId: string; genericName?: string | null; doseText?: string | null;
    startedOn?: string | null; actorId: string; correlationId: string;
  },
): Promise<EngineResult<{ id: string; carriedFrom: string }>> {
  if (!hasCapability(ctx, CAP_MED_RECORD))
    return fail(403, "FORBIDDEN", "carrying a treatment into the medication record needs medication.record");

  const { data: t, error } = await admin.from("practice_treatment")
    // ⚠ dose_unit IS SELECTED BECAUSE THIS PATH WRITES A PERMANENT RECORD. Without it, carrying a
    // treatment forward turned "3 mg" into the string "3" in the patient's medication list and the
    // unit was gone for good -- destroyed at the moment of carry-forward, not merely hidden.
    .select("id, patient_id, encounter_id, treatment_type, label, dose, dose_unit, route, frequency, duration, created_at")
    .eq("id", input.treatmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", `the treatment could not be read: ${error.message}`);
  if (!t) return fail(404, "NOT_FOUND", "no such treatment");
  if (t.treatment_type !== "medication")
    return fail(422, "VALIDATION_ERROR", "only a treatment of type medication can be carried into the medication record");

  const { data: already, error: aErr } = await admin.from(MEDICATION_TABLE)
    .select("id").eq("workspace_id", ctx.workspaceId).eq("treatment_id", t.id).maybeSingle();
  if (aErr && isMissingTable(aErr)) return storeAbsent();
  if (already) return fail(409, "ALREADY_CARRIED", "this treatment is already in the medication record");

  return await recordMedication(admin, ctx, {
    patientId: t.patient_id, encounterId: t.encounter_id, treatmentId: t.id,
    genericName: trim(input.genericName) || t.label,
    // ⚠ THE FREE-TEXT DOSE IS CARRIED AS TEXT AND IS NOT PARSED. "1/12" and "5 days" are what somebody
    // wrote, and a parser inventing numbers from them would put a fabricated dose in a clinical record.
    doseText: trim(input.doseText) || doseWithUnit(trim(t.dose), trim(t.dose_unit))
      || "as recorded in the consultation",
    // The structured unit travels too, so the carried row is as complete as the one it came from.
    doseUnit: trim(t.dose_unit) || null,
    route: t.route, frequency: t.frequency, durationText: t.duration,
    startedOn: input.startedOn ?? (t.created_at ? String(t.created_at).slice(0, 10) : null),
    source: "practitioner",
    actorId: input.actorId, correlationId: input.correlationId,
  }).then(r => r.ok
    ? { ok: true as const, data: { id: r.data.id, carriedFrom: t.id } }
    : r);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MED s3 -- THE DOSE CALCULATION
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type DoseCalculationInput = {
  patientId: string;
  medicationId?: string | null;
  encounterId?: string | null;
  basis: string;
  rateValue?: number | null;
  fixedDose?: number | null;
  doseUnit?: string | null;
  dosesPerDay?: number | null;
  /** ⚠ Only honoured with medication.override, and only when the weight is STALE or IMPLAUSIBLE. */
  overrideReason?: string | null;
  /**
   * The user's ruling of 2026-08-08, in one field: what the prescriber decided when there was no weight.
   *
   * ⚠ THIS IS NOT A WEIGHT AND MUST NEVER BECOME ONE. It is free text that is stored and printed, never
   * parsed. Nothing multiplies by it. `weightKg` still comes from a recorded measurement and from nowhere
   * else -- a dose computed from a number a prescriber typed under pressure is the worst output this
   * codebase could produce, and it is the one this field is most likely to be mistaken for.
   *
   * ⚠ Only honoured with medication.override, and only when the weight is ABSENT or UNREADABLE. Supplied
   * anywhere else it is REFUSED rather than dropped -- see WEIGHT_DECISION_NOT_APPLICABLE.
   */
  weightDecision?: string | null;
  actorId: string; correlationId: string;
};

export type DoseCalculationResult = {
  id: string | null;
  perDose: number | null;
  dailyTotal: number | null;
  unit: string;
  formula: string;
  working: string[];
  sentence: string;
  weight: WeightVerdict;
  bsaM2: number | null;
  /** ⚠ ALWAYS PRESENT, ALWAYS THE SAME EIGHT. A payload that omitted this would read as a clean check. */
  notChecked: typeof DEFERRED_SAFETY_CHECKS;
  /** ⚠ ALWAYS PRESENT. The sentence that must be printed beside the figure. */
  safetyNotice: string;
  /** True when a practitioner overrode a STALE or IMPLAUSIBLE weight to get this number. */
  overridden: boolean;
  /**
   * The prescriber's own words, when there was no weight at all and they proceeded anyway.
   *
   * ⚠ WHEN THIS IS SET, perDose AND dailyTotal ARE NULL AND THAT IS THE DESIGN, not a failure. Nothing
   * was multiplied. The row exists so the decision is on the record beside the prescription rather than
   * only in the prescriber's head.
   */
  weightDecision: string | null;
  /**
   * ⚠ NULL WHEN THE ROW WAS STORED, AND A SENTENCE SAYING WHY WHEN IT WAS NOT. Never an empty string.
   * `id === null` alone said only that something went wrong, and the screen guessed at which thing.
   */
  notStored: string | null;
};

/**
 * The "working" of a calculation that DELIBERATELY DID NOT HAPPEN, for the recorded-decision path.
 *
 * ⚠ IT IS NOT EMPTY AND IT IS NOT A BLANK ROW, for the same reason doseArithmetic returns working for a
 * fixed dose: a record that showed five lines of working for three regimens and nothing for the fourth
 * would read as a step somebody skipped. Saying WHY no arithmetic was performed IS the working, and the
 * `working text not null check (char_length(btrim(working)) > 0)` column exists to make that impossible
 * to omit.
 *
 * ⚠ NOTHING HERE MULTIPLIES BY ANYTHING, AND THE RATE IS ECHOED AS TYPED RATHER THAN APPLIED. The rate is
 * part of what the prescriber intended and belongs on the record, but a figure derived from it and a
 * weight nobody measured would be exactly the fabricated dose this whole engine refuses.
 */
function decisionWorking(input: {
  basis: DoseBasis; rate: number | null; unit: string; weightText: string; decision: string;
  /** ⚠ WHY THIS PATH WAS OPEN AT ALL, frozen into the working. See the note on the age line below. */
  ageText: string; ageState: AgeVerdict["state"];
}): {
  ok: true; perDose: null; dailyTotal: null; unit: string;
  formula: string; working: string[]; sentence: string; bsaM2: null;
} {
  const label = DOSE_BASIS_LABEL[input.basis] ?? input.basis;
  return {
    ok: true, perDose: null, dailyTotal: null, unit: input.unit, bsaM2: null,
    formula: "no calculation performed -- there was no recorded weight to multiply",
    working: [
      `Basis chosen: ${label}.`,
      input.rate !== null && Number.isFinite(input.rate)
        ? `Rate as typed: ${input.rate} ${input.unit}/kg. It was NOT applied to anything.`
        : `No rate was typed, and none was needed: nothing was multiplied.`,
      input.weightText,
      // ⚠ THE AGE IS IN THE WORKING BECAUSE IT IS PART OF WHY THIS ROW EXISTS. This path is open to
      // children only, and to patients whose age nothing states -- a reader six months later must be able
      // to see which of those two it was, without recomputing an age from a birth date that has moved on.
      input.ageState === "unknown"
        ? `${input.ageText} This record offers this path when an age is unknown, because refusing on a query that did not run would send the prescriber to work the dose out where nothing records it.`
        : `${input.ageText} This path is offered for patients under 18.`,
      `NO ARITHMETIC WAS PERFORMED. This product does not compute a dose from a weight it did not record, so no figure is produced here.`,
      `The prescriber recorded this decision instead: ${input.decision}`,
      `Any dose given was decided by the prescriber. It is not a figure this product produced, and none of the deferred safety checks below was run against it.`,
    ],
    sentence: `No dose figure was computed: no weight was recorded. The prescriber's decision is recorded instead -- ${input.decision}`,
  };
}

/**
 * MED s3. Arithmetic on a weight this record can cite, with every step returned, and NO SAFETY CLAIM.
 *
 * ⚠ THE THREE THINGS THIS FUNCTION REFUSES TO DO, each of which would look like a feature:
 *
 *   1. It will not compute a weight-based dose without a recorded weight. LCP s9: "A weight-dependent
 *      paediatric dose requires a usable dosing weight." A dose from an assumed weight is the worst
 *      output this codebase could produce. ⚠ AND THE RULING OF 2026-08-08 DOES NOT SOFTEN THIS ONE. With
 *      no weight the prescriber may proceed, and STILL NO FIGURE IS COMPUTED -- what gets recorded is the
 *      decision and what it was based on. See the gate below.
 *   2. It will not proceed past a flagged or missing weight without medication.override AND words. That
 *      is MED s5's "practitioner override with justification", given the only home it has in this build,
 *      and the words land in the append-only timeline where a register can be read off it.
 *   3. It will not claim anything about the dose it produces. safety_checks_not_run is written onto the
 *      immutable row with a cardinality >= 1 constraint behind it, so a stored calculation can always
 *      say what nobody checked at the time.
 */
export async function calculateDose(
  admin: any, ctx: WorkspaceContext, input: DoseCalculationInput, today = todayIso(),
): Promise<EngineResult<DoseCalculationResult>> {
  if (!hasCapability(ctx, CAP_MED_RECORD))
    return fail(403, "FORBIDDEN", "calculating a dose needs medication.record");
  if (!DOSE_BASIS_CODES.includes(input.basis))
    return fail(422, "VALIDATION_ERROR", `unknown dose basis "${input.basis}"`);

  const basis = input.basis as DoseBasis;
  const needsWeight = (BASES_NEEDING_WEIGHT as readonly string[]).includes(basis);
  const needsHeight = (BASES_NEEDING_HEIGHT as readonly string[]).includes(basis);

  const { verdict: weight, measurement: weightMeasurement } = needsWeight
    ? await dosingWeight(admin, ctx, input.patientId, today)
    : {
      verdict: weightLine({ valueKg: null, effectiveAt: null, plausibility: null, due: null, daysOverdue: null, today, unavailable: false }),
      measurement: { value: null, unit: null, measurementId: null, effectiveAt: null, definitionId: null, plausibility: null, unavailable: false } as DosingMeasurement,
    };
  const height = needsHeight
    ? await dosingMeasurement(admin, ctx, input.patientId, HEIGHT_PARAMETER_CODE)
    : null;

  const overrideReason = trim(input.overrideReason);
  const decisionText = trim(input.weightDecision);
  const unit = trim(input.doseUnit) || "mg";
  // ⚠ ONLY WHEN THE BASIS IS A FUNCTION OF WEIGHT. `fixed` needs no weight and MUST NEVER BE ASKED TO
  // JUSTIFY NOT HAVING ONE -- most patients on a fixed dose have never been weighed, and a prompt that
  // fires when nothing is wrong is a prompt people learn to dismiss without reading.
  const noWeightToWorkFrom =
    needsWeight && (WEIGHT_STATES_NEEDING_DECISION as readonly string[]).includes(weight.state);
  let overridden = false;

  // ⚠ SUPPLIED WHERE IT MEANS NOTHING, IT IS REFUSED RATHER THAN DROPPED. A prescriber who wrote a
  // clinical justification and had it silently discarded is the silent-write class this codebase has paid
  // for twice. The refusal says where the words belong instead.
  //
  // ⚠ AND THE TWO REASONS IT CAN BE INAPPLICABLE ARE NOT THE SAME SENTENCE. A fixed dose does not depend
  // on a weight AT ALL, and for it the weight verdict above is a synthetic blank whose text reads "no
  // weight is recorded" -- printing that beside "this patient has one" would be a flat contradiction on
  // the commonest prescription this product writes. Found by breaking the gate and reading the message
  // the broken build produced, which is the only reason it is not still there.
  if (decisionText && !noWeightToWorkFrom)
    return fail(422, "WEIGHT_DECISION_NOT_APPLICABLE", !needsWeight
      ? "A fixed dose does not depend on the patient's weight, so there is nothing for a weight decision"
        + " to stand in for and it has NOT been stored. If the reasoning matters, record it on the"
        + " medication itself."
      : `${WEIGHT_DECISION_NOT_APPLICABLE} ${weight.text}`
        + (weight.state === "stale" || weight.state === "implausible"
          ? " To prescribe on this weight anyway, put your reasoning in the override reason instead."
          : ""));

  // ⚠ THE GATE, AND IT IS ON THE WEIGHT STATE RATHER THAN ON A GENERIC "HAS WARNINGS". `stale` and
  // `implausible` can be prescribed on by a practitioner, with a reason. `age_unjudged` is NOT gated:
  // nothing said the weight was out of date, so demanding an override for it would train people to type a
  // reason for every prescription and would make the real overrides invisible in the register.
  if (needsWeight && (weight.state === "stale" || weight.state === "implausible")) {
    if (!hasCapability(ctx, CAP_MED_OVERRIDE))
      return fail(403, "OVERRIDE_REQUIRED", `${weight.text} Prescribing on it needs medication.override.`);
    if (!overrideReason)
      return fail(422, "OVERRIDE_REASON_REQUIRED", `${weight.text} To prescribe on this weight anyway, say why in one sentence -- it is recorded on the medication's timeline.`);
    overridden = true;
  }

  // ⚠ THE SECOND HALF OF THE SAME GATE, AND THE SENTENCE THAT USED TO STAND HERE WAS RIGHT WHEN IT WAS
  // WRITTEN. It said: "`absent` cannot be overridden into a number at all -- there is nothing to
  // multiply." There is STILL nothing to multiply, and this branch does not invent one. What changed is
  // the user's ruling of 2026-08-08 and migrations 259/265 behind it: refusing outright sent the
  // prescriber to work the dose out on paper, and then the decision happened anyway with nothing
  // recording that it did. So the prescriber proceeds, NO FIGURE IS PRODUCED, and the judgement that let
  // them proceed is written onto the same immutable row as the prescription it justified.
  //
  // ⚠ AND IT IS FOR CHILDREN ONLY -- the user's narrowing of 2026-08-08, "only a child <18 years". An
  // adult meets the refusal this engine gave before migration 265, unchanged, which is the conservative
  // branch and the one that needs no new justification. An age nobody recorded is NOT an adult.
  let age: AgeVerdict | null = null;
  if (noWeightToWorkFrom) {
    // ⚠ BSA FIRST, AND IT NEVER MENTIONS THE DECISION. A decision may stand in for a missing MEASUREMENT.
    // It cannot stand in for the ARITHMETIC -- migration 265 kept bsa_m2 required for mg_per_m2 even with
    // a decision, because a mg/m2 dose with no surface area is a blank rather than a stated judgement.
    // Asking for a decision here and then refusing the row anyway would be a refusal this code could have
    // predicted, so it is refused BEFORE anybody is asked to write anything.
    if (basis === "mg_per_m2")
      return fail(422, "CANNOT_CALCULATE", `${weight.text} ${BSA_NEEDS_MEASUREMENTS}`);

    // ⚠ THE AGE IS READ ONLY HERE, IN THE ONE BRANCH THAT TURNS ON IT. Every other prescription pays
    // nothing for a query it does not need.
    age = await dosingAge(admin, ctx, input.patientId, today);
    // ⚠ NOT ONE WORD ABOUT A DECISION IN THIS MESSAGE, AND THAT IS THE POINT OF IT. There is no second
    // road for an adult. Naming one -- even to say it does not apply -- teaches a prescriber that a form
    // of words exists which gets a number out of the product, and the next refusal is one they argue
    // with. This is the sentence the engine gave before 265, and the age is not recited either: it would
    // read as "if they were younger, there would be another way", which is the same door by implication.
    if (!age.decisionPathOffered)
      return fail(422, "CANNOT_CALCULATE", `${weight.text} ${ADULT_NO_WEIGHT_REFUSED}`);

    if (!hasCapability(ctx, CAP_MED_OVERRIDE))
      return fail(403, "OVERRIDE_REQUIRED",
        `${weight.text} Prescribing without a recorded weight needs medication.override.`);
    // ⚠ THE ENGINE REFUSES A BLANK IN A SENTENCE, BEFORE THE DATABASE REFUSES IT WITH A CONSTRAINT NAME.
    // 259's check uses btrim, so " " would be refused either way -- but 23514 with a constraint name is
    // not a thing to put in front of a prescriber, and trim() here means the space bar cannot satisfy a
    // clinical-safety requirement in the one layer a screen actually talks to.
    if (!decisionText)
      return fail(422, "WEIGHT_DECISION_REQUIRED", weightDecisionPrompt(weight.state));
  }

  // ⚠ THE ARITHMETIC IS SKIPPED ENTIRELY ON THE DECISION PATH, rather than run and allowed to fail. Its
  // refusal ("no usable weight is recorded...") is the correct answer to a different question -- it is
  // what a caller with no decision should see -- and printing it beside a recorded decision would read as
  // though the product had tried and failed, when in fact it declined to guess.
  const arithmetic = noWeightToWorkFrom
    ? decisionWorking({
      basis, rate: input.rateValue ?? null, unit, weightText: weight.text, decision: decisionText,
      // ⚠ NON-NULL HERE BY CONSTRUCTION: the branch above returns for every age that is not offered the
      // path, so a decision row can never be written without an age verdict behind it.
      ageText: age?.text ?? "", ageState: age?.state ?? "unknown",
    })
    : doseArithmetic({
      basis,
      dosePerUnit: input.rateValue ?? null,
      fixedDose: input.fixedDose ?? null,
      weightKg: weight.usable ? weightMeasurement.value : null,
      heightCm: height?.value ?? null,
      dosesPerDay: input.dosesPerDay ?? null,
      unit,
    });
  if (!arithmetic.ok) return fail(422, "CANNOT_CALCULATE", arithmetic.message);

  const result: DoseCalculationResult = {
    id: null,
    perDose: arithmetic.perDose, dailyTotal: arithmetic.dailyTotal, unit: arithmetic.unit,
    formula: arithmetic.formula, working: arithmetic.working, sentence: arithmetic.sentence,
    weight, bsaM2: arithmetic.bsaM2,
    notChecked: DEFERRED_SAFETY_CHECKS, safetyNotice: doseSafetyNotice(), overridden,
    weightDecision: noWeightToWorkFrom ? decisionText : null,
    notStored: null,
  };

  const { data, error } = await admin.from(MEDICATION_DOSE_TABLE).insert({
    workspace_id: ctx.workspaceId, patient_id: input.patientId,
    medication_id: input.medicationId ?? null, encounter_id: input.encounterId ?? null,
    basis, rate_value: input.rateValue ?? null, dose_unit: arithmetic.unit,
    doses_per_day: input.dosesPerDay ?? null,
    // ⚠ THE RULING OF 2026-08-08 ON THE ROW ITSELF, and 259's comment says why it is here and not only in
    // practice_medication_event: an event in another table can be printed apart from the prescription it
    // justified, and a dose printed without the reasoning that produced it is what this column prevents.
    weight_decision: result.weightDecision,
    weight_kg: weight.usable ? weightMeasurement.value : null,
    weight_measurement_id: weightMeasurement.measurementId,
    weight_effective_at: weightMeasurement.effectiveAt,
    height_cm: height?.value ?? null, height_measurement_id: height?.measurementId ?? null,
    bsa_m2: arithmetic.bsaM2,
    per_dose: arithmetic.perDose, daily_total: arithmetic.dailyTotal,
    formula: arithmetic.formula,
    // Stored as text with a newline per step so the column can be NOT NULL with a non-empty check. An
    // array column would have made the emptiness check the one migration 246 warns about.
    working: arithmetic.working.join("\n"),
    weight_state: weight.state,
    // ⚠ FROZEN ON THE ROW. Never reconstructed from a constant that may have changed since.
    safety_checks_not_run: DEFERRED_CHECK_KEYS,
    calculated_by: input.actorId,
  }).select("id").single();

  // ⚠ THE ARITHMETIC IS RETURNED EVEN IF IT COULD NOT BE STORED, AND THE PAYLOAD SAYS SO. A prescriber
  // who asked for a number and got a database error instead would do the multiplication on paper. What
  // must not happen is the number being returned as though it had been recorded.
  //
  // ⚠ AND THE ERROR IS NO LONGER DISCARDED. Both branches used to return the same silent `id: null`, so a
  // constraint refusal -- 259's blank-decision check among them -- reached the screen as "the medication
  // store is not in this deployment", which is a sentence about a DIFFERENT deployment problem and would
  // have sent somebody to look for a missing migration that is present. `notStored` carries the reason
  // and the two cases now say different things, because they ARE different things.
  if (error && isMissingTable(error))
    return { ok: true, data: { ...result, id: null, notStored: STORE_ABSENT_NOTICE } };
  if (error)
    return {
      ok: true,
      data: {
        ...result, id: null,
        notStored: `This calculation was NOT recorded. The database refused the write: ${error.message}`
          + `${error.code ? ` (${error.code})` : ""}. The working above is what you were shown, but nothing has recorded that you were shown it.`,
      },
    };
  result.id = data.id;

  // ⚠ ONE REGISTER, TWO ROADS TO IT. Prescribing on a flagged weight and prescribing with NO weight are
  // both "a clinical act that must leave a trace" in the words of the event table's own header, and MED
  // s5's register is where the trace lives. Keeping the decision out of it would have left the practice
  // override list saying "nobody has prescribed on an absent or stale weight" while somebody had.
  const registerReason = overridden ? overrideReason : result.weightDecision;
  if (registerReason && input.medicationId) {
    const { error: evErr } = await admin.from(MEDICATION_EVENT_TABLE).insert({
      workspace_id: ctx.workspaceId, medication_id: input.medicationId, patient_id: input.patientId,
      encounter_id: input.encounterId ?? null, event_type: "safety_override",
      previous: { weightState: weight.state },
      next: { calculationId: data.id, decisionRecorded: !!result.weightDecision, doseComputed: result.perDose !== null || result.dailyTotal !== null },
      reason: registerReason,
      narrative: weight.text,
      created_by: input.actorId,
    });
    if (evErr) return fail(500, "AUDIT_FAILED", `the calculation was saved without its override entry: ${evErr.message}`);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.medication.dose_calculated",
    payload: {
      calculationId: data.id, patientId: input.patientId, basis,
      weightState: weight.state, overridden,
      // ⚠ WHETHER, NOT WHAT. The decision itself is a clinical sentence and lives on the calculation and
      // on the timeline. The audit log records that one was taken, so a register can be counted off it.
      weightDecisionRecorded: !!result.weightDecision,
      checksNotRun: DEFERRED_CHECK_KEYS.length,
    },
    correlationId: input.correlationId,
  });

  return { ok: true, data: result };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MED s7 -- PATIENT-SPECIFIC MONITORING
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * MED s7: "Medication monitoring plans / Automatically activate required parameters (e.g. weight) /
 * Review intervals / Monitoring reminders / Follow-up scheduling."
 *
 * ⚠ ALL FIVE LAND IN MACHINERY THAT ALREADY EXISTS, WHICH IS WHY THERE IS NO MONITORING TABLE.
 *
 *   "Automatically activate required parameters" -> requireForSafety() in parameters.ts, whose plan row
 *      already carries trigger_source 'medication' and trigger_ref. Migration 246 built that column for
 *      this exact caller, and its own comment says so. It also honours LCP s9's hardest sentence:
 *      "Patient-level hiding of weight must not suppress a medication-triggered safety requirement" --
 *      the plan's state is NOT changed, safety_required is set beside it.
 *   "Review intervals"      -> two columns on the medication row.
 *   "Monitoring reminders"  -> DERIVED by reviewLine(). Doctrine 8.
 *   "Follow-up scheduling"  -> createFollowUp with kind 'monitoring'. Not a second scheduler.
 *
 * ⚠ THE PARAMETER ACTIVATION IS ATTEMPTED AND ITS FAILURE IS REPORTED, NOT SWALLOWED. It needs
 * parameter.configure, which a caller holding only medication.record may not have. Returning
 * `parameterActivated: false` with the reason is the honest answer -- silently skipping it would leave a
 * weight-based prescription with nothing asking for a weight, which is the failure LCP s9 is about.
 */
export async function setMedicationReview(
  admin: any, ctx: WorkspaceContext,
  input: {
    medicationId: string;
    reviewIntervalDays: number | null;
    /** Ask CPR-LCP-001 to require this parameter for safety while the medication runs. */
    requireParameterId?: string | null;
    scheduleFollowUp?: boolean;
    reason: string;
    actorId: string; correlationId: string;
  },
): Promise<EngineResult<{
  id: string; nextReviewOn: string | null;
  parameterActivated: boolean; parameterDetail: string | null;
  followUpId: string | null; followUpDetail: string | null;
}>> {
  if (!hasCapability(ctx, CAP_MED_RECORD))
    return fail(403, "FORBIDDEN", "setting a medication review needs medication.record");
  const reason = trim(input.reason);
  if (!reason) return fail(422, "VALIDATION_ERROR", "a monitoring requirement that says nothing is one nobody can review or lift");
  if (input.reviewIntervalDays !== null && (input.reviewIntervalDays < 1 || input.reviewIntervalDays > 3650))
    return fail(422, "VALIDATION_ERROR", "a review interval must be between 1 and 3650 days");

  const { data: med, error: rErr } = await admin.from(MEDICATION_TABLE)
    .select("id, patient_id, generic_name, started_on, status").eq("id", input.medicationId)
    .eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (rErr) return fail(503, "UNAVAILABLE", `the medication could not be read: ${rErr.message}`);
  if (!med) return fail(404, "NOT_FOUND", "no such medication");

  const nextReviewOn = input.reviewIntervalDays
    ? addDays(med.started_on ?? todayIso(), input.reviewIntervalDays)
    : null;

  let followUpId: string | null = null;
  let followUpDetail: string | null = null;
  if (input.scheduleFollowUp && nextReviewOn) {
    const fu = await createFollowUp(admin, {
      workspaceId: ctx.workspaceId, patientId: med.patient_id, kind: "monitoring",
      reason: `Medication review: ${med.generic_name}. ${reason}`,
      dueOn: nextReviewOn, actorId: input.actorId, correlationId: input.correlationId,
    });
    if (fu.ok) followUpId = fu.data.id;
    else followUpDetail = `the review date was saved but no follow-up was raised: ${fu.message}`;
  }

  const { error: uErr } = await admin.from(MEDICATION_TABLE).update({
    review_interval_days: input.reviewIntervalDays, next_review_on: nextReviewOn,
    review_follow_up_id: followUpId, updated_at: nowIso(), updated_by: input.actorId,
  }).eq("id", input.medicationId).eq("workspace_id", ctx.workspaceId);
  if (uErr) return fail(500, "WRITE_FAILED", `the review could not be saved: ${uErr.message}`);

  let parameterActivated = false;
  let parameterDetail: string | null = null;
  if (input.requireParameterId) {
    // Imported lazily so this module does not take parameters.ts's whole dependency chain on every read.
    const { requireForSafety } = await import("@/lib/practice/parameters");
    const r = await requireForSafety(admin, ctx, {
      patientId: med.patient_id, definitionId: input.requireParameterId,
      reason: `Required by medication: ${med.generic_name}. ${reason}`,
      triggerSource: "medication", triggerRef: input.medicationId,
      actorId: input.actorId, correlationId: input.correlationId,
    });
    parameterActivated = r.ok;
    if (!r.ok) parameterDetail = `the parameter was NOT required for safety: ${r.message}`;
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.medication.review_set",
    payload: {
      medicationId: input.medicationId, patientId: med.patient_id,
      reviewIntervalDays: input.reviewIntervalDays, nextReviewOn, parameterActivated, followUpId,
    },
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    data: { id: input.medicationId, nextReviewOn, parameterActivated, parameterDetail, followUpId, followUpDetail },
  };
}

/** Exposed so the harness can assert the vocabulary it validates against is the migration's. */
export const MEDICATION_VOCABULARY = {
  statuses: MEDICATION_STATUS_CODES,
  sources: MEDICATION_SOURCE_CODES,
  eventTypes: MEDICATION_EVENT_TYPE_CODES,
  doseBases: DOSE_BASIS_CODES,
} as const;
