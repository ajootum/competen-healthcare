// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s7 and s11 -- THE VOCABULARY OF A BOOKING RULE, in a file that touches no database.
//
// It lives apart from booking-rules.ts for the reason practice-session-constants.ts and
// schedule-exception-constants.ts already give, twice: booking-rules.ts imports provisioning.ts and the
// workspace context, and a "use client" component importing so much as a string from it drags that chain
// into the browser bundle and `next build` fails. tsc and eslint do NOT catch it -- a server-only import
// crossing that boundary killed the Follow-ups board this week having passed both. The rule, restated:
// A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
//
// The specificity arithmetic of s11 lives here too, and deliberately: s11 says "USERS MUST BE ABLE TO SEE
// WHY A RULE WON", so the card that explains the win computes the same number the engine decided with,
// from the same function, rather than from a second description of the same ladder.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import type { CardSwatch } from "@/lib/practice/palette";
import { conditionMet, type RegistrationFieldLike } from "@/lib/practice/registration-condition";
import type { FormFieldLike } from "@/lib/practice/form-field";

// ── s7.3's SIX BOOKING CHANNELS ──────────────────────────────────────────────────────────────────────
//
// AC-06: "The system supports DISTINCT RULES for patient, practitioner, staff, referral, follow-up and
// walk-in channels." All six may therefore be WRITTEN as a rule's scope and all six are shown on a card.
//
// ⚠ `door` IS NOT `written`. A rule for patient self-booking is a real, storable, evaluable rule; what
// does not exist is a patient-facing way to arrive at it, which is s8 and Phase 4. So the rule is stored
// and displayed, and an attempt to BOOK through that channel is refused with the phase named, rather
// than the channel being hidden (which would fail AC-06) or silently accepted (which would invent a
// patient booking nobody made).
export const BOOKING_CHANNELS = [
  {
    code: "practitioner", label: "Practitioner booking",
    definition: "You add an appointment yourself.",
    permission: "May override with reason.",
    door: true, phase: null as string | null,
    capability: "appointment.manage",
    blockedBecause: null as string | null,
  },
  {
    code: "staff", label: "Practice staff booking",
    definition: "An authorised delegate books for a patient.",
    permission: "Role-based override.",
    door: true, phase: null,
    capability: "appointment.manage",
    blockedBecause: null,
  },
  {
    code: "follow_up", label: "Internal follow-up scheduling",
    definition: "A booking started from a follow-up plan.",
    permission: "Eligibility inherited from the plan.",
    door: true, phase: null,
    capability: "appointment.manage",
    blockedBecause: null,
  },
  {
    code: "patient_self", label: "Patient self-booking",
    definition: "A patient uses your booking page.",
    permission: "Subject to published rules.",
    // ⚠ THE DOOR IS OPEN NOW, AND WHAT CHANGED IS THE BUILD RATHER THAN THE DEPLOYMENT.
    //
    // It was `false` while s8's handle, link, intake and publish state did not exist -- there was no way
    // for a patient booking to arrive, so accepting one here would have invented it. All four exist:
    // the handle is claimed in Practice Setup, the profile publishes through migration 254's
    // constraint, and patient-booking.ts carries the intake and the confirmation.
    //
    // ⚠ AN OPEN DOOR IS NOT AN UNLOCKED ONE. `capability` below is NOT granted to patients and never
    // may be -- no patient holds appointment.manage and none appears in practice_role_assignment.
    // bookUnderRules substitutes a DIFFERENT test for this channel alone: proof of an unexpired,
    // unrevoked practice_patient_session whose challenge verified this destination for this practice.
    // The capability stays on the record because a STAFF member booking through the patient page is
    // still staff, and the field is what the rule card displays.
    door: true, phase: "Phase 4",
    capability: "appointment.manage",
    // ⚠ STILL BLOCKED IN THIS DEPLOYMENT, AND NOW FOR ONE REASON RATHER THAN TWO. The code machinery is
    // real and the intake is built; what is missing is anything that can SEND a code. That is a fact
    // about this deployment's configuration, not about the code -- so it is the sentence that changes
    // the day a gateway is configured, and nothing else here has to.
    blockedBecause:
      "It is protected by a one-time code, and this deployment has no SMS gateway and no mail provider configured to send one -- so no patient can complete a booking until one exists. The intake itself is built.",
  },
  {
    code: "referral", label: "Linked facility or referral",
    definition: "An approved external source submits a request.",
    permission: "Usually pending approval.",
    door: false, phase: "Phase 4",
    capability: "appointment.manage",
    blockedBecause:
      "It shares patient booking's intake and its one-time code, and there is nothing configured to send one.",
  },
  {
    code: "walk_in", label: "Walk-in registration",
    definition: "A patient arrives without an appointment.",
    permission: "Operational capacity, cutoff and queue rules.",
    // ⚠ THE DOOR IS OPEN NOW, AND IT WAS SHUT FOR A REASON THAT HAS GONE.
    //
    // It read `door: false, phase: "Phase 5"` because s7.7's session limit, cutoff, queue rules and
    // emergency override did not exist, so a walk-in booked through this engine would have been governed
    // by less than one booked at the desk. All four exist: the per-session limit has been enforced since
    // checkPlacement started reading walkInAllowance, and migration 268/269 add the cutoff, the queue
    // policy and the override.
    //
    // ⚠ THE POINT OF OPENING IT IS THAT WALK-INS WERE ALREADY BEING BOOKED. bookAppointment has taken
    // `appointment_type: 'walk_in'` since Phase 1, so shutting this channel never stopped a walk-in --
    // it only stopped a walk-in being decided by a RULE CARD and stamped with the rule and version that
    // decided it (AC-13). A closed door that the traffic goes round is not a control.
    door: true, phase: null,
    capability: "appointment.manage",
    // Deliberately null: a walk-in is a person standing in the room, so delivery has nothing to do with
    // this channel. Attaching the same sentence to every channel would make it decoration.
    blockedBecause: null,
  },
] as const;

export type BookingChannel = (typeof BOOKING_CHANNELS)[number]["code"];
export const BOOKING_CHANNEL_CODES: string[] = BOOKING_CHANNELS.map(c => c.code);
/** The channels this build can actually take a booking through. The rest are refused, by name. */
export const BOOKING_CHANNELS_WITH_A_DOOR: string[] =
  BOOKING_CHANNELS.filter(c => c.door).map(c => c.code);
export const bookingChannel = (code: string) => BOOKING_CHANNELS.find(c => c.code === code) ?? null;
export const bookingChannelLabel = (code: string) =>
  bookingChannel(code)?.label ?? code.replace(/_/g, " ");

// ── s7.1's STATUS, AND WHAT EACH ONE MEANS TO THE ENGINE ─────────────────────────────────────────────
export const RULE_STATUSES = [
  {
    code: "draft", label: "Draft", decides: false,
    blurb: "Written but not in force. It decides nothing and refuses nothing.",
  },
  {
    code: "active", label: "Active", decides: true,
    blurb: "In force. This is a rule that can refuse a booking today.",
  },
  {
    code: "paused", label: "Paused", decides: false,
    blurb: "Kept, and temporarily out of force. The next rung down decides instead.",
  },
  {
    code: "archived", label: "Archived", decides: false,
    blurb: "Retired. It stays readable because bookings it decided still point at it.",
  },
] as const;

export type RuleStatus = (typeof RULE_STATUSES)[number]["code"];
export const RULE_STATUS_CODES: string[] = RULE_STATUSES.map(s => s.code);
/** The one status the engine evaluates. Everything else is a rule nobody is being refused by. */
export const RULE_STATUSES_IN_FORCE: string[] = RULE_STATUSES.filter(s => s.decides).map(s => s.code);
export const ruleStatus = (code: string) => RULE_STATUSES.find(s => s.code === code) ?? null;

