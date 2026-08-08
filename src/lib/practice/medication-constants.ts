// CPR-MED-001 -- the medication vocabulary and its readers, in a module with NO SERVER IMPORTS.
//
// It lives apart from medication.ts for the reason parameters-constants.ts and encounter-constants.ts
// already exist: medication.ts imports access.ts, which imports `next/headers`, and a "use client"
// component importing so much as a string from it drags that chain into the browser bundle. `next build`
// fails where tsc and eslint pass. A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE
// DATABASE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ONE RULE EVERY READER BELOW OBEYS, AND IT IS WHY THIS BUILD IS THE SHAPE IT IS.
//
// The user's scope decision of 2026-08-07: build MED-001 s2 (the record), s6 (the timeline), s7
// (monitoring), s9 (the practitioner experience) and s3's mg/kg arithmetic. DEFER s4's max-dose,
// duplicate-therapy, allergy and interaction checks entirely -- they need a licensed drug knowledge base
// this product does not have and has not bought.
//
// A DEFERRED CHECK IS NOT A CHECK THAT PASSED, AND "NOT CHECKED" IS A REFUSAL RATHER THAN A REPORT OF
// NO FINDINGS. Every one of the nine in DEFERRED_SAFETY_CHECKS is rendered on the prescribing screen, by
// name, in those words, with the reason. It is never omitted and never silent, because AN UNWARNED
// SCREEN READS AS A CLEARED SCREEN. The rule tables that would have made the checks runnable were
// PROPOSED AND DECLINED on a stated ground -- an empty rule table makes every check return nothing to
// say, WHICH A CLINICIAN READS AS SAFE -- so shipping them empty would have been worse than not shipping
// them. This is migration 238's allergy lesson, written in its own comment:
//
//   "NO KNOWN ALLERGIES and NOBODY HAS ASKED are different answers."
//
// The same sentence governs the dose calculator. It performs arithmetic on a weight this product
// recorded and can cite, it shows every step of that arithmetic, and IT MAKES NO SAFETY CLAIM -- there
// is no maximum, no minimum, no indication and no renal adjustment behind the number. doseSafetyNotice()
// is the sentence that must appear beside the figure, and no screen may print the figure without it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every capability code this engine gates on.
 *
 * ⚠ EXPORTED AS AN ARRAY BECAUSE THE AUDIT HARNESS CANNOT SEE IT OTHERWISE.
 * `capabilityCodesInSource()` in practice-audit-harness.ts matches only three regexes, all of which
 * require an INLINE DOUBLE-QUOTED LITERAL at the call site. A code introduced through a constants object
 * is invisible to it -- and an invented capability code compiles, passes review, and returns 403 for
 * every user including the practice owner, so the feature is simply unreachable and nothing errors
 * anywhere. Six have shipped in this codebase that way, and 47 codes were live when this was written.
 * This array is the compensating convention PARAMETER_CAPABILITIES and LONGITUDINAL_CAPABILITIES
 * established, and the medication harness asserts every entry exists in practice_role_capabilities.
 *
 * ⚠ ALL THREE ARE SEEDED BY THE MIGRATION IN medication.ts's HEADER, WHICH IS NOT YET APPLIED. Until it
 * is, the harness assertion that they exist is expected to report them absent and says so in those
 * words rather than failing silently -- see MEDICATION_MIGRATION.
 */
export const MEDICATION_CAPABILITIES = [
  "medication.view", "medication.record", "medication.override",
] as const;

export const CAP_MED_VIEW = "medication.view";
export const CAP_MED_RECORD = "medication.record";
export const CAP_MED_OVERRIDE = "medication.override";

// ── MED s2 THE MEDICATION DATA MODEL ─────────────────────────────────────────────────────────────────

/**
 * MED s2's four statuses, verbatim: "Active, completed, paused and discontinued status."
 *
 * ⚠ THESE ARE NOT practice_treatment's FOUR. That table's are planned/in_progress/completed/cancelled --
 * the lifecycle of a DECISION taken inside one consultation. These are the lifecycle of a COURSE that
 * outlives the consultation that started it, which is the whole reason a second table exists.
 */
export const MEDICATION_STATUSES: [string, string, string][] = [
  ["active", "Active", "Being taken now, as recorded here."],
  ["completed", "Completed", "The course finished as intended."],
  ["paused", "Paused", "Temporarily stopped, expected to resume."],
  ["discontinued", "Discontinued", "Stopped and not expected to resume."],
];
export const MEDICATION_STATUS_CODES = MEDICATION_STATUSES.map(([k]) => k);
export const MEDICATION_STATUS_LABEL: Record<string, string> = Object.fromEntries(MEDICATION_STATUSES.map(([k, l]) => [k, l]));
export const MEDICATION_STATUS_MEANING: Record<string, string> = Object.fromEntries(MEDICATION_STATUSES.map(([k, , m]) => [k, m]));

/** The statuses that mean the patient is taking it. Used by currentLine and by nothing else. */
export const STATUSES_IN_USE = ["active"] as const;

/**
 * MED s2: "Patient-reported vs practitioner-recorded."
 *
 * ⚠ THE SOURCE IS THE WHOLE OF THE RECONCILIATION PROBLEM. LCP s9: "Patient-reported medication doses
 * are labelled unverified until reviewed by a practitioner." A row somebody's patient told them about
 * and a row a practitioner decided are both real and are not the same evidence, and a list that mixed
 * them without saying which was which would let the weaker one inherit the authority of the stronger.
 */
export const MEDICATION_SOURCES: [string, string, string][] = [
  ["practitioner", "Practitioner-recorded", "Decided or confirmed by a practitioner at this practice."],
  ["patient_reported", "Patient-reported", "What the patient said they are taking. Nobody here has confirmed it."],
  ["imported", "Imported", "Carried in from another record. Nobody here has confirmed it."],
];
export const MEDICATION_SOURCE_CODES = MEDICATION_SOURCES.map(([k]) => k);
export const MEDICATION_SOURCE_LABEL: Record<string, string> = Object.fromEntries(MEDICATION_SOURCES.map(([k, l]) => [k, l]));

