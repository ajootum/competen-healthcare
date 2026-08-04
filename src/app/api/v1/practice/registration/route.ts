import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { register, registrationForm } from "@/lib/practice/registration";

// GET  /api/v1/practice/registration -- the form: this practice's template, today, the majority age
// POST /api/v1/practice/registration -- register, with relationships, a reason and optionally a booking
//
// SEPARATE FROM /api/v1/practice/patients, which stays exactly as it was. That route registers a
// patient; this one performs the whole registration act -- patient, guardians, reason, appointment --
// and reports which parts of it did not land. Two routes rather than one grown sideways, because the
// older one has callers that should keep their narrow contract.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const form = await registrationForm(auth.caller.admin, auth.ctx, {
    specialty: url.searchParams.get("specialty"),
    country: url.searchParams.get("country"),
    practiceType: url.searchParams.get("practiceType"),
  });
  return NextResponse.json({ ...form, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const str = (k: string) => body[k] === undefined || body[k] === null ? undefined : String(body[k]);
  const result = await register(auth.caller.admin, auth.ctx, {
    givenName: str("givenName"), middleName: str("middleName"), familyName: str("familyName"),
    displayName: str("displayName"), sex: str("sex"),
    birthDate: str("birthDate"),
    ageEstimateYears: body.ageEstimateYears == null ? undefined : Number(body.ageEstimateYears),
    phone: str("phone"), email: str("email"), nationalId: str("nationalId"),
    relationships: Array.isArray(body.relationships) ? body.relationships as any : undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
    reasonForVisit: str("reasonForVisit"),
    appointmentAt: str("appointmentAt"), appointmentType: str("appointmentType"),
    custom: (body.custom ?? {}) as Record<string, unknown>,
    confirmNew: body.confirmNew === true,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok) {
    // THE DUPLICATE CANDIDATES ARE PASSED THROUGH AS THE DECISION THEY ARE, exactly as the older route
    // does -- a 409 here is a question for the person at the desk, not a failure to retry.
    const candidates = (result as unknown as { candidates?: unknown }).candidates;
    return NextResponse.json(
      { error: { code: result.code, message: result.message }, ...(candidates ? { candidates } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
