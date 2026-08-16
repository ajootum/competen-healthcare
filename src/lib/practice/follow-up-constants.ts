// CPR-140's state table, in a module with NO server imports so the board derives its buttons from the
// same source the engine enforces -- the split encounter-constants.ts and document-constants.ts exist
// for, applied to the third object with a lifecycle.
//
// THERE IS NO OVERDUE STATE HERE, AND THAT IS THE POINT. Overdue is derived from the due date against
// the practice's clock every time it is read (see follow-ups.ts and migration 196's header). A status
// value would need something to run to set it, and the thing it needs is exactly what a neglected
// practice does not do.
//
// MISSED IS REVERSIBLE, deliberately. A patient who was given up on in March and walks in in June has
// not made the March judgement wrong -- but the obligation is live again, and a record that could not
// say so would force somebody to raise a duplicate and lose the history.

// ── CPR-FUP-002 s4 ADDS TWO STATES AND REFUSES A THIRD ───────────────────────────────────────────────
//
// s4 gives "Draft -> Active -> Due -> Completed, plus Deferred and Cancelled". Three of those six are
// changes to this table, and the fourth is the one that matters most:
//
//   Active    IS `OPEN`. Same state, different word. Renaming it would rewrite every row and every
//             caller for no behaviour, so the word stays and this is the mapping.
//   Draft     added. A follow-up being composed and not yet owed by anybody. It is NOT on the board,
//             which is the only thing that makes it different from OPEN.
//   Deferred  added. Pushed to a later date on purpose, with that date REQUIRED (migration 239's
//             practice_follow_up_deferred_needs_date) -- a deferral with no date is an obligation
//             nobody will ever be reminded of again, which is the failure this module exists to stop.
//   Due       ⚠ IS NOT HERE AND MUST NEVER BE. See the note above: it is derived from due_on against
//             the practice's today at read time, every time. s11 asks for exactly that in its own
//             words. A stored DUE needs something to run to become true, and the thing it needs is
//             what a neglected practice does not do -- the board would go quietest for the practices
//             that had forgotten most.
export const FOLLOW_UP_TRANSITIONS: Record<string, string[]> = {
  // A draft is either taken up or thrown away. It cannot be completed, because nothing was ever owed.
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["SCHEDULED", "DEFERRED", "COMPLETED", "MISSED", "CANCELLED"],
  SCHEDULED: ["OPEN", "DEFERRED", "COMPLETED", "MISSED", "CANCELLED"],
  // Deferred is a live obligation with a later date on it, so everything an open one can do, it can do.
  DEFERRED: ["OPEN", "SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"],
  COMPLETED: [],
  MISSED: ["OPEN"],
  CANCELLED: [],
};

/** Live = still owed by somebody. DRAFT is deliberately NOT live: nothing has been committed to yet. */
export const LIVE_FOLLOW_UP_STATUSES = ["OPEN", "SCHEDULED", "DEFERRED"] as const;

/**
 * CPR-FUP-002 s3/s5's `source`, and migration 239's constraint, in the same order.
 *
 * ⚠ THE SECOND ELEMENT IS WHETHER A PRACTITIONER MAY PICK IT BY HAND. Only `manual` may be chosen: every
 * other value is a claim that a particular row raised this obligation, and a screen that let somebody
 * type "investigation" against a follow-up no investigation produced would make `source` unusable for
 * the one question it exists to answer.
 */
export const FOLLOW_UP_SOURCES = [
  ["encounter", "Encounter", false],
  ["manual", "Manual", true],
  ["document", "Document", false],
  ["investigation", "Investigation", false],
  ["referral", "Referral", false],
  ["pathway", "Pathway", false],
  ["assistant", "Assistant", false],
] as const;

/** Migration 239's `origin_workspace` list. Screens, not rows -- which is why it is text and not a key. */
export const FOLLOW_UP_ORIGIN_WORKSPACES = [
  "encounters", "patients", "follow_ups", "documents", "planner", "session", "pathways",
] as const;

export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft", OPEN: "Open", SCHEDULED: "Scheduled", DEFERRED: "Deferred",
  COMPLETED: "Completed", MISSED: "Missed", CANCELLED: "Cancelled",
};

/**
 * ⚠ THE DERIVED STATES. NONE OF THESE IS A COLUMN, AND NONE OF THEM MAY BECOME ONE.
 *
 * `dueState` is computed in deriveFollowUp() from the effective due date against the practice's today.
 * It is what the board's five cards and the work queue's Status column are built out of, and it is the
 * reason nothing has to run for a forgotten obligation to appear.
 */
