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
  saveFacilityEntitlement, facilityReceivables, recordSettlement, listSettlements,
} from "../src/lib/practice/billing";
import {
  BILLING_CAPABILITIES, formatMinor, formatBillingNumber, deriveInvoiceStatus, ageBucket,
  INVOICE_NUMBER_RE, RECEIPT_NUMBER_RE, SETTLEMENT_NUMBER_RE, entitlementShareMinor,
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
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
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

  // ══ PHASE 2: FACILITY SETTLEMENTS (migration 304) ═════════════════════════════════════════════
  //
  // The rule COMPLETES here: money a facility collected finally reaches "received" -- but only
  // through a settlement row, never by assumption, and the difference between your share and what
  // arrived stays visible.
  ok("SET-P1. the share arithmetic FLOORS -- a receivable is never overstated by rounding",
    entitlementShareMinor({ kind: "percent", percent_bp: 6000 }, 100001) === 60000
      && entitlementShareMinor({ kind: "fixed_per_payment", fixed_minor: 70000 }, 50000) === 50000
      && entitlementShareMinor({ kind: "manual" }, 100000) === null
      && entitlementShareMinor(null, 100000) === null,
    String(entitlementShareMinor({ kind: "percent", percent_bp: 6000 }, 100001)));

  const ent = await saveFacilityEntitlement(admin, a.ctx, {
    locationId: loc!.id, kind: "percent", percentBp: 6000, ...base,
  });
  ok("SET-1. a 60-of-every-100 share saves for the clinic", ent.ok, ent.ok ? "" : (ent as any).message);

  // A fresh facility-collected payment AT that location, so the rule has something to apply to.
  const setCharge = await createCharge(admin, a.ctx, {
    source: "manual", patientId: pat.data.id, description: "Clinic procedure (facility billed)",
    unitAmountMinor: 100000, currency: "UGX", locationId: loc!.id, ...base,
  });
  const setDraft = setCharge.ok ? await createDraftInvoice(admin, a.ctx, { chargeIds: [setCharge.data.id], ...base }) : null;
  const setIssued = setDraft?.ok ? await issueInvoice(admin, a.ctx, { invoiceId: setDraft.data.id, ...base }) : null;
  const facPay = setIssued?.ok ? await recordPayment(admin, a.ctx, {
    patientId: pat.data.id, amountMinor: 100000, currency: "UGX", method: "cash", collector: "facility",
    locationId: loc!.id, allocations: [{ invoiceId: (setDraft as any).data.id, amountMinor: 100000 }], ...base,
  }) : null;
  ok("SET-2-fixture. a facility-collected payment exists at the clinic", !!facPay && facPay.ok,
    facPay && !facPay.ok ? (facPay as any).message : "");
  if (!facPay?.ok) return report();
  const { data: facPayRow } = await admin.from("practice_payment")
    .select("id").eq("workspace_id", wsA).eq("collector", "facility").eq("location_id", loc!.id).single();

  const recv = await facilityReceivables(admin, a.ctx);
  const clinicGroup = recv.facilities.find((f: any) => f.locationId === loc!.id && f.currency === "UGX");
  const nowhereGroup = recv.facilities.find((f: any) => f.locationId === null && f.currency === "UGX");
  ok("SET-2. the receivable derives: 100,000 collected at the clinic, your share 60,000 under the rule",
    clinicGroup?.collectedMinor === 100000 && clinicGroup?.entitlementMinor === 60000 && clinicGroup?.needsDecision === 0,
    JSON.stringify({ c: clinicGroup?.collectedMinor, e: clinicGroup?.entitlementMinor }));
  ok("SET-2b. ⚠ a collection with NO rule is COUNTED AS NEEDING A DECISION, never guessed into the sum",
    nowhereGroup?.collectedMinor === 120000 && nowhereGroup?.entitlementMinor === 0 && nowhereGroup?.needsDecision === 1,
    JSON.stringify({ c: nowhereGroup?.collectedMinor, n: nowhereGroup?.needsDecision }));

  const notFacility = await recordSettlement(admin, a.ctx, {
    locationId: loc!.id, periodFrom: "2026-08-01", periodTo: "2026-08-15", currency: "UGX",
    receivedMinor: 10000, items: [{ paymentId: restByMe.ok ? restByMe.data.id : "" }], ...base,
  });
  ok("SET-3. a payment YOU collected cannot be settled -- there is nothing to transfer",
    !notFacility.ok && notFacility.code === "NOT_FACILITY_COLLECTED",
    notFacility.ok ? "settled" : String(notFacility.code));

  const settled = await recordSettlement(admin, a.ctx, {
    locationId: loc!.id, periodFrom: "2026-08-01", periodTo: "2026-08-15", currency: "UGX",
    receivedMinor: 55000, reference: "MTN-4471", items: [{ paymentId: facPayRow!.id }], ...base,
  });
  ok("SET-4. the settlement records with a number in the pinned format",
    settled.ok && SETTLEMENT_NUMBER_RE.test(settled.data.settlementNumber),
    settled.ok ? settled.data.settlementNumber : (settled as any).message);
  if (!settled.ok) return report();

  const setList = await listSettlements(admin, a.ctx, {});
  const setRow = setList.items.find((s: any) => s.id === settled.data.id);
  ok("SET-5. ⚠ THE DISCREPANCY STAYS VISIBLE: share 60,000, received 55,000, difference -5,000 on the row",
    setRow?.expectedMinor === 60000 && setRow?.received_minor === 55000 && setRow?.differenceMinor === -5000,
    JSON.stringify({ e: setRow?.expectedMinor, r: setRow?.received_minor, d: setRow?.differenceMinor }));

  const twiceSettled = await recordSettlement(admin, a.ctx, {
    locationId: loc!.id, periodFrom: "2026-08-01", periodTo: "2026-08-15", currency: "UGX",
    receivedMinor: 5000, items: [{ paymentId: facPayRow!.id }], ...base,
  });
  ok("SET-6. a payment settles ONCE -- the second claim is refused by name",
    !twiceSettled.ok && twiceSettled.code === "ALREADY_SETTLED",
    twiceSettled.ok ? "settled twice" : String(twiceSettled.code));

  const overview3 = await paymentsOverview(admin, a.ctx);
  const ugx3 = overview3.byCurrency.find((c: any) => c.currency === "UGX");
  ok("SET-7. ⚠ THE RULE COMPLETES: received = 80,000 you collected + 55,000 settled, and NOTHING else",
    !!ugx3 && ugx3.receivedByPractitionerMinor === 135000
      && ugx3.collectedDirectlyMinor === 80000 && ugx3.settledToPractitionerMinor === 55000,
    JSON.stringify({ r: ugx3?.receivedByPractitionerMinor, d: ugx3?.collectedDirectlyMinor, s: ugx3?.settledToPractitionerMinor }));
  ok("SET-7b. the settled payment leaves the receivable; the no-rule collection still waits for its decision",
    !!ugx3 && ugx3.outstandingSettlementMinor === 0 && ugx3.settlementNeedsDecision === 1,
    JSON.stringify({ o: ugx3?.outstandingSettlementMinor, n: ugx3?.settlementNeedsDecision }));

  const noDecision = await recordSettlement(admin, a.ctx, {
    locationId: loc!.id, periodFrom: "2026-08-01", periodTo: "2026-08-15", currency: "UGX",
    receivedMinor: 50000, items: [{ paymentId: partByFacility.data.id }], ...base,
  });
  ok("SET-8. a no-rule collection without an explicit share is refused -- a guess is not a settlement",
    !noDecision.ok && noDecision.code === "ENTITLEMENT_NEEDS_DECISION",
    noDecision.ok ? "settled" : String(noDecision.code));
  const decided = await recordSettlement(admin, a.ctx, {
    locationId: loc!.id, periodFrom: "2026-08-01", periodTo: "2026-08-15", currency: "UGX",
    receivedMinor: 50000, items: [{ paymentId: partByFacility.data.id, entitlementMinor: 50000 }], ...base,
  });
  ok("SET-8b. CONTROL: the same settlement with the share said out loud records", decided.ok,
    decided.ok ? "" : (decided as any).message);

  const everything2 = JSON.stringify({
    overview3, recv, setList: await listSettlements(admin, a.ctx, {}),
  });
  // The needle scans KEYS (quote-colon), not values -- its first two runs caught the legitimate
  // percentBp config field and then the literal enum value "percent" (a configured KIND, not a rate).
  // percent_bp / percentBp stay exempt: a share somebody agreed is an input, not a computed rate.
  ok("SET-9. still NO percent-shaped KEY in any payload, settlements included",
    !/\d+(\.\d+)?%/.test(everything2) && !/"(rate|share_?percent|percent(?!_?bp"\s*:)\w*)"\s*:/i.test(everything2),
    (everything2.match(/\d+(\.\d+)?%|"(rate|share_?percent|percent(?!_?bp"\s*:)\w*)"\s*:/i) ?? ["no match?"])[0]);

  // ══ PHASE 3: FINANCIAL INTELLIGENCE AND THE REPORT PACK (CPR-PAY-001 s17, CPR-PI-001 v2) ═══════
  const { financialIntelligence, precedingPeriod } = await import("../src/lib/practice/financial-intelligence");
  const { financialReportCsv } = await import("../src/lib/practice/billing");
  const { metricById, LOW_DENOMINATOR_FLOOR } = await import("../src/lib/practice/intelligence-registry");
  const { practiceToday } = await import("../src/lib/practice/practice-time");
  const todayKla = practiceToday("Africa/Kampala");

  ok("FIN-P1. the preceding period is equal-length and immediately adjacent (PI v2 s5)",
    JSON.stringify(precedingPeriod("2026-08-01", "2026-08-15"))
      === JSON.stringify({ fromDay: "2026-07-17", toDay: "2026-07-31" }));

  const noMoney = { ...a.ctx, capabilities: a.ctx.capabilities.filter(c => c !== "billing.view") };
  const finDenied = await financialIntelligence(admin, noMoney, { fromDay: "2020-01-01", toDay: todayKla });
  ok("FIN-1. ⚠ s18 HOLDS IN INTELLIGENCE TOO: without billing.view the module is unavailable BY NAME",
    !finDenied.available && /billing\.view/.test(String(finDenied.unavailableReason)),
    String(finDenied.unavailableReason).slice(0, 60));

  const finIntel = await financialIntelligence(admin, a.ctx, { fromDay: "2020-01-01", toDay: todayKla });
  const finUgx = finIntel.data?.byCurrency.find(c => c.currency === "UGX");
  ok("FIN-2. the module repeats the Payments workspace's OWN arithmetic -- one figure, two screens",
    finIntel.available && !!finUgx
      && finUgx.charged.minor === ugx3!.chargedMinor
      && finUgx.received.minor === ugx3!.receivedByPractitionerMinor + 50000
      && finUgx.received.settledMinor === 105000,
    JSON.stringify({ c: finUgx?.charged.minor, r: finUgx?.received.minor, s: finUgx?.received.settledMinor }));
  ok("FIN-3. ⚠ NO FABRICATED DELTA: an empty previous period yields NO comparison at all, never +100 percent",
    !!finUgx && finUgx.delta === null, JSON.stringify(finUgx?.delta));
  ok("FIN-4. every emitted metric id resolves in the registry, and the delta metric declares its denominator",
    finIntel.registry.length >= 8 && finIntel.registry.every(id => metricById(id) !== null)
      && !!metricById("fin.period_delta")?.numerator && !!metricById("fin.period_delta")?.denominator
      && LOW_DENOMINATOR_FLOOR === 10,
    finIntel.registry.filter(id => !metricById(id)).join(", "));
  const svcRows = (finIntel.data?.serviceMix ?? []).filter(m => m.currency === "UGX");
  ok("FIN-5. every mix row CARRIES its denominator, and manual charges are named as manual",
    svcRows.length > 0 && svcRows.every(m => m.ofCount === svcRows.reduce((n, r) => n + r.count, 0))
      && svcRows.some(m => m.label === "manual"),
    JSON.stringify(svcRows.map(m => [m.label, m.count, m.ofCount])));

  const noExport = { ...a.ctx, capabilities: a.ctx.capabilities.filter(c => c !== "billing.export") };
  const csvDenied = await financialReportCsv(admin, noExport, { ...base });
  ok("FIN-6. the report pack needs billing.export -- report.view alone never carries money out",
    !csvDenied.ok && csvDenied.code === "FORBIDDEN", csvDenied.ok ? "exported" : String(csvDenied.code));
  const csv = await financialReportCsv(admin, a.ctx, { ...base });
  const csvNeedles: [string, boolean][] = csv.ok ? [
    ["provenance line", csv.data.csv.includes("Collected is not received")],
    ["received figure", csv.data.csv.includes("Summary,UGX,Received by practitioner,185000")],
    ["settlement section", csv.data.csv.includes('Settlement,"CP-SET-')],
    ["receivable section", csv.data.csv.includes("FacilityReceivable,")],
    ["no percent literal", !/\d+(\.\d+)?%/.test(csv.data.csv)],
  ] : [];
  ok("FIN-7. the CSV carries every section with its provenance, and not one percent sign",
    csv.ok && csvNeedles.every(([, hit]) => hit),
    csv.ok ? csvNeedles.filter(([, hit]) => !hit).map(([n]) => n).join(", ") : (csv as any).message);
  const { data: exportAudit } = await admin.from("practice_audit_event")
    .select("id").eq("workspace_id", wsA).eq("event_type", "practice.report_exported");
  ok("FIN-7b. and the export is in the audit trail",
    ((exportAudit ?? []) as any[]).length >= 1, `${(exportAudit ?? []).length} rows`);

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
  // Repointed 2026-08-15, same day: Phase 2 shipped (migration 304), so the assertion flips from
  // pinning the tab's honest ABSENCE to pinning its honest PRESENCE -- and the old promise language
  // must be gone from user-facing copy.
  ok("12-7. Settlements IS a tab now, and the not-yet-built promise language is gone",
    consoleSrc.includes('"settlements", "Settlements"')
      && !consoleSrc.includes("arrive in Phase 2")
      && consoleSrc.includes("never silently reconciled away"));

  // ── 12-8/12-9: UNITS. Added 2026-08-21 after a walkthrough found two money forms on one screen
  // taking DIFFERENT units, with the only warning being the words "(minor units)" in a label. On UGX
  // (exponent 0) major IS minor, so nothing ever misbehaved and no test could see it; on a 2-exponent
  // currency the same two forms differ by a hundred. These two pin the fix in both directions.
  // A raw read is a defect only where the value LEAVES for the server, so the rule tests the payload
  // lines: a wire key and a raw form read on the same line. Reading the form string to validate it, or
  // to grey out a button, converts nothing and is not a defect -- an earlier draft flagged both and was
  // wrong. entForm.fixedMinor is deliberately outside this rule: it is a standing cross-currency rule
  // with no currency at form time, so it is stated in words on the form instead of converted.
  const WIRE_KEY = /(amountMinor|receivedMinor|entitlementMinor)\s*:/;
  const RAW_MONEY_READ = new RegExp(
    "Number\\((payForm|settleForm|settleManual|feeForm)[\\.\\[]");
  const rawReads = consoleSrc.split(/\r?\n/)
    .filter(l => WIRE_KEY.test(l) && RAW_MONEY_READ.test(l));
  ok("12-8. no money value reaches the wire raw -- every amount converts through toMinor with a real currency",
    rawReads.length === 0 && consoleSrc.includes("const toMinor =") && consoleSrc.includes("CURRENCY_EXPONENT"));
  const CONTROL_LINE = "      amountMinor: Number(payForm.amountMajor), currency: inv.currency,";
  ok("12-8-control. the rule can still see a raw read on a wire line",
    WIRE_KEY.test(CONTROL_LINE) && RAW_MONEY_READ.test(CONTROL_LINE)
      // and does NOT fire on the same read off the wire
      && !(WIRE_KEY.test("    const major = Number(feeForm.amountMajor);")));

  // Scanned with COMMENTS STRIPPED -- blocks first, then lines. The first draft of this rule failed
  // against the source comment that explains the very fix it pins, which is the same way a rule in the
  // refusal harness once matched its own documentation.
  const consoleProse = consoleSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n");
  const MINOR_AT_A_HUMAN = /minor units?\)|\(minor\)/i;
  ok("12-9. and no money field speaks 'minor units' at a practitioner, in a label or a placeholder",
    !MINOR_AT_A_HUMAN.test(consoleProse));
  ok("12-9-control. the label rule can see the phrase it bans",
    MINOR_AT_A_HUMAN.test('<span>Amount (minor units) *</span>')
      && MINOR_AT_A_HUMAN.test('placeholder="share (minor units)"'));

  // ── 12-10: A STATEMENT MUST OUTLIVE THE DEBT ─────────────────────────────────────────────────
  // The statement route was live from the start, and the ONLY link to it sat inside the Outstanding
  // list -- whose rows are, by definition, invoices with a balance. So a patient's statement was
  // reachable while they owed money and vanished the moment they paid, which is precisely when
  // somebody asks for one. Reachable is not discoverable, and a route nothing links to is neither.
  //
  // The pin is that the link exists on a surface NOT gated on a balance. Counting links would pass on
  // the old code too, so what is asserted is that one of them sits in the invoice row of Transactions.
  const stmtLinks = consoleSrc.split("/practice/payments/statement/").length - 1;
  const invoiceRowHasStatement = consoleSrc.includes("{i.patient_id && (")
    && consoleSrc.includes("payments/statement/${i.patient_id}/print");
  ok("12-10. the patient statement is reachable from an invoice, not only while money is owed",
    stmtLinks >= 2 && invoiceRowHasStatement, `links=${stmtLinks} inRow=${invoiceRowHasStatement}`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
