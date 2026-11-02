import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { startInstance } from "@/lib/assessment/assessor/instances";
import { auditAssessor } from "@/lib/assessment/assessor/audit";
import { readJson, respond } from "../_respond";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-assessments/instances { grantId } -- start an assessor-led assessment from a grant made to me,
// or resume the one in progress for it. Gated by hq.assessment.instrument.assess. The grant must be mine (respondent_id =
// me), accepted by the person, not ended and inside its dates; the database repeats every one of those checks at insert.
export async function POST(req: Request) {
  const ctx = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await readJson(req);
  const r = await startInstance(ctx.admin, ctx.userId, String(b.grantId ?? ""));
  if (r.ok && !r.value.resumed) await auditAssessor(ctx, "started", "asmt_instance", r.value.instanceId, { grantId: b.grantId });
  return r.ok ? NextResponse.json(r.value, { status: r.value.resumed ? 200 : 201 }) : respond(r);
}
