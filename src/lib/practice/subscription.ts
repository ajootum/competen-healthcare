import { audit } from "./audit";
import {
  type GatewayConfig, createHostedCheckout, verifyTransaction, newTxRef, minorToMajor,
} from "./billing-gateway";

// The SUBSCRIPTION engine -- Competen billing the PRACTITIONER. billing-gateway.ts talks to Flutterwave;
// this file decides what a verified payment MEANS, and it is the only place that grants paid access.
//
// ⚠ NOT billing.ts. That name was already taken by the PATIENT-billing engine (fees, charges, invoices,
// receipts -- the CPR-PAY arc, 1,269 lines), and the two are opposite money flows. Naming this file
// billing.ts overwrote that engine outright; the collision was predicted in migration 349's header and
// then walked into anyway. Hence subscription.ts, and hence this paragraph.
//
// ⚠ ORDER OF OPERATIONS IN THE WEBHOOK, and every step of it is load-bearing:
//
//   CLAIM the event row first, and let the UNIQUE CONSTRAINT decide whether we own it. Verifying first and
//   inserting afterwards loses the race: two concurrent deliveries of the same retry both verify
//   successfully, both find the checkout pending, and both extend the subscription. Claiming first means
//   the loser is rejected by the database before it can do anything.
//
//   Then VERIFY with the gateway, then COMPARE against our own row, and only then grant. A failure at any
//   step records a verdict and grants nothing.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any;

const DAY = 86400000;

export type StartResult =
  | { ok: true; link: string; txRef: string }
  | { ok: false; code: "NOT_CONFIGURED" | "NO_SUCH_PLAN" | "PLAN_NOT_PRICED" | "GATEWAY_REFUSED" | "WRITE_FAILED"; detail?: string };

/**
 * Begin a checkout. Writes what WE intend to charge BEFORE handing the practitioner to the gateway --
 * that row is what the webhook later checks the gateway's answer against.
 */
export async function startCheckout(admin: Admin, cfg: GatewayConfig | null, args: {
  workspaceId: string; userId: string; email: string; name: string | null; planCode: string; correlationId?: string;
}): Promise<StartResult> {
  if (!cfg) return { ok: false, code: "NOT_CONFIGURED" };

  const { data: plan, error: planErr } = await admin.from("practice_plans")
    .select("plan_code, amount_minor, currency, interval_unit, active")
    .eq("plan_code", args.planCode).eq("active", true).maybeSingle();
  // A plan we could not READ is not a plan that is absent -- refuse rather than fall through to "no such
  // plan", which would send the practitioner away believing the price does not exist.
  if (planErr) return { ok: false, code: "WRITE_FAILED", detail: `plan unreadable: ${planErr.message}` };
  if (!plan) return { ok: false, code: "NO_SUCH_PLAN" };
  if (!plan.amount_minor || !plan.currency) return { ok: false, code: "PLAN_NOT_PRICED" };

  const txRef = newTxRef();
  const { data: row, error } = await admin.from("practice_checkout").insert({
    workspace_id: args.workspaceId, initiated_by: args.userId, plan_code: plan.plan_code,
    amount_minor: plan.amount_minor, currency: plan.currency, tx_ref: txRef, status: "pending",
  }).select("id").single();
  if (error) return { ok: false, code: "WRITE_FAILED", detail: error.message };

  const link = await createHostedCheckout(cfg, {
    txRef, amountMinor: plan.amount_minor, currency: plan.currency, email: args.email, name: args.name,
  });
  if (!link.ok) {
    // The attempt is closed rather than left pending: a row that can never be paid should not sit in the
    // queue looking like an abandoned cart.
    await admin.from("practice_checkout").update({ status: "failed", failure_reason: link.reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, code: "GATEWAY_REFUSED", detail: link.reason };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, eventType: "practice.checkout_started",
    payload: { planCode: plan.plan_code, amountMinor: plan.amount_minor, currency: plan.currency, txRef },
    correlationId: args.correlationId,
  });
  return { ok: true, link: link.link, txRef };
}

export type WebhookVerdict = "applied" | "duplicate" | "unverified" | "mismatched" | "unknown_ref" | "not_successful";
export type WebhookResult = { verdict: WebhookVerdict; detail?: string };

/**
 * Apply one webhook delivery. Returns a verdict for every path, because "nothing happened" and "we refused"
 * are different facts and the difference is the whole audit trail.
 *
 * The caller has ALREADY checked verif-hash. This function assumes nothing else.
 */
