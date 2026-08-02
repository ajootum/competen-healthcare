import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { mergePatients } from "@/lib/practice/patients";

// POST /api/v1/practice/patients/{id}/merge { duplicatePatientId, reason } -- the privileged workflow
// (DM-001 s6.1: "irreversible clinical merge requires privileged workflow and audit"). {id} in the URL
// is the SURVIVOR; the body names the duplicate that folds into it. patient.merge is practitioner-only
// in the capability catalog -- an assistant can register and edit, but joining two clinical histories is
// a clinical judgement.
export async function POST(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.merge");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  let body: { duplicatePatientId?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.duplicatePatientId) return NextResponse.json({ error: "duplicatePatientId is required" }, { status: 400 });

  const result = await mergePatients(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, survivingId: patientId, duplicateId: body.duplicatePatientId,
    reason: body.reason, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ merge: result.data, correlationId: auth.caller.traceId });
}
