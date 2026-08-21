import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { bookAppointment, loadDay } from "@/lib/practice/scheduling";
import { appointmentNotice } from "@/lib/practice/messaging";
import { instantInZone, dueDateFrom, practiceToday } from "@/lib/practice/practice-time";
import { emitEvent } from "@/lib/mos/event";

// GET  /api/v1/practice/appointments?date=YYYY-MM-DD -- the day's diary + live queue + blocks.
// POST /api/v1/practice/appointments -- book (PEN-001 rules: double-booking refused unless exempt type
//       or explicit allowOverlap; walk-ins enter CONFIRMED). Capability: appointment.manage to write,
//       practice.calendar.view to read -- an auditor can see the day without being able to book it.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.calendar.view");
  if (isDenied(auth)) return auth;

  // No ?date= means "today" -- and today is the practice's, not the server's. Asking this route for
  // the day's appointments after 21:00 UTC in Kampala returned YESTERDAY's list with no indication.
  const date = req.nextUrl.searchParams.get("date")
    ?? practiceToday(auth.ctx.workspaceTimezone);
  if (!DAY.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const day = await loadDay(auth.caller.admin, auth.ctx.workspaceId, date);
  return NextResponse.json({ date, ...day, correlationId: auth.caller.traceId });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-CORE-MOS-001 phase 3 - Patient Booking, the first instrumented critical journey.
//
// ⚠ THE HANDLER IS WRAPPED RATHER THAN SPRINKLED, AND THAT IS THE WHOLE SAFETY ARGUMENT. This route has
// FIVE terminal return paths: invalid JSON, missing fields, an unreadable date, an engine refusal and a
// success. Six emit calls scattered through them would work until somebody added a sixth return and did
// not add a sixth emit - and the failure mode is silent, because attempts would then exceed outcomes and
// every booking success rate would read low forever with nothing to show it was wrong.
//
// So the body below is UNCHANGED and moved into createAppointment, and POST emits exactly one attempt
// and exactly one outcome around it. A new return path inside cannot escape the pairing.
//
// ⚠ AND TELEMETRY NEVER DECIDES THE RESPONSE. emitEvent catches everything and returns a result which
// is deliberately ignored here: the booking is already made by the time the outcome is emitted, and a
// failure to record it must not turn a successful booking into a 5xx.
export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  const correlationId = auth.caller.traceId;
  const base = {
    practiceId: auth.ctx.workspaceId,
    practitionerId: auth.caller.userId,
    correlationId,
    component: "scheduling",
  } as const;

  await emitEvent(auth.caller.admin, { ...base, eventName: "practice.booking.started", outcome: "started" });

  // ⚠ THE CLOCK STARTS AFTER THE ATTEMPT EMIT, AND IT DID NOT USED TO. With it above, every journey's
  // duration included the round trip that RECORDED the attempt — a validation failure that returns
  // immediately was reporting 440ms, almost all of it telemetry. The instrumentation was measuring
  // itself and inflating the latency of the very journeys it exists to observe. Only running the screen
  // showed it: the numbers were plausible, and wrong.
  const startedAt = Date.now();

  const { res, failureCode } = await createAppointment(req, auth);

  await emitEvent(auth.caller.admin, failureCode === null
    ? { ...base, eventName: "practice.booking.created", outcome: "success", durationMs: Date.now() - startedAt }
    : { ...base, eventName: "practice.booking.failed", outcome: "failure", failureCode, durationMs: Date.now() - startedAt });

  return res;
}

/**
 * The original handler, unchanged except that every return now names its failure code so the outcome
 * event carries a stable taxonomy rather than an HTTP status.
 */
async function createAppointment(
  req: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof requirePracticeContext>>, { ctx: unknown }>,
): Promise<{ res: NextResponse; failureCode: string | null }> {

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return { res: NextResponse.json({ error: "invalid JSON" }, { status: 400 }), failureCode: "INVALID_JSON" }; }
  const hasWallClock = typeof body.date === "string" && typeof body.time === "string";
  if ((!body.patientName && !body.patientId) || !body.appointmentType || (!body.scheduledAt && !hasWallClock))
    return { res: NextResponse.json({ error: "patientName (or patientId), appointmentType and either scheduledAt or date+time are required" }, { status: 400 }), failureCode: "MISSING_FIELDS" };

  // ⚠ WALL-CLOCK TIMES ARE COMPOSED HERE, IN THE PRACTICE TIMEZONE -- never on the client. The booking
  // widgets used to send `${date}T${time}:00.000Z`, which DECLARES a Kampala 09:00 to be 09:00 UTC and
  // puts it in the diary at 12:00. A client cannot compose an instant: it does not know the practice
  // timezone (and its own machine's zone is not evidence of it). `scheduledAt` remains accepted for
  // callers that hold a real instant -- a server-offered slot, or a walk-in booked at "now".
  let scheduledAt: string;
  if (body.scheduledAt) {
    scheduledAt = String(body.scheduledAt);
  } else {
    const timezone = auth.ctx.workspaceTimezone;
    const instant = instantInZone(String(body.date), String(body.time), timezone);
    if (!instant)
      return {
        res: NextResponse.json(
          { error: `date and time could not be read as a moment in ${timezone} -- date must be YYYY-MM-DD and time HH:MM (24-hour)` },
          { status: 400 },
        ),
        failureCode: "UNREADABLE_WALL_CLOCK",
      };
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

  if (!result.ok) return { res: NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status }), failureCode: result.code };

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
  return { res: NextResponse.json({ appointment: result.data, notice, correlationId: auth.caller.traceId }, { status: 201 }), failureCode: null };
}
