import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordDiagnosis, ensureConsultationStarted } from "@/lib/practice/encounters";

// POST /api/v1/practice/encounters/{id}/diagnoses -- DM-001 s9. `problemLabel` is optional and is what
// promotes an encounter diagnosis into the patient's longitudinal problem list; omitting it records a
// diagnosis that belongs to this visit alone, which is the honest default for a one-off complaint.

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("diagnosis.record");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });

  const result = await recordDiagnosis(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, label,
    code: body.code ? String(body.code) : undefined,
    codeSystem: body.codeSystem ? String(body.codeSystem) : undefined,
    certainty: body.certainty ? String(body.certainty) : undefined,
    isPrimary: body.isPrimary === true,
    problemLabel: body.problemLabel ? String(body.problemLabel) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // Walkthrough #5: documenting is consulting -- a recorded diagnosis starts a DRAFT consultation.
  await ensureConsultationStarted(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ diagnosis: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
