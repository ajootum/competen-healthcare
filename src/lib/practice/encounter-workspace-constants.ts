import { GLANCE_SWATCH, PANEL } from "@/lib/practice/palette";

// CPR-ENC-001 / CPR-ENC-002's vocabulary, in a module with NO SERVER IMPORTS.
//
// encounter-workspace.ts reaches next/headers transitively (provisioning -> audit -> cookies), so a
// client component that imported it would break `next build` with an error tsc and eslint both miss.
// Everything a client file needs -- option lists, tab names, quick actions, swatches, and the pure
// warning calculator -- lives here instead. Server files import the same constants, so there is one
// list rather than two that drift.

/**
 * migration 238's six outcomes.
 *
 * THE TWO APPROVED SPECIFICATIONS DISAGREE and both are honoured: CPR-ENC-001 s3 names
 * "improved / stable / worsened / resolved / recurring", CPR-ENC-002 s4's screen draws
 * "Improved / Stable / Worsened / Resolved / Other". Six is the union, and the disagreement is recorded
 * rather than resolved by whoever typed the list.
 */
export const ENCOUNTER_OUTCOMES: [string, string][] = [
  ["improved", "Improved"],
  ["stable", "Stable"],
  ["worsened", "Worsened"],
  ["resolved", "Resolved"],
  ["recurring", "Recurring"],
  ["other", "Other"],
];

export const ENCOUNTER_OUTCOME_CODES = ENCOUNTER_OUTCOMES.map(([k]) => k);

/** `other` that says nothing is the get-past-the-field answer. The database refuses it too. */
export const OUTCOME_NEEDING_NOTE = "other";

/**
 * ⚠ INVESTIGATIONS ARE TYPE ONLY. Two states, because this product cannot observe a third.
 *
 * There is no `result`. CompetenPractice does not transmit a request to a laboratory, does not receive a
 * structured result, and cannot tell anybody whether a test was performed -- CPR-ENC-001 s5 excludes
 * laboratory tables and imaging reports outright. `requested` is what the practitioner asked for;
 * `reviewed` is that they have since looked at whatever came back. The document itself lives in
 * practice_incoming_document and is not duplicated here.
 */
export const INVESTIGATION_STATUSES: [string, string][] = [
  ["requested", "Requested"],
  ["reviewed", "Reviewed"],
];

export const INVESTIGATION_STATUS_CODES = INVESTIGATION_STATUSES.map(([k]) => k);

/**
 * ⚠ REFERRALS ARE RECORDED, NOT SENT. This product has no email, no SMS and no messaging of any kind.
 * A referral row is a note that the practitioner decided to refer; the letter that actually goes
 * anywhere is a practice_clinical_document with its own release register. `accepted` and `declined` are
 * recorded only when somebody told the practitioner -- they are not observations of a transmission.
 */
