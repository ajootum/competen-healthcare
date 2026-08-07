import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { transitionAppointment, rescheduleAppointment } from "@/lib/practice/scheduling";
import { appointmentNotice } from "@/lib/practice/messaging";

// PATCH /api/v1/practice/appointments/{id} { action } -- the state machine's only HTTP door.
// Actions map to DM-001 s7 states; the engine refuses illegal moves with 422 and version conflicts with
// 409, and `arrive` also writes the arrival record and queues the patient (CPR-V2-003 check-in workflow).
//
// PUT /api/v1/practice/appointments/{id} -- MOVING one: a different time, length or hospital. Separate
// from PATCH deliberately, because it is a different kind of change: PATCH advances the state machine
// and cannot alter when something happens, PUT alters when and cannot advance the state machine.

const ACTIONS: Record<string, string> = {
  confirm: "CONFIRMED",
  cancel: "CANCELLED",
  no_show: "NO_SHOW",
  arrive: "ARRIVED",
  complete: "COMPLETED",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;
  const { appointmentId } = await params;

  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const to = ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(ACTIONS).join(", ")}` }, { status: 400 });

  const result = await transitionAppointment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, appointmentId, to,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // CONFIRMING AND CANCELLING ARE THE TWO MOVES A PATIENT NEEDS TOLD ABOUT, and both are this endpoint's.
  // Which sentence (if any) is true is read from the appointment's status by the engine, not decided
  // from `action` here -- `arrive`, `complete` and `no_show` therefore say nothing, and say why.
  const notice = await appointmentNotice(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, appointmentId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ appointment: result.data, notice, correlationId: auth.caller.traceId });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;
  const { appointmentId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.scheduledAt === undefined && body.durationMinutes === undefined && body.locationId === undefined)
    return NextResponse.json({ error: "scheduledAt, durationMinutes or locationId is required" }, { status: 400 });

  const result = await rescheduleAppointment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, appointmentId,
    scheduledAt: body.scheduledAt !== undefined ? String(body.scheduledAt) : undefined,
    durationMinutes: body.durationMinutes !== undefined ? Number(body.durationMinutes) : undefined,
    // null is meaningful here (clear the location), so undefined is the only "leave it alone".
    locationId: body.locationId !== undefined ? (body.locationId ? String(body.locationId) : null) : undefined,
    allowOverlap: body.allowOverlap === true,
    expectedVersion: body.expectedVersion !== undefined ? Number(body.expectedVersion) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // A MOVED APPOINTMENT IS THE ONE A PATIENT IS MOST LIKELY TO MISS. There is no `appointment_moved`
  // template and the purpose list is CHECK-constrained, so nothing new is invented: a CONFIRMED
  // appointment gets its confirmation again, carrying the new time, which is true. An appointment that
  // was never confirmed still says nothing.
  const notice = await appointmentNotice(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, appointmentId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ appointment: result.data, notice, correlationId: auth.caller.traceId });
}
