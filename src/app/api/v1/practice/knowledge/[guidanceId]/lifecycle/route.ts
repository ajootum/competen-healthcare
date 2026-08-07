import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  submitGuidanceForApproval, withdrawGuidanceFromReview, syncGuidanceApproval,
  publishGuidance, archiveGuidance, reviseGuidance,
} from "@/lib/practice/knowledge";
import { KNOWLEDGE_CAPABILITIES, GUIDANCE_TRANSITIONS } from "@/lib/practice/knowledge-constants";

// POST /api/v1/practice/knowledge/[id]/lifecycle -- CPR-KS-001 section 3's Version Engine, as moves.
//
// ⚠ ONE ROUTE FOR EVERY MOVE, AND THE MOVES ARE A CLOSED LIST. Six actions, each mapping to one
// transition in GUIDANCE_TRANSITIONS. An action this route does not know is refused by NAME, with the
// list -- a lifecycle endpoint that quietly does nothing for an unrecognised verb is how somebody comes
// to believe a document is published when it is not.
//
// ⚠ THIS ROUTE DOES NOT DECIDE AN APPROVAL. `sync` reads the decision that delegation.ts recorded,
// including its refusal to let anybody approve their own work. Deciding here would be a second place
// that rule has to be remembered, and the second place is always the one that forgets.

const ACTIONS = ["submit", "withdraw", "sync", "publish", "archive", "revise"] as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ guidanceId: string }> }) {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  const { guidanceId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  if (!(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({
      error: {
        code: "UNKNOWN_ACTION",
        message: `"${action}" is not something a guidance document can do. The moves that exist are: ${ACTIONS.join(", ")} -- covering ${GUIDANCE_TRANSITIONS.length} transitions.`,
      },
    }, { status: 400 });

  const base = { workspaceId: auth.ctx.workspaceId, guidanceId, actorId: auth.ctx.userId, correlationId: auth.caller.traceId };

  const result =
    action === "submit" ? await submitGuidanceForApproval(auth.caller.admin, {
      ...base,
      assignedTo: body.assignedTo ? String(body.assignedTo) : null,
      urgency: body.urgency ? String(body.urgency) : "routine",
    })
    : action === "withdraw" ? await withdrawGuidanceFromReview(auth.caller.admin, base)
    : action === "sync" ? await syncGuidanceApproval(auth.caller.admin, base)
    : action === "publish" ? await publishGuidance(auth.caller.admin, {
      ...base,
      effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
      reviewOn: body.reviewOn ? String(body.reviewOn) : null,
    })
    : action === "archive" ? await archiveGuidance(auth.caller.admin, { ...base, reason: String(body.reason ?? "") })
    : await reviseGuidance(auth.caller.admin, base);

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
