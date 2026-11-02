import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { patchResponse } from "@/lib/assessment/assessor/instances";
import { readJson } from "../../../_respond";

export const dynamic = "force-dynamic";

// PATCH /api/hq/checklist-assessments/instances/[instanceId]/responses { key, value, revision }
//   key       the item stable key, or "<item key>#<field key>" for a secondary field
//   value     { level_code } | { state, reason? } | { value } -- or null to clear the answer
//   revision  what the caller last saw for this key (0 = nothing stored yet)
// 200 { revision, value, satisfactory }. 409 { error, server: { value, revision } } when the stored revision differs: the
// caller shows both and chooses, nothing is overwritten. The database computes satisfactory and validates the type.
export async function PATCH(req: Request, ctx: { params: Promise<{ instanceId: string }> }) {
  const gate = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { instanceId } = await ctx.params;
  const b = await readJson(req);
  if (typeof b.key !== "string" || !b.key || !("value" in b)) return NextResponse.json({ error: "Send the key, the value and the revision." }, { status: 400 });
  const r = await patchResponse(gate.admin, gate.userId, instanceId, b.key, b.value, Number(b.revision ?? 0));
  if (r.ok) return NextResponse.json({ revision: r.revision, value: r.value, satisfactory: r.satisfactory });
  if ("server" in r) return NextResponse.json({ error: r.error, server: r.server }, { status: 409 });
  return NextResponse.json({ error: r.error }, { status: r.status });
}
