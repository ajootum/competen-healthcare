import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { bookAppointment, loadDay } from "@/lib/practice/scheduling";
import { appointmentNotice } from "@/lib/practice/messaging";
import { workspaceClock, instantInZone } from "@/lib/practice/practice-time";

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
  const hasWallClock = typeof body.date === "string" && typeof body.time === "string";
  if ((!body.patientName && !body.patientId) || !body.appointmentType || (!body.scheduledAt && !hasWallClock))
    return NextResponse.json({ error: "patientName (or patientId), appointmentType and either scheduledAt or date+time are required" }, { status: 400 });

  // ⚠ WALL-CLOCK TIMES ARE COMPOSED HERE, IN THE PRACTICE TIMEZONE -- never on the client. The booking
  // widgets used to send `${date}T${time}:00.000Z`, which DECLARES a Kampala 09:00 to be 09:00 UTC and
  // puts it in the diary at 12:00. A client cannot compose an instant: it does not know the practice
  // timezone (and its own machine's zone is not evidence of it). `scheduledAt` remains accepted for
  // callers that hold a real instant -- a server-offered slot, or a walk-in booked at "now".
  let scheduledAt: string;
  if (body.scheduledAt) {
    scheduledAt = String(body.scheduledAt);
  } else {
    const { timezone } = await workspaceClock(auth.caller.admin, auth.ctx.workspaceId);
    const instant = instantInZone(String(body.date), String(body.time), timezone);
    if (!instant)
      return NextResponse.json(
        { error: `date and time could not be read as a moment in ${timezone} -- date must be YYYY-MM-DD and time HH:MM (24-hour)` },
        { status: 400 },
      );
    scheduledAt = instant;
  }

  const result = await bookAppointment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: body.patientId ? String(body.patientId) : null,
    patientName: String(body.patientName ?? ""),
    patientPhone: body.patientPhone ? String(body.patientPhone) : undefined,
    appointmentType: String(body.appointmentType),
    // CP-BOOKING-TAXONOMY-001. Passed through UNVALIDATED on purpose -- the engine checks them against
    // this practice's own active list, which is the only place that check is worth anything. A route
    // that pre-approved an id would be trusting the browser about what the practice has configured.
    //
    // ⚠ booking_source IS NOT READ FROM THE BODY, and must never be. It is provenance: derived from the
    // authenticated actor and the workflow inside the engine, so a client cannot claim a booking was
    // self-booked or system-generated when it was neither.
    visitTypeId: body.visitTypeId ? String(body.visitTypeId) : null,
    consultationModeId: body.consultationModeId ? String(body.consultationModeId) : null,
    scheduledAt,
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