export const FOLLOW_UP_DUE_STATES = ["overdue", "due_today", "due_this_week", "upcoming", "draft", "closed"] as const;
export type FollowUpDueState = (typeof FOLLOW_UP_DUE_STATES)[number];

/** How far ahead "this week" reaches, INCLUDING today. Seven days, stated so the label can say it. */
export const DUE_WEEK_DAYS = 7;

/** Closed = no longer owed. Stamps closed_at / closed_by. */
export const CLOSED_FOLLOW_UP_STATUSES = ["COMPLETED", "MISSED", "CANCELLED"];

/**
 * CPR-FUP-002 s5/s6: Category answers WHAT DOMAIN the obligation belongs to -- never what action
 * must happen, which is follow_up_type's question (s3). Two lists on purpose:
 *
 *   FOLLOW_UP_CATEGORIES is what forms OFFER -- the spec's seven domains.
 *   FOLLOW_UP_KINDS is what the product ACCEPTS AND CAN LABEL -- the offered seven plus the codes
 *   that predate the split ('review', 'monitoring', 'immunisation'). s14: historical records retain
 *   their original code, and offline devices may hold in-flight captures carrying the old codes, so
 *   the accepted set only ever widens. Labels here may change; codes never do.
 */
export const FOLLOW_UP_CATEGORIES = [
  ["clinical_condition", "Clinical condition"],
  ["investigation_result", "Investigation / result"],
  ["treatment_response", "Treatment"],
  ["procedure_intervention", "Procedure / intervention"],
  ["referral_outcome", "Referral"],
  ["administrative", "Administrative"],
  ["other", "Other"],
] as const;

export const FOLLOW_UP_KINDS = [
  ...FOLLOW_UP_CATEGORIES,
  // Pre-CPR-FUP-002 codes: valid on historical rows and in-flight offline captures, offered nowhere.
  ["review", "Clinical review"],
  ["monitoring", "Ongoing monitoring"],
  ["immunisation", "Immunisation"],
] as const;

export const FOLLOW_UP_PRIORITIES = ["routine", "soon", "urgent"] as const;

/**
 * CPR-FUP-HFE-008 s6/s10 (migration 299): HOW the obligation is meant to be fulfilled.
 *
 * ⚠ THIS IS AN INTENTION AND NEVER A BOOKING. s10: "follow-up type describes how the obligation is
 * expected to be fulfilled; it does NOT prove fulfillment has been scheduled", and s22 makes
 * "booking does not imply clinical completion" an acceptance criterion. The column that says a visit
 * exists is appointment_id, set only by scheduleFollowUp and cleared by migration 196's trigger if
 * that appointment dies. A screen that read `appointment` as `booked` would be claiming a visit exists
 * because somebody chose a word in a dropdown.
 */
/**
 * CPR-FUP-002 s3: the controlled ACTION taxonomy -- what must happen next. These nine are what forms
 * OFFER. medication_review is deliberately absent from the offer (s4: configuration-ready, enabled
 * later by practice or specialty) but present in the accepted set, so enabling it is a UI decision
 * and not a migration. Do not auto-select 'other' anywhere (s9).
 */
export const FOLLOW_UP_ACTION_TYPES = [
  ["clinical_review", "Clinical review"],
  ["results_review", "Results review"],
  ["treatment_review", "Treatment review"],
  ["post_procedure", "Post-procedure review"],
  ["repeat_investigation", "Repeat investigation"],
  ["referral_followup", "Referral follow-up"],
  ["contact_patient", "Contact patient"],
  ["administrative", "Administrative"],
  ["other", "Other"],
] as const;

/**
 * CPR-FUP-002 HFE s7: the deterministic action-to-category inferences. Category is metadata for
 * filtering and reporting -- it must not be a second question in the primary capture flow, so the
 * form derives it from the chosen action and files it silently, editable under More details. Every
 * offered action maps somewhere ON PURPOSE: an action with no entry would leave the previous
 * inference standing, which is a category from a different answer. contact_patient maps to the
 * clinical domain because a contact about anything else would be filed under its own action
 * (administrative has one). Urgency is NEVER inferred from category (s7).
 */
export const FOLLOW_UP_ACTION_CATEGORY: Record<string, string> = {
  clinical_review: "clinical_condition",
  results_review: "investigation_result",
  repeat_investigation: "investigation_result",
  treatment_review: "treatment_response",
  medication_review: "treatment_response",
  post_procedure: "procedure_intervention",
  referral_followup: "referral_outcome",
  contact_patient: "clinical_condition",
  administrative: "administrative",
  other: "other",
};

