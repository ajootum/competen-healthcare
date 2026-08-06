import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { setEncounterOutcome } from "@/lib/practice/encounters";

// PUT /api/v1/practice/encounters/{id}/outcome -- CPR-ENC-001 s3 / CPR-ENC-002 s4.
//
// PUT rather than POST: an encounter has exactly one outcome and setting it twice is not two outcomes.
// `null` clears it, which is a real thing a practitioner may need to do after choosing too quickly.
//
// A MISSING OUTCOME IS NEVER A REFUSAL ANYWHERE ELSE. CPR-ENC-002 s7 asks for a warning on a missing
// outcome and the workspace returns one; this route exists so that the answer, when there is one, is
// recorded. The single refusal here is an outcome of "other" with nothing said -- that is the
// get-past-the-field answer, and the database refuses it too.

export async function PUT(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await setEncounterOutcome(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId,
    outcome: body.outcome === null || body.outcome === undefined ? null : String(body.outcome),
    outcomeNote: body.outcomeNote === undefined ? null : String(body.outcomeNote),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ encounter: result.data, correlationId: auth.caller.traceId });
}
