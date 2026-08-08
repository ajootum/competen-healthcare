import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  getChecklistRun, recordResponses, completeChecklistRun, abandonChecklistRun,
} from "@/lib/practice/checklist";
import { CHECKLIST_CAPABILITIES } from "@/lib/practice/checklist-constants";

// GET  /api/v1/practice/checklist-runs/[id] -- one completion record.
// POST /api/v1/practice/checklist-runs/[id] -- record answers, close it, or abandon it.
//
// ⚠ A SEPARATE TREE FROM /checklists/[id], DELIBERATELY. A run id under the checklist's path would make
// /checklists/runs ambiguous with a checklist whose id happened to be "runs", and the resolution would be
// a Next.js routing rule rather than anything a reader could see.
//
// ⚠ THE ANSWER PATH IS THE ONE PLACE A WITHDRAWN ITEM'S ANSWER IS THROWN AWAY, and it is the ENGINE's
// `recordResponses` that does it -- against what is stored, not against what this route was sent. A
// client is a claim. See the block comment on recordResponses in checklist.ts.

const ACTIONS = ["record", "complete", "abandon"] as const;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const auth = await requirePracticeContext(CHECKLIST_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const { runId } = await ctx.params;
  const detail = await getChecklistRun(auth.caller.admin, auth.ctx.workspaceId, runId);
  if (detail.state === "not_found")
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({ detail, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const auth = await requirePracticeContext(CHECKLIST_CAPABILITIES.complete);
  if (isDenied(auth)) return auth;

  const { runId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  if (!(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({
      error: {
        code: "UNKNOWN_ACTION",
        message: `"${action}" is not something a completion record can do. What exists is: ${ACTIONS.join(", ")}.`,
      },
    }, { status: 400 });

  const base = { workspaceId: auth.ctx.workspaceId, runId, actorId: auth.ctx.userId, correlationId: auth.caller.traceId };

  const result =
    action === "record" ? await recordResponses(auth.caller.admin, {
      ...base,
      answers: Array.isArray(body.answers)
        ? (body.answers as Record<string, unknown>[]).map(a => ({
            itemKey: String(a.itemKey ?? ""),
            response: String(a.response ?? ""),
            note: a.note ? String(a.note) : null,
          }))
        : [],
    })
    : action === "complete" ? await completeChecklistRun(auth.caller.admin, base)
    : await abandonChecklistRun(auth.caller.admin, { ...base, reason: String(body.reason ?? "") });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
