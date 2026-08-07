import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { bookAppointment, loadDay } from "@/lib/practice/scheduling";
import { appointmentNotice } from "@/lib/practice/messaging";

// GET  /api/v1/practice/appointments?date=YYYY-MM-DD -- the day's diary + live queue + blocks.
// POST /api/v1/practice/appointments -- book (PEN-001 rules: double-booking refused unless exempt type
//       or explicit allowOverlap; walk-ins enter CONFIRMED). Capability: appointment.manage to write,
//       practice.calendar.view to read -- an auditor can see the day without being able to book it.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.calendar.view");
  if (isDenied(auth)) return auth;

  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DAY.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const day = await loadDay(auth.caller.admin, auth.ctx.workspaceId, date);
  return NextResponse.json({ date, ...day, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if ((!body.patientName && !body.patientId) || !body.scheduledAt || !body.appointmentType)
    return NextResponse.json({ error: "patientName (or patientId), appointmentType and scheduledAt are required" }, { status: 400 });

  const result = await bookAppointment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: body.patientId ? String(body.patientId) : null,
    patientName: String(body.patientName ?? ""),
    patientPhone: body.patientPhone ? String(body.patientPhone) : undefined,
    appointmentType: String(body.appointmentType),
    scheduledAt: String(body.scheduledAt),
    durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : undefined,
    locationId: body.locationId ? String(body.locationId) : null,
    reason: body.reason ? String(body.reason) : undefined,
    allowOverlap: body.allowOverlap === true,
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // THE PATIENT IS TOLD SECOND, AND NEVER AT THE BOOKING'S EXPENSE. The appointment already exists by
  // this line; a provider outage must not turn a successful booking into a 5xx. The engine decides from
  // the appointment's own status whether there is anything true to say -- a REQUESTED booking is not yet
  // confirmed, so nothing is sent and the reason is returned rather than implied.
  //
  // `notice` is reported, not asserted: with no provider configured it carries a refusal, and no caller
  // may render it as "we have texted them".
  const notice = await appointmentNotice(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, appointmentId: result.data.id,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ appointment: result.data, notice, correlationId: auth.caller.traceId }, { status: 201 });
}
