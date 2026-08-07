/**
 * CPR-CPL-001 -- THE CATALOGUE CONTENT. Section 3, "Reusable General Parameters".
 *
 * This file is DATA, plus the validator that guards it. It writes nothing, reads nothing, and imports
 * only parameters-constants.ts -- which is the module that deliberately has NO SERVER IMPORTS. The
 * seeder (cpl-catalogue-seed.ts) and the harness (cpl-catalogue-harness.ts) both use it.
 *
 * ⚠ validate() LIVES HERE AND NOT IN THE SEEDER, and that is not filing. The seeder calls main() at
 * module scope, so a harness that imported the validator from it would run the seeder as a side effect
 * of being loaded -- against the live database, before a single assertion had executed.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT CPR-CPL-001 ACTUALLY SUPPLIES, WHICH IS LESS THAN ITS PAGE COUNT SUGGESTS.
 *
 * The document is nineteen prose tables of parameter NAMES. Across all of sections 3 to 21 it states:
 *
 *   no unit, for any parameter          no data type, for any parameter
 *   no collection frequency, for any    no option list, for any single- or multiple-choice parameter
 *   no plausibility bound, for any      no scoring instrument, for any parameter whose name ends "score"
 *   NO REFERENCE RANGE, ANYWHERE
 *
 * s1 says so itself: "It is a design catalogue, not a mandate to collect all listed data." So every
 * field below except `display_name` and (by section heading) `category` is an authoring decision, and
 * this header records the rules those decisions follow so a reviewer can check them one at a time
 * rather than parameter by parameter.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SIX AUTHORING RULES. Each one is asserted in cpl-catalogue-harness.ts, with a control.
 *
 *  ⚠ 1. NO REFERENCE RANGE IS AUTHORED, BECAUSE CPL-001 NAMES NONE.
 *
 *       There is no field for one below and there is nowhere for one to go: migration 246 gives a
 *       reference range exactly two homes, `practice_parameter_activation.threshold_override` and
 *       `practice_patient_monitoring_plan.target_low/high`, and gives the DEFINITION none. So every
 *       parameter here reads "Not checked" until a practice states a range, and that is the honest
 *       answer rather than a gap. NO_PLATFORM_REFERENCE_RANGE in parameters-constants.ts is the same
 *       refusal one level up, and this file does not quietly undo it.
 *
 *  ⚠ 2. PLAUSIBILITY BOUNDS FOLLOW FROM ARITHMETIC OR THEY ARE NOT AUTHORED.
 *
 *       min_plausible and max_plausible are a TYPING check, not a clinical one -- migration 246 s1 is
 *       explicit that they warn rather than refuse. So a count gets `min 0` because a count of events
 *       cannot be negative, and a percentage gets `0..100` because that is what a percentage is.
 *       NOTHING ELSE GETS A BOUND. "A vomiting frequency above 30 is implausible" is a clinical
 *       judgement wearing a validation hat, and every bound below is either 0 or 100 for that reason.
 *
 *  ⚠ 3. A SCALE THAT IS NOT STATED IS NOT INVENTED, AND THE PARAMETER SHIPS AS A DRAFT.
 *
 *       Four names below end in a scale nobody wrote down. "Performance status" is ECOG (0-5, lower is
 *       better) or Karnofsky (0-100, higher is better) and CPL names neither; "nutritional risk score"
 *       is MUST or MNA or STAMP or STRONGkids and CPL names none of them. Picking one would publish a
 *       named instrument's scale under a generic label, and a 3 would then mean two opposite things
 *       depending on which instrument the practice had in mind.
 *
 *       So they are authored as integers with NO bounds, NO options and status `draft`, and their
 *       version note says what a practice has to state before use. `draft` is advisory rather than
 *       enforced -- setActivation refuses only `retired` -- and that is recorded here rather than
 *       overstated.
 *
 *  ⚠ 4. WHERE THE DOCUMENT STATES NO SCALE AND NO UNIT, THE TYPE IS `text`.
 *
 *       Twenty-eight of the thirty-seven parameters below are free text, and that is a finding about the
 *       source document rather than a shortcut. `single_choice` would require an option list CPL never
 *       gives; `integer` would require a scale it never gives; `boolean` would collapse "moderate
 *       dyspnoea on one flight of stairs" into a tick. `text` is the only type that adds no meaning the
 *       specification does not have, and its rows are marked not-graphable (see rule 5).
 *
 *  ⚠ 5. "WHETHER IT TRENDS" IS `presentation.graph`, AND A TEXT PARAMETER DOES NOT TREND.
 *
 *       Migration 246 s1: presentation "describes where a VALUE renders". A chart over text that
 *       happens to look like numbers is how a transposed digit becomes a trend (246 s8), so graph is
 *       false for every text parameter and true for every numeric one.
 *
 *       ⚠ AND THE ENGINE CANNOT CARRY THIS FIELD. See ENGINE_GAPS.presentation below.
 *
 *  ⚠ 6. NOTHING HERE IS ACTIVATED, INSTALLED OR ASSIGNED TO A PATIENT.
 *
 *       CPL s2: "Each pack is inactive until selected by a practitioner." s24: "Patient-specific
 *       activation can be performed from the Patient Workspace." Authoring the library and installing a
 *       pack are two acts and this file is only the first. There is no activation row anywhere in this
 *       catalogue and the harness asserts the count is zero after the whole thing has been written.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import {
  PARAMETER_CATEGORY_CODES, PARAMETER_DATA_TYPE_CODES, COLLECTION_RULE_CODES, RISK_CLASS_CODES,
} from "../src/lib/practice/parameters-constants";

/**
 * One catalogue parameter, in the shape `practice_parameter_definition` actually has.
 *
 * ⚠ THE COLUMN LIST IS THE AUTHORITY, NOT CPL-001's PROSE. CPL s1 calls itself a design catalogue and
 * never states a parameter's fields; LCP-001 s6 is the only place either document does, and migration
 * 246 s1 is that section as columns. So this type mirrors the table.
 */
