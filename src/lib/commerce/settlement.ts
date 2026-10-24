/* eslint-disable @typescript-eslint/no-explicit-any */
import { type GatewayConfig, verifyTransaction, minorToMajor, type VerifiedTx } from "./gateway";

// ── THE HOLDINGS SETTLEMENT ENGINE: ONE WEBHOOK DELIVERY, THREE CHECKS ── lifted from Competen Practice ────────
//
// Moved unchanged from src/lib/practice/subscription.ts (applyWebhook), so Competen Individual settles payment
// through the same code Practice does. What differs per product is the ADAPTER: which tables hold the checkout
// and the delivery log, and what happens once a payment is proven (Practice: a subscription row and an access
// period; Individual: a membership and an experience entitlement). The checks themselves are not adaptable.
//
//   1. the caller has ALREADY verified the verif-hash header (the route does, before this runs)
//   2. verifyTransaction asks Flutterwave itself -- an unverifiable transaction is never paid
//   3. the verified amount and currency must match the checkout row WE wrote before the payer left
//
// IDEMPOTENCY IS THE DATABASE'S: each product's event table has a unique (provider, provider_event_id), so a
// second delivery's claim fails and is reported `duplicate`. Deciding "seen it?" in code loses that race.
//
// Every path returns a verdict, because "nothing happened" and "we refused" are different facts.

export type WebhookVerdict = "applied" | "duplicate" | "unverified" | "mismatched" | "unknown_ref" | "not_successful";
export type WebhookResult = { verdict: WebhookVerdict; detail?: string };

/** The checkout columns the engine reads. Both products' checkout tables carry them (migrations 349, 399). */
export type CheckoutRow = { id: string; amount_minor: number; currency: string; status: string; [k: string]: any };

export type SettlementAdapter = {
  /** e.g. practice_checkout_event / individual_checkout_event. */
  eventTable: string;
  /** e.g. practice_checkout / individual_checkout. */
  checkoutTable: string;
  /** The SELECT for the checkout row: the engine's columns plus whatever onPaid needs. */
  checkoutColumns: string;
  /** Record a verified payment for the wrong money (the checkout is already marked mismatched). */
  onMismatched(admin: any, checkout: CheckoutRow, v: Extract<VerifiedTx, { ok: true }>, ref: string): Promise<void>;
  /** The product's consequence of a proven payment (the checkout is already marked paid). */
  onPaid(admin: any, checkout: CheckoutRow, v: Extract<VerifiedTx, { ok: true }>, ref: string, now: Date): Promise<void>;
};

/** Pure: does the verified payment cover the checkout WE wrote? Paying more is accepted; less, or another currency, is not. */
export function paymentMatches(checkout: { amount_minor: number; currency: string }, v: { amountMajor: number; currency: string }) {
  const expectedMajor = minorToMajor(checkout.amount_minor, checkout.currency);
  const currencyOk = v.currency === String(checkout.currency).toUpperCase();
  // Compare in a fixed precision so 0.1 + 0.2 never decides whether somebody paid.
  const amountOk = expectedMajor !== null && Math.round(v.amountMajor * 1000) >= Math.round(expectedMajor * 1000);
  return { ok: currencyOk && amountOk, expectedMajor };
}

export async function settleWebhook(admin: any, cfg: GatewayConfig, ev: {
  providerEventId: string; providerTxId: string | null; txRef: string | null;
}, a: SettlementAdapter): Promise<WebhookResult> {
  // Claim the delivery. The unique (provider, provider_event_id) makes a retry's claim fail.
  const { data: claim, error: claimErr } = await admin.from(a.eventTable).insert({
    provider: "flutterwave", provider_event_id: ev.providerEventId, tx_ref: ev.txRef,
    verdict: "unverified", detail: "claimed, verification pending",
  }).select("id").single();
  if (claimErr) {
    if (/duplicate|unique/i.test(claimErr.message)) return { verdict: "duplicate" };
    return { verdict: "unverified", detail: `claim failed: ${claimErr.message}` };
  }

  const settle = async (verdict: WebhookVerdict, detail: string) => {
    await admin.from(a.eventTable).update({ verdict, detail: detail.slice(0, 500) }).eq("id", claim.id);
    return { verdict, detail };
  };

  if (!ev.providerTxId) return await settle("unverified", "no transaction id on the event");

  // Check 2: ask the gateway ourselves.
  const v = await verifyTransaction(cfg, ev.providerTxId);
  if (!v.ok) {
    const notSuccessful = /transaction status/i.test(v.reason);
    return await settle(notSuccessful ? "not_successful" : "unverified", v.reason);
  }

  const ref = v.txRef || ev.txRef;
  if (!ref) return await settle("unknown_ref", "verified transaction carries no tx_ref");

  const { data: checkout, error: coErr } = await admin.from(a.checkoutTable)
    .select(a.checkoutColumns).eq("tx_ref", ref).maybeSingle();
  if (coErr) return await settle("unverified", `checkout unreadable: ${coErr.message}`);
  if (!checkout) return await settle("unknown_ref", `no checkout for tx_ref ${ref}`);

  await admin.from(a.eventTable).update({ checkout_id: checkout.id }).eq("id", claim.id);

  if (checkout.status === "paid") return await settle("duplicate", "checkout already settled");

  // Check 3: the verified money against the row WE wrote.
  const match = paymentMatches(checkout, v);
  if (!match.ok) {
    await admin.from(a.checkoutTable).update({
      status: "mismatched", provider_tx_id: v.providerTxId, channel: v.channel,
      failure_reason: `expected ${match.expectedMajor} ${checkout.currency}, verified ${v.amountMajor} ${v.currency}`,
      updated_at: new Date().toISOString(),
    }).eq("id", checkout.id);
    await a.onMismatched(admin, checkout, v, ref);
    return await settle("mismatched", `expected ${match.expectedMajor} ${checkout.currency}, got ${v.amountMajor} ${v.currency}`);
  }

  const now = new Date();
  await admin.from(a.checkoutTable).update({
    status: "paid", provider_tx_id: v.providerTxId, channel: v.channel,
    settled_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", checkout.id);

  await a.onPaid(admin, checkout, v, ref, now);

  return await settle("applied", `paid via ${v.channel}`);
}
