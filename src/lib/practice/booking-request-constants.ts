// THE PURE HALF OF THE UNVERIFIED BOOKING REQUEST -- WHAT A BROWSER MAY IMPORT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS FILE IMPORTS NOTHING, AND THAT IS THE WHOLE REASON IT EXISTS.
//
// booking-request-unverified.ts reaches evaluateBooking, audit and resolveBookingPage, which reach
// node:crypto and next/headers. A "use client" component importing a single label from it would drag the
// entire server graph into the browser bundle -- the failure that killed the Follow-ups board and passed
// tsc, eslint and every harness on the way through. registration-condition.ts was split out for exactly
// this reason and its header carries the argument at length.
//
// ⚠ NOTHING MAY BE IMPORTED INTO THIS FILE. Not a type from access, not a constant from palette. The
// moment it has one import, the next person adds a second, and the boundary is gone again.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ WHAT A PRACTICE-FACING SCREEN MUST SAY BESIDE A REQUEST, IN ONE PLACE SO IT CANNOT DRIFT.
 *
 * A practice ringing to confirm needs to know which kind of row it is holding. These are constants
 * rather than copy typed into a component, so the queue, the payload and the harness are the same three
 * strings and a change to one is a change to all three.
 */
export const VERIFICATION_MARKS = {
  verified: {
    label: "Code verified",
    sentence: "This person entered a code sent to the phone or inbox on this request, so it is theirs.",
  },
  unverified: {
    label: "NOT VERIFIED",
    sentence:
      "Nobody proved they control this phone or inbox. The name, the number and everything else on this "
      + "request are what a stranger typed. Treat it as a message rather than as a patient until you have "
      + "spoken to them.",
  },
} as const;

export type VerificationState = keyof typeof VERIFICATION_MARKS;

/**
 * The mark for a row, read from the row's own generated column.
 *
 * ⚠ ANYTHING THAT IS NOT THE WORD 'verified' IS UNVERIFIED. A null, an absent column and an unknown
 * value all land on the cautious side, because the one thing that must never happen is a row that proved
 * nothing rendering as one that did.
 */
export const verificationMarkOf = (state: unknown): VerificationState =>
  String(state) === "verified" ? "verified" : "unverified";

/** What a practice may record when it closes a request. Closed, because a free-text outcome is a report nobody can count. */
export const HANDLED_OUTCOMES = [
  { code: "contacted", label: "Spoke to them" },
  { code: "unreachable", label: "Could not reach them" },
  { code: "declined", label: "Not taking this booking" },
  { code: "duplicate", label: "Duplicate of another request" },
] as const;

export const HANDLED_OUTCOME_CODES: string[] = HANDLED_OUTCOMES.map(o => o.code);

/**
 * ⚠ THE SENTENCE A PATIENT IS GIVEN, IN ONE PLACE SO THE SCREEN AND THE HARNESS CANNOT DISAGREE.
 *
 * Every clause is true today: no appointment exists, the time is genuinely not held, the practice can
 * genuinely see it (there is a queue behind /practice/booking-requests), and nothing has been sent.
 */
export const UNVERIFIED_REQUEST_NOTE =
  "This is a request, not an appointment. Nothing has been booked and the time you chose is not being "
  + "held for you -- somebody else may still take it. The practice can see your request and will contact "
  + "you on the number or address you gave. No message has been sent to you, because this practice has no "
  + "way to send one yet, so nothing will arrive by text or email. Write down your reference.";

/** One row of the practice's queue. ⚠ Strings, numbers, booleans and nulls only -- see the note below. */
export type QueuedRequest = {
  id: string;
  reference: string;
  /** ⚠ THE ROW'S OWN GENERATED COLUMN. Never inferred from anything a screen happens to know. */
  verificationState: VerificationState;
  verificationLabel: string;
  verificationSentence: string;
  status: string;
  requestedStart: string;
  requestedMinutes: number;
  appointmentType: string;
  locationId: string | null;
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  reasonForVisit: string | null;
  /** ⚠ The patient's own words, prefixed in the column and prefixed here. Never a clinical statement. */
  statedDiagnosis: string | null;
  statedTreatment: string | null;
  createdAt: string;
  handledAt: string | null;
  handledOutcome: string | null;
  handledNote: string | null;
};