export const REFERRAL_STATUSES: [string, string][] = [
  ["made", "Referral made"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["withdrawn", "Withdrawn"],
];

export const REFERRAL_STATUS_CODES = REFERRAL_STATUSES.map(([k]) => k);

/** CPR-ENC-002 s2's main workspace, drawn as the comp's tab row. */
export const ENCOUNTER_TABS: [string, string][] = [
  ["overview", "Overview"],
  ["diagnoses", "Diagnoses"],
  ["treatment", "Treatment"],
  ["procedures", "Procedures"],
  ["investigations", "Investigations"],
  ["follow-up", "Follow-up"],
  ["attachments", "Attachments"],
  ["notes", "Notes"],
];

export const ENCOUNTER_TAB_CODES = ENCOUNTER_TABS.map(([k]) => k);

/**
 * CPR-ENC-002 s6's EIGHT quick actions, each naming the tab it opens.
 *
 * Every one of these lands somewhere that already exists in this screen -- s9 asks for "maximum three
 * clicks", and an action that opened a different page would cost the practitioner the consultation they
 * are in the middle of. `add_task` is the exception and says so: tasks are a different module.
 */
export const QUICK_ACTIONS: { key: string; label: string; tab: string | null; href?: string; capability: string }[] = [
  { key: "add_procedure", label: "Add procedure", tab: "procedures", capability: "procedure.record" },
  { key: "add_diagnosis", label: "Add diagnosis", tab: "diagnoses", capability: "diagnosis.record" },
  { key: "update_treatment", label: "Update treatment", tab: "treatment", capability: "treatment.record" },
  { key: "request_investigation", label: "Request investigation", tab: "investigations", capability: "encounter.edit" },
  { key: "create_referral", label: "Create referral", tab: "overview", capability: "encounter.edit" },
  { key: "generate_letter", label: "Generate letter", tab: "attachments", capability: "document.author" },
  { key: "schedule_follow_up", label: "Schedule follow-up", tab: "follow-up", capability: "followup.manage" },
  { key: "add_task", label: "Add task", tab: null, href: "/practice/tasks", capability: "task.manage" },
];

/** The comp's small glyphs for the eight. */
export const QUICK_ACTION_ICON: Record<string, string> = {
  add_procedure: "✚", add_diagnosis: "◈", update_treatment: "℞", request_investigation: "⚗",
  create_referral: "⇥", generate_letter: "✉", schedule_follow_up: "↻", add_task: "☑",
};

// ── CPR-ENC-002 s7's VALIDATION: WARNINGS, NOT REFUSALS ─────────────────────────────────────────────
//
// ⚠ EVERY ONE OF THESE IS A WARNING AND NONE OF THEM BLOCKS ANYTHING, and that is the specification's
// own word ("Warnings for missing diagnosis, treatment decision or outcome"). The reason matters more
// than the wording: a consultation that ends without a diagnosis is a real consultation -- the honest
// answer to "what is wrong with this patient" is often "I do not know yet" -- and a system that refused
// to close it would teach practitioners to type a diagnosis they do not hold in order to get out of the
// screen. That is worse than an empty field, because it is a false one.
//
// s7's "follow-up required before closure WHEN CLINICALLY INDICATED" is included on the same terms. The
// condition is a clinical judgement this product cannot evaluate, so it cannot be a gate; it is a
// question asked once, which is all it can honestly be.

export type EncounterWarning = { key: string; text: string };

export const WARNING_TEXT: Record<string, string> = {
  missing_diagnosis: "No diagnosis has been recorded in this encounter.",
  missing_treatment_decision: "No treatment change or clinical decision has been recorded.",
  missing_outcome: "No outcome has been recorded for this encounter.",
  no_follow_up: "No follow-up has been planned. Close only if none is clinically indicated.",
};

/**
 * The warnings for one encounter. PURE, so the harness can assert every branch without a database, and
 * so the same list is shown in the screen and returned by the API.
 *
 * `null` inputs mean "could not be read", and a warning is NOT raised for something that could not be
 * counted -- telling a practitioner "no diagnosis has been recorded" on the strength of a failed query
 * is a false clinical statement, which is the failure this codebase keeps writing down.
 */
export function encounterWarnings(input: {
  diagnoses: number | null;
  treatments: number | null;
  decisions: number | null;
  outcome: string | null;
  openFollowUps: number | null;
}): EncounterWarning[] {
  const out: EncounterWarning[] = [];
  if (input.diagnoses === 0) out.push({ key: "missing_diagnosis", text: WARNING_TEXT.missing_diagnosis });
  if (input.treatments === 0 && input.decisions === 0)
    out.push({ key: "missing_treatment_decision", text: WARNING_TEXT.missing_treatment_decision });
  if (!input.outcome) out.push({ key: "missing_outcome", text: WARNING_TEXT.missing_outcome });
  if (input.openFollowUps === 0) out.push({ key: "no_follow_up", text: WARNING_TEXT.no_follow_up });
  return out;
}

// ── COLOUR ──────────────────────────────────────────────────────────────────────────────────────────
//
// THE FIGURE TAKES THE CARD'S COLOUR. Composed from palette.ts rather than written out here, so a hue
// cannot end up meaning one thing on the command centre and another on this screen.
//
// ⚠ ONE SWATCH IS MISSING FROM palette.ts AND IS COMPOSED LOCALLY: `open`. There is no existing entry
// for "a consultation record left open", which is the fourth figure on every session card. The nearest
// existing statement of that concept is PATIENT_STATUS_SWATCH.encounter_open, which is sky and is a chip
// rather than a {badge, figure, box} triple -- so the sky below is that decision, restated in the shape
// this row needs. palette.ts is owned by another agent this session and was deliberately not edited;
// this is reported instead.
const OPEN_SWATCH = {
  badge: "bg-sky-100 text-sky-700", figure: "text-sky-700",
  box: "border-sky-200 bg-sky-50/60", icon: "◔",
};

/**
 * The four figures on a session card, from the encounters filed against that session.
 *
 * Every one is REAL and comes from practice_encounter.entry_pathway -- there is no appointment-to-session
 * link in this schema, so "booked" here means an encounter opened from a booking, not a slot on a diary.
 */
export const SESSION_FIGURES: { key: string; label: string; swatch: { badge: string; figure: string; box: string; icon: string } }[] = [
  { key: "booked", label: "Booked", swatch: GLANCE_SWATCH.booked },
  { key: "walk_in", label: "Walk-ins", swatch: GLANCE_SWATCH.walk_in },
  { key: "completed", label: "Completed", swatch: GLANCE_SWATCH.completed },
  { key: "open", label: "Open", swatch: OPEN_SWATCH },
];

/** The dashboard's four panels, in the comp's order, each with its own header badge. */
export const DASHBOARD_PANELS: Record<string, { icon: string; badge: string }> = {
  sessions: PANEL.locations,
  open: { icon: "✎", badge: "bg-violet-100 text-violet-700" },
  closed: PANEL.queue,
  attention: PANEL.alerts,
};

/** Encounter status chips. One concept, one colour, shared with the dashboard and the encounter screen. */
export const ENCOUNTER_STATUS_CHIP: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  ACTIVE: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
  PAUSED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  COMPLETED: "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200",
  SIGNED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  AMENDED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  CANCELLED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  ENTERED_IN_ERROR: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
};

