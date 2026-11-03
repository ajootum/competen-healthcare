import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { POLICY_CAP } from "@/lib/assessment/studio/transitions";
import { createPolicy } from "@/lib/assessment/studio/write";
import { parseNewPolicy } from "@/lib/assessment/studio/policy-input";
import { mustHold, refuse, respond } from "@/lib/assessment/studio/api";
import { POLICY_SCOPES, POLICY_TYPES } from "@/app/super-admin/policy-manager/policy-options";

export const dynamic = "force-dynamic";

// POST /api/hq/policies -- governed policies (942). Author capability (hq.quality.policy.author, held through an appointment).
// Body { title, policyType, scope?, description?, summary?, content? } -> 201 { policyId, versionId, code }. The code is assigned by the database.
export async function POST(req: Request) {
  const ctx = await withOwnAppointments(await hqApiGate([POLICY_CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, POLICY_CAP.author);
  if (denied) return denied;
  const parsed = parseNewPolicy(await req.json().catch(() => null), { types: POLICY_TYPES, scopes: POLICY_SCOPES });
  if (!parsed.ok) return refuse(400, parsed.error);
  const r = await createPolicy(ctx.admin, ctx.userId, parsed.value);
  if (!r.ok) return respond(r);
  return NextResponse.json({ policyId: r.policyId, versionId: r.versionId, code: r.code }, { status: 201 });
}