/** The sources whose rows must be labelled unverified until a practitioner reviews them. LCP s9. */
export const SOURCES_NEEDING_VERIFICATION = ["patient_reported", "imported"] as const;

// ── MED s6 THE LONGITUDINAL MEDICATION TIMELINE ──────────────────────────────────────────────────────

/**
 * s6's six subjects, as event types, plus the three lifecycle events a timeline is unreadable without.
 *
 * s6 verbatim: "Medication history / Dose changes / Reasons for changes / Adverse drug reactions /
 * Adherence notes / Effectiveness observations."
 *
 * ⚠ `safety_override` IS THE NINTH AND IT IS NOT s6's. It is MED s5's "Practitioner override with
 * justification" given the only home it can honestly have in this build. s5's warning severities govern
 * checks that need a drug knowledge base and are deferred; the ONE check that does run is the weight
 * validation LCP s9 demands, and prescribing weight-based anyway when the weight is absent or stale is a
 * clinical act that must leave a trace. It is an EVENT rather than a row in a warnings table because
 * there is no warnings table -- see NO_WARNING_STORE.
 */
export const MEDICATION_EVENT_TYPES: [string, string][] = [
  ["started", "Started"],
  ["dose_changed", "Dose changed"],
  ["paused", "Paused"],
  ["resumed", "Resumed"],
  ["discontinued", "Discontinued"],
  ["completed", "Completed"],
  ["adverse_reaction", "Adverse reaction"],
  ["adherence_note", "Adherence note"],
  ["effectiveness_note", "Effectiveness observation"],
  ["verified", "Verified by a practitioner"],
  ["safety_override", "Safety override"],
];
export const MEDICATION_EVENT_TYPE_CODES = MEDICATION_EVENT_TYPES.map(([k]) => k);
export const MEDICATION_EVENT_LABEL: Record<string, string> = Object.fromEntries(MEDICATION_EVENT_TYPES);

/**
 * The event types the database refuses without a reason.
 *
 * ⚠ ENFORCED IN SQL, NOT HERE. The check constraint is in the migration and this array only tells a
 * form which fields to make mandatory. A validation that lives only in TypeScript is a validation the
 * next caller does not have.
 */
export const EVENTS_REQUIRING_REASON = ["dose_changed", "discontinued", "safety_override"] as const;

// ── MED s3 THE DOSE BASES ────────────────────────────────────────────────────────────────────────────

/** s3's four regimen kinds, verbatim: "Weight-based (mg/kg) / Daily dose (mg/kg/day) / Body surface area (mg/m2) / Fixed-dose regimens." */
export const DOSE_BASES: [string, string, string][] = [
  ["mg_per_kg", "Per kilogram (mg/kg)", "One dose, computed from the patient's weight."],
  ["mg_per_kg_per_day", "Per kilogram per day (mg/kg/day)", "A daily total from weight, then divided into the doses given each day."],
  ["mg_per_m2", "Per square metre (mg/m2)", "One dose, computed from body surface area."],
  ["fixed", "Fixed dose", "A stated dose that does not depend on the patient's size. No arithmetic is performed."],
];
export const DOSE_BASIS_CODES = DOSE_BASES.map(([k]) => k);
export const DOSE_BASIS_LABEL: Record<string, string> = Object.fromEntries(DOSE_BASES.map(([k, l]) => [k, l]));

/** The bases that cannot be computed without a weight this product recorded. */
export const BASES_NEEDING_WEIGHT = ["mg_per_kg", "mg_per_kg_per_day", "mg_per_m2"] as const;
/** The one basis that also needs a height, because body surface area is a function of both. */
export const BASES_NEEDING_HEIGHT = ["mg_per_m2"] as const;

/**
 * The parameter codes the dose engine reads out of CPR-LCP-001's library.
 *
 * ⚠ THESE ARE THE CODES MIGRATION 246's CORE LIBRARY SHIPS, and they are named here rather than looked
 * up by display name. A display name is edited; a code is the thing a formula refers to. If a practice
 * has not activated weight, the dose engine says the weight is absent -- it does not go looking for
 * something that resembles a weight.
 */
export const WEIGHT_PARAMETER_CODE = "weight";
/**
 * ⚠ `standing_height`, NOT `height`, AND THE FIRST VERSION OF THIS FILE HAD IT WRONG.
 *
 * Migration 246's core library has no parameter coded `height`. It has `standing_height` and
 * `recumbent_length`, because they are two different measurements taken two different ways, and LCP s5.1
 * ships both. A code that matches nothing does not error -- dosingMeasurement simply returns nothing, and
 * every mg/m2 calculation would have reported "no height recorded" for a patient who had been measured
 * that morning. Caught by the harness, which reads the codes out of the live library rather than
 * trusting this constant.
 *
 * ⚠ AND recumbent_length IS NOT SUBSTITUTED WHEN STANDING HEIGHT IS ABSENT. A length measured lying down
 * is systematically larger than a height measured standing, LCP's own BSA derivation uses
 * standing_height, and an engine that quietly swapped one for the other would produce a body surface
 * area that disagreed with the one the parameter engine derived for the same patient on the same day.
 */
export const HEIGHT_PARAMETER_CODE = "standing_height";
/** Migration 246 codes the derived body surface area `bsa`. */
export const BSA_PARAMETER_CODE = "bsa";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READERS
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE MOST IMPORTANT FUNCTION IN THIS FILE. It is the sentence that goes beside every computed dose,
 * and it is the reason the calculator is allowed to exist at all.
 *
 * clinical-calculators.ts refused dosing calculators for a stated reason: "getting it right needs a drug
 * database, a route, a renal adjustment and an indication -- none of which this product has." The
 * arithmetic now exists because CPR-LCP-001 shipped a weight series the engine can cite. THE REASON FOR
 * THE REFUSAL DID NOT GO AWAY. So the number is produced, its working is shown, and this sentence says
 * what nobody checked.
 */
