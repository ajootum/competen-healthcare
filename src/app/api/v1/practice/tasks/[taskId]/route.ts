import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getTask, transitionTask, reassignTask } from "@/lib/practice/tasks";
import { TASK_ACTIONS } from "@/lib/practice/task-constants";

// GET   /api/v1/practice/tasks/{id}
// PATCH /api/v1/practice/tasks/{id} -- one of two shapes:
//         { assignedTo, note? }               hand it to somebody else
//         { action, reason?, outcome? }       start / block / unblock / complete / cancel

export async function GET(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requirePracticeContext("task.view");
  if (isDenied(auth)) return auth;
  const { taskId } = await params;

  const detail = await getTask(auth.caller.admin, auth.ctx.workspaceId, taskId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requirePracticeContext("task.manage");
  if (isDenied(auth)) return auth;
  const { taskId } = await params;

  let body: { assignedTo?: string; note?: string; action?: string; reason?: string; outcome?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.assignedTo) {
    const result = await reassignTask(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, taskId, assignedTo: body.assignedTo, note: body.note,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ task: result.data, correlationId: auth.caller.traceId });
  }

  const to = TASK_ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(TASK_ACTIONS).join(", ")}` }, { status: 400 });

  const result = await transitionTask(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, taskId, to, reason: body.reason, outcome: body.outcome,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ task: result.data, correlationId: auth.caller.traceId });
}