export type CatalogueDefinition = {
  code: string;
  display_name: string;
  short_name?: string;
  synonyms?: string[];
  category: "anthropometric" | "vital_sign" | "specialty" | "score" | "calculated" | "custom";
  data_type: "decimal" | "integer" | "boolean" | "date" | "text" | "single_choice" | "multi_choice" | "calculated";
  canonical_unit?: string;
  permitted_units?: string[];
  unit_conversions?: Record<string, number>;
  value_precision?: number;
  min_plausible?: number;
  max_plausible?: number;
  default_collection_rule: string;
  /** Rule 5. `graph` is "whether it trends". */
  presentation: { form: boolean; graph: boolean; table: boolean };
  risk_class: "low" | "moderate" | "high" | "licensed";
  licence_required?: boolean;
  licence_reference?: string;
  /** LCP s6 Governance: where this definition came from. Cited to the section, not to the document. */
  source: string;
  owner: string;
  status: "draft" | "active";
  /**
   * The definition-version change note. Rule 3's caveat lives here because the definition table has no
   * notes column and `source` is provenance rather than commentary -- and a version with no note is a
   * change nobody can review (migration 246 s2).
   */
  version_note: string;
  /** Set for rule 3's four. Asserted against `status: "draft"` and against the note's wording. */
  scale_unstated?: true;
  /**
   * CPL s2: "Sensitive parameters should use role-based visibility and explicit purpose."
   * ⚠ ADVISORY ONLY -- see ENGINE_GAPS.sensitivity. There is no column for it on the definition.
   */
  sensitive?: true;
};