export function doseSafetyNotice(): string {
  return "This is arithmetic, not a safety check. It multiplies a dose you typed by a weight this record "
    + "holds and shows every step. Nothing here knows a maximum dose, a minimum dose, this drug's licensed "
    + "age range, what else the patient is taking, or their kidney or liver function. Check the dose against "
    + "your own reference before prescribing.";
}

/**
 * ⚠ THE EIGHT CHECKS MED s4 ASKS FOR THAT THIS BUILD DOES NOT PERFORM, EACH RENDERED BY NAME.
 *
 * A screen that simply lacks a warnings panel looks like a screen that found nothing wrong. This array
 * is what the prescribing surface prints instead: nine named checks, each in the state `not_checked`,
 * each with the reason and what would close it. It travels in the API payload for the same reason
 * PARAMETER_REFUSALS does.
 *
 * ⚠ THE SHARPEST ONE IS `allergy`, AND IT IS NOT DEFERRED FOR LACK OF EFFORT. Migration 238 made
 * practice_patient_allergy.substance FREE TEXT deliberately -- "Not coded: a coding nobody performed is
 * CPR-330's rule" -- and a medication's generic name is free text here for the same reason. Matching two
 * free-text strings and calling the result an allergy check is WORSE than not checking, because a miss
 * renders as safety. The allergy list is therefore DISPLAYED beside the prescribing form, always, and no
 * automated verdict is drawn from it. That display is allergyDisplayNotice() below.
 */
export const DEFERRED_SAFETY_CHECKS = [
  {
    key: "max_single_dose",
    label: "Maximum single dose",
    detail:
      "MED-001 s4 asks for a maximum single dose check. Nothing in this product holds a maximum dose for any drug, and neither MED-001 nor any specification in this family supplies one. An empty rule table makes every check return nothing to say, which a clinician reads as safe.",
    wouldRequire: "A licensed drug knowledge base with per-drug, per-route, per-indication maxima, a named evidence source, a version and a review cadence.",
  },
  {
    key: "max_daily_dose",
    label: "Maximum daily dose",
    detail:
      "The same absence as the single-dose maximum, over twenty-four hours. The daily total this engine computes for a mg/kg/day regimen is arithmetic on what you typed; nothing compares it to a ceiling.",
    wouldRequire: "The same knowledge base, plus the frequency semantics to know what a day means for this regimen.",
  },
  {
    key: "underdose",
    label: "Underdose detection",
    detail:
      "An underdose is a dose below a therapeutic minimum. There is no therapeutic minimum for any drug in this product, so nothing is compared and nothing is flagged.",
    wouldRequire: "Per-drug, per-indication minimum effective doses from a licensed source.",
  },
  {
    key: "overdose",
    label: "Overdose detection",
    detail:
      "An overdose is a dose above a maximum. See the maximum single and daily dose checks: there is no maximum recorded anywhere in this product.",
    wouldRequire: "The same knowledge base as the maximum-dose checks.",
  },
  {
    key: "age_validation",
    label: "Age validation",
    detail:
      "MED-001 s4 asks whether this drug is licensed for a patient of this age. The patient's age is known -- practice_patient holds a birth date or an age estimate -- but no licensed age range for any drug is held anywhere, so there is nothing to validate it against. Knowing one half of a comparison is not performing it.",
    wouldRequire: "Per-drug licensed age and weight ranges from a licensed source.",
  },
  {
    key: "duplicate_therapy",
    label: "Duplicate therapy",
    detail:
      "Two medications are duplicate therapy when they share a therapeutic class or an active moiety. Medication names here are free text, and two free-text strings cannot be known to name the same class. Matching on spelling would miss every brand name and every synonym, and a miss on this screen renders as safety.",
    wouldRequire: "A coded drug vocabulary on every medication row, with a class hierarchy behind it.",
  },
  {
    key: "allergy",
    label: "Allergy checking",
    detail:
      "practice_patient_allergy.substance is FREE TEXT by migration 238's deliberate decision -- \"Not coded: a coding nobody performed is CPR-330's rule\" -- and a medication's generic name is free text on the same reasoning. Matching two free-text strings and calling the result an allergy check is worse than not checking, because a miss renders as safety. The recorded allergies are DISPLAYED beside every prescribing form instead, unmatched and unjudged, so a person does the comparison a computer cannot honestly do here.",
    wouldRequire: "A coded allergen vocabulary on the allergy row and a coded drug vocabulary on the medication row, with cross-sensitivity relations between them.",
  },
  {
    key: "interaction",
    label: "Drug interaction checking",
    detail:
      "MED-001 s4 itself calls this a \"drug interaction framework (future knowledge base)\". There is no interaction data in this product and none is specified. Nothing is compared against anything.",
    wouldRequire: "A licensed interaction database, coded drug identities on both sides, and a maintenance obligation to keep it current -- an interaction table six months stale is more dangerous than none, because clinicians will have learned to trust it.",
  },
  {
    key: "renal_hepatic_adjustment",
    label: "Renal and hepatic dose adjustment",
    detail:
      "MED-001 s4 asks for hooks, not adjustments. This build has neither. clinical-calculators.ts computes an eGFR from numbers a user types, and that figure is not read by anything here: an eGFR is not a dose adjustment, and turning one into the other needs a per-drug rule this product does not hold.",
    wouldRequire: "Per-drug renal and hepatic adjustment rules, plus a recorded renal function this engine may read rather than one a user typed into a calculator.",
  },
] as const;

export const DEFERRED_CHECK_KEYS = DEFERRED_SAFETY_CHECKS.map(c => c.key);

/**
 * The one sentence that has to travel with the allergy list wherever a prescribing form draws it.
 *
 * ⚠ IT IS A DISPLAY, AND IT SAYS SO. The moment this sentence is dropped, a clinician who sees an
 * allergy panel on a prescribing screen and no warning on it concludes the drug was checked against it.
 */
export function allergyDisplayNotice(): string {
  return "Recorded allergies, shown so you can read them. They are NOT matched against this medication: "
    + "allergy substances and medication names are both free text here, and matching two free-text strings "
    + "would miss brand names and synonyms while looking like a check that passed.";
}

