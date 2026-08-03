import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listPhrases, createPhrase, deletePhrase, expandPhrases, recordPhraseUse } from "@/lib/practice/documentation-tools";

// GET    /api/v1/practice/smart-phrases            -- shared phrases plus the caller's own
// POST   /api/v1/practice/smart-phrases            -- create one, personal or shared
// POST   /api/v1/practice/smart-phrases?expand=1   -- expand a block of text (and count the uses)
// DELETE /api/v1/practice/smart-phrases?id=        -- remove one
//
// encounter.edit throughout: a phrase is a way of writing a note faster, so the people who may write
// notes are the people who may keep phrases. Sharing one with the whole practice needs template.manage,
// because it puts words into colleagues' notes.

export async function GET() {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const phrases = await listPhrases(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId);
  return NextResponse.json({ phrases, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (new URL(req.url).searchParams.get("expand") === "1") {
    const phrases = await listPhrases(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId);
    const result = expandPhrases(String(body.text ?? ""), phrases);
    await recordPhraseUse(auth.caller.admin, auth.ctx.workspaceId, result.expanded, auth.caller.userId);
    return NextResponse.json({ ...result, correlationId: auth.caller.traceId });
  }

  const shared = body.shared === true;
  if (shared) {
    // Re-checked rather than assumed from the first guard: sharing a phrase writes into everybody
    // else's notes, which is a different act from keeping one of your own.
    const admin = await requirePracticeContext("template.manage");
    if (isDenied(admin)) return NextResponse.json({ error: "sharing a phrase with the practice needs template.manage" }, { status: 403 });
  }

  const result = await createPhrase(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, shortcut: String(body.shortcut ?? ""), body: String(body.body ?? ""),
    description: body.description ? String(body.description) : undefined, shared,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ phrase: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const result = await deletePhrase(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, phraseId: id,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
