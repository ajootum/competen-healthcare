import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { noteHistory, applyTemplate } from "@/lib/practice/documentation";

// GET  /api/v1/practice/encounters/{id}/notes -- every recorded version of every segment (CPR-130).
// POST /api/v1/practice/encounters/{id}/notes -- { templateId, mode } apply a template.
//
// HISTORY IS READABLE WITH encounter.list, not encounter.edit. Someone reviewing a colleague's record --
// or the practitioner reading their own signed encounter -- needs to see how the note reached its final
// text without holding the right to change it.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const history = await noteHistory(auth.caller.admin, auth.ctx.workspaceId, encounterId);
  return NextResponse.json({ history, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: { templateId?: string; mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });

  const result = await applyTemplate(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, templateId: body.templateId,
    mode: body.mode === "replace" ? "replace" : "fill_empty",
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ applied: result.data, correlationId: auth.caller.traceId });
}
