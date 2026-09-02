import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import {
  requestManageCode, confirmBookingCode, managedBookings,
  rescheduleManagedBooking, cancelManagedBooking, bookableSlots,
} from "@/lib/practice/patient-booking";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/v1/practice/public/manage -- THE DOOR FOR SOMEBODY WHO ALREADY HAS A BOOKING.
//
// The engines have existed and been harness-proven since the patient-manage arc; nothing served them, so
// the booking confirmation could not offer "view or change your appointment" without promising a screen
// that did not exist. This is that screen's endpoint, and it decides nothing on its own.
//
// ---- ⚠ WHY IT IS A SEPARATE FILE FROM THE BOOKING ROUTE --------------------------------------------
//
// Not tidiness: the two have different SHAPES OF PROOF. Booking takes a session token that proves an
// address and then writes a new row. Managing takes the same kind of token and then acts on rows that
// ALREADY EXIST and belong to somebody -- so every action here goes through mineOrRefuse, which answers
// "no booking of yours matches that reference" identically for a reference that does not exist, one that
// belongs to somebody else, and one already gone. Keeping that path in its own file keeps the ownership
// check impossible to skip by adding an action to the wrong switch.
//
// ---- ⚠ THE CODE REQUEST IS DELIBERATELY INDISTINGUISHABLE FROM A BOOKING'S ------------------------
//
// requestManageCode IS requestBookingCode. Nothing on this path reads the booking table before sending,
// so asking for a code tells a caller nothing about whether that address has a booking here. A "we have
// no bookings for that email" answer would be an enumeration oracle on an unauthenticated endpoint.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** The forwarded client address, first hop only, or nothing. Never invented -- see the booking route. */
async function sourceKeyOf(): Promise<string | null> {
  const h = await headers();
  const forwarded = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  const real = (h.get("x-real-ip") ?? "").trim();
  return forwarded || real || null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return err(400, "VALIDATION_ERROR", "invalid JSON body"); }

  const admin = createAdminClient();
  const handle = String(body.handle ?? "").trim();
  if (!handle) return err(400, "VALIDATION_ERROR", "a handle is required");

  const correlationId = (await headers()).get("x-trace-id") ?? crypto.randomUUID();
  const action = String(body.action ?? "");

  if (action === "request_code") {
    const channel = body.channel === "sms" ? "sms" : "email";
    const r = await requestManageCode(admin, {
      handle, channel, destination: String(body.destination ?? ""),
      sourceKey: await sourceKeyOf(), correlationId,
    });
    // ⚠ THE CODE IS NOT IN THIS RESPONSE, on this path either.
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "confirm_code") {
    const r = await confirmBookingCode(admin, {
      challengeId: String(body.challengeId ?? ""), code: String(body.code ?? ""),
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "list") {
    const r = await managedBookings(admin, {
      handle, token: String(body.token ?? ""),
      reference: body.reference ? String(body.reference) : null,
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  // The replacement times a move may choose from -- the SAME reader the booking flow uses, so a slot
  // offered here is one the engine would accept, and the move re-runs the rules anyway.
  if (action === "times") {
    const now = Date.now();
    const r = await bookableSlots(admin, {
      handle,
      appointmentType: String(body.appointmentType ?? ""),
      locationId: body.locationId ? String(body.locationId) : null,
      fromIso: body.from ? String(body.from) : new Date(now).toISOString(),
      toIso: body.to ? String(body.to) : new Date(now + 14 * 86400000).toISOString(),
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "reschedule") {
    const r = await rescheduleManagedBooking(admin, {
      handle, token: String(body.token ?? ""), reference: String(body.reference ?? ""),
      scheduledAt: String(body.scheduledAt ?? ""), correlationId,
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "cancel") {
    const r = await cancelManagedBooking(admin, {
      handle, token: String(body.token ?? ""), reference: String(body.reference ?? ""),
      // A reason is optional and free text from a patient. It is stored on the booking, and it is NOT
      // sent anywhere near the funnel counters -- s16 keeps patient free text out of analytics.
      reason: body.reason === undefined || body.reason === null ? null : String(body.reason),
      correlationId,
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  return err(400, "UNKNOWN_ACTION", "that is not something this endpoint does");
}
