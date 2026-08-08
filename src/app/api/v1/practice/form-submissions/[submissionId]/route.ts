import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  getFormSubmission, recordAnswers, submitFormSubmission, abandonFormSubmission,
} from "@/lib/practice/forms";
import { FORM_CAPABILITIES } from "@/lib/practice/form-constants";

// GET  /api/v1/practice/form-submissions/[id] -- one completed form.
// POST /api/v1/practice/form-submissions/[id] -- record answers, submit it, or abandon it.
//
// ⚠ A SEPARATE TREE FROM /forms/[id], DELIBERATELY. A submission id under the form's path would make
// /forms/submissions ambiguous with a form whose id happened to be "submissions", and the resolution would
// be a Next.js routing rule rather than anything a reader could see.
//
// ⚠ THE ANSWER PATH IS THE ONE PLACE A WITHDRAWN QUESTION'S ANSWER IS THROWN AWAY, and it is the ENGINE's
// `recordAnswers` that does it -- against what is stored, not against what this route was sent. A client
// is a claim. See the block comment on recordAnswers in forms.ts.
//
// ⚠ AND THE VALUE IS PASSED THROUGH UNTOUCHED. A route coercing it to a string would defeat the whole
// point of validateAnswer returning a NORMALISED value: a multi-select answer is an array and a number
// answer is a number, and both have to survive the journey to be stored as themselves.

const ACTIONS = ["record", "submit", "abandon"] as const;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const { submissionId } = await ctx.params;
  const detail = await getFormSubmission(auth.caller.admin, auth.ctx.workspaceId, submissionId);
  if (detail.state === "not_found")
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({ detail, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.fill);
  if (isDenied(auth)) return auth;

  const { submissionId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  if (!(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({
      error: {
        code: "UNKNOWN_ACTION",
        message: `"${action}" is not something a completed form can do. What exists is: ${ACTIONS.join(", ")}.`,
      },
    }, { status: 400 });

  const base = { workspaceId: auth.ctx.workspaceId, submissionId, actorId: auth.ctx.userId, correlationId: auth.caller.traceId };

  const result =
    action === "record" ? await recordAnswers(auth.caller.admin, {
      ...base,
      answers: Array.isArray(body.answers)
        ? (body.answers as Record<string, unknown>[]).map(a => ({
            fieldKey: String(a.fieldKey ?? ""),
            value: a.value,
          }))
        : [],
    })
    : action === "submit" ? await submitFormSubmission(auth.caller.admin, base)
    : await abandonFormSubmission(auth.caller.admin, { ...base, reason: String(body.reason ?? "") });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
