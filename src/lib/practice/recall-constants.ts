// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 5 -- FOLLOW-UPS AND WALK-INS. The constants half.
//
// s19's Phase 5 is "Follow-up due windows, recall linkage, walk-in queue rules", exit condition
// "CP-SPECIFIC PATIENT PATHWAYS WORK END TO END". The due WINDOW shipped with Phase 3 -- booking-rules.ts
// enforces follow_up_early_days / follow_up_late_days against the follow-up's own due date, which is
// AC-08. What Phase 5 owes is the other two: s7.5's recall queue, and s7.7's walk-in rules.
//
// ⚠ THIS FILE HOLDS NO SERVER IMPORT AND NO ENGINE CALL, because a client component reads it. The rule
// this codebase learned the hard way: a payload carrying a function is tsc-clean, eslint-clean,
// harness-clean and dead on the page. Everything below is a string, a number, a boolean or an array.
//
// ---- WHAT s7.5 ASKS FOR, AND WHICH HALF HAS A STORE ------------------------------------------------
//
//   "Allow self-booking only where an active follow-up recommendation exists, if configured."
//        STORED AND ENFORCED. practice_booking_rule.patient_eligibility carries `active_follow_up`, and
//        booking-rules.ts reads the patient's live follow-ups to decide it.
//   "Use recommended due date and acceptable early/late window to determine eligible sessions."
//        STORED AND ENFORCED (Phase 3, AC-08).
//   "Bookings outside the recommended window may be blocked or routed for approval."
//        BLOCKED, and overridable with a reason. Routing for approval is the confirmation mode, which is
//        a separate column and already honoured.
//   "Unbooked due follow-ups remain visible in Follow-ups and MAY ENTER A RECALL QUEUE."
//        ⚠ THIS IS PHASE 5'S FIRST DELIVERABLE, and it is DERIVED rather than stored -- see below.
//   "Missed follow-up appointments return to follow-up management according to the rule."
//        ⚠ THIS IS PHASE 5'S SECOND DELIVERABLE. The detection and the return are real. "According to
//        the rule" is NOT: see RECALL_NOT_CONFIGURABLE.
//
// ---- ⚠ WHY THE RECALL QUEUE IS DERIVED AND NOT A TABLE ---------------------------------------------
//
// Migration 196's header, and follow-ups.ts's, both say it about OVERDUE: a stored state needs something
// to run to become true, and the thing it needs is exactly what a neglected practice does not do -- the
// queue would be shortest for the practice that had forgotten most. A recall queue is the same value
// wearing a different name, so it is computed at read time from due_on against the practice's own today,
// every time. There is no recall table to fall behind, and nothing to sweep.
//
// A recall ATTEMPT is a different thing entirely: it is an event, it happened at a moment, and it has no
// store. RECALL_NOT_RECORDED says so rather than letting the screen imply the list is being worked.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY CAPABILITY CODE PHASE 5 NAMES, AS AN EXPORTED ARRAY.
 *
 * The audit harness scans for capability codes written as inline double-quoted literals; a code reached
 * through a constants object is invisible to it, which is how six invented codes have shipped here. The
 * harness asserts this array against practice_role_capabilities, which held 47 codes when this was
 * written -- probed, not remembered.
 */
export const RECALL_CAPABILITIES: string[] = [
  // Reading the queue is reading follow-ups.
  "followup.view",
  // Returning a stranded follow-up to the queue changes its status, which is managing it.
  "followup.manage",
];

/** Capabilities the walk-in policy report reads under. The queue and the diary, not the follow-ups. */
export const WALK_IN_CAPABILITIES: string[] = [
  "practice.calendar.view",
  "queue.manage",
];

/**
 * The appointment statuses that mean a booking is DEAD -- it will not happen and nobody is coming.
 *
 * ⚠ NO_SHOW AND CANCELLED, AND NOT COMPLETED. A COMPLETED appointment settles its follow-up through
 * settleFollowUpsForEncounter; treating it as dead here would reopen every obligation that had just been
 * met, which is the false positive the whole module exists to avoid, pointing the other way.
 */
export const DEAD_APPOINTMENT_STATUSES = ["CANCELLED", "NO_SHOW"] as const;

/**
 * The follow-up statuses that can sit in a recall queue: owed, and nothing booked.
 *
 * SCHEDULED is deliberately absent -- something IS booked, so nobody needs recalling. A SCHEDULED
 * follow-up whose booking has died is a STRANDED one, which is its own list, because the action it needs
 * is different: it must be returned to the queue before it can be recalled.
 */
export const RECALLABLE_FOLLOW_UP_STATUSES = ["OPEN", "DEFERRED"] as const;

/**
 * ⚠ WHAT A RECALL QUEUE WOULD RECORD, AND CANNOT.
 *
 * Rendered on the screen beside the queue. An unwarned screen reads as a cleared screen: a practitioner
 * looking at fourteen names has no way of knowing whether anybody has rung any of them, and a list that
 * did not say so would imply it was being worked.
 */
export const RECALL_NOT_RECORDED = [
  {
    what: "Whether anybody has already tried to reach this person",
    whyNot:
      "A recall attempt is an event -- a channel, a moment, an outcome -- and there is no table for one. practice_follow_up_event records STATUS TRANSITIONS, and writing an attempt into it would put a move in the trail that never happened. Nothing on this screen therefore claims a person has or has not been contacted.",
  },
  {
    what: "How many times somebody has been recalled before giving up",
    whyNot: "The same absent store. The event trail can answer how many times a follow-up has been PUSHED, because migration 239 gave it from_due_on and to_due_on; it cannot answer how many times somebody has been rung.",
  },
] as const;

