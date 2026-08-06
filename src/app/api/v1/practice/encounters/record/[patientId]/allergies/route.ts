import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordAllergyReview, addAllergy, setBloodGroup } from "@/lib/practice/longitudinal";

// POST /api/v1/practice/encounters/record/{patientId}/allergies  -- add an allergy.
// PUT  /api/v1/practice/encounters/record/{patientId}/allergies  -- record the ANSWER to "any allergies?",
//                                                                   and optionally the blood group.
//
// ⚠ THIS ROUTE EXISTS BECAUSE "NO KNOWN ALLERGIES" MUST BE SOMETHING SOMEBODY SAID.
//
// An empty allergy list means nobody has asked. The screen therefore prints "Allergy status not
// recorded", and the only thing that can change that sentence to a reassuring one is a practitioner
// coming through here and answering the question -- which stamps who answered and when. Without this
// route the safe default would be permanent and the field would be decoration; with it, the reassuring
// sentence has provenance.
//
// PUT with status "none_known" is refused while allergies are listed. It is the one combination that
// would print reassurance on top of contradicting evidence.

export async function POST(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.edit");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await addAllergy(auth.caller.admin, auth.ctx, {
    patientId,
    substance: String(body.substance ?? ""),
    reaction: body.reaction === undefined ? null : String(body.reaction),
    severity: body.severity ? String(body.severity) : null,
    certainty: body.certainty ? String(body.certainty) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ allergy: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.edit");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.bloodGroup !== undefined) {
    const blood = await setBloodGroup(auth.caller.admin, auth.ctx, {
      patientId, bloodGroup: body.bloodGroup === null ? null : String(body.bloodGroup),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!blood.ok) return NextResponse.json({ error: { code: blood.code, message: blood.message } }, { status: blood.status });
    if (body.status === undefined) return NextResponse.json({ bloodGroup: blood.data, correlationId: auth.caller.traceId });
  }

  const result = await recordAllergyReview(auth.caller.admin, auth.ctx, {
    patientId, status: String(body.status ?? "") as "none_known" | "recorded" | "not_recorded",
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ allergyStatus: result.data, correlationId: auth.caller.traceId });
}
