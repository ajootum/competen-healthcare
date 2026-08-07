// CPR-LCP-001 -- the clinical-parameter vocabulary and its three-state readers, in a module with NO
// SERVER IMPORTS.
//
// It lives apart from parameters.ts for the reason encounter-constants.ts and
// practice-session-constants.ts already exist: parameters.ts imports access.ts, which imports
// `next/headers`, and a "use client" component importing so much as a string from it drags that chain
// into the browser bundle. `next build` fails; tsc and eslint do not. A server-only import reaching a
// client component killed the Follow-ups board this week, so the rule is restated here:
// A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READERS BELOW ARE PURE FUNCTIONS ON PURPOSE. They are the sentences a prescriber reads, they are
// shared by a server page and three client panels, and they are the only part of this build where
// getting it wrong is a clinical harm rather than an inconvenience -- so they are testable without a
// database and the harness tests them directly, the way longitudinal-constants.ts's allergyLine is.
//
// ⚠ THE RULE ALL OF THEM OBEY, WHICH IS MIGRATION 238's ALLERGY LESSON IN A SECOND DOMAIN:
//
//   "NO KNOWN ALLERGIES and NOBODY HAS ASKED are different answers."
//
// Here that becomes: A THRESHOLD WITH NO RULE ROW IS NOT A THRESHOLD THAT PASSED. An unwarned screen
// reads as a cleared screen, so `not_checked` is its own state, it is never blank, and it is never a
// green tick. Exactly one verdict in this file sets `reassuring: true`, and it is the one where a rule
// existed, a value existed, and the value was inside the rule.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every capability code this engine gates on.
 *
 * ⚠ EXPORTED AS AN ARRAY BECAUSE THE AUDIT HARNESS CANNOT SEE IT OTHERWISE.
 * `capabilityCodesInSource()` in practice-audit-harness.ts matches only three regexes, all of which
 * require an INLINE DOUBLE-QUOTED LITERAL at the call site. A code introduced through a constants
 * object is invisible to it -- and an invented capability code compiles, passes review, and returns 403
 * for every user including the practice owner, so the feature is simply unreachable and nothing errors
 * anywhere. Six have shipped in this codebase that way. This array is the compensating convention
 * LONGITUDINAL_CAPABILITIES established, and the harness asserts every entry exists in
 * practice_role_capabilities.
 *
 * All four are seeded by migration 246 s11 and backfilled onto existing memberships there.
 */
export const PARAMETER_CAPABILITIES = [
  "parameter.view", "parameter.record", "parameter.configure", "pack.install",
] as const;

export const CAP_VIEW = "parameter.view";
export const CAP_RECORD = "parameter.record";
export const CAP_CONFIGURE = "parameter.configure";
export const CAP_PACK_INSTALL = "pack.install";

// ── LCP s6 THE PARAMETER DEFINITION MODEL -- each list mirrors migration 246's CHECK exactly ─────────

/** LCP s6 Category, verbatim: "Anthropometric, vital sign, specialty, score, calculated or custom." */
export const PARAMETER_CATEGORIES: [string, string][] = [
  ["anthropometric", "Anthropometric"],
  ["vital_sign", "Vital sign"],
  ["specialty", "Specialty"],
  ["score", "Score"],
  ["calculated", "Calculated"],
  ["custom", "Custom"],
];
export const PARAMETER_CATEGORY_CODES = PARAMETER_CATEGORIES.map(([k]) => k);

/**
 * LCP s6 Data type, verbatim: "Decimal, integer, Boolean, date, text, single choice, multiple choice or
 * calculated."
 */
export const PARAMETER_DATA_TYPES: [string, string][] = [
  ["decimal", "Decimal"], ["integer", "Integer"], ["boolean", "Yes / no"], ["date", "Date"],
  ["text", "Text"], ["single_choice", "Single choice"], ["multi_choice", "Multiple choice"],
  ["calculated", "Calculated"],
];
export const PARAMETER_DATA_TYPE_CODES = PARAMETER_DATA_TYPES.map(([k]) => k);

/**
 * LCP s6 Collection rule, verbatim: "First visit, every visit, scheduled, annual, on request or
 * conditionally required." `every_follow_up` is s7.1's, added by migration 246 for the reason its
 * comment gives -- it is the commonest clinic answer and s6's prose omits it.
 */
export const COLLECTION_RULES: [string, string][] = [
  ["first_visit", "First visit"], ["every_visit", "Every visit"], ["every_follow_up", "Every follow-up"],
  ["scheduled", "Scheduled"], ["annual", "Annual"], ["on_request", "On request"],
  ["conditionally_required", "Conditionally required"],
];
export const COLLECTION_RULE_CODES = COLLECTION_RULES.map(([k]) => k);

