import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { addDecision, removeDecision } from "@/lib/practice/encounter-workspace";

// POST   /api/v1/practice/encounters/{id}/decisions  -- CPR-ENC-001 s3's "decisions".
// DELETE /api/v1/practice/encounters/{id}/decisions?decisionId=...
//
// A decision is the unit CompetenPractice is organised around: countable, attributable, and individually
// referenceable from a timeline. It is a row rather than a paragraph in a note for exactly that reason.
//
// Both verbs go through editableEncounter in the engine, so a signed encounter refuses them -- and the
// capability is encounter.edit, which is a real code in practice_role_capabilities (migration 191).

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await addDecision(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, decision: String(body.decision ?? ""),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ decision: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const decisionId = new URL(req.url).searchParams.get("decisionId");
  if (!decisionId) return NextResponse.json({ error: "decisionId is required" }, { status: 400 });

  const result = await removeDecision(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, decisionId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ removed: result.data, correlationId: auth.caller.traceId });
}
