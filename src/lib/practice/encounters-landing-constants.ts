import { encounterWarnings, WARNING_TEXT, type EncounterWarning } from "@/lib/practice/encounter-workspace-constants";
import { DEFERRED_SAFETY_CHECKS, NOT_CHECKED_LABEL, NOT_CHECKED_TONE } from "@/lib/practice/medication-constants";

// CPR-ENC-LANDING-001's vocabulary, in a module with NO SERVER IMPORTS.
//
// Same split as encounter-constants.ts and medication-constants.ts: the landing page's loader reaches
// next/headers transitively, so everything a client file or a harness needs -- the tab list, the period
// and state filters, the aging thresholds, the duration formatter and the two pure calculators -- lives
// here. One list, not two that drift.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE FROZEN DECISION THIS FILE ENCODES (spec s0, repeated at s19)
//
//   "Do not reproduce the Current Session queue, appointment list, waiting-room management, or session
//    dashboard on this page. Encounter context may be inherited from Current Session, but the Encounters
//    workspace remains a clinical-record workbench."
//
// There is therefore no queue vocabulary in this file, no arrival state, and no per-session figure row.
// The session appears once, as a strip, and only to say what a new encounter will inherit.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// ── s4.3: THE STATUS FILTER TABS ────────────────────────────────────────────────────────────────────
//
// ⚠ "Each is an interactive filter, not a passive KPI" (s4.3), and this codebase's own rule says the
// same thing harder: EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. So each tab carries the `key`
// that appears in the URL and the sentence the board prints when that filter is on and finds nothing --
// because "no open encounters" and "no encounters ready to sign" are different facts and an empty panel
// that does not say which one it is empty of reads as a broken page.

export type LandingTabKey = "open" | "ready" | "completed_today" | "attention" | "all";

export const LANDING_TABS: {
  key: LandingTabKey;
  label: string;
  /** What this filter selects, in the words a practitioner would use. */
  note: string;
  /** ⚠ NAMES THE STATE IT IS EMPTY OF. s14 asks for this and the harness asserts it for every tab. */
  empty: string;
}[] = [
  {
    key: "open", label: "Open",
    note: "Started and not finished. These are the records that still need you.",
    empty: "Nothing is open. No encounter is part-written and waiting to be continued.",
  },
  {
    key: "ready", label: "Ready to sign",
    note: "Clinically finished, awaiting your signature. Until signed they can still be edited.",
    empty: "No encounters are ready to sign. Nothing is completed-but-unsigned.",
  },
  {
    key: "completed_today", label: "Completed today",
    note: "Finished today, whether or not they have since been signed.",
    empty: "Nothing has been completed today. No encounter has been marked finished since midnight.",
  },
  {
    key: "attention", label: "Attention",
    note: "Encounter work that is unfinished: part-written records, and records awaiting a signature.",
    empty: "No encounter needs attention. Nothing is part-written and nothing is awaiting a signature.",
  },
  {
    key: "all", label: "All encounters",
    note: "Every encounter this workspace holds, newest first, within the window this board reads.",
    empty: "This workspace holds no encounters at all. None has ever been opened here.",
  },
];

export const LANDING_TAB_KEYS = LANDING_TABS.map(t => t.key);

export function isLandingTab(value: string | null | undefined): value is LandingTabKey {
  return !!value && (LANDING_TAB_KEYS as string[]).includes(value);
}

// ── s4.7 / s9: THE HISTORY FILTERS ──────────────────────────────────────────────────────────────────
//
// "Default to a recent period and allow Today, 7 days, 30 days and Custom plus All, Signed and Amended
// filters" (s4.7). `days: null` is Custom, which takes its bounds from the URL.

export type HistoryPeriodKey = "today" | "7d" | "30d" | "custom";

export const HISTORY_PERIODS: { key: HistoryPeriodKey; label: string; days: number | null }[] = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "custom", label: "Custom", days: null },
];

export const HISTORY_PERIOD_KEYS = HISTORY_PERIODS.map(p => p.key);

/** s4.7's default. Thirty days, not "everything": a register is not a dashboard panel. */
export const DEFAULT_HISTORY_PERIOD: HistoryPeriodKey = "30d";

export type HistoryStateKey = "all" | "signed" | "amended";

/**
 * ⚠ THE STATUSES ARE THE DATABASE'S OWN, NOT A SECOND VOCABULARY.
 *
 * migration 194:51 admits DRAFT, ACTIVE, PAUSED, COMPLETED, SIGNED, AMENDED, CANCELLED and
 * ENTERED_IN_ERROR. History is the closed half of that list and nothing else -- and CANCELLED and
 * ENTERED_IN_ERROR are deliberately NOT here: a cancelled consultation is not a completed one, and
 * putting it in a register headed "completed and amended encounters" would count work that never
 * happened as work that did.
 */
