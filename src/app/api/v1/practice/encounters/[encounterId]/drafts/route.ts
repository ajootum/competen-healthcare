import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { saveDraft, myDrafts, discardDraft } from "@/lib/practice/documentation-tools";

// GET    /api/v1/practice/encounters/{id}/drafts             -- the CALLER's own unsaved text
// PUT    /api/v1/practice/encounters/{id}/drafts             -- autosave one segment
// DELETE /api/v1/practice/encounters/{id}/drafts?noteType=   -- throw it away
//
// THERE IS NO WAY TO ASK FOR SOMEBODY ELSE'S DRAFT. No parameter, no capability that unlocks it. Unsaved
// text is a thought in progress; a colleague reading half a sentence about a differential nobody has
// settled on is worse served than by seeing nothing.
//
// encounter.edit, not encounter.view: writing a draft is part of writing the note.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const result = await myDrafts(auth.caller.admin, auth.ctx.workspaceId, encounterId, auth.caller.userId);
  return NextResponse.json({ ...result, correlationId: auth.caller.traceId });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await saveDraft(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId,
    noteType: String(body.noteType ?? ""), body: String(body.body ?? ""),
    basedOnVersion: typeof body.basedOnVersion === "number" ? body.basedOnVersion : null,
    actorId: auth.caller.userId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // `draft: true` on every response, so a client cannot render an autosave confirmation as though the
  // record had been written to.
  return NextResponse.json({ ...result.data, draft: true, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const noteType = new URL(req.url).searchParams.get("noteType") ?? "";
  const result = await discardDraft(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, noteType, actorId: auth.caller.userId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
