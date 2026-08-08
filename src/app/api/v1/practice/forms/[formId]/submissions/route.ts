import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { startFormSubmission } from "@/lib/practice/forms";
import { FORM_CAPABILITIES } from "@/lib/practice/form-constants";

// POST /api/v1/practice/forms/[id]/submissions -- start filling one in.
//
// ⚠ STARTING ONE TAKES task.manage, NOT template.manage, and the split is the point. Filling a form in is
// not authoring it: the assistant at the desk has to be able to do the first without the second.
// task.manage is held by practitioner, practice_assistant and practice_owner, which is that audience --
// and it is an APPROXIMATION, declared as one in form-constants.ts, because no `form.fill` code is seeded
// and inventing one would 403 for everybody silently.
//
// ⚠ THE HONEST CONSEQUENCE, WRITTEN DOWN WHERE IT BITES: anybody who can close a task can start and
// submit a CONSENT form. That is a real widening and it is the price of not minting a code.

export async function POST(req: NextRequest, ctx: { params: Promise<{ formId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.fill);
  if (isDenied(auth)) return auth;

  const { formId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  const result = await startFormSubmission(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    formId,
    patientId: body.patientId ? String(body.patientId) : null,
    contextNote: body.contextNote ? String(body.contextNote) : null,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