/**
 * MED s2's start and stop dates make "current" derivable FOR ROWS IN THIS STORE -- and for nothing else.
 *
 * ⚠ THE OLD REFUSAL IS STILL TRUE FOR practice_treatment, AND THE PRACTICE WILL HOLD BOTH FOR YEARS.
 * REFUSES.current_medications said "current is not derivable at all, not merely unreliable" of a table
 * whose `duration` is free text with no end date. That table is unchanged. This function answers only
 * for practice_medication rows, and legacyBoundary() below is what a screen prints about the rest.
 */
export type CurrentVerdict = {
  state: "in_use" | "stopped" | "not_started" | "unreadable";
  text: string;
  /** True only for `in_use`. A screen may put a medication under a "taking now" heading only from this. */
  inUse: boolean;
};

export function currentLine(input: {
  status: string | null;
  startedOn: string | null;
  stoppedOn: string | null;
  /** ISO date, the practice's own today. Never `new Date()` inside this function. */
  today: string;
  unavailable: boolean;
}): CurrentVerdict {
  if (input.unavailable)
    return { state: "unreadable", text: "Whether this is still being taken could not be read", inUse: false };

  // ⚠ THE STATUS IS THE ANSWER AND THE DATES ARE THE CHECK, IN THAT ORDER. A status somebody set is a
  // fact; a date arithmetic that overruled it would be this engine deciding a course had ended because
  // a stop date passed, when the practitioner who wrote the row is the one who knows.
  if (input.status && input.status !== "active") {
    const label = MEDICATION_STATUS_LABEL[input.status] ?? input.status;
    const when = input.stoppedOn ? ` on ${input.stoppedOn}` : "";
    return { state: "stopped", text: `${label}${when}`, inUse: false };
  }
  if (input.startedOn && input.startedOn > input.today)
    return { state: "not_started", text: `Recorded as starting ${input.startedOn}, which is in the future`, inUse: false };
  // An active row whose stop date has passed is a contradiction and is reported as one rather than
  // silently resolved either way.
  if (input.stoppedOn && input.stoppedOn < input.today)
    return {
      state: "stopped",
      text: `Marked active but with a stop date of ${input.stoppedOn}, which has passed. Somebody needs to close this row.`,
      inUse: false,
    };
  const since = input.startedOn ? ` since ${input.startedOn}` : " (no start date recorded)";
  return { state: "in_use", text: `Active${since}`, inUse: true };
}

/**
 * LCP s9: "Patient-reported medication doses are labelled unverified until reviewed by a practitioner."
 *
 * ⚠ UNVERIFIED IS NOT DOUBTED. A patient telling you what they take is often the only source there is,
 * and a screen that treated it as suspect would train people to leave it out. This says who said so.
 */
export type VerificationVerdict = {
  state: "practitioner_recorded" | "verified" | "unverified" | "unreadable";
  text: string;
  /** True when a practitioner is behind the row -- either they wrote it or they reviewed it. */
  practitionerBacked: boolean;
};

export function verificationLine(input: {
  source: string | null;
  verifiedAt: string | null;
  unavailable: boolean;
}): VerificationVerdict {
  if (input.unavailable)
    return { state: "unreadable", text: "How this was recorded could not be read", practitionerBacked: false };
  if (input.verifiedAt)
    return {
      state: "verified",
      text: `${MEDICATION_SOURCE_LABEL[input.source ?? ""] ?? "Recorded"}, reviewed by a practitioner on ${String(input.verifiedAt).slice(0, 10)}`,
      practitionerBacked: true,
    };
  if (input.source && (SOURCES_NEEDING_VERIFICATION as readonly string[]).includes(input.source))
    return {
      state: "unverified",
      text: `${MEDICATION_SOURCE_LABEL[input.source]} — not yet reviewed by a practitioner`,
      practitionerBacked: false,
    };
  return { state: "practitioner_recorded", text: "Practitioner-recorded", practitionerBacked: true };
}

/**
 * ⚠ LCP s9's WEIGHT RULE, AND THE THRESHOLD THIS FUNCTION REFUSES TO INVENT.
 *
 * s9 verbatim: "CP warns when the current weight is stale, implausible or absent." It does not say what
 * stale means, and no specification in this family does. A hard-coded number here -- ninety days, a year
 * -- would be a clinical judgement about every patient at once, published as though somebody had
 * approved it: it is wrong for a neonate on the day it is right for an adult.
 *
 * So STALENESS IS ONLY CLAIMED WHEN THE PATIENT'S OWN MONITORING PLAN STATES IT. CPR-LCP-001 already
 * gives every parameter a schedule and a next-due date per patient, and dueLine() already turns those
 * into overdue. A weight is stale when the plan that governs it says another was due and none came. When
 * no plan states a schedule, this returns `age_unjudged` -- the weight and its age are shown, and the
 * screen says nothing states when a new one is needed. That is the `not_checked` shape in a third
 * domain, and it is deliberately not reassuring.
 */
export type WeightVerdict = {
  state: "absent" | "implausible" | "stale" | "age_unjudged" | "current" | "unreadable";
  text: string;
  /** ⚠ True ONLY for `current`: a weight exists, is plausible, and a plan says it is not yet due again. */
  reassuring: boolean;
  /** Whether a dose may be computed at all. False only when there is no weight to multiply. */
  usable: boolean;
  ageDays: number | null;
  valueKg: number | null;
  effectiveAt: string | null;
};

const dayDiff = (from: string, to: string): number =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);

