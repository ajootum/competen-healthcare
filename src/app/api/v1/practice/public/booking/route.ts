import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import {
  bookableSlots, requestBookingCode, confirmBookingCode, submitBookingRequest,
  type BookingIntake,
} from "@/lib/practice/patient-booking";
import { submitUnverifiedRequest } from "@/lib/practice/booking-request-unverified";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/v1/practice/public/booking -- THE ONE PUBLIC DOOR INTO THE BOOKING ENGINES.
//
// ⚠ IT IS UNAUTHENTICATED ON PURPOSE, AND EVERY OTHER ROUTE UNDER /api/v1/practice IS NOT. A patient
// holds no account, no membership, no role and none of the fifty seeded capability codes -- migration 254
// shapes the session table so they cannot -- so requirePracticeContext could only ever refuse them. That
// is why this file is the only one in the tree that opens an admin client without a caller.
//
// ---- ⚠ WHAT STOPS THAT BEING A HOLE, GIVEN THE ADMIN CLIENT BYPASSES RLS -------------------------
//
//   1. NOTHING HERE NAMES A WORKSPACE. Every action takes a HANDLE, and every engine resolves it through
//      resolveBookingPage -- which answers nothing at all for a draft, paused or unpublished page, and
//      answers a handle never issued identically. A caller cannot address a practice that did not choose
//      to be addressable.
//   2. NOTHING HERE DECIDES ANYTHING. This file parses a body, derives a source and calls an engine. No
//      rule, no capacity check, no session check and no configuration test is made here, so there is
//      nothing on this path to get wrong or to skip.
//   3. THE UNVERIFIED PATH IS GATED IN THE ENGINE, NOT HERE. submitUnverifiedRequest reads the practice's
//      own setting before it writes and refuses when it is off or unreadable -- api-context.ts's house
//      rule, applied to a route that has no sidebar to hide anything with. This file could not open that
//      door by forgetting a check, because the check is not this file's.
//   4. THE REFUSALS ARE NOT AN ORACLE. Every engine below answers an unpublished practice and a handle
//      never issued with the same NOT_FOUND, and none of them names another patient, another booking or
//      how full a diary is.
//
// ---- THE SOURCE, AND WHY IT IS DERIVED HERE ------------------------------------------------------
//
// ⚠ THE RAW ADDRESS NEVER LEAVES THIS FUNCTION AS ITSELF. Both engines hash it before it reaches a query
// or a column, so what is stored is a 64-character digest and nothing that identifies a person.
//
// ⚠ AND AN ABSENT ONE IS NOT SUBSTITUTED. Returning a constant when no header is present would put every
// caller in the world into one bucket, which is either a limit that refuses everybody or -- far worse --
// one that an attacker escapes by making the header absent. Null is passed, and the engine that requires
// a source refuses rather than proceeding unlimited.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** The forwarded client address, first hop only, or nothing. Never invented. */
async function sourceKeyOf(): Promise<string | null> {
  const h = await headers();
  const forwarded = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  const real = (h.get("x-real-ip") ?? "").trim();
  return forwarded || real || null;
}

const text = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);

/** s9's minimum dataset, off the wire. Nothing is inferred and nothing is defaulted into an answer. */
const intakeOf = (b: Record<string, any>): BookingIntake => ({
  givenName: String(b.givenName ?? "").trim(),
  familyName: String(b.familyName ?? "").trim(),
  birthDate: text(b.birthDate),
  sex: text(b.sex),
  contactPhone: text(b.contactPhone),
  contactEmail: text(b.contactEmail),
  reasonForVisit: text(b.reasonForVisit),
  referralSource: text(b.referralSource),
  representativeName: text(b.representativeName),
  representativeRelationship: text(b.representativeRelationship),
  representativePhone: text(b.representativePhone),
  consentDataCapture: b.consentDataCapture === true,
  consentCommunication: b.consentCommunication === true,
  ageYears: b.ageYears === undefined || b.ageYears === null || b.ageYears === "" ? null : Number(b.ageYears),
  statedDiagnosis: text(b.statedDiagnosis),
  statedTreatment: text(b.statedTreatment),
  statedHospitalNumber: text(b.statedHospitalNumber),
});

