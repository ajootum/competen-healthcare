import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getFollowUp, scheduleFollowUp, closeFollowUp, rescheduleFollowUp, deferFollowUp } from "@/lib/practice/follow-ups";
import { FOLLOW_UP_ACTIONS } from "@/lib/practice/follow-up-constants";

// GET   /api/v1/practice/follow-ups/{id}
// PATCH /api/v1/practice/follow-ups/{id} -- one of four shapes:
//         { appointmentId }             link a live booking (OPEN -> SCHEDULED)
//         { dueOn, reason? }            CPR-FUP-002 s7 reschedule -- the old date survives in the trail
//         { deferUntil, reason? }       CPR-FUP-002 s4 defer -- the date it comes back is required
//         { action, outcome?, closingEncounterId? }  complete / missed / cancel / reopen / activate

export async function GET(_req: NextRequest, { params }: { params: Promise<{ followUpId: string }> }) {
  const auth = await requirePracticeContext("followup.view");
  if (isDenied(auth)) return auth;
  const { followUpId } = await params;

  const detail = await getFollowUp(auth.caller.admin, auth.ctx.workspaceId, followUpId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ followUpId: string }> }) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;
  const { followUpId } = await params;

  let body: {
    appointmentId?: string; action?: string; outcome?: string; outcomeCode?: string;
    closingEncounterId?: string; dueOn?: string; deferUntil?: string; reason?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  // Ordered before the action branch on purpose: a reschedule is not a state change and must not be
  // expressible as one, or the trail would record a transition that never happened.
  if (body.dueOn) {
    const result = await rescheduleFollowUp(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, followUpId, dueOn: String(body.dueOn),
      reason: body.reason, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId });
  }

  if (body.deferUntil) {
    const result = await deferFollowUp(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, followUpId, until: String(body.deferUntil),
      reason: body.reason, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId });
  }

  if (body.appointmentId) {
    const result = await scheduleFollowUp(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, followUpId, appointmentId: body.appointmentId,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId });
  }

  const to = FOLLOW_UP_ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(FOLLOW_UP_ACTIONS).join(", ")}` }, { status: 400 });

  const result = await closeFollowUp(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, followUpId, to,
    outcome: body.outcome, outcomeCode: body.outcomeCode ?? null,
    closingEncounterId: body.closingEncounterId ?? null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId });
}
