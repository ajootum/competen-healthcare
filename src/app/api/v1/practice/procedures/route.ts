import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listProcedures, recordProcedure, procedureActivity } from "@/lib/practice/procedures";
import { ensureConsultationStarted } from "@/lib/practice/encounters";

// GET  /api/v1/practice/procedures?encounterId=&patientId=&activity=1 -- CPR-150.
// POST /api/v1/practice/procedures                                    -- record what was done.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("activity") === "1") {
    const activity = await procedureActivity(auth.caller.admin, auth.ctx.workspaceId, url.searchParams.get("since") ?? undefined);
    return NextResponse.json({ activity, correlationId: auth.caller.traceId });
  }

  const procedures = await listProcedures(auth.caller.admin, auth.ctx.workspaceId, {
    encounterId: url.searchParams.get("encounterId") ?? undefined,
    patientId: url.searchParams.get("patientId") ?? undefined,
  });
  return NextResponse.json({ procedures, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.encounterId) return NextResponse.json({ error: "encounterId is required" }, { status: 400 });

  const result = await recordProcedure(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    encounterId: String(body.encounterId),
    procedureTypeId: body.procedureTypeId ? String(body.procedureTypeId) : null,
    label: body.label ? String(body.label) : undefined,
    treatmentId: body.treatmentId ? String(body.treatmentId) : null,
    site: body.site ? String(body.site) : undefined,
    laterality: body.laterality ? String(body.laterality) : undefined,
    indication: body.indication ? String(body.indication) : undefined,
    consentStatus: body.consentStatus ? String(body.consentStatus) : undefined,
    consentNote: body.consentNote ? String(body.consentNote) : undefined,
    anaesthesia: body.anaesthesia ? String(body.anaesthesia) : undefined,
    materials: body.materials ? String(body.materials) : undefined,
    immediateOutcome: body.immediateOutcome ? String(body.immediateOutcome) : undefined,
    status: body.status ? String(body.status) : undefined,
    abandonedReason: body.abandonedReason ? String(body.abandonedReason) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // Walkthrough #5: documenting is consulting -- a recorded procedure starts a DRAFT consultation.
  await ensureConsultationStarted(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId: String(body.encounterId),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ procedure: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
