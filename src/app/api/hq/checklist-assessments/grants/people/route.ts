import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSIGN_CAPABILITY } from "@/lib/assessment/assessor/common";
import { findPeople } from "@/lib/assessment/assessor/grants";
import { respond } from "../../_respond";

export const dynamic = "force-dynamic";

// GET /api/hq/checklist-assessments/grants/people?email= | ?name= -- find the person to be assessed: an existing account by its
// exact email, or by name (at most ten). Only id, name and email are read. Gated by hq.assessment.assessor.assign.
export async function GET(req: Request) {
  const ctx = await hqApiGate([ASSIGN_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const p = new URL(req.url).searchParams;
  const r = await findPeople(ctx.admin, { email: p.get("email"), name: p.get("name") });
  return respond(r, v => ({ matches: v.matches.map(m => ({ ...m, isSelf: m.id === ctx.userId })), more: v.more }));
}