/** The ACCEPTED set: offered nine + config-ready medication_review + the pre-FUP-002 codes that live
 *  on historical rows and in-flight offline captures. Only ever widens (s14). */
export const FOLLOW_UP_TYPES = [
  "clinical_review", "results_review", "treatment_review", "post_procedure",
  "repeat_investigation", "referral_followup", "contact_patient", "administrative", "other",
  "medication_review",
  "appointment", "review", "contact",
] as const;

export const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  clinical_review: "Clinical review", results_review: "Results review",
  treatment_review: "Treatment review", post_procedure: "Post-procedure review",
  repeat_investigation: "Repeat investigation", referral_followup: "Referral follow-up",
  contact_patient: "Contact patient", administrative: "Administrative", other: "Other",
  medication_review: "Medication review",
  appointment: "Appointment", review: "Review", contact: "Contact",
};

/**
 * CPR-140's outcome taxonomy (migration 206). Fixed, because the point of it is COUNTING -- "how did the
 * last thirty post-op reviews turn out" is not answerable over free text.
 *
 * THE WORDS ARE STILL REQUIRED ALONGSIDE. A code that replaced the sentence would turn "much better,
 * discharged to the GP with a note about the rash" into "improved", and the rash would leave the record.
 *
 * The second element is whether the code counts as a GOOD outcome. Deliberately absent for `referred`
 * and `other`: a referral is neither, and calling it one would be this product making a clinical
 * judgement it has no basis for.
 */
export const FOLLOW_UP_OUTCOMES = [
  ["improved", "Improved", true],
  ["no_change", "No change", false],
  ["worsened", "Worsened", false],
  ["referred", "Referred on", null],
  ["other", "Other", null],
] as const;

/** The API's action vocabulary, one name per target status. */
export const FOLLOW_UP_ACTIONS: Record<string, string> = {
  complete: "COMPLETED", missed: "MISSED", cancel: "CANCELLED", reopen: "OPEN",
  // A draft being taken up. Same target as `reopen` and a different word on purpose: "reopen" describes
  // undoing a judgement and "activate" describes finishing composing one, and the trail should say which.
  activate: "OPEN",
};

export function followUpLabelFor(to: string): string {
  return ({
    OPEN: "Reopen",
    SCHEDULED: "Book a visit for this",
    DEFERRED: "Defer to a later date",
    COMPLETED: "Close as done",
    MISSED: "Mark missed",
    CANCELLED: "No longer needed",
  } as Record<string, string>)[to] ?? to;
}

// ── CPR-FUP-001 s4's FIVE SUMMARY CARDS AND ITS SAVED VIEWS, AS ONE LIST OF PREDICATES ───────────────
//
// ⚠ A CARD'S FIGURE IS THE LENGTH OF THE LIST THAT CARD OPENS, AND THIS IS WHAT MAKES THAT STRUCTURAL
// RATHER THAN A PROMISE. The count and the filter are the SAME function. When they were two -- a card
// counting rows while the list it opened deduplicated patients -- the tile said 14 and the list showed
// 9, and nothing in the code looked wrong. Adding a card means adding one entry here; there is nowhere
// else to add it, so there is nowhere for the two to drift apart.
//
// SAVED VIEWS ARE FILTERS, NOT ROUTES (s3: "internal views are implemented as tabs and filters within
// the workspace"). Every one of these is reachable as ?view=<key> on the one page.

/** The shape a view predicate needs. Structural, so this module still imports nothing. */
export type ViewableFollowUp = {
  status: string;
  dueState: FollowUpDueState;
  overdue: boolean;
  appointment_id: string | null;
  closed_at?: string | null;
};

/** The practice's own today, passed in rather than read, so a predicate is a pure function of its inputs. */
export type ViewContext = { today: string };

/** Whole days between two YYYY-MM-DD dates. Pure, so it may live beside the predicates that need it. */
export const daysApart = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/** How far back the Completed card and the Completed tab both look. One number, used by one predicate. */
export const COMPLETED_WINDOW_DAYS = 30;

export type FollowUpView = {
  key: string;
  /** The tab's word. */
  label: string;
  /** What the figure counts, in a sentence, because several of these overlap and a card must say so. */
  blurb: string;
  /** One of the five cards in s4. */
  card: boolean;
  match: (f: ViewableFollowUp, ctx: ViewContext) => boolean;
};

