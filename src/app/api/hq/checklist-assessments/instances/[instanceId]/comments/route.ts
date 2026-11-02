import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { addComment } from "@/lib/assessment/assessor/instances";
import { readJson, respond } from "../../../_respond";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-assessments/instances/[instanceId]/comments { itemKey?, kind: comment | safety_concern | strength | recommendation, body }
// Append-only. A comment without an itemKey is about the whole assessment.
export async function POST(req: Request, ctx: { params: Promise<{ instanceId: string }> }) {
  const gate = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { instanceId } = await ctx.params;
  const b = await readJson(req);
  const r = await addComment(gate.admin, gate.userId, instanceId, { itemKey: typeof b.itemKey === "string" ? b.itemKey : null, kind: b.kind, body: b.body });
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : respond(r);
}
