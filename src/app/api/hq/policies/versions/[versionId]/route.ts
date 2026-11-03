import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { POLICY_CAP } from "@/lib/assessment/studio/transitions";
import { savePolicyVersion } from "@/lib/assessment/studio/write";
import { parsePolicyPatch } from "@/lib/assessment/studio/policy-input";
import { isUuid, mustHold, refuse, respond } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// PUT /api/hq/policies/versions/[versionId] -- governed policies (942): edit a DRAFT version. Author capability.
// Body { title?, summary?, content?, effectiveFrom?, reviewDue? } (dates YYYY-MM-DD, empty clears). The database refuses anything but a draft
// and says who the editor is; the refusal comes back in its words.
export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([POLICY_CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, POLICY_CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const parsed = parsePolicyPatch(await req.json().catch(() => null));
  if (!parsed.ok) return refuse(400, parsed.error);
  return respond(await savePolicyVersion(ctx.admin, ctx.userId, versionId, parsed.value));
}
