// Allow up to 60s for the AI suggestion -- the same ceiling the Professional assistant uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { individualAiQuota, loadIndividualPolicy } from "@/lib/individual/policy";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { SUBJECTS_PER_CALL } from "@/lib/competency/mapping";
import { isUuid } from "@/lib/individual/professional/validate";
import { refuse, writeFailed, audit } from "@/lib/individual/professional/api";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { addPersonMapping, decideMapping, isSubjectKind, listMappings, proposeForSubjects, type SubjectKind } from "@/lib/individual/professional/mapping-store";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/mappings -- COMPETEN-HOLDINGS-SHARED-ENGINES-01, migration 393.
//
// GET   the person's mappings and the competencies Professional offers (the allowlist applied -- EMPTY by
//       default, so nothing is offered until HQ names a catalogue).
// POST  { action: "add", kind, id, competencyId }       the person links one of their entries. Self-declared.
//       { action: "decide", mapId, decision }           accept or reject one of their own mappings.
//       { action: "propose", subjects: [{kind, id}] }   AI suggestions through the Holdings engine, stored as
//                                                       proposed. The assistant route's controls, in its order:
//                                                       guard, quota, configuration, person attribution, audit.
//
// ⚠ NEVER VERIFIED. Nothing here, accepted or not, says anyone checked the person's claim.

export async function GET() {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const [mappings, catalogue] = await Promise.all([listMappings(ctx.admin, ctx.userId), loadCatalogueFor(ctx.admin, "professional")]);
  if (mappings === null || catalogue === null) return refuse("Your competency links could not be read just now.", 503);
  return NextResponse.json({
    mappings,
    offered: catalogue.map(c => ({ competencyId: c.competencyId, code: c.code, title: c.title, catalogue: c.catalogue.name, layer: c.layer })),
  });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "decide") {
    if (!isUuid(body.mapId) || (body.decision !== "accepted" && body.decision !== "rejected")) return refuse("Choose a link and accept or reject it.");
    const r = await decideMapping(ctx.admin, ctx.userId, body.mapId, body.decision);
    if (r === "not_found") return refuse("That link is not in your record.", 404);
    if (r === "failed") return writeFailed("decision");
    await audit(ctx, "individual_professional_mapping_decided", "individual_professional_competency_map", body.mapId, { decision: body.decision });
    return NextResponse.json({ ok: true });
  }

  const catalogue = await loadCatalogueFor(ctx.admin, "professional");
  if (catalogue === null) return refuse("The competencies on offer could not be read just now.", 503);
  if (!catalogue.length) return refuse("No competency catalogue is offered in Professional yet.", 409);

  if (action === "add") {
    if (!isSubjectKind(body.kind) || !isUuid(body.id) || !isUuid(body.competencyId)) return refuse("Choose an entry and a competency.");
    const r = await addPersonMapping(ctx.admin, ctx.userId, body.kind, body.id, body.competencyId, catalogue);
    if (r === "not_offered") return refuse("That competency is not offered in Professional.");
    if (r === "not_found") return refuse("That entry is not in your record.", 404);
    if (r === "exists") return refuse("That entry is already linked to this competency.", 409);
    if (r === "failed") return writeFailed("link");
    await audit(ctx, "individual_professional_mapping_added", "individual_professional_competency_map", null, { kind: body.kind, source: "person" });
    return NextResponse.json({ ok: true });
  }

  if (action === "propose") {
    const asked: { kind: SubjectKind; id: string }[] = Array.isArray(body.subjects)
      ? body.subjects.filter((s: { kind?: unknown; id?: unknown }) => isSubjectKind(s?.kind) && isUuid(s?.id)).slice(0, SUBJECTS_PER_CALL) : [];
    if (!asked.length) return refuse("Choose up to six entries to suggest links for.");

    // The estate limit and the Individual policy limit, whichever is tighter (CONFIG-002).
    const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin));
    if (!quota.ok) return refuse(`You have reached the limit of ${quota.limit} questions an hour. Try again later.`, 429);
    if (!aiStatus().configured) return refuse("The personal AI is not configured on this environment.", 503);

    // Only the person's own entries: the record is read by user id, and an id not in it is skipped.
    const record = await loadProfessionalRecord(ctx.admin, ctx.userId);
    const rows: Record<SubjectKind, { id: string }[] | null> = { goal: record.goals, cpd: record.cpd, evidence: record.evidence };
    const subjects = asked.flatMap(a => {
      const row = rows[a.kind]?.find(r => r.id === a.id);
      return row ? [{ kind: a.kind, row }] : [];
    });
    if (!subjects.length) return refuse("Those entries are not in your record.", 404);

    const r = await proposeForSubjects(ctx.admin, ctx.userId, subjects, catalogue);
    // The action the quota counts, whenever the model answered (a store failure after it still counts).
    // Sizes and kinds only, never the person's words.
    if (r.ok || r.error === "failed") {
      await audit(ctx, "ai_assistant_query", "individual_professional_mapping", null,
        { task: "competency_map", subjects: subjects.length, proposed: r.ok ? r.proposed : 0, model: r.ok ? r.model : null });
    }
    if (!r.ok) {
      if (r.error === "failed") return writeFailed("suggestions");
      if (r.error === "no_text") return refuse("Those entries have too little text to suggest links from.");
      const status = r.error === "not_configured" ? 503 : 502;
      return refuse(r.error === "refusal" ? "The assistant declined that request." : "Suggestions could not be made just now. Try again shortly.", status);
    }
    return NextResponse.json({ ok: true, proposed: r.proposed });
  }

  return refuse("Unknown action");
}
