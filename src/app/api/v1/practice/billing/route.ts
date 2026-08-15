import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listFees, saveFee, saveFeeOverride, createCharge, createDraftInvoice, issueInvoice,
  voidInvoice, recordPayment, recordAdjustment, paymentsOverview, listInvoices, getInvoice,
  outstandingBalances, patientFinancial, uninvoicedCharges,
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
    case "createDraftInvoice": {
      if (!Array.isArray(body.chargeIds)) return bad("chargeIds must be an array");
      const result = await createDraftInvoice(caller.admin, ctx, {
        chargeIds: body.chargeIds.map((s: any) => String(s)),
        payerKind: body.payerKind, payerLabel: body.payerLabel ?? null, dueDate: body.dueDate ?? null, ...actor,
      });
      return respond(result, caller.traceId, 201);
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
