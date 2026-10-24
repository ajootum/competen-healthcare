// Allow up to 60s for AI generation.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { analysisStatus, getMaterial, learnerProgramme, saveAnalysis, unanalysedSections } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { runAnalysis } from "@/lib/individual/scholar/generation";
import { SUBJECTS_PER_CALL } from "@/lib/competency/mapping";
import { scholarCatalogue, type CatalogueRead } from "@/lib/individual/scholar/catalogue";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/materials/[id]/analyse -- COMPETEN-SCHOLAR-01 S2.
//
// GET says how far the material has been analysed (no AI). POST analyses the NEXT few sections of the
// person's own material: the concepts each covers, and the competencies of their programme each may
// support -- PROPOSALS, stored with the model, prompt version and confidence, until the person accepts or
// rejects them. The page calls it until nothing is left. No competency is chosen before upload.
//
// The competencies come from the CompetencyCatalogue interface (S1: the HQ allowlist for Scholar, shared,
// published and active, narrowed to the person's programme), never from the request. No programme chosen:
// concepts only.
// Where 387/388 are absent, GET says { provisioned: false } and POST refuses before any AI call.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const m = await getMaterial(ctx.admin, ctx.userId, id);
  if (!m.ok) return NextResponse.json({ error: "That material could not be read just now." }, { status: 503 });
  if (!m.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s = await analysisStatus(ctx.admin, ctx.userId, id);
  if (!s.ok) return s.notProvisioned ? NextResponse.json({ provisioned: false }) : NextResponse.json({ error: "Could not be read just now." }, { status: 503 });
  return NextResponse.json({ provisioned: true, ...s.data });
}

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const m = await getMaterial(ctx.admin, ctx.userId, id);
  if (!m.ok) return NextResponse.json({ error: "That material could not be read just now." }, { status: 503 });
  if (!m.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next = await unanalysedSections(ctx.admin, ctx.userId, id, SUBJECTS_PER_CALL);
  if (!next.ok) return NextResponse.json({ error: next.notProvisioned ? "Topic finding is not available yet." : "Could not be read just now." }, { status: 503 });
  if (!next.data.length) return NextResponse.json({ analysed: 0, remaining: 0 });

  const programme = await learnerProgramme(ctx.admin, ctx.userId);
  if (!programme.ok) return NextResponse.json({ error: "Your programme could not be read just now." }, { status: 503 });
  const competencies: CatalogueRead = programme.data ? await scholarCatalogue(ctx.admin).forProgramme(programme.data) : { ok: true, data: [] };
  if (!competencies.ok) return NextResponse.json({ error: "Your programme's competencies could not be read just now." }, { status: 503 });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;


  // AI-FAIR-USE-01: the mapping call through the Holdings allowance (activity map), in the engine's own `run` form.
  const ai = scholarAiRunner(ctx, req, "map", await scholarRisk(ctx.admin, ctx.userId, { passages: next.data.map(s => ({ chunkId: s.ref, content: s.text })) }));
  const r = await runAnalysis(ctx.userId, next.data, competencies.data, ai.run);
  const refused = meteredRefusal(ai.refusal());
  if (refused) return refused;
  if (!r.ok) {
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_map", id, { chunk_ids: next.data.map(s => s.ref), outcome: `error:${r.error}` });
    return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });
  }
  const saved = await saveAnalysis(ctx.admin, ctx.userId, {
    materialId: id, programmeCode: programme.data?.code ?? null, model: r.model, promptVersion: r.promptVersion,
    sentChunkIds: next.data.map(s => s.ref), sections: r.check.subjects,
    versions: new Map(competencies.data.map(c => [c.id, c.catalogueVersion ?? null])),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_map", id, {
    chunk_ids: next.data.map(s => s.ref), competencies_shown: r.shown, proposals: saved.proposals,
    dropped: r.check.dropped.map(d => d.reason), model: r.model, prompt_version: r.promptVersion, saved: saved.ok,
    programme_code: programme.data?.code ?? null,
  });
  if (!saved.ok) return NextResponse.json({ error: "The topics could not be saved. Try again shortly." }, { status: 500 });
  const status = await analysisStatus(ctx.admin, ctx.userId, id);
  return NextResponse.json({
    analysed: next.data.length, proposals: saved.proposals,
    remaining: status.ok ? Math.max(0, status.data.sections - status.data.analysed) : null,
  });
}
