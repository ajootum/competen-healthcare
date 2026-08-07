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
    permission: "Operational capacity and queue rules.",
    // s7.7's session and day limits, cutoff, queue and emergency override are Phase 5.
    door: false, phase: "Phase 5",
    capability: "appointment.manage",
    // Deliberately null: a walk-in is a person standing in the room, so delivery has nothing to do with
    // why it is shut. Attaching the same sentence to every closed channel would make it decoration.
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
// ────────────────────────────────────────────────────────────────────────────────────────────────────
export const BUILDER_SECTIONS = [
  {
    key: "identity", title: "Identity", built: true, phase: null as string | null,
    responsibility: "Name, description, status, priority, effective dates",
    note: "All stored. Priority is what settles two rules that are equally specific.",
  },
  {
    key: "scope", title: "Scope", built: true, phase: null,
    responsibility: "Location, recurring session, appointment type, booking channel, patient group",
    note: "All five stored, and all five feed s11's ladder.",
  },
  {
    key: "window", title: "Booking window", built: true, phase: null,
    responsibility: "Opening horizon, closing notice, same-day and late booking behaviour",
    note: "The horizon and the notice period are enforced. Separate same-day and late-booking behaviours are not a column on this table, so they are not offered.",
  },
  {
    key: "capacity", title: "Capacity", built: true, phase: null,
    responsibility: "Total, by appointment type, reserves, walk-ins, urgent additions and overbooking",
    note: "Total, new, follow-up, urgent reserve and overbooking are counted per session and enforced. The walk-in limit is the practice-wide daily one from before the card model.",
  },
  {
    key: "eligibility", title: "Eligibility", built: true, phase: null,
    responsibility: "New/existing, referred, age range, active follow-up plan and approval requirements",
    note: "All stored and used to decide whether the rule is this patient's rule at all.",
  },
  {
    key: "follow_ups", title: "Follow-ups", built: true, phase: null,
    responsibility: "Due window, early/overdue booking, reserved capacity and recall behaviour",
    note: "The early and late window is enforced against the follow-up's own due date. The recall queue is Phase 5 and lives in Follow-ups.",
  },
  {
    key: "walk_ins", title: "Walk-ins", built: false, phase: "Phase 5",
    responsibility: "Session/day limits, cutoff time, queue and emergency override",
    note: "There is no per-session walk-in limit, cutoff or queue rule on this table. The practice-wide daily limit from before the card model still applies and is shown on the card.",
  },
  {
    key: "confirmation", title: "Confirmation", built: true, phase: null,
    responsibility: "Instant, practitioner approval, staff approval or conditional",
    note: "Decides whether a booking is created confirmed or as a request.",
  },
  {
    key: "cancellations", title: "Cancellations", built: false, phase: "Phase 5",
    responsibility: "Cancellation notice, self-reschedule, DNA and waiting-list release",
    note: "The notice period is stored from before the card model and reported, never used to refuse a cancellation. Self-reschedule needs the patient-facing page, and there is no waiting list in this schema.",
  },
  {
    key: "required_information", title: "Required information", built: false, phase: "Phase 4",
    responsibility: "Booking fields, documents, referral information and patient-reported context",
    note: "s9's intake belongs to the patient-facing booking page. The registration form that already exists is configured in Practice Setup.",
  },
  {
    key: "notifications", title: "Notifications", built: false, phase: "Phase 6",
    responsibility: "Trigger selection; templates and delivery remain in Notifications configuration",
    note: "Nothing in this product sends a message to a patient. Offering triggers here would promise a notification nobody would receive.",
  },
  {
    key: "overrides", title: "Overrides", built: true, phase: null,
    responsibility: "Who may override, reason requirement and audit behaviour",
    note: "An override needs the settings permission and a reason, lifts only capacity and window refusals, and is written to the audit trail before the booking is made.",
  },
] as const;

export const BUILDER_SECTIONS_BUILT: string[] = BUILDER_SECTIONS.filter(s => s.built).map(s => s.key);

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
