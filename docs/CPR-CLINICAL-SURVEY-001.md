# CPR-CLINICAL-SURVEY-001 — pre-migration survey of four clinical specs

**Date:** 2026-08-07 · **Status:** survey only, no code written, no migration written
**Specs surveyed** (extracted from `C:\Users\elish\Downloads\`, `word/document.xml`):

| Spec | Title | Extracted length | Character |
|---|---|---|---|
| CPR-CPL-001 v1 | Clinical Parameter Library & Configurable Specialty Packs Catalogue | 16,369 chars | **Developer & Product Specification**, "Approved Concept – Development Ready", 24 sections |
| CPR-LCP-001 v1 | Configurable Longitudinal Clinical Parameters & Patient Monitoring Engine | 11,069 chars | **Developer & Product Specification**, "Approved Concept – Development Ready", 14 sections |
| CPR-MED-001 v1 | Medication Record & Medication Safety Engine | 2,513 chars | **thin outline**, 10 bulleted sections + an architecture ladder. No status block, no acceptance table, no data model beyond field names |
| CPR-PIE-001 v1 | Practice Intelligence Engine | 2,266 chars | **thin outline**, 10 bulleted sections + an architecture ladder. Same shape as MED-001 |

> ⚠ **The two document classes are not equivalent and should not be treated as such.** CPL-001 and LCP-001
> are full specifications with a Status line, a data model, permissions, acceptance criteria and phasing.
> MED-001 and PIE-001 are one-page concept outlines. Every column proposed below for MED-001 is an
> *inference from a field name*, not a stated requirement — MED-001 §2 says "Dose, units, route, frequency,
> duration" and nothing about types, nullability or units. That matters when a migration cannot be revised.

Verification method: every "already exists" claim below was checked **twice** — by grepping all 245
migration files for every mention of the table (not just its `CREATE TABLE`), and by **probing the live
database** over PostgREST with a service-role key (`select=<col>&limit=0`, read-only, no rows fetched).
Where the two disagree, the live database wins and it is said so.

---

## 0. Executive answer

- **Nothing of CPL-001 or LCP-001 exists.** Not one table, not one column, not one route. This is the
  largest genuinely-greenfield area left in `/practice`. 26 candidate table names probed live: all absent.
- **MED-001 is ~15% present** as `practice_treatment` (encounter-bound, free-text dose/route/frequency/
  duration, four lifecycle states that are not MED-001's four). It cannot be extended in place — see §2.3.
- **PIE-001 is ~55% already built** and the built thing is *better specified*. PIE-001 does **not**
  supersede `/practice/intelligence`; it **extends** it in three places and **duplicates** it in five.
  Two of its eight modules are blocked on LCP-001/MED-001 and one (§3 "Predictive reminders") collides
  with a standing doctrine. Detail in §1.4 and §6.
- **No spec of the four contains a navigation section.** All four sidebar claims come from pictures.
  Detail and quotations in §5. **Recommendation: change nothing in `navigation.ts`.**
- **The single biggest hidden dependency is a drug knowledge base.** MED-001 §4 requires max single and
  max daily dose checks; nothing in this product holds a maximum dose for any drug, no spec supplies one,
  and an empty rule table makes every check return "nothing to say", which a clinician reads as "safe".
  See §6.E and §8.

---

## 1. What already exists

### 1.1 CPR-CPL-001 — Clinical Parameter Library

**Nothing.** Probed live, all absent: `practice_parameter`, `practice_parameter_definition`,
`practice_clinical_parameter`, `practice_parameter_pack`, `practice_specialty_pack`,
`practice_parameter_value`, `practice_measurement`, `practice_observation`, `practice_vital`,
`practice_vitals`, `practice_growth_reference`.

Grep of all 245 migrations for `parameter` returns five files (035, 081, 086, 186, 224) — none in the
`practice_*` tenancy and none clinical.

**Relevant prior art (structure to copy, not to reuse):**

| Thing | Path | Why it matters |
|---|---|---|
| `practice_registration_template` + `practice_registration_field` | mig `223-practice-registration-templates.sql` | The closest existing **no-code field-definition engine**: workspace-scoped template, `field_key` regex, `field_type` enum, `options jsonb`, `condition jsonb` rules, `display_order`, `draft/published/retired` + `version`. CPL-001 §22's custom parameter builder is this shape one level deeper. |
| `practice_note_template` | mig `195` line 60 | **The platform-library pattern**: `workspace_id uuid references practice_workspace(id)` — *nullable*. A NULL workspace row is a platform-governed template; a non-NULL row is a practice's own. This is exactly LCP-001 §4's "Platform library" vs "Practitioner/practice" levels and should be reused verbatim. |
| `CALCULATORS` in `src/lib/practice/clinical-calculators.ts` | 198 lines | **BMI and BSA already compute correctly**, with named formulas, plausibility bounds and a `sentence` that carries inputs into the note. `bmi` = weight(kg)/height(m)², `bsa`, `map`, `egfr` (CKD-EPI 2021). CPL-001 §5.2's BMI and BSA do not need new arithmetic — they need a store to read from and write to. |
| `practice_configuration` | live-probed | Has **`locale`, `date_format`, `identifier_policy`, `default_encounter_mode`, `feature_flags`, `config_version`, `is_effective`** — and **no** `scope`/`key`/`value` columns. It is a single settings row per workspace, **not** a generic hierarchical config store. LCP-001 §4's five-level hierarchy cannot be built on it. |
| Setup catalogue | `src/lib/practice/setup.ts` | 17 numbered modules across 3 domains, each with `href`, `capability`, and a `specUnbuilt` flag. LCP-001 §10.1's "Clinical Parameters page" is an **18th entry here**, not a new sidebar item. |

### 1.2 CPR-LCP-001 — Configurable Longitudinal Clinical Parameters

**Nothing.** No monitoring plan table, no measurement table, no parameter alert table.

Live probe, `practice_patient`: **has** `id, workspace_id, display_name, sex, birth_date,
age_estimate_years, status, tags, custom_fields, allergy_status, allergy_reviewed_at,
allergy_reviewed_by, blood_group, given_name, family_name, preferred_language, record_version,
preferred_contact_method, practice_note, merged_into_patient_id`.
**Missing:** `weight_kg`, `height_cm` — there is no weight or height anywhere in the product.
A tree-wide grep for `weight_kg|height_cm|\bbmi\b|body_surface` across all 245 migrations returns **zero
files**.

The one piece of LCP-001 that *is* already built is the follow-up rail it will hang reminders on:
`practice_follow_up.kind` already accepts `'monitoring'` (mig 196), and `practice_follow_up_plan`
(mig 206) already models a multi-step schedule with `starts_on` + offsets. LCP-001 §7.1's schedules and
MED-001 §7's "review intervals" should **emit into these**, not build a parallel scheduler.

### 1.3 CPR-MED-001 — Medication Record & Safety

Partially present, and the part that is present is deliberately limited.

`practice_treatment` (mig `194-practice-encounters.sql`, live-verified columns):

```
id, workspace_id, encounter_id (NOT NULL), patient_id, diagnosis_id,
treatment_type  check in ('medication','procedure','investigation','advice','referral','monitoring'),
label, dose, route, frequency, duration, notes,
status          check in ('planned','in_progress','completed','cancelled'),
created_at, created_by, search_vector
```

Amended exactly once since: mig `199-practice-search.sql` added `search_vector`. Nothing else.
Live probe confirms **absent**: `generic_name, brand_name, strength, formulation, indication,
start_date, stop_date, prescriber, source, units, reason_for_change, dose_basis`.

Its own header states the boundary: *"Medication intention (DM-001 s10 MedicationPlan). NOT an
administration chart: ADR-01 keeps this a record of what the practitioner decided, not what a ward gave."*

There is a **Medications block already rendering** in the patient workspace, and it is fronted by three
constants in `src/lib/practice/patient-workspace-constants.ts` that MED-001 directly overturns —
`REFUSES.current_medications`, `MEDICATION_BOUNDARY`, `MEDICATION_NOT_CURRENT_REASON`. See §6.B.

Absent live: `practice_medication`, `practice_medication_record`, `practice_prescription`,
`practice_medication_event`, `practice_medication_warning`, `practice_dose_calculation`,
`practice_medication_monitoring`, `practice_adverse_reaction`.

`clinical-calculators.ts` has a standing refusal that MED-001 §3 contradicts head-on — quoted in §6.E.

### 1.4 CPR-PIE-001 — Practice Intelligence Engine ⚠ HEAVY OVERLAP

**`/practice/intelligence` is built, live, and covers more than half of PIE-001.**

| Artefact | Path | Size |
|---|---|---|
| Engine | `src/lib/practice/intelligence.ts` | **3,168 lines** |
| Client-safe constants | `src/lib/practice/intelligence-constants.ts` | 292 lines |
| The one page (nine `?tab=` areas, no nested routes) | `src/app/practice/(shell)/intelligence/page.tsx` | — |
| Tab bodies | `.../intelligence/Areas.tsx` | 37.7 KB |
| Assistant area, priority strip, range picker, trend chart, shared UI | `.../intelligence/{AssistantArea,PriorityStrip,RangePicker,Trend,Ui,Parts,AskField}.tsx` | — |
| API | `src/app/api/v1/practice/intelligence/route.ts` (GET, gated `report.view`) | — |
| Harnesses | `scripts/practice-intelligence-harness.ts` (31 assertions) · `scripts/practice-intelligence-suite-harness.ts` (64 assertions) | 95 total |

Tabs, in spec order: `overview · brief · patients · cohorts · clinical · pathways · performance ·
reports · assistant`.

**PIE-001 §3's eight modules against what is built:**

| PIE-001 §3 module | Status | Where |
|---|---|---|
| Patient longitudinal trends | **partial** — `patientAttentionIntelligence` gives overdue/inactive/lost-to-follow-up (date arithmetic). Trajectory refused. | `intelligence.ts` |
| Medication review | **absent** — blocked on MED-001 | — |
| Follow-up intelligence | **built** | `intelligence.ts` follow-up module + `overdue_followups` tile |
| Growth and anthropometric trends | **absent** — blocked on LCP-001. ⚠ **Name collision**: the built `practice_growth` module is *business* growth (new patients, workload), not a child's growth chart. | `intelligence.ts:1783` |
| Vital sign surveillance | **absent** — blocked on LCP-001 | — |
| Practice workload insights | **built** | clinical-activity + location modules |
| Population/cohort analytics | **built** — `cohortIntelligence`, 7 dimensions (diagnosis, procedure, treatment, sex, age_band, location, pathway) | `intelligence.ts` |
| Predictive reminders | **absent, and contested** — see §6.I | — |

**PIE-001 §5's seven practice items:** clinic utilisation ✅ · appointment patterns ✅ · no-show analysis
⚠ (`no_show` metric exists in `metrics.ts`; "analysis" as a *rate* is forbidden — §6.D) · follow-up
completion ⚠ (same) · referral trends ❌ (`practice_referral` exists since mig 238 but no intelligence
module reads it — **a genuinely cheap win**) · common diagnoses ✅ · medication utilisation ❌.

**PIE-001 §6's AI Assistant:** the built `aiPracticeIntelligence()` is **grounding-only by design**
(`groundingOnly: true`, calls no model, emits `authorisedFigures` + `refusedClaims`). The model-calling
route is separate: `src/app/api/v1/practice/assistant/route.ts` + `src/lib/practice/ai-assistant.ts`.
PIE-001 §6's six generative asks (summarise, explain, visit summaries, suggest parameters, highlight
missing info, draft education material) belong in **the assistant**, not the intelligence engine.
Building them in `intelligence.ts` would put a model call on the dashboard's critical path — which §12 of
the earlier spec forbids and the current code deliberately avoids.

**Verdict: PIE-001 EXTENDS, it does not supersede.** Concretely —
- **Duplicates (build nothing):** §1 vision, §3 workload, §3 cohorts, §3 follow-up intelligence, §5
  utilisation/appointments/diagnoses, §8 explainability (already stricter — every figure carries
  `Provenance`), §10 acceptance criteria 1/2/4.
- **Extends (new work, small):** §5 referral trends, §7 configurable thresholds (needs a store —
  currently *every alert is transient*, there is no alert table and no acknowledgement), §4 preventive
  care and document review reminders.
- **Blocked (do last):** §3 medication review, §3 growth trends, §3 vital surveillance, §4 parameter
  deterioration, §5 medication utilisation.
- **Contested:** §3 predictive reminders, §7's four-level severity, "no-show analysis" as a rate.

⚠ `docs/CPR-PI-001*` **does not exist in this repo.** The prior spec was supplied out-of-band. Its §4 is
recoverable only as a quotation embedded verbatim in three source files — quoted in §5 below.

---

## 2. What is genuinely missing

Types follow this codebase's house style: `uuid` keys with `gen_random_uuid()`, `workspace_id` tenancy,
`timestamptz`, `text` + `check ... in (...)` instead of PG enums, `numeric` for measurements,
ASCII-only, **no plpgsql, no do-blocks, and no semicolon anywhere except at the end of a statement**
(the runner splits on `;`).

### 2.1 CPL-001 + LCP-001 — one migration (see §3 for why they cannot be split)

| # | Table | Key columns (type) | Demanded by |
|---|---|---|---|
| 1 | `practice_parameter_definition` | `workspace_id uuid **NULL**` (NULL = platform library — copy `practice_note_template`), `code text` (`^[a-z][a-z0-9_]{1,60}$`), `display_name`, `short_name`, `synonyms text[]`, `category text` ∈ (anthropometric, vital_sign, specialty, score, calculated, custom), `data_type text` ∈ (decimal, integer, boolean, date, text, single_choice, multi_choice, calculated), `canonical_unit text`, `permitted_units text[]`, `unit_conversions jsonb`, `options jsonb`, `precision integer`, `min_plausible numeric`, `max_plausible numeric`, `applicability jsonb`, `default_collection_rule text` ∈ (first_visit, every_visit, every_follow_up, scheduled, annual, on_request, conditionally_required), `presentation jsonb`, `formula text`, `risk_class text` ∈ (low, moderate, high, licensed), `licence_required boolean`, `licence_reference text`, `source/owner/version/effective_from/review_on`, `status text` ∈ (draft, active, retired), `cloned_from_id uuid` self-ref | LCP §6 (every row of the field table), LCP §12, CPL §22, **CPL §23** (`risk_class`), **CPL §2** (`licence_*`) |
| 2 | `practice_parameter_definition_version` | `definition_id`, `version integer`, `snapshot jsonb NOT NULL`, `effective_from timestamptz`, `created_by` | LCP §3 "No silent rewriting … parameter definitions remain versioned"; LCP §11 "All calculations and alerts store the parameter-definition and rule versions used"; CPL §22 |
| 3 | `practice_parameter_pack` | `workspace_id uuid NULL`, `code`, `name`, `specialty`, `description`, `status text` ∈ (draft, published, retired), `version integer`, `cloned_from_id` | CPL §1, §2, §24 |
| 4 | `practice_parameter_pack_item` | `pack_id`, `definition_id`, `local_label text`, `collection_rule text`, `position integer`, `enabled boolean` | CPL §2 "Every parameter can be individually enabled, disabled, renamed locally or assigned a different frequency" |
| 5 | `practice_parameter_activation` | `workspace_id NOT NULL`, `definition_id`, `pack_id NULL`, `scope text` ∈ (practice, clinic, session), `scope_id uuid NOT NULL default '00000000-…-0000'::uuid`, `state text` ∈ (active, inactive), `collection_rule`, `local_label`, `visibility`, `threshold_override jsonb` | LCP §4 rows 2–3 |
| 6 | `practice_patient_monitoring_plan` | `patient_id`, `definition_id`, `state text` ∈ **(inherited, active, required, optional, paused, resolved, hidden, conditionally_required)** ← LCP §7's eight verbatim, `schedule text` ∈ **(every_encounter, first_visit_only, every_follow_up, daily, weekly, monthly, quarterly, six_monthly, annually, next_visit, until_date, for_n_encounters, until_resolved, on_request)** ← LCP §7.1's fourteen verbatim, `until_date date`, `encounters_remaining integer`, `paused_until date`, `target_low/target_high numeric`, `baseline_value numeric`, `change_rule jsonb`, `next_due_on date`, `last_measured_at timestamptz`, `trigger_source text` ∈ (practitioner, medication, diagnosis, protocol), `trigger_ref uuid`, `reason text` | LCP §7, §7.1 |
| 7 | `practice_patient_monitoring_plan_event` | `plan_id`, `patient_id`, `change text`, `previous jsonb`, `next jsonb`, `reason text`, `actor uuid`, `occurred_at timestamptz` | LCP §11 "Patient-specific configuration changes record user, date, previous value, new value and reason" |
| 8 | `practice_parameter_measurement` | `patient_id`, `definition_id`, `definition_version_id`, `encounter_id **NULL**` (LCP §3: measurements belong to the patient, not the encounter), `value_numeric numeric`, `value_text`, `value_boolean`, `value_date`, `value_choice text[]`, `unit text NOT NULL`, `canonical_value numeric`, `canonical_unit text`, `method text`, `source text` ∈ **(practitioner, team, patient_reported, imported, device)** ← LCP §12's five verbatim, `effective_at timestamptz NOT NULL`, `recorded_at timestamptz NOT NULL`, `note text`, `status text` ∈ (active, amended, entered_in_error), `amends_measurement_id uuid` self-ref, `amendment_reason text`, `created_by` | LCP §8, §12 |
| 9 | `practice_parameter_derived` | `patient_id`, `definition_id`, `value numeric`, `unit text`, `formula text NOT NULL`, `source_measurement_ids uuid[] NOT NULL`, `calculated_at timestamptz NOT NULL`, `definition_version_id` | LCP §5.2, §13 "Derived values display their source measurements and calculation timestamp", §9 "the medication record must preserve the exact value and timestamp used" |
| 10 | `practice_parameter_alert` | `patient_id`, `definition_id`, `measurement_id NULL`, `alert_type text` ∈ **(reference_range, patient_target, change_from_baseline, percentage_change, rate_of_change, missing_overdue, trend_deviation)** ← LCP §7.2's seven verbatim, `severity text` ⚠ see §6.A, `rationale text NOT NULL`, `recommended_action text`, `rule_version text`, `status text` ∈ (open, acknowledged, actioned, overridden), `acknowledged_at/by`, `override_reason text` | LCP §7.2, §8 step 7–8, §11 |

**Decisions the migration author must make before writing (each has a wrong-by-default answer):**
- **#5 unique constraint.** `unique (workspace_id, definition_id, scope, scope_id)` only works if
  `scope_id` is NOT NULL — a NULL in a unique constraint permits duplicates. Hence the zero-UUID
  sentinel above. ⚠ This is the **partial-index upsert trap** already recorded in memory: a partial
  unique index cannot be an `on conflict` target, and the resulting error is silently discarded by
  fail-soft callers.
- **#9 persist vs compute-on-read.** LCP §13 demands the calculation *timestamp* be displayed and §9
  demands the medication record preserve the exact value used. Both point at persisting. Recommend
  persisting; note that this makes derived values a second write on every measurement.
- **Table #10 severity** — do not write the check constraint until §6.A is decided.
- **Growth percentiles (CPL §5.2) cannot be built from these specs.** Percentiles and z-scores require a
  named LMS reference population (WHO 2006 / CDC 2000). No such table exists (`practice_growth_reference`
  probed: absent), neither spec supplies one, and a percentile computed against an unnamed population is a
  fabricated clinical figure. **Do not add a `percentile` column** in this migration.

### 2.2 MED-001 — second migration

| # | Table | Key columns | Demanded by |
|---|---|---|---|
| 11 | `practice_medication` | `patient_id`, `encounter_id uuid **NULL**`, `treatment_id uuid` → `practice_treatment` (the encounter decision that started it), `generic_name text NOT NULL`, `brand_name`, `formulation`, `strength_value numeric`, `strength_unit`, `dose_value numeric`, `dose_unit`, `dose_text`, `route`, `frequency`, `frequency_per_day numeric`, `duration_text`, `duration_days integer`, `indication`, `started_on date`, `stopped_on date`, `prescriber text`, `recorded_source text` ∈ (practitioner, patient_reported, imported), `verified_at/verified_by`, `status text` ∈ **(active, completed, paused, discontinued)** ← MED §2's four verbatim, `discontinued_reason` | MED §2 |
| 12 | `practice_medication_event` | `medication_id`, `patient_id`, `encounter_id NULL`, `event_type text` ∈ (started, dose_changed, paused, resumed, discontinued, completed, adverse_reaction, adherence_note, effectiveness_note), `previous jsonb`, `next jsonb`, `reason text`, `narrative text`, `occurred_on date`, `created_by` — **append-only** | MED §6, MED §10 "Historical data never overwritten" |
| 13 | `practice_medication_dose_calculation` | `medication_id`, `patient_id`, `basis text` ∈ **(mg_per_kg, mg_per_kg_per_day, mg_per_m2, fixed)** ← MED §3's four, `weight_kg numeric`, `weight_measurement_id uuid` → `practice_parameter_measurement`, `weight_effective_at timestamptz`, `bsa_m2 numeric`, `bsa_derived_id uuid`, `height_cm numeric`, `height_measurement_id uuid`, `calculated_dose numeric`, `calculated_unit`, `formula text NOT NULL`, `working text NOT NULL`, `calculated_at`, `calculated_by` — **immutable, no `updated_at`, no update path** | MED §3; LCP §9 "the medication record must preserve the exact value and timestamp used for each calculation" and "A later weight update must not recalculate or rewrite a historical prescription" |
| 14 | `practice_medication_warning` | `medication_id`, `patient_id`, `calculation_id NULL`, `check_type text` ∈ (underdose, overdose, max_single_dose, max_daily_dose, age_validation, weight_missing, weight_stale, weight_implausible, duplicate_therapy, allergy, renal_adjustment, hepatic_adjustment, interaction), `severity text` ∈ **(informational, advisory, significant, critical)** ← MED §5's four verbatim, `message text NOT NULL`, `evidence jsonb`, `rule_id`, `rule_version`, `outcome text` ∈ (raised, accepted, overridden), `override_reason text`, `overridden_at/by` | MED §4, §5 |
| 15 | `practice_medication_rule` | `workspace_id uuid NULL` (platform), `generic_name text NOT NULL`, `age_min_months/age_max_months integer`, `weight_min_kg/weight_max_kg numeric`, `route`, `indication`, `dose_basis`, `dose_min/dose_max numeric`, `dose_unit`, **`max_single_dose numeric`, `max_daily_dose numeric`, `max_dose_unit`**, `evidence_source text NOT NULL`, `evidence_url`, `version integer`, `effective_from date`, `status text` ∈ (draft, active, retired) | MED §4 "Maximum single and daily dose checks"; MED §10 "Version-controlled medication knowledge / Evidence source management" |
| 16 | `practice_medication_monitoring` | `medication_id`, `patient_id`, `definition_id` → `practice_parameter_definition`, `review_interval_days integer`, `next_review_on date`, `follow_up_id uuid` → `practice_follow_up` | MED §7 |

**Not proposed, deliberately:**
- **No `weight_kg`/`height_cm` on `practice_patient`.** A current-weight column is precisely the "silent
  rewriting" LCP §3 forbids and would make LCP §9's "stale weight" warning uncomputable. Weight is a
  measurement series.
- **No columns added to `practice_treatment`.** Two reasons. (a) `practice_treatment.encounter_id` is
  `NOT NULL`; a patient-reported medication has no encounter, so the table structurally cannot hold one.
  (b) Migration 238's own rule: adding columns for something that has a store "would have produced a
  second place to write the same sentence, which CPR-ENC-002 s9's *no duplicate data entry* forbids".
  `practice_medication.treatment_id` links the two instead.

### 2.3 PIE-001

**No new tables required for §§1–6 and §§8–10.** Two candidates only:

- **§7 "Configurable thresholds / Patient-specific rules"** — LCP-001 tables #6 and #10 already provide
  this. Build nothing extra.
- **Alert persistence.** Today *every* alert is transient: severity exists only as a field on a
  `PriorityTile` (`intelligence.ts:2813`) and a `BriefItem` (`brief.ts:58`), computed per request. PIE-001
  §10 "Maintains complete audit trail" implies persistence. If the user wants acknowledgeable alerts,
  `practice_parameter_alert` (#10) covers the clinical half and a small `practice_practice_alert` would
  be needed for the operational half. **Recommend deferring** until someone asks to acknowledge one.

**Event types:** `practice_domain_event.event_type` already accepts `'alert.created'` and
`'alert.resolved'` — no constraint change needed for alerts. It does **not** accept anything medication-
shaped. ⚠ If medication events must be emitted, the check constraint must be dropped and re-added **and**
`PRACTICE_EVENT_TYPES` in `src/lib/practice/events.ts` updated in the same change — mig 233's own comment
warns that a name present in TypeScript and absent from the constraint "does not fail loudly — it fails on
every emit, forever, in a swallowed error."

---

## 3. Dependency order — confirmed, with one correction

**The user's reading is correct at the layer level and inverted at the schema level.**

Confirmed from the specs' own text:

- **LCP → MED.** MED-001 §1 scope, last line: *"Integration with Longitudinal Clinical Parameters
  (CPR-LCP-001) and Clinical Parameter Library (CPR-CPL-001)."* MED-001's architecture ladder is explicit:
  `Patient Identity → Longitudinal Clinical Parameters → Medication Record → Dose Calculation →
  Medication Safety → Clinical Decision Support → Longitudinal Medication History → Practice Intelligence`.
  And from the other side, LCP-001 §9: *"The parameter engine provides the trusted patient data needed by
  the medication-dose safety capability."*
- **(LCP, CPL, MED) → PIE.** PIE-001 §2 "Data Sources" lists, in order: *"Longitudinal Clinical Parameters
  (CPR-LCP-001) · Clinical Parameter Library (CPR-CPL-001) · Medication Record & Safety Engine
  (CPR-MED-001) · Patient Workspace · Encounter Workspace · Follow-up Workspace · Documents · Calendar and
  Booking."* Confirmed.

⚠ **The correction — CPL is not the schema supply layer, LCP is.**

- LCP-001 **§6 "Parameter Definition Model"** is the only place in the four documents that states the
  fields of a parameter. CPL-001 never does.
- LCP-001 **§4 "Configuration Hierarchy"** owns the platform-library level itself: *"Platform library |
  Defines available parameter definitions and governed templates."* The library is a *tier inside LCP's
  hierarchy*, not a system above it.
- LCP-001 **§2.1 "Included"** claims packs as its own scope: *"Curated specialty parameter packs and
  custom parameters."*
- CPL-001 **§1** describes itself as content: *"This catalogue defines the initial governed library of
  optional specialty parameters and reusable parameter packs… It is a **design catalogue, not a mandate**
  to collect all listed data."*

So: **LCP-001 is the engine and the schema; CPL-001 is the content loaded into it, plus two columns
(`risk_class` from §23, `licence_required` from §2) and the builder requirements of §22.**

**Practical consequence for the migration:** CPL-001's pack table foreign-keys LCP-001's definition table,
and CPL-001's `risk_class` is a column *on* LCP-001's definition table. **They must be one migration
file.** Splitting them means either a forward-reference or a second migration that ALTERs a table written
minutes earlier — the exact pattern that produced the 231/240 duplication.

**Final order:**

```
1.  LCP-001 + CPL-001   (one migration, one lib module, one harness)
2.  MED-001             (a second migration; the record half can start early, the dose/safety half cannot)
3.  PIE-001             (last for the clinical modules; its non-clinical half can go any time — see §4)
```

---

## 4. Concurrency — what can run in parallel, by file

### Cannot run concurrently

| Pair | Shared files |
|---|---|
| **LCP-001 ∥ CPL-001** | Same migration file, same `src/lib/practice/parameters.ts` (new), same setup entry, same harness. **Treat as one workstream.** |
| **LCP-001 ∥ MED-001** | `src/lib/practice/patient-workspace.ts` (LCP §10.2 Monitoring Plan panel; MED §8 medication block) · `src/lib/practice/patient-workspace-constants.ts` (MED rewrites `REFUSES` / `MEDICATION_BOUNDARY`; LCP adds a monitoring refusal) · `src/app/practice/(shell)/patients/[patientId]/page.tsx` · `src/lib/practice/encounter-workspace-constants.ts` (LCP §10.3 parameter capture; MED's treatment tab) · `src/app/practice/(shell)/encounters/[encounterId]/EncounterConsole.tsx` |
| **MED-001 dose engine ∥ LCP-001** | Hard data dependency, not just a file clash: the calculator reads `practice_parameter_measurement`, which LCP creates. |

### Can run concurrently

| Workstream | Files it owns exclusively |
|---|---|
| **PIE-001 non-clinical half** — §5 referral trends, §5 medication-free practice items, §8 explainability tightening, §10 acceptance | `src/lib/practice/intelligence.ts` · `src/lib/practice/intelligence-constants.ts` · `src/app/practice/(shell)/intelligence/*` · `src/app/api/v1/practice/intelligence/route.ts` · `scripts/practice-intelligence-suite-harness.ts`. **Zero overlap** with any file the other three touch. |
| **CPL-001 catalogue authoring** — turning §§3–21's ~450 candidate parameters into seed rows | A data file (`src/lib/practice/parameter-catalogue.ts` or seed SQL). Pure content; can be drafted while the schema is being written, then applied once the tables exist. |
| **MED-001 §15 rule sourcing** — finding an evidence base for max doses | No code at all. This is research and should start **now**, because it gates §4 (see §8). |

### Files that are off-limits right now (other agents live)

`src/lib/practice/documents-workspace.ts` · `src/app/practice/(shell)/documents/**` ·
`src/app/api/v1/practice/documents/**` · `booking-rules.ts` · `booking-rule-constants.ts` ·
`scripts/practice-booking-rules-harness.ts` · `navigation.ts` · `palette.ts` · `supabase/migrations/**`.

⚠ **`palette.ts` is on that list and both LCP and MED need it.** `palette.ts` owns `SEVERITY`,
`PRIORITY_SWATCH` and `TAB_SWATCH`; a four-level clinical severity needs swatches there. **Queue any
palette work behind the live agent** rather than adding a second colour map elsewhere.

---

## 5. ⚠ NAVIGATION — what the four specs' TEXT actually says

### 5.1 The finding, first

**None of the four specifications contains a navigation section, a sidebar section, a menu section, or
any sentence proposing a change to the global navigation.** I grepped all four extracted texts for
`sidebar · navigat · menu · tab · primary · section · home dashboard · reports · tasks`. Full results:

- **CPR-CPL-001** — seven hits, every one a clinical parameter name ("developmental screening score",
  "foot screening", "cervical-screening status"). The single hit that names a surface is **§24**:
  > "Patient-specific activation can be performed from the Patient Workspace."
  Nothing else. No navigation language anywhere in 16,369 characters.

- **CPR-LCP-001** — §10 is titled **"User Interface Requirements"** and names three surfaces as
  sub-headings, all of which already exist:
  > **10.1 Practice Setup** — "Clinical Parameters page / Activate/deactivate core parameters / Install
  > specialty packs / Create or clone custom parameters / Set default collection frequency and visibility
  > / Configure roles permitted to change parameters"
  > **10.2 Patient Workspace** — "Monitoring Plan panel / Current values and last measurement dates / Due
  > and overdue parameters / Trend summaries and alerts / Customise for this patient action / Restore
  > inherited defaults action / Parameter history and configuration audit trail"
  > **10.3 Encounter Workspace** — "Only due, required and contextually relevant parameters shown first /
  > Optional parameters accessible without clutter / One-click carry-forward is prohibited for measured
  > values / Clear distinction between measured, patient-reported, imported and calculated values"

  The only other surface reference is §6's Presentation field: *"Form location, graph, table, patient
  header, dashboard or reports."* That describes where a **parameter value** renders, not a nav item.
  **LCP-001 asks for a page under Practice Setup and two panels inside existing workspaces. It asks for
  no sidebar item.**

- **CPR-MED-001** — §8 is titled **"Integrations"** and is a bare list:
  > "Patient Workspace / Encounter Workspace / Follow-up Workspace / Documents / Practice Intelligence /
  > Longitudinal Record Engine / Clinical Parameter Engine."

  Six of those seven are **engines and workspaces that already exist**. The word "sidebar" does not appear
  in the document. Neither does "Medications" as a navigation item. **§8 is a list of things the engine
  reads from and writes to, not a list of menu entries.**

- **CPR-PIE-001** — §9 is titled **"Integrations"**, same shape:
  > "Home Dashboard / Patient Workspace / Encounters / Follow-ups / Medication Engine / Calendar /
  > Reports."

  "Reports" here names the existing reports module (already a **child of** `/practice/intelligence`).
  "Medication Engine" names MED-001, an engine. No sidebar language in the document.

### 5.2 The comparative evidence that this is deliberate

Specs in this family **do** carry an explicit navigation section when they intend one. `CPR-FUP-001 v1.0`
(also extracted in this session) has a numbered **§3 titled "Sidebar"** whose entire body is:

> "Use a single 'Follow-ups' workspace in the global sidebar. Remove any Follow-ups submenus. Internal
> views are implemented as tabs and filters within the workspace."

— and it repeats the point in its acceptance criteria ("✓ Flat sidebar navigation"). **None of the four
specs surveyed here has such a section.** The absence is not an oversight in a house style that has a
convention for it; it is the convention being followed.

### 5.3 What the pictures show, and why it is not a decision

Both the MED-001 and PIE-001 comps draw a sidebar containing **Medications**; MED-001's additionally
draws **Tasks**, **AI Assistant** and **Reports**. Those three were removed from the primary list by
CPR-V5-002 and CPR-PI-001, with reasons recorded in `navigation.ts`:

> "Tasks, Analytics and Patient Insights are REMOVED FROM PRIMARY — 'supporting information should not
> become top-level navigation'." … "REMOVED IS NOT DELETED. The spec is explicit that the three 'remain
> available contextually'."

and, for the Assistant, CPR-PI-001 §15's first acceptance criterion: *"the separate Practice Assistant
sidebar item is removed."*

**So MED-001's picture is not proposing a tenth item; it is drawing a sidebar from before two written
decisions.** Adopting it would be a roll back of both — which the user has twice ruled out — and would do
so on the authority of an unlabelled image inside a two-page outline that says nothing about navigation
in its text.

### 5.4 The current state, exactly

`src/lib/practice/navigation.ts` — `PRIMARY_ORDER`, **nine items, one flat unlabelled section**:

```
/practice/home · /practice/today · /practice/calendar · /practice/patients ·
/practice/encounters · /practice/documents · /practice/follow-ups ·
/practice/intelligence · /practice/setup
```

`SIDEBAR_SECTIONS = [{ label: "", hrefs: PRIMARY_ORDER }]` — one section, empty label.

The file carries its own freeze notice:

> "⚠ THIS IS THE THIRD NAVIGATION IN THIS FILE AND THE LAST. V3-002 named nine, V5-001 named eight, and
> V5-002 is the DESIGN FREEZE: 'no further structural navigation changes should be made unless validated
> by practitioner usability testing'."

Pinned by **94 assertions** in `scripts/practice-current-activity-harness.ts`, of which **16 are the
navigation block** (§9): `9a, 9b, 9b-order, 9c, 9d-control, 9e-control, 9f, 9f-b, 9f-b-control, 9g,
9g-b, 9h, 9h-b, 9i, 9i-control` (+ setup-adjacent 11-setup, 12a-setup). `9b` asserts the count is exactly
nine. `9b-order` asserts the exact array, written out in full — its own comment: *"A list assertion updated
to match whatever the code now does is not an assertion, it is a transcript."*

### 5.5 The mechanism a new page uses instead

Assertion **9i** requires that *every* built page under `src/app/practice/(shell)/` either has a
`PRACTICE_NAV` entry or an explicit allowlist entry with a written reason:

```ts
const NO_NAV_ENTRY_BY_DESIGN: Record<string, string> = {
  pathways: "CPR-PI-001 s4: nine primary items, no submenus. Linked from Follow-ups and Intelligence.",
};
```

**That is the precedent to follow.** `/practice/pathways` is a whole shipped workspace with no sidebar
item, reached from the two screens that own it.

### 5.6 Recommendation

**Change nothing in `navigation.ts`.** The list stays at nine. Specifically:

| Surface | Where it goes | Authority |
|---|---|---|
| Clinical Parameters configuration | An **18th module in `src/lib/practice/setup.ts`**, reached from `/practice/setup` | LCP §10.1 "Practice Setup / Clinical Parameters page" |
| Monitoring Plan panel | A panel inside `/practice/patients/[patientId]` | LCP §10.2 "Patient Workspace" |
| Parameter capture | A section inside the encounter console | LCP §10.3 "Encounter Workspace" |
| Medications | A **panel in the patient workspace** (where the medication block already renders) and a **tab in the encounter workspace** (`ENCOUNTER_TABS` already has `treatment`) | MED §8's seven integration surfaces, all of which already exist |
| Medication timeline | Part of the patient workspace longitudinal view | MED §6 |
| Intelligence modules | New `?tab=` areas or panels inside `/practice/intelligence` | PIE §9; and CPR-PI-001 §4, quoted verbatim in three source files: *"Practice Intelligence may use internal tabs, but these must not create expandable global sidebar submenus."* |

If a standalone `/practice/medications` page turns out to be needed for the timeline, it should ship as a
`NO_NAV_ENTRY_BY_DESIGN` route linked from the patient workspace — the `/practice/pathways` pattern —
**not** as a tenth primary item.

This is consistent with the tenth-item decision already taken separately: **Knowledge Studio goes under
Documents, not into the primary list.** These four specs give no stronger case than that one did.

---

## 6. Contradictions with things already built

Newer documents win, but each of these overwrites something with a written reason behind it.

### A. ⚠ Three severity taxonomies, and the two new specs disagree with each other

| Source | Levels |
|---|---|
| **Built** — `intelligence.ts:2813`, `brief.ts:58`, `operations-home.ts:44`, `palette.ts` `SEVERITY` | `critical` · `warning` · `normal` (**three**) |
| **MED-001 §5** | "Informational / Advisory / **Significant** / Critical" (**four**) |
| **PIE-001 §7** | "Informational / Advisory / **Action required** / Critical" (**four**) |

MED-001 and PIE-001 name four levels each and **disagree on the third**. There is no basis in either
document for choosing between "Significant" and "Action required".

Separately, `practice_procedure_outcome.severity` and `practice_patient_allergy.severity`
(`mild/moderate/severe/anaphylaxis`) are domain scales that must not be folded in.

**Recommendation (user's call):** keep them apart rather than unify. The built three-level scale is
*operational* ("this tile needs your attention today"); MED §5's four are *clinical warning* severities on
one prescribing decision. They measure different things and a single enum would force one to lie. Use
MED §5's four verbatim on `practice_medication_warning`, use them again on `practice_parameter_alert`, and
leave `PriorityTile.severity` alone. **But this is a decision, and PIE §7's third level must be resolved
to "Significant" or the two engines will disagree in the same payload.**

### B. "Current medications" — MED-001 overturns a documented refusal

`src/lib/practice/patient-workspace-constants.ts` currently carries `REFUSES.current_medications`:

> "CPR-V5-006's longitudinal record lists 'Current medications'. It cannot be built… `practice_treatment.
> duration` is FREE TEXT — '5 days', 'until review', '1/12'. There is no end date and none is computable,
> so a course decided in March cannot be known to have ended. There is also no stop event, no
> reconciliation, no other prescriber and no adherence. 'Current' is therefore not derivable at all, not
> merely unreliable."

plus `MEDICATION_BOUNDARY` and `MEDICATION_NOT_CURRENT_REASON`, both rendered on screen.

MED-001 §2 supplies `start/stop dates` and an `active/completed/paused/discontinued` status, which makes
"current" derivable **for `practice_medication` rows only**. ⚠ The refusal remains true for
`practice_treatment` rows, and the practice will hold both for a long time. **Rewrite these three
constants, do not delete them** — the honest post-MED sentence is "current as recorded here; medications
decided before this engine shipped, and anything prescribed elsewhere, are not in this list."

### C. "Improving / Deteriorating" — LCP-001 lifts two of three refusals (an unlock, not an override)

`intelligence-constants.ts` `REFUSED_PATIENT_STATES` refuses three of CPR-PI-001 §5's seven patient
states, each naming its own precondition. For `improving`:

> "Nothing in this product records a clinical trajectory. There is no observation series, no severity
> scale and no staging… **wouldRequire:** A recorded trajectory — either a clinician-stated impression per
> encounter, or a repeated structured measurement with a direction agreed in advance. Neither exists and
> neither is specified in CPR-PI-001 or CPR-PI-002."

**LCP-001 is exactly "a repeated structured measurement with a direction agreed in advance"** — §7.2's
change-from-baseline, rate-of-change and trend-deviation alerts *are* the agreed direction. So LCP-001 +
PIE-001 §4 ("Abnormal trends / Parameter deterioration") legitimately lift `improving` and
`deteriorating` **for parameters that have a monitoring plan with a stated direction** — and for no
others. `high_complexity` stays refused (still no severity weighting on the problem list).

⚠ The failure mode the refusal warns about survives the unlock: *"A patient who stopped attending because
they got worse and went elsewhere is the exact case that proxy calls Improving."* A trend must be computed
from measurements, never from attendance.

### D. The no-rates doctrine vs percentage language in three of the four specs

CPR-270 doctrine 3 (`intelligence.ts:421`): *"COUNTS AND DENOMINATORS, NOT RATES. A percentage is where a
small number hides… No field below holds a percentage."* It is **enforced**, not just documented, by
`findRates()` (`intelligence-constants.ts:175`) which walks a payload and fires on rate-shaped **field
names** (even when the value is null) and on percentage **literals in strings**.

Colliding text: LCP §5.2 "Weight change and **percentage change**" · LCP §7.2 "**Percentage-change**
alert" · CPL §3 "weight loss **percentage**" · CPL §8 "time in range" · CPL §17 "body surface area
affected" · PIE §5 "No-show **analysis**" and "Follow-up **completion**".

**These are two different things.** A clinical percentage about one patient ("weight down 8% since
January") is not the statistic the doctrine forbids — the doctrine's own stated reason is *"a practice
with nine follow-ups"*, i.e. a small denominator across a cohort. **Recommendation:** the clinical
percentages are fine and should be built; PIE §5's no-show and completion figures must stay as
`IntelProportion` (numerator + denominator, no `rate` field). ⚠ If a monitoring payload is ever merged
into the intelligence payload, `findRates` will fire on `percentChange` — either keep them in separate
payloads or add explicit `RATE_KEY_EXEMPT` entries. Small, decidable, and cheaper to settle now.

### E. ⚠ "NO DOSING CALCULATORS" — the sharpest contradiction in the set

`src/lib/practice/clinical-calculators.ts`, lines 15–19, verbatim:

> "**NO DOSING CALCULATORS. Not an oversight and not a scope cut.** A calculator that computes a dose is
> one where an error is directly a harm, and getting it right needs a drug database, a route, a renal
> adjustment and an indication — none of which this product has. Every calculator here is ARITHMETIC ON
> NUMBERS THE USER TYPED, with a published formula named in the code."

MED-001 §3 requires precisely this calculator. **MED-001 wins as the newer document — but it does not
supply the drug database whose absence was the stated reason.** MED-001 §10 says "Version-controlled
medication knowledge / Evidence source management" and stops there; it names no source, no vocabulary and
no licence. See §8.

Note what is *not* in conflict: MED-001 §3 mg/kg and mg/m² arithmetic over a weight the engine can cite
is defensible on its own — that is arithmetic on a recorded number, in the spirit of the existing file.
It is §4's **max single and daily dose checks** that need the database.

### F. `practice_treatment`'s and mig 238's boundaries

`practice_treatment`: *"NOT an administration chart: ADR-01 keeps this a record of what the practitioner
decided, not what a ward gave."* Mig 238 §3: *"⚠ THIS IS NOT AN ORDER SYSTEM AND MUST NOT BECOME ONE."*

MED-001 does **not** ask for either — no administration record, no transmission. **No conflict.** But
§2's `Prescriber/source` and §7's monitoring plans are the first steps along that road; the boundary is
worth restating in the new migration's header rather than being quietly left behind.

### G. `practice_configuration` cannot carry the hierarchy

Live-probed: it has `locale, date_format, identifier_policy, default_encounter_mode, feature_flags,
config_version, is_effective` — **no `scope`/`key`/`value`**. LCP-001 §4's five-level precedence
(Encounter override → Patient Monitoring Plan → Clinic/session → Practitioner defaults → Platform library)
needs its own tables (#5, #6 above). Do not try to route it through `practice_configuration`.

### H. Two things called "Growth"

`intelligence.ts:1783` `practice_growth` = *business* growth (new patients, workload). CPL §4 and LCP §5.2
"growth velocity / growth percentiles" = a child's anthropometrics. Naming the new one `growth` anywhere
near the intelligence engine will produce a genuinely confusing product. Suggest `anthropometry` or
`growth_chart` for the clinical one.

### I. PIE §3 "Predictive reminders" and §6 "Draft patient education material"

The built `aiPracticeIntelligence()` is grounding-only by explicit design — it calls no model and emits
`refusedClaims`. "Predictive" implies forecasting, which nothing in this product does and which no spec
here specifies a method for. §6's six generative asks are buildable, but **in the assistant**
(`/api/v1/practice/assistant`), not in `intelligence.ts` — putting a model call on the dashboard path
contradicts the standing rule that *"unavailable AI must not block dashboards"* (STATE_COPY
`ai_unavailable`). Recommend: treat §6 as assistant work and §3's "predictive reminders" as **due-date
arithmetic** (the thing that is actually computable), named honestly as such.

---

## 7. Safety-critical rules that must become assertions

Quoted verbatim. Each needs a harness assertion **and a control that proves the assertion can fail** —
this codebase's own recorded lesson is that *"a vacuous assertion looks exactly like a passing one."*

### LCP-001 §9 — Medication Safety Integration (the whole section is safety-critical)

> "The parameter engine provides the trusted patient data needed by the medication-dose safety
> capability. Weight, body surface area and relevant clinical parameters are retrieved from the
> longitudinal profile; **the medication record must preserve the exact value and timestamp used for each
> calculation.**"
> "A weight-dependent paediatric dose requires a usable dosing weight."
> "CP warns when the current weight is **stale, implausible or absent**."
> "A practitioner may update the weight, explicitly confirm an existing value or document use of another
> dosing weight."
> **"Patient-level hiding of weight must not suppress a medication-triggered safety requirement."**
> **"A later weight update must not recalculate or rewrite a historical prescription."**
> "Patient-reported medication doses are labelled unverified until reviewed by a practitioner."

The fourth of those is the "safety-critical parameters cannot be hidden when clinically required" rule.
Its enforcement point is LCP §7's `hidden` and `conditionally_required` states: a `hidden` plan row must
be **overridden** by a medication trigger, not merely ignored. **Assert both directions** — that `hidden`
suppresses routine display, *and* that a medication trigger re-surfaces it — or the assertion passes
against an engine that never hides anything.

The fifth is enforceable in SQL: `practice_medication_dose_calculation` with no `updated_at` and no update
path. Assert with a source scan that nothing UPDATEs it, the way `practice-longitudinal-harness.ts`
proves *"exactly one file in the codebase inserts into practice_patient_milestone."*

### LCP-001 §11 — Permissions and Governance

> "Platform administrators govern master definitions and curated packs."
> "Authorised team members may collect values but cannot necessarily change definitions or thresholds."
> "Patient-specific configuration changes record user, date, previous value, new value and reason."
> **"Safety-related parameters require an authorised override and reason when deactivated or bypassed."**
> "All calculations and alerts store the parameter-definition and rule versions used."

### LCP-001 §2.2 / §3 / §12 / §13 — the never-destroy rules

> §2.2 Excluded: "**Deletion of historical measurements when a parameter is deactivated.**"
> §3: "**No silent rewriting**: historical values, calculations and parameter definitions remain versioned."
> §12: "**Immutable measurement record IDs** with correction/amendment support rather than destructive editing."
> §13: "**Deactivating a parameter never removes historical measurements.**"
> §13: "Derived values display their source measurements and calculation timestamp."
> §13: "A weight-based medication entry requests a usable weight when none is available."
> §13: "A parameter can be added to one patient without affecting any other patient."

### LCP-001 §10.3 — Encounter Workspace

> "**One-click carry-forward is prohibited for measured values.**"
> "Clear distinction between measured, patient-reported, imported and calculated values."

The first is the anti-pattern that fills a chart with a weight nobody weighed. Assert that no code path
writes a `practice_parameter_measurement` whose value is copied from a prior row.

### MED-001 §3, §4, §5, §10 — dose and warnings

> §3: "Weight-based (mg/kg) / Daily dose (mg/kg/day) / Body surface area (mg/m²) / Fixed-dose regimens /
> Dose/unit conversions / **Transparent calculation display.**"
> §4: "Underdose detection / Overdose detection / **Maximum single and daily dose checks** / Age
> validation / Current weight validation / Duplicate therapy / Allergy checking / Hooks for renal/hepatic
> adjustment / Drug interaction framework (future knowledge base)."
> §5: "Informational / Advisory / Significant / Critical / **Practitioner override with justification** /
> **Full audit trail.**"
> §10: "**Historical data never overwritten.**"
> §10 Acceptance: "engine calculates doses, raises configurable warnings, records overrides and integrates
> with longitudinal parameters."

⚠ **The override-with-justification rule should be a DB constraint, not a code check** — the same shape
migration 238 used for `outcome = 'other'`:

```sql
check (outcome is distinct from 'overridden'
       or (override_reason is not null and char_length(btrim(override_reason)) > 0))
```

⚠ **A max-dose check with no rule row must render as "not checked", never as silence.** This is the
single most dangerous assertion in the set: an empty `practice_medication_rule` makes every check return
nothing, and a screen with no warning on it reads as a screen that found no problem. Assert the
**not-covered state explicitly**, with a control that proves a covered drug does raise a warning — exactly
the shape of migration 238's allergy rule (*"'NO KNOWN ALLERGIES' AND 'NOBODY HAS ASKED' ARE DIFFERENT
ANSWERS, AND THE DIFFERENCE CAN KILL SOMEBODY"*), and for the same reason.

⚠ **Allergy checking (MED §4) is not reliably computable as specified.** `practice_patient_allergy.
substance` is free text and mig 238 says so deliberately: *"Not coded: a coding nobody performed is
CPR-330's rule."* `practice_medication.generic_name` will also be free text without a vocabulary.
Matching two free-text strings and calling the result an allergy check is worse than not checking, because
a miss renders as safety. **Recommendation:** ship allergy checking as a *display* — put the allergy list
beside the prescribing form, always — and only ship an automated *check* once both sides are coded.

### CPL-001 §2, §23, §24 — governance

> §2: "**Validated proprietary scores require licensing and version governance before production
> activation.**"
> §2: "Historical measurements remain available after a pack or parameter is retired."
> §23 High risk: "Medication dosing inputs, clinical scores, emergency thresholds. | **Governed template,
> locked formula/rule, authorised overrides.**"
> §23 Licensed/restricted: "Copyrighted scores or proprietary algorithms. | Activation only after
> licensing and version approval."
> §24: "**High-risk calculations and scores cannot be altered by unauthorised users.**"
> §24: "**Retiring a pack preserves all previous patient data and definitions.**"
> §24: "The system can identify which practice, pack and version caused a parameter to appear."

⚠ §23's licensing rule has teeth: CPL-001's catalogue names **PHQ-9, GAD-7, GMFCS, Barthel Index, FIM,
Child-Pugh, MELD, DMFT, NYHA, Apgar** and others. Several are copyrighted. `licence_required` must default
to blocking activation, not to allowing it — otherwise the default is an unlicensed clinical instrument in
production.

### PIE-001 §8 — Explainability & Governance

> "Every recommendation cites supporting data / **No autonomous diagnosis or prescribing** / Audit all AI
> outputs / Role-based permissions."

Already satisfied and exceeded by the `Provenance` type and `assistantGrounding()`. Assert the new modules
carry `sources` the same way the existing ten do.

---

## 8. Capability codes

**The seeded catalogue is 39 codes, verified two ways** — a live read of `practice_role_capabilities`
returned 39 distinct codes across 68 rows, and a grep of the 12 seeding migrations (191, 192, 193, 194,
195, 196, 197, 198, 199, 200, 202, 239) produced the identical set. **Codes referenced in TypeScript but
not seeded: none.** All six historically invented codes have been removed from live checks; three survive
only inside comments as warnings (`encounter.view`, `practice.calendar.manage`, `appointment.view`).

The 39:

```
access.review  appointment.manage  comm.record  data.export  diagnosis.record
document.author  document.sign  document.view  encounter.create  encounter.edit
encounter.list  encounter.sign  followup.manage  followup.view  inbox.record
inbox.review  message.use  pathway.assign  pathway.design  pathway.view
patient.create  patient.edit  patient.list  patient.merge  patient.view
practice.calendar.view  practice.home.view  practice.locations.manage
practice.members.manage  practice.settings.manage  procedure.manage
procedure.record  queue.manage  report.view  search.use  task.manage
task.view  template.manage  treatment.record
```

**Codes a build would need, none of which exist:**

| Proposed code | Spec authority |
|---|---|
| `parameter.view` | LCP §11 "Authorised team members may collect values but cannot necessarily change definitions or thresholds" |
| `parameter.record` | same — the collect-but-not-configure tier |
| `parameter.configure` | LCP §10.1 "Configure roles permitted to change parameters"; LCP §11 |
| `pack.install` | CPL §2, §24 (could fold into `parameter.configure` — one fewer invented string) |
| `medication.view` | MED §10 "Permissions" |
| `medication.record` | MED §10 |
| `medication.override` | MED §5 "Practitioner override with justification"; CPL §23 "authorised overrides" |

PIE-001 needs **no new code** — `/practice/intelligence` and its API are already gated on `report.view`.

**Each new code must be seeded in the same migration that creates its tables**, following the exact
pattern of 191–239: `insert into practice_role_capabilities (role_code, capability_code) values …
on conflict do nothing`, followed by the backfill into `practice_role_assignment` for existing
memberships. A code checked in TypeScript and absent from that table is a permanent silent 403.

⚠ **The guard does not cover the way these are likely to be introduced.**
`scripts/practice-audit-harness.ts` `capabilityCodesInSource()` matches only three regexes, all requiring
an **inline double-quoted literal**:

```
/requirePracticeContext\(\s*"([^"]+)"\s*\)/g
/hasCapability\([^,)]+,\s*"([^"]+)"\s*\)/g
/capabilities\.includes\(\s*"([^"]+)"\s*\)/g
```

A code introduced via a `const CAP_X = "…"`, a `capability:` field in `navigation.ts` / `setup.ts`, or a
constants object is **not checked**. The compensating convention is to export an array —
`LONGITUDINAL_CAPABILITIES`, `INTELLIGENCE_CAPABILITIES`, `ENCOUNTER_WORKSPACE_CAPABILITIES` — and assert
it in the module's own harness. **New modules must do the same** (`PARAMETER_CAPABILITIES`,
`MEDICATION_CAPABILITIES`).

---

## 9. ⚠ Does MED-001 make this an EMR?

**Short answer: it crosses the line the codebase has held, and the spec's own hedge is weaker than it
looks.**

MED-001's exact wording (Purpose, the whole sentence):

> "The engine supports practitioner decision-making **without functioning as a standalone prescribing
> EMR**."

Note the qualifier is **"standalone"**, not "full". It excludes being an EMR *by itself* — which is a much
narrower claim than the boundary `/practice` has actually held. LCP-001 is stricter and worth putting
beside it, twice:

> §1: "…without converting CP into a full electronic medical record."
> §2.2 Excluded: "Comprehensive bedside observation charts or inpatient nursing documentation. / Full
> clinical examination documentation."

**What MED-001 adds that `/practice` has never had:**

1. A **patient-level medication list independent of any encounter** (§2 start/stop dates, patient-reported
   source). Every clinical record in `/practice` today hangs off an encounter, a patient identity, or a
   document. This is the first longitudinal *clinical state* store.
2. **Active clinical decision support that can raise a Critical warning** on a prescribing decision (§4,
   §5). Nothing in this product currently interposes itself between a clinician and a decision.
3. A **drug knowledge base with maximum doses and, later, interactions** (§4, §10). That is an EMR
   component by any definition, and it carries a maintenance and liability obligation that does not exist
   anywhere else in the product.
4. **Prescriber attribution** (§2 "Prescriber/source").

**What it still does not add:** no transmission to a pharmacy, no e-prescription, no administration
record, no order/result loop, no lab interface. Those remain excluded by mig 238 and `practice_treatment`.

**The honest characterisation:** MED-001 builds the clinical core of computerised prescribing decision
support — the medication list, the dose calculator, the safety checks — minus transmission. The product
would still not be a *full* EMR (no orders, no results, no inpatient chart, no admin record). But it
would, for the first time, hold a clinical state that a clinician relies on and that a warning is
generated from, and the existing refusal in `clinical-calculators.ts` was written specifically to prevent
that.

**Three consequences the user should weigh before this is built, not after:**

- **The knowledge base is the real commitment.** Not the tables — the *obligation to keep them right*. A
  max-dose table that goes six months stale is more dangerous than none, because clinicians will have
  learned to trust it. No spec here names a source, a vocabulary, a licence or a review cadence.
- **A warning that does not fire reads as a clearance.** Every safety check in §4 has a silent-failure
  mode, and three of them (allergy, duplicate therapy, interactions) cannot be computed reliably without
  coded drug identities the product does not have.
- **The refusals become promises.** Once the product shows a dose warning, the absence of a warning is
  information. That is a materially different product from one that never comments.

**This is the user's call, and it should be an explicit one.** A defensible middle path exists: build
§§2, 6, 7 and 9 (the medication record, the timeline, monitoring plans, the practitioner experience) plus
§3's mg/kg and mg/m² arithmetic with fully transparent working — that is arithmetic on a cited weight, in
the spirit of the existing calculators — and **defer §4's max-dose, duplicate-therapy and allergy checks**
until a knowledge source is chosen and licensed. That delivers most of MED-001's practitioner value while
leaving the EMR line where it is.

---

## 10. Build sequence, if it proceeds

| Step | Work | Migration | Blocks |
|---|---|---|---|
| 0 | Decide: §5 navigation (recommend: no change) · §6.A severity · §9 EMR scope · CPL §23 licensing default | — | everything |
| 1 | **LCP-001 + CPL-001 schema** — tables 1–10 + `parameter.*` capabilities + seeds | one file | 2, 3 |
| 1b | CPL catalogue content (§§3–21 → seed rows) — **concurrent with 1** | data only | — |
| 2 | **MED-001 record half** — tables 11, 12, 16 + `medication.*` capabilities | one file | 3 |
| 2b | MED-001 dose/safety half — tables 13, 14, 15 — **only if §9 is decided in favour** | same file as 2, or a third | — |
| 3 | **PIE-001 clinical modules** — medication review, growth, vital surveillance | none | — |
| 3b | **PIE-001 non-clinical half** — referral trends, §8 tightening — **concurrent with 1 and 2** | none | — |

---

## Appendix — sources for every claim

- Specs: `C:\Users\elish\Downloads\CPR-{CPL,LCP,MED,PIE}-001_v1_*.docx`, `word/document.xml` extracted
  with PowerShell tag-stripping (paragraph and table-cell breaks preserved).
- Live database: PostgREST `select=<col>&limit=0` probes with the service-role key from `.env.local`,
  run under `scripts/dev-ca-preload.cjs` (Avast TLS). Read-only, no rows fetched.
- Migrations: all 245 files in `supabase/migrations/`, grepped per table name (not per `CREATE TABLE`).
- Navigation: `src/lib/practice/navigation.ts` (`PRIMARY_ORDER`, `SIDEBAR_SECTIONS`),
  `scripts/practice-current-activity-harness.ts` §9 (94 assertions total, 16 in the nav block).
- Intelligence: `src/lib/practice/intelligence.ts` (3,168 lines), `intelligence-constants.ts`,
  `src/app/practice/(shell)/intelligence/*`, `src/app/api/v1/practice/intelligence/route.ts`,
  two harnesses (95 assertions).
- Capabilities: live read of `practice_role_capabilities` (39 codes, 68 rows) cross-checked against the
  12 seeding migrations.
