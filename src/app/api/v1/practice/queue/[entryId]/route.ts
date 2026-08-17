import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { transitionQueueEntry, checkInQueueEntry, attachPatientToQueueEntry } from "@/lib/practice/scheduling";

// PATCH /api/v1/practice/queue/{entryId} { action } -- queue movement (DM-001 s7 QueueEntry states).
// Capability queue.manage: the assistant runs the waiting room; the auditor does not.
//
// `check_in` is the one action here that is NOT a state move: it re-stamps the arrival on a row
// carried over from a previous day. The engine decides staleness against the practice's own day and
// refuses to touch a stamp that is already today's truth.

const ACTIONS: Record<string, string> = {
  ready: "READY",
  wait: "WAITING",
  start: "IN_CONSULTATION",
  pause: "PAUSED",
  complete: "COMPLETED",
  left: "LEFT",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const auth = await requirePracticeContext("queue.manage");
  if (isDenied(auth)) return auth;
  const { entryId } = await params;

  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  // #18: attach a registered patient to a name-only arrival. Not a state move either -- identity,
  // once, with the engine refusing re-pointing and inactive records.
  if (body.action === "attach") {
    const result = await attachPatientToQueueEntry(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, entryId,
      patientId: String((body as Record<string, unknown>).patientId ?? ""),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ entry: result.data, correlationId: auth.caller.traceId });
  }

  if (body.action === "check_in") {
    const result = await checkInQueueEntry(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, entryId,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ entry: result.data, correlationId: auth.caller.traceId });
  }

  const to = ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: check_in, ${Object.keys(ACTIONS).join(", ")}` }, { status: 400 });

  const result = await transitionQueueEntry(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, entryId, to,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ entry: result.data, correlationId: auth.caller.traceId });
}
