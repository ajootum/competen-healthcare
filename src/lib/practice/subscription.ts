import { audit } from "./audit";
import { openAccessPeriod } from "./entitlement-writer";
import { type GatewayConfig, createHostedCheckout, newTxRef } from "./subscription-gateway";
import { settleWebhook, type SettlementAdapter, type WebhookResult } from "@/lib/commerce/settlement";

// The SUBSCRIPTION engine -- Competen billing the PRACTITIONER. subscription-gateway.ts talks to Flutterwave;
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

export type { WebhookVerdict, WebhookResult } from "@/lib/commerce/settlement";

/**
 * Apply one webhook delivery. Returns a verdict for every path, because "nothing happened" and "we refused"
 * are different facts and the difference is the whole audit trail.
 *
 * The caller has ALREADY checked verif-hash. This function assumes nothing else.
 *
 * ⚠ THE CLAIM / VERIFY / COMPARE STEPS NOW LIVE AT HOLDINGS LEVEL (src/lib/commerce/settlement.ts), moved
 * there unchanged so Competen Individual settles through the same code. What stays here is what a proven
 * Practice payment MEANS: the subscription row, the access period and Practice's audit events.
 */
export function applyWebhook(admin: Admin, cfg: GatewayConfig, ev: {
  providerEventId: string; providerTxId: string | null; txRef: string | null;
}): Promise<WebhookResult> {
  return settleWebhook(admin, cfg, ev, PRACTICE_SETTLEMENT);
}

const PRACTICE_SETTLEMENT: SettlementAdapter = {
  eventTable: "practice_checkout_event",
  checkoutTable: "practice_checkout",
  checkoutColumns: "id, workspace_id, plan_code, amount_minor, currency, status",

  async onMismatched(admin, checkout, v, ref) {
    await audit(admin, {
      workspaceId: checkout.workspace_id, eventType: "practice.checkout_mismatched",
      payload: { txRef: ref, expectedMinor: checkout.amount_minor, expectedCurrency: checkout.currency, verifiedMajor: v.amountMajor, verifiedCurrency: v.currency },
    });
  },

  // GRANT. The checkout is already marked paid by the engine.
  async onPaid(admin, checkout, v, ref, now) {
    const periodEnd = new Date(now.getTime() + 30 * DAY).toISOString();

    // ux_practice_subscription_workspace is a PLAIN unique index, so this on-conflict is a real target --
    // see migration 349's header for why the partial version it replaced was refused.
    await admin.from("practice_subscription").upsert({
      workspace_id: checkout.workspace_id, plan_code: checkout.plan_code, status: "active",
      current_period_start: now.toISOString(), current_period_end: periodEnd,
      last_checkout_id: checkout.id, updated_at: now.toISOString(),
    }, { onConflict: "workspace_id" });

    // The entitlement is what the shell already reads, so paid access arrives through the existing gate
    // rather than a second one nothing consults. CPR-PD-PROV-001 §12: the payment is billing-authoritative,
    // and the way it exercises that authority is by writing a period -- not by becoming a second gate.
    //
    // ⚠ THIS APPENDS. It used to be an UPDATE filtered only by workspace and a status list, which rewrote
    // plan_code, status and ends_at on EVERY period the practice had ever held -- a trial, an extension and
    // a lapse all resurrected as `active` with one shared end date, each still claiming its original start.
    // Harmless while a practice only ever had one row; a fabricated ledger the moment periods began to
    // append (§9). Never reached in production -- no plan is both active and priced, so no checkout can be
    // raised -- which is exactly why nothing caught it. See entitlement-writer.ts.
    const opened = await openAccessPeriod(admin, {
      workspaceId: checkout.workspace_id, planCode: checkout.plan_code,
      status: "active", startsAt: now.toISOString(), endsAt: periodEnd,
      // ADR-015: the ONLY source that carries billing authority.
      source: "payment",
    });
    // ⚠ THE MONEY IS ALREADY TAKEN BY THIS POINT, so a failure here must not look like a failed payment.
    // The checkout and the subscription rows above are written and correct; what is missing is the access
    // the payment bought, which a Director can grant from the practice's own record. Recorded loudly and
    // named in the audit event rather than swallowed.
    if (!opened.ok) {
      console.error(`[practice] paid checkout ${checkout.id} could not open an access period: ${opened.message}`);
      await audit(admin, {
        workspaceId: checkout.workspace_id, eventType: "practice.subscription_paid_without_access",
        payload: { txRef: ref, planCode: checkout.plan_code, code: opened.code, detail: opened.message },
      });
    }

    await audit(admin, {
      workspaceId: checkout.workspace_id, eventType: "practice.subscription_paid",
      payload: { txRef: ref, planCode: checkout.plan_code, channel: v.channel, periodEnd },
    });
  },
};
