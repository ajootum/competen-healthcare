import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseSelfAssessment } from "@/lib/individual/professional/competency-form";
import { addSelfAssessment, loadScaleLevels } from "@/lib/individual/professional/competency-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/self-assessments -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C2 (migration 520).
//
// { entryId, levelId, outcome?, confidence?, reflection?, interest? } records a self-assessment on the CFCA proficiency
// scale of the competency (its expected level's scale, else the default scale). It is SELF-REPORTED by construction
// (520 refuses anything else), never reduced or rejected for want of evidence, and never verification. A reassessment
// is a new record: earlier ones are kept.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
  const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("id, framework_competency_id, framework_version, removed_at")
    .eq("id", fields.entryId).eq("user_id", ctx.userId).maybeSingle();
  if (!e || e.removed_at) return refuse("That competency is not in My Competencies.", 404);
  const offered = e.framework_competency_id ? await loadCatalogueFor(ctx.admin, "professional") : [];
  const c = offered?.find(o => o.competencyId === e.framework_competency_id) ?? null;
  const levels = await loadScaleLevels(ctx.admin, c?.expectedLevel?.id ?? null);
  if (levels === null) return refuse("The proficiency scale could not be read just now.", 503);
  const parsed = parseSelfAssessment(fields, { levels, outcomes: c?.outcomes ?? [], frameworkVersion: e.framework_version, policy: (await loadIndividualPolicy(ctx.admin)).professionalCompetency });
  if (!parsed.ok) return refuse(parsed.error);
  const out = await addSelfAssessment(ctx.admin, ctx.userId, e.id, parsed.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_self_assessment", "individual_professional_self_assessment", out.id, { outcome: !!parsed.value.learning_outcome });
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}