// ── s7.2's "Confirmation": instant, practitioner approval, staff approval or conditional ─────────────
//
// The card model's example in s7.1 is "Instant except new patients", which is what `conditional` is: an
// instant confirmation for somebody the practice has seen before, and a request for somebody it has not.
export const CONFIRMATION_MODES = [
  {
    code: "instant", label: "Confirm immediately",
    blurb: "The appointment is confirmed as soon as it is booked.",
  },
  {
    code: "practitioner_approval", label: "You approve it",
    blurb: "The booking is requested and waits for you.",
  },
  {
    code: "staff_approval", label: "Your staff approve it",
    blurb: "The booking is requested and waits for whoever runs your diary.",
  },
  {
    code: "conditional", label: "Immediate, except for new patients",
    blurb: "Somebody you have seen before is confirmed; somebody new is a request.",
  },
] as const;

export type ConfirmationMode = (typeof CONFIRMATION_MODES)[number]["code"];
export const CONFIRMATION_MODE_CODES: string[] = CONFIRMATION_MODES.map(c => c.code);
export const confirmationMode = (code: string) => CONFIRMATION_MODES.find(c => c.code === code) ?? null;

// ── s7.6's PATIENT ELIGIBILITY ───────────────────────────────────────────────────────────────────────
//
// ⚠ ELIGIBILITY IS A MATCHING CRITERION, NOT A REFUSAL. A rule written for children does not GOVERN an
// adult's booking and then refuse it -- it simply is not that adult's rule, and the next rung down
// decides. Making it a refusal would mean a paediatric clinic rule could stop an adult being booked at a
// practice whose whole-practice rule permits it, which is the opposite of what s11's ladder describes.
//
// The one exception is the follow-up window (s7.5, AC-08): there the rule DOES apply and the window is
// what it says no with, which is why the window is a refusal and eligibility is not.
export const PATIENT_ELIGIBILITY = [
  { code: "any", label: "Any patient", blurb: "No eligibility restriction." },
  { code: "new_only", label: "New patients only", blurb: "Somebody with no appointment history here." },
  { code: "existing_only", label: "Existing patients only", blurb: "Somebody you have seen before." },
  { code: "referred_only", label: "Referred patients only", blurb: "A booking that carries a referral." },
  { code: "paediatric", label: "Children", blurb: "Under 18 on the day of the appointment." },
  { code: "adult", label: "Adults", blurb: "18 or over on the day of the appointment." },
  { code: "active_follow_up", label: "On an active follow-up plan", blurb: "Somebody with a live follow-up." },
] as const;

export type PatientEligibility = (typeof PATIENT_ELIGIBILITY)[number]["code"];
export const PATIENT_ELIGIBILITY_CODES: string[] = PATIENT_ELIGIBILITY.map(e => e.code);
export const patientEligibility = (code: string) => PATIENT_ELIGIBILITY.find(e => e.code === code) ?? null;

/**
 * Eligibility pairs that can NEVER describe the same patient. Used by the conflict test: two rules at
 * equal specificity and equal priority are only a conflict if they could both apply to one booking, and
 * "children only" and "adults only" cannot.
 */
const DISJOINT_ELIGIBILITY: [string, string][] = [
  ["new_only", "existing_only"],
  ["paediatric", "adult"],
];
export const eligibilityCanOverlap = (a: string, b: string) =>
  a === b || !DISJOINT_ELIGIBILITY.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s11 -- THE SPECIFICITY LADDER, AS ARITHMETIC
//
// s11 lists six rungs, most specific first:
//
//   1. Specific dated session exception rule.
//   2. Specific recurring session + appointment type rule.
//   3. Location + appointment type rule.
//   4. Location-wide rule.
//   5. Whole-practice rule.
//   6. Platform-safe default.
//
// Expressed as a SUM OF POWERS OF TWO over the dimensions a rule constrains. Two consequences, both
// wanted:
//
//   1. EVERY SUBSET HAS A UNIQUE SUM. So two rules have equal specificity IF AND ONLY IF they constrain
//      exactly the same dimensions -- which is what makes s11's "at equal specificity, explicit priority
//      determines the winner" a decidable question rather than a judgement.
//   2. THE ORDER IS s11's ORDER, checked: a dated session rule (32+16) outranks session+type (16+4=20),
//      which outranks location+type (8+4=12), which outranks location-wide (8), which outranks
//      whole-practice (0). The sixth rung is the absence of a rule and therefore has no row and no score.
//
// ⚠ A DATED RULE OUTRANKS EVERYTHING, INCLUDING A SESSION RULE THAT IS NOT DATED. That is a reading of
// rung 1 rather than a quotation of it: s11 calls rung 1 a "dated session EXCEPTION rule", and the point
// of an exception is that it wins for its dates. A rule with both effective_from and effective_to set is
// a rule somebody deliberately bounded in time, and honouring it above the standing pattern is the only
// reading under which "for these two weeks, book differently" is expressible at all.
//
// ⚠ CHANNEL AND ELIGIBILITY ARE DIMENSIONS TOO, and s11 does not list them. They are given the two
// SMALLEST weights so that they can never reorder any of s11's own rungs: channel (2) plus eligibility
// (1) is 3, which is less than the smallest listed dimension, appointment type (4). A channel-specific
// rule therefore beats an otherwise identical channel-less one -- which AC-06 requires, since distinct
// rules per channel are useless if the channel does not decide between them -- without ever lifting a
// location rule above a session rule.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const SPECIFICITY_DIMENSIONS = [
  {
    key: "dated", weight: 32, label: "a fixed set of dates",
    describe: "It applies only between two dates.",
  },
  {
    key: "session", weight: 16, label: "one recurring session",
    describe: "It names the session it governs.",
  },
  {
    key: "location", weight: 8, label: "one location",
    describe: "It names the place.",
  },
  {
    key: "appointment_type", weight: 4, label: "one appointment type",
    describe: "It names the kind of appointment.",
  },
  {
    key: "channel", weight: 2, label: "one booking channel",
    describe: "It names who is doing the booking.",
  },
  {
    key: "eligibility", weight: 1, label: "one group of patients",
    describe: "It names which patients it is for.",
  },
] as const;

export type SpecificityDimension = (typeof SPECIFICITY_DIMENSIONS)[number]["key"];

/** The shape the ladder needs. Anything with these fields can be scored -- a stored rule or a draft. */
export type ScopeShape = {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sessionTemplateId: string | null;
  locationId: string | null;
  appointmentType: string | null;
  channel: string | null;
  patientEligibility: string;
  minAgeYears: number | null;
  maxAgeYears: number | null;
};

/** Which dimensions a rule actually constrains. Pure, and the only definition of that question. */
export function scopeDimensions(s: ScopeShape): SpecificityDimension[] {
  const out: SpecificityDimension[] = [];
  // BOTH ENDS. A rule that merely starts on a date is a standing rule with a start; a rule bounded at
  // both ends is the temporary exception rung 1 is about.
  if (s.effectiveFrom !== null && s.effectiveTo !== null) out.push("dated");
  if (s.sessionTemplateId !== null) out.push("session");
  if (s.locationId !== null) out.push("location");
  if (s.appointmentType !== null) out.push("appointment_type");
  if (s.channel !== null) out.push("channel");
  if (s.patientEligibility !== "any" || s.minAgeYears !== null || s.maxAgeYears !== null)
    out.push("eligibility");
  return out;
}

export function specificityOf(s: ScopeShape): number {
  const set = new Set<string>(scopeDimensions(s));
  return SPECIFICITY_DIMENSIONS.reduce((n, d) => n + (set.has(d.key) ? d.weight : 0), 0);
}

/**
 * s11's OWN WORDS FOR THE RUNG A RULE SITS ON. The score decides; this names it, so a refusal can say
 * "your Friday session rule" rather than "specificity 20".
 */
