// CPR-FUP-003's vocabulary, in a module with NO SERVER IMPORTS so the Care Pathways screen derives its
// chips, its buttons and its labels from the same source the engine enforces. The split that
// encounter-constants.ts and follow-up-constants.ts exist for, applied to the fourth object with a
// lifecycle.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A PATHWAY IS A PLAN, NOT A PROTOCOL. CPR-FUP-003 s2 says "not protocol enforcement" and "supports
// deviations" in the same breath as "practitioner-controlled", and every list below is shaped by that:
//
//   * ENTRY CRITERIA ARE TEXT SOMEBODY READS. There is no rule engine here and there must not be one. A
//     machine-evaluated criterion would decide who goes on a pathway, and s2 says a practitioner does.
//   * NOTHING REFUSES A DEVIATION. Skip, repeat, delay, cancel and end-early are all permitted from any
//     live stage. The audit of them is the point (s10, s14 -- "every deviation is audited", said twice),
//     not the prevention.
//   * COMPLETION RULES RECORD AN EXPECTATION, NOT A GATE. `completion_rule` says what kind of thing was
//     meant to close the stage so the engine can watch for it. Manual advance is always available
//     whatever it says, because a pathway that could only be finished the way it was written would be a
//     protocol wearing a plan's name -- and it would be wrong for exactly the patients who need
//     thinking about.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** migration 239's `trigger`. CPR-FUP-003 s7's list, unchanged. */
export const PATHWAY_TRIGGERS = [
  ["diagnosis", "New diagnosis"],
  ["procedure", "Procedure completed"],
  ["first_consultation", "First consultation"],
  ["referral", "Referral"],
  ["manual", "Manual assignment"],
  ["import", "Historical import"],
] as const;

/**
 * An enrolment's status.
 *
 * `stopped` covers s10's "end pathway early" AND s4's "interruption" as one word, because the difference
 * between abandoning a plan and finishing it early is a REASON, not a state -- and two statuses would
 * force somebody to classify that difference at the moment they are least able to.
 */
export const PATHWAY_STATUSES = [
  ["active", "Active"],
  ["completed", "Completed"],
  ["stopped", "Stopped"],
] as const;

/** A stage a patient has actually reached. `entered` is the live one; the rest are how it ended. */
export const STAGE_STATES = [
  ["entered", "In progress"],
  ["completed", "Completed"],
  ["skipped", "Skipped"],
  ["cancelled", "Cancelled"],
] as const;

export const STAGE_COMPLETION_RULES = [
  ["encounter", "A consultation is completed"],
  ["procedure", "A procedure is documented"],
  ["investigation", "An investigation is reviewed"],
  ["manual", "The practitioner advances it"],
] as const;

/** migration 239's practice_pathway_event catalogue, and what each one is for. */
export const PATHWAY_EVENT_TYPES = [
  "assigned", "stage_entered", "stage_completed", "stage_skipped", "stage_delayed",
  "stage_cancelled", "stage_repeated", "pathway_completed", "pathway_stopped",
] as const;

export const PATHWAY_EVENT_LABELS: Record<string, string> = {
  assigned: "Pathway assigned",
  stage_entered: "Stage entered",
  stage_completed: "Stage completed",
  stage_skipped: "Stage skipped",
  stage_delayed: "Stage delayed",
  stage_cancelled: "Stage cancelled",
  stage_repeated: "Stage repeated",
  pathway_completed: "Pathway completed",
  pathway_stopped: "Pathway stopped",
};

/**
 * s10's five deviations, and the ONE thing they all have in common: none of them may be refused.
 *
 * `needsReason` is true for every one of them. A skipped stage with no reason is the record of a
 * decision without the decision -- and since the whole justification for permitting deviations is that
 * they get audited, an unaudited one would be the feature without the thing that makes it safe.
 */
export const PATHWAY_DEVIATIONS = [
  { key: "skip", label: "Skip this stage", event: "stage_skipped", needsReason: true,
    blurb: "The stage does not apply to this patient. The pathway moves to the next one." },
  { key: "repeat", label: "Repeat this stage", event: "stage_repeated", needsReason: true,
    blurb: "The stage is entered again. The first attempt stays in the history -- this is not an edit of it." },
  { key: "delay", label: "Delay this stage", event: "stage_delayed", needsReason: true,
    blurb: "The stage keeps its place and moves its date. Any follow-up it raised moves with it." },
  { key: "cancel", label: "Cancel this stage", event: "stage_cancelled", needsReason: true,
    blurb: "The stage will not happen. The pathway moves to the next one." },
  { key: "stop", label: "End the pathway early", event: "pathway_stopped", needsReason: true,
    blurb: "The whole plan stops here. The history remains, permanently." },
] as const;

