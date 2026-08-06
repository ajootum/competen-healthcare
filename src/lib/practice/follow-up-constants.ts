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

export const FOLLOW_UP_KINDS = [
  ["review", "Clinical review"],
  ["investigation_result", "Investigation result"],
  ["treatment_response", "Response to treatment"],
  ["referral_outcome", "Referral outcome"],
  ["monitoring", "Ongoing monitoring"],
  ["immunisation", "Immunisation"],
  ["other", "Other"],
] as const;

export const FOLLOW_UP_PRIORITIES = ["routine", "soon", "urgent"] as const;

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
