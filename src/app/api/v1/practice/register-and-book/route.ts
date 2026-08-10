import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { hasCapability } from "@/lib/practice/access";
import { registerAndBook } from "@/lib/practice/registration";

// POST /api/v1/practice/register-and-book -- CP-SCHED-001 s9's "Register + book", as ONE transaction.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SEPARATE FROM /api/v1/practice/registration, WHICH IS UNCHANGED.
//
// That route performs the whole registration act with separate writes and reports which parts did not
// land -- which is right for "Register only", right for a registration that books nothing, and right for
// every caller it already has. This one exists for the single case where the button PROMISES both:
// "Register and book 10:20". A promise of two things at once is the case s10 says must be transactional,
// and it is the only case, so it is its own route rather than a flag on that one.
//
// ⚠ TWO CAPABILITIES, BOTH CHECKED. The act is a registration AND a booking, so it needs the permission
// for each. A route that checked only patient.create would let somebody who may register a patient put
// an appointment in a diary they are not allowed to touch.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;
  if (!hasCapability(auth.ctx, "appointment.manage"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const str = (k: string) => body[k] === undefined || body[k] === null ? undefined : String(body[k]);

  const result = await registerAndBook(auth.caller.admin, auth.ctx, {
    givenName: str("givenName"), middleName: str("middleName"), familyName: str("familyName"),
    displayName: str("displayName"), sex: str("sex"),
    birthDate: str("birthDate"),
    ageEstimateYears: body.ageEstimateYears == null ? undefined : Number(body.ageEstimateYears),
    phone: str("phone"), email: str("email"), nationalId: str("nationalId"),
    relationships: Array.isArray(body.relationships) ? body.relationships as any : undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
    reasonForVisit: str("reasonForVisit"),
    appointmentType: str("appointmentType"),
    custom: (body.custom ?? {}) as Record<string, unknown>,
    confirmNew: body.confirmNew === true,
    scheduledAt: str("scheduledAt") ?? "",
    locationId: str("locationId") ?? null,
    durationMinutes: body.durationMinutes == null ? null : Number(body.durationMinutes),
    correlationId: auth.caller.traceId,
  });

  if (!result.ok) {
    // ⚠ THE CANDIDATES AND THE ALTERNATIVES BOTH TRAVEL, because both are questions for the person at the
    // desk rather than errors to retry. A 409 naming a similar patient asks "is this the same person";
    // a 409 naming free times asks "which of these instead".
    return NextResponse.json(
      {
        error: { code: result.code, message: result.message },
        ...(result.candidates ? { candidates: result.candidates } : {}),
        ...(result.alternatives ? { alternatives: result.alternatives } : {}),
      },
      { status: result.status },
    );
  }
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
