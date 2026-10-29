import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { evidenceForVerification } from "@/lib/individual/professional/competency-store";
import { addVerificationEvidence, loadVerifications, requestVerification, verificationMethods, withdrawVerification } from "@/lib/individual/professional/competency-verification";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/competency-verification -- COMPETEN-PROFESSIONAL-COMPETENCY-01, the C5 hand-over.
//
// POST { entryId, method?, linkIds?, reflection:<linkId> } hands the Verification Studio ONE catalogue competency of the
// person, the method chosen from those C5 offers for it (the only one, when there is one), and the evidence linked to it
// (competency-store evidenceForVerification: never a personal entry). A private reflection goes only when the person
// ticked that reflection for this request (fields named reflection:<link id>).
// A POST may also carry renewsDecisionId: a reassessment of that earlier decision, which the Studio validates.
// PATCH { requestId, action: "withdraw" } withdraws the person's own request. PATCH { requestId, action: "add_evidence",
// entryId, reflection:<linkId> } sends the evidence now linked to that competency, as further evidence.
// Everything after the hand-over -- assessor assignment, assessment, the decision, expiry and revocation -- is the
// Studio's, enforced in its own database guards. Nothing here records or implies a verification.

const ticked = (v: unknown) => v === true || v === "true" || v === "on";
const tickedReflections = (fields: Record<string, unknown>) => Object.keys(fields).filter(k => k.startsWith("reflection:") && ticked(fields[k])).map(k => k.slice(11)).filter(isUuid);

async function handedFor(ctx: IndividualContext, entryId: string, fields: Record<string, unknown>) {
  const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("framework_competency_id").eq("id", entryId).eq("user_id", ctx.userId).maybeSingle();
  if (!e) return null;
  const outcomes = e.framework_competency_id ? (await loadCatalogueFor(ctx.admin, "professional"))?.find(o => o.competencyId === e.framework_competency_id)?.outcomes ?? [] : [];
  const linkIds = Array.isArray(fields.linkIds) ? fields.linkIds.filter(isUuid) : undefined;
  const reflections = tickedReflections(fields);
  const handed = await evidenceForVerification(ctx.admin, ctx.userId, entryId, linkIds, outcomes, undefined, reflections);
  return handed ? { handed, reflections, frameworkCompetencyId: e.framework_competency_id as string } : null;
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
  const h = await handedFor(ctx, fields.entryId, fields);
  if (!h) return refuse("Only a current competency from a catalogue can be verified.");
  const offered = await verificationMethods(ctx.admin, h.frameworkCompetencyId);
  if (offered === null) return refuse("Verification could not be read just now. Try again.", 503);
  if (!offered.provisioned) return refuse("Independent verification is not available yet.", 409);
  const asked = typeof fields.method === "string" ? fields.method : "";
  const method = asked ? offered.methods.find(m => m.code === asked)?.code : offered.methods.length === 1 ? offered.methods[0].code : undefined;
  if (!offered.methods.length) return refuse("No assessment method is offered for this competency yet.", 409);
  if (!method) return refuse(asked ? "That method is not offered for this competency." : "Choose how the competency is to be assessed.");
  // A reassessment names the decision it renews (the Studio checks it); nothing else is passed through.
  const renewsDecisionId = isUuid(fields.renewsDecisionId) ? fields.renewsDecisionId : undefined;
  const asking = { competency: h.handed.competency, evidence: h.handed.evidence, methodCode: method, ...(renewsDecisionId ? { renewsDecisionId } : {}) };
  const out = await requestVerification(ctx.admin, ctx.userId, asking);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_verification_requested", "individual_professional_my_competency", fields.entryId,
    { request: out.requestId, method, evidence: h.handed.evidence.length, reflections_chosen: h.reflections.length, renews: renewsDecisionId ?? null });
  return NextResponse.json({ ok: true, requestId: out.requestId }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.requestId)) return refuse("Choose a request.");
  if (fields.action === "withdraw") {
    const out = await withdrawVerification(ctx.admin, ctx.userId, fields.requestId, typeof fields.reason === "string" ? fields.reason : undefined);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_verification_withdrawn", "competency_verification_request", fields.requestId, {});
    return NextResponse.json({ ok: true });
  }
  if (fields.action === "add_evidence") {
    if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
    const h = await handedFor(ctx, fields.entryId, fields);
    if (!h) return refuse("Only a current competency from a catalogue can be verified.");
    // C5 adds whatever it is handed, so send only what the request does not already hold.
    const read = await loadVerifications(ctx.admin, ctx.userId, h.frameworkCompetencyId);
    if (!read.provisioned) return refuse("Independent verification is not available yet.", 409);
    if (read.items === null) return refuse("Verification could not be read just now. Try again.", 503);
    const request = read.items.find(i => i.requestId === fields.requestId);
    if (!request) return refuse("That request is not one of yours for this competency.", 404);
    const fresh = h.handed.evidence.filter(e => !request.evidence.some(x => x.linkId === e.linkId));
    if (!fresh.length) return refuse("Nothing new to send. Link another record to this competency first.");
    const out = await addVerificationEvidence(ctx.admin, ctx.userId, fields.requestId, fresh);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_verification_evidence_added", "competency_verification_request", fields.requestId,
      { added: out.added, reflections_chosen: h.reflections.length });
    return NextResponse.json({ ok: true, added: out.added });
  }
  return refuse("Unknown action.");
}
