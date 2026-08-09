// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHERE, AND WHETHER, ONBOARDING OFFERS THE BOOKING HANDLE -- as a pure function.
//
// PIS-000 s3. The practice owner asked whether claiming a handle could be "a primary page during
// provisioning at the very beginning of account/practice set up", and settled two conditions with it:
// OPTIONAL, and NOT FIRST.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY THIS IS A FUNCTION IN A FILE OF ITS OWN RATHER THAN THREE CONDITIONS INSIDE THE WIZARD'S JSX.
//
// "Not first" is a PROMISE ABOUT A PERMANENT ACT. A handle cannot be released to anybody else, ever --
// not to another practitioner and not to its own owner under a different name -- so the difference
// between offering it on the first screen a stranger sees and offering it after they have told us who
// they are is the difference between a decision and a reflex. A rule that lives in a `&&` inside a
// render is a rule nothing can test and any refactor can invert without a single check going red.
//
// So the rule is here, it is pure, and the harness drives it with real step lists.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO NEW ONBOARDING STEP WAS SEEDED, AND THAT IS DELIBERATE RATHER THAN A SHORTCUT. The wizard is
// catalogue-driven: practice_onboarding_step_catalog holds the six required steps (migration 191) and
// the API refuses any stepCode that is not one of them. Adding a seventh row would make claiming a
// public name a STEP OF PROVISIONING -- something with a position in "step 2 of 7", a completion record,
// and a shape that reads as required. It is not required. It is an offer between two required steps,
// it writes nothing when declined, and the flow completes identically whether it is taken or not.

/** What the identity endpoint said about this practitioner, reduced to the part placement depends on. */
export type IdentityProbeState =
  /** The GET has not answered yet. */
  | "checking"
  /** 403: this caller may not manage practice settings, so there is nothing to offer them. */
  | "no_permission"
  /** No identity row exists -- provisioning's issuance was soft and did not run. */
  | "none"
  /** An identity, a permanent number, and no public address. The state the offer is FOR. */
  | "unclaimed"
  /** An address already exists. Nothing to offer, and nothing that may be overwritten. */
  | "claimed"
  /** ⚠ THE READ FAILED. Never folded into "unclaimed" -- see the note on `unreadable` below. */
  | "unreadable";

export type HandleOfferDecision =
  | {
    show: false;
    reason:
    /** The practitioner declined it. Declining is final for this practice, and costs nothing. */
    | "skipped"
    /** ⚠ THE NOT-FIRST RULE. Nothing has been completed yet, so this would be the opening screen. */
    | "first_step"
    /** Onboarding is over; there is no "during provisioning" left to be during. */
    | "flow_finished"
    /** A catalogue with fewer than two steps has no position that is after something and before the end. */
    | "no_offer_point"
    /** Still asking. An offer drawn before the answer would be drawn over an unknown state. */
    | "checking"
    /** There is already an address, or this caller could never claim one. */
    | "already_claimed" | "not_offered";
  }
  | {
    show: true;
    /**
     * `claim`     -- the offer proper: choose a handle, or skip.
     * `issue`     -- no identity row yet. A DIFFERENT act, with its own button and its own sentence;
     *                it creates a permanent number and publishes nothing, and it never claims.
     * `unreadable`-- say so, offer no control, and let them past. See below.
     */
    kind: "claim" | "issue" | "unreadable";
  };

/**
 * ⚠ HOW MANY CATALOGUE STEPS MUST BE FINISHED BEFORE THE OFFER APPEARS.
 *
 * One. Not zero, which would make a permanent public name the first thing a new practitioner is asked
 * for; and not "after the whole flow", which is the status quo the owner was objecting to -- the offer
 * would then be indistinguishable from finding it in Practice Setup a week later, which is what already
 * existed and what nobody found.
 */
export const OFFER_AFTER_COMPLETED_STEPS = 1;

/**
 * Should onboarding offer the handle right now?
 *
 * ⚠ THE ORDER OF THESE TESTS IS THE ARGUMENT. `skipped` outranks everything, because a decision the
 * practitioner has already made must not be re-asked by a later condition becoming true. `first_step`
 * outranks every identity state, so no read result can ever promote the offer to the opening screen.
 * And `unreadable` is answered LAST and answered honestly: a failed read is not an unclaimed address.
 */
export function handleOfferDecision(args: {
  /** The catalogue's step codes, in position order, as the onboarding API returned them. */
  steps: string[];
  /** Which of them are done. */
  completedSteps: string[];
  /** The step the wizard would otherwise be showing. Null once the flow is complete. */
  currentStep: string | null;
  identity: IdentityProbeState;
  /** The practitioner already said no, in this practice. */
  skipped: boolean;
}): HandleOfferDecision {
  if (args.skipped) return { show: false, reason: "skipped" };
  if (args.currentStep === null) return { show: false, reason: "flow_finished" };
  if (args.steps.length < 2) return { show: false, reason: "no_offer_point" };

  // ⚠ THE PROMISE, ENFORCED HERE AND NOWHERE ELSE. Before this line the practitioner has answered
  // nothing; a public address chosen here would be chosen by somebody who has not yet been asked their
  // profession, and it could never be taken back.
  if (args.completedSteps.length < OFFER_AFTER_COMPLETED_STEPS) return { show: false, reason: "first_step" };

  if (args.identity === "checking") return { show: false, reason: "checking" };
  if (args.identity === "no_permission") return { show: false, reason: "not_offered" };
  if (args.identity === "claimed") return { show: false, reason: "already_claimed" };
  if (args.identity === "none") return { show: true, kind: "issue" };
  if (args.identity === "unreadable") return { show: true, kind: "unreadable" };
  return { show: true, kind: "claim" };
}

/**
 * Where a declined offer is remembered.
 *
 * ⚠ THIS IS A BROWSER PREFERENCE, NOT A RECORD, AND THE DIFFERENCE IS STATED BECAUSE IT MATTERS. There
 * is no column for "was offered a handle and said no" and this build adds no migration, so the decline
 * lives in localStorage against this workspace. If it is cleared -- a different device, private
 * browsing, a wiped profile -- the offer appears once more and is declined again in one click. That is
 * the whole cost of the weaker store, and it is the right way round: the thing that is NOT durably
 * recorded is the refusal, while the only durable write in this flow is the one the practitioner
 * explicitly asked for.
 */
export const offerSkipKey = (workspaceId: string) => `cp-practice-handle-offer:${workspaceId}`;
