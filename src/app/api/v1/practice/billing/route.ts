import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { emitEvent } from "@/lib/mos/event";
import {
  listFees, saveFee, saveFeeOverride, createCharge, createDraftInvoice, issueInvoice,
  voidInvoice, recordPayment, recordAdjustment, paymentsOverview, listInvoices, getInvoice,
  outstandingBalances, patientFinancial, uninvoicedCharges,
  saveFacilityEntitlement, facilityReceivables, recordSettlement, listSettlements,
} from "@/lib/practice/billing";

// GET  /api/v1/practice/billing?view=overview|invoices|outstanding|fees|uninvoiced|patient&...
// POST /api/v1/practice/billing -- one route, an `action` discriminator, the investigation-capture
//      shape: the capability each verb needs is decided by the ENGINE (fee.manage for the catalogue,
//      invoice.draft/issue for invoices, payment.record for money, billing.adjust for corrections),
//      because a single route-level capability would be too weak for some verbs and too strong for
//      others. requirePracticeContext still enforces authentication, membership and entitlement.
//
// ⚠ NOTHING HERE MOVES MONEY. Every verb RECORDS what happened in the world -- a fee decided, a
// charge raised, cash handed over. There is no gateway, no card entry, no transfer (PAY-001 s23
// places integrations in Phase 3, and they will be their own specification).

/* eslint-disable @typescript-eslint/no-explicit-any */

