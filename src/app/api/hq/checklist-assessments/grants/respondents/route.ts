import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSIGN_CAPABILITY } from "@/lib/assessment/assessor/common";
import { listRespondentCandidates } from "@/lib/assessment/assessor/grants";
import { respond } from "../../_respond";

export const dynamic = "force-dynamic";

// GET /api/hq/checklist-assessments/grants/respondents?instrumentId=&subjectUserId= -- people whose appointment holds the
// checklist's assess capability, each confirmed by the database function. Never the person assessed, never the caller.
// Gated by hq.assessment.assessor.assign.
export async function GET(req: Request) {
  const ctx = await hqApiGate([ASSIGN_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const p = new URL(req.url).searchParams;
  const exclude = [ctx.userId, p.get("subjectUserId") ?? ""].filter(Boolean);
  return respond(await listRespondentCandidates(ctx.admin, p.get("instrumentId") ?? "", exclude));
}
