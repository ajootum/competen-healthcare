import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { loadInstance } from "@/lib/assessment/assessor/instances";
import { respond } from "../../_respond";

export const dynamic = "force-dynamic";

// GET /api/hq/checklist-assessments/instances/[instanceId] -- the current answers, their revisions, evidence and comments
// of an assessment of mine (used to refresh after a conflict). The definition is not repeated here.
export async function GET(_req: Request, ctx: { params: Promise<{ instanceId: string }> }) {
  const gate = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { instanceId } = await ctx.params;
  const r = await loadInstance(gate.admin, gate.userId, instanceId);
  return respond(r, l => ({
    status: l.instance.status, responses: l.responses, revisions: l.revisions, evidence: l.evidence, evidenceCounts: l.evidenceCounts, comments: l.comments,
  }));
}
