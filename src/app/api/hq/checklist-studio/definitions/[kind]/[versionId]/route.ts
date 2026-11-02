import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { saveLayoutTemplate, saveProgression, saveRuleTemplate, saveScale, type ScaleSave } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// PUT /api/hq/checklist-studio/definitions/[kind]/[versionId] -- Checklist Studio (S2). Author capability.
// kind is scale, rule-template, layout-template or progression. The body carries that draft's content:
//   scale            { description?, levels[], states[] }
//   rule-template    { rules, tests, description? }
//   layout-template  { layout, presentation, description? }
//   progression      { rules, tests, stageScaleVersionId, description? }
// Lifecycle (submit, review, publish, retire, duplicate) goes through versions/[versionId]/transition with the kind in the body.

export async function PUT(req: Request, { params }: { params: Promise<{ kind: string; versionId: string }> }) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { kind, versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const a = ctx.admin;
  const done = (r: { ok: boolean; status?: number; error?: string }) => (r.ok ? NextResponse.json(r) : refuse(r.status ?? 422, r.error ?? "Not saved."));
  switch (kind) {
    case "scale":
      if (!Array.isArray(b?.levels) || !Array.isArray(b?.states)) return refuse(400, "Send the levels and states.");
      return done(await saveScale(a, ctx.userId, versionId, b as ScaleSave));
    case "rule-template":
      if (!b?.rules || typeof b.rules !== "object") return refuse(400, "Send the rules.");
      return done(await saveRuleTemplate(a, ctx.userId, versionId, b.rules, Array.isArray(b.tests) ? b.tests : [], b.description));
    case "layout-template":
      if (!b?.layout || typeof b.layout !== "object" || typeof b.presentation !== "string") return refuse(400, "Send the layout and its presentation.");
      return done(await saveLayoutTemplate(a, ctx.userId, versionId, b.layout, b.presentation, b.description));
    case "progression":
      if (!b?.rules || typeof b.rules !== "object" || !isUuid(b.stageScaleVersionId)) return refuse(400, "Send the rules and the stage scale.");
      return done(await saveProgression(a, ctx.userId, versionId, b.rules, Array.isArray(b.tests) ? b.tests : [], b.stageScaleVersionId, b.description));
  }
  return refuse(400, "Unknown kind.");
}
