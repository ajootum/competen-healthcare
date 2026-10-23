// Allow up to 60s for AI generation.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { analysisStatus, getMaterial, learnerProgramme, saveAnalysis, unanalysedSections } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit } from "@/lib/individual/scholar/http";
import { runAnalysis } from "@/lib/individual/scholar/generation";
import { ANALYSE_SECTIONS_PER_CALL, shortlist } from "@/lib/individual/scholar/mapping";
import { frameworkCatalogue, type CatalogueRead } from "@/lib/individual/scholar/catalogue";

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
// The competencies come from the CompetencyCatalogue interface (shared, published, active frameworks of
// the person's programme), never from the request. No programme chosen: concepts only.
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

export async function POST(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const m = await getMaterial(ctx.admin, ctx.userId, id);
  if (!m.ok) return NextResponse.json({ error: "That material could not be read just now." }, { status: 503 });
  if (!m.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next = await unanalysedSections(ctx.admin, ctx.userId, id, ANALYSE_SECTIONS_PER_CALL);
  if (!next.ok) return NextResponse.json({ error: next.notProvisioned ? "Topic finding is not available yet." : "Could not be read just now." }, { status: 503 });
  if (!next.data.length) return NextResponse.json({ analysed: 0, remaining: 0 });

  const programme = await learnerProgramme(ctx.admin, ctx.userId);
  if (!programme.ok) return NextResponse.json({ error: "Your programme could not be read just now." }, { status: 503 });
  const competencies: CatalogueRead = programme.data ? await frameworkCatalogue(ctx.admin).forProgramme(programme.data) : { ok: true, data: [] };
  if (!competencies.ok) return NextResponse.json({ error: "Your programme's competencies could not be read just now." }, { status: 503 });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  const shown = shortlist(next.data, competencies.data);
  const r = await runAnalysis(ctx.userId, next.data, shown);
  if (!r.ok) {
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_map", id, { chunk_ids: next.data.map(s => s.chunkId), outcome: `error:${r.error}` });
    return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });
  }
  const saved = await saveAnalysis(ctx.admin, ctx.userId, {
    materialId: id, programmeCode: programme.data?.code ?? null, model: r.model, promptVersion: r.promptVersion,
    sentChunkIds: next.data.map(s => s.chunkId), sections: r.check.sections,
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_map", id, {
    chunk_ids: next.data.map(s => s.chunkId), competencies_shown: shown.length, proposals: saved.proposals,
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