export type PathwayDeviationKey = (typeof PATHWAY_DEVIATIONS)[number]["key"];

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE COMP'S THREE CHIPS ARE TWO CHIPS, AND THE MISSING ONE IS "AT RISK".
//
// CPR-FUP-003's design shows On track / At Risk / Overdue against every patient on a pathway, and two of
// the three are arithmetic:
//
//   overdue    the live stage's due date is behind the practice's today. A date comparison.
//   on_track   it is not. Also a date comparison.
//   undated    the stage has no due date at all, which is neither of the above and must not be drawn as
//              "on track" -- a plan with no date on it is not a plan that is going well.
//
// AT RISK IS A JUDGEMENT AND IT IS REFUSED. There is no date rule that produces it: "due soon" needs a
// threshold nobody chose, "likely to be missed" needs a model that does not exist, and "the patient has
// missed things before" is a claim about a person this product has no basis to make. Rendering it would
// mean picking a number, printing it as clinical judgement, and having it read as one.
//
// The same refusal was made on the Patients register, where a "Stable / Improving / Monitor" trajectory
// chip was declined for exactly this reason. It is recorded here rather than silently omitted, because
// the comp shows the chip and somebody will otherwise add it back.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PATHWAY_PROGRESS_STATES = ["on_track", "overdue", "undated", "ended"] as const;
export type PathwayProgressState = (typeof PATHWAY_PROGRESS_STATES)[number];

export const PATHWAY_PROGRESS_LABELS: Record<PathwayProgressState, string> = {
  on_track: "On track",
  overdue: "Overdue",
  undated: "No date",
  ended: "Ended",
};

/** Why "At risk" is not in the list above, in words a screen can print rather than a comment nobody sees. */
export const AT_RISK_REFUSAL =
  "The design shows an \"At risk\" chip between On track and Overdue. It is not rendered because there is " +
  "no date rule that produces it: any threshold that would make a pathway \"at risk\" is a number nobody " +
  "chose, printed where a clinical judgement would go. On track and Overdue are both arithmetic on the " +
  "current stage's due date, so both are shown.";

/**
 * The one derivation this module owns.
 *
 * ⚠ PURE, AND OVER DATES ONLY. `today` is passed in -- it is the PRACTICE's today, resolved once by the
 * caller through practiceToday(), never `new Date()` in here. A pathway in Kampala is overdue at 00:00
 * EAT, not at 03:00 EAT when UTC catches up.
 */
export function pathwayProgress(args: {
  pathwayStatus: string;
  /** The live stage's due date, or null when it has none. */
  stageDueOn: string | null | undefined;
  today: string;
}): PathwayProgressState {
  if (args.pathwayStatus !== "active") return "ended";
  if (!args.stageDueOn) return "undated";
  return String(args.stageDueOn) < args.today ? "overdue" : "on_track";
}

/** Whole days between two YYYY-MM-DD dates. Negative when the first is later. */
export const dayGap = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/** today + n days, in plain calendar arithmetic. Mirrors dueDateFrom so a stage and a follow-up agree. */
export function addDays(fromIso: string, days: number): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The API's action vocabulary for a live stage. One name per act, so a route cannot invent a sixth. */
export const PATHWAY_STAGE_ACTIONS = ["complete", "skip", "repeat", "delay", "cancel"] as const;
export type PathwayStageAction = (typeof PATHWAY_STAGE_ACTIONS)[number];

/**
 * The capability codes migration 239 SEEDS. Nothing else may be used.
 *
 * ⚠ A capability code is a string compared against practice_role_capabilities. An invented one compiles
 * perfectly and returns 403 for every user INCLUDING the practice owner -- so the feature is simply
 * unreachable and nothing errors anywhere. Six have shipped in this codebase that way. These three are
 * in migration 239 s8 and were read back out of the deployed database before being used here.
 */
export const PATHWAY_CAPABILITIES = {
  design: "pathway.design",
  assign: "pathway.assign",
  view: "pathway.view",
} as const;
