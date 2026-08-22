/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any;

// What the billing card is allowed to say about this workspace.
//
// ⚠ EVERY FIELD CAN BE "WE DO NOT KNOW", and that is the point. CLAUDE.md: "Unknown, Not Measured and No
// Producer are legitimate states -- render them as what they are, with the reason. Do not substitute blank
// or zero for missing evidence." A billing card is the worst place to break that rule: telling somebody
// they are on a free trial when the entitlement row could not be read is how a practitioner discovers on
// a Monday morning that their workspace expired a week ago.
//
// So `unavailable` names the sources that failed, and the card refuses to draw a status rather than
// drawing a reassuring one.

export type PlanOffer = { planCode: string; name: string; amountMinor: number; currency: string; interval: string };

export type SubscriptionState = {
  /** Sources that could not be read. Non-empty means nothing below is a statement about this workspace. */
  unavailable: string[];
  /** null = no entitlement row found, which is different from an entitlement we could not read. */
  entitlement: { planCode: string; status: string; endsAt: string | null } | null;
  subscription: { planCode: string; status: string; periodEnd: string } | null;
  /** Priced, active plans. EMPTY IS A REAL ANSWER -- 349 seeds its plan inactive on purpose. */
  offers: PlanOffer[];
  /** Whether this deployment can take money at all, i.e. the gateway env is set. */
  gatewayReady: boolean;
  /** The most recent attempt, so a practitioner who abandoned a checkout is not left guessing. */
  lastAttempt: { status: string; currency: string; amountMinor: number; createdAt: string } | null;
};

export async function subscriptionState(admin: Admin, workspaceId: string, gatewayReady: boolean): Promise<SubscriptionState> {
  const unavailable: string[] = [];

  const [entRes, subRes, planRes, attemptRes] = await Promise.all([
    admin.from("practice_entitlement").select("plan_code, status, ends_at")
      .eq("workspace_id", workspaceId).in("status", ["trial", "active", "expired", "suspended"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("practice_subscription").select("plan_code, status, current_period_end")
      .eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("practice_plans").select("plan_code, name, amount_minor, currency, interval_unit")
      .eq("active", true).not("amount_minor", "is", null).order("amount_minor"),
    admin.from("practice_checkout").select("status, currency, amount_minor, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (entRes.error) unavailable.push("your entitlement");
  if (subRes.error) unavailable.push("your subscription");
  // A plan list we could not read renders as "no plans on offer", which would be a lie about the price
  // rather than about the workspace -- so it is named too.
  if (planRes.error) unavailable.push("the available plans");
  // The last attempt is genuinely optional context; a failure there is not worth alarming anybody over.

  const e = entRes.data;
  const s = subRes.data;

  return {
    unavailable,
    entitlement: e ? { planCode: e.plan_code, status: e.status, endsAt: e.ends_at ?? null } : null,
    subscription: s ? { planCode: s.plan_code, status: s.status, periodEnd: s.current_period_end } : null,
    offers: ((planRes.data ?? []) as any[]).map(p => ({
      planCode: p.plan_code, name: p.name, amountMinor: p.amount_minor,
      currency: p.currency, interval: p.interval_unit,
    })),
    gatewayReady,
    lastAttempt: attemptRes.data
      ? { status: attemptRes.data.status, currency: attemptRes.data.currency, amountMinor: attemptRes.data.amount_minor, createdAt: attemptRes.data.created_at }
      : null,
  };
}

/**
 * Money for display. Uses the SAME exponent table the gateway charges against, so the figure on the
 * button and the figure Flutterwave is handed cannot drift -- two money formatters disagreeing
 * major-vs-minor is the bug this repository has already paid for once.
 */
export function formatMoney(amountMinor: number, currency: string, exponentOf: (c: string) => number | null): string | null {
  const exp = exponentOf(currency);
  if (exp === null) return null;                       // an unknown currency shows no price, never a wrong one
  const major = amountMinor / 10 ** exp;
  return `${currency.toUpperCase()} ${major.toLocaleString(undefined, { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
}