/** CPL s23's four classes. A `licensed` definition cannot go active without a licence reference. */
export const RISK_CLASSES: [string, string][] = [
  ["low", "Low risk"], ["moderate", "Moderate risk"], ["high", "High risk"],
  ["licensed", "Licensed / restricted"],
];
export const RISK_CLASS_CODES = RISK_CLASSES.map(([k]) => k);

export const DEFINITION_STATUSES: [string, string][] = [
  ["draft", "Draft"], ["active", "Active"], ["retired", "Retired"],
];

// ── LCP s4 THE CONFIGURATION HIERARCHY ───────────────────────────────────────────────────────────────

/**
 * s4's five levels IN ITS OWN PRECEDENCE ORDER, most specific first:
 * "Encounter override -> Patient Monitoring Plan -> Clinic/session configuration -> Practitioner
 * defaults -> Platform library."
 *
 * ⚠ THE ORDER IS THE SPECIFICATION AND IS NOT AN ARTEFACT OF THE ARRAY. resolveActivation walks this
 * array and takes the first hit, so reordering it changes which configuration wins. The harness asserts
 * the array verbatim for that reason.
 */
export const ACTIVATION_SCOPES_BY_PRECEDENCE = [
  "encounter", "session", "clinic", "practitioner", "practice",
] as const;
export type ActivationScope = (typeof ACTIVATION_SCOPES_BY_PRECEDENCE)[number];

export const CONFIG_LEVELS: { key: string; title: string; purpose: string }[] = [
  { key: "encounter", title: "Encounter override", purpose: "Adds a one-off parameter for a specific review." },
  { key: "patient_plan", title: "Patient Monitoring Plan", purpose: "Adds, removes or changes parameters for one patient." },
  { key: "clinic", title: "Clinic / session", purpose: "Applies a context-specific subset." },
  { key: "practitioner", title: "Practitioner / practice", purpose: "Selects the usual collection set and default behaviour." },
  { key: "platform", title: "Platform library", purpose: "Defines available parameter definitions and governed templates." },
];

/** migration 246 s5: the scope needs no id, and NULL in a unique index permits duplicates. */
export const SCOPE_SENTINEL = "00000000-0000-0000-0000-000000000000";

// ── LCP s7 THE PATIENT MONITORING PLAN ───────────────────────────────────────────────────────────────

/** s7's eight patient-level states, verbatim, with s7's own Meaning column. */
export const PLAN_STATES: [string, string, string][] = [
  ["inherited", "Inherited", "Uses the current higher-level configuration."],
  ["active", "Active", "Deliberately enabled for this patient."],
  ["required", "Required", "Must be collected according to the defined rule."],
  ["optional", "Optional", "Available during collection but not mandatory."],
  ["paused", "Paused", "Temporarily excluded until a date or review."],
  ["resolved", "Resolved", "No longer routinely collected but remains historical."],
  ["hidden", "Hidden", "Removed from routine views; prior values remain accessible."],
  ["conditionally_required", "Conditionally required", "Automatically requested when triggered by medication, diagnosis or protocol."],
];
export const PLAN_STATE_CODES = PLAN_STATES.map(([k]) => k);
export const PLAN_STATE_LABEL: Record<string, string> = Object.fromEntries(PLAN_STATES.map(([k, l]) => [k, l]));
export const PLAN_STATE_MEANING: Record<string, string> = Object.fromEntries(PLAN_STATES.map(([k, , m]) => [k, m]));

/**
 * ⚠ THE STATES THAT REMOVE A PARAMETER FROM ROUTINE VIEWS.
 *
 * s7: Hidden = "Removed from routine views"; Paused = "Temporarily excluded"; Resolved = "No longer
 * routinely collected". All three keep their history -- s2.2 excludes "Deletion of historical
 * measurements when a parameter is deactivated" and s13 repeats it.
 *
 * ⚠ AND s9: "Patient-level hiding of weight must not suppress a medication-triggered safety
 * requirement." So this list decides ROUTINE display and nothing else. `safety_required` is a separate
 * column on the same row, deliberately (migration 246 s6), and a plan row in any of these three states
 * with safety_required true STILL appears on the safety list. Both directions are asserted in the
 * harness: an assertion in one direction passes against an engine that never hides anything.
 */
export const STATES_OUT_OF_ROUTINE_VIEW = ["paused", "resolved", "hidden"] as const;

/** s7.1's fourteen scheduling options, verbatim. */
export const PLAN_SCHEDULES: [string, string][] = [
  ["every_encounter", "Every encounter"], ["first_visit_only", "First visit only"],
  ["every_follow_up", "Every follow-up"], ["daily", "Daily"], ["weekly", "Weekly"],
  ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["six_monthly", "Six-monthly"],
  ["annually", "Annually"], ["next_visit", "At the next visit"], ["until_date", "Until a specified date"],
  ["for_n_encounters", "For a defined number of encounters"], ["until_resolved", "Until resolved"],
  ["on_request", "On practitioner request"],
];
export const PLAN_SCHEDULE_CODES = PLAN_SCHEDULES.map(([k]) => k);
export const PLAN_SCHEDULE_LABEL: Record<string, string> = Object.fromEntries(PLAN_SCHEDULES);

