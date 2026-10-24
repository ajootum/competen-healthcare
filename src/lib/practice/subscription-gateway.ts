// Competen billing the PRACTITIONER (Flutterwave, mobile money first).
//
// ⚠ THE GATEWAY NOW LIVES AT HOLDINGS LEVEL (src/lib/commerce/gateway.ts), moved there unchanged so Competen
// Individual can take payment through the same three checks. This file re-exports it, and keeps the three
// things that are Practice's own: its transaction prefix (`cpr-`), its return path and its checkout copy.
// Every Practice caller imports from here exactly as before, and behaves exactly as before -- the Practice
// subscription tests (src/lib/practice/subscription.test.ts) are the proof.
//
// THE ONE RULE, still: NOTHING THE GATEWAY SENDS US IS EVIDENCE OF PAYMENT. Payment is established by three
// independent checks -- verif-hash, our own verify call, and the verified amount and currency against the row
// WE wrote -- documented in full in the Holdings file.

import { createHostedCheckout as holdingsCheckout, newTxRefWith, type CheckoutLink, type GatewayConfig } from "@/lib/commerce/gateway";

export {
  minorToMajor, majorToMinor, gatewayConfig, verifHashMatches, verifyTransaction, normaliseChannel,
  paymentOptionsFor, currencyExponent,
} from "@/lib/commerce/gateway";
export type { GatewayConfig, VerifiedTx, CheckoutLink } from "@/lib/commerce/gateway";

/** Practice's transaction references, as before: `cpr-<uuid>`. */
export const PRACTICE_TX_PREFIX = "cpr";
export const newTxRef = () => newTxRefWith(PRACTICE_TX_PREFIX);

/** Hand Flutterwave the charge WE decided on, and get back a hosted checkout link -- with Practice's copy and return path. */
export function createHostedCheckout(cfg: GatewayConfig, args: {
  txRef: string; amountMinor: number; currency: string; email: string; name: string | null;
}): Promise<CheckoutLink> {
  return holdingsCheckout(cfg, {
    ...args, redirectPath: "/practice/settings/billing/return", title: "Competen Practice", description: "Practice subscription",
  });
}
