// CPR-TREAT-001 -- the words, the field map and the shape rules, IN A MODULE THAT IMPORTS NOTHING.
//
// ⚠ SAME SPLIT, SAME REASON AS investigation-constants.ts. The Treatment tab is a client component and
// a `"use client"` import of the engine drags node:crypto and next/headers into the bundle. audit.ts
// records what that cost the last time: 120.7 kB gzip across four screens, never executed.
//
// ⚠ THERE IS NO CLINICAL VOCABULARY IN THIS FILE. CPR-TREAT-001 s6 is a FROZEN REQUIREMENT: no
// hard-coded clinical lists. Every formulation, dose unit, route, frequency, duration and non-drug
// category comes from practice_treatment_option (migration 275) at read time. What lives here is the
// SHAPE of the form -- which fields a type needs, what a field means, and the sentences that keep the
// non-EMR boundary on the screen.

/**
 * WHICH FIELDS EACH TREATMENT TYPE ACTUALLY NEEDS.
 *
 * ⚠ THIS IS NOT THE LIST OF TYPES. The list of types is configuration and is read from the database.
 * This is the FORM SHAPE for a type code, and a code with no entry here falls back to `label only`,
 * which is the safe direction: a screen that asks for nothing records a sentence, and a screen that
 * demands a dose for "no treatment change" is unusable.
 */
export const TREATMENT_TYPE_SHAPE: Record<string, {
  prescribing: boolean; nonDrug: boolean; hint: string;
  /**
   * CP-TREAT-002 s6. The label for this type's ONE structured detail field -- the thing the comp's
   * DETAILS column shows ("Normal saline + dressing", "Airway clearance", "Salt restriction").
   *
   * ⚠ ONE FIELD, NOT A BESPOKE SCHEMA PER TYPE. s9 asks for subtype tables and this is not them: site,
   * body area, parameters and targets each want their own column before a report can ever group by
   * them. What is here is the field that HAS storage today, named correctly per type, rather than a
   * body area crammed into a notes box where nothing will ever find it again. The rest is named in the
   * commit and in the tip on the screen instead of being quietly approximated.
   */
  detailsLabel?: string;
  detailsHint?: string;
  /** s11: "Do not require Dose or Route for non-medication treatments." */
  needsSchedule?: boolean;
}> = {
  medication: { prescribing: true, nonDrug: false, hint: "A medication prescribed or continued today." },
  change_medication: { prescribing: true, nonDrug: false, hint: "A change to something already prescribed. Say what it is changing to." },
  stop_medication: { prescribing: false, nonDrug: false, hint: "A decision to stop a medication. Name the medication and why." },
  // ⚠ RETIRED FROM THE OFFERED LIST BY MIGRATION 295, KEPT HERE. Rows already carry it and s10 requires
  // historical records keep their original type, so this shape still has to render them.
  non_drug: { prescribing: false, nonDrug: true, hint: "Physiotherapy, wound care, dietary intervention, observation or a configured alternative." },
  advice: { prescribing: false, nonDrug: false, hint: "Advice given, in a sentence." },
  monitoring: { prescribing: false, nonDrug: false, hint: "What you asked to be watched, and how often." },
  no_change: { prescribing: false, nonDrug: false, hint: "Current treatment continues unchanged. Recording this explicitly is the point of it." },
  other: { prescribing: false, nonDrug: false, hint: "A treatment decision the configured list does not cover. Your words are kept exactly.",
    detailsLabel: "Details", detailsHint: "What is being done", needsSchedule: true },

  // ── CP-TREAT-002 s2's six new types. Their FIELDS live in TREATMENT_SUBTYPE below. ─────────────
  wound_care: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "Wound or dressing care planned today. Not a dressing PERFORMED -- that is a procedure." },
  physiotherapy: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "A physiotherapy plan. The sessions themselves are not recorded here." },
  nutrition: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "A diet or nutrition plan, and what it is aiming at." },
  respiratory: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "A respiratory therapy plan. Parameters go with the modality." },
  device_support: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "A device or support to be used, and where." },
  lifestyle: { prescribing: false, nonDrug: true, needsSchedule: true,
    hint: "A lifestyle intervention and what it is aiming at." },
};

