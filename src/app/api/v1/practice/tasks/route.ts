import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listTasks, createTask, taskBoard, listMembers } from "@/lib/practice/tasks";

// GET  /api/v1/practice/tasks?board=1&assignedTo=&status=&patientId= -- CPR-340.
// POST /api/v1/practice/tasks                                        -- raise one.
//
// THE BOARD IS SCOPED TO THE CALLER, from the session and never from a query parameter: "my tasks" is a
// fact about who is asking, and letting the client name the person would make it a fact about who asks
// nicely.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("task.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("board") === "1") {
    const [board, members] = await Promise.all([
      taskBoard(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId),
      listMembers(auth.caller.admin, auth.ctx.workspaceId),
    ]);
    return NextResponse.json({ board, members, me: auth.caller.userId, correlationId: auth.caller.traceId });
  }

  const status = url.searchParams.get("status");
  const tasks = await listTasks(auth.caller.admin, auth.ctx.workspaceId, {
    assignedTo: url.searchParams.get("assignedTo") ?? undefined,
    patientId: url.searchParams.get("patientId") ?? undefined,
    status: status ? status.split(",") : undefined,
  });
  return NextResponse.json({ tasks, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("task.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createTask(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    title: String(body.title ?? ""),
    detail: body.detail ? String(body.detail) : undefined,
    // Unassigned means yours. A task nobody owns is a wish, and defaulting to the raiser is the
    // honest reading of "I need to do this".
    assignedTo: body.assignedTo ? String(body.assignedTo) : auth.caller.userId,
    patientId: body.patientId ? String(body.patientId) : null,
    encounterId: body.encounterId ? String(body.encounterId) : null,
    documentId: body.documentId ? String(body.documentId) : null,
    followUpId: body.followUpId ? String(body.followUpId) : null,
    category: body.category ? String(body.category) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
    dueOn: body.dueOn ? String(body.dueOn) : null,
    remindOn: body.remindOn ? String(body.remindOn) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ task: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