export type CataloguePack = {
  code: string;
  name: string;
  specialty: string;
  description: string;
  /** Parameter codes, in the order they should appear on a form. May name a CORE_LIBRARY code. */
  items: string[];
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPL-001 s3 -- REUSABLE GENERAL PARAMETERS
//
// ⚠ CATEGORY. LCP s6's six categories are anthropometric, vital sign, specialty, score, calculated and
// custom. There is NO bucket for "reusable general", which is what s3 is. `custom` is wrong -- the hue
// map in parameters-constants.ts glosses it "a practice's own, with no platform governance behind it",
// and these are governed platform rows. So the non-scored ones are `specialty` ("an addition a practice
// chose", which is exactly right about how they are used) and the scored ones are `score`. Recorded in
// ENGINE_GAPS.category rather than worked around.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const OWNER = "Competen Practice platform";
const S3 = "CPR-CPL-001 s3 Reusable General Parameters";

/** Rule 4's parameters: named by CPL, given no scale, no unit and no option list. */
const freeText = (
  code: string, display_name: string, default_collection_rule: string,
  extra: Partial<CatalogueDefinition> = {},
): CatalogueDefinition => ({
  code, display_name, category: "specialty", data_type: "text",
  default_collection_rule,
  presentation: { form: true, graph: false, table: true },
  risk_class: "low", source: S3, owner: OWNER, status: "active",
  version_note:
    "Seeded from CPR-CPL-001 s3. The specification names this parameter and states no unit, scale or "
    + "option list for it, so it is recorded as free text rather than typed against an invented scale.",
  ...extra,
});

/** Rule 2's counts: an integer of events, floored at zero because a count cannot be negative. */
const count = (
  code: string, display_name: string, unit: string, default_collection_rule: string,
): CatalogueDefinition => ({
  code, display_name, category: "specialty", data_type: "integer",
  canonical_unit: unit, permitted_units: [unit], unit_conversions: { [unit]: 1 },
  value_precision: 0, min_plausible: 0,
  default_collection_rule,
  presentation: { form: true, graph: true, table: true },
  risk_class: "low", source: S3, owner: OWNER, status: "active",
  version_note:
    "Seeded from CPR-CPL-001 s3. Counted in " + unit + " since the previous collection. The lower "
    + "plausibility bound is zero because a count of events cannot be negative; NO UPPER BOUND IS SET, "
    + "because any figure that would serve as one is a clinical judgement CPL-001 does not make.",
});

/** Rule 3's scores: the name says "score" and the specification names no instrument. */
const unscaledScore = (
  code: string, display_name: string, default_collection_rule: string,
  risk_class: "low" | "high", instruments: string,
): CatalogueDefinition => ({
  code, display_name, category: "score", data_type: "integer",
  // ⚠ THE UNIT IS "score", AND IT IS NOT THE SCALE. migration 246 s8's
  // practice_param_measurement_unit refuses any numeric value with no unit -- "70 is a reasonable
  // weight in kilograms and a reasonable weight in pounds" -- so a score with no unit at all could
  // never be recorded. CORE_LIBRARY's pain_score puts its scale in the unit ("0-10"); this cannot,
  // because the scale is the thing CPL-001 does not state. "score" says the value is a dimensionless
  // point count and claims nothing about its range or its direction.
  canonical_unit: "score", permitted_units: ["score"], unit_conversions: { score: 1 },
  value_precision: 0,
  default_collection_rule,
  presentation: { form: true, graph: true, table: true },
  risk_class, source: S3, owner: OWNER, status: "draft", scale_unstated: true,
  version_note:
    "Seeded from CPR-CPL-001 s3 AS A DRAFT, and it must stay one until a practice states the instrument. "
    + "CPL-001 names this parameter without naming a scale (" + instruments + "), and those instruments "
    + "run in opposite directions and over different ranges, so the same integer means different things "
    + "under each. No range, no options and no plausibility bounds are set, and nothing checks a value "
    + "recorded against it.",
});

export const CATALOGUE_DEFINITIONS: CatalogueDefinition[] = [
  // ── s3 Function & performance ─────────────────────────────────────────────────────────────────────
  freeText("mobility_status", "Mobility status", "every_visit", { synonyms: ["ambulation"] }),
  freeText("walking_aid", "Walking aid", "on_request", { synonyms: ["mobility aid", "walking device"] }),
  // "Falls history" is a count over a window and CPL states no window, so it is not a count here.
  freeText("falls_history", "Falls history", "first_visit"),
  freeText("activities_of_daily_living", "Activities of daily living", "on_request",
    { short_name: "ADL", synonyms: ["ADL", "self-care"] }),
  freeText("functional_limitation", "Functional limitation", "on_request"),
  freeText("exercise_tolerance", "Exercise tolerance", "on_request",
    { synonyms: ["exercise capacity"] }),
  unscaledScore("performance_status", "Performance status", "on_request", "high",
    "ECOG runs 0-5 with lower better, Karnofsky runs 0-100 with higher better"),
  freeText("return_to_work_status", "Return-to-work status", "on_request"),

  // ── s3 Nutrition & feeding ────────────────────────────────────────────────────────────────────────
  freeText("appetite", "Appetite", "every_visit"),
  freeText("oral_intake", "Oral intake", "every_visit"),
  freeText("feeding_method", "Feeding method", "first_visit", { synonyms: ["feeding route"] }),
  freeText("dietary_restriction", "Dietary restriction", "first_visit", { synonyms: ["diet"] }),
  unscaledScore("nutritional_risk_score", "Nutritional risk score", "scheduled", "high",
    "MUST, MNA, STAMP and STRONGkids are all in use and all score differently"),
  freeText("tube_feeding_status", "Tube-feeding status", "on_request",
    { synonyms: ["enteral feeding"] }),
  freeText("feeding_tolerance", "Feeding tolerance", "on_request"),

  // ── s3 Symptoms ───────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ "Pain" IS NOT HERE. It already exists as `pain_score` in CORE_LIBRARY (LCP s5.3), seeded as a
  // platform row. A second definition of the same measurement would split one patient's pain series
  // across two codes, and the chart would then be wrong about the patient in the quietest possible way.
  // The Symptoms pack names `pain_score` instead -- see CATALOGUE_PACKS.
  freeText("fatigue", "Fatigue", "every_visit", { synonyms: ["tiredness"] }),
  freeText("nausea", "Nausea", "every_visit"),
  count("vomiting_frequency", "Vomiting frequency", "episodes", "every_visit"),
  freeText("dizziness", "Dizziness", "every_visit"),
  freeText("sleep_quality", "Sleep quality", "every_visit"),
  freeText("breathlessness", "Breathlessness", "every_visit", { synonyms: ["dyspnoea", "shortness of breath"] }),
  freeText("cough", "Cough", "every_visit"),
  count("headache_frequency", "Headache frequency", "episodes", "every_visit"),
  unscaledScore("symptom_severity", "Symptom severity", "every_visit", "low",
    "CPL-001 s3 names neither the scale nor its endpoints"),
  unscaledScore("symptom_interference", "Symptom interference", "every_visit", "low",
    "CPL-001 s3 names neither the scale nor its endpoints"),

  // ── s3 Adherence & self-management ────────────────────────────────────────────────────────────────
  freeText("medication_adherence", "Medication adherence", "every_visit", { synonyms: ["compliance"] }),
  count("missed_doses", "Missed doses", "doses", "every_visit"),
  freeText("device_use", "Device use", "on_request"),
  {
    code: "home_monitoring_completion", display_name: "Home monitoring completion",
    category: "specialty", data_type: "integer",
    canonical_unit: "%", permitted_units: ["%"], unit_conversions: { "%": 1 },
    value_precision: 0,
    // Rule 2: 0 and 100 are what a percentage is, not a clinical limit somebody chose.
    min_plausible: 0, max_plausible: 100,
    default_collection_rule: "every_follow_up",
    presentation: { form: true, graph: true, table: true },
    risk_class: "low", source: S3, owner: OWNER, status: "active",
    version_note:
      "Seeded from CPR-CPL-001 s3. The proportion of the agreed home readings that were taken, over the "
      + "period the practice set. The plausibility bounds are 0 and 100 because that is the range of a "
      + "percentage, not because anybody judged a completion rate acceptable or unacceptable.",
  },
  freeText("treatment_barriers", "Treatment barriers", "on_request"),
  freeText("caregiver_confidence", "Caregiver confidence", "on_request"),

  // ── s3 Safety & risk ──────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ EVERY "RISK" HERE IS FREE TEXT AND NOT A SCORE, and the difference is the name. `falls_risk` is
  // Morse or STRATIFY or a clinician's impression, and CPL names none of them; `nutritional_risk_score`
  // says "score" in its own name and so gets rule 3's treatment. Typing these as integers would publish
  // four unnamed scales at once.
  freeText("falls_risk", "Falls risk", "scheduled"),
  freeText("pressure_injury_risk", "Pressure-injury risk", "scheduled",
    { synonyms: ["pressure ulcer risk", "pressure sore risk"] }),
  freeText("bleeding_risk", "Bleeding risk", "on_request"),
  freeText("infection_risk", "Infection risk", "on_request"),
  freeText("safeguarding_concern", "Safeguarding concern", "on_request", { sensitive: true }),
  count("emergency_attendance_frequency", "Emergency attendance frequency", "attendances", "scheduled"),
];

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PACKS -- CPL s3's five groups, one pack each.
//
// ⚠ SECTION 21's NINE CONDITION-SPECIFIC PACKS ARE NOT HERE, AND NOT BECAUSE OF EFFORT. Every one of
// them names parameters from sections 4 to 20 that do not exist yet: "Hypertension review" wants home
// BP, side effects and cardiovascular risk status, "Heart failure monitoring" wants NYHA class and
// oedema grade. A pack published under a condition's name that silently omitted half its own contents
// would be worse than no pack -- a practitioner installs "Diabetes annual review" and gets weight and
// blood pressure. See CATALOGUE_REFUSALS.condition_packs.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CATALOGUE_PACKS: CataloguePack[] = [
  {
    code: "general_function_performance",
    name: "Function and performance",
    specialty: "General (reusable)",
    description:
      "CPR-CPL-001 s3. Mobility, self-care, exercise tolerance and work status. Inactive until a "
      + "practitioner selects it, and every parameter in it can be switched off individually.",
    items: [
      "mobility_status", "walking_aid", "falls_history", "activities_of_daily_living",
      "functional_limitation", "exercise_tolerance", "performance_status", "return_to_work_status",
    ],
  },
  {
    code: "general_nutrition_feeding",
    name: "Nutrition and feeding",
    specialty: "General (reusable)",
    description:
      "CPR-CPL-001 s3. Appetite, intake, feeding route and nutritional risk. Weight is not duplicated "
      + "here -- it is a core parameter and the weight series is where weight change is read from.",
    items: [
      "appetite", "oral_intake", "feeding_method", "dietary_restriction",
      "nutritional_risk_score", "tube_feeding_status", "feeding_tolerance",
    ],
  },
  {
    code: "general_symptoms",
    name: "Symptoms",
    specialty: "General (reusable)",
    description:
      "CPR-CPL-001 s3. The symptoms almost every practice asks about. Pain is the CORE pain score "
      + "rather than a second definition, so a patient's pain series stays in one place.",
    items: [
      // ⚠ THE CORE DEFINITION, NOT A COPY. See the Symptoms note above.
      "pain_score",
      "fatigue", "nausea", "vomiting_frequency", "dizziness", "sleep_quality",
      "breathlessness", "cough", "headache_frequency", "symptom_severity", "symptom_interference",
    ],
  },
  {
    code: "general_adherence_self_management",
    name: "Adherence and self-management",
    specialty: "General (reusable)",
    description:
      "CPR-CPL-001 s3. Whether the plan is being followed, and what is stopping it. Nothing in this "
      + "pack is a judgement about the patient; every parameter records what was reported.",
    items: [
      "medication_adherence", "missed_doses", "device_use", "home_monitoring_completion",
      "treatment_barriers", "caregiver_confidence",
    ],
  },
  {
    code: "general_safety_risk",
    name: "Safety and risk",
    specialty: "General (reusable)",
    description:
      "CPR-CPL-001 s3. Falls, pressure injury, bleeding, infection, safeguarding and unplanned "
      + "attendance. Each is recorded as the practice's own assessment: CPL-001 names no instrument for "
      + "any of them, so none is implied here.",
    items: [
      "falls_risk", "pressure_injury_risk", "bleeding_risk", "infection_risk",
      "safeguarding_concern", "emergency_attendance_frequency",
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS PASS DID NOT AUTHOR, AND WHY
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CATALOGUE_REFUSALS = [
  {
    key: "reference_ranges",
    label: "Reference ranges for any catalogue parameter",
    detail:
      "CPR-CPL-001 STATES NO REFERENCE RANGE ANYWHERE IN THE DOCUMENT -- not for a parameter in s3, and "
      + "not for one in any of sections 4 to 21. There is therefore no parameter in this catalogue whose "
      + "range was named by the specification and dropped by the author: the count of those is zero. "
      + "Every parameter here reads `not_checked` until a practice or a practitioner states a range, "
      + "which is what NO_PLATFORM_REFERENCE_RANGE already says and what thresholdLine already returns.",
    wouldRequire:
      "A cited, versioned reference-range source with age, sex and applicability conditions -- and a "
      + "recorded decision about which source this practice adopts -- before a single low/high pair is "
      + "written anywhere.",
  },
  {
    key: "weight_loss_percentage",
    label: "Weight loss percentage (s3, Nutrition & feeding)",
    detail:
      "NOT A DEFINITION, DELIBERATELY. LCP s5.2 names 'weight change and percentage change' and "
      + "parameters.ts already computes both at read time over the weight series -- 'it is an arithmetic "
      + "over the weight series, and it is returned by parameterSeries as a change'. A stored definition "
      + "beside it would be a second place the same number lives, and the two would eventually disagree "
      + "about a patient who was losing weight.",
    wouldRequire: "Nothing. It exists already, one layer up, and is read rather than recorded.",
  },
  {
    key: "pain_duplicate",
    label: "Pain (s3, Symptoms)",
    detail:
      "Already a platform definition. LCP s5.3 ships `pain_score` in CORE_LIBRARY and it is seeded. The "
      + "Symptoms pack names that definition as one of its items rather than introducing a second code "
      + "for the same measurement, because two codes would split one patient's pain series in half and "
      + "each half would chart as a complete record.",
    wouldRequire: "Nothing.",
  },
  {
    key: "unstated_scales",
    label: "The scale behind performance status, nutritional risk, symptom severity and interference",
    detail:
      "Four parameters in s3 are scores whose instrument CPL-001 does not name. They are authored as "
      + "integers with no options, no plausibility bounds and status `draft`, and their version notes "
      + "name the candidate instruments and say they disagree. ⚠ `draft` IS ADVISORY AND NOT A LOCK: "
      + "setActivation refuses a `retired` definition and permits a `draft` one, so a practice can "
      + "switch these on without stating an instrument. Only the version note stands between that and a "
      + "column of integers meaning nothing in particular.",
    wouldRequire:
      "The practice naming the instrument -- and, for any copyrighted one, a licence reference, at "
      + "which point risk_class becomes `licensed` and migration 246's licence gate refuses activation "
      + "until the reference is recorded.",
  },
  {
    key: "condition_packs",
    label: "CPL-001 s21's nine example condition-specific packs",
    detail:
      "Epilepsy follow-up, hydrocephalus surveillance, cerebral palsy review, hypertension review, heart "
      + "failure monitoring, diabetes annual review, asthma follow-up, postoperative review and "
      + "palliative symptom review. Every one of them draws most of its components from sections 4 to "
      + "20, which this pass did not author. Publishing them now would mean a pack named for a condition "
      + "that quietly contains only the two or three parameters that happen to exist -- a practitioner "
      + "installs 'Diabetes annual review' and receives weight and blood pressure.",
    wouldRequire: "Sections 4 to 20 authored first, then each s21 pack assembled from real codes.",
  },
  {
    key: "sections_4_to_20",
    label: "The seventeen specialty sections",
    detail:
      "Paediatrics, neurology, cardiovascular, respiratory, endocrine, renal, gastroenterology, "
      + "infectious diseases, obstetrics, mental health, musculoskeletal, rehabilitation, oncology, "
      + "dermatology, ophthalmology/ENT/oral, surgery and occupational medicine -- roughly 68 sub-packs "
      + "and 560 further names. Not authored in this pass. Several of them (PHQ-9, GAD-7, GMFCS, "
      + "Barthel, FIM, Child-Pugh, MELD, DMFT, Apgar, NYHA) are named instruments and some are "
      + "copyrighted, so each needs risk_class `licensed` and a licence reference before it can go "
      + "active -- which migration 246's licence gate enforces and this pass has not obtained.",
    wouldRequire:
      "The same six rules applied section by section, plus a licensing decision per named instrument.",
  },
] as const;

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHAT THE SHIPPED ENGINE CANNOT EXPRESS
//
// These are not complaints about the catalogue. They are places where a field this catalogue authors
// has no route into the database through the functions parameters.ts exports, so the value below would
// be silently dropped by a seeder that used them. The harness asserts each one by pushing a real
// definition through the real engine and reading back what survived -- so if any of these is fixed, the
// corresponding assertion fails and this list gets shorter.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const ENGINE_GAPS = [
  {
    key: "platform_scope",
    label: "Nothing can author a PLATFORM row except the hard-coded core seed",
    detail:
      "THE BLOCKING ONE. migration 246 s1 and s3 make workspace_id nullable and NULL means platform -- "
      + "LCP s4's top tier, the thing every practice reads and none owns. But createDefinition, "
      + "createPack and setPackItem all write `workspace_id: ctx.workspaceId` unconditionally, and "
      + "ensureCoreLibrary -- the only function in the codebase that writes workspace_id NULL -- takes no "
      + "argument and inserts CORE_LIBRARY and nothing else. There is NO function that creates a platform "
      + "PACK at all; the pack table has a platform tier and no writer for it. So a seeder built out of "
      + "the shipped functions can only ever author this catalogue inside one tenant, which is not a "
      + "catalogue: no other practice could see it, installPack would refuse it, and CPL s24's 'platform "
      + "master' would be a row belonging to whichever practice happened to run the script.",
    wouldRequire:
      "One exported function in parameters.ts -- ensurePlatformCatalogue(admin, definitions, packs) -- "
      + "shaped exactly like ensureCoreLibrary: read the existing platform codes, insert only what is "
      + "missing (never upsert; ux_practice_param_def_platform_code is PARTIAL and cannot be an "
      + "on-conflict target), write the version-1 snapshot in the same act, and never discard the insert "
      + "error. Note that provisioning.audit takes a workspaceId, so a platform write has no practice "
      + "audit trail to go in and that decision has to be made explicitly rather than by omission.",
  },
  {
    key: "presentation",
    label: "presentation, and therefore \"whether it trends\"",
    detail:
      "DefinitionInput has no `presentation` field. createDefinition writes `origin?.presentation ?? "
      + "{ form: true, graph: true, table: true }`, so EVERY definition created through the engine is "
      + "marked graphable -- including the twenty-six free-text parameters above, which must not be "
      + "charted at all. migration 246 s8's own warning is that a chart over text that looks like "
      + "numbers is how a transposed digit becomes a trend.",
    wouldRequire: "A `presentation` field on DefinitionInput, passed through to the insert.",
  },
  {
    key: "source_owner",
    label: "source and owner attribution",
    detail:
      "createDefinition hard-codes `source` to `Custom parameter, {workspaceName}` and `owner` to the "
      + "workspace name for anything that is not a clone. A governed catalogue parameter written through "
      + "it would be attributed to whichever practice ran the seeder rather than to CPR-CPL-001 s3, "
      + "which is the opposite of what CPL s22 ('preserving source attribution') and s24 ('identify "
      + "which practice, pack and version caused a parameter to appear') ask for.",
    wouldRequire: "Optional `source` and `owner` on DefinitionInput.",
  },
  {
    key: "status_and_version_note",
    label: "The initial status and the version-1 change note",
    detail:
      "createDefinition writes status `draft` always and change_note `Created.` always. So an `active` "
      + "catalogue parameter cannot be authored in one act, and rule 3's caveat -- the sentence that is "
      + "the only thing standing between an unscaled score and a column of meaningless integers -- has "
      + "nowhere to be written. setDefinitionStatus can promote a draft afterwards WITH a note, but it "
      + "filters on `workspace_id = ctx.workspaceId`, so it cannot touch a platform row either.",
    wouldRequire: "Optional `status` and `changeNote` on DefinitionInput.",
  },
  {
    key: "category",
    label: "A category for CPL s3's cross-cutting parameters",
    detail:
      "LCP s6's six categories are anthropometric, vital_sign, specialty, score, calculated and custom. "
      + "CPL s3 is explicitly none of those -- it is the reusable general set that sits across every "
      + "specialty. This catalogue files the non-scored ones under `specialty`, which reads correctly on "
      + "screen and is not what they are. Adding a seventh would need migration 246's CHECK constraint "
      + "and PARAMETER_CATEGORIES together, and a mismatch between the two is a 500 on save.",
    wouldRequire: "A migration altering the category CHECK, and the same code added to PARAMETER_CATEGORIES.",
  },
  {
    key: "sensitivity",
    label: "Marking a parameter sensitive at the platform tier",
    detail:
      "CPL s2: 'Sensitive parameters should use role-based visibility and explicit purpose.' `visibility` "
      + "is a column on practice_parameter_activation, not on the definition, so a platform definition "
      + "cannot ship marked sensitive -- `safeguarding_concern` arrives in every practice defaulting to "
      + "`team` and stays there unless somebody notices. The catalogue records the flag above and the "
      + "database has nowhere to put it.",
    wouldRequire:
      "A default_visibility column on practice_parameter_definition that setActivation reads when no "
      + "explicit visibility is given.",
  },
] as const;

/** Every parameter code this catalogue names, including the CORE one the Symptoms pack reuses. */
export const CATALOGUE_CODES = CATALOGUE_DEFINITIONS.map(d => d.code);

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE VALIDATOR
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** migration 246 s1's own CHECK, as a regex, so a bad code is caught here and not by a 500. */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{1,60}$/;

/**
 * Every rule migration 246 states about a definition row, plus the six authoring rules above.
 *
 * ⚠ THIS IS NOT A SECOND SOURCE OF TRUTH. Each database check below cites the constraint it mirrors,
 * and every one of them is ALSO enforced by Postgres -- so this cannot let through something the
 * database would refuse, it can only report it in a sentence instead of a constraint violation. The
 * vocabularies are IMPORTED from parameters-constants.ts rather than restated, so a category added to
 * the engine is a category this accepts on the same day.
 *
 * ⚠ AND IT IS TESTED AGAINST DELIBERATE BREAKAGE. A validator that returns [] for everything would let
 * "the catalogue is valid" pass and be worthless; cpl-catalogue-harness.ts s7 feeds each check a row
 * that should trip it.
 */
export function validate(d: CatalogueDefinition): string[] {
  const bad: string[] = [];
  if (!CODE_PATTERN.test(d.code)) bad.push(`code "${d.code}" does not match migration 246 s1's pattern`);
  if (!d.display_name.trim()) bad.push(`${d.code}: no display name`);
  if (!PARAMETER_CATEGORY_CODES.includes(d.category)) bad.push(`${d.code}: category "${d.category}" is not one of LCP s6's`);
  if (!PARAMETER_DATA_TYPE_CODES.includes(d.data_type)) bad.push(`${d.code}: data type "${d.data_type}" is not one of LCP s6's`);
  if (!COLLECTION_RULE_CODES.includes(d.default_collection_rule)) bad.push(`${d.code}: collection rule "${d.default_collection_rule}" is not one of LCP s6's`);
  if (!RISK_CLASS_CODES.includes(d.risk_class)) bad.push(`${d.code}: risk class "${d.risk_class}" is not one of CPL s23's`);

  // practice_param_def_plausible_order
  if (d.min_plausible != null && d.max_plausible != null && d.min_plausible > d.max_plausible)
    bad.push(`${d.code}: the plausibility window is the wrong way round`);
  // practice_param_def_licensed_class
  if (d.risk_class === "licensed" && d.licence_required !== true)
    bad.push(`${d.code}: classified licensed and claims it needs no licence`);
  // practice_param_def_licence_gate
  if (d.status === "active" && d.licence_required === true && !d.licence_reference?.trim())
    bad.push(`${d.code}: active and licensed with no licence reference`);

  // ⚠ RULE 1, AS A CHECK. A definition carries no reference range and there is no column for one, so
  // the only way one could arrive is disguised as a plausibility bound.
  if (d.data_type === "text" && (d.min_plausible != null || d.max_plausible != null))
    bad.push(`${d.code}: a text parameter has been given numeric bounds`);

  // ⚠ RULE 2. Every bound is 0 or 100 -- arithmetic, never a clinical limit.
  for (const [which, v] of [["min", d.min_plausible], ["max", d.max_plausible]] as const)
    if (v != null && v !== 0 && v !== 100)
      bad.push(`${d.code}: ${which}_plausible is ${v}, which is neither 0 nor 100 and so is a clinical judgement CPL-001 does not make`);

  // ⚠ RULE 3. An unstated scale ships as a draft, with no bounds and no options.
  if (d.scale_unstated && d.status !== "draft")
    bad.push(`${d.code}: the scale is unstated and the definition is not a draft`);
  if (d.scale_unstated && (d.min_plausible != null || d.max_plausible != null))
    bad.push(`${d.code}: the scale is unstated and bounds have been set against it anyway`);

  // ⚠ RULE 5. A text parameter does not trend.
  if (d.data_type === "text" && d.presentation.graph)
    bad.push(`${d.code}: free text marked graphable -- migration 246 s8, a chart over text is how a transposed digit becomes a trend`);

  // migration 246 s8's practice_param_measurement_unit: a numeric value with no unit is refused, so a
  // numeric parameter with no canonical unit is one whose every measurement would be rejected.
  if ((d.data_type === "decimal" || d.data_type === "integer") && !d.canonical_unit)
    bad.push(`${d.code}: numeric with no canonical unit -- practice_param_measurement_unit would refuse every value`);
  if (d.canonical_unit && !(d.permitted_units ?? []).includes(d.canonical_unit))
    bad.push(`${d.code}: the canonical unit is not in permitted_units`);
  if (d.canonical_unit && (d.unit_conversions ?? {})[d.canonical_unit] !== 1)
    bad.push(`${d.code}: the canonical unit does not convert to itself by 1`);
  return bad;
}
