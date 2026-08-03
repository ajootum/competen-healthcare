import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { transitionAppointment } from "@/lib/practice/scheduling";

// PATCH /api/v1/practice/appointments/{id} { action } -- the state machine's only HTTP door.
// Actions map to DM-001 s7 states; the engine refuses illegal moves with 422 and version conflicts with
// 409, and `arrive` also writes the arrival record and queues the patient (CPR-V2-003 check-in workflow).

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
  return NextResponse.json({ appointment: result.data, correlationId: auth.caller.traceId });
}