/**
 * How many days each schedule advances a due date by.
 *
 * ⚠ ONLY THE CALENDAR-INTERVAL SCHEDULES ARE HERE. `every_encounter`, `first_visit_only`,
 * `every_follow_up`, `next_visit`, `for_n_encounters`, `until_resolved` and `on_request` are triggered
 * by an EVENT, not by a clock -- so they have no interval, they get no next_due_on, and a screen must
 * say "when you next see them" rather than inventing a date. A schedule silently given 30 days would
 * make an event-driven parameter look overdue on a day nobody had promised anything.
 */
export const SCHEDULE_INTERVAL_DAYS: Record<string, number> = {
  daily: 1, weekly: 7, monthly: 30, quarterly: 91, six_monthly: 182, annually: 365,
};

export const TRIGGER_SOURCES: [string, string][] = [
  ["practitioner", "Practitioner"], ["medication", "Medication"], ["diagnosis", "Diagnosis"],
  ["protocol", "Protocol"],
];
export const TRIGGER_SOURCE_CODES = TRIGGER_SOURCES.map(([k]) => k);

// ── LCP s7.2 ALERTS, s12 SOURCES ─────────────────────────────────────────────────────────────────────

/** s7.2's seven alert types, verbatim. */
export const ALERT_TYPES: [string, string][] = [
  ["reference_range", "Population reference-range alert"],
  ["patient_target", "Practitioner-defined patient target"],
  ["change_from_baseline", "Change-from-baseline alert"],
  ["percentage_change", "Percentage-change alert"],
  ["rate_of_change", "Rate-of-change alert"],
  ["missing_overdue", "Missing or overdue measurement alert"],
  ["trend_deviation", "Trend deviation alert"],
];
export const ALERT_TYPE_CODES = ALERT_TYPES.map(([k]) => k);

/**
 * The four-level clinical alert severity, settled by the user on 2026-08-07 in favour of CPR-PIE-001 s7
 * over CPR-MED-001 s5's third level -- "action_required" says what to do rather than how bad it is, and
 * PIE s7 is the platform-wide framework where MED s5 governs only medication.
 *
 * ⚠ NOT THE OPERATIONAL SCALE. palette.ts's SEVERITY (critical/warning/normal) answers "does this need
 * you today" on a dashboard tile. This answers "how dangerous is this reading". Two enums that look
 * alike are not one enum, and merging them would force one of them to lie.
 *
 * ⚠ NULL IS PERMITTED BY THE SCHEMA AND MEANS "NOT CLASSIFIED". It must render as those words -- never
 * as `informational`, never as a blank cell.
 */
export const ALERT_SEVERITIES: [string, string][] = [
  ["informational", "Informational"], ["advisory", "Advisory"],
  ["action_required", "Action required"], ["critical", "Critical"],
];
export const ALERT_SEVERITY_CODES = ALERT_SEVERITIES.map(([k]) => k);
export const ALERT_SEVERITY_LABEL: Record<string, string> = Object.fromEntries(ALERT_SEVERITIES);
export const ALERT_TYPE_LABEL: Record<string, string> = Object.fromEntries(ALERT_TYPES);
export const UNCLASSIFIED_SEVERITY_LABEL = "Not classified";

