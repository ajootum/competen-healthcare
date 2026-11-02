import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { validateInstrument } from "@/lib/assessment/studio/service";
import { isUuid, refuse } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-studio/versions/[versionId]/validate -- Checklist Studio (S2). View capability.
// Runs the engine validators (content, scoring, saved tests, layouts) and the settings checks on the saved draft. { record: true } also
// writes the result as a validated event in the history, which needs the author capability to be held.

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await hqApiGate([CAP.view]);
  if (isHqRefusal(ctx)) return ctx;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const record = b?.record === true && ctx.capabilities.includes(CAP.author);
  const v = await validateInstrument(ctx.admin, versionId, ctx.userId, record);
  if (!v) return refuse(404, "That version does not exist.");
  return NextResponse.json({ report: v.report, recorded: record });
}