export const HISTORY_STATES: { key: HistoryStateKey; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: ["SIGNED", "AMENDED"] },
  { key: "signed", label: "Signed", statuses: ["SIGNED"] },
  { key: "amended", label: "Amended", statuses: ["AMENDED"] },
];

export const HISTORY_STATE_KEYS = HISTORY_STATES.map(s => s.key);

/** s15: "Paginate or virtualize large encounter history datasets." */
export const HISTORY_PAGE_SIZE = 20;

// ── s6 / s7: HOW LONG IT HAS BEEN OPEN ──────────────────────────────────────────────────────────────

/**
 * s6: "Started timestamp and human-readable elapsed time (e.g., Open 18h 54m). Never expose raw minute
 * values such as 1134m." AC-06 says the same in one line.
 *
 * ⚠ NULL IS AN EM DASH, NOT "0m". A duration that could not be measured is not a consultation that
 * opened this instant, and the difference is the whole of this codebase's house rule about failed reads.
 */
export function elapsedLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.floor(minutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * s7's completion-aging threshold.
 *
 * ⚠ IT IS A BUILD-TIME DEFAULT AND THE SPECIFICATION ASKS FOR A CONFIGURABLE ONE. s7: "Completion-aging
 * thresholds must be configurable rather than hard-coded", and s17 repeats it as a non-goal. This build
 * does NOT satisfy that: practice_configuration (migration 191:101) has no column for it, and this task
 * carries no migration. Naming the constant here rather than burying `> 1440` in a component is the part
 * that is honest and the part that makes the change one line when the column exists -- it is not a claim
 * that the requirement is met. The page prints the threshold it used, so nobody has to read this file to
 * find out why a card turned amber.
 */
export const COMPLETION_OVERDUE_MINUTES = 24 * 60;

export const COMPLETION_THRESHOLD_IS_CONFIGURABLE = false;

export type AgingState = "fresh" | "overdue" | "unknown";

/**
 * ⚠ AGING IS A WORKFLOW SIGNAL, NOT A CLINICAL SEVERITY SCORE -- s7 says so in its own last sentence,
 * and the wording on the card says it too. An encounter left open overnight is a records problem. It is
 * not a sick patient, and colouring it like one teaches people to ignore the colour that means one.
 */
export function agingState(minutes: number | null, thresholdMinutes = COMPLETION_OVERDUE_MINUTES): AgingState {
  if (minutes === null || !Number.isFinite(minutes)) return "unknown";
  return minutes >= thresholdMinutes ? "overdue" : "fresh";
}

export const AGING_TONE: Record<AgingState, { chip: string; label: string }> = {
  fresh: { chip: "bg-slate-100 text-slate-600", label: "Open" },
  overdue: { chip: "bg-amber-100 text-amber-800", label: "Completion overdue" },
  // ⚠ SLATE AND DASHED, NEVER GREEN. The state a screen would otherwise draw as nothing at all, and
  // nothing at all is what a reader takes for "fine" -- the argument medication-constants.ts makes
  // about WEIGHT_TONE.age_unjudged, applied to a duration that could not be measured.
  unknown: { chip: NOT_CHECKED_TONE, label: "Age could not be measured" },
};

// ── s4.4 / s6: WHAT IS STILL REQUIRED ───────────────────────────────────────────────────────────────

/**
 * The three record-completeness items a landing card may claim are outstanding.
 *
 * ⚠ `no_follow_up` IS THE FOURTH WARNING AND IS DELIBERATELY NOT HERE. encounter-workspace-constants.ts
 * already argues the case at length: whether a follow-up is needed is "a clinical judgement this product
 * cannot evaluate", so its warning is phrased as a question ("Close only if none is clinically
 * indicated"). Printing "Still required: Follow-up" on a board would turn that question into a demand,
 * and would be false for every consultation that correctly needs none.
 *
 * ⚠ AND THE KEYS ARE THE ENCOUNTER SCREEN'S OWN. They index WARNING_TEXT, so the board and the
 * consultation cannot come to disagree about what "still required" means; the harness asserts the
 * containment rather than trusting it.
 */
export const LANDING_REQUIRED_KEYS = ["missing_diagnosis", "missing_treatment_decision", "missing_outcome"] as const;

/** Short enough for a card. The long sentence stays in WARNING_TEXT, where the consultation prints it. */
export const OUTSTANDING_SHORT: Record<string, string> = {
  missing_diagnosis: "Diagnosis",
  missing_treatment_decision: "Treatment or decision",
  missing_outcome: "Plan / disposition",
};

/**
 * What is still required in one encounter. PURE, so every branch is provable without a database.
 *
 * ⚠ IT DELEGATES TO encounterWarnings RATHER THAN RESTATING ITS RULES, which is what carries the null
 * discipline across: a count of `null` means "could not be counted" and raises NOTHING, because telling
 * a practitioner "no diagnosis has been recorded" on the strength of a failed query is a false clinical
 * statement. `openFollowUps: null` below is not a fudge -- this function genuinely does not count
 * follow-ups, and null is the honest input for a number nobody read.
 */
export function outstandingComponents(input: {
  diagnoses: number | null;
  treatments: number | null;
  decisions: number | null;
  outcome: string | null;
}): EncounterWarning[] {
  return encounterWarnings({ ...input, openFollowUps: null })
    .filter(w => (LANDING_REQUIRED_KEYS as readonly string[]).includes(w.key));
}

/** Every key this file may print, proven to exist in the encounter screen's own table. */
export const OUTSTANDING_KEYS_ARE_SHARED_WITH = WARNING_TEXT;

// ── s6: WHAT KIND OF ENCOUNTER THIS IS ──────────────────────────────────────────────────────────────
//
// s6 asks a card for "Encounter type (for example New consultation, Follow-up, Review)" and separately
// for "Source/mode such as Walk-in and In person where configured".
//
// ⚠ THERE IS NO SEPARATE `type` COLUMN, AND THE COMP'S THREE FACETS ARE TWO. migration 194:47 gives the
// encounter `entry_pathway` (booked / new_walk_in / walk_in_followup / scheduled_followup) and
// `encounter_mode` (in_person / teleconsultation / outreach / home_visit / hospital) and nothing else.
// The pathway carries both halves of what the comp splits -- "New walk-in" IS the type and the source --
// so the card prints the pathway and the mode, and does not invent a third field to fill a slot.
//
// ⚠ BOTH LISTS RESTATE migration 194's CHECK CONSTRAINTS IN FULL, and the harness parses the migration
// to prove it: a label map that silently lacks a value renders that encounter's kind as a raw database
// token, which is how `scheduled_followup` reaches a clinician's screen.

export const PATHWAY_LABEL: Record<string, string> = {
  booked: "Booked",
  new_walk_in: "New walk-in",
  walk_in_followup: "Walk-in follow-up",
  scheduled_followup: "Scheduled follow-up",
};

export const MODE_LABEL: Record<string, string> = {
  in_person: "In person",
  teleconsultation: "Teleconsultation",
  outreach: "Outreach",
  home_visit: "Home visit",
  hospital: "Hospital",
};

// ── s4.4: THE LAST COMPLETED COMPONENT ──────────────────────────────────────────────────────────────
//
// s6: "Last completed component, where useful." The comp draws "Last completed: Medication entered".
//
// ⚠ EVERY ENTRY HERE IS A TABLE THAT EXISTS AND A ROW THAT WAS WRITTEN. Nothing is inferred from a
// timestamp on the encounter itself: "last updated" is not "last completed", and an encounter whose
// status changed has a fresh updated_at with no clinical content behind it.

export const COMPONENT_LABEL: Record<string, string> = {
  reason: "Reason for visit recorded",
  note_subjective: "History taken",
  note_objective: "Examination recorded",
  note_assessment: "Clinical impression written",
  note_plan: "Plan written",
  note_narrative: "Note written",
  diagnosis: "Diagnosis recorded",
  treatment: "Treatment recorded",
  medication: "Medication entered",
  procedure: "Procedure recorded",
  decision: "Clinical decision recorded",
  investigation: "Investigation requested",
  outcome: "Outcome recorded",
};

// ── s4.6: ENCOUNTER ATTENTION ───────────────────────────────────────────────────────────────────────
//
// s4.6 is a fence as much as a list: "Encounter-specific only ... Do not include overdue follow-ups,
// unreviewed general documents or draft letters." The board this file replaces DID include all three,
// and they move out.

export type AttentionRowKey = "incomplete" | "ready_to_sign" | "medication_safety" | "missing_required_data";

/**
 * ⚠ THE ONE ROW IN THE COMP THAT WOULD TELL A CLINICAL LIE, AND WHAT IT BECOMES.
 *
 * The approved comp draws a tile reading:
 *
 *     0  ·  Unresolved safety alerts  ·  Medication safety requires review
 *
 * THERE IS NO MEDICATION SAFETY ALERT STORE IN THIS PRODUCT. The only op_safety_alerts table
 * (migration 038:108) is hospital_id-scoped -- the competency estate, not Competen Practice -- and the
 * only workspace-scoped alert table, practice_parameter_alert (migration 246:749), holds CLINICAL
 * PARAMETER alerts (reference_range, missing_overdue, trend_deviation ...) and has no medication concept
 * and no encounter_id.
 *
 * The nine medication safety checks MED-001 s4 asks for were DECLINED RATHER THAN SHIPPED EMPTY, and the
 * prescribing screen prints the reasoning two screens away: "an empty rule table makes every check
 * return nothing to say, which a clinician reads as safe ... the absence of a warning on this screen
 * carries no information about safety."
 *
 * ⚠ SO A TILE READING NOUGHT WOULD CONTRADICT A WARNING THIS PRODUCT ALREADY PRINTS, AND WOULD DO IT IN
 * THE REASSURING DIRECTION. A nought is a claim that somebody looked and found none. Nobody looked.
 *
 * It is therefore rendered as a permanently `not_checked` row -- the pattern form-constants.ts,
 * checklist-constants.ts and MedicationPanel's NotCheckedPanel already established: slate, dashed, a
 * hollow mark, NO FIGURE AT ALL, and the nine deferred checks named beneath it. `count` is not `0` and
 * is not `null`; the row has no count field, so no future edit can put one there without changing the
 * type.
 */
export const MEDICATION_SAFETY_ROW = {
  key: "medication_safety" as const,
  label: "Medication safety",
  /** ⚠ A LITERAL. A row that could become a number would eventually become a nought. */
  state: "not_checked" as const,
  chip: NOT_CHECKED_TONE,
  chipLabel: NOT_CHECKED_LABEL,
  mark: "◌",
  detail:
    "No medication safety check runs in this product, so there is no number to show and a nought here "
    + "would be false. It would say somebody looked and found nothing wrong; nobody looked. The nine "
    + "checks MED-001 s4 asks for were declined rather than shipped against an empty rule table, "
    + "because a check with no rules behind it returns nothing to say and reads as safe.",
  /** The nine, by name, so the absence is specific rather than a shrug. */
  checks: DEFERRED_SAFETY_CHECKS.map(c => ({ key: c.key, label: c.label })),
  href: "/practice/medications",
} as const;

/** The nine names, exported for the harness so it cannot re-type a shorter list and agree with itself. */
export const MEDICATION_SAFETY_CHECK_KEYS = DEFERRED_SAFETY_CHECKS.map(c => c.key);

// ── s4.2: THE CURRENT CONTEXT STRIP ─────────────────────────────────────────────────────────────────
//
// s4.2: "A compact strip only ... When none exists, show 'No active session' and confirm that encounters
// can still be recorded independently." s14: "No current session is not an error."

export type ContextState = "running" | "none" | "unreadable" | "not_permitted";

export const CONTEXT_TEXT: Record<ContextState, string> = {
  running: "New encounters started here inherit this session, and through it the location and facility it carries.",
  // ⚠ NOT AN ERROR, AND THE SENTENCE SAYS SO OUTRIGHT. A practitioner who reads "no active session" as a
  // fault will go looking for the fault instead of seeing the patient.
  none: "No active session. That is not a fault: an encounter recorded outside any session is ordinary, and it will simply carry no session.",
  unreadable: "Your session could not be read, so what a new encounter would inherit is unknown. Do not take this as no session.",
  not_permitted: "Your role does not carry the permission to see the day's plan, so no session context is shown. Encounters can still be recorded.",
};

/**
 * Where "Change context" goes.
 *
 * ⚠ IT IS A LINK, NOT A PICKER, BECAUSE NOTHING ON THIS PAGE MAY START A SESSION. An activity is started
 * and switched on the command centre, which owns the day; a second control here would be a second answer
 * to "what am I doing now", and the frozen decision at the top of this file forbids exactly that. The
 * label is the comp's word and the caption says where the press lands, which is the rule this codebase
 * wrote down twice this week after a control that "opened" something the page never showed.
 */
export const CHANGE_CONTEXT_HREF = "/practice/today";

// ── s13: OFFLINE ────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ AC-15 IS MET BY THERE BEING NOTHING TO MISREPRESENT, AND THAT IS WORTH WRITING DOWN RATHER THAN
// LEAVING AS AN ABSENCE.
//
// s13 asks that locally pending changes be distinguished from server-confirmed state. This page is
// rendered on the server from the database, so every row it draws IS server-confirmed. The offline
// family (offline-store.ts) is browser-only and read-only by its own header -- "no queue, no outbox, no
// pending state and no mutation of a stored record" -- so there is no pending state in this product for
// this page to mislabel. The day an outbox exists, this constant is what a reviewer greps for.
export const OFFLINE_PENDING_STATE_EXISTS = false;