export const FOLLOW_UP_VIEWS: FollowUpView[] = [
  {
    key: "all", label: "All open", card: false,
    blurb: "Everything still owed: open, booked, deferred and drafted.",
    match: f => !["COMPLETED", "MISSED", "CANCELLED"].includes(f.status),
  },
  {
    key: "overdue", label: "Overdue", card: true,
    blurb: "The effective due date has passed and nothing is booked. Derived from the date against this practice's today - nothing runs to put a follow-up here.",
    match: f => f.overdue,
  },
  {
    key: "due_today", label: "Due today", card: true,
    blurb: "Due on this practice's today. Not overdue yet.",
    match: f => f.dueState === "due_today",
  },
  {
    key: "due_week", label: "Due this week", card: true,
    blurb: `Due within the next ${DUE_WEEK_DAYS} days, today included. Overlaps "Due today" on purpose - it is a wider window, not a different set.`,
    match: f => f.dueState === "due_today" || f.dueState === "due_this_week",
  },
  {
    // ⚠ NOT THE COMP'S "AWAITING REVIEW" / "AWAITING PATIENT". Those are two statuses this engine does
    // not have and cannot infer: nothing records that a result is being waited on, or that a patient has
    // been rung. CPR-FUP-001 s4 names the card "Awaiting Action", and this is the one definition of that
    // phrase the data actually supports -- a live obligation with no appointment behind it, so nothing
    // has been arranged and the next move is somebody's.
    key: "awaiting", label: "Awaiting action", card: true,
    blurb: "Live and with no appointment behind it, so the next move has not been arranged yet.",
    match: f => (LIVE_FOLLOW_UP_STATUSES as readonly string[]).includes(f.status) && !f.appointment_id,
  },
  {
    // ⚠ THE WINDOW IS IN THE PREDICATE, NOT IN THE CARD. The comp labels this "Completed (30 days)", and
    // the obvious build is a card that counts a window over a tab that shows everything -- which is the
    // exact bug this file's header is about: the figure would not be the length of the list it opens.
    key: "completed", label: "Completed", card: true,
    blurb: `Closed as done within the last ${COMPLETED_WINDOW_DAYS} days. One older than that is in "Closed", not here.`,
    match: (f, ctx) =>
      f.status === "COMPLETED" && !!f.closed_at &&
      daysApart(String(f.closed_at).slice(0, 10), ctx.today) <= COMPLETED_WINDOW_DAYS,
  },
  {
    key: "drafts", label: "Drafts", card: false,
    blurb: "Composed and not yet owed by anybody. Drafts are deliberately absent from every other view.",
    match: f => f.status === "DRAFT",
  },
  {
    key: "closed", label: "Closed", card: false,
    blurb: "Completed, missed or cancelled - however they were settled.",
    match: f => ["COMPLETED", "MISSED", "CANCELLED"].includes(f.status),
  },
];

export const FOLLOW_UP_VIEW_KEYS = FOLLOW_UP_VIEWS.map(v => v.key);

export function followUpView(key: string | null | undefined): FollowUpView {
  return FOLLOW_UP_VIEWS.find(v => v.key === key) ?? FOLLOW_UP_VIEWS[0];
}

// ── CPR-FUP-HFE-008 s5: IS ANYTHING OWED TO THIS PATIENT, ANSWERED BEFORE THE TABLE ─────────────────
//
// s3's first HFE goal is "visibility of system status: immediately show whether anything is owed". The
// encounter tab answered it only by implication -- an empty table meant nothing, a full one meant
// something, and the practitioner did the counting.
//
// ⚠ s5: "DO NOT USE A SUCCESS COLOUR IF AN OVERDUE OR URGENT ITEM EXISTS." That is the whole reason this
// is a function with a test rather than three lines of JSX. Green here means "you owe this patient
// nothing", and it is the single most consequential sentence on the tab: a practitioner who reads it
// wrongly closes a consultation on somebody who is nine days overdue for a swab result.

export type FollowUpSummaryTone = "clear" | "open" | "attention" | "overdue";

export type FollowUpSummary = {
  tone: FollowUpSummaryTone;
  owed: number;
  overdue: number;
  urgent: number;
  /** The sentence the card leads with. */
  headline: string;
  /** The supporting line. Always says whether the read SUCCEEDED, which is s5's "derive from actual state". */
  detail: string;
};

/**
 * ⚠ THE UNAVAILABLE CASE IS FIRST AND IT IS NOT "NOTHING IS OWED". listFollowUps returns
 * `{items, unavailable, detail}` precisely because a failed read used to render as an empty list, and an
 * empty follow-up list reads as "nobody is waiting on you" -- the single worst sentence this product can
 * get wrong. A summary card that collapsed the three states back into two would undo that fix in the
 * one place it is read fastest.
 */
