/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-PROV-001 §12 / §19 / AC-10 -- WHICH SOURCE CONTROLS ACCESS, WHEN SEVERAL DISAGREE.
//
// §12: "Define precedence when billing state, manual promotional entitlement and administrative
// suspension coexist." §19: "Resolve commercial authority explicitly: identify which source controls
// access for paid subscriptions, trials, promotions/internal access and administrative suspension."
//
// ⚠ THE FULL STATEMENT IS docs/adr/ADR-015-practice-commercial-precedence.md. This module is the half
// that executes, and it exists because a precedence rule that lives only in prose is a diagram. Read the
// ADR for the reasoning and the measurements; this file is what the product actually obeys.
//
// THE RULE, IN ONE SENTENCE:
//
//   Administrative suspension outranks every commercial fact; below it, `practice_entitlement` is the
//   ONLY thing that grants access, and every commercial source -- trial, payment, promotion, Director --
//   expresses itself by writing a period into it.
//
// ⚠ `practice_subscription` IS A RECEIPT, NOT A GATE, AND THAT WAS MEASURED RATHER THAN ASSUMED. It is
// read in exactly one place (subscription-state.ts, the practice's own billing card) and written in one
// (the payment settlement). resolveWorkspaceContext never looks at it. So a workspace can hold an
// `active` subscription row and still be shut, or a `cancelled` one and still be open: the row records
// what was paid, and the entitlement period the payment CREATED is what lets anybody in.
//
// ⚠ THERE IS NO SEPARATE PROMOTIONAL SOURCE. §12 names promotions as a third party to the conflict; in
// this schema a promotion IS an entitlement period with a plan code, written by a Director. The PD
// promotions surface says so itself, as a stated absence. So the three-way conflict §12 anticipates is
// really a two-way one -- suspension against a single entitlement ledger -- and the ledger's own
// append-only history is what records who wrote each period and why.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The lifecycle states resolveWorkspaceContext admits. Anything else is administrative suspension. */
export const OPERABLE_WORKSPACE_STATUSES: readonly string[] = ["ACTIVE", "ONBOARDING", "PROVISIONING"];

export type CommercialAuthority = {
  /**
   * Which source is deciding this practice's access right now, in precedence order.
   *
   * `administrative` -- the workspace status shuts it, and no commercial act can reopen it.
   * `entitlement`    -- normal: a period decides, whoever wrote it.
   * `unreadable`     -- one of the reads failed. NOT an answer about the practice.
   */
  governedBy: "administrative" | "entitlement" | "unreadable";
  /** The workspace lifecycle status, when it could be read. */
  workspaceStatus: string | null;
  /**
   * A paid subscription row for this workspace, if one exists. Present does NOT mean access:
   * see the header. It means a manual entitlement change is overriding something somebody paid for.
   */
  subscription: { planCode: string; status: string; periodEnd: string | null } | null;
  /** True when a subscription is `active` and its period has not run out on the reading clock. */
  billingLive: boolean;
  /**
   * ⚠ THE PERIOD CURRENTLY LETTING PEOPLE IN, and the thing rung 3 actually judges (migration 368).
   * Null when nothing is granting access -- the reactivation case, where there is nothing to take away.
   *
   * It lives on the authority rather than being passed in by each caller so that two call sites cannot
   * disagree about which period an act is about.
   */
  currentPeriod: { source: string; endsAt: string | null; grantsAccessNow: boolean } | null;
  /** Everything that could not be read, named. Empty means every field above is a real answer. */
  problems: string[];
};

export async function commercialAuthority(admin: any, workspaceId: string): Promise<CommercialAuthority> {
  const problems: string[] = [];

  const [wsRes, subRes, entRes] = await Promise.all([
    admin.from("practice_workspace").select("status").eq("id", workspaceId).maybeSingle(),
    admin.from("practice_subscription").select("plan_code, status, current_period_end")
      .eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("practice_entitlement").select("status, starts_at, ends_at, source")
      .eq("workspace_id", workspaceId).order("starts_at", { ascending: false }),
  ]);

  if (wsRes.error) problems.push(`the practice's lifecycle status could not be read: ${wsRes.error.message}`);
  if (subRes.error) problems.push(`the practice's subscription could not be read: ${subRes.error.message}`);
  if (entRes.error) problems.push(`the practice's access periods could not be read: ${entRes.error.message}`);

  const workspaceStatus = wsRes.error ? null : ((wsRes.data?.status as string | undefined) ?? null);
  const s = subRes.error ? null : (subRes.data as any ?? null);
  const subscription = s
    ? { planCode: String(s.plan_code), status: String(s.status), periodEnd: s.current_period_end ?? null }
    : null;

  const billingLive = !!subscription
    && subscription.status === "active"
    && (subscription.periodEnd === null || Date.parse(subscription.periodEnd) > Date.now());

  // The period granting access right now, by the same three conditions the gate applies.
  const nowIso = new Date().toISOString();
  const granting = ((entRes.data ?? []) as any[]).find(r =>
    ["active", "trial"].includes(String(r.status))
    && String(r.starts_at) <= nowIso
    && (r.ends_at === null || String(r.ends_at) >= nowIso));
  const currentPeriod = granting
    ? { source: granting.source ? String(granting.source) : "unknown", endsAt: granting.ends_at ?? null, grantsAccessNow: true }
    : null;

  // ⚠ A FAILED READ IS NOT "NOT SUSPENDED", AND IT IS NOT "NOTHING IS PAID FOR" EITHER. Deciding
  // precedence from half an answer is how a caller ends up told they may proceed because the thing that
  // would have stopped them was unreachable. Either failed read makes the authority unreadable.
  const governedBy: CommercialAuthority["governedBy"] =
    wsRes.error || entRes.error ? "unreadable"
      : workspaceStatus !== null && !OPERABLE_WORKSPACE_STATUSES.includes(workspaceStatus) ? "administrative"
        : "entitlement";

  return { governedBy, workspaceStatus, subscription, billingLive, currentPeriod, problems };
}

