import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, zonedDayRange, practiceToday } from "@/lib/practice/practice-time";
import { letterhead } from "@/lib/practice/document-generation";
import {
  SERVICE_TYPES, PAYMENT_METHODS, COLLECTORS, PAYER_KINDS, ADJUSTMENT_KINDS,
  formatBillingNumber, deriveInvoiceStatus, ageBucket,
} from "@/lib/practice/billing-constants";

// CPR-PAY-001/002 Phase 1 -- the billing engine over migration 303.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TWO RULES, RESTATED WHERE THE CODE CAN SEE THEM.
//
// COLLECTED IS NOT RECEIVED. Every read in this file that says "received by practitioner" means
// payments whose collector is the practitioner. Money a facility collected is COLLECTED, visibly,
// separately, and never folded into a received figure -- Phase 2's settlements are the only thing
// that will ever move it across, and they do not exist yet, which the overview says in words.
//
// BALANCES ARE DERIVED. No function in this file writes a balance, a paid flag or a computed status.
// deriveInvoiceStatus() in billing-constants is the one place the arithmetic lives.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO PERCENTAGES AND NO RATES ANYWHERE IN THESE PAYLOADS. The comps print "79% of invoiced" and a
// revenue donut; the product's standing rule (approved by the owner, one exception that is not this
// module) is counts and denominators. The billing harness greps these payloads for %-shaped output.
//
// ⚠ MULTI-CURRENCY IS REAL FROM DAY ONE (s19). Nothing here sums across currencies: every aggregate
// is grouped by currency, and a practice that has only UGX sees one group. The one place that would
// have been tempting -- the overview totals -- returns arrays, not numbers.

/* eslint-disable @typescript-eslint/no-explicit-any */

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });
const trim = (v: unknown): string => String(v ?? "").trim();

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };
const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

const isMoney = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isCurrency = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3}$/.test(v);

// ── THE FEE CATALOGUE ── PAY-001 s5 ─────────────────────────────────────────────────────────────────

export async function listFees(admin: any, ctx: WorkspaceContext): Promise<Panel<any>> {
  if (!hasCapability(ctx, "billing.view")) return denied();
  const [fees, overrides] = await Promise.all([
    admin.from("practice_service_fee")
      .select("id, name, service_type, code, amount_minor, currency, active, effective_from, effective_to, updated_at")
      .eq("workspace_id", ctx.workspaceId).order("service_type").order("name"),
    admin.from("practice_service_fee_override")
      .select("id, fee_id, location_id, amount_minor, currency")
      .eq("workspace_id", ctx.workspaceId),
  ]);
  if (fees.error) return failed(`the fee catalogue could not be read: ${fees.error.message}`);
  const byFee = new Map<string, any[]>();
  for (const o of (overrides.data ?? []) as any[]) {
    (byFee.get(o.fee_id) ?? byFee.set(o.fee_id, []).get(o.fee_id)!).push(o);
  }
  return loaded(((fees.data ?? []) as any[]).map(f => ({
    ...f,
    overrides: byFee.get(f.id) ?? [],
    // The override read failing must not render as "no overrides" -- a location-specific price that
    // silently reverts to the default is a wrong amount on an invoice.
    overridesUnavailable: !!overrides.error,
  })));
}

