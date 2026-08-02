import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordTreatment } from "@/lib/practice/encounters";

// POST /api/v1/practice/encounters/{id}/treatments -- DM-001 s10. A medication row here is the
// practitioner's INTENTION (dose/route/frequency/duration), not an administration record: ADR-01 keeps
// inpatient administration out of Practice, and blurring the two would make a prescription look like
// proof a drug was given.

const TYPES = ["medication", "procedure", "investigation", "advice", "referral", "monitoring"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("treatment.record");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const label = String(body.label ?? "").trim();
  const treatmentType = String(body.treatmentType ?? "");
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (!TYPES.includes(treatmentType))
    return NextResponse.json({ error: `treatmentType must be one of: ${TYPES.join(", ")}` }, { status: 400 });

  const result = await recordTreatment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, treatmentType, label,
    dose: body.dose ? String(body.dose) : undefined,
    route: body.route ? String(body.route) : undefined,
    frequency: body.frequency ? String(body.frequency) : undefined,
    duration: body.duration ? String(body.duration) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    diagnosisId: body.diagnosisId ? String(body.diagnosisId) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ treatment: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
