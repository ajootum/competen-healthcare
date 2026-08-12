import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordProcedureBatch, MAX_PENDING_PROCEDURES } from "@/lib/practice/procedure-capture";

// POST /api/v1/practice/procedures/batch -- CP-ENC-PROC-001's working set.
//
// ⚠ ADDITIVE. The single-procedure POST beside this one keeps its shape, because the old form, the API
// consumers and a harness assertion all speak it. Overloading one body to mean two things would make
// every one of them a guess about which path ran.
//
// ⚠ SAME CAPABILITY AS THE SINGLE ROUTE (procedure.record). Verified against that file rather than
// assumed -- the diagnosis engine shipped gated on the wrong one and had to be corrected.
//
// ⚠ AND PER-ITEM OUTCOMES SURVIVE A PARTIAL FAILURE. A flat error would tell the screen that three
// recorded procedures do not exist because a fourth was refused, and re-recording them would claim
// something was done to a patient twice.

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const encounterId = String(body.encounterId ?? "");
  if (!encounterId)
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "encounterId is required" } }, { status: 400 });

  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length === 0)
    return NextResponse.json({ error: { code: "NO_ITEMS", message: "there is nothing in the working set" } }, { status: 400 });
  if (raw.length > MAX_PENDING_PROCEDURES)
    return NextResponse.json({
      error: {
        code: "TOO_MANY_ITEMS",
        message: `${raw.length} procedures were submitted and one encounter takes at most ${MAX_PENDING_PROCEDURES}`,
      },
    }, { status: 422 });

  const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

  const result = await recordProcedureBatch(auth.caller.admin, auth.ctx, {
    encounterId,
    items: (raw as Record<string, unknown>[]).map(r => ({
      procedureTypeId: r.procedureTypeId ? String(r.procedureTypeId) : null,
      label: str(r.label),
      site: str(r.site),
      // ⚠ PASSED THROUGH UNVALIDATED ON PURPOSE. recordProcedure refuses a sided procedure with no side,
      // by name. A route that defaulted laterality would satisfy that check with a value nobody chose --
      // which on a sided procedure is a wrong-site record.
      laterality: str(r.laterality),
      indication: str(r.indication),
      consentStatus: str(r.consentStatus),
      consentNote: str(r.consentNote),
      anaesthesia: str(r.anaesthesia),
      materials: str(r.materials),
      immediateOutcome: str(r.immediateOutcome),
      status: str(r.status),
      abandonedReason: str(r.abandonedReason),
    })),
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  const failed = result.data.results.filter(r => !r.ok).length;
  return NextResponse.json(
    { ...result.data, correlationId: auth.caller.traceId },
    { status: failed > 0 && result.data.recorded > 0 ? 207 : (result.data.recorded > 0 ? 201 : 422) },
  );
}
