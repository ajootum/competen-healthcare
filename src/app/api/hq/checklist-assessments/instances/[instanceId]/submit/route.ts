import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { submitInstance } from "@/lib/assessment/assessor/submit";
import { auditAssessor } from "@/lib/assessment/assessor/audit";
import { stageScaleViaRpc } from "@/lib/assessment/adapters/scholar/stage-scale-rpc";
import { respond } from "../../../_respond";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-assessments/instances/[instanceId]/submit -- evaluate on the server and record the outcome.
// The engine runs over the stored answers with the scoring document of the pinned version, its hash must equal the stored
// scoring hash, and asmt_submit_instance records the outcome and closes the instance in one transaction (the database
// forces the gate outcome when a critical item failed or a mandatory item is missing). Progression is then computed for
// the person and can only be skipped, never fail the submit. Assessor-evaluated work, not formal verification.
export async function POST(_req: Request, ctx: { params: Promise<{ instanceId: string }> }) {
  const gate = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { instanceId } = await ctx.params;
  const r = await submitInstance(gate.admin, gate.userId, instanceId, { stageScale: stageScaleViaRpc });
  if (r.ok) await auditAssessor(gate, "submitted", "asmt_instance", instanceId, { outcomeId: r.value.outcomeId, outcomeClass: r.value.outcome?.outcome_class ?? null, backstop: r.value.backstopApplied, progression: r.value.progression.status });
  return respond(r, v => ({ outcomeId: v.outcomeId, outcomeCode: v.outcome?.outcome_code ?? null, outcomeClass: v.outcome?.outcome_class ?? null, engine: v.engine, backstopApplied: v.backstopApplied, progression: v.progression }));
}