const bad = (message: string) => NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("billing.view");
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;
  const url = new URL(req.url);
  const one = (k: string) => url.searchParams.get(k) ?? undefined;

  switch (one("view") ?? "overview") {
    case "overview": {
      const overview = await paymentsOverview(caller.admin, ctx, { fromDay: one("from"), toDay: one("to") });
      return NextResponse.json({ ...overview, correlationId: caller.traceId });
    }
    case "invoices": {
      const invoices = await listInvoices(caller.admin, ctx, {
        patientId: one("patientId"), status: one("status"), fromDay: one("from"), toDay: one("to"),
      });
      return NextResponse.json({ ...invoices, correlationId: caller.traceId });
    }
    case "invoice": {
      const invoice = await getInvoice(caller.admin, ctx, String(one("id") ?? ""));
      if (!invoice) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
      return NextResponse.json({ invoice, correlationId: caller.traceId });
    }
    case "outstanding": {
      const outstanding = await outstandingBalances(caller.admin, ctx);
      return NextResponse.json({ ...outstanding, correlationId: caller.traceId });
    }
    case "fees": {
      const fees = await listFees(caller.admin, ctx);
      return NextResponse.json({ ...fees, correlationId: caller.traceId });
    }
    case "uninvoiced": {
      const charges = await uninvoicedCharges(caller.admin, ctx, { patientId: one("patientId"), encounterId: one("encounterId") });
      return NextResponse.json({ ...charges, correlationId: caller.traceId });
    }
    case "receivables": {
      const receivables = await facilityReceivables(caller.admin, ctx);
      return NextResponse.json({ ...receivables, correlationId: caller.traceId });
    }
    case "settlements": {
      const settlements = await listSettlements(caller.admin, ctx, { locationId: one("locationId") });
      return NextResponse.json({ ...settlements, correlationId: caller.traceId });
    }
    case "patient": {
      const financial = await patientFinancial(caller.admin, ctx, String(one("patientId") ?? ""));
      return NextResponse.json({ ...financial, correlationId: caller.traceId });
    }
    default:
      return bad("unknown view");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }
  const actor = { actorId: caller.userId, correlationId: caller.traceId };

  switch (String(body.action ?? "")) {
    case "saveFee": {
      const result = await saveFee(caller.admin, ctx, {
        feeId: body.feeId ?? null, name: String(body.name ?? ""), serviceType: String(body.serviceType ?? ""),
        code: body.code ?? null, amountMinor: Number(body.amountMinor), currency: String(body.currency ?? ""),
        active: body.active !== false, effectiveFrom: body.effectiveFrom ?? null, effectiveTo: body.effectiveTo ?? null,
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    case "saveFeeOverride": {
      const result = await saveFeeOverride(caller.admin, ctx, {
        feeId: String(body.feeId ?? ""), locationId: String(body.locationId ?? ""),
        amountMinor: body.amountMinor === null ? null : Number(body.amountMinor),
        currency: body.currency ?? undefined, ...actor,
      });
      return respond(result, caller.traceId);
    }
    case "createCharge": {
      const result = await createCharge(caller.admin, ctx, {
        source: body.source, sourceRef: body.sourceRef ?? null,
        encounterId: body.encounterId ?? null, patientId: body.patientId ?? null,
        procedureId: body.procedureId ?? null, serviceFeeId: body.serviceFeeId ?? null,
        locationId: body.locationId ?? null, description: body.description ?? null,
        quantity: body.quantity === undefined ? undefined : Number(body.quantity),
        unitAmountMinor: body.unitAmountMinor === undefined || body.unitAmountMinor === null ? null : Number(body.unitAmountMinor),
        currency: body.currency ?? null,
        overrideAmountMinor: body.overrideAmountMinor === undefined || body.overrideAmountMinor === null ? null : Number(body.overrideAmountMinor),
        overrideReason: body.overrideReason ?? null,
        chargedOn: body.chargedOn ?? null, performedBy: body.performedBy ?? null, ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    // ── CPR-CORE-MOS-001 phase 3 — Generate Invoice, the sixth instrumented critical journey ───────
    //
    // ⚠ THE WRAPPER GOES ROUND ONE CASE OF A TEN-ACTION SWITCH. This route guards once at the top and
    // then dispatches; only this branch is a critical journey, so only this branch emits. The other
    // nine are billing actions rather than journeys and instrumenting them here would put nine more
    // event streams into a table nobody asked to aggregate.
    //
    // ⚠ AND THE ATTEMPT IS EMITTED BEFORE THE ARRAY CHECK, DELIBERATELY. A caller who sends the wrong
    // shape HAS attempted to generate an invoice, and a denominator that excluded malformed attempts
    // would quietly flatter the success rate exactly when a client was sending rubbish.
    case "createDraftInvoice": {
      const base = {
        practiceId: ctx.workspaceId,
        practitionerId: caller.userId,
        correlationId: caller.traceId,
        component: "billing",
      } as const;

      await emitEvent(caller.admin, { ...base, eventName: "practice.invoice.generate_attempted", outcome: "started" });

      // ⚠ THE CLOCK STARTS AFTER THE ATTEMPT EMIT, AND IT DID NOT USED TO. With it above, every
      // journey's duration included the round trip that RECORDED the attempt - a validation failure
      // returning immediately reported 440ms, almost all of it telemetry. The instrumentation was
      // measuring itself and inflating the latency of the journeys it exists to observe. Only running
      // the screen showed it: the numbers were plausible, and wrong.
      const startedAt = Date.now();

      const { res, failureCode } = await generateInvoice(caller, ctx, body, actor);

      await emitEvent(caller.admin, failureCode === null
        ? { ...base, eventName: "practice.invoice.generated", outcome: "success", durationMs: Date.now() - startedAt }
        : { ...base, eventName: "practice.invoice.generate_failed", outcome: "failure", failureCode, durationMs: Date.now() - startedAt });

      return res;
    }
    case "issueInvoice": {
      const result = await issueInvoice(caller.admin, ctx, {
        invoiceId: String(body.invoiceId ?? ""), dueDate: body.dueDate ?? null, ...actor,
      });
      return respond(result, caller.traceId);
    }
    case "voidInvoice": {
      const result = await voidInvoice(caller.admin, ctx, {
        invoiceId: String(body.invoiceId ?? ""), reason: String(body.reason ?? ""), ...actor,
      });
      return respond(result, caller.traceId);
    }
    case "recordPayment": {
      if (!Array.isArray(body.allocations)) return bad("allocations must be an array");
      const result = await recordPayment(caller.admin, ctx, {
        patientId: body.patientId ?? null, payerKind: body.payerKind, payerLabel: body.payerLabel ?? null,
        amountMinor: Number(body.amountMinor), currency: String(body.currency ?? ""),
        method: String(body.method ?? ""), collector: body.collector,
        reference: body.reference ?? null, paidAtIso: body.paidAtIso ?? null,
        locationId: body.locationId ?? null, notes: body.notes ?? null,
        allocations: body.allocations.map((a: any) => ({
          invoiceId: a?.invoiceId ?? null, chargeId: a?.chargeId ?? null, amountMinor: Number(a?.amountMinor),
        })),
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    case "saveEntitlement": {
      const result = await saveFacilityEntitlement(caller.admin, ctx, {
        locationId: String(body.locationId ?? ""), kind: String(body.kind ?? ""),
        percentBp: body.percentBp === undefined || body.percentBp === null ? null : Number(body.percentBp),
        fixedMinor: body.fixedMinor === undefined || body.fixedMinor === null ? null : Number(body.fixedMinor),
        currency: body.currency ?? null, note: body.note ?? null, ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    case "recordSettlement": {
      if (!Array.isArray(body.items)) return bad("items must be an array");
      const result = await recordSettlement(caller.admin, ctx, {
        locationId: String(body.locationId ?? ""), periodFrom: String(body.periodFrom ?? ""),
        periodTo: String(body.periodTo ?? ""), currency: String(body.currency ?? ""),
        receivedMinor: Number(body.receivedMinor), receivedOn: body.receivedOn ?? null,
        method: body.method ?? null, reference: body.reference ?? null, note: body.note ?? null,
        items: body.items.map((i: any) => ({
          paymentId: String(i?.paymentId ?? ""),
          entitlementMinor: i?.entitlementMinor === undefined || i?.entitlementMinor === null ? null : Number(i.entitlementMinor),
        })),
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    case "recordAdjustment": {
      const result = await recordAdjustment(caller.admin, ctx, {
        invoiceId: body.invoiceId ?? null, chargeId: body.chargeId ?? null, paymentId: body.paymentId ?? null,
        kind: String(body.kind ?? ""), amountMinor: Number(body.amountMinor),
        currency: String(body.currency ?? ""), reason: String(body.reason ?? ""), ...actor,
      });
      return respond(result, caller.traceId, 201);
    }
    default:
      return bad(`unknown action "${String(body.action ?? "")}"`);
  }
}

function respond(result: any, correlationId: string, okStatus = 200) {
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId }, { status: okStatus });
}

/**
 * The draft-invoice body, unchanged, moved out so the case above can pair its attempt with exactly one
 * outcome. Every return names its failure code; none returns a response the pairing cannot see.
 */
async function generateInvoice(
  caller: { admin: any; userId: string; traceId: string },
  ctx: any,
  body: Record<string, any>,
  actor: { actorId: string; correlationId: string },
): Promise<{ res: NextResponse; failureCode: string | null }> {
  if (!Array.isArray(body.chargeIds)) {
    return { res: bad("chargeIds must be an array"), failureCode: "CHARGE_IDS_NOT_ARRAY" };
  }
  const result = await createDraftInvoice(caller.admin, ctx, {
    chargeIds: body.chargeIds.map((s: any) => String(s)),
    payerKind: body.payerKind, payerLabel: body.payerLabel ?? null, dueDate: body.dueDate ?? null, ...actor,
  });
  return { res: respond(result, caller.traceId, 201), failureCode: result.ok ? null : result.code };
}
