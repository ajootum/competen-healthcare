import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getProcedure, recordProcedureOutcome } from "@/lib/practice/procedures";

// GET  /api/v1/practice/procedures/{id}
// POST /api/v1/practice/procedures/{id}/outcome is spelled as a POST here with { outcomeType, detail },
//      because an outcome is APPENDED and never edited -- a PATCH on this path would suggest otherwise,
//      and the database refuses an update to an outcome row anyway (migration 197 s5).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ procedureId: string }> }) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;
  const { procedureId } = await params;

  const detail = await getProcedure(auth.caller.admin, auth.ctx.workspaceId, procedureId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ procedureId: string }> }) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;
  const { procedureId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await recordProcedureOutcome(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, procedureId,
    observedAtEncounterId: body.observedAtEncounterId ? String(body.observedAtEncounterId) : null,
    outcomeType: String(body.outcomeType ?? "note"),
    severity: body.severity ? String(body.severity) : undefined,
    detail: String(body.detail ?? ""),
    observedOn: body.observedOn ? String(body.observedOn) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ outcome: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