export function weightLine(input: {
  valueKg: number | null;
  effectiveAt: string | null;
  /** From plausibilityLine on the weight definition. `implausible` is the only value that matters here. */
  plausibility: "no_limits" | "plausible" | "implausible" | null;
  /** From CPR-LCP-001's dueLine on this patient's weight monitoring plan. Null when no plan governs it. */
  due: "overdue" | "due_today" | "due_later" | "on_next_contact" | "no_schedule" | "unreadable" | null;
  daysOverdue: number | null;
  today: string;
  unavailable: boolean;
}): WeightVerdict {
  const blank = { ageDays: null, valueKg: input.valueKg, effectiveAt: input.effectiveAt };
  if (input.unavailable)
    return { state: "unreadable", text: "The patient's weight could not be read — this is not the same as having none", reassuring: false, usable: false, ...blank };

  if (input.valueKg === null || input.effectiveAt === null)
    return {
      state: "absent", reassuring: false, usable: false, ...blank, ageDays: null,
      text: "No weight is recorded for this patient. A weight-based dose cannot be computed, and LCP-001 s9 requires a usable dosing weight before one is prescribed.",
    };

  const ageDays = dayDiff(input.effectiveAt, input.today);
  const stamp = `${input.valueKg} kg, recorded ${String(input.effectiveAt).slice(0, 10)} (${ageDays} day${ageDays === 1 ? "" : "s"} ago)`;

  if (input.plausibility === "implausible")
    return {
      state: "implausible", reassuring: false, usable: true, ...blank, ageDays,
      text: `${stamp}. This is outside the plausible range for the weight parameter — check the entry before using it for a dose.`,
    };

  if (input.due === "overdue")
    return {
      state: "stale", reassuring: false, usable: true, ...blank, ageDays,
      text: `${stamp}. This patient's monitoring plan says a new weight was due${input.daysOverdue !== null ? ` ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} ago` : ""} and none has been recorded.`,
    };

  // ⚠ THE HONEST DEFAULT, AND IT IS NOT A TICK. No schedule governs this weight, so nothing states when
  // it goes out of date. The age is shown and the judgement is left with the person making it.
  if (input.due === null || input.due === "no_schedule" || input.due === "on_next_contact" || input.due === "unreadable")
    return {
      state: "age_unjudged", reassuring: false, usable: true, ...blank, ageDays,
      text: `${stamp}. Nothing states when a new weight is needed for this patient, so this record does not call it current or stale — decide whether it is recent enough for this prescription.`,
    };

  return {
    state: "current", reassuring: true, usable: true, ...blank, ageDays,
    text: `${stamp}. This patient's monitoring plan does not have another weight due yet.`,
  };
}

// ── THE RECORDED WEIGHT DECISION ─────────────────────────────────────────────────────────────────────
//
// The user's ruling of 2026-08-08: "Permit dosing only on a weight recorded in the same session. If there
// is no weight, prompt the practitioner to make a decision and RECORD the decision."
//
// ⚠ REFUSING OUTRIGHT WAS CONSIDERED AND REJECTED, AND THE REASON IS THE WHOLE SHAPE OF THIS FILE'S
// WORDING. A prescriber who cannot get an answer out of the product works the dose out on paper, and then
// the decision has happened anyway with nothing recording that it did. The product loses the reasoning
// and the patient keeps the risk. So the prescriber proceeds, and the judgement that let them proceed is
// written down beside it, in words, on the same row -- migrations 259 and 265, and the same shape as s14's
// booking override and migration 238's outcome = 'other'.
//
// ⚠ AND NO NUMBER IS INVENTED BY LETTING THEM PROCEED. There is still nothing to multiply. What is
// recorded is the decision and what it was based on -- never a weight this product did not measure.

/**
 * The two weight states in which there is no number to work from, so the DECISION is what gets recorded.
 *
 * ⚠ THESE ARE THE TWO 259's CONSTRAINT NAMES, AND `unreadable` IS NOT AN OVERSIGHT ON EITHER SIDE.
 * `absent` means no weight was ever recorded. `unreadable` means the read failed. From the prescriber's
 * chair there is no number in either case -- but they are NOT the same sentence, and the two headlines
 * below say which happened, because a read that failed may succeed on a retry and a weight that was never
 * taken will not.
 *
 * ⚠ `stale`, `implausible` and `age_unjudged` are DELIBERATELY NOT HERE. In each of those a weight
 * EXISTS. The first two already put an override-reason field in front of the prescriber, and the third is
 * deliberately ungated -- see the gate in calculateDose.
 */
export const WEIGHT_STATES_NEEDING_DECISION = ["absent", "unreadable"] as const;

/**
 * ⚠ FREE TEXT, AND NOT A DROPDOWN, WHICH IS MIGRATION 259's OWN REASONING AND NOT A STYLE PREFERENCE.
 * The reasons are not enumerable in advance -- a parent-reported weight, an estimate from age, a figure
 * from last month's card, a child who could not be weighed. A closed vocabulary would be a list of
 * excuses to pick from, and the one that mattered would always be missing.
 */
export const WEIGHT_DECISION_ASK =
  "You may still prescribe. Say in one sentence what you are working from -- a parent-reported weight, an "
  + "estimate from age, a figure on last month's card, a child who could not be weighed. It is recorded on "
  + "this calculation and on the practice override register, and it travels with the prescription. NO DOSE "
  + "FIGURE IS PRODUCED: this product will not multiply by a weight it did not record, so what is kept is "
  + "your decision and what it was based on.";

/** The headline that says WHICH of the two happened. A failed read is not an absent weight. */
export function weightDecisionHeadline(state: string): string {
  return state === "unreadable"
    ? "This patient's weight COULD NOT BE READ. That is not the same as no weight having been recorded, "
      + "and the next step differs: a read that failed may succeed on a retry."
    : "NO WEIGHT HAS EVER BEEN RECORDED for this patient.";
}

/** The one sentence the engine refuses with, and the one the prescribing screen prints. Same words. */
export const weightDecisionPrompt = (state: string): string =>
  `${weightDecisionHeadline(state)} ${WEIGHT_DECISION_ASK}`;

/**
 * ⚠ THE ASYMMETRY, AND IT IS THE POINT RATHER THAN AN EXCEPTION TO IT.
 *
 * A decision may stand in for a missing MEASUREMENT -- a weight nobody could take, a height nobody
 * recorded. It cannot stand in for the ARITHMETIC. A mg/m2 dose with no surface area is not a dose made
 * on a stated judgement, it is a blank, so migration 265 kept bsa_m2 required for mg_per_m2 even with a
 * decision. This message therefore does NOT mention the decision at all: blaming a missing justification
 * for a missing measurement would send the prescriber to write one, and it would change nothing.
 */