/**
 * CP-TREAT-002 s9's subtype fields: what each type structurally IS, one migration-296 table per type.
 *
 * ⚠ THIS MAP IS THE ONLY DEFINITION. The form renders these fields, the engine writes them to `table`
 * and composes the display summary from them in this order. A second copy in either place would let
 * the form capture a field the engine drops on the floor -- the exact shape of the dose_unit defect,
 * where a column existed, the screen asked, and the value fell between them.
 *
 * ⚠ FIELD KEYS ARE COLUMN NAMES, verbatim. The engine builds its insert from them, so a key that
 * drifts from the migration is refused by PostgREST loudly rather than silently mapped to nothing.
 */
export const TREATMENT_SUBTYPE: Record<string, {
  table: string;
  fields: { key: string; label: string; optional?: boolean }[];
}> = {
  wound_care: {
    table: "practice_treatment_wound_care",
    fields: [
      { key: "site", label: "Site / body area" },
      { key: "method", label: "Dressing / method" },
    ],
  },
  physiotherapy: {
    table: "practice_treatment_physiotherapy",
    fields: [
      { key: "intervention", label: "Intervention" },
      { key: "body_area", label: "Body area / indication" },
    ],
  },
  nutrition: {
    table: "practice_treatment_nutrition",
    fields: [
      { key: "plan", label: "Diet / plan" },
      { key: "targets", label: "Targets", optional: true },
    ],
  },
  respiratory: {
    table: "practice_treatment_respiratory",
    fields: [
      { key: "modality", label: "Modality" },
      { key: "parameters", label: "Parameters", optional: true },
    ],
  },
  device_support: {
    table: "practice_treatment_device",
    fields: [
      { key: "device", label: "Device / support" },
      { key: "site", label: "Site / indication", optional: true },
    ],
  },
  lifestyle: {
    table: "practice_treatment_lifestyle",
    fields: [
      { key: "intervention", label: "Intervention" },
      { key: "target", label: "Target", optional: true },
      { key: "review_interval", label: "Review interval", optional: true },
    ],
  },
};

/**
 * The one-line summary the Details column shows, composed from the subtype fields IN FIELD ORDER.
 *
 * ⚠ THE SUMMARY IS WRITTEN AS WELL AS THE STRUCTURE (into non_drug_category), on purpose. If migration
 * 296 is not applied, or a subtype write fails, the summary still carries what was typed -- structure
 * can be lost gracefully, content cannot. One function, called by the engine, asserted by the harness.
 */
