import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { evidenceForVerification } from "@/lib/individual/professional/competency-store";
import { requestVerification } from "@/lib/individual/professional/competency-verification";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/competency-verification -- COMPETEN-PROFESSIONAL-COMPETENCY-01, the C5 hand-over.
//
// { entryId, linkIds?, reflection:<linkId> } hands the Verification Studio ONE catalogue competency of the person and the
// evidence linked to it (competency-store evidenceForVerification: never a personal entry). A private reflection goes
// only when the person ticked that reflection for this request (fields named reflection:<link id>). Everything after the
// hand-over -- assessor assignment, assessment, the decision, expiry and revocation -- is the Studio's, enforced in its
// own database guards. Nothing here records or implies a verification.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
  const linkIds = Array.isArray(fields.linkIds) ? fields.linkIds.filter(isUuid) : undefined;
  const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("framework_competency_id").eq("id", fields.entryId).eq("user_id", ctx.userId).maybeSingle();
  if (!e) return refuse("That competency is not in My Competencies.", 404);
  const outcomes = e.framework_competency_id ? (await loadCatalogueFor(ctx.admin, "professional"))?.find(o => o.competencyId === e.framework_competency_id)?.outcomes ?? [] : [];
  const ticked = (v: unknown) => v === true || v === "true" || v === "on";
  const reflections = Object.keys(fields).filter(k => k.startsWith("reflection:") && ticked(fields[k])).map(k => k.slice(11)).filter(isUuid);
  const handed = await evidenceForVerification(ctx.admin, ctx.userId, fields.entryId, linkIds, outcomes, undefined, reflections);
  if (!handed) return refuse("Only a current competency from a catalogue can be verified.");
  const out = await requestVerification(ctx.admin, ctx.userId, { competency: handed.competency, evidence: handed.evidence });
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_verification_requested", "individual_professional_my_competency", fields.entryId, { request: out.requestId, evidence: handed.evidence.length, reflections_chosen: reflections.length });
  return NextResponse.json({ ok: true, requestId: out.requestId }, { status: 201 });
}