export function specificityRung(s: ScopeShape): string {
  const set = new Set<string>(scopeDimensions(s));
  if (set.has("dated") && set.has("session")) return "Dated session rule";
  if (set.has("dated")) return "Dated rule";
  if (set.has("session") && set.has("appointment_type")) return "Session and appointment type rule";
  if (set.has("session")) return "Session rule";
  if (set.has("location") && set.has("appointment_type")) return "Location and appointment type rule";
  if (set.has("location")) return "Location-wide rule";
  if (set.has("appointment_type")) return "Appointment type rule";
  if (set.size > 0) return "Whole-practice rule, narrowed";
  return "Whole-practice rule";
}

/** The sixth rung. It is not a row, so it has no id, no version and no name. */
export const PLATFORM_DEFAULT_RUNG = "Platform-safe default";

/**
 * WHY THIS RULE, IN THE PRACTITIONER'S WORDS. s11: "Users must be able to see why a rule won."
 */
export function specificityReasons(s: ScopeShape): string[] {
  const set = new Set<string>(scopeDimensions(s));
  const out: string[] = SPECIFICITY_DIMENSIONS.filter(d => set.has(d.key)).map(d => d.describe);
  if (out.length === 0)
    out.push("It applies to your whole practice, so it is the rule that decides when nothing more specific does.");
  return out;
}

/**
 * COULD THESE TWO RULES EVER DECIDE THE SAME BOOKING?
 *
 * ⚠ THE OTHER HALF OF s11's CONFLICT TEST, AND THE HALF THAT KEEPS IT FROM CRYING WOLF. Two rules at
 * equal specificity and equal priority are only a conflict if a booking exists that both could decide.
 * A rule for the Kampala clinic and a rule for the Mulago clinic score identically and can never meet;
 * calling that pair a conflict would block a practitioner from having two locations.
 *
 * Equal specificity means an identical dimension SET (the weights are powers of two), so this reduces to
 * comparing the VALUES dimension by dimension -- and only two dimensions can overlap without being
 * equal: the effective date window, and the eligibility criteria.
 */
export function scopesCanOverlap(a: ScopeShape, b: ScopeShape): boolean {
  if (a.sessionTemplateId !== b.sessionTemplateId) return false;
  if (a.locationId !== b.locationId) return false;
  if (a.appointmentType !== b.appointmentType) return false;
  if (a.channel !== b.channel) return false;
  if (!eligibilityCanOverlap(a.patientEligibility, b.patientEligibility)) return false;
  if (!rangesOverlap(a.minAgeYears, a.maxAgeYears, b.minAgeYears, b.maxAgeYears)) return false;
  if (!datesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) return false;
  return true;
}

const rangesOverlap = (aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null) => {
  const lo = Math.max(aMin ?? 0, bMin ?? 0);
  const hi = Math.min(aMax ?? 130, bMax ?? 130);
  return lo <= hi;
};