export const BSA_NEEDS_MEASUREMENTS =
  "A body surface area dose is computed from a recorded weight and a recorded height, and at least one of "
  + "them is missing. Record both, or prescribe on a basis that does not need a surface area. This one "
  + "cannot be recorded without a surface area, because a mg/m2 dose with no surface area is not a dose -- "
  + "it is a blank.";

// ── AND WHO IT IS FOR: THE USER'S NARROWING OF 2026-08-08 ────────────────────────────────────────────
//
//   "This needs to apply to only a child <18 years. and that is okay to proceed."
//
// ⚠ THE ADULT BRANCH IS THE STATUS QUO ANTE AND NEEDS NO NEW JUSTIFICATION. Before migration 265 a
// weight-based dose with no weight was refused outright, for everybody. That refusal survives here,
// unchanged, for patients of 18 and over. It is the conservative branch.
//
// ⚠ AND IT MUST NOT MENTION A DECISION, A JUSTIFICATION, OR WORDS TO TYPE. Showing an adult prescriber a
// door that is not there is worse than a plain refusal: they write the words, the record refuses them
// anyway, and the next refusal they meet is one they have learned to argue with.

/** Under this, in completed years, the recorded-decision path is offered. At or over it, it is not. */
export const CHILD_AGE_LIMIT_YEARS = 18;

/**
 * ⚠ DERIVED AT THE MOMENT OF CALCULATION AND NEVER STORED. Doctrine 8: an age written into a row is
 * wrong the day after it is written, and a dose gate driven by a stale age is wrong in the direction
 * that matters -- a patient who was 17 when the row was written is not 17 forever.
 */
export type AgeVerdict = {
  state: "child" | "adult" | "unknown";
  /** Completed years. Null when nothing states an age -- NEVER 0, which is a newborn. */
  years: number | null;
  text: string;
  /**
   * ⚠ TRUE FOR `child` AND FOR `unknown`, AND THE SECOND ONE IS THE DELIBERATE PART.
   *
   * An unrecorded or unreadable date of birth is NOT an adult. Refusing on an unknown age pushes the
   * prescriber to work the dose out on paper, where nothing records that a decision was taken at all --
   * the exact harm this whole feature exists to prevent. A failed read is a third state everywhere else
   * in this engine and it is a third state here.
   */
  decisionPathOffered: boolean;
};

/**
 * Completed years between two ISO dates.
 *
 * ⚠ NOT (today.year - birth.year), AND NOT A DIVISION BY 365.25 EITHER. A birthday that has not yet come
 * round this year makes the patient a year younger than the subtraction says, and on a threshold of
 * exactly 18 that is the difference between the decision path being offered and refused. The
 * milliseconds-over-365.25 form used elsewhere in this codebase drifts across leap years and is wrong on
 * the birthday itself -- tolerable for an age band on a summary screen, not for a gate.
 */
export function completedYears(birthDate: string, today: string): number | null {
  const b = birthDate.slice(0, 10).split("-").map(Number);
  const t = today.slice(0, 10).split("-").map(Number);
  if (b.length !== 3 || t.length !== 3 || b.some(n => !Number.isFinite(n)) || t.some(n => !Number.isFinite(n)))
    return null;
  return t[0] - b[0] - (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]) ? 1 : 0);
}

export function ageLine(input: {
  birthDate: string | null;
  /** practice_patient.age_estimate_years, for the patients who do not know a date. */
  ageEstimateYears: number | null;
  today: string;
  unavailable: boolean;
}): AgeVerdict {
  if (input.unavailable)
    return {
      state: "unknown", years: null, decisionPathOffered: true,
      text: "This patient's record could not be read, so their age is not known here. That is NOT the same"
        + " as this patient being an adult, and this record does not treat it as one.",
    };

  const years = input.birthDate
    ? completedYears(input.birthDate, input.today)
    : (input.ageEstimateYears !== null && Number.isFinite(input.ageEstimateYears)
      ? Math.floor(input.ageEstimateYears) : null);

  if (years === null)
    return {
      state: "unknown", years: null, decisionPathOffered: true,
      text: "No date of birth and no age estimate are recorded for this patient, so nothing here states"
        + " whether they are a child. An unknown age is not an adult.",
    };

  if (years < CHILD_AGE_LIMIT_YEARS)
    return {
      state: "child", years, decisionPathOffered: true,
      text: `This patient is ${years} year${years === 1 ? "" : "s"} old${input.birthDate ? "" : " by the recorded estimate"}.`,
    };

  return {
    state: "adult", years, decisionPathOffered: false,
    text: `This patient is ${years} year${years === 1 ? "" : "s"} old${input.birthDate ? "" : " by the recorded estimate"}.`,
  };
}

/**
 * The refusal an adult prescriber meets, and it is exactly what this engine said before migration 265.
 *
 * ⚠ NOT ONE WORD ABOUT A DECISION, A JUSTIFICATION, OR ANYTHING TO WRITE. There is no second road here
 * and the sentence must not imply one.
 */
export const ADULT_NO_WEIGHT_REFUSED =
  "Record a weight for this patient, or prescribe on a basis that does not depend on one.";

/** Supplied where there IS a weight, so there is nothing for it to stand in for. Never silently dropped. */
export const WEIGHT_DECISION_NOT_APPLICABLE =
  "A recorded weight decision stands in for a weight this product does not have. This patient has one, so "
  + "there is nothing for it to stand in for and it has NOT been stored.";

/**
 * MED s7's "Review intervals" and "Monitoring reminders", as a verdict rather than a stored flag.
 *
 * DERIVED, NOT STORED. Doctrine 8: whether a review is overdue depends on the clock, so a boolean
 * written into a row is wrong from the moment the clock moves past it. `today` is a parameter so the
 * harness can assert every branch without waiting a day.
 */
export type ReviewVerdict = {
  state: "overdue" | "due_today" | "scheduled" | "no_review_set" | "not_applicable" | "unreadable";
  text: string;
  daysOverdue: number | null;
  nextReviewOn: string | null;
};

