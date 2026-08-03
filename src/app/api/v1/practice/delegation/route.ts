import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  delegateArea, withdrawDelegation, delegationBoard,
  listRoleTemplates, createRoleTemplate, applyRoleTemplate,
  requestApproval, decideApproval, listApprovals, workQueues,
} from "@/lib/practice/delegation";

// GET   /api/v1/practice/delegation                -- the board: who holds what, by area
// GET   /api/v1/practice/delegation?view=approvals -- the approval queue
// GET   /api/v1/practice/delegation?view=queues    -- the derived work queues
// GET   /api/v1/practice/delegation?view=templates -- role templates
// POST  /api/v1/practice/delegation                -- delegate an area, apply a template, author a
//                                                     template, or request an approval
// PATCH /api/v1/practice/delegation                -- withdraw a delegation, or decide an approval
//
// GRANTING takes practice.members.manage, exactly as the capability-level delegation did. REQUESTING and
// DECIDING an approval do not: asking a colleague to look at something is not an administrative act, and
// requiring the members permission to review a letter would put approvals out of reach of the
// practitioners the queue exists for.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  switch (url.searchParams.get("view")) {
    case "approvals": {
      const approvals = await listApprovals(auth.caller.admin, auth.ctx.workspaceId, {
        status: url.searchParams.get("status") ?? undefined,
        assignedTo: url.searchParams.get("mine") === "1" ? auth.caller.userId : undefined,
      });
      // AN APPROVAL IS A QUEUE, NOT A GATE, and the field says so rather than the page having to
      // remember. Unapproved work is not blocked; the delegate could do it because they held the
      // capability. A client that rendered this as an authorisation would be wrong.
      return NextResponse.json({ approvals, blocksWork: false, correlationId: auth.caller.traceId });
    }
    case "queues": {
      const queues = await workQueues(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId);
      return NextResponse.json({ ...queues, correlationId: auth.caller.traceId });
    }
    case "templates": {
      const templates = await listRoleTemplates(auth.caller.admin, auth.ctx.workspaceId, {
        includeInactive: url.searchParams.get("includeInactive") === "1",
      });
      return NextResponse.json({ templates, correlationId: auth.caller.traceId });
    }
    default: {
      const board = await delegationBoard(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ ...board, correlationId: auth.caller.traceId });
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  // Asking for a review is not an administrative act -- checked first, so the members guard below never
  // stands between a practitioner and their own queue.
  if (body.approval) {
    const a = body.approval;
    const result = await requestApproval(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, subjectKind: String(a.subjectKind ?? "other"),
      subjectId: a.subjectId ?? null, patientId: a.patientId ?? null, area: a.area ?? null,
      summary: String(a.summary ?? ""), urgency: a.urgency, assignedTo: a.assignedTo ?? null,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ approval: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const manage = await requirePracticeContext("practice.members.manage");
  if (isDenied(manage)) return manage;

  if (body.template) {
    const t = body.template;
    const result = await createRoleTemplate(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, code: String(t.code ?? ""), title: String(t.title ?? ""),
      description: t.description, areas: Array.isArray(t.areas) ? t.areas.map(String) : [],
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (!body.membershipId) return NextResponse.json({ error: "membershipId is required" }, { status: 400 });

  if (body.templateId) {
    const result = await applyRoleTemplate(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, membershipId: String(body.membershipId),
      templateId: String(body.templateId), effectiveTo: String(body.effectiveTo ?? ""),
      note: body.note, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    // `refused` travels with a SUCCESS: some of the template landed and some did not, and somebody who
    // only checked the status code would believe the cover is fully in place.
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const result = await delegateArea(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, membershipId: String(body.membershipId),
    area: String(body.area ?? ""), effectiveTo: String(body.effectiveTo ?? ""),
    effectiveFrom: body.effectiveFrom, locationId: body.locationId ?? null, note: body.note,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ delegation: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.approvalId) {
    const decision = body.decision === "APPROVED" ? "APPROVED" : body.decision === "REJECTED" ? "REJECTED" : null;
    if (!decision) return NextResponse.json({ error: "decision must be APPROVED or REJECTED" }, { status: 400 });
    const result = await decideApproval(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, approvalId: String(body.approvalId), decision,
      note: body.note ? String(body.note) : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const manage = await requirePracticeContext("practice.members.manage");
  if (isDenied(manage)) return manage;

  if (!body.delegationId) return NextResponse.json({ error: "delegationId or approvalId is required" }, { status: 400 });
  const result = await withdrawDelegation(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, delegationId: String(body.delegationId),
    reason: String(body.reason ?? ""), actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