const datesOverlap = (aF: string | null, aT: string | null, bF: string | null, bT: string | null) => {
  const lo = (aF ?? "0000-01-01") > (bF ?? "0000-01-01") ? (aF ?? "0000-01-01") : (bF ?? "0000-01-01");
  const hi = (aT ?? "9999-12-31") < (bT ?? "9999-12-31") ? (aT ?? "9999-12-31") : (bT ?? "9999-12-31");
  return lo <= hi;
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s7.2's TWELVE BUILDER SECTIONS
//
// Every one is listed, because the section list is the specification's own statement of what a rule is,
// and a builder that silently omits four of them tells a practitioner their policy is fully expressed
// when it is not. `built` says whether this build stores AND ENFORCES the section; the rest are drawn as
// what they are, with the phase that owns them.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ `alreadyBuilt` EXISTS BECAUSE "NOT BUILT" WAS A LIE ABOUT WALK-INS FOR AS LONG AS IT STOOD.
//
// The walk_ins declaration below said "Phase 5 -- NOT BUILT" while walk_ins_allowed and walk_in_limit
// had been on practice_availability_template since MIGRATION 240, with a live CHECK constraint, and both
// controls sat on the session form on the same screen. Its own sentence was precise -- "no per-session
// walk-in limit ... ON THIS TABLE", meaning the rule table -- and precision that only survives if the
// reader parses a subordinate clause is not honesty. A practitioner read "NOT BUILT" and concluded they
// could not control walk-ins at all, which was false, and they could have concluded it while looking at
// the control.
//
// So `built: false` may no longer stand on its own. Where any part of a section IS real today,
// `alreadyBuilt` names that part and says WHERE it is configured, and the screen prints it beside the
// phase badge rather than under it. Two of the twelve carry one.
//
// This is the sixth claim found in this codebase to have outlived its reason. practice-sessions.ts
// records the pattern in one line: a guard that outlives its reason reads as a decision somebody meant.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
export const BUILDER_SECTIONS = [
  {
    key: "identity", title: "Identity", built: true, phase: null as string | null,
    alreadyBuilt: null as string | null,
    responsibility: "Name, description, status, priority, effective dates",
    note: "All stored. Priority is what settles two rules that are equally specific.",
  },
  {
    key: "scope", title: "Scope", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Location, recurring session, appointment type, booking channel, patient group",
    note: "All five stored, and all five feed s11's ladder.",
  },
  {
    key: "window", title: "Booking window", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Opening horizon, closing notice, same-day and late booking behaviour",
    note: "The horizon and the notice period are enforced. Separate same-day and late-booking behaviours are not a column on this table, so they are not offered.",
  },
  {
    key: "capacity", title: "Capacity", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Total, by appointment type, reserves, walk-ins, urgent additions and overbooking",
    note: "Total, new, follow-up, urgent reserve and overbooking are counted per session and enforced. The walk-in limit is the practice-wide daily one from before the card model.",
  },
  {
    key: "eligibility", title: "Eligibility", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "New/existing, referred, age range, active follow-up plan and approval requirements",
    note: "All stored and used to decide whether the rule is this patient's rule at all.",
  },
  {
    key: "follow_ups", title: "Follow-ups", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Due window, early/overdue booking, reserved capacity and recall behaviour",
    note: "The early and late window is enforced against the follow-up's own due date. The recall queue is Phase 5 and lives in Follow-ups.",
  },
  {
    key: "walk_ins", title: "Walk-ins", built: true, phase: null,
    // ⚠ THIS IS THE SENTENCE THAT WAS MISSING WHILE THIS SECTION SAID "NOT BUILT". See the header.
    alreadyBuilt:
      "Whether a session takes walk-ins at all, and how many, has been configurable since migration 240 "
      + "and is set on the session itself, on the Regular Practice layer of this same screen -- not here. "
      + "That was already true when this section was captioned NOT BUILT, and the caption was read as "
      + "meaning walk-ins could not be controlled at all.",
    responsibility: "Session/day limits, cutoff time, queue and emergency override",
    note: "The daily limit is set here and the per-session limit on the session, and the stricter of the two refuses a walk-in. The cutoff closes walk-ins a set number of minutes before a session ends. The queue policy decides whether the waiting room is first-come or priority-first. An authorised person may lift any of the three with a reason, which is recorded before the walk-in is booked.",
  },
  {
    key: "confirmation", title: "Confirmation", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Instant, practitioner approval, staff approval or conditional",
    note: "Decides whether a booking is created confirmed or as a request.",
  },
  {
    key: "cancellations", title: "Cancellations", built: true, phase: null,
    // ⚠ THE OLD SENTENCE WAS HALF WRONG AND THE HALF THAT WAS WRONG MATTERED.
    //
    // It said the notice period was "never used to refuse a cancellation". It already refused a PATIENT
    // cancellation: manageGate resolves the notice and cancelManagedBooking returns CANCEL_NOT_ALLOWED on
    // it. What was true is that nothing refused an INTERNAL one -- and nothing should, which is the
    // decision recorded in `note` below rather than a gap.
    alreadyBuilt:
      "A patient cancelling their own booking has been refused inside the notice period since the manage "
      + "path was built, and so has a patient reschedule. What is new here is that a PRACTICE-side "
      + "cancellation now records who cancelled, why, and whether it was inside the notice -- and that a "
      + "practice may switch patient self-service off per rule.",
    responsibility: "Cancellation notice, self-reschedule, DNA and waiting-list release",
    note: "The notice period refuses a patient cancelling or moving their own booking, and never refuses the practice: a diary somebody cannot correct is a wrong diary. A separate reschedule notice may be set, and where it is not, the cancellation notice governs a move too. Missed appointments are counted against the rule's own threshold, and the rule says what happens next. Freed time can be offered to a waiting list.",
  },
  {
    key: "required_information", title: "Required information", built: true, phase: null,
    alreadyBuilt:
      "The questions your REGISTRATION form asks are configured in Practice Setup and are unchanged. This "
      + "section is about the booking intake, which is a shorter list on purpose -- s9 permits only what "
      + "is needed to identify the patient and organise the encounter.",
    responsibility: "Booking fields, documents, referral information and patient-reported context",
    note: "Every question the booking intake can ask is listed, and each is off, optional or required under this rule. A required answer that is missing refuses the booking on the server, not merely on the form. A question set to off is not asked, and an answer that arrives for it anyway is discarded rather than stored. Documents are the one item with nowhere to go -- there is no document service on the patient path, so none is offered.",
  },
  {
    key: "notifications", title: "Notifications", built: false, phase: "Phase 6",
    alreadyBuilt: null,
    responsibility: "Trigger selection; templates and delivery remain in Notifications configuration",
    note: "Nothing in this product sends a message to a patient. Offering triggers here would promise a notification nobody would receive.",
  },
  {
    key: "overrides", title: "Overrides", built: true, phase: null,
    alreadyBuilt: null,
    responsibility: "Who may override, reason requirement and audit behaviour",
    note: "An override needs the settings permission and a reason, lifts only capacity and window refusals, and is written to the audit trail before the booking is made.",
  },
] as const;

export const BUILDER_SECTIONS_BUILT: string[] = BUILDER_SECTIONS.filter(s => s.built).map(s => s.key);

/** The sections that are not built, and the ones that are built but were once said not to be. */
export const BUILDER_SECTIONS_WITH_A_CORRECTION: string[] =
  BUILDER_SECTIONS.filter(s => s.alreadyBuilt !== null).map(s => s.key);

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s7.2's "REQUIRED INFORMATION" -- WHAT A BOOKING INTAKE MAY ASK, AND WHAT A RULE MAY INSIST ON.
//
// ---- ⚠ THIS IS NOT A SECOND FORMS RUNTIME, AND THE SHAPE BELOW IS THE PROOF ------------------------
//
// This codebase has been bitten twice by a second forms runtime, and Knowledge Studio's Phase 3 settled
// what "extend rather than duplicate" means here: ONE condition evaluator (registration-condition.ts),
// ONE validator (form-field.ts's validateAnswer) and ONE renderer (FormFieldInput.tsx) for all eleven
// field types. Every entry below therefore satisfies BOTH `RegistrationFieldLike` and `FormFieldLike`,
// which is asserted rather than asserted-in-a-comment: the two `satisfies` clauses on
// BOOKING_INTAKE_FIELDS fail the build if a field stops being renderable by the one renderer.
//
// ⚠ AND THE CATALOGUE IS CLOSED, WHICH THE REGISTRATION FORM'S IS NOT. A practice authors its own
// registration questions because a registration record has a jsonb column for them. A booking intake
// answer has to land in a NAMED COLUMN on practice_booking_request -- migration 254 chose named columns
// so that `stated_diagnosis` could not be lifted into a clinical field without somebody renaming it --
// so the questions a booking may ask are exactly the columns that exist, and no more. `column` below is
// that column, and it is what makes an authored question impossible to invent here.
//
// ---- THE FOUR THINGS s7.2's `responsibility` NAMES, AND WHERE EACH ONE IS -------------------------
//
//   Booking fields             the identity and contact rows below.
//   Referral information       `referral_source`.
//   Patient-reported context   the three `stated_` rows. s9: "clearly labelled", and the prefix is the
//                              label, in the column name, where a screen cannot drop it.
//   Documents                  ⚠ ABSENT, AND LISTED AS ABSENT rather than silently omitted. See
//                              INTAKE_NOT_CONFIGURABLE.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ FOUR STATES, AND THE FOURTH IS THE ABSENCE OF A ROW.
 *
 * A rule that has never been configured has an EMPTY map, and an empty map must mean exactly what this
 * product did before this section existed: every question is accepted if it is given and demanded of
 * nobody. That is `optional`. If absence had meant `off`, applying this build would have silently
 * stopped storing the date of birth of every patient booking at every practice on the platform.
 */
export const REQUIREMENT_LEVELS = [
  {
    code: "off", label: "Do not ask",
    blurb: "The question is not put, and an answer that arrives for it anyway is thrown away rather than stored.",
  },
  {
    code: "optional", label: "Ask, but allow a blank",
    blurb: "Asked. A booking is not refused for leaving it empty. This is what happens if you set nothing.",
  },
  {
    code: "required", label: "Must be answered",
    blurb: "A booking with this left blank is refused, on the server, whatever the form allowed.",
  },
] as const;

export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number]["code"];
export const REQUIREMENT_LEVEL_CODES: string[] = REQUIREMENT_LEVELS.map(l => l.code);
/** ⚠ The level a field has when the rule says nothing about it. See REQUIREMENT_LEVELS' header. */
export const REQUIREMENT_LEVEL_WHEN_UNSET: RequirementLevel = "optional";

/** The relationship vocabulary is migration 221's, quoted from migration 254's own CHECK. */
const REPRESENTATIVE_RELATIONSHIPS = [
  "guardian", "mother", "father", "spouse", "partner", "sibling", "child", "grandparent",
  "emergency_contact", "interpreter", "employer", "insurance_contact", "carer", "social_worker", "other",
];

export type BookingIntakeField = {
  field_key: string;
  label: string;
  help: string;
  field_type: string;
  /** The column on practice_booking_request this answer lands in. There is no field without one. */
  column: string;
  /**
   * ⚠ TRUE FOR THE TWO A BOOKING CANNOT EXIST WITHOUT. A booking with no name is not a booking anybody
   * can call, so these two are `required` whatever the rule says and the screen draws them as fixed
   * rather than as a control that ignores you.
   */
  alwaysRequired: boolean;
  /** Which of s7.2's four responsibilities this row belongs to, so the screen can group them. */
  group: "identity" | "contact" | "context" | "stated";
  options?: { value: string; label: string }[];
  rules?: Record<string, unknown>;
};

