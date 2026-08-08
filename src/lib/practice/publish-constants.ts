// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 6 -- PUBLISH READINESS. The constants half.
//
// s19's Phase 6 is "Readiness, interactive preview, analytics events and optimisation hooks", exit
// condition "WORKSPACE IS PRODUCTION-READY AND MEASURABLE". This file is s10.2's publish-validation
// table, verbatim in meaning, plus the checks migration 254 moved into the database and the one that is
// a fact about the build.
//
// ⚠ PUBLISH READINESS IS A CHECKLIST, AND A CHECK NOBODY CAN PERFORM MUST SAY "NOT CHECKED".
//
// It must never render as a green tick and it must never fall silent. An unwarned screen reads as a
// cleared screen -- migration 238's allergy comment records exactly that lesson, and this is the same
// shape of mistake with a booking page behind it instead of a drug chart. So `state` below has THREE
// values, not two, and `not_checked` is the honest answer for the two rows of s10.2 whose facts have no
// column to live in.
//
// ---- WHO DECIDES EACH CHECK ------------------------------------------------------------------------
//
//   engine    A fact about other tables -- locations, sessions, rules, registration fields. Only an
//             engine can see across them, which is what migration 254's own header says.
//   database  ⚠ A fact about the practice_booking_access ROW, enforced by the constraint
//             `practice_booking_access_publishable`. THE ENGINE DOES NOT RE-IMPLEMENT THESE. It reports
//             what the row says so a practitioner can see the gap before trying, and when they try, the
//             DATABASE refuses and the refusal is reported with the constraint named. A rule written
//             twice is a rule that will one day be written differently in the two places, and the copy
//             that matters is the one nobody can bypass.
//   build     A fact about this code. No configuration removes it and the checklist says so plainly.
//   absent    ⚠ NOT CHECKABLE. The column or the store does not exist, so nothing here can answer.
//             Rendered as "not checked", with what it would take to check it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY CAPABILITY CODE PHASE 6 NAMES, AS AN EXPORTED ARRAY.
 *
 * Same reason patient-access-constants.ts exports its own: a code reached through a constants object is
 * invisible to the audit harness's literal scanner, and six invented codes have shipped here. Asserted
 * against the live catalogue, which held 47 codes when this was written.
 */
export const PUBLISH_CAPABILITIES: string[] = [
  // s14: "Publish booking page -- account owner: yes; authorised staff: explicit permission only."
  // Configuring what a practice exposes to the outside is the same decision as its timezone or its AI
  // disclosure, and it is the capability patient-access already names for exactly that.
  "practice.settings.manage",
];

export type PublishSeverity = "blocker" | "warning" | "advisory";
export type PublishAuthority = "engine" | "database" | "build" | "absent";

export type PublishCheckDefinition = {
  code: string;
  /** s10.2's requirement, in a practitioner's words rather than a column's. */
  requirement: string;
  severity: PublishSeverity;
  authority: PublishAuthority;
  /** Why this matters, shown under the row when it fails or cannot be checked. */
  detail: string;
  /** ⚠ Only for `absent`: exactly what would make this checkable. Named so the gap is actionable. */
  wouldNeed: string | null;
};

/**
 * s10.2's table, in its own order, then the three the database owns, then the one the build owns.
 *
 * ⚠ THE ORDER IS THE ORDER SOMEBODY CAN ACT ON THEM. Blockers a practice can fix come first; the
 * database's row-level rules next, because they are one screen away; the build blocker last, because
 * nobody using this product can do anything about it and burying the fixable ones under it would be
 * unhelpful.
 */
