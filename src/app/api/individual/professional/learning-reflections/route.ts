import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit, refuse } from "@/lib/individual/professional/api";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { parseLearningReflection, saveLearningReflection, setImpact } from "@/lib/individual/professional/learning-reflections";
import { isUuid } from "@/lib/individual/professional/validate";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/learning-reflections -- LCPD-01 LCPD-3 (migration 491).
//
//   POST  { cpdId | learningRecordId, template, answers[], impact }  a private reflection on that learning
//   PATCH { id, impact }                                              the impact the person reports, changed
//
// ⚠ PRIVATE, AND NEVER VERIFIED. The reflection is the person's own (470). The impact is what they report: completed,
// understood or applied. Nothing here can say "verified", and the course record is never changed.
// ⚠ The audit row names the kind of thing reflected on, never what the reflection says.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const cfg = await loadLcpdConfig(ctx.admin);
  const p = parseLearningReflection(body, cfg.reflectionTemplates);
  if (!p.ok) return refuse(p.error);
  const r = await saveLearningReflection(ctx.admin, ctx.userId, p.value);
  if (!r.ok) return refuse(r.error, r.status);
  await audit(ctx, "individual_professional_learning_reflection_saved", "individual_professional_learning_reflection", r.id, { subject: "cpdId" in p.value.subject ? "cpd" : "learning_record", impact: p.value.impact, template: p.value.template.code });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.id)) return refuse("Choose a reflection.");
  const r = await setImpact(ctx.admin, ctx.userId, body.id, body?.impact);
  if (!r.ok) return refuse(r.error, r.status);
  await audit(ctx, "individual_professional_learning_impact_set", "individual_professional_learning_reflection", r.id, { impact: body.impact });
  return NextResponse.json({ ok: true });
}