/** Words a practitioner would use, rather than the machine's. */
export const ENCOUNTER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", ACTIVE: "In progress", PAUSED: "Paused", COMPLETED: "Completed",
  SIGNED: "Signed", AMENDED: "Amended", CANCELLED: "Cancelled", ENTERED_IN_ERROR: "Entered in error",
};

/** Investigation and referral chips. */
export const INVESTIGATION_CHIP: Record<string, string> = {
  requested: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  reviewed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

export const REFERRAL_CHIP: Record<string, string> = {
  made: "bg-sky-100 text-sky-700 ring-1 ring-sky-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  declined: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
  withdrawn: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

/** The outcome radio row, in its own hue per answer. Worsened is the only red one, because it is the only failure. */
export const OUTCOME_SWATCH: Record<string, { chip: string; dot: string }> = {
  improved: { chip: "border-emerald-200 bg-emerald-50/70 text-emerald-800", dot: "bg-emerald-500" },
  stable: { chip: "border-sky-200 bg-sky-50/70 text-sky-800", dot: "bg-sky-500" },
  worsened: { chip: "border-rose-300 bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  resolved: { chip: "border-teal-200 bg-teal-50/70 text-teal-800", dot: "bg-teal-500" },
  recurring: { chip: "border-amber-200 bg-amber-50/70 text-amber-800", dot: "bg-amber-500" },
  other: { chip: "border-slate-200 bg-slate-50 text-slate-700", dot: "bg-slate-400" },
};

/** The left context panel's safety lines. Only `none` is allowed to look reassuring. */
export const SAFETY_TONE: Record<string, string> = {
  none: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
  present: "border-rose-300 bg-rose-50 text-rose-800",
  unknown: "border-amber-200 bg-amber-50/70 text-amber-800",
  unreadable: "border-rose-300 bg-rose-50 text-rose-800",
};