/** LCP s12's five sources, verbatim. s10.3 requires the distinction to be visible on screen. */
export const MEASUREMENT_SOURCES: [string, string][] = [
  ["practitioner", "Practitioner-entered"], ["team", "Team-entered"],
  ["patient_reported", "Patient-reported"], ["imported", "Imported"], ["device", "Device-generated"],
];
export const MEASUREMENT_SOURCE_CODES = MEASUREMENT_SOURCES.map(([k]) => k);
export const MEASUREMENT_SOURCE_LABEL: Record<string, string> = Object.fromEntries(MEASUREMENT_SOURCES);

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READERS
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE MOST SAFETY-CRITICAL FUNCTION IN THIS BUILD, and it is the allergy rule in a second domain.
 *
 * A threshold with no rule row is NOT a threshold that passed. If `not_checked` and `within` were the
 * same answer, then every parameter nobody had set a range for would render as satisfactory -- and it
 * would do so most confidently for the newest practices, which are exactly the ones where nothing has
 * been configured. An unwarned screen reads as a cleared screen.
 *
 * ⚠ AND THERE IS NO PLATFORM REFERENCE-RANGE COLUMN IN MIGRATION 246. s6's definition model lists
 * "Alerts | Reference thresholds, patient targets, change-from-baseline and rate-of-change rules" and
 * the schema gives that a home at exactly two levels: `practice_parameter_activation.threshold_override`
 * (a practice-wide rule) and `practice_patient_monitoring_plan.target_low/target_high` (this patient's).
 * A definition on its own therefore supplies NO range, and the honest answer for it is `not_checked` --
 * not a green tick, and not an invented population range. See NO_PLATFORM_REFERENCE_RANGE below.
 *
 * PLAUSIBILITY IS NOT A REFERENCE RANGE and is not consulted here. migration 246 s1: min_plausible and
 * max_plausible "do NOT refuse a value ... a 3 kg adult is a typing error worth a warning, not a locked
 * form". Reporting a value as "within plausibility" as though it had been clinically checked would be
 * the same lie in a quieter voice.
 */
export type ThresholdVerdict = {
  /**
   * not_checked -- nothing states a range, so nothing is checking this. NEVER a tick, never a blank.
   * no_value    -- a range is set and nothing has been measured against it.
   * within      -- a range is set, a value exists, and it is inside. THE ONLY REASSURING ANSWER.
   * breached    -- a range is set and the value is outside it.
   * unreadable  -- the read failed. Not "fine", and not "nothing there".
   */
  state: "not_checked" | "no_value" | "within" | "breached" | "unreadable";
  /** The sentence to print. Never invent a safer one than this. */
  text: string;
  /** ⚠ True for `within` and for nothing else. A screen may draw a green tick ONLY when this is true. */
  reassuring: boolean;
  /** Which level of s4's hierarchy supplied the rule, or null when no rule exists. */
  ruleSource: "patient_target" | "practice_threshold" | null;
  low: number | null;
  high: number | null;
};

type Bounds = { low: number | null; high: number | null } | null;

const hasBound = (b: Bounds): b is { low: number | null; high: number | null } =>
  !!b && (typeof b.low === "number" || typeof b.high === "number");

export function thresholdLine(input: {
  value: number | null;
  unit: string | null;
  /** practice_patient_monitoring_plan.target_low / target_high. Most specific, so it wins. */
  target: Bounds;
  /** practice_parameter_activation.threshold_override, already resolved down s4's precedence. */
  practiceThreshold: Bounds;
  unavailable: boolean;
}): ThresholdVerdict {
  if (input.unavailable) {
    return {
      state: "unreadable", reassuring: false, ruleSource: null, low: null, high: null,
      text: "This parameter's thresholds could not be read — nothing here is a check that passed",
    };
  }

  const patient = hasBound(input.target);
  const practice = hasBound(input.practiceThreshold);
  const rule = patient ? input.target! : practice ? input.practiceThreshold! : null;
  const ruleSource = patient ? "patient_target" as const : practice ? "practice_threshold" as const : null;

  // ⚠ ORDERED BEFORE the value test on purpose. "No rule" is the answer whether or not a value exists,
  // and a value with no rule behind it must not borrow the reassurance of one.
  if (!rule) {
    return {
      state: "not_checked", reassuring: false, ruleSource: null, low: null, high: null,
      text: "Not checked — no reference threshold or patient target is set for this parameter",
    };
  }

  const unit = input.unit ? ` ${input.unit}` : "";
  const range = rule.low !== null && rule.high !== null ? `${rule.low}–${rule.high}${unit}`
    : rule.low !== null ? `at or above ${rule.low}${unit}`
      : `at or below ${rule.high}${unit}`;
  const whose = ruleSource === "patient_target" ? "this patient's target" : "the practice threshold";

  if (input.value === null) {
    return {
      state: "no_value", reassuring: false, ruleSource, low: rule.low, high: rule.high,
      text: `Nothing measured against ${whose} (${range})`,
    };
  }

  const below = rule.low !== null && input.value < rule.low;
  const above = rule.high !== null && input.value > rule.high;
  if (below || above) {
    return {
      state: "breached", reassuring: false, ruleSource, low: rule.low, high: rule.high,
      text: `${input.value}${unit} is ${below ? "below" : "above"} ${whose} (${range})`,
    };
  }
  return {
    state: "within", reassuring: true, ruleSource, low: rule.low, high: rule.high,
    text: `${input.value}${unit} is within ${whose} (${range})`,
  };
}

/**
 * Plausibility, kept apart from the threshold on purpose. migration 246 s1 makes these a WARNING, not a
 * refusal, and this verdict never claims a value was clinically checked.
 */
export type PlausibilityVerdict = { state: "no_limits" | "plausible" | "implausible"; text: string };

export function plausibilityLine(input: {
  value: number | null; unit: string | null; min: number | null; max: number | null;
}): PlausibilityVerdict {
  if (input.min === null && input.max === null)
    return { state: "no_limits", text: "No plausibility limits are set for this parameter" };
  if (input.value === null) return { state: "no_limits", text: "Nothing to check" };
  const unit = input.unit ? ` ${input.unit}` : "";
  if ((input.min !== null && input.value < input.min) || (input.max !== null && input.value > input.max)) {
    return {
      state: "implausible",
      text: `${input.value}${unit} is outside the plausible range (${input.min ?? "—"} to ${input.max ?? "—"}${unit}). Check the entry — this is a typing check, not a clinical one.`,
    };
  }
  return { state: "plausible", text: `Within plausibility limits. This is not a clinical range check.` };
}

/**
 * DERIVED, NOT STORED. Doctrine 8: overdue and next-due are clock-dependent, so a boolean written into
 * a row is wrong from the moment the clock moves past it. `today` is a parameter so that the harness can
 * assert every branch without waiting a day.
 *
 * ⚠ AN EVENT-DRIVEN SCHEDULE HAS NO DATE AND MUST NOT BE GIVEN ONE. migration 246 s6's own note:
 * "A schedule that cannot be evaluated produces a parameter that is never due, which on a monitoring
 * screen is indistinguishable from a parameter that is up to date." So `every_encounter` and its
 * siblings get their own state and their own sentence, rather than falling through to "not due".
 */
export type DueVerdict = {
  state: "overdue" | "due_today" | "due_later" | "on_next_contact" | "no_schedule" | "unreadable";
  text: string;
  /** Positive when late. Null when there is no due date to be late against. */
  daysOverdue: number | null;
  nextDueOn: string | null;
};

const dayDiff = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function dueLine(input: {
  schedule: string | null;
  nextDueOn: string | null;
  /** ISO date, the practice's own today. Never `new Date()` inside this function. */
  today: string;
  unavailable: boolean;
}): DueVerdict {
  if (input.unavailable)
    return { state: "unreadable", text: "Whether this is due could not be read", daysOverdue: null, nextDueOn: null };
  if (!input.schedule)
    return { state: "no_schedule", text: "No schedule — collected on request", daysOverdue: null, nextDueOn: null };
  if (!(input.schedule in SCHEDULE_INTERVAL_DAYS) && !input.nextDueOn) {
    return {
      state: "on_next_contact",
      text: `${PLAN_SCHEDULE_LABEL[input.schedule] ?? input.schedule} — triggered by a visit, not by a date, so there is no due date to be late against`,
      daysOverdue: null, nextDueOn: null,
    };
  }
  if (!input.nextDueOn)
    return { state: "no_schedule", text: "Scheduled, but no due date has been set", daysOverdue: null, nextDueOn: null };

  const days = dayDiff(input.nextDueOn, input.today);
  if (days > 0)
    return { state: "overdue", text: `Overdue by ${days} day${days === 1 ? "" : "s"} (due ${input.nextDueOn})`, daysOverdue: days, nextDueOn: input.nextDueOn };
  if (days === 0)
    return { state: "due_today", text: "Due today", daysOverdue: 0, nextDueOn: input.nextDueOn };
  return { state: "due_later", text: `Due ${input.nextDueOn}`, daysOverdue: null, nextDueOn: input.nextDueOn };
}

/**
 * LCP s10.3: "Clear distinction between measured, patient-reported, imported and calculated values."
 *
 * A calculated value is NOT a measurement and must never be shown as one -- it is arithmetic over other
 * rows, and s3's "Transparent intelligence" requires it to carry the formula and the rows it came from.
 */
export type ValueVerdict = {
  state: "value" | "none" | "not_permitted" | "unreadable";
  text: string;
  provenance: "measured" | "patient_reported" | "imported" | "calculated" | null;
  provenanceLabel: string | null;
};

export function valueLine(input: {
  text: string | null;
  source: string | null;
  calculated: boolean;
  permitted: boolean;
  unavailable: boolean;
}): ValueVerdict {
  if (!input.permitted)
    return { state: "not_permitted", text: "You may not see this value", provenance: null, provenanceLabel: null };
  if (input.unavailable)
    return { state: "unreadable", text: "Could not be read — this is not the same as nothing recorded", provenance: null, provenanceLabel: null };
  if (input.text === null)
    return { state: "none", text: "Nothing recorded", provenance: null, provenanceLabel: null };

  const provenance = input.calculated ? "calculated" as const
    : input.source === "patient_reported" ? "patient_reported" as const
      : input.source === "imported" || input.source === "device" ? "imported" as const
        : "measured" as const;
  const provenanceLabel = input.calculated ? "Calculated"
    : (MEASUREMENT_SOURCE_LABEL[input.source ?? ""] ?? "Practitioner-entered");
  return { state: "value", text: input.text, provenance, provenanceLabel };
}

/**
 * ⚠ THE REFUSAL THIS FUNCTION LIFTS, AND THE PRECONDITION IT KEEPS.
 *
 * `REFUSED_PATIENT_STATES.improving` in intelligence-constants.ts named its own precondition: "a
 * repeated structured measurement with a direction agreed in advance". LCP s7.2 is exactly that, so
 * `improving` becomes computable HERE -- and only here, and only under the conditions below:
 *
 *   1. There are at least two ACTIVE measurements of this parameter for this patient. Not attendance,
 *      not encounters, not a follow-up closed as "improved" -- measurements.
 *   2. A practitioner stated, IN ADVANCE, which direction is better, on the monitoring plan's
 *      change_rule as `improving_direction`. Without it the answer is `no_direction_agreed`, because
 *      whether a falling weight is improvement depends entirely on the patient.
 *
 * The failure mode the original refusal warned about survives the unlock and is why (1) says
 * "measurements": "A patient who stopped attending because they got worse and went elsewhere is the
 * exact case that proxy calls Improving." Nothing here reads attendance.
 */
export type TrendVerdict = {
  state: "improving" | "deteriorating" | "unchanged"
  | "no_direction_agreed" | "too_few_measurements" | "unreadable";
  text: string;
  /** Doctrine 9: the two rows it is computed from, so a reader can check it. */
  basis: { fromValue: number; fromAt: string; toValue: number; toAt: string } | null;
  /** The direction a practitioner agreed was better, echoed back. Null when none was agreed. */
  agreedDirection: "up" | "down" | null;
  /** Absolute change in the canonical unit. Never a rate, never a cohort percentage. */
  change: number | null;
};

export function trendLine(input: {
  /** Oldest first. Active measurements only -- a retracted row is not evidence of anything. */
  series: { value: number; at: string }[];
  /** plan.change_rule.improving_direction, stated in advance by a practitioner. */
  agreedDirection: "up" | "down" | null;
  unavailable: boolean;
}): TrendVerdict {
  const blank = { basis: null, agreedDirection: input.agreedDirection, change: null };
  if (input.unavailable)
    return { state: "unreadable", text: "The measurement series could not be read", ...blank };
  if (input.series.length < 2)
    return {
      state: "too_few_measurements",
      text: `A direction needs at least two measurements; there ${input.series.length === 1 ? "is 1" : "are none"}`,
      ...blank,
    };
  if (input.agreedDirection !== "up" && input.agreedDirection !== "down")
    return {
      state: "no_direction_agreed",
      text: "No direction was agreed in advance for this parameter, so neither improving nor deteriorating can be claimed",
      ...blank, agreedDirection: null,
    };

  const first = input.series[0];
  const last = input.series[input.series.length - 1];
  const change = Math.round((last.value - first.value) * 1000) / 1000;
  const basis = { fromValue: first.value, fromAt: first.at, toValue: last.value, toAt: last.at };

  if (change === 0)
    return { state: "unchanged", text: `Unchanged at ${last.value} between ${first.at.slice(0, 10)} and ${last.at.slice(0, 10)}`, basis, agreedDirection: input.agreedDirection, change };

  const movedUp = change > 0;
  const better = (movedUp && input.agreedDirection === "up") || (!movedUp && input.agreedDirection === "down");
  return {
    state: better ? "improving" : "deteriorating",
    text: `${first.value} → ${last.value} (${movedUp ? "+" : ""}${change}) between ${first.at.slice(0, 10)} and ${last.at.slice(0, 10)}; ${input.agreedDirection} was agreed as the improving direction`,
    basis, agreedDirection: input.agreedDirection, change,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ENGINE WILL NOT CLAIM
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE COMP DRAWS A PERCENTILE BAND CHART AND THERE ARE NO PERCENTILE BANDS.
 *
 * Panel 9 of the CPR-LCP-001 design overview draws a weight-for-age chart with 97th, 75th, 50th, 25th
 * and 3rd centile curves behind the patient's line. Migration 246 s8 explains at length why there is no
 * percentile column, and the reason is not storage:
 *
 *   Every percentile and z-score CPL s5.2 asks for is a number against a NAMED reference population --
 *   WHO 2006, CDC 2000, or another -- fitted as L, M and S coefficients per age and sex. No such table
 *   exists in this product and NEITHER SPECIFICATION SUPPLIES ONE.
 *
 * A percentile computed against an unnamed population is not an approximation. It is a fabricated
 * clinical figure that looks exactly like a real one, and it would be read by a clinician deciding
 * whether a child is failing to thrive. So the raw series is rendered and the bands are not drawn --
 * not greyed out, not interpolated, not hard-coded from a table somebody found.
 */
export const NO_PERCENTILE_BANDS = {
  key: "growth_percentiles",
  label: "Growth percentiles, z-scores and centile bands",
  detail:
    "The design overview draws a weight-for-age chart with 97th, 75th, 50th, 25th and 3rd centile bands behind the patient's line, and CPL-001 s5.2 asks for weight-for-age, height-for-age, weight-for-height and BMI-for-age. Every one of those is a number against a NAMED reference population -- WHO 2006, CDC 2000 or another -- fitted as L, M and S coefficients per age and sex. No such table exists in this product, neither specification supplies one, and migration 246 s8 declined to add a percentile column for that reason. A percentile computed against an unnamed population is not an approximation; it is a fabricated clinical figure that looks exactly like a real one, read by somebody deciding whether a child is failing to thrive. The raw measurement series is drawn instead, at its own scale, and it is complete.",
  wouldRequire:
    "A reference population as its own table -- named, versioned and citable, with L/M/S coefficients per age and sex -- and a recorded decision about which population this practice uses. Then the percentile becomes a derived value like BMI, with its source measurements and its formula on the row.",
} as const;

/**
 * ⚠ THERE IS NO PLATFORM REFERENCE-RANGE COLUMN, AND THAT IS WHY MOST PARAMETERS READ "NOT CHECKED".
 *
 * LCP s6's field table has an "Alerts" row: "Reference thresholds, patient targets, change-from-baseline
 * and rate-of-change rules." Migration 246 gives that a home at the activation level
 * (`threshold_override`) and at the patient level (`target_low`/`target_high`), and gives the DEFINITION
 * no reference-range column at all. So a definition on its own carries no range.
 *
 * The alternative -- shipping population ranges for temperature, heart rate and blood pressure -- has
 * the same defect as the percentile bands: an age- and sex-dependent clinical range with no cited
 * source, presented as though somebody had approved it. A practice that wants a range states one, and
 * until it does the screen says nothing is checking.
 */
export const NO_PLATFORM_REFERENCE_RANGE = {
  key: "platform_reference_ranges",
  label: "Population reference ranges shipped with the platform library",
  detail:
    "Migration 246 gives a reference range two homes -- practice_parameter_activation.threshold_override and practice_patient_monitoring_plan.target_low/target_high -- and gives the parameter definition none. Shipping population ranges for temperature, heart rate or blood pressure would mean publishing age- and sex-dependent clinical limits with no cited source, and every screen would then draw a tick for a check nobody approved. Until a practice or a practitioner states a range, thresholdLine returns `not_checked` and the screen says so in those words.",
  wouldRequire:
    "A cited, versioned reference-range table with age, sex and applicability conditions, and a recorded decision about which source this practice adopts.",
} as const;

/**
 * LCP s10.3: "One-click carry-forward is prohibited for measured values."
 *
 * The anti-pattern that fills a chart with a weight nobody weighed. Enforced structurally rather than by
 * asking every future caller to behave: recordMeasurement takes its value from its caller, and no
 * function in parameters.ts reads a prior measurement's value and writes it into a new row. The harness
 * source-scans for it and runs a control that proves the scan can see such a write.
 */
export const CARRY_FORWARD_PROHIBITED = true;

export const PARAMETER_REFUSALS = [
  NO_PERCENTILE_BANDS,
  NO_PLATFORM_REFERENCE_RANGE,
  {
    key: "specialty_pack_catalogue",
    label: "The curated specialty pack catalogue",
    detail:
      "CPR-CPL-001 catalogues roughly 450 candidate parameters across 34 specialty groupings, and describes itself as \"a design catalogue, not a mandate to collect all listed data\". The PACK MACHINERY is built here -- a pack is a row, its items are rows, installing one writes activations that name the pack and its version, and cloning one preserves the source attribution CPL s22 asks for. The CONTENT is a separate pass, so the library ships with LCP s5's core anthropometrics and vital signs and nothing else. A screen showing zero packs is telling the truth about this build, not failing to load.",
    wouldRequire: "CPL-001's sections 3 to 21 authored as pack and pack-item rows, each with its risk class and, where the score is copyrighted, its licence reference.",
  },
  {
    key: "device_import",
    label: "Device-generated and imported measurements arriving by themselves",
    detail:
      "LCP s12's five sources include `imported` and `device`, and both are recordable -- the column accepts them and the screen labels them differently from a measurement somebody took. What does not exist is anything that RECEIVES one: no device integration, no import job, no lab interface. A value marked `device` in this build is a value a person typed and labelled as having come from a device.",
    wouldRequire: "An ingestion route with its own authentication, an identity match onto a patient, and a decision about what happens when a device reports a value nobody asked for.",
  },
] as const;

/** The sentence that travels with every measurement chart, wherever it is drawn. */
export const TREND_BOUNDARY =
  "Recorded values in date order, at their own scale. There are no centile bands behind this line: percentiles need a named reference population (WHO 2006, CDC 2000 or another) and neither specification supplies one, so drawing them would be a fabricated clinical figure.";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR
//
// ⚠ THESE ARE HUE TOKENS, NOT A SECOND PALETTE, AND THEY BELONG IN palette.ts.
//
// palette.ts is held by another agent in this session, and its own header records the rule that a
// second colour map elsewhere is how two screens end up disagreeing about what amber means. So this is
// the smallest thing that is not that: a hue string per category, every one an EXISTING --cp token, fed
// through palette.ts's own tintedCard / tintedChip / tintedFigure so the tints are computed by the same
// function every other Practice screen uses. No new swatch object, no new hex.
//
// When palette.ts is free these three maps should move into it as PARAMETER_CATEGORY_SWATCH,
// PARAMETER_STATE_CHIP and THRESHOLD_TONE. Until then they are here and this comment says why.
//
// THE HUES ARE THE ONES palette.ts ALREADY GIVES THESE MEANINGS:
//   anthropometric  indigo   the product's primary; the measurements taken at every desk
//   vital_sign      cyan     the accent, used for "happening now" everywhere else
//   calculated      sky/info arithmetic over other rows -- deliberately cooler than a measurement
//   score           amber    the warning hue, because a score is a judgement with governance on it
//   specialty       green    the success hue: an addition a practice chose
//   custom          slate    a practice's own, with no platform governance behind it
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CATEGORY_HUE: Record<string, string> = {
  anthropometric: "var(--cp-primary)",
  vital_sign: "var(--cp-accent)",
  calculated: "var(--cp-info)",
  score: "var(--cp-warning)",
  specialty: "var(--cp-success)",
  custom: "var(--cp-slate-500)",
};
export const CATEGORY_HUE_UNKEYED = "var(--cp-slate-500)";

export const CATEGORY_ICON: Record<string, string> = {
  anthropometric: "⚖", vital_sign: "♥", calculated: "∑", score: "▤", specialty: "◈", custom: "✦",
};

/**
 * The plan states, as chip classes.
 *
 * ⚠ `hidden`, `paused` AND `resolved` ARE GREY AND NOT RED. They are decisions somebody made, not
 * failures. Red here would train a practitioner to un-hide things a clinician deliberately hid.
 */
export const PLAN_STATE_CHIP: Record<string, string> = {
  inherited: "bg-slate-100 text-slate-600",
  active: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
  required: "bg-amber-100 text-amber-800",
  optional: "bg-slate-100 text-slate-600",
  paused: "bg-slate-200 text-slate-600",
  resolved: "bg-slate-200 text-slate-600",
  hidden: "bg-slate-200 text-slate-600",
  conditionally_required: "bg-violet-100 text-violet-700",
};

/**
 * ⚠ THE THRESHOLD TONES, AND THE ONE THAT IS NOT GREEN.
 *
 * `not_checked` is SLATE WITH A DASHED BORDER, not green and not red. It is the state a screen would
 * otherwise draw as nothing at all, and nothing at all is what a reader takes for "fine". Only `within`
 * -- the one verdict where a rule existed and a value satisfied it -- gets the tick and the green.
 */
export const THRESHOLD_TONE: Record<string, { chip: string; mark: string; label: string }> = {
  within: { chip: "bg-emerald-100 text-emerald-800", mark: "✓", label: "Within range" },
  breached: { chip: "bg-rose-100 text-rose-800", mark: "!", label: "Outside range" },
  no_value: { chip: "bg-amber-100 text-amber-800", mark: "○", label: "Nothing measured" },
  not_checked: { chip: "border border-dashed border-slate-300 bg-white text-slate-500", mark: "–", label: "Not checked" },
  unreadable: { chip: "bg-slate-200 text-slate-600", mark: "?", label: "Could not be read" },
};

export const DUE_TONE: Record<string, { chip: string; label: string }> = {
  overdue: { chip: "bg-rose-100 text-rose-800", label: "Overdue" },
  due_today: { chip: "bg-cyan-100 text-cyan-800", label: "Due today" },
  due_later: { chip: "bg-slate-100 text-slate-600", label: "Scheduled" },
  on_next_contact: { chip: "bg-violet-100 text-violet-700", label: "Next visit" },
  no_schedule: { chip: "bg-slate-100 text-slate-500", label: "On request" },
  unreadable: { chip: "bg-slate-200 text-slate-600", label: "Could not be read" },
};

/** The sentence that travels with the monitoring plan panel. */
export const MONITORING_PLAN_BOUNDARY =
  "This patient's plan, inherited from the practice's active parameters and then overridden for this person. Hiding, pausing or resolving a parameter removes it from routine collection and never removes a measurement — and never suppresses a parameter another part of the record requires for safety.";
