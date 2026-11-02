import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSIGN_CAPABILITY } from "@/lib/assessment/assessor/common";
import { createGrant, listAssessableInstruments, listGrantsIMade } from "@/lib/assessment/assessor/grants";
import { auditAssessor } from "@/lib/assessment/assessor/audit";
import { readJson, respond } from "../_respond";

export const dynamic = "force-dynamic";

// /api/hq/checklist-assessments/grants -- the authority to assess one person with one checklist. Gated by
// hq.assessment.assessor.assign (the assessment coordinator).
//   GET  the grants I made, and the checklists that admit an assessor
//   POST { instrumentId, subjectUserId, respondentId, appointmentId, reason, validUntil? }
// The person accepts the grant in their own product (this plane only reads accepted_at). The database refuses a grant to or
// by the person assessed, to an appointment that does not hold the assess capability, and by someone without assign.
export async function GET() {
  const ctx = await hqApiGate([ASSIGN_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const [grants, instruments] = await Promise.all([listGrantsIMade(ctx.admin, ctx.userId), listAssessableInstruments(ctx.admin)]);
  if (!grants.ok) return respond(grants);
  if (!instruments.ok) return respond(instruments);
  return NextResponse.json({ grants: grants.value, instruments: instruments.value });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate([ASSIGN_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await readJson(req);
  const r = await createGrant(ctx.admin, ctx.userId, { instrumentId: b.instrumentId, subjectUserId: b.subjectUserId, respondentId: b.respondentId, appointmentId: b.appointmentId, reason: b.reason, validUntil: b.validUntil });
  if (r.ok) await auditAssessor(ctx, "grant_created", "asmt_respondent_grant", r.value.id, { instrumentId: b.instrumentId, appointmentId: b.appointmentId });
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : respond(r);
}
