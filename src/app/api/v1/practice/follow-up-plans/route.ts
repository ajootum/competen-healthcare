import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  createPlan, discontinuePlan, listPlanTemplates, createPlanTemplate, setTemplateActive,
  patientFollowUps, recallQueue, outcomeSummary,
} from "@/lib/practice/follow-up-plans";

// GET  /api/v1/practice/follow-up-plans?patientId=   -- one patient's plans and every tab behind them
// GET  /api/v1/practice/follow-up-plans?view=recall  -- the practice's recall queue
// GET  /api/v1/practice/follow-up-plans?view=outcomes
// GET  /api/v1/practice/follow-up-plans?view=templates
// POST /api/v1/practice/follow-up-plans              -- { patientId, templateId | steps } start a plan
//                                                       { template: {...} }  author a plan template
// PATCH /api/v1/practice/follow-up-plans             -- { planId, reason } discontinue
//                                                       { templateId, active } retire or restore
//
// READING is followup.view; STARTING OR STOPPING a plan is followup.manage. Authoring a TEMPLATE is
// followup.manage too rather than a settings permission: a review schedule is a clinical judgement, and
// the people who make it are the people who keep the follow-ups.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("followup.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const patientId = url.searchParams.get("patientId");

  if (view === "recall") {
    const queue = await recallQueue(auth.caller.admin, auth.ctx.workspaceId);
    // NOTHING WAS SENT, and the field says so rather than the page having to remember. CPR-140's spec
    // asks for SMS, email, app, voice and WhatsApp reminders; this product has no delivery channel.
    return NextResponse.json({ ...queue, remindersSent: false, correlationId: auth.caller.traceId });
  }
  if (view === "outcomes") {
    const summary = await outcomeSummary(auth.caller.admin, auth.ctx.workspaceId, {
      fromDay: url.searchParams.get("from") ?? undefined,
      toDay: url.searchParams.get("to") ?? undefined,
    });
    return NextResponse.json({ ...summary, correlationId: auth.caller.traceId });
  }
  if (view === "templates") {
    const templates = await listPlanTemplates(auth.caller.admin, auth.ctx.workspaceId, {
      includeInactive: url.searchParams.get("includeInactive") === "1",
    });
    return NextResponse.json({ templates, correlationId: auth.caller.traceId });
  }

  if (!patientId) return NextResponse.json({ error: "patientId or view is required" }, { status: 400 });
  const detail = await patientFollowUps(auth.caller.admin, auth.ctx.workspaceId, patientId);
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.template) {
    const t = body.template;
    const result = await createPlanTemplate(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId,
      code: String(t.code ?? ""), title: String(t.title ?? ""), description: t.description,
      steps: Array.isArray(t.steps) ? t.steps : [],
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  const result = await createPlan(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    originEncounterId: body.originEncounterId ? String(body.originEncounterId) : null,
    templateId: body.templateId ? String(body.templateId) : null,
    title: body.title ? String(body.title) : undefined,
    startsOn: body.startsOn ? String(body.startsOn) : undefined,
    steps: Array.isArray(body.steps) ? body.steps : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ plan: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.templateId !== undefined) {
    const result = await setTemplateActive(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, templateId: String(body.templateId),
      active: body.active === true, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId });
  }

  if (!body.planId) return NextResponse.json({ error: "planId or templateId is required" }, { status: 400 });
  const result = await discontinuePlan(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, planId: String(body.planId), reason: String(body.reason ?? ""),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ plan: result.data, correlationId: auth.caller.traceId });
}
