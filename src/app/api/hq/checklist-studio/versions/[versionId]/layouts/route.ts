import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { saveLayouts } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// PUT /api/hq/checklist-studio/versions/[versionId]/layouts -- Checklist Studio (S2). Author capability.
// Body { defaultLayoutVersionId: uuid|null, allowed: uuid[] }. Every layout must be a PUBLISHED layout template version.

export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const allowed: string[] = Array.isArray(b?.allowed) ? b.allowed.filter(isUuid) : [];
  const def = b?.defaultLayoutVersionId === null || b?.defaultLayoutVersionId === undefined ? null : isUuid(b.defaultLayoutVersionId) ? b.defaultLayoutVersionId : undefined;
  if (def === undefined) return refuse(400, "Choose a layout.");
  const r = await saveLayouts(ctx.admin, ctx.userId, versionId, def, allowed);
  return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
}