/**
 * The times this practice can offer.
 *
 * ⚠ NO CACHING, AND `force-dynamic` IS NOT ENOUGH ON ITS OWN TO MAKE THAT OBVIOUS. A cached slot list is
 * a patient being offered a time somebody took ten minutes ago, and the refusal they then get is
 * indistinguishable from the product being broken.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const handle = (q.get("handle") ?? "").trim();
  const appointmentType = (q.get("appointmentType") ?? "").trim();
  if (!handle || !appointmentType)
    return err(400, "VALIDATION_ERROR", "a handle and a kind of appointment are required");

  // ⚠ WHICH QUESTIONS THIS PRACTICE ACTUALLY ASKS, FROM THE ONE RESOLVER THAT DECIDES IT.
  //
  // The alternative is a form that draws the whole catalogue and finds out what was required from the
  // refusal. booking-rule-constants.ts's own header names that failure: a form that permits what the
  // server refuses is a form somebody fills in twice, and one that refuses what the server permits is a
  // booking nobody can make. So the questions come from the server, and the CONTROLS come from the closed
  // catalogue the browser already holds -- one list, one evaluator, one renderer.
  //
  // ⚠ ONLY `asked` LEAVES THIS BRANCH. Not the rule, not its name, not the capacity, not the refusals --
  // which is what a stranger would otherwise learn about a practice's diary by asking for a form.
  if (q.get("action") === "intake") {
    const { intakeQuestionsFor } = await import("@/lib/practice/booking-request-unverified");
    const r = await intakeQuestionsFor(createAdminClient(), {
      handle, appointmentType,
      scheduledAt: q.get("scheduledAt") ?? new Date().toISOString(),
      locationId: q.get("locationId") || null,
    });
    return r.ok
      ? NextResponse.json(r.data, { headers: { "cache-control": "no-store" } })
      : err(r.status, r.code, r.message);
  }

  const now = Date.now();
  const fromIso = q.get("from") ?? new Date(now).toISOString();
  const toIso = q.get("to") ?? new Date(now + 14 * 86400000).toISOString();

  const r = await bookableSlots(createAdminClient(), {
    handle, appointmentType,
    locationId: q.get("locationId") || null,
    fromIso, toIso,
  });
  // ⚠ A FAILED READ IS A 503 WITH ITS OWN SENTENCE, NEVER AN EMPTY LIST. "No times are available" and
  // "the diary could not be read" are different things to tell somebody, and the first sends a patient
  // to another practice.
  return r.ok
    ? NextResponse.json(r.data, { headers: { "cache-control": "no-store" } })
    : err(r.status, r.code, r.message);
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return err(400, "VALIDATION_ERROR", "invalid JSON body"); }

  const admin = createAdminClient();
  const handle = String(body.handle ?? "").trim();
  if (!handle) return err(400, "VALIDATION_ERROR", "a handle is required");

  const sourceKey = await sourceKeyOf();
  const correlationId = (await headers()).get("x-trace-id") ?? crypto.randomUUID();
  const action = String(body.action ?? "");

  if (action === "request_code") {
    const channel = body.channel === "email" ? "email" : "sms";
    const r = await requestBookingCode(admin, {
      handle, channel, destination: String(body.destination ?? ""),
      sourceKey, correlationId,
    });
    // ⚠ THE CODE IS NOT IN THIS RESPONSE AND THERE IS NO BRANCH THAT PUTS IT THERE. The engine returns a
    // challenge id, an expiry and whether the source limit ran, and nothing else exists to return.
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "confirm_code") {
    const r = await confirmBookingCode(admin, {
      challengeId: String(body.challengeId ?? ""), code: String(body.code ?? ""),
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "book") {
    const r = await submitBookingRequest(admin, {
      handle, token: String(body.token ?? ""), intake: intakeOf(body),
      scheduledAt: String(body.scheduledAt ?? ""),
      appointmentType: String(body.appointmentType ?? ""),
      locationId: text(body.locationId),
      durationMinutes: body.durationMinutes === undefined ? null : Number(body.durationMinutes),
      sourceKey, correlationId,
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  if (action === "request_without_code") {
    // ⚠ NO CONFIG TEST HERE. Whether this practice accepts one is decided inside the engine, against the
    // store, before anything is written -- see this file's header, point 3.
    const r = await submitUnverifiedRequest(admin, {
      handle, intake: intakeOf(body),
      requestedStart: String(body.scheduledAt ?? ""),
      appointmentType: String(body.appointmentType ?? ""),
      locationId: text(body.locationId),
      // ⚠ PASSED AS AN EMPTY STRING WHEN NO HEADER GAVE ONE, AND THE ENGINE REFUSES IT. Not substituted,
      // not defaulted -- an unrecorded source is an unlimited one.
      sourceKey: sourceKey ?? "",
      correlationId,
    });
    return r.ok ? NextResponse.json(r.data) : err(r.status, r.code, r.message);
  }

  return err(400, "UNKNOWN_ACTION", "that is not something this endpoint does");
}