/**
 * ⚠ WHAT s7.5's "ACCORDING TO THE RULE" WOULD NEED, AND WHICH COLUMN IS MISSING.
 *
 * "Missed follow-up appointments return to follow-up management according to the rule" makes the return
 * behaviour a property of the booking rule. practice_booking_rule (migration 244) has no such column, so
 * the return is offered as a decision a person makes rather than performed automatically under a policy
 * nobody could have written. Stating the gap beats inventing a default and calling it the rule.
 */
export const RECALL_NOT_CONFIGURABLE = [
  {
    what: "What happens automatically when a follow-up's booking is missed",
    whyNot:
      "s7.5 makes it a property of the booking rule, and practice_booking_rule has no column for it -- no on_missed behaviour, no automatic-reopen flag, no recall delay. So a stranded follow-up is SHOWN and the return is a decision somebody takes, with the reason recorded. It is not done silently under a policy that was never written down.",
    wouldNeed:
      "One column on practice_booking_rule, e.g. on_missed_followup text check (in ('return_to_queue','defer','close_missed','none')), plus an optional recall_delay_days integer.",
  },
] as const;

/**
 * ⚠ WHAT s7.7 ASKS FOR ABOUT WALK-INS, AND WHAT NO COLUMN HOLDS.
 *
 * The builder card already says this ("Walk-ins -- Session/day limits, cutoff time, queue and emergency
 * override -- Phase 5"). Phase 5 closes the LIMITS half, because migration 240 gave
 * practice_availability_template both walk_ins_allowed and walk_in_limit. The other three have nowhere
 * to live and are named here rather than drawn as controls that do nothing.
 */
// ⚠ ALL THREE OF THESE ARE BUILT NOW (migrations 268 and 269), AND THE LIST IS KEPT RATHER THAN DELETED.
//
// It is what this screen showed a practitioner as missing, so deleting it would leave somebody who read
// it last week with no way to learn that it had arrived -- and `wouldNeed` was a promise about where the
// control would appear. Each entry now says WHERE it is, and one of them records that the promise was
// not kept to the letter: the cutoff went onto the RULE rather than onto the session, because a rule may
// already name a session and s11's ladder then gives a per-session, per-location, per-type or
// practice-wide cutoff from one column instead of only the first of those.
export const WALK_IN_NOT_CONFIGURABLE: readonly { what: string; whyNot: string; wouldNeed: string }[] = [];

export const WALK_IN_NOW_CONFIGURABLE = [
  {
    what: "A cutoff time after which no more walk-ins are accepted",
    where: "On the booking rule that governs the clinic, under Walk-ins, as a number of minutes before a session ends.",
    note: "recall-constants.ts said this would need a column on the SESSION. It went onto the rule instead: a rule may already name a session, so one column gives a cutoff per session, per location, per appointment type or practice-wide, and s11 decides which applies. A time no session covers has no cutoff, because a cutoff is measured back from a session's end.",
  },
  {
    what: "Queue position and ordering rules",
    where: "The policy is on the booking rule, under Walk-ins. The priority itself is set on the waiting-room entry, with a reason.",
    note: "Every queue in this product is ordered by priority, then arrival. Under the default policy nobody may set a priority, so every entry is routine and that order is arrival order -- which is why turning the policy on changes what the desk may do and never changes how two screens sort the same queue.",
  },
  {
    what: "An emergency override of the walk-in limit",
    where: "Offered on the booking itself, to anybody holding the practice settings permission, with a reason.",
    note: "It is s14's own shape, extended to the walk-in codes: the reason is recorded in the audit trail BEFORE the walk-in is booked, and the override is carried to checkPlacement on its own argument so that lifting a walk-in limit can never lift a booking window, or the reverse.",
  },
] as const;

/**
 * ⚠ WHERE THE PER-SESSION WALK-IN LIMIT IS AND IS NOT ENFORCED, STATED ON THE SCREEN.
 *
 * migration 240 stores walk_in_limit per session and NOTHING READS IT AT BOOKING TIME. checkPlacement
 * enforces only the practice-wide walk_in_daily_limit from migration 230, per location. So a practitioner
 * who set "6 walk-ins" on a Tuesday clinic believes it is a limit. It is not one, and until this build
 * nothing had ever told them so.
 *
 * The engine below resolves and reports the effective limit against real counts. Enforcing it means one
 * call inside checkPlacement, in scheduling.ts, which this build did not change.
 */
export const WALK_IN_ENFORCEMENT_NOTE =
  "Both limits are enforced when a walk-in is booked, and the stricter one bites. checkPlacement counts the day's walk-ins at the location against your practice-wide limit, then counts the ones already inside this session against the session's own -- and the refusal names which of the two was reached, so nobody goes and changes the wrong setting. A limit that could not be checked refuses the booking rather than waving it through.";

/** Tinted swatches for Phase 5's tiles. Parked here rather than in palette.ts, which is contended. */
export type RecallSwatch = { badge: string; figure: string; box: string; caption: string; icon: string };

export const PHASE5_SWATCH: Record<string, RecallSwatch> = {
  overdue: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-200/80 bg-rose-50/70", caption: "text-rose-800/70", icon: "⏱",
  },
  due_today: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", caption: "text-amber-800/70", icon: "◔",
  },
  stranded: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", caption: "text-violet-800/70", icon: "⚯",
  },
  unreachable: {
    badge: "bg-slate-200 text-slate-700", figure: "text-slate-700",
    box: "border-slate-300 bg-slate-50", caption: "text-slate-600", icon: "◌",
  },
  walk_ins: {
    badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700",
    box: "border-cyan-200/80 bg-cyan-50/70", caption: "text-cyan-800/70", icon: "⇥",
  },
};
