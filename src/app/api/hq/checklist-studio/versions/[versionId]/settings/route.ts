import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { saveSettings, saveTags, type SettingsPatch } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";
import { MODE_PATTERN } from "@/lib/assessment/studio/vocab";

export const dynamic = "force-dynamic";

// PUT /api/hq/checklist-studio/versions/[versionId]/settings -- Checklist Studio (S2). Author capability.
// Body { settings?: { title, summary, purpose_code, method_codes, requires_domain_review, assess_capability, assign_capability,
//   respondent_roles, delivery_modes, evidence_policy, effective_from, review_due }, tags?: uuid[] }.

export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const s = (b?.settings ?? {}) as SettingsPatch;
  if (Array.isArray(s.delivery_modes) && s.delivery_modes.some((m) => typeof m !== "string" || !MODE_PATTERN.test(m))) return refuse(400, "A delivery mode is lower case letters and underscores only.");
  if (Array.isArray(s.respondent_roles) && (s.respondent_roles.length === 0 || s.respondent_roles.some((r) => !["self", "assessor", "auditor"].includes(r)))) return refuse(400, "Choose at least one respondent role.");
  const r = await saveSettings(ctx.admin, ctx.userId, versionId, s);
  if (!r.ok) return refuse(r.status, r.error);
  if (Array.isArray(b?.tags)) {
    const t = await saveTags(ctx.admin, ctx.userId, versionId, b.tags.filter(isUuid));
    if (!t.ok) return refuse(t.status, t.error);
  }
  return NextResponse.json({ ok: true });
}
