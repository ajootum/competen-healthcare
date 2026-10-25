import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseEvidenceLink } from "@/lib/individual/professional/competency-form";
import { linkEvidence, unlinkEvidence } from "@/lib/individual/professional/competency-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/competency-evidence -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C4 (migration 520).
//
//   POST  { entryId, kind, sourceId, outcome?, relation, model?, promptVersion? }  link one existing record to the
//         competency or one of its learning outcomes. model and promptVersion are sent only when the person ACCEPTED an
//         AI suggestion, and are kept with the link. The record is never copied, and 520's composite keys refuse
//         another person's record.
//   PATCH { linkId }  unlink: kept as history.
//
// ⚠ SUPPORTING EVIDENCE IS NOT VERIFICATION, whatever relation is chosen.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
  const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("id, framework_competency_id, framework_version, removed_at")
    .eq("id", fields.entryId).eq("user_id", ctx.userId).maybeSingle();
  if (!e || e.removed_at) return refuse("That competency is not in My Competencies.", 404);
  const offered = e.framework_competency_id ? await loadCatalogueFor(ctx.admin, "professional") : [];
  const outcomes = offered?.find(o => o.competencyId === e.framework_competency_id)?.outcomes ?? [];
  const parsed = parseEvidenceLink(fields, { outcomes, policy: (await loadIndividualPolicy(ctx.admin)).professionalCompetency });
  if (!parsed.ok) return refuse(parsed.error);
  const ai = typeof fields.model === "string" && fields.model && typeof fields.promptVersion === "string" && fields.promptVersion
    ? { model: fields.model.slice(0, 120), promptVersion: fields.promptVersion.slice(0, 40) } : undefined;
  const out = await linkEvidence(ctx.admin, ctx.userId, e, parsed.value, ai);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_competency_evidence_link", "individual_professional_competency_evidence", out.id, { kind: parsed.value.kind, outcome: !!parsed.value.learning_outcome, source: ai ? "ai" : "person" });
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.linkId)) return refuse("Choose a link.");
  const out = await unlinkEvidence(ctx.admin, ctx.userId, fields.linkId);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_competency_evidence_unlink", "individual_professional_competency_evidence", fields.linkId);
  return NextResponse.json({ ok: true });
}
