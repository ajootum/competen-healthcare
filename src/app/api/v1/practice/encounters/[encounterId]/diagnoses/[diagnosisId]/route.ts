import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { updateEncounterDiagnosis, removeEncounterDiagnosis } from "@/lib/practice/diagnosis-capture";

// PATCH / DELETE /api/v1/practice/encounters/{id}/diagnoses/{diagnosisId}
//
// The owner, 2026-08-13: "the diagnoses are uneditable... can they remain editable this encounter?"
// They could not -- there was no update path in the product at all, which is why the working set locked
// a row the moment it was written. Re-submitting through the batch route would have inserted a SECOND
// copy rather than correcting the first.
//
// ⚠ THE ENGINE OWNS THE SIGNED CHECK, not this route. A signed encounter refuses both verbs, by name.
//
// ⚠ AND THE ENCOUNTER ID IN THE PATH IS NOT TRUSTED AS THE AUTHORITY. The engine resolves the
// diagnosis's OWN encounter and checks that, so a correct diagnosis id under someone else's encounter id
// cannot slip a change past the signed check.

export async function PATCH(req: NextRequest, { params }: {
  params: Promise<{ encounterId: string; diagnosisId: string }>;
}) {
  const auth = await requirePracticeContext("diagnosis.record");
  if (isDenied(auth)) return auth;
  const { diagnosisId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await updateEncounterDiagnosis(auth.caller.admin, auth.ctx, {
    diagnosisId,
    // `undefined` and a value are different: absent means "leave alone", so a screen editing only the
    // certainty cannot blank the label by omitting it.
    label: body.label === undefined ? undefined : String(body.label),
    certainty: body.certainty === undefined ? undefined : String(body.certainty),
    isPrimary: body.isPrimary === undefined ? undefined : body.isPrimary === true,
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ diagnosis: result.data, correlationId: auth.caller.traceId });
}

export async function DELETE(_req: NextRequest, { params }: {
  params: Promise<{ encounterId: string; diagnosisId: string }>;
}) {
  const auth = await requirePracticeContext("diagnosis.record");
  if (isDenied(auth)) return auth;
  const { diagnosisId } = await params;

  const result = await removeEncounterDiagnosis(auth.caller.admin, auth.ctx, {
    diagnosisId, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // ⚠ THE SCREEN IS TOLD THE PROBLEM SURVIVED, so it can say so. Removing a diagnosis that had been
  // promoted leaves the longitudinal problem in place on purpose -- it may already have been assessed
  // elsewhere or be the reason for a medication -- and a silent survival looks like a bug.
  return NextResponse.json({ removed: result.data, correlationId: auth.caller.traceId });
}
