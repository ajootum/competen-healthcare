import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordMilestone } from "@/lib/practice/longitudinal";

// POST /api/v1/practice/encounters/record/{patientId}/milestones -- CPR-ENC-003 s6.
//
// ⚠ THE ONLY WAY A MILESTONE IS EVER WRITTEN, AND IT TAKES A PERSON TO DO IT.
//
// `significant_improvement` and `relapse` are in the closed list, and they are clinical judgements. No
// engine in this product may look at a timeline, decide that a patient has improved significantly, and
// write it here -- the row would be indistinguishable, to every later reader, from one a practitioner
// put their name to. That is the same refusal as the "Stable / Improving / Monitor" chip rejected on the
// Patients screen, and it is enforced structurally: recordMilestone is the sole writer of
// practice_patient_milestone, its kind and label and date all come from this body, and the harness
// asserts that a complete encounter lifecycle writes zero milestone rows.
//
// patient.edit rather than encounter.edit: a milestone is a fact about the person. "Transitioned to
// adult care" may be recorded outside any consultation, which is why encounterId is optional.

export async function POST(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.edit");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await recordMilestone(auth.caller.admin, auth.ctx, {
    patientId,
    kind: String(body.kind ?? ""),
    label: String(body.label ?? ""),
    occurredOn: String(body.occurredOn ?? ""),
    note: body.note === undefined ? null : String(body.note),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ milestone: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