export function reviewLine(input: {
  nextReviewOn: string | null;
  reviewIntervalDays: number | null;
  status: string | null;
  today: string;
  unavailable: boolean;
}): ReviewVerdict {
  if (input.unavailable)
    return { state: "unreadable", text: "Whether a review is due could not be read", daysOverdue: null, nextReviewOn: null };
  // A discontinued course has nothing to review. Saying "overdue" about it would fill a worklist with
  // work nobody owes.
  if (input.status && input.status !== "active" && input.status !== "paused")
    return { state: "not_applicable", text: `No review is owed on a ${MEDICATION_STATUS_LABEL[input.status]?.toLowerCase() ?? input.status} medication`, daysOverdue: null, nextReviewOn: null };
  if (!input.nextReviewOn)
    return {
      state: "no_review_set",
      text: input.reviewIntervalDays
        ? `A review interval of ${input.reviewIntervalDays} days is set but no review date has been computed`
        : "No review interval is set for this medication",
      daysOverdue: null, nextReviewOn: null,
    };
  const days = dayDiff(input.nextReviewOn, input.today);
  if (days > 0)
    return { state: "overdue", text: `Review overdue by ${days} day${days === 1 ? "" : "s"} (due ${input.nextReviewOn})`, daysOverdue: days, nextReviewOn: input.nextReviewOn };
  if (days === 0)
    return { state: "due_today", text: "Review due today", daysOverdue: 0, nextReviewOn: input.nextReviewOn };
  return { state: "scheduled", text: `Review due ${input.nextReviewOn}`, daysOverdue: null, nextReviewOn: input.nextReviewOn };
}

/**
 * The reconciliation verdict for ONE patient: how many sources disagree and what is unreviewed.
 *
 * ⚠ ZERO OUTSTANDING IS NOT THE SAME AS RECONCILED, AND THIS FUNCTION SAYS SO. A patient nobody has
 * asked about has nothing outstanding either. `never_reviewed` is its own state for exactly that reason,
 * and it is the state a brand-new patient is in.
 */
export type ReconciliationVerdict = {
  state: "unreadable" | "nothing_recorded" | "never_reviewed" | "outstanding" | "reconciled";
  text: string;
  /** ⚠ True only for `reconciled`. Every list here is a length you can open. */
  reassuring: boolean;
  unverified: number;
  legacyOnly: number;
};