export type OverrideVerdict =
  /** Nothing in the way. */
  | { allowed: true; acknowledgementRequired: false }
  /**
   * The act is permitted but contradicts a commercial fact somebody else established, so §12 requires
   * it to be deliberate rather than silent. The caller must pass the acknowledgement explicitly.
   */
  | { allowed: true; acknowledgementRequired: true; because: string }
  /** Refused: the act cannot achieve what the caller intends. */
  | { allowed: false; code: string; message: string };

/**
 * §12: "Billing-authoritative subscriptions must not be silently overwritten by a PD manual entitlement
 * action." AC-10: "Independent Change/override actions respect billing authority and commercial
 * precedence."
 *
 * ⚠ "MUST NOT BE SILENTLY OVERWRITTEN" IS NOT "MUST NOT BE OVERWRITTEN", and the difference is the whole
 * design. A Director has to be able to end access to a practice that has paid -- for a chargeback, a
 * safety suspension, a refund already handled elsewhere. Refusing outright would put the product in the
 * way of a legitimate act and send somebody to the SQL editor, where nothing is audited at all. So the
 * override is permitted, named, and recorded; what it may not be is accidental.
 *
 * ⚠ AND IT IS ONLY ASKED FOR WHEN THE ACT REDUCES ACCESS. Extending a paid practice's access is not a
 * conflict with billing; it is a gift. Demanding a ceremony for it would train Directors to click
 * through the ceremony, which is how a real warning stops being read.
 */
export function judgeOverride(authority: CommercialAuthority, act: {
  kind: "grant" | "end";
  /** For a grant: the end the Director is proposing. Null = open-ended. Ignored for `end`. */
  proposedEndsAt?: string | null;
  acknowledged: boolean;
}): OverrideVerdict {
  if (authority.governedBy === "unreadable")
    return {
      allowed: false, code: "AUTHORITY_UNREADABLE",
      message: "This practice's lifecycle status could not be read, so it is not known whether a commercial change would have any effect. Nothing was changed.",
    };

  // ── Precedence rung 1: administrative suspension outranks every commercial fact ──────────────────
  if (authority.governedBy === "administrative")
    return {
      allowed: false, code: "ADMINISTRATIVELY_CLOSED",
      message: `This practice is ${authority.workspaceStatus}, which closes it regardless of any plan. `
        + "An access period written now would grant nothing. Restore the practice first; its access period is a separate decision.",
    };

  // ── Precedence rung 3: is the period being taken away one that a PAYMENT wrote? ──────────────────
  //
  // ⚠ THE PERIOD DECIDES, NOT THE WORKSPACE (migration 368). `practice_subscription` is corroboration
  // for the message -- it names the plan and the date -- but the authority is carried by the period
  // itself, because that is the thing the act is about to shorten or close.
  const current = authority.currentPeriod;

  // Nothing is granting access, so nothing paid-for is being taken away. This is the reactivation case.
  if (!current || !current.grantsAccessNow) return { allowed: true, acknowledgementRequired: false };

  // ⚠ A DIRECTOR'S OWN PERIOD IS NOT A PAYMENT, AND NEITHER IS A TRIAL OR AN `unknown`. Only `payment`
  // carries billing authority; every other source is somebody in this product deciding, and a Director
  // revising their own decision owes nobody a ceremony.
  if (current.source !== "payment") return { allowed: true, acknowledgementRequired: false };

  // The subscription row, where it agrees, supplies the plan name and the paid-until date. Where it does
  // not exist, the period alone is still authority enough -- a payment wrote it.
  const sub = authority.subscription;
  const plan = sub?.planCode ?? "This period";
  const paidUntil = current.endsAt ?? sub?.periodEnd ?? null;

  if (act.kind === "end")
    return acknowledgementRequired(
      `${plan} was paid for${paidUntil ? ` and runs to ${paidUntil.slice(0, 10)}` : ""}. `
      + "Ending access now closes a practice that has paid for it.",
      act.acknowledged);

  // A grant that ends BEFORE the paid period is a shortening, which §13 calls a high-impact action.
  if (paidUntil && act.proposedEndsAt && Date.parse(act.proposedEndsAt) < Date.parse(paidUntil))
    return acknowledgementRequired(
      `${plan} is paid until ${paidUntil.slice(0, 10)}, and this period would end before that.`,
      act.acknowledged);

  // Extending, or matching, or open-ended: no conflict with what was paid for.
  return { allowed: true, acknowledgementRequired: false };
}

function acknowledgementRequired(because: string, acknowledged: boolean): OverrideVerdict {
  if (acknowledged) return { allowed: true, acknowledgementRequired: true, because };
  return {
    allowed: false, code: "BILLING_OVERRIDE_UNACKNOWLEDGED",
    message: `${because} This is permitted, but it has to be deliberate: confirm that you are overriding the paid subscription and it will be recorded with your reason.`,
  };
}