export async function applyWebhook(admin: Admin, cfg: GatewayConfig, ev: {
  providerEventId: string; providerTxId: string | null; txRef: string | null;
}): Promise<WebhookResult> {
  // 1. CLAIM. The unique (provider, provider_event_id) is the idempotency guard; a retry loses here and
  //    never reaches the grant below.
  const { data: claim, error: claimErr } = await admin.from("practice_checkout_event").insert({
    provider: "flutterwave", provider_event_id: ev.providerEventId, tx_ref: ev.txRef,
    verdict: "unverified", detail: "claimed, verification pending",
  }).select("id").single();
  if (claimErr) {
    if (/duplicate|unique/i.test(claimErr.message)) return { verdict: "duplicate" };
    return { verdict: "unverified", detail: `claim failed: ${claimErr.message}` };
  }

  const settle = async (verdict: WebhookVerdict, detail: string) => {
    await admin.from("practice_checkout_event").update({ verdict, detail: detail.slice(0, 500) }).eq("id", claim.id);
    return { verdict, detail };
  };

  if (!ev.providerTxId) return await settle("unverified", "no transaction id on the event");

  // 2. VERIFY with the gateway. Never the payload.
  const v = await verifyTransaction(cfg, ev.providerTxId);
  if (!v.ok) {
    const notSuccessful = /transaction status/i.test(v.reason);
    return await settle(notSuccessful ? "not_successful" : "unverified", v.reason);
  }

  // 3. COMPARE against the row we wrote before the practitioner left.
  const ref = v.txRef || ev.txRef;
  if (!ref) return await settle("unknown_ref", "verified transaction carries no tx_ref");

  const { data: checkout, error: coErr } = await admin.from("practice_checkout")
    .select("id, workspace_id, plan_code, amount_minor, currency, status")
    .eq("tx_ref", ref).maybeSingle();
  if (coErr) return await settle("unverified", `checkout unreadable: ${coErr.message}`);
  if (!checkout) return await settle("unknown_ref", `no checkout for tx_ref ${ref}`);

  await admin.from("practice_checkout_event").update({ checkout_id: checkout.id }).eq("id", claim.id);

  // A checkout already paid is not an error and not a second grant -- the guard above normally catches the
  // retry, but a DIFFERENT event id for the same transaction must not pay twice either.
  if (checkout.status === "paid") return await settle("duplicate", "checkout already settled");

  const expectedMajor = minorToMajor(checkout.amount_minor, checkout.currency);
  const currencyOk = v.currency === String(checkout.currency).toUpperCase();
  // Money compared in MINOR units after an explicit conversion, so a float cent never decides a grant.
  const amountOk = expectedMajor !== null && Math.round(v.amountMajor * 1000) >= Math.round(expectedMajor * 1000);

  if (!currencyOk || !amountOk) {
    await admin.from("practice_checkout").update({
      status: "mismatched", provider_tx_id: v.providerTxId, channel: v.channel,
      failure_reason: `expected ${expectedMajor} ${checkout.currency}, verified ${v.amountMajor} ${v.currency}`,
      updated_at: new Date().toISOString(),
    }).eq("id", checkout.id);
    await audit(admin, {
      workspaceId: checkout.workspace_id, eventType: "practice.checkout_mismatched",
      payload: { txRef: ref, expectedMinor: checkout.amount_minor, expectedCurrency: checkout.currency, verifiedMajor: v.amountMajor, verifiedCurrency: v.currency },
    });
    return await settle("mismatched", `expected ${expectedMajor} ${checkout.currency}, got ${v.amountMajor} ${v.currency}`);
  }

  // 4. GRANT.
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * DAY).toISOString();

  await admin.from("practice_checkout").update({
    status: "paid", provider_tx_id: v.providerTxId, channel: v.channel,
    settled_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", checkout.id);

  // ux_practice_subscription_workspace is a PLAIN unique index, so this on-conflict is a real target --
  // see migration 349's header for why the partial version it replaced was refused.
  await admin.from("practice_subscription").upsert({
    workspace_id: checkout.workspace_id, plan_code: checkout.plan_code, status: "active",
    current_period_start: now.toISOString(), current_period_end: periodEnd,
    last_checkout_id: checkout.id, updated_at: now.toISOString(),
  }, { onConflict: "workspace_id" });

  // The entitlement is what the shell already reads, so paid access arrives through the existing gate
  // rather than a second one nothing consults.
  await admin.from("practice_entitlement")
    .update({ plan_code: checkout.plan_code, status: "active", ends_at: periodEnd, updated_at: now.toISOString() })
    .eq("workspace_id", checkout.workspace_id).in("status", ["trial", "active", "expired"]);

  await audit(admin, {
    workspaceId: checkout.workspace_id, eventType: "practice.subscription_paid",
    payload: { txRef: ref, planCode: checkout.plan_code, channel: v.channel, periodEnd },
  });

  return await settle("applied", `paid via ${v.channel}`);
}
