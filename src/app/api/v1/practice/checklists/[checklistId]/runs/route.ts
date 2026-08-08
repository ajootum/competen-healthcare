import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { startChecklistRun } from "@/lib/practice/checklist";
import { CHECKLIST_CAPABILITIES } from "@/lib/practice/checklist-constants";

// POST /api/v1/practice/checklists/[id]/runs -- start filling one in.
//
// ⚠ STARTING A COMPLETION RECORD TAKES task.manage, NOT template.manage, and the split is the point.
// Filling a checklist in is not authoring one: the person who does the ward round is often not the
// person who wrote the list. task.manage is held by practitioner, practice_assistant and practice_owner,
// which is that audience -- and it is an APPROXIMATION, declared as one in checklist-constants.ts,
// because no `checklist.complete` code is seeded and inventing one would 403 for everybody silently.

export async function POST(req: NextRequest, ctx: { params: Promise<{ checklistId: string }> }) {
  const auth = await requirePracticeContext(CHECKLIST_CAPABILITIES.complete);
  if (isDenied(auth)) return auth;

  const { checklistId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  const result = await startChecklistRun(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    checklistId,
    patientId: body.patientId ? String(body.patientId) : null,
    contextNote: body.contextNote ? String(body.contextNote) : null,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
