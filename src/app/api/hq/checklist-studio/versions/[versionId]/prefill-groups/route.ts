import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";
import { prefillGroups } from "@/lib/assessment/adapters/scholar/groups";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-studio/versions/[versionId]/prefill-groups -- Checklist Studio. Author capability.
// Adds a group for each active framework assessment component the draft does not have yet (asmt_scholar_prefill_groups, migration 893).
// Answers { added, groups }: every group of the version after the call, so the editor can show them without a reload.

export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const r = await prefillGroups(ctx.admin, versionId, ctx.userId);
  return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
}