export async function saveFee(admin: any, ctx: WorkspaceContext, args: {
  feeId?: string | null; name: string; serviceType: string; code?: string | null;
  amountMinor: number; currency: string; active?: boolean;
  effectiveFrom?: string | null; effectiveTo?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, "fee.manage"))
    return fail(403, "FORBIDDEN", "changing the fee catalogue needs fee.manage");
  if (trim(args.name).length < 2) return fail(400, "VALIDATION_ERROR", "name the service");
  if (!SERVICE_TYPES.some(([t]) => t === args.serviceType))
    return fail(400, "VALIDATION_ERROR", `service type must be one of: ${SERVICE_TYPES.map(([t]) => t).join(", ")}`);
  if (!isMoney(args.amountMinor)) return fail(400, "VALIDATION_ERROR", "the fee must be a whole non-negative amount in minor units");
  if (!isCurrency(args.currency)) return fail(400, "VALIDATION_ERROR", "say the currency as a three-letter code");

  const row = {
    workspace_id: ctx.workspaceId, name: trim(args.name), service_type: args.serviceType,
    code: trim(args.code) || null, amount_minor: args.amountMinor, currency: args.currency,
    active: args.active !== false, effective_from: args.effectiveFrom ?? null, effective_to: args.effectiveTo ?? null,
    updated_at: new Date().toISOString(), updated_by: args.actorId,
  };
  const q = args.feeId
    ? admin.from("practice_service_fee").update(row).eq("id", args.feeId).eq("workspace_id", ctx.workspaceId).select("id").maybeSingle()
    : admin.from("practice_service_fee").insert({ ...row, created_by: args.actorId }).select("id").single();
  const { data, error } = await q;
  if (error) return fail(400, "VALIDATION_ERROR", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Not found");

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.fee_saved",
    payload: { feeId: data.id, name: trim(args.name), amountMinor: args.amountMinor, currency: args.currency },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function saveFeeOverride(admin: any, ctx: WorkspaceContext, args: {
  feeId: string; locationId: string; amountMinor: number | null; currency?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ cleared: boolean }>> {
  if (!hasCapability(ctx, "fee.manage"))
    return fail(403, "FORBIDDEN", "changing the fee catalogue needs fee.manage");

  const { data: fee } = await admin.from("practice_service_fee")
    .select("id, currency").eq("id", args.feeId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!fee) return fail(404, "NOT_FOUND", "that fee does not exist in this practice");

  if (args.amountMinor === null) {
    await admin.from("practice_service_fee_override").delete()
      .eq("workspace_id", ctx.workspaceId).eq("fee_id", args.feeId).eq("location_id", args.locationId);
    await audit(admin, {
      workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.fee_override_cleared",
      payload: { feeId: args.feeId, locationId: args.locationId }, correlationId: args.correlationId,
    });
    return { ok: true, data: { cleared: true } };
  }
  if (!isMoney(args.amountMinor)) return fail(400, "VALIDATION_ERROR", "the override must be a whole non-negative amount");
  const currency = args.currency ?? fee.currency;
  if (!isCurrency(currency)) return fail(400, "VALIDATION_ERROR", "say the currency as a three-letter code");

  const { error } = await admin.from("practice_service_fee_override").upsert({
    workspace_id: ctx.workspaceId, fee_id: args.feeId, location_id: args.locationId,
    amount_minor: args.amountMinor, currency, created_by: args.actorId,
  }, { onConflict: "fee_id,location_id" });
  if (error) return fail(400, "VALIDATION_ERROR", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.fee_override_saved",
    payload: { feeId: args.feeId, locationId: args.locationId, amountMinor: args.amountMinor },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { cleared: false } };
}

// ── CHARGES ── PAY-001 s6 ───────────────────────────────────────────────────────────────────────────

/**
 * One charge for one piece of work. From a catalogue fee (with per-location override applied and the
 * whole decision photographed into fee_snapshot) or manual with an amount and a description.
 *
 * ⚠ gated by invoice.draft: a charge is the pre-invoice object, and the person who may shape what a
 * patient will be billed is the person who may draft the bill. NEVER encounter.edit -- s18 keeps
 * financial permissions apart from clinical ones, in both directions.
 *
 * ⚠ IDEMPOTENT BY INDEX, REPORTED BY NAME. A consultation charge for an encounter that already has
 * one is refused as CHARGE_EXISTS by the unique index, not by a read-then-write race.
 */
export async function createCharge(admin: any, ctx: WorkspaceContext, args: {
  source: "consultation" | "procedure" | "report_document" | "manual";
  sourceRef?: string | null;
  encounterId?: string | null; patientId?: string | null; procedureId?: string | null;
  serviceFeeId?: string | null; locationId?: string | null;
  description?: string | null; quantity?: number; unitAmountMinor?: number | null; currency?: string | null;
  overrideAmountMinor?: number | null; overrideReason?: string | null;
  chargedOn?: string | null; performedBy?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; amountMinor: number; currency: string }>> {
  if (!hasCapability(ctx, "invoice.draft"))
    return fail(403, "FORBIDDEN", "raising a charge needs invoice.draft");

  let patientId = args.patientId ?? null;
  let encounterId: string | null = null;
  if (args.encounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!enc) return fail(404, "NOT_FOUND", "that encounter does not exist in this practice");
    encounterId = enc.id;
    patientId = patientId ?? enc.patient_id;
    // s6: the clinical record is never modified by charging, and charging never blocks it -- this
    // engine does not read the encounter's STATUS at all. Signed, active, cancelled: the work was
    // recorded, and whether to charge for it is a financial judgement, not a clinical gate.
  }

  let description = trim(args.description);
  let unitMinor = args.unitAmountMinor ?? null;
  let currency = args.currency ?? null;
  let feeSnapshot: Record<string, unknown> | null = null;

  if (args.serviceFeeId) {
    const { data: feeRow } = await admin.from("practice_service_fee")
      .select("id, name, amount_minor, currency, active")
      .eq("id", args.serviceFeeId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!feeRow) return fail(404, "NOT_FOUND", "that fee does not exist in this practice");
    if (!feeRow.active) return fail(422, "FEE_INACTIVE", "that fee is inactive; reactivate it or charge manually");

    let applied = feeRow.amount_minor as number;
    let overrideMinor: number | null = null;
    if (args.locationId) {
      const { data: ov } = await admin.from("practice_service_fee_override")
        .select("amount_minor").eq("workspace_id", ctx.workspaceId)
        .eq("fee_id", feeRow.id).eq("location_id", args.locationId).maybeSingle();
      if (ov) { overrideMinor = ov.amount_minor as number; applied = overrideMinor; }
    }
    // s6's fee override: allowed, and the default it departed from is written down beside the reason.
    if (args.overrideAmountMinor != null) {
      if (!isMoney(args.overrideAmountMinor)) return fail(400, "VALIDATION_ERROR", "the override must be a whole non-negative amount");
      if (trim(args.overrideReason).length < 3)
        return fail(422, "OVERRIDE_NEEDS_REASON", "changing the fee for this one charge needs a reason, so the invoice can answer for itself later");
      applied = args.overrideAmountMinor;
    }
    description = description || feeRow.name;
    unitMinor = applied;
    currency = feeRow.currency;
    feeSnapshot = {
      feeId: feeRow.id, feeName: feeRow.name, defaultMinor: feeRow.amount_minor,
      locationOverrideMinor: overrideMinor, appliedMinor: applied,
      manualOverrideMinor: args.overrideAmountMinor ?? null, overrideReason: trim(args.overrideReason) || null,
    };
  }

  if (description.length < 2) return fail(400, "VALIDATION_ERROR", "describe what is being charged for");
  if (unitMinor == null || !isMoney(unitMinor)) return fail(400, "VALIDATION_ERROR", "the amount must be a whole non-negative figure in minor units");
  if (!isCurrency(currency)) return fail(400, "VALIDATION_ERROR", "say the currency as a three-letter code");
  const quantity = args.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    return fail(400, "VALIDATION_ERROR", "quantity must be between 1 and 999");

  const chargedOn = args.chargedOn ?? practiceToday((await workspaceClock(admin, ctx.workspaceId)).timezone);
  const { data, error } = await admin.from("practice_charge").insert({
    workspace_id: ctx.workspaceId, patient_id: patientId, encounter_id: encounterId,
    procedure_id: args.procedureId ?? null, service_fee_id: args.serviceFeeId ?? null,
    location_id: args.locationId ?? null,
    source: args.source, source_ref: args.sourceRef ?? null,
    description, quantity, unit_amount_minor: unitMinor, amount_minor: unitMinor * quantity,
    currency, fee_snapshot: feeSnapshot, charged_on: chargedOn,
    performed_by: args.performedBy ?? args.actorId, created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (String(error.code) === "23505" || /ux_practice_charge_source/.test(String(error.message)))
      return fail(409, "CHARGE_EXISTS", "this work is already charged; a revisited encounter does not charge twice");
    return fail(400, "VALIDATION_ERROR", error.message);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.charge_created",
    payload: { chargeId: data.id, source: args.source, amountMinor: unitMinor * quantity, currency, encounterId },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, amountMinor: unitMinor * quantity, currency } };
}

// ── INVOICES ── PAY-002 s4/s5/s8/s11 ─────────────────────────────────────────────────────────────────

/** The charges of this workspace that sit on NO live invoice -- eligible for s11 step 3. */
async function chargesOnLiveInvoices(admin: any, workspaceId: string, chargeIds: string[]): Promise<Set<string>> {
  if (chargeIds.length === 0) return new Set();
  const { data } = await admin.from("practice_invoice_item")
    .select("charge_id, invoice_id, practice_invoice!inner(status)")
    .eq("workspace_id", workspaceId).in("charge_id", chargeIds);
  return new Set(((data ?? []) as any[])
    .filter(r => r.practice_invoice?.status !== "VOID")
    .map(r => r.charge_id));
}

export async function createDraftInvoice(admin: any, ctx: WorkspaceContext, args: {
  chargeIds: string[]; payerKind?: string; payerLabel?: string | null; dueDate?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; totalMinor: number; currency: string }>> {
  if (!hasCapability(ctx, "invoice.draft"))
    return fail(403, "FORBIDDEN", "drafting an invoice needs invoice.draft");
  const ids = [...new Set((args.chargeIds ?? []).map(trim).filter(Boolean))];
  if (ids.length === 0) return fail(422, "VALIDATION_ERROR", "choose at least one charge");

  const { data: charges, error } = await admin.from("practice_charge")
    .select("id, patient_id, description, quantity, unit_amount_minor, amount_minor, currency")
    .eq("workspace_id", ctx.workspaceId).in("id", ids);
  if (error) return fail(503, "CHARGES_UNAVAILABLE", `the charges could not be read: ${error.message}`);
  if ((charges ?? []).length !== ids.length)
    return fail(404, "NOT_FOUND", "one or more of those charges does not exist in this practice");

  const rows = charges as any[];
  const currencies = [...new Set(rows.map(r => r.currency))];
  if (currencies.length > 1)
    return fail(422, "MIXED_CURRENCIES", `one invoice, one currency: these charges are in ${currencies.join(" and ")}`);
  const patients = [...new Set(rows.map(r => r.patient_id).filter(Boolean))];
  if (patients.length > 1)
    return fail(422, "MIXED_PATIENTS", "these charges belong to different patients; an invoice bills one payer for one person");

  // s8: a charge lives on at most one LIVE invoice. The index cannot see status without being
  // partial, so the engine owns this rule -- and void-and-reissue works because VOID rows are ignored.
  const taken = await chargesOnLiveInvoices(admin, ctx.workspaceId, ids);
  if (taken.size > 0)
    return fail(409, "CHARGE_ALREADY_INVOICED", "one or more of those charges is already on a live invoice; void that invoice first or leave the charge off this one");

  const payerKind = PAYER_KINDS.some(([k]) => k === args.payerKind) ? args.payerKind! : "patient";
  const subtotal = rows.reduce((n, r) => n + r.amount_minor, 0);

  const { data: inv, error: invErr } = await admin.from("practice_invoice").insert({
    workspace_id: ctx.workspaceId, patient_id: patients[0] ?? null,
    payer_kind: payerKind, payer_label: trim(args.payerLabel) || null,
    currency: currencies[0], subtotal_minor: subtotal, adjustment_total_minor: 0, total_minor: subtotal,
    due_date: args.dueDate ?? null, created_by: args.actorId,
  }).select("id").single();
  if (invErr) return fail(400, "VALIDATION_ERROR", invErr.message);

  const { error: itemErr } = await admin.from("practice_invoice_item").insert(rows.map((r, i) => ({
    workspace_id: ctx.workspaceId, invoice_id: inv.id, charge_id: r.id,
    description_snapshot: r.description, quantity: r.quantity,
    unit_amount_minor: r.unit_amount_minor, line_amount_minor: r.amount_minor,
    currency: r.currency, position: i,
  })));
  if (itemErr) {
    // The draft is not left half-made: no items means no invoice, and the delete is legal on a DRAFT.
    await admin.from("practice_invoice").delete().eq("id", inv.id);
    return fail(400, "VALIDATION_ERROR", `the line items were refused, so no draft was created: ${itemErr.message}`);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.invoice_drafted",
    payload: { invoiceId: inv.id, charges: ids.length, totalMinor: subtotal, currency: currencies[0] },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: inv.id as string, totalMinor: subtotal, currency: currencies[0] } };
}

export async function issueInvoice(admin: any, ctx: WorkspaceContext, args: {
  invoiceId: string; dueDate?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; invoiceNumber: string }>> {
  if (!hasCapability(ctx, "invoice.issue"))
    return fail(403, "FORBIDDEN", "issuing an invoice needs invoice.issue");

  const { data: inv } = await admin.from("practice_invoice")
    .select("id, status, patient_id, payer_kind, payer_label, currency, subtotal_minor, adjustment_total_minor, total_minor, due_date")
    .eq("id", args.invoiceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!inv) return fail(404, "NOT_FOUND", "Not found");
  if (inv.status !== "DRAFT") return fail(422, "NOT_A_DRAFT", "only a draft can be issued");

  const { data: items, error: itemsErr } = await admin.from("practice_invoice_item")
    .select("description_snapshot, quantity, unit_amount_minor, line_amount_minor, currency, position, charge_id")
    .eq("invoice_id", inv.id).order("position");
  if (itemsErr) return fail(503, "ITEMS_UNAVAILABLE", `the line items could not be read: ${itemsErr.message}`);
  if ((items ?? []).length === 0) return fail(422, "EMPTY_INVOICE", "an invoice with no line items bills nobody for nothing");

  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const year = Number(today.slice(0, 4));
  const { data: seq, error: seqErr } = await admin.rpc("practice_next_billing_number", {
    p_workspace_id: ctx.workspaceId, p_doc_kind: "invoice", p_doc_year: year,
  });
  if (seqErr || typeof seq !== "number")
    return fail(503, "NUMBERING_UNAVAILABLE", `no invoice number could be allocated, so nothing was issued: ${seqErr?.message ?? "no sequence"}`);
  const invoiceNumber = formatBillingNumber("invoice", year, seq);

  const head = await letterhead(admin, ctx.workspaceId);
  const patientName = inv.patient_id
    ? (await admin.from("practice_patient").select("display_name").eq("id", inv.patient_id).maybeSingle()).data?.display_name ?? null
    : null;

  // PAY-002 s16: the PDF renders from THIS, never from a live screen. Everything the document says is
  // photographed at the moment of issue.
  const issuedSnapshot = {
    invoiceNumber, issuedOn: today, timezone,
    issuer: head, payer: { kind: inv.payer_kind, label: inv.payer_label, patientName },
    currency: inv.currency,
    items: (items as any[]).map(i => ({
      description: i.description_snapshot, quantity: i.quantity,
      unitAmountMinor: i.unit_amount_minor, lineAmountMinor: i.line_amount_minor,
    })),
    subtotalMinor: inv.subtotal_minor, adjustmentTotalMinor: inv.adjustment_total_minor, totalMinor: inv.total_minor,
    dueDate: args.dueDate ?? inv.due_date ?? null,
  };

  const { error } = await admin.from("practice_invoice").update({
    status: "ISSUED", invoice_number: invoiceNumber, issue_date: today,
    due_date: args.dueDate ?? inv.due_date ?? null,
    issued_snapshot: issuedSnapshot, issued_at: new Date().toISOString(), issued_by: args.actorId,
    updated_at: new Date().toISOString(),
  }).eq("id", inv.id).eq("status", "DRAFT");
  if (error) return fail(422, "ISSUE_FAILED", `nothing was issued: ${error.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.invoice_issued",
    payload: { invoiceId: inv.id, invoiceNumber, totalMinor: inv.total_minor, currency: inv.currency },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: inv.id as string, invoiceNumber } };
}

export async function voidInvoice(admin: any, ctx: WorkspaceContext, args: {
  invoiceId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, "billing.adjust"))
    return fail(403, "FORBIDDEN", "voiding an invoice needs billing.adjust");
  if (trim(args.reason).length < 3) return fail(422, "REASON_REQUIRED", "say why this invoice is void");

  const { data: inv } = await admin.from("practice_invoice")
    .select("id, status, invoice_number").eq("id", args.invoiceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!inv) return fail(404, "NOT_FOUND", "Not found");
  if (inv.status === "VOID") return fail(422, "ALREADY_VOID", "this invoice is already void");

  const { error } = await admin.from("practice_invoice").update({
    status: "VOID", void_reason: trim(args.reason), void_at: new Date().toISOString(), void_by: args.actorId,
    updated_at: new Date().toISOString(),
  }).eq("id", inv.id);
  if (error) return fail(422, "VOID_FAILED", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.invoice_voided",
    payload: { invoiceId: inv.id, invoiceNumber: inv.invoice_number, reason: trim(args.reason) },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: inv.id as string } };
}

// ── PAYMENTS AND RECEIPTS ── PAY-001 s8/s9, PAY-002 s6/s9 ───────────────────────────────────────────

export async function recordPayment(admin: any, ctx: WorkspaceContext, args: {
  patientId?: string | null; payerKind?: string; payerLabel?: string | null;
  amountMinor: number; currency: string; method: string; collector?: string;
  reference?: string | null; paidAtIso?: string | null; locationId?: string | null; notes?: string | null;
  allocations: { invoiceId?: string | null; chargeId?: string | null; amountMinor: number }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; receiptNumber: string }>> {
  if (!hasCapability(ctx, "payment.record"))
    return fail(403, "FORBIDDEN", "recording a payment needs payment.record");
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0)
    return fail(400, "VALIDATION_ERROR", "the amount must be a whole positive figure in minor units");
  if (!isCurrency(args.currency)) return fail(400, "VALIDATION_ERROR", "say the currency as a three-letter code");
  if (!PAYMENT_METHODS.some(([m]) => m === args.method))
    return fail(400, "VALIDATION_ERROR", `method must be one of: ${PAYMENT_METHODS.map(([m]) => m).join(", ")}`);
  const collector = COLLECTORS.some(([c]) => c === args.collector) ? args.collector! : "practitioner";

  const allocations = args.allocations ?? [];
  if (allocations.length === 0)
    return fail(422, "VALIDATION_ERROR", "say what this payment answers -- an invoice or a charge");
  // s20: allocations reconcile to the payment amount. There is no unapplied-balance feature, so a
  // mismatch is refused rather than silently parked.
  const allocated = allocations.reduce((n, a) => n + (a.amountMinor ?? 0), 0);
  if (allocated !== args.amountMinor)
    return fail(422, "ALLOCATION_MISMATCH", `the allocations total ${allocated} but the payment is ${args.amountMinor}; every unit must be pointed somewhere`);

  // Validate every target BEFORE any write: same workspace, same currency, invoice ISSUED, and no
  // over-allocation -- OVERPAID needs an explicit credit rule this phase does not have (s7).
  for (const a of allocations) {
    if (!Number.isInteger(a.amountMinor) || a.amountMinor <= 0)
      return fail(400, "VALIDATION_ERROR", "every allocation must be a whole positive amount");
    if (a.invoiceId) {
      const { data: inv } = await admin.from("practice_invoice")
        .select("id, status, currency, total_minor").eq("id", a.invoiceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
      if (!inv) return fail(404, "NOT_FOUND", "that invoice does not exist in this practice");
      if (inv.status !== "ISSUED") return fail(422, "NOT_ISSUED", "payments allocate to ISSUED invoices; a draft is not yet owed and a void never was");
      if (inv.currency !== args.currency) return fail(422, "CURRENCY_MISMATCH", `the invoice is in ${inv.currency} and this payment is in ${args.currency}`);
      const { data: prior } = await admin.from("practice_payment_allocation")
        .select("amount_minor").eq("workspace_id", ctx.workspaceId).eq("invoice_id", a.invoiceId);
      const already = ((prior ?? []) as any[]).reduce((n, r) => n + r.amount_minor, 0);
      if (already + a.amountMinor > inv.total_minor)
        return fail(422, "OVERPAYMENT", "that would pay this invoice past its total; overpayment needs an explicit credit or refund, not a silent surplus");
    } else if (a.chargeId) {
      const { data: ch } = await admin.from("practice_charge")
        .select("id, currency").eq("id", a.chargeId).eq("workspace_id", ctx.workspaceId).maybeSingle();
      if (!ch) return fail(404, "NOT_FOUND", "that charge does not exist in this practice");
      if (ch.currency !== args.currency) return fail(422, "CURRENCY_MISMATCH", `the charge is in ${ch.currency} and this payment is in ${args.currency}`);
    } else {
      return fail(400, "VALIDATION_ERROR", "each allocation names an invoice or a charge");
    }
  }

  const payerKind = PAYER_KINDS.some(([k]) => k === args.payerKind) ? args.payerKind! : "patient";
  const { data: pay, error: payErr } = await admin.from("practice_payment").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId ?? null,
    payer_kind: payerKind, payer_label: trim(args.payerLabel) || null,
    amount_minor: args.amountMinor, currency: args.currency, method: args.method, collector,
    reference: trim(args.reference) || null, paid_at: args.paidAtIso ?? new Date().toISOString(),
    location_id: args.locationId ?? null, notes: trim(args.notes) || null, created_by: args.actorId,
  }).select("id, paid_at").single();
  if (payErr) return fail(400, "VALIDATION_ERROR", payErr.message);

  const { error: allocErr } = await admin.from("practice_payment_allocation").insert(allocations.map(a => ({
    workspace_id: ctx.workspaceId, payment_id: pay.id,
    invoice_id: a.invoiceId ?? null, charge_id: a.chargeId ?? null,
    amount_minor: a.amountMinor, created_by: args.actorId,
  })));
  if (allocErr) {
    // No allocations means the payment never happened as described -- remove it and say so, rather
    // than leaving money pointing at nothing.
    await admin.from("practice_payment").delete().eq("id", pay.id);
    return fail(400, "VALIDATION_ERROR", `the allocations were refused, so no payment was recorded: ${allocErr.message}`);
  }

  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const year = Number(today.slice(0, 4));
  const { data: seq, error: seqErr } = await admin.rpc("practice_next_billing_number", {
    p_workspace_id: ctx.workspaceId, p_doc_kind: "receipt", p_doc_year: year,
  });
  if (seqErr || typeof seq !== "number") {
    await admin.from("practice_payment").delete().eq("id", pay.id);
    return fail(503, "NUMBERING_UNAVAILABLE", "no receipt number could be allocated, so the payment was not recorded; try again");
  }
  const receiptNumber = formatBillingNumber("receipt", year, seq);

  const invoiceNumbers = new Map<string, string>();
  for (const a of allocations) {
    if (a.invoiceId && !invoiceNumbers.has(a.invoiceId)) {
      const { data } = await admin.from("practice_invoice").select("invoice_number").eq("id", a.invoiceId).maybeSingle();
      invoiceNumbers.set(a.invoiceId, data?.invoice_number ?? "");
    }
  }
  const head = await letterhead(admin, ctx.workspaceId);
  const receiptSnapshot = {
    receiptNumber, issuedOn: today, timezone, issuer: head,
    amountMinor: args.amountMinor, currency: args.currency, method: args.method,
    collector, payerKind, payerLabel: trim(args.payerLabel) || null,
    reference: trim(args.reference) || null, paidAt: pay.paid_at,
    allocations: allocations.map(a => ({
      invoiceNumber: a.invoiceId ? invoiceNumbers.get(a.invoiceId) : null,
      chargeId: a.chargeId ?? null, amountMinor: a.amountMinor,
    })),
  };
  const { error: rctErr } = await admin.from("practice_receipt").insert({
    workspace_id: ctx.workspaceId, receipt_number: receiptNumber, payment_id: pay.id,
    snapshot: receiptSnapshot, issued_by: args.actorId,
  });
  if (rctErr) {
    await admin.from("practice_payment").delete().eq("id", pay.id);
    return fail(503, "RECEIPT_FAILED", `the receipt could not be written, so the payment was not recorded: ${rctErr.message}`);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.payment_recorded",
    payload: { paymentId: pay.id, receiptNumber, amountMinor: args.amountMinor, currency: args.currency, method: args.method, collector },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: pay.id as string, receiptNumber } };
}

export async function recordAdjustment(admin: any, ctx: WorkspaceContext, args: {
  invoiceId?: string | null; chargeId?: string | null; paymentId?: string | null;
  kind: string; amountMinor: number; currency: string; reason: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, "billing.adjust"))
    return fail(403, "FORBIDDEN", "adjustments need billing.adjust");
  if (!ADJUSTMENT_KINDS.some(([k]) => k === args.kind))
    return fail(400, "VALIDATION_ERROR", `kind must be one of: ${ADJUSTMENT_KINDS.map(([k]) => k).join(", ")}`);
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0)
    return fail(400, "VALIDATION_ERROR", "the amount must be a whole positive figure");
  if (!isCurrency(args.currency)) return fail(400, "VALIDATION_ERROR", "say the currency as a three-letter code");
  if (trim(args.reason).length < 3) return fail(422, "REASON_REQUIRED", "an adjustment with no reason is an edit wearing a costume");

  if (args.kind === "refund") {
    if (!args.paymentId) return fail(422, "VALIDATION_ERROR", "a refund names the payment it reverses");
    const { data: pay } = await admin.from("practice_payment")
      .select("id, amount_minor, currency").eq("id", args.paymentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!pay) return fail(404, "NOT_FOUND", "that payment does not exist in this practice");
    if (pay.currency !== args.currency) return fail(422, "CURRENCY_MISMATCH", "a refund is in the payment's own currency");
    const { data: priorRefunds } = await admin.from("practice_billing_adjustment")
      .select("amount_minor").eq("workspace_id", ctx.workspaceId).eq("payment_id", args.paymentId).eq("kind", "refund");
    const refunded = ((priorRefunds ?? []) as any[]).reduce((n, r) => n + r.amount_minor, 0);
    if (refunded + args.amountMinor > pay.amount_minor)
      return fail(422, "REFUND_EXCEEDS_PAYMENT", "that would refund more than was ever paid");
  }

  const { data, error } = await admin.from("practice_billing_adjustment").insert({
    workspace_id: ctx.workspaceId, invoice_id: args.invoiceId ?? null, charge_id: args.chargeId ?? null,
    payment_id: args.paymentId ?? null, kind: args.kind, amount_minor: args.amountMinor,
    currency: args.currency, reason: trim(args.reason), created_by: args.actorId,
  }).select("id").single();
  if (error) return fail(400, "VALIDATION_ERROR", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.billing_adjusted",
    payload: { adjustmentId: data.id, kind: args.kind, amountMinor: args.amountMinor, currency: args.currency },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

// ── DERIVED READS ── PAY-001 s11/s12 ─────────────────────────────────────────────────────────────────

/** Allocations per invoice id, one query, summed here. */
async function allocationsByInvoice(admin: any, workspaceId: string, invoiceIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (invoiceIds.length === 0) return out;
  const { data } = await admin.from("practice_payment_allocation")
    .select("invoice_id, amount_minor").eq("workspace_id", workspaceId).in("invoice_id", invoiceIds);
  for (const r of (data ?? []) as any[]) out.set(r.invoice_id, (out.get(r.invoice_id) ?? 0) + r.amount_minor);
  return out;
}

export async function listInvoices(admin: any, ctx: WorkspaceContext, filter: {
  patientId?: string; status?: string; fromDay?: string; toDay?: string; limit?: number;
} = {}): Promise<Panel<any>> {
  if (!hasCapability(ctx, "billing.view")) return denied();
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 999);
  let q = admin.from("practice_invoice")
    .select("id, invoice_number, status, patient_id, payer_kind, payer_label, currency, subtotal_minor, adjustment_total_minor, total_minor, issue_date, due_date, created_at, void_reason")
    .eq("workspace_id", ctx.workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.fromDay) q = q.gte("created_at", zonedDayRange(filter.fromDay, (await workspaceClock(admin, ctx.workspaceId)).timezone).startIso);
  if (filter.toDay) q = q.lt("created_at", zonedDayRange(filter.toDay, (await workspaceClock(admin, ctx.workspaceId)).timezone).endIso);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) return failed(`the invoices could not be read: ${error.message}`);

  const rows = (data ?? []) as any[];
  const allocated = await allocationsByInvoice(admin, ctx.workspaceId, rows.map(r => r.id));
  const { today } = await workspaceClock(admin, ctx.workspaceId);
  const withState = rows.map(r => ({
    ...r,
    allocatedMinor: allocated.get(r.id) ?? 0,
    balanceMinor: Math.max(0, r.total_minor - (allocated.get(r.id) ?? 0)),
    derivedStatus: deriveInvoiceStatus({
      status: r.status, totalMinor: r.total_minor, allocatedMinor: allocated.get(r.id) ?? 0,
      dueDate: r.due_date, today,
    }),
  }));
  return loaded(filter.status ? withState.filter(r => r.derivedStatus === filter.status) : withState);
}

export async function getInvoice(admin: any, ctx: WorkspaceContext, invoiceId: string) {
  if (!hasCapability(ctx, "billing.view")) return null;
  const { data: inv } = await admin.from("practice_invoice").select("*")
    .eq("id", invoiceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!inv) return null;
  const [{ data: items }, allocated, { today }] = await Promise.all([
    admin.from("practice_invoice_item")
      .select("description_snapshot, quantity, unit_amount_minor, line_amount_minor, position")
      .eq("invoice_id", invoiceId).order("position"),
    allocationsByInvoice(admin, ctx.workspaceId, [invoiceId]),
    workspaceClock(admin, ctx.workspaceId),
  ]);
  const allocatedMinor = allocated.get(invoiceId) ?? 0;
  return {
    ...inv, items: items ?? [], allocatedMinor,
    balanceMinor: Math.max(0, inv.total_minor - allocatedMinor),
    derivedStatus: deriveInvoiceStatus({
      status: inv.status, totalMinor: inv.total_minor, allocatedMinor, dueDate: inv.due_date, today,
    }),
  };
}

/**
 * s11.1's overview. EVERY FIGURE IS A COUNT OR A SUM WITH ITS SCOPE SAID, grouped BY CURRENCY --
 * nothing here sums UGX with anything else, and nothing here is a percentage.
 */
export async function paymentsOverview(admin: any, ctx: WorkspaceContext, opts: {
  fromDay?: string; toDay?: string;
} = {}) {
  if (!hasCapability(ctx, "billing.view"))
    return { permitted: false as const, unavailable: false, detail: null, byCurrency: [], recent: [] };
  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const range = (col: string) => (q: any) => {
    let out = q;
    if (opts.fromDay) out = out.gte(col, zonedDayRange(opts.fromDay, timezone).startIso);
    if (opts.toDay) out = out.lt(col, zonedDayRange(opts.toDay, timezone).endIso);
    return out;
  };
  const dayRange = (col: string) => (q: any) => {
    let out = q;
    if (opts.fromDay) out = out.gte(col, opts.fromDay);
    if (opts.toDay) out = out.lte(col, opts.toDay);
    return out;
  };

  const [chargesRes, paymentsRes, invoicesRes] = await Promise.all([
    dayRange("charged_on")(admin.from("practice_charge")
      .select("id, amount_minor, currency, charged_on, description, patient_id")
      .eq("workspace_id", ctx.workspaceId)).limit(1000),
    range("paid_at")(admin.from("practice_payment")
      .select("id, amount_minor, currency, method, collector, paid_at, patient_id")
      .eq("workspace_id", ctx.workspaceId)).limit(1000),
    admin.from("practice_invoice")
      .select("id, total_minor, currency, status, due_date")
      .eq("workspace_id", ctx.workspaceId).eq("status", "ISSUED").limit(1000),
  ]);
  if (chargesRes.error || paymentsRes.error || invoicesRes.error) {
    return {
      permitted: true as const, unavailable: true,
      detail: [chargesRes.error?.message, paymentsRes.error?.message, invoicesRes.error?.message].filter(Boolean).join("; "),
      byCurrency: [], recent: [],
    };
  }

  const charges = (chargesRes.data ?? []) as any[];
  const payments = (paymentsRes.data ?? []) as any[];
  const invoices = (invoicesRes.data ?? []) as any[];
  const allocated = await allocationsByInvoice(admin, ctx.workspaceId, invoices.map(i => i.id));

  const currencies = [...new Set([...charges, ...payments, ...invoices].map(r => r.currency))].sort();
  const byCurrency = currencies.map(cur => {
    const c = charges.filter(r => r.currency === cur);
    const p = payments.filter(r => r.currency === cur);
    const inv = invoices.filter(r => r.currency === cur);
    const collectedByPractitioner = p.filter(r => r.collector === "practitioner").reduce((n, r) => n + r.amount_minor, 0);
    const collectedByOthers = p.filter(r => r.collector !== "practitioner").reduce((n, r) => n + r.amount_minor, 0);
    return {
      currency: cur,
      chargedMinor: c.reduce((n, r) => n + r.amount_minor, 0),
      chargedCount: c.length,
      collectedMinor: collectedByPractitioner + collectedByOthers,
      collectedCount: p.length,
      // ⚠ THE RULE, IN A FIELD NAME: received means the practitioner collected it themselves. What a
      // facility collected sits beside it and is NOT yours until a Phase 2 settlement says so.
      receivedByPractitionerMinor: collectedByPractitioner,
      collectedByOthersMinor: collectedByOthers,
      outstandingInvoicedMinor: inv.reduce((n, r) => n + Math.max(0, r.total_minor - (allocated.get(r.id) ?? 0)), 0),
      overdueCount: inv.filter(r =>
        deriveInvoiceStatus({ status: r.status, totalMinor: r.total_minor, allocatedMinor: allocated.get(r.id) ?? 0, dueDate: r.due_date, today }) === "OVERDUE").length,
    };
  });

  const recent = [
    ...charges.map(c => ({ kind: "charge" as const, id: c.id, when: c.charged_on, amountMinor: c.amount_minor, currency: c.currency, label: c.description, patientId: c.patient_id })),
    ...payments.map(p => ({ kind: "payment" as const, id: p.id, when: String(p.paid_at).slice(0, 10), amountMinor: p.amount_minor, currency: p.currency, label: `${p.method} · collected by ${p.collector}`, patientId: p.patient_id })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 20);

  return { permitted: true as const, unavailable: false, detail: null, byCurrency, recent };
}

/** s11.3: who owes what, aged in days -- patient/payer balances from ISSUED invoices only. */
export async function outstandingBalances(admin: any, ctx: WorkspaceContext): Promise<Panel<any>> {
  if (!hasCapability(ctx, "billing.view")) return denied();
  const { data, error } = await admin.from("practice_invoice")
    .select("id, invoice_number, patient_id, payer_kind, payer_label, currency, total_minor, issue_date, due_date, status")
    .eq("workspace_id", ctx.workspaceId).eq("status", "ISSUED").limit(1000);
  if (error) return failed(`the invoices could not be read: ${error.message}`);

  const rows = (data ?? []) as any[];
  const allocated = await allocationsByInvoice(admin, ctx.workspaceId, rows.map(r => r.id));
  const { today } = await workspaceClock(admin, ctx.workspaceId);
  const open = rows
    .map(r => ({ ...r, balanceMinor: Math.max(0, r.total_minor - (allocated.get(r.id) ?? 0)) }))
    .filter(r => r.balanceMinor > 0)
    .map(r => ({ ...r, age: ageBucket(r.issue_date ?? today, today) }));

  const patientIds = [...new Set(open.map(r => r.patient_id).filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").in("id", patientIds)
    : { data: [] };
  const nameOf = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));
  return loaded(open.map(r => ({ ...r, patientName: r.patient_id ? (nameOf.get(r.patient_id) ?? null) : null })));
}

/** s12: the compact per-patient money picture -- balance, recent items, invoices, receipts. */
export async function patientFinancial(admin: any, ctx: WorkspaceContext, patientId: string) {
  if (!hasCapability(ctx, "billing.view"))
    return { permitted: false as const, unavailable: false, detail: null };
  const [chargesRes, invoicesPanel, paymentsRes] = await Promise.all([
    admin.from("practice_charge")
      .select("id, description, amount_minor, currency, charged_on, source")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("charged_on", { ascending: false }).limit(50),
    listInvoices(admin, ctx, { patientId, limit: 50 }),
    admin.from("practice_payment")
      .select("id, amount_minor, currency, method, collector, paid_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("paid_at", { ascending: false }).limit(50),
  ]);
  if (chargesRes.error || invoicesPanel.unavailable || paymentsRes.error) {
    return {
      permitted: true as const, unavailable: true,
      detail: [chargesRes.error?.message, invoicesPanel.detail, paymentsRes.error?.message].filter(Boolean).join("; "),
    };
  }
  const invoices = invoicesPanel.items;
  const balances = [...new Set(invoices.map((i: any) => i.currency))].map(cur => ({
    currency: cur,
    balanceMinor: invoices.filter((i: any) => i.currency === cur && i.status === "ISSUED")
      .reduce((n: number, i: any) => n + i.balanceMinor, 0),
  })).filter(b => b.balanceMinor > 0);
  return {
    permitted: true as const, unavailable: false, detail: null,
    balances, charges: (chargesRes.data ?? []) as any[], invoices, payments: (paymentsRes.data ?? []) as any[],
  };
}

/** Uninvoiced charges, for s11 step 3's picker and the encounter handoff. */
export async function uninvoicedCharges(admin: any, ctx: WorkspaceContext, filter: {
  patientId?: string; encounterId?: string;
} = {}): Promise<Panel<any>> {
  if (!hasCapability(ctx, "billing.view")) return denied();
  let q = admin.from("practice_charge")
    .select("id, description, quantity, amount_minor, currency, charged_on, patient_id, encounter_id, source")
    .eq("workspace_id", ctx.workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.encounterId) q = q.eq("encounter_id", filter.encounterId);
  const { data, error } = await q.order("charged_on", { ascending: false }).limit(500);
  if (error) return failed(`the charges could not be read: ${error.message}`);
  const rows = (data ?? []) as any[];
  const taken = await chargesOnLiveInvoices(admin, ctx.workspaceId, rows.map(r => r.id));
  return loaded(rows.filter(r => !taken.has(r.id)));
}
