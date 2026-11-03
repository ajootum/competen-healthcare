import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { createDefinition } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse, respond } from "@/lib/assessment/studio/api";
import { CODE_PATTERN } from "@/lib/assessment/studio/vocab";
import { importScale } from "@/lib/assessment/adapters/scholar/scales";
import { TARGET_KINDS, targetExists } from "@/lib/assessment/adapters/scholar/targets";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-studio/definitions -- Checklist Studio (S2). Author capability.
//   { action: "create", type: scale|rule_template|layout_template|progression, code, name, description?, scaleKind?, presentation?,
//     targetKind + targetRef (progression: required, permanent), stageScaleVersionId? }   a definition and its first draft version, in one transaction
//   { action: "import_scale", scaleId, mappingId? }   a draft response scale (and its stage scale) made from an existing scoring scale

export async function POST(req: Request) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  if (b?.action === "import_scale") {
    if (!isUuid(b.scaleId)) return refuse(400, "Choose a scale to import.");
    const r = await importScale(ctx.admin, ctx.userId, b.scaleId, isUuid(b.mappingId) ? b.mappingId : null);
    return r.ok ? NextResponse.json(r) : refuse(422, r.error);
  }
  if (b?.action !== "create") return refuse(400, "Unknown action.");
  if (!["scale", "rule_template", "layout_template", "progression"].includes(b.type)) return refuse(400, "Choose what to create.");
  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) return refuse(400, "The code is 3 to 41 characters: capital letters, numbers and hyphens, starting with a letter.");
  if (typeof b.name !== "string" || !b.name.trim()) return refuse(400, "Give it a name.");
  if (b.type === "progression" && !isUuid(b.stageScaleVersionId)) return refuse(400, "Choose the stage scale this rule set places people on.");
  if (b.type === "progression") {
    if (!(TARGET_KINDS as readonly string[]).includes(b.targetKind) || !isUuid(b.targetRef)) return refuse(400, "Choose what this rule set places people against: a checklist instrument or a competency. It cannot be changed later.");
    if (!(await targetExists(ctx.admin, b.targetKind, b.targetRef))) return refuse(422, "That target no longer exists.");
  }
  return respond(await createDefinition(ctx.admin, ctx.userId, {
    type: b.type, code, name: b.name.trim(), description: typeof b.description === "string" ? b.description : null,
    scaleKind: b.scaleKind === "stage" ? "stage" : "rating", presentation: typeof b.presentation === "string" ? b.presentation : "standard_checklist",
    targetKind: typeof b.targetKind === "string" ? b.targetKind : null, targetRef: isUuid(b.targetRef) ? b.targetRef : null, stageScaleVersionId: isUuid(b.stageScaleVersionId) ? b.stageScaleVersionId : null,
  }));
}