export const PUBLISH_CHECKS: PublishCheckDefinition[] = [
  {
    code: "LOCATION_ACTIVE",
    requirement: "At least one active location exists",
    severity: "blocker", authority: "engine",
    detail: "A booking page with nowhere to be sends patients to an address the practice does not have.",
    wouldNeed: null,
  },
  {
    code: "SESSION_BOOKABLE",
    requirement: "At least one bookable recurring or one-off session exists",
    severity: "blocker", authority: "engine",
    detail: "Sessions are opened to patients one at a time on purpose. A page over a week nobody may book is a page that can only say no.",
    wouldNeed: null,
  },
  {
    code: "APPOINTMENT_TYPE_LINKED",
    requirement: "At least one active appointment type is linked",
    severity: "blocker", authority: "engine",
    detail: "s4.3: zero appointment types means not patient-bookable. A bookable session offering nothing is a contradiction the page would have to explain after the fact.",
    wouldNeed: null,
  },
  {
    code: "SESSION_RULE_COVER",
    requirement: "Every published session has an applicable booking rule",
    severity: "blocker", authority: "engine",
    detail: "A session no rule in force covers has no notice period, no horizon and no capacity limit, so nothing constrains how far ahead or how full it gets.",
    wouldNeed: null,
  },
  {
    code: "ACCESS_MODE_SELECTED",
    requirement: "Patient booking access mode is selected",
    severity: "blocker", authority: "engine",
    detail: "s8's four modes decide who may reach the page at all. A practice with no booking-access profile has chosen nothing, which is not the same as having chosen internal-only.",
    wouldNeed: null,
  },
  {
    code: "REGISTRATION_FIELDS_VALID",
    requirement: "Required registration fields are valid",
    severity: "blocker", authority: "engine",
    detail: "A field that is required and hidden can never be filled in, and a required choice with no options is a question with no answers. Either one is a form nobody can submit.",
    wouldNeed: null,
  },
  {
    code: "RESERVED_WITHIN_CAPACITY",
    requirement: "Reserved capacity does not exceed total capacity",
    severity: "blocker", authority: "engine",
    detail: "s7.4: reserved capacity may not exceed the session capacity. Where it does, the rule promises places that do not exist.",
    wouldNeed: null,
  },
  {
    code: "RULE_CONFLICTS_RESOLVED",
    requirement: "No two rules tie on specificity and priority",
    severity: "blocker", authority: "engine",
    detail: "s11: at equal specificity and equal priority, activation is blocked until the conflict is resolved. A booking both rules cover is refused rather than guessed at, so publishing over a tie publishes a page that will refuse people for a reason they cannot see.",
    wouldNeed: null,
  },
  {
    code: "NOTIFICATION_CHANNEL",
    requirement: "A notification channel is available",
    severity: "warning", authority: "engine",
    detail: "Patient booking is protected by a one-time code sent to a phone or an inbox. With no gateway and no mail provider there is nothing to send it with -- and a code that cannot be sent is not a code.",
    wouldNeed: null,
  },
  {
    code: "LOCATION_DIRECTIONS",
    requirement: "Every visible location has directions and contact information",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED. practice_location holds a name, a type, a country, an active flag, a travel buffer and a facility link -- and no address, no directions, no telephone number and no email. So nothing here can tell whether a patient could find the place, and this row is not a pass.",
    wouldNeed: "Address, directions and contact columns on practice_location (or a linked practice_location_contact store), plus a rule for which of them a published location must have.",
  },
  {
    code: "WAITING_LIST",
    requirement: "Waiting-list behaviour is configured",
    severity: "advisory", authority: "absent",
    detail: "⚠ NOT CHECKED. There is no waiting-list configuration anywhere in this schema. The only trace of the idea is `waiting_list` as one resolution a person may choose for a booking a schedule change got in the way of (migration 242), which is a decision about one patient rather than a behaviour a practice has configured.",
    wouldNeed: "A waiting-list store, or columns on practice_booking_rule saying what happens when a session is full.",
  },
  {
    code: "HANDLE_CLAIMED",
    requirement: "The practice has claimed a booking handle",
    severity: "blocker", authority: "database",
    detail: "A published page with no address is a page nobody can reach that nonetheless reports itself live. `practice_booking_access_publishable` refuses it, and nothing in this engine repeats that rule.",
    wouldNeed: null,
  },
  {
    code: "OTP_REQUIRED",
    requirement: "The one-time code is switched on",
    severity: "blocker", authority: "database",
    detail: "With practitioner approval gone, the code is the only thing between the diary and anybody who can type a name. The same constraint refuses a published page without it -- which is what stops the verification being switched off in the afternoon somebody finds it inconvenient.",
    wouldNeed: null,
  },
  {
    code: "MODE_ADMITS_PATIENTS",
    requirement: "The access mode admits patients",
    severity: "blocker", authority: "database",
    detail: "Publishing while internal-only is a contradiction. The same constraint refuses it, so `public` or `link_only` is the only combination a published row can hold.",
    wouldNeed: null,
  },
  {
    code: "INTAKE_BUILT",
    requirement: "The patient-facing intake exists",
    severity: "blocker", authority: "build",
    detail: "s19's Phase 4 asks for a handle, a link-only page, registration intake and confirmation. All four exist: the handle is claimed in Practice Setup, migration 254 landed the stores, and patient-booking.ts carries the intake and the confirmation. This row failed unconditionally until that was built, and passes unconditionally now -- what it never does is depend on configuration.",
    wouldNeed: null,
  },
];

