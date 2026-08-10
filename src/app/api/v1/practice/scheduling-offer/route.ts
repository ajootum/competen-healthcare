import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  staffBookingLocations, nextAvailableDates, bookableTimes,
} from "@/lib/practice/patient-booking";
import { zonedDayRange, workspaceClock } from "@/lib/practice/practice-time";

// GET /api/v1/practice/scheduling-offer -- CP-SCHED-001 s9's three availability contracts, for STAFF.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//   ?view=locations                                            "List eligible locations"
//   ?view=dates&locationId=&appointmentType=&from=&limit=       "Next available dates"
//   ?view=slots&locationId=&appointmentType=&date=              "Free slots"
//
// ⚠ THIS IS THE STAFF CHANNEL AND IT IS SEPARATE FROM /api/v1/practice/public/booking ON PURPOSE.
//
// The public route answers a stranger holding a handle, and it must keep answering exactly what it
// answers today. This one answers a signed-in member of the practice, so the workspace comes from
// requirePracticeContext -- which has already established membership, status, entitlement and the
// capability -- and never from anything in the query string. There is no parameter on this route that
// can name another practice.
//
// ⚠ AND IT COMPUTES NOTHING. Every answer is bookableTimes or something derived from it, which is the
// same function the booking will be checked against. See nextAvailableDates' header for why the dates
// are derived from the times rather than calculated beside them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // appointment.manage, not patient.create: this reads the practitioner's diary. Migration 192 seeds it
  // to `practitioner` and `practice_assistant`, which are the two roles that register patients.
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const view = (url.searchParams.get("view") ?? "locations").trim();
  const admin = auth.caller.admin;
  const workspaceId = auth.ctx.workspaceId;
  const appointmentType = (url.searchParams.get("appointmentType") || "new_consultation").trim();
  const locationId = (url.searchParams.get("locationId") || "").trim() || null;

  if (view === "locations") {
    const r = await staffBookingLocations(admin, workspaceId);
    if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
    return NextResponse.json({ ...r.data, correlationId: auth.caller.traceId });
  }

  if (view === "dates") {
    // ⚠ `from` IS AN INSTANT AND DEFAULTS TO NOW. A date here would need a timezone to become an instant,
    // and guessing one is how a card offers a morning that has already happened.
    const fromParam = (url.searchParams.get("from") || "").trim();
    const fromIso = fromParam && !Number.isNaN(Date.parse(fromParam))
      ? new Date(Date.parse(fromParam)).toISOString()
      : new Date().toISOString();
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const r = await nextAvailableDates(admin, {
      channel: "staff", workspaceId, appointmentType, locationId, fromIso,
      limit: Number.isFinite(limitRaw) ? limitRaw : 5,
    });
    if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
    return NextResponse.json({ ...r.data, correlationId: auth.caller.traceId });
  }

  if (view === "slots") {
    const date = (url.searchParams.get("date") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "a date is required" } }, { status: 400 });

    // ⚠ THE DAY IS THE PRACTICE'S DAY, NOT UTC's. zonedDayRange turns a calendar date into the pair of
    // instants that day actually spans where the practice is -- which is what the dates engine bucketed
    // by. Slicing an ISO string instead would put a 06:00 Kampala clinic on the previous day and the two
    // reads would disagree about what "Tuesday" means.
    const { timezone } = await workspaceClock(admin, workspaceId);
    const { startIso, endIso } = zonedDayRange(date, timezone);

    const r = await bookableTimes(admin, {
      channel: "staff", workspaceId, appointmentType, locationId, fromIso: startIso, toIso: endIso,
    });
    if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
    return NextResponse.json({ ...r.data, date, correlationId: auth.caller.traceId });
  }

  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message: "view must be locations, dates or slots" } },
    { status: 400 },
  );
}
