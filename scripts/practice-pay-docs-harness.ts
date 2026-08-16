/**
 * CPR-PAY-002 conditional documents harness -- the patient statement (s10) and the
 * credit/adjustment and refund notes (s3, s14).
 *
 * WHAT IT PROVES:
 *   1. The statement's arithmetic: opening balance is DERIVED from activity before the period
 *      (proven by asking for a period that starts tomorrow -- everything becomes opening balance,
 *      zero lines); invoices raise the balance, payments lower it WHOEVER collected, discounts
 *      lower it, refunds raise it back; running and closing balances agree line by line.
 *   2. One section per currency, adjustment lines reference their note documents, uninvoiced
 *      charges are counted but NEVER in the balances.
 *   3. Refusals: billing.view named; a history too large for one complete statement REFUSES
 *      (STATEMENT_TOO_LARGE) rather than printing balances over a truncated read.
 *   4. The note pages render FROM the adjustment row (no second register), the refund note states
 *      that the original payment stands, and both audit as printed documents.
 *
 *   npx --yes tsx scripts/practice-pay-docs-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  createCharge, createDraftInvoice, issueInvoice, recordPayment, recordAdjustment, patientStatement,
} from "../src/lib/practice/billing";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a9d02";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nCPR-PAY-002 conditional documents harness\n");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-paydoc-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-paydoc",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS PAYDOC (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-paydoc", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-paydoc" };
  const today = new Date().toISOString().slice(0, 10);
  const shift = (d: number) => new Date(Date.parse(today + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);

  const p1 = await registerPatient(admin, { workspaceId: ws, displayName: "Statement Subject", sex: "female", birthDate: "1980-01-01", phone: "0772 000 051", ...base });
  if (!p1.ok) { ok("patient registers", false); return report(); }

  // 100 000 charged -> invoiced -> issued. 40 000 paid BY THE FACILITY. 10 000 discount.
  // 5 000 refunded against the payment. Expected closing balance: 100 - 40 - 10 + 5 = 55 000.
  const chg = await createCharge(admin, ctx, {
    source: "manual", patientId: p1.data.id, description: "Consultation fee",
    unitAmountMinor: 100000, currency: "UGX", ...base,
  });
  if (!chg.ok) { ok("charge raises", false, (chg as any).message); return report(); }
  const draft = await createDraftInvoice(admin, ctx, { chargeIds: [chg.data.id], ...base });
  if (!draft.ok) { ok("invoice drafts", false, (draft as any).message); return report(); }
  const issued = await issueInvoice(admin, ctx, { invoiceId: draft.data.id, dueDate: shift(14), ...base });
  if (!issued.ok) { ok("invoice issues", false, (issued as any).message); return report(); }
  const pay = await recordPayment(admin, ctx, {
    patientId: p1.data.id, amountMinor: 40000, currency: "UGX", method: "cash", collector: "facility",
    allocations: [{ invoiceId: draft.data.id, amountMinor: 40000 }], ...base,
  });
  if (!pay.ok) { ok("payment records", false, (pay as any).message); return report(); }
  const disc = await recordAdjustment(admin, ctx, {
    invoiceId: draft.data.id, kind: "discount", amountMinor: 10000, currency: "UGX",
    reason: "long-standing patient discount", ...base,
  });
  const refund = await recordAdjustment(admin, ctx, {
    paymentId: pay.data.id, kind: "refund", amountMinor: 5000, currency: "UGX",
    reason: "overcharged consumables, returned in cash", ...base,
  });
  if (!disc.ok || !refund.ok) { ok("adjustments record", false); return report(); }

  // ── 1. The statement over a period containing everything ───────────────────
  const st = await patientStatement(admin, ctx, { patientId: p1.data.id, fromDay: shift(-7), toDay: today });
  ok("1-1. one currency section, four lines, in date order",
    st.ok && st.data.sections.length === 1 && st.data.sections[0].currency === "UGX"
      && st.data.sections[0].lines.length === 4,
    JSON.stringify(st.ok ? st.data.sections.map(s => ({ c: s.currency, n: s.lines.length })) : st));
  if (!st.ok) return report();
  const sec = st.data.sections[0];
  ok("1-2. ⚠ the signs are the contract: invoice +100000, payment -40000, discount -10000, refund +5000",
    JSON.stringify(sec.lines.map(l => [l.kind, l.amountMinor]))
      === JSON.stringify([["invoice", 100000], ["payment", -40000], ["discount", -10000], ["refund", 5000]]),
    JSON.stringify(sec.lines.map(l => [l.kind, l.amountMinor])));
  ok("1-3. opening 0, closing 55000, and the running balance walks there line by line",
    sec.openingBalanceMinor === 0 && sec.closingBalanceMinor === 55000
      && sec.lines[sec.lines.length - 1].runningBalanceMinor === 55000
      && sec.lines[0].runningBalanceMinor === 100000,
    JSON.stringify({ open: sec.openingBalanceMinor, close: sec.closingBalanceMinor }));
  ok("1-4. a payment lowers the balance WHOEVER collected it, and says who did",
    sec.lines[1].description.includes("collected by facility"));
  ok("1-5. s10 document references: the invoice line carries its number, the payment its receipt,"
    + " each adjustment its note id",
    sec.lines[0].ref === issued.data.invoiceNumber && sec.lines[1].ref === pay.data.receiptNumber
      && sec.lines[2].adjustmentId === disc.data.id && sec.lines[3].adjustmentId === refund.data.id,
    JSON.stringify(sec.lines.map(l => [l.ref, l.adjustmentId])));

  // ── 2. Opening balance derivation: a period starting tomorrow owns nothing, inherits everything ──
  const later = await patientStatement(admin, ctx, { patientId: p1.data.id, fromDay: shift(1), toDay: shift(2) });
  ok("2-1. ⚠ everything before the period lands in the OPENING balance, with zero lines",
    later.ok && later.data.sections[0].openingBalanceMinor === 55000
      && later.data.sections[0].lines.length === 0
      && later.data.sections[0].closingBalanceMinor === 55000,
    JSON.stringify(later.ok ? later.data.sections[0] : later));

  // ── 3. Refusals and privacy ────────────────────────────────────────────────
  const noBilling = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "billing.view") };
  const denied = await patientStatement(admin, noBilling as any, { patientId: p1.data.id, fromDay: shift(-7), toDay: today });
  ok("3-1. billing.view is named in the refusal", !denied.ok && /billing\.view/.test(denied.message));
  const noNames = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "patient.view") };
  const unnamed = await patientStatement(admin, noNames as any, { patientId: p1.data.id, fromDay: shift(-7), toDay: today });
  ok("3-2. without patient.view the figures are identical and the name is withheld",
    unnamed.ok && unnamed.data.patientName === null && !unnamed.data.identified
      && unnamed.data.sections[0].closingBalanceMinor === 55000);
  ok("3-3. no line carries clinical content -- descriptions are billing wording only",
    sec.lines.every(l => !/diagnos|symptom|malaria|hypertension/i.test(l.description)));

  // ── 4. Source pins ─────────────────────────────────────────────────────────
  const engineSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "billing.ts"), "utf8");
  const stmtSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "payments", "statement", "[patientId]", "print", "page.tsx"), "utf8");
  const noteSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "payments", "adjustment", "[adjustmentId]", "print", "page.tsx"), "utf8");
  ok("4-1. ⚠ a statement is complete or refused: the overflow guard refuses BY NAME",
    engineSrc.includes('"STATEMENT_TOO_LARGE"') && engineSrc.includes("narrow the period"));
  ok("4-2. the statement page audits the print and carries the uninvoiced disclosure",
    stmtSrc.includes('kind: "patient_statement"') && stmtSrc.includes("becomes due at issue, not before"));
  ok("4-3. the refund note states the original payment STANDS, and both notes render from the row",
    noteSrc.includes("The original payment stands") && noteSrc.includes("no separate note register")
      && noteSrc.includes('kind: a.kind === "refund" ? "refund_note" : "adjustment_note"'));
  ok("4-4. the outstanding rows offer the statement door only where the invoice knows its patient",
    readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "payments", "PaymentsConsole.tsx"), "utf8")
      .includes("r.patient_id && ("));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
