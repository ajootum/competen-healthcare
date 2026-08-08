import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  submitFormForApproval, withdrawFormFromReview, syncFormApproval,
  publishForm, archiveForm, reviseForm,
} from "@/lib/practice/forms";
import { FORM_CAPABILITIES, FORM_TRANSITIONS } from "@/lib/practice/form-constants";

// POST /api/v1/practice/forms/[id]/lifecycle -- CPR-KS-001 section 3's Version Engine, as moves.
//
// ⚠ ONE ROUTE FOR EVERY MOVE, AND THE MOVES ARE A CLOSED LIST. An action this route does not know is
// refused by NAME, with the list -- a lifecycle endpoint that quietly does nothing for an unrecognised
// verb is how somebody comes to believe a form is in use when it is not.
//
// ⚠ THIS ROUTE DOES NOT DECIDE AN APPROVAL. `sync` reads the decision that delegation.ts recorded,
// including its refusal to let anybody approve their own work.

const ACTIONS = ["submit", "withdraw", "sync", "publish", "archive", "revise"] as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ formId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  const { formId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  if (!(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({
      error: {
        code: "UNKNOWN_ACTION",
        message: `"${action}" is not something a form can do. The moves that exist are: ${ACTIONS.join(", ")} -- covering ${FORM_TRANSITIONS.length} transitions.`,
      },
    }, { status: 400 });

  const base = { workspaceId: auth.ctx.workspaceId, formId, actorId: auth.ctx.userId, correlationId: auth.caller.traceId };

  const result =
    action === "submit" ? await submitFormForApproval(auth.caller.admin, {
      ...base,
      assignedTo: body.assignedTo ? String(body.assignedTo) : null,
      urgency: body.urgency ? String(body.urgency) : "routine",
    })
    : action === "withdraw" ? await withdrawFormFromReview(auth.caller.admin, base)
    : action === "sync" ? await syncFormApproval(auth.caller.admin, base)
    : action === "publish" ? await publishForm(auth.caller.admin, {
      ...base,
      effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
      reviewOn: body.reviewOn ? String(body.reviewOn) : null,
    })
    : action === "archive" ? await archiveForm(auth.caller.admin, { ...base, reason: String(body.reason ?? "") })
    : await reviseForm(auth.caller.admin, base);

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