export const publishCheck = (code: string) => PUBLISH_CHECKS.find(c => c.code === code) ?? null;

/** The checks nothing in this build can answer. Their state is always `not_checked`. */
export const PUBLISH_CHECKS_NOT_CHECKABLE: string[] =
  PUBLISH_CHECKS.filter(c => c.authority === "absent").map(c => c.code);

/** The checks the DATABASE owns. ⚠ The engine reports these; it does not enforce them. */
export const PUBLISH_CHECKS_DATABASE_OWNED: string[] =
  PUBLISH_CHECKS.filter(c => c.authority === "database").map(c => c.code);

/** The constraint that owns them, named so a refusal can be recognised rather than guessed at. */
export const PUBLISHABLE_CONSTRAINT = "practice_booking_access_publishable";

/**
 * ⚠ THE MODES A PUBLISHED ROW MAY HOLD, COPIED FROM migration 254'S CONSTRAINT.
 *
 * It is deliberately NOT the same list as PATIENT_ACCESS_MODES_REACHABLE. That one says what THIS BUILD
 * can honour; this one says what the DATABASE will accept on a published row. They answer different
 * questions and they are allowed to disagree -- and the checklist reports this one, because it is the
 * one the refusal will be about.
 */
export const PUBLISH_MODES_ADMITTING: string[] = ["public", "link_only"];

/** The publish states migration 254 allows, and what each one means to a patient. */
export const PUBLISH_STATES = [
  { code: "draft", label: "Draft", meaning: "Nobody outside this practice can reach it, and it is not finished." },
  { code: "ready", label: "Ready", meaning: "Finished, and still not reachable. Publishing is a separate, deliberate act." },
  { code: "published", label: "Published", meaning: "Live, at your handle, subject to the mode you chose." },
  { code: "published_with_warnings", label: "Published with warnings", meaning: "Live, with something on the checklist a practice chose to accept." },
  { code: "paused", label: "Paused", meaning: "Existing bookings remain; no new patient-facing requests are accepted." },
] as const;

export const PUBLISH_STATE_CODES: string[] = PUBLISH_STATES.map(s => s.code);
/** The two states that mean a page is live. Copied from migration 254's own constraint. */
export const PUBLISH_STATES_LIVE: string[] = ["published", "published_with_warnings"];

export const publishStateLabel = (code: string | null) =>
  PUBLISH_STATES.find(s => s.code === code)?.label ?? "No booking page";

/** Tinted swatches for the checklist. Parked here rather than in palette.ts, which is contended. */
export const PUBLISH_STATE_SWATCH: Record<string, { badge: string; text: string; box: string; icon: string }> = {
  pass: { badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", box: "border-emerald-200/80 bg-emerald-50/60", icon: "✓" },
  fail: { badge: "bg-rose-100 text-rose-700", text: "text-rose-700", box: "border-rose-200/80 bg-rose-50/60", icon: "✕" },
  // ⚠ SLATE AND A HOLLOW MARK. Never green, never a tick -- see the header.
  not_checked: { badge: "bg-slate-200 text-slate-700", text: "text-slate-600", box: "border-dashed border-slate-300 bg-slate-50/70", icon: "◌" },
};
