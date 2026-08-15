/**
 * Practice billing harness -- CPR-PAY-001/002 Phase 1 over migration 303.
 *
 * WHAT IT PROVES:
 *   1. COLLECTED IS NOT RECEIVED: a facility-collected payment lands in collectedByOthers and NEVER in
 *      receivedByPractitioner -- the one rule the whole module exists for, asserted on the live engine.
 *   2. Charge idempotency is structural (CHARGE_EXISTS by index, not by read-then-write).
 *   3. One live invoice per charge; VOID frees the charge for reissue and its number is never reused.
 *   4. Numbering: CP-INV-YYYY-NNNNN from the atomic allocator, sequence proven to increment.
 *   5. Balances are DERIVED: UNPAID -> PART_PAID -> PAID -> (due date passed) OVERDUE, all computed,
 *      with OVERDUE outranking PART_PAID.
 *   6. Allocations reconcile to the payment or nothing is written; overpayment refused by name.
 *   7. Refunds cannot exceed the payment; adjustments are rows with reasons, never edits.
 *   8. NO RATES ANYWHERE: the payloads are scanned for percent-shaped output.
 *   9. Cross-tenant isolation, non-vacuously.
 *  10. The surfaces: nav, setup card, calendar refusal, encounter door, patient panel -- source-pinned.
 *
 *   npx --yes tsx scripts/practice-billing-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  listFees, saveFee, saveFeeOverride, createCharge, createDraftInvoice, issueInvoice, voidInvoice,
  recordPayment, recordAdjustment, paymentsOverview, listInvoices, getInvoice, outstandingBalances,
  patientFinancial, uninvoicedCharges,
} from "../src/lib/practice/billing";
import {
  BILLING_CAPABILITIES, formatMinor, formatBillingNumber, deriveInvoiceStatus, ageBucket,
  INVOICE_NUMBER_RE, RECEIPT_NUMBER_RE,
} from "../src/lib/practice/billing-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000b111a";
const OTHER = "00000000-0000-4000-8000-0000000b111b";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const skip = (label: string, why: string) => console.log(`  SKIP  ${label} -- ${why}`);

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-bill-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-bill",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-bill", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice billing harness (CPR-PAY-001/002 Phase 1, migration 303)\n");
  await cleanup();

  // ── 0. The pure arithmetic, before any database ──────────────────────────
  ok("P-1. UGX formats with no decimals and grouped thousands",
    formatMinor(12450000, "UGX") === "UGX 12,450,000", formatMinor(12450000, "UGX"));
  ok("P-1b. a two-exponent currency keeps its minor units exact",
    formatMinor(150050, "USD") === "USD 1,500.50", formatMinor(150050, "USD"));
  ok("P-1c. an unsafe integer is REFUSED as unformattable, never rounded",
    formatMinor(Number.MAX_SAFE_INTEGER + 2, "UGX").includes("unformattable"));
  ok("P-2. invoice and receipt numbers format to the pinned shapes",
    formatBillingNumber("invoice", 2026, 7) === "CP-INV-2026-00007"
      && INVOICE_NUMBER_RE.test(formatBillingNumber("invoice", 2026, 7))
      && RECEIPT_NUMBER_RE.test(formatBillingNumber("receipt", 2026, 123456)),
    formatBillingNumber("receipt", 2026, 123456));
  ok("P-3. derived status walks UNPAID -> PART_PAID -> PAID",
    deriveInvoiceStatus({ status: "ISSUED", totalMinor: 100, allocatedMinor: 0, dueDate: null, today: "2026-08-15" }) === "UNPAID"
      && deriveInvoiceStatus({ status: "ISSUED", totalMinor: 100, allocatedMinor: 40, dueDate: null, today: "2026-08-15" }) === "PART_PAID"
      && deriveInvoiceStatus({ status: "ISSUED", totalMinor: 100, allocatedMinor: 100, dueDate: null, today: "2026-08-15" }) === "PAID");
  ok("P-3b. ⚠ OVERDUE outranks PART_PAID -- a half-paid late invoice is a LATE invoice",
    deriveInvoiceStatus({ status: "ISSUED", totalMinor: 100, allocatedMinor: 40, dueDate: "2026-08-01", today: "2026-08-15" }) === "OVERDUE");
  ok("P-3c. and a PAID invoice past its due date is simply paid",
    deriveInvoiceStatus({ status: "ISSUED", totalMinor: 100, allocatedMinor: 100, dueDate: "2026-08-01", today: "2026-08-15" }) === "PAID");
  ok("P-4. aging buckets are day counts, not rates",
    ageBucket("2026-08-14", "2026-08-15") === "0-7" && ageBucket("2026-05-01", "2026-08-15") === "90+");

  // ── 0b. Every billing capability exists in the live seed ─────────────────
  const { data: capRows } = await admin.from("practice_role_capabilities")
    .select("capability_code").in("capability_code", [...BILLING_CAPABILITIES]);
  const seeded = new Set(((capRows ?? []) as any[]).map(r => r.capability_code));
  ok("0. every billing capability is seeded live (the invented-code class, blocked)",
    BILLING_CAPABILITIES.every(c => seeded.has(c)),
    BILLING_CAPABILITIES.filter(c => !seeded.has(c)).join(", "));

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const wsA = await provision(OWNER, "HARNESS Billing A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Billing B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("contexts resolve", false); return report(); }
  const base = { actorId: OWNER, correlationId: "harness-bill" };

  ok("0c. the resolved practitioner context HOLDS the billing capabilities (303's grant is real)",
    BILLING_CAPABILITIES.every(c => a.ctx.capabilities.includes(c)),
    BILLING_CAPABILITIES.filter(c => !a.ctx.capabilities.includes(c)).join(", "));

  const pat = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okot Sarah", sex: "female", birthDate: "1977-03-20",
    phone: "0772 123 456", ...base,
  });
  if (!pat.ok) { ok("patient registers", false, pat.message); return report(); }
  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: pat.data.id, pathway: "new_walk_in", reasonForVisit: "Follow-up", ...base,
  });
  if (!enc.ok) { ok("encounter launches", false, enc.message); return report(); }
  const { data: loc } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Harness Clinic", type: "clinic" }).select("id").single();

  // ── 1. Fees and the per-location override ────────────────────────────────
  const fee = await saveFee(admin, a.ctx, {
    name: "New consultation", serviceType: "consultation", amountMinor: 100000, currency: "UGX", ...base,
  });
  ok("1-1. a fee saves", fee.ok, fee.ok ? "" : (fee as any).message);
  if (!fee.ok) return report();
  const ov = await saveFeeOverride(admin, a.ctx, {
    feeId: fee.data.id, locationId: loc!.id, amountMinor: 150000, ...base,
  });
  ok("1-2. a location override saves", ov.ok, ov.ok ? "" : (ov as any).message);
  const feesPanel = await listFees(admin, a.ctx);
  ok("1-3. the catalogue lists the fee WITH its override",
    feesPanel.items.some(f => f.id === (fee as any).data.id && f.overrides.length === 1));

  // ── 2. Charges: fee-derived, override-applied, snapshot photographed ─────
  const chargeAtLoc = await createCharge(admin, a.ctx, {
    source: "consultation", sourceRef: enc.data.id, encounterId: enc.data.id,
    serviceFeeId: fee.data.id, locationId: loc!.id, ...base,
  });
  ok("2-1. a consultation charge derives from the fee, with the LOCATION override applied",
    chargeAtLoc.ok && chargeAtLoc.data.amountMinor === 150000,
    chargeAtLoc.ok ? String(chargeAtLoc.data.amountMinor) : (chargeAtLoc as any).message);
  if (!chargeAtLoc.ok) return report();
  const { data: snapRow } = await admin.from("practice_charge")
    .select("fee_snapshot").eq("id", chargeAtLoc.data.id).single();
  ok("2-1b. the fee decision is PHOTOGRAPHED: default and applied both on the row",
    snapRow?.fee_snapshot?.defaultMinor === 100000 && snapRow?.fee_snapshot?.appliedMinor === 150000,
    JSON.stringify(snapRow?.fee_snapshot));

  const doubled = await createCharge(admin, a.ctx, {
    source: "consultation", sourceRef: enc.data.id, encounterId: enc.data.id,
    serviceFeeId: fee.data.id, ...base,
  });
  ok("2-2. ⚠ THE SAME CONSULTATION CANNOT BE CHARGED TWICE -- refused by the INDEX, by name",
    !doubled.ok && doubled.code === "CHARGE_EXISTS", doubled.ok ? "charged twice" : String(doubled.code));

  const manual = await createCharge(admin, a.ctx, {
    source: "manual", patientId: pat.data.id, description: "Medical report letter",
    unitAmountMinor: 50000, currency: "UGX", ...base,
  });
  ok("2-3. a manual charge records with description and amount", manual.ok,
    manual.ok ? "" : (manual as any).message);
  if (!manual.ok) return report();

  // ── 3. Draft: currency discipline and the one-live-invoice rule ──────────
  const usdCharge = await createCharge(admin, a.ctx, {
    source: "manual", patientId: pat.data.id, description: "Teleconsult (foreign payer)",
    unitAmountMinor: 5000, currency: "USD", ...base,
  });
  const mixed = usdCharge.ok ? await createDraftInvoice(admin, a.ctx, {
    chargeIds: [chargeAtLoc.data.id, usdCharge.data.id], ...base,
  }) : null;
  ok("3-1. one invoice, one currency -- a mixed draft is refused by name",
    !!mixed && !mixed.ok && (mixed as any).code === "MIXED_CURRENCIES",
    mixed && !mixed.ok ? String((mixed as any).code) : "drafted");

  const draft = await createDraftInvoice(admin, a.ctx, {
    chargeIds: [chargeAtLoc.data.id, manual.data.id], dueDate: "2026-09-15", ...base,
  });
  ok("3-2. a draft composes two charges and sums them exactly",
    draft.ok && draft.data.totalMinor === 200000, draft.ok ? String(draft.data.totalMinor) : (draft as any).message);
  if (!draft.ok) return report();

  const second = await createDraftInvoice(admin, a.ctx, { chargeIds: [manual.data.id], ...base });
  ok("3-3. a charge on a LIVE invoice cannot join a second one",
    !second.ok && second.code === "CHARGE_ALREADY_INVOICED", second.ok ? "joined twice" : String(second.code));

  // ── 4. Issue: number, snapshot, derived state ────────────────────────────
  const issued = await issueInvoice(admin, a.ctx, { invoiceId: draft.data.id, ...base });
  ok("4-1. issuing assigns a number in the pinned format",
    issued.ok && INVOICE_NUMBER_RE.test(issued.data.invoiceNumber),
    issued.ok ? issued.data.invoiceNumber : (issued as any).message);
  if (!issued.ok) return report();
  const detail = await getInvoice(admin, a.ctx, draft.data.id);
  ok("4-2. the issued snapshot carries items, totals and the payer -- the document the PDF renders from",
    detail?.issued_snapshot?.items?.length === 2
      && detail?.issued_snapshot?.totalMinor === 200000
      && detail?.issued_snapshot?.invoiceNumber === issued.data.invoiceNumber,
    JSON.stringify({ items: detail?.issued_snapshot?.items?.length, total: detail?.issued_snapshot?.totalMinor }));
  ok("4-3. an issued, unpaid invoice derives UNPAID with its full balance",
    detail?.derivedStatus === "UNPAID" && detail?.balanceMinor === 200000,
    JSON.stringify({ s: detail?.derivedStatus, b: detail?.balanceMinor }));

  // ── 5. Payments: reconcile-or-nothing, the collector rule, part payment ──
  const mismatch = await recordPayment(admin, a.ctx, {
    patientId: pat.data.id, amountMinor: 80000, currency: "UGX", method: "cash",
    allocations: [{ invoiceId: draft.data.id, amountMinor: 50000 }], ...base,
  });
  ok("5-1. allocations must reconcile to the payment -- a mismatch writes NOTHING",
    !mismatch.ok && mismatch.code === "ALLOCATION_MISMATCH", mismatch.ok ? "recorded" : String(mismatch.code));

  const over = await recordPayment(admin, a.ctx, {
    patientId: pat.data.id, amountMinor: 250000, currency: "UGX", method: "cash",
    allocations: [{ invoiceId: draft.data.id, amountMinor: 250000 }], ...base,
  });
  ok("5-2. overpayment is refused by name -- a surplus needs an explicit rule, not a silent credit",
    !over.ok && over.code === "OVERPAYMENT", over.ok ? "recorded" : String(over.code));

  const partByFacility = await recordPayment(admin, a.ctx, {
    patientId: pat.data.id, amountMinor: 120000, currency: "UGX", method: "cash", collector: "facility",
    allocations: [{ invoiceId: draft.data.id, amountMinor: 120000 }], ...base,
  });
  ok("5-3. a part payment records with a receipt in the pinned format",
    partByFacility.ok && RECEIPT_NUMBER_RE.test(partByFacility.data.receiptNumber),
    partByFacility.ok ? partByFacility.data.receiptNumber : (partByFacility as any).message);
  if (!partByFacility.ok) return report();

  const afterPart = await getInvoice(admin, a.ctx, draft.data.id);
  ok("5-4. the invoice now derives PART_PAID with the exact remaining balance",
    afterPart?.derivedStatus === "PART_PAID" && afterPart?.balanceMinor === 80000,
    JSON.stringify({ s: afterPart?.derivedStatus, b: afterPart?.balanceMinor }));

  const overview1 = await paymentsOverview(admin, a.ctx);
  const ugx1 = overview1.byCurrency.find((c: any) => c.currency === "UGX");
  ok("5-5. ⚠ COLLECTED IS NOT RECEIVED: the facility-collected 120,000 is NOT in receivedByPractitioner",
    !!ugx1 && ugx1.collectedByOthersMinor === 120000 && ugx1.receivedByPractitionerMinor === 0,
    JSON.stringify({ others: ugx1?.collectedByOthersMinor, received: ugx1?.receivedByPractitionerMinor }));

  const restByMe = await recordPayment(admin, a.ctx, {
    patientId: pat.data.id, amountMinor: 80000, currency: "UGX", method: "mobile_money", collector: "practitioner",
    allocations: [{ invoiceId: draft.data.id, amountMinor: 80000 }], ...base,
  });
  ok("5-6. the balance is settled by a second, practitioner-collected payment", restByMe.ok,
    restByMe.ok ? "" : (restByMe as any).message);
  const afterFull = await getInvoice(admin, a.ctx, draft.data.id);
  ok("5-7. and the invoice derives PAID with a zero balance",
    afterFull?.derivedStatus === "PAID" && afterFull?.balanceMinor === 0,
    JSON.stringify({ s: afterFull?.derivedStatus, b: afterFull?.balanceMinor }));
  const overview2 = await paymentsOverview(admin, a.ctx);
  const ugx2 = overview2.byCurrency.find((c: any) => c.currency === "UGX");
  ok("5-8. received-by-practitioner now holds EXACTLY the 80,000 collected directly, nothing more",
    !!ugx2 && ugx2.receivedByPractitionerMinor === 80000 && ugx2.collectedByOthersMinor === 120000,
    JSON.stringify({ received: ugx2?.receivedByPractitionerMinor, others: ugx2?.collectedByOthersMinor }));

  // ── 6. Overdue derives from the calendar, never a stored flag ────────────
  //
  // ⚠ THE FIRST DRAFT OF THIS SECTION ISSUED AN INVOICE ALREADY PAST ITS DUE DATE, and migration
  // 303's own CHECK refused it -- correctly. Overdue is something TIME does to an invoice, not a
  // state you issue into; a due date before the issue date is a typo, the same rule the portfolio
  // applies to certificates that expire before they were awarded. So the live half asserts the
  // REFUSAL, and the derivation to OVERDUE is proven where time can be supplied: P-3b, against the
  // one pure function every screen reads.
  const lateCharge = await createCharge(admin, a.ctx, {
    source: "manual", patientId: pat.data.id, description: "Old letter", unitAmountMinor: 30000, currency: "UGX", ...base,
  });
  const lateDraft = lateCharge.ok ? await createDraftInvoice(admin, a.ctx, { chargeIds: [lateCharge.data.id], ...base }) : null;
  if (lateDraft?.ok) {
    const backdated = await issueInvoice(admin, a.ctx, { invoiceId: lateDraft.data.id, dueDate: "2026-01-01", ...base });
    ok("6-1. issuing an invoice ALREADY overdue is refused by the schema -- a due date before issue is a typo",
      !backdated.ok, backdated.ok ? "was issued overdue" : String((backdated as any).code));
    const properly = await issueInvoice(admin, a.ctx, { invoiceId: lateDraft.data.id, dueDate: "2027-01-01", ...base });
    ok("6-2. CONTROL: the same draft issues cleanly with a future due date", properly.ok,
      properly.ok ? "" : (properly as any).message);

    // ── 7. Void frees the charges; the number is never reused ──────────────
    if (properly.ok) {
      const number = properly.data.invoiceNumber;
      const voided = await voidInvoice(admin, a.ctx, { invoiceId: lateDraft.data.id, reason: "harness: wrong patient", ...base });
      ok("7-1. an issued invoice voids with a reason", voided.ok, voided.ok ? "" : (voided as any).message);
      const freed = await uninvoicedCharges(admin, a.ctx, {});
      ok("7-2. ⚠ VOID FREES THE CHARGE: it is uninvoiced again and can be reinvoiced",
        freed.items.some((c: any) => c.id === (lateCharge as any).data.id));
      const redraft = await createDraftInvoice(admin, a.ctx, { chargeIds: [(lateCharge as any).data.id], ...base });
      const reissued = redraft.ok ? await issueInvoice(admin, a.ctx, { invoiceId: redraft.data.id, ...base }) : null;
      ok("7-3. and the reissue takes a NEW number -- the voided one is never reused",
        !!reissued && reissued.ok && reissued.data.invoiceNumber !== number,
        reissued?.ok ? `${number} -> ${reissued.data.invoiceNumber}` : "reissue failed");
    } else skip("7-1..7-3. void and reissue", "the control issue failed");
  } else skip("6-1..7-3. overdue and void", "the fixture draft failed");

  // ── 8. Refunds bounded by the payment ─────────────────────────────────────
  const bigRefund = await recordAdjustment(admin, a.ctx, {
    paymentId: partByFacility.data.id, kind: "refund", amountMinor: 500000, currency: "UGX",
    reason: "harness: too big", ...base,
  });
  ok("8-1. a refund larger than the payment is refused by name",
    !bigRefund.ok && bigRefund.code === "REFUND_EXCEEDS_PAYMENT", bigRefund.ok ? "recorded" : String(bigRefund.code));
  const refund = await recordAdjustment(admin, a.ctx, {
    paymentId: partByFacility.data.id, kind: "refund", amountMinor: 20000, currency: "UGX",
    reason: "harness: partial refund agreed", ...base,
  });
  ok("8-2. CONTROL: a bounded refund records as a ROW with its reason", refund.ok,
    refund.ok ? "" : (refund as any).message);

  // ── 9. The patient's compact money picture ───────────────────────────────
  const fin = await patientFinancial(admin, a.ctx, pat.data.id);
  ok("9-1. patientFinancial carries balances, charges, invoices and payments",
    fin.permitted && !fin.unavailable
      && (fin as any).charges.length >= 3 && (fin as any).invoices.length >= 2 && (fin as any).payments.length >= 2,
    JSON.stringify({ c: (fin as any).charges?.length, i: (fin as any).invoices?.length, p: (fin as any).payments?.length }));

  // ── 10. NO RATES, scanned rather than promised ────────────────────────────
  const everything = JSON.stringify({ overview2, fin, out: await outstandingBalances(admin, a.ctx) });
  ok("10-1. ⚠ NO PERCENT-SHAPED OUTPUT in any billing payload",
    !/\d+(\.\d+)?%/.test(everything) && !/"(rate|successRate|collectionRate|percent\w*)"/i.test(everything));

  // ── 11. Isolation ─────────────────────────────────────────────────────────
  ok("11-1. another practice cannot read this invoice",
    (await getInvoice(admin, b.ctx, draft.data.id)) === null);
  const bOverview = await paymentsOverview(admin, b.ctx);
  ok("11-2. B's money picture is empty while A's is not (non-vacuous)",
    bOverview.byCurrency.length === 0 && overview2.byCurrency.length > 0);

  // ── 12. The surfaces, source-pinned ───────────────────────────────────────
  const navSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "navigation.ts"), "utf8");
  ok("12-1. Payments is a PRIMARY nav item in the PRACTICE section, gated on billing.view",
    /href: "\/practice\/payments",.*capability: "billing\.view".*primary: true/.test(navSrc)
      && navSrc.includes('{ label: "Practice", hrefs: ["/practice/payments"] }'));
  const setupSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "setup.ts"), "utf8");
  ok("12-2. the setup card's months-old refusal is GONE and the card opens the fee catalogue",
    setupSrc.includes('href: "/practice/payments?tab=fees"')
      && !setupSrc.includes("There is no billing module."));
  const calSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "calendar.ts"), "utf8");
  ok("12-3. the calendar still refuses a balance tile, for the NEW true reason (one money surface)",
    calSrc.includes("Billing exists now") && calSrc.includes("The planner plans"));
  const encSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "encounters", "[encounterId]", "EncounterConsole.tsx"), "utf8");
  ok("12-4. s13's handoff: a completed encounter offers Charges & payment, a door and never a gate",
    encSrc.includes('props.status === "COMPLETED" || props.status === "SIGNED"')
      && encSrc.includes("/practice/payments?encounter="));
  const patientSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "patients", "[patientId]", "page.tsx"), "utf8");
  ok("12-5. s12/s18: the patient money panel loads ONLY behind billing.view",
    patientSrc.includes('hasCapability(shell.ctx, "billing.view")') && patientSrc.includes("patientFinancial"));
  const consoleSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "payments", "PaymentsConsole.tsx"), "utf8");
  ok("12-6. the console renders NO percentage and names the collected-vs-received rule",
    !/\d+%|% of/.test(consoleSrc) && consoleSrc.includes("not yet yours"));
  ok("12-7. Settlements is NOT offered as a tab -- Phase 2 is not dressed as built",
    !consoleSrc.includes('"settlements"') && consoleSrc.includes("Phase 2"));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
