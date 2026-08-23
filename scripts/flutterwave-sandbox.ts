/**
 * FLUTTERWAVE SANDBOX PROBE -- the one thing the unit tests cannot prove.
 *
 * subscription.test.ts stubs the gateway, so it proves what the ENGINE does with an answer. It cannot
 * prove that our REQUEST is one Flutterwave accepts, nor that our parsing matches the payload it really
 * returns. Those are the two halves this exercises, against the sandbox.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * FOUR LEGS, AND ONLY TWO OF THEM ARE THIS SCRIPT'S.
 *
 *   1. CREATE   this script. Proves auth, amount, currency, payment_options and request shape.
 *   2. PAY      YOURS. Open the link and complete it with a Flutterwave TEST instrument. An automated
 *               agent must not be typing payment details into a checkout form, test ones included.
 *   3. VERIFY   this script, given the transaction id. Runs the REAL applyWebhook, so the amount and
 *               currency comparison and the grant are exercised against a genuine provider payload.
 *   4. WEBHOOK  needs a publicly reachable URL. localhost receives no callback. Use a tunnel and point
 *               the dashboard at /api/v1/practice/billing/webhook/flutterwave.
 *
 * Leg 3 is the valuable one: it is where a field name we guessed wrong stops being a guess.
 *
 *   npx tsx scripts/flutterwave-sandbox.ts create <workspaceId> <planCode>
 *   npx tsx scripts/flutterwave-sandbox.ts verify <flutterwaveTransactionId>
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { startCheckout, applyWebhook, type WebhookVerdict } from "../src/lib/practice/subscription";
import { gatewayConfig } from "../src/lib/practice/subscription-gateway";

function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local */ }
}

async function main() {
  loadEnv();

  const need = ["FLW_SECRET_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\nCannot run. Missing: ${missing.join(", ")}`);
    console.error("FLW_SECRET_KEY comes from the Flutterwave dashboard in TEST mode.\n");
    return 1;
  }

  // ⚠ A LIVE KEY IS REFUSED. Flutterwave test secrets carry _TEST; a live one here would charge a real
  // card against a real account, from a script whose entire purpose is that nothing real happens.
  if (!/_TEST/i.test(process.env.FLW_SECRET_KEY!)) {
    console.error("\nREFUSED: FLW_SECRET_KEY does not look like a TEST key (no _TEST in it).");
    console.error("This script initiates real charges with a live key. Use the sandbox key.\n");
    return 1;
  }
  // Irrelevant to legs 1 and 3, but gatewayConfig() requires it. A placeholder that could never be
  // mistaken for a real secret.
  if (!process.env.FLW_SECRET_HASH) process.env.FLW_SECRET_HASH = "sandbox-probe-not-a-real-hash";

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const db: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const [cmd, a1, a2] = process.argv.slice(2);

  if (cmd === "create") {
    if (!a1 || !a2) { console.error("usage: create <workspaceId> <planCode>"); return 1; }
    const { data: plan } = await db.from("practice_plans").select("plan_code, active").eq("plan_code", a2).maybeSingle();
    if (!plan) { console.error(`no such plan: ${a2}`); return 1; }
    if (!plan.active) {
      console.error(`\nplan ${a2} is active=false, so startCheckout refuses it by design.`);
      console.error("Activate it (or seed an active sandbox plan) before running leg 1.\n");
      return 1;
    }

    const r = await startCheckout(db, gatewayConfig(), {
      workspaceId: a1, userId: "00000000-0000-0000-0000-000000000000",
      email: process.env.SANDBOX_EMAIL ?? "sandbox@example.com", name: "Sandbox Probe",
      planCode: a2, correlationId: "flw-sandbox",
    });

    if (!r.ok) { console.error(`\nFAILED at leg 1: ${r.code}${r.detail ? ` -- ${r.detail}` : ""}\n`); return 1; }
    console.log(`\nLEG 1 PASSED. Flutterwave accepted our request shape.`);
    console.log(`  tx_ref: ${r.txRef}`);
    console.log(`\nLEG 2 IS YOURS. Open this and pay with a Flutterwave TEST instrument:\n\n  ${r.link}\n`);
    console.log(`Then take the transaction id from the dashboard and run:`);
    console.log(`  npx tsx scripts/flutterwave-sandbox.ts verify <transactionId>\n`);
    return 0;
  }

  if (cmd === "verify") {
    if (!a1) { console.error("usage: verify <flutterwaveTransactionId>"); return 1; }
    // The REAL applyWebhook, with a real transaction id. Everything the stubs could not reach runs here:
    // the verify call, the field names in Flutterwave's payload, the amount and currency comparison
    // against our own recorded row, and the grant.
    const res = await applyWebhook(db, gatewayConfig()!, {
      providerEventId: `sandbox-${a1}`, providerTxId: a1, txRef: null,
    });
    console.log(`\nverdict: ${res.verdict}${res.detail ? ` -- ${res.detail}` : ""}`);
    const map: Record<WebhookVerdict, string> = {
      applied: "LEG 3 PASSED. Verified, matched our recorded amount and currency, and the subscription was granted.",
      mismatched: "Verified, but the amount or currency did not match the checkout we recorded. Correct behaviour if you paid a different amount.",
      unknown_ref: "Verified, but no checkout of ours carries that tx_ref. Did leg 1 run against this database?",
      not_successful: "The transaction is real but not successful. Complete the payment first.",
      unverified: "Flutterwave could not verify it. Check the id, and that the key matches the environment the payment was made in.",
      duplicate: "Already applied -- idempotency working. Re-running proves nothing further.",
    };
    console.log(`${map[res.verdict] ?? ""}\n`);
    return res.verdict === "applied" || res.verdict === "duplicate" ? 0 : 1;
  }

  console.error("usage: npx tsx scripts/flutterwave-sandbox.ts create <workspaceId> <planCode> | verify <transactionId>");
  return 1;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