export function reconciliationLine(input: {
  /** Rows in practice_medication whose source needs verification and which have none. */
  unverified: number;
  /** practice_treatment medication rows with no practice_medication row linked to them. */
  legacyOnly: number;
  /** Rows in practice_medication at all. */
  total: number;
  /** Whether anybody has ever verified a row for this patient. */
  everReviewed: boolean;
  unavailable: boolean;
}): ReconciliationVerdict {
  if (input.unavailable)
    return { state: "unreadable", text: "The medication record could not be read — this is not the same as an empty one", reassuring: false, unverified: 0, legacyOnly: 0 };
  const counts = { unverified: input.unverified, legacyOnly: input.legacyOnly };
  if (input.total === 0 && input.legacyOnly === 0)
    return {
      state: "nothing_recorded", reassuring: false, ...counts,
      text: "No medications are recorded for this patient here. That is not the same as taking none — nobody has been asked in this record.",
    };
  if (input.unverified > 0 || input.legacyOnly > 0) {
    const parts: string[] = [];
    if (input.unverified > 0) parts.push(`${input.unverified} recorded from the patient or an import and not yet reviewed by a practitioner`);
    if (input.legacyOnly > 0) parts.push(`${input.legacyOnly} decided in a consultation before this record existed and not carried across`);
    return { state: "outstanding", reassuring: false, ...counts, text: `Not reconciled: ${parts.join("; ")}.` };
  }
  if (!input.everReviewed)
    return {
      state: "never_reviewed", reassuring: false, ...counts,
      text: "Nothing is outstanding, but no practitioner has reviewed this list. An empty worklist is not a reconciled record.",
    };
  return {
    state: "reconciled", reassuring: true, ...counts,
    text: "Every medication in this record is practitioner-recorded or practitioner-reviewed, and nothing decided in an earlier consultation is left uncarried.",
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ENGINE WILL NOT CLAIM
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THERE IS NO WARNING TABLE AND NO RULE TABLE, AND THEIR ABSENCE IS THE SCOPE DECISION.
 *
 * The survey proposed practice_medication_warning and practice_medication_rule, and both are declined.
 * The rule table would be an empty drug knowledge base, and an empty rule table makes every check return
 * nothing to say -- which is exactly the failure this whole file is written against. The warning table
 * would then be a store of the rows that empty table never produced.
 *
 * The one check that DOES run -- LCP s9's weight validation -- is clock-dependent, so it is derived on
 * read by weightLine() rather than stored, and a boolean written into a row would be wrong the moment
 * the clock moved past it. The one override that CAN be made is recorded as a
 * practice_medication_event of type `safety_override` with a reason the database demands.
 */
export const NO_WARNING_STORE = {
  key: "medication_warning_store",
  label: "Stored medication warnings and a drug rule table",
  detail:
    "MED-001 s4 asks for maximum-dose, duplicate-therapy, allergy and interaction checks, and s5 asks for four warning severities with overrides against them. Every one of those checks needs a licensed drug knowledge base: per-drug maxima, a coded drug vocabulary, a class hierarchy and an interaction set. This product has none of them and no specification in this family supplies one. THE TABLES WERE PROPOSED AND DECLINED, not overlooked, and the ground was stated: an empty rule table makes every check return nothing to say, WHICH A CLINICIAN READS AS SAFE. Shipping them empty would therefore be worse than not shipping them at all. So the tables are not created, the nine checks are printed by name in the state \"not checked\" -- which is a REFUSAL to comment, not a report of no findings -- and the one check that is computable from data this product genuinely holds, LCP-001 s9's weight validation, is derived on read rather than stored.",
  wouldRequire:
    "A chosen and licensed drug knowledge base, a coded drug identity on every medication row, an evidence source and version on every rule, and a maintenance commitment -- a max-dose table six months stale is more dangerous than none, because clinicians will have learned to trust it.",
} as const;

/**
 * ⚠ MED s9 ASKS FOR FAVOURITES AND TEMPLATES, AND NEITHER GETS A TABLE.
 *
 * A favourite that a practitioner has to curate is a second list to maintain, and the list that answers
 * "what do you usually prescribe" already exists: the medications this practitioner has actually
 * recorded. So favourites are DERIVED -- the distinct generic names this practitioner has prescribed,
 * most-used first, each figure the length of a list you can open. Nothing is stored, nothing goes stale,
 * and a new practitioner's empty list is the truth rather than an unconfigured feature.
 */
export const FAVOURITES_ARE_DERIVED = {
  key: "medication_favourites",
  label: "Curated favourite medications and prescribing templates",
  detail:
    "MED-001 s9 lists \"Favourite medications\" and \"Templates\". Neither is stored. The favourites panel is computed from what this practitioner has actually recorded in this workspace -- distinct generic names, most-used first, with the count being the length of a list that can be opened. A curated list would be a second thing to maintain and would go stale silently. A template beyond that is a prescribing protocol, which is governance rather than a shortcut, and belongs with the guidance engine rather than in a medication row.",
  wouldRequire: "A decision that a curated list is worth maintaining separately from what people actually prescribe, and a governance route for a prescribing protocol.",
} as const;

/**
 * ⚠ THE LINE MED-001 DOES NOT CROSS AND THIS BUILD DOES NOT EITHER.
 *
 * practice_treatment's header: "NOT an administration chart: ADR-01 keeps this a record of what the
 * practitioner decided, not what a ward gave." Migration 238 s3: "THIS IS NOT AN ORDER SYSTEM AND MUST
 * NOT BECOME ONE." MED-001 asks for neither, and it is restated because s2's prescriber field and s7's
 * monitoring plans are the first two steps along that road.
 */
export const NO_TRANSMISSION = {
  key: "medication_transmission",
  label: "Sending a prescription anywhere",
  detail:
    "Nothing here is transmitted. There is no pharmacy interface, no electronic prescription, no administration record and no order/result loop. A medication row is what a practitioner decided or what a patient reported, and printing it is the Documents engine's job with a version, a signature and a release register behind it.",
  wouldRequire: "A pharmacy interface, a prescriber identity a pharmacy would accept, and a regulatory position this product has not taken.",
} as const;

export const MEDICATION_REFUSALS = [
  NO_WARNING_STORE, FAVOURITES_ARE_DERIVED, NO_TRANSMISSION,
] as const;

/**
 * ⚠ THE SENTENCE THAT TRAVELS WITH EVERY MEDICATION LIST, AND IT IS THE HALF-MIGRATED TRUTH.
 *
 * REFUSES.current_medications in patient-workspace-constants.ts refused a current-medication list
 * because practice_treatment.duration is free text with no computable end. That table is unchanged and
 * this practice will hold both kinds of row for years. So "current" is now derivable HERE and nowhere
 * else, and every screen that says it must also say what is not in it.
 */
export const MEDICATION_LIST_BOUNDARY =
  "Current as recorded in this medication record. Medications decided in a consultation before this "
  + "record existed are treatment decisions with free-text durations and no computable end — they are "
  + "listed separately, under their own heading, and are not counted here. Anything prescribed elsewhere "
  + "is in this list only if somebody entered it.";

/** Why the legacy rows are kept apart, in one field, for a payload consumer that needs the reason. */
export const LEGACY_TREATMENT_REASON =
  "practice_treatment.duration is free text ('5 days', 'until review'), it has no start or stop date, no "
  + "stop event and no source, so a course decided in an earlier consultation cannot be known to have "
  + "ended. Those rows are shown as what they are — decisions taken in a consultation — and are offered "
  + "for carrying across into this record, which is the only thing that can make them current.";

/** MED s6. The sentence that travels with the timeline. */
export const TIMELINE_BOUNDARY =
  "Every change to this medication, oldest last. The timeline is append-only — the database has no update "
  + "path on it — so a correction is a new entry and nothing already written is rewritten.";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR
//
// ⚠ HUE TOKENS, NOT A SECOND PALETTE. palette.ts owns SEVERITY and the swatch maps and is held by
// another agent; parameters-constants.ts recorded the same constraint and the same resolution. Every
// value below is an EXISTING --cp or Tailwind token already carrying this meaning elsewhere in Practice.
// When palette.ts is free these belong in it as MEDICATION_STATUS_CHIP and MEDICATION_STATE_TONE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const MEDICATION_STATUS_CHIP: Record<string, string> = {
  active: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
  completed: "bg-slate-100 text-slate-600",
  paused: "bg-amber-100 text-amber-800",
  discontinued: "bg-slate-200 text-slate-600",
};

/**
 * ⚠ `age_unjudged` AND `not_checked` ARE SLATE WITH A DASHED BORDER, NOT GREEN AND NOT RED.
 *
 * They are the states a screen would otherwise draw as nothing at all, and nothing at all is what a
 * reader takes for "fine". Only `current` -- a weight that exists, is plausible, and that a plan says is
 * not yet due again -- gets the tick.
 */
export const WEIGHT_TONE: Record<string, { chip: string; mark: string; label: string }> = {
  current: { chip: "bg-emerald-100 text-emerald-800", mark: "✓", label: "Weight current" },
  stale: { chip: "bg-rose-100 text-rose-800", mark: "!", label: "Weight overdue" },
  implausible: { chip: "bg-rose-100 text-rose-800", mark: "!", label: "Weight implausible" },
  absent: { chip: "bg-amber-100 text-amber-800", mark: "○", label: "No weight" },
  age_unjudged: { chip: "border border-dashed border-slate-300 bg-white text-slate-500", mark: "–", label: "Age shown, not judged" },
  unreadable: { chip: "bg-slate-200 text-slate-600", mark: "?", label: "Could not be read" },
};

export const NOT_CHECKED_TONE = "border border-dashed border-slate-300 bg-white text-slate-500";
export const NOT_CHECKED_LABEL = "Not checked";
