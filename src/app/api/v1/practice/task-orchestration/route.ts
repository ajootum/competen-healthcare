import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  setRecurrence, listTaskTemplates, createTaskTemplate, applyTaskTemplate,
  setEscalationRule, listEscalationRules, escalations, dailyAgenda, bulkTransition,
} from "@/lib/practice/task-orchestration";

// GET   /api/v1/practice/task-orchestration                  -- today's agenda
// GET   /api/v1/practice/task-orchestration?view=escalations -- what has breached its rule, right now
// GET   /api/v1/practice/task-orchestration?view=templates   -- task templates
// GET   /api/v1/practice/task-orchestration?view=rules       -- escalation rules
// POST  /api/v1/practice/task-orchestration                  -- author or apply a template
// PATCH /api/v1/practice/task-orchestration                  -- set recurrence, a rule, or bulk-close
//
// READING the agenda takes task.view; everything that changes something takes task.manage.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("task.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  switch (url.searchParams.get("view")) {
    case "escalations": {
      const result = await escalations(auth.caller.admin, auth.ctx.workspaceId);
      // NOTHING WAS SENT AND NOTHING FIRED, as a field rather than a footnote: escalation here is
      // computed at read time, and a client must not render it as an alert that went out.
      return NextResponse.json({ ...result, correlationId: auth.caller.traceId });
    }
    case "templates": {
      const templates = await listTaskTemplates(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ templates, correlationId: auth.caller.traceId });
    }
    case "rules": {
      const rules = await listEscalationRules(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ rules, correlationId: auth.caller.traceId });
    }
    default: {
      const agenda = await dailyAgenda(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId,
        url.searchParams.get("day") ?? undefined);
      return NextResponse.json({ ...agenda, correlationId: auth.caller.traceId });
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("task.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ctx = { workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, correlationId: auth.caller.traceId };
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.template) {
    const t = body.template;
    const result = await createTaskTemplate(auth.caller.admin, {
      ...ctx, code: String(t.code ?? ""), title: String(t.title ?? ""), description: t.description,
      items: Array.isArray(t.items) ? t.items : [],
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (!body.templateId) return NextResponse.json({ error: "template or templateId is required" }, { status: 400 });
  const result = await applyTaskTemplate(auth.caller.admin, {
    ...ctx, templateId: String(body.templateId), assignedTo: String(body.assignedTo ?? auth.caller.userId),
    patientId: body.patientId ?? null, startDay: body.startDay,
  });
  if (!result.ok) return fail(result);
  // `refused` travels with a success: a four-task checklist that produced three is not a checklist.
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("task.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ctx = { workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, correlationId: auth.caller.traceId };
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (Array.isArray(body.taskIds)) {
    const result = await bulkTransition(auth.caller.admin, {
      ...ctx, taskIds: body.taskIds.map(String), to: String(body.to ?? "DONE"),
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, requested: body.taskIds.length, correlationId: auth.caller.traceId });
  }

  if (body.priority !== undefined) {
    const result = await setEscalationRule(auth.caller.admin, {
      ...ctx, priority: String(body.priority), daysOverdue: Number(body.daysOverdue),
      notifyUserId: body.notifyUserId ?? null,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ rule: result.data, correlationId: auth.caller.traceId });
  }

  if (!body.taskId) return NextResponse.json({ error: "taskId, taskIds or priority is required" }, { status: 400 });
  const result = await setRecurrence(auth.caller.admin, {
    ...ctx, taskId: String(body.taskId),
    recurrence: body.recurrence === null || body.recurrence === "" ? null : String(body.recurrence),
    until: body.until ?? null,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