export function followUpSummary(
  items: { overdue: boolean; priority?: string | null }[],
  opts: { unavailable: boolean } = { unavailable: false },
): FollowUpSummary {
  if (opts.unavailable) {
    return {
      tone: "attention", owed: 0, overdue: 0, urgent: 0,
      headline: "Follow-ups could not be read",
      detail: "Do not take this as nothing being owed to this patient.",
    };
  }

  const owed = items.length;
  const overdue = items.filter(f => f.overdue).length;
  const urgent = items.filter(f => String(f.priority ?? "").toLowerCase() === "urgent").length;

  if (owed === 0) {
    return {
      tone: "clear", owed: 0, overdue: 0, urgent: 0,
      headline: "Nothing is owed to this patient",
      // s5 wants supporting text, and the three-state rule wants it to say the read WORKED.
      detail: "No follow-up is open. This was read successfully -- raise one below if something should happen after today.",
    };
  }

  // ⚠ OVERDUE OUTRANKS URGENT, AND THE ORDER IS DELIBERATE. An urgent follow-up raised today is working
  // as intended; an overdue one is a commitment already broken, and s16 gives it "the strongest list
  // exception state". Reporting the urgent count first would put the louder colour on the calmer fact.
  const plural = owed === 1 ? "follow-up is" : "follow-ups are";
  if (overdue > 0) {
    return {
      tone: "overdue", owed, overdue, urgent,
      headline: `${overdue} of ${owed} ${plural} overdue`,
      detail: "The target date has passed and nothing is booked. This is derived from the date, so it became true on its own.",
    };
  }
  if (urgent > 0) {
    return {
      tone: "attention", owed, overdue, urgent,
      headline: `${owed} ${plural} owed, ${urgent} urgent`,
      detail: "Nothing is overdue yet. Priority is what somebody set; overdue is what the date decided.",
    };
  }
  return {
    tone: "open", owed, overdue, urgent,
    headline: `${owed} ${plural} owed to this patient`,
    detail: "Nothing is overdue or urgent.",
  };
}

/**
 * s12's filter row for the ENCOUNTER tab.
 *
 * ⚠ s8 SAYS PRIORITY AND STATUS ARE SEPARATE CONCEPTS AND s12'S OWN FILTER LIST MIXES THEM
 * ("All/Open/Soon/Urgent/Overdue"). Soon and Urgent are priorities a person set; Open and Overdue are
 * states the date and the lifecycle decided. Left in one undifferentiated row they read as one scale,
 * which is exactly what s8 forbids -- so the `axis` field is carried here and the screen groups by it.
 *
 * ⚠ AND THESE ARE PREDICATES, NOT COUNTS-PLUS-A-SEPARATE-FILTER. FOLLOW_UP_VIEWS' header records what
 * happened when a card's figure and the list it opened were two different functions: the tile said 14
 * and the list showed 9, and nothing looked wrong. One function, used for both.
 */
export type FollowUpTabFilter = {
  key: string; label: string; axis: "state" | "priority";
  match: (f: { overdue: boolean; priority?: string | null; status: string }) => boolean;
};

export const FOLLOW_UP_TAB_FILTERS: FollowUpTabFilter[] = [
  { key: "all", label: "All", axis: "state", match: () => true },
  { key: "overdue", label: "Overdue", axis: "state", match: f => f.overdue },
  {
    key: "booked", label: "Booked", axis: "state",
    // s13: "booking must never be conflated with clinical completion." A booked obligation is still
    // owed -- it is in this list because it is unresolved, and the chip says only that a visit exists.
    match: f => f.status === "SCHEDULED",
  },
  { key: "soon", label: "Soon", axis: "priority", match: f => String(f.priority ?? "").toLowerCase() === "soon" },
  { key: "urgent", label: "Urgent", axis: "priority", match: f => String(f.priority ?? "").toLowerCase() === "urgent" },
];

/** s8's priority treatment. Routine is neutral, not green -- green would say "resolved". */
export const FOLLOW_UP_PRIORITY_CHIP: Record<string, string> = {
  routine: "border-slate-200 bg-slate-50 text-gray-600",
  soon: "border-amber-200 bg-amber-50 text-amber-700",
  urgent: "border-rose-300 bg-rose-50 text-rose-700",
};

/** s16: colour is never the sole carrier. Every priority has a glyph as well as a tint. */
export const FOLLOW_UP_PRIORITY_GLYPH: Record<string, string> = {
  routine: "", soon: "!", urgent: "!!",
};
