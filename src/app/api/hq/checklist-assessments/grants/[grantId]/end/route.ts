import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSIGN_CAPABILITY } from "@/lib/assessment/assessor/common";
import { endGrant } from "@/lib/assessment/assessor/grants";
import { auditAssessor } from "@/lib/assessment/assessor/audit";
import { readJson, respond } from "../../../_respond";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-assessments/grants/[grantId]/end { reason } -- end a grant. History is kept and an ended grant
// is never reopened. Assessments already submitted under it stay as they are. Gated by hq.assessment.assessor.assign.
export async function POST(req: Request, ctx: { params: Promise<{ grantId: string }> }) {
  const gate = await hqApiGate([ASSIGN_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { grantId } = await ctx.params;
  const b = await readJson(req);
  const r = await endGrant(gate.admin, gate.userId, grantId, b.reason);
  if (r.ok) await auditAssessor(gate, "grant_ended", "asmt_respondent_grant", grantId, {});
  return respond(r);
}