export const BOOKING_INTAKE_FIELDS: BookingIntakeField[] = [
  {
    field_key: "given_name", label: "First name", field_type: "text", column: "given_name",
    help: "Asked of everybody. A booking nobody can call by name is one nobody can call.",
    alwaysRequired: true, group: "identity", rules: { minLength: 1, maxLength: 80 },
  },
  {
    field_key: "family_name", label: "Family name", field_type: "text", column: "family_name",
    help: "Asked of everybody, for the same reason.",
    alwaysRequired: true, group: "identity", rules: { minLength: 1, maxLength: 80 },
  },
  {
    field_key: "birth_date", label: "Date of birth", field_type: "date", column: "birth_date",
    help: "What your age-scoped rules are decided on. A rule written for children cannot apply to somebody whose date of birth you never asked for.",
    alwaysRequired: false, group: "identity",
  },
  {
    field_key: "age_years", label: "Age in years", field_type: "number", column: "age_years",
    help: "For the patient who knows their age and not their date of birth. Both may be asked; neither is inferred from the other.",
    alwaysRequired: false, group: "identity", rules: { min: 0, max: 130 },
  },
  {
    field_key: "sex", label: "Sex", field_type: "select", column: "sex",
    help: "Migration 254's own list. 'Unspecified' is what is stored when nobody answers.",
    alwaysRequired: false, group: "identity",
    options: [
      { value: "female", label: "Female" }, { value: "male", label: "Male" },
      { value: "other", label: "Other" }, { value: "unknown", label: "Unknown" },
      { value: "unspecified", label: "Prefer not to say" },
    ],
  },
  {
    field_key: "contact_phone", label: "Phone number", field_type: "phone", column: "contact_phone",
    help: "Nothing rings it. This is the number the practice would use.",
    alwaysRequired: false, group: "contact", rules: { minLength: 3, maxLength: 40 },
  },
  {
    field_key: "contact_email", label: "Email address", field_type: "email", column: "contact_email",
    help: "Nothing sends to it. This is the address the practice would use.",
    alwaysRequired: false, group: "contact", rules: { minLength: 3, maxLength: 160 },
  },
  {
    field_key: "representative_name", label: "Parent, guardian or representative",
    field_type: "text", column: "representative_name",
    help: "s7.6's paediatric path. Set this to required with the condition below and a child's booking asks for a guardian while an adult's does not.",
    alwaysRequired: false, group: "contact", rules: { minLength: 2, maxLength: 160 },
  },
  {
    field_key: "representative_relationship", label: "Their relationship to the patient",
    field_type: "select", column: "representative_relationship",
    help: "Migration 221's vocabulary, not a second list -- three spellings of 'mother' is how a report starts disagreeing with itself.",
    alwaysRequired: false, group: "contact",
    options: REPRESENTATIVE_RELATIONSHIPS.map(v => ({ value: v, label: v.replace(/_/g, " ") })),
  },
  {
    field_key: "representative_phone", label: "Their phone number",
    field_type: "phone", column: "representative_phone",
    help: "Nothing rings this either.", alwaysRequired: false, group: "contact",
    rules: { minLength: 3, maxLength: 40 },
  },
  {
    field_key: "reason_for_visit", label: "Reason for the visit",
    field_type: "long_text", column: "reason_for_visit",
    help: "What the patient says they are coming about. It reaches the diary entry.",
    alwaysRequired: false, group: "context", rules: { maxLength: 1000 },
  },
  {
    field_key: "referral_source", label: "Who referred them",
    field_type: "text", column: "referral_source",
    help: "s7.2's referral information. ⚠ It is NOT what makes a rule for referred patients match -- that is a property of the booking, not a sentence somebody typed.",
    alwaysRequired: false, group: "context", rules: { maxLength: 200 },
  },
  {
    field_key: "stated_diagnosis", label: "Diagnosis, as the patient states it",
    field_type: "long_text", column: "stated_diagnosis",
    help: "⚠ NOT A DIAGNOSIS. A patient saying they have diabetes is a patient saying so. The column is called stated_diagnosis so nothing can be copied into a clinical field without somebody typing a different name.",
    alwaysRequired: false, group: "stated", rules: { maxLength: 1000 },
  },
  {
    field_key: "stated_treatment", label: "Current treatment, as the patient states it",
    field_type: "long_text", column: "stated_treatment",
    help: "⚠ NOT A MEDICATION LIST, and it must never be read as one.",
    alwaysRequired: false, group: "stated", rules: { maxLength: 1000 },
  },
  {
    field_key: "stated_hospital_number", label: "Hospital or clinic number they quote",
    field_type: "text", column: "stated_hospital_number",
    help: "⚠ A claim, never an identifier of record. The authoritative number lives on the patient record.",
    alwaysRequired: false, group: "stated", rules: { maxLength: 60 },
  },
  {
    field_key: "consent_communication", label: "Agreement to be contacted",
    field_type: "boolean", column: "consent_communication",
    help: "⚠ Recording an agreement is not a channel. Nothing in this product sends a patient a message, so a yes here changes what is stored and nothing else.",
    alwaysRequired: false, group: "context",
  },
];

// ⚠ THE BUILD FAILS IF ONE OF THESE STOPS BEING A FIELD THE ONE RENDERER AND THE ONE EVALUATOR CAN TAKE.
// This is the whole of "reuse the model rather than write a second one", expressed where a comment
// cannot rot: FormFieldLike is what FormFieldInput.tsx and validateAnswer accept, RegistrationFieldLike
// is what resolveApplicable accepts, and a field that satisfies neither cannot be drawn or checked by
// anything this product already has.
const _intakeFieldsAreRenderable: FormFieldLike[] = BOOKING_INTAKE_FIELDS;
const _intakeFieldsAreEvaluable: RegistrationFieldLike[] = BOOKING_INTAKE_FIELDS;
void _intakeFieldsAreRenderable;
void _intakeFieldsAreEvaluable;

export const BOOKING_INTAKE_FIELD_KEYS: string[] = BOOKING_INTAKE_FIELDS.map(f => f.field_key);
export const intakeField = (key: string) =>
  BOOKING_INTAKE_FIELDS.find(f => f.field_key === key) ?? null;
export const INTAKE_FIELDS_ALWAYS_REQUIRED: string[] =
  BOOKING_INTAKE_FIELDS.filter(f => f.alwaysRequired).map(f => f.field_key);

/**
 * ⚠ WHAT s7.2 ASKS FOR THAT NOTHING HERE CAN STORE, LISTED RATHER THAN QUIETLY DROPPED.
 *
 * The same shape WALK_IN_NOT_CONFIGURABLE uses, for the same reason: a section that offers eleven of the
 * twelve things it names, and says nothing about the twelfth, reads as complete.
 */
export const INTAKE_NOT_CONFIGURABLE = [
  {
    what: "A referral letter, scan or other supporting document",
    whyNot:
      "There is no document service on the patient path and migration 254 deliberately left the column "
      + "out rather than leave a nullable document id sitting as evidence of a feature. Nothing can "
      + "receive an upload from a stranger, so a control asking for one would take a file nowhere.",
    wouldNeed: "A document service reachable without an account, and a column on practice_booking_request pointing at it.",
  },
  {
    what: "Agreement to the practice keeping these answers",
    whyNot:
      "It is not per-rule. Whether consent is required, and the words it is asked in, belong to the "
      + "booking PAGE (practice_booking_access.consent_required and consent_text) because they are the "
      + "same for every rule that page's bookings pass through. It is configured in Patient Access.",
    wouldNeed: "Nothing. It is built, in the right place, and is listed here so nobody looks for it twice.",
  },
] as const;

/**
 * ⚠ THE ONE DERIVED FACT THE CONDITIONS MAY TURN ON, AND WHY IT IS DERIVED HERE RATHER THAN ASKED FOR.
 *
 * `conditionMet` compares values in a map. The condition a practice actually wants -- "ask for a guardian
 * when the patient is a child" -- is not a value anybody types, so it is COMPUTED from the answers and
 * added to the map before the evaluator runs. It is prefixed so it cannot collide with a field key, and
 * it is the only one: every further derived fact is another thing that can disagree with the record.
 */
export const INTAKE_DERIVED_KEYS = ["_is_child"] as const;

/** Under 18 on the day of the appointment -- the same test PATIENT_ELIGIBILITY's `paediatric` uses. */
export function intakeDerivedValues(
  answers: Record<string, unknown>, onDate: string,
): Record<string, unknown> {
  const dob = typeof answers.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(answers.birth_date)
    ? answers.birth_date : null;
  const stated = answers.age_years === undefined || answers.age_years === null || answers.age_years === ""
    ? null : Number(answers.age_years);
  let age: number | null = null;
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
    const [by, bm, bd] = dob.split("-").map(Number);
    const [ay, am, ad] = onDate.split("-").map(Number);
    age = ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
  } else if (stated !== null && Number.isFinite(stated)) {
    age = stated;
  }
  // ⚠ NULL WHEN NOTHING WAS ASKED, NOT FALSE. `_is_child: false` for somebody whose age nobody knows
  // would silently switch off a guardian question that a practice wrote for exactly that person.
  return age === null ? {} : { _is_child: age < 18 };
}