export function composeSubtypeSummary(
  treatmentType: string, subtype: Record<string, string | null | undefined> | null | undefined,
): string | null {
  const def = TREATMENT_SUBTYPE[treatmentType];
  if (!def || !subtype) return null;
  const parts = def.fields.map(f => (subtype[f.key] ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export const DEFAULT_TREATMENT_SHAPE = { prescribing: false, nonDrug: false, hint: "" };

export function treatmentShape(code: string) {
  return TREATMENT_TYPE_SHAPE[code] ?? DEFAULT_TREATMENT_SHAPE;
}

/** The seven configurable lists migration 275 seeds. The CODES are fixed; the CONTENTS are not. */
export const TREATMENT_FIELD_KEYS = [
  "treatment_type", "formulation", "dose_unit", "route", "frequency", "duration", "non_drug_category",
] as const;
export type TreatmentFieldKey = typeof TREATMENT_FIELD_KEYS[number];

export const TREATMENT_FIELD_LABEL: Record<TreatmentFieldKey, string> = {
  treatment_type: "Treatment type",
  formulation: "Formulation",
  dose_unit: "Dose unit",
  route: "Route",
  frequency: "Frequency",
  duration: "Duration",
  non_drug_category: "Non-drug category",
};

/**
 * CPR-TREAT-001 s5's escape hatch, and the ONE code every list must carry.
 *
 * ⚠ SELECTING THIS OPENS A TEXT FIELD AND THE EXACT ENTERED WORDING IS PRESERVED. s5, verbatim:
 * "Selecting Other for Frequency opens a compact custom-frequency field. The exact entered wording must
 * be preserved in the encounter record." It lands in practice_treatment.frequency unparsed, with
 * frequency_code left NULL so a reader can tell a typed frequency from a chosen one.
 */
export const OTHER_OPTION_CODE = "other";

export const CUSTOM_WORDING_PRESERVED =
  "Whatever you type here is stored exactly as you wrote it. Nothing rewrites it and nothing parses it.";

// ── THE NON-EMR BOUNDARY -- CPR-TREAT-001 s16 ───────────────────────────────────────────────────────

/**
 * ⚠ THE SENTENCE ON THE TAB. It may not be shortened for layout. It is the difference between a record
 * of a decision and a claim that a drug reached a patient.
 */
export const TREATMENT_BOUNDARY =
  "This records what was prescribed or decided, not what was administered. Competen Practice holds no "
  + "inpatient medication administration chart, nothing here is sent to a pharmacy, and a prescription "
  + "recorded here is not evidence that anything was given or dispensed.";

export const TREATMENT_REFUSALS: { key: string; what: string; why: string }[] = [
  {
    key: "no_administration",
    what: "There is no administration record.",
    why: "A prescription is a decision. Whether a dose was given is not something this product can observe.",
  },
  {
    key: "no_dispensing",
    what: "Nothing here implies a pharmacy dispensed anything.",
    why: "There is no pharmacy integration, so nothing was transmitted and nothing was confirmed.",
  },
  {
    key: "no_reconciled_list",
    what: "This is not a reconciled medication list.",
    why: "The patient's medication record is separate, and rows nobody has verified are labelled unverified there.",
  },
  {
    key: "not_a_recommendation",
    what: "Favourites, frequently used items and templates are not clinical recommendations.",
    why: "They are counts, pins and things somebody in this practice saved. Competen suggests no treatment.",
  },
];

/** CPR-TREAT-001 s12, printed beside the Quick Add row and beside the template list. */
export const QUICK_ADD_NOT_A_RECOMMENDATION =
  "These are what you prescribe most and what you saved. They are a shortcut for typing, not advice, and "
  + "Competen is not suggesting any of them for this patient.";

/**
 * CPR-TREAT-001 s11 and s12: a template NEVER bypasses a safety check.
 *
 * ⚠ THE SHAPE ENFORCES IT, NOT THIS SENTENCE. A template holds field values only. Applying one fills
 * the builder as if the values had been typed, and every check runs at the moment of recording against
 * the patient in front of the practitioner. There is nowhere in the schema for a stale verdict to live.
 */
export const TEMPLATES_ARE_REVALIDATED =
  "A template fills the fields in. It never carries a safety decision with it, and everything is checked "
  + "again against this patient before anything is recorded.";

// ── THE SAFETY CHECKPOINT -- CPR-TREAT-001 s10 and s11 ──────────────────────────────────────────────

/**
 * s11: "Warnings must distinguish MISSING INFORMATION from an actual detected medication risk" and
 * "Do not claim safe merely because a rule could not be evaluated."
 *
 * ⚠ THREE VERDICTS, NOT TWO. `unknown` is not `clear`, and the screen renders them differently on
 * purpose. A checkpoint with no red on it must never read as a checkpoint that passed.
 */
export const SAFETY_VERDICTS = ["clear", "unknown", "flagged"] as const;
export type SafetyVerdict = typeof SAFETY_VERDICTS[number];

export const SAFETY_VERDICT_CHIP: Record<SafetyVerdict, string> = {
  clear: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  unknown: "border border-dashed border-slate-300 bg-white text-slate-500",
  flagged: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

export const SAFETY_VERDICT_MARK: Record<SafetyVerdict, string> = {
  clear: "ok", unknown: "not checked", flagged: "check this",
};

/**
 * s10's allergy row. "If unknown/not recorded, display a PROMINENT UNRESOLVED STATE and quick actions."
 *
 * ⚠ AN EMPTY ALLERGY LIST IS `unknown`, NOT `clear`. Nobody has said this patient has no allergies --
 * the list is simply empty, and those are different facts. AC-08 is exactly this distinction.
 */
/**
 * The left-edge band on a recorded treatment row: HOW FAR ALONG IS THIS PLAN.
 *
 * ⚠ THE THIRD USE OF ONE GRAMMAR, ON A THIRD QUESTION. diagnosisBand weighs how settled a finding is,
 * procedureBand how far an act got, and this how live a plan is. Same hue, same three weights, same
 * treatment of the negative case -- so a clinician learns the scheme once and reads it on every tab,
 * and the alert palette stays reserved for something actually going wrong.
 *
 * ⚠ CANCELLED LEAVES THE RAMP: struck and dashed, like ruled_out and like a declined procedure. A
 * cancelled prescription skim-read as live is the misreading with consequences on this tab.
 *
 * ⚠ AN UNRECOGNISED STATUS FALLS TO THE WEAKEST BAND, NEVER COMPLETED. Values are practice_treatment's
 * (migration 194): planned, in_progress, completed, cancelled.
 */
/**
 * practice_treatment's OWN status set, from migration 194's CHECK.
 *
 * ⚠ IT LIVES HERE, NOT IN THE ENGINE, BECAUSE THE SCREEN NEEDS IT TOO. CPR-PD-013 s5's status control
 * renders one option per value, and importing the list from treatment-capture.ts would have pulled a
 * server engine -- Supabase client and all -- into a client bundle. A type-only import is erased; a
 * value import is not. The engine imports it back from here so there is still exactly one list.
 */
export const TREATMENT_STATUSES = ["planned", "in_progress", "completed", "cancelled"];

export function treatmentBand(status: string): { edge: string; dashed: boolean; struck: boolean } {
  switch (status) {
    case "completed":
      return { edge: "var(--cp-primary)", dashed: false, struck: false };
    case "in_progress":
      return { edge: "color-mix(in srgb, var(--cp-primary) 55%, transparent)", dashed: false, struck: false };
    case "cancelled":
      return { edge: "var(--cmp-text-neutral)", dashed: true, struck: true };
    case "planned":
    default:
      return { edge: "color-mix(in srgb, var(--cp-primary) 26%, transparent)", dashed: false, struck: false };
  }
}

export const ALLERGY_UNRESOLVED_HEADLINE = "Allergy status has not been recorded for this patient.";
export const ALLERGY_UNRESOLVED_ASK =
  "Nobody has said whether this patient has drug allergies. An empty list is not the same as no known "
  + "allergies, and this is the one thing worth settling before you prescribe.";

/**
 * s10's two quick actions, BOTH WIRED, to a store, engine and route that already existed.
 *
 * ⚠ THE EARLIER VERSION OF THIS CONSTANT WAS WRONG AND IS RECORDED HERE RATHER THAN DELETED. It said
 * there was nowhere to record "no known drug allergies" as a fact. There is:
 * practice_patient.allergy_status (migration 238) holds `none_known` WITH the person who said it and
 * the time they said it, and recordAllergyReview in longitudinal.ts is the only thing that can set it.
 * The store, the engine and the route all existed; NOTHING IN THE PRODUCT CALLED THEM, which is a
 * different failure and the one that was actually fixed.
 *
 * ⚠ THE RULE THAT MAKES THE BUTTON MEANINGFUL. An empty allergy list is NOT an answer. Only a
 * practitioner pressing this turns the screen's sentence into a reassuring one, and the engine refuses
 * it outright while allergies are listed.
 */
export const NKDA_IS_SOMETHING_SOMEBODY_SAID =
  "“No known drug allergies” is only ever true because somebody said it. Pressing this records "
  + "that you asked and what the answer was, with your name and the time on it. An empty list on its own "
  + "never produces that sentence.";

// ── THE PENDING PLAN -- CPR-TREAT-001 s9 ────────────────────────────────────────────────────────────

export const BATCH_BOUNDARY =
  "Everything below is recorded together when you press the button. Each one becomes its own auditable "
  + "record, and you are told individually if any of them is refused.";

export const MAX_PENDING_TREATMENTS = 25;

/**
 * CPR-TREAT-001 s15: "Return per-item success/failure WITHOUT SILENTLY DROPPING TREATMENTS."
 *
 * These are the codes the batch recorder returns per item. A screen renders the message it was given
 * rather than inventing one from the code, but the codes are enumerated so a harness can assert on them.
 */
export const BATCH_ITEM_CODES = [
  "VALIDATION_ERROR", "MEDICATION_NOT_RECORDED", "REFUSED_BY_DATABASE", "FORBIDDEN",
] as const;

// ── STORE PRESENCE ──────────────────────────────────────────────────────────────────────────────────

export const TREATMENT_CONFIG_MIGRATION = "275-investigation-catalogue-and-treatment-configuration";

export const TREATMENT_CONFIG_ABSENT_NOTICE =
  `The configurable treatment lists have no store in this deployment. Migration "${TREATMENT_CONFIG_MIGRATION}" `
  + "has not been applied, so there are no formulations, routes, frequencies or durations to tap. This is "
  + "NOT an empty configuration. Recording a treatment by typing still works, and the wording is kept.";
