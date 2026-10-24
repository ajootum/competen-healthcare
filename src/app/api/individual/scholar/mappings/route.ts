import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { addMapping, isUuid, learnerProgramme } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { scholarCatalogue } from "@/lib/individual/scholar/catalogue";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/mappings -- COMPETEN-SCHOLAR-01 S2, the person's own correction.
//
// Body { chunkId, competencyId }. Links a section of the person's own notes to a competency the AI did not
// propose. The competency must be one the catalogue offers their programme (S1: the HQ allowlist for Scholar,
// shared, published, active) -- checked HERE, never trusted from the body. Stored as source "student"
// with an "accepted" decision row. No AI call.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.chunkId) || !isUuid(body?.competencyId)) return NextResponse.json({ error: "Choose a section and a competency." }, { status: 400 });
  const programme = await learnerProgramme(ctx.admin, ctx.userId);
  if (!programme.ok) return NextResponse.json({ error: "Your programme could not be read just now." }, { status: 503 });
  if (!programme.data) return NextResponse.json({ error: "Choose your programme first." }, { status: 409 });
  const cat = await scholarCatalogue(ctx.admin).forProgramme(programme.data);
  if (!cat.ok) return NextResponse.json({ error: "Your programme's competencies could not be read just now." }, { status: 503 });
  const competency = cat.data.find(c => c.id === body.competencyId);
  if (!competency) return NextResponse.json({ error: "That competency is not part of your programme." }, { status: 404 });
  // UPLOAD-01 U3: an outcome, if named, must be one of THIS competency's own outcomes, word for word.
  const outcome = typeof body?.outcome === "string" && body.outcome.trim() ? body.outcome.trim() : null;
  if (outcome && !competency.outcomes.includes(outcome)) return NextResponse.json({ error: "That learning outcome is not one of this competency's." }, { status: 400 });
  const r = await addMapping(ctx.admin, ctx.userId, { chunkId: body.chunkId, competencyId: competency.id, layer: competency.layer, programmeCode: programme.data.code,
    catalogueVersion: competency.catalogueVersion ?? null, outcome });
  if (r === "not_found") return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  if (r === "exists") return NextResponse.json({ error: "That section is already linked to this competency. Accept the suggestion instead." }, { status: 409 });
  if (r === "failed") return NextResponse.json({ error: "The link could not be saved just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_mapping_added", "individual_scholar_competency_map", null, { chunk_id: body.chunkId, competency_id: competency.id });
  return NextResponse.json({ ok: true });
}