/** What a rule stores. Deliberately a small closed shape -- see requiredInformationShape below. */
export type IntakeRequirement = { level: RequirementLevel; condition?: unknown };
export type RequiredInformation = { fields: Record<string, IntakeRequirement> };

export const EMPTY_REQUIRED_INFORMATION: RequiredInformation = { fields: {} };

/**
 * Read the stored jsonb into the shape the engine uses, TOLERANTLY AND WITHOUT INVENTING ANYTHING.
 *
 * ⚠ AN UNRECOGNISED LEVEL IS `optional`, NOT `required`. The other direction would let a typo in a jsonb
 * column start refusing patients at a practice that never asked for it. `off` and `required` are both
 * acts; falling back to the one that does nothing is the only safe fallback there is.
 */
export function requiredInformationOf(raw: unknown): RequiredInformation {
  const out: Record<string, IntakeRequirement> = {};
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fields = root.fields && typeof root.fields === "object" && !Array.isArray(root.fields)
    ? (root.fields as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(fields)) {
    if (!BOOKING_INTAKE_FIELD_KEYS.includes(key)) continue;
    if (typeof value === "string") {
      if (REQUIREMENT_LEVEL_CODES.includes(value)) out[key] = { level: value as RequirementLevel };
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const level = typeof v.level === "string" && REQUIREMENT_LEVEL_CODES.includes(v.level)
      ? (v.level as RequirementLevel) : REQUIREMENT_LEVEL_WHEN_UNSET;
    out[key] = v.condition === undefined || v.condition === null
      ? { level } : { level, condition: v.condition };
  }
  return { fields: out };
}

/** The level in force for one field under one rule, with the always-required two settled first. */
export function levelFor(req: RequiredInformation, fieldKey: string): RequirementLevel {
  if (INTAKE_FIELDS_ALWAYS_REQUIRED.includes(fieldKey)) return "required";
  return req.fields[fieldKey]?.level ?? REQUIREMENT_LEVEL_WHEN_UNSET;
}

export type IntakeResolution = {
  /** What is put to the patient, in catalogue order. */
  asked: { field: BookingIntakeField; level: RequirementLevel }[];
  /** Set to `off`, or withdrawn by a condition. Their answers are thrown away -- see `discarded`. */
  notAsked: { field: BookingIntakeField; why: "off" | "condition" }[];
  /** Required and blank. Each one refuses the booking. */
  missing: { field: BookingIntakeField }[];
  /** Answers that arrived for a question this rule does not ask. Reported, never stored. */
  discarded: BookingIntakeField[];
  /** The answers as they should be WRITTEN -- the discarded ones removed. */
  values: Record<string, unknown>;
};

const blank = (v: unknown) =>
  v === undefined || v === null
  || (typeof v === "string" && v.trim() === "")
  || (Array.isArray(v) && v.length === 0);

/**
 * WHICH QUESTIONS THIS RULE ASKS, WHICH ARE MISSING, AND WHAT MUST NOT BE STORED.
 *
 * ⚠ PURE, AND IN THIS FILE, SO THE FORM AND THE SERVER CANNOT DISAGREE. The identical failure this
 * codebase already has a scar from: a form that permits what the server refuses is a form somebody fills
 * in twice, and a form that refuses what the server permits is a booking nobody can make.
 *
 * ⚠ `conditionMet` IS THE ONE FROM registration-condition.ts, imported. Not a copy, not a variant. A
 * second evaluator would drift, and the one that mattered would be the server's -- silently.
 */
export function resolveIntake(
  req: RequiredInformation, answers: Record<string, unknown>, onDate: string,
): IntakeResolution {
  const values: Record<string, unknown> = { ...answers };
  const derived = intakeDerivedValues(answers, onDate);
  const forConditions = { ...values, ...derived };

  const asked: IntakeResolution["asked"] = [];
  const notAsked: IntakeResolution["notAsked"] = [];
  const missing: IntakeResolution["missing"] = [];
  const discarded: BookingIntakeField[] = [];

  for (const field of BOOKING_INTAKE_FIELDS) {
    const level = levelFor(req, field.field_key);
    const condition = field.alwaysRequired ? undefined : req.fields[field.field_key]?.condition;
    // ⚠ A CONDITION ON A FACT NOBODY KNOWS MEANS THE QUESTION IS ASKED.
    //
    // conditionMet compares values, and an absent value is not equal to `true` -- so a rule reading
    // "ask for a guardian when the patient is a child" would WITHDRAW the guardian question for anybody
    // whose age was never asked for. That is precisely backwards: the person a practice cannot rule out
    // as a child is the person it most needs a guardian for.
    //
    // ⚠ AND conditionMet IS NOT CHANGED TO FIX IT. Its behaviour is right for the registration form,
    // where every `when` names a field on the same form and an absent value means an unanswered
    // question. The gap is only for the DERIVED keys, which have a third state -- computed true,
    // computed false, and could not be computed -- so the third state is handled here, over the one
    // list of derived keys, and the shared evaluator is untouched.
    const dependsOnUnknown = condition !== undefined && condition !== null
      && typeof condition === "object"
      && typeof (condition as Record<string, unknown>).when === "string"
      && (INTAKE_DERIVED_KEYS as readonly string[]).includes(String((condition as Record<string, unknown>).when))
      && !(String((condition as Record<string, unknown>).when) in derived);
    const applies = level !== "off" && (dependsOnUnknown || conditionMet(condition, forConditions));

    if (!applies) {
      notAsked.push({ field, why: level === "off" ? "off" : "condition" });
      // ⚠ THE ANSWER GOES, AND IT IS REPORTED GOING. registration-condition.ts's own header carries the
      // argument at length: storing an answer to a question that was withdrawn is a record that says
      // something nobody was asked, and it is worse than losing it.
      if (!blank(values[field.field_key])) discarded.push(field);
      delete values[field.field_key];
      continue;
    }
    asked.push({ field, level });
    if (level === "required" && blank(values[field.field_key])) missing.push({ field });
  }

  return { asked, notAsked, missing, discarded, values };
}

/** The sentence a refusal is given in. One place, so the refusal and the screen say the same thing. */
export function intakeRefusalMessage(missing: { field: BookingIntakeField }[]): string {
  const names = missing.map(m => m.field.label);
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `this practice asks for ${list} on every booking of this kind, and ${names.length === 1 ? "it was" : "they were"} left blank.`;
}

/** The sentence a confirmation says when answers were thrown away. Null when none were. */
export function intakeDiscardNotice(discarded: BookingIntakeField[]): string | null {
  if (discarded.length === 0) return null;
  const names = discarded.map(d => d.label);
  const list = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is not a question" : "are not questions"} this booking asks, so what was sent for ${names.length === 1 ? "it was" : "them was"} not stored.`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s7.7's WALK-IN QUEUE, AND s7.4's EMERGENCY OVERRIDE
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ THE CUTOFF ARITHMETIC, IN ONE FUNCTION, BECAUSE IT HAS THREE CALLERS AND ONE OF THEM IS A TEST.
 *
 * checkPlacement enforces it, evaluateBooking previews it, and the harness asserts it. Written out at
 * each of those three it would be three chances to get the boundary wrong -- and the harness's copy
 * would then assert its own arithmetic rather than the engine's, which is an assertion that can never
 * fail for the reason it was written.
 *
 * `minutesLeft` is how long is left before the cutoff bites. NULL when nothing applies: no cutoff set,
 * or no session governing the time -- a cutoff is a distance back from a session's END, so a time no
 * session covers has nothing to measure from and refusing there would invent a rule nobody wrote.
 *
 * The boundary is CLOSED: a walk-in exactly at the cutoff minute is refused. "No walk-ins in the last
 * 60 minutes" means the 60th-from-last minute is already inside it.
 */
export function walkInCutoff(args: {
  cutoffMinutes: number | null;
  sessionEndsMinute: number | null;
  minuteOfDay: number;
}): { applies: boolean; minutesLeft: number | null; bites: boolean; lastWalkInMinute: number | null } {
  if (args.cutoffMinutes === null || args.sessionEndsMinute === null)
    return { applies: false, minutesLeft: null, bites: false, lastWalkInMinute: null };
  const lastWalkInMinute = args.sessionEndsMinute - args.cutoffMinutes;
  const minutesLeft = lastWalkInMinute - args.minuteOfDay;
  return { applies: true, minutesLeft, bites: minutesLeft <= 0, lastWalkInMinute };
}

export const WALK_IN_QUEUE_POLICIES = [
  {
    code: "first_come", label: "First come, first seen",
    blurb: "The waiting room is ordered by the time somebody arrived, and nothing else. This is what happened before the setting existed.",
  },
  {
    code: "priority_then_first_come", label: "Priority first, then arrival time",
    blurb: "Somebody marked more urgent is seen before somebody who arrived earlier. Two people at the same priority are still ordered by arrival.",
  },
] as const;

export type WalkInQueuePolicy = (typeof WALK_IN_QUEUE_POLICIES)[number]["code"];
export const WALK_IN_QUEUE_POLICY_CODES: string[] = WALK_IN_QUEUE_POLICIES.map(p => p.code);

/**
 * ⚠ FOUR BANDS, AND THE NUMBER IS THE ORDER. Stored as an integer on practice_queue_entry so that
 * ordering is a sort and not a lookup, and capped at 3 by the column's own CHECK.
 *
 * ⚠ A BAND IS NOT A TRIAGE SCORE. Nothing clinical is computed here and nothing reads a vital sign;
 * this is the desk's judgement, recorded with a reason, and the label says so.
 */
export const QUEUE_PRIORITIES = [
  { value: 0, code: "routine", label: "Routine", blurb: "The ordinary case. Arrival time decides." },
  { value: 1, code: "elevated", label: "Bring forward", blurb: "Seen ahead of routine arrivals." },
  { value: 2, code: "urgent", label: "Urgent", blurb: "Seen ahead of everything but an emergency." },
  { value: 3, code: "emergency", label: "Emergency", blurb: "First. Recorded with a reason, always." },
] as const;

export const QUEUE_PRIORITY_VALUES: number[] = QUEUE_PRIORITIES.map(p => p.value);
export const queuePriority = (v: number) => QUEUE_PRIORITIES.find(p => p.value === v) ?? null;
/** ⚠ Above this, a reason is not optional. A queue jump nobody explained cannot be answered for. */
export const QUEUE_PRIORITY_NEEDING_A_REASON = 1;

/**
 * ⚠ THE WALK-IN REFUSALS AN AUTHORISED PERSON MAY LIFT, AND THE COMPLETE LIST OF THEM.
 *
 * WALK_IN_NOT_CONFIGURABLE said an emergency override "would need the same shape s14's window override
 * already uses, extended to the WALK_IN_LIMIT code". This is that list, and it is a list rather than a
 * boolean so that checkPlacement can be told exactly which refusals were lifted and no others -- the
 * same discipline `windowOverridden` keeps, and for the same reason: an override of a walk-in limit must
 * never become an override of a double-booking.
 */
export const WALK_IN_OVERRIDABLE_CODES = ["WALK_IN_LIMIT", "SESSION_WALK_IN_LIMIT", "WALK_IN_CUTOFF"] as const;

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s7.2's "CANCELLATIONS" -- MISSED APPOINTMENTS, AND WHAT A PRACTICE DOES ABOUT THEM
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const DNA_ACTIONS = [
  {
    code: "none", label: "Nothing automatic", decides: false,
    blurb: "Missed appointments are still counted and still shown. Nothing about a future booking changes.",
  },
  {
    code: "require_approval", label: "Their next booking waits for you", decides: true,
    blurb: "A patient over the threshold can still book, and the booking is created as a request rather than confirmed.",
  },
  {
    code: "block_self_booking", label: "They must ring the practice", decides: true,
    blurb: "A patient over the threshold cannot book themselves. You and your staff still can -- this refuses the patient's own booking, not the patient.",
  },
] as const;

export type DnaAction = (typeof DNA_ACTIONS)[number]["code"];
export const DNA_ACTION_CODES: string[] = DNA_ACTIONS.map(a => a.code);

export const WAITING_LIST_STATUSES = [
  { code: "waiting", label: "Waiting", live: true, blurb: "On the list, not yet offered anything." },
  { code: "offered", label: "Offered a time", live: true, blurb: "A freed time was put to them. Nothing has told them -- see below." },
  { code: "booked", label: "Booked", live: false, blurb: "They took a time and it is in the diary." },
  { code: "withdrawn", label: "Withdrawn", live: false, blurb: "Taken off the list." },
  { code: "expired", label: "Out of date", live: false, blurb: "The window they could be seen in has passed." },
] as const;

export const WAITING_LIST_STATUS_CODES: string[] = WAITING_LIST_STATUSES.map(s => s.code);
export const WAITING_LIST_STATUSES_LIVE: string[] =
  WAITING_LIST_STATUSES.filter(s => s.live).map(s => s.code);

/**
 * ⚠ THE SENTENCE THE WAITING LIST MUST CARRY WHEREVER IT IS DRAWN, AND WHY IT IS A CONSTANT.
 *
 * A waiting list whose whole point is "we will let you know" is the one feature in this section that can
 * be believed into existence. Nothing in this product sends a message to a patient -- so an offer is a
 * row somebody has to act on by telephone, and the screen says that where the offer is made rather than
 * in a footnote. Exported so the screen, the engine and the harness quote one sentence.
 */
export const WAITING_LIST_CONTACT_NOTE =
  "Offering a time records the offer. It does not tell the patient: nothing in this product sends a "
  + "message, so somebody has to ring them. The offer sits here until you say what came of it.";

/**
 * ⚠ A SETTING WHOSE SCREEN DOES NOT EXIST YET SAYS SO, WHERE THE SWITCH IS.
 *
 * The waiting list and the queue priority are STORED, ENFORCED and reachable over the API this build
 * adds. What is NOT built is the day-to-day surface: there is no board for putting somebody on the list
 * and no control in the waiting room for moving somebody up. Switching either on therefore changes what
 * is permitted and gives a practitioner nothing to press.
 *
 * A switch that quietly does nothing visible is the failure this whole change is correcting, so the
 * sentence is a constant beside the switch rather than a line in a release note -- and it is the one
 * sentence that has to change the day the screens are built, in one place.
 */
export const WAITING_LIST_NO_SCREEN_NOTE =
  "There is no waiting-list board yet. Turning this on records the choice and lets the practice's own "
  + "systems use it; adding somebody to the list is not something this screen can do today.";

export const QUEUE_PRIORITY_NO_SCREEN_NOTE =
  "There is no control in the waiting room for moving somebody up yet. Choosing this permits a priority "
  + "to be set and records that you want one; the waiting room still shows everybody in arrival order "
  + "because nothing has set one.";

// ── PLAIN LANGUAGE (s15: "Avoid technical terms such as cron, recurrence rule or policy expression") ──

/** s15's own example sentence: "Patients may book from 60 days before until 2 hours before". */
export function plainWindow(horizonDays: number | null, leadMinutes: number): string {
  const opens = horizonDays === null
    ? "Bookings may be made at any distance ahead"
    : `Bookings open ${horizonDays} day${horizonDays === 1 ? "" : "s"} ahead`;
  if (leadMinutes <= 0) return `${opens} and close when the appointment starts.`;
  if (leadMinutes % 1440 === 0) {
    const d = leadMinutes / 1440;
    return `${opens} and close ${d} day${d === 1 ? "" : "s"} before it.`;
  }
  if (leadMinutes % 60 === 0) {
    const h = leadMinutes / 60;
    return `${opens} and close ${h} hour${h === 1 ? "" : "s"} before it.`;
  }
  return `${opens} and close ${leadMinutes} minutes before it.`;
}

/** s7.1's capacity line: "5 new · 10 follow-up · 2 walk-ins · 1 urgent reserve". */
export function plainCapacity(c: {
  total: number | null; newPatients: number | null; followUp: number | null;
  urgentReserve: number | null; overbooking: number; walkInDailyLimit: number | null;
}): string {
  const parts: string[] = [];
  if (c.total !== null) parts.push(`${c.total} a session`);
  if (c.newPatients !== null) parts.push(`${c.newPatients} new`);
  if (c.followUp !== null) parts.push(`${c.followUp} follow-up`);
  if (c.urgentReserve !== null && c.urgentReserve > 0) parts.push(`${c.urgentReserve} held for urgent`);
  if (c.overbooking > 0) parts.push(`${c.overbooking} over`);
  if (c.walkInDailyLimit !== null) parts.push(`${c.walkInDailyLimit} walk-ins a day`);
  return parts.length === 0 ? "No capacity limit of its own." : parts.join(" · ");
}

/** s7.7's walk-in line on the card. ⚠ The per-session limit is NOT here -- it is on the session. */
export function plainWalkIn(w: {
  dailyLimit: number | null; cutoffMinutes: number | null; queuePolicy: string;
}): string {
  const parts: string[] = [];
  parts.push(w.dailyLimit === null
    ? "No daily walk-in limit of its own"
    : `${w.dailyLimit} walk-in${w.dailyLimit === 1 ? "" : "s"} a day`);
  if (w.cutoffMinutes !== null)
    parts.push(w.cutoffMinutes % 60 === 0
      ? `none in the last ${w.cutoffMinutes / 60} hour${w.cutoffMinutes === 60 ? "" : "s"} of a session`
      : `none in the last ${w.cutoffMinutes} minutes of a session`);
  parts.push(w.queuePolicy === "priority_then_first_come"
    ? "the waiting room is ordered by priority, then arrival"
    : "the waiting room is first come, first seen");
  return `${parts.join(" · ")}.`;
}

/** s7.2's cancellation line. Every clause is a stored value, and none of it is a promise to tell anybody. */
export function plainCancellation(c: {
  noticeMinutes: number; rescheduleNoticeMinutes: number | null;
  selfCancelAllowed: boolean; selfRescheduleAllowed: boolean;
  dnaThreshold: number | null; dnaAction: string; waitingListEnabled: boolean;
}): string {
  // ⚠ THE PLURAL IS TAKEN FROM THE NUMBER OF UNITS, NOT FROM THE NUMBER OF MINUTES. It read
  // `m === 1440 ? "" : "s"`, which printed "1 day' notice" for a day and "2 days' notice" for two --
  // and a harness assertion on the exact sentence is what found it. A possessive apostrophe on a
  // singular goes before the s, which is why the two cases are written out rather than patched.
  const period = (m: number) => {
    if (m === 0) return "no notice";
    if (m % 1440 === 0) { const d = m / 1440; return d === 1 ? "1 day's notice" : `${d} days' notice`; }
    if (m % 60 === 0) { const h = m / 60; return h === 1 ? "1 hour's notice" : `${h} hours' notice`; }
    return m === 1 ? "1 minute's notice" : `${m} minutes' notice`;
  };

  const parts: string[] = [];
  if (!c.selfCancelAllowed && !c.selfRescheduleAllowed) {
    parts.push("Patients cannot cancel or move their own booking");
  } else {
    const both = c.rescheduleNoticeMinutes === null;
    if (c.selfCancelAllowed)
      parts.push(c.noticeMinutes === 0
        ? "Patients may cancel their own booking at any time"
        : `Patients may cancel their own booking up to ${period(c.noticeMinutes)} before it`);
    else parts.push("Patients cannot cancel their own booking");

    if (c.selfRescheduleAllowed)
      parts.push(both
        ? "and moving one follows the same notice"
        : `and may move one up to ${period(c.rescheduleNoticeMinutes ?? 0)} before it`);
    else parts.push("and cannot move one");
  }
  // ⚠ ALWAYS SAID, because a practitioner reading a notice period will otherwise assume it applies to
  // them as well, and go looking for how to switch it off.
  parts.push("You are never refused by any of this");
  if (c.dnaThreshold !== null && c.dnaAction !== "none")
    parts.push(c.dnaAction === "block_self_booking"
      ? `after ${c.dnaThreshold} missed appointment${c.dnaThreshold === 1 ? "" : "s"} they must ring you`
      : `after ${c.dnaThreshold} missed appointment${c.dnaThreshold === 1 ? "" : "s"} their next booking waits for you`);
  if (c.waitingListEnabled) parts.push("freed time can be offered to your waiting list");
  return `${parts.join(" · ")}.`;
}

/** s7.2's required-information line. Names the questions rather than counting them. */
export function plainRequiredInformation(req: RequiredInformation): string {
  const insisted = BOOKING_INTAKE_FIELDS
    .filter(f => !f.alwaysRequired && levelFor(req, f.field_key) === "required").map(f => f.label);
  const off = BOOKING_INTAKE_FIELDS
    .filter(f => levelFor(req, f.field_key) === "off").map(f => f.label);
  // ⚠ NAMED, NEVER COUNTED. "3 questions required" tells a practitioner to open the rule to find out
  // which three, which is the defect the card model exists to remove.
  const list = insisted.length === 0 ? null
    : insisted.length === 1 ? insisted[0]
      : `${insisted.slice(0, -1).join(", ")} and ${insisted[insisted.length - 1]}`;
  const parts: string[] = [];
  parts.push(list === null ? "A name, and nothing else is insisted on" : `A name, ${list}`);
  if (off.length > 0) parts.push(`${off.length} question${off.length === 1 ? "" : "s"} not asked at all`);
  return `${parts.join(" · ")}.`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR.
//
// ⚠ REQUESTED FOR palette.ts BY NAME AND NOT WRITTEN THERE, for the reason the two sibling constants
// files record: palette.ts is owned elsewhere, and two agents writing one module is how a palette ends
// up with two answers for amber. Every hue below is one palette.ts already uses for the same meaning;
// nothing new is invented. Written to palette.ts's own contract -- the exported CardSwatch type, and its
// rule that a card gets three things: a tinted box, a tinted icon badge, AND THE FIGURE IN THE CARD'S
// OWN HUE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Layer 3's summary figures.
 *
 *   rules      violet -- the layer's own hue in LAYER_SWATCH. Booking policy is organisational.
 *   covered    emerald -- sessions a rule actually governs. The only good-news figure here.
 *   conflicts  rose   -- ⚠ TWO RULES NOBODY CAN CHOOSE BETWEEN. s11 blocks activation until it is
 *                        resolved, so this is a figure somebody must act on, not one to note.
 *   decided    cyan   -- bookings carrying the rule and version that decided them (AC-13).
 */
export const LAYER3_STAT_SWATCH: Record<string, CardSwatch> = {
  rules: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚌", caption: "text-violet-800/70",
  },
  covered: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "✓", caption: "text-emerald-800/70",
  },
  conflicts: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-200/80 bg-rose-50/70", accent: "bg-rose-400",
    icon: "⚠", caption: "text-rose-800/70",
  },
  decided: {
    badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700",
    box: "border-cyan-200/80 bg-cyan-50/70", accent: "bg-cyan-400",
    icon: "⎘", caption: "text-cyan-800/70",
  },
  unknown: {
    badge: "bg-slate-100 text-slate-500", figure: "text-slate-600",
    box: "border-slate-300 bg-slate-50/80", accent: "bg-slate-300",
    icon: "?", caption: "text-slate-500",
  },
};

export const RULE_STATUS_CHIP: Record<string, { label: string; chip: string; dot: string }> = {
  draft: { label: "Draft", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-300", dot: "bg-slate-400" },
  active: { label: "Active", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  paused: { label: "Paused", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  archived: { label: "Archived", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-200", dot: "bg-slate-300" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-300", dot: "bg-slate-300" },
};
