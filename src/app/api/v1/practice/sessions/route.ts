import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateSlots } from "@/lib/practice/availability-config";
import {
  saveSession, setAppointmentTypes, endSession, deleteSession, futureBookingsForSession,
} from "@/lib/practice/practice-sessions";
import { workspaceClock, dueDateFrom } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 Phase 1 -- the write door for Layer 1's Practice Sessions. s13.1's first endpoint family,
// "GET/POST/PATCH practice sessions and session templates".
//
// EVERY WRITE THAT CHANGES WHAT IS BOOKABLE REGENERATES ITS OWN WINDOW BEFORE RETURNING, for the reason
// the availability-config route already gives: the only honest reading of "the booking engine updates
// immediately after changes" is that the response cannot come back before the diary agrees with the
// change. Generation is idempotent, so this costs a re-read rather than a duplicate.
//
// ⚠ A DELETE DOES NOT REGENERATE, and must not. deleteSession() has already established that nothing is
// booked and removed the slots itself; running the generator afterwards would be asking it to reconsider
// a decision that was just made deliberately.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const REGENERATE_DAYS = 90;
/**
 * ⚠ THE REGENERATION WINDOW IS THE PRACTICE'S, NOT THE SERVER'S.
 *
 * These were `today()` and `plusDays()` built from the server's UTC clock. The window they produce is
 * written into availability rows a patient then books against, so a window that opens on the wrong day
 * offers or withholds a day of appointments that the practice did not decide about.
 *
 * plusDays also added milliseconds to an instant rather than days to a calendar date; across a DST
 * change those are different answers.
 */
const regenerationWindow = async (admin: any, workspaceId: string) => {
  const { today } = await workspaceClock(admin, workspaceId);
  return { fromDate: today, toDate: dueDateFrom(today, REGENERATE_DAYS) };
};

const nullableString = (v: unknown) =>
  v === undefined ? undefined : (v === null || v === "" ? null : String(v));
const nullableNumber = (v: unknown) =>
  v === undefined ? undefined : (v === null || v === "" ? null : Number(v));

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const admin = auth.caller.admin;
  const ctx = auth.ctx;
  const actorId = auth.caller.userId;
  const correlationId = auth.caller.traceId;

  const regenerate = async () => generateSlots(admin, ctx, {
    ...(await regenerationWindow(auth.caller.admin, ctx.workspaceId)), actorId, correlationId,
  });

  switch (body.action) {
    // s4.3 -- create or update a session, with the whole field list in one call.
    case "save_session": {
      const r = await saveSession(admin, ctx, {
        templateId: body.templateId ? String(body.templateId) : null,
        weekday: body.weekday != null ? Number(body.weekday) : undefined,
        startsMinute: body.startsMinute != null ? Number(body.startsMinute) : undefined,
        endsMinute: body.endsMinute != null ? Number(body.endsMinute) : undefined,
        locationId: nullableString(body.locationId),
        clinicId: nullableString(body.clinicId),
        sessionName: nullableString(body.sessionName),
        activityType: nullableString(body.activityType),
        bookingMode: body.bookingMode !== undefined ? String(body.bookingMode) : undefined,
        appointmentTypes: Array.isArray(body.appointmentTypes) ? body.appointmentTypes.map(String) : undefined,
        capacityManual: nullableNumber(body.capacityManual),
        appointmentMinutes: nullableNumber(body.appointmentMinutes),
        walkInsAllowed: body.walkInsAllowed !== undefined ? body.walkInsAllowed === true : undefined,
        walkInLimit: nullableNumber(body.walkInLimit),
        effectiveFrom: nullableString(body.effectiveFrom),
        effectiveTo: nullableString(body.effectiveTo),
        // CPR-RECUR-001 (migration 274). "Alternate Saturdays" is an interval and the FIRST SATURDAY it
        // runs on -- never an ISO week parity, which a 53-week year inverts. The engine refuses an
        // interval above 1 without a first date rather than choosing a fortnight on somebody's behalf.
        recurrenceWeeks: body.recurrenceWeeks != null ? Number(body.recurrenceWeeks) : undefined,
        recurrenceAnchorDate: nullableString(body.recurrenceAnchorDate),
        sessionNote: nullableString(body.sessionNote),
        slotKind: body.slotKind ? String(body.slotKind) : undefined,
        status: body.status ? String(body.status) as "active" | "suspended" : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      return NextResponse.json(
        { session: r.data, generation: gen.ok ? gen.data : null, correlationId },
        { status: r.data.created ? 201 : 200 },
      );
    }

    // s4.3 / s4.5 -- which types this session offers. Zero is a real answer and is accepted as one.
    case "set_appointment_types": {
      const r = await setAppointmentTypes(admin, ctx, {
        templateId: String(body.templateId ?? ""),
        types: Array.isArray(body.types) ? body.types.map(String) : [],
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ appointmentTypes: r.data, correlationId });
    }

    // s4.1 -- ending a session is a DATE. This is the door that should be used.
    case "end_session": {
      const r = await endSession(admin, ctx, {
        templateId: String(body.templateId ?? ""), effectiveTo: String(body.effectiveTo ?? ""),
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      return NextResponse.json({ ended: r.data, generation: gen.ok ? gen.data : null, correlationId });
    }

    // s4.4 -- REFUSED while anybody is booked into it, with the count in the refusal.
    case "delete_session": {
      const r = await deleteSession(admin, ctx, { templateId: String(body.templateId ?? ""), actorId, correlationId });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ deleted: r.data, correlationId });
    }

    // The count a screen needs BEFORE offering a delete, so the confirmation can say what it will cost.
    case "future_bookings": {
      const r = await futureBookingsForSession(admin, ctx, String(body.templateId ?? ""));
      if (r.state === "unreadable")
        return NextResponse.json({ error: { code: "BOOKINGS_UNREADABLE", message: r.reason } }, { status: 503 });
      if (r.state === "denied")
        return NextResponse.json({ error: { code: "FORBIDDEN", message: r.reason } }, { status: 403 });
      return NextResponse.json({ futureBookings: r.value, correlationId });
    }

    default:
      return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
  }
}
