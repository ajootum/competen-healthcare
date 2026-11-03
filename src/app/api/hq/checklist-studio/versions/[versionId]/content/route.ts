import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { saveContent } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";
import type { EditorContent } from "@/lib/assessment/studio/types";

export const dynamic = "force-dynamic";

// PUT /api/hq/checklist-studio/versions/[versionId]/content -- Checklist Studio (S2). Author capability.
// Body { content: { groups, sections, items[] with fields and mapping } }: the whole editable content. The server diffs it against the
// saved draft and writes only what changed, naming the editor on every row (updated_by) so the database records who edited. A reorder
// changes positions only: item stable keys never change. A version that is not a draft is refused (409).

export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const c = b?.content as EditorContent | undefined;
  if (!c || !Array.isArray(c.groups) || !Array.isArray(c.sections) || !Array.isArray(c.items)) return refuse(400, "Send the whole content: groups, sections and items.");
  const r = await saveContent(ctx.admin, ctx.userId, versionId, c);
  return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
}
